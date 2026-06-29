# Executive Report Restructure + Per-Port Employee Section

**Date:** 2026-06-29
**Author:** Design & Architecture Planner (Opus)
**Status:** Ready for implementation
**Scope:** `src/data/reporting/executive/` — CSS, part dividers, sparse data pages, and a new per-port employee analysis section.
**Executors:** Sonnet implementation agents (Tasks 1–5 below).

> **CLAUDE.md gate:** Every code edit MUST be recorded in `docs/EDIT_LOG.md` (version, date, before, after) *before* it is applied. Each task below ends with an explicit edit-log reminder.

---

## 0. Context & Root-Cause Summary

The executive report builds a 25-page self-contained Arabic RTL HTML document. Each page is a fixed-aspect portrait `.page` (`aspect-ratio:1055/1491; min-height:760px`). Content lives inside `.page-inner` (a `z-index:2` box, `height:100%`, `overflow:hidden`, right-margin 44px for the rail). The HTML mockup `xray_executive_report_preview_v4.html` is the visual target.

Three structural problems, with verified root causes:

### Problem 1 — Part divider pages ~25% full
`theme.ts` `.big-divider` is `display:flex; flex-direction:column; justify-content:center; align-items:flex-end`. It centers a single content block vertically, leaving the top and bottom thirds of the page empty. There is no top header strip, no bottom element, and the giant-numeral background art is absent. `partDivider.ts` emits only `icon → kicker → h1 → rule → lead → page-no` with nothing to anchor the top/bottom.

