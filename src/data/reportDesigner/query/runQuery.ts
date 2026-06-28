import type { Aggregation, Filter } from "../reportTypes";
import { aggregate } from "./aggregations";
import { applyFilters } from "./filters";

export type QuerySpec = {
  groupBy: string[];
  values: Array<{ field: string; agg: Aggregation; as?: string }>;
  filters: Filter[];
  sort?: { key: string; dir: "asc" | "desc" };
  limit?: number;
};
export type ResultRow = Record<string, string | number | null>;

function measureKey(v: { field: string; agg: Aggregation; as?: string }): string {
  return v.as ?? `${v.agg}_${v.field}`;
}

export function runQuery(rows: Array<Record<string, unknown>>, spec: QuerySpec): ResultRow[] {
  const filtered = applyFilters(rows, spec.filters);
  const grandTotals = new Map<string, number>();
  for (const v of spec.values) {
    if (v.agg === "percentOfTotal") {
      grandTotals.set(measureKey(v), aggregate("sum", filtered.map((r) => r[v.field])));
    }
  }

  const groups = new Map<string, Array<Record<string, unknown>>>();
  if (spec.groupBy.length === 0) {
    groups.set("__all__", filtered);
  } else {
    for (const row of filtered) {
      const key = spec.groupBy.map((g) => String(row[g] ?? "")).join(" ");
      const bucket = groups.get(key);
      if (bucket) bucket.push(row);
      else groups.set(key, [row]);
    }
  }

  let result: ResultRow[] = [...groups.values()].map((bucket) => {
    const out: ResultRow = {};
    for (const g of spec.groupBy) {
      const raw = bucket[0]?.[g];
      out[g] = raw === null || raw === undefined ? null : (raw as string | number);
    }
    for (const v of spec.values) {
      const key = measureKey(v);
      out[key] = aggregate(v.agg, bucket.map((r) => r[v.field]), grandTotals.get(key) ?? 0);
    }
    return out;
  });

  if (spec.sort) {
    const { key, dir } = spec.sort;
    result = [...result].sort((a, b) => {
      const av = a[key];
      const bv = b[key];
      if (av === bv) return 0;
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      const cmp = av < bv ? -1 : 1;
      return dir === "asc" ? cmp : -cmp;
    });
  }
  if (typeof spec.limit === "number") result = result.slice(0, spec.limit);
  return result;
}
