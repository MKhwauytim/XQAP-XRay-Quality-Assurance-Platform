import * as XLSX from "xlsx";

import type { BiWorkbookResult, NormalizedBiRow } from "../biData/biDataTypes";
import type {
  NormalizedRiskRow,
  RiskWorkbookResult
} from "../riskData/riskDataTypes";
import type {
  BiFieldFillSummary,
  PopulationProcessingResult,
  PreparedPopulationRow,
  RemovedPopulationRow
} from "./populationProcessingTypes";

import { RISK_COLUMN_ALIASES } from "../riskData/riskDataColumns";
import { BI_COLUMN_ALIASES } from "../biData/biDataColumns";

function normalizeText(value: unknown): string {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function normalizeArabicText(value: unknown): string {
  return normalizeText(value)
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي");
}

const EXCLUDED_SOURCE_COLUMNS: string[] = []; // Configure columns here to exclude from exports if needed

function getUnmappedRawFields(
  rawRow: Record<string, unknown> | undefined,
  aliases: Record<string, readonly string[]>
): Record<string, unknown> {
  if (!rawRow) {
    return {};
  }

  const aliasSet = new Set<string>();
  for (const list of Object.values(aliases)) {
    for (const val of list) {
      aliasSet.add(normalizeArabicText(val));
    }
  }

  const excludedSet = new Set(EXCLUDED_SOURCE_COLUMNS.map(normalizeArabicText));

  const extras: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rawRow)) {
    const normKey = normalizeArabicText(key);
    if (!aliasSet.has(normKey) && !excludedSet.has(normKey)) {
      extras[key] = value;
    }
  }

  return extras;
}

function normalizeXrayId(value: unknown): string {
  return normalizeText(value).toUpperCase();
}

function makeComparisonKey(xrayImageId: unknown, portName: unknown): string {
  return `${normalizeXrayId(xrayImageId)}|${normalizeArabicText(portName)}`;
}

function makeSourceRowKey(
  sourceSheetName: string | null,
  sourceRowNumber: number | null
): string {
  return `${sourceSheetName ?? ""}|${sourceRowNumber ?? ""}`;
}

function safeSheetName(sheetName: string): string {
  return sheetName.replace(/[\\/?*[\]:]/g, "-").slice(0, 31);
}

function appendJsonSheet(
  workbook: XLSX.WorkBook,
  rows: Record<string, unknown>[],
  sheetName: string
): void {
  const worksheet = XLSX.utils.json_to_sheet(rows.length > 0 ? rows : [{}]);
  XLSX.utils.book_append_sheet(workbook, worksheet, safeSheetName(sheetName));
}

function buildRiskRowLookup(
  riskWorkbookResult: RiskWorkbookResult
): Map<string, NormalizedRiskRow> {
  const lookup = new Map<string, NormalizedRiskRow>();

  for (const row of riskWorkbookResult.rows) {
    lookup.set(makeSourceRowKey(row.sourceSheetName, row.sourceRowNumber), row);
  }

  return lookup;
}

function riskRowToExport(row: NormalizedRiskRow): Record<string, unknown> {
  const base = {
    "المستوى": row.stage,
    "معرف الأشعة": row.xrayImageId,
    "تاريخ دخول الأشعة": row.xrayEntryDate,
    "نوع المنفذ": row.portType,
    "اسم المنفذ": row.portName,
    "رقم البيان": row.declarationNumber,
    "تاريخ البيان": row.declarationDate,
    "رقم اللوحة/الحاوية": row.plateOrContainerNumber,
    "رقم الهيكل": row.chassisNumber,
    "نتيجة المستوى الأول للأشعة": row.xrayLevelOneResult,
    "نتيجة المستوى الثاني للأشعة": row.xrayLevelTwoResult,
    "نوع الحركة": row.movementType,
    "رقم المحضر": row.reportNumber,
    "مستهدف من محرك المخاطر": row.targetedByRiskEngine,
    "رسالة المخاطر": row.riskMessage,
    "Source Sheet": row.sourceSheetName,
    "Source Row Number": row.sourceRowNumber
  };

  const extras = getUnmappedRawFields(row.rawRow, RISK_COLUMN_ALIASES);
  return { ...base, ...extras };
}

