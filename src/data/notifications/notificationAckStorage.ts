/**
 * Per-employee notification acknowledgements.
 *
 * Acknowledgements used to be appended into the ONE shared
 * `5-system/notifications/notifications.json`, so every employee pressing
 * "قبول" rewrote the whole file — the same file every other employee was
 * rewriting at the same moment. On a shared folder that is the field-reported
 * XQ-IO-032 class: N employees contending for one file, each write dragging
 * every other recipient's acknowledgement along with it.
 *
 * Each employee now owns `acks/{username}.acks.json` and writes NOTHING else,
 * following the approvals precedent (`{supervisor}.decisions.json`) and the
 * referral pattern of appending to the originating user's personal file. The
 * broadcast log itself is untouched by an acknowledgement.
 *
 * `casLoop` is kept on this path even though cross-user contention is now
 * impossible: the same user can still have two tabs open on the same workspace.
 *
 * Legacy acceptances inside the shared file are READ FOREVER (see
 * `mergeAcknowledgements`) and are never rewritten or migrated.
 */

import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { readOptionalJson, safeWriteJson } from "../storage/safeWrite";
import { readJsonDirectory } from "../storage/directoryScan";
import { casLoop } from "../storage/casLoop";
import { withResourceLock } from "../storage/webLocks";
import { logError } from "../storage/errorLogger";
import { isNotFoundError } from "../storage/transientFileErrors";
import {
  getNotificationAcksDir,
  safeWorkspaceFilePart,
} from "../workspace/workspacePaths";
import type { NotificationAck, NotificationAcksFile } from "./notificationTypes";

export const ACK_FILE_SUFFIX = ".acks.json";

export function ackFileName(username: string): string {
  return `${safeWorkspaceFilePart(username)}${ACK_FILE_SUFFIX}`;
}

/**
 * One employee's own ack file, or an empty shell when he has acknowledged
 * nothing yet.
 *
 * **Throws when the file exists but could not be read.** It is the base read of
 * `recordAcknowledgement`'s read-modify-write, so an empty shell substituted
 * for an unreadable file would drop every acknowledgement this employee has
 * ever made — his banner would return for every past notification — while the
 * write still reported success. Only genuine absence produces the shell.
 */
export async function loadUserAcks(
  directoryHandle: DirectoryHandleLike,
  username: string
): Promise<NotificationAcksFile> {
  const fileName = ackFileName(username);
  const read = await readOptionalJson<NotificationAcksFile>(
    `notifications:acks/${fileName}`,
    [{ directory: () => getNotificationAcksDir(directoryHandle, false), fileName }]
  );
  if (read.kind === "found") {
    return {
      revision: read.value.revision ?? 0,
      _writeToken: read.value._writeToken,
      // Trust the file's own username over the sanitized file name, but fall
      // back to the caller's when an older/hand-edited file omits it.
      username: typeof read.value.username === "string" && read.value.username ? read.value.username : username,
      updatedAt: read.value.updatedAt ?? new Date().toISOString(),
      acks: Array.isArray(read.value.acks) ? read.value.acks : [],
    };
  }
  return { revision: 0, username, updatedAt: new Date().toISOString(), acks: [] };
}

/**
 * Every employee's ack file, for the merged read.
 *
 * Best-effort by design (`onUnreadable: "skip"`, mirroring
 * `loadAllSupervisorDecisions`): this feeds display state only — never a
 * read-modify-write — so one employee's unreadable file must not blank the
 * whole notification list for everybody else. A skipped file is logged so the
 * silent degradation is observable in the error ring buffer.
 */
export async function loadAllUserAcks(
  directoryHandle: DirectoryHandleLike
): Promise<NotificationAcksFile[]> {
  let dir: DirectoryHandleLike;
  try {
    dir = await getNotificationAcksDir(directoryHandle, false);
  } catch (error) {
    // No acks folder at all is the normal state of a legacy or brand-new
    // workspace — every acknowledgement still lives in the shared file.
    if (!isNotFoundError(error)) logError("notifications:acks:open", error);
    return [];
  }
  try {
    const { values, fileNames, matchedNames } = await readJsonDirectory<NotificationAcksFile>(dir, {
      suffix: ACK_FILE_SUFFIX,
      onUnreadable: "skip",
    });
    if (matchedNames.length !== fileNames.length) {
      logError(
        "notifications:acks:unreadable",
        new Error(
          `${matchedNames.length - fileNames.length} ack file(s) could not be read; their acknowledgements are missing from this view.`
        )
      );
    }
    return values;
  } catch (error) {
    logError("notifications:acks:list", error);
    return [];
  }
}

