# Report Engine v2 — Design Spec

**Date:** 2026-11-01
**Status:** Draft — awaiting owner approval. No implementation before approval.
**Owner:** Report Designer (`src/data/reportDesigner/`, `src/components/Sidebar/Tabs/ReportDesigner/`), deck3 kit (`src/data/reporting/executive/deck3/`)

## 1. Intent

The owner wants to produce deck3 (the live executive report) and many other reports — first the Jeddah port business report — from **reusable templates** that re-run each month or per port on new data, and to customize them PowerPoint/Power BI style: add tables and charts, drag them left/right, add lines and dividers, edit text.

Decisions agreed in brainstorming (2026-11-01):

| Decision | Choice |
|---|---|
| Primary use | Reusable templates (build once, re-run on new data or a new parameter value) |
| Data sources | App workspace data **and** uploaded Excel mapped to the data dictionary |
| Placement | Free x/y **and** snap grid, user-toggleable |
| Export | Self-contained HTML + Excel of the figures (no .pptx in scope) |
| Approach | **Evolve the existing Report Designer** — not a parallel engine, not code-only templates |
| Visual system | deck3 theme (owner-approved) as the engine's only design system |

Constraints from CLAUDE.md: every figure traceable to real data fields; one source per constant; any on-disk format change ships an admin-offered migration that archives originals; Arabic/RTL UI through label keys; the build stays a single `dist/index.html`.

## 2. What exists and is reused

| Piece | Location | Role in v2 |
|---|---|---|
| Document model (pages; elements with x/y/w/h/z; table/chart/kpi/text/shape/image; filters; aggregations) | `src/data/reportDesigner/reportTypes.ts` | Extended to schema v2 |
| Geometry | `src/data/reportDesigner/geometry.ts` | Gains snap and guide math |
| Field catalog + aggregations | `src/data/reportDesigner/query/` | App-data binding layer |
| Design storage (CAS index + per-design file) | `reportDesigner/storage/reportDesignStorage.ts`, `4-reports/designs/` | Persistence, same path |
| Editor UI (Canvas, Inspector, Ribbon, FieldsPanel, PagesBar, VizPanel) | `Tabs/ReportDesigner/editor/` | Editor shell |
| deck3 slide/chart kit + theme | `deck3/slideKit.ts`, `chartKit.ts`, `theme.ts` | **Block renderers and design tokens** |
| In-viewer text editing + statement templates | `deck3/textEdit.ts`, `textTemplates.ts` | Rich-text block, bound placeholders |
| Excel parse worker + column-mapping workbench | `src/workers/workbookWorker.ts`, `adhocImport/adhocMappingModel.ts`, `adhocFieldCatalog.ts` | Excel dataset import |
| Port report (parameterized deck; streaming population reader) | branch `claude/jeddah-port-report-ed0ba9`: `src/data/reporting/portReport/`, `scripts/lib/populationSheets.mjs` (uncommitted) | Second starter template; streaming reader ported to a worker |

## 3. Feature list

1. Block library in deck3 style: `kpiBand`, `tintedPanel`, `qualityMatrix`, `barChart`, `groupedBarChart`, `dataTable`, `observationsTable`, `matrixGrid`, `sectionHeader`, `divider`, `line`, `richText`, `image`, plus page frames (cover, contents, section divider, closing, glossary).
2. Drag to place, resize, z-order, align/distribute, duplicate, lock, multi-select, undo/redo.
3. Snap toggle: 12-column grid and smart guides (sibling edges/centres, page centre), arrow-key nudge. Off = free pixel placement.
4. Datasets: add from app data (population / sample / distribution / answers) or upload Excel.
5. Excel auto-mapping: headers matched to `docs/reference/DATA_DICTIONARY.md` fields (port name, image id, declaration id, dates, risk level, …); the user confirms or corrects in the mapping workbench; the mapping is saved with the template and re-applied to the next upload.
6. Bindings per block: group-by, measures (count / distinct / sum / avg / min / max / % of total), filters, sort, top-N.
7. Parameters: a template declares `port`, `month`, `year` (extensible); a viewer picker re-scopes every page.
8. Text: inline editing on the canvas; placeholders bound to measures and params render live values.
9. Theme-locked styling: the inspector offers deck3 tones and type steps only.
10. Export: self-contained HTML deck (with a param picker, or one file per selected param value); XLSX with one sheet per bound table/chart.
11. Starter templates: deck3 and the port business report ship as built-in, copyable v2 designs.

