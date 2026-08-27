# Employee Answer Saves — Append-Only Rewrite Proposal

**Date:** 2026-08-27 · **Status:** approved by owner (verbal sign-off in session) · revision 2, after an independent adversarial design review found the v1 draft not ready to implement · **Scope:** `src/data/answers/answerStorage.ts` and every reader/writer of item-answer/reopen/quality-note events. Referral/replacement/reopen **request queues stay on the existing whole-file path** — see §6.
**Decision order:** Stage 1 (isolated new storage primitives, zero production risk) → Stage 2 (wire read/write, dual-format) → Stage 3 (validation) → Stage 4 (ship). Each stage is independently revertible.

## 0. Why this needed explicit sign-off before starting

This exact change — "per-item answer-file splitting" — was evaluated once already and explicitly declined: `docs/audit/XQ-IO-032_MULTI_MODEL_FINDINGS_2026-08-25.md:488`, *"Explicitly do not: … implement per-item answer-file splitting (tier-3 data-format change overlapping the owner-gated Phase C/D sequence)."* It was also the **original spec** (`docs/archive/03-build-spec-v0.7.md §11A.3-4`, `04-build-spec-v0.10.md`) and was quietly simplified away during implementation with no edit-log entry explaining why, landing instead on the current mutable-file-plus-capped-history-trail design (v47.5, A4). A later design doc states the team's settled position outright: `docs/superpowers/specs/2026-08-03-distribution-performance-and-workflow-design.md:155` — *"Only `distribution.events/` is truly append-only … Applying incremental caching to a mutable file would ship a silent stale-data bug."*

The owner reviewed this history in-session and authorized proceeding.

## 0a. Revision note — what changed after adversarial review, and why

**v1 of this proposal claimed answer files are "single-writer by construction" and, on that basis, dropped distribution's cross-machine machinery (writer-session-hashed segment names, eventAt sort, late-event detection).** An independent design review found that claim false: there are **five distinct cross-user write paths** into one employee's answer data, three of them supervisor-initiated **bulk loops**, not rare edge cases:

- Quality-note edits (`XrayInspectionResults.tsx:477-483`) — a supervisor writes into any employee's file, routinely.
- Bulk reopen (`pendingBulkReopen.ts:55-92`) — one supervisor click loops across N employees' files.
- Bulk reassignment (`submitReassignment.ts:113-140`) — same shape, into the request queues.
- Supervisor-authored replacement requests and instant reopens.

This is exactly the "two machines, no coordination" scenario distribution's segment-naming scheme exists to solve, and `withResourceLock` (Web Locks, per-browser) does not help across machines — the review's cited precedent from this file itself: *"Both would read the same segment text and each write `existing + own lines`, and the second write would drop the first's events — silent loss, not a shared chain"* (`distributionEventStore.ts:164-170`).

**v2 (this revision) restores the parts of distribution's design that were wrongly cut**, and fixes six further gaps the review found (non-deterministic fold steps, a migration seed that can double-apply history entries, a performance claim that didn't survive the derived-cache write, and a blind spot that would have silently killed cross-machine live-refresh for answers). Every §-numbered section below reflects the revised design; nothing from v1 should be implemented as originally written.

## 1. Right-sized still means something — what's actually kept simple

Even after restoring the concurrency machinery, this is not a blind port of `src/data/distribution/`:

- **Scope is narrower.** Only item-answer save/reopen/quality-note events move to the new format (§6). The three request queues (`referralRequests`/`replacementRequests`/`reopenRequests`) stay on the existing whole-file path — they're low-volume, already `requestId`-idempotent, and the file they live in gets smaller (and thus cheaper to rewrite) once item events move out, for free.
- **No multi-source merge complexity.** Distribution merges three historical layouts (legacy compat log, legacy per-event files, current segments) because of its migration history. Answers only ever had one prior format (the current mutable file), so there are exactly two sources to merge: the legacy file (read-only, frozen at its last pre-migration state) and the new segment stream.
- **No `eventSchemaVersion`-gated transition-legality table.** Distribution's fold enforces legal state machine transitions (`assigned → completed → …`) because distribution events can arrive from many uncoordinated writers with a wide time skew. Answer events have a much simpler state space (draft/submitted per item, with reopen as the only "undo"), and the review confirmed the actual risk is ordering, not illegal transitions — addressed in §3.

## 2. Current state and cause

### Before

