# Power BI UI + Slides + Data Export — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Report Designer to look and feel like Power BI (3-panel layout, slide resolutions), and add a Power BI data export feature that writes CSV files to the workspace.

**Architecture:**
- Phase A (UI): Replace single-column editor with 3-panel layout (Fields | Canvas | Viz+Format) + bottom Pages bar. Matches Power BI Desktop RTL layout.
- Phase B (Export): New `src/data/powerbiExport/` module + UI section in Reports tab.

**Tech Stack:** React 19, TypeScript strict, plain CSS (no framework), File System Access API, existing `safeWriteJson`/`safeReadJson`, `ExecutiveReportRow` as fact table.

**Spec:** `docs/superpowers/specs/2026-06-28-powerbi-ui-export-design.md`

## Global Constraints

- No new npm dependencies
- TypeScript strict mode; `import type` for type-only imports; guard `createWritable` calls with `if (!fh.createWritable) return`
- All user-facing strings Arabic, containers `dir="rtl"`
- Plain co-located CSS — no CSS framework
- Before every code edit, append the entry to `docs/EDIT_LOG.md` with actual Before/After code snippets (not placeholder comments)
- `npm run typecheck` must return 0 errors after every task
- Vitest tests use `node` environment; use `createMemoryDirectory()` from `src/data/storage/memoryDirectory.ts` for any test that needs file I/O
- Commit after each task
- Version numbering in EDIT_LOG: bug fix / tweak = bump decimal (v8.1); new component = bump whole number (v9, v10...)
- File `docs/data-system-report.md` is the authoritative disk-layout reference; update it when new paths are introduced

---

## Phase A — Power BI UI + Slide Presets

### Task A.1: Slide page-size presets

**Files:**
- Modify: `src/data/reportDesigner/reportTypes.ts`
- Modify: `src/data/reportDesigner/reportTypes.test.ts`

**Interfaces:**
- Produces: `SLIDE_16_9`, `SLIDE_4_3`, `SLIDE_FHD`, `SLIDE_PRESETS` exported from `reportTypes.ts`
- Produces: Updated `PageSizePreset` type extended with `"16:9-fhd"`
- Produces: `getPageSetup(preset: PageSizePreset): PageSetup` helper function

**Context:**
Current `PageSizePreset = "A4" | "Letter" | "16:9" | "4:3" | "custom"`. The presets `"16:9"` and `"4:3"` exist in the type but have no corresponding `PageSetup` constants or dimensions.

- [ ] **Step 1: Write failing tests**

```ts
// In reportTypes.test.ts, add:
import { SLIDE_16_9, SLIDE_4_3, SLIDE_FHD, getPageSetup, SLIDE_PRESETS } from "./reportTypes";

test("SLIDE_16_9 has correct dimensions", () => {
  expect(SLIDE_16_9.width).toBe(1280);
  expect(SLIDE_16_9.height).toBe(720);
  expect(SLIDE_16_9.size).toBe("16:9");
  expect(SLIDE_16_9.orientation).toBe("landscape");
});

test("SLIDE_4_3 has correct dimensions", () => {
  expect(SLIDE_4_3.width).toBe(960);
  expect(SLIDE_4_3.height).toBe(720);
  expect(SLIDE_4_3.size).toBe("4:3");
});

test("SLIDE_FHD is 1920x1080", () => {
  expect(SLIDE_FHD.width).toBe(1920);
  expect(SLIDE_FHD.height).toBe(1080);
  expect(SLIDE_FHD.size).toBe("16:9-fhd");
});

test("getPageSetup returns correct preset", () => {
  expect(getPageSetup("16:9").width).toBe(1280);
  expect(getPageSetup("4:3").width).toBe(960);
  expect(getPageSetup("A4").width).toBe(794);
  expect(getPageSetup("custom").width).toBe(794); // fallback to A4
});

test("SLIDE_PRESETS has all four named presets", () => {
  expect(Object.keys(SLIDE_PRESETS).sort()).toEqual(["16:9", "16:9-fhd", "4:3", "A4", "Letter"].sort());
});
```

- [ ] **Step 2: Run tests to confirm failure**

```
npx vitest run src/data/reportDesigner/reportTypes.test.ts
```

Expected: FAIL — `SLIDE_16_9`, `SLIDE_4_3`, `SLIDE_FHD`, `getPageSetup`, `SLIDE_PRESETS` not exported.

- [ ] **Step 3: Update `reportTypes.ts`**

After existing `A4_PORTRAIT` constant, add:

```ts
export type PageSizePreset = "A4" | "Letter" | "16:9" | "4:3" | "16:9-fhd" | "custom";

export const SLIDE_16_9: PageSetup = {
  size: "16:9",
  orientation: "landscape",
  width: 1280,
  height: 720,
  margins: { top: 20, right: 20, bottom: 20, left: 20 },
};

export const SLIDE_4_3: PageSetup = {
  size: "4:3",
  orientation: "landscape",
  width: 960,
  height: 720,
  margins: { top: 20, right: 20, bottom: 20, left: 20 },
};

export const SLIDE_FHD: PageSetup = {
  size: "16:9-fhd",
  orientation: "landscape",
  width: 1920,
  height: 1080,
  margins: { top: 20, right: 20, bottom: 20, left: 20 },
};

export const SLIDE_PRESETS: Record<PageSizePreset, PageSetup> = {
  "A4": A4_PORTRAIT,
  "Letter": { size: "Letter", orientation: "portrait", width: 816, height: 1056, margins: { top: 38, right: 38, bottom: 38, left: 38 } },
  "16:9": SLIDE_16_9,
  "4:3": SLIDE_4_3,
  "16:9-fhd": SLIDE_FHD,
  "custom": A4_PORTRAIT, // fallback dimensions for custom
};

export function getPageSetup(preset: PageSizePreset): PageSetup {
  return SLIDE_PRESETS[preset] ?? A4_PORTRAIT;
}
```

Also update the existing `PageSizePreset` type definition (remove the old one, keep only the updated one above).

- [ ] **Step 4: Update EDIT_LOG.md** — v9 entry

- [ ] **Step 5: Run tests to confirm pass**

```
npx vitest run src/data/reportDesigner/reportTypes.test.ts
```

Expected: all tests pass including new ones.

- [ ] **Step 6: Typecheck**

