# Edit-log draft — feedback per-thread storage redesign

Source plan: `docs/superpowers/plans/2026-08-24-feedback-per-thread-redesign-plan.md`

This worktree is shared by several concurrent agent sessions, so this plan's entries are
drafted here instead of being inserted directly into `docs/edit logs/2026-08-24.md` or
`package.json`. Whoever consolidates the day's log should insert these, newest-first, as
consecutive `## vX.Y` headings (tier 3 throughout — a data-format/architecture change per
CLAUDE.md) and bump `package.json` to match the topmost one.

Category prefix for every entry below: the plan is tier 3. Titles already carry their
`Fix:`/`Add:`/`Change:`/`Refactor:`/`Docs:`/`Chore:` category tag.

---

## Task 1 — Refactor (workspace): resolve the feedback roots through workspacePaths and add 5-system/feedback/threads/

**Why:** Task 1 of the feedback per-thread storage redesign (`docs/superpowers/plans/2026-08-24-feedback-per-thread-redesign-plan.md`), which fixes concurrent-write failures (XQ-IO-032) on the shared `5-system/feedback/messages.json` by splitting it into one file per conversation. `feedbackStorage.ts` used to call `systemDir.getDirectoryHandle("feedback", { create })` directly, which skips both the workspace directory-handle cache and `registerDirectoryPath` — the exact "one lock for everything" defect `getAuditRoot`'s doc comment (`workspacePaths.ts`) already records having fixed for `audit/`. Adding a second, deeper folder (`threads/`) on top of an unregistered parent would multiply that, so the foundation is fixed first.

**What changed:** Added `FEEDBACK_SUBFOLDERS = { threads: "threads" }`, `getFeedbackDir`, `getFeedbackThreadsDir`, and `getLegacyFeedbackDir` to `workspacePaths.ts`, all resolved through the existing `getChildDir`/`getRoot` handle-cache machinery. `feedbackStorage.ts`'s two local helpers of the same name/shape were deleted and its two call sites now import the workspacePaths versions — no behavior change yet, only which module resolves the folder.

**File:** `src/data/workspace/workspacePaths.ts`

**File:** `src/data/workspace/workspacePaths.test.ts`

**File:** `src/data/feedback/feedbackStorage.ts`

**Lines:** 3 files, +143 / -21 (workspacePaths.ts/.test.ts also landed via a concurrent session's commit 279d1771, which happened to include this task's uncommitted content when it staged the same file for an unrelated change — see git history; content is correct either way)

---

## Task 2 — Add (feedback): per-thread types, short time-ordered thread ids, and the per-thread read primitives

**Why:** Task 2 of the redesign. Splitting `messages.json` into one file per conversation needs a durable id scheme first: a bare `crypto.randomUUID()` was rejected because (a) it is 36 characters, and stacked under `5-system/feedback/threads/` on a deep UNC path plus Chromium's `.crswap` sibling risks the >260-character `NotFoundError` `distributionEventStore.ts` already documents, and (b) it sorts randomly, which would break the sync-probe signature in Task 6 (it samples the *tail* of the name-sorted listing, so the sample must be the newest threads).

**What changed:** Added `FeedbackThread` (extends `FeedbackMessage` with optional `revision`/`_writeToken` so every existing consumer keeps reading it with no projection step), `FeedbackThreadSummary`, `FeedbackThreadsIndex`, and the file-naming constants `FEEDBACK_THREADS_INDEX_FILE`/`FEEDBACK_THREAD_FILE_SUFFIX`. Added `newFeedbackThreadId(now)`, minting `t{YYYYMMDDHHmmss}-{8 hex}` (short, lexicographically time-ordered; a migrated legacy UUID sorts before every minted id since `t` > every hex digit). Added `feedbackThreadFileName(id)`, which *validates* the id against `/^[A-Za-z0-9._-]{1,80}$/` and throws rather than sanitizing — two distinct ids must never collide onto one file. Added the read primitives `loadThread(dir, id)` (single thread, `null` if absent/unreadable) and `loadThreads(dir, ids)` (bounded-concurrency read of an explicit id list via the shared `readNamedJsonFiles` core, order preserved, unreadable entries skipped) plus a defensive `normalizeThread` so a hand-edited or partially-written file never crashes a render. Added `feedbackThreadPreview(text)` (first line, truncated to 120 chars) for the summary row. New test file `feedbackThreads.test.ts` covers the id format/ordering/validation in isolation; two new cases in `feedbackStorage.test.ts` exercise `loadThread`/`loadThreads` against `createThread` (added in Task 3).

