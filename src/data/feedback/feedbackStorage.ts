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

/**
 * Raw index read plus the one distinction the plain reader cannot express:
 * whether the empty result means "there is no index" or "the index could not
 * be read".
 *
 * Both used to collapse to `{ threads: [] }`, and the difference matters a
 * great deal downstream. An index that is genuinely absent means every thread
 * file really is unknown, so reconciling them all in is correct. An index that
 * merely could not be read this once means nothing of the sort — yet it
 * produced the same verdict, which turned a single read blip into a read of
 * EVERY thread file plus a full rewrite of the shared index from a
 * reconstruction, i.e. a blind overwrite of a file whose current contents were
 * never seen. That is the opposite of what this repo's read contract requires
 * ("could not read" is never "is not there", see transientFileErrors.ts and
 * readContract.test.ts) and it is amplification precisely when the share is
 * already struggling.
 */
async function readThreadsIndex(
  dir: DirectoryHandleLike
): Promise<{ index: FeedbackThreadsIndex; readable: boolean }> {
  let feedbackDir: DirectoryHandleLike;
  try {
    feedbackDir = await getFeedbackDir(dir, false);
  } catch {
    // No feedback folder yet — a brand-new workspace. Genuinely absent.
    return { index: { threads: [] }, readable: true };
  }
  try {
    const result = await safeReadJson<FeedbackThreadsIndex>(feedbackDir, FEEDBACK_THREADS_INDEX_FILE);
    if (result.ok && Array.isArray(result.value.threads)) {
      return { index: { ...result.value, threads: result.value.threads }, readable: true };
    }
    // `missing` is absence; `corrupt` is a file that exists but cannot be
    // trusted — and a corrupt index must not be rewritten from a guess either.
    return { index: { threads: [] }, readable: result.ok || result.reason === "missing" };
  } catch {
    // A THROW is never absence — see this function's doc.
    return { index: { threads: [] }, readable: false };
  }
}

/** Raw index read, no reconciliation — `listThreadSummaries` (Task 4) is the reconciling reader. */
export async function loadThreadsIndex(
  dir: DirectoryHandleLike
): Promise<FeedbackThreadsIndex> {
  return (await readThreadsIndex(dir)).index;
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
      {
        context: "feedback:threadsIndex",
        // A REBUILDABLE CACHE does not warrant the 10 × 200 ms ladder casLoop
        // defaults to for user content — that ladder is ~2 s of one machine
        // holding the single most contended file in the workspace while every
        // other machine waits for it. Every caller is now best-effort
        // (`createThread`, `appendReply`) or reconciled on read
        // (`listThreadSummaries`), so nothing durable rides on winning. Matches
        // the derived-cache precedent in distributionStorage and the shared-file
        // appenders in actionLog / errorLog / notifications.
        maxRetries: 3,
        baseDelayMs: 100,
        conflictError: "تعذّر تحديث فهرس الملاحظات: تعارض في الكتابة بعد عدة محاولات.",
        // The RAW cause, not just the Arabic sentence the catch sites keep. The
        // incident's feedback entries were Arabic-only and could not be tied to
        // a platform condition at all until they were paired with
        // `casLoop:exhausted` rows by timestamp.
        onExhausted: (cause, code) => {
          logError(
            "feedback:threads-index-write",
            cause instanceof Error ? cause : new Error(String(cause)),
            { action: "threads-index-write", errorCode: code }
          );
        },
      }
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
 * The index append runs second and is genuinely best-effort: if it fails after
 * the thread landed, the message IS on disk, and `listThreadSummaries`
 * reconciles it back in on the next read whether or not the index is ever
 * repaired.
 *
 * So its failure must not fail this call. It used to, and the result was the
 * worst possible report: the user's message was durably written, and they were
 * told the save had failed — which invites them to send it again, producing a
 * duplicate thread. A rebuildable cache is exactly the thing whose write is
 * allowed to lose. The failure is recorded in the error log instead, where it
 * belongs, so the condition is still visible without being handed to the user
 * as a lie about their own data.
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

  try {
    await updateThreadsIndex(dir, (threads) => [
      ...threads.filter((summary) => summary.threadId !== thread.id),
      summarize(thread, thread.timestamp),
    ]);
  } catch (error) {
    logError("feedback:createThreadIndex", error);
  }

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
      { context: "feedback:threadReply", conflictError: "تعذّر حفظ الرد: تعارض في الكتابة بعد عدة محاولات." }
    )
  );
  if (!outcome.ok) {
    throw new Error(outcome.error);
  }

  if (statusChanged) {
    try {
      await updateThreadsIndex(dir, (threads) =>
        threads.map((summary) =>
          summary.threadId === threadId
            ? { ...summary, status: outcome.thread.status, lastActivityAt: reply.timestamp }
            : summary
        )
      );
    } catch (error) {
      // The reply AND the status flip are already durable in the thread file,
      // verified above. This is the same rebuildable-cache write `createThread`
      // treats as best-effort, and for the same reason: throwing here told the
      // user their reply had failed AFTER it provably landed — the false-failure
      // shape of the 2026-08-25 incident — which invites them to send it again.
      //
      // The cost of losing this write, stated plainly so it is a contract and
      // not an accident: the panel's summary row can show a stale status chip
      // until the next successful index write. The repair path does not heal
      // that, because it only folds in ids the index does not know — it never
      // re-reads a thread the index already lists. The thread itself is correct
      // the moment anyone opens it.
      logError("feedback:statusIndex", error);
    }
  }

  return outcome.thread;
}

