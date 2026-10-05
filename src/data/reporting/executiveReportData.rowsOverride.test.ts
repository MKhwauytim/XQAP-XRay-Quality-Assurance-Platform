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
  it("deriveRowAccuracy matches the §9 truth table", () => {
    const a = deriveRowAccuracy("اشتباه", "سليمة", "اشتباه", "اشتباه");
    expect(a.levelOneAccurate).toBe(true);
    expect(a.levelTwoAccurate).toBe(false);
    expect(a.verificationCategory).toBe("correct-suspicious");
    expect(deriveRowAccuracy("سليمة", "سليمة", "سليمة", null).verificationCategory).toBeNull();
  });
});
