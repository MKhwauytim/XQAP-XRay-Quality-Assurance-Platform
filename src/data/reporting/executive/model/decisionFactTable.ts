import type { ExecutiveReportRow } from "../../executiveReportTypes";
import type { DataSufficiencyBand } from "./dataSufficiency";

/**
 * Decision-level fact table (design spec §3.1).
 *
 * Each X-ray case carries exactly two of OUR decisions — Level 1 and Level 2 —
 * and each is owned by an inspector. We explode every `ExecutiveReportRow` into
 * 1–2 `DecisionRecord`s (one per level). We never emit decision records for the
 * other teams (manual / opposite / live-means): audit scope is L1/L2 only.
 *
 * Outcome classification is re-applied PER LEVEL independently against the study
 * reviewer's verdict (master §9 truth table), so L1 and L2 are scored separately.
 */

export type DecisionLevel = "LEVEL_1" | "LEVEL_2";

export type OutcomeClass =
  | "correct-clean"
  | "correct-suspicion"
  | "missed-suspicion"
  | "false-suspicion"
  | null;

export type ResultValue = "سليمة" | "اشتباه";

export type DecisionRecord = {
  periodId: string;
  xrayImageId: string;
  portCode: string | null;
  portName: string | null;
  portType: string | null;
  movementType: string | null;
  stage: string | null;
  decisionLevel: DecisionLevel;
  /** BI-mapped inspector ID (levelOneEmployeeId / levelTwoEmployeeId). `null`
   *  when BI did not match — accuracy aggregates surface the unmapped state. */
  inspectorId: string | null;
  employeeDecision: ResultValue;
  studyReviewResult: ResultValue | null;
  imageAvailable: boolean | null;
  markingAvailable: boolean | null;
  imageQuality: "عالي" | "متوسط" | "منخفض" | null;
  reviewCompleted: boolean;
  /** Master §9 evaluability rule: image exists + reviewer result + employee
   *  decision + employee id are all present. */
  decisionEvaluable: boolean;
  outcomeClass: OutcomeClass;
  /** App user who recorded the review (assignedTo). Workload context only — never
   *  treated as inspector accuracy. */
  reviewerId: string | null;
  assignedAt: string | null;
  completedAt: string | null;
  sourceRowNumber: number;
  /** Band of the inspector this record belongs to; populated by aggregates once
   *  per-inspector evaluable counts are known. Starts `null` here. */
  dataSufficiencyGroup: DataSufficiencyBand | null;
  /** Day of month from the image's entry date; `null` when undated. Optional —
   *  `reviewerKpis.test.ts` builds `DecisionRecord` literals by hand. */
  entryDay?: number | null;
  /** Whether the image's risk row carried a محضر number. */
  hasReport?: boolean;
};

export type ResultSource =
  | "levelOne"
  | "levelTwo"
  | "manual"
  | "opposite"
  | "liveMeans"
  | "review";

export type ImageResultComparison = {
  xrayImageId: string;
  portName: string | null;
  results: Record<ResultSource, ResultValue | null>;
  /** Agreement of each non-review source with the reviewer. Only set when BOTH
   *  that source and the reviewer have a result; otherwise `null` (renders `—`). */
  agreesWithReview: Partial<Record<Exclude<ResultSource, "review">, boolean | null>>;
};

/**
 * Master §9 outcome truth table, applied to one decision against the reviewer.
 * Returns `null` when the decision is not evaluable (no reviewer verdict).
 */
export function classifyOutcome(
  employeeDecision: ResultValue,
  reviewResult: ResultValue | null
): OutcomeClass {
  if (reviewResult === null) return null;
  if (employeeDecision === "سليمة" && reviewResult === "سليمة") return "correct-clean";
  if (employeeDecision === "اشتباه" && reviewResult === "اشتباه") return "correct-suspicion";
  if (employeeDecision === "سليمة" && reviewResult === "اشتباه") return "missed-suspicion";
  // employeeDecision === "اشتباه" && reviewResult === "سليمة"
  return "false-suspicion";
}