/**
 * How long a failed index repair suppresses the next attempt, per tab.
 *
 * The repair is a write, and the condition it repairs — the index not knowing a
 * thread file — is not cleared by a repair that FAILS. So a failing repair is
 * rediscovered by the very next read and attempted again, forever, at whatever
 * rate the app happens to read. That is a write storm with no exit, and every
 * machine on the share runs its own copy of it.
 *
 * Longer than the 60 s `FeedbackUnreadProvider` poll and the 45 s `SyncTick`, so
 * a share that is genuinely busy is left alone for a while rather than being
 * hammered by every client at once. The window is per-tab and in-memory: a
 * reload retries immediately, which is the right behaviour for a user actively
 * trying to fix something.
 */
const INDEX_REPAIR_COOLDOWN_MS = 5 * 60_000;

/**
 * Per-workspace-handle repair state. A WeakMap so a workspace the user has
 * disconnected takes its entry with it.
 */
const indexRepairState = new WeakMap<
  DirectoryHandleLike,
  { blockedUntil: number; reported: boolean }
>();

/** @internal — test-only. Forget the cooldown so a test can retry immediately. */
export function __resetIndexRepairCooldownForTests(dir: DirectoryHandleLike): void {
  indexRepairState.delete(dir);
}

/**
 * Every thread's summary, newest-first.
 *
 * The index is a CACHE and is treated as one: one names-only
 * `listDirectoryEntries` over `threads/` (a single round trip, no file content
 * read) reconciles it. Any `.json` name the index does not know is read
 * individually and folded in. That reconciliation is what makes a create that
 * lost the index race, a half-finished migration, and a hand-copied thread file
 * all visible rather than lost — and it happens ENTIRELY IN MEMORY. The
 * returned summaries are correct whether or not the index on disk is ever
 * repaired.
 *
 * **Writing the repaired index back is opt-in (`repairIndex`), and OFF by
 * default, because this function is on the read path.**
 *
 * It used to always write, which made a read a writer — and this function is
 * reached by `loadFeedback` from `FeedbackUnreadProvider`, which every signed-in
 * user mounts app-wide and polls on mount, on window focus, every 60 s, and on
 * every `feedback` refresh broadcast. So N machines each issued a CAS write to
 * the ONE shared `threads.index.json` on a timer, on every page in the app,
 * whether or not anyone had feedback open. That is how a manager sitting on
 * `reports/kpi` came to be writing a feedback file at all, and why
 * `feedback:repairThreadsIndex` appears in the 2026-08-25 logs beside answer
 * saves that had nothing to do with it.
 *
 * Worse, it could not converge: a repair that fails leaves the index exactly as
 * stale as it found it, so the next poll rediscovers the same missing ids and
 * tries again. Contention on the file therefore SUSTAINED itself, and each
 * failure wrote an error-log entry, which is itself another workspace write.
 *
 * Pass `repairIndex: true` only from a deliberate, user-initiated feedback
 * surface (opening the panel) — never from a poll. Even then the write is
 * best-effort and rate-limited by `INDEX_REPAIR_COOLDOWN_MS`.
 *
 * Steady state cost: 1 index read + 1 listing + 0 thread reads.
 *
 * Ordered by `createdAt`, NOT `lastActivityAt` — see FeedbackThreadSummary:
 * a plain reply deliberately does not touch the index, so `lastActivityAt` is
 * advisory and must never drive ordering.
 */
