/* @vitest-environment jsdom */
// T-08 — Population Browse must not present an UNREADABLE month as an empty one.
//
// `population.final.json` reads collapsed "the month was never processed" and
// "the month's file could not be read right now" into the same `null`, which
// Browse turned into `{"rows":[]}` for the query worker. The user then saw the
// empty state — whose copy is "ابدأ بمعالجة شهر من تبويب معالجة المجتمع", i.e.
// an invitation to re-process (overwrite) a month whose data is still on disk.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryDirectory, clearSimulatedFaults, setSimulatedFaults } from "../../../../data/storage/memoryDirectory";
import type { DirectoryHandleLike } from "../../../../data/storage/fileSystemAccess";
import { saveMonthRun } from "../../../../data/population/populationStorage";
import { DEFAULT_POPULATION_CONFIG } from "../../../../data/population/populationConfig";
import { getPopulationMonthDir, POPULATION_SUBFOLDERS } from "../../../../data/workspace/workspacePaths";
import { clearErrors } from "../../../../data/storage/errorLogger";
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

/** The transient share failure this whole finding is about. */
function breakEveryRead(dir: DirectoryHandleLike): void {
  setSimulatedFaults(dir, [
    { operation: "getFile", errorName: "NotReadableError", times: Number.POSITIVE_INFINITY }
  ]);
}

beforeEach(() => {
  clearErrors();
});

afterEach(() => {
  cleanup();
});

describe("BrowseDataView — unreadable month is an error, never 'no data'", () => {
  it("renders the read-failure error state with a retry, not the re-process invitation", async () => {
    const dir = await seedMonth();
    breakEveryRead(dir);

    renderBrowse(dir);

    await screen.findByText("تعذّر قراءة بيانات هذا الشهر");
    // Pre-fix this was the rendered state: an empty-data message telling the
    // user to go re-process the month.
    expect(screen.queryByText("لا توجد بيانات محفوظة لهذا المصدر بعد")).toBeNull();
    expect(screen.getByRole("button", { name: "إعادة المحاولة" })).toBeInTheDocument();
  });

  it("recovers on retry once the share comes back", async () => {
    const dir = await seedMonth();
    breakEveryRead(dir);
    renderBrowse(dir);
    await screen.findByText("تعذّر قراءة بيانات هذا الشهر");

    clearSimulatedFaults(dir);
    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));

    await screen.findByText("X-1");
    expect(screen.queryByText("تعذّر قراءة بيانات هذا الشهر")).toBeNull();
  });

  it("still shows the ordinary empty state for a month that genuinely has no saved population", async () => {
    const dir = await seedMonth();
    const monthDir = await getPopulationMonthDir(dir, MONTH_FOLDER, false);
    const processedDir = await monthDir.getDirectoryHandle(POPULATION_SUBFOLDERS.processed, { create: false });
    await processedDir.removeEntry?.("population.final.json");

    renderBrowse(dir);

    await screen.findByText("لا توجد بيانات محفوظة لهذا المصدر بعد");
    await waitFor(() =>
      expect(screen.queryByText("تعذّر قراءة بيانات هذا الشهر")).toBeNull()
    );
  });
});
