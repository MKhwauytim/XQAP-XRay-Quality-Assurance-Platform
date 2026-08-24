# Global layout: bounded app shell, shared page-shell primitive, card-row convention — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three related global layout fixes, grouped so each group is independently landable:

1. **Group 1 (Tasks 1–6)** — Convert the app shell from *document-scrolls* to *bounded shell with independently-scrolling regions*, so the sidebar's nav list actually clips and the sign-out button in `.sidebar-footer` is always visible without scrolling the whole page.
2. **Group 2 (Tasks 7–9)** — Replace four hand-rolled page-root width/padding schemes with one shared `.page-shell` primitive in `primitives.css`, standardising on `max-width: 1600px`. This is what widens Reports, whose 1040px cap is the "wasted space / cramped tables" complaint.
3. **Group 3 (Tasks 10–11)** — Fix the one concrete card-inconsistency instance in Phase 2's verdict row and add a documented `.ui-card-row` primitive matching the convention the app *already* follows.

**Architecture:** Groups 2 and 3 are pure CSS with no behavioural surface. Group 1 is not — moving the scrollport from the document to `.app-workspace` silently changes the containing block for every `position: sticky` element, the target of every body-scroll lock, and the meaning of `window.scrollY`. Group 1 therefore opens with a mandatory risk sweep (Task 1) whose output gates every later step in the group.

**Tech Stack:** Plain co-located CSS (no framework), CSS custom properties from `src/index.css`, React 19 + TypeScript strict for the two `.tsx` changes in Group 1. Vitest + `@testing-library/react` for component tests; `uiScaleCss.contract.test.ts` is an existing source-text CSS guard that this plan extends.

**Tier:** **3** for every group — Group 1 touches the app shell (architecture), Group 2 adds a shared primitive consumed by four pages, Group 3 edits `primitives.css`. Full gate sequence per `CLAUDE.md`'s ladder, plus the real-browser protocol in *Verification* below.

**Version plan** (`package.json` is at `115.2.0` today; each group is a whole-number bump because each changes shared/architectural surface):

| Group | Version | Edit-log title |
|---|---|---|
| 1 | `v116.0` | `Refactor (app-shell): bound the shell height so the sidebar and sign-out stay on screen` |
| 2 | `v117.0` | `Refactor (css): one shared .page-shell primitive replaces four hand-rolled page widths` |
| 3 | `v118.0` | `Fix (css): normalise the Phase 2 verdict row onto the app's card-row convention` |

---

## Global Constraints

- Every group needs a `docs/edit logs/2026-08-24.md` entry generated with `npm run editlog -- --tier=3 --append --sync-package "…"`. **Today's file does not exist yet** — the first `--append` creates it. Insert newest-first; `npm run check:release` reads only the topmost heading.
- Never a bare `git commit` — always `git add <specific files>` then `git commit -m "…" -- <same files>`.
- **`--app-vh` / `--app-vw`, never raw `100vh` / `100vw`.** `src/data/preferences/uiScaleCss.contract.test.ts:89-103` fails the suite on any raw viewport unit outside the two definitions in `index.css`. Every new height rule in this plan must use `var(--app-vh)`. This is not optional and is not caught by lint.
- `html { zoom: var(--ui-scale) }` (`src/index.css:251`) is load-bearing. Do **not** introduce a `transform`, `filter`, `perspective`, `will-change`, or `contain` on `#root`, `.app-shell`, `.app-workspace`, or `.sidebar` — any of those makes the element a containing block for `position: fixed` descendants and would tear the sidebar drawer, `ModalPortal` backdrops, `AnchoredPopover`, `.app-backup-toast` and `FeedbackWidget` off the viewport. `overflow` does **not** have this effect and is safe.
- Sampling, distribution folding, and report/export builders are untouched by every task here. Everything under `src/data/reporting/**` and `.../Population/reporting/reportHtmlBuilder.ts` generates **standalone exported HTML documents** that open in their own tab — those files contain their own `@media print`, `IntersectionObserver` and `window.innerHeight` code that has nothing to do with the app shell. Do not "fix" any of it; it will dominate your grep results.
- Repo gates before any group is considered done: see *Testing summary* at the end. `npm run build` is mandatory before pushing, at every tier, and **`npm run e2e` is added to the sweep for this plan** — see the rationale there.

---

# GROUP 1 — Bounded app shell

## Root cause (confirmed)

Nothing in the shell is height-bounded and nothing declares `overflow`, so the whole `<body>` grows to content height and the **document** is the only scroll container in the app:

| File:line | Declaration | Problem |
|---|---|---|
| `src/index.css:238-260` | `html { min-height: 100% }` | no `height`, no `overflow` |
| `src/index.css:262-270` | `body { min-height: var(--app-vh); overflow-x: hidden }` | `overflow-y` unconstrained |
| `src/index.css:272-280` | `#root { min-height: var(--app-vh) }` | grows with content |
| `src/App.css:13` | `.app-shell { min-height: calc(var(--app-vh) - var(--topbar-height)) }` | `min-height`, not `height` |
| `src/App.css:47` | `.app-workspace { min-height: … }` | no `overflow-y` |
| `src/components/Sidebar/Sidebar.css:38` | `.sidebar { min-height: … }` | no `height`, no `position: sticky` on desktop |
| `src/components/Sidebar/Sidebar.css:211-220` | `.sidebar-nav { flex: 1; overflow-y: auto }` | **intended** scroller — never clips, because `.sidebar`'s height is unbounded |

`.sidebar-footer` (`Sidebar.css:499-508`) carrying `.sidebar-footer-logout` (`:548-570`) is the last flex child after that never-clipping nav, so on any page taller than the viewport, reaching sign-out means scrolling the entire document.

The fix is to bound the chain `html → body → #root → .app-shell → {.app-workspace, .sidebar}` and give `.app-workspace` its own `overflow-y: auto`.

## Risk register (pre-populated — Task 1 must complete and extend it)

Verified during planning. Each row is re-verified in Task 6's browser pass.

