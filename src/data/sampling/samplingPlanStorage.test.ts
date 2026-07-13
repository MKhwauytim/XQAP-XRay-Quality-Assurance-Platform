import { describe, expect, test } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { PreparedPopulationRow } from "../population/populationTypes";
import type { SampleMasterData } from "./sampleTypes";
import { SAMPLING_ALGORITHM_VERSION } from "./sampleAlgorithm";
import {
  buildSamplingPlan,
  computeSuspicionRate,
  loadSamplingPlan,
  recommendationFromRate,
  saveSamplingPlan,
  SUSPICION_TIGHTEN_THRESHOLD,
} from "./samplingPlanStorage";

function makeRow(id: string, opts?: Partial<PreparedPopulationRow>): PreparedPopulationRow {
  return {
    xrayImageId: id,
    portName: "بري",
    certScanStatus: "NonCertscan",
    stage: null,
    xrayEntryDate: null,
    portCode: null,
    portType: null,
    declarationNumber: null,
    declarationDate: null,
    plateOrContainerNumber: null,
    chassisNumber: null,
    xrayLevelOneResult: "سليمة",
    xrayLevelTwoResult: "سليمة",
    movementType: "LAND",
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
    certScanSnippet: null,
    originalCertScanSnippet: null,
    biEnrichmentStatus: "BI Not Provided",
    biMatched: false,
    biFilledFields: [],
    sourceSheetName: "بري",
    sourceRowNumber: 1,
    ...opts,
  };
}

function makeSampleData(rows: PreparedPopulationRow[]): SampleMasterData {
  return {
    rngSeed: "seed-123",
    samplingAlgorithmVersion: SAMPLING_ALGORITHM_VERSION,
    totalRequested: rows.length,
    totalActual: rows.length,
    certScanRequested: 0,
    nonCertScanRequested: rows.length,
    certScanActual: 0,
    nonCertScanActual: rows.length,
    portAllocations: [],
    stageAllocations: [
      {
        stageKey: "first",
        stageLabel: "المستوى الأول",
        populationSize: 10,
        targetQuota: rows.length,
        actualDrawn: rows.length,
        certScanDrawn: 0,
        nonCertScanDrawn: rows.length,
      },
    ],
    drawnAt: new Date().toISOString(),
    drawnBy: "drawer",
    rows,
  };
}

