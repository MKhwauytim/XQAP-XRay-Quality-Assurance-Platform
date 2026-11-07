import { describe, expect, it } from "vitest";
import { FIXTURE_DATASET } from "../__fixtures__/twoSlide";
import type { Cell } from "../data/types";
import type { Expr } from "./ast";
import { evaluateMeasure, evaluateRow, measureColumns } from "./evaluate";
import type { MeasureContext } from "./evaluate";
import { findMeasureCycle, parseFormula } from "./parse";

const scope = { columns: FIXTURE_DATASET.columns, measures: ["studied", "matched"] };
const COUNT = "[العدد]";
const PORT = "[المنفذ]";

function p(text: string, level: "row" | "measure" = "measure"): Expr {
  const r = parseFormula(text, scope, level);
  if (!r.ok) throw new Error(`parse failed: ${r.issue.detail ?? ""}`);
  return r.ast;
}

function ev(text: string, rows: Record<string, Cell>[], over: Partial<MeasureContext> = {}): number | null {
  return evaluateMeasure(p(text), rows, { measures: new Map(), allRows: rows, ...over });
}

const rows: Record<string, Cell>[] = [
  { count: 2, port: "أ" }, { count: 4, port: "ب" }, { count: null, port: "ب" },
];

describe("evaluateMeasure", () => {
  it("evaluates count, sum, avg, distinctCount, percentOfTotal over rows", () => {
    expect(ev(`count(${COUNT})`, rows)).toBe(2);
    expect(ev(`sum(${COUNT})`, rows)).toBe(6);
    expect(ev(`avg(${COUNT})`, rows)).toBe(3);
    expect(ev(`distinctCount(${PORT})`, rows)).toBe(2);
    expect(ev(`percentOfTotal(sum(${COUNT}))`, rows.slice(0, 1), { allRows: rows })).toBeCloseTo(1 / 3, 10);
  });

  it("evaluates min and max skipping nulls", () => {
    expect(ev(`min(${COUNT})`, rows)).toBe(2);
    expect(ev(`max(${COUNT})`, rows)).toBe(4);
  });

  it("empty sets: counts give 0, other aggregates and division give null", () => {
    expect(ev(`count(${COUNT})`, [])).toBe(0);
    expect(ev(`distinctCount(${PORT})`, [])).toBe(0);
    expect(ev(`sum(${COUNT})`, [])).toBeNull();
    expect(ev(`avg(${COUNT})`, [])).toBeNull();
    expect(ev(`min(${COUNT})`, [])).toBeNull();
    expect(ev(`max(${COUNT})`, [])).toBeNull();
    expect(ev(`sum(${COUNT}) / count(${COUNT})`, [])).toBeNull();
    expect(ev(`ratio(sum(${COUNT}), count(${COUNT}))`, [])).toBeNull();
    expect(ev(`percentOfTotal(sum(${COUNT}))`, [], { allRows: [] })).toBeNull();
  });

  it("evaluates per group when given the group's rows", () => {
    const b = rows.filter((r) => r.port === "ب");
    expect(ev(`sum(${COUNT})`, b)).toBe(4);
  });

  it("filter narrows the rows and ratio divides two measures", () => {
    const measures = new Map<string, Expr>([["studied", p(`count(${PORT})`)]]);
    expect(ev(`filter(count(${PORT}), ${PORT} = "ب") / @studied`, rows, { measures })).toBeCloseTo(2 / 3, 10);
    expect(ev(`ratio(filter(count(${PORT}), ${PORT} = "أ"), @studied)`, rows, { measures })).toBeCloseTo(1 / 3, 10);
  });

  it("findMeasureCycle reports a cycle path; the evaluator guard still returns null", () => {
    const measures = new Map<string, Expr>([["studied", p("@matched + 1")], ["matched", p("@studied * 2")]]);
    expect(findMeasureCycle(measures)).toEqual(["studied", "matched", "studied"]);
    expect(findMeasureCycle(new Map([["studied", p(`count(${PORT})`)]]))).toBeNull();
    expect(ev("@studied", rows, { measures })).toBeNull();
  });
});

describe("evaluateRow", () => {
  it("computes arithmetic, comparisons and if per row", () => {
    expect(evaluateRow(p(`${COUNT} * 10`, "row"), { count: 3 })).toBe(30);
    expect(evaluateRow(p(`if(${COUNT} > 2, "big", "small")`, "row"), { count: 3 })).toBe("big");
    expect(evaluateRow(p(`${COUNT} / 0`, "row"), { count: 3 })).toBeNull();
    expect(evaluateRow(p(`${COUNT} + 1`, "row"), { count: null })).toBeNull();
    expect(evaluateRow(p("-2 + 5", "row"), {})).toBe(3);
  });
});

describe("measureColumns", () => {
  it("collects columns through referenced measures", () => {
    const measures = new Map<string, Expr>([["matched", p(`filter(count(${PORT}), [الحالة] = "x")`)]]);
    expect(measureColumns(p(`sum(${COUNT}) / @matched`), measures)).toEqual(["count", "port", "status"]);
  });
});
