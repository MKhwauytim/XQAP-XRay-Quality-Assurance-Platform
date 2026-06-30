import type { DataSufficiencyThresholds } from "../../executiveReportTypes";
import { DEFAULT_DATA_SUFFICIENCY_THRESHOLDS } from "../../executiveReportTypes";

/**
 * Four-band data-sufficiency rule (design spec §3.2 / blueprint §1.4), applied to
 * any unit (employee, port, stage) by its evaluable-decision count:
 *
 * | Evaluable | Band         | Rule                                |
 * |-----------|--------------|-------------------------------------|
 * | 0         | none         | show `—`, never `0%`; never ranked  |
 * | 1–9       | insufficient | never top/bottom ranked; flagged    |
 * | 10–19     | limited      | shown with caveat                   |
 * | 20+       | sufficient   | ranked normally                     |
 *
 * Thresholds are config-overridable; final values need management approval.
 */
export type DataSufficiencyBand = "none" | "insufficient" | "limited" | "sufficient";

/**
 * Map an evaluable-decision count to its band. Defaults to the spec thresholds
 * (insufficient 1–9, limited 10–19, sufficient 20+) when none are supplied.
 */
export function band(
  evaluableCount: number,
  thresholds: DataSufficiencyThresholds = DEFAULT_DATA_SUFFICIENCY_THRESHOLDS
): DataSufficiencyBand {
  const n = Math.max(0, Math.floor(evaluableCount));
  if (n >= thresholds.sufficient) return "sufficient";
  if (n >= thresholds.limited) return "limited";
  if (n >= thresholds.insufficient) return "insufficient";
  return "none";
}

/** Whether a unit may be ranked top/bottom (only `limited` and `sufficient`). */
export function isRankable(unitBand: DataSufficiencyBand): boolean {
  return unitBand === "limited" || unitBand === "sufficient";
}
