/* @vitest-environment jsdom */
// Regression test for DEFECT 4 — the Browse ("البيانات") XLSX export had no
// permission gate at all: the button was disabled only on "no visible columns",
// so a guest (view-browse defaults true, export-reports defaults false) could
// export the whole month — population, sample, raw risk and BI rows — while the
// identical export one screen over (Phase 2's handleExportPopulation) correctly
// denied them.
//
// Per CLAUDE.md the centralized capability must be enforced at BOTH boundaries,
// so this covers the render boundary (button disabled) and the handler boundary
// (a forced click still refuses and writes nothing) — a control that renders
// enabled but rejects at the handler is the documented bug class here, and the
// inverse (render-only gating) is exactly what shipped.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryDirectory } from "../../../../data/storage/memoryDirectory";
import type { DirectoryHandleLike } from "../../../../data/storage/fileSystemAccess";
import { saveMonthRun } from "../../../../data/population/populationStorage";
import { DEFAULT_POPULATION_CONFIG } from "../../../../data/population/populationConfig";
import { getLabels } from "../../../../data/labels/labelsStore";
import BrowseDataView from "./BrowseDataView";

const MONTH_FOLDER = "5-may-2026";

const writeFileSpy = vi.fn();

// Only XLSX.writeFile is stubbed — it is the actual data-egress call (it triggers
// the browser download). Everything else stays real so the export path runs.
vi.mock("xlsx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("xlsx")>();
  return { ...actual, writeFile: (...args: unknown[]) => writeFileSpy(...args) };
});

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

beforeEach(() => {
  writeFileSpy.mockClear();
});

afterEach(() => {
  cleanup();
});

async function renderBrowse(canExportReports: boolean) {
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
      canExportReports={canExportReports}
    />
  );

  await screen.findByText("X-1");
  return screen.getByRole("button", { name: "تصدير XLSX" });
}

function forceEnable(button: HTMLButtonElement): void {
  button.disabled = false;
  const propsKey = Object.keys(button).find((key) => key.startsWith("__reactProps$"));
  if (!propsKey) throw new Error("react props key not found on the export button");
  // React freezes element props in dev, so swap in a copy rather than mutating.
  const node = button as unknown as Record<string, Record<string, unknown>>;
  node[propsKey] = { ...node[propsKey], disabled: false };
}

describe("BrowseDataView — XLSX export permission gate (DEFECT 4)", () => {
  it("render boundary: the export button is disabled without export-reports", async () => {
    const button = await renderBrowse(false);
    expect(button).toBeDisabled();
  });

  it("handler boundary: a forced click without export-reports exports nothing and explains why", async () => {
    const button = await renderBrowse(false);

    // Bypass the render-time gate the way a tampered DOM would, so the
    // handler's own check is what is under test. React filters mouse events by
    // the *fiber's* `props.disabled` (shouldPreventMouseEvent), not by the DOM
    // attribute, so both have to be cleared for the click to reach onClick.
    forceEnable(button as HTMLButtonElement);
    fireEvent.click(button);

    await screen.findByText(getLabels().msg_export_not_permitted);
    expect(writeFileSpy).not.toHaveBeenCalled();
  });

  it("with export-reports the button is enabled and the export still runs", async () => {
    const button = await renderBrowse(true);
    expect(button).toBeEnabled();

    fireEvent.click(button);
    await waitFor(() => expect(writeFileSpy).toHaveBeenCalledTimes(1));
  });
});
