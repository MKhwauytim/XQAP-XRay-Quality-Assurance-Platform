import type { EngineIssue } from "../errors";
import { evaluateRow, measureColumns } from "../formula/evaluate";
import { parseFormula } from "../formula/parse";
import { LIMITS } from "../limits";
import type { IssueParams } from "../spec/types";
import type { Cell, ColumnType, DatasetDef, FilterSpec, TypedDataset } from "./types";

type Row = Record<string, Cell>;

export interface StepRecord {
  stepId: string;
  label: string;
  inCount: number;
  removed: number;
  outCount: number;
  /** Capped at `LIMITS.maxRowsPerDataset`; the workbook step sheet shows them (C13). */
  removedRows: Row[];
  removedRowsTruncated: boolean;
}

export interface ProcessedDataset {
  id: string;
  rawCount: number;
  steps: StepRecord[];
  rows: Row[];
  /** Step problems: a row-level formula that does not parse, or an errored column a step reads (C19). */
  issues: EngineIssue[];
}

/** A filter with any `{ param }` value replaced by its literal from `params.values` (C5). */
export function substituteFilter(f: FilterSpec, params: IssueParams): FilterSpec {
  const v = f.value;
  if (v !== null && typeof v === "object" && !Array.isArray(v)) {
    const lit = Object.hasOwn(params.values, v.param) ? params.values[v.param] : undefined;
    return lit === undefined ? { field: f.field, op: f.op } : { field: f.field, op: f.op, value: lit };
  }
  return f;
}

/** True when `row` passes a substituted filter. A null cell never passes eq, neq or in. */
export function matchesFilter(row: Row, f: FilterSpec): boolean {
  const cell = Object.hasOwn(row, f.field) ? (row[f.field] ?? null) : null;
  if (f.op === "notNull") return cell !== null;
  if (cell === null || f.value === undefined) return false;
  const v = f.value;
  if (f.op === "in") return Array.isArray(v) && (v as Cell[]).includes(cell);
  if (typeof v === "object") return false;
  return f.op === "eq" ? cell === v : cell !== v;
}

/** Column id to its error count, for columns with at least one errored cell. */
export function erroredColumns(data: TypedDataset): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of data.errors) out.set(e.columnId, (out.get(e.columnId) ?? 0) + 1);
  return out;
}

export function typeErrorIssue(def: DatasetDef, columnId: string, count: number, path: string): EngineIssue {
  const label = def.columns.find((c) => c.id === columnId)?.label ?? columnId;
  return { rule: "type.errors", path, detail: `${label} (${columnId}): ${count}` };
}

function fitsType(v: Cell, type: ColumnType): Cell {
  if (v === null) return null;
  if (type === "number") return typeof v === "number" && Number.isFinite(v) ? v : null;
  if (type === "boolean") return typeof v === "boolean" ? v : null;
  return typeof v === "string" ? v : null;
}

interface Tracked { row: Row; raw: number }

function rawErrorText(data: TypedDataset): Map<string, string> {
  const m = new Map<string, string>();
  for (const e of data.errors) m.set(`${e.row} ${e.columnId}`, e.raw);
  return m;
}

/**
 * Runs the dataset's steps in order. `filter` keeps matches, `dedupe` keeps the first row per key
 * (an errored cell keys by its raw text, so two different bad values never merge), and `calc` adds
 * a typed column through a row-level formula and removes nothing.
 */
export function applySteps(
  data: TypedDataset, def: DatasetDef, params: IssueParams, datasetIndex = 0,
  removedCap: number = LIMITS.maxRowsPerDataset,
): ProcessedDataset {
  const issues: EngineIssue[] = [];
  const errored = erroredColumns(data);
  const rawErrors = rawErrorText(data);
  let rows: Tracked[] = data.rows.map((row, raw) => ({ row: { ...row }, raw }));
  const steps: StepRecord[] = [];

  def.steps.forEach((step, si) => {
    const path = `datasets[${datasetIndex}].steps[${si}]`;
    const inCount = rows.length;
    let kept = rows;
    if (step.kind === "filter" && step.filter) {
      const n = errored.get(step.filter.field);
      if (n !== undefined) issues.push(typeErrorIssue(def, step.filter.field, n, path));
      const pv = step.filter.value;
      if (pv !== null && typeof pv === "object" && !Array.isArray(pv) && !Object.hasOwn(params.values, pv.param)) {
        issues.push({ rule: "schema.invalid", path: `${path}.filter`, detail: `missing param: ${pv.param}` });
      }
      const f = substituteFilter(step.filter, params);
      kept = rows.filter((t) => matchesFilter(t.row, f));
    } else if (step.kind === "dedupe" && step.key) {
      // Plan exception (C19): a dedupe key on an errored column is not a fail-closed use. Instead an
      // errored cell keys by its raw text, so two different bad values (or a bad value and an empty
      // cell) are never merged as duplicates.
      const key = step.key;
      const seen = new Set<string>();
      kept = rows.filter((t) => {
        const k = JSON.stringify(key.map((c) => {
          const bad = rawErrors.get(`${t.raw} ${c}`);
          return bad === undefined ? [0, t.row[c] ?? null] : [1, bad];
        }));
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    } else if (step.kind === "calc" && step.calc) {
      const calc = step.calc;
      const parsed = parseFormula(calc.formula, { columns: def.columns, measures: [] }, "row");
      if (def.columns.some((c) => c.id === calc.columnId && c.source.header !== "")) {
        // Never overwrite real source data; validateSpec rejects this first.
        issues.push({ rule: "schema.invalid", path: `${path}.calc.columnId`, detail: `calc would overwrite source column ${calc.columnId}` });
      } else if (!parsed.ok) {
        issues.push({ ...parsed.issue, path: `${path}.calc.formula` });
        for (const t of rows) t.row[calc.columnId] = null;
      } else {
        for (const c of measureColumns(parsed.ast, new Map())) {
          const n = errored.get(c);
          if (n !== undefined) issues.push(typeErrorIssue(def, c, n, path));
        }
        for (const t of rows) t.row[calc.columnId] = fitsType(evaluateRow(parsed.ast, t.row), calc.type);
      }
    }
    const keptSet = new Set(kept);
    const removed = rows.filter((t) => !keptSet.has(t));
    steps.push({
      stepId: step.id, label: step.label, inCount, removed: removed.length, outCount: kept.length,
      removedRows: removed.slice(0, removedCap).map((t) => t.row),
      removedRowsTruncated: removed.length > removedCap,
    });
    rows = kept;
  });

  return { id: def.id, rawCount: data.rows.length, steps, rows: rows.map((t) => t.row), issues };
}
