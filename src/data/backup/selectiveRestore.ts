/**
 * Selective backup restore — preview, dependency plan and scoped run
 * (Workstream D, 2026-09-28). The element catalog lives in restoreScope.ts; the
 * copy walk is backupStorage.ts's restoreBackupSnapshot with a `scope`. This
 * module never copies a workspace file itself.
 */
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { listDirectoryEntries } from "../storage/directoryScan";
import { parseMonthFolderName } from "../population/monthFolder";
import { isSnapshotPayloadFile, openCompleteBackupJsonDir, restoreActionFor } from "./backupStorage";
import { classifyBackupPath, RESTORE_ELEMENT_IDS, type RestoreElementId } from "./restoreScope";

export type RestorePreviewCell = {
  element: RestoreElementId;
  month: string | null;
  fileCount: number;
};

export type RestorePreview = {
  backupFolderName: string;
  /** Month folders the backup holds restorable month-scoped files for, oldest first. */
  months: string[];
  cells: RestorePreviewCell[];
  /** Payload files no element owns — only a FULL restore puts these back. */
  unclassifiedCount: number;
};

/** Real `{m}-{month}-{yyyy}` folders chronologically, then anything else (ad-hoc stores) by name. */
export function compareMonthFolderNames(a: string, b: string): number {
  const left = parseMonthFolderName(a);
  const right = parseMonthFolderName(b);
  if (left && right) return left.year - right.year || left.month - right.month;
  if (left) return -1;
  if (right) return 1;
  return a.localeCompare(b);
}

/** Every path the restore walk would act on: payload files that are not skip-derived. */
async function listRestorablePaths(dir: DirectoryHandleLike, prefix: string, out: string[]): Promise<void> {
  for (const entry of await listDirectoryEntries(dir)) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.kind === "directory") {
      await listRestorablePaths(await dir.getDirectoryHandle(entry.name, { create: false }), path, out);
      continue;
    }
    if (isSnapshotPayloadFile(entry.name) && restoreActionFor(entry.name) !== "skip-derived") out.push(path);
  }
}

const ELEMENT_ORDER: ReadonlyMap<RestoreElementId, number> = new Map(
  RESTORE_ELEMENT_IDS.map((id, index) => [id, index] as const)
);

/** Names only — no file is read. */
export async function previewSelectiveRestore(
  directoryHandle: DirectoryHandleLike,
  backupFolderName: string
): Promise<RestorePreview> {
  const jsonDir = await openCompleteBackupJsonDir(directoryHandle, backupFolderName);
  const paths: string[] = [];
  await listRestorablePaths(jsonDir, "", paths);

  const cells = new Map<string, RestorePreviewCell>();
  const months = new Set<string>();
  let unclassifiedCount = 0;
  for (const path of paths) {
    const classified = classifyBackupPath(path);
    if (!classified) {
      unclassifiedCount += 1;
      continue;
    }
    if (classified.derived) continue;
    const key = `${classified.element}|${classified.month ?? ""}`;
    const cell = cells.get(key) ?? { element: classified.element, month: classified.month, fileCount: 0 };
    cell.fileCount += 1;
    cells.set(key, cell);
    if (classified.month !== null) months.add(classified.month);
  }

  const orderedCells = [...cells.values()].sort(
    (a, b) =>
      (ELEMENT_ORDER.get(a.element) ?? 0) - (ELEMENT_ORDER.get(b.element) ?? 0) ||
      compareMonthFolderNames(a.month ?? "", b.month ?? "")
  );
  return {
    backupFolderName,
    months: [...months].sort(compareMonthFolderNames),
    cells: orderedCells,
    unclassifiedCount,
  };
}

export function countPreviewFiles(
  preview: RestorePreview,
  element: RestoreElementId,
  month: string | null
): number {
  return preview.cells.find((cell) => cell.element === element && cell.month === month)?.fileCount ?? 0;
}
