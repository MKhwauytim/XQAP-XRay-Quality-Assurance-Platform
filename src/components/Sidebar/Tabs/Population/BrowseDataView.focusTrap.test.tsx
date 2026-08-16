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
});
