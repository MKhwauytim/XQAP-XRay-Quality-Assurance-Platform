# Report Engine Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the portable report engine's core under `src/engine/`, so one call `issueReport(spec, datasets, params, env)` turns a `ReportSpec` plus raw uploaded rows into five files (static HTML, the printable PDF page, PowerPoint, Excel and a JSON recipe), all from one layout model and one set of formula-defined measures, with every release gate passing or nothing issued.

**Architecture:** One brain, two doors (`docs/research/2026-11-05-smart-report-engine-design.md` §3). Both the API door and the later «التقارير» tab produce the same `ReportSpec` and pass the same gates. The pipeline follows M11: validate the spec and raw input (M13), type and profile every column, apply processing steps, resolve every visual by evaluating safe-formula measures over rows and groups, build the absolute pre-measured layout (1920x1080 px), render static HTML and PPTX from that layout, write the XLSX with raw then processed sections and the same measures translated to Excel formulas, run the gates, then emit the recipe. The engine is headless and self-contained: nothing in `src/engine/` imports app code, it has no notion of users or permissions, and it never touches host storage.

**Tech Stack:** TypeScript (strict, `erasableSyntaxOnly`), Vitest (node environment), plain TypeScript for parsing and calculation (no expression or query library, owner decision 16), pptxgenjs 4.0.1 with its bundled JSZip for PPTX, vendored SheetJS `xlsx` 0.20.3 for workbook cells, JSZip post-processing for OOXML parts neither library writes.

**Spec:** `docs/superpowers/specs/2026-11-01-report-engine-design.md` (authority: §0 decisions 1 to 8, owner decisions on the smart engine 9 to 16, §0.1 M1 to M14, §4.9 design rules, §5.1 acceptance test) and `docs/research/2026-11-05-smart-report-engine-design.md` (§3 two doors, §4.3 safe formulas, §5.1 `ReportSpec`, §5.2 resolve, §5.4 format mapping). Proven techniques: `poc/pptx/RESULTS.md`, `poc/pptx/RESULTS-T.md`, `poc/port-pptx/RESULTS.md`, `poc/xlsx/RESULTS.md`.

## Milestone map

Each milestone after the first gets its own plan, written when the previous one lands.

| # | Milestone | Delivers | Spec anchor |
|---|---|---|---|
| 1 | Core pipeline and its gates (this plan) | Column typing and profile, safe formula language (evaluate and translate to Excel), `ReportSpec` schema and validation, resolve, layout with fit ladder, static HTML, PPTX and XLSX writers for text, table, bar chart and KPI band, gate runner, recipe file, `issueReport()`, two-slide walking skeleton in all five outputs | M1 to M8, M11 to M13, decisions 9 to 16 |
| 2 | Visual library and analysis features | Remaining visuals (`lineChart`, `groupedBarChart`, `tierHistogram`, `kvTable`, `statStack`, `tintedPanel`, `pageFrame`, matrix, grouped-shape diagrams, freeform), relationships and join, time intelligence, ratio and rank and topN functions beyond the core set, derived datasets, thresholds, show-if-not-empty, bookmarks and slicer state; workbook slicers, charts, shape buttons and cover links | research §4.2 to §4.4, §5.4; spec §5.1 capabilities 1 to 9; M3 workbook design |
| 3 | API door, host integration and scale | The API door wired for the X-ray host (datasets built from population, sample, distribution and answers; `packId: "xray"` pack from `DATA_DICTIONARY.md`), host action gating for author/run/view through `canMutate`, worker execution with time budget, streaming large raw sets, companion raw workbook past 1,048,576 rows, browser text measurer and browser lint pass, **limits fixed by measurement on real machines**, app-side file writes through `safeWriteJson` and `workspacePaths.ts` | research §3.a; decisions 13, 14; M12 size note; M13 isolated work |
| 4 | User door: the «التقارير» tab | Upload through `workbookWorker.ts`, the mandatory column-types screen with profile panel, optional pack mapping, measure form with formula view, deck3 canvas on grid units, fields pane, wells with type-checked drops, filters and slicers, the Show Me recommender, one issue button over the same `issueReport()` | research §3.b steps 1 to 8, §5.1 |
| 5 | Catalog and slide picks | Numbered HTML lookbook of 15 to 20 designs seeded from deck3, stable numbers, picks import, retired-number refusal, design-lint gate for catalog entry | §0 decision 3, M14, §4.9 catalog rule |
| 6 | Acceptance | deck3 expressed as a `ReportSpec` with parity via `kitSnapshot.test.ts`; the §5.1 port report rebuilt by hand in the «التقارير» tab with figure parity | §0 decisions 1 and 6, §5.1 pass criteria |

## Global Constraints

- Import boundary: no file under `src/engine/` imports from outside `src/engine/` except the packages `pptxgenjs`, `jszip` and `xlsx`. Enforced by a test and an ESLint `no-restricted-imports` override.
- No accounts, roles or permissions in the engine (decision 13). The engine exports an action list `ENGINE_ACTIONS = ["author", "run", "view"]` and pure functions for each; the host decides who may call them. No user id, role or capability appears in any engine type.
- The engine never reads or writes host storage and never stores uploaded data (decision 12). It returns bytes and the recipe; the host writes them. When the app persists files (Milestone 3) it uses `safeWriteJson` / `workspacePaths.ts` per CLAUDE.md.
- Calculation and parsing are plain TypeScript (decision 16). No `eval`, no `new Function`, no expression library, no query library.
- Formulas (decision 10): parsed to an AST with an allow-list of functions, operators and column references; any node outside the list rejects the whole expression with its position.
- Columns (decision 11): a declared type is enough to compute on a column; pack mapping is optional and only unlocks the pack's ready measures. A cell that does not convert to its declared type is a counted error; an issue that uses an errored column in a measure fails closed. Never a silent zero.
- Outputs (M1 and decision 12): every issue produces HTML, PDF (that HTML printed; no separate PDF writer), PowerPoint, Excel and the recipe JSON together, or none.
- HTML is static (decision 15): no script, no interactive filter; it matches the PowerPoint. Interaction lives in the Excel workbook and in the host.
- M2 / decision 8: per text box and table cell, equal line count and top-left within 2px between HTML and PowerPoint; any mismatch blocks the issue.
- M5: every paragraph `rtl="1"` and `algn="r"`; every table `a:tblPr rtl="1"` with columns in logical order; every Latin or digit token (regex `[A-Za-z0-9][A-Za-z0-9.,%-/:+]*`, ` / ` joining clusters) is its own run with `lang="en-US"` and `<a:rtl val="0"/>`; no U+200E, no U+2066/U+2069. HTML uses `<span dir="ltr">` for the same tokens.
- Decision 4: Latin digits everywhere; zero Arabic-Indic digits (U+0660 to U+0669) in any output.
- Units: 6350 EMU per px, font size pt = px x 0.5, slide 1920x1080 px. `ReportSpec` frames are grid units (`grid: { cols: 24, rows: 14 }`); layout converts once to px.
- M7 fit ladder: one line at base size, shrink to max(20px, 0.85 x base), widen from sibling columns down to their measured minimum, two balanced lines, else error «العنوان أطول من المساحة»; measured widths times `FIT_SAFETY = 1.04`. No ellipsis, no abbreviation. Long tables continue on slides whose title ends with « (يتبع)», header repeated.
- §4.9: F4 minimum font 20px; T3 no U+2013 or U+2014 anywhere in output; T6 no emojis or decorative symbols (check marks U+2713 and U+2705, warning sign U+26A0, star U+2605, arrows U+2190 to U+21FF, any `\p{Extended_Pictographic}`). Both Floor, blocking.
- M6: every number on a slide is a reference to a resolved measure; a typed digit in a spec text visual is a validation error. Empty results display `-`, never an invented `0`.
- M12: workbook raw section (uploaded files, sheets, columns, names and order untouched), then processed section (one sheet per step, processed sets, statistics). Raw rows minus each step's removed rows equals processed rows, checked on every issue.
- Workbook order: الفهرس, `|`, raw sheets, `||`, processing steps, `|||`, المجتمع and العينة, `||||`, الإحصائيات, `|||||`, المصدر. Separators: black tab, black cells, gridlines and headings hidden, empty.
- M13 determinism: same raw files, spec and parameters give byte-identical outputs, including the recipe. Every zip timestamp, generated id and document date derives from `params.issuedAt`, never the clock.
- M13 bounds live in `src/engine/limits.ts` and are **provisional** (decision 14): each constant carries `// provisional: fix by measurement, Milestone 3`, and the module exports `LIMITS_STATUS = "provisional"`. Hitting one returns a clear Arabic message, never a crash.
- `ENGINE_VERSION` is a constant in `src/engine/version.ts`, written into the recipe and into the workbook's المصدر sheet.
- Dependencies (owner decision): pptxgenjs is allowed; it is a devDependency on this branch and **must move to `dependencies` in `package.json`**; jszip comes via pptxgenjs (import it explicitly and list it in `dependencies` at the version pptxgenjs resolves); `xlsx` stays the vendored `file:vendor/xlsx-0.20.3.tgz`. **`npm run check:bundle-size` is required** once the engine is reachable from the app bundle (pptxgenjs measured 450.1 KB raw / 154.0 KB gzip as a bundle).
- Edit log: tier 3. `npm run editlog -- --tier=3 --append --sync-package "Add (engine): ..."`. Tier-3 gates before claiming done: `lint`, `typecheck`, `test:run`, `check:complexity`, `check:hex-literals`, `check:release`, `check:vendor`, `build`, `check:bundle-size`. **`npm run build` before pushing or opening a PR.**
- UI strings in the app use `labelsStore.ts` keys. The engine cannot import it, so engine messages live in `src/engine/messages.ts` as a keyed Arabic catalog a host may override via `IssueParams.messages`; Milestone 4 wires the app's label keys into that override.
- Colours: `ReportSpec` uses tones only (`primary | neutral | good | bad`, plus deck3 tone keys); hex values arrive in a `ThemeTokens` object from the host. No raw hex literal in engine source outside the one tokens fixture (`check:hex-literals` stays green; allowlist the fixture if needed).

