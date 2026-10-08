// Deck2 in-report text editing (static wording only).
//
// A static string is made editable by stamping `data-edit="<default text>"` on
// the element whose whole text content it is (`editAttr`). The default text is
// the override key, so a saved preset survives the page count / month changing
// and one edit applies to every identical string in the deck.
//
// App-managed content is never editable: any text containing a digit (counts,
// percentages, dates, page numbers, period ids) is treated as data and locked,
// and data-bound cells / chart values are simply never marked.
//
// The default deck is unchanged until the viewer opens a preset: overrides are
// embedded as JSON and applied by TEXT_EDIT_SCRIPT on load. The opened report
// tab has no `opener` (see htmlReport.openReportWindow), so "save as preset"
// talks to the app tab over a same-origin BroadcastChannel.
import { esc } from "../primitives";

export const TEXT_PRESET_CHANNEL = "xray-deck2-text-presets";

export type TextOverrides = Record<string, string>;

/** Digits in any script (Latin, Arabic-Indic, Extended Arabic-Indic). */
const DIGIT_RE = /[0-9٠-٩۰-۹]/;

/** True when `text` is plain wording the viewer may rewrite. */
export function isEditableText(text: string): boolean {
  return text.trim().length > 0 && !DIGIT_RE.test(text);
}

/** ` data-edit="…"` for an editable static string, `""` for locked text. */
export function editAttr(text: string): string {
  return isEditableText(text) ? ` data-edit="${esc(text).replace(/\n/g, "&#10;")}"` : "";
}

/** Keeps only well-formed overrides for strings that are editable. */
export function sanitizeOverrides(raw: unknown): TextOverrides {
  const out: TextOverrides = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== "string") continue;
    const next = value.trim();
    if (!isEditableText(key) || !isEditableText(next) || next === key) continue;
    out[key] = next.slice(0, 600);
  }
  return out;
}

export const TEXT_EDIT_CSS = `
.te-bar{display:inline-flex;align-items:center;gap:6px;}
.te-bar .btn{white-space:nowrap;}
.te-bar .te-more{display:none;gap:6px;}
body.te-on .te-bar .te-more{display:inline-flex;}
body.te-on [data-edit]{outline:1.5px dashed rgba(201,162,74,.85);outline-offset:3px;cursor:text;}
body.te-on [data-edit]:focus{outline:2px solid var(--gold,#c9a24a);background:rgba(201,162,74,.12);}
.te-toast{position:fixed;bottom:18px;left:50%;transform:translateX(-50%);z-index:9999;padding:8px 16px;border-radius:8px;background:#122;color:#fff;font-size:.85rem;box-shadow:0 4px 18px rgba(0,0,0,.35);}
@media print{
  .te-bar,.te-toast{display:none!important;}
  body.te-on [data-edit]{outline:none!important;background:none!important;}
}
`;

export function textEditBarHtml(presetName: string): string {
  return `<span class="te-bar" id="te-bar" data-preset="${esc(presetName)}">
      <button class="btn" type="button" id="te-toggle" aria-pressed="false" title="تعديل النصوص الثابتة فقط — الأرقام والبيانات مقفلة">تحرير النص</button>
      <span class="te-more">
        <button class="btn" type="button" id="te-save">حفظ كإعداد مسبق</button>
        <button class="btn" type="button" id="te-reset">استعادة الأصل</button>
      </span>
    </span>`;
}

/** Embeds the active preset's overrides; `<` escaped so the JSON can't close the tag. */
export function textOverridesJson(overrides: TextOverrides): string {
  const json = JSON.stringify(sanitizeOverrides(overrides)).replace(/</g, "\\u003c");
  return `<script type="application/json" id="deck-text-overrides">${json}</script>`;
}

