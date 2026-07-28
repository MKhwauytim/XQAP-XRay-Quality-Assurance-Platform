# deck2 Variant-Choice Family-Key Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the blocking bug Opus identified in `docs/superpowers/specs/2026-07-25-deck2-design-systems-design.md` §3: saved style choices are keyed by exact slide id, but paginated slides' ids embed the page number under 3 different suffix conventions, so a deck-wide style choice silently reverts to variant 0 for any page whose id changes when the port/data count crosses a pagination boundary.

**Architecture:** Add a `familyKeyOf(slideId)` helper (strips a trailing `-\d+`) used in two places: (1) `resolveVariantIndex` in `slideKit.ts` now tries exact id → family key → `"*"` deck-wide default → 0, in that order; (2) the client-side `DECK_VARIANT_SCRIPT`'s `persist()` function (in `deck2/index.ts`) now reports the family key instead of the exact rendered slide id when saving a choice, so a choice saved on any page-count month applies uniformly regardless of future page-count drift. For non-paginated slides (no trailing `-\d+`), the family key equals the exact id, so this is a no-op there — zero behavior change for the ~14 non-paginated slides.

**Tech Stack:** TypeScript, Vitest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-25-deck2-design-systems-design.md` §3.
- Zero change to production output for any slide with NO saved style choice (exact-id and family-key lookups both miss → falls through to 0, same as today).
- Zero change to any of the ~18 individual slide-builder function signatures.
- Backward compatible with any ALREADY-saved exact-id choice (e.g. a prior admin session saved `"slide-port-population-1": 2` before this fix shipped) — exact-id match must still win over a family-key match, so existing saved data keeps working exactly as it did.
- Per `CLAUDE.md`: same-day edit-log entry (new top section in `docs/edit logs/2026-07-25.md`, no existing entry touched) + version bump (check current `package.json` version, bump the decimal), with real, reconciling `git diff --stat` + `count-lines` numbers.

---

### Task 1: Family-key resolution + persist() fix

**Files:**
- Modify: `src/data/reporting/executive/deck2/slideKit.ts`
- Modify: `src/data/reporting/executive/deck2/index.ts`
- Modify: `src/data/reporting/executive/deck2/deck2.test.ts`

**Interfaces:**
- Consumes: existing `activeStyleChoices`/`setActiveStyleChoices`/`getActiveStyleChoices` (unchanged), existing `DECK_VARIANT_SCRIPT` string (modified in place).
- Produces: `resolveVariantIndex(slideId: string): number` (unchanged signature, changed internal logic — still private to `slideKit.ts`), a new private `familyKeyOf(slideId: string): string` helper in the same file.

- [ ] **Step 1: Write the failing tests**

Open `src/data/reporting/executive/deck2/deck2.test.ts`. Append this new `describe` block at the end of the file:

```ts
describe("variant-choice family-key resolution (2026-07-25, deck2-design-systems fix)", () => {
  it("resolves a choice saved under a paginated slide's FAMILY key (no trailing page number) regardless of the exact page id being rendered", () => {
    // slide-port-population-N is the always-suffixed convention (page+1, starting at 1).
    const fixture = input([
      popRow({ portName: "ميناء أ" }),
      popRow({ xrayImageId: "XR-2", portName: "ميناء ب" }),
    ]);
    const html = buildExecutiveDeckV2(fixture, {}, {
      variantPreview: true,
      styleChoices: { "slide-port-population": 1 },
    });
    // The rendered page is "slide-port-population-1" (single page, 2 ports) — its
    // family key "slide-port-population" matches the saved choice, so panel 1
    // (not panel 0) should be the pre-selected active one for this slide.
    const start = html.indexOf('data-slide-id="slide-port-population-1"');
    expect(start).toBeGreaterThan(-1);
    const stackOpenTag = html.slice(start - 60, start + 40);
    expect(stackOpenTag).toContain('data-active-index="1"');
  });

  it("an exact per-page-id saved choice still wins over a family-key choice for that same page (backward compatibility)", () => {
    const fixture = input([popRow(), popRow({ xrayImageId: "XR-2" })]);
    const html = buildExecutiveDeckV2(fixture, {}, {
      variantPreview: true,
      styleChoices: { "slide-port-population": 1, "slide-port-population-1": 2 },
    });
    const start = html.indexOf('data-slide-id="slide-port-population-1"');
    const stackOpenTag = html.slice(start - 60, start + 40);
    expect(stackOpenTag).toContain('data-active-index="2"');
  });

  it("non-paginated slides are unaffected (family key equals the exact id, a no-op)", () => {
    const fixture = input([popRow()]);
    const html = buildExecutiveDeckV2(fixture, {}, {
      variantPreview: true,
      styleChoices: { "slide-cover": 2 },
    });
    const start = html.indexOf('data-slide-id="slide-cover"');
    const stackOpenTag = html.slice(start - 60, start + 40);
    expect(stackOpenTag).toContain('data-active-index="2"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/reporting/executive/deck2/deck2.test.ts -t "family-key"`
Expected: FAIL — the first test fails because `resolveVariantIndex` only checks the exact id today, so a choice saved under `"slide-port-population"` (no page-number suffix) is never found for the rendered `"slide-port-population-1"`.

- [ ] **Step 3: Implement the fix in slideKit.ts**

Find this exact block in `src/data/reporting/executive/deck2/slideKit.ts`:

```ts
/** Clamps a saved/requested variant index to a valid 0-3 slot, defaulting to
 *  0 for anything missing, non-numeric, or out of range — an admin choice
 *  saved against a slide id that no longer exists, or a stale/corrupt file,
 *  must never throw or render `undefined`. */
function resolveVariantIndex(slideId: string): number {
  const choice = activeStyleChoices?.[slideId];
  return typeof choice === "number" && Number.isInteger(choice) && choice >= 0 && choice <= 3 ? choice : 0;
}
```

Replace it with:

```ts
/**
 * Strips a trailing `-<digits>` page-number suffix, e.g. `slide-port-population-3`
 * → `slide-port-population`. Paginated builders use 3 different suffix
 * conventions (always-suffixed from page 1; bare on page 0, suffixed from
 * page 1) — this normalizes all of them to one stable "family" key so a
 * saved style choice survives the deck's page count changing month to month
 * (see docs/superpowers/specs/2026-07-25-deck2-design-systems-design.md §3).
 * A no-op for non-paginated slide ids (no trailing page number to strip).
 */
function familyKeyOf(slideId: string): string {
  return slideId.replace(/-\d+$/, "");
}

/** Clamps a valid-shape choice to a 0-3 slot; returns null for anything
 *  missing, non-numeric, or out of range. */
function clampChoice(choice: unknown): number | null {
  return typeof choice === "number" && Number.isInteger(choice) && choice >= 0 && choice <= 3
    ? choice
    : null;
}

/**
 * Resolves the variant index to render for a given slide id: exact id match
 * first (so an already-saved per-page-id choice from before the family-key
 * fix keeps working), then the slide's family key (a choice saved without a
 * page-number suffix applies to every page count), then the deck-wide
 * default key `"*"`, then 0. Never throws — a choice saved against a slide
 * id that no longer exists, or a stale/corrupt file, silently falls through
 * to the next tier instead.
 */
function resolveVariantIndex(slideId: string): number {
  const exact = clampChoice(activeStyleChoices?.[slideId]);
  if (exact !== null) return exact;
  const family = clampChoice(activeStyleChoices?.[familyKeyOf(slideId)]);
  if (family !== null) return family;
  const deckDefault = clampChoice(activeStyleChoices?.["*"]);
  return deckDefault !== null ? deckDefault : 0;
}
```

- [ ] **Step 4: Fix `persist()` in deck2/index.ts to report the family key**

Find this exact block in `src/data/reporting/executive/deck2/index.ts` (inside `DECK_VARIANT_SCRIPT`):

```ts
  function persist(slideId, index){
    // Dev-tool persistence (Vite middleware, harmless 404 in the real app).
    fetch('/__deck-style-choices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slideId: slideId, variantIndex: index })
    }).catch(function(){});
    // In-app admin customizer bridge: this script only ever runs inside a
    // variantPreview=true document, which is always embedded (the dev tool's
    // own iframe, or the in-app customizer's iframe) — never the standalone
    // opened/downloaded report, which is never in variantPreview mode. A
    // parentless top-level window would just message itself here, which is
    // harmless (nothing listens).
    window.parent.postMessage({ type: 'deck2-style-choice', slideId: slideId, variantIndex: index }, '*');
  }
```

Replace it with:

```ts
  // Mirrors slideKit.ts's familyKeyOf() — strips a trailing page-number
  // suffix so a saved choice survives the deck's page count changing month
  // to month (see docs/superpowers/specs/2026-07-25-deck2-design-systems-design.md
  // §3). A no-op for non-paginated slide ids.
  function familyKeyOf(slideId){
    return slideId.replace(/-\d+$/, '');
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
```

- [ ] **Step 5: Run the tests, verify they pass**

Run: `npx vitest run src/data/reporting/executive/deck2/deck2.test.ts -t "family-key"`
Expected: PASS (3 tests).

- [ ] **Step 6: Run the full suite, typecheck, lint**

Run: `npm run test:run` — expect all passing (149 files, +3 new tests).
Run: `npm run typecheck` and `npm run lint` — expect clean.

- [ ] **Step 7: Edit log + version bump + commit**

Check current `package.json` version, bump the decimal. New top entry in `docs/edit logs/2026-07-25.md`, real `count-lines`/`git diff --stat` numbers that actually reconcile (this has been a repeated source of review findings on related branches — double-check before committing).

```bash
git add src/data/reporting/executive/deck2/slideKit.ts src/data/reporting/executive/deck2/index.ts src/data/reporting/executive/deck2/deck2.test.ts package.json package-lock.json "docs/edit logs/2026-07-25.md"
git commit -m "Fix (executive-deck/deck2): resolve saved style choices by family key so paginated slides survive page-count drift"
```
