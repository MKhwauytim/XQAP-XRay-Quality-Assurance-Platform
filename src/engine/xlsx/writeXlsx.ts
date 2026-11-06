import JSZip from "jszip";
import * as XLSX from "xlsx";
import type { ProcessedDataset } from "../data/processing";
import type { Cell, DatasetDef, RawFile } from "../data/types";
import type { EngineIssue } from "../errors";
import type { Expr } from "../formula/ast";
import { toExcelFormula } from "../formula/toExcel";
import type { LayoutDoc } from "../layout/types";
import type { ResolvedValue } from "../resolve/resolve";
import type { MeasureSpec, ReportSpec, ThemeTokens } from "../spec/types";
import { ENGINE_VERSION } from "../version";
import {
  XF, a1, addPivots, addSeparators, addStyles, addTables, cleanPackage, dataFieldName, encodeExternalTargets,
  finishZip, pivotHeight, setThemeFont, styleSheet,
} from "./ooxmlParts";
import type { PivotPart, SheetView, TablePart, XfId } from "./ooxmlParts";
import {
  INDEX_SHEET, SOURCE_HEADERS, STATS_SHEET, describeFilter, labelOf, measureAsts, rowsAoa, tableNameFor,
  visibleNameIssues,
} from "./planWorkbook";
import type { HeaderBlock, PivotSpec, PlannedSheet, WorkbookPlan } from "./planWorkbook";

export interface XlsxInput {
  files: RawFile[];
  spec: ReportSpec;
  processed: Map<string, ProcessedDataset>;
  values: Map<string, ResolvedValue>;
  doc: LayoutDoc;
  theme: ThemeTokens;
}

export interface XlsxOptions {
  title: string;
  issuedAt: string;
  /** File names the host saves the two workbooks under; the relative links between them use these. */
  reportFileName?: string;
  companionFileName?: string;
}

/** The report workbook and its companion raw workbook (owner decision 2026-11-06). */
export interface XlsxOutput {
  report: Uint8Array;
  companion: Uint8Array;
  reportFileName: string;
  companionFileName: string;
}

/** Thrown when the plan breaks a workbook rule; nothing is written. */
export class WorkbookRefused extends Error {
  readonly issues: EngineIssue[];
  constructor(issues: EngineIssue[]) {
    super(issues.map((i) => `${i.rule}: ${i.detail ?? ""}`).join("; "));
    this.issues = issues;
  }
}

export const DEFAULT_REPORT_FILE = "مصنف التقرير.xlsx";
export const DEFAULT_COMPANION_FILE = "مصنف البيانات الخام.xlsx";
/** Header block occupies rows 1 to 7; content starts at row 9. Step counts sit in B4:D4, labels in row 3. */
const CONTENT_ROW = 8;
const ENGINE_ONLY = "الصيغة في المحرك فقط";

type CellObj = XLSX.CellObject;

/** One sheet's cells and cell styles, built before SheetJS writes it. */
class Draft {
  readonly cells = new Map<string, CellObj>();
  readonly styles = new Map<string, XfId>();
  private maxR = 0;
  private maxC = 0;
  widths: number[] = [];

  put(r: number, c: number, v: Cell, xf?: XfId, link?: string): void {
    if (v === null) return;
    const cell: CellObj = typeof v === "number" ? { t: "n", v } : typeof v === "boolean" ? { t: "b", v } : { t: "s", v };
    this.set(r, c, cell, xf, link);
  }

  set(r: number, c: number, cell: CellObj, xf?: XfId, link?: string): void {
    const ref = a1(r, c);
    if (link !== undefined) cell.l = { Target: link };
    this.cells.set(ref, cell);
    if (xf !== undefined) this.styles.set(ref, link === undefined ? xf : XF.link);
    else if (link !== undefined) this.styles.set(ref, XF.link);
    this.maxR = Math.max(this.maxR, r);
    this.maxC = Math.max(this.maxC, c);
  }

  toSheet(): XLSX.WorkSheet {
    const ws: XLSX.WorkSheet = {};
    for (const [ref, cell] of this.cells) ws[ref] = cell;
    ws["!ref"] = `A1:${a1(this.maxR, this.maxC)}`;
    const widths = this.widths.length > 0 ? this.widths : Array.from({ length: this.maxC + 1 }, (_v, i) => (i === 0 ? 30 : 18));
    ws["!cols"] = widths.map((wch) => ({ wch }));
    return ws;
  }
}

