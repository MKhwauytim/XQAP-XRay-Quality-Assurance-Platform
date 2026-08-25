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
`;
