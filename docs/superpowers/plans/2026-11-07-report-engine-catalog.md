# Report Engine Catalog and Slide Picks Implementation Plan (Milestone 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A numbered catalog of deck3-themed slide designs. Each design can be previewed in a static HTML lookbook with demo or real data. A department replies with slide numbers, and the engine issues a report with exactly those designs in that order, in all six output files, through every gate.

**Architecture:** The catalog is engine-owned data in `src/engine/catalog/`. Each design is a page template whose wells and text point at named slots instead of fields. The admin binds each slot of each picked design to a field or measure. `buildSpecFromPicks` turns picks plus bindings into an ordinary `ReportSpec`, so issuing goes through the existing `issueReport` unchanged. The lookbook renders each active design through the existing layout and `renderHtml` path with a demo dataset.

**Tech Stack:** TypeScript (strict, `erasableSyntaxOnly`), Vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-01-report-engine-design.md`: §0 decisions 3 and 5, §0.1 M14, M15 and M16, and §4.9 (design rules and the catalog entry rule). Builds on `docs/superpowers/plans/2026-11-05-report-engine-core.md` (Milestone 1, PR #233) and its rulings file.

## Dependency on Milestone 2

Milestone 1 ships four visual types: `text`, `kpiBand`, `table` and `barChart`. Nine deck3 slide kinds can be expressed with those, and this plan builds them as designs 1 to 9. Eight more deck3 kinds need visuals that only Milestone 2 adds: grouped bars, the quality matrix, the observations table, the timeline line chart, and the logo and org block. They get numbers 10 to 17 now, with status `planned`. Picking a planned number is refused with a clear message. Each one becomes `active` in the Milestone 2 task that adds its visual, using this plan's Task 5 pattern. The total is 17, inside the owner's 15 to 20 (decision 3).

If the owner prefers to wait and ship the catalog only after Milestone 2, Tasks 1 to 4 and 7 to 8 still stand unchanged. Only the split between Tasks 5 and 6 changes.

## Global Constraints

- Numbers are stable forever. A number is never reused, renumbered or deleted. A retired design keeps its number and is refused with a clear message (M14).
- Picks are issued in the order given, in all four formats (HTML, PDF, PPTX, Excel) plus the companion and the recipe, through every gate (M14, M13 all or nothing).
- The output uses Latin digits only. Picks input also accepts Arabic-Indic digits and the Arabic comma «،», and normalizes them on input.
- No long dash and no emoji or decorative symbol anywhere, including design names, demo text and the lookbook (T3, T6).
- Human Arabic names only for designs and slots. Never show «خطوة N», an id or a code to a user (M15).
- Demo data is labelled «بيانات توضيحية» inside every lookbook slide (F3). Demo figures never reach an issued report.
- A design enters the catalog (status `active`) only with zero Floor findings and zero Reflex warnings without a written reason in its manifest (§4.9).
- No AI at issue time. Picks plus bindings produce the report deterministically (M16).
- The engine imports nothing from app code (`boundary.test.ts`). The catalog never reads or writes host storage (decision 12).
- Every design is seeded from a real deck3 slide kind. deck3's look stays as it is (§4.9 preamble).
- New user-facing strings go in `src/engine/messages.ts` as keys.

## Review Focus

1. **Repeated numbers in picks** ("4, 4, 5"). The owner's example has none, and a repeat is more likely a typo than intent. Refuse it with the repeated number named. Pinned in Task 2.
2. **Empty-looking picks** (blank lines, a trailing comma, spaces around numbers, «٤، ٥»). Expect a parse that ignores blanks and normalizes digits, not a refusal. Pinned in Task 2.
3. **A slot bound to a field the dataset lacks, or bound to the wrong kind** (a measure slot given a dimension). Expect a refusal before layout that names the design number and the slot's Arabic name. Pinned in Task 3.
4. **A table design picked with 40 rows of real data.** Expect «(يتبع)» pagination inside that pick's position, with the next pick starting after the continuation pages. Pinned in Task 8.
5. **A design edited after its number was published** (a slot renamed or removed). Expect the number lock test to fail, so a department's old picks never silently bind to a different shape. Pinned in Task 1.

---

## File Structure

```
src/engine/catalog/
  types.ts           CatalogDesign, SlotDecl, SlotRef, CatalogVisual, DesignStatus
  registry.ts        CATALOG array, getDesign(), activeDesigns()
  numbers.lock.json  number to { nameAr, slotIds }, append-only
  registry.test.ts   uniqueness, lock, status refusals
  picks.ts           parsePicksText(), parsePicksSheet()
  picks.test.ts
  bind.ts            buildSpecFromPicks()
  bind.test.ts
  designs/
    d01-section.ts ... d09-glossary.ts   one file per design
    planned.ts       designs 10 to 17, status planned
    demo.ts          shared demo dataset builder, «بيانات توضيحية»
  designs.test.ts    every active design passes the catalog entry gate
  lookbook.ts        renderLookbook()
  lookbook.test.ts
  issueFromPicks.ts  issueFromPicks()
  issueFromPicks.test.ts
