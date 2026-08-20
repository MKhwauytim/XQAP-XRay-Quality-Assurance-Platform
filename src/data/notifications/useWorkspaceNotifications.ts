import { useCallback, useEffect, useState } from "react";

import type { AuthSession } from "../../auth/authTypes";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { logRejection } from "../storage/errorLogger";
import { loadNotifications } from "./notificationStorage";
import {
  getUnacceptedFor,
  isNotificationAudienceRole,
  type AppNotification,
} from "./notificationTypes";
import { subscribeToDataRefresh } from "../workspace/dataRefreshSignal";

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

  const reload = useCallback(async () => {
    if (!directoryHandle || !audience) return;
    try {
      setNotifications(await loadNotifications(directoryHandle, { forUsername: username }));
    } catch {
      // Best-effort: a failed poll just leaves the last-known list in place.
    }
  }, [directoryHandle, audience, username]);

  useEffect(() => {
    if (!audience || !directoryHandle) return;
    // Initial load via promise-chain (not `void reload()`) so setState lands in
    // a `.then` callback, not synchronously in the effect body.
    loadNotifications(directoryHandle, { forUsername: username })
      .then(setNotifications)
      .catch(logRejection("workspaceNotifications:loadNotifications"));
    const onFocus = () => void reload();
    window.addEventListener("focus", onFocus);
    const interval = window.setInterval(() => void reload(), POLL_INTERVAL_MS);
    // Also react instantly to the app-wide refresh signal (manual toolbar
    // button + the automatic 45s sync run) instead of waiting up to POLL_INTERVAL_MS.
    const unsubscribeDataRefresh = subscribeToDataRefresh(() => void reload());
    return () => {
      window.removeEventListener("focus", onFocus);
      window.clearInterval(interval);
      unsubscribeDataRefresh();
    };
  }, [audience, directoryHandle, reload, username]);

  return {
    notifications,
    unacceptedCount: audience ? getUnacceptedFor(notifications, session.username).length : 0,
    reload,
  };
}
