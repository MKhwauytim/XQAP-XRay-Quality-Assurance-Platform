/* @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMemoryDirectory, setSimulatedFaults } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeWriteJson } from "../storage/safeWrite";
import { getPopulationMonthDir, getSampleMainDir } from "../workspace/workspacePaths";
import { closeMonth, invalidateMonthLockCache } from "../population/monthLock";
import type { MonthManifestData } from "../population/monthTypes";
import { setReadOnlyMode } from "../storage/readOnlyMode";
import { subscribeToDataChange, type DataRefreshDetail } from "../workspace/dataRefreshSignal";
import { answerDraftKey, loadAnswerDraft, saveAnswerDraft } from "./answerDraftStore";
import { __resetAnswerEventsCacheForTests, loadEmployeeAnswers, upsertItemAnswer } from "./answerStorage";
import * as answerLocalMirror from "./answerLocalMirror";
import type { ItemAnswer } from "./answerTypes";
import { backfillAnswerMirror, replayPendingAnswers } from "./pendingAnswerReplay";

vi.mock("./answerLocalMirror", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./answerLocalMirror")>();
  return { ...actual, mirrorAnswerLocally: vi.fn(actual.mirrorAnswerLocally) };
});
const mirrorMock = vi.mocked(answerLocalMirror.mirrorAnswerLocally);

const MONTH = "5-May-2026";
const MONTH_EARLY = "1-January-2026"; // sorts before MONTH -- used for the closed-month ordering test
const ADHOC = "adhoc-imp-1";

const ANSWER_NDJSON_SEGMENT_ONLY_FAULTS = [
  { operation: "readFile" as const, nameSuffix: ".ndjson", errorName: "NotReadableError", times: Number.POSITIVE_INFINITY },
  { operation: "getFile" as const, nameSuffix: ".ndjson", errorName: "NotReadableError", times: Number.POSITIVE_INFINITY },
];

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

/** Realistic precondition for every pending record: the month's sample/main
 *  folder already exists (an employee can only have a failed save for a
 *  month they were already assigned in). Seeds it with one unrelated item so
 *  `1-main` — and, for a real (non-ad-hoc) month, the population month dir a
 *  manifest can be written into — are on disk before replay ever runs. */
async function seedMonth(root: DirectoryHandleLike, month: string): Promise<void> {
  const seeded = await upsertItemAnswer(root, month, "emp1", answer("SEED"));
  if (!seeded.ok) throw new Error(`seed failed: ${seeded.error}`);
  __resetAnswerEventsCacheForTests();
}

async function writeOpenManifest(root: DirectoryHandleLike, month: string): Promise<void> {
  const monthDir = await getPopulationMonthDir(root, month, true);
  const manifest: MonthManifestData = {
    monthFolderName: month, month: 1, year: 2026,
    processedAt: new Date().toISOString(), processedBy: "admin",
    riskFileName: null, biFileName: null, certScanUsed: false,
    templateVersion: null, rngSeed: null, totalRawRows: 0, totalProcessedRows: 1,
    status: "distributed",
  };
  await safeWriteJson(monthDir, "month.manifest.json", manifest);
}

beforeEach(() => {
  localStorage.clear();
  __resetAnswerEventsCacheForTests();
  invalidateMonthLockCache();
  setReadOnlyMode(false);
  mirrorMock.mockClear();
});