## Review Focus

- A number column where some cells are text such as `غير متوفر` or `12,5`: profile counts them as errors, the measure using that column fails the issue with the column name and error count, never a sum that quietly skipped them.
- Hostile or odd formula text (`constructor`, `__proto__`, deep nesting, a 100 KB string, Arabic column names with spaces, unbalanced brackets): rejected with a position, never a crash, a hang or a property lookup on `Object.prototype`.
- Arabic text whose browser line break differs from PowerPoint: the PPTX carries the measured breaks as `a:br` soft breaks so line counts match, and a wrapped box anchors on its right edge.
- Number clusters inside Arabic sentences (`20 / 37`, `85.5%` after Arabic letters, `05-11-2026`): reading order holds in both renderers.
- Re-issue from the recipe with a raw file whose hash changed: refused with the file name, never silently issued on different data; with the same files, byte-identical outputs.

---

## File structure

```
src/engine/
  index.ts                 public surface: issueReport, ENGINE_ACTIONS, types, createFixedAdvanceMeasurer
  version.ts               ENGINE_VERSION
  limits.ts                every M13 bound, provisional
  messages.ts              keyed Arabic message catalog, formatIssue()
  errors.ts                EngineIssue, IssueFailure
  actions.ts               ENGINE_ACTIONS and the action-to-function map (no permissions)
  boundary.test.ts         import-boundary test
  data/
    types.ts               RawFile, RawSheet, ColumnDecl, DatasetDef, ColumnProfile
    typing.ts              parseCell(), typeDataset(), suggestTypes()
    profile.ts             profileColumns()
    processing.ts          applySteps()
  formula/
    ast.ts                 Expr node union, ALLOWED_FUNCTIONS, ALLOWED_OPERATORS
    parse.ts               parseFormula()
    evaluate.ts            evaluateMeasure()
    toExcel.ts             toExcelFormula()
  spec/
    types.ts               ReportSpec, PageSpec, VisualSpec, Wells, FilterSpec, MeasureSpec, DomainPack, ThemeTokens, IssueParams
    wells.ts               WELL_SCHEMAS per visual type
    validate.ts            validateSpec()
  resolve/resolve.ts       resolveVisuals(): ResolvedVisual with provenance
  layout/
    types.ts               LayoutDoc and box union
    measure.ts             TextMeasurer, createFixedAdvanceMeasurer()
    bidiRuns.ts            splitRuns()
    fitLadder.ts           fitText(), fitTableHeaders()
    layoutReport.ts        layoutReport()
  html/renderHtml.ts       static HTML (print CSS for PDF)
  pptx/units.ts, writePptx.ts, postprocess.ts
  xlsx/planWorkbook.ts, writeXlsx.ts, ooxmlParts.ts
  gates/readBack.ts, figureParity.ts, layoutParity.ts, reconcile.ts, ooxmlSelfCheck.ts, runGates.ts
  lint/designLint.ts
  recipe/recipe.ts         buildRecipe(), validateRecipe(), sha256Hex()
  issue/issueReport.ts     issueReport(), reissueFromRecipe()
  __fixtures__/twoSlide.ts raw files, column decls, ReportSpec, params, theme
```

Tests sit beside each file as `*.test.ts` (Vitest node environment; `vitest.config.ts` already includes `src/**/*.test.ts`).

---

### Task 1: Engine skeleton, import boundary, actions, provisional limits and messages

**Files:**
- Create: `src/engine/index.ts`, `version.ts`, `limits.ts`, `messages.ts`, `errors.ts`, `actions.ts`
- Modify: `eslint.config.js` (override for `src/engine/**` beside the existing `@typescript-eslint/no-restricted-imports` block near line 109)
- Test: `src/engine/boundary.test.ts`, `src/engine/errors.test.ts`

**Interfaces:**
- Produces:
  - `ENGINE_VERSION: string` (start `"1.0.0"`)
  - `LIMITS = { maxRowsPerDataset: 2_000_000, maxSlides: 200, maxVisualsPerPage: 40, maxChartCategories: 12, maxTableCellsPerPage: 240, maxFormulaLength: 2_000, maxFormulaDepth: 32, issueTimeBudgetMs: 120_000 } as const`, each line commented `// provisional: fix by measurement, Milestone 3`; `LIMITS_STATUS = "provisional" as const`
  - `ENGINE_ACTIONS = ["author", "run", "view"] as const`; `type EngineAction = typeof ENGINE_ACTIONS[number]`. `author` = `validateSpec`, `run` = `issueReport` / `reissueFromRecipe`, `view` = reading an issued recipe or files (no engine call needed beyond `validateRecipe`)
  - `type MessageKey` including `"schema.invalid" | "type.errors" | "formula.syntax" | "formula.notAllowed" | "formula.tooDeep" | "measure.unknown" | "well.invalid" | "literal.number" | "limit.rows" | "limit.slides" | "limit.visuals" | "limit.time" | "fit.tooLong" | "gate.figureParity" | "gate.layoutParity" | "gate.lint" | "gate.reconcile" | "gate.ooxml" | "recipe.hashMismatch" | "recipe.invalid"`
  - `MESSAGES_AR: Record<MessageKey, string>`
  - `interface EngineIssue { rule: MessageKey; page?: number; visual?: string; path?: string; detail?: string }`
  - `formatIssue(issue: EngineIssue, messages?: Partial<Record<MessageKey, string>>): string`

- [ ] **Step 1: Write the failing tests**

```ts
it("no engine file imports outside src/engine or the allowed packages", () => {
  expect(scanImports("src/engine").filter((i) => isBareOutsideAllowList(i, ["pptxgenjs", "jszip", "xlsx"]))).toEqual([]);
  expect(scanImports("src/engine").filter((i) => resolvesOutside(i, "src/engine"))).toEqual([]);
});
it("no engine source mentions roles or permissions", () => {
  expect(grepEngine(/\b(role|permission|canMutate|AuthRole|userId)\b/)).toEqual([]);
});
it("exposes exactly the three actions", () => { expect(ENGINE_ACTIONS).toEqual(["author", "run", "view"]); });
it("limits are marked provisional", () => {
  expect(LIMITS_STATUS).toBe("provisional");
  expect(readFile("src/engine/limits.ts").match(/provisional: fix by measurement/g)!.length).toBe(Object.keys(LIMITS).length);
});
it("formatIssue names page, visual and rule in Arabic, without long dashes", () => {
  const s = formatIssue({ rule: "fit.tooLong", page: 2, visual: "v1" });
  expect(s).toContain("العنوان أطول من المساحة"); expect(s).toContain("v1"); expect(s).not.toMatch(/[–—]/);
});
it("host override replaces a message", () => { expect(formatIssue({ rule: "fit.tooLong" }, { "fit.tooLong": "X" })).toContain("X"); });
```

