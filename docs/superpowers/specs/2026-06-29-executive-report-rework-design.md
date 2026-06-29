# Executive Report Rework — Design Spec (v2, corrected)

- **Date:** 2026-06-29 (revised after full mockup review)
- **Status:** Approved design, ready for implementation planning
- **Source of truth for layout:** the 20 PNG mockups in `C:\Users\WorkNStudy\Downloads\New folder (4)\`. `xray_executive_report_preview_v4.html` is an **old backup — ignore it for design**. The PNGs define *layout, structure, charts, visual style, and design tokens*. **All numbers, names, ports, and percentages in the final report come from live system data — never from the mockup placeholders (`XX%`).**

---

## 1. Goal

Replace the current white printable executive report with the **dark-navy interactive viewer** shown in the mockups and `xray_executive_report_preview_v4.html`. The output is a **self-contained HTML file** that:

- Opens as an interactive viewer: sidebar navigation on the **right** (RTL), slide-area on the left, smooth anchor scrolling between sections.
- Has a single **"تصدير PDF"** button. Clicking it calls `window.print()`; a `@media print` stylesheet hides the sidebar and prints each `.xr-page` full-page with the dark theme intact (`print-color-adjust: exact`).
- Covers **9 sections** (~31 pages) in Arabic RTL.

### Confirmed decisions

| Decision | Choice |
|----------|--------|
| Output format | Interactive viewer HTML (sidebar nav + slides) with print-to-PDF button |
| Theme | Dark navy + gold — exact colours eyedropped from PNG mockups during implementation |
| Employee identity | Display names by default; **config toggle** to anonymize to codes (`موظف ١`, `موظف ٢`, …) |
| Data | 100% live system data. No placeholders. Insufficient-data states render "بيانات غير كافية", never `XX%` |
| Delivery | Phased — 4 phases, each shippable |

---

## 2. Report structure (9 sections, ~31 pages)

This is the **authoritative structure** from the mockup TOC. The previous spec described 3 parts — that was wrong.

| Page | Section | Arabic title | Notes |
|------|---------|--------------|-------|
| 01 | Cover | التقرير التنفيذي لضمان جودة الأشعة | Org branding, month, 4 level chips, download/browse buttons |
| 02 | TOC | الفهرس | Anchored links, live page numbers |
| 03 | Exec intro | مقدمة تنفيذية | KPI dashboard — at-a-glance summary across all sections |
| 05 | Glossary | المعجم ودلالات المستويات | 4 level cards + term grid (سليمة, اشتباه, CertScan, BI, etc.) |
| 07 | **الجزء الأول** | مجتمع الحالات | Population divider |
| 08 | — | مجتمع حالات المخاطر | Population by risk type: land/sea tables, totals |
| 09 | — | مجتمع الحالات حسب المستويات والمنافذ | Population by level × port matrix |
| 11 | **الجزء الثاني** | العينة | Sample divider |
| 12 | — | العينة حسب المستويات والمنافذ | Sample size, coverage %, CertScan split, per-port/level tables |
| 15 | **الجزء الثالث** | التوزيع والتكليف | Distribution divider |
| 16 | — | توزيع الحالات حسب الموظفين | Who was assigned what; workload per employee; port × employee assignment |
| 19 | **الجزء الرابع** | نتائج المراجعة ومؤشرات الدقة | Accuracy divider |
| 20 | — | نتائج الدقة حسب المنفذ | Port accuracy table, status badges |
| 21 | — | نتائج الدقة حسب المستويات الأربعة | Level accuracy, radar chart, L1/L2 correction/regression |
| 22 | — | مقارنة المستوى الأول والثاني وتوافق الموظفين | L1-vs-L2 bars + conditional employee-pair heatmap |
| 23 | **الجزء الخامس** | الفجوات والملاحظات الجوهرية | Findings divider |
| 24 | — | النظرة العامة لأداء الموظفين | Employee overview: ranked table, top/bottom lists |
| 25 | — | دقة الموظفين حسب نوع القرار | Decision-type quadrant scatter + ranked lists |
| 26 | — | مقارنة الموظفين بين المنافذ | Employee × port heatmap matrix |
| 27 | — | أثر جودة الصورة والتحديد على الدقة | Image quality & marking impact — big table + top/bottom lists |
| 28 | — | استقرار الأداء وعبء العمل | Stability scatter (workload × accuracy) + bars |
| 27 | **الجزء السادس** | التوصيات والقرارات المطلوبة | Recommendations divider |
| 28 | — | الموظفون ذوو الأولوية والإجراءات المقترحة | Priority employee cards + action matrix |
| 31 | Appendix | الملاحق | Methodology, config thresholds, definitions |

> Page numbers are approximate from mockups; `assemble.ts` renumbers sequentially.

---

## 3. Architecture

### 3.1 Module layout

```
src/data/reporting/executive/
  theme.ts              Design tokens + shared CSS (from xray_executive_report_preview_v4.html)
  primitives.ts         Pure render helpers (kpiCard, dataTable, barRow, charts…)
  viewer.ts             Sidebar HTML + viewer shell (nav, toolbar, PDF button)
  context.ts            ExecutiveRenderContext type + builder
  pages/
    cover.ts            p.01 — cover
    toc.ts              p.02 — table of contents
    execIntro.ts        p.03 — executive intro / KPI dashboard      [NEW vs old spec]
    glossary.ts         p.05 — glossary + level definitions
    part1Divider.ts     p.07 — Part 1 divider
    populationByRisk.ts p.08 — population by risk type
    populationByLevel.ts p.09 — population by level × port
    part2Divider.ts     p.11 — Part 2 divider
    sampleByLevel.ts    p.12 — sample by levels & ports
    part3Divider.ts     p.15 — Part 3 divider                      [NEW vs old spec]
    distributionOverview.ts p.16 — distribution & assignment       [NEW vs old spec]
    part4Divider.ts     p.19 — Part 4 divider                      [NEW vs old spec]
    accuracyByPort.ts   p.20 — accuracy by port
    accuracyByLevel.ts  p.21 — accuracy by levels
    levelAgreement.ts   p.22 — L1-vs-L2 + employee-pair agreement
    part5Divider.ts     p.23 — Part 5 divider                      [NEW vs old spec]
    empOverview.ts      p.24 — employee overview
    empByDecision.ts    p.25 — accuracy by decision type
    empByPort.ts        p.26 — employee × port heatmap
    empImageQuality.ts  p.27 — image quality & marking impact
    empStability.ts     p.28 — stability & workload
    part6Divider.ts     p.29 — Part 6 divider                      [NEW vs old spec]
    empPriority.ts      p.30 — priority employees & actions
    appendix.ts         p.31 — appendix
  assemble.ts           Stitches pages, injects viewer shell, page numbers, TOC anchors
  index.ts              Public API: openExecutiveReport, buildExecutiveReport
