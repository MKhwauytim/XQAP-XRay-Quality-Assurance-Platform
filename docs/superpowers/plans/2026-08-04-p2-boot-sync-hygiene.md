# P2 Boot and Sync Hygiene Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the P2 action items from `docs/superpowers/specs/2026-08-03-reference-architecture-evaluation.md`'s "Prioritized, low-risk action items" section (items 5-8): stop the month-list provider from listing before login, stop the periodic background-refresh tick from discarding the append-only read cache it took all session to build, pause that same periodic tick while the tab is hidden, and collapse a pair of redundant focus/visibility listeners in the first-run banner.

**Architecture:** Four small, independently-reviewable, low-risk changes. No new shared module except a small addition to the existing `dataRefreshSignal.ts`'s payload shape (kept backward-compatible).

**Tech Stack:** React 19 hooks, Vitest + Testing Library.

## Global Constraints

- UI text is Arabic; this plan adds no new user-facing strings.
- `import type` for type-only imports.
- Manual refresh (the toolbar button in `AdminToolbar.tsx`) must keep working exactly as today in every task — none of these changes may make the manual refresh path weaker or slower.
- Follow CLAUDE.md's edit-log requirement for every task (version bump, Before/After, `npm run count-lines -- --quiet` before/after, category prefix).
- Scope note: item 7 in the source evaluation reads "pause the 5-minute interval while hidden; make it admin-configurable (1/3/5 min)." This plan implements only the pause-while-hidden half (Task 3) — a pure timer-policy fix with no new UI surface. The admin-configurable-interval half would require a new settings-storage type and a new Settings-tab UI section (a meaningfully larger, separate piece of work, not a "tiny, isolated" fix like the other three items here) and is deliberately deferred, not silently dropped — record it as a follow-up in the final edit-log entry for this plan.

---

### Task 1: Move `GlobalMonthProvider` inside `AuthGate` so it never lists months pre-login

**Files:**
- Modify: `src/App.tsx:323-339`
- Modify: `src/auth/AuthGate.tsx` (imports, and the render branch at what is currently lines 598-610)
- Test: `src/auth/AuthGate.test.tsx` (extend)

**Interfaces:**
- Consumes: `GlobalMonthProvider` from `../data/month/GlobalMonthProvider` (existing export, new import site).
- Produces: no new exports.

**Context:** `GlobalMonthProvider` currently wraps `AuthGate` from the outside (`App.tsx`: `WorkspacePicker > GlobalMonthProvider > AuthGate > (session-gated content)`). Its month-listing effect (`GlobalMonthProvider.tsx:48-78`) is gated on `directoryHandle` alone — and `directoryHandle` can already be non-null before a user has logged in, because `WorkspaceProvider` auto-reconnects to the last-used workspace independently of authentication (login itself needs the workspace connected to validate credentials against the synced `users.permissions.json`). This means a real disk `listMonthFolders` call can fire while the user is still looking at the login form — wasted I/O, worse on a slow UNC share.

The natural-looking alternative fix — gate the listing effect on "is there a session" using a plain `readSession()` check — does **not** work correctly: `readSession()` is not reactive (no subscription/pub-sub exists in `authSession.ts`), and `GlobalMonthProvider` sits *above* `AuthGate` in the tree, so it never re-renders when `AuthGate`'s internal `session` state changes on login. A `readSession()` check added to the existing `[directoryHandle]`-keyed effect would only ever be evaluated once per `directoryHandle` change — if a workspace is already connected pre-login (the exact case this fix targets) and the user then logs in without the workspace handle changing, the effect would never re-fire and `months` would stay empty forever. Making this reactive without moving the provider would require adding a new session-change subscription mechanism to `authSession.ts` — a bigger, less-contained change than moving one JSX wrapper.

Moving the provider is therefore the correct fix, not just the more literal reading of the evaluation's wording. **Verified no pre-login consumer of `months`/`useGlobalMonth()` exists**: `AuthGate.tsx` itself does not call `useGlobalMonth()`, and the login form (rendered in the `!session` branch) does not either. The one consumer rendered *before* the login form disappears — `AdminToolbar` (via `GlobalMonthSelector` → `useGlobalMonth()`) — is itself only rendered once `session` is truthy, as a sibling of the authenticated children inside `AuthGate`'s own `if (session)` return block (**not** inside the `children` render-prop `App.tsx` supplies) — so the provider must wrap *inside* `AuthGate.tsx`'s own render branch, not merely around the `children(session)` call passed down from `App.tsx`. Wrapping only the `App.tsx`-side content would leave `AdminToolbar` without a `GlobalMonthContext` ancestor and break `GlobalMonthSelector`.

