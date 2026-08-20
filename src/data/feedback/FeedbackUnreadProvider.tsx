import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type { AuthSession } from "../../auth/authTypes";
import { logRejection } from "../storage/errorLogger";
import { useWorkspace } from "../workspace/useWorkspace";
import { subscribeToDataChange } from "../workspace/dataRefreshSignal";
import { loadFeedback, type FeedbackMessage } from "./feedbackStorage";
import {
  countUnreadFeedback,
  markFeedbackSeen,
  readFeedbackSeenAt,
  subscribeToFeedbackSeenChange,
  type FeedbackViewer,
} from "./feedbackUnread";
import { FeedbackUnreadContext, type FeedbackUnreadContextValue } from "./FeedbackUnreadContext";

/** Same cadence as the broadcast-notification poll (useWorkspaceNotifications). */
const POLL_INTERVAL_MS = 60_000;

/**
 * The app's single feedback poll, mounted once in `AuthGate` so BOTH triggers of
 * the widget — the floating button and the admin toolbar's icon, which live on
 * opposite sides of the tree — read one shared count from one shared disk read.
 *
 * Modelled on `useWorkspaceNotifications`: an initial load, a focus listener, a
 * slow interval, plus the app-wide refresh signal so another user's message or
 * reply lights the dot within one sync tick instead of one poll. It subscribes
 * to the `feedback` family only, which `workspaceSync` probes from the log's
 * envelope revision.
 */
export function FeedbackUnreadProvider({
  session,
  children,
}: {
  session: AuthSession;
  children: ReactNode;
}) {
  const { directoryHandle } = useWorkspace();
  const [messages, setMessages] = useState<FeedbackMessage[]>([]);
  // Mirror of the state above, so `markSeen` can read the latest list without
  // taking `messages` as a dependency. A `markSeen` whose identity changed on
  // every poll would re-fire FeedbackWidget's open-panel load effect (which
  // depends on it through `refresh`) once per poll, for no new data.
  const messagesRef = useRef<FeedbackMessage[]>(messages);
  const applyMessages = useCallback((next: FeedbackMessage[]) => {
    messagesRef.current = next;
    setMessages(next);
  }, []);
  // Bumped by the seen-marker broadcast; the marker itself is read from storage
  // during render so a username change needs no state reset of its own.
  const [seenVersion, setSeenVersion] = useState(0);

  const username = session.username;
  const role = session.role;
  const viewer = useMemo<FeedbackViewer>(() => ({ username, role }), [username, role]);
  const seenAt = useMemo(
    () => readFeedbackSeenAt(username),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seenVersion is the invalidation signal for this storage read
    [username, seenVersion]
  );

  const reload = useCallback(async () => {
    if (!directoryHandle) return;
    try {
      applyMessages(await loadFeedback(directoryHandle));
    } catch {
      // Best-effort: a failed poll leaves the last-known list (and dot) in place.
    }
  }, [directoryHandle, applyMessages]);

  useEffect(() => {
    if (!directoryHandle) {
      return;
    }
    // Initial load through a promise chain (not `void reload()`) so setState
    // lands in a `.then` callback rather than synchronously in the effect body.
    loadFeedback(directoryHandle)
      .then(applyMessages)
      .catch(logRejection("feedbackUnread:loadFeedback"));
    const onFocus = () => void reload();
    window.addEventListener("focus", onFocus);
    const interval = window.setInterval(() => void reload(), POLL_INTERVAL_MS);
    const unsubscribe = subscribeToDataChange(["feedback"], () => void reload());
    return () => {
      window.removeEventListener("focus", onFocus);
      window.clearInterval(interval);
      unsubscribe();
    };
  }, [directoryHandle, reload, applyMessages]);

  useEffect(() => subscribeToFeedbackSeenChange(() => setSeenVersion((v) => v + 1)), []);

  const markSeen = useCallback(
    (list?: readonly FeedbackMessage[]) => {
      markFeedbackSeen(list ?? messagesRef.current, viewer);
    },
    [viewer]
  );

  const value = useMemo<FeedbackUnreadContextValue>(
    () => ({
      unreadCount: countUnreadFeedback(messages, viewer, seenAt),
      messages,
      markSeen,
      reload,
    }),
    [messages, viewer, seenAt, markSeen, reload]
  );

  return (
    <FeedbackUnreadContext.Provider value={value}>{children}</FeedbackUnreadContext.Provider>
  );
}