const quoteSheet = (name: string): string => `'${name.replace(/'/g, "''")}'`;
const internal = (sheet: string, cell = "A1"): string => `#${quoteSheet(sheet)}!${cell}`;

interface Ctx {
  plan: WorkbookPlan;
  input: XlsxInput;
  asts: Map<string, Expr>;
  measures: Map<string, MeasureSpec>;
  reportFile: string;
  companionFile: string;
  /** Value key to its 0-based row on the statistics sheet. */
  statRow: Map<string, number>;
  excel: Map<string, { ok: true; formula: string } | { ok: false; reason: string }>;
}

function writeHeader(d: Draft, h: HeaderBlock, readsFromLink?: string): void {
  d.put(0, 0, h.title, XF.title);
  d.put(1, 0, h.purpose, XF.note);
  ["الصفوف", "قبل", "المستبعد", "بعد"].forEach((t, c) => d.put(2, c, t, XF.label));
  d.put(3, 0, "العدد", XF.label);
  [h.before, h.removed, h.after].forEach((n, i) => d.put(3, i + 1, n, XF.int));
  d.put(4, 0, "يقرأ من", XF.label);
  d.put(4, 1, h.readsFrom, undefined, readsFromLink);
  d.put(5, 0, "القاعدة", XF.label);
  d.put(5, 1, h.rule);
}

function companionLink(ctx: Ctx, d: Draft, sheet?: string): void {
  d.put(6, 0, "البيانات الخام", XF.label);
  d.put(6, 1, "فتح مصنف البيانات الخام", undefined, sheet === undefined ? ctx.companionFile : `${ctx.companionFile}${internal(sheet)}`);
}

/** Number columns: years without a thousands separator, whole numbers grouped, others with two decimals. */
function columnXf(def: DatasetDef, rows: Cell[][]): (XfId | undefined)[] {
  return def.columns.map((c, i) => {
    if (c.type !== "number") return undefined;
    if (/سنة|السنة|العام|year/i.test(c.label)) return XF.year;
    return rows.every((r) => typeof r[i] !== "number" || Number.isInteger(r[i])) ? XF.int : XF.dec;
  });
}

function writeRange(d: Draft, top: number, def: DatasetDef, rows: Cell[][]): void {
  def.columns.forEach((c, i) => d.put(top, i, c.label, XF.label));
  const xfs = columnXf(def, rows);
  rows.forEach((r, ri) => r.forEach((v, ci) => d.put(top + 1 + ri, ci, v, xfs[ci])));
}

const defOf = (ctx: Ctx, id: string | undefined): DatasetDef | undefined => ctx.input.spec.datasets.find((d) => d.id === id);

function stepSheet(ctx: Ctx, s: PlannedSheet): Draft {
  const d = new Draft();
  const def = defOf(ctx, s.datasetId);
  const rec = ctx.input.processed.get(s.datasetId ?? "")?.steps.find((x) => x.stepId === s.stepId);
  const idx = ctx.plan.sheets.indexOf(s);
  const prev = ctx.plan.sheets[idx - 1];
  const fromStep = prev?.kind === "step" && prev.datasetId === s.datasetId;
  const firstRaw = ctx.plan.companion.sheets.find((c) => c.kind === "raw" && def?.files.includes(c.raw?.fileName ?? ""));
  if (s.header) writeHeader(d, s.header, fromStep ? internal(prev.name) : firstRaw ? `${ctx.companionFile}${internal(firstRaw.name)}` : ctx.companionFile);
  companionLink(ctx, d, firstRaw?.name);
  if (def === undefined || rec === undefined) return d;
  if (rec.removedRowsTruncated) d.put(7, 0, `تعرض أول ${rec.removedRows.length} صف من ${rec.removed} صف مستبعد`, XF.note);
  if (rec.removed === 0) d.put(7, 0, "لم تستبعد هذه المعالجة أي صف", XF.note);
  writeRange(d, CONTENT_ROW, def, rowsAoa(def, rec.removedRows));
  return d;
}

function sortedItems(values: Cell[]): Cell[] {
  const rank = (v: Cell) => (typeof v === "number" ? 0 : typeof v === "string" ? 1 : typeof v === "boolean" ? 2 : 3);
  const distinct = [...new Map(values.map((v) => [JSON.stringify(v), v])).values()];
  return distinct.sort((a, b) => rank(a) - rank(b) || (typeof a === "number" && typeof b === "number" ? a - b : String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0));
}

