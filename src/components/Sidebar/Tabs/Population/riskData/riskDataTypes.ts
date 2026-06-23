export type NormalizedRiskRow = {
  movementType: string;

  portCode: string | null;
  portName: string | null;
  portType: string | null;

  movementNumber: string | null;
  movementDate: string | null;
  movementHijriDate: string | null;

  declarationNumber: string | null;
  declarationDate: string | null;
  declarationHijriDate: string | null;

  manifestNumber: string | null;
  manifestType: string | null;

  plateOrContainerNumber: string | null;
  finalDestination: string | null;

  entryDate: string | null;
  exitDate: string | null;

  chassisNumber: string | null;
  reportNumber: string | null;
  hasReport: boolean;

  xrayLevelOneResult: string | null;
  xrayLevelTwoResult: string | null;
  inspectorResult: string | null;
  oppositeInspectorResult: string | null;
  liveMeansResult: string | null;

  xrayImageId: string | null;
  xrayEntryDate: string | null;

  targetedByRiskEngine: string | null;
  riskMessage: string | null;
  stage: string | null;

  rawRow?: RiskSourceRow;
  sourceSheetName: string;
  sourceRowNumber: number;
};

export type RiskSheetSummary = {
  sheetName: string;
  movementType: string;
  originalRowCount: number;
  normalizedRowCount: number;
  excludedMissingXrayIdCount: number;
};

export type RiskWorkbookResult = {
  rows: NormalizedRiskRow[];
  sheetSummaries: RiskSheetSummary[];
  unknownSheetNames: string[];
  totalOriginalRows: number;
  totalNormalizedRows: number;
  totalExcludedMissingXrayIdCount: number;
};

export type RiskSourceRow = Record<string, unknown>;