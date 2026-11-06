import { describe, expect, it } from "vitest";
import { FIXTURE_DATASET, FIXTURE_FILES, twoSlideFixture } from "../__fixtures__/twoSlide";
import { applySteps } from "../data/processing";
import type { Cell } from "../data/types";
import { typeDataset } from "../data/typing";
import type { Expr } from "./ast";
import { evaluateMeasure } from "./evaluate";
import { parseFormula } from "./parse";
import { toExcelFormula } from "./toExcel";
import type { ExcelTarget } from "./toExcel";

type Row = Record<string, Cell>;

const spec = twoSlideFixture().spec;
const scope = { columns: FIXTURE_DATASET.columns, measures: ["studied", "matched", "matchRate"] };
const labelOf = new Map(FIXTURE_DATASET.columns.map((c) => [c.id, c.label]));

function parse(text: string): Expr {
  const r = parseFormula(text, scope, "measure");
  if (!r.ok) throw new Error(`parse failed: ${r.issue.detail ?? ""}`);
  return r.ast;
}

const measures = new Map<string, Expr>();
for (const m of spec.model.measures) measures.set(m.id, parse(m.formula));
measures.set("matched", parse('filter(count([الحالة]), [الحالة] = "مطابق")'));

const target: ExcelTarget = {
  table: "tblStudies",
  columnName: (id) => labelOf.get(id) ?? id,
  columnType: (id) => FIXTURE_DATASET.columns.find((c) => c.id === id)?.type,
  groupFilters: [],
  extraFilters: [],
};

const studiedAst = measures.get("studied")!;
const matchRateAst = measures.get("matchRate")!;

function formulaOf(text: string, t: ExcelTarget = target): string {
  const r = toExcelFormula(parse(text), t, measures);
  if (!r.ok) throw new Error(`not translated: ${r.reason}`);
  return r.formula;
}

