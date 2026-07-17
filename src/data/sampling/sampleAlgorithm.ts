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
 */
export const SAMPLING_ALGORITHM_VERSION = "1.0";

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
    return { ok: false, reason: "لا توجد صفوف مجتمع للسحب منها." };
  }
  return "totalSampleSize" in config
    ? drawLegacySample(rows, config, username, SAMPLING_ALGORITHM_VERSION)
    : drawStageSample(rows, config, username, SAMPLING_ALGORITHM_VERSION);
}