| # | Site | Today | Under a bounded shell | Action |
|---|---|---|---|---|
| R1 | `src/App.tsx:225-237` | Per-tab scroll memory via `window.scrollTo` / `window.scrollY` | `window.scrollY` is always `0`, `window.scrollTo` is a no-op → **scroll memory silently dies** | **Must migrate** to a ref on `.app-workspace` (Task 3) |
| R2 | `src/components/ModalPortal/ModalPortal.tsx:7-21` | Ref-counted `document.body.style.overflow = "hidden"` | Body never scrolled → lock is a no-op, **content behind an open modal still scrolls** | **Must migrate** the lock to the scrollport (Task 4) |
| R3 | `src/components/ModalShell/ModalShell.test.tsx:113,115` | Asserts `document.body.style.overflow` | Fails once R2 moves | Update alongside R2 |
| R4 | `src/App.tsx:254-261` | Mobile-drawer body lock, same mechanism as R2 | Same no-op | Migrate with R2 |
| R5 | `src/auth/AdminToolbar.css:7-10` | `position: sticky; top: 0` on a document-scrolled body | Sits *outside* `.app-shell` (rendered by `AuthGate.tsx:714`), so it becomes a fixed-height flex row that **never needs to stick** | Verify visually; no CSS change expected |
| R6 | `src/components/InspectionPanel/InspectionPanel.css:30-38` | `position: sticky; top: 16px` relative to the document — **slides under the 56px toolbar today** | Scrollport becomes `.app-workspace`, so `top: 16px` is measured below the toolbar — an **improvement** | Verify; likely no change |
| R7 | `.../XrayReferrals/XrayReferrals.css:265-274` | `.ew-ref-empty-panel` sticky, mirrors R6 | Same as R6 | Verify |
| R8 | `src/components/DataTable/DataTable.css:159,164` | `max-height: calc((var(--app-vh) - 260px) * …)` — the `260px`/`214px` are guesses at chrome above the table under document scroll | Still viewport-relative and still correct, but the table's scroller is now **nested inside** `.app-workspace`'s scroller (double scrollbar) | Verify at 1280×800 and 1920×1080; adjust the magic numbers only if a visible dead band appears |
| R9 | `src/components/Sidebar/Tabs/Population/Population.css:80` and `.../UserManagement/UserManagement.css:6` | `min-height: calc(var(--app-vh) - 44px)` — but `--topbar-height` is **56px**, and `.app-workspace` adds `--sp-5/--sp-6/--sp-8` padding | Guarantees a permanent small overflow inside the new scrollport → a scrollbar that can never be scrolled away | **Must remove** (Task 5) |
| R10 | `src/App.css:55-63` | `.app-workspace::before` is `position: fixed; inset: 0 var(--sidebar-width) auto 0; z-index: 0` — a viewport-pinned hairline currently hidden behind the toolbar's `z-index: 1000` | Unchanged (fixed, not sticky) | Verify it is still invisible / not double-drawn |
| R11 | `src/components/Popover/AnchoredPopover.tsx:181-187` | Repositions on **capture-phase** `window` `scroll` — deliberately, "so scrolling any ancestor container counts" | Capture phase already receives `.app-workspace` scroll events → **safe as-is** | Verify only |
| R12 | `src/App.css:191-247` mobile block | `.app-shell { display: block }`, `.app-workspace { min-height: calc(100dvh - …) }`; `.sidebar` becomes `position: fixed` with `max-height: 100dvh; overflow: hidden` (`Sidebar.css:592-611`) | A blanket `body { overflow: hidden }` removes mobile URL-bar collapse and can strand content | **Must re-declare** the mobile block explicitly (Task 2 Step 5) |
| R13 | `src/App.css:82-88` | `.app-workspace > div { animation: view-enter … }` animates `transform` | A *finished* animation leaves no `transform`, but **while running** the tab wrapper is a containing block for `position: fixed` — this is exactly why `ModalPortal` exists (see its module doc). Unchanged by this plan | Verify a modal opened within ~400 ms of a tab switch still covers the viewport |
| **R14** | `src/components/Sidebar/Tabs/Population/Population.css:3582` | `.pop-action-bar { position: sticky; inset-block-end: var(--sp-3) }` — **bottom-sticky** against the document | Bottom-sticky is the most fragile kind: "bottom" moves from the document's bottom to `.app-workspace`'s scrollport bottom | **Verify explicitly** on Phase 3/4 with a long page; expected to work and to look *better*, but this is the row most likely to surprise |
| **R15** | `Population.css:2475` `.pop-subtab-bar` (`top: 0; z-index: 10`); `EmployeeWorkspace.css:2010` `.ew-bulk-bar` (`top: 0; z-index: 5`) | Document-sticky top bars | Stick to the top of `.app-workspace` instead of the viewport — below the toolbar rather than under it. An improvement, same as R6 | Verify both |
| **R16** | `KpiDashboard.css:710` `.kpi-port-detail`; `EmployeeWorkspace.css:2210` `.ew-approval-detail`; `NotificationManager.css:512` `.ntf-detail` — all `top: 16px` / `var(--sp-5)` | Three more document-sticky detail panes, same family as R6/R7 | Same as R6 | Verify each with a long list beside it |
| **R17** | `src/components/Sidebar/Tabs/ReportDesigner/ReportDesigner.css:848-869` | `@media print` does `body > *:not(.rd-print-overlay) { display: none !important }` and `.rd-print-overlay { position: static !important }` | **Breaks.** With `html`/`body` at `height: 100%; overflow: hidden`, a `position: static` overlay is clipped to one screen and **prints one page instead of paginating.** The `display: none` rule also depends on `.rd-print-overlay` remaining a direct child of `<body>` (it does — `ModalPortal` portals there) | **Must add a `@media print` escape** (Task 2 Step 5b) |
| **R18** | `e2e/ui-scale.spec.ts:47-62` | Asserts `document.querySelector(".app-shell").getBoundingClientRect().height >= window.innerHeight - 2` | **Breaks.** `.app-shell` becomes exactly `viewport − toolbar − banners`, which is ~56px short of the viewport by design | **Must update the assertion** (Task 2 Step 8) |
| **R19** | `src/components/ModalShell/ModalShell.test.tsx:113-115` | Asserts `document.body.style.overflow` | **False green** — it keeps passing while the lock is functionally dead, because the inline style is still written; it just no longer locks anything | Covered by Task 4; call the false-green out in the edit log |
| **R20** | `AuthGate.tsx:904`, `WorkspaceGate.tsx:265`, `FeedbackWidget.tsx:223`, `Sidebar.tsx:131` | Overlays rendered **in-tree, not portalled**, relying on `position: fixed` | Unaffected as long as no ancestor gains `transform`/`filter`/`contain` (Task 1 Step 3). `AuthGate`/`WorkspaceGate` render *outside* `.app-shell` anyway | Verify visually |
| **R21** | `.../ReportDesigner/editor/FieldDropDialog.tsx:60-61` | Hand-rolled clamp on `window.innerWidth`/`innerHeight`, **not** routed through `anchoredPosition.ts` | Still viewport-correct (the dialog is `fixed`), but it can now overhang the internal scroll region rather than being clipped by it | Verify a drop dialog near the canvas edge |
| **R22** | `src/components/Popover/AnchoredPopover.tsx:106` | Clamps to `window.innerWidth`/`innerHeight` | Deliberate: popovers clamp to the **real viewport**, not the shell box. A popover anchored near a scrollport edge overhangs the region instead of being clipped — arguably correct for a `fixed` portalled popover | Decide intentionally; expected: leave as-is |
| **R23** | `src/components/Sidebar/BootSplashOverlay.css:27-33` | Comment states the overlay compensates for `.app-workspace` "scrolling and being several screens tall"; `grid-template-rows: min(100%, calc(var(--app-vh) - …))` | The premise changes — `.app-workspace` is now viewport-height with internal scroll. The `min(100%, …)` already clamps correctly, but **the comment becomes wrong** | Re-read and update the comment; verify per the boot-splash caution |
| **R24** | `100dvh` at `App.css:199`, `Sidebar.css:601-602`, `AuthGate.css:55,82,654` | Raw `dvh` — **not** matched by `uiScaleCss.contract.test.ts`'s `\b100v[hw]\b` regex, so these bypass the guard | Unchanged, but they are viewport-derived heights the guard does not police | Note only; do not "fix" in this plan |

**Not found anywhere in `src/`** (verified, so no work needed): `window.scrollX`, `window.pageYOffset`, `document.documentElement.scrollTop`, `document.body.scrollTop`, `scrollBy`, `scrollIntoView` in app code, `IntersectionObserver` in app code, `visualViewport`, `matchMedia`, and any infinite-scroll implementation. `DataTable`'s `useVirtualizer` is element-scoped to `.dt-table-wrap` (`index.tsx:565-577`) and its `ResizeObserver` observes that element, not the viewport — safe, **but ~25 test files stub `ResizeObserver` as a no-op, so jsdom will not catch a virtualization regression here.** Only the browser pass will.

---

### Task 1: Complete the risk sweep before touching any CSS

