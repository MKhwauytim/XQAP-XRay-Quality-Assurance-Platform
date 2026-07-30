// Executive deck v2 entry points (content-first rework, 2026-07-04).
// Same contract as the v1 deck: one ReportModel drives everything, so the
// numbers can never disagree with the Document/Workbook editions.
// LIVE EDITION since 2026-07-14: the Reports tab's executive deck export calls
// openExecutiveDeckV2. The v1 deck (../deck) remains as the reference edition.

import { buildReportModel } from "../model/reportModel";
import { buildDeckV2Slides } from "./slides";
import { DECK_CSS } from "../deck/deckTheme";
import { DECK_V2_CSS } from "./theme";
import { setActiveStyleChoices } from "./slideKit";
// Section 3's pages each own their CSS in their own module; this is the single
// concatenation of all six, kept out of theme.ts so six parallel page authors
// never contend for one stylesheet. Placed after DECK_V2_CSS so a page can
// still override a shared component default where it deliberately needs to.
import { SECTION_THREE_CSS } from "./section3";
import { esc } from "../primitives";
import { icon } from "../ui/icons";
import { openReportWindow, writeOrCloseOnFailure } from "../../htmlReport";
import { SOURCE_REVISIONS_CSS, sourceRevisionsFooterHtml } from "../../sourceRevisions";
import { ARABIC_FONT_FACE_CSS } from "../../../../branding/fonts";
import type { ExecutiveReportInput } from "../../executiveReportTypes";
import { formatMonthFolderShortLabel } from "../../../population/monthFolder";
import { getLabels } from "../../../labels/labelsStore";

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
 * Pins each land/sea/stage table's الإجمالي totals row flush to the bottom
 * of its (fixed-height) card, for any row count. `fillerRow()` in slides.ts
 * inserts an empty `tr.v2-fill-row` between a table's data rows and its
 * totals row but leaves its height at 0 (CSS can't know the leftover pixels
 * — row height differs by mode/compact/sample-mode, see slides.ts's
 * `fillerRow` doc comment); this script measures the leftover live and
 * stretches the filler to match, the same "measure, don't estimate" approach
 * the row-height tuning elsewhere in this deck already uses.
 *
 * The measurement is a self-correcting DELTA — "how far is tfoot's bottom
 * from the card's inner bottom edge, add that to whatever the filler is
 * already at" — rather than an absolute `card − header − table` subtraction.
 * The subtraction form silently misses every box-model contributor that
 * isn't one of those three rects (card padding, the head's margin-bottom,
 * border widths) and lands tens of pixels off; a delta needs no model of the
 * box at all, converges in one pass, and stays correct on re-runs where the
 * filler is already non-zero. Two passes absorb any reflow-order coupling
 * between sibling cards in the same grid row.
 *
 * Runs on load, on resize/fullscreen (the card's own
 * height can change), and is re-invoked by DECK_VARIANT_SCRIPT's `apply()`
 * below whenever a dev-preview variant panel is switched in — a
 * newly-activated panel was `display:none` (zero-height) during the initial
 * pass, so its fillers need their own measurement once visible.
 */
