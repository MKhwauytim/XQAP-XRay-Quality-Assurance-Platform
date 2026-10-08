// In-viewer text editing for the executive deck (v3), plus the saved-template
// contract that lets an edit pass be re-applied to the next export.
//
// The deck is a self-contained HTML page, so editing runs inside it: a toolbar
// toggle makes every leaf text element contenteditable, «حفظ كقالب» collects
// the changed leaves and posts them back to the app window (which owns the
// workspace folder), and a template chosen at export time is embedded as JSON
// and applied by the same script on load.
//
// A template entry is keyed by POSITION (section · slide-within-section ·
// leaf-within-slide) and carries the ORIGINAL text it replaced. On apply the
// replacement happens only when the leaf still reads exactly that original, so
// a template saved against one month can never overwrite a different figure in
// another month's deck — stale entries are skipped, not forced.
import { esc } from "../primitives";
import { getLabels } from "../../../labels/labelsStore";

export const DECK_TEXT_TEMPLATE_MESSAGE = "xray-deck-template-save";
export const DECK_TEXT_TEMPLATE_REPLY = "xray-deck-template-saved";

export type DeckTextEntry = { from: string; to: string };
export type DeckTextEntries = Record<string, DeckTextEntry>;

export type DeckTextTemplate = {
  id: string;
  name: string;
  entries: DeckTextEntries;
  createdAt: string;
  createdBy: string;
};

/** Cap so a hostile/garbled message can't bloat the workspace file. */
export const MAX_TEMPLATE_ENTRIES = 2000;
export const MAX_TEMPLATE_TEXT_LENGTH = 2000;

/** Narrow an untrusted `postMessage` payload to well-formed entries. */
export function sanitizeEntries(raw: unknown): DeckTextEntries {
  const out: DeckTextEntries = {};
  if (!raw || typeof raw !== "object") return out;
  let count = 0;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (count >= MAX_TEMPLATE_ENTRIES) break;
    if (!/^[^|]{1,80}\|\d{1,4}\|\d{1,5}$/.test(key)) continue;
    if (!value || typeof value !== "object") continue;
    const { from, to } = value as Record<string, unknown>;
    if (typeof from !== "string" || typeof to !== "string") continue;
    if (from.length > MAX_TEMPLATE_TEXT_LENGTH || to.length > MAX_TEMPLATE_TEXT_LENGTH) continue;
    if (from === to) continue;
    out[key] = { from, to };
    count += 1;
  }
  return out;
}

/** JSON safe to inline in a `<script type="application/json">` element. */
export function inlineJson(value: unknown): string {
  const bs = String.fromCharCode(92);
  return JSON.stringify(value)
    .replace(/</g, bs + "u003c")
    .replace(new RegExp(String.fromCharCode(0x2028), "g"), bs + "u2028")
    .replace(new RegExp(String.fromCharCode(0x2029), "g"), bs + "u2029");
}

export const DECK_TEXT_EDIT_CSS = `
.ed-bar{display:inline-flex;align-items:center;gap:6px;}
.ed-bar .btn{white-space:nowrap;}
.ed-bar .btn[aria-pressed="true"]{background:var(--v3-gold,#b48a3c);color:#fff;}
body.deck-editing .slide.v3 [data-ed]{outline:1.5px dashed rgba(180,138,60,.75);outline-offset:3px;cursor:text;}
body.deck-editing .slide.v3 [data-ed]:focus{outline:2px solid var(--v3-gold,#b48a3c);background:rgba(180,138,60,.08);}
body.deck-editing .slide.v3 [data-ed-changed]{background:rgba(46,125,79,.1);}
.ed-toast{position:fixed;inset-block-end:24px;inset-inline:0;margin:auto;width:fit-content;max-width:90vw;background:#10304f;color:#fff;padding:10px 18px;border-radius:6px;font-size:.9rem;z-index:99;box-shadow:0 4px 14px rgba(0,0,0,.3);}
@media print{
  .ed-bar,.ed-toast{display:none!important;}
  body.deck-editing .slide.v3 [data-ed]{outline:none!important;background:none!important;}
}
`;

/** Toolbar fragment: edit toggle, save-as-template, reset. */
export function textEditBarHtml(): string {
  const l = getLabels();
  return `<span class="ed-bar" id="ed-bar">
      <button class="btn" type="button" id="ed-toggle" aria-pressed="false" title="${esc(l.deck_edit_toggle_title)}">${esc(l.deck_edit_toggle)}</button>
      <button class="btn" type="button" id="ed-save" hidden title="${esc(l.deck_edit_save_template_title)}">${esc(l.deck_edit_save_template)}</button>
      <button class="btn" type="button" id="ed-reset" hidden title="${esc(l.deck_edit_reset_title)}">${esc(l.deck_edit_reset)}</button>
    </span>`;
}

