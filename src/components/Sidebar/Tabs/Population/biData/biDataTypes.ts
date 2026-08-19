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
  /**
   * Name of the workbook/CSV this sheet came from. Populated by
   * `mergeBiWorkbookResults` when several BI files are appended into one
   * population, so two files that both contain a sheet called "بحري وارد"
   * stay distinguishable in the UI. Undefined for a single-file result.
   */
  sourceFileName?: string;
  source: string;
  /**
   * Whether `source` came from a configured sheet pattern (true) or from the
   * permissive fallback that uses the sheet's own name — for a CSV, the file
   * name (false). Advisory: false never means the rows were dropped.
   */
  sourceMatched?: boolean;
  originalRowCount: number;
  normalizedRowCount: number;
  excludedMissingXrayIdCount: number;
  zeroIdDiagnostic?: ZeroXrayIdDiagnostic;
};

export type BiWorkbookResult = {
  rows: NormalizedBiRow[];
  sheetSummaries: BiSheetSummary[];
  /**
   * Sheets EXCLUDED from the population — they contributed no rows. Consumers
   * treat a non-empty list as a problem to report.
   */
  unknownSheetNames: string[];
  /**
   * PROD-1: sheets that WERE imported but whose name matched no configured
   * pattern, so their `source` is the sheet's (or the CSV file's) own name.
   * Purely advisory — deliberately a separate array from `unknownSheetNames`,
   * which means the opposite.
   */
  unmatchedSheetNames: string[];
  totalOriginalRows: number;
  totalNormalizedRows: number;
  totalExcludedMissingXrayIdCount: number;
};

export type BiSourceRow = Record<string, unknown>;

/**
 * One attached BI file in the Phase-1 upload list (design handoff 2b).
 *
 * Multiple BI files are DIFFERENT populations that share the same sheet
 * patterns and column mappings; they are appended into one BI population, not
 * deduplicated. The "N من 10" pill and the accepted-rows total are derived
 * from this array on render — never stored.
 */
export type BiUploadEntry = {
  id: string;
  file: File;
  /** Display sub-line: derived from the file name until parsed, then the sheets it contributed. */
  sheetName: string;
  sizeBytes: number;
  acceptedRows: number | null;
  state: "parsing" | "ready" | "error";
  error?: string;
  /**
   * PROD-1: a non-blocking advisory on an otherwise successful file — today,
   * "its rows were imported, but the source was taken from the file name
   * because it matched no configured pattern". Distinct from `error`: the file
   * is `ready`, its rows are in the population, and the row renders amber
   * rather than red.
   */
  warning?: string;
};

/** Hard cap on attached BI files (design handoff 2b). */
export const MAX_BI_UPLOADS = 10;