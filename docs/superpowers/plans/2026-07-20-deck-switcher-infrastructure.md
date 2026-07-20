# Deck2 Design-Set Switcher Infrastructure — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the executive deck's existing-but-unused 4-slot variant mechanism into a real, user-facing feature: a global "design set" control in the report's own toolbar (next to the light/dark toggle and print button), plus per-slide override arrows, that work in the actual generated/printed report — not just the dev-preview tool.

**Architecture:** A slide already renders through `renderVariants(slideId, bodyVariants, ...)`. Today that function only stacks all 4 panels when `variantPreview` is true (dev tool); production always renders `bodies[0]`. This plan changes the condition from "is this the dev tool?" to "does this slide actually have ≥2 distinct designs?" — computed automatically by counting distinct strings among the 4 slots, so **zero existing slide-builder call sites need to change their content** (every slide today passes the same body 4×, so nothing becomes switchable until a future slide-design pass — sub-project 3, explicitly out of scope here — gives it real alternates). A new toolbar control and a new lightweight client script (in-memory only, no persistence, mirroring the theme toggle's own behavior) drive the switching once a slide qualifies.

**Tech Stack:** Plain TypeScript string-templating (no framework — this deck ships as inline HTML/CSS/JS), Vitest for tests.

## Global Constraints

- **EDIT_LOG requirement (CLAUDE.md):** before applying any code edit in this repo, record it in `docs/EDIT_LOG.md` with version, date, what changed, before/after snippets. Every task below that touches code needs an EDIT_LOG entry as part of its commit.
- **Scope:** `src/data/reporting/executive/deck2/` only. Do not touch `src/data/reporting/executive/deck/` (v1, reference edition) or the Document/Workbook editions.
- **No persistence:** the design-set choice resets to defaults every time the report is reopened — matching the existing theme toggle in the same toolbar. Do not add `localStorage` or any server call.
- **RTL/Arabic:** all new user-visible strings are Arabic; no hard-coded English UI text.
- **Print behavior:** `@media print` must hide the new toolbar control (matching `.theme-toggle`'s existing `@media print{display:none!important}`), and must not otherwise change — a slide's currently-active panel is what prints, which already works via existing `.v2-variant-panel.active{display:flex}` CSS (verified in Task 5, not re-derived).
- **Reference spec:** `docs/superpowers/specs/2026-07-20-deck-design-sets-design.md` — read this before starting; this plan implements only its "Switcher infrastructure" section, not the 4 design directions themselves.

---

### Task 1: `realVariantCount()` + rework `renderVariants()`'s branching contract

**Files:**
- Modify: `src/data/reporting/executive/deck2/slides.ts:213-226` (the `renderVariants` function)
- Modify: `src/data/reporting/executive/deck2/theme.ts:449` (stale comment)
- Test: `src/data/reporting/executive/deck2/deck2.test.ts`

**Interfaces:**
- Produces: `export function realVariantCount(bodies: readonly [string, string, string, string]): number` — counts distinct strings among the 4 slots.
- Produces: `export function renderVariants(slideId: string, bodies: readonly [string, string, string, string], showSwitcher: boolean): string` — **signature change**: third param is now a resolved `showSwitcher` boolean, not `variantPreview`. When `false`, returns `bodies[0]` unchanged (byte-identical to today). When `true`, wraps all 4 bodies in the existing `.v2-variant-stack`/`.v2-variant-panel` markup (byte-identical markup shape to today's preview-mode output).
- Consumes (Task 2 will supply this): callers must now compute `showSwitcher = variantPreview || realVariantCount(bodies) >= 2` themselves before calling `renderVariants`.

- [ ] **Step 1: Write the failing tests**

Add to `src/data/reporting/executive/deck2/deck2.test.ts` (new top-level `describe`, after the existing `describe("buildExecutiveDeckV2 — preview mode", ...)` block):

```ts
describe("realVariantCount", () => {
  it("counts 1 when all four slots are identical (today's state for every slide)", () => {
    expect(realVariantCount(["a", "a", "a", "a"])).toBe(1);
  });

  it("counts distinct slots regardless of position", () => {
    expect(realVariantCount(["a", "b", "a", "a"])).toBe(2);
    expect(realVariantCount(["a", "b", "c", "c"])).toBe(3);
    expect(realVariantCount(["a", "b", "c", "d"])).toBe(4);
  });
});

describe("renderVariants", () => {
  it("returns the plain body untouched when showSwitcher is false", () => {
    const html = renderVariants("slide-x", ["A", "A", "A", "A"], false);
    expect(html).toBe("A");
  });

  it("wraps all 4 bodies in a variant-stack when showSwitcher is true, even if identical", () => {
    const html = renderVariants("slide-x", ["A", "A", "A", "A"], true);
    expect(html).toContain('<div class="v2-variant-stack" data-slide-id="slide-x" data-active-index="0">');
    const panelOpens = [...html.matchAll(/<div class="v2-variant-panel(?: active)?" data-variant-index="\d"/g)];
    expect(panelOpens.length).toBe(4);
  });

  it("marks only the first panel active on initial render", () => {
    const html = renderVariants("slide-x", ["A", "B", "C", "D"], true);
    expect(html).toContain('<div class="v2-variant-panel active" data-variant-index="0">A</div>');
    expect(html).toContain('<div class="v2-variant-panel" data-variant-index="1">B</div>');
  });
});
```

Add the import at the top of `deck2.test.ts` (alongside the existing `monthInNumbersSlide` import):

```ts
import { monthInNumbersSlide, realVariantCount, renderVariants } from "./slides";
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/data/reporting/executive/deck2/deck2.test.ts -t "realVariantCount"`
Expected: FAIL — `realVariantCount is not a function` / `renderVariants is not a function` (neither is exported yet).

- [ ] **Step 3: Record the edit in docs/EDIT_LOG.md**

Add an entry (bump the decimal version per CLAUDE.md's convention — check the current top entry's version first and increment the decimal by one) with the before/after for the `renderVariants` change below.

- [ ] **Step 4: Implement — rework `renderVariants`, export it and the new helper**

In `src/data/reporting/executive/deck2/slides.ts`, replace:

```ts
/**
 * Wraps a slide's varying content into 1-of-4 selectable style variants.
 * Production (`variantPreview=false`) renders ONLY `bodies[0]` — byte-identical
 * to the single-variant output that existed before the switcher (a dev-preview
 * feature; see docs/superpowers/specs/2026-07-05-deck2-style-switcher-design.md).
 * Preview mode renders all 4, one visible via CSS (`.v2-variant-panel.active`).
 * The arrow-cycle control that drives this lives separately in
 * `slideControls()`/`variantSwitcher()`; the inline script in deck2/index.ts
 * (DECK_VARIANT_SCRIPT) wires the two together by matching `data-for` to
 * `data-slide-id` and persists the choice.
 */
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
  return `<div class="v2-variant-stack" data-slide-id="${esc(slideId)}" data-active-index="0">${panels}</div>`;
}
```

with:

```ts
/**
 * How many of the 4 bodyVariant slots hold genuinely distinct content. Every
 * slide today passes the same string 4× (no slide has real alternate designs
 * yet — see docs/superpowers/specs/2026-07-20-deck-design-sets-design.md,
 * sub-project 3), so this returns 1 for all of them. Counts DISTINCT strings
 * regardless of which slot repeats which, so a slide reports itself
 * switchable the moment any two slots differ — no per-call-site bookkeeping
 * needed as slides gain real variants over time.
 */
export function realVariantCount(bodies: readonly [string, string, string, string]): number {
  return new Set(bodies).size;
}

/**
 * Wraps a slide's varying content into 1-of-4 selectable style variants, OR
 * returns the plain body untouched — the caller decides which via
 * `showSwitcher` (dev-preview mode always passes true; production passes
 * `realVariantCount(bodies) >= 2`, so a slide with only one real design still
 * renders byte-identical to the pre-switcher output, and the switcher only
 * ever appears where there's actually something to switch between). Preview
 * mode's arrow-cycle control lives separately in `slideControls()`/
 * `variantSwitcher()`; the inline scripts in deck2/index.ts (DECK_VARIANT_SCRIPT
 * for dev-preview, DECK_DESIGN_SWITCHER_SCRIPT for production) wire the two
 * together by matching `data-for` to `data-slide-id`.
 */
export function renderVariants(
  slideId: string,
  bodies: readonly [string, string, string, string],
  showSwitcher: boolean,
): string {
  if (!showSwitcher) return bodies[0];
  const panels = bodies
    .map(
      (html, i) =>
        `<div class="v2-variant-panel${i === 0 ? " active" : ""}" data-variant-index="${i}">${html}</div>`,
    )
    .join("");
  return `<div class="v2-variant-stack" data-slide-id="${esc(slideId)}" data-active-index="0">${panels}</div>`;
}
```

In `src/data/reporting/executive/deck2/theme.ts`, update the now-stale comment at line 449:

Before:
```
/* ── Style-variant switcher (dev-preview only, never in production output) ── */
```

After:
```
/* ── Style-variant switcher (dev-preview: always on; production: only when a
   slide has ≥2 real designs — see realVariantCount() in slides.ts) ────────── */
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/data/reporting/executive/deck2/deck2.test.ts -t "realVariantCount|renderVariants"`
Expected: PASS (all 5 new tests)

- [ ] **Step 6: Run the full deck2 suite to check nothing else broke**

Run: `npx vitest run src/data/reporting/executive/deck2/`
Expected: existing tests still pass — `renderVariants` isn't called anywhere with the new signature yet (Task 2 wires that up), so nothing else in the deck should have changed behavior. If any call site fails to typecheck, that's expected — Task 2 fixes it next; note it and continue.

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: errors ONLY at `renderVariants` call sites (3 of them — `v2Slide`, `coverSlide`, `sectionSeparatorSlide` — still passing a raw `variantPreview` boolean where the new signature expects a pre-resolved `showSwitcher`). This is expected and fixed in Task 2. If you see errors anywhere else, stop and investigate before continuing.

- [ ] **Step 8: Commit**

```bash
git add docs/EDIT_LOG.md src/data/reporting/executive/deck2/slides.ts src/data/reporting/executive/deck2/theme.ts src/data/reporting/executive/deck2/deck2.test.ts
git commit -m "$(cat <<'EOF'
feat(deck2): make renderVariants's switcher condition data-driven

realVariantCount() counts distinct bodyVariant slots so a slide becomes
switchable automatically once it has ≥2 real designs, instead of only
in the dev-preview tool. No slide has real alternates yet, so this is
a no-op until sub-project 3 gives one a second design.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Wire `showSwitcher` through `slideControls()`/`variantSwitcher()` and all 3 call sites

**Files:**
- Modify: `src/data/reporting/executive/deck2/slides.ts:137-156` (`variantSwitcher`, `slideControls`)
- Modify: `src/data/reporting/executive/deck2/slides.ts:230-260` (`v2Slide` — export it + its opts type)
- Modify: `src/data/reporting/executive/deck2/slides.ts:335-337` (`coverSlide`)
- Modify: `src/data/reporting/executive/deck2/slides.ts:646-647` (`sectionSeparatorSlide`)
- Test: `src/data/reporting/executive/deck2/deck2.test.ts`

**Interfaces:**
- Consumes: `realVariantCount`, `renderVariants` from Task 1.
- Produces: `export function slideControls(slideId: string, showSwitcher: boolean): string` (signature change: 2nd param renamed/repurposed from `variantPreview`).
- Produces: `export type V2SlideOpts = { id: string; title: string; eyebrow: string; iconName: string; headline: string; subhead?: string; bodyVariants: readonly [string, string, string, string]; variantPreview: boolean; num: number; total: number; slideClass?: string; section: NavSectionKey }` and `export function v2Slide(opts: V2SlideOpts): string` — both exported (previously module-private) so this task's tests, and any future slide-design work, can exercise the switcher end-to-end without needing a full `ReportModel`.

- [ ] **Step 1: Write the failing tests**

Add to `src/data/reporting/executive/deck2/deck2.test.ts`:

```ts
describe("v2Slide — switcher wiring", () => {
  const baseOpts = {
    id: "slide-fixture",
    title: "عنوان",
    eyebrow: "قسم",
    iconName: "chart",
    headline: "عنوان الشريحة",
    num: 1,
    total: 1,
    section: "summary" as const,
  };

  it("shows no switcher and no stack when the slide has only 1 real variant and variantPreview is false", () => {
    const html = v2Slide({
      ...baseOpts,
      bodyVariants: ["<p>محتوى</p>", "<p>محتوى</p>", "<p>محتوى</p>", "<p>محتوى</p>"],
      variantPreview: false,
    });
    expect(html).not.toContain('<div class="v2-variant-stack"');
    expect(html).not.toContain('<div class="v2-variant-switcher"');
  });

  it("shows the switcher and stack when the slide has 2+ real variants, even with variantPreview false", () => {
    const html = v2Slide({
      ...baseOpts,
      bodyVariants: ["<p>تصميم 1</p>", "<p>تصميم 2</p>", "<p>تصميم 2</p>", "<p>تصميم 2</p>"],
      variantPreview: false,
    });
    expect(html).toContain('<div class="v2-variant-stack" data-slide-id="slide-fixture"');
    expect(html).toContain('<div class="v2-variant-switcher" data-for="slide-fixture"');
  });

  it("always shows the switcher and stack in variantPreview mode, even with 1 real variant", () => {
    const html = v2Slide({
      ...baseOpts,
      bodyVariants: ["<p>محتوى</p>", "<p>محتوى</p>", "<p>محتوى</p>", "<p>محتوى</p>"],
      variantPreview: true,
    });
    expect(html).toContain('<div class="v2-variant-stack"');
    expect(html).toContain('<div class="v2-variant-switcher"');
  });
});
```

Update the import line to add `v2Slide`:

```ts
import { monthInNumbersSlide, realVariantCount, renderVariants, v2Slide } from "./slides";
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/data/reporting/executive/deck2/deck2.test.ts -t "switcher wiring"`
Expected: FAIL — `v2Slide` is not exported yet.

- [ ] **Step 3: Record the edit in docs/EDIT_LOG.md** (same convention as Task 1, next decimal version)

- [ ] **Step 4: Implement — `variantSwitcher`/`slideControls`**

In `src/data/reporting/executive/deck2/slides.ts`, replace:

```ts
/**
 * Style-variant arrow-cycle control, dev-preview only. `data-for` points at
 * the matching `.v2-variant-stack`'s `data-slide-id` (same slide, but the
 * switcher itself lives in `slideControls()`'s top-right cluster, not nested
 * inside the stack — see DECK_VARIANT_SCRIPT in index.ts for the lookup).
 */
function variantSwitcher(slideId: string): string {
  return `<div class="v2-variant-switcher" data-for="${esc(slideId)}" dir="ltr">
    <button type="button" class="v2-variant-prev" aria-label="النمط السابق">‹</button>
    <span class="v2-variant-label">1 / 4</span>
    <button type="button" class="v2-variant-next" aria-label="النمط التالي">›</button>
  </div>`;
}

/**
 * Top-right controls cluster for a slide: the print-include toggle, plus
 * (dev-preview only) the style-variant switcher right next to it — grouped in
 * one positioned wrapper (theme.ts's `.slide-controls`) instead of each being
 * independently absolutely-positioned.
 */
function slideControls(slideId: string, variantPreview: boolean): string {
  return `<div class="slide-controls">
    ${printToggle()}
    ${variantPreview ? variantSwitcher(slideId) : ""}
  </div>`;
}
```

with:

```ts
/**
 * Style-variant arrow-cycle control. `data-for` points at the matching
 * `.v2-variant-stack`'s `data-slide-id` (same slide, but the switcher itself
 * lives in `slideControls()`'s top-right cluster, not nested inside the
 * stack — see DECK_VARIANT_SCRIPT/DECK_DESIGN_SWITCHER_SCRIPT in index.ts for
 * the lookup). Only rendered when the caller has already determined the
 * slide is switchable (see `showSwitcher` in `renderVariants`/`v2Slide`).
 */
function variantSwitcher(slideId: string): string {
  return `<div class="v2-variant-switcher" data-for="${esc(slideId)}" dir="ltr">
    <button type="button" class="v2-variant-prev" aria-label="النمط السابق">‹</button>
    <span class="v2-variant-label">1 / 4</span>
    <button type="button" class="v2-variant-next" aria-label="النمط التالي">›</button>
  </div>`;
}

/**
 * Top-right controls cluster for a slide: the print-include toggle, plus the
 * style-variant switcher when `showSwitcher` is true — grouped in one
 * positioned wrapper (theme.ts's `.slide-controls`) instead of each being
 * independently absolutely-positioned.
 */
export function slideControls(slideId: string, showSwitcher: boolean): string {
  return `<div class="slide-controls">
    ${printToggle()}
    ${showSwitcher ? variantSwitcher(slideId) : ""}
  </div>`;
}
```

- [ ] **Step 5: Implement — `v2Slide`, export it and its opts type**

Replace:

```ts
// ── v2 slide shell — rail + eyebrow + headline + body + footer page num. ────
// Unlike v1 there is no "decision footer"; the footer concept is gone in v2.
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
  ${slideControls(opts.id, opts.variantPreview)}
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
```

with:

```ts
// ── v2 slide shell — rail + eyebrow + headline + body + footer page num. ────
// Unlike v1 there is no "decision footer"; the footer concept is gone in v2.
export type V2SlideOpts = {
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
};

export function v2Slide(opts: V2SlideOpts): string {
  const cls = `slide v2${opts.slideClass ? " " + opts.slideClass : ""}`;
  const showSwitcher = opts.variantPreview || realVariantCount(opts.bodyVariants) >= 2;
  const body = renderVariants(opts.id, opts.bodyVariants, showSwitcher);
  return `<section class="${cls}" id="${esc(opts.id)}" data-title="${esc(opts.title)}" data-section="${opts.section}" data-section-label="${esc(NAV_SECTIONS[opts.section])}">
  ${slideControls(opts.id, showSwitcher)}
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
```

- [ ] **Step 6: Implement — `coverSlide`**

In `coverSlide`, replace:

```ts
  const body = renderVariants("slide-cover", [coverBody, coverBody, coverBody, coverBody], variantPreview);
  return `<section class="slide v2 title-slide v2-cover" id="slide-cover" data-title="الغلاف" data-section="cover" data-section-label="${esc(NAV_SECTIONS.cover)}">
    ${slideControls("slide-cover", variantPreview)}
```

with:

```ts
  const coverVariants: readonly [string, string, string, string] = [coverBody, coverBody, coverBody, coverBody];
  const showSwitcher = variantPreview || realVariantCount(coverVariants) >= 2;
  const body = renderVariants("slide-cover", coverVariants, showSwitcher);
  return `<section class="slide v2 title-slide v2-cover" id="slide-cover" data-title="الغلاف" data-section="cover" data-section-label="${esc(NAV_SECTIONS.cover)}">
    ${slideControls("slide-cover", showSwitcher)}
```

- [ ] **Step 7: Implement — `sectionSeparatorSlide`**

In `sectionSeparatorSlide`, replace:

```ts
  const body = renderVariants(`slide-sep-${sectionNo}`, [sepBody, sepBody, sepBody, sepBody], variantPreview);
```

with:

```ts
  // NOTE: this slide type doesn't call slideControls()/expose switcher UI
  // even when showSwitcher is true (pre-existing — it uses printToggle()
  // directly, see below). If a future design pass gives section separators
  // real alternates, wire slideControls() in here too.
  const sepVariants: readonly [string, string, string, string] = [sepBody, sepBody, sepBody, sepBody];
  const showSwitcher = variantPreview || realVariantCount(sepVariants) >= 2;
  const body = renderVariants(`slide-sep-${sectionNo}`, sepVariants, showSwitcher);
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run src/data/reporting/executive/deck2/deck2.test.ts -t "switcher wiring"`
Expected: PASS (all 3 new tests)

- [ ] **Step 9: Run the full deck2 suite and typecheck**

Run: `npx vitest run src/data/reporting/executive/deck2/`
Expected: ALL PASS, including the pre-existing "never emits variant-switcher DOM markup" tests (they still hold — every real slide today has exactly 1 real variant, so `showSwitcher` still resolves to `false` in production for all of them; nothing in the actual generated deck output changes yet).

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 10: Update the pre-existing tests' comments to reflect the new (now-conditional) contract**

These two tests in `deck2.test.ts` still pass unchanged, but their names/comments currently claim an unconditional "never" that Task 1+2 just made conditional. Update the wording so it's not misleading to a future reader — do NOT change the assertions themselves (the assertions are still correct: zero slides are switchable today).

Before:
```ts
describe("buildExecutiveDeckV2 — production path (no opts)", () => {
  // Match the opening markup tag, not the bare class name — the CSS block
  // (added in Task 3) legitimately contains the literal substring
  // "v2-variant-stack"/"v2-variant-switcher" as selector text, always, in both
  // production and preview mode (CSS is static and unconditional; only the
  // switcher's DOM markup and client script are gated on variantPreview). A
  // bare substring check would false-positive on that CSS text alone.
  it("never emits variant-switcher DOM markup when opts is omitted", () => {
```

After:
```ts
describe("buildExecutiveDeckV2 — production path (no opts)", () => {
  // Match the opening markup tag, not the bare class name — the CSS block
  // legitimately contains the literal substring "v2-variant-stack"/
  // "v2-variant-switcher" as selector text, unconditionally, in every mode. A
  // bare substring check would false-positive on that CSS text alone.
  //
  // These two tests assert the CURRENT reality (every real slide has exactly
  // 1 real variant, so nothing is switchable in production yet) — not an
  // architectural guarantee. See v2Slide's "switcher wiring" tests above for
  // the actual conditional contract (realVariantCount(bodyVariants) >= 2).
  it("emits no variant-switcher DOM markup today (no slide has 2+ real variants yet)", () => {
```

Before:
```ts
  it("never emits variant-switcher DOM markup when variantPreview is explicitly false", () => {
```

After:
```ts
  it("emits no variant-switcher DOM markup when variantPreview is explicitly false (same reason)", () => {
```

- [ ] **Step 11: Run the full deck2 suite one more time**

Run: `npx vitest run src/data/reporting/executive/deck2/`
Expected: PASS (renamed tests still pass — only comments/names changed)

- [ ] **Step 12: Commit**

```bash
git add docs/EDIT_LOG.md src/data/reporting/executive/deck2/slides.ts src/data/reporting/executive/deck2/deck2.test.ts
git commit -m "$(cat <<'EOF'
feat(deck2): compute showSwitcher at every renderVariants call site

v2Slide, coverSlide, and sectionSeparatorSlide now resolve
variantPreview || realVariantCount(bodyVariants) >= 2 once and pass it
through to both renderVariants and slideControls, so the switcher UI
and the panel stack always agree on whether a slide is switchable.
v2Slide is now exported for direct testing and future slide-design work.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Global design-set control — CSS + conditional markup in the toolbar

**Files:**
- Modify: `src/data/reporting/executive/deck2/theme.ts` (new CSS block)
- Modify: `src/data/reporting/executive/deck2/index.ts:128-181` (`buildDeckV2Html`)
- Test: `src/data/reporting/executive/deck2/deck2.test.ts`

**Interfaces:**
- Produces: `export function hasSwitchableSlides(slidesHtml: string): boolean` (new, in `index.ts`) — substring check for `<div class="v2-variant-stack"` in the already-built slides HTML.
- Consumes: `buildDeckV2Html(slides: string, monthLabel: string, variantPreview?: boolean, footerNote?: string): string` — unchanged signature, new internal behavior.

- [ ] **Step 1: Write the failing tests**

Merge `buildDeckV2Html` and `hasSwitchableSlides` into `deck2.test.ts`'s EXISTING top-of-file import from `./index` (do not add a second, separate import statement for the same module):

```ts
import { buildDeckV2Html, buildExecutiveDeckV2, hasSwitchableSlides } from "./index";
```

Add to `src/data/reporting/executive/deck2/deck2.test.ts`:

```ts
describe("hasSwitchableSlides", () => {
  it("is false for slides HTML with no variant-stack markup", () => {
    expect(hasSwitchableSlides('<section class="slide v2"><p>hi</p></section>')).toBe(false);
  });

  it("is true when a variant-stack opening tag is present", () => {
    expect(
      hasSwitchableSlides('<section class="slide v2"><div class="v2-variant-stack" data-slide-id="x">…</div></section>'),
    ).toBe(true);
  });
});

describe("buildDeckV2Html — design switcher toolbar control", () => {
  it("omits the design-switcher control when no slide is switchable", () => {
    const html = buildDeckV2Html('<section class="slide v2"><p>hi</p></section>', "مايو 2026");
    expect(html).not.toContain('id="deck-design-switcher-group"');
  });

  it("shows the design-switcher control when at least one slide is switchable", () => {
    const html = buildDeckV2Html(
      '<div class="v2-variant-stack" data-slide-id="x"><div class="v2-variant-panel active" data-variant-index="0">A</div></div>',
      "مايو 2026",
    );
    expect(html).toContain('id="deck-design-switcher-group"');
    expect(html).toContain('data-design-index="0"');
    expect(html).toContain('data-design-index="3"');
  });

  it("omits the design-switcher control in variantPreview mode even if switchable (dev tool keeps its own arrows)", () => {
    const html = buildDeckV2Html(
      '<div class="v2-variant-stack" data-slide-id="x">…</div>',
      "مايو 2026",
      true,
    );
    expect(html).not.toContain('id="deck-design-switcher-group"');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/data/reporting/executive/deck2/deck2.test.ts -t "design-switcher|hasSwitchableSlides"`
Expected: FAIL — `hasSwitchableSlides` not exported, control markup doesn't exist yet.

- [ ] **Step 3: Record the edit in docs/EDIT_LOG.md**

- [ ] **Step 4: Implement — CSS**

In `src/data/reporting/executive/deck2/theme.ts`, add this block right after the `.v2-num-tile`/hex-texture section (or any clearly-delimited spot near the end of the file, before the closing backtick) — exact anchor: insert immediately before the final `@media(max-width:820px){` responsive block:

```css
/* ── Global design-set switcher (report toolbar, production only) ─────────── */
/* Sits in .deck-toolbar-actions beside the theme toggle and print button.
   Only rendered when buildDeckV2Html's hasSwitchableSlides() finds at least
   one .v2-variant-stack in the slides HTML — no dead control before any
   slide actually has 2+ real designs (see slides.ts realVariantCount()).
   No persistence, matching the theme toggle right next to it — resets to
   segment 1 on every reopen. */
.v2-design-switcher{display:flex;align-items:center;gap:8px;}
.v2-design-switcher-label{font-size:0.72rem;font-weight:700;color:var(--slate);}
.v2-design-switcher-group{
  display:flex;align-items:center;gap:2px;
  background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.16);
  border-radius:999px;padding:3px;
}
.v2-design-switcher-btn{
  border:0;background:transparent;color:rgba(255,255,255,.7);
  width:26px;height:26px;border-radius:999px;font-size:0.78rem;font-weight:800;
  cursor:pointer;display:grid;place-items:center;font-variant-numeric:tabular-nums;
  transition:background .15s ease,color .15s ease;
}
.v2-design-switcher-btn:hover{background:rgba(255,255,255,.12);color:#fff;}
.v2-design-switcher-btn.active{background:var(--gold);color:var(--navy);}
@media print{.v2-design-switcher{display:none!important;}}
body.theme-light .v2-design-switcher-group{background:rgba(10,45,74,.06);border-color:#dde4ea;}
body.theme-light .v2-design-switcher-btn{color:#3a4a58;}
body.theme-light .v2-design-switcher-btn:hover{background:rgba(10,45,74,.1);color:#0a2d4a;}
body.theme-light .v2-design-switcher-label{color:#607386;}
```

- [ ] **Step 5: Implement — `hasSwitchableSlides` + toolbar markup**

In `src/data/reporting/executive/deck2/index.ts`, add this function right before `buildDeckV2Html`:

```ts
/** Whether any slide in the already-built HTML is switchable — i.e. has ≥2
 *  real designs (see slides.ts's realVariantCount()). Gates the toolbar's
 *  global design-set control so it never appears with nothing to control. */
export function hasSwitchableSlides(slidesHtml: string): boolean {
  return slidesHtml.includes('<div class="v2-variant-stack"');
}
```

Then replace the toolbar-actions block inside `buildDeckV2Html`:

Before:
```ts
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
```

After:
```ts
    <div class="deck-toolbar-actions">
      ${
        !variantPreview && hasSwitchableSlides(slides)
          ? `<div class="v2-design-switcher" role="group" aria-label="اختيار نمط التصميم">
        <span class="v2-design-switcher-label">نمط التصميم</span>
        <span class="v2-design-switcher-group" id="deck-design-switcher-group">
          <button type="button" class="v2-design-switcher-btn active" data-design-index="0">1</button>
          <button type="button" class="v2-design-switcher-btn" data-design-index="1">2</button>
          <button type="button" class="v2-design-switcher-btn" data-design-index="2">3</button>
          <button type="button" class="v2-design-switcher-btn" data-design-index="3">4</button>
        </span>
      </div>`
          : ""
      }
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
```

(`slides` and `variantPreview` are both already in scope as `buildDeckV2Html`'s own parameters — no new params needed.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/data/reporting/executive/deck2/deck2.test.ts -t "design-switcher|hasSwitchableSlides"`
Expected: PASS (all 5 new tests)

- [ ] **Step 7: Run the full deck2 suite and typecheck**

Run: `npx vitest run src/data/reporting/executive/deck2/`
Run: `npm run typecheck`
Expected: PASS, no errors. The real `buildExecutiveDeckV2` production tests should still show no design-switcher markup (no slide is switchable yet).

- [ ] **Step 8: Commit**

```bash
git add docs/EDIT_LOG.md src/data/reporting/executive/deck2/theme.ts src/data/reporting/executive/deck2/index.ts src/data/reporting/executive/deck2/deck2.test.ts
git commit -m "$(cat <<'EOF'
feat(deck2): add global design-set toolbar control (gated, inert for now)

hasSwitchableSlides() gates a new segmented 1-4 control in the report's
own toolbar, next to the theme toggle. Renders only in production
(never alongside the dev-preview tool's own arrows) and only when at
least one slide actually has 2+ real designs — currently none do, so
this ships invisible until sub-project 3 gives a slide real variants.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Client-side switching script (`DECK_DESIGN_SWITCHER_SCRIPT`)

**Files:**
- Modify: `src/data/reporting/executive/deck2/index.ts` (new script constant + inclusion)
- Test: `src/data/reporting/executive/deck2/deck2.test.ts`

**Interfaces:**
- Consumes: `.v2-variant-stack`/`.v2-variant-panel`/`.v2-variant-switcher`/`.v2-design-switcher-btn` markup from Tasks 1–3 (exact class/attribute names must match — this script is pure vanilla JS embedded as a string, not typechecked, so a typo here fails silently at runtime, not at build time; double-check every selector against the markup emitted in Tasks 2–3 before considering this task done).
- Produces: nothing consumed by later code — this is the last task in the plan.

- [ ] **Step 1: Write the failing test**

Add to `src/data/reporting/executive/deck2/deck2.test.ts`:

```ts
describe("buildDeckV2Html — design switcher script", () => {
  it("includes the design-switcher script only when switchable and not in preview mode", () => {
    const switchableHtml = '<div class="v2-variant-stack" data-slide-id="x">…</div>';
    const withSwitchable = buildDeckV2Html(switchableHtml, "مايو 2026");
    expect(withSwitchable).toContain("deck-design-switcher-group");
    expect(withSwitchable).toContain("v2-variant-stack");

    const notSwitchable = buildDeckV2Html('<p>hi</p>', "مايو 2026");
    expect(notSwitchable).not.toContain("var group = document.getElementById('deck-design-switcher-group')");

    const previewMode = buildDeckV2Html(switchableHtml, "مايو 2026", true);
    expect(previewMode).not.toContain("var group = document.getElementById('deck-design-switcher-group')");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/reporting/executive/deck2/deck2.test.ts -t "design switcher script"`
Expected: FAIL — script doesn't exist yet.

- [ ] **Step 3: Record the edit in docs/EDIT_LOG.md**

- [ ] **Step 4: Implement — the script constant**

In `src/data/reporting/executive/deck2/index.ts`, add this constant right after `DECK_VARIANT_SCRIPT` (before `export function buildDeckV2Html`):

```ts
/**
 * Global design-set control + per-slide override arrows, PRODUCTION only
 * (never alongside DECK_VARIANT_SCRIPT — the two are mutually exclusive by
 * construction: buildDeckV2Html only appends this one when !variantPreview).
 * Pure in-memory state, no persistence — mirrors the theme toggle right next
 * to it in the toolbar, which also resets on reopen. An override set via a
 * slide's own arrows is NOT cleared by a later global click; only stepping
 * that slide's arrows back to match the global choice removes it.
 */
const DECK_DESIGN_SWITCHER_SCRIPT = `(function(){
  var stacks = Array.prototype.slice.call(document.querySelectorAll('.v2-variant-stack'));
  if (!stacks.length) return;
  var overrides = {};
  var globalIndex = 0;
  function stackFor(slideId){
    return document.querySelector('.v2-variant-stack[data-slide-id="' + slideId + '"]');
  }
  function apply(stack, index){
    var panels = Array.prototype.slice.call(stack.querySelectorAll('.v2-variant-panel'));
    panels.forEach(function(p, i){ p.classList.toggle('active', i === index); });
    stack.setAttribute('data-active-index', String(index));
    var slideId = stack.getAttribute('data-slide-id');
    var switcher = document.querySelector('.v2-variant-switcher[data-for="' + slideId + '"]');
    if (switcher) {
      var label = switcher.querySelector('.v2-variant-label');
      if (label) label.textContent = (index + 1) + ' / ' + panels.length;
    }
  }
  function applyAll(){
    stacks.forEach(function(stack){
      var slideId = stack.getAttribute('data-slide-id');
      var index = Object.prototype.hasOwnProperty.call(overrides, slideId) ? overrides[slideId] : globalIndex;
      apply(stack, index);
    });
  }
  var group = document.getElementById('deck-design-switcher-group');
  if (group) {
    var buttons = Array.prototype.slice.call(group.querySelectorAll('.v2-design-switcher-btn'));
    buttons.forEach(function(btn){
      btn.addEventListener('click', function(){
        globalIndex = Number(btn.getAttribute('data-design-index'));
        buttons.forEach(function(b){ b.classList.toggle('active', b === btn); });
        applyAll();
      });
    });
  }
  var switchers = Array.prototype.slice.call(document.querySelectorAll('.v2-variant-switcher'));
  switchers.forEach(function(switcher){
    var slideId = switcher.getAttribute('data-for');
    var stack = stackFor(slideId);
    if (!stack) return;
    var panelCount = stack.querySelectorAll('.v2-variant-panel').length;
    function step(delta){
      var cur = Number(stack.getAttribute('data-active-index') || '0');
      var next = (cur + delta + panelCount) % panelCount;
      overrides[slideId] = next;
      apply(stack, next);
    }
    switcher.querySelector('.v2-variant-prev').addEventListener('click', function(){ step(-1); });
    switcher.querySelector('.v2-variant-next').addEventListener('click', function(){ step(1); });
  });
})();`;
```

- [ ] **Step 5: Implement — wire its inclusion**

In `buildDeckV2Html`, find the closing script tag line:

Before:
```ts
<script>${DECK_NAV_SCRIPT}${variantPreview ? DECK_VARIANT_SCRIPT : ""}</script>
```

After:
```ts
<script>${DECK_NAV_SCRIPT}${variantPreview ? DECK_VARIANT_SCRIPT : ""}${!variantPreview && hasSwitchableSlides(slides) ? DECK_DESIGN_SWITCHER_SCRIPT : ""}</script>
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/data/reporting/executive/deck2/deck2.test.ts -t "design switcher script"`
Expected: PASS

- [ ] **Step 7: Run the full deck2 suite and typecheck**

Run: `npx vitest run src/data/reporting/executive/deck2/`
Run: `npm run typecheck`
Expected: PASS, no errors.

- [ ] **Step 8: Run the FULL project test suite (this task touches shared infrastructure — check for ripple effects)**

Run: `npm run test:run`
Expected: all tests pass (same count as before this plan started, plus the new ones added across Tasks 1–4).

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add docs/EDIT_LOG.md src/data/reporting/executive/deck2/index.ts src/data/reporting/executive/deck2/deck2.test.ts
git commit -m "$(cat <<'EOF'
feat(deck2): add DECK_DESIGN_SWITCHER_SCRIPT for the production toolbar

In-memory global index + per-slide override map, no persistence.
Mutually exclusive with the dev-preview tool's DECK_VARIANT_SCRIPT by
construction. Currently a no-op in the real generated report — no
slide has 2+ real variants yet (sub-project 3, future work).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Live verification (manual, browser-based — no automated test can exercise embedded client JS)

This project's Vitest tests run in a `node` environment and never execute the deck's inline `<script>` content (confirmed: `DECK_NAV_SCRIPT`/`DECK_VARIANT_SCRIPT` are likewise only ever checked for string presence, never behaviorally). Tasks 1–4 verified every conditional branch and the exact markup shape via string assertions; this task verifies the actual click-to-switch behavior works, using a throwaway fixture (not committed to the real deck — sub-project 3 is still out of scope).

**Files:**
- Create (scratchpad, not committed): a small standalone HTML file exercising the mechanism with 2 fake switchable slides.

- [ ] **Step 1: Build a throwaway fixture**

Write a small Node script (or a one-off `ts-node`/`tsx` snippet, or a temporary test file you delete after) that calls `buildDeckV2Html` with hand-crafted `slides` HTML containing TWO `.v2-variant-stack`s with visibly different content per panel (e.g. panel 0 = "التصميم الأول", panel 1 = "التصميم الثاني", etc.), each wrapped exactly like real output (`slideControls`'s switcher markup included, per-slide). Write the resulting HTML string to a file under the scratchpad directory, e.g. `switcher-fixture.html`.

- [ ] **Step 2: Open it in the Browser pane and verify**

Use `preview_start` with `{url: "file://<absolute-path-to-switcher-fixture.html>"}` (or serve it via a quick local static route if `file://` is blocked) and confirm, via `read_page`/`computer` clicks:
- The global "1 2 3 4" control appears and its "1" segment starts active.
- Clicking "2" switches BOTH fixture slides to their 2nd panel's content, and highlights "2" as active.
- Clicking one slide's own `‹`/`›` arrows switches ONLY that slide, and does NOT change the global control's active segment.
- Clicking the global control again after a per-slide override: the overridden slide does NOT snap back to the new global choice (per spec — overrides persist until manually reset via that slide's own arrows).
- Reloading the page resets everything to segment 1, no overrides (confirms no accidental persistence).

- [ ] **Step 3: Confirm the real (unchanged) deck still shows nothing**

Run the dev server (`.claude/launch.json`'s `x-ray-app` config) and open `/deck-preview.html`. Confirm the real report toolbar shows NO design-switcher control (every real slide still has exactly 1 real variant) — this is the regression check that Tasks 1–4 didn't change anything user-visible in the actual shipped report yet.

- [ ] **Step 4: Delete the scratch fixture file** (it was for verification only, never meant to be committed)

- [ ] **Step 5: Report back**

Summarize what was verified and any deviations from the expected behavior found during live testing. If everything matched, the infrastructure sub-project is complete — sub-project 3 (building real 4-variant designs slide-by-slide, starting with `مؤشرات الشهر` per the spec's rollout order) is the next piece of work, and is intentionally a separate future plan.
