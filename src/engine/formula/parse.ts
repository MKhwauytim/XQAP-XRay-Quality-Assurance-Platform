import type { ColumnDecl } from "../data/types";
import type { EngineIssue } from "../errors";
import { LIMITS } from "../limits";
import type { MessageKey } from "../messages";
import { ALLOWED_FUNCTIONS, FUNCTION_ARITY } from "./ast";
import type { AllowedFn, BinOp, Expr } from "./ast";

export interface FormulaScope {
  columns: ColumnDecl[];
  measures: string[];
}

export type FormulaLevel = "row" | "measure";

export type ParseResult = { ok: true; ast: Expr } | { ok: false; issue: EngineIssue };

type Tok =
  | { t: "num"; v: number; pos: number }
  | { t: "str"; v: string; pos: number }
  | { t: "bracket"; v: string; pos: number }
  | { t: "ident"; v: string; pos: number }
  | { t: "measure"; v: string; pos: number }
  | { t: "op"; v: string; pos: number }
  | { t: "lp" | "rp" | "comma" | "end"; pos: number };

class FormulaError {
  readonly rule: MessageKey;
  readonly pos: number;
  readonly what: string;
  constructor(rule: MessageKey, pos: number, what: string) {
    this.rule = rule;
    this.pos = pos;
    this.what = what;
  }
}

interface ResolveTables {
  byHeader: Map<string, string>;
  byLabel: Map<string, string>;
  byId: Map<string, string>;
  measures: Set<string>;
}

const IDENT_START = /[A-Za-z_]/;
const IDENT_PART = /[A-Za-z0-9_]/;
const DIGIT = /[0-9]/;
const SPACE = /\s/;
const TWO_CHAR_OPS = new Set(["<>", "<=", ">="]);
const ONE_CHAR_OPS = new Set(["+", "-", "*", "/", "=", "<", ">"]);
const FUNCTION_SET: ReadonlySet<string> = new Set(ALLOWED_FUNCTIONS);

function readIdent(text: string, start: number): number {
  let i = start;
  while (i < text.length && IDENT_PART.test(text[i]!)) i++;
  return i;
}

function readNumber(text: string, start: number): { v: number; end: number } {
  let i = start;
  while (i < text.length && DIGIT.test(text[i]!)) i++;
  if (text[i] === "." && i + 1 < text.length && DIGIT.test(text[i + 1]!)) {
    i++;
    while (i < text.length && DIGIT.test(text[i]!)) i++;
  }
  const v = Number(text.slice(start, i));
  if (!Number.isFinite(v)) throw new FormulaError("formula.syntax", start, "number");
  return { v, end: i };
}

function readString(text: string, start: number): { v: string; end: number } {
  let out = "";
  let i = start + 1;
  for (;;) {
    if (i >= text.length) throw new FormulaError("formula.syntax", start, "unterminated string");
    const c = text[i]!;
    if (c === "\"") {
      if (text[i + 1] === "\"") { out += "\""; i += 2; continue; }
      return { v: out, end: i + 1 };
    }
    out += c;
    i++;
  }
}

