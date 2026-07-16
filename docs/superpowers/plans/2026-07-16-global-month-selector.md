# Global Month Selector Implementation Plan [DONE — merged to main]

> **STATUS: ✅ DONE.** All 10 tasks implemented and reviewed (several with fix rounds catching real bugs: a load-token race in the approval queue, a stale-KPI-rows bug, and — in the post-plan final review — a cross-month write window in the Population wizard, closed in a dedicated fix commit). Whole-branch reviewed twice: "Ready to merge: Yes". Merged to `origin/main` @ `69a86b2e` on 2026-07-16. One narrower non-blocking follow-up (an overlapping-load race in `handleLoadExistingMonth` under a rapid double month-switch) remains open — tracked in `.superpowers/sdd/progress.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every per-tab month-selection control with one global month selector in the sticky top toolbar that drives the entire app.

**Architecture:** A new `GlobalMonthProvider` React context (mirroring `WorkspaceProvider`) owns the month list, the current selection (existing folder / pending new month / none), sessionStorage persistence, month-lock state, and a change-guard mechanism. A `GlobalMonthSelector` component in `AdminToolbar` is the only month UI. All tabs consume `useGlobalMonth()` instead of local month state.

**Tech Stack:** React 19 + TypeScript (strict), Vite, Vitest (`node` env default, `jsdom` pragma for component tests), plain CSS per component.

**Spec:** `docs/superpowers/specs/2026-07-16-global-month-selector-design.md`

## Global Constraints

- UI text is Arabic, layout RTL (`dir="rtl"`). New user-facing strings go into `src/data/labels/labelsStore.ts` as label keys; files that already hard-code Arabic locally (Reports month bar, BrowseDataView) may keep that local convention.
- TypeScript strict mode; use `import type` for type-only imports.
- **EDIT_LOG (CLAUDE.md requirement):** all edits belong to entry `## v55 — 2026-07-16 — Global month selector in header replaces all per-tab month filters` at the TOP of `docs/EDIT_LOG.md` (newest-first file). Each task's first step appends its `**File:**` blocks (Before/After exactly as in that task's steps) under that entry BEFORE applying the edits.
- Component/hook tests need `/* @vitest-environment jsdom */` as line 1 and `@testing-library/react`; pure-logic tests run in the default node env.
- sessionStorage key is exactly `xray_global_month_v1`.
- "Latest month" convention = last element of `listMonthFolders()` result (matches all current call sites).
- Do not touch the vendored `xlsx` package or `vite-plugin-singlefile` config.
- Verification gate for every task: `npx vitest run <task tests>`; final task also runs `npm run test:run`, `npm run lint`, `npm run build`.

---

### Task 1: Pure selection logic module

**Files:**
- Create: `src/data/month/globalMonthLogic.ts`
- Test: `src/data/month/globalMonthLogic.test.ts`
- Modify: `docs/EDIT_LOG.md` (create the `## v55` entry at top, above `## v54.1`)

**Interfaces:**
- Consumes: `MonthFolderInfo`, `currentMonthFolderInfo` from `src/data/population/monthFolder.ts`
- Produces (used by Tasks 2–10):
  - `type GlobalMonthSelection = { kind: "existing" | "pending"; folderName: string; month: number; year: number } | { kind: "none" }`
  - `GLOBAL_MONTH_STORAGE_KEY = "xray_global_month_v1"`
  - `latestMonthSelection(months: MonthFolderInfo[]): GlobalMonthSelection`
  - `resolveInitialSelection(months: MonthFolderInfo[], storedFolderName: string | null): GlobalMonthSelection`
  - `reconcileSelection(months: MonthFolderInfo[], current: GlobalMonthSelection): GlobalMonthSelection`

- [x] **Step 1: EDIT_LOG entry**

Insert at the top of `docs/EDIT_LOG.md` (immediately before the `## v54.1` heading):

```markdown
## v55 — 2026-07-16 — Global month selector in header replaces all per-tab month filters

Spec: docs/superpowers/specs/2026-07-16-global-month-selector-design.md.
New GlobalMonthProvider context + toolbar selector; all tabs consume useGlobalMonth().

**File:** `src/data/month/globalMonthLogic.ts` (new)

**Before:** _(file did not exist)_

**After:** selection-resolution logic (latest/stored/pending reconciliation) — see file.
```

- [x] **Step 2: Write the failing test**

Create `src/data/month/globalMonthLogic.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { MonthFolderInfo } from "../population/monthFolder";
import {
  latestMonthSelection,
  reconcileSelection,
  resolveInitialSelection,
} from "./globalMonthLogic";

const m = (month: number, year: number): MonthFolderInfo => ({
  month,
  year,
  folderName: `${month}-${["january","february","march","april","may","june","july","august","september","october","november","december"][month - 1]}-${year}`,
});

const MONTHS = [m(3, 2026), m(4, 2026), m(5, 2026)];

describe("latestMonthSelection", () => {
  it("picks the last folder in the list", () => {
    expect(latestMonthSelection(MONTHS)).toEqual({
      kind: "existing", month: 5, year: 2026, folderName: "5-may-2026",
    });
  });

  it("falls back to a pending current-calendar month when the list is empty", () => {
    const sel = latestMonthSelection([]);
    expect(sel.kind).toBe("pending");
    if (sel.kind === "pending") {
      expect(sel.month).toBe(new Date().getMonth() + 1);
      expect(sel.year).toBe(new Date().getFullYear());
    }
  });
});

describe("resolveInitialSelection", () => {
  it("restores a stored folder that still exists", () => {
    expect(resolveInitialSelection(MONTHS, "4-april-2026")).toEqual({
      kind: "existing", month: 4, year: 2026, folderName: "4-april-2026",
    });
  });

  it("falls back to latest when the stored folder is gone", () => {
    expect(resolveInitialSelection(MONTHS, "1-january-2020").folderName).toBe("5-may-2026");
  });

  it("falls back to latest when nothing is stored", () => {
    expect(resolveInitialSelection(MONTHS, null).folderName).toBe("5-may-2026");
  });
});

describe("reconcileSelection", () => {
  it("keeps an existing selection whose folder still exists", () => {
    const cur = { kind: "existing" as const, month: 4, year: 2026, folderName: "4-april-2026" };
    expect(reconcileSelection(MONTHS, cur)).toBe(cur);
  });

  it("moves to latest when the selected folder disappeared", () => {
    const cur = { kind: "existing" as const, month: 1, year: 2020, folderName: "1-january-2020" };
    expect(reconcileSelection(MONTHS, cur).folderName).toBe("5-may-2026");
  });

  it("promotes a pending month once its folder appears", () => {
    const cur = { kind: "pending" as const, month: 5, year: 2026, folderName: "5-may-2026" };
    expect(reconcileSelection(MONTHS, cur)).toEqual({
      kind: "existing", month: 5, year: 2026, folderName: "5-may-2026",
    });
  });

  it("keeps a pending month whose folder does not exist yet", () => {
    const cur = { kind: "pending" as const, month: 6, year: 2026, folderName: "6-june-2026" };
    expect(reconcileSelection(MONTHS, cur)).toBe(cur);
  });

  it("resolves 'none' to latest", () => {
    expect(reconcileSelection(MONTHS, { kind: "none" }).folderName).toBe("5-may-2026");
  });
});
```

- [x] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/data/month/globalMonthLogic.test.ts`
Expected: FAIL — cannot resolve `./globalMonthLogic`

- [x] **Step 4: Write the implementation**

Create `src/data/month/globalMonthLogic.ts`:

```ts
import {
  currentMonthFolderInfo,
  type MonthFolderInfo,
} from "../population/monthFolder";

/** The single app-wide month selection. `pending` = chosen via "شهر جديد" but no folder on disk yet. */
export type GlobalMonthSelection =
  | { kind: "existing"; folderName: string; month: number; year: number }
  | { kind: "pending"; folderName: string; month: number; year: number }
  | { kind: "none" };

export const GLOBAL_MONTH_STORAGE_KEY = "xray_global_month_v1";

