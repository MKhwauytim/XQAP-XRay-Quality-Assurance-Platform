import { describe, expect, it } from "vitest";
import { buildComprehensiveInput, COMPREHENSIVE_MONTH_LABEL, mergeCompletedRows } from "./mergeWithSystem";
import { makeRow } from "../reporting/reportTestFixtures";
import type { ExecutiveReportInput, ExecutiveReportRow } from "../reporting/executiveReportTypes";

// makeRow builds a PreparedPopulationRow; the executive-row fields the merge
// reads (selectedInSample / answerStatus / imageAvailable) are layered on top.
const sys = (id: string, studied = true): ExecutiveReportRow =>
  ({
    ...makeRow(id, "P"),
    selectedInSample: true,
    answerStatus: studied ? "submitted" : "draft",
    imageAvailable: true,
  }) as unknown as ExecutiveReportRow;
const wb = (id: string, month: string) => ({ row: sys(id), month, sheet: "Q1_Sample" });

describe("mergeCompletedRows", () => {
  it("system wins on same id+month; keeps same id in another month", () => {
    const { rows, stats } = mergeCompletedRows(
      [{ month: "1-january-2026", rows: [sys("A")] }],
      [wb("A", "1-january-2026"), wb("A", "2-february-2026"), wb("B", "1-january-2026")],
    );
    expect(stats.duplicatesSkipped).toBe(1);
    expect(stats.workbookAdded).toBe(2);
    expect(rows).toHaveLength(3);
  });
  it("never collapses an id repeated across months; first keeps the plain id", () => {
    const { rows } = mergeCompletedRows([], [wb("A", "1-january-2026"), wb("A", "2-february-2026")]);
    expect(new Set(rows.map((r) => r.xrayImageId)).size).toBe(2);
    expect(rows[0].xrayImageId).toBe("A");
    expect(rows[1].xrayImageId).toBe("A@2-february-2026");
  });
  it("drops non-completed system rows", () => {
    const { rows } = mergeCompletedRows([{ month: "1-january-2026", rows: [sys("A", false)] }], []);
    expect(rows).toHaveLength(0);
  });
  it("drops system rows not selected in the sample", () => {
    const notSelected = { ...sys("A"), selectedInSample: false } as ExecutiveReportRow;
    const { rows } = mergeCompletedRows([{ month: "m", rows: [notSelected] }], []);
    expect(rows).toHaveLength(0);
  });
  it("reports stats counts", () => {
    const { stats } = mergeCompletedRows(
      [
        { month: "1-january-2026", rows: [sys("A"), sys("X", false)] },
        { month: "2-february-2026", rows: [sys("C")] },
      ],
      [wb("A", "1-january-2026"), wb("D", "3-march-2026")],
    );
    expect(stats).toEqual({ systemMonths: 2, systemCompleted: 2, workbookRead: 2, duplicatesSkipped: 1, workbookAdded: 1 });
  });
  it("does not dedupe within the workbook: same id+month twice is suffixed and kept", () => {
    const { rows } = mergeCompletedRows([], [wb("A", "m"), wb("A", "m")]);
    expect(rows.map((r) => r.xrayImageId)).toEqual(["A", "A@m"]);
  });
});

describe("buildComprehensiveInput", () => {
  it("overrides rows and blanks the per-month sources", () => {
    const base = { monthFolderName: "x", populationRows: [{}], sample: {}, distribution: {}, employeeFiles: [{}], config: { c: 1 }, template: null, stageMappings: [] } as unknown as ExecutiveReportInput;
    const rows = [sys("A")];
    const out = buildComprehensiveInput(rows, base);
    expect(out.monthFolderName).toBe(COMPREHENSIVE_MONTH_LABEL);
    expect(out.rowsOverride).toBe(rows);
    expect(out.populationRows).toEqual([]);
    expect(out.sample).toBeNull();
    expect(out.distribution).toBeNull();
    expect(out.employeeFiles).toEqual([]);
    expect(out.config).toBe(base.config);
  });
});