The role/permission grep excludes the word `role` inside `Wells` keys by matching only identifiers listed above; `scanImports` and `grepEngine` live in the test file and use `node:fs`.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/engine/boundary.test.ts src/engine/errors.test.ts`
Expected: FAIL, `formatIssue` not defined.

- [ ] **Step 3: Implement** the six modules and the ESLint override (`files: ["src/engine/**"]`, restricted patterns for app folders `**/data/**`, `**/components/**`, `**/auth/**`, `**/utils/**`, `**/branding/**`, `**/workers/**`, message "engine must not import app code").

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/engine && npm run lint && npm run typecheck`
Expected: PASS, 0 lint errors.

- [ ] **Step 5: Commit**

```bash
git add src/engine eslint.config.js
git commit -m "Add (engine): skeleton, import boundary, actions, provisional limits and messages"
```

---

### Task 2: Column typing and column profile

**Files:**
- Create: `src/engine/data/types.ts`, `src/engine/data/typing.ts`, `src/engine/data/profile.ts`, `src/engine/__fixtures__/twoSlide.ts` (raw part only; Task 4 adds the spec)
- Test: `src/engine/data/typing.test.ts`, `src/engine/data/profile.test.ts`

**Interfaces:**
- Consumes: `EngineIssue`, `LIMITS` (Task 1).
- Produces:
  - `interface RawSheet { sheetName: string; headers: string[]; rows: unknown[][] }`; `interface RawFile { fileName: string; bytesSha256: string; sheets: RawSheet[] }` (the host computes the hash of the uploaded bytes; the engine checks it is 64 hex chars)
  - `type ColumnType = "text" | "number" | "date" | "boolean"`
  - `interface ColumnDecl { source: { file: string; sheet: string; header: string }; id: string; label: string; type: ColumnType; role: "dimension" | "measure"; level: "nominal" | "ordinal" | "quantitative" | "temporal"; packField?: string }`
  - `interface DatasetDef { id: string; label: string; files: string[]; columns: ColumnDecl[]; steps: ProcessingStep[] }` (`ProcessingStep` is defined here: `{ id; label; kind: "filter" | "dedupe" | "calc"; filter?: FilterSpec; key?: string[]; calc?: { columnId: string; type: ColumnType; formula: string } }`; `FilterSpec = { field: string; op: "eq" | "neq" | "in" | "notNull"; value?: string | number | boolean | (string | number)[] }`)
  - `type Cell = string | number | boolean | null` (dates are ISO `YYYY-MM-DD` strings)
  - `interface TypedCell { value: Cell; error?: string }`
  - `parseCell(raw: unknown, type: ColumnType): TypedCell`: numbers accept Latin digits with `,` thousands and `.` decimal, and Arabic-Indic digits converted to Latin; dates accept ISO strings and Excel serials; booleans accept `true/false/نعم/لا/1/0`; empty string and `null` give `{ value: null }` (null, not error); anything else gives `{ value: null, error }`
  - `interface TypedDataset { id: string; rows: Record<string, Cell>[]; errors: { columnId: string; row: number; raw: string }[] }`
  - `typeDataset(def: DatasetDef, files: RawFile[]): { data: TypedDataset; issues: EngineIssue[] }` (rows from every listed file and sheet in upload order; an unknown header, a missing file or rows over `LIMITS.maxRowsPerDataset` is an issue)
  - `suggestTypes(sheet: RawSheet): { header: string; type: ColumnType; role; level }[]` (majority type over all non-empty cells; the user door confirms in Milestone 4)
  - `interface ColumnProfile { columnId: string; total: number; valid: number; errors: number; nulls: number; distinct: number; sampleErrors: string[] }` (`sampleErrors` holds at most 5 raw values)
  - `profileColumns(data: TypedDataset, def: DatasetDef): ColumnProfile[]`

- [ ] **Step 1: Write the failing tests**

```ts
it.each([
  ["48,250", "number", 48250], ["85.5", "number", 85.5], ["٤٨٢٥٠", "number", 48250],
  ["2026-05-01", "date", "2026-05-01"], [45778, "date", "2025-05-01"],
  ["نعم", "boolean", true], ["", "number", null], [null, "text", null],
])("parseCell(%s as %s) = %s", (raw, t, v) => { expect(parseCell(raw, t)).toEqual({ value: v }); });
it.each([["غير متوفر", "number"], ["12,5", "number"], ["31/02/2026", "date"], ["ربما", "boolean"]])(
  "parseCell(%s as %s) is an explicit error, not zero", (raw, t) => {
    const c = parseCell(raw, t); expect(c.value).toBeNull(); expect(c.error).toBeTruthy();
  });
it("profile counts valid, error, null and distinct", () => {
  const p = profileColumns(typed, def).find((c) => c.columnId === "count")!;
  expect(p).toMatchObject({ total: 12, valid: 9, errors: 2, nulls: 1, distinct: 7 });
  expect(p.valid + p.errors + p.nulls).toBe(p.total);
});
it("unknown header in a ColumnDecl is an issue with its path", () => {});
it("duplicate header names in one sheet are rejected with the sheet name", () => {});
it("rows over the limit give limit.rows, not a crash", () => {});
it("suggestTypes picks number for a mostly numeric column", () => {});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/engine/data`
Expected: FAIL.

- [ ] **Step 3: Implement** the types, `parseCell`, `typeDataset`, `suggestTypes`, `profileColumns` and the fixture's raw part: one file `studies.xlsx` with sheet `نتائج الدراسة`, 12 rows, columns `المنفذ`, `نوع المنفذ`, `الحالة`, `العدد` (two deliberate text errors and one empty cell in `العدد`, which no fixture measure uses).

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/engine/data`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/data src/engine/__fixtures__
git commit -m "Add (engine): column typing and column profile"
```

---

### Task 3: Safe formula language: parser and evaluator

**Files:**
- Create: `src/engine/formula/ast.ts`, `src/engine/formula/parse.ts`, `src/engine/formula/evaluate.ts`
- Test: `src/engine/formula/parse.test.ts`, `src/engine/formula/evaluate.test.ts`, `src/engine/formula/hostile.test.ts`

**Interfaces:**
- Consumes: `Cell`, `ColumnDecl`, `TypedDataset` (Task 2); `LIMITS`, `EngineIssue` (Task 1).
- Produces:
  - `type Expr = { k: "num"; v: number } | { k: "str"; v: string } | { k: "bool"; v: boolean } | { k: "col"; id: string } | { k: "measure"; id: string } | { k: "bin"; op: BinOp; l: Expr; r: Expr } | { k: "not"; e: Expr } | { k: "call"; fn: AllowedFn; args: Expr[] }`
  - `ALLOWED_OPERATORS = ["+", "-", "*", "/", "=", "<>", "<", "<=", ">", ">=", "and", "or", "not"] as const`
  - `ALLOWED_FUNCTIONS = ["sum", "count", "distinctCount", "avg", "min", "max", "percentOfTotal", "ratio", "if", "filter"] as const` (`filter(aggregate, condition)` is the "with filter" form; `ratio(measureA, measureB)` divides two measures; `if` is row level only)
  - Grammar: column references as `[اسم العمود]` or a bare identifier matching a declared column id; measure references as `@measureId`; strings in double quotes; numbers with Latin digits only
  - `parseFormula(text: string, scope: { columns: ColumnDecl[]; measures: string[] }): { ok: true; ast: Expr } | { ok: false; issue: EngineIssue }` (issue `detail` carries the character position; unknown identifier, function or operator gives `formula.notAllowed`; depth over `LIMITS.maxFormulaDepth` gives `formula.tooDeep`; length over `LIMITS.maxFormulaLength` rejected before tokenizing)
  - `evaluateMeasure(ast: Expr, rows: Record<string, Cell>[], ctx: { measures: Map<string, Expr>; allRows: Record<string, Cell>[] }): number | null` (aggregates skip nulls; division by zero or an empty set gives `null`; `percentOfTotal` divides by the same aggregate over `ctx.allRows`)
  - `evaluateRow(ast: Expr, row: Record<string, Cell>): Cell` (for `calc` steps)
  - `measureColumns(ast: Expr, measures: Map<string, Expr>): string[]` (every column a measure reads, through referenced measures; used by fail-closed type errors and provenance)

- [ ] **Step 1: Write the failing tests**

```ts
const scope = { columns: fixtureColumns, measures: ["studied"] };
it("parses a ratio with a filter", () => {
  const r = parseFormula('filter(count([الحالة]), [الحالة] = "مطابق") / @studied', scope);
  expect(r.ok && r.ast).toMatchObject({ k: "bin", op: "/" });
});
it("evaluates count, sum, avg, distinctCount, percentOfTotal over rows", () => {});
it("division by zero and empty sets give null, never 0 or Infinity", () => {
  expect(evaluateMeasure(parse("sum([العدد]) / count([غير_موجود_في_الصفوف])"), [], ctx)).toBeNull();
});
it("evaluates per group when given the group's rows", () => {});
// hostile.test.ts
it.each([
  "constructor", "__proto__", "[الحالة].constructor", "toString()", "eval(\"1\")", "Function(\"x\")",
  "process.exit()", "sum(", "sum([الحالة]", "1 +* 2", "\"unterminated", "[عمود غير معلن]",
  "@unknownMeasure", "1e309", "١٢٣", "sum(" .repeat(40) + "1" + ")".repeat(40), "x".repeat(LIMITS.maxFormulaLength + 1),
  "a; b", "a ? b : c", "`x`", "[a]]", "if(1,2)",
])("rejects %s with a position and no throw", (text) => {
  const r = parseFormula(text, scope);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(["formula.syntax", "formula.notAllowed", "formula.tooDeep"]).toContain(r.issue.rule);
});
it("never reads Object.prototype: a column named 'constructor' declared by the user is a normal column", () => {});
it("parses a 2,000-char valid formula in under 50 ms", () => {});
it("source contains no eval and no new Function", () => {
  expect(readFile("src/engine/formula/evaluate.ts") + readFile("src/engine/formula/parse.ts")).not.toMatch(/\beval\s*\(|new\s+Function/);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/engine/formula`
Expected: FAIL.

- [ ] **Step 3: Implement** a hand-written tokenizer and recursive-descent (precedence climbing) parser in `parse.ts`, and a tree-walking evaluator in `evaluate.ts` that switches on `k` and on `fn` from the allow-list. Column lookup uses `Map<string, ...>` and `Object.hasOwn`, never bracket access on plain objects with user strings.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/engine/formula`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/formula
git commit -m "Add (engine): safe formula language parser and evaluator"
```

---

### Task 4: ReportSpec, domain pack and well schemas with validation

**Files:**
- Create: `src/engine/spec/types.ts`, `src/engine/spec/wells.ts`, `src/engine/spec/validate.ts`
- Modify: `src/engine/__fixtures__/twoSlide.ts` (add the spec, params and theme)
- Test: `src/engine/spec/validate.test.ts`

**Interfaces:**
- Consumes: `DatasetDef`, `ColumnDecl`, `FilterSpec` (Task 2); `parseFormula` (Task 3).
- Produces:
  - `interface MeasureSpec { id: string; label: string; datasetId: string; formula: string; format: { kind: "int" | "pct" | "dec"; digits: number } }`
  - `interface DomainPack { packId: string; schemaVersion: 1; fields: { id: string; label: string; type: ColumnType; role: "dimension" | "measure"; aliases?: string[] }[]; measures: MeasureSpec[] }` (optional input; mapping a column with `packField` unlocks that pack's measures)
  - `type WellRole = "axis" | "legend" | "values" | "rows" | "columns"`
  - `type WellItem = { field: string } | { measure: string }`
  - `type Wells = Partial<Record<WellRole, WellItem[]>>`
  - `type VisualType = "text" | "kpiBand" | "table" | "barChart"`
  - `interface VisualSpec { visualId: string; type: VisualType; frame: { col: number; row: number; w: number; h: number; z: number }; wells: Wells; filters?: FilterSpec[]; sort?: { by: string; dir: "asc" | "desc" }; limit?: { topN: number; others: boolean }; format?: { tone: Tone; sizePx?: number; weight?: 400 | 700 }; text?: string }` (`text` only for `type: "text"`, may hold `{{measure:<id>}}` and `{{param:<id>}}`)
  - `interface PageSpec { pageId: string; title: string; size: "16:9"; grid: { cols: 24; rows: 14 }; filters?: FilterSpec[]; visuals: VisualSpec[] }`
  - `interface ReportSpec { schemaVersion: 1; reportId: string; title: string; theme: "deck3"; datasets: DatasetDef[]; model: { packId?: string; measures: MeasureSpec[] }; params: { id: string; type: "text" | "month" | "number"; required: boolean }[]; filters?: FilterSpec[]; pages: PageSpec[] }` (a filter `value` may be `{ param: "<id>" }`)
  - `type Tone = "primary" | "neutral" | "good" | "bad"`; `interface ThemeTokens { tones: Record<Tone, string>; ink: Record<"navy" | "text" | "muted" | "hair" | "bg" | "panel" | "gold", string>; font: string; fontData?: Uint8Array }`
  - `interface IssueParams { issuedAt: string; values: Record<string, string | number>; messages?: Partial<Record<MessageKey, string>> }`
  - `WELL_SCHEMAS: Record<VisualType, Partial<Record<WellRole, { accepts: ("text" | "number" | "date" | "boolean" | "measure")[]; min: number; max: number }>>>` (`barChart`: axis 1..1 text/date, legend 0..1 text, values 1..1 measure; `table`: rows 1..2 text/date, values 1..6 measure; `kpiBand`: values 1..6 measure; `text`: none)
  - `validateSpec(spec: ReportSpec, pack?: DomainPack, params?: IssueParams): EngineIssue[]` (paths like `pages[1].visuals[0].wells.values[0]`; parses every measure formula; checks well arity and types against column decls; checks frames inside the grid; F4 sizes; typed digits in `text`; required params present; `LIMITS.maxSlides`, `maxVisualsPerPage`)

- [ ] **Step 1: Write the failing tests**

```ts
it("accepts the two-slide fixture", () => { const f = twoSlideFixture(); expect(validateSpec(f.spec, undefined, f.params)).toEqual([]); });
it.each([
  ["unknown measure in a well", (f) => (f.spec.pages[0].visuals[1].wells.values![0] = { measure: "nope" }), "measure.unknown", "pages[0].visuals[1].wells.values[0]"],
  ["text field dropped in barChart values", (f) => (f.spec.pages[1].visuals[1].wells.values = [{ field: "port" }]), "well.invalid", "pages[1].visuals[1].wells.values[0]"],
  ["two axis fields on a bar chart", (f) => f.spec.pages[1].visuals[1].wells.axis!.push({ field: "portType" }), "well.invalid", "pages[1].visuals[1].wells.axis"],
  ["typed number in text", (f) => (f.spec.pages[0].visuals[0].text = "نسبة 92%"), "literal.number", "pages[0].visuals[0].text"],
  ["bad formula", (f) => (f.spec.model.measures[0].formula = "sum("), "formula.syntax", "model.measures[0].formula"],
  ["frame outside grid", (f) => (f.spec.pages[0].visuals[0].frame.col = 23), "schema.invalid", "pages[0].visuals[0].frame"],
  ["font under 20px", (f) => (f.spec.pages[0].visuals[0].format!.sizePx = 18), "schema.invalid", "pages[0].visuals[0].format.sizePx"],
  ["missing required param", (f) => delete f.params.values.port, "schema.invalid", "params.values.port"],
  ["too many pages", (f) => (f.spec.pages = Array(201).fill(f.spec.pages[0])), "limit.slides", "pages"],
  ["issuedAt not ISO", (f) => (f.params.issuedAt = "yesterday"), "schema.invalid", "params.issuedAt"],
])("rejects %s with its location", (_n, mutate, rule, path) => {
  const f = twoSlideFixture(); mutate(f);
  expect(validateSpec(f.spec, undefined, f.params)).toContainEqual(expect.objectContaining({ rule, path }));
});
it("a spec with no pack is valid (pack mapping is optional)", () => {});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/engine/spec`
Expected: FAIL.

- [ ] **Step 3: Implement** the types, `WELL_SCHEMAS`, `validateSpec` (hand-written structural checks; no schema library) and the fixture spec: page 1 title text visual plus a KPI band (`studied`, `matchRate`), page 2 a table (rows `portType`, values `studied`, `matchRate`) and a bar chart (axis `port`, values `matchRate`); measures `studied = count([الحالة])`, `matchRate = filter(count([الحالة]), [الحالة] = "مطابق") / @studied`; param `port` not required.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/engine/spec`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/spec src/engine/__fixtures__
git commit -m "Add (engine): ReportSpec, domain pack and well schemas with validation"
```

---

### Task 5: Processing steps and resolve

**Files:**
- Create: `src/engine/data/processing.ts`, `src/engine/resolve/resolve.ts`
- Test: `src/engine/data/processing.test.ts`, `src/engine/resolve/resolve.test.ts`

**Interfaces:**
- Consumes: `TypedDataset`, `DatasetDef`, `ProcessingStep`, `ColumnProfile` (Task 2); `parseFormula`, `evaluateMeasure`, `evaluateRow`, `measureColumns` (Task 3); `ReportSpec`, `MeasureSpec` (Task 4).
- Produces:
  - `interface ProcessedDataset { id: string; rawCount: number; steps: { stepId: string; label: string; inCount: number; removed: number; outCount: number }[]; rows: Record<string, Cell>[] }`
  - `applySteps(data: TypedDataset, def: DatasetDef, params: IssueParams): ProcessedDataset` (`filter` keeps matches, `dedupe` keeps the first by key, `calc` adds a typed column via `evaluateRow` and removes nothing)
  - `interface ResolvedValue { key: string; measureId: string; group: Record<string, string>; value: number | null; display: string; provenance: { datasetId: string; measureId: string; formula: string; columns: string[]; filters: FilterSpec[] } }`
  - `interface ResolvedVisual { pageIndex: number; visualId: string; type: VisualType; categories: string[]; cells: ResolvedValue[]; totals: ResolvedValue[] }`
  - `resolveVisuals(spec: ReportSpec, data: Map<string, ProcessedDataset>, profiles: Map<string, ColumnProfile[]>, params: IssueParams): { visuals: ResolvedVisual[]; values: Map<string, ResolvedValue>; issues: EngineIssue[] }`
  - `formatValue(v: number | null, f: MeasureSpec["format"]): string` (Latin digits via `Intl.NumberFormat("en-US")`, `,` thousands, `pct` as `82.95%`, `null` as `-`)
- Rules: query per visual = groupBy (axis + legend + rows + columns), measures (values), filters (report + page + visual, params substituted); totals re-evaluate the measure on the unsplit filtered rows, never by summing cells; categories sorted by `sort` else code point; over `LIMITS.maxChartCategories` keep top N-1 plus «أخرى». A measure whose `measureColumns` includes a column with `errors > 0` in its profile fails with `type.errors` naming the column and the count (fail closed). Keys are `measureId` or `measureId@field=value|field=value`.

- [ ] **Step 1: Write the failing tests**

```ts
it("each step reconciles: inCount - removed = outCount, and the chain ends at rows.length", () => {
  const p = applySteps(typed, def, params);
  p.steps.forEach((s) => expect(s.inCount - s.removed).toBe(s.outCount));
  expect(p.steps.at(-1)!.outCount).toBe(p.rows.length); expect(p.rawCount).toBe(12);
});
it("matchRate resolves to 0.7 with display 70.00% and provenance naming the column", () => {
  const v = values.get("matchRate")!;
  expect(v.value).toBeCloseTo(0.7, 10); expect(v.display).toBe("70.00%");
  expect(v.provenance.columns).toEqual(["status"]);
});
it("table cells per port type and a total that is re-evaluated, not summed", () => {});
it("a measure over a column with type errors fails with type.errors and the column name", () => {});
it("the fixture's errored column is unused, so the issue does not fail", () => {});
it("filters on {param: port} apply the param value", () => {});
it("an empty filtered set displays '-' for ratios and 0 for counts", () => {});
it("13 categories collapse to 11 plus «أخرى»", () => {});
it("is deterministic", () => {});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/engine/data/processing.test.ts src/engine/resolve`
Expected: FAIL.

- [ ] **Step 3: Implement** `applySteps`, `resolveVisuals` and `formatValue` in plain TypeScript (single pass group-by with `Map`).

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/engine/data src/engine/resolve`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/data src/engine/resolve
git commit -m "Add (engine): processing steps and resolve with provenance"
```

---

### Task 6: Text measurer, bidi runs and the fit ladder

**Files:**
- Create: `src/engine/layout/measure.ts`, `src/engine/layout/bidiRuns.ts`, `src/engine/layout/fitLadder.ts`
- Test: `src/engine/layout/bidiRuns.test.ts`, `src/engine/layout/fitLadder.test.ts`

**Interfaces:**
- Produces:
  - `interface TextMeasurer { width(text: string, sizePx: number, weight: 400 | 700): number }` (the host injects a canvas measurer in Milestone 3)
  - `createFixedAdvanceMeasurer(advance?: { arabic: number; latin: number; space: number }): TextMeasurer` (defaults `0.5 / 0.55 / 0.25` of size, bold x 1.06; deterministic)
  - `FIT_SAFETY = 1.04`
  - `interface Run { text: string; ltr: boolean }`; `splitRuns(s: string): Run[]`
  - `interface FitResult { step: 1 | 2 | 3 | 4 | 5; sizePx: number; widthPx: number; lines: string[] }`
  - `fitText(text: string, box: { w: number; basePx: number; weight: 400 | 700; maxLines: 1 | 2 }, m: TextMeasurer, widenTo?: number): FitResult`
  - `fitTableHeaders(headers: string[], colW: number[], minW: number[], basePx: number, m: TextMeasurer): { colW: number[]; fits: FitResult[] }`

- [ ] **Step 1: Write the failing tests**

```ts
it.each([
  ["نسبة 85.5% في جدة", [false, true, false]], ["الصفحة 20 / 37", [false, true]],
  ["التاريخ 05-11-2026", [false, true]], ["الموظف A6838", [false, true]],
])("splitRuns(%s)", (s, ltr) => {
  expect(splitRuns(s).map((r) => r.ltr)).toEqual(ltr);
  expect(splitRuns(s).map((r) => r.text).join("")).toBe(s);
});
it("step 1 at base size when it fits", () => {});
it("step 2 never below max(20, 0.85 x base)", () => { expect(fitText(t, { w, basePx: 25, weight: 700, maxLines: 2 }, m).sizePx).toBeGreaterThanOrEqual(21.25); });
it("step 3 widens up to widenTo", () => {});
it("step 4 gives two balanced lines split at a space", () => {});
it("step 5 keeps the full text", () => { const r = fitText(impossible, box, m); expect(r.step).toBe(5); expect(r.lines.join(" ")).toBe(impossible); });
it("FIT_SAFETY applies: text measuring w / 1.03 does not fit at step 1", () => {});
it("fitTableHeaders keeps sum(colW) constant and never goes below minW", () => {});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/engine/layout/bidiRuns.test.ts src/engine/layout/fitLadder.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.** Step 4 picks the space minimising the longer line (PoC `poc/pptx/tests.mjs` `ladder()`); step 3 borrows width from sibling columns down to `minW`.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/engine/layout`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/layout
git commit -m "Add (engine): text measurer interface, bidi runs and fit ladder"
```

---

### Task 7: Layout model and layoutReport

**Files:**
- Create: `src/engine/layout/types.ts`, `src/engine/layout/layoutReport.ts`
- Test: `src/engine/layout/layoutReport.test.ts`

**Interfaces:**
- Consumes: `ReportSpec`, `ThemeTokens` (Task 4); `ResolvedVisual`, `ResolvedValue` (Task 5); `TextMeasurer`, `fitText`, `fitTableHeaders`, `splitRuns` (Task 6).
- Produces:
  - `interface TextBox { kind: "text"; id: string; visualId: string; x: number; y: number; w: number; h: number; sizePx: number; weight: 400 | 700; color: string; lines: Run[][]; valueKeys: string[] }`
  - `interface TextCell { lines: Run[][]; sizePx: number; weight: 400 | 700; valueKey?: string }`
  - `interface TableBox { kind: "table"; id; visualId; x; y; colW: number[]; rowH: number; header: TextCell[]; rows: TextCell[][]; continued: boolean }`
  - `interface BarChartBox { kind: "bar"; id; visualId; x; y; w; h; categories: string[]; values: (number | null)[]; valueKeys: string[]; format: MeasureSpec["format"]; color: string }`
  - `interface RectBox { kind: "rect"; id; x; y; w; h; fill: string }`; `interface RuleBox { kind: "rule"; id; x; y; w; color: string }`
  - `type LayoutBox = TextBox | TableBox | BarChartBox | RectBox | RuleBox`
  - `interface LayoutSlide { index: number; pageId: string; title: string; boxes: LayoutBox[] }`
  - `interface LayoutDoc { width: 1920; height: 1080; slides: LayoutSlide[]; figures: { slide: number; boxId: string; valueKey: string; display: string }[]; fitErrors: EngineIssue[] }`
  - `gridToPx(frame: VisualSpec["frame"]): { x: number; y: number; w: number; h: number }` (cell = 1920/24 by 1080/14 px, rounded to whole px)
  - `layoutReport(spec: ReportSpec, resolved: ResolvedVisual[], theme: ThemeTokens, m: TextMeasurer): LayoutDoc`
- Box ids `s{slide}-{visualId}-{n}`; tones resolve to theme colours here, once.

- [ ] **Step 1: Write the failing tests**

```ts
it("lays out the fixture into 2 slides with every figure registered", () => {
  const doc = layoutFixture();
  expect(doc.slides).toHaveLength(2); expect(doc.fitErrors).toEqual([]);
  expect(doc.figures.every((f) => values.has(f.valueKey))).toBe(true);
});
it("{{measure:matchRate}} in text renders the resolved display", () => {});
it("gridToPx maps col 0..24 to 0..1920", () => { expect(gridToPx({ col: 0, row: 0, w: 24, h: 14, z: 0 })).toEqual({ x: 0, y: 0, w: 1920, h: 1080 }); });
it("a 40-row table paginates 15/15/10 with a repeated header and «(يتبع)» titles", () => {});
it("a text failing the ladder is in fitErrors with page, visual and fit.tooLong", () => {});
it("is deterministic", () => {});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/engine/layout/layoutReport.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** `gridToPx` and `layoutReport`; rows per page = `floor((tableAreaH - headerH) / rowH)`.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/engine/layout`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/layout
git commit -m "Add (engine): absolute layout model from resolved visuals"
```

---

### Task 8: Static HTML renderer

**Files:**
- Create: `src/engine/html/renderHtml.ts`
- Test: `src/engine/html/renderHtml.test.ts`

**Interfaces:**
- Consumes: `LayoutDoc`, `ThemeTokens`.
- Produces: `renderHtml(doc: LayoutDoc, theme: ThemeTokens, opts: { title: string }): string`. One `<section class="slide">` per slide at 1920x1080; every box `position:absolute` with px `left/top/width/height`; `dir="rtl"`, `lang="ar-SA"`; recorded lines joined with `<br>`; LTR runs in `<span dir="ltr">`; tables with fixed column widths; bar charts as inline SVG on the box's axis; font as inline `@font-face` when `theme.fontData` is set; `data-box` on every box and `data-value` on every figure; `@media print { @page { size: 1920px 1080px; margin: 0 } .slide { break-after: page } }`. Static: no `<script>`, no form controls, no external URL (decision 15).

- [ ] **Step 1: Write the failing tests**

```ts
const html = renderHtml(layoutFixture(), theme, { title: "تقرير" });
it("one section per slide", () => { expect(html.match(/class="slide"/g)).toHaveLength(2); });
it("is static: no script, no input, no external URL", () => { expect(html).not.toMatch(/<script|<input|<select|https?:\/\//); });
it("a 2-line box has exactly one <br>", () => {});
it("Latin tokens sit in <span dir=\"ltr\">", () => { expect(html).toContain('<span dir="ltr">70.00%</span>'); });
it("print CSS gives one page per slide", () => { expect(html).toContain("break-after: page"); });
it("escapes < and & in user text", () => {});
it("snapshot", () => { expect(html).toMatchSnapshot(); });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/engine/html`
Expected: FAIL.

- [ ] **Step 3: Implement** `renderHtml` as a string builder (no DOM).

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/engine/html`
Expected: PASS, snapshot written.

- [ ] **Step 5: Commit**

```bash
git add src/engine/html
git commit -m "Add (engine): static HTML renderer from the layout model"
```

---

### Task 9: PPTX writer and OOXML post-processing

**Files:**
- Create: `src/engine/pptx/units.ts`, `src/engine/pptx/writePptx.ts`, `src/engine/pptx/postprocess.ts`
- Modify: `package.json`, `package-lock.json` (move `pptxgenjs` to `dependencies`; add `jszip` to `dependencies` at the version pptxgenjs resolves)
- Test: `src/engine/pptx/units.test.ts`, `src/engine/pptx/postprocess.test.ts`, `src/engine/pptx/writePptx.test.ts`

**Interfaces:**
- Consumes: `LayoutDoc`, `ThemeTokens`, `Run`.
- Produces:
  - `EMU_PER_PX = 6350`; `emu(px: number): number`; `ptFromPx(px: number): number` (px x 0.5); `inFromPx(px: number): number` (px / 144)
  - `writePptx(doc: LayoutDoc, theme: ThemeTokens, opts: { title: string; issuedAt: string }): Promise<Uint8Array>` (returns the post-processed file)
  - `postprocessPptx(zip: Uint8Array, issuedAt: string): Promise<Uint8Array>`
- PoC techniques: one text box per `TextBox`, zero insets, shape name = box id; `wrap` off for 1-line boxes; multi-line boxes get `a:br` at each recorded break, width `w x FIT_SAFETY` capped at the frame, anchored on the right edge; line spacing as `a:lnSpc/a:spcPts`; LTR runs `lang="en-US"` plus `<a:rtl val="0"/>`, Arabic runs `lang="ar-SA"`. Real `a:tbl` with `a:gridCol = emu(colW)` in logical order, `a:tr h = emu(rowH)`, `a:tblPr rtl="1"`; table-cell margins passed so the XML shows 0 (pptxgenjs reads values under 1 as inches). Native clustered column chart with embedded workbook (`c:externalData`), `catAxisOrientation: "maxMin"`, label format `0.00"%"` or `#,##0`, cached values at display precision. KPI band as text boxes plus rule lines. Post-process: strip `charset` and `pitchFamily` from `a:latin/a:ea/a:cs/a:sym`; force `rtl="1" algn="r"` on every slide and chart paragraph; keep only the first `a:pPr` per paragraph (allowing whitespace after `<a:p>`, the chart-XML trap); rewrite master and layout `lvlNpPr` to `rtl="1" algn="r"`; zip entry dates and `docProps/core.xml` dates from `issuedAt`.

- [ ] **Step 1: Write the failing tests**

```ts
it("units", () => { expect(emu(64)).toBe(406400); expect(ptFromPx(44)).toBe(22); expect(inFromPx(144)).toBe(1); });
it("no charset or pitchFamily left", () => { expect(xml.all).not.toMatch(/charset=|pitchFamily=/); });
it("every paragraph rtl=1 algn=r and one a:pPr per paragraph", () => {});
it("number runs are en-US with rtl val=0", () => {});
it("table geometry exact in EMU with tblPr rtl=1", () => {});
it("chart has c:externalData and maxMin orientation", () => {});
it("master and layouts carry no rtl=\"0\" or algn=\"l\"", () => {});
it("a 2-line box has one a:br", () => {});
it("byte-identical across two calls", async () => { expect(sha(await build())).toBe(sha(await build())); });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/engine/pptx`
Expected: FAIL.

- [ ] **Step 3: Implement** units, writer and post-processor. Post-processing uses a small scoped XML tokenizer (shared later by Task 12's `readBack.ts`), not free regex over whole parts.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/engine/pptx && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/pptx package.json package-lock.json
git commit -m "Add (engine): PPTX writer with RTL and charset post-processing"
```

---

### Task 10: Formula to Excel translation

**Files:**
- Create: `src/engine/formula/toExcel.ts`
- Test: `src/engine/formula/toExcel.test.ts`

**Interfaces:**
- Consumes: `Expr`, `ALLOWED_FUNCTIONS` (Task 3); `FilterSpec` (Task 2).
- Produces:
  - `interface ExcelTarget { table: string; columnName: (columnId: string) => string; groupFilters: { columnId: string; value: string | number | boolean }[]; extraFilters: FilterSpec[] }`
  - `toExcelFormula(ast: Expr, target: ExcelTarget, measures: Map<string, Expr>): { ok: true; formula: string } | { ok: false; reason: string }`
- Mapping: `count(col)` to `COUNTIFS(tbl[col],"<>"&"", ...criteria)` (non-empty), `sum` to `SUMIFS`, `avg` to `AVERAGEIFS`, `min`/`max` to `MINIFS`/`MAXIFS`, `filter(agg, cond)` adds criteria pairs for `=`, `<>`, `<`, `<=`, `>`, `>=` combined with `and`; `or` and `distinctCount` return `ok: false` (Milestone 2 covers them through a pivot); `/` wraps as `IFERROR(a/b,"-")`; measure references inline; strings escaped by doubling quotes; group and page filters become criteria pairs. Structured references `tbl[اسم العمود]` keep the original Arabic header.

- [ ] **Step 1: Write the failing tests**

```ts
it("matchRate translates to COUNTIFS / COUNTIFS wrapped in IFERROR", () => {
  expect(toExcelFormula(matchRateAst, target, measures)).toEqual({ ok: true,
    formula: 'IFERROR(COUNTIFS(tblStudies[الحالة],"مطابق")/COUNTIFS(tblStudies[الحالة],"<>"),"-")' });
});
it("group filters add criteria pairs", () => {});
it("a string with a double quote is escaped", () => {});
it("distinctCount returns ok:false with a reason", () => {});
it("every engine-evaluated fixture measure that translates equals its formula evaluated by a tiny COUNTIFS/SUMIFS interpreter over the same rows", () => {});
```

The last test carries a test-only interpreter for the emitted subset, so the translation is checked against the engine's own value without Excel; COM checks stay manual.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/engine/formula/toExcel.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** `toExcelFormula`.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/engine/formula`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/formula
git commit -m "Add (engine): translate safe formulas to Excel formulas"
```

---

### Task 11: XLSX writer: raw section, processed section, tables, pivots and formulas

**Files:**
- Create: `src/engine/xlsx/planWorkbook.ts`, `src/engine/xlsx/writeXlsx.ts`, `src/engine/xlsx/ooxmlParts.ts`
- Test: `src/engine/xlsx/planWorkbook.test.ts`, `src/engine/xlsx/writeXlsx.test.ts`

**Interfaces:**
- Consumes: `RawFile` (Task 2); `ProcessedDataset`, `ResolvedValue` (Task 5); `toExcelFormula` (Task 10); `LayoutDoc.figures` (Task 7); `ReportSpec`, `ThemeTokens` (Task 4); `ENGINE_VERSION`.
- Produces:
  - `interface PivotSpec { name: string; sourceTable: string; rowField: string; dataField: string; agg: "count" | "sum" | "average"; feedsSlide: number; valueKeys: string[] }`
  - `interface WorkbookPlan { sheets: { name: string; kind: "index" | "separator" | "raw" | "step" | "processed" | "stats" | "source"; table?: string; pivots?: PivotSpec[] }[] }`
  - `planWorkbook(files: RawFile[], spec: ReportSpec, processed: Map<string, ProcessedDataset>, values: Map<string, ResolvedValue>, doc: LayoutDoc): WorkbookPlan`
  - `writeXlsx(plan: WorkbookPlan, input: { files: RawFile[]; spec: ReportSpec; processed; values; doc; theme }, opts: { title: string; issuedAt: string }): Promise<Uint8Array>`
  - `addTables(zip, tables)`, `addPivots(zip, pivots)`, `addSeparators(zip, names)`, `addStyles(zip, theme)` in `ooxmlParts.ts`
- Rules: order and separators as in Global Constraints; raw sheets named `{fileName} {sheetName}` cut to 31 chars and made unique with a numeric suffix, headers and cell values exactly as uploaded; one step sheet per step titled `خطوة {n} {label}` with in, removed and out counts and the rows after it; processed sets as Excel tables `tbl{DatasetId}` with frozen header and autofilter, a pivot to their left on screen; الإحصائيات holds a pivot per statistic group titled with its slide plus, for each translatable measure, the Excel formula from `toExcelFormula` beside the engine value; المصدر is `tblSource`, one row per `doc.figures` entry: slide, display, sheet, columns, filters, measure id, formula text, Excel formula, `ENGINE_VERSION`. Pivot caches `saveData="0" refreshOnLoad="1"`, no records part; custom table style `Deck3`; Somar as Normal font; `rightToLeft="1"`; zip and core dates from `issuedAt`.

- [ ] **Step 1: Write the failing tests**

```ts
it("sheet order follows M3 round 2", () => {
  expect(plan.sheets.map((s) => s.kind)).toEqual(["index","separator","raw","separator","step","step","separator","processed","separator","stats","separator","source"]);
  expect(plan.sheets.filter((s) => s.kind === "separator").map((s) => s.name)).toEqual(["|","||","|||","||||","|||||"]);
});
it("raw sheet keeps upload headers and every cell untouched, including the two type-error cells", async () => {});
it("step sheets show in - removed = out", () => {});
it("table and pivot parts match the plan counts; caches have saveData=0 refreshOnLoad=1", async () => {});
it("الإحصائيات carries the translated Excel formula for matchRate", async () => {});
it("المصدر has one row per layout figure and the engine version", () => {});
it("[Content_Types].xml declares every added part", () => {});
it("long or duplicate sheet names are made unique", () => {});
it("byte-identical across two calls", () => {});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/engine/xlsx`
Expected: FAIL.

- [ ] **Step 3: Implement**: SheetJS `aoa_to_sheet` and `XLSX.write({ type: "array", bookType: "xlsx" })` for cells and formulas (cell objects `{ f }`), then JSZip post-processing following `poc/xlsx/build.mjs` (`tableXml`, cache without records). Slicers, charts, logo and shape buttons wait for Milestone 2.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/engine/xlsx && npm run check:vendor`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/xlsx
git commit -m "Add (engine): XLSX writer with raw and processed sections, tables, pivots and formulas"
```

---

### Task 12: Gate runner and design lint

**Files:**
- Create: `src/engine/gates/readBack.ts`, `figureParity.ts`, `layoutParity.ts`, `reconcile.ts`, `ooxmlSelfCheck.ts`, `runGates.ts`, `src/engine/lint/designLint.ts`
- Test: one `*.test.ts` beside each

**Interfaces:**
- Consumes: Tasks 5, 7, 8, 9, 11 outputs.
- Produces:
  - `interface ReadBox { id: string; x: number; y: number; lines: number; text: string }`
  - `readPptxBoxes(pptx: Uint8Array): Promise<Map<number, ReadBox[]>>` (`a:off / 6350`, `a:br` count + 1, per text shape and table cell, keyed by shape name)
  - `readHtmlBoxes(html: string): Map<number, ReadBox[]>` (`data-box`, inline `left/top`, `<br>` count + 1)
  - `readXlsxSource(xlsx: Uint8Array): Promise<{ valueKey: string; display: string }[]>`
  - `checkFigureParity(doc: LayoutDoc, pptx: Map<number, ReadBox[]>, html: Map<number, ReadBox[]>, xlsxSource, values: Map<string, ResolvedValue>): EngineIssue[]` (tokens `\d[\d,]*(\.\d+)?%?`, commas removed; per-slide multisets equal across PPTX, HTML and layout figures; every figure equals its المصدر row and its resolved value)
  - `checkLayoutParity(html, pptx, tolerancePx = 2): EngineIssue[]`
  - `lintText(s: string): { rule: "T3" | "T6"; index: number }[]`; `lintLayout(doc: LayoutDoc): { errors: EngineIssue[]; warnings: EngineIssue[] }` (F2 fit errors, F4, T3, T6 as errors; R3 as warning)
  - `checkReconciliation(processed: Map<string, ProcessedDataset>, xlsxSteps: { datasetId: string; inCount: number; removed: number; outCount: number }[]): EngineIssue[]`
  - `checkOoxml(pptx: Uint8Array, xlsx: Uint8Array, doc: LayoutDoc, plan: WorkbookPlan): Promise<EngineIssue[]>` (both zips re-open; every XML part tokenizes; slide, `a:tbl`, chart with `c:externalData`, `p:pic`, xlsx table and pivot counts equal what layout and plan declare; zero Arabic-Indic digits)
  - `interface GateReport { passed: boolean; issues: EngineIssue[]; warnings: EngineIssue[]; counts: Record<string, number> }`
  - `runGates(input: { doc; html; pptx; xlsx; plan; processed; values }): Promise<GateReport>` (runs every gate, never short-circuits)

- [ ] **Step 1: Write the failing tests**

```ts
it("figure parity passes on the fixture and fails when one PPTX number is edited", async () => {});
it("layout parity flags a 3px move and an extra a:br, accepts 2px", () => {});
it.each(["عنوان — فرعي", "نتيجة – جيدة", "تم ✅", "تحذير ⚠", "سهم →"])("lint fails %s", (s) => { expect(lintText(s).length).toBeGreaterThan(0); });
it("lint passes plain hyphen, colon and Latin digits", () => { expect(lintText("نسبة: 85.5% - جدة")).toEqual([]); });
it("reconciliation fails when a step's removed count is off by one", () => {});
it("ooxml self-check fails when a table part is deleted from the xlsx zip (silent-drop trap)", () => {});
it("ooxml self-check fails on an Arabic-Indic digit in a slide", () => {});
it("runGates reports every failing gate", () => {});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/engine/gates src/engine/lint`
Expected: FAIL.

- [ ] **Step 3: Implement** the read-backs and gates on the shared tokenizer (no DOMParser in node, no new dependency).

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/engine/gates src/engine/lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/gates src/engine/lint
git commit -m "Add (engine): release gates and design lint"
```

---

### Task 13: Recipe file

**Files:**
- Create: `src/engine/recipe/recipe.ts`
- Test: `src/engine/recipe/recipe.test.ts`

**Interfaces:**
- Consumes: `RawFile`, `ColumnProfile` (Task 2); `ReportSpec`, `IssueParams` (Task 4); `ProcessedDataset` (Task 5); `ENGINE_VERSION`.
- Produces:
  - `interface Recipe { recipeVersion: 1; engineVersion: string; issuedAt: string; sources: { fileName: string; sha256: string; sheets: { sheetName: string; headers: string[]; rowCount: number }[] }[]; columns: Record<string, ColumnDecl[]>; profiles: Record<string, ColumnProfile[]>; steps: Record<string, ProcessingStep[]>; measures: MeasureSpec[]; spec: ReportSpec; params: Omit<IssueParams, "messages"> }`
  - `buildRecipe(input: { files: RawFile[]; spec: ReportSpec; params: IssueParams; profiles: Map<string, ColumnProfile[]> }): string` (canonical JSON: keys sorted, 2-space indent, `\n` line ends; holds no row data, decision 12)
  - `validateRecipe(text: string): { ok: true; recipe: Recipe } | { ok: false; issues: EngineIssue[] }`
  - `checkSources(recipe: Recipe, files: RawFile[]): EngineIssue[]` (missing file or hash mismatch gives `recipe.hashMismatch` naming the file)

- [ ] **Step 1: Write the failing tests**

```ts
it("recipe holds names, hashes, column types, steps, measures, spec, params and engine version", () => {
  const r = JSON.parse(buildRecipe(input));
  expect(r).toMatchObject({ recipeVersion: 1, engineVersion: ENGINE_VERSION, params: { issuedAt: input.params.issuedAt } });
  expect(r.sources[0]).toMatchObject({ fileName: "studies.xlsx", sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
});
it("holds no row data", () => { expect(buildRecipe(input)).not.toContain(fixtureOnlyCellValue); });
it("is canonical: the same input gives the same string", () => {});
it("validateRecipe rejects malformed JSON and a wrong recipeVersion with a path", () => {});
it("checkSources flags a changed hash with the file name", () => {});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/engine/recipe`
Expected: FAIL.

- [ ] **Step 3: Implement** `buildRecipe`, `validateRecipe` (reuses `validateSpec` for the embedded spec) and `checkSources`.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/engine/recipe`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/recipe
git commit -m "Add (engine): report recipe file"
```

---

### Task 14: issueReport(), re-issue from recipe and the walking skeleton

**Files:**
- Create: `src/engine/issue/issueReport.ts`
- Modify: `src/engine/index.ts` (export `issueReport`, `reissueFromRecipe`, public types)
- Modify: `docs/edit logs/2026-11-05.md` (via `npm run editlog`)
- Test: `src/engine/issue/issueReport.test.ts`, `src/engine/issue/walkingSkeleton.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `interface IssueOutput { html: string; pdfPrintable: string; pptx: Uint8Array; xlsx: Uint8Array; recipe: string; lintReport: { errors: EngineIssue[]; warnings: EngineIssue[] }; parityReport: GateReport }`
  - `type IssueResult = { ok: true; files: IssueOutput } | { ok: false; issues: EngineIssue[]; message: string }`
  - `interface IssueEnv { theme: ThemeTokens; measurer: TextMeasurer; pack?: DomainPack; now?: () => number }`
  - `issueReport(spec: ReportSpec, files: RawFile[], params: IssueParams, env: IssueEnv): Promise<IssueResult>`
  - `reissueFromRecipe(recipeText: string, files: RawFile[], env: IssueEnv): Promise<IssueResult>` (`validateRecipe`, `checkSources`, then `issueReport(recipe.spec, files, recipe.params, env)`)
- Order (M11): `validateSpec`, `typeDataset` + `profileColumns`, `applySteps`, `resolveVisuals`, `planWorkbook` + `writeXlsx`, `layoutReport`, `renderHtml`, `writePptx`, `runGates`, `buildRecipe`. `pdfPrintable` is the HTML string. Any issue, fit error, throw or failed gate returns `ok: false` with no files and `message = formatIssue(issues[0], params.messages)`. Elapsed time is checked between stages against `LIMITS.issueTimeBudgetMs` using `env.now` (default `performance.now`) and never enters any output. The spec's sketch passes `packId`; the core takes the optional `DomainPack` in `env` because it never reads host storage. Note this in the edit log.

- [ ] **Step 1: Write the failing tests**

```ts
// walkingSkeleton.test.ts
it("issues the two-slide fixture in all five outputs with every gate passing", async () => {
  const f = twoSlideFixture();
  const r = await issueReport(f.spec, f.files, f.params, { theme: f.theme, measurer: createFixedAdvanceMeasurer() });
  expect(r.ok).toBe(true); if (!r.ok) return;
  expect(r.files.pdfPrintable).toBe(r.files.html);
  expect(r.files.pptx.byteLength).toBeGreaterThan(0); expect(r.files.xlsx.byteLength).toBeGreaterThan(0);
  expect(validateRecipe(r.files.recipe).ok).toBe(true);
  expect(r.files.parityReport).toMatchObject({ passed: true, counts: { slides: 2, pptxTables: 1, pptxCharts: 1, xlsxTables: 1 } });
  expect(r.files.lintReport.errors).toEqual([]);
});
it("is byte-identical across two issues", async () => {});
it("re-issuing from the recipe plus the same raw files gives byte-identical outputs", async () => {
  const a = await issueOk(f);
  const b = await reissueFromRecipe(a.recipe, f.files, env);
  expect(b.ok).toBe(true); if (!b.ok) return;
  expect(sha(b.files.pptx)).toBe(sha(a.pptx)); expect(sha(b.files.xlsx)).toBe(sha(a.xlsx));
  expect(b.files.html).toBe(a.html); expect(b.files.recipe).toBe(a.recipe);
});
it("re-issue with a changed raw file is refused with recipe.hashMismatch and no files", async () => {});
// issueReport.test.ts: all or nothing
it.each([
  ["unknown measure", "measure.unknown"], ["hostile formula", "formula.notAllowed"],
  ["a measure over a column with type errors", "type.errors"], ["long dash in a title", "gate.lint"],
  ["text that cannot fit", "fit.tooLong"], ["a step that miscounts (test seam)", "gate.reconcile"],
  ["time budget exceeded (env.now jumps)", "limit.time"], ["writer throws", "gate.ooxml"],
])("%s returns ok:false with no files and one Arabic message", async (_n, rule) => {
  const r = await issueWith(mutation);
  expect(r.ok).toBe(false); expect(r).not.toHaveProperty("files");
  expect(r.issues[0].rule).toBe(rule); expect(r.message).not.toMatch(/[–—]/);
});
it("an empty dataset issues '-' for ratios and 0 for counts and passes gates", async () => {});
it("a one-row dataset issues and passes gates", async () => {});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/engine/issue`
Expected: FAIL.

- [ ] **Step 3: Implement** `issueReport` and `reissueFromRecipe` with one `try/catch` that turns any throw into `ok: false` (`gate.ooxml` for writer stages, `schema.invalid` otherwise, stage name in `detail`).

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
Expected: each exits 0. If the app does not import the engine yet, the bundle is unchanged; say so in the edit log rather than claiming a measured cost.

- [ ] **Step 5: Write the edit-log entry, then check:release**

Run: `npm run editlog -- --tier=3 --append --sync-package "Add (engine): report engine core pipeline, recipe and release gates"`
Write `Why:`, `What changed:`, migration (none: no workspace format change, the engine writes no host files) and rollback (delete `src/engine/`, revert the `package.json` dependency move). Then `npm run check:release`; expected exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/engine package.json package-lock.json "docs/edit logs/2026-11-05.md"
git commit -m "Add (engine): issueReport, re-issue from recipe and walking skeleton"
```

---

## Self-review notes

- Coverage for Milestone 1: decision 9 (PPTX and formulas in scope: Tasks 3, 9, 10), 10 (Task 3), 11 (Tasks 2, 5), 12 (Task 13, Task 14 re-issue test), 13 (Task 1 actions, boundary grep), 14 (Task 1 provisional limits; measurement in Milestone 3), 15 (Task 8), 16 (Tasks 3, 5); M1 and M11 order (Task 14); M2 (Tasks 7, 9, 12); M3 and M12 (Tasks 5, 11, 12); M4 (Task 9); M5 (Tasks 6, 8, 9); M6 (Tasks 4, 5, 12); M7 (Tasks 6, 7); M8 (Task 12); M13 (Tasks 1, 2, 3, 12, 14). Later milestones by design: M10 font shipping, M14 catalog, slicers and workbook charts and buttons, bookmarks, relationships, time intelligence, the user door, host action gating.
- Milestone 1 stays at 14 tasks, the stated ceiling, so neither the formula-to-Excel translation (Task 10) nor the column profile (Task 2) was moved. Task 10 deliberately covers only the COUNTIFS/SUMIFS subset; `distinctCount` and `or` fall back to pivots in Milestone 2.
- Interface names checked across tasks: `ResolvedValue.valueKey`-style keys are `key` on `ResolvedValue` and `valueKey` on layout figures and boxes; `FilterSpec` and `ProcessingStep` are defined once in Task 2; `MeasureSpec` once in Task 4.
- Real Office verification (PowerPoint and Excel COM, as in the PoC) stays a manual release check until Milestone 3.