/** Latest existing month, or a pending current-calendar month when the workspace has none. */
export function latestMonthSelection(months: MonthFolderInfo[]): GlobalMonthSelection {
  const last = months[months.length - 1];
  if (!last) {
    const current = currentMonthFolderInfo();
    return { kind: "pending", ...current };
  }
  return { kind: "existing", ...last };
}

export function resolveInitialSelection(
  months: MonthFolderInfo[],
  storedFolderName: string | null
): GlobalMonthSelection {
  if (storedFolderName) {
    const match = months.find((entry) => entry.folderName === storedFolderName);
    if (match) return { kind: "existing", ...match };
  }
  return latestMonthSelection(months);
}

/** Re-validate a selection against a fresh month list (promote pending, drop vanished folders). */
export function reconcileSelection(
  months: MonthFolderInfo[],
  current: GlobalMonthSelection
): GlobalMonthSelection {
  if (current.kind === "pending") {
    const promoted = months.find((entry) => entry.folderName === current.folderName);
    return promoted ? { kind: "existing", ...promoted } : current;
  }
  if (current.kind === "existing") {
    const stillThere = months.some((entry) => entry.folderName === current.folderName);
    return stillThere ? current : latestMonthSelection(months);
  }
  return latestMonthSelection(months);
}
```

- [x] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/data/month/globalMonthLogic.test.ts`
Expected: PASS (9 tests)

- [x] **Step 6: Commit**

```bash
git add src/data/month/globalMonthLogic.ts src/data/month/globalMonthLogic.test.ts docs/EDIT_LOG.md
git commit -m "feat(month): global month selection logic module"
```

---

### Task 2: GlobalMonthProvider context + useGlobalMonth hook

**Files:**
- Create: `src/data/month/GlobalMonthContext.ts`
- Create: `src/data/month/GlobalMonthProvider.tsx`
- Create: `src/data/month/useGlobalMonth.ts`
- Test: `src/data/month/GlobalMonthProvider.test.tsx`
- Modify: `docs/EDIT_LOG.md`

**Interfaces:**
- Consumes: Task 1 exports; `useWorkspace` from `src/data/workspace/useWorkspace.ts`; `WorkspaceContext` from `src/data/workspace/WorkspaceContext.ts` (test wrapper); `listMonthFolders` from `src/data/population/populationStorage.ts`; `isMonthClosed` from `src/data/population/monthLock.ts`; `formatMonthFolderName` from `src/data/population/monthFolder.ts`
- Produces (used by Tasks 3–10):
  - `type MonthChangeGuard = () => string | null` — returns a confirm message when a change needs confirmation, `null` when clean
  - `type GlobalMonthContextValue = { months: MonthFolderInfo[]; selection: GlobalMonthSelection; isSelectedMonthClosed: boolean; setSelectedMonth(folderName: string): void; startNewMonth(month: number, year: number): void; refreshMonths(): Promise<void>; registerMonthChangeGuard(guard: MonthChangeGuard): () => void }`
  - `useGlobalMonth(): GlobalMonthContextValue` (throws outside provider)
  - `GlobalMonthProvider({ children })`

- [x] **Step 1: EDIT_LOG entry** — append three `**File:** (new)` blocks for the context, provider, and hook under `## v55`.

- [x] **Step 2: Write the failing test**

Create `src/data/month/GlobalMonthProvider.test.tsx`:

```tsx
/* @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { WorkspaceContext, emptyLoadedFiles, type WorkspaceContextValue } from "../workspace/WorkspaceContext";
import { GlobalMonthProvider } from "./GlobalMonthProvider";
import { useGlobalMonth } from "./useGlobalMonth";
import { GLOBAL_MONTH_STORAGE_KEY } from "./globalMonthLogic";

async function makeWorkspace(monthFolders: string[]): Promise<DirectoryHandleLike> {
  const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
  const population = await root.getDirectoryHandle("1-population", { create: true });
  for (const name of monthFolders) {
    await population.getDirectoryHandle(name, { create: true });
  }
  return root;
}

function makeWrapper(directoryHandle: DirectoryHandleLike | null) {
  const workspaceValue = {
    status: "ready",
    directoryHandle,
    selectedDirectoryName: "root",
    loadedFiles: emptyLoadedFiles,
    missingItems: [],
    invalidItems: [],
    message: "",
    isSupported: true,
    pendingReconnect: false,
    selectWorkspace: async () => {},
    reconnectWorkspace: async () => {},
    reloadWorkspace: async () => {},
    createInitialStructure: async () => {},
    clearWorkspace: () => {},
    enterDemoWorkspace: async () => {},
  } as WorkspaceContextValue;
  return ({ children }: { children: ReactNode }) => (
    <WorkspaceContext.Provider value={workspaceValue}>
      <GlobalMonthProvider>{children}</GlobalMonthProvider>
    </WorkspaceContext.Provider>
  );
}

afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("GlobalMonthProvider", () => {
  it("defaults to the latest existing month", async () => {
    const root = await makeWorkspace(["4-april-2026", "5-may-2026"]);
    const { result } = renderHook(() => useGlobalMonth(), { wrapper: makeWrapper(root) });
    await waitFor(() => expect(result.current.selection.kind).toBe("existing"));
    expect(result.current.selection).toMatchObject({ folderName: "5-may-2026" });
    expect(result.current.months).toHaveLength(2);
  });

  it("restores a valid sessionStorage selection", async () => {
    sessionStorage.setItem(GLOBAL_MONTH_STORAGE_KEY, "4-april-2026");
    const root = await makeWorkspace(["4-april-2026", "5-may-2026"]);
    const { result } = renderHook(() => useGlobalMonth(), { wrapper: makeWrapper(root) });
    await waitFor(() => expect(result.current.selection.kind).toBe("existing"));
    expect(result.current.selection).toMatchObject({ folderName: "4-april-2026" });
  });

  it("setSelectedMonth switches and persists", async () => {
    const root = await makeWorkspace(["4-april-2026", "5-may-2026"]);
    const { result } = renderHook(() => useGlobalMonth(), { wrapper: makeWrapper(root) });
    await waitFor(() => expect(result.current.months).toHaveLength(2));
    act(() => result.current.setSelectedMonth("4-april-2026"));
    expect(result.current.selection).toMatchObject({ folderName: "4-april-2026" });
    expect(sessionStorage.getItem(GLOBAL_MONTH_STORAGE_KEY)).toBe("4-april-2026");
  });

  it("a guard message + declined confirm blocks the switch", async () => {
    const root = await makeWorkspace(["4-april-2026", "5-may-2026"]);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { result } = renderHook(() => useGlobalMonth(), { wrapper: makeWrapper(root) });
    await waitFor(() => expect(result.current.months).toHaveLength(2));
    let unregister: () => void;
    act(() => { unregister = result.current.registerMonthChangeGuard(() => "unsaved!"); });
    act(() => result.current.setSelectedMonth("4-april-2026"));
    expect(confirmSpy).toHaveBeenCalledWith("unsaved!");
    expect(result.current.selection).toMatchObject({ folderName: "5-may-2026" });
    confirmSpy.mockReturnValue(true);
    act(() => result.current.setSelectedMonth("4-april-2026"));
    expect(result.current.selection).toMatchObject({ folderName: "4-april-2026" });
    act(() => unregister!());
  });

  it("startNewMonth creates a pending selection; refreshMonths promotes it once the folder exists", async () => {
    const root = await makeWorkspace(["5-may-2026"]);
    const { result } = renderHook(() => useGlobalMonth(), { wrapper: makeWrapper(root) });
    await waitFor(() => expect(result.current.months).toHaveLength(1));
    act(() => result.current.startNewMonth(6, 2026));
    expect(result.current.selection).toMatchObject({ kind: "pending", folderName: "6-june-2026" });
    const population = await root.getDirectoryHandle("1-population");
    await population.getDirectoryHandle("6-june-2026", { create: true });
    await act(async () => { await result.current.refreshMonths(); });
    expect(result.current.selection).toMatchObject({ kind: "existing", folderName: "6-june-2026" });
    expect(result.current.months).toHaveLength(2);
  });

  it("selection is none without a workspace", async () => {
    const { result } = renderHook(() => useGlobalMonth(), { wrapper: makeWrapper(null) });
    expect(result.current.selection.kind).toBe("none");
    expect(result.current.months).toHaveLength(0);
  });
});
```

