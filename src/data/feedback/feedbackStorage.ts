import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeReadJson, safeWriteJson } from "../storage/safeWrite";
import { casLoop } from "../storage/casLoop";
import { withResourceLock } from "../storage/webLocks";
import { getFeedbackDir, getFeedbackThreadsDir, getLegacyFeedbackDir } from "../workspace/workspacePaths";
import { listDirectoryEntries, readNamedJsonFiles } from "../storage/directoryScan";
import { logError } from "../storage/errorLogger";

export type FeedbackCategory = "suggestion" | "issue" | "inquiry";

export interface FeedbackReply {
  from: string;
  role: string;
  text: string;
  timestamp: string;
}

export interface FeedbackMessage {
  id: string;
  from: string;
  role: string;
  category: FeedbackCategory;
  text: string;
  timestamp: string;
  status: "open" | "resolved";
  replies: FeedbackReply[];
}

/**
 * One conversation, stored whole in its own file at
 * `5-system/feedback/threads/{threadId}.json`.
 *
 * `FeedbackMessage` is deliberately the base: `id` IS the thread id and
 * `timestamp` IS the creation time, so every existing consumer
 * (`feedbackUnread.ts`, `FeedbackUnreadProvider`, `MessageCard`) reads a thread
 * without a projection step or a type change.
 *
 * The CAS fields guard the ONE remaining same-file race: two admins replying to
 * the SAME thread at the same instant. Two different threads cannot collide at
 * all any more, which is the actual fix — this is the residual case, not the
 * main one.
 */
export interface FeedbackThread extends FeedbackMessage {
  revision?: number;
  _writeToken?: string;
}

/** Row of `threads.index.json` — enough to render and filter the list view without opening a thread. */
export interface FeedbackThreadSummary {
  threadId: string;
  from: string;
  role: string;
  category: FeedbackCategory;
  status: "open" | "resolved";
  createdAt: string;
  /**
   * As of the last INDEX write — i.e. thread creation or a status change. A
   * plain reply deliberately does not touch the index (that is what keeps the
   * shared file rarely written), so this is advisory. The list view orders by
   * `createdAt`, never by this field.
   */
  lastActivityAt: string;
  /** First line of the original message, truncated — for the collapsed row only. */
  preview: string;
}

/**
 * `threads.index.json` — a REBUILDABLE CACHE, not the source of truth.
 *
 * The thread files are authoritative. `listThreadSummaries` reconciles the
 * index against a names-only listing of `threads/` on every read, so a create
 * whose index write lost the CAS race permanently still shows up (and repairs
 * the index on the way past). Same standing as `distribution.current.json`
 * next to the durable `distribution.events/` files.
 */
export type FeedbackThreadsIndex = {
  revision?: number;
  _writeToken?: string;
  threads: FeedbackThreadSummary[];
};

export const FEEDBACK_THREADS_INDEX_FILE = "threads.index.json";
export const FEEDBACK_THREAD_FILE_SUFFIX = ".json";

/** Max characters of the original message kept in a summary row. */
const PREVIEW_MAX_CHARS = 120;

export function feedbackThreadPreview(text: string): string {
  const firstLine = text.split("\n", 1)[0]!.trim();
  return firstLine.length > PREVIEW_MAX_CHARS
    ? `${firstLine.slice(0, PREVIEW_MAX_CHARS)}…`
    : firstLine;
}

// Validate, never sanitize: two distinct ids mapping to one file would silently
// overwrite one user's message with another's. Same rule as
// distributionEventStore's eventFileName.
const THREAD_ID_PATTERN = /^[A-Za-z0-9._-]{1,80}$/;

export function feedbackThreadFileName(threadId: string): string {
  if (!THREAD_ID_PATTERN.test(threadId)) {
    throw new Error(`Invalid feedback thread id: ${threadId}`);
  }
  return `${threadId}${FEEDBACK_THREAD_FILE_SUFFIX}`;
}

/**
 * `t{YYYYMMDDHHmmss}-{8 hex}` — short (a deep UNC path plus Chromium's
 * `.crswap` sibling must stay under 260 characters, see
 * distributionEventStore's SHORT NAMES note) and lexicographically
 * time-ordered (the sync probe samples the TAIL of the name-sorted listing, so
 * the sample has to be the newest threads).
 */
