# Executive Report Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the current white executive report with a dark-navy interactive viewer (~31 pages, 9 sections) matching the PNG mockups in `C:\Users\WorkNStudy\Downloads\New folder (4)\`.

**Architecture:** New folder `src/data/reporting/executive/` with one file per page, shared theme/primitives, and a viewer shell. `executiveReport.ts` becomes a thin re-export shim. Font loading reuses the existing `import.meta.env.BASE_URL` pattern (same as current report).

**Tech Stack:** TypeScript, inline SVG charts, CSS custom properties, `window.print()` for PDF export.

## Global Constraints

- All UI text Arabic / RTL. Code identifiers English.
- Font: Somar via `import.meta.env.BASE_URL` — same pattern as current `executiveReport.ts` lines 486-489.
- Dark navy theme from PNG mockups (NOT from `xray_executive_report_preview_v4.html`).
- Inline SVG charts only — no recharts, no external deps in report HTML.
- Self-contained HTML output opened via `openOrDownload` (blob URL).
- Strict TS; `import type` for types.
- Every edit recorded in `docs/EDIT_LOG.md` before/after per CLAUDE.md.
- Page size: landscape 13.333in × 7.5in, `print-color-adjust: exact`.
- Sidebar on the **right** (RTL layout). PDF button hides sidebar via `@media print`.

---

## File Map

```
src/data/reporting/executive/
  theme.ts                  CSS string + design tokens
  primitives.ts             Pure HTML render helpers
  viewer.ts                 Outer viewer shell HTML
  context.ts                ExecutiveRenderContext type + builder
  pages/
    cover.ts                p.01
    toc.ts                  p.02
    execIntro.ts            p.03 — KPI dashboard
    glossary.ts             p.05
    part1Divider.ts         p.07
    populationByRisk.ts     p.08
    populationByLevel.ts    p.09
    part2Divider.ts         p.11
    sampleByLevel.ts        p.12
    part3Divider.ts         p.15
    distributionOverview.ts p.16
    part4Divider.ts         p.19
    accuracyByPort.ts       p.20
    accuracyByLevel.ts      p.21
    levelAgreement.ts       p.22
    part5Divider.ts         p.23
    empOverview.ts          p.24
    empByDecision.ts        p.25
    empByPort.ts            p.26
    empImageQuality.ts      p.27
    empStability.ts         p.28
    part6Divider.ts         p.29
    empPriority.ts          p.30
    appendix.ts             p.31
  executiveEmployeeData.ts  Per-employee analytics (NEW data module)
  assemble.ts               Stitches pages into viewer HTML
  index.ts                  Public API
src/data/reporting/executiveReport.ts   → thin shim (modify)
src/data/reporting/executiveReportTypes.ts → add answeredBy, employeeDisplayNames (modify)
```

---

## Phase 1 — Viewer shell + theme + cover/toc/glossary/population/appendix

### Task 1: Create `executive/theme.ts`

**Files:**
- Create: `src/data/reporting/executive/theme.ts`

**Interfaces:**
- Produces: `export const EXEC_CSS: string` — full CSS string including `@font-face`, `:root` tokens, base layout, `.xr-page`, viewer layout, print rules.

- [ ] Create `src/data/reporting/executive/theme.ts` with this exact content:

```ts
// Design tokens and CSS for the dark-navy executive report viewer.
// Colours eyedropped from PNG mockups in Downloads/New folder (4)/.

export const EXEC_CSS = `
@font-face{font-family:"Somar";src:url("${/* vite replaces at build */import.meta.env.BASE_URL}fonts/SomarSans-Regular.woff") format("woff");font-weight:400;font-style:normal;font-display:swap;}
@font-face{font-family:"Somar";src:url("${import.meta.env.BASE_URL}fonts/SomarSans-Light.woff") format("woff");font-weight:300;font-style:normal;font-display:swap;}
@font-face{font-family:"Somar";src:url("${import.meta.env.BASE_URL}fonts/SomarSans-Medium.woff") format("woff");font-weight:500;font-style:normal;font-display:swap;}
@font-face{font-family:"Somar";src:url("${import.meta.env.BASE_URL}fonts/SomarSans-Bold.woff") format("woff");font-weight:700;font-style:normal;font-display:swap;}
:root{
  --xr-bg:#0a1628;
  --xr-bg2:#0d1f36;
  --xr-panel:#0f2d4a;
  --xr-panel2:#132d4a;
  --xr-gold:#e3a000;
  --xr-gold2:#f4b824;
  --xr-blue:#4a9fd4;
  --xr-cyan:#1eb8c8;
  --xr-coral:#e8554a;
  --xr-green:#5cb85c;
  --xr-muted:#7a9bb5;
  --xr-white:#eef4fb;
  --xr-line:rgba(255,255,255,0.12);
  --xr-l1:var(--xr-gold);
  --xr-l2:var(--xr-cyan);
  --xr-l3:var(--xr-blue);
  --xr-l4:var(--xr-coral);
}
*{box-sizing:border-box;margin:0;padding:0;}
html{scroll-behavior:smooth;}
body{
  font-family:"Somar","IBM Plex Sans Arabic","Noto Kufi Arabic",Tahoma,Arial,sans-serif;
  direction:rtl;
  color:var(--xr-white);
  background:
    radial-gradient(circle at 90% 5%, rgba(74,159,212,0.14) 0%, transparent 28%),
    linear-gradient(180deg, var(--xr-bg) 0%, var(--xr-bg2) 100%);
  min-height:100vh;
  font-variant-numeric:tabular-nums;
}
/* ── Viewer layout ── */
.xr-viewer{display:grid;grid-template-columns:minmax(0,1fr) 280px;min-height:100vh;}
.xr-slides{padding:24px 20px;}
.xr-sidebar{
  position:sticky;top:0;height:100vh;overflow-y:auto;
  background:rgba(8,18,34,0.97);
  border-left:1px solid var(--xr-line);
  padding:20px 16px;
  display:flex;flex-direction:column;gap:16px;
}
.xr-brand{padding-bottom:14px;border-bottom:1px solid var(--xr-line);}
.xr-brand strong{display:block;font-size:14px;color:var(--xr-white);font-weight:700;}
.xr-brand span{display:block;font-size:11px;color:var(--xr-muted);margin-top:3px;}
.xr-pdf-btn{
  width:100%;padding:10px;border:none;border-radius:8px;cursor:pointer;
  background:var(--xr-gold);color:#0a1628;font-family:inherit;
  font-size:13px;font-weight:700;
}
.xr-pdf-btn:hover{background:var(--xr-gold2);}
.xr-nav-title{font-size:11px;color:var(--xr-gold);font-weight:700;margin-top:4px;}
.xr-nav{display:grid;gap:4px;}
.xr-nav a{
  display:block;padding:7px 10px;border-radius:6px;
  color:var(--xr-muted);font-size:12px;font-weight:600;text-decoration:none;
  border:1px solid transparent;
}
.xr-nav a:hover{color:var(--xr-white);background:var(--xr-panel);border-color:var(--xr-line);}
/* ── Slide page ── */
.xr-page{
  width:13.333in;height:7.5in;
  margin:0 auto 20px;
  background:
    radial-gradient(circle at 88% 8%, rgba(74,159,212,0.13) 0%, transparent 30%),
    linear-gradient(145deg, var(--xr-bg) 0%, var(--xr-bg2) 100%);
  border:1px solid var(--xr-line);
  border-radius:4px;
  position:relative;overflow:hidden;isolation:isolate;
  page-break-after:always;break-after:page;
}
.xr-page-inner{
  position:absolute;inset:0;
  padding:0.38in 0.5in 0.32in;
  display:flex;flex-direction:column;
}
/* ── Slide header ── */
.xr-slide-head{
  display:flex;align-items:center;justify-content:space-between;
  border-bottom:1px solid var(--xr-line);
  padding-bottom:0.1in;margin-bottom:0.14in;
}
.xr-slide-head h2{font-size:0.26in;font-weight:800;color:var(--xr-white);}
.xr-slide-head .xr-pg{font-size:0.14in;color:var(--xr-muted);font-weight:700;direction:ltr;}
/* ── Page footer ── */
.xr-footer{
  position:absolute;left:0.5in;right:0.5in;bottom:0.14in;
  border-top:1px solid var(--xr-line);padding-top:0.05in;
  display:flex;align-items:center;justify-content:space-between;
  color:var(--xr-muted);font-size:0.075in;font-weight:600;
}
/* ── Cover ── */
.xr-cover{
  background:
    radial-gradient(circle at 80% 50%, rgba(74,159,212,0.18) 0%, transparent 40%),
    linear-gradient(135deg, #081422 0%, #0d1f38 60%, #0a1828 100%);
}
.xr-cover-top{
  position:absolute;top:0;right:0;left:0;
  padding:0.24in 0.5in;
  display:flex;align-items:flex-start;justify-content:space-between;
  border-bottom:1px solid rgba(227,160,0,0.25);
}
.xr-cover-org{font-size:0.083in;line-height:1.7;color:var(--xr-muted);font-weight:600;max-width:6in;}
.xr-cover-logo{width:0.6in;height:0.6in;border:1px solid var(--xr-gold);border-radius:10px;display:grid;place-items:center;color:var(--xr-gold);font-size:0.28in;}
.xr-cover-main{
  position:absolute;top:1.35in;right:0.5in;left:0.5in;
}
.xr-cover-eyebrow{font-size:0.11in;color:var(--xr-cyan);font-weight:700;margin-bottom:0.1in;letter-spacing:0.02em;}
.xr-cover-title{font-size:0.58in;font-weight:800;line-height:1.15;color:var(--xr-white);}
.xr-cover-title span{color:var(--xr-gold);}
.xr-cover-meta{display:flex;gap:0.28in;margin-top:0.28in;}
.xr-cover-meta-item{display:flex;align-items:center;gap:0.08in;font-size:0.095in;color:var(--xr-muted);font-weight:600;}
.xr-cover-meta-item b{color:var(--xr-white);font-weight:700;}
.xr-cover-levels{
  position:absolute;bottom:0.32in;right:0.5in;left:0.5in;
  display:grid;grid-template-columns:repeat(4,1fr);gap:0.1in;
}
.xr-level-chip{
  display:flex;align-items:center;gap:0.07in;
  border:1px solid var(--xr-line);border-radius:6px;
  padding:0.07in 0.1in;
  background:rgba(255,255,255,0.04);
}
.xr-level-chip-dot{width:0.12in;height:0.12in;border-radius:50%;flex-shrink:0;}
.xr-level-chip-text strong{display:block;font-size:0.085in;font-weight:700;color:var(--xr-white);}
.xr-level-chip-text span{display:block;font-size:0.073in;color:var(--xr-muted);font-weight:600;}
/* ── Part divider ── */
.xr-divider{
  background:
    radial-gradient(circle at 20% 50%, rgba(227,160,0,0.12) 0%, transparent 35%),
    linear-gradient(135deg, #081422 0%, #0d1f38 100%);
  display:flex;align-items:center;justify-content:center;
}
.xr-divider-inner{text-align:center;}
.xr-divider-icon{font-size:0.55in;margin-bottom:0.15in;opacity:0.7;}
.xr-divider-eyebrow{font-size:0.13in;color:var(--xr-gold);font-weight:700;margin-bottom:0.08in;}
.xr-divider-title{font-size:0.52in;font-weight:800;color:var(--xr-white);line-height:1.1;}
.xr-divider-sub{font-size:0.12in;color:var(--xr-muted);margin-top:0.12in;max-width:6in;line-height:1.6;}
/* ── KPI cards ── */
.xr-kpi-grid{display:grid;gap:0.1in;}
.xr-kpi-grid-3{grid-template-columns:repeat(3,1fr);}
.xr-kpi-grid-4{grid-template-columns:repeat(4,1fr);}
.xr-kpi-grid-6{grid-template-columns:repeat(6,1fr);}
.xr-kpi{
  background:var(--xr-panel);border:1px solid var(--xr-line);border-radius:8px;
  padding:0.1in 0.12in;
}
.xr-kpi-label{font-size:0.08in;color:var(--xr-muted);font-weight:600;margin-bottom:0.04in;}
.xr-kpi-value{font-size:0.26in;font-weight:800;color:var(--xr-white);direction:ltr;text-align:right;}
.xr-kpi-sub{font-size:0.075in;color:var(--xr-muted);margin-top:0.03in;}
.xr-kpi.good .xr-kpi-value{color:var(--xr-green);}
.xr-kpi.warn .xr-kpi-value{color:var(--xr-gold);}
.xr-kpi.risk .xr-kpi-value{color:var(--xr-coral);}
.xr-kpi.accent{border-color:var(--xr-gold);border-top:2px solid var(--xr-gold);}
/* ── Tables ── */
.xr-table-wrap{border:1px solid var(--xr-line);border-radius:8px;overflow:hidden;}
.xr-table{width:100%;border-collapse:collapse;font-size:0.082in;}
.xr-table th{background:rgba(227,160,0,0.15);color:var(--xr-gold);padding:0.065in 0.07in;text-align:center;font-weight:700;white-space:nowrap;}
.xr-table td{padding:0.055in 0.06in;border-bottom:1px solid var(--xr-line);text-align:center;color:var(--xr-white);font-weight:600;}
.xr-table tr:last-child td{border-bottom:0;}
.xr-table tr:nth-child(even) td{background:rgba(255,255,255,0.03);}
.xr-table .total-row td{background:rgba(227,160,0,0.08);color:var(--xr-gold);font-weight:800;}
.xr-table .insuff{color:var(--xr-muted);font-style:italic;}
/* ── Bar rows ── */
.xr-bars{display:grid;gap:0.072in;}
.xr-bar-row{display:grid;grid-template-columns:1.1in 1fr 0.5in;gap:0.07in;align-items:center;}
.xr-bar-row span{font-size:0.082in;font-weight:600;color:var(--xr-white);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.xr-bar-track{height:0.12in;background:rgba(255,255,255,0.08);border-radius:3px;overflow:hidden;}
.xr-bar-fill{height:100%;border-radius:3px;background:var(--xr-gold);}
.xr-bar-fill.good{background:var(--xr-green);}
.xr-bar-fill.risk{background:var(--xr-coral);}
.xr-bar-fill.blue{background:var(--xr-blue);}
.xr-bar-row b{font-size:0.082in;font-weight:800;color:var(--xr-white);direction:ltr;text-align:left;}
/* ── Status badge ── */
.xr-badge{display:inline-block;padding:0.025in 0.07in;border-radius:4px;font-size:0.075in;font-weight:700;}
.xr-badge.excellent{background:rgba(92,184,92,0.2);color:var(--xr-green);}
.xr-badge.stable{background:rgba(74,159,212,0.2);color:var(--xr-blue);}
.xr-badge.monitor{background:rgba(227,160,0,0.2);color:var(--xr-gold);}
.xr-badge.priority,.xr-badge.risk{background:rgba(232,85,74,0.2);color:var(--xr-coral);}
.xr-badge.insufficient{background:rgba(255,255,255,0.08);color:var(--xr-muted);}
/* ── Notice box ── */
.xr-notice{
  border-right:3px solid var(--xr-gold);
  background:rgba(227,160,0,0.07);
  border-radius:0 6px 6px 0;
  padding:0.09in 0.12in;
  font-size:0.082in;color:var(--xr-muted);line-height:1.55;font-weight:600;
}
/* ── Level cards (glossary) ── */
.xr-level-cards{display:grid;grid-template-columns:repeat(4,1fr);gap:0.1in;}
.xr-level-card{border-radius:8px;overflow:hidden;border:1px solid var(--xr-line);}
.xr-level-card-head{padding:0.1in 0.12in;text-align:center;}
.xr-level-card-head h3{font-size:0.16in;font-weight:800;color:#0a1628;margin-bottom:0.03in;}
.xr-level-card-head span{font-size:0.082in;font-weight:700;color:rgba(10,22,40,0.7);}
.xr-level-card-body{padding:0.1in 0.12in;background:var(--xr-panel);font-size:0.083in;line-height:1.6;color:var(--xr-muted);font-weight:600;}
.xr-l1-card .xr-level-card-head{background:var(--xr-gold);}
.xr-l2-card .xr-level-card-head{background:var(--xr-cyan);}
.xr-l3-card .xr-level-card-head{background:var(--xr-blue);}
.xr-l4-card .xr-level-card-head{background:var(--xr-coral);}
/* ── TOC ── */
.xr-toc-grid{display:grid;gap:0.08in;}
.xr-toc-row{
  display:grid;grid-template-columns:0.25in 1fr 0.35in;gap:0.1in;align-items:center;
  padding:0.07in 0.1in;border-radius:6px;
  border:1px solid var(--xr-line);background:var(--xr-panel);
  text-decoration:none;color:var(--xr-white);
}
.xr-toc-row:hover{border-color:var(--xr-gold);}
.xr-toc-num{font-size:0.13in;font-weight:800;color:var(--xr-gold);text-align:center;}
.xr-toc-label{font-size:0.092in;font-weight:700;}
.xr-toc-pg{font-size:0.088in;color:var(--xr-muted);direction:ltr;text-align:left;}
/* ── Section title ── */
.xr-section-title{font-size:0.2in;font-weight:800;color:var(--xr-gold);margin-bottom:0.12in;}
/* ── Glossary terms ── */
.xr-terms-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:0.08in;margin-top:0.1in;}
.xr-term{background:var(--xr-panel);border:1px solid var(--xr-line);border-radius:6px;padding:0.08in 0.1in;}
.xr-term-icon{font-size:0.2in;margin-bottom:0.05in;}
.xr-term-name{font-size:0.09in;font-weight:800;color:var(--xr-white);margin-bottom:0.03in;}
.xr-term-def{font-size:0.078in;color:var(--xr-muted);line-height:1.5;font-weight:600;}
/* ── Two-column layout ── */
.xr-cols{display:grid;gap:0.13in;align-items:start;}
.xr-cols-2{grid-template-columns:1fr 1fr;}
.xr-cols-3{grid-template-columns:1fr 1fr 1fr;}
.xr-cols-6-4{grid-template-columns:1.5fr 1fr;}
.xr-panel{background:var(--xr-panel);border:1px solid var(--xr-line);border-radius:8px;padding:0.12in;}
.xr-panel-title{font-size:0.1in;font-weight:800;color:var(--xr-gold);margin-bottom:0.09in;}
/* ── Heatmap cell ── */
.xr-heat-cell{
  display:inline-block;padding:0.03in 0.06in;border-radius:3px;
  font-size:0.078in;font-weight:700;min-width:0.55in;text-align:center;
}
.xr-heat-high{background:rgba(92,184,92,0.25);color:var(--xr-green);}
.xr-heat-mid{background:rgba(227,160,0,0.2);color:var(--xr-gold);}
.xr-heat-low{background:rgba(232,85,74,0.2);color:var(--xr-coral);}
.xr-heat-insuff{background:rgba(255,255,255,0.05);color:var(--xr-muted);}
/* ── Print ── */
@media print{
  @page{size:13.333in 7.5in;margin:0;}
  body{background:#0a1628 !important;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  .xr-sidebar{display:none !important;}
  .xr-viewer{display:block;}
  .xr-slides{padding:0;}
  .xr-page{margin:0;border:0;border-radius:0;box-shadow:none;page-break-after:always;break-after:page;}
  .xr-page:last-child{page-break-after:auto;break-after:auto;}
}
`;
```

- [ ] Add edit log entry to `docs/EDIT_LOG.md`:

```markdown
## v{next} — 2026-06-29 — executive report rework: create theme.ts

**File:** `src/data/reporting/executive/theme.ts`

**Before:** (file did not exist)

**After:** New file — EXEC_CSS string with dark-navy tokens, Somar @font-face (BASE_URL pattern), viewer layout, slide pages, all shared CSS classes.
```

- [ ] Commit: `git add src/data/reporting/executive/theme.ts docs/EDIT_LOG.md && git commit -m "feat(executive-report): add dark-navy theme CSS"`

---

### Task 2: Create `executive/primitives.ts`

**Files:**
- Create: `src/data/reporting/executive/primitives.ts`

**Interfaces:**
- Produces:
  - `esc(s): string` — HTML escape
  - `kpiCard({label, value, sub?, tone?}): string`
  - `statPill({label, value}): string`
  - `barRow({label, value, max, tone?}): string`
  - `badgeHtml(status): string`
  - `heatCell(pct): string`
  - `dataTable({headers, rows, totalRow?}): string`
  - `noticeBox(text): string`
  - `radarSvg(points: {label:string; value:number}[]): string` — inline SVG radar
  - `fmtPct(n: number|null): string`
  - `fmtNum(n: number): string`

- [ ] Create `src/data/reporting/executive/primitives.ts`:

```ts
export function esc(s: string | null | undefined): string {
  return (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function fmtNum(n: number): string {
  return n.toLocaleString("ar-SA-u-nu-latn");
}

export function fmtPct(n: number | null, digits = 1): string {
  if (n === null) return "—";
  return n.toFixed(digits) + "%";
}

type KpiCardOpts = { label: string; value: string; sub?: string; tone?: "good" | "warn" | "risk" | "accent" | "" };
export function kpiCard({ label, value, sub, tone = "" }: KpiCardOpts): string {
  return `<div class="xr-kpi${tone ? " " + tone : ""}">
    <div class="xr-kpi-label">${esc(label)}</div>
    <div class="xr-kpi-value">${esc(value)}</div>
    ${sub ? `<div class="xr-kpi-sub">${esc(sub)}</div>` : ""}
  </div>`;
}

type BarRowOpts = { label: string; value: number | null; max: number; tone?: "good" | "risk" | "blue" | "" };
export function barRow({ label, value, max, tone = "" }: BarRowOpts): string {
  const pct = (value === null || max === 0) ? 0 : Math.min(100, (value / max) * 100);
  return `<div class="xr-bar-row">
    <span>${esc(label)}</span>
    <div class="xr-bar-track"><div class="xr-bar-fill${tone ? " " + tone : ""}" style="width:${pct.toFixed(1)}%"></div></div>
    <b>${value === null ? "—" : fmtPct(value)}</b>
  </div>`;
}

export function badgeHtml(status: "excellent" | "stable" | "monitor" | "priority" | "insufficient" | string): string {
  const labels: Record<string, string> = {
    excellent: "ممتاز", stable: "مستقر", monitor: "متابعة", priority: "أولوية", insufficient: "بيانات غير كافية",
  };
  return `<span class="xr-badge ${esc(status)}">${esc(labels[status] ?? status)}</span>`;
}

export function heatCell(pct: number | null): string {
  if (pct === null) return `<span class="xr-heat-cell xr-heat-insuff">—</span>`;
  const cls = pct >= 90 ? "xr-heat-high" : pct >= 75 ? "xr-heat-mid" : "xr-heat-low";
  return `<span class="xr-heat-cell ${cls}">${fmtPct(pct)}</span>`;
}

type TableOpts = { headers: string[]; rows: (string | number | null)[][]; totalRow?: (string | number | null)[] };
export function dataTable({ headers, rows, totalRow }: TableOpts): string {
  const th = headers.map(h => `<th>${esc(String(h))}</th>`).join("");
  const trs = rows.map(r =>
    `<tr>${r.map(c => `<td>${c === null ? '<span class="insuff">—</span>' : esc(String(c))}</td>`).join("")}</tr>`
  ).join("");
  const tot = totalRow
    ? `<tr class="total-row">${totalRow.map(c => `<td>${c === null ? "" : esc(String(c))}</td>`).join("")}</tr>`
    : "";
  return `<div class="xr-table-wrap"><table class="xr-table"><thead><tr>${th}</tr></thead><tbody>${trs}${tot}</tbody></table></div>`;
}

export function noticeBox(text: string): string {
  return `<div class="xr-notice">${esc(text)}</div>`;
}

export function pagePanel(title: string, body: string): string {
  return `<div class="xr-panel"><div class="xr-panel-title">${esc(title)}</div>${body}</div>`;
}

/** Minimal inline SVG radar for up to 6 axes. values 0–100. */
export function radarSvg(points: { label: string; value: number }[]): string {
  const n = points.length;
  if (n < 3) return "";
  const cx = 150, cy = 130, r = 100;
  const angle = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2;
  const pt = (i: number, scale: number) => {
    const a = angle(i);
    return [cx + Math.cos(a) * r * scale, cy + Math.sin(a) * r * scale];
  };
  const rings = [0.25, 0.5, 0.75, 1].map(s =>
    `<polygon points="${points.map((_, i) => pt(i, s).join(",")).join(" ")}" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>`
  ).join("");
  const axes = points.map((_, i) => {
    const [x, y] = pt(i, 1);
    return `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="rgba(255,255,255,0.12)" stroke-width="1"/>`;
  }).join("");
  const dataPath = points.map((p, i) => {
    const [x, y] = pt(i, p.value / 100);
    return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ") + "Z";
  const labels = points.map((p, i) => {
    const [x, y] = pt(i, 1.22);
    const anchor = x < cx - 5 ? "end" : x > cx + 5 ? "start" : "middle";
    return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}" font-size="9" fill="#7a9bb5" font-family="Somar,Arial">${esc(p.label)}</text>`;
  }).join("");
  return `<svg viewBox="0 0 300 260" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
    ${rings}${axes}
    <path d="${dataPath}" fill="rgba(227,160,0,0.18)" stroke="#e3a000" stroke-width="2"/>
    ${points.map((p, i) => { const [x,y] = pt(i, p.value/100); return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="#e3a000"/>`; }).join("")}
    ${labels}
  </svg>`;
}
```

