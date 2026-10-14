# Local-first answer outbox + calm reads — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A submitted answer is durable in the employee's browser in under a second and lands on the share in the background, so a slow or flaky SMB share can neither stall the employee nor lose or hide a submit; then cut the repeated reads that make loading take minutes.

**Architecture:** The existing IndexedDB mirror (`answerLocalMirror.ts`, `synced:false` records) becomes the outbox: the submit path writes the record first, with the answer event's identity (`eventId`, `eventAt`) minted at submit time, and returns. The existing app-level `PendingAnswerReplayRunner` lands it later through `upsertItemAnswer` with that same identity, so a repeated landing is a no-op for the fold. The replay cadence follows the existing admin-editable sync interval. PR 2 removes duplicated and fan-out reads.

**Tech Stack:** React 19 + TypeScript (strict, `erasableSyntaxOnly`), Vitest 5 (node default env), `createMemoryDirectory()` for the share, `fake-indexeddb` (dev dependency, v6.2.5) for the outbox.

**Spec:** `docs/superpowers/specs/2026-10-13-answers-outbox-and-load-design.md` (study: `2026-10-13-local-first-answer-outbox-study.md`). Baseline: `origin/main` @ `3dfe205b`, v153.25.0. Work happens in the worktree `.claude/worktrees/answers-outbox` on branch `claude/answers-outbox`.

## Deviations from the spec (decided while grounding the plan in the code)

1. **No `shadow` mode.** Mode is `outbox` (default) or `sync` (rollback switch, `localStorage` key). Shadow gave no user benefit and doubled share writes.
2. **The queue is the existing item-keyed mirror, not a new `outbox` store.** One record per (month, user, image) holds the latest `ItemAnswer`; a re-submit of the same image replaces the earlier unsent one, which is correct because `item-saved` carries the whole item. No second IndexedDB store, so no duplicate state and no DB version bump. Identity fields are added to the same record (additive, optional).
3. **Audit stays fire-and-forget at submit** (it is not awaited today); audit batching remains in phase 2 of the spec (PR 4, not in this plan).
4. **Batching of several items into one append is PR 4.** PR 1 lands items one `upsertItemAnswer` at a time, as today, but off the submit path.

## Global Constraints

- Arabic UI, RTL; every user-facing string is a key in `src/data/labels/labelsStore.ts` `DEFAULT_LABELS` (never inline).
- Every browser-storage key is registered in `src/data/storage/storageRegistry.ts` (coverage test enforces it).
- No duplicate state: one module owns each concept (`answerOutbox.ts` owns submit mode and flush requests).
- Workspace files are untouched: events and segments stay byte-identical (no migration; tier 3 only because of behaviour blast radius).
- Never hard-delete; `createWritable` guarded; paths via `workspacePaths.ts`.
- CRLF files: edit with the Edit tool (preserves line endings); do not rewrite whole files with a different EOL.
- Run, per task: `npx vitest run <file>`; before each commit `npm run lint`, `npm run typecheck`. Before pushing: `npm run build`.
- Edit log: one entry per PR via `npm run editlog -- --tier=3 --append --sync-package "…"`; versions 153.26.0 (PR 1), 153.27.0 (PR 2).
- Known pre-existing failure on main: `check:complexity` (`deck3/slides.ts buildDeck3Slides` 69 > 60) — not ours; do not "fix" it here. `XrayReferrals.tsx` is near its function-length budgets: extract helpers instead of growing `loadData` / `handleSave`.

## Review Focus

1. Browser storage unavailable (private window, IndexedDB disabled): submit must fall back to the synchronous share write, never report a false "saved on this device".
2. Two tabs open on the same workspace: only one lands each pending item; a double landing must fold once.
3. Employee resubmits the same case before the first landing: the later `lastSavedAt` wins; the earlier unsent record is replaced, not duplicated.
4. Page reload with items still unsent: the queue shows them as submitted, the banner counts them, nothing is lost.
5. Clear-site-data action while items are unsent: refused with an Arabic explanation.

(Each line has an owning test: Task 3 (1), Task 2 + Task 4 (2), Task 1 (3), Task 6 (4), Task 7 (5).)

## File Structure

| File | Responsibility |
|---|---|
| `src/data/answers/answerLocalMirror.ts` (modify) | Record gains optional `identity`; `queueAnswerForLanding`, `loadPendingAnswerItems`, `countUnsentAnswers`; `loadPendingAnswerRecords` returns identity |
| `src/data/answers/answerStorage.ts` (modify) | `mintAnswerEventIdentity`; `upsertItemAnswer(..., identity?)` / `performAnswerWrite` use it |
| `src/data/answers/answerOutbox.ts` (create) | Submit mode, `submitAnswerLocalFirst`, debounced coalescing `requestAnswerFlush` |
| `src/data/answers/overlayPendingAnswers.ts` (create) | Pure merge of unsent items over disk items |
| `src/data/answers/usePendingAnswerCount.ts` (create) | Hook behind the banner and the unload guard |
| `src/data/answers/pendingAnswerReplay.ts` (modify) | Items with identity skip the strict on-disk pre-read |
| `src/data/answers/PendingAnswerReplayRunner.tsx` (modify) | Cadence = sync interval; also on `online`/visible; unload guard |
| `src/data/answers/answerTimings.ts` (create) | In-memory timing ring + JSON export |
| `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx` (modify) | local-first branch in `handleSave`, overlay in `loadData`, banner |
| `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayInspectionResults.tsx` (modify) | use the shared hook instead of its own pending count |
| `src/components/Sidebar/Tabs/Settings/StorageSection.tsx` (modify) | refuse clear while unsent; timing download |
| `src/data/storage/storageRegistry.ts` (modify) | register mode key; correct mirror loss text |
| `src/data/labels/labelsStore.ts` (modify) | new label keys |