- [ ] **Step 1: Write the failing test**

In `src/auth/AuthGate.test.tsx`, add a new `describe` block after the existing `"AuthGate — usersHydrated render gate (P1 item 4)"` block. This needs a component that calls `useGlobalMonth()` to prove the context is present once authenticated — use the existing `GlobalMonthContext`/`useGlobalMonth` re-export path the same way `GlobalMonthProvider.test.tsx` does, and control `listMonthFolders` via the `populationStorage` module (the same module `GlobalMonthProvider.tsx` imports it from) to prove it is NOT called before a session exists:

```tsx
describe("AuthGate — GlobalMonthProvider moved inside (P2 item 5)", () => {
  it("does not list month folders before a session exists, and provides GlobalMonthContext once authenticated", async () => {
    const listMonthFoldersSpy = vi.spyOn(populationStorage, "listMonthFolders");
    listMonthFoldersSpy.mockResolvedValue([]);

    const persistedSession: AuthSession = {
      role: "employee",
      username: NON_SEED_USERNAME,
      loginAt: new Date().toISOString(),
    };
    vi.spyOn(authSession, "readRealSession").mockReturnValue(persistedSession);
    mockReadyWorkspace("global-month-inside-authgate", [NON_SEED_USERNAME]);

    function MonthConsumer() {
      const { months } = useGlobalMonth();
      return <div data-testid="month-count">{months.length}</div>;
    }

    render(
      <WorkspaceProvider>
        <AuthGate>{() => <MonthConsumer />}</AuthGate>
      </WorkspaceProvider>,
    );

    // At first paint (before the workspace even reaches "ready"), no session
    // is authenticated from this component's own perspective as far as
    // month-listing is concerned -- listMonthFolders must not have fired yet
    // purely because a workspace happened to reconnect.
    expect(listMonthFoldersSpy).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(screen.getByTestId("month-count")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(listMonthFoldersSpy).toHaveBeenCalled();
    });
  });
});
```

Add the needed imports at the top of the file if not already present: `import * as populationStorage from "../data/population/populationStorage";` and `import { useGlobalMonth } from "../data/month/useGlobalMonth";`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/auth/AuthGate.test.tsx -t "GlobalMonthProvider moved inside"`
Expected: FAIL — `useGlobalMonth()` throws (no `GlobalMonthContext` ancestor yet, since `AuthGate` in this test is rendered without the outer `GlobalMonthProvider` `App.tsx` currently supplies).

- [ ] **Step 3: Move the provider in `App.tsx`**

In `src/App.tsx`, remove the `GlobalMonthProvider` import and its wrapping:

```tsx
function App() {
  return (
    <WorkspacePicker>
      <GlobalMonthProvider>
        <AuthGate>
          {(session) => (
            <WorkspaceGate session={session}>
              {/* key on role so switching the admin role-preview remounts the app,
                  forcing components that read the session once at mount to re-read it. */}
              <AppContent key={session.role} session={session} />
            </WorkspaceGate>
          )}
        </AuthGate>
      </GlobalMonthProvider>
    </WorkspacePicker>
  );
}
```

becomes:

```tsx
function App() {
  return (
    <WorkspacePicker>
      <AuthGate>
        {(session) => (
          <WorkspaceGate session={session}>
            {/* key on role so switching the admin role-preview remounts the app,
                forcing components that read the session once at mount to re-read it. */}
            <AppContent key={session.role} session={session} />
          </WorkspaceGate>
        )}
      </AuthGate>
    </WorkspacePicker>
  );
}
```

Remove the now-unused `import { GlobalMonthProvider } from "./data/month/GlobalMonthProvider";` line from `App.tsx`'s imports (find it near the other `data/month`/provider imports).

- [ ] **Step 4: Add the provider inside `AuthGate.tsx`**

Add the import near `AuthGate.tsx`'s other relative imports (e.g. after the `LoadingState` import added by the previous plan):

```ts
import { GlobalMonthProvider } from "../data/month/GlobalMonthProvider";
```

Then wrap the authenticated return block. Replace (currently the tail of the `if (session)` branch):

```tsx
    return (
      <>
        <AdminToolbar
          session={session}
          previewRole={previewRole}
          onPreviewRoleChange={changePreviewRole}
          onLogout={logout}
          onFeedback={() => window.dispatchEvent(new CustomEvent("feedback:toggle"))}
        />

        {renderAuthenticatedChildren(effectiveSession)}
      </>
    );
  }
