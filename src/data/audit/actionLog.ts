/**
 * Workspace action audit trail — records governance-relevant actions
 * (user deletion, permission changes, sample draws, referral decisions,
 * month close/reopen, backup restores) in an append-only log.
 *
 * **Per-actor files since the 2026-08-19 owner directive.** Every actor used to
 * append to one shared `5-system/audit/actions.log.json` through a whole-file
 * read-modify-write with the shortest retry ladder in the app (~0.4 s), which on
 * a shared SMB folder is not a ladder at all. Each actor now writes only
 * `5-system/audit/actions/{stem}.actions.json`, with per-actor per-year
 * archives alongside it.
 *
 * **The legacy shared files — `actions.log.json` and
 * `actions.archive.{year}.json` — are read on every aggregate read, written
 * never, deleted never, migrated never.** Existing field workspaces keep
 * working and their history stays visible in the admin Actions view.
 *
 * Deliberately a separate file family from the activity log (session-shaped,
 * merge-by-id/heartbeat schema) — do not mix the two.
 *
 * Best-effort by contract: `appendWorkspaceAction` never throws to callers
 * (failures go to the error ring buffer) and silently skips when no
 * workspace is connected. It is intentionally NOT gated by the month lock:
 * it must be able to record `month-closed` itself.
 */

import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { readOptionalJson, safeWriteJson } from "../storage/safeWrite";
import { casLoop } from "../storage/casLoop";
import { withResourceLock } from "../storage/webLocks";
import { readJsonDirectory } from "../storage/directoryScan";
import { simpleHash } from "../storage/jsonEnvelope";
import { logError } from "../storage/errorLogger";
import { getAuditRoot, getAuditActionsDir } from "../workspace/workspacePaths";
import {
  ACTIONS_FILE_SUFFIX,
  actionsArchiveFileName,
  actionsFileName,
} from "./auditPaths";

/** LEGACY shared files. Read forever, never written. */
const ACTIONS_LOG_FILE = "actions.log.json";

// Per-actor live-log retention cap. When exceeded, the oldest overflow is
// appended to that actor's per-year archive file BEFORE the live log is trimmed
// (A6). Was 10,000 for the whole workspace; 2,000 is a long history for one
// actor. A `let` + test seam so archival can be exercised without writing 2k
// entries.
const DEFAULT_MAX_ACTION_ENTRIES = 2_000;
let maxActionEntries = DEFAULT_MAX_ACTION_ENTRIES;

/** @internal — test-only. Lower the live-log cap to exercise archival cheaply. */
export function __setMaxActionEntriesForTests(limit: number): void {
  maxActionEntries = limit;
}

/** @internal — test-only. Restore the production cap. */
export function __resetMaxActionEntriesForTests(): void {
  maxActionEntries = DEFAULT_MAX_ACTION_ENTRIES;
}

/** LEGACY workspace-wide per-year archive. Read forever, never written. */
function legacyArchiveFileName(year: number): string {
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
   * docs/architecture/SECURITY_MODEL.md); it catches accidental/out-of-band edits.
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
  // ── users & permissions ────────────────────────────────────────────────────
  | "user-deleted"
  | "user-created"
  | "user-updated"
  | "user-password-reset"
  | "permission-changed"
  | "feature-permission-changed"
  // ── population, sampling & distribution ────────────────────────────────────
  | "population-saved"
  | "sample-drawn"
  | "distribution-bulk-assigned"
  | "distribution-row-changed"
  // ── referral / replacement / reopen workflow ───────────────────────────────
  | "referral-requested"
  | "referral-approved"
  | "referral-denied"
  | "replacement-requested"
  | "replacement-applied"
  | "replacement-approved"
  | "replacement-denied"
  | "reopen-requested"
  | "reopen-approved"
  | "reopen-denied"
  | "decision-reverted"
  // ── answers ────────────────────────────────────────────────────────────────
  | "answer-submitted"
  | "answer-submitted-on-behalf"
  | "answer-quality-note-set"
  | "answer-reopened"
  // ── ad-hoc / exceptional-case imports ──────────────────────────────────────
  | "adhoc-import-created"
  | "adhoc-rows-assigned"
  | "adhoc-historical-imported"
  | "adhoc-import-closed"
  | "adhoc-import-reopened"
  // ── inspection templates ───────────────────────────────────────────────────
  | "template-created"
  | "template-updated"
  | "template-deleted"
  | "inspection-template-selected"
  // ── notifications ──────────────────────────────────────────────────────────
  | "notification-posted"
  | "notification-edited"
  | "notification-deleted"
  | "notification-restored"
  // ── months, backups & workspace settings ───────────────────────────────────
  | "month-closed"
  | "month-reopened"
  | "backup-created"
  | "backup-restored"
  | "backup-settings-changed"
  | "label-override-changed"
  | "sync-interval-changed"
  | "admin-account-changed"
  | "report-generated";

