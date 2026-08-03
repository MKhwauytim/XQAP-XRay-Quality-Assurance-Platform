# Workflow Fixes Implementation Plan (§B-F)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the sample dual-review approval gate, replace "hide on pending" with color-coded pending/resolved status, parallelize the independent file writes in month processing, fix the double File-System-Access permission prompt, and fix the role-based menu flash on first load — the five remaining original-complaint fixes from the design spec (`docs/superpowers/specs/2026-08-03-distribution-performance-and-workflow-design.md` §B, C, D, E, F), fully independent of Plan 1's files.

**Architecture:** Five independent, surgical changes to existing files — no new shared modules. Each task touches its own file set with no overlap between tasks, so tasks may be implemented and reviewed in any order (this plan sequences them cheapest/lowest-risk first).

**Tech Stack:** TypeScript (strict), React 19, Vitest (`node` environment except where noted `jsdom`), `@testing-library/react`, `createMemoryDirectory` test helper.

## Global Constraints

- Every task gets a `docs/edit logs/2026-08-03.md` entry (the file already exists — append a new version heading at the end of the day's entries, i.e. the numerically newest heading goes at the TOP of the file per this repo's established newest-first convention, not the bottom): version bump (decimal, these are fixes/refactors), category per CLAUDE.md's list (`Fix:`, `Remove:`, `Refactor:`), before/after snippets, and `**Lines:**` stat using `npm run count-lines -- --quiet` before/after each task.
- **Edit-log ordering:** this project's `npm run check:release` gate requires the FIRST `## v` heading in the newest daily file to be the highest version number. Insert each new entry immediately after the `# Edit Log — 2026-08-03` title line (i.e., at the top, before the existing v59.129 entry), not appended at the bottom.
- After each task, bump `package.json`'s `"version"` field to match the new highest entry (e.g. `"59.130.0"`), and confirm `npm run check:release` passes before committing.
- No new runtime npm dependencies.
- No changes to any public function signature already consumed outside this plan's files, except where a task explicitly changes a component's props (documented per-task).
- Deterministic-by-design code must be characterized with a test before its implementation changes, per this repo's CLAUDE.md.
- All new/changed TypeScript must pass `npm run typecheck` and `npm run lint` (`--max-warnings 0`) before commit.
- **Git commit scoping:** this repository has substantial OTHER uncommitted/staged work in the working tree from unrelated sessions (`Population/index.tsx`, `useDistributionActions.ts` — do not touch, do not comment on, do not let any commit include them). Always commit via `git add <files>` then `git commit -m "..." -- <same files>` (pathspec-scoped) — **never a bare `git commit`**, since a bare commit picks up the entire index including those pre-existing staged files.

---

### Task 1: Fix the double permission prompt

**Files:**
- Modify: `src/auth/AuthGate.tsx:184-188`
- Test: `src/auth/authActivityLog.test.ts` (extend existing file)

**Interfaces:**
- Consumes: `configureAuthActivityLogWorkspace(directoryHandle: DirectoryHandleLike | null): void` from `src/auth/authActivityLog.ts` (unchanged signature).
- Produces: no new exports. `AuthGate`'s effect no longer calls `configureAuthActivityLogWorkspace` on workspace-ready; instead the workspace handle is captured and only wired into the activity log at the moment of a real login.

**Background:** `configureAuthActivityLogWorkspace` does two things when called with a non-null handle: stores it in module state, AND immediately calls `queueFlush()` → `flushMemoryToWorkspace()`, which does a real disk write requiring "readwrite" permission — a separate grant from the "read" permission already obtained when the workspace connects. Today this fires the instant `workspaceStatus === "ready"` (line 184-188), before login, causing two permission prompts back-to-back. The fix: defer configuring the workspace on the activity log until a real login actually happens (the same points where `startAuthActivitySession` is already invoked downstream — `writeSession()` in `authSession.ts`, called by `applySession()` in `AuthGate.tsx`).

- [ ] **Step 1: Write the failing test**

```ts
// Append to src/auth/authActivityLog.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
// (adjust the above import line to merge with whatever this file's existing import statement already is — do not duplicate a second `import { describe, ... }` line)

describe("configureAuthActivityLogWorkspace — deferred until login (Task 1)", () => {
  beforeEach(() => {
    resetAuthActivityLogForTests();
  });

  it("does not write to disk when configured with no active session", async () => {
    const root = createMemoryDirectory();
    configureAuthActivityLogWorkspace(root);
    await waitForAuthActivityLogFlush();

    // No activity.log.json should exist yet — nothing has been logged.
    let threw = false;
    try {
      await root.getDirectoryHandle("5-system", { create: false });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  it("writes to disk once a real login session starts after the workspace is configured", async () => {
    const root = createMemoryDirectory();
    configureAuthActivityLogWorkspace(root);
    startAuthActivitySession({ role: "employee", username: "alice", loginAt: new Date().toISOString() });
    await waitForAuthActivityLogFlush();

    const entries = await readAuthActivityLog();
    expect(entries.map((e) => e.username)).toEqual(["alice"]);
  });
});
```

