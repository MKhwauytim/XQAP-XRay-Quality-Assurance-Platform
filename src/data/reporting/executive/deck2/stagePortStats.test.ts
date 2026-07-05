// src/data/reporting/executive/deck2/stagePortStats.test.ts
import { describe, expect, it } from "vitest";
import { DEFAULT_EXEC_CONFIG } from "../../executiveReportTypes";
import type { ExecutiveReportInput } from "../../executiveReportTypes";
import type { PreparedPopulationRow } from "../../../population/populationTypes";
import { buildReportModel } from "../model/reportModel";
import { collectStagePortStats } from "./slides";

function popRow(overrides: Partial<PreparedPopulationRow> = {}): PreparedPopulationRow {
  return {
    stage: "المستوى الأول",
    xrayImageId: "XR-1",
    xrayEntryDate: null,
    portCode: "P1",
    portType: "منفذ بري",
    portName: "منفذ الاختبار",
    declarationNumber: null,
    declarationDate: null,
    plateOrContainerNumber: null,
    chassisNumber: null,
    xrayLevelOneResult: "سليمة",
    xrayLevelTwoResult: "سليمة",
    movementType: "بري",
    reportNumber: null,
    targetedByRiskEngine: null,
    riskMessage: null,
    levelOneEmployee: null,
    levelTwoEmployee: null,
    otherResults: {
      manual: { result: null, code: null, employeeId: null },
      opposite: { result: null, code: null, employeeId: null },
      liveMeans: { result: null, code: null, employeeId: null },
    },
    notes: null,
    certScanStatus: "NonCertscan",
    certScanSnippet: null,
    originalCertScanSnippet: null,
    biEnrichmentStatus: "BI Not Provided",
    biMatched: false,
    biFilledFields: [],
    sourceSheetName: "Sheet1",
    sourceRowNumber: 1,
    ...overrides,
  };
}

function input(populationRows: PreparedPopulationRow[]): ExecutiveReportInput {
  return {
    monthFolderName: "5-May-2026",
    populationRows,
    sample: null,
    distribution: null,
    employeeFiles: [],
    template: null,
    config: DEFAULT_EXEC_CONFIG,
  };
}

describe("collectStagePortStats", () => {
  it("groups rows by (stage, port) and sorts each stage's ports by population descending", () => {
    const model = buildReportModel(
      input([
        popRow({ xrayImageId: "1", stage: "المستوى الأول", portName: "ميناء أ", xrayLevelOneResult: "سليمة", xrayLevelTwoResult: "سليمة" }),
        popRow({ xrayImageId: "2", stage: "المستوى الأول", portName: "ميناء أ", xrayLevelOneResult: "اشتباه", xrayLevelTwoResult: "اشتباه" }),
        popRow({ xrayImageId: "3", stage: "المستوى الأول", portName: "ميناء ب", xrayLevelOneResult: "سليمة", xrayLevelTwoResult: "سليمة" }),
        popRow({ xrayImageId: "4", stage: "المستوى الثاني", portName: "ميناء أ", xrayLevelOneResult: "سليمة", xrayLevelTwoResult: "سليمة" }),
      ]),
    );

    const byStage = collectStagePortStats(model);
    const stage1 = byStage.get("المستوى الأول") ?? [];
    expect(stage1.map((p) => p.name)).toEqual(["ميناء أ", "ميناء ب"]);
    expect(stage1[0]).toMatchObject({ total: 2, clean: 1, suspicious: 1 });
    expect(stage1[1]).toMatchObject({ total: 1, clean: 1, suspicious: 0 });

    const stage2 = byStage.get("المستوى الثاني") ?? [];
    expect(stage2).toHaveLength(1);
    expect(stage2[0]).toMatchObject({ name: "ميناء أ", total: 1 });
  });

  it("sums to the same totals as model.population.byStage (the invariant the design spec requires)", () => {
    const rows: PreparedPopulationRow[] = [];
    const stages = ["المستوى الأول", "المستوى الثاني", "المستوى الثالث", "المستوى الرابع"];
    const ports = ["ميناء أ", "ميناء ب", "ميناء ج"];
    let id = 0;
    for (const stage of stages) {
      for (const port of ports) {
        for (let i = 0; i < 3; i++) {
          id += 1;
          rows.push(
            popRow({
              xrayImageId: String(id),
              stage,
              portName: port,
              xrayLevelOneResult: i === 0 ? "اشتباه" : "سليمة",
              xrayLevelTwoResult: i === 0 ? "اشتباه" : "سليمة",
            }),
          );
        }
      }
    }
    const model = buildReportModel(input(rows));
    const byStage = collectStagePortStats(model);

    for (const stageProfile of model.population.byStage) {
      const ports = byStage.get(stageProfile.stageLabel) ?? [];
      const summedTotal = ports.reduce((sum, p) => sum + p.total, 0);
      const summedSample = ports.reduce((sum, p) => sum + p.sampleTotal, 0);
      expect(summedTotal).toBe(stageProfile.population);
      expect(summedSample).toBe(stageProfile.sampleSize);
    }
  });
});
