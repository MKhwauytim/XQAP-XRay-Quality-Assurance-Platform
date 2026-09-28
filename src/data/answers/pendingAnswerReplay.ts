/**
 * A1: land every answer this browser still holds as "not saved yet".
 *
 * Replaces the replay that only ran while «نتائج فحص الأشعة» was mounted, and
 * only for the selected month: a pending record's `month` is the folder its
 * failed write targeted (a real month or an `adhoc-*` store), so replaying
 * record-by-record covers every month and every ad-hoc import. Writes go
 * through `upsertItemAnswer` — the same conflict-safe append a real save uses.
 *
 * Fix round 1 (reviewer findings) hardened this considerably over the first
 * cut — see the doc comments below at each guard for what each one prevents.
 */
import { AnswersUnreadableError, loadAllEmployeeFiles, loadEmployeeAnswers, upsertItemAnswer } from "./answerStorage";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { logError } from "../storage/errorLogger";
import { notifyLocalDataChange } from "../workspace/dataRefreshSignal";
import { getSampleMainDir } from "../workspace/workspacePaths";
import { isNotFoundError } from "../storage/transientFileErrors";
import { dedupeInFlight, workspaceScopeId } from "../storage/inFlightReads";
import { withTryResourceLock } from "../storage/webLocks";
import { MonthClosedError } from "../population/monthLock";
import { ReadOnlyModeError } from "../storage/readOnlyMode";
import { answerDraftKey, clearAnswerDraft } from "./answerDraftStore";
import { backfillMirrorFromDisk, loadPendingAnswerRecords, mirrorAnswerLocally } from "./answerLocalMirror";
import type { ItemAnswer } from "./answerTypes";
import { compareSavedAt } from "./savedAt";

export type PendingReplayDeps = {
  loadPending: (username: string) => Promise<Array<{ month: string; item: ItemAnswer }>>;
  markSynced: (month: string, username: string, item: ItemAnswer) => Promise<void>;
};

export type PendingReplaySummary = {
  replayed: number;
  alreadyOnDisk: number;
  failed: number;
  /**
   * Left pending ON PURPOSE this pass — never logged as an error, because
   * each cause here is an expected, recurring condition that resolves on
   * its own (the month reopens, read-only mode ends, the share becomes
   * reachable again), not a bug: the month is closed (`MonthClosedError`),
   * the app is in read-only/demo mode (`ReadOnlyModeError`), the month's
   * `2-samples/{month}/1-main/` folder does not exist yet (replay never
   * creates it), or the month's event segments could not be read strictly
   * (`AnswersUnreadableError` — see the "is it already on disk" note below).
   */
  cannotLand: number;
};

const EMPTY_SUMMARY: PendingReplaySummary = { replayed: 0, alreadyOnDisk: 0, failed: 0, cannotLand: 0 };

/**
 * Minor (fix round 2): a per-item write error that is NOT `MonthClosedError`/
 * `ReadOnlyModeError` (an actual failure, not an expected wait) used to be
 * logged on every single 30s tick for as long as it kept failing — a
 * persistently unreachable share, say, turns into a new durable error-log
 * entry every 30 seconds forever. Logged once per (month, xrayImageId, error
 * name) for the lifetime of this session instead; the item itself is still
 * retried every tick (only the LOGGING is deduped, not the retry).
 */
const loggedPendingReplayWriteErrors = new Set<string>();

function logPendingReplayWriteErrorOnce(month: string, xrayImageId: string, error: unknown): void {
  const errorName = error instanceof Error ? error.name : String(error);
  const key = `${month}::${xrayImageId}::${errorName}`;
  if (loggedPendingReplayWriteErrors.has(key)) return;
  loggedPendingReplayWriteErrors.add(key);
  logError("answers:pending-replay-write", error);
}

/** @internal test-only — clears the per-session write-error log dedupe set. */
export function __resetPendingReplayLogDedupeForTests(): void {
  loggedPendingReplayWriteErrors.clear();
}

const DEFAULT_DEPS: PendingReplayDeps = {
  loadPending: loadPendingAnswerRecords,
  markSynced: mirrorAnswerLocally,
};

/**
 * Same-tab join key: workspace + username. Scoped to the workspace too
 * (`workspaceScopeId` — a stable id `inFlightReads.ts` mints per directory
 * handle THIS TAB has seen) so two different workspaces open in one session
 * never join each other's in-flight run even if a username happened to
 * match. This is deliberately NOT what the cross-tab lock below uses (see
 * its own doc for why).
 */
function inTabDedupeKey(directoryHandle: DirectoryHandleLike, username: string): string {
  return `pending-replay:${workspaceScopeId(directoryHandle)}:${username}`;
}

/**
 * Cross-tab lock name: username ALONE. Fix round 2 (I2): `workspaceScopeId`
 * is a PER-TAB counter (`ws1`, `ws2`, …, minted the first time a given
 * `DirectoryHandleLike` object is seen in `inFlightReads.ts`'s `WeakMap`) —
 * two different tabs opening the SAME workspace on disk get two DIFFERENT
 * `DirectoryHandleLike` objects (the File System Access API hands out a new
 * handle object per `showDirectoryPicker()`/session restore) and therefore
 * two different scope ids. Using it in the cross-tab lock name meant the
 * lock was never actually shared across tabs — the id it was meant to keep
 * distinct is exactly the thing that made two tabs never collide on it. The
 * lock's whole job is to be the same name in every tab replaying for the
 * same user, so it drops the workspace scope entirely.
 */
