// src/data/reporting/executive/printSelection.ts
//
// Per-page "include when printing" switches for the self-contained executive
// HTML decks (deck2 / deck3), plus a global select-all / select-none bar.
// Screen-only chrome; excluded pages are removed with `display:none` under
// `@media print`, so no blank sheet is left behind. Slide markup is NOT
// changed: slides that already carry a deck2 `.slide-print-toggle` keep it,
// the rest get one injected at load by the script. The selection is
// optionally persisted per report in localStorage (every access try/caught).
//
// Page numbers are baked into the slides at build time; while printing, the
// script renumbers the INCLUDED slides' "NN / total" counters (deck3's
// `.v3-page-num`) 1..N and restores the originals afterwards, so a printout
// with excluded pages has no gaps. (Contents-page ranges stay as built.)
import { getLabels } from "../../labels/labelsStore";
import { esc } from "./primitives";

export const PRINT_SELECT_CSS = `
.ps-bar{display:inline-flex;align-items:center;gap:6px;}
.ps-bar .btn{white-space:nowrap;}
.ps-count{font-size:.72rem;opacity:.75;white-space:nowrap;}
.slide.v3 .slide-controls{position:absolute;top:24px;left:28px;z-index:6;display:flex;transform:scale(2.2);transform-origin:top left;}
.slide.v3 .slide-print-toggle{display:flex;align-items:center;cursor:pointer;}
.slide.v3 .slide-print-toggle input{position:absolute;opacity:0;width:1px;height:1px;}
.slide.v3 .slide-print-toggle-track{display:block;width:34px;height:18px;border-radius:999px;background:rgba(128,128,128,.45);border:1px solid rgba(255,255,255,.3);position:relative;transition:background .15s ease;}
.slide.v3 .slide-print-toggle-thumb{display:block;position:absolute;top:1px;left:1px;width:14px;height:14px;border-radius:50%;background:#fff;transition:transform .15s ease;}
.slide.v3 .slide-print-toggle input:checked + .slide-print-toggle-track{background:var(--gold,var(--v3-gold,#c9a24a));border-color:var(--gold,var(--v3-gold,#c9a24a));}
.slide.v3 .slide-print-toggle input:checked + .slide-print-toggle-track .slide-print-toggle-thumb{transform:translateX(16px);}
.slide.v3 .slide-print-toggle input:focus-visible + .slide-print-toggle-track{outline:2px solid var(--gold,var(--v3-gold,#c9a24a));outline-offset:2px;}
body.deck-fullscreen .slide-controls{display:none!important;}
@media print{
  .ps-bar,.slide-controls{display:none!important;}
  .slide[data-print-off]{display:none!important;}
}
`;

export function printSelectBarHtml(): string {
  const l = getLabels();
  return `<span class="ps-bar" id="ps-bar" data-title="${esc(l.exec_print_include_page)}">
      <button class="btn" type="button" id="ps-all">${esc(l.exec_print_select_all)}</button>
      <button class="btn" type="button" id="ps-none">${esc(l.exec_print_select_none)}</button>
      <span class="ps-count" title="${esc(l.exec_print_selected_hint)}" dir="ltr" id="ps-count"></span>
    </span>`;
}

export const PRINT_SELECT_SCRIPT = `(function(){
  var slides = Array.prototype.slice.call(document.querySelectorAll('.slide'));
  if (!slides.length) return;
  var bar = document.getElementById('ps-bar');
  var title = bar ? bar.getAttribute('data-title') || '' : '';
  var key = 'xray_print_sel_v1:' + document.title + ':' + slides.length;
  var boxes = slides.map(function(slide){
    var box = slide.querySelector('.slide-print-toggle input');
    if (box) return box;
    var wrap = document.createElement('div');
    wrap.className = 'slide-controls';
    var label = document.createElement('label');
    label.className = 'slide-print-toggle';
    label.title = title;
    box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = true;
    var track = document.createElement('span');
    track.className = 'slide-print-toggle-track';
    var thumb = document.createElement('span');
    thumb.className = 'slide-print-toggle-thumb';
    track.appendChild(thumb);
    label.appendChild(box);
    label.appendChild(track);
    wrap.appendChild(label);
    slide.appendChild(wrap);
    return box;
  });
  function sync(){
    var on = 0;
    boxes.forEach(function(box, i){
      if (box.checked) { on++; slides[i].removeAttribute('data-print-off'); }
      else slides[i].setAttribute('data-print-off', '');
    });
    var count = document.getElementById('ps-count');
    if (count) count.textContent = on + ' / ' + boxes.length;
  }
  function save(){
    try {
      var offIdx = [];
      boxes.forEach(function(box, i){ if (!box.checked) offIdx.push(i); });
      if (offIdx.length) localStorage.setItem(key, JSON.stringify(offIdx));
      else localStorage.removeItem(key);
    } catch (e) {}
  }
  function setAll(value){
    boxes.forEach(function(box){ box.checked = value; });
    sync(); save();
  }
  try {
    var saved = JSON.parse(localStorage.getItem(key) || '[]');
    if (Array.isArray(saved)) saved.forEach(function(i){ if (boxes[i]) boxes[i].checked = false; });
  } catch (e) {}
  boxes.forEach(function(box){
    box.addEventListener('change', function(){ sync(); save(); });
  });
  var all = document.getElementById('ps-all');
  var none = document.getElementById('ps-none');
  if (all) all.addEventListener('click', function(){ setAll(true); });
  if (none) none.addEventListener('click', function(){ setAll(false); });
  // Printing: number the included slides consecutively (no gaps for toggled-off pages); restore afterwards.
  function renumber(){
    var included = slides.filter(function(s){ return !s.hasAttribute('data-print-off'); });
    included.forEach(function(s, i){
      var el = s.querySelector('.v3-page-num');
      if (!el) return;
      if (el.getAttribute('data-orig') === null) el.setAttribute('data-orig', el.textContent);
      var n = i + 1;
      el.textContent = (n < 10 ? '0' : '') + n + ' / ' + included.length;
    });
  }
  function restore(){
    slides.forEach(function(s){
      var el = s.querySelector('.v3-page-num');
      if (el && el.getAttribute('data-orig') !== null) { el.textContent = el.getAttribute('data-orig'); el.removeAttribute('data-orig'); }
    });
  }
  window.addEventListener('beforeprint', renumber);
  window.addEventListener('afterprint', restore);
  sync();
})();`;
