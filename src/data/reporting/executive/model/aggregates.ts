import type { ExecutiveReportConfig } from "../../executiveReportTypes";
import { band } from "./dataSufficiency";
import type { DataSufficiencyBand } from "./dataSufficiency";
import {
  aggregateDecisions,
  emptyCounts,
  tallyOutcome as tally,
} from "./decisionFactTable";
import type {
  Counts,
  DecisionLevel,
  DecisionRecord,
  ImageResultComparison,
  ResultSource,
} from "./decisionFactTable";

/**
 * Folds the decision fact table + image comparisons into the aggregate views the
 * report consumes (design spec §3.3). Counts here come from the per-decision
 * granularity (1–2 records/case), via the single `aggregateDecisions` fold in
 * `decisionFactTable.ts` — the image-level port/stage *population* profiles are
 * produced by `buildPortProfiles` (`executiveKpiProfiles.ts`), which now ALSO
 * goes through that same shared fold (grain `"image"`) instead of an
 * independent computation; see that file for why the two grains are not
 * interchangeable.
 *
 * Honesty discipline (§3.7): every rate is `number | null`; a `null` denominator
 * yields `null` (renders `—`), never `0%`.
 */

function rate(num: number, den: number): number | null {
  return den > 0 ? (num / den) * 100 : null;
}

export type AccuracyMetrics = {
  evaluable: number;
  correctClean: number;
  correctSuspicion: number;
  missedSuspicion: number;
  falseSuspicion: number;
  /** (correctClean + correctSuspicion) / evaluable */
  accuracy: number | null;
  /** correctSuspicion / (correctSuspicion + missedSuspicion) */
  detectionRate: number | null;
  /** missedSuspicion / (correctSuspicion + missedSuspicion) — headline risk */
  missedSuspicionRate: number | null;
  /** correctSuspicion / (correctSuspicion + falseSuspicion) */
  suspicionDecisionAccuracy: number | null;
  /** falseSuspicion / (correctClean + falseSuspicion) */
  falseSuspicionRate: number | null;
  band: DataSufficiencyBand;
};

function metricsFromCounts(counts: Counts, config: ExecutiveReportConfig): AccuracyMetrics {
  const reviewerSuspicious = counts.correctSuspicion + counts.missedSuspicion;
  const flaggedByEmployee = counts.correctSuspicion + counts.falseSuspicion;
  const reviewerClean = counts.correctClean + counts.falseSuspicion;
  return {
    evaluable: counts.evaluable,
    correctClean: counts.correctClean,
    correctSuspicion: counts.correctSuspicion,
    missedSuspicion: counts.missedSuspicion,
    falseSuspicion: counts.falseSuspicion,
    accuracy: rate(counts.correctClean + counts.correctSuspicion, counts.evaluable),
    detectionRate: rate(counts.correctSuspicion, reviewerSuspicious),
    missedSuspicionRate: rate(counts.missedSuspicion, reviewerSuspicious),
    suspicionDecisionAccuracy: rate(counts.correctSuspicion, flaggedByEmployee),
    falseSuspicionRate: rate(counts.falseSuspicion, reviewerClean),
    band: band(counts.evaluable, config.dataSufficiencyThresholds),
  };
}

/**
 * `KeyedAccuracy.accuracyByDecision` is explicitly NOT named `.accuracy` —
 * `PortProfile.accuracyByImage` (`executiveReportTypes.ts`) and
 * `PortLevelAccuracy.accuracyByDecisionLevel` (below) are the other two
 * grains that live on the same `ReportModel`, keyed by the same port names.
 * Giving all three the same field name is exactly how the pre-2026-08-07 bug
 * shipped silently — a future accidental swap between these three arrays is
 * now a TypeScript error instead of a wrong number in the report.
 */
export type KeyedAccuracy = Omit<AccuracyMetrics, "accuracy" | "missedSuspicionRate"> & {
  key: string;
  accuracyByDecision: number | null;
  /** DECISION grain — see the doc comment on `accuracyByDecision` above for
   *  why this cannot share a field name with the other two port-accuracy
   *  grains (`PortProfile.missedSuspicionRateByImage`,
   *  `PortLevelAccuracy.missedSuspicionRateByDecisionLevel`). */
  missedSuspicionRateByDecision: number | null;
};

function toKeyed(key: string, metrics: AccuracyMetrics): KeyedAccuracy {
  const { accuracy, missedSuspicionRate, ...rest } = metrics;
  return { key, ...rest, accuracyByDecision: accuracy, missedSuspicionRateByDecision: missedSuspicionRate };
}

