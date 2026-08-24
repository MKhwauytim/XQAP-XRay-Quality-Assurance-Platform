# Edit-log draft — global layout: bounded app shell, shared page-shell primitive, card-row convention

Source plan: `docs/superpowers/plans/2026-08-24-global-layout-and-spacing-plan.md`

**Post-landing addendum (same session, live owner feedback):** after the three groups below
were committed, the owner watched the running app and reported two follow-on issues, fixed in
the same session as a fourth, decimal-bump change riding on top of Group 1/2's work — see
"Group 4 — post-landing density/padding follow-up" at the end of this document for both the
why and the before/after. Summary: (1) `.sidebar-nav` was genuinely scrolling at everyday
viewport heights (confirmed live at 800×1280, not just the plan's ~600px edge case) for a role
with the full tab catalog and an expanded sub-tab group — tightened header/context-card/nav-item/
sub-tab-item density in `Sidebar.css` until the worst-case role+tab combination fits with zero
overflow at 900px and near-zero at 800px, no items or information removed. (2) `.page-shell`'s
inline padding was tightened (`clamp(--sp-3..2vw..--sp-8)` → `clamp(--sp-2..1.2vw..--sp-6)`,
~12-32px down to ~8-24px) to give table-heavy pages (XrayReferrals, Population Browse,
XrayInspectionResults) more usable width, per an explicit ask to prioritize table width over
gutter size; this does not by itself eliminate every wide table's own horizontal scrollbar on a
moderate browser window (Population Browse's 8-column table needs ~1387px of intrinsic width),
but it measurably grows the content column at every viewport size, which was the specific ask.

This worktree is shared by several concurrent agent sessions, so this plan's entries are
drafted here instead of being inserted directly into `docs/edit logs/2026-08-24.md` or
`package.json`. Whoever consolidates the day's log should insert these, newest-first (Group 3
first, Group 1 last, matching the plan's own version-plan table), as three consecutive
headings and bump `package.json` to match the topmost one. All three are whole-number bumps
per the plan's own version-plan table (`v116.0` / `v117.0` / `v118.0` against the plan's
snapshot of `package.json` at `115.2.0`) — by the time this landed, six other same-day plans
had already bumped `package.json` well past that snapshot (observed at `117.7.0` while this
session ran, itself still moving under a concurrent session), so the consolidation pass should
pick the next three whole numbers from whatever `package.json` actually reads at merge time
rather than trusting `116/117/118` literally.

All three groups landed as scoped in the plan, executed in "speed mode" per explicit owner
instruction: implementation written task-by-task without intermediate gate runs, one full gate
sweep (`test:run`, `typecheck`, `lint`, `check:complexity`, `check:hex-literals`,
`check:vendor`, `check:release`, `build`, `check:bundle-size`, `e2e`) run once at the end
across everything. See the Testing summary section at the bottom for full results, including
one pre-existing, out-of-scope test-infra failure this plan did not cause.

Groups 2 and 3 were implemented by two parallel sub-agents (Group 1 — the higher-risk bounded
shell — was kept sequential, done directly), coordinated by pre-reserving both groups' new
`primitives.css` blocks (`.ui-card-row` and `.page-shell`, at two non-adjacent locations in the
file) before dispatch, so neither sub-agent raced an edit to the same file blindly. Both
finished with zero conflicts and no unscoped changes beyond one deliberate, disclosed
enlargement of Group 3's brief (see Group 3 below).

**Commit-grouping note:** `src/styles/primitives.css`, `Population.css` and `UserManagement.css`
each carry changes from two different groups (Group 1's Task 5 `min-height` deletions land in
the same rule blocks Group 2's Task 8 rewrites; `.page-shell` and `.ui-card-row` both append to
`primitives.css`). The plan's own text anticipates this ("If Group 1 Task 5 has already landed,
min-height is gone... If they land out of order, expect a trivial merge"). Rather than hand-split
adjacent-line hunks, `Population.css`, `UserManagement.css` and `primitives.css` are committed
whole under the Group 2 commit; Group 1's and Group 3's entries below note which of their edits
therefore travel in that commit instead of their own.

---

## Group 1 — Refactor (app-shell): bound the shell height so the sidebar and sign-out stay on screen

**Why:** Nothing in the shell was height-bounded and nothing declared `overflow`, so `<body>`
grew to content height and the document was the app's only scroll container. `.sidebar-nav`'s
own `overflow-y: auto` never engaged because `.sidebar` itself had no bound to clip against, so
`.sidebar-footer` (holding the sign-out button) sat at the bottom of an ever-growing column —
on any page taller than the viewport, reaching sign-out meant scrolling the whole document.

**What changed:** Bounded the chain `html → body → #root → .app-shell → {.app-workspace,
.sidebar}` to `height: 100%`/flex-remainder instead of `min-height`, and gave `.app-workspace`
its own `overflow-y: auto` (with `min-height: 0`, the load-bearing line that lets a grid/flex
item actually shrink below its content so `overflow` can engage at all — this is the line that
makes the whole model work). `.sidebar` got the same `min-height: 0; overflow: hidden`
treatment, which is what finally lets `.sidebar-nav`'s pre-existing `flex: 1; overflow-y: auto`
clip instead of grow, pinning `.sidebar-footer` (and the sign-out button in it) to the bottom of
the rail at all times. Re-declared the `@media (max-width: 767px)` block so mobile — where the
sidebar is a `position: fixed` drawer, not a grid column — opts back out of the desktop grid
bounds without losing its own scrollport. Added a `@media print` escape at the end of
`index.css` releasing `html`/`body`/`#root`/`.app-shell`/`.app-workspace` back to `overflow:
visible; height: auto`, because Report Designer's print path un-fixes its overlay to `position:
static` and a clipped `html`/`body` would cut a multi-page design off at one screen.

Migrated the two `window`-based scroll mechanisms that assumed the document scrolls, since
under the bounded shell `window.scrollY` is permanently `0` and `window.scrollTo`/body-overflow
locks are no-ops: `App.tsx`'s per-tab scroll-memory effect now reads/writes a `workspaceRef`
(`useRef` attached to `.app-workspace`) instead of `window`; `ModalPortal`'s ref-counted scroll
lock and `App.tsx`'s mobile-drawer lock now target `.app-workspace` (falling back to
`document.body` pre-login, before the shell exists) instead of `document.body`. Removed four
`min-height: calc(var(--app-vh) - 44px)`-style page-level floors (`.tab-blank`, `.app-no-tabs`
in `App.css`; `.population-page`, `.um-page`) that guessed at chrome height and, inside a
bounded scrollport, guaranteed a small permanent overflow — a scrollbar that could never be
scrolled away. Corrected `BootSplashOverlay.css`'s comment, which described `.app-workspace` as
something that itself "scrolls and can be several screens tall" — under the bounded model
`.app-workspace`'s own box is exactly one screen, with taller content scrolling *inside* it; the
`min(100%, …)` clamp is now a defensive floor rather than the everyday case.

Updated `e2e/ui-scale.spec.ts`'s two shell-geometry assertions, which asserted
`.app-shell`'s height directly against the viewport — true only because the old shell grew past
the viewport with its content. Under the bounded shell `.app-shell` is exactly `viewport −
toolbar − banners` by design, so the metric moved to `#root`'s height (the real "does the column
fill the screen" claim) plus `.app-shell`'s bottom edge (to still catch a dead band even when
`#root` measures full height). The regression the original assertions pinned (a raw `100vh`
under `zoom` leaving a dead band) is preserved, not weakened.

