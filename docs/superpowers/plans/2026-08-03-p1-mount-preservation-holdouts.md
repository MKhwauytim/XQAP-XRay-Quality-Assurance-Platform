# P1 Mount-Preservation Holdouts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the P1 action items from `docs/superpowers/specs/2026-08-03-reference-architecture-evaluation.md`'s "Prioritized, low-risk action items" section — item 3 (finish the mount-preservation/skip-guard rollout for the holdouts that have a genuine, reachable re-fetch-on-navigation bug) and item 4 (convert AuthGate's deferred session re-validation into a real pre-render gate for the brief window it's needed).

**Architecture:** Each task adds a small, local, independently-reviewable guard — no new shared module, no change to the write/save stack, no change to `touchTabMountLru`/`touchVisitedTabs` themselves. Three tasks, each touching exactly one component file plus its test file.

**Investigation note (why only 3 of the evaluation's 4 "holdouts" get a task):** the evaluation cites Archive (`Archive/index.tsx:147-152`) and NotificationManager (`NotificationManager.tsx:74-88`) alongside UserManagement and Reports/KPI as "re-runs its full refresh() on every mount." Tracing the actual render tree (`App.tsx:181-191,282-294`) shows every top-level tab — including `archive` and `ew/notifications` — is already covered generically by `touchTabMountLru`: once visited, a tab stays mounted-but-`hidden` (not unmounted) for as long as it's one of the 3 most-recently-used top-level tabs, so its mount effect does not re-fire on a plain tab switch. Archive's and NotificationManager's mount effects (`[refresh]` / `[reload]`, each depending only on `directoryHandle`) do not re-fire spuriously while mounted. The only way either remounts is genuine LRU eviction (a 4th distinct top-level tab visited) or a real workspace change — both cases where a fresh fetch is correct, and exactly the case §4.4's own verdict says not to re-litigate ("raise it only with measurement, not on principle"). Archive and NotificationManager are single-view tabs with no internal sub-navigation to guard, unlike the two below. No task is included for them; this is a deliberate scope decision, not an oversight.

**Tech Stack:** React 19 hooks (`useRef`, `useEffect`), Vitest + Testing Library, existing `StateViews` (`LoadingState`) shared component.

## Global Constraints

- UI text is Arabic; any new user-facing string must be Arabic or reuse an existing label. The `LoadingState` component's default label is already Arabic — no new string needed for Task 3.
- `import type` for type-only imports.
- Do not touch `touchTabMountLru`, `touchVisitedTabs`, or any other file outside the three named per-task file sets.
- Every effect change must preserve the existing `cancelled` stale-closure guard pattern already present in the code being modified.
- Manual "تحديث" (refresh) buttons/handlers must keep working unconditionally — the new skip-guards apply ONLY to the automatic mount/section-switch-triggered fetch, never to an explicit user-triggered refresh.
- Follow CLAUDE.md's edit-log requirement for every task (version bump, Before/After, `npm run count-lines -- --quiet` before/after, category prefix).

---

### Task 1: UserManagement — activity/actions section-switch skip-guard

**Files:**
- Modify: `src/components/Sidebar/Tabs/UserManagement/index.tsx:1-45` (imports), `:150-156` (new refs), `:199-240` (the two effects)
- Test: create `src/components/Sidebar/Tabs/UserManagement/index.sectionSwitch.test.tsx` (a new file — do not add to the pre-existing, unrelated `index.resync.test.tsx`, which belongs to different, already-in-flight work in this repo; do not modify that file)

**Interfaces:**
- Consumes: `DirectoryHandleLike` type from `../../../../data/storage/fileSystemAccess` (already imported by sibling tab `Archive/index.tsx:31` at the same relative depth).
- Produces: no new exports; this is a self-contained internal-component fix.

**Context:** `UserManagementTab` never unmounts across its own internal `section` switches (`"users" | "page-permissions" | "feature-permissions" | "activity" | "actions"` — one component instance, `section` is local state). The `"activity"` and `"actions"` effects both key on `section` alone (plus `directoryHandle`), so switching to a section, away, and back re-runs the full network fetch every time — even though the component instance, and its already-loaded `activityEntries`/`actionEntries` state, never went anywhere. The fix: remember which `directoryHandle` each section was last successfully loaded for, and skip the automatic fetch when returning to a section for the same handle. The manual "تحديث" buttons (`:625-631`, `:639-646`) call their own inline fetch closures directly and are untouched by this guard — they must keep re-fetching on every click regardless.

- [ ] **Step 1: Add the two skip-guard refs**

In `src/components/Sidebar/Tabs/UserManagement/index.tsx`, add the import (near the other relative imports, alongside `syncUserManagementToDisk` around line 44):

```ts
import type { DirectoryHandleLike } from "../../../../data/storage/fileSystemAccess";
```

Then, immediately after the existing `savingToDiskRef`/`pendingStateRef` declarations (currently at lines 160-161):

```ts
  // Remembers which directoryHandle each section's data was last successfully
  // loaded for, so switching sections back and forth within one mounted
  // UserManagementTab instance does not re-fetch on every switch -- only on
  // first visit or a genuine workspace change. `undefined` = never loaded.
  const activityLoadedForRef = useRef<DirectoryHandleLike | null | undefined>(undefined);
  const actionsLoadedForRef = useRef<DirectoryHandleLike | null | undefined>(undefined);
```

- [ ] **Step 2: Write the failing tests**

Create `src/components/Sidebar/Tabs/UserManagement/index.sectionSwitch.test.tsx`:

```tsx
/* @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";
import UserManagementTab from "./index";
import * as authSession from "../../../../auth/authSession";
import * as usePermissionsModule from "../../../../auth/usePermissions";
import * as authActivityLog from "../../../../auth/authActivityLog";
import * as actionLog from "../../../../data/audit/actionLog";
import * as useWorkspaceModule from "../../../../data/workspace/useWorkspace";
import { createMemoryDirectory } from "../../../../data/storage/memoryDirectory";
import type { DirectoryHandleLike } from "../../../../data/storage/fileSystemAccess";

vi.mock("../../../../auth/authSession", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../auth/authSession")>()),
  readSession: vi.fn(),
}));

function mockSession() {
  vi.spyOn(authSession, "readSession").mockReturnValue({
    role: "admin",
    username: "admin",
    loginAt: new Date().toISOString(),
  });
  vi.spyOn(usePermissionsModule, "usePermissions").mockReturnValue({
    canMutate: () => true,
    can: () => true,
    canAccessTab: () => true,
    username: "admin",
    role: "admin",
  } as unknown as ReturnType<typeof usePermissionsModule.usePermissions>);
}

function mockWorkspace(handle: DirectoryHandleLike | null) {
  vi.spyOn(useWorkspaceModule, "useWorkspace").mockReturnValue({
    directoryHandle: handle,
  } as unknown as ReturnType<typeof useWorkspaceModule.useWorkspace>);
}

function switchSection(subTabId: string) {
  act(() => {
    window.dispatchEvent(
      new CustomEvent("pop-set-subtab", { detail: { subTabId } })
    );
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("UserManagementTab — activity/actions section-switch skip-guard", () => {
  it("does not re-fetch the activity log when switching back to 'activity' for the same workspace", async () => {
    mockSession();
    const handle = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    mockWorkspace(handle);
    const readSpy = vi
      .spyOn(authActivityLog, "readAuthActivityLog")
      .mockResolvedValue([]);

    render(<UserManagementTab />);
    switchSection("activity");
    await waitFor(() => expect(readSpy).toHaveBeenCalledTimes(1));

    switchSection("users");
    switchSection("activity");

    // Give any (incorrect) re-fetch a chance to fire before asserting it didn't.
    await act(async () => {
      await Promise.resolve();
    });
    expect(readSpy).toHaveBeenCalledTimes(1);
  });

  it("does not re-fetch workspace actions when switching back to 'actions' for the same workspace", async () => {
    mockSession();
    const handle = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    mockWorkspace(handle);
    const readSpy = vi
      .spyOn(actionLog, "readWorkspaceActions")
      .mockResolvedValue([]);

    render(<UserManagementTab />);
    switchSection("actions");
    await waitFor(() => expect(readSpy).toHaveBeenCalledTimes(1));

    switchSection("users");
    switchSection("actions");

    await act(async () => {
      await Promise.resolve();
    });
    expect(readSpy).toHaveBeenCalledTimes(1);
  });

  it("re-fetches activity/actions when the workspace handle actually changes", async () => {
    mockSession();
    const handleA = createMemoryDirectory("a") as unknown as DirectoryHandleLike;
    const handleB = createMemoryDirectory("b") as unknown as DirectoryHandleLike;
    mockWorkspace(handleA);
    const readSpy = vi
      .spyOn(actionLog, "readWorkspaceActions")
      .mockResolvedValue([]);

    const { rerender } = render(<UserManagementTab />);
    switchSection("actions");
    await waitFor(() => expect(readSpy).toHaveBeenCalledTimes(1));

    mockWorkspace(handleB);
    rerender(<UserManagementTab />);
    await waitFor(() => expect(readSpy).toHaveBeenCalledTimes(2));
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/components/Sidebar/Tabs/UserManagement/index.sectionSwitch.test.tsx`
Expected: the first two tests FAIL (`readSpy` called twice, not once) — confirms the current re-fetch-on-switch-back bug is real and reachable. The third test PASSES already (workspace-change re-fetch already works).

- [ ] **Step 4: Guard the "activity" effect**

In `src/components/Sidebar/Tabs/UserManagement/index.tsx`, replace the current effect (currently lines 199-215):

```ts
  useEffect(() => {
    if (section !== "activity") return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync loading indicator before async activity-log read; necessary to show spinner while data fetches
    setIsActivityLoading(true);
    void readAuthActivityLog()
      .then((entries) => {
        if (!cancelled) setActivityEntries(entries);
      })
      .catch(logRejection("userManagement:readAuthActivityLog"))
      .finally(() => {
        if (!cancelled) setIsActivityLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [section, directoryHandle]);
```

with:

```ts
  useEffect(() => {
    if (section !== "activity") return;
    if (activityLoadedForRef.current === directoryHandle) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync loading indicator before async activity-log read; necessary to show spinner while data fetches
    setIsActivityLoading(true);
    void readAuthActivityLog()
      .then((entries) => {
        if (!cancelled) {
          setActivityEntries(entries);
          activityLoadedForRef.current = directoryHandle;
        }
      })
      .catch(logRejection("userManagement:readAuthActivityLog"))
      .finally(() => {
        if (!cancelled) setIsActivityLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [section, directoryHandle]);
```

- [ ] **Step 5: Guard the "actions" effect**

Replace the current effect (currently lines 217-240):

```ts
  useEffect(() => {
    if (section !== "actions") return;
    if (!directoryHandle) {
      // Nothing to read without a connected workspace -- resolve the flag so
      // it can't stay stuck "loading" from a previous in-flight read whose
      // cleanup just cancelled it (e.g. the workspace was disconnected).
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync empty-state reset when no workspace is connected
      setIsActionsLoading(false);
      return;
    }
    let cancelled = false;
    setIsActionsLoading(true);
    void readWorkspaceActions(directoryHandle)
      .then((entries) => {
        if (!cancelled) setActionEntries(entries);
      })
      .catch(logRejection("userManagement:readWorkspaceActions"))
      .finally(() => {
        if (!cancelled) setIsActionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [section, directoryHandle]);
```

with:

```ts
  useEffect(() => {
    if (section !== "actions") return;
    if (!directoryHandle) {
      // Nothing to read without a connected workspace -- resolve the flag so
      // it can't stay stuck "loading" from a previous in-flight read whose
      // cleanup just cancelled it (e.g. the workspace was disconnected).
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync empty-state reset when no workspace is connected
      setIsActionsLoading(false);
      return;
    }
    if (actionsLoadedForRef.current === directoryHandle) return;
    let cancelled = false;
    setIsActionsLoading(true);
    void readWorkspaceActions(directoryHandle)
      .then((entries) => {
        if (!cancelled) {
          setActionEntries(entries);
          actionsLoadedForRef.current = directoryHandle;
        }
      })
      .catch(logRejection("userManagement:readWorkspaceActions"))
      .finally(() => {
        if (!cancelled) setIsActionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [section, directoryHandle]);
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/components/Sidebar/Tabs/UserManagement/index.sectionSwitch.test.tsx`
Expected: all 3 tests PASS.

Then run the full existing UserManagement test suite to confirm no regression:
Run: `npx vitest run src/components/Sidebar/Tabs/UserManagement/`
Expected: all PASS.

- [ ] **Step 7: Edit log + commit**

Record the edit in `docs/edit logs/2026-08-03.md` (or the current dated file, per CLAUDE.md), run `npm run count-lines -- --quiet` before/after, bump `package.json` version (decimal bump — this is a targeted fix, not a new feature), then:

```bash
git add src/components/Sidebar/Tabs/UserManagement/index.tsx src/components/Sidebar/Tabs/UserManagement/index.sectionSwitch.test.tsx "docs/edit logs/2026-08-03.md" package.json
git commit -m "Fix (user-management): skip redundant activity/actions re-fetch on section switch-back"
```

---

### Task 2: Reports/KPI — stop nulling `model` on switch-away, skip-guard the rebuild

**Files:**
- Modify: `src/components/Sidebar/Tabs/Reports/index.tsx:269-306`
- Test: `src/components/Sidebar/Tabs/Reports/index.test.tsx` (extend — add a new `describe` block near the existing `"Reports sub-tab mount preservation (§T)"` block at line 764; do not modify that block)

**Interfaces:**
- Consumes: nothing new — uses state/refs already local to `ReportsTab`.
- Produces: no new exports.

**Context:** The KPI-dashboard-building effect currently nulls `model` (and re-derives it from scratch via `loadExecInput` + `buildReportModel`, the single most expensive read path in this tab: population + sample + all employee files + template + distribution) every single time `section` changes away from `"kpi"` and back — even when `directoryHandle`/`selectedMonth` never changed. The fix mirrors Task 1's shape: track which `(directoryHandle, selectedMonth)` pair the current `model` was actually built for, and skip the rebuild when returning to `"kpi"` for the same pair. Switching to a genuinely different month, or a build failure, still rebuilds on return (a failed build's ref is left unset, so returning retries automatically — a strict improvement over today's always-retry, never a regression).

- [ ] **Step 1: Write the failing test**

In `src/components/Sidebar/Tabs/Reports/index.test.tsx`, add a new `describe` block. Follow the exact fixture/mock/harness pattern already used by `"Reports month-summary chips — lightweight manifest read, no employee-files read (§L)"` (starting at line 340 in the current file) for `createMemoryDirectory`, `deferredManifestFor`, `deferredFor`, `mockManifest`, `mockPop`, and the `populationStorageSpies` object — reuse those exact helpers, do not redefine them. Add:

```tsx
describe("Reports KPI model cache — no rebuild on plain section switch-back", () => {
  it("does not rebuild the KPI model when switching away from 'kpi' and back with nothing changed", async () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    (globalThis as { __testDir?: DirectoryHandleLike }).__testDir = root;

    render(<ReportsTab />);

    await act(async () => {
      deferredManifestFor("4-april-2026").resolve(mockManifest(1));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByText("1 صورة")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("tab", { name: "مؤشرات" }));
    await act(async () => {
      deferredFor("4-april-2026").resolve(mockPop(1));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(populationStorageSpies.loadMonthPopulationFinal).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole("tab", { name: "التقارير" }));
    fireEvent.click(screen.getByRole("tab", { name: "مؤشرات" }));

    // Give an (incorrect) rebuild a chance to fire before asserting it didn't.
    await act(async () => {
      await Promise.resolve();
    });
    expect(populationStorageSpies.loadMonthPopulationFinal).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/Sidebar/Tabs/Reports/index.test.tsx -t "does not rebuild the KPI model"`
Expected: FAIL — `loadMonthPopulationFinal` called twice (once per `"kpi"` visit).

- [ ] **Step 3: Add the skip-guard ref and rewrite the effect**

In `src/components/Sidebar/Tabs/Reports/index.tsx`, add a new ref near the other `model`-related state (immediately after the existing `const [modelLoading, setModelLoading] = useState(false);` line, currently line 178):

```ts
  // Remembers which (directoryHandle, month) pair the current `model` was
  // built for, so switching sub-tabs away from "kpi" and back does not
  // rebuild it from scratch -- loadExecInput is the heaviest read path in
  // this tab (population + sample + all employee files + template +
  // distribution). Unset (null) on a genuine handle/month change or a
  // build failure, so those cases still rebuild correctly.
  const kpiModelBuiltForRef = useRef<{ directoryHandle: typeof directoryHandle; month: string } | null>(null);
```

Then replace the current effect (currently lines 270-306):

```ts
  // Build the live analytics model ONCE per month while the dashboard is open.
  useEffect(() => {
    if (section !== "kpi" || !directoryHandle || !selectedMonth) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync-clear when dashboard closed / no month
      setModel(null);
      return;
    }
    let cancelled = false;
    setModelLoading(true);
    setModel(null);
    setModelError(null);
    void (async () => {
      try {
        const execInput = await loadExecInput();
        if (cancelled) return;
        if (!execInput) { setModel(null); setModelError("no-population"); return; }
        const builtModel = buildReportModel(execInput, buildDisplayNameMap());
        setModel(builtModel);
        // §L Tier 2: backfill the studied-count chip from the model we just
        // built instead of a separate loadAllEmployeeFiles read -- only
        // available once the KPI dashboard has actually been opened.
        setMonthMeta((current) =>
          current && current.folderName === selectedMonth
            ? { ...current, studiedCount: builtModel.sample.studied }
            : current
        );
      } catch (err) {
        if (!cancelled) {
          setModel(null);
          setModelError("build-error");
          logRejection("reports:buildReportModel")(err);
        }
      } finally {
        if (!cancelled) setModelLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [section, directoryHandle, selectedMonth, loadExecInput]);
```

with:

```ts
  // Build the live analytics model ONCE per (directoryHandle, month) while the
  // dashboard is open -- and keep it cached (not nulled) across a plain
  // switch away from "kpi" and back, so returning to the dashboard is
  // instant instead of re-running the heaviest read path in this tab.
  useEffect(() => {
    if (section !== "kpi") return;
    if (!directoryHandle || !selectedMonth) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync-clear when dashboard closed / no month
      setModel(null);
      kpiModelBuiltForRef.current = null;
      return;
    }
    const alreadyBuilt =
      kpiModelBuiltForRef.current !== null &&
      kpiModelBuiltForRef.current.directoryHandle === directoryHandle &&
      kpiModelBuiltForRef.current.month === selectedMonth;
    if (alreadyBuilt) return;

    let cancelled = false;
    setModelLoading(true);
    setModel(null);
    setModelError(null);
    void (async () => {
      try {
        const execInput = await loadExecInput();
        if (cancelled) return;
        if (!execInput) { setModel(null); setModelError("no-population"); return; }
        const builtModel = buildReportModel(execInput, buildDisplayNameMap());
        setModel(builtModel);
        kpiModelBuiltForRef.current = { directoryHandle, month: selectedMonth };
        // §L Tier 2: backfill the studied-count chip from the model we just
        // built instead of a separate loadAllEmployeeFiles read -- only
        // available once the KPI dashboard has actually been opened.
        setMonthMeta((current) =>
          current && current.folderName === selectedMonth
            ? { ...current, studiedCount: builtModel.sample.studied }
            : current
        );
      } catch (err) {
        if (!cancelled) {
          setModel(null);
          setModelError("build-error");
          logRejection("reports:buildReportModel")(err);
        }
      } finally {
        if (!cancelled) setModelLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [section, directoryHandle, selectedMonth, loadExecInput]);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/Sidebar/Tabs/Reports/index.test.tsx -t "does not rebuild the KPI model"`
Expected: PASS.

Then run the full Reports test file to confirm no regression, paying particular attention to the existing `"Reports month-summary chips"` and `"Reports sub-tab mount preservation (§T)"` blocks (both exercise `section`/model-adjacent behavior):
Run: `npx vitest run src/components/Sidebar/Tabs/Reports/index.test.tsx`
Expected: all PASS.

- [ ] **Step 5: Edit log + commit**

```bash
git add src/components/Sidebar/Tabs/Reports/index.tsx src/components/Sidebar/Tabs/Reports/index.test.tsx "docs/edit logs/2026-08-03.md" package.json
git commit -m "Fix (reports): stop rebuilding the KPI model on every switch back to the dashboard"
```

---

### Task 3: AuthGate — gate the authenticated render on `usersHydrated`

**Files:**
- Modify: `src/auth/AuthGate.tsx:564-588` (render branch), plus one new import
- Modify: `src/auth/AuthGate.css` (one small rule)
- Test: `src/auth/AuthGate.test.tsx` (extend — add a new `describe` block; the file already has a `renderAuthGate()` harness and `mockReadyWorkspace()` helper at lines 57-121, and an adjacent `"AuthGate — startup session-hydration race (B2)"` block at line 204 covering the related deferred-clear logic — reuse both, do not modify either)

**Interfaces:**
- Consumes: `LoadingState` from `../components/StateViews/StateViews` (existing shared component, already used elsewhere in the codebase, e.g. `NotificationManager.tsx:5`).
- Produces: no new exports.

**Context:** `AuthGate` renders `AdminToolbar` + the full authenticated app tree as soon as `session` is truthy — including for a session restored from `sessionStorage` on page load (`getInitialSession()`), before `WorkspaceContext` has confirmed (`usersHydrated`) that the workspace's real disk-synced user list has been loaded. The existing effect at `AuthGate.tsx:253-272` already re-validates the session once `usersHydrated` flips true and clears it if the user is genuinely gone — but that is a *deferred* correction, not a *gate*: for the brief window where `workspaceStatus === "ready"` but `usersHydrated` is still `false`, a since-revoked identity's `AdminToolbar` (role-preview switch, logout, feedback toggle) is visible before being yanked away. `WorkspaceGate.tsx:264,275-283` already solves the identical race for the app content one level down, using exactly the condition `status === "ready" && !usersHydrated` and a brief spinner. This task applies the same condition at the `AuthGate` level, one layer up, using the codebase's existing generic `LoadingState` component instead of duplicating `WorkspaceGate`'s bespoke markup.

Exempt sessions (`isBootstrapAdminSession` / demo mode, via the existing `isExemptFromManagedUserValidation` helper at `AuthGate.tsx:87-89`) are never subject to the re-validation effect in the first place, so they must not be gated either — gating them would add a pointless spinner flash to the most common admin/dev login path for a check that can never affect them.

The gate condition never gets stuck: it is `workspaceStatus === "ready" && !usersHydrated`, not merely `!usersHydrated` — a session with no workspace connected at all (`workspaceStatus` staying `"not_selected"`/`"checking"`/etc. forever) never satisfies `"ready"`, so today's existing behavior for that case (render immediately, validate later if a workspace ever connects) is unchanged.

- [ ] **Step 1: Write the failing test**

In `src/auth/AuthGate.test.tsx`, add a new `describe` block after the existing `"AuthGate — startup session-hydration race (B2)"` block (after line 298). This test needs to observe the intermediate "ready but not hydrated" window directly, so it controls `loadWorkspaceFiles`'s resolution manually instead of letting it resolve immediately like `mockReadyWorkspace` does — write a local variant inline rather than modifying `mockReadyWorkspace`:

```tsx
describe("AuthGate — usersHydrated render gate (P1 item 4)", () => {
  beforeEach(() => {
    userManagement.writeUserManagementState(
      userManagement.createEmptyUserManagementState(),
      false,
    );
  });

  afterEach(() => {
    userManagement.writeUserManagementState(
      userManagement.createEmptyUserManagementState(),
      false,
    );
  });

  it("shows a loading gate (not the authenticated UI) while status is ready but usersHydrated hasn't caught up, then renders once it has", async () => {
    const persistedSession: AuthSession = {
      role: "employee",
      username: NON_SEED_USERNAME,
      loginAt: new Date().toISOString(),
    };
    vi.spyOn(authSession, "readRealSession").mockReturnValue(persistedSession);

    const handle = createMemoryDirectory("hydration-gate");
    mocks.loadLastWorkspace.mockResolvedValue({
      directoryHandle: handle,
      directoryName: handle.name,
      savedAt: new Date().toISOString(),
    });
    mocks.checkWorkspaceStructure.mockResolvedValue({
      status: "ready",
      missingItems: [],
      invalidItems: [],
      message: "ready",
    });

    let resolveLoadWorkspaceFiles!: (value: Awaited<ReturnType<typeof mocks.loadWorkspaceFiles>>) => void;
    mocks.loadWorkspaceFiles.mockReturnValue(
      new Promise((resolve) => {
        resolveLoadWorkspaceFiles = resolve;
      }),
    );

    renderAuthGate();

    // status has not reached "ready" yet at first paint -- unchanged, pre-existing behavior.
    expect(screen.getByText("authenticated")).toBeInTheDocument();

    await waitFor(() => {
      expect(mocks.loadWorkspaceFiles).toHaveBeenCalled();
    });

    // status IS "ready" now, but usersHydrated hasn't caught up (loadWorkspaceFiles
    // is still pending) -- the gate must be active: authenticated content and the
    // admin toolbar are both hidden.
    await waitFor(() => {
      expect(screen.queryByText("authenticated")).not.toBeInTheDocument();
    });
    expect(screen.queryByTestId("admin-toolbar-stub")).not.toBeInTheDocument();
    expect(screen.getByText("جارٍ التحميل…")).toBeInTheDocument();

    resolveLoadWorkspaceFiles({
      manifest: null,
      usersPermissions: buildUsersPermissionsFile([NON_SEED_USERNAME]),
      sampleMaster: null,
      sampleDistribution: null,
    });

    await waitFor(() => {
      expect(screen.getByText("authenticated")).toBeInTheDocument();
    });
    expect(screen.getByTestId("admin-toolbar-stub")).toBeInTheDocument();
  });

  it("never gates an exempt (demo) session", async () => {
    const demoSession: AuthSession = {
      role: "admin",
      username: VIEWER_USERNAME,
      loginAt: new Date().toISOString(),
      mode: "demo",
    };
    vi.spyOn(authSession, "readRealSession").mockReturnValue(demoSession);

    const handle = createMemoryDirectory("hydration-gate-demo-exempt");
    mocks.loadLastWorkspace.mockResolvedValue({
      directoryHandle: handle,
      directoryName: handle.name,
      savedAt: new Date().toISOString(),
    });
    mocks.checkWorkspaceStructure.mockResolvedValue({
      status: "ready",
      missingItems: [],
      invalidItems: [],
      message: "ready",
    });
    mocks.loadWorkspaceFiles.mockReturnValue(new Promise(() => {})); // never resolves

    renderAuthGate();

    await waitFor(() => {
      expect(mocks.loadWorkspaceFiles).toHaveBeenCalled();
    });

    // Even with hydration never completing, an exempt session must stay visible.
    expect(screen.getByText("authenticated")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify the first one fails**

Run: `npx vitest run src/auth/AuthGate.test.tsx -t "usersHydrated render gate"`
Expected: the first test FAILS (finds `"authenticated"` still in the document during the ready-but-not-hydrated window instead of the loading gate). The second test already PASSES (exempt sessions are already never blocked by anything).

- [ ] **Step 3: Add the `LoadingState` import**

In `src/auth/AuthGate.tsx`, add to the imports (near the other relative imports, e.g. after the `logRejection` import at line 59):

```ts
import { LoadingState } from "../components/StateViews/StateViews";
```

- [ ] **Step 4: Add the gate to the render branch**

Replace the current `if (session)` block opening (currently lines 564-575):

```ts
  if (session) {
    // Only a real admin may impersonate other roles. The effective session (with the
    // role swapped) is what the rest of the app sees; identity/username stay real.
    const isRealAdmin = session.role === ADMIN_ROLE;
    const effectiveRole: AuthRole =
      isRealAdmin && previewRole ? previewRole : session.role;
    const isImpersonating = effectiveRole !== session.role;
    const effectiveSession: AuthSession = isImpersonating
      ? { ...session, role: effectiveRole }
      : session;

    return (
```

with:

```ts
  if (session) {
    // Mirrors WorkspaceGate's identical usersHydrated race guard one layer
    // down (WorkspaceGate.tsx:264,275-283): status flips to "ready" before
    // the workspace's real disk-synced user list has been synced into
    // memory, so rendering AdminToolbar/children on session+status alone
    // can briefly show a since-revoked identity's UI before the deferred
    // re-validation effect above (line ~253) clears it. Exempt sessions
    // (bootstrap admin, demo) are never subject to that re-validation, so
    // they are never gated here either. Bounded to workspaceStatus ===
    // "ready" specifically (not bare !usersHydrated) so a session with no
    // workspace connected at all is never stuck behind this gate.
    if (
      !isExemptFromManagedUserValidation(session) &&
      workspaceStatus === "ready" &&
      !usersHydrated
    ) {
      return (
        <div className="auth-hydrating-gate" dir="rtl">
          <LoadingState />
        </div>
      );
    }

    // Only a real admin may impersonate other roles. The effective session (with the
    // role swapped) is what the rest of the app sees; identity/username stay real.
    const isRealAdmin = session.role === ADMIN_ROLE;
    const effectiveRole: AuthRole =
      isRealAdmin && previewRole ? previewRole : session.role;
    const isImpersonating = effectiveRole !== session.role;
    const effectiveSession: AuthSession = isImpersonating
      ? { ...session, role: effectiveRole }
      : session;

    return (
```

- [ ] **Step 5: Add the CSS rule**

In `src/auth/AuthGate.css`, add:

```css
.auth-hydrating-gate {
  display: grid;
  place-items: center;
  min-height: 100vh;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/auth/AuthGate.test.tsx -t "usersHydrated render gate"`
Expected: both PASS.

Then run the full `AuthGate.test.tsx` file — this file's other describe blocks (`"AuthGate — startup session-hydration race (B2)"`, `"AuthGate — permission auto-refresh"`, etc.) exercise adjacent `usersHydrated`/`workspaceStatus` timing and are the most likely place for a subtle regression to show up:

Run: `npx vitest run src/auth/AuthGate.test.tsx`
Expected: all PASS.

Then run the full suite to catch any other consumer relying on AuthGate's previous render timing:

Run: `npm run test:run`
Expected: all PASS.

- [ ] **Step 7: Edit log + commit**

```bash
git add src/auth/AuthGate.tsx src/auth/AuthGate.css src/auth/AuthGate.test.tsx "docs/edit logs/2026-08-03.md" package.json
git commit -m "Fix (auth): gate authenticated render on usersHydrated instead of a deferred clear"
```

---

## Task Order

Tasks 1-3 touch entirely disjoint files (`UserManagement/index.tsx`, `Reports/index.tsx`, `AuthGate.tsx`/`AuthGate.css`) and have no interface dependency on each other — safe to implement in any order, including in parallel by separate implementers, provided the shared-file protocol from this session's Plan 4/6 is followed: parallel implementers skip `docs/edit logs/*.md` and `package.json`; the controller applies one combined edit-log-entries-plus-version-bump commit afterward, citing each task's own `git diff --stat` for its Lines figure.
