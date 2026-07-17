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
  usePermissions: () => ({ can: () => true }),
}));

const APRIL_FOLDER = "4-april-2026";
const MAY_FOLDER = "5-may-2026";

type MockSelection = { kind: "existing"; month: number; year: number; folderName: string };

// Mutable selection the mocked hook reads — flipped mid-test to simulate a
// rapid double month-switch (established pattern: see
// useApprovalData.test.tsx's globalMonthMock).
const monthMock = vi.hoisted(() => {
  const state: { selection: { kind: "existing"; month: number; year: number; folderName: string } } = {
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
const raceMock = vi.hoisted(() => {
  let resolveAprilGate: (() => void) | null = null;
  const aprilGatePromise = new Promise<void>((resolve) => {
    resolveAprilGate = resolve;
  });
  const loadPromises: Record<string, Promise<unknown>> = {};
  return {
    aprilGatePromise,
    resolveAprilGate: () => resolveAprilGate?.(),
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
          await raceMock.aprilGatePromise;
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
});

function selectExisting(month: number, year: number, folderName: string): MockSelection {
  return { kind: "existing", month, year, folderName };
}

function populationChipText(): string | null {
  const chip = Array.from(document.querySelectorAll(".status-chip")).find((el) =>
    el.textContent?.includes("المجتمع")
  );
  return chip?.textContent ?? null;
}

describe("Population — overlapping month-load race (I-2)", () => {
  it("a superseded (April) load's data never overwrites a newer (May) load that already committed", async () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);

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
});
