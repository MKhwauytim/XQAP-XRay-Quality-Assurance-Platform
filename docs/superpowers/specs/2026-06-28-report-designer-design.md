# Report Designer — Design Spec

**Date:** 2026-06-28
**Status:** Approved (design); implementation plan pending
**Author:** brainstorming session

## 1. Summary

A Power-BI-style **visual report/dashboard designer** inside the x-ray-quality-app. Users
lay elements onto a fixed-size canvas (A4 print page or PPT-style slide), bind tables /
charts / KPI cards to data pulled from the system, add static text / shapes / images, and
**save the layout as a reusable template** that re-binds against any month's data.

This is a **new subsystem**, distinct from the existing `6-Templates/` form templates
(`templateTypes.ts`), which are data-entry forms for collecting answers. The existing
`src/data/reporting/` layer produces fixed, code-authored HTML reports; this feature lets
users *design* report layouts themselves.

### Decisions locked during brainstorming

| Question | Decision |
|----------|----------|
| Output target | **All of the above** — A4 print, PPT-style slides, interactive dashboard. Print is the foundation; slides + interactivity layer on top of one shared canvas + data model. |
| Data binding | **Free field-dragging with aggregations, filters, and cross-filtering, but NO user-defined calculated columns / measure language.** |
| Element types | Data table/matrix, charts, KPI cards, text/shapes/images — **all four**. |
| Export | **Print / PDF (browser Ctrl+P) only for now.** HTML / PPTX / PNG export deferred (hooks left in the model). |
| Canvas engine | **Custom absolute-positioned canvas (no new drag/resize library).** |
| Storage | Under `4-Reports/` (separate from `6-Templates/`). |

## 2. Why custom canvas over a library

The build is a single ~1.9 MB inlined `dist/index.html` (`vite-plugin-singlefile`). Heavy
export libs were explicitly declined for bundle reasons; the same logic applies to canvas
libs. Grid-cell libraries (react-grid-layout) fight the **pixel-precise A4/slide layout**
that print output requires, and have RTL quirks. RTL is a first-class requirement here. A
custom absolute-positioned canvas with pointer-event drag/resize keeps the bundle flat,
gives full control over snapping/guides/print, and is well-trodden territory. `recharts`
(already a dependency) covers charts; no new runtime deps are required for the core feature.

## 3. The data unlock

`ExecutiveReportRow` (`src/data/reporting/executiveReportTypes.ts:14`) is already a **flat,
denormalized fact table** — one row per x-ray image, joining population + sample +
distribution + answers, with all dimensions (portName, portType, stage, levelOne/Two/image
results, imageQuality, suspicionLevel, suspectedTypes, smuggleMethod, verificationCategory)
and flags (selectedInSample, imageAvailable, hasMarking, accuracy booleans, statuses).

Because this table is already joined, the "query builder" needs **no join engine and no
backend** — it runs in-browser as group-by / filter / aggregate / sort / top-N over a row
array. `PortProfile[]`, `StageProfile[]`, and the scalar `ExecutiveKPIs` provide
ready-made pre-aggregated tables. All are produced by the existing
`buildExecutiveReportData` path in `src/data/reporting/executiveReportData.ts`.

## 4. Document model (the saved template)

A `ReportDocument` JSON, wrapped in the standard `JsonEnvelope` on disk:

```ts
ReportDocument {
  reportId: string; reportName: string; version: number;
  createdAt, createdBy, updatedAt, updatedBy: string;
  docType: "print" | "slides" | "dashboard";   // drives default page preset + chrome
  pageSetup: {
    size: "A4" | "Letter" | "16:9" | "4:3" | "custom";
    orientation: "portrait" | "landscape";
    width: number; height: number;              // document units (px @96dpi)
    margins: { top; right; bottom; left };
  };
  theme: { palette: string[]; fontFamily: string; defaults: {...} };
  dataSources: DataSourceRef[];                 // which tables are in play
  pages: Page[];
  reportFilters: Filter[];                       // report-level
}

Page {
  pageId; name; order: number;
  background?: { color?; image? };
  filters: Filter[];                             // page-level
  elements: Element[];
}

Element {
  elementId; type: "table" | "chart" | "kpi" | "text" | "shape" | "image";
  name: string;
  x; y; w; h; z: number; rotation?: number; locked?: boolean;
  style: ElementStyle;                           // fill, border, padding, font, etc.
  config: TableConfig | ChartConfig | KpiConfig | TextConfig | ShapeConfig | ImageConfig;
}
```

Type-specific config:

```ts
TableConfig { dataSourceId; columns: Array<{ field; agg?; sort?; format?; condFormat? }>;
              groupBy: string[]; filters: Filter[]; }
ChartConfig { chartType: "bar"|"line"|"pie"|"donut"|"area"|"combo"|"scatter";
              dataSourceId; wells: { axis: string[]; legend?: string; values: Array<{field; agg}> };
              filters: Filter[]; options: {...}; }
KpiConfig   { dataSourceId; valueField; agg; target?; comparison?; format; }
TextConfig / ShapeConfig / ImageConfig — static content + style only.

Filter { field; op: "equals"|"in"|"notEquals"|"between"|"contains"|"truthy"|"falsy"|"topN";
         value: unknown; }
```

