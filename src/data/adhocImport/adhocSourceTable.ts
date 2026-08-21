/**
 * SOURCE layer of the ad-hoc import: raw input (an uploaded workbook, or a
 * block pasted out of Excel) → `SourceTable[]`.
 *
 * This layer maps nothing and validates nothing. It hands the mapping step a
 * faithful, header-keyed view of what the operator actually supplied, which is
 * what lets the ad-hoc module stop borrowing the Population tab's risk-ingest
 * types (correction C1 in `adhocImportModel.ts`).
 *
 * Both paths share `worksheetRows.ts` semantics on purpose: the same file read
 * through the upload button and pasted through the clipboard must yield the
 * same headers and the same `sourceRowNumber`s, otherwise a mapping saved from
 * one input silently stops matching the other.
 */

import * as XLSX from "xlsx";

import { makeUniqueHeaders, worksheetToSourceRows } from "../workbook/worksheetRows";
import { PASTE_SHEET_NAME } from "./adhocImportModel";
import type { SourceRow, SourceTable } from "./adhocImportModel";

/**
 * Same options as `adhocImportMapping.ts` uses. `cellDates: false` matters:
 * the field catalog treats dates as opaque display strings, so letting SheetJS
 * hand back `Date` objects here would reformat what the operator's file said.
 */
const WORKBOOK_READ_OPTIONS = {
  type: "array",
  cellDates: false,
  cellNF: false,
  cellStyles: false,
  cellHTML: false,
  WTF: false,
} as const;

/**
 * `worksheetToSourceRows` drops any column that is blank in every data row, so
 * the header list cannot be read off the worksheet's header line — it has to be
 * the union of the keys the rows actually carry, in first-seen order.
 *
 * A consequence worth stating: a column with a header but no values anywhere is
 * not offerable in the mapping UI. That is the intended trade. Offering it would
 * let an admin map a required field to a column that can only ever produce null,
 * turning every row invalid for a reason the review table cannot explain.
 *
 * The union (rather than just the first row's keys) is needed because the row
 * objects are built from one shared header list per sheet, but a caller reading
 * a partially-populated sheet should still see every surviving column.
 */
function collectHeaders(rows: SourceRow[]): string[] {
  const headers: string[] = [];
  const seen = new Set<string>();

  for (const { values } of rows) {
    for (const header of Object.keys(values)) {
      if (!seen.has(header)) {
        seen.add(header);
        headers.push(header);
      }
    }
  }

  return headers;
}

/**
 * The testable core of the file path — takes bytes rather than a `File` so it
 * runs under the node test environment with no DOM.
 *
 * Every worksheet is treated as data (no sheet-name filtering): an ad-hoc file
 * has no fixed shape, and the operator picks the sheet in the UI. A worksheet
 * that yields no rows is skipped entirely rather than emitted as an empty
 * table — an empty sheet is nothing to map, and listing it as a choice is noise.
 */
export function readWorkbookTablesFromBuffer(buffer: ArrayBuffer): SourceTable[] {
  const workbook = XLSX.read(buffer, WORKBOOK_READ_OPTIONS);
  const tables: SourceTable[] = [];

  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) {
      continue;
    }

    const sourceRows = worksheetToSourceRows<Record<string, unknown>>(XLSX.utils, worksheet);
    if (sourceRows.length === 0) {
      continue;
    }

    const rows: SourceRow[] = sourceRows.map(({ row, sourceRowNumber }) => ({
      sourceRowNumber,
      values: row,
    }));

    tables.push({ sheetName, headers: collectHeaders(rows), rows });
  }

  return tables;
}

export async function readWorkbookTables(file: File): Promise<SourceTable[]> {
  return readWorkbookTablesFromBuffer(await file.arrayBuffer());
}

/** Splits on CRLF, lone CR and LF alike — Excel's clipboard payload varies by OS. */
function splitLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/);
}

function isBlankLine(cells: string[]): boolean {
  return cells.every((cell) => cell.trim() === "");
}

/**
 * Parses a block copied out of Excel. Excel puts TSV on the clipboard, so the
 * grammar is fixed: tab-separated cells, one line per row, first line is the
 * header row.
 *
 * `sourceRowNumber` is the 1-based line number within the pasted text COUNTING
 * the header line, so the first data row is 2. That is deliberate: the workbook
 * path numbers the header as worksheet row 1, and `rowKey` / every diagnostic
 * string is shared between the two. A paste that numbered its first data row 1
 * would make the same rows report different numbers depending on how they got
 * into the app.
 *
 * Blank input is a `SourceTable` with no headers and no rows, never a throw —
 * the paste box is a live-updating text area and an empty one is the normal
 * starting state, not an error to report.
 */
export function parsePastedTable(text: string, sheetName: string = PASTE_SHEET_NAME): SourceTable {
  if (text.trim() === "") {
    return { sheetName, headers: [], rows: [] };
  }

  const lines = splitLines(text);
  // A trailing newline is near-universal in clipboard payloads; it is not a row.
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
    lines.pop();
  }
  if (lines.length === 0) {
    return { sheetName, headers: [], rows: [] };
  }

  const headers = makeUniqueHeaders(lines[0].split("\t").map((header) => header.trim()));

  const rows: SourceRow[] = [];
  for (let index = 1; index < lines.length; index += 1) {
    const cells = lines[index].split("\t");
    if (isBlankLine(cells)) {
      continue;
    }

    const values: Record<string, unknown> = {};
    headers.forEach((header, columnIndex) => {
      if (header === "") {
        return;
      }
      // A ragged row (fewer cells than headers) leaves the missing keys null,
      // exactly as a blank cell would — a short line is a row with empty tail
      // columns, not a malformed one to reject.
      // An empty or whitespace-only cell becomes null, matching how the
      // workbook path's `isBlankCell` treats the same content.
      const cell = cells[columnIndex] ?? "";
      values[header] = cell.trim() === "" ? null : cell;
    });

    rows.push({ sourceRowNumber: index + 1, values });
  }

  return { sheetName, headers: headers.filter((header) => header !== ""), rows };
}
