/* @vitest-environment jsdom */
// Regression coverage for the three worker-coordination defects a final
// whole-branch review found in the worker-backed Population Browse path (Phase B,
// large-population perf proposal). All three were invisible to the existing
// BrowseDataView suites because their worker stub replied on a MICROTASK — a
// timing a real DedicatedWorker can never achieve (see
// populationQueryWorkerTestStub.ts). These tests use the shared realistic stub:
// macrotask reply, serial FIFO drain, real `handleWorkerMessage`.
//
//  C2 — "first load always looks stale": the load effect posts "load" and then
//       SYNCHRONOUSLY bumps `loadGeneration`, so the query effect posts "query"
//       before any real worker could answer the load. A single shared
//       latest-request counter then judged the load's own reply stale and dropped
//       it, leaving `totalRows` null / `total` 0 — Browse rendered its "no data"
//       empty state over a perfectly good month.
//
//  C1 — "filtering silently does nothing": the filter-dropdown preview effect
//       posts its OWN queries for an unrelated purpose, and fires in the SAME
//       commit as the main query effect when `columnFilters` changes. Declared
//       later, it got the higher request id, so the main table's own result was
//       judged stale and discarded — the visible table never updated.
//
//  I1 — a worker "error" response (corrupt population.final.json) was read by
//       nobody, so `loading` never cleared and Browse spun forever.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryDirectory } from "../../../../data/storage/memoryDirectory";
import type { DirectoryHandleLike } from "../../../../data/storage/fileSystemAccess";
import { saveMonthRun } from "../../../../data/population/populationStorage";
import { DEFAULT_POPULATION_CONFIG } from "../../../../data/population/populationConfig";
import { getPopulationMonthDir, POPULATION_SUBFOLDERS } from "../../../../data/workspace/workspacePaths";
import BrowseDataView from "./BrowseDataView";

const MONTH_FOLDER = "5-may-2026";

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
    registerMonthChangeGuard: () => () => {}
  })
}));

afterEach(() => {
  cleanup();
});

const ROWS = [
  { xrayImageId: "X-1", portName: "ميناء الأول", stage: "المستوى الأول" },
  { xrayImageId: "X-2", portName: "ميناء الثاني", stage: "المستوى الأول" },
  { xrayImageId: "X-3", portName: "ميناء الثالث", stage: "المستوى الأول" }
];

async function seedMonth(rows: Array<Record<string, unknown>>): Promise<DirectoryHandleLike> {
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
    processedRows: rows,
    certScanRows: 0,
    nonCertScanRows: rows.length
  });
  return dir;
}

function renderBrowse(dir: DirectoryHandleLike) {
  return render(
    <BrowseDataView
      directoryHandle={dir}
      refreshKey={0}
      username="tester"
      config={DEFAULT_POPULATION_CONFIG}
      canExportReports
    />
  );
}

/**
 * Image ids currently rendered in the table BODY (never the filter dropdown,
 * which lives in the header). Picked by value rather than column index so the
 * assertion doesn't silently depend on the default column ORDER.
 */
function visibleRowIds(): string[] {
  return Array.from(document.querySelectorAll(".bv-table tbody tr")).map((row) => {
    const cells = Array.from(row.querySelectorAll("td")).map((cell) => cell.textContent ?? "");
    return cells.find((text) => /^X-\d+$/.test(text)) ?? "";
  });
}

describe("BrowseDataView — worker load/query race (C2)", () => {
  it("applies the 'loaded' response even though the first query is posted before the worker can answer it", async () => {
    const dir = await seedMonth(ROWS);
    renderBrowse(dir);

    // Pre-fix this never appeared at all: `total` stayed 0, so the "no data
    // saved for this source yet" empty state rendered instead of the table.
    await screen.findByText("X-1");
    expect(
      screen.queryByText("لا توجد بيانات محفوظة لهذا المصدر بعد")
    ).not.toBeInTheDocument();

    // `total` comes from the LOAD response's totalRows (unfiltered dataset size),
    // which is a different number from the query result's own totalRows — the
    // toolbar prints both only while a search/filter is active, so searching is
    // what makes the load response's value independently assertable.
    fireEvent.change(screen.getByPlaceholderText("بحث في جميع الأعمدة..."), {
      target: { value: "X-2" }
    });

    await waitFor(() => {
      const rowCount = document.querySelector(".bv-row-count");
      // "1 صف من 3" — 1 matching row (query result) OF 3 total (load response).
      expect(rowCount?.textContent?.replace(/\s+/g, " ")).toMatch(/1 صف من 3/);
    });
  });
});

describe("BrowseDataView — main-table vs filter-preview query lanes (C1)", () => {
  it("updates the visible table when a filter is toggled while the dropdown's own preview query fires in the same commit", async () => {
    const dir = await seedMonth(ROWS);
    renderBrowse(dir);
    await screen.findByText("X-1");
    expect(visibleRowIds()).toEqual(["X-1", "X-2", "X-3"]);

    // Opening the dropdown starts the filter-preview query stream — from here on,
    // every `columnFilters` change fires BOTH effects in the same React commit.
    const filterButton = screen.getByRole("button", { name: "تصفية المنفذ" });
    fireEvent.click(filterButton);

    // Portalled to <body> by AnchoredPopover — see BrowseDataView's filter menu.
    const header = within(screen.getByRole("dialog", { name: "تصفية المنفذ" }));
    await waitFor(() => expect(header.getByText("ميناء الأول")).toBeTruthy());

    const optionCheckbox = header
      .getByText("ميناء الأول")
      .closest("label")
      ?.querySelector("input");
    if (!optionCheckbox) {
      throw new Error("Expected a checkbox input next to the 'ميناء الأول' filter option");
    }
    fireEvent.click(optionCheckbox);

    // THE regression: pre-fix, the preview effect's later request id made the main
    // table's own result look stale, so `queryResult` was never updated and all
    // three rows stayed on screen — filtering appeared to do nothing whatsoever.
    await waitFor(() => expect(visibleRowIds()).toEqual(["X-1"]));

    // ...and the two lanes are mutually independent, not merely reordered: the
    // dropdown's own option list (built with this column's filter excluded) must
    // still list every value.
    expect(header.getByText("ميناء الثاني")).toBeTruthy();
    expect(header.getByText("ميناء الثالث")).toBeTruthy();
  });
});

describe("BrowseDataView — worker error surfacing (I1)", () => {
  it("shows an error state instead of spinning forever when population.final.json cannot be parsed", async () => {
    const dir = await seedMonth(ROWS);

    // Corrupt the live file AND its .bak/.tmp snapshots, so the raw-text recovery
    // ladder in loadMonthPopulationFinalRawText legitimately has nothing good to
    // fall back to and the worker's JSON.parse must fail.
    const monthDir = await getPopulationMonthDir(dir, MONTH_FOLDER, false);
    const processedDir = await monthDir.getDirectoryHandle(POPULATION_SUBFOLDERS.processed, {
      create: false
    });
    for (const name of [
      "population.final.json",
      "population.final.json.bak",
      "population.final.json.tmp"
    ]) {
      const handle = await processedDir.getFileHandle(name, { create: true });
      const writable = await handle.createWritable!();
      await writable.write("{ this is not json");
      await writable.close();
    }

    renderBrowse(dir);

    await screen.findByText("تعذّر تحميل بيانات هذا الشهر");
    // The spinner must be gone — hanging on it forever was the actual defect.
    expect(
      screen.queryByText("جاري تحميل بيانات الشهر المحدد...")
    ).not.toBeInTheDocument();
  });
});
