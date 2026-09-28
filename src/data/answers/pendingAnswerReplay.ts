/**
 * A1: land every answer this browser still holds as "not saved yet".
 *
 * Replaces the replay that only ran while «نتائج فحص الأشعة» was mounted, and
 * only for the selected month: a pending record's `month` is the folder its
 * failed write targeted (a real month or an `adhoc-*` store), so replaying
 * record-by-record covers every month and every ad-hoc import. Writes go
 * through `upsertItemAnswer` — the same conflict-safe append a real save uses.
 */
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { logError } from "../storage/errorLogger";
import { notifyLocalDataChange } from "../workspace/dataRefreshSignal";
import { answerDraftKey, clearAnswerDraft } from "./answerDraftStore";
import { loadPendingAnswerRecords, mirrorAnswerLocally } from "./answerLocalMirror";
import { loadEmployeeAnswers, upsertItemAnswer } from "./answerStorage";
import type { ItemAnswer } from "./answerTypes";

export type PendingReplayDeps = {
  loadPending: (username: string) => Promise<Array<{ month: string; item: ItemAnswer }>>;
  markSynced: (month: string, username: string, item: ItemAnswer) => Promise<void>;
};

export type PendingReplaySummary = { replayed: number; alreadyOnDisk: number; failed: number };

const DEFAULT_DEPS: PendingReplayDeps = {
  loadPending: loadPendingAnswerRecords,
  markSynced: mirrorAnswerLocally,
};

/**
 * F14: a single, MODULE-LEVEL in-flight guard, keyed by username, shared by
 * every caller of `replayPendingAnswers` — the app-level runner's mount
 * tick, its 30s interval tick, and any future caller alike. Without it, two
 * overlapping calls for the same user (e.g. the runner's mount-time replay
 * still in flight when its own next tick — or a second runner instance
 * during a remount — starts another) could both read the same pending item
 * as "not yet on disk" and each append it, producing a duplicate answer
 * event. A second caller that arrives while one is running joins the SAME
 * promise instead of starting its own.
 */
const inFlightReplays = new Map<string, Promise<PendingReplaySummary>>();

export async function replayPendingAnswers(
  directoryHandle: DirectoryHandleLike,
  username: string,
  deps: PendingReplayDeps = DEFAULT_DEPS
): Promise<PendingReplaySummary> {
  const existing = inFlightReplays.get(username);
  if (existing) return existing;
  const run = runReplayPendingAnswers(directoryHandle, username, deps).finally(() => {
    inFlightReplays.delete(username);
  });
  inFlightReplays.set(username, run);
  return run;
}

async function runReplayPendingAnswers(
  directoryHandle: DirectoryHandleLike,
  username: string,
  deps: PendingReplayDeps
): Promise<PendingReplaySummary> {
  const summary: PendingReplaySummary = { replayed: 0, alreadyOnDisk: 0, failed: 0 };
  const byMonth = new Map<string, ItemAnswer[]>();
  for (const { month, item } of await deps.loadPending(username)) {
    const items = byMonth.get(month);
    if (items) items.push(item);
    else byMonth.set(month, [item]);
  }

  for (const month of [...byMonth.keys()].sort((a, b) => a.localeCompare(b))) {
    const items = byMonth.get(month)!;
    let onDisk: Map<string, ItemAnswer>;
    try {
      const file = await loadEmployeeAnswers(directoryHandle, month, username);
      onDisk = new Map(file.items.map((item) => [item.xrayImageId, item]));
    } catch (error) {
      logError("answers:pending-replay-read", error);
      summary.failed += items.length;
      continue;
    }
    for (const item of items) {
      const current = onDisk.get(item.xrayImageId);
      if (current && current.lastSavedAt >= item.lastSavedAt) {
        // The workspace already holds this answer (or a newer one): only the
        // queue entry is stale. The draft is left alone — it may hold edits
        // made after the failed save.
        await deps.markSynced(month, username, current);
        summary.alreadyOnDisk += 1;
        continue;
      }
      const result = await upsertItemAnswer(directoryHandle, month, username, item);
      if (result.ok) {
        clearAnswerDraft(answerDraftKey(month, item.xrayImageId, username));
        summary.replayed += 1;
      } else {
        summary.failed += 1;
      }
    }
  }

  if (summary.replayed + summary.alreadyOnDisk > 0) notifyLocalDataChange(["answers"]);
  return summary;
}
