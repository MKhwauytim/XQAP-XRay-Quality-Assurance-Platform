# Report Engine Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the portable report engine's core pipeline under `src/engine/`, so one call to `issueReport()` turns raw rows plus a domain pack and a template into HTML, a printable PDF page, PowerPoint and Excel, all from one layout model and one set of statistic definitions, with every release gate passing or nothing issued.

**Architecture:** The pipeline follows M11 strictly: validate inputs (M13), read raw datasets, apply declared processing steps, compute every statistic once from the processed rows, build the absolute pre-measured layout model (1920x1080 px), then render HTML and PPTX from that model and the XLSX from the same rows and definitions. A gate runner re-parses the outputs and blocks the issue on any failure. The engine is a self-contained module: nothing in `src/engine/` imports app code, and the host supplies data and a text measurer and receives bytes.

**Tech Stack:** TypeScript (strict, `erasableSyntaxOnly`), Vitest (node environment), pptxgenjs 4.0.1 (with its bundled JSZip) for PPTX, vendored SheetJS `xlsx` 0.20.3 for cell data, JSZip post-processing for OOXML parts SheetJS and pptxgenjs do not write.

**Spec:** `docs/superpowers/specs/2026-11-01-report-engine-design.md` (authority: §0 owner decisions, §0.1 M1 to M14, §4.9 design rules, §5.1 acceptance test). Proven techniques: `poc/pptx/RESULTS.md`, `poc/pptx/RESULTS-T.md`, `poc/port-pptx/RESULTS.md`, `poc/xlsx/RESULTS.md`.

## Milestone map

Each milestone after the first gets its own plan, written when the previous one lands.

| # | Milestone | Delivers | Spec anchor |
|---|---|---|---|
| 1 | Core pipeline and its gates (this plan) | Schemas and validation, statistics layer, layout model with fit ladder, PPTX/XLSX/HTML writers for text, table, bar chart and KPI band, gate runner, `issueReport()`, two-slide walking skeleton in all formats | M1 to M8, M11 to M13 |
| 2 | Block library and analysis features | Remaining blocks (`groupedBarChart`, `lineChart`, `tierHistogram`, `kvTable`, `statStack`, `tintedPanel`, `pageFrame`, grouped-shape diagrams, freeform), ratio measures, binding scope, derived datasets, thresholds, ranking mode, statistics placeholders, join, show-if-not-empty; workbook slicers, charts, shape buttons and cover links | §3 item 12, §5.1 capabilities 1 to 9, M3 workbook design |
| 3 | Host integration and scale | Worker execution with time budget, streaming large raw sets, companion raw workbook split at 1,048,576 rows, browser text measurer and browser lint pass (contrast, overflow), the X-ray domain pack, writing issued files through `safeWriteJson` and `workspacePaths.ts` in the app layer | M12 size note, M13 isolated work, §4.2 |
| 4 | Catalog and slide picks | Numbered HTML lookbook of 15 to 20 designs seeded from deck3, stable numbers, picks import, retired-number refusal, design-lint gate for catalog entry | §0 decision 3, M14, §4.9 catalog rule |
| 5 | Editor and acceptance | Report Designer on the new layout model (snap, guides, inspector), deck3 parity via `kitSnapshot.test.ts`, the §5.1 port report rebuilt by hand with figure parity | §0 decisions 1 and 6, §5.1 pass criteria |

## Global Constraints

- Import boundary: no file under `src/engine/` imports from outside `src/engine/` except the packages `pptxgenjs`, `jszip` and `xlsx`. Enforced by a test and an ESLint `no-restricted-imports` override (spec §0.1: "no import from X-ray code, no dependency on this app's workspace, auth or UI").
- The engine never reads or writes host storage. It returns bytes; the host writes them. When the app layer persists issued files (Milestone 3), it goes through `safeWriteJson` / `workspacePaths.ts` per CLAUDE.md.
- M1: every issue produces HTML, PDF (the HTML page printed; no separate PDF writer), PowerPoint and Excel together, or none.
- M2 / §0 decision 8: per text box and table cell, equal line count and top-left within 2px between HTML and PowerPoint; any mismatch blocks the issue.
- M5: every paragraph `rtl="1"` and `algn="r"`; every table `a:tblPr rtl="1"` with columns in logical order; every Latin or digit token (regex `[A-Za-z0-9][A-Za-z0-9.,%-/:+]*`, ` / ` joining clusters) is its own run with `lang="en-US"` and `<a:rtl val="0"/>`; no U+200E, no U+2066/U+2069. HTML uses `<span dir="ltr">` for the same tokens.
- §0 decision 4: Latin digits (123) everywhere; zero Arabic-Indic digits in any output.
- Units: 6350 EMU per px, font size pt = px x 0.5, slide 1920x1080 px.
- M7 fit ladder: one line at base size, shrink to max(20px, 0.85 x base), widen from sibling columns down to their measured minimum, two balanced lines, else error «العنوان أطول من المساحة»; measured widths multiplied by `FIT_SAFETY = 1.04`. No ellipsis, no abbreviation. Long tables continue on slides titled with the suffix « (يتبع)» and a repeated header.
- §4.9 F4: minimum font size 20px. T3: no U+2013 or U+2014 anywhere in output. T6: no emojis or decorative symbols (check marks U+2713 and U+2705, warning sign U+26A0, star U+2605, arrows U+2190 to U+21FF) in output. Both are Floor (blocking).
- M6: every number on a slide is a reference to a statistic computed by the statistics layer; a typed numeric literal in a template text block is a validation error.
- M12: the workbook has a raw section (uploaded files, sheets, columns, names and order untouched) then a processed section (one sheet per step, then processed sets, then statistics); raw rows minus each step's removed rows equals processed rows, checked on every issue.
- Workbook order (spec M3 round 2): الفهرس, `|`, raw sheets, `||`, processing steps, `|||`, المجتمع and العينة, `||||`, الإحصائيات, `|||||`, المصدر. Separator sheets: black tab, black cells, gridlines and headings hidden, empty.
- M13 determinism: same inputs give byte-identical files. Fix every zip timestamp, every generated id and every `writtenAt`/`created` field from an `issuedAt` parameter, never `Date.now()`.
- M13 bounds live in one module (`src/engine/limits.ts`); hitting one returns a clear Arabic message, never a crash.
- Dependencies (owner decision): pptxgenjs is allowed; it is a devDependency on this branch and **must move to `dependencies` in `package.json`**; jszip comes via pptxgenjs (import it explicitly, add it to `dependencies` at the version pptxgenjs resolves); `xlsx` stays the vendored `file:vendor/xlsx-0.20.3.tgz`. **`npm run check:bundle-size` is required** once the engine is reachable from the app bundle (pptxgenjs measured 450.1 KB raw / 154.0 KB gzip as a bundle).
- Edit log: tier 3 (new architecture and data format). Generate with `npm run editlog -- --tier=3 --append --sync-package "Add (engine): ..."`. Tier-3 gates before claiming done: `lint`, `typecheck`, `test:run`, `check:complexity`, `check:hex-literals`, `check:release`, `check:vendor`, `build`, `check:bundle-size`. **`npm run build` before pushing or opening a PR.**
- UI strings in the app go through `labelsStore.ts` label keys. The engine cannot import it, so engine messages live in `src/engine/messages.ts` as a keyed Arabic catalog that a host may override through `IssueParams.messages`; Milestone 3 wires the app's label keys into that override.
- Colours: the engine's theme tokens are a data object passed in (`ThemeTokens`), copied from deck3 values by the host; no raw hex literal in engine source outside the one tokens fixture (`check:hex-literals` must stay green; allowlist the fixture if the guard requires it).

