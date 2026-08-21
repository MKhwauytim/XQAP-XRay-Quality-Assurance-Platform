/**
 * Template-field half of a `kind: "historical"` ad-hoc import: deciding which
 * spreadsheet column feeds which `TemplateField`, and turning one raw cell into
 * the value that field's type accepts.
 *
 * A historical study was carried out BEFORE the inspection template existed, so
 * its file will not cover every template field — partial coverage is the normal
 * case here, not a defect. Everything below is built around that: an unmapped
 * or blank field produces no `FieldAnswer` at all rather than an empty one, and
 * a single unparseable cell costs its own field and nothing else.
 *
 * Pure: no disk, no events, no `src/components/**`. The storage/event side
 * lives elsewhere.
 */

import type { FieldAnswer } from "../answers/answerTypes";
import { serializeMultiValue } from "../templates/templateRuntime";
import type { TemplateField, TemplateSchema } from "../templates/templateTypes";
import type { FieldSource } from "./adhocImportModel";
import { foldArabic, foldDigits } from "./adhocTextFolding";

export type TemplateCoercion =
  | { ok: true; value: string | number | boolean | null }
  | { ok: false; reason: string };

/* ────────────────────────────────────────────────────────────────────────────
 * 1 — Header auto-detection
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Headers that could feed `field`, best first, mirroring the population-field
 * auto-detect's ranking: exact match → folded-exact → folded containment.
 *
 * Matching is against `field.label` only. A template field has no alias list
 * (an admin authors its label free-form in the Template Builder), so the label
 * is the entire vocabulary available; anything it misses the admin fixes by
 * hand in the mapping step.
 *
 * `type: "empty"` fields never produce a candidate: they are layout spacers in
 * the inspection form, carry no answer, and matching one would burn a header
 * that a real field needs.
 */
export function detectTemplateHeaderCandidates(
  headers: string[],
  field: TemplateField
): string[] {
  if (field.type === "empty") return [];

  const label = field.label.trim();
  if (label === "") return [];
  const foldedLabel = foldArabic(label);

  const exact: string[] = [];
  const foldedExact: string[] = [];
  const contained: string[] = [];

  for (const header of headers) {
    const foldedHeader = foldArabic(header);
    if (header.trim() === label) exact.push(header);
    else if (foldedHeader === foldedLabel) foldedExact.push(header);
    else if (
      foldedHeader !== "" &&
      (foldedHeader.includes(foldedLabel) || foldedLabel.includes(foldedHeader))
    ) {
      contained.push(header);
    }
  }

  return [...exact, ...foldedExact, ...contained];
}

/**
 * `TemplateField.fieldId` → source, for every non-`empty` field in the schema.
 *
 * Fields are resolved in `schema.fields` order and a header is claimed by the
 * first field that wants it, so one column can never feed two template fields —
 * a duplicated answer is worse than a missing one, because it looks answered.
 * Declaration order is therefore load-bearing: a broadly-worded label placed
 * late cannot steal a header an earlier, more specific field matched exactly.
 *
 * A field left without a candidate gets `{ kind: "none" }` rather than being
 * omitted, so the mapping UI can show it as an explicit "not imported" row.
 */
export function autoDetectTemplateMapping(
  headers: string[],
  schema: TemplateSchema
): Record<string, FieldSource> {
  const mapping: Record<string, FieldSource> = {};
  const claimed = new Set<string>();

  for (const field of schema.fields) {
    if (field.type === "empty") continue;
    const candidate = detectTemplateHeaderCandidates(headers, field).find(
      (header) => !claimed.has(header)
    );
    if (candidate === undefined) {
      mapping[field.fieldId] = { kind: "none" };
      continue;
    }
    claimed.add(candidate);
    mapping[field.fieldId] = { kind: "column", header: candidate };
  }

  return mapping;
}

/* ────────────────────────────────────────────────────────────────────────────
 * 2 — Per-type coercion
 * ──────────────────────────────────────────────────────────────────────────── */

