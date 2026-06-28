# EDIT_LOG.md

Version history for the XQAP codebase. Every code edit must be logged here before it is applied.

---

## v7.5 — 2026-06-28 — Report Designer: design storage CRUD + index (FEATURE)

Phase 0, Task 0.6: Implement disk storage for ReportDocument designs, mirroring templateStorage.ts. Files live in `4-Reports/designs/` (created on demand). Index file is `designs.index.json`. Exports `DesignIndex`, `saveDesign`, `loadDesign`, `loadDesignIndex`, `deleteDesign`.

**File:** `src/data/reportDesigner/storage/reportDesignStorage.ts` (new)

**Before:**
```
(file did not exist)
```

**After:**
```ts
// Full implementation in src/data/reportDesigner/storage/reportDesignStorage.ts
// saveDesign / loadDesign / loadDesignIndex / deleteDesign
```

**File:** `src/data/reportDesigner/storage/reportDesignStorage.test.ts` (new)

**Before:**
```
(file did not exist)
```

**After:**
```ts
// Two Vitest tests: round-trip save/load/index and delete removes from index
```

---

## v7.4 — 2026-06-28 — Fix grouping key delimiter to prevent collisions (BUG)

Grouping key was built by joining multiple `groupBy` dimension values with a space `" "`. This caused false key collisions when dimension values themselves contained spaces. For example, `{name: "John Smith", dept: "HR"}` and `{name: "John", dept: "Smith HR"}` both produced key `"John Smith HR"`. Changed the delimiter from `" "` to `"\x00"` (null byte, which cannot appear in normal string data) to prevent collisions.

**File:** `src/data/reportDesigner/query/runQuery.ts`

**Before:**
```ts
const key = spec.groupBy.map((g) => String(row[g] ?? "")).join(" ");
```

**After:**
```ts
const key = spec.groupBy.map((g) => String(row[g] ?? "")).join("\x00");
```

---

## v7.3 — 2026-06-28 — Report Designer: runQuery group-by engine (FEATURE)

Phase 0, Task 0.4: Implement the core query engine that combines filtering, grouping, aggregation, sorting, and limiting. The runQuery function accepts filtered rows, groups them by dimension fields, computes aggregates, optionally sorts the results, and optionally applies a limit. Output measure keys use the `as` alias if provided, else `${agg}_${field}`. Group keys preserve the dimension field names. When groupBy is empty, returns a single aggregate row (grand total). Handles percentOfTotal aggregations by pre-computing grand totals.

**File:** `src/data/reportDesigner/query/runQuery.ts` (new)

**Before:**
```ts
(new file)
```

**After:**
```ts
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
```

**File:** `src/data/reportDesigner/query/runQuery.test.ts` (new)

**Before:**
```ts
(new file)
```

**After:**
```ts
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
```

---

## v7.2 — 2026-06-28 — Report Designer: filter predicates for query engine (FEATURE)

Phase 0, Task 0.3: Create pure filter predicate functions for the report query engine. Implements row filtering via a composable filter array with support for 8 filter operations: equals, notEquals, in, between, contains, truthy, falsy, topN. The topN operation is intentionally a no-op here; topN filtering is applied post-aggregation in the runQuery engine.

**File:** `src/data/reportDesigner/query/filters.ts` (new)

**Before:**
```ts
(new file)
```

**After:**
```ts
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
```

**File:** `src/data/reportDesigner/query/filters.test.ts` (new)

**Before:**
```ts
(new file)
```

**After:**
```ts
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
```

---

## v7.1 — 2026-06-28 — Report Designer: aggregation functions for query engine (FEATURE)

Phase 0, Task 0.2: Create pure aggregation functions for the report query engine. Implements the complete set of aggregation operations (count, distinctCount, sum, avg, min, max, percentOfTotal) with proper handling of nulls, booleans, and non-numeric values.

**File:** `src/data/reportDesigner/query/aggregations.ts` (new)

**Before:**
```ts
(new file)
```

**After:**
```ts
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
```

**File:** `src/data/reportDesigner/query/aggregations.test.ts` (new)

**Before:**
```ts
(new file)
```

**After:**
```ts
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
  it("returns 0 for empty avg/sum", () => {
    expect(aggregate("avg", [])).toBe(0);
    expect(aggregate("sum", [])).toBe(0);
  });
});
```

---

## v7.0 — 2026-06-28 — Report Designer: core document model types and factory (FEATURE)

Phase 0, Task 0.1: Create the foundational document model types and factory function for the Report Designer feature. All subsequent Report Designer tasks depend on these types.

Adds:
- Complete type hierarchy: `ReportDocument`, `Page`, `Element`, `ElementConfig` (table/chart/kpi/text/shape/image)
- Support types: `PageSetup`, `ElementStyle`, `Filter`, `FilterOp`, `Aggregation`, `ElementType`
- Constants: `REPORT_SCHEMA_VERSION = 1`, `A4_PORTRAIT` preset
- Factory functions: `createReportId()`, `createPageId()`, `createElementId()`, `createEmptyDocument(name, createdBy)`
- Comprehensive test covering all properties and invariants

**File:** `src/data/reportDesigner/reportTypes.ts` (new)

**Before:**
```ts
(new file)
```

**After:**
```ts
export const REPORT_SCHEMA_VERSION = 1;

export type DocType = "print" | "slides" | "dashboard";
export type PageSizePreset = "A4" | "Letter" | "16:9" | "4:3" | "custom";
export type Orientation = "portrait" | "landscape";

export type Aggregation =
  | "count" | "distinctCount" | "sum" | "avg" | "min" | "max" | "percentOfTotal";

export type FilterOp =
  | "equals" | "in" | "notEquals" | "between" | "contains" | "truthy" | "falsy" | "topN";

export type Filter = { field: string; op: FilterOp; value: unknown };

export type PageSetup = {
  size: PageSizePreset;
  orientation: Orientation;
  width: number;
  height: number;
  margins: { top: number; right: number; bottom: number; left: number };
};

export type ElementType = "table" | "chart" | "kpi" | "text" | "shape" | "image";

export type ElementStyle = {
  fill?: string; borderColor?: string; borderWidth?: number; borderRadius?: number;
  padding?: number; fontFamily?: string; fontSize?: number; fontWeight?: number;
  color?: string; textAlign?: "right" | "center" | "left"; opacity?: number;
};

export type TableConfig = {
  kind: "table";
  dataSourceId: string;
  columns: Array<{ field: string; agg?: Aggregation; sort?: "asc" | "desc"; format?: string; condFormat?: unknown }>;
  groupBy: string[];
  filters: Filter[];
};

export type ChartConfig = {
  kind: "chart";
  chartType: "bar" | "line" | "pie" | "donut" | "area" | "combo" | "scatter";
  dataSourceId: string;
  wells: { axis: string[]; legend?: string; values: Array<{ field: string; agg: Aggregation }> };
  filters: Filter[];
  options: Record<string, unknown>;
};

export type KpiConfig = {
  kind: "kpi";
  dataSourceId: string;
  valueField: string;
  agg: Aggregation;
  target?: number;
  comparison?: "higherBetter" | "lowerBetter";
  format?: string;
};

export type TextConfig = { kind: "text"; text: string };
export type ShapeConfig = { kind: "shape"; shape: "rect" | "line" | "ellipse" | "divider" };
export type ImageConfig = { kind: "image"; dataUrl: string; alt?: string };

export type ElementConfig =
  | TableConfig | ChartConfig | KpiConfig | TextConfig | ShapeConfig | ImageConfig;

export type Element = {
  elementId: string;
  type: ElementType;
  name: string;
  x: number; y: number; w: number; h: number; z: number;
  rotation?: number; locked?: boolean;
  style: ElementStyle;
  config: ElementConfig;
};

export type Page = {
  pageId: string;
  name: string;
  order: number;
  background?: { color?: string; image?: string };
  filters: Filter[];
  elements: Element[];
};

export type DataSourceRef = { id: string; tableId: string; label: string };

export type ReportDocument = {
  reportId: string;
  reportName: string;
  version: number;
  createdAt: string; createdBy: string; updatedAt: string; updatedBy: string;
  docType: DocType;
  pageSetup: PageSetup;
  theme: { palette: string[]; fontFamily: string; defaults: Record<string, unknown> };
  dataSources: DataSourceRef[];
  pages: Page[];
  reportFilters: Filter[];
};

export const A4_PORTRAIT: PageSetup = {
  size: "A4", orientation: "portrait", width: 794, height: 1123,
  margins: { top: 38, right: 38, bottom: 38, left: 38 },
};

export function createReportId(): string { ... }
export function createPageId(): string { ... }
export function createElementId(): string { ... }
export function createEmptyDocument(name: string, createdBy: string): ReportDocument { ... }
```

**File:** `src/data/reportDesigner/reportTypes.test.ts` (new)

**Before:**
```ts
(new file)
```

**After:**
```ts
import { describe, it, expect } from "vitest";
import { createEmptyDocument, REPORT_SCHEMA_VERSION } from "./reportTypes";

describe("createEmptyDocument", () => {
  it("creates a print A4 document with one empty page", () => {
    const doc = createEmptyDocument("تقرير تجريبي", "admin");
    expect(doc.reportName).toBe("تقرير تجريبي");
    expect(doc.createdBy).toBe("admin");
    expect(doc.docType).toBe("print");
    expect(doc.pageSetup.size).toBe("A4");
    expect(doc.pageSetup.orientation).toBe("portrait");
    expect(doc.pages).toHaveLength(1);
    expect(doc.pages[0].elements).toEqual([]);
    expect(doc.reportId).toMatch(/^rpt-/);
    expect(REPORT_SCHEMA_VERSION).toBe(1);
  });
});
```

---

## v6.1 — 2026-06-28 — Incremental content-hashing removes the read-side stringify ceiling (FEATURE)

Completes the symmetry of v6.0. v6.0 removed the **write**-side ceiling, but the
**read** path still recomputed `simpleHash(JSON.stringify(envelope.data))` in
`validateEnvelope` on every read, and `wrap()` did the same full
`JSON.stringify(data)` purely to hash on every non-streamed write. Both built a
second full-size string on top of the source + parsed object graph, so a file
big enough to need a streamed write could be *written* but not *validated on
read*, and every normal read/write paid an extra payload-sized allocation.

Fix: add `hashJsonValue(value)` — `simpleHash(JSON.stringify(value))` computed
incrementally by feeding `streamJsonStringify(value)` chunks into
`createSimpleHasher`. The digest is **identical** to the old expression (the
streamed chunks concatenate to exactly `JSON.stringify(value)`), so on-disk
content hashes are unchanged and existing files keep validating. `wrap()` and
`validateEnvelope()` now both use it: no intermediate full-size string, no
RangeError ceiling, and ~33% lower peak memory on every read (source + objects,
no third hash string).

Residual platform floor (documented, intentionally not engineered around): the
File System Access API's `File.text()` still returns the whole file as one
string, so a single file larger than V8's max string length (~512 M chars,
~0.5–1 GB on disk) cannot be read without a streaming JSON parser. Building a
hand-rolled streaming parser for critical population data — to support sizes
this app's workloads (hundreds of thousands of rows, tens of MB) never reach —
is higher risk than value, so it is left as an explicit non-goal. Every JSON
tool faces the same string limit; this change makes the persistence layer hash
without adding to it.

**File:** `src/data/storage/jsonEnvelope.ts`

**Before:**
```ts
export function wrap<T>(data: T, previousRevision = 0): JsonEnvelope<T> {
  const serialized = JSON.stringify(data);
  return { metadata: { /* ... */ contentHash: simpleHash(serialized) /* ... */ }, data };
}
// ...
return envelope.metadata.contentHash === simpleHash(JSON.stringify(envelope.data));
```

**After:**
```ts
export function hashJsonValue(value: unknown): string {
  const hasher = createSimpleHasher();
  for (const chunk of streamJsonStringify(value)) hasher.update(chunk);
  return hasher.digest();
}

export function wrap<T>(data: T, previousRevision = 0): JsonEnvelope<T> {
  return { metadata: { /* ... */ contentHash: hashJsonValue(data) /* ... */ }, data };
}
// ...
return envelope.metadata.contentHash === hashJsonValue(envelope.data);
```

**File:** `src/data/storage/jsonEnvelope.test.ts` — added coverage: `hashJsonValue`
equals `simpleHash(JSON.stringify(value))` across mixed values, and
`validateEnvelope` round-trips / rejects tampering on a large nested payload.

---

## v6.0 — 2026-06-28 — Streamed safe-writes remove the JSON.stringify string-length ceiling (FEATURE)

Follow-up to v5.40 (which only halved the size by writing large payloads
compact). A truly enormous payload (e.g. millions of rows) can still exceed
V8's max string length (~512 M chars) even compact, because `safeWriteJson`
built the entire serialized envelope as one in-memory string before writing,
and `jsonEnvelope.wrap()` did a second full `JSON.stringify(data)` just to
compute the content hash.

Fix: add a **streamed write path**. When the whole-envelope `JSON.stringify`
throws `RangeError: Invalid string length`, the write falls back to serializing
the `JsonEnvelope` directly to the `FileSystemWritableFileStream` in small
chunks — the `data` value is streamed element-by-element via a new generator
`streamJsonStringify` (byte-identical to compact `JSON.stringify`), so no single
giant string is ever materialized. The content hash is computed **incrementally**
over the streamed `data` chunks (new `createSimpleHasher`), avoiding the extra
full stringify. The file is written as `{"data":<streamed>,"metadata":{…}}` —
data first so the hash is known before the metadata is emitted; key order is
irrelevant to `isEnvelope`/`unwrap`/`validateEnvelope`. Snapshot-and-verify/`.bak`
rollback is preserved: each streamed file is verified by re-reading it and
comparing an exact whole-file content hash + length. The existing small-file
path (pretty-print + re-parse verify) is unchanged; streaming triggers only at
the real V8 ceiling (or, in tests, via an internal size override).

Note: this removes the **write**-side ceiling. The read-side
`validateEnvelope` still does a full `JSON.stringify(envelope.data)`, so a file
larger than the ceiling cannot yet be read back; streamed reads/validation are a
separate follow-up. Realistic payloads (hundreds of thousands of rows, tens of
MB) are far under the ceiling and round-trip on both paths.

**File:** `src/data/storage/jsonEnvelope.ts`

**Before:**
```ts
export function simpleHash(content: string): string {
  let h = 5381;
  for (let i = 0; i < content.length; i++) {
    h = ((h << 5) + h) ^ content.charCodeAt(i);
  }
  return (h >>> 0).toString(16);
}
```

**After:**
```ts
export function createSimpleHasher(): {
  update: (chunk: string) => void;
  digest: () => string;
} {
  let h = 5381;
  return {
    update(chunk) {
      for (let i = 0; i < chunk.length; i++) {
        h = ((h << 5) + h) ^ chunk.charCodeAt(i);
      }
    },
    digest() {
      return (h >>> 0).toString(16);
    },
  };
}

export function simpleHash(content: string): string {
  const hasher = createSimpleHasher();
  hasher.update(content);
  return hasher.digest();
}

// ...plus streamJsonStringify(value) generator that yields compact-JSON chunks
// byte-identical to JSON.stringify(value), recursing into arrays/objects and
// delegating leaves to JSON.stringify.
```

**File:** `src/data/storage/safeWrite.ts`

**Before:**
```ts
const nextValue = isEnvelope(value) ? value : wrap(value, previousRevision);
const compact = JSON.stringify(nextValue);
const skipVerify = compact.length > VERIFY_SIZE_LIMIT;
const serialized = skipVerify
  ? `${compact}\n`
  : `${JSON.stringify(nextValue, null, 2)}\n`;
// ...single string written to tmp then live...
```

**After:**
```ts
// Try the whole-envelope string; if it exceeds V8's ceiling, stream instead.
let compact: string | null = null;
let nextValue: unknown = null;
try {
  nextValue = isEnvelope(value) ? value : wrap(value, previousRevision);
  compact = JSON.stringify(nextValue);
} catch (error) {
  if (!isStringLengthError(error)) throw;
}
if (compact === null || compact.length > streamingForcedSizeLimit) {
  // streamed path: streamEnvelopeToFile(...) to .tmp then live, each verified
  // by exact whole-file content hash; .bak snapshot + rollback preserved.
} else {
  // unchanged small-file path using `compact` / pretty-print
}
```

