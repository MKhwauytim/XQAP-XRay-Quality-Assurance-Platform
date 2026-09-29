import type { ItemAnswer } from "./answerTypes";
import { compareSavedAt } from "./savedAt";

/**
 * A local, per-BROWSER redundant copy of an employee's own answers, kept in
 * IndexedDB purely as an extra safety net alongside the workspace file (which
 * already gets its own `.bak` from `safeWriteJson` — see `safeWrite.ts`).
 *
 * Why this exists: the 2026-09 production error log showed answer saves that
 * appeared to succeed on the employee's screen while the underlying write to
 * the shared folder kept failing (name-too-long / share contention). An
 * IndexedDB mirror survives independently of the share, so a save that made
 * it to the browser but not (yet, or ever) to the file can be recovered later
 * by `replayPendingAnswers` in `pendingAnswerReplay.ts` (app-level, mounted
 * once in AuthGate — not scoped to one view or month).
 *
 * **This is a backup, never a source of truth, and never a deletion signal.**
 * The workspace file — reachable by every device, backed by `.bak`, protected
 * by `casLoop` — remains authoritative. IndexedDB can legitimately be empty
 * (a fresh browser profile, a cleared site data, a different machine); an
 * empty or missing mirror means only "nothing to restore from here," never
 * "the employee's answers were deleted."
 *
 * Reconciliation is one-directional-additive on EACH side separately, but the
 * two directions are no longer symmetric (A1 fix round, IMPORTANT 5): a
 * mirror entry the file lacks is replayed INTO the file only when it is still
 * marked `synced: false` here (`replayPendingAnswers`, keyed off
 * `loadPendingAnswerRecords`) — a `synced: true` entry is never re-landed,
 * since re-landing regardless of sync state would be a hidden background
 * writer into the shared folder with no idea whether that folder had just
 * been restored from a backup. The file's own items are still written INTO
 * the mirror on the other side, but through TWO DIFFERENT rules depending on
 * WHY the write is happening (fix round 4 — conflating them in fix round 3
 * made a pending record permanently un-confirmable, a stuck-queue bug):
 *  - `backfillMirrorFromDisk` (called from `backfillAnswerMirror` in
 *    `pendingAnswerReplay.ts` — the non-writing half of what used to be
 *    `reconcileAnswersWithLocalMirror`) is an OPPORTUNISTIC read with no
 *    authoritative knowledge that any one pending item has landed — it must
 *    NEVER touch a `synced: false` record at all (`shouldRefreshMirrorFromDisk`).
 *  - `mirrorAnswerLocally` (called right after a real save succeeds, or by
 *    `replayPendingAnswers` to confirm a pending item it just verified is
 *    already on disk) carries AUTHORITATIVE knowledge that the item it is
 *    passing really is now on the workspace file — it MUST be able to clear
 *    a pending record (`shouldConfirmMirrorRecord`), refusing only when the
 *    existing pending record is itself strictly NEWER than the item being
 *    confirmed (a genuinely newer, still-unsaved edit must never be
 *    regressed by a stale confirmation of an older one).
 * Nothing already on either side is ever removed by this module.
 */

const DB_NAME = "xray_answers_local_mirror_v1";
const STORE_NAME = "items";
const DB_VERSION = 1;

export const MIRROR_SYNCED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

type MirrorRecord = {
  key: string;
  month: string;
  username: string;
  xrayImageId: string;
  item: ItemAnswer;
  mirroredAt: string;
  /**
   * `true` — this item is confirmed present in the workspace file (the
   * normal case: mirrored right after a successful save, or re-mirrored by
   * `backfillAnswerMirror` after reading the file).
   * `false` — the save attempt that produced this item failed to reach the
   * shared folder; it stays queued here until `replayPendingAnswers`
   * (the app-level runner's mount tick, or its 30s tick) lands it.
   */
  synced: boolean;
};

function mirrorKey(month: string, username: string, xrayImageId: string): string {
  return `${month}::${username}::${xrayImageId}`;
}

