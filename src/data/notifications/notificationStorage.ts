/**
 * Notification-center storage — workspace-wide broadcast notifications that
 * admin/manager users post and employee/supervisor users must acknowledge.
 *
 * Persisted as a single non-month-scoped file at
 * `5-system/notifications/notifications.json`, mirroring the audit action-log
 * precedent (`5-system/audit/actions.log.json`). Every mutation runs in the
 * cross-machine CAS loop (`casLoop`) under a same-tab resource lock, so two
 * writers on a shared workspace folder — e.g. two people accepting the same
 * notification near-simultaneously — never lose each other's write.
 */

import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeReadJson, safeWriteJson } from "../storage/safeWrite";
import { casLoop } from "../storage/casLoop";
import { withResourceLock } from "../storage/webLocks";
import { logError } from "../storage/errorLogger";
import { getSystemRoot, SYSTEM_FOLDER_NAMES } from "../workspace/workspacePaths";
import type { AppNotification, NotificationsFile } from "./notificationTypes";

const NOTIFICATIONS_FILE = "notifications.json";
/** Generous cap; oldest dropped. Admin broadcast tool, not high-volume. */
const MAX_NOTIFICATIONS = 500;

export type NotificationWriteResult =
  | { ok: true }
  | { ok: false; error: string };

function createNotificationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `ntf-${crypto.randomUUID()}`;
  }
  return `ntf-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function getNotificationsDir(
  directoryHandle: DirectoryHandleLike,
  create: boolean
): Promise<DirectoryHandleLike> {
  const systemDir = await getSystemRoot(directoryHandle, create);
  return systemDir.getDirectoryHandle(SYSTEM_FOLDER_NAMES.notifications, { create });
}

async function readNotificationsFile(
  directoryHandle: DirectoryHandleLike
): Promise<NotificationsFile> {
  try {
    const dir = await getNotificationsDir(directoryHandle, false);
    const result = await safeReadJson<NotificationsFile>(dir, NOTIFICATIONS_FILE);
    if (result.ok) {
      return {
        revision: result.value.revision ?? 0,
        _writeToken: result.value._writeToken,
        updatedAt: result.value.updatedAt ?? new Date().toISOString(),
        notifications: Array.isArray(result.value.notifications)
          ? result.value.notifications
          : [],
      };
    }
  } catch {
    // Missing notifications folder is normal for fresh workspaces.
  }
  return { revision: 0, updatedAt: new Date().toISOString(), notifications: [] };
}

/** Read all notifications (as stored). Empty array on any failure. */
export async function loadNotifications(
  directoryHandle: DirectoryHandleLike
): Promise<AppNotification[]> {
  try {
    return (await readNotificationsFile(directoryHandle)).notifications;
  } catch (error) {
    logError("notifications:read", error);
    return [];
  }
}

/**
 * Read-modify-write the notifications list in the CAS loop. The `updater`
 * receives the freshest on-disk list on every attempt, so a concurrent writer's
 * change is always folded in before this write commits (last event wins per
 * item, never per whole file).
 */
async function mutateNotifications(
  directoryHandle: DirectoryHandleLike,
  updater: (list: AppNotification[]) => AppNotification[]
): Promise<NotificationWriteResult> {
  try {
    // `:rmw` suffix keeps this outer read-modify-write lock distinct from
    // safeWriteJson's internal `${dir.name}/${fileName}` lock (withResourceLock
    // is not reentrant — a colliding key self-deadlocks).
    const result = await withResourceLock(
      `notifications/${NOTIFICATIONS_FILE}:rmw`,
      () =>
        casLoop<{ ok: true }>(
          async (writeToken) => {
            const dir = await getNotificationsDir(directoryHandle, true);
            const existing = await readNotificationsFile(directoryHandle);
            const nextRevision = (existing.revision ?? 0) + 1;
            const updated: NotificationsFile = {
              revision: nextRevision,
              _writeToken: writeToken,
              updatedAt: new Date().toISOString(),
              notifications: updater(existing.notifications).slice(-MAX_NOTIFICATIONS),
            };
            await safeWriteJson(dir, NOTIFICATIONS_FILE, updated);
            const verify = await readNotificationsFile(directoryHandle);
            if (verify.revision === nextRevision && verify._writeToken === writeToken) {
              return { done: true, result: { ok: true as const } };
            }
            return { done: false };
          },
          {
            maxRetries: 6,
            baseDelayMs: 50,
            conflictError:
              "تعارض في الكتابة: تعذّر حفظ الإشعارات بعد عدة محاولات.",
          }
        )
    );
    if ("ok" in result && result.ok === false) {
      return { ok: false, error: result.error };
    }
    return { ok: true };
  } catch (error) {
    logError("notifications:write", error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : "خطأ غير معروف.",
    };
  }
}

/** Post a new broadcast notification (admin/manager). */
export async function postNotification(
  directoryHandle: DirectoryHandleLike,
  params: { message: string; postedBy: string }
): Promise<NotificationWriteResult> {
  const message = params.message.trim();
  if (!message) return { ok: false, error: "نص الإشعار مطلوب." };
  const notification: AppNotification = {
    id: createNotificationId(),
    message,
    postedBy: params.postedBy,
    postedAt: new Date().toISOString(),
    acceptances: [],
  };
  return mutateNotifications(directoryHandle, (list) => [...list, notification]);
}

/**
 * Record one user's acceptance of a notification. Idempotent per user: if the
 * user has already accepted (or the notification is gone), it is a no-op that
 * still reports success. Records acceptance for THIS user only — never removes
 * or hides the notification for anyone else.
 */
export async function acceptNotification(
  directoryHandle: DirectoryHandleLike,
  notificationId: string,
  username: string
): Promise<NotificationWriteResult> {
  return mutateNotifications(directoryHandle, (list) =>
    list.map((n) => {
      if (n.id !== notificationId) return n;
      if (n.acceptances.some((a) => a.username === username)) return n;
      return {
        ...n,
        acceptances: [
          ...n.acceptances,
          { username, acceptedAt: new Date().toISOString() },
        ],
      };
    })
  );
}
