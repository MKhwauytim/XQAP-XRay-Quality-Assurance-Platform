import { describe, expect, it } from "vitest";
import { buildExecutiveReportRows, deriveRowAccuracy } from "./executiveReportData";
import { DEFAULT_EXEC_CONFIG } from "./executiveReportTypes";

describe("rowsOverride", () => {
  it("returns override rows verbatim", () => {
    const rows = [{ xrayImageId: "X1" }] as never;
    const out = buildExecutiveReportRows({
      monthFolderName: "all", populationRows: [], sample: null, distribution: null,
      employeeFiles: [], template: null, config: DEFAULT_EXEC_CONFIG, rowsOverride: rows,
    });
    expect(out).toBe(rows);
  });
  it("blanks hasMarking on images without اشتباه at either level, keeps it on suspicious ones", () => {
    const rows = [
      { xrayImageId: "A", imageResult: "سليمة", hasMarking: false },
      { xrayImageId: "B", imageResult: "اشتباه", hasMarking: false },
      { xrayImageId: "C", imageResult: "اشتباه", hasMarking: true },
    ] as never;
    const out = buildExecutiveReportRows({
      monthFolderName: "all", populationRows: [], sample: null, distribution: null,
      employeeFiles: [], template: null, config: DEFAULT_EXEC_CONFIG, rowsOverride: rows,
    });
    expect(out.map((r) => r.hasMarking)).toEqual([null, false, true]);
  });
  it("canonicalizes variant port spellings across rows", () => {
    const rows = [
      { xrayImageId: "A", imageResult: "اشتباه", hasMarking: null, portName: "الودعيه" },
      { xrayImageId: "B", imageResult: "اشتباه", hasMarking: null, portName: "الوديعة" },
    ] as never;
    const out = buildExecutiveReportRows({
      monthFolderName: "all", populationRows: [], sample: null, distribution: null,
      employeeFiles: [], template: null, config: DEFAULT_EXEC_CONFIG, rowsOverride: rows,
    });
    expect(out.map((r) => r.portName)).toEqual(["الوديعة", "الوديعة"]);
  });
  it("deriveRowAccuracy matches the §9 truth table", () => {
    const a = deriveRowAccuracy("اشتباه", "سليمة", "اشتباه", "اشتباه");
    expect(a.levelOneAccurate).toBe(true);
    expect(a.levelTwoAccurate).toBe(false);
    expect(a.verificationCategory).toBe("correct-suspicious");
    expect(deriveRowAccuracy("سليمة", "سليمة", "سليمة", null).verificationCategory).toBeNull();
  });
});
