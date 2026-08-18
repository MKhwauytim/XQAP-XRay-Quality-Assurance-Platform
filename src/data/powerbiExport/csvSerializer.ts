// Characters that spreadsheet apps (Excel/Sheets) may interpret as the start of
// a formula. Cells beginning with one are neutralized with a leading apostrophe.
const FORMULA_INJECTION_START = /^[=+\-@\t\r]/;

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "1" : "0";
  // Pure numbers are never formula-injection vectors — pass through untouched
  // (so a negative number like -5 is not prefixed with an apostrophe).
  if (typeof value === "number") return String(value);
  let str = String(value);
  // CSV formula-injection mitigation (OWASP): prefix a single quote so the
  // spreadsheet treats the cell as literal text, not a formula.
  if (FORMULA_INJECTION_START.test(str)) {
    str = `'${str}`;
  }
  // A bare CR terminates the record for Excel/Power BI just as LF does, so it must be
  // quoted too or the cell splits the row and shifts every column after it.
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// Yields CSV pieces (BOM+header first, then one "\n"-prefixed row per row).
// exportWriter.ts's buildCsvContent consumes this to yield the main thread
// periodically while accumulating — the accumulated buffer is still written
// as one string, so peak memory is unchanged; the win is main-thread
// responsiveness, not memory. `toCsvString` (below) is a synchronous
// convenience wrapper with no production callers of its own — it's kept
// deliberately, as the golden byte-equivalence oracle for this generator
// (its 13 pre-existing tests pin the exact BOM/quoting/formula-injection
// output `toCsvChunks` must still produce).
export function* toCsvChunks(
  headers: string[],
  rows: Record<string, unknown>[]
): Generator<string> {
  yield "﻿" + headers.join(",");
  for (const row of rows) {
    yield "\n" + headers.map((h) => escapeCell(row[h])).join(",");
  }
}

export function toCsvString(
  headers: string[],
  rows: Record<string, unknown>[]
): string {
  return [...toCsvChunks(headers, rows)].join("");
}
