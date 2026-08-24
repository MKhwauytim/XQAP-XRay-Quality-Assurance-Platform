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
 * On-disk shape for `messages.json`. The list is wrapped so it can carry the CAS
 * bookkeeping (`revision` + `_writeToken`) that lets casLoop detect a concurrent
 * write from another machine. Legacy files persisted the bare `FeedbackMessage[]`
 * directly — `loadFeedbackFile` still reads that shape.
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

export async function loadFeedback(dir: DirectoryHandleLike): Promise<FeedbackMessage[]> {
  return (await loadFeedbackFile(dir)).messages;
}

/**
 * Read-modify-write the shared feedback log under a CAS retry loop.
 *
 * `5-system/feedback/messages.json` is appended to by any user on any machine.
 * The `:rmw` outer `withResourceLock` serializes same-tab writers; `casLoop`
 * re-reads fresh state each attempt, bumps `revision`, stamps `_writeToken`, and
 * verifies BOTH on read-back so a concurrent write from another machine is never
 * silently dropped. Same RMW-append contract as
 * `approvalStorage.appendDecisionEvent`.
 *
 * No delayed verify: feedback messages are low-stakes user input (not
 * business-critical RMW data) — a rare lost update means at most a
 * re-submission, not data corruption. See docs/edit logs/2026-07-14.md v55.2.
 */
async function mutateFeedback(
  dir: DirectoryHandleLike,
  mutate: (messages: FeedbackMessage[]) => FeedbackMessage[]
): Promise<void> {
  // Writes always go to the new `5-system/feedback/` location, even when the
  // current data was read back from the legacy root `feedback/` — the first
  // mutation after this change effectively migrates a workspace's feedback
  // log forward without ever touching (or deleting) the legacy file.
  const feedbackDir = await getFeedbackDir(dir, true);
  // `:rmw` suffix keeps this outer lock distinct from safeWriteJson's internal
  // `${dir.name}/${fileName}` lock (withResourceLock is not reentrant).
  const outcome = await withResourceLock(`${feedbackDir.name}/${MESSAGES_FILE}:rmw`, () =>
    casLoop<{ ok: true }>(
      async (writeToken) => {
        const current = await loadFeedbackFile(dir);
        const nextRevision = (current.revision ?? 0) + 1;
        const messages = mutate([...current.messages]);
        const updated: FeedbackFile = {
          revision: nextRevision,
          _writeToken: writeToken,
          messages,
        };
        await safeWriteJson<FeedbackFile>(feedbackDir, MESSAGES_FILE, updated);
        const verify = await loadFeedbackFile(dir);
        if (verify.revision === nextRevision && verify._writeToken === writeToken) {
          return { done: true, result: { ok: true as const } };
        }
        return { done: false };
      },
      { conflictError: "تعذّر حفظ الملاحظات: تعارض في الكتابة بعد عدة محاولات." }
    )
  );
  if (!outcome.ok) {
    throw new Error(outcome.error);
  }
}

/** Compatibility wrapper — the widget, the sync tests and the unread tests all call this name. */
export async function submitFeedback(
  dir: DirectoryHandleLike,
  payload: { from: string; role: string; category: FeedbackCategory; text: string }
): Promise<void> {
  await createThread(dir, payload);
}

export async function replyToFeedback(
  dir: DirectoryHandleLike,
  messageId: string,
  reply: FeedbackReply,
  resolve: boolean
): Promise<void> {
  await mutateFeedback(dir, (messages) => {
    const msg = messages.find((m) => m.id === messageId);
    if (msg) {
      msg.replies.push(reply);
      if (resolve) msg.status = "resolved";
    }
    return messages;
  });
}
