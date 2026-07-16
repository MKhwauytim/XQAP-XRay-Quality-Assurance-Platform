/* @vitest-environment jsdom */
// I-1 — Reports "month-summary chips" staleness guard.
//
// The monthMeta-loading effect (index.tsx, "Load lightweight meta for the month bar chips")
// had no cancellation guard: if a slow load for a PREVIOUSLY selected month resolved after a
// FASTER load for a NEWER selection, the stale result would silently overwrite the fresher
// chip data. This test forces that exact ordering deterministically (rather than relying on
// jsdom's incidental scheduling) by mocking `loadMonthPopulationFinal` to return a
// per-month-controlled deferred promise, then resolving the newer month's promise BEFORE the
// older month's — the precise inversion the `cancelled` flag guard exists to defend against.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type { DirectoryHandleLike } from "../../../../data/storage/fileSystemAccess";
import type { PopulationFinalData } from "../../../../data/population/monthTypes";
import { createMemoryDirectory } from "../../../../data/storage/memoryDirectory";

// Mutable module-level state so the test can flip the app-wide month selection mid-flight
// (mirrors the pattern already used in ReferralApproval/useApprovalData.test.tsx).
const globalMonthMock = vi.hoisted(() => {
  type MockSelection = { kind: "existing"; month: number; year: number; folderName: string };
  const APRIL: MockSelection = { kind: "existing", month: 4, year: 2026, folderName: "4-april-2026" };
  return { state: { selection: APRIL as MockSelection } };
});

vi.mock("../../../../data/month/useGlobalMonth", () => ({
  useGlobalMonth: () => ({
    months: [
      { month: 4, year: 2026, folderName: "4-april-2026" },
      { month: 5, year: 2026, folderName: "5-may-2026" },
    ],
    selection: globalMonthMock.state.selection,
    isSelectedMonthClosed: false,
    setSelectedMonth: () => true,
    startNewMonth: () => true,
    refreshMonths: async () => {},
    registerMonthChangeGuard: () => () => {},
  }),
}));

vi.mock("../../../../data/workspace/useWorkspace", () => ({
  useWorkspace: () => ({ directoryHandle: (globalThis as { __testDir?: DirectoryHandleLike }).__testDir ?? null }),
}));

// Per-month controlled ("deferred") population loads — lets the test resolve the OLDER
// month's promise strictly AFTER the newer one, forcing the exact race order under test.
const deferreds = vi.hoisted(
  () =>
    new Map<
      string,
      { promise: Promise<PopulationFinalData | null>; resolve: (v: PopulationFinalData | null) => void }
    >()
);

function deferredFor(month: string) {
  let entry = deferreds.get(month);
  if (!entry) {
    let resolve!: (v: PopulationFinalData | null) => void;
    const promise = new Promise<PopulationFinalData | null>((res) => {
      resolve = res;
    });
    entry = { promise, resolve };
    deferreds.set(month, entry);
  }
  return entry;
}

vi.mock("../../../../data/population/populationStorage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../data/population/populationStorage")>();
  return {
    ...actual,
    loadMonthPopulationFinal: vi.fn((_dir: unknown, month: string) => deferredFor(month).promise),
  };
});

import ReportsTab from "./index";

afterEach(() => {
  cleanup();
  deferreds.clear();
  globalMonthMock.state.selection = { kind: "existing", month: 4, year: 2026, folderName: "4-april-2026" };
  delete (globalThis as { __testDir?: DirectoryHandleLike }).__testDir;
});

function mockPop(rowCount: number): PopulationFinalData {
  return {
    sourceMonthFolder: "x",
    processedAt: new Date().toISOString(),
    processedBy: "tester",
    totalRows: rowCount,
    certScanRows: 0,
    nonCertScanRows: rowCount,
    rows: Array.from({ length: rowCount }, (_, i) => ({ xrayImageId: `img-${i}` })),
  };
}

describe("Reports month-summary chips — staleness guard (I-1)", () => {
  it("keeps the newer month's chip data even when the OLDER month's load resolves LATER", async () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    (globalThis as { __testDir?: DirectoryHandleLike }).__testDir = root;

    const { rerender } = render(<ReportsTab />);
    // Mount starts a load for April; it is now suspended on deferredFor("4-april-2026").

    // Flip the global-month selection to May and rerender — this runs the cleanup for
    // April's effect (cancelled = true in the fix) and starts a fresh load for May.
    globalMonthMock.state.selection = { kind: "existing", month: 5, year: 2026, folderName: "5-may-2026" };
    rerender(<ReportsTab />);

    // Resolve MAY (the current selection) FIRST.
    await act(async () => {
      deferredFor("5-may-2026").resolve(mockPop(20));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByText("20 صورة")).toBeInTheDocument();
    });

    // Now resolve APRIL (the stale, superseded selection) AFTER May has already settled.
    // Without the cancelled-flag guard, this late completion would clobber the chip with
    // April's stale data.
    await act(async () => {
      deferredFor("4-april-2026").resolve(mockPop(5));
      await Promise.resolve();
      await Promise.resolve();
    });

    // The chip must still reflect May's data — April's late resolution must be a no-op.
    expect(screen.getByText("20 صورة")).toBeInTheDocument();
    expect(screen.queryByText("5 صورة")).not.toBeInTheDocument();
  });
});
