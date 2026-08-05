# Post-Login Boot Splash + Sync-Signal Extension Implementation Plan [DONE — shipped]

> **STATUS: ✅ DONE.** Sync-signal extension (3-minute interval, Population wired into `subscribeToDataRefresh`) and the initial boot splash shipped together at v59.189–v59.190 (commit `56f52ee4`). The boot splash then went through 5 more fix rounds the same evening (v59.190–v59.197, commits `9e77490e`..`a7d13826`) after independent review kept finding subtle effect-timing/staleness regressions — see `docs/edit logs/2026-08-04.md` for the full trail. No open findings remained as of the last review.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After login, show a brief named-source loading checklist (English name + Arabic label + status) for exactly the landing tab's own data sources — no more, no less than what already loads today — then reveal the app once those sources are ready, so an employee/supervisor/etc. never hits an in-task freeze from data that's still loading. Separately, extend the existing `subscribeToDataRefresh` periodic-tick signal (currently 5 minutes, already pauses while hidden) to a 3-minute interval and wire Population's own loader into it, since Population is the actual landing tab for 4 of 5 roles and today does not subscribe at all.

**Architecture:** A new lightweight pub/sub store (`bootProgress.ts`) lets each ALREADY-EXISTING loader (Population's `useMonthLoad.ts`, Employee Workspace's `XrayReferrals.tsx` `loadData`) report "I'm now loading `<key>`" / "I'm done" — no loader logic is duplicated or rebuilt; this plan only *instruments* what already runs. A new overlay component subscribes to that store and renders a checklist while the (already-mounted, already-running) landing tab's own effects do their normal work underneath, hidden. Once every source registered for the current role reports loaded (or a timeout elapses), the overlay fades and the app is revealed exactly as it renders today. This deliberately avoids building a second, parallel data-loading mechanism — it makes the EXISTING demand-gated loads (Phase A, `computeMonthLoadScope`) visible, not different.

**Tech Stack:** No new dependencies. React context/hook for the pub/sub store; existing `LoadingState`/checklist patterns (`FirstRunChecklist` in `WorkspaceGate.tsx` is the closest structural precedent — an array of `{done, title, desc}`-shaped steps — mirror its visual style, not its onboarding-specific logic).

## Global Constraints

- **User-approved scope, 2026-08-04: landing-tab sources only, not the full tab-catalog breadth.** A splash that waits for every tab a role can reach would directly regress `computeMonthLoadScope`'s Phase A gating (shipped/verified same day, commit `5801c7b0`) and the sub-tab lazy-mount pattern in `EmployeeWorkspace/index.tsx`. Do not expand scope beyond the landing tab's own sources without re-confirming with the user first — this was an explicit, considered decision, not a default.
- **Never duplicate a loader.** Every named source in the boot checklist must be reported BY the same function that already fetches it today (`useMonthLoad.ts` for Population's `summary`/`sample`/`distribution`/conditionally `population`/`raw`; `XrayReferrals.tsx`'s `loadData` for Employee's samples/answers/distribution). If a task in this plan finds itself writing a second read of the same file to "know when it's done," stop — that's the wrong shape; instrument the existing call instead.
- **Respect `computeMonthLoadScope`'s existing capability gating exactly.** For roles that land on Population, the checklist's source list itself must vary by capability (a `guest`/plain `supervisor` shows `summary`/`sample`/`distribution` only — never `population`/`raw`, matching what actually loads today; only a role with `canDrawSample`/`canProcessPopulation` shows the extra 2 sources). Do not show a source in the checklist that this role/scope combination doesn't actually load — that would misrepresent what's happening and reintroduce exactly the "load things nobody needs" waste Phase A removed.
- **Boot boundary placement:** per this session's own just-established precedent (`GlobalMonthProvider` moved inside `AuthGate` specifically so it never fires before a session exists, `v59.169`, today), the boot-progress overlay must sit AFTER authentication and AFTER `usersHydrated` is true — i.e. inside `AppContent`, not in `AuthGate`/`WorkspaceGate` themselves. Do not touch `AuthGate.tsx`'s or `WorkspaceGate.tsx`'s own gating logic in this plan.
- **Timeout, not an infinite block.** If a source's load takes unusually long (slow network share, huge population), the overlay must reveal the app anyway after a bounded wait (propose 8 seconds — long enough that the common case never hits it, short enough that a genuinely slow environment isn't stuck staring at a checklist) rather than blocking forever. The underlying tab still shows its own existing in-place loading state for whatever wasn't ready — this plan does not change that fallback behavior, it only removes the common-case freeze.
- **Sync-signal extension (Tasks 5-6) must extend `dataRefreshSignal.ts`, never introduce a second signal.** This session already made a deliberate architectural choice today (`v59.168`) that periodic ticks stay cheap/non-disruptive by default (only `"manual"` triggers a full cache reset) — any new Population-tab subscriber must follow that same `{silent: true}`-style non-disruptive pattern already used by `XrayReferrals.tsx`/`XrayInspectionResults.tsx`, not force a jarring reload.
- **File-collision note (real, not hypothetical):** a separate, concurrently-running bug-fix task in this same session is ALSO editing `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx` right now (adding `{silent: true}` to its replace/reassign success handlers). Task 4 of THIS plan also touches that file. **Task 4 must not be dispatched until that other work has landed and this plan's controller has re-read the file's current state** — do not blindly diff against this plan's brief's assumptions about the file's current shape.
- Follow CLAUDE.md's edit-log requirement for every task; per this session's established pattern, implementers skip `docs/edit logs/2026-08-04.md` and `package.json`, the controller applies a combined entry afterward.