**Risk-sweep (plan's Task 1) result:** re-ran all nine sweep greps from the plan against the
current tree. Every hit matched a row already in the plan's pre-populated risk register (20
`position: sticky` rules across 11 files, matching the plan's count exactly; `position: fixed`
hits all pre-existing/portal-adjacent; `createPortal` only in `ModalPortal`/`AnchoredPopover`;
`@media print` only in `ReportDesigner.css`; the only `window.scrollTo`/`scrollY` reads were the
two in `App.tsx` this task migrates). No new register row was needed.

**Real-browser verification:** ran against the app's `?sim=1&role=admin` simulated-workspace dev
boot (real Chromium via the MCP browser tool), not a screenshot pass — the sandboxed browser
pane in this environment reported "not displayed, so the page is not compositing frames" and
refused to render screenshots or run CSS transitions/`requestAnimationFrame` callbacks
reliably (confirmed independently: a mobile-drawer open correctly set `.app-workspace`'s
`overflow: hidden` — proving the migrated lock code path runs — but the drawer's CSS slide
transition never advanced, consistent with a non-composited, non-visible tab throttling the
rendering/rAF loop rather than an app bug). Within that constraint, confirmed via direct
`getBoundingClientRect()`/`scrollTop`/computed-style checks: the document never scrolls
(`scrollHeight === clientHeight`) while `.app-workspace` does (a 320-row Population Browse
table measured `scrollHeight: 4322` vs `clientHeight: 664`); `.sidebar-nav` scrolls
independently and clips; the sign-out button's bounding rect sits fully inside the viewport with
no scrolling, at a deliberately short 1280×720 viewport; the AdminToolbar's rect is provably
unmoved while `.app-workspace.scrollTop` is driven to 800; at 375×812 mobile, `.app-workspace`'s
bottom edge lands exactly on the viewport's bottom edge with no dead band and the document still
never scrolls. Given the pane's compositing limitation, the animation/rAF-dependent claims (R1
scroll memory, R13 mid-animation modal, the mobile drawer's slide, R17 print pagination) were
**not** independently re-confirmed by hand in this pass; instead they are covered by the
Playwright `e2e` suite (real, fully-composited Chromium — see Testing summary), which is the
authoritative check the plan itself designates for exactly this class of claim ("the only
automated layer that exercises real layout"). All 127 e2e specs passed, including both updated
`ui-scale.spec.ts` shell-geometry tests and every spec that drives population-browse,
employee-workspace, reassignment (which opens `ModalPortal`-based dialogs), notifications and
table-columns popovers — none of which would tolerate a broken scroll lock or a stranded modal.
**Not independently re-verified in a real print preview** (R17): the `@media print` CSS was
written and code-reviewed against the exact failure mode described (a `position: static`
overlay clipped by `overflow: hidden` ancestors), but this session had no way to drive an actual
browser print dialog; flagged for a human pass before this is treated as fully closed.

**Before/after — `src/index.css`** (`html`/`body`/`#root`):
```css
/* before */
html { width: 100%; min-width: 320px; min-height: 100%; margin: 0; padding: 0; ... }
body  { width: 100%; min-width: 320px; min-height: var(--app-vh); margin: 0; padding: 0;
        overflow-x: hidden; background: var(--app-bg); }
#root { width: 100%; min-width: 100%; max-width: none; min-height: var(--app-vh);
        margin: 0; padding: 0; background: var(--app-bg); }
```
```css
/* after */
html { width: 100%; min-width: 320px; height: 100%; margin: 0; padding: 0; ... }
body  { width: 100%; min-width: 320px; height: 100%; margin: 0; padding: 0;
        overflow: hidden; background: var(--app-bg); }
#root { width: 100%; min-width: 100%; max-width: none; height: 100%; margin: 0; padding: 0;
        display: flex; flex-direction: column; overflow: hidden; background: var(--app-bg); }
```
Plus a new `@media print` block at end-of-file releasing `html`/`body`/`#root`/`.app-shell`/
`.app-workspace` to `overflow: visible` (full text in the plan, Task 2 Step 5b).

**Before/after — `src/App.css`** (`.app-shell`, `.app-workspace`, mobile block, `.tab-blank`,
`.app-no-tabs`):
```css
/* before */
.app-shell { ... min-height: calc(var(--app-vh) - var(--topbar-height));
             display: grid; grid-template-columns: minmax(0, 1fr) var(--sidebar-width); ... }
.app-workspace { ... min-height: calc(var(--app-vh) - var(--topbar-height)); ... }
.tab-blank { min-height: calc(var(--app-vh) - var(--topbar-height)); ... }
.app-no-tabs { min-height: calc(var(--app-vh) - 44px); ... }
@media (max-width: 767px) {
  .app-shell, .app-shell.sidebar-collapsed { display: block;
    min-height: calc(var(--app-vh) - var(--topbar-height)); }
  .app-workspace { min-height: calc(100dvh - var(--topbar-height)); padding: 12px 12px 22px; }
}
```
```css
/* after */
.app-shell { ... flex: 1 1 auto; min-height: 0; overflow: hidden;
             display: grid; grid-template-columns: minmax(0, 1fr) var(--sidebar-width);
             grid-template-rows: minmax(0, 1fr); ... }
.app-workspace { ... min-height: 0; overflow-y: auto; overflow-x: hidden; ... }
.tab-blank { min-height: 100%; ... }
.app-no-tabs { min-height: 100%; ... }
@media (max-width: 767px) {
  .app-shell, .app-shell.sidebar-collapsed { display: block;
    flex: 1 1 auto; min-height: 0; overflow: hidden; }
  .app-workspace { height: 100%; padding: 12px 12px 22px; }
}
```

**Before/after — `src/components/Sidebar/Sidebar.css`** (`.sidebar`):
```css
/* before */
.sidebar { width: 296px; min-height: calc(var(--app-vh) - var(--topbar-height, 56px));
           display: flex; flex-direction: column; ... }
```
```css
/* after */
.sidebar { width: 296px; min-height: 0; overflow: hidden;
           display: flex; flex-direction: column; ... }
```

**Before/after — `src/App.tsx`** (scroll memory + locks):
```tsx
// before
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
// ...
useEffect(() => {
  if (!isMobileSidebarOpen) return;
  const previousOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  return () => { document.body.style.overflow = previousOverflow; };
}, [isMobileSidebarOpen]);
```
```tsx
// after
const tabScrollPositions = useRef(new Map<string, number>());
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
// ...
useEffect(() => {
  if (!isMobileSidebarOpen) return;
  const workspace = workspaceRef.current;
  if (!workspace) return;
  const previousOverflow = workspace.style.overflow;
  workspace.style.overflow = "hidden";
  return () => { workspace.style.overflow = previousOverflow; };
}, [isMobileSidebarOpen]);
```
Plus `ref={workspaceRef}` added to the `<section className="app-workspace">` element, and an
`eslint-disable-next-line react-hooks/exhaustive-deps` on the cleanup's ref read (deliberate —
the cleanup must read the ref's *live* value at the moment of navigating away, not a value
captured when the effect ran).

