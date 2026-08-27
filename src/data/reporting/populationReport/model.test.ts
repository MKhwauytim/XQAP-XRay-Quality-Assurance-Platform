import { describe, it, expect } from "vitest";
import { computePopulationReportModel } from "./model";
import {
  makeRow,
  makeManifest,
  makeSampleMaster,
  makeDistribution,
  makeProcessingSummary,
} from "../reportTestFixtures";

describe("computePopulationReportModel", () => {
  it("folds population rows, live sample rows, and distribution entries into the report model", () => {
    const populationRows = [
      makeRow("1", "منفذ أ", { stage: "المستوى الأول", xrayLevelOneResult: "سليمة" }),
      makeRow("2", "منفذ أ", { stage: "المستوى الأول", xrayLevelOneResult: "اشتباه" }),
    ];
    const sample = makeSampleMaster([populationRows[0]]);
    const distribution = makeDistribution([
      { id: "1", assignedTo: "user1", status: "pending", row: { ...populationRows[0] } },
    ]);
    const model = computePopulationReportModel({
      monthFolderName: "8-August-2026",
      manifest: makeManifest(),
      processingSummary: makeProcessingSummary(),
      riskRawRowCount: 10,
      biRawRowCount: 8,
      populationRows,
      sampleRows: sample.rows,
      distributionEntries: distribution.entries,
      employeeDisplayNames: { user1: "أحمد" },
    });

    expect(model.monthFolderName).toBe("8-August-2026");
    expect(model.reconciled.byStage[0].counts.total).toBe(2);
    expect(model.reconciled.totals.total).toBe(2);
    expect(model.sample.totals.total).toBe(1);
    expect(model.distribution.byEmployeeStage[0].displayName).toBe("أحمد");
    expect(model.distribution.certScanByEmployee).toHaveLength(1);
  });

  it("carries riskRawRowCount and a null biRawRowCount through when BI wasn't provided", () => {
    const model = computePopulationReportModel({
      monthFolderName: "8-August-2026",
      manifest: null,
      processingSummary: null,
      riskRawRowCount: 5,
      biRawRowCount: null,
      populationRows: [],
      sampleRows: [],
      distributionEntries: [],
      employeeDisplayNames: {},
    });
    expect(model.reconciled.riskRawRowCount).toBe(5);
    expect(model.reconciled.biRawRowCount).toBeNull();
    expect(model.reconciled.totals).toEqual({ سليمة: 0, اشتباه: 0, total: 0 });
  });
});