- [ ] Edit log entry + commit: `feat(executive-report): add primitives helpers`

---

### Task 3: Create `executive/context.ts`

**Files:**
- Create: `src/data/reporting/executive/context.ts`

**Interfaces:**
- Consumes: `ExecutiveReportInput`, `ExecutiveKPIs`, `PortProfile`, `StageProfile` from `executiveReportTypes.ts`
- Produces: `ExecutiveRenderContext` type + `buildContext(input, kpis): ExecutiveRenderContext`

- [ ] Create `src/data/reporting/executive/context.ts`:

```ts
import type { ExecutiveReportInput, ExecutiveKPIs } from "../executiveReportTypes";

export type ExecutiveRenderContext = {
  input: ExecutiveReportInput;
  kpis: ExecutiveKPIs;
  /** month name in Arabic e.g. "مايو 2026" */
  monthLabel: string;
  /** issue date e.g. "29 / 06 / 2026" */
  issueDate: string;
  /** resolved display name for a username */
  displayName: (username: string) => string;
  /** anonymize codes stable by accuracy rank */
  anonymizeMap: Map<string, string>;
};

const ARABIC_MONTHS = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];

function formatMonthLabel(folderName: string): string {
  const m = /^(\d{1,2})-[A-Za-z]+-(\d{4})$/.exec(folderName.trim());
  if (!m) return folderName;
  const name = ARABIC_MONTHS[Number(m[1]) - 1];
  return name ? `${name} ${m[2]}` : folderName;
}

function formatIssueDate(d = new Date()): string {
  return `${String(d.getDate()).padStart(2,"0")} / ${String(d.getMonth()+1).padStart(2,"0")} / ${d.getFullYear()}`;
}

export function buildContext(
  input: ExecutiveReportInput,
  kpis: ExecutiveKPIs,
  employeeDisplayNames: Record<string, string> = {},
): ExecutiveRenderContext {
  const anonymizeMap = new Map<string, string>();

  function displayName(username: string): string {
    if (input.config.showEmployeeNames === false) {
      if (!anonymizeMap.has(username)) {
        const idx = anonymizeMap.size + 1;
        anonymizeMap.set(username, `موظف ${idx}`);
      }
      return anonymizeMap.get(username)!;
    }
    return employeeDisplayNames[username] ?? username;
  }

  return {
    input,
    kpis,
    monthLabel: formatMonthLabel(input.monthFolderName),
    issueDate: formatIssueDate(),
    displayName,
    anonymizeMap,
  };
}
```

- [ ] Edit log + commit: `feat(executive-report): add render context`

---

### Task 4: Create cover, TOC, glossary, and part-divider page builders

**Files:**
- Create: `src/data/reporting/executive/pages/cover.ts`
- Create: `src/data/reporting/executive/pages/toc.ts`
- Create: `src/data/reporting/executive/pages/glossary.ts`
- Create: `src/data/reporting/executive/pages/partDivider.ts`

**Interfaces:**
- Each exports `(ctx: ExecutiveRenderContext) => string`
- `partDivider.ts` exports `buildPartDivider(num, title, sub, icon): (ctx) => string`

- [ ] Create `src/data/reporting/executive/pages/cover.ts`:

```ts
import type { ExecutiveRenderContext } from "../context";
import { esc } from "../primitives";
import { ORGANIZATION_PATH_TEXT } from "../../../../branding/organization";

export function buildCover(ctx: ExecutiveRenderContext): string {
  const levels = [
    { label: "المستوى الأول", sub: "حالات الضبط المؤكدة", cls: "xr-l1" },
    { label: "المستوى الثاني", sub: "حالات الاشتباه المؤكدة", cls: "xr-l2" },
    { label: "المستوى الثالث", sub: "حالات محرك المخاطر", cls: "xr-l3" },
    { label: "المستوى الرابع", sub: "اشتباه الأشعة غير المؤكد", cls: "xr-l4" },
  ];
  const chips = levels.map(l => `
    <div class="xr-level-chip">
      <div class="xr-level-chip-dot" style="background:var(--${l.cls})"></div>
      <div class="xr-level-chip-text"><strong>${esc(l.label)}</strong><span>${esc(l.sub)}</span></div>
    </div>`).join("");

  return `<section class="xr-page xr-cover" id="page-cover">
    <div class="xr-cover-top">
      <div class="xr-cover-org">${esc(ORGANIZATION_PATH_TEXT)}</div>
      <div class="xr-cover-logo">🛡</div>
    </div>
    <div class="xr-cover-main">
      <div class="xr-cover-eyebrow">التقرير التنفيذي</div>
      <div class="xr-cover-title">لضمان جودة <span>الأشعة</span></div>
      <div class="xr-cover-meta">
        <div class="xr-cover-meta-item">📅 تاريخ التقرير: <b>${esc(ctx.issueDate)}</b></div>
        <div class="xr-cover-meta-item">📦 مجتمع الحالات: <b>${esc(ctx.monthLabel)}</b></div>
      </div>
    </div>
    <div class="xr-cover-levels">${chips}</div>
  </section>`;
}
```

- [ ] Create `src/data/reporting/executive/pages/toc.ts`:

```ts
import type { ExecutiveRenderContext } from "../context";

const TOC_ENTRIES = [
  { num: "01", label: "مقدمة تنفيذية", id: "page-intro" },
  { num: "02", label: "المعجم ودلالات المستويات", id: "page-glossary" },
  { num: "03", label: "الجزء الأول: مجتمع الحالات", id: "page-p1" },
  { num: "04", label: "الجزء الثاني: العينة", id: "page-p2" },
  { num: "05", label: "الجزء الثالث: التوزيع والتكليف", id: "page-p3" },
  { num: "06", label: "الجزء الرابع: نتائج المراجعة ومؤشرات الدقة", id: "page-p4" },
  { num: "07", label: "الجزء الخامس: الفجوات والملاحظات الجوهرية", id: "page-p5" },
  { num: "08", label: "الجزء السادس: التوصيات والقرارات المطلوبة", id: "page-p6" },
  { num: "09", label: "الملاحق", id: "page-appendix" },
];

export function buildToc(_ctx: ExecutiveRenderContext): string {
  const rows = TOC_ENTRIES.map(e => `
    <a href="#${e.id}" class="xr-toc-row">
      <span class="xr-toc-num">${e.num}</span>
      <span class="xr-toc-label">${e.label}</span>
      <span class="xr-toc-pg">←</span>
    </a>`).join("");
  return `<section class="xr-page" id="page-toc">
    <div class="xr-page-inner">
      <div class="xr-slide-head"><h2>الفهرس</h2><span class="xr-pg">02</span></div>
      <div class="xr-toc-grid">${rows}</div>
    </div>
  </section>`;
}
```

- [ ] Create `src/data/reporting/executive/pages/glossary.ts`:

```ts
import type { ExecutiveRenderContext } from "../context";
import { esc } from "../primitives";

const LEVELS = [
  { cls: "xr-l1-card", title: "المستوى الأول", sub: "حالات الضبط المؤكدة", body: "الحالات التي تتضمن حوادث ضبط أمنية أو جودة قرارات التجاوز للأنظمة، ولم يتم الاشتباه بها من قبل كلا المستويين أو أحدهما." },
  { cls: "xr-l2-card", title: "المستوى الثاني", sub: "حالات الاشتباه المؤكدة", body: "الحالات التي لم يتم الاشتباه بها من قبل كلا المستويين أو أحدهما، وتم الاشتباه بها من أحد الفرق الأمنية الأخرى." },
  { cls: "xr-l3-card", title: "المستوى الثالث", sub: "حالات محرك المخاطر", body: "الحالات التي تتضمن مدخلات مخاطر ولم يتم الاشتباه بها من المستوى الأول والثاني." },
  { cls: "xr-l4-card", title: "المستوى الرابع", sub: "اشتباه الأشعة غير المؤكد", body: "الحالات التي تم الاشتباه بها من قبل المستوى الأول أو الثاني في صور الأشعة ولم يتم تأكيد الاشتباه." },
];

const TERMS = [
  { icon: "✅", name: "سليمة", def: "حالة لم يُكتشف فيها اشتباه من قبل نتائج فحص الأشعة." },
  { icon: "⚠️", name: "اشتباه", def: "حالة اكتُشف فيها اشتباه من أحد مستويات فحص الأشعة." },
  { icon: "👥", name: "مجتمع الحالات", def: "مجموع جميع حالات الأشعة المستوردة للشهر المحدد." },
  { icon: "🎯", name: "العينة", def: "مجموعة الحالات المختارة عشوائياً للمراجعة والتحقق." },
  { icon: "🔍", name: "CertScan", def: "نوع فحص الأشعة المعتمد والمرخص (Certscan)." },
  { icon: "📊", name: "مطابقة BI", def: "مدى تطابق بيانات BI مع بيانات الأشعة المستوردة." },
  { icon: "📋", name: "التوزيع", def: "عملية توزيع حالات العينة على الموظفين للمراجعة." },
  { icon: "🎖", name: "الدقة الإجمالية", def: "نسبة الحالات التي تطابق فيها حكم الخبير مع نتيجة الأشعة." },
];

export function buildGlossary(_ctx: ExecutiveRenderContext): string {
  const cards = LEVELS.map(l => `
    <div class="xr-level-card ${l.cls}">
      <div class="xr-level-card-head"><h3>${esc(l.title)}</h3><span>${esc(l.sub)}</span></div>
      <div class="xr-level-card-body">${esc(l.body)}</div>
    </div>`).join("");

  const terms = TERMS.map(t => `
    <div class="xr-term">
      <div class="xr-term-icon">${t.icon}</div>
      <div class="xr-term-name">${esc(t.name)}</div>
      <div class="xr-term-def">${esc(t.def)}</div>
    </div>`).join("");

  return `<section class="xr-page" id="page-glossary">
    <div class="xr-page-inner">
      <div class="xr-slide-head"><h2>المعجم ودلالات المستويات</h2><span class="xr-pg">05</span></div>
      <div class="xr-level-cards">${cards}</div>
      <div class="xr-section-title" style="margin-top:0.14in">معجم المصطلحات</div>
      <div class="xr-terms-grid">${terms}</div>
    </div>
  </section>`;
}
```

- [ ] Create `src/data/reporting/executive/pages/partDivider.ts`:

```ts
import type { ExecutiveRenderContext } from "../context";
import { esc } from "../primitives";

export function buildPartDivider(
  partNum: string, title: string, sub: string, icon: string, pageId: string, pageNum: string,
): (_ctx: ExecutiveRenderContext) => string {
  return (_ctx) => `<section class="xr-page xr-divider" id="${pageId}">
    <div class="xr-divider-inner">
      <div class="xr-divider-icon">${icon}</div>
      <div class="xr-divider-eyebrow">${esc(partNum)}</div>
      <div class="xr-divider-title">${esc(title)}</div>
      <div class="xr-divider-sub">${esc(sub)}</div>
    </div>
    <div class="xr-footer"><span></span><span>${pageNum}</span></div>
  </section>`;
}

export const buildPart1Divider = buildPartDivider(
  "الجزء الأول", "مجتمع الحالات",
  "يستعرض هذا الجزء حجم المجتمع محل الدراسة وتوزيعه حسب نوع المنفذ والمستوى ونمط الحركة.",
  "📦", "page-p1", "07"
);
export const buildPart2Divider = buildPartDivider(
  "الجزء الثاني", "العينة",
  "يستعرض هذا الجزء حجم العينة المسحوبة وتوزيعها على المنافذ والمستويات وبيانات CertScan.",
  "🎯", "page-p2", "11"
);
export const buildPart3Divider = buildPartDivider(
  "الجزء الثالث", "التوزيع والتكليف",
  "يستعرض هذا الجزء توزيع حالات العينة على الموظفين وأعباء العمل وحالة الإنجاز.",
  "📋", "page-p3", "15"
);
export const buildPart4Divider = buildPartDivider(
  "الجزء الرابع", "نتائج المراجعة ومؤشرات الدقة",
  "يستعرض هذا الجزء نتائج مراجعة الدقة على مستوى المنافذ والمستويات ومقارنة الخبراء.",
  "📊", "page-p4", "19"
);
export const buildPart5Divider = buildPartDivider(
  "الجزء الخامس", "الفجوات والملاحظات الجوهرية",
  "يستعرض هذا الجزء أداء الموظفين وتحليل أثر جودة الصورة والتحديد على نتائج الدقة.",
  "🔍", "page-p5", "23"
);
export const buildPart6Divider = buildPartDivider(
  "الجزء السادس", "التوصيات والقرارات المطلوبة",
  "يستعرض هذا الجزء الموظفين ذوي الأولوية والإجراءات التصحيحية المقترحة.",
  "🎖", "page-p6", "29"
);
```

- [ ] Edit log + commit: `feat(executive-report): add cover, toc, glossary, part-divider pages`

---

### Task 5: Create `populationByRisk.ts` and `appendix.ts`

**Files:**
- Create: `src/data/reporting/executive/pages/populationByRisk.ts`
- Create: `src/data/reporting/executive/pages/appendix.ts`

- [ ] Create `src/data/reporting/executive/pages/populationByRisk.ts`:

```ts
import type { ExecutiveRenderContext } from "../context";
import { kpiCard, barRow, dataTable, fmtNum, fmtPct, esc } from "../primitives";

export function buildPopulationByRisk(ctx: ExecutiveRenderContext): string {
  const { kpis } = ctx;
  const totalPop = kpis.totalPopulation;
  const landPorts = kpis.portProfiles.filter(p => {
    // portType not on portProfiles — use port name heuristic or extend later
    return true;
  });

  const kpiRow = [
    kpiCard({ label: "إجمالي المجتمع", value: fmtNum(totalPop), tone: "accent" }),
    kpiCard({ label: "الحالات السليمة", value: fmtNum(kpis.cleanCount), tone: "good" }),
    kpiCard({ label: "حالات الاشتباه", value: fmtNum(kpis.suspiciousCount), tone: "risk" }),
    kpiCard({ label: "نسبة الاشتباه", value: fmtPct(kpis.suspicionRate), tone: "" }),
  ].join("");

  const portTableRows = kpis.portProfiles.map(p => [
    esc(p.portName),
    fmtNum(p.population),
    fmtNum(p.clean),
    fmtNum(p.suspicious),
    fmtPct(p.suspicionRate),
  ]);

  const portTable = dataTable({
    headers: ["المنفذ", "المجتمع", "سليمة", "اشتباه", "نسبة الاشتباه"],
    rows: portTableRows,
    totalRow: ["الإجمالي", fmtNum(totalPop), fmtNum(kpis.cleanCount), fmtNum(kpis.suspiciousCount), fmtPct(kpis.suspicionRate)],
  });

  const bars = kpis.portProfiles.map(p =>
    barRow({ label: p.portName, value: p.suspicionRate, max: 100 })
  ).join("");

  return `<section class="xr-page" id="page-pop-risk">
    <div class="xr-page-inner">
      <div class="xr-slide-head"><h2>مجتمع حالات المخاطر</h2><span class="xr-pg">08</span></div>
      <div class="xr-kpi-grid xr-kpi-grid-4" style="margin-bottom:0.13in">${kpiRow}</div>
      <div class="xr-cols xr-cols-6-4">
        <div>${portTable}</div>
        <div class="xr-panel">
          <div class="xr-panel-title">نسبة الاشتباه حسب المنفذ</div>
          <div class="xr-bars">${bars}</div>
        </div>
      </div>
      <div class="xr-footer"><span>التقرير التنفيذي — ${esc(ctx.monthLabel)}</span><span>08</span></div>
    </div>
  </section>`;
}
```

- [ ] Create `src/data/reporting/executive/pages/appendix.ts`:

```ts
import type { ExecutiveRenderContext } from "../context";
import { esc, fmtPct, fmtNum } from "../primitives";

export function buildAppendix(ctx: ExecutiveRenderContext): string {
  const cfg = ctx.input.config;
  return `<section class="xr-page" id="page-appendix">
    <div class="xr-page-inner">
      <div class="xr-slide-head"><h2>الملاحق</h2><span class="xr-pg">31</span></div>
      <div class="xr-cols xr-cols-2">
        <div class="xr-panel">
          <div class="xr-panel-title">معايير الأداء المعتمدة</div>
          <table class="xr-table" style="margin-top:0.05in">
            <tbody>
              <tr><td>هدف الدقة الإجمالية</td><td>${fmtPct(cfg.accuracyTarget)}</td></tr>
              <tr><td>هدف إنجاز العينة</td><td>${fmtPct(cfg.completionTarget)}</td></tr>
              <tr><td>هدف التغطية</td><td>${fmtPct(cfg.coverageTarget)}</td></tr>
              <tr><td>حد الاشتباه الفائت المسموح</td><td>${fmtPct(cfg.maximumMissedSuspicionRate)}</td></tr>
              <tr><td>الحد الأدنى للعينة الموثوقة</td><td>${fmtNum(cfg.minimumReliableSampleSize)} حالة</td></tr>
              <tr><td>الهدف الشهري للعينة</td><td>${fmtNum(cfg.monthlyTarget)} حالة</td></tr>
            </tbody>
          </table>
        </div>
        <div class="xr-panel">
          <div class="xr-panel-title">منهجية المراجعة</div>
          <p style="font-size:0.082in;line-height:1.65;color:var(--xr-muted);font-weight:600">
            تعتمد المراجعة على سحب عينة عشوائية طبقية بخوارزمية هاميلتون من مجتمع الحالات الشهرية
            لكل منفذ، ثم توزيعها على الموظفين المعتمدين. يقوم كل موظف بمراجعة الحالات المكلف بها
            وتسجيل حكمه الخبري. تُحسب الدقة بمقارنة حكم الخبير بنتيجة الأشعة الآلية.
            الحالات التي لم تُدرس بعد لا تدخل في حساب الدقة.
          </p>
        </div>
      </div>
      <div class="xr-footer"><span>التقرير التنفيذي — ${esc(ctx.monthLabel)}</span><span>31</span></div>
    </div>
  </section>`;
}
```

- [ ] Edit log + commit: `feat(executive-report): add population-by-risk and appendix pages`

---

### Task 6: Create `executive/viewer.ts` and `executive/assemble.ts`

**Files:**
- Create: `src/data/reporting/executive/viewer.ts`
- Create: `src/data/reporting/executive/assemble.ts`

**Interfaces:**
- `viewer.ts` exports `buildViewerHtml(slides: string, sidebarLinks: string, monthLabel: string): string`
- `assemble.ts` exports `assembleReport(ctx: ExecutiveRenderContext, pageBuilders: Array<(ctx: ExecutiveRenderContext) => string>): string`

- [ ] Create `src/data/reporting/executive/viewer.ts`:

```ts
import { EXEC_CSS } from "./theme";
import { esc } from "./primitives";

export function buildViewerHtml(slides: string, sidebarLinks: string, monthLabel: string): string {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>التقرير التنفيذي — ${esc(monthLabel)}</title>
<style>${EXEC_CSS}</style>
</head>
<body>
<div class="xr-viewer">
  <main class="xr-slides">${slides}</main>
  <nav class="xr-sidebar">
    <div class="xr-brand">
      <strong>التقرير التنفيذي</strong>
      <span>ضمان جودة الأشعة</span>
    </div>
    <button class="xr-pdf-btn" onclick="window.print()">تصدير PDF</button>
    <div class="xr-nav-title">الأقسام</div>
    <div class="xr-nav">${sidebarLinks}</div>
  </nav>
</div>
</body>
</html>`;
}
```

- [ ] Create `src/data/reporting/executive/assemble.ts`:

```ts
import type { ExecutiveRenderContext } from "./context";
import { buildViewerHtml } from "./viewer";
import { esc } from "./primitives";

const NAV_SECTIONS = [
  { label: "الغلاف", id: "page-cover" },
  { label: "الفهرس", id: "page-toc" },
  { label: "مقدمة تنفيذية", id: "page-intro" },
  { label: "المعجم", id: "page-glossary" },
  { label: "الجزء الأول: المجتمع", id: "page-p1" },
  { label: "الجزء الثاني: العينة", id: "page-p2" },
  { label: "الجزء الثالث: التوزيع", id: "page-p3" },
  { label: "الجزء الرابع: الدقة", id: "page-p4" },
  { label: "الجزء الخامس: الفجوات", id: "page-p5" },
  { label: "الجزء السادس: التوصيات", id: "page-p6" },
  { label: "الملاحق", id: "page-appendix" },
];

export function assembleReport(
  ctx: ExecutiveRenderContext,
  pageBuilders: Array<(ctx: ExecutiveRenderContext) => string>,
): string {
  const slides = pageBuilders.map(fn => fn(ctx)).join("\n");
  const sidebarLinks = NAV_SECTIONS.map(s =>
    `<a href="#${s.id}">${esc(s.label)}</a>`
  ).join("");
  return buildViewerHtml(slides, sidebarLinks, ctx.monthLabel);
}
```

- [ ] Edit log + commit: `feat(executive-report): add viewer shell and assembler`

---

### Task 7: Create `executive/index.ts` and update the shim

**Files:**
- Create: `src/data/reporting/executive/index.ts`
- Modify: `src/data/reporting/executiveReport.ts` (add re-export shim at bottom, keep old functions for now)

**Interfaces:**
- Produces: `openExecutiveReport(input, employeeDisplayNames?)`, `buildExecutiveReport(input, employeeDisplayNames?)`

- [ ] Create `src/data/reporting/executive/index.ts`:

```ts
import { buildExecutiveReportRows, calculateExecutiveKPIs } from "../executiveReportData";
import { buildContext } from "./context";
import { assembleReport } from "./assemble";
import { openOrDownload } from "../htmlReport";
import type { ExecutiveReportInput } from "../executiveReportTypes";

// Phase 1 pages
import { buildCover } from "./pages/cover";
import { buildToc } from "./pages/toc";
import { buildGlossary } from "./pages/glossary";
import {
  buildPart1Divider, buildPart2Divider, buildPart3Divider,
  buildPart4Divider, buildPart5Divider, buildPart6Divider,
} from "./pages/partDivider";
import { buildPopulationByRisk } from "./pages/populationByRisk";
import { buildAppendix } from "./pages/appendix";

export function buildExecutiveReport(
  input: ExecutiveReportInput,
  employeeDisplayNames: Record<string, string> = {},
): string {
  const rows = buildExecutiveReportRows(input);
  const kpis = calculateExecutiveKPIs(rows, input.sample, input.config);
  const ctx = buildContext(input, kpis, employeeDisplayNames);

  const pages = [
    buildCover,
    buildToc,
    // execIntro — Phase 2
    buildGlossary,
    buildPart1Divider,
    buildPopulationByRisk,
    // populationByLevel — Phase 2
    buildPart2Divider,
    // sampleByLevel — Phase 2
    buildPart3Divider,
    // distributionOverview — Phase 2
    buildPart4Divider,
    // accuracyByPort — Phase 3
    // accuracyByLevel — Phase 3
    // levelAgreement — Phase 3
    buildPart5Divider,
    // empOverview … — Phase 4
    buildPart6Divider,
    // empPriority — Phase 4
    buildAppendix,
  ];

  return assembleReport(ctx, pages);
}

export function openExecutiveReport(
  input: ExecutiveReportInput,
  employeeDisplayNames: Record<string, string> = {},
): void {
  openOrDownload(
    buildExecutiveReport(input, employeeDisplayNames),
    `التقرير_التنفيذي_${input.monthFolderName}.html`,
  );
}
```

- [ ] In `src/data/reporting/executiveReport.ts`, replace the `openExecutiveReport` and `buildExecutiveReport` exports with re-exports from the new module. Keep `buildExecutiveXlsx` in place (it doesn't change).

Find this block at the bottom of `executiveReport.ts`:
```ts
export function buildExecutiveReport(input: ExecutiveReportInput): string {
  const execRows = buildExecutiveReportRows(input);
  const kpis = calculateExecutiveKPIs(execRows, input.sample, input.config);
  return buildPrintableExecutiveReport(input, kpis, groupForReport(execRows));
}

export function openExecutiveReport(input: ExecutiveReportInput): void {
  openOrDownload(buildExecutiveReport(input), `التقرير_التنفيذي_${input.monthFolderName}.html`);
}
```

Replace with:
```ts
export { buildExecutiveReport, openExecutiveReport } from "./executive/index";
```

- [ ] Run `npm run build` — must succeed with no TS errors.
- [ ] Run `npm run dev`, open app, navigate to Reports tab, click تصدير — verify the dark-navy viewer opens with sidebar on the right and "تصدير PDF" button.
- [ ] Edit log + commit: `feat(executive-report): wire new dark-navy viewer as the active report (Phase 1)`

---

## Phase 2 — Parts 1–3 complete (execIntro, populationByLevel, sampleByLevel, distributionOverview)

### Task 8: Executive intro page (KPI dashboard)

**Files:**
- Create: `src/data/reporting/executive/pages/execIntro.ts`

- [ ] Create `src/data/reporting/executive/pages/execIntro.ts`:

```ts
import type { ExecutiveRenderContext } from "../context";
import { kpiCard, fmtNum, fmtPct, esc } from "../primitives";

export function buildExecIntro(ctx: ExecutiveRenderContext): string {
  const { kpis } = ctx;
  const cards = [
    kpiCard({ label: "إجمالي المجتمع", value: fmtNum(kpis.totalPopulation), tone: "accent" }),
    kpiCard({ label: "حجم العينة", value: fmtNum(kpis.totalSample) }),
    kpiCard({ label: "نسبة التغطية", value: fmtPct(kpis.sampleCoverage), tone: kpis.sampleCoverage !== null && kpis.sampleCoverage >= ctx.input.config.coverageTarget ? "good" : "warn" }),
    kpiCard({ label: "الحالات المدروسة", value: fmtNum(kpis.studiedImages) }),
    kpiCard({ label: "نسبة الإنجاز", value: fmtPct(kpis.completionRate), tone: kpis.completionRate !== null && kpis.completionRate >= ctx.input.config.completionTarget ? "good" : "warn" }),
    kpiCard({ label: "الدقة الإجمالية", value: fmtPct(kpis.overallAccuracy), tone: kpis.overallAccuracy === null ? "" : kpis.overallAccuracy >= ctx.input.config.accuracyTarget ? "good" : "risk" }),
  ].join("");

  const sectionStatus = [
    { label: "مجتمع الحالات", ok: kpis.totalPopulation > 0 },
    { label: "العينة", ok: kpis.totalSample > 0 },
    { label: "التوزيع", ok: kpis.studiedImages > 0 },
    { label: "نتائج الدقة", ok: kpis.overallAccuracy !== null },
    { label: "أداء الموظفين", ok: kpis.validStudied > 0 },
  ].map(s => `<div class="xr-kpi" style="text-align:center">
    <div style="font-size:0.22in">${s.ok ? "✅" : "⬜"}</div>
    <div class="xr-kpi-label">${esc(s.label)}</div>
  </div>`).join("");

  return `<section class="xr-page" id="page-intro">
    <div class="xr-page-inner">
      <div class="xr-slide-head"><h2>مقدمة تنفيذية</h2><span class="xr-pg">03</span></div>
      <div style="margin-bottom:0.07in;font-size:0.085in;color:var(--xr-muted);font-weight:600">
        ملخص أداء شهر ${esc(ctx.monthLabel)} — بتاريخ ${esc(ctx.issueDate)}
      </div>
      <div class="xr-kpi-grid xr-kpi-grid-6" style="margin-bottom:0.16in">${cards}</div>
      <div class="xr-section-title">حالة الأقسام</div>
      <div class="xr-kpi-grid" style="grid-template-columns:repeat(5,1fr)">${sectionStatus}</div>
      ${kpis.overallAccuracy !== null && kpis.overallAccuracy < ctx.input.config.accuracyTarget
        ? `<div class="xr-notice" style="margin-top:0.12in">⚠️ الدقة الإجمالية (${fmtPct(kpis.overallAccuracy)}) أقل من الهدف المعتمد (${fmtPct(ctx.input.config.accuracyTarget)}). راجع الجزء الرابع والخامس لتفاصيل الفجوات.</div>`
        : ""}
      <div class="xr-footer"><span>التقرير التنفيذي — ${esc(ctx.monthLabel)}</span><span>03</span></div>
    </div>
  </section>`;
}
```

- [ ] Add `buildExecIntro` to the pages array in `executive/index.ts` (after `buildToc`, before `buildGlossary`).
- [ ] Edit log + commit: `feat(executive-report): add executive intro KPI dashboard page`

---

### Task 9: populationByLevel and sampleByLevel pages

**Files:**
- Create: `src/data/reporting/executive/pages/populationByLevel.ts`
- Create: `src/data/reporting/executive/pages/sampleByLevel.ts`

- [ ] Create `src/data/reporting/executive/pages/populationByLevel.ts`:

```ts
import type { ExecutiveRenderContext } from "../context";
import { dataTable, fmtNum, fmtPct, esc } from "../primitives";

