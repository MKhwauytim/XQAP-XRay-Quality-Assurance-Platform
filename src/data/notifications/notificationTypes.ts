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
 *
 * `notifications[].acceptances` is now written ONLY by workspaces predating the
 * per-employee ack split; current clients write acknowledgements to
 * `acks/{username}.acks.json` instead and read the two together. The legacy
 * entries here are read forever and never rewritten or migrated.
 */
export type NotificationsFile = {
  revision: number;
  /** Per-write UUID embedded by casLoop for cross-machine race detection. */
  _writeToken?: string;
  updatedAt: string;
  notifications: AppNotification[];
};

/**
 * Per-year archive of broadcast notifications evicted from the live file's
 * `MAX_NOTIFICATIONS` cap (mirrors `audit/actionLog.ts`'s `WorkspaceActionArchiveFile`,
 * minus the B5 tamper-evident hash chain — notifications are not the audit
 * log, so a plain retention copy is the right weight here).
 */
export type NotificationsArchiveFile = {
  year: number;
  revision: number;
  updatedAt: string;
  notifications: AppNotification[];
};

/** One acknowledgement inside a single employee's own ack file. */
export type NotificationAck = {
  notificationId: string;
  /** ISO timestamp of when this user pressed "قبول". */
  acceptedAt: string;
};

/**
 * On-disk shape of `5-system/notifications/acks/{username}.acks.json` — ONE
 * file per acknowledging employee, written only by that employee.
 *
 * `username` is carried in the payload rather than inferred from the file name:
 * `safeWorkspaceFilePart` sanitizes the name, so the name is not a lossless
 * round trip back to the account it belongs to.
 */
export type NotificationAcksFile = {
  revision: number;
  /** Per-write UUID embedded by casLoop (guards this user's own multi-tab writes). */
  _writeToken?: string;
  username: string;
  updatedAt: string;
  acks: NotificationAck[];
};

/**
 * Fold the per-employee ack files into the broadcast list's `acceptances`, so
 * every reader (banner, unread badge, the manager "who acknowledged" roster)
 * sees one list regardless of where an acknowledgement was recorded.
 *
 * Legacy acceptances already inside the shared file are kept FIRST and are
 * authoritative for a `(username, notificationId)` pair that appears in both,
 * so a workspace with no ack files renders byte-identically to before the
 * split. Ack files are otherwise appended in the caller's (name-sorted) order.
 */
export function mergeAcknowledgements(
  notifications: AppNotification[],
  ackFiles: readonly NotificationAcksFile[]
): AppNotification[] {
  if (ackFiles.length === 0) return notifications;

  const byNotification = new Map<string, NotificationAcceptance[]>();
  for (const file of ackFiles) {
    const username = typeof file?.username === "string" ? file.username : "";
    if (!username) continue;
    for (const ack of Array.isArray(file.acks) ? file.acks : []) {
      if (!ack || typeof ack.notificationId !== "string") continue;
      const list = byNotification.get(ack.notificationId);
      const acceptance: NotificationAcceptance = {
        username,
        acceptedAt: typeof ack.acceptedAt === "string" ? ack.acceptedAt : "",
      };
      if (list) list.push(acceptance);
      else byNotification.set(ack.notificationId, [acceptance]);
    }
  }

  return notifications.map((notification) => {
    const extra = byNotification.get(notification.id);
    if (!extra) return notification;
    const existing = Array.isArray(notification.acceptances) ? notification.acceptances : [];
    const seen = new Set(existing.map((a) => a.username));
    const merged = [...existing];
    for (const acceptance of extra) {
      if (seen.has(acceptance.username)) continue;
      seen.add(acceptance.username);
      merged.push(acceptance);
    }
    // Identity-preserving when the ack files added nothing new for this one.
    return merged.length === existing.length ? notification : { ...notification, acceptances: merged };
  });
}

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
