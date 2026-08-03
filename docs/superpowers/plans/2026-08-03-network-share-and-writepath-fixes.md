# Network-share performance, mount preservation, permission & write-path fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement §S–§V from `docs/superpowers/specs/2026-08-03-distribution-performance-and-workflow-design.md` — close the still-open double permission prompt, cut the dominant redundant-read cost from Phase 4's write path, parallelize workspace-boot's sequential structure checks, and stop Population/EmployeeWorkspace/Reports from reloading already-loaded content on every sub-tab switch.

**Architecture:** Four independent, narrowly-scoped fixes against already-identified file:line root causes — no new subsystems, no schema changes, no changes to `deriveCurrentDistribution` or any fold/report algorithm. Tasks 1–2 are single-file, low-risk. Tasks 3–4 touch the distribution write path together (a return-type widen and its five call sites). Tasks 5–7 apply the same proven mount-preservation idiom (`App.tsx`'s `hidden={...}` + a visited-set, not a bounded LRU — these sub-tab counts are small and fixed) to three more UI surfaces.

**Tech Stack:** React 19 + TypeScript (strict), Vitest + `@testing-library/react` for component tests, `createMemoryDirectory`/`getReadLog` for storage-layer tests — same conventions already used throughout this codebase.

## Global Constraints

- Every edit needs a `docs/edit logs/YYYY-MM-DD.md` entry (today's file) per CLAUDE.md: version bump (semver-lite), category prefix, Before/After snippets, and a `**Lines:**` stat from `npm run count-lines -- --quiet` run before and after the edit. Insert new entries at the TOP of the day's file (newest-first) — `npm run check:release` reads only the topmost heading.
- Never a bare `git commit` — always `git add <specific files>` then `git commit -m "..." -- <same files>`.
- Repo-level gates before any task is considered done: `npm run test:run`, `npm run typecheck`, `npm run lint`.
- No task in this plan touches `deriveCurrentDistribution`, the event-folding algorithm, or any report/export builder — CLAUDE.md's "characterize before changing" rule does not add new requirements here, but every existing test in a touched file must stay green (or be updated with a clear reason, never silently deleted).
- `visitedSubTabs`-style mount preservation in this plan never adds LRU eviction — every sub-tab set touched here (2, 4, and 2 items) is small and fixed, unlike `App.tsx`'s top-level tab set. Do not port `touchTabMountLru`'s eviction behavior into this plan's new `touchVisitedTabs` helper.

---

### Task 1: §S — Fix the double permission prompt at its root

**Files:**
- Modify: `src/data/workspace/WorkspaceProvider.tsx:176-179` (inside `reconnectWorkspace`), `src/data/workspace/WorkspaceProvider.tsx:209` (inside `selectWorkspace`)
- Test: `src/data/workspace/WorkspaceProvider.test.tsx`

**Interfaces:**
- Consumes: `ensureDirectoryPermission(handle, mode)` and `selectWorkspaceDirectory(mode)` from `src/data/storage/fileSystemAccess.ts` — both already support `"readwrite"`, unchanged by this task.
- Produces: nothing new — this task only changes which permission `mode` string two existing call sites pass.

- [ ] **Step 1: Update the existing reconnect-permission test to expect `"readwrite"`**

In `src/data/workspace/WorkspaceProvider.test.tsx`, find this test (inside the `describe("remembered workspace fallback", ...)` block):

```tsx
  it("shows a reconnect button and requests read access from its click", async () => {
    const handle = createMemoryDirectory("remembered-workspace");
    mocks.loadLastWorkspace.mockResolvedValue({
      directoryHandle: handle,
      directoryName: handle.name,
      savedAt: new Date().toISOString(),
    });
    mocks.queryDirectoryPermission.mockResolvedValue("prompt");

    render(
      <WorkspaceProvider>
        <WorkspacePicker><div>connected</div></WorkspacePicker>
      </WorkspaceProvider>,
    );

    const reconnect = await screen.findByRole("button", {
      name: DEFAULT_LABELS.wsgate_reconnect_btn,
    });
    fireEvent.click(reconnect);

    await waitFor(() => {
      expect(mocks.ensureDirectoryPermission).toHaveBeenCalledWith(handle, "read");
    });
  });
});
```

Replace it with:

```tsx
  it("shows a reconnect button and requests readwrite access from its click (§S: one grant, not two)", async () => {
    const handle = createMemoryDirectory("remembered-workspace");
    mocks.loadLastWorkspace.mockResolvedValue({
      directoryHandle: handle,
      directoryName: handle.name,
      savedAt: new Date().toISOString(),
    });
    mocks.queryDirectoryPermission.mockResolvedValue("prompt");

    render(
      <WorkspaceProvider>
        <WorkspacePicker><div>connected</div></WorkspacePicker>
      </WorkspaceProvider>,
    );

    const reconnect = await screen.findByRole("button", {
      name: DEFAULT_LABELS.wsgate_reconnect_btn,
    });
    fireEvent.click(reconnect);

    await waitFor(() => {
      expect(mocks.ensureDirectoryPermission).toHaveBeenCalledWith(handle, "readwrite");
    });
  });

  it("requests readwrite in the same picker interaction when attaching a workspace for the first time (§S)", async () => {
    const handle = createMemoryDirectory("new-workspace");
    mocks.loadLastWorkspace.mockResolvedValue(null);
    mocks.selectWorkspaceDirectory.mockResolvedValue(handle);
    mocks.checkWorkspaceStructure.mockResolvedValue({
      status: "missing_structure",
      missingItems: ["1-population"],
      invalidItems: [],
      message: "missing",
    });

    render(
      <WorkspaceProvider>
        <SelectWorkspaceButton />
      </WorkspaceProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "select" }));

    await waitFor(() => {
      expect(mocks.selectWorkspaceDirectory).toHaveBeenCalledWith("readwrite");
    });
  });
});
```

Add `selectWorkspaceDirectory: vi.fn()` to the `mocks` object near the top of the file and to the `vi.mock("../storage/fileSystemAccess", ...)` return object, alongside the existing entries:

```ts
const mocks = vi.hoisted(() => ({
  checkWorkspaceStructure: vi.fn(),
  clearLastWorkspace: vi.fn(),
  ensureDirectoryPermission: vi.fn(),
  isFileSystemAccessSupported: vi.fn(),
  loadLastWorkspace: vi.fn(),
  loadWorkspaceFiles: vi.fn(),
  queryDirectoryPermission: vi.fn(),
  selectWorkspaceDirectory: vi.fn(),
}));

vi.mock("../storage/fileSystemAccess", async (importOriginal) => ({
  ...await importOriginal<typeof import("../storage/fileSystemAccess")>(),
  checkWorkspaceStructure: mocks.checkWorkspaceStructure,
  ensureDirectoryPermission: mocks.ensureDirectoryPermission,
  isFileSystemAccessSupported: mocks.isFileSystemAccessSupported,
  loadWorkspaceFiles: mocks.loadWorkspaceFiles,
  queryDirectoryPermission: mocks.queryDirectoryPermission,
  selectWorkspaceDirectory: mocks.selectWorkspaceDirectory,
}));
```

Add a `SelectWorkspaceButton` helper component near the file's other helper components (`ClearWorkspaceButton`, etc.):

```tsx
function SelectWorkspaceButton() {
  const { selectWorkspace } = useWorkspace();
  return (
    <button type="button" onClick={() => { void selectWorkspace(); }}>
      select
    </button>
  );
}
```

- [ ] **Step 2: Run the tests to verify they fail against the current (pre-fix) code**

Run: `npx vitest run src/data/workspace/WorkspaceProvider.test.tsx`
Expected: the renamed reconnect test fails (`ensureDirectoryPermission` was called with `"read"`, not `"readwrite"`); the new attach test fails (`selectWorkspaceDirectory` was called with `"read"`, not `"readwrite"`).

- [ ] **Step 3: Fix the two call sites in `WorkspaceProvider.tsx`**

In `reconnectWorkspace` (around line 176-180):

```tsx
      const hasReadPermission = await ensureDirectoryPermission(
        persisted.directoryHandle,
        "read"
      );
      if (!hasReadPermission) {
```

becomes:

```tsx
      const hasReadWritePermission = await ensureDirectoryPermission(
        persisted.directoryHandle,
        "readwrite"
      );
      if (!hasReadWritePermission) {
```

In `selectWorkspace` (around line 209):

```tsx
      const handle = await selectWorkspaceDirectory("read");
```

becomes:

```tsx
      const handle = await selectWorkspaceDirectory("readwrite");
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/data/workspace/WorkspaceProvider.test.tsx`
Expected: PASS, including every pre-existing test in the file (none of them assert on the permission mode besides the one just updated).

- [ ] **Step 5: Update today's edit log, then commit**

```bash
git add src/data/workspace/WorkspaceProvider.tsx src/data/workspace/WorkspaceProvider.test.tsx "docs/edit logs/2026-08-03.md" package.json
git commit -m "Fix (workspace): request readwrite in one grant at attach/reconnect, closing the double permission prompt (§S)" -- src/data/workspace/WorkspaceProvider.tsx src/data/workspace/WorkspaceProvider.test.tsx "docs/edit logs/2026-08-03.md" package.json
```

---

### Task 2: §V — Parallelize workspace boot's sequential structure checks

**Files:**
- Modify: `src/data/storage/fileSystemAccess.ts:150-249` (`checkWorkspaceStructure`)
- Test: `src/data/storage/fileSystemAccess.test.ts`

**Interfaces:**
- Consumes: `REQUIRED_WORKSPACE_FOLDERS`, `TOP_LEVEL_DATA_FOLDERS`, `SYSTEM_SUBFOLDERS`, `WORKSPACE_FILE_NAMES`, `getSystemRoot`, `getUserDataRoot`, `readJsonFile`, `isJsonEnvelope` — all pre-existing, unchanged.
- Produces: `checkWorkspaceStructure`'s return shape (`WorkspaceStructureCheckResult`) is unchanged; `missingItems`/`invalidItems` array contents and order are byte-identical to today's — only the internal execution becomes concurrent per category.

- [ ] **Step 1: Write the failing tests**

Add to `src/data/storage/fileSystemAccess.test.ts` (this file uses flat `test(...)` calls, not `describe`/`it` — match that style):

```ts
test("checkWorkspaceStructure preserves item order across categories after parallelizing (§V)", async () => {
  const dir = createMemoryDirectory();
  // Present: 1-population, 4-reports, 5-system (with "audit" + "backups" subfolders).
  // Missing: 2-samples, 3-user-data, 6-templates (top folders); "locks" (system
  // subfolder); both required files -- deliberately spread across all three
  // checked categories to prove the concatenated order survives parallelizing.
  await dir.getDirectoryHandle("1-population", { create: true });
  await dir.getDirectoryHandle("4-reports", { create: true });
  const system = await dir.getDirectoryHandle("5-system", { create: true });
  await system.getDirectoryHandle("audit", { create: true });
  await system.getDirectoryHandle("backups", { create: true });

  const result = await checkWorkspaceStructure(dir);

  expect(result.missingItems).toEqual([
    "2-samples",
    "3-user-data",
    "6-templates",
    "5-system/locks",
    "workspace.manifest.json",
    "users.permissions.json",
  ]);
});

test("checkWorkspaceStructure checks top-level folders concurrently, not one at a time (§V)", async () => {
  const inner = createMemoryDirectory();
  let current = 0;
  let peak = 0;
  const tracked = {
    ...inner,
    getDirectoryHandle: async (name: string, options?: { create?: boolean }) => {
      current += 1;
      peak = Math.max(peak, current);
      await new Promise((resolve) => setTimeout(resolve, 5));
      try {
        return await inner.getDirectoryHandle(name, options);
      } finally {
        current -= 1;
      }
    },
  };

  await checkWorkspaceStructure(tracked);

  // 6 top-level folders are checked in the first phase -- if they still ran
  // one at a time, peak would never exceed 1.
  expect(peak).toBeGreaterThan(1);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/data/storage/fileSystemAccess.test.ts`
Expected: the order-preservation test likely still passes (sequential code already produces this order) but the concurrency test FAILS (`peak` stays at 1 against the current sequential `for...of` implementation).

- [ ] **Step 3: Parallelize `checkWorkspaceStructure`**

Replace the body of `checkWorkspaceStructure` in `src/data/storage/fileSystemAccess.ts` (lines 150-249) — everything from `const missingItems: string[] = [];` down to (but not including) the final `if (missingItems.length > 0) { ... }` block — with:

```ts
  const missingItems: string[] = [];
  const invalidItems: string[] = [];

  // Every check below is independent -- none depends on another's result,
  // only on accumulating into missingItems/invalidItems -- so they run
  // concurrently (Promise.allSettled, not Promise.all: one missing folder
  // must not abort the rest of the scan) instead of one network round trip
  // at a time. Results are reassembled in the exact same category order the
  // sequential code produced, so the returned arrays stay byte-identical to
  // before -- only the round trips now overlap (§V).
  const allTopFolders = [
    ...REQUIRED_WORKSPACE_FOLDERS,
    ...TOP_LEVEL_DATA_FOLDERS
  ];
  const topFolderResults = await Promise.allSettled(
    allTopFolders.map((folderName) =>
      directoryHandle.getDirectoryHandle(folderName, { create: false })
    )
  );
  topFolderResults.forEach((result, index) => {
    if (result.status === "rejected") missingItems.push(allTopFolders[index]);
  });

  // If the .system folder itself is missing, it's already recorded above
  // (it's one of allTopFolders) -- this only needs to run when it exists.
  const systemHandle = await directoryHandle
    .getDirectoryHandle(WORKSPACE_FILE_NAMES.systemFolder, { create: false })
    .catch(() => null);

  if (systemHandle) {
    const systemSubfolderResults = await Promise.allSettled(
      SYSTEM_SUBFOLDERS.map((folderName) =>
        systemHandle.getDirectoryHandle(folderName, { create: false })
      )
    );
    systemSubfolderResults.forEach((result, index) => {
      if (result.status === "rejected") {
        missingItems.push(`${WORKSPACE_FILE_NAMES.systemFolder}/${SYSTEM_SUBFOLDERS[index]}`);
      }
    });
  }

  const requiredFileLocations = await Promise.all([
    getSystemRoot(directoryHandle, false)
      .then((dir) => ({ dir, fileName: WORKSPACE_FILE_NAMES.manifest }))
      .catch(() => ({ dir: null as DirectoryHandleLike | null, fileName: WORKSPACE_FILE_NAMES.manifest })),
    getUserDataRoot(directoryHandle, false)
      .then((dir) => ({ dir, fileName: WORKSPACE_FILE_NAMES.usersPermissions }))
      .catch(() => ({ dir: null as DirectoryHandleLike | null, fileName: WORKSPACE_FILE_NAMES.usersPermissions })),
  ]);

  const fileCheckResults = await Promise.all(
    requiredFileLocations.map(async (item) => {
      if (!item.dir) return { fileName: item.fileName, outcome: "missing" as const };
      const result = await readJsonFile<JsonEnvelope<unknown>>(item.dir, item.fileName);
      if (!result.ok) {
        return {
          fileName: item.fileName,
          outcome: result.reason === "missing" ? ("missing" as const) : ("invalid" as const),
        };
      }
      if (!isJsonEnvelope(result.file) || result.file.metadata.schemaVersion !== WORKSPACE_SCHEMA_VERSION) {
        return { fileName: item.fileName, outcome: "invalid" as const };
      }
      return { fileName: item.fileName, outcome: "ok" as const };
    })
  );
  for (const { fileName, outcome } of fileCheckResults) {
    if (outcome === "missing") missingItems.push(fileName);
    else if (outcome === "invalid") invalidItems.push(fileName);
  }
```

This deletes the three sequential `for...of` loops and the inline `requiredFileLocations` array (which itself contained two sequential `await`s) and replaces them with three phases, each internally concurrent, run one after another in the same order as before.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/data/storage/fileSystemAccess.test.ts`
Expected: PASS, including every pre-existing test in the file (`workspace checks require read permission only`, the `.bak` recovery tests, `createWorkspaceStructure creates numbered workspace folders`).

- [ ] **Step 5: Run the full suite, typecheck, and lint**

Run: `npm run test:run && npm run typecheck && npm run lint`
Expected: all green — `checkWorkspaceStructure` is called from `WorkspaceProvider.tsx` (mocked in its own tests, untouched here) and exercised indirectly by any workspace-attach flow test elsewhere in the suite.

- [ ] **Step 6: Update today's edit log, then commit**

```bash
git add src/data/storage/fileSystemAccess.ts src/data/storage/fileSystemAccess.test.ts "docs/edit logs/2026-08-03.md" package.json
git commit -m "Fix (workspace): parallelize checkWorkspaceStructure's sequential existence/read checks (§V)" -- src/data/storage/fileSystemAccess.ts src/data/storage/fileSystemAccess.test.ts "docs/edit logs/2026-08-03.md" package.json
```

---

### Task 3: §U step 1 — Replace the CAS loop's two verify reads with a lightweight log-only stamp

**Files:**
- Modify: `src/data/distribution/distributionStorage.ts`
- Test: `src/data/distribution/distributionStorage.test.ts`

**Interfaces:**
- Consumes: `readCompatibilityLog`, `normalizeCompatibilityLog`, `selectWriteToken`, `openOptionalDirectory`, `getDistributionDir`, `getLegacyDistributionDir` — all already defined above this task's insertion point in the file, unchanged.
- Produces: a new private helper `readDistributionLogStamp(directoryHandle, monthFolderName): Promise<{ revision: number; writeToken: string | undefined }>`, used only within this file (not exported) by the two verify sites inside `appendDistributionEvents`'s CAS loop.

- [ ] **Step 1: Write the failing test**

Add to `src/data/distribution/distributionStorage.test.ts`, near the top of the file (after the existing imports, before the `vi.mock` block described in Task 4 — if Task 4 hasn't run yet, add these two imports to the existing plain import list instead):

```ts
import { createMemoryDirectory, getReadLog } from "../storage/memoryDirectory";
```

Add this test inside the existing `describe("distributionStorage", ...)` block:

```ts
  it("verifies a CAS write with a lightweight log-only read, not a full event-directory listing (§U)", async () => {
    const root = createMemoryDirectory("root", { trackReads: true }) as unknown as DirectoryHandleLike;
    const month = "5-May-2026";
    for (let i = 0; i < 5; i++) {
      await appendDistributionEvent(
        root,
        month,
        buildAssignEvent({ xrayImageId: `seed-${i}`, assignedTo: "alice", eventBy: "admin" })
      );
    }

    const before = getReadLog(root).length;
    await appendDistributionEvent(
      root,
      month,
      buildAssignEvent({ xrayImageId: "final", assignedTo: "bob", eventBy: "admin" })
    );
    const newEntries = getReadLog(root).slice(before);

    // "distribution.events" is the immutable-event directory. Before this
    // task, the CAS loop's two verify reads each fully re-listed and
    // re-read every event file in it. After this task, verifying only reads
    // the compatibility log file (distribution.log.json) -- the event
    // directory itself should not appear in this append's read log at all,
    // since only the one legitimate "existing state" read (not exercised by
    // the verify steps) needs it.
    const eventDirectoryReads = newEntries.filter((path) => path.includes("distribution.events/"));
    expect(eventDirectoryReads.length).toBeLessThanOrEqual(
      // the one legitimate pre-write "existing state" read may still list
      // every seeded event file once
      6
    );
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/data/distribution/distributionStorage.test.ts -t "lightweight log-only read"`
Expected: FAIL — `eventDirectoryReads.length` is well above 6 against the current code, since both verify steps also re-list the full event directory.

- [ ] **Step 3: Add the stamp-only reader and use it in the CAS loop's two verify sites**

In `src/data/distribution/distributionStorage.ts`, add this new function directly after `readProjectedEventIds` (which ends around line 187) and before `loadDistributionCurrentRevision`:

```ts
type DistributionLogStamp = { revision: number; writeToken: string | undefined };

/**
 * Cheap alternative to loadDistributionLog for callers that only need to
 * compare revision/writeToken (both live entirely in the compatibility log
 * files, never in the immutable event directory -- see
 * mergeDistributionLogSources). Skips the full event-directory scan.
 */
async function readDistributionLogStamp(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<DistributionLogStamp> {
  const currentDir = await openOptionalDirectory(() =>
    getDistributionDir(directoryHandle, monthFolderName, false)
  );
  const legacyDir = await openOptionalDirectory(() =>
    getLegacyDistributionDir(directoryHandle, monthFolderName)
  );
  const currentLog = normalizeCompatibilityLog(
    await readCompatibilityLog(currentDir, `Corrupt distribution compatibility log: ${LOG_FILE}`)
  );
  const legacyLog = normalizeCompatibilityLog(
    await readCompatibilityLog(legacyDir, `Corrupt legacy distribution log: ${LOG_FILE}`)
  );
  return {
    revision: Math.max(currentLog.revision, legacyLog.revision),
    writeToken: selectWriteToken(currentLog, legacyLog),
  };
}
```

Then, inside `appendDistributionEvents`'s `casLoop` callback, replace:

```ts
      await safeWriteJson(dir, LOG_FILE, updated);
      const verify = await loadDistributionLog(directoryHandle, monthFolderName);
      if (verify.revision === nextRevision && verify._writeToken === writeToken) {
        return {
          done: true,
          result: { ok: true as const },
          // Delayed re-read guards against a concurrent machine that read the
          // same base revision and clobbered our commit after this read-back.
          verify: async () => {
            options?.onProgress?.({ phase: "verification", completed: events.length, total: events.length });
            const recheck = await loadDistributionLog(directoryHandle, monthFolderName);
            return recheck.revision === nextRevision && recheck._writeToken === writeToken;
          },
        };
      }
      return { done: false };
```

with:

```ts
      await safeWriteJson(dir, LOG_FILE, updated);
      const verify = await readDistributionLogStamp(directoryHandle, monthFolderName);
      if (verify.revision === nextRevision && verify.writeToken === writeToken) {
        return {
          done: true,
          result: { ok: true as const },
          // Delayed re-read guards against a concurrent machine that read the
          // same base revision and clobbered our commit after this read-back.
          verify: async () => {
            options?.onProgress?.({ phase: "verification", completed: events.length, total: events.length });
            const recheck = await readDistributionLogStamp(directoryHandle, monthFolderName);
            return recheck.revision === nextRevision && recheck.writeToken === writeToken;
          },
        };
      }
      return { done: false };
```

(Task 4 changes `result: { ok: true as const }` again to add `log` — leave it as shown here for this task; do not pre-empt Task 4's change.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/data/distribution/distributionStorage.test.ts -t "lightweight log-only read"`
Expected: PASS.

- [ ] **Step 5: Add a parity test — the stamp reader must agree with the full reader**

Add this test to the same `describe` block:

```ts
  it("readDistributionLogStamp agrees with loadDistributionLog's revision/writeToken across fixtures", async () => {
    const root = await makeRoot();
    const month = "5-May-2026";

    // Empty log.
    let full = await loadDistributionLog(root, month);
    expect(full.revision).toBe(0);

    // After one append.
    await appendDistributionEvent(
      root,
      month,
      buildAssignEvent({ xrayImageId: "img-001", assignedTo: "alice", eventBy: "admin" })
    );
    full = await loadDistributionLog(root, month);
    expect(full.revision).toBe(1);

    // After a second append (revision must advance further, and the CAS
    // loop's own verify step -- which now uses the stamp reader -- must
    // still agree, or appendDistributionEvent itself would report failure).
    const second = await appendDistributionEvent(
      root,
      month,
      buildAssignEvent({ xrayImageId: "img-002", assignedTo: "bob", eventBy: "admin" })
    );
    expect(second.ok).toBe(true);
    full = await loadDistributionLog(root, month);
    expect(full.revision).toBe(2);
  });
```

Run: `npx vitest run src/data/distribution/distributionStorage.test.ts`
Expected: PASS — this test mostly re-confirms existing behavior still holds (revision progression, successful appends) after swapping the CAS loop's internal verify mechanism; it would fail loudly if the stamp reader disagreed with the full reader in a way that broke the CAS loop's own success detection.

- [ ] **Step 6: Run the full suite, typecheck, and lint**

Run: `npm run test:run && npm run typecheck && npm run lint`
Expected: all green, including every pre-existing test in `distributionStorage.test.ts`, `distributionEventStore.test.ts`, `approveReferral.test.ts` (which calls `loadDistributionLog`/`appendDistributionEvents` directly — untouched by this task, still using the full reader where it needs to).

- [ ] **Step 7: Update today's edit log, then commit**

```bash
git add src/data/distribution/distributionStorage.ts src/data/distribution/distributionStorage.test.ts "docs/edit logs/2026-08-03.md" package.json
git commit -m "Fix (distribution): replace 2 of 4 redundant full event-directory reads with a lightweight log-only stamp check (§U step 1)" -- src/data/distribution/distributionStorage.ts src/data/distribution/distributionStorage.test.ts "docs/edit logs/2026-08-03.md" package.json
```

---

### Task 4: §U step 2 — Thread the CAS loop's own result back to `refreshDistribution`

**Files:**
- Modify: `src/data/distribution/distributionStorage.ts` (`appendDistributionEvents`, `appendDistributionEvent`)
- Modify: `src/components/Sidebar/Tabs/Population/useDistributionActions.ts` (`refreshDistribution` and its 5 call sites)
- Test: `src/data/distribution/distributionStorage.test.ts`

**Interfaces:**
- Consumes: Task 3's CAS loop (unchanged shape, only the `result:` payload widens).
- Produces: `appendDistributionEvents`/`appendDistributionEvent` now resolve to `{ ok: true; log: DistributionLog } | { ok: false; error: string }` (previously `{ok:true} | {ok:false; error}`). `refreshDistribution(monthFolderName, preloadedLog?: DistributionLog)` — the new second parameter is optional so any future caller that doesn't have one keeps working (just pays the extra read it always did).

- [ ] **Step 1: Write the failing test**

Add to `src/data/distribution/distributionStorage.test.ts`:

```ts
  it("returns the up-to-date log on success, so callers don't need a fresh read (§U step 2)", async () => {
    const root = await makeRoot();
    const month = "5-May-2026";
    const result = await appendDistributionEvent(
      root,
      month,
      buildAssignEvent({ xrayImageId: "img-001", assignedTo: "alice", eventBy: "admin" })
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const freshRead = await loadDistributionLog(root, month);
    expect(result.log.events).toEqual(freshRead.events);
    expect(result.log.revision).toBe(freshRead.revision);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/data/distribution/distributionStorage.test.ts -t "up-to-date log on success"`
Expected: FAIL with a TypeScript error (`Property 'log' does not exist on type '{ ok: true; }'`) — this is a compile-time failure, which satisfies "verify it fails" for a type-level change; `npx tsc --noEmit` on this file would show the same error.

- [ ] **Step 3: Widen `appendDistributionEvents`'s return type and thread the CAS result**

In `src/data/distribution/distributionStorage.ts`, change the function signature and its zero-events early return:

```ts
export async function appendDistributionEvents(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  events: DistributionEvent[],
  options?: AppendDistributionEventsOptions
): Promise<{ ok: true } | { ok: false; error: string }> {
  // Month lock gate — before the CAS loop so a closed month rejects loudly.
  await ensureMonthWritable(directoryHandle, monthFolderName);
  if (events.length === 0) return { ok: true };
```

becomes:

```ts
export async function appendDistributionEvents(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  events: DistributionEvent[],
  options?: AppendDistributionEventsOptions
): Promise<{ ok: true; log: DistributionLog } | { ok: false; error: string }> {
  // Month lock gate — before the CAS loop so a closed month rejects loudly.
  await ensureMonthWritable(directoryHandle, monthFolderName);
  if (events.length === 0) {
    return { ok: true, log: await loadDistributionLog(directoryHandle, monthFolderName) };
  }
```

Then update the CAS loop's success payload and the surrounding `casLoop` type parameter:

```ts
  const result = await casLoop<{ ok: true } | { ok: false; error: string }>(
```

becomes:

```ts
  const result = await casLoop<{ ok: true; log: DistributionLog } | { ok: false; error: string }>(
```

and:

```ts
        return {
          done: true,
          result: { ok: true as const },
```

becomes:

```ts
        return {
          done: true,
          result: { ok: true as const, log: updated },
```

Finally, update `appendDistributionEvent` (the singular wrapper)'s return type annotation:

```ts
export async function appendDistributionEvent(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  event: DistributionEvent
): Promise<{ ok: true } | { ok: false; error: string }> {
  return appendDistributionEvents(directoryHandle, monthFolderName, [event]);
}
```

becomes:

```ts
export async function appendDistributionEvent(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  event: DistributionEvent
): Promise<{ ok: true; log: DistributionLog } | { ok: false; error: string }> {
  return appendDistributionEvents(directoryHandle, monthFolderName, [event]);
}
```

- [ ] **Step 4: Run the test to verify it passes, then find and update the one pinned exact-shape assertion**

Run: `npx vitest run src/data/distribution/distributionStorage.test.ts`
Expected: the new test passes, but `"reports durable progress while appending a bulk event batch"` FAILS — it asserts `expect(result).toEqual({ ok: true });`, which is now a deep-equality mismatch since `result` also has a `log` field.

Find that test (search for `toEqual({ ok: true })` in this file) and change:

```ts
    expect(result).toEqual({ ok: true });
```

to:

```ts
    expect(result.ok).toBe(true);
```

- [ ] **Step 5: Update `refreshDistribution` to accept an optional preloaded log**

In `src/components/Sidebar/Tabs/Population/useDistributionActions.ts`, add `DistributionLog` to the type-only import from `distributionTypes`:

```ts
import type {
  DistributionCurrentData,
  DistributionEvent
} from "../../../../data/distribution/distributionTypes";
```

becomes:

```ts
import type {
  DistributionCurrentData,
  DistributionEvent,
  DistributionLog
} from "../../../../data/distribution/distributionTypes";
```

Then change `refreshDistribution`'s signature and its own log fetch:

```ts
  async function refreshDistribution(monthFolderName: string): Promise<void> {
    if (!directoryHandle) return;
    let sampleRows = sampleDrawResult?.rows ?? [];
    const log = await loadDistributionLog(directoryHandle, monthFolderName);
```

becomes:

```ts
  async function refreshDistribution(
    monthFolderName: string,
    preloadedLog?: DistributionLog
  ): Promise<void> {
    if (!directoryHandle) return;
    let sampleRows = sampleDrawResult?.rows ?? [];
    const log = preloadedLog ?? await loadDistributionLog(directoryHandle, monthFolderName);
```

- [ ] **Step 6: Pass `result.log` at all 5 call sites**

In the same file, each of these 5 occurrences:

```ts
      if (result.ok) {
```
```ts
        await refreshDistribution(monthFolderName);
```

(inside `handleAssign`, `handleReassign`, `handleMarkComplete`, `handleRequestReplacement`, and `handleApplyBulkAssignment` — each already has its own `if (result.ok) { ... }` block calling `refreshDistribution(monthFolderName)` exactly once) — change the `refreshDistribution` call to:

```ts
        await refreshDistribution(monthFolderName, result.log);
```

Leave every other line in each handler untouched — this is a mechanical one-argument addition at 5 call sites, nothing else in the surrounding logic changes.

- [ ] **Step 7: Run the full suite, typecheck, and lint**

Run: `npm run test:run && npm run typecheck && npm run lint`
Expected: all green. `useDistributionActions.ts` has no dedicated test file today (confirmed absent before this task) — its 5 handlers' externally-visible behavior is unchanged (same disk writes, same UI state updates, same order of operations), only the newly-optional `preloadedLog` parameter is new and every real call site now supplies it. `distributionStorage.test.ts`'s full suite (including `approveReferral.test.ts`, which also calls `appendDistributionEvents` and does not destructure `.log`) must stay green.

- [ ] **Step 8: Update today's edit log, then commit**

```bash
git add src/data/distribution/distributionStorage.ts src/data/distribution/distributionStorage.test.ts src/components/Sidebar/Tabs/Population/useDistributionActions.ts "docs/edit logs/2026-08-03.md" package.json
git commit -m "Fix (distribution): thread appendDistributionEvents' own result back to refreshDistribution, removing the 4th redundant log read (§U step 2)" -- src/data/distribution/distributionStorage.ts src/data/distribution/distributionStorage.test.ts src/components/Sidebar/Tabs/Population/useDistributionActions.ts "docs/edit logs/2026-08-03.md" package.json
```

---

### Task 5: §T/§M — Preserve Population Browse's mounted state, plus the shared `touchVisitedTabs` helper

**Files:**
- Create: `src/app/visitedTabs.ts`
- Create: `src/app/visitedTabs.test.ts`
- Modify: `src/components/Sidebar/Tabs/Population/index.tsx`

**Interfaces:**
- Produces: `touchVisitedTabs<T>(current: ReadonlySet<T>, activeId: T): Set<T>` — a small, pure, generic helper (sibling to `tabMountLru.ts`'s `touchTabMountLru`, but monotonic/add-only, no eviction). Exported for reuse by Tasks 6 and 7.
- Consumes (in `Population/index.tsx`): the existing `SubTab` type (`"process" | "browse"`), `activeSubTab`/`canViewBrowse`, unchanged.

- [ ] **Step 1: Write the failing tests for the shared helper**

Create `src/app/visitedTabs.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { touchVisitedTabs } from "./visitedTabs";

describe("touchVisitedTabs", () => {
  it("adds the active id to an empty set", () => {
    const result = touchVisitedTabs(new Set<string>(), "a");
    expect([...result]).toEqual(["a"]);
  });

  it("keeps every previously visited id, adding the new one", () => {
    const result = touchVisitedTabs(new Set(["a", "b"]), "c");
    expect([...result]).toEqual(["a", "b", "c"]);
  });

  it("returns the SAME reference when the id is already visited (no-op)", () => {
    const current = new Set(["a", "b"]);
    const result = touchVisitedTabs(current, "b");
    expect(result).toBe(current);
  });

  it("returns a NEW reference when actually adding", () => {
    const current = new Set(["a"]);
    const result = touchVisitedTabs(current, "b");
    expect(result).not.toBe(current);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/app/visitedTabs.test.ts`
Expected: FAIL — `src/app/visitedTabs.ts` doesn't exist yet.

- [ ] **Step 3: Create the helper**

Create `src/app/visitedTabs.ts`:

```ts
/**
 * Tracks every tab/sub-tab ID that has ever been the active one, so a caller
 * can keep previously-visited content mounted (hidden, not unmounted)
 * instead of reloading it on every switch back.
 *
 * Unlike touchTabMountLru (which bounds a large, dynamic top-level tab set
 * with LRU eviction), this never evicts -- it's for the small, fixed
 * sub-tab sets under a single parent tab, where keeping everything visited
 * mounted has no meaningful memory cost.
 */
export function touchVisitedTabs<T>(current: ReadonlySet<T>, activeId: T): Set<T> {
  if (current.has(activeId)) return current as Set<T>;
  const next = new Set(current);
  next.add(activeId);
  return next;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/app/visitedTabs.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire Population's Browse sub-tab through it**

In `src/components/Sidebar/Tabs/Population/index.tsx`, add the import:

```ts
import { touchVisitedTabs } from "../../../../app/visitedTabs";
```

Add state right after the existing `activeSubTab` declaration (around line 172):

```ts
  const [activeSubTab, setActiveSubTab] = useState<SubTab>("process");
```

becomes:

```ts
  const [activeSubTab, setActiveSubTab] = useState<SubTab>("process");
  // Browse owns its own data-load effect (BrowseDataView) with no
  // "already loaded" guard; keeping it mounted-but-hidden once visited,
  // instead of unmounting on every sub-tab switch, avoids re-loading its
  // full dataset (up to ~400k rows) every time — §M/§T.
  const [visitedSubTabs, setVisitedSubTabs] = useState<Set<SubTab>>(
    () => new Set([activeSubTab])
  );
  useEffect(() => {
    setVisitedSubTabs((prev) => touchVisitedTabs(prev, activeSubTab));
  }, [activeSubTab]);
```

Then, in the render section (around line 1100-1116), replace:

```tsx
      {/* ── Browse sub-tab ── */}
      {activeSubTab === "browse" && (
        canViewBrowse ? (
          <BrowseDataView
            directoryHandle={directoryHandle}
            refreshKey={monthRefreshKey}
            username={sessionRef.current?.username ?? "unknown"}
            config={config}
          />
        ) : (
          <div className="placeholder-phase">
            <h2>غير مصرح</h2>
            <p>لا تملك صلاحية استعراض البيانات.</p>
          </div>
        )
      )}
```

with:

```tsx
      {/* ── Browse sub-tab (mounted once visited, hidden — not unmounted —
          afterward, so switching away and back doesn't re-load the full
          dataset; §M/§T) ── */}
      {visitedSubTabs.has("browse") && canViewBrowse && (
        <div hidden={activeSubTab !== "browse"}>
          <BrowseDataView
            directoryHandle={directoryHandle}
            refreshKey={monthRefreshKey}
            username={sessionRef.current?.username ?? "unknown"}
            config={config}
          />
        </div>
      )}
      {activeSubTab === "browse" && !canViewBrowse && (
        <div className="placeholder-phase">
          <h2>غير مصرح</h2>
          <p>لا تملك صلاحية استعراض البيانات.</p>
        </div>
      )}
```

Note the permission re-check is live on every render (`canViewBrowse`), not frozen at visit time: if permission is revoked mid-session while Browse is mounted, it drops out of the render on the next update (mirrors `touchTabMountLru`'s existing behavior of purging a since-disallowed tab) — this is intentional, not a gap to fix.

- [ ] **Step 6: Run the full suite, typecheck, and lint**

Run: `npm run test:run && npm run typecheck && npm run lint`
Expected: all green. `Population/index.tsx` has no existing render-level test file (confirmed absent) — same precedent as `App.tsx`'s own top-level mount-preservation mechanism, which is validated via `tabMountLru.test.ts`'s pure-function tests rather than a full component-mount test; this task follows the same precedent via Step 1-4's `visitedTabs.test.ts`. Do not add a new full-mount test for `PopulationTab` in this task — its size and dependency surface (workspace, permissions, global month, `useMonthLoad`, wizard capabilities) make a from-scratch render harness disproportionate to this specific fix, and the underlying mechanism is already covered by the pure-function test plus this file's own existing type-checking (a `hidden` prop on a plain `<div>` is not something TypeScript can get wrong silently).

- [ ] **Step 7: Update today's edit log, then commit**

```bash
git add src/app/visitedTabs.ts src/app/visitedTabs.test.ts src/components/Sidebar/Tabs/Population/index.tsx "docs/edit logs/2026-08-03.md" package.json
git commit -m "Fix (population): preserve Browse's mounted state across sub-tab switches instead of reloading up to 400k rows every time (§M/§T)" -- src/app/visitedTabs.ts src/app/visitedTabs.test.ts src/components/Sidebar/Tabs/Population/index.tsx "docs/edit logs/2026-08-03.md" package.json
```

---

### Task 6: §T — Preserve EmployeeWorkspace's 4 sub-tabs' mounted state

**Files:**
- Modify: `src/components/Sidebar/Tabs/EmployeeWorkspace/index.tsx`
- Create: `src/components/Sidebar/Tabs/EmployeeWorkspace/index.test.tsx`

**Interfaces:**
- Consumes: `touchVisitedTabs` from Task 5 (`src/app/visitedTabs.ts`).
- Produces: no new exports — `EmployeeWorkspaceTab`'s external behavior (which view renders for a given `activeSubTab` + permission state) is unchanged; only whether previously-visited views stay mounted-but-hidden changes.

- [ ] **Step 1: Write the failing tests**

Create `src/components/Sidebar/Tabs/EmployeeWorkspace/index.test.tsx`:

```tsx
/* @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { DirectoryHandleLike } from "../../../../data/storage/fileSystemAccess";
import { createMemoryDirectory } from "../../../../data/storage/memoryDirectory";

vi.mock("../../../../auth/usePermissions", () => ({
  usePermissions: () => ({
    can: () => true,
    canAccessTab: () => true,
  }),
}));

const workspaceMock = vi.hoisted(() => ({
  handle: null as DirectoryHandleLike | null,
}));

vi.mock("../../../../data/workspace/useWorkspace", () => ({
  useWorkspace: () => ({ directoryHandle: workspaceMock.handle }),
}));

const mountCounts = vi.hoisted(() => ({
  "xray-referrals": 0,
  "referral-approval": 0,
  "xray-results": 0,
  "inspection-form": 0,
}));

vi.mock("./views/XrayReferrals", () => ({
  default: () => {
    mountCounts["xray-referrals"] += 1;
    return <div data-testid="view-xray-referrals" />;
  },
}));
vi.mock("./views/ReferralApproval", () => ({
  default: () => {
    mountCounts["referral-approval"] += 1;
    return <div data-testid="view-referral-approval" />;
  },
}));
vi.mock("./views/XrayInspectionResults", () => ({
  default: () => {
    mountCounts["xray-results"] += 1;
    return <div data-testid="view-xray-results" />;
  },
}));
vi.mock("../TemplateBuilder", () => ({
  default: () => {
    mountCounts["inspection-form"] += 1;
    return <div data-testid="view-inspection-form" />;
  },
}));

import EmployeeWorkspaceTab from "./index";

function switchTo(subTabId: string) {
  act(() => {
    window.dispatchEvent(new CustomEvent("pop-set-subtab", { detail: { subTabId } }));
  });
}

describe("EmployeeWorkspaceTab sub-tab mount preservation (§T)", () => {
  afterEach(() => {
    cleanup();
    for (const key of Object.keys(mountCounts) as (keyof typeof mountCounts)[]) {
      mountCounts[key] = 0;
    }
  });

  it("keeps a visited sub-tab mounted when switching away and back", () => {
    workspaceMock.handle = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    render(<EmployeeWorkspaceTab />);
    expect(mountCounts["xray-referrals"]).toBe(1);

    switchTo("xray-results");
    expect(mountCounts["xray-results"]).toBe(1);
    expect(mountCounts["xray-referrals"]).toBe(1); // still mounted, not remounted

    switchTo("xray-referrals");
    expect(mountCounts["xray-referrals"]).toBe(1); // switching back does NOT remount it
  });

  it("hides an inactive but visited sub-tab instead of unmounting it", () => {
    workspaceMock.handle = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    render(<EmployeeWorkspaceTab />);
    switchTo("xray-results");

    const referrals = screen.getByTestId("view-xray-referrals").parentElement;
    expect(referrals).toHaveAttribute("hidden");
  });

  it("never mounts a sub-tab the user hasn't visited yet", () => {
    workspaceMock.handle = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    render(<EmployeeWorkspaceTab />);

    expect(mountCounts["referral-approval"]).toBe(0);
    expect(screen.queryByTestId("view-referral-approval")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/Sidebar/Tabs/EmployeeWorkspace/index.test.tsx`
Expected: the "keeps a visited sub-tab mounted" and "hides an inactive but visited sub-tab" tests FAIL against the current early-return implementation (switching remounts, and an inactive-but-visited view isn't in the DOM at all rather than hidden). The "never mounts" test likely already passes.

- [ ] **Step 3: Rewrite `EmployeeWorkspaceTab`**

Replace the body of `src/components/Sidebar/Tabs/EmployeeWorkspace/index.tsx` from `export default function EmployeeWorkspaceTab() {` to the end of the file:

```tsx
export default function EmployeeWorkspaceTab() {
  const { directoryHandle } = useWorkspace();
  const { can, canAccessTab } = usePermissions();
  const [activeSubTab, setActiveSubTab] = useState<WorkspaceSubTab>(SUB_TAB_XRAY_REFERRALS);
  // Once a sub-tab has been the active tab, keep it mounted (hidden, not
  // unmounted) so switching back doesn't re-trigger its own data load — §T.
  const [visitedSubTabs, setVisitedSubTabs] = useState<Set<WorkspaceSubTab>>(
    () => new Set([activeSubTab])
  );

  // Keep sidebar in sync whenever the active subtab changes
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("pop-subtab-changed", { detail: activeSubTab }));
  }, [activeSubTab]);

  // Listen for sub-tab selection events dispatched by Sidebar
  useEffect(() => {
    function handler(e: CustomEvent<{ subTabId: string }>) {
      const { subTabId } = e.detail;
      if (KNOWN_SUB_TABS.has(subTabId)) {
        setActiveSubTab(subTabId as WorkspaceSubTab);
      }
    }
    window.addEventListener("pop-set-subtab", handler as EventListener);
    return () => window.removeEventListener("pop-set-subtab", handler as EventListener);
  }, []);

  useEffect(() => {
    setVisitedSubTabs((prev) => touchVisitedTabs(prev, activeSubTab));
  }, [activeSubTab]);

  if (!directoryHandle) {
    return (
      <section className="ew-page">
        <p className="ew-empty">يجب تحديد مساحة عمل أولاً.</p>
      </section>
    );
  }

  const canViewXrayReferrals =
    canAccessTab("ew/xray-referrals") &&
    (can("submit-answers") ||
      can("submit-referrals") ||
      can("request-replacement") ||
      can("view-all-entries"));
  const canViewReferralApproval =
    canAccessTab("ew/referral-approval") &&
    (can("approve-referrals") || can("approve-replacements") || can("ew.reopenAnswer"));
  const canViewXrayResults = canAccessTab("ew/xray-results");
  const canViewInspectionForm = canAccessTab("ew/inspection-form");

  const activeAllowed =
    (activeSubTab === SUB_TAB_XRAY_REFERRALS && canViewXrayReferrals) ||
    (activeSubTab === SUB_TAB_REFERRAL_APPROVAL && canViewReferralApproval) ||
    (activeSubTab === SUB_TAB_XRAY_RESULTS && canViewXrayResults) ||
    (activeSubTab === SUB_TAB_INSPECTION_FORM && canViewInspectionForm);

  return (
    <>
      {visitedSubTabs.has(SUB_TAB_XRAY_REFERRALS) && canViewXrayReferrals && (
        <div hidden={activeSubTab !== SUB_TAB_XRAY_REFERRALS}>
          <XrayReferrals directoryHandle={directoryHandle} />
        </div>
      )}
      {visitedSubTabs.has(SUB_TAB_REFERRAL_APPROVAL) && canViewReferralApproval && (
        <div hidden={activeSubTab !== SUB_TAB_REFERRAL_APPROVAL}>
          <ReferralApproval directoryHandle={directoryHandle} />
        </div>
      )}
      {visitedSubTabs.has(SUB_TAB_XRAY_RESULTS) && canViewXrayResults && (
        <div hidden={activeSubTab !== SUB_TAB_XRAY_RESULTS}>
          <XrayInspectionResults directoryHandle={directoryHandle} />
        </div>
      )}
      {visitedSubTabs.has(SUB_TAB_INSPECTION_FORM) && canViewInspectionForm && (
        <div hidden={activeSubTab !== SUB_TAB_INSPECTION_FORM}>
          <TemplateBuilderTab />
        </div>
      )}
      {!activeAllowed && <AccessDenied />}
    </>
  );
}
```

Add the import at the top of the file:

```ts
import { touchVisitedTabs } from "../../../../app/visitedTabs";
```

(The original code's final fallback — `return <XrayReferrals directoryHandle={directoryHandle} />;` when `activeSubTab` matched none of the four known values — is unreachable given `WorkspaceSubTab`'s exhaustive union type and the `KNOWN_SUB_TABS.has(...)` guard on every `setActiveSubTab` call; `activeAllowed` correctly evaluates to `false` in that theoretical case, rendering `AccessDenied` — a safer default than silently defaulting to a specific view.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/Sidebar/Tabs/EmployeeWorkspace/index.test.tsx`
Expected: PASS.

- [ ] **Step 5: Run the full suite, typecheck, and lint**

Run: `npm run test:run && npm run typecheck && npm run lint`
Expected: all green.

- [ ] **Step 6: Update today's edit log, then commit**

```bash
git add src/components/Sidebar/Tabs/EmployeeWorkspace/index.tsx src/components/Sidebar/Tabs/EmployeeWorkspace/index.test.tsx "docs/edit logs/2026-08-03.md" package.json
git commit -m "Fix (employee-workspace): preserve all 4 sub-tabs' mounted state across switches instead of reloading each one (§T)" -- src/components/Sidebar/Tabs/EmployeeWorkspace/index.tsx src/components/Sidebar/Tabs/EmployeeWorkspace/index.test.tsx "docs/edit logs/2026-08-03.md" package.json
```

---

### Task 7: §T — Preserve Reports' `reports`/`kpi` ↔ `report-designer` mounted state

**Files:**
- Modify: `src/components/Sidebar/Tabs/Reports/index.tsx` (the `ReportsTab` wrapper only — do not touch `ReportsContent`'s internals, including its `section`/`kpi`-model effect)
- Modify: `src/components/Sidebar/Tabs/Reports/index.test.tsx`

**Interfaces:**
- Consumes: `touchVisitedTabs` is NOT needed here — only two states exist (`report-designer` visited or not), a single boolean is simpler and just as correct.
- Produces: no new exports — `ReportsTab`'s externally visible behavior (which top-level view renders) is unchanged; only whether `ReportDesignerTab` stays mounted-but-hidden after its first visit changes. `ReportsContent` now always mounts immediately (matching its status as the actual default/initial state) instead of unmounting whenever `report-designer` is active.

- [ ] **Step 1: Read the full existing test file first**

Read `src/components/Sidebar/Tabs/Reports/index.test.tsx` in full before making any change — it's ~551 lines with extensive existing `vi.mock` setup (permissions, auth session, deck export, Power BI export, global month) that every new test in this task must coexist with. Confirm the existing `import ReportsTab from "./index";` (around line 160) and the describe-block structure before adding to it.

- [ ] **Step 2: Write the failing tests**

Add near the top of the file, grouped with the other `vi.mock` calls (before the `import ReportsTab from "./index";` line, since `vi.mock` calls are hoisted but conventionally grouped together):

```ts
const reportDesignerMountCount = vi.hoisted(() => ({ count: 0 }));

vi.mock("../ReportDesigner", () => ({
  default: () => {
    reportDesignerMountCount.count += 1;
    return <div data-testid="report-designer-stub" />;
  },
}));
```

Add this new `describe` block at the end of the file:

```tsx
describe("Reports sub-tab mount preservation (§T)", () => {
  afterEach(cleanup);

  it("keeps Report Designer mounted (hidden, not unmounted) after the first visit", async () => {
    reportDesignerMountCount.count = 0;
    render(<ReportsTab />);

    act(() => {
      window.dispatchEvent(
        new CustomEvent("sidebar-subtab-changed", {
          detail: { parentTabId: "reports", subTabId: "report-designer" },
        })
      );
    });
    expect(await screen.findByTestId("report-designer-stub")).toBeInTheDocument();
    expect(reportDesignerMountCount.count).toBe(1);

    act(() => {
      window.dispatchEvent(
        new CustomEvent("sidebar-subtab-changed", {
          detail: { parentTabId: "reports", subTabId: "reports" },
        })
      );
    });
    const stub = screen.getByTestId("report-designer-stub");
    expect(stub.parentElement).toHaveAttribute("hidden");

    act(() => {
      window.dispatchEvent(
        new CustomEvent("sidebar-subtab-changed", {
          detail: { parentTabId: "reports", subTabId: "report-designer" },
        })
      );
    });
    // Switching back must NOT remount it.
    expect(reportDesignerMountCount.count).toBe(1);
  });

  it("does not mount Report Designer before it has ever been visited", () => {
    reportDesignerMountCount.count = 0;
    render(<ReportsTab />);
    expect(screen.queryByTestId("report-designer-stub")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/components/Sidebar/Tabs/Reports/index.test.tsx -t "mount preservation"`
Expected: the first test FAILS at the "hidden" assertion (currently `ReportDesignerTab` fully unmounts when switching back to "reports", so `report-designer-stub` isn't in the document at all, not merely hidden).

- [ ] **Step 4: Rewrite the `ReportsTab` wrapper**

In `src/components/Sidebar/Tabs/Reports/index.tsx`, replace:

```tsx
// Wrapper that handles sub-tab routing for "مصمم التقارير" sub-tab.
export default function ReportsTab() {
  const [activeSubTab, setActiveSubTab] = useState("reports");
  const handleSubTabEvent = useCallback((e: Event) => {
    const { parentTabId, subTabId } = (e as CustomEvent<{ parentTabId: string; subTabId: string }>).detail;
    if (parentTabId === "reports") setActiveSubTab(subTabId);
  }, []);
  useEffect(() => {
    window.addEventListener("sidebar-subtab-changed", handleSubTabEvent);
    return () => window.removeEventListener("sidebar-subtab-changed", handleSubTabEvent);
  }, [handleSubTabEvent]);

  if (activeSubTab === "report-designer") {
    return (
      <TabGuard tabId="reports/report-designer">
        <ReportDesignerTab />
      </TabGuard>
    );
  }
  return <ReportsContent />;
}
```

with:

```tsx
// Wrapper that handles sub-tab routing for "مصمم التقارير" sub-tab.
export default function ReportsTab() {
  const [activeSubTab, setActiveSubTab] = useState("reports");
  // Once Report Designer has been opened, keep it mounted (hidden, not
  // unmounted) so switching back to it doesn't lose in-progress canvas
  // edits and doesn't re-trigger ReportsContent's own reload on the way
  // back — §T. ReportsContent itself is the initial/default view, so it's
  // always mounted from the start; only Report Designer needs a visited gate.
  const [visitedReportDesigner, setVisitedReportDesigner] = useState(false);
  const handleSubTabEvent = useCallback((e: Event) => {
    const { parentTabId, subTabId } = (e as CustomEvent<{ parentTabId: string; subTabId: string }>).detail;
    if (parentTabId === "reports") setActiveSubTab(subTabId);
  }, []);
  useEffect(() => {
    window.addEventListener("sidebar-subtab-changed", handleSubTabEvent);
    return () => window.removeEventListener("sidebar-subtab-changed", handleSubTabEvent);
  }, [handleSubTabEvent]);
  useEffect(() => {
    if (activeSubTab === "report-designer") setVisitedReportDesigner(true);
  }, [activeSubTab]);

  return (
    <>
      <div hidden={activeSubTab === "report-designer"}>
        <ReportsContent />
      </div>
      {visitedReportDesigner && (
        <div hidden={activeSubTab !== "report-designer"}>
          <TabGuard tabId="reports/report-designer">
            <ReportDesignerTab />
          </TabGuard>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/components/Sidebar/Tabs/Reports/index.test.tsx`
Expected: PASS, including every pre-existing test in the file — none of them navigate to `"report-designer"`, so `ReportsContent` being unconditionally mounted (instead of conditionally, as it already effectively always was on these tests' `"reports"`-default landing) does not change any existing assertion.

- [ ] **Step 6: Run the full suite, typecheck, and lint**

Run: `npm run test:run && npm run typecheck && npm run lint`
Expected: all green.

- [ ] **Step 7: Update today's edit log, then commit**

```bash
git add src/components/Sidebar/Tabs/Reports/index.tsx src/components/Sidebar/Tabs/Reports/index.test.tsx "docs/edit logs/2026-08-03.md" package.json
git commit -m "Fix (reports): preserve Report Designer's mounted state when switching back from it instead of reloading ReportsContent (§T)" -- src/components/Sidebar/Tabs/Reports/index.tsx src/components/Sidebar/Tabs/Reports/index.test.tsx "docs/edit logs/2026-08-03.md" package.json
```

---

## Testing summary (repo-level gates, every task)

`npm run test:run`, `npm run typecheck`, `npm run lint` after every task. Additionally, once all 7 tasks are complete: `npm run check:complexity`, `npm run check:bundle-size`, `npm run check:release` (per CLAUDE.md's full pre-release gate sequence) before this plan is considered shippable.

## Key files touched

| Task | Files |
|---|---|
| 1 (§S) | `src/data/workspace/WorkspaceProvider.tsx`, `.test.tsx` |
| 2 (§V) | `src/data/storage/fileSystemAccess.ts`, `.test.ts` |
| 3 (§U step 1) | `src/data/distribution/distributionStorage.ts`, `.test.ts` |
| 4 (§U step 2) | `src/data/distribution/distributionStorage.ts`, `.test.ts`, `src/components/Sidebar/Tabs/Population/useDistributionActions.ts` |
| 5 (§M/§T) | `src/app/visitedTabs.ts` (new), `.test.ts` (new), `src/components/Sidebar/Tabs/Population/index.tsx` |
| 6 (§T) | `src/components/Sidebar/Tabs/EmployeeWorkspace/index.tsx`, `.test.tsx` (new) |
| 7 (§T) | `src/components/Sidebar/Tabs/Reports/index.tsx`, `.test.tsx` |
