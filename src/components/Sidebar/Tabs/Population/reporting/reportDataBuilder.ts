import type { BiWorkbookResult } from "../biData/biDataTypes";
import { getStageKey as getNormalizedStageKey } from "../components/helpers";
import { makeBiMatchKey } from "../processing/populationProcessor";
import type { PopulationProcessingResult } from "../processing/populationProcessingTypes";
import type { RiskWorkbookResult } from "../riskData/riskDataTypes";
import { createEmptyStageCounts } from "../../../../../data/population/stageHelpers";
import type {
  BiFillReportRow,
  BiRiskComparisonReport,
  BuildPopulationReportInput,
  PopulationReportData,
  PopulationReportStatus,
  ProcessingReport,
  RiskStageDistributionRow,
  WorkbookReceiptReport
} from "./reportTypes";

type StageCounts = {
  first: number;
  second: number;
  third: number;
  fourth: number;
  unknown: number;
};

type UnknownRecord = Record<string, unknown>;

type ComparisonFieldDefinition = {
  fieldName: string;
  riskKeys: string[];
  biKeys: string[];
};

const COMPARISON_FIELDS: ComparisonFieldDefinition[] = [
  {
    fieldName: "تاريخ دخول الأشعة",
    riskKeys: ["xrayEntryDate", "xrayScanDate", "scanDate"],
    biKeys: ["xrayEntryDate", "xrayScanDate", "scanDate"]
  },
  {
    fieldName: "نوع المنفذ",
    riskKeys: ["portType"],
    biKeys: ["portType"]
  },
  {
    fieldName: "رقم البيان",
    riskKeys: ["declarationNumber", "customsDeclarationNumber"],
    biKeys: ["declarationNumber", "customsDeclarationNumber"]
  },
  {
    fieldName: "تاريخ البيان",
    riskKeys: ["declarationDate", "customsDeclarationDate"],
    biKeys: ["declarationDate", "customsDeclarationDate"]
  },
  {
    fieldName: "رقم اللوحة/الحاوية",
    riskKeys: ["plateOrContainerNumber", "containerNumber", "plateNumber"],
    biKeys: ["plateOrContainerNumber", "containerNumber", "plateNumber"]
  },
  {
    fieldName: "رقم الهيكل",
    riskKeys: ["chassisNumber"],
    biKeys: ["chassisNumber"]
  },
  {
    fieldName: "نتيجة المستوى الأول للأشعة",
    riskKeys: ["xrayLevelOneResult", "levelOneResult"],
    biKeys: ["xrayLevelOneResult", "levelOneResult"]
  },
  {
    fieldName: "نتيجة المستوى الثاني للأشعة",
    riskKeys: ["xrayLevelTwoResult", "levelTwoResult"],
    biKeys: ["xrayLevelTwoResult", "levelTwoResult"]
  }
];

function formatReportDate(date: Date): string {
  return new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric"
  }).format(date);
}

function formatReportTime(date: Date): string {
  return new Intl.DateTimeFormat("ar-SA-u-nu-latn", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatReportMonth(date: Date): string {
  return new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", {
    month: "long",
    year: "numeric"
  }).format(date);
}

function getStageKey(stage: string | null): keyof StageCounts {
  return getNormalizedStageKey(stage);
}

function getPhaseLabel(scope: BuildPopulationReportInput["scope"]): string {
  if (scope === "phase-2") {
    return "تقرير حتى مرحلة البيانات والمعالجة";
  }

  if (scope === "phase-3") {
    return "تقرير حتى مرحلة اختيار العينة";
  }

  return "التقرير الكامل حتى مرحلة توزيع العينة";
}