```
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 7: Commit**

```
git add src/data/reportDesigner/reportTypes.ts src/data/reportDesigner/reportTypes.test.ts docs/EDIT_LOG.md
git commit -m "feat(report-designer): add slide page-size presets (16:9, 4:3, FHD)"
```

---

### Task A.2: Power BI 3-panel layout shell

**Files:**
- Modify: `src/components/Sidebar/Tabs/ReportDesigner/index.tsx` — new EditorHost layout grid
- Modify: `src/components/Sidebar/Tabs/ReportDesigner/ReportDesigner.css` — complete Power BI CSS theme

**Interfaces:**
- Consumes from A.1: `getPageSetup`, `SLIDE_PRESETS`, `PageSizePreset`
- Produces: CSS classes `rd-pbi-layout`, `rd-ribbon`, `rd-fields-panel`, `rd-canvas-area`, `rd-viz-panel`, `rd-pages-bar` used by Tasks A.3–A.5
- Produces: `showFields: boolean` state (panel toggle), `showFormat: boolean` state
- Produces: Page size selector in the "new design" creation form (adds `<select>` for `PageSizePreset`, passes chosen preset to `createEmptyDocument`)

**Context:**
`createEmptyDocument(name, createdBy)` currently hard-codes A4. After this task it will accept a third argument `preset: PageSizePreset = "A4"` and use `getPageSetup(preset)` for `pageSetup`.

The EditorHost currently uses a simple flex column:
```
[toolbar]
[canvas + inspector side-by-side]
```
Replace with:
```
grid: ribbon | (fields panel + canvas area + viz panel) | pages bar
```

- [ ] **Step 1: Update `createEmptyDocument` to accept preset**

In `reportTypes.ts`:
```ts
// Before:
export function createEmptyDocument(name: string, createdBy: string): ReportDocument {

// After:
export function createEmptyDocument(name: string, createdBy: string, preset: PageSizePreset = "A4"): ReportDocument {
  const pageSetup = getPageSetup(preset);
  // replace the hard-coded A4_PORTRAIT with pageSetup below in the function body
```

- [ ] **Step 2: Add CSS variables and layout classes to `ReportDesigner.css`**

Add a new section at the TOP of the CSS (before existing rules):

```css
/* ── Power BI theme tokens ── */
:root {
  --rd-ribbon-bg: #f3f2f1;
  --rd-ribbon-border: #e1dfdd;
  --rd-panel-bg: #ffffff;
  --rd-panel-border: #e1dfdd;
  --rd-canvas-bg: #f3f2f1;
  --rd-accent: #0078d4;
  --rd-accent-hover: #106ebe;
  --rd-pages-bg: #edebe9;
  --rd-pages-active: #ffffff;
  --rd-text-primary: #201f1e;
  --rd-text-secondary: #605e5c;
  --rd-page-width: 794px;
  --rd-page-height: 1123px;
}

/* ── 3-panel editor layout ── */
.rd-pbi-layout {
  display: grid;
  grid-template-rows: 44px 1fr 40px;
  grid-template-columns: 240px 1fr 280px;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: var(--rd-canvas-bg);
  direction: rtl;
}

/* In RTL: column 1 = rightmost (fields), column 3 = leftmost (viz+format) */
.rd-ribbon {
  grid-row: 1;
  grid-column: 1 / -1;
  background: var(--rd-ribbon-bg);
  border-bottom: 1px solid var(--rd-ribbon-border);
  display: flex;
  align-items: center;
  gap: 0;
  padding: 0 8px;
  direction: rtl;
  overflow: hidden;
}

.rd-fields-panel {
  grid-row: 2;
  grid-column: 1; /* rightmost in RTL */
  background: var(--rd-panel-bg);
  border-left: 1px solid var(--rd-panel-border);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  direction: rtl;
}

.rd-canvas-area {
  grid-row: 2;
  grid-column: 2;
  overflow: auto;
  background: var(--rd-canvas-bg);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 32px;
  direction: ltr; /* canvas coords are always LTR */
}

.rd-viz-panel {
  grid-row: 2;
  grid-column: 3; /* leftmost in RTL */
  background: var(--rd-panel-bg);
  border-right: 1px solid var(--rd-panel-border);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  direction: rtl;
}

.rd-pages-bar {
  grid-row: 3;
  grid-column: 1 / -1;
  background: var(--rd-pages-bg);
  border-top: 1px solid var(--rd-panel-border);
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 0 8px;
  overflow-x: auto;
  direction: rtl;
}

/* Panel collapsed states */
.rd-pbi-layout.rd-fields-hidden {
  grid-template-columns: 0 1fr 280px;
}
.rd-pbi-layout.rd-format-hidden {
  grid-template-columns: 240px 1fr 0;
}
.rd-pbi-layout.rd-fields-hidden.rd-format-hidden {
  grid-template-columns: 0 1fr 0;
}
.rd-fields-panel,
.rd-viz-panel {
  transition: width 0.2s;
  overflow: hidden;
}
.rd-fields-hidden .rd-fields-panel { display: none; }
.rd-format-hidden .rd-viz-panel { display: none; }

/* ── Ribbon button style (PBI-like icon+label) ── */
.rd-ribbon-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 4px 10px;
  height: 44px;
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--rd-text-primary);
  font-size: 11px;
  border-radius: 4px;
  min-width: 48px;
  transition: background 0.1s;
  white-space: nowrap;
}
.rd-ribbon-btn:hover { background: #e8e6e4; }
.rd-ribbon-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.rd-ribbon-btn-icon { font-size: 18px; line-height: 1; }
.rd-ribbon-separator {
  width: 1px;
  height: 28px;
  background: var(--rd-ribbon-border);
  margin: 0 4px;
  flex-shrink: 0;
}
.rd-ribbon-group {
  display: flex;
  align-items: center;
  gap: 0;
}
.rd-ribbon-group-label {
  font-size: 10px;
  color: var(--rd-text-secondary);
  padding: 0 8px;
  margin-top: auto;
  display: none; /* enable in full PBI style if desired */
}

/* ── Pages bar ── */
.rd-page-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: 1px solid transparent;
  border-bottom: none;
  border-radius: 4px 4px 0 0;
  cursor: pointer;
  font-size: 13px;
  background: transparent;
  color: var(--rd-text-secondary);
  white-space: nowrap;
  flex-shrink: 0;
  transition: background 0.1s;
}
.rd-page-tab:hover { background: #e1dfdd; color: var(--rd-text-primary); }
.rd-page-tab--active {
  background: var(--rd-pages-active);
  border-color: var(--rd-panel-border);
  color: var(--rd-accent);
  font-weight: 600;
}
.rd-page-tab-del {
  border: none;
  background: none;
  cursor: pointer;
  color: var(--rd-text-secondary);
  padding: 0 2px;
  font-size: 14px;
  line-height: 1;
  border-radius: 3px;
  display: none;
}
.rd-page-tab:hover .rd-page-tab-del { display: inline; }
.rd-page-tab--active .rd-page-tab-del { display: inline; }
.rd-page-tab-add {
  padding: 4px 10px;
  border: 1px dashed var(--rd-ribbon-border);
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
  color: var(--rd-text-secondary);
  font-size: 13px;
  transition: background 0.1s;
}
.rd-page-tab-add:hover { background: #e1dfdd; }

/* ── Panel headers ── */
.rd-panel-header {
  font-size: 12px;
  font-weight: 600;
  color: var(--rd-text-secondary);
  padding: 10px 12px 6px;
  border-bottom: 1px solid var(--rd-panel-border);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.rd-panel-section-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--rd-text-secondary);
  padding: 8px 12px 4px;
}

/* ── Viz type icon grid ── */
.rd-viz-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
  padding: 8px 10px;
}
.rd-viz-icon-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 8px 4px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: #f9f8f7;
  cursor: pointer;
  font-size: 10px;
  color: var(--rd-text-secondary);
  transition: background 0.1s, border-color 0.1s;
  min-height: 56px;
}
.rd-viz-icon-btn:hover {
  background: #edebe9;
  border-color: var(--rd-panel-border);
  color: var(--rd-text-primary);
}
.rd-viz-icon-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.rd-viz-icon-btn .rd-viz-icon { font-size: 22px; }

