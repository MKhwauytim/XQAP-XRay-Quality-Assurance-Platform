import { MONTHLY_SAMPLE_TARGET } from "../population/populationConfig";
import type { PreparedPopulationRow } from "../population/populationTypes";
import type { SampleMasterData } from "../sampling/sampleTypes";
import type { DistributionCurrentData } from "../distribution/distributionTypes";
import type { EmployeeAnswerFile } from "../answers/answerTypes";
import type { TemplateSchema } from "../templates/templateTypes";
import type { DistributionEvent } from "../distribution/distributionTypes";
import type { SourceRevisions } from "./sourceRevisions";

export type VerificationCategory =
  | "correct-suspicious"
  | "correct-clean"
  | "missed-suspicious"
  | "excess-suspicious";

/** A single non-L1/L2 result source ("team") carried onto the report row for
 *  cross-team comparison. `result` is `null` when the team did not act on the
 *  image (renders `—`, never `0%`). */
export type OtherTeamResult = {
  result: "سليمة" | "اشتباه" | null;
  employeeId: string | null;
};

/** The three other-team result sources (manual / opposite / live-means) bridged
 *  from `PreparedPopulationRow.otherResults` onto the executive report row. */
export type OtherResultsPanel = {
  manual: OtherTeamResult;
  opposite: OtherTeamResult;
  liveMeans: OtherTeamResult;
};

export type ExecutiveReportRow = {
  xrayImageId: string;
  portCode: string | null;
  portName: string | null;
  portType: string | null;
  movementType: string | null;
  stage: string | null;
  levelOneEmployeeId: string | null;
  levelTwoEmployeeId: string | null;
  levelOneResult: "سليمة" | "اشتباه";
  levelTwoResult: "سليمة" | "اشتباه";
  imageResult: "سليمة" | "اشتباه";
  selectedInSample: boolean;
  assignedTo: string | null;
  distributionStatus: string | null;
  expertResult: "سليمة" | "اشتباه" | null;
  imageAvailable: boolean | null;
  noImageReason: string | null;
  hasMarking: boolean | null;
  imageQuality: "عالي" | "متوسط" | "منخفض" | null;
  lowQualityReason: string | null;
  suspicionLevel: "عالي" | "متوسط" | "منخفض" | null;
  suspectedTypes: string | null;
  smuggleMethod: string | null;
  answerStatus: "draft" | "submitted" | null;
  assignedAt: string | null;
  submittedAt: string | null;
  imageResultAccurate: boolean | null;
  levelOneAccurate: boolean | null;
  levelTwoAccurate: boolean | null;
  verificationCategory: VerificationCategory | null;
  /** Non-L1/L2 corroborating result sources, bridged from the population row. */
  otherResults: OtherResultsPanel;
  /** Level notes (ملاحظة المستويات) carried for traceability. */
  notes: string | null;
  /**
   * Day of month (1–31) from `xrayEntryDate`, or `null` when the value was not
   * a well-formed ISO date. Optional for the same reason
   * `PreparedPopulationRow.transitDeclarationNumber` is: nine test files build
   * a full `ExecutiveReportRow` literal by hand, and making these required
   * would force every one of them to learn about fields outside its concern.
   */
  entryDay?: number | null;
  /** A محضر (seizure report) number is present and non-blank on the risk row. */
  hasReport?: boolean;
  /**
   * RAW risk-engine targeting value, exactly as the risk file carried it. The
   * flag→verdict mapping lives in `src/data/population/riskEngineVerdict.ts`
   * (shared by the executive deck's risk-engine page and the employee
   * case-queue filter), NOT here — the real value vocabulary is unknown at
   * design time, so nothing upstream may assume what an affirmative looks
   * like.
   */
  targetedByRiskEngine?: string | null;
};