function normalizeText(value: unknown): string {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function asRecord(value: unknown): UnknownRecord {
  return Object(value) as UnknownRecord;
}

function getFieldValue(row: unknown, keys: string[]): unknown {
  const record = asRecord(row);

  for (const key of keys) {
    const value = record[key];

    if (normalizeText(value) !== "") {
      return value;
    }
  }

  return "";
}

function getStringFieldValue(row: unknown, keys: string[]): string {
  return normalizeText(getFieldValue(row, keys));
}

function makeComparisonKey(row: unknown): string {
  // Match on the same normalized xrayImageId+portName key the population
  // processor and DataAccuracyReport use (makeBiMatchKey) — a bare
  // xrayImageId collapses distinct rows that happen to share an ID across
  // different ports into a single comparison entry, silently under-counting
  // matches. The xrayScanId/xrayImageID probes were stale: normalized risk
  // and BI rows only ever carry `xrayImageId`.
  const xrayImageId = getStringFieldValue(row, ["xrayImageId"]);

  if (!xrayImageId) {
    return "";
  }

  const portName = getStringFieldValue(row, ["portName"]);

  return makeBiMatchKey(xrayImageId, portName);
}

function valuesMatch(firstValue: unknown, secondValue: unknown): boolean {
  return normalizeText(firstValue) === normalizeText(secondValue);
}

function calculatePercentage(numerator: number, denominator: number): number {
  if (denominator === 0) {
    return 0;
  }

  return (numerator / denominator) * 100;
}

function createEmptyBiRiskComparisonReport(): BiRiskComparisonReport {
  return {
    totalMatchedRecords: 0,
    matchedWithoutDifferences: 0,
    matchedWithDifferences: 0,
    overallMatchPercentage: 0,
    fieldComparisons: COMPARISON_FIELDS.map((field) => ({
      fieldName: field.fieldName,
      matchedCount: 0,
      differentCount: 0,
      totalComparedCount: 0,
      matchPercentage: 0
    })),
    sampleDifferentRows: []
  };
}

function buildRiskReceiptReport(
  riskWorkbookResult: RiskWorkbookResult | null
): WorkbookReceiptReport | null {
  if (!riskWorkbookResult) {
    return null;
  }

  return {
    title: "بيانات وكالة تحليل المخاطر",
    provided: true,
    totalOriginalRows: riskWorkbookResult.totalOriginalRows,
    totalNormalizedRows: riskWorkbookResult.totalNormalizedRows,
    totalExcludedRows: riskWorkbookResult.totalExcludedMissingXrayIdCount,
    sheetCount: riskWorkbookResult.sheetSummaries.length,
    unknownSheetNames: riskWorkbookResult.unknownSheetNames,
    sheets: riskWorkbookResult.sheetSummaries.map((sheet) => ({
      sheetName: sheet.sheetName,
      originalRowCount: sheet.originalRowCount,
      normalizedRowCount: sheet.normalizedRowCount,
      excludedMissingXrayIdCount: sheet.excludedMissingXrayIdCount
    }))
  };
}

function buildBiReceiptReport(
  biWorkbookResult: BiWorkbookResult | null
): WorkbookReceiptReport {
  if (!biWorkbookResult) {
    return {
      title: "بيانات ذكاء الأعمال",
      provided: false,
      totalOriginalRows: 0,
      totalNormalizedRows: 0,
      totalExcludedRows: 0,
      sheetCount: 0,
      unknownSheetNames: [],
      sheets: []
    };
  }

  return {
    title: "بيانات ذكاء الأعمال",
    provided: true,
    totalOriginalRows: biWorkbookResult.totalOriginalRows,
    totalNormalizedRows: biWorkbookResult.totalNormalizedRows,
    totalExcludedRows: biWorkbookResult.totalExcludedMissingXrayIdCount,
    sheetCount: biWorkbookResult.sheetSummaries.length,
    unknownSheetNames: biWorkbookResult.unknownSheetNames,
    sheets: biWorkbookResult.sheetSummaries.map((sheet) => ({
      sheetName: sheet.sheetName,
      originalRowCount: sheet.originalRowCount,
      normalizedRowCount: sheet.normalizedRowCount,
      excludedMissingXrayIdCount: sheet.excludedMissingXrayIdCount
    }))
  };
}

function buildRiskStageDistribution(
  riskWorkbookResult: RiskWorkbookResult | null
): {
  rows: RiskStageDistributionRow[];
  totals: RiskStageDistributionRow | null;
} {
  if (!riskWorkbookResult) {
    return {
      rows: [],
      totals: null
    };
  }

  const countsBySheet: Record<string, StageCounts> = {};

  for (const row of riskWorkbookResult.rows) {
    const sheetName = row.sourceSheetName;

    if (!countsBySheet[sheetName]) {
      countsBySheet[sheetName] = createEmptyStageCounts();
    }

    const stageKey = getStageKey(row.stage);
    countsBySheet[sheetName][stageKey] += 1;
  }

  const rows: RiskStageDistributionRow[] = riskWorkbookResult.sheetSummaries.map(
    (sheet) => {
      const counts = countsBySheet[sheet.sheetName] ?? createEmptyStageCounts();

      return {
        sheetName: sheet.sheetName,
        first: counts.first,
        second: counts.second,
        third: counts.third,
        fourth: counts.fourth,
        unknown: counts.unknown,
        totalAccepted: sheet.normalizedRowCount
      };
    }
  );

  const totals = rows.reduce<RiskStageDistributionRow>(
    (currentTotals, row) => ({
      sheetName: "المجموع",
      first: currentTotals.first + row.first,
      second: currentTotals.second + row.second,
      third: currentTotals.third + row.third,
      fourth: currentTotals.fourth + row.fourth,
      unknown: currentTotals.unknown + row.unknown,
      totalAccepted: currentTotals.totalAccepted + row.totalAccepted
    }),
    {
      sheetName: "المجموع",
      first: 0,
      second: 0,
      third: 0,
      fourth: 0,
      unknown: 0,
      totalAccepted: 0
    }
  );

  return {
    rows,
    totals
  };
}

function buildProcessingReport(
  populationProcessingResult: PopulationProcessingResult | null
): ProcessingReport | null {
  if (!populationProcessingResult) {
    return null;
  }

  const summary = populationProcessingResult.summary;

  const reconciliationExpectedFinalRows =
    summary.validRiskIdRows -
    summary.duplicateRiskIdRows -
    summary.removedInvalidResultRows;

  return {
    riskOriginalRows: summary.riskOriginalRows,
    validRiskIdRows: summary.validRiskIdRows,
    invalidRiskIdRows: summary.invalidRiskIdRows,

    duplicateRiskIdRows: summary.duplicateRiskIdRows,
    rowsAfterDeduplication: summary.rowsAfterDeduplication,

    removedInvalidResultRows: summary.removedInvalidResultRows,
    finalPreparedPopulationRows: summary.finalPreparedPopulationRows,

    certScanRows: summary.certScanRows,
    nonCertScanRows: summary.nonCertScanRows,
    certScanPercentage: summary.certScanPercentage,
    nonCertScanPercentage: summary.nonCertScanPercentage,

    biProvided: summary.biProvided,
    biMatchedRows: summary.biMatchedRows,
    biUnmatchedRows: summary.biUnmatchedRows,
    biMatchPercentage: summary.biMatchPercentage,
    totalBiFilledFields: summary.totalBiFilledFields,

    reconciliationExpectedFinalRows,
    reconciliationDifference:
      summary.finalPreparedPopulationRows - reconciliationExpectedFinalRows
  };
}

function buildBiFillSummary(
  populationProcessingResult: PopulationProcessingResult | null
): BiFillReportRow[] {
  return (
    populationProcessingResult?.summary.biFieldFillSummary.map((row) => ({
      fieldName: row.fieldName,
      riskEmptyBefore: row.riskEmptyBefore,
      filledFromBi: row.filledFromBi,
      stillEmptyAfter: row.stillEmptyAfter,
      fillPercentage: row.fillPercentage
    })) ?? []
  );
}

function buildBiRiskComparisonReport(
  input: BuildPopulationReportInput
): BiRiskComparisonReport {
  const riskRows = input.riskWorkbookResult?.rows ?? [];
  const biRows = input.biWorkbookResult?.rows ?? [];

  if (riskRows.length === 0 || biRows.length === 0) {
    return createEmptyBiRiskComparisonReport();
  }

  const riskRowsByKey = new Map<string, unknown>();
  const biRowsByKey = new Map<string, unknown>();

  for (const row of riskRows) {
    const key = makeComparisonKey(row);

    if (key && !riskRowsByKey.has(key)) {
      riskRowsByKey.set(key, row);
    }
  }

  for (const row of biRows) {
    const key = makeComparisonKey(row);

    if (key && !biRowsByKey.has(key)) {
      biRowsByKey.set(key, row);
    }
  }

  const matchedKeys = Array.from(riskRowsByKey.keys()).filter((key) =>
    biRowsByKey.has(key)
  );

  if (matchedKeys.length === 0) {
    return createEmptyBiRiskComparisonReport();
  }

  const fieldCounters = COMPARISON_FIELDS.map((field) => ({
    fieldName: field.fieldName,
    matchedCount: 0,
    differentCount: 0,
    totalComparedCount: 0
  }));

  const sampleDifferentRows: BiRiskComparisonReport["sampleDifferentRows"] = [];

  let matchedWithoutDifferences = 0;
  let matchedWithDifferences = 0;

  for (const key of matchedKeys) {
    const riskRow = riskRowsByKey.get(key);
    const biRow = biRowsByKey.get(key);

    const differentFields: string[] = [];

    COMPARISON_FIELDS.forEach((field, index) => {
      const riskValue = getFieldValue(riskRow, field.riskKeys);
      const biValue = getFieldValue(biRow, field.biKeys);

      fieldCounters[index].totalComparedCount += 1;

      if (valuesMatch(riskValue, biValue)) {
        fieldCounters[index].matchedCount += 1;
      } else {
        fieldCounters[index].differentCount += 1;
        differentFields.push(field.fieldName);
      }
    });

    if (differentFields.length === 0) {
      matchedWithoutDifferences += 1;
    } else {
      matchedWithDifferences += 1;

      if (sampleDifferentRows.length < 10) {
        sampleDifferentRows.push({
          xrayImageId: getStringFieldValue(riskRow, ["xrayImageId"]),
          portName: getStringFieldValue(riskRow, ["portName"]),
          differentFields
        });
      }
    }
  }

  return {
    totalMatchedRecords: matchedKeys.length,
    matchedWithoutDifferences,
    matchedWithDifferences,
    overallMatchPercentage: calculatePercentage(
      matchedWithoutDifferences,
      matchedKeys.length
    ),
    fieldComparisons: fieldCounters.map((field) => ({
      fieldName: field.fieldName,
      matchedCount: field.matchedCount,
      differentCount: field.differentCount,
      totalComparedCount: field.totalComparedCount,
      matchPercentage: calculatePercentage(
        field.matchedCount,
        field.totalComparedCount
      )
    })),
    sampleDifferentRows
  };
}

function getReportStatus(params: {
  hasRiskData: boolean;
  hasProcessingData: boolean;
  finalPreparedPopulationRows: number;
  duplicateRiskIdRows: number;
  invalidRiskIdRows: number;
  removedInvalidResultRows: number;
  reconciliationDifference: number;
}): {
  status: PopulationReportStatus;
  statusLabel: string;
  statusMessage: string;
} {
  if (!params.hasRiskData) {
    return {
      status: "not-ready",
      statusLabel: "غير جاهز",
      statusMessage:
        "لا توجد بيانات وكالة تحليل مخاطر مقروءة لإنشاء تقرير قابل للاعتماد."
    };
  }

  if (!params.hasProcessingData) {
    return {
      status: "receipt-only",
      statusLabel: "تقرير استلام فقط",
      statusMessage:
        "تم إنشاء التقرير بناءً على البيانات المستلمة فقط، ولم يتم تنفيذ معالجة المجتمع بعد."
    };
  }

  if (params.finalPreparedPopulationRows === 0) {
    return {
      status: "not-ready",
      statusLabel: "غير جاهز لاختيار العينة",
      statusMessage:
        "تم تنفيذ المعالجة، ولكن لم ينتج مجتمع نهائي صالح للانتقال إلى اختيار العينة."
    };
  }

  if (params.reconciliationDifference !== 0) {
    return {
      status: "not-ready",
      statusLabel: "يتطلب مراجعة",
      statusMessage:
        "توجد فروقات في تسوية أعداد المعالجة، ويجب مراجعتها قبل الانتقال إلى اختيار العينة."
    };
  }

  if (
    params.duplicateRiskIdRows > 0 ||
    params.invalidRiskIdRows > 0 ||
    params.removedInvalidResultRows > 0
  ) {
    return {
      status: "usable-with-notes",
      statusLabel: "جاهز مع ملاحظات",
      statusMessage:
        "المجتمع النهائي جاهز للانتقال إلى اختيار العينة، مع وجود استبعادات أو مكررات موثقة في مخرجات المعالجة."
    };
  }

  return {
    status: "ready-for-next-phase",
    statusLabel: "جاهز للمرحلة التالية",
    statusMessage:
      "المجتمع النهائي جاهز للانتقال إلى مرحلة اختيار العينة دون ملاحظات جوهرية ظاهرة."
  };
}

export function buildPopulationReportData(
  input: BuildPopulationReportInput
): PopulationReportData {
  const now = new Date();

  const riskReceipt = buildRiskReceiptReport(input.riskWorkbookResult);
  const biReceipt = buildBiReceiptReport(input.biWorkbookResult);

  const riskStageDistribution = buildRiskStageDistribution(
    input.riskWorkbookResult
  );

  const processing = buildProcessingReport(input.populationProcessingResult);
  const biFillSummary = buildBiFillSummary(input.populationProcessingResult);
  const biRiskComparison = buildBiRiskComparisonReport(input);

  const hasRiskData = Boolean(input.riskWorkbookResult);
  const hasBiData = Boolean(input.biWorkbookResult);
  const hasProcessingData = Boolean(input.populationProcessingResult);

  const status = getReportStatus({
    hasRiskData,
    hasProcessingData,
    finalPreparedPopulationRows: processing?.finalPreparedPopulationRows ?? 0,
    duplicateRiskIdRows: processing?.duplicateRiskIdRows ?? 0,
    invalidRiskIdRows: processing?.invalidRiskIdRows ?? 0,
    removedInvalidResultRows: processing?.removedInvalidResultRows ?? 0,
    reconciliationDifference: processing?.reconciliationDifference ?? 0
  });

  return {
    title: "تقرير معالجة المجتمع",
    scope: input.scope,

    generatedDate: formatReportDate(now),
    generatedTime: formatReportTime(now),
    generatedMonth: formatReportMonth(now),

    phaseLabel: getPhaseLabel(input.scope),

    status: status.status,
    statusLabel: status.statusLabel,
    statusMessage: status.statusMessage,

    riskReceipt,
    biReceipt,

    riskStageDistribution: riskStageDistribution.rows,
    riskStageDistributionTotals: riskStageDistribution.totals,

    processing,
    biFillSummary,
    biRiskComparison,

    hasRiskData,
    hasBiData,
    hasProcessingData
  };
}
