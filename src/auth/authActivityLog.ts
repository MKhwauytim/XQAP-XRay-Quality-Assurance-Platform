/**
 * Session activity trail (sign-in / heartbeat / sign-out per user).
 *
 * **Per-user files since the 2026-08-19 owner directive.** Every signed-in
 * employee used to rewrite ONE shared `5-system/audit/activity.log.json` in
 * full — measured at 483 whole-file rewrites per employee per 8-hour shift —
 * so a dozen employees starting work at the same time hammered the busiest file
 * on the share, and one writer's failure occupied the write chain (and blocked
 * `readAuthActivityLog`) for everyone. Each user now owns exactly one file,
 * `5-system/audit/activity/{stem}.activity.json`, and writes only that.
 *
 * **The legacy shared file is read on every aggregate read, written never,
 * deleted never, migrated never.** Same doctrine `workspaceSchema.ts` applies to
 * legacy roots: existing field workspaces keep working and their history stays
 * visible in the admin view, without a migration step that could lose it.
 */

import type { AuthSession } from "./authTypes";
import type { DirectoryHandleLike } from "../data/storage/fileSystemAccess";
import { safeReadJson, safeWriteJson } from "../data/storage/safeWrite";
import { casLoop } from "../data/storage/casLoop";
import { withResourceLock } from "../data/storage/webLocks";
import { readJsonDirectory } from "../data/storage/directoryScan";
import { getAuditRoot, getAuditActivityDir } from "../data/workspace/workspacePaths";
import { ACTIVITY_FILE_SUFFIX, activityFileName } from "../data/audit/auditPaths";

/** LEGACY shared file. Read forever, never written. */
const ACTIVITY_LOG_FILE = "activity.log.json";

/** Display cap on the MERGED view (legacy ∪ every per-user file ∪ this session). */
const MAX_ACTIVITY_LOG_ENTRIES = 5000;

/**
 * Retention cap inside ONE user's own file. The old 5000 was a fleet cap; 2000
 * sign-ins is a very long history for a single person.
 */
const MAX_OWN_ACTIVITY_ENTRIES = 2000;

/**
 * Heartbeat coalescing window. The heartbeat fires every 60 s and used to queue
 * a whole-file write each time. `memoryEntries` is still updated on every tick
 * (so the in-session view and the next flush are exact); only the disk write is
 * throttled. Sign-in, sign-out, `pagehide` and workspace (re)configuration all
 * still flush unconditionally, so nothing is lost by waiting.
 */
const ACTIVITY_FLUSH_INTERVAL_MS = 5 * 60 * 1000;

export type AuthActivityCloseReason =
  | "logout"
  | "expired"
  | "session-replaced"
  | "page-closed";

export type AuthActivityLogEntry = {
  id: string;
  username: string;
  role: AuthSession["role"];
  signedInAt: string;
  lastSeenAt: string;
  signedOutAt: string | null;
  durationMs: number;
  closeReason: AuthActivityCloseReason | null;
};

/** Shape of the LEGACY shared `activity.log.json`. Read-only. */
export type AuthActivityLogFile = {
  revision: number;
  /** Per-write UUID embedded by casLoop for cross-machine race detection. */
  _writeToken?: string;
  updatedAt: string;
  entries: AuthActivityLogEntry[];
};

/** Shape of one user's own `{stem}.activity.json` — the only file this module writes. */
export type AuthActivityUserLogFile = {
  /**
   * RAW, unsanitized username. Informational only: the merge attributes every
   * entry from `entry.username`, never from this field or from the file name.
   */
  username: string;
  revision: number;
  _writeToken?: string;
  updatedAt: string;
  entries: AuthActivityLogEntry[];
};

let activeActivityId: string | null = null;
let workspaceHandle: DirectoryHandleLike | null = null;
let memoryEntries: AuthActivityLogEntry[] = [];
let writeChain: Promise<void> = Promise.resolve();
let lastFlushAt = 0;

function nowIso(): string {
  return new Date().toISOString();
}

function createActivityId(session: AuthSession): string {
  const suffix = Math.random().toString(36).slice(2, 10);
  return `auth-${session.username}-${Date.now()}-${suffix}`;
}

