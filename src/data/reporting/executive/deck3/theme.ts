// Handoff design tokens (design_handoff_xray_qa_deck, 2026-08-25) — see
// docs/superpowers/specs/2026-08-25-executive-report-design-toggle-design.md
// for the full token table this file encodes verbatim. Light theme, distinct
// from deck2's dark navy/gold system — deck3 does not share deck2's CSS.
import { SOMAR_SANS_WOFF } from "../../../../branding/somarFonts";

export const DECK_V3_FONT_FACE_CSS = `
@font-face{font-family:"Somar";src:url(${SOMAR_SANS_WOFF.light}) format("woff");font-weight:300;font-style:normal;font-display:block;}
@font-face{font-family:"Somar";src:url(${SOMAR_SANS_WOFF.regular}) format("woff");font-weight:400;font-style:normal;font-display:block;}
@font-face{font-family:"Somar";src:url(${SOMAR_SANS_WOFF.medium}) format("woff");font-weight:500;font-style:normal;font-display:block;}
@font-face{font-family:"Somar";src:url(${SOMAR_SANS_WOFF.bold}) format("woff");font-weight:700;font-style:normal;font-display:block;}
`;

export const DECK_V3_CSS = `
${DECK_V3_FONT_FACE_CSS}
:root{
  --v3-bg:#f9f8f5; --v3-panel:#f2f0ea; --v3-land:#f4efe4; --v3-sea:#eaeff5;
  --v3-callout:#eef1f5; --v3-pos-tint:#eef3ee; --v3-neg-tint:#f7eeeb;
  --v3-navy:#10304f; --v3-cover-navy:#0f2b46; --v3-text:#22303e; --v3-muted:#5d6b7a; --v3-hair:#e3e0d8;
  --v3-gold:#b48a3c; --v3-gold-dark:#8a6526; --v3-gold-light:#c9a45e; --v3-gold-lighter:#d9b877;
  --v3-blue:#3f6fa8; --v3-blue-dark:#2c5580;
  --v3-green:#2e7d4f; --v3-red:#b8543f; --v3-neutral-bar:#d9d5ca;
}
.deck-viewer-v3{ display:block; min-height:100vh; padding:28px 16px 56px; background:var(--v3-bg); }
.slide.v3{
  width:1920px; height:1080px; margin:0 auto 26px;
  transform-origin:top center;
  position:relative; overflow:hidden; box-sizing:border-box;
  background:var(--v3-bg); color:var(--v3-text);
  font-family:"Somar","IBM Plex Sans Arabic","Tahoma","Arial",sans-serif;
  display:flex; flex-direction:column;
}
.slide.v3.v3-cover, .slide.v3.v3-closing{ background:var(--v3-cover-navy); color:#fff; }
.slide.v3 .slide-inner{
  flex:1 1 auto; min-height:0; display:flex; flex-direction:column; box-sizing:border-box;
  padding:84px 100px 56px;
}
.slide.v3.v3-cover .slide-inner, .slide.v3.v3-closing .slide-inner{ padding:96px 120px 84px; }
.v3-page-foot{
  display:flex; align-items:center; justify-content:space-between;
  font-size:24px; font-weight:500; color:var(--v3-muted); font-variant-numeric:tabular-nums;
  padding-top:16px; margin-top:auto; border-top:1px solid var(--v3-hair);
}
.slide.v3.v3-cover .v3-page-foot, .slide.v3.v3-closing .v3-page-foot{ border-top-color:rgba(255,255,255,.18); color:rgba(255,255,255,.6); }
@media screen and (max-width:1980px){
  .slide.v3{ transform:scale(calc((100vw - 32px) / 1920)); margin-bottom:calc(-1080px * (1 - (100vw - 32px) / 1920) + 26px); }
}
@media print{
  .deck-viewer-v3{ padding:0; background:#fff; }
  .slide.v3{ transform:none!important; margin:0; box-shadow:none; page-break-after:always; }
}
.v3-chart-plot{ position:relative; background:var(--v3-panel); border-bottom:2px solid var(--v3-navy); height:100%; }
.v3-chart-bars{ position:absolute; inset:0; z-index:1; display:flex; align-items:stretch; gap:12px; padding:0 12px; }
.v3-chart-plot-grouped .v3-chart-bars{ gap:26px; }
.v3-chart-group{ flex:1; display:flex; gap:8px; align-items:stretch; }
.v3-chart-cell{ flex:1; display:flex; flex-direction:column; justify-content:flex-end; align-self:stretch; height:100%; }
.v3-chart-bar{ background:var(--v3-gold); position:relative; }
.v3-chart-bar-a{ background:var(--v3-gold); }
.v3-chart-bar-b{ background:var(--v3-blue); }
.v3-chart-value{ display:block; padding-top:10px; text-align:center; color:#fff; font-size:24px; font-weight:700; }
.v3-chart-refline{ position:absolute; right:0; left:0; border-top:3px dashed var(--v3-navy); }
.v3-chart-refline span{ position:absolute; inset-inline-end:0; top:-28px; font-size:24px; color:var(--v3-muted); }
.v3-chart-labels{ display:flex; gap:12px; padding:10px 12px 0; }
.v3-chart-plot-grouped + .v3-chart-labels{ gap:26px; }
.v3-chart-label{ flex:1; text-align:center; font-size:25px; color:var(--v3-text); }

/* ── slideKit.ts template chrome ─────────────────────────────────────────── */
.v3-kicker{ font-size:28px; font-weight:500; letter-spacing:.02em; color:var(--v3-gold-lighter); }
.v3-cover-h1{ margin:24px 0 0; font-size:110px; font-weight:700; line-height:1.08; }
.v3-cover-period{ margin-top:24px; font-size:36px; font-weight:400; color:rgba(255,255,255,.78); }
.v3-cover-meta{ display:flex; gap:48px; margin-top:auto; padding-top:48px; }
.v3-cover-meta-item{ display:flex; flex-direction:column; gap:6px; font-size:24px; }
.v3-cover-meta-label{ color:rgba(255,255,255,.6); }
.v3-cover-meta-item b{ font-size:32px; font-weight:700; }

.v3-closing-h1{ margin:24px 0 0; font-size:82px; font-weight:700; }
.v3-closing-line{ margin-top:24px; font-size:36px; font-weight:400; color:rgba(255,255,255,.78); }

.v3-h2{ margin:0 0 44px; font-size:56px; font-weight:700; color:var(--v3-navy); }

.v3-toc{ display:flex; flex-direction:column; gap:24px; }
.v3-toc-row{ display:flex; align-items:baseline; gap:24px; padding-bottom:24px; border-bottom:1px solid var(--v3-hair); font-size:28px; }
.v3-toc-index{ font-weight:700; color:var(--v3-gold); min-width:48px; }
.v3-toc-title{ font-weight:700; min-width:220px; }
.v3-toc-desc{ flex:1; color:var(--v3-muted); }
.v3-toc-pages{ color:var(--v3-muted); font-size:24px; }

.v3-term-grid{ display:grid; grid-template-columns:repeat(2,1fr); gap:32px 48px; }
.v3-term-card{ border-radius:16px; padding:32px; background:var(--v3-panel); border-inline-start:6px solid var(--v3-gold); }
.v3-term-card b{ display:block; font-size:32px; margin-bottom:12px; }
.v3-term-card p{ margin:0; font-size:24px; line-height:1.6; color:var(--v3-muted); }
.v3-term-card.gold{ border-inline-start-color:var(--v3-gold); }
.v3-term-card.blue{ border-inline-start-color:var(--v3-blue); }
.v3-term-card.green{ border-inline-start-color:var(--v3-green); }
.v3-term-card.coral{ border-inline-start-color:var(--v3-red); }
.v3-term-card.slate{ border-inline-start-color:var(--v3-muted); }
.v3-term-card.purple{ border-inline-start-color:var(--v3-blue-dark); }
.v3-term-card.cyan{ border-inline-start-color:var(--v3-blue); }

.v3-level-grid{ display:grid; grid-template-columns:repeat(4,1fr); gap:24px; }
.v3-level-card{ border-radius:16px; padding:24px; background:var(--v3-panel); border-top:6px solid var(--v3-gold); display:flex; flex-direction:column; gap:12px; }
.v3-level-card.gold{ border-top-color:var(--v3-gold); }
.v3-level-card.blue{ border-top-color:var(--v3-blue); }
.v3-level-card.green{ border-top-color:var(--v3-green); }
.v3-level-card.coral{ border-top-color:var(--v3-red); }
.v3-level-num{ font-size:24px; font-weight:700; color:var(--v3-gold); }
.v3-level-card h4{ margin:0; font-size:28px; }
.v3-level-card p{ margin:0; font-size:24px; line-height:1.55; color:var(--v3-muted); flex:1; }
.v3-level-goal{ display:flex; justify-content:space-between; font-size:24px; padding-top:12px; border-top:1px solid var(--v3-hair); }
.v3-level-highlight{ margin-top:44px; display:flex; align-items:baseline; gap:16px; font-size:28px; }
.v3-level-highlight b{ font-size:44px; color:var(--v3-gold-dark); }

.v3-kpi-grid{ display:grid; grid-template-columns:repeat(3,1fr); grid-template-rows:repeat(2,1fr); gap:32px; flex:1; }
.v3-kpi-cell{ display:flex; flex-direction:column; justify-content:center; gap:12px; border-radius:16px; padding:32px; background:var(--v3-panel); }
.v3-kpi-label{ font-size:24px; color:var(--v3-muted); }
.v3-kpi-value{ font-size:56px; font-weight:700; color:var(--v3-navy); }

.v3-divider-num{ font-size:32px; font-weight:700; color:var(--v3-gold-lighter); }
.v3-divider-h1{ margin:24px 0 0; font-size:82px; font-weight:700; }
.v3-divider-desc{ margin-top:24px; font-size:32px; color:rgba(255,255,255,.78); max-width:60%; }
.v3-divider-pages{ margin-top:auto; font-size:24px; color:rgba(255,255,255,.6); }

.v3-two-panel{ display:grid; grid-template-columns:1fr 1fr; gap:48px; flex:1; min-height:0; }
.v3-panel{ display:flex; flex-direction:column; gap:16px; min-height:0; border-radius:16px; padding:24px; }
.v3-panel-land{ background:var(--v3-land); }
.v3-panel-sea{ background:var(--v3-sea); }
.v3-panel-head{ display:flex; justify-content:space-between; align-items:baseline; font-size:28px; }
.v3-panel-head span{ font-size:24px; color:var(--v3-muted); }
.v3-table{ width:100%; border-collapse:collapse; font-size:24px; }
.v3-table th,.v3-table td{ height:56px; padding:0 12px; text-align:center; border-bottom:1px solid var(--v3-hair); }
.v3-table th:first-child,.v3-table td:first-child{ text-align:start; }
.v3-table thead th{ font-weight:700; color:var(--v3-navy); }
.v3-table tfoot td{ font-weight:700; border-top:2px solid var(--v3-navy); border-bottom:none; }

.v3-matrix{ position:relative; display:grid; grid-template-columns:1fr 1fr; grid-template-rows:1fr 1fr; gap:24px; flex:1; }
.v3-matrix-cell{ display:flex; flex-direction:column; justify-content:center; align-items:center; gap:12px; border-radius:16px; background:var(--v3-panel); }
.v3-matrix-cell b{ font-size:56px; color:var(--v3-navy); }
.v3-matrix-cell span{ font-size:24px; color:var(--v3-muted); }
.v3-matrix-total{ position:absolute; inset-inline-start:50%; top:50%; transform:translate(-50%,-50%); display:flex; flex-direction:column; align-items:center; gap:6px; background:var(--v3-navy); color:#fff; border-radius:50%; width:200px; height:200px; justify-content:center; }
.v3-matrix-total b{ font-size:40px; }
.v3-matrix-total span{ font-size:20px; color:rgba(255,255,255,.75); }

.v3-cmp-grid{ display:grid; grid-template-columns:1fr 1fr; gap:48px; flex:1; }
.v3-cmp-panel{ display:flex; flex-direction:column; gap:16px; border-radius:16px; padding:32px; background:var(--v3-panel); }
.v3-cmp-panel-title{ font-size:32px; }
.v3-cmp-row{ display:flex; justify-content:space-between; font-size:28px; padding:12px 0; border-bottom:1px solid var(--v3-hair); }
.v3-cmp-row b{ color:var(--v3-navy); }

.v3-impact-split{ display:grid; grid-template-columns:1fr 1fr; gap:48px; flex:1; min-height:0; }
.v3-impact-col{ display:flex; flex-direction:column; gap:16px; min-height:0; }
.v3-impact-col-title{ font-size:28px; }
.v3-impact-chart{ flex:1; min-height:0; }
.v3-impact-callout{ display:flex; align-items:baseline; gap:12px; border-radius:12px; padding:16px 20px; background:var(--v3-callout); }
.v3-impact-callout b{ font-size:40px; color:var(--v3-navy); }
.v3-impact-callout span{ font-size:22px; color:var(--v3-muted); }
`;