function removedRiskRowToFullExport(params: {
  issueGroup: string;
  removedRow: RemovedPopulationRow;
  riskRowLookup: Map<string, NormalizedRiskRow>;
}): Record<string, unknown> {
  const { issueGroup, removedRow, riskRowLookup } = params;

  const sourceKey = makeSourceRowKey(
    removedRow.sourceSheetName,
    removedRow.sourceRowNumber
  );

  const riskRow = riskRowLookup.get(sourceKey);

  if (!riskRow) {
    return {
      "Reason": removedRow.reason,
      "Issue Group": issueGroup,
      "Source Row Number": removedRow.sourceRowNumber,
      "Source Sheet": removedRow.sourceSheetName,
      "المستوى": null,
      "معرف الأشعة": removedRow.xrayImageId,
      "تاريخ دخول الأشعة": null,
      "نوع المنفذ": null,
      "اسم المنفذ": removedRow.portName,
      "رقم البيان": null,
      "تاريخ البيان": null,
      "رقم اللوحة/الحاوية": null,
      "رقم الهيكل": null,
      "نتيجة المستوى الأول للأشعة": null,
      "نتيجة المستوى الثاني للأشعة": null,
      "نوع الحركة": null,
      "رقم المحضر": null,
      "مستهدف من محرك المخاطر": null,
      "رسالة المخاطر": null
    };
  }

  return {
    "Reason": removedRow.reason,
    "Issue Group": issueGroup,
    "Source Row Number": riskRow.sourceRowNumber,
    "Source Sheet": riskRow.sourceSheetName,
    "المستوى": riskRow.stage,
    "معرف الأشعة": riskRow.xrayImageId,
    "تاريخ دخول الأشعة": riskRow.xrayEntryDate,
    "نوع المنفذ": riskRow.portType,
    "اسم المنفذ": riskRow.portName,
    "رقم البيان": riskRow.declarationNumber,
    "تاريخ البيان": riskRow.declarationDate,
    "رقم اللوحة/الحاوية": riskRow.plateOrContainerNumber,
    "رقم الهيكل": riskRow.chassisNumber,
    "نتيجة المستوى الأول للأشعة": riskRow.xrayLevelOneResult,
    "نتيجة المستوى الثاني للأشعة": riskRow.xrayLevelTwoResult,
    "نوع الحركة": riskRow.movementType,
    "رقم المحضر": riskRow.reportNumber,
    "مستهدف من محرك المخاطر": riskRow.targetedByRiskEngine,
    "رسالة المخاطر": riskRow.riskMessage
  };
}

function removedRiskRowsToFullExport(params: {
  issueGroup: string;
  removedRows: RemovedPopulationRow[];
  riskRowLookup: Map<string, NormalizedRiskRow>;
}): Record<string, unknown>[] {
  const { issueGroup, removedRows, riskRowLookup } = params;

  return removedRows.map((removedRow) =>
    removedRiskRowToFullExport({
      issueGroup,
      removedRow,
      riskRowLookup
    })
  );
}

function notUsedOtherIssuesToExport(params: {
  result: PopulationProcessingResult;
  riskRowLookup: Map<string, NormalizedRiskRow>;
}): Record<string, unknown>[] {
  const { result, riskRowLookup } = params;

  return [
    ...removedRiskRowsToFullExport({
      issueGroup: "Invalid X-ray ID",
      removedRows: result.removedRows,
      riskRowLookup
    }),
    ...removedRiskRowsToFullExport({
      issueGroup: "Invalid Level Result",
      removedRows: result.invalidResultRows,
      riskRowLookup
    })
  ];
}

function riskRawRowsToExport(
  riskWorkbookResult: RiskWorkbookResult
): Record<string, unknown>[] {
  return riskWorkbookResult.rows.map((row) => ({
    "Source Row Number": row.sourceRowNumber,
    "Source Sheet": row.sourceSheetName,
    ...riskRowToExport(row)
  }));
}

function biRowToExport(row: NormalizedBiRow): Record<string, unknown> {
  const base = {
    "Source Row Number": row.sourceRowNumber,
    "Source Sheet": row.sourceSheetName,
    "معرف الأشعة": row.xrayImageId,
    "تاريخ دخول الأشعة": row.xrayEntryDate,
    "نوع المنفذ": row.portType,
    "اسم المنفذ": row.portName,
    "رقم البيان": row.declarationNumber,
    "تاريخ البيان": row.declarationDate,
    "رقم اللوحة/الحاوية": row.plateOrContainerNumber,
    "رقم الهيكل": row.chassisNumber,
    "نتيجة المستوى الأول للأشعة": row.levelOneResult,
    "نتيجة المستوى الثاني للأشعة": row.levelTwoResult,
    "Source": row.source
  };

  const extras = getUnmappedRawFields(row.rawRow, BI_COLUMN_ALIASES);
  return { ...base, ...extras };
}

