import type { ColumnDecl, FilterSpec } from "../data/types";
import type { EngineIssue } from "../errors";
import type { Expr } from "../formula/ast";
import { findMeasureCycle, parseFormula } from "../formula/parse";
import { LIMITS } from "../limits";
import type { DomainPack, IssueParams, MeasureSpec, PageSpec, ReportSpec, VisualSpec, WellItem } from "./types";
import { WELL_SCHEMAS } from "./wells";

const GRID = { cols: 24, rows: 14 } as const;
const MIN_FONT_PX = 20;
const PLACEHOLDER = /\{\{([^{}]*)\}\}/g;
const ANY_DIGIT = /[0-9٠-٩۰-۹]/;
const MEASURE_REF = /@([\p{L}_][\p{L}\p{N}_]*)/gu;
const ISO = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2}))?$/;

function sameMeasure(a: MeasureSpec, b: MeasureSpec): boolean {
  return a.id === b.id && a.label === b.label && a.datasetId === b.datasetId && a.formula === b.formula
    && a.format.kind === b.format.kind && a.format.digits === b.format.digits;
}

function textMeasureIds(text: string | undefined): string[] {
  if (text === undefined) return [];
  return [...text.matchAll(PLACEHOLDER)]
    .map((m) => m[1]!)
    .filter((s) => s.startsWith("measure:"))
    .map((s) => s.slice("measure:".length));
}

function referencedMeasureIds(spec: ReportSpec): Set<string> {
  const out = new Set<string>();
  for (const page of spec.pages ?? []) {
    for (const v of page.visuals ?? []) {
      for (const items of Object.values(v.wells ?? {})) {
        for (const it of items ?? []) if ("measure" in it) out.add(it.measure);
      }
      for (const id of textMeasureIds(v.text)) out.add(id);
    }
  }
  return out;
}

/**
 * Returns a copy whose model.measures also holds every pack measure the spec references
 * (directly or through another measure), and whose model.packId is the pack id. C23.
 */
export function mergePackMeasures(spec: ReportSpec, pack?: DomainPack): ReportSpec {
  const copy = structuredClone(spec);
  if (pack === undefined) return copy;
  const byId = new Map(pack.measures.map((m) => [m.id, m]));
  const have = new Set(copy.model.measures.map((m) => m.id));
  const queue = [...referencedMeasureIds(copy)];
  for (const m of copy.model.measures) for (const r of m.formula.matchAll(MEASURE_REF)) queue.push(r[1]!);
  while (queue.length > 0) {
    const id = queue.pop()!;
    const pm = byId.get(id);
    if (pm === undefined || have.has(id)) continue;
    have.add(id);
    copy.model.measures.push(structuredClone(pm));
    for (const r of pm.formula.matchAll(MEASURE_REF)) queue.push(r[1]!);
  }
  copy.model.packId = pack.packId;
  return copy;
}

interface Ctx {
  spec: ReportSpec;
  issues: EngineIssue[];
  columns: Map<string, ColumnDecl>;
  measureIds: Set<string>;
  paramIds: Set<string>;
}

function push(ctx: Ctx, rule: EngineIssue["rule"], path: string, detail?: string, extra?: Partial<EngineIssue>): void {
  ctx.issues.push({ rule, path, ...(detail !== undefined ? { detail } : {}), ...extra });
}

function duplicates(ctx: Ctx, ids: string[], pathOf: (i: number) => string): void {
  const seen = new Set<string>();
  ids.forEach((id, i) => {
    if (seen.has(id)) push(ctx, "schema.invalid", pathOf(i), `duplicate id ${id}`);
    seen.add(id);
  });
}

function checkDatasets(ctx: Ctx): void {
  const { spec } = ctx;
  duplicates(ctx, spec.datasets.map((d) => d.id), (i) => `datasets[${i}].id`);
  const tables = new Set<string>();
  spec.datasets.forEach((d, di) => {
    const table = "tbl" + d.id.charAt(0).toUpperCase() + d.id.slice(1);
    if (table === "tblSource") push(ctx, "schema.invalid", `datasets[${di}].id`, "reserved table name tblSource");
    else if (tables.has(table)) push(ctx, "schema.invalid", `datasets[${di}].id`, `table name ${table} repeats`);
    tables.add(table);
    d.steps.forEach((s, si) => {
      if (s.kind !== "calc" || s.calc === undefined) return;
      const r = parseFormula(s.calc.formula, { columns: d.columns, measures: [] }, "row");
      if (!r.ok) ctx.issues.push({ ...r.issue, path: `datasets[${di}].steps[${si}].calc.formula` });
    });
  });
}

