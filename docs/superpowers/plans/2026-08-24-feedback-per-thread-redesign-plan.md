# Feedback/support module — per-thread storage redesign (concurrent-write contention fix) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the write contention that makes concurrent feedback submissions/replies fail with **XQ-IO-032** ("casLoop exhausted its retries because an attempt kept throwing") on the UNC/SMB workspace share. Today every employee suggestion, problem, inquiry and every admin reply is a read-modify-write of ONE shared file, `5-system/feedback/messages.json` (`mutateFeedback`, `src/data/feedback/feedbackStorage.ts:115-150`). Two users writing at the same moment contend on that single file; the loser retries, the retries themselves re-read and re-write the whole growing log, and the ladder eventually exhausts and surfaces as a save-failure toast.

**Architecture:** Split the one shared file into **one self-contained JSON file per thread** at `5-system/feedback/threads/{threadId}.json`, plus a **CAS-protected `5-system/feedback/threads.index.json`** carrying lightweight summaries for the list view. This is the same shape `src/data/reportDesigner/storage/reportDesignStorage.ts` already uses (`designs.index.json` + per-`{reportId}.json`), and the same "one writer per file" principle behind `NOTIFICATIONS_SUBFOLDERS.acks` and `AUDIT_SUBFOLDERS` (`src/data/workspace/workspacePaths.ts:50-76`).

The load-bearing property is: **two different threads never collide any more.** A reply touches only its own thread file. A brand-new thread's file is written under a freshly-minted, never-before-used id, so it has no contender at all. The only remaining shared file is the index, and it is now written on **thread create and status change only** — not on every reply — and carries no message bodies, so it is small and rarely touched.

**The index is a rebuildable cache; the thread files are the source of truth.** This is deliberate and is what makes the whole design safe to fail at: if a create writes its thread file and then loses the index race permanently, the message is still on disk and `listThreadSummaries` folds it back in from a names-only directory listing (and repairs the index best-effort). It mirrors `distribution.current.json`'s status as a rebuildable cache next to the durable `distribution.events/` files.

**Tech Stack:** React 19 + TypeScript (strict, `erasableSyntaxOnly`), Vitest (`node` default env; jsdom opt-in per file), `createMemoryDirectory`/`getReadLog`/`getOperationLog` from `src/data/storage/memoryDirectory.ts` for storage tests — the conventions already used throughout this codebase.

## Global Constraints

- **This is a tier 3 change per CLAUDE.md** — it changes an on-disk data format. Every task writes its entry with `npm run editlog -- --tier=3 --append --sync-package "<Category (scope): title>"`, with full prose (`Why:` + `What changed:`), Before/After snippets, and per-file `**File:**` blocks. Entries go at the TOP of `docs/edit logs/2026-08-24.md` (newest-first) — `npm run check:release` reads only the topmost heading. Today's file does not exist yet; `--append` creates it.
- **Version:** `package.json` is at `115.2.0`. This is an architectural/data-format change, so the whole number bumps: the first entry is **`v116.0`** and later entries in this plan are `v116.1`, `v116.2`, … Write it as `v116.0`, never a bare `v116` — `check:release` compares against `package.json`'s first two segments.
- **Per-task gates:** `npm run lint && npm run typecheck && npm run test:run`. **Task 9 runs the full tier-3 sweep** (`check:complexity`, `check:hex-literals`, `check:release`, `check:vendor`, `build`, `check:bundle-size`) — do not run the whole sweep after every task; it is the release gate, not the per-edit gate.
- **`npm run build` before pushing the branch or opening a PR**, whatever the tier. A green `test:run` does not imply a working build in this repo.
- Never a bare `git commit` — always `git add <specific files>` then `git commit -m "..." -- <same files>`.
- **Never hard-code a workspace folder name.** Every path in this plan resolves through `src/data/workspace/workspacePaths.ts` (Task 1 puts the feedback paths there, which is where they should have been all along — see the `getAuditRoot` note at `workspacePaths.ts:542-549` for the exact defect the current inline `systemDir.getDirectoryHandle("feedback", …)` reproduces).
- **The legacy `messages.json` is never written to, never moved, and never deleted** — at either location (`5-system/feedback/messages.json` or the legacy root `feedback/messages.json`). CLAUDE.md's "no active schema migration, permanent fallback" philosophy applies verbatim. The one-time migration in Task 5 *copies* out of it and leaves it in place, read-only, forever.
- **`FeedbackMessage`'s public shape does not change.** `src/data/feedback/feedbackUnread.ts`, `FeedbackUnreadContext.ts`, `FeedbackUnreadProvider.tsx` and `FeedbackWidget`'s `MessageCard` all consume `{ id, from, role, category, text, timestamp, status, replies }`. `FeedbackThread` *extends* it with the CAS fields, so none of those files need a type change. Keeping that interface stable is what bounds this change's blast radius.
- **`submitFeedback` / `replyToFeedback` / `loadFeedback` keep their exported signatures.** They become thin wrappers over the new primitives. `src/data/workspace/workspaceSync.test.tsx:975-1008` and `src/components/FeedbackWidget/FeedbackWidget.unreadDot.test.tsx:23-25` both depend on them; neither may be edited to accommodate a signature change.

## What this plan does NOT fix (stated so it is not mistaken for an oversight)

`loadFeedback(dir)` stays a **full aggregate read** (index → every thread file, bounded concurrency). `FeedbackUnreadProvider` (`src/data/feedback/FeedbackUnreadProvider.tsx:62-89`) polls it every 60 s to count unread inbound items, and `countUnreadFeedback` needs every individual reply's author and timestamp — which the summaries deliberately do not carry. So the **read** side trades one large file read for N small ones. That is a round-trip increase, not a byte increase, and the read path was never the reported failure. The contention fix is on the **write** path. If the read side later becomes the bottleneck, the answer is to enrich `FeedbackThreadSummary` with per-thread inbound counts — explicitly out of scope here.

---

### Task 1: Move feedback path resolution into `workspacePaths.ts` and add the `threads/` subfolder

**Files:**
- Modify: `src/data/workspace/workspacePaths.ts` (add `FEEDBACK_SUBFOLDERS`, `getFeedbackDir`, `getFeedbackThreadsDir`, `getLegacyFeedbackDir`)
- Modify: `src/data/workspace/workspacePaths.test.ts`

**Interfaces:**
- Consumes: `getChildDir`, `getSystemRoot`, `WORKSPACE_ROOTS`, `SYSTEM_FOLDER_NAMES` — all pre-existing in this file, unchanged.
- Produces:
  - `export const FEEDBACK_SUBFOLDERS = { threads: "threads" } as const;`
  - `getFeedbackDir(directoryHandle, create = true): Promise<DirectoryHandleLike>` → `5-system/feedback/`
  - `getFeedbackThreadsDir(directoryHandle, create = true): Promise<DirectoryHandleLike>` → `5-system/feedback/threads/`
  - `getLegacyFeedbackDir(directoryHandle): Promise<DirectoryHandleLike>` → workspace-root `feedback/` (read-only fallback; always `create: false`)

**Why this is task 1 and not folded into task 2:** `feedbackStorage.ts:51-61` currently calls `systemDir.getDirectoryHandle("feedback", { create })` directly. That skips the workspace directory-handle cache AND `registerDirectoryPath`, so every write re-walks the chain and `withResourceLock`'s key degrades to the bare leaf name — the exact "one lock for everything" defect the `getAuditRoot` doc comment (`workspacePaths.ts:542-549`) records having already fixed for `audit/`. Adding a second, deeper folder (`threads/`) on top of an unregistered parent would multiply that. Fix the foundation first.

- [ ] **Step 1: Write the failing tests**

Add to `src/data/workspace/workspacePaths.test.ts`:

```ts
it("resolves 5-system/feedback and its threads/ subfolder", async () => {
  const root = createMemoryDirectory("root") as DirectoryHandleLike;

  const threadsDir = await getFeedbackThreadsDir(root, true);
  expect(threadsDir.name).toBe(FEEDBACK_SUBFOLDERS.threads);

  // Nested under 5-system/feedback/, never at the workspace root.
  const systemDir = await root.getDirectoryHandle("5-system", { create: false });
  const feedbackDir = await systemDir.getDirectoryHandle(SYSTEM_FOLDER_NAMES.feedback, {
    create: false,
  });
  await expect(
    feedbackDir.getDirectoryHandle(FEEDBACK_SUBFOLDERS.threads, { create: false })
  ).resolves.toBeDefined();
  await expect(
    root.getDirectoryHandle(SYSTEM_FOLDER_NAMES.feedback, { create: false })
  ).rejects.toThrow();
});

it("getFeedbackDir with create:false does not create the folder", async () => {
  const root = createMemoryDirectory("root") as DirectoryHandleLike;
  await expect(getFeedbackDir(root, false)).rejects.toThrow();
});

it("getLegacyFeedbackDir resolves the workspace-root feedback/ folder only", async () => {
  const root = createMemoryDirectory("root") as DirectoryHandleLike;
  await root.getDirectoryHandle(SYSTEM_FOLDER_NAMES.feedback, { create: true });
  const legacy = await getLegacyFeedbackDir(root);
  expect(legacy.name).toBe(SYSTEM_FOLDER_NAMES.feedback);
});
```

Extend the existing `SYSTEM_FOLDER_NAMES` shape assertion at `src/data/workspace/workspacePaths.test.ts:56` only if it is an exhaustive `toEqual` — `SYSTEM_FOLDER_NAMES` itself gains no key in this task, so it should need no edit. Confirm by reading that assertion before touching it.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/data/workspace/workspacePaths.test.ts`
Expected: FAIL — `getFeedbackDir`, `getFeedbackThreadsDir`, `getLegacyFeedbackDir` and `FEEDBACK_SUBFOLDERS` are not exported from `workspacePaths.ts`.

- [ ] **Step 3: Add the constant and the three resolvers**

In `src/data/workspace/workspacePaths.ts`, add next to `NOTIFICATIONS_SUBFOLDERS` (which ends at line 62):

```ts
/**
 * Children of `5-system/feedback/`.
 *
 * `threads/` holds ONE self-contained file per conversation
 * (`{threadId}.json`: the original message plus every reply). Feedback used to
 * be a single shared `messages.json` that every employee and every admin
 * rewrote in full on every submit and every reply — the same one-file-many-
 * writers shape the notification acks and the audit logs were already split
 * out of, and for the same reason: on a UNC/SMB share two concurrent writers
 * contend, the loser retries against a growing file, and the CAS ladder
 * exhausts (XQ-IO-032). A reply now rewrites only its own thread.
 */
export const FEEDBACK_SUBFOLDERS = {
  threads: "threads",
} as const;
```

Then add the resolvers immediately after `getNotificationAcksDir` (which ends at line 525):

```ts
/** `5-system/feedback/` — the feedback ("chat") root. */
export async function getFeedbackDir(
  directoryHandle: DirectoryHandleLike,
  create = true
): Promise<DirectoryHandleLike> {
  return getChildDir(
    directoryHandle,
    WORKSPACE_ROOTS.system,
    () => getSystemRoot(directoryHandle, create),
    SYSTEM_FOLDER_NAMES.feedback,
    create,
    null
  );
}

/** `5-system/feedback/threads/` — see `FEEDBACK_SUBFOLDERS.threads`. */
export async function getFeedbackThreadsDir(
  directoryHandle: DirectoryHandleLike,
  create = true
): Promise<DirectoryHandleLike> {
  return getChildDir(
    directoryHandle,
    `${WORKSPACE_ROOTS.system}/${SYSTEM_FOLDER_NAMES.feedback}`,
    () => getFeedbackDir(directoryHandle, create),
    FEEDBACK_SUBFOLDERS.threads,
    create,
    null
  );
}

/**
 * The legacy workspace-ROOT `feedback/` folder — an undocumented 7th top-level
 * folder that predates the move under `5-system/`. READ-ONLY by contract:
 * `create` is not a parameter because nothing may ever create it again, and
 * nothing may ever write into it. See `data-system-report.md` and
 * `feedbackStorage.ts`'s module note.
 */