**Files:** none modified. Output is an updated risk register appended to this document (or to the group's edit-log entry).

**This task is the single highest-risk part of the plan and must not be skipped or compressed.** The table above was built during planning and is *not* claimed to be exhaustive.

- [ ] **Step 1: Sweep for document-scroll dependencies**

Run each and reconcile every hit against the register above; add any row that is missing:

```bash
grep -rn "window\.scrollTo\|window\.scrollY\|window\.scrollX\|pageYOffset\|documentElement\.scrollTop\|body\.scrollTop\|scrollBy" src/
grep -rn "scrollIntoView" src/
grep -rn "body\.style\.overflow\|documentElement\.style\.overflow" src/
grep -rn "window\.innerHeight\|window\.innerWidth\|visualViewport" src/
grep -rn "position: *sticky" src/ --include=*.css
grep -rn "position: *fixed" src/ --include=*.css
grep -rn "createPortal" src/
grep -rn "IntersectionObserver\|ResizeObserver" src/
grep -rn "@media print" src/ --include=*.css
```

Also sweep `e2e/`, not just `src/` — the Playwright suite drives real layout and is the only place a scroll assumption can be encoded as a passing assertion.

- [ ] **Step 2: Classify every `position: sticky` hit**

There are **20** as of this writing. For each, record whether its nearest scrolling ancestor is (a) the document today, or (b) an already-bounded ancestor. Only class (a) changes behaviour.

**Class (a) — document-scrolled, all already in the register:** `.auth-admin-toolbar` (R5), `.ip-panel--right` (R6), `.ew-ref-empty-panel` (R7), `.pop-action-bar` (R14, bottom-sticky), `.pop-subtab-bar` + `.ew-bulk-bar` (R15), `.kpi-port-detail` + `.ew-approval-detail` + `.ntf-detail` (R16), and `.app-mobile-nav-button` (`App.css:203-222`, mobile only).

**Class (b) — already inside a bounded `overflow` ancestor, no action:** `.dt-th` / `.dt-sticky-col` inside `.dt-table-wrap` (`DataTable.css:152-159`), `.ref-th` inside `.ref-table-wrap` (`EmployeeWorkspace.css:1285-1291`), `.distribution-header` inside `.distribution-table-wrapper` (`Population.css:1845-1852`), `.cg-th` inside `.certscan-grid-scroll` (`Population.css:2360`), `.amw-th` inside `.amw-scroll` (`MappingWorkbench.css`), and the four `UserManagement.css` sticky columns/headers inside `.um-perm-table-wrap` / `.um-feat-matrix-wrap` / `.um-activity-table-wrap` (`:655`, `:823`, `:1064-1066`).

**If your sweep produces a hit not in either list, add it to the register before proceeding.**

- [ ] **Step 3: Classify every `position: fixed` hit**

`overflow` does not create a containing block for `position: fixed`, so these are expected to be unaffected. Confirm none of them gains a transformed/filtered ancestor as a result of this plan (none should — no task here adds one). Known fixed sites to eyeball in Task 6: `.app-backup-toast` (`App.css:110-127`), `.app-bak-warning` (`:143-159`), `.app-workspace::before` (R10), `.app-mobile-nav-backdrop` (`:229-240`), the mobile `.sidebar` (R12), `FeedbackWidget`, and every `ModalPortal` backdrop.

- [ ] **Step 4: Write the completed register into the group's edit-log entry**

The register is the evidence that Task 6's browser pass covered everything. A row with no verification result is an unfinished task.

---

### Task 2: Bound the shell and give `.app-workspace` its own scrollport

**Files:**
- Modify: `src/index.css` (the `html` / `body` / `#root` block, lines 238-280)
- Modify: `src/App.css` (`.app-shell` :5-35, `.app-workspace` :41-53, mobile block :191-247)
- Modify: `src/components/Sidebar/Sidebar.css` (`.sidebar` :33-54)

**Interfaces:**
- Consumes: `--app-vh`, `--topbar-height`, `--sidebar-width`, `--sidebar-collapsed-width` — all pre-existing, unchanged.
- Produces: a new scrollport at `.app-workspace`. Nothing else in the app may assume the document scrolls after this task.

> **The single most common failure mode for this change:** a grid or flex item defaults to `min-height: auto`, which refuses to shrink below its content, so `overflow` on it never engages and the parent overflows instead. **`min-height: 0` is required on `.app-workspace` and `.sidebar`** in addition to `overflow`. If the sidebar footer still scrolls off after this task, this is why.

- [ ] **Step 1: Bound `html` / `body` / `#root`**

`src/index.css:238-280`. In the `html` rule, replace:

```css
  width: 100%;
  min-width: 320px;
  min-height: 100%;
```

with:

```css
  width: 100%;
  min-width: 320px;
  /* Bounded, not `min-height`: the whole shell below is a fixed-height
     layout with its own internal scroll regions (.app-workspace and
     .sidebar-nav). Letting the document scroll instead is what used to push
     the sidebar footer — and the sign-out button in it — off the bottom of
     any page taller than the viewport. */
  height: 100%;
```

In the `body` rule, replace:

```css
  min-height: var(--app-vh);
  margin: 0;
  padding: 0;
  overflow-x: hidden;
```

with:

```css
  height: 100%;
  margin: 0;
  padding: 0;
  /* The document itself no longer scrolls in EITHER axis — .app-workspace
     owns vertical scrolling and each table wrapper owns its own horizontal
     scrolling. See the mobile re-declaration in App.css. */
  overflow: hidden;
```

In the `#root` rule, replace:

```css
  min-height: var(--app-vh);
  margin: 0;
  padding: 0;
```

with:

```css
  height: 100%;
  margin: 0;
  padding: 0;
  /* #root holds the AdminToolbar, the demo/restore/notification banners AND
     .app-shell as siblings (see AuthGate.tsx:713-724 and App.tsx:267-395).
     A flex column lets the chrome keep its intrinsic height while the shell
     takes exactly the remainder — `height: 100%` on .app-shell alone would
     make it a full viewport TALL PLUS the toolbar. */
  display: flex;
  flex-direction: column;
  overflow: hidden;
```

- [ ] **Step 2: Bound `.app-shell`**

`src/App.css:5-35`. Replace:

```css
  width: 100%;
  min-width: 100%;
  max-width: none;
  min-height: calc(var(--app-vh) - var(--topbar-height));

  display: grid;
  grid-template-columns: minmax(0, 1fr) var(--sidebar-width);
```

with:

```css
  width: 100%;
  min-width: 100%;
  max-width: none;
  /* Takes the remainder of #root's flex column (below the toolbar and any
     banners) rather than a hard-coded `--app-vh` minus a guessed chrome
     height — the banner stack's height is variable. `min-height: 0` lets it
     actually shrink to that remainder. */
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;

  display: grid;
  grid-template-columns: minmax(0, 1fr) var(--sidebar-width);
  /* Without an explicit row track the single implicit row is `auto`, which
     sizes to content and overflows a bounded container. */
  grid-template-rows: minmax(0, 1fr);
```

- [ ] **Step 3: Make `.app-workspace` the scrollport**

`src/App.css:41-53`. Replace:

```css
  width: 100%;
  min-width: 0;
  min-height: calc(var(--app-vh) - var(--topbar-height));

  direction: rtl;
```

with:

```css
  width: 100%;
  min-width: 0;
  /* A grid item defaults to `min-height: auto` and refuses to shrink below
     its content, which would make `overflow-y` below never engage. This is
     the line that makes the whole bounded-shell model work. */
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;

  direction: rtl;
```

Note `min-height` is **removed**, not lowered — the grid row now supplies the height.

- [ ] **Step 4: Bound `.sidebar` so its existing `overflow-y: auto` finally clips**

`src/components/Sidebar/Sidebar.css:33-54`. Replace:

```css
  width: 296px;
  min-height: calc(var(--app-vh) - var(--topbar-height, 56px));

  display: flex;
  flex-direction: column;
```

with:

```css
  width: 296px;
  /* Grid item, same `min-height: auto` trap as .app-workspace. Bounded here
     is what finally makes `.sidebar-nav { flex: 1; overflow-y: auto }`
     (below) clip instead of grow — and therefore what keeps .sidebar-footer,
     with the sign-out button, pinned to the bottom of the rail at all times. */
  min-height: 0;
  overflow: hidden;

  display: flex;
  flex-direction: column;
```

`.sidebar-nav` (`:211-220`) and `.sidebar-footer` (`:499-508`) are **not edited** — they already express the right intent and only ever needed a bounded ancestor.

> Pre-existing discrepancy, deliberately left alone: `.sidebar` is `296px` while the grid track is `var(--sidebar-width)` = `280px`. Do not "fix" this in the same change — it is unrelated, visible, and would confound Task 6's screenshot diff. Flag it as a follow-up.

- [ ] **Step 5: Re-declare the mobile block so nothing is stranded (R12)**

`src/App.css:191-247`. The mobile block already switches `.app-shell` to `display: block`. Under the new model it must also opt back out of the desktop bounds. Replace:

```css
  .app-shell,
  .app-shell.sidebar-collapsed {
    display: block;
    min-height: calc(var(--app-vh) - var(--topbar-height));
  }

  .app-workspace {
    min-height: calc(100dvh - var(--topbar-height));
    padding: 12px 12px 22px;
  }
```

with:

```css
  .app-shell,
  .app-shell.sidebar-collapsed {
    display: block;
    /* Mobile keeps the shell as ONE block: the sidebar is a fixed-position
       drawer here (Sidebar.css:592-611), not a grid column, so there is no
       second column to keep level with and no reason to bound the shell. */
    flex: 1 1 auto;
    min-height: 0;
    overflow: hidden;
  }

  .app-workspace {
    /* Still the scrollport on mobile — the desktop rule's overflow-y is
       inherited, only the height source changes. `height: 100%` (of the
       block-level .app-shell, which is itself the flex remainder) rather
       than a dvh calc: the banner stack above is variable-height. */
    height: 100%;
    padding: 12px 12px 22px;
  }
```

**Known accepted regression:** with `body { overflow: hidden }`, mobile browsers no longer collapse the URL bar on scroll, because that behaviour is driven by *document* scroll. This app targets Chromium desktop (File System Access API, `CLAUDE.md` "Build & dependency gotchas"), mobile is a courtesy layout, and the trade buys a sign-out button that is always reachable. Record this in the edit-log entry rather than discovering it later.

- [ ] **Step 5b: Add the `@media print` escape (R17) — do not skip, this one prints a blank/one-page document**

Report Designer's print path (`.../ReportDesigner/ReportDesigner.css:848-869`) hides everything except `.rd-print-overlay` and then **un-fixes** it:

```css
  .rd-print-overlay {
    position: static !important;
    z-index: auto !important;
  }
```

A `position: static` element inside `html`/`body` at `height: 100%; overflow: hidden` is clipped to a single screen, so a multi-page design would print page 1 and nothing else. Printing needs the document to be free-flowing again. Add to `src/index.css`, at the end of the file:

```css
/* ── Print ─────────────────────────────────────────────────────
   The bounded shell above (html/body at `height: 100%; overflow:
   hidden`, with .app-workspace owning the scrolling) is a SCREEN
   layout. Print has no viewport to bound to and paginates a
   free-flowing document instead, so the bounds are released here.

   Concretely: ReportDesigner's print path
   (ReportDesigner.css:848-869) hides every body child except
   .rd-print-overlay and sets it back to `position: static`. Under a
   clipped html/body that static overlay would be cut off at one
   screen and only its first .rd-print-page would ever reach the
   printer. */
@media print {
  html,
  body,
  #root {
    height: auto;
    overflow: visible;
  }

  .app-shell {
    overflow: visible;
  }

  .app-workspace {
    overflow: visible;
  }
}
```

- [ ] **Step 6: Confirm no raw viewport units were introduced**

```bash
npx vitest run src/data/preferences/uiScaleCss.contract.test.ts
```

Expected: PASS. This is the guard that fails on a `100vh` reflex; run it before the full suite so a failure is unambiguous. Note it matches only `\b100v[hw]\b` — the existing `100dvh` uses (R24) slip past it and are **not** in scope here.

- [ ] **Step 7: Full unit gates**

```bash
npm run test:run && npm run typecheck && npm run lint
```

Expected: green. Component tests render into jsdom, which **has no layout engine**, so this proves nothing about the fix — it only proves nothing else broke. Task 6 is the real verification.

- [ ] **Step 8: Update the e2e assertion that the bounded shell invalidates (R18)**

This repo has an 18-spec Playwright suite (`e2e/`, `npm run e2e`) that `CLAUDE.md` does not list. `e2e/ui-scale.spec.ts:47-62` asserts:

```ts
    expect(metrics.shell).toBeGreaterThanOrEqual(metrics.viewport - 2);
```

where `metrics.shell` is `.app-shell`'s bounding height. That passes today only because the shell grows past the viewport with its content. Under a bounded shell `.app-shell` is exactly `viewport − toolbar − banners` and the assertion fails. Change the metric to measure the **whole chrome column** instead, which is what the test's intent ("the shell fills the viewport — no dead band from `vh`") actually means. Replace:

```ts
    const metrics = await page.evaluate(() => ({
      shell: document.querySelector(".app-shell")!.getBoundingClientRect().height,
      viewport: window.innerHeight,
      docScrollWidth: document.documentElement.scrollWidth,
      docClientWidth: document.documentElement.clientWidth,
    }));
```

with:

```ts
    const metrics = await page.evaluate(() => {
      // The shell no longer fills the viewport on its own — it is the flex
      // remainder below the AdminToolbar and any banners (see
      // src/index.css `#root`). What must still hold is that #root's
      // column, toolbar included, leaves no dead band.
      const shell = document.querySelector(".app-shell")!.getBoundingClientRect();
      const root = document.getElementById("root")!.getBoundingClientRect();
      return {
        shell: shell.height,
        shellBottom: shell.bottom,
        root: root.height,
        viewport: window.innerHeight,
        docScrollWidth: document.documentElement.scrollWidth,
        docClientWidth: document.documentElement.clientWidth,
      };
    });
```

and replace the assertion with:

```ts
    expect(metrics.root).toBeGreaterThanOrEqual(metrics.viewport - 2);
    // And the shell reaches the bottom edge — a dead band would show up here
    // even when #root itself measures full height.
    expect(metrics.shellBottom).toBeGreaterThanOrEqual(metrics.viewport - 2);
