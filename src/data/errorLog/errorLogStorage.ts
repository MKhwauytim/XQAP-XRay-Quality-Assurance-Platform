/**
 * Persistent, workspace-wide error log — per-user files, never a shared one.
 *
 * WHY PER-USER. `auditPaths.ts:5-14` measured what a single shared file costs
 * on this app's actual SMB deployment: the activity log alone took 483
 * whole-file rewrites per employee per shift, and one bad writer's failure was
 * every writer's failure. An error log is worse on both axes — it writes
 * exactly when the workspace is already misbehaving, and a storm hits every
 * client at once. Each user writes only `{stem}.errors.json`; two machines
 * never target the same entry.
 *
 * WHY THE RETRY LADDER IS 6 x 100 ms. Copied verbatim from `actionLog.ts:497-499`,
 * which records why: the 4 x 50 ms it replaced "was the shortest ladder in the
 * app and not a ladder at all on a contended SMB entry". That tuning was paid
 * for once; do not re-derive it.
 *
 * BEST-EFFORT BY CONTRACT. `appendUserErrors` never throws and never rejects.
 * Its own internal failures are reported through `logError` under the
 * `errorlog:` context prefix, which `errorLogSink.ts` is taught to drop — the
 * ring buffer still shows them to an admin in Settings, but they are never
 * queued for a disk write, so a failing disk cannot generate an unbounded
 * stream of errors about failing to write errors.
 *
 * There is NO legacy shared file to union in — this subsystem has never had
 * one, which is the one way it is simpler than `actionLog`.
 */

import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { readOptionalJson, safeWriteJson } from "../storage/safeWrite";
import { casLoop } from "../storage/casLoop";
import { withResourceLock } from "../storage/webLocks";
import { readJsonDirectory } from "../storage/directoryScan";
import { logError } from "../storage/errorLogger";
import { getSystemErrorsDir } from "../workspace/workspacePaths";
import { ERRORS_FILE_SUFFIX, errorsArchiveFileName, errorsFileName } from "./errorLogPaths";
import type { ErrorLogArchiveFile, PersistedErrorEntry, UserErrorLogFile } from "./errorLogTypes";

const ERRORLOG_INTERNAL_CONTEXT_PREFIX = "errorlog:";

/**
 * The `casLoop` context tag for the per-user error-log file.
 *
 * Exported because the sink has to recognise it. `casLoop` reports its own
 * exhaustion through `logError` under `casLoop:exhausted(<context>)` — a
 * context that does NOT start with the internal prefix above, so a failed
 * error-log write was enqueued as a fresh error to be written to the same
 * failing file. On a share that was already refusing reads, that turned the
 * error log into a participant in the storm it was recording (44 such entries
 * in one production day).
 */
export const ERRORLOG_CAS_CONTEXT = "errorLog:userFile";

// Per-user live-log retention cap. When exceeded, the oldest overflow is
// appended to that user's per-year archive file BEFORE the live log is
// trimmed — never dropped without archiving. A `let` + test seam so archival
// can be exercised without writing 2k entries.
const DEFAULT_MAX_ERROR_ENTRIES = 2_000;
let maxErrorEntries = DEFAULT_MAX_ERROR_ENTRIES;

/** @internal — test-only. Lower the live-log cap to exercise archival cheaply. */
export function __setMaxErrorEntriesForTests(limit: number): void {
  maxErrorEntries = limit;
}

/** @internal — test-only. Restore the production cap. */
export function __resetMaxErrorEntriesForTests(): void {
  maxErrorEntries = DEFAULT_MAX_ERROR_ENTRIES;
}

function entryYear(entry: PersistedErrorEntry): number {
  const parsed = new Date(entry.at).getFullYear();
  return Number.isNaN(parsed) ? new Date().getFullYear() : parsed;
}

/**
 * ONE user's live log, or an empty shell for a user who has never had an
 * error persisted. **Throws when the file exists but could not be read** —
 * this is the base read of a read-modify-write, and an empty shell on an
 * unreadable file would be a whole-file replacement that truncates that
 * user's entire history and then reports success. Same reasoning as
 * `actionLog.ts:281-291`.
 */