```

`src/data/reporting/executiveReport.ts` becomes a **thin re-export shim** of `executive/index.ts` — no call-site changes in `Reports/index.tsx` beyond passing the new `employeeDisplayNames` map.

### 3.2 Each page module

Exports a pure function `(ctx: ExecutiveRenderContext) => string` returning one `<section class="xr-page" id="page-N">…</section>`. Independently readable and testable. No page imports another page.

### 3.3 Viewer shell (`viewer.ts`)

Generates the outer HTML wrapping all pages:

```html
<div class="viewer">
  <!-- LEFT: slide area -->
  <main class="slides">
    {pages}
  </main>
  <!-- RIGHT: sidebar nav (RTL — appears on the right visually) -->
  <nav class="sidebar">
    <div class="brand-small">…org logo + month…</div>
    <div class="toolbar">
      <button onclick="window.print()">تصدير PDF</button>
    </div>
    <div class="toc">…section anchors…</div>
  </nav>
</div>
```

`@media print` block hides `.sidebar`, removes the viewer grid, prints `.xr-page` full-page with `print-color-adjust: exact`.

### 3.4 Shared primitives (`primitives.ts`)

Pure `(props) => htmlString` helpers:

- `kpiCard`, `statPill`, `sectionHeader`, `partDivider`, `noticeBox`
- `dataTable(headers, rows, opts)` — RTL, status-tinted cells
- `barRow`, `horizontalBars`, `stackedBar`
- `radarChart` — level accuracy radar (p.21)
- `scatterChart` — workload × accuracy (p.28)
- `quadrantChart` — decision-type scatter (p.25)
- `heatCell` — employee × port matrix (p.26, p.22)
- `donut` / `gauge` — coverage / completion KPIs

All charts are **inline SVG** — no external dependencies. Report stays a portable single HTML file.

### 3.5 Theme (`theme.ts`)

Design tokens derived from the PNG mockups (the authoritative source). The PNGs show:

- **Background:** very dark navy gradient — nearly black-navy (`~#0a1628`) fading to slightly lighter navy (`~#0d1b2a / #14243a`). Subtle radial blue glow in top-left corner.
- **Gold accent:** amber-gold used for headings, borders, highlighted numbers (`~#e3a000–#e8b400` range — implementer should eyedrop from the PNG cover/title text).
- **Panel surfaces:** dark blue panels slightly lighter than the background (`~#0f2d4a / #132d4a`).
- **Level palette:** L1 = gold/amber, L2 = teal/cyan, L3 = steel blue, L4 = coral/red-orange (visible in the level chips on the cover and glossary pages).
- **Text:** near-white (`#eef4fb` approx.) for body; muted blue-grey for secondary labels.
- **Status colours:** green for سليمة/excellent, coral/red for priority/اشتباه issues, yellow for monitor.