- One file per employee per month: `{username}.answers.json`, holding `items[]` (per-item current answer + a capped 20-entry `valueHistory` + an uncapped `history` for reopen/on-behalf actions), plus three request queues.
- Every write — `upsertItemAnswer`, `upsertItemAnswerOnBehalf`, `reopenItemAnswer`, `setItemQualityNote`, and the three `append*ToEmployee` queue writers — funnels through one choke point, `updateEmployeeAnswerFile` (`answerStorage.ts:176-256`), a **full read, full rewrite** of the entire file inside a `casLoop` tuned to 14 retries × 150 ms base.
- Measured cost (this session's own investigation, real numbers against the actual code): **9 whole-file passes per save attempt**, growing with the employee's accumulated answer count — 125 ms median at 10 items, 348 ms at 1,000 items, in-memory; each pass is a full network round-trip carrying the whole file on a real SMB share.
- File System Access API has no true append primitive — a "small append" still means read-existing + concatenate + full rewrite of whatever's open (confirmed against `distributionEventStore.ts:352-362`), which is why segment rotation bounds the rewrite unit instead of leaving it unbounded.

### After

- One append-only segment directory per employee per month, `{username}.answers.events/{deviceHash}-{sessionHash}[-{seq}].ndjson` — **writer-session-hashed names, restored from distribution's actual scheme** (`distributionEventStore.ts:192-229`), not the plain incrementing sequence v1 proposed. One JSON line per item-save/reopen/quality-note mutation, capped per-segment size/line count so a save's rewrite cost is bounded by the open segment, never by the month's total.
- A derived cache is **not** written on the save path (§5 — this is the central fix to the performance claim). Reads fold on demand from a checkpoint, and the checkpoint/cache pair is refreshed **after** a write, off the critical path, debounced.
- Every existing reader (`loadEmployeeAnswers`, `loadAllEmployeeFiles`, and everything downstream) keeps its exact current function signature and return shape — `EmployeeAnswerFile`.
- Legacy `{username}.answers.json` files are never rewritten or deleted. A recorded migration marker (§4), not file-existence inference, decides whether a month's fold seeds from the legacy file or from the segment stream alone.

## 3. Target write/read model

```ts
type AnswerEvent = {
  eventId: string;              // evt-<uuid>
  eventType: "item-saved" | "item-reopened" | "quality-note-set";
  eventAt: string;               // ISO, caller-supplied at append time — fold
                                  // steps take timestamps from HERE, never
                                  // from `new Date()` inside a fold function
                                  // (v1's bug — see §7 Finding 3)
  eventBy: string;
  xrayImageId: string;
  answers?: FieldAnswer[];
  status?: "draft" | "submitted";
  answeredBy?: string;
  answeredOnBehalfBy?: string;
  qualityNote?: string;
  eventSchemaVersion?: number;
};

// Fold is pure, no I/O, but is NOT a naive input-order replay:
// 1. Sort by (eventAt, eventId) before folding — restores the ordering
//    guarantee v1 dropped (§7 Finding 2). Single writer-session segments
//    are already append-ordered; the sort only matters across sessions/
//    writers, which DO exist (§0a).
// 2. Each folded item tracks lastEventAt/lastEventId (new fields — see
//    §7 Finding 2b) so a resumed-checkpoint fold can detect a late event
//    arriving out of order and force a full refold, mirroring
//    distributionDerivation.ts's findLateEvent, instead of silently
//    applying events in the wrong order.
// 3. valueHistory/history snapshot timestamps come from event.eventAt,
//    not wall-clock-at-fold-time.
function foldAnswerEvents(
  events: readonly AnswerEvent[],
  resumeState?: EmployeeAnswerFile
): { file: EmployeeAnswerFile; requiresFullRefold: boolean };
```

### The on-behalf refusal cannot be a pre-check anymore (§7 Finding 3)

Today, `upsertItemAnswerOnBehalf` refuses (writes nothing) if the item is already `submitted`, checked **against the exact bytes about to be overwritten inside the same read-modify-write** (`answerStorage.ts:161-169`) — the whole point being that a check-then-write split has a race window. An append-only log has no "bytes about to be overwritten" to check.

**Resolution: append-then-confirm.** `upsertItemAnswerOnBehalf` appends its event unconditionally (inside the writer-session lock), then immediately folds the just-appended event on top of a fresh read of current state. If the fold determines the item was already `submitted` at a point in the true event order that precedes this append, the event is marked `superseded` in the fold's own bookkeeping (not deleted — it's durable and immutable) and the caller is told `{ ok: false, error: "..." }`. This is cheaper than today's casLoop (one append + one confirm-read, vs. a read-modify-write retry ladder) and closes the exact race the original check protected against, since the confirmation reads the true post-append order rather than a pre-append snapshot.

## 4. Concurrency model