- [x] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/data/month/GlobalMonthProvider.test.tsx`
Expected: FAIL — cannot resolve `./GlobalMonthProvider`

- [x] **Step 4: Write the implementation**

Create `src/data/month/GlobalMonthContext.ts`:

```ts
import { createContext } from "react";

import type { MonthFolderInfo } from "../population/monthFolder";
import type { GlobalMonthSelection } from "./globalMonthLogic";

/** Returns a confirm message when switching months needs user confirmation, or null when clean. */
export type MonthChangeGuard = () => string | null;

export type GlobalMonthContextValue = {
  months: MonthFolderInfo[];
  selection: GlobalMonthSelection;
  /** Month-lock state (Tier-1 Item A) for the current selection. */
  isSelectedMonthClosed: boolean;
  setSelectedMonth: (folderName: string) => void;
  startNewMonth: (month: number, year: number) => void;
  refreshMonths: () => Promise<void>;
  registerMonthChangeGuard: (guard: MonthChangeGuard) => () => void;
};

export const GlobalMonthContext = createContext<GlobalMonthContextValue | null>(null);
```

Create `src/data/month/useGlobalMonth.ts`:

```ts
import { useContext } from "react";

import {
  GlobalMonthContext,
  type GlobalMonthContextValue,
} from "./GlobalMonthContext";

export function useGlobalMonth(): GlobalMonthContextValue {
  const context = useContext(GlobalMonthContext);

  if (!context) {
    throw new Error("useGlobalMonth must be used inside GlobalMonthProvider.");
  }

  return context;
}
```

Create `src/data/month/GlobalMonthProvider.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useWorkspace } from "../workspace/useWorkspace";
import { listMonthFolders } from "../population/populationStorage";
import { isMonthClosed } from "../population/monthLock";
import { formatMonthFolderName, type MonthFolderInfo } from "../population/monthFolder";
import { GlobalMonthContext, type MonthChangeGuard } from "./GlobalMonthContext";
import {
  GLOBAL_MONTH_STORAGE_KEY,
  reconcileSelection,
  resolveInitialSelection,
  type GlobalMonthSelection,
} from "./globalMonthLogic";

function readStoredFolderName(): string | null {
  try {
    return sessionStorage.getItem(GLOBAL_MONTH_STORAGE_KEY);
  } catch {
    return null;
  }
}

function persistSelection(selection: GlobalMonthSelection): void {
  try {
    if (selection.kind === "none") sessionStorage.removeItem(GLOBAL_MONTH_STORAGE_KEY);
    else sessionStorage.setItem(GLOBAL_MONTH_STORAGE_KEY, selection.folderName);
  } catch {
    // sessionStorage unavailable — the selection just won't survive a reload.
  }
}

export function GlobalMonthProvider({ children }: { children: ReactNode }) {
  const { directoryHandle } = useWorkspace();
  const [months, setMonths] = useState<MonthFolderInfo[]>([]);
  const [selection, setSelection] = useState<GlobalMonthSelection>({ kind: "none" });
  const [isSelectedMonthClosed, setIsSelectedMonthClosed] = useState(false);
  const [lockCheckTick, setLockCheckTick] = useState(0);
  const guardsRef = useRef<Set<MonthChangeGuard>>(new Set());
  const monthsRef = useRef<MonthFolderInfo[]>(months);
  monthsRef.current = months;
  const selectionRef = useRef<GlobalMonthSelection>(selection);
  selectionRef.current = selection;

  // (Re)load the month list whenever the workspace handle changes.
  useEffect(() => {
    let cancelled = false;
    if (!directoryHandle) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync reset when the workspace disconnects
      setMonths([]);
      setSelection({ kind: "none" });
      return;
    }
    void listMonthFolders(directoryHandle)
      .then((list) => {
        if (cancelled) return;
        setMonths(list);
        setSelection((prev) => {
          const next = prev.kind === "none"
            ? resolveInitialSelection(list, readStoredFolderName())
            : reconcileSelection(list, prev);
          persistSelection(next);
          return next;
        });
      })
      .catch(() => {
        if (!cancelled) setMonths([]);
      });
    return () => { cancelled = true; };
  }, [directoryHandle]);

  // Month-lock state for the current selection (pending/new months are never closed).
  useEffect(() => {
    let cancelled = false;
    if (!directoryHandle || selection.kind !== "existing") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync clear when preconditions unmet
      setIsSelectedMonthClosed(false);
      return;
    }
    isMonthClosed(directoryHandle, selection.folderName)
      .then((closed) => { if (!cancelled) setIsSelectedMonthClosed(closed); })
      .catch(() => { if (!cancelled) setIsSelectedMonthClosed(false); });
    return () => { cancelled = true; };
  }, [directoryHandle, selection, lockCheckTick]);

  /** Runs every registered guard; the first non-null message triggers window.confirm. */
  const confirmGuardedChange = useCallback((): boolean => {
    for (const guard of guardsRef.current) {
      const message = guard();
      if (message) return window.confirm(message);
    }
    return true;
  }, []);

  const setSelectedMonth = useCallback((folderName: string) => {
    const prev = selectionRef.current;
    if (prev.kind !== "none" && prev.folderName === folderName) return;
    const match = monthsRef.current.find((entry) => entry.folderName === folderName);
    if (!match) return;
    if (!confirmGuardedChange()) return;
    const next: GlobalMonthSelection = { kind: "existing", ...match };
    persistSelection(next);
    setSelection(next);
  }, [confirmGuardedChange]);

  const startNewMonth = useCallback((month: number, year: number) => {
    const folderName = formatMonthFolderName(month, year);
    const prev = selectionRef.current;
    if (prev.kind !== "none" && prev.folderName === folderName) return;
    if (!confirmGuardedChange()) return;
    const match = monthsRef.current.find((entry) => entry.folderName === folderName);
    const next: GlobalMonthSelection = match
      ? { kind: "existing", ...match }
      : { kind: "pending", month, year, folderName };
    persistSelection(next);
    setSelection(next);
  }, [confirmGuardedChange]);

  const refreshMonths = useCallback(async () => {
    if (!directoryHandle) return;
    const list = await listMonthFolders(directoryHandle);
    setMonths(list);
    setSelection((prev) => {
      const next = reconcileSelection(list, prev);
      persistSelection(next);
      return next;
    });
    setLockCheckTick((tick) => tick + 1);
  }, [directoryHandle]);

  const registerMonthChangeGuard = useCallback((guard: MonthChangeGuard) => {
    guardsRef.current.add(guard);
    return () => { guardsRef.current.delete(guard); };
  }, []);

  const value = useMemo(() => ({
    months,
    selection,
    isSelectedMonthClosed,
    setSelectedMonth,
    startNewMonth,
    refreshMonths,
    registerMonthChangeGuard,
  }), [months, selection, isSelectedMonthClosed, setSelectedMonth, startNewMonth, refreshMonths, registerMonthChangeGuard]);

  return (
    <GlobalMonthContext.Provider value={value}>
      {children}
    </GlobalMonthContext.Provider>
  );
}
```

- [x] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/data/month/GlobalMonthProvider.test.tsx src/data/month/globalMonthLogic.test.ts`
Expected: PASS (all)

- [x] **Step 6: Commit**

```bash
git add src/data/month docs/EDIT_LOG.md
git commit -m "feat(month): GlobalMonthProvider context + useGlobalMonth hook"
```

---

### Task 3: Label keys, header selector UI, provider mount

**Files:**
- Modify: `src/data/labels/labelsStore.ts` (add keys after the `label_month` group, ~line 85)
- Create: `src/components/GlobalMonthSelector/GlobalMonthSelector.tsx`
- Create: `src/components/GlobalMonthSelector/GlobalMonthSelector.css`
- Modify: `src/auth/AdminToolbar.tsx` (mount selector between status block and preview panel, ~line 102)
- Modify: `src/App.tsx` (wrap `AuthGate` with `GlobalMonthProvider`, lines 252–266)
- Modify: `src/components/Sidebar/Tabs/Settings/index.tsx` (register new label keys in the list near `label_month`, ~line 145)
- Modify: `docs/EDIT_LOG.md`

