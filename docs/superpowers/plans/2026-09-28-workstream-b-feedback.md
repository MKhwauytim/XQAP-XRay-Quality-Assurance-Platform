# Workstream B — Feedback Performance & Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the feedback panel open instantly and stay responsive as the ticket history grows: render from `threads.index.json` summaries before any full read, take page bodies from the provider's in-memory threads, apply submits and replies from the value the write returned (no reload storm, no reply card stuck on «جاري التحميل...»), take the rebuildable index write off the click's critical path, stamp `resolvedAt` / `resolvedBy` on resolve, and give the real admin a two-sheet XLSX export of every conversation.

**Architecture:** Storage rules live in `src/data/feedback/` (pure helpers and I/O, each with node-env tests on `createMemoryDirectory`). `FeedbackWidget.tsx` changes only to consume those contracts: the panel's open path (`refresh`), the page-body effect, the submit/reply handlers, and one admin button. The provider (`FeedbackUnreadProvider`) is unchanged. No existing workspace file changes shape; the only on-disk addition is two optional fields on a thread file.

**Tech Stack:** React 19 + TypeScript (strict, `erasableSyntaxOnly`), Vite, Vitest (`globals: false`, node env by default, jsdom opt-in per file), SheetJS (vendored `xlsx`), File System Access API through `DirectoryHandleLike`.

**Spec:** `docs/superpowers/specs/2026-09-28-corrective-plan-design.md` — "Workstream B — Feedback performance & export (item 1)" only.

## Global Constraints

- Node `>=22 <23`.
- TypeScript strict with `erasableSyntaxOnly` (no `enum`, no parameter properties, no namespaces); `import type` for type-only imports.
- Arabic UI strings only through `labelsStore` keys (`DEFAULT_LABELS` in `src/data/labels/labelsStore.ts`), read with `getLabels()` / `useLabels()`. No new inline Arabic in components. (Test files may assert on Arabic fixture text.)
- All workspace I/O through `safeWriteJson` / `safeReadJson` and the path helpers in `src/data/workspace/workspacePaths.ts`. Never call `getFileHandle` / `createWritable` directly in app code.
- The new thread fields `resolvedAt` / `resolvedBy` are **optional and additive**. No existing field changes shape, so no migration module is needed (CLAUDE.md's post-launch migration policy covers new *required* fields and changed shapes).
- `xlsx` is vendored — import it as `import * as XLSX from "xlsx";` and never change `package.json`'s `xlsx` entry.
- One edit-log entry per task, generated **after** the change: `npm run editlog -- --tier=N --append --sync-package "Category (scope): …"`, then replace the skeleton's `<…>` placeholders in `docs/edit logs/<today>.md` with the prose given in the task (tier 2+: `Why:` + `What changed:` + Before/After snippets copied from the task's own steps + `Verification:` with the gate results). Task 1 also passes `--bump=major` (opens this workstream's major version); every later task uses the default minor bump, and the one tier-3 task passes `--bump=minor` explicitly.
- Tier gates before claiming a task done: tier 1 = `npm run lint`, `npm run typecheck`, the affected test file; tier 2 = `npm run lint`, `npm run typecheck`, `npm run test:run`; tier 3 = tier 2 + `npm run check:complexity`, `npm run check:hex-literals`, `npm run check:release`, `npm run check:vendor`, `npm run build`, `npm run check:bundle-size`.
- Work on branch `claude/beautiful-einstein-y1ouot`. Commit per task; push only in Task 8, after `npm run build`.
- Every commit message ends with these two lines:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01NU4UP8LM3qkAnTNccmKZEJ
  ```

## File Structure

| File | Status | Responsibility |
|------|--------|----------------|
| `src/components/FeedbackWidget/FeedbackWidget.tsx` | Modify | Open renders from the index (T1); page bodies from provider + sorted missing-id key (T2); optimistic submit/reply (T3); admin export button (T7). |
| `src/components/FeedbackWidget/FeedbackWidget.css` | Modify | `.fb-export*` styles (T7). |
| `src/data/feedback/feedbackThreadMerge.ts` | Create | Pure: `pickFresherThread`, `indexThreadsById`, `missingThreadIds`, `mergeFeedbackThreads` (T2). |
| `src/data/feedback/feedbackStorage.ts` | Modify | `summarizeFeedbackThread`, wrappers return the thread (T3); fire-and-forget index + deadline + `flushPendingFeedbackIndexWrites` (T4); `resolvedAt` / `resolvedBy` (T5). |
| `src/data/feedback/feedbackExport.ts` | Create | Pure two-sheet row builders, chunked sheet build, workbook build, download (T6). |
| `src/data/labels/labelsStore.ts` | Modify | `fb_export_*` label keys (T6). |
| `docs/architecture/data-system-report.md` | Modify | Background index write (T4); optional resolve fields (T5). |
| `src/components/FeedbackWidget/FeedbackWidget.openFromIndex.test.tsx` | Create | T1 — open renders before any full read (read-log counter on a memory directory). |
| `src/data/feedback/feedbackThreadMerge.test.ts` | Create | T2 — helper unit tests. |
| `src/components/FeedbackWidget/FeedbackWidget.pageBodies.test.tsx` | Create | T2 — no read when the provider holds the page; one read despite re-sort. |
| `src/components/FeedbackWidget/FeedbackWidget.optimistic.test.tsx` | Create | T3 — submit performs no widget reload; reply renders without re-fetch. |
| `src/data/feedback/feedbackStorage.test.ts` | Modify | T3 — wrappers return the thread; T4 — flush background index writes where a test inspects the index or the error log. |
| `src/data/feedback/feedbackStorage.indexWrites.test.ts` | Create | T4 — index write is background; deadlines reach `safeWriteJson`. |
| `src/data/feedback/feedbackStorage.resolvedMeta.test.ts` | Create | T5 — `resolvedAt` / `resolvedBy` semantics incl. legacy threads. |
| `src/data/feedback/feedbackExport.test.ts` | Create | T6 — row builders incl. legacy threads without `resolvedAt`. |
| `src/components/FeedbackWidget/FeedbackWidget.export.test.tsx` | Create | T7 — button gating, zero extra I/O, busy/empty/error states. |

**I/O counting.** `createMemoryDirectory(name, { trackReads: true })` already records every `getFile()` path (e.g. `5-system/feedback/threads/t2026…json`), read back with `getReadLog(dir)` / cleared with `clearReadLog(dir)` (`src/data/storage/memoryDirectory.ts`). Task 1 uses it; no new counting wrapper is needed.

---

## Task 1: Open renders from the thread index; the full read runs in the background

**Root cause (verified at `FeedbackWidget.tsx:126-148`):** `refresh()` does `await reloadUnread()` first. `reloadUnread` is `FeedbackUnreadProvider.reload` → `loadFeedback`, which opens **every** thread file; only afterwards does `listThreadSummaries` run and the list render. Panel-open latency therefore grows with the whole ticket history.

**Files:**
- Modify: `src/components/FeedbackWidget/FeedbackWidget.tsx` (the `refresh` `useCallback`, originally lines 126-148)
- Test: `src/components/FeedbackWidget/FeedbackWidget.openFromIndex.test.tsx` (create)

**Interfaces:**
- Consumes: `listThreadSummaries(dir: DirectoryHandleLike, options?: { repairIndex?: boolean }): Promise<FeedbackThreadSummary[]>`; `useFeedbackUnread(): { unreadCount: number; messages: FeedbackMessage[]; markSeen(messages?): void; reload(): Promise<void> }`; `createMemoryDirectory(name, { trackReads: true })`, `getReadLog(dir): string[]`, `clearReadLog(dir): void`; `getFeedbackThreadsDir(dir, create): Promise<DirectoryHandleLike>`.
- Produces: no new exports. Behaviour: `refresh()` resolves after `listThreadSummaries` alone; `reloadUnread()` is started afterwards, not awaited, followed by `markSeen()`.

- [ ] **Step 1: Write the failing test**

Create `src/components/FeedbackWidget/FeedbackWidget.openFromIndex.test.tsx`:

```tsx
/* @vitest-environment jsdom */
// Workstream B (2026-09-28): opening the panel must render from the thread
// INDEX first. The provider's full aggregate read (`loadFeedback`, every thread
// file) runs in the background and must never gate the first render.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { FeedbackWidget } from "./FeedbackWidget";
import { FeedbackUnreadProvider } from "../../data/feedback/FeedbackUnreadProvider";
import { listThreadSummaries, type FeedbackThread } from "../../data/feedback/feedbackStorage";
import { safeWriteJson } from "../../data/storage/safeWrite";
import { clearReadLog, createMemoryDirectory, getReadLog } from "../../data/storage/memoryDirectory";
import type { DirectoryHandleLike } from "../../data/storage/fileSystemAccess";
import { getFeedbackThreadsDir } from "../../data/workspace/workspacePaths";
import type { AuthSession } from "../../auth/authTypes";
import { clearSession, writeSession } from "../../auth/authSession";
import { resetAllLabels } from "../../data/labels/labelsStore";

const workspace = vi.hoisted(() => ({ dir: null as DirectoryHandleLike | null }));

vi.mock("../../data/workspace/useWorkspace", () => ({
  useWorkspace: () => ({ directoryHandle: workspace.dir, refreshPermissions: () => {} }),
}));

// Holds every full-aggregate read until the test opens the gate, so "the panel
// rendered before the full read" is an ordering the test controls rather than
// a race it hopes to win.
const gate = vi.hoisted(() => {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open: () => open() };
});

vi.mock("../../data/feedback/feedbackStorage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../data/feedback/feedbackStorage")>();
  return {
    ...actual,
    loadFeedback: async (dir: DirectoryHandleLike) => {
      await gate.opened;
      return actual.loadFeedback(dir);
    },
  };
});

function thread(id: string, from: string, text: string, second: number): FeedbackThread {
  return {
    id,
    from,
    role: "employee",
    category: "issue",
    text,
    timestamp: new Date(Date.UTC(2026, 8, 20, 10, 0, second)).toISOString(),
    status: "open",
    replies: [],
    revision: 1,
  };
}

const SARA_THREADS = [
  thread("t20260920100001-aaaaaaa1", "sara", "رسالة سارة الأولى", 1),
  thread("t20260920100002-aaaaaaa2", "sara", "رسالة سارة الثانية", 2),
  thread("t20260920100003-aaaaaaa3", "sara", "رسالة سارة الثالثة", 3),
];
const OTHER_THREADS = [
  thread("t20260920100004-bbbbbbb4", "omar", "رسالة عمر", 4),
  thread("t20260920100005-bbbbbbb5", "omar", "رسالة عمر الثانية", 5),
  thread("t20260920100006-bbbbbbb6", "lina", "رسالة لينا", 6),
  thread("t20260920100007-bbbbbbb7", "lina", "رسالة لينا الثانية", 7),
  thread("t20260920100008-bbbbbbb8", "huda", "رسالة هدى", 8),
];

async function seedWorkspace(): Promise<DirectoryHandleLike> {
  const root = createMemoryDirectory("root", { trackReads: true });
  const threadsDir = await getFeedbackThreadsDir(root, true);
  for (const t of [...SARA_THREADS, ...OTHER_THREADS]) {
    await safeWriteJson<FeedbackThread>(threadsDir, `${t.id}.json`, t);
  }
  // Builds threads.index.json so the steady-state open costs 0 recovery reads.
  await listThreadSummaries(root, { repairIndex: true });
  clearReadLog(root);
  return root;
}

function threadFileReads(root: DirectoryHandleLike): string[] {
  return getReadLog(root)
    .filter((path) => path.includes("/threads/") && path.endsWith(".json"))
    .map((path) => path.slice(path.lastIndexOf("/") + 1, -".json".length));
}

const SARA: AuthSession = { username: "sara", role: "employee", loginAt: "2026-09-28T08:00:00.000Z" };

