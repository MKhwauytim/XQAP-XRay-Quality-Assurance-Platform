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