async function readUserErrorLogFile(
  directoryHandle: DirectoryHandleLike,
  username: string
): Promise<UserErrorLogFile> {
  const fileName = errorsFileName(username);
  const read = await readOptionalJson<UserErrorLogFile>(
    `errorlog:${fileName}`,
    [{ directory: () => getSystemErrorsDir(directoryHandle, false), fileName }]
  );
  if (read.kind === "found") {
    return {
      username: typeof read.value.username === "string" ? read.value.username : username,
      revision: read.value.revision ?? 0,
      _writeToken: read.value._writeToken,
      updatedAt: read.value.updatedAt ?? new Date().toISOString(),
      entries: Array.isArray(read.value.entries) ? read.value.entries : [],
    };
  }
  return { username, revision: 0, updatedAt: new Date().toISOString(), entries: [] };
}

/**
 * Read a per-year archive file, or an empty shell when genuinely absent.
 * **Throws when the archive exists but could not be read** — `archiveOverflow`
 * rewrites this file from what it returns, so an empty shell here would
 * discard a whole year of archived errors and then let the live-log trim
 * proceed. The throw is caught by `archiveOverflow`, which returns `false`
 * and BLOCKS that trim, so no entry is dropped without being archived first.
 */
async function readArchiveFile(
  dir: DirectoryHandleLike,
  fileName: string,
  year: number
): Promise<ErrorLogArchiveFile> {
  const read = await readOptionalJson<ErrorLogArchiveFile>(
    `errorlog:${fileName}`,
    [{ directory: async () => dir, fileName }]
  );
  if (read.kind === "found") {
    return {
      year,
      revision: read.value.revision ?? 0,
      updatedAt: read.value.updatedAt ?? new Date().toISOString(),
      entries: Array.isArray(read.value.entries) ? read.value.entries : [],
    };
  }
  return { year, revision: 0, updatedAt: new Date().toISOString(), entries: [] };
}

/**
 * Append overflow entries to this USER's per-year archive files. Idempotent
 * by entry id, so a casLoop retry cannot double-append. Returns true only
 * when every year's archive was written; a false return must BLOCK the
 * live-log trim so no entry is ever dropped without being archived first.
 */
async function archiveOverflow(
  dir: DirectoryHandleLike,
  username: string,
  overflow: PersistedErrorEntry[]
): Promise<boolean> {
  if (overflow.length === 0) return true;

  const byYear = new Map<number, PersistedErrorEntry[]>();
  for (const entry of overflow) {
    const year = entryYear(entry);
    const bucket = byYear.get(year);
    if (bucket) bucket.push(entry);
    else byYear.set(year, [entry]);
  }

  try {
    for (const [year, entries] of byYear) {
      const fileName = errorsArchiveFileName(username, year);
      const archive = await readArchiveFile(dir, fileName, year);
      const seen = new Set(archive.entries.map((e) => e.id));
      const additions = entries.filter((e) => !seen.has(e.id));
      if (additions.length === 0) continue; // already archived (retry) — idempotent
      const updated: ErrorLogArchiveFile = {
        year,
        revision: (archive.revision ?? 0) + 1,
        updatedAt: new Date().toISOString(),
        entries: [...archive.entries, ...additions],
      };
      await safeWriteJson(dir, fileName, updated);
    }
    return true;
  } catch (error) {
    logError(`${ERRORLOG_INTERNAL_CONTEXT_PREFIX}archive`, error);
    return false;
  }
}

/**
 * Append a batch of errors to `username`'s own live log. Best-effort:
 * resolves without throwing on any failure (logged to the error ring buffer
 * under the `errorlog:` prefix, which the sink drops); silently skips on an
 * empty batch or a null handle. Callers may fire-and-forget with `void`.
 */