export function buildPopulationByLevel(ctx: ExecutiveRenderContext): string {
  const { kpis } = ctx;
  const rows = kpis.stageProfiles.map(s => [
    esc(s.stageLabel),
    fmtNum(s.population),
    fmtNum(s.sampleSize),
    fmtPct(s.coverage),
    fmtNum(s.studied),
    fmtPct(s.completionRate),
  ]);
  const table = dataTable({
    headers: ["المستوى", "المجتمع", "العينة", "التغطية", "مدروسة", "الإنجاز"],
    rows,
    totalRow: ["الإجمالي", fmtNum(kpis.totalPopulation), fmtNum(kpis.totalSample), fmtPct(kpis.sampleCoverage), fmtNum(kpis.studiedImages), fmtPct(kpis.completionRate)],
  });

  const portRows = kpis.portProfiles.map(p => [
    esc(p.portName),
    fmtNum(p.population),
    fmtNum(p.sampleSize),
    fmtPct(p.coverage),
    fmtNum(p.studied),
    fmtPct(p.completionRate),
  ]);
  const portTable = dataTable({
    headers: ["المنفذ", "المجتمع", "العينة", "التغطية", "مدروسة", "الإنجاز"],
    rows: portRows,
  });

  return `<section class="xr-page" id="page-pop-level">
    <div class="xr-page-inner">
      <div class="xr-slide-head"><h2>مجتمع الحالات حسب المستويات والمنافذ</h2><span class="xr-pg">09</span></div>
      <div class="xr-cols xr-cols-2">
        <div>
          <div class="xr-panel-title">توزيع المستويات</div>
          ${table}
        </div>
        <div>
          <div class="xr-panel-title">توزيع المنافذ</div>
          ${portTable}
        </div>
      </div>
      <div class="xr-footer"><span>التقرير التنفيذي — ${esc(ctx.monthLabel)}</span><span>09</span></div>
    </div>
  </section>`;
}
```

- [ ] Create `src/data/reporting/executive/pages/sampleByLevel.ts`:

```ts
import type { ExecutiveRenderContext } from "../context";
import { dataTable, kpiCard, fmtNum, fmtPct, esc } from "../primitives";

export function buildSampleByLevel(ctx: ExecutiveRenderContext): string {
  const { kpis, input } = ctx;
  const s = input.sample;

  const kpis4 = [
    kpiCard({ label: "حجم العينة الكلي", value: fmtNum(kpis.totalSample), tone: "accent" }),
    kpiCard({ label: "CertScan", value: s ? fmtNum(s.certScanActual) : "—" }),
    kpiCard({ label: "نسبة التغطية", value: fmtPct(kpis.sampleCoverage), tone: "good" }),
    kpiCard({ label: "المجتمع الكلي", value: fmtNum(kpis.totalPopulation) }),
  ].join("");

  const stageRows = kpis.stageProfiles.map(sp => [
    esc(sp.stageLabel),
    fmtNum(sp.population),
    fmtNum(sp.sampleSize),
    fmtPct(sp.coverage),
    fmtNum(sp.studied),
  ]);

  const portRows = kpis.portProfiles.map(p => [
    esc(p.portName),
    fmtNum(p.population),
    fmtNum(p.sampleSize),
    fmtPct(p.coverage),
    fmtNum(p.studied),
    fmtPct(p.completionRate),
  ]);

  return `<section class="xr-page" id="page-sample">
    <div class="xr-page-inner">
      <div class="xr-slide-head"><h2>العينة حسب المستويات والمنافذ</h2><span class="xr-pg">12</span></div>
      <div class="xr-kpi-grid xr-kpi-grid-4" style="margin-bottom:0.13in">${kpis4}</div>
      <div class="xr-cols xr-cols-2">
        <div>
          <div class="xr-panel-title">العينة حسب المستوى</div>
          ${dataTable({ headers: ["المستوى","المجتمع","العينة","التغطية","مدروسة"], rows: stageRows })}
        </div>
        <div>
          <div class="xr-panel-title">العينة حسب المنفذ</div>
          ${dataTable({ headers: ["المنفذ","المجتمع","العينة","التغطية","مدروسة","الإنجاز"], rows: portRows })}
        </div>
      </div>
      <div class="xr-footer"><span>التقرير التنفيذي — ${esc(ctx.monthLabel)}</span><span>12</span></div>
    </div>
  </section>`;
}
```

- [ ] Wire both into `index.ts` pages array (after part1Divider/populationByRisk for level, after part2Divider for sample).
- [ ] Edit log + commit: `feat(executive-report): add population-by-level and sample-by-level pages`

---

### Task 10: distributionOverview page

**Files:**
- Create: `src/data/reporting/executive/pages/distributionOverview.ts`

- [ ] Create `src/data/reporting/executive/pages/distributionOverview.ts`:

```ts
import type { ExecutiveRenderContext } from "../context";
import { dataTable, kpiCard, fmtNum, fmtPct, esc } from "../primitives";

export function buildDistributionOverview(ctx: ExecutiveRenderContext): string {
  const dist = ctx.input.distribution;
  if (!dist || dist.entries.length === 0) {
    return `<section class="xr-page" id="page-dist">
      <div class="xr-page-inner">
        <div class="xr-slide-head"><h2>التوزيع والتكليف</h2><span class="xr-pg">16</span></div>
        <div class="xr-notice">لم يتم التوزيع بعد لهذا الشهر.</div>
        <div class="xr-footer"><span>التقرير التنفيذي — ${esc(ctx.monthLabel)}</span><span>16</span></div>
      </div>
    </section>`;
  }

  const byEmployee = new Map<string, { assigned: number; completed: number; pending: number }>();
  for (const e of dist.entries) {
    const emp = e.assignedTo ?? "غير محدد";
    const rec = byEmployee.get(emp) ?? { assigned: 0, completed: 0, pending: 0 };
    rec.assigned++;
    if (e.status === "completed") rec.completed++;
    else rec.pending++;
    byEmployee.set(emp, rec);
  }

  const totalAssigned = dist.entries.length;
  const totalCompleted = dist.entries.filter(e => e.status === "completed").length;
  const totalPending = totalAssigned - totalCompleted;

  const kpisRow = [
    kpiCard({ label: "إجمالي المكلَّف به", value: fmtNum(totalAssigned), tone: "accent" }),
    kpiCard({ label: "مكتملة", value: fmtNum(totalCompleted), tone: "good" }),
    kpiCard({ label: "متبقية", value: fmtNum(totalPending), tone: totalPending > 0 ? "warn" : "" }),
    kpiCard({ label: "نسبة الإنجاز", value: fmtPct(totalAssigned > 0 ? (totalCompleted / totalAssigned) * 100 : null) }),
  ].join("");

  const rows = [...byEmployee.entries()].map(([emp, r]) => [
    esc(ctx.displayName(emp)),
    fmtNum(r.assigned),
    fmtNum(r.completed),
    fmtNum(r.pending),
    fmtPct(r.assigned > 0 ? (r.completed / r.assigned) * 100 : null),
  ]);

  return `<section class="xr-page" id="page-dist">
    <div class="xr-page-inner">
      <div class="xr-slide-head"><h2>التوزيع والتكليف</h2><span class="xr-pg">16</span></div>
      <div class="xr-kpi-grid xr-kpi-grid-4" style="margin-bottom:0.13in">${kpisRow}</div>
      <div class="xr-panel-title">أعباء العمل حسب الموظف</div>
      ${dataTable({ headers: ["الموظف","المكلَّف به","مكتمل","متبقٍ","نسبة الإنجاز"], rows })}
      <div class="xr-footer"><span>التقرير التنفيذي — ${esc(ctx.monthLabel)}</span><span>16</span></div>
    </div>
  </section>`;
}
```

- [ ] Wire into `index.ts` after `buildPart3Divider`.
- [ ] Edit log + commit: `feat(executive-report): add distribution overview page`

---

## Phase 3 — Part 4 accuracy pages

### Task 11: accuracyByPort page

**Files:**
- Create: `src/data/reporting/executive/pages/accuracyByPort.ts`

- [ ] Create `src/data/reporting/executive/pages/accuracyByPort.ts`:

```ts
import type { ExecutiveRenderContext } from "../context";
import { dataTable, barRow, badgeHtml, kpiCard, fmtNum, fmtPct, esc } from "../primitives";

export function buildAccuracyByPort(ctx: ExecutiveRenderContext): string {
  const { kpis } = ctx;
  const reliable = kpis.portProfiles.filter(p => p.accuracy !== null);

  const kpisRow = [
    kpiCard({ label: "الدقة الإجمالية", value: fmtPct(kpis.overallAccuracy), tone: kpis.overallAccuracy !== null && kpis.overallAccuracy >= ctx.input.config.accuracyTarget ? "good" : "risk" }),
    kpiCard({ label: "قوة اكتشاف الاشتباه", value: fmtPct(kpis.suspiciousDetectionRate), tone: "good" }),
    kpiCard({ label: "اشتباه فائت", value: fmtPct(kpis.missedSuspicionRate), tone: kpis.missedSuspicionRate !== null && kpis.missedSuspicionRate <= ctx.input.config.maximumMissedSuspicionRate ? "good" : "risk" }),
    kpiCard({ label: "المنافذ ذات بيانات موثوقة", value: String(reliable.length) + " / " + String(kpis.portProfiles.length) }),
  ].join("");

  const tableRows = kpis.portProfiles.map(p => [
    esc(p.portName),
    fmtNum(p.studied),
    p.accuracy !== null ? fmtPct(p.accuracy) : null,
    p.suspiciousDetectionRate !== null ? fmtPct(p.suspiciousDetectionRate) : null,
    p.missedSuspicionRate !== null ? fmtPct(p.missedSuspicionRate) : null,
    badgeHtml(p.status),
  ]);

  const bars = reliable.map(p =>
    barRow({ label: p.portName, value: p.accuracy, max: 100, tone: p.accuracy !== null && p.accuracy >= ctx.input.config.accuracyTarget ? "good" : "risk" })
  ).join("");

  return `<section class="xr-page" id="page-acc-port">
    <div class="xr-page-inner">
      <div class="xr-slide-head"><h2>نتائج الدقة حسب المنفذ</h2><span class="xr-pg">20</span></div>
      <div class="xr-kpi-grid xr-kpi-grid-4" style="margin-bottom:0.13in">${kpisRow}</div>
      <div class="xr-cols xr-cols-6-4">
        <div>${dataTable({ headers: ["المنفذ","مدروسة","دقة%","اكتشاف اشتباه%","اشتباه فائت%","التصنيف"], rows: tableRows })}</div>
        <div class="xr-panel">
          <div class="xr-panel-title">الدقة حسب المنفذ</div>
          <div class="xr-bars">${bars || '<div class="xr-notice">بيانات غير كافية</div>'}</div>
        </div>
      </div>
      <div class="xr-footer"><span>التقرير التنفيذي — ${esc(ctx.monthLabel)}</span><span>20</span></div>
    </div>
  </section>`;
}
```

---

### Task 12: accuracyByLevel and levelAgreement pages

**Files:**
- Create: `src/data/reporting/executive/pages/accuracyByLevel.ts`
- Create: `src/data/reporting/executive/pages/levelAgreement.ts`

- [ ] Create `src/data/reporting/executive/pages/accuracyByLevel.ts`:

```ts
import type { ExecutiveRenderContext } from "../context";
import { kpiCard, radarSvg, fmtPct, esc } from "../primitives";