src/engine/lint/designLint.ts   Modify: add F5, R1, R2, R8, R9 and the overrule mechanism
src/engine/messages.ts          Modify: catalog message keys
src/engine/index.ts             Modify: export the catalog API
```

---

### Task 1: Catalog types, registry and number lock

**Files:**
- Create: `src/engine/catalog/types.ts`, `registry.ts`, `numbers.lock.json`, `registry.test.ts`
- Modify: `src/engine/messages.ts`

**Interfaces:**
- Consumes: `PageSpec`, `VisualSpec`, `WellRole`, `Tone` from `spec/types.ts`; `EngineIssue` from `errors.ts`.
- Produces:
  - `type DesignStatus = "active" | "planned" | "retired"`
  - `interface SlotDecl { id: string; nameAr: string; kind: "dimension" | "measure" | "text"; required: boolean }`
  - `type SlotRef = { slot: string }`
  - `type CatalogVisual = Omit<VisualSpec, "wells" | "text"> & { wells: Partial<Record<WellRole, SlotRef[]>>; text?: string }` (text may hold `{{slot:<id>}}`, resolved by Task 3)
  - `interface CatalogDesign { number: number; nameAr: string; descriptionAr: string; deck3Source: string; status: DesignStatus; retiredReasonAr?: string; slots: SlotDecl[]; page: { grid: PageSpec["grid"]; visuals: CatalogVisual[] }; overrules?: { rule: string; reasonAr: string }[] }`
  - `const CATALOG: readonly CatalogDesign[]`
  - `getDesign(n: number, catalog?: readonly CatalogDesign[]): { ok: true; design: CatalogDesign } | { ok: false; issue: EngineIssue }`
  - `activeDesigns(catalog?): CatalogDesign[]` (sorted by number)
  - message keys `catalogUnknownNumber`, `catalogPlanned`, `catalogRetired`

- [ ] **Step 1: Write the failing tests** in `registry.test.ts`:
  - `numbers are unique positive integers`: `new Set(CATALOG.map(d => d.number)).size === CATALOG.length` and every number is an integer of at least 1.
  - `lock is append-only and matches`: for every entry in `numbers.lock.json`, a design with that number exists, with the same `nameAr` and the same sorted slot ids. Every design's number is in the lock.
  - `unknown number refused`: `getDesign(999)` returns `ok:false` with key `catalogUnknownNumber`, and the message contains `999`.
  - `planned and retired refused`: with an injected test catalog, `getDesign` returns `catalogPlanned` for a planned entry and `catalogRetired` for a retired one, and the retired message includes `retiredReasonAr`.
  - `names are human Arabic`: no design or slot `nameAr` matches `/خطوة\s*\d|[A-Za-z_]{3,}|\d/` (M15), and `lintText` returns nothing for each.
- [ ] **Step 2: Run** `npx vitest run src/engine/catalog/registry.test.ts`. Expected: FAIL, because the module is missing.
- [ ] **Step 3: Implement** the types and the registry. `CATALOG` starts as an empty array and the lock starts as `{}`. Add the three message keys in Arabic, for example «رقم التصميم {n} غير موجود في الكتالوج».
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** with `Add (engine): catalog types, registry and number lock`.

Lock rule, stated in a comment in `registry.ts`: the lock is edited only to add an entry. Changing a slot of a published number means retiring it and adding a new number.

### Task 2: Picks parsing

**Files:**
- Create: `src/engine/catalog/picks.ts`, `picks.test.ts`
- Modify: `src/engine/messages.ts`

**Interfaces:**
- Consumes: `getDesign` (Task 1), `RawSheet`, `LIMITS`.
- Produces:
  - `type PicksResult = { ok: true; numbers: number[] } | { ok: false; issues: EngineIssue[] }`
  - `parsePicksText(text: string, catalog?: readonly CatalogDesign[]): PicksResult`
  - `parsePicksSheet(sheet: RawSheet, catalog?): PicksResult` (reads the first column of `rows`; `headers` is already separate)
  - message keys `picksEmpty`, `picksNotNumber`, `picksRepeated`, `picksTooMany`

- [ ] **Step 1: Write the failing tests:**
  - `"1, 4, 5, 6, 10"` returns `[1,4,5,6,10]` when all of them are active (inject a catalog).
  - `"٤، ٥\n\n 6 ,"` returns `[4,5,6]`. Arabic-Indic digits and «،» are normalized, and blanks and a trailing separator are ignored.
  - Separators accepted: comma, «،», semicolon, whitespace and newline.
  - `"4, 4, 5"` returns `picksRepeated`, and the message contains `4`.
  - `"4, ب"` returns `picksNotNumber` and quotes `ب`.
  - `""` and `" , "` return `picksEmpty`.
  - A planned number returns `catalogPlanned`. Every refused number is reported in one result, not only the first.
  - More than `LIMITS.maxSlides` numbers returns `picksTooMany`.
  - `parsePicksSheet` on the header «رقم التصميم» with rows `[[1],[4],[null],["5"]]` returns `[1,4,5]`.
- [ ] **Step 2: Run** `npx vitest run src/engine/catalog/picks.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** both functions. Normalize digits with the Arabic-Indic ranges already in `src/engine/text.ts`; don't redeclare them.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** with `Add (engine): parse department slide picks`.

