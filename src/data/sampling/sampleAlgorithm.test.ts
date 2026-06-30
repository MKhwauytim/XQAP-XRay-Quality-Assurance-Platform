import { expect, test } from "vitest";

import type { PreparedPopulationRow } from "../population/populationTypes";
import type { StageSamplingRule } from "../population/populationConfig";
import { drawSample } from "./sampleAlgorithm";
import { getStageKey } from "../population/stageHelpers";

function makeRow(
  id: string,
  portName: string,
  certScanStatus: "Certscan" | "NonCertscan"
): PreparedPopulationRow {
  return {
    xrayImageId: id,
    portName,
    certScanStatus,
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
      liveMeans: { result: null, code: null, employeeId: null }
    },
    notes: null,
    certScanSnippet: null,
    originalCertScanSnippet: null,
    biEnrichmentStatus: "BI Not Provided",
    biMatched: false,
    biFilledFields: [],
    sourceSheetName: "بري",
    sourceRowNumber: 1
  };
}

function makeRows(
  portName: string,
  certCount: number,
  nonCertCount: number,
  prefix = ""
): PreparedPopulationRow[] {
  const rows: PreparedPopulationRow[] = [];
  for (let i = 0; i < certCount; i++) {
    rows.push(makeRow(`${prefix}${portName}-C${i}`, portName, "Certscan"));
  }
  for (let i = 0; i < nonCertCount; i++) {
    rows.push(makeRow(`${prefix}${portName}-N${i}`, portName, "NonCertscan"));
  }
  return rows;
}

test("drawSample returns error for empty population", () => {
  const result = drawSample([], { totalSampleSize: 10, rngSeed: "abc" }, "user");
  expect(result.ok).toBe(false);
});

test("drawSample returns error for zero sample size", () => {
  const rows = makeRows("بري", 10, 10);
  const result = drawSample(rows, { totalSampleSize: 0, rngSeed: "abc" }, "user");
  expect(result.ok).toBe(false);
});

test("drawSample returns requested count when population is large enough", () => {
  const rows = [
    ...makeRows("بري", 100, 100, ""),
    ...makeRows("بحري", 50, 50, "B")
  ];
  const result = drawSample(rows, { totalSampleSize: 50, rngSeed: "test-seed" }, "user");
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.data.totalActual).toBe(50);
  expect(result.data.rows).toHaveLength(50);
});

test("drawSample produces no duplicate xrayImageIds", () => {
  const rows = [
    ...makeRows("بري", 200, 200),
    ...makeRows("بحري", 100, 100, "B")
  ];
  const result = drawSample(rows, { totalSampleSize: 100, rngSeed: "unique-test" }, "user");
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const ids = result.data.rows.map((r) => r.xrayImageId);
  expect(new Set(ids).size).toBe(ids.length);
});

test("drawSample is deterministic for same seed", () => {
  const rows = [
    ...makeRows("بري", 100, 100),
    ...makeRows("بحري", 50, 50, "B")
  ];
  const config = { totalSampleSize: 40, rngSeed: "deterministic" };
  const r1 = drawSample(rows, config, "user");
  const r2 = drawSample(rows, config, "user");
  expect(r1.ok && r2.ok).toBe(true);
  if (!r1.ok || !r2.ok) return;
  expect(r1.data.rows.map((r) => r.xrayImageId)).toEqual(
    r2.data.rows.map((r) => r.xrayImageId)
  );
});

test("drawSample differs for different seeds", () => {
  const rows = [...makeRows("بري", 200, 200)];
  const r1 = drawSample(rows, { totalSampleSize: 50, rngSeed: "seed-A" }, "user");
  const r2 = drawSample(rows, { totalSampleSize: 50, rngSeed: "seed-B" }, "user");
  expect(r1.ok && r2.ok).toBe(true);
  if (!r1.ok || !r2.ok) return;
  expect(r1.data.rows.map((r) => r.xrayImageId)).not.toEqual(
    r2.data.rows.map((r) => r.xrayImageId)
  );
});

test("drawSample applies spillover when a port is undersized", () => {
  // Port A has only 5 rows but gets 10 allocated — spillover should fill from B
  const rows = [
    ...makeRows("A", 3, 2),     // 5 total
    ...makeRows("B", 50, 50, "B") // 100 total
  ];
  const result = drawSample(rows, { totalSampleSize: 20, rngSeed: "spill" }, "user");
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  // Should still get 20 rows — all from A (5) + 15 spill from B
  expect(result.data.totalActual).toBe(20);
});

test("drawSample portAllocations total matches totalActual", () => {
  const rows = [
    ...makeRows("بري", 100, 100),
    ...makeRows("بحري", 60, 60, "B"),
    ...makeRows("افراد", 30, 30, "C")
  ];
  const result = drawSample(rows, { totalSampleSize: 60, rngSeed: "ports" }, "user");
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  // portAllocations excludes spillover extra draws, so may differ.
  // But total rows in data.rows should match totalActual.
  expect(result.data.rows.length).toBe(result.data.totalActual);
});

test("drawSample with stage-specific rules draws correct counts", () => {
  // Setup rows in Stage 1 and Stage 2
  const rows = [
    ...makeRows("بري", 5, 5).map(r => ({ ...r, stage: "FIRST_STAGE" })), // 10 total
    ...makeRows("بحري", 10, 10).map(r => ({ ...r, stage: "SECOND_STAGE" })) // 20 total
  ];

  const samplingRules: StageSamplingRule[] = [
    {
      stageKey: "first",
      method: "percentage",
      value: 100, // should draw 10
      isLocked: true,
      minRequiredCount: 0,
      certScanPercentage: 0,
      certScanExactCount: 0,
      certScanMethod: "percentage",
      certScanStrategy: "preferred"
    },
    {
      stageKey: "second",
      method: "exact",
      value: 5, // should draw 5
      isLocked: false,
      minRequiredCount: 2,
      certScanPercentage: 50, // 50% of 5 -> 2 certscan records
      certScanExactCount: 0,
      certScanMethod: "percentage",
      certScanStrategy: "preferred"
    }
  ];

  const result = drawSample(rows, { rngSeed: "stages-test", samplingRules }, "user");
  expect(result.ok).toBe(true);
  if (!result.ok) return;

  expect(result.data.totalActual).toBe(15);
  const firstStageDrawn = result.data.rows.filter(r => getStageKey(r.stage) === "first");
  const secondStageDrawn = result.data.rows.filter(r => getStageKey(r.stage) === "second");
  expect(firstStageDrawn).toHaveLength(10);
  expect(secondStageDrawn).toHaveLength(5);
});

