import { matchesFilter, substituteFilter, typeErrorIssue } from "../data/processing";
import type { ProcessedDataset } from "../data/processing";
import type { Cell, ColumnProfile, DatasetDef, FilterSpec } from "../data/types";
import type { EngineIssue } from "../errors";
import type { Expr } from "../formula/ast";
import { evaluateMeasure, measureColumns } from "../formula/evaluate";
import { parseFormula } from "../formula/parse";
import { LIMITS } from "../limits";
import type { IssueParams, MeasureSpec, ReportSpec, VisualSpec, VisualType, WellRole } from "../spec/types";

type Row = Record<string, Cell>;

export interface ResolvedValue {
  key: string;
  measureId: string;
  group: Record<string, string>;
  value: number | null;
  display: string;
  provenance: { datasetId: string; measureId: string; formula: string; columns: string[]; filters: FilterSpec[] };
}

export interface ResolvedVisual {
  /** 1-based, like every slide index in the engine. */
  pageIndex: number;
  visualId: string;
  type: VisualType;
  categories: string[];
  cells: ResolvedValue[];
  totals: ResolvedValue[];
}

export const OTHERS_LABEL = "أخرى";
const GROUP_WELLS: WellRole[] = ["axis", "legend", "rows", "columns"];
const MEASURE_REF = /\{\{measure:([^}]+)\}\}/g;

/** Latin digits, `,` thousands, pct as `82.95%`, null as `-`. */
export function formatValue(v: number | null, f: MeasureSpec["format"]): string {
  if (v === null || !Number.isFinite(v)) return "-";
  const nf = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: f.digits, maximumFractionDigits: f.digits, useGrouping: true,
  });
  return f.kind === "pct" ? `${nf.format(v * 100)}%` : nf.format(v);
}

function measureIdsOf(v: VisualSpec): string[] {
  const ids = (v.wells.values ?? []).flatMap((w) => ("measure" in w ? [w.measure] : []));
  if (v.type === "text" && v.text) for (const m of v.text.matchAll(MEASURE_REF)) ids.push(m[1]);
  return ids;
}

function groupFieldsOf(v: VisualSpec): string[] {
  return GROUP_WELLS.flatMap((r) => (v.wells[r] ?? []).flatMap((w) => ("field" in w ? [w.field] : [])));
}

function cellText(c: Cell): string {
  return c === null ? "-" : String(c);
}

function codePointCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

interface Ctx {
  spec: ReportSpec;
  data: Map<string, ProcessedDataset>;
  params: IssueParams;
  asts: Map<string, Expr>;
  byId: Map<string, MeasureSpec>;
  values: Map<string, ResolvedValue>;
}

function makeValue(ctx: Ctx, m: MeasureSpec, rows: Row[], allRows: Row[], filters: FilterSpec[], group: Record<string, string>): ResolvedValue {
  const ast = ctx.asts.get(m.id);
  const value = ast === undefined ? null : evaluateMeasure(ast, rows, { measures: ctx.asts, allRows });
  const parts = Object.entries(group).map(([k, v]) => `${k}=${v}`);
  const key = parts.length === 0 ? m.id : `${m.id}@${parts.join("|")}`;
  const rv: ResolvedValue = {
    key, measureId: m.id, group, value, display: formatValue(value, m.format),
    provenance: {
      datasetId: m.datasetId, measureId: m.id, formula: m.formula,
      columns: ast === undefined ? [] : measureColumns(ast, ctx.asts), filters,
    },
  };
  if (!ctx.values.has(key)) ctx.values.set(key, rv);
  return rv;
}

function datasetDef(spec: ReportSpec, id: string): DatasetDef | undefined {
  return spec.datasets.find((d) => d.id === id);
}

/** Report, page and visual filters that name a column of this dataset, substituted. */
function filtersFor(ctx: Ctx, def: DatasetDef | undefined, pageFilters: FilterSpec[], v: VisualSpec): FilterSpec[] {
  const all = [...(ctx.spec.filters ?? []), ...pageFilters, ...(v.filters ?? [])];
  return all.filter((f) => def?.columns.some((c) => c.id === f.field)).map((f) => substituteFilter(f, ctx.params));
}

function sortCategories(ctx: Ctx, v: VisualSpec, cats: string[], value: (cat: string, measureId: string) => number | null): string[] {
  const out = [...cats].sort(codePointCompare);
  const by = v.sort?.by;
  if (by !== undefined && ctx.byId.has(by)) {
    const dir = v.sort?.dir === "desc" ? -1 : 1;
    out.sort((a, b) => {
      const x = value(a, by), y = value(b, by);
      if (x === y) return codePointCompare(a, b);
      if (x === null) return 1;
      if (y === null) return -1;
      return (x - y) * dir;
    });
  } else if (v.sort?.dir === "desc") out.reverse();
  return out;
}

