# Report Engine v2, Design Spec

**Date:** 2026-11-01
**Status:** Approved by owner 2026-11-01. Next: implementation plan.
**Owner:** Report Designer (`src/data/reportDesigner/`, `src/components/Sidebar/Tabs/ReportDesigner/`), deck3 kit (`src/data/reporting/executive/deck3/`)

## 0. Owner decisions, 2026-11-05 (supersede conflicting text below)

Taken after reviewing `docs/research/2026-11-05-pptx-fidelity-research.md` and `docs/research/2026-11-05-report-engine-ideas.md`:

1. **Rebuild from zero on one layout model.** One absolute, pre-measured layout model renders HTML, PDF and PPTX from the same numbers; deck3 output stays matched by `kitSnapshot.test.ts`. This replaces "evolve the string kit", the P1 plan (`docs/superpowers/plans/2026-11-01-report-engine-p1-blocks-and-migration.md`) is paused after Task 3 and will be re-planned on the new model.
2. **PPTX proof of concept first**, before the layout rebuild: one deck3 KPI slide + one native editable chart + one Arabic table, opened in PowerPoint and compared with the HTML.
3. **Catalog starts with 15-20 designs** seeded from real deck3 slides, numbered stably, grown on request (not a fixed 100).
4. **Latin digits (123)** in tables, charts and text.
5. **Other departments** pick designs from the exported catalog and send their Excel; an admin maps the data and produces the report.
6. **Editor and output quality are equal priority**; work on both in parallel.
7. **Every report always ships in four formats together: HTML, PDF, PowerPoint and Excel.** No format exists without the others. Excel carries the raw data the report was built from, the computed figures, and the source of every figure.
8. **Exact layout parity across formats.** The same text sits on the same number of lines at the same position in HTML, PDF and PowerPoint. A label and its value that sit side by side in HTML (for example a label followed by «(50%)») sit side by side in PowerPoint, never wrapped below or split. Enforced by an automated check per text box and table cell: equal line count and top-left within 2px; any mismatch blocks the export.

## 0.1 The engine is a portable module: its output principles

The report engine is a self-contained module. It runs inside this app today and must drop into a second or third system unchanged: no import from X-ray code, no dependency on this app's workspace, auth or UI. The host system only supplies data (rows plus a domain pack) and receives files. Every host gets the same output guarantees, because they live in the module, not in the host:

| # | Principle | Meaning |
|---|---|---|
| M1 | Four formats, always together | Every report issue produces HTML, PDF, PowerPoint and Excel. No format alone. |
| M2 | Exact layout parity | Same lines, same positions, same pages in all visual formats; checked per text box, mismatch blocks the issue. |
| M3 | Excel is the raw data | The workbook holds the rows the report was built from, the computed figures, and each figure's source. |
| M4 | Native and editable | PowerPoint uses real text, tables, charts with embedded data and grouped shapes; pictures only for logos and user images. |
| M5 | Right to left by default | Every paragraph `rtl="1"` and `algn="r"`; numbers and Latin tokens in their own left-to-right runs; Latin digits. |
| M6 | No invented figures | Every number is a mapped field or a registered measure of the domain pack. |
| M7 | Full text, never clipped | The fit ladder (one line, shrink to 85%, widen, two lines, else error); long tables continue on «يتبع» slides. |
| M8 | Design rules enforced | The §4.9 lint (Floor, Reflex, Finish, Text) runs on every issue; no long dash, no emojis. |
| M9 | Domain-neutral core | X-ray, tax, cases and studies are domain packs (fields, measures, dimensions, parameters); the core knows none of them. |
| M10 | Same identity everywhere | deck3 tokens and the Somar font; the module ships the font and its installer for PowerPoint hosts. |

**M3 in detail: the Excel workbook layout (owner, 2026-11-05).** The workbook always starts from the base population and moves to what is derived from it:

| Order | Sheet | Content |
|---|---|---|
| 0 | الفهرس (navigation) | A map of every sheet with a link to it and one line on what it holds, so moving around the workbook is easy |
| 1 | المجتمع | The base data as an organized Excel table (headers, filters, frozen header row), with a pivot table on its left showing the report's main measures |
| 2 | العينة (and any other derived set) | The derived rows, same layout: organized table plus a pivot of its main measures |
| 3 | الإحصائيات | One sheet holding all the report's calculations as pivot tables (or Power Query where that performs better; pivot is the default), each pivot labelled with the slide it feeds |
| 4 | المصدر | Each figure in the report, the sheet, field, filter and measure it comes from |

