# Power BI UI + Slides + Data Export — Design Spec

**Date:** 2026-06-28  
**Branch:** feat/powerbi-ui-export  
**Status:** Approved — implements user request

---

## 1. Power BI-Like UI Layout

Replace the current single-column editor with a 3-panel layout that mirrors Microsoft Power BI's desktop UI, adapted for RTL Arabic.

### Layout (RTL, 3-panel)

```
┌─────────────────────────────────────────────────────────────────────┐
│  Ribbon: [إضافة عنصر groups] ··· [اسم التقرير] ··· [حفظ] [طباعة]  │
├──────────────┬──────────────────────────────────┬───────────────────┤
│ الحقول       │                                  │ التصورات          │
│ ──────────   │         منطقة اللوحة            │ ─────────────────  │
│ ▶ أبعاد      │    (scrollable, gray bg)         │  [8 type icons]   │
│   ├ portName │                                  │ ─────────────────  │
│   ├ stage    │    [canvas at page dimensions]   │ التنسيق           │
│ ▶ مقاييس     │                                  │  [Inspector]      │
│   ├ count    │                                  │                   │
│   └ ...      │                                  │                   │
│  [toggle]    │                                  │  [toggle]         │
├──────────────┴──────────────────────────────────┴───────────────────┤
│  [+ صفحة] · [صفحة 1 ×] · [صفحة 2 ×] · [صفحة 3 ×]  (RTL order)    │
└─────────────────────────────────────────────────────────────────────┘
```

- **Ribbon** (top, `height: 44px`): Grouped icon+label buttons. Groups: الإدراج (text/shape/image add) | الصفحة (page setup/size picker) | حفظ/طباعة
- **Fields panel** (right in RTL, `width: 240px`, collapsible): FACT_FIELDS catalog from `fieldCatalog.ts`, split into "أبعاد" / "مقاييس" groups. P2: drag-to-element binding. P1: display only with copy-to-clipboard.
- **Canvas area** (center, `flex: 1`, scrollable): Light gray background (`#f3f2f1`). Canvas page centered, white with shadow.
- **Visualizations + Format panel** (left in RTL, `width: 280px`, collapsible): Top half = 8-icon element type grid (click to add to canvas). Bottom half = Inspector/Format panel for selected element.
- **Pages bar** (bottom, `height: 40px`): Horizontal tab list. Each tab shows page name + X (delete). + button to add page. Scroll if many pages.

### Colors (Power BI light theme)

| Token | Value | Used for |
|-------|-------|----------|
| `--rd-ribbon-bg` | `#f3f2f1` | Ribbon background |
| `--rd-ribbon-border` | `#e1dfdd` | Ribbon bottom border |
| `--rd-panel-bg` | `#ffffff` | Side panels background |
| `--rd-panel-border` | `#e1dfdd` | Panel borders |
| `--rd-canvas-bg` | `#f3f2f1` | Canvas scroll area |
| `--rd-accent` | `#0078d4` | Active tab, selection, primary buttons |
| `--rd-pages-bg` | `#edebe9` | Pages bar background |
| `--rd-pages-active` | `#ffffff` | Active page tab |

---

## 2. Slide Page Size Presets

Add three slide presets to `reportTypes.ts`:

| Preset | Size label | Width | Height |
|--------|-----------|-------|--------|
| `A4` | A4 طولي | 794 | 1123 |
| `Letter` | Letter طولي | 816 | 1056 |
| `16:9` | شاشة عريضة (16:9) | 1280 | 720 |
| `4:3` | قياسي (4:3) | 960 | 720 |
| `16:9-fhd` | Full HD (16:9) | 1920 | 1080 |
| `custom` | مخصص | user-set | user-set |

Exported constants: `SLIDE_16_9`, `SLIDE_4_3`, `SLIDE_FHD`, `SLIDE_PRESETS` map.

Page setup is chosen in the "new design" creation dialog (add a size selector there). Can also be changed per-design from the Ribbon's "الصفحة" group.

---

## 3. Power BI Data Export

### Goal

Let users export the current month's data (population + sample + distribution + answers) as CSV files to the workspace folder, then open those files directly in Power BI Desktop via "Get Data → Text/CSV".

### Files exported

Written to `5-System/powerbi-export/{month}/`:

| File | Content | Row count |
|------|---------|-----------|
| `population.csv` | All `ExecutiveReportRow` fields | one per population record |
| `sample.csv` | Same rows but `selectedInSample = true` only | sample subset |
| `distribution.csv` | Distribution current state (assignedTo, status, submittedAt per image) | per assigned image |
| `answers.csv` | All submitted answers (employee + imageId + all answer field values) | per submitted answer |
| `LISEZMOI.txt` | Instructions (Arabic + English) on connecting Power BI Desktop | 1 file |

### CSV format

- UTF-8 with BOM (`﻿`) so Arabic characters display correctly in Excel/Power BI
- First row: English column names (PBI-friendly, no spaces — use camelCase)
- Values: `null` → empty string; `boolean` → `1`/`0`; dates → ISO string
- Delimiter: comma `,`

### UI placement

Add a collapsible section "تصدير البيانات لـ Power BI" at the bottom of the **Reports tab** ("التقارير" sub-tab). It shows:
- Month selector (same `folderName` list already loaded in Reports)
- "تصدير" button → runs export → shows success with file paths listed, or error

### Module path

`src/data/powerbiExport/` with:
- `exportTypes.ts` — type definitions
- `csvSerializer.ts` — row-array-to-CSV-string pure function
- `exportWriter.ts` — writes files to workspace via `safeWriteJson` equivalent for text
- `exportManager.ts` — orchestrates: load month data → build rows → write files

Uses `safeWriteJson` for the LISEZMOI.txt (as plain text via `FileSystemWritableFileStream`), direct FileHandle writes for CSV.

---

## 4. Phasing

All of the above is P2 of the Report Designer roadmap. P1 (canvas shell) is already merged to `main`.

P3 and P4 (data-bound charts, cross-filtering) are not changed by this spec.

---

## 5. Constraints

- No new npm dependencies
- TypeScript strict mode
- All UI text Arabic, RTL
- EDIT_LOG entry before every file edit
- Bundle size: check after — expect +20–40 kB for new components