function crossTabLockKey(username: string): string {
  return `pending-replay:${username}`;
}

/**
 * IMPORTANT 2 (fix round 1, corrected fix round 2): a single, shared
 * in-flight guard, in two parts.
 *
 *  1. Same-tab: `dedupeInFlight` (the existing app-wide "join an overlapping
 *     call for this key" primitive — see `inFlightReads.ts`, already used
 *     for workspace directory reads), keyed by `inTabDedupeKey` (workspace +
 *     username). A second call for the same user in the SAME tab while one
 *     is running joins that SAME promise instead of starting its own.
 *  2. Cross-tab: the actual work runs inside `withTryResourceLock`, keyed by
 *     `crossTabLockKey` (username ALONE — see its own doc for why NOT the
 *     workspace scope) via the Web Locks API where available, an in-memory
 *     held-set fallback otherwise (`webLocks.ts`). If another tab already
 *     holds it, THIS tick is SKIPPED — not queued — and returns an all-zero
 *     summary; the other tab's run is already doing the work. This is
 *     deliberately NOT the same primitive `dedupeInFlight` uses: Web Locks
 *     are the only mechanism here that reaches across tabs, and it has no
 *     "join and get the same result back" mode, only "wait" or "skip" —
 *     skip is right for a poller that ticks again in 30s anyway.
 *
 * Together these are what makes "two replays of the same pending item can
 * never run concurrently" true across BOTH axes (same tab, cross tab) — not
 * just a claim about one of them.
 */
export async function replayPendingAnswers(
  directoryHandle: DirectoryHandleLike,
  username: string,
  deps: PendingReplayDeps = DEFAULT_DEPS
): Promise<PendingReplaySummary> {
  return dedupeInFlight(inTabDedupeKey(directoryHandle, username), async () => {
    const attempt = await withTryResourceLock(crossTabLockKey(username), () =>
      runReplayPendingAnswers(directoryHandle, username, deps)
    );
    return attempt.ran ? attempt.result : EMPTY_SUMMARY;
  });
}

/**
 * IMPORTANT 3 (fix round 1): confirm the month's `1-main` sample folder
 * already exists (`create: false`) BEFORE touching it at all. Replay must
 * never create a month folder — `performAnswerWrite` (inside
 * `upsertItemAnswer`) resolves it with `create: true`, so without this
 * probe a pending record naming a month whose folder was never created (or
 * was removed) would have its folder silently conjured back into existence
 * by a background poller. `getSampleMainDir(..., false)` throws
 * `NotFoundError` the same way whether the month folder itself or just its
 * `1-main` child is missing (both resolve through the same `create: false`
 * chain), which is exactly the "does this month have anywhere to land an
 * answer at all" question.
 */
async function sampleMainDirExists(directoryHandle: DirectoryHandleLike, month: string): Promise<boolean> {
  try {
    await getSampleMainDir(directoryHandle, month, false);
    return true;
  } catch (error) {
    if (isNotFoundError(error)) return false;
    // An unexpected error resolving the folder (permission lost, transient
    // share fault that exhausted its own retries) — conservative default is
    // "cannot confirm it exists," so this month's items are left pending
    // rather than risking a write into a folder we could not actually see.
    logError("answers:pending-replay-probe", error);
    return false;
  }
}

/**
 * IMPORTANT 1 (fix round 1): whether disk already holds this item (or a
 * newer one) must be answered with the STRICT read
 * (`loadAllEmployeeFiles(..., { strict: true })`, which threads
 * `{ strict: true }` all the way to `readEventSegmentDelta` and throws
 * `AnswersUnreadableError` — wrapping `EventSegmentUnreadableError` — rather
 * than silently tolerating an unreadable segment as "no events in it," the
 * way the plain/lenient read does). The plain read made a skipped segment
 * look like the item was missing from disk, so a stale local copy (this
 * pass's `eventAt = now`) would win the fold over a genuinely newer answer
 * already on disk from another device — a silent regression. On
 * `AnswersUnreadableError` this month is skipped entirely this pass (every
 * pending item in it stays pending, counted under `cannotLand`) rather than
 * risk exactly that.
 */
async function loadOnDiskItemsStrict(
  directoryHandle: DirectoryHandleLike,
  month: string,
  username: string
): Promise<Map<string, ItemAnswer> | null> {
  try {
    const files = await loadAllEmployeeFiles(directoryHandle, month, { strict: true });
    const mine = files.find((file) => file.username === username);
    return new Map((mine?.items ?? []).map((item) => [item.xrayImageId, item]));
  } catch (error) {
    if (error instanceof AnswersUnreadableError) return null;
    throw error;
  }
}

