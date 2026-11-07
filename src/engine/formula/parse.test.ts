import { describe, expect, it } from "vitest";
import { FIXTURE_DATASET } from "../__fixtures__/twoSlide";
import { parseFormula } from "./parse";

const fixtureColumns = FIXTURE_DATASET.columns;
const scope = { columns: fixtureColumns, measures: ["studied"] };

describe("parseFormula", () => {
  it("parses a ratio with a filter", () => {
    const r = parseFormula("filter(count([الحالة]), [الحالة] = \"مطابق\") / @studied", scope);
    expect(r.ok && r.ast).toMatchObject({ k: "bin", op: "/", r: { k: "measure", id: "studied" } });
  });

  it("brackets resolve by header then label; the AST stores the id", () => {
    const r = parseFormula("count([الحالة])", scope);
    expect(r.ok && r.ast).toEqual({ k: "call", fn: "count", args: [{ k: "col", id: "status" }] });
  });

  it("a header match wins over another column's label", () => {
    const cols = [
      { ...fixtureColumns[0]!, id: "a", label: "X", source: { ...fixtureColumns[0]!.source, header: "Y" } },
      { ...fixtureColumns[1]!, id: "b", label: "Y", source: { ...fixtureColumns[1]!.source, header: "Z" } },
    ];
    const r = parseFormula("count([Y]) + count([X])", { columns: cols, measures: [] });
    expect(r.ok && r.ast).toMatchObject({ l: { args: [{ id: "a" }] }, r: { args: [{ id: "a" }] } });
  });

  it("bare identifiers resolve by column id", () => {
    const r = parseFormula("sum(count)", scope);
    expect(r.ok && r.ast).toEqual({ k: "call", fn: "sum", args: [{ k: "col", id: "count" }] });
  });

  it("reads Excel-style doubled quotes inside strings", () => {
    const r = parseFormula("\"a\"\"b\"", scope, "row");
    expect(r.ok && r.ast).toEqual({ k: "str", v: "a\"b" });
  });

  it("applies precedence: multiplication before addition, comparison before and", () => {
    const r = parseFormula("1 + 2 * 3", scope);
    expect(r.ok && r.ast).toMatchObject({ op: "+", r: { op: "*" } });
    const b = parseFormula("1 < 2 and not 3 = 4", scope, "row");
    expect(b.ok && b.ast).toMatchObject({ op: "and", l: { op: "<" }, r: { k: "not", e: { op: "=" } } });
  });

  it("reports the character position of an unknown function", () => {
    const r = parseFormula("1 + foo(2)", scope);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issue.rule).toBe("formula.notAllowed");
      expect(r.issue.detail).toContain("position 4");
    }
  });

  it("rejects text over the length limit before tokenizing", () => {
    const r = parseFormula("1".repeat(5000), scope);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issue.rule).toBe("formula.tooLong");
      expect(r.issue.detail).toContain("too long");
    }
  });

  it.each([
    ["count(sum(count))", 6], ["count(@studied)", 6], ["distinctCount(@studied)", 14],
    ["filter(count(count), sum(count) > 1)", 21], ["sum(@studied)", 4],
    ["1 < 2", 2], ["count(count) > 1", 13], ["\"a\"", 0], ["true", 0], ["count", 0],
    ["if(count > 1, 1, 0)", 0], ["sum(if(count > 1, @studied, 0))", 18],
    ["\"a\" + 1", 0], ["not @studied", 0],
  ])("measure level rejects %s at position %i", (text, pos) => {
    const r = parseFormula(text, scope);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issue.rule).toBe("formula.notAllowed");
      expect(r.issue.detail).toMatch(new RegExp(`^position ${pos}:`));
    }
  });

  it.each(["sum(count)", "@studied", "count(count) + 1"])("row level rejects %s", (text) => {
    const r = parseFormula(text, scope, "row");
    expect(!r.ok && r.issue.rule).toBe("formula.notAllowed");
  });

  it("row level accepts if, compare and logic; arithmetic on a string literal is rejected", () => {
    expect(parseFormula('if(count > 1 and not count = 3, "y", "n")', scope, "row").ok).toBe(true);
    const r = parseFormula('"a" + 1', scope, "row");
    expect(!r.ok && r.issue.rule).toBe("formula.notAllowed");
  });

  it("measure level accepts nested measure functions", () => {
    const r = parseFormula("ratio(filter(sum(count), count > 1), percentOfTotal(count(count))) - @studied", scope);
    expect(r.ok).toBe(true);
  });
});