function calculateDurationMs(entry: Pick<AuthActivityLogEntry, "signedInAt" | "lastSeenAt">): number {
  const start = Date.parse(entry.signedInAt);
  const end = Date.parse(entry.lastSeenAt);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return 0;
  return end - start;
}

/**
 * Duplicate-id rule: **the entry with the later `lastSeenAt` wins.**
 *
 * This is the only correct rule once the legacy file and the per-user files are
 * merged: a session that started before the upgrade lives in the legacy file
 * AND is later extended by heartbeats into the per-user file, and the extended
 * copy is the true one. An unparsable timestamp loses to a parsable one; when
 * both are unparsable the later argument wins, keeping the merge deterministic.
 */
function pickNewer(
  current: AuthActivityLogEntry,
  candidate: AuthActivityLogEntry
): AuthActivityLogEntry {
  const currentAt = Date.parse(current.lastSeenAt);
  const candidateAt = Date.parse(candidate.lastSeenAt);
  if (Number.isNaN(candidateAt)) return Number.isNaN(currentAt) ? candidate : current;
  if (Number.isNaN(currentAt)) return candidate;
  return candidateAt >= currentAt ? candidate : current;
}

/**
 * Ascending by `signedInAt`, tie-broken by `id`. The tie-break is what makes two
 * clients reading the same folder produce the same list — `readJsonDirectory`
 * already name-sorts its files, so the input order is deterministic too.
 */
function compareEntries(a: AuthActivityLogEntry, b: AuthActivityLogEntry): number {
  const aAt = Date.parse(a.signedInAt);
  const bAt = Date.parse(b.signedInAt);
  // An unparsable timestamp sorts as oldest rather than poisoning the comparator.
  const aValue = Number.isNaN(aAt) ? -Infinity : aAt;
  const bValue = Number.isNaN(bAt) ? -Infinity : bAt;
  if (aValue !== bValue) return aValue - bValue;
  return a.id.localeCompare(b.id);
}

function mergeEntries(
  first: AuthActivityLogEntry[],
  second: AuthActivityLogEntry[],
  cap: number = MAX_ACTIVITY_LOG_ENTRIES
): AuthActivityLogEntry[] {
  const byId = new Map<string, AuthActivityLogEntry>();
  for (const entry of [...first, ...second]) {
    const existing = byId.get(entry.id);
    byId.set(entry.id, existing ? pickNewer(existing, entry) : entry);
  }
  return [...byId.values()].sort(compareEntries).slice(-cap);
}

function updateMemoryEntry(
  updater: (entry: AuthActivityLogEntry) => AuthActivityLogEntry
): void {
  memoryEntries = memoryEntries.map((entry) =>
    activeActivityId === entry.id && !entry.signedOutAt ? updater(entry) : entry
  );
}

function emptyDiskLog(): AuthActivityLogFile {
  return { revision: 0, updatedAt: nowIso(), entries: [] };
}

function isValidEntry(value: unknown): value is AuthActivityLogEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<AuthActivityLogEntry>;
  return (
    typeof entry.id === "string" &&
    typeof entry.username === "string" &&
    typeof entry.role === "string" &&
    typeof entry.signedInAt === "string" &&
    typeof entry.lastSeenAt === "string" &&
    (typeof entry.signedOutAt === "string" || entry.signedOutAt === null) &&
    typeof entry.durationMs === "number" &&
    (typeof entry.closeReason === "string" || entry.closeReason === null)
  );
}

/**
 * The LEGACY shared log, or `null` when the file is there but could not be read.
 *
 * Read-only by contract: nothing in this module writes `activity.log.json` any
 * more. A pre-upgrade field workspace keeps every recorded sign-in, and it keeps
 * showing up in the admin Activity view through `readAuthActivityLog`'s union.
 */
async function readLegacyDiskLog(): Promise<AuthActivityLogFile | null> {
  if (!workspaceHandle) return emptyDiskLog();
  let dir: DirectoryHandleLike;
  try {
    dir = await getAuditRoot(workspaceHandle, false);
  } catch {
    return emptyDiskLog();
  }

  const result = await safeReadJson<AuthActivityLogFile>(dir, ACTIVITY_LOG_FILE);
  if (!result.ok) return result.reason === "missing" ? emptyDiskLog() : null;

  return {
    revision: result.value.revision ?? 0,
    _writeToken: result.value._writeToken,
    updatedAt: result.value.updatedAt ?? nowIso(),
    entries: Array.isArray(result.value.entries) ? result.value.entries.filter(isValidEntry) : [],
  };
}