export function newFeedbackThreadId(now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[-:T.]/g, "").slice(0, 14);
  const random = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  return `t${stamp}-${random}`;
}

export async function loadThread(
  dir: DirectoryHandleLike,
  threadId: string
): Promise<FeedbackThread | null> {
  let threadsDir: DirectoryHandleLike;
  try {
    threadsDir = await getFeedbackThreadsDir(dir, false);
  } catch {
    return null;
  }
  const result = await safeReadJson<FeedbackThread>(
    threadsDir,
    feedbackThreadFileName(threadId)
  );
  return result.ok && typeof result.value.id === "string" ? normalizeThread(result.value) : null;
}

/**
 * Bounded-concurrency read of an explicit id list — the list view's page load.
 * `readNamedJsonFiles` is the shared core `readJsonDirectory` uses, so this
 * costs no directory listing and reads exactly the named files, at
 * DIRECTORY_READ_CONCURRENCY in flight. Input order is preserved; an
 * unreadable/absent id is skipped rather than aborting the page ("skip", not
 * "throw": one corrupt thread must not blank the whole panel).
 */
export async function loadThreads(
  dir: DirectoryHandleLike,
  threadIds: readonly string[]
): Promise<FeedbackThread[]> {
  if (threadIds.length === 0) return [];
  let threadsDir: DirectoryHandleLike;
  try {
    threadsDir = await getFeedbackThreadsDir(dir, false);
  } catch {
    return [];
  }
  const { values } = await readNamedJsonFiles<FeedbackThread>(
    threadsDir,
    threadIds.map(feedbackThreadFileName),
    { onUnreadable: "skip" }
  );
  return values.filter((value) => typeof value.id === "string").map(normalizeThread);
}

/** Defensive: a hand-edited or partially-written thread must never crash a render. */
function normalizeThread(value: FeedbackThread): FeedbackThread {
  return {
    ...value,
    status: value.status === "resolved" ? "resolved" : "open",
    replies: Array.isArray(value.replies) ? value.replies : [],
  };
}

/** Raw index read, no reconciliation — `listThreadSummaries` (Task 4) is the reconciling reader. */
export async function loadThreadsIndex(
  dir: DirectoryHandleLike
): Promise<FeedbackThreadsIndex> {
  try {
    const feedbackDir = await getFeedbackDir(dir, false);
    const result = await safeReadJson<FeedbackThreadsIndex>(feedbackDir, FEEDBACK_THREADS_INDEX_FILE);
    if (result.ok && Array.isArray(result.value.threads)) {
      return { ...result.value, threads: result.value.threads };
    }
  } catch {
    // No feedback folder yet, or the index is unreadable. Either way the thread
    // files are the authority; an empty index is a safe starting point because
    // listThreadSummaries reconciles against the directory listing.
  }
  return { threads: [] };
}

/**
 * CAS read-modify-write of the shared `threads.index.json`.
 *
 * Same contract as reportDesignStorage's `updateDesignIndex`: the caller's
 * outer `withResourceLock` serializes same-tab writers, casLoop re-reads fresh,
 * bumps `revision`, stamps `_writeToken` and verifies BOTH on read-back so a
 * concurrent writer on another machine is never silently dropped.
 *
 * WHAT CHANGED vs. the old `mutateFeedback`: this file is now touched only on
 * thread CREATE and on a STATUS CHANGE — never on a reply — and it carries no
 * message bodies, so it stays small and rarely written. The old shared log was
 * rewritten in full by every submit AND every reply, which is what exhausted
 * the ladder (XQ-IO-032).
 *
 * No delayed verify: this is a rebuildable cache (see FeedbackThreadsIndex).
 * A lost index update self-heals on the next `listThreadSummaries`, which
 * reconciles against the thread-file listing. The durable content lives in the
 * per-thread file, which is written before this runs.
 */
