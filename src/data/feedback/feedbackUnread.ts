/**
 * Unread bookkeeping for the feedback ("chat") widget.
 *
 * The feedback log itself (`5-system/feedback/messages.json`) is shared by every
 * user on every machine and carries no per-user read state — adding one would
 * mean every reader writing to a file only writers touch today, on a UNC/SMB
 * share, under CAS. Read state is therefore PER BROWSER, in `localStorage`: one
 * ISO timestamp per username marking the newest inbound activity that user has
 * already looked at. Losing it re-shows the dot once; nothing on disk is at risk.
 *
 * "Inbound" is deliberately asymmetric, because the two sides of this widget see
 * different things:
 * - a manager/admin sees every message and every reply somebody else wrote —
 *   that is the inbox they are expected to answer;
 * - everyone else sees only replies on THEIR OWN messages — a colleague's
 *   unrelated message is not their business.
 *
 * A user's own messages and replies are never unread to themselves.
 */
import type { AuthRole } from "../../auth/authTypes";
import { logError } from "../storage/errorLogger";
import type { FeedbackMessage } from "./feedbackStorage";

const SEEN_KEY_PREFIX = "xray_feedback_seen_v1:";
const SEEN_CHANGE_EVENT = "xray-feedback-seen-change";

/** Roles that manage the feedback inbox (see FeedbackWidget's manager view). */
const MANAGE_ROLES: readonly AuthRole[] = ["manager", "admin"];

export type FeedbackViewer = { username: string; role: AuthRole };

export function canManageFeedback(role: AuthRole): boolean {
  return MANAGE_ROLES.includes(role);
}

/** One inbound item — a message or a reply somebody else wrote for this viewer. */
export type FeedbackActivity = { from: string; timestamp: string };

/**
 * Every item that counts as "someone wrote to me", newest-first order not
 * guaranteed (callers compare timestamps, they never rely on position).
 */
export function listInboundActivity(
  messages: readonly FeedbackMessage[],
  viewer: FeedbackViewer
): FeedbackActivity[] {
  const manages = canManageFeedback(viewer.role);
  const inbound: FeedbackActivity[] = [];
  for (const message of messages) {
    const mine = message.from === viewer.username;
    // A non-manager only ever hears back on their own threads.
    if (!manages && !mine) continue;
    if (!mine) inbound.push({ from: message.from, timestamp: message.timestamp });
    for (const reply of message.replies ?? []) {
      if (reply.from === viewer.username) continue;
      inbound.push({ from: reply.from, timestamp: reply.timestamp });
    }
  }
  return inbound;
}

function parsed(timestamp: string): number | null {
  const value = Date.parse(timestamp);
  return Number.isNaN(value) ? null : value;
}

/**
 * How many inbound items landed after `seenAt`.
 *
 * `seenAt === null` (nothing ever marked seen on this browser) means EVERY
 * inbound item is unread — a manager who has never opened the widget should see
 * the dot for the messages already waiting, not a clean slate.
 */
export function countUnreadFeedback(
  messages: readonly FeedbackMessage[],
  viewer: FeedbackViewer,
  seenAt: string | null
): number {
  const seen = seenAt === null ? null : parsed(seenAt);
  return listInboundActivity(messages, viewer).filter((activity) => {
    if (seen === null) return true;
    const at = parsed(activity.timestamp);
    // An unparsable timestamp can never be shown to be newer than the marker.
    return at !== null && at > seen;
  }).length;
}

/** The newest inbound timestamp, or null when nothing is inbound at all. */
export function latestInboundTimestamp(
  messages: readonly FeedbackMessage[],
  viewer: FeedbackViewer
): string | null {
  let bestValue: number | null = null;
  let best: string | null = null;
  for (const activity of listInboundActivity(messages, viewer)) {
    const at = parsed(activity.timestamp);
    if (at === null) continue;
    if (bestValue === null || at > bestValue) {
      bestValue = at;
      best = activity.timestamp;
    }
  }
  return best;
}

export function readFeedbackSeenAt(username: string): string | null {
  try {
    return localStorage.getItem(`${SEEN_KEY_PREFIX}${username}`);
  } catch {
    // Storage unavailable (private mode, quota): behave as "nothing seen yet".
    return null;
  }
}

function writeFeedbackSeenAt(username: string, timestamp: string): void {
  try {
    localStorage.setItem(`${SEEN_KEY_PREFIX}${username}`, timestamp);
  } catch (error) {
    // A dot that stays lit is a cosmetic loss, never a reason to throw at a
    // user who just opened a panel.
    logError("feedbackUnread:writeSeen", error);
    return;
  }
  window.dispatchEvent(new CustomEvent(SEEN_CHANGE_EVENT));
}

/**
 * Mark everything currently inbound as seen.
 *
 * The marker is the newest inbound timestamp in `messages`, NOT `Date.now()`:
 * these timestamps are written by other machines whose clocks can run ahead, and
 * a "now" marker would leave such an item permanently unread. Older than the
 * stored marker ⇒ nothing is written, so a stale list can never un-see newer
 * activity.
 *
 * Returns true when the marker actually moved.
 */
export function markFeedbackSeen(
  messages: readonly FeedbackMessage[],
  viewer: FeedbackViewer
): boolean {
  const latest = latestInboundTimestamp(messages, viewer);
  if (latest === null) return false;
  const current = readFeedbackSeenAt(viewer.username);
  const currentValue = current === null ? null : parsed(current);
  const latestValue = parsed(latest);
  if (latestValue === null) return false;
  if (currentValue !== null && currentValue >= latestValue) return false;
  writeFeedbackSeenAt(viewer.username, latest);
  return true;
}

/** Fires whenever any component in this tab moves the seen marker. */
export function subscribeToFeedbackSeenChange(listener: () => void): () => void {
  const handler = () => listener();
  window.addEventListener(SEEN_CHANGE_EVENT, handler);
  return () => window.removeEventListener(SEEN_CHANGE_EVENT, handler);
}
