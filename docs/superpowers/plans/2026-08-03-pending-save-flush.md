# Pending-Save Flush (P0: prevent silent debounced-save loss) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix a real, reachable silent-data-loss bug found by this session's architecture evaluation (`docs/superpowers/specs/2026-08-03-reference-architecture-evaluation.md`, P0 items 1-2): Report Designer's 800ms autosave debounce cancels its pending timer on unmount without flushing it, so an edit made less than 800ms before clicking "رجوع" (back) or navigating away is silently discarded with no warning. There is also no app-wide `pagehide`/`visibilitychange`-triggered flush anywhere in the app, so the same class of loss can happen on tab close/reload for any debounced writer.

**Architecture:** Task 1 fixes the in-app-navigation case directly (an unmount-only effect that flushes Report Designer's pending save) — this alone closes the most common, most reachable version of the bug, since "رجوع" is in-app navigation, not a tab close. Task 2 adds a small, generic flush-registry module (mirroring the `pagehide`/`visibilitychange` listener pattern already proven in `AuthGate.tsx`) that any debounced writer can register with, and wires it into both Report Designer (belt-and-suspenders for the tab-close case) and `DataTable`'s column-config debounce (the other debounced writer the evaluation found, lower severity — a layout preference, not business data — but the identical unflushed-timer pattern).

**Tech Stack:** React 19 hooks (`useEffect`, `useRef`), Vitest + `@testing-library/react`.

## Global Constraints

- Every edit needs a `docs/edit logs/YYYY-MM-DD.md` entry (today's file) per CLAUDE.md: version bump, category prefix, Before/After snippets, `**Lines:**` stat.
- Pathspec-scoped git commits only (`git add <files>` then `git commit -m "..." -- <same files>`) — never a bare `git commit`; this repo routinely has unrelated pre-existing uncommitted work in the tree from other sessions.
- Repo-level gates: `npm run test:run`, `npm run typecheck`, `npm run lint` after every task.
- **`DataTable` is a widely-shared component** (used by `BrowseDataView` and others) — Task 2's `DataTable` change must run the FULL `npm run test:run` before committing, not just a scoped subset, since a mistake here has a wide blast radius.
- The flush registry must be genuinely best-effort and never throw into its caller — a `pagehide`/`visibilitychange` handler that throws can break other unrelated listeners on the same event.

---

### Task 1: Flush Report Designer's pending autosave on unmount

**Files:**
- Modify: `src/components/Sidebar/Tabs/ReportDesigner/index.tsx`
- Test: `src/components/Sidebar/Tabs/ReportDesigner/index.test.tsx` (check if this file exists first; if not, create it, or find whatever existing test file covers `EditorHost`/autosave behavior in this directory)

**Interfaces:**
- No new exports. `EditorHost`'s existing `performSave`/`pendingDocRef`/`saveTimerRef` are reused, not changed in shape.

**Background:** `EditorHost`'s autosave effect (search for `"Schedule autosave whenever doc changes"`) is scoped to `[doc]` — its cleanup function runs both when `doc` changes (about to reschedule) AND on true unmount, and today it only calls `clearTimeout`, discarding whatever was pending either way. Adding a flush directly into that cleanup would fire a save on **every keystroke** (since the cleanup runs on every `doc` change, not just unmount) — completely defeating the debounce. The fix must live in a **separate effect with an empty dependency array**, whose cleanup therefore only ever runs once, on genuine unmount.

- [ ] **Step 1: Write a failing test**

Find or create a test file covering `ReportDesigner`'s `EditorHost` (check for an existing `index.test.tsx` or similar in this directory first — read it to match its existing mocking conventions for `directoryHandle`, `saveDesign`, etc. before adding to it). Add a test using fake timers:

```tsx
it("flushes a pending autosave on unmount instead of discarding it", async () => {
  vi.useFakeTimers();
  // Render EditorHost (or the ReportDesigner flow that reaches it) with a
  // real/mock directoryHandle and spy on saveDesign (or whatever the actual
  // save function this file imports is called -- check the current import).
  // ... render, make an edit that changes `doc` (e.g. add an element via
  // whatever UI action already has an existing test elsewhere in this repo
  // for ReportDesigner, to match established interaction patterns) ...

  // Immediately unmount BEFORE the 800ms debounce would have fired.
  vi.advanceTimersByTime(400); // less than the 800ms debounce window
  unmount(); // whatever the render helper's unmount function is called

  // The pending edit must still have been saved, not discarded.
  await vi.waitFor(() => expect(saveDesignSpy).toHaveBeenCalled());
  vi.useRealTimers();
});
```

Adapt the exact rendering/mocking mechanics to match this file's real exports and this repo's real existing test conventions for `ReportDesigner` — read the file and any existing test file in this directory fully before writing the exact test code; the shape above is illustrative of the assertion, not literal code to paste verbatim.

- [ ] **Step 2: Run the test to verify it fails**

Expected: FAIL — the pending edit is discarded on unmount today (no flush).

- [ ] **Step 3: Add the unmount-only flush effect**

In `src/components/Sidebar/Tabs/ReportDesigner/index.tsx`'s `EditorHost`, immediately after the existing autosave effect (the one scoped to `[doc]`, ending around the `}, [doc]);` line), add a new, separate effect:

```tsx
  // Flush any pending autosave on TRUE unmount only (empty deps -- this
  // effect's cleanup runs exactly once, unlike the `[doc]` effect above
  // whose cleanup also fires on every keystroke). Without this, an edit
  // made <800ms before navigating away (e.g. clicking "رجوع") or the
  // component otherwise unmounting is silently discarded.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== null) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        void performSave(pendingDocRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately empty: this must run its cleanup exactly once, on unmount, not on every doc/performSave identity change
  }, []);
```

Do NOT modify the existing `[doc]`-scoped autosave effect itself, and do NOT modify `onBack`'s `useCallback`/inline handler — `onBack` already triggers an unmount (the parent conditionally renders `EditorHost` only `if (view === "editor" && openDoc)`), so this new effect's cleanup covers the "رجوع" case automatically without touching that call site.

- [ ] **Step 4: Run the test to verify it passes**

Expected: PASS.

- [ ] **Step 5: Confirm no double-save regression**

Add (or reason through and note in your report if a test would be redundant with existing coverage) a second case: if the debounce has ALREADY fired (timer reached null because `performSave` already started) before unmount, the new effect's cleanup must NOT fire a second, redundant save — verify `saveTimerRef.current === null` is correctly the no-op guard (it already is, per the `if (saveTimerRef.current !== null)` check — just confirm this behavior with a test or a clear reasoning note, don't skip verifying it).

- [ ] **Step 6: Run the full ReportDesigner test suite, typecheck, lint**

Run: `npx vitest run src/components/Sidebar/Tabs/ReportDesigner`
Expected: PASS, including every pre-existing test.

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 7: Edit log + version bump + commit**

```bash
git add src/components/Sidebar/Tabs/ReportDesigner/index.tsx src/components/Sidebar/Tabs/ReportDesigner/index.test.tsx "docs/edit logs/2026-08-03.md" package.json
git commit -m "Fix (report-designer): flush pending autosave on unmount instead of silently discarding it" -- src/components/Sidebar/Tabs/ReportDesigner/index.tsx src/components/Sidebar/Tabs/ReportDesigner/index.test.tsx "docs/edit logs/2026-08-03.md" package.json
```

(Adjust the test file path in this command if Step 1 created a differently-named file.)

---

### Task 2: App-wide pending-save flush registry, wired to Report Designer + DataTable

**Files:**
- Create: `src/data/storage/pendingSaveFlush.ts`
- Test: `src/data/storage/pendingSaveFlush.test.ts`
- Modify: `src/components/Sidebar/Tabs/ReportDesigner/index.tsx` (register/unregister its flush alongside Task 1's unmount fix — belt-and-suspenders for the tab-close case, which unmount alone doesn't cover)
- Modify: `src/components/DataTable/index.tsx` (register/unregister its column-config debounce flush)

**Interfaces:**
- Produces:
  - `export function registerPendingSaveFlush(flush: () => void): () => void` — registers a best-effort, synchronous-call flush callback; returns an unregister function.
  - `export function __clearPendingSaveFlushesForTests(): void` — test-only reset.
- Consumes (in both modified components): the existing `pagehide`/`visibilitychange` listener pattern already proven in `src/auth/AuthGate.tsx:305-319` — mirror it exactly, don't invent a new event-listening approach.

**Background:** Neither Report Designer's autosave nor `DataTable`'s column-config debounce (`src/components/DataTable/index.tsx`, search for `colChangeDebouncerRef`/`setColCfg`) flushes on tab close or backgrounding — only Task 1's unmount fix (in-app navigation) is covered so far. A small, generic registry lets any debounced writer register a flush callback once; the registry's own `pagehide`/`visibilitychange` listeners (module-scope, registered once) call every registered flush when the page is about to go away.

- [ ] **Step 1: Write failing tests for the registry itself**

Create `src/data/storage/pendingSaveFlush.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { registerPendingSaveFlush, __clearPendingSaveFlushesForTests } from "./pendingSaveFlush";

describe("pendingSaveFlush registry", () => {
  afterEach(() => __clearPendingSaveFlushesForTests());

  it("calls every registered flush when a pagehide event fires", () => {
    const flushA = vi.fn();
    const flushB = vi.fn();
    registerPendingSaveFlush(flushA);
    registerPendingSaveFlush(flushB);

    window.dispatchEvent(new Event("pagehide"));

    expect(flushA).toHaveBeenCalledOnce();
    expect(flushB).toHaveBeenCalledOnce();
  });

  it("stops calling a flush after it has been unregistered", () => {
    const flush = vi.fn();
    const unregister = registerPendingSaveFlush(flush);
    unregister();

    window.dispatchEvent(new Event("pagehide"));

    expect(flush).not.toHaveBeenCalled();
  });

  it("a throwing flush does not prevent other registered flushes from running", () => {
    const throwing = vi.fn(() => { throw new Error("boom"); });
    const normal = vi.fn();
    registerPendingSaveFlush(throwing);
    registerPendingSaveFlush(normal);

    expect(() => window.dispatchEvent(new Event("pagehide"))).not.toThrow();
    expect(normal).toHaveBeenCalledOnce();
  });
});
```

(Check this repo's `vitest.config.ts` — if the default test environment is `"node"` for `src/data/storage/`, this test file will need a `/* @vitest-environment jsdom */` pragma at the top, since it uses `window`/`Event` — confirm by checking an existing test file in `src/data/storage/` that already uses `window`, or add the pragma defensively.)

- [ ] **Step 2: Run the tests to verify they fail**

Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement the registry**

Create `src/data/storage/pendingSaveFlush.ts`:

```ts
/**
 * A tiny registry any debounced writer can join so its pending save gets a
 * best-effort flush when the tab is about to go away (close, reload,
 * backgrounding) -- mirrors the pagehide/visibilitychange listener pattern
 * already proven in src/auth/AuthGate.tsx for auth-activity telemetry, but
 * generalized for save-flushing. Each registered flush is called
 * synchronously and defensively (a throw from one never blocks the rest).
 * This does not guarantee the underlying async write completes before the
 * page actually unloads -- browsers give very little time during pagehide --
 * but attempting the write is strictly better than not trying, and it fully
 * covers the more common case of the tab merely being backgrounded/hidden,
 * not closed.
 */
type FlushFn = () => void;

const pendingFlushes = new Set<FlushFn>();

export function registerPendingSaveFlush(flush: FlushFn): () => void {
  pendingFlushes.add(flush);
  return () => {
    pendingFlushes.delete(flush);
  };
}

export function __clearPendingSaveFlushesForTests(): void {
  pendingFlushes.clear();
}

function flushAll(): void {
  for (const flush of pendingFlushes) {
    try {
      flush();
    } catch {
      // Best-effort: one broken registrant must never block the others.
    }
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flushAll);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushAll();
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Expected: PASS.

- [ ] **Step 5: Wire Report Designer's `EditorHost` to the registry**

In `src/components/Sidebar/Tabs/ReportDesigner/index.tsx`, add the import:

```ts
import { registerPendingSaveFlush } from "../../../../data/storage/pendingSaveFlush";
```

Extend Task 1's unmount-only effect (do not add a third effect — reuse the same one) to ALSO register with the flush registry for the tab-close/hidden case:

```tsx
  useEffect(() => {
    const unregister = registerPendingSaveFlush(() => {
      if (saveTimerRef.current !== null) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        void performSave(pendingDocRef.current);
      }
    });
    return () => {
      unregister();
      if (saveTimerRef.current !== null) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        void performSave(pendingDocRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately empty: register once on mount, unregister + flush exactly once on unmount
  }, []);
```

(This replaces Task 1's simpler version of this same effect — if Task 1 already landed, this step edits that effect in place rather than adding a new one.)

- [ ] **Step 6: Wire `DataTable`'s column-config debounce to the registry**

In `src/components/DataTable/index.tsx`, add the same import. Find `colChangeDebouncerRef` and `setColCfg` (search for `colChangeDebouncerRef`). Add a ref to hold the pending config (mirroring `ReportDesigner`'s `pendingDocRef` pattern) and register a flush:

```tsx
  const pendingColCfgRef = useRef<ColConfig | null>(null);

  function setColCfg(c: ColConfig): void {
    setColCfgState(c);
    if (onColConfigChange) {
      pendingColCfgRef.current = c;
      if (colChangeDebouncerRef.current) clearTimeout(colChangeDebouncerRef.current);
      colChangeDebouncerRef.current = setTimeout(() => {
        colChangeDebouncerRef.current = null;
        pendingColCfgRef.current = null;
        onColConfigChange(c);
      }, 800);
    }
  }

  useEffect(() => {
    const unregister = registerPendingSaveFlush(() => {
      if (colChangeDebouncerRef.current !== null && pendingColCfgRef.current !== null && onColConfigChange) {
        clearTimeout(colChangeDebouncerRef.current);
        colChangeDebouncerRef.current = null;
        const pending = pendingColCfgRef.current;
        pendingColCfgRef.current = null;
        onColConfigChange(pending);
      }
    });
    return () => {
      unregister();
      if (colChangeDebouncerRef.current !== null && pendingColCfgRef.current !== null && onColConfigChange) {
        clearTimeout(colChangeDebouncerRef.current);
        colChangeDebouncerRef.current = null;
        const pending = pendingColCfgRef.current;
        pendingColCfgRef.current = null;
        onColConfigChange(pending);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately empty: register once on mount, unregister + flush exactly once on unmount; onColConfigChange is read fresh via closure at flush time, not a reactive dependency this effect needs to re-run for
  }, []);
```

Read the current file first to confirm `colChangeDebouncerRef`'s exact declaration and `onColConfigChange`'s exact prop name/type before editing — the brief's exact target shape above must match the real current code's surrounding structure, not just be dropped in blind. `ColConfig` should already be imported/defined in this file (used by `initialColConfig`/`setColCfgState` already) — reuse it, don't redefine it.

- [ ] **Step 7: Run DataTable's own tests, then the FULL suite (not scoped) given the wide blast radius**

Run: `npx vitest run src/components/DataTable`
Expected: PASS, including every pre-existing test.

Run: `npm run test:run` (the FULL suite — required for this task specifically, per the Global Constraints, since `DataTable` is used by `BrowseDataView` and potentially other consumers)
Expected: PASS, all files.

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 8: Edit log + version bump + commit**

```bash
git add src/data/storage/pendingSaveFlush.ts src/data/storage/pendingSaveFlush.test.ts src/components/Sidebar/Tabs/ReportDesigner/index.tsx src/components/DataTable/index.tsx "docs/edit logs/2026-08-03.md" package.json
git commit -m "Add (storage): app-wide pending-save flush registry for pagehide/visibilitychange, wired to Report Designer + DataTable column-config" -- src/data/storage/pendingSaveFlush.ts src/data/storage/pendingSaveFlush.test.ts src/components/Sidebar/Tabs/ReportDesigner/index.tsx src/components/DataTable/index.tsx "docs/edit logs/2026-08-03.md" package.json
```

---

## Key files touched

| Task | Files |
|---|---|
| 1 | `src/components/Sidebar/Tabs/ReportDesigner/index.tsx`, its test file |
| 2 | `src/data/storage/pendingSaveFlush.ts` (new), `.test.ts` (new), `src/components/Sidebar/Tabs/ReportDesigner/index.tsx`, `src/components/DataTable/index.tsx` |