**Workbook design (owner, 2026-11-05, supersedes the plain layout above where they differ):**
- **Cover and index sheet first:** a designed page, not a plain list. The authority logo top right, report name, report date and the report's base facts, then navigation buttons to every part: المجتمع, العينة, الإحصائيات, and the topic sheets.
- **Every sheet is designed:** a calm background fill in the report palette (deck3 tokens), the logo top right, a title band, organized tables, charts, filters and slicers. Width and height are used well; no long single column of content.
- **A back button on every sheet** that returns to the cover.
- **Statistics sheet:** organized and laid out in a grid, with a chart next to each table where it helps.
- **Separator sheets between parts:** a black tab and a black, empty sheet (gridlines and headers hidden, nothing else on it) that only marks a boundary. Names are vertical bars, one more each time so names stay unique: `|`, `||`, `|||`, and so on.
- **Order:** الفهرس, `|`, المجتمع, العينة, `||`, الإحصائيات والنسب, `|||`, then the topic sheets, then المصدر.

**Workbook round 2 (owner, 2026-11-05):**
- **Raw data comes first, exactly as uploaded:** every uploaded file and sheet, every column, same names and order, no column dropped. Then **processing sheets** that show each step the system applied (mapping, cleaning, filters, joins), each step on its own sheet. Only then the processed المجتمع and العينة. Order: الفهرس, `|`, raw sheets, `||`, processing steps, `|||`, المجتمع and العينة, `||||`, الإحصائيات, `|||||`, المصدر.
- **Buttons are shapes**, the whole button clickable, not a hyperlink on the cell text.
- **Everything interactive:** every figure on the cover links to the pivot or cell it comes from; every row of المصدر links to its sheet and cell; the index links to every sheet.
- **Font:** Somar everywhere, cells, shapes, charts and slicers.
- Excel limit: a sheet holds at most 1,048,576 rows, so a raw set larger than that is split across numbered sheets the same way the uploaded files split it.

Feasibility note (needs test T8): the vendored SheetJS community build writes data and formulas; native pivot tables and Excel table objects need their own OOXML parts (pivot cache, pivot table, table definitions). The plan is the same as PowerPoint: build the workbook, then add these parts by post-processing the zip, and verify in Excel through COM that the pivots refresh and match the report's figures.

**M11 Pipeline order: raw data, then the Excel workbook, then the slides (owner, 2026-11-05).** No figure is ever hard-coded. Every issue runs in this order:
1. Read the raw data (population, sample, any other set) and link it to tables.
2. Build the Excel workbook: the raw tables, the pivots and every statistic the report shows, each defined once as a named measure over the raw tables.
3. Build HTML and PowerPoint from those same definitions. Every number on a slide is a reference to a statistic defined in step 2, never a typed value.

Technical note: the app runs in the browser with no Excel engine, so it cannot read values back out of Excel's pivots. Instead the engine holds one set of statistic definitions; Excel gets them as pivots and formulas, and the slides get the values the engine computes from the same raw rows with the same definitions. A parity check compares every slide figure with the workbook's pivot value and blocks the issue on any difference. The PoC built so far does not follow this order yet (its slide figures come from the port report code and the workbook was built beside it); the engine must.