```

Apply the same change to the second test (`"scaled down, the shell STILL fills the viewport"`, `:64-80`), which repeats the metric at `zoom: 0.7`. **Do not weaken these assertions to make them pass** — the regression they pin (a raw `100vh` leaving a third of the screen blank under scale) is real and this plan must not un-pin it.

- [ ] **Step 9: Run the e2e suite**

```bash
npm run e2e
```

Expected: green. Watch `ui-scale.spec.ts`, `table-columns.spec.ts` (popover self-scroll — should be unaffected, it scrolls the popover, not the page), `subtab-navigation.spec.ts`, `population-browse.spec.ts` and `employee-queue.spec.ts` in particular. **Any spec that drives the page by scrolling needs re-reading, not just re-running** — Playwright's auto-scroll-into-view will silently retarget to the new scrollport and may mask a real problem.

---

### Task 3: Migrate per-tab scroll memory off `window` (R1)

**Files:**
- Modify: `src/App.tsx` (`AppContent`, lines 225-237 and the `<section className="app-workspace">` at :337-342)
- Test: `src/App.test.tsx` if it exists; otherwise no new test file — see Step 3.

**Interfaces:**
- Consumes: nothing new.
- Produces: a `useRef<HTMLElement | null>` on `.app-workspace`, replacing the two `window` scroll calls. No exported surface changes.

- [ ] **Step 1: Add the ref and retarget the effect**

`src/App.tsx:225-237`. Replace:

```tsx
  const activeTabId = activeTab?.id ?? "";
  const tabScrollPositions = useRef(new Map<string, number>());

  useEffect(() => {
    if (!activeTabId) return;
    const scrollPositions = tabScrollPositions.current;
    const animationFrame = window.requestAnimationFrame(() => {
      window.scrollTo({ top: scrollPositions.get(activeTabId) ?? 0 });
    });
    return () => {
      window.cancelAnimationFrame(animationFrame);
      scrollPositions.set(activeTabId, window.scrollY);
    };
  }, [activeTabId]);
```

with:

```tsx
  const activeTabId = activeTab?.id ?? "";
  const tabScrollPositions = useRef(new Map<string, number>());
  // The document no longer scrolls (see App.css `.app-shell` / `.app-workspace`
  // and the `body { overflow: hidden }` in index.css). `window.scrollY` is
  // therefore permanently 0 and `window.scrollTo` a no-op, so per-tab scroll
  // memory has to read and write the real scrollport instead.
  const workspaceRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!activeTabId) return;
    const scrollPositions = tabScrollPositions.current;
    const animationFrame = window.requestAnimationFrame(() => {
      const workspace = workspaceRef.current;
      if (workspace) workspace.scrollTop = scrollPositions.get(activeTabId) ?? 0;
    });
    return () => {
      window.cancelAnimationFrame(animationFrame);
      scrollPositions.set(activeTabId, workspaceRef.current?.scrollTop ?? 0);
    };
  }, [activeTabId]);
```

- [ ] **Step 2: Attach the ref**

`src/App.tsx:337-342`. Replace:

```tsx
      <section
        className="app-workspace"
        aria-label={labels.app_workspace_aria}
```

with:

```tsx
      <section
        ref={workspaceRef}
        className="app-workspace"
        aria-label={labels.app_workspace_aria}
```

- [ ] **Step 3: Test coverage decision**

jsdom does not lay out, so `scrollTop` is always `0` there and a jsdom test can only assert that the *assignment happened*, not that scrolling works. Write that narrow test only if `src/App.test.tsx` already exists and mounts `AppContent`; otherwise skip it and rely on Task 6's browser check ("switch tabs after scrolling; the previous tab returns to where it was"). Do **not** invent a full `AppContent` mount harness for this — its dependency surface (workspace, auth, permissions, global month, notifications, boot progress) makes that disproportionate, and the precedent in this repo (`tabMountLru.test.ts` covering `App.tsx`'s mount LRU by pure-function test only) is the same call.

- [ ] **Step 4: Gates**

```bash
npm run test:run && npm run typecheck && npm run lint
```

---

### Task 4: Move the modal scroll lock to the scrollport (R2, R3, R4)

**Files:**
- Modify: `src/components/ModalPortal/ModalPortal.tsx`
- Modify: `src/components/ModalShell/ModalShell.test.tsx` (the two assertions at :113 and :115)
- Modify: `src/App.tsx` (the mobile-drawer lock at :254-261)

**Interfaces:**
- Consumes: nothing new. The lock resolves its target by `document.querySelector(".app-workspace")` rather than taking a prop — `ModalPortal` is used from many call sites and threading a ref through all of them is a far larger change for no benefit.
- Produces: `ModalPortal`'s externally visible contract is unchanged (portal to `document.body`, ref-counted lock, no focus-trap ownership); only *which element* the lock is applied to changes.

- [ ] **Step 1: Write the failing test**

In `src/components/ModalShell/ModalShell.test.tsx`, the existing assertions read:

```ts
    expect(document.body.style.overflow).toBe("hidden");
```
```ts
    expect(document.body.style.overflow).toBe("");
```

Replace them with assertions against a stand-in scrollport that the test renders. Add, in the same test, an element the lock can find before rendering the modal:

```ts
    const workspace = document.createElement("section");
    workspace.className = "app-workspace";
    document.body.appendChild(workspace);
```

then assert `workspace.style.overflow` transitions `"hidden"` → `""` across open/close, and add one assertion that the body is **not** touched:

```ts
    expect(document.body.style.overflow).toBe("");
```

- [ ] **Step 2: Run to confirm it fails**

```bash
npx vitest run src/components/ModalShell/ModalShell.test.tsx
```

Expected: FAIL — the lock still targets `document.body`.

- [ ] **Step 3: Retarget the lock**

`src/components/ModalPortal/ModalPortal.tsx:4-21`. Replace:

```ts
let lockCount = 0;
let previousBodyOverflow: string | null = null;

function acquireScrollLock(): void {
  if (lockCount === 0) {
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  lockCount += 1;
}

function releaseScrollLock(): void {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0) {
    document.body.style.overflow = previousBodyOverflow ?? "";
    previousBodyOverflow = null;
  }
}
```

with:

```ts
let lockCount = 0;
let lockedElement: HTMLElement | null = null;
let previousOverflow: string | null = null;

/**
 * The app's scrollport. `document.body` no longer scrolls — `.app-workspace`
 * does (see `src/App.css`) — so locking the body would silently stop locking
 * anything and the page behind an open modal would keep scrolling. Falls back
 * to the body for the pre-login screens (AuthGate / WorkspacePicker), which
 * render before `.app-workspace` exists.
 */
function scrollportElement(): HTMLElement {
  return document.querySelector<HTMLElement>(".app-workspace") ?? document.body;
}

function acquireScrollLock(): void {
  if (lockCount === 0) {
    lockedElement = scrollportElement();
    previousOverflow = lockedElement.style.overflow;
    lockedElement.style.overflow = "hidden";
  }
  lockCount += 1;
}