### Task 3: Slot binding to a ReportSpec

**Files:**
- Create: `src/engine/catalog/bind.ts`, `bind.test.ts`
- Modify: `src/engine/messages.ts`

**Interfaces:**
- Consumes: `CatalogDesign`, `getDesign` (Task 1); `ReportSpec`, `PageSpec`, `VisualSpec`, `FilterSpec`, `DatasetDef`; `validateSpec`.
- Produces:
  - `type SlotBinding = { field: string } | { measure: string } | { text: string }`
  - `interface PickBinding { number: number; title: string; slots: Record<string, SlotBinding>; filters?: FilterSpec[] }`
  - `interface PicksBase { reportId: string; title: string; datasets: DatasetDef[]; model: ReportSpec["model"]; params: ReportSpec["params"]; filters?: FilterSpec[] }`
  - `buildSpecFromPicks(numbers: number[], bindings: PickBinding[], base: PicksBase, catalog?): { ok: true; spec: ReportSpec } | { ok: false; issues: EngineIssue[] }`
  - message keys `bindMissingSlot`, `bindWrongKind`, `bindMissingPick`, `bindTitleNoFigure`

- [ ] **Step 1: Write the failing tests:**
  - The order is kept: numbers `[5,1]` give `spec.pages[0].pageId === "p1-d5"` and `pages[1].pageId === "p2-d1"`.
  - `{slot}` well items are replaced by the bound `{field}` or `{measure}`, and `{{slot:x}}` in text is replaced by the bound text, or by `{{measure:<id>}}` for a measure binding.
  - A required slot that is unbound returns `bindMissingSlot`, naming the design number and the slot's `nameAr`, never its id.
  - A `measure` slot bound to `{field}` returns `bindWrongKind`.
  - A field missing from the dataset is refused, by passing the result through `validateSpec`; the test asserts `ok:false`.
  - A number with no `PickBinding` returns `bindMissingPick`.
  - `title` must contain at least one `{{measure:` placeholder (R8, the title states the finding); otherwise `bindTitleNoFigure`. A design whose `overrules` include R8 is exempt.
  - The returned spec passes `validateSpec` with no errors for a valid binding.
