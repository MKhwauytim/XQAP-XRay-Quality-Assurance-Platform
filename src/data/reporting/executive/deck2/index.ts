// Executive deck v2 entry points (content-first rework, 2026-07-04).
// Same contract as the v1 deck: one ReportModel drives everything, so the
// numbers can never disagree with the Document/Workbook editions.
// LIVE EDITION since 2026-07-14: the Reports tab's executive deck export calls
// openExecutiveDeckV2. The v1 deck (../deck) remains as the reference edition.

import { buildReportModel } from "../model/reportModel";
import { buildDeckV2Slides } from "./slides";
import { DECK_CSS } from "../deck/deckTheme";
import { DECK_V2_CSS } from "./theme";
import { esc } from "../primitives";
import { icon } from "../ui/icons";
import { openOrDownload } from "../../htmlReport";
import { SOURCE_REVISIONS_CSS, sourceRevisionsFooterHtml } from "../../sourceRevisions";
import { ARABIC_FONT_FACE_CSS } from "../../../../branding/fonts";
import type { ExecutiveReportInput } from "../../executiveReportTypes";
import { formatMonthFolderShortLabel } from "../../../population/monthFolder";

/**
 * On-screen-only side nav (hidden under `@media print`, see theme.ts): lists
 * every section found via `data-section`/`data-section-label` on the slides
 * (derived from the DOM, not a hand-kept registry — see `NAV_SECTIONS` in
 * slides.ts) and tracks scroll position to highlight the active section and
 * show a "page X of Y — N left" progress readout. Pure vanilla JS, no
 * framework, no external file — this is UI chrome for reviewing on screen,
 * not slide-layout math, so it doesn't conflict with the deck's
 * no-runtime-layout-recompute rule.
 */
const DECK_NAV_SCRIPT = `(function(){
  var slides = Array.prototype.slice.call(document.querySelectorAll('.slide[data-section]'));
  if (!slides.length) return;
  var total = slides.length;
  var navSections = document.getElementById('deck-nav-sections');
  var seen = {};
  slides.forEach(function(s){
    var key = s.getAttribute('data-section');
    if (seen[key]) return;
    seen[key] = true;
    var li = document.createElement('li');
    li.className = 'deck-nav-item';
    li.setAttribute('data-key', key);
    var a = document.createElement('a');
    a.href = '#' + s.id;
    a.textContent = s.getAttribute('data-section-label');
    li.appendChild(a);
    navSections.appendChild(li);
  });
  var navItems = Array.prototype.slice.call(navSections.querySelectorAll('.deck-nav-item'));
  var fill = document.getElementById('deck-nav-fill');
  var progressText = document.getElementById('deck-nav-progress-text');
  function update(){
    var thresholdY = window.innerHeight * 0.35;
    var activeIndex = 0;
    for (var i = 0; i < slides.length; i++){
      if (slides[i].getBoundingClientRect().top <= thresholdY) activeIndex = i; else break;
    }
    var activeKey = slides[activeIndex].getAttribute('data-section');
    navItems.forEach(function(li){ li.classList.toggle('active', li.getAttribute('data-key') === activeKey); });
    var pageNum = activeIndex + 1;
    fill.style.width = ((pageNum / total) * 100) + '%';
    var remaining = total - pageNum;
    progressText.textContent = 'الصفحة ' + pageNum + ' من ' + total + (remaining > 0 ? ' \\u2014 تبقّى ' + remaining : ' \\u2014 الأخيرة');
  }
  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  update();
})();`;

/**
 * Style-variant arrow-cycling + persistence, dev-preview only (only appended
 * to the document when `variantPreview` is true — see buildDeckV2Html below).
 * Cycles `.v2-variant-panel.active` within each `.v2-variant-stack` and POSTs
 * the choice to the Vite dev middleware at /__deck-style-choices
 * (deckStyleChoicesPlugin.ts), which persists it to
 * dev-workspace/6-templates/deck-style-choices.json. On load, fetches the
 * saved choices and applies them before the user interacts with anything.
 */