function tokenize(text: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (SPACE.test(c)) { i++; continue; }
    const pos = i;
    if (DIGIT.test(c)) {
      const n = readNumber(text, i);
      toks.push({ t: "num", v: n.v, pos });
      i = n.end;
    } else if (c === "\"") {
      const s = readString(text, i);
      toks.push({ t: "str", v: s.v, pos });
      i = s.end;
    } else if (c === "[") {
      const close = text.indexOf("]", i + 1);
      const inner = close < 0 ? "" : text.slice(i + 1, close);
      if (close < 0 || inner.includes("[")) throw new FormulaError("formula.syntax", pos, "bracket");
      toks.push({ t: "bracket", v: inner, pos });
      i = close + 1;
    } else if (c === "@") {
      if (i + 1 >= text.length || !IDENT_START.test(text[i + 1]!)) throw new FormulaError("formula.syntax", pos, "@");
      const end = readIdent(text, i + 1);
      toks.push({ t: "measure", v: text.slice(i + 1, end), pos });
      i = end;
    } else if (IDENT_START.test(c)) {
      const end = readIdent(text, i);
      toks.push({ t: "ident", v: text.slice(i, end), pos });
      i = end;
    } else if (c === "(") { toks.push({ t: "lp", pos }); i++; }
    else if (c === ")") { toks.push({ t: "rp", pos }); i++; }
    else if (c === ",") { toks.push({ t: "comma", pos }); i++; }
    else if (TWO_CHAR_OPS.has(text.slice(i, i + 2))) { toks.push({ t: "op", v: text.slice(i, i + 2), pos }); i += 2; }
    else if (ONE_CHAR_OPS.has(c)) { toks.push({ t: "op", v: c, pos }); i++; }
    else throw new FormulaError("formula.syntax", pos, "character");
  }
  toks.push({ t: "end", pos: text.length });
  return toks;
}

const COMPARE_OPS: ReadonlySet<string> = new Set(["=", "<>", "<", "<=", ">", ">="]);

class Parser {
  private i = 0;
  private depth = 0;
  private readonly toks: Tok[];
  private readonly byHeader: Map<string, string>;
  private readonly byLabel: Map<string, string>;
  private readonly byId: Map<string, string>;
  private readonly measures: Set<string>;
  constructor(toks: Tok[], tables: ResolveTables) {
    this.toks = toks;
    this.byHeader = tables.byHeader;
    this.byLabel = tables.byLabel;
    this.byId = tables.byId;
    this.measures = tables.measures;
  }

  readonly positions = new WeakMap<Expr, number>();
  private at(e: Expr, pos: number): Expr { this.positions.set(e, pos); return e; }
  private peek(): Tok { return this.toks[this.i]!; }
  private next(): Tok { return this.toks[this.i++]!; }
  private isOp(v: string): boolean { const t = this.peek(); return t.t === "op" && t.v === v; }
  private isWord(v: string): boolean { const t = this.peek(); return t.t === "ident" && t.v === v; }
  private expect(kind: "lp" | "rp" | "end"): void {
    const t = this.next();
    if (t.t !== kind) throw new FormulaError("formula.syntax", t.pos, kind);
  }
  private enter(pos: number): void {
    this.depth++;
    if (this.depth > LIMITS.maxFormulaDepth) throw new FormulaError("formula.tooDeep", pos, "depth");
  }

  parseAll(): Expr {
    const e = this.parseOr();
    this.expect("end");
    return e;
  }

  private parseOr(): Expr {
    let l = this.parseAnd();
    while (this.isWord("or")) { const t = this.next(); l = this.at({ k: "bin", op: "or", l, r: this.parseAnd() }, t.pos); }
    return l;
  }

  private parseAnd(): Expr {
    let l = this.parseNot();
    while (this.isWord("and")) { const t = this.next(); l = this.at({ k: "bin", op: "and", l, r: this.parseNot() }, t.pos); }
    return l;
  }

  private parseNot(): Expr {
    if (this.isWord("not")) {
      const t = this.next();
      this.enter(t.pos);
      const e = this.at({ k: "not", e: this.parseNot() }, t.pos);
      this.depth--;
      return e;
    }
    return this.parseCompare();
  }

  private parseCompare(): Expr {
    const l = this.parseAdd();
    const t = this.peek();
    if (t.t === "op" && COMPARE_OPS.has(t.v)) {
      this.next();
      return this.at({ k: "bin", op: t.v as BinOp, l, r: this.parseAdd() }, t.pos);
    }
    return l;
  }

  private parseAdd(): Expr {
    let l = this.parseMul();
    while (this.isOp("+") || this.isOp("-")) {
      const ot = this.next() as { v: string; pos: number };
      l = this.at({ k: "bin", op: ot.v as BinOp, l, r: this.parseMul() }, ot.pos);
    }
    return l;
  }