async function updateThreadsIndex(
  dir: DirectoryHandleLike,
  apply: (threads: FeedbackThreadSummary[]) => FeedbackThreadSummary[]
): Promise<void> {
  const feedbackDir = await getFeedbackDir(dir, true);
  // `:index` suffix keeps this outer lock distinct from safeWriteJson's own
  // `${dir.name}/${fileName}` lock -- withResourceLock is not reentrant.
  const outcome = await withResourceLock(`${feedbackDir.name}/${FEEDBACK_THREADS_INDEX_FILE}:index`, () =>
    casLoop<{ ok: true }>(
      async (writeToken) => {
        const existing = await safeReadJson<FeedbackThreadsIndex>(
          feedbackDir,
          FEEDBACK_THREADS_INDEX_FILE
        );
        const current: FeedbackThreadsIndex = existing.ok
          ? { ...existing.value, threads: Array.isArray(existing.value.threads) ? existing.value.threads : [] }
          : { threads: [] };
        const nextRevision = (current.revision ?? 0) + 1;
        const updated: FeedbackThreadsIndex = {
          revision: nextRevision,
          _writeToken: writeToken,
          threads: apply(current.threads),
        };
        await safeWriteJson<FeedbackThreadsIndex>(feedbackDir, FEEDBACK_THREADS_INDEX_FILE, updated);
        const verify = await safeReadJson<FeedbackThreadsIndex>(
          feedbackDir,
          FEEDBACK_THREADS_INDEX_FILE
        );
        if (
          verify.ok &&
          verify.value.revision === nextRevision &&
          verify.value._writeToken === writeToken
        ) {
          return { done: true, result: { ok: true as const } };
        }
        return { done: false };
      },
      { conflictError: "تعذّر تحديث فهرس الملاحظات: تعارض في الكتابة بعد عدة محاولات." }
    )
  );
  if (!outcome.ok) {
    throw new Error(outcome.error);
  }
}

function summarize(thread: FeedbackThread, lastActivityAt: string): FeedbackThreadSummary {
  return {
    threadId: thread.id,
    from: thread.from,
    role: thread.role,
    category: thread.category,
    status: thread.status,
    createdAt: thread.timestamp,
    lastActivityAt,
    preview: feedbackThreadPreview(thread.text),
  };
}

/**
 * Start a new conversation.
 *
 * The thread file is written FIRST and needs NO CAS: its id was just minted and
 * has never existed, so no other writer on any machine can be targeting that
 * name. That is the actual contention fix — under the old shared-log design
 * this same operation rewrote a file every other user was also rewriting.
 *
 * The index append runs second and is best-effort-durable: if it fails after
 * the thread landed, the message is still on disk and `listThreadSummaries`
 * folds it back in (and repairs the index) on the next read. The error is
 * still surfaced so the user is not told a partial save succeeded.
 */
export async function createThread(
  dir: DirectoryHandleLike,
  payload: { from: string; role: string; category: FeedbackCategory; text: string }
): Promise<FeedbackThread> {
  const now = new Date();
  const thread: FeedbackThread = {
    id: newFeedbackThreadId(now),
    from: payload.from,
    role: payload.role,
    category: payload.category,
    text: payload.text,
    timestamp: now.toISOString(),
    status: "open",
    replies: [],
    revision: 1,
  };

  const threadsDir = await getFeedbackThreadsDir(dir, true);
  await safeWriteJson<FeedbackThread>(threadsDir, feedbackThreadFileName(thread.id), thread);

  await updateThreadsIndex(dir, (threads) => [
    ...threads.filter((summary) => summary.threadId !== thread.id),
    summarize(thread, thread.timestamp),
  ]);

  return thread;
}

/**
 * Append a reply to ONE thread — the operation this whole redesign exists for.
 *
 * The CAS loop covers a single conversation file. Two admins replying to
 * DIFFERENT threads write disjoint names and cannot contend at all; two
 * replying to the SAME thread contend on a small file, which is the genuine
 * rare case CAS is for. Under the old shared log every reply rewrote the file
 * every other user was also rewriting, so a busy moment exhausted the ladder
 * and surfaced as XQ-IO-032.
 *
 * The index is touched ONLY when `resolve` actually flips `open -> resolved`.
 * A plain reply leaves the shared file alone — that is what keeps the one
 * remaining shared write rare.
 *
 * A delayed `verify` IS supplied here (unlike the index write): a lost reply is
 * user content, not a rebuildable cache, so the lost-update interleaving
 * (A-read / B-read / A-commit-ok / B-clobbers) must be caught and retried.
 * Same reasoning as reportDesignStorage's `saveDesignFile`.
 */