### Problem 2 — Data pages tiny content, huge empty bottom
`.page-inner` does **not** establish a column flex context, so children stack at natural height and the remaining page height stays blank. `populationByRisk.ts` renders 3 metric cards + an info bar + a 2-column port-split, then stops. When `kpis.portProfiles` is sparse (or `clean`/`suspicious` are 0 because answers aren't in yet), the tables are 1–2 short rows and the page is ~30% full. There is no "fill the rest" layout band.

### Problem 3 — No per-port employee analysis (Section 3)
`empByPort.ts` shows **one** example port (top by population) and groups by the *QA reviewer* (`answeredBy`/`assignedTo`), not the original Level-1/Level-2 assessors. The user requires **one page per port** listing every employee who originally studied Level-1 and Level-2 cases from that port, with columns: Employee, Samples Studied, اشتباه count, سليمة count, Accuracy%, split by بري (land) / بحري (sea).

> **Critical data-model note for executors.** `row.levelOneEmployeeId` / `row.levelTwoEmployeeId` are the **original assessors** copied from population data (`executiveReportData.ts` lines 167–168: `pop.levelOneEmployee` / `pop.levelTwoEmployee`). These are present on **every** row regardless of whether a QA answer exists. They are NOT the same as `answeredBy`/`assignedTo` (the QA reviewer used by `buildEmployeeProfiles`). The new section is keyed on the original assessors. "Accuracy%" for an original assessor = share of their studied rows where their own level result matched the expert result (`levelOneAccurate` / `levelTwoAccurate`), computed only over rows that have a `verificationCategory` (i.e. a submitted expert answer exists).

---

## PART A — CSS fixes for empty space (`theme.ts`)

All edits are in `src/data/reporting/executive/theme.ts` inside the `EXEC_CSS` template literal. Show each before/after exactly.

### A.1 — `.page-inner` becomes a fill-the-page flex column

**Before** (lines 134–138):
```css
.page-inner{
  position:relative;z-index:2;height:100%;
  width:calc(100% - 44px);margin-right:44px;
  padding:30px 28px 36px 28px;overflow:hidden;
}
```

**After:**
```css
.page-inner{
  position:relative;z-index:2;height:100%;
  width:calc(100% - 44px);margin-right:44px;
  padding:30px 28px 36px 28px;overflow:hidden;
  display:flex;flex-direction:column;
}
/* The last meaningful content band on a data page absorbs leftover height
   so pages never end with a dead empty third. Builders add `.page-fill`
   to the element that should stretch (usually a table-wrap or a panel grid). */
.page-fill{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;}
.page-fill > .table-wrap{flex:1 1 auto;min-height:0;}
.page-fill .grid{flex:1 1 auto;align-content:start;}
/* Push the page number to the bottom regardless of content height. */
.page-inner > .page-no{margin-top:auto;}
```

> Note: `.page-no` is `position:absolute` so `margin-top:auto` is a no-op for it but harmless; the real spacer is `.page-fill`. The `.big-divider` overrides below re-establish its own layout.

### A.2 — `.big-divider` fills the full page, top-to-bottom

**Before** (lines 317–350):
```css
.big-divider{
  display:flex;flex-direction:column;
  justify-content:center;align-items:flex-end;
  padding:60px 48px;position:relative;overflow:hidden;height:100%;
}
.big-divider::before{
  content:"";position:absolute;
  top:-20%;left:-10%;width:70%;height:140%;
  background:radial-gradient(ellipse,rgba(244,180,0,.04) 0%,transparent 70%);
  pointer-events:none;
}
.big-divider .kicker{
  font-size:0.85rem;font-weight:600;letter-spacing:0.15em;
  color:var(--gold);text-transform:uppercase;margin-bottom:12px;
}
.big-divider h1{
  font-size:3.2rem;font-weight:800;color:#fff;
  line-height:1.05;margin:0 0 20px;letter-spacing:-0.02em;
  text-align:right;
}
.big-divider .rule{
  width:48px;height:3px;background:var(--gold);border-radius:2px;
  margin:0 0 24px auto;
}
.big-divider .lead{
  font-size:0.95rem;color:rgba(255,255,255,.6);
  line-height:1.8;max-width:500px;text-align:right;
}
.big-divider .icon{
  font-size:2.8rem;margin-bottom:16px;opacity:0.8;align-self:flex-end;
}
.big-divider .page-no{
  position:absolute;bottom:24px;left:50%;transform:translateX(-50%);
}
```

**After:**
```css
/* Grand part divider — three vertical bands (top header / center title / bottom toc),
   anchored by a giant ghost numeral painted across the whole page. */
.big-divider{
  display:flex;flex-direction:column;
  justify-content:space-between;align-items:stretch;
  padding:54px 48px 64px;position:relative;overflow:hidden;height:100%;
}
.big-divider::before{
  content:"";position:absolute;inset:0;
  background:
    radial-gradient(ellipse 70% 60% at 15% 30%,rgba(244,180,0,.07) 0%,transparent 70%),
    radial-gradient(ellipse 60% 50% at 90% 85%,rgba(107,169,248,.06) 0%,transparent 70%);
  pointer-events:none;z-index:0;
}
/* Giant ghost part-number behind everything. Builder sets --divider-num. */
.big-divider::after{
  content:var(--divider-num,"");
  position:absolute;left:-2%;bottom:-14%;
  font-size:30rem;font-weight:900;line-height:.8;
  color:rgba(255,255,255,.035);
  letter-spacing:-0.04em;pointer-events:none;z-index:0;
  font-family:"Somar","Arial",sans-serif;
}
.big-divider > *{position:relative;z-index:1;}
/* Top band: subtle org strip */
.big-divider .divider-top{
  display:flex;align-items:center;gap:14px;
  font-size:0.72rem;color:rgba(255,255,255,.45);
  border-bottom:1px solid rgba(255,255,255,.08);padding-bottom:16px;
}
.big-divider .divider-top .shield{
  width:30px;height:34px;flex-shrink:0;
  clip-path:polygon(50% 0,95% 18%,85% 72%,50% 100%,15% 72%,5% 18%);
  background:repeating-linear-gradient(135deg,rgba(219,231,243,.6) 0 2px,transparent 2px 5px);
}
/* Center band: the actual title, vertically dominant */
.big-divider .divider-center{
  flex:1 1 auto;display:flex;flex-direction:column;
  justify-content:center;align-items:flex-end;text-align:right;
}
.big-divider .icon{
  font-size:3.4rem;margin:0 0 18px;opacity:.85;align-self:flex-end;
  color:var(--gold);
}
.big-divider .kicker{
  font-size:1rem;font-weight:700;letter-spacing:0.22em;
  color:var(--gold);margin-bottom:14px;
}
.big-divider h1{
  font-size:4rem;font-weight:900;color:#fff;
  line-height:1.02;margin:0 0 22px;letter-spacing:-0.02em;text-align:right;
}
.big-divider .rule{
  width:64px;height:3px;background:var(--gold);border-radius:2px;
  margin:0 0 26px auto;
}
.big-divider .lead{
  font-size:1.05rem;color:rgba(255,255,255,.66);
  line-height:1.85;max-width:560px;text-align:right;margin:0 0 0 auto;
}
/* Bottom band: mini table-of-contents for this part */
.big-divider .divider-toc{
  display:grid;grid-template-columns:repeat(3,1fr);gap:12px;
  border-top:1px solid rgba(255,255,255,.08);padding-top:20px;
}
.big-divider .divider-toc .toc-chip{
  border:1px solid rgba(244,180,0,.28);border-radius:12px;
  padding:12px 14px;background:rgba(255,255,255,.025);
  display:flex;flex-direction:column;gap:4px;text-align:right;
}
.big-divider .divider-toc .toc-chip .n{
  font-size:0.7rem;color:var(--gold);font-weight:700;letter-spacing:0.08em;
}
.big-divider .divider-toc .toc-chip .t{
  font-size:0.86rem;color:rgba(255,255,255,.82);font-weight:600;line-height:1.4;
}
.big-divider .page-no{
  position:absolute;bottom:22px;left:50%;transform:translateX(-50%);z-index:2;
}
```

### A.3 — Sparse-data filler band (methodology / context panels)

Add a reusable two-column "context band" used by data pages to absorb empty space gracefully when tables are short. Append near the data-page utilities (after `.port-split` block, ~line 314):

**After (new rules — additive, no before):**
```css
/* ── Sparse-data context band — fills the lower third of data pages ───── */
.context-band{
  display:grid;grid-template-columns:1.4fr 1fr;gap:14px;margin-top:16px;
  flex:1 1 auto;align-items:stretch;
}
.context-band > .card{display:flex;flex-direction:column;}
.context-band .method-list{margin:6px 0 0;padding:0;list-style:none;display:grid;gap:10px;}
.context-band .method-list li{
  position:relative;padding-right:18px;font-size:0.82rem;
  color:rgba(255,255,255,.72);line-height:1.6;
}
.context-band .method-list li::before{
  content:"›";position:absolute;right:0;top:0;color:var(--gold);font-weight:700;
}
.context-band .stat-stack{display:grid;gap:12px;margin-top:auto;}
.context-band .stat-stack .stat-pill{
  display:flex;align-items:baseline;justify-content:space-between;
  border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:10px 12px;
  background:rgba(255,255,255,.02);
}
.context-band .stat-stack .stat-pill b{font-size:1.2rem;font-weight:800;}
.context-band .stat-stack .stat-pill span{font-size:0.78rem;color:var(--muted);}
@media(max-width:980px){.context-band{grid-template-columns:1fr;}}
```

### A.4 — Cover background art verification (no change unless missing)

`cover.ts` already emits `<div class="cover-bg-art">` and `.cover-bg-art` exists in `theme.ts` (lines 405–409). **Verify** the cover fills: `.cover .title-block{margin-top:48px}` plus `.level-strip` + `.badges` give ~70% fill. Strengthen the lower fill by adding a faint duplicate art blob bottom-right:

**Before** (lines 405–409):
```css
.cover-bg-art{
  position:absolute;left:-5%;top:15%;width:55%;height:70%;
  background:radial-gradient(ellipse at center,rgba(107,169,248,.06) 0%,transparent 60%);
  border-radius:50%;pointer-events:none;z-index:1;
}
```

**After:**
```css
.cover-bg-art{
  position:absolute;left:-5%;top:15%;width:55%;height:70%;
  background:radial-gradient(ellipse at center,rgba(107,169,248,.06) 0%,transparent 60%);
  border-radius:50%;pointer-events:none;z-index:1;
}
.cover-bg-art::after{
  content:"";position:absolute;right:-60%;bottom:-50%;width:120%;height:120%;
  background:radial-gradient(ellipse at center,rgba(244,180,0,.05) 0%,transparent 62%);
  border-radius:50%;
}
```

> **Edit-log:** record A.1–A.4 as **one v25.0 entry** (architectural CSS change), file `src/data/reporting/executive/theme.ts`, with before/after per rule block.

---

## PART B — Report restructure (25-page order)

Principle: Cover → Front matter → **Part 1 Population** → **Part 2 Results** → **Part 3 Advanced/Employee Analysis** → Actions → Appendix. No page > 80% empty. Each part transition is a `big-divider`. Sparse pages gain a `.context-band` filler. The new per-port section (Part C) is **dynamic** — one page per non-empty port — and sits inside Part 3.

> **Merge/split decisions:**
> - **MERGE** is not needed for the structural pages; the empty-space problem is solved by CSS fill + context bands, not by deleting pages.
> - **SPLIT (dynamic):** the single example `buildEmpByPort` page is replaced by N per-port pages (`buildPortEmployeeAnalysisPages`). The old single-example page is **removed** from the list.
> - **KEEP:** `buildEmpCrossPort` (matrix) remains — it complements the per-port pages.

### New page order

| # | Page ID | Arabic title | Content summary | Builder | Data source |
|---|---------|--------------|-----------------|---------|-------------|
| 01 | `page-cover` | الغلاف | Org block, title, level strip, badges, bg art | `buildCover` | `ctx.issueDate`, `ctx.monthLabel` |
| 02 | `page-toc` | الفهرس | 4-card index grid | `buildToc` | static + page map |
| 03 | `page-glossary` | المعجم والمستويات | Level + term definition cards | `buildGlossary` | static |
| 04 | `page-p1` | غلاف الجزء الأول | **Part 1 divider** (redesigned) | `buildPart1Divider` | static |
| 05 | `page-pop-risk` | مجتمع حالات المخاطر | Port-type split + **context band** | `buildPopulationByRisk` | `kpis.portProfiles`, `ctx.rows` |
| 06 | `page-pop-levels` | المجتمع حسب المستويات | Stage × port tables (+ fill) | `buildPopulationByLevel` | `kpis.stageProfiles`, `ctx.rows` |
| 07 | `page-sample-levels` | العينة حسب المستويات | Sample coverage by stage (+ fill) | `buildSampleByLevel` | `kpis`, `ctx.rows` |
| 08 | `page-p2` | غلاف الجزء الثاني | **Part 2 divider** (redesigned) | `buildPart2Divider` | static |
| 09 | `page-acc-port` | نتائج الدقة حسب المنفذ | Accuracy table by port (+ fill) | `buildAccuracyByPort` | `kpis.portProfiles` |
| 10 | `page-acc-level` | نتائج الدقة حسب المستويات | Accuracy cards by stage | `buildAccuracyByLevel` | `kpis` |
| 11 | `page-img-quality` | نتائج جودة الصور | Image-quality KPIs + table | `buildEmpImageQuality` | `kpis` |
| 12 | `page-suspect-cats` | الأصناف المشبوهة | Categories + smuggle heatmap | `buildSuspectCategories` | `ctx.rows` |
| 13 | `page-p3` | غلاف الجزء الثالث | **Part 3 divider** (redesigned, feature grid) | `buildPart3Divider` | static |
| 14 | `page-analytics-map` | خريطة التحليلات المتقدمة | 4-card section map | `buildAnalyticsMap` | static + port count |
| 15 | `page-emp-overview` | النظرة العامة لأداء الموظفين | QA-reviewer overview table | `buildEmpOverview` | `buildEmployeeProfiles` |
| 16 | `page-emp-decision` | دقة الموظفين حسب القرار | Decision-type quad + table | `buildEmpByDecision` | `buildEmployeeProfiles` |
| 17a…17n | `page-port-emp-{slug}` | أداء الموظفين — {port} | **NEW per-port employee pages** (1 per non-empty port) | `buildPortEmployeeAnalysisPages` | `ctx.rows` grouped by `portName` → L1/L2 assessors |
| 18 | `page-emp-cross-port` | مقارنة الموظفين بين المنافذ | QA-reviewer heatmap matrix | `buildEmpCrossPort` | `buildEmployeeProfiles` |
| 19 | `page-emp-stability` | استقرار الأداء وعبء العمل | Stability + workload | `buildEmpStability` | `buildEmployeeProfiles` |
| 20 | `page-img-impact` | أثر جودة الصورة والتحديد | Quality/marking impact quad | `buildEmpImageQualityImpact` | `buildEmployeeProfiles` |
| 21 | `page-error-types` | تحليل أنواع الأخطاء | Confusion-matrix quad + table | `buildErrorTypes` | `kpis`, `ctx.rows` |
| 22 | `page-level-agreement` | مقارنة المستويين والتوافق | L1 vs L2 + agreement matrix | `buildLevelAgreement` | `kpis`, `ctx.rows` |
| 23 | `page-emp-priority` | الأولوية والإجراءات | Priority buckets + actions | `buildEmpPriority` | `buildPriorityList` |
| 24 | `page-distribution` | نظرة عامة على التوزيع | Distribution summary | `buildDistributionOverview` | `ctx.input.distribution` |
| 25 | `page-appendix` | الملاحق | Methodology, data quality, glossary | `buildAppendix` | `kpis`, config |

> Page count is **25 + (N−1)** where N = number of non-empty ports, because slot 17 expands to N pages. The TOC (page 02) and Analytics Map (page 14) must reference the per-port section as a range (e.g. "17–{16+N}") rather than a fixed number.

---

## PART C — NEW SECTION: Per-port employee performance (detailed spec)

### C.1 — Goal

For **each port** (one page per port, ordered by population desc), list every employee who acted as an **original Level-1 or Level-2 assessor** on cases from that port. Two tables per page split by assessment level (المستوى الأول / المستوى الثاني), or a single combined table when a level has no employees. Columns: الموظف · العينات المدروسة · اشتباه · سليمة · الدقة%. Pages are grouped under بري (land) then بحري (sea) — the part order processes land ports first, then sea ports. Ports with **zero** assessor activity are skipped.

### C.2 — New file: `src/data/reporting/executive/portEmployeeData.ts`

Pure data-derivation helpers (no HTML). Exact TypeScript:

```ts
import type { ExecutiveReportRow } from "../executiveReportTypes";

export type PortEmployeeStat = {
  employeeId: string;
  /** rows where this employee was the assessor at the given level, for this port */
  studied: number;
  /** count of those rows whose ORIGINAL level result was اشتباه */
  suspicious: number;
  /** count of those rows whose ORIGINAL level result was سليمة */
  clean: number;
  /** accuracy% = (rows where this assessor's level result matched expertResult)
   *  / (studied rows that have a verificationCategory), or null if none verified */
  accuracy: number | null;
};

export type PortEmployeeGroup = {
  level: "one" | "two";
  levelLabel: string;          // "المستوى الأول" | "المستوى الثاني"
  employees: PortEmployeeStat[]; // sorted by studied desc, then accuracy desc
};

export type PortEmployeeAnalysis = {
  portName: string;
  portType: "land" | "sea";
  population: number;          // total rows for this port
  levelOne: PortEmployeeGroup;
  levelTwo: PortEmployeeGroup;
  hasAnyEmployees: boolean;    // false → page is skipped
};

function safePct(num: number, den: number): number | null {
  return den === 0 ? null : (num / den) * 100;
}

/**
 * Build one stat block per assessor for a single port at a single level.
 * `level` selects which employee id and which accuracy flag to read.
 */
function buildLevelGroup(
  portRows: ExecutiveReportRow[],
  level: "one" | "two",
): PortEmployeeGroup {
  const idKey  = level === "one" ? "levelOneEmployeeId" : "levelTwoEmployeeId";
  const resKey = level === "one" ? "levelOneResult"     : "levelTwoResult";
  const accKey = level === "one" ? "levelOneAccurate"   : "levelTwoAccurate";

  // accumulator keyed by employeeId
  const acc = new Map<string, {
    studied: number; suspicious: number; clean: number;
    verified: number; correct: number;
  }>();

  for (const r of portRows) {
    const emp = r[idKey] as string | null;
    if (!emp) continue;
    const rec = acc.get(emp) ?? { studied: 0, suspicious: 0, clean: 0, verified: 0, correct: 0 };
    rec.studied++;
    if (r[resKey] === "اشتباه") rec.suspicious++;
    else rec.clean++;
    // accuracy only over rows with an expert verdict
    if (r.verificationCategory !== null) {
      rec.verified++;
      if (r[accKey] === true) rec.correct++;
    }
    acc.set(emp, rec);
  }

  const employees: PortEmployeeStat[] = [...acc.entries()].map(([employeeId, rec]) => ({
    employeeId,
    studied: rec.studied,
    suspicious: rec.suspicious,
    clean: rec.clean,
    accuracy: safePct(rec.correct, rec.verified),
  })).sort((a, b) =>
    b.studied - a.studied || (b.accuracy ?? -1) - (a.accuracy ?? -1)
  );

  return {
    level,
    levelLabel: level === "one" ? "المستوى الأول" : "المستوى الثاني",
    employees,
  };
}

/**
 * Group all rows by portName and produce one analysis per port.
 * Land ports first (sorted by population desc), then sea ports.
 * portType falls back to a name heuristic when row.portType is null.
 */
export function buildPortEmployeeAnalyses(
  rows: ExecutiveReportRow[],
): PortEmployeeAnalysis[] {
  const byPort = new Map<string, ExecutiveReportRow[]>();
  for (const r of rows) {
    const port = r.portName ?? "غير محدد";
    if (!byPort.has(port)) byPort.set(port, []);
    byPort.get(port)!.push(r);
  }

  const analyses: PortEmployeeAnalysis[] = [...byPort.entries()].map(([portName, portRows]) => {
    const typeFromRow = portRows.find(r => r.portType)?.portType as ("land"|"sea"|undefined);
    const portType: "land" | "sea" =
      typeFromRow ?? (portName.includes("ميناء") ? "sea" : "land");
    const levelOne = buildLevelGroup(portRows, "one");
    const levelTwo = buildLevelGroup(portRows, "two");
    return {
      portName,
      portType,
      population: portRows.length,
      levelOne,
      levelTwo,
      hasAnyEmployees: levelOne.employees.length > 0 || levelTwo.employees.length > 0,
    };
  });

  // Land first (pop desc), then sea (pop desc).
  const rank = (a: PortEmployeeAnalysis) => (a.portType === "land" ? 0 : 1);
  return analyses
    .filter(a => a.hasAnyEmployees)
    .sort((a, b) => rank(a) - rank(b) || b.population - a.population);
}
```

> **Type access note for executor:** indexing `r[idKey]` where `idKey` is a union of literal keys is type-safe in strict mode because all four keys exist on `ExecutiveReportRow`. If TS complains about `r[resKey]`/`r[accKey]` widening, declare the key consts with `as const` (already implied by the ternary returning literals) or read fields explicitly via a small `switch (level)` instead of dynamic indexing. Prefer explicit field reads if the dynamic index trips strict mode.

### C.3 — New file: `src/data/reporting/executive/pages/portEmployeeAnalysis.ts`

Returns an **array** of page-builder closures (one per port). Each closure renders a full `.page`.

```ts
import type { ExecutiveRenderContext } from "../context";
import { esc, fmtNum, fmtPct } from "../primitives";
import {
  buildPortEmployeeAnalyses,
  type PortEmployeeGroup,
  type PortEmployeeAnalysis,
} from "../portEmployeeData";

const MAX_ROWS = 12; // truncate long employee lists

function slug(portName: string, idx: number): string {
  // stable, ascii-safe id; fall back to index because Arabic ids are awkward in URLs
  return `page-port-emp-${idx}`;
}

function levelTable(
  ctx: ExecutiveRenderContext,
  group: PortEmployeeGroup,
  accentClass: string,
): string {
  if (group.employees.length === 0) {
    return `<div class="card ${accentClass}">
      <div class="panel-title">${esc(group.levelLabel)}</div>
      <div class="notice-centered"><div>لا يوجد موظفون في هذا المستوى لهذا المنفذ</div></div>
    </div>`;
  }
  const shown = group.employees.slice(0, MAX_ROWS);
  const more  = group.employees.length > MAX_ROWS
    ? `<tr class="muted-row"><td colspan="5">... ${fmtNum(group.employees.length - MAX_ROWS)} موظف آخر</td></tr>`
    : "";
  const totStudied = group.employees.reduce((s, e) => s + e.studied, 0);
  const totSusp    = group.employees.reduce((s, e) => s + e.suspicious, 0);
  const totClean   = group.employees.reduce((s, e) => s + e.clean, 0);
  const rows = shown.map(e => `<tr>
      <td>${esc(ctx.displayName(e.employeeId))}</td>
      <td>${fmtNum(e.studied)}</td>
      <td>${fmtNum(e.suspicious)}</td>
      <td>${fmtNum(e.clean)}</td>
      <td>${fmtPct(e.accuracy)}</td>
    </tr>`).join("");
  return `<div class="card ${accentClass}">
    <div class="panel-title">${esc(group.levelLabel)} — ${fmtNum(group.employees.length)} موظف</div>
    <div class="table-wrap"><table>
      <thead><tr><th>الموظف</th><th>المدروسة</th><th>اشتباه</th><th>سليمة</th><th>الدقة</th></tr></thead>
      <tbody>
        ${rows}${more}
        <tr class="total-row">
          <td>الإجمالي</td><td>${fmtNum(totStudied)}</td>
          <td>${fmtNum(totSusp)}</td><td>${fmtNum(totClean)}</td><td>—</td>
        </tr>
      </tbody>
    </table></div>
  </div>`;
}

function buildPortPage(
  ctx: ExecutiveRenderContext,
  a: PortEmployeeAnalysis,
  idx: number,
  total: number,
): string {
  const typeLabel = a.portType === "land" ? "بري" : "بحري";
  const typeCls   = a.portType === "land" ? "land" : "sea";
  const totalEmp  = new Set([
    ...a.levelOne.employees.map(e => e.employeeId),
    ...a.levelTwo.employees.map(e => e.employeeId),
  ]).size;
  return `<section class="page compact" id="${slug(a.portName, idx)}" data-title="أداء موظفي ${esc(a.portName)}">
  <div class="right-rail">
    <div class="rail-main">الجزء الثالث <em>أداء الموظفين حسب المنفذ</em></div>
    <div class="rail-tab active">${esc(a.portName)}</div>
    <div class="rail-tab">${esc(typeLabel)}</div>
    <div class="rail-tab">${fmtNum(idx)}/${fmtNum(total)}</div>
  </div>
  <div class="page-inner">
    <h2 class="section-title">أداء الموظفين — ${esc(a.portName)}</h2>
    <div class="section-subtitle">موظفو المستوى الأول والثاني الذين درسوا حالات هذا المنفذ (${esc(typeLabel)})</div>
    <div class="grid grid-4">
      <div class="card ${typeCls}"><h3>نوع المنفذ</h3><div class="metric ${a.portType === "land" ? "green" : "blue"}" style="font-size:1.5rem">${esc(typeLabel)}</div></div>
      <div class="card"><h3>إجمالي حالات المنفذ</h3><div class="metric gold">${fmtNum(a.population)}</div></div>
      <div class="card"><h3>موظفو المستوى الأول</h3><div class="metric blue">${fmtNum(a.levelOne.employees.length)}</div></div>
      <div class="card"><h3>موظفو المستوى الثاني</h3><div class="metric slate">${fmtNum(a.levelTwo.employees.length)}</div></div>
    </div>
    <div class="info" style="margin:14px 0">الدقة% تُحتسب فقط على الحالات التي صدر بها رأي الخبير؛ "اشتباه/سليمة" تعكس النتيجة الأصلية للموظف في هذا المستوى. إجمالي الموظفين الفريدين: ${fmtNum(totalEmp)}.</div>
    <div class="port-split page-fill">
      ${levelTable(ctx, a.levelOne, "stage1")}
      ${levelTable(ctx, a.levelTwo, "stage2")}
    </div>
    <div class="page-no">${esc(String(16 + idx).padStart(2, "0"))}</div>
  </div>
</section>`;
}

/** Returns one page-builder closure per non-empty port (land first, then sea). */
export function buildPortEmployeeAnalysisPages(
  ctx: ExecutiveRenderContext,
): Array<(ctx: ExecutiveRenderContext) => string> {
  const analyses = buildPortEmployeeAnalyses(ctx.rows);
  if (analyses.length === 0) {
    // single graceful fallback page
    return [(_c) => `<section class="page compact" id="page-port-emp-empty" data-title="أداء الموظفين حسب المنفذ">
      <div class="right-rail">
        <div class="rail-main">الجزء الثالث <em>أداء الموظفين حسب المنفذ</em></div>
        <div class="rail-tab active">حسب المنفذ</div>
      </div>
      <div class="page-inner">
        <h2 class="section-title">أداء الموظفين حسب المنفذ</h2>
        <div class="section-subtitle">تحليل موظفي المستوى الأول والثاني لكل منفذ</div>
        <div class="notice-centered page-fill"><div>لا توجد بيانات موظفين كافية لهذه الفترة</div></div>
        <div class="page-no">17</div>
      </div>
    </section>`];
  }
  const total = analyses.length;
  return analyses.map((a, i) => (c: ExecutiveRenderContext) => buildPortPage(c, a, i + 1, total));
}
```

> **Page numbering:** the `.page-no` uses `16 + idx` so the first port page is 17. This is cosmetic only; the viewer's TOC numbers by DOM order anyway. Executors should not hard-fail on the printed number — keep it derived from `idx`.

### C.4 — Handling rules

- **0 employees for a port** → `hasAnyEmployees` is false → filtered out in `buildPortEmployeeAnalyses` → no page.
- **0 employees at one level only** → that level's `levelTable` renders the `notice-centered` empty block (page still balanced because the other table fills, and `.port-split.page-fill` stretches).
- **Many employees** → `MAX_ROWS = 12`, with a `muted-row` "... N موظف آخر" truncation line + a total row that sums **all** employees (not just shown).
- **Accuracy null** → `fmtPct(null)` already returns "—".
- **Anonymization** → use `ctx.displayName(e.employeeId)`; this honors `showEmployeeNames` config and reuses the anonymize map.
- **Part placement** → Part 3 (التحاليل المتقدمة), slot 17, between `buildEmpByDecision` (16) and `buildEmpCrossPort` (18). The old single-example `buildEmpByPort` is removed from the page list (file may stay for now but is no longer referenced — flag for deletion in Task 5).

### C.5 — Wiring into `index.ts`

Because the array-returning builder breaks the flat `pages: Builder[]` shape, splice it in:

**Before** (`index.ts` lines 70–96, the `pages` array):
```ts
  const pages = [
    buildCover,
    ...
    buildEmpByDecision,
    buildEmpByPort,
    buildEmpCrossPort,
    ...
  ];
```

**After:**
```ts
  const portEmpPages = buildPortEmployeeAnalysisPages(ctx); // one per port

  const pages = [
    buildCover,
    buildToc,
    buildGlossary,
    buildPart1Divider,
    buildPopulationByRisk,
    buildPopulationByLevel,
    buildSampleByLevel,
    buildPart2Divider,
    buildAccuracyByPort,
    buildAccuracyByLevel,
    buildEmpImageQuality,
    buildSuspectCategories,
    buildPart3Divider,
    buildAnalyticsMap,
    buildEmpOverview,
    buildEmpByDecision,
    ...portEmpPages,          // ← NEW: dynamic per-port pages (replaces buildEmpByPort)
    buildEmpCrossPort,
    buildEmpStability,
    buildEmpImageQualityImpact,
    buildErrorTypes,
    buildLevelAgreement,
    buildEmpPriority,
    buildDistributionOverview,
    buildAppendix,
  ];
```

Add the import at the top of `index.ts`:
```ts
import { buildPortEmployeeAnalysisPages } from "./pages/portEmployeeAnalysis";
```

Remove the now-unused `buildEmpByPort` from the import on line 27 (keep `buildEmpCrossPort`):
```ts
import { buildEmpCrossPort } from "./pages/empByPort";
```

> `assembleReport` already accepts `Array<(ctx) => string>` and maps `fn(ctx)`. The spliced closures each ignore their arg and close over the precomputed analysis, so `fn(ctx)` is safe.

> **Edit-log:** record C.2/C.3 as a **v26.0 entry** (new feature) with `**File:**` blocks for the two new files (Before = "(new file)"), and C.5 as part of the same entry for `index.ts` with before/after.

---

## PART D — Specific page redesigns (complete HTML)

### D.1 — Part divider (`partDivider.ts`) — full rewrite

Replace the whole `buildPartDivider` factory + the three exports. The factory now takes an extra `dividerNum` (for the ghost numeral) and a `toc` array of `{ n, t }` chips.

**Before** (`partDivider.ts` lines 4–22, the factory):
```ts
export function buildPartDivider(
  partLabel: string, title: string, subtitle: string, icon: string,
  pageId: string, pageNum: string, railTabs: string[], dataTitle: string,
): (_ctx: ExecutiveRenderContext) => string {
  return (_ctx) => `<section class="page" id="${pageId}" data-title="${esc(dataTitle)}">
  <div class="right-rail">
    <div class="rail-main">التقرير التنفيذي <em>لضمان جودة الأشعة</em></div>
    ${railTabs.map((t, i) => `<div class="rail-tab${i === 0 ? ' active' : ''}">${esc(t)}</div>`).join('')}
  </div>
  <div class="page-inner big-divider">
    <div class="icon">${icon}</div>
    <div class="kicker">${esc(partLabel)}</div>
    <h1>${esc(title)}</h1>
    <div class="rule"></div>
    <p class="lead">${esc(subtitle)}</p>
    <div class="page-no">${esc(pageNum)}</div>
  </div>
</section>`;
}
```

**After:**
```ts
type TocChip = { n: string; t: string };

export function buildPartDivider(
  partLabel: string, title: string, subtitle: string, icon: string,
  pageId: string, pageNum: string, railTabs: string[], dataTitle: string,
  dividerNum: string, toc: TocChip[],
): (_ctx: ExecutiveRenderContext) => string {
  const tocHtml = toc.map(c =>
    `<div class="toc-chip"><span class="n">${esc(c.n)}</span><span class="t">${esc(c.t)}</span></div>`
  ).join("");
  return (_ctx) => `<section class="page" id="${pageId}" data-title="${esc(dataTitle)}">
  <div class="right-rail">
    <div class="rail-main">التقرير التنفيذي <em>لضمان جودة الأشعة</em></div>
    ${railTabs.map((t, i) => `<div class="rail-tab${i === 0 ? ' active' : ''}">${esc(t)}</div>`).join('')}
  </div>
  <div class="page-inner big-divider" style="--divider-num:'${esc(dividerNum)}'">
    <div class="divider-top">
      <span class="shield" aria-hidden="true"></span>
      <span>هيئة الزكاة والضريبة والجمارك — إدارة ضمان جودة الأشعة اللاحقة</span>
    </div>
    <div class="divider-center">
      <div class="icon">${icon}</div>
      <div class="kicker">${esc(partLabel)}</div>
      <h1>${esc(title)}</h1>
      <div class="rule"></div>
      <p class="lead">${esc(subtitle)}</p>
    </div>
    <div class="divider-toc">${tocHtml}</div>
    <div class="page-no">${esc(pageNum)}</div>
  </div>
</section>`;
}
```

Updated exports:
```ts
export const buildPart1Divider = buildPartDivider(
  'الجزء الأول', 'مجتمع الحالات',
  'استعراض حجم المجتمع محل الدراسة وتوزيعه حسب المنفذ والمستوى ونمط الحركة تمهيدًا لتحليل النتائج والفجوات.',
  '◫', 'page-p1', '04', ['الجزء الأول', 'الجزء الثاني', 'الجزء الثالث'], 'غلاف الجزء الأول',
  '1', [
    { n: '05', t: 'مجتمع حالات المخاطر' },
    { n: '06', t: 'المجتمع حسب المستويات' },
    { n: '07', t: 'العينة حسب المستويات' },
  ],
);

export const buildPart2Divider = buildPartDivider(
  'الجزء الثاني', 'نتائج الفحص',
  'تحليل نتائج المراجعة ونسب الدقة والفجوات على مستوى المنفذ والمستوى.',
  '⌕', 'page-p2', '08', ['الجزء الأول', 'الجزء الثاني', 'الجزء الثالث'], 'غلاف الجزء الثاني',
  '2', [
    { n: '09', t: 'نتائج الدقة حسب المنفذ' },
    { n: '10', t: 'نتائج الدقة حسب المستويات' },
    { n: '11', t: 'نتائج جودة الصور' },
  ],
);

export const buildPart3Divider = buildPartDivider(
  'الجزء الثالث', 'التحاليل المتقدمة',
  'تحليلات متقدمة للكشف عن الأنماط الخفية في الأداء، وتحديد الفجوات التشغيلية وفرص التحسين.',
  '◈', 'page-p3', '13', ['الجزء الأول', 'الجزء الثاني', 'الجزء الثالث'], 'غلاف التحاليل المتقدمة',
  '3', [
    { n: '15', t: 'النظرة العامة لأداء الموظفين' },
    { n: '17', t: 'أداء الموظفين حسب المنفذ' },
    { n: '23', t: 'الأولوية والإجراءات' },
  ],
);

// Alias stubs kept for index.ts compatibility
export const buildPart4Divider = buildPart3Divider;
export const buildPart5Divider = buildPart3Divider;
export const buildPart6Divider = buildPart3Divider;
```

> The `--divider-num` CSS var is injected via inline `style` and read by `.big-divider::after { content:var(--divider-num) }`. Quote handling: the value is `'1'` (single-quoted inside the `style` attribute's double quotes) so the CSS `content` receives a quoted string. Executor must keep the single quotes.

### D.2 — `populationByRisk.ts` — graceful sparse fill

Replace the trailing layout (the `.port-split` block onward) so the page always fills via a `.context-band`, and the port-split itself stretches. Keep the existing data-derivation (lines 1–50) unchanged.

**Before** (lines 68–95, from `<div class="port-split">` through the closing `</section>`):
```ts
    <div class="port-split">
      <div class="card land">
        ...
      </div>
      <div class="card sea">
        ...
      </div>
    </div>
    <div class="page-no">05</div>
  </div>
</section>`;
```

**After:**
```ts
    <div class="port-split">
      <div class="card land">
        <div class="panel-title">المنافذ البرية</div>
        <div class="table-wrap"><table>
          <thead><tr><th>المنفذ</th><th>الإجمالي</th><th>سليمة</th><th>اشتباه</th></tr></thead>
          <tbody>
            ${landRows.map(portRow).join("")}
            ${landMore}
            ${landPorts.length > 0
              ? `<tr class="total-row"><td>الإجمالي</td><td>${fmtNum(landTotal)}</td><td>${fmtNum(landCleanTotal)}</td><td>${fmtNum(landSuspTotal)}</td></tr>`
              : `<tr class="total-row"><td colspan="4"><span class="muted">لا توجد منافذ برية</span></td></tr>`}
          </tbody>
        </table></div>
      </div>
      <div class="card sea">
        <div class="panel-title">المنافذ البحرية</div>
        <div class="table-wrap"><table>
          <thead><tr><th>المنفذ</th><th>الإجمالي</th><th>سليمة</th><th>اشتباه</th></tr></thead>
          <tbody>
            ${seaRows.map(portRow).join("")}
            ${seaMore}
            ${seaPorts.length > 0
              ? `<tr class="total-row"><td>الإجمالي</td><td>${fmtNum(seaTotal)}</td><td>${fmtNum(seaCleanTotal)}</td><td>${fmtNum(seaSuspTotal)}</td></tr>`
              : `<tr class="total-row"><td colspan="4"><span class="muted">لا توجد منافذ بحرية</span></td></tr>`}
          </tbody>
        </table></div>
      </div>
    </div>
    <div class="context-band">
      <div class="card">
        <div class="panel-title">منهجية تصنيف المجتمع</div>
        <ul class="method-list">
          <li>تُصنّف الحالة "اشتباه" إذا كانت نتيجة المستوى الأول أو الثاني = اشتباه، وإلا فهي "سليمة".</li>
          <li>يُقسّم المجتمع حسب نوع المنفذ (بري/بحري) ثم حسب المنفذ التابع له.</li>
          <li>تُرتّب المنافذ تنازليًا بحسب حجم المجتمع، وتُختصر القوائم الطويلة مع بيان العدد المتبقي.</li>
          <li>تُستخدم هذه الأرقام كأساس لحساب العينة ونِسب التغطية في الصفحات التالية.</li>
        </ul>
      </div>
      <div class="card">
        <div class="panel-title">ملخّص المجتمع</div>
        <div class="stat-stack">
          <div class="stat-pill"><span>إجمالي المنافذ</span><b>${fmtNum(landPorts.length + seaPorts.length)}</b></div>
          <div class="stat-pill"><span>منافذ برية</span><b>${fmtNum(landPorts.length)}</b></div>
          <div class="stat-pill"><span>منافذ بحرية</span><b>${fmtNum(seaPorts.length)}</b></div>
          <div class="stat-pill"><span>إجمالي المجتمع</span><b>${fmtNum(kpis.totalPopulation)}</b></div>
        </div>
      </div>
    </div>
    <div class="page-no">05</div>
  </div>
</section>`;
```

> Effect: even when both port tables have 1–2 rows, the `.context-band` (a `flex:1` grid) expands to fill the lower half with a methodology card + a summary stat-stack. Page is never < ~80% full.

### D.3 — `cover.ts` — verify, minor robustness

`cover.ts` is structurally correct. Only ensure the bg-art double-blob from A.4 is active (no markup change). Confirm `.title-block` + `.level-strip` + `.badges` render. **No code change required** unless the build shows the cover under-filled after A.1's `.page-inner{display:flex;flex-direction:column}` change — in which case wrap the cover content so the title block centers:

**Optional after (only if needed):** add `justify-content:center` to cover inner via a scoped rule in `theme.ts` (Task 1):
```css
.cover .page-inner{justify-content:center;}
```

> Decide during Task 5 review based on a rendered screenshot; do not pre-apply blindly.

---

## PART E — Implementation tasks (Sonnet agents)

> **Ordering:** Task 1 → Task 2 → (Task 3 ∥ Task 4) → Task 5. Tasks 3 and 4 are independent and may run in parallel after Tasks 1–2 land. Every task logs to `docs/EDIT_LOG.md` first.

### Task 1 — CSS fixes (`theme.ts` only)
- **Files:** `src/data/reporting/executive/theme.ts`, `docs/EDIT_LOG.md`.
- **Changes:** Apply Part A in full — A.1 (`.page-inner` flex + `.page-fill`/`.page-no` rules), A.2 (`.big-divider` three-band + ghost numeral + `.divider-top`/`.divider-center`/`.divider-toc`), A.3 (`.context-band` block), A.4 (`.cover-bg-art::after`). Add the responsive fallbacks for `.divider-toc` (`grid-template-columns:1fr` under 980px) and `.context-band` (already specified).
- **Edit-log:** one v25.0 entry, before/after per rule block.
- **Verify:** `npm run lint` clean; `npm run build` succeeds; grep `theme.ts` for `--divider-num`, `.page-fill`, `.context-band`, `.divider-toc` present. No TS — CSS is a string literal, so build = the only gate.

### Task 2 — Part divider redesign (`partDivider.ts`)
- **Files:** `src/data/reporting/executive/pages/partDivider.ts`, `docs/EDIT_LOG.md`.
- **Depends on:** Task 1 (needs the new `.big-divider`/`.divider-*` CSS).
- **Changes:** Apply Part D.1 — extend `buildPartDivider` signature with `dividerNum` + `toc`, rewrite the template, update the three exports with their TOC chips and divider numbers. Keep the `buildPart4/5/6Divider` aliases.
- **Edit-log:** v25.1 entry (small feature on top of v25.0), before/after of the factory + exports.
- **Verify:** `npm run build`; confirm `index.ts` still imports `buildPart1/2/3Divider` with no signature error (the new params are baked into the exported constants, not the call site).

### Task 3 — Sparse data page fills (`populationByRisk.ts`, `populationByLevel.ts`, `sampleByLevel.ts`)
- **Files:** `src/data/reporting/executive/pages/populationByRisk.ts`, `.../populationByLevel.ts`, `.../sampleByLevel.ts`, `docs/EDIT_LOG.md`.
- **Depends on:** Task 1 (uses `.context-band`, `.page-fill`).
- **Changes:**
  - `populationByRisk.ts`: apply Part D.2 (land-empty guard + `.context-band` filler).
  - `populationByLevel.ts`: add `class="page-fill"` to the `<div class="grid grid-2" style="margin-top:18px">` wrapper (line 83) so the stage tables stretch; append a single-line `.info` methodology note before `.page-no` if the page still ends short.
  - `sampleByLevel.ts`: **read the file first**, then add `.page-fill` to its primary grid/table-wrap and a `.context-band` (methodology + coverage stat-stack) mirroring D.2. (Builder not read in this plan — executor must inspect and apply the same pattern.)
- **Edit-log:** v25.2 entry, one `**File:**` block per file.
- **Verify:** `npm run build`; `npm run test:run` (no behavior change expected, but guards the report builders); visually confirm via a rendered report that pages 05/06/07 fill ≥ 80%.

### Task 4 — New per-port employee section
- **Files (new):** `src/data/reporting/executive/portEmployeeData.ts`, `src/data/reporting/executive/pages/portEmployeeAnalysis.ts`. **Files (edit):** `src/data/reporting/executive/index.ts`, `docs/EDIT_LOG.md`.
- **Depends on:** Task 1 (uses `.page-fill`, `.notice-centered`, `.port-split`).
- **Changes:** Create the two files per Part C.2 and C.3 verbatim (adjust dynamic-index typing to explicit field reads if strict mode complains — see C.2 note). Wire into `index.ts` per C.5: add import, compute `portEmpPages`, splice `...portEmpPages` in place of `buildEmpByPort`, drop `buildEmpByPort` from the `empByPort` import.
- **New test:** `src/data/reporting/executive/portEmployeeData.test.ts` — using a hand-built `ExecutiveReportRow[]` fixture:
  - two ports (one "ميناء..." sea, one land), each with 2 L1 employees and 1 L2 employee;
  - assert `buildPortEmployeeAnalyses` returns land first then sea;
  - assert a port with no `levelOneEmployeeId`/`levelTwoEmployeeId` is filtered out;
  - assert `accuracy` is null when no rows have `verificationCategory`, and equals expected % when some do;
  - assert `suspicious + clean === studied` per employee.
- **Edit-log:** v26.0 entry — `**File:**` blocks for both new files (Before: "(new file)") and `index.ts` before/after.
- **Verify:** `npm run lint`; `npm run build`; `npx vitest run src/data/reporting/executive/portEmployeeData.test.ts` green; full `npm run test:run` green.

### Task 5 — Integration, render review, cleanup
- **Files:** review-only + `docs/EDIT_LOG.md` if fixes land; possibly delete `pages/empByPort.ts`'s `buildEmpByPort` export if confirmed unused.
- **Depends on:** Tasks 1–4.
- **Changes / checks:**
  1. Build the report against a real month fixture (or the dev app) and open the HTML; screenshot every part divider (04/08/13), pages 05–07, and the new per-port pages.
  2. Confirm no page is > 20% empty; if a divider's `.divider-toc` overflows on a 3-chip row, reduce chip padding (theme tweak) — log it.
  3. Confirm the TOC (page 02) and Analytics Map (page 14) reference the per-port range correctly; update their static text to "17–N" wording if hard-coded numbers now mislead (read `toc.ts` and `analyticsMap.ts`, edit if needed, log it).
  4. Decide on D.3 optional `.cover .page-inner{justify-content:center}` based on the rendered cover.
  5. Confirm `buildEmpByPort` (single-example page) is fully unreferenced; if so, remove the function (keep `buildEmpCrossPort`) and log a v26.1 cleanup entry. If any test references it, update the test.
- **Verify:** `npm run lint && npm run build && npm run test:run` all green; manual screenshot review attached to the PR description.

---

## Appendix — Risk notes & invariants

- **`.page-inner` flex change is global.** Every non-divider page now lays out as a flex column. Pages that previously relied on natural block flow still work (children keep natural height; only `.page-fill` stretches). Watch for any page that used `margin:auto` centering tricks — none observed in the files read, but Task 5 must screenshot-check all 25 pages.
- **`overflow:hidden` on `.page-inner`** plus the viewer's `fitPages()` JS (scales `.page-inner` down if `scrollHeight > clientHeight`) means over-fill is auto-corrected; under-fill is what we are fixing. Adding `.context-band` (flex:1) cannot cause overflow because it only grows to remaining space.
- **Dynamic page count** ripples into any code that assumes 25 pages. Search for hard-coded `25`/`23` page counts before merge (none found in the executive builders, but check `toc.ts`/`analyticsMap.ts` in Task 5).
- **Original-assessor vs QA-reviewer distinction is the crux of Part C.** Do not refactor the new section to reuse `buildEmployeeProfiles` — that function groups by QA reviewer and would silently produce the wrong people. Keep `portEmployeeData.ts` independent.
- **Anonymization** flows through `ctx.displayName` for the new section; verify the per-port pages respect `showEmployeeNames:false` in Task 4's render review.
```