/** Folded so an operator's "نعم " / "TRUE" / "١" all land in the right set. */
const TRUTHY_TOKENS = new Set(
  ["نعم", "صح", "true", "1", "✓", "y", "yes"].map(foldArabic)
);
const FALSY_TOKENS = new Set(
  ["لا", "خطأ", "false", "0", "n", "no"].map(foldArabic)
);

/**
 * `,` `|` `؛` `;` `/` and newlines — every separator seen in real study files.
 *
 * The Arabic comma `،` (U+060C) is included too: an Arabic-authored file lists
 * items with it far more often than with the ASCII comma, and splitting on the
 * Arabic semicolon while ignoring the Arabic comma would fail exactly the files
 * this feature exists to import.
 */
const MULTISELECT_SPLIT_PATTERN = /[,،|؛;/\r\n]+/;

function quote(value: string): string {
  return `"${value}"`;
}

function describeOptions(field: TemplateField): string {
  return field.options.length > 0
    ? field.options.join("، ")
    : "(لا توجد خيارات معرّفة في القالب)";
}

/** Canonical option matching `value`, or null. Raw equality first, then folded. */
function resolveOption(field: TemplateField, value: string): string | null {
  const exact = field.options.find((option) => option === value);
  if (exact !== undefined) return exact;
  const folded = foldArabic(value);
  return field.options.find((option) => foldArabic(option) === folded) ?? null;
}

function coerceNumber(value: string): TemplateCoercion {
  const normalized = foldDigits(value)
    // Thousands separators, ASCII and Arabic (U+066C), plus the Arabic decimal
    // mark (U+066B) which `Number` does not understand.
    .replace(/[,٬\s]/g, "")
    .replace(/٫/g, ".");
  const parsed = Number(normalized);
  if (normalized === "" || !Number.isFinite(parsed)) {
    return { ok: false, reason: `القيمة ${quote(value)} ليست رقماً صالحاً.` };
  }
  return { ok: true, value: parsed };
}

function coerceCheckbox(value: string): TemplateCoercion {
  const token = foldArabic(foldDigits(value));
  if (TRUTHY_TOKENS.has(token)) return { ok: true, value: true };
  if (FALSY_TOKENS.has(token)) return { ok: true, value: false };
  return {
    ok: false,
    reason: `القيمة ${quote(value)} ليست قيمة نعم/لا مفهومة.`,
  };
}

function coerceDropdown(field: TemplateField, value: string): TemplateCoercion {
  const resolved = resolveOption(field, value);
  if (resolved !== null) return { ok: true, value: resolved };
  return {
    ok: false,
    reason: `القيمة ${quote(value)} ليست من خيارات الحقل. الخيارات المقبولة: ${describeOptions(field)}.`,
  };
}

/**
 * A combobox is an open list by definition — the option list is a suggestion,
 * not a constraint — so an unmatched value is KEPT as typed. Resolving a match
 * to its canonical spelling still matters: two rows that meant the same option
 * must group together in a report rather than split on a stray alef form.
 */
function coerceCombobox(field: TemplateField, value: string): TemplateCoercion {
  return { ok: true, value: resolveOption(field, value) ?? value };
}

/**
 * Re-serialized with `serializeMultiValue`, so the stored string round-trips
 * through `parseMultiValue` and matches byte-for-byte what the live inspection
 * form would have written for the same selection.
 *
 * Partial resolution FAILS the cell rather than importing what it understood:
 * a multiselect that silently loses one option reads as a deliberate answer
 * that the reviewer never gave.
 */
function coerceMultiselect(field: TemplateField, value: string): TemplateCoercion {
  const parts = value
    .split(MULTISELECT_SPLIT_PATTERN)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length === 0) return { ok: true, value: null };

  const resolved: string[] = [];
  const unresolved: string[] = [];
  for (const part of parts) {
    const option = resolveOption(field, part);
    if (option === null) unresolved.push(part);
    else resolved.push(option);
  }

  if (unresolved.length > 0) {
    return {
      ok: false,
      reason: `القيم التالية ليست من خيارات الحقل: ${unresolved.map(quote).join("، ")}. الخيارات المقبولة: ${describeOptions(field)}.`,
    };
  }
  return { ok: true, value: serializeMultiValue(resolved) };
}

