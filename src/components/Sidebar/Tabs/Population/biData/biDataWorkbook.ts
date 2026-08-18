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

/**
 * Resolve a sheet name to a BI source.
 *
 * `matched` reports whether the name actually hit one of the configured
 * patterns, as opposed to falling through to the permissive "use the sheet's
 * own name" branch. Callers that can afford that fallback (a multi-sheet
 * .xlsx — unchanged behaviour) ignore it; the CSV path uses it to raise an
 * explicit error instead of importing zero rows silently, because a CSV's
 * single derived name IS the whole classification: if it matches nothing,
 * nothing about the file is classifiable.
 */
function detectBiSourceInfo(
  sheetName: string,
  customPatterns?: string[]
): { source: string | null; matched: boolean } {
  const normalizedSheetName = normalizeArabicText(sheetName);
  const patterns = customPatterns && customPatterns.length > 0 ? customPatterns : ["وارد", "صادر"];

  const isSea = normalizedSheetName.includes("بحري");
  const isLand = normalizedSheetName.includes("بري");

  for (const pattern of patterns) {
    const normPattern = normalizeArabicText(pattern);
    if (normalizedSheetName.includes(normPattern)) {
      const isInbound = normPattern.includes("وارد");
      const isOutbound = normPattern.includes("صادر");

      if (isSea && isInbound) return { source: "بحري وارد", matched: true };
      if (isLand && isInbound) return { source: "بري وارد", matched: true };
      if (isSea && isOutbound) return { source: "بحري صادر", matched: true };
      if (isLand && isOutbound) return { source: "بري صادر", matched: true };
      return { source: pattern, matched: true };
    }
  }

  // No pattern matched — process the sheet anyway using its own name as the source.
  // This handles files where sheet names don't follow the standard naming convention.
  return { source: sheetName, matched: false };
}

/**
 * A CSV parses to exactly one sheet that SheetJS names "Sheet1", which carries
 * no classification information at all — every row would land in
 * `unknownSheetNames` and the file would import zero rows silently. The file
 * name is where the operator actually put the source ("بحري وارد.csv"), so the
 * single sheet is renamed to the file's base name before source detection.
 * That makes a CSV classify through exactly the same detection + column-mapping
 * + normalizer path a same-named sheet inside an .xlsx does — one parser, one
 * mapping path, one normalizer.
 */
export function deriveSheetNameFromFileName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  const withoutExtension = base.replace(/\.[^.]+$/, "");
  return withoutExtension.trim() || base.trim();
}

export function isCsvFileName(fileName: string): boolean {
  return /\.csv$/i.test(fileName.trim());
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

  const isCsv = isCsvFileName(file.name);

  const readOptions = {
    cellDates: false,
    cellNF: false,
    cellStyles: false,
    cellHTML: false,
    WTF: false
  } as const;

  // Same parser either way. A CSV is handed to it as decoded TEXT rather than
  // raw bytes: SheetJS falls back to a single-byte decode for a byte array it
  // sniffs as CSV, which turns every Arabic header into mojibake — the column
  // mapping then matches nothing and the file imports zero rows. TextDecoder
  // strips a UTF-8 BOM (Excel writes one) as part of decoding.
  const workbook = isCsv
    ? XLSX.read(new TextDecoder("utf-8").decode(arrayBuffer), { type: "string", ...readOptions })
    : XLSX.read(arrayBuffer, { type: "array", ...readOptions });

  onProgress?.("تحليل أوراق ذكاء الأعمال...", 30);
  await yieldToMain();

  // CSV: rename the single parsed sheet to the file's base name before source
  // detection (see deriveSheetNameFromFileName). Nothing else changes — the
  // same workbook object continues down the same path.
  if (isCsv && workbook.SheetNames.length === 1) {
    const originalName = workbook.SheetNames[0];
    const derivedName = deriveSheetNameFromFileName(file.name);
    if (derivedName && derivedName !== originalName) {
      workbook.Sheets[derivedName] = workbook.Sheets[originalName];
      delete workbook.Sheets[originalName];
      workbook.SheetNames = [derivedName];
    }
  }

  const allRows: NormalizedBiRow[] = [];
  const sheetSummaries: BiSheetSummary[] = [];
  const unknownSheetNames: string[] = [];

  const totalSheets = workbook.SheetNames.length;
  for (let i = 0; i < totalSheets; i++) {
    const sheetName = workbook.SheetNames[i];
    const { source, matched } = detectBiSourceInfo(sheetName, sheetPatterns);

    onProgress?.(`معالجة ورقة ذكاء الأعمال "${sheetName}"...`, Math.round(30 + (i / totalSheets) * 60));
    await yieldToMain();

    // A CSV whose derived name matches no configured pattern is unclassifiable:
    // record it as unknown so the UI raises an explicit error row for the file
    // instead of reporting a successful import of zero rows.
    if (!source || (isCsv && !matched)) {
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

/**
 * Append several BI workbook results into ONE `BiWorkbookResult`.
 *
 * Multiple BI files are DIFFERENT populations that share the same sheet
 * patterns and column mappings — the owner sometimes receives the BI
 * population as a single file and sometimes split across several. They are
 * therefore CONCATENATED: never deduplicated, never rejected on overlap. Two
 * files that both carry the same `xrayImageId` yield BOTH rows here.
 * (`buildBiMatchMap`'s first-wins rule downstream is untouched and stays a
 * defensive tiebreak — it is not the dedupe policy for this merge.)
 *
 * Everything downstream keeps receiving exactly one `BiWorkbookResult`, so no
 * consumer needs to know how many files produced it.
 *
 * `fileNames` is index-aligned with `results` and is stamped onto each sheet
 * summary as `sourceFileName`, so identical sheet names across files stay
 * distinguishable in the UI.
 */
export function mergeBiWorkbookResults(
  results: BiWorkbookResult[],
  fileNames: string[]
): BiWorkbookResult {
  const rows: NormalizedBiRow[] = [];
  const sheetSummaries: BiSheetSummary[] = [];
  const unknownSheetNames: string[] = [];
  const seenUnknown = new Set<string>();

  let totalOriginalRows = 0;
  let totalNormalizedRows = 0;
  let totalExcludedMissingXrayIdCount = 0;

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const fileName = fileNames[i];

    // A loop, not push(...result.rows): a single BI population already exceeds
    // V8's ~65k argument limit, let alone ten of them appended together.
    for (const row of result.rows) rows.push(row);

    for (const sheet of result.sheetSummaries) {
      sheetSummaries.push(
        fileName === undefined ? { ...sheet } : { ...sheet, sourceFileName: fileName }
      );
    }

    // Union, not concat: the same unclassified sheet name appearing in two
    // files is one problem to report, but the same name in the same file twice
    // cannot happen, so the dedupe key is scoped per file.
    for (const unknown of result.unknownSheetNames) {
      const key = fileName === undefined ? unknown : `${fileName} ${unknown}`;
      if (seenUnknown.has(key)) continue;
      seenUnknown.add(key);
      if (!unknownSheetNames.includes(unknown)) unknownSheetNames.push(unknown);
    }

    totalOriginalRows += result.totalOriginalRows;
    totalNormalizedRows += result.totalNormalizedRows;
    totalExcludedMissingXrayIdCount += result.totalExcludedMissingXrayIdCount;
  }

  return {
    rows,
    sheetSummaries,
    unknownSheetNames,
    totalOriginalRows,
    totalNormalizedRows,
    totalExcludedMissingXrayIdCount
  };
}