function releaseScrollLock(): void {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0 && lockedElement) {
    // Restore against the element that was actually locked, not a fresh
    // lookup: a tab switch between acquire and release could resolve a
    // different node and leave the original stuck at `overflow: hidden`.
    lockedElement.style.overflow = previousOverflow ?? "";
    lockedElement = null;
    previousOverflow = null;
  }
}
```

Also update the module doc's closing paragraph (`:42-45`) — it currently says the lock is "on `document.body`".

- [ ] **Step 4: Apply the same reasoning to the mobile-drawer lock**

`src/App.tsx:254-261`. Replace:

```tsx
  useEffect(() => {
    if (!isMobileSidebarOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isMobileSidebarOpen]);
```

with:

```tsx
  useEffect(() => {
    if (!isMobileSidebarOpen) return;
    // Same reason as ModalPortal's lock: the body no longer scrolls, so
    // locking it would be a no-op and the page would scroll behind the open
    // drawer. workspaceRef is the scrollport (see the per-tab scroll effect).
    const workspace = workspaceRef.current;
    if (!workspace) return;
    const previousOverflow = workspace.style.overflow;
    workspace.style.overflow = "hidden";
    return () => {
      workspace.style.overflow = previousOverflow;
    };
  }, [isMobileSidebarOpen]);
```

This depends on Task 3's `workspaceRef`. If Task 4 is executed before Task 3, do Task 3 Steps 1–2 first.

- [ ] **Step 5: Run the test to verify it passes, then full gates**

```bash
npx vitest run src/components/ModalShell/ModalShell.test.tsx
npm run test:run && npm run typecheck && npm run lint
```

Expected: green, including every other `ModalPortal` consumer's tests (`ConfirmDialog`, the column picker, the report customizer). Grep `ModalPortal` before running so you know which suites to watch.

---

### Task 5: Remove the page-level height guesses that fight the new scrollport (R9)

**Files:**
- Modify: `src/components/Sidebar/Tabs/Population/Population.css:78-87`
- Modify: `src/components/Sidebar/Tabs/UserManagement/UserManagement.css:3-15`
- Modify: `src/App.css:65-71` (`.tab-blank`) and `src/App.css:171-178` (`.app-no-tabs`)

**Interfaces:** none — pure CSS deletion.

**Why:** each of these floors a page at `calc(var(--app-vh) - 44px)`, where `44px` is a stale guess at chrome height (`--topbar-height` is `56px`) and `.app-workspace` additionally contributes `var(--sp-5) var(--sp-6) var(--sp-8)` of padding. Inside a bounded scrollport that arithmetic guarantees a small permanent overflow — a scrollbar on an otherwise empty page that cannot be scrolled away. The bounded shell now supplies full height for free, so the floor is not merely wrong, it is redundant.

- [ ] **Step 1: `.population-page`** — delete the line `min-height: calc(var(--app-vh) - 44px);` (`Population.css:80`). Leave `width`, `max-width`, `margin`, `padding`, `direction`, `background`, `color` untouched.

- [ ] **Step 2: `.um-page`** — delete `min-height: calc(var(--app-vh) - 44px);` (`UserManagement.css:6`).

- [ ] **Step 3: `.tab-blank`** — `App.css:65-71`. Replace `min-height: calc(var(--app-vh) - var(--topbar-height));` with `min-height: 100%;`. It is now a direct child of the bounded scrollport, so a percentage is both correct and immune to the chrome-height guess.

- [ ] **Step 4: `.app-no-tabs`** — `App.css:171-178`. Replace `min-height: calc(var(--app-vh) - 44px);` with `min-height: 100%;` for the same reason. It uses `display: grid; place-items: center`, so the percentage is what actually centres it.

- [ ] **Step 5: Confirm nothing else floors on a chrome guess**

```bash
grep -rn "app-vh" src/ --include=*.css
```

Every remaining hit should be a `max-height` (a ceiling, still correct) or one of the pre-login roots (`AuthGate.css:44,640`, `WorkspaceGate.css:8`) which render **outside** `.app-shell` and legitimately want a viewport height. `BootSplashOverlay.css:33` (`grid-template-rows: min(100%, calc(var(--app-vh) - var(--topbar-height, 56px)))`) already clamps to `100%` first and is therefore safe — **verify this one visually in Task 6**, given the boot-splash area's documented five-round regression history.

- [ ] **Step 6: Gates**

```bash
npx vitest run src/data/preferences/uiScaleCss.contract.test.ts
npm run test:run && npm run typecheck && npm run lint
```

---

### Task 6: Real-browser verification — mandatory, blocking

**Files:** none. This task produces screenshots and a filled-in risk register.

Per `CLAUDE.md`: *"Don't report a change as working on the strength of reading the code — this repo has a documented history of effect-timing and state-machine bugs surviving self-review, including after real-browser confirmation."* Layout is in the same category: `vitest` runs jsdom, which has **no layout engine at all**, so a fully green suite says nothing about whether anything scrolls. The boot-splash saga (v59.190–v59.197, five consecutive rounds each caught by review) is the precedent for treating this area as review-gated rather than self-verified.

- [ ] **Step 1: Launch**

```bash
npm run build   # catches what vitest cannot — see CLAUDE.md
npm run dev     # http://localhost:5173, Chrome or Edge only
```

Attach a real workspace with at least one processed month. A demo workspace does not produce content taller than the viewport on most pages and will pass a broken build.

- [ ] **Step 2: Screenshot matrix**

For **every** tab and sub-tab below, capture **two** states: (a) content that fits within the viewport, (b) content taller than the viewport (choose a month/filter that produces many rows, or collapse the browser window vertically to force it).

| Tab | Sub-tabs to cover |
|---|---|
| `population` | `process` (all four phases), `browse`, `adhoc-import` |
| `employee-workspace` | `ew/xray-referrals`, `ew/xray-results`, `ew/referral-approval`, `ew/inspection-form` |
| `ew/notifications` | — |
| `reports` | `reports`, `kpi`, `report-designer` |
| `archive` | — |
| `user-management` | `users`, `page-permissions`, `feature-permissions`, `activity`, `actions` |
| `settings` | — |

For each, confirm:
1. **The sign-out button in the sidebar footer is visible without any scrolling.** This is the acceptance criterion for the whole group.
2. `.sidebar-nav` scrolls on its own when the nav list is long (collapse the window to ~600px tall to force it) and the footer stays pinned.
3. `.app-workspace` scrolls independently; the AdminToolbar never moves.
4. There is exactly **one** vertical scrollbar in the shell (plus per-table scrollbars where `DataTable` declares them) — **no double scrollbar on an otherwise short page** (R9).

- [ ] **Step 3: Walk the risk register**

One line of evidence per row R1–R13:

- **R1** — scroll Population down, switch to Reports, switch back: the page returns to where it was.
- **R2** — open a `ConfirmDialog` or the DataTable column picker on a long page and try to scroll: the content behind must not move. Close it: scrolling must resume.
- **R4** — at ≤767px, open the mobile drawer on a long page: the page behind must not scroll.
- **R5** — the AdminToolbar stays put and stays clickable at every scroll position.
- **R6/R7** — on `ew/xray-referrals` with a long queue, scroll: the inspection panel stays level and, specifically, **does not slide under the toolbar** (the pre-existing bug this change is expected to fix). Open and close a sample: the page must not jump height.
- **R8** — at 1280×800 and 1920×1080, a long `DataTable` must not leave a dead band under it, and its sticky header must stay stuck.
- **R10** — the hairline above `.app-workspace` must not be double-drawn or visible over the toolbar.
- **R11** — open the month selector and the column picker, then scroll: each popover must follow its anchor.
- **R12** — at 375×812 and 768×1024, everything reachable, drawer opens and closes, nothing stranded.
- **R13** — switch tabs and open a modal within ~400 ms (while `view-enter` is still animating): the backdrop must cover the whole viewport, not just the tab box.
- **R14** — Population Phase 3/4 with a long page: `.pop-action-bar` must stay pinned to the bottom of the workspace and must not disappear or float mid-page.
- **R15** — `.pop-subtab-bar` and `.ew-bulk-bar` must pin to the top of the scrollport, below the toolbar, not under it.
- **R16** — `.kpi-port-detail`, `.ew-approval-detail`, `.ntf-detail`: long list beside each; the pane stays level.
- **R17 (print)** — Report Designer → open a **multi-page** design → Print. The print preview must show **every page**, not just page 1. This is the one check that cannot be done by looking at the screen.
- **R20** — the feedback FAB and its panel, the login/first-run dialogs: all still viewport-anchored.
- **R21** — drag a field to the far edge of the Report Designer canvas: the drop dialog must stay on screen.
- **R23** — re-read `BootSplashOverlay.css:27-33`'s comment against the new reality and correct it if it is now wrong.
- **BootSplash** — log out and back in: the checklist overlay must cover the tab-content area only, size correctly, and disappear when sources finish.
- **DataTable virtualization** — scroll a 10k-row `browse` table to the very bottom and back. ~25 test files stub `ResizeObserver` as a no-op, so **jsdom cannot catch a virtualization regression** — this manual pass is the only coverage.

- [ ] **Step 4: UI-scale sweep**

Set the UI scale control to its minimum and maximum (Settings tab) and re-check the sidebar footer and the workspace scrollbar at each. `--app-vh` is `calc(100vh / var(--ui-scale))`; the whole point of Task 2's `height: 100%` chain is that it does not depend on that arithmetic being right, so a discrepancy here means a `%`-vs-`vh` mixup somewhere.

- [ ] **Step 5: Get it reviewed**

Do not self-certify this group. Hand the screenshots and the completed register to a reviewer, per the boot-splash precedent.

- [ ] **Step 6: Tier-3 gate sweep, edit log, commit**

```bash
npm run test:run && npm run typecheck && npm run lint
npm run check:complexity && npm run check:hex-literals && npm run check:vendor
npm run build && npm run check:bundle-size
npm run e2e
npm run editlog -- --tier=3 --append --sync-package "Refactor (app-shell): bound the shell height so the sidebar and sign-out stay on screen"
npm run check:release
```

Write the entry (Why / What changed / Before-After per file / the accepted mobile URL-bar regression / the completed risk register / migration + rollback: rollback is a straight revert of the CSS blocks plus the `.tsx` scroll-target changes and the e2e assertion — there is no data or schema component). Then:

```bash
git add src/index.css src/App.css src/App.tsx \
        src/components/Sidebar/Sidebar.css \
        src/components/Sidebar/BootSplashOverlay.css \
        src/components/ModalPortal/ModalPortal.tsx \
        src/components/ModalShell/ModalShell.test.tsx \
        src/components/Sidebar/Tabs/Population/Population.css \
        src/components/Sidebar/Tabs/UserManagement/UserManagement.css \
        e2e/ui-scale.spec.ts \
        "docs/edit logs/2026-08-24.md" package.json
git commit -m "Refactor (app-shell): bound the shell height so the sidebar and sign-out stay on screen" -- <same files>
```

(`BootSplashOverlay.css` only if R23's comment needed correcting.)

---

# GROUP 2 — Shared `.page-shell` primitive

## Root cause (confirmed)

**Four** page roots each define a width scheme from scratch; no shared primitive exists.

| Selector | File:line | `max-width` | `padding` |
|---|---|---|---|
| `.population-page` | `Population.css:78-87` | `1440px` | `28px /* no-scale */` |
| `.ew-page` | `EmployeeWorkspace.css:7-15` | `1600px` | `clamp(14px, 2.2vw, 32px) clamp(12px, 2vw, 28px) /* no-scale */` |
| `.rh-page` | `Reports.css:5-13` | **`1040px`** | `28px 28px 48px /* no-scale */` |
| `.um-page` | `UserManagement.css:3-15` | `1440px` | `28px /* no-scale */` |

Reports is **560px narrower** than EmployeeWorkspace for no principled reason, and the evidence that this is an accident rather than a design choice is inside Reports itself: `.kpi-dash` (`KpiDashboard.css:9-15`) declares `max-width: 1180px; margin: 0 auto` — a width it **can never reach**, because its parent `.rh-page` caps it at `1040px − 56px` of padding = `984px`. The KPI dashboard has been rendering ~200px narrower than it was designed for since it was written.

## On `/* no-scale */` — is this overriding a deliberate choice?

**No. It is finishing an unfinished mechanical sweep.** Traced to `docs/audit/hardening-2026-07-08/03-approved-plan.md:55-56`, which set the B6 rule:

> *"Snap off-scale values to the nearest step **only when the visual delta is ≤2px**; otherwise keep the literal with a `/* no-scale */` comment."*

`28px` sits 4px from `--sp-6` (24px) and 4px from `--sp-8` (32px) — over the threshold in both directions — so the four B6 sweeps (`0179cc0c`, `e77d414a`, `aedbb8b0`, `7a7f5016`, all 2026-07-08) left it literal and annotated. **`/* no-scale */` records a zero-visual-drift constraint on an automated pass, not a judgement that page padding should sit off the scale.** Nothing enforces it: it appears in no script under `scripts/`, no test, and no lint rule — it is a comment only.

Group 2 is a deliberate design change whose entire purpose is to alter these values, so the zero-drift constraint that produced the annotation no longer applies. Record this reasoning in the edit-log entry so the next reader does not have to re-derive it.

## Width choice: 1600px

Picking the widest of the existing values rather than inventing one:

- It is **already in production** on `.ew-page`, the most table-dense page in the app — so it is a validated width, not a guess.
- `1440px` would *narrow* EmployeeWorkspace, a regression.
- Going wider than 1600px would exceed what any page was designed for and would make the `repeat(auto-fit, minmax(…, 1fr))` grids in `KpiDashboard.css` (`:147`, `:545`) sprawl to column counts nobody has ever seen.
- **KPI is protected by its own cap.** `.kpi-dash`'s `max-width: 1180px` self-limits, so widening `.rh-page` moves KPI from 984px to exactly its designed 1180px and no further. This is the strongest argument for the change and the reason it cannot run away.

The pages that actually gain full width are the Reports hub list (`.rh-grid`, `Reports.css:219`, a `repeat(3, 1fr)` that is currently cramped) and Report Designer.

---

### Task 7: Add the `.page-shell` primitive

**Files:**
- Modify: `src/styles/primitives.css`

**Interfaces:**
- Consumes: `--sp-3` (12px), `--sp-8` (32px), `--sp-12` (48px) from `src/index.css:128-130`.
- Produces: `.page-shell` — one class, applied by the four page roots in Task 8. No JS surface.

- [ ] **Step 1: Append the primitive**

Add to `src/styles/primitives.css`, after the `.ui-toolbar` block (`:356-374`) and before `── State views`:

```css
/* ── Page shell ────────────────────────────────────────────────
   The single width + gutter contract for a top-level tab's root
   element. Four pages used to hand-roll this with three different
   max-widths (1040 / 1440 / 1600) and three different paddings; the
   1040px one silently capped KpiDashboard's own `max-width: 1180px`
   at 984px for its entire life.

   1600px is chosen because it was already the widest value in
   production (.ew-page, the most table-dense page) — a validated
   width rather than a new guess. Anything narrower regresses
   EmployeeWorkspace; anything wider exceeds what the auto-fit grids
   in KpiDashboard were designed for. Sub-layouts that want to stay
   narrower keep their own max-width and still work (KpiDashboard
   self-caps at 1180px).

   The padding is fluid so the small-viewport behaviour .ew-page
   already had survives, but every stop is a --sp-* token: the raw
   28px these pages carried was an artefact of B6's "only snap when
   the delta is <=2px" rule, not a design decision (see
   docs/audit/hardening-2026-07-08/03-approved-plan.md). Bottom
   gutter is deliberately larger so the last card never sits flush
   against the scrollport's edge. */
.page-shell {
  width: 100%;
  max-width: 1600px;
  margin-inline: auto;
  padding-block-start: clamp(var(--sp-3), 2.2vw, var(--sp-8));
  padding-block-end: var(--sp-12);
  padding-inline: clamp(var(--sp-3), 2vw, var(--sp-8));
}
```

Note `margin-inline: auto`, not `margin: 0 auto` — logical properties, per this file's header ("RTL-safe (logical props)"), and it leaves block margins to the consumer.

- [ ] **Step 2: Confirm the guards**

```bash
npx vitest run src/data/preferences/uiScaleCss.contract.test.ts
npm run check:hex-literals
```

Expected: PASS. `2.2vw` / `2vw` are **not** `100vw` and do not trip the contract test's `\b100v[hw]\b` pattern (`uiScaleCss.contract.test.ts:96`) — and they should not be "corrected" to `--app-vw`, since a *fraction* of the viewport is exactly what a fluid gutter wants and the zoom correction does not apply to width (see the `--app-vh` rationale at `index.css:227-234`).

---

### Task 8: Migrate the four page roots

**Files:**
- Modify: `src/components/Sidebar/Tabs/Population/Population.css:78-87` and `.../Population/index.tsx` (the `.population-page` element)
- Modify: `src/components/Sidebar/Tabs/EmployeeWorkspace/EmployeeWorkspace.css:7-15` and the `.ew-page` elements
- Modify: `src/components/Sidebar/Tabs/Reports/Reports.css:5-13` and `.../Reports/TabView.tsx:764,833`
- Modify: `src/components/Sidebar/Tabs/UserManagement/UserManagement.css:3-15` and the `.um-page` element

**Interfaces:** each page keeps its own class for its non-width concerns (`direction`, `font-family`, `color`, `background`, and `.um-page`'s `display: flex`); `.page-shell` is **added alongside**, not replacing. This keeps every existing descendant selector (`.rh-page .rh-header`, `.ew-page .page-header-actions:has(…)`, `.population-page *`) working untouched.

- [ ] **Step 1: Find every element that carries one of the four classes**

```bash
grep -rn "population-page\|ew-page\|rh-page\|um-page" src/ --include=*.tsx
```

Known: `Reports/TabView.tsx:764` and `:833` render `.rh-page` twice (an early-return empty state and the main body) — **both** need the class. `Reports/index.test.tsx:1019` queries `.rh-page`; adding a second class does not break `document.querySelector(".rh-page")`, but confirm.

- [ ] **Step 2: Add `page-shell` to each element's `className`**

For example, `Reports/TabView.tsx:833`:

```tsx
    <section className="rh-page" dir="rtl" ref={rootRef}>
```

becomes:

```tsx
    <section className="page-shell rh-page" dir="rtl" ref={rootRef}>
```

Apply the same edit at `TabView.tsx:764` and to the `.population-page`, `.ew-page` and `.um-page` elements found in Step 1. Put `page-shell` **first** so the page's own class wins any tie at equal specificity.

- [ ] **Step 3: Strip the width/padding declarations from the four page rules**

`Population.css:78-87` — replace:

```css
.population-page {
  width: 100%;
  max-width: 1440px;
  margin: 0 auto;
  padding: 28px /* no-scale */;
  direction: rtl;
  background: var(--p-bg);
  color: var(--p-text);
}
```

with:

```css
/* Width + gutters come from .page-shell (src/styles/primitives.css). */
.population-page {
  direction: rtl;
  background: var(--p-bg);
  color: var(--p-text);
}
```

(If Group 1 Task 5 has already landed, `min-height` is gone; if this group lands first, delete it here and note it in Group 1's Step 1 as already done.)

`EmployeeWorkspace.css:7-15` — replace the rule body with:

```css
/* Width + gutters come from .page-shell (src/styles/primitives.css) —
   including the fluid padding this page originally introduced. */
.ew-page {
  direction: rtl;
  font-family: var(--font-sans);
  color: var(--c-ink);
}
```

`Reports.css:5-13` — replace with:

```css
/* Width + gutters come from .page-shell (src/styles/primitives.css).
   This page's old 1040px cap is what held KpiDashboard's own
   `max-width: 1180px` down to 984px. */
.rh-page {
  direction: rtl;
  font-family: var(--font-sans);
  color: var(--c-ink);
}
```

`UserManagement.css:3-15` — replace with:

```css
/* Width + gutters come from .page-shell (src/styles/primitives.css). */
.um-page {
  direction: rtl;
  color: var(--app-text);
  display: flex;
  flex-direction: column;
  gap: var(--sp-5);
  font-family: var(--font-sans);
}
```

- [ ] **Step 4: Check for descendant rules that assumed the old width**

```bash
grep -rn "max-width" src/components/Sidebar/Tabs/Reports/ src/components/Sidebar/Tabs/Population/ \
                     src/components/Sidebar/Tabs/EmployeeWorkspace/ src/components/Sidebar/Tabs/UserManagement/ \
                     --include=*.css
```

For each hit, decide: does this sub-layout *want* to stay narrow (keep it — `.kpi-dash`'s 1180px, `.kpi-chart-matrix`'s 880px, `.kpi-chart-calendar`'s 540px are all deliberate reading-width caps) or was it a workaround for the page being narrow (remove it)? **Default to keeping.** Removing a nested cap is a second, separate design decision and is out of scope here.

Pay particular attention to `Reports.css:182-228` and `:620` — media queries at `max-width: 1100px` / `860px` / `760px` / `560px` that were tuned against a 1040px page. They fire on the **viewport**, not the page, so they are unaffected by this change; confirm rather than assume.

- [ ] **Step 5: Gates**

```bash
npx vitest run src/components/Sidebar/Tabs/Reports/index.test.tsx
npm run test:run && npm run typecheck && npm run lint
```

---

### Task 9: Browser verification and landing for Group 2

- [ ] **Step 1: Screenshot every migrated page at three widths**

`npm run dev`, then at viewport widths **1280**, **1600** and **1920** capture:

| Page | What to check |
|---|---|
| Population `process` | 1440 → 1600 widening does not break the Phase 3/4 `300px minmax(0,1fr)` rows or the phase tables |
| Population `browse` | the DataTable gains width and does not overflow horizontally |
| EmployeeWorkspace (all 4 sub-tabs) | **unchanged** — this page was already 1600px; the fluid padding must look identical to before. Any visible difference here is a bug in the `clamp()` translation |
| Reports `reports` | `.rh-grid`'s `repeat(3, 1fr)` cards get wider; header and toast still align |
| Reports `kpi` | `.kpi-dash` now renders at exactly **1180px**, centred, with visible gutters either side — *not* stretched to 1600 |
| Reports `report-designer` | canvas area gains width; the customizer modal (`Reports.css:629`, `max-width: 1400px`) is unaffected |
| UserManagement (all 5 sub-tabs) | 1440 → 1600 widening; the tables and the activity grid |

- [ ] **Step 2: Diff against pre-change screenshots**

The only page expected to look *identical* is EmployeeWorkspace. Every other page should be visibly wider with the same rhythm. A page that changed in a way you cannot explain is a finding, not a rounding error.

- [ ] **Step 3: Tier-3 gates, edit log, commit**

```bash
npm run test:run && npm run typecheck && npm run lint
npm run check:complexity && npm run check:hex-literals && npm run check:vendor
npm run build && npm run check:bundle-size
npm run e2e
npm run editlog -- --tier=3 --append --sync-package "Refactor (css): one shared .page-shell primitive replaces four hand-rolled page widths"
npm run check:release
```

`e2e/ui-scale.spec.ts:38-45`'s `horizontalOverflow()` helper measures `.dt-table-wrap`'s `scrollWidth - clientWidth`, and its third test asserts that scaling down gives the queue *measurably more* horizontal room. Widening `.ew-page`'s consumers does not affect that page (it was already 1600px), but re-read the assertion before assuming.

The entry must state the `/* no-scale */` finding (a B6 mechanical-sweep artefact, not a design decision — cite `docs/audit/hardening-2026-07-08/03-approved-plan.md:55-56`), the 1600px justification, and the `.kpi-dash` 984 → 1180 consequence. Rollback: revert the four CSS rules and remove the `page-shell` class from the four elements; `.page-shell` itself can stay in `primitives.css` harmlessly.

```bash
git add src/styles/primitives.css \
        src/components/Sidebar/Tabs/Population/Population.css \
        src/components/Sidebar/Tabs/Population/index.tsx \
        src/components/Sidebar/Tabs/EmployeeWorkspace/EmployeeWorkspace.css \
        src/components/Sidebar/Tabs/EmployeeWorkspace/index.tsx \
        src/components/Sidebar/Tabs/Reports/Reports.css \
        src/components/Sidebar/Tabs/Reports/TabView.tsx \
        src/components/Sidebar/Tabs/UserManagement/UserManagement.css \
        src/components/Sidebar/Tabs/UserManagement/index.tsx \
        "docs/edit logs/2026-08-24.md" package.json
git commit -m "Refactor (css): one shared .page-shell primitive replaces four hand-rolled page widths" -- <same files>
```

(Adjust the `.tsx` paths to whatever Task 8 Step 1 actually found.)

---

# GROUP 3 — Card-row convention

## ⚠ The brief's premise is stale — read this before doing anything

The task brief describes `.p2-verdict-row` as *"one visible card on the left paired against a column of 2-3 visually separate stacked cards on the right"*, i.e. `.dar-root` as the row's right child. **That is no longer the code.** Verified at `src/components/Sidebar/Tabs/Population/components/PhaseTwoReportAndProcessing.tsx:374-391`:

```tsx
      <div className={`p2-verdict-row${accuracy ? "" : " no-accuracy"}`}>
        {accuracy && <AccuracyVerdictCard result={accuracy} />}
        <ProcessingVerdictCard … />
      </div>
```

The verdict row's two children are `.dar-verdict` (from `AccuracyVerdictCard`, `DataAccuracyReport.tsx:26-43`) and `.p2-result-card` (from `ProcessingVerdictCard`, `PhaseTwoReportAndProcessing.tsx:119`) — **two cards, one per grid track.** `DataAccuracyReport` renders separately and further down (`PhaseTwoReportAndProcessing.tsx:428-433`) with `verdictHoisted`, which is precisely the flag that pulls `.dar-verdict` *out* of `.dar-root` (`DataAccuracyReport.tsx:233`: `{!verdictHoisted && <AccuracyVerdictCard result={result} />}`). Someone already fixed the 1-vs-3 mismatch.

## What is actually still wrong (confirmed)

The residual "detached lego pieces" reading in this spot is **radius and elevation drift across four sibling boxes**, not a container/child mismatch:

| Box | File:line | `border-radius` | `box-shadow` |
|---|---|---|---|
| `.dar-verdict` | `DataAccuracyReport.css:59-70` | **`14px`** (raw) | `var(--sh-sm)` |
| `.p2-result-card` | `PhaseTwoReportAndProcessing.css:29-38` | **`14px`** (raw) | `var(--sh-sm)` |
| `.dar-col-table` | `DataAccuracyReport.css:148-154` | **`14px`** (raw) | `var(--sh-xs)` |
| `.dar-detail` | `DataAccuracyReport.css:306-312` | **`14px`** (raw) | `var(--sh-xs)` |

Scrolling Phase 2 top to bottom you get card / card, then card, then card — four boxes of the same kind at **two different elevations**, all at a radius (`14px`) that **matches no token**: `--r-sm: 6px`, `--r-md: 8px`, `--r-lg: 10px`, `--r-xl: 12px` (`src/index.css:120-123`). `primitives.css:48-53` states the product rule explicitly — *cards and panels 10px (`--r-lg`)*. Across `src/`, `var(--r-lg)`/`var(--r-xl)` outnumber raw `14px` roughly **62 to 15**.

The directly comparable siblings prove what "correct" looks like: `.p3-top-row` (`PhaseThreeSampling.css:16-21`) and `.p4-top-row` (`PhaseFourDistribution.css:54-59`) use the *identical* `grid-template-columns: 300px minmax(0, 1fr); gap: 18px`, and their children use `var(--r-xl)` + `var(--sh-sm)`. Phase 2 is the odd one out among its own three siblings.

## Approach: neither (a) nor (b) from the brief — match the app's existing convention

The brief offered (a) wrap the right column in one outer card, or (b) make the container the card. **Both would break the app's convention**, which a survey of every 2-up layout in the codebase establishes as roughly **8 : 4** in favour of *transparent container, each child its own card*:

- Transparent container + card children: `.p2-verdict-row`, `.p3-top-row` (`PhaseThreeSampling.css:16`), `.p4-top-row` (`PhaseFourDistribution.css:54`), `.arc-layout` (`Archive.css:45`), `.ew-ref-queue.ew-xr-grid` (`XrayReferrals.css:22`), `.kpi-level-grid` (`KpiDashboard.css:383`), `.ew-approval-split` (`EmployeeWorkspace.css:2081`), `.ntf-split` (`NotificationManager.css:364`).
- Container-is-the-card: `.kpi-progress-grid` (`KpiDashboard.css:319`), `.kpi-ports-grid` (`:649`), `.um-activity-card dl` (`UserManagement.css:1036`), `.bv-stage-donut-row` (`Population.css:2761`) — **all four are *inner* splits nested inside a card that already exists**, subdividing it with at most a 1px `border-inline-end`. The container-as-card pattern is used for subdividing a card, never for a top-level pairing.

So the fix is: **normalise Phase 2's four boxes onto the token recipe its own sibling phases already use**, and add the transparent-container primitive that describes what the app does.

`align-items` note: 5 of 8 leave it at the grid default `stretch`. It is spelled out only when there is a reason — `stretch` at `XrayReferrals.css:29` (documented, so the sticky panel column gets full height) and `start` at `EmployeeWorkspace.css:2087` / `NotificationManager.css:369` (so a sticky detail card does not stretch). The primitive should therefore default to `stretch` and document the `start` escape hatch.

---

### Task 10: Normalise the Phase 2 boxes onto tokens

**Files:**
- Modify: `src/components/Sidebar/Tabs/Population/components/PhaseTwoReportAndProcessing.css` (`.p2-result-card` :29-38)
- Modify: `src/components/Sidebar/Tabs/Population/components/DataAccuracyReport.css` (`.dar-verdict` :59-70, `.dar-col-table` :148-154, `.dar-detail` :306-312)

**Interfaces:** none — pure CSS. No `.tsx` changes; the markup is already correct.

- [ ] **Step 1: Capture "before" screenshots first**

`npm run dev` → Population → `process` → upload a risk + BI pair so Phase 2 renders with accuracy. Screenshot the whole phase, top to bottom, at 1280 and 1920. This is the only baseline you get; there is no snapshot test for CSS.

- [ ] **Step 2: `.p2-result-card`**

`PhaseTwoReportAndProcessing.css:29-38`. Replace:

```css
  border: 1px solid var(--c-border);
  border-radius: 14px;
  background: var(--c-surface);
  box-shadow: var(--sh-sm);
```

with:

```css
  border: 1px solid var(--c-border);
  /* --r-xl, matching the identically-shaped .p3-top-row / .p4-top-row cards
     one phase over. The raw 14px this used to carry matches no token at all
     (--r-lg is 10px, --r-xl is 12px). */
  border-radius: var(--r-xl);
  background: var(--c-surface);
  box-shadow: var(--sh-sm);
```

- [ ] **Step 3: `.dar-verdict`** — `DataAccuracyReport.css:59-70`, same substitution (`border-radius: 14px` → `var(--r-xl)`). Keep `overflow: hidden` and the `::before` accent rail (`:72-80`) untouched — the rail is clipped by the radius and must stay that way.

- [ ] **Step 4: `.dar-col-table` and `.dar-detail`** — `DataAccuracyReport.css:148-154` and `:306-312`. Substitute the radius **and** raise the shadow so all four boxes sit at one elevation:

```css
  border-radius: 14px;
  overflow: hidden;
  box-shadow: var(--sh-xs);
```

becomes:

```css
  /* Same radius AND same elevation as the two verdict cards above: these
     four are peers in one vertical run, and two shadow depths across them
     is what made the phase read as unrelated fragments. */
  border-radius: var(--r-xl);
  overflow: hidden;
  box-shadow: var(--sh-sm);
```

- [ ] **Step 5: Check for anything that hard-codes the old radius**

```bash
grep -rn "14px" src/components/Sidebar/Tabs/Population/components/
```

Nested elements clipped by the parent's `overflow: hidden` (table heads, disclosure buttons) need no change. Anything that repeats `border-radius: 14px` to *match* one of the four boxes must move to `var(--r-xl)` too, or it will visibly disagree by 2px.

- [ ] **Step 6: "After" screenshots + diff**

Same views as Step 1. The four boxes should read as one family. Also re-shoot Phase 3 and Phase 4 to confirm Phase 2 now matches them.

- [ ] **Step 7: Gates**

```bash
npx vitest run src/components/Sidebar/Tabs/Population/components/PhaseTwoReportAndProcessing.test.tsx
npm run test:run && npm run typecheck && npm run lint && npm run check:hex-literals
```

---

### Task 11: Add the `.ui-card-row` primitive

**Files:**
- Modify: `src/styles/primitives.css`

**Interfaces:**
- Produces: `.ui-card-row` (asymmetric `300px minmax(0,1fr)` default), `.ui-card-row--even` (symmetric), `.ui-card-row--top` (`align-items: start`). Nothing consumes it in this plan except, optionally, `.p2-verdict-row` in Step 3.

- [ ] **Step 1: Append the primitive**

Add to `src/styles/primitives.css`, after the `.ui-card` block (`:175-192`):

```css
/* ── Card row (2-up) ───────────────────────────────────────────
   The app's existing convention for a top-level side-by-side pair,
   written down: the CONTAINER is transparent and each CHILD is its
   own card. Verified across .p2-verdict-row, .p3-top-row,
   .p4-top-row, .arc-layout, .ew-ref-queue.ew-xr-grid,
   .kpi-level-grid, .ew-approval-split and .ntf-split — none of them
   carries a border, radius, background or shadow of its own. The
   container-as-card pattern (.kpi-progress-grid, .kpi-ports-grid,
   .um-activity-card dl) is only ever used to SUBDIVIDE a card that
   already exists, never for the top-level pairing.

   `300px minmax(0, 1fr)` with `gap: 18px` is the shape three
   Population phase rows already use verbatim. `minmax(0, …)` is
   load-bearing: a grid track's default `min-width: auto` floors it
   at its content width, so a wide table inside would blow the row
   out instead of scrolling.

   align-items stays at the grid default `stretch` so both cards end
   up the same height — spelled out here because it is the whole
   reason a 2-up reads as one row. Reach for --top only when a child
   is `position: sticky`, which cannot travel inside a stretched
   track (see .ew-approval-split / .ntf-split, which both use
   `align-items: start` for exactly that). */
.ui-card-row {
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr);
  gap: 18px;
  align-items: stretch;
}

