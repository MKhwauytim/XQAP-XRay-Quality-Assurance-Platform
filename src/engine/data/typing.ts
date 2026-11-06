import type { EngineIssue } from "../errors";
import { LIMITS } from "../limits";
import type {
  Cell, ColumnLevel, ColumnRole, ColumnType, DatasetDef, RawFile, RawSheet, TypedCell, TypedDataset,
} from "./types";

const ARABIC_INDIC_ZERO = 0x0660;
const EXT_ARABIC_INDIC_ZERO = 0x06f0;

/** Arabic-Indic digits and separators to Latin. */
function toLatin(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c >= ARABIC_INDIC_ZERO && c <= ARABIC_INDIC_ZERO + 9) out += String(c - ARABIC_INDIC_ZERO);
    else if (c >= EXT_ARABIC_INDIC_ZERO && c <= EXT_ARABIC_INDIC_ZERO + 9) out += String(c - EXT_ARABIC_INDIC_ZERO);
    else if (c === 0x066b) out += ".";
    else if (c === 0x066c) out += ",";
    else out += ch;
  }
  return out;
}

const NUMBER_RE = /^-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/;
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TRUE_WORDS = new Set(["true", "نعم", "1"]);
const FALSE_WORDS = new Set(["false", "لا", "0"]);

function isoDate(y: number, m: number, d: number): string | null {
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return t.toISOString().slice(0, 10);
}

function isEmpty(raw: unknown): boolean {
  return raw === null || raw === undefined || (typeof raw === "string" && raw.trim() === "");
}

function fail(raw: unknown, type: ColumnType): TypedCell {
  return { value: null, error: `${String(raw)} -> ${type}` };
}

export function parseCell(raw: unknown, type: ColumnType): TypedCell {
  if (isEmpty(raw)) return { value: null };
  switch (type) {
    case "text":
      return { value: toLatin(String(raw)) };
    case "number": {
      if (typeof raw === "number") return Number.isFinite(raw) ? { value: raw } : fail(raw, type);
      if (typeof raw !== "string") return fail(raw, type);
      const s = toLatin(raw.trim());
      if (!NUMBER_RE.test(s)) return fail(raw, type);
      return { value: Number(s.replace(/,/g, "")) };
    }
    case "date": {
      if (typeof raw === "number") {
        if (!Number.isFinite(raw) || raw < 1 || raw > 2_958_465) return fail(raw, type);
        // Excel 1900 system: serial 0 is 1899-12-30 once the phantom 1900-02-29 is absorbed.
        const ms = Date.UTC(1899, 11, 30) + Math.floor(raw) * 86_400_000;
        return { value: new Date(ms).toISOString().slice(0, 10) };
      }
      if (typeof raw !== "string") return fail(raw, type);
      const m = ISO_DATE_RE.exec(toLatin(raw.trim()));
      const iso = m ? isoDate(Number(m[1]), Number(m[2]), Number(m[3])) : null;
      return iso ? { value: iso } : fail(raw, type);
    }
    case "boolean": {
      if (typeof raw === "boolean") return { value: raw };
      const w = toLatin(String(raw).trim()).toLowerCase();
      if (TRUE_WORDS.has(w)) return { value: true };
      if (FALSE_WORDS.has(w)) return { value: false };
      return fail(raw, type);
    }
  }
}

const SHA_RE = /^[0-9a-f]{64}$/i;

function dupHeaders(headers: string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const h of headers) (seen.has(h) ? dup : seen).add(h);
  return [...dup];
}

