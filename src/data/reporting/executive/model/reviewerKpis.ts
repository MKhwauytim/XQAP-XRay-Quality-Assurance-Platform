import type { DecisionRecord } from "./decisionFactTable";

/**
 * Per-reviewer KPI upgrade (Tier-2, TEAM_REVIEW_2026-07-05) + SPC p-charts
 * (research brief gap #18). PURE math over the decision fact table — no DOM, no
 * React, no storage. Renderers display; they never recompute.
 *
 * A "reviewer" here is the app user who studied the sample (`reviewerId` =
 * `assignedTo`), NOT the L1/L2 inspector. Every metric is workload/behaviour
 * context for the reviewer, never inspector accuracy (§3.4 honesty discipline).
 *
 * The fact table carries TWO records per case (L1 + L2), and all reviewer-level
 * fields (reviewerId, timestamps, studyReviewResult, reviewCompleted) are
 * row-level — identical across a case's two records. So we first collapse the
 * table to ONE entry per `xrayImageId` before any reviewer/port aggregation.
 *
 * Honesty discipline: every rate is `number | null`; a `null` (zero) denominator
 * yields `null` (renders `—`), never `0%`.
 */

/** Minimum subgroup size below which a p-chart point is flagged low-n and
 *  excluded from out-of-control signalling (too few cases to trust the limits). */
export const P_CHART_MIN_N = 5;

/** Value marking the reviewer's own review verdict as suspicious. */
const SUSPICION = "اشتباه";

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function pct(num: number, den: number): number | null {
  return den > 0 ? (num / den) * 100 : null;
}

/**
 * R-7 (Excel `PERCENTILE.INC`) linear-interpolation percentile over an
 * ascending-sorted array. `q` in [0,1]. Returns `null` for an empty array.
 */