function biRawRowsToExport(
  biWorkbookResult: BiWorkbookResult | null
): Record<string, unknown>[] {
  if (!biWorkbookResult) {
    return [];
  }

  return biWorkbookResult.rows.map(biRowToExport);
}

import type { ExportColumnSetting } from "../../../../../data/population/populationConfig";

function preparedRowToExport(
  row: PreparedPopulationRow,
  columnsSetting?: ExportColumnSetting[]
): Record<string, unknown> {
  return !columnsSetting || columnsSetting.length === 0
    ? defaultPreparedRowToExport(row)
    : configuredPreparedRowToExport(row, columnsSetting);
}

function defaultPreparedRowToExport(row: PreparedPopulationRow): Record<string, unknown> {
  const base = {
    "Source Row Number": row.sourceRowNumber,
    "Source Sheet": row.sourceSheetName,
    "المستوى": row.stage,
    "معرف الأشعة": row.xrayImageId,
    "تاريخ دخول الأشعة": row.xrayEntryDate,
    "رمز المنفذ": row.portCode,
    "نوع المنفذ": row.portType,
    "اسم المنفذ": row.portName,
    "رقم البيان": row.declarationNumber,
    "تاريخ البيان": row.declarationDate,
    "رقم اللوحة/الحاوية": row.plateOrContainerNumber,
    "رقم الهيكل": row.chassisNumber,
    "نتيجة المستوى الأول للأشعة": row.xrayLevelOneResult,
    "نتيجة المستوى الثاني للأشعة": row.xrayLevelTwoResult,
    ...otherTeamResultsToExport(row),
    "ملاحظة المستويات": row.notes ?? null,
    "نوع الحركة": row.movementType,
    "رقم المحضر": row.reportNumber,
    "مستهدف من محرك المخاطر": row.targetedByRiskEngine,
    "رسالة المخاطر": row.riskMessage,
    "CertScan Status": row.certScanStatus,
    "CertScan Snippet": row.certScanSnippet,
    "Original CertScan Snippet": row.originalCertScanSnippet,
    "BI Enrichment Status": row.biEnrichmentStatus,
    "BI Matched": row.biMatched ? "Yes" : "No",
    "BI Filled Fields": row.biFilledFields.join(" | ")
  };
  return { ...base, ...getUnmappedRawFields(row.rawRow, RISK_COLUMN_ALIASES) };
}

function otherTeamResultsToExport(row: PreparedPopulationRow): Record<string, unknown> {
  return {
    "نتيجة المعاين": teamResultField(row, "manual", "result"),
    "رمز نتيجة المعاين": teamResultField(row, "manual", "code"),
    "نتيجة المفتش المعاكس": teamResultField(row, "opposite", "result"),
    "رمز نتيجة المفتش المعاكس": teamResultField(row, "opposite", "code"),
    "موظف التفتيش المعاكس": teamResultField(row, "opposite", "employeeId"),
    "نتيجة الوسائل الحية": teamResultField(row, "liveMeans", "result"),
    "رمز نتيجة الوسائل الحية": teamResultField(row, "liveMeans", "code"),
    "موظف الوسائل الحية": teamResultField(row, "liveMeans", "employeeId")
  };
}

function teamResultField(
  row: PreparedPopulationRow,
  team: keyof PreparedPopulationRow["otherResults"],
  field: keyof PreparedPopulationRow["otherResults"]["manual"]
): string | null {
  return row.otherResults?.[team]?.[field] ?? null;
}

function configuredColumnValue(row: PreparedPopulationRow, key: string): unknown {
  if (key in row) return (row as unknown as Record<string, unknown>)[key];
  if (row.rawRow && key in row.rawRow) return row.rawRow[key];
  return null;
}

function appendUnconfiguredRawFields(
  target: Record<string, unknown>,
  row: PreparedPopulationRow,
  configuredKeys: ReadonlySet<string>
): void {
  for (const [key, value] of Object.entries(row.rawRow ?? {})) {
    if (!configuredKeys.has(key)) target[key] = value;
  }
}

function configuredPreparedRowToExport(
  row: PreparedPopulationRow,
  columnsSetting: ExportColumnSetting[]
): Record<string, unknown> {
  const exported: Record<string, unknown> = {};
  const enabledColumns = columnsSetting
    .filter((column) => column.isEnabled)
    .sort((first, second) => first.order - second.order);
  for (const column of enabledColumns) {
    exported[column.exportHeader] = configuredColumnValue(row, column.fieldKey);
  }
  appendUnconfiguredRawFields(
    exported,
    row,
    new Set(columnsSetting.map((column) => column.fieldKey))
  );
  return exported;
}