**Templates store field *names*, never data values.** A saved design is reusable: open it,
pick any month, bindings re-evaluate against that month's data.

## 5. Query engine — `src/data/reportDesigner/query/` (pure, no UI)

- `buildDataModel(monthData) → DataModel` — named tables (`fact`, `portProfiles`,
  `stageProfiles`, `kpis`), fed by the existing executive-report data path.
- `runQuery(table, { groupBy, values, filters, sort, limit }) → ResultSet` — pure function.
- Aggregations: `count`, `distinctCount`, `sum`, `avg`, `min`, `max`, `%ofTotal`.
- Field catalog: derived from the row schema; each field tagged dimension vs
  measure-capable, with display label (Arabic) + data type.
- Cross-filtering (dashboard mode): a click on a visual produces an *interaction filter*
  applied to other visuals on the same page.
- Fully unit-testable with Vitest + `createMemoryDirectory` fixtures **before any UI
  exists**.

## 6. Canvas engine (custom)

Absolute positioning in document units (px @96dpi). Features: snap-grid, multi-select,
drag, 8-handle resize, z-order, alignment guides, zoom, and a page/slide navigator panel.
One set of element **renderer components** is used in *both* edit mode (with selection
chrome) and view/print mode (clean) — no duplicate rendering logic. RTL-aware throughout.

## 7. Output / export

Print/PDF only for v1: a dedicated print view applies `@page` size + `page-break` per page,
hides all editor chrome, and renders clean element output → user does Ctrl+P → Save as PDF.
Model hooks are left for later HTML / PPTX / PNG export, theme editor, and calculated
measures, but those are out of scope now.

## 8. Integration with the app

- **New tab** `report-designer`, label `"مصمم التقارير"`, roles `["supervisor","manager","admin"]`
  (mirrors Reports' access), auto-discovered via `tabRegistry`. Registered in `MANAGED_TABS`
  and `createDefaultPermissions()` in `src/auth/userManagement.ts`.
- **Persistence** under `4-Reports/` via existing `getReportsRoot`:
  - `4-Reports/designs/{reportId}.json` — one `ReportDocument` per file (JsonEnvelope).
  - `4-Reports/designs/designs.index.json` — index `{ designs: [{reportId, reportName, version, updatedAt}] }`.
  - Uses `safeWriteJson` / `safeReadJson` + `withResourceLock`, mirroring `templateStorage.ts`.
- New data-layer module dir `src/data/reportDesigner/` (types, query, storage).
- New tab UI dir `src/components/Sidebar/Tabs/ReportDesigner/`.

## 9. Phasing

| Phase | Scope | Shippable? |
|-------|-------|-----------|
| **P0** | Types + query engine (pure, fully Vitest-tested). No UI. | internal |
| **P1** | Canvas shell: A4 print doc, multi-page, text/shape/image elements, select/move/resize/snap/z-order, save/load template, print view. | **yes — working print designer** |
| **P2** | Data binding: field catalog panel, KPI cards + data tables bound to fact/profile tables, element/page/report filters. | yes |
| **P3** | Charts (recharts) with axis/legend/value wells; `slides` doc type (16:9 / 4:3) + slide navigator. | yes |
| **P4** | Interactive dashboard mode: slicers + cross-filtering + on-screen interactive view. | yes |
| Deferred | HTML / PPTX / PNG export, theme editor, calculated measures. | — |

## 10. Testing strategy

- Query engine: pure unit tests (group-by, each aggregation, filter ops, top-N, sort,
  cross-filter composition) with fixed fixtures.
- Storage: round-trip save/load/delete/index via `createMemoryDirectory`, envelope
  versioning, `.bak` recovery.
- Document model: serialization round-trip; migration guard for schemaVersion bumps.
- Canvas geometry helpers (snapping, hit-testing, resize math): pure unit tests.
- In-app test runner (`src/test-runner/`) for browser-only canvas smoke tests where useful.

## 11. Risks / constraints

- **Bundle size**: monitor `dist/index.html` after each phase; keep the no-new-deps rule.
- **File System Access API**: designer is Chromium-only, like the rest of the app.
- **Performance**: query engine runs over full-month fact tables in the main thread; if a
  month's row count makes interactive cross-filtering janky, move `runQuery` into a Web
  Worker (the workbook worker pattern already exists). Not needed for P0–P3.
- **Edit-log requirement**: every code edit recorded in `docs/EDIT_LOG.md` per CLAUDE.md.
- **Security model**: advisory-only, same as the rest of the app — no new trust boundary.
