import { BI_COLUMN_ALIASES } from "./biDataColumns";
import type { BiSourceRow, NormalizedBiRow } from "./biDataTypes";

// Optional-vowel diacritics (تشكيل, U+064B-U+065F), zero-width/directional
// marks (ZWSP/ZWNJ/ZWJ/LRM/RLM, U+200B-U+200F), and a BOM/ZWNBSP (U+FEFF)
// that can survive a copy-paste from a diacritized document into a header
// cell. None of these change a header's meaning, so stripping them is the
// same risk-free character-folding class as the alef/ta-marbuta
// normalization below. This mirrors the fix applied to riskDataNormalizer.ts
// on 2026-08-12 (see the CLAUDE.md edit log for that date), which never
// propagated to this file's independent copy of the same normalizer — the
// gap that let a BI workbook with this noise in its header row reject every
// single row with "مستبعدة (بلا معرف أشعة)" while the Risk file, reading
// header text from the same source system, was already immune. Written with
// explicit \u escapes (not literal invisible characters) so the
// no-irregular-whitespace lint rule doesn't flag the source file itself.
const DIACRITIC_AND_ZERO_WIDTH_RANGES = [
  [0x064b, 0x065f], // Arabic diacritics (تشكيل)
  [0x200b, 0x200f], // ZWSP, ZWNJ, ZWJ, LRM, RLM
  [0xfeff, 0xfeff]  // BOM / zero-width no-break space
] as const;

const DIACRITIC_AND_ZERO_WIDTH_PATTERN = new RegExp(
  "[" +
    DIACRITIC_AND_ZERO_WIDTH_RANGES.map(
      ([start, end]) =>
        `\\u${start.toString(16).padStart(4, "0")}-\\u${end.toString(16).padStart(4, "0")}`
    ).join("") +
  "]",
  "g"
);


/**
 * Alias-list fallback that treats an EMPTY list as "not configured".
 *
 * The previous `aliases.x || BI_COLUMN_ALIASES.x` is a JS trap: an empty array is
 * truthy, so a saved column mapping carrying `[]` for a field resolved to `[]`
 * rather than the defaults — the normalizer then searched ZERO headers and
 * rejected every row as missing that field. That is exactly how the owner's
 * BI.xlsx reported 246,627 parsed / 0 accepted with an empty "searched for"
 * list in the zero-accepted diagnostic (2026-08-12).
 */
function aliasesFor(configured: readonly string[] | undefined, fallback: readonly string[]): readonly string[] {
  return configured && configured.length > 0 ? configured : fallback;
}

function normalizeArabicText(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[ـ]/g, "")
    .replace(DIACRITIC_AND_ZERO_WIDTH_PATTERN, "")
    .toLowerCase();
}

function normalizeHeader(header: string): string {
  return normalizeArabicText(header);
}

function normalizeCellValue(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value).trim();

  return text.length > 0 ? text : null;
}

function createHeaderLookup(row: BiSourceRow): Map<string, unknown> {
  const lookup = new Map<string, unknown>();

  for (const [header, value] of Object.entries(row)) {
    lookup.set(normalizeHeader(header), value);
  }

  return lookup;
}

/**
 * Detection-only diagnostic: which source headers collapse onto the same
 * normalized key. `createHeaderLookup`'s `Map.set` makes the LAST such header
 * win, silently — that precedence is deliberately left untouched (changing it
 * could switch which column a field reads for an existing workbook
 * mid-history). This is purely additive: it reports the collision so the
 * operator can see two columns collapsed into one key, without altering
 * lookup construction, precedence, or per-row hot-path behavior. Callers
 * compute this ONCE per sheet from the header row, never per data row.
 * Mirrors riskDataNormalizer.ts's copy.
 */
export function detectDuplicateNormalizedHeaders(
  headers: string[]
): Array<{ normalized: string; originals: string[] }> {
  const byNormalized = new Map<string, string[]>();

  for (const header of headers) {
    const normalized = normalizeHeader(header);
    const originals = byNormalized.get(normalized);
    if (originals) {
      originals.push(header);
    } else {
      byNormalized.set(normalized, [header]);
    }
  }

  const collisions: Array<{ normalized: string; originals: string[] }> = [];
  for (const [normalized, originals] of byNormalized) {
    if (originals.length > 1) {
      collisions.push({ normalized, originals });
    }
  }
  return collisions;
}

function getFirstAvailableValue(
  lookup: Map<string, unknown>,
  candidateHeaders: readonly string[]
): string | null {
  for (const candidateHeader of candidateHeaders) {
    const normalizedCandidateHeader = normalizeHeader(candidateHeader);
    const value = normalizeCellValue(lookup.get(normalizedCandidateHeader));

    if (value !== null) {
      return value;
    }
  }

  return null;
}

