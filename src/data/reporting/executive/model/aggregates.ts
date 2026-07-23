import type { ExecutiveReportConfig } from "../../executiveReportTypes";
import { band } from "./dataSufficiency";
import type { DataSufficiencyBand } from "./dataSufficiency";
import type {
  DecisionRecord,
  ImageResultComparison,
  OutcomeClass,
  ResultSource,
} from "./decisionFactTable";

/**
 * Folds the decision fact table + image comparisons into the aggregate views the
 * report consumes (design spec §3.3). Counts here come from the per-decision
 * granularity (1–2 records/case); the image-level port/stage *population* profiles
 * are produced by `calculateExecutiveKPIs` and are NOT recomputed here.
 *
 * Honesty discipline (§3.7): every rate is `number | null`; a `null` denominator
 * yields `null` (renders `—`), never `0%`.
 */

type Counts = {
  evaluable: number;
  correctClean: number;
  correctSuspicion: number;
  missedSuspicion: number;
  falseSuspicion: number;
};

function emptyCounts(): Counts {
  return { evaluable: 0, correctClean: 0, correctSuspicion: 0, missedSuspicion: 0, falseSuspicion: 0 };
}

function tally(counts: Counts, outcome: OutcomeClass): void {
  if (outcome === null) return;
  counts.evaluable += 1;
  if (outcome === "correct-clean") counts.correctClean += 1;
  else if (outcome === "correct-suspicion") counts.correctSuspicion += 1;
  else if (outcome === "missed-suspicion") counts.missedSuspicion += 1;
  else if (outcome === "false-suspicion") counts.falseSuspicion += 1;
}

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

export type KeyedAccuracy = AccuracyMetrics & { key: string };

function foldBy(
  records: DecisionRecord[],
  keyOf: (r: DecisionRecord) => string | null,
  config: ExecutiveReportConfig,
  fallbackKey = "غير محدد"
): KeyedAccuracy[] {
  const map = new Map<string, Counts>();
  for (const rec of records) {
    if (rec.outcomeClass === null) continue;
    const key = keyOf(rec) ?? fallbackKey;
    const counts = map.get(key) ?? emptyCounts();
    tally(counts, rec.outcomeClass);
    map.set(key, counts);
  }
  return [...map.entries()].map(([key, counts]) => ({ key, ...metricsFromCounts(counts, config) }));
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
  employeeByPortAndLevel: EmployeeByPortLevel[];
  errorTypeByPort: ErrorTypeBreakdown[];
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

export function buildAggregates(
  records: DecisionRecord[],
  comparisons: ImageResultComparison[],
  config: ExecutiveReportConfig
): Aggregates {
  return {
    byPort: foldBy(records, (r) => r.portName, config),
    byStage: foldBy(records, (r) => r.stage, config),
    byMovement: foldBy(records, (r) => r.movementType, config),
    employeeByPortAndLevel: buildEmployeeByPortAndLevel(records, config),
    errorTypeByPort: buildErrorTypeByPort(records),
    reviewerAgreement: buildReviewerAgreement(comparisons),
    crossTeamMatrix: buildCrossTeamMatrix(comparisons),
  };
}

export { metricsFromCounts, emptyCounts, tally, buildCrossTeamMatrix };
export type { Counts };
