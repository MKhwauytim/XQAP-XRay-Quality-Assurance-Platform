# «صور الأشعة المحالة» — missing save-broadcast, stale draft flag, and a user-resizable queue/panel split — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the two owner-reported problems on the referred-x-ray-images page (`ew/xray-referrals`):

1. **Submitting the inspection form (نموذج الفحص) tells nobody.** `createSaveAnswerHandler` writes the answer, updates local state and says «تم التقديم.» — and never announces the write on `dataRefreshSignal`. Every *other* mounted view of the same data (the approval desk, «نتائج فحص الأشعة», Reports, another machine's tab on the next tick) keeps showing pre-submit state until the 45 s sync tick or the manual refresh button comes round. Every sibling flow on this screen already announces itself; this one path does not.
2. **The queue/panel split is not user-resizable.** The two-column grid is fixed at `1.15fr / 1fr`. The owner's "nothing scales correctly" report on this page is, on investigation, this — a request for a draggable divider, not a UI-scale defect. The page's CSS is already correctly wired to `--ui-scale` / `--app-vh` / `--ui-table-height-scale` (see §Non-goals and the addendum for the one genuine, minor exception found).

Plus one bug found while reading the save handler and folded in because it lives in the same `if (result.ok)` block (Task 2).

**Architecture:** Three narrowly-scoped changes against verified `file:line` anchors. No new subsystems, no workspace file formats, no changes to sampling, distribution folding, or any report/export builder.

- **Task 1** adds one `notifyLocalDataChange(["answers"])` call in the save handler's success branch, plus the same own-broadcast ref guard the sibling approval desk already uses (`useApprovalData.ts:257-291`), so this page does not pay for a full re-read of a write it has already reconciled locally.
- **Task 2** clears `dirtyEntryId` on a successful submit — one line in the same branch — so a saved answer stops being reported as unsaved work by the month-switch guard.
- **Task 3** adds a genuinely new, small, self-contained component (`QueueSplitResizer`) plus a `localStorage`-backed preference store modelled directly on `uiScaleStore.ts`. The live drag writes a CSS custom property straight onto the grid element and persists only on release, so **no React re-render happens during the drag** and `XrayReferrals.tsx` grows by two lines.

**Tech Stack:** React 19 + TypeScript (strict, `erasableSyntaxOnly`), Vitest (`node` default env; component tests opt into jsdom with `/* @vitest-environment jsdom */` on line 1), `@testing-library/react`, `createMemoryDirectory`/`getReadLog` from `src/data/storage/memoryDirectory.ts`, plain co-located CSS. Chromium-only baseline (File System Access API).

---

## Global Constraints

- **`max-lines-per-function` is the binding constraint on this file.** `npm run check:complexity` runs `max-lines-per-function: [error, 1450]`. Measured against the current tree:

  ```
  $ npx eslint src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx \
      --rule "max-lines-per-function: [error, 1400]"
  729:16  error  Function 'XrayReferrals' has too many lines (1422). Maximum allowed is 1400
  ```

  **1422 of 1450 — 28 lines of headroom for this whole plan.** This plan's three tasks are budgeted at roughly +6 (Task 1), +0…1 (Task 2) and +2 (Task 3) lines *inside the component body*, landing near 1431. **Every task in this plan therefore runs `npm run check:complexity` as a gate, even at tier 2** — normally a tier-3-only gate. If a task's own headroom runs out, **extract to a module-level helper (as `createSaveAnswerHandler`, `createReopenHandlers` and `createRenderCell` already do); never raise the budget number in `package.json`.**
- Every edit needs an entry in `docs/edit logs/2026-08-24.md` (today's file — it does not exist yet; `npm run editlog --append` creates it). **Generate the skeleton, don't hand-write it:** `npm run editlog -- --tier=<n> --append --sync-package "<Category (scope): title>"`. New entries go at the TOP of the day's file (newest-first) — `npm run check:release` reads only the topmost heading and compares it against `package.json`'s first two version segments.
- Versions (semver-lite, `package.json` is currently `115.2.0`): Task 1 → **v115.3**, Task 2 → **v115.4**, Task 3 → **v116.0** (new component + new persisted storage key + new label keys is a feature, not a tweak). Write the major as `v116.0`, never a bare `v116`.
- Never a bare `git commit` — always `git add <specific files>` then `git commit -m "..." -- <same files>`.
- **`npm run build` before pushing the branch or opening a PR**, at every tier. `vitest` transpiles per-file and never type-checks; a green suite has hidden real type errors in this repo.
- **UI text is Arabic and comes from `DEFAULT_LABELS`.** Task 3 adds label keys rather than inlining Arabic in JSX.
- **No raw `100vh`/`100vw` in any CSS this plan touches.** `src/data/preferences/uiScaleCss.contract.test.ts` fails on one; use `var(--app-vh)`.
- **No raw hex colour literals.** `npm run check:hex-literals` is a gate; Task 3's CSS uses tokens from `src/index.css` only.
- Nothing in this plan touches `deriveCurrentDistribution`, the event fold, `drawSample`, or any report/export builder, so CLAUDE.md's "snapshot before changing" rule adds no new requirement here — but every pre-existing test in every touched file must stay green, or be updated with a stated reason. Never silently deleted.

### Non-goals (read this before "fixing" anything else on this page)

- **Do not hunt for a UI-scale bug on this screen.** It was already investigated. `XrayReferrals.css` uses `var(--ui-queue-floor)` (line 56, 271), `var(--app-vh)` and `var(--ui-table-height-scale)` (lines 57-60) correctly, and `uiScaleCss.contract.test.ts` pins exactly that (`it("scales the reviewer-queue floor, because min-height beats max-height")` names this file by path). The one genuine imperfection found is listed in the addendum at the end and is **optional, owner-gated, and not part of any task here.**
- Do not migrate the split ratio into the workspace column preset (`browsePresetStorage`). It is a per-machine display preference, like `xray_ui_scale_v1` — two operators on two different screens must be able to choose differently, and `4-reports`/`3-user-data` must not gain a per-screen layout field.

---

### Task 1: announce a submitted answer on `dataRefreshSignal` (tier 2 → v115.3)

**Files:**
- Modify: `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx` — import block (line 25), `createSaveAnswerHandler` (lines 412-494), the component's refresh subscription (lines 1380-1385), the `handleSave` construction (lines 1393-1396)
- Create: `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.saveBroadcast.test.tsx`

**Interfaces:**
- Consumes: `notifyLocalDataChange(families: readonly DataRefreshFamily[])` and `subscribeToDataChange` from `src/data/workspace/dataRefreshSignal.ts` — both pre-existing and unchanged. `notifyLocalDataChange` broadcasts `{ source: "periodic", changed: new Set(families) }`, no-ops outside a browser, and dispatches **synchronously** (`window.dispatchEvent`).
- Produces: `createSaveAnswerHandler`'s `deps` object gains one required field, `ownBroadcastRef: React.RefObject<boolean>`. No exported signature changes; the handler's return type and every user-visible message stay identical.

**Why `notifyLocalDataChange(["answers"])` and not `broadcastDataRefresh("manual")`:**

`dataRefreshSignal.ts:99-131` defines `notifyLocalDataChange` as, verbatim, "the echo of a write THIS tab just made, for the sibling views mounted beside it". That is exactly this case. `broadcastDataRefresh("manual")` additionally means *discard every cache*, which `directoryScan.ts:732` and `workspacePaths.ts:236` honour by dropping their whole caches — pure cost for one answer file. The change set is `["answers"]` and nothing else: submitting an answer writes one `{user}.answers.json` and appends to the action log; it appends **no distribution event** and files **no request**, so claiming `"distribution"` or `"requests"` would make `Reports/TabView.tsx` and `useMonthLoad.ts` re-read for nothing.

**Why the own-broadcast guard, and why it is safe:**

The page subscribes to its own broadcast at line 1385. Without a guard, every submit would trigger a full silent re-read of this view — and `dataRefreshSignal.ts:120-122` warns in as many words that firing a broadcast "on each of thousands of answer saves is its own defect". The local `setAnswers` at lines 482-485 has already reconciled this view exactly, so the re-read buys nothing. `useApprovalData.ts:250-291` established the idiom (`ownDecisionBroadcastRef`) with the same reasoning; reuse it rather than inventing a second shape.

**Safety trace of the broadcast itself (do not skip — CLAUDE.md: "a refresh must never clobber unsaved local draft state", and this file's own comment block at lines 967-1001 exists because that was a real bug):**

Verified by reading the receive side end to end:

| Question | Answer (verified) |
|---|---|
| What does the subscriber do? | `void loadData({ silent: true })` — line 1385. |
| Does a silent load touch the panel or selection? | No. The `if (!silent)` branch at lines 1182-1191 is the *only* place `setLoadState("loading")`, `setSelEntryId(null)`, `setDirtyEntryId(null)` and `setSelectedIds(new Set())` are called. Silent skips all four. |
| Does `commit()` re-point the panel? | No. Lines 1248-1266 set rows/answers/quota/loadState only — its own docblock says "Never touches selection or panel state". |
| Can a new `answers` array remount the open form? | No. `SampleDetailPanel` keys `InspectionPanel` on `entry.xrayImageId` (`subComponents.tsx:567`), and `InspectionPanel` (`src/components/InspectionPanel/index.tsx:88-95`) seeds its local `ans` in a **lazy `useState` initializer** with **no `savedAnswer` sync effect**. A changed `savedAnswer` prop cannot reset typed input. |
| Can submitting drop the row out of `displayEntries` (and so unmount the panel)? | No. The only row filters are scope (`assignedTo`) and the case chips, and `matchesCaseFilter` (`caseFilter.ts:55-66`) reads `targetedByRiskEngine` and ad-hoc-ness only — **never the answer status**. Nothing about submitting an answer removes its row. |
| And if a *concurrent* actor removes it anyway? | Then the pre-existing `dirtyEntryId`/`lastPanelEntry` retention (lines 1021-1033) handles it, exactly as it already does for the 45 s tick. This broadcast introduces no new class of event. |
| Re-entrancy / loops? | `loadData` never broadcasts, so there is no cycle. With the ref guard the page skips its own broadcast entirely. |

**Residual risk, stated plainly:** the guard is a `useRef` boolean raised around a synchronous `dispatchEvent`. If a future refactor makes the broadcast asynchronous (a `queueMicrotask`, a `setTimeout`), the flag would be lowered before delivery and the page would start re-reading on every submit — a silent perf regression, not a correctness one. Step 5's "guard is not sticky" test pins the other direction (a *later* external refresh still reloads); the comment added in Step 4 names the synchronous-delivery assumption so a future reader sees it.

- [ ] **Step 1: Read the receive side before touching the send side**

  Read `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx` lines **1140-1200** (`loadData`'s `silent` branch), **1244-1266** (`commit`), **1380-1385** (the subscription), and `src/components/Sidebar/Tabs/EmployeeWorkspace/views/ReferralApproval/useApprovalData.ts` lines **245-291** (the guard idiom being copied). Confirm the table above against the code as it actually stands before writing any test. If any row of that table no longer holds, **stop and re-plan** — the broadcast's safety argument rests entirely on it.

- [ ] **Step 2: Write the failing tests**

  Create `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.saveBroadcast.test.tsx`. Copy the harness verbatim from the sibling `XrayReferrals.answerOnBehalf.test.tsx` (lines 1-58 and its `makeRow` / `makeSample` / `seedTemplate` / `seedMonth` helpers) — the worker mock, the `useGlobalMonth` mock, the `useWorkspace` mock, `ResizeObserverStub`, and the `beforeEach`/`afterEach` pair are all required to mount this view at all. Then:

  ```tsx
  /* @vitest-environment jsdom */
  // Submitting an answer is a write like any other on this screen, and every
  // other write here announces itself. This one did not, so the approval desk,
  // «نتائج فحص الأشعة» and Reports — all of them mounted behind this sub-tab by
  // the tab-mount LRU — kept showing the row as unanswered until the 45 s sync
  // tick or the manual refresh button came round.
  //
  // The two halves are equally load-bearing:
  //   • the broadcast happens, once, naming "answers" and nothing else;
  //   • this page skips its OWN broadcast (setAnswers already reconciled it),
  //     without the guard getting stuck and swallowing later ones.
  ```

  Add, inside the file's `describe`:

  ```tsx
  it("broadcasts an answers-only refresh exactly once when an answer is submitted", async () => {
    writeSession({ role: "employee", username: "emp-a", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);

    const root = createMemoryDirectory("root");
    await seedMonth(root, [["IMG-001", "emp-a"]]);

    const seen: DataRefreshDetail[] = [];
    const stop = subscribeToDataChange(["answers"], (detail) => { seen.push(detail); });

    try {
      render(<XrayReferrals directoryHandle={root} />);
      await waitFor(() => expect(screen.getAllByText("IMG-001").length).toBeGreaterThan(0));

      const note = (await waitFor(() => screen.getByLabelText("ملاحظة"))) as HTMLInputElement;
      fireEvent.change(note, { target: { value: "تمت المراجعة" } });
      fireEvent.click(await waitFor(() => screen.getByRole("button", { name: "تقديم الفحص" })));
      await waitFor(() => expect(screen.getByText("تم التقديم.")).toBeInTheDocument());

      // Once per completed user action, never per field or per render.
      expect(seen).toHaveLength(1);
      // "periodic" + a change set, NOT "manual": "manual" additionally means
      // "discard every cache", which directoryScan.ts and workspacePaths.ts
      // honour by dropping theirs wholesale. One answer file does not justify
      // that (see dataRefreshSignal.ts:110-117).
      expect(seen[0]!.source).toBe("periodic");
      expect([...(seen[0] as { changed: Set<string> }).changed]).toEqual(["answers"]);
    } finally {
      stop();
    }
  });

  it("does not make this page re-read its own write, and does not swallow the next external refresh", async () => {
    writeSession({ role: "employee", username: "emp-a", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);

    const root = createMemoryDirectory("root", { trackReads: true });
    await seedMonth(root, [["IMG-001", "emp-a"]]);

    render(<XrayReferrals directoryHandle={root} />);
    await waitFor(() => expect(screen.getAllByText("IMG-001").length).toBeGreaterThan(0));

    const note = (await waitFor(() => screen.getByLabelText("ملاحظة"))) as HTMLInputElement;
    fireEvent.change(note, { target: { value: "تمت المراجعة" } });
    clearReadLog(root);
    fireEvent.click(await waitFor(() => screen.getByRole("button", { name: "تقديم الفحص" })));
    await waitFor(() => expect(screen.getByText("تم التقديم.")).toBeInTheDocument());

    // The write itself reads (upsert reads-then-writes the answer file). What
    // must NOT appear is a whole second load pass: the derived distribution /
    // sample master / mirror reads loadData performs.
    const afterSave = getReadLog(root);
    expect(afterSave.some((path) => path.includes("sample.master.json"))).toBe(false);

    // …and the guard is not sticky. An EXTERNAL refresh landing afterwards must
    // still reload this view, or one submit would deafen the page for good.
    clearReadLog(root);
    broadcastDataRefresh("manual");
    await waitFor(() => {
      expect(getReadLog(root).some((path) => path.includes("sample.master.json"))).toBe(true);
    });
  });
  ```

  Imports this file needs on top of the copied harness:

  ```tsx
  import {
    broadcastDataRefresh,
    subscribeToDataChange,
    type DataRefreshDetail,
  } from "../../../../../data/workspace/dataRefreshSignal";
  import { clearReadLog, getReadLog } from "../../../../../data/storage/memoryDirectory";
  ```

  > **Note on the read-log assertion:** `sample.master.json` is the marker because an employee-scope load reads it only on the slow path, and a freshly-seeded month has no employee mirror, so every `loadData` pass in this fixture touches it. Run Step 3 first and read the actual failing output; if the seeded fixture takes the mirror fast path instead, swap the marker for `distribution.current.json` or assert on the log **length** growing rather than a specific file. Do not weaken the assertion to `expect(true)` — if no marker is stable, spy on `loadEmployeeAnswers`'s call count instead.

- [ ] **Step 3: Run the tests to verify they fail against the current code**

  ```bash
  npx vitest run src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.saveBroadcast.test.tsx
  ```

  Expected: test 1 FAILS with `expect(seen).toHaveLength(1)` receiving `0` — no broadcast is emitted today. Test 2's first half passes vacuously today (no broadcast ⇒ no self-reload) and its second half passes today; that half is a regression pin for the guard about to be added, so it is expected to pass both before and after.

- [ ] **Step 4: Add the broadcast and the guard**

  In `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx`, line **25**:

  ```ts
  import { subscribeToDataRefresh } from "../../../../../data/workspace/dataRefreshSignal";
  ```

  becomes:

  ```ts
  import {
    notifyLocalDataChange,
    subscribeToDataRefresh,
  } from "../../../../../data/workspace/dataRefreshSignal";
  ```

  In `createSaveAnswerHandler`'s `deps` type (lines **412-423**), add one field after `setStatusMsg`:

  ```ts
    setAnswers: React.Dispatch<React.SetStateAction<ItemAnswer[]>>;
    setStatusMsg: (msg: StatusMsg) => void;
  }) {
  ```

  becomes:

  ```ts
    setAnswers: React.Dispatch<React.SetStateAction<ItemAnswer[]>>;
    setStatusMsg: (msg: StatusMsg) => void;
    /** Raised across this handler's OWN broadcast so the view's subscription
     *  (see XrayReferrals' subscribeToDataRefresh effect) skips it: `setAnswers`
     *  below has already reconciled this view exactly, and a second full read
     *  per submission is pure cost. Correct only while `notifyLocalDataChange`
     *  delivers synchronously — `window.dispatchEvent` does. */
    ownBroadcastRef: React.RefObject<boolean>;
  }) {
  ```

  and the destructure (lines **424-427**):

  ```ts
    const {
      directoryHandle, folderForRow, username, role, activeTpl, selMonth,
      canSubmitAnswers, canAnswerOnBehalf, setAnswers, setStatusMsg,
    } = deps;
  ```

  becomes:

  ```ts
    const {
      directoryHandle, folderForRow, username, role, activeTpl, selMonth,
      canSubmitAnswers, canAnswerOnBehalf, setAnswers, setStatusMsg,
      ownBroadcastRef,
    } = deps;
  ```

  In the `if (result.ok)` branch, lines **482-486**:

  ```ts
          setAnswers((prev) => [
            ...prev.filter((a) => !(a.xrayImageId === xrayImageId && a.answeredBy === forUser)),
            item,
          ]);
          setStatusMsg({ type: "ok", text: "تم التقديم." });
  ```

  becomes:

  ```ts
          setAnswers((prev) => [
            ...prev.filter((a) => !(a.xrayImageId === xrayImageId && a.answeredBy === forUser)),
            item,
          ]);
          setStatusMsg({ type: "ok", text: "تم التقديم." });
          // Tell the OTHER mounted views. Without this a submitted answer stayed
          // invisible to the approval desk, «نتائج فحص الأشعة» and Reports — all
          // kept mounted beside this one by the tab-mount LRU — until the 45 s
          // sync tick or the manual refresh button came round. `"answers"` and
          // nothing else: this write appends no distribution event and files no
          // request, so widening the change set would only make unrelated views
          // re-read. Once per completed user action, inside the ok branch, so a
          // refused write never announces one.
          ownBroadcastRef.current = true;
          try {
            notifyLocalDataChange(["answers"]);
          } finally {
            ownBroadcastRef.current = false;
          }
  ```

  In the component body, replace the subscription at lines **1380-1385**:

  ```tsx
    // Re-fetch on the app-wide refresh signal (manual toolbar button + 5-minute
    // auto-refresh) so a referral/reassignment made by someone else -- or on
    // another machine -- shows up without navigating away and back. Passed silently
    // so it never force-closes an employee's currently open inspection form (see the
    // `silent` handling inside loadData above).
    useEffect(() => subscribeToDataRefresh(() => { void loadData({ silent: true }); }), [loadData]);
  ```

  with:

  ```tsx
    // Re-fetch on the app-wide refresh signal (manual toolbar button + 5-minute
    // auto-refresh) so a referral/reassignment made by someone else -- or on
    // another machine -- shows up without navigating away and back. Passed silently
    // so it never force-closes an employee's currently open inspection form (see the
    // `silent` handling inside loadData above). `ownAnswerBroadcastRef` skips this
    // view's OWN submit announcement — handleSave's setAnswers already reconciled
    // it (same idiom as useApprovalData.ts's ownDecisionBroadcastRef).
    const ownAnswerBroadcastRef = useRef(false);
    useEffect(() => subscribeToDataRefresh(() => {
      if (ownAnswerBroadcastRef.current) return;
      void loadData({ silent: true });
    }), [loadData]);
  ```

  and pass it at the `handleSave` construction (lines **1393-1396**):

  ```tsx
    const handleSave = createSaveAnswerHandler({
      directoryHandle, folderForRow, username, role, activeTpl, selMonth,
      canSubmitAnswers, canAnswerOnBehalf, setAnswers, setStatusMsg,
    });
  ```

  becomes:

  ```tsx
    const handleSave = createSaveAnswerHandler({
      directoryHandle, folderForRow, username, role, activeTpl, selMonth,
      canSubmitAnswers, canAnswerOnBehalf, setAnswers, setStatusMsg,
      ownBroadcastRef: ownAnswerBroadcastRef,
    });
  ```

  `useRef` is already imported (line 1). Net growth inside the component body: **+5 lines** (1422 → ~1427 of 1450).

- [ ] **Step 5: Run the tests to verify they pass**

  ```bash
  npx vitest run src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.saveBroadcast.test.tsx
  ```

  Expected: PASS.

- [ ] **Step 6: Run every sibling suite for this view, then the repo gates**

  ```bash
  npx vitest run src/components/Sidebar/Tabs/EmployeeWorkspace/views/
  npm run test:run && npm run typecheck && npm run lint && npm run check:complexity
  ```

  Expected: all green. Pay particular attention to `XrayReferrals.draftRetention.test.tsx`, `XrayReferrals.pageRetention.test.tsx`, `XrayReferrals.monthChangeGuard.test.tsx` and `ReferralApproval/useApprovalData.test.tsx` — those four are the ones a refresh-signal change can break. `check:complexity` must report no `max-lines-per-function` error on `XrayReferrals.tsx`; if it does, extract rather than raise the budget (see Global Constraints).

- [ ] **Step 7: REAL-BROWSER VERIFICATION — a completion gate, not a nicety**

  Component tests are **not** sufficient evidence for this change. CLAUDE.md's "Before claiming done" says so directly for this repo, and the boot-splash saga (v59.190-197, `docs/` + memory) is five consecutive rounds of effect-timing fixes in this same area that survived self-review — *including* after a real-browser confirmation. So:

  ```bash
  npm run dev    # Chrome or Edge only — File System Access API
  ```

  With a real (or demo) workspace mounted and a month that has distributed samples:

  1. Sign in as an employee with an assigned sample. Open «صور الأشعة المحالة», open a sample, type into the inspection form, submit. Confirm «تم التقديم.» and that the row's status badge flips.
  2. **The point of the fix:** with a supervisor account in a **second browser tab** on «الموافقة على الإحالات» (or «نتائج فحص الأشعة») against the same workspace, submit an answer in tab 1. Tab 2 is a separate `window` and will **not** see this broadcast (it is intra-tab by design — `dataRefreshSignal.ts` says so explicitly); it still refreshes on its own 45 s tick. The case this fix actually covers is **same-tab sibling views**: in ONE tab, visit «نتائج فحص الأشعة» first (so the tab-mount LRU keeps it mounted), switch to «صور الأشعة المحالة», submit an answer, switch back — the result must already be there, with **no manual refresh and no page reload**. Record what you saw.
  3. **The regression to actively look for:** open a sample, type into the form but do **not** submit, then wait for a background refresh (or click the AdminToolbar refresh button). The typed text must still be there. Then submit a *different* row's answer from scratch and confirm the queue does not flicker into the «جاري التحميل...» state.
  4. Check the browser console for unhandled rejections, and the in-app error log (`errorLogger`) for new `xrayReferrals:*` entries.

  **Do not tick this box on the strength of reading the code or of green tests.** If the real-browser run cannot be performed in this session, say so explicitly in the handoff rather than marking the task done.

- [ ] **Step 8: Edit log, then commit**

  ```bash
  npm run editlog -- --tier=2 --append --sync-package \
    "Fix (xray-referrals): announce a submitted answer on the data-refresh signal"
  ```

  Fill in `Why:` (sibling views showed pre-submit state until the next 45 s tick) and `What changed:` with the Before/After snippets above. Then:

  ```bash
  git add src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx \
          src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.saveBroadcast.test.tsx \
          "docs/edit logs/2026-08-24.md" package.json
  git commit -m "Fix (xray-referrals): announce a submitted answer on the data-refresh signal" -- \
          src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx \
          src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.saveBroadcast.test.tsx \
          "docs/edit logs/2026-08-24.md" package.json
  ```

---

### Task 2: a saved answer stops counting as unsaved work (tier 2 → v115.4)

**Files:**
- Modify: `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx` — `createSaveAnswerHandler` (deps + the `if (result.ok)` branch), the `handleSave` construction
- Modify: `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.monthChangeGuard.test.tsx` (add one test to the existing suite — read it in full first)

**The bug, verified:**

`dirtyEntryId` is set by `onDraftDirty` when the employee types into the panel (line **2020**) and is cleared in exactly three places: `selectEntry` (line **1052**), `loadData`'s non-silent branch (line **1189**), and the no-month reset effect (line **1134**). **A successful submit clears it nowhere.** So after submitting and staying on the same row:

- `useVisibleUnsavedWorkMonthGuard({ hasUnsavedWork: dirtyEntryId !== null })` (lines **1009-1013**) still reports unsaved work, and switching the global month raises `gm_month_switch_draft_confirm` — «إجابات غير محفوظة» — about an answer that is on disk.
- The retention branch (lines **1021-1033**) would keep the panel up with the `ew_draft_retained_notice` warning if a concurrent actor moved the row, again about a saved answer. Task 1's broadcast does not cause this (submitting never removes a row from `displayEntries` — see Task 1's trace), but it is wrong either way.

Clearing it on success is correct: the draft is no longer unsaved, so the row reverts to ordinary auto-select behaviour, and nothing typed can be lost by doing so.

**Interfaces:**
- Produces: `createSaveAnswerHandler`'s `deps` gains `setDirtyEntryId: (id: string | null) => void`. No other signature changes.

- [ ] **Step 1: Read `XrayReferrals.monthChangeGuard.test.tsx` in full**

  It already drives the type-then-switch-month flow and asserts the confirm dialog appears. The new test is its mirror image (type, **submit**, then switch), so it must reuse that file's existing helpers and mocks rather than re-inventing them.

- [ ] **Step 2: Write the failing test**

  Add to that file's existing `describe`:

  ```tsx
  it("stops warning about unsaved work once the answer has actually been submitted", async () => {
    // The month-switch guard reads `dirtyEntryId !== null`, and nothing on the
    // success path cleared it — so submitting an answer and then switching month
    // prompted «إجابات غير محفوظة» about an answer already on disk. A prompt that
    // fires when nothing is at stake is how a real one gets clicked through.
    // (Follow the surrounding tests' setup for session, seeding and rendering.)
    // …type into the panel, submit, wait for «تم التقديم.»…
    // …then trigger the month switch the sibling test uses and assert the
    //    confirm dialog does NOT appear (and that the switch goes through).
  });
  ```

  Write the body against the file's own conventions — the sibling test above it shows exactly how the guard is registered and how the switch is driven. Assert on `getLabels().gm_month_switch_draft_confirm` being absent.

- [ ] **Step 3: Run the test to verify it fails**

  ```bash
  npx vitest run src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.monthChangeGuard.test.tsx
  ```

  Expected: the new test FAILS — the confirm still fires after a successful submit.

- [ ] **Step 4: Clear the flag on success**

  In `createSaveAnswerHandler`'s deps type, after `ownBroadcastRef` (added by Task 1):

  ```ts
    ownBroadcastRef: React.RefObject<boolean>;
  }) {
  ```

  becomes:

  ```ts
    ownBroadcastRef: React.RefObject<boolean>;
    /** Cleared on a successful submit: the row's answers are on disk, so the
     *  month-switch guard and the vanished-row draft retention must stop
     *  treating them as work at risk. */
    setDirtyEntryId: (id: string | null) => void;
  }) {
  ```

  Add `setDirtyEntryId,` to the destructure alongside `ownBroadcastRef`, and in the `if (result.ok)` branch place the call immediately after `setAnswers(...)` and before `setStatusMsg(...)`:

  ```ts
          setAnswers((prev) => [
            ...prev.filter((a) => !(a.xrayImageId === xrayImageId && a.answeredBy === forUser)),
            item,
          ]);
          // Saved ⇒ no longer a draft. Ordering matters only for readability
          // here (both are React state updates batched into one commit), but it
          // belongs beside the state it invalidates, not at the end of the block.
          setDirtyEntryId(null);
          setStatusMsg({ type: "ok", text: "تم التقديم." });
  ```

  And at the `handleSave` construction, add `setDirtyEntryId,` to the object. `setDirtyEntryId` is already in scope (declared line **993**). Net component-body growth: **0-1 lines** (a wrapped argument line at most).

- [ ] **Step 5: Run the test to verify it passes, then the sibling suites**

  ```bash
  npx vitest run src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.monthChangeGuard.test.tsx
  npx vitest run src/components/Sidebar/Tabs/EmployeeWorkspace/views/
  ```

  Expected: PASS. `XrayReferrals.draftRetention.test.tsx` is the one at risk — it asserts a *typed-but-unsaved* row survives a refresh, which this change does not touch (it only clears the flag after a **successful write**). If it fails, the change is wrong, not the test.

- [ ] **Step 6: Repo gates**

  ```bash
  npm run test:run && npm run typecheck && npm run lint && npm run check:complexity
  ```

- [ ] **Step 7: Edit log, then commit**

  ```bash
  npm run editlog -- --tier=2 --append --sync-package \
    "Fix (xray-referrals): clear the unsaved-draft flag once an answer is submitted"
  ```

  ```bash
  git add src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx \
          src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.monthChangeGuard.test.tsx \
          "docs/edit logs/2026-08-24.md" package.json
  git commit -m "Fix (xray-referrals): clear the unsaved-draft flag once an answer is submitted" -- \
          src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx \
          src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.monthChangeGuard.test.tsx \
          "docs/edit logs/2026-08-24.md" package.json
  ```

---

### Task 3: a draggable, persisted queue/panel split (tier 3 → v116.0)

**Tier-3 justification:** a new UI component, a new persisted browser-storage key that must be entered in `storageRegistry.ts` (CLAUDE.md: "the single source of truth"), new label keys, and a layout change to the CSS of the app's highest-traffic screen. That is a feature with a real blast radius, not a tweak — so it carries the full gate sweep (`check:complexity`, `check:hex-literals`, `check:release`, `check:vendor`, `build`, `check:bundle-size`) plus migration/rollback notes in the edit log.

**Files:**
- Create: `src/data/preferences/queueSplitStore.ts`
- Create: `src/data/preferences/queueSplitStore.test.ts` (node env — no jsdom pragma; mirrors `uiScaleStore.test.ts`)
- Create: `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals/QueueSplitResizer.tsx`
- Create: `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals/QueueSplitResizer.test.tsx` (jsdom)
- Modify: `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals/XrayReferrals.css` (lines 22-39, 74-84, and the `@media (max-width: 1100px)` block at 283-321)
- Modify: `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx` (one import; one JSX element inside `.ew-xr-panel-col`, line 2000)
- Modify: `src/data/labels/labelsStore.ts` (three keys, beside the existing `ew_queue_scope_label` at line 275)
- Modify: `src/data/storage/storageRegistry.ts` (one `STORAGE_REGISTRY` entry)

**Interfaces:**
- Produces `src/data/preferences/queueSplitStore.ts`:
  ```ts
  export const QUEUE_SPLIT_STORAGE_KEY = "xray_queue_split_v1";
  export const QUEUE_SPLIT_CSS_VAR = "--ew-xr-queue-basis";
  /** 1.15fr ÷ (1.15fr + 1fr) — the ratio the fixed grid has always rendered. */
  export const DEFAULT_QUEUE_SPLIT = 0.5349;
  export const MIN_QUEUE_SPLIT = 0.25;
  export const MAX_QUEUE_SPLIT = 0.75;
  export function getQueueSplit(): number;
  export function setQueueSplit(next: number): number;   // clamped; returns what was stored
  export function resetQueueSplit(): number;             // back to default, key removed
  export function isQueueSplitCustomized(): boolean;
  export function subscribeToQueueSplit(fn: () => void): () => void;
  export function __resetQueueSplitCacheForTests(): void;
  ```
  Shape, docblock style, `sanitize`/`clamp`/`persist`/`notify` structure and the "remove the key when it equals the default" rule are copied from `uiScaleStore.ts:83-217`. Like that store it must **no-op outside a DOM** so it stays importable from the `node` test environment.
- Produces `QueueSplitResizer.tsx`: a default-exported component taking **no props**. It finds its own grid via `handleRef.current.closest(".ew-xr-grid")`, applies the stored ratio in a `useLayoutEffect`, and writes the CSS custom property **directly to that element** during a drag.
- Consumes: `getLabels()` / `useLabels()` for its Arabic strings.

**Design decisions, and why (do not silently re-decide these):**

1. **Percentage basis, not `fr`.** The track becomes `minmax(340px, var(--ew-xr-queue-basis, 53.49%))`. `fr` cannot be produced from a custom property — `var(--x) fr` is invalid syntax and `calc(var(--x) * 1fr)` is not reliably supported — so the first track is sized as a percentage and the second stays `minmax(430px, 1fr)`, absorbing the remainder. **Both pixel minimums are preserved untouched**, which is what keeps a drag from ever crushing either column: CSS clamps before the ratio does.
   *Known cosmetic detail:* percentage tracks resolve against the grid's content box, while `1.15fr / 1fr` divided the space *after* the 14px gutter. At the default the queue column therefore starts ~7px wider than today. Confirm in the browser (Step 8); if the owner objects, the default becomes `calc(53.49% - 7.5px)` — the JS always writes a plain `%`, so nothing else changes.
2. **The handle is absolutely positioned inside `.ew-xr-panel-col`, not a grid child.** `XrayReferrals.css:30-35` and `:86-106` warn at length that every child of this grid is placed by **explicit line number** precisely because a conditional child would otherwise re-flow the panel underneath the pagination. Adding a grid child means adding placement rules to *both* the base and the `--with-bar` variant, for no benefit. `.ew-xr-panel-col` already spans `grid-row: 2 / 4` (`3 / 5` with the bar) — i.e. exactly the height of the gutter the divider should occupy — so `position: absolute; inset-inline-start: -14px; width: 14px; top: 0; bottom: 0` lands it in the gutter with **zero changes to grid placement**.
3. **`inset-inline-start`, and direction read from `getComputedStyle`.** The page is `dir="rtl"`, so grid column 1 (the queue) is on the **right** and dragging **left** widens it. Rather than hard-coding that sign, the drag computes the width directly from geometry:
   ```ts
   const rtl = getComputedStyle(grid).direction === "rtl";
   const queueWidth = rtl ? rect.right - event.clientX : event.clientX - rect.left;
   ```
   Absolute position → width (no accumulated delta) means the divider cannot drift away from the pointer over a long drag, and the logical CSS property puts the handle on the correct side in either direction without a second rule.
4. **The live drag writes the DOM, not React state.** `setProperty` on the grid element during `pointermove`; the store is written **once on `pointerup`**. Routing a 60 Hz pointer stream through `setState` in a 1400-line component that owns a `DataTable` would re-render the whole queue on every frame. This also keeps `XrayReferrals.tsx`'s growth to two lines, which the `max-lines-per-function` budget requires (see Global Constraints).
5. **Pointer Events with capture, not mouse events.** `setPointerCapture` means the drag survives the pointer leaving the 14px strip — which is otherwise the first thing a user does. (`DataTable`'s older `mousedown` + `document` listeners at `index.tsx:756-805` are the prior art for the `body.style.cursor` / `userSelect` handling; copy that part, not the event model.)
6. **Keyboard and reset are not optional.** `role="separator"`, `aria-orientation="vertical"`, `aria-valuenow/min/max`, `tabIndex={0}`; ArrowLeft/ArrowRight nudge the divider by 2 percentage points **in the direction the arrow points** (so in RTL, ArrowLeft widens the queue — geometric, not semantic); `Home` and a double-click both reset to the default. A drag-only affordance is unusable by keyboard and undiscoverable when it has been dragged somewhere silly.

- [ ] **Step 1: Write the failing store tests**

  Create `src/data/preferences/queueSplitStore.test.ts`, modelled on `uiScaleStore.test.ts` (read it first for the `localStorage` stubbing convention this repo uses in the `node` environment):

  ```ts
  import { beforeEach, describe, expect, it } from "vitest";
  import {
    DEFAULT_QUEUE_SPLIT, MAX_QUEUE_SPLIT, MIN_QUEUE_SPLIT, QUEUE_SPLIT_STORAGE_KEY,
    __resetQueueSplitCacheForTests, getQueueSplit, isQueueSplitCustomized,
    resetQueueSplit, setQueueSplit, subscribeToQueueSplit,
  } from "./queueSplitStore";

  describe("queueSplitStore", () => {
    beforeEach(() => {
      localStorage.clear();
      __resetQueueSplitCacheForTests();
    });

    it("defaults to the ratio the fixed 1.15fr/1fr grid always rendered", () => {
      expect(getQueueSplit()).toBeCloseTo(DEFAULT_QUEUE_SPLIT, 4);
    });

    it("clamps out of range values instead of storing them", () => {
      expect(setQueueSplit(0.99)).toBe(MAX_QUEUE_SPLIT);
      expect(setQueueSplit(0.01)).toBe(MIN_QUEUE_SPLIT);
    });

    it("refuses a non-finite value rather than putting an invalid track on the grid", () => {
      // A hand-edited or half-written key must never be able to produce
      // `grid-template-columns: minmax(340px, NaN%)`, which drops the whole
      // declaration and collapses the layout — the same reasoning as
      // uiScaleStore's guard against `zoom: 0`.
      setQueueSplit(0.4);
      localStorage.setItem(QUEUE_SPLIT_STORAGE_KEY, '"not a number"');
      __resetQueueSplitCacheForTests();
      expect(getQueueSplit()).toBe(DEFAULT_QUEUE_SPLIT);
    });

    it("survives a reload", () => {
      setQueueSplit(0.62);
      __resetQueueSplitCacheForTests();
      expect(getQueueSplit()).toBeCloseTo(0.62, 4);
    });

    it("removes the key rather than storing the default", () => {
      setQueueSplit(0.62);
      resetQueueSplit();
      expect(localStorage.getItem(QUEUE_SPLIT_STORAGE_KEY)).toBeNull();
      expect(isQueueSplitCustomized()).toBe(false);
    });

    it("notifies subscribers, and stops after unsubscribe", () => {
      let calls = 0;
      const stop = subscribeToQueueSplit(() => { calls += 1; });
      setQueueSplit(0.6);
      expect(calls).toBe(1);
      stop();
      setQueueSplit(0.4);
      expect(calls).toBe(1);
    });
  });
  ```

- [ ] **Step 2: Run to verify it fails, then write the store**

  ```bash
  npx vitest run src/data/preferences/queueSplitStore.test.ts   # FAILS: module does not exist
  ```

  Create `src/data/preferences/queueSplitStore.ts` following `uiScaleStore.ts` structurally: module docblock explaining *why* this is a per-machine `localStorage` preference and not workspace data; `clamp`; `sanitize` (non-finite ⇒ default, in-range ⇒ clamped); module-level `current`/`loaded` cache; `readFromStorage` wrapped in try/catch routing failures to `logError("queueSplitStore:read", error)`; `persist` that removes the key at the default and catches quota/private-mode failures via `logError("queueSplitStore:persist", error)`; a `Set<Subscriber>` and `notify`. **Do not** add an `applyToDocument` equivalent — unlike UI scale, this property belongs to one element inside one screen, and the component owns applying it.

  Re-run to green.

- [ ] **Step 3: Register the storage key**

  In `src/data/storage/storageRegistry.ts`, add to `STORAGE_REGISTRY` immediately after the `xray_ui_scale_v1` entry (they are siblings — both per-machine display preferences):

  ```ts
    {
      id: "xray_queue_split_v1",
      layer: "local",
      purpose: "Width split between the queue and the inspection panel on «صور الأشعة المحالة».",
      lossConsequence: "The split returns to its default; re-drag the divider once.",
    },
  ```

  ```bash
  npx vitest run src/data/storage/storageRegistry.test.ts
  ```

  Expected: still green (that suite pins a named subset, not an exact list — but the new key must be there for the Settings storage panel and `clearOwnedStorage` to know it exists).

- [ ] **Step 4: Add the label keys**

  In `src/data/labels/labelsStore.ts`, beside `ew_queue_scope_label` (line 275):

  ```ts
    ew_queue_split_handle_aria:      "تغيير عرض قائمة العينات مقابل نموذج الفحص",
    ew_queue_split_handle_title:     "اسحب لتغيير العرض — انقر مرتين للعودة إلى الوضع الافتراضي",
    ew_queue_split_reset_announce:   "تمت إعادة العرض إلى الوضع الافتراضي",
  ```

  Arabic wording is the owner's to adjust later through Settings; these are the defaults.

- [ ] **Step 5: Write the failing component tests**

  Create `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals/QueueSplitResizer.test.tsx`. Test the component **in isolation** against a hand-built grid fixture — do **not** mount the whole `XrayReferrals` view for this. jsdom computes no layout, so the fixture stubs `getBoundingClientRect` and the container's computed `direction`, which is exactly the geometry under test.

  ```tsx
  /* @vitest-environment jsdom */
  // The divider is pure geometry, and jsdom has none — so the fixture supplies
  // it explicitly. That is the point: the two things that can actually be wrong
  // here are (a) the RTL sign (dragging left must WIDEN the right-hand queue,
  // not narrow it) and (b) the clamp against the two pixel minimums the CSS
  // still enforces underneath. Both are computed in JS, both are testable, and
  // neither is visible in a screenshot until it is already wrong.
  import { afterEach, beforeEach, describe, expect, it } from "vitest";
  import { cleanup, fireEvent, render } from "@testing-library/react";
  import { __resetQueueSplitCacheForTests, getQueueSplit } from "../../../../../../data/preferences/queueSplitStore";
  import QueueSplitResizer from "./QueueSplitResizer";

  const GRID_LEFT = 100;
  const GRID_WIDTH = 1000;   // right edge at 1100

  function renderInGrid(direction: "rtl" | "ltr" = "rtl") {
    const grid = document.createElement("div");
    grid.className = "ew-ref-queue ew-xr-grid";
    grid.style.direction = direction;
    grid.getBoundingClientRect = () => ({
      left: GRID_LEFT, right: GRID_LEFT + GRID_WIDTH, width: GRID_WIDTH,
      top: 0, bottom: 800, height: 800, x: GRID_LEFT, y: 0, toJSON: () => ({}),
    }) as DOMRect;
    const panelCol = document.createElement("div");
    panelCol.className = "ew-xr-panel-col";
    grid.appendChild(panelCol);
    document.body.appendChild(grid);
    const view = render(<QueueSplitResizer />, { container: panelCol });
    return { grid, view };
  }

  beforeEach(() => { localStorage.clear(); __resetQueueSplitCacheForTests(); });
  afterEach(() => { cleanup(); document.body.innerHTML = ""; });

  it("applies the stored split to the grid on first paint, not after a delay", () => {
    // Applied from a layout effect: applying it from an ordinary effect would
    // paint one frame at the default and then jump, which reads as a layout bug
    // on every visit to this page.
    localStorage.setItem("xray_queue_split_v1", "0.62");
    __resetQueueSplitCacheForTests();
    const { grid } = renderInGrid();
    expect(grid.style.getPropertyValue("--ew-xr-queue-basis")).toBe("62%");
  });

  it("RTL: dragging LEFT widens the queue column", () => {
    const { grid, view } = renderInGrid("rtl");
    const handle = view.getByRole("separator");
    fireEvent.pointerDown(handle, { clientX: 635, pointerId: 1, button: 0 });
    fireEvent.pointerMove(handle, { clientX: 500, pointerId: 1 });   // moved left
    // Queue occupies from the grid's RIGHT edge to the pointer: 1100 - 500 = 600.
    expect(grid.style.getPropertyValue("--ew-xr-queue-basis")).toBe("60%");
    fireEvent.pointerUp(handle, { clientX: 500, pointerId: 1 });
    expect(getQueueSplit()).toBeCloseTo(0.6, 3);
  });

  it("LTR: the same drag narrows it — direction comes from the container, not a constant", () => {
    const { grid, view } = renderInGrid("ltr");
    const handle = view.getByRole("separator");
    fireEvent.pointerDown(handle, { clientX: 635, pointerId: 1, button: 0 });
    fireEvent.pointerMove(handle, { clientX: 500, pointerId: 1 });
    // Queue occupies from the grid's LEFT edge to the pointer: 500 - 100 = 400.
    expect(grid.style.getPropertyValue("--ew-xr-queue-basis")).toBe("40%");
  });

  it("refuses to drag either column below the minimum the CSS still enforces", () => {
    const { grid, view } = renderInGrid("rtl");
    const handle = view.getByRole("separator");
    fireEvent.pointerDown(handle, { clientX: 635, pointerId: 1, button: 0 });
    // Far past the right edge: would give the panel column ~0px.
    fireEvent.pointerMove(handle, { clientX: 90, pointerId: 1 });
    const basis = Number.parseFloat(grid.style.getPropertyValue("--ew-xr-queue-basis"));
    // 1000px container, 14px gutter, 430px panel floor ⇒ queue ≤ 55.6%.
    expect(basis).toBeLessThanOrEqual(55.6);
    // …and the opposite end respects the queue's own 340px floor.
    fireEvent.pointerMove(handle, { clientX: 1090, pointerId: 1 });
    expect(Number.parseFloat(grid.style.getPropertyValue("--ew-xr-queue-basis")))
      .toBeGreaterThanOrEqual(34);
  });

  it("persists only on release, never on every pointermove", () => {
    const { view } = renderInGrid("rtl");
    const handle = view.getByRole("separator");
    fireEvent.pointerDown(handle, { clientX: 635, pointerId: 1, button: 0 });
    fireEvent.pointerMove(handle, { clientX: 520, pointerId: 1 });
    expect(localStorage.getItem("xray_queue_split_v1")).toBeNull();
    fireEvent.pointerUp(handle, { clientX: 520, pointerId: 1 });
    expect(localStorage.getItem("xray_queue_split_v1")).not.toBeNull();
  });

  it("is operable from the keyboard, and Home resets it", () => {
    const { grid, view } = renderInGrid("rtl");
    const handle = view.getByRole("separator");
    // ArrowLeft moves the divider LEFT, which in RTL widens the queue.
    const before = Number.parseFloat(grid.style.getPropertyValue("--ew-xr-queue-basis"));
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(Number.parseFloat(grid.style.getPropertyValue("--ew-xr-queue-basis"))).toBeGreaterThan(before);
    fireEvent.keyDown(handle, { key: "Home" });
    expect(localStorage.getItem("xray_queue_split_v1")).toBeNull();
  });

  it("exposes its position to assistive tech", () => {
    const { view } = renderInGrid("rtl");
    const handle = view.getByRole("separator");
    expect(handle).toHaveAttribute("aria-orientation", "vertical");
    expect(handle).toHaveAttribute("aria-valuenow");
    expect(handle).toHaveAttribute("tabindex", "0");
  });
  ```

  > jsdom does not implement `setPointerCapture`/`releasePointerCapture`. Stub them on the handle element in the fixture (`handle.setPointerCapture = () => {}`), or guard the calls in the component with `typeof el.setPointerCapture === "function"`. **Guard in the component** — it costs one line and means the component cannot throw on a browser or environment that lacks it either.

- [ ] **Step 6: Run to verify they fail, then write the component**

  ```bash
  npx vitest run src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals/QueueSplitResizer.test.tsx
  ```

  Expected: FAIL — the module does not exist.

  Create `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals/QueueSplitResizer.tsx`:

  ```tsx
  import { useCallback, useLayoutEffect, useRef, useState } from "react";
  import {
    DEFAULT_QUEUE_SPLIT, MAX_QUEUE_SPLIT, MIN_QUEUE_SPLIT, QUEUE_SPLIT_CSS_VAR,
    getQueueSplit, resetQueueSplit, setQueueSplit,
  } from "../../../../../../data/preferences/queueSplitStore";
  import { useLabels } from "../../../../../../data/labels/useLabels";

  /**
   * The draggable divider between the queue and the inspection panel.
   *
   * ## Why it writes the DOM instead of React state
   *
   * `XrayReferrals` is a ~1,420-line component owning a full DataTable, and it
   * sits 28 lines under the repo's `max-lines-per-function` budget. Routing a
   * 60 Hz pointer stream through its state would re-render the whole queue on
   * every frame for a change CSS can absorb on its own. So the live drag calls
   * `setProperty` on the grid element directly and the store is written exactly
   * once, on release. The parent's entire involvement is rendering this element.
   *
   * ## Why it finds its own container
   *
   * `XrayReferrals.css` places every child of `.ew-xr-grid` by explicit grid
   * line number, precisely so a conditional child cannot re-flow the panel
   * underneath the pagination (see that file's own comments). Rather than
   * become another placed child, this handle is absolutely positioned inside
   * `.ew-xr-panel-col` — which already spans the full height of the gutter —
   * and reaches its grid through `closest()`. No grid placement rule changes.
   *
   * ## Why the geometry is absolute, not a delta
   *
   * The queue's width is read straight off the pointer position relative to the
   * container edge (which edge depends on the container's computed `direction`,
   * so RTL and LTR are both correct without a hard-coded sign). Accumulating
   * deltas would let the divider drift away from the cursor over a long drag.
   *
   * The two pixel minimums stay in the CSS (`minmax(340px, …)` /
   * `minmax(430px, …)`); the clamp here mirrors them so the handle STOPS where
   * the layout stops, instead of continuing to move while nothing changes.
   */
  ```

  Implementation notes for the body (write it small — this file should be well under 150 lines):

  - `const handleRef = useRef<HTMLDivElement>(null);` and `const gridOf = () => handleRef.current?.closest<HTMLElement>(".ew-xr-grid") ?? null;`
  - `const [ratio, setRatio] = useState(getQueueSplit);` — used **only** for `aria-valuenow` and for keyboard steps, never as the drag's source of truth.
  - `apply(grid, value)` → `grid.style.setProperty(QUEUE_SPLIT_CSS_VAR, `${(value * 100).toFixed(2)}%`)`. Trim trailing zeros so the tests' `"62%"` / `"60%"` assertions hold (`String(Number(x.toFixed(2)))` + `"%"`).
  - `useLayoutEffect(() => { const grid = gridOf(); if (grid) apply(grid, getQueueSplit()); }, []);` — a layout effect, so the first painted frame is already at the stored width.
  - `clampFor(grid, value)`: read `grid.getBoundingClientRect().width`; `const gap = 14;` (matches `column-gap` in the CSS — put the number in one named constant with a comment pointing at the CSS rule); `min = Math.max(MIN_QUEUE_SPLIT, 340 / width)`; `max = Math.min(MAX_QUEUE_SPLIT, (width - gap - 430) / width)`; if `min > max` (container too narrow for both floors — the stacked case) return the default and skip. Return the clamped value.
  - `onPointerDown`: ignore anything but `button === 0`; `event.preventDefault()`; bail if `handleRef.current.offsetParent === null` (the `@media` rule has hidden it — the columns are stacked and there is nothing to split); guard-call `setPointerCapture(event.pointerId)`; set `document.body.style.cursor = "col-resize"` and `userSelect = "none"`.
  - `onPointerMove` (only while a `draggingRef` flag is up): compute `rtl` from `getComputedStyle(grid).direction`, derive `queueWidth`, clamp, `apply`. **No `setState` here.**
  - `onPointerUp` / `onPointerCancel`: restore `body.style.cursor`/`userSelect`, release capture, then `setRatio(setQueueSplit(lastRatioRef.current))` — the single persist.
  - `onKeyDown`: `ArrowLeft`/`ArrowRight` step ±0.02 **in the pointer-space direction** (i.e. in RTL, `ArrowLeft` increases the queue ratio; in LTR it decreases it), clamped and persisted immediately (a keyboard nudge has no "release"). `Home` → `resetQueueSplit()`, re-apply, `setRatio(DEFAULT_QUEUE_SPLIT)`. `event.preventDefault()` on each handled key so the page does not scroll.
  - `onDoubleClick`: same reset as `Home`.
  - Render:
    ```tsx
    <div
      ref={handleRef}
      className="ew-xr-split-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label={L.ew_queue_split_handle_aria}
      title={L.ew_queue_split_handle_title}
      aria-valuenow={Math.round(ratio * 100)}
      aria-valuemin={Math.round(MIN_QUEUE_SPLIT * 100)}
      aria-valuemax={Math.round(MAX_QUEUE_SPLIT * 100)}
      tabIndex={0}
      onPointerDown={…} onPointerMove={…} onPointerUp={…} onPointerCancel={…}
      onKeyDown={…} onDoubleClick={…}
    />
    ```

  Re-run the test file to green.

- [ ] **Step 7: Wire the CSS and the one JSX line**

  In `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals/XrayReferrals.css`, lines **22-39**:

  ```css
  .ew-ref-queue.ew-xr-grid {
    display: grid;
    /* The handoff's own track definition. Both minimums are real: the queue can
       never be squeezed below 340px (it scrolls horizontally instead — see
       `.dt-table` below), and the form column never below 430px. */
    grid-template-columns: minmax(340px, 1.15fr) minmax(430px, 1fr);
  ```

  becomes:

  ```css
  .ew-ref-queue.ew-xr-grid {
    display: grid;
    /* The handoff's own track definition. Both minimums are real: the queue can
       never be squeezed below 340px (it scrolls horizontally instead — see
       `.dt-table` below), and the form column never below 430px — and they stay
       real once the divider is draggable: CSS clamps before the ratio does.
       The first track is a PERCENTAGE rather than the original `1.15fr` because
       a custom property cannot produce an `fr` (`var(--x) fr` is invalid, and
       `fr` inside `calc()` is not usable here). 53.49% is 1.15 ÷ 2.15 — the
       proportion this grid has always rendered. QueueSplitResizer overwrites the
       property on the element; the fallback here is what an untouched install,
       or a cleared localStorage, gets. */
    grid-template-columns: minmax(340px, var(--ew-xr-queue-basis, 53.49%)) minmax(430px, 1fr);
  ```

  After the `.ew-xr-panel-col` rule (lines **74-80**) add `position: relative;` to it, then a new block:

  ```css
  /* ── The draggable divider (QueueSplitResizer.tsx) ───────────────────────── */

  /* Deliberately NOT a grid child. Every child of this grid is placed by
     explicit line number (see the comments above and the `--with-bar` variant),
     so a new one would need placement rules in both variants and would be one
     more thing that can re-flow the panel under the pagination. Absolutely
     positioning it into the 14px gutter at the panel column's inline-start edge
     needs no grid change at all, and `.ew-xr-panel-col` already spans exactly
     the rows the divider should cover. `inset-inline-start` puts it on the
     correct side in RTL and LTR alike. */
  .ew-xr-split-handle {
    position: absolute;
    inset-block: 0;
    inset-inline-start: -14px;      /* == column-gap */
    width: 14px;
    z-index: 2;
    cursor: col-resize;
    background: none;
    border: none;
    touch-action: none;             /* the pointer stream is ours, not a scroll */
  }

  /* The visible line is a 2px rule centred in the gutter — the hit area stays
     the full 14px, because a 2px target is not one. */
  .ew-xr-split-handle::before {
    content: "";
    position: absolute;
    inset-block: 0;
    inset-inline-start: 6px;
    width: 2px;
    border-radius: 999px;
    background: var(--c-border);
    transition: background 120ms ease;
  }

  .ew-xr-split-handle:hover::before,
  .ew-xr-split-handle:focus-visible::before {
    background: var(--c-navy);
  }

  .ew-xr-split-handle:focus-visible {
    outline: 2px solid var(--c-navy);
    outline-offset: -2px;
  }
  ```

  And inside the `@media (max-width: 1100px)` block (lines **283-321**), where the two columns stack and there is no split to drag:

  ```css
    /* Stacked: there is no gutter and no split. The component also refuses to
       start a drag while `offsetParent` is null, so hiding it here is the whole
       disable — no second code path. */
    .ew-xr-split-handle { display: none; }
  ```

  Then, in `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx`, add the import beside the other `./XrayReferrals/*` imports (after line 122's `useCaseFilter` import):

  ```ts
  import QueueSplitResizer from "./XrayReferrals/QueueSplitResizer";
  ```

  and render it as the first child of the panel column (line **2000**):

  ```tsx
              <div className="ew-xr-panel-col">
                {panelEntry ? (
  ```

  becomes:

  ```tsx
              <div className="ew-xr-panel-col">
                <QueueSplitResizer />
                {panelEntry ? (
  ```

  **+1 line inside the component body** (1427 → ~1428 of 1450). It sits outside the `panelEntry ? … : …` ternary on purpose: the divider must be draggable whether or not a sample is open, and the empty-state placeholder (`.ew-ref-empty-panel`) occupies the same column.

- [ ] **Step 8: Verify the whole page still renders, and confirm the split in a real browser**

  ```bash
  npx vitest run src/components/Sidebar/Tabs/EmployeeWorkspace/views/
  ```

  `queueLayout.test.tsx` is the one to watch: it asserts the DOM **shape** the grid placement depends on (DataTable's fragment children must stay direct siblings of the grid). Adding a child inside `.ew-xr-panel-col` does not change that, but if it fails, read the failure before touching the test.

  Then, in Chrome or Edge (`npm run dev`), with a workspace mounted and a month with distributed samples:

  1. The divider is visible in the gutter, shows a `col-resize` cursor, and drags smoothly — the queue widens when dragged **left** (RTL) and the panel widens when dragged right.
  2. Neither column can be dragged into collapse; the handle stops where the layout stops.
  3. Reload the page: the chosen width is still there.
  4. Double-click the divider, and separately focus it with `Tab` and press `Home`: both snap back to the default.
  5. Narrow the window below 1100px: the columns stack and the divider disappears; widen again and it returns with the stored ratio intact.
  6. Change the UI scale in Settings (both the zoom and the table-height slider) and confirm the split still behaves — this is the interaction the owner's original report was really about.
  7. Open a sample, drag the divider, and confirm the inspection form re-lays out without losing typed input.

- [ ] **Step 9: Full tier-3 gate sweep**

  ```bash
  npm run test:run
  npm run typecheck
  npm run lint
  npm run check:complexity
  npm run check:hex-literals
  npm run check:vendor
  npm run build
  npm run check:bundle-size
  npm run check:release
  ```

  `check:complexity` must be clean on `XrayReferrals.tsx` — this plan's three tasks together should leave it near **1428 of 1450**. `check:bundle-size` should barely move (one small component, one small store). `check:release` runs last, after the edit log is written.

- [ ] **Step 10: Edit log (tier 3 — with migration/rollback), then commit**

  ```bash
  npm run editlog -- --tier=3 --append --sync-package \
    "Add (xray-referrals): a draggable, persisted split between the queue and the inspection panel"
  ```

  The tier-3 entry additionally needs:

  - **Migration:** none required. `xray_queue_split_v1` is absent on every existing install, and the CSS fallback (`53.49%`) reproduces the previous `1.15fr / 1fr` proportion, so an untouched workspace renders as before.
  - **Rollback:** revert the commit. The orphaned `localStorage` key is inert (nothing reads it), and can be cleared from the Settings storage panel — but remove its `STORAGE_REGISTRY` entry as part of the revert, or `clearOwnedStorage` keeps claiming a key nothing owns.
  - The whole-repo line total from `npm run count-lines -- --quiet` (the generator fills this in).

  ```bash
  git add src/data/preferences/queueSplitStore.ts src/data/preferences/queueSplitStore.test.ts \
          src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals/QueueSplitResizer.tsx \
          src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals/QueueSplitResizer.test.tsx \
          src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals/XrayReferrals.css \
          src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx \
          src/data/labels/labelsStore.ts src/data/storage/storageRegistry.ts \
          "docs/edit logs/2026-08-24.md" package.json
  git commit -m "Add (xray-referrals): a draggable, persisted split between the queue and the inspection panel" -- \
          src/data/preferences/queueSplitStore.ts src/data/preferences/queueSplitStore.test.ts \
          src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals/QueueSplitResizer.tsx \
          src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals/QueueSplitResizer.test.tsx \
          src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals/XrayReferrals.css \
          src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx \
          src/data/labels/labelsStore.ts src/data/storage/storageRegistry.ts \
          "docs/edit logs/2026-08-24.md" package.json
  ```

---

## Testing summary

| Gate | Tasks 1-2 (tier 2) | Task 3 (tier 3) |
|---|---|---|
| `npm run test:run` | ✔ | ✔ |
| `npm run typecheck` | ✔ | ✔ |
| `npm run lint` | ✔ | ✔ |
| `npm run check:complexity` | ✔ **(added — see Global Constraints)** | ✔ |
| `npm run check:hex-literals` | — | ✔ |
| `npm run check:vendor` / `check:release` / `check:bundle-size` | — | ✔ |
| `npm run build` | ✔ before pushing | ✔ before pushing |
| **Real-browser run (Chrome/Edge)** | ✔ **required for Task 1** (Step 7) | ✔ required (Step 8) |

`docs/product/RELEASE_CHECKLIST.md` remains the authority if this branch is actually cut as a release.

## Key files touched

| Task | Files |
|---|---|
| 1 (save broadcast) | `views/XrayReferrals.tsx`, `views/XrayReferrals.saveBroadcast.test.tsx` (new) |
| 2 (draft flag) | `views/XrayReferrals.tsx`, `views/XrayReferrals.monthChangeGuard.test.tsx` |
| 3 (resizable split) | `data/preferences/queueSplitStore.ts` + `.test.ts` (new), `views/XrayReferrals/QueueSplitResizer.tsx` + `.test.tsx` (new), `views/XrayReferrals/XrayReferrals.css`, `views/XrayReferrals.tsx`, `data/labels/labelsStore.ts`, `data/storage/storageRegistry.ts` |

*(All paths relative to `src/components/Sidebar/Tabs/EmployeeWorkspace/` or `src/`, as shown.)*

---

## Addendum — the one genuine scaling imperfection found (NOT part of any task above)

Reading `XrayReferrals.css` end to end for Task 3 turned up exactly one place where the UI-scale wiring is not what the rest of the file does. It is **not** the owner's reported problem, it is small, and changing it alters rendered heights, so it is recorded here for an owner decision rather than folded into a task.

**`XrayReferrals.css:304-308`**, inside `@media (max-width: 1100px)`:

```css
  .ew-ref-queue.ew-xr-grid > .dt-table-wrap,
  .ew-ref-queue.ew-xr-grid--with-bar > .dt-table-wrap {
    min-height: clamp(320px, 46vh, 520px);
    max-height: clamp(320px, 46vh, 520px);
  }
```

Two things differ from the wide-viewport rule 250 lines above it (lines 51-61), which reads `min-height: var(--ui-queue-floor)` and `max-height: max(var(--ui-queue-floor), calc((var(--app-vh) - 240px) * var(--ui-table-height-scale)))`:

1. **`46vh` is a raw viewport unit.** `uiScaleCss.contract.test.ts` only bans `100vh`/`100vw`, so this passes — but the reason `100vh` is banned applies here identically: `vh` resolves against the viewport in CSS pixels and is *then* scaled by the root `zoom`, so at `--ui-scale: 0.8` this table renders 80 % of the intended height. The corrected form is `calc(var(--app-vh) * 0.46)`.
2. **It ignores `--ui-table-height-scale` entirely.** In the stacked layout the Settings table-height slider does nothing to this page.

Both are arguably one bug. The fix would be:

```css
    min-height: clamp(320px, calc(var(--app-vh) * 0.46), 520px);
    max-height: clamp(320px, calc(var(--app-vh) * 0.46 * var(--ui-table-height-scale)), 520px);
```

**Why it is not a task here:** it changes the rendered height of the queue on every viewport under 1100px, which is a visible change the owner has not asked for, and the `clamp()` floor/ceiling would want re-picking once the multiplier applies (a 0.5× table-height setting would clamp at 320px and do nothing). If it is taken up, it belongs in its own tier-2 edit with its own before/after screenshots at 0.6×, 1×, and 1.4× scale — and probably with a matching extension to `uiScaleCss.contract.test.ts` so *every* raw `vh` in this repo's CSS, not just `100vh`, has to justify itself.
