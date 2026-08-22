/**
 * Reading a v1 ad-hoc import document as an `AdhocRecord`, and deriving the
 * index entry that describes it.
 *
 * **Why a migration function rather than a migration pass.** There is no active
 * schema migration anywhere in this workspace (CLAUDE.md, "Disk layout"):
 * nothing rewrites files on load, because a rewrite that runs before the user
 * has done anything turns every read into a write, and a bad read into durable
 * data loss. `normalizeAdhocRecord` therefore upgrades a record IN MEMORY only.
 * The upgraded shape reaches disk exactly when a save was going to happen
 * anyway — `adhocImportStorage.ts` normalizes on the way in and writes the v2
 * document on the way out.
 *
 * **And the reverse direction still ships.** `toLegacyRecord` re-derives v1's
 * `assigned` / `assignedTo` / `assignedAt` / `namespacedXrayImageId` scalars
 * from `assignments[0]`, and the storage layer writes them alongside the v2
 * fields. That is deliberate and TEMPORARY — **one release**: this app is
 * distributed as a single `index.html` that people keep copies of, so an
 * operator running last week's build against a workspace someone else has
 * already written with this build must not see every row read back as
 * unassigned. Once the fleet has turned over, drop the legacy scalars from the
 * written document (`toLegacyRecord` stays, as the compatibility VIEW the v1
 * tab types are expressed in).
 *
 * Nothing here does I/O and nothing here throws: a document that cannot be read
 * as a record answers `null`, and the caller decides whether that is a missing
 * import or a corrupt one.
 */

import { ADHOC_FIELD_CATALOG } from "./adhocFieldCatalog";
import { linkedMonthsOf } from "./adhocMonthBinding";
import { namespacedXrayImageId } from "./adhocImportModel";
import type {
  AdhocField,
  AdhocImportKind,
  AdhocIndexEntry,
  AdhocMappedRow,
  AdhocMonthBinding,
  AdhocRecord,
  AdhocRow,
  AdhocRowAssignment,
  AdhocRowValidation,
  AdhocSourceKind,
  FieldSource,
  ImportMapping,
} from "./adhocImportModel";
import type { AdhocImportRecord, AdhocImportRow } from "./adhocImportTypes";

const IMPORT_KINDS: AdhocImportKind[] = ["population", "sample", "historical"];
const SOURCE_KINDS: AdhocSourceKind[] = ["file", "paste"];

/** The default a v1 record's rows are read under — see `normalizeAdhocRecord`. */
const ISOLATED: AdhocMonthBinding = { kind: "isolated" };

function asObject(raw: unknown): Record<string, unknown> | null {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null;
}

function asString(raw: unknown): string | null {
  return typeof raw === "string" ? raw : null;
}

/**
 * A number is coerced rather than dropped. `AdhocMappedRow` is a string bag, but
 * a hand-edited or foreign JSON can carry `"xrayImageId": 12345`, and dropping
 * that key would silently make an otherwise fine row identity-less. Booleans and
 * nested objects (v1's `hasReport`, `rawRow`) have no string reading and are
 * dropped; `sourceRowNumber`, the only other non-string v1 carried, is
 * recoverable from `rowKey` and is re-derived there by the bridge.
 */
function asMappedValue(raw: unknown): string | null | undefined {
  if (typeof raw === "string") return raw;
  if (raw === null) return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  return undefined;
}

function normalizeMapped(raw: unknown): AdhocMappedRow {
  const source = asObject(raw);
  const mapped: AdhocMappedRow = {};
  if (!source) return mapped;
  for (const [key, value] of Object.entries(source)) {
    const normalized = asMappedValue(value);
    if (normalized !== undefined) {
      mapped[key] = normalized;
    }
  }
  return mapped;
}

/**
 * A missing `validation` block reads as valid. The alternative — invalidating
 * every row of a document written by something that did not record validation —
 * would hide rows that are already assigned and being worked on, which is a far
 * worse answer than trusting a document the app itself wrote.
 */
function normalizeValidation(raw: unknown): AdhocRowValidation {
  const source = asObject(raw);
  if (!source) return { valid: true };
  if (source.valid === true) return { valid: true };
  return { valid: false, reason: asString(source.reason) ?? "غير صالح." };
}