/** Test-only interpreter for the emitted subset: IFERROR, IF, COUNTIFS, SUMIFS, AVERAGEIFS, MINIFS, MAXIFS, + - * /. */
function interpretExcel(formula: string, table: Row[]): number | string {
  const idOf = new Map([...labelOf].map(([id, label]) => [label, id]));
  let pos = 0;
  const peek = (): string => formula[pos] ?? "";
  const skipSpaces = (): void => { while (peek() === " ") pos++; };

  function str(): string {
    pos++;
    let out = "";
    for (;;) {
      const ch = formula[pos++];
      if (ch === undefined) throw new Error("unterminated string");
      if (ch === '"') {
        if (peek() === '"') { out += '"'; pos++; continue; }
        return out;
      }
      out += ch;
    }
  }

  function structuredRef(): string {
    const start = pos;
    while (peek() !== "[") pos++;
    pos++;
    const double = peek() === "[";
    if (double) pos++;
    let name = "";
    for (;;) {
      const ch = formula[pos++];
      if (ch === "'") { name += formula[pos++]; continue; }
      if (ch === "]") break;
      name += ch;
    }
    if (double) pos++;
    expect(formula.slice(start, start + 11).startsWith("tblStudies[")).toBe(true);
    const id = idOf.get(name);
    if (id === undefined) throw new Error(`unknown column ${name}`);
    return id;
  }

  function matches(cell: Cell, criterion: string | number): boolean {
    if (typeof criterion === "number") return cell === criterion;
    const m = /^(<>|<=|>=|<|>|=)?([\s\S]*)$/.exec(criterion)!;
    const op = m[1] ?? "=";
    const rest = m[2]!.replace(/~([~*?])/g, "$1");
    if (op === "<>" && rest === "") return cell !== null;
    const num = rest !== "" && !Number.isNaN(Number(rest)) ? Number(rest) : undefined;
    if (cell === null) return op === "<>";
    const cmp = (a: number | string, b: number | string): number => (a < b ? -1 : a > b ? 1 : 0);
    if (num !== undefined) {
      if (typeof cell !== "number") return op === "<>";
      const c = cmp(cell, num);
      return op === "=" ? c === 0 : op === "<>" ? c !== 0 : op === "<" ? c < 0 : op === "<=" ? c <= 0 : op === ">" ? c > 0 : c >= 0;
    }
    if (typeof cell !== "string") return op === "<>";
    const same = cell.toLowerCase() === rest.toLowerCase();
    if (op === "=") return same;
    if (op === "<>") return !same;
    throw new Error("ordered text criteria not supported");
  }

  function ifs(fn: string): number | string {
    // First argument of the non-COUNTIFS forms is the value column.
    let valueCol: string | undefined;
    if (fn !== "COUNTIFS") { valueCol = structuredRef(); skipSpaces(); pos++; }
    const pairs: [string, string | number][] = [];
    for (;;) {
      const col = structuredRef();
      pos++; // comma
      let crit: string | number;
      if (peek() === '"') crit = str();
      else {
        const start = pos;
        while (/[0-9.eE+-]/.test(peek())) pos++;
        const word = formula.slice(start, pos);
        if (word === "") {
          const t = formula.slice(pos, pos + 5);
          if (t.startsWith("TRUE")) { pos += 4; crit = 1; } else { pos += 5; crit = 0; }
        } else crit = Number(word);
      }
      pairs.push([col, crit]);
      if (peek() === ",") { pos++; continue; }
      break;
    }
    pos++; // ")"
    const hit = table.filter((r) => pairs.every(([c, k]) => matches(r[c] ?? null, k)));
    if (fn === "COUNTIFS") return hit.length;
    const xs = hit.map((r) => r[valueCol!]).filter((v): v is number => typeof v === "number");
    if (fn === "SUMIFS") return xs.reduce((a, b) => a + b, 0);
    if (xs.length === 0) return fn === "AVERAGEIFS" ? "#DIV/0!" : 0;
    if (fn === "AVERAGEIFS") return xs.reduce((a, b) => a + b, 0) / xs.length;
    return fn === "MINIFS" ? Math.min(...xs) : Math.max(...xs);
  }

  function operand(): number | string {
    skipSpaces();
    if (peek() === '"') return str();
    if (peek() === "(") { pos++; const v = additive(); pos++; return v; }
    const m = /^[0-9.]+(?:[eE][+-]?[0-9]+)?|^[A-Z]+/.exec(formula.slice(pos));
    if (m === null) throw new Error(`unexpected ${formula.slice(pos, pos + 12)}`);
    pos += m[0].length;
    if (peek() !== "(") return Number(m[0]);
    pos++;
    const fn = m[0];
    if (fn === "IFERROR") {
      const v = tryAdditive();
      pos++; // comma
      const alt = str();
      pos++; // ")"
      return typeof v === "number" || (typeof v === "string" && !v.startsWith("#")) ? v : alt;
    }
    if (fn === "IF") {
      const cond = additive();
      pos++; // comma
      const yes = str();
      pos++;
      const no = additive();
      pos++;
      return cond === 1 ? yes : no;
    }
    return ifs(fn);
  }

  function tryAdditive(): number | string {
    try { return additive(); } catch (e) {
      if (e instanceof RangeError) throw e;
      // skip to the matching top-level comma so the caller can read the fallback
      let depth = 0;
      for (; pos < formula.length; pos++) {
        const ch = formula[pos];
        if (ch === '"') { str(); pos--; continue; }
        if (ch === "(") depth++;
        else if (ch === ")") depth--;
        else if (ch === "," && depth === 0) break;
      }
      return "#VALUE!";
    }
  }

  function num(v: number | string): number {
    if (typeof v !== "number") throw new Error("#VALUE!");
    return v;
  }

  function additive(): number | string {
    let left = multiplicative();
    for (;;) {
      skipSpaces();
      const op = peek();
      if (op !== "+" && op !== "-") {
        if (op === "=") { pos++; const right = multiplicative(); return left === right ? 1 : 0; }
        return left;
      }
      pos++;
      const right = multiplicative();
      left = op === "+" ? num(left) + num(right) : num(left) - num(right);
    }
  }

  function multiplicative(): number | string {
    let left = operand();
    for (;;) {
      const op = peek();
      if (op !== "*" && op !== "/") return left;
      pos++;
      const right = num(operand());
      if (op === "/" && right === 0) throw new Error("#DIV/0!");
      left = op === "*" ? num(left) * right : num(left) / right;
    }
  }

  const result = additive();
  expect(pos).toBe(formula.length);
  return result;
}

const typed = typeDataset(FIXTURE_DATASET, FIXTURE_FILES).data;
const fixtureRows: Row[] = applySteps(typed, FIXTURE_DATASET, twoSlideFixture().params, 0).rows;