## Review Focus

- Arabic text whose browser line break differs from PowerPoint: the PPTX must carry the measured breaks as `a:br` soft breaks so line counts match, and a wrapped box anchors on its right edge (port-pptx fix round item 4).
- Number clusters inside Arabic sentences (`20 / 37`, `85.5%` after Arabic letters, dates `05-11-2026`): output keeps them in reading order in both renderers; the run splitter is tested on exactly these.
- An empty dataset or a dataset whose filter leaves zero rows: the issue still completes with honest zeros or refuses with a named message; never a division by zero shown as `NaN` or `Infinity`.
- A pptxgenjs or SheetJS change that silently drops a part (the table-slicer trap): the OOXML self-check counts tables, pivots and charts in the zip and compares them with the layout model, rather than trusting that the file opened.
- The same inputs issued twice must give byte-identical zips; any hidden clock or random id breaks snapshot tests and the M13 promise.

---

## File structure

```
src/engine/
  index.ts                 public surface: issueReport, types, createFixedAdvanceMeasurer
  limits.ts                every M13 bound, one place
  messages.ts              keyed Arabic message catalog, formatIssue()
  errors.ts                EngineIssue, IssueFailure, fail()
  boundary.test.ts         import-boundary test
  schema/
    types.ts               DomainPack, DatasetInput, Template, IssueParams, ThemeTokens
    validate.ts            validateDomainPack/validateDatasets/validateTemplate/validateParams
  stats/
    processing.ts          applySteps(): declared processing steps with per-step removed counts
    measures.ts            computeStatistic(), computeAll(): StatValue with provenance
  layout/
    types.ts               LayoutDoc, LayoutSlide, LayoutBox union
    measure.ts             TextMeasurer interface, createFixedAdvanceMeasurer()
    bidiRuns.ts            splitRuns()
    fitLadder.ts           fitText(), fitTableHeaders()
    layoutReport.ts        layoutReport(): template + stats to LayoutDoc, table pagination
  html/renderHtml.ts       renderHtml(): LayoutDoc to self-contained HTML (print CSS for PDF)
  pptx/
    units.ts               emu(), ptFromPx(), inFromPx()
    writePptx.ts           writePptx(): LayoutDoc to raw pptxgenjs bytes
    postprocess.ts         postprocessPptx(): charset strip, rtl, one pPr, master defaults
  xlsx/
    writeXlsx.ts           writeXlsx(): raw section, steps, processed sets, statistics, source
    ooxmlParts.ts          addTables(), addPivots(), addSeparators(), styles part
  gates/
    readBack.ts            readPptxBoxes(), readHtmlBoxes(), readXlsxParts()
    figureParity.ts        checkFigureParity()
    layoutParity.ts        checkLayoutParity()
    reconcile.ts           checkReconciliation()
    ooxmlSelfCheck.ts      checkOoxml()
    runGates.ts            runGates()
  lint/designLint.ts       lintLayout(), lintText()
  issue/issueReport.ts     issueReport()
  __fixtures__/twoSlide.ts fixture pack, datasets, template, tokens
```

Tests sit beside each file as `*.test.ts` (Vitest `node` environment; `vitest.config.ts` already includes `src/**/*.test.ts`).

---

### Task 1: Engine skeleton, import boundary, limits and messages

**Files:**
- Create: `src/engine/index.ts`, `src/engine/limits.ts`, `src/engine/messages.ts`, `src/engine/errors.ts`
- Modify: `eslint.config.js` (add an override for `src/engine/**` next to the existing `@typescript-eslint/no-restricted-imports` block at about line 109)
- Test: `src/engine/boundary.test.ts`, `src/engine/errors.test.ts`

