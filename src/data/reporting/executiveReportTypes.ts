import { MONTHLY_SAMPLE_TARGET } from "../population/populationConfig";
import type { PreparedPopulationRow } from "../population/populationTypes";
import type { SampleMasterData } from "../sampling/sampleTypes";
import type { DistributionCurrentData } from "../distribution/distributionTypes";
import type { EmployeeAnswerFile } from "../answers/answerTypes";
import type { TemplateSchema } from "../templates/templateTypes";

export type VerificationCategory =
  | "correct-suspicious"
  | "correct-clean"
  | "missed-suspicious"
  | "excess-suspicious";

export type ExecutiveReportRow = {
  xrayImageId: string;
  portName: string | null;
  portType: string | null;
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
  accuracy: number | null;
  suspiciousDetectionRate: number | null;
  missedSuspicionRate: number | null;
  levelOneAccuracy: number | null;
  levelTwoAccuracy: number | null;
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
  suspiciousDetectionRate: number | null;
  missedSuspicionRate: number | null;
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

export type ExecutiveReportConfig = {
  monthlyTarget: number;
  accuracyTarget: number;
  completionTarget: number;
  coverageTarget: number;
  maximumMissedSuspicionRate: number;
  minimumReliableSampleSize: number;
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
};
