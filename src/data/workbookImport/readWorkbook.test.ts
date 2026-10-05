import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { readComprehensiveWorkbook } from "./readWorkbook";

const H = ["الربع","الشهر","المستوى","معرف الأشعة","نتيجة المستوى الأول","نتيجة المستوى الثاني","صحة النتيجة","الاكتمال"];
function wbBlob(sheets: Record<string, string[][]>): Blob {
  const wb = XLSX.utils.book_new();
  for (const [n, aoa] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), n);
  return new Blob([XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer]);
}
describe("readComprehensiveWorkbook", () => {
  it("reads only *_Sample sheets, completed rows", async () => {
    const f = wbBlob({
      Q1_Sample: [H, ["Q1","46023","FIRST_STAGE","A1","سليمة","اشتباه","اشتباه","مكتمل"], ["Q1","46023","FIRST_STAGE","A2","سليمة","سليمة","سليمة",""]],
      Q2_Pop: [["x"], ["y"]],
    });
    const { rows, report } = await readComprehensiveWorkbook(f);
    expect(rows.map((r) => r.row.xrayImageId)).toEqual(["A1"]);
    expect(report.sheetsRead.map((s) => s.name)).toEqual(["Q1_Sample"]);
    expect(report.incomplete).toBe(1);
  });
  it("errors when no sample sheet", async () => {
    await expect(readComprehensiveWorkbook(wbBlob({ Q1_Pop: [["x"]] }))).rejects.toThrow("XQ-WB-NOSAMPLE");
  });
  it("errors when a required column is missing", async () => {
    await expect(readComprehensiveWorkbook(wbBlob({ Q1_Sample: [["معرف الأشعة"], ["A"]] }))).rejects.toThrow("XQ-WB-COLUMNS");
  });
});
