/* @vitest-environment jsdom */
// Regression test for I-2 (handleLoadExistingMonth overlapping-load race).
//
// WHY THIS DEVIATES FROM A NAIVE "select A, then immediately select B, then
// waitFor" TEST: two problems make that naive shape unreliable here.
//
//   1. `createMemoryDirectory` (src/data/storage/memoryDirectory.ts) resolves
//      every read through plain, un-delayed Promise chains. Two overlapping
//      loads for two months with the same folder shape advance through the
//      same number of microtask hops, so the *later*-started load does not
//      naturally overtake the earlier one — the exact inversion the race
//      needs almost never happens by accident in jsdom. A naive rerender
//      test would very likely pass "by luck" whether or not the fix exists.
//   2. The wizard's status-bar month chip (`.status-chip` "الشهر") binds
//      directly to `globalMonth.month`/`.year`, not to anything
//      `handleLoadExistingMonth` writes — so asserting on it can't actually
//      observe whether a stale load clobbered fresher state.
//
// To force a genuine, deterministic inversion this test partially mocks
// `data/population/populationStorage` (keeping every real export via
// `importOriginal`, including the real `saveMonthRun`/`loadMonthForEditing`
// logic) and wraps `loadMonthForEditing` so the "4-april-2026" call blocks on
// a manually-released gate. The population-count status chip ("المجتمع"),
// which IS written by `handleLoadExistingMonth`, is the observable target:
// April and May are seeded with different row counts so a clobber is visible.
//
// Sequence: mount on April (load starts, blocks on the gate) -> flip to May
// (unblocked, real read, commits 2 rows) -> release April's gate and await
// its promise directly (so its post-await continuation, buggy or fixed, has
// definitely run before we assert) -> assert May's 2-row state is still what
// is displayed, never April's stale 1-row state.
//
// A second test covers the same clobber class for the OTHER branch of the
// auto-load effect: existing month -> PENDING (new) month. That branch calls
// resetForNewMonth() synchronously (no promise involved) instead of starting
// a new load, so the same "flip to a fresher selection, then release the
// stale gate" sequence is used, but the assertion target is the population
// chip's clean "—" (idle) state rather than a second month's row count.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { createMemoryDirectory } from "../../../../data/storage/memoryDirectory";
import type { DirectoryHandleLike } from "../../../../data/storage/fileSystemAccess";

vi.mock("../../../../workers/workbookWorker?worker&inline", () => ({
  default: class WorkerStub {
    onmessage: ((ev: MessageEvent) => void) | null = null;
    postMessage(): void {}
    terminate(): void {}
    addEventListener(): void {}
    removeEventListener(): void {}
  },
}));

vi.mock("../../../../auth/usePermissions", () => ({
  usePermissions: () => ({ can: () => true, canMutate: () => true }),
}));

const APRIL_FOLDER = "4-april-2026";
const MAY_FOLDER = "5-may-2026";
const JUNE_PENDING_FOLDER = "6-june-2026";

type MockSelection =
  | { kind: "existing"; month: number; year: number; folderName: string }
  | { kind: "pending"; month: number; year: number; folderName: string };

// Mutable selection the mocked hook reads — flipped mid-test to simulate a
// rapid double month-switch (established pattern: see
// useApprovalData.test.tsx's globalMonthMock).
const monthMock = vi.hoisted(() => {
  const state: { selection: MockSelection } = {
    selection: { kind: "existing", month: 4, year: 2026, folderName: "4-april-2026" },
  };
  return { state };
});

vi.mock("../../../../data/month/useGlobalMonth", () => ({
  useGlobalMonth: () => ({
    months: [
      { month: 4, year: 2026, folderName: "4-april-2026" },
      { month: 5, year: 2026, folderName: "5-may-2026" },
    ],
    selection: monthMock.state.selection,
    isSelectedMonthClosed: false,
    setSelectedMonth: () => true,
    startNewMonth: () => true,
    refreshMonths: async () => {},
    registerMonthChangeGuard: () => () => {},
  }),
}));

