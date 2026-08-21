/**
 * APPLICATION side of the ad-hoc mapping: a `SourceTable` plus a confirmed
 * `ImportMapping` → validated `AdhocRow`s. This is ad-hoc's own normalizer,
 * replacing the `normalizeRiskRow` call that tied `src/data/adhocImport/` to the
 * Population tab's risk-ingest subtree (correction C1 in `adhocImportModel.ts`).
 *
 * The construction side — deciding what the mapping should BE — lives in
 * `adhocMappingModel.ts`. Nothing here inspects a header name or a seed alias:
 * once the admin confirms step 2, the resolved mapping is the only parsing rule,
 * which is what stops a later edit to an unrelated screen from retroactively
 * changing how an already-saved import parsed (G8).
 *
 * **Diagnostics are the deliverable, not a side effect.** The code this replaces
 * reported `"نتيجة المستوى الأول مفقودة أو غير صالحة"` for every rejected row,
 * so an operator staring at 40,000 rows and a rejection count had no way to
 * learn which rows were wrong or what was wrong with them. Every reason string
 * below therefore names the field and, for a bad value, the offending value and
 * the values that would have been accepted.
 */

import { foldedEquals } from "./adhocTextFolding";
import { resolveRowMonth } from "./adhocMonthBinding";
import type {
  AdhocField,
  AdhocMappedRow,
  AdhocMonthBinding,
  AdhocRow,
  AdhocRowValidation,
  FieldSource,
  ImportMapping,
  SourceRow,
  SourceTable,
  ValueMapping,
} from "./adhocImportModel";

/**
 * The one catalog key this layer knows by name, because identity is a projection
 * concern (duplicate detection) rather than a per-field one. Spelled out here
 * rather than imported from `adhocFieldCatalog.ts` so projection stays
 * independent of which fields the catalog happens to offer.
 */
const XRAY_IMAGE_ID_KEY = "xrayImageId";

const UNMAPPED: FieldSource = { kind: "none" };

/** What one field produced, plus the raw text when an enum could not be resolved. */
type FieldOutcome = {
  value: string | null;
  /** Present only when a non-blank enum cell matched no option — see `enumProblem`. */
  unresolvedRaw?: string;
};