Note: `createMemoryDirectory`, `resetAuthActivityLogForTests`, `configureAuthActivityLogWorkspace`, `startAuthActivitySession`, `waitForAuthActivityLogFlush`, `readAuthActivityLog` should already be imported at the top of `authActivityLog.test.ts` (this file already tests these functions per the existing test suite referenced in the plan's research) — only add imports for any of these not already present; check the file's current import block first and merge, don't duplicate.

This test characterizes the CURRENT (already-correct) behavior of `configureAuthActivityLogWorkspace`/`startAuthActivitySession` themselves — it is not testing `AuthGate.tsx` directly (that component requires a `jsdom` environment and heavy mocking, out of proportion for this fix). It exists to confirm the two functions this fix relies on behave as documented: calling `configureAuthActivityLogWorkspace` alone with no session produces no disk activity, and a real session logged after produces one.

- [ ] **Step 2: Run test to verify it passes against current code (characterization)**

Run: `npx vitest run src/auth/authActivityLog.test.ts`
Expected: PASS. This confirms the two library functions already behave correctly in isolation — the bug is entirely in `AuthGate.tsx`'s eager call, not in `authActivityLog.ts` itself, so this step is a safety-net characterization, not a RED step for this file.

- [ ] **Step 3: Fix `AuthGate.tsx` to stop calling `configureAuthActivityLogWorkspace` eagerly on workspace-ready**

```tsx
// src/auth/AuthGate.tsx
// Replace lines 184-188:
//   useEffect(() => {
//     configureAuthActivityLogWorkspace(
//       workspaceStatus === "ready" ? directoryHandle : null
//     );
//   }, [directoryHandle, workspaceStatus]);
// with:
  useEffect(() => {
    // Deliberately NOT called eagerly here. Configuring the activity log
    // workspace immediately triggers a disk write (queueFlush inside
    // configureAuthActivityLogWorkspace), which requires "readwrite"
    // permission — a second, separate File System Access prompt from the
    // "read" grant already obtained when the workspace connects. There is
    // nothing to log before a real session exists (AuthActivityLogEntry
    // always requires a signed-in username), so wiring the workspace in is
    // deferred to applySession() below, at the moment a real login actually
    // happens.
  }, []);
```

Actually, since this effect now does nothing, remove it entirely rather than leaving an empty effect:

```tsx
// Delete the effect at lines 184-188 entirely (do not leave an empty useEffect).
```

```tsx
// Find `function applySession(nextSession: AuthSession): void {` (around line 428) and change it to:
  function applySession(nextSession: AuthSession): void {
    // Wire the activity log to this workspace now, at the moment a real
    // session starts — not eagerly on workspace-ready (see removed effect
    // above). This is the first point a "readwrite" permission prompt for
    // the activity log is actually justified, since writeSession() below
    // calls startAuthActivitySession(), the first real log-worthy event.
    configureAuthActivityLogWorkspace(
      workspaceStatus === "ready" ? directoryHandle : null
    );
    writeSession(nextSession);
    setSession(nextSession);
    setLogoutNotice("");
  }
```

Also handle the demo-login path, which sets a session WITHOUT calling `applySession` (`AuthGate.tsx:190-209`, the demo auto-login effect calls `writeSession(demoSession)` directly, not `applySession`):

```tsx
// In the demo auto-login effect (around line 190-209), before the existing
// `writeSession(demoSession);` line, add:
      configureAuthActivityLogWorkspace(
        workspaceStatus === "ready" ? directoryHandle : null
      );
      writeSession(demoSession);
```

- [ ] **Step 4: Run the authActivityLog test again to confirm nothing there broke**

Run: `npx vitest run src/auth/authActivityLog.test.ts`
Expected: PASS, identical to Step 2 (this file's own tests don't touch `AuthGate.tsx`, so they should be unaffected — this step just confirms the library functions are still intact after Step 3's edits to a different file).

- [ ] **Step 5: Typecheck, lint, and run the AuthGate test suite**

Run: `npm run typecheck && npm run lint && npx vitest run src/auth`
Expected: all clean. If an existing `AuthGate.test.tsx`-style file asserts the OLD eager-call behavior (asserts `configureAuthActivityLogWorkspace` is called on workspace-ready before login), that assertion needs updating to match the new deferred behavior — check the `src/auth` test output carefully for any such failure and fix the assertion to match the new, correct behavior (call happens at `applySession`/demo-login time, not on workspace-ready).

- [ ] **Step 6: Edit log + version bump + commit**

Run `npm run count-lines -- --quiet` before/after. Insert the new entry at the TOP of `docs/edit logs/2026-08-03.md` (immediately after the `# Edit Log — 2026-08-03` line, before the existing v59.129 entry). Bump `package.json` to match. Run `npm run check:release` to confirm.

```bash
git add src/auth/AuthGate.tsx src/auth/authActivityLog.test.ts "docs/edit logs/2026-08-03.md" package.json
git commit -m "fix(auth): defer activity-log workspace wiring to real login, not workspace-ready" -- src/auth/AuthGate.tsx src/auth/authActivityLog.test.ts "docs/edit logs/2026-08-03.md" package.json
```

---

### Task 2: Fix the role-based menu flash

**Files:**
- Modify: `src/data/workspace/WorkspaceGate.tsx:233-264`
- Test: `src/data/workspace/WorkspaceGate.test.tsx` (new file, `jsdom` environment)

**Interfaces:**
- Consumes: `useWorkspace()` from `src/data/workspace/useWorkspace.ts` — already returns `usersHydrated?: boolean` on `WorkspaceContextValue` (unchanged).
- Produces: `WorkspaceGate`'s public props (`{ session, children }`) are unchanged. Internal rendering gate changes from `status === "ready"` to `status === "ready" && usersHydrated`.

**Background:** `WorkspaceGate` renders `children` (which is `AppContent`, holding the tab sidebar) as soon as `status === "ready"`, without checking `usersHydrated` — a flag that flips true only after the workspace's real disk-synced permission matrix has been synced into memory (`applyDiskUsers`/`syncUsersFromDisk`, per `WorkspaceProvider.tsx`). `AppContent`'s `allowedTabs` (`App.tsx:60-86`) computes off `permissions` state that's read from the (possibly still-default) in-memory user-management state at that moment, so a role with restricted access can briefly see the unfiltered/default tab set. `AuthGate.tsx` already solves an analogous race by gating an effect on `usersHydrated` (lines 235-262) — this task applies the same flag to `WorkspaceGate`'s render gate.

- [ ] **Step 1: Write the failing test**

```tsx
// src/data/workspace/WorkspaceGate.test.tsx
/* @vitest-environment jsdom */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkspaceContext, type WorkspaceContextValue } from "./WorkspaceContext";
import { WorkspaceGate } from "./WorkspaceGate";
import type { AuthSession } from "../../auth/authTypes";

vi.mock("../../auth/authConfig", () => ({
  ADMIN_SHORTCUT_KEYS: [],
  VIEWER_PASSWORD: "unused",
}));

function makeContextValue(overrides: Partial<WorkspaceContextValue>): WorkspaceContextValue {
  return {
    status: "ready",
    directoryHandle: null,
    selectedDirectoryName: "",
    loadedFiles: { manifest: null, usersPermissions: null, sampleMaster: null, sampleDistribution: null },
    missingItems: [],
    invalidItems: [],
    message: "",
    isSupported: true,
    pendingReconnect: false,
    usersHydrated: true,
    selectWorkspace: async () => {},
    reconnectWorkspace: async () => {},
    reloadWorkspace: async () => {},
    refreshPermissions: async () => true,
    createInitialStructure: async () => {},
    clearWorkspace: () => {},
    enterDemoWorkspace: async () => {},
    ...overrides,
  };
}

const session: AuthSession = { role: "employee", username: "alice", loginAt: new Date().toISOString() };

describe("WorkspaceGate — usersHydrated render gate (Task 2)", () => {
  it("does not render children when status is ready but usersHydrated is false", () => {
    const value = makeContextValue({ status: "ready", usersHydrated: false });
    render(
      <WorkspaceContext.Provider value={value}>
        <WorkspaceGate session={session}>
          <div data-testid="app-content">app</div>
        </WorkspaceGate>
      </WorkspaceContext.Provider>
    );
    expect(screen.queryByTestId("app-content")).toBeNull();
  });

  it("renders children once status is ready AND usersHydrated is true", () => {
    const value = makeContextValue({ status: "ready", usersHydrated: true });
    render(
      <WorkspaceContext.Provider value={value}>
        <WorkspaceGate session={session}>
          <div data-testid="app-content">app</div>
        </WorkspaceGate>
      </WorkspaceContext.Provider>
    );
    expect(screen.queryByTestId("app-content")).not.toBeNull();
  });
});
```

If `WorkspaceGate.tsx`'s top of file (lines 1-18) imports anything else that this minimal render pulls in transitively and errors in a `jsdom`+no-workspace test environment (e.g. `useFocusTrap`, `FirstRunChecklist`'s own dependencies), add the minimal additional mock needed and note it in your report — don't restructure `WorkspaceGate.tsx` to avoid a test-environment issue.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/workspace/WorkspaceGate.test.tsx`
Expected: FAIL on the first test ("does not render children when... usersHydrated is false") — today's code renders children as soon as `status === "ready"`, ignoring `usersHydrated`.

- [ ] **Step 3: Add `usersHydrated` to the gate**

```tsx
// src/data/workspace/WorkspaceGate.tsx
// Replace the useWorkspace() destructure (lines 234-241):
//   const {
//     status,
//     message,
//     missingItems,
//     invalidItems,
//     selectWorkspace,
//     createInitialStructure
//   } = useWorkspace();
// with:
  const {
    status,
    usersHydrated,
    message,
    missingItems,
    invalidItems,
    selectWorkspace,
    createInitialStructure
  } = useWorkspace();
```

```tsx
// Replace the "ready" render branch (lines 256-264):
//   // Workspace is ready — render the full app + (admin-only) first-run checklist
//   if (status === "ready") {
//     return (
//       <>
//         {children}
//         <FirstRunChecklist session={session} />
//       </>
//     );
//   }
// with:
  // Workspace is ready — render the full app + (admin-only) first-run checklist.
  // Also wait for usersHydrated: status flips to "ready" before the workspace's
  // real disk-synced permission matrix has been synced into memory (see
  // WorkspaceProvider.applyWorkspaceHandle), so rendering on status alone lets
  // AppContent briefly compute its tab list from stale/default permissions —
  // the role-menu-flash bug. AuthGate already gates an analogous race on this
  // same flag (see its usersHydrated effect).
  if (status === "ready" && usersHydrated) {
    return (
      <>
        {children}
        <FirstRunChecklist session={session} />
      </>
    );
  }

  // status is "ready" but usersHydrated hasn't caught up yet — show a brief,
  // neutral loading state instead of children computed from stale permissions.
  if (status === "ready" && !usersHydrated) {
    return (
      <div className="workspace-gate" dir="rtl">
        <div className="workspace-gate-card">
          <div className="workspace-gate-spinner" aria-hidden="true" />
        </div>
      </div>
    );
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/data/workspace/WorkspaceGate.test.tsx`
Expected: PASS, both tests.

- [ ] **Step 5: Typecheck, lint, and run the broader workspace test suite**

Run: `npm run typecheck && npm run lint && npx vitest run src/data/workspace src/App.landing.test.tsx`
Expected: all clean. `src/App.landing.test.tsx` (an existing test pinning "employee lands on employee-workspace" default-tab logic) renders `AppContent` directly with `userManagement` mocked and bypasses `WorkspaceGate` entirely per its own design — it should be unaffected by this change, but run it to confirm.

- [ ] **Step 6: Edit log + version bump + commit**

Insert the new entry at the top of `docs/edit logs/2026-08-03.md` (before the entry from Task 1). Bump `package.json`. Confirm `npm run check:release`.

```bash
git add src/data/workspace/WorkspaceGate.tsx src/data/workspace/WorkspaceGate.test.tsx "docs/edit logs/2026-08-03.md" package.json
git commit -m "fix(workspace): gate tab rendering on usersHydrated to stop the role-menu flash" -- src/data/workspace/WorkspaceGate.tsx src/data/workspace/WorkspaceGate.test.tsx "docs/edit logs/2026-08-03.md" package.json
```

---

### Task 3: Parallelize the independent writes in `saveMonthRun`

**Files:**
- Modify: `src/data/population/populationStorage.ts` (the `saveMonthRunLocked` function)
- Test: `src/data/population/populationStorage.test.ts` (extend existing file)

**Interfaces:**
- Consumes: nothing new.
- Produces: `saveMonthRun`'s public signature and `SaveMonthRunResult` return type are UNCHANGED. Internal write ordering changes: independent writes (`risk.source.*`, `bi.source.*`, `risk.raw.json`, `bi.raw.json`) run concurrently via `Promise.all` instead of sequentially; `population.final.json` still writes before the replacement-index rebuild (data dependency: the rebuild reads back this file's revision); the replacement-index rebuild and `processing.summary.json` write run concurrently with each other (independent); `month.manifest.json` still writes strictly last.

**Background:** `saveMonthRunLocked` currently `await`s each file write in sequence even though most of them target different files with no data dependency between them. Per the design spec: "parallelize the writes that have no ordering dependency (bucket files can write concurrently; only the manifest/index needs to commit last)."

- [ ] **Step 1: Write the failing characterization test**

```ts
// Append to src/data/population/populationStorage.test.ts
describe("saveMonthRun — parallel independent writes (Task 3)", () => {
  it("writes all expected files and the manifest reflects the final state, regardless of write ordering", async () => {
    const root = createMemoryDirectory();
    const riskRows = [{ id: "r1" }] as unknown as MonthRawRow[];
    const biRows = [{ id: "b1" }] as unknown as MonthRawRow[];
    const processedRows = [
      { xrayImageId: "x1", certScanStatus: "Certscan", stage: "first" },
    ] as unknown as PreparedPopulationRow[];

    const result = await saveMonthRun({
      directoryHandle: root,
      month: 5,
      year: 2026,
      username: "admin",
      riskFileName: "risk.xlsx",
      biFileName: "bi.xlsx",
      certScanUsed: true,
      riskRawRows: riskRows,
      biRawRows: biRows,
      processedRows,
      certScanRows: 1,
      nonCertScanRows: 0,
      confirmedOverwrite: true,
    });

    expect(result.ok).toBe(true);

    const monthDir = await getPopulationMonthDir(root, "5-May-2026", false);
    const manifestResult = await safeReadJson<MonthManifestData>(monthDir, "month.manifest.json");
    expect(manifestResult.ok).toBe(true);
    if (!manifestResult.ok) return;
    expect(manifestResult.value.totalProcessedRows).toBe(1);
    expect(manifestResult.value.totalRawRows).toBe(1);

    const rawDir = await monthDir.getDirectoryHandle(POPULATION_SUBFOLDERS.raw, { create: false });
    const riskRaw = await safeReadJson(rawDir, "risk.raw.json");
    const biRaw = await safeReadJson(rawDir, "bi.raw.json");
    expect(riskRaw.ok).toBe(true);
    expect(biRaw.ok).toBe(true);

    const processedDir = await monthDir.getDirectoryHandle(POPULATION_SUBFOLDERS.processed, { create: false });
    const finalData = await safeReadJson<PopulationFinalData>(processedDir, "population.final.json");
    expect(finalData.ok).toBe(true);
  });
});
```

Adjust the exact shape of `MonthRawRow`/`PreparedPopulationRow` test fixtures to whatever minimal valid shape this test file's OTHER existing tests already use for `saveMonthRun` calls — search this same test file for an existing `saveMonthRun(` call and copy its fixture-construction style exactly, rather than inventing a new one, so this test matches established conventions in the file.

- [ ] **Step 2: Run test to verify it passes against current (sequential) code**

Run: `npx vitest run src/data/population/populationStorage.test.ts -t "parallel independent writes"`
Expected: PASS. This characterizes correct end-state behavior before the refactor — the test doesn't care about ordering, only the final written state, so it should pass both before and after Step 3's change.

- [ ] **Step 3: Parallelize the independent writes**

```ts
// src/data/population/populationStorage.ts
// Inside saveMonthRunLocked, replace the sequential block from the
// "Copy source xlsx files as-is" comment through the population.final.json
// write (i.e. everything from the current risk.source/bi.source copies
// through risk.raw.json/bi.raw.json) with:

      // Copy source xlsx files and write raw JSON — these four writes target
      // disjoint files with no data dependency on each other, so they run
      // concurrently. Each conditional branch is wrapped in an IIFE so
      // Promise.all can await a uniform array regardless of which conditions
      // are true.
      await Promise.all([
        (async () => {
          if (!params.riskSourceFile) return;
          const buf = await params.riskSourceFile.arrayBuffer();
          const ext = params.riskSourceFile.name.split(".").pop() ?? "xlsx";
          await saveBinaryFile(rawDir, `risk.source.${ext}`, buf);
        })(),
        (async () => {
          if (!params.biSourceFile) return;
          const buf = await params.biSourceFile.arrayBuffer();
          const ext = params.biSourceFile.name.split(".").pop() ?? "xlsx";
          await saveBinaryFile(rawDir, `bi.source.${ext}`, buf);
        })(),
        (async () => {
          if (riskRawRows.length === 0) return;
          const supersedes = await archiveExistingRaw(rawDir, "risk");
          const riskRaw: MonthRawData = {
            sourceFileName: riskFileName ?? "unknown",
            importedAt: now,
            importedBy: username,
            supersedes,
            rows: riskRawRows
          };
          await safeWriteJson(rawDir, "risk.raw.json", riskRaw);
        })(),
        (async () => {
          if (biRawRows.length === 0) return;
          const supersedes = await archiveExistingRaw(rawDir, "bi");
          const biRaw: MonthRawData = {
            sourceFileName: biFileName ?? "unknown",
            importedAt: now,
            importedBy: username,
            supersedes,
            rows: biRawRows
          };
          await safeWriteJson(rawDir, "bi.raw.json", biRaw);
        })(),
      ]);

      // Save processed population. Must complete before the replacement-index
      // rebuild below, which reads this file's envelope revision back.
      const finalData: PopulationFinalData = {
        sourceMonthFolder: monthFolderName,
        processedAt: now,
        processedBy: username,
        totalRows: processedRows.length,
        certScanRows,
        nonCertScanRows,
        rows: processedRows
      };
      await safeWriteJson(processedDir, "population.final.json", finalData);
```

```ts
// Replace the two subsequent independent steps (the try/catch
// rebuildReplacementIndex block, and the processing.summary.json write) —
// currently sequential — with a single Promise.all, since neither depends on
// the other (only both depend on population.final.json above, already
// awaited):

      await Promise.all([
        (async () => {
          // Best-effort, non-fatal: a replacement-candidate lookup index
          // (deliberate exception to the pending large-population performance
          // proposal's phase sequence — see docs/edit logs/2026-07-22.md
          // v59.0). Its failure must never sink an otherwise-successful
          // population save; the replacement flow falls back to a
          // full-population read when the index is missing or stale.
          try {
            const sourceRevision = await readEnvelopeRevision(processedDir, "population.final.json");
            if (sourceRevision !== null) {
              const config = await loadPopulationConfig(directoryHandle);
              await rebuildReplacementIndex(
                directoryHandle,
                monthFolderName,
                processedRows as PreparedPopulationRow[],
                config.stageMappings,
                sourceRevision,
                username
              );
            }
          } catch (error) {
            logError("population:rebuild-replacement-index", error);
          }
        })(),
        (async () => {
          if (!params.processingSummary) return;
          const summaryData: ProcessingSummaryData = {
            ...params.processingSummary,
            savedAt: now,
          };
          await safeWriteJson(processedDir, "processing.summary.json", summaryData);
        })(),
      ]);

      // Save month manifest — must be last: it records totals/paths that
      // depend on every write above having committed.
      const manifest: MonthManifestData = {
        monthFolderName,
        month,
        year,
        processedAt: now,
        processedBy: username,
        runnedAt: now,
        runnedBy: username,
        riskFileName,
        biFileName,
        certScanUsed,
        templateVersion: null,
        rngSeed: null,
        totalRawRows: riskRawRows.length,
        totalProcessedRows: processedRows.length,
        status: "processed-saved",
        processingFingerprint: params.processingFingerprint ?? null,
        processingSummaryFile: params.processingSummary
          ? `${POPULATION_SUBFOLDERS.processed}/processing.summary.json`
          : null,
        sourceFiles: params.sourceFiles
      };
      await safeWriteJson(monthDir, "month.manifest.json", manifest);

      return { ok: true, monthFolderName };
```

Leave everything before the "Copy source xlsx files" comment (the TOCTOU overwrite-confirmation check, `withWorkspaceWriteAccess` wrapper, folder creation) and everything structural around these blocks (the outer `try`/`catch`, the `return await withWorkspaceWriteAccess(...)` wrapper) exactly as they are — only the write-sequencing inside changes.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/data/population/populationStorage.test.ts`
Expected: PASS, full file — both the new test and every pre-existing `saveMonthRun`-related test, since final on-disk state is unchanged, only write concurrency changed.

- [ ] **Step 5: Run the replacement-index and replacement-candidate suites, which exercise `rebuildReplacementIndex` transitively**

Run: `npx vitest run src/data/population/replacementIndexStorage.test.ts src/data/distribution/replacementCandidateLookup.test.ts`
Expected: PASS, unmodified.

- [ ] **Step 6: Typecheck, lint, full suite**

Run: `npm run typecheck && npm run lint && npm run test:run`
Expected: all clean, full suite green.

- [ ] **Step 7: Edit log + version bump + commit**

Insert at the top of the edit log (before Task 2's entry). Bump `package.json`. Confirm `npm run check:release`.

```bash
git add src/data/population/populationStorage.ts src/data/population/populationStorage.test.ts "docs/edit logs/2026-08-03.md" package.json
git commit -m "perf(population): parallelize saveMonthRun's independent file writes" -- src/data/population/populationStorage.ts src/data/population/populationStorage.test.ts "docs/edit logs/2026-08-03.md" package.json
```

---

### Task 4: Parallelize the bucket writes in `rebuildReplacementIndex`

**Files:**
- Modify: `src/data/population/replacementIndexStorage.ts:176-195`
- Test: `src/data/population/replacementIndexStorage.test.ts` (extend existing file)

**Interfaces:**
- Consumes: nothing new.
- Produces: `rebuildReplacementIndex`'s public signature and return type are UNCHANGED. `bucketEntries` (fed into the manifest) is still built in the SAME order (`ALL_TIERS × ALL_STAGE_KEYS`, tier-major) regardless of which write completes first, since `Promise.all` preserves input-array order in its output.

**Background:** The `for (tier) for (stageKey))` loop writes up to 10 bucket files sequentially, each `await`ed before the next iteration starts, even though every bucket file is independent (different filename, no shared state other than the accumulating `bucketEntries` array). Converting to `Promise.all` over all (tier, stageKey) pairs parallelizes the writes while preserving `bucketEntries`' original order via array-index alignment, not completion order.

- [ ] **Step 1: Write the failing characterization test**

```ts
// Append to src/data/population/replacementIndexStorage.test.ts
describe("rebuildReplacementIndex — parallel bucket writes (Task 4)", () => {
  it("writes all non-empty buckets and preserves tier-major bucket order in the manifest", async () => {
    const root = createMemoryDirectory();
    const month = "5-May-2026";
    const rows = [
      { xrayImageId: "a", certScanStatus: "Certscan", stage: "first" },
      { xrayImageId: "b", certScanStatus: "Certscan", stage: "second" },
      { xrayImageId: "c", certScanStatus: "NonCertscan", stage: "first" },
    ] as unknown as PreparedPopulationRow[];

    const result = await rebuildReplacementIndex(root, month, rows, undefined, 1, "admin");
    expect(result.ok).toBe(true);

    const manifest = await loadReplacementIndexManifest(root, month);
    expect(manifest).not.toBeNull();
    if (!manifest) return;
    // Tier-major order: all Certscan buckets before all NonCertscan buckets,
    // and within each tier, stage keys in ALL_STAGE_KEYS order.
    const order = manifest.buckets.map((b) => `${b.tier}::${b.stageKey}`);
    expect(order).toEqual(["Certscan::first", "Certscan::second", "NonCertscan::first"]);
    expect(manifest.totalIndexedRows).toBe(3);
  });
});
```

Adjust fixture construction to match whatever minimal valid `PreparedPopulationRow`/call-signature style this test file's existing `rebuildReplacementIndex` tests already use (check the file for an existing call and copy its exact argument shapes — `certScanStatus`/`stage` field names and `getStageKey`'s expected inputs must match what this file's other tests already established).

- [ ] **Step 2: Run test to verify it passes against current (sequential) code**

Run: `npx vitest run src/data/population/replacementIndexStorage.test.ts -t "parallel bucket writes"`
Expected: PASS — this characterizes the correct end state (order, counts) before the refactor.

- [ ] **Step 3: Parallelize the bucket-write loop**

```ts
// src/data/population/replacementIndexStorage.ts
// Replace the nested for-loop (currently building `bucketEntries` via
// sequential push-after-await) with:

      const dir = await getReplacementIndexDir(directoryHandle, monthFolderName, true);
      const tierStagePairs = ALL_TIERS.flatMap((tier) =>
        ALL_STAGE_KEYS.map((stageKey) => ({ tier, stageKey }))
      );
      const bucketResults = await Promise.all(
        tierStagePairs.map(async ({ tier, stageKey }): Promise<ReplacementIndexBucketEntry | null> => {
          const fileName = bucketFileName(tier, stageKey);
          const rows = buckets.get(`${tier}::${stageKey}`);
          if (rows && rows.length > 0) {
            await safeWriteJson(dir, fileName, rows);
            return { tier, stageKey, fileName, rowCount: rows.length };
          }
          if (dir.removeEntry) {
            // Best-effort: a bucket that shrank to zero rows on a reprocess is
            // simply not referenced by the new manifest, so a leftover file is
            // harmless — but remove it anyway to avoid stale-data confusion.
            try {
              await dir.removeEntry(fileName);
            } catch {
              // ignore — not referenced by the manifest either way
            }
          }
          return null;
        })
      );
      const bucketEntries: ReplacementIndexBucketEntry[] = bucketResults.filter(
        (entry): entry is ReplacementIndexBucketEntry => entry !== null
      );
