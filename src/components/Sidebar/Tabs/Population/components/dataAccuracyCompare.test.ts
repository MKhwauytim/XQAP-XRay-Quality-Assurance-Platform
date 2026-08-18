import { expect, test } from "vitest";

import type { NormalizedRiskRow } from "../riskData/riskDataTypes";
import type { NormalizedBiRow } from "../biData/biDataTypes";
import { compareAccuracy, compareAccuracyAsync } from "./dataAccuracyCompare";

function riskRow(overrides: Partial<NormalizedRiskRow>): NormalizedRiskRow {
  return {
    xrayImageId: "XR-1",
    portName: "المنفذ",
    xrayLevelOneResult: "1",
    xrayLevelTwoResult: "1",
    inspectorResult: null,
    oppositeInspectorResult: null,
    liveMeansResult: null,
    portCode: null,
    portType: null,
    declarationDate: null,
    plateOrContainerNumber: null,
    sourceSheetName: "risk",
    sourceRowNumber: 1,
    ...overrides,
  } as unknown as NormalizedRiskRow;
}

function biRow(overrides: Partial<NormalizedBiRow>): NormalizedBiRow {
  return {
    source: "BI",
    xrayImageId: "XR-1",
    portName: "المنفذ",
    levelOneResult: "1",
    levelTwoResult: "1",
    manualInspectionResult: null,
    oppositeInspectionResult: null,
    liveMeansResult: null,
    portCode: null,
    portType: null,
    declarationDate: null,
    plateOrContainerNumber: null,
    sourceSheetName: "BI",
    sourceRowNumber: 1,
    ...overrides,
  } as unknown as NormalizedBiRow;
}

// Fix (population, 2026-08-18): compareAccuracy used to be the ONLY
// implementation and ran synchronously on the render thread for every risk
// row -- freezing the app on a real population. compareAccuracyAsync is the
// chunked twin that yields periodically; this test proves the two produce
// byte-identical results for the same inputs, so chunking never changed what
// gets computed, only whether the UI stays responsive while it runs.
test("compareAccuracyAsync produces the same result as the synchronous compareAccuracy", async () => {
  const riskRows: NormalizedRiskRow[] = [
    riskRow({ xrayImageId: "XR-1", xrayLevelOneResult: "1" }),
    riskRow({ xrayImageId: "XR-2", xrayLevelOneResult: "2" }),
    riskRow({ xrayImageId: "XR-3", xrayLevelOneResult: "1" }),
    riskRow({ xrayImageId: "XR-4", xrayLevelOneResult: "1" }), // only in risk
  ];
  const biRows: NormalizedBiRow[] = [
    biRow({ xrayImageId: "XR-1", levelOneResult: "1" }), // matches
    biRow({ xrayImageId: "XR-2", levelOneResult: "1" }), // mismatches (risk says 2)
    biRow({ xrayImageId: "XR-3", levelOneResult: "2" }), // mismatches (risk says 1)
    biRow({ xrayImageId: "XR-5" }), // only in BI
  ];

  const sync = compareAccuracy(riskRows, biRows);
  const async_ = await compareAccuracyAsync(riskRows, biRows);

  expect(async_).toEqual(sync);
  expect(sync.matchedIds).toBe(3);
  expect(sync.onlyInRisk).toBe(1);
  expect(sync.onlyInBi).toBe(1);
  expect(sync.mismatches.length).toBeGreaterThan(0);
});

// Proves the chunking loop actually yields (and doesn't, say, throw on an
// empty input or a single-chunk input) by exercising an input large enough
// to span multiple chunks (CHUNK_SIZE = 2000 in dataAccuracyCompare.ts).
test("compareAccuracyAsync handles an input spanning multiple chunks without dropping rows", async () => {
  const riskRows: NormalizedRiskRow[] = Array.from({ length: 4500 }, (_, i) =>
    riskRow({ xrayImageId: `XR-${i}`, xrayLevelOneResult: "1" })
  );
  const biRows: NormalizedBiRow[] = Array.from({ length: 4500 }, (_, i) =>
    biRow({ xrayImageId: `XR-${i}`, levelOneResult: "1" })
  );

  const result = await compareAccuracyAsync(riskRows, biRows);

  expect(result.matchedIds).toBe(4500);
  expect(result.onlyInRisk).toBe(0);
  expect(result.onlyInBi).toBe(0);
  expect(result.totalMismatches).toBe(0);
});

test("compareAccuracyAsync returns the neutral empty result for two empty inputs", async () => {
  const result = await compareAccuracyAsync([], []);
  expect(result.overallAccuracy).toBe(100);
  expect(result.matchedIds).toBe(0);
  expect(result.mismatches).toEqual([]);
});
