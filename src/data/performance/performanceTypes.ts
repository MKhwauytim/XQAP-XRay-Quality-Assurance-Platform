/**
 * Shared types for the employee performance-evaluation feature (تقييم الأداء).
 *
 * Timing/pace only — deliberately excludes the accuracy/quality model in
 * `src/data/reporting/executive/executiveEmployeeData.ts`, which stays
 * scoped to the offline executive report. See
 * docs/superpowers/specs/2026-08-27-employee-performance-evaluation-design.md.
 */

export type GapTier = "normal" | "small" | "medium" | "large" | "unclassified";

/** One idle interval: sign-in → first finish, or finish → next finish, for one employee on one day. */
export type GapEvent = {
  employee: string;
  day: string; // YYYY-MM-DD
  startAt: string; // ISO
  endAt: string; // ISO
  durationMs: number;
  tier: GapTier;
};

/** One employee's summary for one calendar day. */
export type DailyPerformance = {
  employee: string;
  day: string; // YYYY-MM-DD
  samplesFinished: number;
  signInAt: string | null;
  lastFinishAt: string | null;
  /** (lastFinishAt - signInAt), or null when either endpoint is missing. Never 0 for a no-data day. */
  effectiveTimeMs: number | null;
  gaps: GapEvent[];
};

export type PerformanceScopeFilter = {
  /** A username, or "" for every employee. */
  employee: string;
  /** Inclusive YYYY-MM-DD bounds; "" disables that end. */
  from: string;
  to: string;
};

export type PerformanceSummary = {
  totalSamples: number;
  totalEffectiveMs: number | null;
  gapCountsByTier: Record<GapTier, number>;
  medianGapMs: number | null;
};

/** Gap tiers, relative to the employee's own monthly median gap ("avg" in the design doc). */
export const GAP_TIER_THRESHOLDS_MS = {
  normalMaxExtraMs: 5 * 60 * 1000,
  smallMaxExtraMs: 20 * 60 * 1000,
  mediumMaxExtraMs: 60 * 60 * 1000,
} as const;

/** Below this many within-day gaps in a calendar month, the median baseline is unreliable — report null, not a noisy value. */
export const MIN_GAP_SAMPLES_FOR_BASELINE = 5;

/**
 * Employee-comparison status derivation (`أعلى/ضمن/أدنى من المعدل`), driven
 * purely by an employee's samples relative to the team average for the same
 * scope — no metric beyond what the existing aggregates already expose.
 */
export const STATUS_ABOVE_AVERAGE_RATIO = 1.15;
export const STATUS_BELOW_AVERAGE_RATIO = 0.85;
/** At or above this many "large" gaps in scope, the status escalates regardless of the samples ratio. */
export const FREQUENT_LARGE_GAPS_MIN_COUNT = 3;

export type EmployeeStatusKind = "above" | "within" | "below";

/** One row of the per-employee comparison table — the تقييم الأداء centerpiece. */
export type EmployeeComparisonRow = {
  username: string;
  displayName: string;
  /** 1-based rank by samples, descending. */
  rank: number;
  samples: number;
  effectiveMs: number | null;
  /** This employee's own median gap over the current scope (distinct from the per-month tiering baseline). */
  paceMs: number | null;
  gapCounts: Record<GapTier, number>;
  totalGaps: number;
  /** Rounded percentage of totalGaps in each tier; may not sum to 100 when unclassified gaps are present. */
  gapPercents: Record<GapTier, number>;
  /** Latest day this employee has any recorded activity in scope, or null. */
  lastActiveDay: string | null;
  statusKind: EmployeeStatusKind;
  hasFrequentLargeGaps: boolean;
};

export type EmployeeComparisonSummary = {
  /** Sorted by samples, descending. */
  rows: EmployeeComparisonRow[];
  teamAvgSamples: number;
  /** Median of the individual employees' own pace (paceMs), not a median over all gaps pooled together. */
  teamMedianPaceMs: number | null;
};

/** The working-hours strip chart plots gaps against the actual shift window, not the full 24h day. */
export const SHIFT_START_MINUTE = 7 * 60 + 30;
export const SHIFT_END_MINUTE = 17 * 60 + 30;

/**
 * A recorded session span longer than this is implausible for a single
 * shift and is excluded from sign-in-anchor selection and aggregation — the
 * read-time guard against the pre-Task-1-fix stale-signedInAt bug's
 * historical data. Never rewrites the source entries.
 */
export const IMPLAUSIBLE_SESSION_SPAN_MS = 16 * 60 * 60 * 1000;
