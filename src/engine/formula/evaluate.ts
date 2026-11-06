import type { Cell } from "../data/types";
import type { BinOp, Expr } from "./ast";

export interface MeasureContext {
  measures: Map<string, Expr>;
  allRows: Record<string, Cell>[];
}

type Row = Record<string, Cell>;

function readColumn(row: Row, id: string): Cell {
  return Object.hasOwn(row, id) ? (row[id] ?? null) : null;
}

function arith(op: "+" | "-" | "*" | "/", a: number, b: number): number | null {
  switch (op) {
    case "+": return a + b;
    case "-": return a - b;
    case "*": return a * b;
    case "/": return b === 0 ? null : a / b;
  }
}

function compare(op: BinOp, a: Cell, b: Cell): boolean | null {
  if (a === null || b === null || typeof a !== typeof b) return null;
  switch (op) {
    case "=": return a === b;
    case "<>": return a !== b;
    case "<": return a < b;
    case "<=": return a <= b;
    case ">": return a > b;
    case ">=": return a >= b;
    default: return null;
  }
}

function logic(op: "and" | "or", a: Cell, b: Cell): boolean | null {
  if (typeof a !== "boolean" || typeof b !== "boolean") return null;
  return op === "and" ? a && b : a || b;
}

function applyBin(op: BinOp, a: Cell, b: Cell): Cell {
  if (op === "+" || op === "-" || op === "*" || op === "/") {
    if (typeof a !== "number" || typeof b !== "number") return null;
    return arith(op, a, b);
  }
  if (op === "and" || op === "or") return logic(op, a, b);
  return compare(op, a, b);
}

/** Row-level evaluation for calc steps and filter conditions. Aggregates and measures give null. */
export function evaluateRow(ast: Expr, row: Row): Cell {
  switch (ast.k) {
    case "num":
    case "str":
    case "bool": return ast.v;
    case "col": return readColumn(row, ast.id);
    case "measure": return null;
    case "not": {
      const v = evaluateRow(ast.e, row);
      return typeof v === "boolean" ? !v : null;
    }
    case "bin": return applyBin(ast.op, evaluateRow(ast.l, row), evaluateRow(ast.r, row));
    case "call": {
      if (ast.fn !== "if") return null;
      const c = evaluateRow(ast.args[0]!, row);
      return c === true ? evaluateRow(ast.args[1]!, row) : evaluateRow(ast.args[2]!, row);
    }
  }
}

function numbersOf(arg: Expr, rows: Row[]): number[] {
  const out: number[] = [];
  for (const r of rows) {
    const v = evaluateRow(arg, r);
    if (typeof v === "number" && Number.isFinite(v)) out.push(v);
  }
  return out;
}

function distinctCount(arg: Expr, rows: Row[]): number {
  const seen = new Set<string>();
  for (const r of rows) {
    const v = evaluateRow(arg, r);
    if (v !== null) seen.add(`${typeof v}:${String(v)}`);
  }
  return seen.size;
}

function countNonNull(arg: Expr, rows: Row[]): number {
  let n = 0;
  for (const r of rows) if (evaluateRow(arg, r) !== null) n++;
  return n;
}

function aggregate(fn: "sum" | "avg" | "min" | "max", arg: Expr, rows: Row[]): number | null {
  const xs = numbersOf(arg, rows);
  if (xs.length === 0) return null;
  let acc = fn === "min" ? Infinity : fn === "max" ? -Infinity : 0;
  for (const x of xs) acc = fn === "min" ? Math.min(acc, x) : fn === "max" ? Math.max(acc, x) : acc + x;
  return fn === "avg" ? acc / xs.length : acc;
}

function divide(a: number | null, b: number | null): number | null {
  if (a === null || b === null || b === 0) return null;
  return a / b;
}

function evalCall(ast: Extract<Expr, { k: "call" }>, rows: Row[], ctx: MeasureContext, stack: Set<string>): number | null {
  const a0 = ast.args[0]!;
  switch (ast.fn) {
    case "count": return countNonNull(a0, rows);
    case "distinctCount": return distinctCount(a0, rows);
    case "sum":
    case "avg":
    case "min":
    case "max": return aggregate(ast.fn, a0, rows);
    case "filter": {
      const cond = ast.args[1]!;
      return evalMeasure(a0, rows.filter((r) => evaluateRow(cond, r) === true), ctx, stack);
    }
    case "ratio": return divide(evalMeasure(a0, rows, ctx, stack), evalMeasure(ast.args[1]!, rows, ctx, stack));
    case "percentOfTotal":
      return divide(evalMeasure(a0, rows, ctx, stack), evalMeasure(a0, ctx.allRows, ctx, stack));
    case "if": return null;
  }
}

function evalMeasure(ast: Expr, rows: Row[], ctx: MeasureContext, stack: Set<string>): number | null {
  switch (ast.k) {
    case "num": return ast.v;
    case "measure": {
      const def = ctx.measures.get(ast.id);
      if (def === undefined || stack.has(ast.id)) return null;
      stack.add(ast.id);
      const v = evalMeasure(def, rows, ctx, stack);
      stack.delete(ast.id);
      return v;
    }
    case "bin": {
      if (ast.op !== "+" && ast.op !== "-" && ast.op !== "*" && ast.op !== "/") return null;
      const l = evalMeasure(ast.l, rows, ctx, stack);
      const r = evalMeasure(ast.r, rows, ctx, stack);
      return l === null || r === null ? null : arith(ast.op, l, r);
    }
    case "call": return evalCall(ast, rows, ctx, stack);
    default: return null;
  }
}

/** Evaluates a measure over a set of rows (a whole dataset or one group). C8 empty-set semantics. */
export function evaluateMeasure(ast: Expr, rows: Row[], ctx: MeasureContext): number | null {
  return evalMeasure(ast, rows, ctx, new Set());
}

/** Every column a measure reads, including through referenced measures, in first-seen order. */
export function measureColumns(ast: Expr, measures: Map<string, Expr>): string[] {
  const out = new Set<string>();
  const visited = new Set<string>();
  const walk = (e: Expr): void => {
    switch (e.k) {
      case "col": out.add(e.id); return;
      case "measure": {
        const def = measures.get(e.id);
        if (def !== undefined && !visited.has(e.id)) { visited.add(e.id); walk(def); }
        return;
      }
      case "bin": walk(e.l); walk(e.r); return;
      case "not": walk(e.e); return;
      case "call": for (const a of e.args) walk(a); return;
      default: return;
    }
  };
  walk(ast);
  return [...out];
}
