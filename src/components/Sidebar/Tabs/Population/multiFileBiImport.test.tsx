/* @vitest-environment jsdom */
/**
 * PROD-1 regression — owner report (2026-08-19): "BI data doesn't read all files
 * attached. It starts loading all files, and after it finishes, it shows in red."
 *
 * The symptom is reproduced end to end at the level the owner sees it: several
 * real BI files are parsed by the REAL `processBiWorkbook` (exactly what the
 * worker runs), the per-file outcomes are handed to the REAL
 * `applyBiFileResults` from `usePhaseOneUploads`, and the resulting state is
 * rendered by the REAL `PhaseOneUpload`. Only the thread boundary is skipped.
 *
 * Root cause it pins: a BI **CSV** whose FILE NAME did not contain one of the
 * configured sheet patterns had its rows thrown away before they were ever
 * parsed, and the file was reported as a red error row. The same bytes packaged
 * as `.xlsx` imported fine — that asymmetry is the bug, so the `.xlsx` control
 * is asserted alongside.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import * as XLSX from "xlsx";

import PhaseOneUpload from "./components/PhaseOneUpload";
import { usePhaseOneUploads } from "./usePhaseOneUploads";
import { processBiWorkbook } from "./biData/biDataWorkbook";
import type { BiUploadEntry } from "./biData/biDataTypes";
import type { BiFileResult } from "../../../../workers/workbookWorkerTypes";

afterEach(cleanup);

const HEADERS = "معرف الأشعة,اسم المنفذ";

function csvFile(name: string, ids: string[]): File {
  const csv = [HEADERS, ...ids.map((id) => `${id},ميناء جدة الإسلامي`)].join("\n");
  return new File([csv], name, { type: "text/csv" });
}

function xlsxFile(name: string, ids: string[]): File {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["معرف الأشعة", "اسم المنفذ"],
    ...ids.map((id) => [id, "ميناء جدة الإسلامي"])
  ]);
  // "Sheet1" — SheetJS's default, and no configured pattern matches it.
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new File([buf], name, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
}

function newController() {
  return renderHook(() =>
    usePhaseOneUploads({
      canUploadNow: true,
      setUploadError: vi.fn(),
      setProcessingMessage: vi.fn(),
      setBiWorkbookResult: vi.fn(),
      setRiskWorkbookResult: vi.fn(),
      onAttachedSetChanged: vi.fn()
    })
  );
}

/** Run the real worker body for each attached file, then apply the outcomes. */
async function readAttachedFiles(
  controller: ReturnType<typeof newController>
): Promise<void> {
  const requested: BiUploadEntry[] = controller.result.current.uploads.biUploads;

  // index.tsx flips every attached row to "parsing" up front — the "it starts
  // loading all files" half of the report.
  act(() => {
    controller.result.current.setUploads((current) => ({
      ...current,
      biUploads: current.biUploads.map((entry) => ({
        ...entry,
        state: "parsing" as const,
        acceptedRows: null,
        error: undefined
      }))
    }));
  });

  const outcomes: BiFileResult[] = [];
  for (const entry of requested) {
    outcomes.push({
      fileName: entry.file.name,
      result: await processBiWorkbook(entry.file)
    });
  }

  // ...and the per-file outcomes land in one go when the batch finishes — the
  // "after it finishes, it shows in red" half.
  act(() => {
    controller.result.current.applyBiFileResults(requested, outcomes);
  });
}

function renderList(entries: BiUploadEntry[]) {
  return render(
    <PhaseOneUpload
      uploads={{ riskAgencyData: { file: null, source: null }, biUploads: entries }}
      uploadError=""
      processingMessage=""
      isProcessingWorkbooks={false}
      canUpload
      riskAgencyInputRef={{ current: null }}
      businessIntelligenceInputRef={{ current: null }}
      onPickFile={vi.fn()}
      onClearFile={vi.fn()}
      onRemoveBiUpload={vi.fn()}
      onDropFiles={vi.fn()}
      onFallbackFileChange={vi.fn()}
    />
  );
}