export function buildAccuracyByLevel(ctx: ExecutiveRenderContext): string {
  const { kpis } = ctx;

  const kpisRow = [
    kpiCard({ label: "دقة المستوى الأول", value: fmtPct(kpis.levelOneAccuracy), tone: kpis.levelOneAccuracy !== null && kpis.levelOneAccuracy >= ctx.input.config.accuracyTarget ? "good" : "risk" }),
    kpiCard({ label: "دقة المستوى الثاني", value: fmtPct(kpis.levelTwoAccuracy), tone: kpis.levelTwoAccuracy !== null && kpis.levelTwoAccuracy >= ctx.input.config.accuracyTarget ? "good" : "risk" }),
    kpiCard({ label: "معدل التصحيح م.ثاني", value: fmtPct(kpis.levelTwoCorrectionRate) }),
    kpiCard({ label: "معدل التراجع م.ثاني", value: fmtPct(kpis.levelTwoRegressionRate), tone: "warn" }),
  ].join("");

  const radarPoints = [
    { label: "دقة م.أول", value: kpis.levelOneAccuracy ?? 0 },
    { label: "دقة م.ثاني", value: kpis.levelTwoAccuracy ?? 0 },
    { label: "اكتشاف الاشتباه", value: kpis.suspiciousDetectionRate ?? 0 },
    { label: "تأكيد السلامة", value: kpis.cleanConfirmationRate ?? 0 },
    { label: "الدقة الإجمالية", value: kpis.overallAccuracy ?? 0 },
    { label: "الجودة المتوازنة", value: kpis.balancedQualityScore ?? 0 },
  ];

  return `<section class="xr-page" id="page-acc-level">
    <div class="xr-page-inner">
      <div class="xr-slide-head"><h2>نتائج الدقة حسب المستويات الأربعة</h2><span class="xr-pg">21</span></div>
      <div class="xr-kpi-grid xr-kpi-grid-4" style="margin-bottom:0.13in">${kpisRow}</div>
      <div class="xr-cols xr-cols-2">
        <div class="xr-panel" style="height:3.4in">${radarSvg(radarPoints)}</div>
        <div>
          <div class="xr-panel-title">مؤشرات الدقة التفصيلية</div>
          <table class="xr-table"><tbody>
            <tr><td>اشتباه مكتشف</td><td>${kpis.correctSuspicious}</td></tr>
            <tr><td>سليمة مؤكدة</td><td>${kpis.correctClean}</td></tr>
            <tr><td>اشتباه فائت</td><td style="color:var(--xr-coral)">${kpis.missedSuspicious}</td></tr>
            <tr><td>اشتباه زائد</td><td style="color:var(--xr-gold)">${kpis.excessSuspicious}</td></tr>
            <tr><td>صور بتحقق صالح</td><td>${kpis.validStudied}</td></tr>
          </tbody></table>
        </div>
      </div>
      <div class="xr-footer"><span>التقرير التنفيذي — ${esc(ctx.monthLabel)}</span><span>21</span></div>
    </div>
  </section>`;
}
```

- [ ] Create `src/data/reporting/executive/pages/levelAgreement.ts`:

```ts
import type { ExecutiveRenderContext } from "../context";
import { kpiCard, barRow, fmtPct, esc } from "../primitives";

export function buildLevelAgreement(ctx: ExecutiveRenderContext): string {
  const { kpis } = ctx;

  const bars = [
    barRow({ label: "دقة المستوى الأول", value: kpis.levelOneAccuracy, max: 100, tone: "good" }),
    barRow({ label: "دقة المستوى الثاني", value: kpis.levelTwoAccuracy, max: 100, tone: "blue" }),
    barRow({ label: "معدل الاختلاف م.أول/ثاني", value: kpis.levelDisagreementRate, max: 100, tone: "risk" }),
    barRow({ label: "معدل تصحيح م.ثاني", value: kpis.levelTwoCorrectionRate, max: 100 }),
    barRow({ label: "معدل تراجع م.ثاني", value: kpis.levelTwoRegressionRate, max: 100, tone: "risk" }),
  ].join("");

  return `<section class="xr-page" id="page-level-agree">
    <div class="xr-page-inner">
      <div class="xr-slide-head"><h2>مقارنة المستوى الأول والثاني وتوافق الموظفين</h2><span class="xr-pg">22</span></div>
      <div class="xr-cols xr-cols-2">
        <div class="xr-panel">
          <div class="xr-panel-title">مقارنة المستويين</div>
          <div class="xr-bars" style="margin-top:0.1in">${bars}</div>
        </div>
        <div class="xr-panel">
          <div class="xr-panel-title">توافق أزواج الموظفين</div>
          <div class="xr-notice" style="margin-top:0.1in">هذا الجزء يتطلب وجود حالات راجعها موظفان مختلفان — لم تُرصد حالات كهذه في هذا الشهر.</div>
        </div>
      </div>
      <div class="xr-footer"><span>التقرير التنفيذي — ${esc(ctx.monthLabel)}</span><span>22</span></div>
    </div>
  </section>`;
}
```

- [ ] Wire `buildAccuracyByPort`, `buildAccuracyByLevel`, `buildLevelAgreement` into `index.ts` after `buildPart4Divider`.
- [ ] Edit log + commit: `feat(executive-report): add accuracy-by-port, accuracy-by-level, level-agreement pages`

---

## Phase 4 — Parts 5–6 employee analytics

### Task 13: Create `executiveEmployeeData.ts` + tests

**Files:**
- Create: `src/data/reporting/executive/executiveEmployeeData.ts`
- Create: `src/data/reporting/executive/executiveEmployeeData.test.ts`

- [ ] Create `src/data/reporting/executive/executiveEmployeeData.ts`:

```ts
import type { ExecutiveReportRow } from "../executiveReportTypes";

export type EmployeeProfile = {
  username: string;
  studied: number;
  workload: number;
  overallAccuracy: number | null;
  suspiciousDetectionRate: number | null;
  missedSuspicionRate: number | null;
  excessSuspicionRate: number | null;
  levelOneAccuracy: number | null;
  levelTwoAccuracy: number | null;
  byPort: Map<string, { studied: number; accuracy: number | null }>;
  byDecision: { onSuspicious: number | null; onClean: number | null };
  byImageQuality: Record<"عالي" | "متوسط" | "منخفض", { studied: number; accuracy: number | null }>;
  byMarking: { marked: { studied: number; accuracy: number | null }; unmarked: { studied: number; accuracy: number | null } };
  stabilityIndex: number | null;
  reliable: boolean;
  riskScore: number;
  recommendedAction: string;
};

function safeRate(num: number, den: number): number | null {
  return den === 0 ? null : (num / den) * 100;
}

function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

export function buildEmployeeProfiles(
  rows: ExecutiveReportRow[],
  minimumReliableSampleSize = 30,
): EmployeeProfile[] {
  // Group submitted rows by evaluator
  const groups = new Map<string, ExecutiveReportRow[]>();
  for (const row of rows) {
    if (row.answerStatus !== "submitted") continue;
    const emp = (row as ExecutiveReportRow & { answeredBy?: string | null }).answeredBy ?? row.assignedTo;
    if (!emp) continue;
    if (!groups.has(emp)) groups.set(emp, []);
    groups.get(emp)!.push(row);
  }

  return [...groups.entries()].map(([username, empRows]) => {
    const withVerif = empRows.filter(r => r.verificationCategory !== null);
    const studied = withVerif.length;
    const workload = empRows.length;

    const correct = withVerif.filter(r => r.imageResultAccurate).length;
    const overallAccuracy = safeRate(correct, studied);

    const suspRows = withVerif.filter(r => ["correct-suspicious","missed-suspicious"].includes(r.verificationCategory!));
    const suspiciousDetectionRate = safeRate(withVerif.filter(r => r.verificationCategory === "correct-suspicious").length, suspRows.length);
    const missedSuspicionRate = safeRate(withVerif.filter(r => r.verificationCategory === "missed-suspicious").length, suspRows.length);
    const excessSuspicionRate = safeRate(
      withVerif.filter(r => r.verificationCategory === "excess-suspicious").length,
      withVerif.filter(r => ["correct-suspicious","excess-suspicious"].includes(r.verificationCategory!)).length,
    );

    const levelOneAccuracy = safeRate(withVerif.filter(r => r.levelOneAccurate).length, studied);
    const levelTwoAccuracy = safeRate(withVerif.filter(r => r.levelTwoAccurate).length, studied);

    // byPort
    const byPort = new Map<string, { studied: number; accuracy: number | null }>();
    for (const r of withVerif) {
      const port = r.portName ?? "غير محدد";
      const rec = byPort.get(port) ?? { studied: 0, accuracy: null, _correct: 0 } as { studied: number; accuracy: number | null; _correct: number };
      rec.studied++;
      if (r.imageResultAccurate) (rec as { studied: number; accuracy: number | null; _correct: number })._correct++;
      byPort.set(port, rec);
    }
    for (const [port, rec] of byPort) {
      const r = rec as { studied: number; accuracy: number | null; _correct: number };
      byPort.set(port, { studied: r.studied, accuracy: safeRate(r._correct, r.studied) });
    }

    // byDecision
    const onSuspRows = withVerif.filter(r => r.expertResult === "اشتباه");
    const onCleanRows = withVerif.filter(r => r.expertResult === "سليمة");
    const byDecision = {
      onSuspicious: safeRate(onSuspRows.filter(r => r.imageResultAccurate).length, onSuspRows.length),
      onClean: safeRate(onCleanRows.filter(r => r.imageResultAccurate).length, onCleanRows.length),
    };

    // byImageQuality
    const byImageQuality = {
      "عالي": { studied: 0, accuracy: null as number | null, _correct: 0 },
      "متوسط": { studied: 0, accuracy: null as number | null, _correct: 0 },
      "منخفض": { studied: 0, accuracy: null as number | null, _correct: 0 },
    } as Record<"عالي"|"متوسط"|"منخفض", { studied: number; accuracy: number|null; _correct: number }>;
    for (const r of withVerif) {
      if (r.imageQuality && r.imageQuality in byImageQuality) {
        byImageQuality[r.imageQuality].studied++;
        if (r.imageResultAccurate) byImageQuality[r.imageQuality]._correct++;
      }
    }
    for (const q of ["عالي","متوسط","منخفض"] as const) {
      byImageQuality[q].accuracy = safeRate(byImageQuality[q]._correct, byImageQuality[q].studied);
    }

    // byMarking
    const markedRows = withVerif.filter(r => r.hasMarking === true);
    const unmarkedRows = withVerif.filter(r => r.hasMarking === false);
    const byMarking = {
      marked: { studied: markedRows.length, accuracy: safeRate(markedRows.filter(r => r.imageResultAccurate).length, markedRows.length) },
      unmarked: { studied: unmarkedRows.length, accuracy: safeRate(unmarkedRows.filter(r => r.imageResultAccurate).length, unmarkedRows.length) },
    };

    // stabilityIndex — stdev of per-port accuracy
    const portAccuracies = [...byPort.values()].map(p => p.accuracy).filter((a): a is number => a !== null);
    const stabilityIndex = portAccuracies.length >= 2 ? stdev(portAccuracies) : null;

    const reliable = studied >= minimumReliableSampleSize;

    // riskScore: higher = more concern
    let riskScore = 0;
    if (overallAccuracy !== null && overallAccuracy < 90) riskScore += (90 - overallAccuracy) * 2;
    if (missedSuspicionRate !== null && missedSuspicionRate > 5) riskScore += missedSuspicionRate * 3;
    if (stabilityIndex !== null && stabilityIndex > 15) riskScore += stabilityIndex;

    const recommendedAction =
      !reliable ? "بيانات غير كافية للتقييم" :
      missedSuspicionRate !== null && missedSuspicionRate > 10 ? "مراجعة عاجلة — اشتباه فائت مرتفع" :
      overallAccuracy !== null && overallAccuracy < 80 ? "تدريب مكثف — دقة منخفضة" :
      overallAccuracy !== null && overallAccuracy < 90 ? "متابعة دورية — دقة دون الهدف" :
      "أداء مستقر";

    return {
      username, studied, workload, overallAccuracy, suspiciousDetectionRate, missedSuspicionRate,
      excessSuspicionRate, levelOneAccuracy, levelTwoAccuracy,
      byPort, byDecision,
      byImageQuality: byImageQuality as Record<"عالي"|"متوسط"|"منخفض", { studied: number; accuracy: number|null }>,
      byMarking, stabilityIndex, reliable, riskScore, recommendedAction,
    };
  }).sort((a, b) => (b.overallAccuracy ?? -1) - (a.overallAccuracy ?? -1));
}

