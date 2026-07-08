/**
 * Workspace action audit trail — records governance-relevant actions
 * (user deletion, permission changes, sample draws, referral decisions,
 * month close/reopen, backup restores) in an append-only log at
 * `5-system/audit/actions.log.json`.
 *
 * Deliberately a separate file from `activity.log.json` (session-shaped,
 * merge-by-id/heartbeat schema) — do not mix the two.
 *
 * Best-effort by contract: `appendWorkspaceAction` never throws to callers
 * (failures go to the error ring buffer) and silently skips when no
 * workspace is connected. It is intentionally NOT gated by the month lock:
 * it must be able to record `month-closed` itself.
 */

import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeReadJson, safeWriteJson } from "../storage/safeWrite";
import { casLoop } from "../storage/casLoop";
import { withResourceLock } from "../storage/webLocks";
import { logError } from "../storage/errorLogger";
import { getSystemRoot, SYSTEM_FOLDER_NAMES } from "../workspace/workspacePaths";

const ACTIONS_LOG_FILE = "actions.log.json";
const MAX_ACTION_ENTRIES = 10_000;

export type WorkspaceActionType =
  | "user-deleted"
  | "user-created"
  | "permission-changed"
  | "feature-permission-changed"
  | "sample-drawn"
  | "distribution-bulk-assigned"
  | "referral-approved"
  | "referral-denied"
  | "replacement-approved"
  | "replacement-denied"
  | "answer-reopened"
  | "month-closed"
  | "month-reopened"
  | "backup-restored";

export type WorkspaceActionEntry = {
  id: string;
  at: string;
  actor: string;
  actorRole: string;
  action: WorkspaceActionType;
  monthFolderName?: string | null;
  target?: string | null;
  details?: Record<string, string | number | boolean | null>;
};

export type WorkspaceActionLogFile = {
  revision: number;
  /** Per-write UUID embedded by casLoop for cross-machine race detection. */
  _writeToken?: string;
  updatedAt: string;
  /** Capped at MAX_ACTION_ENTRIES; oldest dropped. */
  entries: WorkspaceActionEntry[];
};

/** Caller-supplied fields; `id` and `at` are stamped on append. */
export type WorkspaceActionInput = Omit<WorkspaceActionEntry, "id" | "at">;

function createActionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `act-${crypto.randomUUID()}`;
  }
  return `act-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function getAuditDir(
  directoryHandle: DirectoryHandleLike,
  create: boolean
): Promise<DirectoryHandleLike> {
  const systemDir = await getSystemRoot(directoryHandle, create);
  return systemDir.getDirectoryHandle(SYSTEM_FOLDER_NAMES.audit, { create });
}

async function readLogFile(
  directoryHandle: DirectoryHandleLike
): Promise<WorkspaceActionLogFile> {
  try {
    const dir = await getAuditDir(directoryHandle, false);
    const result = await safeReadJson<WorkspaceActionLogFile>(dir, ACTIONS_LOG_FILE);
    if (result.ok) {
      return {
        revision: result.value.revision ?? 0,
        _writeToken: result.value._writeToken,
        updatedAt: result.value.updatedAt ?? new Date().toISOString(),
        entries: Array.isArray(result.value.entries) ? result.value.entries : [],
      };
    }
  } catch {
    // Missing audit folder is normal for fresh workspaces.
  }
  return { revision: 0, updatedAt: new Date().toISOString(), entries: [] };
}

/**
 * Append one action entry. Best-effort: resolves without throwing on any
 * failure (logged to the error ring buffer); silently skips when
 * `directoryHandle` is null. Callers may fire-and-forget with `void`.
 */
export async function appendWorkspaceAction(
  directoryHandle: DirectoryHandleLike | null,
  entry: WorkspaceActionInput
): Promise<void> {
  if (!directoryHandle) return;

  try {
    // NB: `:rmw` suffix keeps this outer read-modify-write lock distinct from
    // safeWriteJson's internal `${dir.name}/${fileName}` lock (v41.36 —
    // withResourceLock is not reentrant, a colliding key self-deadlocks).
    // The outer lock serializes same-tab appends; the casLoop token guards
    // against cross-machine races on a shared folder.
    const result = await withResourceLock(`audit/${ACTIONS_LOG_FILE}:rmw`, () =>
      casLoop<{ ok: true }>(
      async (writeToken) => {
        const dir = await getAuditDir(directoryHandle, true);
        const existing = await readLogFile(directoryHandle);
        const nextRevision = (existing.revision ?? 0) + 1;
        const fullEntry: WorkspaceActionEntry = {
          ...entry,
          id: createActionId(),
          at: new Date().toISOString(),
        };
        const updated: WorkspaceActionLogFile = {
          revision: nextRevision,
          _writeToken: writeToken,
          updatedAt: fullEntry.at,
          entries: [...existing.entries, fullEntry].slice(-MAX_ACTION_ENTRIES),
        };
        await safeWriteJson(dir, ACTIONS_LOG_FILE, updated);
        const verify = await readLogFile(directoryHandle);
        if (verify.revision === nextRevision && verify._writeToken === writeToken) {
          return { done: true, result: { ok: true as const } };
        }
        return { done: false };
      },
      { maxRetries: 4, baseDelayMs: 50, conflictError: "audit append conflict" }
      )
    );
    if (!result.ok) {
      logError("audit:append", new Error(result.error));
    }
  } catch (error) {
    logError("audit:append", error);
  }
}

/** Read all recorded actions (newest last). Empty array on any failure. */
export async function readWorkspaceActions(
  directoryHandle: DirectoryHandleLike
): Promise<WorkspaceActionEntry[]> {
  try {
    return (await readLogFile(directoryHandle)).entries;
  } catch (error) {
    logError("audit:read", error);
    return [];
  }
}
