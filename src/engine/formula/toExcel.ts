import type { ColumnType, FilterSpec } from "../data/types";
import type { BinOp, Expr } from "./ast";

export interface ExcelTarget {
  table: string;
  /** Maps a column id to its human Arabic label (owner rule M15). */
  columnName: (columnId: string) => string;
  /** Declared column types. A number criterion is only translated against a column known to be numeric. */
  columnType?: (columnId: string) => ColumnType | undefined;
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
const MAX_FORMULA_LENGTH = 8192;
const MAX_CRITERIA_PAIRS = 127;

/** Excel structured-reference column: `'` escapes `[ ] # '`; other special characters need double brackets. */
function columnRef(table: string, name: string): string {
  if (name === "" || name !== name.trim() || name.startsWith("@")) {
    return fail("اسم العمود فارغ أو يبدأ بـ @ أو يحمل مسافات في طرفيه فلا يترجم إلى مرجع إكسل");
  }
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

const COERCIBLE = [
  /^[+-]?[\d.,]+(?:e[+-]?\d+)?$/i,
  /%\s*$/,
  /\d\s*[/:.-]\s*\d/,
  /^(true|false)$/i,
  /^\(\s*[+-]?[\d.,]+\s*\)$/,
  /^\s*(?:[$€£¥﷼]|ر\.\s*س)\s*[+-]?[\d.,]/,
  /[\d.,]\s*(?:[$€£¥﷼]|ر\.\s*س)\s*$/,
];

/** Arabic-Indic and Persian digits and separators to the ASCII Excel reads. */
function asciiDigits(text: string): string {
  return text
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x6f0))
    .replace(/٪/g, "%")
    .replace(/٫/g, ".")
    .replace(/٬/g, ",");
}

/** True when Excel would read this text criterion as a number, percentage, date, time, boolean or currency. */
function excelCoerces(text: string): boolean {
  const t = asciiDigits(text).trim();
  return (t !== "" && Number.isFinite(Number(t))) || COERCIBLE.some((re) => re.test(t));
}

/** The criteria argument for `column op value`, as it appears in the formula text. */
function criterionArg(op: CmpOp, v: Scalar, numeric: boolean): string {
  if (typeof v === "boolean") {
    if (op !== "=" && op !== "<>") return fail("مقارنة ترتيبية على قيمة منطقية لا تترجم إلى صيغة إكسل");
    const word = v ? "TRUE" : "FALSE";
    return op === "=" ? word : quote(`<>${word}`);
  }
  if (typeof v === "number") {
    if (!numeric) return fail("المقارنة بعدد على عمود غير معروف أنه رقمي لا تترجم إلى صيغة إكسل");
    return op === "=" ? numberText(v) : quote(`${op}${numberText(v)}`);
  }
  if (v === "") return fail("المقارنة بنص فارغ لا تترجم إلى صيغة إكسل");
  if (op !== "=" && op !== "<>") return fail("المقارنة الترتيبية بنص لا تترجم إلى صيغة إكسل");
  if (/[A-Za-z]/.test(v)) return fail("المقارنة بنص لاتيني تتجاهل إكسل حالة أحرفه فلا تترجم إلى صيغة إكسل");
  if (excelCoerces(v)) return fail("نص يفسره إكسل كعدد أو تاريخ أو وقت أو قيمة منطقية فلا يترجم إلى صيغة إكسل");
  const text = literal(v);
  if (op === "=") return quote(/^[<>=]/.test(text) ? `=${text}` : text);
  return quote(`<>${text}`);
}

/** A comparison as criteria. A not-equal also matches empty cells in Excel while the engine does not, so it adds a non-empty pair. */
function compareCriteria(columnId: string, op: CmpOp, v: Scalar, numeric: boolean): Criterion[] {
  const main: Criterion = { columnId, text: criterionArg(op, v, numeric), equality: op === "=" };
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

type IsNum = (columnId: string) => boolean;
const SIMPLE_ONLY = "شرط التصفية يقبل مقارنات بسيطة مرتبطة بـ and فقط";

function conditionCriteria(cond: Expr, isNum: IsNum): Criterion[] {
  if (cond.k !== "bin") return fail(SIMPLE_ONLY);
  if (cond.op === "and") return [...conditionCriteria(cond.l, isNum), ...conditionCriteria(cond.r, isNum)];
  if (!isCmp(cond.op)) return fail(SIMPLE_ONLY);
  let op: CmpOp = cond.op;
  let col = cond.l;
  let val = cond.r;
  if (col.k !== "col") { col = cond.r; val = cond.l; op = flip(op); }
  const v = scalarOf(val);
  if (col.k !== "col" || v === undefined) return fail("شرط التصفية يجب أن يقارن عموداً بقيمة ثابتة");
  return compareCriteria(col.id, op, v, isNum(col.id));
}

function filterSpecCriteria(f: FilterSpec, isNum: IsNum): Criterion[] {
  if (f.op === "notNull") return [{ columnId: f.field, text: NON_EMPTY, equality: false }];
  if (f.op === "in") return fail("مرشح in لا يترجم إلى صيغة إكسل");
  const v = f.value;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
    return compareCriteria(f.field, f.op === "eq" ? "=" : "<>", v, isNum(f.field));
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

  private isNum(columnId: string): boolean {
    return this.t.columnType?.(columnId) === "number";
  }

  private base(): Criterion[] {
    const group = this.t.groupFilters.map((g) => ({
      columnId: g.columnId, text: criterionArg("=", g.value, this.isNum(g.columnId)), equality: true,
    }));
    return [...group, ...this.t.extraFilters.flatMap((f) => filterSpecCriteria(f, (c) => this.isNum(c)))];
  }

  private pairs(columnId: string, scoped: Criterion[]): string {
    const all = [...scoped, ...this.base()];
    const covered = all.some((c) => c.columnId === columnId && c.equality);
    const list = covered ? all : [{ columnId, text: NON_EMPTY, equality: false }, ...all];
    if (list.length > MAX_CRITERIA_PAIRS) return fail("عدد شروط الصيغة يتجاوز حد إكسل");
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
      case "filter": return this.expr(a!, [...scoped, ...conditionCriteria(b!, (c) => this.isNum(c))]);
      case "distinctCount": return fail("distinctCount لا يترجم إلى صيغة إكسل في هذه المرحلة");
      case "percentOfTotal": return fail("percentOfTotal لا يترجم إلى صيغة إكسل في هذه المرحلة");
      case "if": return fail("if لا تترجم إلى صيغة إكسل في هذه المرحلة");
    }
  }
}

/** Translates a measure AST to an Excel formula (no leading `=`), or says why it cannot be done faithfully. */
export function toExcelFormula(ast: Expr, target: ExcelTarget, measures: Map<string, Expr>): ExcelResult {
  try {
    const formula = new Translator(target, measures).expr(ast, []);
    if (formula.length > MAX_FORMULA_LENGTH) return { ok: false, reason: "طول الصيغة يتجاوز حد إكسل" };
    return { ok: true, formula };
  } catch (err) {
    if (err instanceof Untranslatable) return { ok: false, reason: err.message };
    throw err;
  }
}
