/**
 * Test-only helpers for the selective-restore suites (Workstream D). Never
 * imported by app code. Builds hand-made backup folders directly under
 * `5-system/backups/{folder}/json/` with nested workspace-relative paths, so a
 * test controls the restore source exactly (the same idea as
 * backupStorage.test.ts's seedBackupJsonFiles, generalised to nested trees).
 */
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { createMemoryDirectory } from "../storage/memoryDirectory";
import { safeReadJson, safeWriteJson } from "../storage/safeWrite";
import { getSystemRoot, SYSTEM_FOLDER_NAMES } from "../workspace/workspacePaths";
import { BACKUP_JSON_FOLDER } from "./backupStorage";
import { RESTORE_INPROGRESS_FILE } from "./restoreSentinel";

export const TEST_BACKUP = "2026-05-31T10-00-00-manual-test";
export const M1 = "5-may-2026";
export const M2 = "6-june-2026";

export function makeRoot(): DirectoryHandleLike {
  return createMemoryDirectory("root") as DirectoryHandleLike;
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { name?: string }).name === "NotFoundError");
}

export async function dirAt(base: DirectoryHandleLike, segments: readonly string[]): Promise<DirectoryHandleLike> {
  let current = base;
  for (const segment of segments) current = await current.getDirectoryHandle(segment, { create: true });
  return current;
}

export async function writeJsonAt(base: DirectoryHandleLike, path: string, value: unknown): Promise<void> {
  const segments = path.split("/");
  const dir = await dirAt(base, segments.slice(0, -1));
  await safeWriteJson(dir, segments[segments.length - 1], value);
}

/** Raw bytes, no envelope — how NDJSON segments are written. */
export async function writeRawAt(base: DirectoryHandleLike, path: string, text: string): Promise<void> {
  const segments = path.split("/");
  const dir = await dirAt(base, segments.slice(0, -1));
  const handle = await dir.getFileHandle(segments[segments.length - 1], { create: true });
  if (!handle.createWritable) throw new Error(`test kit cannot write ${path}: no createWritable`);
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
}

export async function openDir(
  base: DirectoryHandleLike,
  segments: readonly string[]
): Promise<DirectoryHandleLike | null> {
  let current = base;
  try {
    for (const segment of segments) current = await current.getDirectoryHandle(segment, { create: false });
    return current;
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

export async function readJsonAt<T>(base: DirectoryHandleLike, path: string): Promise<T | null> {
  const segments = path.split("/");
  const dir = await openDir(base, segments.slice(0, -1));
  if (!dir) return null;
  const result = await safeReadJson<T>(dir, segments[segments.length - 1]);
  return result.ok ? result.value : null;
}

export async function readRawAt(base: DirectoryHandleLike, path: string): Promise<string | null> {
  const segments = path.split("/");
  const dir = await openDir(base, segments.slice(0, -1));
  if (!dir) return null;
  try {
    const handle = await dir.getFileHandle(segments[segments.length - 1], { create: false });
    return await (await handle.getFile()).text();
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

export async function listNames(dir: DirectoryHandleLike): Promise<string[]> {
  const iterable = (dir as DirectoryHandleLike & { values: () => AsyncIterable<{ name: string }> }).values();
  const names: string[] = [];
  for await (const entry of iterable) names.push(entry.name);
  return names.sort();
}

export function ndjson(events: ReadonlyArray<Record<string, unknown>>): string {
  return events.map((event) => `${JSON.stringify(event)}\n`).join("");
}

export function distEvent(id: string, xrayImageId = `XR-${id}`): Record<string, unknown> {
  return {
    eventId: id,
    eventType: "assigned",
    xrayImageId,
    assignedTo: "employee01",
    eventAt: "2026-05-01T08:00:00.000Z",
    eventBy: "admin",
  };
}

export type SeedBackupOptions = {
  folderName?: string;
  /** false = omit backup.complete.json (an interrupted backup). */
  complete?: boolean;
  createdAt?: string;
};

export async function seedBackup(
  root: DirectoryHandleLike,
  files: Record<string, unknown>,
  rawFiles: Record<string, string> = {},
  options: SeedBackupOptions = {}
): Promise<void> {
  const folderName = options.folderName ?? TEST_BACKUP;
  const createdAt = options.createdAt ?? "2026-05-31T10:00:00.000Z";
  const systemDir = await getSystemRoot(root, true);
  const backupDir = await dirAt(systemDir, [SYSTEM_FOLDER_NAMES.backups, folderName]);
  const mirrorDir = await dirAt(backupDir, [BACKUP_JSON_FOLDER]);
  for (const [path, value] of Object.entries(files)) await writeJsonAt(mirrorDir, path, value);
  for (const [path, text] of Object.entries(rawFiles)) await writeRawAt(mirrorDir, path, text);
  await safeWriteJson(backupDir, "backup.manifest.json", {
    createdAt,
    createdBy: "admin",
    mode: "manual",
    monthsFolders: [],
    jsonFilesBackedUp: [],
    xlsxFilesBackedUp: [],
    datasets: [],
    rowLimitPerWorkbookPart: 25_000,
    excelSheetRowLimit: 1_048_576,
  });
  if (options.complete === false) return;
  await safeWriteJson(backupDir, "backup.complete.json", { completedAt: createdAt });
}

export async function backupFolderNames(root: DirectoryHandleLike): Promise<string[]> {
  const systemDir = await getSystemRoot(root, false);
  return listNames(await systemDir.getDirectoryHandle(SYSTEM_FOLDER_NAMES.backups, { create: false }));
}

export async function sentinelExists(root: DirectoryHandleLike): Promise<boolean> {
  const systemDir = await getSystemRoot(root, false);
  try {
    await systemDir.getFileHandle(RESTORE_INPROGRESS_FILE, { create: false });
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}
