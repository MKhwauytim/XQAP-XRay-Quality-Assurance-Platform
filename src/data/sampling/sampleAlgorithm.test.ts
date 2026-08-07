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
  // portAllocations actuals are reconciled after spillover, so they must sum to totalActual.
  const portSum = result.data.portAllocations.reduce((s, a) => s + a.actualTotalDrawn, 0);
  expect(portSum).toBe(result.data.totalActual);
  expect(result.data.rows.length).toBe(result.data.totalActual);
});

test("legacy branch reconciles per-port actuals when spillover fires", () => {
  // Simulate runtime data drift: two rows carry a certScanStatus outside the
  // strict union (possible via legacy files loaded through unchecked casts).
  // The cert/noncert split then under-fills the port and spillover draws the
  // odd-status rows — per-port actuals must still sum to the grand total.
  const oddStatus = "Unknown" as PreparedPopulationRow["certScanStatus"];
  const rows = [
    ...makeRows("A", 4, 4),
    { ...makeRow("A-X0", "A", "Certscan"), certScanStatus: oddStatus },
    { ...makeRow("A-X1", "A", "Certscan"), certScanStatus: oddStatus }
  ];

  const result = drawSample(rows, { totalSampleSize: 10, rngSeed: "reconcile" }, "user");
  expect(result.ok).toBe(true);
  if (!result.ok) return;

  expect(result.data.totalActual).toBe(10);
  const portSum = result.data.portAllocations.reduce((s, a) => s + a.actualTotalDrawn, 0);
  expect(portSum).toBe(result.data.totalActual);

  const portA = result.data.portAllocations.find((a) => a.portName === "A");
  expect(portA?.actualTotalDrawn).toBe(10);
  expect(
    (portA?.actualCertScanDrawn ?? 0) + (portA?.actualNonCertScanDrawn ?? 0)
  ).toBe(10);
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

test("CertScan percentage is a split WITHIN the stage target, never additional to it (owner requirement, B task 1)", () => {
  // Owner-reported bug: "the 25% is suppose to be part of the number i require
  // not Above it". Verify drawStageSample never draws more than the configured
  // stage target regardless of the CertScan quota configured on top of it.
  const rows = makeRows("بري", 100, 100).map((r) => ({ ...r, stage: "SECOND_STAGE" }));
  const samplingRules: StageSamplingRule[] = [
    {
      stageKey: "second",
      method: "exact",
      value: 50,
      isLocked: false,
      minRequiredCount: 0,
      certScanPercentage: 25, // must mean "25% of the 50", not "50 + 25% extra"
      certScanExactCount: 0,
      certScanMethod: "percentage",
      certScanStrategy: "preferred",
    },
  ];

  const result = drawSample(rows, { rngSeed: "certscan-within-total", samplingRules }, "user");
  expect(result.ok).toBe(true);
  if (!result.ok) return;

  // The total actually drawn must equal the configured target exactly — not
  // target + certScan quota.
  expect(result.data.totalActual).toBe(50);
  expect(result.data.certScanActual + result.data.nonCertScanActual).toBe(50);
  // CertScan is a subset of the 50, never additional records on top of it.
  expect(result.data.certScanActual).toBeLessThanOrEqual(50);
});

// Golden master: captured from the pre-shortfall-detection algorithm (identical
// rng seed, rules, rows) BEFORE the CertScan-shortfall detection/reporting code
// was added. Detection must be pure observation of the existing draw — this
// test is the proof that adding it did not change a single drawn row.
const GOLDEN_SHORTFALL_ROW_IDS = [
  "بري-C1", "بري-C0", "بري-C2", "بري-N7", "بري-N19", "بري-N4", "بري-N10",
  "بري-N31", "بري-N36", "بري-N48", "بري-N13", "بري-N16", "بري-N40", "بري-N9",
  "بري-N41", "بري-N28", "بري-N21", "بري-N6", "بري-N22", "بري-N49"
];

test("drawSample under-fills (never backfills) a CertScan shortfall and reports it — drawn rows are byte-identical to the pre-detection golden master", () => {
  // Only 3 Certscan rows exist in the port/stage, but 50% of the exact-20 target
  // (=10) is requested for CertScan — a real, unavoidable shortfall of 7.
  const rows = [
    ...makeRows("بري", 3, 50).map((r) => ({ ...r, stage: "SECOND_STAGE" })),
  ];
  const samplingRules: StageSamplingRule[] = [
    {
      stageKey: "second",
      method: "exact",
      value: 20,
      isLocked: false,
      minRequiredCount: 0,
      certScanPercentage: 50,
      certScanExactCount: 0,
      certScanMethod: "percentage",
      certScanStrategy: "preferred",
    },
  ];
  const result = drawSample(rows, { rngSeed: "golden-shortfall-seed", samplingRules }, "user");
  expect(result.ok).toBe(true);
  if (!result.ok) return;

  // 1) Numeric behaviour is byte-identical to the golden master captured before
  // shortfall detection existed — under-fill, not backfill, and the same rows.
  expect(result.data.rows.map((r) => r.xrayImageId)).toEqual(GOLDEN_SHORTFALL_ROW_IDS);
  expect(result.data.totalActual).toBe(20); // strategy "preferred" backfills the TOTAL from NonCertscan...
  expect(result.data.certScanActual).toBe(3); // ...but CertScan itself is never backfilled: only the 3 that exist.
  expect(result.data.nonCertScanActual).toBe(17);

  // 2) The shortfall is captured as structured data, not just a side-effect of
  // the counts above — stage, port, requested vs. achieved, and pool size.
  expect(result.data.certScanShortfalls).toEqual([
    {
      stageKey: "second",
      stageLabel: "المستوى الثاني",
      portName: "بري",
      requestedCertScanQuota: 10,
      actualCertScanDrawn: 3,
      availableCertScanRows: 3,
    },
  ]);
});

test("drawSample reports a stage-wide CertScan shortfall when an `exact` CertScan target exceeds the whole stage's pool", () => {
  // exact CertScan target of 15 requested, but only 4 Certscan rows exist across
  // the whole stage (spread over two ports) — caught before per-port apportionment.
  const rows = [
    ...makeRows("بري", 2, 20, "P1-").map((r) => ({ ...r, stage: "SECOND_STAGE" })),
    ...makeRows("بحري", 2, 20, "P2-").map((r) => ({ ...r, stage: "SECOND_STAGE" })),
  ];
  const samplingRules: StageSamplingRule[] = [
    {
      stageKey: "second",
      method: "exact",
      value: 30,
      isLocked: false,
      minRequiredCount: 0,
      certScanPercentage: 0,
      certScanExactCount: 15,
      certScanMethod: "exact",
      certScanStrategy: "preferred",
    },
  ];
  const result = drawSample(rows, { rngSeed: "stage-wide-shortfall-seed", samplingRules }, "user");
  expect(result.ok).toBe(true);
  if (!result.ok) return;

  const stageWide = (result.data.certScanShortfalls ?? []).find((s) => s.portName === null);
  expect(stageWide).toEqual({
    stageKey: "second",
    stageLabel: "المستوى الثاني",
    portName: null,
    requestedCertScanQuota: 15,
    actualCertScanDrawn: 4,
    availableCertScanRows: 4,
  });
});

test("drawSample reports no CertScan shortfall when the pool fully covers the configured target", () => {
  const rows = makeRows("بري", 50, 50).map((r) => ({ ...r, stage: "SECOND_STAGE" }));
  const samplingRules: StageSamplingRule[] = [
    {
      stageKey: "second",
      method: "exact",
      value: 20,
      isLocked: false,
      minRequiredCount: 0,
      certScanPercentage: 25,
      certScanExactCount: 0,
      certScanMethod: "percentage",
      certScanStrategy: "preferred",
    },
  ];
  const result = drawSample(rows, { rngSeed: "no-shortfall-seed", samplingRules }, "user");
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.data.certScanShortfalls).toEqual([]);
});

test("drawSample rejects a population whose stage values match none of the four configured stages", () => {
  // Population exists (100 rows) but every row's `stage` text is not one of the
  // DEFAULT_STAGE_MAPPINGS aliases (e.g. the Excel source uses "Level 1" wording
  // instead of "STAGE 1" / "المستوى الأول") — every row falls into "unknown".
  const rows = makeRows("بري", 50, 50).map((r) => ({ ...r, stage: "Level 1" }));

  const samplingRules: StageSamplingRule[] = [
    {
      stageKey: "first",
      method: "percentage",
      value: 100,
      isLocked: true,
      minRequiredCount: 0,
      certScanPercentage: 0,
      certScanExactCount: 0,
      certScanMethod: "percentage",
      certScanStrategy: "preferred"
    }
  ];

  const result = drawSample(rows, { rngSeed: "unmapped-stage-test", samplingRules }, "user");

  // Must fail loudly instead of silently "succeeding" with a zeroed sample —
  // a zero-row sample saved to disk looks identical to a real empty draw and
  // gives the operator no signal that stage mapping is misconfigured.
  expect(result.ok).toBe(false);
});