**Interfaces:**
- Consumes: `useGlobalMonth`, `usePermissions().can("process-population")`, `useLabels`, `formatMonthFolderShortLabel`
- Produces: `<GlobalMonthSelector allowCreate={boolean} />` rendered in the toolbar; labels `gm_label`, `gm_new_month_btn`, `gm_new_month_title`, `gm_year_label`, `gm_confirm`, `gm_cancel`, `gm_pending_suffix`, `gm_locked_badge`, `gm_no_months`, `gm_all_months`, `gm_month_switch_confirm`

- [x] **Step 1: EDIT_LOG entry** — append `**File:**` blocks for all six files under `## v55`.

- [x] **Step 2: Add label keys**

In `src/data/labels/labelsStore.ts`, directly after the line `label_month:      "الشهر",` add:

```ts
  // Global month selector (top toolbar)
  gm_label:                "الشهر",
  gm_new_month_btn:        "شهر جديد",
  gm_new_month_title:      "بدء شهر جديد",
  gm_year_label:           "السنة",
  gm_confirm:              "اختيار",
  gm_cancel:               "إلغاء",
  gm_pending_suffix:       "(جديد)",
  gm_locked_badge:         "مُقفل",
  gm_no_months:            "لا توجد أشهر",
  gm_all_months:           "كل الأشهر",
  gm_month_switch_confirm: "توجد بيانات غير محفوظة في معالجة المجتمع — تغيير الشهر سيتجاهلها ويحمّل بيانات الشهر المحدد. هل تريد المتابعة؟",
```

In `src/components/Sidebar/Tabs/Settings/index.tsx`, after the entry `{ key: "label_month",            desc: "تسمية حقل الشهر" },` add:

```ts
      { key: "gm_label",               desc: "تسمية الشهر في الشريط العلوي" },
      { key: "gm_new_month_btn",       desc: "زر شهر جديد" },
      { key: "gm_month_switch_confirm", desc: "رسالة تأكيد تغيير الشهر مع بيانات غير محفوظة" },
      { key: "gm_all_months",          desc: "تسمية عرض كل الأشهر" },
```

- [x] **Step 3: Create the selector component**

Create `src/components/GlobalMonthSelector/GlobalMonthSelector.tsx`:

```tsx
import { useState } from "react";
import { CalendarPlus, Lock } from "lucide-react";

import { useGlobalMonth } from "../../data/month/useGlobalMonth";
import { usePermissions } from "../../auth/usePermissions";
import { useLabels } from "../../data/labels/useLabels";
import { formatMonthFolderShortLabel } from "../../data/population/monthFolder";

import "./GlobalMonthSelector.css";

const ARABIC_MONTHS = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
];

type GlobalMonthSelectorProps = {
  /** False in demo mode: the read-only workspace never creates months. */
  allowCreate: boolean;
};

export function GlobalMonthSelector({ allowCreate }: GlobalMonthSelectorProps) {
  const { months, selection, isSelectedMonthClosed, setSelectedMonth, startNewMonth } = useGlobalMonth();
  const { can } = usePermissions();
  const labels = useLabels();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [newMonth, setNewMonth] = useState(() => new Date().getMonth() + 1);
  const [newYear, setNewYear] = useState(() => new Date().getFullYear());

  // No workspace yet — the toolbar has nothing month-related to show.
  if (selection.kind === "none") return null;

  const canCreate = allowCreate && can("process-population");
  const isPending = selection.kind === "pending";

  return (
    <div className="gms-root" dir="rtl">
      <label className="gms-label" htmlFor="global-month-select">{labels.gm_label}</label>
      <select
        id="global-month-select"
        className="gms-select"
        value={selection.folderName}
        onChange={(event) => setSelectedMonth(event.target.value)}
      >
        {isPending && (
          <option value={selection.folderName}>
            {formatMonthFolderShortLabel(selection.folderName)} {labels.gm_pending_suffix}
          </option>
        )}
        {months.length === 0 && !isPending && (
          <option value={selection.folderName}>{labels.gm_no_months}</option>
        )}
        {months.map((entry) => (
          <option key={entry.folderName} value={entry.folderName}>
            {formatMonthFolderShortLabel(entry.folderName)}
          </option>
        ))}
      </select>

      {isSelectedMonthClosed && (
        <span className="gms-locked" title={labels.msg_month_closed_banner}>
          <Lock size={12} aria-hidden /> {labels.gm_locked_badge}
        </span>
      )}

      {canCreate && (
        <div className="gms-new-wrap">
          <button
            type="button"
            className="gms-new-btn"
            onClick={() => setPickerOpen((open) => !open)}
            aria-expanded={pickerOpen}
          >
            <CalendarPlus size={14} aria-hidden /> {labels.gm_new_month_btn}
          </button>
          {pickerOpen && (
            <div className="gms-popover" role="dialog" aria-label={labels.gm_new_month_title}>
              <strong className="gms-popover-title">{labels.gm_new_month_title}</strong>
              <div className="gms-month-grid" role="group">
                {ARABIC_MONTHS.map((name, idx) => (
                  <button
                    key={idx + 1}
                    type="button"
                    className={`gms-month-btn${newMonth === idx + 1 ? " active" : ""}`}
                    onClick={() => setNewMonth(idx + 1)}
                    aria-pressed={newMonth === idx + 1}
                  >
                    {name}
                  </button>
                ))}
              </div>
              <label className="gms-year-label">
                {labels.gm_year_label}
                <input
                  type="number"
                  className="gms-year-input"
                  min={2020}
                  max={2100}
                  value={newYear}
                  onChange={(event) => {
                    const parsed = Number(event.target.value);
                    if (Number.isInteger(parsed)) setNewYear(parsed);
                  }}
                />
              </label>
              <div className="gms-popover-actions">
                <button
                  type="button"
                  className="gms-confirm"
                  onClick={() => { startNewMonth(newMonth, newYear); setPickerOpen(false); }}
                >
                  {labels.gm_confirm}
                </button>
                <button type="button" className="gms-cancel" onClick={() => setPickerOpen(false)}>
                  {labels.gm_cancel}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

Create `src/components/GlobalMonthSelector/GlobalMonthSelector.css`:

```css
.gms-root {
  display: flex;
  align-items: center;
  gap: 8px;
  position: relative;
}

.gms-label {
  font-size: 12px;
  font-weight: 600;
  opacity: 0.75;
}

.gms-select {
  min-width: 120px;
  padding: 4px 8px;
  border: 1px solid rgba(0, 0, 0, 0.18);
  border-radius: 6px;
  background: #fff;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.gms-locked {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 999px;
  background: #fde8e8;
  color: #b42318;
  font-size: 11px;
  font-weight: 700;
}

.gms-new-wrap { position: relative; }

.gms-new-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border: 1px dashed rgba(0, 0, 0, 0.25);
  border-radius: 6px;
  background: transparent;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.gms-new-btn:hover { background: rgba(0, 0, 0, 0.05); }

.gms-popover {
  position: absolute;
  top: calc(100% + 6px);
  inset-inline-start: 0;
  z-index: 60;
  width: 280px;
  padding: 12px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 10px;
  background: #fff;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.16);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.gms-popover-title { font-size: 13px; }

.gms-month-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 5px;
}

.gms-month-btn {
  padding: 5px 2px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 6px;
  background: #fff;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.gms-month-btn.active {
  background: #0f6cbd;
  border-color: #0f6cbd;
  color: #fff;
}

.gms-year-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.gms-year-input {
  width: 90px;
  padding: 4px 8px;
  border: 1px solid rgba(0, 0, 0, 0.18);
  border-radius: 6px;
  font: inherit;
  font-size: 13px;
}

.gms-popover-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-start;
}

