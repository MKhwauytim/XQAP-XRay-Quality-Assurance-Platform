import type { FeedbackMessage } from "./feedbackStorage";

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
