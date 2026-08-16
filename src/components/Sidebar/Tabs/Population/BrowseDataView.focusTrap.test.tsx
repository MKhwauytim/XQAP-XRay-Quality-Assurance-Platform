/* @vitest-environment jsdom */
// Finding 11 — BrowseDataView's column-picker dropdown and per-column filter
// menu had no focus trap and no Escape-to-close, unlike every other floating
// panel in the app. Fixed by wiring both through the shared `useFocusTrap`
// hook (same call-site shape as GlobalMonthSelector's popoverFocusTrapRef).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

const ROWS = [
  { xrayImageId: "X-1", portName: "ميناء الرياض", stage: "المستوى الأول" },
  { xrayImageId: "X-2", portName: "ميناء جدة", stage: "المستوى الأول" }
];

afterEach(() => {
  cleanup();
});

async function renderBrowse(): Promise<void> {
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

  await screen.findByText("X-1");
}

describe("BrowseDataView — column picker focus trap (finding 11)", () => {
  it("moves focus into the dropdown when it opens and closes it on Escape", async () => {
    await renderBrowse();

    fireEvent.click(screen.getByRole("button", { name: /^الأعمدة/ }));
    const dialog = screen.getByRole("dialog", { name: "اختيار الأعمدة" });
    expect(dialog.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "اختيار الأعمدة" })).not.toBeInTheDocument();
  });
});

describe("BrowseDataView — column filter menu focus trap (finding 11)", () => {
  it("moves focus into the filter menu when it opens and closes it on Escape", async () => {
    await renderBrowse();

    fireEvent.click(screen.getByRole("button", { name: "تصفية المنفذ" }));
    const dialog = screen.getByRole("dialog", { name: "تصفية المنفذ" });
    expect(dialog.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "تصفية المنفذ" })).not.toBeInTheDocument();
  });

  it("re-arms the trap when switching directly from one column's menu to another", async () => {
    // Regression: A→B never passed `enabled` through false, so the trap kept
    // column A's detached node — focus was never moved into B's menu and Tab
    // handling operated on an element no longer in the document.
    await renderBrowse();

    fireEvent.click(screen.getByRole("button", { name: "تصفية المنفذ" }));
    expect(screen.getByRole("dialog", { name: "تصفية المنفذ" }).contains(document.activeElement)).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "تصفية معرف الأشعة" }));
    const second = screen.getByRole("dialog", { name: "تصفية معرف الأشعة" });
    expect(screen.queryByRole("dialog", { name: "تصفية المنفذ" })).not.toBeInTheDocument();
    expect(second.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "تصفية معرف الأشعة" })).not.toBeInTheDocument();
  });
});

describe("BrowseDataView — picker and filter menu are mutually exclusive", () => {
  it("closes the column picker when a filter menu opens, and vice versa", async () => {
    // Regression: both panels could be open at once, leaving two active focus
    // traps on screen (DataTable already forbids this).
    await renderBrowse();

    fireEvent.click(screen.getByRole("button", { name: /^الأعمدة/ }));
    expect(screen.getByRole("dialog", { name: "اختيار الأعمدة" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "تصفية المنفذ" }));
    expect(screen.queryByRole("dialog", { name: "اختيار الأعمدة" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "تصفية المنفذ" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^الأعمدة/ }));
    expect(screen.queryByRole("dialog", { name: "تصفية المنفذ" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "اختيار الأعمدة" })).toBeInTheDocument();
  });
});