/**
 * Every `WorkspaceActionType`, in union order — the canonical enumeration.
 *
 * TypeScript cannot iterate a string-literal union, and more than one consumer
 * needs the full list (the viewer's type picker, its "select all", and the
 * round-trip test that proves each type survives a write/read cycle). Keeping
 * it here, next to the union it mirrors, is what makes the exhaustiveness
 * checks possible: `actionCatalog.ts` maps every entry to a label and a group
 * and a test compares both against this array, so a type added to the union
 * without a label or a group fails the suite instead of shipping.
 */
export const ALL_ACTION_TYPES: readonly WorkspaceActionType[] = [
  "user-deleted",
  "user-created",
  "user-updated",
  "user-password-reset",
  "permission-changed",
  "feature-permission-changed",
  "population-saved",
  "sample-drawn",
  "distribution-bulk-assigned",
  "distribution-row-changed",
  "referral-requested",
  "referral-approved",
  "referral-denied",
  "replacement-requested",
  "replacement-applied",
  "replacement-approved",
  "replacement-denied",
  "reopen-requested",
  "reopen-approved",
  "reopen-denied",
  "decision-reverted",
  "answer-submitted",
  "answer-submitted-on-behalf",
  "answer-quality-note-set",
  "answer-reopened",
  "adhoc-import-created",
  "adhoc-rows-assigned",
  "adhoc-historical-imported",
  "adhoc-import-closed",
  "adhoc-import-reopened",
  "template-created",
  "template-updated",
  "template-deleted",
  "inspection-template-selected",
  "notification-posted",
  "notification-edited",
  "notification-deleted",
  "notification-restored",
  "month-closed",
  "month-reopened",
  "backup-created",
  "backup-restored",
  "backup-settings-changed",
  "label-override-changed",
  "sync-interval-changed",
  "admin-account-changed",
  "report-generated",
];

/**
 * Types whose entry count scales with routine reviewer throughput rather than
 * with governance events, and which the Actions viewer therefore leaves
 * UNCHECKED on first render (the reader switches them on deliberately).
 *
 * `answer-submitted` is the big one: roughly 6,500 entries a month on a real
 * workspace. That is safe to record — the live log is capped PER ACTOR at
 * `DEFAULT_MAX_ACTION_ENTRIES` and overflows into per-actor per-year archives
 * before it is trimmed (see `archiveOverflow`), so no single file grows without
 * bound and no employee's volume evicts anyone else's history — but it would
 * bury every governance action in the default view, which is what the filter
 * default exists to prevent.
 *
 * `answer-submitted-on-behalf` is deliberately NOT here. It is rare (a
 * supervisor authoring someone else's assignment) and it is precisely the
 * accountability record the log exists for, so it stays visible by default.
 */
export const HIGH_VOLUME_ACTION_TYPES: readonly WorkspaceActionType[] = [
  "answer-submitted",
  "label-override-changed",
];

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
   * appended to a per-year archive BEFORE being trimmed here (A6) — never
   * dropped without archiving. Archive failure blocks the trim.
   */
  entries: WorkspaceActionEntry[];
};

/** One actor's own live log — the only live-log shape this module writes. */
export type WorkspaceActionUserLogFile = WorkspaceActionLogFile & {
  /** RAW, unsanitized actor name. Informational; entries carry their own `actor`. */
  actor: string;
};

/**
 * There is deliberately no separate per-actor ARCHIVE type: the archive payload
 * is unchanged and the actor scoping lives entirely in the file name, so a
 * legacy `actions.archive.{year}.json` and a new `{stem}.actions.{year}.json`
 * hash identically through `hashActionArchive` (the B5 chain link).
 */