**During implementation:** eyedrop exact hex values from the PNG images (cover page title gold, panel backgrounds, level chip colours). Do not copy from `xray_executive_report_preview_v4.html` — that file is outdated.

Exposed as CSS custom properties on `:root`. One `STYLE` string assembled once in `assemble.ts`. Font stack: `"IBM Plex Sans Arabic", "Noto Kufi Arabic", "Somar", "Tahoma", "Arial", sans-serif`.

---

## 4. Data layer

### 4.1 Reuse

`executiveReportData.ts` continues providing `buildExecutiveReportRows` and `calculateExecutiveKPIs`. `ExecutiveReportRow` already carries all fields for Parts 1–2 and Part 4. **One addition:** surface `answeredBy` on the row (it exists in the answer file but wasn't propagated to the row type).

### 4.2 New: `executiveEmployeeData.ts`

Computes per-employee analytics keyed off evaluator (`answeredBy ?? assignedTo`, submitted rows only).

```ts
type EmployeeProfile = {
  username: string;
  studied: number;
  workload: number;
  turnaroundHoursAvg: number | null;
  overallAccuracy: number | null;
  suspiciousDetectionRate: number | null;
  missedSuspicionRate: number | null;
  excessSuspicionRate: number | null;
  levelOneAccuracy: number | null;
  levelTwoAccuracy: number | null;
  byPort: Map<string, { studied: number; accuracy: number | null }>;
  byDecision: { onSuspicious: number | null; onClean: number | null };
  byImageQuality: Record<'عالي'|'متوسط'|'منخفض', { studied: number; accuracy: number|null }>;
  byMarking: { marked: { studied: number; accuracy: number|null }; unmarked: { studied: number; accuracy: number|null } };
  stabilityIndex: number | null;
  reliable: boolean;
  riskScore: number;
  recommendedAction: string;
};
```

Aggregate builders:
- `buildEmployeePortMatrix` → heatmap data (p.26)
- `buildDecisionQuadrant` → scatter points (p.25)
- `buildStabilityScatter` → workload × accuracy points (p.28)
- `buildPriorityList` → ranked employees + actions (p.30)
- `buildLevelAgreement` → L1-vs-L2 bars always; employee-pair heatmap only when ≥1 image has 2 distinct `answeredBy` (otherwise panel hidden)
- `buildDistributionSummary` → per-employee assignment counts × port (p.16) **[NEW]**

### 4.3 New page: Executive intro (`execIntro.ts`)

Reads from `calculateExecutiveKPIs` output only — no new data needed. Shows:
- 6 KPI cards: مجتمع الحالات, حجم العينة, نسبة التغطية, الحالات المدروسة, نسبة الإنجاز, الدقة الإجمالية
- Quick status row: one chip per section (Part 1–6) coloured by data completeness
- Brief narrative lines (Arabic, templated from live numbers)

### 4.4 New page: Distribution overview (`distributionOverview.ts`)

Reads from `DistributionCurrentData` (S3) + `EmployeeProfile[]`:
- Total assigned, completed, pending, replacement counts
- Per-employee assignment table: name, port, assigned, completed, pending, completion %
- Top 3 most/least loaded employees

### 4.5 Display-name resolution

`ExecutiveReportInput` carries `employeeDisplayNames: Record<string, string>` and `config.anonymizeEmployees: boolean`. `Reports/index.tsx` builds the map from `getPublicManagedUsers()`. `src/data/` never imports `src/auth/`.

---

## 5. The one data gap

**Page 22 right panel — توافق أزواج الموظفين** needs two evaluators on the same image. Normal flow assigns one evaluator per image, so this matrix is usually empty. `buildLevelAgreement` detects images with ≥2 distinct `answeredBy`. If none: right panel auto-hides, page renders L1-vs-L2 only. No fabricated data ever.

---

## 6. Phasing

### Phase 1 — Viewer shell + re-skin (~5 pages)
- `theme.ts`, `primitives.ts`, `viewer.ts`, `context.ts`, `assemble.ts`, `index.ts` shim
- Pages: cover, toc, glossary, part1Divider, populationByRisk, part2Divider, appendix
- Interactive viewer with sidebar + PDF button live; dark-navy theme; existing data wired
- **Exit:** report opens as viewer, sidebar nav works, print-to-PDF hides sidebar, Vitest green

### Phase 2 — Parts 1–3 complete
- Pages: execIntro, populationByLevel, sampleByLevel, part3Divider, distributionOverview
- New primitives: stacked bars, grouped bars, assignment table
- **Exit:** Parts 1–3 fully match mockups, all live data, tests green

### Phase 3 — Part 4 accuracy
- Pages: part4Divider, accuracyByPort, accuracyByLevel, levelAgreement
- New primitives: radar chart, conditional heatmap
- **Exit:** Part 4 matches mockups; L1-vs-L2 panel always renders; pair heatmap conditional

### Phase 4 — Parts 5–6 employee analytics
- `executiveEmployeeData.ts` + tests
- Pages: part5Divider, empOverview, empByDecision, empByPort, empImageQuality, empStability, part6Divider, empPriority
- New primitives: quadrant scatter, workload scatter, heatmap, priority cards
- Anonymize toggle wired through Reports tab
- **Exit:** full ~31-page report; insufficient-data states verified; tests green

---

## 7. Testing

- **Data:** Vitest (`node` env, `createMemoryDirectory`) for `executiveEmployeeData.ts` — accuracy math, decision split, stability, priority ranking, anonymization, insufficient-data / pair-agreement-absent branches.
- **Render smoke:** each page builder returns non-empty HTML for a fixture context and for an empty context (no throw, shows "بيانات غير كافية").
- **Visual:** browser preview screenshot per phase against corresponding mockup.

---

## 8. Constraints

- All UI text Arabic / RTL. Code identifiers English. Prefer label keys.
- Self-contained inline-SVG charts — no recharts, no external deps in the report HTML.
- Strict TS; guard `createWritable`; `import type` for types.
- Every code edit recorded in `docs/EDIT_LOG.md` before/after per CLAUDE.md.
- Public API unchanged except additive `employeeDisplayNames` / `anonymizeEmployees` inputs.

---

## 9. Out of scope

- Backend / persistence changes — none.
- Changes to inspection template or answer schema.
- Fabricating employee-pair agreement data (§5).
- The viewer sidebar is generated as static HTML — no React in the report output.