function resolveVisual(ctx: Ctx, pageIndex: number, pageFilters: FilterSpec[], v: VisualSpec): ResolvedVisual {
  const measures = measureIdsOf(v).flatMap((id) => {
    const m = ctx.byId.get(id);
    return m ? [m] : [];
  });
  const datasetId = measures[0]?.datasetId;
  const def = datasetId === undefined ? undefined : datasetDef(ctx.spec, datasetId);
  const filters = filtersFor(ctx, def, pageFilters, v);
  const allRows = datasetId === undefined ? [] : (ctx.data.get(datasetId)?.rows ?? []);
  const rows = allRows.filter((r) => filters.every((f) => matchesFilter(r, f)));
  const fields = groupFieldsOf(v);
  const base: ResolvedVisual = { pageIndex, visualId: v.visualId, type: v.type, categories: [], cells: [], totals: [] };
  if (fields.length === 0) {
    base.cells = measures.map((m) => makeValue(ctx, m, rows, allRows, filters, {}));
    return base;
  }

  // Single pass group-by.
  const groups = new Map<string, { group: Record<string, string>; rows: Row[] }>();
  for (const r of rows) {
    const group: Record<string, string> = {};
    for (const f of fields) group[f] = cellText(r[f] ?? null);
    const label = fields.map((f) => group[f]).join(" / ");
    let g = groups.get(label);
    if (!g) { g = { group, rows: [] }; groups.set(label, g); }
    g.rows.push(r);
  }
  const quick = (rs: Row[], id: string) => {
    const ast = ctx.asts.get(id);
    return ast === undefined ? null : evaluateMeasure(ast, rs, { measures: ctx.asts, allRows });
  };
  const valueOf = (cat: string, id: string) => quick(groups.get(cat)?.rows ?? [], id);
  let cats = sortCategories(ctx, v, [...groups.keys()], valueOf);

  if (v.type === "barChart" && cats.length > LIMITS.maxChartCategories) {
    const lead = measures[0]?.id;
    const ranked = [...cats].sort((a, b) => {
      const x = lead === undefined ? null : valueOf(a, lead), y = lead === undefined ? null : valueOf(b, lead);
      if (x === y) return codePointCompare(a, b);
      if (x === null) return 1;
      if (y === null) return -1;
      return y - x;
    });
    const keep = new Set(ranked.slice(0, LIMITS.maxChartCategories - 1));
    const rest = cats.filter((c) => !keep.has(c)).flatMap((c) => groups.get(c)!.rows);
    const othersGroup: Record<string, string> = {};
    for (const f of fields) othersGroup[f] = OTHERS_LABEL;
    cats = cats.filter((c) => keep.has(c));
    groups.set(OTHERS_LABEL, { group: othersGroup, rows: rest });
    cats.push(OTHERS_LABEL);
  }

  base.categories = cats;
  for (const cat of cats) {
    const g = groups.get(cat)!;
    for (const m of measures) base.cells.push(makeValue(ctx, m, g.rows, allRows, filters, g.group));
  }
  // Totals re-evaluate the measure on the unsplit filtered rows, never a sum of cells.
  base.totals = measures.map((m) => makeValue(ctx, m, rows, allRows, filters, {}));
  return base;
}

/** C19: an errored column the spec uses anywhere fails closed. Step reads are checked in applySteps. */
function typeErrorIssues(spec: ReportSpec, profiles: Map<string, ColumnProfile[]>, asts: Map<string, Expr>, byId: Map<string, MeasureSpec>): EngineIssue[] {
  const issues: EngineIssue[] = [];
  const seen = new Set<string>();
  const flag = (datasetId: string | undefined, columnId: string, path: string) => {
    spec.datasets.forEach((def) => {
      if (datasetId !== undefined && def.id !== datasetId) return;
      const p = profiles.get(def.id)?.find((c) => c.columnId === columnId);
      const tag = `${def.id} ${columnId}`;
      if (!p || p.errors === 0 || seen.has(tag)) return;
      seen.add(tag);
      issues.push(typeErrorIssue(def, columnId, p.errors, path));
    });
  };
  (spec.filters ?? []).forEach((f, i) => flag(undefined, f.field, `filters[${i}]`));
  spec.pages.forEach((page, pi) => {
    (page.filters ?? []).forEach((f, i) => flag(undefined, f.field, `pages[${pi}].filters[${i}]`));
    page.visuals.forEach((v, vi) => {
      const vpath = `pages[${pi}].visuals[${vi}]`;
      (v.filters ?? []).forEach((f, i) => flag(undefined, f.field, `${vpath}.filters[${i}]`));
      const ids = measureIdsOf(v);
      for (const id of ids) {
        const ast = asts.get(id);
        if (ast) for (const c of measureColumns(ast, asts)) flag(byId.get(id)?.datasetId, c, `${vpath}.wells.values`);
      }
      const ds = byId.get(ids[0] ?? "")?.datasetId;
      for (const f of groupFieldsOf(v)) flag(ds, f, `${vpath}.wells`);
    });
  });
  return issues;
}

export function resolveVisuals(
  spec: ReportSpec, data: Map<string, ProcessedDataset>, profiles: Map<string, ColumnProfile[]>, params: IssueParams,
): { visuals: ResolvedVisual[]; values: Map<string, ResolvedValue>; issues: EngineIssue[] } {
  const issues: EngineIssue[] = [];
  const asts = new Map<string, Expr>();
  const byId = new Map(spec.model.measures.map((m) => [m.id, m]));
  const ids = spec.model.measures.map((m) => m.id);
  spec.model.measures.forEach((m, i) => {
    const def = datasetDef(spec, m.datasetId);
    const r = parseFormula(m.formula, { columns: def?.columns ?? [], measures: ids }, "measure");
    if (r.ok) asts.set(m.id, r.ast);
    else issues.push({ ...r.issue, path: `model.measures[${i}].formula` });
  });
  issues.unshift(...typeErrorIssues(spec, profiles, asts, byId));
  for (const d of spec.datasets) issues.push(...(data.get(d.id)?.issues ?? []));

  const ctx: Ctx = { spec, data, params, asts, byId, values: new Map() };
  const visuals = spec.pages.flatMap((page, pi) => page.visuals.map((v) => resolveVisual(ctx, pi + 1, page.filters ?? [], v)));
  return { visuals, values: ctx.values, issues };
}
