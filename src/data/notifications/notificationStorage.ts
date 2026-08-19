/**
 * Notification-center storage — workspace-wide broadcast notifications that
 * admin/manager users post and employee/supervisor users must acknowledge.
 *
 * **Two files, two owners.**
 *
 * BROADCASTS live in a single non-month-scoped file at
 * `5-system/notifications/notifications.json`, mirroring the audit action-log
 * precedent (`5-system/audit/actions.log.json`). Only admin/manager write it,
 * rarely, so the cross-machine CAS loop (`casLoop`) under a same-tab resource
 * lock is the right guard for it and is unchanged.
 *
 * ACKNOWLEDGEMENTS are written by every employee, potentially at once. They now
 * live in per-employee files under `acks/` (`notificationAckStorage.ts`) — an
 * employee writes only his own file, so acknowledging never contends with
 * another employee's acknowledgement and never rewrites the broadcast log.
 * Acceptances already stored inside the shared file (workspaces predating the
 * split) are READ FOREVER and never rewritten or migrated; `loadNotifications`
 * merges the two sources, so every reader sees one list either way.
 */

import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { readOptionalJson, safeWriteJson } from "../storage/safeWrite";
import { casLoop } from "../storage/casLoop";
import { withResourceLock } from "../storage/webLocks";
import { withWorkspaceWriteAccess } from "../storage/workspaceWriteAccess";
import { logError } from "../storage/errorLogger";
import { getNotificationsDir } from "../workspace/workspacePaths";
import {
  loadAllUserAcks,
  loadUserAcksForDisplay,
  recordAcknowledgement,
  type LiveNotificationSnapshot,
} from "./notificationAckStorage";
import {
  hasAccepted,
  mergeAcknowledgements,
  type AppNotification,
  type NotificationsFile,
} from "./notificationTypes";

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

/**
 * The notifications file, or an empty shell for a workspace that has none yet.
 *
 * **Throws when the file exists but could not be read.** It is the base read of
 * the CAS read-modify-write below, so an empty shell substituted for an
 * unreadable file replaces every notification — and every legacy acknowledgement
 * still stored alongside them — with whatever this one write carries. A missing
 * notifications folder is normal for a fresh workspace and still yields the
 * shell; nothing else does.
 */
async function readNotificationsFile(
  directoryHandle: DirectoryHandleLike
): Promise<NotificationsFile> {
  const read = await readOptionalJson<NotificationsFile>(
    `notifications:${NOTIFICATIONS_FILE}`,
    [{
      directory: () => getNotificationsDir(directoryHandle, false),
      fileName: NOTIFICATIONS_FILE,
    }]
  );
  if (read.kind === "found") {
    return {
      revision: read.value.revision ?? 0,
      _writeToken: read.value._writeToken,
      updatedAt: read.value.updatedAt ?? new Date().toISOString(),
      notifications: Array.isArray(read.value.notifications)
        ? read.value.notifications
        : [],
    };
  }
  return { revision: 0, updatedAt: new Date().toISOString(), notifications: [] };
}

/**
 * Every broadcast notification, with its acknowledgements merged from BOTH
 * sources: the acceptances stored inside the shared file by pre-split clients
 * (read-only, never rewritten) and every per-employee `acks/{username}.acks.json`.
 * Deduped by `(username, notificationId)`, so a user recorded in both appears
 * once — a workspace holding only legacy acceptances renders exactly as it did
 * before the split.
 *
 * Empty array when the broadcast file itself cannot be read. An unreadable ACK
 * file is degraded to "that user has not acknowledged yet" rather than blanking
 * the list (see `loadAllUserAcks`).
 *
 * `options.forUsername` narrows the ack fan-out to that one employee's file —
 * correct, and one read instead of one per employee, for the two callers that
 * only ever ask about the signed-in user (the banner and the unread badge).
 * Omit it for anything that renders OTHER people's acknowledgement state, such
 * as the manager "who acknowledged" roster.
 */
