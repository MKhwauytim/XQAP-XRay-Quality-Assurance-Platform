# Executive Report Rework — Design Spec

- **Date:** 2026-06-29
- **Status:** Approved design, ready for implementation planning
- **Source of truth for layout:** mockups in `C:\Users\WorkNStudy\Downloads\New folder (4)\` (21 PNGs). Mockups define *layout, structure, charts, and visual style only*. **All numbers, names, ports, and percentages in the final report come from live system data — never from the mockup placeholders (`XX%`).**

---

## 1. Goal

Replace the current ~5-page white printable executive report with the full **~23-page dark-navy report** shown in the mockups: a 9-section Arabic RTL document covering population, sample, inspection accuracy, and a new advanced **employee-analytics** section. Built in three shippable phases.

### Confirmed decisions

| Decision | Choice |
|----------|--------|
| Scope & delivery | **Full report, phased build** (3 phases, each shippable) |
| Medium & theme | **Dark navy + gold, screen/PDF-first**; keep landscape 13.33×7.5in, page-break-per-slide, `print-color-adjust: exact` |
| Employee identity | **Show display names by default** (Arabic `displayName`, e.g. "محمد العتيبي" — never the login username), with a **config toggle to anonymize** to codes (`موظف ١`, `موظف ٢`, …) |
| Data | **100% live system data.** No placeholders. Sections with insufficient data render a graceful "بيانات غير كافية" state, never `XX%` |

---

## 2. Architecture

### 2.1 Module layout

Today `executiveReport.ts` (787 lines) and `executiveReportData.ts` (515 lines) carry the whole report. At 23 pages this must be decomposed. New folder `src/data/reporting/executive/`:

```
executive/
  theme.ts            Dark-navy design tokens + shared CSS string (single source of truth)
  primitives.ts       Reusable render helpers (see 2.3)
  context.ts          ExecutiveRenderContext type + builder (KPIs + employee data + display-name map + config)
  pages/
    cover.ts          Cover                                   (mockup p.01)
    toc.ts            Table of contents                       (p.02)
    glossary.ts       Glossary + level definitions            (p.03)
    part1Divider.ts   "الجزء الأول — مجتمع الحالات"            (p.04)
    populationByRisk.ts    Population by risk type            (p.05)
    populationByLevel.ts   Population by levels & ports        (p.06)
    sampleByLevel.ts       Sample by levels & ports            (p.07)
    part2Divider.ts   "الجزء الثاني — نتائج الفحص"             (p.08)
    accuracyByPort.ts      Accuracy by port                   (p.09)
    accuracyByLevel.ts     Accuracy by levels                 (p.10)
    part3Divider.ts   "الجزء الثالث — التحاليل المتقدمة"       (p.13)
    part3Map.ts            Advanced-analysis map / contents    (p.14)
    empOverview.ts         Employee performance overview       (p.15)
    empByPort.ts           Employee comparison across ports    (p.18)
    empByDecision.ts       Accuracy by decision type           (p.16)
    empPerPort.ts          Performance per port                (p.17)
    empStability.ts        Stability & workload                (p.19)
    empImageQuality.ts     Image-quality & marking impact      (p.20)
    levelAgreement.ts      L1-vs-L2 + employee agreement       (p.22)
    empPriority.ts         Priority employees & actions        (p.23)
    appendix.ts            Appendix / methodology              (p.31)
  assemble.ts         Stitches selected pages in order, injects theme, page numbers, TOC anchors
  index.ts            Public API: openExecutiveReport, buildExecutiveReport, buildExecutiveXlsx
```

`src/data/reporting/executiveReport.ts` becomes a **thin re-export shim** of `executive/index.ts`, so `Reports/index.tsx` keeps importing `openExecutiveReport` / `buildExecutiveXlsx` with **no call-site change** beyond passing the new `employeeDisplayNames` map.

### 2.2 Each page module

Exports a pure function `(ctx: ExecutiveRenderContext) => string` returning one `<section class="xr-page">…</section>`. Independently readable and unit-testable. No page module imports another page module.

### 2.3 Shared primitives (`primitives.ts`)

Render helpers, each a pure `(props) => htmlString`, themed via CSS classes only:

- `kpiCard`, `statPill`, `sectionHeader`, `partDivider`, `noticeBox`
- `dataTable(headers, rows, opts)` — RTL table with status-tinted cells
- `barRow` / `horizontalBars`, `stackedBar`
- `radarChart` (level accuracy, p.10), `scatterChart` (workload×accuracy, p.19), `quadrantChart` (decision-type, p.16), `gauge`/`donut` (KPIs)
- `heatCell` — for employee×port matrices (p.18, p.22)

Charts are **inline SVG** (no recharts) so the report stays a self-contained portable HTML file, consistent with the existing report.

### 2.4 Theme (`theme.ts`)

Design tokens extracted from mockups: navy background gradient (`#0d1b2a → #14243a`), gold accent (`#e3b341`), level palette (L1 gold, L2 teal, L3 blue, L4 red), success/warn/danger tints, Arabic display font stack. Exposed as CSS custom properties on `:root`; one `STYLE` string assembled once in `assemble.ts`. Print block keeps the dark theme with `print-color-adjust: exact`.

