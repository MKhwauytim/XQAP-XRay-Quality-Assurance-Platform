import { describe, it, expect } from "vitest";
import { aggregate, aggregateOrNull } from "./aggregations";

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

// T-19 — the app-wide KPI invariant ("a null denominator renders «—», never 0") applied
// to this aggregator. `aggregate` itself is unchanged: callers that want the
// numeric-with-zero-fallback behavior still get exactly the numbers asserted above.
describe("aggregateOrNull", () => {
  it("returns null for avg/min/max with no numeric values behind them", () => {
    expect(aggregateOrNull("avg", [])).toBeNull();
    expect(aggregateOrNull("avg", [null, "غير متاح", undefined])).toBeNull();
    expect(aggregateOrNull("min", [])).toBeNull();
    expect(aggregateOrNull("max", ["x"])).toBeNull();
  });

  it("returns null for a percentage of a zero grand total", () => {
    expect(aggregateOrNull("percentOfTotal", [3], 0)).toBeNull();
  });

  it("never nulls count/distinctCount/sum — zero of something is a real answer", () => {
    expect(aggregateOrNull("count", [])).toBe(0);
    expect(aggregateOrNull("distinctCount", [null])).toBe(0);
    expect(aggregateOrNull("sum", [])).toBe(0);
  });

  it("agrees with aggregate for every case that has a real value", () => {
    expect(aggregateOrNull("avg", [2, 4, 6])).toBe(aggregate("avg", [2, 4, 6]));
    expect(aggregateOrNull("min", [5, 2, 9])).toBe(aggregate("min", [5, 2, 9]));
    expect(aggregateOrNull("max", [5, 2, 9])).toBe(aggregate("max", [5, 2, 9]));
    expect(aggregateOrNull("percentOfTotal", [25], 100)).toBe(aggregate("percentOfTotal", [25], 100));
    expect(aggregateOrNull("sum", [2, 3, true, "x", null])).toBe(aggregate("sum", [2, 3, true, "x", null]));
  });

  it("keeps a genuine zero measurement as 0, not null", () => {
    expect(aggregateOrNull("avg", [0, 0])).toBe(0);
    expect(aggregateOrNull("min", [0, 4])).toBe(0);
    expect(aggregateOrNull("percentOfTotal", [0], 100)).toBe(0);
  });
});
