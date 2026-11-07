import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FIXTURE_DATASET } from "../__fixtures__/twoSlide";
import type { ColumnDecl, ColumnType } from "../data/types";
import { LIMITS } from "../limits";
import type { Expr } from "./ast";
import { evaluateMeasure } from "./evaluate";
import { parseFormula } from "./parse";

const fixtureColumns = FIXTURE_DATASET.columns;
const scope = { columns: fixtureColumns, measures: ["studied"] };
const ctx = { measures: new Map<string, Expr>(), allRows: [] };
const STATUS = "[الحالة]";

function decl(o: { id: string; header: string; type: ColumnType }): ColumnDecl {
  return {
    source: { file: "f.xlsx", sheet: "s", header: o.header }, id: o.id, label: o.header, type: o.type,
    role: o.type === "number" ? "measure" : "dimension", level: o.type === "number" ? "quantitative" : "nominal",
  };
}

function longValidFormula(n: number): string {
  const term = `count(${STATUS})`;
  let out = term;
  while (out.length + 3 + term.length <= n) out += ` + ${term}`;
  return out;
}

function readFile(rel: string): string {
  return readFileSync(resolve(__dirname, "..", "..", "..", rel), "utf8");
}

describe("hostile formula input", () => {
  it.each([
    "constructor", "__proto__", `${STATUS}.constructor`, "toString()", "eval(\"1\")", "Function(\"x\")",
    "process.exit()", "sum(", `sum(${STATUS}`, "1 +* 2", "\"unterminated", "[عمود غير معلن]",
    "@unknownMeasure", "1e309", "١٢٣", "sum(".repeat(40) + "1" + ")".repeat(40), "x".repeat(LIMITS.maxFormulaLength + 1),
    "a; b", "a ? b : c", "`x`", "[a]]", "if(1,2)", "((((".repeat(20) + "1" + "))))".repeat(20), "hasOwnProperty",
  ])("rejects %s with a position and no throw", (text) => {
    const r = parseFormula(text, scope);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(["formula.syntax", "formula.notAllowed", "formula.tooDeep", "formula.tooLong"]).toContain(r.issue.rule);
      expect(r.issue.detail).toMatch(/^position \d+/);
    }
  });

  it("1e309 is a syntax error at the exponent", () => {
    const r = parseFormula("1e309", scope);
    expect(!r.ok && r.issue).toMatchObject({ rule: "formula.syntax", detail: expect.stringMatching(/^position 1:/) });
  });

  it("deep nesting gives formula.tooDeep", () => {
    const r = parseFormula("sum(".repeat(40) + "1" + ")".repeat(40), scope);
    expect(!r.ok && r.issue.rule).toBe("formula.tooDeep");
  });

  it("never reads Object.prototype: a column named 'constructor' declared by the user is a normal column", () => {
    const s = { columns: [...fixtureColumns, decl({ id: "constructor", header: "constructor", type: "number" })], measures: [] };
    const r = parseFormula("sum(constructor)", s);
    expect(r.ok).toBe(true);
    expect(evaluateMeasure((r as { ast: Expr }).ast, [{ constructor: 5 }], ctx)).toBe(5);
  });

  it("a row without the column does not fall back to an inherited property", () => {
    const s = { columns: [decl({ id: "toString", header: "toString", type: "number" })], measures: [] };
    const r = parseFormula("count(toString)", s);
    expect(r.ok).toBe(true);
    expect(evaluateMeasure((r as { ast: Expr }).ast, [{}, {}], ctx)).toBe(0);
  });

  it("parses a 2,000-char valid formula in under 50 ms", () => {
    const text = longValidFormula(LIMITS.maxFormulaLength);
    expect(text.length).toBeLessThanOrEqual(LIMITS.maxFormulaLength);
    const t0 = performance.now();
    const r = parseFormula(text, scope);
    expect(r.ok).toBe(true);
    expect(performance.now() - t0).toBeLessThan(50);
  });

  it("source contains no eval and no new Function", () => {
    const src = readFile("src/engine/formula/evaluate.ts") + readFile("src/engine/formula/parse.ts");
    expect(src.length).toBeGreaterThan(1000);
    expect(src).not.toMatch(/\beval\s*\(|new\s+Function/);
  });
});
