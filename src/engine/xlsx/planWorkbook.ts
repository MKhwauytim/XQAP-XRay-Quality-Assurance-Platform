import type { ProcessedDataset, StepRecord } from "../data/processing";
import type { Cell, DatasetDef, FilterSpec, ProcessingStep, RawFile } from "../data/types";
import type { EngineIssue } from "../errors";
import type { Expr } from "../formula/ast";
import { parseFormula } from "../formula/parse";
import type { LayoutDoc } from "../layout/types";
import type { ResolvedValue } from "../resolve/resolve";
import type { MeasureSpec, ReportSpec } from "../spec/types";

/**
 * The workbook plan: every visible name, header block and pivot of the two workbooks an issue writes
 * (owner decision 2026-11-06). The report workbook holds the cover, processing, processed sets,
 * statistics and source; the companion workbook holds the raw sheets exactly as uploaded.
 */

export interface PivotSpec {
  name: string;
  sourceTable: string;
  /** Column header (the column label) of the row field. */
  rowField: string;
  /** Column header of the data field. */
  dataField: string;
  agg: "count" | "sum" | "average";
  /** 1-based slide this pivot feeds. */
  feedsSlide: number;
  valueKeys: string[];
}

export type SheetKind = "index" | "separator" | "raw" | "step" | "processed" | "stats" | "source";

/** The fixed header block every non-raw sheet opens with (M15.3). */
export interface HeaderBlock {
  title: string;
  purpose: string;
  readsFrom: string;
  rule: string;
  before: number;
  removed: number;
  after: number;
}

export interface PlannedSheet {
  name: string;
  kind: SheetKind;
  table?: string;
  pivots?: PivotSpec[];
  datasetId?: string;
  stepId?: string;
  raw?: { fileName: string; sheetName: string };
  header?: HeaderBlock;
}

export interface PlannedTable {
  name: string;
  sheet: string;
  datasetId?: string;
  columns: string[];
}

export interface WorkbookPlan {
  /** The report workbook, in order. */
  sheets: PlannedSheet[];
  companion: { sheets: PlannedSheet[] };
  tables: PlannedTable[];
  /** Plan problems: name collisions Excel would refuse, pivot fields missing from their table, id-like names. */
  issues: EngineIssue[];
}

export const INDEX_SHEET = "الفهرس";
export const STATS_SHEET = "الإحصائيات";
export const SOURCE_SHEET = "المصدر";
export const SOURCE_TABLE = "جدول_مصدر_الأرقام";
export const SEPARATORS = ["|", "||", "|||", "||||", "|||||"] as const;
/** Column headers of the source table, in order. The first is the machine join key for the parity gate. */
export const SOURCE_HEADERS = [
  "مفتاح القيمة", "الشريحة", "القيمة المعروضة", "الورقة", "الأعمدة", "المرشحات", "المقياس",
  "نص الصيغة", "صيغة إكسل", "إصدار المحرك",
] as const;
export const SOURCE_KEY_HEADER = SOURCE_HEADERS[0];

const MAX_SHEET_NAME = 31;
const INVALID_SHEET_CHARS = /[[\]:*?/\\]/g;

/** Excel compares names ignoring case and the hamza on alef (PoC finding); this is that comparison key. */
export function excelNameKey(name: string): string {
  return name.replace(/[أإآٱ]/g, "ا").toLowerCase();
}

/** Excel table name for a dataset: readable Arabic, letters, digits and underscores only. */
export function tableNameFor(def: DatasetDef): string {
  return `جدول_${def.label.trim().replace(/[^\p{L}\p{N}_.]+/gu, "_")}`;
}

/** Sheet names made valid, cut to 31 characters and unique (case and hamza insensitive), with a numeric suffix. */
class SheetNamer {
  private readonly used = new Set<string>();

  constructor(reserved: readonly string[]) {
    // Excel reserves "History" for its change-tracking sheet.
    for (const r of [...reserved, "History"]) this.used.add(excelNameKey(r));
  }