describe("toExcelFormula", () => {
  it("matchRate translates to COUNTIFS / COUNTIFS wrapped in IFERROR", () => {
    expect(toExcelFormula(matchRateAst, target, measures)).toEqual({
      ok: true,
      formula: 'IFERROR(COUNTIFS(tblStudies[الحالة],"مطابق")/COUNTIFS(tblStudies[الحالة],"<>"),"-")',
    });
  });

  it("studied translates to a non-empty COUNTIFS", () => {
    expect(toExcelFormula(studiedAst, target, measures)).toEqual({ ok: true, formula: 'COUNTIFS(tblStudies[الحالة],"<>")' });
  });

  it("group filters add criteria pairs", () => {
    const t = { ...target, groupFilters: [{ columnId: "portType", value: "بري" }] };
    expect(toExcelFormula(studiedAst, t, measures)).toEqual({
      ok: true,
      formula: 'COUNTIFS(tblStudies[الحالة],"<>",tblStudies[نوع المنفذ],"بري")',
    });
  });

  it("an equality group filter on the counted column replaces the non-empty criterion", () => {
    const t = { ...target, groupFilters: [{ columnId: "status", value: "مطابق" }] };
    expect(formulaOf("count([الحالة])", t)).toBe('COUNTIFS(tblStudies[الحالة],"مطابق")');
  });

  it("page filters (eq, neq, notNull) become criteria pairs and in is refused", () => {
    const t = { ...target, extraFilters: [{ field: "portType", op: "eq" as const, value: "بحري" }] };
    expect(formulaOf("count([الحالة])", t)).toBe('COUNTIFS(tblStudies[الحالة],"<>",tblStudies[نوع المنفذ],"بحري")');
    const n = { ...target, extraFilters: [{ field: "port", op: "notNull" as const }] };
    expect(formulaOf("count([الحالة])", n)).toBe('COUNTIFS(tblStudies[الحالة],"<>",tblStudies[المنفذ],"<>")');
    const inn = { ...target, extraFilters: [{ field: "port", op: "in" as const, value: ["جدة"] }] };
    const r = toExcelFormula(studiedAst, inn, measures);
    expect(r.ok).toBe(false);
  });

  it("ratio emits the same IFERROR division as /", () => {
    const a = (toExcelFormula(parse("ratio(@matched, @studied)"), target, measures) as { formula: string }).formula;
    const b = (toExcelFormula(parse("@matched / @studied"), target, measures) as { formula: string }).formula;
    expect(a).toMatch(/^IFERROR\(.+\/.+,"-"\)$/);
    expect(a).toBe(b);
  });

  it("a string with a double quote is escaped by doubling", () => {
    const r = toExcelFormula(parse('filter(count([الحالة]), [الحالة] = "م""ب")'), target, measures) as { formula: string };
    expect(r.formula).toContain('"م""ب"');
  });

  it("sum, avg, min and max use the matching IFS functions, comparisons map to operators", () => {
    expect(formulaOf("sum([العدد])")).toBe(
      'IF(COUNTIFS(tblStudies[العدد],"<>")=0,"-",SUMIFS(tblStudies[العدد],tblStudies[العدد],"<>"))');
    expect(formulaOf("avg([العدد])")).toContain("AVERAGEIFS(tblStudies[العدد],");
    expect(formulaOf("min([العدد])")).toContain("MINIFS(");
    expect(formulaOf("max([العدد])")).toContain("MAXIFS(");
    expect(formulaOf('filter(count([الحالة]), [العدد] >= 300 and [العدد] < 600 and [المنفذ] <> "جدة")')).toBe(
      'COUNTIFS(tblStudies[الحالة],"<>",tblStudies[العدد],">=300",tblStudies[العدد],"<600",tblStudies[المنفذ],"<>",tblStudies[المنفذ],"<>جدة")');
  });

  it("a literal on the left flips the operator", () => {
    expect(formulaOf("filter(count([الحالة]), 300 < [العدد])")).toContain('tblStudies[العدد],">300"');
  });

  it("wildcard characters and leading operators in a string are matched literally", () => {
    expect(formulaOf('filter(count([الحالة]), [الحالة] = "م*ب")')).toContain('"م~*ب"');
    expect(formulaOf('filter(count([الحالة]), [الحالة] = "<م")')).toContain('"=<م"');
  });

  it("structured references escape [ ] # ' and bracket special names", () => {
    const t = { ...target, columnName: (id: string) => (id === "status" ? "حالة[1]#'" : (labelOf.get(id) ?? id)) };
    expect(formulaOf("count([الحالة])", t)).toBe("COUNTIFS(tblStudies[[حالة'[1']'#'']],\"<>\")");
    const dot = { ...target, columnName: (id: string) => (id === "status" ? "الحالة.ن" : (labelOf.get(id) ?? id)) };
    expect(formulaOf("count([الحالة])", dot)).toBe('COUNTIFS(tblStudies[[الحالة.ن]],"<>")');
  });

  it("nested filters and measure references inline with the scoped criteria", () => {
    expect(formulaOf('filter(@studied, [المنفذ] = "جدة")')).toBe('COUNTIFS(tblStudies[الحالة],"<>",tblStudies[المنفذ],"جدة")');
  });

  it("a measure that depends on itself is refused", () => {
    const loop = new Map<string, Expr>([["a", { k: "measure", id: "a" }]]);
    const r = toExcelFormula({ k: "measure", id: "a" }, target, loop);
    expect(r.ok).toBe(false);
  });

  it("refuses translations Excel would evaluate differently", () => {
    const refused = (text: string, t: ExcelTarget = target): string => {
      const r = toExcelFormula(parse(text), t, measures);
      expect(r.ok, text).toBe(false);
      const reason = (r as { reason: string }).reason;
      expect(reason.length).toBeGreaterThan(0);
      return reason;
    };
    // 1. ordered comparison of text
    for (const op of ["<", "<=", ">", ">="]) refused(`filter(count([الحالة]), [المنفذ] ${op} "جدة")`);
    // 2. text Excel would coerce
    for (const v of ["5", "1e3", "12%", "1/2/2026", "10:30", "true", "FALSE", "1.5"]) {
      refused(`filter(count([الحالة]), [المنفذ] = "${v}")`);
    }
    // number criterion against an unknown or non-numeric column
    refused("filter(count([الحالة]), [العدد] > 3)", { ...target, columnType: undefined });
    refused("filter(count([الحالة]), [العدد] > 3)", { ...target, columnType: () => "text" });
    refused("count([الحالة])", { ...target, groupFilters: [{ columnId: "count", value: 5 }], columnType: undefined });
    // 3. Latin letters with = or <>
    refused('filter(count([الحالة]), [المنفذ] = "Jeddah")');
    refused('filter(count([الحالة]), [المنفذ] <> "ab")');
    // 4. column labels
    for (const label of ["@x", " x", "x ", ""]) {
      refused("count([الحالة])", { ...target, columnName: (id) => (id === "status" ? label : (labelOf.get(id) ?? id)) });
    }
    // minors: formula length and criteria pair count
    refused("count([الحالة])", { ...target, columnName: (id) => (id === "status" ? "ح".repeat(9000) : (labelOf.get(id) ?? id)) });
    const many = Array.from({ length: 130 }, (_, i) => ({ columnId: "port", value: `م${i}`.replace(/\d/g, "ب") }));
    refused("count([الحالة])", { ...target, groupFilters: many });
  });

  it("still translates Arabic text and numbers on a numeric column", () => {
    expect(formulaOf('filter(count([الحالة]), [العدد] > 300 and [المنفذ] = "جدة")')).toBe(
      'COUNTIFS(tblStudies[الحالة],"<>",tblStudies[العدد],">300",tblStudies[المنفذ],"جدة")');
  });

  it.each([
    "distinctCount([المنفذ])",
    "percentOfTotal(count([الحالة]))",
    'filter(count([الحالة]), [الحالة] = "x" or [الحالة] = "y")',
    'filter(count([الحالة]), not ([الحالة] = "x"))',
    'filter(count([الحالة]), [الحالة] = "")',
    "sum([العدد] + 1)",
  ])("%s returns ok:false with a reason", (text) => {
    const r = toExcelFormula(parse(text), target, measures);
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason.length).toBeGreaterThan(0);
  });

  it("every translatable measure equals the engine value under the test interpreter", () => {
    const texts = [
      "@studied", "@matched", "@matchRate", "ratio(@matched, @studied)", "@matched + @studied * 2",
      "sum([العدد])", "avg([العدد])", "min([العدد])", "max([العدد])", "sum([العدد]) / count([العدد])",
      'filter(sum([العدد]), [الحالة] = "مطابق")', 'filter(avg([العدد]), [الحالة] <> "مطابق")',
      'filter(count([الحالة]), [العدد] > 300 and [نوع المنفذ] = "بري")',
      'filter(sum([العدد]), [الحالة] = "لا يوجد")', 'filter(count([الحالة]), [الحالة] = "لا يوجد")',
      'filter(@matchRate, [المنفذ] = "لا يوجد")',
    ];
    const groups = [[], [{ columnId: "portType", value: "بري" }], [{ columnId: "port", value: "جدة" }],
      [{ columnId: "port", value: "غير موجود" }]];
    const ctx = { measures, allRows: fixtureRows };
    let compared = 0;
    for (const text of texts) {
      for (const groupFilters of groups) {
        const ast = parse(text);
        const r = toExcelFormula(ast, { ...target, groupFilters }, measures);
        expect(r.ok, text).toBe(true);
        if (!r.ok) continue;
        const rows = fixtureRows.filter((row) => groupFilters.every((g) => row[g.columnId] === g.value));
        const engine = evaluateMeasure(ast, rows, ctx) ?? "-";
        expect(interpretExcel(r.formula, fixtureRows), `${text} :: ${r.formula}`).toEqual(engine);
        compared++;
      }
    }
    expect(compared).toBe(texts.length * groups.length);
  });
});
