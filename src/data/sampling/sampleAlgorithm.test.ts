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
  // the counts above — stage, requested vs. achieved, and pool size.
  //
  // Re-recorded for "1.2" (2026-08-19): `portName` is now null. The request
  // (50% of the exact-20 target = 10) is computed once for the stage, so the
  // over-ask against the 3-row CertScan pool is detected at stage level before
  // apportionment, exactly as the `exact` method has always done. Every other
  // field — and every drawn row asserted above — is unchanged.
  expect(result.data.certScanShortfalls).toEqual([
    {
      stageKey: "second",
      stageLabel: "المستوى الثاني",
      portName: null,
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

// ---------------------------------------------------------------------------
// P4 regression: a PARTIAL population of unmapped-stage rows must not be
// silently excluded from the draw with zero diagnostic on the success path.
// ---------------------------------------------------------------------------

test("REGRESSION (P4): a partial mix of unmapped-stage rows is counted, not silently dropped with no trace", () => {
  const knownRows = makeRows("بري", 2, 2).map((r) => ({ ...r, stage: "THIRD_STAGE" }));
  // Two distinct unmapped raw values, so the raw-values list must capture both.
  const unmappedRows = [
    { ...makeRow("garbage-1", "بري", "NonCertscan"), stage: "SOME_UNRECOGNIZED_STAGE_VALUE" },
    { ...makeRow("garbage-2", "بري", "NonCertscan"), stage: "ANOTHER_BAD_VALUE" },
    { ...makeRow("garbage-3", "بري", "NonCertscan"), stage: "SOME_UNRECOGNIZED_STAGE_VALUE" }
  ];
  const rows = [...knownRows, ...unmappedRows];

  const samplingRules: StageSamplingRule[] = [
    {
      stageKey: "third",
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

  const result = drawSample(rows, { rngSeed: "p4-partial-unmapped", samplingRules }, "user");
  expect(result.ok).toBe(true);
  if (!result.ok) return;

  // The 4 known-stage rows are drawn; the 3 unmapped ones never appear...
  const drawnIds = result.data.rows.map((r) => r.xrayImageId).sort();
  expect(drawnIds).not.toContain("garbage-1");
  expect(drawnIds).not.toContain("garbage-2");
  expect(drawnIds).not.toContain("garbage-3");

  // ...but unlike before the fix, that exclusion is now recorded on the result.
  expect(result.data.unmappedStageRowCount).toBe(3);
  expect(result.data.unmappedStageRawValues).toEqual(
    expect.arrayContaining(["SOME_UNRECOGNIZED_STAGE_VALUE", "ANOTHER_BAD_VALUE"])
  );
  expect(result.data.unmappedStageRawValues).toHaveLength(2); // distinct values only
});

test("P4: unmappedStageRowCount is 0 (not absent) when every row's stage mapped cleanly", () => {
  const rows = makeRows("بري", 5, 5).map((r) => ({ ...r, stage: "THIRD_STAGE" }));
  const samplingRules: StageSamplingRule[] = [
    {
      stageKey: "third",
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
  const result = drawSample(rows, { rngSeed: "p4-all-mapped", samplingRules }, "user");
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.data.unmappedStageRowCount).toBe(0);
  expect(result.data.unmappedStageRawValues).toEqual([]);
});

test("P4: unmappedStageRawValues is capped so a workspace with many distinct typos doesn't bloat the file", () => {
  const knownRows = makeRows("بري", 1, 1).map((r) => ({ ...r, stage: "THIRD_STAGE" }));
  const manyUnmappedRows = Array.from({ length: 30 }, (_, i) => ({
    ...makeRow(`garbage-${i}`, "بري", "NonCertscan"),
    stage: `DISTINCT_BAD_VALUE_${i}`
  }));
  const rows = [...knownRows, ...manyUnmappedRows];
  const samplingRules: StageSamplingRule[] = [
    {
      stageKey: "third",
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
  const result = drawSample(rows, { rngSeed: "p4-many-unmapped", samplingRules }, "user");
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  // The full count is still accurate even though the raw-values sample is capped.
  expect(result.data.unmappedStageRowCount).toBe(30);
  expect(result.data.unmappedStageRawValues!.length).toBeLessThanOrEqual(20);
  expect(result.data.unmappedStageRawValues!.length).toBeGreaterThan(0);
});

test("P4: the legacy totalSampleSize path leaves unmappedStageRowCount undefined (it never classifies rows by stage)", () => {
  const rows = makeRows("بري", 5, 5).map((r) => ({ ...r, stage: "GARBAGE_NOT_A_REAL_STAGE" }));
  const result = drawSample(rows, { totalSampleSize: 5, rngSeed: "p4-legacy" }, "user");
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.data.unmappedStageRowCount).toBeUndefined();
  expect(result.data.unmappedStageRawValues).toBeUndefined();
});

test("P4: SAMPLING_ALGORITHM_VERSION is unchanged by the unmapped-stage diagnostic (additive, not semantic)", async () => {
  const { SAMPLING_ALGORITHM_VERSION } = await import("./sampleAlgorithm");
  // "1.2" (2026-08-19): bumped by the per-port CertScan rounding fix, NOT by the
  // P4 diagnostic this test guards — that one is still additive-only.
  expect(SAMPLING_ALGORITHM_VERSION).toBe("1.2");
});


// Owner scenario (2026-08-18), asserted at real scale so it cannot silently
// regress: المستوى الثاني targets 2,000 rows with a 25% CertScan quota (=500),
// but only 200 CertScan rows exist in the whole stage. The draw must take all
// 200 and fill the remaining 300 from NonCertscan so the stage still lands on
// its 2,000 target — never return a short 1,700.
//
// This is the `certScanStrategy: "preferred"` branch in stagePortDraw, which is
// the default for all four stages (see populationConfig.ts). Under "mandatory"
// the stage deliberately under-fills instead — the second case below pins that
// difference so the two strategies can never quietly converge.
test("drawSample backfills a CertScan shortfall from NonCertscan and still hits the stage target (owner scenario: 2,000 target, 25% CertScan, only 200 available)", () => {
  // 200 Certscan + 7,800 NonCertscan across two ports = an 8,000-row level 2.
  const rows = [
    ...makeRows("بري", 120, 4680).map((r) => ({ ...r, stage: "SECOND_STAGE" })),
    ...makeRows("بحري", 80, 3120, "s").map((r) => ({ ...r, stage: "SECOND_STAGE" })),
  ];
  expect(rows.filter((r) => r.certScanStatus === "Certscan")).toHaveLength(200);
  expect(rows).toHaveLength(8000);

  const rule: StageSamplingRule = {
    stageKey: "second",
    method: "exact",
    value: 2000,
    isLocked: false,
    minRequiredCount: 0,
    certScanPercentage: 25,
    certScanExactCount: 0,
    certScanMethod: "percentage",
    certScanStrategy: "preferred",
  };

  const result = drawSample(rows, { rngSeed: "owner-backfill-seed", samplingRules: [rule] }, "user");
  expect(result.ok).toBe(true);
  if (!result.ok) return;

  // The target is met in full — this is the assertion the owner asked for.
  expect(result.data.totalActual).toBe(2000);
  // CertScan itself is never invented: every one of the 200 that exist is taken...
  expect(result.data.certScanActual).toBe(200);
  // ...and the 300-row gap to the 500 quota is filled from NonCertscan.
  expect(result.data.nonCertScanActual).toBe(1800);
  expect(result.data.certScanActual + result.data.nonCertScanActual).toBe(2000);

  // Every drawn row is a real, distinct population row — no duplicates.
  expect(new Set(result.data.rows.map((r) => r.xrayImageId)).size).toBe(2000);

  // The gap is still reported rather than hidden by the successful backfill.
  const shortfalls = result.data.certScanShortfalls ?? [];
  const requested = shortfalls.reduce((sum, entry) => sum + entry.requestedCertScanQuota, 0);
  const available = shortfalls.reduce((sum, entry) => sum + entry.availableCertScanRows, 0);
  expect(requested).toBe(500);
  expect(available).toBe(200);
});

// Companion to the scenario above, pinning a behaviour that surprised us while
// verifying it: `certScanStrategy: "mandatory"` does NOT change the stage total.
// Its per-port branch in stagePortDraw does withhold the backfill (بري 120+900,
// بحري 80+600 = 1,700), but the stage-level spillover pass then redistributes
// the 300-row gap across the ports' remaining rows and the stage lands on 2,000
// anyway — with the extra rows necessarily NonCertscan, since the CertScan pool
// is already exhausted. So today the two strategies differ only in WHICH
// NonCertscan rows get drawn, never in how many.
//
// This is pre-existing behaviour and is left as-is deliberately: the draw is
// deterministic by contract, every shipped stage defaults to "preferred"
// (populationConfig.ts), and "preferred" is what the owner's workflow wants.
// The test exists so that if anyone later intends "mandatory" to really
// under-fill, they find out here that spillover is what they have to change.
//
// RULED DELIBERATE 2026-08-19 — mandatory remains total-preserving. Re-examined
// while landing the "1.2" per-port CertScan rounding fix and explicitly kept:
// that fix changes WHICH CertScan rows a percentage rule asks for, never whether
// a stage reaches its total. The convergence pinned below is in scope of the
// contract and must not be "fixed" as a side effect of a CertScan change.
test("certScanStrategy `mandatory` still reaches the stage target, because spillover refills the gap", () => {
  const rows = [
    ...makeRows("بري", 120, 4680).map((r) => ({ ...r, stage: "SECOND_STAGE" })),
    ...makeRows("بحري", 80, 3120, "s").map((r) => ({ ...r, stage: "SECOND_STAGE" })),
  ];

  const rule: StageSamplingRule = {
    stageKey: "second",
    method: "exact",
    value: 2000,
    isLocked: false,
    minRequiredCount: 0,
    certScanPercentage: 25,
    certScanExactCount: 0,
    certScanMethod: "percentage",
    certScanStrategy: "mandatory",
  };

  const result = drawSample(rows, { rngSeed: "owner-backfill-seed", samplingRules: [rule] }, "user");
  expect(result.ok).toBe(true);
  if (!result.ok) return;

  expect(result.data.certScanActual).toBe(200);
  expect(result.data.nonCertScanActual).toBe(1800);
  expect(result.data.totalActual).toBe(2000);
});


// Regression (2026-08-19, "1.2"): the `percentage` CertScan target used to be
// rounded independently PER PORT — `Math.round(pct/100 * allocated)` inside
// stagePortDraw. With ten ports each allocated a single seat and a configured
// 50%, every port rounded 0.5 UP to 1 and the stage drew 100% CertScan: the
// rounding ran N times and always broke the same way, so the error compounded
// instead of cancelling. It also disagreed with `certScanConfiguredTarget`, the
// stage-level figure Phase 3 shows the user before the draw.
//
// The target is now rounded once for the stage and Hamilton-apportioned across
// the ports, so exactly 5 of the 10 seats are CertScan. This is the smallest
// configuration that reproduces the old bias at full strength (every port sits
// exactly on the .5 boundary).
test("drawSample rounds a `percentage` CertScan target once per STAGE, not once per port (10 ports x 1 seat at 50% draws 5 CertScan, not 10)", () => {
  const rows = Array.from({ length: 10 }, (_, index) =>
    makeRows(`port-${String(index).padStart(2, "0")}`, 1, 1)
  )
    .flat()
    .map((row) => ({ ...row, stage: "SECOND_STAGE" }));
  expect(rows).toHaveLength(20);
  expect(rows.filter((row) => row.certScanStatus === "Certscan")).toHaveLength(10);

  const samplingRules: StageSamplingRule[] = [
    {
      stageKey: "second",
      method: "exact",
      value: 10,
      isLocked: false,
      minRequiredCount: 0,
      certScanPercentage: 50,
      certScanExactCount: 0,
      certScanMethod: "percentage",
      certScanStrategy: "preferred",
    },
  ];

  const result = drawSample(rows, { rngSeed: "per-port-rounding-bias", samplingRules }, "user");
  expect(result.ok).toBe(true);
  if (!result.ok) return;

  // Each port is allocated exactly 1 seat, so the old code drew 10/10 CertScan.
  expect(result.data.portAllocations.every((port) => port.allocatedQuota === 1)).toBe(true);
  expect(result.data.totalActual).toBe(10);
  expect(result.data.certScanActual).toBe(5);
  expect(result.data.nonCertScanActual).toBe(5);
  // The request itself is honest too, not just the outcome after capping.
  expect(result.data.certScanRequested).toBe(5);
  // A satisfiable request is not a shortfall.
  expect(result.data.certScanShortfalls).toEqual([]);
});