Out of scope: .pptx export, free hex colours, custom formulas, multi-user live co-editing.

## 4. Architecture

### 4.1 Block model

```ts
type BlockType = "kpiBand" | "tintedPanel" | "qualityMatrix" | "barChart" | "groupedBarChart"
  | "dataTable" | "observationsTable" | "matrixGrid" | "sectionHeader"
  | "divider" | "line" | "richText" | "image" | "pageFrame";

interface BlockDefinition<C> {
  type: BlockType;
  labelKey: string;                 // labelsStore key (Arabic)
  defaultSize: { w: number; h: number };
  defaultConfig(): C;
  bindingShape: BindingShape;       // none | scalars | series | table
  render(config: C, data: ResolvedData, theme: ThemeTokens): string; // calls slideKit / chartKit
  inspector: InspectorSchema;       // declarative fields, no per-block React form
}
```

One `blockRegistry.ts` holds every definition. The canvas and the exporter both call `render`, so the editor matches the export by construction. The deck3 kit functions already take plain values; where one reads `ExecutiveReportInput` directly it is split into "compute" (stays in deck3) and "render" (shared).

v1 element types map to blocks during migration (§4.7).

### 4.2 Data binding

```
Dataset (rows typed by dictionary field ids)
  → Binding { datasetId, groupBy[], measures[], filters[], sort, topN }
  → aggregations.ts
  → ResolvedData
  → block.render
```

- **App datasets** read through `fieldCatalog.ts` and the existing month loaders (respect `MonthLoadScope`). No new refresh path: the editor subscribes to `dataRefreshSignal`, and a refresh never discards unsaved design edits.
- **Excel datasets** parse in the workbook worker. Large population sheets use a chunked streaming parse ported from `populationSheets.mjs` into the worker. Rows are projected to dictionary field ids through the saved mapping.
- **Traceability rule:** a measure may reference only a dictionary-mapped field. Unmapped columns show in the mapping workbench but cannot be measured. Every rendered figure carries `{ datasetId, field, agg, filters }` provenance, visible in the inspector and written to the XLSX notes sheet.
- Resolution runs off the main thread for datasets above a row threshold (reusing the `populationQueryWorker` pattern). Results are memoized per `(binding, paramValues, datasetRevision)`.

### 4.3 Parameters

```ts
type ParamDef = { id: string; labelKey: string; datasetId: string; field: string; default?: string };
```

A filter value may be `{ param: "port" }`. Choices come from the dataset's distinct values of `field`. The canvas and the viewer show a picker; changing it re-resolves every binding. Port report = template + `port` param. deck3 = template + `month` param.

### 4.4 Layout

- Canonical coordinates stay free `x/y/w/h` in px @96dpi, as in v1.
- `document.layout = { snap: boolean, columns: 12, gutter: number, rowUnit: number }`. Snap rounds on drag and resize. Guides are computed in `geometry.ts` (pure, unit-tested). The toggle lives in the Ribbon and persists in the document; holding Alt while dragging inverts it temporarily.
- Page presets: 16:9 (deck3 native) and A4 portrait/landscape.
- RTL: the UI measures from the page's right edge; stored values stay left-based. One helper converts.

### 4.5 Theming

`deck3/theme.ts` is the single token source (colours, tones, type scale, radii, spacing). Inspector controls expose **tones and steps**, never raw colour, so designs cannot drift off-brand and `check:hex-literals` holds. Block CSS is deck3 CSS; there is no second stylesheet.

### 4.6 Text

The `richText` block reuses `textEdit.ts` (contenteditable, sanitized). Placeholders `{{measure:<id>}}` and `{{param:port}}` resolve at render time. `textTemplates.ts` statements are insertable snippets that stay computed from data. Numbers format through `src/utils/formatting.ts`. Punctuation follows the port-report rules (regular hyphen, not the long dash).

### 4.7 Persistence and migration