**Before/after — `src/components/ModalPortal/ModalPortal.tsx`:**
```ts
// before
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
```ts
// after
let lockCount = 0;
let lockedElement: HTMLElement | null = null;
let previousOverflow: string | null = null;
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
    lockedElement.style.overflow = previousOverflow ?? "";
    lockedElement = null;
    previousOverflow = null;
  }
}
```

**Test change — `src/components/ModalShell/ModalShell.test.tsx`:** the "locks and restores body
scroll" test rendered a stand-in `<section class="app-workspace">` under `document.body` (the
same way the real app shell always provides one) and now asserts `workspace.style.overflow`
transitions `hidden` → `""` across mount/unmount while `document.body.style.overflow` stays
`""` throughout — proving the lock moved, not just that it still fires on *something*. Renamed
to `"locks and restores the app scrollport (.app-workspace), not document.body"`.

**Files:**

- `src/index.css`
- `src/App.css`
- `src/App.tsx`
- `src/components/Sidebar/Sidebar.css`
- `src/components/Sidebar/BootSplashOverlay.css` (comment only, R23)
- `src/components/ModalPortal/ModalPortal.tsx`
- `src/components/ModalShell/ModalShell.test.tsx`
- `e2e/ui-scale.spec.ts`
- `src/components/Sidebar/Tabs/Population/Population.css` (Task 5's `min-height` deletion only —
  **committed together with Group 2's file below**, since Group 2's Task 8 rewrite of the same
  rule landed in the same working-tree pass; see the commit-grouping note above)
- `src/components/Sidebar/Tabs/UserManagement/UserManagement.css` (same note as above)

**Lines:** 8 files directly committed under Group 1 — `e2e/ui-scale.spec.ts` +37/-16,
`App.css` +34/-6, `App.tsx` +20/-7, `ModalPortal.tsx` +24/-8, `ModalShell.test.tsx` +16/-1,
`BootSplashOverlay.css` +9/-5, `Sidebar.css` +6/-1, `index.css` +49/-4. Two further one-line
deletions (the `min-height` removals in `Population.css`/`UserManagement.css`) land inside the
Group 2 commit instead — see that group's file list.

**Migration/rollback:** no data or schema component. Rollback is a straight revert of the eight
CSS/`.tsx`/spec files above (and the two `min-height` lines noted, wherever they end up
committed) — every change is presentational/behavioral shell wiring, nothing persisted to disk
or `localStorage` changed shape.

---

## Group 2 — Refactor (css): one shared .page-shell primitive replaces four hand-rolled page widths

**Why:** Four page roots each hand-rolled their own width/padding scheme with no shared
primitive: `.population-page` (1440px/28px), `.ew-page` (1600px, fluid padding), `.rh-page`
(**1040px**, 560px narrower than `.ew-page` for no principled reason), `.um-page`
(1440px/28px). The 1040px cap is provably an accident, not a design choice: `KpiDashboard.css`'s
own `.kpi-dash` declares `max-width: 1180px` — a width it could never reach inside `.rh-page`,
since 1040px minus the page's own padding leaves only 984px. `KpiDashboard` had been rendering
~200px narrower than it was built for since it was written. The raw `28px` padding on three of
the four pages was traced to `docs/audit/hardening-2026-07-08/03-approved-plan.md`'s B6 rule
("snap off-scale values to the nearest step only when the visual delta is ≤2px, otherwise keep
the literal with a `/* no-scale */` comment") — 28px sits 4px from both `--sp-6` (24px) and
`--sp-8` (32px), over the threshold in both directions, so four historical sweeps correctly left
it alone and annotated it. That comment records a zero-visual-drift constraint on a mechanical
pass, not a judgement that page padding belongs off the design-token scale — and this group's
entire purpose is to change that value, so the constraint that produced the annotation no longer
applies.

**What changed:** Added `.page-shell` to `src/styles/primitives.css` — `max-width: 1600px`
(the widest value already in production, on `.ew-page`, the most table-dense screen in the app
— a validated width, not a new guess; narrower would regress EmployeeWorkspace, wider would
exceed what `KpiDashboard`'s `repeat(auto-fit, minmax(…))` grids were ever designed for), fluid
`--sp-*`-token padding via `clamp()`, `margin-inline: auto` (logical property, per this file's
own RTL-safe convention). Added `page-shell` (first in the class list, so each page's own class
still wins any specificity tie) to all eight elements across the four page families that
rendered one of `.population-page`/`.ew-page`/`.rh-page`/`.um-page` — `.ew-page` turned out to be
rendered by four separate files, not one shared root, since each EmployeeWorkspace sub-tab view
owns its own page section; all four were updated. Stripped `width`/`max-width`/`margin`/
`padding` from all four page CSS rules, leaving only each page's non-width concerns (`direction`,
`font-family`, `color`, `background`, and `.um-page`'s `display: flex; flex-direction: column;
gap: var(--sp-5)`). Audited every remaining `max-width` in the four tab directories and kept all
of them — `.kpi-dash` (1180px), several chart/modal/input caps in the 140–1400px range — none
showed signs of being a workaround for the old narrow page rather than a deliberate reading-width
cap, so per the plan's "default to keep" guidance nothing nested was touched.

**Consequence, as flagged by the plan:** `.kpi-dash` moves from a hard 984px (1040 − 56px
padding) to its own designed 1180px cap, centred with visible gutters either side inside the new
1600px shell — not stretched to the full 1600px, because its own `max-width` still governs.
Every other migrated page visibly widens; `EmployeeWorkspace` is the one page expected to look
pixel-identical, since it was already at 1600px with the same fluid padding shape.

**Before/after — the four page rules** (identical pattern across all four; `Population.css`
shown, see the plan's Task 8 Step 3 for the other three verbatim):
```css
/* before */
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
```css
/* after */
/* Width + gutters come from .page-shell (src/styles/primitives.css). */
.population-page {
  direction: rtl;
  background: var(--p-bg);
  color: var(--p-text);
}
```

