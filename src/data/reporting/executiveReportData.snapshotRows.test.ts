import { describe, expect, it } from "vitest";

import type { EmployeeAnswerFile } from "../answers/answerTypes";
import { makePopulationRow, makeSampleMaster } from "../population/populationTestFixtures";
import { buildExecutiveReportRows, calculateExecutiveKPIs } from "./executiveReportData";
import { DEFAULT_EXEC_CONFIG, type ExecutiveReportInput } from "./executiveReportTypes";

const MONTH = "5-May-2026";

function answered(xrayImageId: string): EmployeeAnswerFile {
  return {
    username: "emp1",
    monthFolderName: MONTH,
    items: [
      {
        xrayImageId,
        templateId: "tpl",
        templateVersion: 1,
        answers: [{ fieldId: DEFAULT_EXEC_CONFIG.expertResultFieldId, value: "سليمة" }],
        lastSavedAt: "2026-05-02T08:00:00.000Z",
        submittedAt: "2026-05-02T08:00:00.000Z",
        answeredBy: "emp1",
        status: "submitted",
      },
    ],
  };
}

function input(sampleIds: string[], answeredId: string): ExecutiveReportInput {
  return {
    monthFolderName: MONTH,
    populationRows: ["P1", "P2", "P3"].map((id) => makePopulationRow(id)),
    sample: makeSampleMaster(sampleIds.map((id) => makePopulationRow(id))),
    distribution: null,
    employeeFiles: [answered(answeredId)],
    template: null,
    config: DEFAULT_EXEC_CONFIG,
  };
}

describe("buildExecutiveReportRows — deterministic output for a month with no orphans", () => {
  it("matches the pre-change snapshot", () => {
    expect(buildExecutiveReportRows(input(["P1", "P2"], "P1"))).toMatchSnapshot();
  });
});
describe("buildExecutiveReportRows — sampled ids missing from the population (A2)", () => {
  it("emits a flagged row from the sample snapshot, carrying its answer", () => {
    const rows = buildExecutiveReportRows(input(["P1", "S9"], "S9"));

    expect(rows.map((row) => row.xrayImageId)).toEqual(["P1", "P2", "P3", "S9"]);
    const orphan = rows.find((row) => row.xrayImageId === "S9")!;
    expect(orphan.fromSampleSnapshot).toBe(true);
    expect(orphan.selectedInSample).toBe(true);
    expect(orphan.answerStatus).toBe("submitted");
    expect(rows.filter((row) => row.fromSampleSnapshot)).toHaveLength(1);
    expect("fromSampleSnapshot" in rows[0]!).toBe(false);
  });

  it("keeps population-wide KPI denominators unchanged", () => {
    const rows = buildExecutiveReportRows(input(["P1", "S9"], "S9"));
    const sample = makeSampleMaster(["P1", "S9"].map((id) => makePopulationRow(id)));

    const kpis = calculateExecutiveKPIs(rows, sample, DEFAULT_EXEC_CONFIG);

    expect(kpis.totalPopulation).toBe(3);
    expect(kpis.cleanCount).toBe(3);
    expect(kpis.suspiciousCount).toBe(0);
    expect(kpis.studiedImages).toBe(1);
  });
});