describe("FeedbackWidget — open renders from the index before any full read", () => {
  beforeEach(() => {
    clearSession();
    resetAllLabels();
    localStorage.clear();
  });
  afterEach(() => {
    gate.open();
    cleanup();
    clearSession();
    resetAllLabels();
    localStorage.clear();
    workspace.dir = null;
  });

  it("shows the user's threads while the provider's full read is still pending", async () => {
    const root = await seedWorkspace();
    workspace.dir = root;
    writeSession(SARA);
    render(
      <FeedbackUnreadProvider session={SARA}>
        <FeedbackWidget />
      </FeedbackUnreadProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: /التواصل والاقتراحات|غير مقروءة/ }));

    // The full read is still gated, yet the panel has already rendered.
    expect(await screen.findByText("رسالة سارة الأولى")).toBeInTheDocument();
    expect(await screen.findByText("رسالة سارة الثالثة")).toBeInTheDocument();

    // Only the visible page's thread files were opened -- never another user's.
    const reads = new Set(threadFileReads(root));
    for (const other of OTHER_THREADS) expect(reads.has(other.id)).toBe(false);
    for (const own of SARA_THREADS) expect(reads.has(own.id)).toBe(true);

    // The background reload still happens once the full read is allowed to run.
    gate.open();
    await waitFor(() => {
      const after = new Set(threadFileReads(root));
      for (const other of OTHER_THREADS) expect(after.has(other.id)).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/FeedbackWidget/FeedbackWidget.openFromIndex.test.tsx`
Expected: FAIL — `Unable to find an element with the text: رسالة سارة الأولى` (after ~5 s). The panel shows only the submit form because `refresh()` is blocked on the gated `loadFeedback`.

- [ ] **Step 3: Implement — reorder `refresh`**

In `src/components/FeedbackWidget/FeedbackWidget.tsx`, replace this block exactly:

```tsx
  const refresh = useCallback(async () => {
    if (!directoryHandle) return;
    setLoading(true);
    // SEQUENCED, not Promise.all. Both branches walk the same feedback
    // directory: `reloadUnread` → `loadFeedback` → `listThreadSummaries`, and
    // the explicit call below is a second `listThreadSummaries`. Running them
    // concurrently made one panel open issue two overlapping reconciles of the
    // same shared file from the same tab — pointless load on the workspace the
    // 2026-08-25 incident showed is the scarce resource. Sequencing costs a
    // little panel-open latency, already covered by the spinner.
    //
    // Order matters: the read-only pass runs first, so the repairing pass below
    // sees an already-migrated, warm state.
    await reloadUnread();
    // `repairIndex` ONLY here: this runs when a user opens or refreshes the
    // feedback panel, a deliberate action at human rate. The 60 s background
    // poll in FeedbackUnreadProvider must never ask for it — see
    // listThreadSummaries' doc for what that cost.
    const list = await listThreadSummaries(directoryHandle, { repairIndex: true });
    setSummaries(list);
    setLoading(false);
    markSeen();
  }, [directoryHandle, markSeen, reloadUnread]);
```

with:

```tsx
  const refresh = useCallback(async () => {
    if (!directoryHandle) return;
    setLoading(true);
    // INDEX FIRST, full read in the BACKGROUND (Workstream B, 2026-09-28).
    // This used to `await reloadUnread()` before anything else -- and that is
    // `loadFeedback`, which opens EVERY thread file in the workspace. So the
    // panel showed its spinner for as long as the whole ticket history took to
    // read, and the cost grew with every ticket ever filed.
    //
    // The list view needs only the summaries (one index read + one names-only
    // listing), so it renders from those immediately. The provider's full read
    // still runs -- the unread dot needs every reply's author and timestamp --
    // but only AFTER the summaries landed, so the two walks of the feedback
    // directory stay SEQUENCED (never two overlapping reconciles of the same
    // shared file from one tab), and it no longer gates the first render.
    //
    // `repairIndex` ONLY here: this runs when a user opens or refreshes the
    // feedback panel, a deliberate action at human rate. The background poll in
    // FeedbackUnreadProvider must never ask for it -- see listThreadSummaries'
    // doc for what that cost.
    try {
      const list = await listThreadSummaries(directoryHandle, { repairIndex: true });
      setSummaries(list);
    } catch {
      // Leave the last-known list in place; the background reload below still
      // runs and the page effect reads whatever it can.
    } finally {
      setLoading(false);
    }
    markSeen();
    void reloadUnread().then(() => markSeen());
  }, [directoryHandle, markSeen, reloadUnread]);
```

- [ ] **Step 4: Run the test to verify it passes, plus the existing widget suites**

Run: `npx vitest run src/components/FeedbackWidget/ src/data/feedback/`
Expected: PASS (all files, including the new one and the existing `FeedbackWidget.threads/replyStatus/unreadDot/test.tsx`).

- [ ] **Step 5: Tier-2 gates**

Run: `npm run lint && npm run typecheck && npm run test:run`
Expected: all three exit 0.

- [ ] **Step 6: Edit log**

Run: `npm run editlog -- --tier=2 --bump=major --append --sync-package "Fix (feedback): open the panel from the thread index, full read in the background"`

Fill the new entry's placeholders:
- **Why:** Opening the feedback panel awaited `loadFeedback` (every thread file in the workspace) before reading the index, so the panel sat on its spinner for as long as the entire ticket history took to read, and got slower with every ticket filed.
- **What changed:** `refresh()` now reads `listThreadSummaries` (index + one listing) and renders immediately; the provider's full reload starts afterwards in the background and marks seen when it lands. The two walks stay sequenced. New regression test counts thread-file reads on a memory directory while the full read is held back.
- **Before / After:** the old and new `refresh` blocks from Step 3.

- [ ] **Step 7: Commit**

```bash
git add src/components/FeedbackWidget/FeedbackWidget.tsx src/components/FeedbackWidget/FeedbackWidget.openFromIndex.test.tsx "docs/edit logs/" package.json
git commit -m "$(cat <<'MSG'
Fix (feedback): open the panel from the thread index, full read in the background

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NU4UP8LM3qkAnTNccmKZEJ
MSG
)"
```

---

## Task 2: Page bodies from the provider's in-memory threads; effect keyed on a sorted id set

**Root cause (verified at `FeedbackWidget.tsx:320-345` and `FeedbackUnreadProvider.tsx:136-143`):** the page effect calls `loadThreads(visibleIds)` for every visible id even though the provider's `messages` (the same `FeedbackThread` objects, already read by `loadFeedback`) holds them. Its key is the **ordered** `visibleIds.join("|")`; the "my messages" list re-sorts by latest activity as bodies arrive (`:292-298`), which changes the key and re-reads the same page a second time.

**Files:**
- Create: `src/data/feedback/feedbackThreadMerge.ts`
- Create: `src/data/feedback/feedbackThreadMerge.test.ts`
- Modify: `src/components/FeedbackWidget/FeedbackWidget.tsx` (imports; `useFeedbackUnread()` destructuring, originally line 78; sort/filter block, originally 268-304; visible-ids effect, originally 320-345; the two card lookups, originally 554 and 590)
- Test: `src/components/FeedbackWidget/FeedbackWidget.pageBodies.test.tsx` (create)

**Interfaces:**
- Consumes: `FeedbackMessage` / `FeedbackThread` types from `src/data/feedback/feedbackStorage.ts` (`FeedbackThread extends FeedbackMessage` and adds `revision?: number`); `useFeedbackUnread().messages: FeedbackMessage[]`.
- Produces (in `src/data/feedback/feedbackThreadMerge.ts`):
  - `pickFresherThread(local: FeedbackMessage | undefined, polled: FeedbackMessage | undefined): FeedbackMessage | undefined`
  - `indexThreadsById(threads: readonly FeedbackMessage[]): Map<string, FeedbackMessage>`
  - `missingThreadIds(ids: readonly string[], local: Readonly<Record<string, FeedbackMessage>>, polled: ReadonlyMap<string, FeedbackMessage>): string[]` (de-duplicated, sorted)
  - `mergeFeedbackThreads(polled: readonly FeedbackMessage[], local: Readonly<Record<string, FeedbackMessage>>): FeedbackMessage[]` (newest-first by `timestamp`; used by Task 7)

- [ ] **Step 1: Write the failing helper test**

Create `src/data/feedback/feedbackThreadMerge.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type { FeedbackMessage, FeedbackThread } from "./feedbackStorage";
import {
  indexThreadsById,
  mergeFeedbackThreads,
  missingThreadIds,
  pickFresherThread,
} from "./feedbackThreadMerge";

function thread(overrides: Partial<FeedbackThread> & { id: string }): FeedbackThread {
  return {
    from: "sara",
    role: "employee",
    category: "issue",
    text: "نص",
    timestamp: "2026-09-20T10:00:00.000Z",
    status: "open",
    replies: [],
    ...overrides,
  };
}

const REPLY = { from: "admin", role: "admin", text: "رد", timestamp: "2026-09-21T10:00:00.000Z" };

describe("pickFresherThread", () => {
  it("returns whichever copy exists when only one does", () => {
    const t = thread({ id: "t1" });
    expect(pickFresherThread(t, undefined)).toBe(t);
    expect(pickFresherThread(undefined, t)).toBe(t);
    expect(pickFresherThread(undefined, undefined)).toBeUndefined();
  });

  it("prefers the higher revision", () => {
    const local = thread({ id: "t1", revision: 3 });
    const polled = thread({ id: "t1", revision: 2, replies: [REPLY, REPLY] });
    expect(pickFresherThread(local, polled)).toBe(local);
    expect(pickFresherThread(thread({ id: "t1", revision: 1 }), polled)).toBe(polled);
  });

  it("falls back to reply count, then keeps the local copy on a full tie", () => {
    const local = thread({ id: "t1" });
    const polled: FeedbackMessage = thread({ id: "t1", replies: [REPLY] });
    expect(pickFresherThread(local, polled)).toBe(polled);
    const tieLocal = thread({ id: "t1", revision: 2 });
    const tiePolled = thread({ id: "t1", revision: 2 });
    expect(pickFresherThread(tieLocal, tiePolled)).toBe(tieLocal);
  });
});

describe("missingThreadIds", () => {
  it("returns only ids neither source holds, de-duplicated and sorted", () => {
    const local = { b: thread({ id: "b" }) };
    const polled = indexThreadsById([thread({ id: "d" })]);
    expect(missingThreadIds(["e", "b", "c", "d", "c", "a"], local, polled)).toEqual(["a", "c", "e"]);
  });

  it("is order-insensitive -- a re-sort of the page yields the same set", () => {
    const polled = indexThreadsById([]);
    expect(missingThreadIds(["x", "y"], {}, polled)).toEqual(missingThreadIds(["y", "x"], {}, polled));
  });
});

describe("mergeFeedbackThreads", () => {
  it("unions both sources, resolves each id to its fresher copy, newest-first", () => {
    const polledOld = thread({ id: "t1", revision: 1, timestamp: "2026-09-20T10:00:00.000Z" });
    const polledOther = thread({ id: "t2", revision: 1, timestamp: "2026-09-22T10:00:00.000Z" });
    const localNewer = thread({ id: "t1", revision: 2, replies: [REPLY], timestamp: "2026-09-20T10:00:00.000Z" });
    const localOnly = thread({ id: "t3", revision: 1, timestamp: "2026-09-23T10:00:00.000Z" });

    const merged = mergeFeedbackThreads([polledOld, polledOther], { t1: localNewer, t3: localOnly });

    expect(merged.map((t) => t.id)).toEqual(["t3", "t2", "t1"]);
    expect(merged.find((t) => t.id === "t1")).toBe(localNewer);
  });
});
```

- [ ] **Step 2: Write the failing widget test**

Create `src/components/FeedbackWidget/FeedbackWidget.pageBodies.test.tsx`:

```tsx
/* @vitest-environment jsdom */
// Workstream B (2026-09-28): a page's thread bodies come from the provider's
// in-memory aggregate first; only ids missing there are read from disk, and a
// re-sort of the visible rows must never trigger a second read of the same set.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { FeedbackWidget } from "./FeedbackWidget";
import { FeedbackUnreadProvider } from "../../data/feedback/FeedbackUnreadProvider";
import type {
  FeedbackThread,
  FeedbackThreadSummary,
} from "../../data/feedback/feedbackStorage";
import type { AuthSession } from "../../auth/authTypes";
import { clearSession, writeSession } from "../../auth/authSession";
import { resetAllLabels } from "../../data/labels/labelsStore";

const directoryHandle = { name: "workspace" };

vi.mock("../../data/workspace/useWorkspace", () => ({
  useWorkspace: () => ({ directoryHandle, refreshPermissions: () => {} }),
}));

const storage = vi.hoisted(() => ({
  listThreadSummaries: vi.fn<() => Promise<FeedbackThreadSummary[]>>(),
  loadThreads: vi.fn<(dir: unknown, ids: readonly string[]) => Promise<FeedbackThread[]>>(),
  loadFeedback: vi.fn<() => Promise<FeedbackThread[]>>(),
}));

vi.mock("../../data/feedback/feedbackStorage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../data/feedback/feedbackStorage")>();
  return {
    ...actual,
    listThreadSummaries: storage.listThreadSummaries,
    loadThreads: storage.loadThreads,
    loadFeedback: storage.loadFeedback,
  };
});

const SARA: AuthSession = { username: "sara", role: "employee", loginAt: "2026-09-28T08:00:00.000Z" };

const OLDER_BUT_ANSWERED: FeedbackThread = {
  id: "t20260820100000-aaaaaaaa",
  from: "sara",
  role: "employee",
  category: "issue",
  text: "المشكلة الأولى",
  timestamp: "2026-08-20T10:00:00.000Z",
  status: "open",
  replies: [{ from: "admin", role: "admin", text: "تم الاطلاع", timestamp: "2026-08-24T09:00:00.000Z" }],
  revision: 2,
};

const NEWER_NO_REPLY: FeedbackThread = {
  id: "t20260823100000-bbbbbbbb",
  from: "sara",
  role: "employee",
  category: "inquiry",
  text: "استفسار جديد",
  timestamp: "2026-08-23T10:00:00.000Z",
  status: "open",
  replies: [],
  revision: 1,
};

function summaryOf(thread: FeedbackThread): FeedbackThreadSummary {
  return {
    threadId: thread.id,
    from: thread.from,
    role: thread.role,
    category: thread.category,
    status: thread.status,
    createdAt: thread.timestamp,
    lastActivityAt: thread.timestamp,
    preview: thread.text,
  };
}

function renderProvider() {
  writeSession(SARA);
  return render(
    <FeedbackUnreadProvider session={SARA}>
      <FeedbackWidget />
    </FeedbackUnreadProvider>
  );
}

function openPanel() {
  fireEvent.click(screen.getByRole("button", { name: /التواصل والاقتراحات|غير مقروءة/ }));
}

describe("FeedbackWidget — page bodies come from the provider first", () => {
  beforeEach(() => {
    clearSession();
    resetAllLabels();
    localStorage.clear();
    storage.listThreadSummaries.mockReset();
    storage.loadThreads.mockReset();
    storage.loadFeedback.mockReset();
  });
  afterEach(() => {
    cleanup();
    clearSession();
    resetAllLabels();
    localStorage.clear();
  });

  it("reads no thread file when the provider already holds the page's threads", async () => {
    // Index order matches listThreadSummaries' createdAt-desc contract.
    storage.listThreadSummaries.mockResolvedValue([summaryOf(NEWER_NO_REPLY), summaryOf(OLDER_BUT_ANSWERED)]);
    storage.loadFeedback.mockResolvedValue([NEWER_NO_REPLY, OLDER_BUT_ANSWERED]);
    storage.loadThreads.mockResolvedValue([]);

    renderProvider();
    // Let the provider's mount-time aggregate land before the panel opens.
    await waitFor(() => expect(storage.loadFeedback).toHaveBeenCalled());
    await act(async () => {});
    openPanel();

    expect(await screen.findByText("تم الاطلاع")).toBeInTheDocument();
    expect(screen.getByText("استفسار جديد")).toBeInTheDocument();
    expect(storage.loadThreads).not.toHaveBeenCalled();
  });

  it("reads the missing page once, even though the rows re-sort as bodies arrive", async () => {
    storage.listThreadSummaries.mockResolvedValue([summaryOf(NEWER_NO_REPLY), summaryOf(OLDER_BUT_ANSWERED)]);
    // The provider knows nothing yet, so both bodies must come from disk.
    storage.loadFeedback.mockResolvedValue([]);
    storage.loadThreads.mockResolvedValue([OLDER_BUT_ANSWERED, NEWER_NO_REPLY]);

    renderProvider();
    openPanel();

    // OLDER_BUT_ANSWERED's reply is the newest activity, so once its body lands
    // the "my messages" list re-orders -- the old effect key (the joined,
    // ORDERED visible ids) changed with it and read the same page again.
    await waitFor(() => {
      const bodies = screen.getAllByText(/المشكلة الأولى|استفسار جديد/).map((el) => el.textContent);
      expect(bodies).toEqual(["المشكلة الأولى", "استفسار جديد"]);
    });
    await act(async () => {});
    expect(storage.loadThreads).toHaveBeenCalledTimes(1);
    expect([...storage.loadThreads.mock.calls[0]![1]]).toEqual(
      [NEWER_NO_REPLY.id, OLDER_BUT_ANSWERED.id].sort()
    );
  });
});
```

- [ ] **Step 3: Run both tests to verify they fail**

Run: `npx vitest run src/data/feedback/feedbackThreadMerge.test.ts src/components/FeedbackWidget/FeedbackWidget.pageBodies.test.tsx`
Expected: FAIL —
- `feedbackThreadMerge.test.ts`: `Failed to resolve import "./feedbackThreadMerge"`.
- `pageBodies` test 1: `Unable to find an element with the text: تم الاطلاع` (the widget ignores the provider's copies and `loadThreads` returns `[]`).
- `pageBodies` test 2: `expected "vi.fn()" to be called 1 times, but got 2 times`.

- [ ] **Step 4: Implement the helper module**

Create `src/data/feedback/feedbackThreadMerge.ts`:

```ts
import type { FeedbackMessage } from "./feedbackStorage";

/**
 * Two in-memory copies of the same conversation can coexist in the feedback
 * widget: the provider's polled aggregate (`FeedbackUnreadProvider.messages`,
 * refreshed by the background poll) and the widget's own page-scoped copy
 * (thread bodies it read itself, or a thread it just wrote and applied
 * optimistically). Neither is always newer, so every consumer resolves a
 * thread through these helpers instead of trusting one source.
 *
 * Pure and I/O-free: this module never touches the workspace.
 */

function revisionOf(thread: FeedbackMessage): number {
  const revision = (thread as { revision?: unknown }).revision;
  return typeof revision === "number" ? revision : 0;
}

/**
 * The fresher of two copies of ONE thread. Higher `revision` wins (every write
 * of a thread file bumps it); on a tie -- or for legacy messages that carry no
 * revision at all -- the copy with more replies wins, and a full tie keeps the
 * local copy, which is the one this tab wrote or read most recently.
 */
export function pickFresherThread(
  local: FeedbackMessage | undefined,
  polled: FeedbackMessage | undefined
): FeedbackMessage | undefined {
  if (!local) return polled;
  if (!polled) return local;
  const localRevision = revisionOf(local);
  const polledRevision = revisionOf(polled);
  if (localRevision !== polledRevision) return localRevision > polledRevision ? local : polled;
  return polled.replies.length > local.replies.length ? polled : local;
}

/** Id -> thread lookup over the provider's polled list. */
export function indexThreadsById(
  threads: readonly FeedbackMessage[]
): Map<string, FeedbackMessage> {
  return new Map(threads.map((thread) => [thread.id, thread]));
}

/**
 * The ids from `ids` that neither source holds yet -- the only thread files the
 * page actually has to read. De-duplicated and SORTED, so the result is a
 * stable set identity: re-ordering the visible rows (the "my messages" list
 * re-sorts by latest activity as bodies arrive) never changes it.
 */
export function missingThreadIds(
  ids: readonly string[],
  local: Readonly<Record<string, FeedbackMessage>>,
  polled: ReadonlyMap<string, FeedbackMessage>
): string[] {
  return [...new Set(ids)].filter((id) => !local[id] && !polled.has(id)).sort();
}

/**
 * Every thread either source knows, each resolved to its fresher copy,
 * newest-first by creation time. Used by the admin export so a thread this tab
 * just created or replied to is included even before the next poll lands.
 */
export function mergeFeedbackThreads(
  polled: readonly FeedbackMessage[],
  local: Readonly<Record<string, FeedbackMessage>>
): FeedbackMessage[] {
  const byId = indexThreadsById(polled);
  for (const thread of Object.values(local)) {
    const fresher = pickFresherThread(thread, byId.get(thread.id));
    if (fresher) byId.set(thread.id, fresher);
  }
  return [...byId.values()].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}
```

- [ ] **Step 5: Implement the widget changes**

All edits in `src/components/FeedbackWidget/FeedbackWidget.tsx`.

5a. Imports — replace:

```tsx
import { canManageFeedback } from "../../data/feedback/feedbackUnread";
```

with:

```tsx
import { canManageFeedback } from "../../data/feedback/feedbackUnread";
import {
  indexThreadsById,
  missingThreadIds,
  pickFresherThread,
} from "../../data/feedback/feedbackThreadMerge";
```

5b. Provider destructuring — replace:

```tsx
  const { unreadCount, markSeen, reload: reloadUnread } = useFeedbackUnread();
```

with:

```tsx
  const {
    unreadCount,
    markSeen,
    reload: reloadUnread,
    messages: polledMessages,
  } = useFeedbackUnread();
```

5c. Add `threadFor` — replace:

```tsx
  // All three run on SUMMARIES -- status, author and count are index fields, so
  // filtering and paginating costs no thread reads at all.
```

with:

```tsx
  // A thread body can come from two places: the provider's polled aggregate
  // (already in memory -- reading it again from disk is pure waste) or this
  // widget's own page-scoped copy. `threadFor` resolves each id to the fresher
  // of the two; see feedbackThreadMerge.ts.
  const polledById = indexThreadsById(polledMessages);
  const threadFor = (threadId: string): FeedbackMessage | undefined =>
    pickFresherThread(threadsById[threadId], polledById.get(threadId));

  // All three run on SUMMARIES -- status, author and count are index fields, so
  // filtering and paginating costs no thread reads at all.
```

5d. Sort comment — replace:

```tsx
  // loaded already (`threadsById`, filled by the effect below) and falls back
```

with:

```tsx
  // loaded already (`threadFor` -- the provider's polled copy or this page's
  // own read) and falls back
```

5e. Sort and filters — replace:

```tsx
    const ta = threadsById[a.threadId];
    const tb = threadsById[b.threadId];
```

with:

```tsx
    const ta = threadFor(a.threadId);
    const tb = threadFor(b.threadId);
```

then replace `matchesReplyFilter(threadsById[s.threadId], myReplyFilter)` with `matchesReplyFilter(threadFor(s.threadId), myReplyFilter)`, and `matchesReplyFilter(threadsById[s.threadId], adminReplyFilter)` with `matchesReplyFilter(threadFor(s.threadId), adminReplyFilter)`.

5f. The page effect — replace this block exactly:

```tsx
  const visibleIds = visibleSummaries.map((summary) => summary.threadId);
  // Stable dependency: the array identity changes on every render, the joined
  // key does not.
  const visibleIdsKey = visibleIds.join("|");

  useEffect(() => {
    if (!directoryHandle || !open || visibleIds.length === 0) return;
    let cancelled = false;
    loadThreads(directoryHandle, visibleIds)
```

with:

```tsx
  const visibleIds = visibleSummaries.map((summary) => summary.threadId);
  // Only the ids NEITHER source holds are read from disk, and the effect keys on
  // that SORTED set -- not on the ordered visible ids. The old ordered key
  // changed every time the "my messages" list re-sorted by latest activity as
  // bodies streamed in, which re-read the same page; and it did NOT change when
  // a reply dropped one thread from `threadsById`, which left that card stuck
  // on the loading line. A set key has neither failure: re-ordering never
  // changes it, and a thread that goes missing changes it immediately.
  //
  // An id whose file cannot be read stays in the set, so the key does not
  // change and the read is not retried in a loop; the card keeps its loading
  // line until the next open or refresh, as before.
  const missingIdsKey = missingThreadIds(visibleIds, threadsById, polledById).join("|");

  useEffect(() => {
    if (!directoryHandle || !open || missingIdsKey === "") return;
    let cancelled = false;
    loadThreads(directoryHandle, missingIdsKey.split("|"))
```

and at the end of that same effect replace:

```tsx
    // eslint-disable-next-line react-hooks/exhaustive-deps -- visibleIdsKey is the stable identity of visibleIds
  }, [directoryHandle, open, visibleIdsKey]);
```

with:

```tsx
  }, [directoryHandle, open, missingIdsKey]);
```

5g. The two card lookups — replace both occurrences of `const msg = threadsById[s.threadId];` (one in the "my messages" list, one in the admin all-messages list) with `const msg = threadFor(s.threadId);`. After this step, `grep -n "threadsById\[" src/components/FeedbackWidget/FeedbackWidget.tsx` must print only the `threadFor` line.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/data/feedback/feedbackThreadMerge.test.ts src/components/FeedbackWidget/ src/data/feedback/`
Expected: PASS (all files).

- [ ] **Step 7: Tier-2 gates**

Run: `npm run lint && npm run typecheck && npm run test:run`
Expected: all exit 0.

- [ ] **Step 8: Edit log**

Run: `npm run editlog -- --tier=2 --append --sync-package "Fix (feedback): page bodies from the provider's in-memory threads"`

Fill in:
- **Why:** Each page re-read thread files the provider had already loaded, and the page effect was keyed on the ORDERED visible ids, so the activity re-sort that happens as bodies arrive re-read the same page a second time.
- **What changed:** New pure `feedbackThreadMerge.ts` (fresher-copy resolution, missing-id set, merge). The widget resolves every card through `threadFor` (provider copy vs. its own copy) and reads only the ids neither holds; the effect keys on the sorted missing-id set.
- **Before / After:** the old and new page-effect blocks from Step 5f.

- [ ] **Step 9: Commit**

```bash
git add src/data/feedback/feedbackThreadMerge.ts src/data/feedback/feedbackThreadMerge.test.ts src/components/FeedbackWidget/FeedbackWidget.tsx src/components/FeedbackWidget/FeedbackWidget.pageBodies.test.tsx "docs/edit logs/" package.json
git commit -m "$(cat <<'MSG'
Fix (feedback): page bodies from the provider's in-memory threads

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NU4UP8LM3qkAnTNccmKZEJ
MSG
)"
```

---

## Task 3: Optimistic submit/reply; no duplicate reloads; no stuck reply card

**Root cause (verified at `FeedbackWidget.tsx:189-190, 218-224` and `feedbackStorage.ts:959-975`):** after a submit or reply the widget fires `void refresh(); void reloadUnread();` — `refresh` itself reloads the provider, so that is two full reads of every thread file plus an index read, for data the write already returned (`replyToFeedback` / `submitFeedback` discard it). The reply handler also deletes `threadsById[msgId]` and relied on the page effect to re-read it, which it did not do for an unchanged page, so the card sat on «جاري التحميل...».

**Files:**
- Modify: `src/data/feedback/feedbackStorage.ts` (add `summarizeFeedbackThread` above `function summarize`, originally line 313; the two wrappers at the end of the file, originally 959-975)
- Modify: `src/components/FeedbackWidget/FeedbackWidget.tsx` (imports; `handleSubmit`, originally 176-197; `handleReply`, originally 199-231)
- Modify: `src/data/feedback/feedbackStorage.test.ts` (import list + one new `describe` at the end)
- Test: `src/components/FeedbackWidget/FeedbackWidget.optimistic.test.tsx` (create)

**Interfaces:**
- Consumes: `createThread(dir, payload): Promise<FeedbackThread>`, `appendReply(dir, threadId, reply, resolve): Promise<FeedbackThread>` (both already return the written thread); `threadFor` / `missingIdsKey` from Task 2 (the page effect re-reads nothing when `threadsById` holds the id).
- Produces:
  - `export function summarizeFeedbackThread(thread: FeedbackThread): FeedbackThreadSummary`
  - `submitFeedback(dir, payload): Promise<FeedbackThread>` (was `Promise<void>`)
  - `replyToFeedback(dir, messageId, reply, resolve): Promise<FeedbackThread>` (was `Promise<void>`)

- [ ] **Step 1: Write the failing widget test**

Create `src/components/FeedbackWidget/FeedbackWidget.optimistic.test.tsx`:

```tsx
/* @vitest-environment jsdom */
// Workstream B (2026-09-28): submit and reply apply the thread the write
// returned, instead of re-reading the whole feedback directory (the widget's
// own refresh PLUS a provider reload -- 2 x N thread reads per click), and a
// reply no longer leaves its card stuck on the loading line.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { FeedbackWidget } from "./FeedbackWidget";
import { FeedbackUnreadProvider } from "../../data/feedback/FeedbackUnreadProvider";
import type {
  FeedbackReply,
  FeedbackThread,
  FeedbackThreadSummary,
} from "../../data/feedback/feedbackStorage";
import type { AuthSession } from "../../auth/authTypes";
import { clearSession, writeSession } from "../../auth/authSession";
import { DEFAULT_LABELS, resetAllLabels } from "../../data/labels/labelsStore";

const directoryHandle = { name: "workspace" };

vi.mock("../../data/workspace/useWorkspace", () => ({
  useWorkspace: () => ({ directoryHandle, refreshPermissions: () => {} }),
}));

const storage = vi.hoisted(() => ({
  listThreadSummaries: vi.fn<() => Promise<FeedbackThreadSummary[]>>(),
  loadThreads: vi.fn<(dir: unknown, ids: readonly string[]) => Promise<FeedbackThread[]>>(),
  loadFeedback: vi.fn<() => Promise<FeedbackThread[]>>(),
  submitFeedback: vi.fn<(dir: unknown, payload: unknown) => Promise<FeedbackThread>>(),
  replyToFeedback: vi.fn<
    (dir: unknown, id: string, reply: FeedbackReply, resolve: boolean) => Promise<FeedbackThread>
  >(),
}));

vi.mock("../../data/feedback/feedbackStorage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../data/feedback/feedbackStorage")>();
  return {
    ...actual,
    listThreadSummaries: storage.listThreadSummaries,
    loadThreads: storage.loadThreads,
    loadFeedback: storage.loadFeedback,
    submitFeedback: storage.submitFeedback,
    replyToFeedback: storage.replyToFeedback,
  };
});

const SARA: AuthSession = { username: "sara", role: "employee", loginAt: "2026-09-28T08:00:00.000Z" };

const EXISTING: FeedbackThread = {
  id: "t20260920100000-aaaaaaaa",
  from: "sara",
  role: "employee",
  category: "issue",
  text: "الجهاز لا يعمل",
  timestamp: "2026-09-20T10:00:00.000Z",
  status: "open",
  replies: [],
  revision: 1,
};

function summaryOf(thread: FeedbackThread): FeedbackThreadSummary {
  return {
    threadId: thread.id,
    from: thread.from,
    role: thread.role,
    category: thread.category,
    status: thread.status,
    createdAt: thread.timestamp,
    lastActivityAt: thread.timestamp,
    preview: thread.text,
  };
}

async function renderOpenAndSettle() {
  writeSession(SARA);
  render(
    <FeedbackUnreadProvider session={SARA}>
      <FeedbackWidget />
    </FeedbackUnreadProvider>
  );
  fireEvent.click(screen.getByRole("button", { name: /التواصل والاقتراحات|غير مقروءة/ }));
  // Mount-time provider load + the open's background reload.
  await waitFor(() => expect(storage.loadFeedback).toHaveBeenCalledTimes(2));
  await act(async () => {});
}

describe("FeedbackWidget — optimistic submit and reply", () => {
  beforeEach(() => {
    clearSession();
    resetAllLabels();
    localStorage.clear();
    storage.listThreadSummaries.mockReset();
    storage.loadThreads.mockReset().mockResolvedValue([]);
    storage.loadFeedback.mockReset();
    storage.submitFeedback.mockReset();
    storage.replyToFeedback.mockReset();
  });
  afterEach(() => {
    cleanup();
    clearSession();
    resetAllLabels();
    localStorage.clear();
  });

  it("submit applies the created thread and performs no full reload of its own", async () => {
    storage.listThreadSummaries.mockResolvedValue([]);
    storage.loadFeedback.mockResolvedValue([]);
    const created: FeedbackThread = {
      id: "t20260928090000-cccccccc",
      from: "sara",
      role: "employee",
      category: "suggestion",
      text: "اقتراح جديد",
      timestamp: "2026-09-28T09:00:00.000Z",
      status: "open",
      replies: [],
      revision: 1,
    };
    storage.submitFeedback.mockResolvedValue(created);

    await renderOpenAndSettle();
    const summaryReadsBefore = storage.listThreadSummaries.mock.calls.length;
    const fullReadsBefore = storage.loadFeedback.mock.calls.length;

    fireEvent.change(screen.getByLabelText(DEFAULT_LABELS.fb_message_label), {
      target: { value: "اقتراح جديد" },
    });
    fireEvent.click(screen.getByRole("button", { name: DEFAULT_LABELS.fb_submit_btn }));
    expect(await screen.findByText(DEFAULT_LABELS.fb_success_title)).toBeInTheDocument();
    await act(async () => {});

    // No widget refresh (index + listing) and exactly ONE provider reload --
    // not the old `refresh()` + `reloadUnread()` pair.
    expect(storage.listThreadSummaries.mock.calls.length).toBe(summaryReadsBefore);
    await waitFor(() => expect(storage.loadFeedback.mock.calls.length).toBe(fullReadsBefore + 1));

    // The new thread is already in "my messages", body and all, with no read.
    fireEvent.click(screen.getByRole("button", { name: DEFAULT_LABELS.fb_success_send_another }));
    expect(await screen.findByText("اقتراح جديد")).toBeInTheDocument();
    expect(storage.loadThreads).not.toHaveBeenCalled();
  });

  it("reply renders the new reply immediately, with no re-fetch and no stuck loading line", async () => {
    storage.listThreadSummaries.mockResolvedValue([summaryOf(EXISTING)]);
    // The provider's copy stays at revision 1 for the whole test; the widget
    // must keep showing its fresher, just-written revision 2.
    storage.loadFeedback.mockResolvedValue([EXISTING]);
    const reply: FeedbackReply = {
      from: "sara",
      role: "employee",
      text: "ما زالت المشكلة قائمة",
      timestamp: "2026-09-28T09:05:00.000Z",
    };
    storage.replyToFeedback.mockResolvedValue({ ...EXISTING, replies: [reply], revision: 2 });

    await renderOpenAndSettle();
    expect(await screen.findByText("الجهاز لا يعمل")).toBeInTheDocument();
    const summaryReadsBefore = storage.listThreadSummaries.mock.calls.length;
    const threadReadsBefore = storage.loadThreads.mock.calls.length;

    fireEvent.change(screen.getByPlaceholderText(DEFAULT_LABELS.fb_reply_placeholder), {
      target: { value: "ما زالت المشكلة قائمة" },
    });
    fireEvent.click(screen.getByRole("button", { name: DEFAULT_LABELS.fb_reply_btn }));

    expect(await screen.findByText("ما زالت المشكلة قائمة")).toBeInTheDocument();
    await act(async () => {});
    expect(screen.queryByText(DEFAULT_LABELS.fb_loading)).toBeNull();
    expect(storage.loadThreads.mock.calls.length).toBe(threadReadsBefore);
    expect(storage.listThreadSummaries.mock.calls.length).toBe(summaryReadsBefore);
  });
});
```

- [ ] **Step 2: Write the failing storage test**

In `src/data/feedback/feedbackStorage.test.ts`, add `summarizeFeedbackThread,` to the import list from `"./feedbackStorage"` directly after the `submitFeedback,` line, and append at the very end of the file:

```ts

describe("feedbackStorage — writes return what they wrote (Workstream B)", () => {
  it("submitFeedback and replyToFeedback return the thread exactly as stored", async () => {
    const root = makeRoot();
    const created = await submitFeedback(root, { from: "sara", role: "employee", category: "issue", text: "خطأ" });
    expect(await loadThread(root, created.id)).toMatchObject({ id: created.id, text: "خطأ", status: "open" });

    const updated = await replyToFeedback(
      root,
      created.id,
      { from: "admin", role: "admin", text: "تم", timestamp: "2026-09-28T10:00:00.000Z" },
      true
    );
    expect(updated.id).toBe(created.id);
    expect(updated.status).toBe("resolved");
    expect(updated.replies).toHaveLength(1);
    expect(updated.revision).toBe((await loadThread(root, created.id))!.revision);
  });

  it("summarizeFeedbackThread matches the row listThreadSummaries reports", async () => {
    const root = makeRoot();
    const created = await createThread(root, { from: "sara", role: "employee", category: "inquiry", text: "سؤال\nتفاصيل" });
    const [listed] = await listThreadSummaries(root);
    expect(summarizeFeedbackThread(created)).toEqual(listed);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/components/FeedbackWidget/FeedbackWidget.optimistic.test.tsx src/data/feedback/feedbackStorage.test.ts`
Expected: FAIL —
- both `optimistic` tests: `AssertionError: expected 2 to be 1` (the old handlers call `refresh()`, a second `listThreadSummaries`).
- storage test 1: `TypeError: Cannot read properties of undefined (reading 'id')` (`submitFeedback` returns `undefined`).
- storage test 2: `TypeError: summarizeFeedbackThread is not a function`.

- [ ] **Step 4: Implement the storage changes**

In `src/data/feedback/feedbackStorage.ts`:

4a. Replace:

```ts
function summarize(thread: FeedbackThread, lastActivityAt: string): FeedbackThreadSummary {
```

with:

```ts
/**
 * The index row for `thread` as it stands now -- what `listThreadSummaries`
 * would report for it. Exported so the widget can apply a thread it just wrote
 * to its list without re-reading the index.
 */
export function summarizeFeedbackThread(thread: FeedbackThread): FeedbackThreadSummary {
  return summarize(thread, lastActivityOf(thread));
}

function summarize(thread: FeedbackThread, lastActivityAt: string): FeedbackThreadSummary {
```

(`lastActivityOf` is a hoisted function declaration later in the same file; no reordering needed.)

4b. Replace the two wrappers at the end of the file:

```ts
/** Compatibility wrapper — the widget, the sync tests and the unread tests all call this name. */
export async function submitFeedback(
  dir: DirectoryHandleLike,
  payload: { from: string; role: string; category: FeedbackCategory; text: string }
): Promise<void> {
  await createThread(dir, payload);
}

/** Compatibility wrapper — the widget, the sync tests and the unread tests all call this name. */
export async function replyToFeedback(
  dir: DirectoryHandleLike,
  messageId: string,
  reply: FeedbackReply,
  resolve: boolean
): Promise<void> {
  await appendReply(dir, messageId, reply, resolve);
}
```

with:

```ts
/**
 * Compatibility wrapper — the widget, the sync tests and the unread tests all
 * call this name. Returns the thread exactly as written so the caller can
 * apply it optimistically instead of re-reading the feedback directory.
 */
export async function submitFeedback(
  dir: DirectoryHandleLike,
  payload: { from: string; role: string; category: FeedbackCategory; text: string }
): Promise<FeedbackThread> {
  return createThread(dir, payload);
}

/**
 * Compatibility wrapper — the widget, the sync tests and the unread tests all
 * call this name. Returns the verified, just-written thread (it used to be
 * discarded, which forced the widget to re-read the whole directory to show
 * the reply it had just posted).
 */
export async function replyToFeedback(
  dir: DirectoryHandleLike,
  messageId: string,
  reply: FeedbackReply,
  resolve: boolean
): Promise<FeedbackThread> {
  return appendReply(dir, messageId, reply, resolve);
}
```

- [ ] **Step 5: Implement the widget handlers**

In `src/components/FeedbackWidget/FeedbackWidget.tsx`:

5a. In the `from "../../data/feedback/feedbackStorage"` import list, replace:

```tsx
  replyToFeedback,
  submitFeedback,
```

with:

```tsx
  replyToFeedback,
  submitFeedback,
  summarizeFeedbackThread,
```

5b. In `handleSubmit`, replace:

```tsx
      await submitFeedback(directoryHandle, {
        from: session.username,
        role: session.role,
        category,
        text: text.trim(),
      });
      setSubmitted(true);
      setText("");
      void refresh();
      void reloadUnread();
```

with:

```tsx
      const created = await submitFeedback(directoryHandle, {
        from: session.username,
        role: session.role,
        category,
        text: text.trim(),
      });
      setSubmitted(true);
      setText("");
      // Apply the thread the write returned -- no re-read. This used to run
      // `refresh()` AND `reloadUnread()`, i.e. the index + listing plus TWO
      // full reads of every thread file, for a change this tab already holds
      // in full. One provider reload remains, for the unread dot.
      setThreadsById((prev) => ({ ...prev, [created.id]: created }));
      setSummaries((prev) => [
        summarizeFeedbackThread(created),
        ...prev.filter((summary) => summary.threadId !== created.id),
      ]);
      void reloadUnread();
```

5c. In `handleReply`, replace:

```tsx
      await replyToFeedback(
        directoryHandle,
        msgId,
```

with:

```tsx
      const updated = await replyToFeedback(
        directoryHandle,
        msgId,
```

and replace:

```tsx
      setReplyTexts((prev) => ({ ...prev, [msgId]: "" }));
      setThreadsById((prev) => {
        const next = { ...prev };
        delete next[msgId];
        return next;
      });
      void refresh();
      void reloadUnread();
```

with:

```tsx
      setReplyTexts((prev) => ({ ...prev, [msgId]: "" }));
      // Apply the verified thread the write returned. The old code DELETED the
      // card's body here and relied on a refresh to bring it back -- but the
      // page effect did not re-run for an unchanged page, so the card sat on
      // the loading line until the panel was reopened.
      setThreadsById((prev) => ({ ...prev, [updated.id]: updated }));
      setSummaries((prev) =>
        prev.map((summary) =>
          summary.threadId === updated.id ? { ...summary, status: updated.status } : summary
        )
      );
      void reloadUnread();
```

(`refresh` is still used by the open effect; do not remove it.)

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/components/FeedbackWidget/ src/data/feedback/ src/data/workspace/workspaceSync.test.tsx`
Expected: PASS (all files).

- [ ] **Step 7: Tier-2 gates**

Run: `npm run lint && npm run typecheck && npm run test:run`
Expected: all exit 0.

- [ ] **Step 8: Edit log**

Run: `npm run editlog -- --tier=2 --append --sync-package "Fix (feedback): apply submitted and replied threads optimistically, drop duplicate reloads"`

Fill in:
- **Why:** Every submit and reply triggered the widget's `refresh()` (which itself reloads the provider) plus a second provider reload — two full reads of every thread file per click — and the reply handler deleted the card's body, leaving it stuck on «جاري التحميل...» because the page effect never re-ran for an unchanged page.
- **What changed:** `submitFeedback` / `replyToFeedback` return the written thread; new `summarizeFeedbackThread`. The widget applies the returned thread and its summary directly, and runs exactly one provider reload for the unread dot.
- **Before / After:** the old and new reply-handler blocks from Step 5c.

- [ ] **Step 9: Commit**

```bash
git add src/data/feedback/feedbackStorage.ts src/data/feedback/feedbackStorage.test.ts src/components/FeedbackWidget/FeedbackWidget.tsx src/components/FeedbackWidget/FeedbackWidget.optimistic.test.tsx "docs/edit logs/" package.json
git commit -m "$(cat <<'MSG'
Fix (feedback): apply submitted and replied threads optimistically, drop duplicate reloads

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NU4UP8LM3qkAnTNccmKZEJ
MSG
)"
```

---

## Task 4: Fire-and-forget index write; interactive deadline reaches the inner `safeWriteJson`

**Root cause (verified at `feedbackStorage.ts:364-374, 428, 458, 466-490`):** `createThread` and a resolving `appendReply` **await** `updateThreadsIndex` — a CAS loop on the most contended feedback file — before returning to the click, although the index is a rebuildable cache that `listThreadSummaries` reconciles on read. The thread-file and index `safeWriteJson` calls carry no `deadline`, so their ~11 s read-back ladders are unbounded even where the surrounding `casLoop` has one.

**Files:**
- Modify: `src/data/feedback/feedbackStorage.ts` (operationDeadline import, lines 4-7; `updateThreadsIndex`, originally 244-311; new helpers after it; `createThread`, originally 364-376; `appendReply`, originally 404-490)
- Modify: `src/data/feedback/feedbackStorage.test.ts` (flush background writes in 11 existing tests, listed in Step 6)
- Modify: `docs/architecture/data-system-report.md` (the `threads.index.json` row, originally line 381)
- Test: `src/data/feedback/feedbackStorage.indexWrites.test.ts` (create)

**Interfaces:**
- Consumes: `createDeadline(budgetMs: number, label: string): OperationDeadline`, `INTERACTIVE_WRITE_DEADLINE_MS` (30 000), `type OperationDeadline` from `src/data/storage/operationDeadline.ts`; `safeWriteJson(dir, fileName, value, options?: { deadline?: OperationDeadline; … })`; `casLoop(fn, { deadline?, … })`; `logError(context, error)`.
- Produces:
  - `export async function flushPendingFeedbackIndexWrites(): Promise<void>` — resolves once every background index write started so far has settled; never rejects.
  - Deadline labels (asserted by tests): thread create `"feedback:createThread"`, reply `"feedback:threadReply"` (casLoop and inner write share one object), index `"feedback:threadsIndex"`.
  - Error-log contexts unchanged: `"feedback:createThreadIndex"`, `"feedback:statusIndex"`.

- [ ] **Step 1: Write the failing test**

Create `src/data/feedback/feedbackStorage.indexWrites.test.ts`:

```ts
// Workstream B (2026-09-28): the threads.index.json update after a create or a
// status change is a REBUILDABLE-CACHE write, so the user's click must not wait
// for it; and every write on the interactive path carries the interactive
// deadline down into safeWriteJson's own read-back ladders.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../storage/safeWrite", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../storage/safeWrite")>();
  return { ...actual, safeWriteJson: vi.fn(actual.safeWriteJson) };
});

