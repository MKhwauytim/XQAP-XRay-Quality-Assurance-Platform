// Owner-reported bug (2026-08-12): the real BI.xlsx parses 246,627 rows and accepts 0 — every
// row excluded as "مستبعدة (بلا معرف أشعة)" on all four sheets. This suite exercises the real
// end-to-end `processBiWorkbook` path (real in-memory .xlsx via the vendored xlsx package, not a
// mocked reader) with the exact sheet names/headers/sample values gathered by reading the
// owner's actual workbook (fixtures only — the real file is never read from disk in a test).
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  deriveSheetNameFromFileName,
  mergeBiWorkbookResults,
  processBiWorkbook
} from "./biDataWorkbook";
import type { BiWorkbookResult, NormalizedBiRow } from "./biDataTypes";

/** Build a real .xlsx File (single sheet) in memory — exactly what the import worker parses. */
function buildBiWorkbookFile(sheets: { sheetName: string; header: string; values: string[] }[]): File {
  const wb = XLSX.utils.book_new();
  for (const { sheetName, header, values } of sheets) {
    const ws = XLSX.utils.aoa_to_sheet([[header], ...values.map((v) => [v])]);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new File([buf], "bi.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

describe("processBiWorkbook · owner-reported 0-accepted bug (2026-08-12)", () => {
  const realSheets = [
    { sheetName: "بري صادر", header: "معرف الأشعة", values: ["202605090023680130", "202605090023680131"] },
    { sheetName: "بحري صادر", header: "XRAY_SCAN_ID", values: ["6186202605020023"] },
    { sheetName: "بري وارد", header: "معرف الأشعة", values: ["66202605010001"] },
    { sheetName: "بحري وارد", header: "رقم صورة الأشعة", values: ["30B9202605010002"] },
  ];

  it("accepts rows from all four real sheets using the DEFAULT alias table (proves the defaults are not the gap)", async () => {
    const file = buildBiWorkbookFile(realSheets);

    const result = await processBiWorkbook(file);

    expect(result.totalOriginalRows).toBe(5);
    expect(result.totalExcludedMissingXrayIdCount).toBe(0);
    expect(result.totalNormalizedRows).toBe(5);
    for (const sheet of result.sheetSummaries) {
      expect(sheet.excludedMissingXrayIdCount).toBe(0);
      expect(sheet.zeroIdDiagnostic).toBeUndefined();
    }
  });

  it("surfaces the zero-accepted diagnostic (candidate vs present headers) when a sheet's xrayImageId column is not among the configured aliases — the saved-bad-mapping scenario", async () => {
    // Simulates a saved custom columnMappings whose xrayImageId alias list points at a header
    // that does not exist in this sheet (e.g. a stale/incomplete mapping template) — the exact
    // "override discards accepted rows silently" scenario flagged as a strong candidate cause.
    const file = buildBiWorkbookFile([
      { sheetName: "بري صادر", header: "معرف الأشعة", values: ["202605090023680130"] },
    ]);

    const result = await processBiWorkbook(file, undefined, undefined, {
      xrayImageId: ["عمود غير موجود"],
    });

    expect(result.totalNormalizedRows).toBe(0);
    expect(result.totalExcludedMissingXrayIdCount).toBe(1);
    const sheet = result.sheetSummaries[0];
    expect(sheet).toBeDefined();
    expect(sheet!.originalRowCount).toBe(1);
    expect(sheet!.normalizedRowCount).toBe(0);
    expect(sheet!.zeroIdDiagnostic).toEqual({
      candidateHeaders: ["عمود غير موجود"],
      presentHeaders: ["معرف الأشعة"],
    });
  });

  it("does not attach a diagnostic when a sheet legitimately has zero source rows", async () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([["معرف الأشعة"]]);
    XLSX.utils.book_append_sheet(wb, ws, "بري صادر");
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const file = new File([buf], "bi-empty.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    const result = await processBiWorkbook(file);

    const sheet = result.sheetSummaries[0];
    expect(sheet).toBeDefined();
    expect(sheet!.originalRowCount).toBe(0);
    expect(sheet!.zeroIdDiagnostic).toBeUndefined();
  });
});

/** Build a real .csv File in memory — SheetJS parses it through the same XLSX.read path. */
function buildBiCsvFile(fileName: string, header: string, values: string[]): File {
  const csv = [header, ...values].join("\n");
  return new File([csv], fileName, { type: "text/csv" });
}

function biRow(xrayImageId: string, source: string): NormalizedBiRow {
  return {
    source,
    xrayImageId,
    sourceSheetName: source,
    sourceRowNumber: 1
  } as unknown as NormalizedBiRow;
}

function biResult(overrides: Partial<BiWorkbookResult> = {}): BiWorkbookResult {
  return {
    rows: [],
    sheetSummaries: [],
    unknownSheetNames: [],
    unmatchedSheetNames: [],
    totalOriginalRows: 0,
    totalNormalizedRows: 0,
    totalExcludedMissingXrayIdCount: 0,
    ...overrides
  };
}

describe("mergeBiWorkbookResults · APPEND semantics (multi-file BI, 2026-08 handoff)", () => {
  it("appends rows and keeps BOTH rows when two files share an xrayImageId — no dedupe, no rejection", () => {
    const a = biResult({
      rows: [biRow("SHARED-1", "بحري وارد"), biRow("A-2", "بحري وارد")],
      sheetSummaries: [
        { sheetName: "بحري وارد", source: "بحري وارد", originalRowCount: 2, normalizedRowCount: 2, excludedMissingXrayIdCount: 0 }
      ],
      totalOriginalRows: 2,
      totalNormalizedRows: 2
    });
    const b = biResult({
      // SHARED-1 again: a different population that happens to overlap.
      rows: [biRow("SHARED-1", "بحري وارد"), biRow("B-2", "بحري وارد")],
      sheetSummaries: [
        { sheetName: "بحري وارد", source: "بحري وارد", originalRowCount: 3, normalizedRowCount: 2, excludedMissingXrayIdCount: 1 }
      ],
      totalOriginalRows: 3,
      totalNormalizedRows: 2,
      totalExcludedMissingXrayIdCount: 1
    });

    const merged = mergeBiWorkbookResults([a, b], ["a.xlsx", "b.xlsx"]);

    expect(merged.rows).toHaveLength(4);
    expect(merged.rows.filter((row) => row.xrayImageId === "SHARED-1")).toHaveLength(2);
    expect(merged.totalOriginalRows).toBe(5);
    expect(merged.totalNormalizedRows).toBe(4);
    expect(merged.totalExcludedMissingXrayIdCount).toBe(1);
  });

  it("stamps the source file name onto each sheet summary so identical sheet names stay distinguishable", () => {
    const sheet = { sheetName: "بحري وارد", source: "بحري وارد", originalRowCount: 1, normalizedRowCount: 1, excludedMissingXrayIdCount: 0 };
    const merged = mergeBiWorkbookResults(
      [biResult({ sheetSummaries: [sheet] }), biResult({ sheetSummaries: [sheet] })],
      ["a.xlsx", "b.xlsx"]
    );

    expect(merged.sheetSummaries).toHaveLength(2);
    expect(merged.sheetSummaries.map((s) => s.sourceFileName)).toEqual(["a.xlsx", "b.xlsx"]);
    expect(merged.sheetSummaries.every((s) => s.sheetName === "بحري وارد")).toBe(true);
  });

  it("unions unknown sheet names instead of repeating them", () => {
    const merged = mergeBiWorkbookResults(
      [
        biResult({ unknownSheetNames: ["ورقة غريبة"] }),
        biResult({ unknownSheetNames: ["ورقة غريبة", "أخرى"] })
      ],
      ["a.xlsx", "b.xlsx"]
    );

    expect(merged.unknownSheetNames).toEqual(["ورقة غريبة", "أخرى"]);
  });

  it("returns an empty result for an empty input list", () => {
    const merged = mergeBiWorkbookResults([], []);
    expect(merged.rows).toHaveLength(0);
    expect(merged.totalNormalizedRows).toBe(0);
  });
});

describe("CSV support · sheet name derived from the file name", () => {
  it("derives the base name, dropping directories and the extension", () => {
    expect(deriveSheetNameFromFileName("بحري وارد.csv")).toBe("بحري وارد");
    expect(deriveSheetNameFromFileName("C:\\data\\بري صادر.CSV")).toBe("بري صادر");
    expect(deriveSheetNameFromFileName("uploads/بري وارد.csv")).toBe("بري وارد");
    expect(deriveSheetNameFromFileName("bi.2026-08.xlsx")).toBe("bi.2026-08");
  });

  it("happy: a CSV named after a configured sheet classifies exactly like the same-named sheet in an .xlsx", async () => {
    const file = buildBiCsvFile("بحري وارد.csv", "معرف الأشعة", ["30B9202605010002", "30B9202605010003"]);

    const result = await processBiWorkbook(file);

    expect(result.unknownSheetNames).toEqual([]);
    expect(result.totalOriginalRows).toBe(2);
    expect(result.totalNormalizedRows).toBe(2);
    expect(result.sheetSummaries[0]!.sheetName).toBe("بحري وارد");
    expect(result.sheetSummaries[0]!.source).toBe("بحري وارد");
    expect(result.rows.every((row) => row.source === "بحري وارد")).toBe(true);
  });

  // PROD-1 (2026-08-19) — this test used to pin the OPPOSITE contract: an
  // unmatched CSV name discarded the file's rows and reported it as unknown, so
  // usePhaseOneUploads rendered a red error row for a perfectly good file. That
  // rule cost the owner every multi-file BI import whose exporter names files
  // "BI_Export_2026-05_part1.csv". The name is now advisory only.
  it("failure→advisory: a CSV whose derived name matches no configured pattern is IMPORTED under that name and reported in unmatchedSheetNames", async () => {
    const file = buildBiCsvFile("تصدير عشوائي.csv", "معرف الأشعة", ["30B9202605010002"]);

    const result = await processBiWorkbook(file);

    // Not excluded — `unknownSheetNames` keeps meaning "contributed no rows".
    expect(result.unknownSheetNames).toEqual([]);
    expect(result.unmatchedSheetNames).toEqual(["تصدير عشوائي"]);
    expect(result.totalNormalizedRows).toBe(1);
    expect(result.sheetSummaries).toHaveLength(1);
    expect(result.sheetSummaries[0]!.source).toBe("تصدير عشوائي");
    expect(result.sheetSummaries[0]!.sourceMatched).toBe(false);
    expect(result.rows[0]!.source).toBe("تصدير عشوائي");
    // The pair usePhaseOneUploads used to turn into a red error row can no
    // longer arise from a name mismatch alone.
    expect(result.totalNormalizedRows === 0 && result.unknownSheetNames.length > 0).toBe(false);
  });

  it("control: the SAME data as .xlsx with an unrecognized sheet name imports identically — CSV and XLSX must not diverge", async () => {
    const csv = await processBiWorkbook(
      buildBiCsvFile("ورقة غريبة.csv", "معرف الأشعة", ["30B9202605010002"])
    );
    const excel = await processBiWorkbook(
      buildBiWorkbookFile([
        { sheetName: "ورقة غريبة", header: "معرف الأشعة", values: ["30B9202605010002"] }
      ])
    );

    for (const result of [csv, excel]) {
      expect(result.unknownSheetNames).toEqual([]);
      expect(result.unmatchedSheetNames).toEqual(["ورقة غريبة"]);
      expect(result.totalNormalizedRows).toBe(1);
      expect(result.sheetSummaries[0]!.source).toBe("ورقة غريبة");
    }
  });

  it("happy: a matched name reports no advisory at all", async () => {
    const result = await processBiWorkbook(
      buildBiCsvFile("بحري وارد.csv", "معرف الأشعة", ["30B9202605010002"])
    );

    expect(result.unmatchedSheetNames).toEqual([]);
    expect(result.sheetSummaries[0]!.sourceMatched).toBe(true);
  });
});

describe("mergeBiWorkbookResults · unmatchedSheetNames stays separate from unknownSheetNames", () => {
  it("unions the advisory list without folding it into the exclusion list", () => {
    const merged = mergeBiWorkbookResults(
      [
        biResult({ unmatchedSheetNames: ["BI_part1"], unknownSheetNames: [] }),
        biResult({ unmatchedSheetNames: ["BI_part1", "BI_part2"], unknownSheetNames: ["فارغة"] })
      ],
      ["a.csv", "b.csv"]
    );

    expect(merged.unmatchedSheetNames).toEqual(["BI_part1", "BI_part2"]);
    expect(merged.unknownSheetNames).toEqual(["فارغة"]);
  });
});