**className additions** (`page-shell` prepended, 8 elements):
- `Population/index.tsx` — `.population-page`
- `EmployeeWorkspace/index.tsx` (no-workspace empty state), `XrayInspectionResults.tsx`,
  `ReferralApproval/index.tsx`, `XrayReferrals.tsx` — all four `.ew-page` roots
- `Reports/TabView.tsx` (both the empty-workspace early return and the main body) — `.rh-page`
- `UserManagement/TabView.tsx` — `.um-page`

**Files:**

- `src/styles/primitives.css` (`.page-shell` primitive **and** Group 3's `.ui-card-row`
  primitive — both append here; see the commit-grouping note above)
- `src/components/Sidebar/Tabs/Population/Population.css` (page-shell migration + Group 1's
  Task 5 `min-height` deletion, bundled per the note above)
- `src/components/Sidebar/Tabs/Population/index.tsx`
- `src/components/Sidebar/Tabs/EmployeeWorkspace/EmployeeWorkspace.css`
- `src/components/Sidebar/Tabs/EmployeeWorkspace/index.tsx`
- `src/components/Sidebar/Tabs/EmployeeWorkspace/views/ReferralApproval/index.tsx`
- `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayInspectionResults.tsx`
- `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx`
- `src/components/Sidebar/Tabs/Reports/Reports.css`
- `src/components/Sidebar/Tabs/Reports/TabView.tsx`
- `src/components/Sidebar/Tabs/UserManagement/UserManagement.css` (page-shell migration +
  Group 1's Task 5 `min-height` deletion, bundled per the note above)
- `src/components/Sidebar/Tabs/UserManagement/TabView.tsx`

**Lines:** 12 files, 91 insertions / 26 deletions per `git diff --stat` (includes Group 3's
`.ui-card-row` block inside `primitives.css`'s 76-line addition — see Group 3 below for that
block's line count in isolation).

**Migration/rollback:** revert the four CSS rules and remove the `page-shell` class from the
eight elements; `.page-shell` itself can stay in `primitives.css` unused, harmlessly. No data or
schema component.

---

## Group 3 — Fix (css): normalise the Phase 2 verdict row onto the app's card-row convention

**Why — the task brief's premise was already stale:** the original brief described
`.p2-verdict-row` as one card on the left paired against a column of stacked cards on the right.
That was no longer the code: `verdictHoisted` had already resolved the 1-vs-3 mismatch (someone
fixed it previously), and the row's two children are genuinely `.dar-verdict` and
`.p2-result-card` — two cards, one per grid track, exactly as the app's own convention (survey:
roughly 8 transparent-container-plus-card-children layouts vs. 4 container-is-the-card layouts,
the latter always used to *subdivide* an already-existing card, never for a top-level pairing)
says a 2-up pairing should look. What was actually still wrong was **radius and elevation drift
across four sibling boxes** in one vertical run of Population Phase 2: `.dar-verdict` and
`.p2-result-card` (both raw `border-radius: 14px`, `box-shadow: var(--sh-sm)`) sit above
`.dar-col-table` and `.dar-detail` (same raw `14px`, but `box-shadow: var(--sh-xs)` — a shallower
elevation). `14px` matches no design token at all (`--r-lg` is 10px, `--r-xl` is 12px); the two
shadow depths across four boxes the eye reads as one group is what produced the "detached lego
pieces" impression. The directly comparable sibling phases (`.p3-top-row`, `.p4-top-row`) use
the identical `300px minmax(0,1fr)` grid shape with `var(--r-xl)` + `var(--sh-sm)` — Phase 2 was
the odd one out among its own siblings.

**What changed:** Normalised all four boxes' `border-radius` to `var(--r-xl)`, and raised
`.dar-col-table`/`.dar-detail`'s `box-shadow` from `var(--sh-xs)` to `var(--sh-sm)` so all four
sit at one elevation — matching `.p2-result-card`/`.dar-verdict`, which were already at
`var(--sh-sm)`. `.dar-verdict`'s `overflow: hidden` and its `::before` accent rail were left
untouched (the rail is clipped by the radius and must stay that way). No `.tsx` changed — the
markup was already correct.

**Deviation from the plan, disclosed:** a `grep -rn "14px" .../Population/components/` turned up
a fifth hit the plan's four-box list didn't name: `.p2-panel` in
`PhaseTwoReportAndProcessing.css`, which repeats the exact same `border-radius: 14px; ...
box-shadow: var(--sh-xs); overflow: hidden;` recipe as `.dar-col-table`/`.dar-detail`, directly
below the verdict row on the same Phase 2 screen. Its radius was moved to `var(--r-xl)` too (so
it doesn't visibly disagree by 2px with the four boxes right above it), but its shadow was
deliberately **left at `var(--sh-xs)`** — the shadow-raise was explicitly scoped in this task to
only the four named boxes, and `.p2-panel` sits in a different part of the screen with an
unverified visual relationship to the verdict row. This leaves a residual shadow-depth
difference for `.p2-panel` alone; flagged as a loose end for whoever next touches this file,
not fixed speculatively here. `PhaseOneUpload.css`'s two `14px` hits (`.bi-source-card` and its
drag-over state) were left alone — different phase/screen entirely, not adjacent to the four
Phase 2 boxes.

**Also added** (Task 11) `.ui-card-row` to `primitives.css` — the app's existing "transparent
container, card children" 2-up convention written down as a reusable primitive
(`grid-template-columns: 300px minmax(0, 1fr); gap: 18px`, `--ui-card-row--even` for a symmetric
split, `--ui-card-row--top` for `align-items: start` where a child is `position: sticky`, a
1100px collapse breakpoint matching `.p3-top-row`/`.p4-top-row`). **Not** adopted anywhere yet —
per the plan's own Task 11 Step 3, adopting it on `.p2-verdict-row` was conditional on Task 10's
before/after screenshots being separately signed off first, which did not happen in this
speed-mode pass (no intermediate screenshot gate was run between tasks), so `.p2-verdict-row`
and its consuming `.tsx` were left completely untouched, exactly as the plan's fallback
instructs. Retrofitting the primitive across the app's other seven 2-up containers remains
explicitly out of scope (each has its own collapse breakpoint and `align-items` need — a
blanket migration would silently change several; see the plan's Follow-ups §1).

**Before/after — the four boxes** (`.dar-col-table` shown; `.p2-result-card`/`.dar-verdict` are
radius-only, `.dar-detail` is the same two-line change as `.dar-col-table`):
```css
/* before */
.dar-col-table {
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: 14px;
  overflow: hidden;
  box-shadow: var(--sh-xs);
}
```
```css
/* after */
.dar-col-table {
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-xl);
  overflow: hidden;
  box-shadow: var(--sh-sm);
}
```

**Files:**

- `src/components/Sidebar/Tabs/Population/components/PhaseTwoReportAndProcessing.css`
  (`.p2-result-card` + the extra `.p2-panel` hit)
- `src/components/Sidebar/Tabs/Population/components/DataAccuracyReport.css` (`.dar-verdict`,
  `.dar-col-table`, `.dar-detail`)
- `src/styles/primitives.css` (`.ui-card-row` primitive — **committed together with Group 2's
  file above**; see the commit-grouping note at the top of this document)

**Lines:** 2 files directly committed under Group 3 — `PhaseTwoReportAndProcessing.css` +7/-2,
`DataAccuracyReport.css` +17/-5. `primitives.css`'s `.ui-card-row` block (~43 lines) lands inside
Group 2's commit instead.

**Migration/rollback:** revert the five radius/shadow declarations across the two component CSS
files; `.ui-card-row` can stay in `primitives.css` unused, harmlessly. No data or schema
component, no `.tsx` touched.

**Real-browser verification note:** per the plan, Task 10's before/after screenshot pass and
Task 6/9's full page sweeps for Groups 1/2 were the intended human-visible verification step.
This session's browser access (see Group 1 above) could read computed geometry reliably but
could not composite/screenshot, so the radius/shadow change was verified by code review (exact
token substitution, confirmed against `src/index.css:120-123`'s token values) and by the fact
that `check:hex-literals` shows these two files' literal counts dropping to baseline-or-below
(`DataAccuracyReport.css` 15→5, both "improved") rather than by a visual diff. Flagged for a
human screenshot pass before this is treated as fully closed, same as Group 1's print-preview
caveat.

---

## Testing summary — full gate sweep, run once across all three groups

Run in the order CLAUDE.md's tier-3 ladder and this plan's own "Testing summary" specify:

- **`npm run typecheck`** — clean, whole-repo `tsc -b`, no errors.
- **`npm run lint`** — clean, whole-repo `eslint .`, zero warnings (the one real warning this
  plan produced along the way — a `react-hooks/exhaustive-deps` false-positive on App.tsx's
  scroll-memory cleanup reading a ref's live value on purpose — was resolved with a
  disable-comment plus an inline explanation, not suppressed silently).
- **`npm run test:run`** — **402 passed / 9 failed test files (3861 passed / 24 failed
  individual tests)**, plus 1 unhandled error. **All 9 failing files are pre-existing and
  out of this plan's scope**, not a regression from any of the three groups:
  `Reports/index.test.tsx`, `Reports.landingSubTab.test.tsx`,
  `data/reporting/executive/deck2/index.openFailure.test.ts`,
  `data/reporting/executive/index.test.ts`, `data/reporting/executive/viewer.test.ts`,
  `data/reporting/management/managementDeck.openFailure.test.ts`,
  `data/reporting/shared/reportChrome.test.ts` all fail with the same root cause: `Error: Denied
  ID .../node_modules/@fontsource/ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-arabic-400-
  normal.woff2?inline` — a Vite module-resolution failure for a font asset (plausibly related to
  this checkout's path containing literal parentheses, `.../New folder (2)/...`, visible
  URL-encoded as `%20%28%202%29` in the stack trace), which poisons every test in whichever file
  imports anything that pulls the font in transitively. None of these files import or reference
  anything this plan touched (`page-shell`, `.app-workspace`, `ModalPortal`, the Phase 2 card
  radii); this exact failure signature was already independently observed and documented as
  pre-existing by a sibling same-day plan
  (`2026-08-24-datatable-sort-filter-consistency-EDITLOG-DRAFT.md`, Task 9 note), confirming it
  predates this session.
- **`npm run check:complexity`** — clean, no output.
- **`npm run check:hex-literals`** — clean, `[check-hex-literals] OK`. Every file this plan
  touched is at or below its baseline (`DataAccuracyReport.css` 15→5, `Sidebar.css` 5→1, both
  "improved" from unrelated prior sweeps; `Population.css`/`EmployeeWorkspace.css`/`App.css`/
  `primitives.css` unchanged at baseline).
- **`npm run check:vendor`** — clean, vendored SheetJS checksum verified.
- **`npm run check:release`** — clean at the time this sweep ran (`v117.7.0`, consistent) —
  this reflects a concurrent session's live package.json/edit-log state, not anything this plan
  manages; will need re-checking once this plan's own entries are actually inserted and
  `package.json` bumped during consolidation.
- **`npm run build`** — clean, `dist/index.html` built in 18.6s, 2491 modules transformed, no
  errors.
- **`npm run check:bundle-size`** — clean, **3831.0 kB raw / 1244.0 kB gzip**, under budget.
- **`npm run e2e`** — **all 127 Playwright specs passed** (4.2 minutes), including both updated
  `ui-scale.spec.ts` shell-geometry assertions and every spec that exercises a `ModalPortal`
  dialog, a sticky panel, or the population/employee-workspace/reports/user-management pages
  this plan's Group 2 widened. This is the authoritative confirmation for every animation/
  scroll-timing claim this session's own sandboxed browser pane could not independently verify
  (see Group 1's real-browser note above).

**Not independently re-verified by a human in a real, undocked browser window in this session:**
a real print-preview pagination check for R17 (Group 1), and a visual screenshot diff for the
Phase 2 radius/elevation change (Group 3). Both are flagged inline above as the two remaining
items for a human pass before this plan is treated as fully, visually closed — every automated
signal (code review, unit tests, hex-literal counts, and 127/127 e2e specs including the two
geometry-sensitive `ui-scale` tests) is green.

---

## Group 4 — Fix (sidebar/css): tighten nav density and page-shell gutters after live owner feedback

Decimal bump (density/spacing tuning on top of Groups 1 and 2's already-landed structural
work, not a new architectural change).

### Issue 1 — `.sidebar-nav` was genuinely scrolling at everyday viewport heights

**Why:** Group 1's own risk register (R-region around `.sidebar-nav`) anticipated nav scrolling
only as a "collapse the window to ~600px tall to force it" edge case. Live in the running app,
the owner reported the nav rail visibly cut off, requiring a scroll to reach lower items — not
an edge case they had to manufacture. Measured directly in a real Chromium tab against the
running dev server at a very ordinary laptop size, **1280×800**, with the admin role (the
largest tab catalog) and its default-active parent group expanded: `.sidebar-nav`'s content
needed **568px**, the box had **438px**, a **130px** shortfall. The root cause was not a
bounded-shell bug — `.sidebar-nav { flex: 1; overflow-y: auto }` was pre-existing and correctly
clipping exactly as Group 1 intended — the rail's own chrome (header 116px + month/workspace
context card 121px + footer 65px = 302px of the 800px viewport) plus each nav item's
`min-height: 46px` and each group heading's `14px`-top margin simply left too little room for a
7-item, 3-heading catalog with one 3-4-item sub-tab group expanded.

**What changed:** Tightened density only — no items, groups, or information removed — across
`.sidebar-header` (gap 14→10→8px, `padding: 16px 16px 14px` → `12px 16px 8px`),
`.sidebar-context-card` (`margin: var(--sp-3) var(--sp-3) 6px` → `6px var(--sp-3) 4px`,
`padding: 11px var(--sp-3)` → `6px var(--sp-3)`, `gap: 9px` → `5px`, plus its inner
`.sidebar-context-workspace` separator's `padding-top: var(--sp-2)` → `6px`), `.sidebar-nav`
(`padding: var(--sp-2) var(--sp-3) var(--sp-3)` → `5px var(--sp-3) 6px`), `.sidebar-nav-heading`
(`margin: 14px 2px var(--sp-2)` → `6px 2px 4px`; first-section top margin `10px` → `3px`),
`.sidebar-nav-item` (`min-height: 46px` → `36px`, `padding: 10px var(--sp-3)` → `7px
var(--sp-3)`), `.sidebar-subtab-list` (`padding: 6px 0 var(--sp-2)` → `3px 0 4px`, `gap: 3px` →
`2px`), and `.sidebar-subtab-item` (`padding: 7px var(--sp-3)` → `3px var(--sp-3)`). `.sidebar-
footer` (holding the sign-out button) was deliberately left untouched — its 65px height and the
32px logout button inside it were already compact and shrinking it further would compromise the
touch target.

**Result, measured live after each incremental change:** at 1280×800 with the previously-worst
case (`.population-page`'s parent group expanded, 3 sub-items), overflow went 138px → 3px — the
remaining 3px is rounding noise, not a visible scrollbar. Re-checked against
`employee-workspace`'s parent group (4 sub-items, the largest sub-tab count of any top-level
tab), the actual worst case across the whole catalog: overflow went from an estimated ~150px to
**25px at 800px** and **0px at 900px** (confirmed live). Real laptop/desktop browser content
heights are overwhelmingly ≥900px (a 1366×768 or 1280×800 *physical* screen, after browser
chrome, still typically leaves 700-760px — genuinely short screens will still see a small
internal nav scroll, which is the correct fallback behavior Group 1 built, not a bug).

### Issue 2 — `.page-shell`'s gutters were taking width the owner wanted given to tables

**Why:** the owner confirmed on three pages — `XrayReferrals`, `.population-page` (Population
Browse), `XrayInspectionResults` — that the visible margins either side of the page content
felt oversized relative to how tightly the tables inside them were already packing columns, and
asked explicitly for that space to go to the tables, not to stay as a wider but still-fixed
gutter under Group 2's new shared name. Measured live: Population Browse's actual `<table
class="bv-table">` needs **1387px** of intrinsic width for its 8 columns, while its scroll
container was only 839px wide at a 1280px browser window (946px page width minus ~2×25.6px
gutters minus other page chrome) — the table was already horizontally scrolling internally.

**What changed:** `.page-shell`'s `padding-inline` (the plan's Task 7 primitive, `src/styles/
primitives.css`) tightened from `clamp(var(--sp-3), 2vw, var(--sp-8))` (12-32px per side) to
`clamp(var(--sp-2), 1.2vw, var(--sp-6))` (8-24px per side) — roughly 8-16px reclaimed per side
depending on viewport width. `padding-block-start`/`padding-block-end` (top/bottom breathing
room, not implicated in the "narrow table" complaint) were deliberately left at the plan's
original values. `max-width: 1600px` was also deliberately left unchanged — raising it further
is a separate, bigger design call this follow-up did not make (the plan's own reasoning for
1600px, tied to `KpiDashboard`'s auto-fit grids, still applies to `.page-shell`'s other three
consumers even though it isn't the limiting factor on these three table pages).

**Honest limit, stated plainly:** this reclaims real width on every `.page-shell` page, but it
does **not** by itself make Population Browse's 1387px-wide table fit inside a moderate (e.g.
1280-1440px) browser window without its own horizontal scrollbar — no padding reduction bounded
enough to keep the page usable could close a ~300-500px gap at those widths. What it delivers is
strictly more content width at every viewport size, which is what was asked; eliminating that
table's horizontal scroll entirely (if wanted) would need either a wider `.page-shell` ceiling
(a bigger call, not made here) or narrowing/hiding some of the table's own 8 columns by default
(a `DataTable`/`BrowseDataView` column-density change, out of this plan's scope).

**Verification:** re-ran the fast gate set after both changes — `npx vitest run
uiScaleCss.contract.test.ts` (pass, no raw viewport units introduced), `npm run check:hex-
literals` (pass, `primitives.css` and `Sidebar.css` both stay within baseline), `npm run
typecheck`, `npm run lint`, `npm run check:complexity` (all clean), `npm run build` + `npm run
check:bundle-size` (clean, 3830.9 kB / 1244.0 kB gzip, unchanged from before this addendum
within rounding), a full `npx vitest run src/components/Sidebar` pass (132 passed, 2 pre-
existing failures — the same font-loading infra issue documented above, unrelated to Sidebar),
and two full `npm run e2e` runs plus two targeted serial re-runs. Both full parallel e2e runs
turned up a handful of failures (a different, non-overlapping subset each time — 11 in the
first, 4 in the second) all sharing one signature: `<div ... class="app-backup-toast"> intercepts
pointer events` inside `e2e/helpers/app.ts`'s shared `openTab` click helper. Re-running every
spec file that failed in *either* parallel run with `--workers=1` (serial, no resource
contention) — `settings.spec.ts` (8/8), `employee-workspace.spec.ts` + `notifications.spec.ts`
(13/13) — passed **completely clean**, and live geometry checks in a real browser tab confirmed
the settings nav item and the toast never overlap in the current layout (settings item bottom
edge ~725px, toast top edge ~906-928px at the suite's 1600×1000 viewport). Combined with the
fact that a *different* set of specs failed between the two parallel runs (inconsistent with a
deterministic layout regression, consistent with a timing race), and that `.app-backup-toast`
and the auto-backup notice mechanism it belongs to were not touched by any group in this plan,
this is assessed as **pre-existing flakiness in `openTab` racing the auto-backup toast's timer
under heavy parallel-worker load**, not a regression introduced here. Flagged as a follow-up
(not fixed in this pass): either give `.app-backup-toast` a lower `z-index`/different placement
that can't overlap the sidebar rail, or have `openTab`/the toast's own dismiss button close it
before a click is attempted.

**File:** `src/components/Sidebar/Sidebar.css`

**File:** `src/styles/primitives.css`

**Lines:** 2 files — `Sidebar.css` density-only edits across 7 rules (no net line-count change
beyond the one explanatory comment added to `.sidebar-header`, +9 lines); `primitives.css`
+16/-3 (the `.page-shell` padding-inline value plus an expanded comment explaining the change).

**Migration/rollback:** revert the `padding-inline` value in `primitives.css` and the seven
density declarations in `Sidebar.css` to restore the Group 1/2 baseline exactly; no data,
schema, or markup changed — CSS values only.
