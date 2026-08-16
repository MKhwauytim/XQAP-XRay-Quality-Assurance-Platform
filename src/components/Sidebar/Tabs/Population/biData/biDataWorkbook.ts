import * as XLSX from "xlsx";
import { yieldToMain } from "../../../../../data/storage/yieldToMain";
import { normalizeBiRow } from "./biDataNormalizer";
import { BI_COLUMN_ALIASES } from "./biDataColumns";
import type {
  BiSheetSummary,
  BiSourceRow,
  BiWorkbookResult,
  NormalizedBiRow,
  ZeroXrayIdDiagnostic
} from "./biDataTypes";
import { worksheetToSourceRows } from "../workbook/worksheetRows";

// Same diacritic/zero-width character class stripped in biDataNormalizer.ts's
// header lookup — kept identical here so a sheet-name match (not just a
// column-header match) is equally immune to copy-paste noise. Written with
// explicit \u escapes (not literal invisible characters) so the
// no-irregular-whitespace lint rule doesn't flag the source file itself.
const DIACRITIC_AND_ZERO_WIDTH_RANGES = [
  [0x064b, 0x065f], // Arabic diacritics (تشكيل)
  [0x200b, 0x200f], // ZWSP, ZWNJ, ZWJ, LRM, RLM
  [0xfeff, 0xfeff]  // BOM / zero-width no-break space
] as const;

const DIACRITIC_AND_ZERO_WIDTH_PATTERN = new RegExp(
  "[" +
    DIACRITIC_AND_ZERO_WIDTH_RANGES.map(
      ([start, end]) =>
        `\\u${start.toString(16).padStart(4, "0")}-\\u${end.toString(16).padStart(4, "0")}`
    ).join("") +
  "]",
  "g"
);

function normalizeArabicText(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[ـ]/g, "")
    .replace(DIACRITIC_AND_ZERO_WIDTH_PATTERN, "")
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

  // No pattern matched — process the sheet anyway using its own name as the source.
  // This handles files where sheet names don't follow the standard naming convention.
  return sheetName;
}

/**
 * B14: guard against the "silent 0" failure mode — a sheet that parsed rows
 * but accepted none of them because every candidate xrayImageId header the
 * alias list looked for is absent from what the sheet actually has (a stale
 * saved mapping, or header noise the normalizer doesn't strip). Only called
 * when normalizedRowCount is 0 with originalRowCount > 0, so it's a rare
 * diagnostic path, not per-row overhead.
 */
function buildZeroXrayIdDiagnostic(
  sourceRows: { row: BiSourceRow }[],
  columnMappings?: Record<string, string[]>
): ZeroXrayIdDiagnostic {
  const candidateHeaders =
    columnMappings?.xrayImageId ?? BI_COLUMN_ALIASES.xrayImageId;

  const presentHeaders = new Set<string>();
  for (const { row } of sourceRows.slice(0, 50)) {
    for (const header of Object.keys(row)) {
      presentHeaders.add(header);
    }
  }

  return {
    candidateHeaders: [...candidateHeaders],
    presentHeaders: Array.from(presentHeaders)
  };
}


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
    cellDates: false,
    cellNF: false,
    cellStyles: false,
    cellHTML: false,
    WTF: false
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
    // Free raw worksheet cells — GC can collect them now that we have row arrays.
    delete workbook.Sheets[sheetName];
    await yieldToMain();

    const normalizedRows: NormalizedBiRow[] = [];
    const chunkSize = 10000;
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
      // Use a loop instead of push(...mappedChunk) to avoid call-stack overflow
      // when mappedChunk is very large (> ~65k items hits V8's argument limit).
      for (const row of mappedChunk) normalizedRows.push(row);
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

    for (const row of validRows) allRows.push(row);

    sheetSummaries.push({
      sheetName,
      source,
      originalRowCount: sourceRows.length,
      normalizedRowCount: validRows.length,
      excludedMissingXrayIdCount,
      ...(validRows.length === 0 && sourceRows.length > 0
        ? { zeroIdDiagnostic: buildZeroXrayIdDiagnostic(sourceRows, columnMappings) }
        : {})
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
