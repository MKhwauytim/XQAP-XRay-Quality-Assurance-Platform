/* @vitest-environment jsdom */
// Task 2 (§P steps 1-2) — regression test for BrowseDataView's search debounce.
//
// Bug: the search input re-filtered the full dataset on every keystroke (no
// debounce), and `rowMatchesSearch` recomputed `search.trim().toLowerCase()`
// once per row on every keystroke. The fix mirrors DataTable/index.tsx's
// already-working pattern: an immediate `search` state for the input value,
// a `debouncedSearch` state (200ms, setTimeout/useRef) that's already
// normalized when set, and filtering reads only `debouncedSearch`.
//
// These tests use real timers (matching DataTable/index.test.tsx's own
// debounce test, which awaits via `waitFor` rather than faking timers).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryDirectory } from "../../../../data/storage/memoryDirectory";
import type { DirectoryHandleLike } from "../../../../data/storage/fileSystemAccess";
import { saveMonthRun } from "../../../../data/population/populationStorage";
import { DEFAULT_POPULATION_CONFIG } from "../../../../data/population/populationConfig";
import BrowseDataView from "./BrowseDataView";

const MONTH_FOLDER = "5-may-2026";

// BrowseDataView now owns its search/filter/sort/paginate work via a real Web
// Worker (Phase B, large-population perf proposal). Vitest's node/jsdom
// environment cannot run a real DedicatedWorker (same limitation documented in
// Population.wizard.test.tsx / populationQueryWorker.test.ts), so the Vite
// `?worker&inline` import is mocked with the shared stub that runs the SAME
// exported pure `handleWorkerMessage` the real worker uses, on a **macrotask**
// and serially — see populationQueryWorkerTestStub.ts for why a microtask reply
// (what this mock used to do) is impossible for a real worker and hid two
// Critical staleness bugs.
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
      canExportReports
    />
  );

  await screen.findByText(String(rows[0]?.["xrayImageId"] ?? ""));
}

const ROWS = [
  { xrayImageId: "X-1", portName: "ميناء الرياض", stage: "المستوى الأول" },
  { xrayImageId: "X-2", portName: "ميناء جدة", stage: "المستوى الأول" },
  { xrayImageId: "X-3", portName: "ميناء الدمام", stage: "المستوى الأول" }
];

describe("BrowseDataView — search debounce (Task 2, §P steps 1-2)", () => {
  it("does not re-filter immediately on keystroke, then filters ~200ms later (case-insensitive, trimmed)", async () => {
    await renderPopulationBrowse(ROWS);

    const search = screen.getByPlaceholderText("بحث في جميع الأعمدة...");
    // Lowercase + surrounding whitespace: exercises both the case-insensitive
    // match and the trim, which now happen once at debounce-commit time
    // rather than per-row inside rowMatchesSearch.
    fireEvent.change(search, { target: { value: "  x-2  " } });

    // Immediately after the keystroke, nothing has been filtered yet.
    expect(screen.getByText("X-1")).toBeInTheDocument();
    expect(screen.getByText("X-3")).toBeInTheDocument();

    // After the debounce window elapses, only the matching row remains.
    await waitFor(() => expect(screen.queryByText("X-1")).not.toBeInTheDocument());
    expect(screen.getByText("X-2")).toBeInTheDocument();
    expect(screen.queryByText("X-3")).not.toBeInTheDocument();
  });

  it("clearing filters resets both the immediate and debounced search state and cancels a pending debounce", async () => {
    await renderPopulationBrowse(ROWS);

    const search = screen.getByPlaceholderText("بحث في جميع الأعمدة...");
    fireEvent.change(search, { target: { value: "جدة" } });

    const clearButton = screen.getByRole("button", { name: "مسح التصفية" });
    fireEvent.click(clearButton);

    expect(search).toHaveValue("");

    // Wait past the original 200ms debounce window to prove the pending
    // timer was cancelled — filtering must never fire after clearing.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(screen.getByText("X-1")).toBeInTheDocument();
    expect(screen.getByText("X-2")).toBeInTheDocument();
    expect(screen.getByText("X-3")).toBeInTheDocument();
  });
});