describe("replayPendingAnswers (A1)", () => {
  it("replays every pending answer — any month, ad-hoc folders too — clears its draft, and announces it once", async () => {
    const root = createMemoryDirectory("root");
    await seedMonth(root, MONTH);
    await seedMonth(root, ADHOC);
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

    expect(summary).toEqual({ replayed: 2, alreadyOnDisk: 0, failed: 0, cannotLand: 0 });
    expect(loadAnswerDraft(answerDraftKey(MONTH, "XR-1", "emp1"))).toBeNull();
    expect(loadAnswerDraft(answerDraftKey(ADHOC, adhocId, "emp1"))).toBeNull();
    expect((await loadEmployeeAnswers(root, MONTH, "emp1")).items.map((item) => item.xrayImageId)).toEqual(
      expect.arrayContaining(["SEED", "XR-1"])
    );
    expect((await loadEmployeeAnswers(root, ADHOC, "emp1")).items.map((item) => item.xrayImageId)).toEqual(
      expect.arrayContaining(["SEED", adhocId])
    );
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

    expect(summary).toEqual({ replayed: 0, alreadyOnDisk: 1, failed: 0, cannotLand: 0 });
    expect(markSynced).toHaveBeenCalledWith(MONTH, "emp1", expect.objectContaining({ xrayImageId: "XR-1" }));
  });

  it("does nothing and announces nothing when the queue is empty", async () => {
    const root = createMemoryDirectory("root");
    const seen: DataRefreshDetail[] = [];
    const stop = subscribeToDataChange(["answers"], (detail) => { seen.push(detail); });
    const summary = await replayPendingAnswers(root, "emp1", { loadPending: async () => [], markSynced: vi.fn(async () => {}) });
    stop();
    expect(summary).toEqual({ replayed: 0, alreadyOnDisk: 0, failed: 0, cannotLand: 0 });
    expect(seen).toHaveLength(0);
  });

  // F14: replay happens ONLY through this module now (XrayInspectionResults'
  // on-load reconcile became count-only), so the shared in-flight guard is
  // what stands between "the runner's mount tick and its own next tick
  // overlap" (or a second runner instance briefly mounted during a remount)
  // and a duplicated answer event for the same pending item.
  it("joins a second concurrent call for the same user instead of writing the same pending item twice", async () => {
    const root = createMemoryDirectory("root");
    await seedMonth(root, MONTH);
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
    expect(firstSummary).toEqual({ replayed: 1, alreadyOnDisk: 0, failed: 0, cannotLand: 0 });
    expect((await loadEmployeeAnswers(root, MONTH, "emp1")).items.map((item) => item.xrayImageId)).toEqual(
      expect.arrayContaining(["SEED", "XR-1"])
    );

    // A later, separate call (after the in-flight run completed) sees the
    // item already on disk rather than being blocked forever.
    const later = await replayPendingAnswers(root, "emp1", {
      loadPending: async () => [{ month: MONTH, item: answer("XR-1") }],
      markSynced: vi.fn(async () => {}),
    });
    expect(later.alreadyOnDisk).toBe(1);
  });

  // IMPORTANT 2 (fix round 1): the in-tab join above only protects a single
  // realm. This exercises the SEPARATE cross-tab guard -- withTryResourceLock
  // keyed off the same resource -- by calling it with deps that bypass the
  // in-tab dedupe (two independently-constructed dep objects would normally
  // still share the dedupe key; here we instead assert the cross-tab lock
  // itself skips rather than double-runs a concurrent pass for the same
  // resource key, using webLocks.test.ts's own primitive as the ground truth
  // and just confirming replayPendingAnswers's write lands exactly once even
  // when two calls race).
  it("a pending item is written exactly once when two overlapping replay calls race for the same user", async () => {
    const root = createMemoryDirectory("root");
    await seedMonth(root, MONTH);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let loadPendingCalls = 0;
    const deps = {
      loadPending: async () => {
        loadPendingCalls += 1;
        await gate;
        return [{ month: MONTH, item: answer("RACE-1") }];
      },
      markSynced: vi.fn(async () => {}),
    };

    const a = replayPendingAnswers(root, "emp1", deps);
    const b = replayPendingAnswers(root, "emp1", deps);
    release();
    await Promise.all([a, b]);

    expect(loadPendingCalls).toBe(1);
    const file = await loadEmployeeAnswers(root, MONTH, "emp1");
    expect(file.items.filter((item) => item.xrayImageId === "RACE-1")).toHaveLength(1);
  });

  // CRITICAL 1: a month-closed throw for ONE item used to abort the whole
  // pass -- including months sorted after it. MONTH_EARLY sorts before
  // MONTH, so the buggy version never even reached MONTH's item.
  it("a closed month sorted before an open one leaves its item pending but still lands the open month's item", async () => {
    const root = createMemoryDirectory("root");
    await seedMonth(root, MONTH_EARLY);
    await seedMonth(root, MONTH);
    await writeOpenManifest(root, MONTH_EARLY);
    await closeMonth(root, MONTH_EARLY, "admin");

    const summary = await replayPendingAnswers(root, "emp1", {
      loadPending: async () => [
        { month: MONTH_EARLY, item: answer("CLOSED-1") },
        { month: MONTH, item: answer("OPEN-1") },
      ],
      markSynced: vi.fn(async () => {}),
    });

    expect(summary).toEqual({ replayed: 1, alreadyOnDisk: 0, failed: 0, cannotLand: 1 });
    expect((await loadEmployeeAnswers(root, MONTH, "emp1")).items.map((i) => i.xrayImageId)).toEqual(
      expect.arrayContaining(["OPEN-1"])
    );
    expect((await loadEmployeeAnswers(root, MONTH_EARLY, "emp1")).items.map((i) => i.xrayImageId)).not.toContain(
      "CLOSED-1"
    );
  });

  // NOTE: `upsertItemAnswer`'s own write path (`answerStorage.ts`) never
  // itself checks `isReadOnlyMode()`/throws `ReadOnlyModeError` today --
  // demo/read-only sessions are the runner-level gate's job (IMPORTANT 4,
  // see PendingAnswerReplayRunner.test.tsx: "does not replay in read-only
  // mode"). The `ReadOnlyModeError` branch in the per-item catch above is
  // kept as defensive, forward-compatible coverage for a future write path
  // that DOES throw it (matching `MonthClosedError`'s sibling branch, which
  // IS exercised end-to-end above), not because it fires today.

  // IMPORTANT 1: a strict-unreadable segment must never be treated as "not
  // on disk" (the lenient read's old behavior) -- that would let a stale
  // local copy win over a genuinely newer on-disk answer. The whole month is
  // skipped this pass instead; nothing is written.
  it("skips a month whose event segments cannot be strictly read, leaving its item pending", async () => {
    const root = createMemoryDirectory("root");
    await seedMonth(root, MONTH);
    setSimulatedFaults(root, ANSWER_NDJSON_SEGMENT_ONLY_FAULTS);

    const summary = await replayPendingAnswers(root, "emp1", {
      loadPending: async () => [{ month: MONTH, item: answer("XR-1") }],
      markSynced: vi.fn(async () => {}),
    });
    expect(summary).toEqual({ replayed: 0, alreadyOnDisk: 0, failed: 0, cannotLand: 1 });

    setSimulatedFaults(root, []);
    __resetAnswerEventsCacheForTests();
    const file = await loadEmployeeAnswers(root, MONTH, "emp1");
    expect(file.items.map((item) => item.xrayImageId)).toEqual(["SEED"]); // nothing written
  });

  // IMPORTANT 3: replay must never create a month's sample/main folder --
  // only land into one that already exists.
  it("never creates a month's sample/main folder for a month that was never set up", async () => {
    const root = createMemoryDirectory("root");
    const neverSetUp = "9-September-2026";

    const summary = await replayPendingAnswers(root, "emp1", {
      loadPending: async () => [{ month: neverSetUp, item: answer("XR-1") }],
      markSynced: vi.fn(async () => {}),
    });

    expect(summary).toEqual({ replayed: 0, alreadyOnDisk: 0, failed: 0, cannotLand: 1 });
    await expect(getSampleMainDir(root, neverSetUp, false)).rejects.toMatchObject({ name: "NotFoundError" });
  });
});

describe("backfillAnswerMirror (A1 / IMPORTANT 5)", () => {
  it("re-mirrors every item currently on disk, without writing to the workspace file", async () => {
    const root = createMemoryDirectory("root");
    expect((await upsertItemAnswer(root, MONTH, "emp1", answer("XR-1"))).ok).toBe(true);
    mirrorMock.mockClear();

    await backfillAnswerMirror(root, MONTH, "emp1");

    expect(mirrorMock).toHaveBeenCalledWith(MONTH, "emp1", expect.objectContaining({ xrayImageId: "XR-1" }));
  });
});
