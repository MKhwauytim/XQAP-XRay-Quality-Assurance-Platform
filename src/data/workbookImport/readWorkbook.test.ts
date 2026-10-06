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

  describe("examined-sample layout (SJAN..SDEC, no الاكتمال column)", () => {
    const HA = ["المستوى","رقم صورة الاشعة","نوع المنفذ","اسم المنفذ","نتيجة المستوى الأول للاشعة","نتيجة المستوى الثاني للاشعة","تاريخ رصد الخبير","صحة النتيجة","شهر الفحص"];
    const HJ = ["المستوى","رقم صورة الاشعة","نتيجة المستوى الاول","نتيجة المستوى الثاني","تاريخ رصد الخبير","صحة النتيجة","شهر الفحص"];
    it("reads S<MON> sheets: aliased headers, every row counts as completed, year from expert date", async () => {
      const f = wbBlob({
        SJAN: [HA, ["FIRST_STAGE","X1","منفذ بحري","ميناء","اشتباه","سليمة","46042","سليمة","1"]],
        SJUN: [HJ, ["SECOND_STAG","X2","سليمه","اشتباه","46180","اشتباه","6"], ["SECOND_STAG","X3","سليمة","0","46180","سليمة","6"]],
        JAN: [["x"], ["y"]],
      });
      const { rows, report } = await readComprehensiveWorkbook(f);
      expect(rows.map((r) => [r.row.xrayImageId, r.month])).toEqual([["X1","1-january-2026"],["X2","6-june-2026"]]);
      expect(rows[1].row.levelOneResult).toBe("سليمة");
      expect(report.sheetsRead.map((s) => s.name)).toEqual(["SJAN","SJUN"]);
      expect(report.incomplete).toBe(0);
      expect(report.skippedBadResult).toBe(1);
    });
    it("skips a row whose exam month has no derivable year", async () => {
      const f = wbBlob({ SJAN: [HA, ["FIRST_STAGE","X1","منفذ بحري","ميناء","اشتباه","سليمة","","سليمة","1"]] });
      const { rows, report } = await readComprehensiveWorkbook(f);
      expect(rows).toHaveLength(0);
      expect(report.skippedNoMonth).toBe(1);
    });
  });
});
