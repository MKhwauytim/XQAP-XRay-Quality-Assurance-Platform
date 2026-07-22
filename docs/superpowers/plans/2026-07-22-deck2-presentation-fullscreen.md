# Deck2 Icon Fullscreen + Slideshow Presentation Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the deck2 executive report's text "ملء الشاشة" fullscreen button with an icon-only expand/compress toggle, and turn fullscreen into a true one-slide-at-a-time presentation mode (keyboard + click navigation, fading on-screen controls).

**Architecture:** Pure vanilla CSS/JS inside the existing self-contained-HTML template strings (`theme.ts`/`index.ts`) — no new dependencies, no framework. `body.deck-fullscreen`'s CSS meaning changes from "scrollable stack, pinned toolbar" to "exactly one `.slide` visible, sized to fit the viewport"; `DECK_FULLSCREEN_SCRIPT` gains an active-slide-index tracker, keyboard/click navigation, and a mousemove-driven fade timer for the new chrome.

**Tech Stack:** TypeScript template-string HTML/CSS/JS generation, Vitest (`node` environment, string-assertion tests), existing `icon()` SVG helper.

## Global Constraints

- Arabic UI strings go through label keys (`labelsStore.ts` + `Settings/index.tsx` registration), never hard-coded, per this repo's CLAUDE.md.
- RTL layout (`dir="rtl"`) — keyboard next/prev follows the PowerPoint convention (Right/Space/PageDown = next, Left/PageUp = previous) regardless of content direction; on-screen arrow *positions* follow RTL visual flow instead (prev on the right, next on the left).
- Chromium-only app (File System Access API elsewhere; Fullscreen API here) — already confirmed live (`document.fullscreenEnabled === true`) in both the dev-preview iframe and top-level document, so no permissions-policy workaround is needed.
- No new npm dependencies.
- Per CLAUDE.md, record every edit in `docs/edit logs/2026-07-22.md` (version bump, before/after snippets, line-count stats via `npm run count-lines -- --quiet` before and after) **before** each commit, not just once at the end.
- The two existing fullscreen tests in `deck2.test.ts` (lines 109–132) must keep passing unchanged — they're the regression gate for the existing `aria-label`/`requestFullscreen`-fallback/print-hide contract.
- No slide-transition animation beyond an instant cut; no persistence of slideshow state across reopens (matches spec's non-goals).

Spec: `docs/superpowers/specs/2026-07-22-deck2-presentation-fullscreen-design.md`

---

## Task 1: Expand/compress icons

**Files:**
- Modify: `src/data/reporting/executive/ui/icons.ts:10-58` (PATHS object), `:82-97` (named exports)
- Test: `src/data/reporting/executive/ui/icons.test.ts`

**Interfaces:**
- Produces: `icon("expand", size)`, `icon("compress", size)`, named exports `expand(size?)`, `compress(size?)` — consumed by Task 3's button markup.

- [ ] **Step 1: Write the failing test**

Add to `src/data/reporting/executive/ui/icons.test.ts`, inside the existing `describe("icons", ...)` block (after the `"named exports return the same markup as the lookup"` test, before the closing `});` at line 83):

```ts
  it("includes expand/compress icons for the deck2 slideshow fullscreen control", () => {
    expect(ICON_NAMES).toContain("expand");
    expect(ICON_NAMES).toContain("compress");
    expect(expand()).toBe(icon("expand"));
    expect(compress()).toBe(icon("compress"));
  });
```

Update the import at the top of the file (line 2) to add the two new names:

```ts
import { icon, ICON_NAMES, shield, gauge, check, expand, compress } from "./icons";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/reporting/executive/ui/icons.test.ts`
Expected: FAIL — `expand`/`compress` are not exported from `./icons` (TS/import error surfaced as a test failure).

- [ ] **Step 3: Write minimal implementation**

In `src/data/reporting/executive/ui/icons.ts`, insert into the `PATHS` object, right before the closing `};` (currently line 58 — after the `moon:` entry):

```ts
  // Expand — fullscreen enter (four outward-pointing corner brackets)
  expand:
    '<path d="M9 4H4v5"/><path d="M15 4h5v5"/><path d="M4 15v5h5"/><path d="M20 15v5h-5"/>',
  // Compress — fullscreen exit (same four brackets, pointing inward)
  compress:
    '<path d="M4 9h5V4"/><path d="M20 9h-5V4"/><path d="M4 15h5v5"/><path d="M20 15h-5v5"/>',
```

Append after the last named export (currently line 97, `export const moon = ...`):

```ts
export const expand = (size?: number): string => icon("expand", size);
export const compress = (size?: number): string => icon("compress", size);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/data/reporting/executive/ui/icons.test.ts`
Expected: PASS (all tests in the file, including the pre-existing generic ones that iterate `ICON_NAMES` — they automatically cover `expand`/`compress` too).

- [ ] **Step 5: Edit log + commit**

```bash
npm run count-lines -- --quiet
```
Baseline already captured during planning (whole repo, before any of this plan's edits): **203598** lines. If other edits have landed in the working tree since, re-run `npm run count-lines -- --quiet` for a fresh before-count instead of reusing this number. After making the change above, run it again, then `git diff --stat` for the file breakdown. Append to `docs/edit logs/2026-07-22.md` (check its current last `## v` entry first — expected to be `v57.8` as of this plan; continue the sequence from whatever it actually is):

```markdown
## v57.9 — 2026-07-22 — Add: expand/compress icons for deck2 slideshow control

**File:** `src/data/reporting/executive/ui/icons.ts`

**Before:**
\`\`\`ts
  moon:
    '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"/>',
};
\`\`\`

**After:**
\`\`\`ts
  moon:
    '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"/>',
  // Expand — fullscreen enter (four outward-pointing corner brackets)
  expand:
    '<path d="M9 4H4v5"/><path d="M15 4h5v5"/><path d="M4 15v5h5"/><path d="M20 15v5h-5"/>',
  // Compress — fullscreen exit (same four brackets, pointing inward)
  compress:
    '<path d="M4 9h5V4"/><path d="M20 9h-5V4"/><path d="M4 15h5v5"/><path d="M20 15h-5v5"/>',
};
\`\`\`

**Lines:** {before} → {after} (net +N) · 2 files, +N / -0
```

```bash
git add src/data/reporting/executive/ui/icons.ts src/data/reporting/executive/ui/icons.test.ts "docs/edit logs/2026-07-22.md"
git commit -m "Add: expand/compress icons for deck2 slideshow control"
```

---

## Task 2: Single-slide presentation CSS

**Files:**
- Modify: `src/data/reporting/executive/deck2/theme.ts:33-58` (replace the `body.deck-fullscreen` block)
- Test: `src/data/reporting/executive/deck2/deck2.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1 (CSS references class names only, not icon content).
- Produces: CSS contract Task 3's markup/script must satisfy — `body.deck-fullscreen` (existing class, new meaning), `.deck-slide-active` (toggled per-slide by script), `#deck-slide-prev`/`#deck-slide-next`/`#deck-slide-counter` styled via `.btn-slide-nav`/`.btn-slide-prev`/`.btn-slide-next`/`.deck-slide-counter`, `body.deck-controls-visible` (fade-in toggle), `.btn-fullscreen-icon-expand`/`.btn-fullscreen-icon-compress` (icon-swap via `[aria-pressed]`).

- [ ] **Step 1: Write the failing test**

Add to `src/data/reporting/executive/deck2/deck2.test.ts`, inside `describe("buildExecutiveDeckV2 — production path (no opts)", ...)`, after the existing `"includes an accessible full-screen presentation control"` test (after line 119's closing `});`):

```ts
  it("replaces the fullscreen scroll-stack with single-slide presentation CSS", () => {
    const html = buildExecutiveDeckV2(input([popRow()]));
    expect(html).toContain("body.deck-fullscreen .slide{display:none;margin:0;}");
    expect(html).toContain("body.deck-fullscreen .slide.deck-slide-active{");
    expect(html).toContain(".btn-slide-nav,.deck-slide-counter{display:none;}");
    expect(html).toContain(".btn-fullscreen-icon-compress{display:none;}");
    expect(html).toMatch(
      /@media print\{[\s\S]*?\.btn-slide-nav,\.deck-slide-counter\{display:none!important;\}/,
    );
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/reporting/executive/deck2/deck2.test.ts`
Expected: FAIL — none of these selectors exist in the current CSS yet.

- [ ] **Step 3: Write minimal implementation**

In `src/data/reporting/executive/deck2/theme.ts`, replace lines 33–58 (from the `/* Full-screen review keeps...` comment through the closing of the `@media print{...}` block that hides `.btn-fullscreen`) with:

```css
/* ── Slideshow (single-slide) fullscreen mode ──────────────────────────────
   body.deck-fullscreen now means true one-slide-at-a-time presentation mode
   (DECK_FULLSCREEN_SCRIPT tracks the active index and toggles
   .deck-slide-active). Side-nav and toolbar chrome (brand/theme/print) are
   hidden outright; the fullscreen button and the prev/next/counter cluster
   fade in on mousemove and fade out after ~2.5s idle via
   body.deck-controls-visible, toggled by the same script. Escape always
   exits natively regardless of this state. */
body.deck-fullscreen{overflow:hidden;}
body.deck-fullscreen .deck-nav{display:none;}
body.deck-fullscreen .deck-viewer-v2{
  padding:0;display:flex;align-items:center;justify-content:center;height:100dvh;
}
body.deck-fullscreen .deck-toolbar{
  position:static;background:none;border:none;box-shadow:none;padding:0;margin:0;pointer-events:none;
}
body.deck-fullscreen .deck-toolbar>*{display:none;}
body.deck-fullscreen .deck-toolbar .btn-fullscreen{
  display:inline-flex;position:fixed;top:16px;inset-inline-end:16px;z-index:95;
  opacity:0;pointer-events:none;transition:opacity .25s ease;
}
body.deck-fullscreen.deck-controls-visible .deck-toolbar .btn-fullscreen{
  opacity:1;pointer-events:auto;
}
body.deck-fullscreen .slide{display:none;margin:0;}
body.deck-fullscreen .slide.deck-slide-active{
  display:flex;
  width:min(calc(100vw - 32px),calc((100dvh - 32px) * 297 / 167));
}
body.deck-fullscreen .srev-footer{display:none;}
body.theme-light .btn-fullscreen{color:#fff;}
.btn-fullscreen:focus-visible{outline:3px solid var(--gold);outline-offset:3px;}
.btn-fullscreen-icon-compress{display:none;}
.btn-fullscreen[aria-pressed="true"] .btn-fullscreen-icon-expand{display:none;}
.btn-fullscreen[aria-pressed="true"] .btn-fullscreen-icon-compress{display:inline-flex;}
.btn-slide-nav,.deck-slide-counter{display:none;}
body.deck-fullscreen .btn-slide-nav{
  display:flex;position:fixed;top:50%;transform:translateY(-50%);z-index:90;
  width:44px;height:44px;border-radius:50%;align-items:center;justify-content:center;
  background:rgba(2,16,30,.55);border:1px solid rgba(255,255,255,.25);color:#fff;cursor:pointer;
  opacity:0;pointer-events:none;transition:opacity .25s ease;
}
body.deck-fullscreen .btn-slide-nav:disabled{cursor:default;}
body.deck-fullscreen .btn-slide-prev{inset-inline-start:20px;}
body.deck-fullscreen .btn-slide-next{inset-inline-end:20px;}
body.deck-fullscreen .btn-slide-prev svg{transform:scaleX(-1);}
body.deck-fullscreen .deck-slide-counter{
  display:block;position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:90;
  font-size:.78rem;font-weight:700;color:#fff;background:rgba(2,16,30,.55);
  padding:4px 12px;border-radius:999px;font-variant-numeric:tabular-nums;
  opacity:0;pointer-events:none;transition:opacity .25s ease;
}
body.deck-fullscreen.deck-controls-visible .btn-slide-nav:not(:disabled),
body.deck-fullscreen.deck-controls-visible .deck-slide-counter{
  opacity:1;pointer-events:auto;
}
@media screen and (min-width:1281px){
  .deck-viewer-v2{padding-inline-start:calc(236px + 16px);}
}
@media screen and (max-width:1280px){
  .deck-nav{display:none;}
}
@media print{
  .deck-nav{display:none!important;}
  .btn-fullscreen{display:none!important;}
  .btn-slide-nav,.deck-slide-counter{display:none!important;}
}
```

This removes the old `width:min(calc(100vw - 32px),calc((100dvh - 94px) * 297 / 167))` / `scroll-snap-*` / toolbar-pin rules entirely — same class name (`deck-fullscreen`), new ruleset, no dead CSS left behind. The `@media screen`/`@media print` blocks that follow (originally lines 49–58) are folded into this same replacement since they're part of the same contiguous block being rewritten.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/data/reporting/executive/deck2/deck2.test.ts`
Expected: PASS — both the new test and all pre-existing tests in the file (the two original fullscreen tests still assert against markup/script this task doesn't touch, and the print-hide regex still matches since `.btn-fullscreen{display:none!important;}` is preserved verbatim inside `@media print{...}`).

- [ ] **Step 5: Edit log + commit**

```bash
npm run count-lines -- --quiet
```
Same before/after + `git diff --stat` process as Task 1. Append to `docs/edit logs/2026-07-22.md`:

```markdown
## v57.10 — 2026-07-22 — Change: fullscreen CSS from scroll-stack to single-slide layout

**File:** `src/data/reporting/executive/deck2/theme.ts`

**Before:**
\`\`\`css
body.deck-fullscreen{overflow-y:auto;scroll-snap-type:y mandatory;}
body.deck-fullscreen .deck-nav{display:none;}
body.deck-fullscreen .deck-viewer-v2{padding:78px 16px 16px;}
body.deck-fullscreen .deck-toolbar{
  position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:80;
  width:min(1120px,calc(100vw - 32px));margin:0;padding:9px 14px;
}
body.deck-fullscreen .slide{
  width:min(calc(100vw - 32px),calc((100dvh - 94px) * 297 / 167));
  margin:0 auto 18px;scroll-snap-align:start;scroll-snap-stop:always;
}
body.deck-fullscreen .srev-footer{display:none;}
body.theme-light .btn-fullscreen{color:#fff;}
.btn-fullscreen:focus-visible{outline:3px solid var(--gold);outline-offset:3px;}
@media screen and (min-width:1281px){
  .deck-viewer-v2{padding-inline-start:calc(236px + 16px);}
}
@media screen and (max-width:1280px){
  .deck-nav{display:none;}
}
@media print{
  .deck-nav{display:none!important;}
  .btn-fullscreen{display:none!important;}
}
\`\`\`

**After:** (full replacement block — see Step 3 above)

**Lines:** {before} → {after} (net +N) · 2 files, +N / -M
```

```bash
git add src/data/reporting/executive/deck2/theme.ts src/data/reporting/executive/deck2/deck2.test.ts "docs/edit logs/2026-07-22.md"
git commit -m "Change: fullscreen CSS from scroll-stack to single-slide presentation layout"
```

---

## Task 3: Icon button, slideshow navigation script, and labels

**Files:**
- Modify: `src/data/reporting/executive/deck2/index.ts:130-218` (`DECK_FULLSCREEN_SCRIPT`, button markup, new nav elements)
- Modify: `src/data/labels/labelsStore.ts:195-196` (two new label keys)
- Modify: `src/components/Sidebar/Tabs/Settings/index.tsx:200-201` (register the two new keys)
- Test: `src/data/reporting/executive/deck2/deck2.test.ts`

**Interfaces:**
- Consumes: `icon("expand", size)` / `icon("compress", size)` (Task 1); CSS classes `.btn-fullscreen-icon-expand`/`.btn-fullscreen-icon-compress`/`.btn-slide-nav`/`.btn-slide-prev`/`.btn-slide-next`/`.deck-slide-counter`/`.deck-slide-active`/`body.deck-controls-visible` (Task 2); `labels.exec_deck_slideshow_prev`/`labels.exec_deck_slideshow_next` (this task's own labelsStore.ts addition — `LabelKey` is `keyof typeof DEFAULT_LABELS`, derived automatically, no separate type edit needed).
- Produces: DOM ids `deck-slide-prev`/`deck-slide-next`/`deck-slide-counter` and the `deck-slide-active` class-toggle contract Task 2's CSS depends on.

- [ ] **Step 1: Add the two label keys**

In `src/data/labels/labelsStore.ts`, after line 196 (`exec_deck_fullscreen_exit:  "إنهاء ملء الشاشة",`):

```ts
  exec_deck_fullscreen_enter: "ملء الشاشة",
  exec_deck_fullscreen_exit:  "إنهاء ملء الشاشة",
  exec_deck_slideshow_prev:   "الشريحة السابقة",
  exec_deck_slideshow_next:   "الشريحة التالية",
```

- [ ] **Step 2: Register the two keys in the Settings admin label-override list**

In `src/components/Sidebar/Tabs/Settings/index.tsx`, after line 201 (`{ key: "exec_deck_fullscreen_exit",  desc: "زر إنهاء عرض ملء الشاشة" },`):

```tsx
      { key: "exec_deck_fullscreen_enter", desc: "زر فتح العرض بملء الشاشة" },
      { key: "exec_deck_fullscreen_exit",  desc: "زر إنهاء عرض ملء الشاشة" },
      { key: "exec_deck_slideshow_prev",   desc: "زر الشريحة السابقة في العرض التقديمي" },
      { key: "exec_deck_slideshow_next",   desc: "زر الشريحة التالية في العرض التقديمي" },
```

- [ ] **Step 3: Write the failing tests**

Add to `src/data/reporting/executive/deck2/deck2.test.ts`, after the test added in Task 2:

```ts
  it("uses an icon-only expand/compress fullscreen button instead of a text label", () => {
    const html = buildExecutiveDeckV2(input([popRow()]));
    expect(html).toContain('class="btn-fullscreen-icon btn-fullscreen-icon-expand"');
    expect(html).toContain('class="btn-fullscreen-icon btn-fullscreen-icon-compress"');
    expect(html).not.toContain(">ملء الشاشة</button>");
  });

  it("renders single-slide presentation navigation elements and script", () => {
    const html = buildExecutiveDeckV2(input([popRow()]));
    expect(html).toContain('id="deck-slide-prev"');
    expect(html).toContain('id="deck-slide-next"');
    expect(html).toContain('id="deck-slide-counter"');
    expect(html).toContain("var slides = Array.prototype.slice.call(document.querySelectorAll('.slide'))");
    expect(html).toContain("classList.toggle('deck-slide-active'");
    expect(html).toContain("document.addEventListener('keydown'");
    expect(html).toContain("document.addEventListener('mousemove'");
    expect(html).toContain("e.key === 'ArrowLeft'");
    expect(html).toContain("e.key === 'ArrowRight'");
  });

  it("uses the configurable Arabic labels for the slide prev/next controls", () => {
    setLabel("exec_deck_slideshow_prev", "الشريحة السابقة (مخصص)");
    setLabel("exec_deck_slideshow_next", "الشريحة التالية (مخصص)");
    try {
      const html = buildExecutiveDeckV2(input([popRow()]));
      expect(html).toContain('aria-label="الشريحة السابقة (مخصص)"');
      expect(html).toContain('aria-label="الشريحة التالية (مخصص)"');
    } finally {
      resetLabel("exec_deck_slideshow_prev");
      resetLabel("exec_deck_slideshow_next");
    }
  });
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx vitest run src/data/reporting/executive/deck2/deck2.test.ts`
Expected: FAIL — button still renders as text, no `#deck-slide-prev`/`#deck-slide-next`/`#deck-slide-counter`, no keyboard handler.

- [ ] **Step 5: Rewrite `DECK_FULLSCREEN_SCRIPT` and the button markup**

In `src/data/reporting/executive/deck2/index.ts`, replace the entire `DECK_FULLSCREEN_SCRIPT` constant (lines 130–162) with:

```ts
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
    }
    document.body.classList.toggle('deck-fullscreen', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
    button.setAttribute('aria-label', label);
    button.setAttribute('title', label);
    if (active) {
      renderSlide();
      showControls();
    } else {
      document.body.classList.remove('deck-controls-visible');
      if (hideTimer) clearTimeout(hideTimer);
      var el = slides[activeIndex];
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start' });
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
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') { goTo(activeIndex - 1); showControls(); }
    else if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { goTo(activeIndex + 1); showControls(); }
  });

  document.addEventListener('click', function(e){
    if (!current()) return;
    if (e.target.closest('.btn-slide-nav, .deck-slide-counter, #deck-fullscreen-button')) return;
    goTo(activeIndex + 1);
    showControls();
  });

  document.addEventListener('mousemove', function(){ if (current()) showControls(); });

  sync();
})();\`;
```

Then, inside `buildDeckV2Html` (around line 170), add two more label consts next to the existing two:

```ts
  const labels = getLabels();
  const fullscreenEnter = esc(labels.exec_deck_fullscreen_enter);
  const fullscreenExit = esc(labels.exec_deck_fullscreen_exit);
  const slidePrevLabel = esc(labels.exec_deck_slideshow_prev);
  const slideNextLabel = esc(labels.exec_deck_slideshow_next);
```

Replace the button markup (currently line 211):

```ts
      <button class="btn btn-fullscreen" id="deck-fullscreen-button" type="button" aria-pressed="false" aria-label="${fullscreenEnter}" title="${fullscreenEnter}" data-enter-label="${fullscreenEnter}" data-exit-label="${fullscreenExit}"><span class="btn-fullscreen-icon btn-fullscreen-icon-expand">${icon("expand", 15)}</span><span class="btn-fullscreen-icon btn-fullscreen-icon-compress">${icon("compress", 15)}</span></button>
```

Replace the block after `.deck-viewer`'s closing `</div>` and before `<script>` (currently lines 216–218):

```ts
${slides}
${footerNote}
</div>
<button type="button" class="btn-slide-nav btn-slide-prev" id="deck-slide-prev" aria-label="${slidePrevLabel}" title="${slidePrevLabel}">${icon("arrow", 20)}</button>
<button type="button" class="btn-slide-nav btn-slide-next" id="deck-slide-next" aria-label="${slideNextLabel}" title="${slideNextLabel}">${icon("arrow", 20)}</button>
<span class="deck-slide-counter" id="deck-slide-counter"></span>
<script>${DECK_NAV_SCRIPT}${DECK_FULLSCREEN_SCRIPT}${variantPreview ? DECK_VARIANT_SCRIPT : ""}</script>
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/data/reporting/executive/deck2/deck2.test.ts`
Expected: PASS — all tests in the file, including the two original fullscreen tests (button still has `id="deck-fullscreen-button"`, `aria-label="ملء الشاشة"`, the `requestFullscreen`/`exitFullscreen` fallback chain, `button.hidden = true`, both `fullscreenchange`/`fullscreenerror` listeners, `aria-pressed="false"`, and the `@media print{...}.btn-fullscreen{display:none!important;}` rule — none of these were removed, only the `button.textContent = label;` line was, which nothing asserts on directly).

- [ ] **Step 7: Run the full test suite, typecheck, and lint**

```bash
npm run test:run
npm run typecheck
npm run lint
npm run check:complexity
```
Expected: all four pass. `check:complexity` is the one most likely to flag the expanded `DECK_FULLSCREEN_SCRIPT` — if it does, the fix is splitting it into more/smaller named functions (already mostly decomposed into `showControls`/`renderSlide`/`goTo`/`sync`), not suppressing the check.

- [ ] **Step 8: Edit log + commit**

```bash
npm run count-lines -- --quiet
```
Same before/after + `git diff --stat` process. Append to `docs/edit logs/2026-07-22.md`:

```markdown
## v58.0 — 2026-07-22 — Add: true slideshow presentation mode for deck2 fullscreen

**File:** `src/data/reporting/executive/deck2/index.ts`

**Before:**
\`\`\`ts
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
  function sync(){
    var active = Boolean(current());
    var label = button.getAttribute(active ? 'data-exit-label' : 'data-enter-label');
    document.body.classList.toggle('deck-fullscreen', active);
    button.textContent = label;
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
    button.setAttribute('aria-label', label);
    button.setAttribute('title', label);
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
  sync();
})();`;
\`\`\`
and, inside `buildDeckV2Html`:
\`\`\`ts
  const labels = getLabels();
  const fullscreenEnter = esc(labels.exec_deck_fullscreen_enter);
  const fullscreenExit = esc(labels.exec_deck_fullscreen_exit);
  ...
      <button class="btn btn-fullscreen" id="deck-fullscreen-button" type="button" aria-pressed="false" aria-label="${fullscreenEnter}" title="${fullscreenEnter}" data-enter-label="${fullscreenEnter}" data-exit-label="${fullscreenExit}">${fullscreenEnter}</button>
      <button class="btn" onclick="window.print()" title="...">طباعة / PDF</button>
    </div>
  </div>
${slides}
${footerNote}
</div>
<script>${DECK_NAV_SCRIPT}${DECK_FULLSCREEN_SCRIPT}${variantPreview ? DECK_VARIANT_SCRIPT : ""}</script>
\`\`\`

**After:** full new `DECK_FULLSCREEN_SCRIPT` (index-tracking, keyboard/click navigation, fade timer, `sync()`/`disable()` no longer touching `textContent`), two new label consts, icon-only button markup, and the three new `#deck-slide-prev`/`#deck-slide-next`/`#deck-slide-counter` elements — see Step 5 above for the complete text of each.

**File:** `src/data/labels/labelsStore.ts`

**Before:**
\`\`\`ts
  exec_deck_fullscreen_enter: "ملء الشاشة",
  exec_deck_fullscreen_exit:  "إنهاء ملء الشاشة",
\`\`\`

**After:**
\`\`\`ts
  exec_deck_fullscreen_enter: "ملء الشاشة",
  exec_deck_fullscreen_exit:  "إنهاء ملء الشاشة",
  exec_deck_slideshow_prev:   "الشريحة السابقة",
  exec_deck_slideshow_next:   "الشريحة التالية",
\`\`\`

**File:** `src/components/Sidebar/Tabs/Settings/index.tsx`

**Before:**
\`\`\`tsx
      { key: "exec_deck_fullscreen_enter", desc: "زر فتح العرض بملء الشاشة" },
      { key: "exec_deck_fullscreen_exit",  desc: "زر إنهاء عرض ملء الشاشة" },
\`\`\`

**After:**
\`\`\`tsx
      { key: "exec_deck_fullscreen_enter", desc: "زر فتح العرض بملء الشاشة" },
      { key: "exec_deck_fullscreen_exit",  desc: "زر إنهاء عرض ملء الشاشة" },
      { key: "exec_deck_slideshow_prev",   desc: "زر الشريحة السابقة في العرض التقديمي" },
      { key: "exec_deck_slideshow_next",   desc: "زر الشريحة التالية في العرض التقديمي" },
\`\`\`

**Lines:** {before} → {after} (net +N) · 4 files, +N / -M
```

```bash
git add src/data/reporting/executive/deck2/index.ts src/data/labels/labelsStore.ts src/components/Sidebar/Tabs/Settings/index.tsx src/data/reporting/executive/deck2/deck2.test.ts "docs/edit logs/2026-07-22.md"
git commit -m "Add: true slideshow presentation mode for deck2 fullscreen"
```

---

## Task 4: Manual verification in the live preview

**Files:** none (verification only — no code changes, no edit-log entry).

- [ ] **Step 1: Reload the running dev preview**

The dev server from earlier in this session is already running (`x-ray-app`, preview at `http://localhost:49880/deck-preview.html`). Navigate to it again (or refresh) to pick up the Vite HMR update.

- [ ] **Step 2: Verify the button and entry point**

Screenshot the toolbar — confirm the fullscreen button now shows the expand icon (four corner brackets), not the text "ملء الشاشة". Click it.

- [ ] **Step 3: Verify single-slide layout**

Confirm exactly one slide fills the screen (not a scrollable stack), side-nav and the toolbar's brand/theme/print controls are gone.

- [ ] **Step 4: Verify navigation**

Press the Right arrow key — confirm it advances to slide 2. Press Left — confirm it returns to slide 1. Move the mouse — confirm the prev/next arrows, counter ("1 / N"), and the compress-icon exit button fade in; stop moving for ~3s — confirm they fade back out. Click directly on the slide body (not on a control) — confirm it advances one slide. Click the on-screen next/prev arrows — confirm they work and that the prev arrow is disabled/invisible on slide 1, next arrow disabled/invisible on the last slide.

- [ ] **Step 5: Verify exit paths**

Press Escape — confirm it returns to the normal scrollable view, scrolled to the slide that was showing. Re-enter fullscreen, this time click the compress-icon button itself to exit — confirm the same clean return.

- [ ] **Step 6: Verify resize and print are unaffected**

Resize the browser window while in fullscreen — confirm the active slide stays correctly fit/centered. Exit fullscreen and open the print preview (`Ctrl+P` or the "PDF / طباعة" button) — confirm no fullscreen/slideshow chrome appears in the print layout.

- [ ] **Step 7: Report results**

Summarize pass/fail for each check above. If anything fails, fix the relevant CSS/script in Task 2/3's files, re-run the automated tests for that file, and re-verify here — do not proceed to marking the feature done with a known-broken interaction.
