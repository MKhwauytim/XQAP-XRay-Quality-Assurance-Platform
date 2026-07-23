import { BI_COLUMN_ALIASES } from "./biDataColumns";
import type { BiSourceRow, NormalizedBiRow } from "./biDataTypes";

function normalizeArabicText(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[ـ]/g, "")
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

    xrayImageId: getFirstAvailableValue(lookup, aliases.xrayImageId || BI_COLUMN_ALIASES.xrayImageId),
    xrayEntryDate: getFirstAvailableValue(
      lookup,
      aliases.xrayEntryDate || BI_COLUMN_ALIASES.xrayEntryDate
    ),

    portType: getFirstAvailableValue(lookup, aliases.portType || BI_COLUMN_ALIASES.portType),
    portCode: getFirstAvailableValue(lookup, aliases.portCode || BI_COLUMN_ALIASES.portCode),
    portName: getFirstAvailableValue(lookup, aliases.portName || BI_COLUMN_ALIASES.portName),

    declarationNumber: getFirstAvailableValue(
      lookup,
      aliases.declarationNumber || BI_COLUMN_ALIASES.declarationNumber
    ),
    preliminaryDeclarationNumber: getFirstAvailableValue(
      lookup,
      aliases.preliminaryDeclarationNumber || BI_COLUMN_ALIASES.preliminaryDeclarationNumber
    ),
    declarationDate: getFirstAvailableValue(
      lookup,
      aliases.declarationDate || BI_COLUMN_ALIASES.declarationDate
    ),
    declarationHijriDate: getFirstAvailableValue(
      lookup,
      aliases.declarationHijriDate || BI_COLUMN_ALIASES.declarationHijriDate
    ),

    inboundOutboundType: getFirstAvailableValue(
      lookup,
      aliases.inboundOutboundType || BI_COLUMN_ALIASES.inboundOutboundType
    ),
    declarationType: getFirstAvailableValue(
      lookup,
      aliases.declarationType || BI_COLUMN_ALIASES.declarationType
    ),
    declarationStatus: getFirstAvailableValue(
      lookup,
      aliases.declarationStatus || BI_COLUMN_ALIASES.declarationStatus
    ),

    plateOrContainerNumber: getFirstAvailableValue(
      lookup,
      aliases.plateOrContainerNumber || BI_COLUMN_ALIASES.plateOrContainerNumber
    ),
    chassisNumber: getFirstAvailableValue(
      lookup,
      aliases.chassisNumber || BI_COLUMN_ALIASES.chassisNumber
    ),

    governance: getFirstAvailableValue(lookup, aliases.governance || BI_COLUMN_ALIASES.governance),

    levelOneEmployee: getFirstAvailableValue(
      lookup,
      aliases.levelOneEmployee || BI_COLUMN_ALIASES.levelOneEmployee
    ),
    levelTwoEmployee: getFirstAvailableValue(
      lookup,
      aliases.levelTwoEmployee || BI_COLUMN_ALIASES.levelTwoEmployee
    ),

    levelOneResultCode: getFirstAvailableValue(
      lookup,
      aliases.levelOneResultCode || BI_COLUMN_ALIASES.levelOneResultCode
    ),
    levelTwoResultCode: getFirstAvailableValue(
      lookup,
      aliases.levelTwoResultCode || BI_COLUMN_ALIASES.levelTwoResultCode
    ),

    levelOneResult: getFirstAvailableValue(
      lookup,
      aliases.levelOneResult || BI_COLUMN_ALIASES.levelOneResult
    ),
    levelTwoResult: getFirstAvailableValue(
      lookup,
      aliases.levelTwoResult || BI_COLUMN_ALIASES.levelTwoResult
    ),

    manualInspectionResultCode: getFirstAvailableValue(
      lookup,
      aliases.manualInspectionResultCode || BI_COLUMN_ALIASES.manualInspectionResultCode
    ),
    manualInspectionResult: getFirstAvailableValue(
      lookup,
      aliases.manualInspectionResult || BI_COLUMN_ALIASES.manualInspectionResult
    ),

    oppositeInspectionEmployee: getFirstAvailableValue(
      lookup,
      aliases.oppositeInspectionEmployee || BI_COLUMN_ALIASES.oppositeInspectionEmployee
    ),
    oppositeInspectionResultCode: getFirstAvailableValue(
      lookup,
      aliases.oppositeInspectionResultCode || BI_COLUMN_ALIASES.oppositeInspectionResultCode
    ),
    oppositeInspectionResult: getFirstAvailableValue(
      lookup,
      aliases.oppositeInspectionResult || BI_COLUMN_ALIASES.oppositeInspectionResult
    ),

    liveMeansEmployee: getFirstAvailableValue(
      lookup,
      aliases.liveMeansEmployee || BI_COLUMN_ALIASES.liveMeansEmployee
    ),
    liveMeansResultCode: getFirstAvailableValue(
      lookup,
      aliases.liveMeansResultCode || BI_COLUMN_ALIASES.liveMeansResultCode
    ),
    liveMeansResult: getFirstAvailableValue(
      lookup,
      aliases.liveMeansResult || BI_COLUMN_ALIASES.liveMeansResult
    ),

    notes: getFirstAvailableValue(lookup, aliases.notes || BI_COLUMN_ALIASES.notes),

    rawRow: sourceRow,
    sourceSheetName,
    sourceRowNumber
  };
}