/**
 * ONE connection for the page (A6). `indexedDB.open()` + `close()` on every save
 * was awaited on the click path and repeated on each 30 s replay tick. The
 * connection is kept for the life of the page and dropped (so the next call
 * reopens) when the browser says it is going away: `versionchange` (another tab
 * upgrading the schema must not be blocked by us), `close` (the browser closed it
 * abnormally), or a failed open. Keyed on the `indexedDB` factory identity so a
 * test that swaps the global gets a fresh connection.
 */
let connection: { factory: IDBFactory; promise: Promise<IDBDatabase | null> } | null = null;

function dropConnection(promise: Promise<IDBDatabase | null> | undefined): void {
  if (connection?.promise === promise) connection = null;
}

/** `null` when IndexedDB is unavailable (no browser, disabled, or blocked) — every caller treats that as "no mirror," not an error. */
function openMirrorDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined" || indexedDB === null) return Promise.resolve(null);
  if (connection && connection.factory === indexedDB) return connection.promise;
  const factory = indexedDB;
  // Declared before the executor: `open` may throw synchronously (SecurityError,
  // opaque origin, blocked storage) BEFORE `promise` is assigned, and the handlers
  // below reference it.
  let promise: Promise<IDBDatabase | null> | undefined;
  let failedSynchronously = false;
  promise = new Promise((resolve) => {
    try {
      const request = factory.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "key" });
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          try {
            db.close();
          } catch {
            // already closing
          }
          dropConnection(promise);
        };
        db.onclose = () => dropConnection(promise);
        resolve(db);
      };
      request.onerror = () => {
        dropConnection(promise);
        resolve(null);
      };
      request.onblocked = () => {
        dropConnection(promise);
        resolve(null);
      };
    } catch {
      // Never cache a failed open: the next call tries again.
      failedSynchronously = true;
      resolve(null);
    }
  });
  if (!failedSynchronously) connection = { factory, promise };
  return promise;
}

/**
 * Run `work` against the page's connection. A connection the browser closed
 * underneath us surfaces as `InvalidStateError` from `transaction()`: drop it
 * and retry ONCE on a fresh one. Every other failure (and an unavailable
 * IndexedDB) resolves to `fallback` — the mirror is best-effort, see module doc.
 */
async function withMirrorDb<T>(work: (db: IDBDatabase) => Promise<T>, fallback: T): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const pending = openMirrorDb();
    let db: IDBDatabase | null;
    try {
      db = await pending;
    } catch {
      // The mirror layer never throws (module doc): an open that could not even start is "no mirror".
      dropConnection(pending);
      return fallback;
    }
    if (!db) return fallback;
    try {
      return await work(db);
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      if (attempt === 0 && (name === "InvalidStateError" || name === "TransactionInactiveError")) {
        dropConnection(pending);
        try {
          db.close();
        } catch {
          // already closed
        }
        continue;
      }
      return fallback;
    }
  }
  return fallback;
}

/**
 * Best-effort: mirror one answered item locally as CONFIRMED (`synced:
 * true`) — the item is known to be in the workspace file (called right
 * after a real save/replay succeeds, or by `replayPendingAnswers` to mark a
 * pending item already-on-disk). Never throws — a failure here (quota
 * exceeded, IndexedDB disabled, a blocked upgrade) only costs the redundant
 * backup copy, never the real save this is layered on top of.
 *
 * CRITICAL (fix round 3, corrected fix round 4): this is a GUARDED write —
 * see `shouldConfirmMirrorRecord`'s doc for the CONFIRMATION rule this uses
 * (deliberately DIFFERENT from `shouldRefreshMirrorFromDisk`'s BACKFILL
 * rule below — conflating the two in fix round 3 was itself a bug: it made
 * a pending record permanently un-confirmable, the exact stuck-queue
 * symptom this whole task exists to fix). Confirming a pending record IS
 * meant to happen here — an item that was queued pending and then either
 * lands via replay or turns out to already be on disk MUST be able to clear
 * its own pending flag. What must never happen is a STALE confirmation
 * (an older item) winning over a genuinely NEWER pending edit still
 * in-flight — see `shouldConfirmMirrorRecord`.
 */
