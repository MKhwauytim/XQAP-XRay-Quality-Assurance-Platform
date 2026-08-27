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
  GAP_TIER_THRESHOLDS_MS,
  IMPLAUSIBLE_SESSION_SPAN_MS,
  MIN_GAP_SAMPLES_FOR_BASELINE,
  type DailyPerformance,
  type GapEvent,
  type GapTier,
  type PerformanceScopeFilter,
  type PerformanceSummary,
} from "./performanceTypes";

/** YYYY-MM-DD for a timestamp, or "" when unparseable. */
export function dayKey(at: string): string {
  const parsed = Date.parse(at);
  if (Number.isNaN(parsed)) return "";
  return new Date(parsed).toISOString().slice(0, 10);
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
  if (durationMs <= baselineMs + GAP_TIER_THRESHOLDS_MS.smallExtraMs) return "normal";
  if (durationMs <= baselineMs + GAP_TIER_THRESHOLDS_MS.mediumExtraMs) return "small";
  if (durationMs <= baselineMs + GAP_TIER_THRESHOLDS_MS.largeExtraMs) return "medium";
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

/** Distinct employees present in a set of daily records, sorted for a picker. */
export function employeesInPerformanceData(records: readonly DailyPerformance[]): string[] {
  return [...new Set(records.map((r) => r.employee))].sort((a, b) => a.localeCompare(b, "ar"));
}