- **Segment naming restores distribution's `{deviceHash}-{sessionHash}[-{seq}]` scheme** (`distributionEventStore.ts:48-76, 192-229`) — `deviceId` persists in `localStorage`, `sessionId` is fresh per module load. This is what makes two uncoordinated writers (an employee's own tab and a supervisor's on-behalf/bulk-reopen/quality-note session) physically incapable of targeting the same segment file, closing §0a's race at the naming layer rather than relying on a lock that only serializes within one browser.
- The append path still uses `withResourceLock` scoped to the writer's own segment chain (matching `distributionEventStore.ts:410`) for same-tab/same-session serialization, and still re-reads the open segment immediately before appending.
- No `casLoop` on the event append itself — appends are naturally non-colliding by construction (distinct writer-session files), so there's no shared-state read-modify-write to protect. This removes the casLoop-verify-throw fragility class (XQ-F-05 / XQ-IO-032 finding S2) from the answer-save path rather than needing to defend against it.
- The derived cache write is **not part of the write's critical path** (§5) and is a plain `safeWriteJson`, no CAS, matching `distribution.current.json`.

## 5. Performance design — the actual bottleneck was the cache, not the segment

The adversarial review's central finding: writing `{username}.answers.current.json` with plain `safeWriteJson` on every save, containing an **uncapped** value-history trail, does not fix the complaint — it relocates the same unbounded whole-file-rewrite cost from the legacy file onto the cache, and makes it larger. Fixed as follows:

1. **Cache is not written on the save path.** A save appends its event (bounded cost, §4) and returns. The cache is refreshed **after** the write completes, off the critical path — matching this codebase's own A6b doctrine (`reopenAnswer.ts:119-122`: refresh caches after writes, never on reads) and `ensureMonthWritable`'s constraint that a **closed month's readers** (Reports, Archive, Power BI export) must never attempt a write. A stale-but-present cache is refolded on the next read if its checkpoint doesn't match the latest known segment state; a missing cache triggers a full fold from segments + legacy seed.
2. **`VALUE_HISTORY_CAP` (20) still applies to the folded/cached output.** The raw segment log is the uncapped source of truth (a real improvement — no data is discarded at append time), but `foldAnswerEvents` caps `valueHistory` in what it returns to callers, exactly as today. This keeps every downstream reader's memory profile (reports, exports, the UI) identical to today's, while still gaining a genuine benefit: a full, uncapped history is now recoverable from the segment log if ever needed, where today it's permanently lost past 20 entries.
3. **`bumpWorkspaceEpoch` fires after the durable append confirms** — not after the cache write, and not before. This matches today's exact ordering guarantee (epoch never advances ahead of readable data) with "readable" now meaning "present in the segment log," which is durable before the cache exists.

## 6. Scope: request queues stay on the legacy path

The adversarial review recommended splitting the three request queues (`referralRequests`, `replacementRequests`, `reopenRequests`) out of the new event stream, for three concrete reasons this proposal adopts:

- They're the exact path supervisor bulk-reassignment loops write through (`submitReassignment.ts`), so folding them into the same segment stream as item-save events would import the highest-risk cross-writer path into the highest-volume stream, rather than keeping the (already-safe, already-CAS-protected) queues isolated.
- Their `requestId` idempotency is only useful if a failed append is *known* to have failed and can be safely retried — true today (casLoop detects and retries), not true if silently folded into a stream designed around append-and-move-on.
- They're low-volume (a handful per month vs. ~6,500 item-save events), so sharing a fold accumulator with item events would make every request-queue read (`loadRequestLogs`, called across `ew/referral-approval`, `ew/xray-referrals`, Reports) pay the cost of folding the entire item-event history to find a handful of requests.

`appendReferralToEmployee` / `appendReplacementToEmployee` / `appendReopenToEmployee` keep using `updateEmployeeAnswerFile` exactly as today. Their whole-file-rewrite cost gets strictly cheaper under this change anyway, since `items[]` moves out of the file they're rewriting.

**Consequence accepted explicitly:** one employee-month's answer data now lives in two places with two update protocols (segments for items, legacy file for requests), and `loadEmployeeAnswers` must merge them into one `EmployeeAnswerFile`. This is bounded, testable complexity (a fixed two-source merge, not an open-ended one), traded deliberately against the unbounded correctness risk of the unified-stream alternative.

## 7. Migration, rollback, and the workspace-sync signal

### Migration marker, not inference

A month's fold must unambiguously know whether to seed from the legacy file or not. **Do not infer this from segment-directory existence** (a crashed first append can create the directory without landing a line — the review's flagged hazard). Instead, the first successful append for a given employee-month writes an explicit marker into the checkpoint sidecar: `seededFromLegacy: { contentHash, at }` (empty/absent if the employee had no pre-existing file). Fold precedence becomes:

- checkpoint present → resume from its cached state, apply only events after its recorded offsets, **never re-touch the legacy file** (closes the double-apply risk on `valueHistory`/`history` the review identified — those two fields have no dedup and would gain duplicate entries on every double-seed).
- no checkpoint, marker present in a readable partial state → legacy seed + **all** events from offset 0.
- no segments at all → legacy file alone, exactly today's behavior.