---

# PR 1 — Outbox phase 1 + timings (v153.26.0)

### Task 0: Test dependency and shared IndexedDB test helper  *(haiku)*

**Files:**
- Modify: `package.json`, `package-lock.json`
- Create: `src/test-utils/freshIndexedDb.ts`

**Interfaces:**
- Produces: `installFreshIndexedDb(): void` — replaces `globalThis.indexedDB` with a new `IDBFactory` so each test starts with an empty database and the mirror module's cached connection (keyed on factory identity) resets.

- [ ] **Step 1:** `npm i -D fake-indexeddb@6.2.5` (run in the worktree). Confirm `package.json` devDependencies lists `fake-indexeddb` at 6.2.5.
- [ ] **Step 2:** Create the helper:

```ts
import { IDBFactory } from "fake-indexeddb";

/** Gives the test a brand-new, empty IndexedDB. The mirror module keys its cached
 *  connection on the factory object, so a new factory also forgets the old connection. */
export function installFreshIndexedDb(): void {
  (globalThis as { indexedDB?: IDBFactory }).indexedDB = new IDBFactory();
}
```

- [ ] **Step 3:** `npm run typecheck` → PASS. Commit: `git add package.json package-lock.json src/test-utils/freshIndexedDb.ts && git commit -m "chore(tests): add fake-indexeddb and a fresh-database test helper"`.

### Task 1: Mirror records carry event identity; durable queue API  *(sonnet)*

**Files:**
- Modify: `src/data/answers/answerLocalMirror.ts` (types ~57-73, `issueGuardedPut` ~343-366, `loadPendingAnswerRecords` ~470-477)
- Test: `src/data/answers/answerLocalMirror.outbox.test.ts` (create)

**Interfaces:**
- Produces:
  - `export type OutboxIdentity = { eventId: string; eventAt: string }`
  - `queueAnswerForLanding(month: string, username: string, item: ItemAnswer, identity: OutboxIdentity): Promise<boolean>` — `true` only when the IndexedDB transaction committed (strict durability); `false` when IndexedDB is unavailable or the transaction failed.
  - `loadPendingAnswerRecords(username): Promise<Array<{ month: string; item: ItemAnswer; identity?: OutboxIdentity }>>`
  - `loadPendingAnswerItems(month: string, username: string): Promise<ItemAnswer[]>`
  - `countUnsentAnswers(username?: string): Promise<number>` — all months/ad-hoc folders; all users when `username` is omitted.

- [ ] **Step 1: Write the failing test** (`answerLocalMirror.outbox.test.ts`)

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { installFreshIndexedDb } from "../../test-utils/freshIndexedDb";
import {
  countUnsentAnswers,
  loadPendingAnswerItems,
  loadPendingAnswerRecords,
  queueAnswerForLanding,
} from "./answerLocalMirror";
import type { ItemAnswer } from "./answerTypes";

const item = (id: string, savedAt: string): ItemAnswer => ({
  xrayImageId: id, templateId: "t", templateVersion: 1, answers: [],
  lastSavedAt: savedAt, submittedAt: savedAt, answeredBy: "u1", status: "submitted",
});

describe("queueAnswerForLanding", () => {
  beforeEach(() => installFreshIndexedDb());

  it("stores the item as unsent together with its event identity", async () => {
    const identity = { eventId: "e1", eventAt: "2026-10-13T10:00:00.000Z" };
    expect(await queueAnswerForLanding("10-October-2026", "u1", item("A", "2026-10-13T10:00:00.000Z"), identity)).toBe(true);
    const pending = await loadPendingAnswerRecords("u1");
    expect(pending).toHaveLength(1);
    expect(pending[0].identity).toEqual(identity);
    expect(await countUnsentAnswers("u1")).toBe(1);
    expect(await countUnsentAnswers()).toBe(1);
    expect(await countUnsentAnswers("someone-else")).toBe(0);
  });

  it("a later submit of the same image replaces the earlier unsent one", async () => {
    await queueAnswerForLanding("m", "u1", item("A", "2026-10-13T10:00:00.000Z"), { eventId: "e1", eventAt: "2026-10-13T10:00:00.000Z" });
    await queueAnswerForLanding("m", "u1", item("A", "2026-10-13T10:05:00.000Z"), { eventId: "e2", eventAt: "2026-10-13T10:05:00.000Z" });
    const pending = await loadPendingAnswerRecords("u1");
    expect(pending).toHaveLength(1);
    expect(pending[0].identity?.eventId).toBe("e2");
  });

  it("an older submit never replaces a newer unsent one", async () => {
    await queueAnswerForLanding("m", "u1", item("A", "2026-10-13T10:05:00.000Z"), { eventId: "e2", eventAt: "2026-10-13T10:05:00.000Z" });
    await queueAnswerForLanding("m", "u1", item("A", "2026-10-13T10:00:00.000Z"), { eventId: "e1", eventAt: "2026-10-13T10:00:00.000Z" });
    expect((await loadPendingAnswerRecords("u1"))[0].identity?.eventId).toBe("e2");
  });

  it("loadPendingAnswerItems returns only this month's unsent items", async () => {
    await queueAnswerForLanding("m1", "u1", item("A", "2026-10-13T10:00:00.000Z"), { eventId: "e1", eventAt: "2026-10-13T10:00:00.000Z" });
    await queueAnswerForLanding("m2", "u1", item("B", "2026-10-13T10:00:00.000Z"), { eventId: "e2", eventAt: "2026-10-13T10:00:00.000Z" });
    expect((await loadPendingAnswerItems("m1", "u1")).map((i) => i.xrayImageId)).toEqual(["A"]);
  });

  it("returns false (not a fake success) when IndexedDB is unavailable", async () => {
    (globalThis as { indexedDB?: unknown }).indexedDB = undefined;
    expect(await queueAnswerForLanding("m", "u1", item("A", "2026-10-13T10:00:00.000Z"), { eventId: "e1", eventAt: "2026-10-13T10:00:00.000Z" })).toBe(false);
  });
});
```

- [ ] **Step 2:** `npx vitest run src/data/answers/answerLocalMirror.outbox.test.ts` → FAIL (exports missing).
- [ ] **Step 3: Implement** in `answerLocalMirror.ts`:
  1. Add `export type OutboxIdentity = { eventId: string; eventAt: string };` and `identity?: OutboxIdentity;` to `MirrorRecord`.
  2. Add a trailing optional parameter `identity?: OutboxIdentity` to `issueGuardedPut` and include `...(identity ? { identity } : {})` in the put payload (confirm/backfill puts pass none, so confirmed records drop identity — intended).
  3. Add:

```ts
export async function queueAnswerForLanding(
  month: string,
  username: string,
  item: ItemAnswer,
  identity: OutboxIdentity
): Promise<boolean> {
  return withMirrorDb(
    (db) =>
      new Promise<boolean>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite", { durability: "strict" });
        issueGuardedPut(tx.objectStore(STORE_NAME), month, username, item, shouldQueueMirrorRecord, false, identity);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
    false
  );
}