```

with:

```tsx
    return (
      <GlobalMonthProvider>
        <AdminToolbar
          session={session}
          previewRole={previewRole}
          onPreviewRoleChange={changePreviewRole}
          onLogout={logout}
          onFeedback={() => window.dispatchEvent(new CustomEvent("feedback:toggle"))}
        />

        {renderAuthenticatedChildren(effectiveSession)}
      </GlobalMonthProvider>
    );
  }
```

(`GlobalMonthProvider`'s children prop accepts a single `ReactNode`, and JSX allows a component's children to be a sequence of elements/expressions the same as a Fragment would — no additional wrapping fragment is needed.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/auth/AuthGate.test.tsx -t "GlobalMonthProvider moved inside"`
Expected: PASS.

Then run the full `AuthGate.test.tsx` file (this now indirectly depends on `GlobalMonthProvider`'s own effects for every test that reaches the authenticated branch — the most likely place for an unexpected interaction):
Run: `npx vitest run src/auth/AuthGate.test.tsx`
Expected: all PASS.

Then run `GlobalMonthProvider.test.tsx`, `GlobalMonthSelector.test.tsx`, and any test file that renders `<App />` directly (search for `render(<App` or `import App from` under `src/`) to confirm nothing hard-coded the old provider position:
Run: `npx vitest run src/data/month/ src/components/GlobalMonthSelector/`
Expected: all PASS.

Then the whole suite:
Run: `npm run test:run`
Expected: all PASS.

- [ ] **Step 6: Edit log + commit**

```bash
git add src/App.tsx src/auth/AuthGate.tsx src/auth/AuthGate.test.tsx "docs/edit logs/2026-08-04.md" package.json
git commit -m "Fix (auth): move GlobalMonthProvider inside AuthGate so it never lists months pre-login"
```

---

### Task 2: Stop the periodic auto-refresh tick from wholesale-clearing the append-only directory cache

**Files:**
- Modify: `src/data/workspace/dataRefreshSignal.ts`
- Modify: `src/auth/AuthGate.tsx:338` (the periodic-tick call site)
- Modify: `src/auth/AdminToolbar.tsx:100` (the manual-refresh call site)
- Modify: `src/data/storage/directoryScan.ts:305-307`
- Test: `src/data/workspace/dataRefreshSignal.test.ts` (extend), `src/data/storage/directoryScan.test.ts` (extend)

**Interfaces:**
- Consumes: nothing new.
- Produces: `broadcastDataRefresh(source?: DataRefreshSource)` — the existing zero-arg call sites (in tests and in the two production call sites this task doesn't change the *intent* of) keep working via a default parameter. `subscribeToDataRefresh`'s callback type widens from `() => void` to `(source: DataRefreshSource) => void`; every existing subscriber that ignores its argument (the majority — they should keep re-running on BOTH manual and periodic ticks, only the directory-scan cache needs to distinguish) continues to compile and behave identically, since a narrower-arity callback is still a valid `EventListener`-shaped handler in this codebase's existing usage (this is exactly how `window.addEventListener` callbacks already work here — see `directoryScan.ts:306`'s and every other subscriber's current zero-arg callback).

**Context:** `directoryScan.ts:305-307` subscribes to the single `xray-data-refresh` signal at module scope and wholesale-resets the append-only read cache on *every* fire — both the manual admin refresh button (where a full reset is exactly the intended behavior: an admin explicitly asked for a hard refresh) and the 5-minute periodic tick (where it isn't: the cache's own per-file name-diff invalidation, added in Plan 3 this session, is already correct — periodically discarding the whole cache just makes the next read after every 5-minute mark pay full cost again, defeating the cache for a few seconds every 5 minutes with no correctness benefit).

- [ ] **Step 1: Write the failing tests**

In `src/data/workspace/dataRefreshSignal.test.ts`, add tests for the new payload (read the existing file first to match its structure — it already tests `broadcastDataRefresh`/`subscribeToDataRefresh` with zero-arg calls):

```ts
it("passes 'manual' as the default source when broadcastDataRefresh is called with no argument", () => {
  const spy = vi.fn();
  const unsubscribe = subscribeToDataRefresh(spy);
  broadcastDataRefresh();
  expect(spy).toHaveBeenCalledWith("manual");
  unsubscribe();
});

it("passes the explicit source through to subscribers", () => {
  const spy = vi.fn();
  const unsubscribe = subscribeToDataRefresh(spy);
  broadcastDataRefresh("periodic");
  expect(spy).toHaveBeenCalledWith("periodic");
  unsubscribe();
});

it("still supports zero-arg subscriber callbacks (existing consumers ignore the source)", () => {
  const spy = vi.fn<() => void>();
  const unsubscribe = subscribeToDataRefresh(spy);
  broadcastDataRefresh("periodic");
  expect(spy).toHaveBeenCalled();
  unsubscribe();
});
```

In `src/data/storage/directoryScan.test.ts`, add (read the existing file first for its exact `resetAppendOnlyDirectoryCache`/cache-population test setup and mirror it):

```ts
it("resets the cache on a manual data-refresh broadcast but not a periodic one", async () => {
  // ... populate the cache via a normal readAppendOnlyDirectory() call for
  // some directory, following this file's existing setup pattern ...

  broadcastDataRefresh("periodic");
  // ... assert a subsequent readAppendOnlyDirectory() call for the SAME
  // directory does NOT re-read from disk (cache survived) ...

  broadcastDataRefresh("manual");
  // ... assert a subsequent readAppendOnlyDirectory() call for the SAME
  // directory DOES re-read from disk (cache was reset) ...
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/data/workspace/dataRefreshSignal.test.ts src/data/storage/directoryScan.test.ts`
Expected: the new tests FAIL (current `broadcastDataRefresh()` takes no argument; current cache-reset subscription doesn't distinguish source).

- [ ] **Step 3: Add the source parameter to `dataRefreshSignal.ts`**

Replace the whole file's exported functions (keep the existing doc comment, extend it):

```ts
const DATA_REFRESH_EVENT_NAME = "xray-data-refresh";

/**
 * "manual" -- the admin toolbar's explicit refresh button; an admin asked
 * for a hard refresh, so subscribers may treat this as license to discard
 * any local cache entirely.
 * "periodic" -- the 5-minute auto-refresh timer; subscribers should re-read
 * their own data, but a subscriber holding a cache with its own correct
 * invalidation (e.g. the append-only directory cache) should NOT wholesale-
 * reset on this source -- that would defeat the cache for no correctness
 * benefit.
 */
export type DataRefreshSource = "manual" | "periodic";

export function broadcastDataRefresh(source: DataRefreshSource = "manual"): void {
  window.dispatchEvent(new CustomEvent<DataRefreshSource>(DATA_REFRESH_EVENT_NAME, { detail: source }));
}

export function subscribeToDataRefresh(
  callback: (source: DataRefreshSource) => void
): () => void {
  const handler = (event: Event) => {
    callback((event as CustomEvent<DataRefreshSource>).detail);
  };
  window.addEventListener(DATA_REFRESH_EVENT_NAME, handler);
  return () => {
    window.removeEventListener(DATA_REFRESH_EVENT_NAME, handler);
  };
}
```

Note: `subscribeToDataRefresh`'s callback type is now `(source: DataRefreshSource) => void`, not `() => void`. Every EXISTING call site in the codebase that passes a zero-arg callback (e.g. `() => resetAppendOnlyDirectoryCache()`, `() => setAudienceUsers(...)`, `reload` functions typed `() => Promise<void>`) remains valid TypeScript — a function that ignores extra arguments is assignable wherever more parameters are expected, and none of those call sites need to change. Only the two production call sites that must now pass an explicit source (Steps 4-5 below) and the one call site that must now READ the source (Step 6) need edits.

- [ ] **Step 4: Pass `"periodic"` from `AuthGate.tsx`'s auto-refresh interval**

In `src/auth/AuthGate.tsx`, find the auto-refresh interval effect (around line 330-341, the one with the `AUTO_REFRESH_INTERVAL_MS` comment). Change:

```ts
    const id = window.setInterval(() => {
      void refreshPermissions();
      broadcastDataRefresh();
    }, AUTO_REFRESH_INTERVAL_MS);
```

to:

```ts
    const id = window.setInterval(() => {
      void refreshPermissions();
      broadcastDataRefresh("periodic");
    }, AUTO_REFRESH_INTERVAL_MS);
```

- [ ] **Step 5: Pass `"manual"` from `AdminToolbar.tsx`'s refresh button**

In `src/auth/AdminToolbar.tsx`, find the manual refresh handler (around line 100, `broadcastDataRefresh();`). Change it to `broadcastDataRefresh("manual");` (explicit, even though it's also the default — the call site should be self-documenting given it now sits beside the "periodic" call site as siblings in the same signal's two production callers).

- [ ] **Step 6: Scope the directory-scan cache reset to `"manual"` only**

In `src/data/storage/directoryScan.ts`, change (currently lines 291-307, keep the existing long comment but tighten its last sentence):

```ts
if (typeof window !== "undefined") {
  subscribeToDataRefresh(() => resetAppendOnlyDirectoryCache());
}
```

to:

```ts
if (typeof window !== "undefined") {
  // Only the manual admin refresh wholesale-resets this cache. The periodic
  // 5-minute auto-refresh (AuthGate.tsx) does NOT -- this cache's own
  // per-file name-diff invalidation (see readAppendOnlyDirectory above) is
  // already correct, so a periodic wholesale reset only pays full re-read
  // cost every 5 minutes with no correctness benefit.
  subscribeToDataRefresh((source) => {
    if (source === "manual") resetAppendOnlyDirectoryCache();
  });
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/data/workspace/dataRefreshSignal.test.ts src/data/storage/directoryScan.test.ts`
Expected: all PASS.

Then run every OTHER file that subscribes to `subscribeToDataRefresh` to confirm the widened callback type didn't break anything (search: `grep -rn subscribeToDataRefresh src/` for the full subscriber list — expected: `NotificationManager.tsx`, `XrayReferrals.tsx`, `XrayInspectionResults.tsx`, `useApprovalData.ts`, plus this task's own `directoryScan.ts`):
Run: `npx vitest run src/components/Sidebar/Tabs/EmployeeWorkspace/ src/data/storage/`
Expected: all PASS.

Then typecheck (this task changes an exported function signature — the most likely place for a type error to surface):
Run: `npm run typecheck`
Expected: clean.

Then the whole suite:
Run: `npm run test:run`
Expected: all PASS.

- [ ] **Step 8: Edit log + commit**

```bash
git add src/data/workspace/dataRefreshSignal.ts src/data/workspace/dataRefreshSignal.test.ts src/auth/AuthGate.tsx src/auth/AdminToolbar.tsx src/data/storage/directoryScan.ts src/data/storage/directoryScan.test.ts "docs/edit logs/2026-08-04.md" package.json
git commit -m "Fix (workspace): scope the append-only cache's data-refresh reset to the manual admin refresh only"
```

---

### Task 3: Pause the periodic auto-refresh tick while the tab is hidden

**Files:**
- Modify: `src/auth/AuthGate.tsx:330-341`
- Test: `src/auth/AuthGate.test.tsx` (extend the existing `"AuthGate — permission auto-refresh"` describe block)

**Interfaces:**
- Consumes: `document.hidden` (a standard DOM API, no new import).
- Produces: no new exports.

**Context:** The 5-minute auto-refresh interval (`AuthGate.tsx:330-341`) does real work every tick regardless of whether the tab is even visible — `refreshPermissions()` (a disk read) and `broadcastDataRefresh("periodic")` (which fans out into every mounted view's own re-fetch). A backgrounded/minimized tab gets no benefit from this — nothing is being looked at — but still pays the read cost. The fix is a single guard at the top of the interval callback: skip the tick's work entirely when `document.hidden` is true. This does not clear or restart the timer (simpler, no edge cases around "how much time was left"), it just makes a hidden tick a no-op; the interval keeps ticking on its normal cadence and resumes doing real work the moment a later tick finds the tab visible again.

- [ ] **Step 1: Write the failing test**

In `src/auth/AuthGate.test.tsx`, inside the existing `describe("AuthGate — permission auto-refresh", ...)` block, add a new test after the existing one:

```tsx
it("skips the periodic tick's work entirely while the tab is hidden", async () => {
  vi.spyOn(authSession, "readRealSession").mockReturnValue({
    role: "employee",
    username: NON_SEED_USERNAME,
    loginAt: new Date().toISOString(),
  });
  mockReadyWorkspace("auto-refresh-hidden-tab", [NON_SEED_USERNAME]);
  const setIntervalSpy = vi.spyOn(window, "setInterval");

  renderAuthGate();

  await waitFor(() => expect(mocks.loadWorkspaceFiles).toHaveBeenCalled());
  const callsAfterHydration = mocks.loadWorkspaceFiles.mock.calls.length;

  let refreshCall: ReturnType<typeof setIntervalSpy.mock.calls.find>;
  await waitFor(() => {
    refreshCall = setIntervalSpy.mock.calls.find(
      (call) => call[1] === AUTO_REFRESH_INTERVAL_MS,
    );
    expect(refreshCall).toBeDefined();
  });

  const dataRefreshSpy = vi.fn();
  const unsubscribe = dataRefreshSignal.subscribeToDataRefresh(dataRefreshSpy);

  vi.spyOn(document, "hidden", "get").mockReturnValue(true);

  // Fire the scheduled callback directly while the tab is "hidden".
  (refreshCall![0] as () => void)();

  // Give any (incorrect) refresh a chance to fire before asserting it didn't.
  await act(async () => {
    await Promise.resolve();
  });
  expect(mocks.loadWorkspaceFiles.mock.calls.length).toBe(callsAfterHydration);
  expect(dataRefreshSpy).not.toHaveBeenCalled();

  unsubscribe();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/auth/AuthGate.test.tsx -t "skips the periodic tick's work entirely while the tab is hidden"`
Expected: FAIL — the tick currently runs unconditionally.

- [ ] **Step 3: Add the guard**

In `src/auth/AuthGate.tsx`, change (currently lines 334-339, immediately after Task 2's `"periodic"` edit is applied):

```ts
    const id = window.setInterval(() => {
      void refreshPermissions();
      broadcastDataRefresh("periodic");
    }, AUTO_REFRESH_INTERVAL_MS);
```

to:

```ts
    const id = window.setInterval(() => {
      // A backgrounded/minimized tab has nothing on screen that benefits from
      // this tick -- skip the disk read and the fan-out signal entirely
      // rather than paying their cost for no visible effect. The interval
      // itself keeps running on its normal cadence; a later tick does the
      // real work once the tab is visible again.
      if (document.hidden) return;
      void refreshPermissions();
      broadcastDataRefresh("periodic");
    }, AUTO_REFRESH_INTERVAL_MS);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/auth/AuthGate.test.tsx -t "auto-refresh"`
Expected: both the existing "schedules a 5-minute interval..." test and the new "skips the periodic tick's work entirely..." test PASS (the existing test relies on jsdom's default `document.hidden === false`, so it is unaffected by this guard).

Then the full file and whole suite:
Run: `npx vitest run src/auth/AuthGate.test.tsx && npm run test:run`
Expected: all PASS.

- [ ] **Step 5: Edit log + commit**

```bash
git add src/auth/AuthGate.tsx src/auth/AuthGate.test.tsx "docs/edit logs/2026-08-04.md" package.json
git commit -m "Fix (auth): pause the periodic permission/data-refresh tick while the tab is hidden"
```

---

### Task 4: Collapse `WorkspaceGate`'s redundant focus/visibilitychange listeners

**Files:**
- Modify: `src/data/workspace/WorkspaceGate.tsx:468-493`
- Test: `src/data/workspace/WorkspaceGate.test.tsx` (extend)

**Interfaces:**
- Consumes: nothing new.
- Produces: no new exports.

**Context:** The first-run checklist's month-count refresh (used only to decide whether to show/hide an admin-only empty-state banner) registers BOTH a `window.addEventListener("focus", refresh)` AND a `document.addEventListener("visibilitychange", refresh)` listener. In virtually every real scenario where one fires, the other does too (regaining window focus and the document becoming visible are the same user action in a normal single-tab-per-window browsing pattern), so a single user action triggers two redundant `listMonthFolders` disk reads back to back. Collapse to just the `visibilitychange` listener, checking `document.visibilityState === "visible"` before refreshing (so the listener registered for the *hidden* transition doesn't also trigger a read) — this is the more precise of the two signals and is already the pattern this same file's sibling code uses elsewhere in the codebase (`AuthGate.tsx`'s heartbeat effect keys off `visibilitychange` the same way).

- [ ] **Step 1: Write the failing test**

In `src/data/workspace/WorkspaceGate.test.tsx`, read the existing file first to find how it renders `WorkspaceGate` with an admin session and a mocked `listMonthFolders` (likely already exercised by an existing "first-run checklist" test — reuse that exact setup). Add:

```tsx
it("refreshes the month count on a visibility change but not also on a redundant focus event for the same user action", async () => {
  // ... reuse this file's existing admin + ready-workspace + empty-months
  // render setup so the first-run banner is visible ...

  const listSpy = vi.spyOn(populationStorage, "listMonthFolders");
  const callsAfterMount = listSpy.mock.calls.length;

  // Simulate the single real-world user action of switching back to this
  // tab: visibilitychange (hidden -> visible) fires, and in most browsers a
  // focus event fires alongside it for the same action.
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
  window.dispatchEvent(new Event("focus"));

  await waitFor(() => {
    expect(listSpy.mock.calls.length).toBe(callsAfterMount + 1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/data/workspace/WorkspaceGate.test.tsx -t "redundant focus event"`
Expected: FAIL — `callsAfterMount + 2` (both listeners fire).

- [ ] **Step 3: Collapse to one listener**

In `src/data/workspace/WorkspaceGate.tsx`, replace (currently lines 469-493):

```ts
  // Load the month count; refresh when the tab regains focus (e.g. after an import).
  useEffect(() => {
    if (!isAdmin || !directoryHandle) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear when not applicable
      setMonthCount(null);
      return;
    }
    let cancelled = false;
    const refresh = () => {
      void listMonthFolders(directoryHandle)
        .then((list) => {
          if (!cancelled) setMonthCount(list.length);
        })
        .catch(() => {
          if (!cancelled) setMonthCount(0);
        });
    };
    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [isAdmin, directoryHandle]);
```

with:

```ts
  // Load the month count; refresh when the tab becomes visible again (e.g.
  // after an import in another tab). visibilitychange alone is used here --
  // not also a "focus" listener -- because in normal single-tab-per-window
  // usage the two fire together for the same user action (switching back to
  // this tab), so a second listener only doubled the read for no benefit.
  useEffect(() => {
    if (!isAdmin || !directoryHandle) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear when not applicable
      setMonthCount(null);
      return;
    }
    let cancelled = false;
    const refresh = () => {
      void listMonthFolders(directoryHandle)
        .then((list) => {
          if (!cancelled) setMonthCount(list.length);
        })
        .catch(() => {
          if (!cancelled) setMonthCount(0);
        });
    };
    refresh();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [isAdmin, directoryHandle]);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/data/workspace/WorkspaceGate.test.tsx`
Expected: all PASS, including the new test and any pre-existing test that exercised the old `focus` listener (check whether one exists — if it asserts specifically on the `"focus"` event triggering a refresh, update it to assert on `"visibilitychange"` instead, since that's now the single source of truth; if it exercises the general "refreshes on tab regain" behavior without hard-coding which DOM event, it should keep passing unchanged).

Then the whole suite:
Run: `npm run test:run`
Expected: all PASS.

- [ ] **Step 5: Edit log + commit**

```bash
git add src/data/workspace/WorkspaceGate.tsx src/data/workspace/WorkspaceGate.test.tsx "docs/edit logs/2026-08-04.md" package.json
git commit -m "Fix (workspace): collapse WorkspaceGate's redundant focus+visibilitychange listeners to one"
```

---

## Task Order

Tasks 1, 2, and 3 **all** touch `src/auth/AuthGate.tsx` — Task 1 edits its render branch (~line 598-610) and adds an import; Task 2 edits its auto-refresh interval body (~line 334-339) to add the `"periodic"` argument; Task 3 then adds the `document.hidden` guard inside that same interval callback, and its Before-snippet assumes Task 2's edit already landed. **Tasks 1, 2, and 3 must therefore run strictly sequentially, in that order (1 → 2 → 3), never in parallel** — dispatching any two of them concurrently would have two implementers editing the same file in the same shared working tree at the same time. Task 4 (`WorkspaceGate.tsx`) touches an entirely disjoint file with no dependency on the other three, and may run in parallel alongside the {1 → 2 → 3} sequential chain — e.g. dispatch Task 4 at the same time as Task 1, using this session's established parallel-implementer protocol (skip the edit log and `package.json`; controller applies one combined commit per task afterward from each task's own diff).
