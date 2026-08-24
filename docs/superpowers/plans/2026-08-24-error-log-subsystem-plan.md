# Persistent, admin-exportable error log — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every error any employee hits is durably recorded in the shared workspace with the context needed to act on it — page/sub-tab, the action attempted, the `XQ-*` error code when one exists, the timestamp, and the username — and an admin can export the whole fleet's history to Excel from Settings. Today `src/data/storage/errorLogger.ts` is a 50-entry in-memory ring mirrored to `localStorage` only: it dies with the browser profile, it is per-machine, and nobody but the person who hit the error can ever see it.

**Architecture:** One new data-layer module family (`src/data/errorLog/`) modelled directly on `src/data/audit/actionLog.ts` — **per-actor files, never a shared one**: each browser writes only `5-system/system-errors/{stem}.errors.json`, so two employees can never contend on the same SMB entry, and per-actor per-year archives (`{stem}.errors.{year}.json`) absorb overflow before the live file is trimmed. Writes go through `casLoop` with actionLog's own hard-won SMB tuning (`maxRetries: 6, baseDelayMs: 100`, `actionLog.ts:497-499`), under a per-actor `withResourceLock` key.

The existing `errorLogger.ts` API (`logError`, `getRecentErrors`, `clearErrors`, `logRejection`) is **unchanged in signature and unchanged in behaviour** for all 56 modules that import it. Two inversions make that possible:

1. **A sink, not an import.** `errorLogger.ts` cannot import the persistence layer: `safeWrite.ts:1614` already imports `logError`, so an edge back the other way is a module cycle that would break at module-eval time (exactly the class of failure CLAUDE.md warns `vitest` cannot catch and `npm run build` can). Instead `errorLogger.ts` gains `registerErrorSink(sink)` and the new `src/data/errorLog/` module installs itself into it once a workspace and a session exist.
2. **An ambient context, not new parameters.** `page`, `username` and `role` are read from a new zero-import leaf module `src/data/storage/errorContext.ts`, written by the three places that already know those facts (`App.tsx`'s `activeTabId`, `subTabSelection.ts`'s one recording call site, `authSession.ts`'s `writeSession`/`clearSession`). `action` defaults to the `context` string the caller already passes (`"audit:append"`, `"datatable:export"` — these *are* action labels), with an optional opt-in override. `errorCode` comes from `logCodedError` explicitly plus a regex fallback over the `[XQ-AREA-NNN]` suffix that function already appends.

**Net: zero required changes at any of the 56 existing `logError`/`logCodedError` call sites.**

**Tech Stack:** React 19 + TypeScript (strict, `erasableSyntaxOnly`), Vitest (`node` default env, `/* @vitest-environment jsdom */` opt-in per component test), `createMemoryDirectory` for storage tests, the vendored `xlsx` (`vendor/xlsx-0.20.3.tgz`) already bundled for `DataTable`'s export.

---

## Tier ruling (and why)

**This plan is tier 3 overall**, against CLAUDE.md's ladder. The trigger is not the `ErrorEntry` shape change — that change is purely additive optional fields and would be tier 2 on its own. The trigger is **a new persisted on-disk data format**: `5-system/system-errors/` is a new workspace folder with a new file family, new schema-versioned envelopes, and a new archive-rotation contract, all of which land in `docs/architecture/data-system-report.md` (the authoritative path reference) and in CLAUDE.md's disk-layout block. "Data formats" is named explicitly in the tier-3 row, and migration/rollback prose is genuinely needed here (rollback = stop writing; the folder is read-only-forever thereafter, exactly the doctrine `auditPaths.ts:15-18` states for the legacy shared logs).

Applying that proportionally rather than uniformly:

- **Tasks 1, 2, 3, 5, 6, 7 write tier-2 edit-log entries** and run the tier-2 gates (`lint`, `typecheck`, `test:run`). None of them changes an on-disk format.
- **Tasks 4 and 8 write tier-3 entries** and run the full sweep. Task 4 introduces the on-disk format; Task 8 is the docs-sync + release wrap.
- `npm run build` runs at **every** task before commit, per CLAUDE.md's "mandatory before pushing a branch or opening a PR — at every tier, including tier 1". It is cheap (~13 s) and it is the only gate that catches the module-cycle failure mode this plan's sink inversion exists to avoid.

Version: `package.json` is at `115.2.0`. This is a new subsystem → major bump. Task 4 (the format-defining task) takes **v116.0**; the surrounding tier-2 tasks take decimal bumps in sequence. Let `npm run editlog` compute them — do not hand-pick numbers.

---

## Global Constraints

- Every edit gets an entry in `docs/edit logs/2026-08-24.md`, **generated** with `npm run editlog -- --tier=N --append [--sync-package] "Category (scope): title"`, never hand-written. Entries go newest-first at the TOP of the day's file — `npm run check:release` reads only the topmost heading. Write the entry *after* the edit is applied.
- Never a bare `git commit` — always `git add <specific files>` then `git commit -m "..." -- <same files>`.
- **The logging path must never be able to break its caller.** Every function this plan adds on the write side is best-effort by contract: it resolves rather than throws, it swallows every failure, and a failure inside it must never re-enter `logError`. `errorLogger.ts:29-33`'s existing `isPersisting` guard is the precedent and the reason it exists; this plan adds a second, deeper one (`suppressDepth`) for the same reason.
- **Never call `getFileHandle`/`createWritable` directly.** Resolve directories through `workspacePaths.ts`, write with `safeWriteJson`, read with `readOptionalJson`/`readJsonDirectory` — the same three entry points `actionLog.ts` uses.
- **No new dependency.** `xlsx` is vendored (`vendor/xlsx-0.20.3.tgz`); `check:vendor` pins its SHA-256. Do not touch `package.json`'s dependency block. `check:bundle-size` must stay green — this plan adds no new bundled library, only new source.
- Do not change `deriveCurrentDistribution`, the distribution fold, the sampling algorithm, or any report/export builder. `errorLogExport.ts` is a *new* builder, not a change to an existing one, so the "snapshot before changing" rule does not bind it — but its pure row-builder must be pinned by a test from the first commit so it becomes deterministic-by-contract going forward.
- **Security posture is unchanged and must be stated, not silently assumed.** Per `docs/architecture/SECURITY_MODEL.md`, workspace JSON is already plain and already tamperable; an error log there adds no trust boundary and must not be described as tamper-evident. It deliberately does **not** get `actionLog.ts`'s B5 `previousArchiveHash` chain (`actionLog.ts:76-80, 403-407`) — that chain exists for a governance audit trail whose entries are evidence about people; an error log is diagnostic telemetry about software, and the chain would imply an evidentiary property it does not have.
- The existing 500/100-character truncation limits in `errorLogger.ts:23-25` apply to persisted entries too, unchanged. Error messages in this app can carry `xrayImageId`s and usernames; truncation is the only bound on what reaches disk, and widening it is out of scope for this plan.

---

### Task 1: Ambient error context — page, username, role, with zero new call-site parameters

**Files:**
- Create: `src/data/storage/errorContext.ts`
- Create: `src/data/storage/errorContext.test.ts`
- Modify: `src/App.tsx` (one effect, after `activeTabId` at `App.tsx:224`)
- Modify: `src/app/subTabSelection.ts:31-33` (`setSubTabSelection`)
- Modify: `src/auth/authSession.ts:135-145` (`writeSession`) and `:147-158` (`clearSession`)

**Interfaces:**
- Produces: `setErrorPageTab(tabId)`, `setErrorPageSubTab(parentTabId, subTabId)`, `setErrorActor(username, role)`, `clearErrorActor()`, `readErrorContext(): ErrorContext`, `__resetErrorContextForTests()`.
- Consumes: **nothing.** This module has zero imports, on purpose — it is imported by `errorLogger.ts`, which sits below `safeWrite.ts`, which sits below everything. Any import here risks reintroducing the cycle the sink inversion exists to prevent. Enforce it with a comment and a test that reads the file's own source for an `import` statement.

- [ ] **Step 1: Write the failing tests**

Create `src/data/storage/errorContext.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import {
  __resetErrorContextForTests,
  clearErrorActor,
  readErrorContext,
  setErrorActor,
  setErrorPageSubTab,
  setErrorPageTab,
} from "./errorContext";

beforeEach(() => __resetErrorContextForTests());

describe("errorContext", () => {
  it("reports an unknown page and no actor before anything is set", () => {
    expect(readErrorContext()).toEqual({ page: "unknown", username: null, role: null });
  });

  it("records the active top-level tab as the page", () => {
    setErrorPageTab("population");
    expect(readErrorContext().page).toBe("population");
  });

  it("prefers the sub-tab when it belongs to the active tab", () => {
    setErrorPageTab("population");
    setErrorPageSubTab("population", "browse");
    expect(readErrorContext().page).toBe("population/browse");
  });

  it("ignores a sub-tab recorded for a DIFFERENT parent tab", () => {
    // The rail records a selection per parent tab; a selection made for a tab
    // the user then navigated away from must not mislabel the current page.
    setErrorPageTab("population");
    setErrorPageSubTab("reports", "kpi");
    expect(readErrorContext().page).toBe("population");
  });

  it("drops a stale sub-tab when the top-level tab changes", () => {
    setErrorPageTab("population");
    setErrorPageSubTab("population", "browse");
    setErrorPageTab("reports");
    expect(readErrorContext().page).toBe("reports");
  });

  it("records and clears the actor", () => {
    setErrorActor("bob", "employee");
    expect(readErrorContext()).toMatchObject({ username: "bob", role: "employee" });
    clearErrorActor();
    expect(readErrorContext()).toMatchObject({ username: null, role: null });
  });

  it("has no imports — it is the leaf below errorLogger and must stay one", () => {
    // errorLogger.ts imports this module, and safeWrite.ts imports errorLogger.
    // An import here can therefore close a cycle that vitest (which transpiles
    // per-file) would not catch and `npm run build` would die on. Pinned here so
    // the constraint fails a test rather than a release build.
    const source = readFileSync(new URL("./errorContext.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/^\s*import\s/m);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/data/storage/errorContext.test.ts`
Expected: FAIL — `src/data/storage/errorContext.ts` does not exist yet.

- [ ] **Step 3: Create the module**

Create `src/data/storage/errorContext.ts`:

```ts
/**
 * Ambient "who and where" for the error log.
 *
 * WHY THIS EXISTS AS A SEPARATE MODULE. The owner requirement is that every
 * persisted error carries the page the user was on and the username who hit
 * it. There are 56 modules calling `logError(context, error)` today, and
 * almost none of them are in a position to know either fact: half are in the
 * data layer, below React entirely. Threading two new required arguments
 * through all of them would be a large, mechanical, permanently-load-bearing
 * change for information three modules already hold. So the three that hold it
 * write it here once, and `logError` reads it.
 *
 * ZERO IMPORTS, DELIBERATELY. `errorLogger.ts` imports this file, and
 * `safeWrite.ts` imports `errorLogger.ts` — so this module sits at the very
 * bottom of the data layer. An import here could close a cycle that `vitest`
 * (per-file transpile, no module-graph check) would never surface and that
 * would only fail at `vite build` or at module-eval time in the browser.
 * `errorContext.test.ts` pins the constraint.
 */

export type ErrorContext = {
  /** `"tab"` or `"tab/sub-tab"`, or `"unknown"` before the app has navigated. */
  page: string;
  username: string | null;
  role: string | null;
};

let activeTabId: string | null = null;
let activeSubTab: { parentTabId: string; subTabId: string } | null = null;
let actorUsername: string | null = null;
let actorRole: string | null = null;

/** The active top-level tab. Called from `App.tsx`'s navigation effect. */
export function setErrorPageTab(tabId: string): void {
  if (tabId === activeTabId) return;
  activeTabId = tabId;
  // A sub-tab selection belongs to the tab it was made for; once the user has
  // moved to another tab it no longer describes where they are.
  activeSubTab = null;
}

/**
 * The rail's sub-tab selection. Called from the ONE place that records it
 * (`src/app/subTabSelection.ts`), so this needs no second wiring path.
 */
export function setErrorPageSubTab(parentTabId: string, subTabId: string): void {
  activeSubTab = { parentTabId, subTabId };
}

/** Called on sign-in and session restore (`authSession.writeSession`). */
export function setErrorActor(username: string, role: string): void {
  actorUsername = username;
  actorRole = role;
}

/** Called on sign-out (`authSession.clearSession`). */
export function clearErrorActor(): void {
  actorUsername = null;
  actorRole = null;
}

export function readErrorContext(): ErrorContext {
  const page =
    activeTabId === null
      ? "unknown"
      : activeSubTab !== null && activeSubTab.parentTabId === activeTabId
        ? `${activeTabId}/${activeSubTab.subTabId}`
        : activeTabId;
  return { page, username: actorUsername, role: actorRole };
}

/** @internal — test-only. Module state outlives a render and a test. */
export function __resetErrorContextForTests(): void {
  activeTabId = null;
  activeSubTab = null;
  actorUsername = null;
  actorRole = null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/data/storage/errorContext.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the three writers**

In `src/App.tsx`, add the import alongside the other data-layer imports:

```ts
import { setErrorPageTab } from "./data/storage/errorContext";
```

`App.tsx:224` currently reads:

```tsx
  const activeTabId = activeTab?.id ?? "";
  const tabScrollPositions = useRef(new Map<string, number>());
```

Add an effect immediately after that pair (before the existing scroll-restore effect at `App.tsx:226-237`):

```tsx
  const activeTabId = activeTab?.id ?? "";
  const tabScrollPositions = useRef(new Map<string, number>());

  // Tell the error log where the user is, so an error logged from anywhere in
  // the tree — including the data layer, which has no React context — is
  // attributed to the page that produced it. See errorContext.ts.
  useEffect(() => {
    if (activeTabId) setErrorPageTab(activeTabId);
  }, [activeTabId]);
```

In `src/app/subTabSelection.ts`, add the import and one line inside the existing `setSubTabSelection` (`:31-33`):

```ts
export function setSubTabSelection(parentTabId: string, subTabId: string): void {
  selectionByTabId.set(parentTabId, subTabId);
}
```

becomes:

```ts
export function setSubTabSelection(parentTabId: string, subTabId: string): void {
  selectionByTabId.set(parentTabId, subTabId);
  // Same fact, second consumer: the error log needs page granularity down to
  // the sub-tab, and this is already the single place the rail's selection is
  // recorded (Sidebar.tsx:155 and WorkspaceGate.tsx:539 both route through it).
  setErrorPageSubTab(parentTabId, subTabId);
}
```

with, at the top of the file:

```ts
import { setErrorPageSubTab } from "../data/storage/errorContext";
```

In `src/auth/authSession.ts`, add `setErrorActor`/`clearErrorActor` to the imports and call them from the two existing functions. `writeSession` (`:135-145`) gains one line before `startAuthActivitySession(session)`:

```ts
  setErrorActor(session.username, session.role);
  startAuthActivitySession(session);
```

and `clearSession` (`:147-158`) gains one line next to the existing `clearSubTabSelections()`:

```ts
  clearSubTabSelections();
  // The next user on this page load must not inherit the previous one's name
  // on their errors — same reasoning as the sub-tab reset above.
  clearErrorActor();
```

Note `readSession()` (`:126-133`) swaps in an admin's **preview** role while keeping the real username. `writeSession` is the only writer and is called with the REAL session, so the error log records the real identity and the real role — matching `actionLog`'s documented rule that "actions remain attributed to the actual admin" (`AuthGate.tsx:685-687`). Do not switch this to `readSession()`.

- [ ] **Step 6: Run the gates**

Run: `npm run test:run && npm run typecheck && npm run lint && npm run build`
Expected: all green. `App.tsx`, `subTabSelection.test.tsx` and the auth session tests all keep their existing assertions — the three additions are pure side-effect writes into a module that nothing else reads yet.

- [ ] **Step 7: Edit log, then commit**

```bash
npm run editlog -- --tier=2 --append "Add (error-log): ambient page/actor context for error attribution"
git add src/data/storage/errorContext.ts src/data/storage/errorContext.test.ts src/App.tsx src/app/subTabSelection.ts src/auth/authSession.ts "docs/edit logs/2026-08-24.md" package.json
git commit -m "Add (error-log): ambient page/actor context so logError can attribute errors without touching 56 call sites" -- src/data/storage/errorContext.ts src/data/storage/errorContext.test.ts src/App.tsx src/app/subTabSelection.ts src/auth/authSession.ts "docs/edit logs/2026-08-24.md" package.json
```

---

### Task 2: Extend `ErrorEntry`, add the sink hook, keep every existing caller unchanged

**Files:**
- Modify: `src/data/storage/errorLogger.ts` (whole file, 152 lines)
- Modify: `src/data/storage/errorCodes.ts:659-668` (`logCodedError`)
- Modify: `src/data/storage/errorLogger.test.ts`
- Modify: `src/data/storage/storageRegistry.ts` (the `xray_error_log_v1` purpose text)

**Interfaces:**
- Consumes: `readErrorContext` from Task 1.
- Produces: `ErrorEntry` gains four optional fields (`page`, `action`, `errorCode`, `username`, `role`). `logError(context, error, meta?)` — the third parameter is optional and every existing call is untouched. `registerErrorSink(sink: ErrorSink | null): void` and `__resetErrorSinkForTests()`. `getRecentErrors()` and `clearErrors()` unchanged.

- [ ] **Step 1: Write the failing tests**

Add to `src/data/storage/errorLogger.test.ts` (read the file first — it already exercises truncation, hydration and the `restored` flag; the new tests must coexist with its `localStorage` fixture setup, and every one of them must reset both the context and the sink in `beforeEach`):

```ts
import { __resetErrorContextForTests, setErrorActor, setErrorPageTab } from "./errorContext";
import { __resetErrorSinkForTests, registerErrorSink } from "./errorLogger";

describe("errorLogger — enriched entries and the persistence sink", () => {
  beforeEach(() => {
    clearErrors();
    __resetErrorContextForTests();
    __resetErrorSinkForTests();
  });

  it("stamps the ambient page and actor onto a plain two-argument logError call", () => {
    setErrorPageTab("population");
    setErrorActor("bob", "employee");

    logError("population:save", new Error("boom"));

    const [entry] = getRecentErrors();
    expect(entry).toMatchObject({
      context: "population:save",
      message: "boom",
      page: "population",
      username: "bob",
      role: "employee",
    });
  });

  it("defaults `action` to the context string, which already names the operation", () => {
    logError("datatable:export", new Error("boom"));
    expect(getRecentErrors()[0].action).toBe("datatable:export");
  });

  it("lets an opt-in caller override the action without changing anything else", () => {
    logError("population:save", new Error("boom"), { action: "حفظ المجتمع الإحصائي" });
    const [entry] = getRecentErrors();
    expect(entry.action).toBe("حفظ المجتمع الإحصائي");
    expect(entry.context).toBe("population:save");
  });

  it("recovers the error code from the [XQ-...] suffix logCodedError already appends", () => {
    logError("casLoop:exhausted [XQ-IO-032]", new Error("boom"));
    expect(getRecentErrors()[0].errorCode).toBe("XQ-IO-032");
  });

  it("prefers an explicitly supplied code over the suffix parse", () => {
    logError("x [XQ-IO-032]", new Error("boom"), { errorCode: "XQ-WS-006" });
    expect(getRecentErrors()[0].errorCode).toBe("XQ-WS-006");
  });

  it("leaves errorCode undefined when there is no code to be had", () => {
    logError("population:save", new Error("boom"));
    expect(getRecentErrors()[0].errorCode).toBeUndefined();
  });

  it("hands each entry to a registered sink", () => {
    const seen: ErrorEntry[] = [];
    registerErrorSink((entry) => { seen.push(entry); });

    logError("a", new Error("one"));
    logError("b", new Error("two"));

    expect(seen.map((e) => e.message)).toEqual(["one", "two"]);
  });

  it("never lets a throwing sink reach the caller that reported the original error", () => {
    registerErrorSink(() => { throw new Error("sink exploded"); });
    expect(() => logError("a", new Error("one"))).not.toThrow();
    // The ring buffer — the thing the caller actually depends on — is intact.
    expect(getRecentErrors()).toHaveLength(1);
  });

  it("does not re-enter the sink for an error the sink itself logged", () => {
    let depth = 0;
    let maxDepth = 0;
    registerErrorSink(() => {
      depth += 1;
      maxDepth = Math.max(maxDepth, depth);
      logError("sink:self", new Error("recursive"));
      depth -= 1;
    });

    logError("a", new Error("one"));

    // Without the suppression guard this recurses until the stack blows.
    expect(maxDepth).toBe(1);
  });

  it("unregisters cleanly", () => {
    const seen: ErrorEntry[] = [];
    registerErrorSink((entry) => { seen.push(entry); });
    registerErrorSink(null);
    logError("a", new Error("one"));
    expect(seen).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/data/storage/errorLogger.test.ts`
Expected: FAIL — compile errors (`registerErrorSink` and the third `logError` argument do not exist) plus every field assertion.

- [ ] **Step 3: Extend `ErrorEntry`**

In `src/data/storage/errorLogger.ts`, `:1-13` currently reads:

```ts
export type ErrorEntry = {
  context: string;
  message: string;
  timestamp: string;
  /** Optional stack trace, present only when the logged error carried one. */
  stack?: string;
  /**
   * True only for an entry hydrated from localStorage at module init (a ring
   * carried over from a previous tab/session), never set on an entry logged
   * within the current module lifetime.
   */
  restored?: boolean;
};
```

Replace with:

```ts
export type ErrorEntry = {
  context: string;
  message: string;
  timestamp: string;
  /** Optional stack trace, present only when the logged error carried one. */
  stack?: string;
  /**
   * Every field below is OPTIONAL on purpose. They are filled from the ambient
   * `errorContext` and from the context string itself, so all 56 existing
   * `logError(context, error)` call sites keep working verbatim — and an entry
   * hydrated from an older localStorage ring, which predates these fields
   * entirely, stays a valid ErrorEntry.
   */
  /** Active tab, or `tab/sub-tab`. `errorContext.readErrorContext().page`. */
  page?: string;
  /** What was being attempted. Defaults to `context`, which already names it. */
  action?: string;
  /** `XQ-AREA-NNN`, when the throw site tagged one or logCodedError supplied it. */
  errorCode?: string;
  /** Signed-in username at the time. Absent on the sign-in screen. */
  username?: string;
  /** That user's REAL role — never an admin's previewed role. */
  role?: string;
  /**
   * True only for an entry hydrated from localStorage at module init (a ring
   * carried over from a previous tab/session), never set on an entry logged
   * within the current module lifetime.
   */
  restored?: boolean;
};

/**
 * Optional, opt-in enrichment for a single `logError` call.
 *
 * Nothing requires it. `action` is worth supplying at a call site whose
 * `context` string is terse and whose failure an admin will read out of an
 * Excel export months later; `errorCode` is supplied by `logCodedError` only.
 */
export type ErrorLogMeta = {
  action?: string;
  errorCode?: string;
};

/**
 * Durable persistence hook. `errorLogger` cannot import the workspace layer —
 * `safeWrite.ts` imports THIS module, so the edge back is a cycle — so the
 * persisted error log (`src/data/errorLog/`) registers itself here instead.
 *
 * A sink is called synchronously with each new entry and must return
 * immediately (queue, do not await). It must never throw; this module catches
 * anyway, because a logging side-channel breaking the call site that reported
 * the original error is the one failure mode this module exists to prevent.
 */
export type ErrorSink = (entry: ErrorEntry) => void;
```

- [ ] **Step 4: Add the sink, the suppression guard, and the enrichment**

Add the import at the top of `errorLogger.ts` (this is the module's only import, and `errorContext.ts` has none of its own — see Task 1):

```ts
import { readErrorContext } from "./errorContext";
```

Add, next to the existing `isPersisting` guard (`errorLogger.ts:27-33`):

```ts
const entries: ErrorEntry[] = [];

let sink: ErrorSink | null = null;

// Depth counter, not a boolean: the sink may itself call into code that logs,
// which may log again. `isPersisting` above guards the localStorage mirror
// against exactly one level of recursion; this guards the sink against any
// number. While it is non-zero, entries still land in the ring buffer (the
// caller's guarantee) but are NOT handed to the sink — otherwise an error
// raised while writing the error log queues another error to write, forever.
let suppressDepth = 0;

/** Install (or, with `null`, remove) the durable persistence sink. */
export function registerErrorSink(next: ErrorSink | null): void {
  sink = next;
}

/** @internal — test-only. Module state outlives a test file's `beforeEach`. */
export function __resetErrorSinkForTests(): void {
  sink = null;
  suppressDepth = 0;
}

// Matches the `[XQ-AREA-NNN]` suffix that `logCodedError` (errorCodes.ts:659)
// appends to its context string. Parsed rather than imported: errorCodes.ts
// imports THIS module, so reading `resolveErrorCode` from here is a cycle.
const CODE_SUFFIX_PATTERN = /\[(XQ-[A-Z]+-\d{3})\]\s*$/;

function codeFromContext(context: string): string | undefined {
  return CODE_SUFFIX_PATTERN.exec(context)?.[1];
}
```

Then replace `logError` (`errorLogger.ts:113-127`):

```ts
export function logError(context: string, error: unknown): void {
  const message =
    error instanceof Error ? error.message : String(error ?? "unknown error");
  const stack = error instanceof Error ? error.stack : undefined;

  entries.push({
    context: truncate(context, MAX_CONTEXT_LENGTH),
    message: truncate(message, MAX_MESSAGE_LENGTH),
    timestamp: new Date().toISOString(),
    ...(stack !== undefined ? { stack: truncate(stack, MAX_STACK_LENGTH) } : {})
  });
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);

  persistToStorage();
}
```

with:

```ts
export function logError(context: string, error: unknown, meta?: ErrorLogMeta): void {
  const message =
    error instanceof Error ? error.message : String(error ?? "unknown error");
  const stack = error instanceof Error ? error.stack : undefined;
  const safeContext = truncate(context, MAX_CONTEXT_LENGTH);
  const { page, username, role } = readErrorContext();
  const errorCode = meta?.errorCode ?? codeFromContext(safeContext);

  const entry: ErrorEntry = {
    context: safeContext,
    message: truncate(message, MAX_MESSAGE_LENGTH),
    timestamp: new Date().toISOString(),
    ...(stack !== undefined ? { stack: truncate(stack, MAX_STACK_LENGTH) } : {}),
    page,
    // The context string already IS the action label at every existing call
    // site ("audit:append", "datatable:export", "population:save"), so this
    // default is honest rather than a placeholder — and it is what makes the
    // owner's "what was being attempted" requirement land on all 56 of them
    // without editing any.
    action: truncate(meta?.action ?? safeContext, MAX_CONTEXT_LENGTH),
    ...(errorCode !== undefined ? { errorCode } : {}),
    ...(username !== null ? { username } : {}),
    ...(role !== null ? { role } : {})
  };

  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);

  persistToStorage();

  // Last, and fenced off. Everything above is the contract this module has
  // always kept; nothing the sink does may be allowed to undo it.
  if (sink === null || suppressDepth > 0) return;
  suppressDepth += 1;
  try {
    sink(entry);
  } catch {
    // A durable-persistence failure is not the caller's problem, and it must
    // not be logged through this module either — that is the recursion the
    // suppressDepth counter above already blocks, and re-raising it here would
    // be a second way in.
  } finally {
    suppressDepth -= 1;
  }
}
```

- [ ] **Step 5: Have `logCodedError` supply the code explicitly**

In `src/data/storage/errorCodes.ts:659-668`:

```ts
export function logCodedError(
  context: string,
  code: ErrorCode,
  error?: unknown
): void {
  logError(
    `${context} [${code}]`,
    error === undefined ? new Error(errorCodeMeaning(code)) : error
  );
}
```

becomes:

```ts
export function logCodedError(
  context: string,
  code: ErrorCode,
  error?: unknown
): void {
  logError(
    `${context} [${code}]`,
    error === undefined ? new Error(errorCodeMeaning(code)) : error,
    // Explicit, even though errorLogger can also recover this from the `[...]`
    // suffix above. The suffix parse is the fallback for entries that reach the
    // ring by another route (an already-formatted context, a hydrated legacy
    // entry); here the code is known for certain, so say so.
    { errorCode: code }
  );
}
```

The context string keeps the `[CODE]` suffix: `ErrorLogSection` renders `[{e.context}]` verbatim (`ErrorLogSection.tsx:95`) and existing tests and support workflows read the code from there. Removing it would be a user-visible regression for a cosmetic gain.

- [ ] **Step 6: Update the storage-registry description**

In `src/data/storage/storageRegistry.ts`, the `xray_error_log_v1` entry's `purpose` currently reads:

```ts
    purpose: "Mirror of the in-memory error ring buffer (errorLogger.ts), so it survives a reload.",
    lossConsequence: "Recent-error history is lost; the app keeps working with an empty log.",
```

becomes:

```ts
    purpose:
      "Mirror of the in-memory error ring buffer (errorLogger.ts), so it survives a reload. Since v116 this is the LOCAL copy only — the durable fleet-wide record lives in the workspace at 5-system/system-errors/ (src/data/errorLog/).",
    lossConsequence:
      "Recent-error history for THIS browser is lost; the app keeps working with an empty local ring and the workspace copy is untouched.",
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/data/storage/errorLogger.test.ts src/data/storage/errorCodes.test.ts src/data/storage/storageRegistry.test.ts`
Expected: PASS. `errorCodes.test.ts` pins the code→meaning map, which is untouched. If a storage-registry test asserts exact `purpose` text, update the expected string in the same commit — that is a deliberate copy change, not a silent deletion.

- [ ] **Step 8: Run the gates**

Run: `npm run test:run && npm run typecheck && npm run lint && npm run build`
Expected: all green across the whole suite. Pay attention to `ErrorLogSection.test.tsx` — it calls `logError` directly and asserts on rendered rows; the added fields are not rendered yet, so it must stay green untouched. If it does not, the enrichment leaked into the rendered output and the change is wrong.

- [ ] **Step 9: Edit log, then commit**

```bash
npm run editlog -- --tier=2 --append "Add (error-log): page/action/code/user fields on ErrorEntry plus a persistence sink hook"
git add src/data/storage/errorLogger.ts src/data/storage/errorLogger.test.ts src/data/storage/errorCodes.ts src/data/storage/storageRegistry.ts "docs/edit logs/2026-08-24.md" package.json
git commit -m "Add (error-log): enrich ErrorEntry with page/action/code/user and add a sink hook, with no call-site changes" -- src/data/storage/errorLogger.ts src/data/storage/errorLogger.test.ts src/data/storage/errorCodes.ts src/data/storage/storageRegistry.ts "docs/edit logs/2026-08-24.md" package.json
```

---

### Task 3: Workspace path and per-actor file naming

**Files:**
- Modify: `src/data/workspace/workspacePaths.ts:27-43` (`SYSTEM_FOLDER_NAMES`) and after `:580-592` (`getAuditActionsDir`)
- Modify: `src/data/workspace/workspacePaths.test.ts`
- Create: `src/data/errorLog/errorLogPaths.ts`
- Create: `src/data/errorLog/errorLogPaths.test.ts`

**Interfaces:**
- Consumes: `getChildDir`, `getSystemRoot`, `WORKSPACE_ROOTS`, `SYSTEM_FOLDER_NAMES` (all pre-existing in `workspacePaths.ts`); `auditUserStem` from `src/data/audit/auditPaths.ts:42-44`.
- Produces: `SYSTEM_FOLDER_NAMES.systemErrors = "system-errors"`; `getSystemErrorsDir(directoryHandle, create)`; `ERRORS_FILE_SUFFIX`, `errorsFileName(username)`, `errorsArchiveFileName(username, year)`, `isErrorsArchiveFileName(fileName, year)`.

- [ ] **Step 1: Write the failing tests**

Create `src/data/errorLog/errorLogPaths.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  ERRORS_FILE_SUFFIX,
  errorsArchiveFileName,
  errorsFileName,
  isErrorsArchiveFileName,
} from "./errorLogPaths";

describe("errorLogPaths", () => {
  it("gives each user a distinct stem", () => {
    expect(errorsFileName("alice")).not.toBe(errorsFileName("bob"));
  });

  it("is stable for the same name", () => {
    expect(errorsFileName("alice")).toBe(errorsFileName("alice"));
  });

  it("separates two names that sanitize identically", () => {
    // safeWorkspaceFilePart maps both `a/b` and `a\b` to `a_b`; the hashed
    // suffix is what keeps them in different files. Same reasoning as
    // auditPaths.ts:34-41 — a collision here silently restores the
    // two-writers-one-file contention this whole layout exists to remove.
    expect(errorsFileName("a/b")).not.toBe(errorsFileName("a\\b"));
  });

  it("keeps the live suffix and the archive suffix disjoint", () => {
    // The year sits between `.errors` and `.json`, so an archive filename does
    // NOT end with the live suffix — which is what lets one readJsonDirectory
    // call list live files without a second predicate. A `.includes()` here
    // would fold every archive into the live log. Same trap as
    // auditPaths.ts:57-65.
    const archive = errorsArchiveFileName("alice", 2026);
    expect(archive.endsWith(ERRORS_FILE_SUFFIX)).toBe(false);
    expect(errorsFileName("alice").endsWith(ERRORS_FILE_SUFFIX)).toBe(true);
    expect(isErrorsArchiveFileName(archive, 2026)).toBe(true);
    expect(isErrorsArchiveFileName(archive, 2025)).toBe(false);
    expect(isErrorsArchiveFileName(errorsFileName("alice"), 2026)).toBe(false);
  });
});
```

Add to `src/data/workspace/workspacePaths.test.ts` (match the file's existing style — read it first):

```ts
it("resolves 5-system/system-errors/ and creates it on demand", async () => {
  const root = createMemoryDirectory("root");
  const dir = await getSystemErrorsDir(root, true);
  expect(dir.name).toBe("system-errors");

  const system = await root.getDirectoryHandle("5-system", { create: false });
  await expect(system.getDirectoryHandle("system-errors", { create: false })).resolves.toBeDefined();
});

it("rejects rather than creating when getSystemErrorsDir is called with create=false on an empty workspace", async () => {
  const root = createMemoryDirectory("root");
  await expect(getSystemErrorsDir(root, false)).rejects.toThrow();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/data/errorLog/errorLogPaths.test.ts src/data/workspace/workspacePaths.test.ts`
Expected: FAIL — neither `errorLogPaths.ts` nor `getSystemErrorsDir` exists.

- [ ] **Step 3: Add the workspace folder and its resolver**

In `src/data/workspace/workspacePaths.ts`, add to `SYSTEM_FOLDER_NAMES` (`:27-43`), after `adhocImports`:

```ts
  adhocImports: "adhoc-imports",
  /**
   * Persistent error log (owner requirement, 2026-08-24): one
   * `{stem}.errors.json` per user plus per-user per-year archives, written by
   * `src/data/errorLog/`. Deliberately NOT under `audit/` — the audit trail
   * records what PEOPLE deliberately did and is governance evidence; this
   * records what the SOFTWARE failed to do and is diagnostics. Mixing them
   * would put a 6,500-entries-a-month telemetry stream inside the folder an
   * auditor reads, and would drag the audit log's B5 hash-chain semantics onto
   * data that does not warrant them.
   */
  systemErrors: "system-errors",
} as const;
```

Add the resolver directly after `getAuditActionsDir` (`:580-592`):

```ts
/**
 * `5-system/system-errors/` — one `{stem}.errors.json` per user, plus per-user
 * yearly archives. Resolved through `getChildDir` for the same two reasons
 * `getAuditRoot` documents: the handle is cached (no re-walk per write) and the
 * path is registered with `registerDirectoryPath`, so `withResourceLock` keys
 * stay path-qualified instead of degrading to the bare leaf name.
 */
export async function getSystemErrorsDir(
  directoryHandle: DirectoryHandleLike,
  create = true
): Promise<DirectoryHandleLike> {
  return getChildDir(
    directoryHandle,
    WORKSPACE_ROOTS.system,
    () => getSystemRoot(directoryHandle, create),
    SYSTEM_FOLDER_NAMES.systemErrors,
    create,
    null
  );
}
```

The trailing `null` is the legacy-name slot; there is no legacy layout for this folder — it has never existed before — so it is deliberately `null`, matching `getNotificationsDir` and `getAdhocImportsDir`.

- [ ] **Step 4: Create `errorLogPaths.ts`**

Create `src/data/errorLog/errorLogPaths.ts`:

```ts
/**
 * File naming for the PER-USER persistent error logs.
 *
 * Deliberately reuses `auditUserStem` rather than reimplementing it: the
 * collision property it provides (two usernames that sanitize alike still get
 * distinct files) is the whole reason the per-writer layout is safe, and having
 * two independent implementations of it is how they drift apart.
 *
 * Same renames-and-deletion doctrine as `auditPaths.ts:19-26`: these files are
 * NOT part of `getUserWorkspaceFootprint`, so they neither block a username
 * rename nor get destroyed by a user deletion. An error is history keyed to the
 * name that was in force when it happened.
 */

import { auditUserStem } from "../audit/auditPaths";

export const ERRORS_FILE_SUFFIX = ".errors.json";

export function errorsFileName(username: string): string {
  return `${auditUserStem(username)}${ERRORS_FILE_SUFFIX}`;
}

/**
 * Per-user per-year archive of entries evicted from that user's live log.
 *
 * Note the suffix arithmetic that keeps the two listings in `system-errors/`
 * disjoint with no second predicate:
 *   `"bob-1a2b3c.errors.2026.json".endsWith(ERRORS_FILE_SUFFIX) === false`
 * — the year sits between `.errors` and `.json`. A `.includes()` in the reader
 * would silently fold every archive into the live log; pinned by a test.
 */
export function errorsArchiveFileName(username: string, year: number): string {
  return `${auditUserStem(username)}.errors.${year}.json`;
}

/** True for `{stem}.errors.{year}.json`, false for `{stem}.errors.json`. */
export function isErrorsArchiveFileName(fileName: string, year: number): boolean {
  return fileName.endsWith(`.errors.${year}.json`);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/data/errorLog/errorLogPaths.test.ts src/data/workspace/workspacePaths.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the gates**

Run: `npm run test:run && npm run typecheck && npm run lint && npm run build`
Expected: all green. `workspaceSchema.ts` only *detects* layout and stamps a brand-new workspace — adding a folder name to `SYSTEM_FOLDER_NAMES` does not make it required. Confirm: `SYSTEM_SUBFOLDERS` in `fileSystemAccess.ts` (used by `checkWorkspaceStructure`) is a **separate** constant; do not add `system-errors` to it. An existing workspace without the folder must keep reporting a healthy structure, and the folder is created lazily on first write.

- [ ] **Step 7: Edit log, then commit**

```bash
npm run editlog -- --tier=2 --append "Add (error-log): 5-system/system-errors/ root and per-user file naming"
git add src/data/workspace/workspacePaths.ts src/data/workspace/workspacePaths.test.ts src/data/errorLog/errorLogPaths.ts src/data/errorLog/errorLogPaths.test.ts "docs/edit logs/2026-08-24.md" package.json
git commit -m "Add (error-log): 5-system/system-errors/ workspace root and collision-resistant per-user file naming" -- src/data/workspace/workspacePaths.ts src/data/workspace/workspacePaths.test.ts src/data/errorLog/errorLogPaths.ts src/data/errorLog/errorLogPaths.test.ts "docs/edit logs/2026-08-24.md" package.json
```

---

### Task 4: The persisted store — per-actor CAS writes and archive-at-N (TIER 3, defines the on-disk format)

**Files:**
- Create: `src/data/errorLog/errorLogTypes.ts`
- Create: `src/data/errorLog/errorLogStorage.ts`
- Create: `src/data/errorLog/errorLogStorage.test.ts`

**Interfaces:**
- Consumes: `casLoop` (`src/data/storage/casLoop.ts`), `withResourceLock` (`webLocks.ts`), `safeWriteJson`/`readOptionalJson` (`safeWrite.ts:1614`/`:2189`), `readJsonDirectory` (`directoryScan.ts:169-181`), `getSystemErrorsDir` + `errorsFileName`/`errorsArchiveFileName`/`ERRORS_FILE_SUFFIX` (Task 3), `logError` **only for its own internal failures, and only via a context string this module's own sink is taught to ignore** — see the recursion note in Step 3.
- Produces: `appendUserErrors(directoryHandle, username, entries): Promise<void>` (best-effort, never throws), `readAllWorkspaceErrors(directoryHandle): Promise<PersistedErrorEntry[]>`, `readWorkspaceErrorArchive(directoryHandle, year)`, `__setMaxErrorEntriesForTests` / `__resetMaxErrorEntriesForTests`.

- [ ] **Step 1: Define the persisted shapes**

Create `src/data/errorLog/errorLogTypes.ts`:

```ts
/**
 * The on-disk shape of the persistent error log.
 *
 * SCHEMA CONTRACT. Every field below is written by `errorLogStorage.ts` and
 * read by `errorLogExport.ts` and the Settings viewer. Adding an optional field
 * is safe; removing or repurposing one is not — an existing workspace's files
 * are never migrated (see the rollback note in this task's edit-log entry), so
 * a reader must always tolerate an older file that lacks a newer field.
 */

/** One recorded error, as persisted. Mirrors ErrorEntry plus identity/ordering. */
export type PersistedErrorEntry = {
  /** `err-<uuid>`. Dedup key for archive idempotence and cross-file merge. */
  id: string;
  /** ISO timestamp, taken from the ErrorEntry that produced this. */
  at: string;
  /** The signed-in user who hit it. `"unknown"` only if somehow unset. */
  username: string;
  /** That user's REAL role at the time — never an admin's previewed role. */
  role?: string;
  /** Active tab, or `tab/sub-tab`, or `"unknown"`. */
  page: string;
  /** What was being attempted (defaults to `context` — see errorLogger.ts). */
  action: string;
  /** The `module:operation` label the call site passed to logError. */
  context: string;
  message: string;
  /** `XQ-AREA-NNN` when known. */
  errorCode?: string;
  /** Truncated at MAX_STACK_LENGTH (500) by errorLogger before it gets here. */
  stack?: string;
};

/** ONE user's own live log — the only live shape this module ever writes. */
export type UserErrorLogFile = {
  /** RAW, unsanitized username. Informational; entries carry their own. */
  username: string;
  revision: number;
  /** Per-write UUID embedded by casLoop for cross-machine race detection. */
  _writeToken?: string;
  updatedAt: string;
  /**
   * Live entries. Capped at `maxErrorEntries`: on overflow the oldest are
   * appended to a per-year archive BEFORE being trimmed here — never dropped
   * without archiving. Archive failure blocks the trim.
   */
  entries: PersistedErrorEntry[];
};

/**
 * Per-year archive of entries evicted from a user's live log.
 *
 * NO `previousArchiveHash`. `actionLog`'s archives carry a djb2 chain link (B5)
 * because they are governance evidence about people and a tamper-EVIDENT
 * property is worth something there. This log is diagnostics about software;
 * adding the chain would imply an evidentiary guarantee the security model
 * (docs/architecture/SECURITY_MODEL.md) explicitly does not make, and would
 * cost a second read per archive write on a shared SMB folder for it.
 */
export type ErrorLogArchiveFile = {
  year: number;
  revision: number;
  updatedAt: string;
  entries: PersistedErrorEntry[];
};
```

- [ ] **Step 2: Write the failing tests**

Create `src/data/errorLog/errorLogStorage.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { errorsArchiveFileName, errorsFileName } from "./errorLogPaths";
import type { PersistedErrorEntry } from "./errorLogTypes";
import {
  __resetMaxErrorEntriesForTests,
  __setMaxErrorEntriesForTests,
  appendUserErrors,
  readAllWorkspaceErrors,
  readWorkspaceErrorArchive,
} from "./errorLogStorage";

afterEach(() => __resetMaxErrorEntriesForTests());

function entry(overrides: Partial<PersistedErrorEntry> = {}): PersistedErrorEntry {
  return {
    id: `err-${Math.random().toString(36).slice(2)}`,
    at: "2026-08-24T10:00:00.000Z",
    username: "alice",
    role: "employee",
    page: "population/browse",
    action: "population:save",
    context: "population:save",
    message: "boom",
    ...overrides,
  };
}

function root(): DirectoryHandleLike {
  return createMemoryDirectory("root");
}

describe("errorLogStorage", () => {
  it("writes one file per user and nothing shared", async () => {
    const dir = root();
    await appendUserErrors(dir, "alice", [entry({ username: "alice" })]);
    await appendUserErrors(dir, "bob", [entry({ username: "bob" })]);

    const system = await dir.getDirectoryHandle("5-system", { create: false });
    const errors = await system.getDirectoryHandle("system-errors", { create: false });
    await expect(errors.getFileHandle(errorsFileName("alice"), { create: false })).resolves.toBeDefined();
    await expect(errors.getFileHandle(errorsFileName("bob"), { create: false })).resolves.toBeDefined();
    // Nothing writes a shared file: that is the entire point of the layout.
    await expect(errors.getFileHandle("errors.log.json", { create: false })).rejects.toThrow();
  });

  it("appends rather than replacing across calls", async () => {
    const dir = root();
    await appendUserErrors(dir, "alice", [entry({ id: "err-1" })]);
    await appendUserErrors(dir, "alice", [entry({ id: "err-2" })]);

    const all = await readAllWorkspaceErrors(dir);
    expect(all.map((e) => e.id).sort()).toEqual(["err-1", "err-2"]);
  });

  it("writes a whole batch in ONE file write, not one per entry", async () => {
    // The sink batches precisely so a burst of errors is one SMB round trip.
    // A per-entry implementation would still pass the assertion above.
    const dir = root();
    await appendUserErrors(dir, "alice", [
      entry({ id: "err-1" }),
      entry({ id: "err-2" }),
      entry({ id: "err-3" }),
    ]);
    const all = await readAllWorkspaceErrors(dir);
    expect(all).toHaveLength(3);
    // Revision advanced exactly once for the batch.
    const system = await dir.getDirectoryHandle("5-system", { create: false });
    const errors = await system.getDirectoryHandle("system-errors", { create: false });
    const handle = await errors.getFileHandle(errorsFileName("alice"), { create: false });
    const text = await (await handle.getFile()).text();
    expect(JSON.parse(text).data.revision).toBe(1);
  });

  it("merges every user's file on an aggregate read, oldest first", async () => {
    const dir = root();
    await appendUserErrors(dir, "alice", [entry({ id: "a", at: "2026-08-24T09:00:00.000Z" })]);
    await appendUserErrors(dir, "bob", [entry({ id: "b", at: "2026-08-24T08:00:00.000Z", username: "bob" })]);

    const all = await readAllWorkspaceErrors(dir);
    expect(all.map((e) => e.id)).toEqual(["b", "a"]);
  });

  it("archives the oldest overflow BEFORE trimming the live file", async () => {
    __setMaxErrorEntriesForTests(3);
    const dir = root();
    for (const id of ["e1", "e2", "e3", "e4", "e5"]) {
      await appendUserErrors(dir, "alice", [entry({ id })]);
    }

    const live = await readAllWorkspaceErrors(dir);
    expect(live.map((e) => e.id)).toEqual(["e3", "e4", "e5"]);

    const archived = await readWorkspaceErrorArchive(dir, 2026);
    expect(archived.map((e) => e.id).sort()).toEqual(["e1", "e2"]);
  });

  it("archives idempotently by entry id, so a retry cannot double-append", async () => {
    __setMaxErrorEntriesForTests(2);
    const dir = root();
    await appendUserErrors(dir, "alice", [entry({ id: "e1" }), entry({ id: "e2" }), entry({ id: "e3" })]);
    await appendUserErrors(dir, "alice", [entry({ id: "e4" })]);

    const archived = await readWorkspaceErrorArchive(dir, 2026);
    expect(archived.map((e) => e.id)).toEqual([...new Set(archived.map((e) => e.id))]);
  });

  it("keeps a live file over cap rather than dropping entries when archiving fails", async () => {
    // Archive failure must BLOCK the trim — an entry that was never archived
    // must never be discarded. Same contract as actionLog.ts:466-475.
    __setMaxErrorEntriesForTests(1);
    const dir = root();
    await appendUserErrors(dir, "alice", [entry({ id: "e1" })]);

    // Make the archive filename unwritable, leaving the live file writable.
    const system = await dir.getDirectoryHandle("5-system", { create: false });
    const errors = await system.getDirectoryHandle("system-errors", { create: false });
    setSimulatedFaults(errors, [
      { operation: "createWritable", fileName: errorsArchiveFileName("alice", 2026), error: "NotAllowedError" },
    ]);

    await appendUserErrors(dir, "alice", [entry({ id: "e2" })]);

    const live = await readAllWorkspaceErrors(dir);
    expect(live.map((e) => e.id).sort()).toEqual(["e1", "e2"]);
  });

  it("never throws to its caller when the workspace cannot be written", async () => {
    const dir = createMemoryDirectory("root", { initialWritePermission: "denied" });
    await expect(appendUserErrors(dir, "alice", [entry()])).resolves.toBeUndefined();
  });

  it("returns an empty list rather than throwing when the folder does not exist", async () => {
    await expect(readAllWorkspaceErrors(root())).resolves.toEqual([]);
  });

  it("skips an unreadable per-user file instead of losing every other user's history", async () => {
    const dir = root();
    await appendUserErrors(dir, "alice", [entry({ id: "a" })]);
    await appendUserErrors(dir, "bob", [entry({ id: "b", username: "bob" })]);

    const system = await dir.getDirectoryHandle("5-system", { create: false });
    const errors = await system.getDirectoryHandle("system-errors", { create: false });
    const handle = await errors.getFileHandle(errorsFileName("bob"), { create: true });
    const writable = await handle.createWritable!();
    await writable.write("{ not json");
    await writable.close();

    const all = await readAllWorkspaceErrors(dir);
    expect(all.map((e) => e.id)).toEqual(["a"]);
  });
});
```

Import `setSimulatedFaults` from `../storage/memoryDirectory` alongside `createMemoryDirectory`. **Check `SimulatedFault`'s exact shape at `memoryDirectory.ts:75` before writing that test** and adapt the literal to it — the field names above are indicative, not verified.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/data/errorLog/errorLogStorage.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 4: Implement `errorLogStorage.ts`**

Create `src/data/errorLog/errorLogStorage.ts`, modelled line-for-line on `actionLog.ts:378-508` and `:568-600`. Key points the implementation must honour:

```ts
/**
 * Persistent, workspace-wide error log — per-user files, never a shared one.
 *
 * WHY PER-USER. `auditPaths.ts:5-14` measured what a single shared file costs
 * on this app's actual SMB deployment: the activity log alone took 483
 * whole-file rewrites per employee per shift, and one bad writer's failure was
 * every writer's failure. An error log is worse on both axes — it writes
 * exactly when the workspace is already misbehaving, and a storm hits every
 * client at once. Each user writes only `{stem}.errors.json`; two machines
 * never target the same entry.
 *
 * WHY THE RETRY LADDER IS 6 x 100 ms. Copied verbatim from `actionLog.ts:497-499`,
 * which records why: the 4 x 50 ms it replaced "was the shortest ladder in the
 * app and not a ladder at all on a contended SMB entry". That tuning was paid
 * for once; do not re-derive it.
 *
 * BEST-EFFORT BY CONTRACT. `appendUserErrors` never throws and never rejects.
 * Its own internal failures are reported through `logError` under the
 * `errorlog:` context prefix, which `errorLogSink.ts` is taught to drop — the
 * ring buffer still shows them to an admin in Settings, but they are never
 * queued for a disk write, so a failing disk cannot generate an unbounded
 * stream of errors about failing to write errors.
 */

const ERRORLOG_INTERNAL_CONTEXT_PREFIX = "errorlog:";

const DEFAULT_MAX_ERROR_ENTRIES = 2_000;
let maxErrorEntries = DEFAULT_MAX_ERROR_ENTRIES;
```

- `appendUserErrors(directoryHandle, username, batch)` — return early on an empty batch or a null handle. Wrap everything in `try/catch` and route the catch to `logError(\`${ERRORLOG_INTERNAL_CONTEXT_PREFIX}append\`, error)`. Compute `errorsFileName(username)` **inside** the try, for the exact reason `actionLog.ts:437-444` documents (`safeWorkspaceFilePart` calls `.trim()` and throws on a non-string, which outside the try becomes a rejected promise and breaks the never-throws contract at the fire-and-forget callers who rely on it hardest).
- Lock key: `withResourceLock(\`system-errors/${fileName}:rmw\`, ...)` — the `:rmw` suffix keeps this outer read-modify-write lock distinct from `safeWriteJson`'s internal `directoryResourceKey(dir, fileName)` lock. `withResourceLock` is not reentrant; a colliding key self-deadlocks (`actionLog.ts:446-451`).
- Inside: `casLoop<{ ok: true }>(async (writeToken) => { ... }, { maxRetries: 6, baseDelayMs: 100, conflictError: "error log append conflict" })`. Read the existing file, `nextRevision = (existing.revision ?? 0) + 1`, concat the whole batch at once, archive-then-trim on overflow, `safeWriteJson`, read back and compare **both** `revision` and `_writeToken`, and supply the delayed `verify` callback exactly as `actionLog.ts:484-494` does.
- `readUserErrorLogFile` — via `readOptionalJson` with a `[{ directory: () => getSystemErrorsDir(handle, false), fileName }]` location list. **It must throw when the file exists but cannot be read**, and return an empty shell only when genuinely absent. This is the base read of a read-modify-write: an empty shell on an unreadable file is a whole-file replacement that truncates that user's entire history and then reports success (`actionLog.ts:281-291` states the same rule with the same reasoning).
- `archiveOverflow(dir, username, overflow)` — bucket by `new Date(entry.at).getFullYear()` (falling back to the current year on an unparseable timestamp, as `actionLog.ts:88-91` does), dedupe against the existing archive's ids, skip a year whose additions are all already present, write with `safeWriteJson`, and **return `false` on any failure so the caller blocks the trim**.
- `readAllWorkspaceErrors(directoryHandle)` — `readJsonDirectory<UserErrorLogFile>(dir, { suffix: ERRORS_FILE_SUFFIX, onUnreadable: "skip" })`. `"skip"`, not `"throw"`: one corrupt user file must not hide every other user's history from the admin looking at the export. Merge with first-writer-wins dedupe by `id` and sort ascending by `at`, tie-broken by `id` (`actionLog.ts:542-558` — copy the comparator, including the `Number.isNaN` guard, so two clients reading the same folder produce the same list). Catch and return `[]` on any failure, including a missing folder.
- `readWorkspaceErrorArchive(directoryHandle, year)` — same, with `suffix: \`.errors.${year}.json\``.
- Export the two test seams (`__setMaxErrorEntriesForTests`, `__resetMaxErrorEntriesForTests`) with `@internal — test-only` doc comments, matching `actionLog.ts:52-60`.

There is **no legacy shared file** to union in — this subsystem has never had one, which is the one way it is simpler than `actionLog`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/data/errorLog/`
Expected: PASS.

- [ ] **Step 6: Run the FULL tier-3 gate sweep**

```bash
npm run test:run && npm run typecheck && npm run lint && \
npm run check:complexity && npm run check:hex-literals && \
npm run check:vendor && npm run build && npm run check:bundle-size
```

Expected: all green. `check:release` is deliberately excluded here and run in Step 7's order (it compares `package.json` against the topmost edit-log entry, so it can only pass after the entry exists — hence `--sync-package`). Watch `check:complexity`: `appendUserErrors` is the largest function this plan adds; if it trips the budget, extract `archiveOverflow` and the CAS body as separate module-level functions rather than raising the budget.

- [ ] **Step 7: Tier-3 edit log (with migration/rollback prose), then commit**

```bash
npm run editlog -- --tier=3 --append --sync-package "Add (error-log): per-user persisted error store under 5-system/system-errors/"
```

The generated skeleton's tier-3 migration section must state, in prose:

- **Migration: none, and none is possible.** There is no prior on-disk error log to convert. A workspace that has never run v116 simply has no `5-system/system-errors/` folder; it is created lazily on the first error any client persists.
- **Forward compatibility.** Readers tolerate a missing optional field, so an older file stays readable after a later field is added. Never remove or repurpose a field in `errorLogTypes.ts`.
- **Rollback:** revert the code. Files already written are orphaned, not corrupt — nothing else in the app reads or requires them, `checkWorkspaceStructure` does not list `system-errors` among required folders, and the folder can be left in place indefinitely or deleted by hand. This is the same "read forever, written never, deleted never, migrated never" doctrine `auditPaths.ts:15-18` applies to the legacy shared audit files, applied in reverse.
- **Backups need no change:** `backupStorage`'s generic `.json` walk from the workspace root already sweeps these files in, and `restoreActionFor` (`backupStorage.ts:751-769`) falls them through to `"replace"` — the same semantics it applies to the per-user audit logs, with the same documented consequence that a restore rolls back one user's log rather than the fleet's.

```bash
git add src/data/errorLog/errorLogTypes.ts src/data/errorLog/errorLogStorage.ts src/data/errorLog/errorLogStorage.test.ts "docs/edit logs/2026-08-24.md" package.json
git commit -m "Add (error-log): per-user CAS-protected error store with archive-at-N under 5-system/system-errors/" -- src/data/errorLog/errorLogTypes.ts src/data/errorLog/errorLogStorage.ts src/data/errorLog/errorLogStorage.test.ts "docs/edit logs/2026-08-24.md" package.json
```

Then run `npm run check:release` and confirm it passes against the entry just written.

---

### Task 5: The sink — batching, backpressure, and the headless installer

**Files:**
- Create: `src/data/errorLog/errorLogSink.ts`
- Create: `src/data/errorLog/errorLogSink.test.ts`
- Create: `src/data/errorLog/WorkspaceErrorSink.tsx`
- Create: `src/data/errorLog/WorkspaceErrorSink.test.tsx`
- Modify: `src/auth/AuthGate.tsx:705`

**Interfaces:**
- Consumes: `registerErrorSink`/`ErrorEntry` (Task 2), `appendUserErrors` (Task 4), `useWorkspace` (`src/data/workspace/useWorkspace.ts`), `isReadOnlyMode` (`src/data/storage/readOnlyMode.ts`).
- Produces: `installWorkspaceErrorSink(options): () => void` (returns an uninstall function), `flushErrorLogNow(): Promise<void>` (used by the export button so an admin's just-hit error is in the file they are about to read), `__getPendingCountForTests()`. Plus the headless `<WorkspaceErrorSink session={session} />`.

- [ ] **Step 1: Write the failing tests**

Create `src/data/errorLog/errorLogSink.test.ts` (node env — no React):

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createMemoryDirectory } from "../storage/memoryDirectory";
import { __resetErrorSinkForTests, clearErrors, logError } from "../storage/errorLogger";
import { __resetErrorContextForTests, setErrorActor } from "../storage/errorContext";
import { readAllWorkspaceErrors } from "./errorLogStorage";
import { flushErrorLogNow, installWorkspaceErrorSink } from "./errorLogSink";

let uninstall: (() => void) | null = null;

beforeEach(() => {
  clearErrors();
  __resetErrorSinkForTests();
  __resetErrorContextForTests();
});

afterEach(() => {
  uninstall?.();
  uninstall = null;
  vi.useRealTimers();
});

describe("errorLogSink", () => {
  it("persists a logged error to the signed-in user's own file", async () => {
    const dir = createMemoryDirectory("root");
    setErrorActor("alice", "employee");
    uninstall = installWorkspaceErrorSink({ directoryHandle: dir, username: "alice" });

    logError("population:save", new Error("boom"));
    await flushErrorLogNow();

    const all = await readAllWorkspaceErrors(dir);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      username: "alice",
      context: "population:save",
      action: "population:save",
      message: "boom",
    });
  });

  it("batches a burst into ONE write instead of one write per error", async () => {
    const dir = createMemoryDirectory("root");
    uninstall = installWorkspaceErrorSink({ directoryHandle: dir, username: "alice" });

    for (let i = 0; i < 10; i++) logError(`ctx-${i}`, new Error(`boom-${i}`));
    await flushErrorLogNow();

    const all = await readAllWorkspaceErrors(dir);
    expect(all).toHaveLength(10);
    const system = await dir.getDirectoryHandle("5-system", { create: false });
    const errors = await system.getDirectoryHandle("system-errors", { create: false });
    const handle = await errors.getFileHandle((await import("./errorLogPaths")).errorsFileName("alice"), { create: false });
    const parsed = JSON.parse(await (await handle.getFile()).text());
    // One flush, one revision — not ten.
    expect(parsed.data.revision).toBe(1);
  });

  it("flushes automatically once the batch threshold is reached", async () => {
    vi.useFakeTimers();
    const dir = createMemoryDirectory("root");
    uninstall = installWorkspaceErrorSink({ directoryHandle: dir, username: "alice", batchSize: 3 });

    for (let i = 0; i < 3; i++) logError(`ctx-${i}`, new Error("boom"));
    await vi.runAllTimersAsync();

    expect(await readAllWorkspaceErrors(dir)).toHaveLength(3);
  });

  it("flushes on a timer even when the batch never fills", async () => {
    vi.useFakeTimers();
    const dir = createMemoryDirectory("root");
    uninstall = installWorkspaceErrorSink({ directoryHandle: dir, username: "alice", flushDelayMs: 5_000 });

    logError("ctx", new Error("boom"));
    expect(await readAllWorkspaceErrors(dir)).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(await readAllWorkspaceErrors(dir)).toHaveLength(1);
  });

  it("drops the OLDEST pending entries past the queue cap, and records how many", async () => {
    const dir = createMemoryDirectory("root");
    uninstall = installWorkspaceErrorSink({
      directoryHandle: dir, username: "alice", maxPending: 5, flushDelayMs: 1_000_000,
    });

    for (let i = 0; i < 12; i++) logError(`ctx-${i}`, new Error(`boom-${i}`));
    await flushErrorLogNow();

    const all = await readAllWorkspaceErrors(dir);
    // 5 kept + 1 synthetic "N dropped" marker. An error storm is bounded
    // memory, and the fact that it WAS a storm survives to the export.
    expect(all).toHaveLength(6);
    expect(all.some((e) => e.context === "errorlog:overflow" && e.message.includes("7"))).toBe(true);
    expect(all.map((e) => e.message)).toContain("boom-11");
    expect(all.map((e) => e.message)).not.toContain("boom-0");
  });

  it("never queues its own internal failures — a failing disk cannot self-amplify", async () => {
    const dir = createMemoryDirectory("root", { initialWritePermission: "denied" });
    uninstall = installWorkspaceErrorSink({ directoryHandle: dir, username: "alice" });

    logError("population:save", new Error("boom"));
    await flushErrorLogNow();
    await flushErrorLogNow();

    // The write failed and was logged to the ring buffer, but that log did not
    // enqueue anything new: a second flush has nothing left to attempt.
    expect(__getPendingCountForTests()).toBe(0);
  });

  it("writes nothing at all in read-only (demo/viewer) mode", async () => {
    const dir = createMemoryDirectory("root");
    setReadOnlyMode(true);
    try {
      uninstall = installWorkspaceErrorSink({ directoryHandle: dir, username: "demo" });
      logError("ctx", new Error("boom"));
      await flushErrorLogNow();
      expect(await readAllWorkspaceErrors(dir)).toEqual([]);
    } finally {
      setReadOnlyMode(false);
    }
  });

  it("stops persisting after uninstall", async () => {
    const dir = createMemoryDirectory("root");
    const stop = installWorkspaceErrorSink({ directoryHandle: dir, username: "alice" });
    stop();

    logError("ctx", new Error("boom"));
    await flushErrorLogNow();
    expect(await readAllWorkspaceErrors(dir)).toEqual([]);
  });
});
```

Create `src/components`-style component test `src/data/errorLog/WorkspaceErrorSink.test.tsx` with `/* @vitest-environment jsdom */` on line 1, mocking `useWorkspace` (the same `vi.hoisted` handle pattern `EmployeeWorkspace/index.test.tsx` uses) and asserting: the sink installs when `status === "ready"` and a handle exists; it does **not** install for a `demo`-mode session; and unmounting uninstalls it.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/data/errorLog/errorLogSink.test.ts src/data/errorLog/WorkspaceErrorSink.test.tsx`
Expected: FAIL — neither module exists.

- [ ] **Step 3: Implement `errorLogSink.ts`**

Design constraints the implementation must satisfy, each pinned by a test above:

- **Defaults:** `batchSize: 25`, `flushDelayMs: 5_000`, `maxPending: 200`. All three overridable via the options object purely so the tests can exercise them cheaply — the same test-seam idiom `actionLog.ts:50-60` uses for its cap.
- **Never write per entry.** `logError` is synchronous and must return immediately; the sink only pushes onto an in-memory array and arms a timer. `appendUserErrors` is then called once per flush with the whole batch.
- **Reject its own noise.** Drop any entry whose `context` starts with `"errorlog:"` (the prefix `errorLogStorage.ts` uses for its internal failures) before enqueueing. Combined with `errorLogger`'s `suppressDepth`, this closes the loop from both ends: the counter stops synchronous re-entry, the prefix filter stops the asynchronous flush-failure loop.
- **Read-only mode.** Return early from the flush when `isReadOnlyMode()` — `safeWriteJson` would throw `ReadOnlyModeError` anyway (`readOnlyMode.ts:33`), but letting it throw once per flush forever is noise for a session that by definition has no workspace worth writing to.
- **Overflow.** When `pending.length` exceeds `maxPending`, drop from the FRONT (oldest) and increment a `droppedSinceLastFlush` counter; the next flush prepends one synthetic entry with `context: "errorlog:overflow"` and a message naming the count. Dropping the oldest, not the newest, matches the ring buffer's existing behaviour (`errorLogger.ts:124`).
- **One flush at a time.** A module-level in-flight promise; a `flushErrorLogNow()` call during an in-flight flush awaits the existing one and then runs again if anything new arrived. Same shape as `workspaceSync.ts`'s single shared in-flight guard — do not add a second timer or a second flush path.
- **Flush on the way out.** Register `visibilitychange` (when `document.hidden`) and `pagehide` listeners that call the flush, so a user who closes the tab right after an error does not lose it. Remove them in the returned uninstall function. Guard `typeof document !== "undefined"` — this module is exercised in the `node` test env.

Create `src/data/errorLog/WorkspaceErrorSink.tsx` as a headless component returning `null`, modelled on `SyncTick.tsx`: `useWorkspace()` for `{ directoryHandle, status }`, an `enabled` prop for the demo gate, and a single effect that installs on `status === "ready" && directoryHandle` and returns the uninstall function.

- [ ] **Step 4: Mount it**

In `src/auth/AuthGate.tsx`, `:705` currently reads:

```tsx
        <SyncTick enabled={session.mode !== "demo"} />
```

becomes:

```tsx
        <SyncTick enabled={session.mode !== "demo"} />
        {/* Headless — installs the durable error-log sink for THIS user, so an
            error hit anywhere in the tree (including the data layer, which has
            no React context) lands in 5-system/system-errors/{stem}.errors.json.
            Mounted beside SyncTick for the same two reasons: it needs a ready
            workspace via useWorkspace(), and only AuthGate knows the session
            mode — the read-only demo/viewer session must not write. Keyed on
            the REAL username, never the previewed role's identity. */}
        <WorkspaceErrorSink
          username={session.username}
          enabled={session.mode !== "demo"}
        />
```

with the import added alongside `SyncTick`'s at `AuthGate.tsx:70`:

```ts
import { WorkspaceErrorSink } from "../data/errorLog/WorkspaceErrorSink";
```

Note it is mounted **inside** `GlobalMonthProvider` only because that is where `SyncTick` lives and the two belong together visually; the sink itself has no month dependency. Do not add one.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/data/errorLog/ src/auth/AuthGate.test.tsx`
Expected: PASS, including every pre-existing AuthGate test — the new element renders `null` and installs nothing when its `useWorkspace()` reports a non-ready status, which is what AuthGate's own tests have.

- [ ] **Step 6: Run the gates**

Run: `npm run test:run && npm run typecheck && npm run lint && npm run build`
Expected: all green. **`npm run build` matters most here**: this task closes the loop between `errorLogger` (below `safeWrite`) and `errorLogStorage` (above it) and is exactly where an accidental cycle would land. `vitest` transpiles per-file and would not notice; `vite build` dies on it.

- [ ] **Step 7: Edit log, then commit**

```bash
npm run editlog -- --tier=2 --append "Add (error-log): batching sink that persists every logged error to the workspace"
git add src/data/errorLog/errorLogSink.ts src/data/errorLog/errorLogSink.test.ts src/data/errorLog/WorkspaceErrorSink.tsx src/data/errorLog/WorkspaceErrorSink.test.tsx src/auth/AuthGate.tsx "docs/edit logs/2026-08-24.md" package.json
git commit -m "Add (error-log): batching, bounded sink that persists every logged error to the shared workspace" -- src/data/errorLog/errorLogSink.ts src/data/errorLog/errorLogSink.test.ts src/data/errorLog/WorkspaceErrorSink.tsx src/data/errorLog/WorkspaceErrorSink.test.tsx src/auth/AuthGate.tsx "docs/edit logs/2026-08-24.md" package.json
```

---

### Task 6: The Excel export builder

**Files:**
- Create: `src/data/errorLog/errorLogExport.ts`
- Create: `src/data/errorLog/errorLogExport.test.ts`

**Interfaces:**
- Consumes: `readAllWorkspaceErrors` + `readWorkspaceErrorArchive` (Task 4), `flushErrorLogNow` (Task 5), `yieldToMain` (`src/data/storage/yieldToMain.ts:28`), `xlsx`.
- Produces: `ERROR_EXPORT_HEADERS` (readonly string[]), `buildErrorLogExportRows(entries): string[][]` (**pure**, node-testable), `exportWorkspaceErrorLog(directoryHandle, options?): Promise<{ rowCount: number }>` (the DOM-touching wrapper).

- [ ] **Step 1: Write the failing tests**

Create `src/data/errorLog/errorLogExport.test.ts` (node env — it tests only the pure builder plus the gathering function, never `XLSX.writeFile`, which needs a DOM):

```ts
import { describe, it, expect } from "vitest";
import { createMemoryDirectory } from "../storage/memoryDirectory";
import { appendUserErrors } from "./errorLogStorage";
import { ERROR_EXPORT_HEADERS, buildErrorLogExportRows, gatherErrorLogRows } from "./errorLogExport";

describe("errorLogExport", () => {
  it("emits one row per entry, aligned with the header row", () => {
    const rows = buildErrorLogExportRows([
      {
        id: "err-1",
        at: "2026-08-24T10:30:00.000Z",
        username: "alice",
        role: "employee",
        page: "population/browse",
        action: "population:save",
        context: "population:save [XQ-IO-032]",
        message: "boom",
        errorCode: "XQ-IO-032",
        stack: "at foo",
      },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveLength(ERROR_EXPORT_HEADERS.length);
    expect(rows[0]).toEqual([
      "2026-08-24 10:30:00",
      "alice",
      "employee",
      "population/browse",
      "population:save",
      "XQ-IO-032",
      "population:save [XQ-IO-032]",
      "boom",
      "at foo",
    ]);
  });

  it("renders a missing optional field as an empty cell, never as 'undefined'", () => {
    const [row] = buildErrorLogExportRows([{
      id: "err-1", at: "2026-08-24T10:30:00.000Z", username: "alice",
      page: "unknown", action: "x", context: "x", message: "boom",
    }]);
    expect(row).not.toContain("undefined");
    expect(row.filter((c) => c === "")).toHaveLength(3); // role, errorCode, stack
  });

  it("is deterministic — the same entries always produce the same rows", () => {
    const entries = [
      { id: "b", at: "2026-08-24T11:00:00.000Z", username: "bob", page: "p", action: "a", context: "c", message: "m" },
      { id: "a", at: "2026-08-24T10:00:00.000Z", username: "alice", page: "p", action: "a", context: "c", message: "m" },
    ];
    expect(buildErrorLogExportRows(entries)).toEqual(buildErrorLogExportRows(entries));
  });

  it("gathers every user's live entries and, when asked, the archives too", async () => {
    const dir = createMemoryDirectory("root");
    await appendUserErrors(dir, "alice", [/* … */]);
    await appendUserErrors(dir, "bob", [/* … */]);

    const live = await gatherErrorLogRows(dir, { includeArchives: false });
    expect(live.rowCount).toBe(2);
  });

  it("returns zero rows rather than throwing on a workspace that has never logged an error", async () => {
    const result = await gatherErrorLogRows(createMemoryDirectory("root"), { includeArchives: true });
    expect(result.rows).toEqual([]);
    expect(result.rowCount).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/data/errorLog/errorLogExport.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement `errorLogExport.ts`**

Mirror `DataTable`'s export mechanics at `src/components/DataTable/index.tsx:637-676` — same four `XLSX` calls, same chunked row build with `yieldToMain()`, same `logError` on failure:

```ts
/**
 * Admin export of the workspace-wide error log to a single XLSX file.
 *
 * Mechanically identical to DataTable's own export (DataTable/index.tsx:637-676):
 * `aoa_to_sheet` -> `book_new` -> `book_append_sheet` -> `writeFile`, with the
 * row array built in chunks separated by `yieldToMain()` so a large history does
 * not block the UI thread for the whole build. The `XLSX.utils`/`writeFile` tail
 * is an unavoidable synchronous call; callers own an `isExporting` state for it.
 *
 * The pure row builder is separated from the XLSX call deliberately: `writeFile`
 * needs a DOM (it triggers a browser download), so keeping `buildErrorLogExportRows`
 * import-free of `xlsx` is what lets it be pinned by a plain node-env test — and
 * an export builder is deterministic-by-contract in this repo, so it needs one.
 *
 * HEADERS ARE ARABIC CONSTANTS, NOT LABEL KEYS. `powerbiExport/exportManager.ts:13-21`
 * sets the precedent that a generated file's column headings live in the builder
 * rather than in `DEFAULT_LABELS` — they are the schema of an artifact leaving the
 * app, not UI chrome an admin retitles from Settings. The button and status text in
 * Task 7 ARE label keys, because those are UI.
 */
export const ERROR_EXPORT_HEADERS = [
  "الوقت",
  "المستخدم",
  "الدور",
  "الصفحة",
  "الإجراء",
  "رمز الخطأ",
  "السياق",
  "الرسالة",
  "التفاصيل التقنية",
] as const;
```

- `buildErrorLogExportRows(entries)` — one `string[]` per entry, in header order, `?? ""` on every optional field. Format `at` as `YYYY-MM-DD HH:mm:ss` using the same `.slice(0, 19).replace("T", " ")` idiom `ErrorLogSection.tsx:94` already renders with, so the export and the on-screen list agree.
- `gatherErrorLogRows(directoryHandle, { includeArchives })` — call `flushErrorLogNow()` first (so the admin's own just-hit errors are in the files about to be read), then `readAllWorkspaceErrors`, then, when `includeArchives`, `readWorkspaceErrorArchive` for the current year and the previous one, merged and deduped by `id`. Chunk the row build at 1000 with `yieldToMain()` between chunks.
- `exportWorkspaceErrorLog(directoryHandle, options)` — gather, then `XLSX.utils.aoa_to_sheet([[...ERROR_EXPORT_HEADERS], ...rows])`, `book_new`, `book_append_sheet(wb, ws, "سجل الأخطاء")`, `writeFile(wb, fileName)`. Default file name: `error-log-${new Date().toISOString().slice(0, 10)}.xlsx`. Return `{ rowCount }` so the caller can tell the admin an empty export was empty rather than broken.

Note per `readOnlyMode.ts:3-5`, exports are explicitly *unaffected* by read-only mode — they stream to a browser download and write nothing to the workspace. Do not gate this on `isReadOnlyMode()`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/data/errorLog/errorLogExport.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the gates**

Run: `npm run test:run && npm run typecheck && npm run lint && npm run build && npm run check:bundle-size`
Expected: all green. `check:bundle-size` is included at this tier-2 task specifically because it is the one that adds an `xlsx` import to a new module — `xlsx` is already bundled for `DataTable`, so the delta should be source-size only, but confirm rather than assume.

- [ ] **Step 6: Edit log, then commit**

```bash
npm run editlog -- --tier=2 --append "Add (error-log): XLSX export builder for the workspace-wide error log"
git add src/data/errorLog/errorLogExport.ts src/data/errorLog/errorLogExport.test.ts "docs/edit logs/2026-08-24.md" package.json
git commit -m "Add (error-log): deterministic row builder and XLSX export for the workspace-wide error log" -- src/data/errorLog/errorLogExport.ts src/data/errorLog/errorLogExport.test.ts "docs/edit logs/2026-08-24.md" package.json
```

---

### Task 7: Surface it in `Settings/ErrorLogSection`

**Files:**
- Modify: `src/components/Sidebar/Tabs/Settings/ErrorLogSection.tsx` (105 lines)
- Modify: `src/components/Sidebar/Tabs/Settings/ErrorLogSection.css`
- Modify: `src/components/Sidebar/Tabs/Settings/ErrorLogSection.test.tsx`
- Modify: `src/data/labels/labelsStore.ts` (four new keys)

**Interfaces:**
- Consumes: `exportWorkspaceErrorLog` (Task 6), `useWorkspace`, `useLabels` (`src/data/labels/useLabels.ts:6-10`), the existing `usePermissions` gate.
- Produces: no new exports. `ErrorLogSection`'s existing behaviour (badge count, expand/collapse, clear gating, 60 s refresh) is unchanged; one button is added to the existing toolbar at `ErrorLogSection.tsx:69-86`.

**Permission decision — deliberate, and worth flagging to the owner:** this reuses the existing `view-error-log` feature permission for both viewing and exporting, and the existing `canMutate("view-error-log")` for clearing. `userManagement.ts:436` defaults `view-error-log` to `false` for guest/employee/supervisor/manager, and `userManagement.ts:376` scopes it to the `settings` tab, which `tabCatalog` allows only for guest and admin. **So this ships admin-only by default**, which matches the owner's "admin-exportable" requirement exactly. Making it manager-visible would require granting the `settings` tab to managers — a broader change with side effects on every other Settings section, and therefore an owner decision, not this plan's. Do **not** invent a new permission id to route around it.

- [ ] **Step 1: Read the existing component and its test in full**

Read `ErrorLogSection.tsx` (105 lines) and `ErrorLogSection.test.tsx` before changing anything. The test file's `vi.mock` of `usePermissions` returns `can`/`canMutate` keyed on `"view-error-log"` only; adding a `useWorkspace` dependency to the component means every existing test in that file needs a `useWorkspace` mock too, or they all fail at render. Add the mock in the same commit.

- [ ] **Step 2: Add the label keys**

In `src/data/labels/labelsStore.ts`, add four keys to `DEFAULT_LABELS` near the other `err_`/`dt_` entries:

```ts
  errlog_export_btn:     "تصدير سجل الأخطاء إلى Excel",
  errlog_exporting:      "جارٍ التصدير…",
  errlog_export_failed:  "تعذّر تصدير سجل الأخطاء — حاول مرة أخرى.",
  errlog_export_empty:   "لا توجد أخطاء مسجّلة في مساحة العمل.",
```

- [ ] **Step 3: Write the failing tests**

Add to `ErrorLogSection.test.tsx` a new `describe` block, coexisting with the existing `permissionsMock` setup:

```tsx
const workspaceMock = vi.hoisted(() => ({ handle: null as DirectoryHandleLike | null }));
vi.mock("../../../../data/workspace/useWorkspace", () => ({
  useWorkspace: () => ({ directoryHandle: workspaceMock.handle, status: "ready" }),
}));

const exportMock = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("../../../../data/errorLog/errorLogExport", () => ({
  exportWorkspaceErrorLog: exportMock.run,
}));

describe("ErrorLogSection — workspace export", () => {
  beforeEach(() => {
    exportMock.run.mockReset().mockResolvedValue({ rowCount: 3 });
    workspaceMock.handle = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
  });

  function openPanel() {
    render(<ErrorLogSection />);
    fireEvent.click(screen.getByRole("button", { name: /سجل الأخطاء/ }));
  }

  it("exports the workspace-wide log, not just this browser's ring buffer", async () => {
    openPanel();
    fireEvent.click(screen.getByRole("button", { name: DEFAULT_LABELS.errlog_export_btn }));
    await waitFor(() => expect(exportMock.run).toHaveBeenCalledWith(workspaceMock.handle, expect.anything()));
  });

  it("disables the export button while an export is running", async () => {
    let resolve!: (v: { rowCount: number }) => void;
    exportMock.run.mockReturnValue(new Promise((r) => { resolve = r; }));
    openPanel();

    const button = screen.getByRole("button", { name: DEFAULT_LABELS.errlog_export_btn });
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole("button", { name: DEFAULT_LABELS.errlog_exporting })).toBeDisabled());

    await act(async () => { resolve({ rowCount: 3 }); });
    await waitFor(() => expect(screen.getByRole("button", { name: DEFAULT_LABELS.errlog_export_btn })).toBeEnabled());
  });

  it("reports an empty export as empty rather than as a silent success", async () => {
    exportMock.run.mockResolvedValue({ rowCount: 0 });
    openPanel();
    fireEvent.click(screen.getByRole("button", { name: DEFAULT_LABELS.errlog_export_btn }));
    expect(await screen.findByRole("status")).toHaveTextContent(DEFAULT_LABELS.errlog_export_empty);
  });

  it("surfaces a thrown export as an in-page alert, not an unhandled rejection", async () => {
    exportMock.run.mockRejectedValue(new Error("boom"));
    openPanel();
    fireEvent.click(screen.getByRole("button", { name: DEFAULT_LABELS.errlog_export_btn }));
    expect(await screen.findByRole("alert")).toHaveTextContent(DEFAULT_LABELS.errlog_export_failed);
  });

  it("hides the export button when no workspace is connected", () => {
    workspaceMock.handle = null;
    openPanel();
    expect(screen.queryByRole("button", { name: DEFAULT_LABELS.errlog_export_btn })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npx vitest run src/components/Sidebar/Tabs/Settings/ErrorLogSection.test.tsx`
Expected: FAIL — no export button exists.

- [ ] **Step 5: Add the button**

In `ErrorLogSection.tsx`, add state and a handler alongside the existing `handleRefresh`/`handleClear` (`:38-46`):

```tsx
  const [isExporting, setIsExporting] = useState(false);
  const [exportNotice, setExportNotice] = useState<
    { kind: "error" | "empty"; text: string } | null
  >(null);

  async function handleExport() {
    if (!directoryHandle || isExporting) return;
    setExportNotice(null);
    setIsExporting(true);
    try {
      const { rowCount } = await exportWorkspaceErrorLog(directoryHandle, { includeArchives: true });
      // A zero-row export downloads a header-only file, which is
      // indistinguishable from a broken button. Say so explicitly — same
      // reasoning as DataTable's export-error banner (index.tsx:665-672),
      // where a silent failure was the actual bug being fixed.
      if (rowCount === 0) setExportNotice({ kind: "empty", text: L.errlog_export_empty });
    } catch (err) {
      logError("errorlog:export", err);
      setExportNotice({ kind: "error", text: L.errlog_export_failed });
    } finally {
      setIsExporting(false);
    }
  }
```

Note `logError("errorlog:export", …)` uses the `errorlog:` prefix the sink drops (Task 5) — an export failure belongs in the on-screen ring buffer, not queued for a workspace write that may be failing for the same reason.

Add the button to the existing toolbar (`:69-86`), between Clear and Refresh:

```tsx
          <div className="error-log-toolbar">
            <button
              type="button"
              className="error-log-clear-btn"
              onClick={handleClear}
              disabled={!canClear}
              title={!canClear ? "لا تملك صلاحية مسح سجل الأخطاء" : undefined}
            >
              مسح السجل
            </button>
            {directoryHandle && (
              <button
                type="button"
                className="error-log-export-btn"
                onClick={() => { void handleExport(); }}
                disabled={isExporting}
              >
                {isExporting ? L.errlog_exporting : L.errlog_export_btn}
              </button>
            )}
            <button
              type="button"
              className="error-log-refresh-btn"
              onClick={handleRefresh}
            >
              تحديث
            </button>
          </div>
          {exportNotice && (
            <p
              className={`error-log-export-notice is-${exportNotice.kind}`}
              role={exportNotice.kind === "error" ? "alert" : "status"}
            >
              {exportNotice.text}
            </p>
          )}
```

Add the imports (`useWorkspace`, `useLabels`, `exportWorkspaceErrorLog`, `logError`) and `const L = useLabels();` at the top of the component. Add `.error-log-export-btn` and `.error-log-export-notice` rules to `ErrorLogSection.css`, reusing the existing custom properties in that file — `npm run check:hex-literals` rejects raw hex, and this file has already been through one token-rename fix (see the test file's own header comment).

The header (`:60`) still says "سجل الأخطاء الأخيرة" and the list still renders the local ring buffer. That is correct and should stay: the panel shows *this browser's* recent errors, and the button exports *the whole workspace's*. Do not repurpose the list to render workspace-wide entries — that would turn a Settings panel into a paged data view over an unbounded file family, which is a separate feature with a separate design.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/components/Sidebar/Tabs/Settings/`
Expected: PASS, including every pre-existing `ErrorLogSection` test (visibility, clear gating, refresh) and `index.test.tsx`.

- [ ] **Step 7: See it in the real app**

Run `npm run dev`, sign in as admin in Chrome/Edge, attach a workspace, open Settings → سجل الأخطاء الأخيرة, and confirm: the export button appears, downloads a file, and the file contains rows from more than one user when more than one user has logged in against that workspace. **Do not skip this step and do not report the feature as working on the strength of a green suite** — CLAUDE.md records five consecutive rounds of effect-timing bugs in this codebase that survived self-review, and this task's component now depends on workspace-readiness timing.

- [ ] **Step 8: Run the gates**

Run: `npm run test:run && npm run typecheck && npm run lint && npm run build && npm run check:hex-literals`
Expected: all green.

- [ ] **Step 9: Edit log, then commit**

```bash
npm run editlog -- --tier=2 --append "Add (settings): admin export of the workspace-wide error log to Excel"
git add src/components/Sidebar/Tabs/Settings/ErrorLogSection.tsx src/components/Sidebar/Tabs/Settings/ErrorLogSection.css src/components/Sidebar/Tabs/Settings/ErrorLogSection.test.tsx src/data/labels/labelsStore.ts "docs/edit logs/2026-08-24.md" package.json
git commit -m "Add (settings): admin export of the workspace-wide error log to Excel from ErrorLogSection" -- src/components/Sidebar/Tabs/Settings/ErrorLogSection.tsx src/components/Sidebar/Tabs/Settings/ErrorLogSection.css src/components/Sidebar/Tabs/Settings/ErrorLogSection.test.tsx src/data/labels/labelsStore.ts "docs/edit logs/2026-08-24.md" package.json
```

---

### Task 8: Documentation sync and the release wrap (TIER 3)

**Files:**
- Modify: `docs/architecture/data-system-report.md` (the authoritative path reference)
- Modify: `CLAUDE.md` (disk-layout block + data-layer module table)
- Modify: `docs/architecture/SECURITY_MODEL.md` (one paragraph)

**Interfaces:** none — documentation only, plus the final gate sweep.

- [ ] **Step 1: `docs/architecture/data-system-report.md`**

CLAUDE.md names this file as *"the authoritative, detailed reference for every file and path — keep it in sync"*. Add a `5-system/system-errors/` section documenting: the two file families (`{stem}.errors.json`, `{stem}.errors.{year}.json`), the `UserErrorLogFile`/`ErrorLogArchiveFile` shapes, the per-user write rule, the 2000-entry live cap and archive-before-trim contract, the casLoop 6×100 ms configuration and where it came from, and the "no legacy shared file, no migration, rollback = orphan the folder" note from Task 4.

- [ ] **Step 2: `CLAUDE.md`**

Add to the disk-layout block, under `5-system/`:

```
5-system/       workspace.schema.json, backups/, audit/, locks/, presets, notifications,
                system-errors/ — one {stem}.errors.json per user + per-user yearly archives
```

Add a row to the *Data-layer modules* table, after the Audit row:

```
| Error log | `src/data/errorLog/` | Durable per-user error records under `5-system/system-errors/`, fed by a sink registered into `storage/errorLogger.ts`; admin XLSX export. Per-user files and the 6×100 ms casLoop config are copied from `audit/actionLog.ts` for the same SMB-contention reason |
```

Amend the `Error logger` row to say the ring buffer is now the *local* half of a two-tier log, pointing at `src/data/errorLog/` for the durable half.

- [ ] **Step 3: `docs/architecture/SECURITY_MODEL.md`**

One paragraph: the persistent error log stores error messages and truncated stack traces — which can contain `xrayImageId`s and usernames — as plain JSON in the shared workspace, readable and editable by anyone with folder access, exactly like every other business file. It is **not** tamper-evident and deliberately carries no hash chain. The only bound on what reaches disk is `errorLogger.ts`'s existing 500-character message/stack truncation. This changes no trust boundary; it is recorded so the risk is accepted explicitly rather than discovered later.

- [ ] **Step 4: Full pre-release gate sweep**

```bash
npm run test:run && npm run typecheck && npm run lint && \
npm run check:complexity && npm run check:hex-literals && \
npm run check:vendor && npm run build && npm run check:bundle-size
```

Then `npm run editlog -- --tier=3 --append --sync-package "Docs (error-log): sync data-system-report, CLAUDE.md and the security model"`, then `npm run check:release` **last**, so it compares `package.json` against the entry that now exists.

`docs/product/RELEASE_CHECKLIST.md` is the authority if this is being cut as an actual release; this step is the per-plan wrap, not a substitute for it.

- [ ] **Step 5: Commit**

```bash
git add docs/architecture/data-system-report.md CLAUDE.md docs/architecture/SECURITY_MODEL.md "docs/edit logs/2026-08-24.md" package.json
git commit -m "Docs (error-log): document 5-system/system-errors/ in the data-system report, CLAUDE.md and the security model" -- docs/architecture/data-system-report.md CLAUDE.md docs/architecture/SECURITY_MODEL.md "docs/edit logs/2026-08-24.md" package.json
```

---

## Explicit non-goals

Named here so a later reader knows they were considered and declined, not missed.

- **No workspace-wide error viewer in the UI.** The Settings panel keeps showing this browser's ring buffer; the fleet-wide view is the Excel export. A paged, filtered, permission-gated data view over an unbounded file family is a separate feature with a separate design, and building it as a side effect of this plan would put an unpaged read of every user's history behind a Settings accordion.
- **No hash chain / tamper evidence.** Declined with reasons in `errorLogTypes.ts` and the security-model paragraph.
- **No change to `backupStorage`.** Its generic `.json` walk already sweeps the new folder in with `"replace"` restore semantics — the same treatment the per-user audit logs get (`backupStorage.ts:761-768`).
- **No change to `checkWorkspaceStructure`/`SYSTEM_SUBFOLDERS`.** The folder is created lazily; an existing workspace without it is healthy, not broken.
- **No widening of the 500-character message/stack truncation.** More context on disk is tempting and is a privacy decision, not an engineering one.
- **No retroactive `action` labels at the 56 existing call sites.** `action` defaults to the `context` string, which already names the operation at every one of them. Improving individual labels is a cheap follow-up, one call site at a time, and needs no further plan.
- **No `errorCode` backfill into the `ERROR_CODES` catalog.** The catalog is append-only (`errorCodes.ts:8`) and this plan adds no failure sites that warrant a new code.

## Testing summary (gates by task)

| Task | Tier | Gates |
|---|---|---|
| 1, 2, 3, 5, 6, 7 | 2 | `test:run`, `typecheck`, `lint`, **plus `build`** (CLAUDE.md: mandatory at every tier). Task 6 adds `check:bundle-size`; Task 7 adds `check:hex-literals`. |
| 4, 8 | 3 | All of the above plus `check:complexity`, `check:hex-literals`, `check:vendor`, `check:bundle-size`, and `check:release` run **after** the edit-log entry exists. |

Task 7 additionally requires a real-browser confirmation in Chrome/Edge (Step 7). It is not optional.

## Key files touched

| Task | Files |
|---|---|
| 1 | `src/data/storage/errorContext.ts` (new) + `.test.ts` (new), `src/App.tsx`, `src/app/subTabSelection.ts`, `src/auth/authSession.ts` |
| 2 | `src/data/storage/errorLogger.ts`, `.test.ts`, `src/data/storage/errorCodes.ts`, `src/data/storage/storageRegistry.ts` |
| 3 | `src/data/workspace/workspacePaths.ts`, `.test.ts`, `src/data/errorLog/errorLogPaths.ts` (new) + `.test.ts` (new) |
| 4 | `src/data/errorLog/errorLogTypes.ts` (new), `errorLogStorage.ts` (new) + `.test.ts` (new) |
| 5 | `src/data/errorLog/errorLogSink.ts` (new) + `.test.ts` (new), `WorkspaceErrorSink.tsx` (new) + `.test.tsx` (new), `src/auth/AuthGate.tsx` |
| 6 | `src/data/errorLog/errorLogExport.ts` (new) + `.test.ts` (new) |
| 7 | `src/components/Sidebar/Tabs/Settings/ErrorLogSection.{tsx,css,test.tsx}`, `src/data/labels/labelsStore.ts` |
| 8 | `docs/architecture/data-system-report.md`, `CLAUDE.md`, `docs/architecture/SECURITY_MODEL.md` |
