import * as XLSX from "xlsx";
import { normalizeBiRow } from "./biDataNormalizer";
import type {
  BiSheetSummary,
  BiSourceRow,
  BiWorkbookResult,
  NormalizedBiRow
} from "./biDataTypes";
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

function detectBiSource(sheetName: string, customPatterns?: string[]): string | null {
  const normalizedSheetName = normalizeArabicText(sheetName);
  const patterns = customPatterns && customPatterns.length > 0 ? customPatterns : ["وارد", "صادر"];

  const isSea = normalizedSheetName.includes("بحري");
  const isLand = normalizedSheetName.includes("بري");

  for (const pattern of patterns) {
    const normPattern = normalizeArabicText(pattern);
    if (normalizedSheetName.includes(normPattern)) {
      const isInbound = normPattern.includes("وارد");
      const isOutbound = normPattern.includes("صادر");
      
      if (isSea && isInbound) return "بحري وارد";
      if (isLand && isInbound) return "بري وارد";
      if (isSea && isOutbound) return "بحري صادر";
      if (isLand && isOutbound) return "بري صادر";
      return pattern;
    }
  }

  return null;
}

const yieldToMain = () => new Promise((resolve) => setTimeout(resolve, 0));

export async function processBiWorkbook(
  file: File,
  onProgress?: (stage: string, percent: number) => void,
  sheetPatterns?: string[],
  columnMappings?: Record<string, string[]>
): Promise<BiWorkbookResult> {
  onProgress?.("بدء قراءة ملف ذكاء الأعمال...", 0);
  await yieldToMain();

  const arrayBuffer = await file.arrayBuffer();
  onProgress?.("تحميل بيانات ذكاء الأعمال...", 10);
  await yieldToMain();

  const workbook = XLSX.read(arrayBuffer, {
    type: "array",
    cellDates: false
  });
  onProgress?.("تحليل أوراق ذكاء الأعمال...", 30);
  await yieldToMain();

  const allRows: NormalizedBiRow[] = [];
  const sheetSummaries: BiSheetSummary[] = [];
  const unknownSheetNames: string[] = [];

  const totalSheets = workbook.SheetNames.length;
  for (let i = 0; i < totalSheets; i++) {
    const sheetName = workbook.SheetNames[i];
    const source = detectBiSource(sheetName, sheetPatterns);

    onProgress?.(`معالجة ورقة ذكاء الأعمال "${sheetName}"...`, Math.round(30 + (i / totalSheets) * 60));
    await yieldToMain();

    if (!source) {
      unknownSheetNames.push(sheetName);
      continue;
    }

    const worksheet = workbook.Sheets[sheetName];

    if (!worksheet) {
      continue;
    }

    const sourceRows = worksheetToSourceRows<BiSourceRow>(
      XLSX.utils,
      worksheet
    );
    await yieldToMain();

    const normalizedRows: NormalizedBiRow[] = [];
    const chunkSize = 2000;
    for (let r = 0; r < sourceRows.length; r += chunkSize) {
      const chunk = sourceRows.slice(r, r + chunkSize);
      const mappedChunk = chunk.map(({ row, sourceRowNumber }) =>
        normalizeBiRow({
          sourceRow: row,
          source,
          sourceSheetName: sheetName,
          sourceRowNumber,
          columnMappings
        })
      );
      normalizedRows.push(...mappedChunk);
      if (sourceRows.length > chunkSize) {
        onProgress?.(
          `معالجة ورقة ذكاء الأعمال "${sheetName}": تم تحويل ${Math.min(r + chunkSize, sourceRows.length)} / ${sourceRows.length} صف...`,
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
      source,
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

  onProgress?.("اكتملت معالجة ملف ذكاء الأعمال", 100);
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
