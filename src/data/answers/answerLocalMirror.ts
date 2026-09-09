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
 * by `reconcileAnswersWithLocalMirror` in `answerStorage.ts`.
 *
 * **This is a backup, never a source of truth, and never a deletion signal.**
 * The workspace file — reachable by every device, backed by `.bak`, protected
 * by `casLoop` — remains authoritative. IndexedDB can legitimately be empty
 * (a fresh browser profile, a cleared site data, a different machine); an
 * empty or missing mirror means only "nothing to restore from here," never
 * "the employee's answers were deleted." Reconciliation is therefore
 * one-directional-additive in both directions: a mirror entry the file
 * lacks gets replayed INTO the file, and the file's own items get written
 * INTO the mirror — nothing already on either side is ever removed by this
 * module.
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

/**
 * Best-effort: mirror one answered item locally. Never throws — a failure
 * here (quota exceeded, IndexedDB disabled, a blocked upgrade) only costs the
 * redundant backup copy, never the real save this is layered on top of.
 */
export async function mirrorAnswerLocally(
  month: string,
  username: string,
  item: ItemAnswer
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

/** Every item this browser has ever mirrored for `(month, username)`. Empty on any failure — see module doc: absence is never meaningful here. */
export async function loadMirroredAnswers(month: string, username: string): Promise<ItemAnswer[]> {
  const db = await openMirrorDb();
  if (!db) return [];
  try {
    const all = await new Promise<MirrorRecord[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const request = tx.objectStore(STORE_NAME).getAll();
      request.onsuccess = () => resolve((request.result ?? []) as MirrorRecord[]);
      request.onerror = () => reject(request.error);
    });
    return all
      .filter((record) => record.month === month && record.username === username)
      .map((record) => record.item);
  } catch {
    return [];
  } finally {
    db.close();
  }
}