  private parseMul(): Expr {
    let l = this.parseUnary();
    while (this.isOp("*") || this.isOp("/")) {
      const ot = this.next() as { v: string; pos: number };
      l = this.at({ k: "bin", op: ot.v as BinOp, l, r: this.parseUnary() }, ot.pos);
    }
    return l;
  }

  private parseUnary(): Expr {
    if (this.isOp("-")) {
      const t = this.next();
      this.enter(t.pos);
      const e = this.at({ k: "bin", op: "-", l: { k: "num", v: 0 }, r: this.parseUnary() }, t.pos);
      this.depth--;
      return e;
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Expr {
    const t = this.next();
    switch (t.t) {
      case "num": return this.at({ k: "num", v: t.v }, t.pos);
      case "str": return this.at({ k: "str", v: t.v }, t.pos);
      case "bracket": return this.at({ k: "col", id: this.resolveBracket(t.v, t.pos) }, t.pos);
      case "measure":
        if (!this.measures.has(t.v)) throw new FormulaError("formula.notAllowed", t.pos, `@${t.v}`);
        return this.at({ k: "measure", id: t.v }, t.pos);
      case "lp": {
        this.enter(t.pos);
        const e = this.parseOr();
        this.expect("rp");
        this.depth--;
        return e;
      }
      case "ident": return this.parseIdent(t.v, t.pos);
      default: throw new FormulaError("formula.syntax", t.pos, "unexpected token");
    }
  }

  private resolveBracket(name: string, pos: number): string {
    const id = this.byHeader.get(name) ?? this.byLabel.get(name);
    if (id === undefined) throw new FormulaError("formula.notAllowed", pos, `[${name}]`);
    return id;
  }

  private parseIdent(name: string, pos: number): Expr {
    if (name === "true" || name === "false") return this.at({ k: "bool", v: name === "true" }, pos);
    if (this.peek().t === "lp") {
      if (!FUNCTION_SET.has(name)) throw new FormulaError("formula.notAllowed", pos, name);
      return this.parseCall(name as AllowedFn, pos);
    }
    const id = this.byId.get(name);
    if (id === undefined) throw new FormulaError("formula.notAllowed", pos, name);
    return this.at({ k: "col", id }, pos);
  }

  private parseCall(fn: AllowedFn, pos: number): Expr {
    this.next();
    this.enter(pos);
    const args: Expr[] = [];
    if (this.peek().t !== "rp") {
      args.push(this.parseOr());
      while (this.peek().t === "comma") { this.next(); args.push(this.parseOr()); }
    }
    this.expect("rp");
    this.depth--;
    if (args.length !== FUNCTION_ARITY.get(fn)) throw new FormulaError("formula.notAllowed", pos, `${fn} arity`);
    return this.at({ k: "call", fn, args }, pos);
  }
}

const ARITH_OPS: ReadonlySet<string> = new Set(["+", "-", "*", "/"]);
const ROW_AGGREGATES: ReadonlySet<string> = new Set(["sum", "count", "distinctCount", "avg", "min", "max"]);

type PosOf = (e: Expr) => number;

function reject(e: Expr, at: PosOf, what: string): never {
  throw new FormulaError("formula.notAllowed", at(e), what);
}

/** Arithmetic never takes a string or boolean literal operand. */
function checkArithOperand(e: Expr, at: PosOf): void {
  if (e.k === "str" || e.k === "bool") reject(e, at, "arithmetic on a non-number literal");
}

/** Row level: columns, literals, arithmetic, comparison, logic and if. No aggregate, no measure. */
function checkRow(e: Expr, at: PosOf): void {
  switch (e.k) {
    case "num": case "str": case "bool": case "col": return;
    case "measure": return reject(e, at, "measure at row level");
    case "not": return checkRow(e.e, at);
    case "bin":
      if (ARITH_OPS.has(e.op)) { checkArithOperand(e.l, at); checkArithOperand(e.r, at); }
      checkRow(e.l, at); checkRow(e.r, at); return;
    case "call":
      if (e.fn !== "if") return reject(e, at, e.fn + " at row level");
      for (const a of e.args) checkRow(a, at);
      return;
  }
}

/** Measure level: numbers, measures, arithmetic of measures, and aggregate calls. */
function checkMeasure(e: Expr, at: PosOf): void {
  switch (e.k) {
    case "num": case "measure": return;
    case "bin":
      if (!ARITH_OPS.has(e.op)) return reject(e, at, e.op + " at measure level");
      checkMeasure(e.l, at); checkMeasure(e.r, at); return;
    case "call":
      if (ROW_AGGREGATES.has(e.fn)) return checkRow(e.args[0]!, at);
      if (e.fn === "filter") { checkMeasure(e.args[0]!, at); checkRow(e.args[1]!, at); return; }
      if (e.fn === "ratio" || e.fn === "percentOfTotal") { for (const a of e.args) checkMeasure(a, at); return; }
      return reject(e, at, e.fn + " at measure level");
    default: return reject(e, at, e.k + " at measure level");
  }
}

/** Returns the first measure reference cycle as a path (first id repeated at the end), or null. */
export function findMeasureCycle(measures: Map<string, Expr>): string[] | null {
  const state = new Map<string, "open" | "done">();
  const path: string[] = [];
  const refs = (e: Expr, out: string[]): void => {
    if (e.k === "measure") out.push(e.id);
    else if (e.k === "bin") { refs(e.l, out); refs(e.r, out); }
    else if (e.k === "not") refs(e.e, out);
    else if (e.k === "call") for (const a of e.args) refs(a, out);
  };
  const visit = (id: string): string[] | null => {
    const st = state.get(id);
    if (st === "done") return null;
    if (st === "open") return [...path.slice(path.indexOf(id)), id];
    const def = measures.get(id);
    if (def === undefined) return null;
    state.set(id, "open"); path.push(id);
    const out: string[] = []; refs(def, out);
    for (const r of out) { const c = visit(r); if (c) return c; }
    path.pop(); state.set(id, "done");
    return null;
  };
  for (const id of measures.keys()) { const c = visit(id); if (c) return c; }
  return null;
}

function firstWins(map: Map<string, string>, key: string, id: string): void {
  if (key !== "" && !map.has(key)) map.set(key, id);
}

/** Parses formula text against the declared columns and measures. Never throws. */
export function parseFormula(text: string, scope: FormulaScope, level: FormulaLevel = "measure"): ParseResult {
  if (text.length > LIMITS.maxFormulaLength) {
    return { ok: false, issue: { rule: "formula.tooLong", detail: `position ${LIMITS.maxFormulaLength}: too long` } };
  }
  const byHeader = new Map<string, string>();
  const byLabel = new Map<string, string>();
  const byId = new Map<string, string>();
  for (const c of scope.columns) {
    firstWins(byHeader, c.source.header, c.id);
    firstWins(byLabel, c.label, c.id);
    firstWins(byId, c.id, c.id);
  }
  try {
    const parser = new Parser(tokenize(text), { byHeader, byLabel, byId, measures: new Set(scope.measures) });
    const ast = parser.parseAll();
    const at = (e: Expr): number => parser.positions.get(e) ?? 0;
    if (level === "measure") checkMeasure(ast, at); else checkRow(ast, at);
    return { ok: true, ast };
  } catch (e) {
    if (e instanceof FormulaError) {
      return { ok: false, issue: { rule: e.rule, detail: `position ${e.pos}: ${e.what}` } };
    }
    if (e instanceof RangeError) return { ok: false, issue: { rule: "formula.tooDeep", detail: "position 0: depth" } };
    throw e;
  }
}