/**
 * One user's own file, or `null` when it is present but unreadable — the same
 * distinction the shared file needed, and for the same reason: this is the base
 * read of a read-modify-write, and an empty shell substituted for an unreadable
 * file is a whole-file replacement, not a neutral starting point.
 */
async function readUserLog(
  dir: DirectoryHandleLike,
  username: string
): Promise<AuthActivityUserLogFile | null> {
  const result = await safeReadJson<AuthActivityUserLogFile>(dir, activityFileName(username));
  if (!result.ok) {
    return result.reason === "missing"
      ? { username, revision: 0, updatedAt: nowIso(), entries: [] }
      : null;
  }
  return {
    username: typeof result.value.username === "string" ? result.value.username : username,
    revision: result.value.revision ?? 0,
    _writeToken: result.value._writeToken,
    updatedAt: result.value.updatedAt ?? nowIso(),
    entries: Array.isArray(result.value.entries) ? result.value.entries.filter(isValidEntry) : [],
  };
}

/**
 * Every per-user file in `5-system/audit/activity/`.
 *
 * A directory that does not exist yet (fresh or pre-upgrade workspace) resolves
 * to `[]`, never to an error. An unreadable individual file is SKIPPED, not
 * fatal — one employee's damaged file must not hide the whole fleet's history.
 */
async function readAllUserLogs(): Promise<AuthActivityLogEntry[]> {
  if (!workspaceHandle) return [];
  try {
    const dir = await getAuditActivityDir(workspaceHandle, false);
    const { values } = await readJsonDirectory<AuthActivityUserLogFile>(dir, {
      suffix: ACTIVITY_FILE_SUFFIX,
      onUnreadable: "skip",
    });
    const entries: AuthActivityLogEntry[] = [];
    for (const file of values) {
      if (!file || !Array.isArray(file.entries)) continue;
      for (const entry of file.entries) if (isValidEntry(entry)) entries.push(entry);
    }
    return entries;
  } catch {
    return [];
  }
}

/**
 * Flush one user's pending entries into that user's own file.
 *
 * The per-user lock key is the point: two tabs of the SAME user serialize
 * properly (the old code had no outer lock at all, only an in-module promise
 * chain), and two DIFFERENT users no longer serialize against each other.
 */
async function flushUser(
  dir: DirectoryHandleLike,
  username: string,
  pending: AuthActivityLogEntry[]
): Promise<void> {
  const fileName = activityFileName(username);
  await withResourceLock(`audit/activity/${fileName}:rmw`, () =>
    casLoop<{ ok: true } | { skipped: true }>(
      async (writeToken) => {
        const existing = await readUserLog(dir, username);
        if (!existing) {
          // Present but unreadable. Retrying cannot mend the file, and writing
          // over it would destroy the history it still holds, so abandon this
          // flush — the pending entries stay in memory for a later attempt.
          return { done: true, result: { skipped: true as const } };
        }
        const entries = mergeEntries(existing.entries, pending, MAX_OWN_ACTIVITY_ENTRIES);
        const nextRevision = existing.revision + 1;
        await safeWriteJson<AuthActivityUserLogFile>(dir, fileName, {
          username,
          revision: nextRevision,
          _writeToken: writeToken,
          updatedAt: nowIso(),
          entries,
        });
        const verify = await readUserLog(dir, username);
        // An unreadable read-back proves nothing landed verifiably: retry rather
        // than advance memoryEntries past a write we cannot confirm.
        if (verify && verify.revision === nextRevision && verify._writeToken === writeToken) {
          // Advance ONLY this user's slice — another user's pending entries in
          // the same process must stay pending until their own file is written.
          const written = new Map(entries.map((entry) => [entry.id, entry]));
          memoryEntries = memoryEntries.map((entry) =>
            entry.username === username ? (written.get(entry.id) ?? entry) : entry
          );
          return { done: true, result: { ok: true as const } };
        }
        return { done: false };
      },
      { conflictError: "تعذّر حفظ سجل نشاط الجلسات: تعارض في الكتابة بعد عدة محاولات." }
    )
  );
  // Best-effort: queueFlush already swallows failures. A persistent conflict just
  // leaves memoryEntries intact to retry on the next flush (no silent drop).
}

