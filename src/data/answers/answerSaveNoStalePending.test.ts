// A failed reopen / quality-note must be REPORTED, not queued: a pending
// `item-saved` candidate rebuilt from the previous state would, on replay,
// re-assert the submitted state with a fresh lastSavedAt (silently undoing the
// reopen) and would never replay the note.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearSimulatedFaults, createMemoryDirectory, setSimulatedFaults } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import * as answerLocalMirror from "./answerLocalMirror";
import { __clearAnswerEventsCacheForTests, reopenItemAnswer, setItemQualityNote, upsertItemAnswer } from "./answerStorage";
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
const failAppends = () =>
  setSimulatedFaults(root, [
    { operation: "createWritable", nameSuffix: ".ndjson", errorName: "QuotaExceededError", times: Number.POSITIVE_INFINITY },
  ]);

beforeEach(async () => {
  __clearAnswerEventsCacheForTests();
  root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
  expect((await upsertItemAnswer(root, MONTH, "emp-1", item)).ok).toBe(true);
  pendingMock.mockClear();
});

describe("pending queue is only for full answer saves", () => {
  it("a failed reopen queues nothing and returns a coded error", async () => {
    failAppends();
    const result = await reopenItemAnswer(root, MONTH, "emp-1", "IMG-1", "sup-1", "why");
    clearSimulatedFaults(root);
    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toContain("XQ-");
    expect(pendingMock).not.toHaveBeenCalled();
  }, 120_000);

  it("a failed quality note queues nothing and returns a coded error", async () => {
    failAppends();
    const result = await setItemQualityNote(root, MONTH, "emp-1", "IMG-1", "note");
    clearSimulatedFaults(root);
    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toContain("XQ-");
    expect(pendingMock).not.toHaveBeenCalled();
  }, 120_000);

  it("a failed answer save still queues exactly once", async () => {
    failAppends();
    const result = await upsertItemAnswer(root, MONTH, "emp-1", { ...item, answers: [{ fieldId: "f", value: "edited" }] });
    clearSimulatedFaults(root);
    expect(result.ok).toBe(false);
    expect(pendingMock).toHaveBeenCalledTimes(1);
  }, 120_000);
});