/**
 * Decision-COMBINED fold: `keyOf` ignores `decisionLevel`, so L1 and L2
 * records for the same case land in the same bucket. Thin wrapper over the
 * shared `aggregateDecisions(..., "decision", ...)` fold.
 */
function foldBy(
  records: DecisionRecord[],
  keyOf: (r: DecisionRecord) => string | null,
  config: ExecutiveReportConfig,
  fallbackKey = "غير محدد"
): KeyedAccuracy[] {
  const map = aggregateDecisions(records, "decision", keyOf, fallbackKey);
  return [...map.entries()].map(([key, counts]) => toKeyed(key, metricsFromCounts(counts, config)));
}

/** Separator for the composite (portName, decisionLevel) fold key — a control
 *  picture character no real port name can contain, so it can never collide
 *  with a `|`-containing port name the way a literal pipe might. */
const LEVEL_KEY_SEP = "␟";

export type PortLevelAccuracy = Omit<AccuracyMetrics, "accuracy" | "missedSuspicionRate"> & {
  portName: string;
  level: DecisionLevel;
  /** Decision-PER-LEVEL grain — see the doc comment on `KeyedAccuracy.accuracyByDecision`
   *  for why this cannot share a field name with the other two port-accuracy grains. */
  accuracyByDecisionLevel: number | null;
  /** Decision-PER-LEVEL grain — see the doc comment on
   *  `KeyedAccuracy.missedSuspicionRateByDecision` for why this cannot share
   *  a field name with the other two port-accuracy grains. */
  missedSuspicionRateByDecisionLevel: number | null;
};

/**
 * Decision-PER-LEVEL fold: `keyOf` folds `decisionLevel` INTO the key, so L1
 * and L2 land in separate buckets. Single source for both the deck2
 * "دقة إجابات المستوى الأول والثاني" page (`levelAccuracy.ts`, which used to
 * re-derive this from `model.factTable` on its own) and the executive
 * workbook's per-port دقة م.أول/م.ثاني columns (`workbook.ts`, which used to
 * read `PortProfile.levelOneAccuracy/levelTwoAccuracy` — the IMAGE grain's
 * own, structurally different, per-level figure).
 */
function foldByPortAndLevel(
  records: DecisionRecord[],
  config: ExecutiveReportConfig,
  fallbackPortKey = "غير محدد"
): PortLevelAccuracy[] {
  const map = aggregateDecisions(
    records,
    "decision",
    (r) => `${r.portName ?? fallbackPortKey}${LEVEL_KEY_SEP}${r.decisionLevel}`
  );
  return [...map.entries()].map(([compositeKey, counts]) => {
    const sep = compositeKey.lastIndexOf(LEVEL_KEY_SEP);
    const portName = compositeKey.slice(0, sep);
    const level = compositeKey.slice(sep + 1) as DecisionLevel;
    const { accuracy, missedSuspicionRate, ...rest } = metricsFromCounts(counts, config);
    return {
      portName,
      level,
      ...rest,
      accuracyByDecisionLevel: accuracy,
      missedSuspicionRateByDecisionLevel: missedSuspicionRate,
    };
  });
}

export type EmployeeLevelKey = { inspectorId: string; level: "LEVEL_1" | "LEVEL_2" };

export type EmployeeByPortLevel = AccuracyMetrics & {
  inspectorId: string;
  level: "LEVEL_1" | "LEVEL_2";
  portName: string;
};

/** Error-type mix (the four outcome classes) for a unit. */
export type ErrorTypeBreakdown = {
  key: string;
  correctClean: number;
  correctSuspicion: number;
  missedSuspicion: number;
  falseSuspicion: number;
  evaluable: number;
};

/** One day-of-month bucket of the decision fact table. */
export type DayAccuracy = AccuracyMetrics & { day: number };

export type AgreementCell = {
  /** Images where both sources had a result. */
  comparable: number;
  agree: number;
  disagree: number;
  agreementRate: number | null;
};

/** Each non-review team vs the QA reviewer (reviewer-focused view, §3.1). */
export type ReviewerAgreementRow = AgreementCell & {
  source: Exclude<ResultSource, "review">;
  /** Of the disagreements, those where the team flagged but reviewer cleared. */
  teamFlaggedReviewerClean: number;
  /** Of the disagreements, those where the team cleared but reviewer flagged. */
  teamClearedReviewerFlagged: number;
};