- [ ] **Step 2: Run** `npx vitest run src/engine/catalog/bind.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Page ids are `p{index+1}-d{number}`. The grid comes from the design and `size` is `"16:9"`. Collect every issue across all picks before returning.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** with `Add (engine): bind picked designs to a report spec`.

### Task 4: Catalog entry lint (F5, R1, R2, R8, R9, overrules)

**Files:**
- Modify: `src/engine/lint/designLint.ts`, `src/engine/lint/designLint.test.ts`

**Interfaces:**
- Consumes: `LayoutDoc`, `ThemeTokens`.
- Produces:
  - `lintLayout(doc, theme, opts?: { overrules?: { rule: string; reasonAr: string }[] })`. It returns `{ errors; warnings; overruled: EngineIssue[] }`, so existing callers keep working. The new findings use rule ids `F5` (error) and `R1`, `R2`, `R8`, `R9` (warnings). A warning whose rule appears in `overrules` with a non-empty `reasonAr` moves to `overruled`.
  - `catalogEntryGate(doc, theme, overrules?): { ok: boolean; issues: EngineIssue[] }`. It passes only when there are zero errors and zero warnings left.

Rule checks on the layout model:
- F5: a bar or KPI box whose tone is `good` or `bad` must carry a visible text label inside it or in an adjacent box (its value label, or a legend text). Colour alone fails. F5 is Floor, so it can't be overruled.
- R1: a text box sitting above a slide's title box and smaller than the title, on more than one slide.
- R2: Latin text that is all capitals and longer than 3 characters.
- R8: a title text box containing no figure (reuse the figure tokens in `text.ts`).
- R9: two or more charts or tables on one slide, with no box at least 1.5 times the area of every other one.

- [ ] **Step 1: Write the failing tests:**
  - one passing and one failing layout fixture per rule;
  - an overrule with a reason moves R9 into `overruled`;
  - an overrule with an empty reason does not;
  - an overrule naming F5 has no effect.
- [ ] **Step 2: Run** `npx vitest run src/engine/lint/designLint.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** the rules and the gate.
- [ ] **Step 4: Run** the lint tests and then `npx vitest run src/engine`. Expected: all PASS. The existing fixtures must not gain errors. Gaining warnings is fine, because issue-time lint warnings don't block.
- [ ] **Step 5: Commit** with `Add (engine): catalog entry lint rules and overrules`.

### Task 5: Demo data and designs 1 to 5

**Files:**
- Create: `src/engine/catalog/designs/demo.ts`, `d01-section.ts`, `d02-kpi.ts`, `d03-bars.ts`, `d04-table.ts`, `d05-kpi-bars.ts`, `src/engine/catalog/designs.test.ts`
- Modify: `registry.ts`, `numbers.lock.json`

**Interfaces:**
- Consumes: Tasks 1, 3 and 4; `issueReport` and the layout stage it runs.
- Produces:
  - `demoInputs(design: CatalogDesign): { base: PicksBase; binding: PickBinding; files: RawFile[] }`. A small demo dataset of 12 rows (port, month, count, matched). Every demo slide carries a text box reading «بيانات توضيحية».
  - `renderDesignDemo(design, env: IssueEnv): LayoutDoc`, shared by the gate test and the lookbook.

Designs. Each is seeded from a named deck3 builder in `src/data/reporting/executive/deck3/slideKit.ts` or `chartKit.ts`, recorded in `deck3Source`.

| # | nameAr | deck3Source | Visuals |
|---|--------|-------------|---------|
| 1 | فاصل قسم | `sectionDivider` | text title, text subtitle |
| 2 | شريط المؤشرات | `kpiBand` | title, kpiBand of 3 to 4 measures |
| 3 | مقارنة بالأعمدة | `barChart` | title, barChart (axis, values) |
| 4 | جدول تفصيلي | `dataTable` | title, table (rows, values), paginates |
| 5 | مؤشرات مع مخطط | `kpiBand` + `barChart` | title, kpiBand on top, barChart as the focal element |

Design 1's title has no figure, so it overrules R8 with the reason «فاصل القسم يعلن اسم القسم ولا يحمل رقمًا».

- [ ] **Step 1: Write the failing tests:**
  - `every active design passes the catalog entry gate`: for each `activeDesigns()` entry, `catalogEntryGate(renderDesignDemo(d), theme, d.overrules).ok === true`, and the rendered text contains «بيانات توضيحية».
  - `every active design issues end to end with demo data`: `issueReport` of `buildSpecFromPicks([d.number], ...)` returns `ok:true`.