const DECK_TABLE_FILL_SCRIPT = `(function(){
  function fillCards(){
    var cards = document.querySelectorAll('.v2-port-col, .v2-stage-port-card');
    for (var pass = 0; pass < 2; pass++){
      for (var i = 0; i < cards.length; i++){
        var card = cards[i];
        var fillTd = card.querySelector('tr.v2-fill-row td');
        var tfoot = card.querySelector('tfoot');
        if (!fillTd || !tfoot) continue;
        var cs = getComputedStyle(card);
        var innerBottom = card.getBoundingClientRect().bottom
          - parseFloat(cs.paddingBottom) - parseFloat(cs.borderBottomWidth);
        var next = (parseFloat(fillTd.style.height) || 0)
          + (innerBottom - tfoot.getBoundingClientRect().bottom);
        fillTd.style.height = (next > 0 ? next : 0) + 'px';
      }
    }
  }
  window.__deckFillCards = fillCards;
  fillCards();
  // Re-measure after the initial pass — verified live, twice over, that ONE
  // fix point is not enough:
  //   1. document.fonts.ready alone: still measured a stale (too-short) row
  //      height even though document.fonts.status read "loaded" by the time
  //      the callback ran — the FontFaceSet resolving is not the same event
  //      as the browser finishing the reflow that swapping the font triggers.
  //   2. A later manual re-run always corrected it, confirming fillCards()
  //      itself is right and this is purely a "ran before layout settled"
  //      timing gap, not a logic bug.
  // So this re-measures on three independent, cheap signals instead of
  // trusting any single one: fonts.ready (as an early attempt), window
  // 'load' (images/subresources finished, layout is as settled as a page
  // load gets), and a double-rAF (two full paint cycles after 'load', to
  // clear whatever reflow was still pending when 'load' fired). Re-running
  // fillCards() an extra time when nothing actually shifted is a no-op — the
  // delta it computes is 0 — so there is no real cost to checking more than
  // once.
  var refire = function(){ fillCards(); };
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(refire);
  window.addEventListener('load', function(){
    refire();
    requestAnimationFrame(function(){ requestAnimationFrame(refire); });
  });
  // Bounded polling safety net on top of the event-based re-fires above.
  // Verified live (twice) that a single "the page is ready" signal is not
  // reliable enough — even document.fonts.ready firing, plus a post-load
  // double-rAF, still measured a stale height on at least one real reload.
  // Rather than keep guessing at which ONE event is the true "layout has
  // settled" moment, poll on a plain interval for a few seconds after load
  // and let the polling itself be the guarantee: whatever the actual cause of
  // a delayed reflow is (font swap, image decode, a slow device, something
  // this list didn't anticipate), it will be caught within one poll tick.
  // Each tick is O(cards) and a no-op when nothing has shifted (the delta
  // fillCards() computes is 0), so polling for a few seconds costs nothing
  // measurable even on a large deck.
  var pollTicks = 0;
  var pollId = setInterval(function(){
    fillCards();
    pollTicks += 1;
    if (pollTicks >= 20) clearInterval(pollId); // ~3s at 150ms/tick, then stop
  }, 150);
  window.addEventListener('resize', fillCards);
  document.addEventListener('fullscreenchange', fillCards);
  document.addEventListener('webkitfullscreenchange', fillCards);
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
    if (window.__deckFillCards) window.__deckFillCards();
  }
  function setLabel(switcher, index, total){
    var label = switcher.querySelector('.v2-variant-label');
    if (label) label.textContent = (index + 1) + ' / ' + total;
  }
  // Mirrors slideKit.ts's familyKeyOf() — strips a trailing page-number
  // suffix so a saved choice survives the deck's page count changing month
  // to month (see docs/superpowers/specs/2026-07-25-deck2-design-systems-design.md
  // §3). A no-op for non-paginated slide ids.
  function familyKeyOf(slideId){
    return slideId.replace(/-\\d+$/, '');
  }
  function persist(slideId, index){
    var key = familyKeyOf(slideId);
    // Dev-tool persistence (Vite middleware, harmless 404 in the real app).
    fetch('/__deck-style-choices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slideId: key, variantIndex: index })
    }).catch(function(){});
    // In-app admin customizer bridge: this script only ever runs inside a
    // variantPreview=true document, which is always embedded (the dev tool's
    // own iframe, or the in-app customizer's iframe) — never the standalone
    // opened/downloaded report, which is never in variantPreview mode. A
    // parentless top-level window would just message itself here, which is
    // harmless (nothing listens).
    window.parent.postMessage({ type: 'deck2-style-choice', slideId: key, variantIndex: index }, '*');
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

/** Full-screen presentation control for the exported, self-contained HTML. */
const DECK_FULLSCREEN_SCRIPT = `(function(){
  var button = document.getElementById('deck-fullscreen-button');
  if (!button) return;
  var root = document.documentElement;
  var request = root.requestFullscreen || root.webkitRequestFullscreen;
  var exit = document.exitFullscreen || document.webkitExitFullscreen;
  function current(){ return document.fullscreenElement || document.webkitFullscreenElement; }
  function disable(){
    document.body.classList.remove('deck-fullscreen');
    button.hidden = true;
  }
  if (typeof request !== 'function' || typeof exit !== 'function') { disable(); return; }

  var slides = Array.prototype.slice.call(document.querySelectorAll('.slide'));
  var activeIndex = 0;
  var everActivated = false;
  var prevBtn = document.getElementById('deck-slide-prev');
  var nextBtn = document.getElementById('deck-slide-next');
  var counter = document.getElementById('deck-slide-counter');
  var hideTimer = null;

  function showControls(){
    document.body.classList.add('deck-controls-visible');
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(function(){ document.body.classList.remove('deck-controls-visible'); }, 2500);
  }

  function renderSlide(){
    for (var i = 0; i < slides.length; i++) {
      slides[i].classList.toggle('deck-slide-active', i === activeIndex);
    }
    if (counter) counter.textContent = (activeIndex + 1) + ' / ' + slides.length;
    if (prevBtn) prevBtn.disabled = activeIndex === 0;
    if (nextBtn) nextBtn.disabled = activeIndex === slides.length - 1;
  }

  function goTo(index){
    if (index < 0 || index >= slides.length || index === activeIndex) return;
    activeIndex = index;
    renderSlide();
  }

  function sync(){
    var active = Boolean(current());
    var label = button.getAttribute(active ? 'data-exit-label' : 'data-enter-label');
    if (active) {
      var thresholdY = window.innerHeight * 0.35;
      var idx = 0;
      for (var i = 0; i < slides.length; i++) {
        if (slides[i].getBoundingClientRect().top <= thresholdY) idx = i; else break;
      }
      activeIndex = idx;
      everActivated = true;
    }
    document.body.classList.toggle('deck-fullscreen', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
    button.setAttribute('aria-label', label);
    button.setAttribute('title', label);
    if (active) {
      button.blur();
      renderSlide();
      showControls();
    } else {
      document.body.classList.remove('deck-controls-visible');
      if (hideTimer) clearTimeout(hideTimer);
      if (everActivated) {
        var el = slides[activeIndex];
        if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start' });
      }
    }
  }

  button.addEventListener('click', function(){
    var action;
    try { action = current() ? exit.call(document) : request.call(root); }
    catch (_) { disable(); return; }
    if (action && typeof action.catch === 'function') action.catch(disable);
  });
  document.addEventListener('fullscreenchange', sync);
  document.addEventListener('webkitfullscreenchange', sync);
  document.addEventListener('fullscreenerror', disable);
  document.addEventListener('webkitfullscreenerror', disable);

  if (prevBtn) prevBtn.addEventListener('click', function(e){ e.stopPropagation(); goTo(activeIndex - 1); showControls(); });
  if (nextBtn) nextBtn.addEventListener('click', function(e){ e.stopPropagation(); goTo(activeIndex + 1); showControls(); });

  document.addEventListener('keydown', function(e){
    if (!current()) return;
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); goTo(activeIndex - 1); showControls(); }
    else if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); goTo(activeIndex + 1); showControls(); }
  });

  document.addEventListener('click', function(e){
    if (!current()) return;
    if (e.target.closest('.btn-slide-nav, .deck-slide-counter, #deck-fullscreen-button, .slide-controls')) return;
    goTo(activeIndex + 1);
    showControls();
  });

  document.addEventListener('mousemove', function(){ if (current()) showControls(); });

  sync();
})();`;

export function buildDeckV2Html(
  slides: string,
  monthLabel: string,
  variantPreview = false,
  footerNote = "",
): string {
  const labels = getLabels();
  const fullscreenEnter = esc(labels.exec_deck_fullscreen_enter);
  const fullscreenExit = esc(labels.exec_deck_fullscreen_exit);
  const slidePrevLabel = esc(labels.exec_deck_slideshow_prev);
  const slideNextLabel = esc(labels.exec_deck_slideshow_next);
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>العرض التنفيذي — ${esc(monthLabel)}</title>
<style>${ARABIC_FONT_FACE_CSS}${DECK_CSS}${DECK_V2_CSS}${SECTION_THREE_CSS}${SOURCE_REVISIONS_CSS}</style>
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
      <button class="btn btn-fullscreen" id="deck-fullscreen-button" type="button" aria-pressed="false" aria-label="${fullscreenEnter}" title="${fullscreenEnter}" data-enter-label="${fullscreenEnter}" data-exit-label="${fullscreenExit}"><span class="btn-fullscreen-icon btn-fullscreen-icon-expand">${icon("expand", 15)}</span><span class="btn-fullscreen-icon btn-fullscreen-icon-compress">${icon("compress", 15)}</span></button>
      <button class="btn" onclick="window.print()" title="اختر «حفظ كـ PDF» من المتصفح عند الطباعة، وليس «Microsoft Print to PDF»، لضمان الحجم والجودة الصحيحين">طباعة / PDF</button>
    </div>
  </div>
${slides}
${footerNote}
</div>
<button type="button" class="btn-slide-nav btn-slide-prev" id="deck-slide-prev" aria-label="${slidePrevLabel}" title="${slidePrevLabel}">${icon("arrow", 20)}</button>
<button type="button" class="btn-slide-nav btn-slide-next" id="deck-slide-next" aria-label="${slideNextLabel}" title="${slideNextLabel}">${icon("arrow", 20)}</button>
<span class="deck-slide-counter" id="deck-slide-counter" dir="ltr"></span>
<script>${DECK_NAV_SCRIPT}${DECK_TABLE_FILL_SCRIPT}${DECK_FULLSCREEN_SCRIPT}${variantPreview ? DECK_VARIANT_SCRIPT : ""}</script>
</body>
</html>`;
}