import { safeWriteJson } from "../storage/safeWrite";
import { clearErrors, getRecentErrors } from "../storage/errorLogger";
import {
  clearSimulatedFaults,
  createMemoryDirectory,
  setSimulatedFaults,
} from "../storage/memoryDirectory";
import {
  appendReply,
  createThread,
  FEEDBACK_THREADS_INDEX_FILE,
  flushPendingFeedbackIndexWrites,
  loadThreadsIndex,
} from "./feedbackStorage";

const writeSpy = vi.mocked(safeWriteJson);

function deadlineLabelsFor(fileName: string): (string | undefined)[] {
  return writeSpy.mock.calls
    .filter((call) => call[1] === fileName)
    .map((call) => {
      const options = call[3];
      return typeof options === "object" && options !== null ? options.deadline?.label : undefined;
    });
}

describe("feedbackStorage — index writes are background, writes carry a deadline", () => {
  afterEach(async () => {
    await flushPendingFeedbackIndexWrites();
    writeSpy.mockClear();
  });

  it("createThread resolves before its index write has finished failing", async () => {
    const root = createMemoryDirectory("root");
    setSimulatedFaults(root, [
      {
        operation: "createWritable",
        name: FEEDBACK_THREADS_INDEX_FILE,
        errorName: "InvalidStateError",
        times: Number.POSITIVE_INFINITY,
      },
    ]);
    clearErrors();

    await createThread(root, { from: "sara", role: "employee", category: "issue", text: "رسالة" });

    // The failing index write needs its retry ladder to give up before it can
    // log -- which the click no longer waits for.
    expect(getRecentErrors().filter((e) => e.context.startsWith("feedback:createThreadIndex"))).toHaveLength(0);

    await flushPendingFeedbackIndexWrites();
    expect(getRecentErrors().filter((e) => e.context.startsWith("feedback:createThreadIndex"))).toHaveLength(1);
    clearSimulatedFaults(root);
  });

  it("the background index write still lands", async () => {
    const root = createMemoryDirectory("root");
    const thread = await createThread(root, { from: "sara", role: "employee", category: "issue", text: "رسالة" });
    await flushPendingFeedbackIndexWrites();
    expect((await loadThreadsIndex(root)).threads.map((t) => t.threadId)).toEqual([thread.id]);
  });

  it("passes the interactive deadline to the thread-file and index writes", async () => {
    const root = createMemoryDirectory("root");
    writeSpy.mockClear();

    const thread = await createThread(root, { from: "sara", role: "employee", category: "issue", text: "رسالة" });
    await flushPendingFeedbackIndexWrites();
    expect(deadlineLabelsFor(`${thread.id}.json`)).toEqual(["feedback:createThread"]);
    expect(deadlineLabelsFor(FEEDBACK_THREADS_INDEX_FILE)).toEqual(["feedback:threadsIndex"]);

    writeSpy.mockClear();
    await appendReply(
      root,
      thread.id,
      { from: "admin", role: "admin", text: "تم", timestamp: "2026-09-28T10:00:00.000Z" },
      true
    );
    await flushPendingFeedbackIndexWrites();
    expect(deadlineLabelsFor(`${thread.id}.json`)).toEqual(["feedback:threadReply"]);
    expect(deadlineLabelsFor(FEEDBACK_THREADS_INDEX_FILE)).toEqual(["feedback:threadsIndex"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/data/feedback/feedbackStorage.indexWrites.test.ts`
Expected: FAIL — test 1: `AssertionError: expected [ { …(6) } ] to have a length of +0 but got 1` (the awaited index write already logged); tests 2-3: `TypeError: flushPendingFeedbackIndexWrites is not a function`.

- [ ] **Step 3: Implement in `src/data/feedback/feedbackStorage.ts`**

3a. Replace:

```ts
import {
  createDeadline,
  INTERACTIVE_WRITE_DEADLINE_MS,
} from "../storage/operationDeadline";
```

with:

```ts
import {
  createDeadline,
  INTERACTIVE_WRITE_DEADLINE_MS,
  type OperationDeadline,
} from "../storage/operationDeadline";
```

3b. `updateThreadsIndex` signature — replace:

```ts
async function updateThreadsIndex(
  dir: DirectoryHandleLike,
  apply: (threads: FeedbackThreadSummary[]) => FeedbackThreadSummary[]
): Promise<void> {
```

with:

```ts
async function updateThreadsIndex(
  dir: DirectoryHandleLike,
  apply: (threads: FeedbackThreadSummary[]) => FeedbackThreadSummary[],
  deadline?: OperationDeadline
): Promise<void> {
```

3c. Inside it, replace:

```ts
        await safeWriteJson<FeedbackThreadsIndex>(feedbackDir, FEEDBACK_THREADS_INDEX_FILE, updated);
```

with:

```ts
        await safeWriteJson<FeedbackThreadsIndex>(feedbackDir, FEEDBACK_THREADS_INDEX_FILE, updated, {
          deadline,
        });
```

and replace:

```ts
        conflictError: "تعذّر تحديث فهرس الملاحظات: تعارض في الكتابة بعد عدة محاولات.",
```

with:

```ts
        conflictError: "تعذّر تحديث فهرس الملاحظات: تعارض في الكتابة بعد عدة محاولات.",
        deadline,
```

(The migration and repair callers keep calling `updateThreadsIndex(dir, apply)` with no deadline — unchanged behaviour for them.)

3d. Insert the scheduler and flush helper immediately **before** the doc comment of `summarizeFeedbackThread` (added in Task 3; it starts `/**\n * The index row for \`thread\` as it stands now`):

```ts
/**
 * Index writes started by `createThread` / `appendReply` that have not settled
 * yet. Only `flushPendingFeedbackIndexWrites` reads this.
 */
const pendingIndexWrites = new Set<Promise<void>>();

/**
 * FIRE-AND-FORGET update of the rebuildable `threads.index.json` after a
 * create or a status change (Workstream B, 2026-09-28).
 *
 * The durable content -- the thread file -- is already written and verified
 * when this runs, and `listThreadSummaries` reconciles any thread the index
 * does not know, so nothing the user wrote rides on this write. It used to be
 * AWAITED, which put a CAS loop on the single most contended feedback file
 * between the user's click and "sent". A failure is still logged under
 * `context`, exactly as the awaited version logged it.
 */
function scheduleThreadsIndexUpdate(
  dir: DirectoryHandleLike,
  apply: (threads: FeedbackThreadSummary[]) => FeedbackThreadSummary[],
  context: string
): void {
  const write: Promise<void> = updateThreadsIndex(
    dir,
    apply,
    createDeadline(INTERACTIVE_WRITE_DEADLINE_MS, "feedback:threadsIndex")
  )
    .catch((error: unknown) => {
      logError(context, error);
    })
    .finally(() => {
      pendingIndexWrites.delete(write);
    });
  pendingIndexWrites.add(write);
}

/**
 * Resolves once every background index write started so far has settled
 * (including any started while waiting). Never rejects -- failures were
 * already logged. For tests, and for any caller that must observe the index
 * after a create or resolve.
 */
export async function flushPendingFeedbackIndexWrites(): Promise<void> {
  while (pendingIndexWrites.size > 0) {
    await Promise.allSettled([...pendingIndexWrites]);
  }
}

```

3e. In `createThread`, replace:

```ts
  const threadsDir = await getFeedbackThreadsDir(dir, true);
  await safeWriteJson<FeedbackThread>(threadsDir, feedbackThreadFileName(thread.id), thread);

  try {
    await updateThreadsIndex(dir, (threads) => [
      ...threads.filter((summary) => summary.threadId !== thread.id),
      summarize(thread, thread.timestamp),
    ]);
  } catch (error) {
    logError("feedback:createThreadIndex", error);
  }

  return thread;
```

with:

```ts
  const threadsDir = await getFeedbackThreadsDir(dir, true);
  await safeWriteJson<FeedbackThread>(threadsDir, feedbackThreadFileName(thread.id), thread, {
    deadline: createDeadline(INTERACTIVE_WRITE_DEADLINE_MS, "feedback:createThread"),
  });

  // Background, never awaited -- see scheduleThreadsIndexUpdate.
  scheduleThreadsIndexUpdate(
    dir,
    (threads) => [
      ...threads.filter((summary) => summary.threadId !== thread.id),
      summarize(thread, thread.timestamp),
    ],
    "feedback:createThreadIndex"
  );

  return thread;
```

Also in `createThread`'s doc comment, replace the sentence `The index append runs second and is genuinely best-effort:` with `The index append runs second, in the background (never awaited), and is genuinely best-effort:`.

3f. In `appendReply`, replace:

```ts
  const threadsDir = await getFeedbackThreadsDir(dir, true);
  const fileName = feedbackThreadFileName(threadId);
  let statusChanged = false;
```

with:

```ts
  const threadsDir = await getFeedbackThreadsDir(dir, true);
  const fileName = feedbackThreadFileName(threadId);
  let statusChanged = false;
  // Posting a reply is an interactive click, but this loop took casLoop's
  // DEFAULT ladder (10 x 200 ms) WITH a delayed verify re-read, nested over
  // safeWriteJson's own multi-second ladders — minutes of sleeping before the
  // user is told the reply failed. That is symptom E ("replying to a ticket
  // takes forever") from the 2026-09-13 reports. The SAME budget bounds the
  // loop and the read-back ladders inside each write.
  const deadline = createDeadline(INTERACTIVE_WRITE_DEADLINE_MS, "feedback:threadReply");
```

then replace:

```ts
        await safeWriteJson<FeedbackThread>(threadsDir, fileName, updated);
```

with:

```ts
        await safeWriteJson<FeedbackThread>(threadsDir, fileName, updated, { deadline });
```

then replace:

```ts
        conflictError: "تعذّر حفظ الرد: تعارض في الكتابة بعد عدة محاولات.",
        // Posting a reply is an interactive click, but this loop took casLoop's
        // DEFAULT ladder (10 x 200 ms) WITH a delayed verify re-read, nested
        // over safeWriteJson's own multi-second ladders — minutes of sleeping
        // before the user is told the reply failed. That is symptom E ("replying
        // to a ticket takes forever") from the 2026-09-13 reports.
        deadline: createDeadline(INTERACTIVE_WRITE_DEADLINE_MS, "feedback:threadReply"),
```

with:

```ts
        conflictError: "تعذّر حفظ الرد: تعارض في الكتابة بعد عدة محاولات.",
        deadline,
```

and finally replace the whole `if (statusChanged) { try { … } catch (error) { … } }` block:

```ts
  if (statusChanged) {
    try {
      await updateThreadsIndex(dir, (threads) =>
        threads.map((summary) =>
          summary.threadId === threadId
            ? { ...summary, status: outcome.thread.status, lastActivityAt: reply.timestamp }
            : summary
        )
      );
    } catch (error) {
      // The reply AND the status flip are already durable in the thread file,
      // verified above. This is the same rebuildable-cache write `createThread`
      // treats as best-effort, and for the same reason: throwing here told the
      // user their reply had failed AFTER it provably landed — the false-failure
      // shape of the 2026-08-25 incident — which invites them to send it again.
      //
      // The cost of losing this write, stated plainly so it is a contract and
      // not an accident: the panel's summary row can show a stale status chip
      // until the next successful index write. The repair path does not heal
      // that, because it only folds in ids the index does not know — it never
      // re-reads a thread the index already lists. The thread itself is correct
      // the moment anyone opens it.
      logError("feedback:statusIndex", error);
    }
  }
```

with:

```ts
  if (statusChanged) {
    // The reply AND the status flip are already durable in the thread file,
    // verified above. This is the same rebuildable-cache write `createThread`
    // treats as best-effort, and for the same reason: throwing here told the
    // user their reply had failed AFTER it provably landed — the false-failure
    // shape of the 2026-08-25 incident — which invites them to send it again.
    // Since Workstream B it is not even awaited (scheduleThreadsIndexUpdate).
    //
    // The cost of losing this write, stated plainly so it is a contract and
    // not an accident: the panel's summary row can show a stale status chip
    // until the next successful index write. The repair path does not heal
    // that, because it only folds in ids the index does not know — it never
    // re-reads a thread the index already lists. The thread itself is correct
    // the moment anyone opens it.
    const nextStatus = outcome.thread.status;
    scheduleThreadsIndexUpdate(
      dir,
      (threads) =>
        threads.map((summary) =>
          summary.threadId === threadId
            ? { ...summary, status: nextStatus, lastActivityAt: reply.timestamp }
            : summary
        ),
      "feedback:statusIndex"
    );
  }
```

- [ ] **Step 4: Run the new test to verify it passes**

Run: `npx vitest run src/data/feedback/feedbackStorage.indexWrites.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the existing storage suite and see the expected fallout**

Run: `npx vitest run src/data/feedback/feedbackStorage.test.ts`
Expected: FAIL — exactly these 6 tests, because they inspect the index or the error log immediately after a write whose index update is now in the background: `appends the new thread's summary to threads.index.json`, `two concurrent submits never touch the same thread file (the contention fix)`, `a reply rewrites only its own thread file and never the index`, `resolving a thread updates its own file AND its index summary`, `does not fail a durably-landed reply when only the status index write fails`, `reports the RAW cause of a failed index write, not only the Arabic sentence`.

- [ ] **Step 6: Flush background index writes in the existing tests**

In `src/data/feedback/feedbackStorage.test.ts`:

6a. Add `flushPendingFeedbackIndexWrites,` to the import list from `"./feedbackStorage"`, directly after `finalizeLegacyMigration,`.

6b. Insert the line `    await flushPendingFeedbackIndexWrites();` at each of these points (each anchor is unique in the file; insert on its own line exactly where stated):

1. Test "appends the new thread's summary to threads.index.json": immediately **before** `    const index = await loadThreadsIndex(root);` followed by `    expect(index.threads).toHaveLength(1);`.
2. Test "two concurrent submits never touch the same thread file": immediately **before** `    const index = await loadThreadsIndex(root);` followed by `    expect(index.threads.map((t) => t.from).sort()).toEqual(["userA", "userB"]);`.
3. Test "a reply rewrites only its own thread file and never the index": immediately **after** the `const other = await createThread(root, { from: "omar", … text: "خطأ آخر" });` line, preceded by the comment
   ```ts
       // Both creates' background index writes must land BEFORE the log is
       // cleared, or they would be mistaken for writes made by the reply.
   ```
4. Test "resolving a thread updates its own file AND its index summary": immediately **after** its `const thread = await createThread(...)` line, **and** immediately **before** `    expect((await loadThread(root, thread.id))!.status).toBe("resolved");`.
5. Tests "listThreadSummaries folds in a thread the index never recorded, and repairs the index", "does not re-attempt a failing index repair on every read", and "never rewrites the index from a reconstruction when the index could not be READ": immediately **after** each test's `    const known = await createThread(root, { from: "sara", role: "employee", category: "issue", text: "معروف" });` line (3 insertions).
6. Test "does not fail createThread when only the rebuildable index write fails": immediately **before** its `    clearSimulatedFaults(root);` line, preceded by the comment `    // The index write runs in the background; let it meet the fault.`
7. Test "does not fail a durably-landed reply when only the status index write fails": immediately **after** its `const thread = await createThread(...)` line (before `setSimulatedFaults`), **and** immediately **before** the comment line `    // The reply and the status flip are durable in the thread file; only the`.
8. Test "reports the RAW cause of a failed index write, not only the Arabic sentence": immediately **after** its first `await createThread(root, { from: "sara", … });` line, **and** immediately **after** `    await createThread(root, { from: "omar", role: "employee", category: "inquiry", text: "أخرى" });`.

Do not touch the fake-timer tests ("orders summaries newest-first by createdAt" and the "loadFeedback aggregate" block): they never inspect the index, and they pass unchanged.

- [ ] **Step 7: Document the change**

In `docs/architecture/data-system-report.md`, in the `threads.index.json` table row, replace the text:

```
A failed index write also no longer fails `createThread`: the thread file is already durable, and telling the user otherwise invites a duplicate. |
```

with:

```
A failed index write also no longer fails `createThread`: the thread file is already durable, and telling the user otherwise invites a duplicate. Since 2026-09-28 (Workstream B) the create / status-change index update is not even awaited: the click returns once the thread file is verified, the index write runs in the background under the 30 s interactive deadline, and a failure is still logged (`feedback:createThreadIndex` / `feedback:statusIndex`). |
```

- [ ] **Step 8: Run the feedback suites (three times, to catch ordering flakiness)**

Run: `for i in 1 2 3; do npx vitest run src/data/feedback/ src/components/FeedbackWidget/ src/data/workspace/workspaceSync.test.tsx || break; done`
Expected: PASS on all three runs.

- [ ] **Step 9: Tier-2 gates**

Run: `npm run lint && npm run typecheck && npm run test:run`
Expected: all exit 0.

- [ ] **Step 10: Edit log**

Run: `npm run editlog -- --tier=2 --append --sync-package "Fix (feedback): background index write and interactive deadline on thread writes"`

Fill in:
- **Why:** Creating or resolving a thread awaited a CAS loop on `threads.index.json` — a rebuildable cache the read path reconciles anyway — before the click returned, and the thread-file / index writes passed no deadline to `safeWriteJson`, leaving its read-back ladders unbounded.
- **What changed:** New `scheduleThreadsIndexUpdate` (fire-and-forget, failures still logged under the same contexts) and exported `flushPendingFeedbackIndexWrites`. The interactive deadline now reaches the inner `safeWriteJson` of the create, the reply (same object as its casLoop) and the index write. Existing storage tests flush background writes before inspecting the index or the error log.
- **Before / After:** the old and new `createThread` tails from Step 3e.

- [ ] **Step 11: Commit**

```bash
git add src/data/feedback/feedbackStorage.ts src/data/feedback/feedbackStorage.test.ts src/data/feedback/feedbackStorage.indexWrites.test.ts docs/architecture/data-system-report.md "docs/edit logs/" package.json
git commit -m "$(cat <<'MSG'
Fix (feedback): background index write and interactive deadline on thread writes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NU4UP8LM3qkAnTNccmKZEJ
MSG
)"
```

---

## Task 5: `resolvedAt` / `resolvedBy` stamped on resolve (optional, additive)

**Why:** the export (Task 6) needs a resolution date and resolver. Today a resolve only flips `status` and appends a reply; nothing records when or by whom.

**Files:**
- Modify: `src/data/feedback/feedbackStorage.ts` (`interface FeedbackMessage`, originally lines 22-31; the `updated` object inside `appendReply`'s casLoop attempt)
- Modify: `docs/architecture/data-system-report.md` (the `threads/{threadId}.json` row, originally line 380)
- Test: `src/data/feedback/feedbackStorage.resolvedMeta.test.ts` (create)

**Interfaces:**
- Consumes: `appendReply(dir, threadId, reply, resolve): Promise<FeedbackThread>`, `flushPendingFeedbackIndexWrites()` (Task 4), `loadThread`, `getFeedbackThreadsDir`, `safeWriteJson`.
- Produces: `FeedbackMessage.resolvedAt?: string` (ISO timestamp of the resolving reply) and `FeedbackMessage.resolvedBy?: string` (username of the resolving reply's author). Inherited by `FeedbackThread`. Set only on the `open -> resolved` transition; never overwritten afterwards; absent on older threads.

- [ ] **Step 1: Write the failing test**

Create `src/data/feedback/feedbackStorage.resolvedMeta.test.ts`:

```ts
// Workstream B (2026-09-28): resolving a thread stamps WHEN and BY WHOM, as
// new OPTIONAL fields. Older threads simply lack them -- no migration, because
// no existing field changes shape.
import { describe, expect, it } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import { safeWriteJson } from "../storage/safeWrite";
import { getFeedbackThreadsDir } from "../workspace/workspacePaths";
import {
  appendReply,
  createThread,
  flushPendingFeedbackIndexWrites,
  loadThread,
  type FeedbackThread,
} from "./feedbackStorage";

const RESOLVE_REPLY = { from: "admin", role: "admin", text: "تم الحل", timestamp: "2026-09-28T10:00:00.000Z" };

describe("feedbackStorage — resolvedAt / resolvedBy", () => {
  it("stamps resolvedAt and resolvedBy from the resolving reply, in the returned and stored thread", async () => {
    const root = createMemoryDirectory("root");
    const thread = await createThread(root, { from: "sara", role: "employee", category: "issue", text: "خطأ" });

    const updated = await appendReply(root, thread.id, RESOLVE_REPLY, true);
    await flushPendingFeedbackIndexWrites();

    expect(updated.resolvedAt).toBe("2026-09-28T10:00:00.000Z");
    expect(updated.resolvedBy).toBe("admin");
    const stored = await loadThread(root, thread.id);
    expect(stored?.resolvedAt).toBe("2026-09-28T10:00:00.000Z");
    expect(stored?.resolvedBy).toBe("admin");
  });

  it("a plain reply sets neither field", async () => {
    const root = createMemoryDirectory("root");
    const thread = await createThread(root, { from: "sara", role: "employee", category: "issue", text: "خطأ" });

    const updated = await appendReply(
      root,
      thread.id,
      { from: "admin", role: "admin", text: "نراجع", timestamp: "2026-09-28T09:00:00.000Z" },
      false
    );
    await flushPendingFeedbackIndexWrites();

    expect(updated.resolvedAt).toBeUndefined();
    expect(updated.resolvedBy).toBeUndefined();
  });

  it("resolving an already-resolved thread keeps the FIRST resolution", async () => {
    const root = createMemoryDirectory("root");
    const thread = await createThread(root, { from: "sara", role: "employee", category: "issue", text: "خطأ" });
    await appendReply(root, thread.id, RESOLVE_REPLY, true);
    await flushPendingFeedbackIndexWrites();

    const again = await appendReply(
      root,
      thread.id,
      { from: "manager1", role: "manager", text: "ملاحظة", timestamp: "2026-09-29T10:00:00.000Z" },
      true
    );
    await flushPendingFeedbackIndexWrites();

    expect(again.resolvedAt).toBe("2026-09-28T10:00:00.000Z");
    expect(again.resolvedBy).toBe("admin");
  });

  it("a legacy resolved thread without the fields still loads, with them absent", async () => {
    const root = createMemoryDirectory("root");
    const legacy: FeedbackThread = {
      id: "t20260101100000-dddddddd",
      from: "omar",
      role: "employee",
      category: "inquiry",
      text: "قديم",
      timestamp: "2026-01-01T10:00:00.000Z",
      status: "resolved",
      replies: [{ from: "admin", role: "admin", text: "تم", timestamp: "2026-01-02T10:00:00.000Z" }],
      revision: 2,
    };
    await safeWriteJson<FeedbackThread>(await getFeedbackThreadsDir(root, true), `${legacy.id}.json`, legacy);

    const loaded = await loadThread(root, legacy.id);
    expect(loaded?.status).toBe("resolved");
    expect(loaded?.resolvedAt).toBeUndefined();
    expect(loaded?.resolvedBy).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/data/feedback/feedbackStorage.resolvedMeta.test.ts`
Expected: FAIL — 2 of 4: "stamps resolvedAt and resolvedBy…" and "resolving an already-resolved thread keeps the FIRST resolution", each `AssertionError: expected undefined to be '2026-09-28T10:00:00.000Z'`. (Vitest does not type-check, so the missing property reads as `undefined`.)

- [ ] **Step 3: Implement**

3a. In `src/data/feedback/feedbackStorage.ts`, in `export interface FeedbackMessage`, replace:

```ts
  status: "open" | "resolved";
  replies: FeedbackReply[];
}
```

with:

```ts
  status: "open" | "resolved";
  replies: FeedbackReply[];
  /**
   * When and by whom the thread was first resolved (Workstream B, 2026-09-28).
   * OPTIONAL and ADDITIVE: set by `appendReply` only on the open -> resolved
   * transition, from the resolving reply. Threads resolved before this field
   * existed, and legacy `messages.json` entries, simply lack both -- no
   * migration, because no existing field changes shape. Consumers that need a
   * value for those (the admin export) approximate it from the last reply and
   * say so.
   */
  resolvedAt?: string;
  resolvedBy?: string;
}
```

(This snippet appears once: `FeedbackMessage` is the only interface ending in `replies: FeedbackReply[];`.)

3b. In `appendReply`, replace:

```ts
        const updated: FeedbackThread = {
          ...current,
          status: nextStatus,
          replies: [...current.replies, reply],
          revision: nextRevision,
          _writeToken: writeToken,
        };
```

with:

```ts
        const updated: FeedbackThread = {
          ...current,
          status: nextStatus,
          replies: [...current.replies, reply],
          // Stamped ONCE, on the transition itself: re-resolving an already
          // resolved thread keeps the first resolution.
          ...(statusChanged ? { resolvedAt: reply.timestamp, resolvedBy: reply.from } : {}),
          revision: nextRevision,
          _writeToken: writeToken,
        };
```

(`statusChanged` is assigned on the line just above: `statusChanged = nextStatus !== current.status;`.)

3c. In `docs/architecture/data-system-report.md`, in the `threads/{threadId}.json` row, replace:

```
Migrated legacy threads keep their original UUID id and therefore sort into the oldest region. |
```

with:

```
Migrated legacy threads keep their original UUID id and therefore sort into the oldest region. Optional `resolvedAt` / `resolvedBy` (since 2026-09-28) are stamped once, from the resolving reply, on the open → resolved transition; threads resolved earlier simply lack them (additive — no migration). |
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/data/feedback/`
Expected: PASS (all files).

- [ ] **Step 5: Tier-3 gates (data-format entry)**

Run, in order: `npm run lint && npm run typecheck && npm run test:run && npm run check:complexity && npm run check:hex-literals`
Expected: all exit 0. Then run the edit log (Step 6) **before** `npm run check:release`, because that gate compares `package.json` with the newest edit-log entry. After Step 6: `npm run check:release && npm run check:vendor && npm run build && npm run check:bundle-size` — all exit 0.

- [ ] **Step 6: Edit log**

Run: `npm run editlog -- --tier=3 --bump=minor --append --sync-package "Add (feedback): resolvedAt and resolvedBy on resolve"`

Fill in:
- **Why:** The feedback export needs a resolution date and resolver; a resolve recorded only the status flip and a reply.
- **What changed:** Two OPTIONAL fields on `FeedbackMessage` (inherited by `FeedbackThread`), stamped by `appendReply` once, on the open → resolved transition, from the resolving reply. No existing field changes shape.
- **Migration / rollback:** None needed — the fields are additive and optional; older threads lack them and every reader treats them as absent. Rollback = revert the commit; older builds ignore the extra keys (the thread file is read through a spread in `normalizeThread`).
- **Before / After:** the old and new `updated` object literals from Step 3b.
- **Verification:** paste all tier-3 gate results.

- [ ] **Step 7: Commit**

```bash
git add src/data/feedback/feedbackStorage.ts src/data/feedback/feedbackStorage.resolvedMeta.test.ts docs/architecture/data-system-report.md "docs/edit logs/" package.json
git commit -m "$(cat <<'MSG'
Add (feedback): resolvedAt and resolvedBy on resolve

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NU4UP8LM3qkAnTNccmKZEJ
MSG
)"
```

---

## Task 6: Pure two-sheet export builder `feedbackExport.ts`

**Files:**
- Modify: `src/data/labels/labelsStore.ts` (after the `fb_finalize_legacy_error` entry, originally line 556)
- Create: `src/data/feedback/feedbackExport.ts`
- Test: `src/data/feedback/feedbackExport.test.ts` (create)

**Interfaces:**
- Consumes: `type Labels` (= `Record<LabelKey, string>`) and `getLabels()` from `src/data/labels/labelsStore.ts`; `yieldToMain(): Promise<void>` from `src/data/storage/yieldToMain.ts`; `FeedbackMessage` (with Task 5's optional `resolvedAt` / `resolvedBy`), `FeedbackCategory` from `feedbackStorage.ts`; existing label keys `fb_category_suggestion|issue|inquiry`, `fb_resolved_badge` («مغلقة»), `fb_filter_open` («مفتوحة»), `toolbar_role_admin|manager|supervisor|employee|guest`.
- Produces (all exported from `src/data/feedback/feedbackExport.ts`):
  - `type FeedbackExportCell = string | number`; `type FeedbackExportRow = FeedbackExportCell[]`
  - `type FeedbackExportSheets = { threadHeaders: string[]; threadRows: FeedbackExportRow[]; messageHeaders: string[]; messageRows: FeedbackExportRow[] }`
  - `feedbackThreadHeaders(labels: Labels): string[]` — 11 columns: thread id, sender, role, category, status, created, last activity, reply count, resolved at, resolved by, original text.
  - `feedbackMessageHeaders(labels: Labels): string[]` — 8 columns: thread id, category, status, sequence, author, role, date, text.
  - `buildFeedbackThreadRows(threads: readonly FeedbackMessage[], labels: Labels): FeedbackExportRow[]`
  - `buildFeedbackMessageRows(threads: readonly FeedbackMessage[], labels: Labels): FeedbackExportRow[]`
  - `buildFeedbackExportSheets(threads: readonly FeedbackMessage[], labels: Labels): Promise<FeedbackExportSheets>` (chunks of 500 threads, `yieldToMain()` between chunks)
  - `buildFeedbackWorkbook(sheets: FeedbackExportSheets, labels: Labels): XLSX.WorkBook` (sheets named `labels.fb_export_sheet_threads` then `labels.fb_export_sheet_messages`)
  - `exportFeedbackWorkbook(threads: readonly FeedbackMessage[], labels: Labels, fileName?: string): Promise<{ threadCount: number; messageCount: number }>` (default file name `feedback-YYYY-MM-DD.xlsx`; calls `XLSX.writeFile`)
  - New label keys: `fb_export_btn`, `fb_exporting`, `fb_export_failed`, `fb_export_empty`, `fb_export_sheet_threads`, `fb_export_sheet_messages`, `fb_export_col_thread_id`, `fb_export_col_from`, `fb_export_col_role`, `fb_export_col_category`, `fb_export_col_status`, `fb_export_col_created_at`, `fb_export_col_last_activity`, `fb_export_col_reply_count`, `fb_export_col_resolved_at`, `fb_export_col_resolved_by`, `fb_export_col_text`, `fb_export_col_sequence`, `fb_export_col_author`, `fb_export_col_date`, `fb_export_col_message_text`, `fb_export_estimated_suffix`.

- [ ] **Step 1: Write the failing test**

Create `src/data/feedback/feedbackExport.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import { getLabels, type Labels } from "../labels/labelsStore";
import type { FeedbackThread } from "./feedbackStorage";
import {
  buildFeedbackExportSheets,
  buildFeedbackMessageRows,
  buildFeedbackThreadRows,
  buildFeedbackWorkbook,
  feedbackMessageHeaders,
  feedbackThreadHeaders,
} from "./feedbackExport";

const L: Labels = getLabels();

const RESOLVED_WITH_FIELDS: FeedbackThread = {
  id: "t20260920100000-aaaaaaaa",
  from: "sara",
  role: "employee",
  category: "issue",
  text: "الجهاز لا يعمل",
  timestamp: "2026-09-20T10:00:00.000Z",
  status: "resolved",
  replies: [
    { from: "admin", role: "admin", text: "نراجع", timestamp: "2026-09-21T09:00:00.000Z" },
    { from: "manager1", role: "manager", text: "تم الحل", timestamp: "2026-09-22T11:30:00.000Z" },
  ],
  resolvedAt: "2026-09-22T11:30:00.000Z",
  resolvedBy: "manager1",
  revision: 3,
};

// Resolved before `resolvedAt`/`resolvedBy` existed.
const LEGACY_RESOLVED: FeedbackThread = {
  id: "t20260101100000-bbbbbbbb",
  from: "omar",
  role: "supervisor",
  category: "inquiry",
  text: "سؤال قديم",
  timestamp: "2026-01-01T10:00:00.000Z",
  status: "resolved",
  replies: [{ from: "admin", role: "admin", text: "أُجيب", timestamp: "2026-01-02T08:15:00.000Z" }],
  revision: 2,
};

const OPEN_NO_REPLY: FeedbackThread = {
  id: "t20260925100000-cccccccc",
  from: "lina",
  role: "custom-role",
  category: "suggestion",
  text: "اقتراح",
  timestamp: "2026-09-25T10:00:00.000Z",
  status: "open",
  replies: [],
  revision: 1,
};

describe("feedbackExport — conversations sheet", () => {
  it("emits one row per thread, aligned with the label-driven header row", () => {
    const rows = buildFeedbackThreadRows([RESOLVED_WITH_FIELDS], L);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveLength(feedbackThreadHeaders(L).length);
    expect(rows[0]).toEqual([
      "t20260920100000-aaaaaaaa",
      "sara",
      L.toolbar_role_employee,
      L.fb_category_issue,
      L.fb_resolved_badge,
      "2026-09-20 10:00:00",
      "2026-09-22 11:30:00",
      2,
      "2026-09-22 11:30:00",
      "manager1",
      "الجهاز لا يعمل",
    ]);
  });

  it("approximates a legacy thread's resolution from its last reply and marks it estimated", () => {
    const [row] = buildFeedbackThreadRows([LEGACY_RESOLVED], L);
    expect(row![8]).toBe(`2026-01-02 08:15:00 ${L.fb_export_estimated_suffix}`);
    expect(row![9]).toBe(`admin ${L.fb_export_estimated_suffix}`);
    expect(row![2]).toBe(L.toolbar_role_supervisor);
  });

  it("leaves the resolution cells empty for an open thread and keeps an unknown role verbatim", () => {
    const [row] = buildFeedbackThreadRows([OPEN_NO_REPLY], L);
    expect(row![4]).toBe(L.fb_filter_open);
    expect(row![6]).toBe("2026-09-25 10:00:00");
    expect(row![7]).toBe(0);
    expect(row![8]).toBe("");
    expect(row![9]).toBe("");
    expect(row![2]).toBe("custom-role");
  });

  it("takes its headers from labels, so an admin override reaches the file", () => {
    const custom: Labels = { ...L, fb_export_col_from: "صاحب الرسالة" };
    expect(feedbackThreadHeaders(custom)[1]).toBe("صاحب الرسالة");
  });
});

describe("feedbackExport — messages sheet", () => {
  it("emits the original message then each reply, numbered from 1", () => {
    const rows = buildFeedbackMessageRows([RESOLVED_WITH_FIELDS], L);
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row).toHaveLength(feedbackMessageHeaders(L).length);
    expect(rows[0]).toEqual([
      "t20260920100000-aaaaaaaa",
      L.fb_category_issue,
      L.fb_resolved_badge,
      1,
      "sara",
      L.toolbar_role_employee,
      "2026-09-20 10:00:00",
      "الجهاز لا يعمل",
    ]);
    expect(rows[2]).toEqual([
      "t20260920100000-aaaaaaaa",
      L.fb_category_issue,
      L.fb_resolved_badge,
      3,
      "manager1",
      L.toolbar_role_manager,
      "2026-09-22 11:30:00",
      "تم الحل",
    ]);
  });

  it("gives a thread with no replies exactly one row", () => {
    expect(buildFeedbackMessageRows([OPEN_NO_REPLY], L)).toHaveLength(1);
  });
});

describe("feedbackExport — chunked build and workbook", () => {
  it("the chunked builder matches the plain builders across several chunks", async () => {
    const many: FeedbackThread[] = Array.from({ length: 1200 }, (_, i) => ({
      ...OPEN_NO_REPLY,
      id: `t20260925${String(100000 + i)}-cccccccc`,
      replies: i % 2 === 0 ? [] : [{ from: "admin", role: "admin", text: "رد", timestamp: "2026-09-26T10:00:00.000Z" }],
    }));
    const sheets = await buildFeedbackExportSheets(many, L);
    expect(sheets.threadRows).toEqual(buildFeedbackThreadRows(many, L));
    expect(sheets.messageRows).toEqual(buildFeedbackMessageRows(many, L));
    expect(sheets.threadHeaders).toEqual(feedbackThreadHeaders(L));
    expect(sheets.messageHeaders).toEqual(feedbackMessageHeaders(L));
  });

  it("builds a two-sheet workbook named by labels, headers first", async () => {
    const sheets = await buildFeedbackExportSheets([RESOLVED_WITH_FIELDS, LEGACY_RESOLVED], L);
    const workbook = buildFeedbackWorkbook(sheets, L);
    expect(workbook.SheetNames).toEqual([L.fb_export_sheet_threads, L.fb_export_sheet_messages]);

    const threadSheet = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[L.fb_export_sheet_threads]!, { header: 1 });
    expect(threadSheet[0]).toEqual(feedbackThreadHeaders(L));
    expect(threadSheet).toHaveLength(3);

    const messageSheet = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[L.fb_export_sheet_messages]!, { header: 1 });
    expect(messageSheet[0]).toEqual(feedbackMessageHeaders(L));
    expect(messageSheet).toHaveLength(1 + 3 + 2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/data/feedback/feedbackExport.test.ts`
Expected: FAIL — `Error: Cannot find module './feedbackExport'`.

- [ ] **Step 3: Add the label keys**

In `src/data/labels/labelsStore.ts`, replace:

```ts
  fb_finalize_legacy_error:            "حدث خطأ أثناء محاولة الترحيل — أعد المحاولة.",
```

with:

```ts
  fb_finalize_legacy_error:            "حدث خطأ أثناء محاولة الترحيل — أعد المحاولة.",

  // Feedback export (admin, "all messages" tab) — button/status text AND the
  // generated workbook's sheet names and column headings (Workstream B).
  fb_export_btn:                "تصدير المحادثات إلى Excel",
  fb_exporting:                 "جارٍ التصدير…",
  fb_export_failed:             "تعذّر تصدير المحادثات — حاول مرة أخرى.",
  fb_export_empty:              "لا توجد محادثات لتصديرها.",
  fb_export_sheet_threads:      "المحادثات",
  fb_export_sheet_messages:     "الرسائل",
  fb_export_col_thread_id:      "رقم المحادثة",
  fb_export_col_from:           "المرسل",
  fb_export_col_role:           "الدور",
  fb_export_col_category:       "النوع",
  fb_export_col_status:         "الحالة",
  fb_export_col_created_at:     "تاريخ الإنشاء",
  fb_export_col_last_activity:  "آخر نشاط",
  fb_export_col_reply_count:    "عدد الردود",
  fb_export_col_resolved_at:    "تاريخ الإغلاق",
  fb_export_col_resolved_by:    "أُغلقت بواسطة",
  fb_export_col_text:           "النص الأصلي",
  fb_export_col_sequence:       "التسلسل",
  fb_export_col_author:         "الكاتب",
  fb_export_col_date:           "التاريخ",
  fb_export_col_message_text:   "النص",
  fb_export_estimated_suffix:   "(تقديري)",
```

- [ ] **Step 4: Implement the builder**

Create `src/data/feedback/feedbackExport.ts`:

```ts
/**
 * Admin export of every feedback conversation to one XLSX workbook with two
 * sheets (Workstream B, 2026-09-28):
 *
 *  - «المحادثات» — one row per thread: id, sender, role, category, status,
 *    created, last activity, reply count, resolved at/by, original text.
 *  - «الرسائل»   — one row per message (the original, then each reply).
 *
 * ZERO EXTRA I/O. The caller passes threads it already holds in memory (the
 * FeedbackUnreadProvider's polled aggregate merged with the widget's own
 * fresher copies — see feedbackThreadMerge.ts), so exporting never re-reads
 * the feedback directory on the share.
 *
 * Mechanically the same as `errorLog/errorLogExport.ts`: pure row builders,
 * rows assembled in chunks separated by `yieldToMain()`, then the synchronous
 * `aoa_to_sheet` -> `book_new` -> `book_append_sheet` -> `writeFile` tail.
 *
 * HEADERS ARE LABEL KEYS here, unlike errorLogExport's Arabic constants: the
 * corrective-plan spec asks for label-driven headers so an admin's Settings
 * override reaches the file, and every builder takes `labels` explicitly so it
 * stays pure and node-testable.
 *
 * Unaffected by read-only mode — a browser download writes nothing to the
 * workspace.
 */

import * as XLSX from "xlsx";

import type { Labels } from "../labels/labelsStore";
import { yieldToMain } from "../storage/yieldToMain";
import type { FeedbackCategory, FeedbackMessage } from "./feedbackStorage";

export type FeedbackExportCell = string | number;
export type FeedbackExportRow = FeedbackExportCell[];

export type FeedbackExportSheets = {
  threadHeaders: string[];
  threadRows: FeedbackExportRow[];
  messageHeaders: string[];
  messageRows: FeedbackExportRow[];
};

const EXPORT_CHUNK_SIZE = 500;

function formatTimestamp(iso: string): string {
  return iso.slice(0, 19).replace("T", " ");
}

function categoryText(labels: Labels, category: FeedbackCategory): string {
  if (category === "issue") return labels.fb_category_issue;
  if (category === "inquiry") return labels.fb_category_inquiry;
  return labels.fb_category_suggestion;
}

function statusText(labels: Labels, status: FeedbackMessage["status"]): string {
  return status === "resolved" ? labels.fb_resolved_badge : labels.fb_filter_open;
}

/** Arabic role name for the five known roles; any other stored value is kept verbatim. */
function roleText(labels: Labels, role: string): string {
  const known: Record<string, string> = {
    admin: labels.toolbar_role_admin,
    manager: labels.toolbar_role_manager,
    supervisor: labels.toolbar_role_supervisor,
    employee: labels.toolbar_role_employee,
    guest: labels.toolbar_role_guest,
  };
  return known[role] ?? role;
}

function lastActivity(thread: FeedbackMessage): string {
  let latest = thread.timestamp;
  for (const reply of thread.replies) {
    if (reply.timestamp > latest) latest = reply.timestamp;
  }
  return latest;
}

/**
 * Resolved at/by. The stored fields when present; for a thread resolved before
 * they existed, the last reply (resolving always appends one) with the
 * estimated marker, so the file never presents a guess as a record.
 */
function resolutionCells(labels: Labels, thread: FeedbackMessage): [string, string] {
  if (thread.status !== "resolved") return ["", ""];
  if (thread.resolvedAt) return [formatTimestamp(thread.resolvedAt), thread.resolvedBy ?? ""];
  const last = thread.replies.at(-1);
  if (!last) return ["", ""];
  const mark = labels.fb_export_estimated_suffix;
  return [`${formatTimestamp(last.timestamp)} ${mark}`, `${last.from} ${mark}`];
}

export function feedbackThreadHeaders(labels: Labels): string[] {
  return [
    labels.fb_export_col_thread_id,
    labels.fb_export_col_from,
    labels.fb_export_col_role,
    labels.fb_export_col_category,
    labels.fb_export_col_status,
    labels.fb_export_col_created_at,
    labels.fb_export_col_last_activity,
    labels.fb_export_col_reply_count,
    labels.fb_export_col_resolved_at,
    labels.fb_export_col_resolved_by,
    labels.fb_export_col_text,
  ];
}

export function feedbackMessageHeaders(labels: Labels): string[] {
  return [
    labels.fb_export_col_thread_id,
    labels.fb_export_col_category,
    labels.fb_export_col_status,
    labels.fb_export_col_sequence,
    labels.fb_export_col_author,
    labels.fb_export_col_role,
    labels.fb_export_col_date,
    labels.fb_export_col_message_text,
  ];
}

/** One row per thread, in input order, aligned with `feedbackThreadHeaders`. Pure. */
export function buildFeedbackThreadRows(
  threads: readonly FeedbackMessage[],
  labels: Labels
): FeedbackExportRow[] {
  return threads.map((thread) => {
    const [resolvedAt, resolvedBy] = resolutionCells(labels, thread);
    return [
      thread.id,
      thread.from,
      roleText(labels, thread.role),
      categoryText(labels, thread.category),
      statusText(labels, thread.status),
      formatTimestamp(thread.timestamp),
      formatTimestamp(lastActivity(thread)),
      thread.replies.length,
      resolvedAt,
      resolvedBy,
      thread.text,
    ];
  });
}

/**
 * One row per message -- the original (sequence 1) then each reply in stored
 * order (2, 3, ...) -- aligned with `feedbackMessageHeaders`. Pure.
 */
export function buildFeedbackMessageRows(
  threads: readonly FeedbackMessage[],
  labels: Labels
): FeedbackExportRow[] {
  const rows: FeedbackExportRow[] = [];
  for (const thread of threads) {
    const category = categoryText(labels, thread.category);
    const status = statusText(labels, thread.status);
    rows.push([
      thread.id,
      category,
      status,
      1,
      thread.from,
      roleText(labels, thread.role),
      formatTimestamp(thread.timestamp),
      thread.text,
    ]);
    thread.replies.forEach((reply, index) => {
      rows.push([
        thread.id,
        category,
        status,
        index + 2,
        reply.from,
        roleText(labels, reply.role),
        formatTimestamp(reply.timestamp),
        reply.text,
      ]);
    });
  }
  return rows;
}

/**
 * Both sheets' rows, built in chunks of EXPORT_CHUNK_SIZE threads with a
 * `yieldToMain()` between chunks so a long history does not block input.
 */
export async function buildFeedbackExportSheets(
  threads: readonly FeedbackMessage[],
  labels: Labels
): Promise<FeedbackExportSheets> {
  const threadRows: FeedbackExportRow[] = [];
  const messageRows: FeedbackExportRow[] = [];
  for (let i = 0; i < threads.length; i += EXPORT_CHUNK_SIZE) {
    const chunk = threads.slice(i, i + EXPORT_CHUNK_SIZE);
    threadRows.push(...buildFeedbackThreadRows(chunk, labels));
    messageRows.push(...buildFeedbackMessageRows(chunk, labels));
    if (threads.length > EXPORT_CHUNK_SIZE) {
      await yieldToMain();
    }
  }
  return {
    threadHeaders: feedbackThreadHeaders(labels),
    threadRows,
    messageHeaders: feedbackMessageHeaders(labels),
    messageRows,
  };
}

/** The two-sheet workbook, headers first on each sheet. Pure (no download). */
export function buildFeedbackWorkbook(sheets: FeedbackExportSheets, labels: Labels): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([sheets.threadHeaders, ...sheets.threadRows]),
    labels.fb_export_sheet_threads
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([sheets.messageHeaders, ...sheets.messageRows]),
    labels.fb_export_sheet_messages
  );
  return workbook;
}

/**
 * Builds and downloads the workbook. Returns the row counts so the caller can
 * tell an admin an empty export was empty rather than broken.
 */
export async function exportFeedbackWorkbook(
  threads: readonly FeedbackMessage[],
  labels: Labels,
  fileName = `feedback-${new Date().toISOString().slice(0, 10)}.xlsx`
): Promise<{ threadCount: number; messageCount: number }> {
  const sheets = await buildFeedbackExportSheets(threads, labels);
  XLSX.writeFile(buildFeedbackWorkbook(sheets, labels), fileName);
  return { threadCount: sheets.threadRows.length, messageCount: sheets.messageRows.length };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/data/feedback/feedbackExport.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 6: Tier-2 gates**

Run: `npm run lint && npm run typecheck && npm run test:run`
Expected: all exit 0.

- [ ] **Step 7: Edit log**

Run: `npm run editlog -- --tier=2 --append --sync-package "Add (feedback): two-sheet XLSX export builder"`

Fill in:
- **Why:** Admins need to take the feedback history out of the app for follow-up and reporting; there was no export.
- **What changed:** New pure `feedbackExport.ts` (conversations sheet + one-row-per-message sheet, label-driven headers, legacy resolution approximated from the last reply and marked «(تقديري)», chunked with `yieldToMain()`), plus the `fb_export_*` label keys. No UI yet.
- **Before / After:** Before: no export module. After: the `resolutionCells` function from Step 4.

- [ ] **Step 8: Commit**

```bash
git add src/data/labels/labelsStore.ts src/data/feedback/feedbackExport.ts src/data/feedback/feedbackExport.test.ts "docs/edit logs/" package.json
git commit -m "$(cat <<'MSG'
Add (feedback): two-sheet XLSX export builder

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NU4UP8LM3qkAnTNccmKZEJ
MSG
)"
```

---

## Task 7: Admin export button in the FeedbackWidget "all messages" tab

**Files:**
- Modify: `src/components/FeedbackWidget/FeedbackWidget.tsx` (imports; state next to the finalize state, originally lines 94-97; new `handleExport` before `handleFinalizeLegacyMigration`; the `isRealAdmin` block in the all-messages filter area, originally 456-468)
- Modify: `src/components/FeedbackWidget/FeedbackWidget.css` (append)
- Test: `src/components/FeedbackWidget/FeedbackWidget.export.test.tsx` (create)

**Interfaces:**
- Consumes: `exportFeedbackWorkbook(threads: readonly FeedbackMessage[], labels: Labels, fileName?: string): Promise<{ threadCount: number; messageCount: number }>` (Task 6); `mergeFeedbackThreads(polled, local): FeedbackMessage[]` (Task 2); `polledMessages` and `threadsById` already in the component (Task 2); `isRealAdmin` (already defined: `session?.role === "admin" && session?.mode !== "demo"`); `logError(context: string, error: unknown)` from `src/data/storage/errorLogger.ts`; label keys `fb_export_btn`, `fb_exporting`, `fb_export_empty`, `fb_export_failed`.
- Produces: an export button rendered only for the real admin in the all-messages tab; `role="status"` notice for an empty export, `role="alert"` notice for a failure. No new exports.

- [ ] **Step 1: Write the failing test**

Create `src/components/FeedbackWidget/FeedbackWidget.export.test.tsx`:

```tsx
/* @vitest-environment jsdom */
// Workstream B (2026-09-28): the real admin can export every conversation from
// the "all messages" tab. The export uses the threads already in memory -- it
// must never re-read the feedback directory.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { FeedbackWidget } from "./FeedbackWidget";
import { FeedbackUnreadProvider } from "../../data/feedback/FeedbackUnreadProvider";
import type {
  FeedbackMessage,
  FeedbackThread,
  FeedbackThreadSummary,
} from "../../data/feedback/feedbackStorage";
import type { AuthSession } from "../../auth/authTypes";
import { clearSession, writeSession } from "../../auth/authSession";
import { DEFAULT_LABELS, resetAllLabels, type Labels } from "../../data/labels/labelsStore";

const directoryHandle = { name: "workspace" };

vi.mock("../../data/workspace/useWorkspace", () => ({
  useWorkspace: () => ({ directoryHandle, refreshPermissions: () => {} }),
}));

const storage = vi.hoisted(() => ({
  listThreadSummaries: vi.fn<() => Promise<FeedbackThreadSummary[]>>(),
  loadThreads: vi.fn<(dir: unknown, ids: readonly string[]) => Promise<FeedbackThread[]>>(),
  loadFeedback: vi.fn<() => Promise<FeedbackThread[]>>(),
}));

vi.mock("../../data/feedback/feedbackStorage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../data/feedback/feedbackStorage")>();
  return {
    ...actual,
    listThreadSummaries: storage.listThreadSummaries,
    loadThreads: storage.loadThreads,
    loadFeedback: storage.loadFeedback,
  };
});

const exporter = vi.hoisted(() => ({
  run: vi.fn<
    (threads: readonly FeedbackMessage[], labels: Labels) => Promise<{ threadCount: number; messageCount: number }>
  >(),
}));

vi.mock("../../data/feedback/feedbackExport", () => ({
  exportFeedbackWorkbook: exporter.run,
}));

const THREAD: FeedbackThread = {
  id: "t20260920100000-aaaaaaaa",
  from: "sara",
  role: "employee",
  category: "issue",
  text: "الجهاز لا يعمل",
  timestamp: "2026-09-20T10:00:00.000Z",
  status: "open",
  replies: [],
  revision: 1,
};

const SUMMARY: FeedbackThreadSummary = {
  threadId: THREAD.id,
  from: THREAD.from,
  role: THREAD.role,
  category: THREAD.category,
  status: THREAD.status,
  createdAt: THREAD.timestamp,
  lastActivityAt: THREAD.timestamp,
  preview: THREAD.text,
};

function session(role: AuthSession["role"], mode?: "demo"): AuthSession {
  return { username: "boss", role, loginAt: "2026-09-28T08:00:00.000Z", ...(mode ? { mode } : {}) };
}

async function openAllMessages(as: AuthSession) {
  writeSession(as);
  render(
    <FeedbackUnreadProvider session={as}>
      <FeedbackWidget />
    </FeedbackUnreadProvider>
  );
  // A real admin has no floating trigger (AdminToolbar owns it) -- open the
  // panel the way that toolbar button does.
  act(() => {
    window.dispatchEvent(new CustomEvent("feedback:toggle"));
  });
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(DEFAULT_LABELS.fb_tab_all) }));
  await screen.findByText(THREAD.text);
}

describe("FeedbackWidget — admin export", () => {
  beforeEach(() => {
    clearSession();
    resetAllLabels();
    localStorage.clear();
    storage.listThreadSummaries.mockReset().mockResolvedValue([SUMMARY]);
    storage.loadThreads.mockReset().mockResolvedValue([]);
    storage.loadFeedback.mockReset().mockResolvedValue([THREAD]);
    exporter.run.mockReset().mockResolvedValue({ threadCount: 1, messageCount: 1 });
  });
  afterEach(() => {
    cleanup();
    clearSession();
    resetAllLabels();
    localStorage.clear();
  });

  it("exports the in-memory threads with no extra read", async () => {
    await openAllMessages(session("admin"));
    const fullReads = storage.loadFeedback.mock.calls.length;
    const pageReads = storage.loadThreads.mock.calls.length;
    const summaryReads = storage.listThreadSummaries.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: DEFAULT_LABELS.fb_export_btn }));

    await waitFor(() => expect(exporter.run).toHaveBeenCalledTimes(1));
    const [threads, labels] = exporter.run.mock.calls[0]!;
    expect(threads.map((t) => t.id)).toEqual([THREAD.id]);
    expect(labels.fb_export_sheet_threads).toBe(DEFAULT_LABELS.fb_export_sheet_threads);
    expect(storage.loadFeedback.mock.calls.length).toBe(fullReads);
    expect(storage.loadThreads.mock.calls.length).toBe(pageReads);
    expect(storage.listThreadSummaries.mock.calls.length).toBe(summaryReads);
  });

  it("disables the button while the export runs", async () => {
    let finish!: (value: { threadCount: number; messageCount: number }) => void;
    exporter.run.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    await openAllMessages(session("admin"));

    fireEvent.click(screen.getByRole("button", { name: DEFAULT_LABELS.fb_export_btn }));
    await waitFor(() => expect(screen.getByRole("button", { name: DEFAULT_LABELS.fb_exporting })).toBeDisabled());
    await act(async () => finish({ threadCount: 1, messageCount: 1 }));
    await waitFor(() => expect(screen.getByRole("button", { name: DEFAULT_LABELS.fb_export_btn })).toBeEnabled());
  });

  it("reports an empty export as empty", async () => {
    exporter.run.mockResolvedValue({ threadCount: 0, messageCount: 0 });
    await openAllMessages(session("admin"));
    fireEvent.click(screen.getByRole("button", { name: DEFAULT_LABELS.fb_export_btn }));
    expect(await screen.findByRole("status")).toHaveTextContent(DEFAULT_LABELS.fb_export_empty);
  });

  it("surfaces a failed export as an alert", async () => {
    exporter.run.mockRejectedValue(new Error("boom"));
    await openAllMessages(session("admin"));
    fireEvent.click(screen.getByRole("button", { name: DEFAULT_LABELS.fb_export_btn }));
    expect(await screen.findByRole("alert")).toHaveTextContent(DEFAULT_LABELS.fb_export_failed);
  });

  it("is not offered to a manager or to a demo session", async () => {
    await openAllMessages(session("manager"));
    expect(screen.queryByRole("button", { name: DEFAULT_LABELS.fb_export_btn })).toBeNull();
    cleanup();
    await openAllMessages(session("admin", "demo"));
    expect(screen.queryByRole("button", { name: DEFAULT_LABELS.fb_export_btn })).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/FeedbackWidget/FeedbackWidget.export.test.tsx`
Expected: FAIL — 4 of 5 fail with `Unable to find an accessible element with the role "button" and name "تصدير المحادثات إلى Excel"`; "is not offered to a manager or to a demo session" already passes.

- [ ] **Step 3: Implement in `src/components/FeedbackWidget/FeedbackWidget.tsx`**

3a. Imports — replace:

```tsx
import { canManageFeedback } from "../../data/feedback/feedbackUnread";
import {
  indexThreadsById,
  missingThreadIds,
  pickFresherThread,
} from "../../data/feedback/feedbackThreadMerge";
```

with:

```tsx
import { canManageFeedback } from "../../data/feedback/feedbackUnread";
import { exportFeedbackWorkbook } from "../../data/feedback/feedbackExport";
import {
  indexThreadsById,
  mergeFeedbackThreads,
  missingThreadIds,
  pickFresherThread,
} from "../../data/feedback/feedbackThreadMerge";
import { logError } from "../../data/storage/errorLogger";
```

3b. State — replace:

```tsx
  const [finalizeMessage, setFinalizeMessage] = useState<string | null>(null);
```

with:

```tsx
  const [finalizeMessage, setFinalizeMessage] = useState<string | null>(null);

  // Admin-only XLSX export of every conversation (Workstream B).
  const [isExporting, setIsExporting] = useState(false);
  const [exportNotice, setExportNotice] = useState<
    { kind: "error" | "empty"; text: string } | null
  >(null);
```

3c. Handler — replace:

```tsx
  async function handleFinalizeLegacyMigration() {
```

with:

```tsx
  async function handleExport() {
    if (isExporting) return;
    setExportNotice(null);
    setIsExporting(true);
    try {
      // ZERO extra I/O: the provider's polled aggregate, with any fresher copy
      // this tab wrote or read itself (a just-sent reply) taking precedence.
      const threads = mergeFeedbackThreads(polledMessages, threadsById);
      const { threadCount } = await exportFeedbackWorkbook(threads, getLabels());
      // A header-only file is indistinguishable from a broken button -- say so,
      // same reasoning as ErrorLogSection's export.
      if (threadCount === 0) setExportNotice({ kind: "empty", text: getLabels().fb_export_empty });
    } catch (err) {
      logError("feedback:export", err);
      setExportNotice({ kind: "error", text: getLabels().fb_export_failed });
    } finally {
      setIsExporting(false);
    }
  }

  async function handleFinalizeLegacyMigration() {
```

3d. Button — replace:

```tsx
              {isRealAdmin && (
                <div className="fb-finalize-legacy">
```

with:

```tsx
              {isRealAdmin && (
                <div className="fb-export">
                  <button
                    type="button"
                    className="ui-btn ui-btn--primary ui-btn--sm fb-export-btn"
                    disabled={isExporting}
                    onClick={() => { void handleExport(); }}
                  >
                    {isExporting ? getLabels().fb_exporting : getLabels().fb_export_btn}
                  </button>
                  {exportNotice && (
                    <p
                      className={`fb-export-notice is-${exportNotice.kind}`}
                      role={exportNotice.kind === "error" ? "alert" : "status"}
                    >
                      {exportNotice.text}
                    </p>
                  )}
                </div>
              )}
              {isRealAdmin && (
                <div className="fb-finalize-legacy">
```

- [ ] **Step 4: Styles**

Append to `src/components/FeedbackWidget/FeedbackWidget.css` (tokens only — `check:hex-literals` forbids raw hex):

```css

/* Admin export (all-messages tab) — Workstream B */
.fb-export {
  padding: 10px 16px 0;
  flex-shrink: 0;
}
.fb-export-notice {
  margin: 6px 0 0;
  font-size: 11px;
  line-height: 1.5;
  color: var(--c-ink-3);
}
.fb-export-notice.is-error { color: var(--c-danger); }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/components/FeedbackWidget/`
Expected: PASS (all files, 5 new tests).

- [ ] **Step 6: Tier-2 gates**

Run: `npm run lint && npm run typecheck && npm run test:run`
Expected: all exit 0.

- [ ] **Step 7: Edit log**

Run: `npm run editlog -- --tier=2 --append --sync-package "Add (feedback): admin export button in the all-messages tab"`

Fill in:
- **Why:** The export builder had no entry point; the admin manages conversations from the widget's «كل الرسائل» tab.
- **What changed:** Real-admin-only button (not managers, not the demo session) in the all-messages tab exports `mergeFeedbackThreads(provider messages, local copies)` through `exportFeedbackWorkbook` — no workspace read. Busy state, an explicit empty-export notice, and a logged, alerted failure mirror `ErrorLogSection`'s export.
- **Before / After:** Before: the finalize block alone under `isRealAdmin`. After: the export block from Step 3d.

- [ ] **Step 8: Commit**

```bash
git add src/components/FeedbackWidget/FeedbackWidget.tsx src/components/FeedbackWidget/FeedbackWidget.css src/components/FeedbackWidget/FeedbackWidget.export.test.tsx "docs/edit logs/" package.json
git commit -m "$(cat <<'MSG'
Add (feedback): admin export button in the all-messages tab

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NU4UP8LM3qkAnTNccmKZEJ
MSG
)"
```

---

## Task 8: Final gate sweep and push

**Files:** none created. Only fixes a gate forces (each such fix gets its own tier-1/2 edit-log entry and commit).

**Interfaces:** none.

- [ ] **Step 1: Run the full release sweep**

Run each and record the result:

```bash
npm run lint
npm run typecheck
npm run test:run
npm run check:complexity
npm run check:hex-literals
npm run check:release
npm run check:vendor
npm run build
npm run check:bundle-size
```

Expected: every command exits 0. `check:bundle-size` prints the raw/gzip size well under the 30 MB / 10 MB ceiling (the xlsx library is already in the bundle, so growth is only the new modules).

- [ ] **Step 2: Confirm the feedback surface end to end**

Run: `npx vitest run src/components/FeedbackWidget/ src/data/feedback/ src/data/workspace/workspaceSync.test.tsx src/auth/`
Expected: PASS.

- [ ] **Step 3: If any gate failed**

Fix the cause (never weaken a test or a gate), rerun the failing gate and then the whole sweep, write an edit-log entry for the fix (`npm run editlog -- --tier=2 --append --sync-package "Fix (feedback): <what the gate caught>"`, prose filled in), and commit it with the two trailer lines.

- [ ] **Step 4: Push**

```bash
git status --short
git push -u origin claude/beautiful-einstein-y1ouot
```

Expected: `git status --short` prints nothing before the push; the push succeeds. On a network failure retry up to 4 times with 2 s, 4 s, 8 s, 16 s back-off.

---

## Self-Review

**Spec coverage (Workstream B):**
- Open reads every thread before rendering → Task 1 (index first, background reload; test with read-log counter on a memory directory).
- Page effect re-reads provider threads, twice on re-sort → Task 2 (provider-first bodies, sorted missing-id key; two tests).
- Submit/reply fire `refresh()` + `reloadUnread()` → Task 3 (optimistic apply, one provider reload; submit test asserts no widget reload).
- Reply card stuck on «جاري التحميل» → Task 3 (apply returned thread; reply test asserts no loading line, no re-fetch); Task 2's set key also re-reads a thread that goes missing.
- `createThread` awaits the index CAS; inner `safeWriteJson` without deadline → Task 4 (fire-and-forget + `flushPendingFeedbackIndexWrites`; deadline labels asserted).
- `resolvedAt` / `resolvedBy` → Task 5 (optional, additive; legacy test).
- Export: pure builder, zero extra I/O, label-keyed headers, `yieldToMain` chunks, two sheets with the listed columns, تقديري approximation → Task 6 (builder + tests incl. legacy threads) and Task 7 (button; zero-I/O assertion).
- Tests listed in the spec: open-before-read (T1), submit no full reload (T3), reply without re-fetch (T3), export builder incl. legacy (T6).

**Placeholder scan:** no TBD/TODO; every code step carries the full code; every edit shows the exact text replaced. Edit-log prose is supplied per task.

**Name consistency:** `pickFresherThread`, `indexThreadsById`, `missingThreadIds`, `mergeFeedbackThreads` (T2 → used in T7); `summarizeFeedbackThread` (T3); `flushPendingFeedbackIndexWrites`, `scheduleThreadsIndexUpdate` (T4 → used by T5 tests); `resolvedAt` / `resolvedBy` (T5 → read by T6); `exportFeedbackWorkbook(threads, labels, fileName?)` returning `{ threadCount, messageCount }` (T6 → mocked with the same shape in T7); label keys `fb_export_*` defined in T6 and used in T6/T7 tests and UI.

**Validation note:** every task's test and implementation in this plan was run on a scratch copy of the repository at the plan's writing: each new test failed as stated against the preceding task's code and passed after the step's implementation; after Task 7, `lint`, `typecheck`, `check:complexity`, `check:hex-literals` and `vite build` were clean and every feedback / widget / workspaceSync suite passed.
