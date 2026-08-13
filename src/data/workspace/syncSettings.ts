/**
 * Workspace-wide sync settings — currently just the automatic sync cadence.
 *
 * WHY A WORKSPACE FILE AND NOT localStorage (owner decision, 2026-08-13): the
 * admin sets the cadence once and every employee on every machine that opens
 * the same folder inherits it. A browser-scoped setting would have to be
 * re-applied per machine and per profile, which is exactly what the owner
 * asked not to happen.
 *
 * WHY ITS OWN FILE: there is no general-purpose workspace settings file to
 * extend. The candidates were all wrong for a value every client reads on
 * every tick — `5-system/backups/auto-backup-settings.json` is backup-policy
 * state living inside the backups folder, `5-system/user-presets/` is
 * per-user, and `3-user-data/users.permissions.json` is the identity and
 * permission matrix (rewritten wholesale by `syncUserManagementToDisk`, so
 * folding an unrelated scalar into it would put the sync cadence at the mercy
 * of every permission save). This is a small, focused file directly under the
 * system root, following the precedent of `restore.inprogress.json` — a bare
 * file under `5-system/` because it describes the workspace as a whole rather
 * than any one feature's folder. The name is deliberately generic
 * (`workspace-settings.json`) so a future workspace-wide scalar can join it
 * instead of spawning another file.
 *
 * BOUNDS (clamped on BOTH write and read-back — the file is plain JSON on a
 * shared folder and anyone can edit it by hand, so a read is never trusted):
 *
 *   - floor 15s. Every automatic run does a permission re-sync plus a probe of
 *     five things (distribution stamp, notifications revision, two directory
 *     listings, the month manifest). On a shared network folder with a real
 *     population that is not free, and every client in the department pays it
 *     independently. Below ~15s the probes start overlapping their own cost
 *     and the File System Access API is being hammered for no perceptible
 *     freshness gain over the 45s default.
 *   - ceiling 30min. Beyond half an hour the automatic path stops being a sync
 *     mechanism in any useful sense: a revoked permission or a supervisor's
 *     decision could sit unseen for most of a working session, and the manual
 *     refresh button becomes the only real path. 30min is the largest value
 *     that still guarantees a couple of automatic runs per shift.
 *
 * Anything outside those bounds — non-integer, NaN, negative, absent, a string,
 * a hand-edited 1 — is clamped (or replaced by the 45s default when it is not a
 * finite number at all) rather than rejected: a malformed settings file must
 * never stop the app from syncing.
 */
import { casLoop } from "../storage/casLoop";
import { logError } from "../storage/errorLogger";
import { isEnvelope, unwrap } from "../storage/jsonEnvelope";
import { safeReadJson, safeWriteJson } from "../storage/safeWrite";
import { withResourceLock } from "../storage/webLocks";
import { withWorkspaceWriteAccess } from "../storage/workspaceWriteAccess";
import { getSystemRoot } from "./workspacePaths";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";

export const WORKSPACE_SETTINGS_FILE = "workspace-settings.json";

/** The cadence used when nothing is stored, nothing is readable, or no
 *  workspace is mounted. Unchanged from the hard-coded value it replaces. */
export const DEFAULT_SYNC_INTERVAL_MS = 45_000;
export const MIN_SYNC_INTERVAL_MS = 15_000;
export const MAX_SYNC_INTERVAL_MS = 30 * 60_000;

export type WorkspaceSettingsFile = {
  revision?: number;
  _writeToken?: string;
  updatedAt?: string;
  updatedBy?: string;
  /** Milliseconds between automatic sync runs. */
  syncIntervalMs?: number;
};

export type SyncSettingsWriteResult = { ok: true } | { ok: false; error: string };

/**
 * Coerce any value at all into a usable interval. Non-finite, non-numeric and
 * absent values fall back to the default; everything else is rounded to a whole
 * millisecond and clamped into [MIN, MAX].
 */
export function clampSyncIntervalMs(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_SYNC_INTERVAL_MS;
  }
  const rounded = Math.round(value);
  if (rounded < MIN_SYNC_INTERVAL_MS) return MIN_SYNC_INTERVAL_MS;
  if (rounded > MAX_SYNC_INTERVAL_MS) return MAX_SYNC_INTERVAL_MS;
  return rounded;
}

/** True when the value is inside the bounds without needing to be clamped —
 *  used by the Settings editor to reject a bad entry instead of silently
 *  changing what the admin typed. */
export function isSyncIntervalInRange(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= MIN_SYNC_INTERVAL_MS &&
    value <= MAX_SYNC_INTERVAL_MS
  );
}

async function readSettingsFile(
  directoryHandle: DirectoryHandleLike
): Promise<WorkspaceSettingsFile> {
  try {
    const dir = await getSystemRoot(directoryHandle, false);
    const result = await safeReadJson<WorkspaceSettingsFile>(dir, WORKSPACE_SETTINGS_FILE);
    if (result.ok && result.value && typeof result.value === "object") {
      return result.value;
    }
  } catch {
    // A missing 5-system folder or a missing settings file is the normal state
    // of a fresh workspace, not an error worth logging or surfacing.
  }
  return {};
}

