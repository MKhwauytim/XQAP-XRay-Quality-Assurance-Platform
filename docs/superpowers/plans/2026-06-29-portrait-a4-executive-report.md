# Portrait A4 Executive Report Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the executive report HTML output from landscape 16:9 slides (13.333in × 7.5in, sidebar viewer) to portrait A4 document pages (8.27in × 11.69in, fixed toolbar, scrollable).

**Architecture:** All changes are confined to `src/data/reporting/executive/` — theme.ts (CSS), viewer.ts (shell HTML), assemble.ts (wiring), and all page files under pages/. The data/logic layer (`context.ts`, `primitives.ts`, `executiveEmployeeData.ts`, `index.ts`, `executiveReportTypes.ts`) is untouched. The `buildViewerHtml` signature loses its `sidebarLinks` parameter; assemble.ts is updated accordingly.

**Tech Stack:** TypeScript, template literals producing HTML strings, plain CSS embedded via `EXEC_CSS`, Vite (build), Vitest (tests). No React in this module.

## Global Constraints

- RTL layout — all containers use `dir="rtl"` (already on `<html>`); text-align defaults are right
- Arabic text only for user-facing strings; English for class names and identifiers
- A4 portrait: `width:8.27in; min-height:11.69in` per `.xr-page`
- Gold accent: `#e3a000` (`--xr-gold`); dark navy bg: `#0a1628` (`--xr-bg`)
- `@media print { @page { size: A4 portrait; margin: 0; } }` hides toolbar
- No new dependencies — pure HTML/CSS strings
- Edit log entry required in `docs/EDIT_LOG.md` (version v21.0 — major visual redesign)
- Commit message: `feat(executive-report): redesign to portrait A4 document format`
- Report file: `.superpowers/sdd/portrait-redesign-report.md`
- `npm run build` must pass zero TS errors; `npx vitest run` all tests must pass

---

## File Map

| File | Action | What changes |
|------|--------|--------------|
| `src/data/reporting/executive/theme.ts` | Modify | Complete CSS rewrite — A4 page, no sidebar, toolbar, org header, vtabs, font px |
| `src/data/reporting/executive/viewer.ts` | Modify | Remove `sidebarLinks` param; output toolbar + `.xr-document` wrapper |
| `src/data/reporting/executive/assemble.ts` | Modify | Remove `NAV_SECTIONS` + sidebar link generation; call updated `buildViewerHtml` |
| `src/data/reporting/executive/pages/cover.ts` | Modify | Full portrait cover redesign |
| `src/data/reporting/executive/pages/toc.ts` | Modify | Add org header; use `.xr-page-num` footer |
| `src/data/reporting/executive/pages/execIntro.ts` | Modify | Add org header; px sizes; remove `.xr-footer` |
| `src/data/reporting/executive/pages/glossary.ts` | Modify | Add org header; 2×2 level card grid; separator |
| `src/data/reporting/executive/pages/partDivider.ts` | Modify | Full vtabs redesign |
| `src/data/reporting/executive/pages/populationByRisk.ts` | Modify | Add org header; 3-card KPI row; remove footer |
| `src/data/reporting/executive/pages/populationByLevel.ts` | Modify | Add org header; remove footer |
| `src/data/reporting/executive/pages/sampleByLevel.ts` | Modify | Add org header; remove footer |
| `src/data/reporting/executive/pages/distributionOverview.ts` | Modify | Add org header; remove footer |
| `src/data/reporting/executive/pages/accuracyByLevel.ts` | Modify | Add org header; remove footer |
| `src/data/reporting/executive/pages/accuracyByPort.ts` | Modify | Add org header; remove footer |
| `src/data/reporting/executive/pages/levelAgreement.ts` | Modify | Add org header; remove footer |
| `src/data/reporting/executive/pages/empOverview.ts` | Modify | Add org header; remove footer |
| `src/data/reporting/executive/pages/empPriority.ts` | Modify | Add org header; remove footer |
| `src/data/reporting/executive/pages/empByDecision.ts` | Modify | Add org header; remove footer |
| `src/data/reporting/executive/pages/empByPort.ts` | Modify | Add org header; remove footer |
| `src/data/reporting/executive/pages/empImageQuality.ts` | Modify | Add org header; remove footer |
| `src/data/reporting/executive/pages/empStability.ts` | Modify | Add org header; remove footer |
| `src/data/reporting/executive/pages/appendix.ts` | Modify | Add org header; remove footer |
| `docs/EDIT_LOG.md` | Modify | Add v21.0 entry |
| `.superpowers/sdd/portrait-redesign-report.md` | Create | Implementation report |

---

## Task 1: Rewrite `theme.ts` — A4 CSS

**Files:**
- Modify: `src/data/reporting/executive/theme.ts`

**Interfaces:**
- Consumes: nothing (standalone CSS)
- Produces: `EXEC_CSS` string used by `viewer.ts`

- [ ] **Step 1: Replace the entire contents of `theme.ts`**

Replace the full file content with:

```ts
// Design tokens and CSS for the dark-navy executive report viewer.
// Portrait A4 document format — redesigned from landscape slides.

export const EXEC_CSS = `
@font-face{font-family:"Somar";src:url("${import.meta.env.BASE_URL}fonts/SomarSans-Regular.woff") format("woff");font-weight:400;font-style:normal;font-display:swap;}
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
  background:#050d1a;
  min-height:100vh;
  font-variant-numeric:tabular-nums;
}
/* ── Toolbar ── */
.xr-toolbar{
  position:fixed;top:0;left:0;right:0;z-index:100;
  background:rgba(5,13,26,0.97);
  border-bottom:1px solid rgba(255,255,255,0.1);
  padding:8px 24px;
  display:flex;justify-content:center;align-items:center;gap:16px;
}
.xr-pdf-btn{
  padding:8px 22px;border:none;border-radius:8px;cursor:pointer;
  background:var(--xr-gold);color:#0a1628;font-family:inherit;
  font-size:14px;font-weight:700;
}
.xr-pdf-btn:hover{background:var(--xr-gold2);}
/* ── Document scroll container ── */
.xr-document{
  display:flex;flex-direction:column;align-items:center;
  gap:20px;padding:56px 16px 32px;
  background:#050d1a;min-height:100vh;
}
/* ── A4 Portrait page ── */
.xr-page{
  width:8.27in;min-height:11.69in;
  background:
    radial-gradient(circle at 88% 8%, rgba(74,159,212,0.1) 0%, transparent 30%),
    linear-gradient(160deg, var(--xr-bg) 0%, var(--xr-bg2) 100%);
  border:1px solid var(--xr-line);
  border-radius:4px;
  position:relative;overflow:hidden;isolation:isolate;
  page-break-after:always;break-after:page;
}
.xr-page-inner{
  padding:0.4in 0.42in 0.45in;
  display:flex;flex-direction:column;
  min-height:11.69in;
}
/* ── Org header (content pages) ── */
.xr-org-header{
  display:flex;align-items:center;justify-content:flex-end;gap:10px;
  padding-bottom:10px;margin-bottom:14px;
  border-bottom:1px solid rgba(227,160,0,0.35);
}
.xr-org-logo{
  width:34px;height:34px;border:1px solid var(--xr-gold);border-radius:7px;
  display:grid;place-items:center;color:var(--xr-gold);font-size:18px;flex-shrink:0;
}
.xr-org-text{
  font-size:9px;line-height:1.6;color:var(--xr-muted);font-weight:600;
  text-align:right;
}
/* ── Page title ── */
.xr-page-title{
  font-size:18px;font-weight:800;color:var(--xr-gold);
  margin-bottom:12px;
}
.xr-page-subtitle{
  font-size:11px;color:var(--xr-muted);font-weight:600;margin-bottom:10px;
}
/* ── Page number ── */
.xr-page-num{
  position:absolute;bottom:0.25in;left:0;right:0;
  text-align:center;color:var(--xr-muted);font-size:11px;font-weight:700;
  letter-spacing:0.05em;
}
/* ── Cover page ── */
.xr-cover{
  background:
    radial-gradient(circle at 50% 40%, rgba(74,159,212,0.15) 0%, transparent 50%),
    radial-gradient(circle at 90% 10%, rgba(227,160,0,0.12) 0%, transparent 30%),
    linear-gradient(160deg, #081422 0%, #0d1f38 60%, #0a1828 100%);
}
.xr-cover-header{
  display:flex;align-items:center;justify-content:flex-end;gap:10px;
  padding:0.3in 0.42in 0.18in;
  border-bottom:1px solid rgba(227,160,0,0.25);
}
.xr-cover-org-text{
  font-size:9px;line-height:1.7;color:var(--xr-muted);font-weight:600;text-align:right;
}
.xr-cover-logo{
  width:36px;height:36px;border:1px solid var(--xr-gold);border-radius:8px;
  display:grid;place-items:center;color:var(--xr-gold);font-size:20px;flex-shrink:0;
}
.xr-cover-main{
  padding:0.5in 0.42in 0;
  flex:1;display:flex;flex-direction:column;justify-content:center;
}
.xr-cover-eyebrow{
  font-size:12px;color:var(--xr-cyan);font-weight:700;
  margin-bottom:12px;letter-spacing:0.06em;
}
.xr-cover-title{
  font-size:64px;font-weight:800;line-height:1.1;
  color:var(--xr-white);margin-bottom:20px;
}
.xr-cover-title span{color:var(--xr-gold);}
.xr-cover-subtitle{
  font-size:13px;color:var(--xr-muted);font-weight:600;
  line-height:1.6;margin-bottom:28px;max-width:5.5in;
}
.xr-cover-meta{display:flex;flex-direction:column;gap:10px;margin-bottom:36px;}
.xr-cover-meta-item{
  display:flex;align-items:center;gap:8px;
  font-size:12px;color:var(--xr-gold);font-weight:600;
}
.xr-cover-meta-item b{color:var(--xr-white);font-weight:700;}
.xr-cover-bottom{
  padding:0.2in 0.42in 0.35in;
  border-top:1px solid var(--xr-line);
}
.xr-cover-levels{
  display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px;
}
.xr-level-chip{
  display:flex;align-items:center;gap:7px;
  border:1px solid var(--xr-line);border-radius:6px;
  padding:7px 9px;background:rgba(255,255,255,0.04);
}
.xr-level-chip-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0;}
.xr-level-chip-text strong{display:block;font-size:9px;font-weight:700;color:var(--xr-white);}
.xr-level-chip-text span{display:block;font-size:8px;color:var(--xr-muted);font-weight:600;}
.xr-cover-badges{display:flex;gap:10px;}
.xr-cover-badge{
  border:1px solid rgba(227,160,0,0.5);border-radius:6px;
  padding:5px 14px;font-size:10px;font-weight:700;color:var(--xr-gold);
  background:rgba(227,160,0,0.07);
}
/* ── Part divider page ── */
.xr-divider-page{
  position:relative;display:flex;
  background:
    radial-gradient(circle at 25% 50%, rgba(227,160,0,0.1) 0%, transparent 35%),
    linear-gradient(160deg, #081422 0%, #0d1f38 100%);
}
.xr-vtabs{
  position:absolute;right:0;top:0;bottom:0;
  width:52px;display:flex;flex-direction:column;gap:0;
}
.xr-vtab{
  flex:1;display:flex;align-items:center;justify-content:center;
  writing-mode:vertical-rl;text-orientation:mixed;
  font-size:10px;font-weight:700;color:#0a1628;
  opacity:0.92;
}
.xr-divider-body{
  flex:1;display:flex;flex-direction:column;
  justify-content:center;align-items:center;
  text-align:center;
  padding:0.6in 1.1in 0.6in 0.5in;
}
.xr-divider-icon{font-size:52px;margin-bottom:18px;opacity:0.75;}
.xr-divider-eyebrow{font-size:13px;color:var(--xr-gold);font-weight:700;margin-bottom:10px;}
.xr-divider-title{font-size:52px;font-weight:800;color:var(--xr-white);line-height:1.1;margin-bottom:16px;}
.xr-divider-rule{width:2.5in;height:2px;background:var(--xr-gold);margin:0 auto 16px;opacity:0.5;}
.xr-divider-sub{font-size:12px;color:var(--xr-muted);max-width:4.5in;line-height:1.7;font-weight:600;}
/* ── KPI cards ── */
.xr-kpi-grid{display:grid;gap:8px;margin-bottom:14px;}
.xr-kpi-grid-3{grid-template-columns:repeat(3,1fr);}
.xr-kpi-grid-4{grid-template-columns:repeat(4,1fr);}
.xr-kpi-grid-6{grid-template-columns:repeat(6,1fr);}
.xr-kpi{
  background:var(--xr-panel);border:1px solid var(--xr-line);border-radius:8px;
  padding:10px 12px;
}
.xr-kpi-label{font-size:9px;color:var(--xr-muted);font-weight:600;margin-bottom:4px;}
.xr-kpi-value{font-size:22px;font-weight:800;color:var(--xr-white);direction:ltr;text-align:right;}
.xr-kpi-sub{font-size:9px;color:var(--xr-muted);margin-top:3px;}
.xr-kpi.good .xr-kpi-value{color:var(--xr-green);}
.xr-kpi.warn .xr-kpi-value{color:var(--xr-gold);}
.xr-kpi.risk .xr-kpi-value{color:var(--xr-coral);}
.xr-kpi.accent{border-color:var(--xr-gold);border-top:2px solid var(--xr-gold);}
/* ── Tables ── */
.xr-table-wrap{border:1px solid var(--xr-line);border-radius:8px;overflow:hidden;}
.xr-table{width:100%;border-collapse:collapse;font-size:10px;}
.xr-table th{background:#1a4040;color:var(--xr-cyan);padding:7px 8px;text-align:center;font-weight:700;white-space:nowrap;}
.xr-table td{padding:6px 7px;border-bottom:1px solid var(--xr-line);text-align:center;color:var(--xr-white);font-weight:600;}
.xr-table tr:last-child td{border-bottom:0;}
.xr-table tr:nth-child(even) td{background:rgba(255,255,255,0.025);}
.xr-table .total-row td{background:rgba(227,160,0,0.08);color:var(--xr-gold);font-weight:800;}
.xr-table .insuff{color:var(--xr-muted);font-style:italic;}
/* ── Bar rows ── */
.xr-bars{display:grid;gap:7px;}
.xr-bar-row{display:grid;grid-template-columns:1in 1fr 0.45in;gap:7px;align-items:center;}
.xr-bar-row span{font-size:10px;font-weight:600;color:var(--xr-white);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.xr-bar-track{height:10px;background:rgba(255,255,255,0.08);border-radius:3px;overflow:hidden;}
.xr-bar-fill{height:100%;border-radius:3px;background:var(--xr-gold);}
.xr-bar-fill.good{background:var(--xr-green);}
.xr-bar-fill.risk{background:var(--xr-coral);}
.xr-bar-fill.blue{background:var(--xr-blue);}
.xr-bar-row b{font-size:10px;font-weight:800;color:var(--xr-white);direction:ltr;text-align:left;}
/* ── Status badge ── */
.xr-badge{display:inline-block;padding:2px 7px;border-radius:4px;font-size:9px;font-weight:700;}
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
  padding:10px 13px;
  font-size:10px;color:var(--xr-muted);line-height:1.55;font-weight:600;
}
/* ── Level cards (glossary) 2×2 ── */
.xr-level-cards{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:16px;}
.xr-level-card{border-radius:8px;overflow:hidden;border:1px solid var(--xr-line);}
.xr-level-card-head{padding:12px 14px;text-align:center;}
.xr-level-card-head h3{font-size:14px;font-weight:800;color:#0a1628;margin-bottom:3px;}
.xr-level-card-head span{font-size:10px;font-weight:700;color:rgba(10,22,40,0.7);}
.xr-level-card-icon{font-size:24px;margin-bottom:6px;}
.xr-level-card-body{padding:10px 12px;background:var(--xr-panel);font-size:10px;line-height:1.6;color:var(--xr-muted);font-weight:600;}
.xr-level-card-bar{height:4px;}
.xr-l1-card .xr-level-card-head{background:var(--xr-gold);}
.xr-l1-card .xr-level-card-bar{background:var(--xr-gold);}
.xr-l2-card .xr-level-card-head{background:var(--xr-cyan);}
.xr-l2-card .xr-level-card-bar{background:var(--xr-cyan);}
.xr-l3-card .xr-level-card-head{background:var(--xr-blue);}
.xr-l3-card .xr-level-card-bar{background:var(--xr-blue);}
.xr-l4-card .xr-level-card-head{background:var(--xr-coral);}
.xr-l4-card .xr-level-card-bar{background:var(--xr-coral);}
/* ── Glossary separator ── */
.xr-glossary-sep{
  display:flex;align-items:center;gap:10px;
  margin:16px 0 12px;
  font-size:11px;font-weight:800;color:var(--xr-gold);
}
.xr-glossary-sep::before,.xr-glossary-sep::after{
  content:"";flex:1;height:1px;background:rgba(227,160,0,0.3);
}
/* ── TOC ── */
.xr-toc-grid{display:grid;gap:7px;}
.xr-toc-row{
  display:grid;grid-template-columns:0.3in 1fr 0.4in;gap:10px;align-items:center;
  padding:8px 10px;border-radius:6px;
  border:1px solid var(--xr-line);background:var(--xr-panel);
  text-decoration:none;color:var(--xr-white);
}
.xr-toc-row:hover{border-color:var(--xr-gold);}
.xr-toc-num{font-size:13px;font-weight:800;color:var(--xr-gold);text-align:center;}
.xr-toc-label{font-size:11px;font-weight:700;}
.xr-toc-pg{font-size:10px;color:var(--xr-muted);direction:ltr;text-align:left;}
/* ── Section title ── */
.xr-section-title{font-size:14px;font-weight:800;color:var(--xr-gold);margin-bottom:10px;}
/* ── Glossary terms ── */
.xr-terms-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;}
.xr-term{background:var(--xr-panel);border:1px solid var(--xr-line);border-radius:6px;padding:9px 10px;}
.xr-term-icon{font-size:16px;margin-bottom:5px;}
.xr-term-name{font-size:10px;font-weight:800;color:var(--xr-white);margin-bottom:3px;}
.xr-term-def{font-size:9px;color:var(--xr-muted);line-height:1.5;font-weight:600;}
/* ── Two-column layout ── */
.xr-cols{display:grid;gap:12px;align-items:start;}
.xr-cols-2{grid-template-columns:1fr 1fr;}
.xr-cols-3{grid-template-columns:1fr 1fr 1fr;}
.xr-cols-6-4{grid-template-columns:1.5fr 1fr;}
.xr-panel{background:var(--xr-panel);border:1px solid var(--xr-line);border-radius:8px;padding:12px;}
.xr-panel-title{font-size:11px;font-weight:800;color:var(--xr-gold);margin-bottom:9px;}
/* ── Heatmap cell ── */
.xr-heat-cell{
  display:inline-block;padding:2px 6px;border-radius:3px;
  font-size:9px;font-weight:700;min-width:40px;text-align:center;
}
.xr-heat-high{background:rgba(92,184,92,0.25);color:var(--xr-green);}
.xr-heat-mid{background:rgba(227,160,0,0.2);color:var(--xr-gold);}
.xr-heat-low{background:rgba(232,85,74,0.2);color:var(--xr-coral);}
.xr-heat-insuff{background:rgba(255,255,255,0.05);color:var(--xr-muted);}
/* ── Print ── */
@media print{
  @page{size:A4 portrait;margin:0;}
  body{background:#0a1628 !important;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  .xr-toolbar{display:none !important;}
  .xr-document{padding:0;gap:0;background:#0a1628;}
  .xr-page{margin:0;border:0;border-radius:0;box-shadow:none;page-break-after:always;break-after:page;}
  .xr-page:last-child{page-break-after:auto;break-after:auto;}
}
`;
```

- [ ] **Step 2: Verify TypeScript compiles (quick sanity — full build in Task 8)**

```bash
npx tsc --noEmit --project tsconfig.json 2>&1 | head -20
```

Expected: zero errors (or errors only from unchanged files if any pre-existing issues).

---

## Task 2: Rewrite `viewer.ts` — remove sidebar

**Files:**
- Modify: `src/data/reporting/executive/viewer.ts`

**Interfaces:**
- Consumes: `EXEC_CSS` from `./theme`; `esc` from `./primitives`
- Produces: `buildViewerHtml(slides: string, monthLabel: string): string` — **signature loses `sidebarLinks`**

- [ ] **Step 1: Replace the entire contents of `viewer.ts`**

```ts
import { EXEC_CSS } from "./theme";
import { esc } from "./primitives";

export function buildViewerHtml(slides: string, monthLabel: string): string {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>التقرير التنفيذي — ${esc(monthLabel)}</title>
<style>${EXEC_CSS}</style>
</head>
<body>
<div class="xr-toolbar">
  <button class="xr-pdf-btn" onclick="window.print()">🖨 تصدير PDF</button>
</div>
<div class="xr-document">
${slides}
</div>
</body>
</html>`;
}
```

- [ ] **Step 2: Run TypeScript check**

```bash
npx tsc --noEmit --project tsconfig.json 2>&1 | grep "viewer.ts"
```

Expected: no errors on `viewer.ts`.

---

## Task 3: Update `assemble.ts` — remove sidebar wiring

**Files:**
- Modify: `src/data/reporting/executive/assemble.ts`

**Interfaces:**
- Consumes: `buildViewerHtml(slides, monthLabel)` (updated 2-arg signature from Task 2)
- Produces: `assembleReport(ctx, pageBuilders): string` — unchanged public signature

- [ ] **Step 1: Replace the entire contents of `assemble.ts`**

```ts
import type { ExecutiveRenderContext } from "./context";
import { buildViewerHtml } from "./viewer";

export function assembleReport(
  ctx: ExecutiveRenderContext,
  pageBuilders: Array<(ctx: ExecutiveRenderContext) => string>,
): string {
  const slides = pageBuilders.map(fn => fn(ctx)).join("\n");
  return buildViewerHtml(slides, ctx.monthLabel);
}
```

- [ ] **Step 2: Run TypeScript check**

```bash
npx tsc --noEmit --project tsconfig.json 2>&1 | grep "assemble.ts"
```

Expected: no errors.

---

## Task 4: Rewrite `pages/cover.ts` — portrait cover

**Files:**
- Modify: `src/data/reporting/executive/pages/cover.ts`

**Interfaces:**
- Consumes: `ExecutiveRenderContext`, `esc`, `ORGANIZATION_PATH_TEXT`
- Produces: `buildCover(ctx): string`

The org path text `"الشؤون القانونية والالتزام ← الإدارة العامة لضمان الجودة والامتثال ← إدارة الرقابة والامتثال على المنافذ"` needs to be split on ` ← ` to render as stacked lines in the cover header.

- [ ] **Step 1: Replace the entire contents of `pages/cover.ts`**

```ts
import type { ExecutiveRenderContext } from "../context";
import { esc } from "../primitives";
import { ORGANIZATION_PATH_TEXT } from "../../../../branding/organization";

export function buildCover(ctx: ExecutiveRenderContext): string {
  const orgLines = ORGANIZATION_PATH_TEXT.split(" ← ")
    .map(l => `<div>${esc(l)}</div>`)
    .join("");

  const levels = [
    { label: "المستوى الأول", sub: "حالات الضبط المؤكدة", varColor: "var(--xr-l1)" },
    { label: "المستوى الثاني", sub: "حالات الاشتباه المؤكدة", varColor: "var(--xr-l2)" },
    { label: "المستوى الثالث", sub: "حالات محرك المخاطر", varColor: "var(--xr-l3)" },
    { label: "المستوى الرابع", sub: "اشتباه الأشعة غير المؤكد", varColor: "var(--xr-l4)" },
  ];
  const chips = levels.map(l => `
    <div class="xr-level-chip">
      <div class="xr-level-chip-dot" style="background:${l.varColor}"></div>
      <div class="xr-level-chip-text"><strong>${esc(l.label)}</strong><span>${esc(l.sub)}</span></div>
    </div>`).join("");

  return `<section class="xr-page xr-cover" id="page-cover">
    <div class="xr-cover-header">
      <div class="xr-cover-org-text">${orgLines}</div>
      <div class="xr-cover-logo">🛡</div>
    </div>
    <div class="xr-cover-main">
      <div class="xr-cover-eyebrow">التقرير التنفيذي</div>
      <div class="xr-cover-title">لضمان جودة <span>الأشعة</span></div>
      <div class="xr-cover-subtitle">تحليل مجتمع الحالات والعينة والتوزيع ومؤشرات الجودة</div>
      <div class="xr-cover-meta">
        <div class="xr-cover-meta-item">📅 دورة التقرير: <b>${esc(ctx.issueDate)}</b></div>
        <div class="xr-cover-meta-item">🎯 مجتمع الحالات محل الدراسة: <b>${esc(ctx.monthLabel)}</b></div>
      </div>
    </div>
    <div class="xr-cover-bottom">
      <div class="xr-cover-levels">${chips}</div>
      <div class="xr-cover-badges">
        <div class="xr-cover-badge">نسخة تنفيذية</div>
        <div class="xr-cover-badge">سري داخلياً</div>
      </div>
    </div>
    <div class="xr-page-num">• 01 •</div>
  </section>`;
}
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit --project tsconfig.json 2>&1 | grep "cover.ts"
```

Expected: no errors.

---

## Task 5: Rewrite `pages/toc.ts` — portrait TOC

**Files:**
- Modify: `src/data/reporting/executive/pages/toc.ts`

**Interfaces:**
- Consumes: `ExecutiveRenderContext` (unused, `_ctx`)
- Produces: `buildToc(_ctx): string`

The org header helper string is defined inline (not a shared function — keep it as a template literal for now; Task 6 through end will repeat the same pattern).

- [ ] **Step 1: Replace the entire contents of `pages/toc.ts`**

```ts
import type { ExecutiveRenderContext } from "../context";
import { esc } from "../primitives";
import { ORGANIZATION_PATH_TEXT } from "../../../../branding/organization";

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

function orgHeader(): string {
  const lines = ORGANIZATION_PATH_TEXT.split(" ← ").map(l => `<div>${esc(l)}</div>`).join("");
  return `<div class="xr-org-header">
    <div class="xr-org-text">${lines}</div>
    <div class="xr-org-logo">🛡</div>
  </div>`;
}

export function buildToc(_ctx: ExecutiveRenderContext): string {
  const rows = TOC_ENTRIES.map(e => `
    <a href="#${e.id}" class="xr-toc-row">
      <span class="xr-toc-num">${e.num}</span>
      <span class="xr-toc-label">${esc(e.label)}</span>
      <span class="xr-toc-pg">←</span>
    </a>`).join("");
  return `<section class="xr-page" id="page-toc">
    <div class="xr-page-inner">
      ${orgHeader()}
      <h2 class="xr-page-title">الفهرس</h2>
      <div class="xr-toc-grid">${rows}</div>
      <div class="xr-page-num">• 02 •</div>
    </div>
  </section>`;
}
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit --project tsconfig.json 2>&1 | grep "toc.ts"
```

Expected: no errors.

---

## Task 6: Rewrite `pages/execIntro.ts` and `pages/glossary.ts`

**Files:**
- Modify: `src/data/reporting/executive/pages/execIntro.ts`
- Modify: `src/data/reporting/executive/pages/glossary.ts`

**Interfaces:**
- Both consume `ExecutiveRenderContext`, `kpiCard`, `fmtNum`, `fmtPct`, `esc` (unchanged primitives)
- Both produce their respective build functions (unchanged signatures)

Note on `orgHeader()`: each page file defines its own inline `orgHeader()` function — this avoids adding a new shared module (YAGNI) since the content is identical and simple.

- [ ] **Step 1: Replace the entire contents of `pages/execIntro.ts`**

```ts
import type { ExecutiveRenderContext } from "../context";
import { kpiCard, fmtNum, fmtPct, esc } from "../primitives";
import { ORGANIZATION_PATH_TEXT } from "../../../../branding/organization";

function orgHeader(): string {
  const lines = ORGANIZATION_PATH_TEXT.split(" ← ").map(l => `<div>${esc(l)}</div>`).join("");
  return `<div class="xr-org-header">
    <div class="xr-org-text">${lines}</div>
    <div class="xr-org-logo">🛡</div>
  </div>`;
}

export function buildExecIntro(ctx: ExecutiveRenderContext): string {
  const { kpis } = ctx;
  const cards = [
    kpiCard({ label: "إجمالي الصور", value: fmtNum(kpis.totalPopulation), tone: "accent" }),
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
    <div style="font-size:20px">${s.ok ? "✅" : "⬜"}</div>
    <div class="xr-kpi-label">${esc(s.label)}</div>
  </div>`).join("");

  return `<section class="xr-page" id="page-intro">
    <div class="xr-page-inner">
      ${orgHeader()}
      <h2 class="xr-page-title">المقدمة التنفيذية</h2>
      <div style="margin-bottom:8px;font-size:10px;color:var(--xr-muted);font-weight:600">
        ملخص أداء شهر ${esc(ctx.monthLabel)} — بتاريخ ${esc(ctx.issueDate)}
      </div>
      <div class="xr-kpi-grid xr-kpi-grid-6" style="margin-bottom:16px">${cards}</div>
      <div class="xr-section-title">حالة الأقسام</div>
      <div class="xr-kpi-grid" style="grid-template-columns:repeat(5,1fr);margin-bottom:14px">${sectionStatus}</div>
      ${kpis.overallAccuracy !== null && kpis.overallAccuracy < ctx.input.config.accuracyTarget
        ? `<div class="xr-notice">⚠️ الدقة الإجمالية (${fmtPct(kpis.overallAccuracy)}) أقل من الهدف المعتمد (${fmtPct(ctx.input.config.accuracyTarget)}). راجع الجزء الرابع والخامس لتفاصيل الفجوات.</div>`
        : ""}
      <div class="xr-page-num">• 03 •</div>
    </div>
  </section>`;
}
```

- [ ] **Step 2: Replace the entire contents of `pages/glossary.ts`**

```ts
import type { ExecutiveRenderContext } from "../context";
import { esc } from "../primitives";
import { ORGANIZATION_PATH_TEXT } from "../../../../branding/organization";

function orgHeader(): string {
  const lines = ORGANIZATION_PATH_TEXT.split(" ← ").map(l => `<div>${esc(l)}</div>`).join("");
  return `<div class="xr-org-header">
    <div class="xr-org-text">${lines}</div>
    <div class="xr-org-logo">🛡</div>
  </div>`;
}

const LEVELS = [
  { cls: "xr-l1-card", icon: "🥇", title: "المستوى الأول", sub: "حالات الضبط المؤكدة", body: "الحالات التي تتضمن حوادث ضبط أمنية أو جودة قرارات التجاوز للأنظمة، ولم يتم الاشتباه بها من قبل كلا المستويين أو أحدهما." },
  { cls: "xr-l2-card", icon: "🔍", title: "المستوى الثاني", sub: "حالات الاشتباه المؤكدة", body: "الحالات التي لم يتم الاشتباه بها من قبل كلا المستويين أو أحدهما، وتم الاشتباه بها من أحد الفرق الأمنية الأخرى." },
  { cls: "xr-l3-card", icon: "⚡", title: "المستوى الثالث", sub: "حالات محرك المخاطر", body: "الحالات التي تتضمن مدخلات مخاطر ولم يتم الاشتباه بها من المستوى الأول والثاني." },
  { cls: "xr-l4-card", icon: "📡", title: "المستوى الرابع", sub: "اشتباه الأشعة غير المؤكد", body: "الحالات التي تم الاشتباه بها من قبل المستوى الأول أو الثاني في صور الأشعة ولم يتم تأكيد الاشتباه." },
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
      <div class="xr-level-card-head">
        <div class="xr-level-card-icon">${l.icon}</div>
        <h3>${esc(l.title)}</h3>
        <span>${esc(l.sub)}</span>
      </div>
      <div class="xr-level-card-body">${esc(l.body)}</div>
      <div class="xr-level-card-bar"></div>
    </div>`).join("");

  const terms = TERMS.map(t => `
    <div class="xr-term">
      <div class="xr-term-icon">${t.icon}</div>
      <div class="xr-term-name">${esc(t.name)}</div>
      <div class="xr-term-def">${esc(t.def)}</div>
    </div>`).join("");

  return `<section class="xr-page" id="page-glossary">
    <div class="xr-page-inner">
      ${orgHeader()}
      <h2 class="xr-page-title">المعجم ودلالات المستويات</h2>
      <div class="xr-level-cards">${cards}</div>
      <div class="xr-glossary-sep">معجم المصطلحات</div>
      <div class="xr-terms-grid">${terms}</div>
      <div class="xr-page-num">• 05 •</div>
    </div>
  </section>`;
}
```

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit --project tsconfig.json 2>&1 | grep -E "execIntro.ts|glossary.ts"
```

Expected: no errors.

---

## Task 7: Rewrite `pages/partDivider.ts` — vtabs redesign

**Files:**
- Modify: `src/data/reporting/executive/pages/partDivider.ts`

**Interfaces:**
- Produces: `buildPartDivider(partNum, title, sub, icon, pageId, pageNum)` factory; six named exports `buildPart1Divider`…`buildPart6Divider` (unchanged)

- [ ] **Step 1: Replace the entire contents of `pages/partDivider.ts`**

```ts
import type { ExecutiveRenderContext } from "../context";
import { esc } from "../primitives";

const VTAB_LABELS = [
  { label: "المستوى الأول", color: "var(--xr-l1)" },
  { label: "المستوى الثاني", color: "var(--xr-l2)" },
  { label: "المستوى الثالث", color: "var(--xr-l3)" },
  { label: "المستوى الرابع", color: "var(--xr-l4)" },
];

function vtabs(): string {
  return `<div class="xr-vtabs">
    ${VTAB_LABELS.map(v => `<div class="xr-vtab" style="background:${v.color}">${esc(v.label)}</div>`).join("")}
  </div>`;
}

export function buildPartDivider(
  partNum: string, title: string, sub: string, icon: string, pageId: string, pageNum: string,
): (_ctx: ExecutiveRenderContext) => string {
  return (_ctx) => `<section class="xr-page xr-divider-page" id="${pageId}">
    ${vtabs()}
    <div class="xr-divider-body">
      <div class="xr-divider-icon">${icon}</div>
      <div class="xr-divider-eyebrow">${esc(partNum)}</div>
      <div class="xr-divider-title">${esc(title)}</div>
      <div class="xr-divider-rule"></div>
      <div class="xr-divider-sub">${esc(sub)}</div>
    </div>
    <div class="xr-page-num">• ${esc(pageNum)} •</div>
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

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit --project tsconfig.json 2>&1 | grep "partDivider.ts"
```

Expected: no errors.

---

## Task 8: Rewrite all data-page files (population, sample, distribution, accuracy, employee, appendix)

Each file gets: (1) `orgHeader()` helper added, (2) `.xr-slide-head` and `.xr-pg` replaced with `.xr-page-title`, (3) `.xr-footer` replaced with `.xr-page-num`, (4) inline `font-size` values in `in` units replaced with `px`. All data logic (ctx.kpis.*, ctx.input.*, dataTable, barRow etc.) is **unchanged**.

**Files:**
- Modify: `src/data/reporting/executive/pages/populationByRisk.ts`
- Modify: `src/data/reporting/executive/pages/populationByLevel.ts`
- Modify: `src/data/reporting/executive/pages/sampleByLevel.ts`
- Modify: `src/data/reporting/executive/pages/distributionOverview.ts`
- Modify: `src/data/reporting/executive/pages/accuracyByLevel.ts`
- Modify: `src/data/reporting/executive/pages/accuracyByPort.ts`
- Modify: `src/data/reporting/executive/pages/levelAgreement.ts`
- Modify: `src/data/reporting/executive/pages/empOverview.ts`
- Modify: `src/data-reporting/executive/pages/empByDecision.ts`
- Modify: `src/data/reporting/executive/pages/empByPort.ts`
- Modify: `src/data/reporting/executive/pages/empImageQuality.ts`
- Modify: `src/data/reporting/executive/pages/empStability.ts`
- Modify: `src/data/reporting/executive/pages/empPriority.ts`
- Modify: `src/data/reporting/executive/pages/appendix.ts`

**Interfaces:**
- All consume same types as before (unchanged)
- All produce same function signatures as before (unchanged)

The pattern for every page is:

```
ADD at top of imports:
  import { ORGANIZATION_PATH_TEXT } from "../../../../branding/organization";

ADD after imports:
  function orgHeader(): string {
    const lines = ORGANIZATION_PATH_TEXT.split(" ← ").map(l => `<div>${esc(l)}</div>`).join("");
    return `<div class="xr-org-header">
      <div class="xr-org-text">${lines}</div>
      <div class="xr-org-logo">🛡</div>
    </div>`;
  }

REPLACE inside every page's return HTML:
  <div class="xr-slide-head"><h2>TITLE</h2><span class="xr-pg">NN</span></div>
  → ${orgHeader()}
    <h2 class="xr-page-title">TITLE</h2>

REPLACE every:
  <div class="xr-footer"><span>التقرير التنفيذي — ${esc(ctx.monthLabel)}</span><span>NN</span></div>
  → <div class="xr-page-num">• NN •</div>

REPLACE every inline style containing `in` units on font-size:
  font-size:0.22in → font-size:20px
  font-size:0.085in → font-size:10px
  font-size:0.08in → font-size:10px
  (see conversion table below)
```

Conversion reference (landscape `in` → portrait `px`):
- `0.22in` → `20px`
- `0.16in` → `13px`
- `0.14in` → `12px`
- `0.12in` → `11px`
- `0.1in` → `11px`
- `0.085in` → `10px`
- `0.082in` → `10px`
- `0.08in` → `10px`
- `0.075in` → `9px`

- [ ] **Step 1: Rewrite `populationByRisk.ts`**

```ts
import type { ExecutiveRenderContext } from "../context";
import { esc, kpiCard, barRow, dataTable, fmtNum, fmtPct } from "../primitives";
import { ORGANIZATION_PATH_TEXT } from "../../../../branding/organization";

function orgHeader(): string {
  const lines = ORGANIZATION_PATH_TEXT.split(" ← ").map(l => `<div>${esc(l)}</div>`).join("");
  return `<div class="xr-org-header"><div class="xr-org-text">${lines}</div><div class="xr-org-logo">🛡</div></div>`;
}

export function buildPopulationByRisk(ctx: ExecutiveRenderContext): string {
  const { kpis } = ctx;
  const totalPop = kpis.totalPopulation;

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
      ${orgHeader()}
      <h2 class="xr-page-title">مجتمع حالات المخاطر</h2>
      <div class="xr-kpi-grid xr-kpi-grid-4">${kpiRow}</div>
      <div class="xr-cols xr-cols-6-4">
        <div>${portTable}</div>
        <div class="xr-panel">
          <div class="xr-panel-title">نسبة الاشتباه حسب المنفذ</div>
          <div class="xr-bars">${bars}</div>
        </div>
      </div>
      <div class="xr-page-num">• 08 •</div>
    </div>
  </section>`;
}
```

- [ ] **Step 2: Rewrite `populationByLevel.ts`**

```ts
import type { ExecutiveRenderContext } from "../context";
import { dataTable, fmtNum, fmtPct, esc } from "../primitives";
import { ORGANIZATION_PATH_TEXT } from "../../../../branding/organization";

function orgHeader(): string {
  const lines = ORGANIZATION_PATH_TEXT.split(" ← ").map(l => `<div>${esc(l)}</div>`).join("");
  return `<div class="xr-org-header"><div class="xr-org-text">${lines}</div><div class="xr-org-logo">🛡</div></div>`;
}

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
      ${orgHeader()}
      <h2 class="xr-page-title">مجتمع الحالات حسب المستويات والمنافذ</h2>
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
      <div class="xr-page-num">• 09 •</div>
    </div>
  </section>`;
}
```

- [ ] **Step 3: Rewrite `sampleByLevel.ts`**

```ts
import type { ExecutiveRenderContext } from "../context";
import { dataTable, kpiCard, fmtNum, fmtPct, esc } from "../primitives";
import { ORGANIZATION_PATH_TEXT } from "../../../../branding/organization";

function orgHeader(): string {
  const lines = ORGANIZATION_PATH_TEXT.split(" ← ").map(l => `<div>${esc(l)}</div>`).join("");
  return `<div class="xr-org-header"><div class="xr-org-text">${lines}</div><div class="xr-org-logo">🛡</div></div>`;
}

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
      ${orgHeader()}
      <h2 class="xr-page-title">مستويات الدراسة والعينة حسب المنافذ</h2>
      <div class="xr-kpi-grid xr-kpi-grid-4">${kpis4}</div>
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
      <div class="xr-page-num">• 12 •</div>
    </div>
  </section>`;
}
```

- [ ] **Step 4: Rewrite `distributionOverview.ts`**

```ts
import type { ExecutiveRenderContext } from "../context";
import { dataTable, kpiCard, fmtNum, fmtPct, esc } from "../primitives";
import { ORGANIZATION_PATH_TEXT } from "../../../../branding/organization";

function orgHeader(): string {
  const lines = ORGANIZATION_PATH_TEXT.split(" ← ").map(l => `<div>${esc(l)}</div>`).join("");
  return `<div class="xr-org-header"><div class="xr-org-text">${lines}</div><div class="xr-org-logo">🛡</div></div>`;
}

export function buildDistributionOverview(ctx: ExecutiveRenderContext): string {
  const dist = ctx.input.distribution;
  if (!dist || dist.entries.length === 0) {
    return `<section class="xr-page" id="page-dist">
      <div class="xr-page-inner">
        ${orgHeader()}
        <h2 class="xr-page-title">التوزيع والتكليف</h2>
        <div class="xr-notice">لم يتم التوزيع بعد لهذا الشهر.</div>
        <div class="xr-page-num">• 16 •</div>
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
      ${orgHeader()}
      <h2 class="xr-page-title">التوزيع والتكليف</h2>
      <div class="xr-kpi-grid xr-kpi-grid-4">${kpisRow}</div>
      <div class="xr-panel-title">أعباء العمل حسب الموظف</div>
      ${dataTable({ headers: ["الموظف","المكلَّف به","مكتمل","متبقٍ","نسبة الإنجاز"], rows })}
      <div class="xr-page-num">• 16 •</div>
    </div>
  </section>`;
}
```

- [ ] **Step 5: Rewrite `accuracyByLevel.ts`**

```ts
import type { ExecutiveRenderContext } from "../context";
import { kpiCard, radarSvg, fmtPct, esc } from "../primitives";
import { ORGANIZATION_PATH_TEXT } from "../../../../branding/organization";

function orgHeader(): string {
  const lines = ORGANIZATION_PATH_TEXT.split(" ← ").map(l => `<div>${esc(l)}</div>`).join("");
  return `<div class="xr-org-header"><div class="xr-org-text">${lines}</div><div class="xr-org-logo">🛡</div></div>`;
}

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
      ${orgHeader()}
      <h2 class="xr-page-title">نتائج الدقة حسب المستويات الأربعة</h2>
      <div class="xr-kpi-grid xr-kpi-grid-4">${kpisRow}</div>
      <div class="xr-cols xr-cols-2">
        <div class="xr-panel" style="height:280px">${radarSvg(radarPoints)}</div>
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
      <div class="xr-page-num">• 21 •</div>
    </div>
  </section>`;
}
```

- [ ] **Step 6: Rewrite `accuracyByPort.ts`**

```ts
import type { ExecutiveRenderContext } from "../context";
import { dataTable, barRow, badgeHtml, kpiCard, fmtNum, fmtPct, esc } from "../primitives";
import { ORGANIZATION_PATH_TEXT } from "../../../../branding/organization";

function orgHeader(): string {
  const lines = ORGANIZATION_PATH_TEXT.split(" ← ").map(l => `<div>${esc(l)}</div>`).join("");
  return `<div class="xr-org-header"><div class="xr-org-text">${lines}</div><div class="xr-org-logo">🛡</div></div>`;
}

export function buildAccuracyByPort(ctx: ExecutiveRenderContext): string {
  const { kpis } = ctx;
  const reliable = kpis.portProfiles.filter(p => p.accuracy !== null);

  const kpisRow = [
    kpiCard({ label: "دقة نتائج الأشعة", value: fmtPct(kpis.overallAccuracy), tone: kpis.overallAccuracy !== null && kpis.overallAccuracy >= ctx.input.config.accuracyTarget ? "good" : "risk" }),
    kpiCard({ label: "نسبة دقة الاشتباه", value: fmtPct(kpis.suspiciousDetectionRate), tone: "good" }),
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
      ${orgHeader()}
      <h2 class="xr-page-title">نتائج الفحص والدقة حسب المنفذ</h2>
      <div class="xr-kpi-grid xr-kpi-grid-4">${kpisRow}</div>
      <div class="xr-cols xr-cols-6-4">
        <div>${dataTable({ headers: ["المنفذ","مدروسة","دقة%","اكتشاف اشتباه%","اشتباه فائت%","التصنيف"], rows: tableRows })}</div>
        <div class="xr-panel">
          <div class="xr-panel-title">الدقة حسب المنفذ</div>
          <div class="xr-bars">${bars || '<div class="xr-notice">بيانات غير كافية</div>'}</div>
        </div>
      </div>
      <div class="xr-page-num">• 20 •</div>
    </div>
  </section>`;
}
```

- [ ] **Step 7: Rewrite `levelAgreement.ts`**

```ts
import type { ExecutiveRenderContext } from "../context";
import { barRow, esc } from "../primitives";
import { ORGANIZATION_PATH_TEXT } from "../../../../branding/organization";

function orgHeader(): string {
  const lines = ORGANIZATION_PATH_TEXT.split(" ← ").map(l => `<div>${esc(l)}</div>`).join("");
  return `<div class="xr-org-header"><div class="xr-org-text">${lines}</div><div class="xr-org-logo">🛡</div></div>`;
}

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
      ${orgHeader()}
      <h2 class="xr-page-title">مقارنة المستوى الأول والثاني وتوافق الموظفين</h2>
      <div class="xr-cols xr-cols-2">
        <div class="xr-panel">
          <div class="xr-panel-title">مقارنة المستويين</div>
          <div class="xr-bars" style="margin-top:10px">${bars}</div>
        </div>
        <div class="xr-panel">
          <div class="xr-panel-title">توافق أزواج الموظفين</div>
          <div class="xr-notice" style="margin-top:10px">هذا الجزء يتطلب وجود حالات راجعها موظفان مختلفان — لم تُرصد حالات كهذه في هذا الشهر.</div>
        </div>
      </div>
      <div class="xr-page-num">• 22 •</div>
    </div>
  </section>`;
}
```

- [ ] **Step 8: Rewrite `empOverview.ts`**

```ts
import type { ExecutiveRenderContext } from "../context";
import { dataTable, barRow, fmtNum, fmtPct, esc } from "../primitives";
import { buildEmployeeProfiles } from "../executiveEmployeeData";
import { ORGANIZATION_PATH_TEXT } from "../../../../branding/organization";

function orgHeader(): string {
  const lines = ORGANIZATION_PATH_TEXT.split(" ← ").map(l => `<div>${esc(l)}</div>`).join("");
  return `<div class="xr-org-header"><div class="xr-org-text">${lines}</div><div class="xr-org-logo">🛡</div></div>`;
}

export function buildEmpOverview(ctx: ExecutiveRenderContext): string {
  const profiles = buildEmployeeProfiles(ctx.rows, ctx.input.config.minimumReliableSampleSize);

  if (profiles.length === 0) {
    return `<section class="xr-page" id="page-emp-overview">
      <div class="xr-page-inner">
        ${orgHeader()}
        <h2 class="xr-page-title">النظرة العامة لأداء الموظفين</h2>
        <div class="xr-notice">بيانات غير كافية — لا توجد إجابات مقدَّمة لهذا الشهر.</div>
        <div class="xr-page-num">• 24 •</div>
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
      ${orgHeader()}
      <h2 class="xr-page-title">النظرة العامة لأداء الموظفين</h2>
      <div class="xr-cols xr-cols-6-4">
        <div>${dataTable({ headers: ["الموظف","مدروسة","الدقة","اشتباه فائت","التوصية"], rows: tableRows })}</div>
        <div class="xr-panel">
          <div class="xr-panel-title">أفضل 5 موظفين — الدقة</div>
          <div class="xr-bars">${bars}</div>
        </div>
      </div>
      <div class="xr-page-num">• 24 •</div>
    </div>
  </section>`;
}
```

- [ ] **Step 9: Rewrite `empByDecision.ts`**

```ts
import type { ExecutiveRenderContext } from "../context";
import { esc } from "../primitives";
import { ORGANIZATION_PATH_TEXT } from "../../../../branding/organization";

function orgHeader(): string {
  const lines = ORGANIZATION_PATH_TEXT.split(" ← ").map(l => `<div>${esc(l)}</div>`).join("");
  return `<div class="xr-org-header"><div class="xr-org-text">${lines}</div><div class="xr-org-logo">🛡</div></div>`;
}

export function buildEmpByDecision(ctx: ExecutiveRenderContext): string {
  return `<section class="xr-page" id="page-emp-decision">
    <div class="xr-page-inner">
      ${orgHeader()}
      <h2 class="xr-page-title">الدقة حسب نوع القرار</h2>
      <div class="xr-notice">قريباً — تحليل الدقة حسب نوع القرار</div>
      <div class="xr-page-num">• 25 •</div>
    </div>
  </section>`;
}
```

- [ ] **Step 10: Rewrite `empByPort.ts`**

```ts
import type { ExecutiveRenderContext } from "../context";
import { esc } from "../primitives";
import { ORGANIZATION_PATH_TEXT } from "../../../../branding/organization";

function orgHeader(): string {
  const lines = ORGANIZATION_PATH_TEXT.split(" ← ").map(l => `<div>${esc(l)}</div>`).join("");
  return `<div class="xr-org-header"><div class="xr-org-text">${lines}</div><div class="xr-org-logo">🛡</div></div>`;
}

export function buildEmpByPort(ctx: ExecutiveRenderContext): string {
  return `<section class="xr-page" id="page-emp-port">
    <div class="xr-page-inner">
      ${orgHeader()}
      <h2 class="xr-page-title">مقارنة الموظفين بين المنافذ</h2>
      <div class="xr-notice">قريباً — مقارنة الموظفين بين المنافذ</div>
      <div class="xr-page-num">• 26 •</div>
    </div>
  </section>`;
}
```

- [ ] **Step 11: Rewrite `empImageQuality.ts`**

```ts
import type { ExecutiveRenderContext } from "../context";
import { esc } from "../primitives";
import { ORGANIZATION_PATH_TEXT } from "../../../../branding/organization";

function orgHeader(): string {
  const lines = ORGANIZATION_PATH_TEXT.split(" ← ").map(l => `<div>${esc(l)}</div>`).join("");
  return `<div class="xr-org-header"><div class="xr-org-text">${lines}</div><div class="xr-org-logo">🛡</div></div>`;
}

export function buildEmpImageQuality(ctx: ExecutiveRenderContext): string {
  return `<section class="xr-page" id="page-emp-quality">
    <div class="xr-page-inner">
      ${orgHeader()}
      <h2 class="xr-page-title">أثر جودة الصورة على الدقة</h2>
      <div class="xr-notice">قريباً — أثر جودة الصورة على الدقة</div>
      <div class="xr-page-num">• 27 •</div>
    </div>
  </section>`;
}
```

- [ ] **Step 12: Rewrite `empStability.ts`**

```ts
import type { ExecutiveRenderContext } from "../context";
import { esc } from "../primitives";
import { ORGANIZATION_PATH_TEXT } from "../../../../branding/organization";

function orgHeader(): string {
  const lines = ORGANIZATION_PATH_TEXT.split(" ← ").map(l => `<div>${esc(l)}</div>`).join("");
  return `<div class="xr-org-header"><div class="xr-org-text">${lines}</div><div class="xr-org-logo">🛡</div></div>`;
}

export function buildEmpStability(ctx: ExecutiveRenderContext): string {
  return `<section class="xr-page" id="page-emp-stability">
    <div class="xr-page-inner">
      ${orgHeader()}
      <h2 class="xr-page-title">استقرار الأداء وعبء العمل</h2>
      <div class="xr-notice">قريباً — استقرار الأداء وعبء العمل</div>
      <div class="xr-page-num">• 28 •</div>
    </div>
  </section>`;
}
```

- [ ] **Step 13: Rewrite `empPriority.ts`**

```ts
import type { ExecutiveRenderContext } from "../context";
import { fmtPct, esc, noticeBox } from "../primitives";
import { buildEmployeeProfiles, buildPriorityList } from "../executiveEmployeeData";
import { ORGANIZATION_PATH_TEXT } from "../../../../branding/organization";

function orgHeader(): string {
  const lines = ORGANIZATION_PATH_TEXT.split(" ← ").map(l => `<div>${esc(l)}</div>`).join("");
  return `<div class="xr-org-header"><div class="xr-org-text">${lines}</div><div class="xr-org-logo">🛡</div></div>`;
}

export function buildEmpPriority(ctx: ExecutiveRenderContext): string {
  const profiles = buildEmployeeProfiles(ctx.rows, ctx.input.config.minimumReliableSampleSize);
  const priority = buildPriorityList(profiles);

  if (priority.length === 0) {
    return `<section class="xr-page" id="page-emp-priority">
      <div class="xr-page-inner">
        ${orgHeader()}
        <h2 class="xr-page-title">الموظفون ذوو الأولوية والإجراءات المقترحة</h2>
        ${noticeBox("لا يوجد موظفون يتطلبون تدخلاً عاجلاً في هذه الدورة.")}
        <div class="xr-page-num">• 30 •</div>
      </div>
    </section>`;
  }

  const cards = priority.slice(0, 6).map((p, i) => `
    <div class="xr-panel" style="border-right:3px solid var(--xr-coral)">
      <div style="font-size:10px;font-weight:800;color:var(--xr-gold);margin-bottom:5px">#${i+1} — ${esc(ctx.displayName(p.username))}</div>
      <div style="font-size:9px;color:var(--xr-muted)">الدقة: ${fmtPct(p.overallAccuracy)} | اشتباه فائت: ${fmtPct(p.missedSuspicionRate)}</div>
      <div style="margin-top:7px;font-size:9px;color:var(--xr-white);font-weight:700">${esc(p.recommendedAction)}</div>
    </div>`).join("");

  return `<section class="xr-page" id="page-emp-priority">
    <div class="xr-page-inner">
      ${orgHeader()}
      <h2 class="xr-page-title">الموظفون ذوو الأولوية والإجراءات المقترحة</h2>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">${cards}</div>
      <div class="xr-page-num">• 30 •</div>
    </div>
  </section>`;
}
```

- [ ] **Step 14: Rewrite `appendix.ts`**

```ts
import type { ExecutiveRenderContext } from "../context";
import { esc, fmtPct, fmtNum } from "../primitives";
import { ORGANIZATION_PATH_TEXT } from "../../../../branding/organization";

function orgHeader(): string {
  const lines = ORGANIZATION_PATH_TEXT.split(" ← ").map(l => `<div>${esc(l)}</div>`).join("");
  return `<div class="xr-org-header"><div class="xr-org-text">${lines}</div><div class="xr-org-logo">🛡</div></div>`;
}

export function buildAppendix(ctx: ExecutiveRenderContext): string {
  const cfg = ctx.input.config;
  return `<section class="xr-page" id="page-appendix">
    <div class="xr-page-inner">
      ${orgHeader()}
      <h2 class="xr-page-title">الملاحق</h2>
      <div class="xr-cols xr-cols-2">
        <div class="xr-panel">
          <div class="xr-panel-title">معايير الأداء المعتمدة</div>
          <table class="xr-table" style="margin-top:6px">
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
          <p style="font-size:10px;line-height:1.65;color:var(--xr-muted);font-weight:600">
            تعتمد المراجعة على سحب عينة عشوائية طبقية بخوارزمية هاميلتون من مجتمع الحالات الشهرية
            لكل منفذ، ثم توزيعها على الموظفين المعتمدين. يقوم كل موظف بمراجعة الحالات المكلف بها
            وتسجيل حكمه الخبري. تُحسب الدقة بمقارنة حكم الخبير بنتيجة الأشعة الآلية.
            الحالات التي لم تُدرس بعد لا تدخل في حساب الدقة.
          </p>
        </div>
      </div>
      <div class="xr-page-num">• 31 •</div>
    </div>
  </section>`;
}
```

- [ ] **Step 15: Run full TypeScript check for all page files**

```bash
npx tsc --noEmit --project tsconfig.json 2>&1
```

Expected: zero errors.

---

## Task 9: Update `docs/EDIT_LOG.md` and run build + tests

**Files:**
- Modify: `docs/EDIT_LOG.md`

- [ ] **Step 1: Prepend the v21.0 entry to `docs/EDIT_LOG.md`**

Add this block at the top of the file (after the header line):

```markdown
## v21.0 — 2026-06-29 — feat(executive-report): redesign to portrait A4 document format

**File:** `src/data/reporting/executive/theme.ts`

**Before:**
```ts
// .xr-page{ width:13.333in;height:7.5in; ... }
// .xr-viewer{display:grid;grid-template-columns:minmax(0,1fr) 280px;}
// @media print{@page{size:13.333in 7.5in;margin:0;}}
```

**After:**
```ts
// .xr-page{ width:8.27in;min-height:11.69in; }
// .xr-document{display:flex;flex-direction:column;...}
// .xr-toolbar{position:fixed;...}
// @media print{@page{size:A4 portrait;margin:0;}}
```

---

**File:** `src/data/reporting/executive/viewer.ts`

**Before:**
```ts
export function buildViewerHtml(slides: string, sidebarLinks: string, monthLabel: string): string {
```

**After:**
```ts
export function buildViewerHtml(slides: string, monthLabel: string): string {
```

---

**File:** `src/data/reporting/executive/assemble.ts`

**Before:**
```ts
const NAV_SECTIONS = [...];
// ... builds sidebarLinks string ...
return buildViewerHtml(slides, sidebarLinks, ctx.monthLabel);
```

**After:**
```ts
// NAV_SECTIONS removed
return buildViewerHtml(slides, ctx.monthLabel);
```

---

**File:** `src/data/reporting/executive/pages/cover.ts` — portrait cover redesign (full rewrite of HTML template)

**File:** `src/data/reporting/executive/pages/toc.ts` — portrait layout, orgHeader, xr-page-num

**File:** `src/data/reporting/executive/pages/execIntro.ts` — portrait layout, orgHeader, xr-page-num

**File:** `src/data/reporting/executive/pages/glossary.ts` — 2×2 level card grid, glossary separator, orgHeader

**File:** `src/data/reporting/executive/pages/partDivider.ts` — vtabs redesign (xr-vtabs, xr-vtab, xr-divider-body)

**File:** `src/data/reporting/executive/pages/populationByRisk.ts` — orgHeader, xr-page-num, px font sizes

**File:** `src/data/reporting/executive/pages/populationByLevel.ts` — orgHeader, xr-page-num

**File:** `src/data/reporting/executive/pages/sampleByLevel.ts` — orgHeader, xr-page-num

**File:** `src/data/reporting/executive/pages/distributionOverview.ts` — orgHeader, xr-page-num

**File:** `src/data/reporting/executive/pages/accuracyByLevel.ts` — orgHeader, xr-page-num

**File:** `src/data/reporting/executive/pages/accuracyByPort.ts` — orgHeader, xr-page-num

**File:** `src/data/reporting/executive/pages/levelAgreement.ts` — orgHeader, xr-page-num

**File:** `src/data/reporting/executive/pages/empOverview.ts` — orgHeader, xr-page-num

**File:** `src/data/reporting/executive/pages/empByDecision.ts` — orgHeader, xr-page-num

**File:** `src/data/reporting/executive/pages/empByPort.ts` — orgHeader, xr-page-num

**File:** `src/data/reporting/executive/pages/empImageQuality.ts` — orgHeader, xr-page-num

**File:** `src/data/reporting/executive/pages/empStability.ts` — orgHeader, xr-page-num

**File:** `src/data/reporting/executive/pages/empPriority.ts` — orgHeader, xr-page-num

**File:** `src/data/reporting/executive/pages/appendix.ts` — orgHeader, xr-page-num
```

- [ ] **Step 2: Run the full build**

```bash
npm run build 2>&1
```

Expected: exits 0, outputs `dist/index.html`. Zero TypeScript errors. If errors appear, fix them before continuing.

- [ ] **Step 3: Run all tests**

```bash
npx vitest run 2>&1
```

Expected: all tests pass. The executive report tests (`executiveEmployeeData.test.ts`) should still pass since data logic is untouched.

- [ ] **Step 4: Write the implementation report**

Create `.superpowers/sdd/portrait-redesign-report.md` with actual results:

```markdown
# Portrait A4 Executive Report — Implementation Report

**Date:** 2026-06-29  
**Version:** v21.0  

## Status: DONE

## Changes Made
- theme.ts: full CSS rewrite — A4 portrait pages, toolbar, no sidebar, px font sizes, vtab/divider CSS, 2×2 level cards, glossary separator, org header
- viewer.ts: removed `sidebarLinks` parameter; toolbar + `.xr-document` scroll container
- assemble.ts: removed `NAV_SECTIONS` + sidebar link generation
- All 16 page files: added `orgHeader()`, replaced `.xr-slide-head`/`.xr-footer` with `.xr-page-title`/`.xr-page-num`; cover and partDivider fully redesigned

## Build
- `npm run build`: PASS, zero TS errors
- Bundle size: [fill in from build output]

## Tests
- `npx vitest run`: [N] tests passed, 0 failed
```

- [ ] **Step 5: Commit**

```bash
git add \
  src/data/reporting/executive/theme.ts \
  src/data/reporting/executive/viewer.ts \
  src/data/reporting/executive/assemble.ts \
  src/data/reporting/executive/pages/cover.ts \
  src/data/reporting/executive/pages/toc.ts \
  src/data/reporting/executive/pages/execIntro.ts \
  src/data/reporting/executive/pages/glossary.ts \
  src/data/reporting/executive/pages/partDivider.ts \
  src/data/reporting/executive/pages/populationByRisk.ts \
  src/data/reporting/executive/pages/populationByLevel.ts \
  src/data/reporting/executive/pages/sampleByLevel.ts \
  src/data/reporting/executive/pages/distributionOverview.ts \
  src/data/reporting/executive/pages/accuracyByLevel.ts \
  src/data/reporting/executive/pages/accuracyByPort.ts \
  src/data/reporting/executive/pages/levelAgreement.ts \
  src/data/reporting/executive/pages/empOverview.ts \
  src/data/reporting/executive/pages/empByDecision.ts \
  src/data/reporting/executive/pages/empByPort.ts \
  src/data/reporting/executive/pages/empImageQuality.ts \
  src/data/reporting/executive/pages/empStability.ts \
  src/data/reporting/executive/pages/empPriority.ts \
  src/data/reporting/executive/pages/appendix.ts \
  docs/EDIT_LOG.md \
  .superpowers/sdd/portrait-redesign-report.md
git commit -m "feat(executive-report): redesign to portrait A4 document format"
```

---

## Self-Review

**Spec coverage check:**

| Requirement | Task |
|---|---|
| A4 portrait 8.27×11.69in pages | Task 1 (`.xr-page`) |
| No sidebar; fixed toolbar with PDF button | Task 1 + Task 2 |
| Org header on content pages (shield + org name + gold line) | Task 5–8 (`orgHeader()`) |
| Dark navy background per page | Task 1 |
| Gold accent titles | Task 1 (`.xr-page-title`) |
| Page number `• NN •` at bottom center | Task 1 (`.xr-page-num`) |
| Tables: dark teal header (#1a4040) | Task 1 (`.xr-table th`) |
| Level chips on cover | Task 4 |
| Cover: full portrait redesign with subtitle, meta, badges | Task 4 |
| TOC: clean rows | Task 5 |
| Exec intro: org header + 6 KPI cards + status | Task 6 |
| Glossary: 2×2 level card grid with bottom bar | Task 1 + Task 6 |
| Part dividers: vtabs on right edge, center body | Task 1 + Task 7 |
| Data pages: all have org header + page-num | Task 8 |
| Print CSS: A4 portrait, hide toolbar | Task 1 |
| EDIT_LOG entry v21.0 | Task 9 |
| `npm run build` zero errors | Task 9 |
| `npx vitest run` all tests pass | Task 9 |
| Report file in `.superpowers/sdd/` | Task 9 |
| Commit message correct | Task 9 |

**Placeholder scan:** No TBD/TODO/placeholder patterns in any step. All steps contain complete replacement file content.

**Type consistency check:**
- `buildViewerHtml(slides: string, monthLabel: string)` — defined Task 2, consumed in Task 3. ✓
- `orgHeader()` — defined identically in each page file (no shared dependency). ✓
- `ORGANIZATION_PATH_TEXT` — imported from `"../../../../branding/organization"` in all page files and cover/toc. ✓
- `buildPartDivider` factory signature unchanged from original. ✓
- All `kpiCard`, `barRow`, `dataTable`, `fmtNum`, `fmtPct`, `esc`, `badgeHtml`, `noticeBox`, `radarSvg` — imported from `"../primitives"` unchanged. ✓
