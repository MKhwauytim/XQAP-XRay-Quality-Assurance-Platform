# Report Engine P1 — deck3 Blocks, Schema v2, v1→v2 Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Report Designer canvas renders deck3-style blocks (exact deck3 HTML/CSS) from a schema-v2 document, and existing v1 designs migrate to v2 through an admin-offered, archiving migration.

**Architecture:** A pure `blockRegistry` maps each `BlockType` to a definition whose `render(config, ctx)` calls the existing `slideKit` / `chartKit` functions. The canvas and (later) the exporter share it. In P1 every block carries **static** data in its config (`bindingShape: "static"`); data binding arrives in P2. A pure `mapV1ToV2` mapper plus a runner that archives each v1 file as `{reportId}.v1.json` before writing v2.

**Tech Stack:** React 19 + TypeScript strict (`erasableSyntaxOnly`), Vitest (node by default, jsdom per file), existing `safeWrite` / `casLoop` storage.

**Spec:** `docs/superpowers/specs/2026-11-01-report-engine-design.md` (§4.1, §4.5, §4.7; roadmap row P1). Later phases (P2 datasets, P3/P3b params + acceptance test, P4 snap, P5 deck3 template, P6 export) get their own plans.

## Global Constraints

- deck3 `theme.ts` is the only token source. Block styling exposes tones (`gold | blue | green | red | navy`; panels `land | sea | all`), never hex. `npm run check:hex-literals` stays green.
- Every user-facing string is a `DEFAULT_LABELS` key in `src/data/labels/labelsStore.ts`; UI is RTL Arabic.
- Paths only through the existing `getDesignsDir` / `workspacePaths.ts`; writes only via `safeWriteJson`; the design file stays CAS-protected (`saveDesignFile`).
- Migration: offered to `admin` only, never silent, never offered to other roles. Each v1 original is archived as `{reportId}.v1.json` (never deleted) before the v2 write. It lives in its own module with its own tests.
- deck3 kit output is deterministic by contract: snapshot before any kit-adjacent change.
- No new dependencies; `dist/` stays one `index.html`.
- Edit log: tier 3 via `npm run editlog -- --tier=3 --append --sync-package "Add (reportDesigner): …"`; tier-3 gates plus `npm run build` before the PR.

## Review Focus

1. A v1 design whose chart type has no deck3 block (pie, scatter, donut, …) must migrate to `legacyChart`, keep its config verbatim, and render a placeholder flagged legacy. It must never vanish.
2. A migration interrupted after the archive write but before the v2 write. Re-running must keep the existing `.v1.json` as is and finish the v2 write.
3. Two admins migrating the same workspace at once. CAS must make one retry; no double archive, no lost edits.
4. A non-admin opening a v1 design before migration. It must render read-only through the in-memory mapper and write nothing.
5. User text containing `<script>` or other HTML in a `richText` block or a table cell. It must render escaped (deck3 `esc`), never as markup.

---

### Task 1: Snapshot the deck3 kit (determinism guard)

**Files:**
- Create: `src/data/reporting/executive/deck3/kitSnapshot.test.ts`

**Interfaces:**
- Consumes: `kpiBand`, `tintedPanel`, `dataTable`, `contentHead` from `deck3/slideKit.ts`; `barChart`, `groupedBarChart` from `deck3/chartKit.ts` (current signatures, unchanged).
- Produces: a guard that later tasks keep green.

- [ ] **Step 1:** Write `describe("deck3 kit snapshot")` with one `it` per function, each called with fixed literals:
  - two KPI cells with `valueTone: "gold"`;
  - `tintedPanel({ variant: "sea", title: "بحري", body: "<p>x</p>" })`;
  - a 3×2 `dataTable` with totals;
  - `barChart({ bars: [{ label: "أ", value: 40 }, { label: "ب", value: null }], min: 0, max: 100 })`;
  - a two-series `groupedBarChart`.

  Each asserts `expect(html).toMatchSnapshot()`.
