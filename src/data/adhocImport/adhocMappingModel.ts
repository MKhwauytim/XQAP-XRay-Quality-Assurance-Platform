/**
 * Construction side of ad-hoc column mapping: which header feeds which field,
 * how that is proposed automatically, and what is wrong with the result.
 *
 * Applying a mapping to a row lives elsewhere — this module never touches a
 * value except to seed an enum's value-mapping and to collect the distinct
 * values the admin has to decide about.
 *
 * The matcher is modelled on `buildColumnHintsFromRows`
 * (`Population/components/columnMappingHints.ts`) but deliberately does not
 * import it: correction C1 requires the ad-hoc path to own its parsing, and
 * that module lives in the component tree. Two differences from the original
 * are intentional. It RANKS its candidates instead of returning an unordered
 * set, because auto-detection has to pick one; and it resolves contention, so
 * one header never ends up feeding two fields.
 */

import { foldArabic, foldedEquals } from "./adhocTextFolding";
import type {
  AdhocField,
  FieldSource,
  ImportMapping,
  SourceRow,
  ValueMapping,
} from "./adhocImportModel";

export type MappingIssue = {
  kind: "required-unmapped" | "duplicate-header" | "unknown-field";
  fieldKey: string;
  /** Arabic, ready to render — matching how the rest of this module writes reasons. */
  message: string;
};

/**
 * Substring matching below this folded length is noise: a one-character alias
 * is contained in almost every Arabic header, and the resulting candidate would
 * outrank nothing but would still consume a header in `autoDetectMapping`.
 */
const MIN_CONTAINMENT_LENGTH = 2;

/**
 * Guards `collectDistinctValues`. A free-text column mis-mapped onto an enum
 * field has as many distinct values as it has rows, and the caller's only use
 * for the list is to render one value-mapping control per entry — so an
 * unbounded scan of a 100k-row paste would build a list nobody could use, on
 * the main thread, while the admin waits.
 */
const DEFAULT_DISTINCT_VALUE_LIMIT = 200;

type FoldedAlias = { raw: string; folded: string };

/** A candidate header plus how strongly it matched — 0 is strongest. */
type RankedCandidate = { header: string; tier: number };

function foldedAliasesFor(field: AdhocField): FoldedAlias[] {
  const out: FoldedAlias[] = [];
  const seen = new Set<string>();
  for (const alias of [field.labelAr, ...field.seedAliases]) {
    const raw = alias.trim();
    if (raw === "") continue;
    const folded = foldArabic(raw);
    if (folded === "" || seen.has(folded)) continue;
    seen.add(folded);
    out.push({ raw, folded });
  }
  return out;
}

/**
 * Ranked candidates for one field, strongest tier first and, within a tier, in
 * the order the headers arrived.
 *
 * The header is returned EXACTLY as the table reported it, never trimmed: it is
 * the key the application side reads out of `SourceRow.values`, and a header
 * that arrived with a leading BOM or trailing space has that key too. Comparing
 * is done on the trimmed/folded copies; only the comparison is normalized.
 */
function rankHeaderCandidates(
  headers: string[],
  field: AdhocField
): RankedCandidate[] {
  const aliases = foldedAliasesFor(field);
  if (aliases.length === 0) return [];

  const tiers: string[][] = [[], [], [], []];
  const seen = new Set<string>();

  for (const header of headers) {
    if (seen.has(header)) continue;
    const trimmed = header.trim();
    if (trimmed === "") continue;
    const folded = foldArabic(trimmed);
    if (folded === "") continue;

    let tier = -1;
    if (aliases.some((alias) => alias.raw === trimmed)) {
      tier = 0;
    } else if (aliases.some((alias) => alias.folded === folded)) {
      tier = 1;
    } else if (
      aliases.some(
        (alias) =>
          alias.folded.length >= MIN_CONTAINMENT_LENGTH &&
          folded.includes(alias.folded)
      )
    ) {
      tier = 2;
    } else if (
      folded.length >= MIN_CONTAINMENT_LENGTH &&
      aliases.some((alias) => alias.folded.includes(folded))
    ) {
      tier = 3;
    }

    if (tier < 0) continue;
    seen.add(header);
    tiers[tier].push(header);
  }

  return tiers.flatMap((bucket, tier) =>
    bucket.map((header) => ({ header, tier }))
  );
}