export async function loadPendingAnswerItems(month: string, username: string): Promise<ItemAnswer[]> {
  const all = await readAllRecords();
  return all
    .filter((r) => r.month === month && r.username === username && !r.synced)
    .map((r) => r.item);
}

export async function countUnsentAnswers(username?: string): Promise<number> {
  const all = await readAllRecords();
  return all.filter((r) => !r.synced && (username === undefined || r.username === username)).length;
}
```

  4. Change `loadPendingAnswerRecords` to map `{ month: record.month, item: record.item, ...(record.identity ? { identity: record.identity } : {}) }` and its return type accordingly.
- [ ] **Step 4:** `npx vitest run src/data/answers/answerLocalMirror` (all mirror test files) → PASS. If an existing test asserts the old `loadPendingAnswerRecords` shape with `toEqual`, update it to include/ignore `identity`.
- [ ] **Step 5:** `npm run lint && npm run typecheck`; commit `feat(answers): queue unsent answers with their event identity`.

### Task 2: Land a queued answer with its original identity  *(sonnet)*

**Files:**
- Modify: `src/data/answers/answerStorage.ts` (`performAnswerWrite` signature ~1108-1119; `upsertItemAnswer` ~1413-1446; add export near `nextAnswerEventAt` ~168)
- Test: `src/data/answers/answerStorage.identity.test.ts` (create; copy the directory/month setup used at the top of `answerStorage.localMirror.test.ts`)

**Interfaces:**
- Consumes: `OutboxIdentity` (Task 1).
- Produces: `mintAnswerEventIdentity(): OutboxIdentity`; `upsertItemAnswer(directoryHandle, monthFolderName, username, item, identity?: OutboxIdentity)`.

- [ ] **Step 1: Read first** `resolveSeed` (`answerStorage.ts:923-975`): confirm the seed event's id/time derive from the `eventId`/`eventAt` passed in. If the seed's id is derived from `eventId`, landing the same identity twice must not mint two different seed events; if it can, make the seed id deterministic from `(month, username, legacy hash)` and say so in the commit. Record the finding in the test's header comment.
- [ ] **Step 2: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { mintAnswerEventIdentity, readAllAnswerEventsForMonth, loadEmployeeAnswers, upsertItemAnswer } from "./answerStorage";
// + the same createMemoryDirectory / month-folder setup as answerStorage.localMirror.test.ts

describe("upsertItemAnswer with a fixed identity", () => {
  it("landing the same identity twice folds to one item and one event", async () => {
    const { dir, month } = await setupWorkspaceWithMonth(); // helper copied from the sibling test
    const identity = mintAnswerEventIdentity();
    const item = makeSubmittedItem("IMG-1", "u1", identity.eventAt);
    expect((await upsertItemAnswer(dir, month, "u1", item, identity)).ok).toBe(true);
    expect((await upsertItemAnswer(dir, month, "u1", item, identity)).ok).toBe(true);
    const events = await readAllAnswerEventsForMonth(dir, month);
    expect(events.filter((e) => e.eventId === identity.eventId)).toHaveLength(1);
    const file = await loadEmployeeAnswers(dir, month, "u1");
    expect(file.items.filter((i) => i.xrayImageId === "IMG-1")).toHaveLength(1);
  });

  it("uses the supplied eventAt, not the landing time", async () => {
    const { dir, month } = await setupWorkspaceWithMonth();
    const identity = { eventId: "fixed-id", eventAt: "2026-10-13T08:00:00.000Z" };
    await upsertItemAnswer(dir, month, "u1", makeSubmittedItem("IMG-2", "u1", identity.eventAt), identity);
    const ev = (await readAllAnswerEventsForMonth(dir, month)).find((e) => e.eventId === "fixed-id");
    expect(ev?.eventAt).toBe("2026-10-13T08:00:00.000Z");
  });
});
```

(`setupWorkspaceWithMonth` / `makeSubmittedItem`: define in the test file by copying the equivalents from the sibling test; do not import across test files.)

- [ ] **Step 3:** run → FAIL.
- [ ] **Step 4: Implement.** Near `nextAnswerEventAt`:

```ts
import type { OutboxIdentity } from "./answerLocalMirror"; // type-only, with the existing mirror imports

/** The identity an answer event will carry, fixed at SUBMIT time so a later (possibly repeated) landing is idempotent. */
export function mintAnswerEventIdentity(): OutboxIdentity {
  return { eventId: crypto.randomUUID(), eventAt: nextAnswerEventAt() };
}
```

  In `performAnswerWrite` change `options` to `{ blindAppendWhenSeeded?: boolean; identity?: OutboxIdentity }` and replace
  `const eventId = crypto.randomUUID(); const eventAt = nextAnswerEventAt();`
  with
  `const eventId = options.identity?.eventId ?? crypto.randomUUID(); const eventAt = options.identity?.eventAt ?? nextAnswerEventAt();`.
  In `upsertItemAnswer` add the 5th parameter `identity?: OutboxIdentity` and pass `{ blindAppendWhenSeeded: true, identity }`.
- [ ] **Step 5:** `npx vitest run src/data/answers` → PASS (whole answers folder). Commit `feat(answers): upsertItemAnswer accepts a pre-minted event identity`.

### Task 3: Outbox module — mode, local-first submit, coalesced flush  *(sonnet)*

**Files:**
- Create: `src/data/answers/answerOutbox.ts`
- Modify: `src/data/storage/storageRegistry.ts` (register the mode key; correct the mirror entry text)
- Modify: `src/data/labels/labelsStore.ts` (labels below)
- Test: `src/data/answers/answerOutbox.test.ts` (first line `/* @vitest-environment jsdom */`)

**Interfaces:**
- Consumes: `queueAnswerForLanding`, `mintAnswerEventIdentity` (Tasks 1–2), `replayPendingAnswers` (existing), `requestStoragePersistence` from `storageRegistry.ts`.
- Produces:
  - `type AnswerSubmitMode = "outbox" | "sync"`; `ANSWER_SUBMIT_MODE_KEY = "xray_answer_submit_mode_v1"`; `getAnswerSubmitMode(): AnswerSubmitMode` (default `"outbox"`; any storage error → `"outbox"`); `setAnswerSubmitMode(mode)`.
  - `type LocalFirstOutcome = { stored: boolean }`; `submitAnswerLocalFirst(month, username, item): Promise<LocalFirstOutcome>`.
  - `requestAnswerFlush(directoryHandle, username, opts?: { immediate?: boolean; replay?: typeof replayPendingAnswers; debounceMs?: number }): void` — coalesces: while a flush runs, further requests set a flag so exactly one more pass runs afterwards; non-immediate requests wait `FLUSH_DEBOUNCE_MS = 5000`.
  - `__resetAnswerOutboxForTests(): void`.
- Labels (add to `DEFAULT_LABELS`): `ew_answer_saved_locally: "تم الحفظ على هذا الجهاز، وسيُرسل إلى مجلد العمل تلقائيًا."`, `ew_answers_send_now: "إرسال الآن"`, `settings_storage_clear_blocked_unsent: "لديك إجابات لم تُرسل بعد إلى مجلد العمل. أرسلها أولًا ثم أعد المحاولة."`, `settings_timings_download: "تنزيل سجل التوقيت"`; change `ew_answers_pending_sync` to `"{count} إجابة محفوظة على هذا الجهاز ولم تصل إلى مجلد العمل المشترك بعد — تُرسل تلقائيًا."` (removes the fixed "30 ثانية").

- [ ] **Step 1: Failing tests**

```ts
/* @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installFreshIndexedDb } from "../../test-utils/freshIndexedDb";
import { countUnsentAnswers } from "./answerLocalMirror";
import {
  __resetAnswerOutboxForTests, getAnswerSubmitMode, requestAnswerFlush, setAnswerSubmitMode, submitAnswerLocalFirst,
} from "./answerOutbox";

const item = { xrayImageId: "A", templateId: "t", templateVersion: 1, answers: [], lastSavedAt: "2026-10-13T10:00:00.000Z",
  submittedAt: "2026-10-13T10:00:00.000Z", answeredBy: "u1", status: "submitted" as const };

describe("answerOutbox", () => {
  beforeEach(() => { installFreshIndexedDb(); __resetAnswerOutboxForTests(); localStorage.clear(); });

  it("submit stores locally and reports stored:true without touching any directory", async () => {
    expect(await submitAnswerLocalFirst("m", "u1", item)).toEqual({ stored: true });
    expect(await countUnsentAnswers("u1")).toBe(1);
  });

  it("reports stored:false when IndexedDB is unavailable so the caller can fall back", async () => {
    (globalThis as { indexedDB?: unknown }).indexedDB = undefined;
    expect(await submitAnswerLocalFirst("m", "u1", item)).toEqual({ stored: false });
  });

  it("mode defaults to outbox and can be switched back to sync", () => {
    expect(getAnswerSubmitMode()).toBe("outbox");
    setAnswerSubmitMode("sync");
    expect(getAnswerSubmitMode()).toBe("sync");
  });

  it("coalesces requests made while a flush runs into exactly one follow-up pass", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const replay = vi.fn(async () => { await gate; return { replayed: 0, alreadyOnDisk: 0, failed: 0, cannotLand: 0 }; });
    const dir = {} as never;
    requestAnswerFlush(dir, "u1", { immediate: true, replay });
    requestAnswerFlush(dir, "u1", { immediate: true, replay });
    requestAnswerFlush(dir, "u1", { immediate: true, replay });
    release();
    await vi.waitFor(() => expect(replay).toHaveBeenCalledTimes(2));
  });

  it("a failing flush never throws to the caller and the next request still runs", async () => {
    const replay = vi.fn().mockRejectedValueOnce(new Error("share down")).mockResolvedValue({ replayed: 1, alreadyOnDisk: 0, failed: 0, cannotLand: 0 });
    requestAnswerFlush({} as never, "u1", { immediate: true, replay });
    await vi.waitFor(() => expect(replay).toHaveBeenCalledTimes(1));
    requestAnswerFlush({} as never, "u1", { immediate: true, replay });
    await vi.waitFor(() => expect(replay).toHaveBeenCalledTimes(2));
  });
});
```

- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement** `answerOutbox.ts`:

```ts
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { logError } from "../storage/errorLogger";
import { requestStoragePersistence } from "../storage/storageRegistry";
import { queueAnswerForLanding } from "./answerLocalMirror";
import { mintAnswerEventIdentity } from "./answerStorage";
import { replayPendingAnswers } from "./pendingAnswerReplay";
import type { ItemAnswer } from "./answerTypes";

export type AnswerSubmitMode = "outbox" | "sync";
export const ANSWER_SUBMIT_MODE_KEY = "xray_answer_submit_mode_v1";
export const FLUSH_DEBOUNCE_MS = 5_000;

export function getAnswerSubmitMode(): AnswerSubmitMode {
  try {
    return localStorage.getItem(ANSWER_SUBMIT_MODE_KEY) === "sync" ? "sync" : "outbox";
  } catch {
    return "outbox";
  }
}

export function setAnswerSubmitMode(mode: AnswerSubmitMode): void {
  try {
    localStorage.setItem(ANSWER_SUBMIT_MODE_KEY, mode);
  } catch {
    // storage unavailable: the default (outbox) stays in force
  }
}

export type LocalFirstOutcome = { stored: boolean };

/** Durable in this browser, nothing awaited on the share. `stored:false` ⇒ caller must use the synchronous write. */
export async function submitAnswerLocalFirst(month: string, username: string, item: ItemAnswer): Promise<LocalFirstOutcome> {
  const stored = await queueAnswerForLanding(month, username, item, mintAnswerEventIdentity());
  if (stored) void requestStoragePersistence();
  return { stored };
}

type FlushOptions = { immediate?: boolean; replay?: typeof replayPendingAnswers; debounceMs?: number };

let running = false;
let again = false;
let timer: ReturnType<typeof setTimeout> | null = null;

export function requestAnswerFlush(directoryHandle: DirectoryHandleLike, username: string, opts: FlushOptions = {}): void {
  const replay = opts.replay ?? replayPendingAnswers;
  const run = (): void => {
    timer = null;
    if (running) { again = true; return; }
    running = true;
    void (async () => {
      try {
        do {
          again = false;
          try {
            await replay(directoryHandle, username);
          } catch (error) {
            logError("answers:outbox-flush", error);
          }
        } while (again);
      } finally {
        running = false;
      }
    })();
  };
  if (opts.immediate) { if (timer) clearTimeout(timer); run(); return; }
  if (timer) clearTimeout(timer);
  timer = setTimeout(run, opts.debounceMs ?? FLUSH_DEBOUNCE_MS);
}

export function __resetAnswerOutboxForTests(): void {
  running = false;
  again = false;
  if (timer) clearTimeout(timer);
  timer = null;
}
```

  Registry: add `{ id: "xray_answer_submit_mode_v1", layer: "local", purpose: "Rollback switch for answer submission: unset/outbox = save on this device first, sync = write to the shared folder before confirming.", lossConsequence: "Submission returns to the default (save on this device first). No data at risk." }`, and replace the mirror entry's `purpose`/`lossConsequence` text with: purpose "Per-browser queue and backup of an employee's answers (answerLocalMirror.ts). Answers submitted here are held until they reach the workspace folder.", lossConsequence "Answers marked unsent are LOST if this is cleared before they reach the workspace folder; sent answers are unaffected (the workspace file is authoritative)."
- [ ] **Step 4:** `npx vitest run src/data/answers/answerOutbox.test.ts src/data/storage/storageRegistry` → PASS (registry coverage test included).
- [ ] **Step 5:** lint, typecheck; commit `feat(answers): local-first submit outbox module`.

### Task 4: Replay lands identity-bearing items without the strict pre-read; follows the sync interval  *(sonnet)*

**Files:**
- Modify: `src/data/answers/pendingAnswerReplay.ts` (`PendingReplayDeps.loadPending` type; `runReplayPendingAnswers` ~238-337)
- Modify: `src/data/answers/PendingAnswerReplayRunner.tsx`
- Test: `src/data/answers/pendingAnswerReplay.test.ts` (extend), `src/data/answers/PendingAnswerReplayRunner.test.tsx` (extend if present, else create with jsdom)

**Interfaces:**
- Consumes: `loadPendingAnswerRecords` identity (Task 1), `upsertItemAnswer(..., identity)` (Task 2), `getSyncIntervalMs`, `subscribeToSyncInterval` from `src/data/workspace/workspaceSync.ts` (lines 276, 281), `useUnloadGuard` from `src/hooks/useUnloadGuard`.
- Produces: no new exports; `PENDING_REPLAY_INTERVAL_MS` is removed (the runner reads `getSyncIntervalMs()`).

- [ ] **Step 1: Failing tests** in `pendingAnswerReplay.test.ts`:
  - "an item with an identity is landed without calling `loadAllEmployeeFiles`": spy via the existing test harness (mock `loadAllEmployeeFiles` in `./answerStorage`), assert it is not called and `upsertItemAnswer` receives the identity as 5th argument.
  - "an item without identity still takes the strict pre-read path" (regression).
  - "landing the same identity-bearing item twice (two tabs) leaves one folded item" — integration with `createMemoryDirectory`, calling `replayPendingAnswers` twice with a `deps.loadPending` stub returning the same record.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement** in `runReplayPendingAnswers`: `loadPending` now yields `{ month, item, identity? }`; carry `identity` alongside `item` in `byMonth` (change the map value type to `Array<{ item: ItemAnswer; identity?: OutboxIdentity }>`; the `seenOnDisk*` helpers keep keying on `item`). For identity-bearing entries: still require `sampleMainDirExists`, then call `upsertItemAnswer(directoryHandle, month, username, item, identity)` directly — skip `loadOnDiskItemsStrict` and the `current`/`compareSavedAt` shortcut. Legacy entries (no identity) run the existing code unchanged. Extract the per-item landing try/catch into a small function `landOne(...)` to keep `runReplayPendingAnswers` under the complexity budget.
