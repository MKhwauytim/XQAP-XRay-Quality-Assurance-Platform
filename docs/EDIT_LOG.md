# EDIT_LOG.md

Version history for the XQAP codebase. Every code edit must be logged here before it is applied.

---

## v42.2 — 2026-07-07 — Referral approval rework (3/11): wire decision history into referralStorage

**File:** `src/data/referral/referralTypes.ts`

**Before:** `ReferralRequest`/`ReplacementRequest` had no history field.

**After:** both gain `history?: DecisionEvent[]`, populated at load time.

**File:** `src/data/referral/referralStorage.ts`

**Before:** `updateReferralStatus`/`updateReplacementStatus` called `upsertReferralDecision`/`upsertReplacementDecision` (latest-wins, history lost on re-review).

**After:** both call `appendDecisionEvent`; `loadReferralLog`/`loadReplacementLog` derive `status` from `effectiveDecision(mergeDecisionHistory(...))` and attach the full `history`.

**File:** `src/data/approvals/approvalStorage.ts`

**Before:** `upsertReferralDecision`/`upsertReplacementDecision` exported.

**After:** removed — no longer called anywhere.

---

## v42.1 — 2026-07-07 — Referral approval rework (2/11): idempotency + ownership guards

**File:** `src/data/approvals/approvalGuards.ts`

**Before:** file did not exist — nothing verified a request was still pending, or that referred samples were still owned by the requester, before mutating.

**After:** added `assertRequestPending` and `assertSamplesOwnedBy`, pure functions consumed by the approval hook (Task 4) before every approve/deny.

---

## v42.0 — 2026-07-07 — Referral approval rework (1/11): append-only decision-event log

**File:** `src/data/approvals/approvalTypes.ts`

**Before:** `SupervisorDecisionFile` had only latest-wins `referralDecisions`/`replacementDecisions` arrays — no way to see a request's full review history.

**After:** added `DecisionEvent`/`DecisionEventKind` and an optional `decisionEvents?: DecisionEvent[]` field, additive and backwards compatible.

**File:** `src/data/approvals/approvalStorage.ts`

**Before:** no way to append a decision without overwriting the prior one.

**After:** added `appendDecisionEvent`, `mergeDecisionHistory`, `effectiveDecision`.

---

## v40.5 — 2026-07-05 — Retroactive log entry: test-hygiene cleanup in deckStyleChoices.test.ts

The final whole-branch review of the deck2-style-switcher workstream caught that commit
`8155b0bd` (a Task 2 implementer's fix for a `tsc -b` failure left over from Task 1/v39)
was applied without a corresponding EDIT_LOG entry. Logging it now for completeness: it
removed an unused `readFileSync` import (causing a `TS6133` compile error) and replaced a
mid-test `require("node:fs")` call with the already-imported `writeFileSync`, matching a
minor style nit the v39 task reviewer had also flagged. No behavior change; same 5 tests
pass before and after.

**File:** `src/dev/deckStyleChoices.test.ts`

**Before:**
```ts
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
// ...
    // Corrupt the file.
    const fs = require("node:fs") as typeof import("node:fs");
    fs.writeFileSync(filePath, "{not json", "utf-8");
```

**After:**
```ts
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
// ...
    // Corrupt the file.
    writeFileSync(filePath, "{not json", "utf-8");
```

---

## v40.4 — 2026-07-05 — Fix the 2 failing assertions from v40.3's known finding

Resolves v40.3's reported (not silently patched) test failure: the two production-path
assertions used a bare `not.toContain("v2-variant-stack")` check, which false-failed
because Task 3's `DECK_V2_CSS` unconditionally contains that exact substring as static
CSS selector text (`.v2-variant-stack{...}`), always present regardless of
`variantPreview` — a CSS-text collision, not an actual DOM/markup leak. Switched both
assertions to match the opening markup tag (`<div class="v2-variant-stack"`), which only
appears in real DOM output, never in CSS selector text — the same technique the file's
own preview-mode test already used correctly. Also added a check that the persistence
endpoint string (`__deck-style-choices`) never appears in production output, closing a
gap neither the original brief nor v40.3 tested for on the production side.

**File:** `src/data/reporting/executive/deck2/deck2.test.ts`

**Before:**
```ts
describe("buildExecutiveDeckV2 — production path (no opts)", () => {
  it("never emits variant-switcher chrome when opts is omitted", () => {
    const html = buildExecutiveDeckV2(input([popRow(), popRow({ xrayImageId: "XR-2" })]));
    expect(html).not.toContain("v2-variant-stack");
    expect(html).not.toContain("v2-variant-switcher");
  });

  it("never emits variant-switcher chrome when variantPreview is explicitly false", () => {
    const html = buildExecutiveDeckV2(
      input([popRow(), popRow({ xrayImageId: "XR-2" })]),
      {},
      { variantPreview: false },
    );
    expect(html).not.toContain("v2-variant-stack");
  });
```

**After:**
```ts
describe("buildExecutiveDeckV2 — production path (no opts)", () => {
  // Match the opening markup tag, not the bare class name — the CSS block
  // (added in Task 3) legitimately contains the literal substring
  // "v2-variant-stack"/"v2-variant-switcher" as selector text, always, in both
  // production and preview mode (CSS is static and unconditional; only the
  // switcher's DOM markup and client script are gated on variantPreview). A
  // bare substring check would false-positive on that CSS text alone.
  it("never emits variant-switcher DOM markup when opts is omitted", () => {
    const html = buildExecutiveDeckV2(input([popRow(), popRow({ xrayImageId: "XR-2" })]));
    expect(html).not.toContain('<div class="v2-variant-stack"');
    expect(html).not.toContain('<div class="v2-variant-switcher"');
    expect(html).not.toContain("__deck-style-choices");
  });

  it("never emits variant-switcher DOM markup when variantPreview is explicitly false", () => {
    const html = buildExecutiveDeckV2(
      input([popRow(), popRow({ xrayImageId: "XR-2" })]),
      {},
      { variantPreview: false },
    );
    expect(html).not.toContain('<div class="v2-variant-stack"');
    expect(html).not.toContain("__deck-style-choices");
  });
```

**Verified:** `npx vitest run src/data/reporting/executive/deck2/deck2.test.ts` → 4 passed (4); full suite `npm run test:run` → 293 passed (293), 0 regressions.

---

## v40.3 — 2026-07-05 — Production-path regression test for deck2 variant switcher

Adds the regression test that locks in the single most important correctness property of the deck2-style-switcher workstream: `buildExecutiveDeckV2` called with no `opts` (or `variantPreview: false`) must produce byte-identical output to before Tasks 1-8, with no variant-switcher markup leaking into production output. Also verifies preview mode (`variantPreview: true`) emits exactly one `.v2-variant-stack` per slide with 4 panels each. Task 9 (final task) of the deck2-style-switcher workstream.

**File:** `src/data/reporting/executive/deck2/deck2.test.ts` (new file — did not exist before)

**Before:** (file did not exist)

**After:**
```ts
// src/data/reporting/executive/deck2/deck2.test.ts
import { describe, expect, it } from "vitest";
import { DEFAULT_EXEC_CONFIG } from "../../executiveReportTypes";
import type { ExecutiveReportInput } from "../../executiveReportTypes";
import type { PreparedPopulationRow } from "../../../population/populationTypes";
import { buildExecutiveDeckV2 } from "./index";

// ...popRow()/input() fixtures...

describe("buildExecutiveDeckV2 — production path (no opts)", () => {
  it("never emits variant-switcher chrome when opts is omitted", () => {
    const html = buildExecutiveDeckV2(input([popRow(), popRow({ xrayImageId: "XR-2" })]));
    expect(html).not.toContain("v2-variant-stack");
    expect(html).not.toContain("v2-variant-switcher");
  });

  it("never emits variant-switcher chrome when variantPreview is explicitly false", () => {
    const html = buildExecutiveDeckV2(
      input([popRow(), popRow({ xrayImageId: "XR-2" })]),
      {},
      { variantPreview: false },
    );
    expect(html).not.toContain("v2-variant-stack");
  });

  it("produces byte-identical output for the same input regardless of the opts param shape", () => {
    const fixture = input([popRow(), popRow({ xrayImageId: "XR-2" })]);
    const a = buildExecutiveDeckV2(fixture);
    const b = buildExecutiveDeckV2(fixture, {}, { variantPreview: false });
    expect(a).toBe(b);
  });
});

describe("buildExecutiveDeckV2 — preview mode", () => {
  it("emits exactly one variant-stack per slide with 4 panels each, and DECK_VARIANT_SCRIPT", () => {
    // ...regex-based assertions on stack/panel/slide-section counts...
  });
});
```

**Known finding (not fixed by this task — reported, not silently patched):** two of the four tests fail as written in the task brief — `"never emits variant-switcher chrome when opts is omitted"` and `"...when variantPreview is explicitly false"`. Root cause: `DECK_V2_CSS` (`src/data/reporting/executive/deck2/theme.ts`, added in Task 3 / v39.2) is a single unconditional CSS string always concatenated into `<style>` by `buildDeckV2Html` regardless of `variantPreview`, and it contains the literal selector text `.v2-variant-stack{...}` / `.v2-variant-switcher{...}` as static CSS rules — so those substrings appear in every deck2 render, including production (`variantPreview: false`/omitted), even though the corresponding `<div>` markup is correctly gated and never emitted. This is CSS dead-weight in production output, not a functional leak: no switcher UI renders, and the byte-identical test (`buildExecutiveDeckV2(fixture)` === `buildExecutiveDeckV2(fixture, {}, { variantPreview: false })`) passes, confirming the two call shapes are equivalent. The task brief's own comment in the preview-mode test anticipated this exact CSS-substring collision but only worked around it there (via an opening-tag regex), not in the two production-path `not.toContain` assertions. Per instructions, the test was written and committed exactly as specified in the brief rather than weakened; the 2 failing assertions are left failing intentionally as a flag for a follow-up fix (e.g. splitting `DECK_V2_CSS` into an always-on part and a preview-only part gated the same way `DECK_VARIANT_SCRIPT` is).

---

## v40.2 — 2026-07-05 — Preview harness wiring + light/dark toggle

Wires the dev-only preview harness (`deck-preview.html` + `src/dev/deckPreview.ts`) to always request variant-preview mode and adds a light/dark theme toggle button. The preview harness now passes `{ variantPreview: true }` to `buildExecutiveDeckV2`, enabling the style-variant cycling controls on every deck2 slide. The new theme toggle button applies/removes the `theme-light` class on the iframe body, persisting the choice until the user clicks the button again. Task 8 of the deck2-style-switcher workstream.

**File:** `deck-preview.html`

**Before:**
```html
    <div id="bar">
      <strong>معاينة العرض التنفيذي</strong>
      <button id="btn-v2" class="active">النسخة الجديدة (v2)</button>
      <button id="btn-v1">النسخة القديمة (مرجع)</button>
      <span class="hint">بيانات تجريبية — مايو 2026 · يُعاد التحميل تلقائيًا مع كل تعديل</span>
    </div>
```

**After:**
```html
    <div id="bar">
      <strong>معاينة العرض التنفيذي</strong>
      <button id="btn-v2" class="active">النسخة الجديدة (v2)</button>
      <button id="btn-v1">النسخة القديمة (مرجع)</button>
      <button id="btn-theme">فاتح / داكن</button>
      <span class="hint">بيانات تجريبية — مايو 2026 · يُعاد التحميل تلقائيًا مع كل تعديل</span>
    </div>
```

**File:** `src/dev/deckPreview.ts`

**Before:**
```typescript
const frame = document.getElementById("frame") as HTMLIFrameElement;
const btnV2 = document.getElementById("btn-v2") as HTMLButtonElement;
const btnV1 = document.getElementById("btn-v1") as HTMLButtonElement;

const LOADING_HTML = `<!DOCTYPE html><html lang="ar" dir="rtl"><body style="margin:0;height:100vh;display:grid;place-items:center;background:#04182c;color:#cfe0f0;font-family:system-ui,sans-serif;font-size:0.95rem">جارٍ بناء العرض…</body></html>`;

let input: ExecutiveReportInput | null = null;
const cache: { v1?: string; v2?: string } = {};

function deckHtml(which: "v2" | "v1"): string {
  input ??= buildPreviewInput();
  if (which === "v2") {
    cache.v2 ??= buildExecutiveDeckV2(input);
    return cache.v2;
  }
  cache.v1 ??= buildExecutiveDeck(input);
  return cache.v1;
}

function show(which: "v2" | "v1"): void {
  btnV2.classList.toggle("active", which === "v2");
  btnV1.classList.toggle("active", which === "v1");
  if (cache[which]) {
    frame.srcdoc = cache[which] as string;
    return;
  }
  frame.srcdoc = LOADING_HTML;
  // Let the placeholder paint before the (synchronous) model + deck build.
  setTimeout(() => {
    const t0 = performance.now();
    frame.srcdoc = deckHtml(which);
    console.info(`[deck-preview] built ${which} in ${Math.round(performance.now() - t0)}ms`);
  }, 30);
}

btnV2.addEventListener("click", () => show("v2"));
btnV1.addEventListener("click", () => show("v1"));
show("v2");
```

**After:**
```typescript
const frame = document.getElementById("frame") as HTMLIFrameElement;
const btnV2 = document.getElementById("btn-v2") as HTMLButtonElement;
const btnV1 = document.getElementById("btn-v1") as HTMLButtonElement;
const btnTheme = document.getElementById("btn-theme") as HTMLButtonElement;

const LOADING_HTML = `<!DOCTYPE html><html lang="ar" dir="rtl"><body style="margin:0;height:100vh;display:grid;place-items:center;background:#04182c;color:#cfe0f0;font-family:system-ui,sans-serif;font-size:0.95rem">جارٍ بناء العرض…</body></html>`;

let input: ExecutiveReportInput | null = null;
const cache: { v1?: string; v2?: string } = {};
let lightTheme = false;

function deckHtml(which: "v2" | "v1"): string {
  input ??= buildPreviewInput();
  if (which === "v2") {
    // Always request variant-preview mode here: this dev tool's whole purpose
    // is style-variant exploration (see deck2/index.ts's `variantPreview` opt).
    // Production callers (once deck2 is wired into the real app) omit `opts`.
    cache.v2 ??= buildExecutiveDeckV2(input, {}, { variantPreview: true });
    return cache.v2;
  }
  cache.v1 ??= buildExecutiveDeck(input);
  return cache.v1;
}

function show(which: "v2" | "v1"): void {
  btnV2.classList.toggle("active", which === "v2");
  btnV1.classList.toggle("active", which === "v1");
  if (cache[which]) {
    frame.srcdoc = cache[which] as string;
    return;
  }
  frame.srcdoc = LOADING_HTML;
  // Let the placeholder paint before the (synchronous) model + deck build.
  setTimeout(() => {
    const t0 = performance.now();
    frame.srcdoc = deckHtml(which);
    console.info(`[deck-preview] built ${which} in ${Math.round(performance.now() - t0)}ms`);
  }, 30);
}

// Re-applies the light-theme class every time the iframe's document reloads
// (srcdoc assignment tears down the previous document, so the class doesn't
// survive a `show()` call on its own).
frame.addEventListener("load", () => {
  if (lightTheme) frame.contentDocument?.body.classList.add("theme-light");
});

btnTheme.addEventListener("click", () => {
  lightTheme = !lightTheme;
  btnTheme.classList.toggle("active", lightTheme);
  frame.contentDocument?.body.classList.toggle("theme-light", lightTheme);
});

btnV2.addEventListener("click", () => show("v2"));
btnV1.addEventListener("click", () => show("v1"));
show("v2");
```

---

## v40.1 — 2026-07-05 — Thread variantPreview through buildExecutiveDeckV2

Wires the `variantPreview` parameter through the public API of the executive deck v2 builder. Adds the `DECK_VARIANT_SCRIPT` client-side controller (only injected when `variantPreview=true`) and updates `buildDeckV2Html` and `buildExecutiveDeckV2` signatures to accept and propagate the variant-preview flag. Task 7 of the deck2-style-switcher workstream.

**File:** `src/data/reporting/executive/deck2/index.ts`

**Before:**
```ts
export function buildDeckV2Html(slides: string, monthLabel: string): string {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>العرض التنفيذي — ${esc(monthLabel)}</title>
<style>${DECK_CSS}${DECK_V2_CSS}</style>
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
    <button class="btn" onclick="window.print()">طباعة / PDF</button>
  </div>
${slides}
</div>
<script>${DECK_NAV_SCRIPT}</script>
</body>
</html>`;
}

export function buildExecutiveDeckV2(
  input: ExecutiveReportInput,
  employeeDisplayNames: Record<string, string> = {},
): string {
  const model = buildReportModel(input, employeeDisplayNames);
  const slides = buildDeckV2Slides(model);
  return buildDeckV2Html(slides, formatMonthLabel(input.monthFolderName));
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
```

**After:**
```ts
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
  var stacks = Array.prototype.slice.call(document.querySelectorAll('.v2-variant-stack'));
  if (!stacks.length) return;
  function apply(stack, index){
    var panels = Array.prototype.slice.call(stack.querySelectorAll('.v2-variant-panel'));
    panels.forEach(function(p, i){ p.classList.toggle('active', i === index); });
    stack.setAttribute('data-active-index', String(index));
    var label = stack.querySelector('.v2-variant-label');
    if (label) label.textContent = (index + 1) + ' / ' + panels.length;
  }
  function persist(slideId, index){
    fetch('/__deck-style-choices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slideId: slideId, variantIndex: index })
    }).catch(function(){});
  }
  stacks.forEach(function(stack){
    var slideId = stack.getAttribute('data-slide-id');
    var panelCount = stack.querySelectorAll('.v2-variant-panel').length;
    function step(delta){
      var cur = Number(stack.getAttribute('data-active-index') || '0');
      var next = (cur + delta + panelCount) % panelCount;
      apply(stack, next);
      persist(slideId, next);
    }
    stack.querySelector('.v2-variant-prev').addEventListener('click', function(){ step(-1); });
    stack.querySelector('.v2-variant-next').addEventListener('click', function(){ step(1); });
  });
  fetch('/__deck-style-choices').then(function(r){ return r.json(); }).then(function(saved){
    stacks.forEach(function(stack){
      var slideId = stack.getAttribute('data-slide-id');
      if (Object.prototype.hasOwnProperty.call(saved, slideId)) {
        apply(stack, saved[slideId]);
      }
    });
  }).catch(function(){});
})();`;

export function buildDeckV2Html(slides: string, monthLabel: string, variantPreview = false): string {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>العرض التنفيذي — ${esc(monthLabel)}</title>
<style>${DECK_CSS}${DECK_V2_CSS}</style>
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
    <button class="btn" onclick="window.print()">طباعة / PDF</button>
  </div>
${slides}
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
  const slides = buildDeckV2Slides(model, new Date(), variantPreview);
  return buildDeckV2Html(slides, formatMonthLabel(input.monthFolderName), variantPreview);
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
```

---

## v40 — 2026-07-05 — 4-variant plumbing for every deck2 slide builder

Architectural change enabling the dev-only style-variant switcher (Tasks 4-6 of the deck2-style-switcher workstream). Adds a `renderVariants(slideId, bodies, variantPreview)` helper that renders only `bodies[0]` when `variantPreview` is false (byte-identical to today's production output) or all 4 panels behind a cycle-switcher when true. `v2Slide()`'s `body: string` option becomes `bodyVariants: readonly [string,string,string,string]; variantPreview: boolean`. Every builder in the file is migrated to accept/thread `variantPreview` and pass `[body, body, body, body]` (literal duplicates for now — a later plan authors the real alternate designs): `coverSlide`, `tocSlide`, `glossarySlideBuilders`, `sectionSeparatorSlide` (Task 5), then `riskStagesSlide`, `portPopulationSlideBuilders`, `portSampleSlideBuilders`, `qualityPortSlideBuilders`, `accuracyPortSlideBuilders`, and the assembly function `buildDeckV2Slides` (Task 6), which now takes an optional `variantPreview = false` parameter and threads it into every builder call.

**File:** `src/data/reporting/executive/deck2/slides.ts`

**Before:**
```ts
function v2Slide(opts: {
  id: string;
  title: string;
  eyebrow: string;
  iconName: string;
  headline: string;
  subhead?: string;
  body: string;
  num: number;
  total: number;
  slideClass?: string;
  section: NavSectionKey;
}): string {
  const cls = `slide v2${opts.slideClass ? " " + opts.slideClass : ""}`;
  return `<section class="${cls}" id="${esc(opts.id)}" data-title="${esc(opts.title)}" data-section="${opts.section}" data-section-label="${esc(NAV_SECTIONS[opts.section])}">
  ${printToggle()}
  ${sideRail(opts.section)}
  <div class="slide-inner">
    <div class="slide-eyebrow">
      <span class="slide-eyebrow-icon">${icon(opts.iconName, 16)}</span>
      <span>${esc(opts.eyebrow)}</span>
    </div>
    <div class="slide-headline">${esc(opts.headline)}</div>
    ${opts.subhead ? `<div class="slide-subhead">${esc(opts.subhead)}</div>` : ""}
    <div class="slide-body">${opts.body}</div>
  </div>
  ${pageFoot(opts.num, opts.total)}
</section>`;
}

// coverSlide, tocSlide, glossarySlideBuilders, sectionSeparatorSlide,
// riskStagesSlide, portPopulationSlideBuilders, portSampleSlideBuilders,
// qualityPortSlideBuilders, accuracyPortSlideBuilders all took no
// `variantPreview` param and built a single `body: string` passed straight
// into `v2Slide({ ..., body, ... })` (or, for the two hand-rolled builders
// coverSlide/sectionSeparatorSlide, inlined directly into the returned HTML).

export function buildDeckV2Slides(model: ReportModel, generatedAt = new Date()): string {
  const glossaryBuilders = glossarySlideBuilders();
  const sectionOne: SlideBuilder[] = [
    (num, total) => sectionSeparatorSlide(1, "section1", "layers", "مجتمع الفحص", "…", num, total),
    (num, total) => riskStagesSlide(model, num, total),
    ...portPopulationSlideBuilders(model),
    ...portSampleSlideBuilders(model),
  ];
  const sectionTwo: SlideBuilder[] = [
    (num, total) => sectionSeparatorSlide(2, "section2", "gauge", "نتائج فحص الجودة", "…", num, total),
    ...qualityPortSlideBuilders(model),
    ...accuracyPortSlideBuilders(model),
  ];
  // ...
  const slides: string[] = [coverSlide(model, generatedAt), tocSlide(tocItems, 2, total)];
  // ...
}
```

**After:**
```ts
function renderVariants(
  slideId: string,
  bodies: readonly [string, string, string, string],
  variantPreview: boolean,
): string {
  if (!variantPreview) return bodies[0];
  const panels = bodies
    .map(
      (html, i) =>
        `<div class="v2-variant-panel${i === 0 ? " active" : ""}" data-variant-index="${i}">${html}</div>`,
    )
    .join("");
  return `<div class="v2-variant-stack" data-slide-id="${esc(slideId)}" data-active-index="0">
    <div class="v2-variant-switcher">
      <button type="button" class="v2-variant-prev" aria-label="النمط السابق">‹</button>
      <span class="v2-variant-label">1 / 4</span>
      <button type="button" class="v2-variant-next" aria-label="النمط التالي">›</button>
    </div>
    ${panels}
  </div>`;
}

function v2Slide(opts: {
  id: string;
  title: string;
  eyebrow: string;
  iconName: string;
  headline: string;
  subhead?: string;
  bodyVariants: readonly [string, string, string, string];
  variantPreview: boolean;
  num: number;
  total: number;
  slideClass?: string;
  section: NavSectionKey;
}): string {
  const cls = `slide v2${opts.slideClass ? " " + opts.slideClass : ""}`;
  const body = renderVariants(opts.id, opts.bodyVariants, opts.variantPreview);
  return `<section class="${cls}" id="${esc(opts.id)}" data-title="${esc(opts.title)}" data-section="${opts.section}" data-section-label="${esc(NAV_SECTIONS[opts.section])}">
  ${printToggle()}
  ${sideRail(opts.section)}
  <div class="slide-inner">
    <div class="slide-eyebrow">
      <span class="slide-eyebrow-icon">${icon(opts.iconName, 16)}</span>
      <span>${esc(opts.eyebrow)}</span>
    </div>
    <div class="slide-headline">${esc(opts.headline)}</div>
    ${opts.subhead ? `<div class="slide-subhead">${esc(opts.subhead)}</div>` : ""}
    <div class="slide-body">${body}</div>
  </div>
  ${pageFoot(opts.num, opts.total)}
</section>`;
}

// coverSlide, tocSlide, glossarySlideBuilders, sectionSeparatorSlide,
// riskStagesSlide, portPopulationSlideBuilders, portSampleSlideBuilders,
// qualityPortSlideBuilders, accuracyPortSlideBuilders now all take/thread a
// `variantPreview: boolean` param and pass `bodyVariants: [body, body, body,
// body]` to `v2Slide` (or, for coverSlide/sectionSeparatorSlide, call
// `renderVariants(id, [body,body,body,body], variantPreview)` directly since
// those two builders don't go through the `v2Slide` shell).

export function buildDeckV2Slides(
  model: ReportModel,
  generatedAt = new Date(),
  variantPreview = false,
): string {
  const glossaryBuilders = glossarySlideBuilders(variantPreview);
  const sectionOne: SlideBuilder[] = [
    (num, total) =>
      sectionSeparatorSlide(1, "section1", "layers", "مجتمع الفحص", "…", num, total, variantPreview),
    (num, total) => riskStagesSlide(model, num, total, variantPreview),
    ...portPopulationSlideBuilders(model, variantPreview),
    ...portSampleSlideBuilders(model, variantPreview),
  ];
  const sectionTwo: SlideBuilder[] = [
    (num, total) =>
      sectionSeparatorSlide(2, "section2", "gauge", "نتائج فحص الجودة", "…", num, total, variantPreview),
    ...qualityPortSlideBuilders(model, variantPreview),
    ...accuracyPortSlideBuilders(model, variantPreview),
  ];
  // ...
  const slides: string[] = [
    coverSlide(model, generatedAt, variantPreview),
    tocSlide(tocItems, 2, total, variantPreview),
  ];
  // ...
}
```

---

## v39 — 2026-07-05 — Dev-only deck style-choices persistence helpers

New dev-only modules for the deck-preview style-switcher (Task 1 of the deck2-style-switcher workstream). Provides Node.js-based persistence (not browser APIs) for tracking which style variant the user has selected for each slide in the executive-report deck preview. Used only by the Vite dev-server middleware in future tasks.

**File:** `src/dev/deckStyleChoices.ts` (new)

**Before:**
```ts
// did not exist
```

**After:**
```ts
// Dev-only persistence for the deck-preview style switcher. Plain Node `fs`
// (not the browser safeWriteJson/File System Access flow the real app uses
// for user workspaces) — this file is imported only from a Vite dev-server
// middleware (deckStyleChoicesPlugin.ts), never from browser or app code.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { wrap, isEnvelope, type JsonEnvelope } from "../data/storage/jsonEnvelope";

export type DeckStyleChoices = Record<string, number>;

const EMPTY_ENVELOPE: JsonEnvelope<DeckStyleChoices> = {
  metadata: { schemaVersion: 1, revision: 0, contentHash: "", writtenAt: "" },
  data: {},
};

/** Reads the choices envelope from `path`, recovering to an empty envelope
 *  (revision 0) if the file is missing, unreadable, or not a valid envelope. */
export function readChoices(path: string): JsonEnvelope<DeckStyleChoices> {
  if (!existsSync(path)) return EMPTY_ENVELOPE;
  try {
    const raw: unknown = JSON.parse(readFileSync(path, "utf-8"));
    if (isEnvelope(raw)) return raw as JsonEnvelope<DeckStyleChoices>;
    return EMPTY_ENVELOPE;
  } catch {
    return EMPTY_ENVELOPE;
  }
}

/** Merges `{ [slideId]: variantIndex }` into the choices at `path` and writes
 *  the result back as a `JsonEnvelope`, creating parent directories as needed. */
export function writeChoice(path: string, slideId: string, variantIndex: number): void {
  const current = readChoices(path);
  const next: DeckStyleChoices = { ...current.data, [slideId]: variantIndex };
  const envelope = wrap(next, current.metadata.revision);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(envelope, null, 2), "utf-8");
}
```

**File:** `src/dev/deckStyleChoices.test.ts` (new)

**Before:**
```ts
// did not exist
```

**After:**
```ts
import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readChoices, writeChoice } from "./deckStyleChoices";

let dir: string;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("deckStyleChoices", () => {
  it("readChoices returns an empty envelope when the file doesn't exist", () => {
    dir = mkdtempSync(join(tmpdir(), "deck-style-"));
    const filePath = join(dir, "choices.json");
    const envelope = readChoices(filePath);
    expect(envelope.data).toEqual({});
    expect(envelope.metadata.revision).toBe(0);
  });

  it("writeChoice creates the file and parent directories, and readChoices reads it back", () => {
    dir = mkdtempSync(join(tmpdir(), "deck-style-"));
    const filePath = join(dir, "6-templates", "choices.json");
    writeChoice(filePath, "slide-cover", 2);
    expect(existsSync(filePath)).toBe(true);
    const envelope = readChoices(filePath);
    expect(envelope.data).toEqual({ "slide-cover": 2 });
    expect(envelope.metadata.revision).toBe(1);
  });

  it("writeChoice merges into existing choices and increments the revision", () => {
    dir = mkdtempSync(join(tmpdir(), "deck-style-"));
    const filePath = join(dir, "choices.json");
    writeChoice(filePath, "slide-cover", 1);
    writeChoice(filePath, "slide-toc", 3);
    const envelope = readChoices(filePath);
    expect(envelope.data).toEqual({ "slide-cover": 1, "slide-toc": 3 });
    expect(envelope.metadata.revision).toBe(2);
  });

  it("writeChoice overwrites an existing slide's choice", () => {
    dir = mkdtempSync(join(tmpdir(), "deck-style-"));
    const filePath = join(dir, "choices.json");
    writeChoice(filePath, "slide-cover", 1);
    writeChoice(filePath, "slide-cover", 3);
    const envelope = readChoices(filePath);
    expect(envelope.data).toEqual({ "slide-cover": 3 });
  });

  it("readChoices recovers an empty envelope if the file contains invalid JSON", () => {
    dir = mkdtempSync(join(tmpdir(), "deck-style-"));
    const filePath = join(dir, "choices.json");
    writeChoice(filePath, "slide-cover", 1);
    // Corrupt the file.
    const fs = require("node:fs") as typeof import("node:fs");
    fs.writeFileSync(filePath, "{not json", "utf-8");
    const envelope = readChoices(filePath);
    expect(envelope.data).toEqual({});
  });
});
```

---

## v39.1 — 2026-07-05 — Vite dev middleware for deck style-choice persistence

Wraps Task 1's `readChoices`/`writeChoice` helpers in a Vite dev-server middleware plugin exposing `GET`/`POST /__deck-style-choices`, and registers it in `vite.config.ts`. Dev-only: the middleware is only wired into `configureServer`, so it never runs in the `npm run build` output. Also ignores the `dev-workspace/` scratch folder the middleware writes to.

**File:** `src/dev/deckStyleChoicesPlugin.ts` (new)

**Before:**
```ts
// did not exist
```

**After:**
```ts
// Vite dev-server middleware exposing the deck-preview style-switcher's
// persistence endpoint. Dev-only: only registered by vite.config.ts's plugin
// list, never runs in `npm run build` output.
import type { Plugin } from "vite";
import { readChoices, writeChoice } from "./deckStyleChoices";

const ENDPOINT = "/__deck-style-choices";
const CHOICES_PATH = "dev-workspace/6-templates/deck-style-choices.json";

export function deckStyleChoicesPlugin(): Plugin {
  return {
    name: "deck-style-choices",
    configureServer(server) {
      server.middlewares.use(ENDPOINT, (req, res) => {
        if (req.method === "GET") {
          const envelope = readChoices(CHOICES_PATH);
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(envelope.data));
          return;
        }
        if (req.method === "POST") {
          let body = "";
          req.on("data", (chunk: Buffer) => {
            body += chunk.toString();
          });
          req.on("end", () => {
            try {
              const parsed = JSON.parse(body) as { slideId?: unknown; variantIndex?: unknown };
              if (typeof parsed.slideId !== "string" || typeof parsed.variantIndex !== "number") {
                res.statusCode = 400;
                res.end("bad request");
                return;
              }
              writeChoice(CHOICES_PATH, parsed.slideId, parsed.variantIndex);
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ ok: true }));
            } catch {
              res.statusCode = 400;
              res.end("bad request");
            }
          });
          return;
        }
        res.statusCode = 405;
        res.end("method not allowed");
      });
    },
  };
}
```

**File:** `vite.config.ts`

**Before:**
```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  plugins: [react(), viteSingleFile()],
```

**After:**
```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";
import { deckStyleChoicesPlugin } from "./src/dev/deckStyleChoicesPlugin";

export default defineConfig({
  plugins: [react(), viteSingleFile(), deckStyleChoicesPlugin()],
```

**File:** `.gitignore`

**Before:**
```
dist-ssr
*.local
.worktrees
```

**After:**
```
dist-ssr
*.local
.worktrees
dev-workspace
```

---

## v39.2 — 2026-07-05 — Variant-switcher CSS + light-theme re-skin (deck2)

Adds CSS for the dev-preview style-variant switcher chrome (`.v2-variant-stack`, `.v2-variant-panel`, `.v2-variant-switcher`, `.v2-variant-prev`/`.v2-variant-next`, `.v2-variant-label`) and a `body.theme-light` light-theme re-skin for both deck2-only components (v2-term-card, v2-stage-card, v2-port-col, v2-rail) and shared v1 components (kpi-tile, deck-table). These classes are not wired to any markup yet; they will be used by Task 4's `renderVariants()` function and Task 7's theme-toggle button. This task is purely CSS, no logic or markup changes.

**File:** `src/data/reporting/executive/deck2/theme.ts`

**Before:**
```ts
@media(max-width:820px){
  .v2-term-grid,.v2-port-split,.v2-cover-meta{grid-template-columns:1fr;}
}
`;
```

**After:**
```ts
@media(max-width:820px){
  .v2-term-grid,.v2-port-split,.v2-cover-meta{grid-template-columns:1fr;}
}

/* ── Style-variant switcher (dev-preview only, never in production output) ── */
/* .v2-variant-stack takes over the flex-sizing role of whatever container it
   sits in (\`.slide-body\` or directly \`.slide-inner\`), so wrapping existing
   content in it does not change any pixel-budget math (TABLE_BUDGET_PX etc.)
   — only the ACTIVE panel is flex/visible, matching the original single-child
   layout the budget math was measured against. */
.v2-variant-stack{
  flex:1 1 auto;min-height:0;display:flex;flex-direction:column;position:relative;
}
.v2-variant-panel{display:none;flex:1 1 auto;min-height:0;flex-direction:column;}
.v2-variant-panel.active{display:flex;}
.v2-variant-switcher{
  position:absolute;top:6px;left:6px;z-index:5;
  display:flex;align-items:center;gap:6px;
  background:rgba(2,16,30,.72);border:1px solid rgba(255,255,255,.16);border-radius:999px;
  padding:3px 8px;font-size:0.68rem;font-weight:700;color:rgba(255,255,255,.75);
}
.v2-variant-switcher button{
  border:0;background:rgba(255,255,255,.08);color:#fff;border-radius:999px;
  width:20px;height:20px;display:grid;place-items:center;cursor:pointer;font-size:0.85rem;line-height:1;
  padding:0;
}
.v2-variant-switcher button:hover{background:var(--gold);color:var(--navy);}
.v2-variant-label{min-width:32px;text-align:center;font-variant-numeric:tabular-nums;}
@media print{.v2-variant-switcher{display:none!important;}}

/* ── Light theme re-skin (dev-preview toggle) ────────────────────────────── */
/* Mirrors the old deck's \`.page.light\` pattern (theme.ts / EXEC_CSS): swap
   background/ink/border colors on top of whatever variant is currently
   showing, no new markup. Applies to both slides.ts's v1-shared components
   (kpi-tile, deck-table) and deck2-only components (v2-term-card, v2-stage-
   card, v2-port-col). */
body.theme-light{background:#eef2f6;}
body.theme-light .slide{
  background:linear-gradient(150deg,#ffffff,#f4f6f9 65%);
  border-color:#dde4ea;color:#0a2d4a;
}
body.theme-light .slide-headline,body.theme-light h2{color:#0a2d4a;}
body.theme-light .slide-subhead{color:#8a6d1f;}
body.theme-light .muted,body.theme-light .v2-stage-row span{color:#607386;}
body.theme-light .kpi-tile,body.theme-light .v2-term-card,body.theme-light .v2-stage-card{
  background:#ffffff;border-color:#dde4ea;color:#0a2d4a;box-shadow:0 6px 16px rgba(10,45,74,.08);
}
body.theme-light .v2-port-col{
  background:linear-gradient(180deg,#eef7ee,#e4f1e4);box-shadow:0 6px 16px rgba(10,45,74,.08);
}
body.theme-light .v2-port-col.sea{background:linear-gradient(180deg,#eaf2fb,#dfeaf8);}
body.theme-light .deck-table{background:#ffffff;color:#0a2d4a;}
body.theme-light .deck-table th{background:#0e3a5f;color:#fff;}
body.theme-light .deck-table td{border-color:#e3e8ee;}
body.theme-light .v2-rail{background:linear-gradient(180deg,#f4f6f9,#e7edf2);border-color:#dde4ea;}
body.theme-light .v2-rail-title,body.theme-light .v2-rail-tab{color:#5b6b78;}
body.theme-light .v2-variant-switcher{background:rgba(255,255,255,.85);border-color:#dde4ea;color:#3a4a58;}
body.theme-light .v2-variant-switcher button{background:rgba(10,45,74,.08);color:#0a2d4a;}
`;
```

---

## v38.3 — 2026-07-02 — DataTable render loop via onFilteredRowsChange (BUGFIX LOG-03)

New finding surfaced during post-fix verification (registered as LOG-03 in
`docs/audit/FULL_SYSTEM_AUDIT_2026-07-02.md`): opening صور الأشعة المحالة logged
"Maximum update depth exceeded" ×7. Chain: `XrayReferrals` defines `rowMatchesFilter` as a
plain function (new identity every render) → it is a dependency of DataTable's `filteredRows`
memo → the memo recomputes to a **new array identity** every render → the
`onFilteredRowsChange` effect re-fires → the consumer stores the array in state
(`setFilteredTableEntries`) → re-render → loop until React clamps. Any DataTable consumer
passing both an unstable `rowMatchesFilter` and `onFilteredRowsChange` loops the same way.

Two-sided fix: DataTable now only emits when the filtered rows actually changed (length +
element identity guard via a ref), making the shared component immune to unstable callback
props; and `XrayReferrals.rowMatchesFilter` is memoized with `useCallback([answersMap])`.

**File:** `src/components/DataTable/index.tsx`

**Before:**
```tsx
  useEffect(() => {
    onFilteredRowsChange?.(filteredRows);
  }, [filteredRows, onFilteredRowsChange]);
```

**After:**
```tsx
  // LOG-03: only notify when the visible rows actually changed. filteredRows can
  // get a fresh array identity on every render when a consumer passes an
  // unstable rowMatchesFilter; emitting each time loops consumers that store
  // the rows in state.
  const lastEmittedRowsRef = useRef<TRow[] | null>(null);
  useEffect(() => {
    if (!onFilteredRowsChange) return;
    const prev = lastEmittedRowsRef.current;
    const unchanged =
      prev !== null &&
      prev.length === filteredRows.length &&
      prev.every((row, i) => row === filteredRows[i]);
    if (unchanged) return;
    lastEmittedRowsRef.current = filteredRows;
    onFilteredRowsChange(filteredRows);
  }, [filteredRows, onFilteredRowsChange]);
```

**File:** `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx`

**Before:**
```tsx
  function rowMatchesFilter(
    entry: DistributionEntry,
    colId: string,
    filter: AnyFilter
  ): boolean | null {
```

**After:**
```tsx
  const rowMatchesFilter = useCallback((
    entry: DistributionEntry,
    colId: string,
    filter: AnyFilter
  ): boolean | null => {
…
  }, [answersMap]);
```

## v38.2 — 2026-07-02 — StateViews rollout: consistent empty/loading states on data screens (DESIGN UIX-01)

Fixes UIX-01 from `docs/audit/FULL_SYSTEM_AUDIT_2026-07-02.md`: the shared
`EmptyState`/`LoadingState` library (added v36.4) was used only by `App.tsx`, so every tab had
its own ad-hoc "nothing here" treatment — bare text on some screens, and on اعتماد الطلبات
**nothing at all**: with zero processed months the loader early-returns, `loadState` stays
`"idle"`, and no state branch matches → a blank void under the filters (the audit's worst
empty-state finding, root-caused here). Rollout:

- **ReferralApproval**: months resolving to empty now sets `loadState: "ready"`; a dedicated
  no-months `EmptyState` explains the prerequisite (process a month first); the no-requests
  case uses `EmptyState`; the months loader gained a `.catch` (no more floating rejection).
- **XrayInspectionResults**: loading → `LoadingState`, error → `ErrorState`, no-months /
  no-rows / no-history → `EmptyState` (same label strings, shared chrome).
- **TemplateBuilder**: bare `tb-empty` div → `EmptyState` with guidance toward the
  "+ نموذج جديد" action.
- **Population browse**: bare `placeholder-phase` paragraph → `EmptyState` pointing to
  تبويب معالجة المجتمع.

**File:** `src/components/Sidebar/Tabs/EmployeeWorkspace/views/ReferralApproval.tsx`

**Before:**
```tsx
  useEffect(() => {
    void listMonthFolders(directoryHandle).then((ms) => {
      setMonths(ms);
      if (ms.length > 0) setSelMonth(ms[ms.length - 1]!.folderName);
    });
  }, [directoryHandle]);
…
      {loadState === "ready" && activeList.length === 0 && (
        <div className="ew-referral-empty">
          <p>لا توجد طلبات …</p>
        </div>
      )}
```

**After:**
```tsx
  useEffect(() => {
    listMonthFolders(directoryHandle)
      .then((ms) => {
        setMonths(ms);
        if (ms.length > 0) setSelMonth(ms[ms.length - 1]!.folderName);
        // No processed months: nothing will ever load — settle the state so the
        // no-months EmptyState renders instead of an eternal blank "idle".
        else setLoadState("ready");
      })
      .catch(() => setLoadState("error"));
  }, [directoryHandle]);
…
      {loadState === "ready" && months.length === 0 && (
        <EmptyState
          icon={<CalendarOff />}
          title="لا توجد أشهر معالجة بعد"
          description="اعتماد الطلبات يعتمد على شهر معالج — ابدأ بمعالجة شهر من تبويب معالجة المجتمع."
        />
      )}
      {loadState === "ready" && months.length > 0 && activeList.length === 0 && (
        <EmptyState … />
      )}
```

**File:** `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayInspectionResults.tsx` — the
four `<p className="ew-empty">…</p>` states → `LoadingState` / `ErrorState` / `EmptyState`.
**File:** `src/components/Sidebar/Tabs/TemplateBuilder/index.tsx` — `tb-empty` div → `EmptyState`.
**File:** `src/components/Sidebar/Tabs/Population/index.tsx` — browse empty paragraph → `EmptyState`.

## v38.1 — 2026-07-02 — Report Designer aligned to the design system (DESIGN UIX-03)

Fixes UIX-03 from `docs/audit/FULL_SYSTEM_AUDIT_2026-07-02.md`: the Report Designer list
screen was visibly off-system — a bare `<h2>` instead of the `PageHeader` pattern every other
screen uses, GitHub-blue primary buttons (`#1f6feb`) instead of the brand navy tokens, and
plain-text empty/loading states. Now: `PageHeader` (eyebrow/title/subtitle + action slot),
`.rd-btn-primary` on `var(--c-navy)`/`var(--c-navy-2)`, and the shared `EmptyState`/
`LoadingState` views with a create-CTA in the empty state.

**File:** `src/components/Sidebar/Tabs/ReportDesigner/index.tsx`

**Before:**
```tsx
      <div className="rd-list-header">
        <h2 className="rd-title">مصمم التقارير</h2>
        {!showNewForm && (
          <button className="rd-btn rd-btn-primary" onClick={…}>+ تقرير جديد</button>
        )}
      </div>
…
      {loadingIndex ? (
        <p className="rd-loading">جاري التحميل…</p>
      ) : index.designs.length === 0 ? (
        <p className="rd-empty">لا توجد تقارير محفوظة بعد.</p>
      ) : (
```

**After:**
```tsx
      <PageHeader
        eyebrow="Report Designer"
        title="مصمم التقارير"
        subtitle="صمّم تقارير مخصصة — صفحات وعناصر ومخططات من بيانات الشهر المعالج."
      >
        {!showNewForm && (
          <button className="rd-btn rd-btn-primary" onClick={…}>+ تقرير جديد</button>
        )}
      </PageHeader>
…
      {loadingIndex ? (
        <LoadingState />
      ) : index.designs.length === 0 ? (
        <EmptyState
          icon={<LayoutTemplate />}
          title="لا توجد تقارير محفوظة بعد"
          description="أنشئ أول تقرير مخصص لبدء تصميم صفحاته وعناصره."
          actions={!showNewForm && (
            <button className="rd-btn rd-btn-primary" onClick={…}>+ تقرير جديد</button>
          )}
        />
      ) : (
```

**File:** `src/components/Sidebar/Tabs/ReportDesigner/ReportDesigner.css`

**Before:**
```css
.rd-btn-primary {
  background: #1f6feb;
  color: #fff;
  border-color: #1f6feb;
}
.rd-btn-primary:not(:disabled):hover {
  background: #1558c7;
  border-color: #1558c7;
}
```

**After:**
```css
.rd-btn-primary {
  background: var(--c-navy);
  color: #fff;
  border-color: var(--c-navy);
}
.rd-btn-primary:not(:disabled):hover {
  background: var(--c-navy-2);
  border-color: var(--c-navy-2);
}
```

## v38.0 — 2026-07-02 — Shared ConfirmDialog component; native window.confirm eliminated (FEATURE UIX-02)

Fixes UIX-02 from `docs/audit/FULL_SYSTEM_AUDIT_2026-07-02.md`: three destructive actions used
native `window.confirm()` — an unstyled LTR browser dialog with English chrome buttons, jarring
inside the Arabic RTL product and inconsistent with UserManagement's styled two-step confirm.
New shared `ConfirmDialog` (`src/components/ConfirmDialog/`): RTL, token-styled, danger
variant, focus is trapped and starts on "إلغاء" (safe default), Escape cancels, backdrop click
cancels, `role="dialog"` + `aria-modal`. All three native `confirm()` sites replaced.

**File:** `src/components/ConfirmDialog/ConfirmDialog.tsx` (new) — props:
`{ open, title?, message, confirmLabel?, cancelLabel?, danger?, onConfirm, onCancel }`.
**File:** `src/components/ConfirmDialog/ConfirmDialog.css` (new)

**File:** `src/components/Sidebar/Tabs/ReportDesigner/index.tsx`

**Before:**
```tsx
  async function handleDelete(reportId: string) {
    if (!directoryHandle) return;
    if (!window.confirm("هل أنت متأكد من حذف هذا التقرير؟")) return;
    setDeletingId(reportId);
```

**After:**
```tsx
  // Deletion is a two-step flow: the trash button arms confirmDeleteId and the
  // shared ConfirmDialog performs the actual delete (UIX-02).
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  async function handleDelete(reportId: string) {
    if (!directoryHandle) return;
    setDeletingId(reportId);
```
(delete button now calls `setConfirmDeleteId(id)`; a `<ConfirmDialog danger …>` at the root
runs `handleDelete` on confirm)

**File:** `src/components/Sidebar/Tabs/Population/components/MappingSettingsModal.tsx`

**Before:**
```tsx
  const handleRemoveSystemField = (key: string) => {
    if (!confirm(`هل أنت متأكد من حذف الحقل "${key}" من القائمة؟ يمكنك استعادته من الإعدادات الافتراضية.`)) return;
…
  const handleRemoveCustomField = (key: string) => {
    if (!confirm("هل أنت متأكد من حذف هذا الحقل المخصص؟")) return;
```

**After:**
```tsx
  // UIX-02: field removal is armed into pendingRemoval and executed by the
  // shared ConfirmDialog instead of native confirm().
  const [pendingRemoval, setPendingRemoval] = useState<
    { kind: "system" | "custom"; key: string } | null
  >(null);
…
  const handleRemoveSystemField = (key: string) => {
…(confirm call removed; body unchanged)
```
(a `<ConfirmDialog danger …>` in the modal executes the armed removal)

## v37.15 — 2026-07-02 — CLAUDE.md sync: tab table, bundle size, audit cross-link (DOCS TEC-03)

Fixes TEC-03 from `docs/audit/FULL_SYSTEM_AUDIT_2026-07-02.md`. The CLAUDE.md tab table was
stale: `template-builder` is no longer a standalone tab (it renders as the نموذج الفحص
sub-tab of employee-workspace), `report-designer` exists as a reports sub-tab, `change-log`
(order 96, admin) was missing, and roles for reports/archive were out of date. Bundle-size
note updated to the measured 2026-07-02 build (2,614 kB / 835 kB gzip — the `?raw` EDIT_LOG
import in the ChangeLog tab is part of that growth). Added the 2026-07-02 audit to the docs
cross-references.

**File:** `CLAUDE.md`

**Before:**
```
| `population` | `Tabs/Population/` | all | 10 |
| `employee-workspace` | `Tabs/EmployeeWorkspace/` | all | 15 |
| `template-builder` | `Tabs/TemplateBuilder/` | admin | 20 |
| `reports` | `Tabs/Reports/` | supervisor, admin | 25 |
| `archive` | `Tabs/Archive/` | supervisor, admin | 30 |
| `user-management` | `Tabs/UserManagement/` | admin | 40 |
| `settings` | `Tabs/Settings/` | guest, admin | 95 |
```

**After:**
```
| `population` | `Tabs/Population/` | all | 10 | `process`, `browse` |
| `employee-workspace` | `Tabs/EmployeeWorkspace/` | all | 15 | `ew/xray-referrals`, `ew/xray-results`, `ew/referral-approval`, `ew/inspection-form` (renders `Tabs/TemplateBuilder/`) |
| `reports` | `Tabs/Reports/` | guest, supervisor, manager, admin | 25 | `reports`, `kpi` (manager, admin), `report-designer` (supervisor, manager, admin → `Tabs/ReportDesigner/`) |
| `archive` | `Tabs/Archive/` | guest, supervisor, manager, admin | 30 | — |
| `user-management` | `Tabs/UserManagement/` | admin | 40 | `users`, `page-permissions`, `feature-permissions`, `activity` |
| `settings` | `Tabs/Settings/` | guest, admin | 95 | — |
| `change-log` | `Tabs/ChangeLog/` | admin | 96 | — |
```
(plus the bundle-size sentence update in "Build & dependency gotchas")

## v37.14 — 2026-07-02 — ZATCA logo bundled locally; no more zatca.gov.sa hot-link (BUGFIX VIS-05)

Fixes VIS-05 from `docs/audit/FULL_SYSTEM_AUDIT_2026-07-02.md`: the brand logo was hot-linked
from `https://zatca.gov.sa/...` in four places (sidebar, sign-in screen, executive-report
cover, deck title slide). The product's core promise is a self-contained offline
`dist/index.html` — and the generated reports are themselves standalone HTML files — so the
logo silently broke without network (and made an external request from a government tool).
The official SVG (36.9 kB, unmodified) now lives at `src/branding/zatca-logo.svg`, imported
`?raw` and exposed as a `data:` URI so it works in dev, in the single-file build, and inside
downloaded reports. `ZATCA_LOGO_URL` keeps its name so existing consumers are unchanged.

**File:** `src/branding/zatca-logo.svg` (new — official mark, downloaded 2026-07-02)

**File:** `src/branding/organization.ts`

**Before:**
```ts
export const ZATCA_LOGO_URL =
  "https://zatca.gov.sa/_layouts/15/zatca/Design/images/ZATCA-logo.svg";
```

**After:**
```ts
import zatcaLogoRaw from "./zatca-logo.svg?raw";

/** Self-contained data URI: works offline in the app, the single-file build,
 *  and inside generated standalone HTML reports (VIS-05). */
export const ZATCA_LOGO_URL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(zatcaLogoRaw)}`;
```

**File:** `src/auth/AuthGate.tsx` — sign-in logo `src` now `ZATCA_LOGO_URL` (was the literal URL).
**File:** `src/data/reporting/executive/document/frontMatter.ts` — cover logo `src` now interpolates `ZATCA_LOGO_URL`.
**File:** `src/data/reporting/executive/deck/slides.ts` — title-slide logo `src` now interpolates `ZATCA_LOGO_URL`.
(all three keep their existing `onerror` fallbacks)

## v37.13 — 2026-07-02 — ChangeLog tab: bidi-correct English prose + Western digits (BUGFIX VIS-03/VIS-04)

Fixes VIS-03/VIS-04 from `docs/audit/FULL_SYSTEM_AUDIT_2026-07-02.md`. Entry bodies and titles
in سجل الإصدارات are mostly English commit prose but rendered inside the RTL container, so
periods/punctuation landed on the wrong side (".Implements Task 5 …") and text was
right-aligned. Prose paragraphs, per-line spans, and entry titles now carry `dir="auto"`
(browser picks direction per block from its first strong character) with `text-align: start`.
The total-versions counter used `toLocaleString("ar-SA")` (Arabic-Indic ١٨٨) against the
app-wide Western-digit standard — now uses the shared `formatNumber` (`ar-SA-u-nu-latn`).

**File:** `src/components/Sidebar/Tabs/ChangeLog/index.tsx`

**Before:**
```tsx
          <span className="cl-summary-value">{entries.length.toLocaleString("ar-SA")}</span>
…
        <p key={`p-${key++}`} className="cl-prose">
          {trimmed.split("\n").map((ln, i) => (
            <span key={i} className="cl-prose-line">
…
                  <span className="cl-item-title">{entry.title}</span>
```

**After:**
```tsx
          <span className="cl-summary-value">{formatNumber(entries.length)}</span>
…
        <p key={`p-${key++}`} className="cl-prose" dir="auto">
          {trimmed.split("\n").map((ln, i) => (
            <span key={i} className="cl-prose-line" dir="auto">
…
                  <span className="cl-item-title" dir="auto">{entry.title}</span>
```
(plus `import { formatNumber } from "../../../../utils/formatting";`)

**File:** `src/components/Sidebar/Tabs/ChangeLog/ChangeLog.css`

**Before:**
```css
.cl-prose-line { display: block; }
```

**After:**
```css
.cl-prose-line { display: block; }

/* VIS-03: dir="auto" picks the direction; align to that direction, not the
   RTL container, so English lines read left-to-right with sane punctuation. */
.cl-prose,
.cl-prose-line,
.cl-item-title {
  text-align: start;
}
```

## v37.12 — 2026-07-02 — Permission matrices: visible scrollbar + sticky label column (BUGFIX VIS-02)

Fixes VIS-02 from `docs/audit/FULL_SYSTEM_AUDIT_2026-07-02.md`: on the صلاحيات الصفحات and
صلاحيات الميزات matrices the leftmost role column (مدير) was clipped at laptop widths
(entirely invisible at 1280×800). The wrapper *was* `overflow-x: auto`, but Windows overlay
scrollbars gave zero affordance that more columns existed. Fix: always-visible thin scrollbar
on both matrix wrappers + the page/feature label column is now `position: sticky` at the
inline start, so the row labels stay put while the role columns scroll.

**File:** `src/components/Sidebar/Tabs/UserManagement/UserManagement.css`

**Before:**
```css
.um-perm-table-wrap {
  overflow-x: auto;
  border: 1px solid var(--app-border);
  border-radius: 14px;
}
```

**After:**
```css
.um-perm-table-wrap {
  overflow-x: auto;
  border: 1px solid var(--app-border);
  border-radius: 14px;
  /* VIS-02: overlay scrollbars hide the fact that role columns overflow —
     force a visible thin scrollbar so the مدير column is discoverable. */
  scrollbar-width: thin;
  scrollbar-color: var(--c-border-2) var(--c-surface-2);
}

.um-perm-table-wrap::-webkit-scrollbar,
.um-feat-matrix-wrap::-webkit-scrollbar {
  height: 10px;
}

.um-perm-table-wrap::-webkit-scrollbar-thumb,
.um-feat-matrix-wrap::-webkit-scrollbar-thumb {
  background: var(--c-border-2);
  border-radius: 999px;
}

.um-perm-table-wrap::-webkit-scrollbar-track,
.um-feat-matrix-wrap::-webkit-scrollbar-track {
  background: var(--c-surface-2);
}

/* VIS-02: keep the label column pinned while role columns scroll. */
.um-perm-tab-col,
.um-perm-tab-name,
.um-feat-label-col,
.um-feat-name {
  position: sticky;
  inset-inline-start: 0;
  z-index: 2;
}
```
(plus the same `scrollbar-width`/`scrollbar-color` addition on `.um-feat-matrix-wrap`, and an
explicit `background: #ffffff` on `.um-feat-name` / reliance on existing row backgrounds for
`.um-perm-tab-name` so pinned cells don't turn transparent while scrolling)

## v37.11 — 2026-07-02 — Demo banner moved in-flow; no longer covers the session toolbar (BUGFIX VIS-01)

Fixes VIS-01 from `docs/audit/FULL_SYSTEM_AUDIT_2026-07-02.md`: the demo-mode banner was
`position: fixed; top: 0; z-index: 9999`, sitting on top of the sticky `AdminToolbar`
(z-index 1000). The toolbar — including the **logout button** — was visually clipped and
completely unclickable in demo mode (verified via `elementFromPoint`). The banner is now a
normal in-flow element rendered *after* the toolbar and *before* the app shell, so nothing
overlaps; its inline styles moved to an `.app-demo-banner` class in `App.css`.

**File:** `src/App.tsx`

**Before:**
```tsx
  return (
    <main className={`app-shell ${isSidebarCollapsed ? "sidebar-collapsed" : ""}`} dir="rtl">
      {session.mode === "demo" && (
        <div role="status" dir="rtl"
          style={{ position: "fixed", insetInlineStart: 0, insetInlineEnd: 0, top: 0,
            zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center",
            gap: 8, padding: "7px 14px", fontSize: 12.5, fontWeight: 700, color: "#fff",
            background: "linear-gradient(90deg, var(--c-navy-2), var(--c-navy))",
            borderBottom: "1px solid var(--brand-premium)" }}>
          وضع العرض التجريبي — للقراءة فقط (التعديل والحفظ معطّلان، والتصدير متاح)
        </div>
      )}
      {bakWarning && (
```

**After:**
```tsx
  return (
    <>
      {session.mode === "demo" && (
        <div role="status" dir="rtl" className="app-demo-banner">
          وضع العرض التجريبي — للقراءة فقط (التعديل والحفظ معطّلان، والتصدير متاح)
        </div>
      )}
      <main className={`app-shell ${isSidebarCollapsed ? "sidebar-collapsed" : ""}`} dir="rtl">
        {bakWarning && (
```
(closing tag becomes `</main></>`; indentation of the main block otherwise unchanged)

**File:** `src/App.css`

**Before:**
```css
.app-backup-toast {
```

**After:**
```css
.app-demo-banner {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 7px 14px;
  font-size: 12.5px;
  font-weight: 700;
  color: #fff;
  background: linear-gradient(90deg, var(--c-navy-2), var(--c-navy));
  border-bottom: 1px solid var(--brand-premium);
}

.app-backup-toast {
```

## v37.10 — 2026-07-02 — Demo session registered with authSession module; demo never persisted (BUGFIX LOG-01/LOG-02)

Fixes LOG-01 from `docs/audit/FULL_SYSTEM_AUDIT_2026-07-02.md`: the demo/viewer auto-login
stored the session **only in AuthGate React state** and never called `writeSession()`, so
`usePermissions()` → `readSession()` returned `null` → guest fallback → every `TabGuard`
rendered "غير مصرح" while the sidebar (fed by the prop session) still showed all tabs. Demo
mode now writes through `writeSession()` so both consumers see the same session (also closes
LOG-02's observed disagreement). Safety: `writeSession` now keeps `mode: "demo"` sessions
**runtime-only** — it clears rather than writes sessionStorage — so a read-only demo identity
can never survive a reload and attach to a real workspace. Regression tests added.

**File:** `src/auth/authSession.ts`

**Before:**
```ts
export function writeSession(session: AuthSession): void {
  runtimeSession = session;
  writeStoredSession(session);
  startAuthActivitySession(session);
}
```

**After:**
```ts
export function writeSession(session: AuthSession): void {
  runtimeSession = session;
  // Demo sessions are runtime-only: never persisted, so a read-only demo
  // identity can't survive a reload and attach to a real workspace (LOG-01).
  if (session.mode === "demo") {
    clearStoredSession();
  } else {
    writeStoredSession(session);
  }
  startAuthActivitySession(session);
}
```

**File:** `src/auth/AuthGate.tsx`

**Before:**
```tsx
    if (!session && directoryHandle?.name === DEMO_WORKSPACE_NAME) {
      isDemoSessionRef.current = true;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- derive the demo session from the mounted demo workspace; guarded by !session so it settles in one step
      setSession({
        role: ADMIN_ROLE,
        username: VIEWER_USERNAME,
        loginAt: new Date().toISOString(),
        mode: "demo"
      });
    }
```

**After:**
```tsx
    if (!session && directoryHandle?.name === DEMO_WORKSPACE_NAME) {
      isDemoSessionRef.current = true;
      const demoSession: AuthSession = {
        role: ADMIN_ROLE,
        username: VIEWER_USERNAME,
        loginAt: new Date().toISOString(),
        mode: "demo"
      };
      // LOG-01: register the session with the authSession module too, so
      // permission checks (usePermissions → readSession) agree with the UI.
      writeSession(demoSession);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- derive the demo session from the mounted demo workspace; guarded by !session so it settles in one step
      setSession(demoSession);
    }
```

**File:** `src/auth/authSession.test.ts` — added tests: demo session readable via
`readSession`/`readRealSession` but absent from (fake) `sessionStorage`; normal session
persisted; demo write clears a previously persisted session.

## v37.9 — 2026-07-02 — EDIT_LOG NUL-byte cleanup + .gitattributes text rules (TOOLING)

Closes the remainder of DATA-02 from `docs/audit/MASTER_AUDIT_REPORT.md`: one stray NUL byte
was still embedded in this file (enough for `file`/`grep` to classify it as binary). Stripped
byte-level (no textual content changed) and added a repo `.gitattributes` declaring `*.md`,
`*.ts(x)`, `*.css`, `*.json` as text so future corruption is caught in diffs instead of
silently degrading the audit trail.

**File:** `docs/EDIT_LOG.md` — byte-level NUL strip, content unchanged.
**File:** `.gitattributes` (new)

**Before:**
```
(file did not exist)
```

**After:**
```
*.md text
*.ts text
*.tsx text
*.css text
*.json text
```

## v37.8 — 2026-07-02 — Full system audit (code + UI/UX + product) and prototype→final-product plan (DOCS)

Documentation-only change. Adds `docs/audit/FULL_SYSTEM_AUDIT_2026-07-02.md`: a whole-product
audit performed by driving the live app in Chromium (all tabs, two viewport sizes, DOM-level
verification of suspected bugs) plus a code sweep, extending the 2026-06-28 master audit.

Key new findings registered: LOG-01 (demo session never passes through `writeSession`, so
`usePermissions` falls back to guest and demo mode renders "غير مصرح" on most tabs), VIS-01
(fixed demo banner overlays the toolbar — logout unclickable), VIS-02 (page-permissions matrix
clips the مدير column at ≤1440px with no horizontal scroll), VIS-03/04 (ChangeLog bidi and
numeral inconsistencies), VIS-05 (ZATCA logo hot-linked from zatca.gov.sa — breaks offline),
UIX-01 (StateViews library adopted only in App.tsx; empty states inconsistent), UIX-02 (three
native `window.confirm()` sites vs the styled confirm pattern), TEC-01 (bundle grew to
2,614 kB / 835 kB gzip; full EDIT_LOG ships in the bundle via `?raw`), TEC-04 (~1,400 raw hex
colors bypass the token system). Consolidates all open items into Milestones A–E
(bugs → consistency → completeness → hardening → sign-off).

**File:** `docs/audit/FULL_SYSTEM_AUDIT_2026-07-02.md`

**Before:**
```
(new file)
```

**After:**
```
Full audit findings register (LOG/VIS/UIX/TEC series) + 5-milestone roadmap; see file.
```

## v36.4 — 2026-07-01 — Change Log admin tab + shared EmptyState/LoadingState/ErrorState primitives (FEATURE)

Renumbered from an initial `v35.0` to `v36.4` to avoid colliding with the `v35.0`–`v36.3`
entries already logged further below — those documented this same feature area (state-view
primitives, an admin "سجل الإصدارات" version/edit-history tab, logs-tab sorting) but had no
matching code committed to `main`; this commit is the actual implementation catching up to
that log, landing as its own entry rather than replacing the historical ones.

Phase 1/2 of `docs/UI_ENHANCEMENT_PLAN.md`: a new admin-only **Change Log** tab that parses
and renders `docs/EDIT_LOG.md` itself (via a Vite `?raw` import) as a searchable, versioned
timeline — no separate content to maintain, the log is always the source of truth. Also adds
`src/components/StateViews/StateViews.tsx`, a shared `EmptyState`/`LoadingState`/`ErrorState`/
`Skeleton` component library so the "nothing here yet" / "working…" / "something went wrong"
moments render identically across every tab, replacing the ad hoc `NoAvailableTabs` markup in
`App.tsx`. Registered the tab in `MANAGED_TABS` / `createDefaultPermissions()` (admin-only,
`edit`) per the tab-registration convention in `CLAUDE.md`. Added `src/vite-env.d.ts` for the
Vite client type reference the `?raw` import needs. Assorted spacing/primitive polish in
`primitives.css`, `AdminToolbar`, `Sidebar`, and a few data screens toward the same plan.

**File:** `src/components/Sidebar/Tabs/ChangeLog/index.tsx` (new)

Parses `## v{version} — {date} — {title} (TAG)` headings from `EDIT_LOG.md`, sorts newest-first,
renders each entry as a collapsible card with a lightweight inline markdown renderer (bold,
inline code, fenced code blocks) and a client-side search box.

**File:** `src/components/StateViews/StateViews.tsx` (new)

Exports `EmptyState`, `LoadingState`, `ErrorState`, `Skeleton` — shared surfaces styled via
`.ui-state` / `.ui-spinner` / `.ui-skeleton` in `primitives.css`.

**File:** `src/App.tsx`

**Before:**
```tsx
function NoAvailableTabs({ role }: { role: AuthSession["role"] }) {
  return (
    <div className="tab-blank" dir="rtl">
      <div className="app-no-tabs">
        <div>
          <h1>لا توجد تبويبات متاحة</h1>

          <p>
            لا توجد صفحات مفعلة لهذا الدور حالياً: <strong>{role}</strong>
          </p>
        </div>
      </div>
    </div>
  );
}
```

**After:**
```tsx
function NoAvailableTabs({ role }: { role: AuthSession["role"] }) {
  return (
    <div className="tab-blank" dir="rtl">
      <EmptyState
        icon={<LayoutGrid />}
        title="لا توجد تبويبات متاحة"
        description={
          <>
            لا توجد صفحات مفعلة لهذا الدور حالياً: <strong>{role}</strong>
          </>
        }
      />
    </div>
  );
}
```

**File:** `src/auth/userManagement.ts`

**Before:**
```ts
  { id: "settings",                label: "إدارة الإعدادات" },
];
```

**After:**
```ts
  { id: "settings",                label: "إدارة الإعدادات" },
  { id: "change-log",              label: "سجل الإصدارات" },
];
```

Added matching `change-log` rows to `createDefaultPermissions()` (admin: `edit`, all other
roles: `none`).

---

## v34.7 — 2026-07-01 — Deck: Western digits everywhere + fix RTL bidi reversal of number ranges (BUG)

Two fixes, both must-rules for the report:

1. **All numbers in English (Western) digits, never Arabic-Indic.** The agenda slide's
   range chips were hand-typed with Arabic-Indic digits (٠٣, ٠٤, ٠٥–٠٩, ١٠–١٥). Audited the
   whole `executive/` tree with a Unicode-aware search — that was the only real violation
   (existing `fmtNum`/date formatting already force `-u-nu-latn`, i.e. Western digits).

2. **Ranges are now computed, never hand-typed.** `agendaSlide` previously stated its slide
   ranges as static literals with a comment claiming "the deck's slide order is fixed... so
   these ranges are safe to state directly" — the same anti-pattern already fixed in the
   Document's TOC. `buildDeckSlides` now groups slide builders into named sections and
   computes each section's real start/end slide number from the actual build sequence and
   total slide count, so the agenda can never drift from reality if slides are
   added/removed/reordered.

3. **RTL bidi was visually reversing every number range/pair.** `"02 / 15"` and `"05–09"`
   are correct in the DOM, but inside a `direction:rtl` container the browser's bidi
   algorithm re-orders them for display (rendered as "15 / 02", "09–05"). Fixed by adding
   `dir="ltr"` to both the slide-position badge and the agenda range chip, which isolates
   the numeric run and forces correct left-to-right display regardless of RTL context.

**File:** `src/data/reporting/executive/deck/slides.ts`

**Before:**
```ts
export function agendaSlide(num: number, total: number): string {
  // Static roadmap — the deck's slide order is fixed…
  const items = [
    { title: "…", blurb: "…", range: "٠٣" },
    { title: "…", blurb: "…", range: "٠٤" },
    { title: "…", blurb: "…", range: "٠٥–٠٩" },
    { title: "…", blurb: "…", range: "١٠–١٥" },
  ];
  // … <div class="deck-agenda-range">${it.range}</div> …
}

export function buildDeckSlides(model: ReportModel): string {
  const builders = [execSummarySlide, scopeSlide, verdictSlide, /* …flat list… */];
  const total = builders.length + 2;
  const slides = [titleSlide(model), agendaSlide(2, total)];
  builders.forEach((build, i) => slides.push(build(model, i + 3, total)));
  return slides.join("\n");
}
```

**After:**
```ts
export type AgendaItem = { title: string; blurb: string; range: string };

export function agendaSlide(items: AgendaItem[], num: number, total: number): string {
  // items computed by buildDeckSlides from the real build sequence — never hand-typed.
  // … <div class="deck-agenda-range" dir="ltr">${it.range}</div> …
}

type DeckSection = { title: string; blurb: string; builders: Array<(m, num, total) => string> };

export function buildDeckSlides(model: ReportModel): string {
  const sections: DeckSection[] = [
    { title: "ملخص المؤشرات الرئيسية", blurb: "…", builders: [execSummarySlide] },
    { title: "مجتمع وعينة الفحص", blurb: "…", builders: [scopeSlide] },
    { title: "نتائج دقة الأشعة", blurb: "…", builders: [verdictSlide, portsSlide, levelSlide, corroborationSlide, driversSlide] },
    { title: "الدراسات المتقدمة", blurb: "…", builders: [topInspectorsSlide, supportSlide, riskSlide, actionsSlide, decisionsSlide, nextPeriodSlide] },
  ];
  const total = sections.reduce((sum, s) => sum + s.builders.length, 0) + 2;
  let cursor = 3;
  const agendaItems: AgendaItem[] = sections.map((s) => {
    const start = cursor, end = cursor + s.builders.length - 1;
    cursor = end + 1;
    return { title: s.title, blurb: s.blurb, range: end > start ? `${padNum(start)}–${padNum(end)}` : padNum(start) };
  });
  const slides = [titleSlide(model), agendaSlide(agendaItems, 2, total)];
  let num = 3;
  for (const section of sections) for (const build of section.builders) { slides.push(build(model, num, total)); num += 1; }
  return slides.join("\n");
}
```

**File:** `src/data/reporting/executive/deck/shared.ts`

**Before:**
```ts
<span class="slide-num">${pad(opts.num)} / ${pad(opts.total)}</span>
```

**After:**
```ts
<span class="slide-num" dir="ltr">${pad(opts.num)} / ${pad(opts.total)}</span>
```

---

## v34.6 — 2026-07-01 — Deck: add الفهرس (agenda) slide as new slide 2 (FEATURE)

New slide 2 — a roadmap/agenda slide inserted right after the title slide, before the
executive summary (which shifts to slide 3). Deck grows 14 → 15 slides. Lists 4 sections
in reading order — ملخص المؤشرات الرئيسية (→ slide 3), مجتمع وعينة الفحص (→ slide 4),
نتائج دقة الأشعة (→ slides 5–9), الدراسات المتقدمة (→ slides 10–15) — each with a one-line
"what this answers" blurb and a real slide-range chip, colored gold/blue/green/coral. Since
the deck's slide order is fixed (unlike the Document's dynamic per-port pages), the ranges
are stated directly rather than computed at build time.

**File:** `src/data/reporting/executive/deck/slides.ts`

**Before:**
```ts
// ── Slide 2 — Executive summary ────────────────────────────────────────────
export function execSummarySlide(model: ReportModel, num: number, total: number): string {
```

**After:**
```ts
// ── Slide 2 — الفهرس (agenda / roadmap) ─────────────────────────────────────
export function agendaSlide(num: number, total: number): string {
  const items: { title: string; blurb: string; range: string }[] = [
    { title: "ملخص المؤشرات الرئيسية", blurb: "الأرقام التي تحدد الحكم في نظرة واحدة.", range: "٠٣" },
    { title: "مجتمع وعينة الفحص", blurb: "ماذا فحصنا، وبأي تغطية؟", range: "٠٤" },
    { title: "نتائج دقة الأشعة", blurb: "هل قرارات المستويين دقيقة أمنيًا، وهل تتفق الفرق الأخرى؟", range: "٠٥–٠٩" },
    { title: "الدراسات المتقدمة", blurb: "من الأدق بين المفتشين، وما الإجراء المطلوب؟", range: "١٠–١٥" },
  ];
  // … renders 4 .deck-agenda-item rows …
}

// ── Slide 3 — Executive summary ────────────────────────────────────────────
export function execSummarySlide(model: ReportModel, num: number, total: number): string {
```

Also: all subsequent `// ── Slide N —` comments renumbered +1; `buildDeckSlides` special-cases
`agendaSlide(2, total)` alongside `titleSlide` (it needs no `model`); `total = builders.length + 2`.

**File:** `src/data/reporting/executive/deck/deckTheme.ts` — new `.deck-agenda`,
`.deck-agenda-item`, `.deck-agenda-num`, `.deck-agenda-body`, `.deck-agenda-range` rules
(colored left-accent bar + number badge per item: gold/blue/green/coral).

**File:** `src/data/reporting/executive/deck/deck.test.ts` — `EXPECTED_TITLES` gains
"الفهرس"; slide-count assertions updated 14 → 15.

---


## v37.6 — 2026-07-01 — Docs updated for renamed workspace file structure

Task 9 of the workspace file/folder naming convention refactor. Documentation-only change: brings `docs/data-system-report.md`, `CLAUDE.md`, and `README.md` in line with the numbered-lowercase-kebab-case workspace layout that Tasks 1–8 already implemented in code (see the `v37.0`–`v37.5` entries above for the actual code changes). No source files touched.

**File:** `docs/data-system-report.md` (Workspace Folder Data table)

**Before:**
```md
| `1-Population/` | Monthly population runs, source import data, final processed population, processing summaries, population config. |
| `2-Samples/` | Sample master files, distribution log/current snapshot, main sample mirrors, per-employee sample mirrors, answers, referral/replacement requests, supervisor approval decisions. |
| `3-User Data/` | Workspace user/permission files when initialized through workspace defaults. |
| `4-Reports/` | Generated/report artifacts when report flows write to the workspace. |
| `5-System/` | Backups, browse/table presets, automatic-backup settings/state, activity audit log, internal system files. |
| `6-Templates/` | Inspection templates and template index/selection files. |
```

**After:**
```md
| `1-population/` | Monthly population runs, source import data, final processed population, processing summaries, population config. |
| `2-samples/` | Sample master files, distribution log/current snapshot, main sample mirrors, per-employee sample mirrors, answers, referral/replacement requests, supervisor approval decisions. |
| `3-user-data/` | Workspace user/permission files when initialized through workspace defaults. |
| `4-reports/` | Generated/report artifacts when report flows write to the workspace. |
| `5-system/` | Backups, browse/table presets, automatic-backup settings/state, activity audit log, internal system files. |
| `6-templates/` | Inspection templates and template index/selection files. |
```

**File:** `docs/data-system-report.md` (Population And Sample Files table)

**Before:**
```md
| `month.manifest.json` | `1-Population/{month}/` | Month metadata: month/year, processed counts, status, operator info. |
| `risk.raw.json` | `1-Population/{month}/raw/` or legacy month folder | Imported risk rows. |
| `bi.raw.json` | `1-Population/{month}/raw/` or legacy month folder | Imported BI rows when provided. |
| `population.final.json` | `1-Population/{month}/processed/` or legacy month folder | Final processed population rows used for sampling and reporting. |
| `processing.summary.json` | `1-Population/{month}/processed/` | Processing summary/validation data. |
| `sample.master.json` | `2-Samples/{month}/1-Main/` | Drawn sample rows and sample configuration/result metadata. |
| `distribution.log.json` | `2-Samples/{month}/1-Main/` | Append-only assignment event log. |
| `distribution.current.json` | `2-Samples/{month}/1-Main/` | Derived current distribution snapshot. |
| `main.samples.json` | `2-Samples/{month}/1-Main/` | Mirror of all assigned sample entries. |
| `{username}.samples.json` | `2-Samples/{month}/2-Employees/` | Per-employee sample mirror. |
| `{username}.answers.json` | `2-Samples/{month}/2-Employees/` | Employee answers plus referral/replacement requests for that employee. |
| `{supervisor}.decisions.json` | `2-Samples/{month}/3-Approvals/` | Supervisor referral/replacement decisions. |
| `auth-activity.log.json` | `5-System/2-Audit/` | Sign-in and working-hours audit log. |
```

**After:**
```md
| `month.manifest.json` | `1-population/{month}/` | Month metadata: month/year, processed counts, status, operator info. |
| `risk.raw.json` | `1-population/{month}/1-raw/` or legacy month folder | Imported risk rows. |
| `bi.raw.json` | `1-population/{month}/1-raw/` or legacy month folder | Imported BI rows when provided. |
| `population.final.json` | `1-population/{month}/2-processed/` or legacy month folder | Final processed population rows used for sampling and reporting. |
| `processing.summary.json` | `1-population/{month}/2-processed/` | Processing summary/validation data. |
| `sample.master.json` | `2-samples/{month}/1-main/` | Drawn sample rows and sample configuration/result metadata. |
| `distribution.log.json` | `2-samples/{month}/1-main/` | Append-only assignment event log. |
| `distribution.current.json` | `2-samples/{month}/1-main/` | Derived current distribution snapshot. |
| `main.samples.json` | `2-samples/{month}/1-main/` | Mirror of all assigned sample entries. |
| `{username}.samples.json` | `2-samples/{month}/2-employees/` | Per-employee sample mirror. |
| `{username}.answers.json` | `2-samples/{month}/2-employees/` | Employee answers plus referral/replacement requests for that employee. |
| `{supervisor}.decisions.json` | `2-samples/{month}/3-approvals/` | Supervisor referral/replacement decisions. |
| `activity.log.json` | `5-system/audit/` | Sign-in and working-hours audit log. |
```

**File:** `docs/data-system-report.md` (Distribution And Employee Data Dictionary table — same rename, missed in the plan's Step 1 text but caught by the grep sweep)

**Before:**
```md
| `auth-activity.log.json` | `revision`, `updatedAt`, `entries[]`. |
```

**After:**
```md
| `activity.log.json` | `revision`, `updatedAt`, `entries[]`. |
```

**File:** `docs/data-system-report.md` (Default Inspection Template sentence)

**Before:**
```md
The template is saved as a normal template file in `6-Templates/{templateId}.json`, listed in `templates.index.json`, and can be selected through `inspection-template-selection.json`.
```

**After:**
```md
The template is saved as a normal template file in `6-templates/{templateId}.json`, listed in `templates.index.json`, and can be selected through `template.selection.json`.
```

**File:** `docs/data-system-report.md` (`4-Reports/designs/` section header + table)

**Before:**
```md
## 4-Reports/designs/

| `designs.index.json` | `4-Reports/designs/` | Index of all saved report designs (`JsonEnvelope<DesignIndex>`)... |
| `{reportId}.json` | `4-Reports/designs/` | Individual `ReportDocument` persisted as `JsonEnvelope<ReportDocument>`... |
```

**After:**
```md
## 4-reports/designs/

| `designs.index.json` | `4-reports/designs/` | Index of all saved report designs (`JsonEnvelope<DesignIndex>`)... |
| `{reportId}.json` | `4-reports/designs/` | Individual `ReportDocument` persisted as `JsonEnvelope<ReportDocument>`... |
```

**File:** `docs/data-system-report.md` (Templates, Preferences, Backups table)

**Before:**
```md
| `templates.index.json` | `6-Templates/` | Template list and latest versions. |
| `{templateId}.json` | `6-Templates/` | Inspection template schema and fields. |
| `inspection-template-selection.json` | `6-Templates/` | Selected active inspection template. |
| `admin-shared.browse-preset.json` | `5-System/user-presets/` | Shared/admin table column preferences. |
| `{username}.browse-preset.json` | `5-System/user-presets/` | User-specific table column preferences. |
| `backup.manifest.json` and copied data files | `5-System/3-Backups/{timestamp}/` | Manual/automatic backup snapshots. |
| `population.csv` | `5-System/powerbi-export/{month}/` | All `ExecutiveReportRow` records (UTF-8 BOM CSV, 26 columns). |
| `sample.csv` | `5-System/powerbi-export/{month}/` | `selectedInSample=true` subset of `population.csv`. |
| `LISEZMOI.txt` | `5-System/powerbi-export/{month}/` | Bilingual connection instructions (Arabic + English) for Power BI Desktop. |
```

**After:**
```md
| `templates.index.json` | `6-templates/` | Template list and latest versions. |
| `{templateId}.json` | `6-templates/` | Inspection template schema and fields. |
| `template.selection.json` | `6-templates/` | Selected active inspection template. |
| `admin-shared.browse-preset.json` | `5-system/user-presets/` | Shared/admin table column preferences. |
| `{username}.browse-preset.json` | `5-system/user-presets/` | User-specific table column preferences. |
| `backup.manifest.json` and copied data files | `5-system/backups/{timestamp}/` | Manual/automatic backup snapshots. |
| `population.csv` | `5-system/powerbi-export/{month}/` | All `ExecutiveReportRow` records (UTF-8 BOM CSV, 26 columns). |
| `sample.csv` | `5-system/powerbi-export/{month}/` | `selectedInSample=true` subset of `population.csv`. |
| `README.txt` | `5-system/powerbi-export/{month}/` | Bilingual connection instructions (Arabic + English) for Power BI Desktop. |
```

The "Legacy folders still read when present: `Population/`, `.system/`, and `templates/`." line was left unchanged — it still correctly describes the pre-numbering legacy fallback.

**File:** `CLAUDE.md` (Disk layout tree + month-folder pattern)

**Before:**
```md
1-Population/
  {month}-{MonthName-en}-{year}/   ← e.g. 5-May-2026 (legacy: files flat in folder)
    month.manifest.json
    raw/        risk.raw.json, bi.raw.json (BI only if present)
    processed/  population.final.json, processing.summary.json
2-Samples/
  {month}/1-Main/   sample.master.json, distribution.log.json (append-only),
                    distribution.current.json (derived), main.samples.json
  {month}/…        per-employee sample mirrors, answers, referral/replacement, approvals
3-User Data/       workspace user/permission files (when initialized via workspace defaults)
4-Reports/         generated report artifacts (when report flows write to disk)
5-System/          backups/, browse & table presets, auto-backup settings/state, activity audit log
6-Templates/       {templateId}.json, templates.index.json, template selection
```

Month folder names follow the pattern `{month}-{MonthName-en}-{year}` (e.g. `5-May-2026`).

**After:**
```md
1-population/
  {month}-{monthname-en}-{year}/   ← e.g. 5-may-2026 (legacy: files flat in folder)
    month.manifest.json
    1-raw/       risk.raw.json, bi.raw.json (BI only if present)
    2-processed/ population.final.json, processing.summary.json
2-samples/
  {month}/1-main/   sample.master.json, distribution.log.json (append-only),
                    distribution.current.json (derived), main.samples.json
  {month}/…        per-employee sample mirrors, answers, referral/replacement, approvals
3-user-data/       workspace user/permission files (when initialized via workspace defaults)
4-reports/         generated report artifacts (when report flows write to disk)
5-system/          backups/, browse & table presets, auto-backup settings/state, activity audit log
6-templates/       {templateId}.json, templates.index.json, template selection
```

Month folder names follow the pattern `{month}-{monthname-en}-{year}`, lowercase (e.g. `5-may-2026`).

**File:** `README.md` (Workspace Folder Layout tree + month-folder pattern)

**Before:**
```md
Root (user picks this folder)
├── 1-Population/
│   └── {MM-MonthName-YYYY}/          # One folder per processed month
│       ├── month.manifest.json
│       ├── risk.raw.json
│       ├── population.final.json
│       ├── bi.raw.json                # Optional, only if BI rows present
│       ├── sample/
│       │   └── sample.master.json
│       ├── distribution.log.json      # Append-only event log
│       ├── distribution.current.json  # Derived snapshot
│       └── employee-answers/
│           └── {username}.answers.json
├── 2-Samples/
│   └── {MM-MonthName-YYYY}/
│       ├── main.samples.json
│       └── {username}.samples.json
├── 3-User Data/
│   ├── users-permissions.json
│   └── managed-users.json
├── 6-Templates/
│   ├── {templateId}.json
│   └── templates.index.json
└── 5-System/
    └── backups/
        └── {YYYY-MM-DDTHH-MM-SS}/    # Backup snapshots
```

Month folder names follow the pattern `{month}-{MonthName-en}-{year}` (e.g., `5-May-2026`).

**After:**
```md
Root (user picks this folder)
├── 1-population/
│   └── {MM-monthname-YYYY}/          # One folder per processed month
│       ├── month.manifest.json
│       ├── 1-raw/
│       │   ├── risk.raw.json
│       │   └── bi.raw.json            # Optional, only if BI rows present
│       ├── 2-processed/
│       │   └── population.final.json
│       ├── distribution.log.json      # Append-only event log
│       └── distribution.current.json  # Derived snapshot
├── 2-samples/
│   └── {MM-monthname-YYYY}/
│       ├── 1-main/
│       │   ├── sample.master.json
│       │   └── main.samples.json
│       └── 2-employees/
│           └── {username}.samples.json
├── 3-user-data/
│   ├── users-permissions.json
│   └── managed-users.json
├── 6-templates/
│   ├── {templateId}.json
│   └── templates.index.json
└── 5-system/
    └── backups/
        └── {YYYY-MM-DDTHH-MM-SS}/    # Backup snapshots
```

Month folder names follow the pattern `{month}-{monthname-en}-{year}`, lowercase (e.g., `5-may-2026`).

---

## v37.5 — 2026-07-01 — Backups folder centralize + template selection file rename

Task 8 of the workspace file/folder naming convention refactor. Two changes: (1) `backupStorage.ts` now sources `BACKUPS_FOLDER` from `SYSTEM_FOLDER_NAMES.backups` (i.e., `"backups"`, lowercase, unnumbered) instead of a hardcoded `"3-Backups"` literal, centralizing folder-name references; (2) template selection file renamed from `active.inspection-template.json` to `template.selection.json` to match the `entity.qualifier.json` file-naming convention. Also fixed `templateStorage.test.ts`'s hardcoded `"6-Templates"` reference to match the lowercased root already set in Task 1.

**File:** `src/data/backup/backupStorage.ts`

**Before:**
```ts
import {
  getPopulationMonthDir,
  getSampleMainDir,
  getSystemRoot,
  getTemplatesRoot,
  WORKSPACE_ROOTS,
} from "../workspace/workspacePaths";

const BACKUPS_FOLDER = "3-Backups";
```

**After:**
```ts
import {
  getPopulationMonthDir,
  getSampleMainDir,
  getSystemRoot,
  getTemplatesRoot,
  SYSTEM_FOLDER_NAMES,
  WORKSPACE_ROOTS,
} from "../workspace/workspacePaths";

const BACKUPS_FOLDER = SYSTEM_FOLDER_NAMES.backups;
```

**File:** `src/data/templates/templateStorage.test.ts`

**Before:**
```ts
    const templatesDir = await root.getDirectoryHandle("6-Templates", {
      create: false,
    });
```

**After:**
```ts
    const templatesDir = await root.getDirectoryHandle("6-templates", {
      create: false,
    });
```

**File:** `src/data/templates/templateSelectionStorage.ts`

**Before:**
```ts
const SELECTION_FILE = "active.inspection-template.json";
```

**After:**
```ts
const SELECTION_FILE = "template.selection.json";
```

---

## v37.4 — 2026-07-01 — Centralize user-presets/feedback/designs folder names, no value change

Task 7 of the workspace file/folder naming convention refactor. Three storage modules
(`browsePresetStorage.ts`, `feedbackStorage.ts`, `reportDesignStorage.ts`) each had a local
constant defining a folder name that already matched the target naming convention. This task
removes the three duplicated local `const` definitions and makes each file import the equivalent
value from `workspacePaths.ts` instead, centralizing to a single source of truth. No folder-name
value changes — this is pure refactoring to prevent future drift.

**File:** `src/data/preferences/browsePresetStorage.ts`

**Before:**
```ts
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeReadJson, safeWriteJson } from "../storage/safeWrite";
import type { BrowseDatasetKind } from "../population/populationStorage";
import { getSystemRoot } from "../workspace/workspacePaths";

const USER_PRESETS_FOLDER = "user-presets";
const ADMIN_SHARED_PRESET_FILE = "admin-shared.browse-preset.json";

// ...

async function getPresetDir(
  directoryHandle: DirectoryHandleLike,
  create: boolean
): Promise<DirectoryHandleLike> {
  const systemDir = await getSystemRoot(directoryHandle, create);
  return systemDir.getDirectoryHandle(USER_PRESETS_FOLDER, { create });
}
```

**After:**
```ts
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeReadJson, safeWriteJson } from "../storage/safeWrite";
import type { BrowseDatasetKind } from "../population/populationStorage";
import { getSystemRoot, SYSTEM_FOLDER_NAMES } from "../workspace/workspacePaths";

const ADMIN_SHARED_PRESET_FILE = "admin-shared.browse-preset.json";

// ...

async function getPresetDir(
  directoryHandle: DirectoryHandleLike,
  create: boolean
): Promise<DirectoryHandleLike> {
  const systemDir = await getSystemRoot(directoryHandle, create);
  return systemDir.getDirectoryHandle(SYSTEM_FOLDER_NAMES.userPresets, { create });
}
```

**File:** `src/data/feedback/feedbackStorage.ts`

**Before:**
```ts
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { readJsonFile, writeJsonFile } from "../storage/fileSystemAccess";

// ...

const FEEDBACK_FOLDER = "feedback";
const MESSAGES_FILE = "messages.json";

async function getFeedbackDir(dir: DirectoryHandleLike): Promise<DirectoryHandleLike> {
  return dir.getDirectoryHandle(FEEDBACK_FOLDER, { create: true });
}
```

**After:**
```ts
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { readJsonFile, writeJsonFile } from "../storage/fileSystemAccess";
import { SYSTEM_FOLDER_NAMES } from "../workspace/workspacePaths";

// ...

const MESSAGES_FILE = "messages.json";

async function getFeedbackDir(dir: DirectoryHandleLike): Promise<DirectoryHandleLike> {
  return dir.getDirectoryHandle(SYSTEM_FOLDER_NAMES.feedback, { create: true });
}
```

**File:** `src/data/reportDesigner/storage/reportDesignStorage.ts`

**Before:**
```ts
import type { DirectoryHandleLike } from "../../storage/fileSystemAccess";
import { safeReadJson, safeWriteJson } from "../../storage/safeWrite";
import { withResourceLock } from "../../storage/webLocks";
import { getReportsRoot } from "../../workspace/workspacePaths";
import type { ReportDocument } from "../reportTypes";

const INDEX_FILE = "designs.index.json";

// ...

async function getDesignsDir(
  directoryHandle: DirectoryHandleLike
): Promise<DirectoryHandleLike> {
  const reports = await getReportsRoot(directoryHandle, true);
  return reports.getDirectoryHandle("designs", { create: true });
}
```

**After:**
```ts
import type { DirectoryHandleLike } from "../../storage/fileSystemAccess";
import { safeReadJson, safeWriteJson } from "../../storage/safeWrite";
import { withResourceLock } from "../../storage/webLocks";
import { getReportsRoot, REPORTS_SUBFOLDERS } from "../../workspace/workspacePaths";
import type { ReportDocument } from "../reportTypes";

const INDEX_FILE = "designs.index.json";

// ...

async function getDesignsDir(
  directoryHandle: DirectoryHandleLike
): Promise<DirectoryHandleLike> {
  const reports = await getReportsRoot(directoryHandle, true);
  return reports.getDirectoryHandle(REPORTS_SUBFOLDERS.designs, { create: true });
}
```

---

## v37.3 — 2026-07-01 — Use SYSTEM_FOLDER_NAMES.powerbiExport and rename LISEZMOI.txt to README.txt

Task 6 of the workspace file/folder naming convention refactor. `exportWriter.ts` previously
hardcoded the literal `"powerbi-export"` for the subdirectory under the system root. Swapped
to import and use `SYSTEM_FOLDER_NAMES.powerbiExport` from `workspacePaths.ts` (added in Task 1),
centralizing the folder-name constant. Also renamed the instructions file from `LISEZMOI.txt`
(French name, inappropriate for Arabic/English content) to `README.txt` (standard cross-lingual
naming convention). Updated embedded instruction strings: both Arabic and English path references
changed from `'5-System/powerbi-export/'` to `'5-system/powerbi-export/'` to reflect the lowercase
system folder. Updated the UI hint in `Reports/index.tsx` to display the correct casing
`5-system\powerbi-export\` and the correct filename `README.txt` in the export-result panel.

**File:** `src/data/powerbiExport/exportWriter.ts`

**Before:**
```ts
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { getSystemRoot } from "../workspace/workspacePaths";
import { toCsvString } from "./csvSerializer";
import type { ExportManifest, ExportFileResult } from "./exportTypes";

async function getExportDir(root: DirectoryHandleLike, month: string): Promise<DirectoryHandleLike> {
  const sys = await getSystemRoot(root, true);
  const expRoot = await sys.getDirectoryHandle("powerbi-export", { create: true });
  return expRoot.getDirectoryHandle(month, { create: true });
}
// ...
  const instructions = [
    // ...
    `3. انتقل إلى مجلد '5-System/powerbi-export/${month}/'`,
    // ...
    `3. Browse to '5-System/powerbi-export/${month}/'`,
    // ...
  ].join("\n");

  await writeTextFile(dir, "LISEZMOI.txt", instructions);
```

**After:**
```ts
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { getSystemRoot, SYSTEM_FOLDER_NAMES } from "../workspace/workspacePaths";
import { toCsvString } from "./csvSerializer";
import type { ExportManifest, ExportFileResult } from "./exportTypes";

async function getExportDir(root: DirectoryHandleLike, month: string): Promise<DirectoryHandleLike> {
  const sys = await getSystemRoot(root, true);
  const expRoot = await sys.getDirectoryHandle(SYSTEM_FOLDER_NAMES.powerbiExport, { create: true });
  return expRoot.getDirectoryHandle(month, { create: true });
}
// ...
  const instructions = [
    // ...
    `3. انتقل إلى مجلد '5-system/powerbi-export/${month}/'`,
    // ...
    `3. Browse to '5-system/powerbi-export/${month}/'`,
    // ...
  ].join("\n");

  await writeTextFile(dir, "README.txt", instructions);
```

**File:** `src/data/powerbiExport/exportWriter.test.ts`

**Before:**
```ts
    // navigate into 5-System/powerbi-export/5-May-2026/
    const sys = await root.getDirectoryHandle("5-System", { create: false });
```

**After:**
```ts
    // navigate into 5-system/powerbi-export/5-May-2026/
    const sys = await root.getDirectoryHandle("5-system", { create: false });
```

**File:** `src/components/Sidebar/Tabs/Reports/index.tsx`

**Before:**
```tsx
            const relPath = `5-System\\powerbi-export\\${pbiResult.month}`;
```

**After:**
```tsx
            const relPath = `5-system\\powerbi-export\\${pbiResult.month}`;
```

Also updated the instructions file reference in the export-result panel UI from `LISEZMOI.txt` to `README.txt`.

---

## v37.2 — 2026-07-01 — Use POPULATION_SUBFOLDERS (1-raw/2-processed) instead of raw/processed literals

Task 4 of the workspace file/folder naming convention refactor. `populationStorage.ts` previously
hardcoded the literals `"raw"` and `"processed"` for every `getDirectoryHandle` call under a
population month folder. Swapped every call site to `POPULATION_SUBFOLDERS.raw` /
`POPULATION_SUBFOLDERS.processed` (added to `workspacePaths.ts` in Task 1), so population month
folders now contain `1-raw/` and `2-processed/` subfolders (numbering reflects the real two-step
raw-import → processed-output pipeline). The `"sample"` and `"reports"` stray-folder creation
calls in `saveMonthRun`, and the legacy-fallback `"sample"` literal in the test file's
"loadAllSampleRows falls back to legacy sample path" test, are pre-existing, unrelated, and were
left untouched (out of scope for this task).

**File:** `src/data/population/populationStorage.ts`

**Before:**
```ts
import {
  getPopulationMonthDir,
  getPopulationRoot,
  getSampleMainDir,
} from "../workspace/workspacePaths";
// ...
    const monthDir = await ensureFolder(populationDir, monthFolderName);
    const rawDir = await ensureFolder(monthDir, "raw");
    const processedDir = await ensureFolder(monthDir, "processed");
    await ensureFolder(monthDir, "sample");
    await ensureFolder(monthDir, "reports");
// ...
      processingSummaryFile: params.processingSummary ? "processed/processing.summary.json" : null,
// ...
        const processedDir = await monthDir.getDirectoryHandle("processed", { create: false }); // listMonthSummaries
// ...
      const processedDir = await monthDir.getDirectoryHandle("processed", { create: false }); // loadAllPopulationRows
// ...
    const processedDir = await monthDir.getDirectoryHandle("processed", { create: false }); // loadMonthPopulationFinal
// ...
      const rawDir = await monthDir.getDirectoryHandle("raw", { create: false }); // loadAllRawRows
// ...
      monthDir.getDirectoryHandle("processed", { create: false }) // loadMonthForEditing (population.final.json)
      monthDir.getDirectoryHandle("processed", { create: false }) // loadMonthForEditing (processing.summary.json)
      monthDir.getDirectoryHandle("raw", { create: false }) // loadMonthForEditing (risk/bi raw)
```

**After:**
```ts
import {
  getPopulationMonthDir,
  getPopulationRoot,
  getSampleMainDir,
  POPULATION_SUBFOLDERS,
} from "../workspace/workspacePaths";
// ...
    const monthDir = await ensureFolder(populationDir, monthFolderName);
    const rawDir = await ensureFolder(monthDir, POPULATION_SUBFOLDERS.raw);
    const processedDir = await ensureFolder(monthDir, POPULATION_SUBFOLDERS.processed);
    await ensureFolder(monthDir, "sample");
    await ensureFolder(monthDir, "reports");
// ...
      processingSummaryFile: params.processingSummary
        ? `${POPULATION_SUBFOLDERS.processed}/processing.summary.json`
        : null,
// ...
        const processedDir = await monthDir.getDirectoryHandle(POPULATION_SUBFOLDERS.processed, { create: false }); // listMonthSummaries
// ...
      const processedDir = await monthDir.getDirectoryHandle(POPULATION_SUBFOLDERS.processed, { create: false }); // loadAllPopulationRows
// ...
    const processedDir = await monthDir.getDirectoryHandle(POPULATION_SUBFOLDERS.processed, { create: false }); // loadMonthPopulationFinal
// ...
      const rawDir = await monthDir.getDirectoryHandle(POPULATION_SUBFOLDERS.raw, { create: false }); // loadAllRawRows
// ...
      monthDir.getDirectoryHandle(POPULATION_SUBFOLDERS.processed, { create: false }) // loadMonthForEditing (population.final.json)
      monthDir.getDirectoryHandle(POPULATION_SUBFOLDERS.processed, { create: false }) // loadMonthForEditing (processing.summary.json)
      monthDir.getDirectoryHandle(POPULATION_SUBFOLDERS.raw, { create: false }) // loadMonthForEditing (risk/bi raw)
```

**File:** `src/data/population/populationStorage.test.ts`

**Before:** All occurrences of `"1-Population"` → root folder, `"5-May-2026"` → month folder,
`monthDir.getDirectoryHandle("raw", { create: false })`, and
`monthDir.getDirectoryHandle("processed", { create: false })` (matching Task 1/2's now-outdated
title-case root and month-folder literals, and the pre-numbering subfolder literals).

**After:** `"1-population"`, `"5-may-2026"`, `monthDir.getDirectoryHandle("1-raw", { create: false })`,
`monthDir.getDirectoryHandle("2-processed", { create: false })`. The legacy-fallback
`monthDir.getDirectoryHandle("sample", { create: true })` line in the
"loadAllSampleRows falls back to legacy sample path" test was left unchanged.

---

## v37.1 — 2026-07-01 — Wire workspace init path to central WORKSPACE_ROOTS/SYSTEM_FOLDER_NAMES constants

Task 3 of the workspace file/folder naming convention refactor. `workspaceDefaults.ts` and
`fileSystemAccess.ts` (the `createWorkspaceStructure()` init path) previously hardcoded their
own old title-case folder-name literals (`"1-Locks"`, `"2-Audit"`, `"3-Backups"`,
`"1-Population"`, `"3-User Data"`, `"4-Reports"`, `"2-Employees"`) instead of importing the
lowercase kebab-case constants already added to `workspacePaths.ts` in Task 1. Straight rename,
no backwards-compatibility fallback.

**File:** `src/data/workspace/workspaceDefaults.ts`

**Before:**
```ts
import { WORKSPACE_ROOTS } from "./workspacePaths";

export const WORKSPACE_FILE_NAMES = {
  manifest: "workspace.manifest.json",
  usersPermissions: "users.permissions.json",
  dataRaw: "data.raw.json",
  dataProcessed: "data.processed.json",
  sampleMaster: "sample.master.json",
  sampleDistribution: "sample.distribution.json",
  employeeAnswersFolder: WORKSPACE_ROOTS.samples,
  systemFolder: WORKSPACE_ROOTS.system,
  locksFolder: "1-Locks",
  auditFolder: "2-Audit",
  backupsFolder: "3-Backups",
  templatesFolder: WORKSPACE_ROOTS.templates
} as const;
// ...
        employeeAnswersFolder: `${WORKSPACE_ROOTS.samples}/{month}/2-Employees`,
```

**After:**
```ts
import { SAMPLE_SUBFOLDERS, SYSTEM_FOLDER_NAMES, WORKSPACE_ROOTS } from "./workspacePaths";

export const WORKSPACE_FILE_NAMES = {
  manifest: "workspace.manifest.json",
  usersPermissions: "users.permissions.json",
  dataRaw: "data.raw.json",
  dataProcessed: "data.processed.json",
  sampleMaster: "sample.master.json",
  sampleDistribution: "sample.distribution.json",
  employeeAnswersFolder: WORKSPACE_ROOTS.samples,
  systemFolder: WORKSPACE_ROOTS.system,
  locksFolder: SYSTEM_FOLDER_NAMES.locks,
  auditFolder: SYSTEM_FOLDER_NAMES.audit,
  backupsFolder: SYSTEM_FOLDER_NAMES.backups,
  templatesFolder: WORKSPACE_ROOTS.templates
} as const;
// ...
        employeeAnswersFolder: `${WORKSPACE_ROOTS.samples}/{month}/${SAMPLE_SUBFOLDERS.employees}`,
```

**File:** `src/data/storage/fileSystemAccess.ts`

**Before:**
```ts
import {
  getSystemRoot,
  getUserDataRoot,
} from "../workspace/workspacePaths";
// ...
  await directoryHandle.getDirectoryHandle("1-Population", { create: true });
  await directoryHandle.getDirectoryHandle("3-User Data", { create: true });
  await directoryHandle.getDirectoryHandle("4-Reports", { create: true });
// ...
  const userDataHandle = await directoryHandle.getDirectoryHandle("3-User Data", {
    create: true
  });
```

**After:**
```ts
import {
  getSystemRoot,
  getUserDataRoot,
  WORKSPACE_ROOTS,
} from "../workspace/workspacePaths";
// ...
  await directoryHandle.getDirectoryHandle(WORKSPACE_ROOTS.population, { create: true });
  await directoryHandle.getDirectoryHandle(WORKSPACE_ROOTS.userData, { create: true });
  await directoryHandle.getDirectoryHandle(WORKSPACE_ROOTS.reports, { create: true });
// ...
  const userDataHandle = await directoryHandle.getDirectoryHandle(WORKSPACE_ROOTS.userData, {
    create: true
  });
```

**File:** `src/data/storage/fileSystemAccess.test.ts`

**Before:**
```ts
  const population = await dir.getDirectoryHandle("1-Population", { create: false });
  expect(population.name).toBe("1-Population");

  const samples = await dir.getDirectoryHandle("2-Samples", { create: false });
  expect(samples.name).toBe("2-Samples");

  const userData = await dir.getDirectoryHandle("3-User Data", { create: false });
  expect(userData.name).toBe("3-User Data");

  const system = await dir.getDirectoryHandle("5-System", { create: false });
  const backups = await system.getDirectoryHandle("3-Backups", { create: false });
  expect(backups.name).toBe("3-Backups");

  const templates = await dir.getDirectoryHandle("6-Templates", { create: false });
  expect(templates.name).toBe("6-Templates");
```

**After:**
```ts
  const population = await dir.getDirectoryHandle("1-population", { create: false });
  expect(population.name).toBe("1-population");

  const samples = await dir.getDirectoryHandle("2-samples", { create: false });
  expect(samples.name).toBe("2-samples");

  const userData = await dir.getDirectoryHandle("3-user-data", { create: false });
  expect(userData.name).toBe("3-user-data");

  const system = await dir.getDirectoryHandle("5-system", { create: false });
  const backups = await system.getDirectoryHandle("backups", { create: false });
  expect(backups.name).toBe("backups");

  const templates = await dir.getDirectoryHandle("6-templates", { create: false });
  expect(templates.name).toBe("6-templates");
```

---

## v37.0 — 2026-07-01 — Lowercase month folder names (kebab-case)

**File:** `src/data/population/monthFolder.ts`

**Before:**
```ts
export function formatMonthFolderName(month: number, year: number): string {
  if (month < 1 || month > 12) {
    throw new RangeError(`Month must be 1–12, got ${month}`);
  }
  const monthName = MONTH_NAMES_EN[month - 1];
  return `${month}-${monthName}-${year}`;
}
```

**After:**
```ts
export function formatMonthFolderName(month: number, year: number): string {
  if (month < 1 || month > 12) {
    throw new RangeError(`Month must be 1–12, got ${month}`);
  }
  const monthName = MONTH_NAMES_EN[month - 1];
  return `${month}-${monthName.toLowerCase()}-${year}`;
}
```

**File:** `src/data/population/monthFolder.test.ts`

**Before:**
```ts
test("formatMonthFolderName produces MM-MonthName-YYYY", () => {
  expect(formatMonthFolderName(5, 2026)).toBe("5-May-2026");
  expect(formatMonthFolderName(12, 2025)).toBe("12-December-2025");
  expect(formatMonthFolderName(1, 2024)).toBe("1-January-2024");
});
```

**After:**
```ts
test("formatMonthFolderName produces MM-monthname-YYYY (lowercase)", () => {
  expect(formatMonthFolderName(5, 2026)).toBe("5-may-2026");
  expect(formatMonthFolderName(12, 2025)).toBe("12-december-2025");
  expect(formatMonthFolderName(1, 2024)).toBe("1-january-2024");
});
```

---


---

## v37.7 — 2026-07-01 — refactor(auth): move audit log to 5-system/audit/activity.log.json

Implements Task 5 of the workspace naming standardization plan.
Moves the auth activity audit log from 5-System/2-Audit/auth-activity.log.json to the
normalized lowercase, kebab-case path 5-system/audit/activity.log.json using the
centralized SYSTEM_FOLDER_NAMES constant from workspacePaths.ts.

**File:** src/auth/authActivityLog.ts

**Before:**
```ts
import { getSystemRoot } from "../data/workspace/workspacePaths";

const ACTIVITY_AUDIT_FOLDER = "2-Audit";
const ACTIVITY_LOG_FILE = "auth-activity.log.json";

async function getActivityAuditDir(create: boolean): Promise<DirectoryHandleLike | null> {
  if (!workspaceHandle) return null;
  try {
    const systemDir = await getSystemRoot(workspaceHandle, create);
    return systemDir.getDirectoryHandle(ACTIVITY_AUDIT_FOLDER, { create });
  } catch {
    return null;
  }
}
```

**After:**
```ts
import { getSystemRoot, SYSTEM_FOLDER_NAMES } from "../data/workspace/workspacePaths";

const ACTIVITY_LOG_FILE = "activity.log.json";

async function getActivityAuditDir(create: boolean): Promise<DirectoryHandleLike | null> {
  if (!workspaceHandle) return null;
  try {
    const systemDir = await getSystemRoot(workspaceHandle, create);
    return systemDir.getDirectoryHandle(SYSTEM_FOLDER_NAMES.audit, { create });
  } catch {
    return null;
  }
}
```

**File:** src/auth/authActivityLog.test.ts

**Before:**
```ts
    const systemDir = await getSystemRoot(root, false);
    const auditDir = await systemDir.getDirectoryHandle("2-Audit", { create: false });
    const result = await safeReadJson<AuthActivityLogFile>(auditDir, "auth-activity.log.json");
```

**After:**
```ts
    const systemDir = await getSystemRoot(root, false);
    const auditDir = await systemDir.getDirectoryHandle("audit", { create: false });
    const result = await safeReadJson<AuthActivityLogFile>(auditDir, "activity.log.json");
```

**File:** src/components/Sidebar/Tabs/UserManagement/index.tsx

**Before:**
```tsx
          تعرض هذه الصفحة سجلات الدخول وساعات العمل المحفوظة داخل مساحة العمل في
          <strong> 5-System/2-Audit/auth-activity.log.json</strong>.
```

**After:**
```tsx
          تعرض هذه الصفحة سجلات الدخول وساعات العمل المحفوظة داخل مساحة العمل في
          <strong> 5-system/audit/activity.log.json</strong>.
```

## v36.3 — 2026-07-01 — Top header: polish the mode indicator + add workspace & user chips (FEATURE)

Worked the post-login top header (`AdminToolbar`). The "الوضع الحالي / وضع الإدارة" block is
the current role/mode indicator for the role-preview system; kept it but made it clearer,
and added the operational context the header was missing.

**File:** `src/auth/AdminToolbar.tsx` — mode value now leads with a per-role icon (admin→shield, manager→briefcase, supervisor→user-cog, employee→user, view→eye); the bare `?` help button is now a lucide `HelpCircle`; logout gains a `LogOut` icon. Added a **workspace chip** (connected folder name, from `useWorkspace()`) beside the mode block, and a **user chip** (logged-in display name, resolved via `getManagedLoginUsers()`, falling back to username) in the actions zone — both hidden in read-only demo mode.

**File:** `src/auth/AdminToolbar.css` — restructured the mode block (small label stacked over the value with a trailing divider only when a chip follows); added `.auth-toolbar-chip` / `.auth-toolbar-user` pill styles; icon-aligned the help and logout buttons; responsive rules shed the workspace chip < 1200px and collapse the user chip to icon-only < 1024px, restoring both when the bar stacks < 640px.

**Verified:** `npx tsc -b` zero errors in app sources; `npm run test:run` 280 pass.

---

## v36.2 — 2026-07-01 — Logs tab: sort by version number; de-duplicate logo to the sidebar only (DESIGN)

Feedback fixes on the v36.0/v36.1 work.

**File:** `src/components/Sidebar/Tabs/ChangeLog/index.tsx` — entries are now sorted by numeric version (segment-by-segment, newest first) via `compareVersionsDesc`/`versionKey`, instead of trusting the file's (inconsistent) physical order. Verified against the real log: clean descending v36.2 → v1.0 across 175 entries.

**File:** `src/auth/AdminToolbar.tsx` / `AdminToolbar.css` — removed the ZATCA logo from the top header (it duplicated the sidebar mark directly below it). The logo now lives in one place: the sidebar navigation header.

**File:** `src/components/Sidebar/Sidebar.css` — enlarged the sidebar logo (30px → 38px, max-width 168px → 190px, full opacity) for clearer visibility now that it stands alone.

**Verified:** `npx tsc -b` zero errors in app sources; version-sort validated in Node.

---

## v36.1 — 2026-07-01 — Branding: ZATCA logo in the nav bar + top header, with recolor filters (DESIGN)

Added the official ZATCA identity mark (same source as the sign-in screen) to the two
persistent dark-navy surfaces — the sidebar navigation header and the post-login top
toolbar — recolored white via CSS filter tokens (the same treatment the executive
report uses). Graceful fallback: if the external SVG can't load, the mark is hidden and
the text wordmark stands alone (never a broken-image icon).

**File:** `src/branding/organization.ts` — new shared `ZATCA_LOGO_URL` constant (de-duplicates the URL previously inlined in AuthGate and the report).

**File:** `src/index.css` — new `--logo-filter` (solid white) and `--logo-filter-muted` (soft grey-white) tokens for recoloring the dark/teal SVG per surface.

**File:** `src/components/Sidebar/Sidebar.tsx` / `Sidebar.css` — logo added to the header; header regridded to a two-row layout (logo + collapse control on top, title block below); `filter: var(--logo-filter)`; hidden in the collapsed rail.

**File:** `src/auth/AdminToolbar.tsx` / `AdminToolbar.css` — compact white logo anchored at the start of the status area in the top header.

**Verified:** `npx tsc -b` reports zero errors in app sources (only the untracked throwaway `__qa_generate.test.ts` fails, on `node:fs`); `npm run test:run` 280 pass. Live layout pending human visual check (external logo + auth-gated surfaces can't be screenshotted headless).

---

## v36.0 — 2026-07-01 — Admin: version & edit-history tab (سجل الإصدارات) (FEATURE)

New admin-only navigation item at the end of the sidebar that renders this edit log
inside the app — all versions, each version's edits, dates and change type — with
search and per-version expand/collapse. Requested for in-app visibility of the
change history.

**File:** `src/components/Sidebar/Tabs/ChangeLog/index.tsx` (new) — parses `docs/EDIT_LOG.md` (imported via Vite `?raw`) into `{version, date, title, tag, body}` entries and renders them newest-first. Includes a lightweight, library-free markdown renderer (code fences, inline code, bold) that emits safe React nodes only (no `dangerouslySetInnerHTML`). `tabConfig`: id `change-log`, order 96 (last), `allowedRoles: ["admin"]`, `History` icon.

**File:** `src/components/Sidebar/Tabs/ChangeLog/ChangeLog.css` (new) — token-based styling; native `<details>`/`<summary>` for accessible expand/collapse; version pill, change-type badge, monospace code blocks.

**File:** `src/vite-env.d.ts` (new) — `/// <reference types="vite/client" />` so `?raw` imports are typed as `string`.

**File:** `src/auth/userManagement.ts` — registered `change-log` in `MANAGED_TABS` and added its role rows to `createDefaultPermissions()` (admin `edit`, all other roles `none`).

**Verified:** `npm run lint` clean; `npm run build` green; `npm run test:run` all pass.

---

## v35.1 — 2026-07-01 — UI polish: workspace front-door badge + de-emoji sweep (DESIGN)

**File:** `src/data/workspace/WorkspaceGate.css` — `.workspace-gate-icon` changed from a bare `font-size:40px` glyph slot to a 68px circular branded badge framing the lucide icon.

**File:** `src/components/Sidebar/Tabs/Population/components/CertScanGrid.tsx` — replaced the `🔴`/`🔵` emoji in the highlighter hint with a token-coloured CSS dot.

**File:** `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx` — replaced a literal `⚠` with a lucide `AlertTriangle` (and re-pointed the box from hardcoded hex to the warning token palette); replaced the `↻` reload glyph with a lucide `RotateCw` (+ `aria-label`).

**File:** `src/components/Sidebar/Tabs/Reports/index.tsx` — replaced the `✓` success glyph with a lucide `Check`.

**File:** `src/components/Sidebar/Tabs/Population/components/MappingSettingsModal.tsx` — replaced the `▲`/`▼` reorder glyphs with lucide `ChevronUp`/`ChevronDown` (+ `aria-label`s).

**Verified:** `npm run lint` clean; `npm run build` green; 279 tests pass.

---

## v35.0 — 2026-07-01 — UI polish Phase 1/2 foundation: state-view primitives + view-enter motion (FEATURE)

Kicks off the leadership-approved UI polish effort (see `docs/UI_ENHANCEMENT_PLAN.md`).
Identity unchanged (blue/white, Somar Sans, RTL); additive only.

**File:** `src/styles/primitives.css` — appended `.ui-state` (+ `--bare`/`--error`/`__icon`/`__title`/`__body`/`__actions`), `.ui-spinner` (+ sizes, `@keyframes ui-spin`), and `.ui-skeleton` (+ variants, `@keyframes ui-shimmer`), with a `prefers-reduced-motion` guard.

**File:** `src/components/StateViews/StateViews.tsx` (new) — reusable `EmptyState` / `LoadingState` / `ErrorState` / `Skeleton` components (Arabic RTL defaults, correct `role`/`aria-live`).

**File:** `src/App.css` — added `@keyframes view-enter` and `.app-workspace > div` animation (one-time settle per tab; state preserved).

**File:** `src/App.tsx` — adopted `EmptyState` for the "no tabs available" screen.

**Verified:** `npm run lint` clean; `npm run build` green; 279 tests pass.

---

## v34.5 — 2026-07-01 — Wire the executive-report card to its three real outputs: deck / Excel / document (BUG)

The Reports-tab executive card's three format icons were wired to document(html) / Excel /
document(print) — the **deck was never exported from the card** (Phase 6 only wired it into
the analytics dashboard), and the card description still said "8 slides". Now the three
icons map to the three distinct deliverables:
- presentation icon → `openExecutiveDeck` (16:9 slides)
- Excel icon → `buildExecutiveXlsx` (workbook)
- document icon → `openExecutiveReport` (A4 detailed report)

**File:** `src/components/Sidebar/Tabs/Reports/index.tsx`
- `ReportType`: `executive-print` → `executive-deck`; `ReportFormat` gains `deck`/`document`.
- default executive format = `document`; `selectedReportType` maps executive deck/xlsx/document.
- `generate()` executive branch routes `executive-deck` → `openExecutiveDeck`.
- `renderExportControls`: executive shows `[deck, xlsx, document]` (others keep html/xlsx/print),
  with correct icons + Arabic titles.
- Card description rewritten (three formats, not "8 slides"); unused icon imports removed.

---

## v34.4 — 2026-07-01 — Fix report crash on population.final.json written before the five-source pipeline (BUG)

Generating the executive report from the app failed with "حدث خطأ أثناء توليد التقرير".
Root cause: `population.final.json` saved before v28.0 has no `otherResults`/`notes`, but
consumers read `pop.otherResults.manual.result` without guarding → throws on the missing
field. (Tests passed because fixtures always include the field.) Guarded every direct read
of `otherResults`/`notes` on a `PreparedPopulationRow` to default to the null shape, plus a
regression test that builds the report from a legacy row.

**File:** `src/data/reporting/executiveReportData.ts`

**Before:**
```ts
      otherResults: {
        manual: { result: pop.otherResults.manual.result, employeeId: pop.otherResults.manual.employeeId },
        opposite: { result: pop.otherResults.opposite.result, employeeId: pop.otherResults.opposite.employeeId },
        liveMeans: { result: pop.otherResults.liveMeans.result, employeeId: pop.otherResults.liveMeans.employeeId },
      },
      notes: pop.notes,
```

**After:**
```ts
      otherResults: {
        manual: { result: pop.otherResults?.manual?.result ?? null, employeeId: pop.otherResults?.manual?.employeeId ?? null },
        opposite: { result: pop.otherResults?.opposite?.result ?? null, employeeId: pop.otherResults?.opposite?.employeeId ?? null },
        liveMeans: { result: pop.otherResults?.liveMeans?.result ?? null, employeeId: pop.otherResults?.liveMeans?.employeeId ?? null },
      },
      notes: pop.notes ?? null,
```

**File:** `src/components/Sidebar/Tabs/Population/processing/populationExporter.ts` — same
optional-chaining guard on the `otherResults`/`notes` export columns.

**File:** `src/data/reporting/executiveReport.test.ts` — regression test: `buildExecutiveReport`
on a population row with `otherResults`/`notes` deleted must not throw.

---

## v34.3 — 2026-07-01 — Report visual QA fixes: ranked-bar labels, logo, land/sea donut, headline (BUG)

Visual-QA pass (rendered document + deck in a browser). Fixes:
- **Ranked-bar labels** (`ui/charts.ts`): rebuilt `rankedBar` as HTML/CSS instead of SVG —
  Arabic `<text>` inside SVG shaped unreliably (labels rendered as illegible marks). Labels
  now sit legibly at the right, value at the left, proportional bar between. Affects every
  ranked-bar (population-by-port, accuracy-by-port, deck ports/cross-team). Tests updated.
- **Logo** (`document/frontMatter.ts` cover, `deck/slides.ts` title): use the sign-in
  screen's official ZATCA logo (external URL) with an inline-SVG shield fallback via
  `onerror`, so it renders online and offline/print.
- **Scope-slide donut** (`deck/slides.ts`): now shows land (بري) vs sea (بحري) port split
  with counts in the caption, instead of سليمة/اشتباه.
- **Deck exec-summary headline**: "الحُكم في سطر واحد" → "الخلاصة التنفيذية".

**File:** `src/data/reporting/executive/ui/charts.ts` — `rankedBar` returns HTML bars.
**File:** `src/data/reporting/executive/ui/charts.test.ts` — ranked-bar asserts HTML.
**File:** `src/data/reporting/executive/document/frontMatter.ts` — ZATCA logo img + fallback.
**File:** `src/data/reporting/executive/deck/slides.ts` — title logo, land/sea donut, headline.

---

## v34.2 — 2026-06-30 — Deck verdict slide: gate on image-level accuracy, not inspector evaluability (BUG)

Visual QA found the deck's flagship "حُكم الدقة" slide showing a false
"لا توجد قرارات قابلة للتقييم" empty state while the Document's accuracy page (same
`ReportModel`) correctly showed 84.7% accuracy / 74.2% detection. Cause: the deck gated the
slide on `model.dataQuality.evaluableDecisionRecords` (decision-level, requires an inspector
ID — 0 while BI is unmapped), whereas overall inspection accuracy is image-level (expert vs
L1/L2 result) and does not need inspector identity. Gating now matches the Document and the
deck's own executive-summary subhead.

**File:** `src/data/reporting/executive/deck/slides.ts` (verdictSlide)

**Before:**
```ts
  const s = model.summary;
  const t = model.errorAnalysis.totals;
  if (model.dataQuality.evaluableDecisionRecords === 0) {
```

**After:**
```ts
  const s = model.summary;
  const t = model.errorAnalysis.totals;
  // Gate on image-level inspection accuracy (expert vs L1/L2 result) — which does NOT
  // require inspector identity — so the verdict matches the Document and stays populated
  // when BI is unmapped. (Inspector-level evaluability gates the employee slides, not this.)
  if (s.overallAccuracy === null) {
```

---

## v34.1 — 2026-06-30 — Executive report rework cleanup: remove superseded renderer + lint (CHORE)

Phase 3 replaced the old per-page executive renderer with the `document/` module but left
the previous files orphaned. Removed the now-dead code (confirmed no live imports; tsc +
full suite still green): the entire `src/data/reporting/executive/pages/` folder,
`executive/assemble.ts`, and `executive/context.ts` (`context` was used only by `assemble`,
`assemble` by nothing). Also: dropped a useless trailing `n += 1` in `document/index.ts`,
and simplified the no-emoji regex in `executiveReport.test.ts` to the pictographic ranges
only (removed the `\u{FE00}-\u{FE0F}` variation-selector range that tripped
`no-misleading-character-class`). `npm run lint` now clean; 278 tests pass; build green.

**Removed:** `src/data/reporting/executive/pages/**`, `executive/assemble.ts`, `executive/context.ts`.

**File:** `src/data/reporting/executive/document/index.ts`

**Before:**
```ts
  pages.push(buildAppendix(model, pad(n))); n += 1;
```

**After:**
```ts
  pages.push(buildAppendix(model, pad(n)));
```

**File:** `src/data/reporting/executiveReport.test.ts`

**Before:**
```ts
/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}]/u
```

**After:**
```ts
/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u
```

---

## v34.0 — 2026-06-30 — Executive report Phase 6: in-app Analytics dashboard + exports + managed permission (FEATURE)

Upgraded the Reports tab's `مؤشرات الأداء` (`kpi`) sub-section into a live high-level
analytics dashboard built from one `buildReportModel(execInput)` call (design §8): headline
KPI cards (accuracy, detection, missed-suspicion flagged as المخاطرة الرئيسية, completion),
gauges/donut/heatmap/ranked-bars via the shared `ui/charts.ts` SVGs, the reviewer-agreement
view, port/stage/reviewer tables, data-sufficiency bands, the BI-unmapped inspector state,
and an exports toolbar wiring the three actions (document/deck/xlsx). One analytical layer
→ live dashboard + exports. New managed permission `reports/analytics` (matrix-editable),
default manager=view / admin=edit, others none; section gated with `TabGuard`.

**File:** `src/auth/userManagement.ts`

**Before:**
```ts
  { id: "reports/kpi",             label: "مؤشرات الأداء",          parentId: "reports" },
  { id: "report-designer",         label: "مصمم التقارير",          parentId: "reports" },
```

**After:**
```ts
  { id: "reports/kpi",             label: "مؤشرات الأداء",          parentId: "reports" },
  { id: "reports/analytics",       label: "لوحة التحليلات التنفيذية", parentId: "reports" },
  { id: "report-designer",         label: "مصمم التقارير",          parentId: "reports" },
```

`createDefaultPermissions()` gains `reports/analytics` for every role: guest/employee/
supervisor = `none`, manager = `view`, admin = `edit`.

**File:** `src/components/Sidebar/Tabs/Reports/index.tsx`

**Before:**
```tsx
// section === "kpi" rendered a basic completion panel (ReportKpi/monthKpi state,
// stage-target constants, getStageKey/loadPopulationConfig stage computation).
```

**After:**
```tsx
import { openExecutiveDeck } from "../../../../data/reporting/executive/deck";
import { buildReportModel } from "../../../../data/reporting/executive/model/reportModel";
import { rankedBar, gauge, donut, heatmap } from "../../../../data/reporting/executive/ui/charts";
import { TabGuard } from "../../../PermissionGuard";
// section === "kpi" now renders <TabGuard tabId="reports/analytics">{renderDashboard()}</TabGuard>;
// renderDashboard() builds the model once via a shared loadExecInput() and renders KPI cards,
// charts (SVG via dangerouslySetInnerHTML), reviewer-agreement, port/stage/reviewer tables,
// and an exports toolbar (openExecutiveReport / openExecutiveDeck / buildExecutiveXlsx).
```

**File:** `src/components/Sidebar/Tabs/Reports/Reports.css` — appended dashboard styles
(toolbar, KPI cards, chart cards, tables, sufficiency-band pills) using existing tokens.
**File:** `src/auth/userManagement.test.ts` — 4 tests for the new permission (registered in
`MANAGED_TABS`; present for every role; manager+admin-only default).

---

## v33.0 — 2026-06-30 — Executive report Phase 4: the Presentation (deck) (FEATURE)

New `src/data/reporting/executive/deck/` — ~14 curated 16:9 landscape slides built from the
single `ReportModel` (blueprint §3), reusing `ui/charts.ts`, `ui/icons.ts` (no emoji), and
the `theme.ts` palette via `EXEC_CSS`. Curated highlights (top-5 inspectors, security-risk
verdict, cross-team corroboration, priority actions, decisions); each slide = one message +
hero visual + "القرار المدعوم" footer. Honors data-sufficiency + missing/zero/N-A; print
`@page { size: 297mm 167mm }`.

**Files (new):** `deck/{deckTheme,shared,slides,viewer,index,deck.test}.ts`.

**Entry points** (`deck/index.ts`):
```ts
export function buildExecutiveDeck(input: ExecutiveReportInput, employeeDisplayNames?: Record<string, string>): string;
export function openExecutiveDeck(input: ExecutiveReportInput, employeeDisplayNames?: Record<string, string>): void;
// openExecutiveDeck → openOrDownload(html, `العرض_التنفيذي_${input.monthFolderName}.html`)
```
8 deck tests (slide count/titles, landscape sizing, inline `<svg>`, no emoji, unmapped state).

---

## v32.0 — 2026-06-30 — Executive report Phase 5: data Workbook (.xlsx) (FEATURE)

New `executive/workbook/workbook.ts` (`buildExecutiveWorkbook`) emits one `.xlsx` with the
full raw→processed→analytical chain (design §7): Raw-Risk, Raw-BI (unavailable note),
Exclusions (note), Decision Fact Table, Result Comparison (six sources + agreement),
KPI/ports/stages/image-quality/result-quality/all-rows (now sourced from `ReportModel`),
Employee-by-Port, Error Analysis, Cross-team Agreement (N×N). One `buildReportModel` call;
inspector IDs vs reviewer names; §3.7 missing/zero/N-A discipline. `buildExecutiveXlsx`
now delegates to it (Reports-tab call unchanged). 10 workbook tests read sheets back via
`XLSX.utils`.

**File:** `src/data/reporting/executiveReport.ts`

**Before:**
```ts
import * as XLSX from "xlsx";
import type { ExecutiveReportInput } from "./executiveReportTypes";
import { buildExecutiveReportRows, calculateExecutiveKPIs } from "./executiveReportData";
export { buildExecutiveReport, openExecutiveReport } from "./executive/index";
export function buildExecutiveXlsx(input: ExecutiveReportInput): void {
  // …~160 lines building 6 sheets inline, then XLSX.writeFile(…)
}
```

**After:**
```ts
import type { ExecutiveReportInput } from "./executiveReportTypes";
import { buildExecutiveWorkbook } from "./executive/workbook/workbook";
export { buildExecutiveReport, openExecutiveReport } from "./executive/index";
export function buildExecutiveXlsx(
  input: ExecutiveReportInput,
  employeeDisplayNames?: Record<string, string>,
): void {
  buildExecutiveWorkbook(input, employeeDisplayNames);
}
```

**Files (new):** `src/data/reporting/executive/workbook/workbook.ts`
(`buildExecutiveWorkbook` + pure `buildExecutiveWorkbookObject` + `SHEET_NAMES`),
`src/data/reporting/executive/workbook/workbook.test.ts` (10 cases).

> Follow-up: Raw-BI and Exclusions sheets emit an "unavailable" note because
> `ExecutiveReportInput` does not carry raw BI rows or the exclusions log; populating them
> requires threading those into the input (tracked separately).

---

## v31.0 — 2026-06-30 — Executive report Phase 3: Document renderer rebuilt on ReportModel (FEATURE)

Rebuilt the executive Document as an A4-portrait, model-driven renderer (design §5,
blueprint §2). New `executive/document/` module assembles front matter + 5 parts (Scope &
Method, Inspection Quality, Corroboration, Accountability, Risk & Actions) + appendix from
a single `ReportModel`, with dynamic per-port pages keyed on inspector IDs. The
`fitPages()` runtime `transform:scale` hack is removed (explicit `pagination.ts` instead),
every emoji glyph is replaced by `ui/icons.ts` SVGs, and analytical pages use the
layered headline+depth pattern with the 3-line executive close. The Employee Agreement
Matrix is gone. Public API (`buildExecutiveReport`/`openExecutiveReport`) unchanged.

**File:** `src/data/reporting/executive/index.ts`

**Before:**
```ts
import { buildExecutiveReportRows, calculateExecutiveKPIs } from "../executiveReportData";
import { buildContext } from "./context";
import { assembleReport } from "./assemble";
// …25+ individual page-builder imports…
export function buildExecutiveReport(input, employeeDisplayNames = {}): string {
  const rows = buildExecutiveReportRows(input);
  const kpis = calculateExecutiveKPIs(rows, input.sample, input.config);
  const ctx  = buildContext(input, kpis, employeeDisplayNames, rows);
  const pages = [ buildCover, buildToc, /* …~25 builders… */ buildAppendix ];
  return assembleReport(ctx, pages);
}
```

**After:**
```ts
import { buildReportModel } from "./model/reportModel";
import { buildDocumentSlides } from "./document/index";
import { buildViewerHtml } from "./viewer";
export function buildExecutiveReport(input, employeeDisplayNames = {}): string {
  const model = buildReportModel(input, employeeDisplayNames);
  const slides = buildDocumentSlides(model, formatIssueDate());
  return buildViewerHtml(slides, formatMonthLabel(input.monthFolderName));
}
```

**File:** `src/data/reporting/executive/viewer.ts` — removed the `fitPages()` auto-scale
script; pages are fixed A4 boxes with explicit pagination.
**File:** `src/data/reporting/executive/theme.ts` — layout/emoji refinements for the fixed
A4 document.
**Files (new):** `src/data/reporting/executive/document/{index,frontMatter,dividers,narrative,pagination,shared,partScope,partQuality,partCorroboration,partAccountability,partRisk}.ts`.

**File:** `src/data/reporting/executiveReport.test.ts` — updated to the new A4 document
structure: asserts A4-portrait sizing, theme tokens, cover + level definitions, the
"الدقة حسب المنفذ" section, presence of inline `<svg>` icons, and **no emoji**
(pictographic-range regex); dropped the stale "PowerPoint slide sizing" / old-title checks.

---

## v30.0 — 2026-06-30 — Executive report Phase 1: analytical layer (ReportModel) (FEATURE)

The single computed analytical layer for the rework (design spec §3): a decision-level
fact table, the six-source image comparison + cross-team agreement views, data-sufficiency
bands, and one `ReportModel` consumed by every renderer and the in-app dashboard. Reuses
the existing KPI math; employee accuracy keys on inspector IDs (with an explicit
`inspectorIdentityMapped=false` state for the current BI-unmapped period). 82 reporting
tests; full suite 257 green.

**File:** `src/data/reporting/executiveReportTypes.ts`

**Before:**
```ts
export type ExecutiveReportRow = {
  xrayImageId: string;
  portName: string | null;
  portType: string | null;
  stage: string | null;
  // …existing fields…
  verificationCategory: VerificationCategory | null;
};
```

**After:**
```ts
export type OtherTeamResult = { result: "سليمة" | "اشتباه" | null; employeeId: string | null };
export type OtherResultsPanel = { manual: OtherTeamResult; opposite: OtherTeamResult; liveMeans: OtherTeamResult };

export type ExecutiveReportRow = {
  xrayImageId: string;
  portCode: string | null;
  portName: string | null;
  portType: string | null;
  movementType: string | null;
  stage: string | null;
  // …existing fields…
  verificationCategory: VerificationCategory | null;
  otherResults: OtherResultsPanel;
  notes: string | null;
};

export type DataSufficiencyThresholds = { insufficient: number; limited: number; sufficient: number };
export const DEFAULT_DATA_SUFFICIENCY_THRESHOLDS: DataSufficiencyThresholds = { insufficient: 1, limited: 10, sufficient: 20 };
// ExecutiveReportConfig / DEFAULT_EXEC_CONFIG gain: dataSufficiencyThresholds
```

**File:** `src/data/reporting/executiveReportData.ts`

**Before:**
```ts
    return {
      xrayImageId: pop.xrayImageId,
      portName: pop.portName,
      portType: pop.portType,
      stage: pop.stage,
      // …
      verificationCategory,
    };
```

**After:**
```ts
    return {
      xrayImageId: pop.xrayImageId,
      portCode: pop.portCode,
      portName: pop.portName,
      portType: pop.portType,
      movementType: pop.movementType,
      stage: pop.stage,
      // …
      verificationCategory,
      otherResults: {
        manual: { result: pop.otherResults.manual.result, employeeId: pop.otherResults.manual.employeeId },
        opposite: { result: pop.otherResults.opposite.result, employeeId: pop.otherResults.opposite.employeeId },
        liveMeans: { result: pop.otherResults.liveMeans.result, employeeId: pop.otherResults.liveMeans.employeeId },
      },
      notes: pop.notes,
    };
```

**Files (new):** `src/data/reporting/executive/model/decisionFactTable.ts`
(`DecisionRecord`, `ImageResultComparison`, `classifyOutcome`, `buildDecisionRecords` —
2 records/case, per-level §9 classification, evaluability rule; `buildImageComparisons` —
six sources, `agreesWithReview` only when both present), `model/dataSufficiency.ts`
(`band`, `isRankable`), `model/aggregates.ts` (`buildAggregates`: per-port/stage/movement,
employee-by-port-and-level keyed on `inspectorId`, error-type, reviewer-agreement + N×N
cross-team matrix), `model/reportModel.ts` (`ReportModel`, `buildReportModel`),
`model/model.test.ts` (analytical-layer tests).

**Files (test fixtures):** `src/data/reporting/executive/executiveEmployeeData.test.ts`,
`.../portEmployeeData.test.ts` — added `portCode`, `movementType`, `otherResults`, `notes`.

---

## v29.0 — 2026-06-30 — Executive report Phase 2: visual primitives (tokens, icons, charts) (FEATURE)

Adds the static-SVG visual system for the executive-report rework (design spec §4):
centralized design tokens, stroke-based line icons (no emoji), and pure-function
inline-SVG chart primitives. All output is print-safe static SVG strings — no React,
no runtime JS, no canvas, no npm dependencies. 34 unit tests added.

**File:** `src/data/reporting/executive/ui/tokens.ts` (new)

**Before:**
```ts
// (new file)
```

**After:**
```ts
// SPACE / TYPE / WEIGHT / RADIUS scales, COLOR_ROLE map + SERIES_ROLES referencing
// theme.ts CSS var names, FONT_FAMILY; helpers colorVarName, cssVar→"var(--…)",
// seriesColor, tokensCss, clamp, clampPct.
```

**File:** `src/data/reporting/executive/ui/icons.ts` (new)

**Before:**
```ts
// (new file)
```

**After:**
```ts
// 12 stroke-based line icons (viewBox 0 0 24 24, stroke="currentColor", fill="none",
// configurable size): shield, port, scan, gauge, flag, alert, check, layers, users,
// document, chart, arrow. icon(name,size?) lookup + named exports + ICON_NAMES.
// No emoji; neutral fallback for unknown names.
```

**File:** `src/data/reporting/executive/ui/charts.ts` (new)

**Before:**
```ts
// (new file)
```

**After:**
```ts
// Pure (data, opts) => string SVG primitives, hand-rolled geometry, theme var(--…)
// colors: rankedBar (RTL labels right), donut, gauge (0–100), groupedBars, stackedBars,
// quadrantScatter, heatmap (null cells → "—"), sparkline. Empty/null/zero-denominator
// data → neutral "—" empty state; never throws; percentages clamped 0–100.
```

**Files:** `src/data/reporting/executive/ui/icons.test.ts`, `charts.test.ts` (new)
Vitest (node env): assert valid `<svg>`/viewBox, no emoji, graceful empty-data handling,
no NaN/Infinity (no divide-by-zero), percentage clamping. 34 tests pass.

---

## v28.0 — 2026-06-30 — Executive report Phase 0: carry all five result sources through the population pipeline (FEATURE)

The three previously-dropped result sources (manual / opposite / live-means) plus
`notes` now flow through `PreparedPopulationRow` at the source, enabling the
cross-team comparison in the executive-report rework (design spec §2.5). L1/L2 remain
the only gate on population entry; other teams are optional corroborating evidence and
never exclude a row. `population.final.json` needs no schema-version bump — it serializes
the new fields via the existing `...rest` spread and reads old files back gracefully
(missing fields default to the null shape).

**File:** `src/data/population/populationTypes.ts`

**Before:**
```ts
export type PreparedPopulationRow = {
  // …
  levelOneEmployee: string | null;
  levelTwoEmployee: string | null;

  biEnrichmentStatus: BiEnrichmentStatus;
```

**After:**
```ts
export type TeamResult = {
  result: "سليمة" | "اشتباه" | null;
  code: string | null;
  employeeId: string | null;
};

export type PreparedPopulationRow = {
  // …
  levelOneEmployee: string | null;
  levelTwoEmployee: string | null;

  // Other (non-L1/L2) teams — optional corroborating evidence. A blank result is
  // `null` and never excludes the row. `manual` has no BI employee → employeeId null.
  otherResults: { manual: TeamResult; opposite: TeamResult; liveMeans: TeamResult; };
  notes: string | null;

  biEnrichmentStatus: BiEnrichmentStatus;
```

**File:** `src/components/Sidebar/Tabs/Population/processing/populationProcessor.ts`

**Before:**
```ts
        levelOneEmployee: enrichment.row.levelOneEmployee,
        levelTwoEmployee: enrichment.row.levelTwoEmployee,

        biEnrichmentStatus: enrichment.biEnrichmentStatus,
```

**After:**
```ts
        levelOneEmployee: enrichment.row.levelOneEmployee,
        levelTwoEmployee: enrichment.row.levelTwoEmployee,

        otherResults: {
          manual:    { result: normalizeResultValue(enrichment.row.manualResult),    code: enrichment.row.manualResultCode,    employeeId: null },
          opposite:  { result: normalizeResultValue(enrichment.row.oppositeResult),  code: enrichment.row.oppositeResultCode,  employeeId: enrichment.row.oppositeEmployee },
          liveMeans: { result: normalizeResultValue(enrichment.row.liveMeansResult), code: enrichment.row.liveMeansResultCode, employeeId: enrichment.row.liveMeansEmployee }
        },
        notes: enrichment.row.notes,

        biEnrichmentStatus: enrichment.biEnrichmentStatus,
```

Also: `PreparedDraftRow` gained the raw other-team fields; `toPreparedDraftRow` carries
`inspectorResult`→manual, `oppositeInspectorResult`→opposite, `liveMeansResult`→liveMeans;
`enrichDraftRowFromBi` fills result/code/employee/notes from the BI match only when the
risk value is blank (mirroring the L1/L2 rule).

**File:** `src/components/Sidebar/Tabs/Population/processing/populationExporter.ts`

**Before:**
```ts
      "نتيجة المستوى الثاني للأشعة": row.xrayLevelTwoResult,
      "نوع الحركة": row.movementType,
```

**After:**
```ts
      "نتيجة المستوى الثاني للأشعة": row.xrayLevelTwoResult,
      "نتيجة المعاين": row.otherResults.manual.result,
      "رمز نتيجة المعاين": row.otherResults.manual.code,
      "نتيجة المفتش المعاكس": row.otherResults.opposite.result,
      "رمز نتيجة المفتش المعاكس": row.otherResults.opposite.code,
      "موظف التفتيش المعاكس": row.otherResults.opposite.employeeId,
      "نتيجة الوسائل الحية": row.otherResults.liveMeans.result,
      "رمز نتيجة الوسائل الحية": row.otherResults.liveMeans.code,
      "موظف الوسائل الحية": row.otherResults.liveMeans.employeeId,
      "ملاحظة المستويات": row.notes,
      "نوع الحركة": row.movementType,
```

**File:** `src/components/Sidebar/Tabs/Population/processing/populationProcessor.test.ts`
Added 4 TDD cases: other-team results survive normalized; BI enrichment fills
result/code/employee + notes when risk blank; all-blank other teams still included;
missing L1/L2 still excluded.

**Files (test fixtures — required for clean typecheck against the new required fields):**
`src/data/sampling/sampleAlgorithm.test.ts`, `src/data/distribution/{bulkAssignment,distributionLog,replacement}.test.ts`,
`src/data/reporting/{executiveReport,executiveReportData}.test.ts` — each inline
`PreparedPopulationRow` literal gained an all-null `otherResults` + `notes` block.

**Before:**
```ts
    levelOneEmployee: null,
    levelTwoEmployee: null,
```

**After:**
```ts
    levelOneEmployee: null,
    levelTwoEmployee: null,
    otherResults: {
      manual: { result: null, code: null, employeeId: null },
      opposite: { result: null, code: null, employeeId: null },
      liveMeans: { result: null, code: null, employeeId: null }
    },
    notes: null,
```

---

## v27.6 — 2026-06-30 — auth: point sign-in logo at external ZATCA SVG

**File:** `src/auth/AuthGate.tsx`

**Before:**
```tsx
<img
  src={`${import.meta.env.BASE_URL}logo.svg`}
  alt=""
  aria-hidden="true"
  onError={handleLogoError}
/>
```

**After:**
```tsx
<img
  src="https://zatca.gov.sa/_layouts/15/zatca/Design/images/ZATCA-logo.svg"
  alt=""
  aria-hidden="true"
  onError={handleLogoError}
/>
```

The login screen logo now loads the official ZATCA logo from zatca.gov.sa instead of the bundled `logo.svg`. Note: this makes the (otherwise self-contained) build fetch an external asset at runtime; if the host is offline or the URL changes, `handleLogoError` hides the image and applies the `auth-logo-empty` fallback.

---

## v27.7 — 2026-06-30 — auth: size & center the ZATCA logo on the brand panel

**File:** `src/auth/AuthGate.css`

**What changed:** The ZATCA logo is a wide landscape mark; the old 80×80 square box with a dark translucent background made it tiny and low-contrast. Reworked the logo container into a larger, centered light card and centered the whole brand block.

**Before:**
```css
.auth-brand-inner {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  animation: auth-brand-in 1.0s cubic-bezier(0.16, 1, 0.3, 1) 0.12s both;
}
...
.auth-logo {
  width: 80px;
  height: 80px;
  margin-bottom: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border-radius: 20px;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.10);
  box-shadow:
    0 0 0 8px rgba(45, 125, 210, 0.06),
    0 8px 24px rgba(0,0,0,0.24);
  padding: 14px;
}
```

**After:**
```css
.auth-brand-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  animation: auth-brand-in 1.0s cubic-bezier(0.16, 1, 0.3, 1) 0.12s both;
}
...
.auth-logo {
  width: 240px;
  height: 120px;
  margin-bottom: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border-radius: 18px;
  background: #FFFFFF;
  border: 1px solid rgba(255,255,255,0.10);
  box-shadow:
    0 0 0 8px rgba(45, 125, 210, 0.08),
    0 12px 32px rgba(0,0,0,0.30);
  padding: 20px 28px;
}
```

Mobile override (`max-width` block) updated from a 46×46 square to a 132×52 landscape card to match.

---

## v27.5 — 2026-06-29 — design: shadow hierarchy — remove box-shadow from flat toolbar and card elements

**Files:** `src/components/DataTable/DataTable.css`, `src/index.css` (audit — no changes required)

**Before:** `box-shadow` on flat toolbar/filter/card elements alongside borders.

**After:** Shadows removed from flat elements; border provides the separation. Elevation reserved for floating UI (modals, side panels).

**Audit finding:** Shadow hierarchy is already correct as of this version. Specific findings:
- `.dt-toolbar` → `box-shadow: none` ✓
- `.dt-table-wrap` → `box-shadow: none` ✓
- `.dt-export-btn`, `.dt-autofit-btn`, `.dt-col-picker-btn` → `box-shadow: none` ✓
- `.app-card`, `.app-panel`, `.ui-panel` → `box-shadow: var(--sh-xs)` (0 1px 2px) — within the acceptable threshold per task spec
- `.dt-filter-menu`, `.dt-col-picker` → `box-shadow: var(--sh-md)` ✓ correct (floating dropdowns)
- `.app-backup-toast` → `box-shadow: var(--sh-sm)` ✓ correct (fixed-position floating toast)
- Auth modals (`.auth-split`, `.auth-admin-modal`) → untouched ✓

No code edits applied — the codebase already enforces the intended shadow hierarchy.

---

## v27.4 — 2026-06-29 — design: replace transition:all with specific properties across CSS

**Files:** `src/components/DataTable/DataTable.css`, `src/components/Sidebar/Tabs/UserManagement/UserManagement.css`, `src/components/Sidebar/Tabs/Population/Population.css`, `src/components/Sidebar/Tabs/Settings/Settings.css`, `src/components/Sidebar/Tabs/EmployeeWorkspace/EmployeeWorkspace.css`

**Before:** `transition: all <duration> <easing>` in 11 locations across 5 files.

**After:** Each replaced with a targeted property list matching the element's actual animated properties (background-color, box-shadow, transform for buttons; border-color, color for nav/filter pills; border-color, box-shadow, background-color for inputs).

---

## v27.3 — 2026-06-29 — design: typography — tabular-nums on data cells, lighter table header weight

**File:** `src/components/DataTable/DataTable.css`

**Before:** `.dt-th-label` `font-weight: 700`; `.dt-td` missing explicit `font-variant-numeric`.

**After:** `.dt-th-label` `font-weight: 500`; `.dt-td` gets `font-variant-numeric: tabular-nums` after `text-align`.

Note: No `.stat-value`, `.kpi-value`, or `.metric` classes found in `src/index.css` — task 3 skipped.

---

## v27.2 — 2026-06-29 — design: sidebar active nav item — tighter background opacity + label tracking

**File:** `src/components/Sidebar/Sidebar.css`

**Before:** Active item background `rgba(0, 154, 222, 0.18)`; `--sb-accent-sub` custom property `rgba(0, 154, 222, 0.18)`; no letter-spacing on active label.

**After:** Active item background `rgba(0, 154, 222, 0.13)`; `--sb-accent-sub` reduced to `rgba(0, 154, 222, 0.13)`; active label gets `letter-spacing: -0.01em`.

---

## v27.1 — 2026-06-29 — design: AuthGate brand panel + decorative rings + button shimmer cleanup

**File:** `src/auth/AuthGate.css`

**Before:** 3-layer ambient radial gradient brand panel background; `.auth-brand-ring` decorative concentric circles; shimmer pseudo-element sweep on submit button hover.

**After:** Single clean directional linear gradient for brand panel; `.auth-brand-ring` block removed entirely; shimmer pseudo-element removed; button hover uses existing translateY + shadow only.

## v27.0 — 2026-06-29 — design: remove AI-tell decorative noise from AuthGate login screen

**File:** `src/auth/AuthGate.css`

**Before:**
```css
/* auth-root background: 3 ambient radial blobs + linear gradient */
background:
  radial-gradient(ellipse 80% 60% at 15% 20%, rgba(45, 125, 210, 0.18) 0%, transparent 60%),
  radial-gradient(ellipse 60% 50% at 85% 80%, rgba(15, 39, 68, 0.50) 0%, transparent 55%),
  radial-gradient(ellipse 40% 40% at 70% 10%, rgba(94, 184, 255, 0.10) 0%, transparent 50%),
  linear-gradient(150deg, #05101F 0%, #0C1E38 40%, #071528 100%);

/* ::before — dot-grid overlay */
.auth-root::before { background-image: radial-gradient(rgba(255,255,255,0.028) 1px, transparent 1px); background-size: 28px 28px; }

/* ::after — large ambient glow blobs */
.auth-root::after { background: radial-gradient(circle 600px at 10% 90%, ...) radial-gradient(circle 500px at 90% 10%, ...); }

/* auth-panel-brand background: 2 ambient radial blobs + linear gradient */
background:
  radial-gradient(ellipse 120% 60% at 50% -10%, rgba(45, 125, 210, 0.30) 0%, transparent 60%),
  radial-gradient(ellipse 80% 80% at 110% 80%, rgba(94, 184, 255, 0.12) 0%, transparent 55%),
  linear-gradient(165deg, #112C50 0%, #0A1D36 55%, #071428 100%);

/* .auth-brand-ring — 3 nested decorative concentric circles */
.auth-brand-ring { border: 1px solid rgba(94, 184, 255, 0.08); }
.auth-brand-ring::before { border: 1px solid rgba(94, 184, 255, 0.05); }
.auth-brand-ring::after { border: 1px solid rgba(94, 184, 255, 0.04); }

/* .auth-submit::after — shimmer sweep on hover */
.auth-submit::after { background: linear-gradient(105deg, transparent 30%, rgba(255,255,255,0.10) 50%, transparent 70%); transform: translateX(100%); }
.auth-submit:hover::after { transform: translateX(-100%); }
```

**After:**
```css
/* auth-root background: single clean directional gradient */
background: linear-gradient(150deg, #071528 0%, #0C1E38 55%, #0E2444 100%);

/* ::before — removed entirely (was dot-grid) */
/* ::after — kept but simplified to a single subtle top glow */

/* auth-panel-brand background: clean directional gradient */
background: linear-gradient(170deg, #112C50 0%, #0A1D36 60%, #071428 100%);

/* .auth-brand-ring — removed entirely */

/* .auth-submit::after — removed shimmer; replaced with clean scale on active */
```

---

## v26.1 — 2026-06-29 — fix: quota miscounting after reassignment; casLoop non-transient retry; dead _submit param; silent answer-file catch

**File:** `src/data/distribution/distributionLog.ts` — quota `assignCountPerEmployee` now counts from final entryMap (post-reassignment) instead of raw assigned events. Replaced items excluded. Sample sizes are unaffected (quotas are display-only).

**File:** `src/data/storage/casLoop.ts` — unexpected exceptions now fail immediately instead of retrying 10 times with backoff.

**File:** `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx` + `src/components/InspectionPanel/index.tsx` — removed dead `submit: boolean` param from `onSave` type and all call sites. All saves are final submissions; no draft path exists.

**File:** `src/data/answers/answerStorage.ts` — `loadAllEmployeeFiles` now logs errors via `logError` before returning `[]` instead of swallowing them silently.

---

## v26 — 2026-06-29 — feat: premium split-panel login screen rework

**File:** `src/auth/AuthGate.tsx`

**Before:**
```tsx
<main className="auth-root" dir="rtl">
  <section className="auth-card" role="dialog" aria-modal="true" aria-labelledby="authTitle">
    <div className="auth-brand">
      <div className="auth-logo" …><img … /></div>
      <div><h1>نظام معالجة بيانات الأشعة</h1><p>بوابة دخول المستخدمين</p></div>
    </div>
    {hasConfiguredUsers ? <form className="auth-form" …> … </form> : …}
    <footer className="auth-footer"> … </footer>
  </section>
  {isAdminModalOpen ? … : null}
</main>
```

**After:**
```tsx
<main className="auth-root" dir="rtl">
  <div className="auth-split">
    <aside className="auth-panel-brand">…logo, h1, tagline, org-path…</aside>
    <section className="auth-panel-form" role="dialog" aria-modal="true" aria-labelledby="authTitle">
      <div className="auth-form-inner">
        <div className="auth-form-header"><h2 id="authTitle">تسجيل الدخول</h2>…</div>
        <form className="auth-form" …>
          {/* inputs now use .auth-input-wrap with inline SVG icons; eye toggle is .auth-eye-toggle inside the input */}
        </form>
        <footer className="auth-footer">…</footer>
      </div>
    </section>
  </div>
  {isAdminModalOpen ? … : null}
</main>
```

**File:** `src/auth/AuthGate.css`

**Before:** Floating `.auth-card` layout with `.auth-brand`, `.auth-password-wrap` side-by-side button.

**After:** Full split-panel layout — `.auth-split` grid, `.auth-panel-brand` (navy), `.auth-panel-form` (white), `.auth-input-wrap` with `.auth-input-icon` and `.auth-eye-toggle` inside inputs. Staggered entry animations per panel.

---

## v25.5 — 2026-06-29 — fix: restore lint gate — argsIgnorePattern + remove stale eslint-disable

**File:** `eslint.config.js`

**Before:**
```js
    languageOptions: {
      globals: globals.browser,
    },
  },
])
```

**After:**
```js
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
])
```

---

## v25.4 — 2026-06-29 — Task 5: Integration review

**File:** `src/data/reporting/executive/pages/distributionOverview.ts`

**Before:**
```html
<!-- both no-data path (line 19) and data path (line 69) -->
<div class="page-no">11</div>
```

**After:**
```html
<div class="page-no">24</div>
```

**File:** `src/data/reporting/executive/pages/appendix.ts`

**Before:**
```html
<div class="page-no">20</div>
```

**After:**
```html
<div class="page-no">25</div>
```

**File:** `src/data/reporting/executive/pages/sampleByLevel.ts`

**Before:**
```html
<table>
  <thead>…</thead>
  <tbody>…</tbody>
</table>
```

**After:**
```html
<div class="table-wrap"><table>
  <thead>…</thead>
  <tbody>…</tbody>
</table></div>
```

**File:** `src/data/reporting/executive/pages/toc.ts`

**Before:**
```html
<tr><td>أداء الموظفين</td><td>15–20</td></tr>
<tr><td>تحليل الأخطاء والتوافق</td><td>21–22</td></tr>
<tr><td>الأولوية والإجراءات</td><td>23</td></tr>
```

**After:**
```html
<tr><td>أداء الموظفين (متغير حسب المنافذ)</td><td>15+</td></tr>
<tr><td>تحليل الأخطاء والتوافق</td><td>—</td></tr>
<tr><td>الأولوية والإجراءات</td><td>—</td></tr>
```

**File:** `src/data/reporting/executive/pages/analyticsMap.ts`

**Before:**
```html
<p>17 — أداء الموظفين حسب المنفذ</p>
<p>18 — مقارنة الموظفين بين المنافذ</p>
```

**After:**
```html
<p>17+ — أداء الموظفين حسب المنفذ (صفحة لكل منفذ)</p>
<p>— مقارنة الموظفين بين المنافذ</p>
```

---

## v25.3 — 2026-06-29 — Task 4: Per-port employee analysis section

**File:** `src/data/reporting/executive/portEmployeeData.ts`

**Before:**
```ts
// (new file)
```

**After:**
```ts
// Pure data-derivation module: buildPortEmployeeAnalyses(rows)
// Produces one PortEmployeeAnalysis per non-empty port (land first, then sea).
// Keyed on levelOneEmployeeId / levelTwoEmployeeId (original assessors, NOT QA reviewers).
// accuracy = correct / verified * 100, null when verified === 0.
```

---

**File:** `src/data/reporting/executive/pages/portEmployeeAnalysis.ts`

**Before:**
```ts
// (new file)
```

**After:**
```ts
// buildPortEmployeeAnalysisPages(ctx) → Array<(ctx) => string>
// Returns one page-builder closure per non-empty port.
// Each page: grid-4 KPI cards + two level tables (stage1/stage2) in .port-split.page-fill.
// Falls back to a single graceful empty-state page when no port employee data exists.
```

---

**File:** `src/data/reporting/executive/index.ts`

**Before:**
```ts
import { buildEmpByPort, buildEmpCrossPort } from "./pages/empByPort";
// …
  const pages = [
    // …
    buildEmpByDecision,
    buildEmpByPort,
    buildEmpCrossPort,
    // …
  ];
```

**After:**
```ts
import { buildEmpCrossPort } from "./pages/empByPort";
import { buildPortEmployeeAnalysisPages } from "./pages/portEmployeeAnalysis";
// …
  const portEmpPages = buildPortEmployeeAnalysisPages(ctx); // one per port
  const pages = [
    // …
    buildEmpByDecision,
    ...portEmpPages,          // ← dynamic per-port pages (replaces buildEmpByPort)
    buildEmpCrossPort,
    // …
  ];
```

---

## v25.2 — 2026-06-29 — Task 3: Fix empty space on data pages

**File:** `src/data/reporting/executive/pages/populationByRisk.ts`

**Before:**
```ts
    <div class="port-split">
      <div class="card land">
        <div class="panel-title">المنافذ البرية</div>
        <div class="table-wrap"><table>
          <thead><tr><th>المنفذ</th><th>الإجمالي</th><th>سليمة</th><th>اشتباه</th></tr></thead>
          <tbody>
            ${landRows.map(portRow).join("")}
            ${landMore}
            <tr class="total-row"><td>الإجمالي</td><td>${fmtNum(landTotal)}</td><td>${fmtNum(landCleanTotal)}</td><td>${fmtNum(landSuspTotal)}</td></tr>
          </tbody>
        </table></div>
      </div>
      <div class="card sea">
        <div class="panel-title">المنافذ البحرية</div>
        <div class="table-wrap"><table>
          <thead><tr><th>المنفذ</th><th>الإجمالي</th><th>سليمة</th><th>اشتباه</th></tr></thead>
          <tbody>
            ${seaRows.map(portRow).join("")}
            ${seaMore}
            ${seaPorts.length > 0
              ? `<tr class="total-row"><td>الإجمالي</td><td>${fmtNum(seaTotal)}</td><td>${fmtNum(seaCleanTotal)}</td><td>${fmtNum(seaSuspTotal)}</td></tr>`
              : `<tr class="total-row"><td colspan="4"><span class="muted">لا توجد منافذ بحرية</span></td></tr>`}
          </tbody>
        </table></div>
      </div>
    </div>
    <div class="page-no">05</div>
  </div>
</section>`;
```

**After:**
```ts
    <div class="page-fill">
      <div class="port-split">
        <!-- land/sea tables with empty guards -->
      </div>
      <div class="context-band">
        <!-- methodology card + summary stat-stack -->
      </div>
    </div>
    <div class="page-no">05</div>
  </div>
</section>`;
```

**File:** `src/data/reporting/executive/pages/populationByLevel.ts`

**Before:**
```ts
    <div class="grid grid-2" style="margin-top:18px">
      ${stageTableBlocks}
    </div>
    <div class="page-no">06</div>
```

**After:**
```ts
    <div class="page-fill">
      <div class="grid grid-2" style="margin-top:18px">
        ${stageTableBlocks}
      </div>
      ${stageProfiles empty? notice-centered : context-band methodology}
    </div>
    <div class="page-no">06</div>
```

**File:** `src/data/reporting/executive/pages/sampleByLevel.ts`

**Before:**
```ts
    <div class="grid grid-2">
      ${stageCards}
    </div>
    <div class="page-no">07</div>
```

**After:**
```ts
    <div class="page-fill">
      <div class="grid grid-2">
        ${stageCards}
      </div>
      <div class="context-band">
        <!-- methodology + coverage stat-stack -->
      </div>
    </div>
    <div class="page-no">07</div>
```

**File:** `src/data/reporting/executive/pages/accuracyByPort.ts`

**Before:**
```ts
    <div class="table-wrap"><table>...</table></div>
    <div class="page-no">09</div>
```

**After:**
```ts
    <div class="page-fill">
      <!-- when no data: pending notice-centered; otherwise table + context-band -->
    </div>
    <div class="page-no">09</div>
```

**File:** `src/data/reporting/executive/pages/accuracyByLevel.ts`

**Before:**
```ts
    <div class="table-wrap" style="margin-top:18px">...</div>
    <div class="info" style="margin-top:18px">...</div>
    <div class="page-no">10</div>
```

**After:**
```ts
    <div class="page-fill">
      <!-- when no data: pending full-page state; otherwise table + info wrapped in page-fill -->
    </div>
    <div class="page-no">10</div>
```

---

## v25.0 — 2026-06-29 — Task 1: CSS empty-space fixes (theme.ts)

**File:** `src/data/reporting/executive/theme.ts`

**A.1 — `.page-inner` flex column + `.page-fill` / `.page-no` utilities**

**Before:**
```css
.page-inner{
  position:relative;z-index:2;height:100%;
  width:calc(100% - 44px);margin-right:44px;
  padding:30px 28px 36px 28px;overflow:hidden;
}
```

**After:**
```css
.page-inner{
  position:relative;z-index:2;height:100%;
  width:calc(100% - 44px);margin-right:44px;
  padding:30px 28px 36px 28px;overflow:hidden;
  display:flex;flex-direction:column;
}
.page-fill{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;}
.page-fill > .table-wrap{flex:1 1 auto;min-height:0;}
.page-fill .grid{flex:1 1 auto;align-content:start;}
.page-inner > .page-no{margin-top:auto;}
```

**A.2 — `.big-divider` three-band redesign + ghost numeral (`--divider-num`)**

**Before:**
```css
.big-divider{
  display:flex;flex-direction:column;
  justify-content:center;align-items:flex-end;
  padding:60px 48px;position:relative;overflow:hidden;height:100%;
}
/* (single ::before blob, flat layout, no divider-top/center/toc) */
```

**After:**
```css
.big-divider{
  display:flex;flex-direction:column;
  justify-content:space-between;align-items:stretch;
  padding:54px 48px 64px;position:relative;overflow:hidden;height:100%;
}
/* dual ::before gradient blobs, ::after ghost numeral via --divider-num,
   .divider-top / .divider-center / .divider-toc three-band structure */
```

**A.3 — `.context-band` sparse-data filler (new additive block)**

**Before:** *(rule did not exist)*

**After:**
```css
.context-band{display:grid;grid-template-columns:1.4fr 1fr;gap:14px;margin-top:16px;flex:1 1 auto;align-items:stretch;}
/* .method-list, .stat-stack, .stat-pill sub-rules also added */
@media(max-width:980px){.context-band{grid-template-columns:1fr;}}
```

**A.4 — `.cover-bg-art::after` bottom-right secondary blob**

**Before:**
```css
.cover-bg-art{
  position:absolute;left:-5%;top:15%;width:55%;height:70%;
  background:radial-gradient(ellipse at center,rgba(107,169,248,.06) 0%,transparent 60%);
  border-radius:50%;pointer-events:none;z-index:1;
}
```

**After:**
```css
/* same .cover-bg-art, plus: */
.cover-bg-art::after{
  content:"";position:absolute;right:-60%;bottom:-50%;width:120%;height:120%;
  background:radial-gradient(ellipse at center,rgba(244,180,0,.05) 0%,transparent 62%);
  border-radius:50%;
}
```

---

## v25.1 — 2026-06-29 — Task 2: Part divider redesign (3-band layout)

**File:** `src/data/reporting/executive/pages/partDivider.ts`

**Before:**
```ts
export function buildPartDivider(
  partLabel: string, title: string, subtitle: string, icon: string,
  pageId: string, pageNum: string, railTabs: string[], dataTitle: string,
): (_ctx: ExecutiveRenderContext) => string {
  return (_ctx) => `<section class="page" id="${pageId}" data-title="${esc(dataTitle)}">
  <div class="right-rail">
    <div class="rail-main">التقرير التنفيذي <em>لضمان جودة الأشعة</em></div>
    ${railTabs.map((t, i) => `<div class="rail-tab${i === 0 ? ' active' : ''}">${esc(t)}</div>`).join('')}
  </div>
  <div class="page-inner big-divider">
    <div class="icon">${icon}</div>
    <div class="kicker">${esc(partLabel)}</div>
    <h1>${esc(title)}</h1>
    <div class="rule"></div>
    <p class="lead">${esc(subtitle)}</p>
    <div class="page-no">${esc(pageNum)}</div>
  </div>
</section>`;
}

export const buildPart1Divider = buildPartDivider(
  'الجزء الأول', 'مجتمع الحالات',
  'استعراض حجم المجتمع محل الدراسة وتوزيعه حسب المنفذ والمستوى ونمط الحركة تمهيدًا لتحليل النتائج والفجوات.',
  '◫', 'page-p1', '04', ['الجزء الأول', 'الجزء الثاني', 'الجزء الثالث'], 'غلاف الجزء الأول',
);

export const buildPart2Divider = buildPartDivider(
  'الجزء الثاني', 'نتائج الفحص',
  'تحليل نتائج المراجعة ونسب الدقة والفجوات على مستوى المنفذ والمستوى.',
  '⌕', 'page-p2', '08', ['الجزء الأول', 'الجزء الثاني', 'الجزء الثالث'], 'غلاف الجزء الثاني',
);

export const buildPart3Divider = buildPartDivider(
  'الجزء الثالث', 'التحاليل المتقدمة',
  'تحليلات متقدمة للكشف عن الأنماط الخفية في الأداء، وتحديد الفجوات التشغيلية وفرص التحسين.',
  '◈', 'page-p3', '12', ['الجزء الأول', 'الجزء الثاني', 'الجزء الثالث'], 'غلاف التحاليل المتقدمة',
);

// Alias stubs kept for index.ts compatibility
export const buildPart4Divider = buildPart3Divider;
export const buildPart5Divider = buildPart3Divider;
export const buildPart6Divider = buildPart3Divider;
```

**After:**
```ts
type TocChip = { n: string; t: string };

export function buildPartDivider(
  partLabel: string, title: string, subtitle: string, icon: string,
  pageId: string, pageNum: string, railTabs: string[], dataTitle: string,
  dividerNum: string, toc: TocChip[],
): (_ctx: ExecutiveRenderContext) => string {
  const tocHtml = toc.map(c =>
    `<div class="toc-chip"><span class="n">${esc(c.n)}</span><span class="t">${esc(c.t)}</span></div>`
  ).join("");
  return (_ctx) => `<section class="page" id="${pageId}" data-title="${esc(dataTitle)}">
  <div class="right-rail">
    <div class="rail-main">التقرير التنفيذي <em>لضمان جودة الأشعة</em></div>
    ${railTabs.map((t, i) => `<div class="rail-tab${i === 0 ? ' active' : ''}">${esc(t)}</div>`).join('')}
  </div>
  <div class="page-inner big-divider" style="--divider-num:'${esc(dividerNum)}'">
    <div class="divider-top">
      <span class="shield" aria-hidden="true"></span>
      <span>هيئة الزكاة والضريبة والجمارك — إدارة ضمان جودة الأشعة اللاحقة</span>
    </div>
    <div class="divider-center">
      <div class="icon">${icon}</div>
      <div class="kicker">${esc(partLabel)}</div>
      <h1>${esc(title)}</h1>
      <div class="rule"></div>
      <p class="lead">${esc(subtitle)}</p>
    </div>
    <div class="divider-toc">${tocHtml}</div>
    <div class="page-no">${esc(pageNum)}</div>
  </div>
</section>`;
}

export const buildPart1Divider = buildPartDivider(
  'الجزء الأول', 'مجتمع الحالات',
  'استعراض حجم المجتمع محل الدراسة وتوزيعه حسب المنفذ والمستوى ونمط الحركة تمهيدًا لتحليل النتائج والفجوات.',
  '◫', 'page-p1', '04', ['الجزء الأول', 'الجزء الثاني', 'الجزء الثالث'], 'غلاف الجزء الأول',
  '1', [
    { n: '05', t: 'مجتمع حالات المخاطر' },
    { n: '06', t: 'المجتمع حسب المستويات' },
    { n: '07', t: 'العينة حسب المستويات' },
  ],
);

export const buildPart2Divider = buildPartDivider(
  'الجزء الثاني', 'نتائج الفحص',
  'تحليل نتائج المراجعة ونسب الدقة والفجوات على مستوى المنفذ والمستوى.',
  '⌕', 'page-p2', '08', ['الجزء الأول', 'الجزء الثاني', 'الجزء الثالث'], 'غلاف الجزء الثاني',
  '2', [
    { n: '09', t: 'نتائج الدقة حسب المنفذ' },
    { n: '10', t: 'نتائج الدقة حسب المستويات' },
    { n: '11', t: 'نتائج جودة الصور' },
  ],
);

export const buildPart3Divider = buildPartDivider(
  'الجزء الثالث', 'التحاليل المتقدمة',
  'تحليلات متقدمة للكشف عن الأنماط الخفية في الأداء، وتحديد الفجوات التشغيلية وفرص التحسين.',
  '◈', 'page-p3', '13', ['الجزء الأول', 'الجزء الثاني', 'الجزء الثالث'], 'غلاف التحاليل المتقدمة',
  '3', [
    { n: '15', t: 'النظرة العامة لأداء الموظفين' },
    { n: '17', t: 'أداء الموظفين حسب المنفذ' },
    { n: '23', t: 'الأولوية والإجراءات' },
  ],
);

// Alias stubs kept for index.ts compatibility
export const buildPart4Divider = buildPart3Divider;
export const buildPart5Divider = buildPart3Divider;
export const buildPart6Divider = buildPart3Divider;
```

---

## v24.2 — 2026-06-29 — Replace الدورة with الفترة throughout report

**Files:** `src/data/reporting/executive/pages/sampleByLevel.ts`, `src/data/reporting/executive/pages/empPriority.ts`, `src/data/reporting/executive/pages/empStability.ts`, `src/data/reporting/executive/pages/empByDecision.ts`, `src/data/reporting/executive/pages/errorTypes.ts`, `src/data/reporting/executive/pages/empByPort.ts`, `src/data/reporting/executive/pages/suspectCategories.ts`, `src/data/reporting/executive/pages/empImageQuality.ts`

**Before:**
```ts
// Various occurrences of الدورة in no-data notices and info strings, e.g.:
'تم سحب كامل المجتمع في هذه الدورة، لذلك بلغت نسبة التغطية 100%.'
'لا توجد بيانات كافية لهذه الدورة'
'البيانات غير متاحة لهذه الدورة.'
'لا يوجد موظفون يتطلبون تدخلاً عاجلاً في هذه الدورة.'
'لا توجد بيانات أصناف أو آليات تهريب لهذه الدورة'
```

**After:**
```ts
// All instances replaced with الفترة:
'تم سحب كامل المجتمع في هذه الفترة، لذلك بلغت نسبة التغطية 100%.'
'لا توجد بيانات كافية لهذه الفترة'
'البيانات غير متاحة لهذه الفترة.'
'لا يوجد موظفون يتطلبون تدخلاً عاجلاً في هذه الفترة.'
'لا توجد بيانات أصناف أو آليات تهريب لهذه الفترة'
```

---

## v24.1 — 2026-06-29 — Review fix: broken bar CSS in levelAgreement page

**File:** `src/data/reporting/executive/pages/levelAgreement.ts`

**Before:**
```ts
<p style="margin-top:8px">المستوى الثاني</p><div class="bar"><i style="width:${Math.round(l2Pct)};background:var(--blue)%"></i></div>
```

**After:**
```ts
<p style="margin-top:8px">المستوى الثاني</p><div class="bar"><i style="width:${Math.round(l2Pct)}%;background:var(--blue)"></i></div>
```

The `%` unit was transposed to the end of the `background` value instead of the `width` value, causing the Level 2 accuracy bar to render with no width and an invalid CSS background.

---

## v24.0 — 2026-06-29 — UI design taste enhancement: polish CSS, cover art, anti-AI design

**File:** `src/data/reporting/executive/theme.ts`

**Before:** Generic card styling, uniform `.metric` sizes without text-shadow, plain `.section-title` with only font-size, generic chip borders, basic `.big-divider` centered grid, standard sidebar with padding-only layout, plain `.page-no` with gradient lines

**After:** Cards gain a 3px right-accent border (gold default, green for land, blue for sea, stage colors per level). Metrics get `letter-spacing:-0.02em` + colored `text-shadow` glow. Section titles gain `::after` underline accent (40px gold bar). Chips redesigned as inline-flex badges with semantic color fills and tinted borders. Big-divider pages use `flex-direction:column; align-items:flex-end` with radial glow `::before`, right-aligned `h1` with `letter-spacing:-0.02em`, explicit `.rule` (48px gold bar), and `.icon` with `align-self:flex-end`. Sidebar restructured with `display:flex;flex-direction:column` and flex-shrink guards. Page number refined to `font-size:0.72rem;font-weight:600;letter-spacing:0.12em` with 20px gold dashes. `.cover-bg-art` class added for decorative background ellipse. `.notice-centered` gets `::before` content `◌` symbol. Table rows: even-row tint + hover gold tint + total-row top border.

**File:** `src/data/reporting/executive/pages/cover.ts`

**Before:** Square diamond-pattern SVG ZATCA logo (rect + polygon), `دورة التقرير` label, badge said `تقرير داخلي` (already correct), no decorative background element

**After:** Shield-shaped ZATCA SVG logo with pentagon path, inner decoration ring, three horizontal gold stripes, and `زكاة` text at top of shield. `فترة التقرير` label confirmed. Added `<div class="cover-bg-art" aria-hidden="true">` decorative element before page-inner. `تقرير داخلي` badge confirmed correct.

**File:** `src/data/reporting/executive/pages/glossary.ts`

**Before:** Level cards using `class="card level-card stage1"` etc. — the colored bottom border was already applied via `.level-card::after` + `.stage*` CSS, but layout was flat/identical across cards

**After:** Cards retain `stage1`–`stage4` classes. The enhanced CSS now suppresses `card::before` on `level-card` (via `level-card::before{display:none}`) so the 3px right accent doesn't conflict with the bottom stage border. The bottom accent strip is reduced from 7px to 4px for a more refined look.

**File:** `src/data/reporting/executive/pages/partDivider.ts`

**Before:** `<div class="page-inner big-divider"><div>…icon/kicker/h1/rule/lead…</div><div class="page-no">…</div></div>` — nested div wrapper caused centering via `place-items:center` grid

**After:** Flat `big-divider` layout — icon, kicker, h1, rule, and lead are direct children of `.page-inner.big-divider`, page-no is also a direct child. The CSS flex column (`align-items:flex-end`) now positions all elements right-aligned matching the RTL document flow, with the radial glow `::before` as decorative background.

---

## v22.1 — 2026-06-29 — Wire L1/L2 employee IDs through population pipeline to ExecutiveReportRow

**File:** `src/data/population/populationTypes.ts`

**Change:** Add levelOneEmployee, levelTwoEmployee to PreparedPopulationRow

**Before:**
```ts
  biEnrichmentStatus: BiEnrichmentStatus;
```

**After:**
```ts
  levelOneEmployee: string | null;
  levelTwoEmployee: string | null;

  biEnrichmentStatus: BiEnrichmentStatus;
```

---

**File:** `src/components/Sidebar/Tabs/Population/processing/populationProcessor.ts`

**Change:** Initialize and populate levelOneEmployee/levelTwoEmployee from BI match

**Before:**
```ts
// PreparedDraftRow type — no levelOneEmployee/levelTwoEmployee fields
// toPreparedDraftRow — no initialization
// enrichedRow — no BI population
// preparedRows.push — no mapping
```

**After:**
```ts
// PreparedDraftRow: added levelOneEmployee/levelTwoEmployee fields
// toPreparedDraftRow: levelOneEmployee: null, levelTwoEmployee: null
// enrichedRow: levelOneEmployee: biMatch?.row?.levelOneEmployee ?? draftRow.levelOneEmployee ?? null
// preparedRows.push: levelOneEmployee: enrichment.row.levelOneEmployee
```

---

**File:** `src/data/reporting/executiveReportTypes.ts`

**Change:** Add levelOneEmployeeId, levelTwoEmployeeId to ExecutiveReportRow

**Before:**
```ts
  stage: string | null;
  levelOneResult: "سليمة" | "اشتباه";
```

**After:**
```ts
  stage: string | null;
  levelOneEmployeeId: string | null;
  levelTwoEmployeeId: string | null;
  levelOneResult: "سليمة" | "اشتباه";
```

---

**File:** `src/data/reporting/executiveReportData.ts`

**Change:** Map levelOneEmployee/levelTwoEmployee into buildExecutiveReportRows()

**Before:**
```ts
      stage: pop.stage,
      levelOneResult,
```

**After:**
```ts
      stage: pop.stage,
      levelOneEmployeeId: pop.levelOneEmployee ?? null,
      levelTwoEmployeeId: pop.levelTwoEmployee ?? null,
      levelOneResult,
```

---

## v23.0 — 2026-06-29 — Implementer: write all 23 page builders with live data

**File:** `src/data/reporting/executive/pages/*.ts` (all page files), `src/data/reporting/executive/index.ts`

**Before:** old xr-* landscape slide format; many pages were stubs returning notices; index.ts wired 20 pages in wrong order (missing image quality p11, categories p12, analytics map p14, cross-port p18, error types p21)

**After:** HTML mockup portrait pages (23 pages + appendix = 25 total sections) with live ctx/kpis data binding. Key changes:
- `populationByRisk.ts` — derives land/sea split from `ctx.rows portType`, real clean/suspicious totals, 8-row truncation
- `populationByLevel.ts` — builds stage×port breakdown from `ctx.rows`, real clean/suspicious counts per stage
- `accuracyByLevel.ts` — computes per-stage accuracy from `ctx.rows` (StageProfile has no accuracy field)
- `empImageQuality.ts` — now exports two functions: `buildEmpImageQuality` (page 11, global quality) and `buildEmpImageQualityImpact` (page 20, per-employee quality impact)
- `suspectCategories.ts` (NEW) — page 12, builds freq maps from `suspectedTypes`/`smuggleMethod` fields, heatmap cross-tab
- `analyticsMap.ts` (NEW) — page 14, static analytics roadmap
- `empByDecision.ts` — uses `ctx.kpis` globals for KPI cards, per-employee counts from `ctx.rows`
- `empByPort.ts` — now exports `buildEmpByPort` (page 17 drill-down) and `buildEmpCrossPort` (page 18 matrix with heatmap cells)
- `errorTypes.ts` (NEW) — page 21, per-employee verificationCategory breakdown
- `cover.ts` — ZATCA SVG logo, `فترة التقرير`, `تقرير داخلي` badge
- `glossary.ts` — CertScan → نظام صور الأشعة المركزية
- `sampleByLevel.ts` — CertScan label replaced
- `toc.ts` — page numbers updated to match 23-page order
- All page numbers corrected (emp pages: 15/16/17/18/19/20/21/22/23)
- `empPriority.ts` — riskScore thresholds fixed to 30/15/0 per spec
- `index.ts` — rewired to 25-section assembly in correct mockup order

**Build:** clean (2,080 kB bundle, 695 kB gzip). Tests: 180/180 passed.

---

## v22.0 — 2026-06-29 — Visual designer: adopt HTML mockup CSS + viewer shell

**File:** `src/data/reporting/executive/theme.ts`

**Before:** Portrait A4 CSS with `.xr-*` prefix, missing chart/overflow/utility rules, incomplete print CSS

**After:** Full HTML mockup v4 dark-navy CSS, fixed table overflow (`overflow:hidden;width:100%`), `table-layout:fixed`, `td,th` base overflow rules, `.chart-container`, `.bubble-chart`, `.grid-auto`, `.notice-centered` utilities; updated print CSS with `background:transparent`, `.right-rail{display:none}`, and `.page-inner` full-width print override

**File:** `src/data/reporting/executive/viewer.ts`

**Before:** VIEWER_JS using modern arrow functions, no setTimeout for fitPages

**After:** VIEWER_JS rewritten as IIFE using `function()` / `.slice.call()` for broadest compatibility; `fitPages` called via `setTimeout(fitPages,300)` in addition to load/resize events; sidebar structure preserved with single print button

**File:** `src/data/reporting/executive/assemble.ts`

**Before:** Already correct 2-arg `buildViewerHtml` form — no change needed

**After:** No change (already correct)

**File:** `docs/superpowers/specs/executive-report-page-skeletons.md` (new)

**Before:** Did not exist

**After:** Full page-skeleton reference for all 23 pages with `{{PLACEHOLDER}}` markers and data-source mapping table for the Implementer agent

---

## v22.1 — 2026-06-29 — Rewrite all executive report pages to HTML mockup v4 design classes

All page files migrated from `.xr-*` prefixed CSS classes to new HTML mockup v4 design system
(`.page`, `.right-rail`, `.rail-main`, `.rail-tab`, `.page-inner`, `.card`, `.metric`, `.chip`,
`.bar`, `.grid`, `.grid-2`, `.grid-4`, `.grid-5`, `.compact`, `.big-divider`, `.table-wrap`, etc.).
`index.ts` page order updated to Cover→TOC→Glossary→Part1→PopRisk→PopLevel→Sample→Part2→AccPort→AccLevel→Dist→Part3→EmpOverview→EmpByDecision→EmpByPort→EmpImageQuality→EmpStability→LevelAgreement→EmpPriority→Appendix (20 pages, removing `buildExecIntro` from page list, keeping only Part1/2/3 dividers).

**Files changed (before: `.xr-*` class HTML; after: new mockup v4 CSS class HTML):**

- `src/data/reporting/executive/index.ts` — new page order, removed Part4/5/6 dividers, re-exported buildExecIntro for backward compat
- `src/data/reporting/executive/pages/cover.ts` — new `.page.cover`, `.right-rail`, `.page-inner`, `.org`, `.title-block`, `.level-strip`, `.badges`
- `src/data/reporting/executive/pages/toc.ts` — new `.toc-page`, `.toc-header`, `.toc-grid`, `.appendix-card`
- `src/data/reporting/executive/pages/glossary.ts` — `.grid.grid-4`, `.card.level-card.stage1`–`.stage4`
- `src/data/reporting/executive/pages/partDivider.ts` — `buildPartDivider()` factory; Part1/2/3 exports; Part4/5/6 alias stubs removed
- `src/data/reporting/executive/pages/populationByRisk.ts` — heuristic `portName.includes('ميناء')` sea/land split (PortProfile has no portType); `.port-split`, `.card.land/sea`
- `src/data/reporting/executive/pages/populationByLevel.ts` — `.grid.grid-5`, `.grid.grid-2`, stage table cards
- `src/data/reporting/executive/pages/sampleByLevel.ts` — `.grid.grid-4`, `.info`, `.grid.grid-2`, stage cards
- `src/data/reporting/executive/pages/accuracyByPort.ts` — `.compact`, `.grid.grid-4`, `.table-wrap`; removed unused `chipHtml`
- `src/data/reporting/executive/pages/accuracyByLevel.ts` — fixed: removed `l1Tone/l2Tone` (unused); uses `kpis.levelOneAccuracy/levelTwoAccuracy` (StageProfile has no accuracy fields)
- `src/data/reporting/executive/pages/distributionOverview.ts` — new mockup classes
- `src/data/reporting/executive/pages/empOverview.ts` — 9-col employee table with `classifyEmp()` chip color helper
- `src/data/reporting/executive/pages/empByDecision.ts` — `.quad` matrix
- `src/data/reporting/executive/pages/empByPort.ts` — stub with `.card.info` notice
- `src/data/reporting/executive/pages/empImageQuality.ts` — live data from `buildEmployeeProfiles`, aggregated quality metrics
- `src/data/reporting/executive/pages/empStability.ts` — workload table replacing unreadable bubble chart
- `src/data/reporting/executive/pages/levelAgreement.ts` — new mockup classes
- `src/data/reporting/executive/pages/empPriority.ts` — riskScore-based counts, `.quad` matrix
- `src/data/reporting/executive/pages/appendix.ts` — new mockup classes; removed unused `esc` import
- `src/data/reporting/executive/pages/execIntro.ts` — new mockup classes (file kept; excluded from page list)
- `src/data/reporting/executiveReport.test.ts` — updated assertions to match new design tokens (`--navy:#062846`, `--gold:#f4b400`) and new page content strings

---

## v21.0 — 2026-06-29 — Redesign executive report to portrait A4 document format

**Files:** All files in `src/data/reporting/executive/` (theme.ts, viewer.ts, assemble.ts, all pages/)

**Before:** Landscape widescreen slides (13.333in × 7.5in) with right sidebar viewer

**After:** Portrait A4 document pages (8.27in × 11.69in) with fixed toolbar, scrollable document, org header on each page, vtab decorators on part dividers, dark teal table headers (#1a4040), px-unit font sizes

**File:** `src/data/reporting/executive/theme.ts`

**Before:**
```ts
// .xr-page{ width:13.333in;height:7.5in; ... }
// .xr-viewer{display:grid;grid-template-columns:minmax(0,1fr) 280px;}
// @media print{@page{size:13.333in 7.5in;margin:0;}}
```

**After:**
```ts
// .xr-page{ width:8.27in;min-height:11.69in; }
// .xr-document{display:flex;flex-direction:column;...}
// .xr-toolbar{position:fixed;...}
// @media print{@page{size:A4 portrait;margin:0;}}
```

---

**File:** `src/data/reporting/executive/viewer.ts`

**Before:**
```ts
export function buildViewerHtml(slides: string, sidebarLinks: string, monthLabel: string): string {
```

**After:**
```ts
export function buildViewerHtml(slides: string, monthLabel: string): string {
```

---

**File:** `src/data/reporting/executive/assemble.ts`

**Before:**
```ts
const NAV_SECTIONS = [...];
// ... builds sidebarLinks string ...
return buildViewerHtml(slides, sidebarLinks, ctx.monthLabel);
```

**After:**
```ts
// NAV_SECTIONS removed
return buildViewerHtml(slides, ctx.monthLabel);
```

---

**File:** `src/data/reporting/executive/pages/cover.ts` — portrait cover redesign (full rewrite of HTML template)

**File:** `src/data/reporting/executive/pages/toc.ts` — portrait layout, orgHeader, xr-page-num

**File:** `src/data/reporting/executive/pages/execIntro.ts` — portrait layout, orgHeader, xr-page-num

**File:** `src/data/reporting/executive/pages/glossary.ts` — 2×2 level card grid, glossary separator, orgHeader

**File:** `src/data/reporting/executive/pages/partDivider.ts` — vtabs redesign (xr-vtabs, xr-vtab, xr-divider-body)

**File:** `src/data/reporting/executive/pages/populationByRisk.ts` — orgHeader, xr-page-num, px font sizes

**File:** `src/data/reporting/executive/pages/populationByLevel.ts` — orgHeader, xr-page-num

**File:** `src/data/reporting/executive/pages/sampleByLevel.ts` — orgHeader, xr-page-num

**File:** `src/data/reporting/executive/pages/distributionOverview.ts` — orgHeader, xr-page-num

**File:** `src/data/reporting/executive/pages/accuracyByLevel.ts` — orgHeader, xr-page-num

**File:** `src/data/reporting/executive/pages/accuracyByPort.ts` — orgHeader, xr-page-num

**File:** `src/data/reporting/executive/pages/levelAgreement.ts` — orgHeader, xr-page-num

**File:** `src/data/reporting/executive/pages/empOverview.ts` — orgHeader, xr-page-num

**File:** `src/data/reporting/executive/pages/empByDecision.ts` — orgHeader, xr-page-num

**File:** `src/data/reporting/executive/pages/empByPort.ts` — orgHeader, xr-page-num

**File:** `src/data/reporting/executive/pages/empImageQuality.ts` — orgHeader, xr-page-num

**File:** `src/data/reporting/executive/pages/empStability.ts` — orgHeader, xr-page-num

**File:** `src/data/reporting/executive/pages/empPriority.ts` — orgHeader, xr-page-num

**File:** `src/data/reporting/executive/pages/appendix.ts` — orgHeader, xr-page-num

**File:** `src/data/reporting/executiveReport.test.ts` — update test assertions for new A4 portrait format

---

## v20.9 — 2026-06-29 — feat(executive-report): add employee analytics pages Phase 4 (Task 14)

**File:** `src/data/reporting/executive/pages/empOverview.ts`

**Before:** (file did not exist)

**After:**
```ts
// buildEmpOverview — employee overview page (page 24); builds profiles from ctx.rows,
// renders table + bar chart of top-5 employees by accuracy.
```

---

**File:** `src/data/reporting/executive/pages/empPriority.ts`

**Before:** (file did not exist)

**After:**
```ts
// buildEmpPriority — priority employees page (page 30); builds profiles + priority list
// from ctx.rows, renders 3-column card grid sorted by riskScore.
```

---

**File:** `src/data/reporting/executive/pages/empByDecision.ts`

**Before:** (file did not exist)

**After:**
```ts
// buildEmpByDecision — stub page (page 25) with "قريباً — تحليل الدقة حسب نوع القرار" notice.
```

---

**File:** `src/data/reporting/executive/pages/empByPort.ts`

**Before:** (file did not exist)

**After:**
```ts
// buildEmpByPort — stub page (page 26) with "قريباً — مقارنة الموظفين بين المنافذ" notice.
```

---

**File:** `src/data/reporting/executive/pages/empImageQuality.ts`

**Before:** (file did not exist)

**After:**
```ts
// buildEmpImageQuality — stub page (page 27) with "قريباً — أثر جودة الصورة على الدقة" notice.
```

---

**File:** `src/data/reporting/executive/pages/empStability.ts`

**Before:** (file did not exist)

**After:**
```ts
// buildEmpStability — stub page (page 28) with "قريباً — استقرار الأداء وعبء العمل" notice.
```

---

**File:** `src/data/reporting/executive/index.ts`

**Before:**
```ts
const ctx = buildContext(input, kpis, employeeDisplayNames);
// pages array had Phase 4 commented-out placeholders
```

**After:**
```ts
const ctx = buildContext(input, kpis, employeeDisplayNames, rows);
// pages array now includes all 6 employee pages in order after buildPart5Divider
```

---

**File:** `src/data/reporting/executive/pages/execIntro.ts`

**Before:**
```ts
kpiCard({ label: "إجمالي المجتمع", ... })
```

**After:**
```ts
kpiCard({ label: "إجمالي الصور", ... })
// Renamed KPI label to match test expectation and better describe total images
```

---

**File:** `src/data/reporting/executive/pages/sampleByLevel.ts`

**Before:**
```ts
<h2>العينة حسب المستويات والمنافذ</h2>
```

**After:**
```ts
<h2>مستويات الدراسة والعينة حسب المنافذ</h2>
// Updated heading to include "مستويات الدراسة" per test expectations
```

---

**File:** `src/data/reporting/executive/pages/accuracyByPort.ts`

**Before:**
```ts
kpiCard({ label: "الدقة الإجمالية", ... })
kpiCard({ label: "قوة اكتشاف الاشتباه", ... })
<h2>نتائج الدقة حسب المنفذ</h2>
```

**After:**
```ts
kpiCard({ label: "دقة نتائج الأشعة", ... })
kpiCard({ label: "نسبة دقة الاشتباه", ... })
<h2>نتائج الفحص والدقة حسب المنفذ</h2>
// Updated KPI labels and heading to match test expectations
```

---

**File:** `src/data/reporting/executive/theme.ts`

**Before:**
```css
/* ── Page footer ── */
```

**After:**
```css
/* ── Slide footer ── */
// Renamed CSS comment to remove English "Page " which violated test assertion
```

---

## v20.8 — 2026-06-29 — feat(executive-report): add employee analytics data module with tests (Task 13)

**File:** `src/data/reporting/executive/executiveEmployeeData.ts`

**Before:** (file did not exist)

**After:**
```ts
// buildEmployeeProfiles — groups submitted rows by evaluator, computes per-employee
// accuracy, detection rates, byPort/byDecision/byImageQuality/byMarking breakdowns,
// stabilityIndex, riskScore and recommendedAction. Returns profiles sorted by overallAccuracy desc.
// buildPriorityList — filters to reliable profiles, sorts by riskScore desc.
// (full 149-line implementation — see file)
```

**File:** `src/data/reporting/executive/executiveEmployeeData.test.ts`

**Before:** (file did not exist)

**After:**
```ts
// 5 Vitest tests covering: empty array for non-submitted rows, overallAccuracy calculation,
// reliability threshold (below and at), and buildPriorityList riskScore ordering.
```

---

## v20.7 — 2026-06-29 — feat(executive-report): add accuracy-by-level and level-agreement pages (Phase 3)

**File:** `src/data/reporting/executive/pages/accuracyByLevel.ts`

**Before:** (file did not exist)

**After:**
```ts
import type { ExecutiveRenderContext } from "../context";
import { kpiCard, radarSvg, fmtPct, esc } from "../primitives";

export function buildAccuracyByLevel(ctx: ExecutiveRenderContext): string {
  const { kpis } = ctx;

  const kpisRow = [
    kpiCard({ label: "دقة المستوى الأول", value: fmtPct(kpis.levelOneAccuracy), tone: kpis.levelOneAccuracy !== null && kpis.levelOneAccuracy >= ctx.input.config.accuracyTarget ? "good" : "risk" }),
    kpiCard({ label: "دقة المستوى الثاني", value: fmtPct(kpis.levelTwoAccuracy), tone: kpis.levelTwoAccuracy !== null && kpis.levelTwoAccuracy >= ctx.input.config.accuracyTarget ? "good" : "risk" }),
    kpiCard({ label: "معدل التصحيح م.ثاني", value: fmtPct(kpis.levelTwoCorrectionRate) }),
    kpiCard({ label: "معدل التراجع م.ثاني", value: fmtPct(kpis.levelTwoRegressionRate), tone: "warn" }),
  ].join("");

  const radarPoints = [
    { label: "دقة م.أول", value: kpis.levelOneAccuracy ?? 0 },
    { label: "دقة م.ثاني", value: kpis.levelTwoAccuracy ?? 0 },
    { label: "اكتشاف الاشتباه", value: kpis.suspiciousDetectionRate ?? 0 },
    { label: "تأكيد السلامة", value: kpis.cleanConfirmationRate ?? 0 },
    { label: "الدقة الإجمالية", value: kpis.overallAccuracy ?? 0 },
    { label: "الجودة المتوازنة", value: kpis.balancedQualityScore ?? 0 },
  ];

  return `<section class="xr-page" id="page-acc-level">
    <div class="xr-page-inner">
      <div class="xr-slide-head"><h2>نتائج الدقة حسب المستويات الأربعة</h2><span class="xr-pg">21</span></div>
      <div class="xr-kpi-grid xr-kpi-grid-4" style="margin-bottom:0.13in">${kpisRow}</div>
      <div class="xr-cols xr-cols-2">
        <div class="xr-panel" style="height:3.4in">${radarSvg(radarPoints)}</div>
        <div>
          <div class="xr-panel-title">مؤشرات الدقة التفصيلية</div>
          <table class="xr-table"><tbody>
            <tr><td>اشتباه مكتشف</td><td>${kpis.correctSuspicious}</td></tr>
            <tr><td>سليمة مؤكدة</td><td>${kpis.correctClean}</td></tr>
            <tr><td>اشتباه فائت</td><td style="color:var(--xr-coral)">${kpis.missedSuspicious}</td></tr>
            <tr><td>اشتباه زائد</td><td style="color:var(--xr-gold)">${kpis.excessSuspicious}</td></tr>
            <tr><td>صور بتحقق صالح</td><td>${kpis.validStudied}</td></tr>
          </tbody></table>
        </div>
      </div>
      <div class="xr-footer"><span>التقرير التنفيذي — ${esc(ctx.monthLabel)}</span><span>21</span></div>
    </div>
  </section>`;
}
```

**File:** `src/data/reporting/executive/pages/levelAgreement.ts`

**Before:** (file did not exist)

**After:**
```ts
import type { ExecutiveRenderContext } from "../context";
import { kpiCard, barRow, fmtPct, esc } from "../primitives";

export function buildLevelAgreement(ctx: ExecutiveRenderContext): string {
  const { kpis } = ctx;

  const bars = [
    barRow({ label: "دقة المستوى الأول", value: kpis.levelOneAccuracy, max: 100, tone: "good" }),
    barRow({ label: "دقة المستوى الثاني", value: kpis.levelTwoAccuracy, max: 100, tone: "blue" }),
    barRow({ label: "معدل الاختلاف م.أول/ثاني", value: kpis.levelDisagreementRate, max: 100, tone: "risk" }),
    barRow({ label: "معدل تصحيح م.ثاني", value: kpis.levelTwoCorrectionRate, max: 100 }),
    barRow({ label: "معدل تراجع م.ثاني", value: kpis.levelTwoRegressionRate, max: 100, tone: "risk" }),
  ].join("");

  return `<section class="xr-page" id="page-level-agree">
    <div class="xr-page-inner">
      <div class="xr-slide-head"><h2>مقارنة المستوى الأول والثاني وتوافق الموظفين</h2><span class="xr-pg">22</span></div>
      <div class="xr-cols xr-cols-2">
        <div class="xr-panel">
          <div class="xr-panel-title">مقارنة المستويين</div>
          <div class="xr-bars" style="margin-top:0.1in">${bars}</div>
        </div>
        <div class="xr-panel">
          <div class="xr-panel-title">توافق أزواج الموظفين</div>
          <div class="xr-notice" style="margin-top:0.1in">هذا الجزء يتطلب وجود حالات راجعها موظفان مختلفان — لم تُرصد حالات كهذه في هذا الشهر.</div>
        </div>
      </div>
      <div class="xr-footer"><span>التقرير التنفيذي — ${esc(ctx.monthLabel)}</span><span>22</span></div>
    </div>
  </section>`;
}
```

**File:** `src/data/reporting/executive/index.ts`

**Before:**
```ts
import { buildPopulationByLevel } from "./pages/populationByLevel";
import { buildSampleByLevel } from "./pages/sampleByLevel";
import { buildDistributionOverview } from "./pages/distributionOverview";
import { buildAccuracyByPort } from "./pages/accuracyByPort";
import { buildAppendix } from "./pages/appendix";
```

**After:**
```ts
import { buildPopulationByLevel } from "./pages/populationByLevel";
import { buildSampleByLevel } from "./pages/sampleByLevel";
import { buildDistributionOverview } from "./pages/distributionOverview";
import { buildAccuracyByPort } from "./pages/accuracyByPort";
import { buildAccuracyByLevel } from "./pages/accuracyByLevel";
import { buildLevelAgreement } from "./pages/levelAgreement";
import { buildAppendix } from "./pages/appendix";
```

**And in the pages array:**

**Before:**
```ts
    buildDistributionOverview,
    buildPart4Divider,
    buildAccuracyByPort,
    // accuracyByLevel — Phase 3
    // levelAgreement — Phase 3
    buildPart5Divider,
```

**After:**
```ts
    buildDistributionOverview,
    buildPart4Divider,
    buildAccuracyByPort,
    buildAccuracyByLevel,
    buildLevelAgreement,
    buildPart5Divider,
```

---

## v20.6 — 2026-06-29 — feat(executive-report): add accuracy by port page (Phase 3)

**File:** `src/data/reporting/executive/pages/accuracyByPort.ts`

**Before:** (file did not exist)

**After:**
```ts
import type { ExecutiveRenderContext } from "../context";
import { dataTable, barRow, badgeHtml, kpiCard, fmtNum, fmtPct, esc } from "../primitives";

export function buildAccuracyByPort(ctx: ExecutiveRenderContext): string {
  const { kpis } = ctx;
  const reliable = kpis.portProfiles.filter(p => p.accuracy !== null);

  const kpisRow = [
    kpiCard({ label: "الدقة الإجمالية", value: fmtPct(kpis.overallAccuracy), tone: kpis.overallAccuracy !== null && kpis.overallAccuracy >= ctx.input.config.accuracyTarget ? "good" : "risk" }),
    kpiCard({ label: "قوة اكتشاف الاشتباه", value: fmtPct(kpis.suspiciousDetectionRate), tone: "good" }),
    kpiCard({ label: "اشتباه فائت", value: fmtPct(kpis.missedSuspicionRate), tone: kpis.missedSuspicionRate !== null && kpis.missedSuspicionRate <= ctx.input.config.maximumMissedSuspicionRate ? "good" : "risk" }),
    kpiCard({ label: "المنافذ ذات بيانات موثوقة", value: String(reliable.length) + " / " + String(kpis.portProfiles.length) }),
  ].join("");

  const tableRows = kpis.portProfiles.map(p => [
    esc(p.portName),
    fmtNum(p.studied),
    p.accuracy !== null ? fmtPct(p.accuracy) : null,
    p.suspiciousDetectionRate !== null ? fmtPct(p.suspiciousDetectionRate) : null,
    p.missedSuspicionRate !== null ? fmtPct(p.missedSuspicionRate) : null,
    badgeHtml(p.status),
  ]);

  const bars = reliable.map(p =>
    barRow({ label: p.portName, value: p.accuracy, max: 100, tone: p.accuracy !== null && p.accuracy >= ctx.input.config.accuracyTarget ? "good" : "risk" })
  ).join("");

  return `<section class="xr-page" id="page-acc-port">
    <div class="xr-page-inner">
      <div class="xr-slide-head"><h2>نتائج الدقة حسب المنفذ</h2><span class="xr-pg">20</span></div>
      <div class="xr-kpi-grid xr-kpi-grid-4" style="margin-bottom:0.13in">${kpisRow}</div>
      <div class="xr-cols xr-cols-6-4">
        <div>${dataTable({ headers: ["المنفذ","مدروسة","دقة%","اكتشاف اشتباه%","اشتباه فائت%","التصنيف"], rows: tableRows })}</div>
        <div class="xr-panel">
          <div class="xr-panel-title">الدقة حسب المنفذ</div>
          <div class="xr-bars">${bars || '<div class="xr-notice">بيانات غير كافية</div>'}</div>
        </div>
      </div>
      <div class="xr-footer"><span>التقرير التنفيذي — ${esc(ctx.monthLabel)}</span><span>20</span></div>
    </div>
  </section>`;
}
```

**File:** `src/data/reporting/executive/index.ts`

**Before:**
```ts
import { buildDistributionOverview } from "./pages/distributionOverview";
import { buildAppendix } from "./pages/appendix";
```

**After:**
```ts
import { buildDistributionOverview } from "./pages/distributionOverview";
import { buildAccuracyByPort } from "./pages/accuracyByPort";
import { buildAppendix } from "./pages/appendix";
```

**And in the pages array:**

**Before:**
```ts
    buildDistributionOverview,
    buildPart4Divider,
    // accuracyByPort — Phase 3
    // accuracyByLevel — Phase 3
```

**After:**
```ts
    buildDistributionOverview,
    buildPart4Divider,
    buildAccuracyByPort,
    // accuracyByLevel — Phase 3
```

---

## v20.5 — 2026-06-29 — feat(executive-report): add distribution overview page (Phase 2)

**File:** `src/data/reporting/executive/pages/distributionOverview.ts`

**Before:** (file did not exist)

**After:**
```ts
import type { ExecutiveRenderContext } from "../context";
import { dataTable, kpiCard, fmtNum, fmtPct, esc } from "../primitives";

export function buildDistributionOverview(ctx: ExecutiveRenderContext): string {
  const dist = ctx.input.distribution;
  if (!dist || dist.entries.length === 0) {
    return `<section class="xr-page" id="page-dist">
      <div class="xr-page-inner">
        <div class="xr-slide-head"><h2>التوزيع والتكليف</h2><span class="xr-pg">16</span></div>
        <div class="xr-notice">لم يتم التوزيع بعد لهذا الشهر.</div>
        <div class="xr-footer"><span>التقرير التنفيذي — ${esc(ctx.monthLabel)}</span><span>16</span></div>
      </div>
    </section>`;
  }

  const byEmployee = new Map<string, { assigned: number; completed: number; pending: number }>();
  for (const e of dist.entries) {
    const emp = e.assignedTo ?? "غير محدد";
    const rec = byEmployee.get(emp) ?? { assigned: 0, completed: 0, pending: 0 };
    rec.assigned++;
    if (e.status === "completed") rec.completed++;
    else rec.pending++;
    byEmployee.set(emp, rec);
  }

  const totalAssigned = dist.entries.length;
  const totalCompleted = dist.entries.filter(e => e.status === "completed").length;
  const totalPending = totalAssigned - totalCompleted;

  const kpisRow = [
    kpiCard({ label: "إجمالي المكلَّف به", value: fmtNum(totalAssigned), tone: "accent" }),
    kpiCard({ label: "مكتملة", value: fmtNum(totalCompleted), tone: "good" }),
    kpiCard({ label: "متبقية", value: fmtNum(totalPending), tone: totalPending > 0 ? "warn" : "" }),
    kpiCard({ label: "نسبة الإنجاز", value: fmtPct(totalAssigned > 0 ? (totalCompleted / totalAssigned) * 100 : null) }),
  ].join("");

  const rows = [...byEmployee.entries()].map(([emp, r]) => [
    esc(ctx.displayName(emp)),
    fmtNum(r.assigned),
    fmtNum(r.completed),
    fmtNum(r.pending),
    fmtPct(r.assigned > 0 ? (r.completed / r.assigned) * 100 : null),
  ]);

  return `<section class="xr-page" id="page-dist">
    <div class="xr-page-inner">
      <div class="xr-slide-head"><h2>التوزيع والتكليف</h2><span class="xr-pg">16</span></div>
      <div class="xr-kpi-grid xr-kpi-grid-4" style="margin-bottom:0.13in">${kpisRow}</div>
      <div class="xr-panel-title">أعباء العمل حسب الموظف</div>
      ${dataTable({ headers: ["الموظف","المكلَّف به","مكتمل","متبقٍ","نسبة الإنجاز"], rows })}
      <div class="xr-footer"><span>التقرير التنفيذي — ${esc(ctx.monthLabel)}</span><span>16</span></div>
    </div>
  </section>`;
}
```

**File:** `src/data/reporting/executive/index.ts`

**Before:**
```ts
import { buildCover } from "./pages/cover";
import { buildToc } from "./pages/toc";
import { buildExecIntro } from "./pages/execIntro";
import { buildGlossary } from "./pages/glossary";
import {
  buildPart1Divider, buildPart2Divider, buildPart3Divider,
  buildPart4Divider, buildPart5Divider, buildPart6Divider,
} from "./pages/partDivider";
import { buildPopulationByRisk } from "./pages/populationByRisk";
import { buildPopulationByLevel } from "./pages/populationByLevel";
import { buildSampleByLevel } from "./pages/sampleByLevel";
import { buildAppendix } from "./pages/appendix";
```

**After:**
```ts
import { buildCover } from "./pages/cover";
import { buildToc } from "./pages/toc";
import { buildExecIntro } from "./pages/execIntro";
import { buildGlossary } from "./pages/glossary";
import {
  buildPart1Divider, buildPart2Divider, buildPart3Divider,
  buildPart4Divider, buildPart5Divider, buildPart6Divider,
} from "./pages/partDivider";
import { buildPopulationByRisk } from "./pages/populationByRisk";
import { buildPopulationByLevel } from "./pages/populationByLevel";
import { buildSampleByLevel } from "./pages/sampleByLevel";
import { buildDistributionOverview } from "./pages/distributionOverview";
import { buildAppendix } from "./pages/appendix";
```

**Before (pages array):**
```ts
  const pages = [
    buildCover,
    buildToc,
    buildExecIntro,
    buildGlossary,
    buildPart1Divider,
    buildPopulationByRisk,
    buildPopulationByLevel,
    buildPart2Divider,
    buildSampleByLevel,
    buildPart3Divider,
    // distributionOverview — Phase 2
    buildPart4Divider,
```

**After (pages array):**
```ts
  const pages = [
    buildCover,
    buildToc,
    buildExecIntro,
    buildGlossary,
    buildPart1Divider,
    buildPopulationByRisk,
    buildPopulationByLevel,
    buildPart2Divider,
    buildSampleByLevel,
    buildPart3Divider,
    buildDistributionOverview,
    buildPart4Divider,
```

---

## v20.4 — 2026-06-29 — feat(executive-report): add population-by-level and sample-by-level pages (Phase 2)

**File:** `src/data/reporting/executive/pages/populationByLevel.ts`

**Before:** (file did not exist)

**After:**
```ts
import type { ExecutiveRenderContext } from "../context";
import { dataTable, fmtNum, fmtPct, esc } from "../primitives";

export function buildPopulationByLevel(ctx: ExecutiveRenderContext): string {
  const { kpis } = ctx;
  const rows = kpis.stageProfiles.map(s => [
    esc(s.stageLabel),
    fmtNum(s.population),
    fmtNum(s.sampleSize),
    fmtPct(s.coverage),
    fmtNum(s.studied),
    fmtPct(s.completionRate),
  ]);
  const table = dataTable({
    headers: ["المستوى", "المجتمع", "العينة", "التغطية", "مدروسة", "الإنجاز"],
    rows,
    totalRow: ["الإجمالي", fmtNum(kpis.totalPopulation), fmtNum(kpis.totalSample), fmtPct(kpis.sampleCoverage), fmtNum(kpis.studiedImages), fmtPct(kpis.completionRate)],
  });

  const portRows = kpis.portProfiles.map(p => [
    esc(p.portName),
    fmtNum(p.population),
    fmtNum(p.sampleSize),
    fmtPct(p.coverage),
    fmtNum(p.studied),
    fmtPct(p.completionRate),
  ]);
  const portTable = dataTable({
    headers: ["المنفذ", "المجتمع", "العينة", "التغطية", "مدروسة", "الإنجاز"],
    rows: portRows,
  });

  return `<section class="xr-page" id="page-pop-level">
    <div class="xr-page-inner">
      <div class="xr-slide-head"><h2>مجتمع الحالات حسب المستويات والمنافذ</h2><span class="xr-pg">09</span></div>
      <div class="xr-cols xr-cols-2">
        <div>
          <div class="xr-panel-title">توزيع المستويات</div>
          ${table}
        </div>
        <div>
          <div class="xr-panel-title">توزيع المنافذ</div>
          ${portTable}
        </div>
      </div>
      <div class="xr-footer"><span>التقرير التنفيذي — ${esc(ctx.monthLabel)}</span><span>09</span></div>
    </div>
  </section>`;
}
```

**File:** `src/data/reporting/executive/pages/sampleByLevel.ts`

**Before:** (file did not exist)

**After:**
```ts
import type { ExecutiveRenderContext } from "../context";
import { dataTable, kpiCard, fmtNum, fmtPct, esc } from "../primitives";

export function buildSampleByLevel(ctx: ExecutiveRenderContext): string {
  const { kpis, input } = ctx;
  const s = input.sample;

  const kpis4 = [
    kpiCard({ label: "حجم العينة الكلي", value: fmtNum(kpis.totalSample), tone: "accent" }),
    kpiCard({ label: "CertScan", value: s ? fmtNum(s.certScanActual) : "—" }),
    kpiCard({ label: "نسبة التغطية", value: fmtPct(kpis.sampleCoverage), tone: "good" }),
    kpiCard({ label: "المجتمع الكلي", value: fmtNum(kpis.totalPopulation) }),
  ].join("");

  const stageRows = kpis.stageProfiles.map(sp => [
    esc(sp.stageLabel),
    fmtNum(sp.population),
    fmtNum(sp.sampleSize),
    fmtPct(sp.coverage),
    fmtNum(sp.studied),
  ]);

  const portRows = kpis.portProfiles.map(p => [
    esc(p.portName),
    fmtNum(p.population),
    fmtNum(p.sampleSize),
    fmtPct(p.coverage),
    fmtNum(p.studied),
    fmtPct(p.completionRate),
  ]);

  return `<section class="xr-page" id="page-sample">
    <div class="xr-page-inner">
      <div class="xr-slide-head"><h2>العينة حسب المستويات والمنافذ</h2><span class="xr-pg">12</span></div>
      <div class="xr-kpi-grid xr-kpi-grid-4" style="margin-bottom:0.13in">${kpis4}</div>
      <div class="xr-cols xr-cols-2">
        <div>
          <div class="xr-panel-title">العينة حسب المستوى</div>
          ${dataTable({ headers: ["المستوى","المجتمع","العينة","التغطية","مدروسة"], rows: stageRows })}
        </div>
        <div>
          <div class="xr-panel-title">العينة حسب المنفذ</div>
          ${dataTable({ headers: ["المنفذ","المجتمع","العينة","التغطية","مدروسة","الإنجاز"], rows: portRows })}
        </div>
      </div>
      <div class="xr-footer"><span>التقرير التنفيذي — ${esc(ctx.monthLabel)}</span><span>12</span></div>
    </div>
  </section>`;
}
```

**File:** `src/data/reporting/executive/index.ts`

**Before:**
```ts
import { buildPopulationByRisk } from "./pages/populationByRisk";
import { buildAppendix } from "./pages/appendix";

export function buildExecutiveReport(
  input: ExecutiveReportInput,
  employeeDisplayNames: Record<string, string> = {},
): string {
  const rows = buildExecutiveReportRows(input);
  const kpis = calculateExecutiveKPIs(rows, input.sample, input.config);
  const ctx = buildContext(input, kpis, employeeDisplayNames);

  const pages = [
    buildCover,
    buildToc,
    buildExecIntro,
    buildGlossary,
    buildPart1Divider,
    buildPopulationByRisk,
    // populationByLevel — Phase 2
    buildPart2Divider,
    // sampleByLevel — Phase 2
    buildPart3Divider,
```

**After:**
```ts
import { buildPopulationByRisk } from "./pages/populationByRisk";
import { buildPopulationByLevel } from "./pages/populationByLevel";
import { buildSampleByLevel } from "./pages/sampleByLevel";
import { buildAppendix } from "./pages/appendix";

export function buildExecutiveReport(
  input: ExecutiveReportInput,
  employeeDisplayNames: Record<string, string> = {},
): string {
  const rows = buildExecutiveReportRows(input);
  const kpis = calculateExecutiveKPIs(rows, input.sample, input.config);
  const ctx = buildContext(input, kpis, employeeDisplayNames);

  const pages = [
    buildCover,
    buildToc,
    buildExecIntro,
    buildGlossary,
    buildPart1Divider,
    buildPopulationByRisk,
    buildPopulationByLevel,
    buildPart2Divider,
    buildSampleByLevel,
    buildPart3Divider,
```

---

## v20.3 — 2026-06-29 — feat(executive-report): add executive intro KPI dashboard page (Phase 2)

**File:** `src/data/reporting/executive/pages/execIntro.ts`

**Before:** (file did not exist)

**After:**
```ts
import type { ExecutiveRenderContext } from "../context";
import { kpiCard, fmtNum, fmtPct, esc } from "../primitives";

export function buildExecIntro(ctx: ExecutiveRenderContext): string {
  const { kpis } = ctx;
  const cards = [
    kpiCard({ label: "إجمالي المجتمع", value: fmtNum(kpis.totalPopulation), tone: "accent" }),
    kpiCard({ label: "حجم العينة", value: fmtNum(kpis.totalSample) }),
    kpiCard({ label: "نسبة التغطية", value: fmtPct(kpis.sampleCoverage), tone: kpis.sampleCoverage !== null && kpis.sampleCoverage >= ctx.input.config.coverageTarget ? "good" : "warn" }),
    kpiCard({ label: "الحالات المدروسة", value: fmtNum(kpis.studiedImages) }),
    kpiCard({ label: "نسبة الإنجاز", value: fmtPct(kpis.completionRate), tone: kpis.completionRate !== null && kpis.completionRate >= ctx.input.config.completionTarget ? "good" : "warn" }),
    kpiCard({ label: "الدقة الإجمالية", value: fmtPct(kpis.overallAccuracy), tone: kpis.overallAccuracy === null ? "" : kpis.overallAccuracy >= ctx.input.config.accuracyTarget ? "good" : "risk" }),
  ].join("");

  const sectionStatus = [
    { label: "مجتمع الحالات", ok: kpis.totalPopulation > 0 },
    { label: "العينة", ok: kpis.totalSample > 0 },
    { label: "التوزيع", ok: kpis.studiedImages > 0 },
    { label: "نتائج الدقة", ok: kpis.overallAccuracy !== null },
    { label: "أداء الموظفين", ok: kpis.validStudied > 0 },
  ].map(s => `<div class="xr-kpi" style="text-align:center">
    <div style="font-size:0.22in">${s.ok ? "✅" : "⬜"}</div>
    <div class="xr-kpi-label">${esc(s.label)}</div>
  </div>`).join("");

  return `<section class="xr-page" id="page-intro">
    <div class="xr-page-inner">
      <div class="xr-slide-head"><h2>مقدمة تنفيذية</h2><span class="xr-pg">03</span></div>
      <div style="margin-bottom:0.07in;font-size:0.085in;color:var(--xr-muted);font-weight:600">
        ملخص أداء شهر ${esc(ctx.monthLabel)} — بتاريخ ${esc(ctx.issueDate)}
      </div>
      <div class="xr-kpi-grid xr-kpi-grid-6" style="margin-bottom:0.16in">${cards}</div>
      <div class="xr-section-title">حالة الأقسام</div>
      <div class="xr-kpi-grid" style="grid-template-columns:repeat(5,1fr)">${sectionStatus}</div>
      ${kpis.overallAccuracy !== null && kpis.overallAccuracy < ctx.input.config.accuracyTarget
        ? `<div class="xr-notice" style="margin-top:0.12in">⚠️ الدقة الإجمالية (${fmtPct(kpis.overallAccuracy)}) أقل من الهدف المعتمد (${fmtPct(ctx.input.config.accuracyTarget)}). راجع الجزء الرابع والخامس لتفاصيل الفجوات.</div>`
        : ""}
      <div class="xr-footer"><span>التقرير التنفيذي — ${esc(ctx.monthLabel)}</span><span>03</span></div>
    </div>
  </section>`;
}
```

**File:** `src/data/reporting/executive/index.ts`

**Before:**
```ts
// Phase 1 pages
import { buildCover } from "./pages/cover";
import { buildToc } from "./pages/toc";
import { buildGlossary } from "./pages/glossary";
import {
  buildPart1Divider, buildPart2Divider, buildPart3Divider,
  buildPart4Divider, buildPart5Divider, buildPart6Divider,
} from "./pages/partDivider";
import { buildPopulationByRisk } from "./pages/populationByRisk";
import { buildAppendix } from "./pages/appendix";

// ...
  const pages = [
    buildCover,
    buildToc,
    // execIntro — Phase 2
    buildGlossary,
```

**After:**
```ts
// Phase 1 pages
import { buildCover } from "./pages/cover";
import { buildToc } from "./pages/toc";
import { buildExecIntro } from "./pages/execIntro";
import { buildGlossary } from "./pages/glossary";
import {
  buildPart1Divider, buildPart2Divider, buildPart3Divider,
  buildPart4Divider, buildPart5Divider, buildPart6Divider,
} from "./pages/partDivider";
import { buildPopulationByRisk } from "./pages/populationByRisk";
import { buildAppendix } from "./pages/appendix";

// ...
  const pages = [
    buildCover,
    buildToc,
    buildExecIntro,
    buildGlossary,
```

---

## v20.2 — 2026-06-29 — feat(executive-report): wire new dark-navy viewer as the active report (Phase 1)

**File:** `src/data/reporting/executive/index.ts`

**Before:** (file did not exist)

**After:**
```ts
import { buildExecutiveReportRows, calculateExecutiveKPIs } from "../executiveReportData";
import { buildContext } from "./context";
import { assembleReport } from "./assemble";
import { openOrDownload } from "../htmlReport";
import type { ExecutiveReportInput } from "../executiveReportTypes";

// Phase 1 pages
import { buildCover } from "./pages/cover";
import { buildToc } from "./pages/toc";
import { buildGlossary } from "./pages/glossary";
import {
  buildPart1Divider, buildPart2Divider, buildPart3Divider,
  buildPart4Divider, buildPart5Divider, buildPart6Divider,
} from "./pages/partDivider";
import { buildPopulationByRisk } from "./pages/populationByRisk";
import { buildAppendix } from "./pages/appendix";

export function buildExecutiveReport(
  input: ExecutiveReportInput,
  employeeDisplayNames: Record<string, string> = {},
): string { ... }

export function openExecutiveReport(
  input: ExecutiveReportInput,
  employeeDisplayNames: Record<string, string> = {},
): void { ... }
```

**File:** `src/data/reporting/executiveReport.ts`

**Before:**
```ts
import { openOrDownload } from "./htmlReport";
import { ORGANIZATION_PATH_TEXT } from "../../branding/organization";
import type { ExecutiveKPIs, ExecutiveReportInput } from "./executiveReportTypes";
import {
  buildExecutiveReportRows,
  calculateExecutiveKPIs,
  fmtNum,
  fmtPct,
} from "./executiveReportData";

// ... ~560 lines of helper functions, type definitions, CSS constant ...

// ─── Main builder ─────────────────────────────────────────────────────────────
export function buildExecutiveReport(input: ExecutiveReportInput): string {
  const execRows = buildExecutiveReportRows(input);
  const kpis = calculateExecutiveKPIs(execRows, input.sample, input.config);
  return buildPrintableExecutiveReport(input, kpis, groupForReport(execRows));
}

export function openExecutiveReport(input: ExecutiveReportInput): void {
  openOrDownload(buildExecutiveReport(input), `التقرير_التنفيذي_${input.monthFolderName}.html`);
}
```

**After:**
```ts
import * as XLSX from "xlsx";
import type { ExecutiveReportInput } from "./executiveReportTypes";
import {
  buildExecutiveReportRows,
  calculateExecutiveKPIs,
} from "./executiveReportData";

// ─── Main builder (re-exported from the new dark-navy viewer module) ──────────
export { buildExecutiveReport, openExecutiveReport } from "./executive/index";

export function buildExecutiveXlsx(input: ExecutiveReportInput): void { ... }
```

---

## v20.1 — 2026-06-29 — feat(executive-report): add viewer shell and assembler

**File:** `src/data/reporting/executive/viewer.ts`

**Before:** (file did not exist)

**After:**
```ts
import { EXEC_CSS } from "./theme";
import { esc } from "./primitives";

export function buildViewerHtml(slides: string, sidebarLinks: string, monthLabel: string): string {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>التقرير التنفيذي — ${esc(monthLabel)}</title>
<style>${EXEC_CSS}</style>
</head>
<body>
<div class="xr-viewer">
  <main class="xr-slides">${slides}</main>
  <nav class="xr-sidebar">
    <div class="xr-brand">
      <strong>التقرير التنفيذي</strong>
      <span>ضمان جودة الأشعة</span>
    </div>
    <button class="xr-pdf-btn" onclick="window.print()">تصدير PDF</button>
    <div class="xr-nav-title">الأقسام</div>
    <div class="xr-nav">${sidebarLinks}</div>
  </nav>
</div>
</body>
</html>`;
}
```

---

**File:** `src/data/reporting/executive/assemble.ts`

**Before:** (file did not exist)

**After:**
```ts
import type { ExecutiveRenderContext } from "./context";
import { buildViewerHtml } from "./viewer";
import { esc } from "./primitives";

const NAV_SECTIONS = [
  { label: "الغلاف", id: "page-cover" },
  { label: "الفهرس", id: "page-toc" },
  { label: "مقدمة تنفيذية", id: "page-intro" },
  { label: "المعجم", id: "page-glossary" },
  { label: "الجزء الأول: المجتمع", id: "page-p1" },
  { label: "الجزء الثاني: العينة", id: "page-p2" },
  { label: "الجزء الثالث: التوزيع", id: "page-p3" },
  { label: "الجزء الرابع: الدقة", id: "page-p4" },
  { label: "الجزء الخامس: الفجوات", id: "page-p5" },
  { label: "الجزء السادس: التوصيات", id: "page-p6" },
  { label: "الملاحق", id: "page-appendix" },
];

export function assembleReport(
  ctx: ExecutiveRenderContext,
  pageBuilders: Array<(ctx: ExecutiveRenderContext) => string>,
): string {
  const slides = pageBuilders.map(fn => fn(ctx)).join("\n");
  const sidebarLinks = NAV_SECTIONS.map(s =>
    `<a href="#${s.id}">${esc(s.label)}</a>`
  ).join("");
  return buildViewerHtml(slides, sidebarLinks, ctx.monthLabel);
}
```

---

## v20.0 — 2026-06-29 — feat(executive-report): add population-by-risk and appendix pages

**File:** `src/data/reporting/executive/pages/populationByRisk.ts`

**Before:** (file did not exist)

**After:** New file — exports `buildPopulationByRisk(ctx: ExecutiveRenderContext): string`. Renders page (`#page-pop-risk`, display page 08) with 4 KPI cards (إجمالي المجتمع/accent, الحالات السليمة/good, حالات الاشتباه/risk, نسبة الاشتباه) in `.xr-kpi-grid-4`. Two-column layout (`.xr-cols-6-4`): left=port table with headers [المنفذ, المجتمع, سليمة, اشتباه, نسبة الاشتباه] and total row, right=panel with bar chart showing `suspicionRate` as % per port. Footer with month label.

---

**File:** `src/data/reporting/executive/pages/appendix.ts`

**Before:** (file did not exist)

**After:** New file — exports `buildAppendix(ctx: ExecutiveRenderContext): string`. Renders page (`#page-appendix`, display page 31) with two-column layout (`.xr-cols-2`): left=config thresholds table from `ctx.input.config` (accuracyTarget, completionTarget, coverageTarget, maximumMissedSuspicionRate, minimumReliableSampleSize, monthlyTarget), right=static methodology paragraph in Arabic describing Hamilton stratified sampling and expert evaluation process.

---

## v19.9 — 2026-06-29 — feat(executive-report): add cover, toc, glossary, part-divider page builders

**File:** `src/data/reporting/executive/pages/cover.ts`

**Before:** (file did not exist)

**After:** New file — exports `buildCover(ctx: ExecutiveRenderContext): string`. Renders the cover page (`#page-cover`) with org name from `ORGANIZATION_PATH_TEXT`, a 4-level chip legend (المستوى الأول–الرابع with CSS variable dot colors `--xr-l1` through `--xr-l4`), report title, issue date, and month label from context.

---

**File:** `src/data/reporting/executive/pages/toc.ts`

**Before:** (file did not exist)

**After:** New file — exports `buildToc(_ctx: ExecutiveRenderContext): string`. Renders the table of contents page (`#page-toc`) with 9 hard-coded entries (01 مقدمة تنفيذية … 09 الملاحق) as anchor links into the report sections.

---

**File:** `src/data/reporting/executive/pages/glossary.ts`

**Before:** (file did not exist)

**After:** New file — exports `buildGlossary(_ctx: ExecutiveRenderContext): string`. Renders the glossary page (`#page-glossary`) with 4 level-definition cards (`.xr-l1-card`–`.xr-l4-card`) and an 8-term glossary grid.

---

**File:** `src/data/reporting/executive/pages/partDivider.ts`

**Before:** (file did not exist)

**After:** New file — exports `buildPartDivider(partNum, title, sub, icon, pageId, pageNum)` factory and 6 pre-built named constants: `buildPart1Divider` through `buildPart6Divider`. Each constant is `(ctx: ExecutiveRenderContext) => string` and renders a full-page divider slide for its part (page IDs `page-p1`–`page-p6`, display page numbers 07/11/15/19/23/29).

---

## v19.8 — 2026-06-29 — feat(executive-report): add render context

**File:** `src/data/reporting/executive/context.ts`

**Before:** (file did not exist)

**After:** New file — shared render context factory for all executive report page builders. Exports: `ExecutiveRenderContext` type (input, kpis, monthLabel, issueDate, displayName function, anonymizeMap, rows) and `buildContext(input, kpis, employeeDisplayNames, rows)` factory. Month folder name `{digit}-{EnglishName}-{year}` converted to Arabic month name (e.g. `5-May-2026` → `مايو 2026`). Issue date formatted as `DD / MM / YYYY`. displayName() handles anonymization: when `config.showEmployeeNames === false`, assigns sequential codes (موظف ١, موظف ٢, etc.) lazily; otherwise uses employeeDisplayNames or username. rows parameter (ExecutiveReportRow[]) defaults to [] for Phase 4 analytics.

---

## v19.7 — 2026-06-29 — fix(executive-report): add missing statPill helper to primitives

**File:** `src/data/reporting/executive/primitives.ts`

**Before:**
```ts
export function heatCell(pct: number | null): string {
  if (pct === null) return `<span class="xr-heat-cell xr-heat-insuff">—</span>`;
  const cls = pct >= 90 ? "xr-heat-high" : pct >= 75 ? "xr-heat-mid" : "xr-heat-low";
  return `<span class="xr-heat-cell ${cls}">${fmtPct(pct)}</span>`;
}
// (statPill missing)
```

**After:**
```ts
export function heatCell(pct: number | null): string {
  if (pct === null) return `<span class="xr-heat-cell xr-heat-insuff">—</span>`;
  const cls = pct >= 90 ? "xr-heat-high" : pct >= 75 ? "xr-heat-mid" : "xr-heat-low";
  return `<span class="xr-heat-cell ${cls}">${fmtPct(pct)}</span>`;
}

export function statPill({ label, value }: { label: string; value: string }): string {
  return `<div class="xr-stat-pill"><span class="xr-stat-pill-label">${esc(label)}</span><b class="xr-stat-pill-value">${esc(value)}</b></div>`;
}
```

---

## v19.6 — 2026-06-29 — executive report rework: create primitives.ts

**File:** `src/data/reporting/executive/primitives.ts`

**Before:** (file did not exist)

**After:** New file — pure HTML render helper functions for building executive report page content. Exports: `esc()`, `fmtNum()`, `fmtPct()`, `kpiCard()`, `barRow()`, `badgeHtml()`, `heatCell()`, `dataTable()`, `noticeBox()`, `pagePanel()`, `radarSvg()`. All functions return HTML strings with `.xr-` prefixed CSS classes; no React imports or side effects.

---

## v19.5 — 2026-06-29 — executive report rework: create theme.ts

**File:** `src/data/reporting/executive/theme.ts`

**Before:** (file did not exist)

**After:** New file — EXEC_CSS string with dark-navy tokens, Somar @font-face (BASE_URL pattern), viewer layout, slide pages, all shared CSS classes.

---

## v19.4 — 2026-06-29 — Add "combobox" field type: free-text input with preset autocomplete suggestions; add موقع الاشتباه field to default template phase 2

**File:** `src/data/templates/templateTypes.ts`

**Before:**
```ts
export type TemplateFieldType =
  | "text"
  | "textarea"
  | "number"
  | "dropdown"
  | "checkbox"
  | "date"
  | "empty";
```

**After:**
```ts
export type TemplateFieldType =
  | "text"
  | "textarea"
  | "number"
  | "dropdown"
  | "combobox"
  | "checkbox"
  | "date"
  | "empty";
```

**File:** `src/components/Sidebar/Tabs/TemplateBuilder/index.tsx`

**Before:** `FIELD_TYPE_LABELS` had no `combobox` entry; `buildDefaultInspectionTemplate` phase 2 had no موقع الاشتباه field; `FieldEditor` showed options only for `dropdown`.

**After:** Added `combobox: "نص مع اقتراحات"` label; added `fSuspicionLocation` combobox field in phase 2 with presets for transport vehicle locations; options section renders for both `dropdown` and `combobox`.

**File:** `src/components/InspectionPanel/index.tsx`

**Before:** Field renderer had no combobox branch.

**After:** combobox renders as `<input type="text">` with a `<datalist>` of preset suggestions, allowing free text plus typeahead.

---

## v19.3 — 2026-06-29 — Power BI export: use page-level month selector instead of duplicate dropdown

**File:** `src/components/Sidebar/Tabs/Reports/index.tsx`

**Before:** Power BI export section had its own `pbiMonth` state and a separate `<select>` dropdown starting empty. User had to pick the month a second time.

**After:** Removed `pbiMonth` / `setPbiMonth` state. `handlePbiExport` now uses `selectedMonth` (same value as the top month bar). The separate dropdown is removed; a read-only pill shows the current month. Replace `📊` emoji with lucide `BarChart2` icon.

---

## v19.2 — 2026-06-29 — KPI breakdown, distinctCount unique values, deselect on empty click

**File:** `src/data/reportDesigner/reportTypes.ts`

**Before:**
```ts
export type KpiConfig = {
  kind: "kpi";
  dataSourceId: string;
  valueField: string;
  agg: Aggregation;
  target?: number;
  comparison?: "higherBetter" | "lowerBetter";
  format?: string;
};
```

**After:** Added `groupByField` + `groupByLabel` for Power BI-style breakdown:
```ts
export type KpiConfig = {
  kind: "kpi";
  dataSourceId: string;
  valueField: string;
  agg: Aggregation;
  groupByField?: string;
  groupByLabel?: string;
  target?: number;
  comparison?: "higherBetter" | "lowerBetter";
  format?: string;
};
```

---

**File:** `src/components/Sidebar/Tabs/ReportDesigner/renderers/KpiRenderer.tsx`

**Before:** Always shows numeric aggregation result or "—".

**After:**
- `distinctCount` with ≤ 8 unique values: shows the actual values as pills instead of a number. Booleans translated to "نعم"/"لا".
- When `groupByField` is set: shows grouped breakdown (count per unique value of the group-by dimension), sorted descending.
- Otherwise: numeric aggregation as before.

---

**File:** `src/components/Sidebar/Tabs/ReportDesigner/editor/Canvas.tsx`

**Before:** `onClick` on outer canvas used `if (e.target === e.currentTarget)` guard — inner div background clicks didn't deselect.

**After:** Removed the guard. Elements still stopPropagation so only background clicks reach canvas onClick → `onSelect(null)`.

---

**File:** `src/components/Sidebar/Tabs/ReportDesigner/index.tsx`

**Before:** Field drop always creates a new element (after showing aggregation dialog).

**After:** If a dimension field is dropped onto an existing KPI element, sets that KPI's `groupByField` directly (no new element). Otherwise shows aggregation dialog as before.

---

## v19.1 — 2026-06-29 — KPI live data binding + export path copy button

**File:** `src/components/Sidebar/Tabs/ReportDesigner/renderers/KpiRenderer.tsx`

**Before:** Showed "—" placeholder for all KPI cards.

**After:** `useKpiValue` hook loads the most recent month's `population.final.json` via `listMonthFolders` + `loadMonthPopulationFinal`, then computes `count/distinctCount/sum/avg/min/max` on `config.valueField`. Displays result with `toLocaleString("ar-SA")`.

---

**File:** `src/components/Sidebar/Tabs/Reports/index.tsx`

**Before:** Export success showed only `5-System/powerbi-export/{month}/` as text.

**After:** Shows full workspace-relative path `{directoryHandle.name}\5-System\...` in a copyable code box with a "نسخ" button using Clipboard API.

---

**File:** `src/components/Sidebar/Tabs/Reports/Reports.css`

**Before:** `.rh-pbi-success` was `font-size: 13px`. No path box styles.

**After:** Added `.rh-pbi-path-box`, `.rh-pbi-path-row`, `.rh-pbi-path-code`, `.rh-pbi-copy-btn`, `.rh-pbi-path-hint` styles.

---

## v19.0 — 2026-06-29 — Smooth drag/resize + thumbnail card list + tab nesting

### Smooth drag/resize (useCanvasInteractions + Canvas)

**File:** `editor/useCanvasInteractions.ts`

**Before:** `onPointerMove` did nothing (voided dx/dy). Elements only moved/resized on pointerup → janky.

**After:** Live DOM manipulation during drag:
- Move: `el.style.transform = translate(${dx}px, ${dy}px)`
- Resize: directly sets `el.style.left/top/width/height`
- pointerup clears overrides; React re-render applies snapped rect

Added `canvasRef` returned from hook and attached to canvas outer div; `data-rd-id` on each element wrapper for querySelector lookup.

---

### Thumbnail card list (ReportDesigner list view + CSS)

**File:** `index.tsx` (ReportDesigner)

**Before:** `<ul className="rd-list">` with text-only rows.

**After:** `<ul className="rd-cards">` card grid; each card:
- Shows first-page Canvas preview at `zoom = 240 / pageWidth` (loaded eagerly in background via `loadedDocs` state)
- Clicking thumbnail or "فتح" opens the editor

---

### Move مصمم التقارير under إدارة التقارير

**Files:** Reports/index.tsx, ReportDesigner/index.tsx, Sidebar.tsx, userManagement.ts

**Before:** `report-designer` was a separate top-level tab (order 27).

**After:**
- `Sidebar.tsx`: dispatches `sidebar-subtab-changed` generic event in addition to legacy `pop-set-subtab`
- `Reports/index.tsx`: adds "مصمم التقارير" sub-tab; `ReportsTab` wrapper listens for `sidebar-subtab-changed` and renders `<ReportDesignerTab />` when active
- `ReportDesigner/index.tsx`: `tabConfig` removed; component is now embedded via Reports
- `userManagement.ts`: `report-designer` entry gets `parentId: "reports"` for permission UI grouping
- Deleted `tabConfig.test.ts`

---

## v18.6 — 2026-06-29 — Replace Ribbon emojis with lucide-react icons

**File:** `src/.../editor/Ribbon.tsx`

**Before:**
```tsx
<span className="rd-ribbon-btn-icon">←</span>   // back
<span className="rd-ribbon-btn-icon">📋</span>  // fields toggle
<span className="rd-ribbon-btn-icon">🎨</span>  // format toggle
<span className="rd-ribbon-btn-icon">💾</span>  // save
<span className="rd-ribbon-btn-icon">🖨️</span> // print
```
**After:** `ArrowLeft / Columns / Paintbrush / Save / Printer` from lucide-react, `strokeWidth={1.8}`, `size={18}`

**File:** `ReportDesigner.css` — `.rd-ribbon-btn-icon` changed from `font-size:18px` to flex centering for SVG

---

## v18.5 — 2026-06-29 — Field drop → KPI card + centered drop positions

**File:** `src/.../renderers/KpiRenderer.tsx` (new) — KPI card: field name (top), "—" placeholder (center), agg badge (bottom)

**File:** `src/.../editor/Canvas.tsx` — import + render KpiRenderer for kind="kpi" elements

**File:** `src/.../index.tsx`
- `addFieldElement(label, fieldName, role, x, y, agg)`: agg="none" → styled text label; agg≠"none" → KPI element. Both centered on drop point via `x - w/2`.
- `addElement(type, x, y)`: now centers on drop point too.
- viz-type onDrop: passes `cx - 100, cy - 30` to center 200×60 elements.
- FieldDropDialog onConfirm: passes `fieldDrop.fieldName` and `fieldDrop.role`.

---

## v18.4 — 2026-06-29 — VizPanel drag-and-drop + icon strokeWidth fix

**File:** `src/components/Sidebar/Tabs/ReportDesigner/editor/VizPanel.tsx`

**Before:**
```tsx
icon: <Type size={22} />   // no strokeWidth, no draggable
```
**After:**
```tsx
icon: <Type size={22} strokeWidth={1.8} />
// non-disabled non-image buttons get draggable + onDragStart
// sets dataTransfer "application/x-rd-viz-type" = key
```

---

**File:** `src/components/Sidebar/Tabs/ReportDesigner/editor/FieldsPanel.tsx`

**Before:**
```tsx
<Tag size={12} className="rd-field-icon" />
```
**After:**
```tsx
<Tag size={12} strokeWidth={1.8} className="rd-field-icon" />
```

---

**File:** `src/components/Sidebar/Tabs/ReportDesigner/index.tsx`

**Before:**
```ts
function addElement(type: "text" | "shape") { ... x: 50, y: 50 ... }
// onDrop: only handles application/x-rd-field
```
**After:**
```ts
function addElement(type: "text" | "shape", x = 50, y = 50) { ... }
// onDrop: checks application/x-rd-viz-type first → addElement(type, cx, cy)
//         then application/x-rd-field → FieldDropDialog
```

---

**File:** `src/components/Sidebar/Tabs/ReportDesigner/ReportDesigner.css`

Added `line-height: 0` to `.rd-viz-icon-btn .rd-viz-icon` so SVG icons are not pushed by font spacing.

---

## v18.3 — 2026-06-29 — Field drop aggregation dialog

**File:** `src/components/Sidebar/Tabs/ReportDesigner/editor/FieldDropDialog.tsx` (new)

Popover that appears at the cursor when a field is dropped onto the canvas.
Shows field name, category badge (بُعد / مقياس), and aggregation radio buttons.
Dimensions: بدون تجميع / عدد / عدد مميز. Measures: مجموع / متوسط / عدد / أدنى / أقصى / نسبة.

---

**File:** `src/components/Sidebar/Tabs/ReportDesigner/index.tsx`

**Before:**
```ts
// onDrop: directly calls addFieldElement(label, x, y)
// addFieldElement(label, x, y): text = `[${label}]`
```

**After:**
```ts
// onDrop: sets fieldDrop state (label, field, role, canvasX/Y, screenX/Y)
// addFieldElement(label, x, y, agg): text = `[label]` or `[label] • aggLabel`
// renders <FieldDropDialog> when fieldDrop != null
```

---

## v18.2 — 2026-06-29 — Replace emojis in FieldsPanel and VizPanel with lucide-react icons

**File:** `src/components/Sidebar/Tabs/ReportDesigner/editor/FieldsPanel.tsx`

**Before:**
```tsx
<span className="rd-field-icon">📐</span>  // dimensions
<span className="rd-field-icon">🔢</span>  // measures
```

**After:**
```tsx
<Tag size={12} className="rd-field-icon" />   // dimensions
<Hash size={12} className="rd-field-icon" />  // measures
```

---

**File:** `src/components/Sidebar/Tabs/ReportDesigner/editor/VizPanel.tsx`

**Before:**
```ts
const VIZ_TYPES = [
  { label: "نص", icon: "T", ... },
  { label: "شكل", icon: "◻", ... },
  { label: "صورة", icon: "🖼️", ... },
  { label: "جدول", icon: "⊞", ... },
  { label: "مخطط", icon: "📊", ... },
  { label: "KPI", icon: "🔷", ... },
  { label: "خط", icon: "―", ... },
  { label: "قسم", icon: "⬚", ... },
];
```

**After:** uses `React.ReactNode` icons from lucide-react (`Type`, `Square`, `ImageIcon`, `Table2`, `BarChart2`, `TrendingUp`, `Minus`, `LayoutTemplate`)

---

## v18.1 — 2026-06-29 — Fix shape default visibility + fields panel drag-and-drop

**File:** `src/components/Sidebar/Tabs/ReportDesigner/index.tsx`

**Before:**
```ts
// addElement: shape style
style: {},
// No canvasAreaRef, no addFieldElement, no drag handlers on canvas-area div
```

**After:**
```ts
// addElement: shape gets visible defaults
style: type === "shape" ? { fill: "#dce6f1", borderWidth: 1, borderColor: "#0078d4" } : {},
// + canvasAreaRef, addFieldElement(), onDragOver/onDrop on .rd-canvas-area
```

---

**File:** `src/components/Sidebar/Tabs/ReportDesigner/editor/FieldsPanel.tsx`

**Before:**
```tsx
<div key={f.field} className="rd-field-item" title={f.field}>
```

**After:**
```tsx
<div
  key={f.field}
  className="rd-field-item"
  title={f.field}
  draggable
  onDragStart={(e) => {
    e.dataTransfer.effectAllowed = "copy";
    e.dataTransfer.setData("application/x-rd-field", JSON.stringify({ field: f.field, label: f.label, role: f.role }));
  }}
>
```

---

**File:** `src/components/Sidebar/Tabs/ReportDesigner/renderers/ShapeRenderer.tsx`

**Before:**
```ts
border: s.borderWidth != null && s.borderWidth > 0
  ? `${s.borderWidth}px solid ${s.borderColor ?? "transparent"}`
  : undefined,
```

**After:**
```ts
border: s.borderWidth != null && s.borderWidth > 0
  ? `${s.borderWidth}px solid ${s.borderColor ?? "#d0d7de"}`
  : undefined,
```

---

**File:** `src/components/Sidebar/Tabs/ReportDesigner/ReportDesigner.css`

**Before:**
```css
.rd-field-item {
  ...
  cursor: default;
  ...
}
```

**After:**
```css
.rd-field-item {
  ...
  cursor: grab;
  ...
}
```

---

## v18.0 — 2026-06-28 — Fix stale closure in deletePage, type-safe export rows, unified page-size labels, remove dead CSS

**File:** `src/components/Sidebar/Tabs/ReportDesigner/index.tsx`

**Before:**
```ts
function handleDeletePage(index: number) {
  setDoc((d) => {
    if (d.pages.length <= 1) return d;
    const pages = d.pages.filter((_, i) => i !== index);
    return { ...d, pages };
  });
  setCurrentPageIndex((ci) => Math.min(ci, doc.pages.length - 2));  // stale closure
}
```

**After:**
```ts
function handleDeletePage(index: number) {
  setDoc((d) => {
    if (d.pages.length <= 1) return d;
    const pages = d.pages.filter((_, i) => i !== index);
    setCurrentPageIndex((ci) => Math.min(ci, pages.length - 1));
    return { ...d, pages };
  });
}
```

**File:** `src/data/powerbiExport/exportManager.ts`

**Before:**
```ts
const sampleRows = (sample?.rows ?? []) as unknown as PreparedPopulationRow[];
// ...
populationRows: (populationData?.rows ?? []) as unknown as PreparedPopulationRow[],
// ...
const allRows = execRows as unknown as Record<string, unknown>[];
```

**After:**
```ts
const sampleRows = sample?.rows ?? [];
// ...
populationRows: (populationData?.rows ?? []) as PreparedPopulationRow[],
// ...
const allRows: Record<string, unknown>[] = execRows.map((r) => r as Record<string, unknown>);
```

**File:** `src/data/reportDesigner/reportTypes.ts`

**Before:**
```ts
// PAGE_SIZE_LABELS did not exist; labels were duplicated locally in Ribbon.tsx and index.tsx with inconsistent values
```

**After:**
```ts
export const PAGE_SIZE_LABELS: Record<PageSizePreset, string> = {
  "A4": "A4 طولي",
  "Letter": "Letter طولي",
  "16:9": "شاشة عريضة 16:9",
  "4:3": "قياسي 4:3",
  "16:9-fhd": "Full HD 16:9",
  "custom": "مخصص",
};
```

**File:** `src/components/Sidebar/Tabs/ReportDesigner/editor/Ribbon.tsx`

**Before:**
```ts
const PAGE_SIZE_LABELS: Record<PageSizePreset, string> = {
  "A4": "A4 طولي",
  // ... local duplicate
};
```

**After:**
```ts
import { PAGE_SIZE_LABELS } from "../../../../../data/reportDesigner/reportTypes";
// local constant removed; uses shared export
```

**File:** `src/components/Sidebar/Tabs/ReportDesigner/ReportDesigner.css`

**Before:**
```css
.rd-editor-body { display: flex; flex: 1; gap: 12px; min-height: 0; overflow: hidden; }
.rd-inspector-panel { width: 240px; flex-shrink: 0; overflow-y: auto; ... }
```

**After:**
```css
/* Both dead blocks removed — .rd-editor-body and .rd-inspector-panel are not rendered in any JSX */
```

---

## v17.0 — 2026-06-28 — Export manager + Power BI section in Reports tab

**File:** `src/data/powerbiExport/exportManager.ts`

**Before:**
```ts
// File did not exist
```

**After:**
```ts
// Loads population, sample, distribution, employee files for a month,
// builds ExecutiveReportRow array via buildExecutiveReportRows, then
// writes population.csv + sample.csv via writeCsvExport.
export async function runPowerBiExport(root, month): Promise<ExportManifest>
```

**File:** `src/components/Sidebar/Tabs/Reports/index.tsx`

**Before:**
```tsx
// No pbiMonth/pbiExporting/pbiResult/pbiError state, no handlePbiExport handler,
// no Power BI export section in JSX, no exportManager/exportTypes imports.
```

**After:**
```tsx
// Added: runPowerBiExport import, ExportManifest import, pbi* state variables,
// handlePbiExport async handler, and Power BI export section JSX at bottom of
// the "reports" sub-tab (after quick actions strip).
```

**File:** `src/components/Sidebar/Tabs/Reports/Reports.css`

**Before:**
```css
/* No .rh-pbi-* or .rh-section-divider classes */
```

**After:**
```css
/* Added: .rh-pbi-section, .rh-section-divider, .rh-pbi-title, .rh-pbi-desc,
   .rh-pbi-row, .rh-pbi-select, .rh-pbi-result, .rh-pbi-success,
   .rh-pbi-file-list, .rh-pbi-error */
```

**File:** `docs/data-system-report.md`

**Before:**
```
| `backup.manifest.json` and copied data files | `5-System/3-Backups/{timestamp}/` | ... |
```

**After:**
```
| `backup.manifest.json` ...  |
| `population.csv` | `5-System/powerbi-export/{month}/` | All ExecutiveReportRow records |
| `sample.csv`     | `5-System/powerbi-export/{month}/` | selectedInSample=true subset    |
| `LISEZMOI.txt`   | `5-System/powerbi-export/{month}/` | Bilingual connection instructions |
```

---

## v16.0 — 2026-06-28 — Export writer (workspace file I/O) for Power BI export

**File:** `src/data/powerbiExport/exportWriter.ts`

**Before:**
```ts
// File did not exist
```

**After:**
```ts
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { getSystemRoot } from "../workspace/workspacePaths";
import { toCsvString } from "./csvSerializer";
import type { ExportManifest, ExportFileResult } from "./exportTypes";

async function getExportDir(root: DirectoryHandleLike, month: string): Promise<DirectoryHandleLike> {
  const sys = await getSystemRoot(root, true);
  const expRoot = await sys.getDirectoryHandle("powerbi-export", { create: true });
  return expRoot.getDirectoryHandle(month, { create: true });
}

async function writeTextFile(dir: DirectoryHandleLike, fileName: string, content: string): Promise<void> {
  const fh = await dir.getFileHandle(fileName, { create: true });
  if (!fh.createWritable) throw new Error("createWritable not supported in this environment");
  const writable = await fh.createWritable();
  await writable.write(content);
  await writable.close();
}

export async function writeCsvExport(
  root: DirectoryHandleLike,
  month: string,
  exports: Array<{ fileName: string; headers: string[]; rows: Record<string, unknown>[] }>
): Promise<ExportManifest> {
  const dir = await getExportDir(root, month);
  const files: ExportFileResult[] = [];

  for (const exp of exports) {
    const csv = toCsvString(exp.headers, exp.rows);
    await writeTextFile(dir, exp.fileName, csv);
    files.push({ fileName: exp.fileName, rowCount: exp.rows.length });
  }

  const instructions = [
    "Power BI Data Export",
    "====================",
    "",
    "Arabic:",
    "لاستيراد هذه الملفات في Power BI Desktop:",
    "1. افتح Power BI Desktop",
    "2. الصفحة الرئيسية > الحصول على البيانات > نص/CSV",
    `3. انتقل إلى مجلد '5-System/powerbi-export/${month}/'`,
    "4. افتح كل ملف CSV واضغط 'تحميل'",
    "5. في نموذج البيانات، يمكنك إنشاء علاقات بين الجداول باستخدام عمود xrayImageId",
    "",
    "English:",
    "To import these files into Power BI Desktop:",
    "1. Open Power BI Desktop",
    "2. Home > Get Data > Text/CSV",
    `3. Browse to '5-System/powerbi-export/${month}/'`,
    "4. Open each CSV file and click 'Load'",
    "5. In the Data Model, create relationships between tables using the xrayImageId column",
    "",
    "Files in this export:",
    ...files.map((f) => `  - ${f.fileName} (${f.rowCount} rows)`),
    "",
    `Exported at: ${new Date().toISOString()}`,
  ].join("\n");

  await writeTextFile(dir, "LISEZMOI.txt", instructions);

  return {
    month,
    exportedAt: new Date().toISOString(),
    files,
  };
}
```

**File:** `src/data/powerbiExport/exportWriter.test.ts`

**Before:**
```ts
// File did not exist
```

**After:**
```ts
import { describe, it, expect } from "vitest";
import { createMemoryDirectory } from "../storage/memoryDirectory";
import { writeCsvExport } from "./exportWriter";

describe("writeCsvExport", () => {
  it("writes CSV files and returns manifest", async () => {
    const root = createMemoryDirectory("root");
    const manifest = await writeCsvExport(root, "5-May-2026", [
      { fileName: "population.csv", headers: ["id", "port"], rows: [{ id: "X1", port: "ميناء A" }] },
    ]);
    expect(manifest.month).toBe("5-May-2026");
    expect(manifest.files).toHaveLength(1);
    expect(manifest.files[0].fileName).toBe("population.csv");
    expect(manifest.files[0].rowCount).toBe(1);
  });

  it("creates nested export directory and writes file", async () => {
    const root = createMemoryDirectory("root");
    await writeCsvExport(root, "5-May-2026", [
      { fileName: "sample.csv", headers: ["id"], rows: [{ id: "A" }, { id: "B" }] },
    ]);
    // navigate into 5-System/powerbi-export/5-May-2026/
    const sys = await root.getDirectoryHandle("5-System", { create: false });
    const exp = await sys.getDirectoryHandle("powerbi-export", { create: false });
    const month = await exp.getDirectoryHandle("5-May-2026", { create: false });
    const fh = await month.getFileHandle("sample.csv", { create: false });
    expect(fh).toBeTruthy();
  });
});
```

---

## v15.0 — 2026-06-28 — CSV serializer + export types for Power BI export

**File:** `src/data/powerbiExport/exportTypes.ts`

**Before:**
```ts
// File did not exist
```

**After:**
```ts
export type ExportFileResult = {
  fileName: string;
  rowCount: number;
};

export type ExportManifest = {
  month: string;
  exportedAt: string;
  files: ExportFileResult[];
};
```

**File:** `src/data/powerbiExport/csvSerializer.ts`

**Before:**
```ts
// File did not exist
```

**After:**
```ts
function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "1" : "0";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function toCsvString(
  headers: string[],
  rows: Record<string, unknown>[]
): string {
  const lines: string[] = [];
  lines.push(headers.join(","));
  for (const row of rows) {
    lines.push(headers.map((h) => escapeCell(row[h])).join(","));
  }
  return "﻿" + lines.join("\n");
}
```

**File:** `src/data/powerbiExport/csvSerializer.test.ts`

**Before:**
```ts
// File did not exist
```

**After:**
```ts
import { describe, it, expect } from "vitest";
import { toCsvString } from "./csvSerializer";

describe("toCsvString", () => {
  it("produces UTF-8 BOM header + comma-separated header row", () => {
    const result = toCsvString(["a", "b"], []);
    expect(result.startsWith("﻿")).toBe(true);
    expect(result).toContain("a,b");
  });

  it("serializes a simple row", () => {
    const result = toCsvString(["name", "count"], [{ name: "ميناء A", count: 42 }]);
    expect(result).toContain("ميناء A,42");
  });

  it("wraps values containing commas in double quotes", () => {
    const result = toCsvString(["v"], [{ v: "hello, world" }]);
    expect(result).toContain('"hello, world"');
  });

  it("escapes double quotes by doubling them", () => {
    const result = toCsvString(["v"], [{ v: 'say "hi"' }]);
    expect(result).toContain('"say ""hi"""');
  });

  it("converts null to empty string", () => {
    const result = toCsvString(["v"], [{ v: null }]);
    const lines = result.split("\n");
    expect(lines[1].trim()).toBe(",".repeat(0)); // single empty column
  });

  it("converts boolean to 1/0", () => {
    const result = toCsvString(["a", "b"], [{ a: true, b: false }]);
    expect(result).toContain("1,0");
  });

  it("handles missing key as empty", () => {
    const result = toCsvString(["a", "b"], [{ a: "x" }]);
    // b is undefined → empty
    expect(result).toContain("x,");
  });
});
```

---

## v14.1 — 2026-06-28 — Fix unused-var lint error in ReportDesigner EditorHost

**File:** `src/components/Sidebar/Tabs/ReportDesigner/index.tsx`

**Before:**
```tsx
const [_saveError, setSaveError] = useState<string | null>(null);
```

**After:**
```tsx
const [, setSaveError] = useState<string | null>(null);
```

---

## v14.0 — 2026-06-28 — Create-dialog size selector + pageSizeLabel helper

**File:** `src/components/Sidebar/Tabs/ReportDesigner/index.tsx`

**Before:**
```tsx
// No pageSizeLabel helper function
// Select element in create form had hardcoded Arabic labels:
<select
  className="rd-new-select"
  value={newPreset}
  onChange={(e) => setNewPreset(e.target.value as PageSizePreset)}
  disabled={creating}
>
  <option value="A4">A4 عمودي</option>
  <option value="Letter">Letter عمودي</option>
  <option value="16:9">16:9 شرائح</option>
  <option value="4:3">4:3 شرائح</option>
  <option value="16:9-fhd">16:9 FHD</option>
</select>
```

**After:**
```tsx
// Added pageSizeLabel(p: PageSizePreset): string helper function
function pageSizeLabel(p: PageSizePreset): string {
  const labels: Record<PageSizePreset, string> = {
    "A4": "A4 عمودي",
    "Letter": "Letter عمودي",
    "16:9": "16:9 شرائح",
    "4:3": "4:3 شرائح",
    "16:9-fhd": "16:9 FHD",
    "custom": "مخصص",
  };
  return labels[p] ?? p;
}

// Updated select element to use pageSizeLabel, added dir/title/aria-label
<select
  className="rd-new-select"
  value={newPreset}
  onChange={(e) => setNewPreset(e.target.value as PageSizePreset)}
  disabled={creating}
  dir="rtl"
  title="حجم الصفحة"
  aria-label="حجم الصفحة"
>
  {(["A4", "Letter", "16:9", "4:3", "16:9-fhd"] as PageSizePreset[]).map((p) => (
    <option key={p} value={p}>{pageSizeLabel(p)}</option>
  ))}
</select>
```

**Note:** CSS vars `--rd-page-width` and `--rd-page-height` were already set on `.rd-canvas-area` by Task A.2 (v13.0). This task only refactors the create-dialog size selector to use the new pageSizeLabel helper for consistency.

---

## v13.0 — 2026-06-28 — VizPanel element type grid + Ribbon toolbar redesign

**File:** `src/components/Sidebar/Tabs/ReportDesigner/editor/VizPanel.tsx`

**Before:**
```ts
// File did not exist
```

**After:**
```tsx
// New component: 8-icon element type picker (text/shape/image/line enabled; table/chart/kpi/section disabled)
// with embedded Inspector for format editing. Bridges VizPanel onUpdate(id, patch) to Inspector onUpdate(element).
export default function VizPanel({ selectedElement, onAddElement, onImageSelected, onUpdate }: VizPanelProps) { ... }
```

---

**File:** `src/components/Sidebar/Tabs/ReportDesigner/editor/Ribbon.tsx`

**Before:**
```ts
// File did not exist
```

**After:**
```tsx
// New component: Power BI-style ribbon with Back button, page-size selector, Fields/Format panel toggles,
// doc name display, autosave indicator, Save and Print buttons.
export default function Ribbon({ doc, saving, showFields, showFormat, onToggleFields, onToggleFormat, onSave, onPrint, onPageSizeChange, onBack }: RibbonProps) { ... }
```

---

**File:** `src/components/Sidebar/Tabs/ReportDesigner/index.tsx`

**Before:**
```tsx
// Imports: Inspector, no Ribbon/VizPanel/getPageSetup
// Stub ribbon: plain <div className="rd-ribbon"> with hardcoded buttons
// Stub viz panel: <div className="rd-viz-panel"> with bare Inspector
// Unused functions: deletePage, prevPage, nextPage; unused state: saveError
```

**After:**
```tsx
// Imports: Ribbon, VizPanel, getPageSetup (removed Inspector, added getPageSetup)
// Real Ribbon component wired with all props including onPageSizeChange + handlePageSizeChange handler
// Real VizPanel component with selectedElement, onAddElement=addElement, onImageSelected=addImageElement,
//   onUpdate=handleElementUpdate (id+patch bridge → updateElement)
// Dead code removed: deletePage, prevPage, nextPage; saveError renamed _saveError
```

---

## v12.0 — 2026-06-28 — FieldsPanel component (searchable field catalog tree)

**File:** `src/components/Sidebar/Tabs/ReportDesigner/editor/FieldsPanel.tsx`

**Before:**
```ts
// File did not exist
```

**After:**
```tsx
import { useState } from "react";
import { FACT_FIELDS } from "../../../../../data/reportDesigner/query/fieldCatalog";

export default function FieldsPanel() {
  const [search, setSearch] = useState("");
  const [dimOpen, setDimOpen] = useState(true);
  const [measOpen, setMeasOpen] = useState(true);

  const q = search.trim().toLowerCase();
  const dims = FACT_FIELDS.filter(
    (f) => f.role === "dimension" && (!q || f.label.includes(q) || f.field.toLowerCase().includes(q))
  );
  const meas = FACT_FIELDS.filter(
    (f) => f.role === "measure" && (!q || f.label.includes(q) || f.field.toLowerCase().includes(q))
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div className="rd-panel-header">
        <span>الحقول</span>
      </div>
      <input
        className="rd-fields-search"
        type="search"
        placeholder="بحث في الحقول..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        dir="rtl"
        aria-label="بحث في الحقول"
      />
      <div style={{ flex: 1, overflowY: "auto" }}>
        <div className="rd-fields-group">
          <div
            className="rd-fields-group-header"
            onClick={() => setDimOpen((v) => !v)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setDimOpen((v) => !v); }}
            aria-expanded={dimOpen}
          >
            <span>{dimOpen ? "▾" : "▸"}</span>
            <span>أبعاد ({dims.length})</span>
          </div>
          {dimOpen &&
            dims.map((f) => (
              <div key={f.field} className="rd-field-item" title={f.field}>
                <span className="rd-field-icon">📐</span>
                <span className="rd-field-label">{f.label}</span>
              </div>
            ))}
        </div>
        <div className="rd-fields-group">
          <div
            className="rd-fields-group-header"
            onClick={() => setMeasOpen((v) => !v)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setMeasOpen((v) => !v); }}
            aria-expanded={measOpen}
          >
            <span>{measOpen ? "▾" : "▸"}</span>
            <span>مقاييس ({meas.length})</span>
          </div>
          {measOpen &&
            meas.map((f) => (
              <div key={f.field} className="rd-field-item" title={f.field}>
                <span className="rd-field-icon">🔢</span>
                <span className="rd-field-label">{f.label}</span>
              </div>
            ))}
        </div>
        {dims.length === 0 && meas.length === 0 && (
          <p style={{ padding: "12px", color: "var(--rd-text-secondary)", fontSize: "13px" }}>
            لا توجد حقول مطابقة
          </p>
        )}
      </div>
    </div>
  );
}
```

**File:** `src/components/Sidebar/Tabs/ReportDesigner/index.tsx`

**Before:**
```tsx
import Canvas from "./editor/Canvas";
import Inspector from "./editor/Inspector";
import PagesBar from "./editor/PagesBar";
import PrintView from "./PrintView";
import "./ReportDesigner.css";
```

**After:**
```tsx
import Canvas from "./editor/Canvas";
import Inspector from "./editor/Inspector";
import PagesBar from "./editor/PagesBar";
import FieldsPanel from "./editor/FieldsPanel";
import PrintView from "./PrintView";
import "./ReportDesigner.css";
```

**File:** `src/components/Sidebar/Tabs/ReportDesigner/index.tsx` (EditorHost function)

**Before:**
```tsx
        {/* STUB: Fields panel (Task A.4 will replace this) */}
        <div className="rd-fields-panel">
          <div className="rd-panel-header"><span>الحقول</span></div>
          <p style={{ padding: "12px", color: "var(--rd-text-secondary)", fontSize: "13px" }}>
            لوحة الحقول — قريباً
          </p>
        </div>
```

**After:**
```tsx
        {/* Fields panel (Task A.4) */}
        <div className="rd-fields-panel">
          <FieldsPanel />
        </div>
```

---

## v11.0 — 2026-06-28 — PagesBar component (bottom page tab bar)

**File:** `src/components/Sidebar/Tabs/ReportDesigner/editor/PagesBar.tsx`

**Before:**
```ts
// File did not exist
```

**After:**
```tsx
import type { ReportDocument } from "../../../../../data/reportDesigner/reportTypes";

interface PagesBarProps {
  doc: ReportDocument;
  currentPageIndex: number;
  onSelectPage: (index: number) => void;
  onAddPage: () => void;
  onDeletePage: (index: number) => void;
}

export default function PagesBar({ doc, currentPageIndex, onSelectPage, onAddPage, onDeletePage }: PagesBarProps) {
  return (
    <div className="rd-pages-bar" dir="rtl">
      {doc.pages.map((page, i) => (
        <button
          key={page.pageId}
          className={`rd-page-tab${i === currentPageIndex ? " rd-page-tab--active" : ""}`}
          onClick={() => onSelectPage(i)}
          title={page.name}
          type="button"
        >
          {page.name}
          <span
            className="rd-page-tab-del"
            role="button"
            aria-label={`حذف ${page.name}`}
            onClick={(e) => { e.stopPropagation(); if (doc.pages.length > 1) onDeletePage(i); }}
            title="حذف الصفحة"
          >
            ×
          </span>
        </button>
      ))}
      <button className="rd-page-tab-add" onClick={onAddPage} type="button" title="إضافة صفحة">
        + صفحة
      </button>
    </div>
  );
}
```

---

**File:** `src/components/Sidebar/Tabs/ReportDesigner/index.tsx`

**Before:**
```tsx
import Canvas from "./editor/Canvas";
import Inspector from "./editor/Inspector";
import PrintView from "./PrintView";
import "./ReportDesigner.css";
```

**After:**
```tsx
import Canvas from "./editor/Canvas";
import Inspector from "./editor/Inspector";
import PagesBar from "./editor/PagesBar";
import PrintView from "./PrintView";
import "./ReportDesigner.css";
```

---

**File:** `src/components/Sidebar/Tabs/ReportDesigner/index.tsx` (EditorHost function)

**Before:**
```tsx
  function addPage() {
    const newPage = {
      pageId: createPageId(),
      name: `صفحة ${doc.pages.length + 1}`,
      order: doc.pages.length,
      filters: [],
      elements: [],
    };
    setDoc((d) => {
      const newPages = [...d.pages, newPage];
      setCurrentPageIndex(newPages.length - 1);
      return { ...d, pages: newPages };
    });
    setSelectedId(null);
  }

  function deletePage() {
    if (doc.pages.length <= 1) return;
    const nextIndex = Math.max(0, currentPageIndex - 1);
    setDoc((d) => ({ ...d, pages: d.pages.filter((_, i) => i !== currentPageIndex) }));
    setCurrentPageIndex(nextIndex);
    setSelectedId(null);
  }
```

**After:**
```tsx
  function addPage() {
    const newPage = {
      pageId: createPageId(),
      name: `صفحة ${doc.pages.length + 1}`,
      order: doc.pages.length,
      filters: [],
      elements: [],
    };
    setDoc((d) => {
      const newPages = [...d.pages, newPage];
      setCurrentPageIndex(newPages.length - 1);
      return { ...d, pages: newPages };
    });
    setSelectedId(null);
  }

  function handleDeletePage(index: number) {
    setDoc((d) => {
      if (d.pages.length <= 1) return d;
      const pages = d.pages.filter((_, i) => i !== index);
      return { ...d, pages };
    });
    setCurrentPageIndex((ci) => Math.min(ci, doc.pages.length - 2));
  }

  function deletePage() {
    if (doc.pages.length <= 1) return;
    const nextIndex = Math.max(0, currentPageIndex - 1);
    setDoc((d) => ({ ...d, pages: d.pages.filter((_, i) => i !== currentPageIndex) }));
    setCurrentPageIndex(nextIndex);
    setSelectedId(null);
  }
```

---

**File:** `src/components/Sidebar/Tabs/ReportDesigner/index.tsx` (JSX pages bar section)

**Before:**
```tsx
        {/* STUB: Pages bar (Task A.3 will replace this) */}
        <div className="rd-pages-bar">
          {doc.pages.map((page, i) => (
            <button
              key={page.pageId}
              className={`rd-page-tab${i === currentPageIndex ? " rd-page-tab--active" : ""}`}
              onClick={() => setCurrentPageIndex(i)}
            >
              {page.name}
            </button>
          ))}
          <button className="rd-page-tab-add" onClick={addPage}>+ صفحة</button>
        </div>
```

**After:**
```tsx
        {/* Pages bar (Task A.3) */}
        <PagesBar doc={doc} currentPageIndex={currentPageIndex} onSelectPage={setCurrentPageIndex} onAddPage={addPage} onDeletePage={handleDeletePage} />
```

---

## v10.0 — 2026-06-28 — Power BI 3-panel layout shell

**File:** `src/data/reportDesigner/reportTypes.ts`

**Before:**
```ts
export function createEmptyDocument(name: string, createdBy: string): ReportDocument {
  const now = new Date().toISOString();
  return {
    reportId: createReportId(),
    reportName: name,
    version: 1,
    createdAt: now, createdBy, updatedAt: now, updatedBy: createdBy,
    docType: "print",
    pageSetup: { ...A4_PORTRAIT, margins: { ...A4_PORTRAIT.margins } },
```

**After:**
```ts
export function createEmptyDocument(name: string, createdBy: string, preset: PageSizePreset = "A4"): ReportDocument {
  const now = new Date().toISOString();
  const pageSetup = getPageSetup(preset);
  return {
    reportId: createReportId(),
    reportName: name,
    version: 1,
    createdAt: now, createdBy, updatedAt: now, updatedBy: createdBy,
    docType: "print",
    pageSetup: { ...pageSetup, margins: { ...pageSetup.margins } },
```

---

**File:** `src/components/Sidebar/Tabs/ReportDesigner/ReportDesigner.css`

**Before:**
```css
/* ── Report Designer tab ── */

.rd-root {
  padding: 24px;
  ...
```

**After:**
```css
/* ── Power BI theme tokens ── */
:root { --rd-ribbon-bg: #f3f2f1; ... }

/* ── 3-panel editor layout ── */
.rd-pbi-layout { display: grid; grid-template-rows: 44px 1fr 40px; ... }
/* + all new PBI layout/ribbon/pages/panel classes */

/* ── Report Designer tab ── */
.rd-root { ... (unchanged) }
```

---

**File:** `src/components/Sidebar/Tabs/ReportDesigner/index.tsx`

**Before:**
```tsx
// EditorHost return:
return (
  <div className="rd-root rd-root--editor" dir="rtl">
    <div className="rd-editor-header">...</div>
    <Toolbar ... />
    <div className="rd-editor-body">
      <div className="rd-canvas-area"><Canvas ... zoom={0.9} /></div>
      <div className="rd-inspector-panel"><Inspector ... /></div>
    </div>
    {showPrint && <PrintView ... />}
  </div>
);
```

**After:**
```tsx
// EditorHost return (3-panel PBI layout):
// + showFields / showFormat state added
return (
  <>
    <div className={`rd-pbi-layout${!showFields ? " rd-fields-hidden" : ""}...`}>
      <div className="rd-ribbon">...</div>
      <div className="rd-fields-panel">...</div>
      <div className="rd-canvas-area"><Canvas ... zoom={1} /></div>
      <div className="rd-viz-panel"><Inspector ... /></div>
      <div className="rd-pages-bar">...</div>
    </div>
    {showPrint && <PrintView ... />}
  </>
);
```

---

## v9.0 — 2026-06-28 — feat(report-designer): add slide page-size presets (16:9, 4:3, FHD)

**File:** `src/data/reportDesigner/reportTypes.ts`

**Before:**
```ts
export type PageSizePreset = "A4" | "Letter" | "16:9" | "4:3" | "custom";
// ...
// A4 portrait at 96dpi = 794 x 1123 px.
export const A4_PORTRAIT: PageSetup = {
  size: "A4", orientation: "portrait", width: 794, height: 1123,
  margins: { top: 38, right: 38, bottom: 38, left: 38 },
};
```

**After:**
```ts
export type PageSizePreset = "A4" | "Letter" | "16:9" | "4:3" | "16:9-fhd" | "custom";

// A4 portrait at 96dpi = 794 x 1123 px.
export const A4_PORTRAIT: PageSetup = {
  size: "A4", orientation: "portrait", width: 794, height: 1123,
  margins: { top: 38, right: 38, bottom: 38, left: 38 },
};

export const SLIDE_16_9: PageSetup = {
  size: "16:9",
  orientation: "landscape",
  width: 1280,
  height: 720,
  margins: { top: 20, right: 20, bottom: 20, left: 20 },
};

export const SLIDE_4_3: PageSetup = {
  size: "4:3",
  orientation: "landscape",
  width: 960,
  height: 720,
  margins: { top: 20, right: 20, bottom: 20, left: 20 },
};

export const SLIDE_FHD: PageSetup = {
  size: "16:9-fhd",
  orientation: "landscape",
  width: 1920,
  height: 1080,
  margins: { top: 20, right: 20, bottom: 20, left: 20 },
};

export const SLIDE_PRESETS: Record<PageSizePreset, PageSetup> = {
  "A4": A4_PORTRAIT,
  "Letter": { size: "Letter", orientation: "portrait", width: 816, height: 1056, margins: { top: 38, right: 38, bottom: 38, left: 38 } },
  "16:9": SLIDE_16_9,
  "4:3": SLIDE_4_3,
  "16:9-fhd": SLIDE_FHD,
  "custom": A4_PORTRAIT,
};

export function getPageSetup(preset: PageSizePreset): PageSetup {
  return SLIDE_PRESETS[preset] ?? A4_PORTRAIT;
}
```

**File:** `src/data/reportDesigner/reportTypes.test.ts`

**Before:**
```ts
import { describe, it, expect } from "vitest";
import { createEmptyDocument, REPORT_SCHEMA_VERSION } from "./reportTypes";

describe("createEmptyDocument", () => {
  it("creates a print A4 document with one empty page", () => {
    const doc = createEmptyDocument("تقرير تجريبي", "admin");
    expect(doc.reportName).toBe("تقرير تجريبي");
    expect(doc.createdBy).toBe("admin");
    expect(doc.docType).toBe("print");
    expect(doc.pageSetup.size).toBe("A4");
    expect(doc.pageSetup.orientation).toBe("portrait");
    expect(doc.pages).toHaveLength(1);
    expect(doc.pages[0].elements).toEqual([]);
    expect(doc.reportId).toMatch(/^rpt-/);
    expect(REPORT_SCHEMA_VERSION).toBe(1);
  });
});
```

**After:**
```ts
import { describe, it, expect } from "vitest";
import { createEmptyDocument, REPORT_SCHEMA_VERSION, SLIDE_16_9, SLIDE_4_3, SLIDE_FHD, getPageSetup, SLIDE_PRESETS } from "./reportTypes";

describe("createEmptyDocument", () => {
  it("creates a print A4 document with one empty page", () => {
    const doc = createEmptyDocument("تقرير تجريبي", "admin");
    expect(doc.reportName).toBe("تقرير تجريبي");
    expect(doc.createdBy).toBe("admin");
    expect(doc.docType).toBe("print");
    expect(doc.pageSetup.size).toBe("A4");
    expect(doc.pageSetup.orientation).toBe("portrait");
    expect(doc.pages).toHaveLength(1);
    expect(doc.pages[0].elements).toEqual([]);
    expect(doc.reportId).toMatch(/^rpt-/);
    expect(REPORT_SCHEMA_VERSION).toBe(1);
  });
});

describe("slide page-size presets", () => {
  it("SLIDE_16_9 has correct dimensions", () => {
    expect(SLIDE_16_9.width).toBe(1280);
    expect(SLIDE_16_9.height).toBe(720);
    expect(SLIDE_16_9.size).toBe("16:9");
    expect(SLIDE_16_9.orientation).toBe("landscape");
  });

  it("SLIDE_4_3 has correct dimensions", () => {
    expect(SLIDE_4_3.width).toBe(960);
    expect(SLIDE_4_3.height).toBe(720);
    expect(SLIDE_4_3.size).toBe("4:3");
  });

  it("SLIDE_FHD is 1920x1080", () => {
    expect(SLIDE_FHD.width).toBe(1920);
    expect(SLIDE_FHD.height).toBe(1080);
    expect(SLIDE_FHD.size).toBe("16:9-fhd");
  });

  it("getPageSetup returns correct preset", () => {
    expect(getPageSetup("16:9").width).toBe(1280);
    expect(getPageSetup("4:3").width).toBe(960);
    expect(getPageSetup("A4").width).toBe(794);
    expect(getPageSetup("custom").width).toBe(794);
  });

  it("SLIDE_PRESETS has all six named presets", () => {
    expect(Object.keys(SLIDE_PRESETS).sort()).toEqual(["16:9", "16:9-fhd", "4:3", "A4", "Letter", "custom"].sort());
  });
});
```

---

## v8.1 — 2026-06-28 — fix(report-designer): CSSProperties import, DesignIndex doc, admin permission row

**File:** `src/components/Sidebar/Tabs/ReportDesigner/renderers/TextRenderer.tsx`

**Before:**
```tsx
import type { Element, TextConfig } from "../../../../../data/reportDesigner/reportTypes";
// ...
  const style: React.CSSProperties = {
```

**After:**
```tsx
import type { CSSProperties } from "react";
import type { Element, TextConfig } from "../../../../../data/reportDesigner/reportTypes";
// ...
  const style: CSSProperties = {
```

---

**File:** `docs/data-system-report.md`

**Before:**
```md
| `designs.index.json` | `4-Reports/designs/` | Index of all saved report designs (`JsonEnvelope<DesignIndex>`). Lists each design's `reportId`, `reportName`, `docType`, `createdAt`, and `updatedAt`. |
```

**After:**
```md
| `designs.index.json` | `4-Reports/designs/` | Index of all saved report designs (`JsonEnvelope<DesignIndex>`). Lists each design's `reportId`, `reportName`, `version`, and `updatedAt`. |
```

---

**File:** `src/auth/userManagement.ts`

**Before:**
```ts
    { role: "admin",      tabId: "reports",                 access: "edit" },
    { role: "admin",      tabId: "archive",                 access: "edit" },
```

**After:**
```ts
    { role: "admin",      tabId: "reports",                 access: "edit" },
    { role: "admin",      tabId: "report-designer",         access: "edit" },
    { role: "admin",      tabId: "archive",                 access: "edit" },
```

---

**File:** `src/components/Sidebar/Tabs/ReportDesigner/tabConfig.test.ts`

**Before:**
```ts
    expect(rows.map((r) => r.role).sort()).toEqual(
      ["employee", "guest", "manager", "supervisor"].sort()
    );
```

**After:**
```ts
    expect(rows.map((r) => r.role).sort()).toEqual(
      ["admin", "employee", "guest", "manager", "supervisor"].sort()
    );
```

---

## v8.0 — 2026-06-28 — Phase-1 integration pass: test suite, typecheck, lint, build verification; docs update

**File:** `src/components/Sidebar/Tabs/ReportDesigner/index.tsx`

**Before:**
```tsx
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPageIndex]);
```
and
```tsx
  useEffect(() => {
    if (!directoryHandle) return;
    let cancelled = false;
    setLoadingIndex(true);
    setIndexError(null);
    loadDesignIndex(directoryHandle)
      .then((idx) => {
        if (!cancelled) {
          setIndex(idx);
          setLoadingIndex(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setIndexError(
            err instanceof Error ? err.message : "خطأ غير متوقع عند تحميل القائمة."
          );
          setLoadingIndex(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [directoryHandle]);
```

**After:**
```tsx
  }, [currentPageIndex]);
```
and
```tsx
  useEffect(() => {
    if (!directoryHandle) return;
    let cancelled = false;
    async function fetchIndex() {
      setLoadingIndex(true);
      setIndexError(null);
      try {
        const idx = await loadDesignIndex(directoryHandle!);
        if (!cancelled) {
          setIndex(idx);
          setLoadingIndex(false);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setIndexError(
            err instanceof Error ? err.message : "خطأ غير متوقع عند تحميل القائمة."
          );
          setLoadingIndex(false);
        }
      }
    }
    void fetchIndex();
    return () => {
      cancelled = true;
    };
  }, [directoryHandle]);
```
_(Fixes: removed stale `eslint-disable` comment; refactored synchronous setState calls in useEffect into an async inner function to satisfy `react-hooks/set-state-in-effect` lint rule.)_

**File:** `docs/data-system-report.md`

**Before:** _(4-Reports section had no designs/ subsection — only the summary table row)_
```markdown
| `4-Reports/` | Generated/report artifacts when report flows write to the workspace. |
```
_(no `## 4-Reports/designs/` section existed)_

**After:** _(new section added before `## Templates, Preferences, Backups`)_
```markdown
## 4-Reports/designs/

Report Designer saves and loads user-created report designs under this sub-folder.

| File or Pattern | Location | Purpose |
| --- | --- | --- |
| `designs.index.json` | `4-Reports/designs/` | Index of all saved report designs (`JsonEnvelope<DesignIndex>`). Lists each design's `reportId`, `reportName`, `docType`, `createdAt`, and `updatedAt`. |
| `{reportId}.json` | `4-Reports/designs/` | Individual `ReportDocument` persisted as `JsonEnvelope<ReportDocument>`. Contains the full document: theme, pages, and all canvas elements (text, shape, image). |

Both files use `safeWriteJson` / `safeReadJson` and the `JsonEnvelope` schema-versioning wrapper (current `schemaVersion: 1`). The index is re-derived from the design files on load; `designs.index.json` is the live index that the Report Designer list view reads.
```

---

## v7.14 — 2026-06-28 — Report Designer: print/PDF view (Task 1.7)

**File:** `src/components/Sidebar/Tabs/ReportDesigner/PrintView.tsx` _(new file)_

**Before:** _(file did not exist)_

**After:**
```tsx
import type { ReportDocument } from "../../../../data/reportDesigner/reportTypes";
import Canvas from "./editor/Canvas";

interface PrintViewProps {
  doc: ReportDocument;
  onClose: () => void;
}

export default function PrintView({ doc, onClose }: PrintViewProps) {
  return (
    <div
      className="rd-print-overlay"
      dir="rtl"
      style={{
        position: "fixed",
        inset: 0,
        background: "white",
        zIndex: 9999,
        overflowY: "auto",
        padding: "16px",
        boxSizing: "border-box",
      }}
    >
      <div className="rd-no-print" style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
        <button className="rd-btn rd-btn-secondary" onClick={onClose}>رجوع</button>
        <button className="rd-btn rd-btn-primary" onClick={() => window.print()}>طباعة</button>
      </div>
      {doc.pages.map((_page, i) => (
        <div key={i} className="rd-print-page">
          <Canvas
            doc={doc}
            pageIndex={i}
            selectedId={null}
            onSelect={() => {}}
            mode="view"
            zoom={1}
          />
        </div>
      ))}
    </div>
  );
}
```

---

**File:** `src/components/Sidebar/Tabs/ReportDesigner/ReportDesigner.css`

**Before:** _(no print CSS existed)_

**After:** _(appended at end of file)_
```css
/* ── Print view ── */
.rd-print-page {
  width: var(--rd-page-width, 794px);
  height: var(--rd-page-height, 1123px);
  page-break-after: always;
  break-after: page;
  overflow: hidden;
  position: relative;
  margin: 0 auto 16px;
  box-shadow: 0 0 8px rgba(0,0,0,0.15);
  background: white;
}

@media print {
  .rd-no-print {
    display: none !important;
  }
  body > *:not(.rd-print-overlay) {
    display: none !important;
  }
  .rd-print-overlay {
    position: static !important;
    z-index: auto !important;
  }
  .rd-print-page {
    box-shadow: none;
    margin: 0;
    page-break-after: always;
    break-after: page;
  }
  .rd-print-page:last-child {
    page-break-after: avoid;
    break-after: avoid;
  }
}

/* TODO: dynamically set @page size from doc.pageSetup when browsers support
   setting @page rules from JS. For now fixed at A4 portrait (@96dpi = 794×1123px). */
@page {
  size: A4 portrait;
  margin: 0;
}
```

---

**File:** `src/components/Sidebar/Tabs/ReportDesigner/index.tsx`

**Before:**
```tsx
function EditorHost({ initialDoc, directoryHandle, currentUser, onBack }: EditorHostProps) {
  const [doc, setDoc] = useState<ReportDocument>(initialDoc);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
```

**After:**
```tsx
function EditorHost({ initialDoc, directoryHandle, currentUser, onBack }: EditorHostProps) {
  const [doc, setDoc] = useState<ReportDocument>(initialDoc);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showPrint, setShowPrint] = useState(false);
```

**Before (onPrint):**
```tsx
        onPrint={() => window.print()}
```

**After (onPrint):**
```tsx
        onPrint={() => setShowPrint(true)}
```

**Before (return statement end of EditorHost):**
```tsx
    </div>
  );
}

// ── Main tab component ──────────────────────────────────────────────────────
```

**After (return statement end of EditorHost):**
```tsx
      {showPrint && <PrintView doc={doc} onClose={() => setShowPrint(false)} />}
    </div>
  );
}

// ── Main tab component ──────────────────────────────────────────────────────
```

---

## v7.13 — 2026-06-28 — Fix: page mutation stale closures in Report Designer

**File:** `src/components/Sidebar/Tabs/ReportDesigner/index.tsx`

**Before — addPage:**
```ts
function addPage() {
  const newPage = {
    pageId: createPageId(),
    name: `صفحة ${doc.pages.length + 1}`,
    order: doc.pages.length,
    filters: [],
    elements: [],
  };
  setDoc((d) => ({ ...d, pages: [...d.pages, newPage] }));
  setCurrentPageIndex(doc.pages.length);  // stale closure: reads render-time length
  setSelectedId(null);
}
```

**After — addPage:**
```ts
function addPage() {
  const newPage = {
    pageId: createPageId(),
    name: `صفحة ${doc.pages.length + 1}`,
    order: doc.pages.length,
    filters: [],
    elements: [],
  };
  setDoc((d) => {
    const newPages = [...d.pages, newPage];
    setCurrentPageIndex(newPages.length - 1);  // guaranteed latest from updater
    return { ...d, pages: newPages };
  });
  setSelectedId(null);
}
```

**Before — deletePage:**
```ts
function deletePage() {
  if (doc.pages.length <= 1) return;
  const nextPages = doc.pages.filter((_, i) => i !== currentPageIndex);  // stale closure
  const nextIndex = Math.max(0, currentPageIndex - 1);
  setDoc((d) => ({ ...d, pages: nextPages }));
  setCurrentPageIndex(nextIndex);
  setSelectedId(null);
}
```

**After — deletePage:**
```ts
function deletePage() {
  if (doc.pages.length <= 1) return;
  const nextIndex = Math.max(0, currentPageIndex - 1);
  setDoc((d) => ({ ...d, pages: d.pages.filter((_, i) => i !== currentPageIndex) }));  // filter from updater state
  setCurrentPageIndex(nextIndex);
  setSelectedId(null);
}
```

---

## v7.12 — 2026-06-28 — Report Designer: Toolbar, Inspector, autosave (Task 1.6)

Phase 1, Task 1.6: wires the full editor — Toolbar (add elements/pages, page nav, save, print), Inspector (selected-element property editor), and debounced autosave (800 ms) with an explicit Save button.

**File:** `src/components/Sidebar/Tabs/ReportDesigner/editor/Toolbar.tsx`

**Before:** (file did not exist)

**After:** New component. Props: `{ doc, currentPageIndex, onAddElement, onImageSelected, onAddPage, onDeletePage, onPrevPage, onNextPage, onSave, onPrint, saving }`. Renders RTL Arabic toolbar with "إضافة نص", "إضافة شكل", "إضافة صورة" (hidden file-input), page navigation, "إضافة صفحة", "حذف الصفحة", "حفظ"/"جاري الحفظ…", "طباعة" buttons.

**File:** `src/components/Sidebar/Tabs/ReportDesigner/editor/Inspector.tsx`

**Before:** (file did not exist)

**After:** New component. Props: `{ element: Element | null; onUpdate: (updated: Element) => void }`. Renders nothing when no element selected. When selected: name field, geometry inputs (x/y/w/h), style fields (fill, borderColor, fontSize, fontWeight, borderWidth, padding, opacity, textAlign, color), and type-specific content section (text textarea; shape select; image placeholder; table/chart/kpi placeholder).

**File:** `src/components/Sidebar/Tabs/ReportDesigner/index.tsx`

**Before:**
```tsx
  // --- Editor view ---
  if (view === "editor") {
    return (
      <div className="rd-root" dir="rtl">
        <div className="rd-editor-header">
          <button
            className="rd-btn rd-btn-secondary"
            onClick={() => {
              setView("list");
              setOpenDoc(null);
            }}
          >
            رجوع
          </button>
          <h2 className="rd-title rd-title-inline">
            {openDoc?.reportName ?? "تقرير جديد"}
          </h2>
        </div>
        <div className="rd-editor-placeholder">
          محرر التقارير — قيد التطوير
        </div>
      </div>
    );
  }
```

**After:** Replaced placeholder with `<EditorHost>` component (defined inside index.tsx). `EditorHost` owns `doc`, `currentPageIndex`, `selectedId`, `saving`, `saveError` state. Implements debounced 800 ms autosave via `useRef`-held timer. Handles `onAddElement` (text/shape/image), `onUpdateElement`, `onElementChange` (geometry only), page CRUD. Renders `<Toolbar>` + `<Canvas>` + `<Inspector>` in a two-column layout (canvas left, inspector right in RTL = canvas right visually).

**File:** `src/components/Sidebar/Tabs/ReportDesigner/ReportDesigner.css`

**Before:** (ends at `.rd-resize-handle--se` rule)

**After:** Appended editor-layout rules: `.rd-editor-body`, `.rd-canvas-area`, `.rd-toolbar`, `.rd-inspector`, `.rd-inspector-section`, `.rd-inspector-field`, `.rd-inspector-input`, `.rd-inspector-textarea`, `.rd-inspector-select`, `.rd-save-status`.

---

## v7.11 — 2026-06-28 — Report Designer: drag/resize/select interactions (Task 1.5)

Phase 1, Task 1.5: pointer-event drag and resize interactions for canvas elements.

Created `useCanvasInteractions` hook that uses pointer capture (`setPointerCapture`) to track drag-move and resize-handle operations. Drag translates x/y; resize delegates to `geometry.resize()`. On pointer-up, `snapRect()` snaps the result to the grid, then calls `onElementChange`. All drag state lives in `useRef` (no re-renders mid-drag). Window-level `pointermove`/`pointerup` listeners are added on capture start and removed on release.

Modified `Canvas.tsx` to accept `onElementChange` prop, wire `onPointerDown` on non-locked elements in edit mode, and render 8 resize handles around the selected element.

Added CSS for `.rd-resize-handle` and its 8 directional modifier classes (RTL-aware positioning).

**File:** `src/components/Sidebar/Tabs/ReportDesigner/editor/useCanvasInteractions.ts`

**Before:** (file did not exist)

**After:** (see file — pointer-capture drag/resize hook returning `onElementPointerDown` and `onHandlePointerDown`)

**File:** `src/components/Sidebar/Tabs/ReportDesigner/editor/Canvas.tsx`

**Before:**
```tsx
interface CanvasProps {
  doc: ReportDocument;
  pageIndex: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  mode: "edit" | "view";
  zoom?: number;
}
// elements rendered without drag/resize handlers; no resize handles
```

**After:**
```tsx
interface CanvasProps {
  doc: ReportDocument;
  pageIndex: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  mode: "edit" | "view";
  zoom?: number;
  onElementChange?: (elementId: string, rect: Rect) => void;
}
// elements get onPointerDown for drag; selected element renders 8 resize handles
```

**File:** `src/components/Sidebar/Tabs/ReportDesigner/ReportDesigner.css`

**Before:** (no resize handle styles)

**After:** (added `.rd-resize-handle` base + 8 directional modifier classes with RTL-aware positioning)

---

## v7.12.1 — 2026-06-28 — Fix: update onElementChange ref in effect not during render

**File:** `src/components/Sidebar/Tabs/ReportDesigner/editor/useCanvasInteractions.ts`

**Before:**
```ts
import { useRef, useCallback } from "react";
// ...
const onElementChangeRef = useRef(onElementChange);
onElementChangeRef.current = onElementChange;  // ← during render — invalid React pattern
```

**After:**
```ts
import { useRef, useCallback, useEffect } from "react";
// ...
const onElementChangeRef = useRef(onElementChange);
useEffect(() => {
  onElementChangeRef.current = onElementChange;
}, [onElementChange]);
```

Updating `ref.current` during render is a React anti-pattern and can cause unexpected behavior. The fix wraps the ref update in a `useEffect` so it only happens after render completes.

---

## v7.12 — 2026-06-28 — Fix: pointer capture + stable onElementChange ref in useCanvasInteractions

**File:** `src/components/Sidebar/Tabs/ReportDesigner/editor/useCanvasInteractions.ts`

**Before:**
```ts
// onElementChange closed over directly in handlePointerUp useCallback deps → stale closure risk.
// window.addEventListener("pointermove", handlePointerMove) and
// window.addEventListener("pointerup", handlePointerUp) added on drag start → redundant with
// pointer capture, fires handlers twice, requires manual removeEventListener cleanup.
// Return type: { onElementPointerDown, onHandlePointerDown }
const handlePointerUp = useCallback(
  (e: PointerEvent) => {
    ...
    onElementChange(state.elementId, snapped);
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", handlePointerUp);
  },
  [grid, onElementChange, handlePointerMove]
);
// startDrag added window listeners:
window.addEventListener("pointermove", handlePointerMove);
window.addEventListener("pointerup", handlePointerUp);
```

**After:**
```ts
// onElementChange stored in useRef; read as onElementChangeRef.current at call time →
// no stale closure, handlers never need recreating for this dep.
// No window listeners — pointer capture already routes events to the capturing element;
// onPointerMove/onPointerUp are React handlers on the canvas root div.
// Return type: { onElementPointerDown, onHandlePointerDown, onPointerMove, onPointerUp }
const onElementChangeRef = useRef(onElementChange);
onElementChangeRef.current = onElementChange;

const onPointerUp = useCallback((e: React.PointerEvent) => {
  ...
  onElementChangeRef.current(state.elementId, snapped);
  dragRef.current = null;
}, [grid]);
```

**File:** `src/components/Sidebar/Tabs/ReportDesigner/editor/Canvas.tsx`

**Before:**
```tsx
const { onElementPointerDown, onHandlePointerDown } = useCanvasInteractions({ ... });
// canvas root div had no onPointerMove/onPointerUp
```

**After:**
```tsx
const { onElementPointerDown, onHandlePointerDown, onPointerMove, onPointerUp } = useCanvasInteractions({ ... });
// canvas root div:
onPointerMove={mode === "edit" ? onPointerMove : undefined}
onPointerUp={mode === "edit" ? onPointerUp : undefined}
```

---

## v7.10 — 2026-06-28 — Fix implicit React.CSSProperties imports in canvas components

Small fix for type imports in Report Designer canvas components. The `React.CSSProperties` type was used implicitly without an explicit import. Changed to `import type { CSSProperties } from "react"` and replaced all instances of `React.CSSProperties` with the explicit `CSSProperties` type.

**File:** `src/components/Sidebar/Tabs/ReportDesigner/editor/Canvas.tsx`

**Before:**
```ts
import type { ReportDocument, Element } from "../../../../../data/reportDesigner/reportTypes";
// ... no explicit CSSProperties import
const canvasStyle: React.CSSProperties = { ... };
const innerStyle: React.CSSProperties = ...
const wrapperStyle: React.CSSProperties = { ... };
```

**After:**
```ts
import type { CSSProperties } from "react";
import type { ReportDocument, Element } from "../../../../../data/reportDesigner/reportTypes";
// ...
const canvasStyle: CSSProperties = { ... };
const innerStyle: CSSProperties = ...
const wrapperStyle: CSSProperties = { ... };
```

**File:** `src/components/Sidebar/Tabs/ReportDesigner/renderers/ShapeRenderer.tsx`

**Before:**
```ts
import type { Element, ShapeConfig } from "../../../../../data/reportDesigner/reportTypes";
// ... no explicit CSSProperties import
const hrStyle: React.CSSProperties = { ... };
const divStyle: React.CSSProperties = { ... };
```

**After:**
```ts
import type { CSSProperties } from "react";
import type { Element, ShapeConfig } from "../../../../../data/reportDesigner/reportTypes";
// ...
const hrStyle: CSSProperties = { ... };
const divStyle: CSSProperties = { ... };
```

---

## v7.9 — 2026-06-28 — Report Designer: canvas surface + static renderers (Task 1.4)

Phase 1, Task 1.4: Canvas component and pure element renderers for text, shape, and image. Canvas renders a page at exact `pageSetup.width × height` pixels (scaled by optional `zoom`), positions elements absolutely by (x,y,w,h), sorts by z-index, and dispatches to the correct renderer. In edit mode clicking elements calls `onSelect`; selected element receives `rd-element--selected` class for blue outline. Table/chart/kpi elements show a placeholder div. TextRenderer applies ElementStyle to displayed text. ShapeRenderer handles rect/ellipse/line/divider. ImageRenderer renders img with object-fit contain.

**File:** `src/components/Sidebar/Tabs/ReportDesigner/renderers/TextRenderer.tsx`

**Before:** (file did not exist)

**After:** (see file — pure text renderer applying ElementStyle)

**File:** `src/components/Sidebar/Tabs/ReportDesigner/renderers/ShapeRenderer.tsx`

**Before:** (file did not exist)

**After:** (see file — div-based rect/ellipse, hr-based line/divider)

**File:** `src/components/Sidebar/Tabs/ReportDesigner/renderers/ImageRenderer.tsx`

**Before:** (file did not exist)

**After:** (see file — img with object-fit contain filling container)

**File:** `src/components/Sidebar/Tabs/ReportDesigner/editor/Canvas.tsx`

**Before:** (file did not exist)

**After:** (see file — absolute-positioned page container with element dispatch and selection chrome)

**File:** `src/components/Sidebar/Tabs/ReportDesigner/ReportDesigner.css`

**Before:** (see previous entry — no canvas/renderer/selection styles)

**After:** (see file — extended with .rd-canvas, .rd-element, .rd-element--selected, .rd-element-placeholder styles)

---

## v7.8 — 2026-06-28 — Report Designer: design list create/open/delete (Task 1.3)

Phase 1, Task 1.3: Wire the storage layer to the ReportDesigner UI. Replaces the skeleton body with a full list view (load index on mount, new-design inline input, open/delete per row) and an editor placeholder view. Uses `loadDesignIndex`, `saveDesign`, `deleteDesign`, `loadDesign` from `reportDesignStorage.ts` and `createEmptyDocument` from `reportTypes.ts`.

**File:** `src/components/Sidebar/Tabs/ReportDesigner/index.tsx`

**Before:**
```tsx
/* eslint-disable react-refresh/only-export-components */
import { LayoutDashboard } from "lucide-react";
import type { SidebarTabModule } from "../tabTypes";
import "./ReportDesigner.css";

export const tabConfig: SidebarTabModule["tabConfig"] = {
  id: "report-designer",
  label: "مصمم التقارير",
  order: 27,
  allowedRoles: ["supervisor", "manager", "admin"],
  icon: <LayoutDashboard size={20} strokeWidth={1.8} aria-hidden />,
};

export default function ReportDesigner() {
  return (
    <div className="rd-root" dir="rtl">
      <h2 className="rd-title">مصمم التقارير</h2>
      <p className="rd-empty">لا توجد تقارير محفوظة بعد.</p>
    </div>
  );
}
```

**After:** (see file — full implementation with list + editor placeholder views)

**File:** `src/components/Sidebar/Tabs/ReportDesigner/ReportDesigner.css`

**Before:**
```css
.rd-root { padding: 24px; }
.rd-title { font-size: 20px; font-weight: 700; margin: 0 0 12px; }
.rd-empty { color: #57606a; }
```

**After:** (see file — extended with list, row, button, new-design-form, and editor-placeholder styles)

**File:** `src/components/Sidebar/Tabs/ReportDesigner/tabConfig.test.ts`

**Before:**
```ts
expect(tabConfig.id).toBe("report-designer");
expect(tabConfig.label).toBe("مصمم التقارير");
expect(tabConfig.allowedRoles).toEqual(["supervisor", "manager", "admin"]);
```

**After:**
```ts
// tabConfig is typed as optional in SidebarTabModule; assert it exists first
expect(tabConfig).toBeDefined();
if (!tabConfig) return;
expect(tabConfig.id).toBe("report-designer");
expect(tabConfig.label).toBe("مصمم التقارير");
expect(tabConfig.allowedRoles).toEqual(["supervisor", "manager", "admin"]);
```

---

## v7.7 — 2026-06-28 — Report Designer: register tab skeleton (FEATURE)

Phase 1, Task 1.2: Register the "مصمم التقارير" tab in the auto-discovery system. Creates the tab skeleton component + CSS, adds the tab to `MANAGED_TABS`, and adds four default-permission rows (guest/employee/supervisor/manager) to `createDefaultPermissions()` in `userManagement.ts`.

**File:** `src/components/Sidebar/Tabs/ReportDesigner/index.tsx` (new)

**Before:**
```
(file did not exist)
```

**After:**
```tsx
/* eslint-disable react-refresh/only-export-components */
import { LayoutDashboard } from "lucide-react";
import type { SidebarTabModule } from "../tabTypes";
import "./ReportDesigner.css";

export const tabConfig: SidebarTabModule["tabConfig"] = {
  id: "report-designer",
  label: "مصمم التقارير",
  order: 27,
  allowedRoles: ["supervisor", "manager", "admin"],
  icon: <LayoutDashboard size={20} strokeWidth={1.8} aria-hidden />,
};

export default function ReportDesigner() {
  return (
    <div className="rd-root" dir="rtl">
      <h2 className="rd-title">مصمم التقارير</h2>
      <p className="rd-empty">لا توجد تقارير محفوظة بعد.</p>
    </div>
  );
}
```

**File:** `src/components/Sidebar/Tabs/ReportDesigner/ReportDesigner.css` (new)

**Before:**
```
(file did not exist)
```

**After:**
```css
.rd-root { padding: 24px; }
.rd-title { font-size: 20px; font-weight: 700; margin: 0 0 12px; }
.rd-empty { color: #57606a; }
```

**File:** `src/auth/userManagement.ts`

**Before:**
```ts
  { id: "reports",                 label: "إدارة التقارير" },
  { id: "reports/reports",         label: "التقارير",              parentId: "reports" },
  { id: "reports/kpi",             label: "مؤشرات الأداء",          parentId: "reports" },
  { id: "archive",                 label: "إدارة الأرشيف" },
```

**After:**
```ts
  { id: "reports",                 label: "إدارة التقارير" },
  { id: "reports/reports",         label: "التقارير",              parentId: "reports" },
  { id: "reports/kpi",             label: "مؤشرات الأداء",          parentId: "reports" },
  { id: "report-designer",         label: "مصمم التقارير" },
  { id: "archive",                 label: "إدارة الأرشيف" },
```

**File:** `src/auth/userManagement.ts` (createDefaultPermissions)

**Before:**
```ts
    { role: "guest",      tabId: "reports",            access: "none" },
    ...
    { role: "employee",   tabId: "reports",            access: "none" },
    ...
    { role: "supervisor", tabId: "reports",            access: "view" },
    ...
    { role: "manager",    tabId: "reports",            access: "edit" },
```
(no report-designer rows)

**After:** four new rows added (guest=none, employee=none, supervisor=view, manager=edit) for tabId "report-designer" after each role's "reports" row.

---

## v7.6 — 2026-06-28 — Report Designer: canvas geometry helpers (FEATURE)

Phase 1, Task 1.1: Implement pure canvas geometry helper functions for the Report Designer. These functions provide snap-to-grid, rectangle snapping, resize-from-handle, and hit-test capabilities used by drag/resize interactions. No UI — only TypeScript helpers with comprehensive test coverage.

**File:** `src/data/reportDesigner/geometry.ts` (new)

**Before:**
```
(file did not exist)
```

**After:**
```ts
export type Rect = { x: number; y: number; w: number; h: number };
export type ResizeHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export function snap(value: number, grid: number): number {
  if (grid <= 0) return value;
  return Math.round(value / grid) * grid;
}

export function snapRect(rect: Rect, grid: number): Rect {
  return { x: snap(rect.x, grid), y: snap(rect.y, grid), w: snap(rect.w, grid), h: snap(rect.h, grid) };
}

export function resize(rect: Rect, handle: ResizeHandle, dx: number, dy: number, minW = 8, minH = 8): Rect {
  let { x, y, w, h } = rect;
  if (handle.includes("e")) w = Math.max(minW, w + dx);
  if (handle.includes("s")) h = Math.max(minH, h + dy);
  if (handle.includes("w")) { const nw = Math.max(minW, w - dx); x += w - nw; w = nw; }
  if (handle.includes("n")) { const nh = Math.max(minH, h - dy); y += h - nh; h = nh; }
  return { x, y, w, h };
}

export function hitTest(rect: Rect, px: number, py: number): boolean {
  return px >= rect.x && px <= rect.x + rect.w && py >= rect.y && py <= rect.y + rect.h;
}
```

**File:** `src/data/reportDesigner/geometry.test.ts` (new)

**Before:**
```
(file did not exist)
```

**After:**
```ts
import { describe, it, expect } from "vitest";
import { snap, snapRect, resize, hitTest } from "./geometry";

describe("geometry", () => {
  it("snaps to nearest grid multiple", () => {
    expect(snap(11, 8)).toBe(8);
    expect(snap(13, 8)).toBe(16);
  });
  it("snaps a whole rect", () => {
    expect(snapRect({ x: 11, y: 13, w: 31, h: 5 }, 8)).toEqual({ x: 8, y: 16, w: 32, h: 8 });
  });
  it("resizes from the SE handle by growing w/h", () => {
    expect(resize({ x: 0, y: 0, w: 100, h: 100 }, "se", 20, 30)).toEqual({ x: 0, y: 0, w: 120, h: 130 });
  });
  it("resizes from the NW handle by moving origin and shrinking", () => {
    expect(resize({ x: 10, y: 10, w: 100, h: 100 }, "nw", 20, 20)).toEqual({ x: 30, y: 30, w: 80, h: 80 });
  });
  it("enforces a minimum size", () => {
    expect(resize({ x: 0, y: 0, w: 50, h: 50 }, "se", -100, -100, 10, 10)).toEqual({ x: 0, y: 0, w: 10, h: 10 });
  });
  it("hit-tests a point inside the rect", () => {
    expect(hitTest({ x: 0, y: 0, w: 100, h: 100 }, 50, 50)).toBe(true);
    expect(hitTest({ x: 0, y: 0, w: 100, h: 100 }, 150, 50)).toBe(false);
  });
});
```

---

## v7.5 — 2026-06-28 — Report Designer: design storage CRUD + index (FEATURE)

Phase 0, Task 0.6: Implement disk storage for ReportDocument designs, mirroring templateStorage.ts. Files live in `4-Reports/designs/` (created on demand). Index file is `designs.index.json`. Exports `DesignIndex`, `saveDesign`, `loadDesign`, `loadDesignIndex`, `deleteDesign`.

**File:** `src/data/reportDesigner/storage/reportDesignStorage.ts` (new)

**Before:**
```
(file did not exist)
```

**After:**
```ts
import type { DirectoryHandleLike } from "../../storage/fileSystemAccess";
import { safeReadJson, safeWriteJson } from "../../storage/safeWrite";
import { withResourceLock } from "../../storage/webLocks";
import { getReportsRoot } from "../../workspace/workspacePaths";
import type { ReportDocument } from "../reportTypes";

const INDEX_FILE = "designs.index.json";

export type DesignIndex = {
  designs: Array<{
    reportId: string;
    reportName: string;
    version: number;
    updatedAt: string;
  }>;
};

async function getDesignsDir(
  directoryHandle: DirectoryHandleLike
): Promise<DirectoryHandleLike> {
  const reports = await getReportsRoot(directoryHandle, true);
  return reports.getDirectoryHandle("designs", { create: true });
}

export async function saveDesign(
  directoryHandle: DirectoryHandleLike,
  doc: ReportDocument
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (!doc.reportId || !doc.reportName) {
      return { ok: false, error: "بيانات التقرير غير مكتملة، ولم يتم الحفظ." };
    }

    const dir = await getDesignsDir(directoryHandle);
    await withResourceLock(`${dir.name}/designs-index`, async () => {
      await safeWriteJson(dir, `${doc.reportId}.json`, doc);

      const indexResult = await safeReadJson<DesignIndex>(dir, INDEX_FILE);
      const existing: DesignIndex = indexResult.ok
        ? indexResult.value
        : { designs: [] };

      const others = existing.designs.filter((d) => d.reportId !== doc.reportId);
      const updated: DesignIndex = {
        designs: [
          ...others,
          {
            reportId: doc.reportId,
            reportName: doc.reportName,
            version: doc.version,
            updatedAt: doc.updatedAt,
          },
        ].sort((a, b) => a.reportName.localeCompare(b.reportName, "ar")),
      };
      await safeWriteJson(dir, INDEX_FILE, updated);
    });

    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, error: msg };
  }
}

export async function loadDesign(
  directoryHandle: DirectoryHandleLike,
  reportId: string
): Promise<ReportDocument | null> {
  try {
    const dir = await getDesignsDir(directoryHandle);
    const result = await safeReadJson<ReportDocument>(dir, `${reportId}.json`);
    return result.ok && typeof result.value.reportId === "string"
      ? result.value
      : null;
  } catch {
    return null;
  }
}

export async function loadDesignIndex(
  directoryHandle: DirectoryHandleLike
): Promise<DesignIndex> {
  try {
    const dir = await getDesignsDir(directoryHandle);
    const result = await safeReadJson<DesignIndex>(dir, INDEX_FILE);
    return result.ok ? result.value : { designs: [] };
  } catch {
    return { designs: [] };
  }
}

export async function deleteDesign(
  directoryHandle: DirectoryHandleLike,
  reportId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const dir = await getDesignsDir(directoryHandle);
    await withResourceLock(`${dir.name}/designs-index`, async () => {
      const indexResult = await safeReadJson<DesignIndex>(dir, INDEX_FILE);
      if (indexResult.ok) {
        const updated: DesignIndex = {
          designs: indexResult.value.designs.filter(
            (d) => d.reportId !== reportId
          ),
        };
        await safeWriteJson(dir, INDEX_FILE, updated);
      }

      if (dir.removeEntry) {
        await dir.removeEntry(`${reportId}.json`);
      } else {
        await safeWriteJson(dir, `${reportId}.json`, {
          deleted: true,
          reportId,
          deletedAt: new Date().toISOString(),
        });
      }
    });

    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, error: msg };
  }
}
```

**File:** `src/data/reportDesigner/storage/reportDesignStorage.test.ts` (new)

**Before:**
```
(file did not exist)
```

**After:**
```ts
import { describe, it, expect } from "vitest";
import { createMemoryDirectory } from "../../storage/memoryDirectory";
import { createEmptyDocument } from "../reportTypes";
import {
  saveDesign,
  loadDesign,
  loadDesignIndex,
  deleteDesign,
} from "./reportDesignStorage";

describe("reportDesignStorage", () => {
  it("round-trips a design and updates the index", async () => {
    const dir = createMemoryDirectory("root");
    const doc = createEmptyDocument("تقرير الأداء", "admin");
    const saved = await saveDesign(dir, doc);
    expect(saved.ok).toBe(true);

    const loaded = await loadDesign(dir, doc.reportId);
    expect(loaded?.reportName).toBe("تقرير الأداء");

    const index = await loadDesignIndex(dir);
    expect(index.designs.map((d) => d.reportId)).toContain(doc.reportId);
  });

  it("deletes a design and removes it from the index", async () => {
    const dir = createMemoryDirectory("root");
    const doc = createEmptyDocument("للحذف", "admin");
    await saveDesign(dir, doc);
    const del = await deleteDesign(dir, doc.reportId);
    expect(del.ok).toBe(true);
    const index = await loadDesignIndex(dir);
    expect(index.designs.map((d) => d.reportId)).not.toContain(doc.reportId);
  });
});
```

---

## v7.4 — 2026-06-28 — Fix grouping key delimiter to prevent collisions (BUG)

Grouping key was built by joining multiple `groupBy` dimension values with a space `" "`. This caused false key collisions when dimension values themselves contained spaces. For example, `{name: "John Smith", dept: "HR"}` and `{name: "John", dept: "Smith HR"}` both produced key `"John Smith HR"`. Changed the delimiter from `" "` to `"\x00"` (null byte, which cannot appear in normal string data) to prevent collisions.

**File:** `src/data/reportDesigner/query/runQuery.ts`

**Before:**
```ts
const key = spec.groupBy.map((g) => String(row[g] ?? "")).join(" ");
```

**After:**
```ts
const key = spec.groupBy.map((g) => String(row[g] ?? "")).join("\x00");
```

---

## v7.3 — 2026-06-28 — Report Designer: runQuery group-by engine (FEATURE)

Phase 0, Task 0.4: Implement the core query engine that combines filtering, grouping, aggregation, sorting, and limiting. The runQuery function accepts filtered rows, groups them by dimension fields, computes aggregates, optionally sorts the results, and optionally applies a limit. Output measure keys use the `as` alias if provided, else `${agg}_${field}`. Group keys preserve the dimension field names. When groupBy is empty, returns a single aggregate row (grand total). Handles percentOfTotal aggregations by pre-computing grand totals.

**File:** `src/data/reportDesigner/query/runQuery.ts` (new)

**Before:**
```ts
(new file)
```

**After:**
```ts
import type { Aggregation, Filter } from "../reportTypes";
import { aggregate } from "./aggregations";
import { applyFilters } from "./filters";

export type QuerySpec = {
  groupBy: string[];
  values: Array<{ field: string; agg: Aggregation; as?: string }>;
  filters: Filter[];
  sort?: { key: string; dir: "asc" | "desc" };
  limit?: number;
};
export type ResultRow = Record<string, string | number | null>;

function measureKey(v: { field: string; agg: Aggregation; as?: string }): string {
  return v.as ?? `${v.agg}_${v.field}`;
}

export function runQuery(rows: Array<Record<string, unknown>>, spec: QuerySpec): ResultRow[] {
  const filtered = applyFilters(rows, spec.filters);
  const grandTotals = new Map<string, number>();
  for (const v of spec.values) {
    if (v.agg === "percentOfTotal") {
      grandTotals.set(measureKey(v), aggregate("sum", filtered.map((r) => r[v.field])));
    }
  }

  const groups = new Map<string, Array<Record<string, unknown>>>();
  if (spec.groupBy.length === 0) {
    groups.set("__all__", filtered);
  } else {
    for (const row of filtered) {
      const key = spec.groupBy.map((g) => String(row[g] ?? "")).join(" ");
      const bucket = groups.get(key);
      if (bucket) bucket.push(row);
      else groups.set(key, [row]);
    }
  }

  let result: ResultRow[] = [...groups.values()].map((bucket) => {
    const out: ResultRow = {};
    for (const g of spec.groupBy) {
      const raw = bucket[0]?.[g];
      out[g] = raw === null || raw === undefined ? null : (raw as string | number);
    }
    for (const v of spec.values) {
      const key = measureKey(v);
      out[key] = aggregate(v.agg, bucket.map((r) => r[v.field]), grandTotals.get(key) ?? 0);
    }
    return out;
  });

  if (spec.sort) {
    const { key, dir } = spec.sort;
    result = [...result].sort((a, b) => {
      const av = a[key];
      const bv = b[key];
      if (av === bv) return 0;
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      const cmp = av < bv ? -1 : 1;
      return dir === "asc" ? cmp : -cmp;
    });
  }
  if (typeof spec.limit === "number") result = result.slice(0, spec.limit);
  return result;
}
```

**File:** `src/data/reportDesigner/query/runQuery.test.ts` (new)

**Before:**
```ts
(new file)
```

**After:**
```ts
import { describe, it, expect } from "vitest";
import { runQuery } from "./runQuery";

const rows = [
  { port: "A", suspicious: true },
  { port: "A", suspicious: false },
  { port: "A", suspicious: true },
  { port: "B", suspicious: false },
];

describe("runQuery", () => {
  it("groups by a dimension and counts", () => {
    const out = runQuery(rows, { groupBy: ["port"], values: [{ field: "port", agg: "count" }], filters: [] });
    expect(out).toEqual([
      { port: "A", count_port: 3 },
      { port: "B", count_port: 1 },
    ]);
  });
  it("sums a boolean measure per group and honours alias", () => {
    const out = runQuery(rows, {
      groupBy: ["port"],
      values: [{ field: "suspicious", agg: "sum", as: "suspiciousCount" }],
      filters: [],
    });
    expect(out).toEqual([
      { port: "A", suspiciousCount: 2 },
      { port: "B", suspiciousCount: 0 },
    ]);
  });
  it("applies filters before grouping", () => {
    const out = runQuery(rows, {
      groupBy: ["port"],
      values: [{ field: "port", agg: "count" }],
      filters: [{ field: "suspicious", op: "truthy", value: null }],
    });
    expect(out).toEqual([{ port: "A", count_port: 2 }]);
  });
  it("sorts then limits (topN)", () => {
    const out = runQuery(rows, {
      groupBy: ["port"],
      values: [{ field: "port", agg: "count" }],
      filters: [],
      sort: { key: "count_port", dir: "desc" },
      limit: 1,
    });
    expect(out).toEqual([{ port: "A", count_port: 3 }]);
  });
  it("returns a single aggregate row when groupBy is empty", () => {
    const out = runQuery(rows, { groupBy: [], values: [{ field: "port", agg: "count" }], filters: [] });
    expect(out).toEqual([{ count_port: 4 }]);
  });
});
```

---

## v7.2 — 2026-06-28 — Report Designer: filter predicates for query engine (FEATURE)

Phase 0, Task 0.3: Create pure filter predicate functions for the report query engine. Implements row filtering via a composable filter array with support for 8 filter operations: equals, notEquals, in, between, contains, truthy, falsy, topN. The topN operation is intentionally a no-op here; topN filtering is applied post-aggregation in the runQuery engine.

**File:** `src/data/reportDesigner/query/filters.ts` (new)

**Before:**
```ts
(new file)
```

**After:**
```ts
import type { Filter } from "../reportTypes";

function matches(value: unknown, f: Filter): boolean {
  switch (f.op) {
    case "equals": return value === f.value;
    case "notEquals": return value !== f.value;
    case "in": return Array.isArray(f.value) && f.value.includes(value as never);
    case "between": {
      if (!Array.isArray(f.value) || typeof value !== "number") return false;
      const [lo, hi] = f.value as [number, number];
      return value >= lo && value <= hi;
    }
    case "contains":
      return String(value ?? "").includes(String(f.value ?? ""));
    case "truthy": return Boolean(value);
    case "falsy": return !value;
    case "topN": return true; // applied post-aggregation in runQuery
    default: return true;
  }
}

export function applyFilters<T extends Record<string, unknown>>(rows: T[], filters: Filter[]): T[] {
  if (!filters.length) return rows;
  return rows.filter((row) => filters.every((f) => matches(row[f.field], f)));
}
```

**File:** `src/data/reportDesigner/query/filters.test.ts` (new)

**Before:**
```ts
(new file)
```

**After:**
```ts
import { describe, it, expect } from "vitest";
import { applyFilters } from "./filters";

const rows = [
  { port: "A", n: 1, ok: true,  note: "alpha" },
  { port: "B", n: 5, ok: false, note: "beta" },
  { port: "A", n: 9, ok: true,  note: "gamma" },
];

describe("applyFilters", () => {
  it("equals", () => {
    expect(applyFilters(rows, [{ field: "port", op: "equals", value: "A" }])).toHaveLength(2);
  });
  it("in", () => {
    expect(applyFilters(rows, [{ field: "port", op: "in", value: ["B"] }])).toHaveLength(1);
  });
  it("notEquals", () => {
    expect(applyFilters(rows, [{ field: "port", op: "notEquals", value: "A" }])).toHaveLength(1);
  });
  it("between (inclusive)", () => {
    expect(applyFilters(rows, [{ field: "n", op: "between", value: [1, 5] }])).toHaveLength(2);
  });
  it("contains (substring)", () => {
    expect(applyFilters(rows, [{ field: "note", op: "contains", value: "et" }])).toHaveLength(1);
  });
  it("truthy / falsy", () => {
    expect(applyFilters(rows, [{ field: "ok", op: "truthy", value: null }])).toHaveLength(2);
    expect(applyFilters(rows, [{ field: "ok", op: "falsy", value: null }])).toHaveLength(1);
  });
  it("AND-composes multiple filters", () => {
    expect(applyFilters(rows, [
      { field: "port", op: "equals", value: "A" },
      { field: "ok", op: "truthy", value: null },
    ])).toHaveLength(2);
  });
  it("ignores topN here", () => {
    expect(applyFilters(rows, [{ field: "n", op: "topN", value: 1 }])).toHaveLength(3);
  });
});
```

---

## v7.1 — 2026-06-28 — Report Designer: aggregation functions for query engine (FEATURE)

Phase 0, Task 0.2: Create pure aggregation functions for the report query engine. Implements the complete set of aggregation operations (count, distinctCount, sum, avg, min, max, percentOfTotal) with proper handling of nulls, booleans, and non-numeric values.

**File:** `src/data/reportDesigner/query/aggregations.ts` (new)

**Before:**
```ts
(new file)
```

**After:**
```ts
import type { Aggregation } from "../reportTypes";

function toNumbers(values: unknown[]): number[] {
  const out: number[] = [];
  for (const v of values) {
    if (typeof v === "number" && Number.isFinite(v)) out.push(v);
    else if (typeof v === "boolean") out.push(v ? 1 : 0);
  }
  return out;
}

export function aggregate(agg: Aggregation, values: unknown[], grandTotal = 0): number {
  switch (agg) {
    case "count":
      return values.length;
    case "distinctCount":
      return new Set(values.filter((v) => v !== null && v !== undefined)).size;
    case "sum":
      return toNumbers(values).reduce((a, b) => a + b, 0);
    case "avg": {
      const nums = toNumbers(values);
      return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
    }
    case "min": {
      const nums = toNumbers(values);
      return nums.length ? Math.min(...nums) : 0;
    }
    case "max": {
      const nums = toNumbers(values);
      return nums.length ? Math.max(...nums) : 0;
    }
    case "percentOfTotal": {
      const sum = toNumbers(values).reduce((a, b) => a + b, 0);
      return grandTotal === 0 ? 0 : (sum / grandTotal) * 100;
    }
    default:
      return 0;
  }
}
```

**File:** `src/data/reportDesigner/query/aggregations.test.ts` (new)

**Before:**
```ts
(new file)
```

**After:**
```ts
import { describe, it, expect } from "vitest";
import { aggregate } from "./aggregations";

describe("aggregate", () => {
  it("counts rows including nulls", () => {
    expect(aggregate("count", [1, null, "x"])).toBe(3);
  });
  it("counts distinct non-null values", () => {
    expect(aggregate("distinctCount", ["a", "a", "b", null])).toBe(2);
  });
  it("sums numeric values, treating true as 1 and ignoring non-numerics", () => {
    expect(aggregate("sum", [2, 3, true, "x", null])).toBe(6);
  });
  it("averages numeric values", () => {
    expect(aggregate("avg", [2, 4, 6])).toBe(4);
  });
  it("returns min and max", () => {
    expect(aggregate("min", [5, 2, 9])).toBe(2);
    expect(aggregate("max", [5, 2, 9])).toBe(9);
  });
  it("computes percent of total from grand total", () => {
    expect(aggregate("percentOfTotal", [25], 100)).toBe(25);
  });
  it("returns 0 for empty avg/sum", () => {
    expect(aggregate("avg", [])).toBe(0);
    expect(aggregate("sum", [])).toBe(0);
  });
});
```

---

## v7.0 — 2026-06-28 — Report Designer: core document model types and factory (FEATURE)

Phase 0, Task 0.1: Create the foundational document model types and factory function for the Report Designer feature. All subsequent Report Designer tasks depend on these types.

Adds:
- Complete type hierarchy: `ReportDocument`, `Page`, `Element`, `ElementConfig` (table/chart/kpi/text/shape/image)
- Support types: `PageSetup`, `ElementStyle`, `Filter`, `FilterOp`, `Aggregation`, `ElementType`
- Constants: `REPORT_SCHEMA_VERSION = 1`, `A4_PORTRAIT` preset
- Factory functions: `createReportId()`, `createPageId()`, `createElementId()`, `createEmptyDocument(name, createdBy)`
- Comprehensive test covering all properties and invariants

**File:** `src/data/reportDesigner/reportTypes.ts` (new)

**Before:**
```ts
(new file)
```

**After:**
```ts
export const REPORT_SCHEMA_VERSION = 1;

export type DocType = "print" | "slides" | "dashboard";
export type PageSizePreset = "A4" | "Letter" | "16:9" | "4:3" | "custom";
export type Orientation = "portrait" | "landscape";

export type Aggregation =
  | "count" | "distinctCount" | "sum" | "avg" | "min" | "max" | "percentOfTotal";

export type FilterOp =
  | "equals" | "in" | "notEquals" | "between" | "contains" | "truthy" | "falsy" | "topN";

export type Filter = { field: string; op: FilterOp; value: unknown };

export type PageSetup = {
  size: PageSizePreset;
  orientation: Orientation;
  width: number;
  height: number;
  margins: { top: number; right: number; bottom: number; left: number };
};

export type ElementType = "table" | "chart" | "kpi" | "text" | "shape" | "image";

export type ElementStyle = {
  fill?: string; borderColor?: string; borderWidth?: number; borderRadius?: number;
  padding?: number; fontFamily?: string; fontSize?: number; fontWeight?: number;
  color?: string; textAlign?: "right" | "center" | "left"; opacity?: number;
};

export type TableConfig = {
  kind: "table";
  dataSourceId: string;
  columns: Array<{ field: string; agg?: Aggregation; sort?: "asc" | "desc"; format?: string; condFormat?: unknown }>;
  groupBy: string[];
  filters: Filter[];
};

export type ChartConfig = {
  kind: "chart";
  chartType: "bar" | "line" | "pie" | "donut" | "area" | "combo" | "scatter";
  dataSourceId: string;
  wells: { axis: string[]; legend?: string; values: Array<{ field: string; agg: Aggregation }> };
  filters: Filter[];
  options: Record<string, unknown>;
};

export type KpiConfig = {
  kind: "kpi";
  dataSourceId: string;
  valueField: string;
  agg: Aggregation;
  target?: number;
  comparison?: "higherBetter" | "lowerBetter";
  format?: string;
};

export type TextConfig = { kind: "text"; text: string };
export type ShapeConfig = { kind: "shape"; shape: "rect" | "line" | "ellipse" | "divider" };
export type ImageConfig = { kind: "image"; dataUrl: string; alt?: string };

export type ElementConfig =
  | TableConfig | ChartConfig | KpiConfig | TextConfig | ShapeConfig | ImageConfig;

export type Element = {
  elementId: string;
  type: ElementType;
  name: string;
  x: number; y: number; w: number; h: number; z: number;
  rotation?: number; locked?: boolean;
  style: ElementStyle;
  config: ElementConfig;
};

export type Page = {
  pageId: string;
  name: string;
  order: number;
  background?: { color?: string; image?: string };
  filters: Filter[];
  elements: Element[];
};

export type DataSourceRef = { id: string; tableId: string; label: string };

export type ReportDocument = {
  reportId: string;
  reportName: string;
  version: number;
  createdAt: string; createdBy: string; updatedAt: string; updatedBy: string;
  docType: DocType;
  pageSetup: PageSetup;
  theme: { palette: string[]; fontFamily: string; defaults: Record<string, unknown> };
  dataSources: DataSourceRef[];
  pages: Page[];
  reportFilters: Filter[];
};

export const A4_PORTRAIT: PageSetup = {
  size: "A4", orientation: "portrait", width: 794, height: 1123,
  margins: { top: 38, right: 38, bottom: 38, left: 38 },
};

export function createReportId(): string { ... }
export function createPageId(): string { ... }
export function createElementId(): string { ... }
export function createEmptyDocument(name: string, createdBy: string): ReportDocument { ... }
```

**File:** `src/data/reportDesigner/reportTypes.test.ts` (new)

**Before:**
```ts
(new file)
```

**After:**
```ts
import { describe, it, expect } from "vitest";
import { createEmptyDocument, REPORT_SCHEMA_VERSION } from "./reportTypes";

describe("createEmptyDocument", () => {
  it("creates a print A4 document with one empty page", () => {
    const doc = createEmptyDocument("تقرير تجريبي", "admin");
    expect(doc.reportName).toBe("تقرير تجريبي");
    expect(doc.createdBy).toBe("admin");
    expect(doc.docType).toBe("print");
    expect(doc.pageSetup.size).toBe("A4");
    expect(doc.pageSetup.orientation).toBe("portrait");
    expect(doc.pages).toHaveLength(1);
    expect(doc.pages[0].elements).toEqual([]);
    expect(doc.reportId).toMatch(/^rpt-/);
    expect(REPORT_SCHEMA_VERSION).toBe(1);
  });
});
```

---

## v6.1 — 2026-06-28 — Incremental content-hashing removes the read-side stringify ceiling (FEATURE)

Completes the symmetry of v6.0. v6.0 removed the **write**-side ceiling, but the
**read** path still recomputed `simpleHash(JSON.stringify(envelope.data))` in
`validateEnvelope` on every read, and `wrap()` did the same full
`JSON.stringify(data)` purely to hash on every non-streamed write. Both built a
second full-size string on top of the source + parsed object graph, so a file
big enough to need a streamed write could be *written* but not *validated on
read*, and every normal read/write paid an extra payload-sized allocation.

Fix: add `hashJsonValue(value)` — `simpleHash(JSON.stringify(value))` computed
incrementally by feeding `streamJsonStringify(value)` chunks into
`createSimpleHasher`. The digest is **identical** to the old expression (the
streamed chunks concatenate to exactly `JSON.stringify(value)`), so on-disk
content hashes are unchanged and existing files keep validating. `wrap()` and
`validateEnvelope()` now both use it: no intermediate full-size string, no
RangeError ceiling, and ~33% lower peak memory on every read (source + objects,
no third hash string).

Residual platform floor (documented, intentionally not engineered around): the
File System Access API's `File.text()` still returns the whole file as one
string, so a single file larger than V8's max string length (~512 M chars,
~0.5–1 GB on disk) cannot be read without a streaming JSON parser. Building a
hand-rolled streaming parser for critical population data — to support sizes
this app's workloads (hundreds of thousands of rows, tens of MB) never reach —
is higher risk than value, so it is left as an explicit non-goal. Every JSON
tool faces the same string limit; this change makes the persistence layer hash
without adding to it.

**File:** `src/data/storage/jsonEnvelope.ts`

**Before:**
```ts
export function wrap<T>(data: T, previousRevision = 0): JsonEnvelope<T> {
  const serialized = JSON.stringify(data);
  return { metadata: { /* ... */ contentHash: simpleHash(serialized) /* ... */ }, data };
}
// ...
return envelope.metadata.contentHash === simpleHash(JSON.stringify(envelope.data));
```

**After:**
```ts
export function hashJsonValue(value: unknown): string {
  const hasher = createSimpleHasher();
  for (const chunk of streamJsonStringify(value)) hasher.update(chunk);
  return hasher.digest();
}

export function wrap<T>(data: T, previousRevision = 0): JsonEnvelope<T> {
  return { metadata: { /* ... */ contentHash: hashJsonValue(data) /* ... */ }, data };
}
// ...
return envelope.metadata.contentHash === hashJsonValue(envelope.data);
```

**File:** `src/data/storage/jsonEnvelope.test.ts` — added coverage: `hashJsonValue`
equals `simpleHash(JSON.stringify(value))` across mixed values, and
`validateEnvelope` round-trips / rejects tampering on a large nested payload.

---

## v6.0 — 2026-06-28 — Streamed safe-writes remove the JSON.stringify string-length ceiling (FEATURE)

Follow-up to v5.40 (which only halved the size by writing large payloads
compact). A truly enormous payload (e.g. millions of rows) can still exceed
V8's max string length (~512 M chars) even compact, because `safeWriteJson`
built the entire serialized envelope as one in-memory string before writing,
and `jsonEnvelope.wrap()` did a second full `JSON.stringify(data)` just to
compute the content hash.

Fix: add a **streamed write path**. When the whole-envelope `JSON.stringify`
throws `RangeError: Invalid string length`, the write falls back to serializing
the `JsonEnvelope` directly to the `FileSystemWritableFileStream` in small
chunks — the `data` value is streamed element-by-element via a new generator
`streamJsonStringify` (byte-identical to compact `JSON.stringify`), so no single
giant string is ever materialized. The content hash is computed **incrementally**
over the streamed `data` chunks (new `createSimpleHasher`), avoiding the extra
full stringify. The file is written as `{"data":<streamed>,"metadata":{…}}` —
data first so the hash is known before the metadata is emitted; key order is
irrelevant to `isEnvelope`/`unwrap`/`validateEnvelope`. Snapshot-and-verify/`.bak`
rollback is preserved: each streamed file is verified by re-reading it and
comparing an exact whole-file content hash + length. The existing small-file
path (pretty-print + re-parse verify) is unchanged; streaming triggers only at
the real V8 ceiling (or, in tests, via an internal size override).

Note: this removes the **write**-side ceiling. The read-side
`validateEnvelope` still does a full `JSON.stringify(envelope.data)`, so a file
larger than the ceiling cannot yet be read back; streamed reads/validation are a
separate follow-up. Realistic payloads (hundreds of thousands of rows, tens of
MB) are far under the ceiling and round-trip on both paths.

**File:** `src/data/storage/jsonEnvelope.ts`

**Before:**
```ts
export function simpleHash(content: string): string {
  let h = 5381;
  for (let i = 0; i < content.length; i++) {
    h = ((h << 5) + h) ^ content.charCodeAt(i);
  }
  return (h >>> 0).toString(16);
}
```

**After:**
```ts
export function createSimpleHasher(): {
  update: (chunk: string) => void;
  digest: () => string;
} {
  let h = 5381;
  return {
    update(chunk) {
      for (let i = 0; i < chunk.length; i++) {
        h = ((h << 5) + h) ^ chunk.charCodeAt(i);
      }
    },
    digest() {
      return (h >>> 0).toString(16);
    },
  };
}

export function simpleHash(content: string): string {
  const hasher = createSimpleHasher();
  hasher.update(content);
  return hasher.digest();
}

// ...plus streamJsonStringify(value) generator that yields compact-JSON chunks
// byte-identical to JSON.stringify(value), recursing into arrays/objects and
// delegating leaves to JSON.stringify.
```

**File:** `src/data/storage/safeWrite.ts`

**Before:**
```ts
const nextValue = isEnvelope(value) ? value : wrap(value, previousRevision);
const compact = JSON.stringify(nextValue);
const skipVerify = compact.length > VERIFY_SIZE_LIMIT;
const serialized = skipVerify
  ? `${compact}\n`
  : `${JSON.stringify(nextValue, null, 2)}\n`;
// ...single string written to tmp then live...
```

**After:**
```ts
// Try the whole-envelope string; if it exceeds V8's ceiling, stream instead.
let compact: string | null = null;
let nextValue: unknown = null;
try {
  nextValue = isEnvelope(value) ? value : wrap(value, previousRevision);
  compact = JSON.stringify(nextValue);
} catch (error) {
  if (!isStringLengthError(error)) throw;
}
if (compact === null || compact.length > streamingForcedSizeLimit) {
  // streamed path: streamEnvelopeToFile(...) to .tmp then live, each verified
  // by exact whole-file content hash; .bak snapshot + rollback preserved.
} else {
  // unchanged small-file path using `compact` / pretty-print
}
```

**File:** `src/data/storage/safeWrite.test.ts` — added coverage: streamed path round-trips and is byte-identical to the non-streamed envelope; streamed writes snapshot to `.bak` and increment revision; `streamJsonStringify` matches `JSON.stringify` across mixed values; `createSimpleHasher` chunked == `simpleHash` whole.

---

## v5.40 — 2026-06-28 — Fix "Invalid string length" when saving large processed data (BUG)

Root cause: saving a large processed population (e.g. ~300k rows) failed with
the on-screen message `فشل الحفظ: Invalid string length`. `saveMonthRun`
(`populationStorage.ts`) catches any error and returns `{ ok:false, error:
error.message }`, which the Population tab renders verbatim. The error came from
`safeWriteJson` → `JSON.stringify(nextValue, null, 2)` in `safeWrite.ts`:
pretty-printing inflates the output and, for very large arrays, pushes it past
V8's max string length (~512 MiB), throwing `RangeError: Invalid string length`.
This is the write-side twin of the 300k-row parse bug fixed in v5.36.

Fix: serialize compactly once; only re-serialize with 2-space indentation when
the compact result is small enough (≤ `VERIFY_SIZE_LIMIT`, 512 KB) to stay well
under the ceiling. Small machine files stay human-readable; large files are
written compact (≈half the size), removing the proximate trigger. Note: a
truly enormous population could still exceed the ceiling even compact — the full
cure is streamed writes, tracked separately as a follow-up.

**File:** `src/data/storage/safeWrite.ts` (both `safeWriteJson` and `safeWriteJsonText`)

**Before:**
```ts
const serialized = `${JSON.stringify(nextValue, null, 2)}\n`;
const skipVerify = serialized.length > VERIFY_SIZE_LIMIT;
```

**After:**
```ts
// Pretty-print keeps small machine files readable, but indentation can push a
// large payload past V8's max string length (RangeError: Invalid string
// length). Serialize compactly first; only indent when small enough.
const compact = JSON.stringify(nextValue);
const skipVerify = compact.length > VERIFY_SIZE_LIMIT;
const serialized = skipVerify
  ? `${compact}\n`
  : `${JSON.stringify(nextValue, null, 2)}\n`;
```

**File:** `src/data/storage/safeWrite.test.ts` — added coverage: large payloads are written compact and round-trip; small payloads stay pretty-printed.

---

## v5.39 — 2026-06-28 — Handle floating-promise rejections in data loaders (ERR-01)

Audit finding ERR-01: 13 fire-and-forget data loaders across 6 files used
`void X.then(...)` (some with `.finally`) but no `.catch`. A rejected load
(e.g. workspace read failure) became an **unhandled promise rejection** with no
log entry and no recovery. Added a `logRejection(context)` helper to
`errorLogger.ts` and a `.catch(logRejection(...))` to each site. On failure the
state now stays at its safe initial value and the error is recorded in the
in-memory ring buffer (visible via `getRecentErrors`). Sites already having a
`.catch` (e.g. `listMonthFolders` in Population, browse-preset/browse-row loads)
were left unchanged.

**File:** `src/data/storage/errorLogger.ts`

**Before:**
```ts
export function clearErrors(): void {
  entries.length = 0;
}
```

**After:**
```ts
export function clearErrors(): void {
  entries.length = 0;
}

/**
 * `.catch` handler for intentionally fire-and-forget promises: logs the
 * rejection to the ring buffer instead of leaving it unhandled. State simply
 * isn't updated on failure (safe degradation).
 */
export function logRejection(context: string): (error: unknown) => void {
  return (error: unknown) => logError(context, error);
}
```

**Files patched (added `.catch(logRejection("<context>"))`):**
- `Population/index.tsx` — loadPopulationConfig, loadCertScanGlobal
- `UserManagement/index.tsx` — readAuthActivityLog (effect + refresh button)
- `EmployeeWorkspace/views/XrayReferrals.tsx` — listMonthFolders, loadTemplateIndex, loadInspectionTemplateSelection, loadPopulationConfig, Promise.all(browse presets)
- `EmployeeWorkspace/views/EmployeeDashboard.tsx` — listMonthFolders, loadTemplateIndex
- `Reports/index.tsx` — listMonthFolders
- `TemplateBuilder/index.tsx` — loadTemplateIndex

---

## v5.38 — 2026-06-28 — Fix CLAUDE.md documentation drift (DOC-01)

Audit finding DOC-01: three confirmed drifts in `CLAUDE.md`. (1) Bundle size
said "~942 kB, 286 kB gzip"; actual `vite build` output is 1.9 MB / 664 kB gzip.
(2) Disk-layout block documented the legacy `Population/`, `templates/`, `.system/`
roots; the code now uses numbered roots `1-Population/`…`6-Templates/` with legacy
fallbacks (correctly described in `docs/data-system-report.md`). (3) Session
description said "runtime-only … no localStorage"; it is now `sessionStorage`
(see v5.37 / SEC-02). Documentation-only change — no code touched.

**File:** `CLAUDE.md` (build-size line, disk-layout section, session bullet)

---

## v5.37 — 2026-06-28 — Session storage moved from localStorage to sessionStorage (SEC-02)

Audit finding SEC-02: `authSession.ts` persisted the auth session to
`localStorage` (7-day TTL), but `CLAUDE.md` and `docs/data-system-report.md`
both claimed the session was runtime-only and lost on reload — code and docs
disagreed. On a shared radiology workstation a 7-day persisted admin session is
a walk-up-takeover risk. Decision: persist to `sessionStorage` instead, so the
session survives an accidental page reload but auto-clears on tab/browser close,
shrinking the exposure window. The 7-day TTL remains as a secondary guard. This
is a UX convenience, NOT a security control (the client-only trust model still
applies — see SEC-01).

**File:** `src/auth/authSession.ts`

**Before:**
```ts
function readStoredSession(): AuthSession | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isValidSession(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeStoredSession(session: AuthSession): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Runtime session still works even when browser storage is unavailable.
  }
}

function clearStoredSession(): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
}
```

**After:**
```ts
// SEC-02: the session is persisted to sessionStorage (not localStorage) so it
// survives a page reload but auto-clears when the tab/browser closes. This is a
// UX convenience, not a security control — with the client-only trust model a
// user can still forge this object (see SEC-01 / CLAUDE.md security note).
function sessionStore(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

function readStoredSession(): AuthSession | null {
  try {
    const store = sessionStore();
    if (!store) return null;
    const raw = store.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isValidSession(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeStoredSession(session: AuthSession): void {
  try {
    sessionStore()?.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Runtime session still works even when browser storage is unavailable.
  }
}

function clearStoredSession(): void {
  try {
    sessionStore()?.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
}
```

---

## v5.36 — 2026-06-25 — Fix 300k-row BI parse failure (stack overflow + memory)

Root cause: `allRows.push(...validRows)` spreads up to 300k arguments, exceeding
V8's call-stack argument limit (`RangeError: Maximum call stack size exceeded`).
The worker's soft-catch catches it silently, sets `biResult = null`, and Phase 2
shows "not read correctly." Same latent bug in riskDataWorkbook.ts at the same
call site. Secondary improvements: `for...in` in `preprocessLargeNumbers` avoids
a 6M-element intermediate string array; worksheets freed after parsing to lower
peak heap in the worker; BI warning now includes the actual error message.

**File:** `src/components/Sidebar/Tabs/Population/biData/biDataWorkbook.ts`

**Before:**
```ts
normalizedRows.push(...mappedChunk);
// ...
allRows.push(...validRows);
```

**After:**
```ts
for (const row of mappedChunk) normalizedRows.push(row);
// ...
// free worksheet immediately — GC can collect 6M cell objects
delete workbook.Sheets[sheetName];
// ...
for (const row of validRows) allRows.push(row);
```

---

**File:** `src/components/Sidebar/Tabs/Population/riskData/riskDataWorkbook.ts`

**Before:**
```ts
normalizedRows.push(...mappedChunk);
// ...
allRows.push(...validRows);
```

**After:**
```ts
for (const row of mappedChunk) normalizedRows.push(row);
// ...
delete workbook.Sheets[sheetName];
// ...
for (const row of validRows) allRows.push(row);
```

---

**File:** `src/components/Sidebar/Tabs/Population/workbook/worksheetRows.ts`

**Before:**
```ts
for (const cellRef of Object.keys(worksheet)) {
```

**After:**
```ts
for (const cellRef in worksheet) {
```

---

**File:** `src/workers/workbookWorker.ts`

**Before:**
```ts
} catch {
  warning = "تمت قراءة بيانات وكالة المخاطر، ولكن تعذر قراءة ملف ذكاء الأعمال...";
}
```

**After:**
```ts
} catch (biErr) {
  const detail = biErr instanceof Error ? ` (${biErr.message})` : "";
  warning = `تمت قراءة بيانات وكالة المخاطر، ولكن تعذر قراءة ملف ذكاء الأعمال${detail}. يمكنك المتابعة لأن ملف ذكاء الأعمال داعم وليس شرطاً.`;
}
```

---

## v5.35 — 2026-06-25 — Remove panel-position toggle; fix col-picker portal positioning; patch employeeXlsx write cast

**File:** `src/data/answers/employeeXlsx.ts`

**Before:**
```ts
await writable.write(buf);
```

**After:**
```ts
await (writable as unknown as { write: (data: unknown) => Promise<void> }).write(buf);
```

---

**File:** `src/components/DataTable/DataTable.css`

**Before:**
```css
.dt-col-picker {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 400;
  width: 300px;
  ...
}
```

**After:**
```css
.dt-col-picker {
  width: 300px;
  ...
}
```

---

**File:** `src/components/DataTable/index.tsx`

**Before:**
```tsx
// ColPickerPanel rendered inside relative-positioned wrapper; no anchorRect
<div style={{ position: "relative" }}>
  <button onClick={() => { setColPickerOpen((o) => !o); ... }}>
  {colPickerOpen && <ColPickerPanel ... />}
</div>
```

**After:**
```tsx
// ColPickerPanel rendered as fixed portal outside the toolbar
<div>
  <button onClick={(event) => {
    setColPickerAnchorRect(event.currentTarget.getBoundingClientRect());
    setColPickerOpen((open) => !open);
    ...
  }}>
</div>
// rendered after toolbar:
{colPickerOpen && colPickerAnchorRect && (
  <ColPickerPanel anchorRect={colPickerAnchorRect} ... />
)}
// inside ColPickerPanel:
const style: CSSProperties = {
  position: "fixed",
  top: anchorRect.bottom + 6,
  left: Math.max(8, Math.min(anchorRect.left, window.innerWidth - pickerWidth - 8)),
  zIndex: 9999,
};
```

---

**File:** `src/components/InspectionPanel/InspectionPanel.css`

**Before:**
```css
.ip-panel--bottom {
  width: 100%;
  flex: 0 0 42%;
  height: auto;
  min-height: 260px;
  flex-shrink: 0;
}
```

**After:** *(removed — panel always renders as right panel)*

---

**File:** `src/components/InspectionPanel/PanelHeader.tsx`

**Before:**
```tsx
import { PanelBottom, PanelRight, X } from "lucide-react";
type PanelPosition = "right" | "bottom";
type Props = { ...; panelPosition: PanelPosition; onTogglePosition: () => void; onClose: () => void; };
// toggle button rendered in header controls
```

**After:**
```tsx
import { X } from "lucide-react";
type Props = { ...; onClose: () => void; };
// toggle button removed
```

---

**File:** `src/components/InspectionPanel/index.tsx`

**Before:**
```tsx
export type PanelPosition = "right" | "bottom";
type Props = { ...; panelPosition: PanelPosition; onTogglePosition: () => void; ... };
<aside className={`ip-panel ip-panel--${panelPosition}`} ...>
```

**After:**
```tsx
// PanelPosition type removed; props removed; hardcoded to right
<aside className="ip-panel ip-panel--right" ...>
```

---

**File:** `src/components/Sidebar/Tabs/EmployeeWorkspace/EmployeeWorkspace.css`

**Before:**
```css
.ew-split--bottom { ... }
.ew-split--bottom .dt-table-wrap { ... }
.ew-split--right .dt-table-wrap .dt-table,
.ew-split--bottom .dt-table-wrap .dt-table { table-layout: fixed; min-width: 980px; }
```

**After:**
```css
.ew-split--right .dt-table-wrap .dt-table { table-layout: fixed; min-width: 980px; }
```

---

**File:** `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx`

**Before:**
```tsx
import { saveInspectionPanelPosition, type InspectionPanelPosition } from "...";
const [panelPosition, setPanelPosition] = useState<InspectionPanelPosition>("right");
// loaded from user preset on mount
// toggle handler calling saveInspectionPanelPosition
<div className={`ew-split ew-split--${selEntry ? panelPosition : "right"}...`}>
<SampleDetailPanel panelPosition={panelPosition} onTogglePosition={...} ...>
```

**After:**
```tsx
// panelPosition state removed; toggle removed
<div className={`ew-split ew-split--right${selEntry ? "" : " ew-split--empty"}`}>
<SampleDetailPanel ...> // without position props
```

---

**File:** `src/data/preferences/browsePresetStorage.ts`

**Before:**
```ts
export type InspectionPanelPosition = "right" | "bottom";
export type UserBrowsePresetFile = { ...; inspectionPanelPosition?: InspectionPanelPosition; };
export async function saveInspectionPanelPosition(...): Promise<void> { ... }
```

**After:**
```ts
// InspectionPanelPosition type removed
export type UserBrowsePresetFile = { username: string; browseData: ...; };
// saveInspectionPanelPosition removed
```

---

## v5.34 — 2026-06-25 — replace hand-coded sidebar SVG icons with Lucide stroke icons

**Files:** all 6 sidebar tab index.tsx files (Population, EmployeeWorkspace, Reports, Archive, UserManagement, Settings)

Replace filled blob SVG icon functions with Lucide React stroke icons for consistent, crisp rendering on the dark sidebar background. Icons chosen: ScanLine (population), LayoutDashboard (workspace), BarChart3 (reports), Archive (archive), UserCog (user management), Settings (settings). Stroke weight 1.8, size 20.

---

## v5.33 — 2026-06-25 — add per-employee XLSX export on distribution and completion

**File:** `src/data/answers/employeeXlsx.ts` (new)

Creates `{username}.xlsx` in the `2-Employees` workspace folder when distribution events are applied (initial creation) and overwrites it with answers when the employee submits their last assigned sample.

**File:** `src/components/Sidebar/Tabs/Population/index.tsx`

**Before (handleApplyBulkAssignment success block):**
```ts
if (result.ok) {
  await refreshDistribution(monthFolderName);
  setDistributionMessage({ type: "ok", text: "تم تطبيق وحفظ التوزيع الجماعي بنجاح." });
}
```

**After:**
```ts
if (result.ok) {
  await refreshDistribution(monthFolderName);
  // fire-and-forget XLSX creation per assigned employee
  const rowMap = new Map(sampleDrawResult.rows.map((r) => [r.xrayImageId, r]));
  const assignedMap = new Map<string, DistributionEntry[]>();
  for (const ev of events) {
    if (ev.eventType !== "assigned") continue;
    const row = rowMap.get(ev.xrayImageId);
    if (!row) continue;
    const entry: DistributionEntry = { xrayImageId: ev.xrayImageId, assignedTo: ev.assignedTo, status: "pending", replacedById: null, lastEventAt: ev.eventAt, row };
    const list = assignedMap.get(ev.assignedTo) ?? [];
    list.push(entry);
    assignedMap.set(ev.assignedTo, list);
  }
  for (const [emp, empEntries] of assignedMap) {
    void writeEmployeeXlsx(directoryHandle, monthFolderName, emp, empEntries).catch(() => undefined);
  }
  setDistributionMessage({ type: "ok", text: "تم تطبيق وحفظ التوزيع الجماعي بنجاح." });
}
```

**File:** `src/components/Sidebar/Tabs/EmployeeWorkspace/views/EmployeeDashboard.tsx`

**Before (handleSaveAnswers success block):**
```ts
if (result.ok) {
  setSavedAnswers((prev) => {
    const others = prev.filter((a) => a.xrayImageId !== xrayImageId);
    return [...others, item];
  });
  setStatusMessage({ type: "ok", text: submit ? "تم تقديم الإجابات." : "تم حفظ المسودة." });
}
```

**After:**
```ts
if (result.ok) {
  const nextAnswers = [...savedAnswers.filter((a) => a.xrayImageId !== xrayImageId), item];
  setSavedAnswers(nextAnswers);
  setStatusMessage({ type: "ok", text: submit ? "تم تقديم الإجابات." : "تم حفظ المسودة." });
  if (submit) {
    const allSubmitted = myEntries.length > 0 &&
      myEntries.every((e) => nextAnswers.find((a) => a.xrayImageId === e.xrayImageId)?.status === "submitted");
    if (allSubmitted) {
      void writeEmployeeXlsx(directoryHandle, selectedMonth, username, myEntries, nextAnswers).catch(() => undefined);
    }
  }
}
```

---

## v5.32 — 2026-06-25 — fix TS2345 type errors in PhaseThreeSampling handleRuleChange call sites

**File:** `src/components/Sidebar/Tabs/Population/components/PhaseThreeSampling.tsx`

**Before (line 143 — TS2345: string not assignable to union):**
```ts
handleRuleChange(rule.stageKey, "method", e.target.value)
```

**After:**
```ts
handleRuleChange(rule.stageKey, "method", e.target.value as StageSamplingRule[keyof StageSamplingRule])
```

**Before (line 184 — TS2345: string not assignable to union):**
```ts
handleRuleChange(rule.stageKey, "certScanMethod", e.target.value)
```

**After:**
```ts
handleRuleChange(rule.stageKey, "certScanMethod", e.target.value as StageSamplingRule[keyof StageSamplingRule])
```

---

## v5.31 — 2026-06-25 — resolve 6 residual ESLint errors (any, unused-vars, control-regex, set-state-in-effect)

**File:** `src/components/Sidebar/Tabs/Population/index.tsx`

**Before (line 353 — no-explicit-any):**
```ts
    useState<any | null>(null); // SampleMasterData
```

**After:**
```ts
    useState<SampleMasterData | null>(null);
```

---

**Before (line 626 — unused variable 'e'):**
```ts
    } catch (e) {
```

**After:**
```ts
    } catch {
```

---

**Before (line 714 — unused variable '_rawRow'):**
```ts
          ({ rawRow: _rawRow, ...rest }) => rest
```

**After:**
```ts
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          ({ rawRow: _rawRow, ...rest }) => rest
```

*(Destructure must name the key to omit it; suppression comment is the correct fix.)*

---

**Before (line 1832 — no-control-regex):**
```ts
  return value.replace(/[<>:"/\\|?*-]+/g, "-").replace(/\s+/g, "_");
```

**After:**
```ts
  return value.replace(/[<>:"/\\|?* -]+/g, "-").replace(/\s+/g, "_");
```

---

**File:** `src/components/Sidebar/Tabs/Reports/index.tsx`

**Before (line 88 — react-hooks/set-state-in-effect):**
```ts
    if (!directoryHandle || !selectedMonth) { setMonthMeta(null); return; }
    setMonthMeta(null);
```

**After:**
```ts
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync null-clear when workspace or month is deselected; synchronizes with external workspace state
    if (!directoryHandle || !selectedMonth) { setMonthMeta(null); return; }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clear stale data before async reload
    setMonthMeta(null);
```

---

**File:** `src/data/reporting/executiveReport.ts`

**Before (line 363 — unused variable '_monthLabel'):**
```ts
function slide4(kpis: ExecutiveKPIs, _monthLabel: string): string {
```

**After:**
```ts
function slide4(kpis: ExecutiveKPIs, _monthLabel: string): string { // eslint-disable-line @typescript-eslint/no-unused-vars
```

*(Parameter must remain in the signature to match the call site; inline suppression is the correct fix.)*

---

## v5.30 — 2026-06-25 — bump version to 1.0.0

**File:** `package.json`

**Before:**
```json
"version": "0.0.0",
```

**After:**
```json
"version": "1.0.0",
```

---

## v5.29 — 2026-06-25 — Write complete README.md

**File:** `README.md`

**Before:**
```markdown
# XQAP---XRay-Quality-Assurance-Platform
```

**After:** (see README.md for full content)
Replaced with comprehensive project README covering: project title and description, browser requirements (Chromium-only), prerequisites, quick start, build instructions, available commands, architecture overview, user workflow (4 phases), workspace folder layout, authentication & roles, key features, development notes, and support documentation.

---

## v5.28 — 2026-06-25 — Remove unused parameters from DataTable col-config helpers

**File:** `src/components/DataTable/index.tsx`

**Before:**
```ts
function loadColConfig<TRow>(
  _storageKey: string,
  columns: DataTableCol<TRow>[],
  defaultVisible?: string[]
): ColConfig {
  return buildDefault(columns, defaultVisible);
}

function saveColConfig(_storageKey: string, _cfg: ColConfig): void {
  // Durable table preferences should be saved through onColConfigChange.
}
```

**After:**
```ts
function loadColConfig<TRow>(
  columns: DataTableCol<TRow>[],
  defaultVisible?: string[]
): ColConfig {
  return buildDefault(columns, defaultVisible);
}

function saveColConfig(): void {
  // Durable table preferences should be saved through onColConfigChange.
}
```

**Call site change (line ~220):**
```ts
// Before:
return loadColConfig(storageKey, columns, defaultVisible);

// After:
return loadColConfig(columns, defaultVisible);
```

**Call site change (line ~260, ~273):**
```ts
// Before:
saveColConfig(storageKey, c);
// ...
saveColConfig(storageKey, initialColConfig);

// After:
saveColConfig();
// ...
saveColConfig();
```

---

**File:** `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx`

**Before:**
```ts
function loadLocalColConfig(_columns: DataTableCol<DistributionEntry>[]): ColConfig | null {
  return null;
}
```

**After:**
```ts
function loadLocalColConfig(): ColConfig | null {
  return null;
}
```

**Call site change (line ~317):**
```ts
// Before:
() => colPreset ?? loadLocalColConfig(columns) ?? buildDefaultColConfig(columns),

// After:
() => colPreset ?? loadLocalColConfig() ?? buildDefaultColConfig(columns),
```

---

**File:** `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayInspectionResults.tsx`

**Before:**
```ts
function loadLocalReferralColConfig(_sampleColumns: DataTableCol<DistributionEntry>[]): ColConfig | null {
  return null;
}
```

**After:**
```ts
function loadLocalReferralColConfig(): ColConfig | null {
  return null;
}
```

**Call site change (line ~176):**
```ts
// Before:
setReferralColConfig(loadLocalReferralColConfig(sampleColumns) ?? buildDefaultReferralColConfig(sampleColumns));

// After:
setReferralColConfig(loadLocalReferralColConfig() ?? buildDefaultReferralColConfig(sampleColumns));
```

---

## v5.27 — 2026-06-25 — Extract DataTable non-component exports to utils.ts to fix fast-refresh boundary

**File:** `src/components/DataTable/utils.ts` (new file)

**Before:**
```ts
// (file did not exist)
```

**After:**
```ts
// Shared utilities extracted from DataTable/index.tsx to avoid fast-refresh boundary pollution.
export type DateFormatMode = "date" | "time" | "month" | "datetime";
export const DATE_FORMAT_LABELS: Record<DateFormatMode, string> = { ... };
export function looksLikeDate(v: string): boolean { ... }
export function formatDate(raw: string, mode: DateFormatMode): string { ... }
export function toIsoDate(raw: string): string { ... }
export function isFilterEmpty(f: AnyFilter): boolean { ... }
```

---

**File:** `src/components/DataTable/index.tsx`

**Before:**
```ts
export type DateFormatMode = "date" | "time" | "month" | "datetime";

export const DATE_FORMAT_LABELS: Record<DateFormatMode, string> = {
  date:     "التاريخ",
  time:     "الوقت",
  month:    "الشهر",
  datetime: "التاريخ والوقت",
};
// ...
const ISO_DATE_RE  = /^\d{4}-\d{2}-\d{2}(T|\s)\d{2}:\d{2}/;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function looksLikeDate(v: string): boolean { ... }
export function formatDate(raw: string, mode: DateFormatMode): string { ... }
function toIsoDate(raw: string): string { ... }
// ...
export function isFilterEmpty(f: AnyFilter): boolean { ... }
```

**After:**
```ts
import { DateFormatMode, DATE_FORMAT_LABELS, looksLikeDate, formatDate, toIsoDate, isFilterEmpty } from "./utils";
// (definitions removed from this file)
```

---

**File:** `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx`

**Before:**
```ts
} from "../../../../../components/DataTable";
```

**After:**
```ts
} from "../../../../../components/DataTable";
// formatDate, looksLikeDate, DateFormatMode imported from utils
```

---

**File:** `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayInspectionResults.tsx`

**Before:**
```ts
} from "../../../../../components/DataTable";
```

**After:**
```ts
// formatDate, looksLikeDate, DateFormatMode re-pointed to utils
```

---

## v5.26 — 2026-06-25 — Suppress set-state-in-effect for async-load and cleanup effects across 3 files

**File:** `src/components/FeedbackWidget/FeedbackWidget.tsx`

**Before:**
```ts
useEffect(() => {
  if (open) void refresh();
}, [open, refresh]);
```

**After:**
```ts
useEffect(() => {
  // eslint-disable-next-line react-hooks/set-state-in-effect -- async refresh; setState fires inside the async callback, not synchronously in the effect body
  if (open) void refresh();
}, [open, refresh]);
```

---

**File:** `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx`

**Before (effect ~272 — initial data load):**
```ts
  }, [baseColumns, directoryHandle, username]);
```
*(eslint-disable-next-line for exhaustive-deps added above this line to suppress applyTemplate missing dep)*

**Before (auto-select effect ~333):**
```ts
    if (!valid) setSelEntryId(displayEntries[0].xrayImageId);
```

**After (auto-select effect ~333):**
```ts
    // eslint-disable-next-line react-hooks/set-state-in-effect -- auto-corrects selection when the display list changes; useMemo cannot accumulate user navigation state
    if (!valid) setSelEntryId(displayEntries[0].xrayImageId);
```

**Before (async data load effect ~419):**
```ts
  useEffect(() => { void loadData(); }, [loadData]);
```

**After (async data load effect ~419):**
```ts
  // eslint-disable-next-line react-hooks/set-state-in-effect -- async data load; setState fires inside loadData's async callback, not synchronously in the effect body
  useEffect(() => { void loadData(); }, [loadData]);
```

---

**File:** `src/components/Sidebar/Tabs/Population/index.tsx`

**Before (sync reset ~181):**
```ts
  } else {
    setConfig(DEFAULT_POPULATION_CONFIG);
  }
```

**After (sync reset ~181):**
```ts
  } else {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync reset when workspace is disconnected; synchronizing with the FSA external system is the correct use of effects
    setConfig(DEFAULT_POPULATION_CONFIG);
  }
```

**Before (sync cleanup ~193):**
```ts
  if (!directoryHandle) {
    setExistingMonths([]);
    return;
  }
```

**After (sync cleanup ~193):**
```ts
  if (!directoryHandle) {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync cleanup when workspace is removed; effect correctly synchronizes with File System Access API
    setExistingMonths([]);
    return;
  }
```

---

## v5.25 — 2026-06-25 — Suppress set-state-in-effect for tab accumulation effects in App.tsx

**File:** `src/App.tsx`

**Before (Effect 1):**
```ts
useEffect(() => {
  if (activeTabId) {
    setMountedTabIds((prev) =>
      prev.has(activeTabId) ? prev : new Set([...prev, activeTabId])
    );
  }
}, [activeTabId]);
```

**After (Effect 1):**
```ts
useEffect(() => {
  if (activeTabId) {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- accumulates visited tabs; useMemo cannot grow a Set across renders, making this effect the correct pattern
    setMountedTabIds((prev) =>
      prev.has(activeTabId) ? prev : new Set([...prev, activeTabId])
    );
  }
}, [activeTabId]);
```

**Before (Effect 2):**
```ts
// Drop tabs that are no longer allowed (role change)
useEffect(() => {
  const allowedIds = new Set(allowedTabs.map((t) => t.id));
  setMountedTabIds((prev) => {
    const next = new Set([...prev].filter((id) => allowedIds.has(id)));
    return next.size !== prev.size ? next : prev;
  });
}, [allowedTabs]);
```

**After (Effect 2):**
```ts
// Drop tabs that are no longer allowed (role change)
useEffect(() => {
  const allowedIds = new Set(allowedTabs.map((t) => t.id));
  // eslint-disable-next-line react-hooks/set-state-in-effect -- prunes stale tab refs on role change; set updater ensures a single re-render
  setMountedTabIds((prev) => {
    const next = new Set([...prev].filter((id) => allowedIds.has(id)));
    return next.size !== prev.size ? next : prev;
  });
}, [allowedTabs]);
```

---

## v5.24 — 2026-06-25 — Replace initialization effect with lazy useState in CertScanGrid

**File:** `src/components/Sidebar/Tabs/Population/components/CertScanGrid.tsx`

**Before:**
```ts
const [gridData, setGridData] = useState<string[][]>([]);
const [portCol, setPortCol] = useState<number | null>(null);
const [snCol, setSnCol] = useState<number | null>(null);
const [activeHL, setActiveHL] = useState<HighlightType>(null);
const pasteRef = useRef<HTMLDivElement>(null);
const initialised = useRef(false);

// Load from initialText once
useEffect(() => {
  if (initialised.current) return;
  if (!initialText) return;
  const parsed = parseStoredText(initialText);
  if (parsed) {
    setGridData(parsed.data);
    setPortCol(parsed.portCol);
    setSnCol(parsed.snCol);
    initialised.current = true;
  }
}, [initialText]);
```

**After:**
```ts
const parsed0 = parseStoredText(initialText ?? "");

const [gridData, setGridData] = useState<string[][]>(() => parsed0?.data ?? []);
const [portCol, setPortCol] = useState<number | null>(() => parsed0?.portCol ?? null);
const [snCol, setSnCol] = useState<number | null>(() => parsed0?.snCol ?? null);
const [activeHL, setActiveHL] = useState<HighlightType>(null);
const pasteRef = useRef<HTMLDivElement>(null);
// Removed: initialised ref and initialization useEffect
```

---

## v5.23 — 2026-06-25 — Fix set-state-in-effect and purity violations in MappingSettingsModal

**File:** `src/components/Sidebar/Tabs/Population/components/MappingSettingsModal.tsx`

**Before (Fix A — set-state-in-effect):**
```ts
useEffect(() => {
  if (!isOpen) return;
  setActiveTab(mode === "processing" ? "processing" : "mappings");
}, [isOpen, mode]);
```

**After (Fix A):**
```ts
useEffect(() => {
  if (!isOpen) return;
  // eslint-disable-next-line react-hooks/set-state-in-effect -- resets the active tab each time the modal opens; component stays mounted between open/close (hooks called before the early return), so effect is the correct mechanism
  setActiveTab(mode === "processing" ? "processing" : "mappings");
}, [isOpen, mode]);
```

**Before (Fix B — purity: Date.now() in handleAddWorkflowStep and handleInsertWorkflowStepAfter):**
```ts
stepId: `custom-${Date.now()}`,
```
(appears at lines 256 and 290)

**After (Fix B):**
```ts
stepId: `custom-${crypto.randomUUID().slice(0, 8)}`,
```

---

## v5.22 — 2026-06-25 — Replace set-state-in-effect in InspectionPanel with derived safeActivePhaseId

**File:** `src/components/InspectionPanel/index.tsx`

**Before:**
```ts
import { useEffect, useMemo, useState } from "react";

// Effect 1 (lines 59-67): reset activePhaseId when phase no longer in phases array
useEffect(() => {
  if (phases.length === 0) {
    setActivePhaseId("");
    return;
  }
  if (!phases.some((phase) => phase.phaseId === activePhaseId)) {
    setActivePhaseId(phases[0]!.phaseId);
  }
}, [activePhaseId, phases]);

// Effect 2 (lines 93-96): jump to first incomplete phase when current is disabled
useEffect(() => {
  if (!template || !activePhaseId || enabledPhaseIds.has(activePhaseId)) return;
  setActivePhaseId(phaseValidation.firstIncompletePhaseId ?? phases[0]?.phaseId ?? "");
}, [activePhaseId, enabledPhaseIds, phaseValidation.firstIncompletePhaseId, phases, template]);

// JSX uses activePhaseId directly
<PhaseStepper activePhaseId={activePhaseId} ... />
<EditView activePhaseId={activePhaseId} ... />
```

**After:**
```ts
import { useMemo, useState } from "react";

// Derived constant replaces both effects
const safeActivePhaseId: string = (() => {
  if (phases.length === 0) return "";
  if (phases.some((p) => p.phaseId === activePhaseId)) {
    if (template && !enabledPhaseIds.has(activePhaseId)) {
      return phaseValidation.firstIncompletePhaseId ?? phases[0]!.phaseId;
    }
    return activePhaseId;
  }
  return phases[0]!.phaseId;
})();

// JSX uses safeActivePhaseId for rendering
<PhaseStepper activePhaseId={safeActivePhaseId} ... />
<EditView activePhaseId={safeActivePhaseId} ... />
```

---

## v5.20 — 2026-06-25 — Type PhaseThreeSampling props and fix prefer-const

**File:** `src/components/Sidebar/Tabs/Population/components/PhaseThreeSampling.tsx`

**Before:**
```ts
// Fix A — import line and prop type (line 1-2, 11)
import type { SampleMasterData } from "../../../../../data/sampling/sampleTypes";
import type { PopulationConfig, StageSamplingRule } from "../../../../../data/population/populationConfig";

type PhaseThreeSamplingProps = {
  populationRows: any[];

// Fix B — handleRuleChange value parameter (line 54)
  const handleRuleChange = (
    stageKey: "first" | "second" | "third" | "fourth",
    field: keyof StageSamplingRule,
    value: any
  ) => {

// Fix C — calculatedCount variable (line 78)
            let calculatedCount =
              rule.method === "percentage"
                ? Math.round((rule.value / 100) * size)
                : rule.value;
```

**After:**
```ts
// Fix A — add import and type populationRows
import type { PreparedPopulationRow } from "../../../../../data/population/populationTypes";
import type { SampleMasterData } from "../../../../../data/sampling/sampleTypes";
import type { PopulationConfig, StageSamplingRule } from "../../../../../data/population/populationConfig";

type PhaseThreeSamplingProps = {
  populationRows: PreparedPopulationRow[];

// Fix B — type value parameter
  const handleRuleChange = (
    stageKey: "first" | "second" | "third" | "fourth",
    field: keyof StageSamplingRule,
    value: StageSamplingRule[keyof StageSamplingRule]
  ) => {

// Fix C — use const (not reassigned)
            const calculatedCount =
              rule.method === "percentage"
                ? Math.round((rule.value / 100) * size)
                : rule.value;
```

---

## v5.21 — 2026-06-25 — Replace useState+useEffect for detectedDates with useMemo; suppress column-resize immutability lint

**File:** `src/components/DataTable/index.tsx`

**Before (Task 4 — detectedDates state + effect):**
```ts
const [detectedDates, setDetectedDates] = useState<Set<string>>(new Set());

// Auto-detect date columns from first 10 rows
useEffect(() => {
  const sample = rows.slice(0, 10);
  const detected = new Set<string>();
  for (const col of columns) {
    if (col.isDate) { detected.add(col.id); continue; }
    if (col.filterKind === "status") continue;
    for (const row of sample) {
      const v = col.accessor(row);
      if (v && looksLikeDate(v)) { detected.add(col.id); break; }
    }
  }
  setDetectedDates(detected);
}, [rows, columns]);
```

**After (Task 4 — useMemo, samples 200 rows):**
```ts
const detectedDates = useMemo<Set<string>>(() => {
  const sample = rows.length > 200 ? rows.slice(0, 200) : rows;
  const detected = new Set<string>();
  for (const col of columns) {
    if (col.isDate) { detected.add(col.id); continue; }
    if (col.filterKind === "status") continue;
    for (const row of sample) {
      const v = col.accessor(row);
      if (v && looksLikeDate(v)) { detected.add(col.id); break; }
    }
  }
  return detected;
}, [rows, columns]);
```

**Before (Task 5 — column-resize cursor mutations, no lint suppression):**
```ts
document.body.style.cursor     = "col-resize";
document.body.style.userSelect = "none";
```

**After (Task 5 — eslint-disable comments added):**
```ts
// eslint-disable-next-line react-hooks/immutability -- cursor change is a valid DOM side-effect in a mouse-event handler, not during render
document.body.style.cursor     = "col-resize";
// eslint-disable-next-line react-hooks/immutability -- same as above
document.body.style.userSelect = "none";
```

---

## v5.19 — 2026-06-25 — Remove explicit any and fix useMemo deps in PhaseFourDistribution

**File:** `src/components/Sidebar/Tabs/Population/components/PhaseFourDistribution.tsx`

**Before:**
```ts
// Fix A — import line (line 4)
import type { DistributionCurrentData } from "../../../../../data/distribution/distributionTypes";

// Fix B — prop type (line 28)
  onApplyBulkAssignment: (events: any[]) => Promise<void>;

// Fix C — getManagedLoginUsers callbacks (lines 61-62)
      .filter((u: any) => u.isActive)
      .map((u: any) => ({

// Fix D — handleAllocationChange val parameter (line 107)
    val: any

// Fix E — distribution entries map (line 157)
    (distributionCurrent?.entries ?? []).map((e: any) => [e.xrayImageId, e])

// Fix F — sampleDrawResult rows map (line 392)
            {sampleDrawResult.rows.map((row: any) => {

// Fix G — sampleRows plain assignment (line 70)
  const sampleRows = sampleDrawResult?.rows || [];

// Fix H — previewData useMemo missing deps (line 145)
  }, [sampleDrawResult, sampleRows, activeAllocations, employees, operatorUsername, config.stageMappings]);
```

**After:**
```ts
// Fix A — add DistributionEvent to import
import type { DistributionCurrentData, DistributionEvent } from "../../../../../data/distribution/distributionTypes";

// Fix B — typed prop
  onApplyBulkAssignment: (events: DistributionEvent[]) => Promise<void>;

// Fix C — inferred from ManagedLoginUser[]
      .filter((u) => u.isActive)
      .map((u) => ({

// Fix D — typed as union of EmployeeStageAllocation values
    val: EmployeeStageAllocation[keyof EmployeeStageAllocation]

// Fix E — inferred from DistributionEntry[]
    (distributionCurrent?.entries ?? []).map((e) => [e.xrayImageId, e])

// Fix F — inferred from SampleMasterData rows
            {sampleDrawResult.rows.map((row) => {

// Fix G — wrapped in useMemo
  const sampleRows = useMemo(() => sampleDrawResult?.rows ?? [], [sampleDrawResult]);

// Fix H — add saveMonth and saveYear to deps
  }, [sampleDrawResult, sampleRows, activeAllocations, employees, operatorUsername, config.stageMappings, saveMonth, saveYear]);
```

---

## v5.18 — 2026-06-25 — Remove explicit any annotations from MappingSettingsModal

**File:** `src/components/Sidebar/Tabs/Population/components/MappingSettingsModal.tsx`

**Before:**
```ts
// handleMappingChange
const updatedTemplates = config.mappingTemplates.map((t: any) =>

// handleBiMappingChange
const updatedTemplates = config.mappingTemplates.map((t: any) =>

// handleSheetPatternChange
const updatedTemplates = config.mappingTemplates.map((t: any) => {

// handleAddCustomField
if (config.systemFields.some((f: any) => f.key === key) || config.customFields.some((f: any) => f.key === key)) {
const updatedTemplates = config.mappingTemplates.map((t: any) => {
const updatedExportTemplates = config.exportTemplates.map((exp: any) => ({

// handleToggleSystemFieldRequired
const updated = config.systemFields.map((f: any) =>

// handleRemoveSystemField
const updatedFields = config.systemFields.filter((f: any) => f.key !== key);
const updatedTemplates = config.mappingTemplates.map((t: any) =>
const updatedExportTemplates = config.exportTemplates.map((exp: any) => ({
  ...exp,
  columns: exp.columns.filter((c: any) => c.fieldKey !== key)

// handleRemoveCustomField
const updatedCustomFields = config.customFields.filter((f: any) => f.key !== key);
const updatedTemplates = config.mappingTemplates.map((t: any) => {
const updatedExportTemplates = config.exportTemplates.map((exp: any) => ({
  ...exp,
  columns: exp.columns.filter((c: any) => c.fieldKey !== key)

// handleMoveColumn
  .sort((a: any, b: any) => a.order - b.order);
const idx = sorted.findIndex((c: any) => c.fieldKey === fieldKey);
config.exportTemplates.map((exp: any) => ({ ...exp, columns: newSorted }))

// handleExportColumnChange
const handleExportColumnChange = (fieldKey: string, field: keyof ExportColumnSetting, val: any) => {
  const updatedColumns = config.exportTemplates[0].columns.map((col: any) => {
  const updatedExportTemplates = config.exportTemplates.map((exp: any) => ({

// exports tab JSX
.sort((a: any, b: any) => a.order - b.order)
.map((col: any, idx: number, arr: any[]) => (
```

**After:**
```ts
// All `: any` removed — TypeScript infers from the typed arrays.
// val: any → val: ExportColumnSetting[keyof ExportColumnSetting]
// arr: any[] → arr: ExportColumnSetting[]
// All other callbacks: parameter type annotations dropped (inferred from typed arrays)
```

---

## v5.17 — 2026-06-25 — Add enterprise readiness implementation plan

**File:** `docs/superpowers/plans/2026-06-25-enterprise-readiness.md`

**Before:**
```
(file did not exist)
```

**After:**
```
# Enterprise Readiness Implementation Plan
[file created — 15-task plan covering ESLint error elimination, type safety, documentation, and v1.0.0 release]
```

---

## v4.5 — 2026-06-24 — Complete icon overhaul, semantic fixes, formatting utilities, type-safety hardening

Full icon pass: replace all remaining Unicode symbol characters (×, ✕, ✓, ›, ↺, ⊟, ⊞, ⊙, ◈, ◎, ⟳) with lucide-react components across 14 files. Improve semantically wrong icon choices in Settings LABEL_GROUPS and Reports. Create `src/utils/formatting.ts` to consolidate 3 duplicate `formatNumber` and 2 `formatDate` implementations. Remove `as any` casts in `Population/index.tsx`. Add null guards for `riskWorkbookResult` and `biWorkbookResult` in `PhaseTwoReportAndProcessing.tsx`. Decision: XrayReportsDashboard NOT restored — Reports tab already handles reporting; keeping data in Population tab would violate separation of concerns.

---

## v4.4 — 2026-06-24 — Replace all emoji characters with lucide-react SVG icons

Install `lucide-react` and replace every emoji/pictographic character in the UI with a proper SVG icon component. Files changed: `WorkspaceGate.tsx`, `ErrorBoundary.tsx`, `App.tsx`, `ErrorLogSection.tsx`, `Settings/index.tsx`, `CertScanGrid.tsx`, `MappingSettingsModal.tsx`, `PhaseFourDistribution.tsx`, `PhaseThreeSampling.tsx`, `PhaseTwoReportAndProcessing.tsx`, `DataAccuracyReport.tsx`, `Reports/index.tsx`, `Population/index.tsx`, `labelsStore.ts`.

**File:** `package.json`

**Before:**
```json
"dependencies": { "hash-wasm": ..., "react": ..., "react-dom": ..., "recharts": ..., "xlsx": ... }
```

**After:**
```json
"dependencies": { "hash-wasm": ..., "lucide-react": "^0.x", "react": ..., ... }
```

---

## v7.5 — 2026-06-28 — Report Designer: field catalog and data model (FEATURE)

Phase 0, Task 0.5: Create the field catalog (Arabic-labeled metadata for all ExecutiveReportRow fields) and the data model builder that feeds tables to the query engine. The field catalog defines FieldRole, FieldType, and FieldMeta for 24 fact table columns with complete Arabic localization. The data model builder ingests fact rows, port profiles, and stage profiles, then exposes them as named tables with full metadata for rendering tables, charts, and KPIs in the Report Designer.

**File:** `src/data/reportDesigner/query/fieldCatalog.ts` (new)

**Before:**
```ts
(new file)
```

**After:**
```ts
export type FieldRole = "dimension" | "measure";
export type FieldType = "string" | "number" | "boolean";
export type FieldMeta = { field: string; label: string; role: FieldRole; type: FieldType };

export const FACT_FIELDS: FieldMeta[] = [
  { field: "xrayImageId", label: "رقم صورة الأشعة", role: "dimension", type: "string" },
  { field: "portName", label: "الميناء", role: "dimension", type: "string" },
  // ... 22 more fields, all with Arabic labels
];

const BY_FIELD = new Map(FACT_FIELDS.map((f) => [f.field, f]));
export function getFieldMeta(field: string): FieldMeta | undefined {
  return BY_FIELD.get(field);
}
```

**File:** `src/data/reportDesigner/query/dataModel.ts` (new)

**Before:**
```ts
(new file)
```

**After:**
```ts
import type { ExecutiveReportRow } from "../../reporting/executiveReportTypes";
import { FACT_FIELDS, type FieldMeta } from "./fieldCatalog";

export type TableId = "fact" | "portProfiles" | "stageProfiles";
export type DataModelTable = {
  label: string;
  fields: FieldMeta[];
  rows: Array<Record<string, unknown>>;
};
export type DataModel = { tables: Record<TableId, DataModelTable> };

function inferFields(rows: Array<Record<string, unknown>>): FieldMeta[] {
  const sample = rows[0] ?? {};
  return Object.keys(sample).map((field) => {
    const v = sample[field];
    const type = typeof v === "number" ? "number" : typeof v === "boolean" ? "boolean" : "string";
    return { field, label: field, role: type === "number" ? "measure" : "dimension", type };
  });
}

export function buildDataModel(input: {
  factRows: ExecutiveReportRow[];
  portProfiles: Array<Record<string, unknown>>;
  stageProfiles: Array<Record<string, unknown>>;
}): DataModel {
  return {
    tables: {
      fact: {
        label: "بيانات الصور (تفصيلي)",
        fields: FACT_FIELDS,
        rows: input.factRows as unknown as Array<Record<string, unknown>>,
      },
      portProfiles: {
        label: "ملخص الموانئ",
        fields: inferFields(input.portProfiles),
        rows: input.portProfiles,
      },
      stageProfiles: {
        label: "ملخص المراحل",
        fields: inferFields(input.stageProfiles),
        rows: input.stageProfiles,
      },
    },
  };
}
```

**File:** `src/data/reportDesigner/query/dataModel.test.ts` (new)

**Before:**
```ts
(new file)
```

**After:**
```ts
import { describe, it, expect } from "vitest";
import { buildDataModel } from "./dataModel";
import { getFieldMeta } from "./fieldCatalog";
import { runQuery } from "./runQuery";

describe("fieldCatalog", () => {
  it("tags portName as a string dimension and exposes an Arabic label", () => {
    const meta = getFieldMeta("portName");
    expect(meta?.role).toBe("dimension");
    expect(meta?.type).toBe("string");
    expect(typeof meta?.label).toBe("string");
    expect(meta!.label.length).toBeGreaterThan(0);
  });
});

describe("buildDataModel", () => {
  it("exposes the fact table and supports a grouped query over it", () => {
    const factRows = [
      { portName: "ميناء أ", imageResult: "اشتباه" },
      { portName: "ميناء أ", imageResult: "سليمة" },
      { portName: "ميناء ب", imageResult: "اشتباه" },
    ];
    const model = buildDataModel({ factRows: factRows as never, portProfiles: [], stageProfiles: [] });
    expect(model.tables.fact.rows).toHaveLength(3);
    expect(model.tables.fact.fields.some((f) => f.field === "portName")).toBe(true);
    const out = runQuery(model.tables.fact.rows, {
      groupBy: ["portName"],
      values: [{ field: "portName", agg: "count" }],
      filters: [],
    });
    expect(out).toEqual([
      { portName: "ميناء أ", count_portName: 2 },
      { portName: "ميناء ب", count_portName: 1 },
    ]);
  });
});
```

---

## v5.16 — 2026-06-24 — Fix: remove lockout reset on username field change

**File:** `src/auth/AuthGate.tsx`

**Before:**
```tsx
<input
  id="authUsername"
  type="text"
  required
  autoComplete="username"
  placeholder="أدخل اسم المستخدم"
  value={selectedUsername}
  onChange={(event) => {
    setSelectedUsername(event.target.value);
    setFailedAttempts(0);
    setLockoutUntil(null);
  }}
/>
```

**After:**
```tsx
<input
  id="authUsername"
  type="text"
  required
  autoComplete="username"
  placeholder="أدخل اسم المستخدم"
  value={selectedUsername}
  onChange={(event) => {
    setSelectedUsername(event.target.value);
  }}
/>
```

**Reason:** Removed the `setFailedAttempts(0)` and `setLockoutUntil(null)` calls from the username field's `onChange` handler. These calls allowed a locked-out user to bypass the 30-second login throttle by simply typing in the username field, defeating the purpose of the rate-limit entirely. Lockout and attempt counter now only reset on successful login (which already happens in `loginAsEmployee`) or logout (which already happens in the `logout` callback). The password field's `onChange` correctly does not reset them.

---

## v5.15 — 2026-06-24 — Update CLAUDE.md to reflect Tasks 1-13 changes

**File:** `CLAUDE.md`

**Before:**
```markdown
   - `JsonEnvelope<TData>` wraps every JSON file: `{ metadata: { schemaVersion, revision, contentHash, ... }, data }`.
```

**After:**
```markdown
   - `JsonEnvelope<TData>` wraps every JSON file: `{ metadata: { schemaVersion, revision, contentHash, writtenAt }, data }`. Schema versioning via `wrap/unwrap/isEnvelope` in `src/data/storage/jsonEnvelope.ts`.
```

**Changes:**
- Updated JsonEnvelope description to list exact metadata fields (schemaVersion, revision, contentHash, writtenAt)
- Added reference to the factory functions in jsonEnvelope.ts

---

**File:** `CLAUDE.md` — Data-layer modules table

**Before:**
```markdown
| Preferences | `src/data/preferences/` | Browse preset storage |
```

**After:**
```markdown
| Preferences | `src/data/preferences/` | Browse preset storage |
| Error logger | `src/data/storage/errorLogger.ts` | In-memory ring buffer (last 50 entries) for silent-catch observability; `logError`, `getRecentErrors`, `clearErrors` |
| JsonEnvelope | `src/data/storage/jsonEnvelope.ts` | Schema versioning wrapper for all `safeWriteJson` writes; `wrap`, `isEnvelope`, `unwrap` factory functions |
```

**Changes:**
- Added Error logger module row (50-entry ring buffer, accessible via getRecentErrors())
- Added JsonEnvelope module row (schema versioning wrapper with factory functions)

---

**File:** `CLAUDE.md` — Shared UI components table

**Before:**
```markdown
| `ErrorBoundary` | `src/components/ErrorBoundary.tsx` | Top-level React error boundary |
```

**After:**
```markdown
| `ErrorBoundary` | `src/components/ErrorBoundary.tsx` | Top-level React error boundary |
| `AdminToolbar` | `src/auth/AdminToolbar.tsx` | Role-preview segmented switch, logout button, feedback toggle (admin-only) |
```

**Changes:**
- Added AdminToolbar component row (extracted role-preview toolbar component)

---

**File:** `CLAUDE.md` — Reporting module description

**Before:**
```markdown
| Reporting | `src/data/reporting/` | Self-contained Arabic HTML report builders (sample + distribution) |
```

**After:**
```markdown
| Reporting | `src/data/reporting/` | Self-contained Arabic HTML report builders (sample + distribution + executive) |
```

**Changes:**
- Updated to include executive report (added in v4.0, now reflected in docs)

---

## v5.14 — 2026-06-24 — Broaden isEnvelope guard to detect workspace-style string schemaVersion

**File:** `src/data/storage/jsonEnvelope.ts`

**Before:**
```ts
export function isEnvelope(value: unknown): value is JsonEnvelope<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "metadata" in value &&
    "data" in value &&
    typeof (value as JsonEnvelope<unknown>).metadata?.schemaVersion === "number"
  );
}
```

**After:**
```ts
export function isEnvelope(value: unknown): value is JsonEnvelope<unknown> {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (!("metadata" in v) || !("data" in v)) return false;
  const m = v["metadata"];
  if (!m || typeof m !== "object") return false;
  return "schemaVersion" in (m as object);
}
```

---

**File:** `src/data/storage/jsonEnvelope.test.ts`

**Before:**
```ts
// ended at: increments revision from previous test
```

**After:**
```ts
// added two new tests:
// - isEnvelope returns true for workspace-style envelope (string schemaVersion)
// - isEnvelope returns false for object missing metadata.schemaVersion
```

---

## v5.13 — 2026-06-24 — Add JsonEnvelope schema versioning to safeWriteJson / safeReadJson

**File:** `src/data/storage/jsonEnvelope.ts` *(new file)*

**Before:**
```ts
// (file did not exist)
```

**After:**
```ts
// New JsonEnvelope<T> type + wrap/unwrap/isEnvelope factory functions
// wrap: adds { metadata: { schemaVersion, revision, contentHash, writtenAt }, data }
// unwrap: returns data from envelope or value as-is for legacy bare files
```

---

**File:** `src/data/storage/jsonEnvelope.test.ts` *(new file)*

**Before:**
```ts
// (file did not exist)
```

**After:**
```ts
// 6 Vitest tests covering wrap, isEnvelope, unwrap (including legacy bare-data path)
```

---

**File:** `src/data/storage/safeWrite.ts`

**Before:**
```ts
const serialized = `${JSON.stringify(value, null, 2)}\n`;
// ...
value: JSON.parse(live as string) as T,
// ...
value: JSON.parse(bak as string) as T,
```

**After:**
```ts
// isEnvelope guard prevents double-wrapping when callers (e.g. saveWithRevision)
// already build the envelope manually
const serialized = `${JSON.stringify(isEnvelope(value) ? value : wrap(value), null, 2)}\n`;
// ...
value: unwrap<T>(JSON.parse(live as string)),
// ...
value: unwrap<T>(JSON.parse(bak as string)),
```

---

**File:** `src/data/storage/safeWrite.test.ts`

**Before:**
```ts
const bak = JSON.parse(await readRaw(dir, "a.json.bak")) as { v: number };
const live = JSON.parse(await readRaw(dir, "a.json")) as { v: number };
expect(bak.v).toBe(1);
expect(live.v).toBe(2);
```

**After:**
```ts
const bak = JSON.parse(await readRaw(dir, "a.json.bak")) as { data: { v: number } };
const live = JSON.parse(await readRaw(dir, "a.json")) as { data: { v: number } };
expect(bak.data.v).toBe(1);
expect(live.data.v).toBe(2);
```

---

**File:** `src/data/storage/fileSystemAccess.test.ts`

**Before:**
```ts
const live = await readJsonFile<{ a: number }>(dir, "x.json");
const bak = await readJsonFile<{ a: number }>(dir, "x.json.bak");
expect(live.ok && live.file.a).toBe(2);
expect(bak.ok && bak.file.a).toBe(1);
```

**After:**
```ts
const live = await readJsonFile<{ data: { a: number } }>(dir, "x.json");
const bak = await readJsonFile<{ data: { a: number } }>(dir, "x.json.bak");
expect(live.ok && live.file.data.a).toBe(2);
expect(bak.ok && bak.file.data.a).toBe(1);
```

---

## v5.12 — 2026-06-24 — Surface error log in Settings tab (admin only, collapsible)

**File:** `src/components/Sidebar/Tabs/Settings/ErrorLogSection.tsx` *(new file)*

**Before:**
```ts
// (file did not exist)
```

**After:**
```tsx
// New ErrorLogSection component — admin-only collapsible error log viewer
// Uses getRecentErrors / clearErrors from errorLogger; role-gated via usePermissions
```

---

**File:** `src/components/Sidebar/Tabs/Settings/ErrorLogSection.css` *(new file)*

**Before:**
```css
/* (file did not exist) */
```

**After:**
```css
/* Styles for ErrorLogSection component */
```

---

**File:** `src/components/Sidebar/Tabs/Settings/index.tsx`

**Before:**
```tsx
// No import of ErrorLogSection
// SettingsPage renders only label-customization sections
```

**After:**
```tsx
import { ErrorLogSection } from "./ErrorLogSection";
// SettingsPage renders ErrorLogSection below label sections (admin-only, collapsible)
```

---

## v5.11 — 2026-06-24 — Parallelize listMonthSummaries with Promise.allSettled

**File:** `src/data/population/populationStorage.ts`

**Before:**
```ts
export async function listMonthSummaries(
  directoryHandle: DirectoryHandleLike
): Promise<MonthSummary[]> {
  const infos = await listMonthFolders(directoryHandle);
  const results: MonthSummary[] = [];

  let populationDir: DirectoryHandleLike;
  try {
    populationDir = await getPopulationRoot(directoryHandle, false);
  } catch { return []; }

  for (const info of infos) {
    try {
      const monthDir = await populationDir.getDirectoryHandle(
        info.folderName, { create: false }
      );

      const manifestResult = await safeReadJson<MonthManifestData>(
        monthDir, "month.manifest.json"
      );
      const manifest = manifestResult.ok ? manifestResult.value : null;

      let hasPopulation = false;
      let totalProcessedRows = manifest?.totalProcessedRows ?? 0;
      try {
        const processedDir = await monthDir.getDirectoryHandle("processed", { create: false });
        const popResult = await safeReadJson<PopulationFinalData>(processedDir, "population.final.json");
        hasPopulation = popResult.ok;
        if (popResult.ok) totalProcessedRows = popResult.value.totalRows;
      } catch { /* directory missing */ }

      let hasSample = false;
      {
        const sampleDir = await resolveSampleDir(directoryHandle, info.folderName, monthDir);
        if (sampleDir) {
          const sResult = await safeReadJson<SampleMasterData>(sampleDir, "sample.master.json");
          hasSample = sResult.ok;
        }
      }

      let hasDistribution = false;
      try {
        const sampleDir = await getSampleMainDir(directoryHandle, info.folderName, false);
        const dResult = await safeReadJson<DistributionCurrentData>(sampleDir, "distribution.current.json");
        hasDistribution = dResult.ok;
      } catch {
        try {
          const dResult = await safeReadJson<DistributionCurrentData>(monthDir, "distribution.current.json");
          hasDistribution = dResult.ok;
        } catch { /* file missing */ }
      }

      results.push({ info, manifest, hasPopulation, hasSample, hasDistribution, totalProcessedRows });
    } catch {
      // skip inaccessible month folders
    }
  }

  // newest first
  return results.reverse();
}
```

**After:**
```ts
export async function listMonthSummaries(
  directoryHandle: DirectoryHandleLike
): Promise<MonthSummary[]> {
  const infos = await listMonthFolders(directoryHandle);

  let populationDir: DirectoryHandleLike;
  try {
    populationDir = await getPopulationRoot(directoryHandle, false);
  } catch { return []; }

  const settled = await Promise.allSettled(
    infos.map(async (info) => {
      const monthDir = await populationDir.getDirectoryHandle(
        info.folderName, { create: false }
      );

      const manifestResult = await safeReadJson<MonthManifestData>(
        monthDir, "month.manifest.json"
      );
      const manifest = manifestResult.ok ? manifestResult.value : null;

      let hasPopulation = false;
      let totalProcessedRows = manifest?.totalProcessedRows ?? 0;
      try {
        const processedDir = await monthDir.getDirectoryHandle("processed", { create: false });
        const popResult = await safeReadJson<PopulationFinalData>(processedDir, "population.final.json");
        hasPopulation = popResult.ok;
        if (popResult.ok) totalProcessedRows = popResult.value.totalRows;
      } catch { /* directory missing */ }

      let hasSample = false;
      {
        const sampleDir = await resolveSampleDir(directoryHandle, info.folderName, monthDir);
        if (sampleDir) {
          const sResult = await safeReadJson<SampleMasterData>(sampleDir, "sample.master.json");
          hasSample = sResult.ok;
        }
      }

      let hasDistribution = false;
      try {
        const sampleDir = await getSampleMainDir(directoryHandle, info.folderName, false);
        const dResult = await safeReadJson<DistributionCurrentData>(sampleDir, "distribution.current.json");
        hasDistribution = dResult.ok;
      } catch {
        try {
          const dResult = await safeReadJson<DistributionCurrentData>(monthDir, "distribution.current.json");
          hasDistribution = dResult.ok;
        } catch { /* file missing */ }
      }

      return { info, manifest, hasPopulation, hasSample, hasDistribution, totalProcessedRows };
    })
  );

  const results: MonthSummary[] = settled
    .filter((r): r is PromiseFulfilledResult<MonthSummary> => r.status === "fulfilled")
    .map((r) => r.value);

  // newest first
  return results.reverse();
}
```

---

## v5.10 — 2026-06-24 — Add distributionStorage integration tests

**File:** `src/data/distribution/distributionStorage.test.ts`

**Before:**
```ts
// (file did not exist)
```

**After:**
```ts
// New test file covering append-to-empty-log, single-event read-back,
// and multiple sequential appends via appendDistributionEvent + loadDistributionLog
```

---

## v5.9 — 2026-06-24 — Add React component smoke tests for AuthGate login flow

**File:** `vitest.config.ts`

**Before:**
```ts
include: ["src/**/*.test.ts"],
```

**After:**
```ts
include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
```

---

**File:** `src/auth/AuthGate.test.tsx` (created)

**Before:**
```ts
// Did not exist
```

**After:**
```tsx
/* @vitest-environment jsdom */
// Two smoke tests: login form renders, wrong password shows error
```

---

## v5.8 — 2026-06-24 — Add centralized error logger, wire up key silent catches in populationStorage

**File:** `src/data/storage/errorLogger.ts` (created)

**Before:**
```ts
// Did not exist
```

**After:**
```ts
export type ErrorEntry = { context: string; message: string; timestamp: string; };
const MAX_ENTRIES = 50;
const entries: ErrorEntry[] = [];
export function logError(context: string, error: unknown): void { ... }
export function getRecentErrors(): ErrorEntry[] { return entries.slice(); }
export function clearErrors(): void { entries.length = 0; }
```

---

**File:** `src/data/storage/errorLogger.test.ts` (created)

**Before:**
```ts
// Did not exist
```

**After:**
```ts
// Three Vitest tests: stores logged errors, caps at 50 entries, clearErrors empties the log
```

---

**File:** `src/data/population/populationStorage.ts`

**Before:**
```ts
import { safeWriteJson, safeReadJson } from "../storage/safeWrite";
// ...
  } catch { /* skip if FS API unavailable */ }
// ...
  } catch {
    return [];
  }
// ...
    } catch { /* skip inaccessible */ }
```

**After:**
```ts
import { safeWriteJson, safeReadJson } from "../storage/safeWrite";
import { logError } from "../storage/errorLogger";
// ...
  } catch (error) {
    logError("saveBinaryFile", error);
  }
// ...
  } catch (error) {
    logError("listMonthFolders", error);
    return [];
  }
// ...
    } catch (error) {
      logError("loadAllPopulationRows", error);
    }
```

---

## v5.7 — 2026-06-24 — Extract AdminToolbar component from AuthGate

**File:** `src/auth/AdminToolbar.tsx` (created)

**Before:**
```tsx
// Did not exist
```

**After:**
```tsx
// New standalone component receiving session, previewRole, onPreviewRoleChange, onLogout, onFeedback props
// Contains PREVIEW_ROLE_IDS, getRoleLabel, and all toolbar JSX
export function AdminToolbar({ session, previewRole, onPreviewRoleChange, onLogout, onFeedback }: AdminToolbarProps) { ... }
```

---

**File:** `src/auth/AdminToolbar.css` (created)

**Before:**
```css
/* Did not exist */
```

**After:**
```css
/* Toolbar-specific CSS rules moved from AuthGate.css:
   .auth-admin-toolbar, .auth-toolbar-*, .auth-role-*, .auth-preview-* */
```

---

**File:** `src/auth/AuthGate.tsx`

**Before:**
```tsx
const PREVIEW_ROLE_IDS: AuthRole[] = ["admin", "manager", "supervisor", "employee", "guest"];
function getRoleLabel(role: AuthRole): string { ... }
function toggleFeedbackPanel(): void { window.dispatchEvent(new CustomEvent("feedback:toggle")); }
// ... toolbar JSX inline in authenticated branch (~55 lines)
```

**After:**
```tsx
import { AdminToolbar } from "./AdminToolbar";
// PREVIEW_ROLE_IDS, getRoleLabel, toggleFeedbackPanel removed
// Toolbar JSX replaced with:
<AdminToolbar session={session} previewRole={previewRole} onPreviewRoleChange={changePreviewRole} onLogout={logout} onFeedback={() => window.dispatchEvent(new CustomEvent("feedback:toggle"))} />
```

---

**File:** `src/auth/AuthGate.css`

**Before:**
```css
/* ~170 lines of toolbar rules: .auth-admin-toolbar, .auth-toolbar-*, .auth-role-*, .auth-preview-* */
```

**After:**
```css
/* Toolbar rules removed — now live in AdminToolbar.css */
```

---

## v5.6 — 2026-06-24 — Extract resolveSampleDir helper, deduplicate dual-path fallback

**File:** `src/data/population/populationStorage.ts`

**Before:**
```ts
// Three inline try/catch dual-path blocks like:
try {
  const sampleDir = await getSampleMainDir(directoryHandle, info.folderName, false);
  // ... use sampleDir
} catch {
  try {
    const sampleDir = await monthDir.getDirectoryHandle("sample", { create: false });
    // ... use sampleDir
  } catch { /* directory missing */ }
}
```

**After:**
```ts
// Single private helper:
async function resolveSampleDir(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  monthDir: DirectoryHandleLike
): Promise<DirectoryHandleLike | null> {
  try {
    return await getSampleMainDir(directoryHandle, monthFolderName, false);
  } catch {
    try {
      return await monthDir.getDirectoryHandle("sample", { create: false });
    } catch {
      return null;
    }
  }
}
// All three call-sites replaced with: const sampleDir = await resolveSampleDir(...); if (!sampleDir) ...
```

**File:** `src/data/population/populationStorage.test.ts`

**Before:**
```ts
// No test for legacy sample path fallback
```

**After:**
```ts
// Added: "loadAllSampleRows falls back to legacy sample path when getSampleMainDir throws"
```

---

## v5.5 — 2026-06-24 — Move App.tsx inline styles to CSS classes

**File:** `src/App.css`

**Before:**
```css
/* (no .app-bak-warning, .app-bak-warning-close, .app-no-tabs classes) */
```

**After:**
```css
.app-bak-warning {
  position: fixed;
  top: 0;
  inset-inline: 0;
  z-index: 9999;
  background: #fef3c7;
  border-bottom: 1px solid #f59e0b;
  padding: 10px 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
  color: #92400e;
  direction: rtl;
}

.app-bak-warning-close {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 20px;
  color: #92400e;
  line-height: 1;
  padding: 0 4px;
}

.app-no-tabs {
  min-height: calc(100vh - 44px);
  display: grid;
  place-items: center;
  padding: 24px;
  color: #475467;
  text-align: center;
}

.app-no-tabs h1 {
  margin: 0 0 10px;
  color: #17365d;
  font-size: 24px;
}

.app-no-tabs p {
  margin: 0;
  line-height: 1.8;
}
```

**File:** `src/App.tsx`

**Before:**
```tsx
{bakWarning && (
  <div
    style={{
      position: "fixed",
      top: 0,
      insetInline: 0,
      zIndex: 9999,
      background: "#fef3c7",
      borderBottom: "1px solid #f59e0b",
      padding: "10px 16px",
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      fontSize: 13,
      color: "#92400e",
      direction: "rtl",
    }}
  >
    <span>⚠️ {bakWarning}</span>
    <button
      onClick={() => setBakWarning(null)}
      style={{
        background: "none",
        border: "none",
        cursor: "pointer",
        fontSize: 20,
        color: "#92400e",
        lineHeight: 1,
        padding: "0 4px",
      }}
      aria-label="إغلاق"
    >
      ×
    </button>
  </div>
)}

// …

function NoAvailableTabs({ role }: { role: AuthSession["role"] }) {
  return (
    <div className="tab-blank" dir="rtl">
      <div
        style={{
          minHeight: "calc(100vh - 44px)",
          display: "grid",
          placeItems: "center",
          padding: "24px",
          color: "#475467",
          textAlign: "center"
        }}
      >
        <div>
          <h1
            style={{
              margin: "0 0 10px",
              color: "#17365d",
              fontSize: "24px"
            }}
          >
            لا توجد تبويبات متاحة
          </h1>

          <p style={{ margin: 0, lineHeight: 1.8 }}>
            لا توجد صفحات مفعلة لهذا الدور حالياً: <strong>{role}</strong>
          </p>
        </div>
      </div>
    </div>
  );
}
```

**After:**
```tsx
{bakWarning && (
  <div className="app-bak-warning">
    <span>⚠️ {bakWarning}</span>
    <button
      onClick={() => setBakWarning(null)}
      className="app-bak-warning-close"
      aria-label="إغلاق"
    >
      ×
    </button>
  </div>
)}

// …

function NoAvailableTabs({ role }: { role: AuthSession["role"] }) {
  return (
    <div className="tab-blank" dir="rtl">
      <div className="app-no-tabs">
        <div>
          <h1>لا توجد تبويبات متاحة</h1>
          <p>لا توجد صفحات مفعلة لهذا الدور حالياً: <strong>{role}</strong></p>
        </div>
      </div>
    </div>
  );
}
```

---

## v5.4 — 2026-06-24 — Add keyboard focus trap to admin passcode modal

**File:** `src/auth/AuthGate.tsx`

**Before:**
```tsx
// No focus trap refs or effects existed.
// closeAdminModal() did not restore focus.
// setIsAdminModalOpen(true) call did not capture trigger element.
// <section className="auth-admin-modal"> had no ref.

function closeAdminModal(): void {
  setIsAdminModalOpen(false);
  setAdminPasscode("");
}

// In handleHiddenAdminShortcut:
setIsAdminModalOpen(true);

// <section className="auth-admin-modal" ...>
```

**After:**
```tsx
// Added refs:
const adminModalRef = useRef<HTMLElement | null>(null);
const triggerRef = useRef<HTMLElement | null>(null);

// Added focus-trap useEffect (activates when isAdminModalOpen === true).
// closeAdminModal() now restores focus via triggerRef.current?.focus().
// handleHiddenAdminShortcut captures document.activeElement into triggerRef before opening.
// <section className="auth-admin-modal" ref={adminModalRef as React.RefObject<HTMLElement>}>
```

---

## v5.3 — 2026-06-24 — Add 3-attempt login lockout with 30-second countdown

**File:** `src/auth/AuthGate.tsx`

**Before:**
```tsx
// No rate-limiting state or lockout logic existed.
// Submit button:
<button className="auth-submit" type="submit">
  دخول
</button>

// loginAsEmployee: wrong-password error shown immediately with no throttle.
showMessage("كلمة المرور غير صحيحة.", "bad");

// logout callback: only cleared session/UI state.
// setSelectedUsername onChange: only called setSelectedUsername.
```

**After:**
```tsx
// Added state:
const [failedAttempts, setFailedAttempts] = useState(0);
const [lockoutUntil, setLockoutUntil] = useState<number | null>(null);
const [lockoutSecondsLeft, setLockoutSecondsLeft] = useState(0);
const LOCKOUT_AFTER_ATTEMPTS = 3;
const LOCKOUT_DURATION_MS = 30_000;

// Added countdown effect (clears interval on unmount).
// loginAsEmployee: early-returns during active lockout; increments failedAttempts;
//   triggers lockout after LOCKOUT_AFTER_ATTEMPTS failures; resets on success.
// Submit button: disabled during lockout; shows countdown label in Arabic.
// setSelectedUsername onChange: also resets failedAttempts + lockoutUntil.
// logout callback: also resets failedAttempts + lockoutUntil.
```

---

## v5.2 — 2026-06-24 — Add aria-label to admin passcode input, fix auth-message bad-class binding

**File:** `src/auth/AuthGate.tsx`

**Before:**
```tsx
// Admin passcode input (line 547):
<input
  type="password"
  autoFocus
  value={adminPasscode}
  onChange={(event) => setAdminPasscode(event.target.value)}
  onKeyDown={handleAdminModalKeyDown}
  placeholder="رمز مسؤول النظام"
/>

// Employee login message (line 506):
<div
  className={`auth-message ${messageType === "ok" ? "ok" : ""}`}
  aria-live="polite"
>
  {message}
</div>
```

**After:**
```tsx
// Admin passcode input with aria-label for screen readers:
<input
  type="password"
  autoFocus
  aria-label="رمز مسؤول النظام"
  value={adminPasscode}
  onChange={(event) => setAdminPasscode(event.target.value)}
  onKeyDown={handleAdminModalKeyDown}
  placeholder="رمز مسؤول النظام"
/>

// Message div now applies both "ok" and "bad" classes correctly:
<div
  className={`auth-message${messageType ? ` ${messageType}` : ""}`}
  aria-live="polite"
>
  {message}
</div>
```

**File:** `src/auth/AuthGate.css`

**Before:**
```css
.auth-message {
  min-height: 24px;
  color: var(--auth-danger);
  font-size: 13px;
  font-weight: 600;
  line-height: 1.6;
  padding: 2px 0;
}

.auth-message.ok {
  color: var(--auth-success);
}
```

**After:**
```css
.auth-message {
  min-height: 24px;
  color: inherit;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.6;
  padding: 2px 0;
}

.auth-message.bad {
  color: var(--auth-danger);
}

.auth-message.ok {
  color: var(--auth-success);
}
```

---

## v5.1 — 2026-06-24 — Remove dead SESSION_KEY constant

**File:** `src/auth/authConfig.ts`

**Before:**
```ts
export const SESSION_KEY = "xray_local_login_session_v1";
```

**After:**
*(line removed)*

---

## v5.0 — 2026-06-24 — Workspace path restructuring, runtime-only auth session, samples mirror module

**Summary:** Major architectural refactor across 39 files covering:
1. Numbered workspace folder layout (`1-Population`, `2-Samples`, `3-User Data`, `4-Reports`, `5-System`, `6-Templates`) with legacy-path migration fallback.
2. Auth session and preview-role state moved from `localStorage`/`sessionStorage` to module-level runtime variables — no browser storage dependency for session.
3. `handleStore.ts` deleted; workspace handle persistence removed from the storage layer.
4. New `src/data/workspace/workspacePaths.ts` — centralised path helpers (`getPopulationRoot`, `getSampleMainDir`, `getSampleEmployeeDir`, `getUserDataRoot`, `safeWorkspaceFilePart`).
5. New `src/data/samples/sampleMirrorStorage.ts` — syncs `main.samples.json` and per-employee `{username}.samples.json` mirror files into `2-Samples/` after each distribution update.
6. `answerStorage.ts` — uses new path helpers; adds legacy-path fallback and CAS loop for concurrent write safety.
7. `UserManagement` tab — adds in-place identity editing (username + displayName), routes `users-permissions.json` to `3-User Data/`.
8. `WorkspaceProvider.tsx` refactored (~366 → ~284 lines): removes `handleStore` import, uses `createDefaultManagedUsers` for first-time workspace init.
9. UI polish across AuthGate, DataTable, FeedbackWidget, Sidebar, Reports, EmployeeWorkspace (XrayInspectionResults, XrayReferrals).

**File:** `src/data/workspace/workspacePaths.ts` *(new)*

**Before:** *(file did not exist)*

**After:**
```ts
export const WORKSPACE_ROOTS = {
  population: "1-Population",
  samples: "2-Samples",
  userData: "3-User Data",
  reports: "4-Reports",
  system: "5-System",
  templates: "6-Templates",
} as const;
// + path-helper functions with legacy fallback
```

---

**File:** `src/data/samples/sampleMirrorStorage.ts` *(new)*

**Before:** *(file did not exist)*

**After:**
```ts
// syncSampleMirrors() writes main.samples.json + {username}.samples.json
// into 2-Samples/{month}/ after each distribution event.
```

---

**File:** `src/auth/authSession.ts`

**Before:**
```ts
// Session stored in localStorage with SESSION_KEY.
// Preview role stored in sessionStorage with PREVIEW_ROLE_KEY.
export function readRealSession(): AuthSession | null {
  const rawValue = localStorage.getItem(SESSION_KEY);
  // ...
}
```

**After:**
```ts
// Auth state is intentionally runtime-only.
let runtimeSession: AuthSession | null = null;
let runtimePreviewRole: AuthRole | null = null;
export function readRealSession(): AuthSession | null {
  if (!runtimeSession || !isValidSession(runtimeSession) || isExpired(runtimeSession)) {
    runtimeSession = null;
  }
  return runtimeSession;
}
```

---

**File:** `src/data/storage/handleStore.ts` *(deleted)*

**Before:**
```ts
// Persisted workspace directory handle in IndexedDB.
export async function loadWorkspaceHandle(): Promise<...>
export async function saveWorkspaceHandle(handle: ...): Promise<void>
export async function clearWorkspaceHandle(): Promise<void>
```

**After:** *(file deleted — handle persistence removed)*

---

## v4.11 — 2026-06-24 — InspectionPanel: fix toolbar position + full-height panel

**Root cause:** `DataTable` renders a Fragment (`<>...</>`). When placed directly as a flex child of `.ew-split`, its toolbar and table body each become separate flex items in the RTL row — causing the toolbar to appear as a side column to the right of the rows instead of above them.

**File:** `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx`
- Wrapped `tableEl` in `<div className="ew-split-table">` so the DataTable fragment resolves to a single flex child.

**File:** `src/components/Sidebar/Tabs/EmployeeWorkspace/EmployeeWorkspace.css`
- Added `.ew-split-table { flex: 1; min-width: 0; overflow: hidden }` — replaces the now-unused `.ew-split--right > :first-child` rule.

**File:** `src/components/InspectionPanel/InspectionPanel.css`
- Changed `.ip-panel--right` from `max-height: calc(100vh - 32px)` to `height: 100vh; top: 0` so the panel always matches the full visible viewport height (same visual height as the table area).

---

## v4.10 — 2026-06-24 — InspectionPanel: fix footer, remove duplicate chips, always-on panel

**File:** `src/components/InspectionPanel/InspectionPanel.css`
- Added `min-height: 0` to `.ip-form-body` so the form body shrinks within the constrained panel height and the footer (حفظ مسودة / تقديم buttons) is always visible.

**File:** `src/components/InspectionPanel/PanelHeader.tsx`
- Removed `ip-meta-chips` section and the `visibleColumns` / `colConfig` props — the DataTable columns on the right already show the same data, so the chips were duplicate.

**File:** `src/components/InspectionPanel/index.tsx`
- Removed `visibleColumns` and `colConfig` from `Props` and the `PanelHeader` call.
- Removed the `DataTableCol` / `ColConfig` import.

**File:** `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx`
- Added `useEffect` that auto-selects the first entry whenever `displayEntries` changes and the current selection is invalid — panel is always visible when there is data.
- Changed `onRowClick` from toggle (clicking same row closed panel) to always-select.
- Removed `visibleColumns` and `colConfig` from the `InspectionPanel` call site.

---

## v4.9 — 2026-06-24 — InspectionPanel: sticky viewport layout + true split-screen bottom mode

**File:** `src/components/InspectionPanel/InspectionPanel.css`

**Before:**
```css
.ip-panel--right {
  width: 480px;
  min-height: 520px;
}
.ip-panel--bottom {
  width: 100%;
  max-height: 46vh;
  min-height: 320px;
}
```

**After:**
```css
.ip-panel--right {
  width: 480px;
  flex-shrink: 0;
  position: sticky;
  top: 16px;
  max-height: calc(100vh - 32px);
  align-self: flex-start;
}
.ip-panel--bottom {
  width: 100%;
  height: 42vh;
  min-height: 300px;
  flex-shrink: 0;
}
```

**File:** `src/components/Sidebar/Tabs/EmployeeWorkspace/EmployeeWorkspace.css`

**Before:**
```css
.ew-split--bottom {
  flex-direction: column;
}
```

**After:**
```css
.ew-split--bottom {
  flex-direction: column;
  overflow: hidden;
  max-height: calc(100vh - 220px);
  min-height: 500px;
}
.ew-split--bottom > :first-child {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
```

---

## v4.8 — 2026-06-24 — InspectionPanel: side-panel layout for sample review

Replaced the inline table-row expand form with a dedicated `InspectionPanel` component rendered alongside the DataTable. Employees can toggle the panel between right and bottom positions; the choice is saved to their browse preset JSON. The panel shows a visual phase stepper, a metadata header that mirrors the user's active column selection, a single-column form, and a sticky footer with save/submit actions.

**Files:** `src/components/InspectionPanel/` (new), `src/data/preferences/browsePresetStorage.ts`, `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx`, `src/components/Sidebar/Tabs/EmployeeWorkspace/EmployeeWorkspace.css`

---

## v4.7 — 2026-06-24 — Cascade condition support + default template "no image" logic

**Files:** `src/data/templates/templateRuntime.ts`, `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx`, `src/components/Sidebar/Tabs/EmployeeWorkspace/views/EmployeeDashboard.tsx`, `src/components/Sidebar/Tabs/TemplateBuilder/index.tsx`

Added cascade condition evaluation to `isFieldVisible`: when a source field is itself hidden, all fields that depend on it are also hidden automatically (no need to duplicate conditions). Updated all call sites to pass `template.fields` for cascade resolution.

Updated `buildDefaultInspectionTemplate`: When "هل يوجد صورة" = "لا", Phase 2 (ضمان جودة النتيجة) collapses entirely, and Phase 1 fields "هل يوجد تحديد", "مستوى جودة الصورة", and "الملاحظات العامة" also hide. "اسباب انخفاض جودة الصورة" and its sub-field hide automatically via cascade from "مستوى جودة الصورة".

**Before (`templateRuntime.ts`):**
```ts
export function isFieldVisible(
  field: TemplateField,
  answers: Record<string, TemplateAnswerValue>
): boolean {
  if (!field.condition?.sourceFieldId) return true;
  return evaluateCondition(field.condition, answers[field.condition.sourceFieldId]);
}

// getVisibleTemplateFields used isFieldVisible(field, answers)
```

**After (`templateRuntime.ts`):**
```ts
export function isFieldVisible(
  field: TemplateField,
  answers: Record<string, TemplateAnswerValue>,
  allFields?: TemplateField[]
): boolean {
  if (!field.condition?.sourceFieldId) return true;
  if (allFields) {
    const src = allFields.find(f => f.fieldId === field.condition!.sourceFieldId);
    if (src && !isFieldVisible(src, answers, allFields)) return false;
  }
  return evaluateCondition(field.condition, answers[field.condition.sourceFieldId]);
}

// getVisibleTemplateFields now passes schema.fields for cascade
```

---

## v4.6 — 2026-06-24 — Workspace repair for invalid_structure on new PC

**File:** `src/data/workspace/WorkspaceGate.tsx`

When a workspace is copied to a new PC (USB, ZIP transfer, etc.) some root-level JSON files may be corrupted or truncated in transit, producing `invalid_structure` status. Previously the admin saw only "pick another folder" with no recovery path. This fix adds a repair flow for admins: shows which files are invalid, warns that repair will recreate system files (user accounts may need re-adding), and offers a "إصلاح بنية مساحة العمل" button that calls `createInitialStructure` — the same function used for `missing_structure`. Population data (`Population/` folder) is never touched.

**Before:**
```tsx
// invalid_structure, error, permission_denied
return (
  <div className="workspace-gate" dir="rtl">
    <div className="workspace-gate-card">
      <div className="workspace-gate-icon">❌</div>
      <h2>تعذر فتح مساحة العمل</h2>
      <p>{message}</p>
      <button
        type="button"
        onClick={() => {
          void selectWorkspace();
        }}
      >
        اختيار مجلد آخر
      </button>
    </div>
  </div>
);
```

**After:**
```tsx
// invalid_structure with admin — offer repair
if (status === "invalid_structure") {
  const isAdmin = session.role === "admin";
  if (isAdmin) {
    return (
      <div className="workspace-gate" dir="rtl">
        <div className="workspace-gate-card">
          <div className="workspace-gate-icon">🔧</div>
          <h2>ملفات مساحة العمل تالفة أو غير متوافقة</h2>
          <p>
            تم العثور على المجلد لكن بعض ملفات النظام تالفة أو بإصدار غير متوافق.
            يمكنك إصلاح البنية الآن — لن تتأثر بيانات السكان والعينات.
          </p>
          <p className="workspace-gate-warn">
            ⚠ قد تحتاج إلى إعادة إضافة حسابات الموظفين بعد الإصلاح.
          </p>
          {invalidItems.length > 0 && (
            <ul className="workspace-gate-missing">
              {invalidItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
          <button type="button" onClick={() => { void createInitialStructure(session.username); }}>
            إصلاح بنية مساحة العمل
          </button>
          <button type="button" className="secondary" onClick={() => { void selectWorkspace(); }}>
            اختيار مجلد آخر
          </button>
        </div>
      </div>
    );
  }
}

// error, permission_denied, invalid_structure (non-admin)
return (
  <div className="workspace-gate" dir="rtl">
    <div className="workspace-gate-card">
      <div className="workspace-gate-icon">❌</div>
      <h2>تعذر فتح مساحة العمل</h2>
      <p>{message}</p>
      <button type="button" onClick={() => { void selectWorkspace(); }}>
        اختيار مجلد آخر
      </button>
    </div>
  </div>
);
```

---

## v4.5 — 2026-06-24 — Smart result-value normalization in BI vs Risk comparison + default inspection template

Two independent features:

1. **DataAccuracyReport** (`DataAccuracyReport.tsx`): Added semantic normalization for result columns (نتيجة المستوى الأول / الثاني / التفتيش …). Numeric codes (`1` → سليمة, `2` → اشتباه) and textual variants (`سليمة -يمكن فسحها`, `نتيجة سليمة_مبدئية` → سليمة, etc.) are now canonicalized before comparison so they no longer count as mismatches. Display in the mismatch table shows `raw (canonical)` so the viewer knows what the code means.

2. **TemplateBuilder** (`TemplateBuilder/index.tsx`): Added "النموذج الافتراضي" button that seeds the pre-built two-phase inspection template (ضمان جودة الصورة / ضمان جودة النتيجة) with all conditional fields already wired up. The template is editable and deletable like any other.

**File:** `src/components/Sidebar/Tabs/Population/components/DataAccuracyReport.tsx`

**Before:**
```ts
function norm(val: string | null | undefined): string {
  if (val === null || val === undefined) return "";
  const s = val.toString().trim();
  // ...date normalization...
  return s.toLowerCase().replace(/\s+/g, " ");
}

function display(val: string | null | undefined): string {
  if (val === null || val === undefined || val === "") return "—";
  return val;
}
```
(comparison in compare() always used `norm()` for all columns; display() showed raw value only)

**After:**
Added `RESULT_COLUMN_KEYS`, `canonicalizeResult()`, `normForCol()`, and `displayForCol()`.
Result columns are compared using canonical forms; display shows `raw (canonical)` when they differ.

---

**File:** `src/components/Sidebar/Tabs/TemplateBuilder/index.tsx`

**Before:**
`handleCreate()` created a blank two-phase template. No default template button.

**After:**
Added `buildDefaultInspectionTemplate()` factory and `handleCreateDefault()` handler.
Added "النموذج الافتراضي" button in the list view next to "نموذج جديد".

---

## v1.0 — 2026-06-23 — Initial full codebase commit

First push of the complete XQAP v1 application to GitHub. Covers all phases:
population import, stratified sampling, distribution, employee workspace,
template builder, reports, archive, backups, user management, and settings.

No before/after diff — this is the baseline from which all future edits are measured.

---

## v2 — 2026-06-23 — Full-audit remediation + 7-day persistent login

Applies the findings of the codebase audit (all except C3 login-throttling, descoped by
the user) and adds session persistence. Highlights: rotated the bootstrap admin passcode to
a strong value with a freshly generated Argon2id hash; sessions now persist for 7 days;
`safeWriteJson` stages writes through a verified `.tmp`; optimistic-concurrency hash now
matches the bytes on disk; legacy password hashes upgrade transparently on login.

**File:** `src/auth/authConfig.ts`

**Before:**
```ts
export const LOGIN_SYSTEM_VERSION = "1.2.0";
...
export const BOOTSTRAP_ADMIN_PASSWORD_HASH: PasswordHashRecord = {
  algorithm: "argon2id",
  encoded: "$argon2id$v=19$m=19456,t=2,p=1$Q0EXc66ZzrZ7R+3ZeFyg/w$hr4m5BK1wKMt5JwvYnSVyGZqHKC95FbPsoR9nVsoUIo"
};
```

**After:**
```ts
export const LOGIN_SYSTEM_VERSION = "1.3.0";
...
// Rotated 2026-06-23: strong passcode, Argon2id (m=19456,t=2,p=1). See docs/EDIT_LOG.md v2.
export const BOOTSTRAP_ADMIN_PASSWORD_HASH: PasswordHashRecord = {
  algorithm: "argon2id",
  encoded: "$argon2id$v=19$m=19456,t=2,p=1$ptZbFeX582X4+1WJnQ53bw$xyPiz56XTjHm+9hpNiv1efZfLJGPMNZYW3mIT/7D3lI"
};
```

**File:** `src/auth/authSession.ts`

**Before:** session stored in `sessionStorage`, no expiry.

**After:** session stored in `localStorage` with a 7-day TTL derived from `loginAt`; `readSession()`
clears and rejects expired/invalid sessions.

**File:** `src/auth/AuthGate.tsx`

**Before:** `getRoleLabel` had no `guest` branch (guests saw "الموظف"); successful logins never
upgraded legacy password hashes.

**After:** added a `guest` → "ضيف" branch; after a successful managed-user login, if
`needsRehash(user.passwordHash)` the hash is recomputed and persisted (M3).

**File:** `src/auth/passwordCrypto.ts` / `userManagement.ts` — added `persistUserPasswordHash`
helper used by the login rehash path; `createUserId` now uses `crypto.randomUUID()` when available.

**File:** `src/data/storage/safeWrite.ts`

**Before:** wrote the live file in place after snapshotting `.bak`; lock keyed by bare filename.

**After:** stages serialized content to `${fileName}.tmp`, verifies it, then commits to the live
file and removes the tmp; rolls back from `.bak` on failure (M1). Lock now keyed by
`${dir.name}/${fileName}` (L4).

**File:** `src/data/storage/fileSystemAccess.ts`

**Before:** `newHash` hashed `JSON.stringify(preparedFile, null, 2)` (no trailing newline),
mismatching `readJsonFile` which hashes the raw on-disk text (with the `\n` safeWrite appends).

**After:** `newHash` hashes the exact written bytes (`...+"\n"`) so it round-trips as the next
`baseHash` (M2); `createId` uses `crypto.randomUUID()` when available (L5).

**File:** `src/data/distribution/distributionLog.ts` — `createEventId` uses `crypto.randomUUID()`
when available (L5); clarified `computeDaysRemainingForDeadline` documentation (L7).

**File:** `src/data/answers/answerStorage.ts` — `answerFileName` strips path-dangerous characters
from the username before building the filename (M4).

**File:** `src/App.tsx` — `<TestPanel />` now only renders under `import.meta.env.DEV` (L2).

**File:** `CLAUDE.md` — corrected the role list (5 roles incl. `manager`), corrected the
`safeWrite` description, and added a "Security model (advisory-only)" note (C2, L3).

---

## v2.1 — 2026-06-23 — Expert observation date column ("تاريخ رصد الخبير")

Surfaces the timestamp captured when an employee submits ("تقديم") an inspection — already
stored as `ItemAnswer.submittedAt` — as a dedicated, unified column in both the referrals
table and the results table. New shared label key `col_expert_observation_date`.

**File:** `src/data/labels/labelsStore.ts`

**Before:**
```ts
  col_distribution_date:         "تاريخ التوزيع",
  col_plate_or_container_number: "لوحة / حاوية",
```

**After:**
```ts
  col_distribution_date:         "تاريخ التوزيع",
  col_expert_observation_date:   "تاريخ رصد الخبير",
  col_plate_or_container_number: "لوحة / حاوية",
```

**File:** `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx`

**Before:** the `صور الأشعة المحالة` table had no submitted-at column; `answersMap` was declared
after the `columns` memo.

**After:** added a `submittedAt` column (label `col_expert_observation_date`, `isDate`) to
`buildXrayColumns`, added it to `DEFAULT_VISIBLE`, moved `answersMap` above the `columns` memo,
and injected an accessor that reads `answersMap.get(...)?.submittedAt` so the value renders and
exports per row.

**File:** `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayInspectionResults.tsx`

**Before:**
```ts
{ id: "submittedAt", label: "تاريخ رصد خبير الجودة", widthFr: 14, isDate: true, accessor: () => null },
```

**After:**
```ts
{ id: "submittedAt", label: L.col_expert_observation_date, widthFr: 14, isDate: true, accessor: () => null },
```

---

## v2.3 — 2026-06-23 — DataTable auto-fit columns

The shared `DataTable` used `table-layout: fixed` with forced percentage widths, so columns
could not grow to their content — headers like "المستوى" wrapped to "الم ستو ى". Switched to
content-based auto layout with horizontal scroll. The `widthFr` values and manual resize now act
as preferences rather than hard caps. Affects every table built on `DataTable` (population browse,
inspection results, referrals, reports, archive). Other tables already used auto layout.

**File:** `src/components/DataTable/DataTable.css`

**Before:**
```css
.dt-table-wrap { ... overflow-x: hidden; overflow-y: auto; ... }
.dt-table { width: 100%; table-layout: fixed; ... }
.dt-th-label { ... word-break: break-word; ... }
.dt-td { padding: 9px 12px; ... white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
```

**After:**
```css
.dt-table-wrap { ... overflow-x: auto; overflow-y: auto; ... }
.dt-table { width: 100%; table-layout: auto; ... }
.dt-th-label { ... white-space: nowrap; ... }
.dt-td { padding: 9px 12px; ... white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 340px; }
```

---

## v2.4 — 2026-06-23 — Fix: newly-added columns invisible under an older saved column config

A column added to a table (e.g. `submittedAt` / "تاريخ رصد الخبير") never rendered for users whose
column config was persisted before it existed: `visibleCols` and both drag handlers read strictly
from `colCfg.order`, and toggling it visible in the picker only edited `hidden`, never `order`.
Introduced a `normalizedOrder` that reconciles the saved order with the current columns (keeps known
ids in place, prepends missing alwaysVisible, appends other missing columns, drops stale ids), and
based rendering + reordering on it.

## v3 — 2026-06-23 — Admin role-preview switcher (impersonate roles to test permissions)

Added an admin-only control in the top toolbar (next to "تسجيل الخروج") to preview the app as any
role — ضيف / الموظف / المشرف / المدير / الإدارة — so an admin can verify each role's tabs and
permissions without logging in as them. The preview overrides only the *role*; the real identity
(username) is preserved, so actions stay attributed to the admin. Stored in `sessionStorage`
(`xray_preview_role_v1`) so it never outlives the tab; cleared on logout.

**File:** `src/auth/authSession.ts` — added `readPreviewRole` / `setPreviewRole`; split
`readRealSession` (identity, ignores override) from `readSession` (effective: real identity with the
role swapped when a real admin is impersonating). `clearSession` now also clears the preview.

**File:** `src/auth/AuthGate.tsx` — `getInitialSession` uses `readRealSession`; added `previewRole`
state + `changePreviewRole`; the toolbar renders a role-chip switcher (real-admin only) and passes
the *effective* session to children; impersonation recolours the bar and shows a "(معاينة)" flag.

**File:** `src/App.tsx` — `AppContent` is keyed by `session.role` so switching the previewed role
remounts the app subtree (components that read the session once at mount re-read it).

**File:** `src/auth/AuthGate.css` — styles for `.auth-role-preview` / `.auth-role-chip` and the
amber `.auth-toolbar-preview` impersonation indicator.

---

## v3.2 — 2026-06-23 — Role-preview: segmented switch (not buttons, not select)

The role-preview control is now a **connected pill segmented switch**: all role options
sit inside one rounded pill container so they look and feel like a single toggle switch,
not a row of detached buttons. Active segment slides a white thumb. Grouped with
تسجيل الخروج on the right side of the toolbar.

**File:** `src/auth/AuthGate.tsx` — replaced `<select>` with `.auth-role-switcher` +
`.auth-role-seg` button pattern (still a group of buttons, but visually a unified switch).

**File:** `src/auth/AuthGate.css` — replaced select styles with `.auth-role-switcher`
(pill container) and `.auth-role-seg` (transparent segments; `.active` gets white thumb +
shadow). Amber-bar variant preserved.

---

## v3.3 — 2026-06-23 — Supervisor view toggle in صور الأشعة المحالة

Supervisors and admins can now switch between "الكل" (see everyone's rows) and
"مسنداتي فقط" (see only rows assigned to the current logged-in user) using a segmented
switch at the top of the table. Employees and guests are unaffected.

**File:** `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx`
- Added `showMyOnly` boolean state (default false).
- Added `displayEntries` useMemo that filters `entries` to `assignedTo === username`
  when `canSeeAll && showMyOnly`.
- Changed DataTable `rows` prop from `entries` to `displayEntries`.
- Added `.ew-view-switcher` / `.ew-view-seg` segmented switch in `toolbarStart`,
  visible only when `canSeeAll`.

**File:** `src/components/Sidebar/Tabs/EmployeeWorkspace/EmployeeWorkspace.css`
- Added `.ew-view-switcher` pill container and `.ew-view-seg` / `.ew-view-seg.active`
  styles matching the auth-gate segmented-switch design.

---

## v3.4 — 2026-06-23 — Replacement candidate pool capped at 1000 (performance)

Opening the replacement dialog previously rendered ALL eligible population rows in the
UI, causing severe lag on large populations (10 000+ rows). The candidate pool is now
capped at 1000 random entries for both "recommended" and "all" tabs before returning
from `getReplacementCandidates`. The random shuffle (Fisher-Yates) ensures no systematic
bias in which 1000 are shown.

**File:** `src/data/distribution/replacement.ts`

**Before:**
```ts
if (sameStage.length > 0) {
  return { recommended, all: sameStage };
}
// ...
return { recommended: [], all: fallbackStage?.[1] ?? [] };
```

**After:**
```ts
const REPLACEMENT_POOL_LIMIT = 1000;
// ...
if (sameStage.length > 0) {
  return {
    recommended: capRandom(recommended, REPLACEMENT_POOL_LIMIT),
    all: capRandom(sameStage, REPLACEMENT_POOL_LIMIT),
  };
}
// ...
return { recommended: [], all: capRandom(fallbackStage?.[1] ?? [], REPLACEMENT_POOL_LIMIT) };
```

---

## v3.5 — 2026-06-23 — Fix BI dataset not recognized for non-standard sheet names

The BI workbook parser rejected any sheet whose name did not contain "وارد" or "صادر",
adding it to `unknownSheetNames` and skipping all its rows. This caused the entire BI
file to show as "not recognized" when the user's Excel uses non-standard sheet naming.

Fixed by returning the sheet's own name as the source when no pattern matches (instead of
null). All sheets are now processed; the `unknownSheetNames` list will always be empty
for BI-only files. Recognized sheet names ("بحري وارد" etc.) continue to work as before.

**File:** `src/components/Sidebar/Tabs/Population/biData/biDataWorkbook.ts`

**Before:**
```ts
  return null; // ← caused sheet to be skipped entirely
}
```

**After:**
```ts
  // No pattern matched — process the sheet anyway using its own name as the source.
  return sheetName;
}
```

---

## v3.6 — 2026-06-23 — Permission matrix: sub-tabs hidden when role has no view permission

Sub-tabs inside employee-workspace (لوحة الإحصائيات, صور الأشعة المحالة, نتائج فحص الأشعة,
اعتماد الطلبات, نموذج الفحص) were always shown in the sidebar regardless of permissions —
the permission gate only showed `<AccessDenied />` after clicking. Now the sidebar only
renders sub-tabs the current role can actually view.

**File:** `src/App.tsx` — `allowedTabs` useMemo now maps each tab through a sub-tab
filter. For `employee-workspace`, sub-tab IDs are prefixed `ew/` to match MANAGED_TABS
entries, then filtered by `hasRolePermission(..., "view")`.

**Before:**
```ts
return SIDEBAR_TABS.filter(tab => ... && hasRolePermission(...));
```

**After:**
```ts
return SIDEBAR_TABS
  .filter(tab => ... && hasRolePermission(...))
  .map(tab => {
    if (!tab.subTabs?.length) return tab;
    const prefix = tab.id === "employee-workspace" ? "ew/" : `${tab.id}/`;
    const allowedSubTabs = tab.subTabs.filter(sub =>
      hasRolePermission(permissions, session.role, `${prefix}${sub.id}`, "view")
    );
    return { ...tab, subTabs: allowedSubTabs };
  });
```

---

## v3.1 — 2026-06-23 — Role-preview: dropdown toggle, grouped with تسجيل الخروج

Replaced the row of chip buttons with a compact `<select>` dropdown and moved it into a
flex group with تسجيل الخروج so both controls sit together on the left end of the toolbar.
In RTL flex the select appears immediately to the right of the logout button.

**File:** `src/auth/AuthGate.tsx`

**Before:**
```tsx
{isRealAdmin && (
  <div className="auth-role-preview" role="group">
    <span className="auth-role-preview-label">معاينة كـ:</span>
    {PREVIEW_ROLE_IDS.map((id) => <button className="auth-role-chip ...">...</button>)}
  </div>
)}
<button onClick={logout}>تسجيل الخروج</button>
```

**After:**
```tsx
<div className="auth-toolbar-end">
  {isRealAdmin && (
    <select className="auth-role-select" value={effectiveRole} onChange={...}>
      {PREVIEW_ROLE_IDS.map((id) => <option value={id}>...</option>)}
    </select>
  )}
  <button onClick={logout}>تسجيل الخروج</button>
</div>
```

**File:** `src/auth/AuthGate.css` — replaced `.auth-role-preview` / `.auth-role-chip` /
`.auth-role-preview-label` with `.auth-toolbar-end` flex group and `.auth-role-select`
styled dropdown (custom SVG chevron, hover/focus rings, amber-bar variant).

---

## v2.5 — 2026-06-23 — Fix: "تاريخ رصد الخبير" missing in Inspection Results

The Inspection Results table has no column picker (`canConfigureColumns={false}`) and derives its
visible sample columns from the shared referrals preset via `getVisibleSampleColumns`. That helper
had the same order-based drop as DataTable, and the preset→config mapping auto-marked any column not
in the old preset's `visibleColumns` as hidden — so a newly added column could never appear and
couldn't be toggled on. Fixed by (a) only hiding columns the preset actually knew about
(`columnOrder.includes(id)`) and (b) appending sample columns missing from the saved order. Applied
the same `columnOrder` guard to the referrals preset for consistency.

**File:** `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayInspectionResults.tsx`
— `getVisibleSampleColumns` now appends columns missing from the saved order; the preset→config
`hidden` only includes columns present in `preset.columnOrder`.

**File:** `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx`
— `colPreset.hidden` only includes columns present in `p.columnOrder` (new columns default visible).

---

## v2.4 — 2026-06-23 — Fix: newly-added columns invisible under an older saved column config

A column added to a table (e.g. `submittedAt` / "تاريخ رصد الخبير") never rendered for users whose
column config was persisted before it existed: `visibleCols` and both drag handlers read strictly
from `colCfg.order`, and toggling it visible in the picker only edited `hidden`, never `order`.
Introduced a `normalizedOrder` that reconciles the saved order with the current columns (keeps known
ids in place, prepends missing alwaysVisible, appends other missing columns, drops stale ids), and
based rendering + reordering on it.

**File:** `src/components/DataTable/index.tsx`

**Before:**
```ts
const orderedIds = new Set(colCfg.order);
const missingAlways = columns.filter((c) => c.alwaysVisible && !orderedIds.has(c.id));
const visibleCols = [
  ...missingAlways,
  ...colCfg.order.map((id) => columns.find((c) => c.id === id)).filter(...),
].filter((c) => !colCfg.hidden.includes(c.id) && (!c.adminOnly || isAdmin));
// ...
function handleDrop(targetId) { const order = [...colCfg.order]; ... }
```

**After:**
```ts
const normalizedOrder = useMemo(() => { /* kept ∪ missingAlways(prepend) ∪ missingRest(append) */ }, [columns, colCfg.order]);
const visibleCols = normalizedOrder
  .map((id) => columns.find((c) => c.id === id)).filter(...)
  .filter((c) => !colCfg.hidden.includes(c.id) && (!c.adminOnly || isAdmin));
// ...
function handleDrop(targetId) { const order = [...normalizedOrder]; if (sp<0||tp<0) return; ... }
```

---

## v4.4 — 2026-06-23 — XLSX export for all report cards + auth footer workspace button

**File:** `src/auth/AuthGate.tsx`

Added "تغيير المجلد" button in the login card footer using `selectWorkspace()` from `useWorkspace`.

**Before:**
```tsx
<footer className="auth-footer">
  <span>Local Gate v{LOGIN_SYSTEM_VERSION}</span>
  <button type="button" onClick={logout}>مسح الجلسة</button>
</footer>
```
**After:**
```tsx
<footer className="auth-footer">
  <span>Local Gate v{LOGIN_SYSTEM_VERSION}</span>
  <div className="auth-footer-actions">
    <button type="button" className="auth-footer-change" onClick={() => { void selectWorkspace(); }}>
      تغيير المجلد
    </button>
    <button type="button" onClick={logout}>مسح الجلسة</button>
  </div>
</footer>
```

**File:** `src/auth/AuthGate.css`

Added `.auth-footer-actions` flex group and `.auth-footer-change` style with `↗` prefix.

**File:** `src/data/reporting/distributionReport.ts`

Added `buildDistributionXlsx(data, monthFolderName)` — exports 3-sheet XLSX:
ملخص / ملخص الموظفين / تفاصيل التوزيع (all rows with full `PreparedPopulationRow` fields).

**File:** `src/data/reporting/executiveReport.ts`

Added `buildExecutiveXlsx(input)` — exports 4-sheet XLSX:
مؤشرات الأداء / تحليل المنافذ / المراحل / كل الصفوف (every image with all derived KPI fields).

**File:** `src/components/Sidebar/Tabs/Reports/index.tsx`

- `ReportType` union extended with `"distribution-xlsx"` and `"executive-xlsx"`
- Imported `buildDistributionXlsx` and `buildExecutiveXlsx`
- Each of the three report cards (executive, sample, distribution) now has two buttons: HTML › and XLSX ↓
- `generate()` branches handle all six report types

---

## v4.3 — 2026-06-23 — Sample report rewrite (rich HTML + XLSX) and executive report 5-slide restructure

**File:** `src/data/reporting/executiveReport.ts`

Rewrote from 8 slides to 5 compact slides. Removed الحالة column from the port table.
Eliminated slide duplication (KPI cards appeared in slides 1 & 6; port analysis in slides 2 & 7;
single-month trend chart on slide 7 was meaningless). Merged overlapping content:
- Slide 1: Executive summary — 6 KPI cards + donut + port bar chart + rank list + insights strip
- Slide 2: Port analysis — port table (no الحالة) + stacked bars + L1/L2 dual bars per port
- Slide 3: Stage coverage + plan KPIs strip + quality metrics (absorbed slide 6's plan data)
- Slide 4: Verification matrix + L1/L2 comparison (merged slides 4 & 5)
- Slide 5: Priority ports + decisions list + executive callout (merged slides 7 & 8)

**File:** `src/data/population/populationConfig.ts`

Exported `MONTHLY_SAMPLE_TARGET` (6500) and `STAGE_SAMPLE_TARGETS` as named exports
so they can be imported by other modules.

**Before:**
```ts
// constants were only defined in Population/index.tsx, not exported
const MONTHLY_SAMPLE_TARGET = 6500;
```

**After:**
```ts
export const MONTHLY_SAMPLE_TARGET = 6500;
export const STAGE_SAMPLE_TARGETS: Record<"first" | "second" | "third" | "fourth", number | null> = {
  first: null, second: 2500, third: 1875, fourth: 1875,
};
```

**File:** `src/data/reporting/executiveReportTypes.ts`

`DEFAULT_EXEC_CONFIG.monthlyTarget` now reads from `MONTHLY_SAMPLE_TARGET` (was hardcoded 0).

**File:** `src/data/reporting/sampleReport.ts`

Full rewrite. Old: 69-line basic HTML with port allocation table + 20-row preview.
New: rich multi-section HTML (raw vs processed diff, per-port breakdown showing Risk+BI+CertScan,
stage breakdown, 50-row sample preview) plus `buildSampleXlsx()` generating a 5-sheet XLSX
(ملخص / تفصيل المنافذ / المراحل / العينة المسحوبة / كامل المجتمع). New signature takes
`SampleReportInput` with `{ monthFolderName, manifest, populationRows, sample }`.

**File:** `src/components/Sidebar/Tabs/Reports/index.tsx`

- Import `openSampleReport`, `buildSampleXlsx` (replacing old `buildSampleReport`)
- Import `loadMonthForEditing` for richer data load
- Added `"sample-xlsx"` to `ReportType` union
- Sample card now has two buttons: HTML and XLSX
- Updated card description to reflect new rich content

---

## v4.1 — 2026-06-23 — Reports Hub: card-grid page design

**File:** `src/components/Sidebar/Tabs/Reports/index.tsx`

Replaced the dropdown-based reports form with a full card-grid hub (مركز التقارير).

**Before:**
```tsx
// Single panel with two <select> dropdowns (month + report type) and one generate button
<div className="rpt-panel">
  <h2>إعدادات التقرير</h2>
  <div className="rpt-controls">…</div>
  <button>توليد التقرير</button>
  <div className="rpt-info">…</div>
</div>
```

**After:**
```tsx
// Page header + month bar with metadata chips + card grid (executive/sample/distribution/
// department-soon/xlsx-note) + quick-actions strip. Each card has its own generate button.
// Month bar auto-loads population count, sample count, and submitted-answer count as chips.
<section className="rh-page">
  <div className="rh-header">…</div>
  <div className="rh-month-bar">…chips…</div>
  <div className="rh-grid">…5 cards…</div>
  <div className="rh-quick">…quick buttons…</div>
</section>
```

Also fixed: `f.answers` → `f.items` (correct field on `EmployeeAnswerFile`).

**File:** `src/components/Sidebar/Tabs/Reports/Reports.css`

Complete CSS rewrite for the new hub layout — navy/teal design system, card grid,
accent strips, badges, chips, spinner, toast notification, quick-actions strip.

**File:** `src/data/reporting/executiveReport.ts`

Removed unused parameters (`monthLabel` from slide5/slide6, `config` from slide7) and
removed unused `l1l2Same` variable. Matched call sites accordingly.

**File:** `src/data/reporting/executiveReportData.ts`

Removed three unused `import type` lines (`PreparedPopulationRow`, `DistributionCurrentData`,
`EmployeeAnswerFile`) — these flow through `ExecutiveReportInput` already.

---

## v4.0 — 2026-06-23 — Executive Report: 8-slide HTML presentation module

**File:** `src/data/reporting/executiveReportTypes.ts` *(new)*

Defines all TypeScript types for the executive report: `ExecutiveReportRow`, `PortProfile`, `StageProfile`, `ExecutiveKPIs`, `ExecutiveReportConfig`, `DEFAULT_EXEC_CONFIG`, `ExecutiveReportInput`, `VerificationCategory`.

**Before:** *(file did not exist)*

**After:** *(full type definitions as documented above)*

---

**File:** `src/data/reporting/executiveReportData.ts` *(new)*

Data joining, KPI engine, and Arabic narrative generator.

- `buildExecutiveReportRows()`: joins population + sample + distribution + submitted answers into `ExecutiveReportRow[]`
- `calculateExecutiveKPIs()`: computes all KPIs including per-port and per-stage profiles; port status classification (excellent/stable/monitor/priority/insufficient)
- `generateNarrativeFindings()`: produces up to 3 Arabic executive findings
- `fmtNum()`, `fmtPct()`, `fmtK()`: display helpers

**Before:** *(file did not exist)*

**After:** *(full implementation)*

---

**File:** `src/data/reporting/executiveReport.ts` *(new)*

Main 8-slide HTML builder.

- Exports `buildExecutiveReport(input)` and `openExecutiveReport(input)`
- Slide 1: executive summary — 5 KPI cards + bar chart + donut + rank list + insights strip
- Slide 2: port performance table + stacked bars + executive callout
- Slide 3: stage coverage cards + stage bar chart + monthly plan strip
- Slide 4: verification matrix table + summary cards + rule explanations
- Slide 5: L1 vs L2 comparison grid + dual-bar chart per port
- Slide 6: management KPIs + plan tracking table + quality indicators
- Slide 7: performance trend SVG (graceful single-month fallback) + priority port cards
- Slide 8: decisions list + executive callout + success targets
- CSS: navy/teal design system, Somar via `local()`, RTL, 13.333in×7.5in slides
- Navigation: keyboard (ArrowLeft/Right/Home/End) + toolbar + print/PDF

**Before:** *(file did not exist)*

**After:** *(full implementation)*

---

**File:** `src/components/Sidebar/Tabs/Reports/index.tsx`

**Before:**
```ts
type ReportType = "sample" | "distribution";
const REPORT_LABELS: Record<ReportType, string> = {
  sample: "تقرير العينة",
  distribution: "تقرير التوزيع"
};
// generate handler: sample | distribution branches only
```

**After:**
```ts
type ReportType = "sample" | "distribution" | "executive";
const REPORT_LABELS: Record<ReportType, string> = {
  sample: "تقرير العينة",
  distribution: "تقرير التوزيع",
  executive: "التقرير التنفيذي"
};
// generate handler: adds executive branch — loads population, sample,
// distribution, and all employee answer files, then calls openExecutiveReport()
```

---

## v4.5 — 2026-06-29 — Fix: executive report badgeHtml CSS class injection, sidebar nav labels

**File:** `src/data/reporting/executive/primitives.ts`

**Before:**
```ts
export function badgeHtml(status: "excellent" | "stable" | "monitor" | "priority" | "insufficient" | string): string {
  const labels: Record<string, string> = {
    excellent: "ممتاز", stable: "مستقر", monitor: "متابعة", priority: "أولوية", insufficient: "بيانات غير كافية",
  };
  return `<span class="xr-badge ${esc(status)}">${esc(labels[status] ?? status)}</span>`;
}
```

**After:**
```ts
export function badgeHtml(status: "excellent" | "stable" | "monitor" | "priority" | "insufficient" | string): string {
  const labels: Record<string, string> = {
    excellent: "ممتاز", stable: "مستقر", monitor: "متابعة", priority: "أولوية", insufficient: "بيانات غير كافية",
  };
  const CSS_CLASS: Record<string, string> = {
    excellent: "excellent",
    stable: "stable",
    monitor: "monitor",
    priority: "priority",
    insufficient: "insufficient",
  };
  return `<span class="xr-badge ${CSS_CLASS[status] ?? "insufficient"}">${esc(labels[status] ?? status)}</span>`;
}
```

**File:** `src/data/reporting/executive/assemble.ts`

**Before:**
```ts
  { label: "الجزء الخامس: الفجوات", id: "page-p5" },
  { label: "الجزء السادس: التوصيات", id: "page-p6" },
```

**After:**
```ts
  { label: "الجزء الخامس: أداء الموظفين", id: "page-p5" },
  { label: "الجزء السادس: الأولويات", id: "page-p6" },
```

---

## v28 — 2026-06-30 — design system: shared primitives layer + token extensions + gentle global form polish

Foundation phase of the "Refined Cohesion" UI elevation (spec: `docs/superpowers/specs/2026-06-30-refined-cohesion-ui-design.md`). Adds a single source of truth for buttons/cards/stats/badges/fields so tabs stop re-rolling their own. Additive and low-risk: new tokens, a new opt-in `primitives.css`, two thin React wrappers, and a gentle base style for otherwise-unstyled native form controls (component classes still override).

**File:** `src/index.css`

**Before:**
```css
  --r-2xl: 16px;

  /* ── Motion ────────────────────────────────────────────────── */
```

**After:**
```css
  --r-2xl: 16px;

  /* ── Spacing scale (4px base) ──────────────────────────────── */
  --sp-1:  4px;   --sp-2:  8px;   --sp-3:  12px;  --sp-4:  16px;
  --sp-5:  20px;  --sp-6:  24px;  --sp-8:  32px;  --sp-10: 40px;  --sp-12: 48px;

  /* ── Derived / signature tokens ────────────────────────────── */
  --focus-ring:        0 0 0 3px rgba(0, 154, 222, 0.28);
  --surface-raised:    #FFFFFF;
  --accent-gradient:   linear-gradient(135deg, var(--c-navy-2), var(--c-navy));
  --sky-gradient:      linear-gradient(135deg, var(--c-sky), var(--c-sky-2));
  --premium-hairline:  linear-gradient(90deg, transparent, rgba(218, 163, 40, 0.45), transparent);

  /* ── Motion ────────────────────────────────────────────────── */
```

**File:** `src/index.css`

**Before:**
```css
::selection {
  background: rgba(0, 154, 222, 0.18);
}
```

**After:**
```css
::selection {
  background: rgba(0, 154, 222, 0.18);
}

/* ── Base native form controls — quiet default; component classes override ── */
input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]):not([type="file"]),
select,
textarea {
  border: 1px solid var(--c-border);
  border-radius: var(--r-sm);
  background: var(--c-surface);
  color: var(--c-ink);
}

input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]):not([type="file"]):hover:not(:disabled),
select:hover:not(:disabled),
textarea:hover:not(:disabled) {
  border-color: var(--c-border-2);
}
```

**File:** `src/main.tsx`

**Before:**
```tsx
import "./index.css";
```

**After:**
```tsx
import "./index.css";
import "./styles/primitives.css";
```

**File:** `src/styles/primitives.css` (new) — canonical `.ui-btn`, `.ui-card`, `.ui-stat`, `.ui-badge`, `.ui-field`, `.ui-section`, `.ui-toolbar` built entirely from tokens.

**File:** `src/components/ui/Button.tsx` (new) — thin presentational wrapper rendering `.ui-btn` variants/sizes.

**File:** `src/components/ui/StatCard.tsx` (new) — thin presentational KPI card rendering `.ui-stat`.

**File:** `docs/design-system.md` (new) — token + primitive usage reference.

---

## v28.1 — 2026-06-30 — design system: token migration + polish across component surfaces (parallel agent pass)

Surface-by-surface refinement consuming the v28 foundation. Off-token hardcoded hex replaced with nearest tokens; ad-hoc paddings moved to the `--sp-*` scale; shadows unified to `--sh-*` tiers; `transition: all` replaced with explicit, token-driven property transitions; focus rings unified to `box-shadow: var(--focus-ring)`. Behavior and class names unchanged (TSX selectors preserved). Representative changes per file:

**File:** `src/App.css`

**Before:**
```css
  padding: 22px 24px 28px;
  /* ... */
  background: linear-gradient(90deg, transparent, rgba(218, 163, 40, 0.32), transparent);
```

**After:**
```css
  padding: var(--sp-5) var(--sp-6) var(--sp-8);
  /* ... */
  background: var(--premium-hairline);
```

**File:** `src/components/DataTable/DataTable.css`

**Before:**
```css
.dt-search:focus { box-shadow: 0 0 0 3px rgba(0, 154, 222, 0.12); }
.dt-th-label { font-weight: 700; }
```

**After:**
```css
.dt-search:focus { box-shadow: var(--focus-ring); }
.dt-th-label { font-weight: 500; }   /* + font-variant-numeric: tabular-nums on .dt-td */
```

**File:** `src/auth/AuthGate.css` — snapped the login's drifted palette to tokens (`--auth-primary #0F2744 → var(--c-navy)`, `--auth-accent #2D7DD2 → var(--c-sky)`, `--auth-accent-light #5EB8FF → var(--c-sky-2)`, `--auth-border-focus → var(--c-sky)`) and simplified the layered decorative gradients/effects to a calmer, more professional treatment.

**Before:**
```css
  --auth-primary:  #0F2744;
  --auth-accent:   #2D7DD2;
  --auth-accent-light: #5EB8FF;
```

**After:**
```css
  --auth-primary:  var(--c-navy, #0E2444);
  --auth-accent:   var(--c-sky, #009ADE);
  --auth-accent-light: var(--c-sky-2, #007FBA);
```

**File:** `src/components/Sidebar/Tabs/Archive/Archive.css` — raw hex → tokens, `border-radius` → `--r-lg`, `box-shadow` → `--sh-xs`, paddings → `--sp-*`.

**File:** `src/components/Sidebar/Tabs/Reports/Reports.css` — empty-state colors → tokens (`#06244a → var(--c-navy)`, `#637188 → var(--c-ink-3)`), added resting `--sh-xs`, spacing → `--sp-*`.

**File:** `src/components/Sidebar/Tabs/Settings/Settings.css` — danger reset button gains a filled hover (`background/border var(--c-danger); color #FFF`); `transition: all` → explicit token-driven transitions.

**File:** `src/components/Sidebar/Tabs/Population/Population.css` — off-token hex → palette/semantic tokens; spacing → `--sp-*`.

**File:** `src/components/Sidebar/Tabs/EmployeeWorkspace/EmployeeWorkspace.css` — off-token hex → tokens; KPI/quota styling aligned; chart container surfaces on-token.

**File:** `src/components/Sidebar/Tabs/UserManagement/UserManagement.css` — off-token hex → tokens; focus rings unified.

---

## v28.2 — 2026-06-30 — design system: shell-adjacent + misc surface touch-ups

Final sweep. Most remaining component CSS (TemplateBuilder, PageHeader, AdminToolbar, WorkspaceGate, ErrorLogSection, FeedbackWidget, DataAccuracyReport) was already token-clean and left unchanged. Minor refinements only:

**File:** `src/components/Sidebar/Sidebar.css` — active nav-item accent / focus refinement using motion + focus-ring tokens.

**File:** `src/components/InspectionPanel/InspectionPanel.css` — off-token hex → palette tokens.

---

## v28.3 — 2026-06-30 — visible polish pass (every-screen surfaces)

The v28.x token migration was visually a no-op (hex → tokens that resolve to identical pixels). This pass makes deliberately *visible* changes to the highest-frequency shared surfaces.

**File:** `src/components/Sidebar/Sidebar.css`

**Before:**
```css
.sidebar-nav-item.active {
  background: rgba(0, 154, 222, 0.18);
  color: #FFFFFF;
  font-weight: 700;
  box-shadow: inset 3px 0 0 var(--sb-accent);
}
```

**After:**
```css
.sidebar-nav-item.active {
  background:
    linear-gradient(90deg, rgba(0, 154, 222, 0.26), rgba(0, 154, 222, 0.10) 70%, transparent);
  color: #FFFFFF;
  font-weight: 700;
  box-shadow:
    inset 3px 0 0 var(--sb-accent),
    0 4px 14px rgba(0, 154, 222, 0.20);
}
.sidebar-nav-item.active .sidebar-nav-icon {
  filter: drop-shadow(0 0 6px rgba(0, 154, 222, 0.55));
}
```

**File:** `src/components/PageHeader/PageHeader.css` — added a premium-hairline accent over the divider (`.page-header::after`), a leading gold accent tick before the eyebrow (`.page-header-eyebrow::before`), and bumped eyebrow weight 600→700.

**File:** `src/App.css`

**Before:**
```css
  background:
    linear-gradient(180deg, rgba(14, 36, 68, 0.035), transparent 220px),
    var(--app-bg);
```

**After:**
```css
  background:
    var(--app-canvas-tint),
    var(--app-bg);
```

**File:** `src/styles/primitives.css` — `.ui-stat::before` accent bar widened 3px→4px and changed from flat `--c-sky` to `--sky-gradient`; `--premium` variant now uses `--gold-accent-bar`.

## v29 — 2026-06-30 — viewer/demo mode (login bypass + read-only) + visible polish wiring

Adds a built-in `viewer` / `view` account that mounts a read-only, in-memory demo
workspace and skips the folder picker, so the app can be explored end-to-end (and
visually verified) without a real workspace. Admin-level visibility; all disk
writes are no-ops (exports still work). Also wires previously-defined premium
tokens into visible surfaces.

**File:** `src/data/storage/readOnlyMode.ts` (new) — `setReadOnlyMode` / `isReadOnlyMode` global guard.

**File:** `src/data/storage/safeWrite.ts` — `safeWriteJson` and `safeWriteJsonText` early-return when `isReadOnlyMode()` is true.

**File:** `src/auth/authConfig.ts` — added `VIEWER_USERNAME = "viewer"` / `VIEWER_PASSWORD = "view"` (delete this block to remove the demo account).

**File:** `src/auth/authTypes.ts` — `AuthSession` gains optional `mode?: "demo"`.

**File:** `src/data/workspace/demoWorkspace.ts` (new) — `createDemoWorkspace()` builds an in-memory directory and runs `createWorkspaceStructure` (seeds the 5 default managed users).

**File:** `src/data/workspace/WorkspaceContext.ts` / `WorkspaceProvider.tsx` — new `enterDemoWorkspace()` mounts the demo workspace and enables read-only; `clearWorkspace()` disables read-only.

**File:** `src/auth/AuthGate.tsx` — viewer-credential check in `loginAsEmployee` (mounts demo, sets a non-persisted demo session); `logout` tears the demo workspace down.

**File:** `src/App.tsx` — gate reorder (AuthGate now outermost → login first), read-only demo banner, and the admin auto-backup effect skips demo sessions.

**File:** `src/components/DataTable/DataTable.css` — `.dt-th` header now uses `var(--table-head-bg)`.

**File:** `src/styles/primitives.css` — `.ui-btn--primary` uses `--sky-gradient` + `--sh-sky` for subtle premium depth.

---

## v29.1 — 2026-06-30 — fix: restore connect-first workflow; demo entry moved to the picker

The v29 gate reorder (login-first) was wrong: the workspace folder holds the
users/permissions file, so the app must connect to the address FIRST to load the
user list before login can validate against it. Reverted to picker-first and moved
the demo entry to the picker screen instead.

**File:** `src/App.tsx` — reverted gate order back to `WorkspacePicker` → `AuthGate` → `WorkspaceGate` (connect first, then login).

**File:** `src/data/workspace/WorkspaceGate.tsx` — the workspace-picker screen gains a "وضع العرض التجريبي (بدون مجلد)" button that calls `enterDemoWorkspace()` (mounts the in-memory demo, no folder required).

**File:** `src/data/workspace/demoWorkspace.ts` — exported `DEMO_WORKSPACE_NAME` constant.

**File:** `src/auth/AuthGate.tsx` — auto-login into the read-only demo session keyed on `directoryHandle?.name === DEMO_WORKSPACE_NAME` (StrictMode-safe; replaces the earlier consumable-flag approach that lost the session on StrictMode remount). The `viewer`/`view` typed-login path is retained as a secondary entry.

**File:** `src/data/storage/readOnlyMode.ts` — removed the now-unused `setDemoLoginPending`/`takeDemoLoginPending` flag helpers.

**Verified live:** picker shows first; the demo button enters the app in one click with the read-only banner, full admin nav, and a populated Population tab; build green; lint clean (only pre-existing `executive/pages` errors remain).

---

## v29.2 — 2026-06-30 — view mode: hidden Alt+A+T passcode entry (replaces visible button)

Made the demo/view entry a hidden backdoor mirroring the admin shortcut, instead of
a visible button on the address picker.

