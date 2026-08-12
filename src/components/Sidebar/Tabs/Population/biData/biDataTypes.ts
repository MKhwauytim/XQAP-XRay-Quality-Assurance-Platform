export type NormalizedBiRow = {
  source: string;

  xrayImageId: string | null;
  xrayEntryDate: string | null;

  portType: string | null;
  portCode: string | null;
  portName: string | null;

  movementNumber: string | null;
  movementDate: string | null;
  movementHijriDate: string | null;

  declarationNumber: string | null;
  preliminaryDeclarationNumber: string | null;
  declarationDate: string | null;
  declarationHijriDate: string | null;

  inboundOutboundType: string | null;
  declarationType: string | null;
  declarationStatus: string | null;

  plateOrContainerNumber: string | null;
  chassisNumber: string | null;

  governance: string | null;

  levelOneEmployee: string | null;
  levelTwoEmployee: string | null;

  levelOneResultCode: string | null;
  levelTwoResultCode: string | null;

  levelOneResult: string | null;
  levelTwoResult: string | null;

  manualInspectionResultCode: string | null;
  manualInspectionResult: string | null;

  oppositeInspectionEmployee: string | null;
  oppositeInspectionResultCode: string | null;
  oppositeInspectionResult: string | null;

  liveMeansEmployee: string | null;
  liveMeansResultCode: string | null;
  liveMeansResult: string | null;

  notes: string | null;

  rawRow?: BiSourceRow;
  sourceSheetName: string;
  sourceRowNumber: number;
};

/**
 * Populated only when a sheet parsed at least one row but accepted zero of
 * them (every row excluded for a missing xray ID) — the "silent 0" failure
 * mode. Names the header candidates the xrayImageId alias list looked for
 * versus the headers actually present in the sheet, so the diagnosis is
 * visible in the UI instead of requiring a screenshot from the owner.
 */
export type ZeroXrayIdDiagnostic = {
  candidateHeaders: string[];
  presentHeaders: string[];
};

export type BiSheetSummary = {
  sheetName: string;
  source: string;
  originalRowCount: number;
  normalizedRowCount: number;
  excludedMissingXrayIdCount: number;
  zeroIdDiagnostic?: ZeroXrayIdDiagnostic;
};

export type BiWorkbookResult = {
  rows: NormalizedBiRow[];
  sheetSummaries: BiSheetSummary[];
  unknownSheetNames: string[];
  totalOriginalRows: number;
  totalNormalizedRows: number;
  totalExcludedMissingXrayIdCount: number;
};

export type BiSourceRow = Record<string, unknown>;