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
import { simpleHash } from "../storage/jsonEnvelope";
import { logError } from "../storage/errorLogger";
import { getSystemRoot, SYSTEM_FOLDER_NAMES } from "../workspace/workspacePaths";

const ACTIONS_LOG_FILE = "actions.log.json";

// Live-log retention cap. When exceeded, the oldest overflow is appended to a
// per-year archive file BEFORE the live log is trimmed (A6). A `let` + test seam
// so the archival behaviour can be exercised without writing 10k entries.
const DEFAULT_MAX_ACTION_ENTRIES = 10_000;
let maxActionEntries = DEFAULT_MAX_ACTION_ENTRIES;

/** @internal — test-only. Lower the live-log cap to exercise archival cheaply. */
export function __setMaxActionEntriesForTests(limit: number): void {
  maxActionEntries = limit;
}

/** @internal — test-only. Restore the production cap. */
export function __resetMaxActionEntriesForTests(): void {
  maxActionEntries = DEFAULT_MAX_ACTION_ENTRIES;
}

function archiveFileName(year: number): string {
  return `actions.archive.${year}.json`;
}

/** Per-year archive of audit entries evicted from the live log (A6). */
export type WorkspaceActionArchiveFile = {
  year: number;
  revision: number;
  _writeToken?: string;
  updatedAt: string;
  /**
   * djb2 hash of the previous calendar year's archive file at the time this one was
   * written (B5). Absent when no prior-year archive exists. TAMPER-EVIDENT only —
   * no secret key, so a determined editor can recompute the chain (see
   * docs/SECURITY_MODEL.md); it catches accidental/out-of-band edits.
   */
  previousArchiveHash?: string;
  entries: WorkspaceActionEntry[];
};

/** djb2 hash of an archive file as stored (B5 chain link). */
export function hashActionArchive(archive: WorkspaceActionArchiveFile): string {
  return simpleHash(JSON.stringify(archive));
}

function entryYear(entry: WorkspaceActionEntry): number {
  const parsed = new Date(entry.at).getFullYear();
  return Number.isNaN(parsed) ? new Date().getFullYear() : parsed;
}

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
  | "reopen-approved"
  | "reopen-denied"
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
  /**
   * Live entries. Capped at maxActionEntries: on overflow the oldest entries are
   * appended to a per-year `actions.archive.{year}.json` BEFORE being trimmed
   * here (A6) — never dropped without archiving. Archive failure blocks the trim.
   */
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

/** Read a per-year archive file, or an empty shell when absent. */
async function readArchiveFile(
  dir: DirectoryHandleLike,
  year: number
): Promise<WorkspaceActionArchiveFile> {
  const result = await safeReadJson<WorkspaceActionArchiveFile>(dir, archiveFileName(year));
  if (result.ok) {
    return {
      year,
      revision: result.value.revision ?? 0,
      updatedAt: result.value.updatedAt ?? new Date().toISOString(),
      previousArchiveHash: result.value.previousArchiveHash,
      entries: Array.isArray(result.value.entries) ? result.value.entries : [],
    };
  }
  return { year, revision: 0, updatedAt: new Date().toISOString(), entries: [] };
}

/**
 * Append overflow entries to their per-year archive files (A6). Idempotent by
 * entry id, so a casLoop retry cannot double-append. Returns true only when every
 * year's archive was written; a false return must BLOCK the live-log trim so no
 * entry is ever dropped without being archived first.
 */
async function archiveOverflow(
  dir: DirectoryHandleLike,
  overflow: WorkspaceActionEntry[]
): Promise<boolean> {
  if (overflow.length === 0) return true;

  const byYear = new Map<number, WorkspaceActionEntry[]>();
  for (const entry of overflow) {
    const year = entryYear(entry);
    const bucket = byYear.get(year);
    if (bucket) bucket.push(entry);
    else byYear.set(year, [entry]);
  }

  try {
    for (const [year, entries] of byYear) {
      const archive = await readArchiveFile(dir, year);
      const seen = new Set(archive.entries.map((e) => e.id));
      const additions = entries.filter((e) => !seen.has(e.id));
      if (additions.length === 0) continue; // already archived (retry) — idempotent
      // B5: link this archive to the previous calendar year's archive if present.
      // Preserve an already-recorded link on subsequent appends to the same year so
      // the chain anchor stays stable; only establish it on first write of the year.
      let previousArchiveHash = archive.previousArchiveHash;
      if (previousArchiveHash === undefined) {
        const prior = await readArchiveFile(dir, year - 1);
        if (prior.revision > 0) previousArchiveHash = hashActionArchive(prior);
      }
      const updated: WorkspaceActionArchiveFile = {
        year,
        revision: (archive.revision ?? 0) + 1,
        updatedAt: new Date().toISOString(),
        ...(previousArchiveHash !== undefined ? { previousArchiveHash } : {}),
        entries: [...archive.entries, ...additions],
      };
      await safeWriteJson(dir, archiveFileName(year), updated);
    }
    return true;
  } catch (error) {
    logError("audit:archive", error);
    return false;
  }
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
        const combined = [...existing.entries, fullEntry];
        // A6: archive overflow (oldest first) BEFORE trimming. If archival fails,
        // keep the full list this write (over cap but never dropped) — the next
        // append retries archival.
        let liveEntries = combined;
        if (combined.length > maxActionEntries) {
          const overflowCount = combined.length - maxActionEntries;
          const overflow = combined.slice(0, overflowCount);
          const archived = await archiveOverflow(dir, overflow);
          if (archived) {
            liveEntries = combined.slice(overflowCount);
          }
        }
        const updated: WorkspaceActionLogFile = {
          revision: nextRevision,
          _writeToken: writeToken,
          updatedAt: fullEntry.at,
          entries: liveEntries,
        };
        await safeWriteJson(dir, ACTIONS_LOG_FILE, updated);
        const verify = await readLogFile(directoryHandle);
        if (verify.revision === nextRevision && verify._writeToken === writeToken) {
          return {
            done: true,
            result: { ok: true as const },
            verify: async () => {
              const recheck = await readLogFile(directoryHandle);
              return recheck.revision === nextRevision && recheck._writeToken === writeToken;
            },
          };
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

/** Read a per-year audit archive (A6). Empty array when the archive is absent. */
export async function readWorkspaceActionArchive(
  directoryHandle: DirectoryHandleLike,
  year: number
): Promise<WorkspaceActionEntry[]> {
  try {
    const dir = await getAuditDir(directoryHandle, false);
    return (await readArchiveFile(dir, year)).entries;
  } catch (error) {
    logError("audit:read-archive", error);
    return [];
  }
}
