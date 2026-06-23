import type { BiWorkbookResult } from "../biData/biDataTypes";
import type { PopulationProcessingResult } from "../processing/populationProcessingTypes";
import type { RiskWorkbookResult } from "../riskData/riskDataTypes";

export type PopulationReportScope = "phase-2" | "phase-3" | "phase-4";

export type PopulationReportStatus =
  | "receipt-only"
  | "ready-for-next-phase"
  | "usable-with-notes"
  | "not-ready";

export type WorkbookReceiptReport = {
  title: string;
  provided: boolean;
  totalOriginalRows: number;
  totalNormalizedRows: number;
  totalExcludedRows: number;
  sheetCount: number;
  unknownSheetNames: string[];
  sheets: WorkbookSheetReport[];
};

export type WorkbookSheetReport = {
  sheetName: string;
  originalRowCount: number;
  normalizedRowCount: number;
  excludedMissingXrayIdCount: number;
};

export type RiskStageDistributionRow = {
  sheetName: string;
  first: number;
  second: number;
  third: number;
  fourth: number;
  unknown: number;
  totalAccepted: number;
};

export type ProcessingReport = {
  riskOriginalRows: number;
  validRiskIdRows: number;
  invalidRiskIdRows: number;

  duplicateRiskIdRows: number;
  rowsAfterDeduplication: number;

  removedInvalidResultRows: number;
  finalPreparedPopulationRows: number;

  certScanRows: number;
  nonCertScanRows: number;
  certScanPercentage: number;
  nonCertScanPercentage: number;

  biProvided: boolean;
  biMatchedRows: number;
  biUnmatchedRows: number;
  biMatchPercentage: number;
  totalBiFilledFields: number;

  reconciliationExpectedFinalRows: number;
  reconciliationDifference: number;
};

export type BiFillReportRow = {
  fieldName: string;
  riskEmptyBefore: number;
  filledFromBi: number;
  stillEmptyAfter: number;
  fillPercentage: number;
};

export type BiRiskFieldComparisonRow = {
  fieldName: string;
  matchedCount: number;
  differentCount: number;
  totalComparedCount: number;
  matchPercentage: number;
};

export type BiRiskComparisonSampleRow = {
  xrayImageId: string;
  portName: string;
  differentFields: string[];
};

export type BiRiskComparisonReport = {
  totalMatchedRecords: number;
  matchedWithoutDifferences: number;
  matchedWithDifferences: number;
  overallMatchPercentage: number;
  fieldComparisons: BiRiskFieldComparisonRow[];
  sampleDifferentRows: BiRiskComparisonSampleRow[];
};

export type PopulationReportData = {
  title: string;
  scope: PopulationReportScope;

  generatedDate: string;
  generatedTime: string;
  generatedMonth: string;

  phaseLabel: string;

  status: PopulationReportStatus;
  statusLabel: string;
  statusMessage: string;

  riskReceipt: WorkbookReceiptReport | null;
  biReceipt: WorkbookReceiptReport;

  riskStageDistribution: RiskStageDistributionRow[];
  riskStageDistributionTotals: RiskStageDistributionRow | null;

  processing: ProcessingReport | null;
  biFillSummary: BiFillReportRow[];

  biRiskComparison: BiRiskComparisonReport;

  hasRiskData: boolean;
  hasBiData: boolean;
  hasProcessingData: boolean;
};

export type BuildPopulationReportInput = {
  scope: PopulationReportScope;
  riskWorkbookResult: RiskWorkbookResult | null;
  biWorkbookResult: BiWorkbookResult | null;
  populationProcessingResult: PopulationProcessingResult | null;
};