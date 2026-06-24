import * as XLSX from "xlsx";
import { normalizeRiskRow } from "./riskDataNormalizer";
import type {
  NormalizedRiskRow,
  RiskSheetSummary,
  RiskSourceRow,
  RiskWorkbookResult
} from "./riskDataTypes";
import { worksheetToSourceRows } from "../workbook/worksheetRows";

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

function detectMovementType(sheetName: string, customPatterns?: string[]): string | null {
  const normalizedSheetName = normalizeArabicText(sheetName);
  const patterns = customPatterns && customPatterns.length > 0 ? customPatterns : ["بحري", "بري", "افراد", "عبور"];

  for (const pattern of patterns) {
    const normPattern = normalizeArabicText(pattern);
    if (normalizedSheetName.includes(normPattern)) {
      if (normPattern.includes("بحري")) return "بحري";
      if (normPattern.includes("بري")) return "بري";
      if (normPattern.includes("افراد")) return "افراد";
      if (normPattern.includes("عبور")) return "عبور";
      return pattern;
    }
  }
  return null;
}

const yieldToMain = () => new Promise((resolve) => setTimeout(resolve, 0));

export async function processRiskWorkbook(
  file: File,
  onProgress?: (stage: string, percent: number) => void,
  sheetPatterns?: string[],
  columnMappings?: Record<string, string[]>
): Promise<RiskWorkbookResult> {
  onProgress?.("بدء قراءة ملف المخاطر...", 0);
  await yieldToMain();

  const arrayBuffer = await file.arrayBuffer();
  onProgress?.("تحميل البيانات...", 10);
  await yieldToMain();

  const workbook = XLSX.read(arrayBuffer, {
    type: "array",
    cellDates: false,
    cellNF: false,
    cellStyles: false,
    cellHTML: false,
    WTF: false
  });
  onProgress?.("تحليل الأوراق...", 30);
  await yieldToMain();

  const allRows: NormalizedRiskRow[] = [];
  const sheetSummaries: RiskSheetSummary[] = [];
  const unknownSheetNames: string[] = [];

  const totalSheets = workbook.SheetNames.length;
  for (let i = 0; i < totalSheets; i++) {
    const sheetName = workbook.SheetNames[i];
    const movementType = detectMovementType(sheetName, sheetPatterns);

    onProgress?.(`معالجة الورقة "${sheetName}"...`, Math.round(30 + (i / totalSheets) * 60));
    await yieldToMain();

    if (!movementType) {
      unknownSheetNames.push(sheetName);
      continue;
    }

    const worksheet = workbook.Sheets[sheetName];

    if (!worksheet) {
      continue;
    }

    const sourceRows = worksheetToSourceRows<RiskSourceRow>(
      XLSX.utils,
      worksheet
    );
    await yieldToMain();

    const normalizedRows: NormalizedRiskRow[] = [];
    const chunkSize = 5000;
    for (let r = 0; r < sourceRows.length; r += chunkSize) {
      const chunk = sourceRows.slice(r, r + chunkSize);
      const mappedChunk = chunk.map(({ row, sourceRowNumber }) =>
        normalizeRiskRow({
          sourceRow: row,
          movementType,
          sourceSheetName: sheetName,
          sourceRowNumber,
          columnMappings
        })
      );
      normalizedRows.push(...mappedChunk);
      if (sourceRows.length > chunkSize) {
        onProgress?.(
          `معالجة الورقة "${sheetName}": تم تحويل ${Math.min(r + chunkSize, sourceRows.length)} / ${sourceRows.length} صف...`,
          Math.round(30 + ((i + r / sourceRows.length) / totalSheets) * 60)
        );
        await yieldToMain();
      }
    }

    const validRows = normalizedRows.filter(
      (row) => row.xrayImageId !== null && row.xrayImageId.trim() !== ""
    );

    const excludedMissingXrayIdCount =
      normalizedRows.length - validRows.length;

    allRows.push(...validRows);

    sheetSummaries.push({
      sheetName,
      movementType,
      originalRowCount: sourceRows.length,
      normalizedRowCount: validRows.length,
      excludedMissingXrayIdCount
    });
  }

  const totalOriginalRows = sheetSummaries.reduce(
    (total, sheet) => total + sheet.originalRowCount,
    0
  );

  const totalExcludedMissingXrayIdCount = sheetSummaries.reduce(
    (total, sheet) => total + sheet.excludedMissingXrayIdCount,
    0
  );

  onProgress?.("اكتملت معالجة ملف المخاطر", 100);
  await yieldToMain();

  return {
    rows: allRows,
    sheetSummaries,
    unknownSheetNames,
    totalOriginalRows,
    totalNormalizedRows: allRows.length,
    totalExcludedMissingXrayIdCount
  };
}
