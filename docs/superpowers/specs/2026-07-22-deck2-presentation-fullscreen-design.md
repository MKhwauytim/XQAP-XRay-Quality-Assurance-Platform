# Executive deck (deck2) — icon fullscreen button + true slideshow presentation mode

**Status:** approved by owner (both design sections), 2026-07-22
**Scope:** `src/data/reporting/executive/deck2/` (the v2 executive deck's fullscreen control) + the shared icon set + labels. Does not touch `deck/` (v1, reference edition) or the Document/Workbook editions.

## Context

`buildDeckV2Html` (`deck2/index.ts`) already ships a working fullscreen toggle
(`#deck-fullscreen-button`) wired to the real Fullscreen API
(`DECK_FULLSCREEN_SCRIPT` in `theme.ts`), confirmed live in the running dev
preview: `document.fullscreenEnabled` is `true` even inside the dev preview's
`srcdoc` iframe (`deck-preview.html`), so no permissions-policy workaround is
needed anywhere in this work.

Today, "fullscreen" just enlarges the existing scrollable stack of slides
(`body.deck-fullscreen` pins the toolbar to the top and lets every slide
scroll past, snap-to-slide). The owner wants two things instead:

1. The toggle button itself becomes icon-only — the standard two-diagonal-arrow
   expand glyph — instead of the current text label "ملء الشاشة".
2. Clicking it should feel like an actual presentation (PowerPoint Slide Show
   / Google Slides Present): **one slide fills the screen at a time**, not a
   scrollable stack.

Both were confirmed explicitly during brainstorming, including the specific
implementation approach (index-driven single-slide visibility over a
scroll-snap carousel — see "Rejected approach" below).

## Button

Icon-only, same toolbar slot. Two SVG icons ship as children of the existing
`#deck-fullscreen-button` (`btn btn-fullscreen`); CSS shows exactly one based
on `[aria-pressed]`, so the button's `innerHTML` is fixed at build time and
never rewritten at runtime:

- `aria-pressed="false"` (idle): **expand** icon — outward-pointing arrow in
  the top-inner corner, another in the bottom-inner corner.
- `aria-pressed="true"` (active): **compress** icon — the same two arrows,
  flipped inward.

`aria-label`/`title` keep coming from the existing configurable labels
(`exec_deck_fullscreen_enter`/`exec_deck_fullscreen_exit` — unchanged keys,
unchanged default Arabic values) so screen readers and tooltips are unaffected;
only the *visible rendering* changes from text to icon. This also means
`sync()` (in `DECK_FULLSCREEN_SCRIPT`) must stop doing
`button.textContent = label` — that line is deleted; `sync()` only ever
touches `aria-pressed`/`aria-label`/`title` going forward, which is what makes
the fixed dual-icon markup safe from being clobbered.

New icons added to the shared set (`ui/icons.ts`), following the file's
existing convention exactly (`viewBox="0 0 24 24"`, `stroke="currentColor"`,
no fill):

```ts
expand:
  '<path d="M9 4H4v5"/><path d="M15 4h5v5"/><path d="M4 15v5h5"/><path d="M20 15v5h-5"/>',
compress:
  '<path d="M4 9h5V4"/><path d="M20 9h-5V4"/><path d="M4 15h5v5"/><path d="M20 15h-5v5"/>',
```

(Four corner brackets rather than two long diagonals — clearer at the 13–16px
toolbar size this button renders at than two thin diagonal lines would be, while
still reading as the same universal "expand/compress" glyph family. If this
doesn't read right once rendered, it's a one-file tweak to `icons.ts`, nothing
else depends on the exact path data.)

## Entering slideshow

Click → `request.call(root)` (unchanged call) fires together with switching
into the new single-slide layout. The slide that was most in view at click
time becomes the starting slide — reuses the same "which slide is at least
35% into the viewport" logic `DECK_NAV_SCRIPT.update()` already computes for
the side-nav progress indicator, so inspecting slide 6 and hitting fullscreen
opens on slide 6, not the cover.

## Layout

`body.deck-fullscreen`'s ruleset is **replaced**, not layered — same class
name, new meaning, no second class introduced (avoids leaving the old
scroll-stack rules as dead CSS next to a new one):

- Every `.slide` is hidden except `.slide` at the current active index
  (plain index into `Array.from(document.querySelectorAll('.slide'))`,
  computed client-side at script-init time — no new `data-*` attributes need
  to be written at build time).
- The active slide is fit to the viewport at its native 16:9, centered,
  letterboxed on whichever axis doesn't match the window's ratio — reuses the
  aspect-fit `calc()` already in the current fullscreen CSS
  (`calc((100dvh - 94px) * 297 / 167)`), adjusted since there's no pinned
  toolbar height to subtract anymore.
- `.deck-nav`, the full `.deck-toolbar` (print/theme buttons), and
  `.srev-footer` are hidden (`.deck-nav`/`.srev-footer` rules already exist;
  `.deck-toolbar` changes from "pin to top" to `display:none`).
- Resize is handled entirely by CSS `calc()`/viewport units — no JS resize
  listener needed for slideshow layout (unlike `DECK_NAV_SCRIPT`'s progress
  bar, which needs one because that's JS-computed pixel math).

## Navigation

- **Keyboard:** →/←, Space, PageDown/PageUp move next/previous — the
  PowerPoint convention, kept regardless of RTL content. Handler checks
  `current()` (i.e. `document.fullscreenElement`) before acting, so it never
  hijacks arrow keys/Space outside slideshow.
- **Click-anywhere-to-advance:** clicking the visible slide moves to the next
  one. The click handler ignores clicks whose target is inside the nav
  controls or the fullscreen button itself (`event.target.closest(...)`) so
  those keep their own behavior.
- **On-screen controls** — prev/next arrows vertically centered on the
  inline-start/inline-end edges, a plain `"3 / 10"` numeral counter
  bottom-center (no label key needed — just digits, like the existing
  `v2-page-foot` numbering), and the fullscreen button itself repositioned to
  a fixed corner. All four share one class (`deck-slideshow-chrome`); a single
  `body.deck-controls-visible` toggle (set on `mousemove`, cleared by a
  ~2.5s idle `setTimeout`, reset on every move) fades them in/out together —
  same pattern as YouTube/Netflix controls. Escape always works as a native
  browser fallback regardless of this state.
- **Boundaries:** prev/next clamp (no wrap-around) — first slide's "previous"
  and last slide's "next" are no-ops.
- New label keys for the two arrow buttons' `aria-label`/`title` (per this
  repo's "prefer a label key over a hard-coded string" convention):
  `exec_deck_slideshow_prev` ("الشريحة السابقة"),
  `exec_deck_slideshow_next` ("الشريحة التالية"). Registered in
  `Settings/index.tsx`'s admin label-override list alongside the existing
  fullscreen entries so they're editable the same way.

## Leaving

Escape, the browser's native exit-fullscreen control, or the button again all
correctly fall back to the normal scrollable view — the existing
`fullscreenchange`/`fullscreenerror` listeners already drive `sync()`/
`disable()` for "left fullscreen some other way"; `sync()` gains one more
step: when transitioning from active → idle, scroll the normal view to the
slide that was showing (`scrollIntoView`) so context isn't lost.

## Rejected approach

**Scroll-snap carousel** (extend the existing `scroll-snap-type:y mandatory`,
clip to one slide's height, arrow keys call `scrollIntoView`): gets
smooth-scroll/trackpad-swipe "for free" but Chromium scroll-snap has known
rough edges (stray wheel input, snap-point drift on resize) that are harder
to fully lock down than plain `display` toggling on a tracked index. Owner
picked the index-driven approach for the more predictable, instant-cut feel
that actually matches how PowerPoint/Slides behave.

## Files touched

| File | Change |
|---|---|
| `src/data/reporting/executive/ui/icons.ts` | Add `expand`/`compress` paths + named exports |
| `src/data/reporting/executive/deck2/index.ts` | Button markup (both icons as fixed children); `DECK_FULLSCREEN_SCRIPT` extended with index tracking, keyboard handler, click-to-advance, fading chrome, `sync()`/`disable()` updates |
| `src/data/reporting/executive/deck2/theme.ts` | `body.deck-fullscreen` ruleset replaced with single-slide layout + fading-chrome CSS; print-hide rule extended to the new elements |
| `src/data/labels/labelsStore.ts` | Add `exec_deck_slideshow_prev`, `exec_deck_slideshow_next` |
| `src/components/Sidebar/Tabs/Settings/index.tsx` | Register the two new keys in the admin label-override list (~line 200) |
| `src/data/reporting/executive/deck2/deck2.test.ts` | Extend/add tests (below) |

## Testing

This file is Vitest/`node`-environment — string-level assertions on the
generated HTML/CSS/script text, matching how the *existing* two fullscreen
tests already work (not real browser interaction):

- Both existing fullscreen tests keep passing unchanged (aria-label,
  `requestFullscreen` fallback chain, `button.hidden`, the print rule,
  configurable labels) — the regression check that this doesn't break the
  current contract.
- New: button markup contains both icon markers; generated CSS contains the
  single-slide layout rules; the print rule extends to the new chrome
  elements; the script contains the keyboard/click-advance/fade-timeout
  markers and the exit-time `scrollIntoView` restore; the two new label keys
  exist with their Arabic defaults and are honored when overridden (same
  pattern as the existing "uses the configurable Arabic labels" test).
- Manual pass in the live dev preview (already running): enter slideshow,
  arrow-key through slides, confirm click-anywhere advances, confirm chrome
  fades in/out on mouse movement and Escape/button both exit cleanly onto the
  right slide, resize the window, confirm print view still hides everything.

Per this repo's `CLAUDE.md`, every edit gets logged in
`docs/edit logs/2026-07-22.md` (version bump, before/after snippets per file,
line-count stats) as part of implementation — not part of this spec.

## Non-goals

- Not touching `deck/` (v1) or the Document/Workbook editions.
- Not adding slide transition animations/effects beyond an instant cut —
  matches PowerPoint's default, avoids scope creep into a transition system.
- Not persisting the active-slide index or any slideshow state across reopens
  — matches the existing theme toggle's in-memory-only behavior in the same
  toolbar.
- Not building presenter-notes, timers, or any other Slide-Show-view feature
  beyond navigation — out of scope for this pass.