/** Caller-supplied fields; `id` and `at` are stamped on append. */
export type WorkspaceActionInput = Omit<WorkspaceActionEntry, "id" | "at">;

function createActionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `act-${crypto.randomUUID()}`;
  }
  return `act-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * The LEGACY shared live log, or an empty shell for a workspace that has none.
 *
 * **Throws when the log exists but could not be read.** This is the base read of
 * an append-only read-modify-write: the empty shell is not a neutral starting
 * point, it is a whole-file replacement that truncates the audit trail to the
 * single entry being appended — and reports success. A missing audit folder is
 * normal for a fresh workspace and still yields the shell; nothing else does.
 *
 * Read-only since the per-actor split: nothing writes `actions.log.json` any
 * more, but every aggregate read still unions it in.
 */
async function readLegacyLogFile(
  directoryHandle: DirectoryHandleLike
): Promise<WorkspaceActionLogFile> {
  const read = await readOptionalJson<WorkspaceActionLogFile>(
    `audit:${ACTIONS_LOG_FILE}`,
    [{ directory: () => getAuditRoot(directoryHandle, false), fileName: ACTIONS_LOG_FILE }]
  );
  if (read.kind === "found") {
    return {
      revision: read.value.revision ?? 0,
      _writeToken: read.value._writeToken,
      updatedAt: read.value.updatedAt ?? new Date().toISOString(),
      entries: Array.isArray(read.value.entries) ? read.value.entries : [],
    };
  }
  return { revision: 0, updatedAt: new Date().toISOString(), entries: [] };
}

/**
 * ONE actor's live log. Same throw-on-unreadable contract as the legacy reader,
 * and it matters exactly as much per-actor: this is still the base read of a
 * read-modify-write that would otherwise truncate that actor's whole trail.
 */
async function readUserLogFile(
  directoryHandle: DirectoryHandleLike,
  actor: string
): Promise<WorkspaceActionUserLogFile> {
  const fileName = actionsFileName(actor);
  const read = await readOptionalJson<WorkspaceActionUserLogFile>(
    `audit:actions:${fileName}`,
    [{ directory: () => getAuditActionsDir(directoryHandle, false), fileName }]
  );
  if (read.kind === "found") {
    return {
      actor: typeof read.value.actor === "string" ? read.value.actor : actor,
      revision: read.value.revision ?? 0,
      _writeToken: read.value._writeToken,
      updatedAt: read.value.updatedAt ?? new Date().toISOString(),
      entries: Array.isArray(read.value.entries) ? read.value.entries : [],
    };
  }
  return { actor, revision: 0, updatedAt: new Date().toISOString(), entries: [] };
}

/**
 * Read a per-year archive file, or an empty shell when genuinely absent.
 *
 * **Throws when the archive exists but could not be read** — same reasoning as
 * `readLogFile`, and with a sharper edge: `archiveOverflow` rewrites this file
 * from what it returns, so an empty shell here would discard a whole year of
 * archived actions and then let the live-log trim proceed. The throw is caught
 * by `archiveOverflow`, which returns `false` and BLOCKS that trim, so no entry
 * is dropped without being archived first.
 */
async function readArchiveFile(
  dir: DirectoryHandleLike,
  fileName: string,
  year: number
): Promise<WorkspaceActionArchiveFile> {
  const read = await readOptionalJson<WorkspaceActionArchiveFile>(
    `audit:${fileName}`,
    [{ directory: async () => dir, fileName }]
  );
  if (read.kind === "found") {
    return {
      year,
      revision: read.value.revision ?? 0,
      updatedAt: read.value.updatedAt ?? new Date().toISOString(),
      previousArchiveHash: read.value.previousArchiveHash,
      entries: Array.isArray(read.value.entries) ? read.value.entries : [],
    };
  }
  return { year, revision: 0, updatedAt: new Date().toISOString(), entries: [] };
}

/**
 * Append overflow entries to this ACTOR's per-year archive files (A6).
 * Idempotent by entry id, so a casLoop retry cannot double-append. Returns true
 * only when every year's archive was written; a false return must BLOCK the
 * live-log trim so no entry is ever dropped without being archived first.
 *
 * The B5 `previousArchiveHash` chain is preserved in kind but narrowed in
 * scope: it now links an actor's year-N archive to the SAME actor's year-(N-1)
 * archive, rather than the workspace-wide year sequence. Tamper-evident with no
 * secret key, exactly as before.
 */
async function archiveOverflow(
  dir: DirectoryHandleLike,
  actor: string,
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
      const fileName = actionsArchiveFileName(actor, year);
      const archive = await readArchiveFile(dir, fileName, year);
      const seen = new Set(archive.entries.map((e) => e.id));
      const additions = entries.filter((e) => !seen.has(e.id));
      if (additions.length === 0) continue; // already archived (retry) — idempotent
      // B5: link this archive to the previous calendar year's archive if present.
      // Preserve an already-recorded link on subsequent appends to the same year so
      // the chain anchor stays stable; only establish it on first write of the year.
      let previousArchiveHash = archive.previousArchiveHash;
      if (previousArchiveHash === undefined) {
        const prior = await readArchiveFile(dir, actionsArchiveFileName(actor, year - 1), year - 1);
        if (prior.revision > 0) previousArchiveHash = hashActionArchive(prior);
      }
      const updated: WorkspaceActionArchiveFile = {
        year,
        revision: (archive.revision ?? 0) + 1,
        updatedAt: new Date().toISOString(),
        ...(previousArchiveHash !== undefined ? { previousArchiveHash } : {}),
        entries: [...archive.entries, ...additions],
      };
      await safeWriteJson(dir, fileName, updated);
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

  const actor = entry.actor;

  try {
    // Inside the try, not above it. `actionsFileName` throws on a non-string
    // actor (`safeWorkspaceFilePart` calls `.trim()`), and computing it outside
    // meant such a call rejected the returned promise — breaking this
    // function's "never throws to callers" contract at exactly the callers who
    // rely on it hardest, the `void`-ed fire-and-forget ones, where it surfaces
    // as an unhandled rejection instead of an error-ring entry. Now every
    // failure mode lands in the same catch.
    const fileName = actionsFileName(actor);
    // NB: `:rmw` suffix keeps this outer read-modify-write lock distinct from
    // safeWriteJson's internal `${dir.name}/${fileName}` lock (v41.36 —
    // withResourceLock is not reentrant, a colliding key self-deadlocks).
    // The key is now per-ACTOR, so two different actors no longer queue behind
    // one lock; the casLoop token still guards cross-machine races on the same
    // actor's file (two tabs, or the same account on two machines).
    const result = await withResourceLock(`audit/actions/${fileName}:rmw`, () =>
      casLoop<{ ok: true }>(
      async (writeToken) => {
        const dir = await getAuditActionsDir(directoryHandle, true);
        const existing = await readUserLogFile(directoryHandle, actor);
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
          const archived = await archiveOverflow(dir, actor, overflow);
          if (archived) {
            liveEntries = combined.slice(overflowCount);
          }
        }
        const updated: WorkspaceActionUserLogFile = {
          actor,
          revision: nextRevision,
          _writeToken: writeToken,
          updatedAt: fullEntry.at,
          entries: liveEntries,
        };
        await safeWriteJson(dir, fileName, updated);
        const verify = await readUserLogFile(directoryHandle, actor);
        if (verify.revision === nextRevision && verify._writeToken === writeToken) {
          return {
            done: true,
            result: { ok: true as const },
            verify: async () => {
              const recheck = await readUserLogFile(directoryHandle, actor);
              return recheck.revision === nextRevision && recheck._writeToken === writeToken;
            },
          };
        }
        return { done: false };
      },
      // 4 × 50 ms ≈ 0.4 s was the shortest ladder in the app and not a ladder at
      // all on a contended SMB entry.
      { maxRetries: 6, baseDelayMs: 100, conflictError: "audit append conflict" }
      )
    );
    if (!result.ok) {
      logError("audit:append", new Error(result.error));
    }
  } catch (error) {
    logError("audit:append", error);
  }
}

/**
 * Fire-and-forget shorthand over `appendWorkspaceAction`.
 *
 * Every call site is the success branch of a user operation that has already
 * committed to disk, and none of them may fail because the audit write did —
 * `appendWorkspaceAction` already resolves rather than throws, so the only
 * thing left to get wrong is the `void`. Wrapping it here means a call site is
 * one statement instead of a seven-line object literal, which matters: the two
 * busiest views in this app (`XrayReferrals`, `PopulationTab`) sit against the
 * repo's `max-lines-per-function` budget, and an audit call is not a good
 * reason to spend that budget.
 *
 * Call it AFTER the write succeeded, never before — an entry written ahead of
 * the operation claims something that may not have happened.
 */
export function recordAction(
  directoryHandle: DirectoryHandleLike | null,
  actor: string,
  actorRole: string,
  action: WorkspaceActionType,
  extra?: Pick<WorkspaceActionInput, "monthFolderName" | "target" | "details">
): void {
  void appendWorkspaceAction(directoryHandle, { actor, actorRole, action, ...extra });
}

/**
 * Dedup for action entries: **first writer wins.** Unlike an activity entry
 * (extended by heartbeats), an action entry is immutable once appended, so the
 * first copy encountered is as good as any and the rule is cheaper and stabler.
 * Sorted ascending by `at`, tie-broken by `id` so two clients reading the same
 * folder produce the same list. Newest last, matching the pre-split contract.
 */
function mergeActionEntries(groups: WorkspaceActionEntry[][]): WorkspaceActionEntry[] {
  const byId = new Map<string, WorkspaceActionEntry>();
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
 * Read every per-actor file in `5-system/audit/actions/`.
 *
 * Note the suffix arithmetic that keeps the archives out without a second
 * predicate: `"bob-1a2b3c.actions.2026.json".endsWith(".actions.json")` is
 * FALSE, because the year sits between `.actions` and `.json`. A `.includes()`
 * here would silently fold every archive into the live log — pinned by a test.
 */
async function readAllUserLogFiles(
  directoryHandle: DirectoryHandleLike
): Promise<WorkspaceActionEntry[][]> {
  try {
    const dir = await getAuditActionsDir(directoryHandle, false);
    const { values } = await readJsonDirectory<WorkspaceActionUserLogFile>(dir, {
      suffix: ACTIONS_FILE_SUFFIX,
      onUnreadable: "skip",
    });
    return values.map((file) => (Array.isArray(file?.entries) ? file.entries : []));
  } catch (error) {
    logError("audit:read", error);
    return [];
  }
}

/**
 * Read all recorded actions (newest last): every per-actor file ∪ the LEGACY
 * shared `actions.log.json`. Empty array on any failure.
 */
export async function readWorkspaceActions(
  directoryHandle: DirectoryHandleLike
): Promise<WorkspaceActionEntry[]> {
  const perActor = await readAllUserLogFiles(directoryHandle);
  let legacy: WorkspaceActionEntry[] = [];
  try {
    legacy = (await readLegacyLogFile(directoryHandle)).entries;
  } catch (error) {
    logError("audit:read", error);
    // An unreadable legacy file must not hide the per-actor trail.
  }
  return mergeActionEntries([...perActor, legacy]);
}

/**
 * Read a per-year audit archive (A6): every `{stem}.actions.{year}.json` in
 * `audit/actions/` ∪ the LEGACY workspace-wide `actions.archive.{year}.json`.
 * Empty array when none exist.
 */
export async function readWorkspaceActionArchive(
  directoryHandle: DirectoryHandleLike,
  year: number
): Promise<WorkspaceActionEntry[]> {
  const groups: WorkspaceActionEntry[][] = [];

  try {
    const dir = await getAuditActionsDir(directoryHandle, false);
    const { values } = await readJsonDirectory<WorkspaceActionArchiveFile>(dir, {
      suffix: `.actions.${year}.json`,
      onUnreadable: "skip",
    });
    for (const file of values) {
      if (Array.isArray(file?.entries)) groups.push(file.entries);
    }
  } catch (error) {
    logError("audit:read-archive", error);
  }

  try {
    const legacyDir = await getAuditRoot(directoryHandle, false);
    groups.push((await readArchiveFile(legacyDir, legacyArchiveFileName(year), year)).entries);
  } catch (error) {
    logError("audit:read-archive", error);
  }

  return mergeActionEntries(groups);
}