**File:** `src/data/feedback/feedbackStorage.ts`

**File:** `src/data/feedback/feedbackThreads.test.ts (new)`

**File:** `src/data/feedback/feedbackStorage.test.ts`

**Lines:** 3 files, +222 / -1

---

## Task 3 — Change (feedback): submit a new message as its own thread file plus a CAS index append

**Why:** Task 3 — the actual contention fix for the create/submit path. The old `submitFeedback` rewrote the one shared `messages.json` every employee's suggestion/issue/inquiry contended on. Write order is thread-file-first, index-second — the reverse would let a summary point at a file that might not exist, whereas this order's worst case is a thread the index does not yet mention, which `listThreadSummaries` (Task 4) folds back in from a directory listing.

**What changed:** Added `loadThreadsIndex` (raw, non-reconciling read of `threads.index.json`), `updateThreadsIndex` (private CAS read-modify-write of the index, touched only on create/status-change, no delayed verify since the index is a rebuildable cache), `summarize`, and `createThread(dir, payload)`. `createThread` writes the new thread's file under its freshly-minted id with **no CAS at all** — the id has never existed before, so there is no contender for that file name, which is the whole point of the redesign — then appends its summary to the index. `submitFeedback` is now a one-line compatibility wrapper over `createThread`, keeping its exported signature so `workspaceSync.test.tsx` and `FeedbackWidget.unreadDot.test.tsx` need no change.

**File:** `src/data/feedback/feedbackStorage.ts`

**File:** `src/data/feedback/feedbackStorage.test.ts`

**Lines:** 2 files, +205 / -16

---

## Task 4 — Fix (feedback): reply to one thread file instead of the shared log, ending cross-user write contention

**Why:** Task 4 — the headline fix. Every reply used to rewrite the whole shared `messages.json`, so replies from different admins to different threads contended on the same file exactly as submits did.

**What changed:** Added `appendReply(dir, threadId, reply, resolve)`: a `casLoop` over the ONE target thread file, with a delayed `verify` (unlike the index write) because a lost reply is real user content, not a rebuildable cache — same reasoning as `reportDesignStorage.saveDesignFile`. Two admins replying to different threads now write disjoint file names and cannot contend at all; two replying to the same thread still contend, on a small single-conversation file, which is the genuine rare case CAS exists for. The index is touched ONLY when `resolve` actually flips `open` to `resolved` — a plain reply leaves `threads.index.json` untouched. An unknown thread id throws rather than silently no-opping (the old `mutateFeedback` version silently dropped a reply to a missing id). Added `listThreadSummaries(dir)`: reads the index, reconciles it against a names-only `listDirectoryEntries` of `threads/`, folds in and repairs any thread the index does not know about (self-healing for a lost index-CAS race or a migrated file), and returns newest-first by `createdAt`. `replyToFeedback` is now a one-line wrapper over `appendReply`.

**File:** `src/data/feedback/feedbackStorage.ts`

**File:** `src/data/feedback/feedbackStorage.test.ts`

**Lines:** 2 files, +284 / -8

---

## Task 5 — Change (feedback): lazily split the legacy shared messages.json into per-thread files, read-only fallback kept

**Why:** Task 5. The old shared log had to become read-only without ever moving or deleting it — CLAUDE.md's "no active schema migration, permanent fallback" rule applies verbatim — and existing feedback history had to keep showing up for every reader, including one whose grant is read-only.

