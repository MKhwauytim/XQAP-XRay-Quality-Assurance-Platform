import type { FilterSpec } from "../data/types";
import type { BinOp, Expr } from "./ast";

export interface ExcelTarget {
  table: string;
  /** Maps a column id to its human Arabic label (owner rule M15). */
  columnName: (columnId: string) => string;
  groupFilters: { columnId: string; value: string | number | boolean }[];
  extraFilters: FilterSpec[];
}

export type ExcelResult = { ok: true; formula: string } | { ok: false; reason: string };

type Scalar = string | number | boolean;
type CmpOp = "=" | "<>" | "<" | "<=" | ">" | ">=";
/** One COUNTIFS-style criteria pair. `equality` marks an equality, which implies non-empty. */
interface Criterion { columnId: string; text: string; equality: boolean }

class Untranslatable extends Error {}
const fail = (reason: string): never => { throw new Untranslatable(reason); };

const SPECIAL_COLUMN_CHARS = /[\t\n\r,:.[\]#'"{}$^&*+=\-<>/()]/;
const NON_EMPTY = '"<>"';

/** Excel structured-reference column: `'` escapes `[ ] # '`; other special characters need double brackets. */
function columnRef(table: string, name: string): string {
  const escaped = name.replace(/[[\]#']/g, (c) => `'${c}`);
  return SPECIAL_COLUMN_CHARS.test(name) ? `${table}[[${escaped}]]` : `${table}[${escaped}]`;
}

const quote = (s: string): string => `"${s.replace(/"/g, '""')}"`;

function numberText(n: number): string {
  if (!Number.isFinite(n)) return fail("عدد غير محدود لا يترجم إلى صيغة إكسل");
  return String(n);
}

/** Escapes COUNTIFS wildcard characters so the string matches literally. */
const literal = (s: string): string => s.replace(/[~*?]/g, (c) => `~${c}`);

/** The criteria argument for `column op value`, as it appears in the formula text. */
function criterionArg(op: CmpOp, v: Scalar): string {
  if (typeof v === "boolean") {
    if (op !== "=" && op !== "<>") return fail("مقارنة ترتيبية على قيمة منطقية لا تترجم إلى صيغة إكسل");
    const word = v ? "TRUE" : "FALSE";
    return op === "=" ? word : quote(`<>${word}`);
  }
  if (typeof v === "number") return op === "=" ? numberText(v) : quote(`${op}${numberText(v)}`);
  if (v === "") return fail("المقارنة بنص فارغ لا تترجم إلى صيغة إكسل");
  const text = literal(v);
  if (op === "=") return quote(/^[<>=]/.test(text) ? `=${text}` : text);
  return quote(`${op}${text}`);
}

/** A comparison as criteria. A not-equal also matches empty cells in Excel while the engine does not, so it adds a non-empty pair. */
function compareCriteria(columnId: string, op: CmpOp, v: Scalar): Criterion[] {
  const main: Criterion = { columnId, text: criterionArg(op, v), equality: op === "=" };
  return op === "<>" ? [{ columnId, text: NON_EMPTY, equality: false }, main] : [main];
}

function flip(op: CmpOp): CmpOp {
  switch (op) {
    case "<": return ">";
    case "<=": return ">=";
    case ">": return "<";
    case ">=": return "<=";
    default: return op;
  }
}

const isCmp = (op: BinOp): op is CmpOp => op === "=" || op === "<>" || op === "<" || op === "<=" || op === ">" || op === ">=";

function scalarOf(e: Expr): Scalar | undefined {
  return e.k === "num" || e.k === "str" || e.k === "bool" ? e.v : undefined;
}

const SIMPLE_ONLY = "شرط التصفية يقبل مقارنات بسيطة مرتبطة بـ and فقط";

function conditionCriteria(cond: Expr): Criterion[] {
  if (cond.k !== "bin") return fail(SIMPLE_ONLY);
  if (cond.op === "and") return [...conditionCriteria(cond.l), ...conditionCriteria(cond.r)];
  if (!isCmp(cond.op)) return fail(SIMPLE_ONLY);
  let op: CmpOp = cond.op;
  let col = cond.l;
  let val = cond.r;
  if (col.k !== "col") { col = cond.r; val = cond.l; op = flip(op); }
  const v = scalarOf(val);
  if (col.k !== "col" || v === undefined) return fail("شرط التصفية يجب أن يقارن عموداً بقيمة ثابتة");
  return compareCriteria(col.id, op, v);
}

function filterSpecCriteria(f: FilterSpec): Criterion[] {
  if (f.op === "notNull") return [{ columnId: f.field, text: NON_EMPTY, equality: false }];
  if (f.op === "in") return fail("مرشح in لا يترجم إلى صيغة إكسل");
  const v = f.value;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
    return compareCriteria(f.field, f.op === "eq" ? "=" : "<>", v);
  }
  return fail("قيمة المرشح غير ثابتة ولا تترجم إلى صيغة إكسل");
}

const ARITH_OPS = new Set<BinOp>(["+", "-", "*", "/"]);
const AGG: Record<string, string> = { sum: "SUMIFS", avg: "AVERAGEIFS", min: "MINIFS", max: "MAXIFS" };

class Translator {
  private readonly stack = new Set<string>();
  private readonly t: ExcelTarget;
  private readonly measures: Map<string, Expr>;

  constructor(t: ExcelTarget, measures: Map<string, Expr>) {
    this.t = t;
    this.measures = measures;
  }

  private ref(columnId: string): string {
    return columnRef(this.t.table, this.t.columnName(columnId));
  }

  private base(): Criterion[] {
    const group = this.t.groupFilters.map((g) => ({ columnId: g.columnId, text: criterionArg("=", g.value), equality: true }));
    return [...group, ...this.t.extraFilters.flatMap(filterSpecCriteria)];
  }

  private pairs(columnId: string, scoped: Criterion[]): string {
    const all = [...scoped, ...this.base()];
    const covered = all.some((c) => c.columnId === columnId && c.equality);
    const list = covered ? all : [{ columnId, text: NON_EMPTY, equality: false }, ...all];
    return list.map((c) => `${this.ref(c.columnId)},${c.text}`).join(",");
  }

  private aggregate(fn: string, arg: Expr, scoped: Criterion[]): string {
    if (arg.k !== "col") return fail("التجميع على تعبير غير عمود لا يترجم إلى صيغة إكسل");
    const pairs = this.pairs(arg.id, scoped);
    if (fn === "count") return `COUNTIFS(${pairs})`;
    const call = `${AGG[fn]}(${this.ref(arg.id)},${pairs})`;
    // Engine semantics: an aggregate over no values is empty and shows "-"; Excel would give 0 or an error.
    return fn === "avg" ? `IFERROR(${call},"-")` : `IF(COUNTIFS(${pairs})=0,"-",${call})`;
  }

  expr(e: Expr, scoped: Criterion[]): string {
    switch (e.k) {
      case "num": return e.v < 0 ? `(${numberText(e.v)})` : numberText(e.v);
      case "measure": {
        const def = this.measures.get(e.id);
        if (def === undefined) return fail(`المقياس ${e.id} غير معرّف`);
        if (this.stack.has(e.id)) return fail(`المقياس ${e.id} يعتمد على نفسه`);
        this.stack.add(e.id);
        try { return this.expr(def, scoped); } finally { this.stack.delete(e.id); }
      }
      case "bin":
        if (!ARITH_OPS.has(e.op)) return fail("هذا المعامل لا يترجم إلى صيغة إكسل خارج شرط التصفية");
        return `IFERROR(${this.expr(e.l, scoped)}${e.op}${this.expr(e.r, scoped)},"-")`;
      case "call": return this.call(e, scoped);
      case "not": return fail("not لا تترجم إلى صيغة إكسل");
      default: return fail("هذا التعبير لا يترجم إلى صيغة إكسل");
    }
  }

  private call(e: Extract<Expr, { k: "call" }>, scoped: Criterion[]): string {
    const [a, b] = e.args;
    switch (e.fn) {
      case "count":
      case "sum":
      case "avg":
      case "min":
      case "max": return this.aggregate(e.fn, a!, scoped);
      case "ratio": return `IFERROR(${this.expr(a!, scoped)}/${this.expr(b!, scoped)},"-")`;
      case "filter": return this.expr(a!, [...scoped, ...conditionCriteria(b!)]);
      case "distinctCount": return fail("distinctCount لا يترجم إلى صيغة إكسل في هذه المرحلة");
      case "percentOfTotal": return fail("percentOfTotal لا يترجم إلى صيغة إكسل في هذه المرحلة");
      case "if": return fail("if لا تترجم إلى صيغة إكسل في هذه المرحلة");
    }
  }
}

/** Translates a measure AST to an Excel formula (no leading `=`), or says why it cannot be done faithfully. */
export function toExcelFormula(ast: Expr, target: ExcelTarget, measures: Map<string, Expr>): ExcelResult {
  try {
    return { ok: true, formula: new Translator(target, measures).expr(ast, []) };
  } catch (err) {
    if (err instanceof Untranslatable) return { ok: false, reason: err.message };
    throw err;
  }
}