.gms-confirm {
  padding: 5px 14px;
  border: none;
  border-radius: 6px;
  background: #0f6cbd;
  color: #fff;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.gms-cancel {
  padding: 5px 14px;
  border: 1px solid rgba(0, 0, 0, 0.15);
  border-radius: 6px;
  background: transparent;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
```

- [x] **Step 4: Mount the provider in App.tsx**

In `src/App.tsx` add the import:

```tsx
import { GlobalMonthProvider } from "./data/month/GlobalMonthProvider";
```

and change the `App` function from:

```tsx
function App() {
  return (
    <WorkspacePicker>
      <AuthGate>
```

to:

```tsx
function App() {
  return (
    <WorkspacePicker>
      <GlobalMonthProvider>
        <AuthGate>
```

closing accordingly (`</AuthGate>` → `</AuthGate>\n      </GlobalMonthProvider>`).

- [x] **Step 5: Render the selector in AdminToolbar**

In `src/auth/AdminToolbar.tsx` add the import:

```tsx
import { GlobalMonthSelector } from "../components/GlobalMonthSelector/GlobalMonthSelector";
```

and between the closing `</div>` of `auth-toolbar-status` (after the workspace chip) and `<div className="auth-toolbar-preview-panel">`, insert:

```tsx
      <GlobalMonthSelector allowCreate={!isDemo} />
```

- [x] **Step 6: Verify manually + typecheck**

Run: `npx tsc -b && npx vitest run src/data/month`
Expected: clean typecheck, month tests PASS.
Then `npm run dev` (via the preview tools when executing interactively) and confirm: selector appears in the toolbar, lists months, "شهر جديد" opens the picker for admin, and switching persists across a reload (sessionStorage).

- [x] **Step 7: Commit**

```bash
git add src/components/GlobalMonthSelector src/auth/AdminToolbar.tsx src/App.tsx src/data/labels/labelsStore.ts "src/components/Sidebar/Tabs/Settings/index.tsx" docs/EDIT_LOG.md
git commit -m "feat(month): global month selector in the top toolbar"
```

---

### Task 4: Reports tab consumes the global month

**Files:**
- Modify: `src/components/Sidebar/Tabs/Reports/index.tsx` (state ~145–172, month bar ~845–861)
- Modify: `docs/EDIT_LOG.md`

**Interfaces:**
- Consumes: `useGlobalMonth` (import path `../../../../data/month/useGlobalMonth`)
- Produces: no API changes; `selectedMonth` inside the component is now derived.

- [x] **Step 1: EDIT_LOG entry** for this file under `## v55`.

- [x] **Step 2: Replace local month state**

Remove:

```tsx
  const [months, setMonths] = useState<Array<{ folderName: string }>>([]);
  const [selectedMonth, setSelectedMonth] = useState("");
```

and the listing effect:

```tsx
    void listMonthFolders(directoryHandle)
      .then((list) => {
        setMonths(list);
        if (list.length > 0) setSelectedMonth(list[list.length - 1]!.folderName);
      })
      .catch(logRejection("reports:listMonthFolders"));
```

(delete the whole `useEffect` that contains it). Add instead, next to the other hooks at the top of the component:

```tsx
  const { selection: globalMonth } = useGlobalMonth();
  // Pending months have no folder on disk yet — treat them as "no data" (empty states).
  const selectedMonth = globalMonth.kind === "existing" ? globalMonth.folderName : "";
```

Add the import `import { useGlobalMonth } from "../../../../data/month/useGlobalMonth";` and remove `listMonthFolders` from the `populationStorage` import (keep the other named imports).

- [x] **Step 3: Replace the month-bar select with a static label**

Replace:

```tsx
        <select
          className="rh-month-select"
          value={selectedMonth}
          onChange={(e) => setSelectedMonth(e.target.value)}
        >
          {months.length === 0 ? (
            <option value="">لا توجد أشهر</option>
          ) : (
            months.map((m) => (
              <option key={m.folderName} value={m.folderName}>
                {formatMonthFolderShortLabel(m.folderName)}
              </option>
            ))
          )}
        </select>
```

with:

```tsx
        <strong className="rh-month-current">
          {globalMonth.kind === "none"
            ? "لا توجد أشهر"
            : formatMonthFolderShortLabel(globalMonth.folderName)}
        </strong>
```

Add to `src/components/Sidebar/Tabs/Reports/Reports.css` (or the CSS file the month bar classes live in — search for `.rh-month-select` and put it beside it):

```css
.rh-month-current {
  font-size: 13px;
  font-weight: 700;
}
```

- [x] **Step 4: Fix any leftover `months` references**

Search the file for remaining `months`/`setMonths`/`setSelectedMonth` references and remove/adjust (the export-disable conditions use `selectedMonth`, which still exists).

Run: `npx tsc -b`
Expected: clean.

- [x] **Step 5: Run tests + commit**

Run: `npm run test:run` (Reports has no dedicated test file; the suite guards regressions)
Expected: PASS.

```bash
git add "src/components/Sidebar/Tabs/Reports" docs/EDIT_LOG.md
git commit -m "refactor(reports): consume global month selection"
```

---

### Task 5: XrayReferrals consumes the global month

**Files:**
- Modify: `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx` (state ~255–256, effect ~300–305, `QueueToolbar` usage ~822–833, `QueueToolbar` definition ~1016–1053)
- Modify: `docs/EDIT_LOG.md`

**Interfaces:**
- Consumes: `useGlobalMonth` (import path `../../../../../data/month/useGlobalMonth`)

- [x] **Step 1: EDIT_LOG entry** for this file under `## v55`.

- [x] **Step 2: Replace local month state**

Remove:

```tsx
  const [months, setMonths]         = useState<Array<{ month: number; year: number; folderName: string }>>([]);
  const [selMonth, setSelMonth]     = useState("");
```

and the listing effect containing:

```tsx
    void listMonthFolders(directoryHandle)
      .then((ms) => {
        setMonths(ms);
        if (ms.length > 0) setSelMonth(ms[ms.length - 1]!.folderName);
      })
      .catch(logRejection("xrayReferrals:listMonthFolders"));
```

Add:

```tsx
  const { selection: globalMonth } = useGlobalMonth();
  const selMonth = globalMonth.kind === "existing" ? globalMonth.folderName : "";
```

Add the `useGlobalMonth` import; remove `listMonthFolders` from the `populationStorage` import (keep `loadMonthPopulationFinal`).

- [x] **Step 3: Strip the month select from QueueToolbar**

In the `QueueToolbar` call site remove the three props:

```tsx
          months={months}
          selectedMonth={selMonth}
          onMonthChange={setSelMonth}
```

In the `QueueToolbar` definition remove `months`, `selectedMonth`, `onMonthChange` from both the destructuring and the prop types, and delete the JSX block:

```tsx
      <label className="ew-label" htmlFor="ref-month">
        {labels.label_month}
        <select
          id="ref-month"
          className="ew-select"
          value={selectedMonth}
          onChange={(e) => onMonthChange(e.target.value)}
        >
          {months.map((m) => (
            <option key={m.folderName} value={m.folderName}>{formatMonthFolderShortLabel(m.folderName)}</option>
          ))}
        </select>
      </label>
```

Remove the now-unused `formatMonthFolderShortLabel` import if nothing else in the file uses it (verify with a file search first).

- [x] **Step 4: Typecheck + tests + commit**

Run: `npx tsc -b && npm run test:run`
Expected: PASS.

```bash
git add "src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx" docs/EDIT_LOG.md
git commit -m "refactor(ew): xray referrals consume global month"
```

---

### Task 6: XrayInspectionResults consumes the global month

**Files:**
- Modify: `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayInspectionResults.tsx` (type ~121–125, state ~147–149, effect ~156–198, selects ~350–395)
- Modify: `docs/EDIT_LOG.md`

**Interfaces:**
- Consumes: `useGlobalMonth` (import path `../../../../../data/month/useGlobalMonth`)

- [x] **Step 1: EDIT_LOG entry** for this file under `## v55`.

- [x] **Step 2: Replace local month state**

Delete the `MonthOption` type (lines 121–125) and replace:

```tsx
  const [months, setMonths] = useState<MonthOption[]>([]);
  const [selectedMonth, setSelectedMonth] = useState("");
```

with:

```tsx
  const { months, selection: globalMonth } = useGlobalMonth();
  const selectedMonth = globalMonth.kind === "existing" ? globalMonth.folderName : "";
```

In the first `useEffect` (lines 156–198) delete ONLY the `listMonthFolders` block:

```tsx
    void listMonthFolders(directoryHandle)
      .then((monthFolders) => {
        setMonths(monthFolders);
        if (monthFolders.length > 0) {
          setSelectedMonth(monthFolders[monthFolders.length - 1]!.folderName);
        } else {
          setRows([]);
          setTemplate(null);
          setLoadState("ready");
        }
      })
      .catch((error) => {
        setLoadState("error");
        logRejection("xrayInspectionResults:listMonthFolders")(error);
      });
```

keeping the browse-preset `Promise.all` in that effect. Then add a new effect directly after it so an empty/pending month never leaves the spinner stuck:

```tsx
  // No selected on-disk month (empty workspace or a pending new month) → empty, ready state.
  useEffect(() => {
    if (!selectedMonth) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync empty-state reset when no month folder is selected
      setRows([]);
      setAuditRows([]);
      setTemplate(null);
      setLoadState("ready");
    }
  }, [selectedMonth]);
```

Add the `useGlobalMonth` import; remove the `listMonthFolders` import (line 35).

- [x] **Step 3: Remove both month selects from the render**

Delete the active-view block:

```tsx
            <label className="ew-label" htmlFor="xray-results-month">
              {L.label_month}
              <select
                id="xray-results-month"
                className="ew-select"
                value={selectedMonth}
                onChange={(event) => setSelectedMonth(event.target.value)}
              >
                {months.map((month) => (
                  <option key={month.folderName} value={month.folderName}>{formatMonthFolderShortLabel(month.folderName)}</option>
                ))}
              </select>
            </label>
```

and the equivalent audit-view block (`id="xray-results-month-audit"`). If the surrounding toolbar container becomes empty, remove it too. Remove the `formatMonthFolderShortLabel` import if now unused.

- [x] **Step 4: Typecheck + tests + commit**

Run: `npx tsc -b && npm run test:run`
Expected: PASS.

```bash
git add "src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayInspectionResults.tsx" docs/EDIT_LOG.md
git commit -m "refactor(ew): inspection results consume global month"
```

---

### Task 7: ReferralApproval consumes the global month

**Files:**
- Modify: `src/components/Sidebar/Tabs/EmployeeWorkspace/views/ReferralApproval/useApprovalData.ts` (state ~83–103, return ~397)
- Modify: `src/components/Sidebar/Tabs/EmployeeWorkspace/views/ReferralApproval/index.tsx` (destructure ~24, select ~110–116)
- Modify: `src/components/Sidebar/Tabs/EmployeeWorkspace/views/ReferralApproval/useApprovalData.test.tsx` (mock the hook module)
- Modify: `docs/EDIT_LOG.md`

**Interfaces:**
- Consumes: `useGlobalMonth` (import path `../../../../../../data/month/useGlobalMonth`)
- Produces: `useApprovalData` return drops `setSelMonth`; keeps `months`, `selMonth`.

- [x] **Step 1: EDIT_LOG entry** for the three files under `## v55`.

- [x] **Step 2: Rewire the hook**

In `useApprovalData.ts` replace:

```ts
  const [months, setMonths] = useState<MonthFolderInfo[]>([]);
  const [selMonth, setSelMonth] = useState("");
```

with:

```ts
  const { months, selection: globalMonth } = useGlobalMonth();
  const selMonth = globalMonth.kind === "existing" ? globalMonth.folderName : "";
```

Delete the listing effect:

```ts
  useEffect(() => {
    listMonthFolders(directoryHandle)
      .then((ms) => {
        setMonths(ms);
        if (ms.length > 0) setSelMonth((cur) => cur || ms[ms.length - 1]!.folderName);
        else setLoadState("ready");
      })
      .catch(() => setLoadState("error"));
  }, [directoryHandle]);
```

and add:

```ts
  // No selected on-disk month → nothing to load; land in the ready/empty state.
  useEffect(() => {
    if (!selMonth) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync empty-state reset when no month folder is selected
      setLoadState("ready");
    }
  }, [selMonth]);
```

In the return object change `userDisplayMap, months, selMonth, setSelMonth,` to `userDisplayMap, months, selMonth,`. Add the `useGlobalMonth` import; remove the `listMonthFolders` import (and `MonthFolderInfo` import if now unused).

- [x] **Step 3: Remove the select from the view**

In `ReferralApproval/index.tsx` update the destructure (drop `setSelMonth`) and replace:

```tsx
            <label className="ew-label" htmlFor="ra-month">
              الشهر
              <select id="ra-month" className="ew-select" value={selMonth} onChange={(e) => setSelMonth(e.target.value)}>
                {months.map((m) => <option key={m.folderName} value={m.folderName}>{formatMonthFolderShortLabel(m.folderName)}</option>)}
              </select>
            </label>

            <SummaryBar counts={counts} active={statusFilter} onSelect={setStatusFilter} />
```

with:

```tsx
            <SummaryBar counts={counts} active={statusFilter} onSelect={setStatusFilter} />
```

Remove the `formatMonthFolderShortLabel` import if now unused in that file.

- [x] **Step 4: Update the hook test**

In `useApprovalData.test.tsx`, after the existing imports add a module mock (the fixture month used throughout the file is what the mock must select — verify it is `5-may-2026` and adjust if the fixtures use another folder):

```tsx
vi.mock("../../../../../../data/month/useGlobalMonth", () => ({
  useGlobalMonth: () => ({
    months: [{ month: 5, year: 2026, folderName: "5-may-2026" }],
    selection: { kind: "existing", month: 5, year: 2026, folderName: "5-may-2026" },
    isSelectedMonthClosed: false,
    setSelectedMonth: () => {},
    startNewMonth: () => {},
    refreshMonths: async () => {},
    registerMonthChangeGuard: () => () => {},
  }),
}));
```

(add `vi` to the vitest import if missing). Remove any test steps that called `setSelMonth`.

- [x] **Step 5: Run tests + commit**

Run: `npx vitest run "src/components/Sidebar/Tabs/EmployeeWorkspace/views/ReferralApproval" && npx tsc -b`
Expected: PASS.

```bash
git add "src/components/Sidebar/Tabs/EmployeeWorkspace/views/ReferralApproval" docs/EDIT_LOG.md
git commit -m "refactor(ew): referral approval consumes global month"
```

---

### Task 8: KpiRenderer consumes the global month

**Files:**
- Modify: `src/components/Sidebar/Tabs/ReportDesigner/renderers/KpiRenderer.tsx` (`useExecutiveRows`, lines ~74–113)
- Modify: `docs/EDIT_LOG.md`

**Interfaces:**
- Consumes: `useGlobalMonth` (import path `../../../../../data/month/useGlobalMonth`)

- [x] **Step 1: EDIT_LOG entry** for this file under `## v55`.

- [x] **Step 2: Replace the auto-latest logic**

Replace the body of `useExecutiveRows` (keeping its JSDoc, updated to say "the globally selected month" instead of "the latest month"):

```tsx
function useExecutiveRows(): Array<Record<string, unknown>> | null {
  const { directoryHandle } = useWorkspace();
  const { selection } = useGlobalMonth();
  const monthFolder = selection.kind === "existing" ? selection.folderName : null;
  const [rows, setRows] = useState<Array<Record<string, unknown>> | null>(null);

  useEffect(() => {
    if (!directoryHandle || !monthFolder) return;
    const root = directoryHandle;
    const month = monthFolder;
    let cancelled = false;
    async function load() {
      const populationData = await loadMonthPopulationFinal(root, month);
      const sample = await loadSampleMaster(root, month);
      const sampleRows = sample?.rows ?? [];
      const distribution = await loadOrDeriveDistributionCurrent(root, month, sampleRows);
      const employeeFiles = await loadAllEmployeeFiles(root, month);
      if (cancelled) return;

      const execRows = buildExecutiveReportRows({
        monthFolderName: month,
        populationRows: (populationData?.rows ?? []) as PreparedPopulationRow[],
        sample: sample ?? null,
        distribution: distribution ?? null,
        employeeFiles,
        template: null,
        config: DEFAULT_EXEC_CONFIG,
      });

      if (!cancelled) {
        setRows(execRows.map((r) => r as Record<string, unknown>));
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [directoryHandle, monthFolder]);

  return rows;
}
```

Add the `useGlobalMonth` import; remove `listMonthFolders` from the `populationStorage` import (keep `loadMonthPopulationFinal`).

- [x] **Step 3: Typecheck + tests + commit**

Run: `npx tsc -b && npm run test:run`
Expected: PASS.

```bash
git add "src/components/Sidebar/Tabs/ReportDesigner/renderers/KpiRenderer.tsx" docs/EDIT_LOG.md
git commit -m "refactor(report-designer): KPI renderer consumes global month"
```

---

### Task 9: Population wizard driven by the global month

**Files:**
- Modify: `src/components/Sidebar/Tabs/Population/index.tsx` (multiple regions, see steps)
- Modify: `src/components/Sidebar/Tabs/Population/components/PhaseTwoReportAndProcessing.tsx` (props + save panel)
- Modify: `src/components/Sidebar/Tabs/Population/Population.wizard.test.tsx` (mock `useGlobalMonth`)
- Modify: `src/components/Sidebar/Tabs/Population/Population.css` (one new class)
- Modify: `docs/EDIT_LOG.md`

**Interfaces:**
- Consumes: `useGlobalMonth` (import path `../../../../data/month/useGlobalMonth`), `getLabels().gm_month_switch_confirm`
- Produces: `PhaseTwoReportAndProcessing` prop change — `saveMonth: number` and `onMonthChange` replaced by `monthLabel: string`.

- [x] **Step 1: EDIT_LOG entry** for the four files under `## v55`.

- [x] **Step 2: Update the wizard test first (it pins the contract)**

In `Population.wizard.test.tsx`, after the `usePermissions` mock add:

```tsx
// Global month context: no workspace in this test → selection none, no months.
vi.mock("../../../../data/month/useGlobalMonth", () => ({
  useGlobalMonth: () => ({
    months: [],
    selection: { kind: "none" },
    isSelectedMonthClosed: false,
    setSelectedMonth: () => {},
    startNewMonth: () => {},
    refreshMonths: async () => {},
    registerMonthChangeGuard: () => () => {},
  }),
}));
```

Run: `npx vitest run src/components/Sidebar/Tabs/Population/Population.wizard.test.tsx`
Expected: still PASS (mock is inert until index.tsx uses the hook).

- [x] **Step 3: Derive month/year from the global selection**

In `src/components/Sidebar/Tabs/Population/index.tsx` add the import:

```tsx
import { useGlobalMonth } from "../../../../data/month/useGlobalMonth";
```

Replace:

```tsx
  const initialMonth = currentMonthFolderInfo();
  const [saveMonth, setSaveMonth] = useState(initialMonth.month);
  const [saveYear, setSaveYear] = useState(initialMonth.year);
```

with:

```tsx
  const {
    selection: globalMonth,
    setSelectedMonth: setGlobalMonth,
    refreshMonths,
    registerMonthChangeGuard,
    isSelectedMonthClosed,
  } = useGlobalMonth();
  // The save target is ALWAYS the globally selected month. The current-calendar
  // fallback only covers the no-workspace state, where saving is impossible anyway.
  const fallbackMonth = currentMonthFolderInfo();
  const saveMonth = globalMonth.kind === "none" ? fallbackMonth.month : globalMonth.month;
  const saveYear = globalMonth.kind === "none" ? fallbackMonth.year : globalMonth.year;
```

- [x] **Step 4: Replace the month-lock state with the provider's**

Delete the state declaration:

```tsx
  const [selectedMonthClosed, setSelectedMonthClosed] = useState(false);
```

and the effect (lines ~412–423):

```tsx
  // Track the month-lock state of the selected month (Tier-1 Item A).
  useEffect(() => {
    if (!directoryHandle) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync reset when workspace is disconnected
      setSelectedMonthClosed(false);
      return;
    }
    const monthFolderName = formatMonthFolderName(saveMonth, saveYear);
    isMonthClosed(directoryHandle, monthFolderName)
      .then(setSelectedMonthClosed)
      .catch(() => setSelectedMonthClosed(false));
  }, [directoryHandle, saveMonth, saveYear, monthRefreshKey]);
```

Add instead (near the derivation from Step 3):

```tsx
  const selectedMonthClosed = isSelectedMonthClosed;
```

Remove the now-unused `isMonthClosed` import if nothing else references it (keep `MonthClosedError`).

- [x] **Step 5: Remove the local month list; add unsaved-work guard, auto-load, and reset**

Delete the state + effect (lines ~236–252):

```tsx
  const [existingMonths, setExistingMonths] = useState<MonthFolderInfo[]>([]);
  const [isLoadingMonths, setIsLoadingMonths] = useState(false);
```

```tsx
    setIsLoadingMonths(true);
    listMonthFolders(directoryHandle)
      .then((months) => setExistingMonths([...months].reverse()))
      .catch(() => setExistingMonths([]))
      .finally(() => setIsLoadingMonths(false));
```

(delete the containing `useEffect` entirely; keep `isLoadingMonthData` and `monthRefreshKey`). Remove `listMonthFolders` from the imports.

Add the guard + auto-load machinery after `handleLoadExistingMonth`:

```tsx
  // Unsaved in-session work (parsed uploads not yet auto-saved) — switching the
  // global month would discard it, so the provider asks for confirmation first.
  const hasUnsavedSessionWorkRef = useRef(false);
  useEffect(
    () =>
      registerMonthChangeGuard(() =>
        hasUnsavedSessionWorkRef.current ? getLabels().gm_month_switch_confirm : null
      ),
    [registerMonthChangeGuard]
  );

  /** Clean Phase-1 state targeting the (pending) global month. */
  function resetForNewMonth(): void {
    hasUnsavedSessionWorkRef.current = false;
    setUploads({
      riskAgencyData: { file: null, source: null },
      businessIntelligenceData: { file: null, source: null },
    });
    setRiskWorkbookResult(null);
    setBiWorkbookResult(null);
    setPopulationProcessingResult(null);
    setSampleDrawResult(null);
    setSampleNeedsApproval(false);
    setDistributionCurrent(null);
    setSaveToDiskMessage(null);
    setSampleSaveMessage(null);
    setDistributionMessage(null);
    setUploadError("");
    setProcessingMessage("");
    setCurrentPhase(1);
    setCompletedPhaseIds([]);
  }

  // The global month IS the wizard's month: selecting an existing month loads it
  // from disk; selecting a pending (new) month resets to a clean import flow.
  const loadedFolderRef = useRef<string | null>(null);
  useEffect(() => {
    if (!directoryHandle || globalMonth.kind === "none") return;
    if (loadedFolderRef.current === globalMonth.folderName) return;
    loadedFolderRef.current = globalMonth.folderName;
    if (globalMonth.kind === "existing") {
      void handleLoadExistingMonth({
        month: globalMonth.month,
        year: globalMonth.year,
        folderName: globalMonth.folderName,
      });
    } else {
      resetForNewMonth();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleLoadExistingMonth/resetForNewMonth are stable per render cycle; keying on folderName prevents load loops
  }, [directoryHandle, globalMonth]);
```

In `handleLoadExistingMonth`, add as the first line of the `try` block:

```tsx
      hasUnsavedSessionWorkRef.current = false;
```

and DELETE these two lines from it:

```tsx
        setSaveMonth(info.month);
        setSaveYear(info.year);
```

- [x] **Step 6: Mark dirty on fresh parse; clear + refresh on save**

In the worker `onMessage` handler, `done` branch, after `setBiWorkbookResult(msg.biResult);` add:

```tsx
          hasUnsavedSessionWorkRef.current = true;
```

In `commitSaveToDisk`, in the `result.ok` branch after `setMonthRefreshKey((k) => k + 1);` add:

```tsx
        hasUnsavedSessionWorkRef.current = false;
        void refreshMonths();
```

- [x] **Step 7: Route the pop-load-month event through the global selection**

Replace the effect (lines ~278–288):

```tsx
  useEffect(() => {
    const handler = (e: CustomEvent<MonthFolderInfo>) => {
      setActiveSubTab("process");
      window.dispatchEvent(new CustomEvent("pop-subtab-changed", { detail: "process" }));
      void handleLoadExistingMonth(e.detail);
    };
    window.addEventListener("pop-load-month", handler as EventListener);
    return () => window.removeEventListener("pop-load-month", handler as EventListener);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [directoryHandle]);
```

with:

```tsx
  useEffect(() => {
    const handler = (e: CustomEvent<MonthFolderInfo>) => {
      setActiveSubTab("process");
      window.dispatchEvent(new CustomEvent("pop-subtab-changed", { detail: "process" }));
      // The auto-load effect reacts to the selection change (guard included).
      setGlobalMonth(e.detail.folderName);
    };
    window.addEventListener("pop-load-month", handler as EventListener);
    return () => window.removeEventListener("pop-load-month", handler as EventListener);
  }, [setGlobalMonth]);
```

- [x] **Step 8: Remove the Phase-1 "فتح شهر سابق" section**

Delete the block (lines ~1597–1628) from `{directoryHandle && (isLoadingMonths || existingMonths.length > 0) && (` through the closing `)}` that contains `month-picker-section`, keeping the `isLoadingMonthData` loading indicator by moving it directly above `<PhaseOneUpload`:

```tsx
            {isLoadingMonthData && (
              <div className="month-picker-loading">جاري تحميل بيانات الشهر...</div>
            )}
            <PhaseOneUpload
```

- [x] **Step 9: Phase-2 read-only save month**

In `PhaseTwoReportAndProcessing.tsx`: delete the `ARABIC_MONTHS` const; in the props type replace `saveMonth: number;` with `monthLabel: string;` and delete `onMonthChange: (month: number) => void;`; update the destructuring accordingly; replace the month-grid block:

```tsx
            <span className="phase2-month-label">شهر الحفظ</span>
            <div className="phase2-month-grid" role="group">
              {ARABIC_MONTHS.map((name, idx) => (
                <button
                  key={idx + 1}
                  type="button"
                  className={`phase2-month-btn${saveMonth === idx + 1 ? " active" : ""}`}
                  onClick={() => onMonthChange(idx + 1)}
                  aria-pressed={saveMonth === idx + 1}
                >
                  {name}
                </button>
              ))}
            </div>
```

with:

```tsx
            <span className="phase2-month-label">شهر الحفظ</span>
            <strong className="phase2-month-current">{monthLabel}</strong>
```

In `index.tsx`, at the `<PhaseTwoReportAndProcessing` call site replace `saveMonth={saveMonth}` with:

```tsx
            monthLabel={formatMonthFolderShortLabel(formatMonthFolderName(saveMonth, saveYear))}
```

and delete the `onMonthChange={...}` prop line. In `Population.css` add next to `.phase2-month-label`:

```css
.phase2-month-current {
  font-size: 14px;
  font-weight: 700;
}
```

- [x] **Step 10: Typecheck, fix leftovers, run tests**

Run: `npx tsc -b`
Fix any remaining references to `setSaveMonth`, `setSaveYear`, `existingMonths`, `isLoadingMonths`, `setSelectedMonthClosed` (all must be gone).

Run: `npx vitest run src/components/Sidebar/Tabs/Population/Population.wizard.test.tsx && npm run test:run`
Expected: PASS.

- [x] **Step 11: Commit**

```bash
git add "src/components/Sidebar/Tabs/Population" docs/EDIT_LOG.md
git commit -m "refactor(population): wizard driven by the global month selection"
```

---

### Task 10: Browse scope toggle, Archive refresh, docs, full verification

**Files:**
- Modify: `src/components/Sidebar/Tabs/Population/index.tsx` (`BrowseDataView`, ~2147–2445)
- Modify: `src/components/Sidebar/Tabs/Archive/index.tsx` (`handleMonthLockConfirm`, ~163)
- Modify: `docs/architecture/data-system-report.md` (add provider + storage-key note)
- Modify: `docs/EDIT_LOG.md`
- Modify: `CLAUDE.md` (architecture section: mention the global month provider)

**Interfaces:**
- Consumes: `useGlobalMonth`, label `gm_all_months` via `useLabels`

- [x] **Step 1: EDIT_LOG entry** for these files under `## v55`.

- [x] **Step 2: BrowseDataView — global month + "كل الأشهر" toggle**

Inside `BrowseDataView` replace:

```tsx
  const [selectedMonthFilter, setSelectedMonthFilter] = useState("all");
```

with:

```tsx
  const { selection: globalMonth } = useGlobalMonth();
  const labels = useLabels();
  const [showAllMonths, setShowAllMonths] = useState(false);
  const globalFolder = globalMonth.kind === "none" ? null : globalMonth.folderName;
```

(`useLabels` import: `../../../../data/labels/useLabels` — skip if already imported.)

Delete the `monthOptions` and `effectiveMonthFilter` memos and replace the `monthFilteredRows` memo with:

```tsx
  const monthFilteredRows = useMemo(
    () =>
      showAllMonths || !globalFolder
        ? rows
        : rows.filter((row) => row._monthFolder === globalFolder),
    [rows, showAllMonths, globalFolder]
  );
```

In `exportFilteredRowsToXlsx` replace:

```tsx
    const monthName =
      selectedMonthFilter === "all"
        ? "كل الأشهر"
        : formatMonthFolderLabel(selectedMonthFilter);
```

with:

```tsx
    const monthName =
      showAllMonths || !globalFolder
        ? labels.gm_all_months
        : formatMonthFolderShortLabel(globalFolder);
```

Replace the header filter UI:

```tsx
          <label className="bv-month-filter" htmlFor="browseMonthFilter">
            <span>الشهر</span>
            <select
              id="browseMonthFilter"
              value={selectedMonthFilter}
              onChange={(event) => setSelectedMonthFilter(event.target.value)}
            >
              <option value="all">الكل</option>
              {monthOptions.map((monthFolder) => (
                <option key={monthFolder} value={monthFolder}>
                  {formatMonthFolderLabel(monthFolder)}
                </option>
              ))}
            </select>
          </label>
```

with:

```tsx
          <label className="bv-month-filter" htmlFor="browseAllMonths">
            <input
              id="browseAllMonths"
              type="checkbox"
              checked={showAllMonths}
              onChange={(event) => setShowAllMonths(event.target.checked)}
            />
            <span>{labels.gm_all_months}</span>
          </label>
```

Delete the now-unused `formatMonthFolderLabel` and `collectMonthOptions` helper functions (lines ~2070–2078) if nothing else references them.

- [x] **Step 3: Archive refreshes the provider after close/reopen**

In `src/components/Sidebar/Tabs/Archive/index.tsx` add the import (`../../../../data/month/useGlobalMonth`) and inside the component:

```tsx
  const { refreshMonths } = useGlobalMonth();
```

In `handleMonthLockConfirm`, after the successful close/reopen (where the audit `logAction` for `month-closed`/`month-reopened` happens), add:

```tsx
      void refreshMonths();
```

- [x] **Step 4: Docs sync**

- `docs/architecture/data-system-report.md`: add a short subsection noting the global month provider (`src/data/month/`), the `xray_global_month_v1` sessionStorage key, and that no disk layout changed.
- `CLAUDE.md`: in the Architecture section add one line under the data-layer modules table: `| Global month | src/data/month/ | App-wide month selection (provider + toolbar selector); sessionStorage key xray_global_month_v1 |` and update the tab descriptions if they mention per-tab month filters.

- [x] **Step 5: Full verification**

Run: `npm run test:run`
Expected: all suites PASS.
Run: `npm run lint`
Expected: clean.
Run: `npm run build`
Expected: single-file build succeeds; note the reported `dist/index.html` size.
Interactive check (dev server via preview tools): switch months in the header on each tab (Reports, Employee Workspace views, Approval, Population process + browse, KPI), create a new month, verify the confirm dialog fires with unsaved uploads, verify browse "كل الأشهر" toggle.

- [x] **Step 6: Commit**

```bash
git add "src/components/Sidebar/Tabs/Population/index.tsx" "src/components/Sidebar/Tabs/Archive/index.tsx" docs/architecture/data-system-report.md CLAUDE.md docs/EDIT_LOG.md
git commit -m "refactor(population): browse scope toggle; archive refresh; global month docs"
```
