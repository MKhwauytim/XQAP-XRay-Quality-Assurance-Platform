import { matchesFilter, substituteFilter, typeErrorIssue } from "../data/processing";
import type { ProcessedDataset } from "../data/processing";
import type { Cell, ColumnProfile, DatasetDef, FilterSpec } from "../data/types";
import type { EngineIssue } from "../errors";
import type { Expr } from "../formula/ast";
import { evaluateMeasure, measureColumns } from "../formula/evaluate";
import { parseFormula } from "../formula/parse";
import { LIMITS } from "../limits";
import type { IssueParams, MeasureSpec, ReportSpec, VisualSpec, VisualType, WellRole } from "../spec/types";
import { MEASURE_PLACEHOLDER, TITLE_VISUAL_ID } from "../text";

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
  if (v.type === "text" && v.text) for (const m of v.text.matchAll(MEASURE_PLACEHOLDER)) ids.push(m[1]);
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
  issues: EngineIssue[];
}

/**
 * Value key grammar (injective):
 *   key     = measureId [ "@" part *( "|" part ) ] [ "#" filters ]
 *   part    = field "=" value          (a real category, including one literally named «أخرى» or "~")
 *           | field "~others"          (the collapsed «أخرى» bucket)
 *   value   = the string itself when it is "plain", else its JSON encoding. Plain means: a string
 *             with none of = | & ~ # @ " and that does not parse as a JSON non-string (so "1",
 *             "null", "true" are quoted). Numbers, booleans and null are always JSON (1, true, null),
 *             which never start with a quote and never equal a plain string.
 *   filters = the effective filters (report + page + visual, substituted), each serialised as
 *             JSON [field, op, value], sorted by code point, joined by "&".
 * With no filters and no bucket the key is just "matchRate" or "matchRate@portType=بحري".
 */