// Real in-memory workspace directory — set inside the test body before render
// so saveMonthRun/loadMonthForEditing exercise genuine (non-mocked) I/O.
const workspaceMock = vi.hoisted(() => {
  const state: { directoryHandle: unknown } = { directoryHandle: null };
  return { state };
});

vi.mock("../../../../data/workspace/useWorkspace", () => ({
  useWorkspace: () => ({ directoryHandle: workspaceMock.state.directoryHandle }),
}));

// The controlled gate + per-folder promise capture that forces the race.
// The gate is resettable (`resetGate`) so each test gets its own fresh,
// unresolved block on the April folder's load — needed because a promise,
// once resolved, stays resolved, and multiple tests in this file each block
// on "4-april-2026".
const raceMock = vi.hoisted(() => {
  let resolveAprilGate: (() => void) | null = null;
  let aprilGatePromise: Promise<void> = Promise.resolve();
  const loadPromises: Record<string, Promise<unknown>> = {};
  function resetGate(): void {
    aprilGatePromise = new Promise<void>((resolve) => {
      resolveAprilGate = resolve;
    });
  }
  resetGate();
  return {
    getAprilGatePromise: () => aprilGatePromise,
    resolveAprilGate: () => resolveAprilGate?.(),
    resetGate,
    loadPromises,
  };
});

vi.mock("../../../../data/population/populationStorage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../data/population/populationStorage")>();
  return {
    ...actual,
    loadMonthForEditing: (dir: DirectoryHandleLike, folderName: string) => {
      const run = (async () => {
        if (folderName === APRIL_FOLDER) {
          await raceMock.getAprilGatePromise();
        }
        return actual.loadMonthForEditing(dir, folderName);
      })();
      raceMock.loadPromises[folderName] = run;
      return run;
    },
  };
});

import { saveMonthRun } from "../../../../data/population/populationStorage";
import PopulationTab from "./index";

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  monthMock.state.selection = { kind: "existing", month: 4, year: 2026, folderName: APRIL_FOLDER };
  workspaceMock.state.directoryHandle = null;
  raceMock.loadPromises[APRIL_FOLDER] = Promise.resolve();
  raceMock.resetGate();
});

function selectExisting(month: number, year: number, folderName: string): MockSelection {
  return { kind: "existing", month, year, folderName };
}

function selectPending(month: number, year: number, folderName: string): MockSelection {
  return { kind: "pending", month, year, folderName };
}

function populationChipText(): string | null {
  const chip = Array.from(document.querySelectorAll(".status-chip")).find((el) =>
    el.textContent?.includes("المجتمع")
  );
  return chip?.textContent ?? null;
}

// The month-load-in-progress banner (`.month-picker-loading`, "جاري تحميل
// بيانات الشهر..." — see Population/index.tsx). Bound to `isLoadingMonthData`,
// which `handleLoadExistingMonth` sets true at the start of every existing-
// month load. Used to catch the "stuck loading forever" regression: a stale
// load's own `finally` is correctly gated on the load token and skips
// clearing the flag once superseded, so nothing else clearing it (i.e.
// `resetForNewMonth()` not touching it) leaves it permanently true.
function isLoadingBannerPresent(): boolean {
  return document.querySelector(".month-picker-loading") !== null;
}