function stringifyCell(cell: unknown): string | null {
  if (cell === null || cell === undefined) {
    return null;
  }
  if (typeof cell === "number") {
    // NaN/Infinity can reach here from a formula-error cell; they are not values.
    return Number.isFinite(cell) ? String(cell) : null;
  }
  const text = typeof cell === "string" ? cell : String(cell);
  const trimmed = text.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Where one field's value comes from, resolved against a single source row.
 * A blank or whitespace-only cell is null, exactly as an unmapped field is:
 * downstream, "the operator left it empty" and "nobody mapped it" both mean
 * there is no value, and only `validation` decides whether that matters.
 */
export function resolveFieldValue(
  source: FieldSource,
  values: Record<string, unknown>
): string | null {
  switch (source.kind) {
    case "column":
      return stringifyCell(values[source.header]);
    case "constant": {
      const trimmed = source.value.trim();
      return trimmed === "" ? null : trimmed;
    }
    case "none":
      return null;
  }
}

/**
 * Applies the admin's per-value mapping, tolerating a value that differs from
 * the mapping key only by diacritics, alef form or tatweel — the exact class of
 * difference that made 246,627 parsed rows yield 0 accepted ones on 2026-08-12.
 */
function applyValueMapping(raw: string, valueMapping: ValueMapping | undefined): string {
  if (!valueMapping) {
    return raw;
  }
  const exact = valueMapping[raw];
  if (exact !== undefined) {
    return exact;
  }
  const foldedKey = Object.keys(valueMapping).find((key) => foldedEquals(key, raw));
  return foldedKey === undefined ? raw : valueMapping[foldedKey];
}

/**
 * Enum coercion. A value that matches an option only after folding is stored as
 * the CANONICAL option spelling, never as the operator's spelling: the stored
 * value is read by strictly-typed consumers (`"سليمة" | "اشتباه"`), so keeping
 * `"سليمه"` would push the folding problem downstream into 25 other files.
 *
 * An unresolvable value is stored as null rather than as itself, so `mapped`
 * only ever holds canonical values; the raw text survives in the reason string,
 * which is where an operator needs to see it.
 */
function coerceEnum(
  field: AdhocField,
  raw: string | null,
  valueMapping: ValueMapping | undefined
): FieldOutcome {
  if (raw === null) {
    return { value: null };
  }

  const candidate = applyValueMapping(raw, valueMapping);
  const options = field.options ?? [];
  if (options.length === 0) {
    // A catalog enum with no options declares no constraint; refusing every
    // value here would make such a field unusable rather than unconstrained.
    return { value: candidate };
  }

  if (options.includes(candidate)) {
    return { value: candidate };
  }
  const folded = options.find((option) => foldedEquals(option, candidate));
  if (folded !== undefined) {
    return { value: folded };
  }

  return { value: null, unresolvedRaw: raw };
}

/**
 * `text` / `date` / `month` all keep the trimmed cell text as written.
 *
 * `date` is deliberately not reformatted: the rest of the app stores these as
 * opaque display strings, so re-rendering `17/05/2026` as anything else would
 * silently change what the operator's file said. `month` likewise keeps the raw
 * cell — resolving it to a folder name is `resolveRowMonth`'s job, and doing it
 * here would overwrite the evidence of what the column actually contained.
 */
function coerceField(
  field: AdhocField,
  raw: string | null,
  valueMapping: ValueMapping | undefined
): FieldOutcome {
  return field.kind === "enum" ? coerceEnum(field, raw, valueMapping) : { value: raw };
}

function enumProblem(field: AdhocField, unresolvedRaw: string): string {
  const options = (field.options ?? []).join("، ");
  return `القيمة «${unresolvedRaw}» في الحقل «${field.labelAr}» غير مقبولة. القيم المقبولة: ${options}.`;
}

function requiredProblem(field: AdhocField): string {
  return `الحقل المطلوب «${field.labelAr}» فارغ أو غير مربوط بعمود.`;
}

/**
 * The first problem this field has, or null.
 *
 * A bad enum value is reported ahead of the required-field check even though it
 * also leaves the field empty: "قيمة غير مقبولة، والمقبول كذا" tells the operator
 * what to fix, while "الحقل فارغ" would send them looking for a blank cell that
 * is not blank.
 */
function fieldProblem(field: AdhocField, outcome: FieldOutcome): string | null {
  if (outcome.unresolvedRaw !== undefined) {
    return enumProblem(field, outcome.unresolvedRaw);
  }
  if (field.required && outcome.value === null) {
    return requiredProblem(field);
  }
  return null;
}

type ProjectedFields = { mapped: AdhocMappedRow; problem: string | null };

/**
 * Every catalog key gets an entry, null included. A partial bag would make
 * "this field was never mapped" indistinguishable from "this key does not exist
 * in the catalog this import was projected against", and consumers would have to
 * guess which.
 */
function projectFields(
  row: SourceRow,
  mapping: ImportMapping,
  catalog: AdhocField[]
): ProjectedFields {
  const mapped: AdhocMappedRow = {};
  let problem: string | null = null;

  for (const field of catalog) {
    const source = mapping.fields[field.key] ?? UNMAPPED;
    const raw = resolveFieldValue(source, row.values);
    const outcome = coerceField(field, raw, mapping.valueMappings[field.key]);

    mapped[field.key] = outcome.value;
    // Catalog order decides which problem is reported, so the same row always
    // reports the same reason; `validation` holds one reason, not a list.
    problem = problem ?? fieldProblem(field, outcome);
  }

  return { mapped, problem };
}

function duplicateProblem(xrayImageId: string): string {
  return `معرّف الأشعة «${xrayImageId}» مكرر — سبق ظهوره في صف آخر من هذا الاستيراد.`;
}

/**
 * Duplicate identity check. `seenIds` is MUTATED so a caller can carry one set
 * across every sheet of a workbook — a duplicate that spans two sheets is still
 * a duplicate, and each sheet checked in isolation would miss it.
 *
 * An id is only claimed by a row that is otherwise valid. An invalid row is
 * never assigned, so letting it claim the id would invalidate its usable twin
 * for a reason the operator cannot act on.
 */
function checkDuplicate(mapped: AdhocMappedRow, seenIds: Set<string>): string | null {
  const xrayImageId = mapped[XRAY_IMAGE_ID_KEY];
  if (!xrayImageId) {
    return null;
  }
  if (seenIds.has(xrayImageId)) {
    return duplicateProblem(xrayImageId);
  }
  seenIds.add(xrayImageId);
  return null;
}

function validationOf(problem: string | null): AdhocRowValidation {
  return problem === null ? { valid: true } : { valid: false, reason: problem };
}

function projectRow(params: {
  row: SourceRow;
  sheetName: string;
  mapping: ImportMapping;
  catalog: AdhocField[];
  binding: AdhocMonthBinding;
  seenIds: Set<string>;
}): AdhocRow {
  const { mapped, problem } = projectFields(params.row, params.mapping, params.catalog);
  const reason = problem ?? checkDuplicate(mapped, params.seenIds);
  const linkedMonthFolder = resolveRowMonth(params.binding, mapped);

  const projected: AdhocRow = {
    rowKey: `${params.sheetName}:${params.row.sourceRowNumber}`,
    mapped,
    validation: validationOf(reason),
    excludedByAdmin: false,
    assignments: [],
  };

  return linkedMonthFolder === undefined ? projected : { ...projected, linkedMonthFolder };
}

/**
 * Projects one source table into review-ready rows.
 *
 * Pass the same `seenIds` set to every table of one import so duplicate
 * identities are caught across sheets; omit it to check a table on its own.
 */
export function projectTable(params: {
  table: SourceTable;
  mapping: ImportMapping;
  catalog: AdhocField[];
  binding: AdhocMonthBinding;
  seenIds?: Set<string>;
}): AdhocRow[] {
  const seenIds = params.seenIds ?? new Set<string>();

  return params.table.rows.map((row) =>
    projectRow({
      row,
      sheetName: params.table.sheetName,
      mapping: params.mapping,
      catalog: params.catalog,
      binding: params.binding,
      seenIds,
    })
  );
}