export function normalizeBiRow(params: {
  sourceRow: BiSourceRow;
  source: string;
  sourceSheetName: string;
  sourceRowNumber: number;
  columnMappings?: Record<string, string[]>;
}): NormalizedBiRow {
  const { sourceRow, source, sourceSheetName, sourceRowNumber, columnMappings } = params;

  const aliases = columnMappings || BI_COLUMN_ALIASES;

  // Built once per row instead of once per field (~29 fields) — the lookup
  // itself does not depend on which candidate headers are being resolved.
  const lookup = createHeaderLookup(sourceRow);

  return {
    source,

    xrayImageId: getFirstAvailableValue(lookup, aliasesFor(aliases.xrayImageId, BI_COLUMN_ALIASES.xrayImageId)),
    xrayEntryDate: getFirstAvailableValue(
      lookup,
      aliasesFor(aliases.xrayEntryDate, BI_COLUMN_ALIASES.xrayEntryDate)
    ),

    portType: getFirstAvailableValue(lookup, aliasesFor(aliases.portType, BI_COLUMN_ALIASES.portType)),
    portCode: getFirstAvailableValue(lookup, aliasesFor(aliases.portCode, BI_COLUMN_ALIASES.portCode)),
    portName: getFirstAvailableValue(lookup, aliasesFor(aliases.portName, BI_COLUMN_ALIASES.portName)),

    movementNumber: getFirstAvailableValue(
      lookup,
      aliasesFor(aliases.movementNumber, BI_COLUMN_ALIASES.movementNumber)
    ),
    movementDate: getFirstAvailableValue(
      lookup,
      aliasesFor(aliases.movementDate, BI_COLUMN_ALIASES.movementDate)
    ),
    movementHijriDate: getFirstAvailableValue(
      lookup,
      aliasesFor(aliases.movementHijriDate, BI_COLUMN_ALIASES.movementHijriDate)
    ),

    declarationNumber: getFirstAvailableValue(
      lookup,
      aliasesFor(aliases.declarationNumber, BI_COLUMN_ALIASES.declarationNumber)
    ),
    preliminaryDeclarationNumber: getFirstAvailableValue(
      lookup,
      aliasesFor(aliases.preliminaryDeclarationNumber, BI_COLUMN_ALIASES.preliminaryDeclarationNumber)
    ),
    declarationDate: getFirstAvailableValue(
      lookup,
      aliasesFor(aliases.declarationDate, BI_COLUMN_ALIASES.declarationDate)
    ),
    declarationHijriDate: getFirstAvailableValue(
      lookup,
      aliasesFor(aliases.declarationHijriDate, BI_COLUMN_ALIASES.declarationHijriDate)
    ),

    inboundOutboundType: getFirstAvailableValue(
      lookup,
      aliasesFor(aliases.inboundOutboundType, BI_COLUMN_ALIASES.inboundOutboundType)
    ),
    declarationType: getFirstAvailableValue(
      lookup,
      aliasesFor(aliases.declarationType, BI_COLUMN_ALIASES.declarationType)
    ),
    declarationStatus: getFirstAvailableValue(
      lookup,
      aliasesFor(aliases.declarationStatus, BI_COLUMN_ALIASES.declarationStatus)
    ),

    plateOrContainerNumber: getFirstAvailableValue(
      lookup,
      aliasesFor(aliases.plateOrContainerNumber, BI_COLUMN_ALIASES.plateOrContainerNumber)
    ),
    chassisNumber: getFirstAvailableValue(
      lookup,
      aliasesFor(aliases.chassisNumber, BI_COLUMN_ALIASES.chassisNumber)
    ),

    governance: getFirstAvailableValue(lookup, aliasesFor(aliases.governance, BI_COLUMN_ALIASES.governance)),

    levelOneEmployee: getFirstAvailableValue(
      lookup,
      aliasesFor(aliases.levelOneEmployee, BI_COLUMN_ALIASES.levelOneEmployee)
    ),
    levelTwoEmployee: getFirstAvailableValue(
      lookup,
      aliasesFor(aliases.levelTwoEmployee, BI_COLUMN_ALIASES.levelTwoEmployee)
    ),

    levelOneResultCode: getFirstAvailableValue(
      lookup,
      aliasesFor(aliases.levelOneResultCode, BI_COLUMN_ALIASES.levelOneResultCode)
    ),
    levelTwoResultCode: getFirstAvailableValue(
      lookup,
      aliasesFor(aliases.levelTwoResultCode, BI_COLUMN_ALIASES.levelTwoResultCode)
    ),

    levelOneResult: getFirstAvailableValue(
      lookup,
      aliasesFor(aliases.levelOneResult, BI_COLUMN_ALIASES.levelOneResult)
    ),
    levelTwoResult: getFirstAvailableValue(
      lookup,
      aliasesFor(aliases.levelTwoResult, BI_COLUMN_ALIASES.levelTwoResult)
    ),

    manualInspectionResultCode: getFirstAvailableValue(
      lookup,
      aliasesFor(aliases.manualInspectionResultCode, BI_COLUMN_ALIASES.manualInspectionResultCode)
    ),
    manualInspectionResult: getFirstAvailableValue(
      lookup,
      aliasesFor(aliases.manualInspectionResult, BI_COLUMN_ALIASES.manualInspectionResult)
    ),

    oppositeInspectionEmployee: getFirstAvailableValue(
      lookup,
      aliasesFor(aliases.oppositeInspectionEmployee, BI_COLUMN_ALIASES.oppositeInspectionEmployee)
    ),
    oppositeInspectionResultCode: getFirstAvailableValue(
      lookup,
      aliasesFor(aliases.oppositeInspectionResultCode, BI_COLUMN_ALIASES.oppositeInspectionResultCode)
    ),
    oppositeInspectionResult: getFirstAvailableValue(
      lookup,
      aliasesFor(aliases.oppositeInspectionResult, BI_COLUMN_ALIASES.oppositeInspectionResult)
    ),

    liveMeansEmployee: getFirstAvailableValue(
      lookup,
      aliasesFor(aliases.liveMeansEmployee, BI_COLUMN_ALIASES.liveMeansEmployee)
    ),
    liveMeansResultCode: getFirstAvailableValue(
      lookup,
      aliasesFor(aliases.liveMeansResultCode, BI_COLUMN_ALIASES.liveMeansResultCode)
    ),
    liveMeansResult: getFirstAvailableValue(
      lookup,
      aliasesFor(aliases.liveMeansResult, BI_COLUMN_ALIASES.liveMeansResult)
    ),

    notes: getFirstAvailableValue(lookup, aliasesFor(aliases.notes, BI_COLUMN_ALIASES.notes)),

    rawRow: sourceRow,
    sourceSheetName,
    sourceRowNumber
  };
}