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
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function toCsvString(
  headers: string[],
  rows: Record<string, unknown>[]
): string {
  const lines: string[] = [];
  lines.push(headers.join(","));
  for (const row of rows) {
    lines.push(headers.map((h) => escapeCell(row[h])).join(","));
  }
  return "﻿" + lines.join("\n");
}
