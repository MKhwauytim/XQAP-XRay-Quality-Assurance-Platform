// Shared report chrome (Wave 3 report rework). Parameterised document- and
// deck-viewer wrappers that reuse the executive visual identity (EXEC_CSS /
// DECK_CSS, the icon set, and the hardened `esc` primitive) so the sample,
// distribution and management reports render in the SAME ZATCA-professional
// theme as the executive editions — without duplicating the theme or mutating
// the executive's own (executive-specific) viewer/deck wrappers.
//
// Pure HTML-string builders — no React, no DOM, no runtime JS beyond the small
// TOC/print chrome carried inline (identical to the executive viewer's).

import { EXEC_CSS, EXEC_DOCUMENT_PRINT_CSS } from "../executive/theme";
import { DECK_CSS } from "../executive/deck/deckTheme";
import { esc } from "../executive/primitives";
import { icon } from "../executive/ui/icons";
import { SOURCE_REVISIONS_CSS } from "../sourceRevisions";
import { ARABIC_FONT_FACE_CSS } from "../../../branding/fonts";
import { formatMonthFolderShortLabel } from "../../population/monthFolder";

/** TOC builder + active-page highlighter — identical behaviour to the executive
 *  document viewer, kept here so the shared chrome is self-contained. */
const VIEWER_JS = `(function(){
  var pages=[].slice.call(document.querySelectorAll('.page'));
  var toc=document.getElementById('toc');
  if(!toc) return;
  pages.forEach(function(p,i){
    var a=document.createElement('a');
    a.href='#'+p.id;
    var num=String(i+1).padStart(2,'0');
    a.innerHTML='<span>'+p.dataset.title+'</span><b>'+num+'</b>';
    toc.appendChild(a);
  });
  var links=[].slice.call(toc.querySelectorAll('a'));
  var obs=new IntersectionObserver(function(entries){
    entries.forEach(function(e){
      if(e.isIntersecting){
        links.forEach(function(a){
          a.classList.toggle('active',a.getAttribute('href')==='#'+e.target.id);
        });
      }
    });
  },{rootMargin:'-35% 0px -55% 0px',threshold:0});
  pages.forEach(function(p){obs.observe(p);});
})();`;

export type ChromeOpts = {
  /** Joined `.page` (document) or `.slide` (deck) sections. */
  slides: string;
  /** Document `<title>` + browser tab title. */
  docTitle: string;
  /** Brand headline shown in the sidebar / toolbar. */
  brandTitle: string;
  /** Brand sub-line (usually "… — {monthLabel}"). */
  brandSub: string;
  /** Icon name (ui/icons) for the brand mark. Defaults to "shield". */
  iconName?: string;
  /**
   * Optional footer HTML appended after the content/slides (B2 source-revision
   * block). Already-escaped by the caller. Empty string → nothing rendered.
   */
  footerNote?: string;
};

/** A4-portrait document viewer: left sidebar TOC + print button + content column. */
export function buildDocViewer(opts: ChromeOpts): string {
  const iconName = opts.iconName ?? "shield";
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(opts.docTitle)}</title>
<style>${ARABIC_FONT_FACE_CSS}${EXEC_CSS}${EXEC_DOCUMENT_PRINT_CSS}${SOURCE_REVISIONS_CSS}</style>
</head>
<body>
<div class="viewer">
  <aside class="sidebar">
    <div class="brand-small">
      <div class="brand-mark">${icon(iconName, 24)}</div>
      <div>
        <strong>${esc(opts.brandTitle)}</strong>
        <span>${esc(opts.brandSub)}</span>
      </div>
    </div>
    <div class="toolbar">
      <button class="btn" onclick="window.print()">طباعة / PDF</button>
    </div>
    <div class="nav-title">الصفحات</div>
    <nav class="toc" id="toc"></nav>
  </aside>
  <main class="content">
${opts.slides}
${opts.footerNote ?? ""}
  </main>
</div>
<script>${VIEWER_JS}</script>
</body>
</html>`;
}

/** 16:9 landscape deck viewer: sticky toolbar (light/dark toggle + print) + slides. */
export function buildDeckViewer(opts: ChromeOpts): string {
  const iconName = opts.iconName ?? "shield";
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(opts.docTitle)}</title>
<style>${ARABIC_FONT_FACE_CSS}${DECK_CSS}${SOURCE_REVISIONS_CSS}</style>
</head>
<body>
<div class="deck-viewer">
  <div class="deck-toolbar">
    <div class="deck-brand">
      <div class="brand-mark">${icon(iconName, 22)}</div>
      <div>
        <strong>${esc(opts.brandTitle)}</strong>
        <span>${esc(opts.brandSub)}</span>
      </div>
    </div>
    <div class="deck-toolbar-actions">
      <label class="theme-toggle" title="التبديل بين الوضع الفاتح والداكن" dir="ltr">
        <input type="checkbox" onchange="document.body.classList.toggle('theme-light', this.checked)"/>
        <span class="theme-toggle-track">
          <span class="theme-toggle-icon moon">${icon("moon", 13)}</span>
          <span class="theme-toggle-icon sun">${icon("sun", 13)}</span>
          <span class="theme-toggle-thumb"></span>
        </span>
      </label>
      <button class="btn" onclick="window.print()">طباعة / PDF</button>
    </div>
  </div>
${opts.slides}
${opts.footerNote ?? ""}
</div>
</body>
</html>`;
}

/** Shared month-folder → Arabic label (e.g. "5-may-2026" → "مايو 2026"). */
export function formatMonthLabel(folderName: string): string {
  return formatMonthFolderShortLabel(folderName);
}

/** Shared "DD / MM / YYYY" issue-date stamp. */
export function formatIssueDate(d = new Date()): string {
  return `${String(d.getDate()).padStart(2, "0")} / ${String(d.getMonth() + 1).padStart(2, "0")} / ${d.getFullYear()}`;
}
