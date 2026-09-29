import { useCallback, useEffect, useRef, useState } from "react";

import type { AuthSession } from "../../auth/authTypes";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { logRejection } from "../storage/errorLogger";
import { loadNotifications } from "./notificationStorage";
import {
  getUnacceptedFor,
  isNotificationAudienceRole,
  type AppNotification,
} from "./notificationTypes";
import { subscribeToDataChange } from "../workspace/dataRefreshSignal";

const POLL_INTERVAL_MS = 60_000;

export type WorkspaceNotifications = {
  notifications: AppNotification[];
  /** Notifications this user has not yet accepted. Empty for non-audience roles. */
  unacceptedCount: number;
  reload: () => Promise<void>;
};

/**
 * The app's single broadcast-notification poll.
 *
 * Lifted out of `NotificationBanner` when nav 1b added an unacknowledged-count
 * badge to the sidebar rail: the banner and the badge are two views of the same
 * list, and polling the workspace twice for it would be pure waste. `AppContent`
 * calls this once and passes the result to both. The load/focus/interval/
 * refresh-signal behaviour is carried over from the banner unchanged.
 *
 * Only the must-accept audience (employee/supervisor — see
 * `isNotificationAudienceRole`) has anything to acknowledge, so no read happens
 * at all for admin/manager and the count is 0 for them.
 */
export function useWorkspaceNotifications(
  session: AuthSession,
  directoryHandle: DirectoryHandleLike | null
): WorkspaceNotifications {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  const audience = isNotificationAudienceRole(session.role);
  // Acknowledgements live in per-employee files. Both consumers of this hook —
  // the banner and the sidebar badge — ask only about the signed-in user, so
  // the poll reads HIS ack file rather than fanning out over every employee's.
  const username = session.username;

  // At most one poll in flight per client: a reload requested while one is
  // running coalesces into a single follow-up. Under a saturated share the
  // 60 s poll, the focus event and every broadcast used to queue up behind each other.
  const inFlightRef = useRef(false);
  const againRef = useRef(false);
  // Bumped whenever the workspace or user changes. A loop that started under an older
  // generation may not loop again, clear the shared flags or set state.
  const generationRef = useRef(0);
  const reload = useCallback(async () => {
    if (!directoryHandle || !audience) return;
    if (inFlightRef.current) {
      againRef.current = true;
      return;
    }
    const generation = generationRef.current;
    inFlightRef.current = true;
    try {
      do {
        againRef.current = false;
        try {
          const list = await loadNotifications(directoryHandle, { forUsername: username });
          if (generation === generationRef.current) setNotifications(list);
        } catch {
          // Best-effort: a failed poll just leaves the last-known list in place.
        }
      } while (againRef.current && generation === generationRef.current);
    } finally {
      if (generation === generationRef.current) inFlightRef.current = false;
    }
  }, [directoryHandle, audience, username]);

  useEffect(() => {
    if (!audience || !directoryHandle) return;
    // A different workspace or user starts a NEW generation with a clean slate: the loop
    // still in flight for the old one is fenced off (see `generationRef`).
    generationRef.current += 1;
    const generation = generationRef.current;
    inFlightRef.current = false;
    againRef.current = false;
    // Initial load via promise-chain (not `void reload()`) so setState lands in
    // a `.then` callback, not synchronously in the effect body.
    loadNotifications(directoryHandle, { forUsername: username })
      .then((list) => {
        if (generation === generationRef.current) setNotifications(list);
      })
      .catch(logRejection("workspaceNotifications:loadNotifications"));
    const onFocus = () => void reload();
    window.addEventListener("focus", onFocus);
    // +/-20 % jitter so clients that mounted together do not poll in lockstep.
    let timer: number | undefined;
    let cancelled = false;
    const schedule = () => {
      timer = window.setTimeout(() => {
        if (cancelled) return;
        void reload();
        schedule();
      }, POLL_INTERVAL_MS * (0.8 + Math.random() * 0.4));
    };
    schedule();
    // Also react instantly to the app-wide refresh signal (manual toolbar
    // button, or a sync tick that saw the notifications family move) instead
    // of waiting up to POLL_INTERVAL_MS. Family-scoped: an answer save or a
    // colleague's answer no longer triggers a notifications read; a manual
    // refresh still always does.
    const unsubscribeDataRefresh = subscribeToDataChange(["notifications"], () => void reload());
    return () => {
      // Fence off any loop still in flight for these deps (a change to a null handle or a
      // non-audience role runs no new effect body, so only the cleanup can do it).
      generationRef.current += 1;
      inFlightRef.current = false;
      againRef.current = false;
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
      unsubscribeDataRefresh();
    };
  }, [audience, directoryHandle, reload, username]);

  return {
    notifications,
    unacceptedCount: audience ? getUnacceptedFor(notifications, session.username, session.role).length : 0,
    reload,
  };
}