export type PortProfile = {
  portName: string;
  population: number;
  clean: number;
  suspicious: number;
  suspicionRate: number;
  sampleSize: number;
  coverage: number;
  studied: number;
  completionRate: number;
  /** IMAGE grain (L1 ∨ L2 combined verdict, one tally per image) — a
   *  population-scope description of "how accurate were the images at this
   *  port", NOT a target/threshold figure. `status` below is derived from the
   *  DECISION grain instead (`ReportModel.portAccuracy`), so this field is
   *  never named `.accuracy` — see `KeyedAccuracy.accuracyByDecision`'s doc
   *  comment (`executive/model/aggregates.ts`) for why the three port-accuracy
   *  grains on `ReportModel` must never share a field name. */
  accuracyByImage: number | null;
  /** IMAGE grain — see the doc comment on `accuracyByImage` above (and
   *  `KeyedAccuracy.accuracyByDecision`'s doc comment in `aggregates.ts`) for
   *  why this cannot share a field name with the DECISION-grain figures
   *  (`KeyedAccuracy.suspiciousDetectionRateByDecision` does not exist as a
   *  named field — the decision grain's equivalent is `detectionRate` — but
   *  `missedSuspicionRate` DOES collide across all three port-accuracy grains,
   *  which is exactly the naming hazard this suffix closes). */
  suspiciousDetectionRateByImage: number | null;
  missedSuspicionRateByImage: number | null;
  /** Decision-grain status (target/threshold compliance) — computed from
   *  `ReportModel.portAccuracy` (decision-combined), NOT from this profile's
   *  own `accuracyByImage`. See the 2026-08-07 edit log: the narrative
   *  "priority ports" callout used to cite the image-grain figure while every
   *  other target-facing page in the report cites the decision grain, so a
   *  port could read "excellent" in the narrative while reading "below
   *  target" on the port-comparison page for the exact same generation run. */
  status: "excellent" | "stable" | "monitor" | "priority" | "insufficient";
};

export type StageProfile = {
  stageKey: string;
  stageLabel: string;
  population: number;
  sampleSize: number;
  coverage: number;
  studied: number;
  completionRate: number;
};

export type ReasonCount = {
  reason: string;
  count: number;
  percentage: number;
};

export type ExecutiveKPIs = {
  totalPopulation: number;
  totalSample: number;
  sampleCoverage: number;
  studiedImages: number;
  remainingImages: number;
  completionRate: number;
  suspiciousCount: number;
  cleanCount: number;
  suspicionRate: number;
  overallAccuracy: number | null;
  /** IMAGE grain — see `PortProfile.suspiciousDetectionRateByImage`'s doc
   *  comment for why the port-accuracy grains must never share a field name. */
  suspiciousDetectionRateByImage: number | null;
  missedSuspicionRateByImage: number | null;
  suspicionPrecision: number | null;
  cleanConfirmationRate: number | null;
  excessSuspicionRate: number | null;
  balancedQualityScore: number | null;
  levelOneAccuracy: number | null;
  levelTwoAccuracy: number | null;
  levelDisagreementRate: number | null;
  levelTwoCorrectionRate: number | null;
  levelTwoRegressionRate: number | null;
  correctSuspicious: number;
  correctClean: number;
  missedSuspicious: number;
  excessSuspicious: number;
  validStudied: number;
  imagesWithSubmittedAnswers: number;
  imageAvailableCount: number;
  imageMissingCount: number;
  imageAvailabilityRate: number | null;
  markingPresentCount: number;
  markingMissingCount: number;
  markingRate: number | null;
  highQualityCount: number;
  mediumQualityCount: number;
  lowQualityCount: number;
  imageQualityEvaluatedCount: number;
  acceptableQualityRate: number | null;
  missingImageReasons: ReasonCount[];
  lowQualityReasons: ReasonCount[];
  monthlyTarget: number;
  portProfiles: PortProfile[];
  stageProfiles: StageProfile[];
};

export type ExecutiveReportFieldMappings = {
  hasImageLabel: string;
  noImageReasonLabel: string;
  hasMarkingLabel: string;
  imageQualityLabel: string;
  lowQualityReasonLabel: string;
  resultValidityLabel: string;
  suspicionLevelLabel: string;
  suspectedTypesLabel: string;
  smuggleMethodLabel: string;
};

