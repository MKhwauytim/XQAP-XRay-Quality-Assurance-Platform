import { describe, it, expect } from "vitest";
import { aggregate } from "./aggregations";

describe("aggregate", () => {
  it("counts rows including nulls", () => {
    expect(aggregate("count", [1, null, "x"])).toBe(3);
  });
  it("counts distinct non-null values", () => {
    expect(aggregate("distinctCount", ["a", "a", "b", null])).toBe(2);
  });
  it("sums numeric values, treating true as 1 and ignoring non-numerics", () => {
    expect(aggregate("sum", [2, 3, true, "x", null])).toBe(6);
  });
  it("averages numeric values", () => {
    expect(aggregate("avg", [2, 4, 6])).toBe(4);
  });
  it("returns min and max", () => {
    expect(aggregate("min", [5, 2, 9])).toBe(2);
    expect(aggregate("max", [5, 2, 9])).toBe(9);
  });
  it("computes percent of total from grand total", () => {
    expect(aggregate("percentOfTotal", [25], 100)).toBe(25);
  });
  it("computes min/max over a very large value set without blowing the call stack", () => {
    // `Math.min(...nums)` throws RangeError past roughly 125k spread arguments, and a
    // month population can exceed 200k rows (LARGE_POPULATION_PERFORMANCE_PROPOSAL),
    // which would take the whole Report Designer canvas down during render.
    const nums = Array.from({ length: 200_000 }, (_, i) => i);
    expect(aggregate("min", nums)).toBe(0);
    expect(aggregate("max", nums)).toBe(199_999);
  });

  it("returns 0 for empty avg/sum", () => {
    expect(aggregate("avg", [])).toBe(0);
    expect(aggregate("sum", [])).toBe(0);
  });
});