/**
 * Every header that plausibly feeds `field`, strongest match first:
 *
 *   1. the header is an alias verbatim
 *   2. the header equals an alias after folding (`أ/ا`, `ة/ه`, tatweel, BOM,
 *      Latin case, …)
 *   3. the folded header CONTAINS an alias — "نتيجة المستوى الأول للأشعة"
 *      for an alias of "نتيجة المستوى الأول"
 *   4. an alias contains the folded header — the operator abbreviated
 *
 * A header already claimed by another field is still listed: this function
 * answers "what could this field use", and only `autoDetectMapping` knows what
 * is still free.
 */
export function detectHeaderCandidates(
  headers: string[],
  field: AdhocField
): string[] {
  return rankHeaderCandidates(headers, field).map((candidate) => candidate.header);
}

/**
 * Proposes a mapping for a freshly parsed table. Only a proposal — the admin
 * confirms it, and the confirmed result is what gets snapshotted into the
 * import record.
 *
 * Tie-break, when two fields want the same header: MATCH STRENGTH first,
 * catalog order only within one strength. Assignment therefore runs in rounds —
 * every field's verbatim matches are placed before any field's folded matches,
 * those before any containment match, and so on — and a header placed in an
 * earlier round is gone.
 *
 * Plain catalog order alone is not enough, and the failure is not hypothetical:
 * `portCode` precedes `portName` and carries the alias "المنفذ", which is a
 * substring of the header "اسم المنفذ". Assigning strictly in catalog order
 * hands the port-NAME column to the port-CODE field on any file that has no
 * separate code column, and `portName` — which matched that same header
 * verbatim — is left empty.
 *
 * A field with no free candidate gets `{ kind: "none" }` rather than a
 * second-best header some other field already uses; a wrong column is worse
 * than a visibly empty one.
 */
export function autoDetectMapping(
  headers: string[],
  catalog: AdhocField[]
): ImportMapping {
  const ranked = catalog.map((field) => ({
    key: field.key,
    candidates: rankHeaderCandidates(headers, field),
  }));
  const fields: Record<string, FieldSource> = {};
  const claimed = new Set<string>();

  const TIER_COUNT = 4;
  for (let tier = 0; tier < TIER_COUNT; tier += 1) {
    for (const entry of ranked) {
      if (fields[entry.key] !== undefined) continue;
      const candidate = entry.candidates.find(
        (item) => item.tier === tier && !claimed.has(item.header)
      );
      if (candidate === undefined) continue;
      claimed.add(candidate.header);
      fields[entry.key] = { kind: "column", header: candidate.header };
    }
  }

  for (const entry of ranked) {
    if (fields[entry.key] === undefined) fields[entry.key] = { kind: "none" };
  }

  // Value mappings need the DATA, which auto-detection has not looked at.
  // `seedValueMapping` fills them in once the distinct values are known.
  return { fields, valueMappings: {} };
}

/**
 * Distinct trimmed non-empty values of one column, in first-seen order (so the
 * admin reviews them in the order their own file presents them), capped at
 * `limit` — see `DEFAULT_DISTINCT_VALUE_LIMIT`.
 */
