/**
 * Sampling plan record (A1) — the documented "why N, against what limit" that an
 * auditor needs alongside the raw draw. Persisted at draw time as
 * `sampling.plan.json` next to `sample.master.json`, it captures:
 *   - the lot definition (month, ports, per-stage split),
 *   - the target sample fraction and an advisory quality/inspection-level note,
 *   - the risk-basis narrative (share of `targetedByRiskEngine` rows), and
 *   - the seed + algorithm version the draw binds to.
 *
 * The plan is purely additive: it never gates a draw and reads of the sample
 * master are unaffected by its presence or absence. Legacy months simply have no
 * `sampling.plan.json`.
 */

import type { PreparedPopulationRow } from "../population/populationTypes";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeReadJson, safeWriteJson } from "../storage/safeWrite";
import { ensureMonthWritable } from "../population/monthLock";
import { getSampleMainDir } from "../workspace/workspacePaths";
import type { SampleMasterData } from "./sampleTypes";

const SAMPLING_PLAN_FILE = "sampling.plan.json";

/** Internal document-schema marker (independent of the JsonEnvelope schemaVersion). */
export const SAMPLING_PLAN_SCHEMA = 1 as const;

export type SamplingPlanStageSplit = {
  stageKey: "first" | "second" | "third" | "fourth";
  stageLabel: string;
  populationSize: number;
  targetQuota: number;
  actualDrawn: number;
};

export type SamplingPlanLot = {
  monthFolderName: string;
  populationSize: number;
  /** Distinct ports present in the population, sorted for a stable record. */
  ports: string[];
  stageSplit: SamplingPlanStageSplit[];
};

export type SamplingPlanRiskBasis = {
  populationTargeted: number;
  /** Share (0..1) of population rows flagged by the risk engine. */
  populationTargetedShare: number;
  sampleTargeted: number;
  /** Share (0..1) of drawn rows flagged by the risk engine. */
  sampleTargetedShare: number;
};

/**
 * ISO 2859-1 / Z1.4-style switching-rule recommendation (B4). ADVISORY ONLY —
 * the system never auto-changes a quota; it records the prior-lot signal and the
 * recommendation so the authority can decide. `null` when there is no prior
 * month/answers to derive a rate from.
 */
export type InspectionRecommendation = "normal" | "tightened-review";

/**
 * Prior-month suspicion signal folded into the plan (B4). All fields are `null`
 * together when no prior month population exists.
 */
export type SamplingPlanPriorMonthAdvisory = {
  priorMonthFolderName: string | null;
  /** Share (0..1) of the prior month's rows whose `xrayLevelTwoResult` is a suspicion. */
  priorMonthSuspicionRate: number | null;
  inspectionRecommendation: InspectionRecommendation | null;
};

/**
 * Suspicion-rate threshold (B4): a prior-month rate strictly greater than 5 %
 * recommends tightened review for the next lot. Documented switching signal, not
 * an automatic quota change.
 */
export const SUSPICION_TIGHTEN_THRESHOLD = 0.05;

/** True when a level-two result string reads as an affirmative "suspicion". */
function isSuspicion(value: string | null | undefined): boolean {
  if (value == null) return false;
  const v = value.trim();
  return v === "اشتباه" || v === "مشتبه";
}

/**
 * Prior-month suspicion rate (B4) — share (0..1) of rows whose `xrayLevelTwoResult`
 * is a suspicion. Mirrors how the executive model aggregates the level-two result.
 * Returns `null` for an empty row set (no signal to report).
 */
export function computeSuspicionRate(
  rows: Array<Pick<PreparedPopulationRow, "xrayLevelTwoResult">>
): number | null {
  if (rows.length === 0) return null;
  let suspicious = 0;
  for (const row of rows) {
    if (isSuspicion(row.xrayLevelTwoResult)) suspicious += 1;
  }
  return suspicious / rows.length;
}

/**
 * Map a prior-month suspicion rate to a switching recommendation (B4). Advisory:
 * a rate over {@link SUSPICION_TIGHTEN_THRESHOLD} → tightened review, else normal.
 * `null` rate (no prior data) → `null` recommendation (show nothing).
 */
export function recommendationFromRate(
  rate: number | null
): InspectionRecommendation | null {
  if (rate === null) return null;
  return rate > SUSPICION_TIGHTEN_THRESHOLD ? "tightened-review" : "normal";
}

export type SamplingPlan = {
  schema: typeof SAMPLING_PLAN_SCHEMA;
  monthFolderName: string;
  createdAt: string;
  createdBy: string;
  /** Seed the draw bound to — mirrors SampleMasterData.rngSeed. */
  rngSeed: string;
  /** Algorithm version the draw bound to (A2) — mirrors SampleMasterData.samplingAlgorithmVersion. */
  samplingAlgorithmVersion: string;
  lot: SamplingPlanLot;
  totalRequested: number;
  totalActual: number;
  /** totalActual / populationSize (0..1); 0 when the population is empty. */
  targetSampleFraction: number;
  /** Advisory Arabic note — the acceptance-criteria rationale (no AQL configured; see A8/B4). */
  qualityThresholdNote: string;
  /** Advisory Arabic note — inspection level per ISO 2859-1 framing. */
  inspectionLevelNote: string;
  riskBasis: SamplingPlanRiskBasis;
  /**
   * Switching-rule advisory (B4). Absent on legacy plans written before B4 —
   * readers must treat a missing field as "no advisory recorded".
   */
  priorMonthAdvisory?: SamplingPlanPriorMonthAdvisory;
};