export async function appendUserErrors(
  directoryHandle: DirectoryHandleLike | null,
  username: string,
  batch: PersistedErrorEntry[]
): Promise<void> {
  if (!directoryHandle || batch.length === 0) return;

  try {
    // Inside the try, not above it — same reasoning as
    // `appendWorkspaceAction` (actionLog.ts:437-444): `errorsFileName` throws
    // on a non-string username, and computing it outside the try would break
    // this function's "never throws to callers" contract at exactly the
    // fire-and-forget callers who rely on it hardest.
    const fileName = errorsFileName(username);
    // `:rmw` suffix keeps this outer read-modify-write lock distinct from
    // safeWriteJson's internal per-file lock — withResourceLock is not
    // reentrant, a colliding key self-deadlocks.
    const result = await withResourceLock(`system-errors/${fileName}:rmw`, () =>
      casLoop<{ ok: true }>(
        async (writeToken) => {
          const dir = await getSystemErrorsDir(directoryHandle, true);
          const existing = await readUserErrorLogFile(directoryHandle, username);
          const nextRevision = (existing.revision ?? 0) + 1;
          const combined = [...existing.entries, ...batch];
          // Archive overflow (oldest first) BEFORE trimming. If archival
          // fails, keep the full list this write (over cap but never
          // dropped) — the next append retries archival.
          let liveEntries = combined;
          if (combined.length > maxErrorEntries) {
            const overflowCount = combined.length - maxErrorEntries;
            const overflow = combined.slice(0, overflowCount);
            const archived = await archiveOverflow(dir, username, overflow);
            if (archived) {
              liveEntries = combined.slice(overflowCount);
            }
          }
          const updated: UserErrorLogFile = {
            username,
            revision: nextRevision,
            _writeToken: writeToken,
            updatedAt: new Date().toISOString(),
            entries: liveEntries,
          };
          await safeWriteJson(dir, fileName, updated);
          const verify = await readUserErrorLogFile(directoryHandle, username);
          if (verify.revision === nextRevision && verify._writeToken === writeToken) {
            return {
              done: true,
              result: { ok: true as const },
              verify: async () => {
                const recheck = await readUserErrorLogFile(directoryHandle, username);
                return recheck.revision === nextRevision && recheck._writeToken === writeToken;
              },
            };
          }
          return { done: false };
        },
        // 4 x 50 ms was the shortest ladder in the app and not a ladder at
        // all on a contended SMB entry — see actionLog.ts:497-499.
        { maxRetries: 6, baseDelayMs: 100, context: ERRORLOG_CAS_CONTEXT, conflictError: "error log append conflict" }
      )
    );
    if (!result.ok) {
      logError(`${ERRORLOG_INTERNAL_CONTEXT_PREFIX}append`, new Error(result.error));
    }
  } catch (error) {
    logError(`${ERRORLOG_INTERNAL_CONTEXT_PREFIX}append`, error);
  }
}

/**
 * Dedup for error entries: **first writer wins**, an entry is immutable once
 * appended. Sorted ascending by `at`, tie-broken by `id` so two clients
 * reading the same folder produce the same list. Oldest first, matching
 * `actionLog`'s `mergeActionEntries`.
 */
function mergeErrorEntries(groups: PersistedErrorEntry[][]): PersistedErrorEntry[] {
  const byId = new Map<string, PersistedErrorEntry>();
  for (const group of groups) {
    for (const entry of group) {
      if (!entry || typeof entry.id !== "string") continue;
      if (!byId.has(entry.id)) byId.set(entry.id, entry);
    }
  }
  return [...byId.values()].sort((a, b) => {
    const aAt = Date.parse(a.at);
    const bAt = Date.parse(b.at);
    const aValue = Number.isNaN(aAt) ? -Infinity : aAt;
    const bValue = Number.isNaN(bAt) ? -Infinity : bAt;
    if (aValue !== bValue) return aValue - bValue;
    return a.id.localeCompare(b.id);
  });
}

/**
 * Read every per-user file in `5-system/system-errors/`, merged oldest first.
 * Empty array on any failure, including a missing folder — this is a
 * best-effort aggregate read, not a base read of a read-modify-write.
 */
export async function readAllWorkspaceErrors(
  directoryHandle: DirectoryHandleLike
): Promise<PersistedErrorEntry[]> {
  try {
    const dir = await getSystemErrorsDir(directoryHandle, false);
    const { values } = await readJsonDirectory<UserErrorLogFile>(dir, {
      suffix: ERRORS_FILE_SUFFIX,
      onUnreadable: "skip",
    });
    return mergeErrorEntries(values.map((file) => (Array.isArray(file?.entries) ? file.entries : [])));
  } catch (error) {
    logError(`${ERRORLOG_INTERNAL_CONTEXT_PREFIX}read`, error);
    return [];
  }
}

/**
 * Read a per-year error archive: every `{stem}.errors.{year}.json` in
 * `system-errors/`, merged oldest first. Empty array when none exist or on
 * any failure.
 */
export async function readWorkspaceErrorArchive(
  directoryHandle: DirectoryHandleLike,
  year: number
): Promise<PersistedErrorEntry[]> {
  try {
    const dir = await getSystemErrorsDir(directoryHandle, false);
    const { values } = await readJsonDirectory<ErrorLogArchiveFile>(dir, {
      suffix: `.errors.${year}.json`,
      onUnreadable: "skip",
    });
    return mergeErrorEntries(values.map((file) => (Array.isArray(file?.entries) ? file.entries : [])));
  } catch (error) {
    logError(`${ERRORLOG_INTERNAL_CONTEXT_PREFIX}read-archive`, error);
    return [];
  }
}