```

This replaces the block from `const dir = await getReplacementIndexDir(...)` through the closing `}` of the nested `for` loops (immediately before the `return await casLoop<...>(` call) — the `casLoop` block and everything after it stays unchanged. `Promise.all` preserves the order of `tierStagePairs` in `bucketResults` regardless of which write settles first, so `bucketEntries` (after filtering out `null`s) keeps the same tier-major, stage-minor order the sequential loop produced.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/data/population/replacementIndexStorage.test.ts`
Expected: PASS, full file.

- [ ] **Step 5: Run the transitive caller's suite**

Run: `npx vitest run src/data/distribution/replacementCandidateLookup.test.ts src/data/population/populationStorage.test.ts`
Expected: PASS, unmodified (both call `rebuildReplacementIndex` transitively).

- [ ] **Step 6: Typecheck, lint, full suite**

Run: `npm run typecheck && npm run lint && npm run test:run`
Expected: all clean, full suite green.

- [ ] **Step 7: Edit log + version bump + commit**

Insert at the top of the edit log. Bump `package.json`. Confirm `npm run check:release`.

```bash
git add src/data/population/replacementIndexStorage.ts src/data/population/replacementIndexStorage.test.ts "docs/edit logs/2026-08-03.md" package.json
git commit -m "perf(population): parallelize replacement-index bucket writes" -- src/data/population/replacementIndexStorage.ts src/data/population/replacementIndexStorage.test.ts "docs/edit logs/2026-08-03.md" package.json
```

---

### Task 5: Remove the sample dual-review approval gate

**Files:**
- Modify: `src/components/Sidebar/Tabs/Population/index.tsx` (the `moveToNextPhase` gate block, `handleApproveSample`, `sampleNeedsApproval`/`isApprovingSample` state, the `PhaseThreeSampling` props passed)
- Modify: `src/components/Sidebar/Tabs/Population/components/PhaseThreeSampling.tsx` (remove `SampleApprovalPanel` and its props)
- Test: `src/components/Sidebar/Tabs/Population/populationDemandGating.test.tsx` or wherever this repo's existing Phase 3→4 transition tests live (search for `isDistributionAllowed`/`sample_gate_blocked` in test files first — extend whichever file already covers this)

**Interfaces:**
- Consumes: nothing new.
- Produces: `PhaseThreeSamplingProps` LOSES the fields `sampleNeedsApproval`, `isApprovingSample`, `onApproveSample` (a genuine prop-surface reduction — this is a deliberate, owner-approved behavior removal, not an oversight). All other props are unchanged. `moveToNextPhase`'s Phase 3→4 transition no longer blocks on approval state.

**Background:** Per the design spec §B, this is a deliberate segregation-of-duties control the owner decided to remove entirely (not reduce friction on) — "remove entirely, not keep but reduce friction. No replacement gate." `src/data/distribution/` never referenced `sample.approval`, so removing this is contained to the two UI files above. `src/data/sampling/sampleApprovalRules.ts` (the pure rule functions: `isDistributionAllowed`, `sampleRequiresApproval`, `evaluateApprovalEligibility`, `canApproveSample`, `buildSampleApproval`, `isSelfApproval`) stays in place, untouched — it's dead code after this change but removing it is out of scope for this task (tracked separately as a §R cleanup candidate; deleting it now would risk breaking `sampleApprovalRules.test.ts`'s existing unit coverage for no in-scope benefit).

