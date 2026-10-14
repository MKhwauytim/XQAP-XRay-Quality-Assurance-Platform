// src/data/answers/migration/answerLayoutMigrationProbe.ts
import type { DirectoryHandleLike } from "../../storage/fileSystemAccess";
import { mapWithConcurrency } from "../../storage/concurrency";
import { listDirectoryEntries } from "../../storage/directoryScan";
import { logError } from "../../storage/errorLogger";
import { isNotFoundError } from "../../storage/transientFileErrors";
import { getAnswerEventsDir, getAnswerEventsLayout, getSampleEmployeeDir } from "../../workspace/workspacePaths";
import { ANSWER_EVENT_SEGMENT_SUFFIX } from "../answerEventStore";
import { ANSWERS_SUFFIX, REQUESTS_SUFFIX } from "../answerStorage";
import { readAnswerEventsLayoutMarker } from "../v2/answerEventsLayout";
import { MIGRATION_MS_PER_SEGMENT_ESTIMATE } from "./flatToPerAssignee";

export type MonthMigrationNeed = {
  monthFolderName: string;
  kind: "flat" | "incomplete" | "stragglers";
  flatSegments: number;
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

async function probeMonth(root: DirectoryHandleLike, month: string): Promise<MonthMigrationNeed | null> {
  const layout = await getAnswerEventsLayout(root, month);
  if (layout === "absent") return null;
  const marker = layout === "v2" ? await readAnswerEventsLayoutMarker(root, month) : null;
  const unmovable = new Set(marker?.unmovable ?? []);
  const flatSegments = (await listDirectoryEntries(await getAnswerEventsDir(root, month, false))).filter(
    (entry) => entry.kind === "file" && entry.name.endsWith(ANSWER_EVENT_SEGMENT_SUFFIX) && !unmovable.has(entry.name)
  ).length;
  const kind: MonthMigrationNeed["kind"] | null =
    layout === "v1-migrating" ? "incomplete" : flatSegments === 0 ? null : layout === "v2" ? "stragglers" : "flat";
  if (!kind) return null;
  return { monthFolderName: month, kind, flatSegments, assignees: await countAssigneeStems(root, month), estimateMs: flatSegments * MIGRATION_MS_PER_SEGMENT_ESTIMATE };
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