export async function appendReply(
  dir: DirectoryHandleLike,
  threadId: string,
  reply: FeedbackReply,
  resolve: boolean
): Promise<FeedbackThread> {
  const threadsDir = await getFeedbackThreadsDir(dir, true);
  const fileName = feedbackThreadFileName(threadId);
  let statusChanged = false;

  const outcome = await withResourceLock(`${threadsDir.name}/${fileName}:rmw`, () =>
    casLoop<{ ok: true; thread: FeedbackThread }>(
      async (writeToken) => {
        const existing = await safeReadJson<FeedbackThread>(threadsDir, fileName);
        if (!existing.ok) {
          // Reject, never invent: writing a thread here would fabricate a
          // conversation whose original message nobody wrote.
          throw new Error(`Feedback thread not found: ${threadId}`);
        }
        const current = normalizeThread(existing.value);
        const nextRevision = (current.revision ?? 0) + 1;
        const nextStatus = resolve ? "resolved" : current.status;
        statusChanged = nextStatus !== current.status;
        const updated: FeedbackThread = {
          ...current,
          status: nextStatus,
          replies: [...current.replies, reply],
          revision: nextRevision,
          _writeToken: writeToken,
        };
        await safeWriteJson<FeedbackThread>(threadsDir, fileName, updated);
        const verify = await safeReadJson<FeedbackThread>(threadsDir, fileName);
        if (
          verify.ok &&
          verify.value.revision === nextRevision &&
          verify.value._writeToken === writeToken
        ) {
          return {
            done: true,
            result: { ok: true as const, thread: updated },
            verify: async () => {
              const recheck = await safeReadJson<FeedbackThread>(threadsDir, fileName);
              return (
                recheck.ok &&
                recheck.value.revision === nextRevision &&
                recheck.value._writeToken === writeToken
              );
            },
          };
        }
        return { done: false };
      },
      { conflictError: "تعذّر حفظ الرد: تعارض في الكتابة بعد عدة محاولات." }
    )
  );
  if (!outcome.ok) {
    throw new Error(outcome.error);
  }

  if (statusChanged) {
    await updateThreadsIndex(dir, (threads) =>
      threads.map((summary) =>
        summary.threadId === threadId
          ? { ...summary, status: outcome.thread.status, lastActivityAt: reply.timestamp }
          : summary
      )
    );
  }

  return outcome.thread;
}

/**
 * Every thread's summary, newest-first.
 *
 * The index is a CACHE and is treated as one: one names-only
 * `listDirectoryEntries` over `threads/` (a single round trip, no file content
 * read) reconciles it. Any `.json` name the index does not know is read
 * individually and folded in, and the repaired index is written back
 * best-effort. That is what makes a create that lost the index race, a
 * half-finished migration, and a hand-copied thread file all self-healing
 * rather than invisible.
 *
 * Steady state cost: 1 index read + 1 listing + 0 thread reads.
 *
 * Ordered by `createdAt`, NOT `lastActivityAt` — see FeedbackThreadSummary:
 * a plain reply deliberately does not touch the index, so `lastActivityAt` is
 * advisory and must never drive ordering.
 */
