// A save must not write anything to the share beyond its own event append.
//
// HISTORY. Employees reported ~1 submission in 10 hanging about a minute and
// then failing. The minute is the casLoop ladder: 14 attempts with linear
// backoff plus the per-attempt disk work on a contended share. What made it
// worse than slow was `recordActionHistorySnapshot` — a safeWriteJson plus a
// prune of a rolling window — sitting INSIDE the retry body, so a failing save
// aimed up to fourteen extra writes at the share that was already too
// contended to serve one.
//
// v135.1 moved it out of the retry body. This version removes it from the
// answer path entirely: the pre-change state it copied is already permanent in
// `answers.events/*.ndjson`, so `actionHistoryReaders.ts` derives the same
// trail by folding those events. That also retires the deep per-record path
// (`…/history/answers/{month}/{user}/{xrayImageId}/…`) which, at ~115
// characters relative, crossed Windows' 260-character cap and made the write
// fail on EVERY save on a workspace deep on the share — twice per save, ~50
// times in three hours in the 2026-09-08/09 production log.
//
// These tests are the guard that keeps a writer from coming back to this path.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMemoryDirectory, setSimulatedFaults } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { recordActionHistorySnapshot } from "../history/actionHistory";
import { clearErrors, getRecentErrors } from "../storage/errorLogger";
import { loadEmployeeAnswers, upsertItemAnswer } from "./answerStorage";
import type { ItemAnswer } from "./answerTypes";

vi.mock("../history/actionHistory", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../history/actionHistory")>();
  return { ...actual, recordActionHistorySnapshot: vi.fn(actual.recordActionHistorySnapshot) };
});
const snapshotMock = vi.mocked(recordActionHistorySnapshot);

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
  snapshotMock.mockClear();
  clearErrors();
});

describe("answer save writes no history file", () => {
  it("records no snapshot on a save that succeeds first time", async () => {
    const result = await upsertItemAnswer(root, MONTH, "emp-1", makeItem("IMG-1"));

    expect(result.ok).toBe(true);
    const file = await loadEmployeeAnswers(root, MONTH, "emp-1");
    expect(file.items.map((i) => i.xrayImageId)).toEqual(["IMG-1"]);
    expect(snapshotMock).not.toHaveBeenCalled();
  });

  it("records no snapshot on a save that exhausts every attempt", async () => {
    // A segment append that keeps failing, so the casLoop burns all 14
    // attempts. The fault is non-transient on purpose: the production trigger
    // is the transient InvalidStateError (XQ-IO-032), but safeWrite's own inner
    // ladder absorbs that so effectively that reproducing a full exhaustion
    // through it takes minutes of real time, and any error reaching casLoop
    // drives the retry body identically.
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
    expect(snapshotMock).not.toHaveBeenCalled();
  }, 120_000);

  // The literal production symptom, asserted at its source: the answer path
  // must never so much as OPEN the history tree. Faulting on name length was
  // the first instinct, but the answer event segments are themselves long
  // enough to trip it, so the fault masked the thing under test. Asserting on
  // the tree directly is both simpler and stricter — it fails for ANY history
  // write reintroduced here, not just one long enough to break.
  it("never creates the history tree during answer saves", async () => {
    for (const id of ["IMG-1", "IMG-2", "IMG-3"]) {
      const result = await upsertItemAnswer(root, MONTH, "emp-1", makeItem(id));
      expect(result.ok).toBe(true);
    }

    const systemDir = await root.getDirectoryHandle("5-system", { create: false })
      .catch(() => null);
    if (systemDir) {
      await expect(
        systemDir.getDirectoryHandle("history", { create: false })
      ).rejects.toThrow();
    }

    const noisy = getRecentErrors().filter(
      (entry) =>
        entry.context === "actionHistory:record" || entry.context === "safeWrite:writeText"
    );
    expect(noisy).toEqual([]);
    expect(snapshotMock).not.toHaveBeenCalled();
  });
});