- [ ] **Step 4: Runner.** Replace `PENDING_REPLAY_INTERVAL_MS` with `getSyncIntervalMs()` read at effect start; subscribe with `subscribeToSyncInterval` to restart the interval on change; add `window.addEventListener("online", tick)` and a `visibilitychange` listener that ticks when `document.visibilityState === "visible"`; remove all listeners in cleanup. Keep the `document.hidden` early return inside `tick` for the interval path only (the `online` and `visible` events bypass it). Update the file's docblock (30 s → sync interval). Update any existing test that imports `PENDING_REPLAY_INTERVAL_MS`.
- [ ] **Step 5:** `npx vitest run src/data/answers` → PASS. Lint/typecheck. Commit `feat(answers): replay lands queued answers by identity on the sync interval`.

### Task 5: Submit path uses local-first  *(sonnet)*

**Files:**
- Modify: `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx` (`createSaveAnswerHandler` ~395-531)
- Test: `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.saveAnswer.test.tsx` (create, jsdom) — test `createSaveAnswerHandler` directly: export it (`export function createSaveAnswerHandler`) with an `@internal` comment.

**Interfaces:**
- Consumes: `getAnswerSubmitMode`, `submitAnswerLocalFirst`, `requestAnswerFlush` (Task 3); label `ew_answer_saved_locally`.

- [ ] **Step 1: Failing tests**: (a) mode `outbox`, self-save: `upsertItemAnswer` is NOT called, `{ ok: true }` returned, `setAnswers` called with the item, status text equals `getLabels().ew_answer_saved_locally`, `requestAnswerFlush` called once; (b) `submitAnswerLocalFirst` returns `{ stored: false }` → falls back to `upsertItemAnswer` (called once); (c) mode `sync` → old behaviour; (d) on-behalf (`forUser !== username`) → always `upsertItemAnswerOnBehalf`, never local-first. Mock the three data modules with `vi.mock`.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement** inside `handleSave`, replacing the single `const result = forUser === username ? … : …` with:

```ts
let savedLocallyOnly = false;
let result: { ok: true } | { ok: false; error: string };
if (forUser === username && getAnswerSubmitMode() === "outbox") {
  const outcome = await submitAnswerLocalFirst(folder, forUser, item);
  if (outcome.stored) {
    savedLocallyOnly = true;
    requestAnswerFlush(directoryHandle, username);
    result = { ok: true };
  } else {
    result = await upsertItemAnswer(directoryHandle, folder, forUser, item);
  }
} else {
  result = forUser === username
    ? await upsertItemAnswer(directoryHandle, folder, forUser, item)
    : await upsertItemAnswerOnBehalf(directoryHandle, folder, forUser, item, username);
}
```

  and change the success status line to `setStatusMsg({ type: "ok", text: savedLocallyOnly ? getLabels().ew_answer_saved_locally : "تم التقديم." })`. Everything else in the ok branch is unchanged.
- [ ] **Step 4:** run → PASS; `npm run lint` (watch `max-lines-per-function`; extract the branch into a module-level `submitAnswer(...)` helper if the rule fires). Commit `feat(answers): submit saves on this device first`.

### Task 6: Pending overlay, banner, unload guard  *(sonnet)*

**Files:**
- Create: `src/data/answers/overlayPendingAnswers.ts`, `src/data/answers/usePendingAnswerCount.ts`
- Modify: `XrayReferrals.tsx` (`loadData` personal scope ~1296-1340; render a banner), `XrayInspectionResults.tsx` (~308-330, ~869: replace its own count state with the hook), `PendingAnswerReplayRunner.tsx` (unload guard)
- Test: `overlayPendingAnswers.test.ts`, `usePendingAnswerCount.test.tsx` (jsdom)

**Interfaces:**
- Produces:
  - `overlayPendingAnswers(disk: readonly ItemAnswer[], pending: readonly ItemAnswer[]): ItemAnswer[]`
  - `usePendingAnswerCount(opts: { username: string; month?: string }): number` — refreshes on mount, on `subscribeToDataRefresh`, and every 10 s.
- Consumes: `loadPendingAnswerItems`, `countPendingAnswers`, `countUnsentAnswers` (Task 1), `useUnloadGuard`, `requestAnswerFlush`.

- [ ] **Step 1: Failing tests** for `overlayPendingAnswers`: pending newer than disk wins; pending older than disk loses; pending for an image absent on disk is added; output has one entry per `xrayImageId`; inputs not mutated. Hook test: with one queued item the hook reports 1; after the record is confirmed (`mirrorAnswerLocally`) and a data-refresh notification the hook reports 0.
- [ ] **Step 2:** FAIL. **Step 3: Implement** the overlay:

```ts
import { compareSavedAt } from "./savedAt";
import type { ItemAnswer } from "./answerTypes";

export function overlayPendingAnswers(disk: readonly ItemAnswer[], pending: readonly ItemAnswer[]): ItemAnswer[] {
  const byId = new Map(disk.map((i) => [i.xrayImageId, i] as const));
  for (const p of pending) {
    const d = byId.get(p.xrayImageId);
    if (!d || compareSavedAt(p.lastSavedAt, d.lastSavedAt) > 0) byId.set(p.xrayImageId, p);
  }
  return [...byId.values()];
}
```

  Hook: `useState(0)`; `useEffect` calling `month === undefined ? countUnsentAnswers(username) : countPendingAnswers(month, username)` on mount, via `subscribeToDataRefresh(refresh)` (import from `src/data/workspace/dataRefreshSignal`; check the callback signature there) and a 10 s interval, with a `disposed` flag for cleanup.
- [ ] **Step 4: Wire.**
  - `loadData` personal scope: add `loadPendingAnswerItems(selMonth, username)` to the existing `Promise.all` (null for `canSeeAll`), then at the `commit(...)` call sites pass `overlayPendingAnswers(answerItems, pendingItems ?? [])` for personal scope. The pending read must not fail the load: `.catch(() => [])`.
  - Banner in `XrayReferrals` render near the top of the queue: `const unsent = usePendingAnswerCount({ username, month: selMonth });` and, when `unsent > 0`, `<div role="status" className="ew-pending-banner" dir="rtl">{L.ew_answers_pending_sync.replace("{count}", String(unsent))} <button type="button" onClick={() => requestAnswerFlush(directoryHandle, username, { immediate: true })}>{L.ew_answers_send_now}</button></div>` (reuse the banner CSS class `XrayInspectionResults` already uses at ~869 — grep it; do not add a second style).
  - `XrayInspectionResults`: delete its local `pendingSyncCount` state/effect and use the hook; keep its rendering.
  - Runner: `const unsent = usePendingAnswerCount({ username }); useUnloadGuard(unsent > 0);`.
- [ ] **Step 5:** `npx vitest run src/data/answers src/components/Sidebar/Tabs/EmployeeWorkspace`, lint, typecheck. Commit `feat(answers): show and protect unsent answers`.

### Task 7: Block clearing storage while answers are unsent  *(haiku)*

**Files:**
- Modify: `src/components/Sidebar/Tabs/Settings/StorageSection.tsx` (handler around line 106), label key from Task 3
- Test: `StorageSection.test.tsx` (extend or create, jsdom)

- [ ] **Step 1: Failing test:** with one queued unsent answer, clicking the clear button does not call `clearOwnedStorage` and shows `getLabels().settings_storage_clear_blocked_unsent`; with none queued, it calls it (existing behaviour).
- [ ] **Step 2:** FAIL. **Step 3:** in the clear handler, before `await clearOwnedStorage();` add `if ((await countUnsentAnswers()) > 0) { setMessage(getLabels().settings_storage_clear_blocked_unsent); return; }` using the component's existing message/state setter (read the surrounding code at lines ~95-115 and reuse its error display).
- [ ] **Step 4:** PASS; commit `fix(settings): refuse clearing browser storage while answers are unsent`.

### Task 8: Timing telemetry + download  *(sonnet)*