### Rollback

A reverted build resumes writing `.answers.json` directly, as today. Left unaddressed, a later roll-forward would fold segment events on top of a legacy file that has since diverged (post-revert edits), double-applying old events and losing new ones. **Rollback procedure therefore includes one explicit step**: on revert, rename any `{username}.answers.events/` directories to `.answers.events.disabled/` (a script, not a manual per-file operation) so a future roll-forward starts a clean migration rather than reconciling divergent history. This is the one piece of "something to undo on disk" v1 incorrectly claimed didn't exist.

### `saveEmployeeAnswers` (whole-array replace) — omitted from v1, addressed here

`saveEmployeeAnswers` (`answerStorage.ts:304-322`) replaces the entire `items[]` array — items not present in the incoming array are deleted. This has no append-only equivalent without a truncate/replace event type, and is semantically different from every other writer in this module. Its only production caller is demo-workspace seeding (`demoWorkspace.ts:1076`), which runs against `createMemoryDirectory()`, never a real workspace — it is exercised by real tests (`pipeline.workflow.test.ts`, `answerOnBehalf.test.ts`) but never by a real user action. **Resolution: `saveEmployeeAnswers` stays on the legacy whole-file path, unconditionally, and is documented as such** — it is not part of the item-event migration, matching its actual (test/seed-only) usage. This must be called out explicitly in the module's docblock so it isn't mistaken for an oversight later.

### Workspace-sync freshness signal (§7 Finding 7a — the blocking one)

`workspaceSync.ts:531`'s `answersSignature` watches file name+size for anything ending in `.answers.json` — the exact suffix legacy files keep forever under this design (§2, "never rewritten"). Left unaddressed, that signature becomes a permanent constant after migration: no error, no test failure, cross-machine "someone else's answer/request just changed" live-refresh silently stops working for every migrated month.

**Fix, decided explicitly (not left as an implementation detail):** add a small per-month CAS stamp file, `answers.stamp.json`, bumped on every segment append across every employee in that month — mirroring how the distribution family already uses a compat-log CAS stamp for the identical purpose (`workspaceSync.ts:165-169`). `workspaceSync`'s answers probe reads this one small stamp instead of scanning every employee's segment directory (which would cost one listing per employee per 45 s tick — rejected as unbudgeted). This is a new, small write on the append path (a CAS bump on a tiny stamp file, not a cache rewrite) and is accounted for in the performance model in §5 as part of "durable append," not as an additional unbounded pass.

## 8. Explicitly not doing

- Not touching `{supervisor}.decisions.json` or the request queues (§6) — scope is item-save/reopen/quality-note events only.
- Not implementing segment compaction, for the same reason distribution doesn't: a closed writer session can't be reliably distinguished from a crashed tab.
- Not changing `revision`/`_writeToken` semantics on `EmployeeAnswerFile` for the legacy-path fields (request queues, `saveEmployeeAnswers`) — those keep their current CAS-loop-based meaning unchanged, since they stay on the legacy path.
- Not defining corrupt-segment recovery beyond "throw," matching distribution's own choice (`distributionEventStore.ts:325-338`) — a corrupt segment line is a hard failure, not a silent skip, consistent with the P0-1 "unreadable never becomes empty" contract this module already guarantees and which must extend unchanged to the fold path.

## 9. Validation plan

Stage 1 (new module, isolated): unit tests mirroring distribution's own test structure (segment rotation, mixed-source fold, late-event detection, writer-session naming collision-avoidance) — zero production call sites touched, zero risk.
Stage 2 (wiring): every existing contract test in `src/data/answers/` and every cross-module test that pins this file's behavior (`answerOnBehalf.test.ts`, `answerValueHistory.test.ts`, `reopenAnswer.test.ts`, `readContract.test.ts`'s P0-1 test, `staleSnapshot.test.ts`, `pipeline.workflow.test.ts`, `InspectionPanel.test.tsx`, `sampleMirrorDropToZero.test.ts`) must pass unmodified, proving the contract didn't change from any caller's point of view. New tests specifically for: the on-behalf append-then-confirm race (two writers, verify only one wins and the loser gets `{ok:false}`), the migration-marker double-apply guard, and `workspaceSync`'s new stamp file actually triggering a refresh across two simulated clients.
Stage 3: full whole-repo gate (tsc, lint, complexity, hex-literals, vendor, release, full test:run, build, bundle-size) plus a real before/after latency measurement using the same methodology as this session's earlier investigation (`createMemoryDirectory()`, real functions, N = 10/100/500/1000 items) — this time measuring the append-only save cost **excluding** any cache write, per §5, plus the cache-refresh cost separately as an off-critical-path number. Plus a second independent adversarial review of the revised design before Stage 1 code is written, and adversarial validation of the diff before it ships.