export function buildPriorityList(profiles: EmployeeProfile[]): EmployeeProfile[] {
  return [...profiles].sort((a, b) => b.riskScore - a.riskScore).filter(p => p.reliable);
}
```

- [ ] Create `src/data/reporting/executive/executiveEmployeeData.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildEmployeeProfiles, buildPriorityList } from "./executiveEmployeeData";
import type { ExecutiveReportRow } from "../executiveReportTypes";

function makeRow(overrides: Partial<ExecutiveReportRow>): ExecutiveReportRow {
  return {
    xrayImageId: "img1",
    portName: "منفذ أ",
    portType: "land",
    stage: "المستوى الأول",
    levelOneResult: "سليمة",
    levelTwoResult: "سليمة",
    imageResult: "سليمة",
    selectedInSample: true,
    assignedTo: "user1",
    distributionStatus: "completed",
    expertResult: "سليمة",
    imageAvailable: true,
    noImageReason: null,
    hasMarking: false,
    imageQuality: "عالي",
    lowQualityReason: null,
    suspicionLevel: null,
    suspectedTypes: null,
    smuggleMethod: null,
    answerStatus: "submitted",
    assignedAt: "2026-05-01T08:00:00Z",
    submittedAt: "2026-05-01T09:00:00Z",
    imageResultAccurate: true,
    levelOneAccurate: true,
    levelTwoAccurate: true,
    verificationCategory: "correct-clean",
    ...overrides,
  };
}

describe("buildEmployeeProfiles", () => {
  it("returns empty array for no submitted rows", () => {
    const rows = [makeRow({ answerStatus: "draft" })];
    expect(buildEmployeeProfiles(rows)).toEqual([]);
  });

  it("calculates overallAccuracy correctly", () => {
    const rows = [
      makeRow({ assignedTo: "u1", imageResultAccurate: true, verificationCategory: "correct-clean" }),
      makeRow({ xrayImageId: "img2", assignedTo: "u1", imageResultAccurate: false, verificationCategory: "missed-suspicious" }),
    ];
    const profiles = buildEmployeeProfiles(rows, 1);
    expect(profiles).toHaveLength(1);
    expect(profiles[0].overallAccuracy).toBe(50);
  });

  it("marks employee as unreliable below threshold", () => {
    const rows = [makeRow({ assignedTo: "u1" })];
    const profiles = buildEmployeeProfiles(rows, 30);
    expect(profiles[0].reliable).toBe(false);
  });

  it("marks employee as reliable at threshold", () => {
    const rows = Array.from({ length: 30 }, (_, i) =>
      makeRow({ xrayImageId: `img${i}`, assignedTo: "u1" })
    );
    const profiles = buildEmployeeProfiles(rows, 30);
    expect(profiles[0].reliable).toBe(true);
  });
});

describe("buildPriorityList", () => {
  it("returns only reliable profiles sorted by riskScore desc", () => {
    const rows = [
      makeRow({ assignedTo: "u1", imageResultAccurate: false, verificationCategory: "missed-suspicious" }),
      ...Array.from({ length: 30 }, (_, i) => makeRow({ xrayImageId: `r${i}`, assignedTo: "u1", imageResultAccurate: false, verificationCategory: "missed-suspicious" })),
    ];
    const profiles = buildEmployeeProfiles(rows, 30);
    const priority = buildPriorityList(profiles);
    expect(priority.length).toBeGreaterThan(0);
    expect(priority[0].riskScore).toBeGreaterThan(0);
  });
});
```

- [ ] Run `npx vitest run src/data/reporting/executive/executiveEmployeeData.test.ts` — all tests must pass.
- [ ] Edit log + commit: `feat(executive-report): add employee analytics data module with tests`

---

### Task 14: Employee pages (empOverview, empByDecision, empByPort, empImageQuality, empStability, empPriority)

**Files:**
- Create: `src/data/reporting/executive/pages/empOverview.ts`
- Create: `src/data/reporting/executive/pages/empByDecision.ts`
- Create: `src/data/reporting/executive/pages/empByPort.ts`
- Create: `src/data/reporting/executive/pages/empImageQuality.ts`
- Create: `src/data/reporting/executive/pages/empStability.ts`
- Create: `src/data/reporting/executive/pages/empPriority.ts`

- [ ] Create `src/data/reporting/executive/pages/empOverview.ts`:

```ts
import type { ExecutiveRenderContext } from "../context";
import { dataTable, barRow, kpiCard, fmtNum, fmtPct, esc } from "../primitives";
import { buildEmployeeProfiles } from "../executiveEmployeeData";

export function buildEmpOverview(ctx: ExecutiveRenderContext): string {
  const profiles = buildEmployeeProfiles(
    ctx.input.distribution
      ? ([] as Parameters<typeof buildEmployeeProfiles>[0])
      : [],
    ctx.input.config.minimumReliableSampleSize,
  );
  // Note: profiles built from ExecutiveReportRow[] — passed via ctx in Phase 4 wiring
  // For now ctx carries rows via assemble
  if (profiles.length === 0) {
    return `<section class="xr-page" id="page-emp-overview">
      <div class="xr-page-inner">
        <div class="xr-slide-head"><h2>النظرة العامة لأداء الموظفين</h2><span class="xr-pg">24</span></div>
        <div class="xr-notice">بيانات غير كافية — لا توجد إجابات مقدَّمة لهذا الشهر.</div>
        <div class="xr-footer"><span>التقرير التنفيذي — ${esc(ctx.monthLabel)}</span><span>24</span></div>
      </div>
    </section>`;
  }

  const tableRows = profiles.map(p => [
    esc(ctx.displayName(p.username)),
    fmtNum(p.studied),
    p.reliable ? fmtPct(p.overallAccuracy) : null,
    p.reliable ? fmtPct(p.missedSuspicionRate) : null,
    esc(p.recommendedAction),
  ]);

  const top5 = profiles.filter(p => p.reliable).slice(0, 5);
  const bars = top5.map(p => barRow({ label: ctx.displayName(p.username), value: p.overallAccuracy, max: 100, tone: "good" })).join("");

  return `<section class="xr-page" id="page-emp-overview">
    <div class="xr-page-inner">
      <div class="xr-slide-head"><h2>النظرة العامة لأداء الموظفين</h2><span class="xr-pg">24</span></div>
      <div class="xr-cols xr-cols-6-4">
        <div>${dataTable({ headers: ["الموظف","مدروسة","الدقة","اشتباه فائت","التوصية"], rows: tableRows })}</div>
        <div class="xr-panel">
          <div class="xr-panel-title">أفضل 5 موظفين — الدقة</div>
          <div class="xr-bars">${bars}</div>
        </div>
      </div>
      <div class="xr-footer"><span>التقرير التنفيذي — ${esc(ctx.monthLabel)}</span><span>24</span></div>
    </div>
  </section>`;
}
```

- [ ] Create `src/data/reporting/executive/pages/empPriority.ts`:

```ts
import type { ExecutiveRenderContext } from "../context";
import { fmtPct, esc, noticeBox } from "../primitives";
import { buildEmployeeProfiles, buildPriorityList } from "../executiveEmployeeData";

export function buildEmpPriority(ctx: ExecutiveRenderContext): string {
  // profiles injected via ctx in Phase 4 final wiring
  const priority: ReturnType<typeof buildPriorityList> = [];

  if (priority.length === 0) {
    return `<section class="xr-page" id="page-emp-priority">
      <div class="xr-page-inner">
        <div class="xr-slide-head"><h2>الموظفون ذوو الأولوية والإجراءات المقترحة</h2><span class="xr-pg">30</span></div>
        ${noticeBox("لا يوجد موظفون يتطلبون تدخلاً عاجلاً في هذه الدورة.")}
        <div class="xr-footer"><span>التقرير التنفيذي — ${esc(ctx.monthLabel)}</span><span>30</span></div>
      </div>
    </section>`;
  }

  const cards = priority.slice(0, 6).map((p, i) => `
    <div class="xr-panel" style="border-right:3px solid var(--xr-coral)">
      <div style="font-size:0.085in;font-weight:800;color:var(--xr-gold);margin-bottom:0.04in">#${i+1} — ${esc(ctx.displayName(p.username))}</div>
      <div style="font-size:0.08in;color:var(--xr-muted)">الدقة: ${fmtPct(p.overallAccuracy)} | اشتباه فائت: ${fmtPct(p.missedSuspicionRate)}</div>
      <div style="margin-top:0.06in;font-size:0.08in;color:var(--xr-white);font-weight:700">${esc(p.recommendedAction)}</div>
    </div>`).join("");

  return `<section class="xr-page" id="page-emp-priority">
    <div class="xr-page-inner">
      <div class="xr-slide-head"><h2>الموظفون ذوو الأولوية والإجراءات المقترحة</h2><span class="xr-pg">30</span></div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:0.1in">${cards}</div>
      <div class="xr-footer"><span>التقرير التنفيذي — ${esc(ctx.monthLabel)}</span><span>30</span></div>
    </div>
  </section>`;
}
```

- [ ] Create stub files for remaining employee pages (`empByDecision.ts`, `empByPort.ts`, `empImageQuality.ts`, `empStability.ts`) — each exports a function returning a "coming soon" slide with a `xr-notice` box. Full implementation follows the same pattern as empOverview: group `ctx.input.distribution` data via `buildEmployeeProfiles`.

- [ ] **Wiring — update `executive/index.ts` to pass employee data**: Add `ExecutiveReportRow[]` to `ExecutiveRenderContext` (add `rows: ExecutiveReportRow[]` field in `context.ts`), populate it in `buildContext`, then all employee pages call `buildEmployeeProfiles(ctx.rows, ctx.input.config.minimumReliableSampleSize)` directly.

- [ ] Wire all Phase 4 pages into `index.ts` pages array.
- [ ] Run `npm run build` — TS clean.
- [ ] Run `npx vitest run` — all tests pass.
- [ ] Edit log + commit: `feat(executive-report): add employee analytics pages (Phase 4)`

---

### Task 15: Final integration check

- [ ] Run `npm run build` — produces single `dist/index.html`, no errors.
- [ ] Run `npm run dev`, open Reports tab, click تصدير — dark-navy viewer opens, sidebar on right, "تصدير PDF" button visible.
- [ ] Click "تصدير PDF" — browser print dialog opens with dark navy preserved.
- [ ] Verify no `XX%` anywhere in the output — all values are live numbers.
- [ ] Run `npx vitest run` — all tests green.
- [ ] Final commit: `feat(executive-report): complete dark-navy executive report rework (all phases)`