export function collectDistinctValues(
  rows: SourceRow[],
  header: string,
  limit: number = DEFAULT_DISTINCT_VALUE_LIMIT
): string[] {
  const out: string[] = [];
  if (limit <= 0) return out;
  const seen = new Set<string>();

  for (const row of rows) {
    const raw = row.values[header];
    if (raw === null || raw === undefined) continue;
    const value = String(raw).trim();
    if (value === "" || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
    if (out.length >= limit) break;
  }

  return out;
}

/**
 * Pre-fills one enum field's value mapping: folded equality first, then folded
 * containment in either direction ("سليم" → "سليمة").
 *
 * A value with no confident match is OMITTED, never mapped to a best guess.
 * An absent key means "the admin still has to decide" and the UI shows the
 * value as unmapped; a present key means "this resolves to that". Guessing
 * would turn a visible gap into an invisible wrong answer — and this feeds
 * `xrayLevelOneResult` / `certScanStatus`, values that end up in reports. A
 * value that matches two options by containment is equally not confident, so it
 * is omitted too.
 */
export function seedValueMapping(
  distinctValues: string[],
  options: string[]
): ValueMapping {
  const mapping: ValueMapping = {};
  const foldedOptions = options.map((option) => ({
    option,
    folded: foldArabic(option),
  }));

  for (const value of distinctValues) {
    const exact = options.find((option) => foldedEquals(value, option));
    if (exact !== undefined) {
      mapping[value] = exact;
      continue;
    }

    const folded = foldArabic(value);
    if (folded.length < MIN_CONTAINMENT_LENGTH) continue;

    const partial = foldedOptions.filter(
      (candidate) =>
        candidate.folded.length >= MIN_CONTAINMENT_LENGTH &&
        (folded.includes(candidate.folded) || candidate.folded.includes(folded))
    );
    if (partial.length === 1) mapping[value] = partial[0].option;
  }

  return mapping;
}

/**
 * Diagnostics for a mapping, in catalog order then by issue kind. Reported, not
 * enforced: a required field left unmapped is a legitimate intermediate state
 * while the admin is still working, and it fails every row visibly in the review
 * table rather than blocking the screen.
 */
export function findMappingIssues(
  mapping: ImportMapping,
  catalog: AdhocField[]
): MappingIssue[] {
  const issues: MappingIssue[] = [];
  const labelByKey = new Map(catalog.map((field) => [field.key, field.labelAr]));

  for (const field of catalog) {
    const source = mapping.fields[field.key];
    if (!field.required) continue;
    // A constant of "" is as unmapped as `none` — it resolves to nothing on
    // every row, so reporting it as configured would hide the problem.
    const resolved =
      source !== undefined &&
      (source.kind === "column" ||
        (source.kind === "constant" && source.value.trim() !== ""));
    if (resolved) continue;
    issues.push({
      kind: "required-unmapped",
      fieldKey: field.key,
      message: `الحقل الإلزامي "${field.labelAr}" غير مرتبط بأي عمود أو قيمة ثابتة.`,
    });
  }

  const keysByHeader = new Map<string, string[]>();
  for (const [key, source] of Object.entries(mapping.fields)) {
    if (source.kind !== "column") continue;
    const existing = keysByHeader.get(source.header);
    if (existing) existing.push(key);
    else keysByHeader.set(source.header, [key]);
  }
  for (const [header, keys] of keysByHeader) {
    if (keys.length < 2) continue;
    const labels = keys.map((key) => labelByKey.get(key) ?? key).join("، ");
    // One issue per participating field, not one per header: the UI flags by
    // fieldKey, and both sides of the clash need flagging.
    for (const key of keys) {
      issues.push({
        kind: "duplicate-header",
        fieldKey: key,
        message: `العمود "${header}" مرتبط بأكثر من حقل (${labels}).`,
      });
    }
  }

  for (const key of Object.keys(mapping.fields)) {
    if (labelByKey.has(key)) continue;
    issues.push({
      kind: "unknown-field",
      fieldKey: key,
      message: `الحقل "${key}" غير موجود في قائمة حقول هذا الاستيراد.`,
    });
  }

  return issues;
}

/** Immutable single-field update — the caller's mapping is never touched. */
export function setFieldSource(
  mapping: ImportMapping,
  key: string,
  source: FieldSource
): ImportMapping {
  return {
    ...mapping,
    fields: { ...mapping.fields, [key]: source },
    valueMappings: { ...mapping.valueMappings },
  };
}
