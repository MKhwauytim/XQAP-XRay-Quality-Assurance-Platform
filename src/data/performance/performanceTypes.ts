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

export type EmployeeMonthlyBaseline = {
  employee: string;
  month: string; // YYYY-MM
  /** Median within-day gap duration across the month, or null when fewer than MIN_GAP_SAMPLES_FOR_BASELINE gaps exist. */
  medianGapMs: number | null;
  sampleCount: number;
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
  smallExtraMs: 5 * 60 * 1000,
  mediumExtraMs: 20 * 60 * 1000,
  largeExtraMs: 60 * 60 * 1000,
} as const;

/** Below this many within-day gaps in a calendar month, the median baseline is unreliable — report null, not a noisy value. */
export const MIN_GAP_SAMPLES_FOR_BASELINE = 5;

/**
 * A recorded session span longer than this is implausible for a single
 * shift and is excluded from sign-in-anchor selection and aggregation — the
 * read-time guard against the pre-Task-1-fix stale-signedInAt bug's
 * historical data. Never rewrites the source entries.
 */
export const IMPLAUSIBLE_SESSION_SPAN_MS = 16 * 60 * 60 * 1000;