function aggregate(agg: PivotSpec["agg"], cells: Cell[]): number | null {
  if (agg === "count") return cells.filter((v) => v !== null && v !== "").length;
  const nums = cells.filter((v): v is number => typeof v === "number");
  if (agg === "sum") return nums.reduce((s, v) => s + v, 0);
  return nums.length === 0 ? null : nums.reduce((s, v) => s + v, 0) / nums.length;
}

/** Writes the pivot's cells with the values Excel computes on refresh, and returns the pivot part. */
function pivotBlock(ctx: Ctx, d: Draft, sheetNo: number, spec: PivotSpec, r: number, c: number): PivotPart {
  const def = ctx.input.spec.datasets.find((x) => tableNameFor(x) === spec.sourceTable);
  const columns = def?.columns.map((x) => x.label) ?? [];
  const rowCol = def?.columns.find((x) => x.label === spec.rowField);
  const dataCol = def?.columns.find((x) => x.label === spec.dataField);
  const rows = ctx.input.processed.get(def?.id ?? "")?.rows ?? [];
  const cell = (row: Record<string, Cell>, id: string | undefined): Cell => (id !== undefined && Object.hasOwn(row, id) ? (row[id] ?? null) : null);
  const items = sortedItems(rows.map((row) => cell(row, rowCol?.id)));
  const xf = spec.agg === "average" ? XF.dec : XF.int;
  d.put(r, c, spec.rowField, XF.label);
  d.put(r, c + 1, dataFieldName(spec, columns), XF.label);
  items.forEach((it, i) => {
    d.put(r + 1 + i, c, it === null ? "(فارغ)" : it);
    const vals = rows.filter((row) => cell(row, rowCol?.id) === it).map((row) => cell(row, dataCol?.id));
    d.put(r + 1 + i, c + 1, aggregate(spec.agg, vals), xf);
  });
  d.put(r + 1 + items.length, c, "الإجمالي", XF.label);
  d.put(r + 1 + items.length, c + 1, aggregate(spec.agg, rows.map((row) => cell(row, dataCol?.id))), xf);
  const nums = rows.map((row) => cell(row, dataCol?.id)).filter((v): v is number => typeof v === "number");
  const numeric = spec.agg !== "count" && nums.length > 0
    ? { min: Math.min(...nums), max: Math.max(...nums), integer: nums.every(Number.isInteger) } : undefined;
  return { spec, sheet: sheetNo, at: { r, c }, columns, items, numeric };
}

interface Built { draft: Draft; view: SheetView; table?: TablePart; pivots: PivotPart[] }

function processedSheet(ctx: Ctx, s: PlannedSheet, sheetNo: number): Built {
  const d = new Draft();
  const def = defOf(ctx, s.datasetId);
  const lastStep = [...ctx.plan.sheets].reverse().find((x) => x.kind === "step" && x.datasetId === s.datasetId);
  if (s.header) writeHeader(d, s.header, lastStep ? internal(lastStep.name) : ctx.companionFile);
  const view: SheetView = { tabColor: ctx.input.theme.ink.navy, gridlines: false, selected: false, freezeBelowRow: CONTENT_ROW };
  if (def === undefined) return { draft: d, view, pivots: [] };
  const rows = rowsAoa(def, ctx.input.processed.get(def.id)?.rows ?? []);
  writeRange(d, CONTENT_ROW, def, rows);
  const n = def.columns.length;
  const table: TablePart = {
    name: s.table ?? tableNameFor(def), sheet: sheetNo,
    ref: `${a1(CONTENT_ROW, 0)}:${a1(CONTENT_ROW + Math.max(rows.length, 1), n - 1)}`, columns: def.columns.map((c) => c.label),
  };
  // RTL: column A is on the right, so the pivot after the table's last column sits to its left on screen.
  const pivots = (s.pivots ?? []).map((p) => {
    d.put(CONTENT_ROW - 1, n + 1, `${p.name}، الشريحة ${p.feedsSlide}`, XF.label);
    return pivotBlock(ctx, d, sheetNo, p, CONTENT_ROW, n + 1);
  });
  d.widths = [...def.columns.map(() => 18), 4, 24, 18];
  d.widths[0] = 30;
  return { draft: d, view, table, pivots };
}

function typedGroup(def: DatasetDef, field: string, display: string): string | number | boolean | undefined {
  const type = def.columns.find((c) => c.id === field)?.type;
  if (display === "-") return undefined;
  if (type === "number") return Number.isFinite(Number(display)) ? Number(display) : undefined;
  if (type === "boolean") return display === "true" ? true : display === "false" ? false : undefined;
  return display;
}

