// A save that has to retry must not multiply its own writes onto the share.
//
// Employees reported ~1 submission in 10 hanging about a minute and then
// failing. The minute is the casLoop ladder: 14 attempts with linear backoff
// (~13.6 s of sleeping) plus the per-attempt disk work on a contended share.
// What made it worse than slow: `recordActionHistorySnapshot` — a safeWriteJson
// plus a prune of the rolling window — sat INSIDE the retry body, so a failing
// save aimed up to fourteen extra writes at the share that was already too
// contended to serve one. It is best-effort by contract and never gates the
// append, and every attempt records the same pre-change state, so repeating it
// bought nothing and cost the most at the worst moment.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMemoryDirectory, setSimulatedFaults } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { recordActionHistorySnapshot } from "../history/actionHistory";
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
});

describe("answer save retry cost", () => {
  it("records the pre-change snapshot ONCE across a save that exhausts every attempt", async () => {
    // A segment append that keeps failing, so the casLoop burns all 14 attempts
    // before giving up — the hang employees reported (measured here at ~13 s of
    // pure backoff; on a real contended share, where each attempt also pays
    // safeWrite's inner ladder and the reachability probe, it exceeds two
    // minutes). Every one of those attempts used to write a history snapshot to
    // the very share that was failing.
    //
    // The fault is a NON-transient error on purpose: the production trigger is
    // the transient InvalidStateError (XQ-IO-032), but safeWrite's own inner
    // ladder absorbs that so effectively that reproducing a full casLoop
    // exhaustion through it takes over two minutes of real time. What is under
    // test here is the retry body, and any error that reaches casLoop drives it
    // identically.
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

    expect(snapshotMock).toHaveBeenCalledTimes(1);
  }, 120_000);

  it("still records a snapshot on a save that succeeds first time", async () => {
    const result = await upsertItemAnswer(root, MONTH, "emp-1", makeItem("IMG-1"));
    expect(result.ok).toBe(true);
    const file = await loadEmployeeAnswers(root, MONTH, "emp-1");
    expect(file.items.map((i) => i.xrayImageId)).toEqual(["IMG-1"]);
    expect(snapshotMock).toHaveBeenCalledTimes(1);
  });
});