function buildLevelRecord(
  row: ExecutiveReportRow,
  periodId: string,
  level: DecisionLevel
): DecisionRecord {
  const isLevelOne = level === "LEVEL_1";
  const inspectorId = isLevelOne ? row.levelOneEmployeeId : row.levelTwoEmployeeId;
  const employeeDecision: ResultValue = isLevelOne ? row.levelOneResult : row.levelTwoResult;
  const studyReviewResult = row.expertResult;
  const reviewCompleted = row.answerStatus === "submitted";

  // Master §9 evaluability: image exists + reviewer result + employee decision +
  // employee id all present. `employeeDecision` is always present (L1/L2 gated at
  // population entry), so it never blocks evaluability here.
  const decisionEvaluable =
    row.imageAvailable === true &&
    studyReviewResult !== null &&
    inspectorId !== null;

  return {
    periodId,
    xrayImageId: row.xrayImageId,
    portCode: row.portCode,
    portName: row.portName,
    portType: row.portType,
    movementType: row.movementType,
    stage: row.stage,
    decisionLevel: level,
    inspectorId,
    employeeDecision,
    studyReviewResult,
    imageAvailable: row.imageAvailable,
    markingAvailable: row.hasMarking,
    imageQuality: row.imageQuality,
    reviewCompleted,
    decisionEvaluable,
    outcomeClass: classifyOutcome(employeeDecision, studyReviewResult),
    reviewerId: row.assignedTo,
    assignedAt: row.assignedAt,
    completedAt: row.submittedAt,
    sourceRowNumber: 0,
    dataSufficiencyGroup: null,
    entryDay: row.entryDay ?? null,
    hasReport: row.hasReport ?? false,
  };
}

/**
 * Explode each report row into its L1 and L2 decision records. Always two records
 * per case (population entry requires valid L1 and L2). If the same employee is at
 * both levels, two distinct records are still produced (one per level).
 */
export function buildDecisionRecords(
  rows: ExecutiveReportRow[],
  periodId: string
): DecisionRecord[] {
  const records: DecisionRecord[] = [];
  rows.forEach((row, index) => {
    const sourceRowNumber = index + 1;
    const l1 = buildLevelRecord(row, periodId, "LEVEL_1");
    const l2 = buildLevelRecord(row, periodId, "LEVEL_2");
    l1.sourceRowNumber = sourceRowNumber;
    l2.sourceRowNumber = sourceRowNumber;
    records.push(l1, l2);
  });
  return records;
}

// ── Unified aggregation entry point (2026-08-07) ────────────────────────────
//
// Three grains of "accuracy" exist in this report and must never be computed
// by independent folds again (see the 2026-08-07 edit log for the bug this
// fixes — a "port accuracy" figure that silently disagreed between the
// executive document/workbook and deck2/management editions for the SAME
// port in the SAME generation run):
//
//   - "decision": each `DecisionRecord` (L1 and L2 tallied SEPARATELY, one
//     record per decision) contributes to whatever bucket `keyOf` returns.
//     Whether this reads as "combined" (L1+L2 land in the same bucket, e.g.
//     `keyOf = r => r.portName`) or "per-level" (L1/L2 land in separate
//     buckets, e.g. `keyOf = r => \`${r.portName}|${r.decisionLevel}\``) is
//     entirely the caller's choice of key — there is no separate code path
//     for the two, because there is no real difference in the FOLD, only in
//     the GROUPING. This is what every target/threshold/rank decision in the
//     report is keyed to (master spec: audit scope is L1/L2, scored
//     independently).
//   - "image": L1 and L2 are first collapsed to ONE outcome per
//     `xrayImageId` — an image reads "اشتباه" if EITHER level flagged it,
//     the same OR-combination `buildExecutiveReportRows` uses for
//     `ExecutiveReportRow.imageResult` — then tallied once per image. This
//     is the grain for POPULATION-scope profiles ("how many images at this
//     port, how accurate were they as a population"), never for
//     target/threshold decisions: it structurally cannot see a level that
//     individually fails while the other level happens to catch the same
//     case (proven by the golden-master fixture in the edit log — a port
//     scoring 100% "excellent" at image grain while its own L1 decisions
//     scored 0% detection and the decision-combined grain scored 75%/"below
//     target").
//
// A record's `outcomeClass === null` (no reviewer verdict) is excluded at
// EVERY grain — the single evaluability rule from `classifyOutcome`, applied
// once here instead of re-derived per fold site.
export type Counts = {
  evaluable: number;
  correctClean: number;
  correctSuspicion: number;
  missedSuspicion: number;
  falseSuspicion: number;
};

export function emptyCounts(): Counts {
  return { evaluable: 0, correctClean: 0, correctSuspicion: 0, missedSuspicion: 0, falseSuspicion: 0 };
}

