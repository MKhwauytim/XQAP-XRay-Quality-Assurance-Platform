import { describe, expect, it } from "vitest";

import type { PreparedPopulationRow } from "../population/populationTypes";
import type { StageAliasMappings, StageSamplingRule } from "../population/populationConfig";
import { drawSample } from "./sampleAlgorithm";
import type { SampleMasterData } from "./sampleTypes";

/**
 * GOLDEN MASTER (Slice 0) — `drawSample`.
 *
 * The draw is deterministic by contract: a fixed seed + fixed config + fixed
 * row order must produce exactly the same drawn rows, in the same order, with
 * the same per-port/per-stage bookkeeping. This file pins that output as
 * OBSERVED today so a refactor that perturbs RNG consumption order (or the
 * apportionment / spillover / stage-redistribution arithmetic) fails loudly
 * instead of silently producing a different — but still plausible — sample.
 *
 * Every value below was recorded from the current implementation. Where the
 * recorded value looks wrong, the comment says so and the value is still the
 * observed one; nothing here is an aspirational assertion.
 *
 * `drawnAt` is excluded from every assertion: `new Date().toISOString()` is the
 * only non-deterministic field on the result.
 */

function makeRow(
  id: string,
  portName: string,
  certScanStatus: "Certscan" | "NonCertscan",
  stage: string | null = "1"
): PreparedPopulationRow {
  return {
    xrayImageId: id,
    portName,
    certScanStatus,
    stage,
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
    // Present on purpose: `successfulResult` must strip it from every drawn row.
    rawRow: { original: "excel-cell" },
    sourceSheetName: "بري",
    sourceRowNumber: 1,
  };
}

function makeRows(
  portName: string,
  certCount: number,
  nonCertCount: number,
  stage: string | null = "1",
  prefix = ""
): PreparedPopulationRow[] {
  const rows: PreparedPopulationRow[] = [];
  for (let i = 0; i < certCount; i++) {
    rows.push(makeRow(`${prefix}${portName}-S${stage}-C${i}`, portName, "Certscan", stage));
  }
  for (let i = 0; i < nonCertCount; i++) {
    rows.push(makeRow(`${prefix}${portName}-S${stage}-N${i}`, portName, "NonCertscan", stage));
  }
  return rows;
}

function rule(
  overrides: Partial<StageSamplingRule> & { stageKey: StageSamplingRule["stageKey"] }
): StageSamplingRule {
  return {
    method: "exact",
    value: 0,
    isLocked: false,
    minRequiredCount: 0,
    certScanPercentage: 0,
    certScanExactCount: 0,
    certScanMethod: "percentage",
    certScanStrategy: "mandatory",
    ...overrides,
  };
}

/** Drops the only non-deterministic field on a draw result. */
function omitDrawnAt(data: SampleMasterData): Omit<SampleMasterData, "drawnAt"> {
  const copy: Partial<SampleMasterData> = { ...data };
  delete copy.drawnAt;
  return copy as Omit<SampleMasterData, "drawnAt">;
}

const STAGE_MAPPINGS: StageAliasMappings = {
  first: ["1"],
  second: ["2"],
  third: ["3"],
  fourth: ["4"],
};

// ---------------------------------------------------------------------------
// Legacy (totalSampleSize) path
// ---------------------------------------------------------------------------

