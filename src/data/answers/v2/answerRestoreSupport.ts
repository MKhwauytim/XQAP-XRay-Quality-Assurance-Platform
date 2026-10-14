// src/data/answers/v2/answerRestoreSupport.ts
//
// What a backup restore must know about the layout-v2 (per-assignee) answers
// tree. Restore NEVER deletes or moves anything the target holds: it only
// merges segment lines and writes absent files, so every rule here either
// redirects a merge to where the target keeps the segment NOW, or declines.
import type { RestoreAction } from "../../backup/backupStorage";
import type { DirectoryHandleLike } from "../../storage/fileSystemAccess";
import { listDirectoryEntries } from "../../storage/directoryScan";
import { isNotFoundError } from "../../storage/transientFileErrors";
import { ANSWER_EVENTS_FOLDERS, isAnswerAssigneeFolderName } from "../../workspace/workspacePaths";

const SEGMENT_SUFFIX = ".ndjson";

/**
 * Layout-v2 files under `answers.events/`: `snapshot.json` is DERIVED (rebuilt
 * after the restore from the merged segments -- restoring an older one would
 * hide segments archived since); a migration lock is never restored; the
 * layout marker only when absent (a restore never re-stamps a month).
 */
export function answerEventsRestoreAction(fileName: string, eventsDirName: string | null): RestoreAction | null {
  if (eventsDirName !== ANSWER_EVENTS_FOLDERS.root) return null;
  if (fileName === ANSWER_EVENTS_FOLDERS.assigneeSnapshot || fileName === ANSWER_EVENTS_FOLDERS.migrationLock) return "skip-derived";
  if (fileName === ANSWER_EVENTS_FOLDERS.layoutMarker) return "restore-if-absent";
  return null;
}

/** True for a backup-relative path's file name that the restore treats as derived under `answers.events/`. */
export function isDerivedAnswerEventsFile(fileName: string): boolean {
  return answerEventsRestoreAction(fileName, ANSWER_EVENTS_FOLDERS.root) === "skip-derived";
}

/** Path parts BELOW `answers.events/`, or null when the path is not under one. */
function belowEventsRoot(relativePath: string): { parts: string[]; month: string | null } | null {
  const parts = relativePath.split("/");
  const at = parts.indexOf(ANSWER_EVENTS_FOLDERS.root);
  if (at < 0) return null;
  return { parts: parts.slice(at + 1), month: at >= 2 ? parts[at - 2]! : null };
}

/** Every (month, assignee folder) a restore wrote into -- live or archive. Flat (v1) and reserved paths are skipped. */
export function restoredAnswerAssignees(paths: readonly string[]): Array<{ month: string; folder: string }> {
  const seen = new Map<string, { month: string; folder: string }>();
  for (const path of paths) {
    const below = belowEventsRoot(path);
    if (!below || !below.month || below.parts.length < 2) continue;
    const folder = below.parts[0]!;
    if (!isAnswerAssigneeFolderName(folder)) continue;
    seen.set(`${below.month}/${folder}`, { month: below.month, folder });
  }
  return [...seen.values()];
}

async function hasFile(dir: DirectoryHandleLike, name: string): Promise<boolean> {
  try {
    await dir.getFileHandle(name, { create: false });
    return true;
  } catch (error) {
    if (isNotFoundError(error)) return false;
    throw error;
  }
}

async function childDirOrNull(dir: DirectoryHandleLike, name: string): Promise<DirectoryHandleLike | null> {
  try {
    return await dir.getDirectoryHandle(name, { create: false });
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
}

/**
 * Where a restored answer segment must be MERGED in the target. The backup may
 * predate a move the target has made since:
 *  - a flat `answers.events/{seg}` the migration moved to `_archive-v1/{seg}`;
 *  - a live `answers.events/{assignee}/{seg}` compaction moved to `{assignee}/archive/{seg}`.
 * Merging into the moved copy keeps one copy per segment (re-creating a live
 * copy would have readers fold it twice and compaction archive it again).
 * Anything else merges where the backup had it.
 */
export async function resolveAnswerSegmentMergeDir(
  targetDir: DirectoryHandleLike,
  relativePath: string,
  fileName: string
): Promise<DirectoryHandleLike> {
  if (!fileName.endsWith(SEGMENT_SUFFIX)) return targetDir;
  const below = belowEventsRoot(relativePath);
  if (!below || (await hasFile(targetDir, fileName))) return targetDir;
  const movedTo =
    below.parts.length === 1
      ? ANSWER_EVENTS_FOLDERS.archiveV1
      : below.parts.length === 2 && isAnswerAssigneeFolderName(below.parts[0]!)
        ? ANSWER_EVENTS_FOLDERS.assigneeArchive
        : null;
  if (!movedTo) return targetDir;
  const moved = await childDirOrNull(targetDir, movedTo);
  return moved && (await hasFile(moved, fileName)) ? moved : targetDir;
}

/**
 * The v2 layout marker hides every flat segment from readers. A restore may
 * therefore only put it back into an `answers.events/` that holds none --
 * otherwise a backup taken after migration would silently hide answers a
 * target that was never migrated (or was rebuilt flat) still keeps.
 */
export async function canRestoreAnswerLayoutMarker(eventsDir: DirectoryHandleLike): Promise<boolean> {
  const entries = await listDirectoryEntries(eventsDir);
  return !entries.some((entry) => entry.kind === "file" && entry.name.endsWith(SEGMENT_SUFFIX));
}
