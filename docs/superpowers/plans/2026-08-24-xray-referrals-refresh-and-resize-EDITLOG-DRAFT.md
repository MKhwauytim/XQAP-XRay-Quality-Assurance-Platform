# Edit-log draft — xray-referrals-refresh-and-resize plan (2026-08-24)

> Standalone draft, NOT written into `docs/edit logs/2026-08-24.md` — that file is shared
> across several concurrent agent sessions in this worktree and is being merged/versioned
> by the coordinator. This draft carries the prose for all three commits this plan produced,
> in the format CLAUDE.md's edit-log requirement expects, ready to fold in. Versions are left
> as `vX.Y` placeholders — the coordinator assigns the real numbers when merging, chained off
> whatever `package.json` / the edit log actually holds at that point.

---

## vX.Y — 2026-08-24 — Fix (xray-referrals): announce a submitted answer on the data-refresh signal

**Why:** `createSaveAnswerHandler` wrote the answer, updated local state and said «تم التقديم.» — and never announced the write on `dataRefreshSignal`. Every other mounted view of the same data (the approval desk, «نتائج فحص الأشعة», Reports, another sub-tab kept alive by the tab-mount LRU) kept showing pre-submit state until the 45 s sync tick or the manual refresh button came round. Every sibling mutating flow on this screen already announces itself; this one path did not.

**What changed:** Added one `notifyLocalDataChange(["answers"])` call in `createSaveAnswerHandler`'s success branch (`XrayReferrals.tsx`), guarded by a new required `ownBroadcastRef: React.RefObject<boolean>` field on its `deps` — the same own-broadcast idiom `useApprovalData.ts`'s `ownDecisionBroadcastRef` already uses — so the view's own `subscribeToDataRefresh` effect skips re-reading a write it has already reconciled locally via `setAnswers`. The effect itself was rewritten from a bare `subscribeToDataRefresh(() => loadData({silent:true}))` into an explicit lambda that checks a new `ownAnswerBroadcastRef` first. `"answers"` and nothing else: submitting an answer writes one `{user}.answers.json` and appends to the action log — it appends no distribution event and files no request, so a wider change set would only make unrelated views re-read for nothing.

**Before:**
```ts
        setAnswers((prev) => [
          ...prev.filter((a) => !(a.xrayImageId === xrayImageId && a.answeredBy === forUser)),
          item,
        ]);
        setStatusMsg({ type: "ok", text: "تم التقديم." });
```

**After:**
```ts
        setAnswers((prev) => [
          ...prev.filter((a) => !(a.xrayImageId === xrayImageId && a.answeredBy === forUser)),
          item,
        ]);
        setStatusMsg({ type: "ok", text: "تم التقديم." });
        ownBroadcastRef.current = true;
        try {
          notifyLocalDataChange(["answers"]);
        } finally {
          ownBroadcastRef.current = false;
        }
```

**File:** `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx`

**File:** `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.saveBroadcast.test.tsx (new)`