export async function getLegacyFeedbackDir(
  directoryHandle: DirectoryHandleLike
): Promise<DirectoryHandleLike> {
  return directoryHandle.getDirectoryHandle(SYSTEM_FOLDER_NAMES.feedback, { create: false });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/data/workspace/workspacePaths.test.ts`
Expected: PASS, including every pre-existing test in the file.

- [ ] **Step 5: Point `feedbackStorage.ts` at the new resolvers (mechanical, no behavior change yet)**

In `src/data/feedback/feedbackStorage.ts`, replace lines 51-61:

```ts
async function getFeedbackDir(
  dir: DirectoryHandleLike,
  create: boolean
): Promise<DirectoryHandleLike> {
  const systemDir = await getSystemRoot(dir, create);
  return systemDir.getDirectoryHandle(SYSTEM_FOLDER_NAMES.feedback, { create });
}

async function getLegacyFeedbackDir(dir: DirectoryHandleLike): Promise<DirectoryHandleLike> {
  return dir.getDirectoryHandle(SYSTEM_FOLDER_NAMES.feedback, { create: false });
}
```

with nothing — delete both local helpers — and change the import at line 5:

```ts
import { getSystemRoot, SYSTEM_FOLDER_NAMES } from "../workspace/workspacePaths";
```

to:

```ts
import { getFeedbackDir, getLegacyFeedbackDir } from "../workspace/workspacePaths";
```

The two call sites (`loadFeedbackFile` at lines 77 and 86, `mutateFeedback` at line 123) already call `getFeedbackDir(dir, false)` / `getFeedbackDir(dir, true)` / `getLegacyFeedbackDir(dir)` with exactly the new signatures, so no call site changes.

- [ ] **Step 6: Run the gates**

Run: `npm run lint && npm run typecheck && npm run test:run`
Expected: all green. `feedbackStorage.test.ts` (all 5 blocks) still passes untouched — this task changes only *which module* resolves the folder, not which folder.

- [ ] **Step 7: Write the edit-log entry, then commit**

```bash
npm run editlog -- --tier=3 --append --sync-package "Refactor (workspace): resolve the feedback roots through workspacePaths and add 5-system/feedback/threads/"
git add src/data/workspace/workspacePaths.ts src/data/workspace/workspacePaths.test.ts src/data/feedback/feedbackStorage.ts "docs/edit logs/2026-08-24.md" package.json
git commit -m "Refactor (workspace): resolve the feedback roots through workspacePaths and add 5-system/feedback/threads/" -- src/data/workspace/workspacePaths.ts src/data/workspace/workspacePaths.test.ts src/data/feedback/feedbackStorage.ts "docs/edit logs/2026-08-24.md" package.json
```

---

### Task 2: New types, thread ids, and the per-thread read primitives

**Files:**
- Modify: `src/data/feedback/feedbackStorage.ts`
- Test: `src/data/feedback/feedbackThreads.test.ts` (new — id/filename purity tests)

**Interfaces:**
- Produces (all exported from `feedbackStorage.ts`):
  - `FeedbackThread` — `FeedbackMessage` plus optional `revision` / `_writeToken`
  - `FeedbackThreadSummary` — `{ threadId, from, role, category, status, createdAt, lastActivityAt, preview }`
  - `FeedbackThreadsIndex` — `{ revision?, _writeToken?, threads: FeedbackThreadSummary[] }`
  - `FEEDBACK_THREADS_INDEX_FILE = "threads.index.json"`, `FEEDBACK_THREAD_FILE_SUFFIX = ".json"`
  - `newFeedbackThreadId(now?: Date): string`, `feedbackThreadFileName(threadId: string): string` (exported for tests and for the sync probe)
  - `loadThread(dir, threadId): Promise<FeedbackThread | null>`
  - `loadThreads(dir, threadIds): Promise<FeedbackThread[]>`
- Consumes: `safeReadJson`, `readNamedJsonFiles` (`src/data/storage/directoryScan.ts:106`), `getFeedbackThreadsDir` (Task 1).

**Thread-id format — and why it is not a bare UUID.** New ids are `t{YYYYMMDDHHmmss}-{8 hex}` (29 characters with `.json`). Two properties earn that shape:

1. **Path length.** `distributionEventStore.ts:138-176` records that Chromium writes through a `{name}.crswap` sibling and Windows caps a path at 260 characters, and that an 80-character file name on a deep UNC workspace path fails as a permanent `NotFoundError` in a genuinely writable directory. A short name is a correctness property here, not tidiness.
2. **Name-sort ≈ time order.** The sync probe (Task 6) uses `boundedSizeSignature`, which samples the **tail of the name-sorted listing** (`directoryScan.ts:597-625`). With random UUID names the sampled 64 would be an arbitrary subset, so a reply to any thread outside it would be invisible to the tick. With a timestamp prefix the tail *is* the newest 64 threads, which is where essentially all activity lives. Migrated legacy threads keep their original UUID ids (Task 5) — those all sort before every `t…` name, since `t` (0x74) is above every hex digit, so they land in the oldest region, which is exactly right.

Ids are **validated, never sanitized** — two distinct ids must never map to one file. Same rule and same regex as `distributionEventStore.ts:926-933`'s `eventFileName`.

- [ ] **Step 1: Write the failing tests**

Create `src/data/feedback/feedbackThreads.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  FEEDBACK_THREAD_FILE_SUFFIX,
  feedbackThreadFileName,
  newFeedbackThreadId,
} from "./feedbackStorage";