**File:** `src/data/storage/safeWrite.test.ts` — added coverage: streamed path round-trips and is byte-identical to the non-streamed envelope; streamed writes snapshot to `.bak` and increment revision; `streamJsonStringify` matches `JSON.stringify` across mixed values; `createSimpleHasher` chunked == `simpleHash` whole.

---

## v5.40 — 2026-06-28 — Fix "Invalid string length" when saving large processed data (BUG)

Root cause: saving a large processed population (e.g. ~300k rows) failed with
the on-screen message `فشل الحفظ: Invalid string length`. `saveMonthRun`
(`populationStorage.ts`) catches any error and returns `{ ok:false, error:
error.message }`, which the Population tab renders verbatim. The error came from
`safeWriteJson` → `JSON.stringify(nextValue, null, 2)` in `safeWrite.ts`:
pretty-printing inflates the output and, for very large arrays, pushes it past
V8's max string length (~512 MiB), throwing `RangeError: Invalid string length`.
This is the write-side twin of the 300k-row parse bug fixed in v5.36.

Fix: serialize compactly once; only re-serialize with 2-space indentation when
the compact result is small enough (≤ `VERIFY_SIZE_LIMIT`, 512 KB) to stay well
under the ceiling. Small machine files stay human-readable; large files are
written compact (≈half the size), removing the proximate trigger. Note: a
truly enormous population could still exceed the ceiling even compact — the full
cure is streamed writes, tracked separately as a follow-up.

**File:** `src/data/storage/safeWrite.ts` (both `safeWriteJson` and `safeWriteJsonText`)

**Before:**
```ts
const serialized = `${JSON.stringify(nextValue, null, 2)}\n`;
const skipVerify = serialized.length > VERIFY_SIZE_LIMIT;
```

**After:**
```ts
// Pretty-print keeps small machine files readable, but indentation can push a
// large payload past V8's max string length (RangeError: Invalid string
// length). Serialize compactly first; only indent when small enough.
const compact = JSON.stringify(nextValue);
const skipVerify = compact.length > VERIFY_SIZE_LIMIT;
const serialized = skipVerify
  ? `${compact}\n`
  : `${JSON.stringify(nextValue, null, 2)}\n`;
```

**File:** `src/data/storage/safeWrite.test.ts` — added coverage: large payloads are written compact and round-trip; small payloads stay pretty-printed.

---

## v5.39 — 2026-06-28 — Handle floating-promise rejections in data loaders (ERR-01)

Audit finding ERR-01: 13 fire-and-forget data loaders across 6 files used
`void X.then(...)` (some with `.finally`) but no `.catch`. A rejected load
(e.g. workspace read failure) became an **unhandled promise rejection** with no
log entry and no recovery. Added a `logRejection(context)` helper to
`errorLogger.ts` and a `.catch(logRejection(...))` to each site. On failure the
state now stays at its safe initial value and the error is recorded in the
in-memory ring buffer (visible via `getRecentErrors`). Sites already having a
`.catch` (e.g. `listMonthFolders` in Population, browse-preset/browse-row loads)
were left unchanged.

**File:** `src/data/storage/errorLogger.ts`

**Before:**
```ts
export function clearErrors(): void {
  entries.length = 0;
}
```

**After:**
```ts
export function clearErrors(): void {
  entries.length = 0;
}

/**
 * `.catch` handler for intentionally fire-and-forget promises: logs the
 * rejection to the ring buffer instead of leaving it unhandled. State simply
 * isn't updated on failure (safe degradation).
 */
export function logRejection(context: string): (error: unknown) => void {
  return (error: unknown) => logError(context, error);
}
```

**Files patched (added `.catch(logRejection("<context>"))`):**
- `Population/index.tsx` — loadPopulationConfig, loadCertScanGlobal
- `UserManagement/index.tsx` — readAuthActivityLog (effect + refresh button)
- `EmployeeWorkspace/views/XrayReferrals.tsx` — listMonthFolders, loadTemplateIndex, loadInspectionTemplateSelection, loadPopulationConfig, Promise.all(browse presets)
- `EmployeeWorkspace/views/EmployeeDashboard.tsx` — listMonthFolders, loadTemplateIndex
- `Reports/index.tsx` — listMonthFolders
- `TemplateBuilder/index.tsx` — loadTemplateIndex

---

## v5.38 — 2026-06-28 — Fix CLAUDE.md documentation drift (DOC-01)

Audit finding DOC-01: three confirmed drifts in `CLAUDE.md`. (1) Bundle size
said "~942 kB, 286 kB gzip"; actual `vite build` output is 1.9 MB / 664 kB gzip.
(2) Disk-layout block documented the legacy `Population/`, `templates/`, `.system/`
roots; the code now uses numbered roots `1-Population/`…`6-Templates/` with legacy
fallbacks (correctly described in `docs/data-system-report.md`). (3) Session
description said "runtime-only … no localStorage"; it is now `sessionStorage`
(see v5.37 / SEC-02). Documentation-only change — no code touched.

**File:** `CLAUDE.md` (build-size line, disk-layout section, session bullet)

---

## v5.37 — 2026-06-28 — Session storage moved from localStorage to sessionStorage (SEC-02)

Audit finding SEC-02: `authSession.ts` persisted the auth session to
`localStorage` (7-day TTL), but `CLAUDE.md` and `docs/data-system-report.md`
both claimed the session was runtime-only and lost on reload — code and docs
disagreed. On a shared radiology workstation a 7-day persisted admin session is
a walk-up-takeover risk. Decision: persist to `sessionStorage` instead, so the
session survives an accidental page reload but auto-clears on tab/browser close,
shrinking the exposure window. The 7-day TTL remains as a secondary guard. This
is a UX convenience, NOT a security control (the client-only trust model still
applies — see SEC-01).

**File:** `src/auth/authSession.ts`

**Before:**
```ts
function readStoredSession(): AuthSession | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isValidSession(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeStoredSession(session: AuthSession): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Runtime session still works even when browser storage is unavailable.
  }
}

function clearStoredSession(): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
}
```

**After:**
```ts
// SEC-02: the session is persisted to sessionStorage (not localStorage) so it
// survives a page reload but auto-clears when the tab/browser closes. This is a
// UX convenience, not a security control — with the client-only trust model a
// user can still forge this object (see SEC-01 / CLAUDE.md security note).
function sessionStore(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

function readStoredSession(): AuthSession | null {
  try {
    const store = sessionStore();
    if (!store) return null;
    const raw = store.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isValidSession(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeStoredSession(session: AuthSession): void {
  try {
    sessionStore()?.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Runtime session still works even when browser storage is unavailable.
  }
}

function clearStoredSession(): void {
  try {
    sessionStore()?.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
}
```

---

## v5.36 — 2026-06-25 — Fix 300k-row BI parse failure (stack overflow + memory)

Root cause: `allRows.push(...validRows)` spreads up to 300k arguments, exceeding
V8's call-stack argument limit (`RangeError: Maximum call stack size exceeded`).
The worker's soft-catch catches it silently, sets `biResult = null`, and Phase 2
shows "not read correctly." Same latent bug in riskDataWorkbook.ts at the same
call site. Secondary improvements: `for...in` in `preprocessLargeNumbers` avoids
a 6M-element intermediate string array; worksheets freed after parsing to lower
peak heap in the worker; BI warning now includes the actual error message.

**File:** `src/components/Sidebar/Tabs/Population/biData/biDataWorkbook.ts`

**Before:**
```ts
normalizedRows.push(...mappedChunk);
// ...
allRows.push(...validRows);
```

**After:**
```ts
for (const row of mappedChunk) normalizedRows.push(row);
// ...
// free worksheet immediately — GC can collect 6M cell objects
delete workbook.Sheets[sheetName];
// ...
for (const row of validRows) allRows.push(row);
```

---

**File:** `src/components/Sidebar/Tabs/Population/riskData/riskDataWorkbook.ts`

**Before:**
```ts
normalizedRows.push(...mappedChunk);
// ...
allRows.push(...validRows);
```

**After:**
```ts
for (const row of mappedChunk) normalizedRows.push(row);
// ...
delete workbook.Sheets[sheetName];
// ...
for (const row of validRows) allRows.push(row);
```

---

**File:** `src/components/Sidebar/Tabs/Population/workbook/worksheetRows.ts`

**Before:**
```ts
for (const cellRef of Object.keys(worksheet)) {
```

**After:**
```ts
for (const cellRef in worksheet) {
```

---

**File:** `src/workers/workbookWorker.ts`

**Before:**
```ts
} catch {
  warning = "تمت قراءة بيانات وكالة المخاطر، ولكن تعذر قراءة ملف ذكاء الأعمال...";
}
```

**After:**
```ts
} catch (biErr) {
  const detail = biErr instanceof Error ? ` (${biErr.message})` : "";
  warning = `تمت قراءة بيانات وكالة المخاطر، ولكن تعذر قراءة ملف ذكاء الأعمال${detail}. يمكنك المتابعة لأن ملف ذكاء الأعمال داعم وليس شرطاً.`;
}
```

---

## v5.35 — 2026-06-25 — Remove panel-position toggle; fix col-picker portal positioning; patch employeeXlsx write cast

**File:** `src/data/answers/employeeXlsx.ts`

**Before:**
```ts
await writable.write(buf);
```

**After:**
```ts
await (writable as unknown as { write: (data: unknown) => Promise<void> }).write(buf);
```

---

**File:** `src/components/DataTable/DataTable.css`

**Before:**
```css
.dt-col-picker {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 400;
  width: 300px;
  ...
}
```

**After:**
```css
.dt-col-picker {
  width: 300px;
  ...
}
```

---

**File:** `src/components/DataTable/index.tsx`

**Before:**
```tsx
// ColPickerPanel rendered inside relative-positioned wrapper; no anchorRect
<div style={{ position: "relative" }}>
  <button onClick={() => { setColPickerOpen((o) => !o); ... }}>
  {colPickerOpen && <ColPickerPanel ... />}
</div>
```

**After:**
```tsx
// ColPickerPanel rendered as fixed portal outside the toolbar
<div>
  <button onClick={(event) => {
    setColPickerAnchorRect(event.currentTarget.getBoundingClientRect());
    setColPickerOpen((open) => !open);
    ...
  }}>
</div>
// rendered after toolbar:
{colPickerOpen && colPickerAnchorRect && (
  <ColPickerPanel anchorRect={colPickerAnchorRect} ... />
)}
// inside ColPickerPanel:
const style: CSSProperties = {
  position: "fixed",
  top: anchorRect.bottom + 6,
  left: Math.max(8, Math.min(anchorRect.left, window.innerWidth - pickerWidth - 8)),
  zIndex: 9999,
};
```

---

**File:** `src/components/InspectionPanel/InspectionPanel.css`

**Before:**
```css
.ip-panel--bottom {
  width: 100%;
  flex: 0 0 42%;
  height: auto;
  min-height: 260px;
  flex-shrink: 0;
}
```

**After:** *(removed — panel always renders as right panel)*

---

**File:** `src/components/InspectionPanel/PanelHeader.tsx`

**Before:**
```tsx
import { PanelBottom, PanelRight, X } from "lucide-react";
type PanelPosition = "right" | "bottom";
type Props = { ...; panelPosition: PanelPosition; onTogglePosition: () => void; onClose: () => void; };
// toggle button rendered in header controls
```

**After:**
```tsx
import { X } from "lucide-react";
type Props = { ...; onClose: () => void; };
// toggle button removed
```

---

**File:** `src/components/InspectionPanel/index.tsx`

**Before:**
```tsx
export type PanelPosition = "right" | "bottom";
type Props = { ...; panelPosition: PanelPosition; onTogglePosition: () => void; ... };
<aside className={`ip-panel ip-panel--${panelPosition}`} ...>
```

**After:**
```tsx
// PanelPosition type removed; props removed; hardcoded to right
<aside className="ip-panel ip-panel--right" ...>
```

---

**File:** `src/components/Sidebar/Tabs/EmployeeWorkspace/EmployeeWorkspace.css`

**Before:**
```css
.ew-split--bottom { ... }
.ew-split--bottom .dt-table-wrap { ... }
.ew-split--right .dt-table-wrap .dt-table,
.ew-split--bottom .dt-table-wrap .dt-table { table-layout: fixed; min-width: 980px; }
```

**After:**
```css
.ew-split--right .dt-table-wrap .dt-table { table-layout: fixed; min-width: 980px; }
```

---

**File:** `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx`

**Before:**
```tsx
import { saveInspectionPanelPosition, type InspectionPanelPosition } from "...";
const [panelPosition, setPanelPosition] = useState<InspectionPanelPosition>("right");
// loaded from user preset on mount
// toggle handler calling saveInspectionPanelPosition
<div className={`ew-split ew-split--${selEntry ? panelPosition : "right"}...`}>
<SampleDetailPanel panelPosition={panelPosition} onTogglePosition={...} ...>
```

**After:**
```tsx
// panelPosition state removed; toggle removed
<div className={`ew-split ew-split--right${selEntry ? "" : " ew-split--empty"}`}>
<SampleDetailPanel ...> // without position props
```

---

**File:** `src/data/preferences/browsePresetStorage.ts`

**Before:**
```ts
export type InspectionPanelPosition = "right" | "bottom";
export type UserBrowsePresetFile = { ...; inspectionPanelPosition?: InspectionPanelPosition; };
export async function saveInspectionPanelPosition(...): Promise<void> { ... }
```

**After:**
```ts
// InspectionPanelPosition type removed
export type UserBrowsePresetFile = { username: string; browseData: ...; };
// saveInspectionPanelPosition removed
```

---

## v5.34 — 2026-06-25 — replace hand-coded sidebar SVG icons with Lucide stroke icons

**Files:** all 6 sidebar tab index.tsx files (Population, EmployeeWorkspace, Reports, Archive, UserManagement, Settings)

Replace filled blob SVG icon functions with Lucide React stroke icons for consistent, crisp rendering on the dark sidebar background. Icons chosen: ScanLine (population), LayoutDashboard (workspace), BarChart3 (reports), Archive (archive), UserCog (user management), Settings (settings). Stroke weight 1.8, size 20.

---

## v5.33 — 2026-06-25 — add per-employee XLSX export on distribution and completion

**File:** `src/data/answers/employeeXlsx.ts` (new)

Creates `{username}.xlsx` in the `2-Employees` workspace folder when distribution events are applied (initial creation) and overwrites it with answers when the employee submits their last assigned sample.

**File:** `src/components/Sidebar/Tabs/Population/index.tsx`

**Before (handleApplyBulkAssignment success block):**
```ts
if (result.ok) {
  await refreshDistribution(monthFolderName);
  setDistributionMessage({ type: "ok", text: "تم تطبيق وحفظ التوزيع الجماعي بنجاح." });
}
```

**After:**
```ts
if (result.ok) {
  await refreshDistribution(monthFolderName);
  // fire-and-forget XLSX creation per assigned employee
  const rowMap = new Map(sampleDrawResult.rows.map((r) => [r.xrayImageId, r]));
  const assignedMap = new Map<string, DistributionEntry[]>();
  for (const ev of events) {
    if (ev.eventType !== "assigned") continue;
    const row = rowMap.get(ev.xrayImageId);
    if (!row) continue;
    const entry: DistributionEntry = { xrayImageId: ev.xrayImageId, assignedTo: ev.assignedTo, status: "pending", replacedById: null, lastEventAt: ev.eventAt, row };
    const list = assignedMap.get(ev.assignedTo) ?? [];
    list.push(entry);
    assignedMap.set(ev.assignedTo, list);
  }
  for (const [emp, empEntries] of assignedMap) {
    void writeEmployeeXlsx(directoryHandle, monthFolderName, emp, empEntries).catch(() => undefined);
  }
  setDistributionMessage({ type: "ok", text: "تم تطبيق وحفظ التوزيع الجماعي بنجاح." });
}
```

**File:** `src/components/Sidebar/Tabs/EmployeeWorkspace/views/EmployeeDashboard.tsx`

**Before (handleSaveAnswers success block):**
```ts
if (result.ok) {
  setSavedAnswers((prev) => {
    const others = prev.filter((a) => a.xrayImageId !== xrayImageId);
    return [...others, item];
  });
  setStatusMessage({ type: "ok", text: submit ? "تم تقديم الإجابات." : "تم حفظ المسودة." });
}
```