async function flushMemoryToWorkspace(): Promise<void> {
  if (!workspaceHandle) return;
  let dir: DirectoryHandleLike;
  try {
    dir = await getAuditActivityDir(workspaceHandle, true);
  } catch {
    return;
  }

  lastFlushAt = Date.now();

  // Group by username. Not theoretical: `startAuthActivitySession` merges into
  // the module-level `memoryEntries`, so if user A logs out and user B logs in
  // on the same tab, both are pending in one process. Grouping is what keeps the
  // "one writer per file" property honest.
  const byUser = new Map<string, AuthActivityLogEntry[]>();
  for (const entry of memoryEntries) {
    const bucket = byUser.get(entry.username);
    if (bucket) bucket.push(entry);
    else byUser.set(entry.username, [entry]);
  }

  for (const [username, pending] of byUser) {
    await flushUser(dir, username, pending);
  }
}

function queueFlush(): void {
  writeChain = writeChain
    .then(() => flushMemoryToWorkspace())
    .catch(() => undefined);
}

export function configureAuthActivityLogWorkspace(directoryHandle: DirectoryHandleLike | null): void {
  workspaceHandle = directoryHandle;
  if (workspaceHandle) queueFlush();
}

export function startAuthActivitySession(session: AuthSession): void {
  endAuthActivitySession("session-replaced");

  const timestamp = nowIso();
  const entry: AuthActivityLogEntry = {
    id: createActivityId(session),
    username: session.username,
    role: session.role,
    signedInAt: session.loginAt,
    lastSeenAt: timestamp,
    signedOutAt: null,
    durationMs: Math.max(0, Date.parse(timestamp) - Date.parse(session.loginAt)),
    closeReason: null,
  };

  activeActivityId = entry.id;
  memoryEntries = mergeEntries(memoryEntries, [entry]);
  queueFlush();
}

export function recordAuthActivityHeartbeat(): void {
  if (!activeActivityId) return;

  const timestamp = nowIso();
  updateMemoryEntry((entry) => {
    const updated = { ...entry, lastSeenAt: timestamp };
    return { ...updated, durationMs: calculateDurationMs(updated) };
  });
  // Coalesced: the in-memory entry is always current, the disk write is not.
  // Sign-out and pagehide flush unconditionally, so the durable record still
  // lands promptly at the points that matter.
  if (Date.now() - lastFlushAt >= ACTIVITY_FLUSH_INTERVAL_MS) queueFlush();
}

export function endAuthActivitySession(reason: AuthActivityCloseReason): void {
  if (!activeActivityId) return;

  const timestamp = nowIso();
  updateMemoryEntry((entry) => {
    const updated = {
      ...entry,
      lastSeenAt: timestamp,
      signedOutAt: timestamp,
      closeReason: reason,
    };
    return { ...updated, durationMs: calculateDurationMs(updated) };
  });

  activeActivityId = null;
  queueFlush();
}

/**
 * The MERGED view every admin screen reads: every per-user file ∪ the legacy
 * shared file ∪ this session's not-yet-flushed state, deduped by `entry.id`
 * (later `lastSeenAt` wins), sorted ascending by `signedInAt` and tie-broken by
 * `id`, capped to the newest `MAX_ACTIVITY_LOG_ENTRIES`.
 */
export async function readAuthActivityLog(): Promise<AuthActivityLogEntry[]> {
  await writeChain;
  if (!workspaceHandle) return mergeEntries([], memoryEntries);
  const [perUser, legacy] = await Promise.all([readAllUserLogs(), readLegacyDiskLog()]);
  // An unreadable legacy file degrades to "show what is readable", exactly as
  // an unreadable per-user file does — never to nothing.
  return mergeEntries(mergeEntries(legacy?.entries ?? [], perUser), memoryEntries);
}

export async function waitForAuthActivityLogFlush(): Promise<void> {
  await writeChain;
}

export function resetAuthActivityLogForTests(): void {
  activeActivityId = null;
  workspaceHandle = null;
  memoryEntries = [];
  writeChain = Promise.resolve();
  lastFlushAt = 0;
}