const DECK_VARIANT_SCRIPT = `(function(){
  var switchers = Array.prototype.slice.call(document.querySelectorAll('.v2-variant-switcher'));
  if (!switchers.length) return;
  function stackFor(slideId){
    return document.querySelector('.v2-variant-stack[data-slide-id="' + slideId + '"]');
  }
  function apply(stack, index){
    var panels = Array.prototype.slice.call(stack.querySelectorAll('.v2-variant-panel'));
    panels.forEach(function(p, i){ p.classList.toggle('active', i === index); });
    stack.setAttribute('data-active-index', String(index));
  }
  function setLabel(switcher, index, total){
    var label = switcher.querySelector('.v2-variant-label');
    if (label) label.textContent = (index + 1) + ' / ' + total;
  }
  function persist(slideId, index){
    fetch('/__deck-style-choices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slideId: slideId, variantIndex: index })
    }).catch(function(){});
  }
  switchers.forEach(function(switcher){
    var slideId = switcher.getAttribute('data-for');
    var stack = stackFor(slideId);
    if (!stack) return;
    var panelCount = stack.querySelectorAll('.v2-variant-panel').length;
    function step(delta){
      var cur = Number(stack.getAttribute('data-active-index') || '0');
      var next = (cur + delta + panelCount) % panelCount;
      apply(stack, next);
      setLabel(switcher, next, panelCount);
      persist(slideId, next);
    }
    switcher.querySelector('.v2-variant-prev').addEventListener('click', function(){ step(-1); });
    switcher.querySelector('.v2-variant-next').addEventListener('click', function(){ step(1); });
  });
  fetch('/__deck-style-choices').then(function(r){ return r.json(); }).then(function(saved){
    switchers.forEach(function(switcher){
      var slideId = switcher.getAttribute('data-for');
      if (!Object.prototype.hasOwnProperty.call(saved, slideId)) return;
      var stack = stackFor(slideId);
      if (!stack) return;
      var idx = saved[slideId];
      apply(stack, idx);
      setLabel(switcher, idx, stack.querySelectorAll('.v2-variant-panel').length);
    });
  }).catch(function(){});
})();`;

export function buildDeckV2Html(
  slides: string,
  monthLabel: string,
  variantPreview = false,
  footerNote = "",
): string {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>العرض التنفيذي — ${esc(monthLabel)}</title>
<style>${ARABIC_FONT_FACE_CSS}${DECK_CSS}${DECK_V2_CSS}${SOURCE_REVISIONS_CSS}</style>
</head>
<body>
<nav class="deck-nav" id="deck-nav" aria-label="التنقّل بين أقسام العرض">
  <div class="deck-nav-brand">
    <span class="deck-nav-brand-icon">${icon("shield", 20)}</span>
    <span>العرض التنفيذي</span>
  </div>
  <div class="deck-nav-progress">
    <div class="deck-nav-progress-bar"><div class="deck-nav-progress-fill" id="deck-nav-fill"></div></div>
    <div class="deck-nav-progress-text" id="deck-nav-progress-text">الصفحة 1</div>
  </div>
  <ol class="deck-nav-sections" id="deck-nav-sections"></ol>
</nav>
<div class="deck-viewer deck-viewer-v2">
  <div class="deck-toolbar">
    <div class="deck-brand">
      <div class="brand-mark">${icon("shield", 22)}</div>
      <div>
        <strong>العرض التنفيذي</strong>
        <span>ضمان جودة الأشعة — ${esc(monthLabel)}</span>
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
      <button class="btn" onclick="window.print()" title="اختر «حفظ كـ PDF» من المتصفح عند الطباعة، وليس «Microsoft Print to PDF»، لضمان الحجم والجودة الصحيحين">طباعة / PDF</button>
    </div>
  </div>
${slides}
${footerNote}
</div>
<script>${DECK_NAV_SCRIPT}${variantPreview ? DECK_VARIANT_SCRIPT : ""}</script>
</body>
</html>`;
}

export function buildExecutiveDeckV2(
  input: ExecutiveReportInput,
  employeeDisplayNames: Record<string, string> = {},
  opts?: { variantPreview?: boolean },
): string {
  const variantPreview = opts?.variantPreview ?? false;
  const model = buildReportModel(input, employeeDisplayNames);
  const slides = buildDeckV2Slides(
    model,
    new Date(),
    variantPreview,
    input.sourceRevisions,
    input.monthFolderName,
  );
  return buildDeckV2Html(
    slides,
    formatMonthFolderShortLabel(input.monthFolderName),
    variantPreview,
    sourceRevisionsFooterHtml(input.sourceRevisions, esc),
  );
}

export function openExecutiveDeckV2(
  input: ExecutiveReportInput,
  employeeDisplayNames: Record<string, string> = {},
): void {
  openOrDownload(
    buildExecutiveDeckV2(input, employeeDisplayNames),
    `العرض_التنفيذي_${input.monthFolderName}.html`,
  );
}