const DEFAULT_QUALITY_THRESHOLD_NOTE =
  "خطة عينة موثّقة: تم السحب بمعاينة عشوائية طبقية بدون حد جودة مقبول (AQL) مُهيأ. " +
  "معدل الاشتباه للشهر السابق وتوصية التشديد يُسجَّلان لاحقًا كإشارة استشارية.";

const DEFAULT_INSPECTION_LEVEL_NOTE =
  "مستوى الفحص: معاينة عامة طبقية حسب الميناء والمستوى (إطار ISO 2859-1). النسبة المستهدفة استرشادية وليست ملزمة.";

/** True when the risk-engine flag reads as an affirmative "targeted" value. */
function isRiskTargeted(value: string | null): boolean {
  if (value == null) return false;
  const v = value.trim().toLowerCase();
  if (v === "") return false;
  return v === "نعم" || v === "yes" || v === "true" || v === "1" || v === "y";
}

function countTargeted(rows: PreparedPopulationRow[]): number {
  let n = 0;
  for (const row of rows) {
    if (isRiskTargeted(row.targetedByRiskEngine)) n += 1;
  }
  return n;
}

function share(part: number, whole: number): number {
  return whole > 0 ? part / whole : 0;
}

/**
 * Build a sampling plan from the population rows the draw ran over and the
 * resulting sample master. Pure — no I/O, so it is trivially unit-testable and
 * safe to call before the on-disk save.
 */
export function buildSamplingPlan(params: {
  monthFolderName: string;
  populationRows: PreparedPopulationRow[];
  sampleData: SampleMasterData;
  createdBy: string;
  createdAt?: string;
  qualityThresholdNote?: string;
  inspectionLevelNote?: string;
  /** B4 switching-rule advisory folded into the plan. Omit when no prior month. */
  priorMonthAdvisory?: SamplingPlanPriorMonthAdvisory;
}): SamplingPlan {
  const { monthFolderName, populationRows, sampleData, createdBy } = params;
  const populationSize = populationRows.length;

  const ports = Array.from(
    new Set(populationRows.map((r) => r.portName ?? "غير محدد"))
  ).sort((a, b) => a.localeCompare(b));

  const stageSplit: SamplingPlanStageSplit[] = sampleData.stageAllocations.map((s) => ({
    stageKey: s.stageKey,
    stageLabel: s.stageLabel,
    populationSize: s.populationSize,
    targetQuota: s.targetQuota,
    actualDrawn: s.actualDrawn,
  }));

  const populationTargeted = countTargeted(populationRows);
  const sampleTargeted = countTargeted(sampleData.rows);

  return {
    schema: SAMPLING_PLAN_SCHEMA,
    monthFolderName,
    createdAt: params.createdAt ?? new Date().toISOString(),
    createdBy,
    rngSeed: sampleData.rngSeed,
    samplingAlgorithmVersion: sampleData.samplingAlgorithmVersion ?? "unknown",
    lot: {
      monthFolderName,
      populationSize,
      ports,
      stageSplit,
    },
    totalRequested: sampleData.totalRequested,
    totalActual: sampleData.totalActual,
    targetSampleFraction: share(sampleData.totalActual, populationSize),
    qualityThresholdNote: params.qualityThresholdNote ?? DEFAULT_QUALITY_THRESHOLD_NOTE,
    inspectionLevelNote: params.inspectionLevelNote ?? DEFAULT_INSPECTION_LEVEL_NOTE,
    riskBasis: {
      populationTargeted,
      populationTargetedShare: share(populationTargeted, populationSize),
      sampleTargeted,
      sampleTargetedShare: share(sampleTargeted, sampleData.totalActual),
    },
    ...(params.priorMonthAdvisory
      ? { priorMonthAdvisory: params.priorMonthAdvisory }
      : {}),
  };
}

/** Persist the sampling plan next to sample.master.json. Best-effort by contract. */
export async function saveSamplingPlan(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  plan: SamplingPlan
): Promise<{ ok: true } | { ok: false; error: string }> {
  // Month lock gate — rejects with MonthClosedError when the month is closed.
  await ensureMonthWritable(directoryHandle, monthFolderName);
  try {
    const sampleDir = await getSampleMainDir(directoryHandle, monthFolderName, true);
    await safeWriteJson(sampleDir, SAMPLING_PLAN_FILE, plan);
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, error: msg };
  }
}

/** Load the sampling plan for a month, or null when absent (legacy months). */
export async function loadSamplingPlan(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<SamplingPlan | null> {
  try {
    const sampleDir = await getSampleMainDir(directoryHandle, monthFolderName, false);
    const result = await safeReadJson<SamplingPlan>(sampleDir, SAMPLING_PLAN_FILE);
    return result.ok ? result.value : null;
  } catch {
    return null;
  }
}