**After:**
```ts
if (result.ok) {
  const nextAnswers = [...savedAnswers.filter((a) => a.xrayImageId !== xrayImageId), item];
  setSavedAnswers(nextAnswers);
  setStatusMessage({ type: "ok", text: submit ? "تم تقديم الإجابات." : "تم حفظ المسودة." });
  if (submit) {
    const allSubmitted = myEntries.length > 0 &&
      myEntries.every((e) => nextAnswers.find((a) => a.xrayImageId === e.xrayImageId)?.status === "submitted");
    if (allSubmitted) {
      void writeEmployeeXlsx(directoryHandle, selectedMonth, username, myEntries, nextAnswers).catch(() => undefined);
    }
  }
}
```

---

## v5.32 — 2026-06-25 — fix TS2345 type errors in PhaseThreeSampling handleRuleChange call sites

**File:** `src/components/Sidebar/Tabs/Population/components/PhaseThreeSampling.tsx`

**Before (line 143 — TS2345: string not assignable to union):**
```ts
handleRuleChange(rule.stageKey, "method", e.target.value)
```

**After:**
```ts
handleRuleChange(rule.stageKey, "method", e.target.value as StageSamplingRule[keyof StageSamplingRule])
```

**Before (line 184 — TS2345: string not assignable to union):**
```ts
handleRuleChange(rule.stageKey, "certScanMethod", e.target.value)
```

**After:**
```ts
handleRuleChange(rule.stageKey, "certScanMethod", e.target.value as StageSamplingRule[keyof StageSamplingRule])
```

---

## v5.31 — 2026-06-25 — resolve 6 residual ESLint errors (any, unused-vars, control-regex, set-state-in-effect)

**File:** `src/components/Sidebar/Tabs/Population/index.tsx`

**Before (line 353 — no-explicit-any):**
```ts
    useState<any | null>(null); // SampleMasterData
```

**After:**
```ts
    useState<SampleMasterData | null>(null);
```

---

**Before (line 626 — unused variable 'e'):**
```ts
    } catch (e) {
```

**After:**
```ts
    } catch {
```

---

**Before (line 714 — unused variable '_rawRow'):**
```ts
          ({ rawRow: _rawRow, ...rest }) => rest
```

**After:**
```ts
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          ({ rawRow: _rawRow, ...rest }) => rest
```

*(Destructure must name the key to omit it; suppression comment is the correct fix.)*

---

**Before (line 1832 — no-control-regex):**
```ts
  return value.replace(/[<>:"/\\|?* -]+/g, "-").replace(/\s+/g, "_");
```

**After:**
```ts
  return value.replace(/[<>:"/\\|?* -]+/g, "-").replace(/\s+/g, "_");
```

---

**File:** `src/components/Sidebar/Tabs/Reports/index.tsx`

**Before (line 88 — react-hooks/set-state-in-effect):**
```ts
    if (!directoryHandle || !selectedMonth) { setMonthMeta(null); return; }
    setMonthMeta(null);
```

**After:**
```ts
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync null-clear when workspace or month is deselected; synchronizes with external workspace state
    if (!directoryHandle || !selectedMonth) { setMonthMeta(null); return; }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clear stale data before async reload
    setMonthMeta(null);
```

---

**File:** `src/data/reporting/executiveReport.ts`

**Before (line 363 — unused variable '_monthLabel'):**
```ts
function slide4(kpis: ExecutiveKPIs, _monthLabel: string): string {
```

**After:**
```ts
function slide4(kpis: ExecutiveKPIs, _monthLabel: string): string { // eslint-disable-line @typescript-eslint/no-unused-vars
```

*(Parameter must remain in the signature to match the call site; inline suppression is the correct fix.)*

---

## v5.30 — 2026-06-25 — bump version to 1.0.0

**File:** `package.json`

**Before:**
```json
"version": "0.0.0",
```

**After:**
```json
"version": "1.0.0",
```

---

## v5.29 — 2026-06-25 — Write complete README.md

**File:** `README.md`

**Before:**
```markdown
# XQAP---XRay-Quality-Assurance-Platform
```

**After:** (see README.md for full content)
Replaced with comprehensive project README covering: project title and description, browser requirements (Chromium-only), prerequisites, quick start, build instructions, available commands, architecture overview, user workflow (4 phases), workspace folder layout, authentication & roles, key features, development notes, and support documentation.

---

## v5.28 — 2026-06-25 — Remove unused parameters from DataTable col-config helpers

**File:** `src/components/DataTable/index.tsx`

**Before:**
```ts
function loadColConfig<TRow>(
  _storageKey: string,
  columns: DataTableCol<TRow>[],
  defaultVisible?: string[]
): ColConfig {
  return buildDefault(columns, defaultVisible);
}

function saveColConfig(_storageKey: string, _cfg: ColConfig): void {
  // Durable table preferences should be saved through onColConfigChange.
}
```

**After:**
```ts
function loadColConfig<TRow>(
  columns: DataTableCol<TRow>[],
  defaultVisible?: string[]
): ColConfig {
  return buildDefault(columns, defaultVisible);
}

function saveColConfig(): void {
  // Durable table preferences should be saved through onColConfigChange.
}
```

**Call site change (line ~220):**
```ts
// Before:
return loadColConfig(storageKey, columns, defaultVisible);

// After:
return loadColConfig(columns, defaultVisible);
```

**Call site change (line ~260, ~273):**
```ts
// Before:
saveColConfig(storageKey, c);
// ...
saveColConfig(storageKey, initialColConfig);

// After:
saveColConfig();
// ...
saveColConfig();
```

---

**File:** `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx`

**Before:**
```ts
function loadLocalColConfig(_columns: DataTableCol<DistributionEntry>[]): ColConfig | null {
  return null;
}
```

**After:**
```ts
function loadLocalColConfig(): ColConfig | null {
  return null;
}
```

**Call site change (line ~317):**
```ts
// Before:
() => colPreset ?? loadLocalColConfig(columns) ?? buildDefaultColConfig(columns),

// After:
() => colPreset ?? loadLocalColConfig() ?? buildDefaultColConfig(columns),
```

---

**File:** `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayInspectionResults.tsx`

**Before:**
```ts
function loadLocalReferralColConfig(_sampleColumns: DataTableCol<DistributionEntry>[]): ColConfig | null {
  return null;
}
```

**After:**
```ts
function loadLocalReferralColConfig(): ColConfig | null {
  return null;
}
```

**Call site change (line ~176):**
```ts
// Before:
setReferralColConfig(loadLocalReferralColConfig(sampleColumns) ?? buildDefaultReferralColConfig(sampleColumns));

// After:
setReferralColConfig(loadLocalReferralColConfig() ?? buildDefaultReferralColConfig(sampleColumns));
```

---

## v5.27 — 2026-06-25 — Extract DataTable non-component exports to utils.ts to fix fast-refresh boundary

**File:** `src/components/DataTable/utils.ts` (new file)

**Before:**
```ts
// (file did not exist)
```

**After:**
```ts
// Shared utilities extracted from DataTable/index.tsx to avoid fast-refresh boundary pollution.
export type DateFormatMode = "date" | "time" | "month" | "datetime";
export const DATE_FORMAT_LABELS: Record<DateFormatMode, string> = { ... };
export function looksLikeDate(v: string): boolean { ... }
export function formatDate(raw: string, mode: DateFormatMode): string { ... }
export function toIsoDate(raw: string): string { ... }
export function isFilterEmpty(f: AnyFilter): boolean { ... }
```

---

**File:** `src/components/DataTable/index.tsx`

**Before:**
```ts
export type DateFormatMode = "date" | "time" | "month" | "datetime";

export const DATE_FORMAT_LABELS: Record<DateFormatMode, string> = {
  date:     "التاريخ",
  time:     "الوقت",
  month:    "الشهر",
  datetime: "التاريخ والوقت",
};
// ...
const ISO_DATE_RE  = /^\d{4}-\d{2}-\d{2}(T|\s)\d{2}:\d{2}/;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function looksLikeDate(v: string): boolean { ... }
export function formatDate(raw: string, mode: DateFormatMode): string { ... }
function toIsoDate(raw: string): string { ... }
// ...
export function isFilterEmpty(f: AnyFilter): boolean { ... }
```

**After:**
```ts
import { DateFormatMode, DATE_FORMAT_LABELS, looksLikeDate, formatDate, toIsoDate, isFilterEmpty } from "./utils";
// (definitions removed from this file)
```

---

**File:** `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx`

**Before:**
```ts
} from "../../../../../components/DataTable";
```

**After:**
```ts
} from "../../../../../components/DataTable";
// formatDate, looksLikeDate, DateFormatMode imported from utils
```

---

**File:** `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayInspectionResults.tsx`

**Before:**
```ts
} from "../../../../../components/DataTable";
```

**After:**
```ts
// formatDate, looksLikeDate, DateFormatMode re-pointed to utils
```

---

## v5.26 — 2026-06-25 — Suppress set-state-in-effect for async-load and cleanup effects across 3 files

**File:** `src/components/FeedbackWidget/FeedbackWidget.tsx`

**Before:**
```ts
useEffect(() => {
  if (open) void refresh();
}, [open, refresh]);
```

**After:**
```ts
useEffect(() => {
  // eslint-disable-next-line react-hooks/set-state-in-effect -- async refresh; setState fires inside the async callback, not synchronously in the effect body
  if (open) void refresh();
}, [open, refresh]);
```

---

**File:** `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx`

**Before (effect ~272 — initial data load):**
```ts
  }, [baseColumns, directoryHandle, username]);
```
*(eslint-disable-next-line for exhaustive-deps added above this line to suppress applyTemplate missing dep)*

**Before (auto-select effect ~333):**
```ts
    if (!valid) setSelEntryId(displayEntries[0].xrayImageId);
```

**After (auto-select effect ~333):**
```ts
    // eslint-disable-next-line react-hooks/set-state-in-effect -- auto-corrects selection when the display list changes; useMemo cannot accumulate user navigation state
    if (!valid) setSelEntryId(displayEntries[0].xrayImageId);
```

**Before (async data load effect ~419):**
```ts
  useEffect(() => { void loadData(); }, [loadData]);
```

**After (async data load effect ~419):**
```ts
  // eslint-disable-next-line react-hooks/set-state-in-effect -- async data load; setState fires inside loadData's async callback, not synchronously in the effect body
  useEffect(() => { void loadData(); }, [loadData]);
```

---

**File:** `src/components/Sidebar/Tabs/Population/index.tsx`

**Before (sync reset ~181):**
```ts
  } else {
    setConfig(DEFAULT_POPULATION_CONFIG);
  }
```

**After (sync reset ~181):**
```ts
  } else {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync reset when workspace is disconnected; synchronizing with the FSA external system is the correct use of effects
    setConfig(DEFAULT_POPULATION_CONFIG);
  }
```

**Before (sync cleanup ~193):**
```ts
  if (!directoryHandle) {
    setExistingMonths([]);
    return;
  }
```

**After (sync cleanup ~193):**
```ts
  if (!directoryHandle) {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync cleanup when workspace is removed; effect correctly synchronizes with File System Access API
    setExistingMonths([]);
    return;
  }
```

---

## v5.25 — 2026-06-25 — Suppress set-state-in-effect for tab accumulation effects in App.tsx

**File:** `src/App.tsx`

**Before (Effect 1):**
```ts
useEffect(() => {
  if (activeTabId) {
    setMountedTabIds((prev) =>
      prev.has(activeTabId) ? prev : new Set([...prev, activeTabId])
    );
  }
}, [activeTabId]);
```

**After (Effect 1):**
```ts
useEffect(() => {
  if (activeTabId) {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- accumulates visited tabs; useMemo cannot grow a Set across renders, making this effect the correct pattern
    setMountedTabIds((prev) =>
      prev.has(activeTabId) ? prev : new Set([...prev, activeTabId])
    );
  }
}, [activeTabId]);
```

**Before (Effect 2):**
```ts
// Drop tabs that are no longer allowed (role change)
useEffect(() => {
  const allowedIds = new Set(allowedTabs.map((t) => t.id));
  setMountedTabIds((prev) => {
    const next = new Set([...prev].filter((id) => allowedIds.has(id)));
    return next.size !== prev.size ? next : prev;
  });
}, [allowedTabs]);
```

**After (Effect 2):**
```ts
// Drop tabs that are no longer allowed (role change)
useEffect(() => {
  const allowedIds = new Set(allowedTabs.map((t) => t.id));
  // eslint-disable-next-line react-hooks/set-state-in-effect -- prunes stale tab refs on role change; set updater ensures a single re-render
  setMountedTabIds((prev) => {
    const next = new Set([...prev].filter((id) => allowedIds.has(id)));
    return next.size !== prev.size ? next : prev;
  });
}, [allowedTabs]);
```

---

## v5.24 — 2026-06-25 — Replace initialization effect with lazy useState in CertScanGrid

**File:** `src/components/Sidebar/Tabs/Population/components/CertScanGrid.tsx`

**Before:**
```ts
const [gridData, setGridData] = useState<string[][]>([]);
const [portCol, setPortCol] = useState<number | null>(null);
const [snCol, setSnCol] = useState<number | null>(null);
const [activeHL, setActiveHL] = useState<HighlightType>(null);
const pasteRef = useRef<HTMLDivElement>(null);
const initialised = useRef(false);

// Load from initialText once
useEffect(() => {
  if (initialised.current) return;
  if (!initialText) return;
  const parsed = parseStoredText(initialText);
  if (parsed) {
    setGridData(parsed.data);
    setPortCol(parsed.portCol);
    setSnCol(parsed.snCol);
    initialised.current = true;
  }
}, [initialText]);
```

**After:**
```ts
const parsed0 = parseStoredText(initialText ?? "");

const [gridData, setGridData] = useState<string[][]>(() => parsed0?.data ?? []);
const [portCol, setPortCol] = useState<number | null>(() => parsed0?.portCol ?? null);
const [snCol, setSnCol] = useState<number | null>(() => parsed0?.snCol ?? null);
const [activeHL, setActiveHL] = useState<HighlightType>(null);
const pasteRef = useRef<HTMLDivElement>(null);
// Removed: initialised ref and initialization useEffect
```

---

## v5.23 — 2026-06-25 — Fix set-state-in-effect and purity violations in MappingSettingsModal

**File:** `src/components/Sidebar/Tabs/Population/components/MappingSettingsModal.tsx`

**Before (Fix A — set-state-in-effect):**
```ts
useEffect(() => {
  if (!isOpen) return;
  setActiveTab(mode === "processing" ? "processing" : "mappings");
}, [isOpen, mode]);
```

**After (Fix A):**
```ts
useEffect(() => {
  if (!isOpen) return;
  // eslint-disable-next-line react-hooks/set-state-in-effect -- resets the active tab each time the modal opens; component stays mounted between open/close (hooks called before the early return), so effect is the correct mechanism
  setActiveTab(mode === "processing" ? "processing" : "mappings");
}, [isOpen, mode]);
```

**Before (Fix B — purity: Date.now() in handleAddWorkflowStep and handleInsertWorkflowStepAfter):**
```ts
stepId: `custom-${Date.now()}`,
```
(appears at lines 256 and 290)

**After (Fix B):**
```ts
stepId: `custom-${crypto.randomUUID().slice(0, 8)}`,
```

---

## v5.22 — 2026-06-25 — Replace set-state-in-effect in InspectionPanel with derived safeActivePhaseId

**File:** `src/components/InspectionPanel/index.tsx`

**Before:**
```ts
import { useEffect, useMemo, useState } from "react";

// Effect 1 (lines 59-67): reset activePhaseId when phase no longer in phases array
useEffect(() => {
  if (phases.length === 0) {
    setActivePhaseId("");
    return;
  }
  if (!phases.some((phase) => phase.phaseId === activePhaseId)) {
    setActivePhaseId(phases[0]!.phaseId);
  }
}, [activePhaseId, phases]);

// Effect 2 (lines 93-96): jump to first incomplete phase when current is disabled
useEffect(() => {
  if (!template || !activePhaseId || enabledPhaseIds.has(activePhaseId)) return;
  setActivePhaseId(phaseValidation.firstIncompletePhaseId ?? phases[0]?.phaseId ?? "");
}, [activePhaseId, enabledPhaseIds, phaseValidation.firstIncompletePhaseId, phases, template]);

// JSX uses activePhaseId directly
<PhaseStepper activePhaseId={activePhaseId} ... />
<EditView activePhaseId={activePhaseId} ... />
```