export async function mirrorAnswerLocally(
  month: string,
  username: string,
  item: ItemAnswer
): Promise<void> {
  await withMirrorDb(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        issueGuardedPut(tx.objectStore(STORE_NAME), month, username, item, shouldConfirmMirrorRecord);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
    undefined
  );
}

/**
 * Best-effort: queue an answer that FAILED to reach the workspace file
 * (`synced: false`). It stays here — visible via `countPendingAnswers` and
 * retried by `replayPendingAnswers` (`pendingAnswerReplay.ts`) — until a
 * later replay or a later save of the same item succeeds and re-mirrors it
 * as confirmed.
 */
export async function markAnswerPendingLocally(
  month: string,
  username: string,
  item: ItemAnswer
): Promise<void> {
  await withMirrorDb(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        issueGuardedPut(tx.objectStore(STORE_NAME), month, username, item, shouldQueueMirrorRecord, false);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
    undefined
  );
}

/**
 * The QUEUE rule — used by `markAnswerPendingLocally`. A save that FAILED may
 * finish failing AFTER a newer save of the same item was already queued
 * (T1 fails late, T2 already pending). A blind put would let the older
 * failure replace T2's pending record, leaving T2 only as a draft. Refuses
 * when the existing record (pending OR synced) is strictly newer than the
 * item being queued (an instant comparison, `compareSavedAt`); an equal or
 * newer item writes and stays pending. T2 supersedes T1 only for CONSECUTIVE
 * ANSWER SAVES: a reopen or quality-note write is built from the disk-folded
 * `previous`, not from the last answer save, so for those the refused T1's
 * answers survive only in the draft store.
 */
export function shouldQueueMirrorRecord(
  existing: MirroredItemInfo | undefined,
  item: ItemAnswer
): boolean {
  if (!existing) return true;
  return compareSavedAt(item.lastSavedAt, existing.item.lastSavedAt) >= 0;
}

/**
 * The narrow shape `shouldRefreshMirrorFromDisk` needs of an existing mirror
 * record — exported so it can be unit-tested directly, independent of
 * IndexedDB (this repo's test environment has no IndexedDB at all — see
 * `answerLocalMirror.test.ts`'s own note — so the actual decision logic has
 * to be testable on its own, separate from the transaction it runs inside).
 */
export type MirroredItemInfo = { synced: boolean; item: ItemAnswer };

/**
 * The BACKFILL rule — used ONLY by `backfillMirrorFromDisk` (re-mirroring
 * whatever the workspace file currently holds, opportunistically, with NO
 * authoritative knowledge that any particular pending item has actually
 * landed). May the on-disk copy overwrite what is currently mirrored for
 * this key? NO in two cases, both about never losing a real, unsaved
 * answer or regressing a newer mirrored one:
 *  - `existing.synced === false`: this key is a PENDING (still unsaved)
 *    record. A plain disk read has no idea whether THIS PARTICULAR pending
 *    edit has landed — overwriting it on the strength of a disk read alone
 *    would mark it `synced: true` and make `loadPendingAnswerRecords` stop
 *    returning it, possibly while the real edit is still queued. Landing a
 *    pending item is `shouldConfirmMirrorRecord`'s job (below), never this
 *    one's.
 *  - `existing.item.lastSavedAt` is not before `diskItem.lastSavedAt` (an
 *    instant comparison, `compareSavedAt`, not string order): the mirror
 *    already holds something at least as new as disk — nothing to refresh,
 *    and never let an OLDER on-disk read win over what the mirror already
 *    has.
 * YES only when there is no existing record for this key at all, or the
 * existing (already-synced) record is strictly older than disk.
 */
export function shouldRefreshMirrorFromDisk(
  existing: MirroredItemInfo | undefined,
  diskItem: ItemAnswer
): boolean {
  if (!existing) return true;
  if (!existing.synced) return false;
  return compareSavedAt(diskItem.lastSavedAt, existing.item.lastSavedAt) > 0;
}