async function runReplayPendingAnswers(
  directoryHandle: DirectoryHandleLike,
  username: string,
  deps: PendingReplayDeps
): Promise<PendingReplaySummary> {
  const summary: PendingReplaySummary = { replayed: 0, alreadyOnDisk: 0, failed: 0, cannotLand: 0 };
  const byMonth = new Map<string, ItemAnswer[]>();
  for (const { month, item } of await deps.loadPending(username)) {
    const items = byMonth.get(month);
    if (items) items.push(item);
    else byMonth.set(month, [item]);
  }

  for (const month of [...byMonth.keys()].sort((a, b) => a.localeCompare(b))) {
    const items = byMonth.get(month)!;

    if (!(await sampleMainDirExists(directoryHandle, month))) {
      summary.cannotLand += items.length;
      continue;
    }

    const onDisk = await loadOnDiskItemsStrict(directoryHandle, month, username);
    if (!onDisk) {
      // AnswersUnreadableError -- see loadOnDiskItemsStrict's doc. No log
      // here: a persistently flaky share already gets its own error-code
      // logging from the read path itself; logging again on every 30s tick
      // for as long as the flakiness lasts is exactly the noise CRITICAL-1
      // (below) exists to avoid, applied here too.
      summary.cannotLand += items.length;
      continue;
    }

    for (const item of items) {
      const current = onDisk.get(item.xrayImageId);
      if (current && compareSavedAt(current.lastSavedAt, item.lastSavedAt) >= 0) {
        // The workspace already holds this answer (or a newer one): only the
        // queue entry is stale. The draft is left alone — it may hold edits
        // made after the failed save.
        await deps.markSynced(month, username, current);
        summary.alreadyOnDisk += 1;
        continue;
      }
      // CRITICAL 1 (fix round 1): `upsertItemAnswer` THROWS (it does not
      // reject with `{ ok: false }`) for `MonthClosedError` and
      // `ReadOnlyModeError` — both raised by `ensureMonthWritable` before
      // the write is even attempted. An uncaught throw here used to abort
      // the ENTIRE pass: every month sorted after the offending one (and
      // every ad-hoc folder, since those sort after real months) never got
      // a chance to replay, and the same throw repeated on every 30s tick,
      // landing in the durable per-user error log forever. Each item is now
      // isolated in its own try/catch so one item's failure can never stop
      // its neighbours, this month's remaining items, or any other month.
      try {
        const result = await upsertItemAnswer(directoryHandle, month, username, item);
        if (result.ok) {
          clearAnswerDraft(answerDraftKey(month, item.xrayImageId, username));
          summary.replayed += 1;
        } else {
          summary.failed += 1;
        }
      } catch (error) {
        if (error instanceof MonthClosedError || error instanceof ReadOnlyModeError) {
          // Expected, recurring, not a bug -- see PendingReplaySummary's doc.
          summary.cannotLand += 1;
        } else {
          logPendingReplayWriteErrorOnce(month, item.xrayImageId, error);
          summary.failed += 1;
        }
      }
    }
  }

  if (summary.replayed + summary.alreadyOnDisk > 0) notifyLocalDataChange(["answers"]);
  return summary;
}

/**
 * IMPORTANT 5 (fix round 1): the NON-WRITING half of what
 * `reconcileAnswersWithLocalMirror` (deleted from `answerStorage.ts`) used
 * to do — re-mirror the workspace file's CURRENT items into this browser's
 * local IndexedDB backup, so the mirror recovers after a cleared/empty
 * IndexedDB and stays current as the employee keeps working. Deliberately
 * drops the other half that function used to do: re-landing every mirrored
 * item that looked newer than disk back onto the workspace file, regardless
 * of whether it was ever marked pending. That was a hidden background
 * WRITER into the shared folder — no lock, no permission gate, and no idea
 * whether the folder it wrote into had just been restored from a backup
 * (Workstream D will make restoring a folder an explicit operation with its
 * own safeguards). Landing a genuinely pending answer is
 * `replayPendingAnswers`'s job alone now.
 *
 * Best-effort, plain (non-strict) read — this is a convenience backup copy,
 * never the thing standing between a real answer and data loss the way
 * `replayPendingAnswers`'s own on-disk check must be.
 *
 * CRITICAL (fix round 2): the actual re-mirroring is `backfillMirrorFromDisk`
 * (`answerLocalMirror.ts`), NOT a per-item `mirrorAnswerLocally` loop — that
 * was an unconditional IndexedDB `put`, which would silently overwrite a
 * still-pending (`synced: false`) mirror entry with whatever the (possibly
 * OLDER) on-disk copy happens to be, making a real unsaved edit vanish from
 * `loadPendingAnswerRecords` with no trace. `backfillMirrorFromDisk` never
 * does that — see its own doc and `shouldRefreshMirrorFromDisk`.
 */
export async function backfillAnswerMirror(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  username: string
): Promise<void> {
  try {
    const file = await loadEmployeeAnswers(directoryHandle, monthFolderName, username);
    await backfillMirrorFromDisk(monthFolderName, username, file.items);
  } catch (error) {
    logError("answers:mirror-backfill", error);
  }
}