/**
 * Reentrancy guard (P3-7). `buildDeckV2Slides` is now chunked with
 * `await yieldToMain()` breaks, so a build can yield the event loop mid-
 * render. `activeStyleChoices` in `slideKit.ts` is a single MODULE-LEVEL
 * variable, set once at the top of a build and read by every slide's
 * `renderVariants()` call throughout that build (see `setActiveStyleChoices`'s
 * own doc comment there) — its previous "reports are always built
 * synchronously in one JS turn, so no cross-call interference is possible"
 * invariant no longer holds once yields are in the mix: a second concurrent
 * `buildExecutiveDeckV2` call (e.g. a double-click, or two report flows
 * overlapping) could start while a first call is paused at a yield, call
 * `setActiveStyleChoices` with ITS OWN choices, and corrupt the first call's
 * remaining slides with the wrong style choices once it resumes.
 *
 * `deckBuildQueue` serializes concurrent callers so at most one build's
 * style-choice window is ever open at a time — the same "one promise chain
 * per resource, gate-based" idiom `withFallbackLock` in
 * `src/data/storage/webLocks.ts` already uses for cross-tab/cross-call
 * serialization, adapted here to a single implicit in-module resource (this
 * function has exactly one thing to serialize, so no resource-name `Map` is
 * needed). A second caller queues behind the first and only starts its own
 * `setActiveStyleChoices` once the first call's `finally` has reset it to
 * `null` and released the gate — verified by
 * `deck2.test.ts`'s "concurrent-call reentrancy guard" test, which fires two
 * overlapping builds with DIFFERENT `styleChoices` and asserts each call's
 * output reflects only its own choice.
 */
