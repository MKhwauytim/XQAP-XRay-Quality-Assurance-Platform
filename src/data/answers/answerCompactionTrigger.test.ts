// src/data/answers/answerCompactionTrigger.test.ts
// Plan 2 Task 9 Step 6: a successful v2 employee load schedules that folder's compaction.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryDirectory } from "../storage/memoryDirectory";
import { __resetAppendOnlyEventLogMemosForTests } from "../storage/appendOnlyEventLog";
import { __clearWorkspaceDirCacheForTests, invalidateAnswerEventsLayout } from "../workspace/workspacePaths";
import { __clearAnswerEventsCacheForTests, foldEmployeeEvents, loadEmployeeAnswers, upsertItemAnswer } from "./answerStorage";
import type { ItemAnswer } from "./answerTypes";

const calls = vi.hoisted(() => ({ list: [] as unknown[][] }));
vi.mock("./compaction/compactAssignee", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./compaction/compactAssignee")>();
  return { ...actual, maybeScheduleCompaction: (...args: unknown[]) => { calls.list.push(args); return null; } };
});
vi.mock("./answerLocalMirror", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./answerLocalMirror")>();
  return { ...actual, mirrorAnswerLocally: async () => undefined, markAnswerPendingLocally: async () => undefined };
});

const MONTH = "5-may-2026";
const item: ItemAnswer = { xrayImageId: "A", templateId: "t", templateVersion: 1, answers: [{ fieldId: "f", value: "A" }], lastSavedAt: "2026-05-02T00:00:00.000Z", submittedAt: null, answeredBy: "emp1", status: "draft" };

describe("compaction trigger (spec §7)", () => {
  beforeEach(() => {
    __clearWorkspaceDirCacheForTests();
    invalidateAnswerEventsLayout();
    __clearAnswerEventsCacheForTests();
    __resetAppendOnlyEventLogMemosForTests();
    calls.list = [];
  });

  it("a v2 employee load hands the read to maybeScheduleCompaction with the employee fold", async () => {
    const root = createMemoryDirectory("trigger");
    expect((await upsertItemAnswer(root, MONTH, "emp1", item)).ok).toBe(true);
    calls.list = [];
    await loadEmployeeAnswers(root, MONTH, "emp1");
    expect(calls.list.length).toBeGreaterThanOrEqual(1);
    const [dir, month, user, read, deps] = calls.list[0] as [unknown, string, string, { liveSegmentNames: string[] }, { foldFn: unknown; loadLegacySeed: () => Promise<unknown> }];
    expect(dir).toBe(root);
    expect(month).toBe(MONTH);
    expect(user).toBe("emp1");
    expect(read.liveSegmentNames.length).toBe(1);
    expect(deps.foldFn).toBe(foldEmployeeEvents);
    await expect(deps.loadLegacySeed()).resolves.toMatchObject({ items: [] });
  });
});