**After:**
```ts
import { useMemo, useState } from "react";

// Derived constant replaces both effects
const safeActivePhaseId: string = (() => {
  if (phases.length === 0) return "";
  if (phases.some((p) => p.phaseId === activePhaseId)) {
    if (template && !enabledPhaseIds.has(activePhaseId)) {
      return phaseValidation.firstIncompletePhaseId ?? phases[0]!.phaseId;
    }
    return activePhaseId;
  }
  return phases[0]!.phaseId;
})();

// JSX uses safeActivePhaseId for rendering
<PhaseStepper activePhaseId={safeActivePhaseId} ... />
<EditView activePhaseId={safeActivePhaseId} ... />
```

---

## v5.20 — 2026-06-25 — Type PhaseThreeSampling props and fix prefer-const

**File:** `src/components/Sidebar/Tabs/Population/components/PhaseThreeSampling.tsx`

**Before:**
```ts
// Fix A — import line and prop type (line 1-2, 11)
import type { SampleMasterData } from "../../../../../data/sampling/sampleTypes";
import type { PopulationConfig, StageSamplingRule } from "../../../../../data/population/populationConfig";

type PhaseThreeSamplingProps = {
  populationRows: any[];

// Fix B — handleRuleChange value parameter (line 54)
  const handleRuleChange = (
    stageKey: "first" | "second" | "third" | "fourth",
    field: keyof StageSamplingRule,
    value: any
  ) => {

// Fix C — calculatedCount variable (line 78)
            let calculatedCount =
              rule.method === "percentage"
                ? Math.round((rule.value / 100) * size)
                : rule.value;
```

**After:**
```ts
// Fix A — add import and type populationRows
import type { PreparedPopulationRow } from "../../../../../data/population/populationTypes";
import type { SampleMasterData } from "../../../../../data/sampling/sampleTypes";
import type { PopulationConfig, StageSamplingRule } from "../../../../../data/population/populationConfig";

type PhaseThreeSamplingProps = {
  populationRows: PreparedPopulationRow[];

// Fix B — type value parameter
  const handleRuleChange = (
    stageKey: "first" | "second" | "third" | "fourth",
    field: keyof StageSamplingRule,
    value: StageSamplingRule[keyof StageSamplingRule]
  ) => {

// Fix C — use const (not reassigned)
            const calculatedCount =
              rule.method === "percentage"
                ? Math.round((rule.value / 100) * size)
                : rule.value;
```

---

## v5.21 — 2026-06-25 — Replace useState+useEffect for detectedDates with useMemo; suppress column-resize immutability lint

**File:** `src/components/DataTable/index.tsx`

**Before (Task 4 — detectedDates state + effect):**
```ts
const [detectedDates, setDetectedDates] = useState<Set<string>>(new Set());

// Auto-detect date columns from first 10 rows
useEffect(() => {
  const sample = rows.slice(0, 10);
  const detected = new Set<string>();
  for (const col of columns) {
    if (col.isDate) { detected.add(col.id); continue; }
    if (col.filterKind === "status") continue;
    for (const row of sample) {
      const v = col.accessor(row);
      if (v && looksLikeDate(v)) { detected.add(col.id); break; }
    }
  }
  setDetectedDates(detected);
}, [rows, columns]);
```

**After (Task 4 — useMemo, samples 200 rows):**
```ts
const detectedDates = useMemo<Set<string>>(() => {
  const sample = rows.length > 200 ? rows.slice(0, 200) : rows;
  const detected = new Set<string>();
  for (const col of columns) {
    if (col.isDate) { detected.add(col.id); continue; }
    if (col.filterKind === "status") continue;
    for (const row of sample) {
      const v = col.accessor(row);
      if (v && looksLikeDate(v)) { detected.add(col.id); break; }
    }
  }
  return detected;
}, [rows, columns]);
```

**Before (Task 5 — column-resize cursor mutations, no lint suppression):**
```ts
document.body.style.cursor     = "col-resize";
document.body.style.userSelect = "none";
```

**After (Task 5 — eslint-disable comments added):**
```ts
// eslint-disable-next-line react-hooks/immutability -- cursor change is a valid DOM side-effect in a mouse-event handler, not during render
document.body.style.cursor     = "col-resize";
// eslint-disable-next-line react-hooks/immutability -- same as above
document.body.style.userSelect = "none";
```

---

## v5.19 — 2026-06-25 — Remove explicit any and fix useMemo deps in PhaseFourDistribution

**File:** `src/components/Sidebar/Tabs/Population/components/PhaseFourDistribution.tsx`

**Before:**
```ts
// Fix A — import line (line 4)
import type { DistributionCurrentData } from "../../../../../data/distribution/distributionTypes";

// Fix B — prop type (line 28)
  onApplyBulkAssignment: (events: any[]) => Promise<void>;

// Fix C — getManagedLoginUsers callbacks (lines 61-62)
      .filter((u: any) => u.isActive)
      .map((u: any) => ({

// Fix D — handleAllocationChange val parameter (line 107)
    val: any

// Fix E — distribution entries map (line 157)
    (distributionCurrent?.entries ?? []).map((e: any) => [e.xrayImageId, e])

// Fix F — sampleDrawResult rows map (line 392)
            {sampleDrawResult.rows.map((row: any) => {

// Fix G — sampleRows plain assignment (line 70)
  const sampleRows = sampleDrawResult?.rows || [];

// Fix H — previewData useMemo missing deps (line 145)
  }, [sampleDrawResult, sampleRows, activeAllocations, employees, operatorUsername, config.stageMappings]);
```

**After:**
```ts
// Fix A — add DistributionEvent to import
import type { DistributionCurrentData, DistributionEvent } from "../../../../../data/distribution/distributionTypes";

// Fix B — typed prop
  onApplyBulkAssignment: (events: DistributionEvent[]) => Promise<void>;

// Fix C — inferred from ManagedLoginUser[]
      .filter((u) => u.isActive)
      .map((u) => ({

// Fix D — typed as union of EmployeeStageAllocation values
    val: EmployeeStageAllocation[keyof EmployeeStageAllocation]

// Fix E — inferred from DistributionEntry[]
    (distributionCurrent?.entries ?? []).map((e) => [e.xrayImageId, e])

// Fix F — inferred from SampleMasterData rows
            {sampleDrawResult.rows.map((row) => {

// Fix G — wrapped in useMemo
  const sampleRows = useMemo(() => sampleDrawResult?.rows ?? [], [sampleDrawResult]);

// Fix H — add saveMonth and saveYear to deps
  }, [sampleDrawResult, sampleRows, activeAllocations, employees, operatorUsername, config.stageMappings, saveMonth, saveYear]);
```

---

## v5.18 — 2026-06-25 — Remove explicit any annotations from MappingSettingsModal

**File:** `src/components/Sidebar/Tabs/Population/components/MappingSettingsModal.tsx`

**Before:**
```ts
// handleMappingChange
const updatedTemplates = config.mappingTemplates.map((t: any) =>

// handleBiMappingChange
const updatedTemplates = config.mappingTemplates.map((t: any) =>

// handleSheetPatternChange
const updatedTemplates = config.mappingTemplates.map((t: any) => {

// handleAddCustomField
if (config.systemFields.some((f: any) => f.key === key) || config.customFields.some((f: any) => f.key === key)) {
const updatedTemplates = config.mappingTemplates.map((t: any) => {
const updatedExportTemplates = config.exportTemplates.map((exp: any) => ({

// handleToggleSystemFieldRequired
const updated = config.systemFields.map((f: any) =>

// handleRemoveSystemField
const updatedFields = config.systemFields.filter((f: any) => f.key !== key);
const updatedTemplates = config.mappingTemplates.map((t: any) =>
const updatedExportTemplates = config.exportTemplates.map((exp: any) => ({
  ...exp,
  columns: exp.columns.filter((c: any) => c.fieldKey !== key)

// handleRemoveCustomField
const updatedCustomFields = config.customFields.filter((f: any) => f.key !== key);
const updatedTemplates = config.mappingTemplates.map((t: any) => {
const updatedExportTemplates = config.exportTemplates.map((exp: any) => ({
  ...exp,
  columns: exp.columns.filter((c: any) => c.fieldKey !== key)

// handleMoveColumn
  .sort((a: any, b: any) => a.order - b.order);
const idx = sorted.findIndex((c: any) => c.fieldKey === fieldKey);
config.exportTemplates.map((exp: any) => ({ ...exp, columns: newSorted }))

// handleExportColumnChange
const handleExportColumnChange = (fieldKey: string, field: keyof ExportColumnSetting, val: any) => {
  const updatedColumns = config.exportTemplates[0].columns.map((col: any) => {
  const updatedExportTemplates = config.exportTemplates.map((exp: any) => ({

// exports tab JSX
.sort((a: any, b: any) => a.order - b.order)
.map((col: any, idx: number, arr: any[]) => (
```

**After:**
```ts
// All `: any` removed — TypeScript infers from the typed arrays.
// val: any → val: ExportColumnSetting[keyof ExportColumnSetting]
// arr: any[] → arr: ExportColumnSetting[]
// All other callbacks: parameter type annotations dropped (inferred from typed arrays)
```

---

## v5.17 — 2026-06-25 — Add enterprise readiness implementation plan

**File:** `docs/superpowers/plans/2026-06-25-enterprise-readiness.md`

**Before:**
```
(file did not exist)
```

**After:**
```
# Enterprise Readiness Implementation Plan
[file created — 15-task plan covering ESLint error elimination, type safety, documentation, and v1.0.0 release]
```

---

## v4.5 — 2026-06-24 — Complete icon overhaul, semantic fixes, formatting utilities, type-safety hardening

Full icon pass: replace all remaining Unicode symbol characters (×, ✕, ✓, ›, ↺, ⊟, ⊞, ⊙, ◈, ◎, ⟳) with lucide-react components across 14 files. Improve semantically wrong icon choices in Settings LABEL_GROUPS and Reports. Create `src/utils/formatting.ts` to consolidate 3 duplicate `formatNumber` and 2 `formatDate` implementations. Remove `as any` casts in `Population/index.tsx`. Add null guards for `riskWorkbookResult` and `biWorkbookResult` in `PhaseTwoReportAndProcessing.tsx`. Decision: XrayReportsDashboard NOT restored — Reports tab already handles reporting; keeping data in Population tab would violate separation of concerns.

---

## v4.4 — 2026-06-24 — Replace all emoji characters with lucide-react SVG icons

Install `lucide-react` and replace every emoji/pictographic character in the UI with a proper SVG icon component. Files changed: `WorkspaceGate.tsx`, `ErrorBoundary.tsx`, `App.tsx`, `ErrorLogSection.tsx`, `Settings/index.tsx`, `CertScanGrid.tsx`, `MappingSettingsModal.tsx`, `PhaseFourDistribution.tsx`, `PhaseThreeSampling.tsx`, `PhaseTwoReportAndProcessing.tsx`, `DataAccuracyReport.tsx`, `Reports/index.tsx`, `Population/index.tsx`, `labelsStore.ts`.

**File:** `package.json`

**Before:**
```json
"dependencies": { "hash-wasm": ..., "react": ..., "react-dom": ..., "recharts": ..., "xlsx": ... }
```

**After:**
```json
"dependencies": { "hash-wasm": ..., "lucide-react": "^0.x", "react": ..., ... }
```

---

## v7.5 — 2026-06-28 — Report Designer: field catalog and data model (FEATURE)

Phase 0, Task 0.5: Create the field catalog (Arabic-labeled metadata for all ExecutiveReportRow fields) and the data model builder that feeds tables to the query engine. The field catalog defines FieldRole, FieldType, and FieldMeta for 24 fact table columns with complete Arabic localization. The data model builder ingests fact rows, port profiles, and stage profiles, then exposes them as named tables with full metadata for rendering tables, charts, and KPIs in the Report Designer.

**File:** `src/data/reportDesigner/query/fieldCatalog.ts` (new)

**Before:**
```ts
(new file)
```

**After:**
```ts
export type FieldRole = "dimension" | "measure";
export type FieldType = "string" | "number" | "boolean";
export type FieldMeta = { field: string; label: string; role: FieldRole; type: FieldType };

export const FACT_FIELDS: FieldMeta[] = [
  { field: "xrayImageId", label: "رقم صورة الأشعة", role: "dimension", type: "string" },
  { field: "portName", label: "الميناء", role: "dimension", type: "string" },
  // ... 22 more fields, all with Arabic labels
];

const BY_FIELD = new Map(FACT_FIELDS.map((f) => [f.field, f]));
export function getFieldMeta(field: string): FieldMeta | undefined {
  return BY_FIELD.get(field);
}
```

**File:** `src/data/reportDesigner/query/dataModel.ts` (new)

**Before:**
```ts
(new file)
```

**After:**
```ts
import type { ExecutiveReportRow } from "../../reporting/executiveReportTypes";
import { FACT_FIELDS, type FieldMeta } from "./fieldCatalog";

export type TableId = "fact" | "portProfiles" | "stageProfiles";
export type DataModelTable = {
  label: string;
  fields: FieldMeta[];
  rows: Array<Record<string, unknown>>;
};
export type DataModel = { tables: Record<TableId, DataModelTable> };

function inferFields(rows: Array<Record<string, unknown>>): FieldMeta[] {
  const sample = rows[0] ?? {};
  return Object.keys(sample).map((field) => {
    const v = sample[field];
    const type = typeof v === "number" ? "number" : typeof v === "boolean" ? "boolean" : "string";
    return { field, label: field, role: type === "number" ? "measure" : "dimension", type };
  });
}

export function buildDataModel(input: {
  factRows: ExecutiveReportRow[];
  portProfiles: Array<Record<string, unknown>>;
  stageProfiles: Array<Record<string, unknown>>;
}): DataModel {
  return {
    tables: {
      fact: {
        label: "بيانات الصور (تفصيلي)",
        fields: FACT_FIELDS,
        rows: input.factRows as unknown as Array<Record<string, unknown>>,
      },
      portProfiles: {
        label: "ملخص الموانئ",
        fields: inferFields(input.portProfiles),
        rows: input.portProfiles,
      },
      stageProfiles: {
        label: "ملخص المراحل",
        fields: inferFields(input.stageProfiles),
        rows: input.stageProfiles,
      },
    },
  };
}
```

**File:** `src/data/reportDesigner/query/dataModel.test.ts` (new)

**Before:**
```ts
(new file)
```

**After:**
```ts
import { describe, it, expect } from "vitest";
import { buildDataModel } from "./dataModel";
import { getFieldMeta } from "./fieldCatalog";
import { runQuery } from "./runQuery";

describe("fieldCatalog", () => {
  it("tags portName as a string dimension and exposes an Arabic label", () => {
    const meta = getFieldMeta("portName");
    expect(meta?.role).toBe("dimension");
    expect(meta?.type).toBe("string");
    expect(typeof meta?.label).toBe("string");
    expect(meta!.label.length).toBeGreaterThan(0);
  });
});

describe("buildDataModel", () => {
  it("exposes the fact table and supports a grouped query over it", () => {
    const factRows = [
      { portName: "ميناء أ", imageResult: "اشتباه" },
      { portName: "ميناء أ", imageResult: "سليمة" },
      { portName: "ميناء ب", imageResult: "اشتباه" },
    ];
    const model = buildDataModel({ factRows: factRows as never, portProfiles: [], stageProfiles: [] });
    expect(model.tables.fact.rows).toHaveLength(3);
    expect(model.tables.fact.fields.some((f) => f.field === "portName")).toBe(true);
    const out = runQuery(model.tables.fact.rows, {
      groupBy: ["portName"],
      values: [{ field: "portName", agg: "count" }],
      filters: [],
    });
    expect(out).toEqual([
      { portName: "ميناء أ", count_portName: 2 },
      { portName: "ميناء ب", count_portName: 1 },
    ]);
  });
});
```

---

## v5.16 — 2026-06-24 — Fix: remove lockout reset on username field change

**File:** `src/auth/AuthGate.tsx`

**Before:**
```tsx
<input
  id="authUsername"
  type="text"
  required
  autoComplete="username"
  placeholder="أدخل اسم المستخدم"
  value={selectedUsername}
  onChange={(event) => {
    setSelectedUsername(event.target.value);
    setFailedAttempts(0);
    setLockoutUntil(null);
  }}
/>
```

**After:**
```tsx
<input
  id="authUsername"
  type="text"
  required
  autoComplete="username"
  placeholder="أدخل اسم المستخدم"
  value={selectedUsername}
  onChange={(event) => {
    setSelectedUsername(event.target.value);
  }}
/>
```

