/**
 * The ad-hoc import module's OWN type contract (rework revision 2, owner
 * correction C1 — see `docs/architecture/ADHOC_IMPORT_REWORK_PLAN_2026-08-21.md`).
 *
 * Why this file exists rather than more fields on `adhocImportTypes.ts`:
 * the legacy record types the current tab still runs on describe their mapped
 * row as `NormalizedRiskRow`, a type owned by the Population tab's risk-ingest
 * subtree (`src/components/Sidebar/Tabs/Population/riskData/`). That coupling
 * is the defect C1 names — a data-layer module depending on a component
 * subtree, with the ad-hoc record's on-disk shape defined by the regular
 * pipeline's ingest type, and column aliases read LIVE from
 * `populationConfig.mappingTemplates[0]` so an admin editing the Population
 * mapping silently changes how an already-saved ad-hoc file parses.
 *
 * Everything here is therefore self-contained: no import from
 * `src/components/**`, and nothing that reaches back into the Population
 * pipeline. Ad-hoc still *links into* the distribution machinery
 * (`buildAssignEvent` / `appendDistributionEvents` / `upsertItemAnswer` / …),
 * but that traffic is confined to `adhocDistributionBridge.ts` — one seam,
 * reviewable in one sitting — and the modules typed by this file stay pure.
 *
 * `adhocImportTypes.ts` (v1) is deliberately left untouched while the new
 * modules are built against this contract, so the repo keeps compiling
 * throughout; the migration of the record itself happens in one step once the
 * pure layers exist.
 */

/* ────────────────────────────────────────────────────────────────────────────
 * 1 — Source tables (file upload OR Excel paste)
 * ──────────────────────────────────────────────────────────────────────────── */

export type SourceRow = {
  /**
   * 1-based line number in the user's actual spreadsheet, blank rows included.
   * Load-bearing for diagnostics: a reason string that says "row 412" has to
   * send the operator to line 412 of THEIR file, not to the 412th non-blank
   * row. `worksheetToSourceRows` preserves this via `blankrows: true`.
   */
  sourceRowNumber: number;
  values: Record<string, unknown>;
};

/**
 * One parsed table — a worksheet, or a single pasted block. Headers are kept
 * separately from the rows (rather than derived from `Object.keys`) because a
 * column that is entirely blank below its header is dropped from the row
 * objects but must still be offerable in the mapping UI.
 */
export type SourceTable = {
  /** Worksheet name, or `PASTE_SHEET_NAME` for pasted input. */
  sheetName: string;
  headers: string[];
  rows: SourceRow[];
};

/** Sheet name stamped on a pasted table, so `rowKey` reads sensibly for it. */
export const PASTE_SHEET_NAME = "لصق";

/* ────────────────────────────────────────────────────────────────────────────
 * 2 — Field catalog
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * How a field's raw cell text is coerced and validated.
 *
 * - `text`  — trimmed string, no further constraint
 * - `date`  — trimmed string; not parsed into a Date (the rest of the app
 *             stores these as opaque display strings, and reformatting them
 *             here would silently change what the operator's file said)
 * - `enum`  — must resolve to one of `options` after value-mapping
 * - `month` — resolved to a `{m}-{monthname}-{yyyy}` folder name
 */
export type AdhocFieldKind = "text" | "date" | "enum" | "month";

export type AdhocField = {
  /** Matches the `PreparedPopulationRow` property this field feeds, where one exists. */
  key: string;
  labelAr: string;
  required: boolean;
  kind: AdhocFieldKind;
  /** `kind: "enum"` only — the canonical values a mapped value must resolve to. */
  options?: string[];
  /**
   * Header names used ONLY to pre-fill the auto-mapping. Never a parsing rule:
   * once the admin confirms step 2, the resolved `ImportMapping` is what parses
   * the file, and it is snapshotted into the import record.
   */
  seedAliases: string[];
};

/* ────────────────────────────────────────────────────────────────────────────
 * 3 — Mapping
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Where one field's value comes from.
 *
 * `constant` is what keeps `xrayLevelOneResult` / `xrayLevelTwoResult` strictly
 * typed (`"سليمة" | "اشتباه"`, read by 25 non-test files) without widening the
 * union for bare image-list imports: the admin explicitly declares "every row
 * in this file is سليمة", recorded here and attributable to a person, rather
 * than the app inventing a value per row. It also covers "this whole file is
 * المستوى الثاني" and "this whole file is Certscan".
 *
 * `none` on a required field is not an error at mapping time — it makes every
 * row invalid, visibly, in the review table.
 */
