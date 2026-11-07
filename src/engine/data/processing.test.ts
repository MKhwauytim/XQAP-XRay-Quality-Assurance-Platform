import { describe, expect, it } from "vitest";
import { FIXTURE_DATASET, FIXTURE_FILES, twoSlideFixture } from "../__fixtures__/twoSlide";
import type { DatasetDef } from "./types";
import { applySteps } from "./processing";
import { typeDataset } from "./typing";

const params = twoSlideFixture().params;
const { data: typed } = typeDataset(FIXTURE_DATASET, FIXTURE_FILES);

function withCalc(formula: string): DatasetDef {
  const d = structuredClone(FIXTURE_DATASET);
  d.columns.push({
    source: { file: "studies.xlsx", sheet: "نتائج الدراسة", header: "" },
    id: "flag", label: "علامة", type: "boolean", role: "dimension", level: "nominal",
  });
  d.steps.push({ id: "s3", label: "حساب", kind: "calc", calc: { columnId: "flag", type: "boolean", formula } });
  return d;
}

describe("applySteps", () => {
  it("each step reconciles: inCount - removed = outCount, and the chain ends at rows.length", () => {
    const p = applySteps(typed, FIXTURE_DATASET, params);
    p.steps.forEach((s) => expect(s.inCount - s.removed).toBe(s.outCount));
    expect(p.steps.at(-1)!.outCount).toBe(p.rows.length);
    expect(p.rawCount).toBe(12);
    expect(p.steps.map((s) => [s.stepId, s.removed, s.removedRows.length])).toEqual([["s1", 1, 1], ["s2", 1, 1]]);
  });

  it("the fixture facts hold: 10 rows, 7 matched, 4 بحري and 6 بري", () => {
    const p = applySteps(typed, FIXTURE_DATASET, params);
    expect(p.rows).toHaveLength(10);
    expect(p.rows.filter((r) => r.status === "مطابق")).toHaveLength(7);
    expect(p.rows.filter((r) => r.portType === "بحري")).toHaveLength(4);
    expect(p.rows.filter((r) => r.portType === "بري")).toHaveLength(6);
    expect(p.issues).toEqual([]);
  });

  it("s1 removes the empty-status row and s2 the later duplicate, keeping the first", () => {
    const p = applySteps(typed, FIXTURE_DATASET, params);
    expect(p.steps[0].removedRows[0]).toMatchObject({ port: "البطحاء", status: null });
    expect(p.steps[1].removedRows[0]).toMatchObject({ port: "جدة", count: 600 });
    expect(p.rows.filter((r) => r.count === 600)).toHaveLength(1);
  });

  it("dedupe never merges two errored cells with different raw text", () => {
    const d = structuredClone(FIXTURE_DATASET);
    d.steps = [{ id: "d", label: "تكرار", kind: "dedupe", key: ["count"] }];
    const p = applySteps(typed, d, params);
    // 12 rows: errored "غير متوفر" and "12,5" stay distinct from each other and from the true empty cell.
    expect(p.steps[0].removed).toBe(2);
  });

  it("caps removedRows and flags truncation", () => {
    const many = { id: "studies", rows: Array.from({ length: 5 }, () => ({ port: null, portType: null, status: null, count: null })), errors: [] };
    const p = applySteps(many, FIXTURE_DATASET, params, 0, 3);
    expect(p.steps[0]).toMatchObject({ removed: 5, removedRowsTruncated: true });
    expect(p.steps[0].removedRows).toHaveLength(3);
  });

  it("a calc step adds a typed column and removes nothing", () => {
    const p = applySteps(typed, withCalc('[الحالة] = "مطابق"'), params);
    expect(p.steps[2]).toMatchObject({ stepId: "s3", removed: 0, outCount: 10 });
    expect(p.rows.filter((r) => r.flag === true)).toHaveLength(7);
    expect(p.issues).toEqual([]);
  });

  it("a calc step with an aggregate such as sum(...) is rejected at row level", () => {
    const d = withCalc("sum([العدد]) > 1");
    const p = applySteps(typed, d, params);
    expect(p.issues).toHaveLength(1);
    expect(p.issues[0].rule).toBe("formula.notAllowed");
    expect(p.issues[0].path).toBe("datasets[0].steps[2].calc.formula");
    expect(p.rows.every((r) => r.flag === null)).toBe(true);
  });

  it("a calc step reading an errored column fails closed with type.errors", () => {
    const p = applySteps(typed, withCalc("[العدد] > 1"), params, 2);
    expect(p.issues.map((i) => i.rule)).toEqual(["type.errors"]);
    expect(p.issues[0].detail).toContain("العدد");
    expect(p.issues[0].detail).toContain("2");
    expect(p.issues[0].path).toBe("datasets[2].steps[2]");
  });

  it("a step filter on an errored column fails closed", () => {
    const d = structuredClone(FIXTURE_DATASET);
    d.steps = [{ id: "f", label: "تصفية", kind: "filter", filter: { field: "count", op: "notNull" } }];
    expect(applySteps(typed, d, params).issues.map((i) => i.rule)).toEqual(["type.errors"]);
  });

  it("a step filter substitutes a {param} value", () => {
    const d = structuredClone(FIXTURE_DATASET);
    d.steps = [{ id: "f", label: "تصفية", kind: "filter", filter: { field: "port", op: "eq", value: { param: "port" } } }];
    expect(applySteps(typed, d, params).rows).toHaveLength(5);
  });

  it("a step filter with a missing {param} raises an issue", () => {
    const d = structuredClone(FIXTURE_DATASET);
    d.steps = [{ id: "f", label: "تصفية", kind: "filter", filter: { field: "port", op: "eq", value: { param: "absent" } } }];
    expect(applySteps(typed, d, params).issues).toEqual([
      { rule: "schema.invalid", path: "datasets[0].steps[0].filter", detail: "missing param: absent" },
    ]);
  });
});
