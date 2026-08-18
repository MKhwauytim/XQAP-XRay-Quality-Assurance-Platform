// Pure derivations for the reworked KPI dashboard (مؤشرات الأداء).
//
// Every value here comes from the real `ReportModel` (buildReportModel) — this
// module NEVER invents a figure. Honesty discipline: a rate with an empty
// denominator is `null` (the view renders «—»), never 0.
//
// Kept separate from the React component so each derivation is unit-testable
// without jsdom, matching the repo's "renderers display, they never recompute"
// rule for report data.

import type { ReportModel } from "../../../../data/reporting/executive/model/reportModel";

/**
 * Format a rate that may be null (empty denominator) — never shows 0% on no
 * data. The single formatter shared by the Reports tab and the KPI dashboard so
 * the honesty rule cannot drift between them.
 */
export function fmtPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${Math.max(0, Math.min(100, value)).toFixed(1)}%`;
}

/** App standard is Latin (Western) digits — "ar-SA-u-nu-latn" (audit C-10). */
export function fmtCount(value: number | null | undefined): string {
  return value != null && Number.isFinite(value) ? value.toLocaleString("ar-SA-u-nu-latn") : "—";
}

/** Completion at/above this percentage renders in the sky tone; below it, amber. */
export const SAMPLE_PROGRESS_GOOD_PCT = 80;

export type ProgressTone = "sky" | "amber";

export type SampleLevelProgress = {
  key: string;
  label: string;
  /** Sample rows drawn for this risk level. */
  assigned: number;
  studied: number;
  remaining: number;
  /** `null` when nothing was drawn for the level — renders «—», never 0%. */
  completionRate: number | null;
  tone: ProgressTone;
};

export type SampleProgress = {
  overall: {
    studied: number;
    total: number;
    remaining: number;
    completionRate: number | null;
    tone: ProgressTone;
  };
  levels: SampleLevelProgress[];
};

function ratePct(num: number, den: number): number | null {
  return den > 0 ? (num / den) * 100 : null;
}

function toneFor(rate: number | null): ProgressTone {
  return rate != null && rate >= SAMPLE_PROGRESS_GOOD_PCT ? "sky" : "amber";
}

/**
 * تقدّم دراسة العينة — overall progress plus one card per risk level.
 *
 * Levels come from `model.population.byStage` (the four المستوى buckets the
 * sampler apportions into); the overall figures come from `model.sample`, so
 * the ring and the cards can never disagree with the rest of the report.
 * `completionRate` is recomputed from studied/sampleSize rather than read from
 * `StageProfile.completionRate` only because the latter is a plain `number`
 * (0 for an empty level) and this dashboard must show «—» there instead.
 */
export function buildSampleProgress(model: ReportModel): SampleProgress {
  const levels = model.population.byStage.map((stage): SampleLevelProgress => {
    const rate = ratePct(stage.studied, stage.sampleSize);
    return {
      key: stage.stageKey,
      label: stage.stageLabel,
      assigned: stage.sampleSize,
      studied: stage.studied,
      remaining: Math.max(0, stage.sampleSize - stage.studied),
      completionRate: rate,
      tone: toneFor(rate),
    };
  });
  const overallRate = ratePct(model.sample.studied, model.sample.total);
  return {
    overall: {
      studied: model.sample.studied,
      total: model.sample.total,
      remaining: Math.max(0, model.sample.total - model.sample.studied),
      completionRate: overallRate,
      tone: toneFor(overallRate),
    },
    levels,
  };
}

// ── «دقة الاشتباه» answer mix ───────────────────────────────────────────────

export type AnswerGroup = {
  key: string;
  label: string;
  /** Submitted reviews whose «دقة الاشتباه» verdict was اشتباه. */
  suspicion: number;
  /** Submitted reviews whose verdict was سليمة. */
  clean: number;
  /** assigned − completed: distributed rows with no submitted answer yet. */
  incomplete: number;
  total: number;
};

export type AnswerGroups = { reviewer: AnswerGroup[]; port: AnswerGroup[] };

/** Keep the grouped bar chart legible — the design shows 6–8 groups. */
const MAX_ANSWER_GROUPS = 12;

type Tally = { suspicion: number; clean: number; assigned: number; completed: number };

function tally(map: Map<string, Tally>, key: string): Tally {
  let entry = map.get(key);
  if (!entry) {
    entry = { suspicion: 0, clean: 0, assigned: 0, completed: 0 };
    map.set(key, entry);
  }
  return entry;
}

function finalize(
  map: Map<string, Tally>,
  labelOf: (key: string) => string
): AnswerGroup[] {
  return [...map.entries()]
    .map(([key, t]): AnswerGroup => {
      const incomplete = Math.max(0, t.assigned - t.completed);
      return {
        key,
        label: labelOf(key),
        suspicion: t.suspicion,
        clean: t.clean,
        incomplete,
        total: t.suspicion + t.clean + incomplete,
      };
    })
    .filter((g) => g.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, MAX_ANSWER_GROUPS);
}

/**
 * Counts of the reviewer's «دقة الاشتباه» answer per reviewer and per port.
 *
 * Reads `model.rows` (the executive report rows — one per X-ray image), the
 * same source the fact table is exploded from, so both views describe exactly
 * the images that were distributed for study (`assignedTo !== null`).
 * `غير مكتملة` is assigned − completed, per the design's data mapping.
 */
export function buildAnswerGroups(
  model: ReportModel,
  resolveName: (username: string) => string,
  unknownPortLabel: string
): AnswerGroups {
  const byReviewer = new Map<string, Tally>();
  const byPort = new Map<string, Tally>();
  for (const row of model.rows) {
    if (row.assignedTo === null) continue;
    const reviewer = tally(byReviewer, row.assignedTo);
    const port = tally(byPort, row.portName ?? unknownPortLabel);
    reviewer.assigned += 1;
    port.assigned += 1;
    if (row.answerStatus !== "submitted") continue;
    reviewer.completed += 1;
    port.completed += 1;
    if (row.expertResult === "اشتباه") {
      reviewer.suspicion += 1;
      port.suspicion += 1;
    } else if (row.expertResult === "سليمة") {
      reviewer.clean += 1;
      port.clean += 1;
    }
  }
  return {
    reviewer: finalize(byReviewer, resolveName),
    port: finalize(byPort, (key) => key),
  };
}

// ── month inaccuracy calendar ───────────────────────────────────────────────

export type CalendarCell = {
  /** 1-31, or 0 for the leading/trailing padding cells of the grid. */
  day: number;
  count: number;
  isHoliday: boolean;
};

export type InaccuracyCalendar = {
  /** Calendar year/month (1-12) the grid describes. */
  year: number;
  month: number;
  weeks: number;
  /** `weeks * 7` cells, RTL column order السبت → الجمعة (Saturday first). */
  cells: CalendarCell[];
  max: number;
  total: number;
};

/** Outcome classes that count as "inaccurate" — the reviewer disagreed. */
const INACCURATE = new Set(["missed-suspicion", "false-suspicion"]);

/**
 * Per-day count of inaccurate decisions found in review.
 *
 * Derived from `model.factTable`: each decision record carries `completedAt`
 * (the answer's `submittedAt` — when the review that exposed the inaccuracy was
 * submitted) and `outcomeClass`. That is the only per-day timestamp the model
 * exposes, so the calendar is explicitly a map of *when the inaccuracy was
 * found*, not when the original decision was made.
 *
 * The calendar month is taken from the data itself (the month holding the most
 * such timestamps) rather than from the population's month folder: reviews are
 * routinely submitted in a later calendar month than the data they cover, and
 * pinning the grid to the folder month would render an all-zero calendar that
 * looks like "no inaccuracy" instead of "no reviews that month".
 *
 * Returns `null` when no inaccurate decision carries a usable timestamp — the
 * caller then omits the card rather than drawing invented dates.
 */
export function buildInaccuracyCalendar(model: ReportModel): InaccuracyCalendar | null {
  const perDay = new Map<string, number>();
  const perMonth = new Map<string, number>();
  for (const record of model.factTable) {
    if (record.completedAt === null) continue;
    if (record.outcomeClass === null || !INACCURATE.has(record.outcomeClass)) continue;
    const at = new Date(record.completedAt);
    if (Number.isNaN(at.getTime())) continue;
    const monthKey = `${at.getFullYear()}-${at.getMonth()}`;
    const dayKey = `${monthKey}-${at.getDate()}`;
    perDay.set(dayKey, (perDay.get(dayKey) ?? 0) + 1);
    perMonth.set(monthKey, (perMonth.get(monthKey) ?? 0) + 1);
  }
  if (perMonth.size === 0) return null;

  let bestKey = "";
  let bestCount = -1;
  for (const [key, count] of perMonth) {
    // Ties break toward the earlier month so the choice is deterministic.
    if (count > bestCount || (count === bestCount && key < bestKey)) {
      bestKey = key;
      bestCount = count;
    }
  }
  const [yearText, monthIndexText] = bestKey.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthIndexText);

  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  // RTL grid: السبت is column 0. JS getDay() is 0=Sunday…6=Saturday.
  const firstColumn = (new Date(year, monthIndex, 1).getDay() + 1) % 7;
  const weeks = Math.ceil((firstColumn + daysInMonth) / 7);
  const cells: CalendarCell[] = [];
  let max = 0;
  for (let slot = 0; slot < weeks * 7; slot += 1) {
    const day = slot - firstColumn + 1;
    const inMonth = day >= 1 && day <= daysInMonth;
    const count = inMonth ? perDay.get(`${bestKey}-${day}`) ?? 0 : 0;
    if (count > max) max = count;
    cells.push({ day: inMonth ? day : 0, count, isHoliday: inMonth && slot % 7 === 6 });
  }
  return { year, month: monthIndex + 1, weeks, cells, max, total: bestCount };
}

// ── reviewer control status ─────────────────────────────────────────────────

export type ReviewerControlStatus = "in-control" | "out-of-control" | "low-n";

/**
 * الحالة pill status per reviewer, read VERBATIM from the p-chart the existing
 * `reviewerKpis.ts` math already produced. The chart rendering changed in the
 * rework; the status math did not — a reviewer with no p-chart group at all has
 * no proportion to judge, which is the same "too little data" case as low-n.
 */
export function buildReviewerStatuses(
  model: ReportModel
): Map<string, ReviewerControlStatus> {
  const out = new Map<string, ReviewerControlStatus>();
  for (const group of model.reviewerKpis.reviewerPChart.groups) {
    out.set(
      group.key,
      group.lowN ? "low-n" : group.outOfControl ? "out-of-control" : "in-control"
    );
  }
  return out;
}