export function percentile(sortedAsc: number[], q: number): number | null {
  const n = sortedAsc.length;
  if (n === 0) return null;
  if (n === 1) return sortedAsc[0]!;
  const rank = q * (n - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sortedAsc[lo]!;
  const frac = rank - lo;
  return sortedAsc[lo]! + frac * (sortedAsc[hi]! - sortedAsc[lo]!);
}

// ── p-chart ─────────────────────────────────────────────────────────────────

export type PChartGroup = {
  key: string;
  /** Subgroup size (denominator). Always > 0 for emitted groups. */
  n: number;
  /** Successes (numerator): suspicious-or-referral cases. */
  x: number;
  /** Proportion p_i = x/n, in [0,1]. */
  p: number;
  /** Pooled centre line p̄ (same for every group), in [0,1]. */
  center: number;
  /** Upper control limit p̄ + 3·√(p̄(1−p̄)/n), clamped to [0,1]. */
  ucl: number;
  /** Lower control limit p̄ − 3·√(p̄(1−p̄)/n), clamped to [0,1]. */
  lcl: number;
  /** `true` when p_i is outside [lcl,ucl] AND the group is not low-n. */
  outOfControl: boolean;
  /** `true` when n < `minN` — limits are unreliable, signalling suppressed. */
  lowN: boolean;
};

export type PChart = {
  /** Pooled centre line p̄ (Σx/Σn), in [0,1]; `null` when there is no data. */
  center: number | null;
  /** The low-n threshold used. */
  minN: number;
  /** Per-group control-chart points, in input order (n=0 groups dropped). */
  groups: PChartGroup[];
};

/**
 * Build a proportion control chart (p-chart) from per-group (n, x) counts.
 * Pooled centre line p̄ = Σx/Σn; per-group 3σ limits use the group's own n
 * (variable-limit p-chart). Groups with n=0 are dropped (no proportion to
 * plot); groups with n < `minN` are flagged low-n and never signalled OOC.
 */
export function buildPChart(
  raw: Array<{ key: string; n: number; x: number }>,
  minN: number = P_CHART_MIN_N
): PChart {
  const groups = raw.filter((g) => g.n > 0);
  const sumN = groups.reduce((a, g) => a + g.n, 0);
  const sumX = groups.reduce((a, g) => a + g.x, 0);
  if (sumN === 0) return { center: null, minN, groups: [] };
  const center = sumX / sumN;
  const built = groups.map((g): PChartGroup => {
    const p = g.x / g.n;
    const se = Math.sqrt((center * (1 - center)) / g.n);
    const ucl = clamp01(center + 3 * se);
    const lcl = clamp01(center - 3 * se);
    const lowN = g.n < minN;
    const outOfControl = !lowN && (p > ucl || p < lcl);
    return { key: g.key, n: g.n, x: g.x, p, center, ucl, lcl, outOfControl, lowN };
  });
  return { center, minN, groups: built };
}

// ── reviewer KPIs ─────────────────────────────────────────────────────────────

/** Referral signal for the reviewer KPIs, derived from the month's answer files.
 *  Kept storage-agnostic so the math stays pure and unit-testable. */
export type ReviewerReferralInput = {
  /** referral-request count keyed by requesting reviewer (username). */
  requestCountByReviewer: Map<string, number>;
  /** every xrayImageId that appears in a referral request this month. */
  referredImageIds: Set<string>;
};

export type ReviewerKpiRow = {
  reviewerId: string;
  /** Distinct cases assigned to the reviewer. */
  assigned: number;
  /** Distinct cases the reviewer submitted (reviewCompleted). */
  completed: number;
  /** completed / assigned, percent. */
  completionRate: number | null;
  /** Expected completions (daily quota × active days), when supplied. */
  quota: number | null;
  /** completed / quota, percent — only when quota data exists. */
  throughputVsQuota: number | null;
  /** Median turnaround hours (assignedAt→submittedAt), completed cases only. */
  turnaroundMedianHours: number | null;
  /** 90th-percentile turnaround hours — the slow tail. */
  turnaroundP90Hours: number | null;
  /** Completed cases carrying a review verdict (p-chart denominator). */
  reviewedWithVerdict: number;
  /** Of those, cases the reviewer flagged suspicious OR referred (numerator). */
  suspiciousOrReferral: number;
  /** suspiciousOrReferral / reviewedWithVerdict, percent (matches the p-chart dot). */
  suspicionOrReferralRate: number | null;
  /** Referral requests raised by the reviewer. */
  referralCount: number;
  /** referralCount / completed, percent. */
  referralRate: number | null;
};

export type ReviewerKpiModel = {
  rows: ReviewerKpiRow[];
  /** p-chart of suspicion-or-referral rate per reviewer. */
  reviewerPChart: PChart;
  /** p-chart of suspicion-or-referral rate per port. */
  portPChart: PChart;
};

/** One collapsed case (fact-table rows folded by xrayImageId). */
type CaseEntry = {
  xrayImageId: string;
  reviewerId: string | null;
  portName: string;
  reviewCompleted: boolean;
  studyReviewResult: DecisionRecord["studyReviewResult"];
  assignedAt: string | null;
  completedAt: string | null;
};

const PORT_FALLBACK = "غير محدد";

/** Collapse the two-per-case fact table into one entry per xrayImageId. */
function collapseCases(records: DecisionRecord[]): CaseEntry[] {
  const byId = new Map<string, CaseEntry>();
  for (const r of records) {
    if (byId.has(r.xrayImageId)) continue;
    byId.set(r.xrayImageId, {
      xrayImageId: r.xrayImageId,
      reviewerId: r.reviewerId,
      portName: r.portName ?? PORT_FALLBACK,
      reviewCompleted: r.reviewCompleted,
      studyReviewResult: r.studyReviewResult,
      assignedAt: r.assignedAt,
      completedAt: r.completedAt,
    });
  }
  return [...byId.values()];
}

/** Turnaround hours for a completed case, or null when unusable. */
function turnaroundHours(entry: CaseEntry): number | null {
  if (!entry.reviewCompleted || !entry.assignedAt || !entry.completedAt) return null;
  const a = Date.parse(entry.assignedAt);
  const c = Date.parse(entry.completedAt);
  if (Number.isNaN(a) || Number.isNaN(c)) return null;
  const hours = (c - a) / 3_600_000;
  return hours >= 0 ? hours : null;
}

const EMPTY_REFERRAL: ReviewerReferralInput = {
  requestCountByReviewer: new Map(),
  referredImageIds: new Set(),
};

/**
 * Build the full per-reviewer KPI model + both p-charts from the decision fact
 * table. `referral` folds in the month's referral requests (optional); `quota`
 * supplies expected completions per reviewer for the throughput-vs-quota column
 * (optional — left `null` when the deployment has no quota data).
 */
export function buildReviewerKpis(
  records: DecisionRecord[],
  referral: ReviewerReferralInput = EMPTY_REFERRAL,
  quotaByReviewer?: Map<string, number>,
  minN: number = P_CHART_MIN_N
): ReviewerKpiModel {
  const cases = collapseCases(records);
  const referred = referral.referredImageIds;

  // Per-reviewer aggregation.
  const byReviewer = new Map<string, CaseEntry[]>();
  for (const c of cases) {
    if (c.reviewerId === null) continue;
    const list = byReviewer.get(c.reviewerId) ?? [];
    list.push(c);
    byReviewer.set(c.reviewerId, list);
  }

  const rows: ReviewerKpiRow[] = [];
  const reviewerPChartRaw: Array<{ key: string; n: number; x: number }> = [];

  for (const [reviewerId, list] of byReviewer) {
    const assigned = list.length;
    const completedCases = list.filter((c) => c.reviewCompleted);
    const completed = completedCases.length;

    const turnarounds = completedCases
      .map(turnaroundHours)
      .filter((h): h is number => h !== null)
      .sort((a, b) => a - b);

    const withVerdict = completedCases.filter((c) => c.studyReviewResult !== null);
    const reviewedWithVerdict = withVerdict.length;
    const suspiciousOrReferral = withVerdict.filter(
      (c) => c.studyReviewResult === SUSPICION || referred.has(c.xrayImageId)
    ).length;

    const referralCount = referral.requestCountByReviewer.get(reviewerId) ?? 0;
    const quota = quotaByReviewer?.get(reviewerId) ?? null;

    rows.push({
      reviewerId,
      assigned,
      completed,
      completionRate: pct(completed, assigned),
      quota,
      throughputVsQuota: quota !== null && quota > 0 ? (completed / quota) * 100 : null,
      turnaroundMedianHours: percentile(turnarounds, 0.5),
      turnaroundP90Hours: percentile(turnarounds, 0.9),
      reviewedWithVerdict,
      suspiciousOrReferral,
      suspicionOrReferralRate: pct(suspiciousOrReferral, reviewedWithVerdict),
      referralCount,
      referralRate: pct(referralCount, completed),
    });

    reviewerPChartRaw.push({ key: reviewerId, n: reviewedWithVerdict, x: suspiciousOrReferral });
  }

  rows.sort((a, b) => b.assigned - a.assigned || a.reviewerId.localeCompare(b.reviewerId, "ar"));

  // Per-port aggregation (all reviewed-with-verdict cases, any reviewer).
  const byPort = new Map<string, { n: number; x: number }>();
  for (const c of cases) {
    if (!c.reviewCompleted || c.studyReviewResult === null) continue;
    const g = byPort.get(c.portName) ?? { n: 0, x: 0 };
    g.n += 1;
    if (c.studyReviewResult === SUSPICION || referred.has(c.xrayImageId)) g.x += 1;
    byPort.set(c.portName, g);
  }
  const portPChartRaw = [...byPort.entries()]
    .map(([key, g]) => ({ key, n: g.n, x: g.x }))
    .sort((a, b) => b.n - a.n || a.key.localeCompare(b.key, "ar"));

  return {
    rows,
    reviewerPChart: buildPChart(reviewerPChartRaw, minN),
    portPChart: buildPChart(portPChartRaw, minN),
  };
}