/* ── Fields panel tree ── */
.rd-fields-search {
  padding: 6px 10px;
  border: 1px solid var(--rd-panel-border);
  border-radius: 4px;
  font-size: 13px;
  margin: 8px 10px;
  width: calc(100% - 20px);
  box-sizing: border-box;
  outline: none;
  direction: rtl;
}
.rd-fields-search:focus { border-color: var(--rd-accent); }
.rd-fields-group { margin-bottom: 8px; }
.rd-fields-group-header {
  font-size: 11px;
  font-weight: 700;
  color: var(--rd-text-secondary);
  padding: 4px 12px;
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  user-select: none;
}
.rd-fields-group-header:hover { color: var(--rd-text-primary); }
.rd-field-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px 4px 24px;
  font-size: 13px;
  color: var(--rd-text-primary);
  cursor: default;
  border-radius: 3px;
  transition: background 0.1s;
}
.rd-field-item:hover { background: #f3f2f1; }
.rd-field-icon { font-size: 12px; opacity: 0.7; }
.rd-field-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ── Format / Inspector panel inside viz panel ── */
.rd-format-section {
  border-top: 1px solid var(--rd-panel-border);
  flex: 1;
  overflow-y: auto;
}

/* Save indicator in ribbon */
.rd-saving-indicator {
  font-size: 12px;
  color: var(--rd-text-secondary);
  margin: 0 8px;
}

/* Report name in ribbon */
.rd-ribbon-doc-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--rd-text-primary);
  margin: 0 8px;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

- [ ] **Step 3: Update `index.tsx` EditorHost to use new layout**

Replace the `return (...)` JSX in `EditorHost` with the new 3-panel structure. The layout div gets class `rd-pbi-layout` plus conditional classes `rd-fields-hidden`/`rd-format-hidden`. Add `showFields` and `showFormat` boolean state (both default `true`).

The structure:
```tsx
<div className={`rd-pbi-layout${!showFields ? " rd-fields-hidden" : ""}${!showFormat ? " rd-format-hidden" : ""}`}>
  <Ribbon ... />         {/* ribbon, spans all columns */}
  <FieldsPanel ... />    {/* right panel in RTL */}
  <div className="rd-canvas-area">
    <Canvas ... />
  </div>
  <VizPanel selectedElement={...} onAddElement={...} onUpdate={...} />  {/* left panel */}
  <PagesBar ... />       {/* bottom bar, spans all columns */}
  {showPrint && <PrintView ... />}
</div>
```

Import `FieldsPanel`, `VizPanel`, `PagesBar`, `Ribbon` (these are created in A.3–A.5). For now scaffold as placeholder `<div>` stubs that will be filled in A.3–A.5.

- [ ] **Step 4: Update EDIT_LOG.md** — v10 entry

- [ ] **Step 5: Typecheck**

```
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```
git add src/data/reportDesigner/reportTypes.ts src/components/Sidebar/Tabs/ReportDesigner/index.tsx src/components/Sidebar/Tabs/ReportDesigner/ReportDesigner.css docs/EDIT_LOG.md
git commit -m "feat(report-designer): Power BI 3-panel layout shell + CSS theme"
```

---

### Task A.3: PagesBar component

**Files:**
- Create: `src/components/Sidebar/Tabs/ReportDesigner/editor/PagesBar.tsx`

**Interfaces:**
- Consumes: `doc: ReportDocument`, `currentPageIndex: number`
- Produces via callbacks: `onSelectPage(index: number)`, `onAddPage()`, `onDeletePage(index: number)`

- [ ] **Step 1: Create `PagesBar.tsx`**

```tsx
import type { ReportDocument } from "../../../../../data/reportDesigner/reportTypes";

interface PagesBarProps {
  doc: ReportDocument;
  currentPageIndex: number;
  onSelectPage: (index: number) => void;
  onAddPage: () => void;
  onDeletePage: (index: number) => void;
}

