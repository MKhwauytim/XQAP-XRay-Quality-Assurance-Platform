// A save that never reaches the shared folder must not silently vanish: it
// should end up queued in the local IndexedDB backup (markAnswerPendingLocally)
// so the app-level PendingAnswerReplayRunner (pendingAnswerReplay.ts) keeps
// trying it — see answerLocalMirror.ts's module doc for the full rationale.
// A save that DOES land is mirrored as confirmed instead.
//
// `reconcileAnswersWithLocalMirror`'s own replay-a-mirrored-item coverage
// used to live in this file; that function was deleted (A1 fix round,
// IMPORTANT 5) — see pendingAnswerReplay.test.ts for `replayPendingAnswers`
// and `backfillAnswerMirror` instead.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMemoryDirectory, setSimulatedFaults } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import * as answerLocalMirror from "./answerLocalMirror";
import { upsertItemAnswer } from "./answerStorage";
import type { ItemAnswer } from "./answerTypes";

vi.mock("./answerLocalMirror", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./answerLocalMirror")>();
  return {
    ...actual,
    mirrorAnswerLocally: vi.fn(actual.mirrorAnswerLocally),
    markAnswerPendingLocally: vi.fn(actual.markAnswerPendingLocally),
    loadMirroredAnswers: vi.fn(actual.loadMirroredAnswers),
  };
});
const mirrorMock = vi.mocked(answerLocalMirror.mirrorAnswerLocally);
const pendingMock = vi.mocked(answerLocalMirror.markAnswerPendingLocally);

const MONTH = "5-may-2026";

function makeItem(id: string): ItemAnswer {
  return {
    xrayImageId: id,
    answeredBy: "emp-1",
    answers: [],
    status: "submitted",
    submittedAt: "2026-05-02T00:00:00.000Z",
    templateId: "tpl-1",
    templateVersion: 1,
    lastSavedAt: "2026-05-02T00:00:00.000Z",
  };
}

let root: DirectoryHandleLike;

beforeEach(() => {
  root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
  mirrorMock.mockClear();
  pendingMock.mockClear();
});

describe("answer save <-> local IndexedDB mirror", () => {
  it("queues the item as pending when the save never reaches the shared folder", async () => {
    setSimulatedFaults(root, [
      {
        operation: "createWritable",
        nameSuffix: ".ndjson",
        errorName: "QuotaExceededError",
        times: Number.POSITIVE_INFINITY,
      },
    ]);

    const result = await upsertItemAnswer(root, MONTH, "emp-1", makeItem("IMG-1"));
    expect(result.ok).toBe(false);

    expect(pendingMock).toHaveBeenCalledTimes(1);
    expect(pendingMock.mock.calls[0]![0]).toBe(MONTH);
    expect(pendingMock.mock.calls[0]![1]).toBe("emp-1");
    expect(mirrorMock).not.toHaveBeenCalled();
  }, 120_000);

  it("mirrors the item as confirmed when the save succeeds", async () => {
    const result = await upsertItemAnswer(root, MONTH, "emp-1", makeItem("IMG-1"));
    expect(result.ok).toBe(true);

    expect(mirrorMock).toHaveBeenCalledTimes(1);
    expect(pendingMock).not.toHaveBeenCalled();
  });
});