/** A single cell of the full N×N source-vs-source agreement matrix (§3.1). */
export type CrossTeamMatrixCell = AgreementCell & {
  sourceA: ResultSource;
  sourceB: ResultSource;
};

export type Aggregates = {
  byPort: KeyedAccuracy[];
  byStage: KeyedAccuracy[];
  byMovement: KeyedAccuracy[];
  /** Decision-per-level fold, keyed on (portName, decisionLevel) — the single
   *  source for both the deck2 level-accuracy page and the workbook's
   *  per-level port columns. See `foldByPortAndLevel`. */
  byPortAndLevel: PortLevelAccuracy[];
  employeeByPortAndLevel: EmployeeByPortLevel[];
  errorTypeByPort: ErrorTypeBreakdown[];
  /** Accuracy per day of month (1–31), ascending; days with no evaluable
   *  decision are ABSENT, not zero-filled — a gap must render as a gap. */
  byEntryDay: DayAccuracy[];
  /** The غير مؤرخ bucket: evaluable decisions whose image carried no usable
   *  entry date. Never merged into a day. */
  undatedAccuracy: AccuracyMetrics;
  reviewerAgreement: ReviewerAgreementRow[];
  crossTeamMatrix: CrossTeamMatrixCell[];
};

const ALL_SOURCES: ResultSource[] = [
  "levelOne",
  "levelTwo",
  "manual",
  "opposite",
  "liveMeans",
  "review",
];

const NON_REVIEW_SOURCES: Array<Exclude<ResultSource, "review">> = [
  "levelOne",
  "levelTwo",
  "manual",
  "opposite",
  "liveMeans",
];

function buildReviewerAgreement(comparisons: ImageResultComparison[]): ReviewerAgreementRow[] {
  return NON_REVIEW_SOURCES.map((source): ReviewerAgreementRow => {
    let comparable = 0;
    let agree = 0;
    let teamFlaggedReviewerClean = 0;
    let teamClearedReviewerFlagged = 0;
    for (const img of comparisons) {
      const teamResult = img.results[source];
      const review = img.results.review;
      if (teamResult === null || review === null) continue;
      comparable += 1;
      if (teamResult === review) {
        agree += 1;
      } else if (teamResult === "اشتباه" && review === "سليمة") {
        teamFlaggedReviewerClean += 1;
      } else {
        teamClearedReviewerFlagged += 1;
      }
    }
    const disagree = comparable - agree;
    return {
      source,
      comparable,
      agree,
      disagree,
      agreementRate: rate(agree, comparable),
      teamFlaggedReviewerClean,
      teamClearedReviewerFlagged,
    };
  });
}

type PairTally = { comparable: number; agree: number };

function pairKey(sourceA: ResultSource, sourceB: ResultSource): string {
  return `${sourceA}|${sourceB}`;
}

/**
 * Perf B2: one pass over `comparisons`, accumulating a
 * Map<"sourceA|sourceB", {comparable,agree}> for all 15 source pairs at
 * once, then materializing the 15 output cells from the map. Previously this
 * ran the C(6,2)=15 source pairs as an outer loop and rescanned the full
 * `comparisons` array once per pair (15 full scans). Per-pair counts are
 * plain integer sums, so accumulation order cannot change the result —
 * verified by an exact-equivalence test against the prior per-pair-scan
 * implementation in model.test.ts.
 */
function buildCrossTeamMatrix(comparisons: ImageResultComparison[]): CrossTeamMatrixCell[] {
  const tallies = new Map<string, PairTally>();
  for (const img of comparisons) {
    for (let i = 0; i < ALL_SOURCES.length; i++) {
      const sourceA = ALL_SOURCES[i];
      const a = img.results[sourceA];
      if (a === null) continue;
      for (let j = i + 1; j < ALL_SOURCES.length; j++) {
        const sourceB = ALL_SOURCES[j];
        const b = img.results[sourceB];
        if (b === null) continue;
        const key = pairKey(sourceA, sourceB);
        const existing = tallies.get(key);
        if (existing) {
          existing.comparable += 1;
          if (a === b) existing.agree += 1;
        } else {
          tallies.set(key, { comparable: 1, agree: a === b ? 1 : 0 });
        }
      }
    }
  }

  const cells: CrossTeamMatrixCell[] = [];
  for (let i = 0; i < ALL_SOURCES.length; i++) {
    for (let j = i + 1; j < ALL_SOURCES.length; j++) {
      const sourceA = ALL_SOURCES[i];
      const sourceB = ALL_SOURCES[j];
      const { comparable, agree } = tallies.get(pairKey(sourceA, sourceB)) ?? { comparable: 0, agree: 0 };
      cells.push({
        sourceA,
        sourceB,
        comparable,
        agree,
        disagree: comparable - agree,
        agreementRate: rate(agree, comparable),
      });
    }
  }
  return cells;
}

