# Admin Report Customization (deck2 style choices, in-app) — Design Spec

**Date:** 2026-07-25
**Status:** Approved (owner authorized autonomous execution — "run everything and finish everything")
**Owner:** Reporting (`src/data/reporting/executive/deck2/`), Reports tab
(`src/components/Sidebar/Tabs/Reports/`)

> Combines the two workstreams the owner called "wire the preview into the app so an admin can
> customize and save, so exports pick it up" and "feed the preview real app data." They turn out
> to be the same feature: `deck-preview.html` is a dev-only Vite entry (not part of the single-file
> production build, no auth) — it cannot literally be "opened" from inside the shipped app. What
> gets built instead is a **new in-app admin surface** that reuses deck2's existing rendering
> engine and variant-switcher chrome, fed with the same real `ExecutiveReportInput` the Reports tab
> already assembles for every other export (see `Reports/index.tsx`'s `loadExecInput`) — so "real
> data" is solved by construction, not a separate integration. The standalone dev tool
> (`deck-preview.html`) is untouched; it stays as an internal design-exploration tool.

## 1. Problem statement

Today, `buildExecutiveDeckV2` always renders `bodyVariants[0]` for every slide in production —
the only way to see or choose an alternate variant is the dev-only preview tool, whose choices
persist to a gitignored dev-workspace file via a Vite dev-middleware that doesn't exist in the
shipped app. The owner wants: an admin-only button on the Executive Report (Reports tab) that
opens an in-app preview of the *current real month's* report, lets the admin cycle each page
through its variants (same switcher UX as the dev tool), and **save** the chosen combination —
so that every subsequent real export (`openExecutiveDeckV2`, both call sites in `Reports/index.tsx`)
renders each slide using its saved variant instead of always variant 0.

## 2. Decisions

| Question | Decision |
|---|---|
| Scope of choices | **Global, not per-month.** One saved combination applies to every month's export — this is a house-style decision ("we use this layout"), not a per-report setting. Simpler data shape, matches "customize the report" (singular), not "customize this month's report." |
| Where choices persist | Workspace disk, `6-templates/deck2.style-choices.json` (mirrors `template.selection.json`'s location/shape exactly — see `templateSelectionStorage.ts`), via `safeReadJson`/`safeWriteJson` + `casLoop` + `withResourceLock` (same CAS-protected shared-file pattern already used for the template selection). |
| Data flowing through the customizer preview | The *exact* `ExecutiveReportInput` the Reports tab already builds in `loadExecInput` for the selected month — genuinely real data, no new fixture. |
| Relationship to the existing dev tool | **None — kept separate.** `deck-preview.html`/`deckPreview.ts`/`deckStyleChoicesPlugin.ts` are untouched; they remain a dev-only design-exploration tool against a synthetic fixture. The new in-app customizer is new code. |
| Which slides are customizable | Every slide already wired into the 4-variant switcher (all of them, per the `bodyVariants` convention) — the customizer doesn't special-case which pages have >1 real variant built; a page still on 1/4 just has 3 identical panels, which is harmless (picking slot 1/2/3 there is a no-op visually until that page gets a real second variant, which is exactly what the parallel design-fan-out work is filling in). |
| Access control | Admin-only. A new button in `Reports/index.tsx`, gated the same way `AdminToolbar.tsx` gates its own admin-only controls (role check against the current session's role), since this is a new capability not yet in the formal tab/feature-permission matrix (`tabCatalog.ts`) — adding it there is out of scope for this pass; a straightforward role gate is the minimum bar and matches an existing precedent in the codebase. |
| How the in-iframe switcher reports a choice back to the app | The existing `DECK_VARIANT_SCRIPT`'s `persist()` function (in `deck2/index.ts`) already does `fetch('/__deck-style-choices', {...})` for the dev tool. It gains a **second, unconditional call**: `window.parent.postMessage({ type: "deck2-style-choice", slideId, variantIndex }, "*")`. This is harmless everywhere it already runs (the dev tool's own `srcdoc` iframe has no listener for it; a standalone opened/downloaded report is never in `variantPreview` mode so this whole script block never even renders) and is exactly what the new in-app customizer's iframe needs. No new script variant, no new opt flag. |
| How saved choices affect the *initial* state of the preview (not just production) | Same data structure double-duty: `renderVariants` (preview mode) initializes `data-active-index` / the `active` class to the saved index for that slide (default 0) instead of always 0, so re-opening the customizer shows what's currently saved, not always variant 1. |
| How `styleChoices` reaches `renderVariants` without touching every one of the ~18 slide-builder function signatures | **Module-level "active style choices" for the duration of one build call**, not a new parameter threaded through every slide builder. `buildExecutiveDeckV2` calls a setter (`setActiveStyleChoices(opts?.styleChoices)`) once at the top, before building any slides; `v2Slide`/`renderVariants` (the single choke point every slide already funnels through) read it via a getter. This mirrors the codebase's existing comfort with narrowly-scoped module state for a single synchronous call (e.g. `LEVEL_DRAW_WEIGHTS` computed once at module load) and avoids a ~18-file signature change for what is, mechanically, one cross-cutting concern. Reports are always built synchronously and non-concurrently within one JS turn, so there is no cross-call interference risk. |

## 3. Architecture

### 3.1 Persistence module

New file `src/data/reporting/executive/deck2/styleChoices.ts`, modeled directly on
`src/data/templates/templateSelectionStorage.ts`:

```ts
export type DeckStyleChoices = {
  choices: Record<string, number>; // slideId -> variant index (0-3)
  updatedAt: string;
  updatedBy: string;
  revision?: number;
  _writeToken?: string;
};

export async function loadDeckStyleChoices(directoryHandle): Promise<DeckStyleChoices | null>
export async function saveDeckStyleChoices(directoryHandle, choices: Record<string, number>, updatedBy: string): Promise<{ok:true}|{ok:false,error:string}>
```

File: `6-templates/deck2.style-choices.json` (via the existing `getTemplatesRoot` helper).
Same CAS pattern as `saveInspectionTemplateSelection`: `withResourceLock` + `casLoop`, revision
bump, `_writeToken` verified on read-back.

### 3.2 `buildExecutiveDeckV2` / `v2Slide` / `renderVariants` changes

- `buildExecutiveDeckV2`'s `opts` type gains `styleChoices?: Record<string, number>`.
- At the top of `buildExecutiveDeckV2`, before building slides: `setActiveStyleChoices(opts?.styleChoices ?? null)` (new exported setter in `slideKit.ts`); a `finally`-style reset back to `null` after the HTML string is built, so no state leaks between calls.
- `renderVariants(slideId, bodies, variantPreview)`:
  - reads `getActiveStyleChoices()?.[slideId]` → `chosenIndex` (default 0, clamped to 0-3).
  - production (`!variantPreview`): returns `bodies[chosenIndex]` instead of always `bodies[0]`.
  - preview (`variantPreview`): panel `chosenIndex` gets `active`/is used for `data-active-index`, instead of always panel 0.
- `openExecutiveDeckV2` (both call sites already pass `execInput`/`employeeDisplayNames`) gains a new optional third param `styleChoices?: Record<string, number>`, forwarded straight to `buildExecutiveDeckV2`'s opts.

### 3.3 `DECK_VARIANT_SCRIPT` change

One line added inside the existing `persist(slideId, index)` function: the `window.parent.postMessage(...)` call described in §2, alongside (not replacing) the existing dev-tool `fetch(...)` call.

### 3.4 New in-app component

New file `src/components/Sidebar/Tabs/Reports/DeckDesignCustomizer.tsx` — a full-screen modal:
- Props: the same `execInput`/`employeeDisplayNames` `Reports/index.tsx` already has in scope at its export-button call sites, plus `directoryHandle` (for load/save) and `onClose`.
- On mount: `loadDeckStyleChoices(directoryHandle)` → seed local state; build the deck HTML once via `buildExecutiveDeckV2(execInput, employeeDisplayNames, { variantPreview: true, styleChoices: <loaded choices, if any> })`; render into an `<iframe srcdoc={html}>` (same pattern as `deckPreview.ts`'s `frame.srcdoc`).
- `window.addEventListener("message", ...)` filtering `event.data?.type === "deck2-style-choice"`, accumulating `{ [slideId]: variantIndex }` into local component state (not auto-saved per click — matches "customize... and save it" as an explicit action).
- A "حفظ" (Save) button calling `saveDeckStyleChoices(directoryHandle, accumulatedChoices, currentUsername)`, toast on success/failure (same `showToast` pattern already used throughout `Reports/index.tsx`).
- A close button (discards unsaved in-panel changes — the iframe's own DOM state is not the source of truth, the accumulated local state is, and it's only written to disk on Save).

### 3.5 Button wiring

In `Reports/index.tsx`, near the existing deck export button (~line 322/420): a new admin-only
button "تخصيص تصميم العرض" that opens `DeckDesignCustomizer`. Both existing `openExecutiveDeckV2`
call sites are updated to load saved choices first (`loadDeckStyleChoices`) and pass them through,
so every real export reflects the saved customization.

## 4. Non-goals / guarantees

- No change to `deck-preview.html`/`deckPreview.ts`/`deckPreviewFixture.ts`/`deckStyleChoicesPlugin.ts` (the existing dev tool).
- No change to any individual slide-builder function's signature (the ~18 files under `deck2/slides.ts` and `deck2/section3/`) — the styleChoices mechanism is confined to `slideKit.ts` (`v2Slide`/`renderVariants`) and `deck2/index.ts` (`buildExecutiveDeckV2`, `DECK_VARIANT_SCRIPT`).
- No new business logic / no new report data — this is presentation-selection plumbing only.
- Backward compatible: `buildExecutiveDeckV2` called with no `styleChoices` (or an empty object) behaves exactly as today (every slide renders variant 0).

## 5. Testing / verification

- Unit tests for `styleChoices.ts` (load/save round-trip, CAS conflict handling — mirror `templateSelectionStorage.test.ts`'s test shape) using `createMemoryDirectory()`.
- `deck2.test.ts`: production output with a `styleChoices` map selecting a non-zero index for `slide-risk-stages` (the one slide with a real 2nd variant today) renders variant 1's markup instead of variant 0's; with no `styleChoices`, output is byte-identical to today (regression guard).
- Manual verification: open the Reports tab as admin, click the new button, cycle a slide, save, re-open the customizer (confirm it reopens on the saved index, not always 0), then export the real deck and confirm the exported HTML reflects the saved choice.