---

## 3. Data layer

### 3.1 Reuse

`executiveReportData.ts` continues to provide `buildExecutiveReportRows`, `calculateExecutiveKPIs` (population / port / stage / quality KPIs), and formatters. `ExecutiveReportRow` already carries `assignedTo`, `answerStatus`, `expertResult`, `verificationCategory`, `imageQuality`, `hasMarking`, level accuracy fields — enough for Parts 1–2 and most of Part 3.

### 3.2 New: `executiveEmployeeData.ts`

Computes per-employee analytics, **keyed off the evaluator** (`ItemAnswer.answeredBy`, falling back to `distribution.assignedTo`). All metrics gated by `config.minimumReliableSampleSize`.

```ts
type EmployeeProfile = {
  username: string;
  studied: number;
  workload: number;            // assigned count
  turnaroundHoursAvg: number | null;  // submittedAt − assignedAt
  overallAccuracy: number | null;
  suspiciousDetectionRate: number | null;
  missedSuspicionRate: number | null;
  excessSuspicionRate: number | null;
  levelOneAccuracy: number | null;
  levelTwoAccuracy: number | null;
  byPort: Map<portName, { studied; accuracy: number | null }>;
  byDecision: { onSuspicious: number | null; onClean: number | null };
  byImageQuality: Record<"عالي"|"متوسط"|"منخفض", { studied; accuracy: number|null }>;
  byMarking: { marked; unmarked: { studied; accuracy: number|null } };
  stabilityIndex: number | null;   // dispersion of accuracy across ports/time
  reliable: boolean;
  riskScore: number;               // for priority ranking
  recommendedAction: string;       // derived label
};
```

Plus aggregate builders for the matrix/chart pages:
- `buildEmployeePortMatrix` → employee×port accuracy heatmap (p.18)
- `buildDecisionQuadrant` → points for the suspicious-vs-clean quadrant (p.16)
- `buildStabilityScatter` → workload×accuracy points + sizing (p.19)
- `buildPriorityList` → ranked employees + recommended actions (p.23)
- `buildLevelAgreement` → L1-vs-L2 agreement (always available) **and** employee-pair agreement (conditional — see §4)

### 3.3 Display-name resolution (decoupling)

`src/data/` must not import `src/auth/`. So:

1. `ExecutiveReportInput` gains `employeeDisplayNames: Record<string, string>` and `config.anonymizeEmployees: boolean`.
2. `Reports/index.tsx` builds the map from `getPublicManagedUsers()` before calling `openExecutiveReport`.
3. A single `displayName(username, ctx)` helper in `context.ts`:
   - `anonymizeEmployees` → `موظف ١`, `موظف ٢`, … (stable order by accuracy rank)
   - else → `employeeDisplayNames[username] ?? username`

---

## 4. The one data gap

**Page 22 right panel — "توافق أزواج الموظفين" (employee-pair agreement)** needs *two evaluators on the same image*. The normal flow assigns one evaluator per image, so this matrix is usually empty.

- **Left panel (L1-vs-L2 agreement): fully available** — renders always.
- **Right panel (pair agreement): conditional** — `buildLevelAgreement` detects images with ≥2 distinct `answeredBy` submissions (e.g. via referral/replacement second opinions). If none exist, the panel auto-hides and the page renders as the L1-vs-L2 comparison only. **No fabricated data.**

---

## 5. Page inventory (mockup → data → chart)

