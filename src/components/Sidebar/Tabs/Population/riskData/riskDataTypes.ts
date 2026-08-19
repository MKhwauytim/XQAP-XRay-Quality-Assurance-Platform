export type NormalizedRiskRow = {
  movementType: string;

  portCode: string | null;
  portName: string | null;
  portType: string | null;

  movementNumber: string | null;
  movementDate: string | null;
  movementHijriDate: string | null;

  declarationNumber: string | null;
  transitDeclarationNumber: string | null;
  declarationDate: string | null;
  declarationHijriDate: string | null;

  manifestNumber: string | null;
  manifestType: string | null;
  manifestDate: string | null;

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

/**
 * Detection-only: two or more source headers in this sheet normalize to the
 * same key, so `createHeaderLookup`'s last-write-wins `Map.set` collapsed
 * them into one entry (`originals`, in the order they appeared, is the same
 * order they were `Map.set` — so the LAST entry is the one that actually won).
 * Precedence is untouched; this only reports that the collision happened.
 */
export type DuplicateHeaderCollision = {
  normalized: string;
  originals: string[];
};

export type RiskSheetSummary = {
  sheetName: string;
  movementType: string;
  originalRowCount: number;
  normalizedRowCount: number;
  excludedMissingXrayIdCount: number;
  zeroIdDiagnostic?: ZeroXrayIdDiagnostic;
  duplicateHeaders?: DuplicateHeaderCollision[];
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