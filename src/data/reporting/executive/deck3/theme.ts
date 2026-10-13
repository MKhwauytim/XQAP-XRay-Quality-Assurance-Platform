// Handoff design tokens + slide/chrome CSS (design_handoff_xray_qa_deck,
// rebuilt 2026-08-26 to match the handoff pixel-for-pixel). Two rules from the
// handoff README are load-bearing here and easy to regress:
//   - No border radius anywhere except the 16px 50% dots in panel titles; no
//     shadows. Every earlier `border-radius:16px` card was a drift from the
//     handoff and has been removed.
//   - Divider slides are DARK (#10304f) with light text — the background rule
//     below is what makes their rgba(249,248,245,…) text readable at all
//     (the first implementation shipped white text on the light page bg).
// Viewer chrome (side nav / toolbar / fullscreen) mirrors deck2's markup and
// reuses deck2's scripts verbatim (see deck3/index.ts); only the skin here is
// deck3's own, so deck2's CSS never loads into a v3 document.
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
  --v3-green:#2e7d4f; --v3-green-soft:#5d8a4e; --v3-red:#b8543f; --v3-neutral-bar:#d9d5ca;
  --v3-avg-green:#5d8a72; --v3-avg-red:#c98a78; --v3-track:#eceae3;
  /* Set by DECK_V3_SCALE_SCRIPT (index.ts): slides are a fixed 1920×1080
     canvas scaled as a whole. A CSS-only calc can't produce the unitless
     <number> transform:scale() needs from 100vw, so a tiny script owns it.
     --v3-tx is that same script's MEASURED horizontal centering correction
     (px) — see the script's own doc comment for why this can't be a CSS
     margin/right trick. */
  --v3-scale:1; --v3-tx:0px;
}
html,body{margin:0;padding:0;}
body{background:var(--v3-navy);font-family:"Somar","IBM Plex Sans Arabic","Tahoma","Arial",sans-serif;}

/* ── Viewer shell ─────────────────────────────────────────────────────────── */
/* Dark navy surround, NOT --v3-bg — the handoff's own canvas backdrop is a
   dark navy (#0b1f33) behind the light slide "paper", and every other
   edition in this app (deck/deckTheme.ts's EXEC_CSS body, which deck1/deck2
   share) already uses the same page-darker-than-slide convention. Reusing
   --v3-bg here (this rule's original value) made the slide and the page
   around it the exact same color, indistinguishable except for a 1px hairline
   border — that's what made the report hard to read at a glance. */