function buildEmployeeByPortAndLevel(
  records: DecisionRecord[],
  config: ExecutiveReportConfig
): EmployeeByPortLevel[] {
  const map = new Map<string, { inspectorId: string; level: "LEVEL_1" | "LEVEL_2"; portName: string; counts: Counts }>();
  for (const rec of records) {
    if (rec.outcomeClass === null) continue;
    if (rec.inspectorId === null) continue; // accuracy keyed on inspectorId (§3.4)
    const portName = rec.portName ?? "غير محدد";
    const key = `${rec.inspectorId}|${rec.decisionLevel}|${portName}`;
    const entry =
      map.get(key) ?? { inspectorId: rec.inspectorId, level: rec.decisionLevel, portName, counts: emptyCounts() };
    tally(entry.counts, rec.outcomeClass);
    map.set(key, entry);
  }
  return [...map.values()].map((e) => ({
    inspectorId: e.inspectorId,
    level: e.level,
    portName: e.portName,
    ...metricsFromCounts(e.counts, config),
  }));
}

function buildErrorTypeByPort(records: DecisionRecord[]): ErrorTypeBreakdown[] {
  const map = new Map<string, Counts>();
  for (const rec of records) {
    if (rec.outcomeClass === null) continue;
    const key = rec.portName ?? "غير محدد";
    const counts = map.get(key) ?? emptyCounts();
    tally(counts, rec.outcomeClass);
    map.set(key, counts);
  }
  return [...map.entries()].map(([key, c]) => ({
    key,
    correctClean: c.correctClean,
    correctSuspicion: c.correctSuspicion,
    missedSuspicion: c.missedSuspicion,
    falseSuspicion: c.falseSuspicion,
    evaluable: c.evaluable,
  }));
}

/**
 * Fold the fact table by day of month. Reuses `aggregateDecisions` — the ONE
 * shared fold — so a day's accuracy can never drift from the port page's, which
 * is exactly the class of bug three independent folds produced before.
 *
 * Undated records are keyed to a sentinel and split out afterwards rather than
 * being dropped: the page states the dated/undated split, so both halves must
 * survive the fold.
 */
const UNDATED_KEY = "__undated__";

function buildByEntryDay(
  records: DecisionRecord[],
  config: ExecutiveReportConfig
): { days: DayAccuracy[]; undated: AccuracyMetrics } {
  const map = aggregateDecisions(records, "decision", (r) =>
    typeof r.entryDay === "number" ? String(r.entryDay) : UNDATED_KEY
  , UNDATED_KEY);

  const undatedCounts = map.get(UNDATED_KEY) ?? emptyCounts();
  const days: DayAccuracy[] = [];
  for (const [key, counts] of map) {
    if (key === UNDATED_KEY) continue;
    days.push({ day: Number(key), ...metricsFromCounts(counts, config) });
  }
  days.sort((a, b) => a.day - b.day);
  return { days, undated: metricsFromCounts(undatedCounts, config) };
}

export function buildAggregates(
  records: DecisionRecord[],
  comparisons: ImageResultComparison[],
  config: ExecutiveReportConfig
): Aggregates {
  const entryDay = buildByEntryDay(records, config);
  return {
    byPort: foldBy(records, (r) => r.portName, config),
    byStage: foldBy(records, (r) => r.stage, config),
    byMovement: foldBy(records, (r) => r.movementType, config),
    byPortAndLevel: foldByPortAndLevel(records, config),
    employeeByPortAndLevel: buildEmployeeByPortAndLevel(records, config),
    errorTypeByPort: buildErrorTypeByPort(records),
    byEntryDay: entryDay.days,
    undatedAccuracy: entryDay.undated,
    reviewerAgreement: buildReviewerAgreement(comparisons),
    crossTeamMatrix: buildCrossTeamMatrix(comparisons),
  };
}

export { buildCrossTeamMatrix };
export type { Counts };
