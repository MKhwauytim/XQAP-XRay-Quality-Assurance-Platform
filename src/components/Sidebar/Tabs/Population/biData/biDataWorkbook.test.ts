// Owner-reported bug (2026-08-12): the real BI.xlsx parses 246,627 rows and accepts 0 — every
// row excluded as "مستبعدة (بلا معرف أشعة)" on all four sheets. This suite exercises the real
// end-to-end `processBiWorkbook` path (real in-memory .xlsx via the vendored xlsx package, not a
// mocked reader) with the exact sheet names/headers/sample values gathered by reading the
// owner's actual workbook (fixtures only — the real file is never read from disk in a test).
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { processBiWorkbook } from "./biDataWorkbook";

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