export async function loadNotifications(
  directoryHandle: DirectoryHandleLike,
  options?: { forUsername?: string }
): Promise<AppNotification[]> {
  try {
    const { notifications } = await readNotificationsFile(directoryHandle);
    if (notifications.length === 0) return notifications;
    const ackFiles = options?.forUsername
      ? await loadUserAcksForDisplay(directoryHandle, options.forUsername)
      : await loadAllUserAcks(directoryHandle);
    return mergeAcknowledgements(notifications, ackFiles);
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
    // A remembered workspace (PR #36) opens with read permission only — request
    // write access here, before the notifications folder is created, instead of
    // letting a raw NotAllowedError surface from inside the CAS loop, where
    // casLoop's terminal permission-lost path would misreport a reconnected
    // read-only session as "access lost, reconnect" (mirrors exportWriter.ts).
    return await withWorkspaceWriteAccess(directoryHandle, async () => {
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
                return {
                  done: true,
                  result: { ok: true as const },
                  // Delayed re-read (same contract actionLog.appendWorkspaceAction
                  // and userSync.syncUserManagementToDisk use). The read-back above
                  // cannot see a machine that read the same base state and commits
                  // AFTER us; because this is a whole-file write, that clobber drops
                  // this acceptance entirely while `acceptNotification` still reports
                  // success — the user's banner hides and the roster shows them as
                  // never having acknowledged it. A `false` here retries the attempt,
                  // which re-folds the winner's changes in.
                  verify: async () => {
                    const recheck = await readNotificationsFile(directoryHandle);
                    return (
                      recheck.revision === nextRevision &&
                      recheck._writeToken === writeToken
                    );
                  },
                };
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
    });
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
 * Record one user's acceptance of a notification, in THAT USER'S OWN ack file.
 *
 * Idempotent per user: if the user has already accepted (or the notification is
 * gone from the broadcast log), it is a no-op that still reports success.
 * Records acceptance for this user only — never removes or hides the
 * notification for anyone else, and **never writes the shared broadcast file**,
 * so two employees acknowledging at the same moment cannot contend at all.
 */
export async function acceptNotification(
  directoryHandle: DirectoryHandleLike,
  notificationId: string,
  username: string
): Promise<NotificationWriteResult> {
  try {
    // Mirrors mutateNotifications: a remembered workspace (PR #36) opens with
    // read permission only, so ask for write access before the acks folder is
    // created rather than letting a raw NotAllowedError surface from inside the
    // CAS loop as casLoop's misleading "access lost, reconnect".
    return await withWorkspaceWriteAccess(directoryHandle, async () => {
      // The broadcast log is READ here, never written: it answers "does this
      // notification still exist", "did this user already accept it under the
      // pre-split scheme", and supplies the id set for the single-owner prune.
      let live: LiveNotificationSnapshot | null = null;
      // Taken BEFORE the read, so an ack recorded while the read was in flight
      // is on the "newer than the snapshot" side of the prune's guard rather
      // than judged by an id set that could not have contained it.
      const readAtMs = Date.now();
      try {
        const { notifications } = await readNotificationsFile(directoryHandle);
        const target = notifications.find((n) => n.id === notificationId);
        // Gone from the log, or already acknowledged in a legacy shared-file
        // entry — nothing to record, and the legacy entry stays exactly as it is.
        if (!target || hasAccepted(target, username)) return { ok: true };
        live = { ids: new Set(notifications.map((n) => n.id)), readAtMs };
      } catch (error) {
        // "I could not read the log" is not "none of these notifications
        // exist": record the acknowledgement anyway, but with pruning disabled
        // so no live ack is dropped on a bad read.
        logError("notifications:acceptBaseRead", error);
      }
      return recordAcknowledgement(directoryHandle, notificationId, username, live);
    });
  } catch (error) {
    logError("notifications:accept", error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : "خطأ غير معروف.",
    };
  }
}