**Reason:** Removed the `setFailedAttempts(0)` and `setLockoutUntil(null)` calls from the username field's `onChange` handler. These calls allowed a locked-out user to bypass the 30-second login throttle by simply typing in the username field, defeating the purpose of the rate-limit entirely. Lockout and attempt counter now only reset on successful login (which already happens in `loginAsEmployee`) or logout (which already happens in the `logout` callback). The password field's `onChange` correctly does not reset them.

---

## v5.15 — 2026-06-24 — Update CLAUDE.md to reflect Tasks 1-13 changes

**File:** `CLAUDE.md`

**Before:**
```markdown
   - `JsonEnvelope<TData>` wraps every JSON file: `{ metadata: { schemaVersion, revision, contentHash, ... }, data }`.
```

**After:**
```markdown
   - `JsonEnvelope<TData>` wraps every JSON file: `{ metadata: { schemaVersion, revision, contentHash, writtenAt }, data }`. Schema versioning via `wrap/unwrap/isEnvelope` in `src/data/storage/jsonEnvelope.ts`.
```

**Changes:**
- Updated JsonEnvelope description to list exact metadata fields (schemaVersion, revision, contentHash, writtenAt)
- Added reference to the factory functions in jsonEnvelope.ts

---

**File:** `CLAUDE.md` — Data-layer modules table

**Before:**
```markdown
| Preferences | `src/data/preferences/` | Browse preset storage |
```

**After:**
```markdown
| Preferences | `src/data/preferences/` | Browse preset storage |
| Error logger | `src/data/storage/errorLogger.ts` | In-memory ring buffer (last 50 entries) for silent-catch observability; `logError`, `getRecentErrors`, `clearErrors` |
| JsonEnvelope | `src/data/storage/jsonEnvelope.ts` | Schema versioning wrapper for all `safeWriteJson` writes; `wrap`, `isEnvelope`, `unwrap` factory functions |
```

**Changes:**
- Added Error logger module row (50-entry ring buffer, accessible via getRecentErrors())
- Added JsonEnvelope module row (schema versioning wrapper with factory functions)

---

**File:** `CLAUDE.md` — Shared UI components table

**Before:**
```markdown
| `ErrorBoundary` | `src/components/ErrorBoundary.tsx` | Top-level React error boundary |
```

**After:**
```markdown
| `ErrorBoundary` | `src/components/ErrorBoundary.tsx` | Top-level React error boundary |
| `AdminToolbar` | `src/auth/AdminToolbar.tsx` | Role-preview segmented switch, logout button, feedback toggle (admin-only) |
```

**Changes:**
- Added AdminToolbar component row (extracted role-preview toolbar component)

---

**File:** `CLAUDE.md` — Reporting module description

**Before:**
```markdown
| Reporting | `src/data/reporting/` | Self-contained Arabic HTML report builders (sample + distribution) |
```

**After:**
```markdown
| Reporting | `src/data/reporting/` | Self-contained Arabic HTML report builders (sample + distribution + executive) |
```

**Changes:**
- Updated to include executive report (added in v4.0, now reflected in docs)

---

## v5.14 — 2026-06-24 — Broaden isEnvelope guard to detect workspace-style string schemaVersion

**File:** `src/data/storage/jsonEnvelope.ts`

**Before:**
```ts
export function isEnvelope(value: unknown): value is JsonEnvelope<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "metadata" in value &&
    "data" in value &&
    typeof (value as JsonEnvelope<unknown>).metadata?.schemaVersion === "number"
  );
}
```

**After:**
```ts
export function isEnvelope(value: unknown): value is JsonEnvelope<unknown> {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (!("metadata" in v) || !("data" in v)) return false;
  const m = v["metadata"];
  if (!m || typeof m !== "object") return false;
  return "schemaVersion" in (m as object);
}
```

---

**File:** `src/data/storage/jsonEnvelope.test.ts`

**Before:**
```ts
// ended at: increments revision from previous test
```

**After:**
```ts
// added two new tests:
// - isEnvelope returns true for workspace-style envelope (string schemaVersion)
// - isEnvelope returns false for object missing metadata.schemaVersion
```

---

## v5.13 — 2026-06-24 — Add JsonEnvelope schema versioning to safeWriteJson / safeReadJson

**File:** `src/data/storage/jsonEnvelope.ts` *(new file)*

**Before:**
```ts
// (file did not exist)
```

**After:**
```ts
// New JsonEnvelope<T> type + wrap/unwrap/isEnvelope factory functions
// wrap: adds { metadata: { schemaVersion, revision, contentHash, writtenAt }, data }
// unwrap: returns data from envelope or value as-is for legacy bare files
```

---

**File:** `src/data/storage/jsonEnvelope.test.ts` *(new file)*

**Before:**
```ts
// (file did not exist)
```

**After:**
```ts
// 6 Vitest tests covering wrap, isEnvelope, unwrap (including legacy bare-data path)
```

---

**File:** `src/data/storage/safeWrite.ts`

**Before:**
```ts
const serialized = `${JSON.stringify(value, null, 2)}\n`;
// ...
value: JSON.parse(live as string) as T,
// ...
value: JSON.parse(bak as string) as T,
```

**After:**
```ts
// isEnvelope guard prevents double-wrapping when callers (e.g. saveWithRevision)
// already build the envelope manually
const serialized = `${JSON.stringify(isEnvelope(value) ? value : wrap(value), null, 2)}\n`;
// ...
value: unwrap<T>(JSON.parse(live as string)),
// ...
value: unwrap<T>(JSON.parse(bak as string)),
```

---

**File:** `src/data/storage/safeWrite.test.ts`

**Before:**
```ts
const bak = JSON.parse(await readRaw(dir, "a.json.bak")) as { v: number };
const live = JSON.parse(await readRaw(dir, "a.json")) as { v: number };
expect(bak.v).toBe(1);
expect(live.v).toBe(2);
```

**After:**
```ts
const bak = JSON.parse(await readRaw(dir, "a.json.bak")) as { data: { v: number } };
const live = JSON.parse(await readRaw(dir, "a.json")) as { data: { v: number } };
expect(bak.data.v).toBe(1);
expect(live.data.v).toBe(2);
```

---

**File:** `src/data/storage/fileSystemAccess.test.ts`

**Before:**
```ts
const live = await readJsonFile<{ a: number }>(dir, "x.json");
const bak = await readJsonFile<{ a: number }>(dir, "x.json.bak");
expect(live.ok && live.file.a).toBe(2);
expect(bak.ok && bak.file.a).toBe(1);
```

**After:**
```ts
const live = await readJsonFile<{ data: { a: number } }>(dir, "x.json");
const bak = await readJsonFile<{ data: { a: number } }>(dir, "x.json.bak");
expect(live.ok && live.file.data.a).toBe(2);
expect(bak.ok && bak.file.data.a).toBe(1);
```

---

## v5.12 — 2026-06-24 — Surface error log in Settings tab (admin only, collapsible)

**File:** `src/components/Sidebar/Tabs/Settings/ErrorLogSection.tsx` *(new file)*

**Before:**
```ts
// (file did not exist)
```

**After:**
```tsx
// New ErrorLogSection component — admin-only collapsible error log viewer
// Uses getRecentErrors / clearErrors from errorLogger; role-gated via usePermissions
```

---

**File:** `src/components/Sidebar/Tabs/Settings/ErrorLogSection.css` *(new file)*

**Before:**
```css
/* (file did not exist) */
```

**After:**
```css
/* Styles for ErrorLogSection component */
```

---

**File:** `src/components/Sidebar/Tabs/Settings/index.tsx`

**Before:**
```tsx
// No import of ErrorLogSection
// SettingsPage renders only label-customization sections
```

**After:**
```tsx
import { ErrorLogSection } from "./ErrorLogSection";
// SettingsPage renders ErrorLogSection below label sections (admin-only, collapsible)
```

---

## v5.11 — 2026-06-24 — Parallelize listMonthSummaries with Promise.allSettled

**File:** `src/data/population/populationStorage.ts`

**Before:**
```ts
export async function listMonthSummaries(
  directoryHandle: DirectoryHandleLike
): Promise<MonthSummary[]> {
  const infos = await listMonthFolders(directoryHandle);
  const results: MonthSummary[] = [];

  let populationDir: DirectoryHandleLike;
  try {
    populationDir = await getPopulationRoot(directoryHandle, false);
  } catch { return []; }

  for (const info of infos) {
    try {
      const monthDir = await populationDir.getDirectoryHandle(
        info.folderName, { create: false }
      );

      const manifestResult = await safeReadJson<MonthManifestData>(
        monthDir, "month.manifest.json"
      );
      const manifest = manifestResult.ok ? manifestResult.value : null;

      let hasPopulation = false;
      let totalProcessedRows = manifest?.totalProcessedRows ?? 0;
      try {
        const processedDir = await monthDir.getDirectoryHandle("processed", { create: false });
        const popResult = await safeReadJson<PopulationFinalData>(processedDir, "population.final.json");
        hasPopulation = popResult.ok;
        if (popResult.ok) totalProcessedRows = popResult.value.totalRows;
      } catch { /* directory missing */ }

      let hasSample = false;
      {
        const sampleDir = await resolveSampleDir(directoryHandle, info.folderName, monthDir);
        if (sampleDir) {
          const sResult = await safeReadJson<SampleMasterData>(sampleDir, "sample.master.json");
          hasSample = sResult.ok;
        }
      }

      let hasDistribution = false;
      try {
        const sampleDir = await getSampleMainDir(directoryHandle, info.folderName, false);
        const dResult = await safeReadJson<DistributionCurrentData>(sampleDir, "distribution.current.json");
        hasDistribution = dResult.ok;
      } catch {
        try {
          const dResult = await safeReadJson<DistributionCurrentData>(monthDir, "distribution.current.json");
          hasDistribution = dResult.ok;
        } catch { /* file missing */ }
      }

      results.push({ info, manifest, hasPopulation, hasSample, hasDistribution, totalProcessedRows });
    } catch {
      // skip inaccessible month folders
    }
  }

  // newest first
  return results.reverse();
}
```

**After:**
```ts
export async function listMonthSummaries(
  directoryHandle: DirectoryHandleLike
): Promise<MonthSummary[]> {
  const infos = await listMonthFolders(directoryHandle);

  let populationDir: DirectoryHandleLike;
  try {
    populationDir = await getPopulationRoot(directoryHandle, false);
  } catch { return []; }

  const settled = await Promise.allSettled(
    infos.map(async (info) => {
      const monthDir = await populationDir.getDirectoryHandle(
        info.folderName, { create: false }
      );

      const manifestResult = await safeReadJson<MonthManifestData>(
        monthDir, "month.manifest.json"
      );
      const manifest = manifestResult.ok ? manifestResult.value : null;

      let hasPopulation = false;
      let totalProcessedRows = manifest?.totalProcessedRows ?? 0;
      try {
        const processedDir = await monthDir.getDirectoryHandle("processed", { create: false });
        const popResult = await safeReadJson<PopulationFinalData>(processedDir, "population.final.json");
        hasPopulation = popResult.ok;
        if (popResult.ok) totalProcessedRows = popResult.value.totalRows;
      } catch { /* directory missing */ }

      let hasSample = false;
      {
        const sampleDir = await resolveSampleDir(directoryHandle, info.folderName, monthDir);
        if (sampleDir) {
          const sResult = await safeReadJson<SampleMasterData>(sampleDir, "sample.master.json");
          hasSample = sResult.ok;
        }
      }

      let hasDistribution = false;
      try {
        const sampleDir = await getSampleMainDir(directoryHandle, info.folderName, false);
        const dResult = await safeReadJson<DistributionCurrentData>(sampleDir, "distribution.current.json");
        hasDistribution = dResult.ok;
      } catch {
        try {
          const dResult = await safeReadJson<DistributionCurrentData>(monthDir, "distribution.current.json");
          hasDistribution = dResult.ok;
        } catch { /* file missing */ }
      }

      return { info, manifest, hasPopulation, hasSample, hasDistribution, totalProcessedRows };
    })
  );

  const results: MonthSummary[] = settled
    .filter((r): r is PromiseFulfilledResult<MonthSummary> => r.status === "fulfilled")
    .map((r) => r.value);

  // newest first
  return results.reverse();
}
```

---

## v5.10 — 2026-06-24 — Add distributionStorage integration tests

**File:** `src/data/distribution/distributionStorage.test.ts`

**Before:**
```ts
// (file did not exist)
```

**After:**
```ts
// New test file covering append-to-empty-log, single-event read-back,
// and multiple sequential appends via appendDistributionEvent + loadDistributionLog
```

---

## v5.9 — 2026-06-24 — Add React component smoke tests for AuthGate login flow

**File:** `vitest.config.ts`

**Before:**
```ts
include: ["src/**/*.test.ts"],
```

**After:**
```ts
include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
```

---

**File:** `src/auth/AuthGate.test.tsx` (created)

**Before:**
```ts
// Did not exist
```

**After:**
```tsx
/* @vitest-environment jsdom */
// Two smoke tests: login form renders, wrong password shows error
```

---

## v5.8 — 2026-06-24 — Add centralized error logger, wire up key silent catches in populationStorage

**File:** `src/data/storage/errorLogger.ts` (created)

**Before:**
```ts
// Did not exist
```

**After:**
```ts
export type ErrorEntry = { context: string; message: string; timestamp: string; };
const MAX_ENTRIES = 50;
const entries: ErrorEntry[] = [];
export function logError(context: string, error: unknown): void { ... }
export function getRecentErrors(): ErrorEntry[] { return entries.slice(); }
export function clearErrors(): void { entries.length = 0; }
```

---

**File:** `src/data/storage/errorLogger.test.ts` (created)

**Before:**
```ts
// Did not exist
```

**After:**
```ts
// Three Vitest tests: stores logged errors, caps at 50 entries, clearErrors empties the log
```

---

**File:** `src/data/population/populationStorage.ts`

**Before:**
```ts
import { safeWriteJson, safeReadJson } from "../storage/safeWrite";
// ...
  } catch { /* skip if FS API unavailable */ }
// ...
  } catch {
    return [];
  }
// ...
    } catch { /* skip inaccessible */ }
```

**After:**
```ts
import { safeWriteJson, safeReadJson } from "../storage/safeWrite";
import { logError } from "../storage/errorLogger";
// ...
  } catch (error) {
    logError("saveBinaryFile", error);
  }
// ...
  } catch (error) {
    logError("listMonthFolders", error);
    return [];
  }
// ...
    } catch (error) {
      logError("loadAllPopulationRows", error);
    }
```

---

## v5.7 — 2026-06-24 — Extract AdminToolbar component from AuthGate

**File:** `src/auth/AdminToolbar.tsx` (created)

**Before:**
```tsx
// Did not exist
```

**After:**
```tsx
// New standalone component receiving session, previewRole, onPreviewRoleChange, onLogout, onFeedback props
// Contains PREVIEW_ROLE_IDS, getRoleLabel, and all toolbar JSX
export function AdminToolbar({ session, previewRole, onPreviewRoleChange, onLogout, onFeedback }: AdminToolbarProps) { ... }
```

---

**File:** `src/auth/AdminToolbar.css` (created)

**Before:**
```css
/* Did not exist */
```

**After:**
```css
/* Toolbar-specific CSS rules moved from AuthGate.css:
   .auth-admin-toolbar, .auth-toolbar-*, .auth-role-*, .auth-preview-* */
```

---

**File:** `src/auth/AuthGate.tsx`

**Before:**
```tsx
const PREVIEW_ROLE_IDS: AuthRole[] = ["admin", "manager", "supervisor", "employee", "guest"];
function getRoleLabel(role: AuthRole): string { ... }
function toggleFeedbackPanel(): void { window.dispatchEvent(new CustomEvent("feedback:toggle")); }
// ... toolbar JSX inline in authenticated branch (~55 lines)
```

**After:**
```tsx
import { AdminToolbar } from "./AdminToolbar";
// PREVIEW_ROLE_IDS, getRoleLabel, toggleFeedbackPanel removed
// Toolbar JSX replaced with:
<AdminToolbar session={session} previewRole={previewRole} onPreviewRoleChange={changePreviewRole} onLogout={logout} onFeedback={() => window.dispatchEvent(new CustomEvent("feedback:toggle"))} />
```

---

**File:** `src/auth/AuthGate.css`

**Before:**
```css
/* ~170 lines of toolbar rules: .auth-admin-toolbar, .auth-toolbar-*, .auth-role-*, .auth-preview-* */
```

**After:**
```css
/* Toolbar rules removed — now live in AdminToolbar.css */
```

---

## v5.6 — 2026-06-24 — Extract resolveSampleDir helper, deduplicate dual-path fallback

