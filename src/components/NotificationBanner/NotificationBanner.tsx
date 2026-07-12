import { useCallback, useEffect, useState } from "react";
import { Check, Pin } from "lucide-react";

import type { AuthSession } from "../../auth/authTypes";
import type { DirectoryHandleLike } from "../../data/storage/fileSystemAccess";
import { getLabels } from "../../data/labels/labelsStore";
import { useLabels } from "../../data/labels/useLabels";
import {
  acceptNotification,
  loadNotifications,
} from "../../data/notifications/notificationStorage";
import {
  getUnacceptedFor,
  isNotificationAudienceRole,
  type AppNotification,
} from "../../data/notifications/notificationTypes";
import "./NotificationBanner.css";

const POLL_INTERVAL_MS = 60_000;

type Props = {
  session: AuthSession;
  directoryHandle: DirectoryHandleLike | null;
};

/**
 * Persistent app-shell banner that surfaces unaccepted broadcast notifications
 * to the must-accept audience (employee/supervisor). No backend — notifications
 * are polled from the workspace on mount, on window focus, and on a short
 * interval (the plan's accepted refresh model). Self-hides for every other case.
 */
export function NotificationBanner({ session, directoryHandle }: Props) {
  useLabels();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [accepting, setAccepting] = useState(false);

  const audience = isNotificationAudienceRole(session.role);

  const reload = useCallback(async () => {
    if (!directoryHandle || !audience) return;
    try {
      setNotifications(await loadNotifications(directoryHandle));
    } catch {
      // Best-effort: a failed poll just leaves the last-known list in place.
    }
  }, [directoryHandle, audience]);

  useEffect(() => {
    if (!audience || !directoryHandle) return;
    // Initial load via promise-chain (not `void reload()`) so setState lands in
    // a `.then` callback, not synchronously in the effect body.
    loadNotifications(directoryHandle)
      .then(setNotifications)
      .catch(() => {});
    const onFocus = () => void reload();
    window.addEventListener("focus", onFocus);
    const interval = window.setInterval(() => void reload(), POLL_INTERVAL_MS);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.clearInterval(interval);
    };
  }, [audience, directoryHandle, reload]);

  // Hide for non-audience roles or when no workspace is connected.
  if (!audience || !directoryHandle) return null;

  const unaccepted = getUnacceptedFor(notifications, session.username);
  const current = unaccepted[0];
  if (!current) return null;

  const labels = getLabels();
  const remaining = unaccepted.length - 1;

  async function handleAccept() {
    if (accepting || !directoryHandle || !current) return;
    setAccepting(true);
    try {
      await acceptNotification(directoryHandle, current.id, session.username);
      await reload();
    } finally {
      setAccepting(false);
    }
  }

  return (
    <div role="status" dir="rtl" className="app-notification-banner">
      <span className="app-notification-banner-icon" aria-label={labels.notif_banner_aria}>
        <Pin size={16} aria-hidden />
      </span>
      <span className="app-notification-banner-text">{current.message}</span>
      {remaining > 0 && (
        <span className="app-notification-banner-count">
          {labels.notif_banner_more.replace("{count}", String(remaining))}
        </span>
      )}
      <button
        type="button"
        className="app-notification-banner-accept"
        onClick={handleAccept}
        disabled={accepting}
      >
        <Check size={14} aria-hidden /> {labels.notif_accept_btn}
      </button>
    </div>
  );
}