- [ ] **Step 2:** Run `npx vitest run src/data/reporting/executive/deck3/kitSnapshot.test.ts` — Expected: PASS, snapshot written.
- [ ] **Step 3:** Commit `test (deck3): snapshot slide/chart kit output before block work`.

### Task 2: Schema v2 types

**Files:**
- Create: `src/data/reportDesigner/reportTypesV2.ts`
- Modify: `src/data/reportDesigner/reportTypes.ts` — add `schemaVersion?: 1` to `ReportDocument`, with a doc comment that absence means v1
- Test: `src/data/reportDesigner/reportTypesV2.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const REPORT_SCHEMA_VERSION_V2 = 2;
  export type BlockType = "kpiBand" | "tintedPanel" | "dataTable" | "barChart" | "groupedBarChart"
    | "sectionHeader" | "divider" | "line" | "richText" | "image" | "legacyChart";
  export type BlockElement<T extends BlockType = BlockType> = {
    elementId: string; type: T; name: string;
    x: number; y: number; w: number; h: number; z: number; locked?: boolean;
    config: BlockConfigMap[T];
  };
  export type DocLayout = { snap: boolean; columns: 12; gutter: number; rowUnit: number };
  export type PageV2 = Omit<Page, "elements"> & { elements: BlockElement[] };
  export type ReportDocumentV2 = Omit<ReportDocument, "pages" | "theme" | "schemaVersion"> & {
    schemaVersion: 2; layout: DocLayout; pages: PageV2[];
  };
  export const DEFAULT_LAYOUT: DocLayout;   // { snap: true, columns: 12, gutter: 16, rowUnit: 8 }
  export function isV2(doc: unknown): doc is ReportDocumentV2;   // schemaVersion === 2
  export function createEmptyDocumentV2(name: string, createdBy: string, preset?: PageSizePreset): ReportDocumentV2;
  ```
  `BlockConfigMap`:
  - `kpiBand: { cells: KpiCell[]; variant: "top" | "bottom" | "solo"; compact?: boolean }`
  - `tintedPanel: { variant: "land" | "sea" | "all"; title: string; note?: string; childIds: string[] }`
  - `dataTable: { headers: string[]; rows: TableCell[][]; totals?: TableCell[] }`
  - `barChart: { bars: ChartBar[]; min: number; max: number }`
  - `groupedBarChart`: the kit's own options parameter type (`Parameters<typeof groupedBarChart>[0]`)
  - `sectionHeader: { eyebrow: string; title: string; note?: string }`
  - `divider: { tone: ChartTone }`
  - `line: { tone: ChartTone; orientation: "h" | "v" }`
  - `richText: { text: string }`
  - `image: { dataUrl: string; alt?: string }`
  - `legacyChart: { original: ElementConfig }`

  Reuse the kit's exported types (`KpiCell`, `TableCell`, `ChartBar`, `ChartTone`); never redeclare them. `createEmptyDocumentV2` defaults `preset` to `"16:9"` and carries no hex `theme.palette`.

- [ ] **Step 1:** Tests:
  - `isV2(createEmptyDocumentV2("ت", "admin"))` is true;
  - `isV2(createEmptyDocument("ت", "admin"))` is false;
  - the empty v2 doc has `layout` deep-equal to `DEFAULT_LAYOUT`, `pageSetup.width === 1280`, one page with zero elements, and `"theme" in doc === false`.
- [ ] **Step 2:** Run `npx vitest run src/data/reportDesigner/reportTypesV2.test.ts` — Expected: FAIL (module missing).
- [ ] **Step 3:** Implement `reportTypesV2.ts`.
- [ ] **Step 4:** Re-run — Expected: PASS. `npm run typecheck` — Expected: no errors.
- [ ] **Step 5:** Commit `Add (reportDesigner): schema v2 block document types`.

### Task 3: Block registry and renderers

