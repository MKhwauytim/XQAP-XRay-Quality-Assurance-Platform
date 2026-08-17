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
 *
 * B7 (OOM fix, 2026-08-12): `rawRow` may be a lazily-computed accessor
 * property (see `attachLazyRawRow` below) rather than a plain data property —
 * `processPopulation` defers the BI-merge until something actually reads
 * `rawRow`, specifically so bulk strip operations like this one never force
 * that merge across the whole population. Do NOT read `row.rawRow` here (not
 * even for a truthiness check) — that alone would materialize every row's
 * merged object right as the population is at its largest. Enumerate own keys
 * instead, which never touches the accessor's getter.
 */
export function stripRawRow(row: PreparedPopulationRow): PreparedPopulationRow {
  if (!Object.prototype.hasOwnProperty.call(row, "rawRow")) return row;
  const rest = {} as PreparedPopulationRow;
  for (const key of Object.keys(row) as (keyof PreparedPopulationRow)[]) {
    if (key === "rawRow") continue;
    (rest as Record<string, unknown>)[key] = row[key];
  }
  return rest;
}

/**
 * B7 (OOM fix, 2026-08-12): attaches `rawRow` to a freshly-built
 * `PreparedPopulationRow` as a lazy, uncached accessor instead of a plain
 * data property. Only `populationProcessor.ts` calls this, right after
 * building each row.
 *
 * Why: `enrichDraftRowFromBi` used to eagerly build the BI-merged `rawRow` by
 * spreading the risk row's full raw record and overlaying any BI-filled
 * extras — a brand-new, full-size copy of the raw row for every BI-matched
 * row. With a 130k-row risk sheet and a 247k-row BI sheet both legitimately
 * resident (see the BI truthiness-bug fix in 301e84d4), that copy doubled the
 * standing memory cost of the already-dominant `rawRow` field and was the
 * proximate cause of a browser-tab OOM during Phase 2 processing.
 *
 * `base` is the SAME object reference as the source risk row's `rawRow` — it
 * is never copied here. `extras` holds only the keys BI actually added or
 * overrode (a small delta, not a full row). The two are merged into a new
 * object only when something reads `.rawRow`, and every read recomputes
 * fresh rather than caching, so a one-off export or report build doesn't
 * permanently re-inflate the row's resident size afterward. Consumers that
 * only need to know "does this row have unmapped raw data at all" without
 * needing the values (`stripRawRow` above) must never touch `.rawRow` itself.
 */
export function attachLazyRawRow(
  row: PreparedPopulationRow,
  base: Record<string, unknown> | undefined,
  extras: Record<string, unknown> | null
): void {
  if (!extras || Object.keys(extras).length === 0) {
    // Same non-enumerable contract as the extras branch below — this branch is
    // the COMMON one (risk-only imports, BI-unmatched rows, matches with no
    // extra keys), and a plain `row.rawRow = base` assignment here re-created
    // an enumerable own property (the row literal declares `rawRow: undefined`),
    // silently reversing the v98.1 guarantee: `streamJsonStringify` enumerates
    // with Object.keys, so the full original Excel row was serialized into
    // population.final.json for every such row.
    Object.defineProperty(row, "rawRow", {
      enumerable: false,
      configurable: true,
      writable: true,
      value: base,
    });
    return;
  }
  Object.defineProperty(row, "rawRow", {
    // NON-enumerable, and that is what removes the save-path OOM.
    //
    // `JSON.stringify`, `streamJsonStringify` (jsonEnvelope.ts:86) and
    // `Object.keys` all skip non-enumerable properties, so the getter is never
    // invoked during a write and `rawRow` never reaches disk — which is exactly
    // what `stripRawRow`'s defensive copy was buying, except the copy paid for
    // it by duplicating the entire population.
    //
    // Measured on a realistic 45-field row: 300k prepared rows are ~626 MB, and
    // `preparedRows.map(stripRawRow)` added ~490 MB on top while React still
    // held the originals — ~1.8 GB at 500k rows, which kills the tab mid-save.
    // With this flag the caller passes `preparedRows` straight through and the
    // second array never exists.
    //
    // Direct access (`row.rawRow`) is unaffected — enumerability governs
    // enumeration, not reads — so populationExporter.ts and columnMappingHints
    // keep working unchanged.
    enumerable: false,
    configurable: true,
    get(): Record<string, unknown> {
      return { ...(base ?? {}), ...extras };
    }
  });
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
  /** W-owner-2026-08-12c: whether any CertScan device entries were successfully
   *  parsed from the pasted reference text (`certScanEntries.length > 0` in
   *  `populationProcessor.ts`) — distinguishes "no CertScan reference supplied
   *  for this run" from "supplied but matched zero rows", which a bare
   *  `certScanRows: 0` cannot. Optional: older persisted aggregates / report
   *  fixtures/builders that predate this field simply omit it, and UI consumers
   *  must treat `undefined` as "unknown", not as either true or false. */
  certScanProvided?: boolean;

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