**File:** `src/data/population/populationStorage.ts`

**Before:**
```ts
// Three inline try/catch dual-path blocks like:
try {
  const sampleDir = await getSampleMainDir(directoryHandle, info.folderName, false);
  // ... use sampleDir
} catch {
  try {
    const sampleDir = await monthDir.getDirectoryHandle("sample", { create: false });
    // ... use sampleDir
  } catch { /* directory missing */ }
}
```

**After:**
```ts
// Single private helper:
async function resolveSampleDir(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  monthDir: DirectoryHandleLike
): Promise<DirectoryHandleLike | null> {
  try {
    return await getSampleMainDir(directoryHandle, monthFolderName, false);
  } catch {
    try {
      return await monthDir.getDirectoryHandle("sample", { create: false });
    } catch {
      return null;
    }
  }
}
// All three call-sites replaced with: const sampleDir = await resolveSampleDir(...); if (!sampleDir) ...
```

**File:** `src/data/population/populationStorage.test.ts`

**Before:**
```ts
// No test for legacy sample path fallback
```

**After:**
```ts
// Added: "loadAllSampleRows falls back to legacy sample path when getSampleMainDir throws"
```

---

## v5.5 — 2026-06-24 — Move App.tsx inline styles to CSS classes

**File:** `src/App.css`

**Before:**
```css
/* (no .app-bak-warning, .app-bak-warning-close, .app-no-tabs classes) */
```

**After:**
```css
.app-bak-warning {
  position: fixed;
  top: 0;
  inset-inline: 0;
  z-index: 9999;
  background: #fef3c7;
  border-bottom: 1px solid #f59e0b;
  padding: 10px 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
  color: #92400e;
  direction: rtl;
}

.app-bak-warning-close {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 20px;
  color: #92400e;
  line-height: 1;
  padding: 0 4px;
}

.app-no-tabs {
  min-height: calc(100vh - 44px);
  display: grid;
  place-items: center;
  padding: 24px;
  color: #475467;
  text-align: center;
}

.app-no-tabs h1 {
  margin: 0 0 10px;
  color: #17365d;
  font-size: 24px;
}

.app-no-tabs p {
  margin: 0;
  line-height: 1.8;
}
```

**File:** `src/App.tsx`

**Before:**
```tsx
{bakWarning && (
  <div
    style={{
      position: "fixed",
      top: 0,
      insetInline: 0,
      zIndex: 9999,
      background: "#fef3c7",
      borderBottom: "1px solid #f59e0b",
      padding: "10px 16px",
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      fontSize: 13,
      color: "#92400e",
      direction: "rtl",
    }}
  >
    <span>⚠️ {bakWarning}</span>
    <button
      onClick={() => setBakWarning(null)}
      style={{
        background: "none",
        border: "none",
        cursor: "pointer",
        fontSize: 20,
        color: "#92400e",
        lineHeight: 1,
        padding: "0 4px",
      }}
      aria-label="إغلاق"
    >
      ×
    </button>
  </div>
)}

// …

function NoAvailableTabs({ role }: { role: AuthSession["role"] }) {
  return (
    <div className="tab-blank" dir="rtl">
      <div
        style={{
          minHeight: "calc(100vh - 44px)",
          display: "grid",
          placeItems: "center",
          padding: "24px",
          color: "#475467",
          textAlign: "center"
        }}
      >
        <div>
          <h1
            style={{
              margin: "0 0 10px",
              color: "#17365d",
              fontSize: "24px"
            }}
          >
            لا توجد تبويبات متاحة
          </h1>

          <p style={{ margin: 0, lineHeight: 1.8 }}>
            لا توجد صفحات مفعلة لهذا الدور حالياً: <strong>{role}</strong>
          </p>
        </div>
      </div>
    </div>
  );
}
```

**After:**
```tsx
{bakWarning && (
  <div className="app-bak-warning">
    <span>⚠️ {bakWarning}</span>
    <button
      onClick={() => setBakWarning(null)}
      className="app-bak-warning-close"
      aria-label="إغلاق"
    >
      ×
    </button>
  </div>
)}

// …

function NoAvailableTabs({ role }: { role: AuthSession["role"] }) {
  return (
    <div className="tab-blank" dir="rtl">
      <div className="app-no-tabs">
        <div>
          <h1>لا توجد تبويبات متاحة</h1>
          <p>لا توجد صفحات مفعلة لهذا الدور حالياً: <strong>{role}</strong></p>
        </div>
      </div>
    </div>
  );
}
```

---

## v5.4 — 2026-06-24 — Add keyboard focus trap to admin passcode modal

**File:** `src/auth/AuthGate.tsx`

**Before:**
```tsx
// No focus trap refs or effects existed.
// closeAdminModal() did not restore focus.
// setIsAdminModalOpen(true) call did not capture trigger element.
// <section className="auth-admin-modal"> had no ref.

function closeAdminModal(): void {
  setIsAdminModalOpen(false);
  setAdminPasscode("");
}

// In handleHiddenAdminShortcut:
setIsAdminModalOpen(true);

// <section className="auth-admin-modal" ...>
```

**After:**
```tsx
// Added refs:
const adminModalRef = useRef<HTMLElement | null>(null);
const triggerRef = useRef<HTMLElement | null>(null);

// Added focus-trap useEffect (activates when isAdminModalOpen === true).
// closeAdminModal() now restores focus via triggerRef.current?.focus().
// handleHiddenAdminShortcut captures document.activeElement into triggerRef before opening.
// <section className="auth-admin-modal" ref={adminModalRef as React.RefObject<HTMLElement>}>
```

---

## v5.3 — 2026-06-24 — Add 3-attempt login lockout with 30-second countdown

**File:** `src/auth/AuthGate.tsx`

**Before:**
```tsx
// No rate-limiting state or lockout logic existed.
// Submit button:
<button className="auth-submit" type="submit">
  دخول
</button>

// loginAsEmployee: wrong-password error shown immediately with no throttle.
showMessage("كلمة المرور غير صحيحة.", "bad");

// logout callback: only cleared session/UI state.
// setSelectedUsername onChange: only called setSelectedUsername.
```

**After:**
```tsx
// Added state:
const [failedAttempts, setFailedAttempts] = useState(0);
const [lockoutUntil, setLockoutUntil] = useState<number | null>(null);
const [lockoutSecondsLeft, setLockoutSecondsLeft] = useState(0);
const LOCKOUT_AFTER_ATTEMPTS = 3;
const LOCKOUT_DURATION_MS = 30_000;

// Added countdown effect (clears interval on unmount).
// loginAsEmployee: early-returns during active lockout; increments failedAttempts;
//   triggers lockout after LOCKOUT_AFTER_ATTEMPTS failures; resets on success.
// Submit button: disabled during lockout; shows countdown label in Arabic.
// setSelectedUsername onChange: also resets failedAttempts + lockoutUntil.
// logout callback: also resets failedAttempts + lockoutUntil.
```

---

## v5.2 — 2026-06-24 — Add aria-label to admin passcode input, fix auth-message bad-class binding

**File:** `src/auth/AuthGate.tsx`

**Before:**
```tsx
// Admin passcode input (line 547):
<input
  type="password"
  autoFocus
  value={adminPasscode}
  onChange={(event) => setAdminPasscode(event.target.value)}
  onKeyDown={handleAdminModalKeyDown}
  placeholder="رمز مسؤول النظام"
/>

// Employee login message (line 506):
<div
  className={`auth-message ${messageType === "ok" ? "ok" : ""}`}
  aria-live="polite"
>
  {message}
</div>
```

**After:**
```tsx
// Admin passcode input with aria-label for screen readers:
<input
  type="password"
  autoFocus
  aria-label="رمز مسؤول النظام"
  value={adminPasscode}
  onChange={(event) => setAdminPasscode(event.target.value)}
  onKeyDown={handleAdminModalKeyDown}
  placeholder="رمز مسؤول النظام"
/>

// Message div now applies both "ok" and "bad" classes correctly:
<div
  className={`auth-message${messageType ? ` ${messageType}` : ""}`}
  aria-live="polite"
>
  {message}
</div>
```

**File:** `src/auth/AuthGate.css`

**Before:**
```css
.auth-message {
  min-height: 24px;
  color: var(--auth-danger);
  font-size: 13px;
  font-weight: 600;
  line-height: 1.6;
  padding: 2px 0;
}

.auth-message.ok {
  color: var(--auth-success);
}
```

**After:**
```css
.auth-message {
  min-height: 24px;
  color: inherit;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.6;
  padding: 2px 0;
}

.auth-message.bad {
  color: var(--auth-danger);
}

.auth-message.ok {
  color: var(--auth-success);
}
```

---

## v5.1 — 2026-06-24 — Remove dead SESSION_KEY constant

**File:** `src/auth/authConfig.ts`

**Before:**
```ts
export const SESSION_KEY = "xray_local_login_session_v1";
```

**After:**
*(line removed)*

---

## v5.0 — 2026-06-24 — Workspace path restructuring, runtime-only auth session, samples mirror module

**Summary:** Major architectural refactor across 39 files covering:
1. Numbered workspace folder layout (`1-Population`, `2-Samples`, `3-User Data`, `4-Reports`, `5-System`, `6-Templates`) with legacy-path migration fallback.
2. Auth session and preview-role state moved from `localStorage`/`sessionStorage` to module-level runtime variables — no browser storage dependency for session.
3. `handleStore.ts` deleted; workspace handle persistence removed from the storage layer.
4. New `src/data/workspace/workspacePaths.ts` — centralised path helpers (`getPopulationRoot`, `getSampleMainDir`, `getSampleEmployeeDir`, `getUserDataRoot`, `safeWorkspaceFilePart`).
5. New `src/data/samples/sampleMirrorStorage.ts` — syncs `main.samples.json` and per-employee `{username}.samples.json` mirror files into `2-Samples/` after each distribution update.
6. `answerStorage.ts` — uses new path helpers; adds legacy-path fallback and CAS loop for concurrent write safety.
7. `UserManagement` tab — adds in-place identity editing (username + displayName), routes `users-permissions.json` to `3-User Data/`.
8. `WorkspaceProvider.tsx` refactored (~366 → ~284 lines): removes `handleStore` import, uses `createDefaultManagedUsers` for first-time workspace init.
9. UI polish across AuthGate, DataTable, FeedbackWidget, Sidebar, Reports, EmployeeWorkspace (XrayInspectionResults, XrayReferrals).

**File:** `src/data/workspace/workspacePaths.ts` *(new)*

**Before:** *(file did not exist)*

**After:**
```ts
export const WORKSPACE_ROOTS = {
  population: "1-Population",
  samples: "2-Samples",
  userData: "3-User Data",
  reports: "4-Reports",
  system: "5-System",
  templates: "6-Templates",
} as const;
// + path-helper functions with legacy fallback
```

---

**File:** `src/data/samples/sampleMirrorStorage.ts` *(new)*

**Before:** *(file did not exist)*

**After:**
```ts
// syncSampleMirrors() writes main.samples.json + {username}.samples.json
// into 2-Samples/{month}/ after each distribution event.
```

---

**File:** `src/auth/authSession.ts`

**Before:**
```ts
// Session stored in localStorage with SESSION_KEY.
// Preview role stored in sessionStorage with PREVIEW_ROLE_KEY.
export function readRealSession(): AuthSession | null {
  const rawValue = localStorage.getItem(SESSION_KEY);
  // ...
}
```

**After:**
```ts
// Auth state is intentionally runtime-only.
let runtimeSession: AuthSession | null = null;
let runtimePreviewRole: AuthRole | null = null;
export function readRealSession(): AuthSession | null {
  if (!runtimeSession || !isValidSession(runtimeSession) || isExpired(runtimeSession)) {
    runtimeSession = null;
  }
  return runtimeSession;
}
```

---

**File:** `src/data/storage/handleStore.ts` *(deleted)*

**Before:**
```ts
// Persisted workspace directory handle in IndexedDB.
export async function loadWorkspaceHandle(): Promise<...>
export async function saveWorkspaceHandle(handle: ...): Promise<void>
export async function clearWorkspaceHandle(): Promise<void>
```

**After:** *(file deleted — handle persistence removed)*

---

## v4.11 — 2026-06-24 — InspectionPanel: fix toolbar position + full-height panel

**Root cause:** `DataTable` renders a Fragment (`<>...</>`). When placed directly as a flex child of `.ew-split`, its toolbar and table body each become separate flex items in the RTL row — causing the toolbar to appear as a side column to the right of the rows instead of above them.

**File:** `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx`
- Wrapped `tableEl` in `<div className="ew-split-table">` so the DataTable fragment resolves to a single flex child.

**File:** `src/components/Sidebar/Tabs/EmployeeWorkspace/EmployeeWorkspace.css`
- Added `.ew-split-table { flex: 1; min-width: 0; overflow: hidden }` — replaces the now-unused `.ew-split--right > :first-child` rule.

**File:** `src/components/InspectionPanel/InspectionPanel.css`
- Changed `.ip-panel--right` from `max-height: calc(100vh - 32px)` to `height: 100vh; top: 0` so the panel always matches the full visible viewport height (same visual height as the table area).

---

## v4.10 — 2026-06-24 — InspectionPanel: fix footer, remove duplicate chips, always-on panel

**File:** `src/components/InspectionPanel/InspectionPanel.css`
- Added `min-height: 0` to `.ip-form-body` so the form body shrinks within the constrained panel height and the footer (حفظ مسودة / تقديم buttons) is always visible.

**File:** `src/components/InspectionPanel/PanelHeader.tsx`
- Removed `ip-meta-chips` section and the `visibleColumns` / `colConfig` props — the DataTable columns on the right already show the same data, so the chips were duplicate.

**File:** `src/components/InspectionPanel/index.tsx`
- Removed `visibleColumns` and `colConfig` from `Props` and the `PanelHeader` call.
- Removed the `DataTableCol` / `ColConfig` import.

**File:** `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx`
- Added `useEffect` that auto-selects the first entry whenever `displayEntries` changes and the current selection is invalid — panel is always visible when there is data.
- Changed `onRowClick` from toggle (clicking same row closed panel) to always-select.
- Removed `visibleColumns` and `colConfig` from the `InspectionPanel` call site.

---

## v4.9 — 2026-06-24 — InspectionPanel: sticky viewport layout + true split-screen bottom mode

**File:** `src/components/InspectionPanel/InspectionPanel.css`

**Before:**
```css
.ip-panel--right {
  width: 480px;
  min-height: 520px;
}
.ip-panel--bottom {
  width: 100%;
  max-height: 46vh;
  min-height: 320px;
}
```

**After:**
```css
.ip-panel--right {
  width: 480px;
  flex-shrink: 0;
  position: sticky;
  top: 16px;
  max-height: calc(100vh - 32px);
  align-self: flex-start;
}
.ip-panel--bottom {
  width: 100%;
  height: 42vh;
  min-height: 300px;
  flex-shrink: 0;
}
```

**File:** `src/components/Sidebar/Tabs/EmployeeWorkspace/EmployeeWorkspace.css`

**Before:**
```css
.ew-split--bottom {
  flex-direction: column;
}
```

**After:**
```css
.ew-split--bottom {
  flex-direction: column;
  overflow: hidden;
  max-height: calc(100vh - 220px);
  min-height: 500px;
}
.ew-split--bottom > :first-child {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
```

---

## v4.8 — 2026-06-24 — InspectionPanel: side-panel layout for sample review

Replaced the inline table-row expand form with a dedicated `InspectionPanel` component rendered alongside the DataTable. Employees can toggle the panel between right and bottom positions; the choice is saved to their browse preset JSON. The panel shows a visual phase stepper, a metadata header that mirrors the user's active column selection, a single-column form, and a sticky footer with save/submit actions.

**Files:** `src/components/InspectionPanel/` (new), `src/data/preferences/browsePresetStorage.ts`, `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx`, `src/components/Sidebar/Tabs/EmployeeWorkspace/EmployeeWorkspace.css`

---

## v4.7 — 2026-06-24 — Cascade condition support + default template "no image" logic

**Files:** `src/data/templates/templateRuntime.ts`, `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx`, `src/components/Sidebar/Tabs/EmployeeWorkspace/views/EmployeeDashboard.tsx`, `src/components/Sidebar/Tabs/TemplateBuilder/index.tsx`

Added cascade condition evaluation to `isFieldVisible`: when a source field is itself hidden, all fields that depend on it are also hidden automatically (no need to duplicate conditions). Updated all call sites to pass `template.fields` for cascade resolution.