**Verification:** `npx vitest run` on the new test file plus the whole `views/` directory — all green (see the combined verification note on the next entry, which also carries a required follow-up fix to this commit's own code). Confirmed live in a real Chromium browser against a writable simulated workspace (`?sim=1&role=employee`): a `window.addEventListener("xray-data-refresh", ...)` probe captured exactly one event, `{source: "periodic", changed: ["answers"]}`, on submit — no more, no fewer.

**Lines:** 2 files, +284 / -0 (net; commit also carried `docs/edit logs/2026-08-24.md` and `package.json` housekeeping from the shared-file editlog tool, excluded from this count since this plan no longer touches those files directly)

**Commit:** `a8b92a74` — "Fix (xray-referrals): announce a submitted answer on the data-refresh signal"

---

## vX.Y — 2026-08-24 — Fix (xray-referrals): clear the unsaved-draft flag on submit; satisfy react-hooks/refs

**Why:** Two issues found and fixed together because both live inside the same `if (result.ok)` success branch touched by the previous entry.

1. `dirtyEntryId` is set by `onDraftDirty` when the employee types into the panel and was cleared in exactly three places (`selectEntry`, `loadData`'s non-silent branch, the no-month reset effect) — but a successful submit cleared it nowhere. So after submitting and staying on the same row, `useVisibleUnsavedWorkMonthGuard` still reported unsaved work, and switching the global month raised «إجابات غير محفوظة» about an answer that was already on disk. A prompt that fires when nothing is at stake is how a real one gets clicked through.
2. Passing `ownBroadcastRef` (added by the previous entry) into the module-level `createSaveAnswerHandler(...)` factory during render tripped `react-hooks/refs` ("Passing a ref to a function may read its value during render") once `npm run lint` actually ran against it — a real error, not a false positive, and this repo already has an established fix for exactly this shape one call below (`createReopenHandlers`'s own `// eslint-disable-next-line react-hooks/refs` at its call site): the ref is read only inside the async `handleSave` this factory returns — an event-handler call chain, never during render — so the disable is correct, not a workaround. A separate TS2352 (unsafe cast) and one unused `describe` import, both introduced by the previous entry's own test file and `QueueSplitResizer.test.tsx`, were fixed alongside since `npm run typecheck`/`lint` are both mandatory gates.

**What changed:** `createSaveAnswerHandler`'s `deps` gains `setDirtyEntryId: (id: string | null) => void`; the success branch calls `setDirtyEntryId(null)` immediately after `setAnswers(...)` and before `setStatusMsg(...)`. Added a mirror-image test to `XrayReferrals.monthChangeGuard.test.tsx`: type into the panel, submit, then assert the month-switch guard no longer fires (the sibling test above it asserts the opposite — that it DOES fire before a submit). Added the `eslint-disable-next-line react-hooks/refs` comment at the `handleSave = createSaveAnswerHandler({...})` call site, with a comment explaining why. Fixed `XrayReferrals.saveBroadcast.test.tsx`'s `expect([...(seen[0] as {changed: Set<string>}).changed])` (an unsound cast TypeScript correctly rejected — `ReadonlySet<DataRefreshFamily>` is not `Set<string>`) into a proper discriminated-union narrow on `detail.source === "periodic"`. Removed the unused `describe` import from `QueueSplitResizer.test.tsx` (that file has no `describe` wrapper, matching the plan's own example).

**Before:**
```ts
        setAnswers((prev) => [
          ...prev.filter((a) => !(a.xrayImageId === xrayImageId && a.answeredBy === forUser)),
          item,
        ]);
        setStatusMsg({ type: "ok", text: "تم التقديم." });
```

**After:**
```ts
        setAnswers((prev) => [
          ...prev.filter((a) => !(a.xrayImageId === xrayImageId && a.answeredBy === forUser)),
          item,
        ]);
        setDirtyEntryId(null);
        setStatusMsg({ type: "ok", text: "تم التقديم." });
```

**File:** `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx`

**File:** `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.monthChangeGuard.test.tsx`

**File:** `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.saveBroadcast.test.tsx`

**Verification:**
- `npx vitest run` on `XrayReferrals.saveBroadcast.test.tsx`, `XrayReferrals.monthChangeGuard.test.tsx`, `QueueSplitResizer.test.tsx`, `queueSplitStore.test.ts`, and the whole `views/` + `views/XrayReferrals/` directories: **234/234 tests green** (32 files).
- `npm run typecheck` (`tsc -b`, whole repo): **clean, 0 errors.**
- Scoped `eslint` over every file this plan touched: **clean, 0 problems** (confirmed react-hooks/refs no longer fires).
- `check:complexity`-equivalent scoped check: `XrayReferrals.tsx`'s default export is **1434 of 1450** lines against the real configured `max-lines-per-function` budget in `package.json`'s `check:complexity` script (the plan's own doc used an illustrative 1400 for its budget arithmetic; the actual enforced ceiling is 1450) — 16 lines of headroom remain.
- `check:hex-literals`: OK, no swept file (including this plan's CSS) exceeds its baseline.
- Real-browser (Chromium, `?sim=1&role=employee` writable simulated workspace): typed an unsaved draft into a second row, then clicked the real AdminToolbar "تحديث كل البيانات" refresh button (`{source:"manual"}` confirmed via the same event probe) — the draft text was still in the textarea afterward, confirming the pre-existing draft-retention logic is untouched by this change. No console errors, no `errorLogger` entries attributable to this change (the only entries present were pre-existing read-only-mode writes from browsing the earlier viewer/demo session, unrelated).

**Lines:** 3 files, +34 / -4

**Commit:** `810de071` — "Fix (xray-referrals): clear the unsaved-draft flag on submit; satisfy react-hooks/refs; type-safe broadcast test"

---

## vX.0 — 2026-08-24 — Add (xray-referrals): a draggable, persisted split between the queue and the inspection panel

**Tier-3 justification (per the plan):** a new UI component, a new persisted browser-storage key registered in `storageRegistry.ts`, new label keys, and a layout change to the CSS of the app's highest-traffic screen.

**Why:** The queue/panel two-column grid on «صور الأشعة المحالة» was fixed at `1.15fr / 1fr`. The owner's "nothing scales correctly" report on this page turned out, on investigation, to be a request for a draggable divider rather than a UI-scale defect — the page's `--ui-scale`/`--app-vh`/`--ui-table-height-scale` wiring was already correct.

**What changed:**
- **`src/data/preferences/queueSplitStore.ts` (new)** — a `localStorage`-backed ratio store (`xray_queue_split_v1`), structurally mirroring `uiScaleStore.ts`: `clamp`/`sanitize`/`persist`/`notify`, "remove the key at the default rather than storing it," a module-level cache with a test-only reset hook. Bounds `[0.25, 0.75]`; default `0.5349` (= 1.15 ÷ 2.15, the ratio the old fixed grid always rendered). No `applyToDocument` equivalent — unlike UI scale, this property belongs to one element on one screen, and the component applies it directly.
- **`src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals/QueueSplitResizer.tsx` (new)** — the draggable handle, rendered as the first child of `.ew-xr-panel-col`, absolutely positioned into the 14px gutter (`inset-inline-start: -14px`) rather than a grid child, so no grid placement rule changes. Live drag writes `--ew-xr-queue-basis` straight onto the `.ew-xr-grid` element via `setProperty` (no React state in the hot path — a 60 Hz pointer stream through this ~1400-line component's state would re-render the whole queue every frame); the store is written exactly once, on `pointerup`. RTL/LTR is read from `getComputedStyle(grid).direction` at drag time, not hard-coded — in RTL, dragging left widens the (right-hand) queue. A `clampToLayout` helper mirrors the CSS's own two pixel floors (`minmax(340px,…)` / `minmax(430px,…)`) so the handle stops exactly where the layout stops. Keyboard-operable (`role="separator"`, `ArrowLeft`/`ArrowRight` nudge ±2 points in pointer-space direction, `Home` and double-click both reset).
- **`src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals/XrayReferrals.css`** — the queue track changed from `minmax(340px, 1.15fr)` to `minmax(340px, var(--ew-xr-queue-basis, 53.49%))` (a custom property cannot produce an `fr`), `.ew-xr-panel-col` gained `position: relative`, a new `.ew-xr-split-handle` block (absolute, 14px hit area, a 2px visible rule centred in the gutter, hover/focus-visible states using `--c-border`/`--c-navy` tokens only), and the handle is `display: none` inside the existing `@media (max-width: 1100px)` stacked-layout block.
- **`src/data/labels/labelsStore.ts`** — three new keys (`ew_queue_split_handle_aria`, `ew_queue_split_handle_title`, `ew_queue_split_reset_announce`) beside the existing `ew_queue_scope_*` keys.
- **`src/data/storage/storageRegistry.ts`** — one new `STORAGE_REGISTRY` entry for `xray_queue_split_v1`, sibling to `xray_ui_scale_v1` (per-machine display preference, same layer/lifetime).
- **`XrayReferrals.tsx`** — one import, one JSX line (`<QueueSplitResizer />` as the first child of `.ew-xr-panel-col`, outside the `panelEntry ? … : …` ternary so the divider is draggable whether or not a sample is open).

**Deviations from the plan's literal test numbers** (both required to make the test suite internally consistent — see the comment block at the top of `QueueSplitResizer.test.tsx` for the full reasoning):
1. The plan's "RTL: dragging LEFT widens the queue column" test targeted `clientX 500` (→ queue 600/1000 = 60%), which is past the 55.6% ceiling the SAME fixture's own pixel floors enforce (and which the plan's own very next test pins at two other points) — retargeted to `clientX 550` (→ 55%), which still demonstrates widening (above the 53.49% default) and stays inside the enforced range.
2. The plan's `onPointerDown` guard was specified as `handleRef.current.offsetParent === null` to detect the stacked/hidden state. Verified against jsdom directly: `offsetParent` is permanently `null` under jsdom regardless of visibility (jsdom runs no layout), which would fail every drag test before it could start. Substituted `getComputedStyle(handle).display === "none"` — correct in a real browser (confirmed live, see below) and correct in the test fixture (which never applies the stacking media query).

**Design decisions preserved exactly as specified by the plan** (percentage basis not `fr`; absolutely-positioned handle in the gutter, not a grid child; RTL read from `getComputedStyle`, not hard-coded; live-drag writes DOM only, persists on `pointerup`; Pointer Events with capture, guarded for jsdom's missing `setPointerCapture`; keyboard + reset).

**Migration/rollback:**
- **Migration:** none required. `xray_queue_split_v1` is absent on every existing install, and the CSS fallback (`53.49%`) reproduces the previous `1.15fr / 1fr` proportion, so an untouched workspace renders exactly as before.
- **Rollback:** revert the commit. The orphaned `localStorage` key is inert (nothing reads it) and can be cleared from the Settings storage panel; remove its `STORAGE_REGISTRY` entry as part of any revert, or `clearOwnedStorage` keeps claiming a key nothing owns.

**File:** `src/data/preferences/queueSplitStore.ts (new)`

**File:** `src/data/preferences/queueSplitStore.test.ts (new)`

**File:** `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals/QueueSplitResizer.tsx (new)`

**File:** `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals/QueueSplitResizer.test.tsx (new)`

**File:** `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals/XrayReferrals.css`

**File (already landed in an earlier, concurrent commit in this shared worktree — `8ccd671e` — confirmed present, not re-committed here):** `src/data/storage/storageRegistry.ts`

**File (already landed in an earlier, concurrent commit in this shared worktree — confirmed present, not re-committed here):** `src/data/labels/labelsStore.ts`

**File (already landed in the first commit of this plan, `a8b92a74` — confirmed present, not re-committed here):** `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx` (the `QueueSplitResizer` import + JSX line)

**Verification:**
- `npx vitest run` on `queueSplitStore.test.ts`, `QueueSplitResizer.test.tsx`, and the whole `views/` + `views/XrayReferrals/` directories (incl. `queueLayout.test.tsx`, the DOM-shape pin the plan calls out by name): **all green.**
- `npm run typecheck`: clean. Scoped `eslint`: clean.
- `check:complexity`-equivalent scoped check against the real 1450-line budget: **1434/1450**, clean.
- `check:hex-literals`: OK — `XrayReferrals.css` uses only `var(--c-border)` / `var(--c-navy)` tokens.
- `check:release` / `check:vendor` / `check:bundle-size` / whole-repo `build`: **not run** by this session — per the coordinator's explicit instruction, this worktree is shared with several other concurrent agents and these gates depend on shared, rapidly-changing state (`package.json` version, the edit-log's topmost heading, a full `dist/` build) that this session was told not to touch or race against. The coordinator owns running these once all drafts are merged.
- **Real-browser verification (Chromium, `npm run dev` via the project's own `.claude/launch.json` "x-ray-app" config, against `?sim=1&role=employee` — a real, writable, in-memory simulated workspace, not the read-only viewer/demo mode):**
  - The separator renders with the correct `aria-label` (`ew_queue_split_handle_aria`) and is present in the accessibility tree exactly as `صور الأشعة المحالة` renders.
  - Confirmed `getComputedStyle(grid).direction === "rtl"` and the initial `--ew-xr-queue-basis` resolves to `53.49%` on first paint (the `useLayoutEffect` application).
  - Dispatched real `PointerEvent`s on the live handle: during the drag the grid's custom property updated live (`48.01%`) and `localStorage` stayed `null` (no write mid-drag); on `pointerup` the exact dragged ratio (`0.48011618480234175`) was persisted.
  - **Reload persistence confirmed:** a full page navigate/reload re-applied `48.01%` to the grid on first paint, `localStorage` still holding the same value.
  - **Reset confirmed:** a real `dblclick` on the handle reset the grid to `53.49%` and removed the `localStorage` key.
  - **Keyboard confirmed:** focusing the handle and dispatching `ArrowLeft` moved `--ew-xr-queue-basis`, `aria-orientation="vertical"`, `tabindex="0"` all present and correct.
  - **Stacked/narrow-viewport hide confirmed:** resizing the browser to 900×720 (below the 1100px breakpoint) set the handle to `display: none`; a dispatched drag against the hidden handle produced NO change to the grid property, confirming the `getComputedStyle(...).display === "none"` guard (the deviation noted above) works correctly in a real browser, not just in the jsdom fixture.
  - **Task 1 cross-check performed in the same session** (see the first entry above) — submitting an inspection form in this same real browser session fired exactly one `{source:"periodic", changed:["answers"]}` event, captured via a live `window.addEventListener` probe.
  - No console errors and no new `errorLogger` entries attributable to any of the above across the whole session.
  - **One finding, not a regression, worth a follow-up decision:** at the tested 1280×800 viewport, the grid's *content* width (895px, after subtracting the sidebar) is narrower than the ~955px needed for the exact default ratio (53.49%) to clear the panel's 430px floor without CSS's own `minmax()` already capping the panel at its floor — meaning on a fairly common laptop width, the numeric default the JS/CSS custom property carries can sit slightly outside what `clampToLayout` would allow a drag/keyboard nudge to reach. The RENDERED layout is never actually broken by this — CSS's own two `minmax()` floors resolve independently of the custom property's value and always win — but a keyboard nudge taken immediately after a `Home`/double-click reset on such a viewport can produce a number that reads as a decrease rather than the expected increase, because the nudge clamps from the (technically out-of-bounds-for-this-width) cached default rather than from the geometry CSS is actually rendering. Not part of this plan's specified scope (the plan's own jsdom fixture used a synthetic 1000px width where this does not trigger), and not a task item — flagged here for an owner decision the same way the plan's own addendum flagged the pre-existing `46vh` issue.

**Lines:** 5 files, +595 / -2 (whole-repo `count-lines` total not captured — `npm run build` / the full tier-3 sweep was deferred to the coordinator, see above)

**Commit:** `5b948653` — "Add (xray-referrals): a draggable, persisted split between the queue and the inspection panel"

---

## Rollup for the coordinator

- Package version and `docs/edit logs/2026-08-24.md` were deliberately left untouched by this session from the point the coordinator's message arrived onward. Whatever this plan's three commits should be numbered as (the plan's own doc assumed v115.3 → v115.4 → v116.0 off a `115.2.0` baseline that has since moved substantially due to concurrent work) is for the merge step to decide.
- All three commits are already on `claude/adoring-brahmagupta-c855fa`: `a8b92a74`, `810de071`, `5b948653` (in that order, newest last). None have been pushed.
- `check:release`, `check:vendor`, `check:bundle-size`, and a full `npm run build` were NOT run by this session (see the tier-3 entry's verification note) — these are the whole-repo gates most likely to collide with other concurrent sessions' in-flight state, and the coordinator asked this session to scope its own gates to files it touched. **Recommend running the full `npm run build` + `check:*` sweep once after all drafts are merged and the version is assigned**, per CLAUDE.md's tier-3 requirement.
