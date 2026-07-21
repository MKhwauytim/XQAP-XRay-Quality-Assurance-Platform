import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeReadJson, safeWriteJson } from "../storage/safeWrite";
import { casLoop } from "../storage/casLoop";
import { withResourceLock } from "../storage/webLocks";
import { SYSTEM_FOLDER_NAMES } from "../workspace/workspacePaths";

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

const MESSAGES_FILE = "messages.json";

async function getFeedbackDir(dir: DirectoryHandleLike): Promise<DirectoryHandleLike> {
  return dir.getDirectoryHandle(SYSTEM_FOLDER_NAMES.feedback, { create: true });
}

async function loadFeedbackFile(dir: DirectoryHandleLike): Promise<FeedbackFile> {
  try {
    const feedbackDir = await getFeedbackDir(dir);
    const result = await safeReadJson<FeedbackFile | FeedbackMessage[]>(feedbackDir, MESSAGES_FILE);
    if (result.ok) {
      const value = result.value;
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
  } catch {
    // Missing/unreadable file — treat as an empty log.
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
  const feedbackDir = await getFeedbackDir(dir);
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

export async function saveFeedback(
  dir: DirectoryHandleLike,
  messages: FeedbackMessage[]
): Promise<void> {
  // Full replace of the list, but still routed through the CAS protocol so it
  // participates in the same revision/token handshake as submit/reply (a
  // non-participating writer would be invisible to their conflict detection).
  await mutateFeedback(dir, () => messages);
}

export async function submitFeedback(
  dir: DirectoryHandleLike,
  payload: { from: string; role: string; category: FeedbackCategory; text: string }
): Promise<void> {
  await mutateFeedback(dir, (messages) => {
    messages.unshift({
      id: crypto.randomUUID(),
      from: payload.from,
      role: payload.role,
      category: payload.category,
      text: payload.text,
      timestamp: new Date().toISOString(),
      status: "open",
      replies: [],
    });
    return messages;
  });
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
