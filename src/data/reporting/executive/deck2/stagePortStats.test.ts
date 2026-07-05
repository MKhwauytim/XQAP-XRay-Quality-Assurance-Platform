// src/data/reporting/executive/deck2/stagePortStats.test.ts
import { describe, expect, it } from "vitest";
import { DEFAULT_EXEC_CONFIG } from "../../executiveReportTypes";
import type { ExecutiveReportInput } from "../../executiveReportTypes";
import type { PreparedPopulationRow } from "../../../population/populationTypes";
import type { SampleMasterData } from "../../../sampling/sampleTypes";
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

  it("does NOT guarantee the invariant when StageProfile comes from a frozen StageAllocation snapshot (production branch)", () => {
    // When sample.stageAllocations is present (the normal case after Phase 3 sampling),
    // calculateExecutiveKPIs takes population/sampleSize straight from the frozen
    // StageAllocation record captured at sample-draw time — it does NOT recompute them
    // from model.rows. collectStagePortStats, on the other hand, always tallies the
    // *current* model.rows fresh. So the two numbers are independent in this branch,
    // and can legitimately diverge (e.g. if rows were reprocessed after the sample was
    // drawn). This test proves the collector itself is still correct (real row count),
    // while the frozen allocation reports something else entirely — that's expected,
    // not a bug.
    const rows: PreparedPopulationRow[] = [
      popRow({ xrayImageId: "1", stage: "المستوى الأول", portName: "ميناء أ" }),
      popRow({ xrayImageId: "2", stage: "المستوى الأول", portName: "ميناء أ" }),
      popRow({ xrayImageId: "3", stage: "المستوى الأول", portName: "ميناء ب" }),
    ];

    const sample: SampleMasterData = {
      rngSeed: "",
      totalRequested: 0,
      totalActual: 0,
      certScanRequested: 0,
      nonCertScanRequested: 0,
      certScanActual: 0,
      nonCertScanActual: 0,
      portAllocations: [],
      stageAllocations: [
        {
          stageKey: "first",
          stageLabel: "المستوى الأول",
          populationSize: 999, // deliberately different from the 3 real rows above
          targetQuota: 0,
          actualDrawn: 0,
          certScanDrawn: 0,
          nonCertScanDrawn: 0,
        },
      ],
      drawnAt: "",
      drawnBy: "",
      rows,
    };

    const model = buildReportModel({
      monthFolderName: "5-May-2026",
      populationRows: rows,
      sample,
      distribution: null,
      employeeFiles: [],
      template: null,
      config: DEFAULT_EXEC_CONFIG,
    });

    const stage1 = model.population.byStage.find((s) => s.stageLabel === "المستوى الأول");
    expect(stage1).toBeDefined();
    // The frozen allocation snapshot wins here — not a fresh count of model.rows.
    expect(stage1!.population).toBe(999);

    // But collectStagePortStats always tallies the real rows it's given, regardless
    // of what the frozen allocation says.
    const ports = collectStagePortStats(model).get("المستوى الأول") ?? [];
    const summedTotal = ports.reduce((sum, p) => sum + p.total, 0);
    expect(summedTotal).toBe(3);
  });
});