---

### Task 1: `bootProgress.ts` — the pub/sub store (fully standalone, zero dependencies on other tasks)

**Files:**
- Create: `src/data/workspace/bootProgress.ts`
- Create: `src/data/workspace/bootProgress.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type BootSourceStatus = "pending" | "loading" | "loaded" | "error";

  export type BootSourceKey = string;  // e.g. "population_summary", "employee_samples"

  export type BootSourceEntry = {
    key: BootSourceKey;
    labelEn: string;   // e.g. "population.final.json" — the actual on-disk name, per the user's literal ask ("name in folder")
    labelAr: string;   // e.g. "بيانات المجتمع المعالجة"
    status: BootSourceStatus;
    error?: string;
  };

  // Called once per boot session (login) to declare which sources THIS role/scope will load — must be called before any markX call for those keys.
  export function registerBootSources(entries: Array<{ key: BootSourceKey; labelEn: string; labelAr: string }>): void;
  export function markBootSourceLoading(key: BootSourceKey): void;
  export function markBootSourceLoaded(key: BootSourceKey): void;
  export function markBootSourceError(key: BootSourceKey, error: string): void;
  export function resetBootProgress(): void;  // called on logout/workspace change

  // React hook — subscribes to the store, re-renders on any change.
  export function useBootProgress(): {
    entries: BootSourceEntry[];
    allLoaded: boolean;   // true once every REGISTERED entry is "loaded" (registered-but-pending sources count against this; unregistered keys are irrelevant)
  };
  ```
  Internal implementation: a module-level `Map<BootSourceKey, BootSourceEntry>` plus a simple listener-set (same "plain pub/sub, no external state library" shape as `dataRefreshSignal.ts` — read that file first for the house style to match, even though this store's shape is a Map, not a single CustomEvent).

- [ ] **Step 1: Read `src/data/workspace/dataRefreshSignal.ts` in full** (46 lines) for this codebase's house style for a small pub/sub module — match its conventions (no external state library, plain module-level state + subscribe/unsubscribe functions returning a cleanup).

- [ ] **Step 2: Write failing tests first**: registering sources initializes them as `"pending"`; `markBootSourceLoading`/`markBootSourceLoaded`/`markBootSourceError` transition status correctly and notify subscribers; `useBootProgress`'s `allLoaded` is `false` while any registered entry isn't `"loaded"` and `true` once all are (an `"error"` entry does NOT block `allLoaded` — a failed source shouldn't hang the whole boot forever, it should surface as an error badge but let the app open); `resetBootProgress` clears everything (needed for logout → login-as-different-role, or workspace switch, so a stale role's source list doesn't bleed into the next session).

- [ ] **Step 3: Implement** to pass those tests.

- [ ] **Step 4: Run tests, typecheck, lint.**
Run: `npx vitest run src/data/workspace/bootProgress.test.ts && npm run typecheck && npm run lint:ci`

- [ ] **Step 5: Commit**
```bash
git add src/data/workspace/bootProgress.ts src/data/workspace/bootProgress.test.ts
git commit -m "Add (workspace): bootProgress pub/sub store for the post-login source checklist"
```

---

### Task 2: `BootSplashOverlay.tsx` — the checklist UI (depends on Task 1)

**Files:**
- Create: `src/components/Sidebar/BootSplashOverlay.tsx`
- Create: `src/components/Sidebar/BootSplashOverlay.test.tsx`
- Read (do not modify): `src/data/workspace/WorkspaceGate.tsx` lines ~447-596 (`FirstRunChecklist` — the closest visual/structural precedent, an array of step objects rendered as a checklist; mirror its visual style, this is NOT the same feature, don't reuse its onboarding logic)

**Interfaces:**
- Consumes: `useBootProgress` from Task 1.
- Produces:
  ```tsx
  export function BootSplashOverlay({ children, timeoutMs = 8000 }: { children: ReactNode; timeoutMs?: number }): ReactElement;
  ```
  Renders `children` (the actual app content) ALWAYS mounted underneath (so the landing tab's own effects run normally and unaffected), with an opaque checklist overlay on top while `!allLoaded && !timedOut`. The checklist lists each `BootSourceEntry` with its `labelAr` (primary) and `labelEn` (secondary/small, matching the user's literal ask to see "name in folder"), a status icon (pending/loading spinner/loaded check/error mark). Starts a `timeoutMs`-duration timer on mount; if it elapses before `allLoaded`, hides the overlay anyway (do not block indefinitely — Global Constraints).

- [ ] **Step 1: Read `FirstRunChecklist`** for the visual pattern to mirror (not its logic).

- [ ] **Step 2: Write failing tests first**: overlay shows children hidden (still mounted, use `toBeInTheDocument`/visibility checks not absence) while sources are pending/loading; overlay disappears once `allLoaded` becomes true; overlay disappears after `timeoutMs` even if `allLoaded` is still false; an `"error"` entry renders an error indicator but does not prevent the overlay from later clearing once other entries finish (per Task 1's `allLoaded` semantics).

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run tests, typecheck, lint.**
Run: `npx vitest run src/components/Sidebar/BootSplashOverlay.test.tsx && npm run typecheck && npm run lint:ci`

- [ ] **Step 5: Commit**
```bash
git add src/components/Sidebar/BootSplashOverlay.tsx src/components/Sidebar/BootSplashOverlay.test.tsx
git commit -m "Add (ui): BootSplashOverlay — named source checklist shown while the landing tab's own data loads"
```

---

### Task 3: Instrument `useMonthLoad.ts` (Population's loader — 4 of 5 roles' landing tab)

**Files:**
- Modify: `src/components/Sidebar/Tabs/Population/useMonthLoad.ts`
- Modify: its existing test file (find via `git ls-files`)

**Interfaces:**
- Consumes: `registerBootSources`/`markBootSourceLoading`/`markBootSourceLoaded`/`markBootSourceError` from Task 1.
- Adds NO new public API to `useMonthLoad.ts` itself — this is pure instrumentation of its EXISTING load calls.

**Context:** Read `computeMonthLoadScope` (`populationWorkflowHelpers.ts`, committed today at `5801c7b0`) and `useMonthLoad.ts` in full first. The scope this hook already computes (`summary`/`sample`/`distribution` always; `population`/`raw` conditionally) is EXACTLY the source list to register — do not invent a different list.

- [ ] **Step 1: Read both files in full.** Confirm exactly which async calls correspond to which named source (manifest read, `population.final.json`, `sample.master.json`, `distribution.current.json`, raw risk/BI).

- [ ] **Step 2: Register sources at the point `computeMonthLoadScope`'s result is known**, with labels matching real on-disk file names, e.g.:
  ```ts
  registerBootSources([
    { key: "population_summary", labelEn: "processing.summary.json", labelAr: "ملخص المعالجة" },
    { key: "population_sample", labelEn: "sample.master.json", labelAr: "العينة" },
    { key: "population_distribution", labelEn: "distribution.current.json", labelAr: "التوزيع" },
    ...(scope.population ? [{ key: "population_final", labelEn: "population.final.json", labelAr: "بيانات المجتمع المعالجة" }] : []),
    ...(scope.raw ? [{ key: "population_raw", labelEn: "risk.raw.json / bi.raw.json", labelAr: "البيانات الخام" }] : []),
  ]);
  ```
  (Adjust exact keys/labels to match the hook's real internal naming — this is a sketch, not a literal requirement.)

- [ ] **Step 3: Wrap each existing async load call** with `markBootSourceLoading(key)` before it starts and `markBootSourceLoaded(key)`/`markBootSourceError(key, ...)` on settle — do not change what's being loaded or its error handling, only add these calls around the existing ones.

- [ ] **Step 4: Update/extend existing tests** to assert the new boot-progress calls fire correctly for a representative scope (with and without `population`/`raw` included) — do not weaken or remove any existing assertion.

- [ ] **Step 5: Run tests, typecheck, lint.**
Run: `npx vitest run src/components/Sidebar/Tabs/Population/ && npm run typecheck && npm run lint:ci`

- [ ] **Step 6: Commit**
```bash
git add src/components/Sidebar/Tabs/Population/useMonthLoad.ts src/components/Sidebar/Tabs/Population/useMonthLoad.test.ts
git commit -m "Change (population): report useMonthLoad's existing loads to the boot-progress checklist"
```

---

### Task 4: Instrument `XrayReferrals.tsx`'s `loadData` (Employee's landing sub-tab) — DO NOT DISPATCH until the file-collision note in Global Constraints is resolved

**Files:**
- Modify: `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx`
- Modify: its existing test file

**Interfaces:** same pattern as Task 3, applied to whatever `loadData` in this file actually reads (samples, answers, sample master, distribution — confirm exact set by reading the function, don't assume).

**Context — read before dispatching:** a separate, already-dispatched bug-fix task in this session is editing this SAME file concurrently (adding `{silent: true}` to its replace/reassign-request success handlers). Before generating this task's brief, the controller must confirm that work has landed and re-read the file's current state — this plan's brief-writer must not work from a stale assumption of the file's shape.

- [ ] **Step 1: Read the current `loadData` function in full**, confirm what it fetches and its current signature (note: it may already take an options parameter like `{ silent?: boolean }` per the earlier bug-fix work — check).

- [ ] **Step 2: Register sources** for whatever `loadData` fetches (likely: `{username}.samples.json`, `{username}.answers.json`, `sample.master.json`, `distribution.current.json` — confirm against the real code).

- [ ] **Step 3: Wrap the existing fetch calls** with `markBootSourceLoading`/`markBootSourceLoaded`/`markBootSourceError`, same pattern as Task 3 — only on the INITIAL (non-silent, non-periodic-refresh) load, not on every `{silent: true}` background refresh (re-marking a source "loading" on every 5-minute silent tick would make the checklist flicker after the user is already past it — gate the boot-progress calls to the initial mount load specifically).

- [ ] **Step 4: Update/extend existing tests.**

- [ ] **Step 5: Run tests, typecheck, lint.**
Run: `npx vitest run src/components/Sidebar/Tabs/EmployeeWorkspace/ && npm run typecheck && npm run lint:ci`

- [ ] **Step 6: Commit**
```bash
git add src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.test.tsx
git commit -m "Change (employee-workspace): report XrayReferrals' initial load to the boot-progress checklist"
```

---

### Task 5: Wire the overlay into `AppContent` + per-role source registration (depends on Tasks 1-4)

**Files:**
- Modify: `src/App.tsx`

**Interfaces:** consumes `BootSplashOverlay` (Task 2); Tasks 3-4 already self-register their own sources when their owning component mounts, so this task does NOT need its own separate per-role source-list logic — it only needs to wrap the existing tab-rendering tree in `<BootSplashOverlay>` and call `resetBootProgress()` at the appropriate boundary (session/workspace change) per Global Constraints.

- [ ] **Step 1: Read `App.tsx`'s `AppContent` in full**, identify exactly where to place `<BootSplashOverlay>` (should wrap the `allowedTabs.map(...)` render block, per Global Constraints' "after usersHydrated, inside AppContent" placement) and where session/workspace-change already triggers a reset-shaped effect (mirror that for `resetBootProgress()`).

- [ ] **Step 2: Wrap and wire.**

- [ ] **Step 3: Run the whole suite + typecheck + lint + build**, confirm no regression in existing `App.tsx`/`App.landing.test.tsx` coverage (per this session's ambient-work policy, if `App.landing.test.tsx` is still someone else's uncommitted work at this point, verify it stays green, never edit it).
Run: `npm run test:run && npm run typecheck && npm run lint:ci && npm run build`

- [ ] **Step 4: Commit**
```bash
git add src/App.tsx
git commit -m "Change (app): wire BootSplashOverlay into the post-login render tree"
```

---

### Task 6: Extend `dataRefreshSignal` — 3-minute interval + wire Population in (independent of Tasks 1-5, but respects the same file-collision caution as Task 4 if Population's loader is mid-edit from Task 3 — sequence after Task 3 lands)

**Files:**
- Modify: `src/data/workspace/dataRefreshSignal.ts` (or wherever `AUTO_REFRESH_INTERVAL_MS` actually lives — confirm, research found it in `AuthGate.tsx:332-349`, not necessarily the signal file itself)
- Modify: `src/components/Sidebar/Tabs/Population/useMonthLoad.ts` or `Population/index.tsx` (add a `subscribeToDataRefresh` subscriber, following the exact `{silent: true}`-equivalent non-disruptive pattern already used by `XrayReferrals.tsx`/`XrayInspectionResults.tsx`)

**Context:** Confirmed by research: `AUTO_REFRESH_INTERVAL_MS = 5 * 60_000` lives in `AuthGate.tsx:332-349`, already pauses on `document.hidden`, already distinguishes `"manual"`/`"periodic"` sources. Population is the landing tab for `guest`/`supervisor`/`manager`/`admin` and currently has ZERO subscription to this signal.

- [ ] **Step 1: Read `AuthGate.tsx`'s periodic-tick block and `dataRefreshSignal.ts` in full.**

- [ ] **Step 2: Change `AUTO_REFRESH_INTERVAL_MS` from `5 * 60_000` to `3 * 60_000`.**

- [ ] **Step 3: Add a `subscribeToDataRefresh` subscriber to Population's loader**, calling the SAME reload path `useMonthLoad.ts` already exposes, in a non-disruptive mode that doesn't reset scroll/selection/in-progress-edit state (mirror `XrayReferrals.tsx`'s `{silent: true}` precedent exactly — if `useMonthLoad.ts` doesn't already have an equivalent silent-reload mode, this task must ADD one, following that file's existing pattern, not invent a new one).

- [ ] **Step 4: Test** that a `"periodic"` source event triggers Population's silent reload without disrupting active UI state (e.g. an open Phase 3 sampling dialog, if such state exists — check), and that a `"manual"` event still works as today.

- [ ] **Step 5: Run tests, typecheck, lint.**
Run: `npx vitest run src/data/workspace/ src/components/Sidebar/Tabs/Population/ && npm run typecheck && npm run lint:ci`

- [ ] **Step 6: Commit**
```bash
git add src/data/workspace/dataRefreshSignal.ts src/auth/AuthGate.tsx src/components/Sidebar/Tabs/Population/useMonthLoad.ts
git commit -m "Change (sync): shorten periodic refresh to 3 minutes, wire Population into the silent-refresh signal"
```
(Adjust file list to whatever Step 1-3 actually touch.)

---

## Task Order

**Task 1 first, alone.**

**Task 2 after Task 1.**

**Tasks 3 and 4 may run in parallel with each other** (disjoint files: `useMonthLoad.ts` vs `XrayReferrals.tsx`) once Task 1 is done — **but Task 4 specifically must wait for the concurrently-running bug-fix task (touching the same `XrayReferrals.tsx` file) to land first**, per Global Constraints.

**Task 5 after Tasks 2, 3, and 4 all land.**

**Task 6 is independent of Tasks 2/5 but touches `useMonthLoad.ts`, so sequence it after Task 3 lands** (avoid a second concurrent editor of that file).
