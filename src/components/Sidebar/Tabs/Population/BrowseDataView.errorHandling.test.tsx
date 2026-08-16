/* @vitest-environment jsdom */
// Finding 10 — silent failures and English leakage in Browse error paths.
//
//  (a) Export failure: `exportFilteredRowsToXlsx` was a bare try/finally with
//      no catch — a thrown error became an unhandled rejection, `finally`
//      cleared `isExporting` as if the export had succeeded, and the
//      already-wired `bv-export-error` banner never appeared. Fixed with a
//      catch that logs the raw detail and surfaces a fixed Arabic message.
//
//  (b) Worker JSON.parse errors carry the raw V8 English message (e.g.
//      "Unexpected token < in JSON at position 0"), which used to be
//      interpolated directly into the Arabic error banner. Fixed by logging
//      the raw detail and rendering a fixed Arabic description instead.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryDirectory } from "../../../../data/storage/memoryDirectory";
import type { DirectoryHandleLike } from "../../../../data/storage/fileSystemAccess";
import { saveMonthRun } from "../../../../data/population/populationStorage";
import { DEFAULT_POPULATION_CONFIG } from "../../../../data/population/populationConfig";
import { getPopulationMonthDir, POPULATION_SUBFOLDERS } from "../../../../data/workspace/workspacePaths";
import { clearErrors, getRecentErrors } from "../../../../data/storage/errorLogger";
import BrowseDataView from "./BrowseDataView";

const MONTH_FOLDER = "5-may-2026";

const writeFileSpy = vi.fn();

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

async function seedMonth(): Promise<DirectoryHandleLike> {
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

beforeEach(() => {
  writeFileSpy.mockReset();
  clearErrors();
});

afterEach(() => {
  cleanup();
});

describe("BrowseDataView — export failure is caught and surfaced (finding 10a)", () => {
  it("shows the export-error banner, logs the failure, and re-enables the button instead of failing silently", async () => {
    writeFileSpy.mockImplementation(() => {
      throw new Error("disk full");
    });

    const dir = await seedMonth();
    renderBrowse(dir);
    await screen.findByText("X-1");

    const exportButton = screen.getByRole("button", { name: "تصدير XLSX" });
    fireEvent.click(exportButton);

    // Pre-fix: the thrown error was swallowed by the bare try/finally — no
    // banner ever appeared and the button silently re-enabled as if nothing
    // had gone wrong.
    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).toMatch(/تعذّر تصدير البيانات/);
    expect(exportButton).toBeEnabled();
    expect(exportButton).not.toHaveAttribute("aria-busy", "true");

    expect(getRecentErrors().some((entry) => entry.context === "browse:export")).toBe(true);
  });
});

describe("BrowseDataView — worker parse error never leaks raw English text (finding 10b)", () => {
  it("shows a fixed Arabic description (not the raw V8 parse-error message) and logs the raw detail", async () => {
    const dir = await seedMonth();

    // Corrupt the live file AND its .bak/.tmp snapshots, forcing the worker's
    // JSON.parse to fail — same setup as the I1 regression in
    // BrowseDataView.workerRace.test.tsx.
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

    // Pre-fix: `err.message` (English V8 text, e.g. "Unexpected token ... in
    // JSON") was interpolated directly into this Arabic banner.
    const banner = document.body.textContent ?? "";
    expect(banner).not.toMatch(/Unexpected token/i);
    expect(banner).not.toMatch(/JSON\.parse/i);
    expect(screen.getByText(/تم تسجيل تفاصيل الخطأ/)).toBeInTheDocument();

    // The raw detail is still captured for diagnostics, just not rendered.
    await waitFor(() => {
      const loggedEntry = getRecentErrors().find((entry) => entry.context === "browse:worker-query");
      expect(loggedEntry).toBeDefined();
      expect(loggedEntry?.message.length).toBeGreaterThan(0);
    });
  });
});
