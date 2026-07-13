// Data-correctness tests for the management workbook (Wave 3). Builds the pure
// workbook object and asserts the lineage sheets exist and carry the model's
// headline numbers.

import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import { buildManagementWorkbookObject } from "./managementWorkbook";
import { makeRow } from "../reportTestFixtures";
import { DEFAULT_EXEC_CONFIG } from "../executiveReportTypes";
import type { ExecutiveReportInput } from "../executiveReportTypes";

function input(): ExecutiveReportInput {
  return {
    monthFolderName: "6-June-2026",
    populationRows: [
      makeRow("IMG-1", "منفذ أ", { certScanStatus: "Certscan" }),
      makeRow("IMG-2", "منفذ ب", { xrayLevelOneResult: "سليمة", xrayLevelTwoResult: "سليمة" }),
    ],
    sample: null,
    distribution: null,
    employeeFiles: [],
    template: null,
    config: DEFAULT_EXEC_CONFIG,
  };
}

/** Read a sheet as an array-of-arrays for direct cell assertions. */
function aoa(wb: XLSX.WorkBook, name: string): unknown[][] {
  return XLSX.utils.sheet_to_json(wb.Sheets[name]!, { header: 1, blankrows: true }) as unknown[][];
}

describe("buildManagementWorkbookObject", () => {
  it("emits the five lineage sheets", () => {
    const wb = buildManagementWorkbookObject(input());
    expect(wb.SheetNames).toEqual([
      "الملخص الإداري",
      "المجتمع-العينة-المدروس",
      "الأداء حسب المنفذ",
      "أداء المراجعين",
      "الحالة والإجراءات",
    ]);
  });

  it("summary sheet carries the population total", () => {
    const wb = buildManagementWorkbookObject(input());
    const rows = aoa(wb, "الملخص الإداري");
    const popRow = rows.find((r) => r[0] === "إجمالي المجتمع");
    expect(popRow).toBeDefined();
    expect(popRow![1]).toBe(2);
  });

  it("funnel sheet has a per-stage header and a totals row", () => {
    const wb = buildManagementWorkbookObject(input());
    const rows = aoa(wb, "المجتمع-العينة-المدروس");
    expect(rows[0]).toEqual(["المستوى", "المجتمع", "العينة", "التغطية٪", "المدروسة", "الإنجاز٪"]);
    expect(rows.some((r) => r[0] === "الإجمالي")).toBe(true);
  });
});
