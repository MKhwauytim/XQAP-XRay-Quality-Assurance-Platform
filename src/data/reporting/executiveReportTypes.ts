import { MONTHLY_SAMPLE_TARGET } from "../population/populationConfig";
import type { PreparedPopulationRow } from "../population/populationTypes";
import type { SampleMasterData } from "../sampling/sampleTypes";
import type { DistributionCurrentData } from "../distribution/distributionTypes";
import type { EmployeeAnswerFile } from "../answers/answerTypes";

export type VerificationCategory =
  | "correct-suspicious"
  | "correct-clean"
  | "missed-suspicious"
  | "excess-suspicious";

export type ExecutiveReportRow = {
  xrayImageId: string;
  portName: string | null;
  stage: string | null;
  levelOneResult: "سليمة" | "اشتباه";
  levelTwoResult: "سليمة" | "اشتباه";
  imageResult: "سليمة" | "اشتباه";
  selectedInSample: boolean;
  assignedTo: string | null;
  distributionStatus: string | null;
  expertResult: "سليمة" | "اشتباه" | null;
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
  monthlyTarget: number;
  portProfiles: PortProfile[];
  stageProfiles: StageProfile[];
};

export type ExecutiveReportConfig = {
  monthlyTarget: number;
  accuracyTarget: number;
  completionTarget: number;
  coverageTarget: number;
  maximumMissedSuspicionRate: number;
  minimumReliableSampleSize: number;
  expertResultFieldId: string;
  showEmployeeNames: boolean;
};

export const DEFAULT_EXEC_CONFIG: ExecutiveReportConfig = {
  monthlyTarget: MONTHLY_SAMPLE_TARGET,
  accuracyTarget: 90,
  completionTarget: 95,
  coverageTarget: 7.5,
  maximumMissedSuspicionRate: 5,
  minimumReliableSampleSize: 30,
  expertResultFieldId: "qualityImageResult",
  showEmployeeNames: false,
};

export type ExecutiveReportInput = {
  monthFolderName: string;
  populationRows: PreparedPopulationRow[];
  sample: SampleMasterData | null;
  distribution: DistributionCurrentData | null;
  employeeFiles: EmployeeAnswerFile[];
  config: ExecutiveReportConfig;
};
