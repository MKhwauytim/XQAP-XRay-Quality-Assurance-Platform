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
  row: RiskSourceRow,
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

export function normalizeRiskRow(params: {
  sourceRow: RiskSourceRow;
  movementType: string;
  sourceSheetName: string;
  sourceRowNumber: number;
  columnMappings?: Record<string, string[]>;
}): NormalizedRiskRow {
  const { sourceRow, movementType, sourceSheetName, sourceRowNumber, columnMappings } = params;

  const aliases = columnMappings || RISK_COLUMN_ALIASES;

  const reportNumber = getFirstAvailableValue(
    sourceRow,
    aliases.reportNumber || RISK_COLUMN_ALIASES.reportNumber
  );

  return {
    movementType,

    portCode: getFirstAvailableValue(sourceRow, aliases.portCode || RISK_COLUMN_ALIASES.portCode),
    portName: getFirstAvailableValue(sourceRow, aliases.portName || RISK_COLUMN_ALIASES.portName),
    portType: getFirstAvailableValue(sourceRow, aliases.portType || RISK_COLUMN_ALIASES.portType),

    movementNumber: getFirstAvailableValue(
      sourceRow,
      aliases.movementNumber || RISK_COLUMN_ALIASES.movementNumber
    ),
    movementDate: getFirstAvailableValue(
      sourceRow,
      aliases.movementDate || RISK_COLUMN_ALIASES.movementDate
    ),
    movementHijriDate: getFirstAvailableValue(
      sourceRow,
      aliases.movementHijriDate || RISK_COLUMN_ALIASES.movementHijriDate
    ),

    declarationNumber: getFirstAvailableValue(
      sourceRow,
      aliases.declarationNumber || RISK_COLUMN_ALIASES.declarationNumber
    ),
    declarationDate: getFirstAvailableValue(
      sourceRow,
      aliases.declarationDate || RISK_COLUMN_ALIASES.declarationDate
    ),
    declarationHijriDate: getFirstAvailableValue(
      sourceRow,
      aliases.declarationHijriDate || RISK_COLUMN_ALIASES.declarationHijriDate
    ),

    manifestNumber: getFirstAvailableValue(
      sourceRow,
      aliases.manifestNumber || RISK_COLUMN_ALIASES.manifestNumber
    ),
    manifestType: getFirstAvailableValue(
      sourceRow,
      aliases.manifestType || RISK_COLUMN_ALIASES.manifestType
    ),

    plateOrContainerNumber: getFirstAvailableValue(
      sourceRow,
      aliases.plateOrContainerNumber || RISK_COLUMN_ALIASES.plateOrContainerNumber
    ),
    finalDestination: getFirstAvailableValue(
      sourceRow,
      aliases.finalDestination || RISK_COLUMN_ALIASES.finalDestination
    ),

    entryDate: getFirstAvailableValue(sourceRow, aliases.entryDate || RISK_COLUMN_ALIASES.entryDate),
    exitDate: getFirstAvailableValue(sourceRow, aliases.exitDate || RISK_COLUMN_ALIASES.exitDate),

    chassisNumber: getFirstAvailableValue(
      sourceRow,
      aliases.chassisNumber || RISK_COLUMN_ALIASES.chassisNumber
    ),

    reportNumber,
    hasReport: reportNumber !== null,

    xrayLevelOneResult: getFirstAvailableValue(
      sourceRow,
      aliases.xrayLevelOneResult || RISK_COLUMN_ALIASES.xrayLevelOneResult
    ),
    xrayLevelTwoResult: getFirstAvailableValue(
      sourceRow,
      aliases.xrayLevelTwoResult || RISK_COLUMN_ALIASES.xrayLevelTwoResult
    ),
    inspectorResult: getFirstAvailableValue(
      sourceRow,
      aliases.inspectorResult || RISK_COLUMN_ALIASES.inspectorResult
    ),
    oppositeInspectorResult: getFirstAvailableValue(
      sourceRow,
      aliases.oppositeInspectorResult || RISK_COLUMN_ALIASES.oppositeInspectorResult
    ),
    liveMeansResult: getFirstAvailableValue(
      sourceRow,
      aliases.liveMeansResult || RISK_COLUMN_ALIASES.liveMeansResult
    ),

    xrayImageId: getFirstAvailableValue(
      sourceRow,
      aliases.xrayImageId || RISK_COLUMN_ALIASES.xrayImageId
    ),
    xrayEntryDate: getFirstAvailableValue(
      sourceRow,
      aliases.xrayEntryDate || RISK_COLUMN_ALIASES.xrayEntryDate
    ),

    targetedByRiskEngine: getFirstAvailableValue(
      sourceRow,
      aliases.targetedByRiskEngine || RISK_COLUMN_ALIASES.targetedByRiskEngine
    ),
    riskMessage: getFirstAvailableValue(
      sourceRow,
      aliases.riskMessage || RISK_COLUMN_ALIASES.riskMessage
    ),
    stage: getFirstAvailableValue(sourceRow, aliases.stage || RISK_COLUMN_ALIASES.stage),

    rawRow: sourceRow,
    sourceSheetName,
    sourceRowNumber
  };
}