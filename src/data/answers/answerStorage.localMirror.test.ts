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
import { createFakeIndexedDb } from "../storage/fakeIndexedDb.testHelper";
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

// CRITICAL (fix round 3): `performAnswerWrite`'s post-success mirror call
// (`mirrorAnswerLocally`, real implementation -- the mock above forwards to
// it) must not clobber a NEWER pending record queued for the SAME item
// while an OLDER write's own success path runs its mirror call. This is a
// real scenario: an employee re-saves an item while a slower, earlier write
// of an older version of the same item is still in flight; that re-save
// itself fails and gets queued pending with a newer lastSavedAt, and then
// the older, slower write finally succeeds and tries to mirror ITS
// (older) item as confirmed.
describe("mirrorAnswerLocally guard through performAnswerWrite's post-success mirror call (fix round 3)", () => {
  it("does not overwrite a newer pending record for the same item with this older write's own confirmed mirror", async () => {
    type StoredRecord = { key: string; synced: boolean; item: ItemAnswer };
    const { fakeIndexedDb, table } = createFakeIndexedDb<StoredRecord>();
    vi.stubGlobal("indexedDB", fakeIndexedDb);
    try {
      await answerLocalMirror.markAnswerPendingLocally(MONTH, "emp-1", {
        ...makeItem("IMG-1"),
        lastSavedAt: "2026-05-02T12:00:00.000Z",
      });

      const olderItem = { ...makeItem("IMG-1"), lastSavedAt: "2026-05-02T10:00:00.000Z" };
      const result = await upsertItemAnswer(root, MONTH, "emp-1", olderItem);
      expect(result.ok).toBe(true); // the workspace write itself still succeeds

      const stored = table.get(`${MONTH}::emp-1::IMG-1`);
      expect(stored?.synced).toBe(false); // still pending -- not clobbered by the older write's mirror call
      expect(stored?.item.lastSavedAt).toBe("2026-05-02T12:00:00.000Z"); // the newer pending edit, untouched
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