/**
 * ONE employee's ack file, shaped for the merge, best-effort.
 *
 * The banner and the unread badge only ever ask about the signed-in user, and
 * the merge only reads `acceptances` for that same user — so reading his single
 * file answers them exactly as the full fan-out would, at one file read per poll
 * instead of one per employee in the workspace. Callers that render OTHER
 * people's acknowledgement state (the manager "who acknowledged" roster) must
 * use `loadAllUserAcks`.
 */
export async function loadUserAcksForDisplay(
  directoryHandle: DirectoryHandleLike,
  username: string
): Promise<NotificationAcksFile[]> {
  try {
    const file = await loadUserAcks(directoryHandle, username);
    return file.acks.length > 0 ? [file] : [];
  } catch (error) {
    // Display-only: an unreadable own-file degrades to "nothing acknowledged
    // yet" (the banner reappears) rather than blanking the notification list.
    logError("notifications:acks:own", error);
    return [];
  }
}

/**
 * Append `notificationId` to `username`'s own ack file.
 *
 * `liveNotificationIds` enables the single-owner prune (requirement 4): an
 * employee may drop HIS OWN acks whose notification has fallen out of the
 * broadcast log (the log keeps only the newest 500). Pass `null` when the
 * broadcast log could not be read — the ack is still recorded, but nothing is
 * pruned, because "I could not read the log" must never be mistaken for "none
 * of these notifications exist any more". Pruning keeps the file bounded by the
 * broadcast log's own cap; no other file is ever touched.
 */
export async function recordAcknowledgement(
  directoryHandle: DirectoryHandleLike,
  notificationId: string,
  username: string,
  liveNotificationIds: ReadonlySet<string> | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  const fileName = ackFileName(username);
  // `:rmw` suffix keeps this outer read-modify-write lock distinct from
  // safeWriteJson's internal directory/file lock (withResourceLock is not
  // reentrant — a colliding key self-deadlocks).
  const result = await withResourceLock(`notifications/acks/${fileName}:rmw`, () =>
    casLoop<{ ok: true }>(
      async (writeToken) => {
        const dir = await getNotificationAcksDir(directoryHandle, true);
        const current = await loadUserAcks(directoryHandle, username);
        const nextRevision = (current.revision ?? 0) + 1;
        const updated: NotificationAcksFile = {
          revision: nextRevision,
          _writeToken: writeToken,
          username,
          updatedAt: new Date().toISOString(),
          acks: nextAcks(current.acks, notificationId, liveNotificationIds),
        };
        await safeWriteJson(dir, fileName, updated);
        const verify = await loadUserAcks(directoryHandle, username);
        if (verify.revision === nextRevision && verify._writeToken === writeToken) {
          return {
            done: true,
            result: { ok: true as const },
            // Delayed re-read, same contract as the broadcast write: only this
            // user's other tab/machine can be racing here, and a clobber would
            // silently drop the acknowledgement while reporting success.
            verify: async () => {
              const recheck = await loadUserAcks(directoryHandle, username);
              return recheck.revision === nextRevision && recheck._writeToken === writeToken;
            },
          };
        }
        return { done: false };
      },
      {
        maxRetries: 6,
        baseDelayMs: 50,
        conflictError: "تعارض في الكتابة: تعذّر حفظ الإشعارات بعد عدة محاولات.",
      }
    )
  );
  if ("ok" in result && result.ok === false) return { ok: false, error: result.error };
  return { ok: true };
}

/** The employee's next ack list: prune his own dead entries, then append. */
function nextAcks(
  existing: NotificationAck[],
  notificationId: string,
  liveNotificationIds: ReadonlySet<string> | null
): NotificationAck[] {
  const kept = liveNotificationIds
    ? existing.filter((ack) => liveNotificationIds.has(ack.notificationId))
    : existing;
  if (kept.some((ack) => ack.notificationId === notificationId)) return kept;
  return [...kept, { notificationId, acceptedAt: new Date().toISOString() }];
}
