import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { readJsonFile, writeJsonFile } from "../storage/fileSystemAccess";

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

const FEEDBACK_FOLDER = "feedback";
const MESSAGES_FILE = "messages.json";

async function getFeedbackDir(dir: DirectoryHandleLike): Promise<DirectoryHandleLike> {
  return dir.getDirectoryHandle(FEEDBACK_FOLDER, { create: true });
}

export async function loadFeedback(dir: DirectoryHandleLike): Promise<FeedbackMessage[]> {
  try {
    const feedbackDir = await getFeedbackDir(dir);
    const result = await readJsonFile<FeedbackMessage[]>(feedbackDir, MESSAGES_FILE);
    return result.ok ? result.file : [];
  } catch {
    return [];
  }
}

export async function saveFeedback(dir: DirectoryHandleLike, messages: FeedbackMessage[]): Promise<void> {
  const feedbackDir = await getFeedbackDir(dir);
  await writeJsonFile(feedbackDir, MESSAGES_FILE, messages);
}

export async function submitFeedback(
  dir: DirectoryHandleLike,
  payload: { from: string; role: string; category: FeedbackCategory; text: string }
): Promise<void> {
  const messages = await loadFeedback(dir);
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
  await saveFeedback(dir, messages);
}

export async function replyToFeedback(
  dir: DirectoryHandleLike,
  messageId: string,
  reply: FeedbackReply,
  resolve: boolean
): Promise<void> {
  const messages = await loadFeedback(dir);
  const msg = messages.find((m) => m.id === messageId);
  if (!msg) return;
  msg.replies.push(reply);
  if (resolve) msg.status = "resolved";
  await saveFeedback(dir, messages);
}