export type FieldSource =
  | { kind: "column"; header: string }
  | { kind: "constant"; value: string }
  | { kind: "none" };

/** Raw source value → canonical value, for one `kind: "enum"` field. */
export type ValueMapping = Record<string, string>;

export type ImportMapping = {
  /** `AdhocField.key` → source. */
  fields: Record<string, FieldSource>;
  /** `AdhocField.key` → per-value normalization. Only meaningful for `kind: "enum"`. */
  valueMappings: Record<string, ValueMapping>;
  /** `TemplateField.fieldId` → source. Historical study imports only. */
  templateFields?: Record<string, FieldSource>;
};

/** How a field's source was decided — surfaced as a chip in the mapping UI. */
export type FieldMappingOrigin = "auto" | "manual" | "constant" | "none";

/* ────────────────────────────────────────────────────────────────────────────
 * 4 — Projected rows
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * A source row after mapping: `AdhocField.key` → resolved value, or null when
 * the field is unmapped or its cell was blank.
 *
 * Replaces v1's `NormalizedRiskRow` (C1). A plain string bag rather than a
 * struct because the field catalog is data, not a fixed shape — an admin-added
 * field must not require a type change.
 */
export type AdhocMappedRow = Record<string, string | null>;

export type AdhocRowValidation =
  | { valid: true }
  | { valid: false; reason: string };

export type AdhocRowAssignment = {
  username: string;
  /**
   * 0 for every ordinary assignment. Only fan-out mode produces k > 0, one
   * replica per reviewer — see `namespacedXrayImageId`.
   */
  replicaIndex: number;
  xrayImageId: string;
  assignedAt: string;
};

export type AdhocRow = {
  /** Stable within an import: `${sheetName}:${sourceRowNumber}`. */
  rowKey: string;
  mapped: AdhocMappedRow;
  validation: AdhocRowValidation;
  /** Admin review toggle — "do not assign", independent of `validation`. */
  excludedByAdmin: boolean;
  /**
   * Every assignment this row currently carries. A row assigned to one
   * employee has exactly one entry; a fanned-out row has one per reviewer.
   * Replaces v1's `assigned` / `assignedTo` / `assignedAt` / `namespacedXrayImageId`
   * scalars, which cannot represent fan-out at all.
   */
  assignments: AdhocRowAssignment[];
  /**
   * Resolved month for a `monthBinding.kind === "column"` import, per row.
   * Absent for the other two binding kinds (the record's binding answers it),
   * and absent when this row's month column was blank or unparseable — such a
   * row stays valid but falls back to isolated.
   */
  linkedMonthFolder?: string;
};

/* ────────────────────────────────────────────────────────────────────────────
 * 5 — Month binding
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Which month, if any, an import's rows belong to (owner correction C3).
 *
 * A binding is a LABEL, not a write target. All three kinds store under
 * `2-samples/adhoc-{importId}/`. A real month's `sample.master.json` records
 * the `rngSeed`, `drawnAt`, `samplingAlgorithmVersion` and `portAllocations`
 * of one specific seeded draw; appending rows nobody drew makes that draw
 * un-replayable and its audit trail wrong. Linking surfaces the rows under the
 * month without destroying what the month means.
 */
export type AdhocMonthBinding =
  /** Default. Invisible to month-scoped views. */
  | { kind: "isolated" }
  /** One file per month, month chosen in the UI at import time. */
  | { kind: "month"; monthFolderName: string }
  /** Derived per row from a mapped month field (e.g. `studyMonth` / شهر الفحص). */
  | { kind: "column"; fieldKey: string };

/* ────────────────────────────────────────────────────────────────────────────
 * 6 — Records
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * What the file is, which decides how strict validation is:
 * - `population` — a population extract; L1/L2 expected
 * - `sample`     — an already-drawn sample / bare image list to be reviewed
 * - `historical` — an already-ANSWERED study being back-filled
 */
export type AdhocImportKind = "population" | "sample" | "historical";

export type AdhocSourceKind = "file" | "paste";

export type AdhocImportStatus = "open" | "closed";

