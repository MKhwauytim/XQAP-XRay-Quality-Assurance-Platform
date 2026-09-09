import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { logError } from "../storage/errorLogger";
import {
  eventsForEmployee,
  readAllAnswerEventsForMonth,
} from "../answers/answerStorage";
import {
  foldSingleItem,
  sortAnswerEventsForFold,
  type AnswerEvent,
} from "../answers/answerEventStore";
import type { ItemAnswer } from "../answers/answerTypes";
import {
  ADMIN_EDIT_DISTRIBUTION_EVENT_TYPES,
  loadDistributionLog,
} from "../distribution/distributionStorage";
import type { DistributionEvent } from "../distribution/distributionTypes";
import { ACTION_HISTORY_RETENTION_COUNT, type ActionHistorySnapshot } from "./actionHistory";

/**
 * The pre-change history for answers and distribution assignments — DERIVED,
 * not stored.
 *
 * The owner's 2026-09-03 requirement is "show me what this looked like before
 * that change, and let me put it back". The original implementation delivered
 * it by writing a copy of the prior state to its own file on every mutation.
 * For these two families that copy was redundant the day it was written: the
 * app already keeps every mutation, forever, in logs it never prunes —
 * `answers.events/*.ndjson` (append-only) and `distribution.events/{eventId}.json`
 * (immutable by contract). Replaying a log to the point BEFORE event N
 * reconstructs precisely what the snapshot held.
 *
 * Deriving instead of copying is not only tidier, it is the only version that
 * works. The per-record snapshot path was ~115 characters relative to the
 * workspace root, over Windows' 260-character cap on a workspace already deep
 * on the UNC share, so on the deployment in the 2026-09-08/09 error log the
 * writer failed on every single save and the history was never available at
 * all. Nothing here writes, so nothing here can fail that way.
 *
 * Read-only and best-effort throughout: this is a review surface, so an
 * unreadable log degrades to an empty trail rather than throwing into a caller.
 */

/** Newest-first, capped the same way the file-backed template history is. */
function newestFirst<T>(snapshots: ActionHistorySnapshot<T>[]): ActionHistorySnapshot<T>[] {
  return snapshots.reverse().slice(0, ACTION_HISTORY_RETENTION_COUNT);
}

/**
 * What one x-ray item's answer looked like before each change to it.
 *
 * Built by folding that item's own events in order and capturing the folded
 * state BEFORE each event is applied — the same value
 * `recordActionHistorySnapshot` used to be handed as `previousState`, from the
 * same input, so a trail derived here matches one the old writer would have
 * produced.
 */
export async function loadAnswerActionHistory(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  username: string,
  xrayImageId: string
): Promise<ActionHistorySnapshot<ItemAnswer | null>[]> {
  try {
    const allEvents = await readAllAnswerEventsForMonth(directoryHandle, monthFolderName);
    const ownEvents = eventsForEmployee(allEvents, username);
    // `migration-seed` carries no xrayImageId and seeds the fold for every
    // item, so it must stay in the input even though it is not itself a
    // change to THIS item (and so is not emitted as a history entry below).
    const scoped = sortAnswerEventsForFold(
      ownEvents.filter(
        (event) => event.eventType === "migration-seed" || event.xrayImageId === xrayImageId
      )
    );

    const snapshots: ActionHistorySnapshot<ItemAnswer | null>[] = [];
    const applied: AnswerEvent[] = [];
    for (const event of scoped) {
      if (event.eventType !== "migration-seed") {
        snapshots.push({
          snapshotAt: event.eventAt,
          actor: event.answeredOnBehalfBy || event.eventBy || "unknown",
          action: `answer:${event.eventType}`,
          // The fold over everything applied SO FAR — i.e. the state this
          // event is about to overwrite.
          state: foldSingleItem(applied, xrayImageId, { requireMigrationSeed: false }) ?? null,
        });
      }
      applied.push(event);
    }
    return newestFirst(snapshots);
  } catch (error) {
    logError(
      "actionHistory:read-answers",
      error instanceof Error ? error : new Error(String(error))
    );
    return [];
  }
}

/**
 * What one x-ray row's assignment looked like before each admin edit to it.
 *
 * Only edits to an EXISTING assignment are shown — replacement, reassignment,
 * reopen — matching exactly what the deleted writer recorded. The gate is
 * `ADMIN_EDIT_DISTRIBUTION_EVENT_TYPES`, imported rather than restated so the
 * two cannot drift.
 */
export async function loadDistributionActionHistory(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  xrayImageId: string
): Promise<ActionHistorySnapshot<DistributionEvent[]>[]> {
  try {
    const log = await loadDistributionLog(directoryHandle, monthFolderName);
    const rowEvents = log.events.filter((event) => event.xrayImageId === xrayImageId);

    const snapshots: ActionHistorySnapshot<DistributionEvent[]>[] = [];
    rowEvents.forEach((event, index) => {
      if (!ADMIN_EDIT_DISTRIBUTION_EVENT_TYPES.has(event.eventType)) return;
      snapshots.push({
        snapshotAt: event.eventAt,
        actor: event.eventBy || "unknown",
        action: `distribution:${event.eventType}`,
        // Every event for this row that preceded this one — the prior-events
        // list the old writer stored verbatim.
        state: rowEvents.slice(0, index),
      });
    });
    return newestFirst(snapshots);
  } catch (error) {
    logError(
      "actionHistory:read-distribution",
      error instanceof Error ? error : new Error(String(error))
    );
    return [];
  }
}
