import type { WorkSheet } from "xlsx";

export type RawCell = string | number | boolean | Date | null | undefined;

export type SourceRowWithMeta<TSourceRow extends Record<string, unknown>> = {
  row: TSourceRow;
  sourceRowNumber: number;
};

type SheetToJson = <T>(
  worksheet: WorkSheet,
  options: {
    header: 1;
    defval: null;
    blankrows: false;
    raw: true;
  }
) => T[];

type WorksheetUtils = {
  sheet_to_json: SheetToJson;
};

// Cells whose string representation is all # signs are the Excel "column too narrow"
// display artifact that slips through when using raw: false. With raw: true this should
// not occur, but the guard is cheap insurance.
const HASH_ONLY_PATTERN = /^#+$/;

// Exponential-notation strings that arise when a large integer is serialized as a float
// (e.g. "1.2345678901234568e+17") — treat as blank rather than silently corrupting an ID.
const EXPONENTIAL_PATTERN = /^-?\d+\.?\d*[eE][+-]\d+$/;

function isBlankCell(value: RawCell): boolean {
  if (value === null || value === undefined) {
    return true;
  }
  const text = String(value).trim();
  if (text === "") {
    return true;
  }
  if (HASH_ONLY_PATTERN.test(text)) {
    return true;
  }
  // A float in exponential notation for what should be a large integer ID is corrupt data.
  if (typeof value === "string" && EXPONENTIAL_PATTERN.test(text)) {
    return true;
  }
  return false;
}

/**
 * Mutates large-integer numeric cells in-place, replacing them with their string
 * representation so JavaScript number precision loss cannot silently truncate IDs.
 *
 * SheetJS stores long numeric IDs (≥ 16 digits) as floats. Converting via
 * `String(number)` at this point would give exponential notation. Instead we
 * read the original formatted text (.w) when it looks like a full digit string,
 * otherwise fall back to the rounded integer stringification.
 */
function preprocessLargeNumbers(worksheet: WorkSheet): void {
  for (const cellRef of Object.keys(worksheet)) {
    if (cellRef.startsWith("!")) {
      continue;
    }
    const cell = worksheet[cellRef] as {
      t?: string;
      v?: unknown;
      w?: string;
    } | undefined;
    if (!cell || cell.t !== "n") {
      continue;
    }
    const numVal = Number(cell.v);
    if (!Number.isFinite(numVal) || Math.abs(numVal) <= Number.MAX_SAFE_INTEGER) {
      continue;
    }
    // Prefer the formatted text (.w) if it looks like a plain digit string.
    const formatted = cell.w?.replace(/[,،\s]/g, "") ?? "";
    cell.t = "s";
    cell.v = /^\d{10,}$/.test(formatted) ? formatted : String(Math.round(numVal));
  }
}

function isNonEmptyRow(row: RawCell[]): boolean {
  return row.some((cell) => !isBlankCell(cell));
}

function cleanHeader(value: RawCell): string {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
}

function makeUniqueHeaders(headers: string[]): string[] {
  const seenHeaders = new Map<string, number>();

  return headers.map((header) => {
    if (!header) {
      return header;
    }

    const currentCount = seenHeaders.get(header) ?? 0;
    seenHeaders.set(header, currentCount + 1);

    if (currentCount === 0) {
      return header;
    }

    return `${header}_${currentCount + 1}`;
  });
}

export function worksheetToSourceRows<TSourceRow extends Record<string, unknown>>(
  utils: WorksheetUtils,
  worksheet: WorkSheet
): SourceRowWithMeta<TSourceRow>[] {
  // Must run before sheet_to_json so large-number cells are already strings.
  preprocessLargeNumbers(worksheet);

  const rawRows = utils.sheet_to_json<RawCell[]>(worksheet, {
    header: 1,
    defval: null,
    blankrows: false,
    raw: true
  });

  const nonEmptyRowsWithOriginalIndex = rawRows
    .map((row, index) => ({
      row,
      sourceRowNumber: index + 1
    }))
    .filter(({ row }) => isNonEmptyRow(row));

  if (nonEmptyRowsWithOriginalIndex.length === 0) {
    return [];
  }

  const headerRow = nonEmptyRowsWithOriginalIndex[0].row.map(cleanHeader);
  const dataRows = nonEmptyRowsWithOriginalIndex.slice(1);

  const validColumnIndexes = headerRow
    .map((header, index) => ({ header, index }))
    .filter(({ header, index }) => {
      if (header === "") {
        return false;
      }

      return dataRows.some(({ row }) => !isBlankCell(row[index]));
    })
    .map(({ index }) => index);

  const headers = makeUniqueHeaders(
    validColumnIndexes.map((index) => headerRow[index])
  );

  return dataRows
    .filter(({ row }) => isNonEmptyRow(row))
    .map(({ row, sourceRowNumber }) => {
      const entries = headers.map((header, outputIndex) => {
        const sourceIndex = validColumnIndexes[outputIndex];
        const value = row[sourceIndex];

        return [header, isBlankCell(value) ? null : value] as const;
      });

      return {
        row: Object.fromEntries(entries) as TSourceRow,
        sourceRowNumber
      };
    });
}
