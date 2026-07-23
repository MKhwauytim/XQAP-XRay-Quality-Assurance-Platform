import { RISK_COLUMN_ALIASES } from "./riskDataColumns";
import type { NormalizedRiskRow, RiskSourceRow } from "./riskDataTypes";

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

function createHeaderLookup(row: RiskSourceRow): Map<string, unknown> {
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
    aliases.reportNumber || RISK_COLUMN_ALIASES.reportNumber
  );

  return {
    movementType,

    portCode: getFirstAvailableValue(lookup, aliases.portCode || RISK_COLUMN_ALIASES.portCode),
    portName: getFirstAvailableValue(lookup, aliases.portName || RISK_COLUMN_ALIASES.portName),
    portType: getFirstAvailableValue(lookup, aliases.portType || RISK_COLUMN_ALIASES.portType),

    movementNumber: getFirstAvailableValue(
      lookup,
      aliases.movementNumber || RISK_COLUMN_ALIASES.movementNumber
    ),
    movementDate: getFirstAvailableValue(
      lookup,
      aliases.movementDate || RISK_COLUMN_ALIASES.movementDate
    ),
    movementHijriDate: getFirstAvailableValue(
      lookup,
      aliases.movementHijriDate || RISK_COLUMN_ALIASES.movementHijriDate
    ),

    declarationNumber: getFirstAvailableValue(
      lookup,
      aliases.declarationNumber || RISK_COLUMN_ALIASES.declarationNumber
    ),
    declarationDate: getFirstAvailableValue(
      lookup,
      aliases.declarationDate || RISK_COLUMN_ALIASES.declarationDate
    ),
    declarationHijriDate: getFirstAvailableValue(
      lookup,
      aliases.declarationHijriDate || RISK_COLUMN_ALIASES.declarationHijriDate
    ),

    manifestNumber: getFirstAvailableValue(
      lookup,
      aliases.manifestNumber || RISK_COLUMN_ALIASES.manifestNumber
    ),
    manifestType: getFirstAvailableValue(
      lookup,
      aliases.manifestType || RISK_COLUMN_ALIASES.manifestType
    ),

    plateOrContainerNumber: getFirstAvailableValue(
      lookup,
      aliases.plateOrContainerNumber || RISK_COLUMN_ALIASES.plateOrContainerNumber
    ),
    finalDestination: getFirstAvailableValue(
      lookup,
      aliases.finalDestination || RISK_COLUMN_ALIASES.finalDestination
    ),

    entryDate: getFirstAvailableValue(lookup, aliases.entryDate || RISK_COLUMN_ALIASES.entryDate),
    exitDate: getFirstAvailableValue(lookup, aliases.exitDate || RISK_COLUMN_ALIASES.exitDate),

    chassisNumber: getFirstAvailableValue(
      lookup,
      aliases.chassisNumber || RISK_COLUMN_ALIASES.chassisNumber
    ),

    reportNumber,
    hasReport: reportNumber !== null,

    xrayLevelOneResult: getFirstAvailableValue(
      lookup,
      aliases.xrayLevelOneResult || RISK_COLUMN_ALIASES.xrayLevelOneResult
    ),
    xrayLevelTwoResult: getFirstAvailableValue(
      lookup,
      aliases.xrayLevelTwoResult || RISK_COLUMN_ALIASES.xrayLevelTwoResult
    ),
    inspectorResult: getFirstAvailableValue(
      lookup,
      aliases.inspectorResult || RISK_COLUMN_ALIASES.inspectorResult
    ),
    oppositeInspectorResult: getFirstAvailableValue(
      lookup,
      aliases.oppositeInspectorResult || RISK_COLUMN_ALIASES.oppositeInspectorResult
    ),
    liveMeansResult: getFirstAvailableValue(
      lookup,
      aliases.liveMeansResult || RISK_COLUMN_ALIASES.liveMeansResult
    ),

    xrayImageId: getFirstAvailableValue(
      lookup,
      aliases.xrayImageId || RISK_COLUMN_ALIASES.xrayImageId
    ),
    xrayEntryDate: getFirstAvailableValue(
      lookup,
      aliases.xrayEntryDate || RISK_COLUMN_ALIASES.xrayEntryDate
    ),

    targetedByRiskEngine: getFirstAvailableValue(
      lookup,
      aliases.targetedByRiskEngine || RISK_COLUMN_ALIASES.targetedByRiskEngine
    ),
    riskMessage: getFirstAvailableValue(
      lookup,
      aliases.riskMessage || RISK_COLUMN_ALIASES.riskMessage
    ),
    stage: getFirstAvailableValue(lookup, aliases.stage || RISK_COLUMN_ALIASES.stage),

    rawRow: sourceRow,
    sourceSheetName,
    sourceRowNumber
  };
}