/**
 * One raw cell → the value `FieldAnswer.value` should carry for `field`.
 *
 * A blank cell is `{ ok: true, value: null }` for every type, including
 * `checkbox`: an unticked historical box and an unasked question are the same
 * thing here, and `null` is what makes `buildFieldAnswers` omit the field
 * instead of inventing a `false` the reviewer never recorded.
 */
export function coerceTemplateValue(
  field: TemplateField,
  raw: string | null
): TemplateCoercion {
  if (field.type === "empty") return { ok: true, value: null };

  const value = (raw ?? "").trim();
  if (value === "") return { ok: true, value: null };

  switch (field.type) {
    case "text":
    case "textarea":
      return { ok: true, value };
    case "number":
      return coerceNumber(value);
    // Stored as the operator's own display string. The rest of the app treats
    // template dates as opaque text, so reformatting here would change what the
    // source file said without any reader asking for it.
    case "date":
      return { ok: true, value };
    case "checkbox":
      return coerceCheckbox(value);
    case "dropdown":
      return coerceDropdown(field, value);
    case "combobox":
      return coerceCombobox(field, value);
    case "multiselect":
      return coerceMultiselect(field, value);
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * 3 — Answers
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Reads one field's raw text out of a source row. Non-string cells are
 * stringified rather than rejected: SheetJS yields numbers and booleans for
 * cells typed as such, and `true` → `"true"` lands in the checkbox truthy set.
 */
function readRawValue(
  source: FieldSource,
  values: Record<string, unknown>
): string | null {
  if (source.kind === "none") return null;
  const raw = source.kind === "constant" ? source.value : values[source.header];
  if (raw === null || raw === undefined) return null;
  const text = (typeof raw === "string" ? raw : String(raw)).trim();
  return text === "" ? null : text;
}

/**
 * Projects one source row onto a template's fields.
 *
 * Three deliberate behaviors a reviewer will ask about:
 *
 * 1. An unmapped field, and a field whose cell was blank or coerced to null,
 *    is OMITTED from `answers`. `ItemAnswer.answers` is a sparse `FieldAnswer[]`
 *    keyed by `fieldId`, so an omitted field simply reads as unanswered — which
 *    is exactly true of a study that predates the template. Writing an explicit
 *    `null` instead would claim the reviewer considered the question and left
 *    it blank.
 * 2. A failed coercion omits ONLY that field and records an Arabic warning. One
 *    bad cell must not block a whole historical import, but it must not vanish
 *    either — the warnings are surfaced in the review step.
 * 3. `field.required` is IGNORED. Required-ness is a live-form rule enforced at
 *    submit time; applying it to a back-fill would reject every honest
 *    historical file, since the study could not have answered a question the
 *    template did not yet ask.
 */
export function buildFieldAnswers(params: {
  schema: TemplateSchema;
  templateFields: Record<string, FieldSource>;
  values: Record<string, unknown>;
}): { answers: FieldAnswer[]; warnings: string[] } {
  const { schema, templateFields, values } = params;
  const answers: FieldAnswer[] = [];
  const warnings: string[] = [];

  for (const field of schema.fields) {
    if (field.type === "empty") continue;

    const source = templateFields[field.fieldId];
    if (!source || source.kind === "none") continue;

    const raw = readRawValue(source, values);
    if (raw === null) continue;

    const coerced = coerceTemplateValue(field, raw);
    if (!coerced.ok) {
      warnings.push(
        `الحقل ${quote(field.label)} — القيمة ${quote(raw)}: ${coerced.reason}`
      );
      continue;
    }
    if (coerced.value === null) continue;

    answers.push({ fieldId: field.fieldId, value: coerced.value });
  }

  return { answers, warnings };
}
