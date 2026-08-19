import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeReadJson } from "../storage/safeWrite";
import { getSystemRoot } from "../workspace/workspacePaths";

/**
 * `5-system/restore.inprogress.json` — written before the destructive restore
 * walk starts and removed only once that walk has completed successfully (see
 * `restoreBackupSnapshot`). Its continued presence is the ONLY evidence that a
 * restore stopped halfway and left the workspace in a mixed-epoch state: half
 * the files from the backup, half still the live ones, with nothing on screen
 * to say so.
 *
 * The write side deliberately leaves it behind on failure. This module is the
 * read side — until it existed, nothing in the app ever looked at the file, so
 * the evidence was written and then ignored.
 */
export const RESTORE_INPROGRESS_FILE = "restore.inprogress.json";

/**
 * How long a sentinel may sit there before it is read as an INTERRUPTED restore
 * rather than one that is still running.
 *
 * A restore in flight on another machine legitimately holds the sentinel open
 * for its whole duration, and the app must not accuse a healthy long restore of
 * having failed. Fifteen minutes is well past a normal workspace restore and
 * still short enough that an admin who reloads after a crash is told about it in
 * the same sitting.
 */
export const RESTORE_SENTINEL_STALE_AFTER_MS = 15 * 60 * 1000;

export type RestoreInProgressSentinel = {
  /** ISO timestamp written when the restore walk began. */
  startedAt: string;
  /** Username that started the restore. */
  startedBy: string;
};

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Read the sentinel, or null when there is none (the normal state).
 *
 * A PRESENT but unparseable sentinel still counts as "a restore started here":
 * the file's existence is the signal, its contents only sharpen the message. It
 * comes back with empty fields, which `isRestoreSentinelStale` reads as stale —
 * refusing to warn because the evidence is damaged would be exactly backwards.
 */
export async function readRestoreSentinel(
  directoryHandle: DirectoryHandleLike
): Promise<RestoreInProgressSentinel | null> {
  try {
    const systemDir = await getSystemRoot(directoryHandle, false);
    const result = await safeReadJson<Partial<RestoreInProgressSentinel>>(
      systemDir,
      RESTORE_INPROGRESS_FILE
    );
    if (!result.ok) {
      return result.reason === "corrupt" ? { startedAt: "", startedBy: "" } : null;
    }
    return {
      startedAt: asText(result.value.startedAt),
      startedBy: asText(result.value.startedBy),
    };
  } catch {
    // No workspace, no `5-system/`, or an unreadable one: nothing can be said
    // about a restore either way, and a warning banner is not the place to
    // surface a folder-access problem.
    return null;
  }
}

/**
 * True when the sentinel is old enough (or damaged enough) that the restore it
 * describes cannot still be running.
 *
 * An unparseable/missing `startedAt` is stale by definition — the file exists,
 * so a restore started, and there is no timestamp to vouch for it. A timestamp
 * in the future (a machine whose clock runs ahead) is deliberately NOT treated
 * as stale: it is indistinguishable from a restore that just started.
 */
export function isRestoreSentinelStale(
  sentinel: RestoreInProgressSentinel,
  now: number = Date.now(),
  staleAfterMs: number = RESTORE_SENTINEL_STALE_AFTER_MS
): boolean {
  const startedAt = Date.parse(sentinel.startedAt);
  if (!Number.isFinite(startedAt)) return true;
  return now - startedAt >= staleAfterMs;
}
