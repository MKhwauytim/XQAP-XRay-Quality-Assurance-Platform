import type { Filter } from "../reportTypes";

function matches(value: unknown, f: Filter): boolean {
  switch (f.op) {
    case "equals": return value === f.value;
    case "notEquals": return value !== f.value;
    case "in": return Array.isArray(f.value) && f.value.includes(value as never);
    case "between": {
      if (!Array.isArray(f.value) || typeof value !== "number") return false;
      const [lo, hi] = f.value as [number, number];
      return value >= lo && value <= hi;
    }
    case "contains":
      return String(value ?? "").includes(String(f.value ?? ""));
    case "truthy": return Boolean(value);
    case "falsy": return !value;
    case "topN": return true; // applied post-aggregation in runQuery
    default: return true;
  }
}

export function applyFilters<T extends Record<string, unknown>>(rows: T[], filters: Filter[]): T[] {
  if (!filters.length) return rows;
  return rows.filter((row) => filters.every((f) => matches(row[f.field], f)));
}