- [ ] **Step 1: Write the failing test — Phase 3 → Phase 4 no longer blocks on approval state**

First, search for the existing test(s) that assert the CURRENT blocking behavior:

Run: `grep -rn "sample_gate_blocked\|isDistributionAllowed" src/components/Sidebar/Tabs/Population/*.test.tsx src/components/Sidebar/Tabs/Population/**/*.test.tsx 2>/dev/null`

If a test asserts the block currently happens (e.g. in `populationDemandGating.test.tsx` or similar), that assertion is now WRONG per this task's goal and must be INVERTED, not just deleted — write the new expected behavior explicitly rather than silently removing coverage:

```tsx
// In whichever existing test file exercises moveToNextPhase's Phase 3→4
// transition, find and update the test that currently asserts the sample
// stays on phase 3 when unapproved. Change it to assert the OPPOSITE:
it("moves from phase 3 to phase 4 even when the sample has not been approved", async () => {
  // ... reuse this test file's existing setup for reaching phase 3 with a
  // drawn-but-unapproved sample (same fixture/render helpers already used by
  // the test this replaces) ...

  // Click "next phase" (however this test file already simulates that click).
  // Assert: the wizard is now on phase 4 (or whatever this file's existing
  // assertion helper checks for phase transitions), and NO
  // "يجب اعتماد العينة قبل الانتقال إلى مرحلة التوزيع" (sample_gate_blocked)
  // message appears.
});
```

