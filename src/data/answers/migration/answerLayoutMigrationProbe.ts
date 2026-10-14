// src/data/answers/migration/answerLayoutMigrationProbe.ts
import type { DirectoryHandleLike } from "../../storage/fileSystemAccess";
import { mapWithConcurrency } from "../../storage/concurrency";
import { listDirectoryEntries } from "../../storage/directoryScan";
import { logError } from "../../storage/errorLogger";
import { isNotFoundError } from "../../storage/transientFileErrors";
import { getAnswerArchiveV1Dir, getAnswerEventsDir, getAnswerEventsLayout, getSampleEmployeeDir } from "../../workspace/workspacePaths";
import { ANSWER_EVENT_SEGMENT_SUFFIX } from "../answerEventStore";
import { ANSWERS_SUFFIX, REQUESTS_SUFFIX } from "../answerStorage";
import { readAnswerEventsLayoutMarker } from "../v2/answerEventsLayout";
import { MIGRATION_MS_PER_SEGMENT_ESTIMATE } from "./flatToPerAssignee";

export type MonthMigrationNeed = {
  monthFolderName: string;
  kind: "flat" | "incomplete" | "stragglers";
  flatSegments: number;
  /** Round 7 resume: segments an earlier run already archived into `_archive-v1/` (0 unless incomplete). */
  archivedSegments: number;
  assignees: number;
  estimateMs: number;
};

async function countAssigneeStems(root: DirectoryHandleLike, month: string): Promise<number> {
  try {
    const stems = new Set<string>();
    for (const entry of await listDirectoryEntries(await getSampleEmployeeDir(root, month, false))) {
      if (entry.kind !== "file") continue;
      for (const suffix of [ANSWERS_SUFFIX, REQUESTS_SUFFIX]) {
        if (entry.name.endsWith(suffix)) stems.add(entry.name.slice(0, -suffix.length).toLowerCase());
      }
    }
    return stems.size;
  } catch (error) {
    if (isNotFoundError(error)) return 0;
    throw error;
  }
}

async function countArchivedSegments(root: DirectoryHandleLike, month: string): Promise<number> {
  try {
    return (await listDirectoryEntries(await getAnswerArchiveV1Dir(root, month, false))).filter(
      (entry) => entry.kind === "file" && entry.name.endsWith(ANSWER_EVENT_SEGMENT_SUFFIX)
    ).length;
  } catch (error) {
    if (isNotFoundError(error)) return 0;
    throw error;
  }
}

async function probeMonth(root: DirectoryHandleLike, month: string): Promise<MonthMigrationNeed | null> {
  const layout = await getAnswerEventsLayout(root, month);
  if (layout === "absent") return null;
  const marker = layout === "v2" ? await readAnswerEventsLayoutMarker(root, month) : null;
  // Folded-but-stuck segments are not re-offered; UNFOLDED ones (whose events
  // no v2 reader sees) are, for as long as they are still in the flat folder.
  const unfolded = new Set(marker?.unfolded ?? []);
  const unmovable = new Set((marker?.unmovable ?? []).filter((name) => !unfolded.has(name)));
  const flatSegments = (await listDirectoryEntries(await getAnswerEventsDir(root, month, false))).filter(
    (entry) => entry.kind === "file" && entry.name.endsWith(ANSWER_EVENT_SEGMENT_SUFFIX) && !unmovable.has(entry.name)
  ).length;
  const kind: MonthMigrationNeed["kind"] | null =
    layout === "v1-migrating" ? "incomplete" : flatSegments === 0 ? null : layout === "v2" ? "stragglers" : "flat";
  if (!kind) return null;
  const archivedSegments = kind === "incomplete" ? await countArchivedSegments(root, month) : 0;
  return { monthFolderName: month, kind, flatSegments, archivedSegments, assignees: await countAssigneeStems(root, month), estimateMs: flatSegments * MIGRATION_MS_PER_SEGMENT_ESTIMATE };
}

/** Which months an admin should be offered the migration for. One listing per month; never writes. */
export async function probeAnswerLayoutMigrations(root: DirectoryHandleLike, monthFolderNames: readonly string[]): Promise<MonthMigrationNeed[]> {
  const needs = await mapWithConcurrency(monthFolderNames, 4, async (month) => {
    try {
      return await probeMonth(root, month);
    } catch (error) {
      logError("answers:migration-probe", error, { action: month });
      return null;
    }
  });
  return needs.filter((need): need is MonthMigrationNeed => need !== null);
}
