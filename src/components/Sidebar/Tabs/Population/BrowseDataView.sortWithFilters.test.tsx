/* @vitest-environment jsdom */
// Bug B coverage. NOT a fix — the investigation (see
// docs/superpowers/plans/2026-08-24-datatable-sort-filter-consistency-plan.md,
// Task 2) found sort and column filters compose correctly on BOTH Browse query
// paths. What was missing was proof at the COMPONENT level: populationQuery's
// own suite pins the pure engine, but nothing pinned that BrowseDataView keeps
// `sort` in the params it posts when `columnFilters` changes, or that the
// async worker round trip preserves it. These tests fail loudly if a future
// refactor drops either.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryDirectory } from "../../../../data/storage/memoryDirectory";
import type { DirectoryHandleLike } from "../../../../data/storage/fileSystemAccess";
import { saveMonthRun } from "../../../../data/population/populationStorage";
import { DEFAULT_POPULATION_CONFIG } from "../../../../data/population/populationConfig";
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

afterEach(cleanup);

// Two ports × three ids each. Sorting by معرف الأشعة puts them in a known order;
// filtering to one port must keep that order among the survivors, which is the
// exact composition under test.
const ROWS = [
  { xrayImageId: "X-30", portName: "ميناء الأول",  stage: "المستوى الأول" },
  { xrayImageId: "X-10", portName: "ميناء الثاني", stage: "المستوى الأول" },
  { xrayImageId: "X-20", portName: "ميناء الأول",  stage: "المستوى الأول" },
  { xrayImageId: "X-40", portName: "ميناء الثاني", stage: "المستوى الأول" },
  { xrayImageId: "X-50", portName: "ميناء الأول",  stage: "المستوى الأول" }
];

async function renderBrowse() {
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
    nonCertScanRows: ROWS.length
  });
  render(
    <BrowseDataView
      directoryHandle={dir}
      refreshKey={0}
      username="tester"
      config={DEFAULT_POPULATION_CONFIG}
      canExportReports
    />
  );
  await screen.findByText("X-30");
}

/** The معرف الأشعة column's rendered values, in visual row order. */
function visibleIds(): string[] {
  return Array.from(document.querySelectorAll("tbody tr"))
    .map((tr) => Array.from(tr.querySelectorAll("td")).map((td) => td.textContent ?? ""))
    .flat()
    .filter((text) => /^X-\d+$/.test(text));
}

// Matched by PREFIX, not exact string: once a column is sorted, its aria-label
// grows a direction suffix ("ترتيب حسب معرف الأشعة (تصاعدي)") — an exact-name
// query would stop matching the same button after the first click.
async function sortByXrayId(): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: /^ترتيب حسب معرف الأشعة/ }));
}

async function filterToFirstPort(): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: "تصفية المنفذ" }));
  const menu = within(screen.getByRole("dialog", { name: "تصفية المنفذ" }));
  await waitFor(() => expect(menu.getByText("ميناء الأول")).toBeTruthy());
  const checkbox = menu.getByText("ميناء الأول").closest("label")?.querySelector("input");
  if (!checkbox) throw new Error("Expected a checkbox next to the 'ميناء الأول' filter option");
  fireEvent.click(checkbox);
}

describe("BrowseDataView — sort survives a filter change (worker path, Bug B)", () => {
  it("keeps the active sort when a column filter is applied after sorting", async () => {
    await renderBrowse();

    await sortByXrayId();
    await waitFor(() => expect(visibleIds()).toEqual(["X-10", "X-20", "X-30", "X-40", "X-50"]));

    await filterToFirstPort();

    // Both constraints must hold at once: only ميناء الأول's rows survive, AND
    // they are still ascending. A dropped sort would show them in the seeded
    // order (X-30, X-20, X-50) instead.
    await waitFor(() => expect(visibleIds()).toEqual(["X-20", "X-30", "X-50"]));
  });

  it("keeps the active filter when a sort is applied after filtering", async () => {
    await renderBrowse();

    await filterToFirstPort();
    await waitFor(() => expect(visibleIds()).toEqual(["X-30", "X-20", "X-50"]));

    await sortByXrayId();

    await waitFor(() => expect(visibleIds()).toEqual(["X-20", "X-30", "X-50"]));
  });

  it("cycles asc → desc → none without losing the filter at any step", async () => {
    await renderBrowse();
    await filterToFirstPort();
    await waitFor(() => expect(visibleIds()).toEqual(["X-30", "X-20", "X-50"]));

    await sortByXrayId();
    await waitFor(() => expect(visibleIds()).toEqual(["X-20", "X-30", "X-50"]));

    await sortByXrayId();
    await waitFor(() => expect(visibleIds()).toEqual(["X-50", "X-30", "X-20"]));

    await sortByXrayId(); // third click clears the sort (cycleSort returns null)
    await waitFor(() => expect(visibleIds()).toEqual(["X-30", "X-20", "X-50"]));
  });

  it("clears sort — and only sort — on a dataset switch, per the deliberate [dataset] reset", async () => {
    await renderBrowse();
    await sortByXrayId();
    await waitFor(() => expect(visibleIds()).toEqual(["X-10", "X-20", "X-30", "X-40", "X-50"]));

    // Switching datasets and back must land on an unsorted table again, proving
    // the [dataset]-scoped reset at BrowseDataView.tsx:706-713 still fires and
    // was not accidentally widened to fire on filter changes too. The dataset
    // picker is a button-group toggle (role="group"), not a <select>. The
    // "sample" dataset has no seeded data in this harness, so row order after
    // returning to "population" is asserted via the sort button's accessible
    // name reverting to its unsorted form rather than via row content — a more
    // robust proxy for "sort is null again" that does not depend on how the
    // now-unrelated "sample" load behaves.
    const datasetGroup = within(screen.getByRole("group", { name: "مصدر البيانات" }));
    fireEvent.click(datasetGroup.getByRole("button", { name: "العينة المسحوبة" }));
    fireEvent.click(datasetGroup.getByRole("button", { name: "المجتمع النهائي" }));

    await screen.findByText("X-30");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "ترتيب حسب معرف الأشعة" })).toBeInTheDocument()
    );
  });
});

describe("BrowseDataView — sort survives a filter change (sync fallback path, Bug B)", () => {
  it("composes sort and filter identically when the worker path is not in use", async () => {
    await renderBrowse();

    // Ticking "كل الأشهر" (show all months) drops out of the worker path
    // entirely (useWorkerPath requires !showAllMonths) onto loadBrowseRows +
    // synchronous runPopulationQuery. Same data, same UI, different engine —
    // the two must not diverge.
    fireEvent.click(screen.getByLabelText("كل الأشهر"));
    await waitFor(() => expect(visibleIds().length).toBe(ROWS.length));

    await sortByXrayId();
    await waitFor(() => expect(visibleIds()).toEqual(["X-10", "X-20", "X-30", "X-40", "X-50"]));

    await filterToFirstPort();
    await waitFor(() => expect(visibleIds()).toEqual(["X-20", "X-30", "X-50"]));
  });
});