| File | Path | Notes |
|---|---|---|
| Design v2 | `4-reports/designs/{reportId}.json` | `JsonEnvelope`, `schemaVersion: 2`; adds `datasets[]` (definition + Excel mapping profile), `params[]`, `layout`, block-typed elements |
| Design index | `4-reports/designs/designs.index.json` | Unchanged, CAS-protected |
| Excel dataset snapshot | `4-reports/datasets/{datasetId}/rows.json` (chunked `rows.{n}.json` when large) + `source.json` (filename, sheet, content hash, mappedAt ISO date) | Written through `safeWriteJson`; path resolved via `workspacePaths.ts` |

Migration lives in its own tested module, `src/data/reportDesigner/migrations/v1ToV2.ts`. It is offered to an admin at sign-in when any v1 design exists, never runs silently, and is never offered to a non-admin (who keeps read-only rendering of v1 designs until migration). Each v1 file is archived as `{reportId}.v1.json` before the v2 write. Mapping: `kpi → kpiBand` (one cell), `chart(bar) → barChart`, `table → dataTable`, `shape(divider|line) → divider|line`, `text → richText`, `image → image`. Chart types with no deck3 block (pie, scatter, …) keep a legacy renderer, flagged in the inspector.

Rollback: renaming `.v1.json` back restores a design; v2 code reads v1 through the migration mapper.

### 4.8 Export

- **HTML:** one self-contained file with deck3 CSS and fonts inlined and blocks pre-rendered. Optionally it bakes a param picker holding pre-resolved data for the param values the owner selects (bounded to keep file size sane), or produces one file per value.
- **XLSX** (vendored SheetJS): one sheet per bound table/chart with resolved rows and Arabic headers, plus a provenance notes sheet.

## 5. How the two existing reports are expressed

**deck3:** a template with a `month` param, bound to app datasets (population, sample, answers). Slides become pages. Cover/contents/closing become `pageFrame`; KPI rows become `kpiBand`; القسم 3 analytics become `qualityMatrix`, `groupedBarChart`, `tintedPanel(land|sea)`; observation pages become `observationsTable`; statements become `richText` with `textTemplates` snippets. Parity: render the template and the code deck from the same synthetic month (`deck-preview.html`) and diff text and figures per slide. The code deck stays the live default until parity passes.

**Port business report:** a template with `port` (and `year`) params on an Excel dataset mapped from the export (port name, image id, dates, risk level, …). Each current page's sections become blocks; the population yearly comparison uses a streamed population dataset. Parity is checked the same way against `scripts/export-port-report-static.mjs` output.

## 6. Phased roadmap

| Phase | Delivers | Edit-log tier |
|---|---|---|
| P1 | `blockRegistry` + deck3-kit renderers on the canvas; schema v2 types; v1→v2 migration with archive | 3 |
| P2 | Datasets: app sources and Excel upload, dictionary auto-mapping, saved mapping profile, streaming worker | 3 |
| P3 | Parameters and picker; port report as a starter template with parity diff | 2 |
| P4 | Snap/guides toggle, align/distribute, multi-select, undo/redo polish | 2 |
| P5 | deck3 as a starter template with per-slide parity diff | 2 |
| P6 | HTML export with baked params; XLSX export with provenance | 2 (+ `check:bundle-size`) |

Each phase is its own PR.

## 7. Testing

- Pure units in the node environment: snap/guide geometry, binding resolution, param substitution, mapping auto-match, migration mapper.
- Block renderers are snapshot-tested **before** the deck3 kit is refactored (determinism contract).
- jsdom tests for the inspector schema and drag/snap interactions.
- Parity diffs as tests over non-empty synthetic fixtures (the empty-fixture trap from القسم 3).

## 8. Open questions

1. Uploaded Excel data: persist it in the workspace (`4-reports/datasets/`, shared but larger) or keep it in memory per session (re-upload each time)? The spec assumes persisted.
2. Who may edit templates: admin only, or manager/supervisor through a new grantable `canMutate` capability? The spec assumes a new capability, default admin only.
3. Will .pptx ever be wanted? Not designed for; it would need a shape-based chart renderer.
4. Once the deck3 template reaches parity, retire the code-built deck3 or keep it as a fallback edition?
5. The port report branch (`claude/jeddah-port-report-ed0ba9`) is uncommitted. It should be committed or merged before P3 so the template has a stable reference.