export function tallyOutcome(counts: Counts, outcome: OutcomeClass): void {
  if (outcome === null) return;
  counts.evaluable += 1;
  if (outcome === "correct-clean") counts.correctClean += 1;
  else if (outcome === "correct-suspicion") counts.correctSuspicion += 1;
  else if (outcome === "missed-suspicion") counts.missedSuspicion += 1;
  else if (outcome === "false-suspicion") counts.falseSuspicion += 1;
}

export function sumCounts(all: Counts[]): Counts {
  return all.reduce((acc, c) => {
    acc.evaluable += c.evaluable;
    acc.correctClean += c.correctClean;
    acc.correctSuspicion += c.correctSuspicion;
    acc.missedSuspicion += c.missedSuspicion;
    acc.falseSuspicion += c.falseSuspicion;
    return acc;
  }, emptyCounts());
}

export type AggregationGrain = "decision" | "image";

/**
 * Collapse L1+L2 `DecisionRecord`s (grouped by `xrayImageId`) into one
 * synthetic combined-verdict record per image, matching
 * `buildExecutiveReportRows`'s `imageResult` OR-combination exactly:
 * "اشتباه" if EITHER level said so. `outcomeClass` is re-derived via
 * `classifyOutcome` against the SAME `studyReviewResult` both level records
 * already carry (identical for L1/L2 of one row), so the evaluability gate
 * (reviewer verdict present) is preserved automatically — no separate
 * "verified" flag is needed.
 */
function collapseToImageRecords(records: DecisionRecord[]): DecisionRecord[] {
  const byImage = new Map<string, { l1?: DecisionRecord; l2?: DecisionRecord }>();
  for (const rec of records) {
    const entry = byImage.get(rec.xrayImageId) ?? {};
    if (rec.decisionLevel === "LEVEL_1") entry.l1 = rec;
    else entry.l2 = rec;
    byImage.set(rec.xrayImageId, entry);
  }
  const combined: DecisionRecord[] = [];
  for (const { l1, l2 } of byImage.values()) {
    const base = l1 ?? l2;
    if (!base) continue;
    const employeeDecision: ResultValue =
      l1?.employeeDecision === "اشتباه" || l2?.employeeDecision === "اشتباه" ? "اشتباه" : "سليمة";
    combined.push({
      ...base,
      employeeDecision,
      outcomeClass: classifyOutcome(employeeDecision, base.studyReviewResult),
    });
  }
  return combined;
}

/**
 * The single fold every port/stage/movement/level accuracy aggregate in the
 * report goes through. `keyOf` receives a `DecisionRecord` — for `"image"`
 * grain, the SYNTHETIC combined-verdict record (see `collapseToImageRecords`),
 * so `keyOf` never needs to know which grain it was called with; the grouping
 * key (whether it includes `decisionLevel` or not) is the only thing that
 * distinguishes "combined" from "per-level" callers at `"decision"` grain.
 */
export function aggregateDecisions(
  records: DecisionRecord[],
  grain: AggregationGrain,
  keyOf: (record: DecisionRecord) => string | null,
  fallbackKey = "غير محدد"
): Map<string, Counts> {
  const source = grain === "image" ? collapseToImageRecords(records) : records;
  const map = new Map<string, Counts>();
  for (const rec of source) {
    if (rec.outcomeClass === null) continue;
    const key = keyOf(rec) ?? fallbackKey;
    const counts = map.get(key) ?? emptyCounts();
    tallyOutcome(counts, rec.outcomeClass);
    map.set(key, counts);
  }
  return map;
}

/**
 * Build the per-image six-source comparison panel. Every image gets one record
 * carrying all six sources; `agreesWithReview` is only populated where both that
 * source and the reviewer have a result.
 */
export function buildImageComparisons(rows: ExecutiveReportRow[]): ImageResultComparison[] {
  return rows.map((row): ImageResultComparison => {
    const review = row.expertResult;
    const results: Record<ResultSource, ResultValue | null> = {
      levelOne: row.levelOneResult,
      levelTwo: row.levelTwoResult,
      manual: row.otherResults.manual.result,
      opposite: row.otherResults.opposite.result,
      liveMeans: row.otherResults.liveMeans.result,
      review,
    };

    const agreesWithReview: ImageResultComparison["agreesWithReview"] = {};
    const sources: Array<Exclude<ResultSource, "review">> = [
      "levelOne",
      "levelTwo",
      "manual",
      "opposite",
      "liveMeans",
    ];
    for (const source of sources) {
      const value = results[source];
      agreesWithReview[source] =
        value !== null && review !== null ? value === review : null;
    }

    return {
      xrayImageId: row.xrayImageId,
      portName: row.portName,
      results,
      agreesWithReview,
    };
  });
}
