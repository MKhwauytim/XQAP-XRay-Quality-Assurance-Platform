# Report Designer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Power-BI-style visual report/dashboard designer where users lay tables, charts, KPI cards, text, shapes, and images onto a fixed-size canvas (A4 print page or PPT slide), bind elements to system data via in-browser group-by/filter/aggregate, and save the layout as a reusable template that re-binds against any month's data.

**Architecture:** A new `src/data/reportDesigner/` data layer (pure types + query engine + disk storage) plus a new `src/components/Sidebar/Tabs/ReportDesigner/` tab. The query engine runs entirely in-browser over the existing `ExecutiveReportRow[]` fact table (already joins population + sample + distribution + answers), so no backend or join engine is needed. The canvas is custom (absolute-positioned, pointer-event drag/resize) to keep the single-file bundle flat and support pixel-precise RTL print layout. Element renderers are shared between edit mode and print/view mode.

**Tech Stack:** React 19 + TypeScript (strict), Vite single-file build, recharts (already installed), File System Access API, Vitest (node env) with `createMemoryDirectory`. **No new runtime dependencies.**

## Global Constraints

- TypeScript strict mode; `import type` for type-only imports. (CLAUDE.md)
- **No new runtime dependencies** — bundle is one inlined `dist/index.html`; reuse recharts for charts. (spec §2)
- **Before every code edit, append an entry to `docs/EDIT_LOG.md`** (version, ISO date, what changed, Before snippet, After snippet, one `**File:**` block per file). (CLAUDE.md)
- All user-facing strings Arabic, layout RTL (`dir="rtl"`); code identifiers English. Prefer adding label keys over hard-coded Arabic. (CLAUDE.md)
- `createWritable` on `FileHandleLike` is optional — guard `if (!fh.createWritable) return;` before use. (CLAUDE.md)
- All disk JSON goes through `safeWriteJson` / `safeReadJson` (auto-wrap/unwrap `JsonEnvelope`) and `withResourceLock`. (CLAUDE.md)
- Tests use Vitest node env + `createMemoryDirectory()` from `src/data/storage/memoryDirectory.ts` for file I/O. (CLAUDE.md)
- Run a single test file: `npx vitest run <path>`. Full suite: `npm run test:run`. Typecheck: `npm run typecheck`. Lint: `npm run lint`.
- Plain CSS co-located per component; no CSS framework. (CLAUDE.md)
- New tab must be registered in three places: auto-discovered `tabRegistry` (automatic via `index.tsx` export), `MANAGED_TABS`, and `createDefaultPermissions()` in `src/auth/userManagement.ts`. (CLAUDE.md)

**Reference signatures (verbatim from codebase):**
- `safeWriteJson<T>(dir: DirectoryHandleLike, fileName: string, value: T): Promise<void>` — `src/data/storage/safeWrite.ts:222`
- `safeReadJson<T>(dir, fileName): Promise<SafeReadResult<T>>` where `SafeReadResult<T> = { ok: true; value: T; recoveredFromBak: boolean; rawText: string } | { ok: false; ... }` — `src/data/storage/safeWrite.ts:438`
- `withResourceLock(key: string, fn: () => Promise<T>): Promise<T>` — `src/data/storage/webLocks.ts`
- `getReportsRoot(directoryHandle, create): Promise<DirectoryHandleLike>` — `src/data/workspace/workspacePaths.ts:109` (root = `4-Reports`)
- `createMemoryDirectory(name = "root"): DirectoryHandleLike` — `src/data/storage/memoryDirectory.ts:89`
- `buildExecutiveReportRows(input: ExecutiveReportInput): ExecutiveReportRow[]` — `src/data/reporting/executiveReportData.ts:86`
- `useWorkspace(): WorkspaceContextValue` (`.directoryHandle: DirectoryHandleLike | null`) — `src/data/workspace/useWorkspace.ts`
- `SidebarTabModule = { default: ComponentType; tabConfig?: Omit<SidebarTabDefinition, "TabComponent"> }` — `src/components/Sidebar/Tabs/tabTypes.ts`
- `ExecutiveReportRow` fields — `src/data/reporting/executiveReportTypes.ts:14`

---

## File Structure

**New — data layer (`src/data/reportDesigner/`):**
- `reportTypes.ts` — `ReportDocument`, `Page`, `Element`, per-type configs, `Filter`. (P0)
- `query/fieldCatalog.ts` — field metadata derived from the fact-row schema. (P0)
- `query/dataModel.ts` — `buildDataModel(monthData)` → named tables. (P0)
- `query/runQuery.ts` — `runQuery(table, spec)` group-by/filter/aggregate/sort/limit. (P0)
- `query/aggregations.ts` — pure aggregation functions. (P0)
- `query/filters.ts` — pure filter predicate builder. (P0)
- `storage/reportDesignStorage.ts` — save/load/delete/index CRUD + id factory. (P0)
- `geometry.ts` — snapping, hit-testing, resize math (pure). (P1)

**New — UI (`src/components/Sidebar/Tabs/ReportDesigner/`):**
- `index.tsx` — tab shell + `tabConfig`; design list ↔ editor switch. (P1)
- `ReportDesigner.css` — co-located styles. (P1)
- `editor/Canvas.tsx` — the canvas surface (pages, elements, selection). (P1)
- `editor/useCanvasInteractions.ts` — drag/resize/select hook. (P1)
- `editor/Toolbar.tsx` — add element, page nav, save, print. (P1)
- `editor/Inspector.tsx` — selected-element property panel. (P1)
- `renderers/` — `TextRenderer.tsx`, `ShapeRenderer.tsx`, `ImageRenderer.tsx` (P1); `KpiRenderer.tsx`, `TableRenderer.tsx` (P2); `ChartRenderer.tsx` (P3). Each shared by edit + print.
- `PrintView.tsx` — clean paginated render for Ctrl+P. (P1)