function checkMeasures(ctx: Ctx): void {
  const { spec } = ctx;
  const ast = new Map<string, Expr>();
  duplicates(ctx, spec.model.measures.map((m) => m.id), (i) => `model.measures[${i}].id`);
  spec.model.measures.forEach((m, i) => {
    const base = `model.measures[${i}]`;
    const ds = spec.datasets.find((d) => d.id === m.datasetId);
    if (ds === undefined) {
      push(ctx, "schema.invalid", `${base}.datasetId`, m.datasetId);
      return;
    }
    if (!Number.isInteger(m.format.digits) || m.format.digits < 0 || m.format.digits > 6) {
      push(ctx, "schema.invalid", `${base}.format.digits`, String(m.format.digits));
    }
    const r = parseFormula(m.formula, { columns: ds.columns, measures: [...ctx.measureIds] }, "measure");
    if (!r.ok) ctx.issues.push({ ...r.issue, path: `${base}.formula` });
    else if (!ast.has(m.id)) ast.set(m.id, r.ast);
  });
  const cycle = findMeasureCycle(ast);
  if (cycle !== null) {
    const at = spec.model.measures.findIndex((m) => m.id === cycle[0]);
    push(ctx, "schema.invalid", `model.measures[${at}].formula`, `measure cycle: ${cycle.join(" > ")}`);
  }
}

function checkFilters(ctx: Ctx, filters: FilterSpec[] | undefined, path: string): void {
  (filters ?? []).forEach((f, i) => {
    if (!ctx.columns.has(f.field)) push(ctx, "schema.invalid", `${path}[${i}].field`, f.field);
    const v = f.value;
    if (typeof v === "object" && v !== null && !Array.isArray(v) && !ctx.paramIds.has(v.param)) {
      push(ctx, "schema.invalid", `${path}[${i}].value`, `unknown param ${v.param}`);
    }
  });
}

function checkFrame(ctx: Ctx, v: VisualSpec, path: string): void {
  const f = v.frame;
  const ints = [f.col, f.row, f.w, f.h, f.z].every(Number.isInteger);
  const inside = f.col >= 0 && f.row >= 1 && f.w >= 1 && f.h >= 1
    && f.col + f.w <= GRID.cols && f.row + f.h <= GRID.rows;
  if (!ints || !inside) push(ctx, "schema.invalid", `${path}.frame`, "frame outside the 24x14 grid or inside the title row");
}

function checkText(ctx: Ctx, v: VisualSpec, path: string): void {
  if (v.type !== "text") {
    if (v.text !== undefined) push(ctx, "schema.invalid", `${path}.text`, "text only on a text visual");
    return;
  }
  if (typeof v.text !== "string" || v.text === "") {
    push(ctx, "schema.invalid", `${path}.text`, "text visual needs text");
    return;
  }
  for (const m of v.text.matchAll(PLACEHOLDER)) {
    const sep = m[1]!.indexOf(":");
    const kind = sep < 0 ? m[1]! : m[1]!.slice(0, sep);
    const id = sep < 0 ? "" : m[1]!.slice(sep + 1);
    if (kind === "measure" && id !== "") {
      if (!ctx.measureIds.has(id)) push(ctx, "measure.unknown", `${path}.text`, id);
    } else if (kind === "param" && id !== "") {
      if (!ctx.paramIds.has(id)) push(ctx, "schema.invalid", `${path}.text`, `unknown param ${id}`);
    } else push(ctx, "schema.invalid", `${path}.text`, `bad placeholder ${m[0]}`);
  }
  if (ANY_DIGIT.test(v.text.replace(PLACEHOLDER, ""))) push(ctx, "literal.number", `${path}.text`);
}

function itemType(ctx: Ctx, it: WellItem): "measure" | ColumnDecl["type"] | "unknownMeasure" | "unknownField" {
  if ("measure" in it) return ctx.measureIds.has(it.measure) ? "measure" : "unknownMeasure";
  const c = ctx.columns.get(it.field);
  return c === undefined ? "unknownField" : c.type;
}

function checkWells(ctx: Ctx, v: VisualSpec, path: string): void {
  const schema = WELL_SCHEMAS[v.type];
  if (schema === undefined) {
    push(ctx, "schema.invalid", `${path}.type`, String(v.type));
    return;
  }
  for (const role of Object.keys(v.wells)) {
    if (!(role in schema)) push(ctx, "well.invalid", `${path}.wells.${role}`, `${role} not used by ${v.type}`);
  }
  for (const [role, rule] of Object.entries(schema)) {
    const items = v.wells[role as keyof typeof v.wells] ?? [];
    const wp = `${path}.wells.${role}`;
    if (items.length < rule.min || items.length > rule.max) {
      push(ctx, "well.invalid", wp, `${items.length} items, allowed ${rule.min} to ${rule.max}`);
    }
    items.forEach((it, i) => {
      const t = itemType(ctx, it);
      const ip = `${wp}[${i}]`;
      if (t === "unknownMeasure") push(ctx, "measure.unknown", ip, "measure" in it ? it.measure : "");
      else if (t === "unknownField") push(ctx, "well.invalid", ip, "field" in it ? it.field : "");
      else if (!rule.accepts.includes(t)) push(ctx, "well.invalid", ip, `${t} not accepted in ${role}`);
    });
  }
}

