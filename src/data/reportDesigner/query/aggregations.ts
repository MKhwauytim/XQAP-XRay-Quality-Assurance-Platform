import type { Aggregation } from "../reportTypes";

function toNumbers(values: unknown[]): number[] {
  const out: number[] = [];
  for (const v of values) {
    if (typeof v === "number" && Number.isFinite(v)) out.push(v);
    else if (typeof v === "boolean") out.push(v ? 1 : 0);
  }
  return out;
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
