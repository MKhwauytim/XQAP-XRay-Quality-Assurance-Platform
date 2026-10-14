// src/data/answers/migration/answerLayoutMigrationProbe.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryDirectory } from "../../storage/memoryDirectory";
import { encodeEventLine } from "../../storage/appendOnlyEventLog";
import { __clearWorkspaceDirCacheForTests, ANSWER_EVENTS_FOLDERS, getAnswerEventsDir, getSampleEmployeeDir, invalidateAnswerEventsLayout } from "../../workspace/workspacePaths";
import { makeV2Month, savedEvent, writeText } from "../v2/v2TestFixtures";
import { probeAnswerLayoutMigrations } from "./answerLayoutMigrationProbe";

describe("probeAnswerLayoutMigrations", () => {
  beforeEach(() => { __clearWorkspaceDirCacheForTests(); invalidateAnswerEventsLayout(); });

  it("reports flat v1 months with counts and estimate; skips absent and clean v2 months", async () => {
    const root = createMemoryDirectory("probe");
    const flat = await getAnswerEventsDir(root, "1-jan-2026", true);
    await writeText(flat, "a.ndjson", encodeEventLine(savedEvent("a", 1)));
    await writeText(flat, "b.ndjson", encodeEventLine(savedEvent("b", 1)));
    const employees = await getSampleEmployeeDir(root, "1-jan-2026", true);
    await writeText(employees, "emp1.answers.json", "{}");
    await writeText(employees, "emp1.requests.json", "{}");
    await writeText(employees, "emp2.requests.json", "{}");
    await makeV2Month(root, "2-feb-2026");
    const needs = await probeAnswerLayoutMigrations(root, ["1-jan-2026", "2-feb-2026", "3-mar-2026"]);
    expect(needs).toEqual([{ monthFolderName: "1-jan-2026", kind: "flat", flatSegments: 2, assignees: 2, estimateMs: 300 }]);
  });

  it("reports an incomplete migration and v2 stragglers (minus unmovable)", async () => {
    const root = createMemoryDirectory("probe2");
    const crashed = await getAnswerEventsDir(root, "1-jan-2026", true);
    // A crashed run that already MOVED a segment (an empty _archive-v1/ no longer counts, v154.0 review finding 2).
    await writeText(await crashed.getDirectoryHandle(ANSWER_EVENTS_FOLDERS.archiveV1, { create: true }), "moved.ndjson", encodeEventLine(savedEvent("m", 1)));
    await makeV2Month(root, "2-feb-2026");
    await writeText(await getAnswerEventsDir(root, "2-feb-2026"), "late.ndjson", encodeEventLine(savedEvent("l", 1)));
    const needs = await probeAnswerLayoutMigrations(root, ["1-jan-2026", "2-feb-2026"]);
    expect(needs.map((n) => [n.monthFolderName, n.kind])).toEqual([["1-jan-2026", "incomplete"], ["2-feb-2026", "stragglers"]]);
  });

  it("re-offers a v2 month whose UNFOLDED segments are still flat, but not one whose unmovable segments were folded (review finding 3)", async () => {
    const root = createMemoryDirectory("probe3");
    for (const [month, unfolded] of [["1-jan-2026", ["dead.ndjson"]], ["2-feb-2026", []]] as const) {
      const events = await getAnswerEventsDir(root, month, true);
      await writeText(events, ANSWER_EVENTS_FOLDERS.layoutMarker, JSON.stringify({ layout: "per-assignee", schemaVersion: 1, migratedAt: "x", migratedBy: "a", flatSegmentsArchived: 0, assignees: 0, unmovable: ["dead.ndjson"], unfolded, origin: "migration" }));
      await writeText(events, "dead.ndjson", encodeEventLine(savedEvent("d", 1)));
    }
    const needs = await probeAnswerLayoutMigrations(root, ["1-jan-2026", "2-feb-2026"]);
    expect(needs.map((n) => [n.monthFolderName, n.kind, n.flatSegments])).toEqual([["1-jan-2026", "stragglers", 1]]);
  });
});