export async function listThreadSummaries(
  dir: DirectoryHandleLike,
  options?: { repairIndex?: boolean }
): Promise<FeedbackThreadSummary[]> {
  await ensureMigrated(dir);
  const { index, readable } = await readThreadsIndex(dir);
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
    // `readable` gates the WRITE only, never the reconciliation above: the
    // summaries are correct either way. Rewriting an index we could not read
    // would replace whatever it holds with a reconstruction built from a
    // listing — losing any row whose thread file was itself unreadable in the
    // same blip.
    if (recovered.length > 0 && readable && options?.repairIndex === true) {
      const state = indexRepairState.get(dir) ?? { blockedUntil: 0, reported: false };
      if (Date.now() >= state.blockedUntil) {
        try {
          // MERGE, never replace. `updateThreadsIndex` re-reads the index inside
          // its CAS attempt and hands that fresh list to this callback; ignoring
          // it and writing our own snapshot turns a read-modify-write into a
          // blind overwrite, dropping any row another machine added between our
          // read at the top of this function and the CAS re-read. Rows we
          // actually recovered win, because those are the ones we opened the
          // thread files to build.
          const recoveredById = new Map(
            [...known.values()].map((summary) => [summary.threadId, summary])
          );
          await updateThreadsIndex(dir, (current) => {
            const merged = new Map(current.map((summary) => [summary.threadId, summary]));
            for (const [threadId, summary] of recoveredById) merged.set(threadId, summary);
            return [...merged.values()];
          });
          indexRepairState.delete(dir);
        } catch (error) {
          // Best effort: a read-only handle, or a lost race with a live writer.
          // The summaries returned below are already correct either way.
          //
          // Logged ONCE per cooldown, not once per attempt. Every `logError`
          // here reaches the durable per-user error file in
          // `5-system/system-errors/`, i.e. another CAS write to the same share
          // that is already failing — so a chatty failure path makes the
          // condition it is reporting worse, and buries the user's real errors
          // under repeats of a cache miss they cannot act on.
          if (!state.reported) logError("feedback:repairThreadsIndex", error);
          indexRepairState.set(dir, {
            blockedUntil: Date.now() + INDEX_REPAIR_COOLDOWN_MS,
            reported: true,
          });
        }
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
 *
 * PURELY A READ. `FeedbackUnreadProvider` calls this on a 60 s timer, on focus
 * and on every refresh broadcast, for every signed-in user on every page — so
 * it must never write. It therefore does not ask `listThreadSummaries` to
 * repair the index; see that function's own doc for what asking used to cost.
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

/** Archived name for a legacy log this admin has explicitly finalized (see `finalizeLegacyMigration`). */
export const FEEDBACK_MESSAGES_ARCHIVED_FILE = "messages.json.migrated";

/**
 * Rename `messages.json` to `FEEDBACK_MESSAGES_ARCHIVED_FILE` **in one specific
 * directory** — copy the bytes under the new name, then remove the original.
 * Not a move: the File System Access API has no rename, so this is
 * write-then-remove, same technique `copyFileBytes` uses elsewhere.
 *
 * Returns `false` (never throws) when there is nothing to archive here, or the
 * directory handle cannot remove entries (`removeEntry` is optional on
 * `DirectoryHandleLike` — a read-only grant, or a very old browser). The
 * ARCHIVED copy is written before the original is removed, so a failure
 * between those two steps leaves both files present rather than losing data.
 */
async function archiveLegacyMessagesFileAt(dir: DirectoryHandleLike): Promise<boolean> {
  const existing = await safeReadJson<FeedbackFile | FeedbackMessage[]>(dir, MESSAGES_FILE);
  if (!existing.ok) return false;
  if (typeof dir.removeEntry !== "function") return false;
  await safeWriteJson<FeedbackFile>(dir, FEEDBACK_MESSAGES_ARCHIVED_FILE, normalizeFeedbackFile(existing.value));
  await dir.removeEntry(MESSAGES_FILE);
  return true;
}

/**
 * Deliberate, admin-triggered finish to the lazy migration `migrateLegacyMessages`
 * already performs automatically. Where that function copies legacy tickets out
 * and — per CLAUDE.md's permanent-fallback doctrine — never touches the
 * original, this one takes the extra, EXPLICIT step of retiring
 * `messages.json` once every ticket in it is confirmed present in the new
 * per-thread system.
 *
 * ARCHIVES, NEVER DELETES: the legacy content survives under
 * `FEEDBACK_MESSAGES_ARCHIVED_FILE` at whichever location(s) held a live
 * `messages.json`. Nothing reads that archived name — it is a manual-recovery
 * copy an admin could open by hand, not a second fallback path — so this still
 * differs from a hard delete without reintroducing the read-path cost the
 * legacy fallback existed to avoid.
 *
 * Verification-before-archive: this only archives once every legacy message id
 * has a readable thread file. A workspace that cannot confirm that (a partial
 * migration, an unreadable thread) is left exactly as it was — never archived
 * on a guess.
 */
export async function finalizeLegacyMigration(dir: DirectoryHandleLike): Promise<{
  /** Legacy messages copied into `threads/` by THIS call (0 if already migrated earlier). */
  migratedNow: number;
  /** Legacy messages confirmed present as thread files, out of the legacy log's total. */
  verifiedCount: number;
  totalLegacyCount: number;
  archived: boolean;
  reason: "no-legacy-data" | "verification-failed" | "remove-unsupported" | null;
}> {
  // Best-effort, like `ensureMigrated`: a write-denied workspace (read-only
  // grant) must fall through to verification below and report
  // "verification-failed" — never throw and abort the whole admin action —
  // because verification against whatever thread files DO already exist is
  // still the correct, informative answer.
  let migration: { migrated: number };
  try {
    migration = await migrateLegacyMessages(dir);
  } catch (error) {
    logError("feedback:finalizeLegacyMigration:migrate", error);
    migration = { migrated: 0 };
  }

  const legacy = await loadFeedbackFile(dir);
  if (legacy.messages.length === 0) {
    return {
      migratedNow: migration.migrated,
      verifiedCount: 0,
      totalLegacyCount: 0,
      archived: false,
      reason: "no-legacy-data",
    };
  }

  const legacyIds = legacy.messages.map((message) => message.id);
  let threadsDir: DirectoryHandleLike | null = null;
  try {
    threadsDir = await getFeedbackThreadsDir(dir, false);
  } catch {
    // No threads/ folder at all — e.g. migration above could not write it.
    // Every legacy id is therefore unverified, handled below.
  }
  const { values } = threadsDir
    ? await readNamedJsonFiles<FeedbackThread>(
        threadsDir,
        legacyIds.map(feedbackThreadFileName),
        { onUnreadable: "skip" }
      )
    : { values: [] as FeedbackThread[] };
  const verifiedIds = new Set(values.map((thread) => thread.id));
  const verifiedCount = legacyIds.filter((id) => verifiedIds.has(id)).length;

  if (verifiedCount !== legacyIds.length) {
    return {
      migratedNow: migration.migrated,
      verifiedCount,
      totalLegacyCount: legacyIds.length,
      archived: false,
      reason: "verification-failed",
    };
  }

  let archived = false;
  try {
    const feedbackDir = await getFeedbackDir(dir, true);
    archived = (await archiveLegacyMessagesFileAt(feedbackDir)) || archived;
  } catch (error) {
    logError("feedback:finalizeLegacyMigration:archiveCurrent", error);
  }
  try {
    const legacyDir = await getLegacyFeedbackDir(dir);
    archived = (await archiveLegacyMessagesFileAt(legacyDir)) || archived;
  } catch {
    // No legacy workspace-root folder — nothing to archive there.
  }

  return {
    migratedNow: migration.migrated,
    verifiedCount,
    totalLegacyCount: legacyIds.length,
    archived,
    reason: archived ? null : "remove-unsupported",
  };
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
