import { describe, it, expect } from "vitest";
import { applyFilters } from "./filters";

const rows = [
  { port: "A", n: 1, ok: true,  note: "alpha" },
  { port: "B", n: 5, ok: false, note: "beta" },
  { port: "A", n: 9, ok: true,  note: "gamma" },
];

describe("applyFilters", () => {
  it("equals", () => {
    expect(applyFilters(rows, [{ field: "port", op: "equals", value: "A" }])).toHaveLength(2);
  });
  it("in", () => {
    expect(applyFilters(rows, [{ field: "port", op: "in", value: ["B"] }])).toHaveLength(1);
  });
  it("notEquals", () => {
    expect(applyFilters(rows, [{ field: "port", op: "notEquals", value: "A" }])).toHaveLength(1);
  });
  it("between (inclusive)", () => {
    expect(applyFilters(rows, [{ field: "n", op: "between", value: [1, 5] }])).toHaveLength(2);
  });
  it("contains (substring)", () => {
    expect(applyFilters(rows, [{ field: "note", op: "contains", value: "et" }])).toHaveLength(1);
  });
  it("truthy / falsy", () => {
    expect(applyFilters(rows, [{ field: "ok", op: "truthy", value: null }])).toHaveLength(2);
    expect(applyFilters(rows, [{ field: "ok", op: "falsy", value: null }])).toHaveLength(1);
  });
  it("AND-composes multiple filters", () => {
    expect(applyFilters(rows, [
      { field: "port", op: "equals", value: "A" },
      { field: "ok", op: "truthy", value: null },
    ])).toHaveLength(2);
  });
  it("ignores topN here", () => {
    expect(applyFilters(rows, [{ field: "n", op: "topN", value: 1 }])).toHaveLength(3);
  });
});