export default function PagesBar({ doc, currentPageIndex, onSelectPage, onAddPage, onDeletePage }: PagesBarProps) {
  return (
    <div className="rd-pages-bar" dir="rtl">
      {doc.pages.map((page, i) => (
        <button
          key={page.pageId}
          className={`rd-page-tab${i === currentPageIndex ? " rd-page-tab--active" : ""}`}
          onClick={() => onSelectPage(i)}
          title={page.name}
        >
          {page.name}
          <span
            className="rd-page-tab-del"
            role="button"
            aria-label={`حذف ${page.name}`}
            onClick={(e) => { e.stopPropagation(); if (doc.pages.length > 1) onDeletePage(i); }}
            title="حذف الصفحة"
          >
            ×
          </span>
        </button>
      ))}
      <button className="rd-page-tab-add" onClick={onAddPage} title="إضافة صفحة">
        + صفحة
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Wire into EditorHost in index.tsx**

Replace the pages-bar stub with `<PagesBar doc={doc} currentPageIndex={currentPageIndex} onSelectPage={setCurrentPageIndex} onAddPage={handleAddPage} onDeletePage={handleDeletePage} />`.

Add `handleDeletePage(index: number)` — deletes page at index and adjusts `currentPageIndex`:
```ts
function handleDeletePage(index: number) {
  setDoc((d) => {
    if (d.pages.length <= 1) return d;
    const pages = d.pages.filter((_, i) => i !== index);
    return { ...d, pages };
  });
  setCurrentPageIndex((ci) => Math.min(ci, doc.pages.length - 2));
}
```

- [ ] **Step 3: Update EDIT_LOG.md** — v11 entry

- [ ] **Step 4: Typecheck** → 0 errors

- [ ] **Step 5: Commit**

```
git add src/components/Sidebar/Tabs/ReportDesigner/editor/PagesBar.tsx src/components/Sidebar/Tabs/ReportDesigner/index.tsx docs/EDIT_LOG.md
git commit -m "feat(report-designer): PagesBar component (bottom page tab bar)"
```

---

### Task A.4: FieldsPanel component

**Files:**
- Create: `src/components/Sidebar/Tabs/ReportDesigner/editor/FieldsPanel.tsx`

**Interfaces:**
- Consumes: `FACT_FIELDS` from `src/data/reportDesigner/query/fieldCatalog.ts`
- Produces: Searchable, grouped field list. No drag-drop in P2 (deferred to P3). Shows field role icon (📐 dimension, 🔢 measure) and label.

- [ ] **Step 1: Create `FieldsPanel.tsx`**

```tsx
import { useState } from "react";
import { FACT_FIELDS } from "../../../../../data/reportDesigner/query/fieldCatalog";

export default function FieldsPanel() {
  const [search, setSearch] = useState("");
  const [dimOpen, setDimOpen] = useState(true);
  const [measOpen, setMeasOpen] = useState(true);

  const q = search.trim().toLowerCase();
  const dims = FACT_FIELDS.filter((f) => f.role === "dimension" && (!q || f.label.includes(q) || f.field.toLowerCase().includes(q)));
  const meas = FACT_FIELDS.filter((f) => f.role === "measure"   && (!q || f.label.includes(q) || f.field.toLowerCase().includes(q)));

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div className="rd-panel-header">
        <span>الحقول</span>
      </div>
      <input
        className="rd-fields-search"
        type="search"
        placeholder="بحث في الحقول..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        dir="rtl"
      />
      <div style={{ flex: 1, overflowY: "auto" }}>
        {/* Dimensions group */}
        <div className="rd-fields-group">
          <div className="rd-fields-group-header" onClick={() => setDimOpen((v) => !v)}>
            <span>{dimOpen ? "▾" : "▸"}</span>
            <span>أبعاد ({dims.length})</span>
          </div>
          {dimOpen && dims.map((f) => (
            <div key={f.field} className="rd-field-item" title={f.field}>
              <span className="rd-field-icon">📐</span>
              <span className="rd-field-label">{f.label}</span>
            </div>
          ))}
        </div>
        {/* Measures group */}
        <div className="rd-fields-group">
          <div className="rd-fields-group-header" onClick={() => setMeasOpen((v) => !v)}>
            <span>{measOpen ? "▾" : "▸"}</span>
            <span>مقاييس ({meas.length})</span>
          </div>
          {measOpen && meas.map((f) => (
            <div key={f.field} className="rd-field-item" title={f.field}>
              <span className="rd-field-icon">🔢</span>
              <span className="rd-field-label">{f.label}</span>
            </div>
          ))}
        </div>
        {dims.length === 0 && meas.length === 0 && (
          <p style={{ padding: "12px", color: "#605e5c", fontSize: "13px" }}>لا توجد حقول مطابقة</p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire into EditorHost in index.tsx**

Replace fields-panel stub with `<FieldsPanel />`.

- [ ] **Step 3: Update EDIT_LOG.md** — v12 entry

- [ ] **Step 4: Typecheck** → 0 errors

- [ ] **Step 5: Commit**

```
git add src/components/Sidebar/Tabs/ReportDesigner/editor/FieldsPanel.tsx src/components/Sidebar/Tabs/ReportDesigner/index.tsx docs/EDIT_LOG.md
git commit -m "feat(report-designer): FieldsPanel with searchable field catalog tree"
```

---

### Task A.5: VisualizationsPanel + Ribbon redesign

**Files:**
- Create: `src/components/Sidebar/Tabs/ReportDesigner/editor/VizPanel.tsx`
- Modify: `src/components/Sidebar/Tabs/ReportDesigner/editor/Toolbar.tsx` → replace with `Ribbon.tsx`

**Note:** Rename `Toolbar.tsx` to `Ribbon.tsx` (create new file, don't just rename — keep old file in place until wired). The old Toolbar component will be replaced.

**Interfaces:**
- `VizPanel` props: `{ selectedElement: Element | null; onAddElement: (type: "text" | "shape") => void; onImageSelected: (dataUrl: string) => void; onUpdate: (id: string, patch: Partial<Element>) => void }`
- Top half of VizPanel: 8 icon buttons for element types (text, shape, image, table [disabled], chart [disabled], kpi [disabled], divider [disabled], picture [disabled])
- Bottom half: Inspector component (moved here from its own column)

- [ ] **Step 1: Create `VizPanel.tsx`**

```tsx
import { useRef } from "react";
import type { Element } from "../../../../../data/reportDesigner/reportTypes";
import Inspector from "./Inspector";

interface VizPanelProps {
  selectedElement: Element | null;
  onAddElement: (type: "text" | "shape") => void;
  onImageSelected: (dataUrl: string) => void;
  onUpdate: (id: string, patch: Partial<Element>) => void;
}

const VIZ_TYPES: Array<{ label: string; icon: string; action?: () => void; disabled?: boolean }> = [];

export default function VizPanel({ selectedElement, onAddElement, onImageSelected, onUpdate }: VizPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleImageFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { if (typeof reader.result === "string") onImageSelected(reader.result); };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  const types = [
    { label: "نص", icon: "T", disabled: false, action: () => onAddElement("text") },
    { label: "شكل", icon: "◻", disabled: false, action: () => onAddElement("shape") },
    { label: "صورة", icon: "🖼", disabled: false, action: () => fileInputRef.current?.click() },
    { label: "جدول", icon: "⊞", disabled: true },
    { label: "مخطط", icon: "📊", disabled: true },
    { label: "KPI", icon: "🔷", disabled: true },
    { label: "خط", icon: "—", disabled: false, action: () => onAddElement("shape") },
    { label: "قسم", icon: "⬚", disabled: true },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div className="rd-panel-header">
        <span>التصورات</span>
      </div>
      <div className="rd-viz-grid">
        {types.map((t) => (
          <button
            key={t.label}
            className="rd-viz-icon-btn"
            title={t.label}
            disabled={t.disabled}
            onClick={t.action}
          >
            <span className="rd-viz-icon">{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>
      <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleImageFileChange} />
      <div className="rd-format-section">
        <div className="rd-panel-header">
          <span>التنسيق</span>
        </div>
        <Inspector element={selectedElement} onUpdate={onUpdate} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `Ribbon.tsx`** (replaces Toolbar — Power BI ribbon style)

```tsx
import type { ReportDocument, PageSizePreset } from "../../../../../data/reportDesigner/reportTypes";
import { SLIDE_PRESETS } from "../../../../../data/reportDesigner/reportTypes";

interface RibbonProps {
  doc: ReportDocument;
  saving: boolean;
  showFields: boolean;
  showFormat: boolean;
  onToggleFields: () => void;
  onToggleFormat: () => void;
  onSave: () => void;
  onPrint: () => void;
  onPageSizeChange: (preset: PageSizePreset) => void;
  onBack: () => void;
}

export default function Ribbon({
  doc, saving, showFields, showFormat,
  onToggleFields, onToggleFormat,
  onSave, onPrint, onPageSizeChange, onBack,
}: RibbonProps) {
  return (
    <div className="rd-ribbon" dir="rtl">
      {/* Back button */}
      <button className="rd-ribbon-btn" onClick={onBack} title="العودة للقائمة">
        <span className="rd-ribbon-btn-icon">←</span>
        <span>رجوع</span>
      </button>
      <div className="rd-ribbon-separator" />

      {/* Page size */}
      <div className="rd-ribbon-group">
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "4px 8px" }}>
          <select
            value={doc.pageSetup.size}
            onChange={(e) => onPageSizeChange(e.target.value as PageSizePreset)}
            style={{ fontSize: "12px", border: "1px solid #e1dfdd", borderRadius: "4px", padding: "2px 6px", background: "#fff", direction: "rtl" }}
            title="حجم الصفحة"
          >
            {Object.entries(SLIDE_PRESETS).map(([key]) => (
              <option key={key} value={key}>{pageSizeLabel(key as PageSizePreset)}</option>
            ))}
          </select>
          <span style={{ fontSize: "10px", color: "#605e5c", marginTop: "2px" }}>الصفحة</span>
        </div>
      </div>
      <div className="rd-ribbon-separator" />

      {/* Panel toggles */}
      <button className={`rd-ribbon-btn${showFields ? " rd-ribbon-btn--active" : ""}`} onClick={onToggleFields} title="إظهار/إخفاء لوحة الحقول">
        <span className="rd-ribbon-btn-icon">📋</span>
        <span>الحقول</span>
      </button>
      <button className={`rd-ribbon-btn${showFormat ? " rd-ribbon-btn--active" : ""}`} onClick={onToggleFormat} title="إظهار/إخفاء لوحة التنسيق">
        <span className="rd-ribbon-btn-icon">🎨</span>
        <span>التنسيق</span>
      </button>
      <div className="rd-ribbon-separator" />

      {/* Doc name in center */}
      <span className="rd-ribbon-doc-name" title={doc.reportName}>{doc.reportName}</span>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Save / Print */}
      {saving && <span className="rd-saving-indicator">جاري الحفظ...</span>}
      <button className="rd-ribbon-btn" onClick={onSave} disabled={saving} title="حفظ">
        <span className="rd-ribbon-btn-icon">💾</span>
        <span>حفظ</span>
      </button>
      <button className="rd-ribbon-btn rd-no-print" onClick={onPrint} title="طباعة">
        <span className="rd-ribbon-btn-icon">🖨️</span>
        <span>طباعة</span>
      </button>
    </div>
  );
}

function pageSizeLabel(preset: PageSizePreset): string {
  const labels: Record<PageSizePreset, string> = {
    "A4": "A4 طولي",
    "Letter": "Letter طولي",
    "16:9": "شاشة عريضة 16:9",
    "4:3": "قياسي 4:3",
    "16:9-fhd": "Full HD 16:9",
    "custom": "مخصص",
  };
  return labels[preset] ?? preset;
}
```

Also add `.rd-ribbon-btn--active { background: #e8e6e4; color: var(--rd-accent); }` to CSS.

- [ ] **Step 3: Wire Ribbon + VizPanel into EditorHost in index.tsx**

- Import `Ribbon` and `VizPanel` (remove old `Toolbar` and standalone `Inspector` imports)
- Replace Toolbar usage with `<Ribbon ...>` (passing all the new props)
- Replace viz-panel stub with `<VizPanel ...>`
- Add `onPageSizeChange` handler:
  ```ts
  function handlePageSizeChange(preset: PageSizePreset) {
    const ps = getPageSetup(preset);
    setDoc((d) => ({ ...d, pageSetup: ps }));
  }
  ```
- Add `handleBack` which calls `onBack()`
- The Inspector is now rendered inside `VizPanel`, remove the standalone Inspector `<div>` from EditorHost

- [ ] **Step 4: Update EDIT_LOG.md** — v13 entry

- [ ] **Step 5: Typecheck** → 0 errors

- [ ] **Step 6: Commit**

```
git add src/components/Sidebar/Tabs/ReportDesigner/editor/VizPanel.tsx src/components/Sidebar/Tabs/ReportDesigner/editor/Ribbon.tsx src/components/Sidebar/Tabs/ReportDesigner/index.tsx docs/EDIT_LOG.md
git commit -m "feat(report-designer): VizPanel element type grid + Ribbon toolbar redesign"
```

---

### Task A.6: Create-dialog size selector + page setup dynamic CSS var

**Files:**
- Modify: `src/components/Sidebar/Tabs/ReportDesigner/index.tsx` — add size selector to create form
- Modify: `src/components/Sidebar/Tabs/ReportDesigner/editor/Canvas.tsx` — apply `--rd-page-width`/`--rd-page-height` CSS vars

**Context:**
The Canvas already renders at `doc.pageSetup.width × doc.pageSetup.height`. We need to also set the CSS vars so the `@page` print rule and `.rd-print-page` wrapper are in sync. Also, the "new design" form needs a size dropdown.

- [ ] **Step 1: Add size selector to create form in index.tsx**

In the `DesignList` component, the create form currently has only a name input. Add a `<select>` for `PageSizePreset` (using `pageSizeLabel` helper, same labels as in Ribbon).

```tsx
const [newSize, setNewSize] = useState<PageSizePreset>("A4");
// ...
<select value={newSize} onChange={(e) => setNewSize(e.target.value as PageSizePreset)} dir="rtl" className="rd-new-select">
  {(["A4", "Letter", "16:9", "4:3", "16:9-fhd"] as PageSizePreset[]).map((p) => (
    <option key={p} value={p}>{pageSizeLabel(p)}</option>
  ))}
</select>
```

Pass `newSize` to `createEmptyDocument(name, currentUser, newSize)`.

Add `.rd-new-select` CSS: same styles as `.rd-new-input`.

- [ ] **Step 2: Set `--rd-page-width`/`--rd-page-height` on the canvas scroll area**

In `Canvas.tsx`, the outer positioning div already has `width: doc.pageSetup.width` and `height: doc.pageSetup.height`. Add inline style to propagate CSS vars up to the scroll container via a `style` prop:

In `index.tsx` EditorHost, on the `<div className="rd-canvas-area">`:
```tsx
<div
  className="rd-canvas-area"
  style={{
    "--rd-page-width": `${doc.pageSetup.width}px`,
    "--rd-page-height": `${doc.pageSetup.height}px`,
  } as React.CSSProperties}
>
```

This makes the CSS var available to `.rd-print-page` which uses `var(--rd-page-width)` for its width.

- [ ] **Step 3: Update EDIT_LOG.md** — v14 entry

- [ ] **Step 4: Typecheck** → 0 errors

- [ ] **Step 5: Commit**

```
git add src/components/Sidebar/Tabs/ReportDesigner/index.tsx src/components/Sidebar/Tabs/ReportDesigner/editor/Canvas.tsx src/components/Sidebar/Tabs/ReportDesigner/ReportDesigner.css docs/EDIT_LOG.md
git commit -m "feat(report-designer): size selector in create dialog + dynamic page CSS vars"
```

---

### Task A.7: Phase-A integration pass

**Files:** None new — verification only.

- [ ] **Step 1: Run full test suite**

```
npm run test:run
```

All tests must pass.

- [ ] **Step 2: Typecheck** — 0 errors

- [ ] **Step 3: Lint** — 0 errors

- [ ] **Step 4: Build — note size**

```
npm run build
```

Note `dist/index.html` size. Flag if over 2,100 kB.

- [ ] **Step 5: Fix any issues found**

- [ ] **Step 6: Commit**

```
git add -A
git commit -m "docs(report-designer): phase-A integration pass — all checks green"
```

---

## Phase B — Power BI Data Export

### Task B.1: Export types + CSV serializer

**Files:**
- Create: `src/data/powerbiExport/exportTypes.ts`
- Create: `src/data/powerbiExport/csvSerializer.ts`
- Create: `src/data/powerbiExport/csvSerializer.test.ts`

**Interfaces:**
- Produces: `toCsvString(headers: string[], rows: Record<string, unknown>[]): string`
- Produces: `ExportManifest`, `ExportFileResult` types

- [ ] **Step 1: Write failing tests**

```ts
// csvSerializer.test.ts
import { describe, it, expect } from "vitest";
import { toCsvString } from "./csvSerializer";

describe("toCsvString", () => {
  it("produces UTF-8 BOM header + comma-separated header row", () => {
    const result = toCsvString(["a", "b"], []);
    expect(result.startsWith("﻿")).toBe(true);
    expect(result).toContain("a,b");
  });

  it("serializes a simple row", () => {
    const result = toCsvString(["name", "count"], [{ name: "ميناء A", count: 42 }]);
    expect(result).toContain('"ميناء A",42');
  });

  it("wraps values containing commas in double quotes", () => {
    const result = toCsvString(["v"], [{ v: "hello, world" }]);
    expect(result).toContain('"hello, world"');
  });

  it("escapes double quotes by doubling them", () => {
    const result = toCsvString(["v"], [{ v: 'say "hi"' }]);
    expect(result).toContain('"say ""hi"""');
  });

  it("converts null to empty string", () => {
    const result = toCsvString(["v"], [{ v: null }]);
    const lines = result.split("\n");
    expect(lines[1].trim()).toBe(",".repeat(0)); // single empty column
  });

  it("converts boolean to 1/0", () => {
    const result = toCsvString(["a", "b"], [{ a: true, b: false }]);
    expect(result).toContain("1,0");
  });

  it("handles missing key as empty", () => {
    const result = toCsvString(["a", "b"], [{ a: "x" }]);
    // b is undefined → empty
    expect(result).toContain("x,");
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```
npx vitest run src/data/powerbiExport/csvSerializer.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `exportTypes.ts`**

```ts
export type ExportFileResult = {
  fileName: string;
  rowCount: number;
};

export type ExportManifest = {
  month: string;
  exportedAt: string;
  files: ExportFileResult[];
};
```

- [ ] **Step 4: Create `csvSerializer.ts`**

```ts
function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "1" : "0";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function toCsvString(
  headers: string[],
  rows: Record<string, unknown>[]
): string {
  const lines: string[] = [];
  lines.push(headers.join(","));
  for (const row of rows) {
    lines.push(headers.map((h) => escapeCell(row[h])).join(","));
  }
  return "﻿" + lines.join("\n");
}
```

- [ ] **Step 5: Run tests to confirm pass**

```
npx vitest run src/data/powerbiExport/csvSerializer.test.ts
```

All 7 tests pass.

- [ ] **Step 6: Update EDIT_LOG.md** — v15 entry

- [ ] **Step 7: Typecheck** → 0 errors

- [ ] **Step 8: Commit**

```
git add src/data/powerbiExport/exportTypes.ts src/data/powerbiExport/csvSerializer.ts src/data/powerbiExport/csvSerializer.test.ts docs/EDIT_LOG.md
git commit -m "feat(powerbi-export): add CSV serializer with UTF-8 BOM and escaping"
```

---

### Task B.2: Export writer (workspace file I/O)

**Files:**
- Create: `src/data/powerbiExport/exportWriter.ts`
- Create: `src/data/powerbiExport/exportWriter.test.ts`

**Interfaces:**
- Consumes: `toCsvString`, `ExportManifest`, `ExportFileResult`
- Consumes: `DirectoryHandleLike` from `src/data/storage/fileSystemAccess.ts`
- Produces: `writeTextFile(dir: DirectoryHandleLike, fileName: string, content: string): Promise<void>`
- Produces: `getExportDir(root: DirectoryHandleLike, month: string): Promise<DirectoryHandleLike>`
- Produces: `writeCsvExport(root, month, exports: Array<{fileName: string; headers: string[]; rows: Record<string, unknown>[]}>): Promise<ExportManifest>`

**Notes on file writing:**
The existing `safeWriteJson` cannot write plain text (it adds `JsonEnvelope`). We need a plain text writer. Use the raw File System Access API:
```ts
async function writeTextFile(dir: DirectoryHandleLike, fileName: string, content: string): Promise<void> {
  const fh = await dir.getFileHandle(fileName, { create: true });
  if (!fh.createWritable) throw new Error("createWritable not supported");
  const writable = await fh.createWritable();
  await writable.write(content);
  await writable.close();
}
```

`getExportDir` navigates to `5-System/powerbi-export/{month}/` creating subdirs as needed. Use `getSystemRoot` from `src/data/workspace/workspacePaths.ts` to find `5-System`.

- [ ] **Step 1: Write failing tests using createMemoryDirectory**

```ts
// exportWriter.test.ts
import { describe, it, expect } from "vitest";
import { createMemoryDirectory } from "../storage/memoryDirectory";
import { writeCsvExport } from "./exportWriter";

describe("writeCsvExport", () => {
  it("writes CSV files and returns manifest", async () => {
    const root = createMemoryDirectory("root");
    const manifest = await writeCsvExport(root, "5-May-2026", [
      { fileName: "population.csv", headers: ["id", "port"], rows: [{ id: "X1", port: "ميناء A" }] },
    ]);
    expect(manifest.month).toBe("5-May-2026");
    expect(manifest.files).toHaveLength(1);
    expect(manifest.files[0].fileName).toBe("population.csv");
    expect(manifest.files[0].rowCount).toBe(1);
  });

  it("creates the export directory and writes the file content", async () => {
    const root = createMemoryDirectory("root");
    await writeCsvExport(root, "5-May-2026", [
      { fileName: "sample.csv", headers: ["id"], rows: [{ id: "A" }, { id: "B" }] },
    ]);
    // navigate into 5-System/powerbi-export/5-May-2026/
    const sys = await root.getDirectoryHandle("5-System", { create: false });
    const exp = await sys.getDirectoryHandle("powerbi-export", { create: false });
    const month = await exp.getDirectoryHandle("5-May-2026", { create: false });
    const fh = await month.getFileHandle("sample.csv", { create: false });
    expect(fh).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to confirm failure** (module not found)

- [ ] **Step 3: Create `exportWriter.ts`**

```ts
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { getSystemRoot } from "../workspace/workspacePaths";
import { toCsvString } from "./csvSerializer";
import type { ExportManifest, ExportFileResult } from "./exportTypes";

async function getExportDir(root: DirectoryHandleLike, month: string): Promise<DirectoryHandleLike> {
  const sys = await getSystemRoot(root, true);
  const expRoot = await sys.getDirectoryHandle("powerbi-export", { create: true });
  return expRoot.getDirectoryHandle(month, { create: true });
}

async function writeTextFile(dir: DirectoryHandleLike, fileName: string, content: string): Promise<void> {
  const fh = await dir.getFileHandle(fileName, { create: true });
  if (!fh.createWritable) throw new Error("createWritable not supported in this environment");
  const writable = await fh.createWritable();
  await writable.write(content);
  await writable.close();
}

export async function writeCsvExport(
  root: DirectoryHandleLike,
  month: string,
  exports: Array<{ fileName: string; headers: string[]; rows: Record<string, unknown>[] }>
): Promise<ExportManifest> {
  const dir = await getExportDir(root, month);
  const files: ExportFileResult[] = [];

  for (const exp of exports) {
    const csv = toCsvString(exp.headers, exp.rows);
    await writeTextFile(dir, exp.fileName, csv);
    files.push({ fileName: exp.fileName, rowCount: exp.rows.length });
  }

  // Write instructions file
  const instructions = [
    "Power BI Data Export",
    "====================",
    "",
    "Arabic:",
    "لاستيراد هذه الملفات في Power BI Desktop:",
    "1. افتح Power BI Desktop",
    "2. الصفحة الرئيسية > الحصول على البيانات > نص/CSV",
    "3. انتقل إلى مجلد '5-System/powerbi-export/" + month + "/'",
    "4. افتح كل ملف CSV واضغط 'تحميل'",
    "5. في نموذج البيانات، يمكنك إنشاء علاقات بين الجداول باستخدام عمود xrayImageId",
    "",
    "English:",
    "To import these files into Power BI Desktop:",
    "1. Open Power BI Desktop",
    "2. Home > Get Data > Text/CSV",
    "3. Browse to '5-System/powerbi-export/" + month + "/'",
    "4. Open each CSV file and click 'Load'",
    "5. In the Data Model, create relationships between tables using the xrayImageId column",
    "",
    "Files in this export:",
    ...files.map((f) => `  - ${f.fileName} (${f.rowCount} rows)`),
    "",
    `Exported at: ${new Date().toISOString()}`,
  ].join("\n");

  await writeTextFile(dir, "LISEZMOI.txt", instructions);

  return {
    month,
    exportedAt: new Date().toISOString(),
    files,
  };
}
```

Note: `getSystemRoot` from `workspacePaths.ts` — check what it's called there. If `5-System` uses a different helper, use the correct one. Search for `System` or `system` in `workspacePaths.ts` to find the right function.

- [ ] **Step 4: Run tests to confirm pass**

```
npx vitest run src/data/powerbiExport/exportWriter.test.ts
```

All tests pass.

- [ ] **Step 5: Update EDIT_LOG.md** — v16 entry

- [ ] **Step 6: Typecheck** → 0 errors

- [ ] **Step 7: Commit**

```
git add src/data/powerbiExport/exportWriter.ts src/data/powerbiExport/exportWriter.test.ts docs/EDIT_LOG.md
git commit -m "feat(powerbi-export): workspace CSV file writer + instructions file"
```

---

### Task B.3: Export manager + UI in Reports tab

**Files:**
- Create: `src/data/powerbiExport/exportManager.ts`
- Modify: `src/components/Sidebar/Tabs/Reports/index.tsx`
- Modify: `src/components/Sidebar/Tabs/Reports/Reports.css`

**Interfaces:**
- `runPowerBiExport(root: DirectoryHandleLike, month: string, directoryHandle: DirectoryHandleLike): Promise<ExportManifest>` — loads month data, builds rows, calls `writeCsvExport`

**Context:**
The export manager needs to load:
- Population rows: `loadMonthPopulationFinal(root, month)` → `PreparedPopulationRow[]` → convert to `ExecutiveReportRow[]` via `buildExecutiveReportRows`
- Sample: `loadSampleMaster(root, month)` → `SampleMasterData | null`
- Distribution: `loadOrDeriveDistributionCurrent(root, month)` → `DistributionCurrentData | null`
- Employee answer files: `loadAllEmployeeFiles(root, month)` → `EmployeeAnswerFile[]`

Column headers for `population.csv` = all `ExecutiveReportRow` field names as-is (camelCase is fine for PBI).

The Reports tab already imports all these loaders. Check `Reports/index.tsx` for the exact function names.

`ExecutiveReportRow` fields (24 columns):
```
xrayImageId, portName, portType, stage, levelOneResult, levelTwoResult, imageResult,
selectedInSample, assignedTo, distributionStatus, expertResult, imageAvailable,
noImageReason, hasMarking, imageQuality, lowQualityReason, suspicionLevel,
suspectedTypes, smuggleMethod, answerStatus, assignedAt, submittedAt,
imageResultAccurate, levelOneAccurate, levelTwoAccurate, verificationCategory
```

- [ ] **Step 1: Create `exportManager.ts`**

```ts
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { loadMonthPopulationFinal } from "../population/populationStorage";
import { loadSampleMaster } from "../sampling/sampleStorage";
import { loadOrDeriveDistributionCurrent } from "../distribution/distributionStorage";
import { loadAllEmployeeFiles } from "../answers/answerStorage";
import { buildExecutiveReportRows } from "../reporting/executiveReportData";
import { DEFAULT_EXEC_CONFIG } from "../reporting/executiveReportTypes";
import type { ExportManifest } from "./exportTypes";
import { writeCsvExport } from "./exportWriter";

const POPULATION_HEADERS = [
  "xrayImageId", "portName", "portType", "stage",
  "levelOneResult", "levelTwoResult", "imageResult",
  "selectedInSample", "assignedTo", "distributionStatus", "expertResult",
  "imageAvailable", "noImageReason", "hasMarking", "imageQuality",
  "lowQualityReason", "suspicionLevel", "suspectedTypes", "smuggleMethod",
  "answerStatus", "assignedAt", "submittedAt",
  "imageResultAccurate", "levelOneAccurate", "levelTwoAccurate", "verificationCategory",
];

export async function runPowerBiExport(
  root: DirectoryHandleLike,
  month: string
): Promise<ExportManifest> {
  const populationRows = await loadMonthPopulationFinal(root, month);
  const sample = await loadSampleMaster(root, month);
  const distribution = await loadOrDeriveDistributionCurrent(root, month);
  const employeeFiles = await loadAllEmployeeFiles(root, month);

  const execRows = buildExecutiveReportRows({
    monthFolderName: month,
    populationRows: populationRows ?? [],
    sample,
    distribution,
    employeeFiles,
    template: null,
    config: DEFAULT_EXEC_CONFIG,
  });

  const allRows = execRows as unknown as Record<string, unknown>[];
  const sampleRows = allRows.filter((r) => r["selectedInSample"] === true);

  return writeCsvExport(root, month, [
    { fileName: "population.csv", headers: POPULATION_HEADERS, rows: allRows },
    { fileName: "sample.csv",     headers: POPULATION_HEADERS, rows: sampleRows },
  ]);
}
```

Note: `loadMonthPopulationFinal` may return `PreparedPopulationRow[] | null`. Check the actual signature in `populationStorage.ts` and adjust accordingly.

- [ ] **Step 2: Add "تصدير لـ Power BI" section to Reports tab**

At the bottom of the "التقارير" sub-tab section in `Reports/index.tsx`, add a new collapsible section. Look for where the report action buttons end and add:

```tsx
{/* ── Power BI Export section ── */}
<section className="rh-section rh-pbi-section" aria-label="تصدير لـ Power BI">
  <h3 className="rh-section-title">
    <svg width="20" height="20" viewBox="0 0 32 32" aria-hidden="true" style={{verticalAlign:"middle",marginLeft:"6px"}}>
      <rect width="32" height="32" rx="4" fill="#F2C80F"/>
      <path d="M8 8h16v4H8zm0 6h10v4H8zm0 6h12v4H8z" fill="#243E5A"/>
    </svg>
    تصدير البيانات لـ Power BI
  </h3>
  <p className="rh-description">
    يصدّر بيانات المجتمع والعينة للشهر المحدد كملفات CSV يمكن فتحها مباشرة في Power BI Desktop.
  </p>
  <div className="rh-row rh-pbi-row">
    <select
      className="rh-select"
      value={pbiMonth}
      onChange={(e) => setPbiMonth(e.target.value)}
      dir="rtl"
      disabled={months.length === 0}
    >
      <option value="">-- اختر شهراً --</option>
      {months.map((m) => <option key={m.folderName} value={m.folderName}>{m.folderName}</option>)}
    </select>
    <button
      className="rh-btn rh-btn-primary"
      onClick={handlePbiExport}
      disabled={!pbiMonth || pbiExporting}
    >
      {pbiExporting ? "جاري التصدير..." : "تصدير"}
    </button>
  </div>
  {pbiResult && (
    <div className="rh-pbi-result">
      <p className="rh-success">✓ تم التصدير بنجاح — الملفات في مجلد <code>5-System/powerbi-export/{pbiResult.month}/</code></p>
      <ul className="rh-pbi-file-list">
        {pbiResult.files.map((f) => <li key={f.fileName}><code>{f.fileName}</code> — {f.rowCount} سطر</li>)}
      </ul>
    </div>
  )}
  {pbiError && <p className="rh-error">{pbiError}</p>}
</section>
```

State additions to the Reports component:
```ts
const [pbiMonth, setPbiMonth] = useState("");
const [pbiExporting, setPbiExporting] = useState(false);
const [pbiResult, setPbiResult] = useState<ExportManifest | null>(null);
const [pbiError, setPbiError] = useState<string | null>(null);
```

Handler:
```ts
async function handlePbiExport() {
  if (!directoryHandle || !pbiMonth) return;
  setPbiExporting(true);
  setPbiResult(null);
  setPbiError(null);
  try {
    const manifest = await runPowerBiExport(directoryHandle, pbiMonth);
    setPbiResult(manifest);
  } catch (err) {
    setPbiError(err instanceof Error ? err.message : "حدث خطأ أثناء التصدير");
  } finally {
    setPbiExporting(false);
  }
}
```

- [ ] **Step 3: Add CSS for new section in `Reports.css`**

```css
/* Power BI export section */
.rh-pbi-section { margin-top: 24px; }
.rh-pbi-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-top: 12px; }
.rh-pbi-result { margin-top: 12px; padding: 12px 16px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; }
.rh-pbi-file-list { margin: 6px 0 0; padding: 0 18px; font-size: 13px; }
.rh-pbi-file-list li { margin-bottom: 3px; }
.rh-success { color: #16a34a; margin: 0; font-size: 13px; }
.rh-error { color: #dc2626; font-size: 13px; margin-top: 8px; }
```

Look at `Reports.css` for existing class names like `rh-section`, `rh-section-title`, `rh-description`, `rh-btn`, `rh-btn-primary`, `rh-select`, `rh-row` and reuse them exactly.

- [ ] **Step 4: Update docs/data-system-report.md**

Add to the `5-System` section:
```
5-System/powerbi-export/{month}/
  population.csv   — all ExecutiveReportRow records (UTF-8 BOM CSV)
  sample.csv       — selectedInSample=true subset
  LISEZMOI.txt     — connection instructions (Arabic + English)
```

- [ ] **Step 5: Update EDIT_LOG.md** — v17 entry

- [ ] **Step 6: Typecheck** → 0 errors

- [ ] **Step 7: Commit**

```
git add src/data/powerbiExport/exportManager.ts src/components/Sidebar/Tabs/Reports/index.tsx src/components/Sidebar/Tabs/Reports/Reports.css docs/data-system-report.md docs/EDIT_LOG.md
git commit -m "feat(powerbi-export): export manager + UI section in Reports tab"
```

---

### Task B.4: Phase-B integration pass

**Files:** None new — verification only.

- [ ] **Step 1: Run full test suite**

```
npm run test:run
```

All tests must pass. B.1 adds 7 new tests, B.2 adds 2. Total should be 164 + 9 = 173 tests.

- [ ] **Step 2: Typecheck** — 0 errors

- [ ] **Step 3: Lint** — 0 errors

- [ ] **Step 4: Build** — note size, flag if over 2,150 kB

- [ ] **Step 5: Fix any issues**

- [ ] **Step 6: Commit**

```
git commit -m "docs(powerbi-export): phase-B integration pass — all checks green"
```