- [ ] **Step 2: Run** `npx vitest run src/engine/catalog/designs.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the five designs, register them as `active`, and add them to the lock.
- [ ] **Step 4: Run** the same command plus `registry.test.ts`. Expected: PASS.
- [ ] **Step 5: Visual check, then commit.** Write each design's demo HTML to the scratchpad and open it beside the deck3 slide it came from. Record any look drift. A fresh-context reviewer checks R4 to R7 and K1 to K4 by hand. Commit with `Add (engine): catalog designs 1 to 5 from deck3`.

### Task 6: Designs 6 to 9 and planned 10 to 17

**Files:**
- Create: `designs/d06-bars-note.ts`, `d07-top-ranked.ts`, `d08-kpi-table.ts`, `d09-glossary.ts`, `designs/planned.ts`
- Modify: `registry.ts`, `numbers.lock.json`

| # | nameAr | deck3Source | Status |
|---|--------|-------------|--------|
| 6 | مخطط مع ملاحظة | `barChart` + `tintedPanel` | active |
| 7 | الأعلى ترتيبًا | `barChart` with topN and «أخرى» | active |
| 8 | مؤشرات مع جدول | `kpiBand` + `dataTable` | active |
| 9 | تعريفات المصطلحات | `glossarySlide` (term and definition table) | active |
| 10 | الغلاف | `coverSlide` (needs the logo) | planned |
| 11 | المحتويات | `contentsSlide` | planned |
| 12 | أعمدة مجمعة | `groupedBarChart` | planned |
| 13 | مصفوفة الجودة | `qualityMatrix`, `matrixGrid` | planned |
| 14 | جدول الملاحظات | `observationsTable` | planned |
| 15 | تعريف المستوى | `levelDefinitionSlide` | planned |
| 16 | الاتجاه الشهري | line chart (new in Milestone 2) | planned |
| 17 | الختام وبيانات الجهة | `closingSlide`, `orgBlockHtml` | planned |

Planned entries carry `nameAr`, `descriptionAr`, `deck3Source` and their final `slots`, so the lock freezes them now, plus an empty `page.visuals`. Design 17 is deck3's org-block closing, not a filler slide (R7). Design 9 holds definitions rather than figures, so it overrules R8 with the reason «شريحة تعريفات لا تحمل أرقامًا».

- [ ] **Step 1: Extend the tests:**
  - The `designs.test.ts` gate now covers 9 active designs.
  - `registry.test.ts` asserts that numbers 10 to 17 are `planned` and that their slot ids are in the lock.
- [ ] **Step 2: Run** `npx vitest run src/engine/catalog`. Expected: FAIL.
- [ ] **Step 3: Implement** designs 6 to 9 and `planned.ts`, and extend the lock.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Visual check, then commit.** Do the same check as in Task 5, then commit with `Add (engine): catalog designs 6 to 9, numbers 10 to 17 reserved`.

### Task 7: Lookbook

**Files:**
- Create: `src/engine/catalog/lookbook.ts`, `lookbook.test.ts`

**Interfaces:**
- Consumes: `activeDesigns`, `renderDesignDemo` (Task 5), `renderHtml`, `themeIssues`, `buildSpecFromPicks`.
- Produces: `renderLookbook(env: IssueEnv, opts?: { preview?: { numbers: number[]; bindings: PickBinding[]; base: PicksBase; files: RawFile[] } }): { ok: true; html: string } | { ok: false; issues: EngineIssue[] }`

The lookbook is a static HTML file with no script (decision 16). It shows one section per active design, in number order. Each section has:
- a large Latin number;
- the `nameAr` and `descriptionAr`;
- the slot names the admin will ask for («يحتاج: المنفذ، عدد الصور، نسبة المطابقة»);
- the slide itself, scaled.

Planned designs are listed at the end under «قيد الإعداد», with name and number but no slide. The last line tells the department how to reply: «أرسلوا أرقام الشرائح المطلوبة بالترتيب، مثال: 1، 4، 5».

With `preview`, the bound designs render with the real files instead of demo data. The «بيانات توضيحية» label is dropped only in that mode.

- [ ] **Step 1: Write the failing tests:**
  - The demo lookbook contains `data-design-number="1"` through `"9"` in order.
  - It contains «بيانات توضيحية» 9 times and «قيد الإعداد» once.
  - It contains no `<script`, and `lintOutputText` returns nothing.
  - Preview mode with real fixture files has no «بيانات توضيحية» for the bound numbers, and its `data-value-key` figures match an `issueReport` of the same picks.
  - An invalid preview binding returns `ok:false` with Task 3's issues.
- [ ] **Step 2: Run** `npx vitest run src/engine/catalog/lookbook.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `renderLookbook`. Reuse `renderHtml`'s slide markup and wrap each slide in a section, rather than writing a second renderer.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Check and commit.** Open the lookbook in the built-in browser at phone and desktop widths, then commit with `Add (engine): catalog lookbook`.

