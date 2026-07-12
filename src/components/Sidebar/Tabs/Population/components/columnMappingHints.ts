// D3 (Batch 3) — extracted from Population/index.tsx (verbatim, no behavior change) so the
// column-header-to-system-field mapping logic that feeds MappingSettingsModal's "detected
// columns" hints can be unit-tested directly, without importing the Population wizard component
// (which pulls in xlsx, the Excel-parse Web Worker, and the full phase-stepper UI).

import type { PopulationConfig } from "../../../../../data/population/populationConfig";
import { DEFAULT_MAPPING_TEMPLATE } from "../../../../../data/population/populationConfig";

export function normalizeHeaderToken(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[ـ]/g, "")
    .toLowerCase();
}

/**
 * For each configured system field, find which of the workbook's actual column headers
 * plausibly map to it — by exact match or substring containment (in either direction) against
 * the field's canonical Arabic label plus its configured risk/BI aliases. The risk
 * (`columnMappings`) and BI (`biColumnMappings`) alias lists are pooled together; this function
 * does not know or care which workbook the `rows` came from — that distinction is made by the
 * caller choosing which rows to pass in (see `riskColumnHints` / `biColumnHints` in index.tsx).
 *
 * Only `config.systemFields` are auto-detected — `config.customFields` are not: they are mapped
 * manually via MappingSettingsModal's "mappings" tab.
 *
 * Every system field's `key` is always present in the returned record, even when it has zero
 * matching headers (mapped to `[]`), so a field is never silently dropped from the result —
 * MappingSettingsModal's `ColumnHints` renders that empty array as a visible
 * "لم يتم العثور على تطابق واضح" ("no clear match found") warning rather than omitting the row.
 */
export function buildColumnHintsFromRows(
  rows: Array<{ rawRow?: Record<string, unknown> }>,
  config: PopulationConfig
): Record<string, string[]> {
  const headers = new Set<string>();
  for (const row of rows.slice(0, 1500)) {
    for (const header of Object.keys(row.rawRow ?? {})) {
      if (header.trim()) headers.add(header.trim());
    }
  }

  const normalizedHeaders = Array.from(headers).map((header) => ({
    header,
    normalized: normalizeHeaderToken(header),
  }));
  const template = config.mappingTemplates[0] ?? DEFAULT_MAPPING_TEMPLATE;
  const hints: Record<string, string[]> = {};

  for (const field of config.systemFields) {
    const aliases = [
      field.labelAr,
      ...(template.columnMappings[field.key] ?? []),
      ...(template.biColumnMappings?.[field.key] ?? []),
    ].map(normalizeHeaderToken);
    const matches = normalizedHeaders
      .filter(({ normalized }) => aliases.some((alias) => normalized === alias || normalized.includes(alias) || alias.includes(normalized)))
      .map(({ header }) => header);
    hints[field.key] = Array.from(new Set(matches));
  }

  return hints;
}