function normalizeAssignment(
  raw: unknown,
  importId: string,
  mapped: AdhocMappedRow
): AdhocRowAssignment | null {
  const source = asObject(raw);
  if (!source) return null;
  const username = asString(source.username);
  if (!username) return null;
  const replicaIndex =
    typeof source.replicaIndex === "number" && Number.isInteger(source.replicaIndex) && source.replicaIndex >= 0
      ? source.replicaIndex
      : 0;
  const originalId = mapped.xrayImageId ?? "";
  return {
    username,
    replicaIndex,
    xrayImageId:
      asString(source.xrayImageId) ?? namespacedXrayImageId(importId, originalId, replicaIndex),
    assignedAt: asString(source.assignedAt) ?? "",
  };
}

/**
 * v1 stored ONE assignment per row, as four parallel scalars. They become the
 * single `replicaIndex: 0` entry — the same id `namespacedXrayImageId` still
 * produces for replica 0, so nothing already written to a distribution event log
 * is re-identified by this upgrade.
 */
function legacyAssignments(
  source: Record<string, unknown>,
  importId: string,
  mapped: AdhocMappedRow
): AdhocRowAssignment[] {
  const username = asString(source.assignedTo);
  if (source.assigned !== true || !username) return [];
  const originalId = mapped.xrayImageId ?? "";
  return [
    {
      username,
      replicaIndex: 0,
      xrayImageId: asString(source.namespacedXrayImageId) ?? namespacedXrayImageId(importId, originalId, 0),
      assignedAt: asString(source.assignedAt) ?? "",
    },
  ];
}

function normalizeRow(raw: unknown, importId: string): AdhocRow | null {
  const source = asObject(raw);
  if (!source) return null;
  const rowKey = asString(source.rowKey);
  if (!rowKey) return null;

  const mapped = normalizeMapped(source.mapped);
  const assignments = Array.isArray(source.assignments)
    ? source.assignments
        .map((entry) => normalizeAssignment(entry, importId, mapped))
        .filter((entry): entry is AdhocRowAssignment => entry !== null)
    : legacyAssignments(source, importId, mapped);

  const row: AdhocRow = {
    rowKey,
    mapped,
    validation: normalizeValidation(source.validation),
    excludedByAdmin: source.excludedByAdmin === true,
    assignments,
  };

  const linkedMonthFolder = asString(source.linkedMonthFolder);
  return linkedMonthFolder === null ? row : { ...row, linkedMonthFolder };
}

function normalizeFieldSource(raw: unknown): FieldSource | null {
  const source = asObject(raw);
  if (!source) return null;
  if (source.kind === "column") {
    const header = asString(source.header);
    return header === null ? null : { kind: "column", header };
  }
  if (source.kind === "constant") {
    const value = asString(source.value);
    return value === null ? null : { kind: "constant", value };
  }
  return source.kind === "none" ? { kind: "none" } : null;
}

function normalizeFieldSources(raw: unknown): Record<string, FieldSource> {
  const source = asObject(raw);
  const fields: Record<string, FieldSource> = {};
  if (!source) return fields;
  for (const [key, value] of Object.entries(source)) {
    const fieldSource = normalizeFieldSource(value);
    if (fieldSource) {
      fields[key] = fieldSource;
    }
  }
  return fields;
}

function normalizeValueMappings(raw: unknown): Record<string, Record<string, string>> {
  const source = asObject(raw);
  const result: Record<string, Record<string, string>> = {};
  if (!source) return result;
  for (const [fieldKey, mapping] of Object.entries(source)) {
    const entries = asObject(mapping);
    if (!entries) continue;
    const normalized: Record<string, string> = {};
    for (const [from, to] of Object.entries(entries)) {
      const value = asString(to);
      if (value !== null) {
        normalized[from] = value;
      }
    }
    result[fieldKey] = normalized;
  }
  return result;
}