export type AdhocRecord = {
  importId: string;
  schemaVersion: 2;
  fileName: string;
  importedBy: string;
  importedAt: string;
  status: AdhocImportStatus;
  closedBy?: string;
  closedAt?: string;

  kind: AdhocImportKind;
  sourceKind: AdhocSourceKind;

  /**
   * The mapping actually used, snapshotted. Re-reading the workspace's current
   * Population aliases at load time is exactly the G8 defect: it would let a
   * later edit to an unrelated screen retroactively change how this import's
   * rows parsed.
   */
  mapping: ImportMapping;
  /** The catalog the mapping's keys refer to, snapshotted alongside it. */
  fieldCatalog: AdhocField[];

  monthBinding: AdhocMonthBinding;

  /** Historical imports only. */
  templateId?: string;
  templateVersion?: number;

  rows: AdhocRow[];

  /** Monotonic CAS revision, mirroring `templateStorage.ts`. */
  revision?: number;
  _writeToken?: string;
};

export type AdhocIndexEntry = {
  importId: string;
  fileName: string;
  importedBy: string;
  importedAt: string;
  status: AdhocImportStatus;
  kind: AdhocImportKind;
  totalRows: number;
  validRows: number;
  /**
   * Number of ASSIGNMENTS, not rows. For every mode but fan-out these are the
   * same number; under fan-out a 500-row import assigned to 6 reviewers reports
   * 3,000. `loadAdhocEntriesForEmployeeView` only uses this as a
   * "> 0 — worth opening" test, which stays correct either way.
   */
  assignedRows: number;
  /**
   * Every month this import's rows link to. Empty for an isolated import.
   * Present on the index so a month-scoped reader can skip irrelevant imports
   * without opening each one.
   */
  linkedMonths: string[];
};

/* ────────────────────────────────────────────────────────────────────────────
 * 7 — Assignment planning
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * - `explicit`   — the admin ticked rows and picked one employee (v1 behavior)
 * - `count`      — N rows each, for the chosen employees
 * - `percentage` — weighted split, equal weights by default
 * - `fanout`     — EVERY eligible row to EVERY chosen employee, one replica
 *                  each, so each reviewer answers independently
 */
export type AssignmentMode = "explicit" | "count" | "percentage" | "fanout";

export type AssignmentTarget = {
  username: string;
  /** `percentage` mode. Omitted → equal weight. */
  weight?: number;
  /** `count` mode. */
  count?: number;
};

export type PlannedAssignment = {
  rowKey: string;
  username: string;
  replicaIndex: number;
  /** Namespaced + replica-aware; see `namespacedXrayImageId`. */
  xrayImageId: string;
};

export type AssignmentPlan = {
  plan: PlannedAssignment[];
  /**
   * Eligible rows the plan did not place — i.e. `pool.length` minus the number
   * of distinct rows that ended up in `plan`. Reported, never silently padded
   * or dropped.
   *
   * This is NOT a shortfall counter, and the two are easy to confuse. Count
   * mode asking for FEWER rows than the pool holds leaves the remainder here.
   * Count mode asking for MORE places every eligible row, so `leftover` is 0
   * and the unmet request surfaces only through `errors`.
   */
  leftover: number;
  errors: string[];
};

/* ────────────────────────────────────────────────────────────────────────────
 * 8 — Identity
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * The whole collision-avoidance mechanism, and the whole fan-out mechanism.
 *
 * A real population's xrayImageId is always the bare value off the risk sheet
 * (never prefixed), so the `ADHOC-` prefix makes a clash structurally
 * impossible rather than merely unlikely.
 *
 * `replicaIndex 0` intentionally produces the EXACT v1 string, so every
 * assignment already on disk stays valid and only fan-out introduces new
 * shapes. Replicas exist because `DistributionEntry` is keyed by `xrayImageId`
 * and `foldDistributionEvents` enforces one live owner per id — a second
 * `assigned` event for the same id folds as a reassignment rather than a
 * second reviewer. Giving each reviewer their own id lets the fold, the
 * mirrors, the answers and every report work unchanged.
 */
export function namespacedXrayImageId(
  importId: string,
  originalXrayImageId: string,
  replicaIndex = 0
): string {
  return replicaIndex === 0
    ? `ADHOC-${importId}-${originalXrayImageId}`
    : `ADHOC-${importId}-R${replicaIndex}-${originalXrayImageId}`;
}

/** The synthetic "month" folder that owns an import's samples/answers. */
export function adhocMonthFolder(importId: string): string {
  return `adhoc-${importId}`;
}