function excelFor(ctx: Ctx, v: ResolvedValue): { ok: true; formula: string } | { ok: false; reason: string } {
  const cached = ctx.excel.get(v.key);
  if (cached !== undefined) return cached;
  const def = defOf(ctx, v.provenance.datasetId);
  const ast = ctx.asts.get(v.measureId);
  let r: { ok: true; formula: string } | { ok: false; reason: string };
  const groupFilters: { columnId: string; value: string | number | boolean }[] = [];
  const untyped = def === undefined ? [] : Object.entries(v.group).filter(([field, display]) => {
    const t = typedGroup(def, field, display);
    if (t !== undefined) groupFilters.push({ columnId: field, value: t });
    return t === undefined;
  });
  if (def === undefined || ast === undefined) r = { ok: false, reason: "المقياس غير معرف" };
  else if (v.key.includes("~others") || untyped.length > 0) r = { ok: false, reason: "مجموعة «أخرى» أو قيمة فارغة لا تترجم إلى شرط إكسل" };
  else {
    r = toExcelFormula(ast, {
      table: tableNameFor(def),
      columnName: (id) => labelOf(def, id),
      columnType: (id) => def.columns.find((c) => c.id === id)?.type,
      groupFilters, extraFilters: v.provenance.filters,
    }, ctx.asts);
  }
  ctx.excel.set(v.key, r);
  return r;
}

const formatXf = (m: MeasureSpec | undefined): XfId => (m?.format.kind === "pct" ? XF.pct : m?.format.kind === "dec" ? XF.dec : XF.int);

function statName(ctx: Ctx, v: ResolvedValue): string {
  const label = ctx.measures.get(v.measureId)?.label ?? v.measureId;
  const def = defOf(ctx, v.provenance.datasetId);
  const group = Object.entries(v.group).map(([f, val]) => `${labelOf(def, f)}: ${val}`).join("، ");
  return group === "" ? label : `${label}، ${group}`;
}

function statsSheet(ctx: Ctx, s: PlannedSheet, sheetNo: number): Built {
  const d = new Draft();
  if (s.header) writeHeader(d, s.header);
  let r = CONTENT_ROW;
  const pivots = (s.pivots ?? []).map((p) => {
    d.put(r, 0, `${p.name}، الشريحة ${p.feedsSlide}`, XF.label);
    const part = pivotBlock(ctx, d, sheetNo, p, r + 1, 0);
    r += 1 + pivotHeight(part.items.length) + 1;
    return part;
  });
  const c0 = 3;
  ["الإحصائية", "الشريحة", "قيمة المحرك", "صيغة إكسل", "ملاحظة"].forEach((h, i) => d.put(CONTENT_ROW, c0 + i, h, XF.label));
  let row = CONTENT_ROW + 1;
  for (const v of ctx.input.values.values()) {
    const m = ctx.measures.get(v.measureId);
    const xf = formatXf(m);
    const slide = ctx.input.doc.figures.find((f) => f.valueKey === v.key)?.slide;
    d.put(row, c0, statName(ctx, v));
    d.put(row, c0 + 1, slide ?? "-");
    d.put(row, c0 + 2, v.value ?? "-", v.value === null ? undefined : xf);
    const ex = excelFor(ctx, v);
    const cached: CellObj = v.value === null ? { t: "s", v: "-" } : { t: "n", v: v.value };
    if (ex.ok) d.set(row, c0 + 3, { ...cached, f: ex.formula }, xf);
    else {
      d.set(row, c0 + 3, cached, xf);
      d.put(row, c0 + 4, `${ENGINE_ONLY}: ${ex.reason}`, XF.note);
    }
    ctx.statRow.set(v.key, row);
    row++;
  }
  d.widths = [30, 16, 4, 44, 10, 16, 16, 60];
  return { draft: d, view: { tabColor: ctx.input.theme.ink.navy, gridlines: false, selected: false }, pivots };
}