.ui-card-row--even {
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
}

.ui-card-row--top {
  align-items: start;
}

@media (max-width: 1100px) {
  .ui-card-row,
  .ui-card-row--even {
    grid-template-columns: minmax(0, 1fr);
  }
}
```

The `1100px` collapse matches `PhaseThreeSampling.css:23-27` and `PhaseFourDistribution.css:61-65`.

- [ ] **Step 2: Do NOT retrofit**

Migrating the eight existing 2-up containers onto `.ui-card-row` is **explicitly out of scope** — see *Follow-ups* below. This task ships the primitive and its documentation only.

- [ ] **Step 3: Optionally adopt it at the one site this group already touches**

`.p2-verdict-row` (`PhaseTwoReportAndProcessing.css:16-25`) is the only container in scope. Adopting it means adding `ui-card-row` to the element at `PhaseTwoReportAndProcessing.tsx:375` and reducing the CSS rule to the `.no-accuracy` override. **Only do this if the Task 10 screenshots are already signed off**, so a geometry change and a chrome change never land in the same unverified diff. Note that `.p2-verdict-row` today has **no** `max-width: 1100px` collapse while `.p3`/`.p4` do — adopting the primitive would *add* one, which is a behaviour change and needs its own screenshot at 1024px width. If that is not verified, skip Step 3 and leave the row as-is.

- [ ] **Step 4: Tier-3 gates, edit log, commit for Group 3**

```bash
npm run test:run && npm run typecheck && npm run lint
npm run check:complexity && npm run check:hex-literals && npm run check:vendor
npm run build && npm run check:bundle-size
npm run e2e
npm run editlog -- --tier=3 --append --sync-package "Fix (css): normalise the Phase 2 verdict row onto the app's card-row convention"
npm run check:release
```

The entry must record that **the brief's premise was stale** (`verdictHoisted` had already resolved the 1-vs-3 mismatch), what was actually wrong (radius/elevation drift across four peers), and why the convention survey ruled out both proposed approaches. Rollback: revert the four radius/shadow declarations; `.ui-card-row` can stay unused.

```bash
git add src/styles/primitives.css \
        src/components/Sidebar/Tabs/Population/components/PhaseTwoReportAndProcessing.css \
        src/components/Sidebar/Tabs/Population/components/DataAccuracyReport.css \
        "docs/edit logs/2026-08-24.md" package.json
