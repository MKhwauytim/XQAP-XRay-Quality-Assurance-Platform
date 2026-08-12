import * as XLSX from "xlsx";
import { normalizeRiskRow } from "./riskDataNormalizer";
import { RISK_COLUMN_ALIASES } from "./riskDataColumns";
import type {
  NormalizedRiskRow,
  RiskSheetSummary,
  RiskSourceRow,
  RiskWorkbookResult,
  ZeroXrayIdDiagnostic
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

  // Process every worksheet even when its name is not configured. Using the
  // sheet name as the movement type keeps the rows auditable and avoids forcing
  // users to maintain an exhaustive sheet-name allowlist.
  return sheetName;
}

/**
 * B14: guard against the "silent 0" failure mode — a sheet that parsed rows
 * but accepted none of them because every candidate xrayImageId header the
 * alias list looked for is absent from what the sheet actually has (a stale
 * saved mapping, or header noise the normalizer doesn't strip). Only called
 * when normalizedRowCount is 0 with originalRowCount > 0, so it's a rare
 * diagnostic path, not per-row overhead. Mirrors biDataWorkbook.ts's copy.
 */
function buildZeroXrayIdDiagnostic(
  sourceRows: { row: RiskSourceRow }[],
  columnMappings?: Record<string, string[]>
): ZeroXrayIdDiagnostic {
  const candidateHeaders =
    columnMappings?.xrayImageId ?? RISK_COLUMN_ALIASES.xrayImageId;

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
    // Free raw worksheet cells so GC can collect them while we normalize.
    delete workbook.Sheets[sheetName];
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
      for (const row of mappedChunk) normalizedRows.push(row);
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

    for (const row of validRows) allRows.push(row);

    sheetSummaries.push({
      sheetName,
      movementType,
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