describe("samplingPlanStorage", () => {
  test("buildSamplingPlan computes lot, fraction, algorithm version and risk share", () => {
    const population = [
      makeRow("A1", { portName: "بري", targetedByRiskEngine: "نعم" }),
      makeRow("A2", { portName: "بري", targetedByRiskEngine: "لا" }),
      makeRow("A3", { portName: "جوي", targetedByRiskEngine: "yes" }),
      makeRow("A4", { portName: "جوي", targetedByRiskEngine: null }),
    ];
    const sampleRows = [population[0]!, population[2]!]; // both targeted
    const sampleData = makeSampleData(sampleRows);

    const plan = buildSamplingPlan({
      monthFolderName: "5-may-2026",
      populationRows: population,
      sampleData,
      createdBy: "supervisor",
    });

    expect(plan.schema).toBe(1);
    expect(plan.samplingAlgorithmVersion).toBe(SAMPLING_ALGORITHM_VERSION);
    expect(plan.rngSeed).toBe("seed-123");
    expect(plan.lot.populationSize).toBe(4);
    expect(plan.lot.ports).toEqual(["بري", "جوي"]); // sorted, deduped
    expect(plan.lot.stageSplit).toHaveLength(1);
    expect(plan.totalActual).toBe(2);
    expect(plan.targetSampleFraction).toBeCloseTo(0.5, 6);
    // 2 of 4 population rows are affirmatively targeted ("نعم", "yes").
    expect(plan.riskBasis.populationTargeted).toBe(2);
    expect(plan.riskBasis.populationTargetedShare).toBeCloseTo(0.5, 6);
    // both drawn rows are targeted.
    expect(plan.riskBasis.sampleTargeted).toBe(2);
    expect(plan.riskBasis.sampleTargetedShare).toBeCloseTo(1, 6);
    expect(plan.qualityThresholdNote).toBeTruthy();
    expect(plan.inspectionLevelNote).toBeTruthy();
  });

  test("buildSamplingPlan is safe on an empty population (no divide-by-zero)", () => {
    const sampleData = makeSampleData([]);
    sampleData.totalActual = 0;
    const plan = buildSamplingPlan({
      monthFolderName: "5-may-2026",
      populationRows: [],
      sampleData,
      createdBy: "supervisor",
    });
    expect(plan.targetSampleFraction).toBe(0);
    expect(plan.riskBasis.populationTargetedShare).toBe(0);
    expect(plan.riskBasis.sampleTargetedShare).toBe(0);
  });

  test("save + load round-trips the plan unchanged", async () => {
    const dir = createMemoryDirectory();
    const population = [makeRow("A1", { targetedByRiskEngine: "نعم" }), makeRow("A2")];
    const sampleData = makeSampleData([population[0]!]);
    const plan = buildSamplingPlan({
      monthFolderName: "5-may-2026",
      populationRows: population,
      sampleData,
      createdBy: "supervisor",
    });

    const saveResult = await saveSamplingPlan(dir, "5-may-2026", plan);
    expect(saveResult.ok).toBe(true);

    const loaded = await loadSamplingPlan(dir, "5-may-2026");
    expect(loaded).not.toBeNull();
    expect(loaded).toEqual(plan);
  });

  test("loadSamplingPlan returns null for a legacy month with no plan file", async () => {
    const dir = createMemoryDirectory();
    const loaded = await loadSamplingPlan(dir, "5-may-2026");
    expect(loaded).toBeNull();
  });
});

describe("B4 switching-rule advisory", () => {
  test("computeSuspicionRate is the share of xrayLevelTwoResult === اشتباه", () => {
    const rows = [
      makeRow("A1", { xrayLevelTwoResult: "اشتباه" }),
      makeRow("A2", { xrayLevelTwoResult: "سليمة" }),
      makeRow("A3", { xrayLevelTwoResult: "سليمة" }),
      makeRow("A4", { xrayLevelTwoResult: "سليمة" }),
    ];
    expect(computeSuspicionRate(rows)).toBeCloseTo(0.25, 6);
  });

  test("computeSuspicionRate returns null for an empty population (no signal)", () => {
    expect(computeSuspicionRate([])).toBeNull();
  });

  test("recommendationFromRate crosses the 5% threshold", () => {
    expect(recommendationFromRate(null)).toBeNull();
    expect(recommendationFromRate(0)).toBe("normal");
    expect(recommendationFromRate(SUSPICION_TIGHTEN_THRESHOLD)).toBe("normal"); // exactly 5% is NOT tightened
    expect(recommendationFromRate(0.0501)).toBe("tightened-review");
    expect(recommendationFromRate(0.2)).toBe("tightened-review");
  });

  test("buildSamplingPlan folds the advisory in when provided, omits it otherwise", () => {
    const population = [makeRow("A1")];
    const sampleData = makeSampleData(population);
    const withAdvisory = buildSamplingPlan({
      monthFolderName: "6-june-2026",
      populationRows: population,
      sampleData,
      createdBy: "supervisor",
      priorMonthAdvisory: {
        priorMonthFolderName: "5-may-2026",
        priorMonthSuspicionRate: 0.08,
        inspectionRecommendation: "tightened-review",
      },
    });
    expect(withAdvisory.priorMonthAdvisory).toEqual({
      priorMonthFolderName: "5-may-2026",
      priorMonthSuspicionRate: 0.08,
      inspectionRecommendation: "tightened-review",
    });

    const withoutAdvisory = buildSamplingPlan({
      monthFolderName: "6-june-2026",
      populationRows: population,
      sampleData,
      createdBy: "supervisor",
    });
    expect(withoutAdvisory.priorMonthAdvisory).toBeUndefined();
  });
});
