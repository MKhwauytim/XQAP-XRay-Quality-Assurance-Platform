import { describe, expect, it } from "vitest";
import { buildComprehensiveInput, COMPREHENSIVE_MONTH_LABEL, mergeCompletedRows, normalizeMonthKey } from "./mergeWithSystem";
import { formatMonthShortLabel } from "../population/monthFolder";
import { getLabels } from "../labels/labelsStore";
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
  it("treats a capitalised system month and a lowercase workbook month as the same month", () => {
    const { rows, stats } = mergeCompletedRows(
      [{ month: "5-May-2026", rows: [sys("A")] }],
      [wb("A", "5-may-2026"), wb("A", "6-june-2026")],
    );
    expect(stats.duplicatesSkipped).toBe(1);
    expect(rows.map((r) => r.xrayImageId)).toEqual(["A", "A@6-june-2026"]);
  });
  it("normalizeMonthKey folds case and zero-padded numbers", () => {
    expect(normalizeMonthKey("5-May-2026")).toBe("5-may-2026");
    expect(normalizeMonthKey("05-MAY-2026")).toBe("5-may-2026");
    expect(normalizeMonthKey(" Weird ")).toBe("weird");
  });
  it("suffix pass stays deterministic with a capital-letter system month", () => {
    const run = () =>
      mergeCompletedRows([{ month: "5-May-2026", rows: [sys("A")] }], [wb("A", "6-june-2026"), wb("A", "7-july-2026")])
        .rows.map((r) => r.xrayImageId);
    expect(run()).toEqual(["A", "A@6-june-2026", "A@7-july-2026"]);
    expect(run()).toEqual(run());
  });
  it("rejects non-completed workbook rows and counts them", () => {
    const bad = { ...wb("Z", "1-january-2026"), row: sys("Z", false) };
    const { rows, stats } = mergeCompletedRows([], [bad, wb("Y", "1-january-2026")]);
    expect(rows.map((r) => r.xrayImageId)).toEqual(["Y"]);
    expect(stats.workbookNotCompleted).toBe(1);
    expect(stats.workbookAdded).toBe(1);
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
    expect(stats).toEqual({ systemMonths: 2, systemCompleted: 2, workbookRead: 2, duplicatesSkipped: 1, workbookAdded: 1, workbookNotCompleted: 0 });
  });
  it("does not dedupe within the workbook: same id+month twice is suffixed and kept", () => {
    const { rows } = mergeCompletedRows([], [wb("A", "m"), wb("A", "m")]);
    expect(rows.map((r) => r.xrayImageId)).toEqual(["A", "A@m"]);
  });
});

describe("id suffix uniqueness", () => {
  it("A, A@m, A (same month) yields three distinct ids, first plain", () => {
    const { rows } = mergeCompletedRows([], [wb("A", "m"), wb("A@m", "m"), wb("A", "m")]);
    const ids = rows.map((r) => r.xrayImageId);
    expect(new Set(ids).size).toBe(3);
    expect(ids[0]).toBe("A");
    expect(ids[1]).toBe("A@m");
  });
});

describe("buildComprehensiveInput", () => {
  it("does not leak per-month artefacts from base", () => {
    const base = {
      monthFolderName: "x", populationRows: [], sample: null, distribution: null, employeeFiles: [],
      template: { id: "t" }, config: { c: 1 }, stageMappings: { s: 1 },
      processingSummary: { p: 1 }, sourceRevisions: { "a.json": 3 },
      distributionEvents: [{ e: 1 }], replacementReasons: { A: "r" },
    } as unknown as ExecutiveReportInput;
    const out = buildComprehensiveInput([], base);
    expect(out.processingSummary ?? null).toBeNull();
    expect(out.sourceRevisions).toBeUndefined();
    expect(out.distributionEvents).toBeUndefined();
    expect(out.replacementReasons).toBeUndefined();
    expect(out.config).toBe(base.config);
    expect(out.template).toBe(base.template);
    expect(out.stageMappings).toBe(base.stageMappings);
  });
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

describe("study period (earliest to latest month of the completed samples)", () => {
  it("spans system and workbook months, ignoring rows that are not completed", () => {
    const notDone = { row: sys("X", false), month: "12-december-2026", sheet: "Q1_Sample" };
    const { period } = mergeCompletedRows(
      [{ month: "1-January-2026", rows: [sys("A")] }],
      [wb("B", "3-march-2025"), wb("C", "7-july-2025"), notDone],
    );
    expect(period).toEqual({ from: "3-march-2025", to: "1-january-2026" });
  });
  it("is null when there are no completed rows", () => {
    expect(mergeCompletedRows([], []).period).toBeNull();
  });
  it("labels a range as «من … إلى …», a single month as its first-to-last day, and no period as unset", () => {
    const base = { config: {}, template: null } as unknown as ExecutiveReportInput;
    const range = buildComprehensiveInput([], base, { from: "3-march-2025", to: "1-january-2026" });
    expect(range.periodLabel).toBe(
      getLabels().ce_period_range.replace("{from}", `1 ${formatMonthShortLabel(3, 2025)}`).replace("{to}", `31 ${formatMonthShortLabel(1, 2026)}`),
    );
    expect(range.monthFolderName).toBe(COMPREHENSIVE_MONTH_LABEL);
    const single = buildComprehensiveInput([], base, { from: "1-january-2026", to: "1-january-2026" });
    expect(single.periodLabel).toBe(
      getLabels().ce_period_range.replace("{from}", `1 ${formatMonthShortLabel(1, 2026)}`).replace("{to}", `31 ${formatMonthShortLabel(1, 2026)}`),
    );
    expect(buildComprehensiveInput([], base, null).periodLabel).toBeUndefined();
    expect(buildComprehensiveInput([], base).periodLabel).toBeUndefined();
  });
});
