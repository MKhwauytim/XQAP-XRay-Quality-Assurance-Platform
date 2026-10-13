# Local-first answer outbox — design study

**Date:** 2026-10-13 · **Status:** study / proposal, nothing implemented · **Code basis:** `origin/main` @ `3dfe205b` (includes PR #215 answers save hardening and PR #217 employee load path), `package.json` 153.25.0.

**Evidence labels used throughout**

- **[code]** read directly from `origin/main`. File:line refers to that revision.
- **[field]** taken from field evidence that is already written down in the repo (comments, the 2026-10-13 compaction spec).
- **[assumed]** an inference or estimate. **Nothing in this study was measured.** Every timing below is either a ladder constant from code or an assumption, and is labelled as such.

Related, already approved design this study builds on and must not duplicate:
`docs/superpowers/specs/2026-10-13-answers-compaction-and-load-path-design.md` ("Plan 2": per-assignee layout + compaction, §8 save hardening, §9 load-path fixes).

---

## 0. Executive summary

1. **The 6–7 minute submit is not caused by retry sleeps.** Sleeps are capped at 30 s per action (`INTERACTIVE_WRITE_DEADLINE_MS`, `operationDeadline.ts:66`). The deadline does not interrupt I/O that is already running (`operationDeadline.ts:33-37`). The time goes to unbounded I/O: reads whose cost grows with **the number of files in shared folders** (~2,000 `answers.events` segments **[field]**, plus the legacy `distribution.events/*.json` files), done several times at once by uncoordinated background readers in the same tab.
2. **Submits stay unconfirmed because the UI has no durable local record of having submitted.** A failed or slow save is queued only *after* the disk attempt ends (`answerStorage.ts:1261-1270`). The case row is only updated on success (`XrayReferrals.tsx:484-488`). The next reload drops the queued answer from the queue view (`localSubmissions.ts` only records successes). So the employee sees the case as not submitted and submits again. The pending replay re-issues the save with a **new eventId and a new eventAt** through `upsertItemAnswer` (`pendingAnswerReplay.ts:313`). Because of that it needs a strict, whole-month, every-employee read before each pass (`pendingAnswerReplay.ts:223-236`, `answerStorage.ts:1849-1907`), and that read is itself very expensive.
3. **Recommendation:** adopt the outbox (alternative 2), in phases. Phase 1 is small. The submit writes the *final* `AnswerEvent` (with its own eventId and eventAt) to IndexedDB with `durability: "strict"` and returns at once. The existing replay runner then lands *that exact event*, so a replay can never move the answer backwards and the strict pre-read is no longer needed. The queue view overlays the outbox. Read-side dedupe by eventId already exists and is confirmed (§B). Plan 2 (compaction / per-assignee) remains the fix for load time. The outbox fixes reliability and how fast the save feels. It does not fix file count.

---

## A. What already exists, and why submits take minutes

### A.1 Inventory (build on it, do not duplicate it)

| Piece | Where (origin/main) | What it does today | Reuse in the outbox design |
|---|---|---|---|
| `performAnswerWrite` | `answerStorage.ts:1108-1273` | Mints `eventId`/`eventAt` **once per call** (`:1118-1119`). Decides (blind or full read), appends one batch, mirrors on success, marks pending on failure. No casLoop (S2 note `:1138-1156`). | Becomes the syncer's append core, given a caller-supplied event (eventId/eventAt from the outbox). |
| `upsertItemAnswer` | `answerStorage.ts:1413-1446` | Builds an `item-saved` event. `blindAppendWhenSeeded: true` (`:1444`). | The UI stops awaiting it. The outbox flush calls the core with the stored event. |
| `decideFromSeededCache` (blind path) | `answerStorage.ts:1062-1090` | Skips the month read **only if** this tab's in-memory events cache already holds a `migration-seed` for the employee. Otherwise falls back to the full read (`:1196`). | Kept: the syncer is seeded once per (month, user) per session. |
| `readAllAnswerEventsForMonth` | `answerStorage.ts:492-535` | Incremental read of the flat `answers.events/`. Events cache is a `Map` keyed by `eventId` (`:517-518`). **No in-flight dedupe:** concurrent callers each run their own read. Not bounded by any deadline. | Add `dedupeInFlight` (quick win). |
| `appendAnswerEventSegment` → `appendEventSegment` | `answerEventStore.ts` → `appendOnlyEventLog.ts:1202-1551` | Per-chain Web Lock (`:1298`). First append of a page runs `discoverHighestOwnSeq` (a **full directory listing**, `:439-456`, `:1306`). `knownFor` lists the directory **again** for a stable writer whenever the name was not written this session (`:1230-1244`). Re-reads its own segment (`readExistingSegment` `:683-780`), **rewrites the whole open segment** (≤256 KiB, `:209`, `:1476-1482`), then verifies the size (`verifySegmentSize` `:810-881`, ~11 s ladder `transientFileErrors.ts:237-239`). Bounded rotation. | The flush appends **all** pending events in one call (one lock, one rewrite, one verify). `chunkEventsForSegmentAppends` (`:532`) already exists for size caps. |
| `answerLocalMirror.ts` (IndexedDB `xray_answers_local_mirror_v1`, store `items`, v1) | `answerLocalMirror.ts:51-73` | Last state per item (`month::user::xrayImageId`) with `synced: boolean`. **No eventId and no event.** `markAnswerPendingLocally` (`:227-243`) runs only **after** the failed disk attempt. `getAll` of the whole store on every count/check (`:434-445`). | **Evolve** it into the outbox. Do not add a second parallel queue (CLAUDE.md "no duplicate state"). |
| `isAnswerQueuedPending` | `answerLocalMirror.ts:485-492`, used at `XrayReferrals.tsx:520` | Only decides whether the panel line says «لم يُحفظ بعد — ستُعاد المحاولة تلقائياً…». | Replaced by an outbox status read. |
| `PendingAnswerReplayRunner` | `PendingAnswerReplayRunner.tsx:54-97`, mounted `AuthGate.tsx:787` | Runs on mount, then every 30 s, **only while the tab is visible** (`:80`). Never gives up (no attempt cap, no backoff). | Becomes the syncer host (leader-elected). |
| `replayPendingAnswers` | `pendingAnswerReplay.ts:162-337` | In-tab `dedupeInFlight` plus a cross-tab `withTryResourceLock` keyed on username (`:167-172`). Per month: **strict `loadAllEmployeeFiles`** (`:223-236`), then **one `upsertItemAnswer` per item, serially** (`:290-332`), each with its own 30 s budget and full append cycle. | Keep the lock design. Replace the strict read and the per-item upserts. |
| `answerDraftStore` | `answerDraftStore.ts` (localStorage `xray_answer_draft_v1:` prefix, 30-day TTL) | Typed-but-unsaved values. Its own doc says it is **not a queue** of pending writes. Cleared only on a successful submit (`XrayReferrals.tsx:497`). | Unchanged. It still protects typing. The outbox protects submitting. |
| `localSubmissions.ts` | `XrayReferrals/localSubmissions.ts:19-69` | Overlays this tab's *successful* submits onto a reload that started before them. | Feed it from the outbox (pending + confirmed), so a queued submit also survives reloads. |
| `storageRegistry.ts` | `:23-131` | Registers `xray_answers_local_mirror_v1` (IndexedDB). Its `lossConsequence` text (`:129`) says loss has "no effect on saved data". **That is false whenever `synced:false` records exist.** `clearOwnedStorage` (`:162-195`) deletes the DB without checking. | Must be fixed in phase 1 (§D). |
| `requestStoragePersistence` | `storageRegistry.ts:208` | Already exists. Notes that on `file://` it is usually unsupported. | Call it when the outbox is first used. Show the result in the health indicator. |
| `useUnloadGuard` | `src/hooks/useUnloadGuard.ts:32-45` | Existing `beforeunload` hook. | Reuse for «لديك إجابات لم تُرسل بعد». |
| `answerSealedSegments.ts` | `:36` `SEALED_REVALIDATE_MS = 180_000` | Sealed (superseded) segments are skipped on re-read. Every 180 s all of them are re-statted. | — |
| Sealed skip in `readSegmentTails` | `directoryScan.ts:894-~990` | Only segments **with a higher-seq sibling** are skipped. A chain *head* is opened on **every** read (concurrency 8, `directoryScan.ts:30`). Single-segment chains left by pre-A1 per-page-load writers are all heads. | Root cause R1 (below). Plan 2 compaction is the fix. |
| `actionLog.appendWorkspaceAction` | `actionLog.ts:471-555` | Whole-file read-modify-write of the per-actor log under a per-actor lock + casLoop (6 retries, **no deadline**, `:546`). `recordAction` is fire-and-forget (`:572-580`). | Already **off** the submit await chain (`XrayReferrals.tsx:475` is not awaited). Still shares share bandwidth with the save. Batch it in the flush (§D). |
| Answer-owners peek / sync probe | `workspaceSync.ts:471`, `:1034-1036`, `:1134`, `:1184-1188`; `dataRefreshSignal.ts:91-97` | Stats at most 64 chain heads. **If there are more than 64 heads, `ownersUnknown = true`, so `answerOwners = null`, and `answersMayConcern()` returns true for every user.** | Root cause R3 (reload storm). |

### A.2 The submit await chain, step by step [code]

`InspectionPanel.submitStudy` (`InspectionPanel/index.tsx:300-343`) sets `submitting` (label `ip_submitting` «جارٍ التقديم…») and awaits `onSave` **with no timeout**. The chain is:

`handleSave` (`XrayReferrals.tsx:426-531`)
→ `upsertItemAnswer` (`:460`)
→ `performAnswerWrite`:
1. `ensureMonthWritable` (`answerStorage.ts:1117`). Month-lock TTL cache. Usually cheap.
2. `retryDecisionRead` (`:1184-1214`). Retries throws up to 14× (`ANSWER_SAVE_MAX_RETRIES=14`, base 150 ms, `:91-92`, linear backoff `150·(n+1)` + jitter, `:1028`). Sleeps are deadline-capped. **Each attempt's I/O is not.**
   - **Blind path** (cache has this employee's seed): legacy seed memo, or one legacy read (~4 ops). No month read.
   - **Full path** (no cache entry, or no seed yet): `readAllAnswerEventsForMonth` lists the whole flat directory and opens every non-sealed segment (all heads, see R1). Then `resolveSeed` (`:923-966`) may write an empty legacy shell (`safeWriteJson`, with its own two ~11 s verify ladders, `operationDeadline.ts:7-13`).
3. `appendAnswerEventSegment` (`:1222-1227`):
   - Wait for the chain Web Lock (`appendOnlyEventLog.ts:1298`). It is shared with the replay runner and with any other tab of the same browser/user/month.
   - First append of the page: `discoverHighestOwnSeq` lists the directory (~2,000 entries **[field]**). `probeAheadForHead` (`:1331-1349`) makes up to 64 `getFileHandle` hops.
   - `knownWrittenFor` → `knownFor` lists the directory again (`:1234`) unless the name is already in `writtenSegmentsThisSession`.
   - `readExistingSegment`: `getFile` and the full text of the open segment (≤256 KiB). Ladder up to ~11 s if this session wrote it and it is not visible yet.
   - Optional rotation: another `readExistingSegment`, possibly `ensureReliableRotationTarget` (≤5 hops).
   - `writeSegmentOnce`: rewrites the whole segment. Blocked-replace ladder `[20,200,1000,3000]` (`:917`), at most one rotation.
   - `verifySegmentSize`: `getFile().size`. Up to ~11 s ladder, and the first retry always runs even past the deadline (`:825-830`).
4. On success: `bumpWorkspaceEpoch`, `mirrorAnswerLocally` (IndexedDB). On failure: `markAnswerPendingLocally`.
5. Back in `handleSave`: on success it calls `recordAction` (not awaited) and `setAnswers`, clears the draft, and broadcasts `notifyLocalDataChange(["answers"])`. On failure it awaits `isAnswerQueuedPending` (a `getAll` on IndexedDB).

**Worst-case sleeping** bounded by code: about 30 s (deadline) plus one ~11 s verify rung past it. **Worst-case I/O:** unbounded. It scales with (directory listings × entries) + (segments opened) + (queueing behind other in-flight share operations from the same tab).

### A.3 Why it can take 6–7 minutes — ranked hypotheses

| # | Hypothesis | Evidence | Confidence | Cheap to confirm by |
|---|---|---|---|---|
| **R1** | **Every month read costs O(all files in `answers.events/`).** ~2,000 segments **[field]**. Every chain head is opened on every read, because the sealed skip only covers superseded names (`directoryScan.ts` `namesWithHigherSibling`) and pre-A1 per-page-load chains are single-segment heads. Load (Phase 1 `loadEmployeeAnswers`, `XrayReferrals.tsx:1307`) and every non-blind save pay a listing plus N opens. | [code] + [field] | High | `(Get-ChildItem <month>\1-main\answers.events -File).Count` and `Measure-Command` on the listing (§F.1). Count heads vs superseded. |
| **R2** | **Concurrent duplicate reads in one tab (an I/O storm).** `readAllAnswerEventsForMonth` has no in-flight dedupe. The oversight path fans out `loadEmployeeAnswers` per assignee with an **unbounded `Promise.all`** (`XrayReferrals.tsx:1413-1425`), so N employees on a cold cache means **N concurrent full reads** of the same directory. On sign-in, the replay runner's strict read (`PendingAnswerReplayRunner.tsx:91`), the Phase 1 read, and other LRU-mounted views (`XrayInspectionResults`) all start at about the same time. Silent reloads have no single-flight guard in `XrayReferrals` (a superseded load's I/O keeps running; only its commit is dropped, `:1214`, `:1437`). | [code] | High | Telemetry: in-flight FS-op gauge at save start, overlapping-load counter (§F). |
| **R3** | **A reload storm from the 45 s sync tick.** If chain heads > 64 (`workspaceSync.ts:1034`), owners are unknown, so the broadcast carries `answerOwners: null` (`:1187`) and `answersMayConcern` returns true for **every** employee (`dataRefreshSignal.ts:91-97`). The result: every colleague's save makes every employee's queue run a full silent `loadData` (`XrayReferrals.tsx:1489-1501`). Each local broadcast also reloads other mounted views. With a reload slower than 45 s, reloads overlap without limit and starve the submit's handful of share operations. | [code]; heads > 64 is [assumed] given ~2,000 segments | High | Log `heads`, `ownersUnknown` and the reload count per tick (§F). |
| **R4** | **The submit takes the full (non-blind) path.** This happens when the cache has no seed for this (month, user): the first save of a month, a manual refresh (it drops the cache, `answerStorage.ts:438-441`), ad-hoc folders, or a module reload. The submit then pays R1 inside its own await. It also pays it while Phase 1 is still running, since the two reads are not deduped (R2). | [code] | Medium | Telemetry `save.decide.blind=true/false` + reason. |
| **R5** | **The first append of a page lists the directory twice inside the chain lock** (`discoverHighestOwnSeq` + `knownFor`). On a 2,000-entry SMB directory each listing is [assumed] seconds to tens of seconds. | [code] | Medium | Telemetry `append.listing.ms`, `append.listing.count`. |
| **R6** | **Replay amplification.** Once anything is pending, every 30 s a strict `loadAllEmployeeFiles` reads all segments and **then loops over every employee serially**, each with a legacy file read plus a `.requests.json` read (`answerStorage.ts:1870-1890`). That is ~2-4 share reads × headcount per pending month per tick. Then items are upserted one by one, each a full append cycle. It holds the chain lock that the foreground submit is queued on (FIFO). Pending items create load, load makes more saves fail, and failed saves create more pending items. | [code] | Medium-High when pending > 0 | Telemetry `replay.tick.*`. Check whether the slow PCs are the ones with pending > 0. |
| R7 | Verify/reread ladders on SMB visibility lag (~11 s each). | [code] | Low as a sole cause (bounded) | `logLadderDwell` already logs `append.verify` / `append.reread` (`answerStorage.ts:988-1005`). Check the error log for `ladder-dwell` lines. |
| R8 | Audit log contention (whole-file rewrite, no deadline) competing for bandwidth after each submit. | [code] | Low-Medium | Telemetry `audit.append.ms`. |

**Most likely single root cause:** **R1 × R2/R3**. A file-count-proportional read (R1) is started several times in parallel and repeatedly (R2/R3), so a save that needs only ~5 share round trips queues behind thousands. The cheapest confirmation is three facts on the slow PC: the file counts in `answers.events` and `distribution.events`, the time of one directory listing, and whether the error log shows `ladder-dwell` totals that are small compared with the 6–7 minutes. If ladder dwell is small, the time is I/O and not sleeping.

### A.4 Why submitted cases stay unconfirmed and get resubmitted [code]

1. **The commit point is the share, not the browser.** Nothing durable records "the employee pressed «تقديم الفحص»" until the disk attempt ends. If the tab is closed or reloaded during a 6-minute save, nothing is queued. Only the draft survives, and the draft "is not a queue" (`answerDraftStore.ts` doc). Result: a lost *submit* (the typed values are kept).
2. **A failed or queued submit is invisible after any reload.** `handleSave` updates `answers` only in the ok branch (`XrayReferrals.tsx:484-488`). `useLocalSubmissionGuard.record` is called only on success. Phase 1 builds the queue from disk only (`:1307`, `:1380`). The «لم يُحفظ بعد…» line (`ip_save_status_queued`) is panel-local state (`InspectionPanel/index.tsx:161-163`) and is lost on navigation. `XrayReferrals` has **no pending-count banner** (only `XrayInspectionResults` shows `ew_answers_pending_sync`, `XrayInspectionResults.tsx:867-869`). So the row reads as not submitted and the employee submits again, paying R1–R6 again.
3. **"Saved" after a replay needs a full reload.** The panel shows a queued save as saved only when `savedAnswer.lastSavedAt >= queued savedAt` (`InspectionPanel/index.tsx:273-282`). `savedAnswer` comes from disk via `loadData`, which the replay triggers with `notifyLocalDataChange(["answers"])` (`pendingAnswerReplay.ts:335`). That reload is itself a 6–7 minute full read (R1).
4. **The replay changes the answer's identity.** `upsertItemAnswer` mints a new `eventId` and `eventAt = now` (`answerStorage.ts:1118-1119`) for an answer the employee gave minutes or hours earlier. Two consequences:
   - (a) An ambiguous first attempt that actually landed, followed by a replay, produces **two different events** for one action. This is harmless to the fold (same content, later one wins), but it is not idempotent.
   - (b) The replay **must** do the strict whole-month on-disk check (`pendingAnswerReplay.ts:203-236`) so that a stale local copy stamped "now" does not overwrite a newer answer from another device (for example a supervisor reopen). That check is the expensive part of R6.
5. **The replay can stall for long periods with no signal to the user.**
   - `cannotLand` whenever any segment is unreadable but not yet "confirmed dead" (`pendingAnswerReplay.ts:279-288`; dead needs `DEAD_SEGMENT_MIN_SCANS` over `DEAD_SEGMENT_MIN_AGE_MS`).
   - Skipped entirely while the tab is hidden (`PendingAnswerReplayRunner.tsx:80`).
   - Skipped when another tab holds the lock (`pendingAnswerReplay.ts:168-172`). That is fine, but nothing shows it.
   - `markSynced` failures are swallowed. The `seenOnDisk` memo (`:84-96`) stops the repeated announcements but keeps the count above 0.
6. **Does the replay run, how often, does it give up, does it dedupe?** It runs once on mount, then every 30 s while visible. It never gives up, and it has no per-item backoff. It dedupes in-tab by join and cross-tab by try-lock. It does **not** dedupe by event identity, because it creates a new event each time. The UI reflects `synced:false` only through the panel line (until navigation) and the `XrayInspectionResults` banner. `XrayReferrals` does not reflect it.

---

## B. Read-side idempotency (verified) [code]

| Layer | Where | Behaviour |
|---|---|---|
| Raw-event cache | `answerStorage.ts:517-518` | `events: Map<eventId, AnswerEvent>`. A second copy of the same `eventId` (from another segment, or from a re-read of this tab's own tail) **replaces** the first. One entry per id. |
| Generic dedupe | `appendOnlyEventLog.ts:1831-1844` `filterAlreadyFolded` | Map by id, first-seen order, last copy's content. Also drops ids already folded by a resumed checkpoint. |
| Fold | `answerEventStore.ts:736-819` `foldAnswerEvents` | Step 1 dedupes (`:754-766`, records `duplicate-event-id` drops). Step 2 sorts by the single comparator `(eventAt, authority, eventId)` (`:260-276`), so **append order and segment order are irrelevant**. Out-of-order arrival is handled by a full refold from raw events (`answerStorage.ts:220-230` explains why no late-event guard is needed). |
| Other raw consumers | `history/actionHistoryReaders.ts:65-66` | Reads via `readAllAnswerEventsForMonth`, so the same Map dedupe applies. |
| Sync owners peek | `workspaceSync.ts:934` | Reads raw tails only to find owners. A duplicate is harmless. |

**Same event appended twice in two segments:** both copies are read, the Map keeps one, and the fold applies it once. **Out of contract:** the same id with *different* content. The fold does not arbitrate it, and the doc says backup merge must detect it (`answerEventStore.ts:723-726`). The outbox must therefore treat a stored event as **immutable** once it has an id. It must never "update" a pending event in place. A newer submit of the same case is a new event with a new id.

**Fold-order implication for the outbox:** because `eventAt` is fixed when the employee commits locally, a delayed flush lands the answer at its true place in time.
- A supervisor reopen made at T2, after the employee's local commit at T1 < T2, still wins.
- An employee resubmit made at T3 > T2 still wins over that reopen.
- This is *better* than today's replay, which restamps `eventAt = now` (A.4 #4).

**Residual, unverified:** `seedEvent` ids derive from the caller's eventId (`answerStorage.ts:957`). Two devices seeding the same employee produce two `migration-seed` events. The fold picks the first in order (`answerEventStore.ts:773`). This is pre-existing and not changed by the outbox. It needs a test if the syncer ever seeds.

---

## C. Load path — instant first paint plus background revalidation

### C.1 What the load does today [code]

- **Phase 1** (`XrayReferrals.tsx:1281-1308`), one `Promise.all`: referral log, replacement log, ad-hoc entries and answers, the personal sample mirror, the distribution log stamp, and `loadEmployeeAnswers` (a **full `answers.events` read**, R1). The **first paint waits for all of these**, including the full answers read.
- **Phase 2** (`:1349-1386`): `isMirrorTrustedForEvents` (`sampleMirrorStorage.ts:748-777`; `eventStoreMatchesScan` stats the distribution events store). If the mirror is trusted, the load paints and stops. If it is stale, the load paints and continues.
- **Phase 3** (`:1390-1428`): `loadSampleMaster` (all drawn rows), then `loadOrDeriveDistributionCurrentStrictForRead(..., { persistAfterReadFold: true })` (`distributionStorage.ts:2549-2600`). That can be a full refold over the legacy `distribution.events/*.json` files plus segments, followed by a **queued write** of `distribution.current.json` and the mirrors by *this employee's browser*. Oversight then fans out `loadEmployeeAnswers` per assignee with no concurrency bound (R2).

### C.2 Quick wins (no format change)

1. **`dedupeInFlight` around `readAllAnswerEventsForMonth`**, keyed `(workspaceScopeId, month, strict, epoch-agnostic)`. Concurrent callers join one read. **The strict and lenient reads must not share a promise**, the same rule as in `distributionStorage.ts:2540-2546`.
2. **Oversight fan-out:** replace the per-assignee `loadEmployeeAnswers` `Promise.all` (`XrayReferrals.tsx:1413-1425`) with one `loadAllEmployeeFiles` (reads the events once, `answerStorage.ts:1856-1866`), or at least `mapWithConcurrency(…, 8)` after one warm-up read.
3. **Single-flight silent reload in `XrayReferrals`**, mirroring `XrayInspectionResults.tsx:528-541` (`silentInFlightRef`): at most one silent load in flight plus one queued "dirty" rerun. That caps R3 at one overlapping read.
4. **Sync probe, heads > budget:** for a **personal-scope** subscriber, treat `answerOwners === null` as "maybe mine" **at most once per N minutes** (for example 5) instead of on every tick. Distribution, requests and manifest changes still reload at once. This is a behaviour trade-off: a supervisor's on-behalf answer on this employee's row could show up to N minutes late. **Owner decision (Q7).** The root fix is Plan 2. With compaction, heads ≤ 64 again and the owners peek works.
5. **Do not block the first paint on the full answers read.** For personal scope, paint from the IndexedDB snapshot (C.3), or at least from `loadMirroredAnswers` + outbox. Let `loadEmployeeAnswers` revalidate.
6. **Stop read-path persistence by every employee, or rate-limit it.** `persistAfterReadFold` (spec §9.4, deliberately on) makes many employee browsers write the shared `distribution.current.json`/mirrors. That is a many-writers-one-file pattern (the XQ-IO-032 shape). Options: (a) persist only when `role ∈ {supervisor, manager, admin}`; (b) persist at most once per (month, epoch) per tab; (c) keep it, but skip it while an outbox flush or answer save is in flight. Recommendation: (b)+(c) now, (a) as an owner decision (Q8).
7. **Legacy `distribution.events/*.json` compaction.** These are per-event files read by `readJsonDirectory` (`distributionEventStore.ts:434`), one share open each. Fold them into one segment through an **admin-prompted, explicit, tested migration** that **archives** the originals to `distribution.events/_archive-v1/`, never deleting them, following the post-launch migration policy and the `finalizeLegacyMigration` precedent. Bundle it with Plan 2's admin migration modal so there is one prompt and not two.
8. **Bounded concurrency is already 8** for segment opens (`directoryScan.ts:30`). Do not raise it until a share measurement exists. More parallelism on a saturated SMB link [assumed] makes R2 worse.

### C.3 Stale-while-revalidate snapshot (phase 3 of the rollout)

**Store:** a `snapshots` object store in the same IndexedDB as the outbox (one registry entry, §E), keyed `snapshot::{workspaceKey}::{month}::{username}::{scope}`.

**What to snapshot**, exactly what `commit()` takes (`XrayReferrals.tsx:1322-1340`):
- `entries` (own `DistributionEntry[]`; oversight: all) and `quota`
- `pendingReferralIds`, `pendingReplacementIds`
- `answerItems` (disk-folded only, **never** merged with the outbox, so the overlay stays a separate step)
- **not** `sampleMaster` (large, loaded on demand today, `:1376-1379`)

**Validators** stored with it:
- distribution log revision + mirror `scan` (the same trust tuple as `isMirrorTrustedForEvents`)
- the answers listing signature `(count, totalBytes)` of `answers.events`
- the own `.requests.json` revision
- `DERIVE_VERSION`, `appVersion`, `snapshotSchemaVersion`

**Workspace identity:** `workspaceScopeId` is a per-tab counter (`pendingAnswerReplay.ts:121-133` explains why), so it cannot key a persisted snapshot. Use a stable id from `5-system/workspace.schema.json` if it has one. Otherwise mint one on first admin init. **Open question Q4.**

**Flow:**
1. On mount, read the snapshot (≈ms) and paint it with a visible stale marker «آخر تحديث: {time} — جارٍ التحديث…». Apply the outbox overlay (own pending submits shown as submitted).
2. Revalidate in the background with the normal Phase 1–3 path, now deduped and single-flight.
3. Commit the fresh result, write a new snapshot, and drop the marker.

**Avoiding wrong assignment state:**
1. While the snapshot is stale, **reassign, replacement and referral actions are disabled**, and they are enabled only after revalidation. These read assignment state for their idempotency guards. **Submit stays enabled**, because the answer is keyed by `(xrayImageId, assignee)` and is safe to queue.
2. When revalidation removes a row that has an outbox entry (the case was reassigned away), show «تمت إعادة إسناد هذه الحالة — إجابتك محفوظة وستُرسل، يرجى إبلاغ المشرف». The answer still lands in the old assignee's slice, and `integrity/orphanScan.ts` (B3) already finds those.
3. The snapshot is discarded on a validator mismatch of `DERIVE_VERSION` or the schema version, on a manual refresh (`broadcastDataRefresh("manual")`), and on sign-out of a different user.
4. Hard cap on staleness: older than 7 days means "do not paint".

---

## D. The design, enhanced and stress-tested

### D.1 Core model

```
submit ──► IndexedDB tx(durability:"strict"): outbox.put({eventId, event, status:"pending"})   ← COMMIT POINT
       └─► UI returns (<1 s [assumed]), row shows «محفوظ على هذا الجهاز»
syncer (one per browser+user, Web Lock leader) ──► every T or on kick:
       collect pending (all months) ─► group by month ─► seed check ─► ONE appendAnswerEventSegment(batch)
       ─► verified: status=confirmed, mirrorAnswerLocally, notify  ─► «تم الإرسال»
       ─► unverified: status=sent-unverified ─► confirm by re-reading OWN head segment for the eventIds
       ─► error: attempts++, backoff, classify (transient | blocked | poison)
```

### D.2 Risk-by-risk mitigations

| Risk | Mitigation |
|---|---|
| **Crash between click and IndexedDB commit** | The UI waits for `tx.oncomplete` with `{ durability: "strict" }` (Chromium supports `IDBTransactionOptions.durability`; the default is relaxed). Only then does it say «محفوظ على هذا الجهاز». If the commit fails (quota, IndexedDB unavailable) the UI **falls back to the current synchronous disk save** with the current UX. It never claims a local save it did not make. |
| **Browser storage cleared** (Settings «مسح التخزين», "clear site data", or another local HTML app on the shared `file://` origin, `storageRegistry.ts:4-8`) | (1) `clearOwnedStorage` refuses while the outbox has unconfirmed items, and offers export first. (2) Fix the registry `lossConsequence` text: unsynced answers on this device are lost. (3) `requestStoragePersistence()` on first outbox use. The state is shown in the health indicator; [assumed] usually "unsupported" on `file://`. (4) Flush quickly (seconds), so the exposure window is small. (5) The existing draft store still holds the typed values. |
| **Employee switches PC with unsynced items** | (1) A persistent banner plus `useUnloadGuard` «لديك {n} إجابة لم تصل إلى المجلد المشترك بعد». (2) **«تصدير الإجابات غير المرسلة»** downloads a JSON of the raw outbox events. (3) An admin/supervisor **«استيراد إجابات غير مرسلة»** appends those events with the **same eventIds** (idempotent, §B) through the normal append core. (4) Optional phase 3: a per-device status file `5-system/outbox-status/{user}.{deviceId}.json` (single writer, tiny) so sign-in elsewhere can say «يوجد {n} إجابة غير مرسلة على جهاز آخر». This is a new workspace file, so it must follow the add-a-file convention and be documented in `data-system-report.md`. It is additive, so no migration. |
| **Multi-tab leader election** | The leader holds `navigator.locks.request("xray:answer-outbox:{user}", …)` for the tab's lifetime. Other tabs queue as standbys, and the lock transfers automatically when the leader closes. Followers kick the leader via `BroadcastChannel("xray-answer-outbox")`. **Fallback** when Web Locks throws or is unavailable (`webLocks.ts:79-92` has no SecurityError fallback for the blocking variant; the try-variant does, `:134-168`): every tab may flush. **This is safe because duplicates dedupe by eventId** and the chain lock still serialises appends within the origin. The cost is only redundant bytes. |
| **Clock / ordering** | `eventAt` is taken at local commit from the existing monotonic clock (`answerStorage.ts:166-173`). The fold orders by it, so flush order is irrelevant. Cross-PC skew is pre-existing and unchanged. Log `Date.now()` vs. the share `lastModified` of our own segment after a flush to measure skew (§F). |
| **Partial batch failure** | A segment append is one whole-file rewrite, so the batch lands entirely or not at all, except that `verifySegmentSize` may return `"unverified"`. In that case mark `sent-unverified` and confirm on the next tick by reading **our own** head segment (one `getFile`, which we own) and checking the eventIds. Re-appending blindly is also safe (dedupe) but grows the file. Batches larger than the cap go through `chunkEventsForSegmentAppends`. Confirm each chunk separately. |
| **Size-capped segments** | Reuse the rotation caps (`appendOnlyEventLog.ts:209-210`). Cap a flush at 500 events [assumed] per tick. |
| **Poison item** | Classify the error. `MonthClosedError` / `ReadOnlyModeError` / permission lost map to `blocked` (kept, retried slowly, shown as «الشهر مغلق — ستُرسل عند فتحه»). Validation or fold-refusal errors map to `quarantined` after 3 deterministic failures: never retried automatically, shown to the employee, included in export. Anything else is `transient`, with backoff. One item never blocks the batch: on a batch failure that is not transient, bisect. |
| **Retry policy** | No hard deadline for *background* flushes. Backoff 2 s → 5 s → 15 s → 60 s → 5 min cap, jittered. A per-flush watchdog only for telemetry. A `visibilitychange` kick and an `online`-style kick when a read succeeds. Unlike today, the syncer runs while the tab is hidden, at a slower cadence (60 s): the employee may switch to another window right after submitting. |
| **Outbox schema versioning** | `schemaVersion` on every record. The DB version bump runs `onupgradeneeded` as an **explicit, tested module** (`outboxSchema.ts`). Unknown future versions are read-only: never deleted, the syncer refuses to touch them, and they are surfaced in export. |
| **Writer identity** | Each record carries `deviceId` (`getDistributionDeviceId`), the tab `sessionId`, `appVersion`, and `username`. Segments keep the stable chain identity (`answerSegmentChain.ts:52-67`), so there is no new on-disk naming. |
| **Supervisor visibility latency** | Today the latency is the save time (minutes) plus 45 s. With the outbox it is the flush interval (target ≤ 5 s after commit [assumed]) plus the 45 s probe tick. Add **«إرسال الآن»** (force-sync) in the banner, and a supervisor-side note in Phase 3: «قد تتأخر إجابات بعض الموظفين حتى ٤٥ ثانية». |
| **On-behalf writes** | `upsertItemAnswerOnBehalf` uses an append-then-confirm protocol (`answerStorage.ts:1509-1616`) and needs a read after the append. **Keep it out of the outbox in phases 1–2.** It is low volume and supervisor-driven. |
| **Reopen / quality note** | These are built from the folded `previous` (`answerStorage.ts:1163-1168`). Keep them synchronous for now. The outbox carries only `item-saved`, matching today's `pendingEligible` rule. |
| **Audit log** | The submit already does not await it. In phase 2, add an `auditQueue` store and flush it in the same syncer pass, **one `appendWorkspaceAction` call carrying N entries**. This needs a small `appendWorkspaceActions(entries[])` variant: same casLoop, one read-modify-write. Entry ids are minted at commit, so retries stay idempotent. Note that today's `createActionId()` runs inside the casLoop attempt (`actionLog.ts:500-504`) despite the "idempotent by id" doc at `:411`. That is a small existing inconsistency to fix along the way. |

### D.3 Alternatives compared

| | 1. Fix retry/await chain only | **2. Outbox + batched flush (recommended)** | 3. Per-employee single-writer inbox file | 4. Service Worker / Background Sync |
|---|---|---|---|---|
| Reliability (no lost submit) | Unchanged: the commit point is still the share; a tab close mid-save loses the submit | **High**: the commit is local and durable, and replay is idempotent | Same as today unless combined with 2 | n/a |
| Latency to employee | Better, but still bounded by share I/O (seconds to minutes under R1–R3) | **<1 s [assumed]** | Same as 1 | n/a |
| Latency to supervisor | Same as today | flush + 45 s | Same | n/a |
| Complexity | Low | Medium (new IndexedDB store, syncer, UI states) | Already exists: the stable chain *is* a per-(device, employee, month) single-writer file (`answerSegmentChain.ts`); Plan 2 adds per-assignee folders | — |
| Blast radius | Small | Medium. Browser storage only, **no workspace format change** | Plan 2 is tier 3 with a migration | — |
| Rollout risk | Low | Medium. Mitigated by a feature flag and a shadow mode | Covered by Plan 2's own plan | — |
| Verdict | **Do its quick wins anyway** (C.2, R6 fixes) | **Do it** | **Already planned (Plan 2). Complementary: it fixes load, the outbox fixes save reliability** | **Not viable**: Service Workers need a secure http(s)/localhost context. The app is distributed as `file://` (CLAUDE.md). A SW also cannot show File System Access permission prompts. A dedicated or shared *Worker* could host the syncer's I/O later; that is optional. |

**Recommendation: 2 + the quick wins from 1, with 3 (Plan 2) continuing on its own track.**

### D.4 Phased rollout

**Phase 1 — the smallest change that stops lost and unconfirmed submits** (one PR, tier 3 because it changes the browser-storage format and the meaning of "saved"; edit log required):
1. Evolve `answerLocalMirror.ts` to DB version 2: add an object store `outbox` (keyPath `eventId`, indexes `byUser`, `byUserMonth`, `byStatus`). Migrate existing `synced:false` mirror records into outbox records **once**: mint an eventId, use their `lastSavedAt` as `eventAt` so the order stays truthful, and keep the mirror records. Write it as its own tested module.
2. Split `performAnswerWrite` so the event is built **before** I/O: `buildSelfSaveEvent(item, username) → AnswerEvent` (pure), then `landAnswerEvents(directoryHandle, month, username, events[])` (seed, blind decide, one append). `upsertItemAnswer` stays as a wrapper that does both, for every other caller.
3. `handleSave` (self path only): build the event, `outbox.commit(event)` with strict durability, then `setAnswers` + `recordLocalSubmission` + show «تم الحفظ على هذا الجهاز — جارٍ الإرسال…», then **kick** the runner and return. The disk append is no longer awaited by the UI. If the outbox is unavailable, fall back to today's awaited path.
4. `replayPendingAnswers` → `flushOutbox`:
   - Read the outbox, group by month, and call `landAnswerEvents` **once per month** with the stored events.
   - **Delete the strict `loadAllEmployeeFiles` pre-check.** It is unnecessary because original eventId and eventAt make the replay idempotent and order-correct (§B). Keep `sampleMainDirExists` (never create folders).
   - Run hidden too, at 60 s.
   - Apply backoff per record.
5. `loadData` overlay: merge the outbox's unconfirmed items for this user and month over the disk answers (extend `localSubmissions.settle`, with one source of truth: the outbox).
6. A banner in `XrayReferrals` reusing `ew_answers_pending_sync` (update the text: no more "every 30 seconds"), `useUnloadGuard` while unconfirmed > 0, and a `clearOwnedStorage` guard.
7. Quick wins C.2 #1 (dedupe), #2 (oversight fan-out) and #3 (single-flight reload). They are small, and they directly cut R2.
8. Telemetry (§F) behind the same flag.

**Phase 2 — the syncer proper:** leader Web Lock plus BroadcastChannel kick, `sent-unverified` confirmation by own-head read, poison classification and quarantine, «إرسال الآن», «تصدير الإجابات غير المرسلة» plus the admin import, the audit batch, and the sync health indicator (`synced / pending n / last success hh:mm / persistent storage yes/no`).

**Phase 3 — load:** the SWR snapshot (C.3), the C.2 #4/#6 behaviour changes (owner decisions), and the legacy distribution-events archive migration bundled with Plan 2's admin migration. Optionally, the per-device outbox status file.

**Plan 2 PR 3** (layout v2 + compaction) proceeds independently. The outbox is format-neutral and works on both layouts. Its flush calls the same append core, which Plan 2 re-routes to per-assignee folders.

---

## E. Implementation plan in this codebase

### E.1 Files

| Action | File | Change |
|---|---|---|
| change | `src/data/answers/answerLocalMirror.ts` | DB v2; `outbox` store; `commitOutboxEvent`, `listOutbox(user)`, `markOutbox(eventId, status, meta)`, `countUnconfirmed(user, month?)`; strict-durability transactions; keep the mirror API. (Rename to `answerLocalStore.ts` only if the owner wants it; renaming means re-registering the module and adds churn.) |
| add | `src/data/answers/outboxSchema.ts` | Record type, `OUTBOX_SCHEMA_VERSION`, the v1→v2 upgrade (mirror `synced:false` → outbox), and pure transition rules (`pending → sending → confirmed | sent-unverified | blocked | quarantined`). |
| change | `src/data/answers/answerStorage.ts` | Extract `buildSelfSaveEvent` (pure) and `landAnswerEvents(dir, month, user, events)`. `performAnswerWrite` and `upsertItemAnswer` wrap them unchanged for the other callers. Add `dedupeInFlight` in `readAllAnswerEventsForMonth`. |
| change | `src/data/answers/pendingAnswerReplay.ts` | Becomes `flushOutbox`: batch per month; no strict all-employee read; backoff; classification; telemetry. Keep the lock design (`:117-173`). |
| change | `src/data/answers/PendingAnswerReplayRunner.tsx` | Leader lock (phase 2), hidden-tab cadence, BroadcastChannel kick, interval from one constant. |
| change | `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx` | `handleSave` local-first path; overlay; banner; single-flight silent load; oversight fan-out. |
| change | `.../XrayReferrals/localSubmissions.ts` | Fed from outbox records (pending and confirmed) instead of an in-memory success map only. Keep the generation rule. |
| change | `src/components/InspectionPanel/index.tsx` | New save-status kinds `local` («محفوظ على هذا الجهاز») and `sent` («تم الإرسال»), derived from outbox status plus `savedAnswer`. |
| change | `src/data/labels/labelsStore.ts` | New keys (below). No inline Arabic. |
| change | `src/data/storage/storageRegistry.ts` | Update the `xray_answers_local_mirror_v1` purpose and lossConsequence text; guard `clearOwnedStorage`. |
| change | `src/data/workspace/workspaceSync.ts` / `dataRefreshSignal.ts` | (phase 3, owner decision) Throttle personal-scope reloads when owners are unknown. |
| change | `src/data/audit/actionLog.ts` | (phase 2) `appendWorkspaceActions(entries[])`; ids minted outside the casLoop. |
| add | `src/data/perf/perfTrace.ts` | Span helper; writes summaries through the existing `logError` sink with `perf:` contexts (durable per-user error log, admin XLSX export already exists). **No new storage.** |
| docs | `docs/architecture/data-system-report.md` | Describe the outbox (browser side). Workspace format unchanged in phases 1–2. |

**New label keys** (proposed wording, owner to confirm):
- `ip_save_status_local`: «تم الحفظ على هذا الجهاز — جارٍ الإرسال إلى المجلد المشترك…»
- `ip_save_status_sent`: «تم الإرسال إلى المجلد المشترك.»
- `ew_outbox_banner`: «{count} إجابة محفوظة على هذا الجهاز ولم تُرسل بعد.»
- `ew_outbox_send_now`: «إرسال الآن»
- `ew_outbox_export`: «تصدير الإجابات غير المرسلة»
- `ew_outbox_unload_warning`: «لديك إجابات لم تُرسل بعد. إغلاق الصفحة لن يحذفها، لكنها لن تصل حتى تفتح التطبيق على هذا الجهاز مرة أخرى.»
- `ew_outbox_blocked_month`: «الشهر مغلق — ستُرسل الإجابة عند إعادة فتحه.»
- `ew_outbox_quarantined`: «تعذّر إرسال هذه الإجابة — يرجى التواصل مع المشرف (رمز: {code}).»
- `settings_storage_clear_blocked_outbox`: «لا يمكن مسح التخزين: توجد {count} إجابة لم تُرسل بعد. صدّرها أولاً.»

### E.2 storageRegistry

- **No new IndexedDB database** in phase 1: the outbox is a store inside the registered `xray_answers_local_mirror_v1`. Its entry's `purpose` and `lossConsequence` must change, because loss now means "unsent answers on this device are lost".
- If the snapshot store (phase 3) goes in the same DB, also no new entry. If the owner prefers isolation, add `xray_answers_outbox_v1` / `xray_view_snapshots_v1` entries. The coverage test (`storageRegistry` test) will demand them.

### E.3 Tests (vitest)

- Add devDependency **`fake-indexeddb`** (verified on npm 2026-10-13: v6.2.5, repo `dumbmatter/fakeIndexedDB`, modified 2025-11-07). Use it per file via `import "fake-indexeddb/auto"` in the outbox tests only. Today the mirror tests explicitly have no IndexedDB (`answerLocalMirror.ts:266-270`).
- `outboxSchema.test.ts`: transitions; v1→v2 upgrade (pending mirror → outbox, eventAt = lastSavedAt); unknown future version is read-only.
- `flushOutbox.test.ts` (with `createMemoryDirectory()`):
  - one append per month for N items
  - idempotent re-flush: same eventIds twice, so the fold has N items, not 2N
  - `unverified` → own-head confirmation
  - MonthClosed → `blocked`, other months continue
  - deterministic poison → quarantine after 3
  - two "leaders" (lock fallback) flushing concurrently → no duplicate effect in the fold
- **Order-correctness test:** a local commit at T1, a supervisor reopen on disk at T2 > T1, then a flush. The fold shows reopened. (Today's replay would wrongly re-submit it; that is the reason the strict pre-check exists.)
- `XrayReferrals` jsdom test: a submit returns before the append resolves; the row shows submitted; a reload before the flush still shows submitted (overlay); `beforeunload` is registered while pending.
- `readAllAnswerEventsForMonth` dedupe test: two concurrent calls make one `readAnswerEventDelta` call; strict and lenient calls do not join.
- Update `answerSaveReadCost.test.ts` expectations if op counts change.
- Snapshot-before-change: none of the report/export builders are touched. The fold is not changed.

### E.4 Edit log, flag, rollback

- **Tier:** phase 1 is **tier 3** (browser-storage format, save semantics, architecture): full gates including `check:complexity` (`XrayReferrals` is already at its `max-lines-per-function` budget, so move logic into `useAnswerOutbox.ts`) and `build`. Quick wins C.2 #1–#3 can ship as their own tier-2 PR first.
- **Version:** a major bump (`v154.0` → `154.0.0`) if it ships before Plan 2 PR 3, which also claims 154.0.0 in its spec. **Coordinate the numbering (Q10).**
- **Feature flag:** one admin-controlled workspace setting `answerSaveMode: "sync" | "shadow" | "outbox"`, read the same way as the sync cadence (`workspaceSync.ts:1119`, `refreshSyncIntervalFromDisk`). It lives in one module (no duplicate state).
  - `shadow`: commit to the outbox **and** await the disk append as today. The outbox is confirmed by the same call. This validates the outbox and its telemetry with today's UX.
  - `outbox`: return at the local commit.
- **Rollback:** set `sync`. The syncer **keeps draining** existing outbox records in every mode, so nothing is stranded. Code rollback to a pre-outbox build: v1 code opening a v2 DB gets `VersionError` and resolves `null` ("no mirror", `answerLocalMirror.ts:126-133`). The mirror is then lost on that browser, and **unsent outbox items wait until a v2+ build is back**. Document this, and require `sync` mode plus an empty outbox before any downgrade.
- **Workspace migration:** **none**. Phases 1–2 append the identical `AnswerEvent` shape to the same `answers.events` segments through the same append core. The optional phase-3 per-device status file is additive (new file, no reshaping). The legacy distribution-events archive (C.2 #7) **is** a workspace migration and follows the policy: admin-prompted, explicit module, archive-not-delete.

### E.5 Open questions for the owner

1. **Wording of the commit point.** «تم الحفظ على هذا الجهاز» is honest. Is it acceptable that a supervisor may not see the answer for a few seconds to ~1 minute?
2. **Hidden-tab flushing.** Is it OK for the syncer to keep writing while the tab is in the background? Today it stops.
3. **PC switching.** Is a manual export plus admin import enough, or is the per-device status file (a new workspace file) wanted in phase 3?
4. **A stable workspace id** for snapshots. Does `workspace.schema.json` carry one, or may the first admin init mint one?
5. **On-behalf, reopen, quality-note** stay synchronous in phases 1–2. Agreed?
6. **Disabling reassign/replace on a stale snapshot** (C.3). Agreed?
7. **Personal-scope reload throttle** when owners are unknown (C.2 #4). Is up to N minutes of delay for a supervisor's on-behalf edit acceptable until Plan 2 lands? What N?
8. **`persistAfterReadFold`** by every employee. Restrict it to supervisor/manager/admin, or rate-limit only?
9. **Audit batching** changes `at` timestamps to commit time (unchanged meaning) but delays their visibility. OK?
10. **Version numbering vs Plan 2 PR 3** (both claim a major bump). Which ships first?
11. Should `clearOwnedStorage` **refuse** or only warn when unsent items exist?
12. Is adding `fake-indexeddb` as a devDependency acceptable (dev-only, not shipped)?

---

## F. Measurement protocol (to run on the slow PC)

Nothing here has been measured. This is how to confirm or eliminate R1–R8.

### F.1 Zero-code checks (PowerShell, on the slow PC, against the share path)

```powershell
$m = "\\<host>\<share>\...\2-samples\<month-folder>\1-main"
(Get-ChildItem "$m\answers.events" -File).Count
(Get-ChildItem "$m\distribution.events" -File -Filter *.json).Count
(Get-ChildItem "$m\distribution.events" -File -Filter *.ndjson).Count
Measure-Command { Get-ChildItem "$m\answers.events" -File | Out-Null } | Select-Object TotalMilliseconds
Measure-Command { Get-ChildItem "$m\answers.events" -File | ForEach-Object { [IO.File]::ReadAllBytes($_.FullName).Length } | Out-Null } | Select-Object TotalSeconds
```

How to read the results:
- `answers.events` count ≫ 64 means R1 and R3 are live.
- `distribution.events/*.json` in the thousands means the legacy-file cost is real.
- The "read all" seconds give an [assumed] lower bound for one cold month read. The browser adds File System Access overhead on top.

Also, **export the error log** (existing admin XLSX export). Look for `answerStorage:answer-save:ladder-dwell` lines (`answerStorage.ts:1000-1004`). If `total=` is small next to the 6–7 minute wait, sleeping is ruled out and I/O is the cause.

### F.2 Telemetry to add (phase 1, behind the flag; written via `logError` with `perf:` contexts)

| Name | Where | Fields |
|---|---|---|
| `perf:load:phase1` | `XrayReferrals.tsx:1281-1308` | total ms; each of the 7 reads' ms; `answers.listCount`, `answers.opened`, `answers.bytes`, `answers.cold` (cache hit?) |
| `perf:load:phase2` | `:1349-1386` | `mirrorTrust` ms, result, painted-at ms since mount |
| `perf:load:phase3` | `:1390-1428` | `sampleMaster` ms/bytes; `distDerive` ms, `source` (fold/checkpoint/cache), legacy json count, segment count; `persistQueued`; oversight answers ms and assignee count |
| `perf:load:overlap` | `loadData` entry | count of loads in flight when this one started; was it superseded? |
| `perf:answers:read` | `readAllAnswerEventsForMonth` | ms, listing ms, entries, opened, sealedSkipped, heads, bytes, strict, joined (after dedupe) |
| `perf:save` | `handleSave` → `performAnswerWrite` | total ms; `ensureWritable` ms; `decide` ms + `blind` + reason; `lockWait` ms (time from request to grant around `appendOnlyEventLog.ts:1298`); `discoverSeq` ms; `knownForListing` count/ms; `reread` ms/bytes; `write` ms/bytes; `verify` ms/attempts/result; `fsInFlightAtStart` |
| `perf:fs:inflight` | counter in `readListedEntry`, `listDirectoryEntries`, `writeSegmentOnce`, `safeWriteJson` | gauge sampled at save start and at each phase boundary |
| `perf:replay:tick` / `perf:outbox:flush` | `pendingAnswerReplay.ts:238` | pending count, months, strict-read ms, per-item ms, outcome counts, lock skipped? hidden? |
| `perf:sync:tick` | `workspaceSync.performSync` | probe ms, answer heads, `ownersUnknown`, families broadcast, number of view reloads triggered |
| `perf:audit:append` | `appendWorkspaceAction` | ms, attempts, file entry count |
| `perf:env` | once per session | `navigator.locks` usable?, `storage.persisted()`, origin (`file:`/`http:`), `deviceMemory`, app version |

### F.3 Script for the owner

1. Set the flag to `shadow` (or enable telemetry only). Sign in on the slow PC, open «حالاتي» cold, and wait for the first paint. Note the wall-clock time.
2. Submit three cases, one after another. Note the wall-clock time per «جارٍ التقديم…».
3. Leave the tab open for 3 minutes (four sync ticks). Then open the admin error-log export.
4. Run F.1 at the same time.

**Confirmation rules:**
- R1: `phase1.answers.opened` ≈ file count, and its ms dominates.
- R2/R3: `load:overlap` > 1, or `sync:tick` shows `ownersUnknown=true` with reloads > 0 on most ticks.
- R4: `save.blind=false` on the slow submits.
- R5: `knownForListing` ms dominates the first save.
- R6: `replay:tick` present with strict-read ms in the tens of seconds, and `save.lockWait` large.

---

*End of study. No repository files other than this report were created or modified.*