If no existing test covers this transition at all, create a minimal one in `src/components/Sidebar/Tabs/Population/populationDemandGating.test.tsx` (an existing file per this repo's structure) following that file's established rendering/mocking conventions for the Population wizard — do not invent a new heavyweight render harness if this file already has one suitable for reaching Phase 3.

- [ ] **Step 2: Run test to verify it fails (or, if inverting an existing test, verify the ORIGINAL version currently passes, confirming the gate is live today)**

Run: `npx vitest run <the test file> -t "<test name>"`
Expected: the new/inverted test FAILS against current code (the gate is still blocking), confirming the gate is genuinely active before you remove it.

- [ ] **Step 3: Remove the gate in `index.tsx`**

```tsx
// src/components/Sidebar/Tabs/Population/index.tsx
// In moveToNextPhase (around line 1146-1180), delete this block entirely:
//     if (
//       currentPhase === 3 &&
//       !isDistributionAllowed({ approval: sampleDrawResult?.approval, needsApproval: effectiveSampleNeedsApproval })
//     ) {
//       setSampleSaveMessage({ type: "error", text: getLabels().sample_gate_blocked });
//       return;
//     }
// (Keep the surrounding phase-2 and phase-1 gates — currentPhase === 2 && !populationProcessingResult,
//  and currentPhase === 3 && !sampleDrawResult — those are unrelated data-readiness checks, not the
//  approval gate, and must stay exactly as they are.)
```

```tsx
// Remove the now-dead state and handler:
// - `const [sampleNeedsApproval, setSampleNeedsApproval] = useState(false);` (~line 401)
// - the `effectiveSampleNeedsApproval` derivation (~lines 404-406)
// - `const [isApprovingSample, setIsApprovingSample] = useState(false);` (~line 407)
// - the full `handleApproveSample` function (~lines 1082-1144)
// Remove the now-unused imports this leaves behind (check the top of the file
// for `evaluateApprovalEligibility`, `buildSampleApproval`, `approveSampleMaster`,
// `sampleRequiresApproval` — remove any of these whose only call site was
// `handleApproveSample`/`effectiveSampleNeedsApproval`; keep any still used
// elsewhere in this file, e.g. if `sampleRequiresApproval` or similar is
// referenced anywhere else, leave that import in place).
```

```tsx
// Update the PhaseThreeSampling render call (~lines 1290-1309) to drop the
// three removed props:
          <PhaseThreeSampling
            populationRows={populationProcessingResult?.preparedRows ?? []}
            sampleSeed={sampleSeed}
            isDrawingSample={isDrawingSample}
            sampleDrawResult={sampleDrawResult}
            sampleSaveMessage={sampleSaveMessage}
            config={config}
            userRole={sessionRef.current?.role ?? "employee"}
            currentUsername={sessionRef.current?.username ?? "unknown"}
            priorMonthAdvisory={priorMonthAdvisory}
            canDrawSample={canDrawSample}
            canConfigureSample={canConfigureSample}
            processingMessage={processingMessage}
            onConfigChange={handleConfigChange}
            onSampleSeedChange={setSampleSeed}
            onDrawSample={() => { void handleDrawSample(); }}
          />
```

- [ ] **Step 4: Remove `SampleApprovalPanel` in `PhaseThreeSampling.tsx`**

```tsx
// src/components/Sidebar/Tabs/Population/components/PhaseThreeSampling.tsx
// Delete the entire SampleApprovalPanel function (lines 92-180) and its two
// style helper constants immediately below it that are ONLY used by that
// function — approvalTitleStyle and approvalBoxStyle (lines 182-191). Check
// first that neither style helper is referenced anywhere else in this file
// (grep the file for approvalTitleStyle / approvalBoxStyle) before deleting
// them — delete only if SampleApprovalPanel was their sole consumer.
```

```tsx
// Remove the three fields from PhaseThreeSamplingProps (lines 26, 27, 42):
//   sampleNeedsApproval: boolean;
//   ...
//   isApprovingSample: boolean;
//   ...
//   onApproveSample: () => void;
```

```tsx
// Remove the three from the destructured props in the component signature
// (lines 210, 211, 215):
//   sampleNeedsApproval,
//   isApprovingSample,
//   ...
//   onApproveSample,
```

```tsx
// Remove the SampleApprovalPanel render call (lines 458-467):
//   {sampleDrawResult && (
//     <SampleApprovalPanel
//       sample={sampleDrawResult}
//       userRole={userRole}
//       currentUsername={currentUsername}
//       needsApproval={sampleNeedsApproval}
//       isApproving={isApprovingSample}
//       onApprove={onApproveSample}
//     />
//   )}
// (Keep the SampleResultReport render immediately after it, unchanged:
//  {sampleDrawResult && <SampleResultReport data={sampleDrawResult} />})
```

```tsx
// Remove now-unused imports at the top of the file if SampleApprovalPanel was
// their only consumer — check each of: AlertTriangle, CheckCircle2, ShieldCheck
// (from "lucide-react"), evaluateApprovalEligibility, isSelfApproval (from
// "../../../../../data/sampling/sampleApprovalRules") — grep the rest of this
// file for each name before removing its import; keep any still used
// elsewhere (e.g. `Lock`/`Unlock`/`Info` from lucide-react are very likely
// still used by SwitchingAdvisory or the stage-unlock UI further down this
// same file — only remove icons/functions confirmed unused after the deletion).
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run <the test file from Step 1>`
Expected: PASS — Phase 3 → 4 now transitions without the approval block.

- [ ] **Step 6: Run the full Population test suite and `sampleApprovalRules.test.ts`**

Run: `npx vitest run src/components/Sidebar/Tabs/Population src/data/sampling/sampleApprovalRules.test.ts`
Expected: `sampleApprovalRules.test.ts` PASSES unmodified (the pure rule functions are untouched, only their UI call sites are removed). Any OTHER Population test that references `sampleNeedsApproval`/`isApprovingSample`/`onApproveSample`/`SampleApprovalPanel` will now fail to compile or fail an assertion — fix each one to match the new, reduced prop surface (remove references to the deleted props/component; do not add them back).

- [ ] **Step 7: Typecheck, lint, full suite**

Run: `npm run typecheck && npm run lint && npm run test:run`
Expected: all clean, full suite green. Typecheck in particular will catch any remaining reference to a removed prop/import that Step 6's targeted test run didn't happen to exercise.

- [ ] **Step 8: Edit log + version bump + commit**

Category: `Remove:` (per CLAUDE.md's category list — this task's primary action is removing a feature, not fixing a bug). Insert at the top of the edit log. Bump `package.json`. Confirm `npm run check:release`.

```bash
git add src/components/Sidebar/Tabs/Population/index.tsx src/components/Sidebar/Tabs/Population/components/PhaseThreeSampling.tsx "docs/edit logs/2026-08-03.md" package.json
# Also add whichever test file Step 1/6 modified — list it explicitly here rather than using a wildcard.
git commit -m "remove(population): drop the sample dual-review approval gate" -- src/components/Sidebar/Tabs/Population/index.tsx src/components/Sidebar/Tabs/Population/components/PhaseThreeSampling.tsx "docs/edit logs/2026-08-03.md" package.json
```

(If Step 1/6 modified an additional test file, add it to both the `git add` and the `git commit --` pathspec list before running.)

---

### Task 6: Pending/resolved status color-coding instead of hiding rows

**Files:**
- Modify: `src/data/referral/referralStorage.ts` (add `getPendingReplacementIds`)
- Modify: `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx` (`loadData`, `getRowClassName`)
- Modify: `src/components/DataTable/DataTable.css` (new `dt-tr--pending`/`dt-tr--resolved` rule blocks)
- Test: `src/data/referral/referralStorage.test.ts` (extend) and `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.test.tsx` (extend)

**Interfaces:**
- Consumes: `DistributionEntry` type from `src/data/distribution/distributionTypes.ts` (unchanged — `status: "pending" | "completed" | "replacement-requested" | "replaced"`), `ReplacementLog`/`ReplacementRequest` from `src/data/referral/referralTypes.ts` (unchanged), `loadReplacementLog` from `src/data/referral/referralStorage.ts` (unchanged signature, now actually called from `XrayReferrals.tsx` for the first time).
- Produces: `export function getPendingReplacementIds(log: ReplacementLog, employeeUsername: string): Set<string>` — new export from `src/data/referral/referralStorage.ts`, mirroring the existing `getPendingReferralIds`'s shape exactly but keyed on `ReplacementRequest.employeeUsername`/`originalXrayImageId` instead of `ReferralRequest.fromEmployee`/`xrayImageIds`.

**Background:** Per design spec §C, two of the three replace/reassign paths (reassign via referral, non-recommended replace) already write a proper `"pending"` request before anything applies — they just get hidden from view today via `!pendingIds.has(e.xrayImageId)` (`XrayReferrals.tsx:378`), and pending `ReplacementRequest`s aren't filtered at all today (no equivalent check exists), so they stay visible as plain, undifferentiated rows. This task: (1) stops excluding referral-pending rows, (2) adds the missing replacement-pending check and colors those rows the same way, (3) adds a distinct "resolved" color for rows that were actually replaced (`status === "replaced"`) — instant or post-approval, per the owner's decision to keep recommended-candidate replace instant but still highlight its result the same as an approved one.

- [ ] **Step 1: Write the failing test for `getPendingReplacementIds`**

```ts
// Append to src/data/referral/referralStorage.test.ts
describe("getPendingReplacementIds (Task 6)", () => {
  it("returns the originalXrayImageId of pending replacement requests for the given employee", () => {
    const log: ReplacementLog = {
      monthFolderName: "5-May-2026",
      revision: 0,
      requests: [
        {
          requestId: "r1",
          monthFolderName: "5-May-2026",
          employeeUsername: "alice",
          originalXrayImageId: "img-1",
          replacementXrayImageId: "img-2",
          reason: "test",
          requestedAt: new Date().toISOString(),
          requestedBy: "alice",
          status: "pending",
        },
        {
          requestId: "r2",
          monthFolderName: "5-May-2026",
          employeeUsername: "alice",
          originalXrayImageId: "img-3",
          replacementXrayImageId: "img-4",
          reason: "test",
          requestedAt: new Date().toISOString(),
          requestedBy: "alice",
          status: "approved",
        },
        {
          requestId: "r3",
          monthFolderName: "5-May-2026",
          employeeUsername: "bob",
          originalXrayImageId: "img-5",
          replacementXrayImageId: "img-6",
          reason: "test",
          requestedAt: new Date().toISOString(),
          requestedBy: "bob",
          status: "pending",
        },
      ],
    };

    const ids = getPendingReplacementIds(log, "alice");
    expect(ids).toEqual(new Set(["img-1"]));
  });

  it("returns an empty set when the employee has no pending replacement requests", () => {
    const log: ReplacementLog = { monthFolderName: "5-May-2026", revision: 0, requests: [] };
    expect(getPendingReplacementIds(log, "alice")).toEqual(new Set());
  });
});
```

Add `getPendingReplacementIds` and `ReplacementLog` to this test file's existing import block if not already imported (merge, don't duplicate the import line).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/referral/referralStorage.test.ts -t "getPendingReplacementIds"`
Expected: FAIL with "getPendingReplacementIds is not defined" or a TypeScript compile error — the function doesn't exist yet.

- [ ] **Step 3: Implement `getPendingReplacementIds`**

```ts
// src/data/referral/referralStorage.ts
// Add immediately after the existing getPendingReferralIds function:

/** Returns the set of xrayImageIds (the ORIGINAL, being-replaced id) that are
 *  currently in a pending replacement request from the given employee. */
export function getPendingReplacementIds(log: ReplacementLog, employeeUsername: string): Set<string> {
  const ids = new Set<string>();
  for (const req of log.requests) {
    if (req.employeeUsername === employeeUsername && req.status === "pending") {
      ids.add(req.originalXrayImageId);
    }
  }
  return ids;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/data/referral/referralStorage.test.ts -t "getPendingReplacementIds"`
Expected: PASS, both cases.

- [ ] **Step 5: Write the failing test for `XrayReferrals.tsx`'s row visibility + coloring**

Find this file's existing test setup for `loadData`/rendering the referrals table (check `XrayReferrals.test.tsx`'s existing mocking of `loadOrDeriveDistributionCurrent`/`loadReferralLog`/`loadEmployeeSampleMirror` and reuse that exact harness). Add:

```tsx
// Append to src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.test.tsx
it("shows a row with a pending referral request instead of hiding it (Task 6)", async () => {
  // Reuse this file's existing render/mock setup to reach the loaded table
  // state for an employee with one entry that has an outstanding pending
  // referral request (getPendingReferralIds would previously have hidden it).
  // Assert: the row for that xrayImageId IS present in the rendered table
  // (query by its id/text content, matching this file's existing row-lookup
  // convention), and its rendered <tr> has the "dt-tr--pending" class.
});

it("shows a resolved (replaced) row with a distinct color, not hidden", async () => {
  // Reuse this file's existing setup with an entry whose status is "replaced".
  // Assert: the row IS present, and its rendered <tr> has the "dt-tr--resolved"
  // class (not "dt-tr--pending", and not absent from the DOM).
});
```

Write the actual mock data setup using whatever pattern this test file's OTHER `describe`/`it` blocks already use for constructing a `DistributionEntry`/mocking `loadOrDeriveDistributionCurrent`'s resolved value — do not invent a new mocking approach; match the file's existing conventions exactly, including how `loadReferralLog`/`getPendingReferralIds` are currently mocked or left real.

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.test.tsx -t "Task 6"`
Expected: FAIL — the pending row is currently absent from the DOM (filtered out), and no `dt-tr--pending`/`dt-tr--resolved` class exists yet.

- [ ] **Step 7: Stop filtering pending rows and add the pending/resolved classification**

```tsx
// src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx
// In loadData, add loadReplacementLog to the initial Promise.all alongside
// loadReferralLog (find the existing import line for loadReferralLog near the
// top of the file and add loadReplacementLog to the same import statement —
// it's exported from the same "../../../../../data/referral/referralStorage"
// module), and add getPendingReplacementIds to the same import:
      const [sample, referralLog, replacementLog] = await Promise.all([
        loadSampleMaster(directoryHandle, selMonth),
        loadReferralLog(directoryHandle, selMonth),
        loadReplacementLog(directoryHandle, selMonth),
      ]);
```

```tsx
// Replace the pendingIds/visible block:
//       const pendingIds = canSeeAll ? new Set<string>() : getPendingReferralIds(referralLog, username);
//       const visible = canSeeAll
//         ? all
//         : all.filter(
//             (e) =>
//               e.assignedTo === username &&
//               e.status !== "replaced" &&
//               !pendingIds.has(e.xrayImageId)
//           );
// with:
      const pendingReferralIds = canSeeAll ? new Set<string>() : getPendingReferralIds(referralLog, username);
      const pendingReplacementIds = canSeeAll ? new Set<string>() : getPendingReplacementIds(replacementLog, username);

      // No longer excludes pending/replaced rows — they're shown with a
      // distinct color instead (see rowStatusClass below, wired into
      // getRowClassName in the render). Only the assignedTo/canSeeAll scoping
      // remains a real filter.
      const visible = canSeeAll
        ? all
        : all.filter((e) => e.assignedTo === username);
```

```tsx
// Add a small classification helper near the top of the file (module scope,
// alongside other pure helpers already in this file — do not put it inside
// the component body since it needs no closure state beyond its own params):
function rowStatusClass(
  entry: DistributionEntry,
  pendingReferralIds: Set<string>,
  pendingReplacementIds: Set<string>
): string | undefined {
  if (entry.status === "replaced") return "dt-tr--resolved";
  if (pendingReferralIds.has(entry.xrayImageId) || pendingReplacementIds.has(entry.xrayImageId)) {
    return "dt-tr--pending";
  }
  return undefined;
}
```

```tsx
// pendingReferralIds/pendingReplacementIds need to survive past loadData into
// the render — add two new state fields alongside the existing `entries`/
// `allEntries` state declarations (~line 142-143):
  const [pendingReferralIds, setPendingReferralIds] = useState<Set<string>>(new Set());
  const [pendingReplacementIds, setPendingReplacementIds] = useState<Set<string>>(new Set());
```

```tsx
// In loadData's success path, alongside the existing setEntries/setAllEntries
// calls, add:
      setPendingReferralIds(pendingReferralIds);
      setPendingReplacementIds(pendingReplacementIds);
```

The local `const pendingReferralIds`/`pendingReplacementIds` computed earlier in `loadData` intentionally shadow the outer state variables of the same name — inside `loadData`, the reference resolves to the local `const`, so `setPendingReferralIds(pendingReferralIds)` passes the freshly computed value to its setter. This is a standard, unambiguous React pattern; no renaming needed.

```tsx
// Update getRowClassName in the DataTable render call (~lines 864-866):
//               getRowClassName={(entry) =>
//                 isStudyCompleted(entry, answersMap) ? "dt-tr--completed" : undefined
//               }
// with:
              getRowClassName={(entry) =>
                isStudyCompleted(entry, answersMap)
                  ? "dt-tr--completed"
                  : rowStatusClass(entry, pendingReferralIds, pendingReplacementIds)
              }
```

- [ ] **Step 8: Add the CSS**

```css
/* src/components/DataTable/DataTable.css
   Add immediately after the existing .dt-tr--completed rule blocks (after the
   ".dt-tr.dt-tr--completed.selected .dt-td.dt-sticky-col..." rule), mirroring
   the exact same selector combinatorics (base / nth-child(even) / :hover /
   .selected / .dt-sticky-col) with new token colors instead of
   --c-success-tint*. Reuse --c-warning-bg (amber, for "pending" — matching the
   existing warning tone already used elsewhere in this app for "awaiting
   approval" states, e.g. ReplacementDialog's inline warning banner) and
   --c-info-bg (blue, for "resolved" — matching the existing "pending" badge's
   blue tone in StatusBadge, repurposed here as a resolved/complete-swap
   indicator since success-green is already taken by dt-tr--completed and would
   be ambiguous with "answer submitted"). */

.dt-tr.dt-tr--pending,
.dt-tr.dt-tr--pending:nth-child(even) {
  background: var(--c-warning-bg);
}
.dt-tr.dt-tr--pending:hover,
.dt-tr.dt-tr--pending:nth-child(even):hover {
  background: var(--c-warning-border);
}
.dt-tr.dt-tr--pending.selected,
.dt-tr.dt-tr--pending.selected:nth-child(even) {
  background: var(--c-warning-border);
  box-shadow: inset 3px 0 0 var(--c-warning);
}
.dt-tr.dt-tr--pending .dt-td.dt-sticky-col,
.dt-tr.dt-tr--pending:nth-child(even) .dt-td.dt-sticky-col {
  background: var(--c-warning-bg);
}
.dt-tr.dt-tr--pending:hover .dt-td.dt-sticky-col,
.dt-tr.dt-tr--pending:nth-child(even):hover .dt-td.dt-sticky-col {
  background: var(--c-warning-border);
}
.dt-tr.dt-tr--pending.selected .dt-td.dt-sticky-col,
.dt-tr.dt-tr--pending.selected:nth-child(even) .dt-td.dt-sticky-col {
  background: var(--c-warning-border);
}

.dt-tr.dt-tr--resolved,
.dt-tr.dt-tr--resolved:nth-child(even) {
  background: var(--c-info-bg);
}
.dt-tr.dt-tr--resolved:hover,
.dt-tr.dt-tr--resolved:nth-child(even):hover {
  background: var(--c-info-border);
}
.dt-tr.dt-tr--resolved.selected,
.dt-tr.dt-tr--resolved.selected:nth-child(even) {
  background: var(--c-info-border);
  box-shadow: inset 3px 0 0 var(--c-info);
}
.dt-tr.dt-tr--resolved .dt-td.dt-sticky-col,
.dt-tr.dt-tr--resolved:nth-child(even) .dt-td.dt-sticky-col {
  background: var(--c-info-bg);
}
.dt-tr.dt-tr--resolved:hover .dt-td.dt-sticky-col,
.dt-tr.dt-tr--resolved:nth-child(even):hover .dt-td.dt-sticky-col {
  background: var(--c-info-border);
}
.dt-tr.dt-tr--resolved.selected .dt-td.dt-sticky-col,
.dt-tr.dt-tr--resolved.selected:nth-child(even) .dt-td.dt-sticky-col {
  background: var(--c-info-border);
}
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `npx vitest run src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.test.tsx src/data/referral/referralStorage.test.ts`
Expected: PASS, all cases including the two new Task 6 tests.

- [ ] **Step 10: Run the broader EmployeeWorkspace and referral suites**

Run: `npx vitest run src/components/Sidebar/Tabs/EmployeeWorkspace src/data/referral`
Expected: PASS. Any pre-existing test asserting a pending/replaced row is ABSENT from the visible table needs updating to assert it's PRESENT with the new class instead — treat any such failure as an expected, necessary update to match this task's new behavior, not a regression to work around.

- [ ] **Step 11: Typecheck, lint, full suite**

Run: `npm run typecheck && npm run lint && npm run test:run`
Expected: all clean, full suite green.

- [ ] **Step 12: Edit log + version bump + commit**

Insert at the top of the edit log. Bump `package.json`. Confirm `npm run check:release`.

```bash
git add src/data/referral/referralStorage.ts src/data/referral/referralStorage.test.ts src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.test.tsx src/components/DataTable/DataTable.css "docs/edit logs/2026-08-03.md" package.json
git commit -m "fix(employee-workspace): show pending/resolved rows with color instead of hiding them" -- src/data/referral/referralStorage.ts src/data/referral/referralStorage.test.ts src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.test.tsx src/components/DataTable/DataTable.css "docs/edit logs/2026-08-03.md" package.json
```

---

## What this plan does NOT include

- The recommended-candidate replace path (`XrayReferrals.tsx`'s `handleReplace`, "recommended" branch) stays instant/final with no approval step, per the owner's explicit decision — Task 6 gives its result row the `dt-tr--resolved` treatment via `entry.status === "replaced"`, matching any other replaced row, without adding an approval requirement.
- Deleting `src/data/sampling/sampleApprovalRules.ts` (dead after Task 5) — tracked as a §R cleanup candidate, not in this plan.
- Everything from §H Layer 2/3, §I, §K, §L-R of the design spec — separate plans.
