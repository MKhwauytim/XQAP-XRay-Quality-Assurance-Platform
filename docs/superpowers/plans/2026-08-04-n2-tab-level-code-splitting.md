# §N Part 2 — Tab-Level Lazy Boundaries Implementation Plan [DONE — shipped v59.186]

> **STATUS: ✅ DONE.** Shipped v59.186 (commits `2945e079`, `76063ca6`, `d0de7228`, `255bbb5c`, `3ae655c2`) — `ReportDesigner`, `TemplateBuilder`, `Reports`, `ChangeLog`, and `UserManagement` all now thin `React.lazy` shells with a shared `App.tsx` Suspense wrapper, plus the ESLint guard against static imports defeating the split.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the second half of §N (code-splitting) from `docs/superpowers/specs/2026-08-03-distribution-performance-and-workflow-design.md` — defer the JS-evaluation cost of 5 heavy tab subtrees (`ReportDesigner`, `Reports`, `ChangeLog`, `UserManagement`, `TemplateBuilder`) until they're actually rendered, and add an ESLint guard against the exact "stray static import defeats the split" failure mode that Plan 10 (§N Part 1) already hit once in production.

**Architecture: this introduces `React.lazy`/`Suspense` to this codebase for the first time — zero existing precedent exists anywhere.** Each target tab folder's `index.tsx` becomes a thin shell (`tabConfig` export, where applicable, plus `export default lazy(() => import("./TabView"))`); the current heavy component logic moves unchanged into a new `TabView.tsx` in the same folder. `tabRegistry.ts`'s eager glob stays eager (it must, for `tabConfig` metadata) — eagerly importing a thin shell is cheap; the deferral happens at the `lazy()` boundary one level in. Two of the five targets (`ReportDesigner`, `TemplateBuilder`) have no `tabConfig` at all (they're not `SIDEBAR_TABS` entries — they render as sub-views inside `Reports`/`EmployeeWorkspace` respectively) but are STILL eagerly evaluated today because `tabRegistry.ts`'s glob pattern-matches `./*/index.tsx` regardless of `tabConfig` presence; the same thin-shell treatment fixes this for them too.

**Tech Stack:** `React.lazy`, `Suspense` (both already available in `react@^19.2.7`, no new dependency). One new ESLint flat-config rule.

## Global Constraints

- **The exact failure mode that already bit this session once must not repeat here.** Plan 10 (§N Part 1)'s final review found `DeckDesignCustomizer.tsx` had its own static import of `executive/deck2` that silently defeated that plan's entire goal — caught only in a final review, not the task review, not the original plan-writing research. For THIS plan, two such landmines are already known and MUST be fixed as part of the relevant task (not left for a review to catch again):
  1. `src/components/Sidebar/Tabs/Reports/index.tsx:3` — `import ReportDesignerTab from "../ReportDesigner";` (static). Fixed in Task 1.
  2. `src/components/Sidebar/Tabs/EmployeeWorkspace/index.tsx:10` — `import TemplateBuilderTab from "../TemplateBuilder";` (static). **This one is worse than the deck2 landmine** — `employee-workspace` is the landing tab for the `employee` role (the lowest-privilege, highest-volume role), so this single static import currently guarantees `TemplateBuilder`'s full ~1,020-line module graph loads for every session regardless of role, defeating the spec's own "role-gating comes for free" claim. Fixed in Task 2.
- **Test-migration risk, present in every task below:** converting a component's consumer to `React.lazy()` means React suspends on first render until the dynamic `import()` resolves — including in tests. Any existing test that does `render(<X />)` and then immediately asserts with a synchronous `screen.getByText(...)`/`getByRole(...)` (not wrapped in `await waitFor(...)`/`await screen.findBy...`) will very likely need to change to an async assertion, or the test will see the Suspense fallback instead of the real content. **Every task below explicitly requires running that tab's full existing test suite and fixing any test that breaks this way** — this is expected, necessary work for each task, not a sign the task went wrong. Do not work around it by removing `Suspense`/`lazy` at a call site to make tests pass; fix the test's assertion style instead.
- **`SidebarTabModule.default`'s type must be widened explicitly, not left to accidental structural compatibility.** `src/components/Sidebar/Tabs/tabTypes.ts` currently types `default: ComponentType` (and `SidebarTabDefinition.TabComponent: ComponentType`). Once `Reports`/`ChangeLog`/`UserManagement`'s `index.tsx` default-exports a `lazy()`-wrapped component, this needs to be `ComponentType | LazyExoticComponent<ComponentType>` (or equivalent) — done explicitly in Task 3's first sub-step, verified by `npm run typecheck`, not assumed to "just work."
- **No `React.lazy`/`Suspense` precedent exists anywhere in this codebase.** Every task below is establishing this pattern for the first time — follow the plan's exact prescribed shape rather than inventing a per-task variant, so all 5 tabs end up structurally consistent with each other.
- **`check:bundle-size` will not improve** — this is a startup-eval fix, everything still inlines into one HTML file under `vite-plugin-singlefile`. Do not treat a lack of size movement as a sign of failure.
- Follow CLAUDE.md's edit-log requirement for every task (version bump, Before/After, `npm run count-lines -- --quiet` before/after, category prefix).

---

### Task 0: Add the Suspense fallback label and widen `SidebarTabModule`'s type

**Files:**
- Modify: `src/data/labels/labelsStore.ts` (add one new label key)
- Modify: `src/components/Sidebar/Tabs/tabTypes.ts` (widen the type)

**Interfaces:**
- Produces: a new label key (e.g. `app_tab_loading`, follow this file's existing `snake_case`, feature-grouped, aligned-value convention — see the file's existing groups like `// Sidebar`, `// Settings page` for the exact style) with a plain Arabic loading string, no interpolation needed (e.g. `"جارٍ التحميل…"`). Also widens `SidebarTabModule["default"]` and `SidebarTabDefinition["TabComponent"]` from `ComponentType` to `ComponentType | LazyExoticComponent<ComponentType>`.

This is a tiny, foundational task — do it first, alone, before any of the 5 tab-splitting tasks, since all of them depend on both the label and the widened type existing.

- [ ] **Step 1: Add the label**

In `src/data/labels/labelsStore.ts`, add a new grouped entry near the top-level tab-related labels (find the `// Sidebar` group or add a new `// Tab lazy-loading` comment group), following the exact alignment/formatting convention already used in this file:

```ts
// Tab lazy-loading
app_tab_loading: "جارٍ التحميل…",
```

- [ ] **Step 2: Widen the type**

In `src/components/Sidebar/Tabs/tabTypes.ts`, read the file in full first (it's only ~24 lines). Add `import type { ComponentType, LazyExoticComponent } from "react";` if `ComponentType` isn't already imported from `"react"` directly (check its current import source first). Change:

```ts
TabComponent: ComponentType;
```
to:
```ts
TabComponent: ComponentType | LazyExoticComponent<ComponentType>;
```

and:
```ts
export type SidebarTabModule = {
  default: ComponentType;
  tabConfig?: Omit<SidebarTabDefinition, "TabComponent">;
};
```
to:
```ts
export type SidebarTabModule = {
  default: ComponentType | LazyExoticComponent<ComponentType>;
  tabConfig?: Omit<SidebarTabDefinition, "TabComponent">;
};
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: clean (this step alone shouldn't break anything — it's a pure type widening with no runtime change yet; the two test-mock sites that assign plain function components, `src/App.landing.test.tsx` and `src/components/Sidebar/Sidebar.test.tsx`, remain valid since a `FunctionComponent` is assignable to the widened union).

- [ ] **Step 4: Edit log + commit**

```bash
git add src/data/labels/labelsStore.ts src/components/Sidebar/Tabs/tabTypes.ts "docs/edit logs/2026-08-04.md" package.json
git commit -m "Add (labels/tabs): Suspense loading label + widen SidebarTabModule type for lazy tab components"
```

---

### Task 1: Split `ReportDesigner` (do first — already conditionally rendered, pure win)

**Files:**
- Modify: `src/components/Sidebar/Tabs/ReportDesigner/index.tsx` (860 lines → becomes a thin shell)
- Create: `src/components/Sidebar/Tabs/ReportDesigner/TabView.tsx` (receives the current `index.tsx` content, unchanged)
- Modify: `src/components/Sidebar/Tabs/Reports/index.tsx:3,1269-1276` (the static import + the render site — **this is landmine #1's fix**)
- Test: `src/components/Sidebar/Tabs/ReportDesigner/*.test.tsx` and `src/components/Sidebar/Tabs/Reports/index.test.tsx` (both need review/fixes per the test-migration risk in Global Constraints)

**Interfaces:**
- Produces: `ReportDesigner/index.tsx` default-exports `lazy(() => import("./TabView"))`; `TabView.tsx` default-exports exactly what `index.tsx` used to (the full component, all its internal state/handlers unchanged).

**Context:** `ReportDesigner` has no `tabConfig` (not a `SIDEBAR_TABS` entry — CLAUDE.md: "ReportDesigner ... no longer register[s] standalone tabs"), so `index.tsx` today is 100% heavy component logic with `// tabConfig intentionally removed` as its only nod to that fact. It's rendered exactly once, from `Reports/index.tsx`'s `report-designer` sub-tab (already gated by the `visitedReportDesigner` mount-preservation state from this session's earlier Plan 4 — that gating logic is UNRELATED to and unaffected by this task, it stays exactly as-is).

- [ ] **Step 1: Move the component**

`git mv src/components/Sidebar/Tabs/ReportDesigner/index.tsx src/components/Sidebar/Tabs/ReportDesigner/TabView.tsx` — this preserves file history. Do NOT change anything inside the moved file's content in this step (imports, component logic, exports all stay byte-identical) — only the file's path/name changes.

- [ ] **Step 2: Create the new thin `index.tsx`**

```tsx
import { lazy } from "react";

export default lazy(() => import("./TabView"));
```

- [ ] **Step 3: Fix landmine #1 — `Reports/index.tsx`'s static import + add a Suspense boundary at the render site**

Read `Reports/index.tsx:1240-1280` (the `visitedReportDesigner` gate and the `<ReportDesignerTab />` render, per this session's own earlier work) once more directly to get exact current line numbers before editing.

Change the import (currently line 3):
```tsx
import ReportDesignerTab from "../ReportDesigner";
```
to a lazy import:
```tsx
import { lazy, Suspense } from "react"; // add `lazy, Suspense` to this file's existing "react" import if one already exists — do not create a duplicate import statement
const ReportDesignerTab = lazy(() => import("../ReportDesigner"));
```

(Since `ReportDesigner/index.tsx` itself is now already `lazy(() => import("./TabView"))`, wrapping it in ANOTHER `lazy()` here would be redundant/wasteful — instead, since `ReportDesigner`'s default export is now the `lazy()`-wrapped component, `Reports/index.tsx` should simply import it normally: `import ReportDesignerTab from "../ReportDesigner";` stays exactly as it is, no `lazy()` needed at THIS call site, since `ReportDesigner/index.tsx` already IS the lazy component. Re-read this reasoning against Task 1 Step 2's actual output before implementing — the fix here is NOT to double-wrap, it's that the import is now cheap because what it imports (`ReportDesigner/index.tsx`, the thin shell) is cheap; the import itself can and should stay a plain static `import ReportDesignerTab from "../ReportDesigner";`. What DOES need to change at this call site is wrapping the render in `<Suspense>`, since `ReportDesignerTab` is now a lazy component and React requires a Suspense ancestor.)

At the render site (currently around line 1264-1268, inside the `visitedReportDesigner &&` block per this session's earlier mount-preservation work):
```tsx
        <ReportDesignerTab />
```
becomes:
```tsx
        <Suspense fallback={<LoadingState label={labels.app_tab_loading} />}>
          <ReportDesignerTab />
        </Suspense>
```
(Import `LoadingState` from `../../../StateViews/StateViews` if not already imported in this file — check first; adjust the relative path to this file's actual depth. Use whatever this file's existing `labels`/`useLabels()` variable is named — check the file's current usage.)

- [ ] **Step 4: Run the tests, fix any that broke on the Suspense boundary**

Run: `npx vitest run src/components/Sidebar/Tabs/ReportDesigner/`
Expected: any test that directly renders the (now-lazy) default export needs its assertions wrapped in `await waitFor(...)` or converted to `await screen.findBy...` — fix each one you find broken this way. Do not disable/skip any test.

Run: `npx vitest run src/components/Sidebar/Tabs/Reports/index.test.tsx`
Expected: the existing `"Reports sub-tab mount preservation (§T)"` describe block (from this session's earlier Plan 4 work) specifically exercises switching to `report-designer` and asserting on its content — this is the highest-risk existing test for this task, since it will now hit the Suspense boundary. Fix its assertions to await resolution before checking for the rendered content, while preserving what it was actually testing (that switching away and back doesn't remount — this property must still hold and still be verified, just with async-aware assertions).

Then the whole suite, typecheck, lint:
Run: `npm run test:run && npm run typecheck && npm run lint:ci`
Expected: all clean.

- [ ] **Step 5: Manual smoke-check (no automated equivalent exists for "did it actually defer")**

Run `npm run build` to confirm the build still succeeds. A full startup-eval timing measurement requires a manual DevTools profile per the source spec's own guidance — note in your report that this was not automated, consistent with how Plan 10 handled the same limitation.

- [ ] **Step 6: Edit log + commit**

```bash
git add src/components/Sidebar/Tabs/ReportDesigner/index.tsx src/components/Sidebar/Tabs/ReportDesigner/TabView.tsx src/components/Sidebar/Tabs/Reports/index.tsx src/components/Sidebar/Tabs/Reports/index.test.tsx "docs/edit logs/2026-08-04.md" package.json
git commit -m "Change (report-designer): lazy tab-level boundary, fix Reports' static import landmine"
```

(Add any other `ReportDesigner/` test files you had to touch in Step 4 to this same `git add`.)

---

### Task 2: Split `TemplateBuilder` (fixes the highest-severity landmine — every employee session pays this cost today)

**Files:**
- Modify: `src/components/Sidebar/Tabs/TemplateBuilder/index.tsx` (1,020 lines → thin shell)
- Create: `src/components/Sidebar/Tabs/TemplateBuilder/TabView.tsx`
- Modify: `src/components/Sidebar/Tabs/EmployeeWorkspace/index.tsx:10,100-146` (the render site — **this is landmine #2's fix**)
- Test: `src/components/Sidebar/Tabs/TemplateBuilder/*.test.tsx` and `src/components/Sidebar/Tabs/EmployeeWorkspace/index.test.tsx` (both need review/fixes per the test-migration risk)

**Interfaces:** same shape as Task 1.

**Context:** `TemplateBuilder` also has no `tabConfig` — it renders as `EmployeeWorkspace`'s `ew/inspection-form` sub-tab. `EmployeeWorkspace/index.tsx:10`'s static import means `TemplateBuilder`'s full ~1,020-line monolithic file (list view, editor, field editor, schema normalization, all in one file per the research) is eagerly evaluated for every session of every role, since `employee-workspace` is the landing tab for `employee` sessions specifically (`App.tsx`'s default-tab logic picks it for that role) and reachable by every other role too.

- [ ] **Step 1: Move the component**

`git mv src/components/Sidebar/Tabs/TemplateBuilder/index.tsx src/components/Sidebar/Tabs/TemplateBuilder/TabView.tsx`, content unchanged.

- [ ] **Step 2: Create the new thin `index.tsx`**

Same shape as Task 1 Step 2:
```tsx
import { lazy } from "react";

export default lazy(() => import("./TabView"));
```

- [ ] **Step 3: Fix landmine #2 — add a Suspense boundary at `EmployeeWorkspace/index.tsx`'s render site**

Read `EmployeeWorkspace/index.tsx:1-150` in full first (get exact current line numbers — research cites the import at line 10, the `useMemo(() => <TemplateBuilderTab />, [])` at line 105, and the conditional render at lines 144-146).

The import (`import TemplateBuilderTab from "../TemplateBuilder";`) stays a plain static import — same reasoning as Task 1 Step 3 (the thing being imported is now cheap, since it's the thin shell).

Wrap the render site in `<Suspense>`. Note this file already wraps the render in a `useMemo(() => <TemplateBuilderTab />, [])` — the `Suspense` boundary needs to wrap wherever that memoized element is actually RENDERED (i.e. around line 144-146's conditional output), not inside the `useMemo` callback itself (a `useMemo` returning JSX and a `Suspense` boundary around where that JSX is placed in the tree are two different things — get this right by reading the actual current render structure, not just the memo declaration).

Import `Suspense` and `LoadingState` (or this file's equivalent) the same way as Task 1 Step 3.

- [ ] **Step 4: Run the tests, fix any that broke on the Suspense boundary**

Run: `npx vitest run src/components/Sidebar/Tabs/TemplateBuilder/`
Fix any broken synchronous assertions per Global Constraints.

Run: `npx vitest run src/components/Sidebar/Tabs/EmployeeWorkspace/index.test.tsx`
Expected: this session's earlier Plan 4 work added sub-tab mount preservation for all 4 `EmployeeWorkspace` sub-tabs including `ew/inspection-form` — same category of risk as Task 1's Reports mount-preservation test. Fix assertions to be async-aware while preserving what they verify.

Then the whole suite, typecheck, lint:
Run: `npm run test:run && npm run typecheck && npm run lint:ci`
Expected: clean.

- [ ] **Step 5: `npm run build` sanity check**

Same as Task 1 Step 5.

- [ ] **Step 6: Edit log + commit**

```bash
git add src/components/Sidebar/Tabs/TemplateBuilder/index.tsx src/components/Sidebar/Tabs/TemplateBuilder/TabView.tsx src/components/Sidebar/Tabs/EmployeeWorkspace/index.tsx src/components/Sidebar/Tabs/EmployeeWorkspace/index.test.tsx "docs/edit logs/2026-08-04.md" package.json
git commit -m "Change (template-builder): lazy tab-level boundary, fix EmployeeWorkspace's static import landmine (every-role landing tab)"
```

---

### Task 3: Split `Reports`, `ChangeLog`, `UserManagement` + the shared `App.tsx` Suspense boundary

**Files:**
- Modify: `src/components/Sidebar/Tabs/Reports/index.tsx` (1,288 lines → thin shell; note this file was ALREADY modified by Task 1 in this same plan — this task's split happens on top of that)
- Create: `src/components/Sidebar/Tabs/Reports/TabView.tsx`
- Modify: `src/components/Sidebar/Tabs/ChangeLog/index.tsx` (405 lines → thin shell)
- Create: `src/components/Sidebar/Tabs/ChangeLog/TabView.tsx`
- Modify: `src/components/Sidebar/Tabs/UserManagement/index.tsx` (665 lines → thin shell)
- Create: `src/components/Sidebar/Tabs/UserManagement/TabView.tsx`
- Modify: `src/App.tsx:281-296` (the shared per-tab Suspense boundary)
- Test: each of the 3 tabs' own test suites, plus `src/App.landing.test.tsx` (verify this ambient/other-session test file's own tab-mount assertions still hold — read it first, do not assume; if it's still uncommitted ambient work at implementation time, treat it exactly per this session's established policy: verify it stays green, never modify it)

**Interfaces:** same split shape as Tasks 1-2, EXCEPT these 3 DO have `tabConfig` — `index.tsx` keeps the `tabConfig` export (a plain object, no lazy-loading concern — it must stay eagerly available since `tabRegistry.ts`'s `hasTabConfig` filter and `SIDEBAR_TABS`'s role/sort logic run on it synchronously at eager-glob time) alongside the lazy-wrapped default export.

**Context:** Unlike Tasks 1-2, these 3 tabs flow through `tabRegistry.ts` → `App.tsx`'s generic `<tab.TabComponent />` rendering (no per-tab call site to fix — the landmine-hunt in this plan's research found ZERO external static importers of these 3 beyond the registry's own glob, which is expected/unavoidable). The Suspense boundary therefore goes in ONE shared place, `App.tsx`, not 3 separate call sites.

- [ ] **Step 1: Split `Reports`**

`git mv src/components/Sidebar/Tabs/Reports/index.tsx src/components/Sidebar/Tabs/Reports/TabView.tsx` (this moves the version already modified by Task 1 in this same plan — if Task 1 hasn't landed yet when this task runs, see Task Order below; this task assumes Task 1's `ReportDesigner` split already landed in `Reports/index.tsx`'s content).

New `src/components/Sidebar/Tabs/Reports/index.tsx`:
```tsx
import { lazy } from "react";
import { tabAllowedRoles } from "../../../../auth/tabCatalog";
import type { SidebarTabModule } from "../tabTypes";

export const tabConfig: SidebarTabModule["tabConfig"] = {
  id: "reports",
  label: "التقارير",
  order: 25,
  allowedRoles: tabAllowedRoles("reports"),
  // ...copy the REST of the current tabConfig object's fields exactly as they
  // are today (icon, subTabs, etc.) — read TabView.tsx's own tabConfig export
  // (now relocated there) for the exact current values before writing this,
  // do not guess at fields not shown in this excerpt.
};

export default lazy(() => import("./TabView"));
```

**Important:** `tabConfig`'s exact current shape (all its fields — the plan does not have every field memorized, e.g. `icon`, `subTabs`) must be copied VERBATIM from the version that's about to move into `TabView.tsx` — do not paraphrase or reconstruct it from memory of what tabConfig objects generally look like in this codebase; copy-paste the real object, then delete it from `TabView.tsx` (it should exist in exactly one place — the new thin `index.tsx` — after this step, not in both files).

- [ ] **Step 2: Split `ChangeLog`**

Same pattern: `git mv src/components/Sidebar/Tabs/ChangeLog/index.tsx src/components/Sidebar/Tabs/ChangeLog/TabView.tsx`, new thin `index.tsx` with `tabConfig` (copied verbatim from the current file, currently at lines 13-19 per the research) + `export default lazy(() => import("./TabView"));`.

- [ ] **Step 3: Split `UserManagement`**

Same pattern: `git mv src/components/Sidebar/Tabs/UserManagement/index.tsx src/components/Sidebar/Tabs/UserManagement/TabView.tsx`, new thin `index.tsx` with `tabConfig` (copied verbatim, currently at lines 63-76 per the research) + `export default lazy(() => import("./TabView"));`.

**Note:** `UserManagement/index.tsx` also currently exports `coalesceToLatest` (a standalone, independently-unit-tested helper function, per this session's own earlier work — check `index.test.ts`'s `describe("coalesceToLatest", ...)` block). This helper has NOTHING to do with the tab component itself — decide during implementation whether to (a) move it into `TabView.tsx` alongside the component that uses it, keeping `index.tsx` a pure thin shell, or (b) extract it to its own small module both `index.tsx`... no, `index.tsx` won't need it if it moves to `TabView.tsx`'s implementation — the only reason it would need to stay reachable from `index.tsx` is if something OUTSIDE this tab folder imports `coalesceToLatest` directly from `UserManagement/index.tsx` (check `index.test.ts`'s import path for this — if it imports from `"./index"` today, decide whether the test should be updated to import from `"./TabView"` instead, since that's genuinely where the function will live after this split). Prefer (a) — move it to `TabView.tsx` with its consumer, update the test's import path — over inventing a 3rd file for one helper function.

- [ ] **Step 4: Add the shared `Suspense` boundary in `App.tsx`**

Read `App.tsx:281-296` (per the research, the `allowedTabs.map(...)` block wrapping `<ErrorBoundary><tab.TabComponent /></ErrorBoundary>`) once more directly before editing.

```tsx
{allowedTabs.map((tab) =>
  mountedTabIds.includes(tab.id) ? (
    <div
      key={tab.id}
      hidden={tab.id !== activeTabId}
      aria-hidden={tab.id !== activeTabId}
    >
      <ErrorBoundary>
        <tab.TabComponent />
      </ErrorBoundary>
    </div>
  ) : null
)}
```
becomes:
```tsx
{allowedTabs.map((tab) =>
  mountedTabIds.includes(tab.id) ? (
    <div
      key={tab.id}
      hidden={tab.id !== activeTabId}
      aria-hidden={tab.id !== activeTabId}
    >
      <ErrorBoundary>
        <Suspense fallback={<LoadingState label={labels.app_tab_loading} />}>
          <tab.TabComponent />
        </Suspense>
      </ErrorBoundary>
    </div>
  ) : null
)}
```

Note: `mountedTabIds` can hold up to 3 tabs at once (the top-level LRU) — this `Suspense` boundary is created fresh per `tab.id` inside the `.map()`, so each mounted tab gets its OWN independent Suspense boundary (one tab's pending lazy-load can never blank an already-loaded sibling tab that's also currently mounted-hidden). Verify this is really true once implemented (it should be, by React's per-element Suspense semantics, but confirm via a test in Step 5 rather than assuming).

Add `Suspense` to this file's existing `"react"` import, and `LoadingState` from wherever `App.tsx` already imports shared state-view components (check first — it may already import `EmptyState` from `StateViews` per the `NoAvailableTabs` helper in this same file, in which case add `LoadingState` to that same import line rather than creating a new one). Confirm `labels`/`useLabels()` is already available in whatever component-scope this JSX sits in (it should be, since `NoAvailableTabs` in the same file already uses `useLabels()` — verify the JSX block being edited is inside the SAME component instance that has that hook call, not a different one).

- [ ] **Step 5: Run the tests, fix any that broke on the Suspense boundary — this is the highest-blast-radius step in this whole plan**

This is the one place a single Suspense boundary now sits in front of THREE different tabs' content, plus interacts with the existing `mountedTabIds` LRU logic and the existing `visitedSubTabs`-style sub-tab mount preservation each of these tabs already has from earlier plans this session. Run, in this order, fixing breakage as you go rather than batching all fixes to the end (so a later fix doesn't mask an earlier regression):

1. `npx vitest run src/components/Sidebar/Tabs/Reports/`
2. `npx vitest run src/components/Sidebar/Tabs/ChangeLog/`
3. `npx vitest run src/components/Sidebar/Tabs/UserManagement/`
4. `npx vitest run src/App.landing.test.tsx` — per this session's established ambient-work policy, if this file is still someone else's uncommitted work at implementation time, do not modify it; if it breaks, investigate whether the breakage is a real regression from THIS task's change (in which case find a way to satisfy it without touching the file, e.g. by confirming your `Suspense` fallback + the LRU's existing `hidden` attribute compose correctly) versus an unrelated pre-existing issue (in which case document it, don't fix someone else's file).
5. `npm run test:run` (whole suite) to catch anything not covered by the 4 targeted runs above.

Then typecheck and lint:
Run: `npm run typecheck && npm run lint:ci`
Expected: clean.

- [ ] **Step 6: `npm run build` sanity check**

Same as prior tasks.

- [ ] **Step 7: Edit log + commit**

```bash
git add src/components/Sidebar/Tabs/Reports/index.tsx src/components/Sidebar/Tabs/Reports/TabView.tsx src/components/Sidebar/Tabs/ChangeLog/index.tsx src/components/Sidebar/Tabs/ChangeLog/TabView.tsx src/components/Sidebar/Tabs/UserManagement/index.tsx src/components/Sidebar/Tabs/UserManagement/TabView.tsx src/App.tsx "docs/edit logs/2026-08-04.md" package.json
git commit -m "Change (reports/changelog/user-management): lazy tab-level boundaries + shared App.tsx Suspense wrapper"
```

(Add any test files touched in Step 5, and `UserManagement/index.test.ts` if its `coalesceToLatest` import path changed per Step 3.)

---

### Task 4: ESLint guard against a stray static import defeating any of the 5 splits

**Files:**
- Modify: `eslint.config.js`
- Test: manual verification (an ESLint rule addition isn't unit-tested the way application code is — verify via Step 2 below instead)

**Interfaces:** none — this is tooling configuration, not application code.

**Context:** This is the exact safety net that would have caught Plan 10's `DeckDesignCustomizer.tsx` landmine automatically, and would catch a future regression on any of this plan's 5 new lazy boundaries. `eslint.config.js` is a flat config with a single `files: ['**/*.{ts,tsx}']` block and one existing `rules` entry — there's no existing precedent for per-directory rule scoping in this file, so this task introduces that structure.

- [ ] **Step 1: Add the rule**

Read `eslint.config.js` in full first (only ~26 lines, already quoted in this plan's research). Add a `no-restricted-imports` rule, scoped so each of the 5 tab subtrees can import its OWN sibling files freely but nothing OUTSIDE that subtree can statically import them. The flat-config way to do this is a second config-array entry with its own `files`/`ignores`:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    ignores: [
      'src/components/Sidebar/Tabs/ReportDesigner/**',
      'src/components/Sidebar/Tabs/Reports/**',
      'src/components/Sidebar/Tabs/ChangeLog/**',
      'src/components/Sidebar/Tabs/UserManagement/**',
      'src/components/Sidebar/Tabs/TemplateBuilder/**',
      'src/components/Sidebar/Tabs/tabRegistry.ts',
    ],
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', {
        patterns: [
          { group: ['**/Tabs/ReportDesigner', '**/Tabs/ReportDesigner/*'], message: 'ReportDesigner is a lazy boundary (§N) — import its default export (already lazy) from "../ReportDesigner" only, never a specific internal file, and never from outside Reports/.' },
          { group: ['**/Tabs/Reports', '**/Tabs/Reports/*'], message: 'Reports is a lazy tab boundary (§N) — static imports from outside tabRegistry.ts silently defeat the split.' },
          { group: ['**/Tabs/ChangeLog', '**/Tabs/ChangeLog/*'], message: 'ChangeLog is a lazy tab boundary (§N) — static imports from outside tabRegistry.ts silently defeat the split.' },
          { group: ['**/Tabs/UserManagement', '**/Tabs/UserManagement/*'], message: 'UserManagement is a lazy tab boundary (§N) — static imports from outside tabRegistry.ts silently defeat the split.' },
          { group: ['**/Tabs/TemplateBuilder', '**/Tabs/TemplateBuilder/*'], message: 'TemplateBuilder is a lazy boundary (§N) — import its default export (already lazy) from "../TemplateBuilder" only, never a specific internal file, and never from outside EmployeeWorkspace/.' },
        ],
      }],
    },
  },
]);
```

(Verify `@typescript-eslint/no-restricted-imports` is the correct rule ID for this project's `typescript-eslint` version — check whether the plain ESLint core `no-restricted-imports` is what's actually needed instead, since this project's config extends `tseslint.configs.recommended` but the existing single rule entry, `@typescript-eslint/no-unused-vars`, does use the `@typescript-eslint/` prefix, suggesting the TS-aware variant is the established convention here too — confirm by checking which one `eslint --print-config` reports as active, or simply try both and see which the linter actually recognizes without an "unknown rule" warning.)

The `ignores` list on the second config block means files INSIDE each tab's own folder (and `tabRegistry.ts` itself) are exempt from restricting imports of themselves — a file inside `ReportDesigner/` importing its own sibling `TabView.tsx` or `editor/Canvas.tsx` must stay completely unrestricted; only imports from OUTSIDE each listed folder are restricted from reaching INTO it. Double-check this `ignores`-based scoping actually produces that effect (files matched by `ignores` are excluded from having this second block's rules applied to them at all) rather than the opposite — if the semantics don't work as needed, adjust to whatever *does* correctly express "restrict imports of X from anywhere except X's own subtree and the registry," even if that means a different config shape than sketched above.

- [ ] **Step 2: Verify the rule actually fires**

Temporarily (in a scratch, uncommitted change — never actually commit this) add a throwaway static import of e.g. `"../ReportDesigner"` into some unrelated file (e.g. a comment-only test edit in `App.tsx`, reverted immediately after this check) and run `npm run lint:ci` — confirm the new rule produces an error citing that import. Revert the scratch change completely before moving on (`git diff` must show nothing from this verification step in your final commit).

Then run `npm run lint:ci` for real (no scratch changes) against the actual current, clean codebase (post Tasks 0-3) and confirm it's clean — proving the rule doesn't have false positives against the legitimate internal imports Tasks 1-3 already put in place (e.g. `ReportDesigner/index.tsx`'s own `import("./TabView")`, which is a dynamic import inside the SAME folder the rule ignores, so it must not trigger).

- [ ] **Step 3: Confirm `src/dev/deckPreview.ts` stays outside the production graph**

Already independently verified true by this plan's own research (no `rollupOptions.input` override in `vite.config.ts`, `deck-preview.html` unreferenced by `index.html`/`main.tsx`, absent from `dist/` after a real build) — re-confirm with a fresh `npm run build` and check `dist/` contains only `index.html`, nothing else, as a final sanity check for this whole plan (not just this task).

- [ ] **Step 4: Edit log + commit**

```bash
git add eslint.config.js "docs/edit logs/2026-08-04.md" package.json
git commit -m "Add (lint): no-restricted-imports guard against static imports defeating §N's lazy tab boundaries"
```

---

## Task Order

**Task 0 first, alone** (both later tasks depend on its label + type widening).

**Tasks 1 and 2 may run in parallel with each other** (Task 1: `ReportDesigner/`, `Reports/index.tsx` — Task 2: `TemplateBuilder/`, `EmployeeWorkspace/index.tsx` — genuinely disjoint file sets), using this session's established parallel-implementer protocol.

**Task 3 must run after Task 1 lands** (it moves `Reports/index.tsx` into `TabView.tsx`, and assumes Task 1's edits to that file — the `ReportDesignerTab` import/Suspense wrapping — are already present in the version being moved). Task 3 does NOT depend on Task 2.

**Task 4 must run last**, after Tasks 0-3 have all landed (it references all 5 tab folders' final post-split structure in its `ignores` list, and its verification step needs the real, final import graph to check against).
