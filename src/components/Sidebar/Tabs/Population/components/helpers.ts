import type { RiskWorkbookResult } from "../riskData/riskDataTypes";
import type { BiWorkbookResult } from "../biData/biDataTypes";

// Domain stage helpers live in src/data; imported here for use in UI helpers
// and re-exported so component consumers keep their import paths unchanged.
import {
  getStageKey,
  formatStageLabel,
  createEmptyStageCounts,
} from "../../../../../data/population/stageHelpers";
import type {
  StageCounts,
  StageKey,
  StageAliasMappings,
} from "../../../../../data/population/stageHelpers";

export type { StageCounts, StageKey, StageAliasMappings };
export { getStageKey, formatStageLabel, createEmptyStageCounts };

export type PhaseStatus = "available" | "locked" | "completed" | "active";

export type MiniReportSheet = {
  sheetName: string;
  category: string | null;
  stageCounts: StageCounts | null;
  originalRowCount: number;
  normalizedRowCount: number;
  excludedMissingXrayIdCount: number;
};

export type MiniReportData = {
  title: string;
  description: string;
  status: "processed" | "not-provided";
  totalOriginalRows: number;
  totalNormalizedRows: number;
  totalExcludedMissingXrayIdCount: number;
  unknownSheetNames: string[];
  sheets: MiniReportSheet[];
};

export function formatNumber(value: number): string {
  return value.toLocaleString("ar-SA-u-nu-latn");
}

export function formatPercentage(value: number): string {
  return `${value.toLocaleString("ar-SA-u-nu-latn", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}%`;
}

export function formatFileSize(sizeInBytes: number): string {
  if (sizeInBytes < 1024) {
    return `${sizeInBytes} بايت`;
  }

  const sizeInKilobytes = sizeInBytes / 1024;

  if (sizeInKilobytes < 1024) {
    return `${sizeInKilobytes.toFixed(1)} كيلوبايت`;
  }

  const sizeInMegabytes = sizeInKilobytes / 1024;
  return `${sizeInMegabytes.toFixed(2)} ميجابايت`;
}

export function getPhaseStatus(
  phaseId: number,
  currentPhase: number,
  completedPhaseIds: number[]
): PhaseStatus {
  if (completedPhaseIds.includes(phaseId)) {
    return "completed";
  }

  if (phaseId === currentPhase) {
    return "active";
  }

  if (phaseId < currentPhase) {
    return "available";
  }

  return "locked";
}

export function buildRiskStageCountsBySheet(
  result: RiskWorkbookResult
): Record<string, StageCounts> {
  const countsBySheet: Record<string, StageCounts> = {};

  for (const row of result.rows) {
    const sheetName = row.sourceSheetName;

    if (!countsBySheet[sheetName]) {
      countsBySheet[sheetName] = createEmptyStageCounts();
    }

    const stageKey = getStageKey(row.stage);
    countsBySheet[sheetName][stageKey] += 1;
  }

  return countsBySheet;
}

export function createRiskMiniReport(result: RiskWorkbookResult): MiniReportData {
  const stageCountsBySheet = buildRiskStageCountsBySheet(result);

  return {
    title: "بيانات وكالة المخاطر",
    description: "الملف الأساسي المستخدم لتكوين مجتمع المعالجة.",
    status: "processed",
    totalOriginalRows: result.totalOriginalRows,
    totalNormalizedRows: result.totalNormalizedRows,
    totalExcludedMissingXrayIdCount: result.totalExcludedMissingXrayIdCount,
    unknownSheetNames: result.unknownSheetNames,
    sheets: result.sheetSummaries.map((sheet) => ({
      sheetName: sheet.sheetName,
      category: null,
      stageCounts:
        stageCountsBySheet[sheet.sheetName] ?? createEmptyStageCounts(),
      originalRowCount: sheet.originalRowCount,
      normalizedRowCount: sheet.normalizedRowCount,
      excludedMissingXrayIdCount: sheet.excludedMissingXrayIdCount
    }))
  };
}

export function createBiMiniReport(result: BiWorkbookResult | null): MiniReportData {
  if (!result) {
    return {
      title: "بيانات ذكاء الأعمال",
      description: "ملف داعم لم يتم رفعه أو لم تتم قراءته في هذه المرحلة.",
      status: "not-provided",
      totalOriginalRows: 0,
      totalNormalizedRows: 0,
      totalExcludedMissingXrayIdCount: 0,
      unknownSheetNames: [],
      sheets: []
    };
  }

  return {
    title: "بيانات ذكاء الأعمال",
    description: "ملف داعم سيتم استخدامه لاحقاً في تعبئة الخانات الفارغة.",
    status: "processed",
    totalOriginalRows: result.totalOriginalRows,
    totalNormalizedRows: result.totalNormalizedRows,
    totalExcludedMissingXrayIdCount: result.totalExcludedMissingXrayIdCount,
    unknownSheetNames: result.unknownSheetNames,
    sheets: result.sheetSummaries.map((sheet) => ({
      sheetName: sheet.sheetName,
      category: null,
      stageCounts: null,
      originalRowCount: sheet.originalRowCount,
      normalizedRowCount: sheet.normalizedRowCount,
      excludedMissingXrayIdCount: sheet.excludedMissingXrayIdCount
    }))
  };
}