**Files:**
- Create: `src/data/reportDesigner/blocks/blockRegistry.ts`, `src/data/reportDesigner/blocks/blockDefinitions.ts`
- Modify: `src/data/labels/labelsStore.ts` — one key per block, `reportDesigner.block.<type>`
- Test: `src/data/reportDesigner/blocks/blockRegistry.test.ts`

**Interfaces:**
- Consumes: Task 2 types; deck3 kit functions; `esc` from `src/data/reporting/primitives`.
- Produces:
  ```ts
  export type RenderCtx = { childHtml?: (ids: string[]) => string };
  export type BlockDefinition<T extends BlockType> = {
    type: T; labelKey: string;
    defaultSize: { w: number; h: number };
    defaultConfig(): BlockConfigMap[T];
    bindingShape: "static";              // P2 adds "scalars" | "series" | "table"
    render(config: BlockConfigMap[T], ctx: RenderCtx): string;
  };
  export function getBlock<T extends BlockType>(type: T): BlockDefinition<T>;
  export function listBlocks(): BlockDefinition<BlockType>[];   // excludes legacyChart
  export function renderBlock(el: BlockElement, ctx?: RenderCtx): string;
  ```
  Delegation:
  - `kpiBand` → `kpiBand(cells, variant, compact)`
  - `tintedPanel` → `tintedPanel({ …, body: ctx.childHtml?.(childIds) ?? "" })`
  - `dataTable` → `dataTable`
  - `barChart` / `groupedBarChart` → chartKit
  - `sectionHeader` → `contentHead`
  - `divider` / `line` → a rule element using existing deck3 classes and tone
  - `richText` → `<p class="v3-note">${esc(text)}</p>`
  - `image` → `<img>` with escaped attributes
  - `legacyChart` → `<div class="rd-element-placeholder" data-legacy="1">…</div>`

- [ ] **Step 1:** Tests:
  - every `listBlocks()` entry has a `labelKey` present in `DEFAULT_LABELS` and a positive `defaultSize`;
  - `renderBlock` of a `kpiBand` is byte-equal to `kpiBand(sameCells, "solo")` from the kit (WYSIWYG contract);
  - `renderBlock` of `richText` with `text: "<script>x</script>"` contains `&lt;script&gt;` and no `<script`;
  - `tintedPanel` with `childIds: ["a"]` and `childHtml: () => "<i>c</i>"` contains `<i>c</i>`;
  - `legacyChart` output contains `data-legacy="1"`;
  - `listBlocks()` has no `legacyChart`.
- [ ] **Step 2:** Run `npx vitest run src/data/reportDesigner/blocks/blockRegistry.test.ts` — Expected: FAIL.
- [ ] **Step 3:** Implement the registry, the definitions and the label keys.
- [ ] **Step 4:** Re-run together with `kitSnapshot.test.ts` — Expected: both PASS.
- [ ] **Step 5:** Commit `Add (reportDesigner): deck3 block registry`.

### Task 4: Canvas renders v2 blocks

**Files:**
- Create: `src/components/Sidebar/Tabs/ReportDesigner/renderers/BlockRenderer.tsx`, `.../renderers/DeckThemeStyle.tsx`
- Modify: `src/components/Sidebar/Tabs/ReportDesigner/editor/Canvas.tsx` — accept `ReportDocumentV2`; `ElementBody` becomes `BlockRenderer`
- Modify: `src/components/Sidebar/Tabs/ReportDesigner/editor/VizPanel.tsx` — palette from `listBlocks()`; new elements use `defaultSize` and `defaultConfig()`
- Test: `.../renderers/BlockRenderer.test.tsx` (jsdom); update `editor/Canvas.test.tsx`

**Interfaces:**
- Consumes: `renderBlock`, `listBlocks`, `getBlock` (Task 3); `DECK_V3_CSS`, `DECK_V3_FONT_FACE_CSS` (`deck3/theme.ts`).
- Produces: `<BlockRenderer element={BlockElement} page={PageV2} />` (resolves `childHtml` from same-page element ids); `<DeckThemeStyle />` mounts the deck3 CSS once per designer, as `<style data-deck3>`.