function checkVisual(ctx: Ctx, v: VisualSpec, path: string): void {
  checkFrame(ctx, v, path);
  const size = v.format?.sizePx;
  if (size !== undefined && !(size >= MIN_FONT_PX)) {
    push(ctx, "schema.invalid", `${path}.format.sizePx`, `${size} < ${MIN_FONT_PX}`);
  }
  checkText(ctx, v, path);
  checkWells(ctx, v, path);
  checkFilters(ctx, v.filters, `${path}.filters`);
  if (v.sort !== undefined && !ctx.columns.has(v.sort.by) && !ctx.measureIds.has(v.sort.by)) {
    push(ctx, "schema.invalid", `${path}.sort.by`, v.sort.by);
  }
  if (v.limit !== undefined && !(Number.isInteger(v.limit.topN) && v.limit.topN >= 1)) {
    push(ctx, "schema.invalid", `${path}.limit.topN`, String(v.limit.topN));
  }
}

function checkPage(ctx: Ctx, p: PageSpec, pi: number): void {
  const path = `pages[${pi}]`;
  if (p.size !== "16:9") push(ctx, "schema.invalid", `${path}.size`, String(p.size));
  if (p.grid?.cols !== GRID.cols || p.grid?.rows !== GRID.rows) push(ctx, "schema.invalid", `${path}.grid`);
  if (typeof p.title !== "string" || p.title === "") push(ctx, "schema.invalid", `${path}.title`);
  if (p.visuals.length > LIMITS.maxVisualsPerPage) {
    push(ctx, "limit.visuals", `${path}.visuals`, `${p.visuals.length} > ${LIMITS.maxVisualsPerPage}`, { page: pi + 1 });
  }
  checkFilters(ctx, p.filters, `${path}.filters`);
  p.visuals.forEach((v, vi) => checkVisual(ctx, v, `${path}.visuals[${vi}]`));
  duplicates(ctx, p.visuals.map((v) => v.visualId), (i) => `${path}.visuals[${i}].visualId`);
}

function checkParams(ctx: Ctx, params: IssueParams | undefined): void {
  duplicates(ctx, ctx.spec.params.map((p) => p.id), (i) => `params[${i}].id`);
  const issuedAt = params?.issuedAt;
  if (typeof issuedAt !== "string" || !ISO.test(issuedAt) || Number.isNaN(Date.parse(issuedAt))) {
    push(ctx, "schema.invalid", "params.issuedAt", String(issuedAt));
  }
  for (const p of ctx.spec.params) {
    const v = params?.values?.[p.id];
    if (p.required && (v === undefined || v === "")) push(ctx, "schema.invalid", `params.values.${p.id}`, "required");
  }
}

/** Hand-written structural validation. Runs on the pack-merged spec. */
export function validateSpec(spec: ReportSpec, pack?: DomainPack, params?: IssueParams): EngineIssue[] {
  const merged = mergePackMeasures(spec, pack);
  const columns = new Map<string, ColumnDecl>();
  for (const d of merged.datasets) for (const c of d.columns) if (!columns.has(c.id)) columns.set(c.id, c);
  const ctx: Ctx = {
    spec: merged,
    issues: [],
    columns,
    measureIds: new Set(merged.model.measures.map((m) => m.id)),
    paramIds: new Set(merged.params.map((p) => p.id)),
  };
  if (merged.schemaVersion !== 1) push(ctx, "schema.invalid", "schemaVersion", String(merged.schemaVersion));
  if (merged.theme !== "deck3") push(ctx, "schema.invalid", "theme", String(merged.theme));
  if (pack !== undefined) {
    const packById = new Map(pack.measures.map((m) => [m.id, m]));
    spec.model.measures.forEach((m, i) => {
      const pm = packById.get(m.id);
      if (pm !== undefined && !sameMeasure(m, pm)) {
        push(ctx, "schema.invalid", `model.measures[${i}].id`, `${m.id} collides with a pack measure`);
      }
    });
  }
  if (merged.pages.length === 0) push(ctx, "schema.invalid", "pages", "no pages");
  if (merged.pages.length > LIMITS.maxSlides) {
    push(ctx, "limit.slides", "pages", `${merged.pages.length} > ${LIMITS.maxSlides}`);
  }
  checkDatasets(ctx);
  checkMeasures(ctx);
  checkParams(ctx, params);
  checkFilters(ctx, merged.filters, "filters");
  duplicates(ctx, merged.pages.map((p) => p.pageId), (i) => `pages[${i}].pageId`);
  merged.pages.forEach((p, pi) => checkPage(ctx, p, pi));
  return ctx.issues;
}