export async function listThreadSummaries(
  dir: DirectoryHandleLike
): Promise<FeedbackThreadSummary[]> {
  await ensureMigrated(dir);
  const index = await loadThreadsIndex(dir);
  const known = new Map(index.threads.map((summary) => [summary.threadId, summary]));

  let threadsDir: DirectoryHandleLike | null = null;
  try {
    threadsDir = await getFeedbackThreadsDir(dir, false);
  } catch {
    // No threads folder yet: a brand-new workspace, or one whose feedback has
    // not been migrated. Either way the index is all there is to report.
  }

  const missingIds: string[] = [];
  if (threadsDir) {
    for (const entry of await listDirectoryEntries(threadsDir)) {
      if (entry.kind !== "file") continue;
      if (!entry.name.endsWith(FEEDBACK_THREAD_FILE_SUFFIX)) continue;
      const threadId = entry.name.slice(0, -FEEDBACK_THREAD_FILE_SUFFIX.length);
      // safeWriteJson keeps `{file}.bak`/`.tmp` siblings; their stems end in
      // `.json`/`.tmp` and must never be mistaken for a thread.
      if (!THREAD_ID_PATTERN.test(threadId) || threadId.endsWith(".json")) continue;
      if (!known.has(threadId)) missingIds.push(threadId);
    }
  }

  if (missingIds.length > 0) {
    const recovered = await loadThreads(dir, missingIds);
    for (const thread of recovered) {
      known.set(thread.id, summarize(thread, lastActivityOf(thread)));
    }
    if (recovered.length > 0) {
      try {
        const repaired = [...known.values()];
        await updateThreadsIndex(dir, () => repaired);
      } catch (error) {
        // Best effort: a read-only handle, or a lost race with a live writer.
        // The summaries returned below are already correct either way; the
        // repair simply retries on the next read.
        logError("feedback:repairThreadsIndex", error);
      }
    }
  }

  return [...known.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function lastActivityOf(thread: FeedbackThread): string {
  let latest = thread.timestamp;
  for (const reply of thread.replies) {
    if (reply.timestamp > latest) latest = reply.timestamp;
  }
  return latest;
}

/**
 * On-disk shape for the LEGACY `messages.json`. The list is wrapped so it can
 * carry the CAS bookkeeping (`revision` + `_writeToken`) that let casLoop
 * detect a concurrent write from another machine; older files persisted the
 * bare `FeedbackMessage[]` directly — `loadFeedbackFile` still reads that shape.
 *
 * READ-ONLY as of v116.0. Nothing writes this file any more: feedback lives in
 * `5-system/feedback/threads/{threadId}.json`, one file per conversation, and
 * `migrateLegacyMessages` copies out of here exactly once and leaves the
 * original untouched forever.
 */
type FeedbackFile = {
  revision?: number;
  _writeToken?: string;
  messages: FeedbackMessage[];
};

/** Also probed by `workspaceSync` for the `feedback` refresh family. */
export const FEEDBACK_MESSAGES_FILE = "messages.json";
const MESSAGES_FILE = FEEDBACK_MESSAGES_FILE;

function normalizeFeedbackFile(value: FeedbackFile | FeedbackMessage[]): FeedbackFile {
  // Legacy shape: a bare array of messages with no revision wrapper.
  if (Array.isArray(value)) {
    return { messages: value };
  }
  return {
    revision: value.revision ?? 0,
    _writeToken: value._writeToken,
    messages: Array.isArray(value.messages) ? value.messages : [],
  };
}

async function loadFeedbackFile(dir: DirectoryHandleLike): Promise<FeedbackFile> {
  try {
    const feedbackDir = await getFeedbackDir(dir, false);
    const result = await safeReadJson<FeedbackFile | FeedbackMessage[]>(feedbackDir, MESSAGES_FILE);
    if (result.ok) {
      return normalizeFeedbackFile(result.value);
    }
  } catch {
    // New location missing/unreadable — fall through to the legacy root path.
  }
  try {
    const legacyDir = await getLegacyFeedbackDir(dir);
    const result = await safeReadJson<FeedbackFile | FeedbackMessage[]>(legacyDir, MESSAGES_FILE);
    if (result.ok) {
      return normalizeFeedbackFile(result.value);
    }
  } catch {
    // No legacy file either — treat as an empty log.
  }
  return { messages: [] };
}

/**
 * Every message, newest-first — the FULL aggregate.
 *
 * This is the ONE remaining read that opens every thread file, and it exists
 * for `FeedbackUnreadProvider`: `countUnreadFeedback` needs each individual
 * reply's author and timestamp, which the summaries deliberately do not carry.
 * The widget's LIST view must not call this — it uses `listThreadSummaries`
 * plus a page-scoped `loadThreads`.
 *
 * Cost note (a trade, not an oversight): one large file read becomes N small
 * ones at DIRECTORY_READ_CONCURRENCY. Same bytes, more round trips. The read
 * path was never the reported failure — the shared WRITE was (XQ-IO-032).
 *
 * Falls back to the legacy log whenever migration could not run (read-only
 * grant) or has not run yet, so no reader ever sees an empty panel over a
 * workspace that has data.
 */
export async function loadFeedback(dir: DirectoryHandleLike): Promise<FeedbackMessage[]> {
  const summaries = await listThreadSummaries(dir);
  if (summaries.length === 0) {
    return [...(await loadFeedbackFile(dir)).messages].sort((a, b) =>
      b.timestamp.localeCompare(a.timestamp)
    );
  }
  const threads = await loadThreads(dir, summaries.map((summary) => summary.threadId));
  return threads.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

/**
 * ONE-TIME, LAZY split of a legacy `messages.json` into per-thread files.
 *
 * Runs from the read path (loadFeedback / listThreadSummaries) the first time a
 * workspace with legacy data is opened by a client that speaks the new layout.
 * There is no mount hook and no timer: a workspace nobody opens is never
 * touched.
 *
 * THE LEGACY FILE IS NEVER WRITTEN, MOVED OR DELETED — at either location. It
 * stays readable forever, which is CLAUDE.md's permanent-fallback rule and the
 * whole rollback story: remove `threads/` + `threads.index.json` and a
 * downgraded client resumes on `messages.json` exactly as it was.
 *
 * IDEMPOTENT BY CONSTRUCTION: each thread file is keyed by the legacy
 * message's own `id`, so a second client running this concurrently writes
 * byte-identical content to identical names. The index write is a casLoop, so
 * one wins and the other retries against fresh state.
 *
 * NEVER migrates on top of an already-migrated workspace: legacy content that
 * a later state deliberately superseded must not be resurrected.
 */
export async function migrateLegacyMessages(
  dir: DirectoryHandleLike
): Promise<{ migrated: number; skipped: "already-migrated" | "no-legacy-data" | null }> {
  if (await hasAnyThreadFile(dir)) {
    return { migrated: 0, skipped: "already-migrated" };
  }
  const legacy = await loadFeedbackFile(dir);
  if (legacy.messages.length === 0) {
    return { migrated: 0, skipped: "no-legacy-data" };
  }

  const threadsDir = await getFeedbackThreadsDir(dir, true);
  const summaries: FeedbackThreadSummary[] = [];
  for (const message of legacy.messages) {
    const thread: FeedbackThread = {
      ...message,
      status: message.status === "resolved" ? "resolved" : "open",
      replies: Array.isArray(message.replies) ? message.replies : [],
      revision: 1,
    };
    await safeWriteJson<FeedbackThread>(threadsDir, feedbackThreadFileName(thread.id), thread);
    summaries.push(summarize(thread, lastActivityOf(thread)));
  }

  await updateThreadsIndex(dir, (threads) => {
    const merged = new Map(threads.map((summary) => [summary.threadId, summary]));
    for (const summary of summaries) merged.set(summary.threadId, summary);
    return [...merged.values()];
  });

  return { migrated: summaries.length, skipped: null };
}

/** Cheap "has this workspace been migrated?" probe: one names-only listing, no reads. */
async function hasAnyThreadFile(dir: DirectoryHandleLike): Promise<boolean> {
  let threadsDir: DirectoryHandleLike;
  try {
    threadsDir = await getFeedbackThreadsDir(dir, false);
  } catch {
    return false;
  }
  for (const entry of await listDirectoryEntries(threadsDir)) {
    if (entry.kind !== "file") continue;
    if (!entry.name.endsWith(FEEDBACK_THREAD_FILE_SUFFIX)) continue;
    const threadId = entry.name.slice(0, -FEEDBACK_THREAD_FILE_SUFFIX.length);
    if (THREAD_ID_PATTERN.test(threadId) && !threadId.endsWith(".json")) return true;
  }
  return false;
}

/**
 * Best-effort migration, for the read path.
 *
 * A failure here is NEVER fatal: a read-only handle (safeWriteJson throws via
 * assertWritableMode), a revoked grant, a lost race with another client. The
 * caller falls back to the legacy log, so a guest with a read grant still sees
 * the full history instead of an empty panel.
 */
async function ensureMigrated(dir: DirectoryHandleLike): Promise<void> {
  try {
    await migrateLegacyMessages(dir);
  } catch (error) {
    logError("feedback:migrateLegacyMessages", error);
  }
}

/** Compatibility wrapper — the widget, the sync tests and the unread tests all call this name. */
export async function submitFeedback(
  dir: DirectoryHandleLike,
  payload: { from: string; role: string; category: FeedbackCategory; text: string }
): Promise<void> {
  await createThread(dir, payload);
}

/** Compatibility wrapper — the widget, the sync tests and the unread tests all call this name. */
export async function replyToFeedback(
  dir: DirectoryHandleLike,
  messageId: string,
  reply: FeedbackReply,
  resolve: boolean
): Promise<void> {
  await appendReply(dir, messageId, reply, resolve);
}
