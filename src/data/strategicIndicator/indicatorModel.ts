/**
 * The indicator card («بطاقة العمل») as figures, computed the way the
 * workbook's own formulas compute it. Pure: counts in, card out.
 *
 * The card's rules, read off the workbook:
 *  - المجتمع: population rows of the data month at that level.
 *  - المستهدف: the first level targets its whole population; the other levels
 *    target a fixed monthly number, capped at the population (`MIN`).
 *  - العينة: studied cases whose IMAGE was captured in the data month, at that
 *    level. The year is not part of the match, as in the workbook.
 *  - العجز: `MIN(0, العينة − المستهدف)`.
 *  - النسبة: `العينة ÷ المستهدف`; the month's achievement is the average of the
 *    four ratios with each capped at 100%.
 *  - A block is titled with the month AFTER its data month: December's data is
 *    the «يناير» block. The cycle therefore runs data months 12, 1, 2 … 11.
 */
import type { MonthStageCounts } from "./indicatorTemplate";

export const INDICATOR_STAGES = ["first", "second", "third", "fourth"] as const;
export type IndicatorStage = (typeof INDICATOR_STAGES)[number];

/** The stage codes the workbook's tables use (spelled as in the file). */
export const INDICATOR_STAGE_CODES: Record<IndicatorStage, string> = {
  first: "FIRST_STAGE",
  second: "SECOND_STAG",
  third: "THIRD_STAGE",
  fourth: "FORTH_STAGE",
};

/** Data months in card order. */
export const INDICATOR_MONTH_ORDER = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const;

const MONTH_NAMES_AR = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
];

/** Title of the card block for a data month: the following month's name. */
export function indicatorBlockLabel(dataMonth: number): string {
  return MONTH_NAMES_AR[dataMonth % 12];
}

export type IndicatorTargets = { second: number; third: number; fourth: number };

export type IndicatorCell = {
  population: number;
  target: number;
  sample: number;
  deficit: number;
  /** `null` when the target is 0 (the workbook shows a division error there). */
  ratio: number | null;
};

export type IndicatorMonth = {
  dataMonth: number;
  label: string;
  stages: Record<IndicatorStage, IndicatorCell>;
  total: { population: number; target: number; sample: number; deficit: number };
  /** Average of the level ratios, each capped at 1. `null` when no level has a target. */
  achievement: number | null;
  /** Running average of `achievement` from the first month of the cycle. */
  cumulative: number | null;
  /** False when the uploaded workbook's card has no column block for this month. */
  inCard: boolean;
};

function count(counts: MonthStageCounts, month: number, stage: IndicatorStage): number {
  return counts[String(month)]?.[INDICATOR_STAGE_CODES[stage]] ?? 0;
}

function targetFor(stage: IndicatorStage, population: number, targets: IndicatorTargets): number {
  return stage === "first" ? population : Math.min(population, targets[stage]);
}

export function buildIndicatorCard(input: {
  population: MonthStageCounts;
  samples: MonthStageCounts;
  targets: IndicatorTargets;
  cardMonths: readonly number[];
}): IndicatorMonth[] {
  const months: IndicatorMonth[] = [];
  const achievements: number[] = [];
  for (const dataMonth of INDICATOR_MONTH_ORDER) {
    const stages = {} as Record<IndicatorStage, IndicatorCell>;
    const total = { population: 0, target: 0, sample: 0, deficit: 0 };
    const ratios: number[] = [];
    for (const stage of INDICATOR_STAGES) {
      const population = count(input.population, dataMonth, stage);
      const sample = count(input.samples, dataMonth, stage);
      const target = targetFor(stage, population, input.targets);
      const deficit = Math.min(0, sample - target);
      const ratio = target > 0 ? sample / target : null;
      stages[stage] = { population, target, sample, deficit, ratio };
      total.population += population;
      total.target += target;
      total.sample += sample;
      total.deficit += deficit;
      if (ratio !== null) ratios.push(Math.min(1, ratio));
    }
    // A month with no population has no block worth showing, studied cases or not.
    if (total.population === 0) continue;
    const achievement = ratios.length > 0 ? ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length : null;
    if (achievement !== null) achievements.push(achievement);
    months.push({
      dataMonth,
      label: indicatorBlockLabel(dataMonth),
      stages,
      total,
      achievement,
      cumulative:
        achievements.length > 0 ? achievements.reduce((sum, value) => sum + value, 0) / achievements.length : null,
      inCard: input.cardMonths.includes(dataMonth),
    });
  }
  return months;
}

/** `a + b`, month by month and level by level. Neither input is changed. */
export function addMonthStageCounts(a: MonthStageCounts, b: MonthStageCounts): MonthStageCounts {
  const out: MonthStageCounts = {};
  for (const source of [a, b]) {
    for (const [month, byStage] of Object.entries(source)) {
      const target = (out[month] ??= {});
      for (const [stage, value] of Object.entries(byStage)) target[stage] = (target[stage] ?? 0) + value;
    }
  }
  return out;
}

export function countByMonthStage(rows: ReadonlyArray<{ month: number; stageCode: string }>): MonthStageCounts {
  const out: MonthStageCounts = {};
  for (const row of rows) {
    const byStage = (out[String(row.month)] ??= {});
    byStage[row.stageCode] = (byStage[row.stageCode] ?? 0) + 1;
  }
  return out;
}