function sourceSheet(ctx: Ctx, s: PlannedSheet, sheetNo: number): Built {
  const d = new Draft();
  if (s.header) writeHeader(d, s.header, internal(STATS_SHEET));
  SOURCE_HEADERS.forEach((h, i) => d.put(CONTENT_ROW, i, h, XF.label));
  const figs = ctx.input.doc.figures;
  figs.forEach((fig, i) => {
    const r = CONTENT_ROW + 1 + i;
    const v = ctx.input.values.get(fig.valueKey);
    const def = defOf(ctx, v?.provenance.datasetId);
    const statRow = ctx.statRow.get(fig.valueKey);
    d.put(r, 0, fig.valueKey, undefined, statRow === undefined ? undefined : internal(STATS_SHEET, a1(statRow, 3)));
    d.put(r, 1, fig.slide, XF.int);
    d.put(r, 2, fig.display);
    if (v === undefined) return;
    const ex = excelFor(ctx, v);
    d.put(r, 3, ctx.plan.sheets.find((x) => x.kind === "processed" && x.datasetId === v.provenance.datasetId)?.name ?? "");
    d.put(r, 4, v.provenance.columns.map((c) => labelOf(def, c)).join("، "));
    d.put(r, 5, v.provenance.filters.map((f) => describeFilter(def, f)).join("؛ "));
    d.put(r, 6, ctx.measures.get(v.measureId)?.label ?? "");
    d.put(r, 7, v.provenance.formula);
    d.put(r, 8, ex.ok ? ex.formula : `${ENGINE_ONLY}: ${ex.reason}`);
    d.put(r, 9, ENGINE_VERSION);
  });
  const table: TablePart = {
    name: s.table ?? "", sheet: sheetNo,
    ref: `${a1(CONTENT_ROW, 0)}:${a1(CONTENT_ROW + Math.max(figs.length, 1), SOURCE_HEADERS.length - 1)}`, columns: [...SOURCE_HEADERS],
  };
  d.widths = [36, 10, 16, 18, 24, 30, 20, 40, 60, 12];
  return { draft: d, view: { tabColor: ctx.input.theme.ink.navy, gridlines: false, selected: false, freezeBelowRow: CONTENT_ROW }, table, pivots: [] };
}

function indexSheet(ctx: Ctx, s: PlannedSheet): Draft {
  const d = new Draft();
  if (s.header) writeHeader(d, s.header);
  companionLink(ctx, d);
  d.put(CONTENT_ROW, 0, "الورقة", XF.label);
  d.put(CONTENT_ROW, 1, "ما تحويه", XF.label);
  let r = CONTENT_ROW + 1;
  for (const x of ctx.plan.sheets) {
    if (x === s || x.kind === "separator") continue;
    d.put(r, 0, x.name, undefined, internal(x.name));
    d.put(r++, 1, x.header?.purpose ?? "");
  }
  r++;
  d.put(r, 0, "مصنف البيانات الخام", XF.label, ctx.companionFile);
  d.put(r++, 1, "مصنف مرافق يحمل كل ورقة رفعت كما هي، ويصدر مع هذا المصنف", XF.note);
  for (const x of ctx.plan.companion.sheets) {
    if (x.kind !== "raw") continue;
    d.put(r, 0, x.name, undefined, `${ctx.companionFile}${internal(x.name)}`);
    d.put(r++, 1, `البيانات كما رفعت من الملف ${x.raw?.fileName ?? ""}، الورقة ${x.raw?.sheetName ?? ""}`);
  }
  d.widths = [34, 80];
  return d;
}

function companionCover(ctx: Ctx, s: PlannedSheet): Draft {
  const d = new Draft();
  if (s.header) writeHeader(d, s.header);
  d.put(6, 0, "مصنف التقرير", XF.label);
  d.put(6, 1, "العودة إلى فهرس مصنف التقرير", undefined, `${ctx.reportFile}${internal(INDEX_SHEET)}`);
  d.put(CONTENT_ROW, 0, "الورقة", XF.label);
  d.put(CONTENT_ROW, 1, "ما تحويه", XF.label);
  ctx.plan.companion.sheets.filter((x) => x.kind === "raw").forEach((x, i) => {
    d.put(CONTENT_ROW + 1 + i, 0, x.name, undefined, internal(x.name));
    d.put(CONTENT_ROW + 1 + i, 1, `البيانات كما رفعت من الملف ${x.raw?.fileName ?? ""}، الورقة ${x.raw?.sheetName ?? ""}`);
  });
  d.widths = [34, 80];
  return d;
}

function rawSheet(files: RawFile[], s: PlannedSheet): XLSX.WorkSheet {
  const sheet = files.find((f) => f.fileName === s.raw?.fileName)?.sheets.find((x) => x.sheetName === s.raw?.sheetName);
  return XLSX.utils.aoa_to_sheet(sheet === undefined ? [] : [sheet.headers, ...sheet.rows]);
}