function normalizeMapping(raw: unknown): ImportMapping {
  const source = asObject(raw);
  if (!source) {
    // A v1 record has no `mapping` at all: it parsed through `normalizeRiskRow`
    // against the workspace's live Population aliases, which is precisely the
    // G8 defect the v2 snapshot removes. An empty mapping is the honest
    // reconstruction — the rows it produced are still on the record, but the
    // rule that produced them was never recorded and cannot be invented here.
    return { fields: {}, valueMappings: {} };
  }
  const mapping: ImportMapping = {
    fields: normalizeFieldSources(source.fields),
    valueMappings: normalizeValueMappings(source.valueMappings),
  };
  const templateFields = asObject(source.templateFields);
  const withTemplateFields =
    templateFields === null
      ? mapping
      : { ...mapping, templateFields: normalizeFieldSources(templateFields) };

  // The two provenance sources are part of the SNAPSHOT, not caller state, and
  // dropping them here silently undid that: `applyHistoricalImport` re-reads
  // the record from disk before it writes, and a re-planned import whose
  // reviewer column had been normalized away resolved every row to a blank
  // reviewer. Absent stays absent — an optional field that was never set must
  // not appear as `{kind:"none"}` and change what the record claims.
  const answeredBySource = normalizeFieldSource(source.answeredBySource);
  const submittedAtSource = normalizeFieldSource(source.submittedAtSource);
  return {
    ...withTemplateFields,
    ...(answeredBySource === null ? {} : { answeredBySource }),
    ...(submittedAtSource === null ? {} : { submittedAtSource }),
  };
}

function normalizeCatalog(raw: unknown): AdhocField[] {
  if (!Array.isArray(raw)) {
    // Best-effort reconstruction for a record written before the catalog was
    // snapshotted alongside the mapping: the CURRENT catalog is the closest
    // thing to what that import was parsed against. It is a label for the keys
    // already sitting in `mapped`, not a re-parse — no row is re-projected on
    // load — so a catalog that has drifted since cannot change what the record
    // says, only how a later editor describes it.
    return ADHOC_FIELD_CATALOG;
  }
  const fields = raw
    .map((entry) => {
      const source = asObject(entry);
      const key = source === null ? null : asString(source.key);
      if (source === null || key === null) return null;
      const field: AdhocField = {
        key,
        labelAr: asString(source.labelAr) ?? key,
        required: source.required === true,
        kind:
          source.kind === "date" || source.kind === "enum" || source.kind === "month"
            ? source.kind
            : "text",
        seedAliases: Array.isArray(source.seedAliases)
          ? source.seedAliases.filter((alias): alias is string => typeof alias === "string")
          : [],
      };
      const options = Array.isArray(source.options)
        ? source.options.filter((option): option is string => typeof option === "string")
        : null;
      return options === null ? field : { ...field, options };
    })
    .filter((field): field is AdhocField => field !== null);
  return fields.length > 0 ? fields : ADHOC_FIELD_CATALOG;
}

function normalizeMonthBinding(raw: unknown): AdhocMonthBinding {
  const source = asObject(raw);
  if (!source) return ISOLATED;
  if (source.kind === "month") {
    const monthFolderName = asString(source.monthFolderName);
    return monthFolderName === null ? ISOLATED : { kind: "month", monthFolderName };
  }
  if (source.kind === "column") {
    const fieldKey = asString(source.fieldKey);
    return fieldKey === null ? ISOLATED : { kind: "column", fieldKey };
  }
  return ISOLATED;
}

/**
 * Reads any ad-hoc import document — v1 or v2 — as an `AdhocRecord`.
 *
 * v1 defaults, all of them documented rather than guessed:
 * - `monthBinding: { kind: "isolated" }` — v1 had no concept of a linked month,
 *   and every v1 import stored under its own `2-samples/adhoc-{importId}/`,
 *   which is exactly what isolated means.
 * - `kind: "population"` — v1's validation required L1/L2 results on every row,
 *   i.e. it only ever accepted population extracts.
 * - `sourceKind: "file"` — v1 had no paste path.
 * - `fieldCatalog` — the current `ADHOC_FIELD_CATALOG` (see `normalizeCatalog`).
 * - `mapping` — empty (see `normalizeMapping`).
 *
 * Answers `null` for input that is not a record document at all (not an object,
 * or carrying no `importId`). Never throws.
 */
