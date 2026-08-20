import { useState } from "react";
import { Check, Pin } from "lucide-react";

import type { AuthSession } from "../../auth/authTypes";
import type { DirectoryHandleLike } from "../../data/storage/fileSystemAccess";
import { getLabels } from "../../data/labels/labelsStore";
import { useLabels } from "../../data/labels/useLabels";
import { acceptNotification } from "../../data/notifications/notificationStorage";
import {
  getUnacceptedFor,
  shouldShowBanner,
  type AppNotification,
} from "../../data/notifications/notificationTypes";
import "./NotificationBanner.css";

type Props = {
  session: AuthSession;
  directoryHandle: DirectoryHandleLike | null;
  /**
   * The notification list and its reloader, owned by `AppContent` via
   * `useWorkspaceNotifications` — the app's single poll. The sidebar's
   * unacknowledged badge reads the same list, so this component no longer
   * fetches it itself.
   */
  notifications: AppNotification[];
  onReload: () => Promise<void>;
};

/**
 * Persistent app-shell banner that surfaces unaccepted broadcast notifications
 * to the must-accept audience (employee/supervisor). No backend — notifications
 * are polled from the workspace on mount, on window focus, and on a short
 * interval (the plan's accepted refresh model). Self-hides for every other case.
 */
export function NotificationBanner({
  session,
  directoryHandle,
  notifications,
  onReload,
}: Props) {
  useLabels();
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);

  // Hide when no workspace is connected, or when the shared audience+acceptance
  // rule (notificationTypes.shouldShowBanner) says this user has nothing
  // outstanding to acknowledge.
  if (!directoryHandle || !shouldShowBanner(session.role, session.username, notifications)) {
    return null;
  }

  const unaccepted = getUnacceptedFor(notifications, session.username, session.role);
  const current = unaccepted[0];
  if (!current) return null;

  const labels = getLabels();
  const remaining = unaccepted.length - 1;

  async function handleAccept() {
    if (accepting || !directoryHandle || !current) return;
    setAccepting(true);
    setAcceptError(null);
    try {
      // B6: surface a CAS write conflict instead of dropping the acknowledgement.
      const result = await acceptNotification(directoryHandle, current.id, session.username);
      if (result.ok) {
        await onReload();
      } else {
        setAcceptError(result.error);
      }
    } catch (err) {
      setAcceptError(err instanceof Error ? err.message : "تعذّر حفظ الاطّلاع — أعد المحاولة.");
    } finally {
      setAccepting(false);
    }
  }

  return (
    <div role="status" dir="rtl" className="app-notification-banner">
      <span className="app-notification-banner-icon" aria-label={labels.notif_banner_aria}>
        <Pin size={16} aria-hidden />
      </span>
      <span className="app-notification-banner-text" title={current.message}>
        {current.message}
      </span>
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
      {acceptError && (
        <span className="app-notification-banner-error" role="alert">
          {acceptError}
        </span>
      )}
    </div>
  );
}
