/* @vitest-environment jsdom */
// A10 (perf/sync enhancement 2026-08-12, docs/architecture/
// PERF_SYNC_ENHANCEMENT_2026-08-12.md §A10, F24): BrowseDataView used to
// unmount the whole table and render LoadingState on EVERY load-effect
// re-run -- including a `refreshKey` bump after a wizard mutation or a month
// switch -- even though it had already rendered rows for a prior load. The
// fix keeps the table (and its previously-fetched rows) mounted across a
// reload, dimmed under an overlay, and blanks to LoadingState only on the
// very first load of this component's lifetime (`loadGeneration === 0`).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { createMemoryDirectory } from "../../../../data/storage/memoryDirectory";
import type { DirectoryHandleLike } from "../../../../data/storage/fileSystemAccess";
import { saveMonthRun } from "../../../../data/population/populationStorage";
import { DEFAULT_POPULATION_CONFIG } from "../../../../data/population/populationConfig";
import BrowseDataView from "./BrowseDataView";

const MONTH_FOLDER = "5-may-2026";

// Same realistic (macrotask-reply, serial-drain) query worker stub used by
// BrowseDataView.search.test.tsx -- a no-op stub would resolve on a
// microtask, which is impossible for a real worker and would hide exactly
// the kind of "did it blank before the reply landed" regression this test
// targets.
vi.mock("../../../../workers/populationQueryWorker?worker&inline", async () => {
  const { createPopulationQueryWorkerStubClass } = await import("./populationQueryWorkerTestStub");
  return { default: createPopulationQueryWorkerStubClass() };
});

vi.mock("../../../../data/month/useGlobalMonth", () => ({
  useGlobalMonth: () => ({
    months: [{ month: 5, year: 2026, folderName: MONTH_FOLDER }],
    selection: { kind: "existing", month: 5, year: 2026, folderName: MONTH_FOLDER },
    isSelectedMonthClosed: false,
    setSelectedMonth: () => true,
    startNewMonth: () => true,
    refreshMonths: async () => {},
    registerMonthChangeGuard: () => () => {},
  }),
}));

afterEach(() => {
  cleanup();
});

const ROWS = [
  { xrayImageId: "X-1", portName: "ميناء الرياض", stage: "المستوى الأول" },
  { xrayImageId: "X-2", portName: "ميناء جدة", stage: "المستوى الأول" },
];

describe("BrowseDataView — keeps prior rows during reload (A10, F24)", () => {
  it("bumping refreshKey keeps rows visible immediately (no LoadingState blank) and shows a refreshing overlay until the reload resolves", async () => {
    const dir = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
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
      processedRows: ROWS,
      certScanRows: 0,
      nonCertScanRows: ROWS.length,
    });

    const { rerender } = render(
      <BrowseDataView directoryHandle={dir} refreshKey={0} username="tester" config={DEFAULT_POPULATION_CONFIG} canExportReports />
    );
    await screen.findByText("X-1");

    const tbodyBefore = document.querySelector(".bv-table tbody");
    expect(tbodyBefore).not.toBeNull();

    // Bump refreshKey -- mirrors what onDistributionChanged/a wizard mutation
    // does in the real app (Population/index.tsx's setMonthRefreshKey).
    rerender(
      <BrowseDataView directoryHandle={dir} refreshKey={1} username="tester" config={DEFAULT_POPULATION_CONFIG} canExportReports />
    );

    // Immediately after the bump -- synchronously, before the worker stub's
    // macrotask reply lands -- the previously-rendered rows and the SAME
    // <tbody> node must still be present, never replaced by LoadingState.
    expect(screen.getByText("X-1")).toBeInTheDocument();
    expect(screen.getByText("X-2")).toBeInTheDocument();
    expect(document.querySelector(".bv-table tbody")).toBe(tbodyBefore);
    expect(screen.queryByText("جاري تحميل بيانات الشهر المحدد...")).not.toBeInTheDocument();

    // The dimmed-overlay affordance is present while the reload is in flight.
    expect(document.querySelector(".bv-table-refresh-overlay")).not.toBeNull();
    expect(document.querySelector(".bv-table-view-refreshing")).not.toBeNull();

    // Once the reload resolves, the overlay clears and the SAME <tbody> node
    // (never unmounted in between) is still what's on screen.
    await waitFor(() => expect(document.querySelector(".bv-table-refresh-overlay")).toBeNull());
    expect(document.querySelector(".bv-table tbody")).toBe(tbodyBefore);
    expect(screen.getByText("X-1")).toBeInTheDocument();
  });

  // Regression guard for the A10 review fix. The load effect early-returns
  // while `!directoryHandle || !isPresetLoaded`, so `loading` stays false and
  // `loadGeneration` stays 0 -- gating the empty state on `loadGeneration > 0`
  // (as the first cut of A10 did) rendered NOTHING in that window instead of
  // the empty state. A1 makes Browse the manager's landing sub-tab, so that
  // blank panel would have been the first thing a manager saw.
  // The window is a PRESENT directoryHandle whose preset has not resolved yet
  // (a null handle short-circuits to the "choose a workspace" placeholder at
  // BrowseDataView.tsx:1000 and never reaches this branch). Preset loading is
  // disk I/O, so on the first synchronous render isPresetLoaded is still false.
  it("still renders the empty state (not a blank panel) before the first load starts", () => {
    const dir = createMemoryDirectory("root") as unknown as DirectoryHandleLike;

    render(
      <BrowseDataView directoryHandle={dir} refreshKey={0} username="tester" config={DEFAULT_POPULATION_CONFIG} canExportReports />
    );

    expect(screen.getByText("لا توجد بيانات محفوظة لهذا المصدر بعد")).toBeInTheDocument();
    expect(screen.queryByText("جاري تحميل بيانات الشهر المحدد...")).not.toBeInTheDocument();
  });
});