export function normalizeAdhocRecord(raw: unknown): AdhocRecord | null {
  try {
    const source = asObject(raw);
    if (!source) return null;
    const importId = asString(source.importId);
    if (!importId) return null;

    const rows = Array.isArray(source.rows)
      ? source.rows
          .map((row) => normalizeRow(row, importId))
          .filter((row): row is AdhocRow => row !== null)
      : [];

    const record: AdhocRecord = {
      importId,
      schemaVersion: 2,
      fileName: asString(source.fileName) ?? "",
      importedBy: asString(source.importedBy) ?? "",
      importedAt: asString(source.importedAt) ?? "",
      status: source.status === "closed" ? "closed" : "open",
      kind: IMPORT_KINDS.find((kind) => kind === source.kind) ?? "population",
      sourceKind: SOURCE_KINDS.find((kind) => kind === source.sourceKind) ?? "file",
      mapping: normalizeMapping(source.mapping),
      fieldCatalog: normalizeCatalog(source.fieldCatalog),
      monthBinding: normalizeMonthBinding(source.monthBinding),
      rows,
    };

    const closedBy = asString(source.closedBy);
    const closedAt = asString(source.closedAt);
    const templateId = asString(source.templateId);
    const writeToken = asString(source._writeToken);

    return {
      ...record,
      ...(closedBy === null ? {} : { closedBy }),
      ...(closedAt === null ? {} : { closedAt }),
      ...(templateId === null ? {} : { templateId }),
      ...(typeof source.templateVersion === "number" ? { templateVersion: source.templateVersion } : {}),
      ...(typeof source.revision === "number" ? { revision: source.revision } : {}),
      ...(writeToken === null ? {} : { _writeToken: writeToken }),
    };
  } catch {
    // Defensive only. Everything above is guarded, but this function is called
    // on whatever happens to be on disk, and a throw here would take down a
    // listing that must degrade to "this one import is unreadable".
    return null;
  }
}

/**
 * The index entry describing a record.
 *
 * `assignedRows` counts ASSIGNMENTS, not assigned rows. The two differ only
 * under fan-out, where one row carries one assignment per reviewer — and the
 * only consumer, `loadAdhocEntriesForEmployeeView`, uses it as a "> 0, worth
 * opening" test that stays correct either way. Counting rows would have made a
 * fanned-out import under-report by a factor of its reviewer count in the one
 * place an operator would look to check the fan-out actually happened.
 */
export function toIndexEntry(record: AdhocRecord): AdhocIndexEntry {
  return {
    importId: record.importId,
    fileName: record.fileName,
    importedBy: record.importedBy,
    importedAt: record.importedAt,
    status: record.status,
    kind: record.kind,
    totalRows: record.rows.length,
    validRows: record.rows.filter((row) => row.validation.valid).length,
    assignedRows: record.rows.reduce((total, row) => total + row.assignments.length, 0),
    linkedMonths: linkedMonthsOf(record.monthBinding, record.rows),
  };
}

/**
 * The v1 VIEW of a row: the four scalars `AdhocImportRow` still declares,
 * re-derived from `assignments[0]`.
 *
 * A fanned-out row therefore reports its FIRST reviewer through the legacy
 * fields and the rest only through `assignments`. That is the accurate answer
 * for a shape that can hold exactly one — v1 code reading it sees "assigned to
 * someone", which is the decision it actually makes with the field.
 */
export function toLegacyRow(row: AdhocRow): AdhocImportRow {
  const first = row.assignments[0];
  const legacy: AdhocImportRow = {
    rowKey: row.rowKey,
    mapped: row.mapped,
    validation: row.validation,
    excludedByAdmin: row.excludedByAdmin,
    assigned: row.assignments.length > 0,
    assignedTo: first?.username ?? null,
    assignedAt: first?.assignedAt ?? null,
    namespacedXrayImageId: first?.xrayImageId ?? null,
    assignments: row.assignments,
  };
  return row.linkedMonthFolder === undefined
    ? legacy
    : { ...legacy, linkedMonthFolder: row.linkedMonthFolder };
}

/**
 * The v1 VIEW of a record — every v2 field kept, plus the legacy scalars.
 *
 * Two jobs, one function: it is what `adhocImportStorage.ts` writes (so an older
 * build reading this workspace still sees its assignments — see the module
 * docblock's one-release note), and it is what the legacy
 * `loadAdhocImportRecord` / `assignAdhocRowsToEmployee` signatures return.
 */
export function toLegacyRecord(record: AdhocRecord): AdhocImportRecord {
  return {
    ...record,
    rows: record.rows.map(toLegacyRow),
  };
}