  take(wanted: string): string {
    let base = wanted.replace(INVALID_SHEET_CHARS, " ").replace(/\s+/g, " ").trim().replace(/^'+|'+$/g, "");
    if (base === "") base = "ورقة";
    for (let n = 1; ; n++) {
      const suffix = n === 1 ? "" : ` ${n}`;
      // Cut on code points so a surrogate pair is never split; a cut may expose a trailing quote.
      const cut = Array.from(base).slice(0, MAX_SHEET_NAME - Array.from(suffix).length).join("").trimEnd().replace(/'+$/, "");
      const name = cut + suffix;
      if (!this.used.has(excelNameKey(name))) {
        this.used.add(excelNameKey(name));
        return name;
      }
    }
  }
}

const OP_TEXT: Record<FilterSpec["op"], string> = { eq: "يساوي", neq: "لا يساوي", in: "ضمن", notNull: "غير فارغ" };

export function labelOf(def: DatasetDef | undefined, columnId: string): string {
  return def?.columns.find((c) => c.id === columnId)?.label ?? columnId;
}

function valueText(v: FilterSpec["value"]): string {
  if (v === undefined) return "";
  if (Array.isArray(v)) return v.map(String).join("، ");
  if (typeof v === "object") return `قيمة المعامل ${v.param}`;
  return String(v);
}

/** A filter in plain Arabic, by column label. */
export function describeFilter(def: DatasetDef | undefined, f: FilterSpec): string {
  const label = `«${labelOf(def, f.field)}»`;
  return f.op === "notNull" ? `${label} ${OP_TEXT.notNull}` : `${label} ${OP_TEXT[f.op]} «${valueText(f.value)}»`;
}

/** The step's rule in plain Arabic (M15.3). */
export function stepRule(def: DatasetDef, step: ProcessingStep): string {
  if (step.kind === "filter" && step.filter) return `يبقي الصفوف التي يكون فيها ${describeFilter(def, step.filter)}، ويستبعد غيرها`;
  if (step.kind === "dedupe" && step.key) {
    return `يحذف الصفوف المكررة في الأعمدة ${step.key.map((c) => `«${labelOf(def, c)}»`).join("، ")} ويبقي أول صف منها`;
  }
  if (step.kind === "calc" && step.calc) return `يضيف العمود «${labelOf(def, step.calc.columnId)}» محسوبا لكل صف بالصيغة ${step.calc.formula}`;
  return "لا يغير الصفوف";
}

type Simple = { agg: PivotSpec["agg"]; columnId: string };
const AGG_OF: Record<string, PivotSpec["agg"]> = { count: "count", sum: "sum", avg: "average" };

/** A measure that is one plain aggregate of one column (directly or through `@other`), so a pivot shows it. */
function simpleAggregate(ast: Expr, asts: Map<string, Expr>, depth = 0): Simple | undefined {
  if (ast.k === "measure" && depth < 8) {
    const inner = asts.get(ast.id);
    return inner === undefined ? undefined : simpleAggregate(inner, asts, depth + 1);
  }
  if (ast.k !== "call" || AGG_OF[ast.fn] === undefined) return undefined;
  const arg = ast.args[0];
  return arg?.k === "col" ? { agg: AGG_OF[ast.fn], columnId: arg.id } : undefined;
}

export function measureAsts(spec: ReportSpec): Map<string, Expr> {
  const ids = spec.model.measures.map((m) => m.id);
  const out = new Map<string, Expr>();
  for (const m of spec.model.measures) {
    const def = spec.datasets.find((d) => d.id === m.datasetId);
    const parsed = parseFormula(m.formula, { columns: def?.columns ?? [], measures: ids });
    if (parsed.ok) out.set(m.id, parsed.ast);
  }
  return out;
}

interface Ctx {
  spec: ReportSpec;
  processed: Map<string, ProcessedDataset>;
  values: Map<string, ResolvedValue>;
  doc: LayoutDoc;
  asts: Map<string, Expr>;
  measures: Map<string, MeasureSpec>;
  issues: EngineIssue[];
}

/** Statistic groups: (dataset, group field, slide), in the order the slides show them. */
function statisticGroups(ctx: Ctx): { datasetId: string; field: string; slide: number; keys: string[] }[] {
  const groups = new Map<string, { datasetId: string; field: string; slide: number; keys: string[] }>();
  for (const fig of ctx.doc.figures) {
    const v = ctx.values.get(fig.valueKey);
    const fields = v === undefined ? [] : Object.keys(v.group);
    if (v === undefined || fields.length === 0) continue;
    const id = JSON.stringify([v.provenance.datasetId, fields[0], fig.slide]);
    const g = groups.get(id) ?? { datasetId: v.provenance.datasetId, field: fields[0], slide: fig.slide, keys: [] };
    if (!g.keys.includes(v.key)) g.keys.push(v.key);
    groups.set(id, g);
  }
  return [...groups.values()];
}

function pivotFor(
  ctx: Ctx, def: DatasetDef, field: string, slide: number, keys: string[],
): PivotSpec {
  const rowField = labelOf(def, field);
  const measureIds = [...new Set(keys.map((k) => ctx.values.get(k)?.measureId ?? ""))];
  for (const id of measureIds) {
    const ast = ctx.asts.get(id);
    const simple = ast === undefined ? undefined : simpleAggregate(ast, ctx.asts);
    if (simple !== undefined) {
      const label = ctx.measures.get(id)?.label ?? id;
      return {
        name: `${label} حسب ${rowField}`, sourceTable: tableNameFor(def), rowField,
        dataField: labelOf(def, simple.columnId), agg: simple.agg, feedsSlide: slide, valueKeys: keys,
      };
    }
  }
  // No measure of the group is one plain aggregate: the pivot counts the group's rows instead.
  return {
    name: `عدد الصفوف حسب ${rowField}`, sourceTable: tableNameFor(def), rowField, dataField: rowField,
    agg: "count", feedsSlide: slide, valueKeys: [],
  };
}

/** The processed set's pivot: its first statistic group, else its first dimension column. */
function processedPivot(ctx: Ctx, def: DatasetDef, groups: ReturnType<typeof statisticGroups>): PivotSpec | undefined {
  const first = groups.find((g) => g.datasetId === def.id);
  if (first !== undefined) return pivotFor(ctx, def, first.field, first.slide, first.keys);
  const dim = def.columns.find((c) => c.role === "dimension");
  if (dim === undefined) return undefined;
  const slide = ctx.doc.figures.find((f) => ctx.values.get(f.valueKey)?.provenance.datasetId === def.id)?.slide ?? 1;
  return pivotFor(ctx, def, dim.id, slide, []);
}

function stepHeader(def: DatasetDef, step: ProcessingStep, rec: StepRecord | undefined, readsFrom: string): HeaderBlock {
  return {
    title: step.label,
    purpose: `الصفوف التي استبعدتها هذه المعالجة من ${def.label}، مع عدد الصفوف قبلها وبعدها`,
    readsFrom, rule: stepRule(def, step),
    before: rec?.inCount ?? 0, removed: rec?.removed ?? 0, after: rec?.outCount ?? 0,
  };
}

function checkColumns(ctx: Ctx, def: DatasetDef, di: number): void {
  const seen = new Map<string, string>();
  def.columns.forEach((c, ci) => {
    const key = excelNameKey(c.label.trim());
    const prior = seen.get(key);
    if (c.label.trim() === "") {
      ctx.issues.push({ rule: "xlsx.columnClash", path: `datasets[${di}].columns[${ci}].label`, detail: "empty label" });
    } else if (prior !== undefined) {
      ctx.issues.push({ rule: "xlsx.columnClash", path: `datasets[${di}].columns[${ci}].label`, detail: `${c.label} / ${prior}` });
    }
    seen.set(key, c.label);
  });
}

function checkPivot(ctx: Ctx, p: PivotSpec, tables: PlannedTable[]): void {
  const t = tables.find((x) => x.name === p.sourceTable);
  for (const field of [p.rowField, p.dataField]) {
    if (t === undefined || !t.columns.includes(field)) {
      ctx.issues.push({ rule: "xlsx.pivotField", detail: `${p.name}: ${field} (${p.sourceTable})` });
    }
  }
}

/** Pivot names unique on their sheet (case and hamza insensitive): a repeated name gains its slide. */
function uniquePivotNames(pivots: PivotSpec[]): PivotSpec[] {
  const count = new Map<string, number>();
  for (const p of pivots) count.set(excelNameKey(p.name), (count.get(excelNameKey(p.name)) ?? 0) + 1);
  return pivots.map((p) => ((count.get(excelNameKey(p.name)) ?? 0) > 1 ? { ...p, name: `${p.name}، الشريحة ${p.feedsSlide}` } : p));
}

function rawTotal(files: RawFile[]): number {
  return files.reduce((n, f) => n + f.sheets.reduce((m, s) => m + s.rows.length, 0), 0);
}

function rawSection(files: RawFile[]): { sheets: PlannedSheet[]; nameOf: Map<string, string> } {
  const namer = new SheetNamer([INDEX_SHEET, SEPARATORS[0]]);
  const nameOf = new Map<string, string>();
  const raw: PlannedSheet[] = [];
  for (const f of files) {
    for (const s of f.sheets) {
      const name = namer.take(`${f.fileName} ${s.sheetName}`);
      nameOf.set(JSON.stringify([f.fileName, s.sheetName]), name);
      raw.push({ name, kind: "raw", raw: { fileName: f.fileName, sheetName: s.sheetName } });
    }
  }
  const total = rawTotal(files);
  const cover: PlannedSheet = {
    name: INDEX_SHEET, kind: "index",
    header: {
      title: "البيانات الخام كما رفعت", purpose: "كل ملف وورقة رفعت للتقرير، بالأعمدة والأسماء والترتيب نفسه دون أي تغيير",
      readsFrom: "الملفات المرفوعة", rule: "لا تطبق أي معالجة على هذه الأوراق", before: total, removed: 0, after: total,
    },
  };
  return { sheets: [cover, { name: SEPARATORS[0], kind: "separator" }, ...raw], nameOf };
}

/**
 * Plans both workbooks. Report order: الفهرس, `|`, processing sheets (named by what they do, in the
 * order applied), `||`, processed sets, `|||`, الإحصائيات, `||||`, المصدر. Companion: a cover, `|`,
 * then every raw sheet as uploaded.
 */
export function planWorkbook(
  files: RawFile[], spec: ReportSpec, processed: Map<string, ProcessedDataset>,
  values: Map<string, ResolvedValue>, doc: LayoutDoc,
): WorkbookPlan {
  const ctx: Ctx = {
    spec, processed, values, doc, asts: measureAsts(spec),
    measures: new Map(spec.model.measures.map((m) => [m.id, m])), issues: [],
  };
  const raw = rawSection(files);
  const namer = new SheetNamer([INDEX_SHEET, STATS_SHEET, SOURCE_SHEET, ...SEPARATORS]);
  const groups = statisticGroups(ctx);
  const tables: PlannedTable[] = [];
  const steps: PlannedSheet[] = [];
  const sets: PlannedSheet[] = [];
  const tableKeys = new Map<string, number>([[excelNameKey(SOURCE_TABLE), -1]]);

  spec.datasets.forEach((def, di) => {
    checkColumns(ctx, def, di);
    const pd = processed.get(def.id);
    const rawNames = def.files.flatMap((fn) => files.find((f) => f.fileName === fn)?.sheets.map((s) => raw.nameOf.get(JSON.stringify([fn, s.sheetName])) ?? "") ?? []);
    let readsFrom = rawNames.length > 0 ? `${rawNames.join("، ")} (مصنف البيانات الخام)` : "مصنف البيانات الخام";
    def.steps.forEach((step) => {
      const name = namer.take(step.label);
      steps.push({ name, kind: "step", datasetId: def.id, stepId: step.id, header: stepHeader(def, step, pd?.steps.find((s) => s.stepId === step.id), readsFrom) });
      readsFrom = name;
    });
    const table = tableNameFor(def);
    const clash = tableKeys.get(excelNameKey(table));
    if (clash !== undefined) {
      ctx.issues.push({ rule: "schema.invalid", path: `datasets[${di}].label`, detail: `table name ${table} repeats` });
    }
    tableKeys.set(excelNameKey(table), di);
    const sheet = namer.take(def.label);
    tables.push({ name: table, sheet, datasetId: def.id, columns: def.columns.map((c) => c.label) });
    const pivot = processedPivot(ctx, def, groups);
    const rawCount = pd?.rawCount ?? 0;
    const after = pd?.rows.length ?? 0;
    sets.push({
      name: sheet, kind: "processed", table, datasetId: def.id, pivots: pivot === undefined ? [] : [pivot],
      header: {
        title: def.label, purpose: `صفوف ${def.label} بعد كل المعالجات، في جدول منظم وبجانبه جدول محوري لمقياسه الرئيسي`,
        readsFrom, rule: def.steps.length > 0 ? "ناتج تطبيق المعالجات بالترتيب على البيانات الخام" : "البيانات الخام نفسها دون معالجة",
        before: rawCount, removed: rawCount - after, after,
      },
    });
  });

  const statPivots = uniquePivotNames(groups.flatMap((g) => {
    const def = spec.datasets.find((d) => d.id === g.datasetId);
    return def === undefined ? [] : [pivotFor(ctx, def, g.field, g.slide, g.keys)];
  }));
  const setRows = sets.reduce((n, s) => n + (s.header?.after ?? 0), 0);
  tables.push({ name: SOURCE_TABLE, sheet: SOURCE_SHEET, columns: [...SOURCE_HEADERS] });
  const report: PlannedSheet[] = [
    {
      name: INDEX_SHEET, kind: "index",
      header: {
        title: spec.title, purpose: "خريطة كل أوراق المصنف بالترتيب، مع رابط لكل ورقة وسطر عما تحويه",
        readsFrom: "مصنف البيانات الخام وأوراق هذا المصنف", rule: "تعرض المعالجات بالترتيب الذي طبقت به",
        before: rawTotal(files),
        removed: 0, after: setRows,
      },
    },
    { name: SEPARATORS[0], kind: "separator" },
    ...steps,
    { name: SEPARATORS[1], kind: "separator" },
    ...sets,
    { name: SEPARATORS[2], kind: "separator" },
    {
      name: STATS_SHEET, kind: "stats", pivots: statPivots,
      header: {
        title: STATS_SHEET, purpose: "كل إحصائيات التقرير: جدول محوري لكل مجموعة، وصيغة إكسل لكل رقم بجانب قيمة المحرك",
        readsFrom: sets.map((s) => s.name).join("، "), rule: "تحسب كل إحصائية بتعريف المقياس نفسه الذي تستخدمه الشرائح",
        before: setRows, removed: 0, after: setRows,
      },
    },
    { name: SEPARATORS[3], kind: "separator" },
    {
      name: SOURCE_SHEET, kind: "source", table: SOURCE_TABLE,
      header: {
        title: SOURCE_SHEET, purpose: "مصدر كل رقم في التقرير: الشريحة والورقة والأعمدة والمرشحات والمقياس والصيغة",
        readsFrom: STATS_SHEET, rule: "صف واحد لكل رقم ظاهر في الشرائح", before: doc.figures.length, removed: 0, after: doc.figures.length,
      },
    },
  ];
  for (const p of report.flatMap((s) => s.pivots ?? [])) checkPivot(ctx, p, tables);
  for (const sh of report) {
    const seen = new Set<string>();
    for (const p of sh.pivots ?? []) {
      const key = excelNameKey(p.name);
      if (seen.has(key)) ctx.issues.push({ rule: "xlsx.names", path: `${sh.name}: pivot`, detail: `${p.name} repeats` });
      seen.add(key);
    }
  }
  const plan: WorkbookPlan = { sheets: report, companion: { sheets: raw.sheets }, tables, issues: ctx.issues };
  plan.issues.push(...visibleNameIssues(plan, spec));
  return plan;
}

const ID_PATTERNS: RegExp[] = [
  /^[a-z]{1,3}\d+$/i,
  /\b[a-z]+(?:_[a-z0-9]+)+\b/i,
  /\b[a-z]+[A-Z][A-Za-z0-9]*\b/,
  /\btbl/i,
  /خطوة\s*\d/,
  /\b(?:pivot|slicer|chart|button)\s*_?\d*\b/i,
];

function knownIds(spec: ReportSpec): Set<string> {
  const ids = [
    spec.reportId,
    ...spec.datasets.flatMap((d) => [d.id, ...d.columns.map((c) => c.id), ...d.steps.map((s) => s.id)]),
    ...spec.model.measures.map((m) => m.id),
    ...spec.pages.flatMap((p) => [p.pageId, ...p.visuals.map((v) => v.visualId)]),
  ];
  return new Set(ids.filter((id) => /[A-Za-z]/.test(id)).map((id) => id.toLowerCase()));
}

/** Every name the engine composes for a reader (raw sheet names and raw headers excluded: they are as uploaded). */
export function visibleNames(plan: WorkbookPlan): { where: string; name: string }[] {
  const out: { where: string; name: string }[] = [];
  const add = (where: string, name: string) => out.push({ where, name });
  for (const s of [...plan.sheets, ...plan.companion.sheets]) {
    if (s.kind === "raw" || s.kind === "separator") continue;
    add("sheet", s.name);
    if (s.header) { add(`${s.name}: title`, s.header.title); add(`${s.name}: purpose`, s.header.purpose); }
    for (const p of s.pivots ?? []) {
      add(`${s.name}: pivot`, p.name); add(`${s.name}: pivot field`, p.rowField); add(`${s.name}: pivot field`, p.dataField);
    }
  }
  for (const t of plan.tables) {
    add("table", t.name);
    for (const c of t.columns) add(`${t.name}: column`, c);
  }
  return out;
}

/** M15: a visible name that looks like an internal id or a numbered step blocks the workbook. */
export function visibleNameIssues(plan: WorkbookPlan, spec: ReportSpec): EngineIssue[] {
  const ids = knownIds(spec);
  return visibleNames(plan)
    .filter(({ name }) => ids.has(name.trim().toLowerCase()) || ID_PATTERNS.some((re) => re.test(name)))
    .map(({ where, name }) => ({ rule: "xlsx.names" as const, path: where, detail: name }));
}

/** Rows of a processed set or removed-rows range, by declared column. */
export function rowsAoa(def: DatasetDef, rows: Record<string, Cell>[]): Cell[][] {
  return rows.map((r) => def.columns.map((c) => (Object.hasOwn(r, c.id) ? (r[c.id] ?? null) : null)));
}