**What changed:** Added `migrateLegacyMessages(dir)`: a one-time, lazy split of `messages.json` into per-thread files, triggered only from the read path (`listThreadSummaries`'s first statement calls a best-effort `ensureMigrated`), never from a mount hook or a timer. Idempotent by construction — each thread file is keyed by the legacy message's own `id`, so two clients racing the migration write byte-identical content to identical names; the index append is a `casLoop` so one wins and the other retries against fresh state. Guarded by `hasAnyThreadFile` (one names-only listing, no content read) so it never runs again once any thread file exists, and never resurrects legacy content over an already-migrated workspace. A write failure (read-only grant) is caught and logged, never thrown, so a guest with read-only access still sees history via the fallback. Rewrote `loadFeedback` to aggregate every thread via `listThreadSummaries` + `loadThreads`, falling back to the raw legacy log only when there are zero threads (not yet migrated, or migration failed). **Deleted** `mutateFeedback` entirely — nothing calls it any more. Updated `FeedbackFile`'s doc comment to state it is READ-ONLY as of v116.0. Rewrote `feedbackStorage.test.ts` wholesale into three `describe` blocks: `"feedbackStorage — per-thread storage"` (every Task 2-4 test plus the three original tests whose semantics are unchanged: submit+readback, reply+resolve, concurrent-submit-survives), `"feedbackStorage — legacy migration"` (new: split-on-read, never-touches-legacy-file, workspace-root legacy location, idempotency, concurrent-migration safety, read-only fallback, no-legacy-data), and `"feedbackStorage — loadFeedback aggregate"` (new: aggregate ordering, the submit→reply→resolve round trip through the compatibility wrappers). Two originals ("reads the legacy bare-array messages.json shape", "writes new feedback under 5-system/feedback/, not the legacy workspace-root folder") are superseded by the richer new describe blocks and Task 3's thread-file assertion, respectively, and are not carried forward verbatim.

**Migration:** lazy and one-time, on the first read by a v116+ client. `messages.json` is copied into `threads/`, keyed by each message's own id, and then never touched again — not moved, not deleted, at either the `5-system/feedback/` or the legacy workspace-root location. Idempotent and concurrency-safe by construction (identical names, identical content; the index write is a `casLoop`). A read-only grant fails the migration silently and falls back to serving the legacy log.

**Rollback:** delete `5-system/feedback/threads/` and `5-system/feedback/threads.index.json`, then downgrade. `messages.json` is byte-identical to its pre-migration state, so a downgraded client resumes on it with no loss of pre-migration data. Feedback posted *after* the migration lives only in `threads/` and is not visible to a downgraded client — recover it by hand from the thread files before rolling back, or re-upgrade.

**File:** `src/data/feedback/feedbackStorage.ts`

**File:** `src/data/feedback/feedbackStorage.test.ts (rewritten)`

**Lines:** 2 files, +290 / -104

---

## Task 6 — Fix (sync): probe the feedback thread files instead of the frozen shared messages.json

**Why:** Task 6. After Task 5, nothing writes `messages.json` any more, so the old probe (`safeRevision(dirs.feedbackDir, FEEDBACK_MESSAGES_FILE)`) freezes forever and the unread dot on both widget triggers stops lighting for anyone else's activity — the exact staleness `workspaceSync.ts`'s own header doc says this probe exists to remove. Swapping to the *index*'s revision would only be half a fix: a plain reply deliberately does not touch `threads.index.json` (that is what keeps it rarely written), so an index-revision probe would go blind to exactly the event this family exists to report.

**What changed:** Replaced `Probe.feedbackRevision: Probed<number | null>` with `Probe.feedbackSignature: Probed<string>`, watching `5-system/feedback/threads/*.json` directly via a new `safeFeedbackSignature` helper — same bounded shape as `safeAcksSignature`/`safeSegmentsSignature`: one directory open, one `boundedSizeSignature` call (one listing, no file content, at most 64 size stats from the tail of the name-sorted listing). A new thread adds a NAME (always detected regardless of the stat budget); a reply changes a SIZE (detected for the newest 64 threads, which Task 2's time-ordered ids guarantee the tail contains). A reply to an older thread than that is still picked up by `FeedbackUnreadProvider`'s own 60s poll — this tick is a latency optimization on top of that poll, never the only path. Mechanically renamed `feedbackRevision` → `feedbackSignature` through the destructure, the `probeMonth` return, `carryUnprobed`, and the `diffFamilies` `movedFrom` check. Swapped the `FEEDBACK_MESSAGES_FILE` import for `FEEDBACK_THREAD_FILE_SUFFIX`, and added `FEEDBACK_SUBFOLDERS` to the existing `workspacePaths` import. Added one new test to `workspaceSync.test.tsx`'s feedback-family `describe` block: a reply that does NOT resolve (so the index is deliberately left untouched) still reports the `"feedback"` family — the two pre-existing tests in that block needed no change and remain the regression guard for this task.

**File:** `src/data/workspace/workspaceSync.ts`

**File:** `src/data/workspace/workspaceSync.test.tsx`

**Lines:** 2 files, +78 / -17

---

## Task 7 — Change (feedback-widget): list from the thread index and open only the current page's thread files

**Why:** Task 7. The widget used to call `loadFeedback` on every panel open, reading every conversation in the workspace into `messages` state. Under the new storage shape that is exactly the aggregate `loadFeedback` warns callers off of for a list view.

**What changed:** Replaced the `messages: FeedbackMessage[]` state with `summaries: FeedbackThreadSummary[]` (one index read + one names-only listing) and `threadsById: Record<string, FeedbackThread>` (only the current page's bodies). `refresh()` now calls `listThreadSummaries` and awaits the unread provider's `reloadUnread()` in parallel, then calls `markSeen()` with no argument — `FeedbackUnreadProvider.applyMessages` sets `messagesRef.current` synchronously before `setMessages`, so `markSeen()` reads exactly the list `reloadUnread()` just fetched, same freshness as the old `markSeen(msgs)` had no extra read required. `openCount`/`mySummaries`/`filteredSummaries` are now computed straight from the cheap summaries. Added `visibleSummaries` (the current page, chosen by `isManager && adminTab === "all"` the same way pagination always was) and a `useEffect` keyed on the joined `visibleIdsKey` (a stable string identity for an array that changes reference every render) that calls `loadThreads` for exactly the visible page and merges the result into `threadsById`; a row whose thread has not arrived yet renders the existing `fb_loading` label instead of `MessageCard`. `handleReply` now also drops the replied-to thread from `threadsById` on success so the next page load re-reads it rather than showing a stale copy. `MessageCard`'s props are untouched — it still takes a `FeedbackMessage`, and `FeedbackThread` extends it, so no projection step is needed. New test file `FeedbackWidget.threads.test.tsx` (mocking `listThreadSummaries`/`loadThreads`/`loadFeedback`) verifies: a 150-summary list loads only the first 100-item page via `loadThreads`; the widget's own refresh never calls the full `loadFeedback` aggregate; and a loaded thread's replies render once its file arrives. `FeedbackWidget.unreadDot.test.tsx` needed no change — it mocks `loadFeedback` for the *provider*, which still calls it unchanged.

**Manual verification note (owner-required, not yet performed in this session):** CLAUDE.md flags this area (a new effect keyed on a derived string, a new async page load) as the class of bug that has previously survived self-review and even real-browser confirmation. `npm run dev` + attaching a workspace with legacy `messages.json` data should be exercised by a human/reviewer before this ships, per the plan's Task 7 Step 8.

**File:** `src/components/FeedbackWidget/FeedbackWidget.tsx`

**File:** `src/components/FeedbackWidget/FeedbackWidget.threads.test.tsx (new)`

**Lines:** 2 files, +254 / -50

---

## Task 8 — Docs (feedback): document the per-thread layout in data-system-report, CLAUDE.md and feedbackUnread

**Why:** Task 8. CLAUDE.md requires `docs/architecture/data-system-report.md` stay in sync with the on-disk layout it documents authoritatively.

**What changed:** Replaced the single `messages.json` row in `data-system-report.md`'s file table with three rows: `threads/{threadId}.json` (the durable source of truth, id format and CAS contract explained), `threads.index.json` (rebuildable CAS cache, written only on create/status-change), and `messages.json` (legacy, read-only as of v116.0, migration behavior noted). Updated the module's prose paragraph to describe the `threads/` split and the `getFeedbackDir`/`getFeedbackThreadsDir` path resolution, referencing the same `getAuditRoot` defect note Task 1's commit message cites. Updated CLAUDE.md's disk-layout code block to add a `feedback/` sub-line under `5-system/` (inserted after the concurrently-landed `system-errors/` line from an unrelated in-flight session, left untouched) and reworded the drift paragraph's feedback sentence to describe the three-file split instead of the old single-file description. Updated `feedbackUnread.ts`'s module doc comment to reference `5-system/feedback/threads/{threadId}.json` instead of the old single `messages.json` path, and added a note explaining why this module still consumes `loadFeedback`'s full aggregate rather than the summary index (it needs each individual reply's author/timestamp, which `FeedbackThreadSummary` deliberately omits).

**File:** `docs/architecture/data-system-report.md`

**File:** `CLAUDE.md`

**File:** `src/data/feedback/feedbackUnread.ts`

**Lines:** 3 files, +34 / -14

---

## Task 9 (partial) — scoped gate results

Per the coordinator's shared-worktree protocol, whole-repo `test:run`/`build`/`check:release`/
`check:bundle-size`/`check:vendor` were **not** run from this session (other concurrent agents'
in-flight files would make a whole-repo run noisy and non-attributable). Gates were instead run
scoped to every file this plan touched, after all 9 tasks' code and tests were written:

- `npx vitest run src/data/feedback/ src/data/workspace/workspaceSync.test.tsx src/data/workspace/workspacePaths.test.ts src/components/FeedbackWidget/` — **8 test files, 123 tests, all passed.**
- `npm run typecheck` (whole-repo `tsc -b`, run anyway since it is fast and project-wide by nature) — **clean, zero errors**, including every concurrently in-flight file from other sessions at the time of the run.
- `npx eslint <every file this plan touched>` — **clean** after one fix (below).
- `npm run check:complexity` (whole-repo, `eslint --rule complexity/max-lines-per-function`) — **clean**.
- `npm run check:hex-literals` — **clean**, no swept CSS file (including `FeedbackWidget.css`) exceeds its baseline.

**One real lint failure found and fixed during this pass, not merely reformatted:** the first cut of
Task 7 wrapped `visibleSummaries`/`visibleIds` in `useMemo`, depending on `mySummaries`/
`filteredSummaries` — plain, unmemoized `const`s recomputed every render. The repo's React Compiler
lint rule (`react-hooks/preserve-manual-memoization`) correctly flagged this as unsafe manual
memoization over an unstable dependency. Fixed by dropping both `useMemo` calls entirely and
computing `visibleSummaries`/`visibleIds` as plain consts, matching every other derived value in
this component (`openCount`, `mySummaries`, `filteredSummaries`) — the React Compiler memoizes the
component as a whole, so the manual wrapping was both unsafe and redundant. Re-ran the full scoped
lint + typecheck + test sweep after the fix; all green. Removed the now-unused `useMemo` import.
Committed separately: "Fix (feedback-widget): drop manual useMemo around visibleSummaries/visibleIds
to satisfy the React Compiler lint rule."

**Not run from this session, left to the consolidation pass:** `npm run build`,
`npm run check:bundle-size`, `npm run check:release`, `npm run check:vendor`, whole-repo
`npm run test:run`. None of this plan's own changes are expected to move the bundle-size or vendor
checks (no new dependency, a few hundred lines of logic); `check:release` depends on package.json
being synced to whichever version this plan's entries land at during consolidation.

---