/**
 * The CONFIRMATION rule — used by `mirrorAnswerLocally` (called with
 * AUTHORITATIVE knowledge that `item`, or something at least as new, really
 * is on the workspace file right now: a real save just succeeded, or
 * `replayPendingAnswers` just confirmed this exact pending item is already
 * on disk). UNLIKE `shouldRefreshMirrorFromDisk`, this rule IS allowed to
 * clear a pending record — that is the entire point of confirming one, and
 * a pending record that can never be confirmed is a permanently stuck
 * queue entry (fix round 4: conflating this with the backfill rule in fix
 * round 3 was itself exactly that bug — `countPendingAnswers` could never
 * reach 0 for an item once it went pending).
 *
 * Refuses ONLY when the existing record is a genuinely NEWER pending edit
 * still in flight — `existing.synced === false` and `existing.item.lastSavedAt`
 * is strictly after `item.lastSavedAt` (an instant comparison,
 * `compareSavedAt`, not string order). Everything else confirms: no existing record, a
 * pending record at the SAME or an OLDER `lastSavedAt` than the incoming
 * item (this call landed it, or it was already there), or an existing
 * synced record that is not newer than the incoming item.
 */
export function shouldConfirmMirrorRecord(
  existing: MirroredItemInfo | undefined,
  item: ItemAnswer
): boolean {
  if (!existing) return true;
  return compareSavedAt(item.lastSavedAt, existing.item.lastSavedAt) >= 0;
}

/**
 * The ONE place a guarded write is issued against an already-open
 * transaction's object store. Three callers, three DIFFERENT rules,
 * deliberately (not one shared rule pretending to serve three questions):
 * `mirrorAnswerLocally` (`shouldConfirmMirrorRecord`, writes `synced: true`),
 * `backfillMirrorFromDisk` (`shouldRefreshMirrorFromDisk`, writes
 * `synced: true`), and `markAnswerPendingLocally` (`shouldQueueMirrorRecord`,
 * writes `synced: false` via the `synced` argument). Reads the existing
 * record for `item`'s key and only issues a `put` when `shouldWrite` says yes.
 */
function issueGuardedPut(
  store: IDBObjectStore,
  month: string,
  username: string,
  item: ItemAnswer,
  shouldWrite: (existing: MirroredItemInfo | undefined, item: ItemAnswer) => boolean,
  synced = true
): void {
  const key = mirrorKey(month, username, item.xrayImageId);
  const getRequest = store.get(key);
  getRequest.onsuccess = () => {
    const existing = getRequest.result as MirrorRecord | undefined;
    if (!shouldWrite(existing, item)) return;
    store.put({
      key,
      month,
      username,
      xrayImageId: item.xrayImageId,
      item,
      mirroredAt: new Date().toISOString(),
      synced,
    } satisfies MirrorRecord);
  };
}

/**
 * Best-effort: re-mirror a whole month's worth of CURRENT on-disk items as
 * CONFIRMED, one single IndexedDB transaction for the entire batch (never
 * one `openMirrorDb`/transaction per item — this can run on every 30s tick
 * for however many items a month has). Every item goes through
 * `issueGuardedPut` (with the BACKFILL rule, `shouldRefreshMirrorFromDisk`)
 * inside that ONE transaction — never a blind overwrite.
 */
