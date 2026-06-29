// Design tokens and CSS for the dark-navy executive report viewer.
// Colours eyedropped from PNG mockups in Downloads/New folder (4)/.

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
