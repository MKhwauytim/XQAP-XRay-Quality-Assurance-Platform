// duplicate-normalized-headers (Batch 4): detection-only diagnostic, computed
// ONCE per sheet from the header row and threaded onto the sheet summary.
// Precedence in createHeaderLookup (last Map.set wins) is unchanged — mirrors
// the equivalent coverage in biDataWorkbook.test.ts.
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { processRiskWorkbook } from "./riskDataWorkbook";

function buildRiskWorkbookFile(rows: string[][]): File {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "بري");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new File([buf], "risk-dup.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

describe("processRiskWorkbook · duplicate-normalizing header diagnostic (Batch 4)", () => {
  it("attaches duplicateHeaders to the sheet summary when two source headers normalize to the same key", async () => {
    const fatha = String.fromCodePoint(0x064b);
    const file = buildRiskWorkbookFile([
      ["معرف الأشعة", "اسم المنفذ", "اسم" + fatha + " المنفذ"],
      ["X-1", "الميناء الأول", "الميناء الثاني"]
    ]);

    const result = await processRiskWorkbook(file);

    const sheet = result.sheetSummaries[0];
    expect(sheet).toBeDefined();
    expect(sheet!.duplicateHeaders).toEqual([
      { normalized: "اسم المنفذ", originals: ["اسم المنفذ", "اسم" + fatha + " المنفذ"] }
    ]);
    // Precedence is untouched: portName still reads whichever header
    // createHeaderLookup's Map.set applied last.
    expect(result.rows[0]!.portName).toBe("الميناء الثاني");
  });

  it("does not attach duplicateHeaders when no source headers in the sheet collide", async () => {
    const file = buildRiskWorkbookFile([
      ["معرف الأشعة", "اسم المنفذ"],
      ["X-1", "ميناء جدة"]
    ]);

    const result = await processRiskWorkbook(file);

    expect(result.sheetSummaries[0]!.duplicateHeaders).toBeUndefined();
  });

  it("does not attach a diagnostic when the sheet has zero source rows", async () => {
    const file = buildRiskWorkbookFile([["معرف الأشعة"]]);

    const result = await processRiskWorkbook(file);

    expect(result.sheetSummaries[0]!.duplicateHeaders).toBeUndefined();
  });
});