export async function backfillMirrorFromDisk(
  month: string,
  username: string,
  items: readonly ItemAnswer[]
): Promise<void> {
  if (items.length === 0) return;
  await withMirrorDb(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        for (const item of items) {
          issueGuardedPut(store, month, username, item, shouldRefreshMirrorFromDisk);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
    undefined
  );
}

/** Connections whose store has already been scanned for prunable records this page session. */
const prunedConnections = new WeakSet<IDBDatabase>();

/**
 * Retention prune (A6): the store used to grow for the life of the browser
 * profile, and every 30 s replay tick `getAll`s all of it. Once per connection,
 * off the caller's path, delete records that are BOTH `synced: true` (a copy of
 * what is confirmed on the share) AND mirrored more than
 * `MIRROR_SYNCED_RETENTION_MS` ago. A `synced: false` record is never touched,
 * however old: it is the only copy of an answer that has not reached the share.
 * The predicate is re-checked against the live record inside the transaction, so
 * a record re-mirrored (or re-queued) since the scan that picked it is kept.
 * Best-effort: any failure only means the store is pruned next session.
 */
function pruneStaleSyncedRecords(db: IDBDatabase, records: readonly MirrorRecord[]): void {
  if (prunedConnections.has(db)) return;
  prunedConnections.add(db);
  const cutoff = Date.now() - MIRROR_SYNCED_RETENTION_MS;
  const isStale = (record: MirrorRecord | undefined): boolean =>
    record !== undefined && record.synced === true && Date.parse(record.mirroredAt) < cutoff;
  const stale = records.filter(isStale).map((record) => record.key);
  if (stale.length === 0) return;
  try {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    for (const key of stale) {
      const getRequest = store.get(key);
      getRequest.onsuccess = () => {
        if (isStale(getRequest.result as MirrorRecord | undefined)) store.delete(key);
      };
    }
  } catch {
    // Best-effort — see above.
  }
}

async function readAllRecords(): Promise<MirrorRecord[]> {
  return withMirrorDb(async (db) => {
    const records = await new Promise<MirrorRecord[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const request = tx.objectStore(STORE_NAME).getAll();
      request.onsuccess = () => resolve((request.result ?? []) as MirrorRecord[]);
      request.onerror = () => reject(request.error);
    });
    pruneStaleSyncedRecords(db, records);
    return records;
  }, [] as MirrorRecord[]);
}

/** Every item this browser has ever mirrored for `(month, username)`, synced or still pending. Empty on any failure — see module doc: absence is never meaningful here. */
export async function loadMirroredAnswers(month: string, username: string): Promise<ItemAnswer[]> {
  const all = await readAllRecords();
  return all
    .filter((record) => record.month === month && record.username === username)
    .map((record) => record.item);
}

/** How many of this employee's own answers are still queued (`synced: false`) for this month — the count behind the "not saved yet" UI notice. */
export async function countPendingAnswers(month: string, username: string): Promise<number> {
  const all = await readAllRecords();
  return all.filter(
    (record) => record.month === month && record.username === username && !record.synced
  ).length;
}

/**
 * Every answer of this user still queued (`synced: false`), across ALL
 * months and ad-hoc folders — not just the one selected in the UI. A
 * pending record's `month` is the folder its failed save originally
 * targeted (a real month folder or an `adhoc-*` synthetic store), so this
 * is the full set the app-level replay runner (A1) needs to walk.
 */
export async function loadPendingAnswerRecords(
  username: string
): Promise<Array<{ month: string; item: ItemAnswer }>> {
  const all = await readAllRecords();
  return all
    .filter((record) => record.username === username && !record.synced)
    .map((record) => ({ month: record.month, item: record.item }));
}

/**
 * Is THIS exact save (same month folder, employee, item and `lastSavedAt`)
 * currently held in the pending queue? Read-only; used only to tell the
 * employee a failed save will be retried in the background. Empty/false on any
 * failure — absence is never meaningful here (see module doc).
 */
export async function isAnswerQueuedPending(
  month: string,
  username: string,
  item: ItemAnswer
): Promise<boolean> {
  const all = await readAllRecords();
  return all.some((record) => isPendingRecordForSave(record, month, username, item));
}

/** Pure match rule behind `isAnswerQueuedPending`: an UNSYNCED record for exactly this month, user, item and `lastSavedAt`. */
export function isPendingRecordForSave(
  record: { month: string; username: string; synced: boolean; item: ItemAnswer },
  month: string,
  username: string,
  item: ItemAnswer
): boolean {
  return (
    record.month === month &&
    record.username === username &&
    !record.synced &&
    record.item.xrayImageId === item.xrayImageId &&
    record.item.lastSavedAt === item.lastSavedAt
  );
}
