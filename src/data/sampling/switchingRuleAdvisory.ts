/**
 * Switching-rule advisory (B4) — the I/O half of the ISO 2859-1 / Z1.4 switching
 * signal. At draw time we read the PRIOR month's population and compute its
 * suspicion rate (share of rows whose `xrayLevelTwoResult` is a suspicion), then
 * map that to an advisory inspection recommendation.
 *
 * ADVISORY ONLY: this never changes a quota. It surfaces the prior-lot outcome so
 * the authority can decide whether to tighten review. When there is no prior month
 * (or it has no population rows) every field is `null` and the UI shows nothing.
 *
 * The pure computation (`computeSuspicionRate` / `recommendationFromRate`) lives in
 * `samplingPlanStorage.ts`; this module only does the folder lookup + load.
 */

import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import type { PreparedPopulationRow } from "../population/populationTypes";
import { listMonthFolders, loadMonthPopulationFinal } from "../population/populationStorage";
import { parseMonthFolderName } from "../population/monthFolder";
import {
  computeSuspicionRate,
  recommendationFromRate,
  type SamplingPlanPriorMonthAdvisory,
} from "./samplingPlanStorage";

/** Chronological ordinal for a month/year — used to pick the latest prior month. */
function monthOrdinal(month: number, year: number): number {
  return year * 12 + (month - 1);
}

/**
 * Find the month folder chronologically immediately before `currentMonthFolderName`
 * that actually exists on disk. Returns null when the current name is unparseable or
 * there is no earlier month. Robust to gaps (a missing month is skipped — the most
 * recent existing earlier month wins), matching a real deployment's irregular cadence.
 */
export async function findPriorMonthFolder(
  directoryHandle: DirectoryHandleLike,
  currentMonthFolderName: string
): Promise<string | null> {
  const current = parseMonthFolderName(currentMonthFolderName);
  if (!current) return null;
  const currentOrd = monthOrdinal(current.month, current.year);

  const months = await listMonthFolders(directoryHandle);
  let best: { folderName: string; ord: number } | null = null;
  for (const m of months) {
    const ord = monthOrdinal(m.month, m.year);
    if (ord >= currentOrd) continue;
    if (!best || ord > best.ord) best = { folderName: m.folderName, ord };
  }
  return best?.folderName ?? null;
}

/**
 * Compute the B4 prior-month advisory for the month about to be drawn. Best-effort:
 * any load failure yields the all-null advisory (never blocks a draw). The result is
 * safe to fold into a {@link SamplingPlan} and to surface in the Phase 3 UI.
 */
export async function loadPriorMonthAdvisory(
  directoryHandle: DirectoryHandleLike,
  currentMonthFolderName: string
): Promise<SamplingPlanPriorMonthAdvisory> {
  const none: SamplingPlanPriorMonthAdvisory = {
    priorMonthFolderName: null,
    priorMonthSuspicionRate: null,
    inspectionRecommendation: null,
  };
  try {
    const priorMonthFolderName = await findPriorMonthFolder(directoryHandle, currentMonthFolderName);
    if (!priorMonthFolderName) return none;

    const priorPopulation = await loadMonthPopulationFinal(directoryHandle, priorMonthFolderName);
    const rows = (priorPopulation?.rows ?? []) as unknown as PreparedPopulationRow[];
    const rate = computeSuspicionRate(rows);
    if (rate === null) {
      // Prior month folder exists but has no population rows — no signal to report.
      return none;
    }
    return {
      priorMonthFolderName,
      priorMonthSuspicionRate: rate,
      inspectionRecommendation: recommendationFromRate(rate),
    };
  } catch {
    return none;
  }
}
