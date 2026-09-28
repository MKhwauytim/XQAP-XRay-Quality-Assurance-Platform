import type { ItemAnswer } from "./answerTypes";

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
 * the mirror on the other side (`backfillMirrorFromDisk` below, called from
 * `backfillAnswerMirror` in `pendingAnswerReplay.ts` — the non-writing half
 * of what used to be `reconcileAnswersWithLocalMirror`) — but, CRITICAL fix
 * round 2, that direction is no longer a blind overwrite either: it must
 * never clobber a `synced: false` (still-pending, unsaved) mirror entry with
 * whatever happens to be on disk right now. An employee who re-saved an
 * item and that save is itself still queued as pending would otherwise have
 * the OLDER on-disk version silently marked `synced: true` over top of it —
 * `loadPendingAnswerRecords` would then never see that item again, and
 * `replayPendingAnswers` would never land it: a real, unsaved answer lost
 * with no error, no log, nothing. `shouldRefreshMirrorFromDisk` is the one
 * place that decision is made. Nothing already on either side is ever
 * removed by this module.
 */

const DB_NAME = "xray_answers_local_mirror_v1";
const STORE_NAME = "items";
const DB_VERSION = 1;

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

/** `null` when IndexedDB is unavailable (no browser, disabled, or blocked) — every caller treats that as "no mirror," not an error. */
function openMirrorDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "key" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function putRecord(
  month: string,
  username: string,
  item: ItemAnswer,
  synced: boolean
): Promise<void> {
  const db = await openMirrorDb();
  if (!db) return;
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put({
        key: mirrorKey(month, username, item.xrayImageId),
        month,
        username,
        xrayImageId: item.xrayImageId,
        item,
        mirroredAt: new Date().toISOString(),
        synced,
      } satisfies MirrorRecord);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch {
    // Best-effort — see module doc.
  } finally {
    db.close();
  }
}

/**
 * Best-effort: mirror one answered item locally as CONFIRMED (`synced:
 * true`) — the item is known to be in the workspace file. Never throws — a
 * failure here (quota exceeded, IndexedDB disabled, a blocked upgrade) only
 * costs the redundant backup copy, never the real save this is layered on
 * top of.
 */
export async function mirrorAnswerLocally(
  month: string,
  username: string,
  item: ItemAnswer
): Promise<void> {
  await putRecord(month, username, item, true);
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
  await putRecord(month, username, item, false);
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
 * CRITICAL (fix round 2): the one decision `backfillMirrorFromDisk` makes
 * for every item — may the on-disk copy overwrite what is currently
 * mirrored for this key? NO in two cases, both about never losing a real,
 * unsaved answer or regressing a newer mirrored one:
 *  - `existing.synced === false`: this key is a PENDING (still unsaved)
 *    record. Overwriting it with whatever happens to be on disk right now
 *    would mark it `synced: true` and make `loadPendingAnswerRecords` stop
 *    returning it — `replayPendingAnswers` would never land it again, and
 *    the employee's real edit is gone with no error, no log, nothing.
 *  - `existing.item.lastSavedAt >= diskItem.lastSavedAt`: the mirror
 *    already holds something at least as new as disk (whether or not it was
 *    ever marked pending) — nothing to refresh, and never let an OLDER
 *    on-disk read win over what the mirror already has.
 * YES only when there is no existing record for this key at all, or the
 * existing (already-synced) record is strictly older than disk.
 */
export function shouldRefreshMirrorFromDisk(
  existing: MirroredItemInfo | undefined,
  diskItem: ItemAnswer
): boolean {
  if (!existing) return true;
  if (!existing.synced) return false;
  return diskItem.lastSavedAt > existing.item.lastSavedAt;
}

/**
 * Best-effort: re-mirror a whole month's worth of CURRENT on-disk items as
 * CONFIRMED, one single IndexedDB transaction for the entire batch (never
 * one `openMirrorDb`/transaction per item — this can run on every 30s tick
 * for however many items a month has). Every item is get-then-conditionally-
 * put inside that ONE transaction: read the existing record for its key,
 * decide with `shouldRefreshMirrorFromDisk`, and only issue a `put` when it
 * says yes — never a blind overwrite (see this module's doc and
 * `shouldRefreshMirrorFromDisk`'s own doc for why that was the bug).
 */
export async function backfillMirrorFromDisk(
  month: string,
  username: string,
  items: readonly ItemAnswer[]
): Promise<void> {
  if (items.length === 0) return;
  const db = await openMirrorDb();
  if (!db) return;
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      for (const item of items) {
        const key = mirrorKey(month, username, item.xrayImageId);
        const getRequest = store.get(key);
        getRequest.onsuccess = () => {
          const existing = getRequest.result as MirrorRecord | undefined;
          if (!shouldRefreshMirrorFromDisk(existing, item)) return;
          store.put({
            key,
            month,
            username,
            xrayImageId: item.xrayImageId,
            item,
            mirroredAt: new Date().toISOString(),
            synced: true,
          } satisfies MirrorRecord);
        };
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch {
    // Best-effort — see module doc.
  } finally {
    db.close();
  }
}

async function readAllRecords(): Promise<MirrorRecord[]> {
  const db = await openMirrorDb();
  if (!db) return [];
  try {
    return await new Promise<MirrorRecord[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const request = tx.objectStore(STORE_NAME).getAll();
      request.onsuccess = () => resolve((request.result ?? []) as MirrorRecord[]);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return [];
  } finally {
    db.close();
  }
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