describe("drawSample — legacy path golden master", () => {
  // Deliberately uneven: 13 + 7 rows across two ports so Hamilton's
  // largest-remainder step has a real remainder to break, with an odd
  // Cert/NonCert split inside each port so the second Hamilton split is
  // non-trivial.
  const rows = [...makeRows("بري", 5, 8, "1", ""), ...makeRows("بحري", 3, 4, "1", "B")];

  it("pins the exact drawn ids and order for seed 'golden-seed-1'", () => {
    const result = drawSample(rows, { totalSampleSize: 9, rngSeed: "golden-seed-1" }, "tester");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Note the ordering contract: rows come out grouped per port in
    // apportionment order, CertScan draws before NonCertScan within a port —
    // NOT in population order and NOT shuffled globally.
    expect(result.data.rows.map((r) => r.xrayImageId)).toEqual([
      "بري-S1-C1",
      "بري-S1-C4",
      "بري-S1-N1",
      "بري-S1-N3",
      "بري-S1-N6",
      "بري-S1-N7",
      "Bبحري-S1-C1",
      "Bبحري-S1-N1",
      "Bبحري-S1-N3",
    ]);
  });

  it("pins the counters, allocations and stripped-row shape for that same draw", () => {
    const result = drawSample(rows, { totalSampleSize: 9, rngSeed: "golden-seed-1" }, "tester");
    if (!result.ok) throw new Error("draw failed");
    const data = omitDrawnAt(result.data);

    expect(data).toEqual({
      rngSeed: "golden-seed-1",
      samplingAlgorithmVersion: "1.1",
      drawnBy: "tester",
      totalRequested: 9,
      totalActual: 9,
      certScanRequested: 3,
      nonCertScanRequested: 6,
      certScanActual: 3,
      nonCertScanActual: 6,
      certScanShortfalls: [],
      stageAllocations: [],
      portAllocations: [
        {
          portName: "بري",
          populationSize: 13,
          certScanCount: 5,
          nonCertScanCount: 8,
          allocatedQuota: 6,
          certScanQuota: 2,
          nonCertScanQuota: 4,
          actualCertScanDrawn: 2,
          actualNonCertScanDrawn: 4,
          actualTotalDrawn: 6,
        },
        {
          portName: "بحري",
          populationSize: 7,
          certScanCount: 3,
          nonCertScanCount: 4,
          allocatedQuota: 3,
          certScanQuota: 1,
          nonCertScanQuota: 2,
          actualCertScanDrawn: 1,
          actualNonCertScanDrawn: 2,
          actualTotalDrawn: 3,
        },
      ],
      rows: data.rows,
    });

    // Every drawn row is stripped of rawRow before it can reach disk.
    expect(data.rows.every((r) => !("rawRow" in r))).toBe(true);
  });

  it("pins a different seed producing a different set of the same size", () => {
    const a = drawSample(rows, { totalSampleSize: 9, rngSeed: "golden-seed-1" }, "tester");
    const b = drawSample(rows, { totalSampleSize: 9, rngSeed: "golden-seed-2" }, "tester");
    if (!a.ok || !b.ok) throw new Error("draw failed");
    expect(b.data.rows.map((r) => r.xrayImageId)).toEqual([
      "بري-S1-C2",
      "بري-S1-C3",
      "بري-S1-N3",
      "بري-S1-N2",
      "بري-S1-N1",
      "بري-S1-N6",
      "Bبحري-S1-C0",
      "Bبحري-S1-N3",
      "Bبحري-S1-N2",
    ]);
    expect(a.data.rows).not.toEqual(b.data.rows);
  });

  it("is stable across repeated invocations with the same seed", () => {
    const a = drawSample(rows, { totalSampleSize: 9, rngSeed: "golden-seed-1" }, "tester");
    const b = drawSample(rows, { totalSampleSize: 9, rngSeed: "golden-seed-1" }, "tester");
    if (!a.ok || !b.ok) throw new Error("draw failed");
    expect({ ...a.data, drawnAt: "" }).toEqual({ ...b.data, drawnAt: "" });
  });

  it("pins a heavily-skewed port split (one port holds a single row)", () => {
    const skewed = [...makeRows("كبير", 4, 6, "1", ""), makeRow("solo", "صغير", "NonCertscan")];
    const result = drawSample(skewed, { totalSampleSize: 9, rngSeed: "spill" }, "tester");
    if (!result.ok) throw new Error("draw failed");
    expect(result.data.rows.map((r) => r.xrayImageId)).toEqual([
      "كبير-S1-C1",
      "كبير-S1-C3",
      "كبير-S1-C0",
      "كبير-S1-N0",
      "كبير-S1-N3",
      "كبير-S1-N1",
      "كبير-S1-N4",
      "كبير-S1-N2",
      "solo",
    ]);
    // Hamilton's largest remainder hands the 1-row port its single seat, so
    // both ports fill exactly and NO spillover round runs here.
    expect(result.data.portAllocations.map((a) => [a.portName, a.allocatedQuota, a.actualTotalDrawn])).toEqual([
      ["كبير", 8, 8],
      ["صغير", 1, 1],
    ]);
  });

  it("SURPRISE: over-asking leaves *Requested counters far above what exists", () => {
    const result = drawSample(rows, { totalSampleSize: 100, rngSeed: "over" }, "tester");
    if (!result.ok) throw new Error("draw failed");
    expect(result.data.totalRequested).toBe(100);
    expect(result.data.totalActual).toBe(20); // the whole population
    // The requested counters are pure apportionment output, never capped by
    // availability: 40 CertScan "requested" against a pool of 8.
    expect(result.data.certScanRequested).toBe(40);
    expect(result.data.nonCertScanRequested).toBe(60);
    expect(result.data.certScanActual).toBe(8);
    expect(result.data.nonCertScanActual).toBe(12);
    // …and no certScanShortfall is recorded for the legacy path, by design.
    expect(result.data.certScanShortfalls).toEqual([]);
  });

  it("pins the two rejection paths", () => {
    expect(drawSample([], { totalSampleSize: 10, rngSeed: "s" }, "u")).toEqual({
      ok: false,
      reason: "لا توجد صفوف مجتمع للسحب منها.",
    });
    expect(drawSample(rows, { totalSampleSize: 0, rngSeed: "s" }, "u")).toEqual({
      ok: false,
      reason: "حجم العينة يجب أن يكون أكبر من صفر.",
    });
  });

  it("pins the null-portName bucket label", () => {
    const result = drawSample(
      [makeRow("x1", null as unknown as string, "NonCertscan")],
      { totalSampleSize: 1, rngSeed: "null-port" },
      "tester"
    );
    if (!result.ok) throw new Error("draw failed");
    expect(result.data.portAllocations[0].portName).toBe("غير محدد");
  });
});