export type ReadSyncIntervalOptions = {
  /**
   * A `5-system/` handle the caller has ALREADY resolved. The sync tick opens
   * that directory anyway (for the notifications probe), and on a UNC/SMB share
   * every `getDirectoryHandle` is a network round trip — so re-resolving it here
   * would charge every client one extra round trip per tick, forever, to read a
   * scalar that changes maybe twice a year. Omit it and the directory is
   * resolved normally.
   */
  systemDir?: DirectoryHandleLike | null;
};

/**
 * Single-open read of the settings file (perf, ~2026-08-13).
 *
 * `safeReadJson` probes `{file}`, `{file}.bak` and `{file}.tmp` on a miss — three
 * opens. An ABSENT settings file is the normal, permanent state of every
 * workspace whose admin has never changed the cadence, so on the per-tick path
 * that miss ladder was pure recurring cost for an answer ("use the default")
 * that the first `NotFoundError` already gave. This opens the live file once and
 * only falls back to the full `safeReadJson` recovery path when the live file
 * EXISTS but does not parse — i.e. exactly when a `.bak` could still help.
 */
async function readSettingsFileFast(
  directoryHandle: DirectoryHandleLike,
  systemDir: DirectoryHandleLike | null | undefined
): Promise<WorkspaceSettingsFile> {
  let dir: DirectoryHandleLike;
  try {
    dir = systemDir ?? (await getSystemRoot(directoryHandle, false));
  } catch {
    // No `5-system/` yet — a fresh workspace, not an error.
    return {};
  }
  let text: string;
  try {
    const handle = await dir.getFileHandle(WORKSPACE_SETTINGS_FILE, { create: false });
    text = await (await handle.getFile()).text();
  } catch {
    // Absent (the common case) or briefly unreadable: the default is correct.
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(text);
    const value = isEnvelope(parsed)
      ? unwrap<WorkspaceSettingsFile>(parsed)
      : (parsed as WorkspaceSettingsFile);
    if (value && typeof value === "object") return value;
  } catch {
    // Present but corrupt — this is the one case a `.bak` can rescue, so pay
    // for the full recovery read here and nowhere else.
  }
  return readSettingsFile(directoryHandle);
}

/**
 * The workspace's effective sync interval. Never throws and never reports an
 * error for an absent file: any failure at all yields the 45s default, because
 * a settings read must not be able to block boot or stop the sync timer.
 */
export async function readSyncIntervalMs(
  directoryHandle: DirectoryHandleLike | null,
  options?: ReadSyncIntervalOptions
): Promise<number> {
  if (!directoryHandle) return DEFAULT_SYNC_INTERVAL_MS;
  try {
    const file = await readSettingsFileFast(directoryHandle, options?.systemDir);
    // Clamp on READ-BACK too: the stored value may have been hand-edited on
    // disk, or written by an older/newer build with different bounds.
    return clampSyncIntervalMs(file.syncIntervalMs);
  } catch (error) {
    logError("syncSettings:read", error);
    return DEFAULT_SYNC_INTERVAL_MS;
  }
}

/**
 * Persist a new cadence. Routed through `casLoop` (unlike
 * `saveAutoBackupSettings`, which documents an exemption for its single-scalar
 * overwrite) because this file is explicitly designed to accumulate further
 * workspace-wide settings: the moment a second field lands, a blind whole-object
 * overwrite would drop a concurrent admin's change to the other field.
 */
export async function saveSyncIntervalMs(
  directoryHandle: DirectoryHandleLike,
  intervalMs: number,
  username: string
): Promise<SyncSettingsWriteResult> {
  // Clamp on WRITE as well as on read — an out-of-range value must never reach
  // disk, whatever the caller believed it was sending.
  const clamped = clampSyncIntervalMs(intervalMs);
  try {
    return await withWorkspaceWriteAccess(directoryHandle, async () => {
      // `:rmw` suffix keeps this read-modify-write lock distinct from
      // safeWriteJson's own `${dir.name}/${fileName}` lock — withResourceLock
      // is not reentrant, so a colliding key self-deadlocks.
      const result = await withResourceLock(
        `system/${WORKSPACE_SETTINGS_FILE}:rmw`,
        () =>
          casLoop<{ ok: true }>(
            async (writeToken) => {
              const dir = await getSystemRoot(directoryHandle, true);
              const existing = await readSettingsFile(directoryHandle);
              const nextRevision = (existing.revision ?? 0) + 1;
              const updated: WorkspaceSettingsFile = {
                ...existing,
                revision: nextRevision,
                _writeToken: writeToken,
                updatedAt: new Date().toISOString(),
                updatedBy: username,
                syncIntervalMs: clamped,
              };
              await safeWriteJson(dir, WORKSPACE_SETTINGS_FILE, updated);
              const verify = await readSettingsFile(directoryHandle);
              if (verify.revision === nextRevision && verify._writeToken === writeToken) {
                return { done: true, result: { ok: true as const } };
              }
              return { done: false };
            },
            {
              maxRetries: 6,
              baseDelayMs: 50,
              conflictError:
                "تعارض في الكتابة: تعذّر حفظ فترة المزامنة بعد عدة محاولات.",
            }
          )
      );
      if ("ok" in result && result.ok === false) {
        return { ok: false, error: result.error };
      }
      return { ok: true };
    });
  } catch (error) {
    logError("syncSettings:write", error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : "خطأ غير معروف.",
    };
  }
}
