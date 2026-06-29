export type CertScanEntry = {
  portName: string;
  originalSystemSerialNumber: string;
  snippets: string[];
};

export type CertScanMatchStatus = "Certscan" | "NonCertscan";

export type BiEnrichmentStatus =
  | "BI Not Provided"
  | "BI Matched"
  | "BI Not Matched";

export type PreparedPopulationRow = {
  stage: string | null;
  xrayImageId: string;
  xrayEntryDate: string | null;

  portCode: string | null;
  portType: string | null;
  portName: string | null;

  declarationNumber: string | null;
  declarationDate: string | null;

  plateOrContainerNumber: string | null;
  chassisNumber: string | null;

  xrayLevelOneResult: "سليمة" | "اشتباه";
  xrayLevelTwoResult: "سليمة" | "اشتباه";

  movementType: string | null;
  reportNumber: string | null;

  targetedByRiskEngine: string | null;
  riskMessage: string | null;

  certScanStatus: CertScanMatchStatus;
  certScanSnippet: string | null;
  originalCertScanSnippet: string | null;

  levelOneEmployee: string | null;
  levelTwoEmployee: string | null;

  biEnrichmentStatus: BiEnrichmentStatus;
  biMatched: boolean;
  biFilledFields: string[];

  rawRow?: Record<string, unknown>;
  sourceSheetName: string;
  sourceRowNumber: number;
};

export type RemovedPopulationRow = {
  reason: string;
  xrayImageId: string | null;
  portName: string | null;
  sourceSheetName: string | null;
  sourceRowNumber: number | null;
};

export type BiFieldFillSummary = {
  fieldName: string;
  riskEmptyBefore: number;
  filledFromBi: number;
  stillEmptyAfter: number;
  fillPercentage: number;
};

export type ProcessingSummary = {
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

  biFieldFillSummary: BiFieldFillSummary[];
};

export type PopulationProcessingResult = {
  preparedRows: PreparedPopulationRow[];
  removedRows: RemovedPopulationRow[];
  duplicateRows: RemovedPopulationRow[];
  invalidResultRows: RemovedPopulationRow[];
  summary: ProcessingSummary;
};
