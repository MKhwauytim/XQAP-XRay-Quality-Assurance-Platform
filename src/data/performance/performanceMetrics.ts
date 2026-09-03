/**
 * Pure calculations for the employee performance-evaluation feature.
 * No I/O — callers pass already-loaded `AuthActivityLogEntry[]` /
 * `WorkspaceActionEntry[]` (from `readAuthActivityLog()` /
 * `readWorkspaceActions()`). See
 * docs/superpowers/specs/2026-08-27-employee-performance-evaluation-design.md.
 */

import type { AuthActivityLogEntry } from "../../auth/authActivityLog";
import type { WorkspaceActionEntry } from "../audit/actionLog";
import {
  FREQUENT_LARGE_GAPS_MIN_COUNT,
  GAP_TIER_THRESHOLDS_MS,
  IMPLAUSIBLE_SESSION_SPAN_MS,
  MIN_GAP_SAMPLES_FOR_BASELINE,
  STATUS_ABOVE_AVERAGE_RATIO,
  STATUS_BELOW_AVERAGE_RATIO,
  type DailyPerformance,
  type EmployeeComparisonRow,
  type EmployeeComparisonSummary,
  type EmployeeStatusKind,
  type GapEvent,
  type GapTier,
  type MonthGapAggregate,
  type PerformanceScopeFilter,
  type PerformanceSummary,
} from "./performanceTypes";

/**
 * YYYY-MM-DD for a timestamp, or "" when unparseable. Buckets by the LOCAL
 * calendar day — consistent with `minutesOfDay()` (also local) and the
 * date-range `<input type="date">` filter (always local), so a day's
 * sign-in/finish/gap data never straddles a bucket boundary that the rest
 * of this module doesn't use.
 */
export function dayKey(at: string): string {
  const parsed = Date.parse(at);
  if (Number.isNaN(parsed)) return "";
  const date = new Date(parsed);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** YYYY-MM for a day key. */
function monthOfDay(day: string): string {
  return day.slice(0, 7);
}

/** Minutes since LOCAL midnight for a timestamp — the x-axis unit for the working-hours strip chart. */
export function minutesOfDay(at: string): number {
  const date = new Date(at);
  return date.getHours() * 60 + date.getMinutes();
}

/**
 * Excludes activity entries whose recorded span is implausible for one
 * shift — the read-time guard against the pre-fix stale-`signedInAt` bug's
 * historical data (see authActivityLog.ts / authSession.ts, Task 1). Never
 * rewrites the source entries; this filter applies only inside this
 * module's own aggregation.
 */
export function sanitizeActivityEntries(
  entries: readonly AuthActivityLogEntry[]
): AuthActivityLogEntry[] {
  return entries.filter((entry) => {
    const start = Date.parse(entry.signedInAt);
    const end = Date.parse(entry.lastSeenAt);
    if (Number.isNaN(start) || Number.isNaN(end) || end < start) return false;
    return end - start <= IMPLAUSIBLE_SESSION_SPAN_MS;
  });
}

/** Earliest sanitized sign-in per (employee, day), keyed as `"{employee}|{day}"`. */
export function firstSignInByEmployeeDay(
  entries: readonly AuthActivityLogEntry[]
): Map<string, string> {
  const result = new Map<string, string>();
  for (const entry of sanitizeActivityEntries(entries)) {
    const day = dayKey(entry.signedInAt);
    if (day === "") continue;
    const key = `${entry.username}|${day}`;
    const existing = result.get(key);
    if (!existing || Date.parse(entry.signedInAt) < Date.parse(existing)) {
      result.set(key, entry.signedInAt);
    }
  }
  return result;
}

/** The employee a submitted answer counts against — the assignee for an on-behalf submission, the actor otherwise. */
function performingEmployee(entry: WorkspaceActionEntry): string {
  if (entry.action === "answer-submitted-on-behalf") {
    const assignee = entry.details?.assignee;
    if (typeof assignee === "string" && assignee.trim() !== "") return assignee;
  }
  return entry.actor;
}

/** Sorted finish timestamps per (employee, day), keyed as `"{employee}|{day}"`, from answer-submitted[-on-behalf] entries. */
export function finishTimestampsByEmployeeDay(
  entries: readonly WorkspaceActionEntry[]
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const entry of entries) {
    if (entry.action !== "answer-submitted" && entry.action !== "answer-submitted-on-behalf") continue;
    const day = dayKey(entry.at);
    if (day === "") continue;
    const key = `${performingEmployee(entry)}|${day}`;
    const list = result.get(key);
    if (list) list.push(entry.at);
    else result.set(key, [entry.at]);
  }
  for (const list of result.values()) list.sort((a, b) => Date.parse(a) - Date.parse(b));
  return result;
}