**Interfaces:**
- Produces:
  - `LIMITS: { maxRowsPerDataset: 2_000_000; maxSlides: 200; maxBlocksPerSlide: 40; maxChartCategories: 12; maxTableCellsPerPage: 240; issueTimeBudgetMs: 120_000 }` (`as const`; values are the module's stated bounds, revisable in one place)
  - `type MessageKey = "schema.invalid" | "limit.rows" | "limit.slides" | "limit.blocks" | "fit.tooLong" | "gate.figureParity" | "gate.layoutParity" | "gate.lint" | "gate.reconcile" | "gate.ooxml" | "measure.unknown" | "literal.number" | ...`
  - `MESSAGES_AR: Record<MessageKey, string>` (e.g. `"fit.tooLong": "العنوان أطول من المساحة"`)
  - `interface EngineIssue { rule: MessageKey; slide?: number; block?: string; path?: string; detail?: string }`
  - `class IssueFailure extends Error { issues: EngineIssue[] }`
  - `formatIssue(issue: EngineIssue, messages?: Partial<Record<MessageKey,string>>): string` returns one Arabic line naming slide, block and rule.

- [ ] **Step 1: Write the failing tests**

```ts
// boundary.test.ts
it("no engine file imports outside src/engine or the allowed packages", () => {
  const offenders = scanImports("src/engine").filter(
    (i) => !i.spec.startsWith(".") && !["pptxgenjs", "jszip", "xlsx"].includes(i.spec));
  const escapes = scanImports("src/engine").filter((i) => resolvesOutside(i, "src/engine"));
  expect(offenders).toEqual([]);
  expect(escapes).toEqual([]);
});
// errors.test.ts
it("formatIssue names slide, block and rule in Arabic", () => {
  const s = formatIssue({ rule: "fit.tooLong", slide: 2, block: "t1" });
  expect(s).toContain("العنوان أطول من المساحة");
  expect(s).toMatch(/2/); expect(s).toContain("t1");
  expect(s).not.toMatch(/[\u2013\u2014]/);
});
it("host override replaces a message", () => {
  expect(formatIssue({ rule: "fit.tooLong" }, { "fit.tooLong": "X" })).toContain("X");
});
```

`scanImports` reads every `.ts` under the folder with `node:fs` and a regex over `import ... from "..."` and `import("...")`; it lives in the test file.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/engine/boundary.test.ts src/engine/errors.test.ts`
Expected: FAIL, `formatIssue` not defined.

- [ ] **Step 3: Implement** `limits.ts`, `messages.ts`, `errors.ts`, an `index.ts` that re-exports them, and the ESLint override (`files: ["src/engine/**"]`, `patterns: ["../**/src/*", "@/*", "**/data/**", "**/components/**", "**/auth/**", "**/utils/**", "**/branding/**"]` restricted with message "engine must not import app code").

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/engine && npm run lint && npm run typecheck`
Expected: PASS, 0 lint errors.

- [ ] **Step 5: Commit**

```bash
git add src/engine eslint.config.js
git commit -m "Add (engine): skeleton, import boundary, limits and messages"
```

---

### Task 2: Domain-pack, dataset, template and parameter schemas with validation

**Files:**
- Create: `src/engine/schema/types.ts`, `src/engine/schema/validate.ts`, `src/engine/__fixtures__/twoSlide.ts`
- Test: `src/engine/schema/validate.test.ts`

**Interfaces:**
- Consumes: `EngineIssue`, `LIMITS` (Task 1).
- Produces (in `types.ts`):
  - `interface FieldDef { id: string; label: string; type: "string" | "number" | "date" | "boolean" }`
  - `interface MeasureDef { id: string; label: string; datasetId: string; agg: "count" | "distinct" | "sum" | "avg" | "min" | "max" | "ratio"; field?: string; filter?: FilterDef[]; numerator?: string; denominator?: string; format: { kind: "int" | "pct" | "dec"; digits: number } }`
  - `interface DimensionDef { id: string; field: string; datasetId: string }`
  - `interface DomainPack { id: string; version: string; fields: FieldDef[]; measures: MeasureDef[]; dimensions: DimensionDef[] }`
  - `interface RawSheet { fileName: string; sheetName: string; columns: string[]; rows: unknown[][] }`
  - `interface ProcessingStep { id: string; label: string; kind: "map" | "filter" | "dedupe"; mapping?: Record<string,string>; filter?: FilterDef; key?: string[] }`
  - `interface DatasetInput { id: string; label: string; raw: RawSheet[]; steps: ProcessingStep[] }`
  - `type FilterDef = { field: string; op: "eq" | "neq" | "in" | "notNull"; value?: string | number | (string|number)[] }`
  - `type BlockDef = TextBlock | TableBlock | BarChartBlock | KpiBandBlock`, each `{ id; type; x; y; w; h }` in px plus: `TextBlock { text: string; size: number; weight: 400|700; tone: ToneKey }` (text may contain `{{measure:<id>}}`), `TableBlock { datasetId; groupBy: string; measures: string[]; headers: string[]; rowH: number }`, `BarChartBlock { datasetId; groupBy; measure: string }`, `KpiBandBlock { cells: { label: string; measure: string }[] }`
  - `interface Template { id: string; packId: string; slides: { id: string; title: string; blocks: BlockDef[] }[] }`
  - `interface ThemeTokens { colors: Record<ToneKey,string>; font: string; fontData?: Uint8Array }`, `type ToneKey = "navy" | "text" | "muted" | "hair" | "blue" | "gold" | "bg" | "panel"`
  - `interface IssueParams { issuedAt: string; title: string; values?: Record<string,string>; messages?: Partial<Record<MessageKey,string>> }`
- Produces (in `validate.ts`): `validateInputs(template: Template, pack: DomainPack, datasets: DatasetInput[], params: IssueParams): EngineIssue[]` (empty array means valid). Each issue carries a `path` such as `template.slides[1].blocks[0].measures[2]`.
- Produces (fixture): `twoSlideFixture(): { pack; datasets; template; params; theme }`: one raw sheet `studies.xlsx/نتائج الدراسة` of 12 rows with columns `المنفذ, نوع المنفذ, الحالة`, one map step and one filter step that removes 2 rows, two slides: slide 1 title + KPI band (studied count, match rate), slide 2 table by port type + bar chart of match rate by port.

- [ ] **Step 1: Write the failing tests**

```ts
it("accepts the two-slide fixture", () => {
  const f = twoSlideFixture();
  expect(validateInputs(f.template, f.pack, f.datasets, f.params)).toEqual([]);
});
it.each([
  ["unknown measure", (f) => (f.template.slides[0].blocks[1].cells[0].measure = "nope"), "measure.unknown", "template.slides[0].blocks[1].cells[0].measure"],
  ["typed number in text", (f) => (f.template.slides[0].blocks[0].text = "نسبة 92%"), "literal.number", "template.slides[0].blocks[0].text"],
  ["missing raw column", (f) => f.datasets[0].raw[0].columns.pop(), "schema.invalid", "datasets[0].raw[0]"],
  ["duplicate field id", (f) => f.pack.fields.push({ ...f.pack.fields[0] }), "schema.invalid", "pack.fields[3].id"],
  ["font under 20px", (f) => (f.template.slides[0].blocks[0].size = 18), "schema.invalid", "template.slides[0].blocks[0].size"],
  ["too many slides", (f) => (f.template.slides = Array(201).fill(f.template.slides[0])), "limit.slides", "template.slides"],
  ["rows over limit", (f) => (f.datasets[0].raw[0].rows.length = LIMITS.maxRowsPerDataset + 1), "limit.rows", "datasets[0]"],
  ["issuedAt not ISO", (f) => (f.params.issuedAt = "yesterday"), "schema.invalid", "params.issuedAt"],
])("rejects %s with its location", (_n, mutate, rule, path) => {
  const f = twoSlideFixture(); mutate(f);
  expect(validateInputs(f.template, f.pack, f.datasets, f.params)).toContainEqual(expect.objectContaining({ rule, path }));
});
it("accepts an empty dataset (0 rows) as valid input", () => { /* rows = [] gives [] issues */ });
```

The "rows over limit" case uses a sparse length assignment so the test stays fast.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/engine/schema/validate.test.ts`
Expected: FAIL, `validateInputs` not defined.

- [ ] **Step 3: Implement** the types, fixture and `validateInputs`. Hand-written structural checks (no schema library: none is a dependency and the boundary forbids app helpers). A typed number is detected by `/\d/` in a text block's text after removing `{{...}}` placeholders. Every issue gets a dotted path.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/engine/schema`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/schema src/engine/__fixtures__
git commit -m "Add (engine): domain pack, dataset and template schemas with validation"
```

---

### Task 3: Statistics layer: processing steps and measures from raw rows

**Files:**
- Create: `src/engine/stats/processing.ts`, `src/engine/stats/measures.ts`
- Test: `src/engine/stats/processing.test.ts`, `src/engine/stats/measures.test.ts`

**Interfaces:**
- Consumes: `DatasetInput`, `ProcessingStep`, `MeasureDef`, `FilterDef`, `DomainPack` (Task 2).
- Produces:
  - `type Row = Record<string, string | number | boolean | null>`
  - `interface ProcessedDataset { id: string; rawCount: number; steps: { stepId: string; inCount: number; removed: number; outCount: number; rowsAfter: Row[] }[]; rows: Row[] }`
  - `applySteps(ds: DatasetInput): ProcessedDataset` (raw sheets concatenated in upload order; `map` renames raw column names to field ids; `filter` keeps matching rows; `dedupe` keeps the first by key)
  - `interface StatValue { key: string; measureId: string; group?: { dimension: string; value: string }; value: number | null; display: string; provenance: { datasetId: string; field?: string; agg: MeasureDef["agg"]; filters: FilterDef[] } }`
  - `computeStatistic(m: MeasureDef, data: ProcessedDataset, groupBy?: string): StatValue[]`
  - `computeAll(template: Template, pack: DomainPack, data: Map<string, ProcessedDataset>): Map<string, StatValue>` keyed by `measureId` or `measureId@field=value`; only statistics the template references are computed
  - `formatValue(v: number | null, f: MeasureDef["format"]): string` with Latin digits, thousands separator `,`, `pct` as `82.95%`; `null` as `-`

- [ ] **Step 1: Write the failing tests**

```ts
it("each step reconciles: inCount - removed = outCount", () => {
  const p = applySteps(twoSlideFixture().datasets[0]);
  expect(p.rawCount).toBe(12);
  p.steps.forEach((s) => expect(s.inCount - s.removed).toBe(s.outCount));
  expect(p.rows.length).toBe(10);
});
it("ratio measure = matched / studied over processed rows", () => {
  const v = computeStatistic(matchRate, processed)[0];
  expect(v.value).toBeCloseTo(0.7, 10); expect(v.display).toBe("70.00%");
  expect(v.provenance).toEqual({ datasetId: "studies", field: "status", agg: "ratio", filters: [] });
});
it("groupBy yields one value per distinct group, sorted by value code point", () => { /* 3 port types */ });
it("ratio over zero rows is null, displayed '-'", () => { expect(computeStatistic(matchRate, empty)[0].display).toBe("-"); });
it("never emits Arabic-Indic digits", () => { expect(formatValue(48250, { kind: "int", digits: 0 })).toBe("48,250"); });
it("null cells are skipped by sum/avg, counted by count only when the field is absent", () => {});
it("is deterministic: same input gives deep-equal output", () => {});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/engine/stats`
Expected: FAIL, functions not defined.

- [ ] **Step 3: Implement** `applySteps`, `computeStatistic`, `computeAll`, `formatValue`. Format with `Intl.NumberFormat("en-US", ...)` so digits are Latin regardless of host locale. Group order is code-point sort of the group value for determinism.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/engine/stats`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/stats
git commit -m "Add (engine): statistics layer over raw rows with processing steps"
```

---

### Task 4: Text measurer, bidi runs and the fit ladder

**Files:**
- Create: `src/engine/layout/measure.ts`, `src/engine/layout/bidiRuns.ts`, `src/engine/layout/fitLadder.ts`
- Test: `src/engine/layout/bidiRuns.test.ts`, `src/engine/layout/fitLadder.test.ts`

**Interfaces:**
- Produces:
  - `interface TextMeasurer { width(text: string, sizePx: number, weight: 400 | 700): number }` (host injects a canvas measurer in the browser; Milestone 3)
  - `createFixedAdvanceMeasurer(advance?: { arabic: number; latin: number; space: number }): TextMeasurer` (width = sum of per-class advance x size; defaults `0.5 / 0.55 / 0.25`, bold x 1.06); deterministic for node tests
  - `FIT_SAFETY = 1.04`
  - `interface Run { text: string; ltr: boolean }`; `splitRuns(s: string): Run[]` using regex `[A-Za-z0-9][A-Za-z0-9.,%\-/:+]*` with ` / ` joining clusters
  - `interface FitResult { step: 1 | 2 | 3 | 4 | 5; sizePx: number; widthPx: number; lines: string[] }` (`step 5` means error, `lines` holds the full text)
  - `fitText(text: string, box: { w: number; basePx: number; weight: 400 | 700; maxLines: 1 | 2 }, m: TextMeasurer, widenTo?: number): FitResult`
  - `fitTableHeaders(headers: string[], colW: number[], minW: number[], basePx: number, m: TextMeasurer): { colW: number[]; fits: FitResult[] }`

- [ ] **Step 1: Write the failing tests**

```ts
it.each([
  ["نسبة 85.5% في جدة", [false, true, false]],
  ["الصفحة 20 / 37", [false, true]],
  ["التاريخ 05-11-2026", [false, true]],
  ["الموظف A6838", [false, true]],
])("splitRuns(%s) isolates Latin tokens", (s, ltr) => {
  expect(splitRuns(s).map((r) => r.ltr)).toEqual(ltr);
  expect(splitRuns(s).map((r) => r.text).join("")).toBe(s);
});
const m = createFixedAdvanceMeasurer();
it("step 1 when it fits at base size", () => { expect(fitText("قصير", { w: 400, basePx: 25, weight: 700, maxLines: 2 }, m).step).toBe(1); });
it("step 2 never below max(20, 0.85 x base)", () => { const r = fitText(t, box, m); expect(r.step).toBe(2); expect(r.sizePx).toBeGreaterThanOrEqual(21.25); });
it("step 3 widens up to widenTo", () => {});
it("step 4 splits into two balanced lines at a space", () => { const r = fitText(long, box, m); expect(r.lines).toHaveLength(2); });
it("step 5 keeps the full text and reports the error", () => { const r = fitText(impossible, box, m); expect(r.step).toBe(5); expect(r.lines.join(" ")).toBe(impossible); });
it("applies FIT_SAFETY: text measuring exactly w / 1.03 does not fit at step 1", () => {});
it("fitTableHeaders never narrows a column below its minW and keeps sum(colW) constant", () => {});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/engine/layout/bidiRuns.test.ts src/engine/layout/fitLadder.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.** Step 4 picks the space that minimises the longer line's measured width (PoC `tests.mjs` `ladder()`); step 3 takes width from sibling columns down to their `minW`, then step 4 widens only as needed.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/engine/layout`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/layout
git commit -m "Add (engine): text measurer interface, bidi runs and fit ladder"
```

---

### Task 5: Layout model and layoutReport

**Files:**
- Create: `src/engine/layout/types.ts`, `src/engine/layout/layoutReport.ts`
- Test: `src/engine/layout/layoutReport.test.ts`

**Interfaces:**
- Consumes: `Template`, `ThemeTokens` (Task 2); `StatValue`, `computeAll` output (Task 3); `TextMeasurer`, `fitText`, `fitTableHeaders`, `splitRuns` (Task 4).
- Produces:
  - `interface TextBox { kind: "text"; id: string; blockId: string; x: number; y: number; w: number; h: number; sizePx: number; weight: 400|700; tone: ToneKey; lines: Run[][]; statKeys: string[] }` (lines are the recorded breaks; every renderer emits exactly these)
  - `interface TableBox { kind: "table"; id; blockId; x; y; colW: number[]; rowH: number; header: TextCell[]; rows: TextCell[][]; continued: boolean }`, `TextCell { lines: Run[][]; sizePx; weight; statKey?: string }`
  - `interface BarChartBox { kind: "bar"; id; blockId; x; y; w; h; categories: string[]; values: (number|null)[]; statKeys: string[]; format: MeasureDef["format"] }`
  - `interface RectBox { kind: "rect"; id; x; y; w; h; fill: ToneKey }`, `interface RuleBox { kind: "rule"; id; x; y; w; tone: ToneKey }`
  - `type LayoutBox = TextBox | TableBox | BarChartBox | RectBox | RuleBox`
  - `interface LayoutSlide { index: number; templateSlideId: string; title: string; boxes: LayoutBox[] }`
  - `interface LayoutDoc { width: 1920; height: 1080; slides: LayoutSlide[]; figures: { slide: number; boxId: string; statKey: string; display: string }[]; fitErrors: EngineIssue[] }`
  - `layoutReport(t: Template, stats: Map<string, StatValue>, theme: ThemeTokens, m: TextMeasurer): LayoutDoc`
- KPI band expands to one `TextBox` per label and value plus `RuleBox` separators; values come only from `stats`.

- [ ] **Step 1: Write the failing tests**

```ts
it("lays out the fixture into 2 slides with every figure registered", () => {
  const doc = layoutFixture();
  expect(doc.slides).toHaveLength(2);
  expect(doc.figures.every((f) => stats.has(f.statKey))).toBe(true);
  expect(doc.fitErrors).toEqual([]);
});
it("placeholder {{measure:matchRate}} resolves to the StatValue display", () => {});
it("a 40-row table with rowH 50 in 1000-180-60 px paginates 15/15/10, header repeated, continuation title ends with (يتبع)", () => {
  const doc = layoutReport(fortyRowTemplate, stats, theme, m);
  expect(doc.slides.map((s) => (s.boxes.find((b) => b.kind === "table") as TableBox).rows.length)).toEqual([15, 15, 10]);
  expect(doc.slides[1].title.endsWith("(يتبع)")).toBe(true);
});
it("a bar chart over LIMITS.maxChartCategories keeps top N-1 plus «أخرى»", () => {});
it("a text that fails the ladder lands in fitErrors with slide, block and rule fit.tooLong", () => {});
it("is deterministic: two calls give deep-equal docs", () => {});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/engine/layout/layoutReport.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** `layoutReport`. Rows per page = `floor((tableAreaH - headerH) / rowH)`; box ids are `s{slide}-{blockId}-{n}` (deterministic, no random ids).

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/engine/layout`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/layout
git commit -m "Add (engine): absolute layout model with table continuation"
```

---

### Task 6: HTML renderer from the layout model

**Files:**
- Create: `src/engine/html/renderHtml.ts`
- Test: `src/engine/html/renderHtml.test.ts`

**Interfaces:**
- Consumes: `LayoutDoc`, `ThemeTokens`.
- Produces: `renderHtml(doc: LayoutDoc, theme: ThemeTokens, opts: { title: string }): string`. One `<section class="slide">` per slide, 1920x1080, every box `position:absolute; left/top/width/height` in px, `dir="rtl"`, `lang="ar-SA"`, recorded lines joined with `<br>`, LTR runs as `<span dir="ltr">`, tables as `<table>` with `dir="rtl"` and fixed column widths, bar charts as inline SVG on the box's axis, the font as an inline `@font-face` when `theme.fontData` is set. Each box carries `data-box="<id>"` and each figure `data-stat="<statKey>"`. `@media print { @page { size: 1920px 1080px; margin: 0 } .slide { break-after: page } }` makes the PDF path the HTML printed.

- [ ] **Step 1: Write the failing tests**

```ts
const html = renderHtml(layoutFixture(), theme, { title: "تقرير" });
it("one section per slide at 1920x1080", () => { expect(html.match(/class="slide"/g)).toHaveLength(2); });
it("a box with 2 recorded lines has exactly one <br>", () => {});
it("every Latin token sits in <span dir=\"ltr\">", () => { expect(html).toContain('<span dir="ltr">70.00%</span>'); });
it("no external URL, no script", () => { expect(html).not.toMatch(/https?:\/\//); expect(html).not.toMatch(/<script/); });
it("print CSS declares one page per slide", () => { expect(html).toContain("break-after: page"); });
it("escapes < & in user text", () => {});
it("snapshot", () => { expect(html).toMatchSnapshot(); });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/engine/html`
Expected: FAIL.

- [ ] **Step 3: Implement** `renderHtml` (string builder; no DOM).

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/engine/html`
Expected: PASS, snapshot written.

- [ ] **Step 5: Commit**

```bash
git add src/engine/html
git commit -m "Add (engine): HTML renderer from the layout model"
```

---

### Task 7: PPTX writer and OOXML post-processing

**Files:**
- Create: `src/engine/pptx/units.ts`, `src/engine/pptx/writePptx.ts`, `src/engine/pptx/postprocess.ts`
- Modify: `package.json` (move `pptxgenjs` from `devDependencies` to `dependencies`; add `jszip` to `dependencies` at the version pptxgenjs resolves in `package-lock.json`)
- Test: `src/engine/pptx/units.test.ts`, `src/engine/pptx/postprocess.test.ts`, `src/engine/pptx/writePptx.test.ts`

**Interfaces:**
- Consumes: `LayoutDoc`, `ThemeTokens`, `Run`.
- Produces:
  - `EMU_PER_PX = 6350`; `emu(px: number): number` (rounded); `ptFromPx(px: number): number` (= px x 0.5); `inFromPx(px: number): number` (= px / 144)
  - `writePptx(doc: LayoutDoc, theme: ThemeTokens, opts: { title: string; issuedAt: string }): Promise<Uint8Array>` returns the post-processed file
  - `postprocessPptx(zipBytes: Uint8Array, issuedAt: string): Promise<Uint8Array>`; exported for tests
- Techniques fixed by the PoC:
  - Text: one text box per `TextBox`, zero insets, `wrap` off for 1-line boxes; multi-line boxes get `a:br` at each recorded break and width `w x FIT_SAFETY` capped at block width, anchored on the right edge; `lineSpacing` emits `a:lnSpc/a:spcPts`. Runs from `splitRuns`: LTR runs `lang="en-US"` with `<a:rtl val="0"/>`, Arabic runs `lang="ar-SA"`.
  - Table: real `a:tbl`, `a:gridCol` = `emu(colW)` in logical order, every `a:tr h = emu(rowH)`, `a:tblPr rtl="1"`. Cell margin passed in points (pptxgenjs treats values < 1 as inches; pass 0 explicitly as points by using `margin: [0,0,0,0]` and verify in XML).
  - Bar chart: native clustered column chart with embedded workbook (`c:externalData`), `catAxisOrientation: "maxMin"` so the first category is on the right, data label format from the measure (`0.00"%"` or `#,##0`), cached values = the StatValue display precision.
  - KPI band: text boxes plus rule lines.
  - Post-process: strip `charset` and `pitchFamily` from every `a:latin/a:ea/a:cs/a:sym`; force `rtl="1" algn="r"` on every slide and chart paragraph; keep only the first `a:pPr` per paragraph (match the one directly after `<a:p>` allowing whitespace, the chart-XML trap); rewrite master and layout `lvlNpPr` defaults to `rtl="1" algn="r"`; set every zip entry date and `docProps/core.xml` `dcterms:created/modified` to `issuedAt`.

- [ ] **Step 1: Write the failing tests**

```ts
it("units", () => { expect(emu(64)).toBe(406400); expect(ptFromPx(44)).toBe(22); expect(inFromPx(144)).toBe(1); });
const xml = await slideXmls(await writePptx(layoutFixture(), theme, { title: "t", issuedAt: "2026-11-05T00:00:00Z" }));
it("no charset or pitchFamily left", () => { expect(xml.all).not.toMatch(/charset=|pitchFamily=/); });
it("every paragraph rtl=1 algn=r", () => { expect(count(xml.all, /<a:pPr\b/)).toBe(count(xml.all, /<a:pPr[^>]*rtl="1"[^>]*algn="r"/)); });
it("one a:pPr per paragraph", () => {});
it("number runs are en-US with rtl val=0", () => { expect(xml.all).toMatch(/<a:rPr[^>]*lang="en-US"[^>]*>(?:(?!<\/a:rPr>).)*<a:rtl val="0"\/>/s); });
it("table geometry is exact in EMU and tblPr rtl=1", () => {});
it("chart has embedded workbook and maxMin orientation", () => {});
it("master and layout carry no rtl=\"0\" or algn=\"l\"", () => {});
it("a 2-line text box has one a:br", () => {});
it("zero p:pic when the theme has no logo", () => {});
it("byte-identical across two calls", async () => { expect(sha(await build())).toBe(sha(await build())); });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/engine/pptx`
Expected: FAIL.

- [ ] **Step 3: Implement** the units, writer and post-processor. Post-processing parses with string-level XML transforms scoped to known elements (a small tokenizer, not free regex over the whole part), as the PoC recommendation says ("a tested module, not regex in a script").

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/engine/pptx && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/pptx package.json package-lock.json
git commit -m "Add (engine): PPTX writer with RTL and charset post-processing"
```

---

### Task 8: XLSX writer: raw section, processed section, tables and pivots

**Files:**
- Create: `src/engine/xlsx/writeXlsx.ts`, `src/engine/xlsx/ooxmlParts.ts`
- Test: `src/engine/xlsx/writeXlsx.test.ts`, `src/engine/xlsx/ooxmlParts.test.ts`

**Interfaces:**
- Consumes: `DatasetInput`, `ProcessedDataset`, `StatValue`, `DomainPack`, `LayoutDoc.figures`, `ThemeTokens`.
- Produces:
  - `interface WorkbookPlan { sheets: { name: string; kind: "index" | "separator" | "raw" | "step" | "processed" | "stats" | "source"; table?: string; pivots?: PivotSpec[] }[] }`
  - `interface PivotSpec { name: string; sourceTable: string; rowField: string; dataField: string; agg: "count" | "sum" | "average"; feedsSlide: number; statKeys: string[] }`
  - `planWorkbook(datasets: DatasetInput[], processed: Map<string, ProcessedDataset>, stats: Map<string, StatValue>, doc: LayoutDoc): WorkbookPlan`
  - `writeXlsx(plan: WorkbookPlan, datasets, processed, stats, doc, theme, opts: { title: string; issuedAt: string }): Promise<Uint8Array>`
  - `addTables(zip, tables)`, `addPivots(zip, pivots)`, `addSeparators(zip, names)`, `addStyles(zip, theme)` in `ooxmlParts.ts`
- Sheet rules:
  - Order and separators exactly as in Global Constraints. Raw sheets named from the upload (`{fileName} {sheetName}`, truncated to 31 chars and made unique with a numeric suffix), every column in upload order with the original header text, values untouched.
  - One step sheet per `ProcessingStep` titled `خطوة {n} {label}` (PoC `STEP()`), showing in, removed and out counts and the rows after the step as a table.
  - Processed sets as Excel tables (`tbl{DatasetId}`, header row frozen, autofilter) with a pivot of the main measures to their left on screen (column A is a margin in RTL).
  - الإحصائيات: one pivot per statistic group, each titled with the slide it feeds.
  - المصدر: `tblSource`, one row per `doc.figures` entry: slide, figure display, sheet, field, filter, measure, pivot.
  - Pivot cache with `saveData="0" refreshOnLoad="1"`, no records part, shared items only for axis fields. Custom table style `Deck3` in theme tones; Somar as the Normal style font; sheet views `rightToLeft="1"`, gridlines off on designed sheets.
  - Workbook core properties dated `issuedAt`; zip entry dates fixed.

- [ ] **Step 1: Write the failing tests**

```ts
const plan = planWorkbook(f.datasets, processed, stats, doc);
it("sheet order follows M3 round 2", () => {
  expect(plan.sheets.map((s) => s.kind)).toEqual(["index","separator","raw","separator","step","step","separator","processed","separator","stats","separator","source"]);
  expect(plan.sheets.filter((s) => s.kind === "separator").map((s) => s.name)).toEqual(["|","||","|||","||||","|||||"]);
});
it("raw sheet keeps upload columns and rows exactly", async () => { /* read back with XLSX.read: header row deep-equals raw.columns, 12 data rows */ });
it("step sheets show in - removed = out", () => {});
it("processed table and pivots exist as parts", async () => {
  const z = await unzip(bytes);
  expect(z.list(/^xl\/tables\/table\d+\.xml$/)).toHaveLength(plan.sheets.filter((s) => s.table).length);
  expect(z.list(/^xl\/pivotTables\/pivotTable\d+\.xml$/)).toHaveLength(plan.sheets.flatMap((s) => s.pivots ?? []).length);
  expect(z.text("xl/pivotCache/pivotCacheDefinition1.xml")).toMatch(/saveData="0"[^>]*refreshOnLoad="1"|refreshOnLoad="1"[^>]*saveData="0"/);
});
it("[Content_Types].xml declares every added part", () => {});
it("المصدر has one row per layout figure", () => {});
it("a sheet name longer than 31 chars or duplicated is made unique", () => {});
it("byte-identical across two calls", () => {});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/engine/xlsx`
Expected: FAIL.

- [ ] **Step 3: Implement** `planWorkbook`, `writeXlsx` (SheetJS `XLSX.utils.aoa_to_sheet` and `XLSX.write({ type: "array", bookType: "xlsx" })` for cells), then JSZip post-processing in `ooxmlParts.ts` for table, pivot cache, pivot table, styles and relationships, following `poc/xlsx/build.mjs` (`tableXml`, cache without records). Slicers, charts, logo and shape buttons are Milestone 2.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/engine/xlsx && npm run check:vendor`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/xlsx
git commit -m "Add (engine): XLSX writer with raw and processed sections, tables and pivots"
```

---

### Task 9: Gate runner: figure parity, layout parity, lint, reconciliation, OOXML self-check

**Files:**
- Create: `src/engine/gates/readBack.ts`, `src/engine/gates/figureParity.ts`, `src/engine/gates/layoutParity.ts`, `src/engine/gates/reconcile.ts`, `src/engine/gates/ooxmlSelfCheck.ts`, `src/engine/gates/runGates.ts`, `src/engine/lint/designLint.ts`
- Test: one `*.test.ts` beside each

**Interfaces:**
- Consumes: outputs of Tasks 3, 5, 6, 7, 8.
- Produces:
  - `interface ReadBox { id: string; x: number; y: number; lines: number; text: string }`
  - `readPptxBoxes(pptx: Uint8Array): Promise<Map<number, ReadBox[]>>` (from `a:off` divided by 6350, `a:br` count + 1, per text shape and per table cell, keyed by shape name = box id)
  - `readHtmlBoxes(html: string): Map<number, ReadBox[]>` (from `data-box`, inline `left/top`, `<br>` count + 1)
  - `checkFigureParity(doc: LayoutDoc, pptxText: Map<number,string[]>, htmlText: Map<number,string[]>, xlsxSource: { statKey: string; display: string }[], stats: Map<string, StatValue>): EngineIssue[]` (tokens `\d[\d,]*(\.\d+)?%?`, commas removed; multisets equal per slide across PPTX, HTML and the layout figures; every figure's display equals the workbook source row and the engine's StatValue)
  - `checkLayoutParity(html: Map<number, ReadBox[]>, pptx: Map<number, ReadBox[]>, tolerancePx = 2): EngineIssue[]` (equal line count and top-left within 2px, per box and cell; a box present in one only is a mismatch)
  - `lintText(s: string): { rule: "T3" | "T6"; index: number }[]` (U+2013, U+2014; `\p{Extended_Pictographic}` plus U+2713, U+2705, U+26A0, U+2605 and arrows U+2190 to U+21FF)
  - `lintLayout(doc: LayoutDoc): EngineIssue[]` (F2 fit errors, F4 size < 20px, T3/T6 over every text, and R3 single coloured word in a title as a warning)
  - `checkReconciliation(processed: Map<string, ProcessedDataset>, xlsxSteps: { datasetId: string; inCount: number; removed: number; outCount: number }[]): EngineIssue[]`
  - `checkOoxml(pptx: Uint8Array, xlsx: Uint8Array, doc: LayoutDoc, plan: WorkbookPlan): Promise<EngineIssue[]>` (each zip re-opens; every XML part parses; counts of slides, `a:tbl`, charts with `c:externalData`, `p:pic`, xlsx tables and pivots equal what the layout and plan declare; zero Arabic-Indic digits U+0660 to U+0669)
  - `interface GateReport { passed: boolean; issues: EngineIssue[]; warnings: EngineIssue[]; counts: Record<string, number> }`
  - `runGates(input: { doc; html; pptx; xlsx; plan; processed; stats }): Promise<GateReport>` runs all gates, never short-circuits, `passed` only when `issues` is empty

- [ ] **Step 1: Write the failing tests**

```ts
it("figure parity passes on the fixture and fails when one PPTX number is edited", async () => {
  expect(await gateOn(goodOutputs)).toMatchObject({ passed: true });
  const bad = await editPptxText(goodOutputs.pptx, "70.00%", "71.00%");
  expect((await gateOn({ ...goodOutputs, pptx: bad })).issues).toContainEqual(expect.objectContaining({ rule: "gate.figureParity", slide: 1 }));
});
it("layout parity flags a 3px move and an extra a:br", () => {});
it("layout parity accepts a 2px offset", () => {});
it.each(["عنوان \u2014 فرعي", "نتيجة \u2013 جيدة", "تم \u2705", "تحذير \u26A0", "سهم \u2192"])("lint fails %s", (s) => { expect(lintText(s).length).toBeGreaterThan(0); });
it("lint passes plain hyphen, colon and Latin digits", () => { expect(lintText("نسبة: 85.5% - جدة")).toEqual([]); });
it("reconciliation fails when a step's removed count is off by one", () => {});
it("ooxml self-check fails when a table part is deleted from the xlsx zip (silent-drop trap)", () => {});
it("ooxml self-check fails on an Arabic-Indic digit in a slide", () => {});
it("runGates reports every failing gate, not only the first", () => {});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/engine/gates src/engine/lint`
Expected: FAIL.

- [ ] **Step 3: Implement** the read-back helpers and gates. XML parsing in node uses a minimal tokenizer shared from `readBack.ts` (no DOMParser in the Vitest node environment, no new dependency).

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/engine/gates src/engine/lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/gates src/engine/lint
git commit -m "Add (engine): release gates for figure and layout parity, lint, reconciliation and OOXML"
```

---

### Task 10: issueReport() and the walking-skeleton test

**Files:**
- Create: `src/engine/issue/issueReport.ts`
- Modify: `src/engine/index.ts` (export `issueReport` and public types)
- Create: `docs/edit logs/2026-11-05.md` entry via `npm run editlog` (or append if present)
- Test: `src/engine/issue/issueReport.test.ts`, `src/engine/issue/walkingSkeleton.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `interface IssueOutput { html: string; pdfPrintable: string; pptx: Uint8Array; xlsx: Uint8Array; lintReport: EngineIssue[]; parityReport: GateReport }`
  - `type IssueResult = { ok: true; files: IssueOutput } | { ok: false; issues: EngineIssue[]; message: string }`
  - `issueReport(template: Template, pack: DomainPack, datasets: DatasetInput[], params: IssueParams, env: { theme: ThemeTokens; measurer: TextMeasurer; now?: () => number }): Promise<IssueResult>`
- Order (M11): `validateInputs`, `applySteps` per dataset, `computeAll`, `planWorkbook` + `writeXlsx`, `layoutReport`, `renderHtml`, `writePptx`, `runGates`. `pdfPrintable` is the same HTML string (print CSS inside). Any validation issue, fit error, thrown error or failed gate returns `ok: false` with no files and `message = formatIssue(issues[0], params.messages)`; the elapsed time is checked against `LIMITS.issueTimeBudgetMs` between stages using `env.now` (defaults to `performance.now`), never inside output.
- The spec sketch names the argument `packId`; the core takes the `DomainPack` object itself because the module never reads host storage. Note this in the edit log.

- [ ] **Step 1: Write the failing tests**

```ts
// walkingSkeleton.test.ts
it("issues the two-slide fixture in all four formats with every gate passing", async () => {
  const f = twoSlideFixture();
  const r = await issueReport(f.template, f.pack, f.datasets, f.params, { theme: f.theme, measurer: createFixedAdvanceMeasurer() });
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.files.html.length).toBeGreaterThan(0);
  expect(r.files.pdfPrintable).toBe(r.files.html);
  expect(r.files.pptx.byteLength).toBeGreaterThan(0);
  expect(r.files.xlsx.byteLength).toBeGreaterThan(0);
  expect(r.files.parityReport.passed).toBe(true);
  expect(r.files.parityReport.counts).toMatchObject({ slides: 2, pptxTables: 1, pptxCharts: 1, xlsxTables: 1 });
  expect(r.files.lintReport).toEqual([]);
});
it("is byte-identical across two issues", async () => { expect(sha(a.pptx)).toBe(sha(b.pptx)); expect(sha(a.xlsx)).toBe(sha(b.xlsx)); expect(a.html).toBe(b.html); });
// issueReport.test.ts: all or nothing
it.each([
  ["invalid measure", "measure.unknown"],
  ["long dash in a title", "gate.lint"],
  ["text that cannot fit", "fit.tooLong"],
  ["a step that miscounts (forced through a test seam)", "gate.reconcile"],
  ["time budget exceeded (env.now jumps)", "limit.time"],
  ["writer throws", "gate.ooxml"],
])("%s returns ok:false with no files and one Arabic message", async (_n, rule) => {
  const r = await issueWith(mutation);
  expect(r.ok).toBe(false);
  expect(r).not.toHaveProperty("files");
  expect(r.issues[0].rule).toBe(rule);
  expect(r.message).not.toMatch(/[\u2013\u2014]/);
});
it("empty dataset issues honest zeros or '-' and still passes gates", async () => {});
it("one-row dataset issues and passes gates", async () => {});
```

Add `"limit.time"` to `MessageKey` in Task 1's catalog if not already present.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/engine/issue`
Expected: FAIL, `issueReport` not defined.

