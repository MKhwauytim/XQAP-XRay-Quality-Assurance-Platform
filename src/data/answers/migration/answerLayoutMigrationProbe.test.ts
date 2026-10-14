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
    await crashed.getDirectoryHandle(ANSWER_EVENTS_FOLDERS.archiveV1, { create: true });
    await makeV2Month(root, "2-feb-2026");
    await writeText(await getAnswerEventsDir(root, "2-feb-2026"), "late.ndjson", encodeEventLine(savedEvent("l", 1)));
    const needs = await probeAnswerLayoutMigrations(root, ["1-jan-2026", "2-feb-2026"]);
    expect(needs.map((n) => [n.monthFolderName, n.kind])).toEqual([["1-jan-2026", "incomplete"], ["2-feb-2026", "stragglers"]]);
  });
});
