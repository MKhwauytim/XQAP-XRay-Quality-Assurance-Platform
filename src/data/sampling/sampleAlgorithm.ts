import type { PreparedPopulationRow } from "../population/populationTypes";
import type { StageAliasMappings, StageSamplingRule } from "../population/populationConfig";
import type { SampleConfig, SampleDrawResult } from "./sampleTypes";
import { drawLegacySample, drawStageSample } from "./sampleAlgorithmInternals";

/**
 * Reproducibility pin (A2). Bound to the RNG seed so a historical draw can be
 * recognised as replayable only under the code version that produced it.
 *
 * RULE: bump this constant on ANY semantic change to `drawSample` (apportionment,
 * split, draw order, spillover, stage redistribution). A pure refactor that
 * provably preserves the exact drawn set for every seed does NOT bump it.
 *
 * "1.2" (2026-08-19): the `percentage` CertScan target is now rounded ONCE at
 * the stage level and Hamilton-apportioned across the ports by each port's
 * CertScan pool, matching what the `exact` method has always done. Under "1.1"
 * the percentage was multiplied and rounded against every port's own allocated
 * quota, so the rounding ran once per port and always broke upward at .5 — ten
 * ports each allocated one seat at a configured 50% each rounded 0.5 up to 1 and
 * the stage drew 100% CertScan instead of 50%. A "1.1" stage draw that used any
 * percentage-method CertScan rule is therefore NOT replayable under this
 * version. Historical months keep their recorded rows and their own version
 * stamp; nothing is re-drawn.
 *
 * "1.1" (2026-08-15): stage-shortfall redistribution now resolves a
 * `percentage`-method stage rule to a row count before comparing it against
 * the stage's available rows. Under "1.0" the raw percentage (e.g. 25) was
 * compared against the row count, inventing a phantom shortfall that inflated
 * every redistributable stage's target — so a "1.0" stage draw that used any
 * percentage-method rule is NOT replayable under this version.
 */
export const SAMPLING_ALGORITHM_VERSION = "1.2";

type StageConfig = {
  rngSeed: string;
  samplingRules: StageSamplingRule[];
  stageMappings?: StageAliasMappings;
};

export function drawSample(
  rows: PreparedPopulationRow[],
  config: SampleConfig | StageConfig,
  username: string
): SampleDrawResult {
  if (rows.length === 0) {
    // XQ-SMP-001. Left uncoded on purpose: this exact string is pinned by
    // sampleAlgorithm.golden.test.ts ("pins the two rejection paths").
    return { ok: false, reason: "لا توجد صفوف مجتمع للسحب منها." };
  }
  return "totalSampleSize" in config
    ? drawLegacySample(rows, config, username, SAMPLING_ALGORITHM_VERSION)
    : drawStageSample(rows, config, username, SAMPLING_ALGORITHM_VERSION);
}
