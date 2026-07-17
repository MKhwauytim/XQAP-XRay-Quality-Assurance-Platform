import type { AuthSession } from "./authTypes";
import type { DirectoryHandleLike } from "../data/storage/fileSystemAccess";
import { safeReadJson, safeWriteJson } from "../data/storage/safeWrite";
import { casLoop } from "../data/storage/casLoop";
import { getSystemRoot, SYSTEM_FOLDER_NAMES } from "../data/workspace/workspacePaths";

const ACTIVITY_LOG_FILE = "activity.log.json";
const MAX_ACTIVITY_LOG_ENTRIES = 5000;

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

export type AuthActivityLogFile = {
  revision: number;
  /** Per-write UUID embedded by casLoop for cross-machine race detection. */
  _writeToken?: string;
  updatedAt: string;
  entries: AuthActivityLogEntry[];
};

let activeActivityId: string | null = null;
let workspaceHandle: DirectoryHandleLike | null = null;
let memoryEntries: AuthActivityLogEntry[] = [];
let writeChain: Promise<void> = Promise.resolve();

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

function mergeEntries(
  first: AuthActivityLogEntry[],
  second: AuthActivityLogEntry[]
): AuthActivityLogEntry[] {
  const byId = new Map<string, AuthActivityLogEntry>();
  for (const entry of [...first, ...second]) byId.set(entry.id, entry);
  return [...byId.values()]
    .sort((a, b) => Date.parse(a.signedInAt) - Date.parse(b.signedInAt))
    .slice(-MAX_ACTIVITY_LOG_ENTRIES);
}

function updateMemoryEntry(
  updater: (entry: AuthActivityLogEntry) => AuthActivityLogEntry
): void {
  memoryEntries = memoryEntries.map((entry) =>
    activeActivityId === entry.id && !entry.signedOutAt ? updater(entry) : entry
  );
}

async function getActivityAuditDir(create: boolean): Promise<DirectoryHandleLike | null> {
  if (!workspaceHandle) return null;
  try {
    const systemDir = await getSystemRoot(workspaceHandle, create);
    return systemDir.getDirectoryHandle(SYSTEM_FOLDER_NAMES.audit, { create });
  } catch {
    return null;
  }
}

async function readDiskLog(): Promise<AuthActivityLogFile> {
  const dir = await getActivityAuditDir(false);
  if (!dir) return { revision: 0, updatedAt: nowIso(), entries: [] };

  const result = await safeReadJson<AuthActivityLogFile>(dir, ACTIVITY_LOG_FILE);
  if (!result.ok) return { revision: 0, updatedAt: nowIso(), entries: [] };

  return {
    revision: result.value.revision ?? 0,
    _writeToken: result.value._writeToken,
    updatedAt: result.value.updatedAt ?? nowIso(),
    entries: Array.isArray(result.value.entries) ? result.value.entries.filter(isValidEntry) : [],
  };
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

async function flushMemoryToWorkspace(): Promise<void> {
  const dir = await getActivityAuditDir(true);
  if (!dir) return;

  // Shared, multi-writer audit file (every machine's login/logout/heartbeat).
  // The in-module writeChain serializes same-tab flushes; casLoop re-reads disk
  // fresh each attempt, merges by session id, bumps revision + stamps _writeToken,
  // and verifies both on read-back so a concurrent machine's entries are never
  // silently dropped by this flush. `memoryEntries` advances only on a verified
  // write, so a losing writer retries with fresh state on the next flush.
  //
  // No delayed verify: the merge-by-session-id pattern is self-healing — a
  // losing writer's entries survive (memoryEntries only advances on a
  // verified write) and are picked up whole on the next flush attempt.
  await casLoop<{ ok: true }>(
    async (writeToken) => {
      const existing = await readDiskLog();
      const entries = mergeEntries(existing.entries, memoryEntries);
      const nextRevision = existing.revision + 1;
      await safeWriteJson<AuthActivityLogFile>(dir, ACTIVITY_LOG_FILE, {
        revision: nextRevision,
        _writeToken: writeToken,
        updatedAt: nowIso(),
        entries,
      });
      const verify = await readDiskLog();
      if (verify.revision === nextRevision && verify._writeToken === writeToken) {
        memoryEntries = entries;
        return { done: true, result: { ok: true as const } };
      }
      return { done: false };
    },
    { conflictError: "تعذّر حفظ سجل نشاط الجلسات: تعارض في الكتابة بعد عدة محاولات." }
  );
  // Best-effort: queueFlush already swallows failures. A persistent conflict just
  // leaves memoryEntries intact to retry on the next flush (no silent drop).
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
  queueFlush();
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

export async function readAuthActivityLog(): Promise<AuthActivityLogEntry[]> {
  await writeChain;
  if (!workspaceHandle) return memoryEntries;
  const disk = await readDiskLog();
  return mergeEntries(disk.entries, memoryEntries);
}

export async function waitForAuthActivityLogFlush(): Promise<void> {
  await writeChain;
}

export function resetAuthActivityLogForTests(): void {
  activeActivityId = null;
  workspaceHandle = null;
  memoryEntries = [];
  writeChain = Promise.resolve();
}
