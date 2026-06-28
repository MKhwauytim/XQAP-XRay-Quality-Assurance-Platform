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
      const nums = toNumbers(values);
      return nums.length ? Math.min(...nums) : 0;
    }
    case "max": {
      const nums = toNumbers(values);
      return nums.length ? Math.max(...nums) : 0;
    }
    case "percentOfTotal": {
      const sum = toNumbers(values).reduce((a, b) => a + b, 0);
      return grandTotal === 0 ? 0 : (sum / grandTotal) * 100;
    }
    default:
      return 0;
  }
}