Updated `buildDefaultInspectionTemplate`: When "هل يوجد صورة" = "لا", Phase 2 (ضمان جودة النتيجة) collapses entirely, and Phase 1 fields "هل يوجد تحديد", "مستوى جودة الصورة", and "الملاحظات العامة" also hide. "اسباب انخفاض جودة الصورة" and its sub-field hide automatically via cascade from "مستوى جودة الصورة".

**Before (`templateRuntime.ts`):**
```ts
export function isFieldVisible(
  field: TemplateField,
  answers: Record<string, TemplateAnswerValue>
): boolean {
  if (!field.condition?.sourceFieldId) return true;
  return evaluateCondition(field.condition, answers[field.condition.sourceFieldId]);
}

// getVisibleTemplateFields used isFieldVisible(field, answers)
```

**After (`templateRuntime.ts`):**
```ts
export function isFieldVisible(
  field: TemplateField,
  answers: Record<string, TemplateAnswerValue>,
  allFields?: TemplateField[]
): boolean {
  if (!field.condition?.sourceFieldId) return true;
  if (allFields) {
    const src = allFields.find(f => f.fieldId === field.condition!.sourceFieldId);
    if (src && !isFieldVisible(src, answers, allFields)) return false;
  }
  return evaluateCondition(field.condition, answers[field.condition.sourceFieldId]);
}

// getVisibleTemplateFields now passes schema.fields for cascade
```

---

## v4.6 — 2026-06-24 — Workspace repair for invalid_structure on new PC

**File:** `src/data/workspace/WorkspaceGate.tsx`

When a workspace is copied to a new PC (USB, ZIP transfer, etc.) some root-level JSON files may be corrupted or truncated in transit, producing `invalid_structure` status. Previously the admin saw only "pick another folder" with no recovery path. This fix adds a repair flow for admins: shows which files are invalid, warns that repair will recreate system files (user accounts may need re-adding), and offers a "إصلاح بنية مساحة العمل" button that calls `createInitialStructure` — the same function used for `missing_structure`. Population data (`Population/` folder) is never touched.

**Before:**
```tsx
// invalid_structure, error, permission_denied
return (
  <div className="workspace-gate" dir="rtl">
    <div className="workspace-gate-card">
      <div className="workspace-gate-icon">❌</div>
      <h2>تعذر فتح مساحة العمل</h2>
      <p>{message}</p>
      <button
        type="button"
        onClick={() => {
          void selectWorkspace();
        }}
      >
        اختيار مجلد آخر
      </button>
    </div>
  </div>
);
```

**After:**
```tsx
// invalid_structure with admin — offer repair
if (status === "invalid_structure") {
  const isAdmin = session.role === "admin";
  if (isAdmin) {
    return (
      <div className="workspace-gate" dir="rtl">
        <div className="workspace-gate-card">
          <div className="workspace-gate-icon">🔧</div>
          <h2>ملفات مساحة العمل تالفة أو غير متوافقة</h2>
          <p>
            تم العثور على المجلد لكن بعض ملفات النظام تالفة أو بإصدار غير متوافق.
            يمكنك إصلاح البنية الآن — لن تتأثر بيانات السكان والعينات.
          </p>
          <p className="workspace-gate-warn">
            ⚠ قد تحتاج إلى إعادة إضافة حسابات الموظفين بعد الإصلاح.
          </p>
          {invalidItems.length > 0 && (
            <ul className="workspace-gate-missing">
              {invalidItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
          <button type="button" onClick={() => { void createInitialStructure(session.username); }}>
            إصلاح بنية مساحة العمل
          </button>
          <button type="button" className="secondary" onClick={() => { void selectWorkspace(); }}>
            اختيار مجلد آخر
          </button>
        </div>
      </div>
    );
  }
}

// error, permission_denied, invalid_structure (non-admin)
return (
  <div className="workspace-gate" dir="rtl">
    <div className="workspace-gate-card">
      <div className="workspace-gate-icon">❌</div>
      <h2>تعذر فتح مساحة العمل</h2>
      <p>{message}</p>
      <button type="button" onClick={() => { void selectWorkspace(); }}>
        اختيار مجلد آخر
      </button>
    </div>
  </div>
);
```

---

## v4.5 — 2026-06-24 — Smart result-value normalization in BI vs Risk comparison + default inspection template

Two independent features:

1. **DataAccuracyReport** (`DataAccuracyReport.tsx`): Added semantic normalization for result columns (نتيجة المستوى الأول / الثاني / التفتيش …). Numeric codes (`1` → سليمة, `2` → اشتباه) and textual variants (`سليمة -يمكن فسحها`, `نتيجة سليمة_مبدئية` → سليمة, etc.) are now canonicalized before comparison so they no longer count as mismatches. Display in the mismatch table shows `raw (canonical)` so the viewer knows what the code means.

2. **TemplateBuilder** (`TemplateBuilder/index.tsx`): Added "النموذج الافتراضي" button that seeds the pre-built two-phase inspection template (ضمان جودة الصورة / ضمان جودة النتيجة) with all conditional fields already wired up. The template is editable and deletable like any other.

**File:** `src/components/Sidebar/Tabs/Population/components/DataAccuracyReport.tsx`

**Before:**
```ts
function norm(val: string | null | undefined): string {
  if (val === null || val === undefined) return "";
  const s = val.toString().trim();
  // ...date normalization...
  return s.toLowerCase().replace(/\s+/g, " ");
}

function display(val: string | null | undefined): string {
  if (val === null || val === undefined || val === "") return "—";
  return val;
}
```
(comparison in compare() always used `norm()` for all columns; display() showed raw value only)

**After:**
Added `RESULT_COLUMN_KEYS`, `canonicalizeResult()`, `normForCol()`, and `displayForCol()`.
Result columns are compared using canonical forms; display shows `raw (canonical)` when they differ.

---

**File:** `src/components/Sidebar/Tabs/TemplateBuilder/index.tsx`

**Before:**
`handleCreate()` created a blank two-phase template. No default template button.

**After:**
Added `buildDefaultInspectionTemplate()` factory and `handleCreateDefault()` handler.
Added "النموذج الافتراضي" button in the list view next to "نموذج جديد".

---

## v1.0 — 2026-06-23 — Initial full codebase commit

First push of the complete XQAP v1 application to GitHub. Covers all phases:
population import, stratified sampling, distribution, employee workspace,
template builder, reports, archive, backups, user management, and settings.

No before/after diff — this is the baseline from which all future edits are measured.

---

## v2 — 2026-06-23 — Full-audit remediation + 7-day persistent login

Applies the findings of the codebase audit (all except C3 login-throttling, descoped by
the user) and adds session persistence. Highlights: rotated the bootstrap admin passcode to
a strong value with a freshly generated Argon2id hash; sessions now persist for 7 days;
`safeWriteJson` stages writes through a verified `.tmp`; optimistic-concurrency hash now
matches the bytes on disk; legacy password hashes upgrade transparently on login.

**File:** `src/auth/authConfig.ts`

**Before:**
```ts
export const LOGIN_SYSTEM_VERSION = "1.2.0";
...
export const BOOTSTRAP_ADMIN_PASSWORD_HASH: PasswordHashRecord = {
  algorithm: "argon2id",
  encoded: "$argon2id$v=19$m=19456,t=2,p=1$Q0EXc66ZzrZ7R+3ZeFyg/w$hr4m5BK1wKMt5JwvYnSVyGZqHKC95FbPsoR9nVsoUIo"
};
```

**After:**
```ts
export const LOGIN_SYSTEM_VERSION = "1.3.0";
...
// Rotated 2026-06-23: strong passcode, Argon2id (m=19456,t=2,p=1). See docs/EDIT_LOG.md v2.
export const BOOTSTRAP_ADMIN_PASSWORD_HASH: PasswordHashRecord = {
  algorithm: "argon2id",
  encoded: "$argon2id$v=19$m=19456,t=2,p=1$ptZbFeX582X4+1WJnQ53bw$xyPiz56XTjHm+9hpNiv1efZfLJGPMNZYW3mIT/7D3lI"
};
```

**File:** `src/auth/authSession.ts`

**Before:** session stored in `sessionStorage`, no expiry.

**After:** session stored in `localStorage` with a 7-day TTL derived from `loginAt`; `readSession()`
clears and rejects expired/invalid sessions.

**File:** `src/auth/AuthGate.tsx`

**Before:** `getRoleLabel` had no `guest` branch (guests saw "الموظف"); successful logins never
upgraded legacy password hashes.

**After:** added a `guest` → "ضيف" branch; after a successful managed-user login, if
`needsRehash(user.passwordHash)` the hash is recomputed and persisted (M3).

**File:** `src/auth/passwordCrypto.ts` / `userManagement.ts` — added `persistUserPasswordHash`
helper used by the login rehash path; `createUserId` now uses `crypto.randomUUID()` when available.

**File:** `src/data/storage/safeWrite.ts`

**Before:** wrote the live file in place after snapshotting `.bak`; lock keyed by bare filename.

**After:** stages serialized content to `${fileName}.tmp`, verifies it, then commits to the live
file and removes the tmp; rolls back from `.bak` on failure (M1). Lock now keyed by
`${dir.name}/${fileName}` (L4).

**File:** `src/data/storage/fileSystemAccess.ts`

**Before:** `newHash` hashed `JSON.stringify(preparedFile, null, 2)` (no trailing newline),
mismatching `readJsonFile` which hashes the raw on-disk text (with the `\n` safeWrite appends).

**After:** `newHash` hashes the exact written bytes (`...+"\n"`) so it round-trips as the next
`baseHash` (M2); `createId` uses `crypto.randomUUID()` when available (L5).

**File:** `src/data/distribution/distributionLog.ts` — `createEventId` uses `crypto.randomUUID()`
when available (L5); clarified `computeDaysRemainingForDeadline` documentation (L7).

**File:** `src/data/answers/answerStorage.ts` — `answerFileName` strips path-dangerous characters
from the username before building the filename (M4).

**File:** `src/App.tsx` — `<TestPanel />` now only renders under `import.meta.env.DEV` (L2).

**File:** `CLAUDE.md` — corrected the role list (5 roles incl. `manager`), corrected the
`safeWrite` description, and added a "Security model (advisory-only)" note (C2, L3).

---

## v2.1 — 2026-06-23 — Expert observation date column ("تاريخ رصد الخبير")

Surfaces the timestamp captured when an employee submits ("تقديم") an inspection — already
stored as `ItemAnswer.submittedAt` — as a dedicated, unified column in both the referrals
table and the results table. New shared label key `col_expert_observation_date`.

**File:** `src/data/labels/labelsStore.ts`

**Before:**
```ts
  col_distribution_date:         "تاريخ التوزيع",
  col_plate_or_container_number: "لوحة / حاوية",
```

**After:**
```ts
  col_distribution_date:         "تاريخ التوزيع",
  col_expert_observation_date:   "تاريخ رصد الخبير",
  col_plate_or_container_number: "لوحة / حاوية",
```

**File:** `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx`

**Before:** the `صور الأشعة المحالة` table had no submitted-at column; `answersMap` was declared
after the `columns` memo.

**After:** added a `submittedAt` column (label `col_expert_observation_date`, `isDate`) to
`buildXrayColumns`, added it to `DEFAULT_VISIBLE`, moved `answersMap` above the `columns` memo,
and injected an accessor that reads `answersMap.get(...)?.submittedAt` so the value renders and
exports per row.

**File:** `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayInspectionResults.tsx`

**Before:**
```ts
{ id: "submittedAt", label: "تاريخ رصد خبير الجودة", widthFr: 14, isDate: true, accessor: () => null },
```

**After:**
```ts
{ id: "submittedAt", label: L.col_expert_observation_date, widthFr: 14, isDate: true, accessor: () => null },
```

---

## v2.3 — 2026-06-23 — DataTable auto-fit columns

The shared `DataTable` used `table-layout: fixed` with forced percentage widths, so columns
could not grow to their content — headers like "المستوى" wrapped to "الم ستو ى". Switched to
content-based auto layout with horizontal scroll. The `widthFr` values and manual resize now act
as preferences rather than hard caps. Affects every table built on `DataTable` (population browse,
inspection results, referrals, reports, archive). Other tables already used auto layout.

**File:** `src/components/DataTable/DataTable.css`

**Before:**
```css
.dt-table-wrap { ... overflow-x: hidden; overflow-y: auto; ... }
.dt-table { width: 100%; table-layout: fixed; ... }
.dt-th-label { ... word-break: break-word; ... }
.dt-td { padding: 9px 12px; ... white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
```

**After:**
```css
.dt-table-wrap { ... overflow-x: auto; overflow-y: auto; ... }
.dt-table { width: 100%; table-layout: auto; ... }
.dt-th-label { ... white-space: nowrap; ... }
.dt-td { padding: 9px 12px; ... white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 340px; }
```

---

## v2.4 — 2026-06-23 — Fix: newly-added columns invisible under an older saved column config

A column added to a table (e.g. `submittedAt` / "تاريخ رصد الخبير") never rendered for users whose
column config was persisted before it existed: `visibleCols` and both drag handlers read strictly
from `colCfg.order`, and toggling it visible in the picker only edited `hidden`, never `order`.
Introduced a `normalizedOrder` that reconciles the saved order with the current columns (keeps known
ids in place, prepends missing alwaysVisible, appends other missing columns, drops stale ids), and
based rendering + reordering on it.

## v3 — 2026-06-23 — Admin role-preview switcher (impersonate roles to test permissions)

Added an admin-only control in the top toolbar (next to "تسجيل الخروج") to preview the app as any
role — ضيف / الموظف / المشرف / المدير / الإدارة — so an admin can verify each role's tabs and
permissions without logging in as them. The preview overrides only the *role*; the real identity
(username) is preserved, so actions stay attributed to the admin. Stored in `sessionStorage`
(`xray_preview_role_v1`) so it never outlives the tab; cleared on logout.

**File:** `src/auth/authSession.ts` — added `readPreviewRole` / `setPreviewRole`; split
`readRealSession` (identity, ignores override) from `readSession` (effective: real identity with the
role swapped when a real admin is impersonating). `clearSession` now also clears the preview.

**File:** `src/auth/AuthGate.tsx` — `getInitialSession` uses `readRealSession`; added `previewRole`
state + `changePreviewRole`; the toolbar renders a role-chip switcher (real-admin only) and passes
the *effective* session to children; impersonation recolours the bar and shows a "(معاينة)" flag.

**File:** `src/App.tsx` — `AppContent` is keyed by `session.role` so switching the previewed role
remounts the app subtree (components that read the session once at mount re-read it).

**File:** `src/auth/AuthGate.css` — styles for `.auth-role-preview` / `.auth-role-chip` and the
amber `.auth-toolbar-preview` impersonation indicator.

---

## v3.2 — 2026-06-23 — Role-preview: segmented switch (not buttons, not select)

The role-preview control is now a **connected pill segmented switch**: all role options
sit inside one rounded pill container so they look and feel like a single toggle switch,
not a row of detached buttons. Active segment slides a white thumb. Grouped with
تسجيل الخروج on the right side of the toolbar.

**File:** `src/auth/AuthGate.tsx` — replaced `<select>` with `.auth-role-switcher` +
`.auth-role-seg` button pattern (still a group of buttons, but visually a unified switch).

**File:** `src/auth/AuthGate.css` — replaced select styles with `.auth-role-switcher`
(pill container) and `.auth-role-seg` (transparent segments; `.active` gets white thumb +
shadow). Amber-bar variant preserved.

---

## v3.3 — 2026-06-23 — Supervisor view toggle in صور الأشعة المحالة

