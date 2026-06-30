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
  if (!columnsSetting || columnsSetting.length === 0) {
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
      "نتيجة المعاين": row.otherResults.manual.result,
      "رمز نتيجة المعاين": row.otherResults.manual.code,
      "نتيجة المفتش المعاكس": row.otherResults.opposite.result,
      "رمز نتيجة المفتش المعاكس": row.otherResults.opposite.code,
      "موظف التفتيش المعاكس": row.otherResults.opposite.employeeId,
      "نتيجة الوسائل الحية": row.otherResults.liveMeans.result,
      "رمز نتيجة الوسائل الحية": row.otherResults.liveMeans.code,
      "موظف الوسائل الحية": row.otherResults.liveMeans.employeeId,
      "ملاحظة المستويات": row.notes,
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

    const extras = getUnmappedRawFields(row.rawRow, RISK_COLUMN_ALIASES);
    return { ...base, ...extras };
  }

  const resultObj: Record<string, unknown> = {};
  const sortedSetting = columnsSetting
    .filter((c) => c.isEnabled)
    .sort((a, b) => a.order - b.order);

  for (const col of sortedSetting) {
    const key = col.fieldKey;
    const header = col.exportHeader;
    if (key in row) {
      resultObj[header] = (row as Record<string, unknown>)[key];
    } else if (row.rawRow && key in row.rawRow) {
      resultObj[header] = row.rawRow[key];
    } else {
      resultObj[header] = null;
    }
  }

  const enabledKeys = new Set(columnsSetting.map((c) => c.fieldKey));
  if (row.rawRow) {
    for (const [key, value] of Object.entries(row.rawRow)) {
      if (!enabledKeys.has(key)) {
        resultObj[key] = value;
      }
    }
  }

  return resultObj;
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

function riskBiComparisonToExport(
  riskWorkbookResult: RiskWorkbookResult,
  biWorkbookResult: BiWorkbookResult | null
): Record<string, unknown>[] {
  const riskRowsByKey = new Map<string, NormalizedRiskRow[]>();
  const biRowsByKey = new Map<string, NormalizedBiRow[]>();

  for (const row of riskWorkbookResult.rows) {
    const key = makeComparisonKey(row.xrayImageId, row.portName);
    const rows = riskRowsByKey.get(key) ?? [];

    rows.push(row);
    riskRowsByKey.set(key, rows);
  }

  for (const row of biWorkbookResult?.rows ?? []) {
    const key = makeComparisonKey(row.xrayImageId, row.portName);
    const rows = biRowsByKey.get(key) ?? [];

    rows.push(row);
    biRowsByKey.set(key, rows);
  }

  const allKeys = Array.from(
    new Set([...riskRowsByKey.keys(), ...biRowsByKey.keys()])
  );

  return allKeys.map((key) => {
    const riskRows = riskRowsByKey.get(key) ?? [];
    const biRows = biRowsByKey.get(key) ?? [];

    const firstRiskRow = riskRows[0] ?? null;
    const firstBiRow = biRows[0] ?? null;

    let comparisonStatus = "Matched";

    if (riskRows.length > 0 && biRows.length === 0) {
      comparisonStatus = "Risk Only";
    }

    if (riskRows.length === 0 && biRows.length > 0) {
      comparisonStatus = "BI Only";
    }

    return {
      "Comparison Status": comparisonStatus,
      "Risk Row Count": riskRows.length,
      "BI Row Count": biRows.length,

      "Risk Source Row Numbers": riskRows
        .map((row) => row.sourceRowNumber)
        .join(" | "),
      "Risk Source Sheets": Array.from(
        new Set(riskRows.map((row) => row.sourceSheetName))
      ).join(" | "),

      "Risk المستوى": firstRiskRow?.stage ?? null,
      "Risk معرف الأشعة": firstRiskRow?.xrayImageId ?? null,
      "Risk تاريخ دخول الأشعة": firstRiskRow?.xrayEntryDate ?? null,
      "Risk نوع المنفذ": firstRiskRow?.portType ?? null,
      "Risk اسم المنفذ": firstRiskRow?.portName ?? null,
      "Risk رقم البيان": firstRiskRow?.declarationNumber ?? null,
      "Risk تاريخ البيان": firstRiskRow?.declarationDate ?? null,
      "Risk رقم اللوحة/الحاوية": firstRiskRow?.plateOrContainerNumber ?? null,
      "Risk رقم الهيكل": firstRiskRow?.chassisNumber ?? null,
      "Risk نتيجة المستوى الأول للأشعة":
        firstRiskRow?.xrayLevelOneResult ?? null,
      "Risk نتيجة المستوى الثاني للأشعة":
        firstRiskRow?.xrayLevelTwoResult ?? null,
      "Risk نوع الحركة": firstRiskRow?.movementType ?? null,
      "Risk رقم المحضر": firstRiskRow?.reportNumber ?? null,
      "Risk مستهدف من محرك المخاطر": firstRiskRow?.targetedByRiskEngine ?? null,
      "Risk رسالة المخاطر": firstRiskRow?.riskMessage ?? null,

      "BI Source Row Numbers": biRows
        .map((row) => row.sourceRowNumber)
        .join(" | "),
      "BI Source Sheets": Array.from(
        new Set(biRows.map((row) => row.sourceSheetName))
      ).join(" | "),

      "BI معرف الأشعة": firstBiRow?.xrayImageId ?? null,
      "BI تاريخ دخول الأشعة": firstBiRow?.xrayEntryDate ?? null,
      "BI نوع المنفذ": firstBiRow?.portType ?? null,
      "BI اسم المنفذ": firstBiRow?.portName ?? null,
      "BI رقم البيان": firstBiRow?.declarationNumber ?? null,
      "BI تاريخ البيان": firstBiRow?.declarationDate ?? null,
      "BI رقم اللوحة/الحاوية": firstBiRow?.plateOrContainerNumber ?? null,
      "BI رقم الهيكل": firstBiRow?.chassisNumber ?? null,
      "BI نتيجة المستوى الأول للأشعة": firstBiRow?.levelOneResult ?? null,
      "BI نتيجة المستوى الثاني للأشعة": firstBiRow?.levelTwoResult ?? null,
      "BI Source": firstBiRow?.source ?? null
    };
  });
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