let deckBuildQueue: Promise<unknown> = Promise.resolve();

async function withDeckBuildLock<T>(callback: () => Promise<T>): Promise<T> {
  const previous = deckBuildQueue;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const next = previous.then(() => gate);
  deckBuildQueue = next;

  await previous.catch(() => undefined);
  try {
    return await callback();
  } finally {
    release();
    // Drop the queue back to a fresh resolved promise once no one is queued
    // behind us, mirroring `withFallbackLock`'s own map-entry cleanup.
    if (deckBuildQueue === next) {
      deckBuildQueue = Promise.resolve();
    }
  }
}

export async function buildExecutiveDeckV2(
  input: ExecutiveReportInput,
  employeeDisplayNames: Record<string, string> = {},
  opts?: { variantPreview?: boolean; styleChoices?: Record<string, number> },
): Promise<string> {
  return withDeckBuildLock(async () => {
    const variantPreview = opts?.variantPreview ?? false;
    setActiveStyleChoices(opts?.styleChoices ?? null);
    try {
      const model = buildReportModel(input, employeeDisplayNames);
      const slides = await buildDeckV2Slides(
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
    } finally {
      setActiveStyleChoices(null);
    }
  });
}

/**
 * Opens the target tab synchronously (still inside the click's user gesture,
 * P3-7) BEFORE the now-chunked `buildExecutiveDeckV2` build runs, then writes
 * the finished HTML in once ready — same pattern as `openSampleReport`/
 * `openDistributionDocument`/`openManagementDeck`/`openExecutiveReport`.
 * `writeOrCloseOnFailure` closes the already-opened tab instead of
 * abandoning it blank if the build throws (see its doc comment in
 * htmlReport.ts).
 */
export async function openExecutiveDeckV2(
  input: ExecutiveReportInput,
  employeeDisplayNames: Record<string, string> = {},
  styleChoices?: Record<string, number>,
): Promise<void> {
  const reportWindow = openReportWindow();
  await writeOrCloseOnFailure(
    reportWindow,
    () => buildExecutiveDeckV2(input, employeeDisplayNames, { styleChoices }),
    `العرض_التنفيذي_${input.monthFolderName}.html`,
  );
}