- [ ] **Step 3: Implement** `issueReport` with one `try/catch` around the pipeline that converts any throw into `ok: false` with rule `gate.ooxml` for writer stages or `schema.invalid` otherwise, naming the stage in `detail`.

- [ ] **Step 4: Run the tier-3 gates**

Run, in order:
```
npx vitest run src/engine
npm run lint
npm run typecheck
npm run test:run
npm run check:complexity
npm run check:hex-literals
npm run check:vendor
npm run build
npm run check:bundle-size
```
Expected: every command exits 0. `check:bundle-size` reports raw/gzip under 30 MB / 10 MB; record the delta against main in the edit log. If the engine is not yet imported by the app, the bundle is unchanged; say so in the edit log rather than claiming a measured cost.

- [ ] **Step 5: Write the edit-log entry, then run check:release**

Run: `npm run editlog -- --tier=3 --append --sync-package "Add (engine): report engine core pipeline and release gates"`
Write `Why:`, `What changed:`, migration (none: no workspace format change, the engine writes no host files) and rollback (delete `src/engine/`, revert the `package.json` dependency move). Then `npm run check:release`; expected exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/engine package.json package-lock.json "docs/edit logs/2026-11-05.md"
git commit -m "Add (engine): issueReport entry and walking skeleton in four formats"
```

---

## Self-review notes

- Spec coverage for Milestone 1: M1 (Task 10), M2 (Tasks 5, 7, 9), M3 and M12 (Tasks 3, 8, 9), M4 (Task 7, native table and chart), M5 (Tasks 4, 6, 7), M6 (Tasks 2, 5, 9), M7 (Tasks 4, 5), M8 (Task 9), M9 (Task 2, pack is data), M11 order (Task 10), M13 (Tasks 1, 2, 9, 10). M10 font shipping, M14 catalog, slicers, charts and buttons in the workbook, and the browser lint pass are later milestones by design.
- Real Office verification (PowerPoint and Excel COM opening the files, as the PoC did) is not a Vitest gate; it stays a manual release check until Milestone 3 decides whether to script it in CI on a Windows runner.
