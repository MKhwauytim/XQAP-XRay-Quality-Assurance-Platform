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
  row: BiSourceRow,
  candidateHeaders: readonly string[]
): string | null {
  const lookup = createHeaderLookup(row);

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

  return {
    source,

    xrayImageId: getFirstAvailableValue(sourceRow, aliases.xrayImageId || BI_COLUMN_ALIASES.xrayImageId),
    xrayEntryDate: getFirstAvailableValue(
      sourceRow,
      aliases.xrayEntryDate || BI_COLUMN_ALIASES.xrayEntryDate
    ),

    portType: getFirstAvailableValue(sourceRow, aliases.portType || BI_COLUMN_ALIASES.portType),
    portCode: getFirstAvailableValue(sourceRow, aliases.portCode || BI_COLUMN_ALIASES.portCode),
    portName: getFirstAvailableValue(sourceRow, aliases.portName || BI_COLUMN_ALIASES.portName),

    declarationNumber: getFirstAvailableValue(
      sourceRow,
      aliases.declarationNumber || BI_COLUMN_ALIASES.declarationNumber
    ),
    preliminaryDeclarationNumber: getFirstAvailableValue(
      sourceRow,
      aliases.preliminaryDeclarationNumber || BI_COLUMN_ALIASES.preliminaryDeclarationNumber
    ),
    declarationDate: getFirstAvailableValue(
      sourceRow,
      aliases.declarationDate || BI_COLUMN_ALIASES.declarationDate
    ),
    declarationHijriDate: getFirstAvailableValue(
      sourceRow,
      aliases.declarationHijriDate || BI_COLUMN_ALIASES.declarationHijriDate
    ),

    inboundOutboundType: getFirstAvailableValue(
      sourceRow,
      aliases.inboundOutboundType || BI_COLUMN_ALIASES.inboundOutboundType
    ),
    declarationType: getFirstAvailableValue(
      sourceRow,
      aliases.declarationType || BI_COLUMN_ALIASES.declarationType
    ),
    declarationStatus: getFirstAvailableValue(
      sourceRow,
      aliases.declarationStatus || BI_COLUMN_ALIASES.declarationStatus
    ),

    plateOrContainerNumber: getFirstAvailableValue(
      sourceRow,
      aliases.plateOrContainerNumber || BI_COLUMN_ALIASES.plateOrContainerNumber
    ),
    chassisNumber: getFirstAvailableValue(
      sourceRow,
      aliases.chassisNumber || BI_COLUMN_ALIASES.chassisNumber
    ),

    governance: getFirstAvailableValue(sourceRow, aliases.governance || BI_COLUMN_ALIASES.governance),

    levelOneEmployee: getFirstAvailableValue(
      sourceRow,
      aliases.levelOneEmployee || BI_COLUMN_ALIASES.levelOneEmployee
    ),
    levelTwoEmployee: getFirstAvailableValue(
      sourceRow,
      aliases.levelTwoEmployee || BI_COLUMN_ALIASES.levelTwoEmployee
    ),

    levelOneResultCode: getFirstAvailableValue(
      sourceRow,
      aliases.levelOneResultCode || BI_COLUMN_ALIASES.levelOneResultCode
    ),
    levelTwoResultCode: getFirstAvailableValue(
      sourceRow,
      aliases.levelTwoResultCode || BI_COLUMN_ALIASES.levelTwoResultCode
    ),

    levelOneResult: getFirstAvailableValue(
      sourceRow,
      aliases.levelOneResult || BI_COLUMN_ALIASES.levelOneResult
    ),
    levelTwoResult: getFirstAvailableValue(
      sourceRow,
      aliases.levelTwoResult || BI_COLUMN_ALIASES.levelTwoResult
    ),

    manualInspectionResultCode: getFirstAvailableValue(
      sourceRow,
      aliases.manualInspectionResultCode || BI_COLUMN_ALIASES.manualInspectionResultCode
    ),
    manualInspectionResult: getFirstAvailableValue(
      sourceRow,
      aliases.manualInspectionResult || BI_COLUMN_ALIASES.manualInspectionResult
    ),

    oppositeInspectionEmployee: getFirstAvailableValue(
      sourceRow,
      aliases.oppositeInspectionEmployee || BI_COLUMN_ALIASES.oppositeInspectionEmployee
    ),
    oppositeInspectionResultCode: getFirstAvailableValue(
      sourceRow,
      aliases.oppositeInspectionResultCode || BI_COLUMN_ALIASES.oppositeInspectionResultCode
    ),
    oppositeInspectionResult: getFirstAvailableValue(
      sourceRow,
      aliases.oppositeInspectionResult || BI_COLUMN_ALIASES.oppositeInspectionResult
    ),

    liveMeansEmployee: getFirstAvailableValue(
      sourceRow,
      aliases.liveMeansEmployee || BI_COLUMN_ALIASES.liveMeansEmployee
    ),
    liveMeansResultCode: getFirstAvailableValue(
      sourceRow,
      aliases.liveMeansResultCode || BI_COLUMN_ALIASES.liveMeansResultCode
    ),
    liveMeansResult: getFirstAvailableValue(
      sourceRow,
      aliases.liveMeansResult || BI_COLUMN_ALIASES.liveMeansResult
    ),

    notes: getFirstAvailableValue(sourceRow, aliases.notes || BI_COLUMN_ALIASES.notes),

    rawRow: sourceRow,
    sourceSheetName,
    sourceRowNumber
  };
}