export const TEXT_EDIT_SCRIPT = `(function(){
  var CHANNEL = '${TEXT_PRESET_CHANNEL}';
  var DIGITS = /[0-9\\u0660-\\u0669\\u06F0-\\u06F9]/;
  var els = Array.prototype.slice.call(document.querySelectorAll('[data-edit]'));
  var toggle = document.getElementById('te-toggle');
  var bar = document.getElementById('te-bar');
  var overrides = {};
  try {
    var node = document.getElementById('deck-text-overrides');
    if (node) overrides = JSON.parse(node.textContent || '{}') || {};
  } catch (e) {}
  function setText(el, text){
    while (el.firstChild) el.removeChild(el.firstChild);
    String(text).split('\\n').forEach(function(part, i){
      if (i) el.appendChild(document.createElement('br'));
      el.appendChild(document.createTextNode(part));
    });
  }
  function readText(el){
    return (el.innerText || el.textContent || '').replace(/\\u00a0/g, ' ').replace(/\\r/g, '').trim();
  }
  function applyAll(map){
    els.forEach(function(el){
      var key = el.getAttribute('data-edit');
      setText(el, Object.prototype.hasOwnProperty.call(map, key) ? map[key] : key);
    });
  }
  applyAll(overrides);
  if (!toggle || !bar) return;

  function toast(msg){
    var t = document.createElement('div');
    t.className = 'te-toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function(){ if (t.parentNode) t.parentNode.removeChild(t); }, 3200);
  }
  function collect(){
    var out = {};
    els.forEach(function(el){
      var key = el.getAttribute('data-edit');
      var now = readText(el);
      if (now && now !== key && !DIGITS.test(now)) out[key] = now;
    });
    return out;
  }
  function setEditing(on){
    document.body.classList.toggle('te-on', on);
    toggle.setAttribute('aria-pressed', on ? 'true' : 'false');
    els.forEach(function(el){
      if (on) el.setAttribute('contenteditable', 'plaintext-only');
      else el.removeAttribute('contenteditable');
    });
  }
  // One edit applies to every identical string in the deck.
  els.forEach(function(el){
    el.addEventListener('blur', function(){
      var key = el.getAttribute('data-edit');
      var now = readText(el);
      if (!now || DIGITS.test(now)) { setText(el, overrides[key] || key); return; }
      els.forEach(function(other){
        if (other !== el && other.getAttribute('data-edit') === key) setText(other, now);
      });
    });
    el.addEventListener('keydown', function(e){ if (e.key === 'Escape') el.blur(); });
  });
  toggle.addEventListener('click', function(){ setEditing(!document.body.classList.contains('te-on')); });

  var reset = document.getElementById('te-reset');
  if (reset) reset.addEventListener('click', function(){ applyAll({}); });

  function downloadPreset(name, map){
    var blob = new Blob([JSON.stringify({ name: name, overrides: map }, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'deck-text-preset-' + name + '.json';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  }
  var save = document.getElementById('te-save');
  if (save) save.addEventListener('click', function(){
    var map = collect();
    if (!Object.keys(map).length) { toast('لا توجد تعديلات للحفظ'); return; }
    var name = (window.prompt('اسم الإعداد المسبق:', bar.getAttribute('data-preset') || '') || '').trim();
    if (!name) return;
    var done = false;
    var ch = null;
    try { ch = new BroadcastChannel(CHANNEL); } catch (e) {}
    function finish(msg){ if (done) return; done = true; if (ch) ch.close(); toast(msg); }
    if (!ch) { downloadPreset(name, map); finish('تعذّر الاتصال بالتطبيق — تم تنزيل الإعداد كملف'); return; }
    ch.onmessage = function(e){
      var d = e.data || {};
      if (d.type !== 'deck2-text-preset-result' || d.name !== name) return;
      if (d.ok) { bar.setAttribute('data-preset', name); finish('تم حفظ الإعداد «' + name + '»'); }
      else { downloadPreset(name, map); finish('تعذّر الحفظ في مساحة العمل: ' + (d.error || '') + ' — تم تنزيل الإعداد كملف'); }
    };
    ch.postMessage({ type: 'deck2-text-preset-save', name: name, overrides: map });
    setTimeout(function(){
      if (done) return;
      downloadPreset(name, map);
      finish('التطبيق غير متاح للحفظ — تم تنزيل الإعداد كملف');
    }, 2500);
  });
})();`;