- [ ] **Step 1:** Tests:
  - BlockRenderer of a `kpiBand` puts the kit's KPI class into the DOM;
  - DeckThemeStyle rendered twice yields exactly one `style[data-deck3]`;
  - Canvas with a two-element v2 doc renders both in ascending `z`;
  - Canvas in `view` mode still attaches no drag handlers (existing assertion kept).
- [ ] **Step 2:** Run both test files — Expected: FAIL.
- [ ] **Step 3:** Implement. `dangerouslySetInnerHTML` only ever receives `renderBlock` output, whose user text was escaped in Task 3. The canvas page wrapper carries class `v3` so the kit CSS applies.
- [ ] **Step 4:** Re-run — Expected: PASS. `npm run check:hex-literals` — Expected: PASS.
- [ ] **Step 5:** Commit `Add (reportDesigner): canvas renders deck3 blocks`.

### Task 5: v1→v2 mapper (pure)

**Files:**
- Create: `src/data/reportDesigner/migrations/v1ToV2.ts`
- Test: `src/data/reportDesigner/migrations/v1ToV2.test.ts`

**Interfaces:**
- Consumes: v1 `ReportDocument`; Task 2 types.
- Produces: `export function mapV1ToV2(doc: ReportDocument): ReportDocumentV2;` It is pure and deterministic, and it preserves `reportId`, `reportName`, every element id, position, `z`, `locked`, and `revision`.

| v1 `config.kind` | v2 `type` | config |
|---|---|---|
| `kpi` | `kpiBand` | `{ cells: [{ label: name, value: "—" }], variant: "solo" }` |
| `chart`, `chartType: "bar"` | `barChart` | `{ bars: [], min: 0, max: 100 }` |
| `chart`, any other `chartType` | `legacyChart` | `{ original: config }` |
| `table` | `dataTable` | `{ headers: columns.map(c => c.field), rows: [] }` |
| `shape` `divider` / `line` | `divider` / `line` | `{ tone: "navy" }` (+ `orientation: "h"`) |
| `shape` `rect` / `ellipse` | `legacyChart` | `{ original: config }` |
| `text` | `richText` | `{ text }` |
| `image` | `image` | `{ dataUrl, alt }` |

- [ ] **Step 1:** Tests:
  - one test per row of the table;
  - a doc with every kind keeps element count and each `elementId`/`x`/`y`/`w`/`h`/`z`;
  - two calls give deep-equal output;
  - the output has `schemaVersion: 2` and `layout` deep-equal to `{ ...DEFAULT_LAYOUT, snap: false }` (v1 designs were free-placed);
  - the input is not mutated (compare against a `structuredClone` taken before the call).
- [ ] **Step 2:** Run `npx vitest run src/data/reportDesigner/migrations/v1ToV2.test.ts` — Expected: FAIL.
- [ ] **Step 3:** Implement `mapV1ToV2`.
- [ ] **Step 4:** Re-run — Expected: PASS.
- [ ] **Step 5:** Commit `Add (reportDesigner): pure v1→v2 design mapper`.

### Task 6: Migration runner, archive, storage read path

**Files:**
- Create: `src/data/reportDesigner/migrations/runDesignMigration.ts`
- Modify: `src/data/reportDesigner/storage/reportDesignStorage.ts` — `loadDesign` returns `ReportDocumentV2`, mapping v1 in memory without writing; `saveDesign` accepts v2 only
- Test: `src/data/reportDesigner/migrations/runDesignMigration.test.ts` (with `createMemoryDirectory()`)

**Interfaces:**
- Consumes: `mapV1ToV2` (Task 5); existing `getDesignsDir`, `saveDesignFile`, `loadDesignIndex`.
- Produces:
  ```ts
  export async function findV1Designs(root: DirectoryHandleLike): Promise<string[]>;   // reportIds
  export async function migrateDesigns(
    root: DirectoryHandleLike,
    actor: { role: AuthRole; username: string },
  ): Promise<{ migrated: string[]; skipped: string[]; failed: Array<{ reportId: string; error: string }> }>;
  ```
  `migrateDesigns` rejects when `role !== "admin"`. For each design:
  1. If `{id}.v1.json` is absent, write the original there with `safeWriteJson`.
  2. Then `saveDesignFile(mapV1ToV2(original))`, through the existing CAS path.

  An already-v2 design is `skipped`. One failure does not stop the others.