/**
 * Tier a gap duration falls into relative to the employee's own monthly
 * median (`baselineMs`). A `null` baseline (fewer than
 * MIN_GAP_SAMPLES_FOR_BASELINE gaps that month) always reports
 * "unclassified" — there is no reliable pace to compare against yet.
 */
export function classifyGapTier(durationMs: number, baselineMs: number | null): GapTier {
  if (baselineMs === null) return "unclassified";
  if (durationMs <= baselineMs + GAP_TIER_THRESHOLDS_MS.normalMaxExtraMs) return "normal";
  if (durationMs <= baselineMs + GAP_TIER_THRESHOLDS_MS.smallMaxExtraMs) return "small";
  if (durationMs <= baselineMs + GAP_TIER_THRESHOLDS_MS.mediumMaxExtraMs) return "medium";
  return "large";
}

/** The median of a list of non-negative durations, or null below MIN_GAP_SAMPLES_FOR_BASELINE samples. */
export function medianGapBaseline(durationsMs: readonly number[]): number | null {
  if (durationsMs.length < MIN_GAP_SAMPLES_FOR_BASELINE) return null;
  const sorted = [...durationsMs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

type RawGap = { startAt: string; endAt: string; durationMs: number };

/** sign-in → first finish, then finish → finish. Never fabricates a gap before an unknown sign-in or after the last finish of the day. */
function rawGapsForDay(signInAt: string | null, finishes: readonly string[]): RawGap[] {
  const gaps: RawGap[] = [];
  const points = signInAt ? [signInAt, ...finishes] : finishes;
  for (let i = 0; i + 1 < points.length; i += 1) {
    const startAt = points[i]!;
    const endAt = points[i + 1]!;
    const durationMs = Date.parse(endAt) - Date.parse(startAt);
    if (Number.isFinite(durationMs) && durationMs >= 0) gaps.push({ startAt, endAt, durationMs });
  }
  return gaps;
}

/**
 * Build every employee's daily performance record from raw activity +
 * action data, unfiltered (the caller narrows with `filterDailyPerformance`
 * afterward). Two passes: (1) collect every within-day gap duration to
 * compute each employee's monthly median baseline, (2) classify each gap's
 * tier against that baseline and assemble the daily records. Gaps never
 * cross a calendar-day boundary — each day starts fresh at that day's own
 * sign-in.
 */
export function computeAllDailyPerformance(
  activityEntries: readonly AuthActivityLogEntry[],
  actionEntries: readonly WorkspaceActionEntry[]
): DailyPerformance[] {
  const signIns = firstSignInByEmployeeDay(activityEntries);
  const finishesByDay = finishTimestampsByEmployeeDay(actionEntries);

  const dayKeys = new Set<string>([...signIns.keys(), ...finishesByDay.keys()]);

  const rawGapsByKey = new Map<string, RawGap[]>();
  const durationsByEmployeeMonth = new Map<string, number[]>();
  for (const key of dayKeys) {
    const [employee, day] = key.split("|") as [string, string];
    const signInAt = signIns.get(key) ?? null;
    const finishes = finishesByDay.get(key) ?? [];
    const gaps = rawGapsForDay(signInAt, finishes);
    rawGapsByKey.set(key, gaps);
    if (gaps.length > 0) {
      const monthKey = `${employee}|${monthOfDay(day)}`;
      const durations = gaps.map((g) => g.durationMs);
      const bucket = durationsByEmployeeMonth.get(monthKey);
      if (bucket) bucket.push(...durations);
      else durationsByEmployeeMonth.set(monthKey, durations);
    }
  }

  const baselineByEmployeeMonth = new Map<string, number | null>();
  for (const [monthKey, durations] of durationsByEmployeeMonth) {
    baselineByEmployeeMonth.set(monthKey, medianGapBaseline(durations));
  }

  const records: DailyPerformance[] = [];
  for (const key of dayKeys) {
    const [employee, day] = key.split("|") as [string, string];
    const signInAt = signIns.get(key) ?? null;
    const finishes = finishesByDay.get(key) ?? [];
    const baseline = baselineByEmployeeMonth.get(`${employee}|${monthOfDay(day)}`) ?? null;
    const gaps: GapEvent[] = (rawGapsByKey.get(key) ?? []).map((gap) => ({
      employee,
      day,
      startAt: gap.startAt,
      endAt: gap.endAt,
      durationMs: gap.durationMs,
      tier: classifyGapTier(gap.durationMs, baseline),
    }));
    const lastFinishAt = finishes.length > 0 ? finishes[finishes.length - 1]! : null;
    records.push({
      employee,
      day,
      samplesFinished: finishes.length,
      signInAt,
      lastFinishAt,
      effectiveTimeMs:
        signInAt && lastFinishAt
          ? Math.max(0, Date.parse(lastFinishAt) - Date.parse(signInAt))
          : null,
      gaps,
    });
  }

  return records.sort(
    (a, b) => a.day.localeCompare(b.day) || a.employee.localeCompare(b.employee, "ar")
  );
}

/** Pure filter over daily records — mirrors actionCatalog.ts's filterActionEntries. */
export function filterDailyPerformance(
  records: readonly DailyPerformance[],
  scope: PerformanceScopeFilter
): DailyPerformance[] {
  const employee = scope.employee.trim();
  return records.filter((record) => {
    if (employee !== "" && record.employee !== employee) return false;
    if (scope.from !== "" && record.day < scope.from) return false;
    if (scope.to !== "" && record.day > scope.to) return false;
    return true;
  });
}

/** Every gap in a set of (already-filtered) daily records, sorted ascending by start time. */
export function flattenGaps(records: readonly DailyPerformance[]): GapEvent[] {
  return records
    .flatMap((record) => record.gaps)
    .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
}

/** Per-day samples-finished counts across a set of (already-filtered) daily records — sums across employees when more than one is in scope. */
export function aggregateSamplesByDay(
  records: readonly DailyPerformance[]
): { day: string; count: number }[] {
  const byDay = new Map<string, number>();
  for (const record of records) {
    byDay.set(record.day, (byDay.get(record.day) ?? 0) + record.samplesFinished);
  }
  return [...byDay.entries()]
    .map(([day, count]) => ({ day, count }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

/**
 * Notable (small/medium/large) gap duration per calendar month — the team
 * view's "ساعات العمل اليومية" chart plots this instead of one row per
 * (employee, day), which becomes unreadable as a month accumulates days.
 * "normal" and "unclassified" gaps are excluded, same convention as
 * buildHourSegments in PerformanceSection.tsx. Sorted ascending by month.
 */
export function aggregateGapsByMonth(gaps: readonly GapEvent[]): MonthGapAggregate[] {
  const byMonth = new Map<string, Record<"small" | "medium" | "large", number>>();
  for (const gap of gaps) {
    if (gap.tier !== "small" && gap.tier !== "medium" && gap.tier !== "large") continue;
    const month = gap.day.slice(0, 7);
    const tiers = byMonth.get(month) ?? { small: 0, medium: 0, large: 0 };
    tiers[gap.tier] += gap.durationMs;
    byMonth.set(month, tiers);
  }
  return [...byMonth.entries()]
    .map(([month, durationMsByTier]) => ({
      month,
      durationMsByTier,
      totalDurationMs: durationMsByTier.small + durationMsByTier.medium + durationMsByTier.large,
    }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

const EMPTY_TIER_COUNTS: Record<GapTier, number> = {
  normal: 0,
  small: 0,
  medium: 0,
  large: 0,
  unclassified: 0,
};

/** Summary stat cards for a (already-filtered) set of daily records. */
export function summarizePerformance(records: readonly DailyPerformance[]): PerformanceSummary {
  const gaps = flattenGaps(records);
  const gapCountsByTier: Record<GapTier, number> = { ...EMPTY_TIER_COUNTS };
  for (const gap of gaps) gapCountsByTier[gap.tier] += 1;

  const totalSamples = records.reduce((sum, r) => sum + r.samplesFinished, 0);
  const effectiveDurations = records
    .map((r) => r.effectiveTimeMs)
    .filter((v): v is number => v !== null);
  const totalEffectiveMs =
    effectiveDurations.length > 0 ? effectiveDurations.reduce((sum, v) => sum + v, 0) : null;
  const medianGapMs = medianGapBaseline(gaps.map((g) => g.durationMs));

  return { totalSamples, totalEffectiveMs, gapCountsByTier, medianGapMs };
}

/** Plain median, no reliability threshold — for team-level aggregates (teamMedianPaceMs), not per-employee gap tiering (see medianGapBaseline). */
export function medianOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function pctOfTotal(count: number, total: number): number {
  return total === 0 ? 0 : Math.round((count / total) * 100);
}

function deriveEmployeeStatus(
  samples: number,
  teamAvgSamples: number,
  gapCounts: Record<GapTier, number>
): { statusKind: EmployeeStatusKind; hasFrequentLargeGaps: boolean } {
  const ratio = teamAvgSamples > 0 ? samples / teamAvgSamples : 1;
  const statusKind: EmployeeStatusKind =
    ratio >= STATUS_ABOVE_AVERAGE_RATIO ? "above" : ratio <= STATUS_BELOW_AVERAGE_RATIO ? "below" : "within";
  return { statusKind, hasFrequentLargeGaps: gapCounts.large >= FREQUENT_LARGE_GAPS_MIN_COUNT };
}

/**
 * Per-employee rows for the تقييم الأداء comparison table, ranked by samples
 * descending. `records` should be date-range filtered but NOT
 * employee-filtered — every employee stays comparable against the same team
 * average regardless of which single employee the rest of the screen is
 * scoped to. `employeeNames` seeds the roster so an employee with zero
 * activity in scope still appears, with zeroed/null stats, instead of
 * silently dropping out of the comparison.
 */
export function computeEmployeeComparison(
  records: readonly DailyPerformance[],
  employeeNames: ReadonlyMap<string, string>
): EmployeeComparisonSummary {
  const byEmployee = new Map<string, DailyPerformance[]>();
  for (const record of records) {
    const bucket = byEmployee.get(record.employee);
    if (bucket) bucket.push(record);
    else byEmployee.set(record.employee, [record]);
  }

  const usernames = new Set<string>([...employeeNames.keys(), ...byEmployee.keys()]);

  const draft = [...usernames].map((username) => {
    const empRecords = byEmployee.get(username) ?? [];
    const samples = empRecords.reduce((sum, r) => sum + r.samplesFinished, 0);
    const effectiveDurations = empRecords
      .map((r) => r.effectiveTimeMs)
      .filter((v): v is number => v !== null);
    const effectiveMs = effectiveDurations.length > 0 ? effectiveDurations.reduce((a, b) => a + b, 0) : null;
    const gaps = flattenGaps(empRecords);
    const gapCounts: Record<GapTier, number> = { ...EMPTY_TIER_COUNTS };
    for (const gap of gaps) gapCounts[gap.tier] += 1;
    const totalGaps = gaps.length;
    const paceMs = medianGapBaseline(gaps.map((g) => g.durationMs));
    const lastActiveDay =
      empRecords.length > 0
        ? empRecords.reduce((max, r) => (r.day > max ? r.day : max), empRecords[0]!.day)
        : null;
    return {
      username,
      displayName: employeeNames.get(username) ?? username,
      samples,
      effectiveMs,
      paceMs,
      gapCounts,
      totalGaps,
      lastActiveDay,
    };
  });

  const totalSamplesAll = draft.reduce((sum, r) => sum + r.samples, 0);
  const teamAvgSamples = draft.length > 0 ? Math.round(totalSamplesAll / draft.length) : 0;
  const teamMedianPaceMs = medianOf(draft.map((r) => r.paceMs).filter((v): v is number => v !== null));

  const rows: EmployeeComparisonRow[] = draft
    .slice()
    .sort((a, b) => b.samples - a.samples || a.displayName.localeCompare(b.displayName, "ar"))
    .map((row, index) => {
      const { statusKind, hasFrequentLargeGaps } = deriveEmployeeStatus(row.samples, teamAvgSamples, row.gapCounts);
      const gapPercents: Record<GapTier, number> = {
        normal: pctOfTotal(row.gapCounts.normal, row.totalGaps),
        small: pctOfTotal(row.gapCounts.small, row.totalGaps),
        medium: pctOfTotal(row.gapCounts.medium, row.totalGaps),
        large: pctOfTotal(row.gapCounts.large, row.totalGaps),
        unclassified: pctOfTotal(row.gapCounts.unclassified, row.totalGaps),
      };
      return {
        username: row.username,
        displayName: row.displayName,
        rank: index + 1,
        samples: row.samples,
        effectiveMs: row.effectiveMs,
        paceMs: row.paceMs,
        gapCounts: row.gapCounts,
        totalGaps: row.totalGaps,
        gapPercents,
        lastActiveDay: row.lastActiveDay,
        statusKind,
        hasFrequentLargeGaps,
      };
    });

  return { rows, teamAvgSamples, teamMedianPaceMs };
}
