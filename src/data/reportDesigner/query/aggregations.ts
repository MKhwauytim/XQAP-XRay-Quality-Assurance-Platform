import type { Aggregation } from "../reportTypes";

function toNumbers(values: unknown[]): number[] {
  const out: number[] = [];
  for (const v of values) {
    if (typeof v === "number" && Number.isFinite(v)) out.push(v);
    else if (typeof v === "boolean") out.push(v ? 1 : 0);
  }
  return out;
}

/**
 * `aggregate`, but returning `null` for the cases where no honest number exists —
 * the app-wide KPI invariant ("a null denominator renders «—», never 0", already
 * enforced in `kpiSelectors`/`aggregates`/`reviewerKpis`) applied to the Report
 * Designer's own aggregator:
 *
 * - `avg` / `min` / `max` over zero numeric values — undefined, not 0.
 * - `percentOfTotal` with a zero grand total — a share of nothing, not 0%.
 *
 * `count`, `distinctCount` and `sum` are never null: zero of something counted, or
 * the empty sum, is a real answer rather than a stand-in for a missing one.
 *
 * Kept as a wrapper so `aggregate` itself stays byte-for-byte unchanged for any
 * caller that genuinely wants the numeric-with-zero-fallback behavior.
 */
export function aggregateOrNull(agg: Aggregation, values: unknown[], grandTotal = 0): number | null {
  if (agg === "avg" || agg === "min" || agg === "max") {
    if (toNumbers(values).length === 0) return null;
  }
  if (agg === "percentOfTotal" && grandTotal === 0) return null;
  return aggregate(agg, values, grandTotal);
}

export function aggregate(agg: Aggregation, values: unknown[], grandTotal = 0): number {
  switch (agg) {
    case "count":
      return values.length;
    case "distinctCount":
      return new Set(values.filter((v) => v !== null && v !== undefined)).size;
    case "sum":
      return toNumbers(values).reduce((a, b) => a + b, 0);
    case "avg": {
      const nums = toNumbers(values);
      return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
    }
    case "min": {
      // Reduced in a loop, not `Math.min(...nums)`: spreading blows the argument/stack
      // limit past roughly 125k elements, and a month population can be far larger.
      const nums = toNumbers(values);
      if (nums.length === 0) return 0;
      let lowest = nums[0]!;
      for (const n of nums) if (n < lowest) lowest = n;
      return lowest;
    }
    case "max": {
      const nums = toNumbers(values);
      if (nums.length === 0) return 0;
      let highest = nums[0]!;
      for (const n of nums) if (n > highest) highest = n;
      return highest;
    }
    case "percentOfTotal": {
      const sum = toNumbers(values).reduce((a, b) => a + b, 0);
      return grandTotal === 0 ? 0 : (sum / grandTotal) * 100;
    }
    default:
      return 0;
  }
}