function encodeKeyValue(v: Cell): string {
  if (typeof v !== "string") return JSON.stringify(v);
  if (/[=|&~#@"]/.test(v)) return JSON.stringify(v);
  try {
    if (typeof JSON.parse(v) !== "string") return JSON.stringify(v);
  } catch {
    // Not JSON: plain.
  }
  return v;
}

export function valueKey(measureId: string, group: Record<string, Cell>, filters: FilterSpec[], others = false): string {
  const parts = Object.entries(group).map(([k, v]) => (others ? `${k}~others` : `${k}=${encodeKeyValue(v)}`));
  let key = parts.length === 0 ? measureId : `${measureId}@${parts.join("|")}`;
  if (filters.length > 0) {
    const canon = filters.map((f) => JSON.stringify([f.field, f.op, f.value ?? null])).sort(codePointCompare);
    key += `#${canon.join("&")}`;
  }
  return key;
}

/** One group: `id` is the typed identity, `label` the display text computed after grouping. */
interface Group {
  id: string;
  label: string;
  display: Record<string, string>;
  typed: Record<string, Cell>;
  rows: Row[];
  others: boolean;
}

function makeValue(
  ctx: Ctx, m: MeasureSpec, rows: Row[], allRows: Row[], filters: FilterSpec[], g?: Group,
): ResolvedValue {
  const group = g?.display ?? {};
  const ast = ctx.asts.get(m.id);
  const value = ast === undefined ? null : evaluateMeasure(ast, rows, { measures: ctx.asts, allRows });
  const key = valueKey(m.id, g?.typed ?? {}, filters, g?.others ?? false);
  const rv: ResolvedValue = {
    key, measureId: m.id, group, value, display: formatValue(value, m.format),
    provenance: {
      datasetId: m.datasetId, measureId: m.id, formula: m.formula,
      columns: ast === undefined ? [] : measureColumns(ast, ctx.asts), filters,
    },
  };
  const prior = ctx.values.get(key);
  if (prior === undefined) ctx.values.set(key, rv);
  else if (prior.value !== rv.value || JSON.stringify(prior.provenance) !== JSON.stringify(rv.provenance)) {
    ctx.issues.push({ rule: "resolve.keyConflict", detail: key });
  }
  return rv;
}

function datasetDef(spec: ReportSpec, id: string): DatasetDef | undefined {
  return spec.datasets.find((d) => d.id === id);
}

/**
 * Report, page and visual filters for this dataset, substituted. Report-level filters apply wherever
 * their column exists (a report may span datasets). A page or visual filter on another dataset's column
 * is never dropped silently: validateSpec rejects it, and this fails closed as a second guard.
 */
function filtersFor(
  ctx: Ctx, def: DatasetDef | undefined, pageIndex: number, pageFilters: FilterSpec[], v: VisualSpec,
): FilterSpec[] {
  const has = (f: FilterSpec) => def?.columns.some((c) => c.id === f.field) ?? false;
  if (def !== undefined) {
    for (const f of [...pageFilters, ...(v.filters ?? [])]) {
      if (!has(f)) ctx.issues.push({ rule: "schema.invalid", page: pageIndex, visual: v.visualId, detail: `filter ${f.field} is not in dataset ${def.id}` });
    }
  }
  const all = [...(ctx.spec.filters ?? []).filter(has), ...pageFilters.filter(has), ...(v.filters ?? []).filter(has)];
  return all.map((f) => substituteFilter(f, ctx.params));
}

function compareGroups(a: Group, b: Group): number {
  return codePointCompare(a.label, b.label) || codePointCompare(a.id, b.id);
}

function sortGroups(ctx: Ctx, v: VisualSpec, groups: Group[], value: (g: Group, measureId: string) => number | null): Group[] {
  const out = [...groups].sort(compareGroups);
  const by = v.sort?.by;
  if (by !== undefined && ctx.byId.has(by)) {
    const dir = v.sort?.dir === "desc" ? -1 : 1;
    out.sort((a, b) => {
      const x = value(a, by), y = value(b, by);
      if (x === y) return compareGroups(a, b);
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
  const datasetIds = [...new Set(measures.map((m) => m.datasetId))];
  const datasetId = datasetIds[0];
  const def = datasetId === undefined ? undefined : datasetDef(ctx.spec, datasetId);
  const filters = filtersFor(ctx, def, pageIndex, pageFilters, v);
  const allRows = datasetId === undefined ? [] : (ctx.data.get(datasetId)?.rows ?? []);
  const rows = allRows.filter((r) => filters.every((f) => matchesFilter(r, f)));
  const fields = groupFieldsOf(v);
  const base: ResolvedVisual = { pageIndex, visualId: v.visualId, type: v.type, categories: [], cells: [], totals: [] };
  if (datasetIds.length > 1) {
    // Never evaluate a measure on the rows of another dataset.
    ctx.issues.push({ rule: "schema.invalid", page: pageIndex, visual: v.visualId, detail: "visual mixes datasets" });
    return base;
  }
  if (fields.length === 0) {
    base.cells = measures.map((m) => makeValue(ctx, m, rows, allRows, filters));
    return base;
  }

  // Single pass group-by on typed identity; labels are computed afterwards.
  const byId = new Map<string, Group>();
  for (const r of rows) {
    const typedVals = fields.map((f) => r[f] ?? null);
    const id = JSON.stringify(typedVals.map((c) => [c === null ? "null" : typeof c, c]));
    let g = byId.get(id);
    if (!g) {
      const typed: Record<string, Cell> = {};
      fields.forEach((f, i) => { typed[f] = typedVals[i]; });
      g = { id, label: "", display: {}, typed, rows: [], others: false };
      byId.set(id, g);
    }
    g.rows.push(r);
  }
  for (const g of byId.values()) {
    for (const f of fields) g.display[f] = cellText(g.typed[f]);
    g.label = fields.map((f) => g.display[f]).join(" / ");
  }
  const quick = (rs: Row[], id: string) => {
    const ast = ctx.asts.get(id);
    return ast === undefined ? null : evaluateMeasure(ast, rs, { measures: ctx.asts, allRows });
  };
  const valueOf = (g: Group, id: string) => quick(g.rows, id);
  let groups = sortGroups(ctx, v, [...byId.values()], valueOf);

  // A chart keeps its top `limit.topN` categories by the lead measure (the rest fold into «أخرى» when
  // `others`, else are dropped); with no limit, only the chart category cap folds.
  const cap = LIMITS.maxChartCategories - 1;
  const keepN = v.type !== "barChart" ? undefined
    : v.limit !== undefined ? Math.min(v.limit.topN, cap)
    : groups.length > LIMITS.maxChartCategories ? cap : undefined;
  if (keepN !== undefined && groups.length > keepN) {
    const fold = v.limit === undefined || v.limit.others;
    const lead = measures[0]?.id;
    const ranked = [...groups].sort((a, b) => {
      const x = lead === undefined ? null : valueOf(a, lead), y = lead === undefined ? null : valueOf(b, lead);
      if (x === y) return compareGroups(a, b);
      if (x === null) return 1;
      if (y === null) return -1;
      return y - x;
    });
    const keep = new Set(ranked.slice(0, keepN));
    const rest = groups.filter((g) => !keep.has(g)).flatMap((g) => g.rows);
    // The bucket lives outside the identity keyspace: no real category can collide with it.
    const bucket: Group = { id: "", label: OTHERS_LABEL, display: {}, typed: {}, rows: rest, others: true };
    for (const f of fields) { bucket.display[f] = OTHERS_LABEL; bucket.typed[f] = OTHERS_LABEL; }
    groups = [...groups.filter((g) => keep.has(g)), ...(fold ? [bucket] : [])];
  }

  base.categories = groups.map((g) => g.label);
  for (const g of groups) {
    for (const m of measures) base.cells.push(makeValue(ctx, m, g.rows, allRows, filters, g));
  }
  // Totals re-evaluate the measure on the unsplit filtered rows, never a sum of cells.
  base.totals = measures.map((m) => makeValue(ctx, m, rows, allRows, filters));
  return base;
}

/** C19: an errored column the spec uses anywhere fails closed. Step reads are checked in applySteps. */
function specIssues(
  spec: ReportSpec, profiles: Map<string, ColumnProfile[]>, asts: Map<string, Expr>, byId: Map<string, MeasureSpec>,
  params: IssueParams,
): EngineIssue[] {
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
  const known = (f: FilterSpec, path: string) => {
    if (!spec.datasets.some((d) => d.columns.some((c) => c.id === f.field))) {
      issues.push({ rule: "schema.invalid", path, detail: `filter field matches no dataset: ${f.field}` });
    }
    const v = f.value;
    if (v !== null && typeof v === "object" && !Array.isArray(v) && !Object.hasOwn(params.values, v.param)) {
      issues.push({ rule: "schema.invalid", path, detail: `missing param: ${v.param}` });
    }
  };
  const flagFilter = (f: FilterSpec, path: string) => { known(f, path); flag(undefined, f.field, path); };
  (spec.filters ?? []).forEach((f, i) => flagFilter(f, `filters[${i}]`));
  spec.pages.forEach((page, pi) => {
    (page.filters ?? []).forEach((f, i) => flagFilter(f, `pages[${pi}].filters[${i}]`));
    page.visuals.forEach((v, vi) => {
      const vpath = `pages[${pi}].visuals[${vi}]`;
      (v.filters ?? []).forEach((f, i) => flagFilter(f, `${vpath}.filters[${i}]`));
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
  issues.unshift(...specIssues(spec, profiles, asts, byId, params));
  for (const d of spec.datasets) issues.push(...(data.get(d.id)?.issues ?? []));

  const ctx: Ctx = { spec, data, params, asts, byId, values: new Map(), issues };
  const visuals = spec.pages.flatMap((page, pi) => {
    const out = page.visuals.map((v) => resolveVisual(ctx, pi + 1, page.filters ?? [], v));
    // A figure in a page title resolves like a text visual on that page, under the title id.
    if (page.title.includes("{{measure:")) {
      const title: VisualSpec = { visualId: TITLE_VISUAL_ID, type: "text", frame: { col: 0, row: 0, w: 24, h: 1, z: 0 }, wells: {}, text: page.title };
      out.push(resolveVisual(ctx, pi + 1, page.filters ?? [], title));
    }
    return out;
  });
  return { visuals, values: ctx.values, issues };
}