git commit -m "Fix (css): normalise the Phase 2 verdict row onto the app's card-row convention" -- <same files>
```

---

## Ordering and independence

Recommended order **1 → 2 → 3**, but each group stands alone:

- **Group 1 before Group 2** is preferred because Group 1 Task 5 deletes the `min-height` lines that Group 2 Task 8 also rewrites. If Group 2 lands first, delete those lines there and mark Task 5 Steps 1–2 as already done.
- **Group 3 is fully independent** of both — it touches four declarations in two files plus an append to `primitives.css`.
- **Groups 2 and 3 both append to `primitives.css`.** If they land out of order, expect a trivial merge; keep `.page-shell` near the layout section and `.ui-card-row` immediately after `.ui-card`.

## Testing summary (gates)

Every group is tier 3, so the full sweep applies to each:

```bash
npm run lint
npm run typecheck
npm run test:run
npm run check:complexity
npm run check:hex-literals
npm run check:release
npm run check:vendor
npm run build
npm run check:bundle-size
npm run e2e          # NOT in CLAUDE.md's ladder — see below
```

**`npm run e2e` is added to the tier-3 sweep for this plan specifically.** `CLAUDE.md`'s ladder predates or omits it, but `e2e/` holds 18 Playwright specs (and `lint:ci` already covers the directory). It is the *only* automated layer in this repo that exercises real layout — `vitest` runs jsdom, which has **no layout engine at all**, so a fully green unit suite proves nothing about any change in this plan. `e2e/ui-scale.spec.ts` in particular asserts directly on shell geometry.

Plus, for every group, the **real-browser pass** — `npm run dev` in Chrome or Edge against a real workspace with a processed month, screenshots before and after, at 1280 / 1600 / 1920 and (for Group 1) 375 / 768, plus a real print preview for R17. Group 1 additionally requires reviewer sign-off rather than self-certification, per the boot-splash precedent in `CLAUDE.md`.

## Key files touched

| Group | Task | Files |
|---|---|---|
| 1 | 1 | none (sweep only) |
| 1 | 2 | `src/index.css` (incl. the `@media print` escape), `src/App.css`, `src/components/Sidebar/Sidebar.css`, `e2e/ui-scale.spec.ts` |
| 1 | 3 | `src/App.tsx` |
| 1 | 4 | `src/components/ModalPortal/ModalPortal.tsx`, `src/components/ModalShell/ModalShell.test.tsx`, `src/App.tsx` |
| 1 | 5 | `src/components/Sidebar/Tabs/Population/Population.css`, `.../UserManagement/UserManagement.css`, `src/App.css` |
| 1 | 6 | `src/components/Sidebar/BootSplashOverlay.css` (R23 comment only, if needed); otherwise verification only |
| 2 | 7 | `src/styles/primitives.css` |
| 2 | 8 | the four page CSS files + the four page `.tsx` roots |
| 2 | 9 | none (verification) |
| 3 | 10 | `.../Population/components/PhaseTwoReportAndProcessing.css`, `.../DataAccuracyReport.css` |
| 3 | 11 | `src/styles/primitives.css` |

## Follow-ups (flagged, NOT tasks in this plan)

1. **Retrofit `.ui-card-row` across the eight existing 2-up containers.** Explicitly out of scope. Each has its own collapse breakpoint (1100px / 860px / 760px / 560px / none) and its own `align-items` requirement; a blanket migration would silently change several. Worth doing as its own screenshot-gated pass.
2. **The remaining 15 raw `border-radius: 14px` declarations** across `InspectionPanel.css`, `Population.css`, `KpiDashboard.css`, `ReviewerKpiPanel.css`, `Reports.css` and `PhaseOneUpload.css`. Group 3 fixes only the four in Phase 2's vertical run. The rest are a separate sweep against the shape rule at `primitives.css:48-53`.
3. **`.sidebar` is `296px` while its grid track is `var(--sidebar-width)` = `280px`** (`Sidebar.css:37` vs `App.css:6,16`). A pre-existing 16px disagreement, deliberately left alone in Group 1 so it does not confound the screenshot diff.
4. **`DataTable.css:159,164`'s `260px` / `214px` chrome guesses.** Under a bounded shell these could become `100%`-relative instead of viewport-relative, which would be strictly more correct. Deferred until Group 1's browser pass shows whether they actually misbehave.
5. **`.ew-page`, `.rh-page`, `.um-page` and `.population-page` could eventually collapse into `.page-shell` alone**, once each page's remaining `direction` / `font-family` / `color` declarations are confirmed redundant against the inherited defaults. Not attempted here — four `dir="rtl"` roots is not the problem this plan set out to solve.
6. **`uiScaleCss.contract.test.ts`'s guard does not match `100dvh`** (its regex is `\b100v[hw]\b`). Five raw `dvh` uses slip past it (`App.css:199`, `Sidebar.css:601-602`, `AuthGate.css:55,82,654`). Either widen the regex and give `dvh` an `--app-dvh` equivalent, or document `dvh` as a deliberate exemption. Out of scope here; noted so the next reader does not assume the guard is total.
7. **The two body-scroll locks do not coordinate.** `ModalPortal`'s ref-counted lock (`ModalPortal.tsx:7-21`) and `App.tsx`'s mobile-drawer lock are independent, so opening a modal while the mobile drawer is open already races today. Task 4 moves both to the same target but does **not** merge them. Worth unifying behind one ref-counted helper.
8. **`FieldDropDialog.tsx:60-61` hand-rolls its viewport clamp** instead of using `anchoredPosition.ts`, duplicating logic that already has a regression test and a documented past bug (`anchoredPosition.ts:19`). Worth routing through the shared helper.