| # | Page | Source data | Primary visuals |
|---|------|-------------|-----------------|
| 01 | Cover | month, org branding, issue date, study month | Title block, level chips |
| 02 | TOC | static section list + live page numbers | Anchored index |
| 03 | Glossary + levels | `STUDY_LEVEL_DEFINITIONS`, term glossary | 4 level cards + term grid |
| 04 | Part 1 divider | — | Divider |
| 05 | Population by risk type | KPIs: population, clean/suspicious by port-type, per-port table | Stat pills + land/sea tables |
| 06 | Population by levels & ports | population split by level × port | Level cards + per-port matrix |
| 07 | Sample by levels & ports | sample size, coverage, per-port sample table | Coverage pills + tables |
| 08 | Part 2 divider | — | Divider |
| 09 | Accuracy by port | port profiles: accuracy, detection, missed-suspicion | KPI cards + horizontal bars + table |
| 10 | Accuracy by levels | L1/L2 accuracy, correction/regression rates | 4 level cards + radar chart |
| 13 | Part 3 divider | — | Divider |
| 14 | Part 3 map | section contents + page anchors | Index grid |
| 15 | Employee overview | `EmployeeProfile[]` ranked | KPI cards + ranked table + top-5 bars |
| 16 | Accuracy by decision type | `byDecision` per employee | Quadrant scatter + top/bottom lists |
| 17 | Performance per port | per-port employee breakdown | KPI cards + per-port table + bars |
| 18 | Employee comparison across ports | `buildEmployeePortMatrix` | Heatmap matrix + best/worst lists |
| 19 | Stability & workload | `buildStabilityScatter`, workload | Scatter (workload×accuracy) + bars |
| 20 | Image-quality & marking impact | `byImageQuality`, `byMarking` | Grouped bars + impact KPIs |
| 22 | L1-vs-L2 + employee agreement | `buildLevelAgreement` (§4) | Bars + conditional pair heatmap |
| 23 | Priority employees & actions | `buildPriorityList` | Ranked cards + action matrix |
| 31 | Appendix | methodology, definitions, config thresholds | Reference text |

(Mockup page numbers are non-contiguous because some mockups are dividers; the assembled report renumbers sequentially.)

---

## 6. Phasing

### Phase 1 — Shell & re-skin (shippable, replaces current report)
- `theme.ts`, `primitives.ts`, `context.ts`, `assemble.ts`, `index.ts` shim
- Pages: cover, toc, glossary, part1Divider, populationByRisk, part2Divider, accuracyByPort, accuracyByLevel, appendix
- Re-skins today's content to dark-navy; wires `employeeDisplayNames` plumbing (unused yet)
- **Exit:** report opens, all existing data correct, Vitest green, visual check in preview

### Phase 2 — Parts 1 & 2 completion
- Pages: populationByLevel, sampleByLevel, empty Part-2 gaps to full mockup fidelity
- New primitives: radar chart, stacked/grouped bars
- **Exit:** Parts 1–2 match mockups, fed by live data, tests green

### Phase 3 — Part 3 employee analytics
- `executiveEmployeeData.ts` + tests (memoryDirectory fixtures)
- Pages: part3Divider, part3Map, empOverview, empByDecision, empPerPort, empByPort, empStability, empImageQuality, levelAgreement, empPriority
- New primitives: quadrant, scatter, heatmap
- Anonymize toggle wired through Reports tab
- **Exit:** full 23-page report from live data; insufficient-data states verified; tests green

---

## 7. Testing

- **Data:** Vitest (`node` env, `createMemoryDirectory`) for `executiveEmployeeData.ts` — accuracy math, decision split, stability, priority ranking, anonymization, and the insufficient-data / pair-agreement-absent branches.
- **Render smoke:** each page builder returns non-empty HTML for a fixture context and for an empty context (no throw, shows "بيانات غير كافية").
- **Visual:** browser preview screenshot per phase against the corresponding mockup.

---

## 8. Constraints & conventions

- All UI text Arabic / RTL; code identifiers English. Prefer label keys where one fits.
- Self-contained inline-SVG charts (no recharts) — report must remain a portable single HTML file. Watch the single-file `dist/index.html` size budget; charts are SVG strings, not new deps.
- Strict TS; guard `createWritable`. `import type` for types.
- **Per CLAUDE.md: every code edit recorded in `docs/EDIT_LOG.md` (before/after) — applies to every phase.**
- Public API signatures unchanged except the additive `employeeDisplayNames` / `anonymizeEmployees` inputs.

---

## 9. Out of scope

- Backend/persistence changes — none; report reads existing workspace + browser data.
- Changes to the inspection template or answer schema.
- Fabricating employee-pair agreement when no overlapping evaluations exist (§4).
