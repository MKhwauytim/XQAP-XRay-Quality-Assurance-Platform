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

export type TeamResult = {
  result: "سليمة" | "اشتباه" | null;
  code: string | null;
  employeeId: string | null;
};

export type PreparedPopulationRow = {
  stage: string | null;
  xrayImageId: string;
  xrayEntryDate: string | null;

  portCode: string | null;
  portType: string | null;
  portName: string | null;

  declarationNumber: string | null;
  declarationDate: string | null;
  // Optional (unlike the fields above): added after many report/test fixtures
  // across the codebase already build a full PreparedPopulationRow literal by
  // hand, and processPopulation() always sets a concrete value here — making
  // these required would force every one of those unrelated fixtures to learn
  // about fields outside their concern.
  transitDeclarationNumber?: string | null;
  declarationHijriDate?: string | null;

  manifestNumber?: string | null;
  manifestType?: string | null;
  manifestDate?: string | null;

  plateOrContainerNumber: string | null;
  chassisNumber: string | null;
  finalDestination?: string | null;

  xrayLevelOneResult: "سليمة" | "اشتباه";
  xrayLevelTwoResult: "سليمة" | "اشتباه";

  movementType: string | null;
  movementNumber?: string | null;
  movementDate?: string | null;
  movementHijriDate?: string | null;
  reportNumber: string | null;

  entryDate?: string | null;
  exitDate?: string | null;

  targetedByRiskEngine: string | null;
  riskMessage: string | null;

  certScanStatus: CertScanMatchStatus;
  certScanSnippet: string | null;
  originalCertScanSnippet: string | null;

  levelOneEmployee: string | null;
  levelTwoEmployee: string | null;

  // Other (non-L1/L2) teams — optional corroborating evidence. A blank result is
  // `null` and never excludes the row (only L1/L2 gate population entry).
  // `manual` has no BI employee field, so its `employeeId` stays `null`.
  otherResults: {
    manual: TeamResult;
    opposite: TeamResult;
    liveMeans: TeamResult;
  };
  notes: string | null;

  biEnrichmentStatus: BiEnrichmentStatus;
  biMatched: boolean;
  biFilledFields: string[];

  rawRow?: Record<string, unknown>;
  sourceSheetName: string;
  sourceRowNumber: number;
};

/**
 * The subset of `PreparedPopulationRow` fields employee-facing sample views
 * actually render. Derived by reading the real JSX of every employee-facing
 * sample view (`src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx`,
 * `.../XrayReferrals/subComponents.tsx` (`buildXrayColumns`), and
 * `.../XrayInspectionResults.tsx` (`buildSampleColumns`)) — NOT from this type
 * definition, since a field existing on `PreparedPopulationRow` doesn't mean any
 * employee view reads it. `xrayImageId` is deliberately excluded: it's already
 * the top-level join key on `DistributionEntry` / sample-mirror entries, so it
 * doesn't need to be duplicated inside the row stub.
 *
 * This is the payload embedded directly in `DistributionEntry.row` (and, by
 * extension, `distribution.current.json`, `main.samples.json`, and every
 * `{username}.samples.json` mirror) instead of the full `PreparedPopulationRow`
 * — see `distributionDerivation.ts`'s `foldDistributionEvents`. An employee's
 * own mirror file must stay fully self-contained (renderable without ever
 * reading the population file), so every field an employee view reads must be
 * present here; anything not read by an employee view is deliberately left out
 * to keep the mirror small.
 *
 * Enforced mechanically (not just by convention) by
 * `employeeMirrorFields.contract.test.ts`, which scans the actual source of
 * the views listed above for `.row.<field>` / `e.row.<field>` accesses and
 * fails if one isn't listed here.
 */
export const EMPLOYEE_MIRROR_STUB_FIELDS = [
  "stage",
  "portName",
  "xrayEntryDate",
  "plateOrContainerNumber",
  "xrayLevelOneResult",
  "xrayLevelTwoResult",
  "certScanStatus",
  "declarationNumber",
  "declarationDate",
  "chassisNumber",
  "movementType",
  "portCode",
  "portType",
  "targetedByRiskEngine",
  "riskMessage",
  "biEnrichmentStatus",
  "reportNumber",
] as const satisfies readonly (keyof PreparedPopulationRow)[];

export type EmployeeMirrorStubField = (typeof EMPLOYEE_MIRROR_STUB_FIELDS)[number];

/** The row shape stored inline in `DistributionEntry.row` for new writes (B5). */
export type EmployeeMirrorRowStub = Pick<PreparedPopulationRow, EmployeeMirrorStubField>;

/** Projects a full `PreparedPopulationRow` down to the employee-mirror stub (B5). */
export function toEmployeeMirrorRowStub(row: PreparedPopulationRow): EmployeeMirrorRowStub {
  const stub = {} as EmployeeMirrorRowStub;
  for (const field of EMPLOYEE_MIRROR_STUB_FIELDS) {
    (stub as Record<EmployeeMirrorStubField, unknown>)[field] = row[field];
  }
  return stub;
}

/**
 * Drops `rawRow` (the full original Excel row, ~2x the size of everything
 * else on `PreparedPopulationRow` combined) before a row is written into a
 * disk-persisted collection this module owns (`sample.master.json`'s `rows`).
 * `rawRow` legitimately stays populated on the in-memory
 * `PopulationProcessingResult.preparedRows` the Population tab holds right
 * after processing — it feeds BI-enrichment (processing-time, fine) and the
 * live "export processed population" unmapped-columns feature
 * (`processing/populationExporter.ts`, reads it directly off that same
 * in-memory array) and the executive-report "Raw — Risk" sheet
 * (`reporting/executive/workbook/workbook.ts`) IF a caller ever fed it
 * in-memory rows instead of disk-loaded ones. `population.final.json` itself
 * already never persists `rawRow` (stripped in
 * `Tabs/Population/index.tsx`'s `commitSaveToDisk` before calling
 * `saveMonthRun`), so this helper only needs to guard the sample-draw write
 * path this module owns against the one real gap: `handleDrawSample` can run
 * `drawSample` on the freshly-processed, not-yet-saved in-memory rows
 * (which still carry `rawRow`), and without this strip that would land
 * `rawRow` in `sample.master.json` and, downstream, in every distribution/
 * mirror file derived from it.
 */
export function stripRawRow(row: PreparedPopulationRow): PreparedPopulationRow {
  if (!row.rawRow) return row;
  const rest = { ...row };
  delete rest.rawRow;
  return rest;
}

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