Supervisors and admins can now switch between "الكل" (see everyone's rows) and
"مسنداتي فقط" (see only rows assigned to the current logged-in user) using a segmented
switch at the top of the table. Employees and guests are unaffected.

**File:** `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx`
- Added `showMyOnly` boolean state (default false).
- Added `displayEntries` useMemo that filters `entries` to `assignedTo === username`
  when `canSeeAll && showMyOnly`.
- Changed DataTable `rows` prop from `entries` to `displayEntries`.
- Added `.ew-view-switcher` / `.ew-view-seg` segmented switch in `toolbarStart`,
  visible only when `canSeeAll`.

**File:** `src/components/Sidebar/Tabs/EmployeeWorkspace/EmployeeWorkspace.css`
- Added `.ew-view-switcher` pill container and `.ew-view-seg` / `.ew-view-seg.active`
  styles matching the auth-gate segmented-switch design.

---

## v3.4 — 2026-06-23 — Replacement candidate pool capped at 1000 (performance)

Opening the replacement dialog previously rendered ALL eligible population rows in the
UI, causing severe lag on large populations (10 000+ rows). The candidate pool is now
capped at 1000 random entries for both "recommended" and "all" tabs before returning
from `getReplacementCandidates`. The random shuffle (Fisher-Yates) ensures no systematic
bias in which 1000 are shown.

**File:** `src/data/distribution/replacement.ts`

**Before:**
```ts
if (sameStage.length > 0) {
  return { recommended, all: sameStage };
}
// ...
return { recommended: [], all: fallbackStage?.[1] ?? [] };
```

**After:**
```ts
const REPLACEMENT_POOL_LIMIT = 1000;
// ...
if (sameStage.length > 0) {
  return {
    recommended: capRandom(recommended, REPLACEMENT_POOL_LIMIT),
    all: capRandom(sameStage, REPLACEMENT_POOL_LIMIT),
  };
}
// ...
return { recommended: [], all: capRandom(fallbackStage?.[1] ?? [], REPLACEMENT_POOL_LIMIT) };
```

---

## v3.5 — 2026-06-23 — Fix BI dataset not recognized for non-standard sheet names

The BI workbook parser rejected any sheet whose name did not contain "وارد" or "صادر",
adding it to `unknownSheetNames` and skipping all its rows. This caused the entire BI
file to show as "not recognized" when the user's Excel uses non-standard sheet naming.

Fixed by returning the sheet's own name as the source when no pattern matches (instead of
null). All sheets are now processed; the `unknownSheetNames` list will always be empty
for BI-only files. Recognized sheet names ("بحري وارد" etc.) continue to work as before.

**File:** `src/components/Sidebar/Tabs/Population/biData/biDataWorkbook.ts`

**Before:**
```ts
  return null; // ← caused sheet to be skipped entirely
}
```

**After:**
```ts
  // No pattern matched — process the sheet anyway using its own name as the source.
  return sheetName;
}
```

---

## v3.6 — 2026-06-23 — Permission matrix: sub-tabs hidden when role has no view permission

Sub-tabs inside employee-workspace (لوحة الإحصائيات, صور الأشعة المحالة, نتائج فحص الأشعة,
اعتماد الطلبات, نموذج الفحص) were always shown in the sidebar regardless of permissions —
the permission gate only showed `<AccessDenied />` after clicking. Now the sidebar only
renders sub-tabs the current role can actually view.

**File:** `src/App.tsx` — `allowedTabs` useMemo now maps each tab through a sub-tab
filter. For `employee-workspace`, sub-tab IDs are prefixed `ew/` to match MANAGED_TABS
entries, then filtered by `hasRolePermission(..., "view")`.

**Before:**
```ts
return SIDEBAR_TABS.filter(tab => ... && hasRolePermission(...));
```

**After:**
```ts
return SIDEBAR_TABS
  .filter(tab => ... && hasRolePermission(...))
  .map(tab => {
    if (!tab.subTabs?.length) return tab;
    const prefix = tab.id === "employee-workspace" ? "ew/" : `${tab.id}/`;
    const allowedSubTabs = tab.subTabs.filter(sub =>
      hasRolePermission(permissions, session.role, `${prefix}${sub.id}`, "view")
    );
    return { ...tab, subTabs: allowedSubTabs };
  });
```

---

## v3.1 — 2026-06-23 — Role-preview: dropdown toggle, grouped with تسجيل الخروج

Replaced the row of chip buttons with a compact `<select>` dropdown and moved it into a
flex group with تسجيل الخروج so both controls sit together on the left end of the toolbar.
In RTL flex the select appears immediately to the right of the logout button.

**File:** `src/auth/AuthGate.tsx`

**Before:**
```tsx
{isRealAdmin && (
  <div className="auth-role-preview" role="group">
    <span className="auth-role-preview-label">معاينة كـ:</span>
    {PREVIEW_ROLE_IDS.map((id) => <button className="auth-role-chip ...">...</button>)}
  </div>
)}
<button onClick={logout}>تسجيل الخروج</button>
```

**After:**
```tsx
<div className="auth-toolbar-end">
  {isRealAdmin && (
    <select className="auth-role-select" value={effectiveRole} onChange={...}>
      {PREVIEW_ROLE_IDS.map((id) => <option value={id}>...</option>)}
    </select>
  )}
  <button onClick={logout}>تسجيل الخروج</button>
</div>
```

**File:** `src/auth/AuthGate.css` — replaced `.auth-role-preview` / `.auth-role-chip` /
`.auth-role-preview-label` with `.auth-toolbar-end` flex group and `.auth-role-select`
styled dropdown (custom SVG chevron, hover/focus rings, amber-bar variant).

---

## v2.5 — 2026-06-23 — Fix: "تاريخ رصد الخبير" missing in Inspection Results

The Inspection Results table has no column picker (`canConfigureColumns={false}`) and derives its
visible sample columns from the shared referrals preset via `getVisibleSampleColumns`. That helper
had the same order-based drop as DataTable, and the preset→config mapping auto-marked any column not
in the old preset's `visibleColumns` as hidden — so a newly added column could never appear and
couldn't be toggled on. Fixed by (a) only hiding columns the preset actually knew about
(`columnOrder.includes(id)`) and (b) appending sample columns missing from the saved order. Applied
the same `columnOrder` guard to the referrals preset for consistency.

**File:** `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayInspectionResults.tsx`
— `getVisibleSampleColumns` now appends columns missing from the saved order; the preset→config
`hidden` only includes columns present in `preset.columnOrder`.

**File:** `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx`
— `colPreset.hidden` only includes columns present in `p.columnOrder` (new columns default visible).

---

## v2.4 — 2026-06-23 — Fix: newly-added columns invisible under an older saved column config

A column added to a table (e.g. `submittedAt` / "تاريخ رصد الخبير") never rendered for users whose
column config was persisted before it existed: `visibleCols` and both drag handlers read strictly
from `colCfg.order`, and toggling it visible in the picker only edited `hidden`, never `order`.
Introduced a `normalizedOrder` that reconciles the saved order with the current columns (keeps known
ids in place, prepends missing alwaysVisible, appends other missing columns, drops stale ids), and
based rendering + reordering on it.

**File:** `src/components/DataTable/index.tsx`

**Before:**
```ts
const orderedIds = new Set(colCfg.order);
const missingAlways = columns.filter((c) => c.alwaysVisible && !orderedIds.has(c.id));
const visibleCols = [
  ...missingAlways,
  ...colCfg.order.map((id) => columns.find((c) => c.id === id)).filter(...),
].filter((c) => !colCfg.hidden.includes(c.id) && (!c.adminOnly || isAdmin));
// ...
function handleDrop(targetId) { const order = [...colCfg.order]; ... }
```

**After:**
```ts
const normalizedOrder = useMemo(() => { /* kept ∪ missingAlways(prepend) ∪ missingRest(append) */ }, [columns, colCfg.order]);
const visibleCols = normalizedOrder
  .map((id) => columns.find((c) => c.id === id)).filter(...)
  .filter((c) => !colCfg.hidden.includes(c.id) && (!c.adminOnly || isAdmin));
// ...
function handleDrop(targetId) { const order = [...normalizedOrder]; if (sp<0||tp<0) return; ... }
```

---

## v4.4 — 2026-06-23 — XLSX export for all report cards + auth footer workspace button

**File:** `src/auth/AuthGate.tsx`

Added "تغيير المجلد" button in the login card footer using `selectWorkspace()` from `useWorkspace`.

**Before:**
```tsx
<footer className="auth-footer">
  <span>Local Gate v{LOGIN_SYSTEM_VERSION}</span>
  <button type="button" onClick={logout}>مسح الجلسة</button>
</footer>
```
**After:**
```tsx
<footer className="auth-footer">
  <span>Local Gate v{LOGIN_SYSTEM_VERSION}</span>
  <div className="auth-footer-actions">
    <button type="button" className="auth-footer-change" onClick={() => { void selectWorkspace(); }}>
      تغيير المجلد
    </button>
    <button type="button" onClick={logout}>مسح الجلسة</button>
  </div>
</footer>
```

**File:** `src/auth/AuthGate.css`

Added `.auth-footer-actions` flex group and `.auth-footer-change` style with `↗` prefix.

**File:** `src/data/reporting/distributionReport.ts`

Added `buildDistributionXlsx(data, monthFolderName)` — exports 3-sheet XLSX:
ملخص / ملخص الموظفين / تفاصيل التوزيع (all rows with full `PreparedPopulationRow` fields).

**File:** `src/data/reporting/executiveReport.ts`

Added `buildExecutiveXlsx(input)` — exports 4-sheet XLSX:
مؤشرات الأداء / تحليل المنافذ / المراحل / كل الصفوف (every image with all derived KPI fields).

**File:** `src/components/Sidebar/Tabs/Reports/index.tsx`

- `ReportType` union extended with `"distribution-xlsx"` and `"executive-xlsx"`
- Imported `buildDistributionXlsx` and `buildExecutiveXlsx`
- Each of the three report cards (executive, sample, distribution) now has two buttons: HTML › and XLSX ↓
- `generate()` branches handle all six report types

---

## v4.3 — 2026-06-23 — Sample report rewrite (rich HTML + XLSX) and executive report 5-slide restructure

**File:** `src/data/reporting/executiveReport.ts`

Rewrote from 8 slides to 5 compact slides. Removed الحالة column from the port table.
Eliminated slide duplication (KPI cards appeared in slides 1 & 6; port analysis in slides 2 & 7;
single-month trend chart on slide 7 was meaningless). Merged overlapping content:
- Slide 1: Executive summary — 6 KPI cards + donut + port bar chart + rank list + insights strip
- Slide 2: Port analysis — port table (no الحالة) + stacked bars + L1/L2 dual bars per port
- Slide 3: Stage coverage + plan KPIs strip + quality metrics (absorbed slide 6's plan data)
- Slide 4: Verification matrix + L1/L2 comparison (merged slides 4 & 5)
- Slide 5: Priority ports + decisions list + executive callout (merged slides 7 & 8)

**File:** `src/data/population/populationConfig.ts`

Exported `MONTHLY_SAMPLE_TARGET` (6500) and `STAGE_SAMPLE_TARGETS` as named exports
so they can be imported by other modules.

**Before:**
```ts
// constants were only defined in Population/index.tsx, not exported
const MONTHLY_SAMPLE_TARGET = 6500;
```

**After:**
```ts
export const MONTHLY_SAMPLE_TARGET = 6500;
export const STAGE_SAMPLE_TARGETS: Record<"first" | "second" | "third" | "fourth", number | null> = {
  first: null, second: 2500, third: 1875, fourth: 1875,
};
```

**File:** `src/data/reporting/executiveReportTypes.ts`

`DEFAULT_EXEC_CONFIG.monthlyTarget` now reads from `MONTHLY_SAMPLE_TARGET` (was hardcoded 0).

**File:** `src/data/reporting/sampleReport.ts`

Full rewrite. Old: 69-line basic HTML with port allocation table + 20-row preview.
New: rich multi-section HTML (raw vs processed diff, per-port breakdown showing Risk+BI+CertScan,
stage breakdown, 50-row sample preview) plus `buildSampleXlsx()` generating a 5-sheet XLSX
(ملخص / تفصيل المنافذ / المراحل / العينة المسحوبة / كامل المجتمع). New signature takes
`SampleReportInput` with `{ monthFolderName, manifest, populationRows, sample }`.

**File:** `src/components/Sidebar/Tabs/Reports/index.tsx`

- Import `openSampleReport`, `buildSampleXlsx` (replacing old `buildSampleReport`)
- Import `loadMonthForEditing` for richer data load
- Added `"sample-xlsx"` to `ReportType` union
- Sample card now has two buttons: HTML and XLSX
- Updated card description to reflect new rich content

---

## v4.1 — 2026-06-23 — Reports Hub: card-grid page design

**File:** `src/components/Sidebar/Tabs/Reports/index.tsx`

Replaced the dropdown-based reports form with a full card-grid hub (مركز التقارير).

**Before:**
```tsx
// Single panel with two <select> dropdowns (month + report type) and one generate button
<div className="rpt-panel">
  <h2>إعدادات التقرير</h2>
  <div className="rpt-controls">…</div>
  <button>توليد التقرير</button>
  <div className="rpt-info">…</div>
</div>
```

**After:**
```tsx
// Page header + month bar with metadata chips + card grid (executive/sample/distribution/
// department-soon/xlsx-note) + quick-actions strip. Each card has its own generate button.
// Month bar auto-loads population count, sample count, and submitted-answer count as chips.
<section className="rh-page">
  <div className="rh-header">…</div>
  <div className="rh-month-bar">…chips…</div>
  <div className="rh-grid">…5 cards…</div>
  <div className="rh-quick">…quick buttons…</div>
</section>
```

Also fixed: `f.answers` → `f.items` (correct field on `EmployeeAnswerFile`).

**File:** `src/components/Sidebar/Tabs/Reports/Reports.css`

Complete CSS rewrite for the new hub layout — navy/teal design system, card grid,
accent strips, badges, chips, spinner, toast notification, quick-actions strip.

**File:** `src/data/reporting/executiveReport.ts`

Removed unused parameters (`monthLabel` from slide5/slide6, `config` from slide7) and
removed unused `l1l2Same` variable. Matched call sites accordingly.

**File:** `src/data/reporting/executiveReportData.ts`

Removed three unused `import type` lines (`PreparedPopulationRow`, `DistributionCurrentData`,
`EmployeeAnswerFile`) — these flow through `ExecutiveReportInput` already.

---

## v4.0 — 2026-06-23 — Executive Report: 8-slide HTML presentation module

**File:** `src/data/reporting/executiveReportTypes.ts` *(new)*

Defines all TypeScript types for the executive report: `ExecutiveReportRow`, `PortProfile`, `StageProfile`, `ExecutiveKPIs`, `ExecutiveReportConfig`, `DEFAULT_EXEC_CONFIG`, `ExecutiveReportInput`, `VerificationCategory`.

**Before:** *(file did not exist)*

**After:** *(full type definitions as documented above)*

---

**File:** `src/data/reporting/executiveReportData.ts` *(new)*

Data joining, KPI engine, and Arabic narrative generator.

- `buildExecutiveReportRows()`: joins population + sample + distribution + submitted answers into `ExecutiveReportRow[]`
- `calculateExecutiveKPIs()`: computes all KPIs including per-port and per-stage profiles; port status classification (excellent/stable/monitor/priority/insufficient)
- `generateNarrativeFindings()`: produces up to 3 Arabic executive findings
- `fmtNum()`, `fmtPct()`, `fmtK()`: display helpers

**Before:** *(file did not exist)*

**After:** *(full implementation)*

---

**File:** `src/data/reporting/executiveReport.ts` *(new)*

Main 8-slide HTML builder.

- Exports `buildExecutiveReport(input)` and `openExecutiveReport(input)`
- Slide 1: executive summary — 5 KPI cards + bar chart + donut + rank list + insights strip
- Slide 2: port performance table + stacked bars + executive callout
- Slide 3: stage coverage cards + stage bar chart + monthly plan strip
- Slide 4: verification matrix table + summary cards + rule explanations
- Slide 5: L1 vs L2 comparison grid + dual-bar chart per port
- Slide 6: management KPIs + plan tracking table + quality indicators
- Slide 7: performance trend SVG (graceful single-month fallback) + priority port cards
- Slide 8: decisions list + executive callout + success targets
- CSS: navy/teal design system, Somar via `local()`, RTL, 13.333in×7.5in slides
- Navigation: keyboard (ArrowLeft/Right/Home/End) + toolbar + print/PDF

**Before:** *(file did not exist)*

**After:** *(full implementation)*

---

**File:** `src/components/Sidebar/Tabs/Reports/index.tsx`

**Before:**
```ts
type ReportType = "sample" | "distribution";
const REPORT_LABELS: Record<ReportType, string> = {
  sample: "تقرير العينة",
  distribution: "تقرير التوزيع"
};
// generate handler: sample | distribution branches only
```

**After:**
```ts
type ReportType = "sample" | "distribution" | "executive";
const REPORT_LABELS: Record<ReportType, string> = {
  sample: "تقرير العينة",
  distribution: "تقرير التوزيع",
  executive: "التقرير التنفيذي"
};
// generate handler: adds executive branch — loads population, sample,
// distribution, and all employee answer files, then calls openExecutiveReport()
```

---