**Files:**
- Create: `src/data/answers/answerTimings.ts`
- Modify: `answerStorage.ts` (wrap steps in `performAnswerWrite`'s `attempt`: `getSampleMainDir`, `decideFromSeededCache`, `readAllAnswerEventsForMonth`, `appendAnswerEventSegment`), `pendingAnswerReplay.ts` (per-month pass and per-item landing), `XrayReferrals.tsx` `loadData` (phase 2, phase 3, answers read), `StorageSection.tsx` (download button)
- Test: `answerTimings.test.ts`

**Interfaces:**
- Produces: `type AnswerTiming = { name: string; ms: number; at: string; detail?: Record<string, string | number> }`; `timeAnswerStep<T>(name: string, work: () => Promise<T>, detail?: AnswerTiming["detail"]): Promise<T>` (records even when `work` throws, then rethrows); `getAnswerTimings(): readonly AnswerTiming[]`; `answerTimingsToJson(): string`; `__resetAnswerTimingsForTests()`. Ring size `ANSWER_TIMING_RING_MAX = 300`. In memory only — no share writes.

- [ ] **Step 1: Failing tests:** records name, ms ≥ 0 and ISO `at`; the ring keeps only the newest 300; a throwing `work` is recorded and rethrown; `answerTimingsToJson` parses back to the same array.
- [ ] **Step 2:** FAIL. **Step 3:** implement (≈30 lines, array + `shift()` over cap, `performance.now()` for ms). Step names fixed (used by the owner's measurement protocol): `load.listAnswers`, `load.openSegments`, `load.fold`, `load.phase2`, `load.phase3`, `load.answers`, `submit.localWrite`, `submit.decide`, `submit.append`, `flush.month`, `flush.item`. Add `detail` counts (`segments`, `items`) where the data is at hand. The Settings button «تنزيل سجل التوقيت» (`settings_timings_download`) downloads `answerTimingsToJson()` as `answer-timings-{ISO date}.json` using the same download helper other Settings buttons use (grep `download` in `Settings/`).
- [ ] **Step 4:** PASS; lint/typecheck; commit `feat(answers): in-memory step timings with a downloadable report`.

### Task 9: PR 1 gates, edit log, build, manual check  *(primary model)*

- [ ] **Step 1:** `npm run lint`, `npm run typecheck`, `npm run test:run` — all green.
- [ ] **Step 2:** `npm run editlog -- --tier=3 --append --sync-package "Add (answers): local-first submit outbox, sync-interval replay, timings (v153.26)"`, write the `Why:` / `What changed:` / before-after prose and the migration/rollback note (rollback = set `xray_answer_submit_mode_v1` to `sync`; no workspace data changed).
- [ ] **Step 3:** tier-3 sweep: `npm run check:complexity` (expected: only the known deck3 failure), `check:hex-literals`, `check:release`, `check:vendor`, `build`, `check:bundle-size`.
- [ ] **Step 4: Manual check** in `npm run dev` (Chrome): open a workspace folder, submit a case, observe «تم الحفظ على هذا الجهاز…» in under a second and the next case opens; in DevTools → Application → IndexedDB `xray_answers_local_mirror_v1` the record is `synced:false` then `synced:true` after the flush; reload mid-queue and confirm the queue still shows the case as submitted and the banner count; set the mode key to `sync` and confirm the old behaviour; use a second tab to confirm two tabs land one event.
- [ ] **Step 5:** push branch, open PR "Add (answers): local-first submit outbox (v153.26)"; bind with the PR tools; no attribution lines.

---

# PR 2 — Calm reads (v153.27.0)

Starts after PR 1 merges; the first step uses the timings collected on the slow PC to confirm the ranking below before changing code.

### Task 10: Confirm the cause with measured timings  *(primary model + owner)*

- [ ] Owner exports the timing JSON and counts files on the slow PC (`answers.events`, `distribution.events`, per the study §F). Compare `load.listAnswers` / `load.openSegments` / `load.fold` and `submit.decide` against the study's ranking (R1 file count, R2 duplicate concurrent reads, R3 sync-tick reload storms). If R1 dominates, note that only Plan 2 PR 3 (compaction) removes it and that Tasks 11–14 still cap the damage.

### Task 11: Single-flight the month answers read  *(sonnet)*

**Files:** Modify `answerStorage.ts` (`readAllAnswerEventsForMonth` ~492); test `answerStorage.singleflight.test.ts`.
- [ ] Failing test: five concurrent `readAllAnswerEventsForMonth(dir, month)` calls produce one directory listing of `answers.events` (count via a `createMemoryDirectory` wrapper that counts `entries()` calls) and identical results. Implement by wrapping the body in `dedupeInFlight(\`answers-month:${workspaceScopeId(directoryHandle)}:${monthFolderName}\`, …)` from `../storage/inFlightReads` (same pattern as `pendingAnswerReplay.ts:167`). The key must also change when the workspace epoch bumps — read `inFlightReads.ts` and use its epoch-aware variant if one exists, otherwise include the current epoch number in the key. Commit `perf(answers): join concurrent month reads`.

### Task 12: One read for the supervisor view  *(sonnet)*

**Files:** Modify `XrayReferrals.tsx` (oversight branch ~1413-1425); test in the Task 5 test file family.
- [ ] Failing test: for `canSeeAll` with N assignees, `loadAllEmployeeFiles` is called once and `loadEmployeeAnswers` zero times; resulting answer items equal the old per-assignee union. Implement: replace the `Promise.all(assignees.map(u => loadEmployeeAnswers(...)))` with one `loadAllEmployeeFiles(directoryHandle, selMonth)` and select the files whose `username` is in the assignee set; log a failure once for the single call. Commit `perf(answers): single answers read for oversight`.

### Task 13: Single-flight silent reloads  *(sonnet)*

**Files:** Create `src/utils/singleFlight.ts` + `singleFlight.test.ts`; modify `XrayReferrals.tsx` `loadData` trigger sites (~1470-1510).
- [ ] Failing test for `createSingleFlight(run)`: while one run is in progress, any number of `request()` calls produce exactly one more run after it; a rejecting run does not block later requests. Implement and route the silent-reload paths (refresh-signal subscription and effect-driven reloads, not the first explicit load) through it. Never drop a request that carries `manual`. Commit `perf(workspace): coalesce overlapping silent reloads`.

### Task 14: Throttle personal-scope answer reloads on unknown change  *(sonnet)*

**Files:** Modify `XrayReferrals.tsx` refresh subscription (~1489-1501) and `src/data/workspace/workspaceSync.ts` (`answersMayConcern`, ~1034); tests alongside each.
- [ ] Failing test (fake timers): for a non-oversight user, a periodic refresh whose answer change set is "unknown" (more than 64 chain heads) triggers at most one answers reload per `4 × getSyncIntervalMs()`; a signal naming the user's own answers, and any `manual` signal, still reload immediately. Implement the gap in the subscription handler using `Date.now()` and the existing interval getter. Commit `perf(workspace): stop reload storms on unknown answer changes`.

### Task 15: PR 2 gates  *(primary model)*
- [ ] `lint`, `typecheck`, `test:run`, `build` (tier 2). Edit-log entry: `Change (answers): fewer repeated answer reads` with version 153.27.0. Push and open the PR.

---

## Self-review (spec coverage)

- Spec §4 commit point / syncer / failure handling / visibility / storage safety → Tasks 1–7 (cadence on the sync interval). Export/import of the unsent backlog is **not** in this plan — it is PR 4 per the spec's phasing; the clear-storage block and unload guard cover the main loss paths now.
- Spec §5 telemetry → Task 8. Spec §6 Plan 2 interaction → unchanged: appends use `appendAnswerEventSegment`, so layout v2 needs no outbox change.
- Spec §3 PR 2 list → Tasks 11–14 (the replay runner's strict all-employee read is removed for identity items in Task 4; bounded fan-out is subsumed by Task 12).
- Spec open questions: on-behalf stays synchronous (Task 5 test d); hidden-tab flushing follows the existing `document.hidden` early return for the interval path only; audit batching deferred to PR 4.
- Names are consistent across tasks: `OutboxIdentity`, `queueAnswerForLanding`, `mintAnswerEventIdentity`, `submitAnswerLocalFirst`, `requestAnswerFlush`, `overlayPendingAnswers`, `usePendingAnswerCount`, `countUnsentAnswers`, `timeAnswerStep`.
