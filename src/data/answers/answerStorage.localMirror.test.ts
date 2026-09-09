// A save that never reaches the shared folder must not silently vanish: it
// should end up queued in the local IndexedDB backup (markAnswerPendingLocally)
// so the 30s retry tick / next reconciliation in XrayInspectionResults.tsx
// keeps trying it — see answerLocalMirror.ts's module doc for the full
// rationale. A save that DOES land is mirrored as confirmed instead.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMemoryDirectory, setSimulatedFaults } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import * as answerLocalMirror from "./answerLocalMirror";
import { loadEmployeeAnswers, reconcileAnswersWithLocalMirror, upsertItemAnswer } from "./answerStorage";
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
const loadMirroredMock = vi.mocked(answerLocalMirror.loadMirroredAnswers);

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
  loadMirroredMock.mockClear();
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

  it("reconcileAnswersWithLocalMirror replays a mirrored item the file doesn't have yet, then re-mirrors the file as confirmed", async () => {
    // Simulates: the browser saved IMG-1 into its local backup, but the write
    // to the shared folder never landed (e.g. this browser crashed, or the
    // share was unreachable at the time) — so the file has nothing for it yet.
    loadMirroredMock.mockResolvedValueOnce([makeItem("IMG-1")]);

    await reconcileAnswersWithLocalMirror(root, MONTH, "emp-1");

    const file = await loadEmployeeAnswers(root, MONTH, "emp-1");
    expect(file.items.map((item) => item.xrayImageId)).toEqual(["IMG-1"]);
    // The replay's own successful save mirrors it once; reconcile's own
    // "re-mirror the file's current items" pass mirrors it again.
    expect(mirrorMock).toHaveBeenCalledTimes(2);
    expect(pendingMock).not.toHaveBeenCalled();
  });
});