/** Inclusive lower bounds (in evaluable-decision count) for the four data-sufficiency
 *  bands (spec §3.2 / blueprint §1.4). `none` is implicitly 0 (below `insufficient`).
 *  Defaults: insufficient 1–9, limited 10–19, sufficient 20+. Overridable; final
 *  thresholds need management approval. */
export type DataSufficiencyThresholds = {
  insufficient: number;
  limited: number;
  sufficient: number;
};

export const DEFAULT_DATA_SUFFICIENCY_THRESHOLDS: DataSufficiencyThresholds = {
  insufficient: 1,
  limited: 10,
  sufficient: 20,
};

export type ExecutiveReportConfig = {
  monthlyTarget: number;
  accuracyTarget: number;
  completionTarget: number;
  coverageTarget: number;
  maximumMissedSuspicionRate: number;
  minimumReliableSampleSize: number;
  dataSufficiencyThresholds: DataSufficiencyThresholds;
  expertResultFieldId: string;
  fieldMappings: ExecutiveReportFieldMappings;
  showEmployeeNames: boolean;
};

export const DEFAULT_EXEC_FIELD_MAPPINGS: ExecutiveReportFieldMappings = {
  hasImageLabel: "هل يوجد صورة",
  noImageReasonLabel: "سبب عدم وجود الصورة",
  hasMarkingLabel: "هل يوجد تحديد",
  imageQualityLabel: "مستوى جودة الصورة",
  lowQualityReasonLabel: "اسباب انخفاض جودة الصورة",
  resultValidityLabel: "صحة النتيجة",
  suspicionLevelLabel: "تقييم الاشتباه",
  suspectedTypesLabel: "الاصناف المشبوهة",
  smuggleMethodLabel: "الية التهريب المحتملة",
};

export const DEFAULT_EXEC_CONFIG: ExecutiveReportConfig = {
  monthlyTarget: MONTHLY_SAMPLE_TARGET,
  accuracyTarget: 90,
  completionTarget: 95,
  coverageTarget: 7.5,
  maximumMissedSuspicionRate: 5,
  minimumReliableSampleSize: 30,
  dataSufficiencyThresholds: DEFAULT_DATA_SUFFICIENCY_THRESHOLDS,
  expertResultFieldId: "qualityImageResult",
  fieldMappings: DEFAULT_EXEC_FIELD_MAPPINGS,
  showEmployeeNames: false,
};

export type ExecutiveReportInput = {
  monthFolderName: string;
  populationRows: PreparedPopulationRow[];
  sample: SampleMasterData | null;
  distribution: DistributionCurrentData | null;
  employeeFiles: EmployeeAnswerFile[];
  template: TemplateSchema | null;
  config: ExecutiveReportConfig;
  /**
   * Report-to-revision linkage (B2): source file name → `JsonEnvelope.metadata.revision`
   * captured at load time. Optional — legacy callers omit it and the footer renders nothing.
   */
  sourceRevisions?: SourceRevisions;
  /**
   * Raw distribution event history for the month (R3, management report).
   * `DistributionCurrentData.entries` is a folded snapshot — it keeps only the
   * CURRENT status per image, so a value like "how many times was this image
   * reassigned" is lost once folded. This is the compatibility-log projection
   * (`distribution.log.json`, see `loadDistributionLog`) read purely for
   * report-time counting; it is never re-folded into distribution state here.
   * Optional — omitted callers (sample/distribution/executive reports) simply
   * don't get reassignment counts.
   */
  distributionEvents?: DistributionEvent[];
  /**
   * xrayImageId → the reason recorded on its approved replacement/referral
   * request (R3, management report: "replacement counts with reasons shown").
   * Sourced from `ReplacementLog`/`ReferralLog` (`src/data/referral/`), which
   * persist `reason` independently of the distribution event fold — the fold
   * itself drops `DistributionEvent.notes`, so this is read from the original
   * request records instead of the folded distribution snapshot. Optional —
   * omitted callers show replaced images without a reason.
   */
  replacementReasons?: Record<string, string>;
};
