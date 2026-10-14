// src/data/answers/answerV2CacheClear.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryDirectory } from "../storage/memoryDirectory";
import { __resetAppendOnlyEventLogMemosForTests } from "../storage/appendOnlyEventLog";
import { __clearWorkspaceDirCacheForTests, getAssigneeAnswerEventsDir, invalidateAnswerEventsLayout } from "../workspace/workspacePaths";
import { __clearAnswerEventsCacheForTests, clearAnswerEventsCache, loadEmployeeAnswers, upsertItemAnswer } from "./answerStorage";
import type { ItemAnswer } from "./answerTypes";
import { fileNames } from "./v2/v2TestFixtures";

vi.mock("./answerLocalMirror", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./answerLocalMirror")>();
  return { ...actual, mirrorAnswerLocally: async () => undefined, markAnswerPendingLocally: async () => undefined };
});

const MONTH = "5-may-2026";

function item(id: string): ItemAnswer {
  return { xrayImageId: id, templateId: "t", templateVersion: 1, answers: [{ fieldId: "f", value: id }], lastSavedAt: "2026-05-02T00:00:00.000Z", submittedAt: null, answeredBy: "emp1", status: "draft" };
}

describe("clearAnswerEventsCache drops the v2 per-assignee in-tab cache (restore / manual refresh)", () => {
  beforeEach(() => {
    __clearWorkspaceDirCacheForTests();
    invalidateAnswerEventsLayout();
    __clearAnswerEventsCacheForTests();
    __resetAppendOnlyEventLogMemosForTests();
  });

  it("after the per-assignee segment bytes are replaced underneath the cache, a cleared read reflects disk", async () => {
    const root = createMemoryDirectory("clear");
    expect((await upsertItemAnswer(root, MONTH, "emp1", item("A"))).ok).toBe(true);
    expect((await loadEmployeeAnswers(root, MONTH, "emp1")).items.map((i) => i.xrayImageId)).toEqual(["A"]);

    // A restore rewrote the assignee folder: the segment is gone.
    const dir = await getAssigneeAnswerEventsDir(root, MONTH, "emp1");
    const removeEntry = dir.removeEntry?.bind(dir);
    if (!removeEntry) throw new Error("memory directory must support removeEntry");
    for (const name of await fileNames(dir)) await removeEntry(name);

    clearAnswerEventsCache();
    expect((await loadEmployeeAnswers(root, MONTH, "emp1")).items).toEqual([]);
  });
});