describe("PROD-1 · multi-file BI import goes red after loading all files", () => {
  it("happy: three well-formed BI CSVs whose names match no sheet pattern are IMPORTED, not turned into red rows", async () => {
    const controller = newController();
    act(() => {
      controller.result.current.handleDroppedFiles("businessIntelligenceData", [
        csvFile("BI_Export_2026-05_part1.csv", ["202605090023680130", "202605090023680131"]),
        csvFile("BI_Export_2026-05_part2.csv", ["6186202605020023"]),
        csvFile("BI_Export_2026-05_part3.csv", ["66202605010001"])
      ]);
    });

    await readAttachedFiles(controller);

    const entries = controller.result.current.uploads.biUploads;
    expect(entries).toHaveLength(3);
    expect(entries.filter((entry) => entry.state === "error")).toHaveLength(0);
    expect(entries.map((entry) => entry.acceptedRows)).toEqual([2, 1, 1]);

    const { container } = renderList(entries);
    // No red sub-line anywhere in the list, and the derived footer totals 4.
    expect(container.querySelectorAll(".bi-file-sheet.is-error")).toHaveLength(0);
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
    expect(screen.getByText("4")).toBeTruthy();
  });

  it("happy: an unmatched name still carries a non-blocking advisory naming the file the source was taken from", async () => {
    const controller = newController();
    act(() => {
      controller.result.current.handleDroppedFiles("businessIntelligenceData", [
        csvFile("BI_Export_2026-05_part1.csv", ["202605090023680130"])
      ]);
    });

    await readAttachedFiles(controller);

    const entry = controller.result.current.uploads.biUploads[0]!;
    expect(entry.state).toBe("ready");
    expect(entry.error).toBeUndefined();
    expect(entry.warning).toContain("BI_Export_2026-05_part1");

    const { container } = renderList([entry]);
    expect(container.querySelectorAll(".bi-file-sheet.is-warn")).toHaveLength(1);
    expect(container.querySelectorAll(".bi-file-sheet.is-error")).toHaveLength(0);
  });

  it("control: the SAME data as .xlsx with an unmatched sheet name behaves identically — the CSV/XLSX asymmetry is the regression", async () => {
    const csv = newController();
    act(() => {
      csv.result.current.handleDroppedFiles("businessIntelligenceData", [
        csvFile("BI_Export_2026-05.csv", ["202605090023680130", "202605090023680131"])
      ]);
    });
    await readAttachedFiles(csv);

    const excel = newController();
    act(() => {
      excel.result.current.handleDroppedFiles("businessIntelligenceData", [
        xlsxFile("BI_Export_2026-05.xlsx", ["202605090023680130", "202605090023680131"])
      ]);
    });
    await readAttachedFiles(excel);

    const csvEntry = csv.result.current.uploads.biUploads[0]!;
    const excelEntry = excel.result.current.uploads.biUploads[0]!;
    expect(csvEntry.state).toBe(excelEntry.state);
    expect(csvEntry.acceptedRows).toBe(excelEntry.acceptedRows);
    expect(csvEntry.acceptedRows).toBe(2);
  });

  it("mixed: a correctly named CSV and two unmatched ones ALL import — 'doesn't read all files attached'", async () => {
    const controller = newController();
    act(() => {
      controller.result.current.handleDroppedFiles("businessIntelligenceData", [
        csvFile("بحري وارد.csv", ["30B9202605010002"]),
        csvFile("BI_part2.csv", ["6186202605020023"]),
        csvFile("BI_part3.csv", ["66202605010001", "66202605010002"])
      ]);
    });

    await readAttachedFiles(controller);

    const entries = controller.result.current.uploads.biUploads;
    expect(entries.map((entry) => entry.acceptedRows)).toEqual([1, 1, 2]);
    expect(entries.every((entry) => entry.state === "ready")).toBe(true);
    // The matched file carries no advisory; the two unmatched ones do.
    expect(entries.map((entry) => entry.warning === undefined)).toEqual([true, false, false]);
  });

  it("failure: a file that really yields nothing at all is still a red error row", async () => {
    const controller = newController();
    act(() => {
      controller.result.current.handleDroppedFiles("businessIntelligenceData", [
        // Header row only — zero source rows, zero accepted rows.
        new File([HEADERS], "BI_empty.csv", { type: "text/csv" })
      ]);
    });

    await readAttachedFiles(controller);

    const entry = controller.result.current.uploads.biUploads[0]!;
    expect(entry.state).toBe("error");

    renderList([entry]);
    expect(screen.getByRole("alert")).toBeTruthy();
  });
});
