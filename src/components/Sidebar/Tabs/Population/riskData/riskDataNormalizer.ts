import { RISK_COLUMN_ALIASES } from "./riskDataColumns";
import type { NormalizedRiskRow, RiskSourceRow } from "./riskDataTypes";

// Optional-vowel diacritics (تشكيل, U+064B-U+065F), zero-width/directional
// marks (ZWSP/ZWNJ/ZWJ/LRM/RLM, U+200B-U+200F), and a BOM/ZWNBSP (U+FEFF)
// that can survive a copy-paste from a diacritized document into a header
// cell. None of these change a header's meaning, so stripping them is the
// same risk-free character-folding class as the alef/ta-marbuta
// normalization below — added 2026-08-12 while diagnosing a 100%
// row-rejection report caused by the exact-match alias lookup silently
// failing on such noise; see the CLAUDE.md edit log for that date. Written
// with explicit \u escapes (not literal invisible characters) so the
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
 * The previous `aliases.x || RISK_COLUMN_ALIASES.x` is a JS trap: an empty array is
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

function createHeaderLookup(row: RiskSourceRow): Map<string, unknown> {
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

export function normalizeRiskRow(params: {
  sourceRow: RiskSourceRow;
  movementType: string;
  sourceSheetName: string;
  sourceRowNumber: number;
  columnMappings?: Record<string, string[]>;
}): NormalizedRiskRow {
  const { sourceRow, movementType, sourceSheetName, sourceRowNumber, columnMappings } = params;

  const aliases = columnMappings || RISK_COLUMN_ALIASES;

  // Built once per row instead of once per field (~27 fields) — the lookup
  // itself does not depend on which candidate headers are being resolved.
  const lookup = createHeaderLookup(sourceRow);

  const reportNumber = getFirstAvailableValue(
    lookup,
    aliasesFor(aliases.reportNumber, RISK_COLUMN_ALIASES.reportNumber)
  );

  return {
    movementType,

    portCode: getFirstAvailableValue(lookup, aliasesFor(aliases.portCode, RISK_COLUMN_ALIASES.portCode)),
    portName: getFirstAvailableValue(lookup, aliasesFor(aliases.portName, RISK_COLUMN_ALIASES.portName)),
    portType: getFirstAvailableValue(lookup, aliasesFor(aliases.portType, RISK_COLUMN_ALIASES.portType)),

    movementNumber: getFirstAvailableValue(
      lookup,
      aliasesFor(aliases.movementNumber, RISK_COLUMN_ALIASES.movementNumber)
    ),
    movementDate: getFirstAvailableValue(
      lookup,
      aliasesFor(aliases.movementDate, RISK_COLUMN_ALIASES.movementDate)
    ),
    movementHijriDate: getFirstAvailableValue(
      lookup,
      aliasesFor(aliases.movementHijriDate, RISK_COLUMN_ALIASES.movementHijriDate)
    ),

    declarationNumber: getFirstAvailableValue(
      lookup,
      aliasesFor(aliases.declarationNumber, RISK_COLUMN_ALIASES.declarationNumber)
    ),
    transitDeclarationNumber: getFirstAvailableValue(
      lookup,
      aliasesFor(aliases.transitDeclarationNumber, RISK_COLUMN_ALIASES.transitDeclarationNumber)
    ),
    declarationDate: getFirstAvailableValue(
      lookup,
      aliasesFor(aliases.declarationDate, RISK_COLUMN_ALIASES.declarationDate)
    ),
    declarationHijriDate: getFirstAvailableValue(
      lookup,
      aliasesFor(aliases.declarationHijriDate, RISK_COLUMN_ALIASES.declarationHijriDate)
    ),

    manifestNumber: getFirstAvailableValue(
      lookup,
      aliasesFor(aliases.manifestNumber, RISK_COLUMN_ALIASES.manifestNumber)
    ),
    manifestType: getFirstAvailableValue(
      lookup,
      aliasesFor(aliases.manifestType, RISK_COLUMN_ALIASES.manifestType)
    ),
    manifestDate: getFirstAvailableValue(
      lookup,
      aliasesFor(aliases.manifestDate, RISK_COLUMN_ALIASES.manifestDate)
    ),

    plateOrContainerNumber: getFirstAvailableValue(
      lookup,
      aliasesFor(aliases.plateOrContainerNumber, RISK_COLUMN_ALIASES.plateOrContainerNumber)
    ),
    finalDestination: getFirstAvailableValue(
      lookup,
      aliasesFor(aliases.finalDestination, RISK_COLUMN_ALIASES.finalDestination)
    ),

    entryDate: getFirstAvailableValue(lookup, aliasesFor(aliases.entryDate, RISK_COLUMN_ALIASES.entryDate)),
    exitDate: getFirstAvailableValue(lookup, aliasesFor(aliases.exitDate, RISK_COLUMN_ALIASES.exitDate)),

    chassisNumber: getFirstAvailableValue(
      lookup,
      aliasesFor(aliases.chassisNumber, RISK_COLUMN_ALIASES.chassisNumber)
    ),

    reportNumber,
    hasReport: reportNumber !== null,

    xrayLevelOneResult: getFirstAvailableValue(
      lookup,
      aliasesFor(aliases.xrayLevelOneResult, RISK_COLUMN_ALIASES.xrayLevelOneResult)
    ),
    xrayLevelTwoResult: getFirstAvailableValue(
      lookup,
      aliasesFor(aliases.xrayLevelTwoResult, RISK_COLUMN_ALIASES.xrayLevelTwoResult)
    ),
    inspectorResult: getFirstAvailableValue(
      lookup,
      aliasesFor(aliases.inspectorResult, RISK_COLUMN_ALIASES.inspectorResult)
    ),
    oppositeInspectorResult: getFirstAvailableValue(
      lookup,
      aliasesFor(aliases.oppositeInspectorResult, RISK_COLUMN_ALIASES.oppositeInspectorResult)
    ),
    liveMeansResult: getFirstAvailableValue(
      lookup,
      aliasesFor(aliases.liveMeansResult, RISK_COLUMN_ALIASES.liveMeansResult)
    ),

    xrayImageId: getFirstAvailableValue(
      lookup,
      aliasesFor(aliases.xrayImageId, RISK_COLUMN_ALIASES.xrayImageId)
    ),
    xrayEntryDate: getFirstAvailableValue(
      lookup,
      aliasesFor(aliases.xrayEntryDate, RISK_COLUMN_ALIASES.xrayEntryDate)
    ),

    targetedByRiskEngine: getFirstAvailableValue(
      lookup,
      aliasesFor(aliases.targetedByRiskEngine, RISK_COLUMN_ALIASES.targetedByRiskEngine)
    ),
    riskMessage: getFirstAvailableValue(
      lookup,
      aliasesFor(aliases.riskMessage, RISK_COLUMN_ALIASES.riskMessage)
    ),
    stage: getFirstAvailableValue(lookup, aliasesFor(aliases.stage, RISK_COLUMN_ALIASES.stage)),

    rawRow: sourceRow,
    sourceSheetName,
    sourceRowNumber
  };
}