/** Inlined template + UI strings the script reads. */
export function textEditDataHtml(entries: DeckTextEntries | null): string {
  const l = getLabels();
  const strings = {
    namePrompt: l.deck_edit_name_prompt,
    nothing: l.deck_edit_nothing_changed,
    saved: l.deck_edit_saved,
    saveFailed: l.deck_edit_save_failed,
    downloaded: l.deck_edit_downloaded,
    resetDone: l.deck_edit_reset_done,
    applied: l.deck_edit_applied,
  };
  return `<script type="application/json" id="deck-text-template">${inlineJson(entries ?? {})}</script>
<script type="application/json" id="deck-text-strings">${inlineJson(strings)}</script>`;
}

export const DECK_TEXT_EDIT_SCRIPT = `(function(){
  var MSG = '${DECK_TEXT_TEMPLATE_MESSAGE}', REPLY = '${DECK_TEXT_TEMPLATE_REPLY}';
  function readJson(id){ try { return JSON.parse(document.getElementById(id).textContent || '{}'); } catch (e) { return {}; } }
  var entries = readJson('deck-text-template');
  var S = readJson('deck-text-strings');
  var slides = Array.prototype.slice.call(document.querySelectorAll('.slide.v3'));
  if (!slides.length) return;

  var leaves = [];
  var perSection = {};
  slides.forEach(function(slide){
    var sec = slide.getAttribute('data-section') || 'x';
    var idx = perSection[sec] = (sec in perSection ? perSection[sec] + 1 : 0);
    var n = 0;
    var all = slide.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.children.length) continue;
      if (el.closest('svg, script, style, button, label, input, select, textarea, .slide-controls, .v3-page-num')) continue;
      if (!el.textContent || !el.textContent.trim()) continue;
      var key = sec + '|' + idx + '|' + n++;
      el.setAttribute('data-ed', key);
      leaves.push({ el: el, key: key, orig: el.textContent });
    }
  });

  var applied = 0;
  leaves.forEach(function(l){
    var e = entries[l.key];
    if (e && e.from === l.orig && typeof e.to === 'string') { l.el.textContent = e.to; applied++; }
  });

  var toggle = document.getElementById('ed-toggle');
  var saveBtn = document.getElementById('ed-save');
  var resetBtn = document.getElementById('ed-reset');
  var editing = false;
  var toastTimer = null;
  function toast(text){
    var t = document.querySelector('.ed-toast');
    if (!t) { t = document.createElement('div'); t.className = 'ed-toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = text;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){ if (t.parentNode) t.parentNode.removeChild(t); }, 4000);
  }
  function changed(){ return leaves.filter(function(l){ return l.el.textContent !== l.orig; }); }
  function markChanged(l){ if (l.el.textContent !== l.orig) l.el.setAttribute('data-ed-changed', ''); else l.el.removeAttribute('data-ed-changed'); }

  leaves.forEach(function(l){
    l.el.addEventListener('input', function(){ markChanged(l); });
    l.el.addEventListener('keydown', function(e){
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); l.el.blur(); }
    }, true);
    l.el.addEventListener('paste', function(e){
      e.preventDefault();
      var text = (e.clipboardData || window.clipboardData).getData('text').replace(/\\s+/g, ' ');
      document.execCommand('insertText', false, text);
    });
    l.el.addEventListener('click', function(e){ if (editing) e.stopPropagation(); });
    markChanged(l);
  });

  function setEditing(on){
    editing = on;
    document.body.classList.toggle('deck-editing', on);
    leaves.forEach(function(l){
      if (on) l.el.setAttribute('contenteditable', 'true'); else l.el.removeAttribute('contenteditable');
    });
    if (toggle) toggle.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (saveBtn) saveBtn.hidden = !on;
    if (resetBtn) resetBtn.hidden = !on;
  }
  if (toggle) toggle.addEventListener('click', function(){ setEditing(!editing); });

  if (resetBtn) resetBtn.addEventListener('click', function(){
    leaves.forEach(function(l){ l.el.textContent = l.orig; markChanged(l); });
    toast(S.resetDone || '');
  });

  function collect(){
    var out = {};
    changed().forEach(function(l){ out[l.key] = { from: l.orig, to: l.el.textContent }; });
    return out;
  }

  window.addEventListener('message', function(e){
    var d = e.data;
    if (!d || d.type !== REPLY) return;
    toast(d.ok ? (S.saved || '') : (S.saveFailed || '') + (d.error ? ' — ' + d.error : ''));
  });

  if (saveBtn) saveBtn.addEventListener('click', function(){
    var out = collect();
    if (!Object.keys(out).length) { toast(S.nothing || ''); return; }
    var name = window.prompt(S.namePrompt || '');
    if (!name || !name.trim()) return;
    name = name.trim();
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({ type: MSG, name: name, entries: out }, '*');
      return;
    }
    var blob = new Blob([JSON.stringify({ name: name, entries: out }, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name + '.deck-template.json';
    document.body.appendChild(a); a.click(); a.remove();
    toast(S.downloaded || '');
  });

  if (applied > 0) toast((S.applied || '').replace('{n}', String(applied)));
})();`;
