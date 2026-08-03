# Read-Performance Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the O(n²) report-grouping bug, the workspace-switch data leak, and replace the three independent sequential-no-concurrency directory reads (distribution events, employee answers, supervisor decisions) with one shared, bounded-concurrency primitive — the root cause behind the app's worst-reported performance complaints (slow sample/popup loads, slow employee views, slow approve/deny screen).

**Architecture:** A new module `src/data/storage/directoryScan.ts` provides `listDirectoryEntries` (dedupes three copy-pasted directory-listing shims) and `readJsonDirectory` (bounded-concurrency parallel read, order-preserving, configurable unreadable-file policy). Three existing loaders adopt it without changing their public signatures or error-handling contracts. Two fully independent fixes (the O(n²) grouping bug, the workspace-switch reload guard) ship alongside since they're small, high-value, and unblock nothing else.

**Tech Stack:** TypeScript (strict), Vitest (`node` environment except where noted `jsdom`), `@testing-library/react`, existing `createMemoryDirectory` test helper.

## Global Constraints

- Every task gets a `docs/edit logs/2026-08-03.md` entry (today's date — create the file if absent, never a second file for the same date) per `CLAUDE.md`: version bump (decimal, these are fixes), category `Fix:`, before/after snippets, and `**Lines:** {before} → {after} (net {+/-N}) · {files} files, +{added} / -{removed}` using `npm run count-lines -- --quiet` run before and after each task.
- No new runtime npm dependencies.
- No changes to any public function signature already consumed outside this plan's files (verified per-task below).
- Deterministic-by-design code (distribution event folding, report grouping) must be characterized with a test **before** its implementation changes, per `CLAUDE.md`.
- All new/changed TypeScript must pass `npm run typecheck` and `npm run lint` (`--max-warnings 0`) before commit.

---

### Task 1: Fix O(n²) `groupRows` in executive KPI profiles

**Files:**
- Modify: `src/data/reporting/executiveKpiProfiles.ts:10-20`
- Test: `src/data/reporting/executiveKpiProfiles.test.ts` (new file — none exists today)

**Interfaces:**
- Consumes: nothing new.
- Produces: `groupRows` stays module-private (not exported) — only `buildPortProfiles`/`buildStageProfiles` (already exported, signatures unchanged) are asserted against.

- [ ] **Step 1: Write the failing characterization test**

This pins current behavior (including tie-order under the existing buggy implementation) before touching it, per `CLAUDE.md`'s determinism rule.

```ts
// src/data/reporting/executiveKpiProfiles.test.ts
import { describe, expect, it } from "vitest";
import { buildPortProfiles, buildStageProfiles } from "./executiveKpiProfiles";
import { DEFAULT_EXEC_CONFIG } from "./executiveReportTypes";
import type { ExecutiveReportRow } from "./executiveReportTypes";

function row(overrides: Partial<ExecutiveReportRow>): ExecutiveReportRow {
  return {
    xrayImageId: "id",
    portCode: null,
    portName: "ميناء أ",
    portType: null,
    movementType: null,
    stage: "المرحلة الأولى",
    levelOneEmployeeId: null,
    levelTwoEmployeeId: null,
    levelOneResult: "سليمة",
    levelTwoResult: "سليمة",
    imageResult: "سليمة",
    selectedInSample: false,
    assignedTo: null,
    distributionStatus: null,
    expertResult: null,
    imageAvailable: null,
    noImageReason: null,
    hasMarking: null,
    imageQuality: null,
    lowQualityReason: null,
    suspicionLevel: null,
    suspectedTypes: null,
    smuggleMethod: null,
    answerStatus: null,
    assignedAt: null,
    submittedAt: null,
    imageResultAccurate: null,
    levelOneAccurate: null,
    levelTwoAccurate: null,
    verificationCategory: null,
    otherResults: {
      manual: { result: null, employeeId: null },
      opposite: { result: null, employeeId: null },
      liveMeans: { result: null, employeeId: null },
    },
    notes: null,
    ...overrides,
  };
}

describe("buildPortProfiles", () => {
  it("groups rows by port, preserving row order within each port group", () => {
    const rows: ExecutiveReportRow[] = [
      row({ xrayImageId: "1", portName: "الرياض" }),
      row({ xrayImageId: "2", portName: "جدة" }),
      row({ xrayImageId: "3", portName: "الرياض" }),
      row({ xrayImageId: "4", portName: "جدة" }),
      row({ xrayImageId: "5", portName: "الرياض" }),
    ];
    const profiles = buildPortProfiles(rows, DEFAULT_EXEC_CONFIG);
    expect(profiles.map((p) => p.portName).sort()).toEqual(["الرياض", "جدة"].sort());
    const riyadh = profiles.find((p) => p.portName === "الرياض")!;
    expect(riyadh.population).toBe(3);
  });

  it("falls back to 'غير محدد' for a null port name", () => {
    const rows = [row({ xrayImageId: "1", portName: null })];
    const profiles = buildPortProfiles(rows, DEFAULT_EXEC_CONFIG);
    expect(profiles).toHaveLength(1);
    expect(profiles[0]!.portName).toBe("غير محدد");
  });

  it("keeps first-seen group order stable when two ports tie on population", () => {
    // Both ports have exactly 2 rows -- the stable sort in buildPortProfiles must
    // preserve first-seen (insertion) order on a tie, both before and after the fix.
    const rows: ExecutiveReportRow[] = [
      row({ xrayImageId: "1", portName: "ب-ميناء" }),
      row({ xrayImageId: "2", portName: "أ-ميناء" }),
      row({ xrayImageId: "3", portName: "ب-ميناء" }),
      row({ xrayImageId: "4", portName: "أ-ميناء" }),
    ];
    const profiles = buildPortProfiles(rows, DEFAULT_EXEC_CONFIG);
    expect(profiles.map((p) => p.portName)).toEqual(["ب-ميناء", "أ-ميناء"]);
  });
});

describe("buildStageProfiles (fallback branch, no sample.stageAllocations)", () => {
  it("groups by stage in first-seen order with numeric stageKey", () => {
    const rows: ExecutiveReportRow[] = [
      row({ xrayImageId: "1", stage: "المرحلة الثانية" }),
      row({ xrayImageId: "2", stage: "المرحلة الأولى" }),
      row({ xrayImageId: "3", stage: "المرحلة الثانية" }),
    ];
    const profiles = buildStageProfiles(rows, null);
    expect(profiles.map((p) => p.stageLabel)).toEqual(["المرحلة الثانية", "المرحلة الأولى"]);
    expect(profiles.map((p) => p.stageKey)).toEqual(["0", "1"]);
    expect(profiles[0]!.population).toBe(2);
  });

  it("falls back to 'غير محدد' for a null stage", () => {
    const rows = [row({ xrayImageId: "1", stage: null })];
    const profiles = buildStageProfiles(rows, null);
    expect(profiles[0]!.stageLabel).toBe("غير محدد");
  });
});
```

- [ ] **Step 2: Run test to verify it passes against the CURRENT (buggy) implementation**

Run: `npx vitest run src/data/reporting/executiveKpiProfiles.test.ts`
Expected: PASS (this characterizes existing behavior — it is not a regression test yet, it's a safety net for the next step).

- [ ] **Step 3: Fix the O(n²) implementation**

```ts
// src/data/reporting/executiveKpiProfiles.ts:10-20 — replace the function body
function groupRows(
  rows: ExecutiveReportRow[],
  keyFor: (row: ExecutiveReportRow) => string,
): Map<string, ExecutiveReportRow[]> {
  const groups = new Map<string, ExecutiveReportRow[]>();
  for (const row of rows) {
    const key = keyFor(row);
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(row);
    } else {
      groups.set(key, [row]);
    }
  }
  return groups;
}
```

- [ ] **Step 4: Run the same test again to confirm byte-identical behavior**

Run: `npx vitest run src/data/reporting/executiveKpiProfiles.test.ts`
Expected: PASS, identical to Step 2 — zero assertions changed. This proves the fix is behavior-preserving.

- [ ] **Step 5: Run the full report snapshot suite to confirm no downstream drift**

Run: `npx vitest run src/data/reporting`
Expected: PASS, zero snapshot diffs (`src/data/reporting/__snapshots__/*.snap`, `executive/deck2/__snapshots__/deck2.test.ts.snap`, `management/__snapshots__/managementDeck.test.ts.snap`). Any diff means the fix is not behavior-preserving — stop and investigate before continuing.

- [ ] **Step 6: Edit log + commit**

Run `npm run count-lines -- --quiet` before staging (record the "before" number if not already captured at task start), then add today's entry to `docs/edit logs/2026-08-03.md` following the format in `CLAUDE.md` (`Fix:` category, before/after snippet from Step 3, `**Lines:**` stat).

```bash
git add src/data/reporting/executiveKpiProfiles.ts src/data/reporting/executiveKpiProfiles.test.ts "docs/edit logs/2026-08-03.md"
git commit -m "fix(reporting): replace O(n^2) spread-copy grouping with push in groupRows"
```

---

### Task 2: Fix the workspace-switch data leak

**Files:**
- Modify: `src/components/Sidebar/Tabs/Population/useMonthLoad.ts:64-127`
- Test: `src/components/Sidebar/Tabs/Population/useMonthLoad.workspaceSwitch.test.tsx` (new file)

**Interfaces:**
- Consumes: `MonthLoadScope` from `src/data/population/populationStorage.ts` (`{population?, summary?, raw?, sample?, distribution?}`, all optional booleans — unchanged), `GlobalMonthSelection` from `src/data/month/globalMonthLogic.ts` (unchanged).
- Produces: `useMonthLoad(params)` — same public signature and return shape (`{ isLoadingMonthData, hasUnsavedSessionWorkRef }`) as today. No caller elsewhere in the codebase needs to change.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/Sidebar/Tabs/Population/useMonthLoad.workspaceSwitch.test.tsx
/* @vitest-environment jsdom */
// Regression test for the workspace-switch data leak: the reload guard
// previously keyed only on month-folder NAME, so connecting to a different
// workspace whose current month folder happens to share a name with the
// previous workspace's would skip reloading, leaving the prior workspace's
// data on screen under the new workspace's identity.

import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, cleanup, waitFor } from "@testing-library/react";
import type { DirectoryHandleLike } from "../../../../data/storage/fileSystemAccess";
import type { GlobalMonthSelection } from "../../../../data/month/globalMonthLogic";
import type { MonthEditData } from "../../../../data/population/populationStorage";

const MONTH_FOLDER = "5-May-2026";

const loadCalls = vi.hoisted(() => ({ list: [] as DirectoryHandleLike[] }));

const emptyMonthEditData: MonthEditData = {
  populationRows: null,
  certScanRows: 0,
  nonCertScanRows: 0,
  riskRawRows: [],
  biRawRows: [],
  processingSummary: null,
  sampleData: null,
  distributionCurrent: null,
  manifest: null,
};

vi.mock("../../../../data/population/populationStorage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../data/population/populationStorage")>();
  return {
    ...actual,
    loadMonthForEditing: vi.fn(async (dir: DirectoryHandleLike) => {
      loadCalls.list.push(dir);
      return emptyMonthEditData;
    }),
  };
});

