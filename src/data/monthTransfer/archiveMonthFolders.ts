/**
 * Archive copy of a month before a merge removes it. Every file under
 * `1-population/{month}` and `2-samples/{month}` is byte-copied (verified) into
 * `5-system/archived-months/{month}--{stamp}/` keeping the same relative
 * layout, so an admin can put the month back by copying the two folders home.
 * Nothing is deleted here — the caller deletes only after this resolves.
 */
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { listDirectoryEntries } from "../storage/directoryScan";
import { copyFileBytesVerified } from "../storage/safeWrite";
import { isNotFoundError } from "../storage/transientFileErrors";
import { getPopulationRoot, getSamplesRoot, getSystemRoot, WORKSPACE_ROOTS } from "../workspace/workspacePaths";

export const ARCHIVED_MONTHS_DIR = "archived-months";

async function copyTree(source: DirectoryHandleLike, target: DirectoryHandleLike): Promise<number> {
  let copied = 0;
  for (const entry of await listDirectoryEntries(source)) {
    if (entry.kind === "directory") {
      const child = await source.getDirectoryHandle(entry.name, { create: false });
      copied += await copyTree(child, await target.getDirectoryHandle(entry.name, { create: true }));
      continue;
    }
    const outcome = await copyFileBytesVerified(source, entry.name, target, entry.name);
    if (outcome.status === "copied") copied += 1;
    else if (outcome.status !== "source_missing") {
      throw new Error(`Archive copy of ${entry.name} failed verification`);
    }
  }
  return copied;
}

async function openOptional(parent: () => Promise<DirectoryHandleLike>, name: string): Promise<DirectoryHandleLike | null> {
  try {
    return await (await parent()).getDirectoryHandle(name, { create: false });
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
}

export function archiveFolderName(monthFolderName: string, now: Date = new Date()): string {
  return `${monthFolderName}--${now.toISOString().replace(/[:.]/g, "-")}`;
}

/** Copies the month's folders into the archive; returns the archive folder name and file count. */
export async function archiveMonthFolders(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  now: Date = new Date()
): Promise<{ archiveName: string; files: number }> {
  const archiveName = archiveFolderName(monthFolderName, now);
  const system = await getSystemRoot(directoryHandle, true);
  const archiveRoot = await (await system.getDirectoryHandle(ARCHIVED_MONTHS_DIR, { create: true }))
    .getDirectoryHandle(archiveName, { create: true });
  let files = 0;
  const population = await openOptional(() => getPopulationRoot(directoryHandle, false), monthFolderName);
  if (population) {
    files += await copyTree(population, await archiveRoot.getDirectoryHandle(WORKSPACE_ROOTS.population, { create: true }));
  }
  const samples = await openOptional(() => getSamplesRoot(directoryHandle, false), monthFolderName);
  if (samples) {
    files += await copyTree(samples, await archiveRoot.getDirectoryHandle(WORKSPACE_ROOTS.samples, { create: true }));
  }
  return { archiveName, files };
}