.deck-viewer-v3{display:block;min-height:100vh;padding:28px 16px 56px;background:var(--v3-navy);}
.slide.v3{
  /* Horizontal centering is a MEASURED pixel shift (--v3-tx, set by
     DECK_V3_SCALE_SCRIPT in index.ts), not a CSS margin/right trick. Two
     CSS-only attempts both broke on real windows: margin:0 auto and later
     right:50%/margin-right:-960px (see index.ts's doc comment for exactly
     why the latter fails — box-model over-constraint resolution for a
     position:relative box in a dir=rtl document silently recomputes
     margin-left around margin-right, landing hundreds of px off in a way
     that happened to look fine in every viewport size tested here). Letting
     JS measure the box's actual rendered position and correct it exactly is
     immune to that class of bug by construction. */
  width:1920px;height:1080px;margin:0;
  margin-bottom:calc(-1080px * (1 - var(--v3-scale)) + 26px);
  transform:translateX(var(--v3-tx,0px)) scale(var(--v3-scale));transform-origin:top left;
  position:relative;overflow:hidden;box-sizing:border-box;
  background:var(--v3-bg);color:var(--v3-text);
  border:1px solid var(--v3-hair);
  /* The cover/closing/divider variants below share the page's own navy
     family (--v3-cover-navy / --v3-navy is literally the page background for
     dividers), so a border alone can't separate them from .deck-viewer-v3's
     surround — only this shadow, kept on the shared base rule so every
     variant inherits it, does. */
  box-shadow:0 10px 32px rgba(0,0,0,.4);
  display:flex;flex-direction:column;padding:84px 100px 56px;
}
.slide.v3.v3-cover,.slide.v3.v3-closing{background:var(--v3-cover-navy);color:#fff;padding:96px 120px 84px;border:none;}
.slide.v3.v3-divider{background:var(--v3-navy);color:var(--v3-bg);justify-content:space-between;padding:96px 100px 72px;border:none;}

/* ── Content-slide header / footer ────────────────────────────────────────── */
.v3-head{display:flex;flex-direction:column;gap:16px;margin-bottom:30px;}
.v3-eyebrow{display:flex;align-items:center;gap:14px;font-size:26px;font-weight:500;color:var(--v3-gold);}
.v3-eyebrow::before{content:"";width:34px;height:3px;background:var(--v3-gold);}
.v3-title-row{display:flex;align-items:baseline;justify-content:space-between;gap:40px;}
.v3-h2{font-size:56px;line-height:1.15;font-weight:700;color:var(--v3-navy);margin:0;}
.v3-h2.lg{font-size:64px;}
.v3-head-note{font-size:26px;color:var(--v3-muted);}
.v3-page-foot{
  margin-top:auto;padding-top:20px;border-top:1px solid var(--v3-hair);
  display:flex;justify-content:space-between;align-items:center;
  font-size:24px;color:var(--v3-muted);
}
.v3-page-num{font-weight:500;color:var(--v3-navy);direction:ltr;unicode-bidi:isolate;white-space:nowrap;font-variant-numeric:tabular-nums;}

/* ── Cover / closing ──────────────────────────────────────────────────────── */
.v3-org{display:flex;align-items:center;gap:28px;}
.v3-org img{height:80px;filter:brightness(0) invert(1);opacity:.95;}
.v3-org-sep{width:1px;height:76px;background:rgba(255,255,255,.25);}
.v3-org-lines{display:flex;flex-direction:column;gap:6px;font-size:24px;line-height:1.4;color:rgba(255,255,255,.75);}
.v3-org-lines b{font-weight:700;color:#fff;}
.v3-cover-mid{flex:1;display:flex;flex-direction:column;justify-content:center;gap:36px;}
.v3-kicker{display:flex;align-items:center;gap:14px;font-size:28px;font-weight:500;color:var(--v3-gold-light);letter-spacing:.03em;}
.v3-kicker::before{content:"";width:40px;height:3px;background:var(--v3-gold-light);}
.v3-cover-h1{margin:0;font-size:110px;line-height:1.18;font-weight:700;max-width:1250px;}
.v3-cover-period{display:flex;flex-direction:column;gap:10px;}
.v3-cover-period span{font-size:26px;color:rgba(255,255,255,.65);}
.v3-cover-period b{font-size:54px;font-weight:700;color:var(--v3-gold-light);}
.v3-cover-meta{display:flex;gap:72px;padding-top:36px;border-top:1px solid rgba(255,255,255,.2);}
.v3-cover-meta-item{display:flex;flex-direction:column;gap:8px;}
.v3-cover-meta-item span{font-size:24px;color:rgba(255,255,255,.6);}
.v3-cover-meta-item b{font-size:30px;font-weight:500;}
.v3-cover-meta-item.end{margin-inline-start:auto;}
.v3-closing-h1{margin:0;font-size:150px;line-height:1.1;font-weight:700;}
.v3-closing-line{font-size:34px;color:rgba(255,255,255,.75);max-width:1100px;line-height:1.5;}

/* ── Contents (slide 2) ───────────────────────────────────────────────────── */
.v3-toc{flex:1;display:flex;flex-direction:column;}
.v3-toc-row{display:grid;grid-template-columns:120px 1fr 420px 130px;align-items:center;gap:28px;padding:18px 0;border-top:1px solid var(--v3-hair);}
.v3-toc-row.no-topics{grid-template-columns:120px 1fr 130px;}
.v3-toc-row:first-child{border-top:2px solid var(--v3-navy);}
.v3-toc-row:last-child{border-bottom:2px solid var(--v3-navy);}
.v3-toc-index{font-size:44px;font-weight:700;color:var(--v3-gold);}
.v3-toc-main{display:flex;flex-direction:column;gap:6px;}
.v3-toc-main b{font-size:34px;font-weight:700;color:var(--v3-navy);}
.v3-toc-main span{font-size:26px;color:var(--v3-muted);}
.v3-toc-topics{font-size:26px;color:var(--v3-muted);}
.v3-toc-pages{font-size:26px;color:var(--v3-navy);font-weight:500;text-align:left;}

/* ── Glossary (slide 3) ───────────────────────────────────────────────────── */
.v3-gloss{flex:1;display:flex;flex-direction:column;gap:44px;}
.v3-gloss-group{display:flex;flex-direction:column;gap:24px;}
.v3-gloss-title{display:flex;align-items:center;gap:16px;font-size:30px;font-weight:700;color:var(--v3-navy);}
.v3-gloss-dot{width:14px;height:14px;}
.v3-gloss-grid{display:grid;gap:0;border-top:2px solid var(--v3-navy);}
.v3-gloss-grid.cols-3{grid-template-columns:1fr 1fr 1fr;}
.v3-gloss-grid.cols-2{grid-template-columns:1fr 1fr;}
.v3-gloss-cell{display:flex;flex-direction:column;gap:14px;padding:30px;border-inline-end:1px solid var(--v3-hair);}
.v3-gloss-cell:first-child{padding-inline-start:0;}
.v3-gloss-cell:last-child{border-inline-end:none;padding-inline-end:0;}
.v3-gloss-cell b{font-size:32px;font-weight:700;color:var(--v3-navy);}
.v3-gloss-cell p{margin:0;font-size:26px;line-height:1.7;color:var(--v3-text);}

/* ── Risk levels (slide 4) ────────────────────────────────────────────────── */
.v3-levels{flex:1;display:grid;grid-template-columns:repeat(4,1fr);grid-template-rows:auto auto auto auto 1fr;column-gap:0;row-gap:14px;border-top:2px solid var(--v3-navy);border-bottom:2px solid var(--v3-navy);}
/* Each column spans the parent's five rows via subgrid, so the definition and «المحددات» blocks start at the same height in every column. */
.v3-level-col{display:grid;grid-row:span 5;grid-template-rows:subgrid;padding:24px 32px;border-inline-end:1px solid var(--v3-hair);}
.v3-level-col:first-child{padding-inline-start:0;}
.v3-level-col:last-child{border-inline-end:none;padding-inline-end:0;}
.v3-level-chip{width:44px;height:5px;}
.v3-level-col h3{margin:0;font-size:34px;font-weight:700;color:var(--v3-navy);}
.v3-level-sub{font-size:23px;font-weight:600;}
.v3-level-col .cap{font-size:20px;color:var(--v3-muted);}
.v3-level-def{font-size:22px;line-height:1.5;color:var(--v3-text);}
.v3-level-dets{margin:0;padding-inline-start:26px;font-size:22px;line-height:1.4;font-weight:500;color:var(--v3-navy);}
.v3-level-dets li{margin:2px 0;}
.v3-level-foot{align-self:start;margin-top:26px;display:flex;flex-direction:column;gap:8px;}
.v3-level-foot .cap{font-size:24px;color:var(--v3-muted);}
.v3-level-foot .measures{font-size:25px;font-weight:500;color:var(--v3-navy);}
.v3-level-weight{font-size:24px;font-weight:500;padding-top:10px;border-top:1px solid var(--v3-hair);}
.v3-tone-gold{background:var(--v3-gold);}
.v3-tone-blue{background:var(--v3-blue);}
.v3-tone-green{background:var(--v3-green);}
.v3-tone-green-soft{background:var(--v3-green-soft);}
.v3-tone-red{background:var(--v3-red);}
.v3-tone-navy{background:var(--v3-navy);}
.v3-tone-neutral{background:var(--v3-neutral-bar);}
.v3-ink-gold{color:var(--v3-gold);}
.v3-ink-gold-dark{color:var(--v3-gold-dark);}
.v3-ink-blue{color:var(--v3-blue);}
.v3-ink-blue-dark{color:var(--v3-blue-dark);}
.v3-ink-green{color:var(--v3-green);}
.v3-ink-green-soft{color:var(--v3-green-soft);}
.v3-ink-red{color:var(--v3-red);}
.v3-ink-navy{color:var(--v3-navy);}
.v3-ink-muted{color:var(--v3-muted);}
.v3-callout{display:flex;align-items:center;gap:20px;margin-top:18px;padding:12px 22px;background:var(--v3-callout);border-inline-start:5px solid var(--v3-navy);}
.v3-callout>b{font-size:34px;font-weight:700;color:var(--v3-navy);direction:ltr;unicode-bidi:isolate;white-space:nowrap;}
.v3-callout-lines{display:flex;flex-direction:column;gap:2px;}
.v3-callout-lines b{font-size:25px;font-weight:700;color:var(--v3-navy);}
.v3-callout-lines span{font-size:24px;color:var(--v3-muted);}

/* ── KPI bands (slides 5, 10) ─────────────────────────────────────────────── */
.v3-kpi-band{display:grid;grid-template-columns:repeat(3,1fr);gap:0;}
.v3-kpi-band.top{border-top:2px solid var(--v3-navy);border-bottom:1px solid var(--v3-hair);}
.v3-kpi-band.bottom{border-bottom:2px solid var(--v3-navy);}
.v3-kpi-band.solo{border-top:2px solid var(--v3-navy);border-bottom:2px solid var(--v3-navy);}
.v3-kpi-cell{display:flex;flex-direction:column;gap:8px;padding:26px 40px;border-inline-end:1px solid var(--v3-hair);}
.v3-kpi-band.compact .v3-kpi-cell{padding:10px 36px;gap:6px;}
.v3-kpi-cell:first-child{padding-inline-start:0;}
.v3-kpi-cell:last-child{border-inline-end:none;padding-inline-end:0;}
.v3-kpi-label{font-size:28px;color:var(--v3-muted);}
.v3-kpi-band.compact .v3-kpi-label{font-size:27px;font-weight:500;}
.v3-kpi-row{display:flex;flex-direction:column;align-items:flex-start;gap:2px;}
.v3-kpi-value{font-size:96px;font-weight:700;color:var(--v3-navy);line-height:1;}
.v3-kpi-band.bottom .v3-kpi-value{font-size:76px;}
.v3-kpi-band.compact .v3-kpi-value{font-size:56px;}
.v3-kpi-band.compact .v3-kpi-row{gap:2px;}
.v3-kpi-band.compact .v3-kpi-sub{font-size:23px;line-height:1.45;}
.v3-kpi-band.has-pair{grid-template-columns:1fr 2fr 1fr;}
.v3-kpi-pair{flex-direction:row;gap:0;padding-block:0;}
.v3-kpi-half{flex:1;display:flex;flex-direction:column;gap:8px;padding:26px 28px;}
.v3-kpi-half + .v3-kpi-half{border-inline-start:1px solid var(--v3-hair);}
.v3-kpi-half:first-child{padding-inline-start:0;}
.v3-kpi-half:last-child{padding-inline-end:0;}
.v3-kpi-pair .v3-kpi-row{flex-direction:column;align-items:flex-start;gap:6px;}
.v3-kpi-pair .v3-kpi-value{font-size:64px;}
.v3-kpi-pair .v3-kpi-sub{font-size:22px;}
.v3-kpi-aside{font-size:26px;font-weight:500;color:var(--v3-muted);}
.v3-kpi-sub{font-size:26px;color:var(--v3-muted);line-height:1.55;}
.v3-kpi-band.compact .v3-kpi-sub{font-size:24px;}

/* ── Section dividers (slides 6, 9, 14) ───────────────────────────────────── */
.v3-div-eyebrow{display:flex;align-items:center;gap:14px;font-size:26px;font-weight:500;color:var(--v3-gold-lighter);}
.v3-div-eyebrow::before{content:"";width:34px;height:3px;background:var(--v3-gold);}
.v3-div-main{display:flex;align-items:flex-end;gap:64px;}
.v3-div-ghost{font-size:280px;font-weight:700;line-height:.8;color:rgba(249,248,245,.16);direction:ltr;unicode-bidi:isolate;}
.v3-div-body{display:flex;flex-direction:column;gap:22px;padding-bottom:16px;border-inline-start:4px solid var(--v3-gold);padding-inline-start:44px;}
.v3-div-kicker{font-size:30px;font-weight:500;color:var(--v3-gold-lighter);}
.v3-div-h1{font-size:82px;line-height:1.1;font-weight:700;margin:0;}
.v3-div-desc{font-size:30px;line-height:1.6;color:rgba(249,248,245,.78);margin:0;max-width:1100px;}
.v3-div-foot{display:flex;gap:0;border-top:1px solid rgba(249,248,245,.22);padding-top:26px;}
.v3-div-foot span{flex:1;font-size:26px;color:rgba(249,248,245,.72);padding-inline-end:32px;}
.v3-div-foot span+span{border-inline-start:1px solid rgba(249,248,245,.22);padding-inline-start:32px;}

/* ── Population per level (slide 7) ───────────────────────────────────────── */
.v3-pop-grid{flex:1;display:grid;grid-template-columns:380px 1fr;gap:72px;}
.v3-pop-stats{display:flex;flex-direction:column;border-top:2px solid var(--v3-navy);align-self:start;}
.v3-pop-stat{display:flex;flex-direction:column;gap:10px;padding:34px 0;border-bottom:1px solid var(--v3-hair);}
.v3-pop-stat:last-child{border-bottom:none;}
/* Four stats (a summary-backed report adds «مجتمع بنتائج أخرى»): tighter so the column clears the footer. */
.v3-pop-stats:has(.v3-pop-stat:nth-child(4)) .v3-pop-stat{padding:20px 0;gap:6px;}
.v3-pop-stats:has(.v3-pop-stat:nth-child(4)) .v3-pop-stat b{font-size:60px;}
.v3-pop-stat span{font-size:26px;color:var(--v3-muted);}
.v3-pop-stat b{font-size:72px;font-weight:700;color:var(--v3-navy);line-height:1;}
.v3-pop-table{display:flex;flex-direction:column;border-top:2px solid var(--v3-navy);align-self:start;}
.v3-pop-hrow,.v3-pop-row{display:grid;grid-template-columns:200px 1fr 170px 170px 200px;gap:24px;align-items:center;border-bottom:1px solid var(--v3-hair);}
.v3-pop-hrow{padding:16px 0;font-size:24px;color:var(--v3-muted);font-weight:500;}
.v3-pop-hrow span:not(:first-child),.v3-pop-row>*:not(:first-child):not(.v3-pop-bar){text-align:right;}
.v3-pop-row{padding:26px 0;}
.v3-pop-row:last-of-type{border-bottom:2px solid var(--v3-navy);}
.v3-pop-row .name{font-size:28px;font-weight:700;color:var(--v3-navy);}
.v3-pop-bar{height:20px;background:var(--v3-track);}
.v3-pop-bar i{display:block;height:100%;min-width:8px;}
.v3-pop-row .num{font-size:28px;color:var(--v3-text);}
.v3-pop-row .num.strong{font-weight:700;color:var(--v3-navy);}
.v3-pop-row .method{font-size:24px;color:var(--v3-muted);}
.v3-pop-row .method.census{color:var(--v3-gold);font-weight:500;}
.v3-pop-note{margin:26px 0 0;font-size:24px;color:var(--v3-muted);line-height:1.6;}
.v3-pop-note p{margin:0;font-weight:600;color:var(--v3-text);}
.v3-sub-title{margin:10px 0 4px;font-size:26px;font-weight:700;color:var(--v3-navy);display:flex;align-items:baseline;gap:18px;}
.v3-sub-title small{font-size:20px;font-weight:400;color:var(--v3-muted);}
.v3-pop-bullets{margin:8px 0 0;padding-inline-start:34px;list-style:disc;}
.v3-pop-bullets li{margin:2px 0;}
/* Observations and recommendations table: same border system as every table (2px navy frame, 1px hairlines), figures on their own row. */
.v3-obs{width:100%;border-collapse:collapse;table-layout:fixed;}
.v3-obs th{font-size:25px;color:var(--v3-muted);font-weight:500;text-align:right;padding:10px 0 10px 14px;border-top:2px solid var(--v3-navy);border-bottom:1px solid var(--v3-hair);}
.v3-obs th:nth-child(1){width:7%;}
.v3-obs th:nth-child(2){width:55%;}
.v3-obs th:nth-child(3){width:38%;}
.v3-obs td{vertical-align:top;padding:14px 0 14px 18px;border-bottom:1px solid var(--v3-hair);}
.v3-obs td+td{border-inline-start:1px solid var(--v3-hair);padding-inline-start:22px;}
.v3-obs tbody tr:last-child td{border-bottom:2px solid var(--v3-navy);}
.v3-obs-num{font-size:38px;font-weight:700;line-height:1.2;}
.v3-obs-num.red{color:var(--v3-red);}
.v3-obs-num.gold{color:var(--v3-gold);}
.v3-obs-num.navy{color:var(--v3-navy);}
.v3-obs-text{display:block;font-size:26px;line-height:1.5;color:var(--v3-navy);}
.v3-obs-rec .v3-obs-text{color:var(--v3-text);}
.v3-obs-figs{display:flex;flex-wrap:wrap;gap:8px 30px;margin-top:10px;padding-top:9px;border-top:1px solid var(--v3-hair);}
.v3-fig{display:flex;flex-direction:column;gap:1px;}
.v3-fig small{font-size:19px;color:var(--v3-muted);}
.v3-fig b{font-size:27px;font-weight:700;color:var(--v3-navy);line-height:1.1;}
/* Population table: every header on ONE line (the narrow coverage column used to wrap to two). */
.v3-pop-table .v3-table th{white-space:nowrap;}
/* Coverage progress: bar in the level colour, full = target reached, flag = finished. */
.v3-cov{display:flex;align-items:center;gap:14px;}
.v3-cov .v3-pop-bar{flex:1;position:relative;}
.v3-cov .v3-pop-bar::after{content:"";position:absolute;inset-block:-7px;inset-inline-end:0;width:3px;background:var(--v3-navy);}
.v3-cov-flag{flex:none;width:36px;height:36px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;}
.v3-cov-flag.done{background:var(--v3-green);color:#fff;}
.v3-cov-flag.open{border:3px solid var(--v3-hair);}

/* ── Land/sea tinted panels + tables (slides 8, 11, 16) ───────────────────── */
.v3-two-col{flex:1;display:grid;grid-template-columns:1fr 1fr;gap:48px;align-content:start;}
.v3-panel{display:flex;flex-direction:column;padding:24px 30px;box-sizing:border-box;}
.v3-panel.land{background:var(--v3-land);border-top:5px solid var(--v3-gold);}
.v3-panel.sea{background:var(--v3-sea);border-top:5px solid var(--v3-blue);}
.v3-panel-head{display:flex;align-items:baseline;justify-content:space-between;gap:20px;margin-bottom:14px;}
.v3-panel-title{display:flex;align-items:center;gap:14px;font-size:30px;font-weight:700;}
.v3-panel-title::before{content:"";width:16px;height:16px;border-radius:50%;}
.v3-panel.land .v3-panel-title{color:var(--v3-gold-dark);}
.v3-panel.land .v3-panel-title::before{background:var(--v3-gold);}
.v3-panel.sea .v3-panel-title{color:var(--v3-blue-dark);}
.v3-panel.sea .v3-panel-title::before{background:var(--v3-blue);}
/* All ports together (neither land nor sea): neutral navy, so it never reads as the land colour. */
.v3-panel.all{background:var(--v3-panel);border-top:5px solid var(--v3-navy);}
.v3-panel.all .v3-panel-title{color:var(--v3-navy);}
.v3-panel.all .v3-panel-title::before{background:var(--v3-navy);}
.v3-panel-note{font-size:24px;color:var(--v3-muted);}
.v3-table{width:100%;border-collapse:collapse;table-layout:fixed;}
.v3-table th{font-size:25px;color:var(--v3-muted);font-weight:500;text-align:right;padding:10px 0 10px 14px;border-top:2px solid var(--v3-navy);border-bottom:1px solid var(--v3-hair);}
.v3-table th:first-child{text-align:right;width:28%;}
.v3-table.first-36 th:first-child{width:36%;}
.v3-table.first-26 th:first-child{width:26%;}
.v3-table td{font-size:25px;white-space:nowrap;height:56px;box-sizing:border-box;padding:8px 0 8px 14px;border-bottom:1px solid var(--v3-hair);text-align:right;}
.v3-table td:first-child{text-align:right;color:var(--v3-text);white-space:normal;line-height:1.15;}
.v3-table[style*="--row-h"] td{height:var(--row-h);padding:0 0 0 14px;font-size:min(25px,calc(var(--row-h) * .66));}
/* !important: the dense-table and tfoot padding rules above are more specific and would zero this gap, leaving numbers glued to the line. */
.v3-table th.grp,.v3-table td.grp{border-inline-start:2px solid var(--v3-navy);padding-inline-start:22px !important;}
.v3-table .v3-th-top th{text-align:center;color:var(--v3-navy);font-weight:700;font-size:23px;padding:6px 0;border-bottom:1px solid var(--v3-hair);}
.v3-table.lg th{font-size:26px;padding:14px 0 14px 14px;}
.v3-table.lg td{height:76px;font-size:32px;padding:8px 0 8px 14px;}
.v3-table.lg th:nth-child(2){width:24%;}
.v3-table.lg td:first-child{font-weight:700;color:var(--v3-navy);font-size:30px;}
.v3-table.lg .v3-pop-bar{height:22px;}
.v3-qm{display:flex;flex-direction:column;gap:8px;}
.v3-qm-head,.v3-qm-row{display:grid;grid-template-columns:170px repeat(3,1fr);gap:10px;}
.v3-qm-head span{font-size:28px;font-weight:700;color:var(--v3-navy);padding:4px 20px;border-top:6px solid var(--v3-hair);}
.v3-qm-head span.red{border-top-color:var(--v3-red);}
.v3-qm-head span.gold{border-top-color:var(--v3-gold);}
.v3-qm-head span.green{border-top-color:var(--v3-green);}
.v3-qm-row{background:var(--v3-panel);}
.v3-qm-row.land{background:var(--v3-land);}
.v3-qm-row.sea{background:var(--v3-sea);}
.v3-qm-rowlabel{display:flex;align-items:center;padding:0 20px;font-size:26px;font-weight:700;color:var(--v3-navy);}
.v3-qm-cell{display:flex;flex-direction:column;gap:4px;padding:9px 20px 11px;border-inline-start:1px solid var(--v3-hair);}
.v3-qm-big{font-size:48px;font-weight:700;line-height:1;}
.v3-qm-cap{font-size:19px;color:var(--v3-muted);}
.v3-q-track{height:8px;background:var(--v3-track);}
.v3-q-track i{display:block;height:100%;}
.v3-q-track i.red{background:var(--v3-red);}
.v3-q-track i.gold{background:var(--v3-gold);}
.v3-q-track i.green{background:var(--v3-green);}
.v3-qm-stats{display:grid;grid-template-columns:1fr 1fr;margin-top:4px;}
.v3-qm-stat{display:flex;flex-direction:column;gap:0;padding-inline-end:12px;}
.v3-qm-stat+.v3-qm-stat{border-inline-start:2px solid var(--v3-navy);padding-inline-start:16px;padding-inline-end:0;}
.v3-qm-stat span{font-size:18px;color:var(--v3-muted);}
.v3-qm-stat b{font-size:30px;font-weight:700;color:var(--v3-navy);line-height:1.1;}
.v3-qm-stat small{font-size:17px;color:var(--v3-muted);}
.v3-table.first-14 th:first-child{width:14%;}
.v3-table.compact-h th,.v3-table.compact-h[style*="--row-h"] th{white-space:nowrap;font-size:17px;padding-inline:0 6px;}
.v3-formula-note{font-size:21px;line-height:1.5;margin-top:10px;}
.v3-table[style*="--row-h"] th{font-size:21px;line-height:1.15;padding:6px 0 6px 14px;white-space:nowrap;}
.v3-table[style*="--row-h"] td{line-height:1.1;}
.v3-table[style*="--row-h"] td .v3-sub{font-size:inherit;line-height:1.1;}
.v3-table[style*="--row-h"] tfoot td{height:auto;padding:10px 0 10px 14px;font-size:25px;}
.v3-table td.v-navy{color:var(--v3-navy);font-weight:500;}
.v3-table td.v-green{color:var(--v3-green);font-weight:500;}
.v3-table td.v-red{color:var(--v3-red);font-weight:500;}
.v3-table td.v-gold{color:var(--v3-gold-dark);font-weight:500;}
.v3-table td.v-blue{color:var(--v3-blue-dark);font-weight:500;}
.v3-table td.v-muted{color:var(--v3-muted);font-weight:400;}
.v3-table tfoot td{font-weight:700;height:auto;padding:12px 0 12px 14px;border-bottom:2px solid var(--v3-navy);}
/* ── One border system for every table-like block ───────────────────────────────────────────────────────────
   2px navy = the frame (top rule + closing rule) and column-group splits; 1px hairline = rows and the header separator.
   Tables without a totals row now close with the same navy rule, a group header row no longer stacks a second navy
   rule on the column headers, and lists/grids/matrices get the closing rule their top rule already implied. */
.v3-table:not(:has(tfoot)) tbody tr:last-child td{border-bottom:2px solid var(--v3-navy);}
.v3-table .v3-th-top + tr th{border-top:1px solid var(--v3-hair);}
.v3-gloss-grid{border-bottom:2px solid var(--v3-navy);}
.v3-pop-stats{border-bottom:2px solid var(--v3-navy);}
.v3-qm{border-bottom:2px solid var(--v3-navy);}
.v3-table tfoot td:first-child{color:var(--v3-navy);}
.v3-table tfoot td[class]{font-weight:700;}
.v3-sub{font-size:24px;font-weight:400;color:var(--v3-muted);}
.v3-sub-sm{font-size:18px;display:block;line-height:1;}
/* A stacked population/sample cell must not make its row taller than a single-line row (port pagination assumes 56px rows). */
.v3-table td:has(.v3-sub-sm){padding:3px 0;line-height:1.05;}
.v3-note{margin:20px 0 0;font-size:25px;color:var(--v3-muted);line-height:1.6;}

/* ── Confusion matrix (slide 15) ──────────────────────────────────────────── */
.v3-matrix{flex:1;display:grid;grid-template-columns:220px 1fr 1fr 300px;grid-template-rows:auto 1fr 1fr auto;border-top:2px solid var(--v3-navy);border-bottom:2px solid var(--v3-navy);}
.v3-mx{border-inline-end:1px solid var(--v3-hair);border-bottom:1px solid var(--v3-hair);}
.v3-mx.col-last{border-inline-end:none;}
.v3-mx.row-last{border-bottom:none;}
.v3-mx-head{padding:20px 24px;font-size:26px;font-weight:700;color:var(--v3-navy);}
.v3-mx-head.muted{color:var(--v3-muted);}
.v3-mx-label{padding:26px 24px;font-size:27px;font-weight:700;color:var(--v3-navy);display:flex;align-items:center;}
.v3-mx-cell{display:flex;flex-direction:column;gap:8px;justify-content:center;padding:26px 30px;}
.v3-mx-cell.pos{background:var(--v3-pos-tint);}
.v3-mx-cell.neg{background:var(--v3-neg-tint);}
.v3-mx-cell b{font-size:52px;font-weight:700;line-height:1;}
.v3-mx-cell.pos b{color:var(--v3-green);}
.v3-mx-cell.neg b{color:var(--v3-red);}
.v3-mx-cell span{font-size:24px;color:var(--v3-muted);line-height:1.5;}
.v3-mx-side{display:flex;flex-direction:column;justify-content:center;gap:6px;padding:26px 24px;}
.v3-mx-side span{font-size:24px;color:var(--v3-muted);}
.v3-mx-side b{font-size:38px;font-weight:700;color:var(--v3-navy);white-space:nowrap;}
.v3-mx-side.gold b{color:var(--v3-gold);}

/* ── L1/L2 metric-row panels (slide 16) ───────────────────────────────────── */
.v3-panel.pad-lg{padding:26px 32px;gap:20px;}
.v3-panel.pad-lg .v3-panel-title{font-size:32px;}
.v3-cmp-rows{display:flex;flex-direction:column;gap:16px;}
.v3-cmp-row{display:flex;align-items:baseline;justify-content:space-between;gap:20px;padding-bottom:12px;border-bottom:1px solid var(--v3-hair);}
.v3-cmp-row span{font-size:26px;color:var(--v3-muted);}
.v3-cmp-row b{font-size:34px;font-weight:700;color:var(--v3-navy);white-space:nowrap;}
.v3-cmp-row b.v-green{color:var(--v3-green);}
.v3-cmp-row b.v-red{color:var(--v3-red);}

/* ── Chart primitives (chartKit.ts) ───────────────────────────────────────── */
.v3-plot{position:relative;background:var(--v3-panel);border-bottom:2px solid var(--v3-navy);}
.v3-plot.land{background:var(--v3-land);}
.v3-plot.sea{background:var(--v3-sea);}
.v3-plot.grow{flex:1;min-height:0;}
.v3-bars{position:absolute;inset:0;z-index:1;display:flex;align-items:stretch;box-sizing:border-box;}
.v3-bars.center{justify-content:center;}
.v3-cell{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;align-self:stretch;height:100%;}
.v3-bar{position:relative;width:100%;display:flex;justify-content:center;padding-top:10px;box-sizing:border-box;}
.v3-bar span{font-size:24px;font-weight:700;color:var(--v3-bg);}
.v3-group{flex:1;min-width:0;display:flex;align-items:stretch;gap:6px;}
.v3-refline{position:absolute;right:0;left:0;height:0;border-top:3px dashed var(--v3-muted);}
.v3-refline.gold{border-color:var(--v3-gold);}
.v3-refline.gold-dark{border-color:var(--v3-gold-dark);}
.v3-refline.blue-dark{border-color:var(--v3-blue-dark);}
.v3-refline.avg-green{border-color:var(--v3-avg-green);}
.v3-refline.avg-red{border-color:var(--v3-avg-red);}
.v3-ref-label{position:absolute;left:12px;z-index:2;background:var(--v3-panel);padding:0 8px;border-radius:4px;transform:translateY(-6px);font-size:24px;font-weight:500;color:var(--v3-muted);}
.v3-ref-label.gold{color:var(--v3-gold-dark);}
.v3-ref-label.gold-dark{color:var(--v3-gold-dark);}
.v3-ref-label.blue-dark{color:var(--v3-blue-dark);}
.v3-cats{display:flex;box-sizing:border-box;}
/* Dense charts (many bars): shrink labels so a 17+ bar row fits its column instead of overflowing it. */
.v3-dense .v3-bar span{font-size:17px;}
.v3-dense .v3-bar{padding-top:6px;}
.v3-cats.v3-dense .v3-cat{font-size:19px;padding-top:10px;}
.v3-cats.v3-dense .v3-cat span{font-size:17px;}
.v3-dense .v3-group{gap:3px;}
.v3-dense .v3-group .v3-bar span{font-size:14px;letter-spacing:-.4px;}
.v3-dense .v3-ref-label{font-size:20px;}
.v3-cats.center{justify-content:center;}
.v3-cat{flex:1;min-width:0;overflow-wrap:break-word;font-size:25px;color:var(--v3-text);text-align:center;line-height:1.3;padding-top:14px;}
.v3-cat span{font-size:24px;color:var(--v3-muted);}
.v3-legend{display:flex;align-items:center;gap:32px;margin-top:18px;}
.v3-legend-item{display:flex;align-items:center;gap:12px;font-size:24px;color:var(--v3-text);}
.v3-legend-item.muted{color:var(--v3-muted);}
.v3-swatch{width:16px;height:16px;}
.v3-dashline{width:34px;height:0;border-top:3px dashed var(--v3-muted);}
.v3-dashline.gold{border-color:var(--v3-gold);}
.v3-dashline.avg-green{border-color:var(--v3-avg-green);}
.v3-dashline.avg-red{border-color:var(--v3-avg-red);}
.v3-legend-end{margin-inline-start:auto;font-size:24px;color:var(--v3-muted);}
.v3-chart-title-row{display:flex;align-items:baseline;justify-content:space-between;gap:20px;margin-bottom:14px;}
.v3-chart-title{display:flex;align-items:center;gap:14px;font-size:28px;font-weight:700;color:var(--v3-navy);}
.v3-chart-title.dot-land{color:var(--v3-gold-dark);}
.v3-chart-title.dot-land::before{content:"";width:16px;height:16px;border-radius:50%;background:var(--v3-gold);}
.v3-chart-title.dot-sea{color:var(--v3-blue-dark);}
.v3-chart-title.dot-sea::before{content:"";width:16px;height:16px;border-radius:50%;background:var(--v3-blue);}
.v3-chart-aside{display:flex;align-items:center;gap:12px;font-size:24px;font-weight:500;color:var(--v3-muted);white-space:nowrap;}

/* ── Chart slide layouts (12, 13, 17/18, 19, 20) ──────────────────────────── */
.v3-ports-chart-grid{flex:1;display:grid;grid-template-columns:minmax(0,6fr) minmax(0,4fr);gap:44px;min-height:0;}
.v3-chart-col{display:flex;flex-direction:column;min-height:0;min-width:0;}
.v3-levels-chart-grid{flex:1;display:grid;grid-template-columns:repeat(4,1fr);gap:44px;align-content:start;}
.v3-level-cap{display:flex;flex-direction:column;align-items:center;gap:6px;padding-top:16px;}
.v3-level-cap b{font-size:28px;font-weight:700;color:var(--v3-navy);}
.v3-level-cap span{font-size:24px;color:var(--v3-muted);}
.v3-single-chart{flex:1;display:flex;flex-direction:column;min-height:0;}
.v3-agree-grid{flex:1;display:grid;grid-template-columns:1fr 1.15fr;gap:52px;align-content:start;}
.v3-agree-col{display:flex;flex-direction:column;}
.v3-team-charts{height:250px;display:flex;gap:26px;}
.v3-team{flex:1;display:flex;flex-direction:column;}
.v3-team .v3-plot{flex:1;}
.v3-engine-band{display:flex;flex-direction:column;gap:16px;margin-top:26px;padding-top:22px;border-top:2px solid var(--v3-navy);}
.v3-engine-head{display:flex;align-items:baseline;justify-content:space-between;gap:20px;}
.v3-engine-head b{font-size:28px;font-weight:700;color:var(--v3-navy);}
.v3-engine-head span{font-size:24px;color:var(--v3-muted);}
.v3-engine-stats{display:grid;grid-template-columns:1fr 1fr 1fr;gap:0;}
.v3-engine-stat{display:flex;align-items:baseline;gap:16px;padding:0 32px;border-inline-end:1px solid var(--v3-hair);}
.v3-engine-stat:first-child{padding-inline-start:0;}
.v3-engine-stat:last-child{border-inline-end:none;padding-inline-end:0;}
.v3-engine-stat b{font-size:44px;font-weight:700;line-height:1;color:var(--v3-navy);white-space:nowrap;}
.v3-engine-stat b.v-red{color:var(--v3-red);}
.v3-engine-stat b.v-gold{color:var(--v3-gold);}
.v3-engine-stat span{font-size:24px;color:var(--v3-muted);line-height:1.5;}
.v3-engine-bar{display:flex;height:56px;border:1px solid var(--v3-hair);}
.v3-engine-seg{display:flex;align-items:center;justify-content:center;overflow:hidden;}
.v3-engine-seg span{font-size:24px;font-weight:700;color:var(--v3-bg);white-space:nowrap;}
.v3-engine-seg.v3-tone-neutral span{color:var(--v3-text);}
.v3-impact-grid{flex:1;display:grid;grid-template-columns:1fr 1fr;gap:56px;align-content:stretch;min-height:0;}
.v3-impact-single{grid-template-columns:minmax(0,1fr);}
.v3-impact-col{display:flex;flex-direction:column;min-height:0;}
.v3-impact-col .v3-plot{min-height:330px;}
.v3-impact-callout{margin-top:auto;display:flex;align-items:center;gap:20px;padding:20px 26px;min-height:104px;box-sizing:border-box;background:var(--v3-callout);border-inline-start:5px solid var(--v3-navy);}
.v3-impact-callout b{font-size:44px;font-weight:700;color:var(--v3-navy);direction:ltr;unicode-bidi:isolate;white-space:nowrap;}
.v3-impact-callout span{font-size:24px;color:var(--v3-text);line-height:1.5;}

/* ── Viewer chrome: side nav (deck2 markup/scripts, deck3 skin) ───────────── */
.deck-nav{
  position:fixed;inset-inline-start:0;top:0;bottom:0;width:236px;z-index:60;
  display:flex;flex-direction:column;gap:22px;padding:22px 18px;box-sizing:border-box;
  background:var(--v3-cover-navy);border-inline-end:1px solid rgba(255,255,255,.12);
  overflow-y:auto;
}
.deck-nav-brand{display:flex;align-items:center;gap:12px;color:#fff;font-weight:700;font-size:0.95rem;}
.deck-nav-brand img{height:30px;filter:brightness(0) invert(1);opacity:.95;}
.deck-nav-progress{display:flex;flex-direction:column;gap:8px;}
.deck-nav-progress-bar{height:6px;background:rgba(255,255,255,.14);overflow:hidden;}
.deck-nav-progress-fill{height:100%;width:0%;background:var(--v3-gold-light);transition:width .2s ease;}
.deck-nav-progress-text{font-size:0.74rem;font-weight:500;color:rgba(255,255,255,.65);}
.deck-nav-sections{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:5px;}
.deck-nav-item a{
  display:block;padding:10px 12px;font-size:0.82rem;font-weight:500;
  color:rgba(255,255,255,.62);text-decoration:none;border:1px solid transparent;
  transition:background .15s ease,color .15s ease,border-color .15s ease;
}
.deck-nav-item a:hover{background:rgba(255,255,255,.06);color:#fff;}
.deck-nav-item.active a{background:rgba(201,164,94,.14);border-color:rgba(201,164,94,.45);color:var(--v3-gold-light);}

/* ── Viewer chrome: toolbar ───────────────────────────────────────────────── */
.deck-toolbar{
  position:sticky;top:0;z-index:30;
  display:flex;align-items:center;justify-content:space-between;gap:16px;
  max-width:1180px;margin:0 auto 22px;padding:14px 20px;box-sizing:border-box;
  background:var(--v3-cover-navy);border:1px solid rgba(255,255,255,.12);
}
.deck-toolbar .deck-brand{display:flex;align-items:center;gap:14px;}
.deck-toolbar .deck-brand img{height:34px;filter:brightness(0) invert(1);opacity:.95;}
.deck-toolbar .deck-brand strong{display:block;font-size:0.95rem;font-weight:700;color:#fff;}
.deck-toolbar .deck-brand span{display:block;color:rgba(255,255,255,.65);font-size:0.74rem;margin-top:2px;}
.deck-toolbar-actions{display:flex;align-items:center;gap:14px;}
.deck-toolbar .btn{
  display:inline-flex;align-items:center;justify-content:center;gap:8px;
  padding:9px 18px;font-family:inherit;font-size:0.85rem;font-weight:500;
  color:#fff;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.25);cursor:pointer;
}
.deck-toolbar .btn:hover{background:rgba(255,255,255,.18);}
.btn-fullscreen:focus-visible{outline:3px solid var(--v3-gold-light);outline-offset:3px;}
.btn-fullscreen-icon-compress{display:none;}
.btn-fullscreen[aria-pressed="true"] .btn-fullscreen-icon-expand{display:none;}
.btn-fullscreen[aria-pressed="true"] .btn-fullscreen-icon-compress{display:inline-flex;}

/* ── Viewer chrome: single-slide fullscreen mode ──────────────────────────── */
body.deck-fullscreen{overflow:hidden;}
body.deck-fullscreen .deck-nav{display:none;}
body.deck-fullscreen .deck-viewer-v3{
  padding:0;display:flex;align-items:center;justify-content:center;height:100dvh;overflow:hidden;
}
body.deck-fullscreen .deck-toolbar{position:static;background:none;border:none;padding:0;margin:0;pointer-events:none;}
body.deck-fullscreen .deck-toolbar>.deck-brand,
body.deck-fullscreen .deck-toolbar-actions>*:not(.btn-fullscreen){display:none;}
body.deck-fullscreen .btn-fullscreen{
  display:inline-flex;position:fixed;top:16px;inset-inline-end:16px;z-index:95;
  opacity:0;pointer-events:none;transition:opacity .25s ease;
}
body.deck-fullscreen.deck-controls-visible .btn-fullscreen{opacity:1;pointer-events:auto;}
body.deck-fullscreen .slide.v3{display:none;}
/* The optional source-revisions footer (populationReport/deck.ts's footerNote)
   is a direct sibling of .slide.v3 inside .deck-viewer-v3, not a slide itself,
   so the display:none rule above never touches it. Left visible, it becomes a
   second flex child next to the active slide in fullscreen's flex-centered
   .deck-viewer-v3, which crowds and offsets the slide instead of centering it
   alone — hide it in single-slide fullscreen, same as the toolbar/nav chrome. */
body.deck-fullscreen .deck-viewer-v3>.source-revisions{display:none;}
body.deck-fullscreen .slide.v3.deck-slide-active{
  /* .deck-viewer-v3 itself flex-centers the active slide in fullscreen (see
     body.deck-fullscreen .deck-viewer-v3 below) — reliable, direction-aware
     flexbox centering, unrelated to the base rule's --v3-tx pixel shift, so
     this override drops translateX entirely rather than trying to cancel it. */
  display:flex;flex:0 0 auto;margin:0;border:none;
  transform:scale(var(--v3-scale));transform-origin:center center;
}
.btn-slide-nav,.deck-slide-counter{display:none;}
body.deck-fullscreen .btn-slide-nav{
  display:flex;position:fixed;top:50%;transform:translateY(-50%);z-index:90;
  width:44px;height:44px;border-radius:50%;align-items:center;justify-content:center;
  background:rgba(15,43,70,.65);border:1px solid rgba(255,255,255,.3);color:#fff;cursor:pointer;
  opacity:0;pointer-events:none;transition:opacity .25s ease;
}
body.deck-fullscreen .btn-slide-nav:disabled{cursor:default;}
body.deck-fullscreen .btn-slide-prev{inset-inline-start:20px;}
body.deck-fullscreen .btn-slide-next{inset-inline-end:20px;}
body.deck-fullscreen .btn-slide-prev svg{transform:scaleX(-1);}
body.deck-fullscreen .deck-slide-counter{
  display:block;position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:90;
  font-size:.78rem;font-weight:700;color:#fff;background:rgba(15,43,70,.65);
  padding:4px 12px;border-radius:999px;font-variant-numeric:tabular-nums;
  opacity:0;pointer-events:none;transition:opacity .25s ease;
}
body.deck-fullscreen.deck-controls-visible .btn-slide-nav:not(:disabled),
body.deck-fullscreen.deck-controls-visible .deck-slide-counter{opacity:1;pointer-events:auto;}

/* ── Responsive / print ───────────────────────────────────────────────────── */
@media screen and (min-width:1281px){
  .deck-viewer-v3{padding-inline-start:calc(236px + 16px);}
}
@media screen and (max-width:1280px){
  .deck-nav{display:none;}
}
@media print{
  *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;color-adjust:exact!important;}
  body{background:#fff;}
  .deck-nav,.deck-toolbar,.btn-slide-nav,.deck-slide-counter,.btn-fullscreen{display:none!important;}
  .deck-viewer-v3{padding:0;background:#fff;}
  .slide.v3{transform:none!important;margin:0!important;border:none;page-break-after:always;break-after:page;}
  @page{size:1920px 1080px;margin:0;}
}
`;
