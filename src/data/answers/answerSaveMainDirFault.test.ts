// S2 fix round: resolving the month's `1-main` folder is part of an answer save
// and can fail transiently on the share. It must be retried like every other
// read-side step, and if it never recovers the answer must still be queued
// pending (background replay), not dropped.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearSimulatedFaults, createMemoryDirectory, setSimulatedFaults } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { __clearWorkspaceDirCacheForTests } from "../workspace/workspacePaths";
import * as answerLocalMirror from "./answerLocalMirror";
import { __clearAnswerEventsCacheForTests, loadEmployeeAnswers, upsertItemAnswer } from "./answerStorage";
import type { ItemAnswer } from "./answerTypes";

vi.mock("./answerLocalMirror", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./answerLocalMirror")>();
  return {
    ...actual,
    mirrorAnswerLocally: vi.fn(actual.mirrorAnswerLocally),
    markAnswerPendingLocally: vi.fn(actual.markAnswerPendingLocally),
  };
});
const pendingMock = vi.mocked(answerLocalMirror.markAnswerPendingLocally);
const MONTH = "5-may-2026";

const item: ItemAnswer = {
  xrayImageId: "IMG-1",
  answeredBy: "emp-1",
  answers: [{ fieldId: "f", value: "v" }],
  status: "submitted",
  submittedAt: "2026-05-02T00:00:00.000Z",
  templateId: "tpl-1",
  templateVersion: 1,
  lastSavedAt: "2026-05-02T00:00:00.000Z",
};

let root: DirectoryHandleLike;
beforeEach(() => {
  __clearAnswerEventsCacheForTests();
  __clearWorkspaceDirCacheForTests();
  root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
  pendingMock.mockClear();
});

describe("answer save — transient fault resolving the month folder", () => {
  it("a transient fault is retried and the save succeeds", async () => {
    setSimulatedFaults(root, [
      { operation: "getDirectoryHandle", name: "1-main", errorName: "NotReadableError", times: 1 },
    ]);
    const result = await upsertItemAnswer(root, MONTH, "emp-1", item);
    clearSimulatedFaults(root);
    expect(result).toEqual({ ok: true });
    expect(pendingMock).not.toHaveBeenCalled();
    expect((await loadEmployeeAnswers(root, MONTH, "emp-1")).items.map((i) => i.xrayImageId)).toEqual(["IMG-1"]);
  }, 60_000);

  it("a persistent fault ends in a coded error AND the answer is queued pending", async () => {
    setSimulatedFaults(root, [
      { operation: "getDirectoryHandle", name: "1-main", errorName: "NotReadableError", times: Number.POSITIVE_INFINITY },
    ]);
    const result = await upsertItemAnswer(root, MONTH, "emp-1", item);
    clearSimulatedFaults(root);
    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toContain("XQ-");
    expect(pendingMock).toHaveBeenCalledTimes(1);
    expect(pendingMock.mock.calls[0]![2]).toMatchObject({ xrayImageId: "IMG-1", answers: item.answers, status: "submitted" });
  }, 120_000);
});