**M12 Two separate sections in every workbook: raw, then processed (owner, 2026-11-05).** This is a general rule of the module, for every report and every domain, not only the port report:
1. **Raw section:** the data exactly as it was uploaded, same files, sheets, columns, names and order, untouched.
2. **Processed section:** each processing step the system applied on its own sheet, then the processed sets (population, sample, any other), then the statistics.
The two never mix, and the processed section must reconcile with the raw one (raw rows minus each step's removed rows equals processed rows), checked on every issue.

Size note: raw uploads can be large (the port report's source is a 318 MB workbook with millions of population rows). Measured size and open time decide the packaging; if one file is impractical, the raw section ships as a companion workbook issued and linked together with the report workbook, never dropped.

**M13 Reliability: the module never breaks, never stops halfway, never issues a wrong report (owner, 2026-11-05).**
- **Fail closed, all or nothing.** An issue either produces all four files with every gate passed, or produces none and shows one clear Arabic message naming the slide, block and rule that failed. No partial set, no file with a silent error.
- **Validate at every boundary.** Uploaded files, mapping, domain pack, template, parameters and every block config are checked against a schema before any work; unknown or malformed input is rejected with its location, never guessed.
- **Bounded by design.** Fixed limits, stated in the module: rows per dataset, slides per report, blocks per slide, categories per chart (beyond the limit the chart-form rules switch to top N plus «أخرى»), cells per table page (beyond it the table continues on «يتبع»), time budget per issue. Hitting a limit is a clear message, never a crash or a hang.
- **Deterministic.** Same raw data, template and parameters give byte-identical files; snapshot tests hold this.
- **Gates before release.** Figure parity (slides against workbook), layout parity (HTML against PowerPoint line counts and positions), design lint, raw-to-processed reconciliation, OOXML self-check (each file re-opened by a parser; in the PoC also by PowerPoint and Excel), slicer and pivot counts. Any gate failing blocks the issue.
- **Tested against hostile input.** Empty data, one row, millions of rows, nulls, very long Arabic text, mixed digits, duplicate names, missing columns, wrong types; each has a test that proves the module refuses or handles it.
- **Isolated work.** Heavy steps run in a worker with a time budget; a failure there cannot freeze or corrupt the host app.

**M14 Catalog and slide picks (owner idea, 2026-11-05).** The catalog is a numbered HTML lookbook of every design, which can be filled with real data for a preview. It is sent to a department; they reply with slide numbers (for example 1, 4, 5, 6, 10). Those numbers are entered in the system (typed, or imported from the picks file), and the report is issued with exactly those designs in that order, through all gates and in all four formats. Numbers are stable forever: a retired design keeps its number and is refused with a clear message.

Interface to a host (sketch): `issueReport(template, packId, datasets, params) → { html, pdfPrintable, pptx, xlsx, lintReport, parityReport }`. The host decides where files go; the module never reads or writes the host's storage directly.

## 1. Intent

The owner wants to produce deck3 (the live executive report) and many other reports, first the Jeddah port business report, from **reusable templates** that re-run each month or per port on new data, and to customize them PowerPoint/Power BI style: add tables and charts, drag them left/right, add lines and dividers, edit text.

Decisions agreed in brainstorming (2026-11-01):

| Decision | Choice |
|---|---|
| Primary use | Reusable templates (build once, re-run on new data or a new parameter value) |
| Data sources | App workspace data **and** uploaded Excel mapped to the data dictionary |
| Placement | Free x/y **and** snap grid, user-toggleable |
| Export | Self-contained HTML + Excel of the figures (no .pptx in scope) |
| Approach | **Evolve the existing Report Designer**, not a parallel engine, not code-only templates |
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
12. Analysis features required by the acceptance test (§5.1): named ratio measures, binding scope (param / all / fixed), derived datasets, named thresholds, ranking mode, `lineChart` / `tierHistogram` / `kvTable` / `statStack` blocks, statistics placeholders (mean, median, rank), table auto-pagination, show-if-not-empty, cross-dataset join on a shared key.

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

### 4.9 Design rules: new designs must not look AI-generated

Owner requirement (2026-11-05): deck3's approved look stays, but every **new** catalog design and every generated slide must not read as machine-made. Baseline adapted from hallmark (github.com/nutlope/hallmark, installed here as the `hallmark` skill); its web-page rules are translated to slides below. stop-slop (github.com/hardikpandya/stop-slop) covers English prose only; Arabic report text gets its own list (T-rules).

Rules come in three tiers, checked by an automated **design lint** that runs on every catalog design and every rendered report (on the layout model, plus a browser render), and by a fresh-context reviewer before a design enters the catalog.

**Floor: never ships.**
- F1 Text contrast ≥ 4.5:1 (≥ 3:1 at ≥ 44px).
- F2 No overflow: every box's measured content fits; overflow paginates ("يتبع"), never clips.
- F3 No invented figures: every number traces to a binding (CLAUDE.md rule); a design's demo data is labelled «بيانات توضيحية» inside the slide.
- F4 Minimum font size 20px on a 1920×1080 slide.
- F5 Colour never carries meaning alone: a status, a winning bar or a risk level also says so in text.

**Reflex: the defaults a model falls into; a design may overrule one only with a written reason in its manifest.**
- R1 No eyebrow label above every title. An eyebrow appears only where it carries information, such as a section name on a divider.
- R2 No tracked-capital or spaced-out labels.
- R3 No single coloured word in a title.
- R4 No grid of identical cards when the content is not parallel; a list of 4+ items becomes a table, a chart or a ranked list.
- R5 No icon-per-bullet decoration.
- R6 No decorative gradients, glows or drop shadows beyond deck3's tokens.
- R7 No filler slide ("شكرًا"/"أسئلة؟" text-only) unless the owner asks; closing is the org block as deck3 does.
- R8 Titles state the finding, not the topic ("نسبة التوائم 92% في جدة" over "نسبة التوائم").
- R9 Every slide has one focal element; no slide with three equal-weight charts.

**Finish: craft checks, reported, never blocking.**
- K1 Consistent number format (Latin digits, thousands separator, % precision per measure).
- K2 Aligned edges: blocks snap to the 12-column grid or to a sibling edge.
- K3 Repeated elements keep their positions across slides (title, footer, legend).
- K4 Chart axis and labels follow deck3 conventions (honest zero, gaps for null).

**Text rules for Arabic and English report prose (T).**
- T1 No stock openers or closers («في عالم اليوم»، «ختامًا»، «لا يخفى على أحد»).
- T2 No hedging stacks («قد يكون من الممكن»), no intensifier padding («بشكل كبير جدًا»).
- T3 Never the long dash (— or –) anywhere, in any language: titles, notes, tables, exports. Use a regular hyphen, a comma or a colon. The lint fails on it (Floor).
- T6 No emojis or decorative symbols (✓, ✅, ⚠, ★, arrows) in report output; state the word instead («خلصت», «متأخر»). The lint fails on them (Floor).
- T4 One claim per sentence, each tied to a figure on the slide.
- T5 English text additionally passes stop-slop's phrase and structure lists.

Where it lives: `src/engine/lint/designLint.ts` (pure, over the layout model) + a browser pass for contrast and overflow; results show in the editor as a panel (Floor = error, Reflex = warning with an "overrule with reason" action, Finish = note). Catalog entry requires zero Floor and zero un-reasoned Reflex findings.

## 5. How the two existing reports are expressed

**deck3:** a template with a `month` param, bound to app datasets (population, sample, answers). Slides become pages. Cover/contents/closing become `pageFrame`; KPI rows become `kpiBand`; القسم 3 analytics become `qualityMatrix`, `groupedBarChart`, `tintedPanel(land|sea)`; observation pages become `observationsTable`; statements become `richText` with `textTemplates` snippets. Parity: render the template and the code deck from the same synthetic month (`deck-preview.html`) and diff text and figures per slide. The code deck stays the live default until parity passes.

**Port business report:** the reference acceptance test, §5.1.

### 5.1 Acceptance test: rebuild the Jeddah port business report by hand

**Owner's acceptance bar:** the owner can rebuild the port business report (`src/data/reporting/portReport/`, branch `claude/jeddah-port-report-ed0ba9`) exactly, by hand, inside the app. The only real effort is pointing the engine at the data, meaning uploading the study export and the population sheets and confirming the column mapping. Layout, tables, charts and text all come from built-in features. No report-specific code is allowed: if a slide needs code, the engine is not done.

**Datasets** (all Excel, mapped once and the mapping saved with the template):
- `studies`: study rows (port, port type, employee code/name, level 1/2, status, image date).
- `population`: population sheets, streamed (port, port type, year, suspicion flag).

**Parameter:** `port` on `studies.port`. Every binding filters on `{param: "port"}` unless it is marked **"all ports"** scope.

| # | Slide (today's code) | Recreated with |
|---|---|---|
| 1 | Cover (`coverSlide`) | `pageFrame:cover`; title `richText` with `{{param:port}}`; org block from `src/branding/` |
| 2 | Glossary (`glossarySlide`) | `pageFrame:glossary`; groups typed as static text |
| 3 | Section 1 divider (`sectionDivider`, ghost "01") | `pageFrame:sectionDivider` (kicker, title, ghost number as config) |
| 4 | Population by port type: per-type tinted panels with tables, plus the selected port's panel | `tintedPanel` per type, each holding a `dataTable` bound to `population` grouped by port type (count, suspicion count, suspicion rate); the variant follows the group value (land/sea/all); note `richText` with total and rate placeholders |
| 5 | Population vs sample by year: grouped bar chart + year table | `groupedBarChart` with two series (population count, studied count) by `year`, joined across two datasets on `year`; `dataTable` by year with outcome columns and a totals row |
| 6 | Section 2 divider | `pageFrame:sectionDivider` |
| 7 | Study results: bar chart + table by port type | `barChart` of outcome-status counts; `dataTable` grouped by port type with outcome columns |
| 8 | Agreement ranking: the port vs all ports, "rank N of M" | `barChart` in **ranking mode**: all-ports scope, grouped by port, measure = agreement rate, sorted desc, the bar equal to `{param:port}` highlighted gold; note uses `{{rank:port}}` / `{{count:ports}}` |
| 9 | Monthly timeline (inline SVG line chart) | new **`lineChart` block**: x = month of image date, one series per port type plus the selected port (gold, on top) plus all ports (dashed); a point with fewer than the min-sample threshold renders as a gap; year labels under the months |
| 10 | Level 1 vs level 2 comparison: two tinted panels | two `tintedPanel`+`dataTable` grouped by level; the left panel uses param scope, the right panel all-ports scope |
| 11 | Section 3 divider | `pageFrame:sectionDivider` with `{{param:port}}` in the title |
| 12 | Employee accuracy tiers: one histogram per tier plus a stats table; mean/median in the note | **derived dataset** `employees` (studies grouped by employee code: studied, matched, accuracy = matched/studied, filtered to studied ≥ 30); new **`tierHistogram` block** (3 equal-width tiers over min-max, 3 bins per tier, one chart per tier); `kvTable` block for tier from/to/count/mean accuracy/mean studied; note uses `{{median:employees.accuracy}}` and `{{mean:…}}` |
| 13 | Staff vs land/sea ports: grouped bars + table | `groupedBarChart` of level 1/2 agreement for this port vs port-type scopes; `dataTable` with a group-start divider column |
| 14+ | Paged employee tables, ranked by accuracy | `dataTable` bound to `employees`, sorted accuracy desc, then studied desc, then code; **auto-paginate**: overflow rows repeat the page onto continuation pages (fixed rows per page, repeated header); cell tones per column (gold/navy/red/green) |
| A | Appendix divider + table of employees under the threshold | `pageFrame:sectionDivider` + paged `dataTable` on `employees` filtered studied < 30; both carry a **show-if-not-empty** rule |
| Z | Closing (`orgBlockHtml`, footer hidden) | `pageFrame:closing` |

**Engine capabilities this test forces** (folded into §3 and §6):
1. **Ratio measures:** `agreementRate = count(status ∈ matched) / count(studied)`, defined once per dataset as a named measure; the status values map from the dictionary (today's `STATUS_*` constants).
2. **Binding scope:** param-scoped (default), all-ports, or one fixed group value. Needed for every "this port vs all ports" panel.
3. **Derived datasets:** group-by + measures + filter producing a new row set (`employees`), usable by any block.
4. **Thresholds as named template constants** (min sample = 30), referenced by filters, gaps and text. One source.
5. **Ranking mode** for bar charts: sort, highlight the param value, `{{rank}}` placeholder.
6. **New blocks:** `lineChart` (gap-aware, multi-series, dashed reference series), `tierHistogram`, `kvTable`, `statStack`.
7. **Statistics placeholders:** mean, median, count, rank.
8. **Auto-pagination** of long tables onto continuation pages; **show-if-not-empty** for pages and blocks.
9. **Cross-dataset join on a shared key** (year) for population vs sample.

**Pass criteria:**
- The owner (or a test following the same click steps, recorded as a jsdom/e2e script) builds the template from an empty design using only editor features.
- With the Jeddah data, the rendered deck matches `scripts/export-port-report-static.mjs` output slide by slide: the same figures to the displayed precision, the same page count, and the same order.
- Switching `port` re-scopes every slide correctly.
- Layout may differ by sub-grid pixel amounts, but no figure may differ.

## 6. Phased roadmap

| Phase | Delivers | Edit-log tier |
|---|---|---|
| P1 | `blockRegistry` + deck3-kit renderers on the canvas; schema v2 types; v1→v2 migration with archive | 3 |
| P2 | Datasets: app sources and Excel upload, dictionary auto-mapping, saved mapping profile, streaming worker | 3 |
| P3 | Parameters and picker; ratio measures, binding scope, derived datasets, thresholds, ranking, statistics placeholders, join | 3 |
| P3b | New blocks (`lineChart`, `tierHistogram`, `kvTable`, `statStack`), auto-pagination, show-if-not-empty; **acceptance test §5.1 passes** (port report rebuilt by hand, figure parity) | 2 |
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
