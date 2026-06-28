import { describe, it, expect } from "vitest";
import { runQuery } from "./runQuery";

const rows = [
  { port: "A", suspicious: true },
  { port: "A", suspicious: false },
  { port: "A", suspicious: true },
  { port: "B", suspicious: false },
];

describe("runQuery", () => {
  it("groups by a dimension and counts", () => {
    const out = runQuery(rows, { groupBy: ["port"], values: [{ field: "port", agg: "count" }], filters: [] });
    expect(out).toEqual([
      { port: "A", count_port: 3 },
      { port: "B", count_port: 1 },
    ]);
  });
  it("sums a boolean measure per group and honours alias", () => {
    const out = runQuery(rows, {
      groupBy: ["port"],
      values: [{ field: "suspicious", agg: "sum", as: "suspiciousCount" }],
      filters: [],
    });
    expect(out).toEqual([
      { port: "A", suspiciousCount: 2 },
      { port: "B", suspiciousCount: 0 },
    ]);
  });
  it("applies filters before grouping", () => {
    const out = runQuery(rows, {
      groupBy: ["port"],
      values: [{ field: "port", agg: "count" }],
      filters: [{ field: "suspicious", op: "truthy", value: null }],
    });
    expect(out).toEqual([{ port: "A", count_port: 2 }]);
  });
  it("sorts then limits (topN)", () => {
    const out = runQuery(rows, {
      groupBy: ["port"],
      values: [{ field: "port", agg: "count" }],
      filters: [],
      sort: { key: "count_port", dir: "desc" },
      limit: 1,
    });
    expect(out).toEqual([{ port: "A", count_port: 3 }]);
  });
  it("returns a single aggregate row when groupBy is empty", () => {
    const out = runQuery(rows, { groupBy: [], values: [{ field: "port", agg: "count" }], filters: [] });
    expect(out).toEqual([{ count_port: 4 }]);
  });
});