export function typeDataset(def: DatasetDef, files: RawFile[]): { data: TypedDataset; issues: EngineIssue[] } {
  const issues: EngineIssue[] = [];
  const data: TypedDataset = { id: def.id, rows: [], errors: [] };
  const byName = new Map(files.map((f) => [f.fileName, f]));

  const listed: RawFile[] = [];
  def.files.forEach((name, i) => {
    const f = byName.get(name);
    if (!f) {
      issues.push({ rule: "schema.invalid", path: `datasets[0].files[${i}]`, detail: name });
      return;
    }
    if (!SHA_RE.test(f.bytesSha256)) {
      issues.push({ rule: "schema.invalid", path: `datasets[0].files[${i}].bytesSha256`, detail: name });
    }
    listed.push(f);
  });

  let total = 0;
  for (const f of listed) for (const s of f.sheets) total += s.rows.length;
  if (total > LIMITS.maxRowsPerDataset) {
    issues.push({ rule: "limit.rows", path: "datasets[0]", detail: `${total} > ${LIMITS.maxRowsPerDataset}` });
    return { data, issues };
  }

  const badSheets = new Set<RawSheet>();
  for (const f of listed) {
    for (const s of f.sheets) {
      const dups = dupHeaders(s.headers);
      if (dups.length > 0) {
        badSheets.add(s);
        issues.push({
          rule: "schema.invalid",
          path: `files[${f.fileName}]`,
          detail: `${s.sheetName}: ${dups.join(", ")}`,
        });
      }
    }
  }

  // Resolve each column to its header index in its sheet.
  const colIndex: (number | null)[] = def.columns.map((c, ci) => {
    if (c.source.header === "") return null; // virtual calc column
    const f = byName.get(c.source.file);
    const s = f?.sheets.find((x) => x.sheetName === c.source.sheet);
    if (!f || !def.files.includes(c.source.file)) {
      issues.push({ rule: "schema.invalid", path: `datasets[0].columns[${ci}].source.file`, detail: c.source.file });
      return null;
    }
    if (!s) {
      issues.push({ rule: "schema.invalid", path: `datasets[0].columns[${ci}].source.sheet`, detail: c.source.sheet });
      return null;
    }
    if (badSheets.has(s)) return null;
    const idx = s.headers.indexOf(c.source.header);
    if (idx < 0) {
      issues.push({ rule: "schema.invalid", path: `datasets[0].columns[${ci}].source.header`, detail: c.source.header });
      return null;
    }
    return idx;
  });
  if (issues.length > 0) return { data, issues };

  for (const f of listed) {
    for (const s of f.sheets) {
      const cols = def.columns
        .map((c, ci) => ({ c, ci }))
        .filter(({ c }) => c.source.file === f.fileName && c.source.sheet === s.sheetName);
      for (const r of s.rows) {
        const rowIdx = data.rows.length;
        const row: Record<string, Cell> = {};
        for (const c of def.columns) row[c.id] = null;
        for (const { c, ci } of cols) {
          const idx = colIndex[ci];
          if (idx === null) continue;
          const raw = r[idx];
          const cell = parseCell(raw, c.type);
          row[c.id] = cell.value;
          if (cell.error) data.errors.push({ columnId: c.id, row: rowIdx, raw: String(raw) });
        }
        data.rows.push(row);
      }
    }
  }
  return { data, issues };
}

function cellKind(raw: unknown): ColumnType {
  if (typeof raw === "boolean") return "boolean";
  if (typeof raw === "string") {
    const w = toLatin(raw.trim()).toLowerCase();
    if (w === "true" || w === "false" || w === "نعم" || w === "لا") return "boolean";
    if (parseCell(raw, "date").error === undefined) return "date";
  }
  if (parseCell(raw, "number").error === undefined) return "number";
  return "text";
}

export function suggestTypes(
  sheet: RawSheet,
): { header: string; type: ColumnType; role: ColumnRole; level: ColumnLevel }[] {
  return sheet.headers.map((header, i) => {
    const counts: Record<ColumnType, number> = { text: 0, number: 0, date: 0, boolean: 0 };
    for (const r of sheet.rows) {
      if (isEmpty(r[i])) continue;
      counts[cellKind(r[i])] += 1;
    }
    // Ties resolve to text, the type that cannot misread a cell.
    let type: ColumnType = "text";
    for (const t of ["number", "date", "boolean"] as const) if (counts[t] > counts[type]) type = t;
    const role: ColumnRole = type === "number" ? "measure" : "dimension";
    const level: ColumnLevel = type === "number" ? "quantitative" : type === "date" ? "temporal" : "nominal";
    return { header, type, role, level };
  });
}