// ---------------------------------------------------------------------------
// Stage path
// ---------------------------------------------------------------------------

describe("drawSample — stage path golden master", () => {
  const rows = [
    ...makeRows("بري", 4, 6, "1", ""),
    ...makeRows("بحري", 2, 4, "1", "B"),
    ...makeRows("بري", 3, 5, "2", ""),
    ...makeRows("بحري", 1, 3, "2", "B"),
    ...makeRows("بري", 2, 2, "3", ""),
  ];

  const rules: StageSamplingRule[] = [
    rule({ stageKey: "first", method: "exact", value: 5, certScanMethod: "percentage", certScanPercentage: 50 }),
    rule({ stageKey: "second", method: "percentage", value: 25, certScanMethod: "exact", certScanExactCount: 2 }),
    rule({ stageKey: "third", method: "exact", value: 3, certScanMethod: "percentage", certScanPercentage: 100 }),
    // "fourth" has no rows at all — the stage is skipped entirely.
    rule({ stageKey: "fourth", method: "exact", value: 4 }),
  ];

  const config = { rngSeed: "golden-stage-1", samplingRules: rules, stageMappings: STAGE_MAPPINGS };

  it("pins the exact drawn ids for the mixed-rule stage draw", () => {
    const result = drawSample(rows, config, "tester");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.rows.map((r) => r.xrayImageId)).toEqual([
      "بري-S1-C1",
      "بري-S1-C3",
      "بري-S1-N4",
      "Bبحري-S1-C1",
      "Bبحري-S1-N0",
      "بري-S2-C2",
      "بري-S2-N4",
      "بري-S2-N0",
      "بري-S2-N1",
      "Bبحري-S2-C0",
      "Bبحري-S2-N0",
      "بري-S3-C0",
      "بري-S3-C1",
      "بري-S3-N0",
      "بري-S3-N1",
    ]);
  });

  it("resolves a `percentage` rule to a ROW COUNT before stage redistribution compares it", () => {
    // Stage 2's rule is `method: "percentage", value: 25` — 25% of its 12
    // available rows = a target of 3. `buildStagePlan` records that RESOLVED
    // row count in plan.configuredValues (not the raw `25`), so
    // `redistributeStageShortfall` compares like with like and sees no
    // shortfall for stage 2 at all.
    //
    // The redistribution that does happen here is genuine: stage 4 is
    // configured for 4 exact rows and has none, so 4 rows of shortfall are
    // spread over the absorbers by configured weight (stage 2 weight 3, stage 3
    // weight 3): stage 2 goes 3 → 6, stage 3 goes 3 → 4 (its whole population,
    // which is all its 1-row spare capacity allows). The remaining 0 evaporate.
    //
    // Before the fix the raw 25 was compared against 12 available rows, so
    // stage 2 was declared 13 rows short and both stages were inflated to their
    // ENTIRE population (stage 2 target 12, stage 3 target 4, totalRequested 21).
    const result = drawSample(rows, config, "tester");
    if (!result.ok) throw new Error("draw failed");

    expect(result.data.stageAllocations).toEqual([
      {
        stageKey: "first",
        stageLabel: "المستوى الأول",
        populationSize: 16,
        targetQuota: 5,
        actualDrawn: 5,
        certScanDrawn: 3,
        nonCertScanDrawn: 2,
      },
      {
        stageKey: "second",
        stageLabel: "المستوى الثاني",
        populationSize: 12,
        targetQuota: 6, // configured 25% of 12 → 3; +3 absorbed from stage 4
        actualDrawn: 6,
        certScanDrawn: 2,
        nonCertScanDrawn: 4,
      },
      {
        stageKey: "third",
        stageLabel: "المستوى الثالث",
        populationSize: 4,
        targetQuota: 4, // configured 3; +1 absorbed (all its spare capacity)
        actualDrawn: 4,
        certScanDrawn: 2,
        nonCertScanDrawn: 2,
      },
    ]);
    expect(result.data.totalRequested).toBe(15);
    expect(result.data.totalActual).toBe(15);
  });

  it("pins the merged port allocations and shortfalls for that draw", () => {
    const result = drawSample(rows, config, "tester");
    if (!result.ok) throw new Error("draw failed");

    expect(result.data.portAllocations).toEqual([
      {
        portName: "بري",
        // Merged across stages: only the stages that actually ran contribute,
        // so populationSize (22) is the sum of this port's per-stage row counts
        // for stages 1-3, not the port's true population.
        populationSize: 22,
        certScanCount: 9,
        nonCertScanCount: 13,
        allocatedQuota: 11,
        certScanQuota: 7,
        nonCertScanQuota: 4,
        actualCertScanDrawn: 5,
        actualNonCertScanDrawn: 6,
        actualTotalDrawn: 11,
      },
      {
        portName: "بحري",
        populationSize: 10,
        certScanCount: 3,
        nonCertScanCount: 7,
        allocatedQuota: 4,
        certScanQuota: 2,
        nonCertScanQuota: 2,
        actualCertScanDrawn: 2,
        actualNonCertScanDrawn: 2,
        actualTotalDrawn: 4,
      },
    ]);

    expect(result.data.certScanShortfalls).toEqual([
      {
        stageKey: "third",
        stageLabel: "المستوى الثالث",
        portName: "بري",
        requestedCertScanQuota: 4,
        actualCertScanDrawn: 2,
        availableCertScanRows: 2,
      },
    ]);

    expect({
      certScanRequested: result.data.certScanRequested,
      nonCertScanRequested: result.data.nonCertScanRequested,
      certScanActual: result.data.certScanActual,
      nonCertScanActual: result.data.nonCertScanActual,
      samplingAlgorithmVersion: result.data.samplingAlgorithmVersion,
      rngSeed: result.data.rngSeed,
    }).toEqual({
      certScanRequested: 9,
      nonCertScanRequested: 6,
      certScanActual: 7,
      nonCertScanActual: 8,
      samplingAlgorithmVersion: "1.1",
      rngSeed: "golden-stage-1",
    });
  });

  it("pins the stage-level CertScan shortfall record for the `exact` method", () => {
    const result = drawSample(
      rows,
      {
        rngSeed: "shortfall",
        samplingRules: [
          rule({
            stageKey: "first",
            method: "exact",
            value: 8,
            certScanMethod: "exact",
            certScanExactCount: 20, // far more CertScan than exists (6)
          }),
        ],
        stageMappings: STAGE_MAPPINGS,
      },
      "tester"
    );
    if (!result.ok) throw new Error("draw failed");
    expect(result.data.certScanShortfalls).toEqual([
      {
        stageKey: "first",
        stageLabel: "المستوى الأول",
        portName: null, // stage-level, not per-port
        requestedCertScanQuota: 20,
        actualCertScanDrawn: 6,
        availableCertScanRows: 6,
      },
    ]);
    expect(result.data.rows.map((r) => r.xrayImageId)).toEqual([
      "بري-S1-C3",
      "بري-S1-C1",
      "بري-S1-C2",
      "بري-S1-C0",
      "بري-S1-N0",
      "Bبحري-S1-C1",
      "Bبحري-S1-C0",
      "Bبحري-S1-N0",
    ]);
    expect(result.data.totalActual).toBe(8);
  });

  it("SURPRISE: spillover pushes a port's actualTotalDrawn ABOVE its own allocatedQuota", () => {
    const result = drawSample(
      rows,
      {
        rngSeed: "pct-shortfall",
        samplingRules: [
          rule({
            stageKey: "first",
            method: "exact",
            value: 12,
            certScanMethod: "percentage",
            certScanPercentage: 100,
          }),
        ],
        stageMappings: STAGE_MAPPINGS,
      },
      "tester"
    );
    if (!result.ok) throw new Error("draw failed");

    // certScanStrategy "mandatory": unfilled CertScan seats are NOT converted
    // into NonCertScan seats inside the port draw, so both ports under-fill and
    // the spillover round tops the stage back up to 12 — reconciling the extra
    // rows into `actual*` but never into `allocatedQuota`/`nonCertScanQuota`.
    expect(result.data.portAllocations).toEqual([
      {
        portName: "بري",
        populationSize: 10,
        certScanCount: 4,
        nonCertScanCount: 6,
        allocatedQuota: 7,
        certScanQuota: 7,
        nonCertScanQuota: 0, // yet 4 NonCertScan rows end up drawn
        actualCertScanDrawn: 4,
        actualNonCertScanDrawn: 4,
        actualTotalDrawn: 8, // > allocatedQuota (7)
      },
      {
        portName: "بحري",
        populationSize: 6,
        certScanCount: 2,
        nonCertScanCount: 4,
        allocatedQuota: 5,
        certScanQuota: 5,
        nonCertScanQuota: 0,
        actualCertScanDrawn: 2,
        actualNonCertScanDrawn: 2,
        actualTotalDrawn: 4, // < allocatedQuota (5)
      },
    ]);
    expect(result.data.certScanShortfalls).toEqual([
      {
        stageKey: "first",
        stageLabel: "المستوى الأول",
        portName: "بري",
        requestedCertScanQuota: 7,
        actualCertScanDrawn: 4,
        availableCertScanRows: 4,
      },
      {
        stageKey: "first",
        stageLabel: "المستوى الأول",
        portName: "بحري",
        requestedCertScanQuota: 5,
        actualCertScanDrawn: 2,
        availableCertScanRows: 2,
      },
    ]);
    expect(result.data.rows.map((r) => r.xrayImageId)).toEqual([
      "بري-S1-C1",
      "بري-S1-C2",
      "بري-S1-C3",
      "بري-S1-C0",
      "Bبحري-S1-C1",
      "Bبحري-S1-C0",
      // spillover tail
      "بري-S1-N1",
      "بري-S1-N4",
      "بري-S1-N3",
      "بري-S1-N2",
      "Bبحري-S1-N3",
      "Bبحري-S1-N1",
    ]);
    expect(result.data.totalActual).toBe(12);
  });

  it("pins the 'preferred' CertScan strategy backfilling inside the port draw", () => {
    const result = drawSample(
      rows,
      {
        rngSeed: "pct-shortfall",
        samplingRules: [
          rule({
            stageKey: "first",
            method: "exact",
            value: 12,
            certScanMethod: "percentage",
            certScanPercentage: 100,
            certScanStrategy: "preferred",
          }),
        ],
        stageMappings: STAGE_MAPPINGS,
      },
      "tester"
    );
    if (!result.ok) throw new Error("draw failed");
    // Same seed as the "mandatory" case above but a different row order and no
    // spillover tail — the backfill happens inside each port draw instead.
    expect(result.data.rows.map((r) => r.xrayImageId)).toEqual([
      "بري-S1-C1",
      "بري-S1-C2",
      "بري-S1-C3",
      "بري-S1-C0",
      "بري-S1-N2",
      "بري-S1-N3",
      "بري-S1-N0",
      "Bبحري-S1-C1",
      "Bبحري-S1-C0",
      "Bبحري-S1-N1",
      "Bبحري-S1-N2",
      "Bبحري-S1-N3",
    ]);
    // The shortfall records are unchanged (detection is strategy-independent),
    // but nonCertScanRequested now reflects the converted seats.
    expect(result.data.nonCertScanRequested).toBe(6);
    expect(result.data.certScanShortfalls).toHaveLength(2);
  });

  it("pins minRequiredCount as a floor, and its inversion when it exceeds availability", () => {
    const floored = drawSample(
      rows,
      {
        rngSeed: "floor",
        samplingRules: [rule({ stageKey: "third", method: "exact", value: 1, minRequiredCount: 3 })],
        stageMappings: STAGE_MAPPINGS,
      },
      "tester"
    );
    if (!floored.ok) throw new Error("draw failed");
    expect(floored.data.totalRequested).toBe(3);
    expect(floored.data.rows.map((r) => r.xrayImageId)).toEqual([
      "بري-S3-N0",
      "بري-S3-N1",
      // SURPRISE: certScanQuota is 0 (0% CertScan) and only 2 NonCertScan rows
      // exist, so the port draw under-fills and the spillover round completes
      // the quota with a CertScan row the rule explicitly asked NOT to draw.
      "بري-S3-C1",
    ]);
    expect(floored.data.certScanRequested).toBe(0);
    expect(floored.data.certScanActual).toBe(1);

    const capped = drawSample(
      rows,
      {
        rngSeed: "floor",
        samplingRules: [rule({ stageKey: "third", method: "exact", value: 1, minRequiredCount: 99 })],
        stageMappings: STAGE_MAPPINGS,
      },
      "tester"
    );
    if (!capped.ok) throw new Error("draw failed");
    // available (4) < minRequiredCount (99) → the target becomes `available`,
    // NOT the configured value of 1. An unmeetable floor takes the whole stage.
    expect(capped.data.totalRequested).toBe(4);
  });

  it("pins the stage-shortfall redistribution across stages 2-4", () => {
    // Stage 2 configured for 20 rows but only 12 exist → 8 short. Stage 3
    // (configured 3, available 4) is the only absorber with spare capacity, and
    // it can absorb 1 — the remaining 7 rows of shortfall simply evaporate.
    const result = drawSample(
      rows,
      {
        rngSeed: "redist",
        samplingRules: [
          rule({ stageKey: "second", method: "exact", value: 20 }),
          rule({ stageKey: "third", method: "exact", value: 3 }),
        ],
        stageMappings: STAGE_MAPPINGS,
      },
      "tester"
    );
    if (!result.ok) throw new Error("draw failed");
    expect(result.data.stageAllocations.map((s) => [s.stageKey, s.targetQuota, s.actualDrawn])).toEqual([
      ["second", 12, 12],
      ["third", 4, 4],
    ]);
    expect(result.data.rows.map((r) => r.xrayImageId)).toEqual([
      "بري-S2-N0",
      "بري-S2-N1",
      "بري-S2-N2",
      "بري-S2-N3",
      "بري-S2-N4",
      "Bبحري-S2-N0",
      "Bبحري-S2-N2",
      "Bبحري-S2-N1",
      "بري-S2-C0",
      "بري-S2-C1",
      "بري-S2-C2",
      "Bبحري-S2-C0",
      "بري-S3-N0",
      "بري-S3-N1",
      "بري-S3-C1",
      "بري-S3-C0",
    ]);
  });

  it("pins the no-stage-matched rejection", () => {
    const unmapped = [makeRow("u1", "بري", "NonCertscan", "بلا-مستوى")];
    const result = drawSample(
      unmapped,
      { rngSeed: "s", samplingRules: rules, stageMappings: STAGE_MAPPINGS },
      "tester"
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("لم يتم العثور على أي صف مطابق");
  });

  it("SURPRISE: a stage config whose targets all resolve to 0 succeeds with an EMPTY sample", () => {
    // Unlike the legacy path (which rejects totalSampleSize <= 0), the stage
    // path returns ok:true with zero rows — a caller that only checks `ok`
    // would persist an empty sample.master.json.
    const result = drawSample(
      rows,
      {
        rngSeed: "zero",
        samplingRules: [rule({ stageKey: "first", method: "exact", value: 0 })],
        stageMappings: STAGE_MAPPINGS,
      },
      "tester"
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({
      totalRequested: 0,
      totalActual: 0,
      rows: [],
      stageAllocations: [],
      portAllocations: [],
      certScanShortfalls: [],
    });
  });

  it("is stable across repeated invocations with the same seed", () => {
    const a = drawSample(rows, config, "tester");
    const b = drawSample(rows, config, "tester");
    if (!a.ok || !b.ok) throw new Error("draw failed");
    expect({ ...a.data, drawnAt: "" }).toEqual({ ...b.data, drawnAt: "" });
  });
});