function preparedRowsToExport(
  rows: PreparedPopulationRow[],
  columnsSetting?: ExportColumnSetting[]
): Record<string, unknown>[] {
  return rows.map((row) => preparedRowToExport(row, columnsSetting));
}

function biFieldSummaryToExport(
  rows: BiFieldFillSummary[]
): Record<string, unknown>[] {
  return rows.map((row) => ({
    "Column": row.fieldName,
    "Risk Empty Before": row.riskEmptyBefore,
    "Filled From BI": row.filledFromBi,
    "Still Empty After": row.stillEmptyAfter,
    "Fill %": row.fillPercentage
  }));
}

function summaryToExport(
  result: PopulationProcessingResult
): Record<string, unknown>[] {
  const summary = result.summary;

  return [
    {
      Metric: "Risk Original Rows",
      Value: summary.riskOriginalRows
    },
    {
      Metric: "Valid Risk X-ray ID Rows",
      Value: summary.validRiskIdRows
    },
    {
      Metric: "Invalid Risk X-ray ID Rows",
      Value: summary.invalidRiskIdRows
    },
    {
      Metric: "Duplicate X-ray ID Rows Removed",
      Value: summary.duplicateRiskIdRows
    },
    {
      Metric: "Rows After Deduplication",
      Value: summary.rowsAfterDeduplication
    },
    {
      Metric: "Rows Removed Due To Invalid Level Results",
      Value: summary.removedInvalidResultRows
    },
    {
      Metric: "Final Prepared Population Rows",
      Value: summary.finalPreparedPopulationRows
    },
    {
      Metric: "CertScan Rows",
      Value: summary.certScanRows
    },
    {
      Metric: "NonCertScan Rows",
      Value: summary.nonCertScanRows
    },
    {
      Metric: "CertScan %",
      Value: summary.certScanPercentage
    },
    {
      Metric: "NonCertScan %",
      Value: summary.nonCertScanPercentage
    },
    {
      Metric: "BI Provided",
      Value: summary.biProvided ? "Yes" : "No"
    },
    {
      Metric: "BI Matched Rows",
      Value: summary.biMatchedRows
    },
    {
      Metric: "BI Unmatched Rows",
      Value: summary.biUnmatchedRows
    },
    {
      Metric: "BI Match %",
      Value: summary.biMatchPercentage
    },
    {
      Metric: "Total BI Filled Fields",
      Value: summary.totalBiFilledFields
    }
  ];
}

function comparisonStatus(riskCount: number, biCount: number): string {
  if (riskCount > 0 && biCount === 0) return "Risk Only";
  if (riskCount === 0 && biCount > 0) return "BI Only";
  return "Matched";
}

function nullableField<T extends object, K extends keyof T>(row: T | null, key: K): T[K] | null {
  return row?.[key] ?? null;
}

function sourceRowNumbers(rows: Array<{ sourceRowNumber: number }>): string {
  return rows.map((row) => row.sourceRowNumber).join(" | ");
}

function sourceSheetNames(rows: Array<{ sourceSheetName: string }>): string {
  return Array.from(new Set(rows.map((row) => row.sourceSheetName))).join(" | ");
}

function riskComparisonFields(row: NormalizedRiskRow | null): Record<string, unknown> {
  return {
    "Risk المستوى": nullableField(row, "stage"),
    "Risk معرف الأشعة": nullableField(row, "xrayImageId"),
    "Risk تاريخ دخول الأشعة": nullableField(row, "xrayEntryDate"),
    "Risk نوع المنفذ": nullableField(row, "portType"),
    "Risk اسم المنفذ": nullableField(row, "portName"),
    "Risk رقم البيان": nullableField(row, "declarationNumber"),
    "Risk تاريخ البيان": nullableField(row, "declarationDate"),
    "Risk رقم اللوحة/الحاوية": nullableField(row, "plateOrContainerNumber"),
    "Risk رقم الهيكل": nullableField(row, "chassisNumber"),
    "Risk نتيجة المستوى الأول للأشعة": nullableField(row, "xrayLevelOneResult"),
    "Risk نتيجة المستوى الثاني للأشعة": nullableField(row, "xrayLevelTwoResult"),
    "Risk نوع الحركة": nullableField(row, "movementType"),
    "Risk رقم المحضر": nullableField(row, "reportNumber"),
    "Risk مستهدف من محرك المخاطر": nullableField(row, "targetedByRiskEngine"),
    "Risk رسالة المخاطر": nullableField(row, "riskMessage")
  };
}