describe("Population — overlapping month-load race (I-2)", () => {
  it("a superseded (April) load's data never overwrites a newer (May) load that already committed", async () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    raceMock.resetGate();

    const dir = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    workspaceMock.state.directoryHandle = dir;

    // Seed two real, saved months with DIFFERENT row counts so the population
    // status chip can distinguish which month's data is currently committed.
    await saveMonthRun({
      directoryHandle: dir,
      month: 4,
      year: 2026,
      username: "tester",
      riskFileName: null,
      biFileName: null,
      certScanUsed: false,
      riskRawRows: [],
      biRawRows: [],
      processedRows: [{ xrayImageId: "APR-1" }],
      certScanRows: 0,
      nonCertScanRows: 1,
    });
    await saveMonthRun({
      directoryHandle: dir,
      month: 5,
      year: 2026,
      username: "tester",
      riskFileName: null,
      biFileName: null,
      certScanUsed: false,
      riskRawRows: [],
      biRawRows: [],
      processedRows: [{ xrayImageId: "MAY-1" }, { xrayImageId: "MAY-2" }],
      certScanRows: 0,
      nonCertScanRows: 2,
    });

    // Mount on April — the auto-load effect starts April's load, which blocks
    // on the gate inside the mocked loadMonthForEditing (simulating a slow read
    // that has not yet resolved).
    monthMock.state.selection = selectExisting(4, 2026, APRIL_FOLDER);
    const { rerender } = render(<PopulationTab />);

    // Flip to May before April's load resolves — the race window. Wait for
    // May's (unblocked) load to fully commit before asserting.
    monthMock.state.selection = selectExisting(5, 2026, MAY_FOLDER);
    await act(async () => {
      rerender(<PopulationTab />);
      await raceMock.loadPromises[MAY_FOLDER];
    });

    expect(populationChipText()).toContain("2 صف");

    // Release the stale April load and await its promise directly, so its
    // post-await continuation (buggy overwrite, or fixed no-op) has
    // definitely run by the time we assert — no reliance on poll timing.
    await act(async () => {
      raceMock.resolveAprilGate();
      await raceMock.loadPromises[APRIL_FOLDER];
    });

    // May's data must STILL be what's displayed — April's superseded load
    // must not have clobbered it with its stale 1-row state.
    expect(populationChipText()).toContain("2 صف");
    expect(populationChipText()).not.toContain("1 صف");
  });

  it("a superseded (April) load's data never overwrites a newer pending (new-month) reset", async () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    raceMock.resetGate();

    const dir = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    workspaceMock.state.directoryHandle = dir;

    // Seed April with real, saved data so its load has something concrete to
    // (attempt to) commit late.
    await saveMonthRun({
      directoryHandle: dir,
      month: 4,
      year: 2026,
      username: "tester",
      riskFileName: null,
      biFileName: null,
      certScanUsed: false,
      riskRawRows: [],
      biRawRows: [],
      processedRows: [{ xrayImageId: "APR-1" }],
      certScanRows: 0,
      nonCertScanRows: 1,
    });

    // Mount on April — the auto-load effect starts April's load, which blocks
    // on the gate inside the mocked loadMonthForEditing.
    monthMock.state.selection = selectExisting(4, 2026, APRIL_FOLDER);
    const { rerender } = render(<PopulationTab />);

    // Sanity check: April's in-flight load has the loading banner up.
    expect(isLoadingBannerPresent()).toBe(true);

    // Flip to a PENDING (new, unsaved) month before April's load resolves —
    // the else-branch of the auto-load effect runs synchronously
    // (resetForNewMonth, no promise to await), so no act(async) is needed here.
    monthMock.state.selection = selectPending(6, 2026, JUNE_PENDING_FOLDER);
    rerender(<PopulationTab />);

    // The clean reset must already be in effect — no population data at all.
    expect(populationChipText()).toContain("—");
    // Regression guard: entering the clean pending/new-month state must clear
    // the loading flag immediately, even though April's stale load is still
    // in flight — resetForNewMonth() is the only thing that runs synchronously
    // on this branch, so it must be the one clearing it (see index.tsx).
    expect(isLoadingBannerPresent()).toBe(false);

    // Release the stale April load and await its promise directly, so its
    // post-await continuation (buggy overwrite, or fixed no-op) has
    // definitely run by the time we assert — no reliance on poll timing.
    await act(async () => {
      raceMock.resolveAprilGate();
      await raceMock.loadPromises[APRIL_FOLDER];
    });

    // The clean new-month state must STILL be what's displayed — April's
    // superseded load must not have clobbered it with its stale 1-row state.
    expect(populationChipText()).toContain("—");
    expect(populationChipText()).not.toContain("1 صف");
    // The stale load's gated `finally` (token mismatch) must NOT be the only
    // thing standing between the user and a permanently stuck loading banner:
    // it correctly skips clearing the flag, so the pending-branch clear above
    // must be what keeps it cleared here too — a real fix clears it once and
    // it stays cleared; the regression left it stuck true forever from this
    // point on (CRITICAL — I-2 follow-up regression).
    expect(isLoadingBannerPresent()).toBe(false);
  });
});
