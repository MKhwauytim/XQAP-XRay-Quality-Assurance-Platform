import {
  summarizeFeedbackThread,
  type FeedbackMessage,
  type FeedbackThread,
  type FeedbackThreadSummary,
} from "./feedbackStorage";

/**
 * Two in-memory copies of the same conversation can coexist in the feedback
 * widget: the provider's polled aggregate (`FeedbackUnreadProvider.messages`,
 * refreshed by the background poll) and the widget's own page-scoped copy
 * (thread bodies it read itself, or a thread it just wrote and applied
 * optimistically). Neither is always newer, so every consumer resolves a
 * thread through these helpers instead of trusting one source.
 *
 * Pure and I/O-free: this module never touches the workspace.
 */

function revisionOf(thread: FeedbackMessage): number {
  const revision = (thread as { revision?: unknown }).revision;
  return typeof revision === "number" ? revision : 0;
}

/**
 * The fresher of two copies of ONE thread. Higher `revision` wins (every write
 * of a thread file bumps it); on a tie -- or for legacy messages that carry no
 * revision at all -- the copy with more replies wins, and a full tie keeps the
 * local copy, which is the one this tab wrote or read most recently.
 */
export function pickFresherThread(
  local: FeedbackMessage | undefined,
  polled: FeedbackMessage | undefined
): FeedbackMessage | undefined {
  if (!local) return polled;
  if (!polled) return local;
  const localRevision = revisionOf(local);
  const polledRevision = revisionOf(polled);
  if (localRevision !== polledRevision) return localRevision > polledRevision ? local : polled;
  return polled.replies.length > local.replies.length ? polled : local;
}

/** Id -> thread lookup over the provider's polled list. */
export function indexThreadsById(
  threads: readonly FeedbackMessage[]
): Map<string, FeedbackMessage> {
  return new Map(threads.map((thread) => [thread.id, thread]));
}

/**
 * The ids from `ids` that neither source holds yet -- the only thread files the
 * page actually has to read. De-duplicated and SORTED, so the result is a
 * stable set identity: re-ordering the visible rows (the "my messages" list
 * re-sorts by latest activity as bodies arrive) never changes it.
 */
export function missingThreadIds(
  ids: readonly string[],
  local: Readonly<Record<string, FeedbackMessage>>,
  polled: ReadonlyMap<string, FeedbackMessage>
): string[] {
  return [...new Set(ids)].filter((id) => !local[id] && !polled.has(id)).sort();
}

/**
 * Every thread either source knows, each resolved to its fresher copy,
 * newest-first by creation time. Used by the admin export so a thread this tab
 * just created or replied to is included even before the next poll lands.
 */
export function mergeFeedbackThreads(
  polled: readonly FeedbackMessage[],
  local: Readonly<Record<string, FeedbackMessage>>
): FeedbackMessage[] {
  const byId = indexThreadsById(polled);
  for (const thread of Object.values(local)) {
    const fresher = pickFresherThread(thread, byId.get(thread.id));
    if (fresher) byId.set(thread.id, fresher);
  }
  return [...byId.values()].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

/**
 * A summary list read from disk, reconciled with what THIS tab already knows.
 *
 * A refresh reads the index, then the listing, then lands -- and in between the
 * user may have submitted a thread or replied/resolved one, each applied to the
 * list optimistically. Replacing the list wholesale with the (older) read then
 * silently un-does both: the new thread drops out and the status patch is lost,
 * although both are durable on disk. So:
 *  - a held thread absent from the read list is ADDED only when
 *    `createdAfterReadStarted(id)` says this tab created it after the read
 *    began. Any other held-but-unlisted thread (read earlier, since deleted on
 *    disk, or from another workspace) is NOT resurrected;
 *  - a held thread that IS listed uses its local summary when it is newer:
 *    a later `lastActivityAt`, or the same one with a resolved status the row
 *    lacks (`resolved` is terminal). Note the INDEX row's `lastActivityAt` only
 *    moves on create and on a status change -- a plain reply does not touch the
 *    index -- so the comparison is a heuristic over ISO timestamps written by
 *    different machines' clocks; it assumes skew smaller than the gap between
 *    the events, and a lost tie merely shows the listed row until the next read.
 * Otherwise the listed row stands, so a change made by ANOTHER user still comes
 * through. The result keeps `listThreadSummaries`' createdAt-descending order.
 */
export function mergeSummariesWithLocalThreads(
  listed: readonly FeedbackThreadSummary[],
  local: Readonly<Record<string, FeedbackThread>>,
  createdAfterReadStarted: (threadId: string) => boolean = () => false
): FeedbackThreadSummary[] {
  const localIds = Object.keys(local);
  if (localIds.length === 0) return [...listed];
  const listedIds = new Set(listed.map((row) => row.threadId));
  const merged = listed.map((row) => {
    const held = local[row.threadId];
    if (!held) return row;
    const heldRow = summarizeFeedbackThread(held);
    const newer =
      heldRow.lastActivityAt > row.lastActivityAt ||
      (heldRow.lastActivityAt === row.lastActivityAt &&
        heldRow.status === "resolved" &&
        row.status !== "resolved");
    return newer ? heldRow : row;
  });
  for (const id of localIds) {
    if (!listedIds.has(id) && createdAfterReadStarted(id)) merged.push(summarizeFeedbackThread(local[id]!));
  }
  return merged.length === listed.length
    ? merged
    : merged.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}