**Modified:**
- `src/auth/userManagement.ts` — add `report-designer` to `MANAGED_TABS` + `createDefaultPermissions()`. (P1)
- `docs/data-system-report.md` — document `4-Reports/designs/` layout. (P1)

---

# PHASE 0 — Data model + query engine + storage (pure, no UI)

## Task 0.1: Document model types

**Files:**
- Create: `src/data/reportDesigner/reportTypes.ts`
- Test: `src/data/reportDesigner/reportTypes.test.ts`

**Interfaces:**
- Produces: types `ReportDocument`, `Page`, `Element`, `ElementType`, `TableConfig`, `ChartConfig`, `KpiConfig`, `TextConfig`, `ShapeConfig`, `ImageConfig`, `Filter`, `FilterOp`, `Aggregation`, `PageSetup`; const `REPORT_SCHEMA_VERSION = 1`; factory `createEmptyDocument(name: string, createdBy: string): ReportDocument`.

- [ ] **Step 1: Write the failing test**

```ts
// src/data/reportDesigner/reportTypes.test.ts
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

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/reportDesigner/reportTypes.test.ts`
Expected: FAIL — `Cannot find module './reportTypes'`.

- [ ] **Step 3: Write the types and factory**

```ts
// src/data/reportDesigner/reportTypes.ts
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
  width: number;   // document units, px @96dpi
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

// A4 portrait at 96dpi = 794 x 1123 px.
export const A4_PORTRAIT: PageSetup = {
  size: "A4", orientation: "portrait", width: 794, height: 1123,
  margins: { top: 38, right: 38, bottom: 38, left: 38 },
};

export function createReportId(): string {
  return `rpt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
