// Data-correctness tests for the management workbook (R3 restructure). Builds
// the pure workbook object and asserts the section-1/section-2 sheets carry
// the progress model's per-employee numbers, and that replacement reasons
// survive into the workbook.

import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import { buildManagementWorkbookObject } from "./managementWorkbook";
import { makeRow, makeDistribution } from "../reportTestFixtures";
import { DEFAULT_EXEC_CONFIG } from "../executiveReportTypes";
import type { ExecutiveReportInput } from "../executiveReportTypes";

function input(overrides: Partial<ExecutiveReportInput> = {}): ExecutiveReportInput {
  return {
    monthFolderName: "6-June-2026",
    populationRows: [],
    sample: null,
    distribution: makeDistribution([
      { id: "IMG-1", assignedTo: "u1", status: "completed", row: makeRow("IMG-1", "منفذ أ", { stage: "المستوى الأول" }) },
      { id: "IMG-2", assignedTo: "u1", status: "pending", row: makeRow("IMG-2", "منفذ أ", { stage: "المستوى الأول" }) },
      { id: "IMG-3", assignedTo: "u2", status: "replaced", row: makeRow("IMG-3", "منفذ ب", { stage: "المستوى الثاني" }), replacedById: "IMG-9" },
    ], { totalAssigned: 3, totalCompleted: 1, totalPending: 1, totalReplaced: 1 }),
    employeeFiles: [],
    template: null,
    config: DEFAULT_EXEC_CONFIG,
    replacementReasons: { "IMG-3": "صورة غير واضحة" },
    ...overrides,
  };
}

/** Read a sheet as an array-of-arrays for direct cell assertions. */
function aoa(wb: XLSX.WorkBook, name: string): unknown[][] {
  return XLSX.utils.sheet_to_json(wb.Sheets[name]!, { header: 1, blankrows: true }) as unknown[][];
}

describe("buildManagementWorkbookObject", () => {
  it("emits the section-1/section-2 sheets plus summary and replacements", () => {
    const wb = buildManagementWorkbookObject(input(), { u1: "أحمد", u2: "سارة" });
    expect(wb.SheetNames).toEqual([
      "الملخص الإداري",
      "1 · حسب المستوى",
      "2 · حسب المنفذ",
      "الاستبدال وإعادة التعيين",
    ]);
  });

  it("summary sheet carries the headline totals", () => {
    const wb = buildManagementWorkbookObject(input());
    const rows = aoa(wb, "الملخص الإداري");
    const assignedRow = rows.find((r) => r[0] === "إجمالي المعيّنة");
    expect(assignedRow![1]).toBe(3);
    const completionRow = rows.find((r) => r[0] === "نسبة الإنجاز٪");
    expect(completionRow![1]).toBeCloseTo(33.33, 1);
  });

  it("section-1 (per stage) sheet lists employees per level with a per-bucket total row", () => {
    const wb = buildManagementWorkbookObject(input(), { u1: "أحمد" });
    const rows = aoa(wb, "1 · حسب المستوى");
    expect(rows[0]).toEqual(["المستوى", "الموظف", "المعيّنة", "المكتملة", "الإنجاز٪"]);
    expect(rows.some((r) => r[0] === "المستوى الأول" && r[1] === "أحمد" && r[2] === 2)).toBe(true);
  });

  it("replacement sheet carries the resolved reason", () => {
    const wb = buildManagementWorkbookObject(input(), { u2: "سارة" });
    const rows = aoa(wb, "الاستبدال وإعادة التعيين");
    const replRow = rows.find((r) => r[0] === "IMG-3");
    expect(replRow).toEqual(["IMG-3", "سارة", "منفذ ب", "صورة غير واضحة", "IMG-9", "2026-07-05T00:00:00.000Z"]);
  });

  it("handles a null distribution (never processed / never opened yet) without throwing", () => {
    const wb = buildManagementWorkbookObject(input({ distribution: null }));
    const rows = aoa(wb, "الملخص الإداري");
    expect(rows.find((r) => r[0] === "إجمالي المعيّنة")![1]).toBe(0);
  });
});