import { useMonthLoad } from "./useMonthLoad";

function makeDirectoryHandle(name: string): DirectoryHandleLike {
  return {
    kind: "directory",
    name,
    getFileHandle: async () => {
      throw new Error("not used in this test");
    },
    getDirectoryHandle: async () => {
      throw new Error("not used in this test");
    },
  };
}

function existingSelection(): GlobalMonthSelection {
  return { kind: "existing", folderName: MONTH_FOLDER, month: 5, year: 2026 };
}

function renderMonthLoad(directoryHandle: DirectoryHandleLike) {
  return renderHook(
    (props: { directoryHandle: DirectoryHandleLike }) =>
      useMonthLoad({
        directoryHandle: props.directoryHandle,
        globalMonth: existingSelection(),
        registerMonthChangeGuard: () => () => {},
        computeScope: () => ({ summary: true, population: true, raw: false, sample: true, distribution: true }),
        applyLoadedState: () => {},
        resetWizardState: () => {},
        onLoadError: () => {},
      }),
    { initialProps: { directoryHandle } }
  );
}

describe("useMonthLoad — workspace-switch reload", () => {
  afterEach(() => {
    cleanup();
    loadCalls.list = [];
    vi.clearAllMocks();
  });

  it("reloads when the workspace changes even though the month folder name is unchanged", async () => {
    const workspaceA = makeDirectoryHandle("workspace-a");
    const workspaceB = makeDirectoryHandle("workspace-b");

    const { rerender } = renderMonthLoad(workspaceA);
    await waitFor(() => expect(loadCalls.list).toHaveLength(1));
    expect(loadCalls.list[0]).toBe(workspaceA);

    // Same month folder name (MONTH_FOLDER), but a DIFFERENT workspace handle.
    act(() => rerender({ directoryHandle: workspaceB }));

    await waitFor(() => expect(loadCalls.list).toHaveLength(2));
    expect(loadCalls.list[1]).toBe(workspaceB);
  });

  it("does not reload when neither the workspace nor the month folder changed", async () => {
    const workspaceA = makeDirectoryHandle("workspace-a");
    const { rerender } = renderMonthLoad(workspaceA);
    await waitFor(() => expect(loadCalls.list).toHaveLength(1));

    act(() => rerender({ directoryHandle: workspaceA }));
    // Give any accidental async reload a chance to fire before asserting it didn't.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(loadCalls.list).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/Sidebar/Tabs/Population/useMonthLoad.workspaceSwitch.test.tsx`
Expected: FAIL on the first test ("reloads when the workspace changes...") — `loadCalls.list` stays at length 1 after the workspace switch, because today's guard only compares `folderName`.

- [ ] **Step 3: Fix the reload guard to key on workspace identity too**

```ts
// src/components/Sidebar/Tabs/Population/useMonthLoad.ts
// Replace lines 64-65:
//   const loadMonthTokenRef = useRef(0);
//   const loadedFolderRef = useRef<string | null>(null);
// with:
  const loadMonthTokenRef = useRef(0);
  const loadedRef = useRef<{ folderName: string; directoryHandle: DirectoryHandleLike } | null>(null);
```

```ts
// Replace the effect body (lines 97-127) with:
  useEffect(() => {
    if (!directoryHandle || globalMonth.kind === "none") return;
    if (
      loadedRef.current !== null &&
      loadedRef.current.folderName === globalMonth.folderName &&
      loadedRef.current.directoryHandle === directoryHandle
    ) {
      return;
    }
    loadedRef.current = { folderName: globalMonth.folderName, directoryHandle };
    if (globalMonth.kind === "existing") {
      const targetFolder = globalMonth.folderName;
      const targetDirectoryHandle = directoryHandle;
      const token = ++loadMonthTokenRef.current;
      void handleLoadExistingMonth({
        month: globalMonth.month,
        year: globalMonth.year,
        folderName: globalMonth.folderName,
      }, token).catch((error) => {
        // Guarded on the token so a STALE (superseded) rejection can never
        // wipe a newer load's already-committed, successful data.
        if (token !== loadMonthTokenRef.current) return;
        // A rejected load leaves the previous month's data under this month's
        // header. Reset to a clean empty state, surface the failure, and clear
        // the stamp so re-selecting the same month/workspace retries the load.
        logError("population:auto-load-month", error);
        resetForNewMonth();
        onLoadError("تعذر تحميل بيانات الشهر — أعد المحاولة");
        if (
          loadedRef.current !== null &&
          loadedRef.current.folderName === targetFolder &&
          loadedRef.current.directoryHandle === targetDirectoryHandle
        ) {
          loadedRef.current = null;
        }
      });
    } else {
      // Invalidate any in-flight existing-month load so it can never resolve
      // later and commit its stale data over this clean new-month reset.
      ++loadMonthTokenRef.current;
      resetForNewMonth();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleLoadExistingMonth/resetForNewMonth are stable per render cycle; keying on folderName+directoryHandle prevents load loops
  }, [directoryHandle, globalMonth]);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/Sidebar/Tabs/Population/useMonthLoad.workspaceSwitch.test.tsx`
Expected: PASS, both tests.

- [ ] **Step 5: Run the existing race-condition regression suite to confirm nothing broke**

Run: `npx vitest run src/components/Sidebar/Tabs/Population/populationLoadRace.test.tsx`
Expected: PASS unmodified — this suite exercises the same hook's overlapping-load and existing→pending transitions; the docblock on `useMonthLoad.ts` explicitly requires it keep passing.

- [ ] **Step 6: Edit log + commit**

```bash
git add src/components/Sidebar/Tabs/Population/useMonthLoad.ts src/components/Sidebar/Tabs/Population/useMonthLoad.workspaceSwitch.test.tsx "docs/edit logs/2026-08-03.md"
git commit -m "fix(population): key month-load reload guard on workspace identity, not folder name alone"
```

---

### Task 3: Shared directory-read primitive

**Files:**
- Create: `src/data/storage/directoryScan.ts`
- Test: `src/data/storage/directoryScan.test.ts`

**Interfaces:**
- Consumes: `DirectoryHandleLike` from `src/data/storage/fileSystemAccess.ts` (unchanged), `safeReadJson` from `src/data/storage/safeWrite.ts` (unchanged, `SafeReadResult<T> = {ok:true, value:T, ...} | {ok:false, reason:"missing"|"corrupt"}`).
- Produces (used by Tasks 4–6):
  - `export type JsonDirectoryEntryLike = { name: string; kind: "file" | "directory" }`
  - `export const DIRECTORY_READ_CONCURRENCY = 8`
  - `export function listDirectoryEntries(dir: DirectoryHandleLike): Promise<JsonDirectoryEntryLike[]>`
  - `export type ReadJsonDirectoryOptions = { suffix: string; onUnreadable: "throw" | "skip"; unreadableError?: (fileName: string) => string; concurrency?: number }`
  - `export type ReadJsonDirectoryResult<T> = { values: T[]; fileNames: string[]; matchedNames: string[] }`
  - `export function readJsonDirectory<T>(dir: DirectoryHandleLike, options: ReadJsonDirectoryOptions): Promise<ReadJsonDirectoryResult<T>>`

- [ ] **Step 1: Write the failing tests**

```ts
// src/data/storage/directoryScan.test.ts
import { describe, it, expect } from "vitest";
import { createMemoryDirectory } from "./memoryDirectory";
import { safeWriteJson } from "./safeWrite";
import type { DirectoryHandleLike, FileHandleLike } from "./fileSystemAccess";
import { listDirectoryEntries, readJsonDirectory, DIRECTORY_READ_CONCURRENCY } from "./directoryScan";

type Widget = { id: string };

async function writeRawFile(dir: DirectoryHandleLike, name: string, content: string): Promise<void> {
  const handle: FileHandleLike = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable!();
  await writable.write(content);
  await writable.close();
}

describe("listDirectoryEntries", () => {
  it("lists files and subdirectories", async () => {
    const dir = createMemoryDirectory();
    await safeWriteJson<Widget>(dir, "a.json", { id: "a" });
    await dir.getDirectoryHandle("subdir", { create: true });
    const entries = await listDirectoryEntries(dir);
    expect(entries.map((e) => e.name).sort()).toEqual(["a.json", "subdir"]);
    expect(entries.find((e) => e.name === "a.json")?.kind).toBe("file");
    expect(entries.find((e) => e.name === "subdir")?.kind).toBe("directory");
  });

  it("returns an empty array for an empty directory", async () => {
    const dir = createMemoryDirectory();
    expect(await listDirectoryEntries(dir)).toEqual([]);
  });
});

describe("readJsonDirectory", () => {
  it("reads every matching file and returns values in listing order, filtered by suffix", async () => {
    const dir = createMemoryDirectory();
    await safeWriteJson<Widget>(dir, "alice.widget.json", { id: "alice" });
    await safeWriteJson<Widget>(dir, "bob.widget.json", { id: "bob" });
    await safeWriteJson<Widget>(dir, "ignored.other.json", { id: "ignored" });

    const result = await readJsonDirectory<Widget>(dir, { suffix: ".widget.json", onUnreadable: "skip" });
    expect(result.values.map((w) => w.id).sort()).toEqual(["alice", "bob"]);
    expect(result.fileNames.sort()).toEqual(["alice.widget.json", "bob.widget.json"]);
    expect(result.matchedNames.sort()).toEqual(["alice.widget.json", "bob.widget.json"]);
  });

  it("returns fileNames index-aligned with values", async () => {
    const dir = createMemoryDirectory();
    await safeWriteJson<Widget>(dir, "only.widget.json", { id: "only" });
    const result = await readJsonDirectory<Widget>(dir, { suffix: ".widget.json", onUnreadable: "skip" });
    expect(result.values[0]!.id).toBe("only");
    expect(result.fileNames[0]).toBe("only.widget.json");
  });

  it("skips an unreadable (corrupt) file when onUnreadable is 'skip'", async () => {
    const dir = createMemoryDirectory();
    await safeWriteJson<Widget>(dir, "good.widget.json", { id: "good" });
    await writeRawFile(dir, "bad.widget.json", "{not valid json");

    const result = await readJsonDirectory<Widget>(dir, { suffix: ".widget.json", onUnreadable: "skip" });
    expect(result.values.map((w) => w.id)).toEqual(["good"]);
    expect(result.matchedNames.sort()).toEqual(["bad.widget.json", "good.widget.json"]);
  });

  it("throws with the configured message when onUnreadable is 'throw'", async () => {
    const dir = createMemoryDirectory();
    await writeRawFile(dir, "bad.widget.json", "{not valid json");

    await expect(
      readJsonDirectory<Widget>(dir, {
        suffix: ".widget.json",
        onUnreadable: "throw",
        unreadableError: (name) => `Cannot read widget: ${name}`,
      })
    ).rejects.toThrow("Cannot read widget: bad.widget.json");
  });

  it("throws for the LOWEST-index unreadable file when several are corrupt, deterministically", async () => {
    const dir = createMemoryDirectory();
    // Two corrupt files -- repeat the run to catch a race in which failure wins.
    await writeRawFile(dir, "b-bad.widget.json", "{bad2");
    await writeRawFile(dir, "a-bad.widget.json", "{bad1");
    await safeWriteJson<Widget>(dir, "c-good.widget.json", { id: "good" });

    for (let i = 0; i < 20; i++) {
      await expect(
        readJsonDirectory<Widget>(dir, {
          suffix: ".widget.json",
          onUnreadable: "throw",
          unreadableError: (name) => name,
        })
      ).rejects.toThrow("a-bad.widget.json");
    }
  });

  it("defaults to DIRECTORY_READ_CONCURRENCY and never exceeds it", async () => {
    const inner = createMemoryDirectory();
    for (let i = 0; i < 20; i++) {
      await safeWriteJson<Widget>(inner, `w${i}.widget.json`, { id: `w${i}` });
    }
    let current = 0;
    let peak = 0;
    const tracked: DirectoryHandleLike = {
      ...inner,
      getFileHandle: async (name: string, options?: { create?: boolean }) => {
        const handle = await inner.getFileHandle(name, options);
        return {
          ...handle,
          getFile: async () => {
            current += 1;
            peak = Math.max(peak, current);
            await new Promise((resolve) => setTimeout(resolve, 5));
            try {
              return await handle.getFile();
            } finally {
              current -= 1;
            }
          },
        };
      },
    };

    await readJsonDirectory<Widget>(tracked, { suffix: ".widget.json", onUnreadable: "skip" });
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(DIRECTORY_READ_CONCURRENCY);
  });

  it("respects an explicit concurrency override", async () => {
    const inner = createMemoryDirectory();
    for (let i = 0; i < 10; i++) {
      await safeWriteJson<Widget>(inner, `w${i}.widget.json`, { id: `w${i}` });
    }
    let current = 0;
    let peak = 0;
    const tracked: DirectoryHandleLike = {
      ...inner,
      getFileHandle: async (name: string, options?: { create?: boolean }) => {
        const handle = await inner.getFileHandle(name, options);
        return {
          ...handle,
          getFile: async () => {
            current += 1;
            peak = Math.max(peak, current);
            await new Promise((resolve) => setTimeout(resolve, 5));
            try {
              return await handle.getFile();
            } finally {
              current -= 1;
            }
          },
        };
      },
    };

    await readJsonDirectory<Widget>(tracked, { suffix: ".widget.json", onUnreadable: "skip", concurrency: 2 });
    expect(peak).toBeLessThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/data/storage/directoryScan.test.ts`
Expected: FAIL with "Cannot find module './directoryScan'" (the module doesn't exist yet).

- [ ] **Step 3: Implement the module**

```ts
// src/data/storage/directoryScan.ts
import type { DirectoryHandleLike } from "./fileSystemAccess";
import { safeReadJson } from "./safeWrite";

/**
 * Bounded read fan-out for directory scans. The write side
 * (distributionStorage.ts's IMMUTABLE_EVENT_WRITE_CONCURRENCY) uses 4; reads
 * are cheaper per-call than the write side's stage/verify/commit cycle, so a
 * higher default is used here. Single exported constant so it stays a
 * one-line change if a real workspace (e.g. a network-backed folder) measures
 * better with a lower value.
 */
export const DIRECTORY_READ_CONCURRENCY = 8;

export type JsonDirectoryEntryLike = { name: string; kind: "file" | "directory" };

type RawEntry = { kind: "file" | "directory"; name: string };

function rawEntries(dir: DirectoryHandleLike): AsyncIterable<RawEntry> | null {
  const candidate = dir as DirectoryHandleLike & {
    values?: () => AsyncIterable<RawEntry>;
    entries?: () => AsyncIterable<[string, RawEntry]>;
    [Symbol.asyncIterator]?: () => AsyncIterator<RawEntry>;
  };
  if (candidate.values) return candidate.values();
  if (candidate.entries) {
    const entries = candidate.entries();
    return (async function* () {
      for await (const [, entry] of entries) yield entry;
    })();
  }
  if (candidate[Symbol.asyncIterator]) return candidate as AsyncIterable<RawEntry>;
  return null;
}

/**
 * Materialized directory listing (names + kind only -- no file content is
 * read). Materializing before any content read starts is what makes
 * readJsonDirectory's index-assigned result ordering possible; it is not a
 * new cost versus the sequential loops it replaces, which already walk the
 * same listing.
 */
export async function listDirectoryEntries(dir: DirectoryHandleLike): Promise<JsonDirectoryEntryLike[]> {
  const iterable = rawEntries(dir);
  if (!iterable) return [];
  const out: JsonDirectoryEntryLike[] = [];
  for await (const entry of iterable) {
    out.push({ name: entry.name, kind: entry.kind });
  }
  return out;
}

export type ReadJsonDirectoryOptions = {
  suffix: string;
  /** "throw" reproduces a strict "no caller derives a silently incomplete
   *  snapshot" policy; "skip" reproduces a best-effort aggregation policy. */
  onUnreadable: "throw" | "skip";
  /** Required when onUnreadable === "throw". */
  unreadableError?: (fileName: string) => string;
  concurrency?: number;
};

export type ReadJsonDirectoryResult<T> = {
  /** Listing order, unreadable entries removed (or all present when
   *  onUnreadable === "throw", since any failure aborts the whole read). */
  values: T[];
  /** Names of the entries that produced `values`, index-aligned with it. */
  fileNames: string[];
  /** Every matching name in the listing, including ones that failed to read. */
  matchedNames: string[];
};

/**
 * Read every JSON file in `dir` matching `suffix`, with bounded concurrency,
 * preserving directory-listing order in the result regardless of which
 * worker finishes first.
 */
export async function readJsonDirectory<T>(
  dir: DirectoryHandleLike,
  options: ReadJsonDirectoryOptions
): Promise<ReadJsonDirectoryResult<T>> {
  const entries = await listDirectoryEntries(dir);
  const matched = entries.filter((entry) => entry.kind === "file" && entry.name.endsWith(options.suffix));
  const matchedNames = matched.map((entry) => entry.name);

  const slots: (T | undefined)[] = new Array(matched.length);
  const present: boolean[] = new Array(matched.length).fill(false);

  let nextIndex = 0;
  let stop = false;
  let firstFailure: { index: number; name: string } | null = null;

  async function worker(): Promise<void> {
    while (!stop) {
      const index = nextIndex;
      if (index >= matched.length) return;
      nextIndex += 1;
      const entry = matched[index]!;
      const result = await safeReadJson<T>(dir, entry.name);
      if (result.ok) {
        slots[index] = result.value;
        present[index] = true;
        continue;
      }
      if (options.onUnreadable === "skip") continue;
      // "throw" policy: record only the LOWEST index seen so far, so the
      // reported failure is deterministic regardless of which worker/await
      // settles first, then stop starting new work (existing in-flight reads
      // are still awaited via the outer Promise.all).
      if (firstFailure === null || index < firstFailure.index) {
        firstFailure = { index, name: entry.name };
      }
      stop = true;
    }
  }

  const workerCount = Math.min(options.concurrency ?? DIRECTORY_READ_CONCURRENCY, matched.length || 1);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  if (firstFailure) {
    const buildMessage = options.unreadableError ?? ((name: string) => `Cannot read JSON file: ${name}`);
    throw new Error(buildMessage(firstFailure.name));
  }

  const values: T[] = [];
  const fileNames: string[] = [];
  for (let i = 0; i < matched.length; i++) {
    if (present[i]) {
      values.push(slots[i] as T);
      fileNames.push(matched[i]!.name);
    }
  }
  return { values, fileNames, matchedNames };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/data/storage/directoryScan.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: both clean.

- [ ] **Step 6: Edit log + commit**

```bash
git add src/data/storage/directoryScan.ts src/data/storage/directoryScan.test.ts "docs/edit logs/2026-08-03.md"
git commit -m "feat(storage): add shared bounded-concurrency directory-read primitive"
```

---

### Task 4: Adopt the primitive in `loadImmutableDistributionEvents`

**Files:**
- Modify: `src/data/distribution/distributionEventStore.ts:1-24, 81-103`
- Test: `src/data/distribution/distributionEventStore.test.ts` (extend existing file)

**Interfaces:**
- Consumes: `listDirectoryEntries`, `readJsonDirectory` from `src/data/storage/directoryScan.ts` (Task 3).
- Produces: `loadImmutableDistributionEvents(distributionDir: DirectoryHandleLike): Promise<DistributionEvent[]>` — **signature and behavior contract unchanged** (still throws on any unreadable event file, still returns events sorted by `(eventAt, eventId)`). All existing callers (`distributionStorage.ts`, tested via `distributionStorage.test.ts`) need no changes.

- [ ] **Step 1: Write the failing test — concurrent reads produce the same sorted result as before, and still throw on a corrupt event file**

```ts
// Append to src/data/distribution/distributionEventStore.test.ts
import { safeReadJson } from "../storage/safeWrite";

describe("loadImmutableDistributionEvents — concurrency-safe (Task 4)", () => {
  it("reads a large batch of events and returns them sorted, regardless of read concurrency", async () => {
    const root = createMemoryDirectory();
    const dir = await getSampleMainDir(root, "5-May-2026", true);
    const events = Array.from({ length: 25 }, (_, i) =>
      buildAssignEvent({
        xrayImageId: `img-${i}`,
        assignedTo: "alice",
        eventBy: "admin",
      })
    ).map((event, i) => ({ ...event, eventAt: `2026-05-01T${String(10 + (i % 14)).padStart(2, "0")}:00:00.000Z` }));

    for (const event of events) {
      await writeImmutableDistributionEvent(dir, event);
    }

    const loaded = await loadImmutableDistributionEvents(dir);
    expect(loaded).toHaveLength(25);
    const sortedIds = [...events]
      .sort((a, b) => a.eventAt.localeCompare(b.eventAt) || a.eventId.localeCompare(b.eventId))
      .map((e) => e.eventId);
    expect(loaded.map((e) => e.eventId)).toEqual(sortedIds);
  });

  it("still throws when an event file is corrupt", async () => {
    const root = createMemoryDirectory();
    const dir = await getSampleMainDir(root, "5-May-2026", true);
    const eventsDir = await dir.getDirectoryHandle("distribution.events", { create: true });
    const handle = await eventsDir.getFileHandle("00000000-0000-4000-8000-000000000000.json", { create: true });
    const writable = await handle.createWritable!();
    await writable.write("{not valid json");
    await writable.close();

    await expect(loadImmutableDistributionEvents(dir)).rejects.toThrow(/Cannot read immutable distribution event/);
  });
});
```

- [ ] **Step 2: Run tests to verify the new "large batch" test passes already (characterization) and the corrupt-file test passes against current code**

Run: `npx vitest run src/data/distribution/distributionEventStore.test.ts`
Expected: PASS — both new tests pass against the pre-refactor sequential implementation too (this step is verifying the tests are valid characterizations, not yet testing the refactor).

- [ ] **Step 3: Replace the local shim and sequential loop with the shared primitive**

```ts
// src/data/distribution/distributionEventStore.ts
// Replace the import block (lines 1-3) with:
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeReadJson, safeWriteJson } from "../storage/safeWrite";
import { readJsonDirectory } from "../storage/directoryScan";
import type { DistributionEvent } from "./distributionTypes";
```

```ts
// Delete the local `type DirectoryEntryLike` and `function getDirectoryEntries`
// (lines 7-24) entirely -- listDirectoryEntries/readJsonDirectory own this now.
```

```ts
// Replace loadImmutableDistributionEvents (lines 81-103) with:
export async function loadImmutableDistributionEvents(
  distributionDir: DirectoryHandleLike
): Promise<DistributionEvent[]> {
  let eventsDir: DirectoryHandleLike;
  try {
    eventsDir = await distributionDir.getDirectoryHandle(DISTRIBUTION_EVENTS_DIR, { create: false });
  } catch {
    return [];
  }

  const { values } = await readJsonDirectory<DistributionEvent>(eventsDir, {
    suffix: ".json",
    onUnreadable: "throw",
    unreadableError: (name) => `Cannot read immutable distribution event: ${name}`,
  });
  return values.sort((a, b) => a.eventAt.localeCompare(b.eventAt) || a.eventId.localeCompare(b.eventId));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/data/distribution/distributionEventStore.test.ts`
Expected: PASS, all cases (the four pre-existing tests plus the two added in Step 1).

- [ ] **Step 5: Run the full distribution test suite to confirm no downstream drift**

Run: `npx vitest run src/data/distribution`
Expected: PASS — `distributionStorage.test.ts`, `distributionLog.test.ts`, `replacement.test.ts`, `bulkAssignment.test.ts`, `replacementCandidateLookup.test.ts`, `eventSchemaVersion.test.ts` all unmodified and green.

- [ ] **Step 6: Typecheck, lint, edit log, commit**

```bash
npm run typecheck && npm run lint
```

```bash
git add src/data/distribution/distributionEventStore.ts src/data/distribution/distributionEventStore.test.ts "docs/edit logs/2026-08-03.md"
git commit -m "perf(distribution): parallelize immutable event directory read via shared primitive"
```

---

### Task 5: Adopt the primitive in `loadAllEmployeeFiles`

**Files:**
- Modify: `src/data/answers/answerStorage.ts:1-35, 339-358`
- Test: `src/data/answers/answerStorage.test.ts` (extend existing file)

**Interfaces:**
- Consumes: `readJsonDirectory` from `src/data/storage/directoryScan.ts` (Task 3).
- Produces: `loadAllEmployeeFiles(directoryHandle, monthFolderName): Promise<EmployeeAnswerFile[]>` — **signature and behavior contract unchanged**: still returns `[]` on any outer failure (logged via `logError`), still silently skips an individual corrupt file rather than throwing.

- [ ] **Step 1: Write the failing test**

```ts
// Append to src/data/answers/answerStorage.test.ts
describe("loadAllEmployeeFiles — concurrency-safe (Task 5)", () => {
  it("reads all employee answer files under load, in parallel", async () => {
    const root = createMemoryDirectory();
    const month = "5-May-2026";
    for (let i = 0; i < 15; i++) {
      await saveEmployeeAnswers(root, month, `employee${i}`, []);
    }
    const files = await loadAllEmployeeFiles(root, month);
    expect(files).toHaveLength(15);
    expect(files.map((f) => f.username).sort()).toEqual(
      Array.from({ length: 15 }, (_, i) => `employee${i}`).sort()
    );
  });

  it("skips a corrupt employee file instead of throwing", async () => {
    const root = createMemoryDirectory();
    const month = "5-May-2026";
    await saveEmployeeAnswers(root, month, "goodemployee", []);
    const dir = await root.getDirectoryHandle("2-samples", { create: true })
      .then((d) => d.getDirectoryHandle(month, { create: true }))
      .then((d) => d.getDirectoryHandle("1-main", { create: true }))
      .then((d) => d.getDirectoryHandle("employee-answers", { create: true }));
    const handle = await dir.getFileHandle("bademployee.answers.json", { create: true });
    const writable = await handle.createWritable!();
    await writable.write("{not valid json");
    await writable.close();

    const files = await loadAllEmployeeFiles(root, month);
    expect(files.map((f) => f.username)).toEqual(["goodemployee"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails or passes as a characterization**

Run: `npx vitest run src/data/answers/answerStorage.test.ts`
Expected: PASS against the current sequential implementation (characterization) — confirms the test itself is correct before refactoring. **Caution:** the second test's path-building via chained `getDirectoryHandle` calls assumes the numbered-root layout (`2-samples/{month}/1-main/employee-answers`); if `getSampleEmployeeDir`'s exact path differs, adjust the chain to match — the important behavior under test is "one corrupt file among several is skipped," not the exact path construction.

- [ ] **Step 3: Replace the local shim and sequential loop**

```ts
// src/data/answers/answerStorage.ts
// Keep the existing import block (DirectoryHandleLike, safeReadJson/safeWriteJson,
// casLoop, logError, ensureMonthWritable, the answerTypes/referralTypes types,
// workspacePaths helpers) exactly as-is. Add ONE new line, e.g. directly below
// the existing `import { safeReadJson, safeWriteJson } from "../storage/safeWrite";`:
import { readJsonDirectory } from "../storage/directoryScan";
```

```ts
// Delete the local `type DirectoryEntryLike` and `function getDirectoryEntries`
// (lines 17-35) entirely.
```

```ts
// Replace loadAllEmployeeFiles (lines 339-358) with:
export async function loadAllEmployeeFiles(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<EmployeeAnswerFile[]> {
  try {
    const dir = await getAnswersDir(directoryHandle, monthFolderName);
    const { values } = await readJsonDirectory<EmployeeAnswerFile>(dir, {
      suffix: ".answers.json",
      onUnreadable: "skip",
    });
    return values;
  } catch (err) {
    logError("answerStorage:loadAllEmployeeFiles", err instanceof Error ? err : new Error(String(err)));
    return [];
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/data/answers/answerStorage.test.ts`
Expected: PASS, all cases including the pre-existing suite (`reopenAnswer.test.ts`, `answerValueHistory.test.ts`, `employeeXlsx.test.ts` are separate files and unaffected).

- [ ] **Step 5: Run the referral storage suite, which calls `loadAllEmployeeFiles` transitively**

Run: `npx vitest run src/data/referral`
Expected: PASS unmodified.

- [ ] **Step 6: Typecheck, lint, edit log, commit**

```bash
npm run typecheck && npm run lint
```

```bash
git add src/data/answers/answerStorage.ts src/data/answers/answerStorage.test.ts "docs/edit logs/2026-08-03.md"
git commit -m "perf(answers): parallelize employee-answers directory read via shared primitive"
```

---

### Task 6: Adopt the primitive in `loadAllSupervisorDecisions`

**Files:**
- Modify: `src/data/approvals/approvalStorage.ts:1-52, 98-116`
- Test: `src/data/approvals/approvalStorage.test.ts` (extend existing file)

**Interfaces:**
- Consumes: `readJsonDirectory` from `src/data/storage/directoryScan.ts` (Task 3).
- Produces: `loadAllSupervisorDecisions(directoryHandle, monthFolderName): Promise<SupervisorDecisionFile[]>` — **signature and behavior contract unchanged**: still returns `[]` on any outer failure (silently, matching current behavior — no `logError` call exists here today, so none is added), still silently skips an individual corrupt file.

- [ ] **Step 1: Write the failing test**

```ts
// Append to src/data/approvals/approvalStorage.test.ts
describe("loadAllSupervisorDecisions — concurrency-safe (Task 6)", () => {
  it("reads all supervisor decision files under load, in parallel", async () => {
    const root = createMemoryDirectory();
    const month = "5-May-2026";
    for (let i = 0; i < 10; i++) {
      await appendDecisionEvent(root, month, `supervisor${i}`, {
        requestId: `req-${i}`,
        kind: "referral",
        status: "approved",
        reviewedBy: `supervisor${i}`,
        reviewedAt: new Date().toISOString(),
      });
    }
    const files = await loadAllSupervisorDecisions(root, month);
    expect(files).toHaveLength(10);
    expect(files.map((f) => f.supervisorUsername).sort()).toEqual(
      Array.from({ length: 10 }, (_, i) => `supervisor${i}`).sort()
    );
  });

  it("skips a corrupt decision file instead of throwing", async () => {
    const root = createMemoryDirectory();
    const month = "5-May-2026";
    await appendDecisionEvent(root, month, "goodsupervisor", {
      requestId: "req-good",
      kind: "referral",
      status: "approved",
      reviewedBy: "goodsupervisor",
      reviewedAt: new Date().toISOString(),
    });
    const dir = await root.getDirectoryHandle("2-samples", { create: true })
      .then((d) => d.getDirectoryHandle(month, { create: true }))
      .then((d) => d.getDirectoryHandle("1-main", { create: true }))
      .then((d) => d.getDirectoryHandle("approvals", { create: true }));
    const handle = await dir.getFileHandle("badsupervisor.decisions.json", { create: true });
    const writable = await handle.createWritable!();
    await writable.write("{not valid json");
    await writable.close();

    const files = await loadAllSupervisorDecisions(root, month);
    expect(files.map((f) => f.supervisorUsername)).toEqual(["goodsupervisor"]);
  });
});
```

- [ ] **Step 2: Run test to verify it passes as a characterization against current code**

Run: `npx vitest run src/data/approvals/approvalStorage.test.ts`
Expected: PASS. Same path-construction caution as Task 5, Step 2 — adjust the chained `getDirectoryHandle` calls if `getSampleApprovalsDir`'s exact path differs; the behavior under test (skip one corrupt file) is what matters.

- [ ] **Step 3: Replace the local shim and sequential loop**

```ts
// src/data/approvals/approvalStorage.ts
// Add to the import block (near line 1-2):
import { readJsonDirectory } from "../storage/directoryScan";
```

```ts
// Delete the local `type DirectoryEntryLike` and `function getDirectoryEntries`
// (lines 34-52) entirely.
```

```ts
// Replace loadAllSupervisorDecisions (lines 98-116) with:
export async function loadAllSupervisorDecisions(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<SupervisorDecisionFile[]> {
  try {
    const appDir = await getApprovalsDir(directoryHandle, monthFolderName);
    const { values } = await readJsonDirectory<SupervisorDecisionFile>(appDir, {
      suffix: ".decisions.json",
      onUnreadable: "skip",
    });
    return values;
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/data/approvals/approvalStorage.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Run the referral-approval suite, which calls this transitively**

Run: `npx vitest run src/data/referral`
Expected: PASS unmodified — `approveReferral.ts`'s cross-reviewer re-scan guards (`referralStorage.test.ts`, `approveReferral.test.ts`) must still pass exactly as before; this task does not touch dedupe/caching, only parallelizes the read, so no behavior change is expected here.

- [ ] **Step 6: Typecheck, lint, full suite, edit log, commit**

```bash
npm run typecheck && npm run lint && npm run test:run
```

Expected: the complete suite (945+ tests as of this plan's writing) passes.

```bash
git add src/data/approvals/approvalStorage.ts src/data/approvals/approvalStorage.test.ts "docs/edit logs/2026-08-03.md"
git commit -m "perf(approvals): parallelize supervisor-decisions directory read via shared primitive"
```

---

## What this plan deliberately does NOT include (tracked for the next plan)

- The incremental append-only cache for distribution events (design §H Layer 2) — the biggest remaining click-latency win, deferred because it needs the `dataRefreshSignal` invalidation wiring verified and is meaningfully more complex than parallelization alone.
- In-flight call dedupe (§H Layer 3) and its adoption at read-only call sites (Reports, `XrayInspectionResults`, `XrayReferrals`, `useApprovalData`) — needs the critical `approveReferral` competing-decision regression test written first.
- Scope-gating distribution loads and the Replace-button loading spinner (§A items 3 and 5).
- Sections B–G (approval-gate removal, pending/resolved color-coding, processing parallelization, permission-prompt fix, menu-flash fix) — fully independent of this plan's files, will ship as their own plan next.
- Report-model cache, KPI widget rewire, XLSX/CSV yielding, startup/bundle/backup/search/cleanup (§I–§R) — later plans per the design's recommended sequencing.

This plan alone should measurably fix the "slow load" family of complaints (items 1, 2, 7, 8 from the design spec) via parallelization, plus the workspace-switch correctness bug and the O(n²) report bug — all independently verifiable via the tests above, with the redundant-re-read elimination (the design's estimated *largest* win) landing in the next plan.