- [ ] **Step 1:** Tests:
  - a non-admin call rejects and writes no file;
  - two v1 designs become v2 on disk, with `.v1.json` archives equal to the originals;
  - an already-v2 design lands in `skipped`;
  - **interrupted run:** pre-seed `{id}.v1.json` (the original) next to a still-v1 `{id}.json`, run, and the archive stays equal to the original while the file becomes v2;
  - a second run after success returns `migrated: []`;
  - `loadDesign` on a v1 file returns a v2 object and leaves the file on disk unchanged;
  - two concurrent `migrateDesigns` calls on one directory both resolve, with one archive per design and the final file v2.
- [ ] **Step 2:** Run — Expected: FAIL.
- [ ] **Step 3:** Implement the runner and the storage changes.
- [ ] **Step 4:** Run `npx vitest run src/data/reportDesigner` — Expected: PASS.
- [ ] **Step 5:** Commit `Add (reportDesigner): admin design migration with v1 archive`.

### Task 7: Admin migration offer UI

**Files:**
- Create: `src/components/Sidebar/Tabs/ReportDesigner/MigrationOffer.tsx`
- Modify: `src/components/Sidebar/Tabs/ReportDesigner/TabView.tsx` — mount it above the design list
- Modify: `src/data/labels/labelsStore.ts` — keys `reportDesigner.migration.title`, `.body`, `.run`, `.later`, `.done`, `.failed`
- Test: `.../ReportDesigner/MigrationOffer.test.tsx` (jsdom)

**Interfaces:**
- Consumes: `findV1Designs`, `migrateDesigns` (Task 6); `ConfirmDialog`.
- Produces: `<MigrationOffer root={DirectoryHandleLike} role={AuthRole} username={string} onMigrated={() => void} />`

- [ ] **Step 1:** Tests:
  - renders nothing for `supervisor` or `manager`, even with v1 designs present;
  - an admin with 2 v1 designs sees the title and the count 2;
  - "run" opens ConfirmDialog, and confirming calls `migrateDesigns` once and then `onMigrated`;
  - "later" hides the offer for the session and calls nothing;
  - a result with `failed.length > 0` shows the `.failed` label with those report names.
- [ ] **Step 2:** Run — Expected: FAIL.
- [ ] **Step 3:** Implement. It never auto-runs, and the dismissal is session-only (no storage).
- [ ] **Step 4:** Re-run — Expected: PASS.
- [ ] **Step 5:** Commit `Add (reportDesigner): admin-offered design migration`.

### Task 8: Gates, edit log, PR

- [ ] **Step 1:** Run `npm run editlog -- --tier=3 --append --sync-package "Add (reportDesigner): deck3 blocks, schema v2, v1→v2 migration"`. Write Why / What changed / migration / rollback (rollback = rename `{id}.v1.json` back to `{id}.json`).
- [ ] **Step 2:** Run `npm run lint`, `npm run typecheck`, `npm run test:run`, `npm run check:complexity`, `npm run check:hex-literals`, `npm run check:release`, `npm run check:vendor`, `npm run build`, `npm run check:bundle-size` — Expected: all pass. Paste the results into **Verification:**.
- [ ] **Step 3:** With `npm run dev` in Chrome, as admin, open Report Designer on a workspace holding one v1 design. Run the migration, confirm `{id}.v1.json` exists and the design renders, and insert each block from VizPanel. Take a screenshot.
- [ ] **Step 4:** Update `docs/architecture/data-system-report.md` (`4-reports/designs/` v2 plus `.v1.json` archives). Commit, push, open the PR.
