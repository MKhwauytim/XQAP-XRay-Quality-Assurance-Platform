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