### Task 8: Issue from picks, end to end

**Files:**
- Create: `src/engine/catalog/issueFromPicks.ts`, `issueFromPicks.test.ts`
- Modify: `src/engine/index.ts`, the dated edit log (through `npm run editlog`), `package.json`

**Interfaces:**
- Consumes: `parsePicksText`, `parsePicksSheet`, `buildSpecFromPicks`, `issueReport`.
- Produces:
  - `issueFromPicks(picks: string | RawSheet, bindings: PickBinding[], base: PicksBase, files: RawFile[], params: IssueParams, env: IssueEnv): Promise<IssueResult>`
  - index exports: `CATALOG`, `activeDesigns`, `getDesign`, `parsePicksText`, `parsePicksSheet`, `buildSpecFromPicks`, `renderLookbook`, `issueFromPicks` and their types.

The recipe stores the resulting `ReportSpec`, and that is enough for `reissueFromRecipe`. Don't bump the recipe schema in this milestone.

- [ ] **Step 1: Write the failing tests:**
  - Picks `"1، 4، 5، 6"` with fixture files return `ok:true`. The HTML slide order, the PPTX slide order and the order of the workbook's statistics sections all follow 1, 4, 5, 6.
  - Design 4 bound to a 40-row table paginates with «(يتبع)», and design 5 starts on the slide after the last continuation (Review Focus 4).
  - A refused pick returns `ok:false` and produces no files (M13).
  - `reissueFromRecipe` of the result reproduces byte-identical files.
  - «بيانات توضيحية» is absent from the HTML, the unzipped PPTX XML and the unzipped XLSX XML (F3).
- [ ] **Step 2: Run** `npx vitest run src/engine/catalog/issueFromPicks.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** it as a thin composition that only threads the issues through.
- [ ] **Step 4: Run the tier-3 gates.** Run `npm run lint`, `npm run typecheck`, `npm run test:run`, `npm run check:complexity`, `npm run check:hex-literals`, `npm run check:release`, `npm run check:vendor`, `npm run build` and `npm run check:bundle-size`. Expected: all pass.
- [ ] **Step 5: Real-application check and edit log.**
  - Write the outputs for picks 1, 4, 5, 6 to the scratchpad.
  - Open the PPTX in PowerPoint and both workbooks in Excel through COM, as Milestone 1 did, and record the result.
  - Run `npm run editlog -- --tier=3 --append --sync-package "Add (engine): catalog and slide picks"`, write the prose, and commit.

---

## Self-review notes

- **Spec coverage:**
  - Decision 3 (15 to 20 designs from deck3, stable numbers): Tasks 1, 5 and 6, with 17 numbered.
  - Decision 5 (departments pick, an admin maps): Tasks 2 and 3.
  - M14:
    - typed picks: Task 2;
    - imported picks file: `parsePicksSheet`, Task 2;
    - issued in order through every gate in all formats: Task 8;
    - retired numbers refused: Tasks 1 and 2;
    - lookbook with real-data preview: Task 7.
  - §4.9 catalog entry rule: Tasks 4, 5 and 6.
  - F3 demo label: Tasks 5, 7 and 8.
  - M15 human names: Task 1.
  - M16 no AI: deterministic composition throughout.
- **Gaps, stated:**
  - Reflex rules R4 to R7 and Finish rules K1 to K4 are checked by the fresh-context reviewer, which the spec already requires before catalog entry. They are not automated here.
  - The browser contrast and overflow pass stays in Milestone 3.
  - The app UI for typing picks and binding slots belongs to Milestone 4 (the «التقارير» tab). This milestone delivers the engine API only.
- **Types:** `PickBinding`, `PicksBase` and `SlotBinding` are defined in Task 3 and used unchanged in Tasks 5, 7 and 8. `renderDesignDemo` is defined in Task 5 and used in Task 7. The `lintLayout` return type gains `overruled` in Task 4 and is used by the gate in Tasks 5 and 6.
