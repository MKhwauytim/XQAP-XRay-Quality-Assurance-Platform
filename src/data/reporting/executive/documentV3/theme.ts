// A4, flowing-page counterpart to deck3's fixed 1920x1080 slide canvas.
// Reuses deck3's exact CSS (tokens + every .v3-* component class — panels,
// tables, KPI bands, eyebrows are all canvas-size-agnostic) and layers a
// page-shell block on top that replaces .slide.v3's fixed dimensions with
// A4 print-flow rules. No border-radius, no box-shadow — inherited from
// deck3's CSS, not re-declared here.
import { DECK_V3_CSS } from "../deck3/theme";

const DOCUMENT_V3_PAGE_CSS = `
@page { size: A4; margin: 0; }
html,body{margin:0;padding:0;background:var(--v3-bg);}
.docviewer{display:flex;min-height:100vh;}
.docviewer .sidebar{
  width:280px;flex:0 0 280px;background:var(--v3-navy);color:var(--v3-bg);
  padding:40px 28px;position:sticky;top:0;height:100vh;overflow-y:auto;
}
.docviewer .sidebar .doc-brand{font-size:22px;font-weight:700;margin-bottom:8px;}
.docviewer .sidebar .doc-brand-sub{font-size:16px;color:rgba(249,248,245,.7);margin-bottom:32px;}
.docviewer .sidebar nav.toc a{
  display:block;padding:10px 0;color:rgba(249,248,245,.82);text-decoration:none;
  font-size:16px;border-bottom:1px solid rgba(249,248,245,.12);
}
.docviewer .sidebar nav.toc a.active{color:var(--v3-gold-lighter);font-weight:600;}
.docviewer .content{flex:1;padding:24px 0;}
.docpage.v3{
  width:210mm;min-height:297mm;box-sizing:border-box;margin:0 auto 24px;
  background:var(--v3-bg);padding:18mm 16mm;display:flex;flex-direction:column;gap:28px;
  page-break-after:always;border:none;box-shadow:none;
}
.docpage.v3 .docpage-foot{
  margin-top:auto;display:flex;justify-content:space-between;
  font-size:15px;color:var(--v3-muted);border-top:1px solid var(--v3-hair);padding-top:14px;
}
.docpage.v3.docpage-divider{
  background:var(--v3-navy);color:var(--v3-bg);justify-content:center;padding:40mm 20mm;
}
.docpage.v3.docpage-divider .doc-div-ghost{
  font-size:180px;font-weight:700;line-height:.8;color:rgba(249,248,245,.16);
  direction:ltr;unicode-bidi:isolate;
}
.docpage.v3.docpage-divider .doc-div-kicker{font-size:22px;font-weight:500;color:var(--v3-gold-lighter);}
.docpage.v3.docpage-divider .doc-div-h1{font-size:52px;font-weight:700;margin:12px 0;}
.docpage.v3.docpage-divider .doc-div-desc{font-size:20px;line-height:1.6;color:rgba(249,248,245,.78);}
.docpage.v3.docpage-cover{background:var(--v3-cover-navy);color:var(--v3-bg);justify-content:space-between;padding:40mm 20mm;}
.docpage.v3.docpage-cover .doc-cover-title{font-size:56px;font-weight:700;margin:16px 0;}
@media print {
  .docviewer .sidebar, .docviewer .no-print { display:none; }
  .docpage.v3 { margin:0; }
}
`;

export const DOCUMENT_V3_CSS = `${DECK_V3_CSS}\n${DOCUMENT_V3_PAGE_CSS}`;