async function packageWorkbook(
  sheets: { name: string; ws: XLSX.WorkSheet; view?: SheetView; styles: Map<string, XfId>; separator: boolean }[],
  tables: TablePart[], pivots: PivotPart[], theme: ThemeTokens, opts: XlsxOptions,
): Promise<Uint8Array> {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) XLSX.utils.book_append_sheet(wb, s.ws, s.name);
  const date = new Date(opts.issuedAt);
  wb.Props = { Title: opts.title, CreatedDate: date, ModifiedDate: date };
  const bytes = XLSX.write(wb, { type: "array", bookType: "xlsx", bookSST: true, compression: false }) as ArrayBuffer;
  const zip = await JSZip.loadAsync(bytes);
  addStyles(zip, theme);
  await setThemeFont(zip, theme.font);
  await addSeparators(zip, sheets.flatMap((s, i) => (s.separator ? [i + 1] : [])));
  for (const [i, s] of sheets.entries()) if (!s.separator && s.view) await styleSheet(zip, i + 1, s.view, s.styles);
  await addTables(zip, tables);
  await addPivots(zip, pivots);
  await encodeExternalTargets(zip);
  await cleanPackage(zip);
  return finishZip(zip, opts.issuedAt);
}

/**
 * Writes the report workbook and the companion raw workbook. Refuses (throws `WorkbookRefused`, writes
 * nothing) when the plan carries an issue or any visible name looks like an internal id (M15).
 */
export async function writeXlsx(plan: WorkbookPlan, input: XlsxInput, opts: XlsxOptions): Promise<XlsxOutput> {
  const issues = [...plan.issues];
  for (const i of visibleNameIssues(plan, input.spec)) if (!issues.some((x) => x.rule === i.rule && x.path === i.path && x.detail === i.detail)) issues.push(i);
  if (issues.length > 0) throw new WorkbookRefused(issues);
  const ctx: Ctx = {
    plan, input, asts: measureAsts(input.spec), measures: new Map(input.spec.model.measures.map((m) => [m.id, m])),
    reportFile: opts.reportFileName ?? DEFAULT_REPORT_FILE, companionFile: opts.companionFileName ?? DEFAULT_COMPANION_FILE,
    statRow: new Map(), excel: new Map(),
  };
  const ink = input.theme.ink;
  const designed = (tabColor: string, selected = false): SheetView => ({ tabColor, gridlines: false, selected });
  const built = new Map<PlannedSheet, Built>();
  // Statistics first: the source sheet links each figure to its statistics row.
  plan.sheets.forEach((s, i) => { if (s.kind === "stats") built.set(s, statsSheet(ctx, s, i + 1)); });
  plan.sheets.forEach((s, i) => {
    if (s.kind === "processed") built.set(s, processedSheet(ctx, s, i + 1));
    else if (s.kind === "source") built.set(s, sourceSheet(ctx, s, i + 1));
    else if (s.kind === "step") built.set(s, { draft: stepSheet(ctx, s), view: designed(input.theme.tones.primary), pivots: [] });
    else if (s.kind === "index") built.set(s, { draft: indexSheet(ctx, s), view: designed(ink.gold, i === 0), pivots: [] });
  });
  const reportSheets = plan.sheets.map((s) => {
    const b = built.get(s);
    return b === undefined
      ? { name: s.name, ws: new Draft().toSheet(), styles: new Map<string, XfId>(), separator: true }
      : { name: s.name, ws: b.draft.toSheet(), view: b.view, styles: b.draft.styles, separator: false };
  });
  const tables = plan.sheets.flatMap((s) => built.get(s)?.table ?? []);
  const pivots = plan.sheets.flatMap((s) => built.get(s)?.pivots ?? []);
  const report = await packageWorkbook(reportSheets, tables, pivots, input.theme, opts);

  const companionSheets = plan.companion.sheets.map((s, i) => {
    if (s.kind === "separator") return { name: s.name, ws: new Draft().toSheet(), styles: new Map<string, XfId>(), separator: true };
    if (s.kind === "raw") return { name: s.name, ws: rawSheet(input.files, s), view: { tabColor: ink.muted, gridlines: true, selected: false }, styles: new Map<string, XfId>(), separator: false };
    const d = companionCover(ctx, s);
    return { name: s.name, ws: d.toSheet(), view: designed(ink.gold, i === 0), styles: d.styles, separator: false };
  });
  const companion = await packageWorkbook(companionSheets, [], [], input.theme, { ...opts, title: `${opts.title}، البيانات الخام` });
  return { report, companion, reportFileName: ctx.reportFile, companionFileName: ctx.companionFile };
}