function biComparisonFields(row: NormalizedBiRow | null): Record<string, unknown> {
  return {
    "BI معرف الأشعة": nullableField(row, "xrayImageId"),
    "BI تاريخ دخول الأشعة": nullableField(row, "xrayEntryDate"),
    "BI نوع المنفذ": nullableField(row, "portType"),
    "BI اسم المنفذ": nullableField(row, "portName"),
    "BI رقم البيان": nullableField(row, "declarationNumber"),
    "BI تاريخ البيان": nullableField(row, "declarationDate"),
    "BI رقم اللوحة/الحاوية": nullableField(row, "plateOrContainerNumber"),
    "BI رقم الهيكل": nullableField(row, "chassisNumber"),
    "BI نتيجة المستوى الأول للأشعة": nullableField(row, "levelOneResult"),
    "BI نتيجة المستوى الثاني للأشعة": nullableField(row, "levelTwoResult"),
    "BI Source": nullableField(row, "source")
  };
}

function comparisonRowToExport(
  key: string,
  riskRowsByKey: Map<string, NormalizedRiskRow[]>,
  biRowsByKey: Map<string, NormalizedBiRow[]>
): Record<string, unknown> {
  const riskRows = riskRowsByKey.get(key) ?? [];
  const biRows = biRowsByKey.get(key) ?? [];
  return {
    "Comparison Status": comparisonStatus(riskRows.length, biRows.length),
    "Risk Row Count": riskRows.length,
    "BI Row Count": biRows.length,
    "Risk Source Row Numbers": sourceRowNumbers(riskRows),
    "Risk Source Sheets": sourceSheetNames(riskRows),
    ...riskComparisonFields(riskRows[0] ?? null),
    "BI Source Row Numbers": sourceRowNumbers(biRows),
    "BI Source Sheets": sourceSheetNames(biRows),
    ...biComparisonFields(biRows[0] ?? null)
  };
}

type ComparisonKeySource = {
  xrayImageId: unknown;
  portName: unknown;
};

function buildComparisonLookup<T extends ComparisonKeySource>(
  rows: readonly T[],
): Map<string, T[]> {
  const lookup = new Map<string, T[]>();
  for (const row of rows) {
    const key = makeComparisonKey(row.xrayImageId, row.portName);
    const matches = lookup.get(key) ?? [];
    matches.push(row);
    lookup.set(key, matches);
  }
  return lookup;
}

function riskBiComparisonToExport(
  riskWorkbookResult: RiskWorkbookResult,
  biWorkbookResult: BiWorkbookResult | null
): Record<string, unknown>[] {
  const riskRowsByKey = buildComparisonLookup<NormalizedRiskRow>(
    riskWorkbookResult.rows,
  );
  const biRowsByKey = buildComparisonLookup<NormalizedBiRow>(
    biWorkbookResult?.rows ?? [],
  );
  const allKeys = Array.from(new Set([...riskRowsByKey.keys(), ...biRowsByKey.keys()]));
  return allKeys.map((key) => comparisonRowToExport(key, riskRowsByKey, biRowsByKey));
}


export function exportPopulationProcessingResult(
  result: PopulationProcessingResult,
  riskWorkbookResult: RiskWorkbookResult,
  biWorkbookResult: BiWorkbookResult | null,
  exportColumnsSetting?: ExportColumnSetting[]
): void {
  const workbook = XLSX.utils.book_new();
  const riskRowLookup = buildRiskRowLookup(riskWorkbookResult);

  appendJsonSheet(
    workbook,
    riskRawRowsToExport(riskWorkbookResult),
    "Risk Raw Data"
  );

  appendJsonSheet(workbook, biRawRowsToExport(biWorkbookResult), "BI Raw Data");

  appendJsonSheet(
    workbook,
    preparedRowsToExport(result.preparedRows, exportColumnsSetting),
    "Prepared Population"
  );

  appendJsonSheet(
    workbook,
    removedRiskRowsToFullExport({
      issueGroup: "Duplicate X-ray ID",
      removedRows: result.duplicateRows,
      riskRowLookup
    }),
    "Duplicates"
  );

  appendJsonSheet(
    workbook,
    notUsedOtherIssuesToExport({
      result,
      riskRowLookup
    }),
    "Not Used - Other Issues"
  );

  appendJsonSheet(
    workbook,
    riskBiComparisonToExport(riskWorkbookResult, biWorkbookResult),
    "Risk BI Comparison"
  );

  appendJsonSheet(workbook, summaryToExport(result), "Processing Summary");

  appendJsonSheet(
    workbook,
    biFieldSummaryToExport(result.summary.biFieldFillSummary),
    "BI Fill Summary"
  );

  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .slice(0, 19);

  XLSX.writeFile(workbook, `prepared-population-${timestamp}.xlsx`);
}
