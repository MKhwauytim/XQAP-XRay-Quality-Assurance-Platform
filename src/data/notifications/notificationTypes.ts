import type { AuthRole } from "../../auth/authTypes";

/** One person's acknowledgement of a notification. */
export type NotificationAcceptance = {
  username: string;
  /** ISO timestamp of when this user pressed "قبول". */
  acceptedAt: string;
};

/**
 * A workspace-wide broadcast notification posted by an admin/manager.
 *
 * Named `AppNotification` (not `Notification`) to avoid shadowing the DOM
 * `Notification` global.
 */
export type AppNotification = {
  id: string;
  /** Arabic body text shown in the banner + manager view. */
  message: string;
  /** Username of the admin/manager who posted it. */
  postedBy: string;
  /** ISO timestamp of when it was posted. */
  postedAt: string;
  /** One entry per user who has accepted; absence = not yet accepted. */
  acceptances: NotificationAcceptance[];
};

/**
 * On-disk shape of `5-system/notifications/notifications.json`.
 * `revision` + `_writeToken` drive the cross-machine CAS loop (see
 * `notificationStorage.ts`), mirroring `audit/actionLog.ts`.
 */
export type NotificationsFile = {
  revision: number;
  /** Per-write UUID embedded by casLoop for cross-machine race detection. */
  _writeToken?: string;
  updatedAt: string;
  notifications: AppNotification[];
};

/**
 * Roles that must READ + ACCEPT notifications (they see the acknowledgement
 * banner). Admin/manager post and monitor acceptance but never "accept", so
 * they are deliberately excluded here.
 */
export function isNotificationAudienceRole(role: AuthRole): boolean {
  return role === "employee" || role === "supervisor";
}

/** True if `username` already appears in the notification's acceptance list. */
export function hasAccepted(
  notification: AppNotification,
  username: string
): boolean {
  return notification.acceptances.some((a) => a.username === username);
}

/**
 * Notifications the given user has NOT yet accepted, oldest first (the banner
 * shows the oldest outstanding notification first, one at a time).
 */
export function getUnacceptedFor(
  notifications: AppNotification[],
  username: string
): AppNotification[] {
  return notifications
    .filter((n) => !hasAccepted(n, username))
    .sort((a, b) => a.postedAt.localeCompare(b.postedAt));
}

/**
 * Whether the acknowledgement banner should render for this user: they must be
 * in the must-accept audience AND have at least one unaccepted notification.
 */
export function shouldShowBanner(
  role: AuthRole,
  username: string,
  notifications: AppNotification[]
): boolean {
  if (!isNotificationAudienceRole(role)) return false;
  return getUnacceptedFor(notifications, username).length > 0;
}