describe("feedback thread ids", () => {
  it("mints a short, time-ordered id", () => {
    const id = newFeedbackThreadId(new Date("2026-08-24T10:15:30.123Z"));
    expect(id).toMatch(/^t20260824101530-[0-9a-f]{8}$/);
    // Short enough that a deep UNC path plus Chromium's .crswap sibling fits.
    expect(`${id}${FEEDBACK_THREAD_FILE_SUFFIX}`.length).toBeLessThanOrEqual(40);
  });

  it("orders lexicographically by creation time", () => {
    const older = newFeedbackThreadId(new Date("2026-08-24T10:00:00.000Z"));
    const newer = newFeedbackThreadId(new Date("2026-08-24T10:00:01.000Z"));
    expect([newer, older].sort()).toEqual([older, newer]);
  });

  it("sorts every legacy UUID id before every minted id", () => {
    // Migrated legacy threads keep their UUID; every hex first character is
    // below "t", so they occupy the oldest region of the name sort -- which is
    // what keeps boundedSizeSignature's tail sample pointed at recent activity.
    const uuid = "ffffffff-ffff-4fff-bfff-ffffffffffff";
    const minted = newFeedbackThreadId(new Date("2026-01-01T00:00:00.000Z"));
    expect([minted, uuid].sort()).toEqual([uuid, minted]);
  });

  it("rejects an id that would escape or collide instead of sanitizing it", () => {
    expect(() => feedbackThreadFileName("../escape")).toThrow();
    expect(() => feedbackThreadFileName("has/slash")).toThrow();
    expect(() => feedbackThreadFileName("")).toThrow();
    expect(() => feedbackThreadFileName("x".repeat(81))).toThrow();
  });

  it("accepts a legacy UUID id unchanged", () => {
    const uuid = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
    expect(feedbackThreadFileName(uuid)).toBe(`${uuid}.json`);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/data/feedback/feedbackThreads.test.ts`
Expected: FAIL — none of `newFeedbackThreadId`, `feedbackThreadFileName`, `FEEDBACK_THREAD_FILE_SUFFIX` exist yet.

- [ ] **Step 3: Add the types and id helpers**

In `src/data/feedback/feedbackStorage.ts`, after the `FeedbackMessage` interface (which ends at line 25), add:

```ts
/**
 * One conversation, stored whole in its own file at
 * `5-system/feedback/threads/{threadId}.json`.
 *
 * `FeedbackMessage` is deliberately the base: `id` IS the thread id and
 * `timestamp` IS the creation time, so every existing consumer
 * (`feedbackUnread.ts`, `FeedbackUnreadProvider`, `MessageCard`) reads a thread
 * without a projection step or a type change.
 *
 * The CAS fields guard the ONE remaining same-file race: two admins replying to
 * the SAME thread at the same instant. Two different threads cannot collide at
 * all any more, which is the actual fix — this is the residual case, not the
 * main one.
 */
export interface FeedbackThread extends FeedbackMessage {
  revision?: number;
  _writeToken?: string;
}

/** Row of `threads.index.json` — enough to render and filter the list view without opening a thread. */
export interface FeedbackThreadSummary {
  threadId: string;
  from: string;
  role: string;
  category: FeedbackCategory;
  status: "open" | "resolved";
  createdAt: string;
  /**
   * As of the last INDEX write — i.e. thread creation or a status change. A
   * plain reply deliberately does not touch the index (that is what keeps the
   * shared file rarely written), so this is advisory. The list view orders by
   * `createdAt`, never by this field.
   */
  lastActivityAt: string;
  /** First line of the original message, truncated — for the collapsed row only. */
  preview: string;
}

/**
 * `threads.index.json` — a REBUILDABLE CACHE, not the source of truth.
 *
 * The thread files are authoritative. `listThreadSummaries` reconciles the
 * index against a names-only listing of `threads/` on every read, so a create
 * whose index write lost the CAS race permanently still shows up (and repairs
 * the index on the way past). Same standing as `distribution.current.json`
 * next to the durable `distribution.events/` files.
 */
export type FeedbackThreadsIndex = {
  revision?: number;
  _writeToken?: string;
  threads: FeedbackThreadSummary[];
};

export const FEEDBACK_THREADS_INDEX_FILE = "threads.index.json";
export const FEEDBACK_THREAD_FILE_SUFFIX = ".json";

/** Max characters of the original message kept in a summary row. */
const PREVIEW_MAX_CHARS = 120;

export function feedbackThreadPreview(text: string): string {
  const firstLine = text.split("\n", 1)[0]!.trim();
  return firstLine.length > PREVIEW_MAX_CHARS
    ? `${firstLine.slice(0, PREVIEW_MAX_CHARS)}…`
    : firstLine;
}

// Validate, never sanitize: two distinct ids mapping to one file would silently
// overwrite one user's message with another's. Same rule as
// distributionEventStore's eventFileName.
const THREAD_ID_PATTERN = /^[A-Za-z0-9._-]{1,80}$/;

export function feedbackThreadFileName(threadId: string): string {
  if (!THREAD_ID_PATTERN.test(threadId)) {
    throw new Error(`Invalid feedback thread id: ${threadId}`);
  }
  return `${threadId}${FEEDBACK_THREAD_FILE_SUFFIX}`;
}

/**
 * `t{YYYYMMDDHHmmss}-{8 hex}` — short (a deep UNC path plus Chromium's
 * `.crswap` sibling must stay under 260 characters, see
 * distributionEventStore's SHORT NAMES note) and lexicographically
 * time-ordered (the sync probe samples the TAIL of the name-sorted listing, so
 * the sample has to be the newest threads).
 */
export function newFeedbackThreadId(now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[-:T.]/g, "").slice(0, 14);
  const random = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  return `t${stamp}-${random}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/data/feedback/feedbackThreads.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the read primitives, with tests**

Add to `src/data/feedback/feedbackStorage.test.ts` (inside the existing `describe("feedbackStorage", …)` block):

```ts
  it("loadThread returns null for an id that has no file, and the thread for one that does", async () => {
    const root = makeRoot();
    const created = await createThread(root, {
      from: "sara",
      role: "employee",
      category: "suggestion",
      text: "اقتراح",
    });

    expect(await loadThread(root, "t20260101000000-deadbeef")).toBeNull();
    const found = await loadThread(root, created.id);
    expect(found?.text).toBe("اقتراح");
    expect(found?.status).toBe("open");
    expect(found?.replies).toEqual([]);
  });

  it("loadThreads reads only the ids it is given, in the order it is given", async () => {
    const root = makeRoot();
    const a = await createThread(root, { from: "a", role: "employee", category: "issue", text: "أ" });
    const b = await createThread(root, { from: "b", role: "employee", category: "issue", text: "ب" });
    const c = await createThread(root, { from: "c", role: "employee", category: "issue", text: "ج" });

    const loaded = await loadThreads(root, [c.id, a.id]);
    expect(loaded.map((t) => t.from)).toEqual(["c", "a"]);
    // b was never asked for and must not have been read.
    expect(loaded.some((t) => t.id === b.id)).toBe(false);
  });
```

Then implement, after the id helpers:

```ts
export async function loadThread(
  dir: DirectoryHandleLike,
  threadId: string
): Promise<FeedbackThread | null> {
  let threadsDir: DirectoryHandleLike;
  try {
    threadsDir = await getFeedbackThreadsDir(dir, false);
  } catch {
    return null;
  }
  const result = await safeReadJson<FeedbackThread>(
    threadsDir,
    feedbackThreadFileName(threadId)
  );
  return result.ok && typeof result.value.id === "string" ? normalizeThread(result.value) : null;
}

/**
 * Bounded-concurrency read of an explicit id list — the list view's page load.
 * `readNamedJsonFiles` is the shared core `readJsonDirectory` uses, so this
 * costs no directory listing and reads exactly the named files, at
 * DIRECTORY_READ_CONCURRENCY in flight. Input order is preserved; an
 * unreadable/absent id is skipped rather than aborting the page ("skip", not
 * "throw": one corrupt thread must not blank the whole panel).
 */
export async function loadThreads(
  dir: DirectoryHandleLike,
  threadIds: readonly string[]
): Promise<FeedbackThread[]> {
  if (threadIds.length === 0) return [];
  let threadsDir: DirectoryHandleLike;
  try {
    threadsDir = await getFeedbackThreadsDir(dir, false);
  } catch {
    return [];
  }
  const { values } = await readNamedJsonFiles<FeedbackThread>(
    threadsDir,
    threadIds.map(feedbackThreadFileName),
    { onUnreadable: "skip" }
  );
  return values.filter((value) => typeof value.id === "string").map(normalizeThread);
}

/** Defensive: a hand-edited or partially-written thread must never crash a render. */
function normalizeThread(value: FeedbackThread): FeedbackThread {
  return {
    ...value,
    status: value.status === "resolved" ? "resolved" : "open",
    replies: Array.isArray(value.replies) ? value.replies : [],
  };
}
```

Add to the import at `src/data/feedback/feedbackStorage.ts:5` (post-Task-1 form):

```ts
import { getFeedbackDir, getFeedbackThreadsDir, getLegacyFeedbackDir } from "../workspace/workspacePaths";
import { readNamedJsonFiles } from "../storage/directoryScan";
```

(`createThread` lands in Task 3; these two tests will not pass until then — that is expected and is why Step 6 below defers the run.)

- [ ] **Step 6: Run typecheck and the pure tests**

Run: `npm run typecheck && npx vitest run src/data/feedback/feedbackThreads.test.ts`
Expected: typecheck green; `feedbackThreads.test.ts` PASS. The two `feedbackStorage.test.ts` cases added in Step 5 still FAIL (`createThread` does not exist) — Task 3 closes them.

- [ ] **Step 7: Write the edit-log entry, then commit**

```bash
npm run editlog -- --tier=3 --append --sync-package "Add (feedback): per-thread types, short time-ordered thread ids, and the per-thread read primitives"
git add src/data/feedback/feedbackStorage.ts src/data/feedback/feedbackThreads.test.ts src/data/feedback/feedbackStorage.test.ts "docs/edit logs/2026-08-24.md" package.json
git commit -m "Add (feedback): per-thread types, short time-ordered thread ids, and the per-thread read primitives" -- src/data/feedback/feedbackStorage.ts src/data/feedback/feedbackThreads.test.ts src/data/feedback/feedbackStorage.test.ts "docs/edit logs/2026-08-24.md" package.json
```

---

### Task 3: `createThread` — a brand-new file plus a CAS index append

**Files:**
- Modify: `src/data/feedback/feedbackStorage.ts`
- Test: `src/data/feedback/feedbackStorage.test.ts`

**Interfaces:**
- Produces: `createThread(dir, payload: { from; role; category; text }): Promise<FeedbackThread>`, and the private `updateThreadsIndex(dir, apply)`.
- Consumes: `casLoop`, `withResourceLock`, `safeWriteJson`, `safeReadJson`, `getFeedbackDir`/`getFeedbackThreadsDir`.

**Write order and why:** thread file **first**, index **second**. The reverse would put a summary in the list pointing at a file that may not exist. In this order the worst case is a thread file the index does not yet mention — and `listThreadSummaries` (Task 4) folds those back in from a listing, so nothing is lost and nothing is dangling. The thread write itself needs **no CAS**: the id is freshly minted and has never been used, so there is no contender for that file name. This is the whole point of the redesign and the comment must say so.

- [ ] **Step 1: Write the failing tests**

Add to `src/data/feedback/feedbackStorage.test.ts`:

```ts
  it("writes a new thread to its own file under 5-system/feedback/threads/", async () => {
    const root = makeRoot();
    const thread = await createThread(root, {
      from: "sara",
      role: "employee",
      category: "suggestion",
      text: "اقتراح",
    });

    const systemDir = await root.getDirectoryHandle("5-system", { create: false });
    const feedbackDir = await systemDir.getDirectoryHandle(SYSTEM_FOLDER_NAMES.feedback, {
      create: false,
    });
    const threadsDir = await feedbackDir.getDirectoryHandle("threads", { create: false });
    const handle = await threadsDir.getFileHandle(`${thread.id}.json`, { create: false });
    expect(await (await handle.getFile()).text()).toContain("اقتراح");

    // The shared legacy log is never written to by the new path.
    await expect(feedbackDir.getFileHandle("messages.json", { create: false })).rejects.toThrow();
  });

  it("appends the new thread's summary to threads.index.json", async () => {
    const root = makeRoot();
    const thread = await createThread(root, {
      from: "sara",
      role: "employee",
      category: "issue",
      text: "سطر أول\nسطر ثانٍ",
    });

    const index = await loadThreadsIndex(root);
    expect(index.threads).toHaveLength(1);
    expect(index.threads[0]!.threadId).toBe(thread.id);
    expect(index.threads[0]!.status).toBe("open");
    // Preview is the FIRST LINE only -- the body stays in the thread file.
    expect(index.threads[0]!.preview).toBe("سطر أول");
    expect(index.threads[0]!.preview).not.toContain("سطر ثانٍ");
  });

  it("two concurrent submits never touch the same thread file (the contention fix)", async () => {
    const root = makeRoot("root", { trackOperations: true });
    clearOperationLog(root);

    const [a, b] = await Promise.all([
      createThread(root, { from: "userA", role: "employee", category: "suggestion", text: "من الجهاز الأول" }),
      createThread(root, { from: "userB", role: "supervisor", category: "issue", text: "من الجهاز الثاني" }),
    ]);

    expect(a.id).not.toBe(b.id);
    const written = getOperationLog(root)
      .filter((entry) => entry.operation === "createWritable")
      .map((entry) => entry.name);
    // Each submit wrote its OWN thread file. The two names are disjoint, so no
    // retry ladder can be triggered by the other writer -- that is the fix.
    expect(written).toContain(`${a.id}.json`);
    expect(written).toContain(`${b.id}.json`);

    const index = await loadThreadsIndex(root);
    expect(index.threads.map((t) => t.from).sort()).toEqual(["userA", "userB"]);
  });
```

Add the imports the new tests need at the top of the file:

```ts
import { clearOperationLog, createMemoryDirectory, getOperationLog } from "../storage/memoryDirectory";
```

and widen `makeRoot` (currently `src/data/feedback/feedbackStorage.test.ts:14-16`):

```ts
function makeRoot(): DirectoryHandleLike {
  return createMemoryDirectory("root") as DirectoryHandleLike;
}
```

becomes:

```ts
function makeRoot(
  name = "root",
  options: Parameters<typeof createMemoryDirectory>[1] = {}
): DirectoryHandleLike {
  return createMemoryDirectory(name, options) as DirectoryHandleLike;
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/data/feedback/feedbackStorage.test.ts`
Expected: FAIL — `createThread` and `loadThreadsIndex` do not exist.

- [ ] **Step 3: Implement `updateThreadsIndex`, `loadThreadsIndex` and `createThread`**

Add to `src/data/feedback/feedbackStorage.ts`:

```ts
/** Raw index read, no reconciliation — `listThreadSummaries` (Task 4) is the reconciling reader. */
export async function loadThreadsIndex(
  dir: DirectoryHandleLike
): Promise<FeedbackThreadsIndex> {
  try {
    const feedbackDir = await getFeedbackDir(dir, false);
    const result = await safeReadJson<FeedbackThreadsIndex>(feedbackDir, FEEDBACK_THREADS_INDEX_FILE);
    if (result.ok && Array.isArray(result.value.threads)) {
      return { ...result.value, threads: result.value.threads };
    }
  } catch {
    // No feedback folder yet, or the index is unreadable. Either way the thread
    // files are the authority; an empty index is a safe starting point because
    // listThreadSummaries reconciles against the directory listing.
  }
  return { threads: [] };
}

/**
 * CAS read-modify-write of the shared `threads.index.json`.
 *
 * Same contract as reportDesignStorage's `updateDesignIndex`: the caller's
 * outer `withResourceLock` serializes same-tab writers, casLoop re-reads fresh,
 * bumps `revision`, stamps `_writeToken` and verifies BOTH on read-back so a
 * concurrent writer on another machine is never silently dropped.
 *
 * WHAT CHANGED vs. the old `mutateFeedback`: this file is now touched only on
 * thread CREATE and on a STATUS CHANGE — never on a reply — and it carries no
 * message bodies, so it stays small and rarely written. The old shared log was
 * rewritten in full by every submit AND every reply, which is what exhausted
 * the ladder (XQ-IO-032).
 *
 * No delayed verify: this is a rebuildable cache (see FeedbackThreadsIndex).
 * A lost index update self-heals on the next `listThreadSummaries`, which
 * reconciles against the thread-file listing. The durable content lives in the
 * per-thread file, which is written before this runs.
 */
async function updateThreadsIndex(
  dir: DirectoryHandleLike,
  apply: (threads: FeedbackThreadSummary[]) => FeedbackThreadSummary[]
): Promise<void> {
  const feedbackDir = await getFeedbackDir(dir, true);
  // `:index` suffix keeps this outer lock distinct from safeWriteJson's own
  // `${dir.name}/${fileName}` lock -- withResourceLock is not reentrant.
  const outcome = await withResourceLock(`${feedbackDir.name}/${FEEDBACK_THREADS_INDEX_FILE}:index`, () =>
    casLoop<{ ok: true }>(
      async (writeToken) => {
        const existing = await safeReadJson<FeedbackThreadsIndex>(
          feedbackDir,
          FEEDBACK_THREADS_INDEX_FILE
        );
        const current: FeedbackThreadsIndex = existing.ok
          ? { ...existing.value, threads: Array.isArray(existing.value.threads) ? existing.value.threads : [] }
          : { threads: [] };
        const nextRevision = (current.revision ?? 0) + 1;
        const updated: FeedbackThreadsIndex = {
          revision: nextRevision,
          _writeToken: writeToken,
          threads: apply(current.threads),
        };
        await safeWriteJson<FeedbackThreadsIndex>(feedbackDir, FEEDBACK_THREADS_INDEX_FILE, updated);
        const verify = await safeReadJson<FeedbackThreadsIndex>(
          feedbackDir,
          FEEDBACK_THREADS_INDEX_FILE
        );
        if (
          verify.ok &&
          verify.value.revision === nextRevision &&
          verify.value._writeToken === writeToken
        ) {
          return { done: true, result: { ok: true as const } };
        }
        return { done: false };
      },
      { conflictError: "تعذّر تحديث فهرس الملاحظات: تعارض في الكتابة بعد عدة محاولات." }
    )
  );
  if (!outcome.ok) {
    throw new Error(outcome.error);
  }
}

function summarize(thread: FeedbackThread, lastActivityAt: string): FeedbackThreadSummary {
  return {
    threadId: thread.id,
    from: thread.from,
    role: thread.role,
    category: thread.category,
    status: thread.status,
    createdAt: thread.timestamp,
    lastActivityAt,
    preview: feedbackThreadPreview(thread.text),
  };
}

/**
 * Start a new conversation.
 *
 * The thread file is written FIRST and needs NO CAS: its id was just minted and
 * has never existed, so no other writer on any machine can be targeting that
 * name. That is the actual contention fix — under the old shared-log design
 * this same operation rewrote a file every other user was also rewriting.
 *
 * The index append runs second and is best-effort-durable: if it fails after
 * the thread landed, the message is still on disk and `listThreadSummaries`
 * folds it back in (and repairs the index) on the next read. The error is
 * still surfaced so the user is not told a partial save succeeded.
 */
export async function createThread(
  dir: DirectoryHandleLike,
  payload: { from: string; role: string; category: FeedbackCategory; text: string }
): Promise<FeedbackThread> {
  const now = new Date();
  const thread: FeedbackThread = {
    id: newFeedbackThreadId(now),
    from: payload.from,
    role: payload.role,
    category: payload.category,
    text: payload.text,
    timestamp: now.toISOString(),
    status: "open",
    replies: [],
    revision: 1,
  };

  const threadsDir = await getFeedbackThreadsDir(dir, true);
  await safeWriteJson<FeedbackThread>(threadsDir, feedbackThreadFileName(thread.id), thread);

  await updateThreadsIndex(dir, (threads) => [
    ...threads.filter((summary) => summary.threadId !== thread.id),
    summarize(thread, thread.timestamp),
  ]);

  return thread;
}
```

- [ ] **Step 4: Rewire `submitFeedback` to `createThread`**

Replace `src/data/feedback/feedbackStorage.ts:152-169`:

```ts
export async function submitFeedback(
  dir: DirectoryHandleLike,
  payload: { from: string; role: string; category: FeedbackCategory; text: string }
): Promise<void> {
  await mutateFeedback(dir, (messages) => {
    messages.unshift({
      id: crypto.randomUUID(),
      from: payload.from,
      role: payload.role,
      category: payload.category,
      text: payload.text,
      timestamp: new Date().toISOString(),
      status: "open",
      replies: [],
    });
    return messages;
  });
}
```

with:

```ts
/** Compatibility wrapper — the widget, the sync tests and the unread tests all call this name. */
export async function submitFeedback(
  dir: DirectoryHandleLike,
  payload: { from: string; role: string; category: FeedbackCategory; text: string }
): Promise<void> {
  await createThread(dir, payload);
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/data/feedback/feedbackStorage.test.ts`
Expected: the three new Task-3 tests PASS, plus Task 2's `loadThread`/`loadThreads` tests. Two pre-existing tests now FAIL and are addressed in Tasks 4-5: `"appends a reply and can resolve a message"` (`replyToFeedback` still routes through `mutateFeedback`, which reads the now-unwritten `messages.json`) and `"writes new feedback under 5-system/feedback/, not the legacy workspace-root folder"` (it asserts on `messages.json`, which the new path deliberately never writes). Do **not** patch either one here — Task 5 rewrites this file's suite wholesale.

- [ ] **Step 6: Write the edit-log entry, then commit**

```bash
npm run editlog -- --tier=3 --append --sync-package "Change (feedback): submit a new message as its own thread file plus a CAS index append"
git add src/data/feedback/feedbackStorage.ts src/data/feedback/feedbackStorage.test.ts "docs/edit logs/2026-08-24.md" package.json
git commit -m "Change (feedback): submit a new message as its own thread file plus a CAS index append" -- src/data/feedback/feedbackStorage.ts src/data/feedback/feedbackStorage.test.ts "docs/edit logs/2026-08-24.md" package.json
```

---

### Task 4: `appendReply` (single-thread write) and `listThreadSummaries` (reconciling read)

**Files:**
- Modify: `src/data/feedback/feedbackStorage.ts`
- Test: `src/data/feedback/feedbackStorage.test.ts`

**Interfaces:**
- Produces:
  - `appendReply(dir, threadId, reply: FeedbackReply, resolve: boolean): Promise<FeedbackThread>`
  - `listThreadSummaries(dir): Promise<FeedbackThreadSummary[]>` — index ∪ directory listing, `createdAt`-descending
- Consumes: `casLoop`, `withResourceLock`, `listDirectoryEntries` (`src/data/storage/directoryScan.ts:64`), Task 3's `updateThreadsIndex`.

**The reply path is the headline change.** `appendReply` CAS-loops **one thread file**. Two admins replying to *different* threads now write disjoint file names and cannot contend at all. Two admins replying to the *same* thread still contend — but on a small, single-conversation file, which is the genuine, rare case CAS exists for. The index is touched only when `resolve` actually transitions `open → resolved`; a plain reply leaves it alone.

**`listThreadSummaries` reconciles, and that is not optional.** One `listDirectoryEntries` call (names only, one round trip, no content read) over `threads/`. Any `.json` name the index does not mention is read individually and folded in, and the repaired index is written back best-effort. This is what makes the index a cache rather than a second source of truth — and it is what makes Task 5's migration and a lost index race both self-healing rather than data-losing.

- [ ] **Step 1: Write the failing tests**

Add to `src/data/feedback/feedbackStorage.test.ts`:

```ts
  it("a reply rewrites only its own thread file and never the index", async () => {
    const root = makeRoot("root", { trackOperations: true });
    const target = await createThread(root, { from: "sara", role: "employee", category: "issue", text: "خطأ" });
    const other = await createThread(root, { from: "omar", role: "employee", category: "issue", text: "خطأ آخر" });

    clearOperationLog(root);
    await appendReply(
      root,
      target.id,
      { from: "admin", role: "admin", text: "تم", timestamp: "2026-08-24T10:00:00.000Z" },
      false
    );

    const written = getOperationLog(root)
      .filter((entry) => entry.operation === "createWritable")
      .map((entry) => entry.name);
    expect(written.some((name) => name.startsWith(`${target.id}.json`))).toBe(true);
    // The other thread and the shared index are untouched -- that is the fix.
    expect(written.some((name) => name.startsWith(`${other.id}.json`))).toBe(false);
    expect(written.some((name) => name.startsWith("threads.index.json"))).toBe(false);

    const after = await loadThread(root, target.id);
    expect(after!.replies).toHaveLength(1);
    expect(after!.status).toBe("open");
  });

  it("resolving a thread updates its own file AND its index summary", async () => {
    const root = makeRoot();
    const thread = await createThread(root, { from: "sara", role: "employee", category: "issue", text: "خطأ" });

    await appendReply(
      root,
      thread.id,
      { from: "admin", role: "admin", text: "تم", timestamp: "2026-08-24T10:00:00.000Z" },
      true
    );

    expect((await loadThread(root, thread.id))!.status).toBe("resolved");
    const summaries = await listThreadSummaries(root);
    expect(summaries.find((s) => s.threadId === thread.id)!.status).toBe("resolved");
  });

  it("replies to two DIFFERENT threads at the same instant both land", async () => {
    const root = makeRoot();
    const a = await createThread(root, { from: "a", role: "employee", category: "issue", text: "أ" });
    const b = await createThread(root, { from: "b", role: "employee", category: "issue", text: "ب" });

    await Promise.all([
      appendReply(root, a.id, { from: "admin", role: "admin", text: "ردأ", timestamp: "2026-08-24T10:00:00.000Z" }, false),
      appendReply(root, b.id, { from: "admin", role: "admin", text: "ردب", timestamp: "2026-08-24T10:00:00.000Z" }, false),
    ]);

    expect((await loadThread(root, a.id))!.replies).toHaveLength(1);
    expect((await loadThread(root, b.id))!.replies).toHaveLength(1);
  });

  it("two concurrent replies to the SAME thread both land (residual CAS case)", async () => {
    const root = makeRoot();
    const thread = await createThread(root, { from: "sara", role: "employee", category: "issue", text: "خطأ" });

    await Promise.all([
      appendReply(root, thread.id, { from: "admin1", role: "admin", text: "أولاً", timestamp: "2026-08-24T10:00:00.000Z" }, false),
      appendReply(root, thread.id, { from: "admin2", role: "manager", text: "ثانياً", timestamp: "2026-08-24T10:00:01.000Z" }, false),
    ]);

    const after = await loadThread(root, thread.id);
    expect(after!.replies.map((r) => r.from).sort()).toEqual(["admin1", "admin2"]);
  });

  it("appendReply rejects an unknown thread id instead of inventing one", async () => {
    const root = makeRoot();
    await expect(
      appendReply(root, "t20260101000000-deadbeef", { from: "admin", role: "admin", text: "x", timestamp: "2026-08-24T10:00:00.000Z" }, false)
    ).rejects.toThrow();
  });

  it("listThreadSummaries folds in a thread the index never recorded, and repairs the index", async () => {
    const root = makeRoot();
    const known = await createThread(root, { from: "sara", role: "employee", category: "issue", text: "معروف" });

    // Simulate a create whose index write lost the CAS race permanently: the
    // thread file is on disk, the index does not mention it.
    const orphan: FeedbackThread = {
      id: "t20260824120000-aaaaaaaa",
      from: "omar",
      role: "employee",
      category: "inquiry",
      text: "يتيم",
      timestamp: "2026-08-24T12:00:00.000Z",
      status: "open",
      replies: [],
    };
    const systemDir = await root.getDirectoryHandle("5-system", { create: false });
    const feedbackDir = await systemDir.getDirectoryHandle(SYSTEM_FOLDER_NAMES.feedback, { create: false });
    const threadsDir = await feedbackDir.getDirectoryHandle("threads", { create: false });
    await safeWriteJson<FeedbackThread>(threadsDir, `${orphan.id}.json`, orphan);

    const summaries = await listThreadSummaries(root);
    expect(summaries.map((s) => s.threadId).sort()).toEqual([known.id, orphan.id].sort());

    // Repaired in place, so the next read costs no extra thread opens.
    const index = await loadThreadsIndex(root);
    expect(index.threads.map((t) => t.threadId).sort()).toEqual([known.id, orphan.id].sort());
  });

  it("orders summaries newest-first by createdAt", async () => {
    const root = makeRoot();
    const first = await createThread(root, { from: "a", role: "employee", category: "issue", text: "أ" });
    const second = await createThread(root, { from: "b", role: "employee", category: "issue", text: "ب" });

    const summaries = await listThreadSummaries(root);
    expect(summaries[0]!.threadId).toBe(second.id);
    expect(summaries[1]!.threadId).toBe(first.id);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/data/feedback/feedbackStorage.test.ts`
Expected: FAIL — `appendReply` and `listThreadSummaries` do not exist.

- [ ] **Step 3: Implement `appendReply`**

Add to `src/data/feedback/feedbackStorage.ts`:

```ts
/**
 * Append a reply to ONE thread — the operation this whole redesign exists for.
 *
 * The CAS loop covers a single conversation file. Two admins replying to
 * DIFFERENT threads write disjoint names and cannot contend at all; two
 * replying to the SAME thread contend on a small file, which is the genuine
 * rare case CAS is for. Under the old shared log every reply rewrote the file
 * every other user was also rewriting, so a busy moment exhausted the ladder
 * and surfaced as XQ-IO-032.
 *
 * The index is touched ONLY when `resolve` actually flips `open -> resolved`.
 * A plain reply leaves the shared file alone — that is what keeps the one
 * remaining shared write rare.
 *
 * A delayed `verify` IS supplied here (unlike the index write): a lost reply is
 * user content, not a rebuildable cache, so the lost-update interleaving
 * (A-read / B-read / A-commit-ok / B-clobbers) must be caught and retried.
 * Same reasoning as reportDesignStorage's `saveDesignFile`.
 */
export async function appendReply(
  dir: DirectoryHandleLike,
  threadId: string,
  reply: FeedbackReply,
  resolve: boolean
): Promise<FeedbackThread> {
  const threadsDir = await getFeedbackThreadsDir(dir, true);
  const fileName = feedbackThreadFileName(threadId);
  let statusChanged = false;

  const outcome = await withResourceLock(`${threadsDir.name}/${fileName}:rmw`, () =>
    casLoop<{ ok: true; thread: FeedbackThread }>(
      async (writeToken) => {
        const existing = await safeReadJson<FeedbackThread>(threadsDir, fileName);
        if (!existing.ok) {
          // Reject, never invent: writing a thread here would fabricate a
          // conversation whose original message nobody wrote.
          throw new Error(`Feedback thread not found: ${threadId}`);
        }
        const current = normalizeThread(existing.value);
        const nextRevision = (current.revision ?? 0) + 1;
        const nextStatus = resolve ? "resolved" : current.status;
        statusChanged = nextStatus !== current.status;
        const updated: FeedbackThread = {
          ...current,
          status: nextStatus,
          replies: [...current.replies, reply],
          revision: nextRevision,
          _writeToken: writeToken,
        };
        await safeWriteJson<FeedbackThread>(threadsDir, fileName, updated);
        const verify = await safeReadJson<FeedbackThread>(threadsDir, fileName);
        if (
          verify.ok &&
          verify.value.revision === nextRevision &&
          verify.value._writeToken === writeToken
        ) {
          return {
            done: true,
            result: { ok: true as const, thread: updated },
            verify: async () => {
              const recheck = await safeReadJson<FeedbackThread>(threadsDir, fileName);
              return (
                recheck.ok &&
                recheck.value.revision === nextRevision &&
                recheck.value._writeToken === writeToken
              );
            },
          };
        }
        return { done: false };
      },
      { conflictError: "تعذّر حفظ الرد: تعارض في الكتابة بعد عدة محاولات." }
    )
  );
  if (!outcome.ok) {
    throw new Error(outcome.error);
  }

  if (statusChanged) {
    await updateThreadsIndex(dir, (threads) =>
      threads.map((summary) =>
        summary.threadId === threadId
          ? { ...summary, status: outcome.thread.status, lastActivityAt: reply.timestamp }
          : summary
      )
    );
  }

  return outcome.thread;
}
```

Then replace `src/data/feedback/feedbackStorage.ts:171-185`:

```ts
export async function replyToFeedback(
  dir: DirectoryHandleLike,
  messageId: string,
  reply: FeedbackReply,
  resolve: boolean
): Promise<void> {
  await mutateFeedback(dir, (messages) => {
    const msg = messages.find((m) => m.id === messageId);
    if (msg) {
      msg.replies.push(reply);
      if (resolve) msg.status = "resolved";
    }
    return messages;
  });
}
```

with:

```ts
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

Note the deliberate behavior change: the old `mutateFeedback` version silently no-opped on an unknown `messageId` (`messages.find(...)` returned `undefined` and the mutation fell through). `appendReply` throws. Silently swallowing a reply the user typed is worse than an Arabic error toast, and `FeedbackWidget.handleReply` (`src/components/FeedbackWidget/FeedbackWidget.tsx:141-168`) already has a `catch` that surfaces exactly that.

- [ ] **Step 4: Implement `listThreadSummaries`**

```ts
/**
 * Every thread's summary, newest-first.
 *
 * The index is a CACHE and is treated as one: one names-only
 * `listDirectoryEntries` over `threads/` (a single round trip, no file content
 * read) reconciles it. Any `.json` name the index does not know is read
 * individually and folded in, and the repaired index is written back
 * best-effort. That is what makes a create that lost the index race, a
 * half-finished migration, and a hand-copied thread file all self-healing
 * rather than invisible.
 *
 * Steady state cost: 1 index read + 1 listing + 0 thread reads.
 *
 * Ordered by `createdAt`, NOT `lastActivityAt` — see FeedbackThreadSummary:
 * a plain reply deliberately does not touch the index, so `lastActivityAt` is
 * advisory and must never drive ordering.
 */
export async function listThreadSummaries(
  dir: DirectoryHandleLike
): Promise<FeedbackThreadSummary[]> {
  const index = await loadThreadsIndex(dir);
  const known = new Map(index.threads.map((summary) => [summary.threadId, summary]));

  let threadsDir: DirectoryHandleLike | null = null;
  try {
    threadsDir = await getFeedbackThreadsDir(dir, false);
  } catch {
    // No threads folder yet: a brand-new workspace, or one whose feedback has
    // not been migrated. Either way the index is all there is to report.
  }

  const missingIds: string[] = [];
  if (threadsDir) {
    for (const entry of await listDirectoryEntries(threadsDir)) {
      if (entry.kind !== "file") continue;
      if (!entry.name.endsWith(FEEDBACK_THREAD_FILE_SUFFIX)) continue;
      const threadId = entry.name.slice(0, -FEEDBACK_THREAD_FILE_SUFFIX.length);
      // safeWriteJson keeps `{file}.bak`/`.tmp` siblings; their stems end in
      // `.json`/`.tmp` and must never be mistaken for a thread.
      if (!THREAD_ID_PATTERN.test(threadId) || threadId.endsWith(".json")) continue;
      if (!known.has(threadId)) missingIds.push(threadId);
    }
  }

  if (missingIds.length > 0) {
    const recovered = await loadThreads(dir, missingIds);
    for (const thread of recovered) {
      known.set(thread.id, summarize(thread, lastActivityOf(thread)));
    }
    if (recovered.length > 0) {
      try {
        const repaired = [...known.values()];
        await updateThreadsIndex(dir, () => repaired);
      } catch (error) {
        // Best effort: a read-only handle, or a lost race with a live writer.
        // The summaries returned below are already correct either way; the
        // repair simply retries on the next read.
        logError("feedback:repairThreadsIndex", error);
      }
    }
  }

  return [...known.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function lastActivityOf(thread: FeedbackThread): string {
  let latest = thread.timestamp;
  for (const reply of thread.replies) {
    if (reply.timestamp > latest) latest = reply.timestamp;
  }
  return latest;
}
```

Add the two imports:

```ts
import { listDirectoryEntries, readNamedJsonFiles } from "../storage/directoryScan";
import { logError } from "../storage/errorLogger";
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/data/feedback/feedbackStorage.test.ts`
Expected: every Task-4 test PASSES. The same two legacy tests from Task 3 Step 5 still fail; Task 5 rewrites them.

- [ ] **Step 6: Run the gates**

Run: `npm run lint && npm run typecheck`
Expected: green. (`test:run` still has the two known legacy-suite failures until Task 5 — do not report this task done to a human as "all tests green".)

- [ ] **Step 7: Write the edit-log entry, then commit**

```bash
npm run editlog -- --tier=3 --append --sync-package "Fix (feedback): reply to one thread file instead of the shared log, ending cross-user write contention"
git add src/data/feedback/feedbackStorage.ts src/data/feedback/feedbackStorage.test.ts "docs/edit logs/2026-08-24.md" package.json
git commit -m "Fix (feedback): reply to one thread file instead of the shared log, ending cross-user write contention" -- src/data/feedback/feedbackStorage.ts src/data/feedback/feedbackStorage.test.ts "docs/edit logs/2026-08-24.md" package.json
```

---

### Task 5: One-time lazy migration off `messages.json`, and the `loadFeedback` compatibility aggregate

**Files:**
- Modify: `src/data/feedback/feedbackStorage.ts` (add `migrateLegacyMessages`, rewrite `loadFeedback`, delete `mutateFeedback`)
- Rewrite: `src/data/feedback/feedbackStorage.test.ts`

**Interfaces:**
- Produces:
  - `migrateLegacyMessages(dir): Promise<{ migrated: number; skipped: "already-migrated" | "no-legacy-data" | null }>`
  - `loadFeedback(dir): Promise<FeedbackMessage[]>` — unchanged signature, now an aggregate over the thread files
- Consumes: the existing `loadFeedbackFile`/`normalizeFeedbackFile` legacy readers (`src/data/feedback/feedbackStorage.ts:63-95`), which are **kept** — they are the permanent read-only fallback.

**Migration contract:**
- **Trigger:** lazily, from `loadFeedback` and `listThreadSummaries`, when `threads/` holds no thread files **and** the legacy log holds ≥1 message. Never from a mount hook, never from a timer.
- **Effect:** one thread file per legacy message, keyed by the legacy message's own `id` (so it is idempotent by construction — a second machine running it concurrently writes byte-identical content to identical names), then one CAS index write.
- **Non-effect:** `messages.json` is not touched, at either location. It stays readable forever. CLAUDE.md's permanent-fallback rule, verbatim.
- **Read-only workspaces:** `safeWriteJson` throws on a read-only handle (`assertWritableMode`). Migration must catch that and fall back to serving the legacy messages read-only rather than blanking the panel. A guest with a read grant must still be able to *see* the history.
- **Rollback:** delete `5-system/feedback/threads/` and `5-system/feedback/threads.index.json` and downgrade the app. `messages.json` is exactly as it was, so a downgraded client resumes on it with no data loss. Feedback posted *after* the migration is lost to the downgraded client (it lives only in `threads/`) — state this in the edit-log entry's migration/rollback section.

- [ ] **Step 1: Rewrite `src/data/feedback/feedbackStorage.test.ts`**

Replace the whole file. The five original blocks map across as follows — none is silently dropped:

| Original block (line) | Fate |
|---|---|
| submit + readback (19-32) | kept, retargeted at `createThread`/`listThreadSummaries` |
| reply + resolve (34-49) | kept, retargeted at `appendReply`/`loadThread` (Task 4 already added it) |
| legacy bare-array migration (51-81) | **kept and expanded** — now asserts the split into thread files AND that `messages.json` survives untouched |
| new-location write (83-99) | rewritten — the assertion moves from `messages.json` to `threads/{id}.json` (Task 3 already added it) |
| concurrent-submit survives (101-114) | **kept and strengthened** — Task 3's operation-log version proves the two writers target *disjoint files*, which the original could only infer |

```ts
import { describe, expect, it } from "vitest";

import {
  clearOperationLog,
  createMemoryDirectory,
  getOperationLog,
  setSimulatedWritePermission,
} from "../storage/memoryDirectory";
import { safeWriteJson } from "../storage/safeWrite";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { SYSTEM_FOLDER_NAMES } from "../workspace/workspacePaths";
import {
  appendReply,
  createThread,
  listThreadSummaries,
  loadFeedback,
  loadThread,
  loadThreads,
  loadThreadsIndex,
  migrateLegacyMessages,
  replyToFeedback,
  submitFeedback,
  type FeedbackMessage,
  type FeedbackThread,
} from "./feedbackStorage";

function makeRoot(
  name = "root",
  options: Parameters<typeof createMemoryDirectory>[1] = {}
): DirectoryHandleLike {
  return createMemoryDirectory(name, options) as DirectoryHandleLike;
}

async function seedLegacyLog(
  root: DirectoryHandleLike,
  messages: FeedbackMessage[],
  where: "system" | "workspace-root"
): Promise<void> {
  const dir =
    where === "system"
      ? await (await root.getDirectoryHandle("5-system", { create: true })).getDirectoryHandle(
          SYSTEM_FOLDER_NAMES.feedback,
          { create: true }
        )
      : await root.getDirectoryHandle(SYSTEM_FOLDER_NAMES.feedback, { create: true });
  // Legacy writers persisted the bare array (wrapped only by safeWriteJson's envelope).
  await safeWriteJson<FeedbackMessage[]>(dir, "messages.json", messages);
}

const LEGACY_ONE: FeedbackMessage = {
  id: "legacy-1",
  from: "old",
  role: "employee",
  category: "inquiry",
  text: "قديم",
  timestamp: "2026-06-01T00:00:00.000Z",
  status: "open",
  replies: [],
};

const LEGACY_TWO: FeedbackMessage = {
  id: "legacy-2",
  from: "older",
  role: "supervisor",
  category: "issue",
  text: "أقدم",
  timestamp: "2026-05-01T00:00:00.000Z",
  status: "resolved",
  replies: [{ from: "admin", role: "admin", text: "تم", timestamp: "2026-05-02T00:00:00.000Z" }],
};

describe("feedbackStorage — per-thread storage", () => {
  // ... Task 2, 3 and 4 tests, moved into this file verbatim ...
});

describe("feedbackStorage — legacy migration", () => {
  it("splits a legacy messages.json into one thread file per message on first read", async () => {
    const root = makeRoot();
    await seedLegacyLog(root, [LEGACY_ONE, LEGACY_TWO], "system");

    const summaries = await listThreadSummaries(root);
    expect(summaries.map((s) => s.threadId).sort()).toEqual(["legacy-1", "legacy-2"]);

    // Each message is now its own self-contained file, replies included.
    const two = await loadThread(root, "legacy-2");
    expect(two!.status).toBe("resolved");
    expect(two!.replies).toHaveLength(1);
  });

  it("never touches the legacy messages.json", async () => {
    const root = makeRoot();
    await seedLegacyLog(root, [LEGACY_ONE], "system");
    const systemDir = await root.getDirectoryHandle("5-system", { create: false });
    const feedbackDir = await systemDir.getDirectoryHandle(SYSTEM_FOLDER_NAMES.feedback, { create: false });
    const before = await (await (await feedbackDir.getFileHandle("messages.json")).getFile()).text();

    await listThreadSummaries(root);
    await submitFeedback(root, { from: "new", role: "admin", category: "issue", text: "جديد" });

    const after = await (await (await feedbackDir.getFileHandle("messages.json")).getFile()).text();
    expect(after).toBe(before);
  });

  it("migrates from the legacy workspace-ROOT feedback/ folder too", async () => {
    const root = makeRoot();
    await seedLegacyLog(root, [LEGACY_ONE], "workspace-root");

    const summaries = await listThreadSummaries(root);
    expect(summaries.map((s) => s.threadId)).toEqual(["legacy-1"]);
  });

  it("is idempotent — a second call migrates nothing and duplicates nothing", async () => {
    const root = makeRoot();
    await seedLegacyLog(root, [LEGACY_ONE, LEGACY_TWO], "system");

    const first = await migrateLegacyMessages(root);
    expect(first.migrated).toBe(2);
    const second = await migrateLegacyMessages(root);
    expect(second.migrated).toBe(0);
    expect(second.skipped).toBe("already-migrated");

    expect((await listThreadSummaries(root)).map((s) => s.threadId).sort()).toEqual([
      "legacy-1",
      "legacy-2",
    ]);
  });

  it("survives two clients migrating the same workspace concurrently", async () => {
    const root = makeRoot();
    await seedLegacyLog(root, [LEGACY_ONE, LEGACY_TWO], "system");

    await Promise.all([migrateLegacyMessages(root), migrateLegacyMessages(root)]);

    // Thread files are keyed by the legacy id, so both writers produce
    // byte-identical content at identical names -- no duplicates, no loss.
    const index = await loadThreadsIndex(root);
    expect(index.threads.map((t) => t.threadId).sort()).toEqual(["legacy-1", "legacy-2"]);
  });

  it("never migrates on top of existing threads", async () => {
    const root = makeRoot();
    await createThread(root, { from: "sara", role: "employee", category: "issue", text: "حديث" });
    await seedLegacyLog(root, [LEGACY_ONE], "system");

    const outcome = await migrateLegacyMessages(root);
    expect(outcome.skipped).toBe("already-migrated");
    expect(outcome.migrated).toBe(0);
    // The legacy message stays visible through the legacy fallback in
    // loadFeedback -- but it is NOT copied over an already-migrated workspace,
    // which would resurrect messages a later state deliberately supersedes.
    expect((await listThreadSummaries(root)).map((s) => s.threadId)).not.toContain("legacy-1");
  });

  it("still serves legacy messages read-only when the workspace cannot be written", async () => {
    const root = makeRoot();
    await seedLegacyLog(root, [LEGACY_ONE], "system");
    setSimulatedWritePermission(root, "denied", "denied");

    // A guest with a read grant must still SEE the history; migration failing
    // is not a reason to show an empty panel.
    const messages = await loadFeedback(root);
    expect(messages.map((m) => m.id)).toEqual(["legacy-1"]);
  });

  it("reports no legacy data for a brand-new workspace", async () => {
    const root = makeRoot();
    const outcome = await migrateLegacyMessages(root);
    expect(outcome).toEqual({ migrated: 0, skipped: "no-legacy-data" });
  });
});

describe("feedbackStorage — loadFeedback aggregate", () => {
  it("returns every thread as a FeedbackMessage, newest-first", async () => {
    const root = makeRoot();
    const first = await createThread(root, { from: "a", role: "employee", category: "issue", text: "أ" });
    const second = await createThread(root, { from: "b", role: "employee", category: "issue", text: "ب" });
    await appendReply(root, first.id, { from: "admin", role: "admin", text: "رد", timestamp: "2026-08-24T11:00:00.000Z" }, false);

    const messages = await loadFeedback(root);
    expect(messages.map((m) => m.id)).toEqual([second.id, first.id]);
    expect(messages.find((m) => m.id === first.id)!.replies).toHaveLength(1);
  });

  it("keeps the submit -> reply -> resolve round trip working through the wrappers", async () => {
    const root = makeRoot();
    await submitFeedback(root, { from: "sara", role: "employee", category: "issue", text: "خطأ" });
    const [msg] = await loadFeedback(root);

    await replyToFeedback(
      root,
      msg!.id,
      { from: "admin", role: "admin", text: "تم", timestamp: "2026-07-01T10:00:00.000Z" },
      true
    );

    const [after] = await loadFeedback(root);
    expect(after!.replies).toHaveLength(1);
    expect(after!.status).toBe("resolved");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/data/feedback/feedbackStorage.test.ts`
Expected: FAIL — `migrateLegacyMessages` does not exist, and `loadFeedback` still reads `messages.json`.

- [ ] **Step 3: Implement `migrateLegacyMessages`**

```ts
/**
 * ONE-TIME, LAZY split of a legacy `messages.json` into per-thread files.
 *
 * Runs from the read path (loadFeedback / listThreadSummaries) the first time a
 * workspace with legacy data is opened by a client that speaks the new layout.
 * There is no mount hook and no timer: a workspace nobody opens is never
 * touched.
 *
 * THE LEGACY FILE IS NEVER WRITTEN, MOVED OR DELETED — at either location. It
 * stays readable forever, which is CLAUDE.md's permanent-fallback rule and the
 * whole rollback story: remove `threads/` + `threads.index.json` and a
 * downgraded client resumes on `messages.json` exactly as it was.
 *
 * IDEMPOTENT BY CONSTRUCTION: each thread file is keyed by the legacy
 * message's own `id`, so a second client running this concurrently writes
 * byte-identical content to identical names. The index write is a casLoop, so
 * one wins and the other retries against fresh state.
 *
 * NEVER migrates on top of an already-migrated workspace: legacy content that
 * a later state deliberately superseded must not be resurrected.
 */
export async function migrateLegacyMessages(
  dir: DirectoryHandleLike
): Promise<{ migrated: number; skipped: "already-migrated" | "no-legacy-data" | null }> {
  if (await hasAnyThreadFile(dir)) {
    return { migrated: 0, skipped: "already-migrated" };
  }
  const legacy = await loadFeedbackFile(dir);
  if (legacy.messages.length === 0) {
    return { migrated: 0, skipped: "no-legacy-data" };
  }

  const threadsDir = await getFeedbackThreadsDir(dir, true);
  const summaries: FeedbackThreadSummary[] = [];
  for (const message of legacy.messages) {
    const thread: FeedbackThread = {
      ...message,
      status: message.status === "resolved" ? "resolved" : "open",
      replies: Array.isArray(message.replies) ? message.replies : [],
      revision: 1,
    };
    await safeWriteJson<FeedbackThread>(threadsDir, feedbackThreadFileName(thread.id), thread);
    summaries.push(summarize(thread, lastActivityOf(thread)));
  }

  await updateThreadsIndex(dir, (threads) => {
    const merged = new Map(threads.map((summary) => [summary.threadId, summary]));
    for (const summary of summaries) merged.set(summary.threadId, summary);
    return [...merged.values()];
  });

  return { migrated: summaries.length, skipped: null };
}

/** Cheap "has this workspace been migrated?" probe: one names-only listing, no reads. */
async function hasAnyThreadFile(dir: DirectoryHandleLike): Promise<boolean> {
  let threadsDir: DirectoryHandleLike;
  try {
    threadsDir = await getFeedbackThreadsDir(dir, false);
  } catch {
    return false;
  }
  for (const entry of await listDirectoryEntries(threadsDir)) {
    if (entry.kind !== "file") continue;
    if (!entry.name.endsWith(FEEDBACK_THREAD_FILE_SUFFIX)) continue;
    const threadId = entry.name.slice(0, -FEEDBACK_THREAD_FILE_SUFFIX.length);
    if (THREAD_ID_PATTERN.test(threadId) && !threadId.endsWith(".json")) return true;
  }
  return false;
}

/**
 * Best-effort migration, for the read path.
 *
 * A failure here is NEVER fatal: a read-only handle (safeWriteJson throws via
 * assertWritableMode), a revoked grant, a lost race with another client. The
 * caller falls back to the legacy log, so a guest with a read grant still sees
 * the full history instead of an empty panel.
 */
async function ensureMigrated(dir: DirectoryHandleLike): Promise<void> {
  try {
    await migrateLegacyMessages(dir);
  } catch (error) {
    logError("feedback:migrateLegacyMessages", error);
  }
}
```

Hook it into `listThreadSummaries` — insert as its first statement, before `loadThreadsIndex`:

```ts
export async function listThreadSummaries(
  dir: DirectoryHandleLike
): Promise<FeedbackThreadSummary[]> {
  await ensureMigrated(dir);
  const index = await loadThreadsIndex(dir);
```

- [ ] **Step 4: Rewrite `loadFeedback` and delete `mutateFeedback`**

Replace `src/data/feedback/feedbackStorage.ts:97-99`:

```ts
export async function loadFeedback(dir: DirectoryHandleLike): Promise<FeedbackMessage[]> {
  return (await loadFeedbackFile(dir)).messages;
}
```

with:

```ts
/**
 * Every message, newest-first — the FULL aggregate.
 *
 * This is the ONE remaining read that opens every thread file, and it exists
 * for `FeedbackUnreadProvider`: `countUnreadFeedback` needs each individual
 * reply's author and timestamp, which the summaries deliberately do not carry.
 * The widget's LIST view must not call this — it uses `listThreadSummaries`
 * plus a page-scoped `loadThreads`.
 *
 * Cost note (a trade, not an oversight): one large file read becomes N small
 * ones at DIRECTORY_READ_CONCURRENCY. Same bytes, more round trips. The read
 * path was never the reported failure — the shared WRITE was (XQ-IO-032).
 *
 * Falls back to the legacy log whenever migration could not run (read-only
 * grant) or has not run yet, so no reader ever sees an empty panel over a
 * workspace that has data.
 */
export async function loadFeedback(dir: DirectoryHandleLike): Promise<FeedbackMessage[]> {
  const summaries = await listThreadSummaries(dir);
  if (summaries.length === 0) {
    return [...(await loadFeedbackFile(dir)).messages].sort((a, b) =>
      b.timestamp.localeCompare(a.timestamp)
    );
  }
  const threads = await loadThreads(dir, summaries.map((summary) => summary.threadId));
  return threads.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}
```

Then **delete** `mutateFeedback` entirely (`src/data/feedback/feedbackStorage.ts:101-150`, the doc block plus the function). Nothing calls it after Tasks 3 and 4. Delete the now-unused `FeedbackFile`-writing half of the imports if `lint` flags them — but **keep** `FeedbackFile`, `normalizeFeedbackFile` and `loadFeedbackFile` (lines 27-95): they are the permanent read-only legacy path and both `migrateLegacyMessages` and `loadFeedback`'s fallback depend on them. Update `FeedbackFile`'s doc block to say it is now read-only:

```ts
/**
 * On-disk shape for the LEGACY `messages.json`. The list is wrapped so it can
 * carry the CAS bookkeeping (`revision` + `_writeToken`) that let casLoop
 * detect a concurrent write from another machine; older files persisted the
 * bare `FeedbackMessage[]` directly — `loadFeedbackFile` still reads that shape.
 *
 * READ-ONLY as of v116.0. Nothing writes this file any more: feedback lives in
 * `5-system/feedback/threads/{threadId}.json`, one file per conversation, and
 * `migrateLegacyMessages` copies out of here exactly once and leaves the
 * original untouched forever.
 */
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/data/feedback/feedbackStorage.test.ts`
Expected: PASS, all blocks.

- [ ] **Step 6: Run the gates**

Run: `npm run lint && npm run typecheck && npm run test:run`
Expected: all green **except** possibly `src/data/workspace/workspaceSync.test.tsx:970-1010` (the feedback-family probe still watches `messages.json`, which nothing writes now). Task 6 fixes it. Confirm that is the only remaining failure and that `FeedbackWidget.unreadDot.test.tsx` is green (it mocks `loadFeedback` wholesale, so it is insulated).

- [ ] **Step 7: Write the edit-log entry, then commit**

The entry MUST carry the migration/rollback section tier 3 requires: trigger, idempotency, the read-only fallback, and the "post-migration feedback is invisible to a downgraded client" caveat.

```bash
npm run editlog -- --tier=3 --append --sync-package "Change (feedback): lazily split the legacy shared messages.json into per-thread files, read-only fallback kept"
git add src/data/feedback/feedbackStorage.ts src/data/feedback/feedbackStorage.test.ts "docs/edit logs/2026-08-24.md" package.json
git commit -m "Change (feedback): lazily split the legacy shared messages.json into per-thread files, read-only fallback kept" -- src/data/feedback/feedbackStorage.ts src/data/feedback/feedbackStorage.test.ts "docs/edit logs/2026-08-24.md" package.json
```

---

### Task 6: Repoint the `workspaceSync` feedback probe at the thread files

**Files:**
- Modify: `src/data/workspace/workspaceSync.ts`
- Test: `src/data/workspace/workspaceSync.test.tsx`

**Interfaces:**
- Consumes: `boundedSizeSignature` (`src/data/storage/directoryScan.ts:597`) — already imported in this file for `safeSegmentsSignature`; `FEEDBACK_THREAD_FILE_SUFFIX` and `FEEDBACK_SUBFOLDERS` from Tasks 1-2.
- Produces: `Probe.feedbackRevision: Probed<number | null>` is **replaced** by `Probe.feedbackSignature: Probed<string>`. The `"feedback"` `DataRefreshFamily` and every subscriber (`FeedbackUnreadProvider.tsx:83`) are unchanged.

**Why the probe must change, and why to a signature rather than a revision.** Today's probe is `safeRevision(dirs.feedbackDir, FEEDBACK_MESSAGES_FILE)` (`src/data/workspace/workspaceSync.ts:491`). After Task 5 nothing writes `messages.json`, so that probe freezes and the unread dot on both widget triggers stops lighting for anyone else's activity — the exact staleness the doc comment at `workspaceSync.ts:172-184` says this probe exists to remove.

Swapping it for the *index* revision would only be half a fix: by design a plain reply does **not** touch `threads.index.json`, and `workspaceSync.test.tsx:988-995` asserts that a reply reports the feedback family. So the probe watches the **threads directory** — the authority — with the same bounded signature already used for the distribution segments and the notification acks: one listing, no content read, at most 64 size stats from the tail of the name-sorted listing. A create adds a NAME (detected regardless of the stat budget); a reply changes a SIZE (detected for the newest 64, which is what Task 2's time-ordered ids guarantee the tail contains).

Residual, documented rather than hidden: a reply to a thread older than the newest 64 does not move the signature. It is still picked up by `FeedbackUnreadProvider`'s own 60 s poll and by the manual refresh button — the tick is a latency optimization on top of those, not the only path.

- [ ] **Step 1: Write the failing tests**

The two existing tests at `src/data/workspace/workspaceSync.test.tsx:971-1009` are already the right assertions and must keep passing unchanged — they are the regression guard for this whole task. Add one more to the same `describe` block:

```ts
  it("reports the feedback family for a reply to a thread nobody resolved", async () => {
    const root = makeRoot();
    await submitFeedback(root, { from: "emp-1", role: "employee", category: "issue", text: "الجهاز لا يعمل" });
    await runSync({ directoryHandle: root, monthFolderName: MONTH }); // baseline

    const [message] = await loadFeedback(root);
    await replyToFeedback(
      root,
      message.id,
      { from: "admin", role: "admin", text: "تم الاطلاع", timestamp: new Date().toISOString() },
      false // NOT resolved -- so threads.index.json is deliberately untouched
    );

    const after = await runSync({ directoryHandle: root, monthFolderName: MONTH });
    expect(after.changed.has("feedback")).toBe(true);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/data/workspace/workspaceSync.test.tsx -t "feedback"`
Expected: FAIL — all three tests in that block report `changed.has("feedback") === false`, because `messages.json` no longer moves.

- [ ] **Step 3: Replace the probe field**

In `src/data/workspace/workspaceSync.ts`, replace lines 172-185:

```ts
  /**
   * Envelope revision of `5-system/feedback/messages.json` — the shared feedback
   * ("chat") log. It is the signal behind the unread dot on both widget
   * triggers, so a message or a reply posted on another machine has to reach
   * other clients on a tick rather than on a manual refresh.
   *
   * Deliberately the CURRENT location only: a legacy workspace still holding its
   * log at the top-level `feedback/` root probes as "no file" (a real
   * observation, diffed normally) until its first mutation migrates it forward —
   * see feedbackStorage's own note. Probing both would put a second directory
   * open on every tick of every client to cover a state that heals itself the
   * first time anyone posts.
   */
  feedbackRevision: Probed<number | null>;
```

with:

```ts
  /**
   * Bounded name+size signature of `5-system/feedback/threads/*.json` — the
   * shared feedback ("chat") threads. It is the signal behind the unread dot on
   * both widget triggers, so a message or a reply posted on another machine has
   * to reach other clients on a tick rather than on a manual refresh.
   *
   * The THREADS directory, not `threads.index.json`: a plain reply deliberately
   * does not touch the index (that is what keeps the one shared file rarely
   * written — see feedbackStorage's `updateThreadsIndex`), so an index-revision
   * probe would go blind to exactly the event this family exists to report.
   * The thread files are the authority, so they are what is watched.
   *
   * Same bounded shape as the segments and acks probes: one listing, no file
   * content, at most DEFAULT_SIZE_SIGNATURE_STAT_BUDGET size stats taken from
   * the TAIL of the name-sorted listing. A new thread adds a NAME (always
   * detected); a reply changes a SIZE (detected for the newest 64 — which is
   * what feedbackStorage's time-ordered thread ids guarantee the tail holds).
   * A reply to an older thread than that is picked up by
   * FeedbackUnreadProvider's own 60 s poll instead; this tick is a latency
   * optimization on top of that poll, never the only path.
   *
   * Deliberately the CURRENT location only: a legacy workspace whose feedback
   * still sits in `messages.json` probes as "no folder" (a real observation,
   * diffed normally) until the first client to open it migrates it forward —
   * see feedbackStorage's `migrateLegacyMessages`. Probing the legacy root too
   * would put a second directory open on every tick of every client to cover a
   * state that heals itself the first time anyone opens the panel.
   */
  feedbackSignature: Probed<string>;
```

- [ ] **Step 4: Replace the probe implementation**

Add a probe helper next to `safeAcksSignature` (which ends at `src/data/workspace/workspaceSync.ts:439`):

```ts
/**
 * Bounded signature of the per-thread feedback files. Same shape and same
 * reasoning as `safeAcksSignature` above — and the same reason `safeRevision`
 * (one envelope read per file) is not reused: a file exists per conversation.
 */
async function safeFeedbackSignature(
  feedbackDir: DirectoryHandleLike | null
): Promise<Probed<string>> {
  if (!feedbackDir) return "";
  let threadsDir: DirectoryHandleLike;
  try {
    threadsDir = await feedbackDir.getDirectoryHandle(FEEDBACK_SUBFOLDERS.threads, {
      create: false,
    });
  } catch (error) {
    // Absent is normal for a brand-new or not-yet-migrated workspace.
    if (isNotFoundError(error)) return "";
    logError("workspaceSync:probeFeedbackOpen", error);
    return UNPROBED;
  }
  try {
    return await boundedSizeSignature(threadsDir, FEEDBACK_THREAD_FILE_SUFFIX);
  } catch (error) {
    logError("workspaceSync:probeFeedback", error);
    return UNPROBED;
  }
}
```

Then apply the four mechanical renames:

1. `src/data/workspace/workspaceSync.ts:472` — `feedbackRevision,` → `feedbackSignature,` (the destructure)
2. `src/data/workspace/workspaceSync.ts:491` — `safeRevision(dirs.feedbackDir, FEEDBACK_MESSAGES_FILE),` → `safeFeedbackSignature(dirs.feedbackDir),`
3. `src/data/workspace/workspaceSync.ts:502` — `feedbackRevision,` → `feedbackSignature,` (the returned object)
4. `src/data/workspace/workspaceSync.ts:515` — `feedbackRevision: carry(previous.feedbackRevision, current.feedbackRevision),` → `feedbackSignature: carry(previous.feedbackSignature, current.feedbackSignature),`
5. `src/data/workspace/workspaceSync.ts:563` —
   ```ts
   if (movedFrom(previous.feedbackRevision, current.feedbackRevision, sameValue)) {
   ```
   → 
   ```ts
   if (movedFrom(previous.feedbackSignature, current.feedbackSignature, sameValue)) {
   ```

Finally update the import at `src/data/workspace/workspaceSync.ts:59`:

```ts
import { FEEDBACK_MESSAGES_FILE } from "../feedback/feedbackStorage";
```

becomes:

```ts
import { FEEDBACK_THREAD_FILE_SUFFIX } from "../feedback/feedbackStorage";
```

and add `FEEDBACK_SUBFOLDERS` to the existing `workspacePaths` import in this file. `isNotFoundError` and `boundedSizeSignature` are already imported here (`safeAcksSignature`/`safeSegmentsSignature` use them) — confirm before adding duplicates.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/data/workspace/workspaceSync.test.tsx`
Expected: PASS — all three feedback tests, plus every pre-existing test in this ~1000-line file. Pay particular attention to `"reports nothing when the feedback log has not moved"` (line 998): it proves the signature is *stable* across ticks on an untouched directory, which is the property a reshuffling sample would break.

- [ ] **Step 6: Run the gates**

Run: `npm run lint && npm run typecheck && npm run test:run`
Expected: all green, whole suite.

- [ ] **Step 7: Write the edit-log entry, then commit**

```bash
npm run editlog -- --tier=3 --append --sync-package "Fix (sync): probe the feedback thread files instead of the frozen shared messages.json"
git add src/data/workspace/workspaceSync.ts src/data/workspace/workspaceSync.test.tsx "docs/edit logs/2026-08-24.md" package.json
git commit -m "Fix (sync): probe the feedback thread files instead of the frozen shared messages.json" -- src/data/workspace/workspaceSync.ts src/data/workspace/workspaceSync.test.tsx "docs/edit logs/2026-08-24.md" package.json
```

---

### Task 7: Rewire `FeedbackWidget`'s data fetching to summaries + page-scoped thread loads

**Files:**
- Modify: `src/components/FeedbackWidget/FeedbackWidget.tsx`
- Create: `src/components/FeedbackWidget/FeedbackWidget.threads.test.tsx`

**Interfaces:**
- Consumes: `listThreadSummaries`, `loadThreads`, `createThread`/`submitFeedback`, `appendReply`/`replyToFeedback`, `type FeedbackThreadSummary`, `type FeedbackThread`.
- Produces: no new exports. `MessageCard` (`src/components/FeedbackWidget/FeedbackWidget.tsx:394-469`) keeps its exact props — it still takes a `FeedbackMessage`, and `FeedbackThread` extends it.

**What changes, precisely.** The widget currently calls `loadFeedback` on open (`FeedbackWidget.tsx:79-90`) and holds every message in `messages` state. It now holds `summaries` (one index read + one listing) and loads **only the current page's** thread files. `openCount`, `myMessages` and `filteredMessages` are all computable from summaries, so the filter/tab/pagination logic keeps working on cheap data. `DATA_PAGE_SIZE` is 100 (`src/utils/paginationUtils.ts:1`), so a page load is at most 100 small reads at `DIRECTORY_READ_CONCURRENCY = 8` — and in practice a feedback inbox is far under one page.

**`markSeen` must not regress.** Today the widget passes its own freshly-loaded list (`markSeen(msgs)`, line 89) precisely because the provider's copy may be a poll interval older. Under the new shape the widget no longer holds the full list, so it awaits `reloadUnread()` first and then calls `markSeen()` with no argument: `FeedbackUnreadProvider`'s `applyMessages` sets `messagesRef.current` **synchronously** before `setMessages` (`FeedbackUnreadProvider.tsx:45-48`), so `markSeen()` reads exactly the list that `reload` just fetched. Same freshness, no extra read.

**No new label keys.** The page-load spinner reuses `fb_loading`, which the manager view already renders (`FeedbackWidget.tsx:359-360`). Do not inline Arabic.

- [ ] **Step 1: Write the failing tests**

Create `src/components/FeedbackWidget/FeedbackWidget.threads.test.tsx`:

```tsx
/* @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

import type { DirectoryHandleLike } from "../../data/storage/fileSystemAccess";
import { createMemoryDirectory } from "../../data/storage/memoryDirectory";
import type {
  FeedbackThread,
  FeedbackThreadSummary,
} from "../../data/feedback/feedbackStorage";

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

// ... reuse FeedbackWidget.unreadDot.test.tsx's session/workspace/provider mock
// setup verbatim -- READ THAT FILE IN FULL FIRST (it is ~150 lines and already
// solves the auth-session + useWorkspace + FeedbackUnreadProvider wiring this
// component needs). Do not invent a second harness.

function summary(overrides: Partial<FeedbackThreadSummary> & { threadId: string }): FeedbackThreadSummary {
  return {
    from: "sara",
    role: "employee",
    category: "suggestion",
    status: "open",
    createdAt: "2026-08-24T10:00:00.000Z",
    lastActivityAt: "2026-08-24T10:00:00.000Z",
    preview: "معاينة",
    ...overrides,
  };
}

describe("FeedbackWidget — per-thread data fetching", () => {
  beforeEach(() => {
    storage.listThreadSummaries.mockReset();
    storage.loadThreads.mockReset();
    storage.loadFeedback.mockReset().mockResolvedValue([]);
  });
  afterEach(cleanup);

  it("reads the index for the list and opens only the current page's thread files", async () => {
    const summaries = Array.from({ length: 150 }, (_, i) =>
      summary({
        threadId: `t2026082410${String(i).padStart(4, "0")}-aaaaaaaa`,
        from: "sara",
        createdAt: new Date(Date.UTC(2026, 7, 24, 10, 0, i)).toISOString(),
      })
    );
    storage.listThreadSummaries.mockResolvedValue(summaries);
    storage.loadThreads.mockResolvedValue([]);

    renderWidgetOpen(); // helper from the shared harness

    await waitFor(() => expect(storage.listThreadSummaries).toHaveBeenCalled());
    await waitFor(() => expect(storage.loadThreads).toHaveBeenCalled());

    // DATA_PAGE_SIZE is 100: page one, and only page one.
    const requestedIds = storage.loadThreads.mock.calls.at(-1)![1];
    expect(requestedIds).toHaveLength(100);
    expect(requestedIds).not.toContain(summaries[149]!.threadId);
  });

  it("never calls the full loadFeedback aggregate from its own list view", async () => {
    storage.listThreadSummaries.mockResolvedValue([summary({ threadId: "t20260824100000-aaaaaaaa" })]);
    storage.loadThreads.mockResolvedValue([]);

    renderWidgetOpen();

    await waitFor(() => expect(storage.listThreadSummaries).toHaveBeenCalled());
    // The unread PROVIDER may call it; the widget's own refresh must not.
    expect(storage.loadFeedback).not.toHaveBeenCalledWith(expect.anything(), expect.anything());
  });

  it("renders a thread's replies once its file has loaded", async () => {
    const threadId = "t20260824100000-aaaaaaaa";
    storage.listThreadSummaries.mockResolvedValue([summary({ threadId, preview: "خطأ" })]);
    storage.loadThreads.mockResolvedValue([
      {
        id: threadId,
        from: "sara",
        role: "employee",
        category: "issue",
        text: "خطأ",
        timestamp: "2026-08-24T10:00:00.000Z",
        status: "open",
        replies: [{ from: "admin", role: "admin", text: "تم الاطلاع", timestamp: "2026-08-24T11:00:00.000Z" }],
      },
    ]);

    renderWidgetOpen();

    expect(await screen.findByText("تم الاطلاع")).toBeInTheDocument();
  });
});
```

Read `src/components/FeedbackWidget/FeedbackWidget.unreadDot.test.tsx` **in full** before writing this file — it already has the session/workspace/provider harness, and duplicating it badly is how this test ends up testing the mocks instead of the component.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/FeedbackWidget/FeedbackWidget.threads.test.tsx`
Expected: FAIL — the component still calls `loadFeedback` and never calls `listThreadSummaries`/`loadThreads`.

- [ ] **Step 3: Replace the widget's state and load effect**

In `src/components/FeedbackWidget/FeedbackWidget.tsx`, change the import at lines 4-10:

```tsx
import {
  loadFeedback,
  replyToFeedback,
  submitFeedback,
  type FeedbackCategory,
  type FeedbackMessage,
} from "../../data/feedback/feedbackStorage";
```

to:

```tsx
import {
  listThreadSummaries,
  loadThreads,
  replyToFeedback,
  submitFeedback,
  type FeedbackCategory,
  type FeedbackThread,
  type FeedbackThreadSummary,
} from "../../data/feedback/feedbackStorage";
```

Replace the message state at line 51:

```tsx
  const [messages, setMessages] = useState<FeedbackMessage[]>([]);
```

with:

```tsx
  // The list view holds SUMMARIES only (one index read + one names-only
  // listing). Thread bodies and replies are loaded for the current page alone
  // -- opening the panel no longer reads every conversation on the share.
  const [summaries, setSummaries] = useState<FeedbackThreadSummary[]>([]);
  const [threadsById, setThreadsById] = useState<Record<string, FeedbackThread>>({});
```

Replace `refresh` (lines 79-90):

```tsx
  const refresh = useCallback(async () => {
    if (!directoryHandle) return;
    setLoading(true);
    const msgs = await loadFeedback(directoryHandle);
    setMessages(msgs);
    setLoading(false);
    markSeen(msgs);
  }, [directoryHandle, markSeen]);
```

with:

```tsx
  const refresh = useCallback(async () => {
    if (!directoryHandle) return;
    setLoading(true);
    const [list] = await Promise.all([
      listThreadSummaries(directoryHandle),
      // The unread provider owns the full aggregate read; awaiting its reload
      // here is what lets markSeen() below use the SAME freshness the old
      // markSeen(msgs) had -- applyMessages sets messagesRef synchronously
      // before setState, so the ref is already the list just fetched.
      reloadUnread(),
    ]);
    setSummaries(list);
    setLoading(false);
    markSeen();
  }, [directoryHandle, markSeen, reloadUnread]);
```

- [ ] **Step 4: Add the page-scoped thread loader**

Derive the visible page from summaries, then load exactly those threads. Insert after the existing `safeMyPage`/`safeAdminPage` derivations (currently `src/components/FeedbackWidget/FeedbackWidget.tsx:177-178`, computed from `myMessages`/`filteredMessages`, which become summary arrays):

```tsx
  const visibleSummaries = useMemo(
    () =>
      isManager && adminTab === "all"
        ? pageSlice(filteredSummaries, safeAdminPage)
        : pageSlice(mySummaries, safeMyPage),
    [isManager, adminTab, filteredSummaries, safeAdminPage, mySummaries, safeMyPage]
  );

  const visibleIds = useMemo(
    () => visibleSummaries.map((summary) => summary.threadId),
    [visibleSummaries]
  );
  // Stable dependency: the array identity changes on every render, the joined
  // key does not.
  const visibleIdsKey = visibleIds.join("|");

  useEffect(() => {
    if (!directoryHandle || !open || visibleIds.length === 0) return;
    let cancelled = false;
    loadThreads(directoryHandle, visibleIds)
      .then((threads) => {
        if (cancelled) return;
        setThreadsById((prev) => {
          const next = { ...prev };
          for (const thread of threads) next[thread.id] = thread;
          return next;
        });
      })
      .catch(() => {
        // A page that cannot be read leaves the previously-loaded threads in
        // place; the cards fall back to their summary rows.
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- visibleIdsKey is the stable identity of visibleIds
  }, [directoryHandle, open, visibleIdsKey]);
```

Rename the three derivations at lines 170-176 to work on summaries:

```tsx
  const openCount = messages.filter((m) => m.status === "open").length;
  const myMessages = session
    ? messages.filter((m) => m.from === session.username)
    : [];
  const filteredMessages = messages.filter((m) =>
    filter === "all" ? true : m.status === filter
  );
  const safeMyPage = clampPage(myPage, myMessages.length);
  const safeAdminPage = clampPage(adminPage, filteredMessages.length);
```

becomes:

```tsx
  // All three run on SUMMARIES -- status, author and count are index fields, so
  // filtering and paginating costs no thread reads at all.
  const openCount = summaries.filter((s) => s.status === "open").length;
  const mySummaries = session
    ? summaries.filter((s) => s.from === session.username)
    : [];
  const filteredSummaries = summaries.filter((s) =>
    filter === "all" ? true : s.status === filter
  );
  const safeMyPage = clampPage(myPage, mySummaries.length);
  const safeAdminPage = clampPage(adminPage, filteredSummaries.length);
```

- [ ] **Step 5: Render the cards from the loaded threads**

Replace the two `pageSlice(...).map(...)` render blocks. The user's own history at lines 335-348:

```tsx
                      {pageSlice(myMessages, safeMyPage).map((msg) => (
                        <MessageCard
                          key={msg.id}
                          msg={msg}
                          isAdmin={false}
                          canReply={msg.status === "open"}
                          replyText={replyTexts[msg.id] ?? ""}
                          onReplyChange={(v) =>
                            setReplyTexts((prev) => ({ ...prev, [msg.id]: v }))
                          }
                          onReply={() => { void handleReply(msg.id, false); }}
                          isSending={replying === msg.id}
                        />
                      ))}
```

becomes:

```tsx
                      {visibleSummaries.map((s) => {
                        const msg = threadsById[s.threadId];
                        // The thread file for this row has not arrived yet.
                        if (!msg) return <p key={s.threadId} className="fb-empty">{getLabels().fb_loading}</p>;
                        return (
                          <MessageCard
                            key={msg.id}
                            msg={msg}
                            isAdmin={false}
                            canReply={msg.status === "open"}
                            replyText={replyTexts[msg.id] ?? ""}
                            onReplyChange={(v) =>
                              setReplyTexts((prev) => ({ ...prev, [msg.id]: v }))
                            }
                            onReply={() => { void handleReply(msg.id, false); }}
                            isSending={replying === msg.id}
                          />
                        );
                      })}
```

Apply the same transformation to the manager view at lines 366-379, keeping `isAdmin`, `onResolve` and the rest of that block's props exactly as they are. Update both `Pagination` call sites to the summary arrays: line 350 `totalItems={myMessages.length}` → `totalItems={mySummaries.length}`, line 381 `totalItems={filteredMessages.length}` → `totalItems={filteredSummaries.length}`, and line 361's `filteredMessages.length === 0` → `filteredSummaries.length === 0`.

Add `useMemo` to the React import at line 1.

- [ ] **Step 6: Keep the write handlers correct**

`handleSubmit` (lines 118-139) and `handleReply` (lines 141-168) already call `submitFeedback`/`replyToFeedback` and already `catch` and surface the Arabic error. Both keep working unchanged — the wrappers preserved in Tasks 3 and 4 route them to `createThread`/`appendReply`. One addition each: after a successful write, drop the affected thread from `threadsById` so `refresh()`'s page load re-reads it rather than re-rendering a stale copy. In `handleReply`, after `setReplyTexts(...)` at line 159:

```tsx
      setThreadsById((prev) => {
        const next = { ...prev };
        delete next[msgId];
        return next;
      });
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/components/FeedbackWidget/`
Expected: PASS — the new file, and `FeedbackWidget.unreadDot.test.tsx` unchanged (it mocks `loadFeedback` for the *provider*, which still calls it).

- [ ] **Step 8: Verify in the real app — this step is not optional**

Run `npm run dev`, open in Chrome/Edge, attach a workspace that has legacy `messages.json` data, and confirm by hand:
1. The panel opens and shows the migrated history (migration ran lazily).
2. Submitting a new message appears in "رسائلي السابقة" after the refresh.
3. As an admin, replying and resolving both work and the badge flips.
4. `5-system/feedback/threads/` on disk holds one file per conversation and `messages.json` is byte-identical to before.

CLAUDE.md is explicit that this repo has a documented history of effect-timing and state-machine bugs surviving self-review. This task adds a new effect keyed on a derived string and a new async page load — exactly that class. Do not report it working on the strength of reading the code.

- [ ] **Step 9: Run the gates**

Run: `npm run lint && npm run typecheck && npm run test:run`
Expected: all green, whole suite.

- [ ] **Step 10: Write the edit-log entry, then commit**

```bash
npm run editlog -- --tier=3 --append --sync-package "Change (feedback-widget): list from the thread index and open only the current page's thread files"
git add src/components/FeedbackWidget/FeedbackWidget.tsx src/components/FeedbackWidget/FeedbackWidget.threads.test.tsx "docs/edit logs/2026-08-24.md" package.json
git commit -m "Change (feedback-widget): list from the thread index and open only the current page's thread files" -- src/components/FeedbackWidget/FeedbackWidget.tsx src/components/FeedbackWidget/FeedbackWidget.threads.test.tsx "docs/edit logs/2026-08-24.md" package.json
```

---

### Task 8: Documentation sync

**Files:**
- Modify: `docs/architecture/data-system-report.md` (the authoritative path reference — CLAUDE.md requires it stay in sync)
- Modify: `CLAUDE.md` (the disk-layout summary block)
- Modify: `src/data/feedback/feedbackUnread.ts` (module doc, lines 1-19)

Tier 1 prose on its own, but it rides the same tier-3 entry because it documents a data-format change.

- [ ] **Step 1: Update `docs/architecture/data-system-report.md`'s file table**

Replace line 374:

```
| `messages.json` | `5-system/feedback/` | Shared user feedback log (suggestions/issues/inquiries + admin replies), CAS-protected (`revision` + `_writeToken`). Reads fall back to a legacy root-level `feedback/messages.json` for workspaces predating the move under `5-system/`; that legacy file is never deleted, only superseded once a write lands in the new location. |
```

with three rows:

```
| `threads/{threadId}.json` | `5-system/feedback/` | ONE self-contained conversation per file — the original message plus every reply. The durable source of truth for feedback. A new thread's file needs no CAS (its id is freshly minted, so no other writer can target the name); a reply CAS-loops that one file with a delayed verify. Ids are `t{YYYYMMDDHHmmss}-{8 hex}`: short enough for a deep UNC path plus Chromium's `.crswap` sibling, and lexicographically time-ordered so the sync tick's tail-sampled signature watches the newest threads. Migrated legacy threads keep their original UUID id and therefore sort into the oldest region. |
| `threads.index.json` | `5-system/feedback/` | Lightweight summaries (`threadId`, `from`, `role`, `category`, `status`, `createdAt`, `lastActivityAt`, `preview`) so the widget's list/filter/pagination costs no thread reads. CAS-protected (`revision` + `_writeToken`), same contract as `4-reports/designs/designs.index.json`. Written on thread CREATE and STATUS CHANGE only — never on a reply, which is what keeps the one shared file rarely touched. A REBUILDABLE CACHE, not an authority: `listThreadSummaries` reconciles it against a names-only listing of `threads/` on every read and repairs it best-effort, so a create that lost the index race is never lost. |
| `messages.json` | `5-system/feedback/` | LEGACY, read-only as of v116.0. The pre-v116 shared feedback log — every user's messages and every admin reply in one file, which is what made concurrent writers contend and exhaust the CAS ladder (XQ-IO-032). `migrateLegacyMessages` copies it into `threads/` exactly once, lazily, on the first read by a v116+ client, and then never touches it again. Never written, never moved, never deleted, at either this location or the legacy root-level `feedback/messages.json`. |
```

- [ ] **Step 2: Update `data-system-report.md`'s prose paragraph**

Replace lines 43-48:

```
`feedback/` used to be an exception: it lived directly at the workspace root (an undocumented 7th
top-level folder, breaking the `1-`…`6-` convention every other module already followed) instead of
nesting under `5-system/`alongside audit/notifications/presets. This was corrected in
`src/data/feedback/feedbackStorage.ts` — new feedback is written under `5-system/feedback/`. Reads
still fall back to the legacy root-level `feedback/` folder for workspaces that predate the fix, and
the legacy file is never deleted, only superseded.
```

with:

```
`feedback/` used to be an exception: it lived directly at the workspace root (an undocumented 7th
top-level folder, breaking the `1-`…`6-` convention every other module already followed) instead of
nesting under `5-system/` alongside audit/notifications/presets. This was corrected — feedback is
written under `5-system/feedback/`. Reads still fall back to the legacy root-level `feedback/`
folder for workspaces that predate the fix, and the legacy file is never deleted, only superseded.

Its `threads/` child (v116.0) is the same one-writer-per-file split already applied to
`5-system/notifications/acks/` and `5-system/audit/{activity,actions}/`: one file per conversation,
so two users posting at the same moment never target the same name. Paths resolve through
`getFeedbackDir` / `getFeedbackThreadsDir` in `workspacePaths.ts` — `feedbackStorage.ts` used to
call `getDirectoryHandle("feedback", …)` inline, which skipped both the handle cache and
`registerDirectoryPath` (the same defect `getAuditRoot`'s note records fixing for `audit/`).
```

- [ ] **Step 3: Update the `CLAUDE.md` disk-layout block**

In the layout code block, replace:

```
5-system/          workspace.schema.json, backups/, audit/, locks/, presets, notifications
```

with:

```
5-system/          workspace.schema.json, backups/, audit/, locks/, presets, notifications
  feedback/        threads/{threadId}.json (one per conversation), threads.index.json (CAS cache),
                   messages.json (legacy, read-only)
```

and replace the drift paragraph's second sentence (currently at `CLAUDE.md:105`):

```
**`feedback/` now writes under `5-system/feedback/`** — `feedbackStorage.ts` still *reads* the legacy top-level `feedback/` root so pre-existing workspaces keep working.
```

with:

```
**`feedback/` now writes under `5-system/feedback/`, one file per conversation** — `threads/{threadId}.json` is the source of truth, `threads.index.json` a rebuildable CAS-protected summary cache written only on create/status-change, and the pre-v116 shared `messages.json` is read-only and migrated out of lazily on first read. `feedbackStorage.ts` still *reads* the legacy top-level `feedback/` root so pre-existing workspaces keep working.
```

- [ ] **Step 4: Update `feedbackUnread.ts`'s module doc**

In `src/data/feedback/feedbackUnread.ts`, replace lines 3-9:

```ts
 * The feedback log itself (`5-system/feedback/messages.json`) is shared by every
 * user on every machine and carries no per-user read state — adding one would
 * mean every reader writing to a file only writers touch today, on a UNC/SMB
 * share, under CAS. Read state is therefore PER BROWSER, in `localStorage`: one
 * ISO timestamp per username marking the newest inbound activity that user has
 * already looked at. Losing it re-shows the dot once; nothing on disk is at risk.
```

with:

```ts
 * The feedback threads (`5-system/feedback/threads/{threadId}.json`) are shared
 * by every user on every machine and carry no per-user read state — adding one
 * would mean every reader writing to files only writers touch today, on a
 * UNC/SMB share, under CAS. Read state is therefore PER BROWSER, in
 * `localStorage`: one ISO timestamp per username marking the newest inbound
 * activity that user has already looked at. Losing it re-shows the dot once;
 * nothing on disk is at risk.
 *
 * This module consumes `loadFeedback`'s full aggregate (every thread) rather
 * than the summary index, because counting inbound items needs each individual
 * reply's author and timestamp — which `FeedbackThreadSummary` deliberately
 * does not carry.
```

- [ ] **Step 5: Run the gates**

Run: `npm run lint && npm run typecheck && npm run test:run`
Expected: green (docs-only plus one comment block; `lint` still runs over the repo).

- [ ] **Step 6: Write the edit-log entry, then commit**

```bash
npm run editlog -- --tier=3 --append --sync-package "Docs (feedback): document the per-thread layout in data-system-report, CLAUDE.md and feedbackUnread"
git add docs/architecture/data-system-report.md CLAUDE.md src/data/feedback/feedbackUnread.ts "docs/edit logs/2026-08-24.md" package.json
git commit -m "Docs (feedback): document the per-thread layout in data-system-report, CLAUDE.md and feedbackUnread" -- docs/architecture/data-system-report.md CLAUDE.md src/data/feedback/feedbackUnread.ts "docs/edit logs/2026-08-24.md" package.json
```

---

### Task 9: The full tier-3 gate sweep

**Files:** none modified except a possible `package.json` version touch and the edit log.

This is the **release** gate CLAUDE.md reserves for tier 3, run once at the end of the plan — not after every task.

- [ ] **Step 1: The tier-2 gates**

```bash
npm run lint
npm run typecheck
npm run test:run
```

Expected: all green. `test:run` was at 1970 tests / 231 files as of v72.0.0 and has grown since; this plan adds two test files (`feedbackThreads.test.ts`, `FeedbackWidget.threads.test.tsx`) and rewrites one (`feedbackStorage.test.ts`). No test may be deleted without a written reason in the edit log.

- [ ] **Step 2: The tier-3 additions**

```bash
npm run check:complexity
npm run check:hex-literals
npm run check:vendor
npm run build
npm run check:bundle-size
npm run check:release
```

Notes on the two that can plausibly fail:
- **`check:complexity`** — `feedbackStorage.ts` roughly doubles in size (it gains `createThread`, `appendReply`, `listThreadSummaries`, `migrateLegacyMessages`, `updateThreadsIndex` and the id helpers, and loses only `mutateFeedback`). If the budget trips, split the legacy-migration half into `src/data/feedback/feedbackMigration.ts` rather than raising the budget — the migration is a genuinely separable concern with a single entry point.
- **`check:bundle-size`** — the budget is 3.6 MB raw / 1.3 MB gzip against ~3.34 MB / ~1.11 MB. This change is a few kB of logic with no new dependency, so it should not move the needle; run it anyway, it is the release gate.
- **`check:release`** — passes only if `package.json`'s first two version segments match the TOPMOST heading in `docs/edit logs/2026-08-24.md`. Every task above used `--sync-package`, so this should already agree; if it does not, the cause is an entry inserted somewhere other than the top of the day's file.

- [ ] **Step 3: Verify the migration once more against a real workspace**

With `npm run build && npm run preview`, open the built single file in Chrome/Edge against a **copy** of a real workspace that has legacy feedback, and confirm the four checks from Task 7 Step 8 hold in the production bundle. `vitest` never type-checks and never runs `vite-plugin-singlefile`'s inlining, so this is the only place a build-only failure in this area would surface.

- [ ] **Step 4: Final edit-log entry and commit**

```bash
npm run editlog -- --tier=3 --append --sync-package "Chore (feedback): tier-3 release sweep for the per-thread feedback storage redesign"
git add "docs/edit logs/2026-08-24.md" package.json
git commit -m "Chore (feedback): tier-3 release sweep for the per-thread feedback storage redesign" -- "docs/edit logs/2026-08-24.md" package.json
```

The final entry carries the whole-repo line total (`npm run count-lines -- --quiet`) that tier 3 requires, plus the consolidated migration/rollback statement:

> **Migration:** lazy and one-time, on the first read by a v116+ client. `messages.json` is copied into `threads/`, keyed by each message's own id, and then never touched again — not moved, not deleted, at either the `5-system/feedback/` or the legacy workspace-root location. Idempotent and concurrency-safe by construction (identical names, identical content; the index write is a `casLoop`). A read-only grant fails the migration silently and falls back to serving the legacy log.
>
> **Rollback:** delete `5-system/feedback/threads/` and `5-system/feedback/threads.index.json`, then downgrade. `messages.json` is byte-identical to its pre-migration state, so a downgraded client resumes on it with no loss of pre-migration data. Feedback posted *after* the migration lives only in `threads/` and is not visible to a downgraded client — recover it by hand from the thread files before rolling back, or re-upgrade.

---

## Testing summary (per-task gates)

`npm run lint`, `npm run typecheck`, `npm run test:run` after every task. Task 9 adds `check:complexity`, `check:hex-literals`, `check:vendor`, `build`, `check:bundle-size`, `check:release` — the tier-3 release sweep, run once.

Tasks 3, 4 and 5 leave known, named failures behind in `feedbackStorage.test.ts` / `workspaceSync.test.tsx` that a later task in this plan closes. Each such task's steps say exactly which failures are expected and which task closes them. Do not "fix" them early by editing the assertions, and do not report those tasks as fully green to a human.

## Key files touched

| Task | Files |
|---|---|
| 1 | `src/data/workspace/workspacePaths.ts`, `.test.ts`, `src/data/feedback/feedbackStorage.ts` |
| 2 | `src/data/feedback/feedbackStorage.ts`, `feedbackThreads.test.ts` (new), `feedbackStorage.test.ts` |
| 3 | `src/data/feedback/feedbackStorage.ts`, `.test.ts` |
| 4 | `src/data/feedback/feedbackStorage.ts`, `.test.ts` |
| 5 | `src/data/feedback/feedbackStorage.ts`, `.test.ts` (rewritten) |
| 6 | `src/data/workspace/workspaceSync.ts`, `.test.tsx` |
| 7 | `src/components/FeedbackWidget/FeedbackWidget.tsx`, `FeedbackWidget.threads.test.tsx` (new) |
| 8 | `docs/architecture/data-system-report.md`, `CLAUDE.md`, `src/data/feedback/feedbackUnread.ts` |
| 9 | `docs/edit logs/2026-08-24.md`, `package.json` |

## Files deliberately NOT touched

| File | Why |
|---|---|
| `src/data/feedback/feedbackUnread.ts` (logic) | `FeedbackMessage`'s shape is preserved, so `listInboundActivity` / `countUnreadFeedback` / `markFeedbackSeen` need no change. Only the module doc is updated (Task 8). |
| `src/data/feedback/FeedbackUnreadProvider.tsx` | Still calls `loadFeedback`, whose signature is unchanged; still subscribes to the `"feedback"` family, which Task 6 keeps intact. |
| `src/data/feedback/FeedbackUnreadContext.ts` | Types `FeedbackMessage[]`, unchanged. |
| `src/components/FeedbackWidget/FeedbackWidget.unreadDot.test.tsx` | Mocks `loadFeedback` wholesale; the provider still calls it. Editing it to accommodate the new shape would delete real coverage of the dot. |
| `src/data/workspace/dataRefreshSignal.ts` | The `"feedback"` family name and its subscriber contract do not change; only what `workspaceSync` probes to decide it moved. |
| `src/data/backup/` | Verified: `backupStorage.ts` references `SYSTEM_FOLDER_NAMES` only for `backups` itself and never enumerates feedback at all — the old `messages.json` was not backed up either. So this change neither breaks nor needs backup coverage. (Feedback being outside the backup set is a pre-existing gap, not one this plan introduces; raising it is a separate decision.) |
