/* @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import { subscribeToDataChange, type DataRefreshDetail } from "../workspace/dataRefreshSignal";
import { answerDraftKey, loadAnswerDraft, saveAnswerDraft } from "./answerDraftStore";
import { __resetAnswerEventsCacheForTests, loadEmployeeAnswers, upsertItemAnswer } from "./answerStorage";
import type { ItemAnswer } from "./answerTypes";
import { replayPendingAnswers } from "./pendingAnswerReplay";

const MONTH = "5-May-2026";
const ADHOC = "adhoc-imp-1";

function answer(xrayImageId: string, lastSavedAt = "2026-09-28T10:00:00.000Z"): ItemAnswer {
  return {
    xrayImageId,
    templateId: "tpl",
    templateVersion: 1,
    answers: [{ fieldId: "note", value: "ok" }],
    lastSavedAt,
    submittedAt: lastSavedAt,
    answeredBy: "emp1",
    status: "submitted",
  };
}

beforeEach(() => {
  localStorage.clear();
  __resetAnswerEventsCacheForTests();
});

describe("replayPendingAnswers (A1)", () => {
  it("replays every pending answer — any month, ad-hoc folders too — clears its draft, and announces it once", async () => {
    const root = createMemoryDirectory("root");
    const adhocId = "ADHOC-imp-1-XR-2";
    saveAnswerDraft(answerDraftKey(MONTH, "XR-1", "emp1"), { note: "ok" });
    saveAnswerDraft(answerDraftKey(ADHOC, adhocId, "emp1"), { note: "ok" });
    const seen: DataRefreshDetail[] = [];
    const stop = subscribeToDataChange(["answers"], (detail) => { seen.push(detail); });

    const summary = await replayPendingAnswers(root, "emp1", {
      loadPending: async () => [
        { month: MONTH, item: answer("XR-1") },
        { month: ADHOC, item: answer(adhocId) },
      ],
      markSynced: vi.fn(async () => {}),
    });
    stop();

    expect(summary).toEqual({ replayed: 2, alreadyOnDisk: 0, failed: 0 });
    expect(loadAnswerDraft(answerDraftKey(MONTH, "XR-1", "emp1"))).toBeNull();
    expect(loadAnswerDraft(answerDraftKey(ADHOC, adhocId, "emp1"))).toBeNull();
    expect((await loadEmployeeAnswers(root, MONTH, "emp1")).items.map((item) => item.xrayImageId)).toEqual(["XR-1"]);
    expect((await loadEmployeeAnswers(root, ADHOC, "emp1")).items.map((item) => item.xrayImageId)).toEqual([adhocId]);
    expect(seen).toHaveLength(1);
  });

  it("marks an answer already on disk (as new or newer) synced without writing it again", async () => {
    const root = createMemoryDirectory("root");
    expect((await upsertItemAnswer(root, MONTH, "emp1", answer("XR-1", "2026-09-28T10:00:00.000Z"))).ok).toBe(true);
    __resetAnswerEventsCacheForTests();
    const markSynced = vi.fn(async () => {});

    const summary = await replayPendingAnswers(root, "emp1", {
      loadPending: async () => [{ month: MONTH, item: answer("XR-1", "2026-09-28T09:00:00.000Z") }],
      markSynced,
    });

    expect(summary).toEqual({ replayed: 0, alreadyOnDisk: 1, failed: 0 });
    expect(markSynced).toHaveBeenCalledWith(MONTH, "emp1", expect.objectContaining({ xrayImageId: "XR-1" }));
  });

  it("does nothing and announces nothing when the queue is empty", async () => {
    const root = createMemoryDirectory("root");
    const seen: DataRefreshDetail[] = [];
    const stop = subscribeToDataChange(["answers"], (detail) => { seen.push(detail); });
    const summary = await replayPendingAnswers(root, "emp1", { loadPending: async () => [], markSynced: vi.fn(async () => {}) });
    stop();
    expect(summary).toEqual({ replayed: 0, alreadyOnDisk: 0, failed: 0 });
    expect(seen).toHaveLength(0);
  });

  // F14: replay happens ONLY through this module now (XrayInspectionResults'
  // on-load reconcile became count-only), so the shared in-flight guard is
  // what stands between "the runner's mount tick and its own next tick
  // overlap" (or a second runner instance briefly mounted during a remount)
  // and a duplicated answer event for the same pending item.
  it("joins a second concurrent call for the same user instead of writing the same pending item twice", async () => {
    const root = createMemoryDirectory("root");
    let resolveLoadPending!: () => void;
    const gate = new Promise<void>((resolve) => { resolveLoadPending = resolve; });
    const loadPending = vi.fn(async () => {
      await gate;
      return [{ month: MONTH, item: answer("XR-1") }];
    });

    const first = replayPendingAnswers(root, "emp1", { loadPending, markSynced: vi.fn(async () => {}) });
    const second = replayPendingAnswers(root, "emp1", { loadPending, markSynced: vi.fn(async () => {}) });
    resolveLoadPending();
    const [firstSummary, secondSummary] = await Promise.all([first, second]);

    expect(loadPending).toHaveBeenCalledTimes(1); // the second call joined the first's in-flight run
    expect(firstSummary).toEqual(secondSummary);
    expect(firstSummary).toEqual({ replayed: 1, alreadyOnDisk: 0, failed: 0 });
    expect((await loadEmployeeAnswers(root, MONTH, "emp1")).items.map((item) => item.xrayImageId)).toEqual(["XR-1"]);

    // A later, separate call (after the in-flight run completed) sees the
    // item already on disk rather than being blocked forever.
    const later = await replayPendingAnswers(root, "emp1", {
      loadPending: async () => [{ month: MONTH, item: answer("XR-1") }],
      markSynced: vi.fn(async () => {}),
    });
    expect(later.alreadyOnDisk).toBe(1);
  });
});
