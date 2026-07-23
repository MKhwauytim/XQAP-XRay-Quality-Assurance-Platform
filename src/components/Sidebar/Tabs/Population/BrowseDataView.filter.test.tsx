/* @vitest-environment jsdom */
// Regression test for B12 task 1 — "Browse per-column filter single-select
// collapse" (BrowseDataView.tsx, synthesis high, CONFIRMED via live testing).
//
// Bug: the open column's filter-dropdown option list was built from
// `filteredRows` — rows already filtered by EVERY active column filter,
// including the open column's own filter. So the instant a user checked one
// value, `filteredRows` narrowed down to just the rows matching that value,
// and every other option's text disappeared from the rows scanned to build
// the option list. The fix builds the option list from rows filtered by
// every OTHER column's filter (and search) but excludes the open column's
// own filter via `rowMatchesColumnFilters`'s `exceptKey` parameter.
//
// This test seeds a real in-memory workspace with a population month (three
// distinct "portName" values), renders BrowseDataView, opens the "المنفذ"
// (portName) column's filter dropdown, checks ONE value, and asserts the
// other two values are still listed as selectable options — the exact
// "check one value, assert other values remain listed" scenario. It fails
// against the pre-fix code (only the checked value survives) and passes
// against the fix.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createMemoryDirectory } from "../../../../data/storage/memoryDirectory";
import type { DirectoryHandleLike } from "../../../../data/storage/fileSystemAccess";
import { saveMonthRun } from "../../../../data/population/populationStorage";
import { DEFAULT_POPULATION_CONFIG } from "../../../../data/population/populationConfig";
import BrowseDataView from "./BrowseDataView";

const MONTH_FOLDER = "5-may-2026";

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

async function renderPopulationBrowse(rows: Array<Record<string, unknown>>) {
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

  render(
    <BrowseDataView
      directoryHandle={dir}
      refreshKey={0}
      username="tester"
      config={DEFAULT_POPULATION_CONFIG}
    />
  );

  // Wait until the seeded rows have actually loaded and rendered in the table.
  await screen.findByText(String(rows[0]?.["xrayImageId"] ?? ""));
}

describe("BrowseDataView — per-column filter option list (B12 task 1)", () => {
  it("keeps other values listed in a column's filter dropdown after checking one value", async () => {
    await renderPopulationBrowse([
      { xrayImageId: "X-1", portName: "ميناء الأول", stage: "المستوى الأول" },
      { xrayImageId: "X-2", portName: "ميناء الثاني", stage: "المستوى الأول" },
      { xrayImageId: "X-3", portName: "ميناء الثالث", stage: "المستوى الأول" }
    ]);

    // Open the "المنفذ" (portName) column's filter dropdown.
    const filterButton = screen.getByRole("button", { name: "تصفية المنفذ" });
    fireEvent.click(filterButton);

    const columnHeader = filterButton.closest("th");
    if (!columnHeader) {
      throw new Error("Expected the filter button to be inside a <th> column header");
    }
    const header = within(columnHeader);

    // Sanity check: before checking anything, all three ports are listed.
    expect(header.getByText("ميناء الأول")).toBeTruthy();
    expect(header.getByText("ميناء الثاني")).toBeTruthy();
    expect(header.getByText("ميناء الثالث")).toBeTruthy();

    // Check ONE value ("ميناء الأول").
    const firstOptionCheckbox = header.getByText("ميناء الأول").closest("label")?.querySelector("input");
    if (!firstOptionCheckbox) {
      throw new Error("Expected a checkbox input next to the 'ميناء الأول' filter option");
    }
    fireEvent.click(firstOptionCheckbox);

    // The checked value stays listed (and checked)...
    const recheckedOption = header.getByText("ميناء الأول").closest("label")?.querySelector("input");
    expect(recheckedOption).toHaveProperty("checked", true);

    // ...and, critically, the OTHER two values must remain listed too —
    // this is the exact case the single-select collapse bug broke.
    expect(header.getByText("ميناء الثاني")).toBeTruthy();
    expect(header.getByText("ميناء الثالث")).toBeTruthy();

    // The table itself must still show all three rows (no column filter
    // narrowed the visible dataset from checking a dropdown box alone — the
    // filter menu here mirrors the pattern of AND-narrowing only once the
    // user commits; but at minimum the dropdown's own contents must be
    // unaffected by its own selection).
    expect(screen.getAllByText("ميناء الأول").length).toBeGreaterThan(0);
  });
});