export function createPageId(): string {
  return `pg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
export function createElementId(): string {
  return `el-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createEmptyDocument(name: string, createdBy: string): ReportDocument {
  const now = new Date().toISOString();
  return {
    reportId: createReportId(),
    reportName: name,
    version: 1,
    createdAt: now, createdBy, updatedAt: now, updatedBy: createdBy,
    docType: "print",
    pageSetup: { ...A4_PORTRAIT, margins: { ...A4_PORTRAIT.margins } },
    theme: { palette: ["#1f6feb", "#2da44e", "#bf8700", "#cf222e", "#8250df"], fontFamily: "inherit", defaults: {} },
    dataSources: [],
    pages: [{ pageId: createPageId(), name: "صفحة 1", order: 0, filters: [], elements: [] }],
    reportFilters: [],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/data/reportDesigner/reportTypes.test.ts`
Expected: PASS.

- [ ] **Step 5: Record edit-log + commit**

Append a `docs/EDIT_LOG.md` entry (new file → Before: `(new file)`). Then:

```bash
git add docs/EDIT_LOG.md src/data/reportDesigner/reportTypes.ts src/data/reportDesigner/reportTypes.test.ts
git commit -m "feat(report-designer): add document model types"
```

---

## Task 0.2: Aggregation functions

**Files:**
- Create: `src/data/reportDesigner/query/aggregations.ts`
- Test: `src/data/reportDesigner/query/aggregations.test.ts`

**Interfaces:**
- Consumes: `Aggregation` from `../reportTypes`.
- Produces: `aggregate(agg: Aggregation, values: unknown[], grandTotal?: number): number`.

- [ ] **Step 1: Write the failing test**

```ts
// src/data/reportDesigner/query/aggregations.test.ts
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

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/reportDesigner/query/aggregations.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/data/reportDesigner/query/aggregations.ts
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

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/data/reportDesigner/query/aggregations.test.ts`
Expected: PASS.

- [ ] **Step 5: Record edit-log + commit**

```bash
git add docs/EDIT_LOG.md src/data/reportDesigner/query/aggregations.ts src/data/reportDesigner/query/aggregations.test.ts
git commit -m "feat(report-designer): add aggregation functions"
```

---

## Task 0.3: Filter predicates

**Files:**
- Create: `src/data/reportDesigner/query/filters.ts`
- Test: `src/data/reportDesigner/query/filters.test.ts`

**Interfaces:**
- Consumes: `Filter` from `../reportTypes`.
- Produces: `applyFilters<T extends Record<string, unknown>>(rows: T[], filters: Filter[]): T[]`. Note: `topN` is a no-op here (handled in `runQuery` after aggregation); document that in a code comment.

- [ ] **Step 1: Write the failing test**

```ts
// src/data/reportDesigner/query/filters.test.ts
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

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/reportDesigner/query/filters.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/data/reportDesigner/query/filters.ts
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

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/data/reportDesigner/query/filters.test.ts`
Expected: PASS.

- [ ] **Step 5: Record edit-log + commit**

```bash
git add docs/EDIT_LOG.md src/data/reportDesigner/query/filters.ts src/data/reportDesigner/query/filters.test.ts
git commit -m "feat(report-designer): add filter predicates"
```

---

## Task 0.4: runQuery (group-by / aggregate / sort / topN)

**Files:**
- Create: `src/data/reportDesigner/query/runQuery.ts`
- Test: `src/data/reportDesigner/query/runQuery.test.ts`

**Interfaces:**
- Consumes: `applyFilters` (Task 0.3), `aggregate` (Task 0.2), types from `../reportTypes`.
- Produces:
  - `type QuerySpec = { groupBy: string[]; values: Array<{ field: string; agg: Aggregation; as?: string }>; filters: Filter[]; sort?: { key: string; dir: "asc" | "desc" }; limit?: number };`
  - `type ResultRow = Record<string, string | number | null>;`
  - `runQuery(rows: Array<Record<string, unknown>>, spec: QuerySpec): ResultRow[]`.
  - Output measure key = `as` if provided else `` `${agg}_${field}` ``. Group keys keep the dimension field name. `limit` applies after sort (this realizes the topN intent). When `groupBy` is empty, returns a single aggregate row.

- [ ] **Step 1: Write the failing test**

```ts
// src/data/reportDesigner/query/runQuery.test.ts
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

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/reportDesigner/query/runQuery.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/data/reportDesigner/query/runQuery.ts
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
      const key = spec.groupBy.map((g) => String(row[g] ?? "")).join(" ");
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
      const av = a[key]; const bv = b[key];
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

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/data/reportDesigner/query/runQuery.test.ts`
Expected: PASS.

- [ ] **Step 5: Record edit-log + commit**

```bash
git add docs/EDIT_LOG.md src/data/reportDesigner/query/runQuery.ts src/data/reportDesigner/query/runQuery.test.ts
git commit -m "feat(report-designer): add runQuery group-by engine"
```

---

## Task 0.5: Field catalog + data model

**Files:**
- Create: `src/data/reportDesigner/query/fieldCatalog.ts`
- Create: `src/data/reportDesigner/query/dataModel.ts`
- Test: `src/data/reportDesigner/query/dataModel.test.ts`

**Interfaces:**
- Consumes: `ExecutiveReportRow` (`src/data/reporting/executiveReportTypes.ts`), `runQuery`/`QuerySpec` (Task 0.4).
- Produces:
  - `fieldCatalog.ts`: `type FieldRole = "dimension" | "measure";` `type FieldType = "string" | "number" | "boolean";` `type FieldMeta = { field: string; label: string; role: FieldRole; type: FieldType };` `const FACT_FIELDS: FieldMeta[]` (Arabic labels for the `ExecutiveReportRow` columns); `getFieldMeta(field: string): FieldMeta | undefined`.
  - `dataModel.ts`: `type TableId = "fact" | "portProfiles" | "stageProfiles";` `type DataModel = { tables: Record<TableId, { label: string; fields: FieldMeta[]; rows: Array<Record<string, unknown>> }> };` `buildDataModel(input: { factRows: ExecutiveReportRow[]; portProfiles: Array<Record<string, unknown>>; stageProfiles: Array<Record<string, unknown>> }): DataModel`.

- [ ] **Step 1: Write the failing test**

```ts
// src/data/reportDesigner/query/dataModel.test.ts
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

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/reportDesigner/query/dataModel.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `fieldCatalog.ts`**

```ts
// src/data/reportDesigner/query/fieldCatalog.ts
export type FieldRole = "dimension" | "measure";
export type FieldType = "string" | "number" | "boolean";
export type FieldMeta = { field: string; label: string; role: FieldRole; type: FieldType };

// Mirrors ExecutiveReportRow (src/data/reporting/executiveReportTypes.ts:14).
// Booleans/strings = dimensions you can also count; numbers = measures.
export const FACT_FIELDS: FieldMeta[] = [
  { field: "xrayImageId", label: "رقم صورة الأشعة", role: "dimension", type: "string" },
  { field: "portName", label: "الميناء", role: "dimension", type: "string" },
  { field: "portType", label: "نوع الميناء", role: "dimension", type: "string" },
  { field: "stage", label: "المرحلة", role: "dimension", type: "string" },
  { field: "levelOneResult", label: "نتيجة المستوى الأول", role: "dimension", type: "string" },
  { field: "levelTwoResult", label: "نتيجة المستوى الثاني", role: "dimension", type: "string" },
  { field: "imageResult", label: "نتيجة الصورة", role: "dimension", type: "string" },
  { field: "selectedInSample", label: "ضمن العينة", role: "dimension", type: "boolean" },
  { field: "assignedTo", label: "مُسند إلى", role: "dimension", type: "string" },
  { field: "distributionStatus", label: "حالة التوزيع", role: "dimension", type: "string" },
  { field: "expertResult", label: "نتيجة الخبير", role: "dimension", type: "string" },
  { field: "imageAvailable", label: "الصورة متوفرة", role: "dimension", type: "boolean" },
  { field: "noImageReason", label: "سبب عدم وجود الصورة", role: "dimension", type: "string" },
  { field: "hasMarking", label: "يوجد تحديد", role: "dimension", type: "boolean" },
  { field: "imageQuality", label: "جودة الصورة", role: "dimension", type: "string" },
  { field: "lowQualityReason", label: "سبب انخفاض الجودة", role: "dimension", type: "string" },
  { field: "suspicionLevel", label: "مستوى الاشتباه", role: "dimension", type: "string" },
  { field: "suspectedTypes", label: "الأصناف المشبوهة", role: "dimension", type: "string" },
  { field: "smuggleMethod", label: "آلية التهريب", role: "dimension", type: "string" },
  { field: "answerStatus", label: "حالة الإجابة", role: "dimension", type: "string" },
  { field: "imageResultAccurate", label: "دقة نتيجة الصورة", role: "dimension", type: "boolean" },
  { field: "levelOneAccurate", label: "دقة المستوى الأول", role: "dimension", type: "boolean" },
  { field: "levelTwoAccurate", label: "دقة المستوى الثاني", role: "dimension", type: "boolean" },
  { field: "verificationCategory", label: "تصنيف التحقق", role: "dimension", type: "string" },
];

const BY_FIELD = new Map(FACT_FIELDS.map((f) => [f.field, f]));
export function getFieldMeta(field: string): FieldMeta | undefined {
  return BY_FIELD.get(field);
}
```

- [ ] **Step 4: Implement `dataModel.ts`**

```ts
// src/data/reportDesigner/query/dataModel.ts
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

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/data/reportDesigner/query/dataModel.test.ts`
Expected: PASS.

- [ ] **Step 6: Record edit-log + commit**

```bash
git add docs/EDIT_LOG.md src/data/reportDesigner/query/fieldCatalog.ts src/data/reportDesigner/query/dataModel.ts src/data/reportDesigner/query/dataModel.test.ts
git commit -m "feat(report-designer): add field catalog and data model"
```

---

## Task 0.6: Design storage (save / load / delete / index)

**Files:**
- Create: `src/data/reportDesigner/storage/reportDesignStorage.ts`
- Test: `src/data/reportDesigner/storage/reportDesignStorage.test.ts`

**Interfaces:**
- Consumes: `safeReadJson`/`safeWriteJson` (`../../storage/safeWrite`), `withResourceLock` (`../../storage/webLocks`), `getReportsRoot` (`../../workspace/workspacePaths`), `ReportDocument` (`../reportTypes`), `createMemoryDirectory` (test only).
- Produces:
  - `type DesignIndex = { designs: Array<{ reportId: string; reportName: string; version: number; updatedAt: string }> };`
  - `saveDesign(dir, doc): Promise<{ ok: true } | { ok: false; error: string }>`
  - `loadDesign(dir, reportId): Promise<ReportDocument | null>`
  - `loadDesignIndex(dir): Promise<DesignIndex>`
  - `deleteDesign(dir, reportId): Promise<{ ok: true } | { ok: false; error: string }>`
  - Pattern mirrors `src/data/templates/templateStorage.ts`. Files live in `4-Reports/designs/` (a `designs` subdir created under the reports root). Index file = `designs.index.json`.

- [ ] **Step 1: Write the failing test**

```ts
// src/data/reportDesigner/storage/reportDesignStorage.test.ts
import { describe, it, expect } from "vitest";
import { createMemoryDirectory } from "../../storage/memoryDirectory";
import { createEmptyDocument } from "../reportTypes";
import { saveDesign, loadDesign, loadDesignIndex, deleteDesign } from "./reportDesignStorage";

describe("reportDesignStorage", () => {
  it("round-trips a design and updates the index", async () => {
    const dir = createMemoryDirectory("root");
    const doc = createEmptyDocument("تقرير الأداء", "admin");
    const saved = await saveDesign(dir, doc);
    expect(saved.ok).toBe(true);

    const loaded = await loadDesign(dir, doc.reportId);
    expect(loaded?.reportName).toBe("تقرير الأداء");

    const index = await loadDesignIndex(dir);
    expect(index.designs.map((d) => d.reportId)).toContain(doc.reportId);
  });

  it("deletes a design and removes it from the index", async () => {
    const dir = createMemoryDirectory("root");
    const doc = createEmptyDocument("للحذف", "admin");
    await saveDesign(dir, doc);
    const del = await deleteDesign(dir, doc.reportId);
    expect(del.ok).toBe(true);
    const index = await loadDesignIndex(dir);
    expect(index.designs.map((d) => d.reportId)).not.toContain(doc.reportId);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/reportDesigner/storage/reportDesignStorage.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** (mirror `templateStorage.ts`; resolve the `designs` subdir via `getDirectoryHandle(..., { create: true })` on the reports root)

```ts
// src/data/reportDesigner/storage/reportDesignStorage.ts
import type { DirectoryHandleLike } from "../../storage/fileSystemAccess";
import { safeReadJson, safeWriteJson } from "../../storage/safeWrite";
import { withResourceLock } from "../../storage/webLocks";
import { getReportsRoot } from "../../workspace/workspacePaths";
import type { ReportDocument } from "../reportTypes";

const INDEX_FILE = "designs.index.json";

export type DesignIndex = {
  designs: Array<{ reportId: string; reportName: string; version: number; updatedAt: string }>;
};

async function getDesignsDir(directoryHandle: DirectoryHandleLike): Promise<DirectoryHandleLike> {
  const reports = await getReportsRoot(directoryHandle, true);
  return reports.getDirectoryHandle("designs", { create: true });
}

export async function saveDesign(
  directoryHandle: DirectoryHandleLike,
  doc: ReportDocument
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (!doc.reportId || !doc.reportName) {
      return { ok: false, error: "بيانات التقرير غير مكتملة، ولم يتم الحفظ." };
    }
    const dir = await getDesignsDir(directoryHandle);
    await withResourceLock(`${dir.name}/designs-index`, async () => {
      await safeWriteJson(dir, `${doc.reportId}.json`, doc);
      const indexResult = await safeReadJson<DesignIndex>(dir, INDEX_FILE);
      const existing: DesignIndex = indexResult.ok ? indexResult.value : { designs: [] };
      const others = existing.designs.filter((d) => d.reportId !== doc.reportId);
      const updated: DesignIndex = {
        designs: [
          ...others,
          { reportId: doc.reportId, reportName: doc.reportName, version: doc.version, updatedAt: doc.updatedAt },
        ].sort((a, b) => a.reportName.localeCompare(b.reportName, "ar")),
      };
      await safeWriteJson(dir, INDEX_FILE, updated);
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

export async function loadDesign(
  directoryHandle: DirectoryHandleLike,
  reportId: string
): Promise<ReportDocument | null> {
  try {
    const dir = await getDesignsDir(directoryHandle);
    const result = await safeReadJson<ReportDocument>(dir, `${reportId}.json`);
    return result.ok && typeof result.value.reportId === "string" ? result.value : null;
  } catch {
    return null;
  }
}

export async function loadDesignIndex(directoryHandle: DirectoryHandleLike): Promise<DesignIndex> {
  try {
    const dir = await getDesignsDir(directoryHandle);
    const result = await safeReadJson<DesignIndex>(dir, INDEX_FILE);
    return result.ok ? result.value : { designs: [] };
  } catch {
    return { designs: [] };
  }
}

export async function deleteDesign(
  directoryHandle: DirectoryHandleLike,
  reportId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const dir = await getDesignsDir(directoryHandle);
    await withResourceLock(`${dir.name}/designs-index`, async () => {
      const indexResult = await safeReadJson<DesignIndex>(dir, INDEX_FILE);
      if (indexResult.ok) {
        await safeWriteJson(dir, INDEX_FILE, {
          designs: indexResult.value.designs.filter((d) => d.reportId !== reportId),
        } satisfies DesignIndex);
      }
      if (dir.removeEntry) {
        await dir.removeEntry(`${reportId}.json`);
      } else {
        await safeWriteJson(dir, `${reportId}.json`, { deleted: true, reportId, deletedAt: new Date().toISOString() });
      }
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}
```

> Note for the implementer: confirm `getReportsRoot`'s second arg is the `create` boolean (it is — `workspacePaths.ts:109`), and that `DirectoryHandleLike` exposes `getDirectoryHandle` and optional `removeEntry` (it does — see `templateStorage.ts` usage). If `getDirectoryHandle` is not on `DirectoryHandleLike`, mirror how `getReportsRoot`/`getRoot` resolve subfolders instead.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/data/reportDesigner/storage/reportDesignStorage.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, edit-log, commit**

Run: `npm run typecheck` → expect no errors. Then:

```bash
git add docs/EDIT_LOG.md src/data/reportDesigner/storage/reportDesignStorage.ts src/data/reportDesigner/storage/reportDesignStorage.test.ts
git commit -m "feat(report-designer): add design storage CRUD + index"
```

---

# PHASE 1 — Working print canvas (first shippable slice)

## Task 1.1: Canvas geometry helpers

**Files:**
- Create: `src/data/reportDesigner/geometry.ts`
- Test: `src/data/reportDesigner/geometry.test.ts`

**Interfaces:**
- Produces:
  - `type Rect = { x: number; y: number; w: number; h: number };`
  - `snap(value: number, grid: number): number` — round to nearest grid multiple.
  - `snapRect(rect: Rect, grid: number): Rect`.
  - `resize(rect: Rect, handle: ResizeHandle, dx: number, dy: number, minW?: number, minH?: number): Rect` where `type ResizeHandle = "n"|"s"|"e"|"w"|"ne"|"nw"|"se"|"sw";`
  - `hitTest(rect: Rect, px: number, py: number): boolean`.

- [ ] **Step 1: Write the failing test**

```ts
// src/data/reportDesigner/geometry.test.ts
import { describe, it, expect } from "vitest";
import { snap, snapRect, resize, hitTest } from "./geometry";

describe("geometry", () => {
  it("snaps to nearest grid multiple", () => {
    expect(snap(11, 8)).toBe(8);
    expect(snap(13, 8)).toBe(16);
  });
  it("snaps a whole rect", () => {
    expect(snapRect({ x: 11, y: 13, w: 31, h: 5 }, 8)).toEqual({ x: 8, y: 16, w: 32, h: 8 });
  });
  it("resizes from the SE handle by growing w/h", () => {
    expect(resize({ x: 0, y: 0, w: 100, h: 100 }, "se", 20, 30)).toEqual({ x: 0, y: 0, w: 120, h: 130 });
  });
  it("resizes from the NW handle by moving origin and shrinking", () => {
    expect(resize({ x: 10, y: 10, w: 100, h: 100 }, "nw", 20, 20)).toEqual({ x: 30, y: 30, w: 80, h: 80 });
  });
  it("enforces a minimum size", () => {
    expect(resize({ x: 0, y: 0, w: 50, h: 50 }, "se", -100, -100, 10, 10)).toEqual({ x: 0, y: 0, w: 10, h: 10 });
  });
  it("hit-tests a point inside the rect", () => {
    expect(hitTest({ x: 0, y: 0, w: 100, h: 100 }, 50, 50)).toBe(true);
    expect(hitTest({ x: 0, y: 0, w: 100, h: 100 }, 150, 50)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/reportDesigner/geometry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/data/reportDesigner/geometry.ts
export type Rect = { x: number; y: number; w: number; h: number };
export type ResizeHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export function snap(value: number, grid: number): number {
  if (grid <= 0) return value;
  return Math.round(value / grid) * grid;
}

export function snapRect(rect: Rect, grid: number): Rect {
  return { x: snap(rect.x, grid), y: snap(rect.y, grid), w: snap(rect.w, grid), h: snap(rect.h, grid) };
}

export function resize(rect: Rect, handle: ResizeHandle, dx: number, dy: number, minW = 8, minH = 8): Rect {
  let { x, y, w, h } = rect;
  if (handle.includes("e")) w = Math.max(minW, w + dx);
  if (handle.includes("s")) h = Math.max(minH, h + dy);
  if (handle.includes("w")) { const nw = Math.max(minW, w - dx); x += w - nw; w = nw; }
  if (handle.includes("n")) { const nh = Math.max(minH, h - dy); y += h - nh; h = nh; }
  return { x, y, w, h };
}

export function hitTest(rect: Rect, px: number, py: number): boolean {
  return px >= rect.x && px <= rect.x + rect.w && py >= rect.y && py <= rect.y + rect.h;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/data/reportDesigner/geometry.test.ts`
Expected: PASS.

- [ ] **Step 5: Edit-log + commit**

```bash
git add docs/EDIT_LOG.md src/data/reportDesigner/geometry.ts src/data/reportDesigner/geometry.test.ts
git commit -m "feat(report-designer): add canvas geometry helpers"
```

---

## Task 1.2: Register the Report Designer tab (skeleton)

**Files:**
- Create: `src/components/Sidebar/Tabs/ReportDesigner/index.tsx`
- Create: `src/components/Sidebar/Tabs/ReportDesigner/ReportDesigner.css`
- Modify: `src/auth/userManagement.ts` (`MANAGED_TABS` + `createDefaultPermissions()`)
- Test: `src/components/Sidebar/Tabs/ReportDesigner/tabConfig.test.ts`

**Interfaces:**
- Produces: default-exported `ReportDesigner` component + `tabConfig` with `id: "report-designer"`, `label: "مصمم التقارير"`, `order: 27`, `allowedRoles: ["supervisor","manager","admin"]`, an icon from `lucide-react`. Registered in `MANAGED_TABS` (`{ id: "report-designer", label: "مصمم التقارير" }`) and in `createDefaultPermissions()` for all five roles (guest/employee `none`; supervisor `view`; manager/admin handled — add explicit rows for guest/employee/supervisor/manager mirroring the `reports` rows; admin is locked full by the normalizer).

- [ ] **Step 1: Write the failing test**

```ts
// src/components/Sidebar/Tabs/ReportDesigner/tabConfig.test.ts
import { describe, it, expect } from "vitest";
import { tabConfig } from "./index";
import { MANAGED_TABS, createDefaultPermissions } from "../../../../auth/userManagement";

describe("Report Designer tab registration", () => {
  it("exposes a well-formed tabConfig", () => {
    expect(tabConfig.id).toBe("report-designer");
    expect(tabConfig.label).toBe("مصمم التقارير");
    expect(tabConfig.allowedRoles).toEqual(["supervisor", "manager", "admin"]);
  });
  it("is listed in MANAGED_TABS", () => {
    expect(MANAGED_TABS.some((t) => t.id === "report-designer")).toBe(true);
  });
  it("has a default permission row for every role", () => {
    const rows = createDefaultPermissions().filter((p) => p.tabId === "report-designer");
    expect(rows.map((r) => r.role).sort()).toEqual(
      ["employee", "guest", "manager", "supervisor"].sort()
    );
  });
});
```

> Note: `createDefaultPermissions()` only emits explicit rows for guest/employee/supervisor/manager (admin is forced full by the normalizer), matching the existing `reports` rows — hence four roles asserted.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/Sidebar/Tabs/ReportDesigner/tabConfig.test.ts`
Expected: FAIL — `./index` not found / `report-designer` absent from MANAGED_TABS.

- [ ] **Step 3: Create the tab skeleton**

```tsx
// src/components/Sidebar/Tabs/ReportDesigner/index.tsx
/* eslint-disable react-refresh/only-export-components */
import { LayoutDashboard } from "lucide-react";
import type { SidebarTabModule } from "../tabTypes";
import "./ReportDesigner.css";

export const tabConfig: SidebarTabModule["tabConfig"] = {
  id: "report-designer",
  label: "مصمم التقارير",
  order: 27,
  allowedRoles: ["supervisor", "manager", "admin"],
  icon: <LayoutDashboard size={20} strokeWidth={1.8} aria-hidden />,
};

export default function ReportDesigner() {
  return (
    <div className="rd-root" dir="rtl">
      <h2 className="rd-title">مصمم التقارير</h2>
      <p className="rd-empty">لا توجد تقارير محفوظة بعد.</p>
    </div>
  );
}
```

```css
/* src/components/Sidebar/Tabs/ReportDesigner/ReportDesigner.css */
.rd-root { padding: 24px; }
.rd-title { font-size: 20px; font-weight: 700; margin: 0 0 12px; }
.rd-empty { color: #57606a; }
```

- [ ] **Step 4: Register in `userManagement.ts`**

In `MANAGED_TABS` (after the `reports/*` rows, before `archive`) add:

```ts
  { id: "report-designer",         label: "مصمم التقارير" },
```

In `createDefaultPermissions()` add one row per managed role, mirroring `reports`:

```ts
    { role: "guest",      tabId: "report-designer",    access: "none" },
    { role: "employee",   tabId: "report-designer",    access: "none" },
    { role: "supervisor", tabId: "report-designer",    access: "view" },
    { role: "manager",    tabId: "report-designer",    access: "edit" },
```

- [ ] **Step 5: Run test + full suite + typecheck**

Run: `npx vitest run src/components/Sidebar/Tabs/ReportDesigner/tabConfig.test.ts` → PASS.
Run: `npm run typecheck` → no errors.

- [ ] **Step 6: Edit-log + commit**

```bash
git add docs/EDIT_LOG.md src/components/Sidebar/Tabs/ReportDesigner/ src/auth/userManagement.ts
git commit -m "feat(report-designer): register tab + default permissions"
```

---

## Task 1.3: Design list + create/open/delete (wires storage to UI)

**Files:**
- Modify: `src/components/Sidebar/Tabs/ReportDesigner/index.tsx`
- Modify: `src/components/Sidebar/Tabs/ReportDesigner/ReportDesigner.css`

**Interfaces:**
- Consumes: `useWorkspace()` (`.directoryHandle`), `loadDesignIndex`/`saveDesign`/`deleteDesign`/`loadDesign` (Task 0.6), `createEmptyDocument` (Task 0.1).
- Produces: in-component state machine `view: "list" | "editor"`; on "new", create an empty doc, save it, open editor. Editor body is a placeholder until Task 1.4.

- [ ] **Step 1: Implement list UI**

Replace the `ReportDesigner` component body with a list that, on mount, calls `loadDesignIndex(directoryHandle)` and renders rows (name + updatedAt + open/delete). A "تقرير جديد" button prompts for a name (use a simple inline input, not `window.prompt`), calls `createEmptyDocument(name, currentUser)`, `saveDesign`, then sets `view: "editor"` with the new doc. Guard `if (!directoryHandle) return <p>الرجاء اختيار مجلد العمل أولاً.</p>;`. Get the current username from the existing auth session accessor used elsewhere in tabs (search `authSession` usage in `src/components/Sidebar/Tabs/Reports/index.tsx` for the exact import; fall back to `"admin"` if none).

- [ ] **Step 2: Manual verification via preview**

Start the dev server (`npm run dev` / preview tooling), select a workspace folder, open the مصمم التقارير tab, create a design, confirm it appears in the list after reload, delete it, confirm removal.

- [ ] **Step 3: Edit-log + commit**

```bash
git add docs/EDIT_LOG.md src/components/Sidebar/Tabs/ReportDesigner/
git commit -m "feat(report-designer): design list create/open/delete"
```

---

## Task 1.4: Canvas surface + element rendering (text/shape/image)

**Files:**
- Create: `src/components/Sidebar/Tabs/ReportDesigner/editor/Canvas.tsx`
- Create: `src/components/Sidebar/Tabs/ReportDesigner/renderers/TextRenderer.tsx`
- Create: `src/components/Sidebar/Tabs/ReportDesigner/renderers/ShapeRenderer.tsx`
- Create: `src/components/Sidebar/Tabs/ReportDesigner/renderers/ImageRenderer.tsx`
- Modify: `ReportDesigner.css`

**Interfaces:**
- Consumes: `ReportDocument`/`Page`/`Element` (Task 0.1).
- Produces: `Canvas` props `{ doc: ReportDocument; pageIndex: number; selectedId: string | null; onSelect: (id: string | null) => void; mode: "edit" | "view" }`. Renders the page at `pageSetup.width × height` (scaled by a `zoom` prop later), each element absolutely positioned via `style={{ left:x, top:y, width:w, height:h, transform: rotation }}`. Element body dispatches on `element.config.kind` to the matching renderer. In `edit` mode, clicking an element calls `onSelect(elementId)`; clicking blank canvas calls `onSelect(null)`. Renderers receive `{ element }` and render purely from `element.config` + `element.style` (no edit chrome inside renderers — selection outline is drawn by `Canvas`).

- [ ] **Step 1: Implement renderers**

Each renderer is a pure function of `element`. `TextRenderer` renders `config.text` with `style`. `ShapeRenderer` renders a `div`/`hr`/rounded `div` per `config.shape`. `ImageRenderer` renders `<img src={config.dataUrl} alt={config.alt ?? ""}/>`.

- [ ] **Step 2: Implement Canvas**

Absolute-positioned page container; map `page.elements` sorted by `z` to positioned wrappers. Draw a selection outline on the element whose id === `selectedId` (edit mode only).

- [ ] **Step 3: Manual verification**

Temporarily seed a doc page with one text + one shape element (hard-code in the editor for this step) and confirm they render at the right positions in the preview.

- [ ] **Step 4: Edit-log + commit**

```bash
git add docs/EDIT_LOG.md src/components/Sidebar/Tabs/ReportDesigner/
git commit -m "feat(report-designer): canvas surface + static renderers"
```

---

## Task 1.5: Drag / resize / select interactions

**Files:**
- Create: `src/components/Sidebar/Tabs/ReportDesigner/editor/useCanvasInteractions.ts`
- Modify: `editor/Canvas.tsx`, `ReportDesigner.css`

**Interfaces:**
- Consumes: `geometry.ts` (`snapRect`, `resize`, `Rect`, `ResizeHandle`).
- Produces: hook `useCanvasInteractions({ grid, onChange }): { onElementPointerDown, onHandlePointerDown }`. Pointer-move updates element rect (drag = translate; handle = `resize(...)`), snapping on pointer-up via `snapRect`. `onChange(elementId, rect)` commits to doc state. 8 resize handles drawn around the selected element in edit mode.

- [ ] **Step 1: Implement the hook** (pointer down → capture, move → compute new rect from delta, up → snap + commit + release capture).

- [ ] **Step 2: Wire handles into Canvas** for the selected element.

- [ ] **Step 3: Manual verification** — drag an element, resize from each corner/edge, confirm snapping to the grid and that changes persist after save/reload.

- [ ] **Step 4: Edit-log + commit**

```bash
git add docs/EDIT_LOG.md src/components/Sidebar/Tabs/ReportDesigner/
git commit -m "feat(report-designer): drag/resize/select interactions"
```

---

## Task 1.6: Toolbar (add elements, pages) + Inspector + autosave

**Files:**
- Create: `src/components/Sidebar/Tabs/ReportDesigner/editor/Toolbar.tsx`
- Create: `src/components/Sidebar/Tabs/ReportDesigner/editor/Inspector.tsx`
- Modify: `index.tsx` (host the editor: doc state, page nav, save button), `ReportDesigner.css`

**Interfaces:**
- Consumes: `createElementId`/`createPageId` (Task 0.1), renderers, `Canvas`, `saveDesign` (Task 0.6).
- Produces:
  - `Toolbar` — buttons: add text, add shape, add image (file → dataURL via `FileReader`), add page, delete page, prev/next page, save. Adding an element pushes a default `Element` onto the current page (e.g. text at `{x:40,y:40,w:200,h:40}`) and selects it.
  - `Inspector` — edits the selected element's `name`, geometry (`x/y/w/h`), `style` (fill, border, font size, color, text align), and type-specific content (text string; shape kind). Renders nothing when no selection.
  - Editor host owns `doc` state and persists with a debounced `saveDesign` (≈800 ms after the last change) plus an explicit Save button; bumps `updatedAt`/`updatedBy` on each save.

- [ ] **Step 1: Implement Toolbar + element/page mutations.**
- [ ] **Step 2: Implement Inspector with controlled inputs writing back to doc state.**
- [ ] **Step 3: Implement debounced autosave + explicit save in the editor host.**
- [ ] **Step 4: Manual verification** — add each element type, edit via inspector, add/delete/switch pages, confirm autosave persists across reload.
- [ ] **Step 5: Edit-log + commit**

```bash
git add docs/EDIT_LOG.md src/components/Sidebar/Tabs/ReportDesigner/
git commit -m "feat(report-designer): toolbar, inspector, autosave"
```

---

## Task 1.7: Print view (Ctrl+P → PDF)

**Files:**
- Create: `src/components/Sidebar/Tabs/ReportDesigner/PrintView.tsx`
- Modify: `index.tsx` (a "طباعة" button toggles print mode), `ReportDesigner.css` (print styles)

**Interfaces:**
- Consumes: `Canvas` in `mode="view"`, `ReportDocument`.
- Produces: `PrintView` renders every page back-to-back in `view` mode with no editor chrome. Print CSS sets `@page { size: <A4 portrait/landscape>; margin: 0; }`, forces each page wrapper to the exact `width×height` with `page-break-after: always`, and a `@media print` block hides the app shell/sidebar/toolbar (`.rd-no-print { display: none !important; }`). The "طباعة" button calls `window.print()`.

- [ ] **Step 1: Implement PrintView + print CSS.**
- [ ] **Step 2: Manual verification** — design a 2-page report, click طباعة, in the browser print dialog confirm 2 A4 pages render with correct positions and no UI chrome; "Save as PDF" produces a clean file.
- [ ] **Step 3: Edit-log + commit**

```bash
git add docs/EDIT_LOG.md src/components/Sidebar/Tabs/ReportDesigner/
git commit -m "feat(report-designer): print/PDF view"
```

---

## Task 1.8: Phase-1 integration pass

**Files:** none new — verification + docs.

- [ ] **Step 1:** Run full suite — `npm run test:run` → all pass.
- [ ] **Step 2:** `npm run typecheck` and `npm run lint` → clean.
- [ ] **Step 3:** `npm run build` → succeeds; note new `dist/index.html` size vs the ~1.9 MB baseline in CLAUDE.md (flag if it grew materially).
- [ ] **Step 4:** Update `docs/data-system-report.md` to document `4-Reports/designs/{reportId}.json` + `designs.index.json`.
- [ ] **Step 5:** Edit-log + commit.

```bash
git add docs/EDIT_LOG.md docs/data-system-report.md
git commit -m "docs(report-designer): document designs layout; phase-1 integration"
```

**At this point P1 is shippable: a working A4 print report designer with text/shapes/images, multi-page, save/load, and PDF output.**

---

# PHASE 2+ — Roadmap (each becomes its own detailed plan after P1 lands)

These phases reuse the P0 query engine and P1 canvas. They are scoped here at task level; expand each into a full bite-sized plan (its own `docs/superpowers/plans/...md`) when starting it, following the same TDD structure.

## Phase 2 — Data binding (KPI cards + data tables + filters)
- **2.1** `DataContext` for the editor: pick a month (reuse `listMonthFolders` + the executive-data path in `src/data/reporting/executiveReportData.ts`), call `buildExecutiveReportRows` + the port/stage profile builders, feed `buildDataModel`. Cache the model in editor state.
- **2.2** Field-catalog panel: list `model.tables[*].fields` grouped by dimension/measure; drag or click-to-add into element wells.
- **2.3** `KpiRenderer` + KPI config UI: choose table, value field, agg, target/comparison; render via `runQuery` (empty groupBy → single row); format helpers from `executiveReportData.ts` (`fmtNum`, `fmtPct`).
- **2.4** `TableRenderer` + table config UI: choose columns (field + optional agg), groupBy, per-column sort/format; render through `runQuery`. Reuse `DataTable` (`src/components/DataTable/`) where it fits.
- **2.5** Filter UI at element/page/report level building `Filter[]`; merge report+page+element filters before `runQuery`.
- **2.6** Print parity: ensure bound elements render identically in `PrintView`.

## Phase 3 — Charts + slides
- **3.1** `ChartRenderer` using recharts (bar/line/pie/donut/area/combo/scatter) bound via `wells` → `runQuery` → recharts series.
- **3.2** Chart config UI (axis/legend/value wells, chart-type switch, palette from `doc.theme`).
- **3.3** `docType: "slides"` + page presets 16:9 (1280×720) / 4:3 (960×720); slide navigator (thumbnails) reusing the page model.
- **3.4** Print/PDF for slides (one slide per page, landscape).

## Phase 4 — Interactive dashboard
- **4.1** `docType: "dashboard"` on-screen interactive view (no print constraints).
- **4.2** Slicer element type (a filter control bound to a dimension) that writes page-level interaction filters.
- **4.3** Cross-filtering: clicking a chart category/table row emits an interaction filter applied to other elements on the page; clear-on-reclick.
- **4.4** Performance guard: if interactive `runQuery` over a full month's fact table is janky, move `runQuery` into a Web Worker (mirror `src/workers/workbookWorker.ts`).

## Deferred (explicitly out of scope)
- Self-contained HTML export, true `.pptx` export, PNG export, theme editor UI, user-defined calculated measures/columns.

---

## Self-Review notes (author)

- **Spec coverage:** document model (§4) → Task 0.1; query engine (§5) → Tasks 0.2–0.5; storage (§8) → Task 0.6; canvas (§6) → Tasks 1.1, 1.4, 1.5; elements text/shape/image (§1) → Task 1.4; tables/KPI/charts → Phases 2–3; print output (§7) → Task 1.7; tab integration (§8) → Task 1.2; phasing (§9) → phase split; testing (§10) → per-task tests + Task 1.8. Interactive/cross-filter (decisions table) → Phase 4. All spec sections map to a task.
- **No-new-deps constraint** honored throughout (recharts only, in P3).
- **Type consistency:** `ReportDocument`/`Element`/`Filter`/`Aggregation` defined in Task 0.1 and referenced unchanged in 0.2–0.6 and 1.x; `runQuery`/`QuerySpec`/`ResultRow` defined in 0.4 and consumed in 0.5 and Phase 2; `DataModel`/`TableId` defined in 0.5 and consumed in Phase 2; geometry types defined in 1.1 and consumed in 1.5.
- **Open implementer checks flagged inline:** exact auth-session username accessor (Task 1.3) and `DirectoryHandleLike.getDirectoryHandle` availability (Task 0.6) are called out as verify-in-codebase steps rather than assumed.
