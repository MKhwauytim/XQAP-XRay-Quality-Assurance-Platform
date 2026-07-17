import type { DistributionEntry, DistributionEvent } from "../../../../data/distribution/distributionTypes";
import type { MonthEditData } from "../../../../data/population/populationStorage";
import { MonthClosedError } from "../../../../data/population/monthLock";
import type { BiWorkbookResult, NormalizedBiRow } from "./biData/biDataTypes";
import type { NormalizedRiskRow, RiskWorkbookResult } from "./riskData/riskDataTypes";
import type {
  PopulationProcessingResult,
  PreparedPopulationRow
} from "./processing/populationProcessingTypes";

export type PhaseDefinition = {
  id: number;
  title: string;
  description: string;
};

export const PHASES: PhaseDefinition[] = [
  { id: 1, title: "رفع البيانات", description: "رفع ملفات Excel المطلوبة لبدء معالجة بيانات المجتمع." },
  { id: 2, title: "تقرير البيانات والمعالجة", description: "عرض تقرير مصغر للملفات ثم متابعة منطق المعالجة." },
  { id: 3, title: "اختيار العينة", description: "تطبيق منطق اختيار العينة حسب قواعد العمل المعتمدة." },
  { id: 4, title: "توزيع العينة", description: "توزيع عناصر العينة على الموظفين المصرح لهم داخل النظام." }
];

export function sourceFileMetadata(file: File | null): { name: string; size: number; lastModified: number } | null {
  return file ? { name: file.name, size: file.size, lastModified: file.lastModified } : null;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([first], [second]) => first.localeCompare(second))
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

export function stableHash(value: unknown): string {
  const text = stableStringify(value);
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

export function isSupportedExcelFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return name.endsWith(".xlsx") || name.endsWith(".xls");
}

function reconstructedRiskWorkbook(rows: MonthEditData["riskRawRows"]): RiskWorkbookResult | null {
  if (rows.length === 0) return null;
  return {
    rows: rows as unknown as NormalizedRiskRow[],
    sheetSummaries: [],
    unknownSheetNames: [],
    totalOriginalRows: rows.length,
    totalNormalizedRows: rows.length,
    totalExcludedMissingXrayIdCount: 0
  };
}

function reconstructedBiWorkbook(rows: MonthEditData["biRawRows"]): BiWorkbookResult | null {
  if (rows.length === 0) return null;
  return {
    rows: rows as unknown as NormalizedBiRow[],
    sheetSummaries: [],
    unknownSheetNames: [],
    totalOriginalRows: rows.length,
    totalNormalizedRows: rows.length,
    totalExcludedMissingXrayIdCount: 0
  };
}

function fallbackProcessingSummary(data: MonthEditData): PopulationProcessingResult["summary"] {
  const populationCount = data.populationRows?.length ?? 0;
  return {
    riskOriginalRows: populationCount,
    validRiskIdRows: populationCount,
    invalidRiskIdRows: 0,
    duplicateRiskIdRows: 0,
    rowsAfterDeduplication: populationCount,
    removedInvalidResultRows: 0,
    finalPreparedPopulationRows: populationCount,
    certScanRows: data.certScanRows,
    nonCertScanRows: data.nonCertScanRows,
    certScanPercentage: populationCount > 0 ? Math.round((data.certScanRows / populationCount) * 100) : 0,
    nonCertScanPercentage: populationCount > 0 ? Math.round((data.nonCertScanRows / populationCount) * 100) : 0,
    biProvided: data.biRawRows.length > 0,
    biMatchedRows: 0,
    biUnmatchedRows: 0,
    biMatchPercentage: 0,
    totalBiFilledFields: 0,
    biFieldFillSummary: []
  };
}

function reconstructedPopulation(data: MonthEditData): PopulationProcessingResult | null {
  if (!data.populationRows) return null;
  return {
    preparedRows: data.populationRows as unknown as PreparedPopulationRow[],
    removedRows: data.processingSummary?.removedRows ?? [],
    duplicateRows: data.processingSummary?.duplicateRows ?? [],
    invalidResultRows: data.processingSummary?.invalidResultRows ?? [],
    summary: data.processingSummary?.summary ?? fallbackProcessingSummary(data)
  };
}

export function buildLoadedMonthState(data: MonthEditData) {
  const phase = data.distributionCurrent || data.sampleData
    ? { current: 4, completed: [1, 2, 3] }
    : data.populationRows
      ? { current: 3, completed: [1, 2] }
      : null;
  return {
    riskWorkbook: reconstructedRiskWorkbook(data.riskRawRows),
    biWorkbook: reconstructedBiWorkbook(data.biRawRows),
    population: reconstructedPopulation(data),
    sample: data.sampleData,
    distribution: data.distributionCurrent,
    phase
  };
}

export function buildAssignedEntryMap(
  events: DistributionEvent[],
  sampleRows: PreparedPopulationRow[]
): Map<string, DistributionEntry[]> {
  const rows = new Map(sampleRows.map((row) => [row.xrayImageId, row]));
  const assignments = new Map<string, DistributionEntry[]>();
  for (const event of events) {
    if (event.eventType !== "assigned") continue;
    const row = rows.get(event.xrayImageId);
    if (!row) continue;
    const entries = assignments.get(event.assignedTo) ?? [];
    entries.push({
      xrayImageId: event.xrayImageId,
      assignedTo: event.assignedTo,
      status: "pending",
      replacedById: null,
      lastEventAt: event.eventAt,
      row
    });
    assignments.set(event.assignedTo, entries);
  }
  return assignments;
}

export function distributionErrorText(error: unknown, monthClosedText: string): string {
  if (error instanceof MonthClosedError) return monthClosedText;
  return error instanceof Error ? error.message : "خطأ غير معروف";
}
