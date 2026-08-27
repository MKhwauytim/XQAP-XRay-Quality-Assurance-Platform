# Employee Answer Saves — Append-Only Rewrite Proposal

**Date:** 2026-08-27 · **Status:** approved by owner (verbal sign-off in session) · revision 3, after TWO independent adversarial design reviews — round 1 found the single-writer premise false, round 2 found two correctness regressions in the round-1 fix (a new shared-write hotspot re-creating the XQ-IO-032 incident, and a legacy-file corruption path) plus confirmed the honest scope was no longer "simpler than distribution." **This revision changes structural approach on the owner's explicit direction: generalize the existing, incident-hardened `src/data/distribution/distributionEventStore.ts` rather than write a parallel implementation.**
**Decision order:** Stage 0 (extract generic primitives from distribution's code, zero behavior change to distribution, validated against distribution's own full test suite) → Stage 1 (answers-specific fold logic on top of the generic primitives, isolated) → Stage 2 (wire read/write) → Stage 3 (validation) → Stage 4 (ship). Each stage is independently revertible. **A third adversarial review is required before Stage 0 begins**, given the stakes of touching a production module.

## 0. History — why this revision looks different from rounds 1 and 2

- **v1** claimed answer files are single-writer and dropped distribution's cross-machine machinery on that basis. **False**: five cross-user write paths exist (quality-note edits, bulk reopen, bulk reassignment, supervisor replacement requests, instant reopens), three of them supervisor bulk loops.
- **v2** restored the machinery, scoped request queues out of the new event stream, redesigned the on-behalf refusal, and fixed the cache-write performance claim. Round 2 found this still had two live defects:
  - **A new shared-write hotspot.** v2's fix for the workspace-sync freshness gap was a single per-month CAS-stamped file bumped by every employee's save — structurally identical to the exact pattern that caused the XQ-IO-032 incident two days ago (`docs/audit/XQ-IO-032_MULTI_MODEL_FINDINGS_2026-08-25.md:470`: *"removing the write from the read path entirely… the herd load is gone, not argued away by ladder arithmetic"*). v2 also mis-cited its own precedent — the actual distribution mechanism for this exact problem is a **read-only** bounded directory-listing signature, zero extra writes.
  - **Legacy-file corruption.** v2 kept the three request queues on the existing whole-file-rewrite path "unchanged," but that path reads via the same loader that also returns folded segment data — so a routine referral request would write the newly-folded item state back into the file v2 elsewhere promises is "never rewritten," corrupting the exact separation the whole design depends on.
  - Round 2's overall verdict, honestly: after two rounds of closing gaps, the design had re-accumulated nearly all of distribution's complexity (writer-session naming, rotation, checkpoint, late-event detection, dedup, cache validation) while writing it a second time, independently — the "simpler than distribution" framing no longer held, and a second independent implementation of subtle SMB-safety mechanics was itself a real risk (four rounds of hard-won fixes already went into the one that exists).
- **This revision (v3)** acts on round 2's own recommendation: don't re-implement the mechanics, **generalize the ones that already work**.

## 1. What actually generalizes vs. what stays domain-specific

Distribution's code has always mixed two concerns: durable, ordered, append-only storage **mechanics** (segment naming, rotation, checkpointing, late-event/duplicate detection), and distribution's own **business logic** (the 7-member `eventType` union, transition-legality table, quota-fact accumulation). Only the first category is reusable — extracting the second would just be a different way of forcing answers into distribution's shape.

**Extracts into a new generic module**, `src/data/storage/appendOnlyEventLog.ts`:
- Writer-session-hashed segment naming (`{deviceHash}-{sessionHash}[-{seq}]`), rotation by size/line cap, per-writer-chain lock, re-read-before-append, post-write size verify — today's `distributionEventStore.ts:192-486`, made generic over the event's shape (a type parameter, not a distribution-specific type) and the directory/suffix (a parameter, not a hardcoded constant).
- Checkpoint shape and the resume/dedup contract: `segmentOffsets`, **`knownEventIds` dedup across the checkpoint boundary** (the exact mechanism round 2 found missing from v2 — `distributionStorage.ts:895-916`), a `deriveVersion` gate, and a generic "domain digest" binding the checkpoint to the specific accumulator state it was built from (distribution's `eventSetId`, generalized to any caller-supplied digest function over whatever the caller considers its identity set).
- Late-event detection: a generic `isEventOutOfOrder(newEvent, lastKnownEventAt, lastKnownEventId)` matching `findLateEvent`'s conservative "missing `lastEventId` counts as late" rule (`distributionDerivation.ts:275-298`), parameterized over how the caller extracts those two fields from its own folded-entry type. On a positive result, the generic module's contract is the same as distribution's: **the caller must do a full refold, never patch in place.**

**Stays in `distributionEventStore.ts` / `distributionDerivation.ts`** (untouched in meaning, refactored only to call through the generic module for the mechanics above): the `AssignmentDistributionEvent` type, `isIllegalTerminalTransition`, quota-fact accumulation, `foldDistributionEvents`'s own business rules.

**Lives in the new `src/data/answers/answerEventStore.ts`** (built on the same generic module): the `AnswerEvent` type (§3 below), `foldAnswerEvents`'s own business rules (upsert-by-id, valueHistory/history append, the append-then-confirm on-behalf protocol).

## 2. Stage 0 — the generalization itself, validated in isolation

This is the highest-risk part of the whole proposal, because it touches code a production incident was fixed in two days ago. The discipline:

1. Extract the generic module with distribution's **existing exported function signatures completely unchanged** — `appendDistributionEventSegment`, `readSegmentTails`, `sortDistributionEventsForFold`, etc. keep their names, parameters, and return types; internally they become thin calls into the generic primitives.
2. **Zero behavior change is the acceptance bar**, proven by running distribution's own full test suite (all 30 files in `src/data/distribution/`, unmodified) against the refactored code and requiring byte-identical pass/fail results — not "still passes," but the same tests, unedited, green.
3. A dedicated before/after diff review: for every distribution test that exercises a fault-injection scenario (`distributionEventSegmentRotation.test.ts`'s "loses no events and writes none twice when the rotation write fails outright", `segmentVerifyNotAFailure.test.ts`, `distributionCheckpointSidecar.test.ts`), confirm the refactored code path is the *same* code, not a re-derivation that happens to pass today's assertions.
4. Only after Stage 0 is independently validated (its own adversarial review, given the stakes) does Stage 1 begin.

## 3. Target write/read model for answers (built on the generic module)

```ts
type AnswerEvent = {
  eventId: string;              // stable per-user-action id (see §4) — NOT a
                                  // fresh uuid per attempt, so a retried
                                  // append after an ambiguous failure is a
                                  // detectable duplicate, not a silent replay
  eventType: "item-saved" | "item-reopened" | "quality-note-set";
  eventAt: string;
  eventBy: string;
  authority: "self" | "supervisor";   // NEW, see §4 — the tie-break the
                                        // round-2 review found missing
  xrayImageId: string;
  answers?: FieldAnswer[];
  status?: "draft" | "submitted";
  answeredBy?: string;
  answeredOnBehalfBy?: string;
  qualityNote?: string;
  eventSchemaVersion?: number;
};
```

Storage: `2-samples/{month}/answers.events/{username}--{deviceHash}-{sessionHash}[-{seq}].ndjson` — **one flat per-month directory across all employees** (not one directory per employee), so the new freshness-signal probe (§6) is a single bounded listing, matching distribution's own layout shape (`distribution.events/`, not `distribution.events.{employee}/`).

## 4. Concurrency and ordering — closing round 2's Finding 1

Writer-session naming (from the generic module) makes two uncoordinated writers physically unable to collide on one segment file — this closes the *lost-write* half of round 2's finding for all five cross-user paths (quality-note edits, bulk reopen, bulk reassignment, supervisor replacement requests, instant reopens), including the two (`item-reopened`, `quality-note-set`) that stayed in the item-event stream after request queues were scoped out.

It does **not**, by itself, guarantee correct *causal* order across machines with clock skew — round 2's correctly-identified gap. **Fix adopted:** fold-time precedence is `authority` first, `(eventAt, eventId)` second. A `supervisor`-authored event always wins over a concurrently-arriving `self`-authored event for the same item, regardless of timestamp skew — this reproduces today's actual observable behavior (a supervisor's reopen/quality-note action is authoritative) without depending on clock agreement between machines. This is recorded as an explicit, intentional business rule in `foldAnswerEvents`, analogous to (but simpler than) distribution's transition-legality table.

## 5. The on-behalf refusal — closing round 2's Finding 3

Append-then-confirm (as in v2), but the confirmation is **scoped to one item**, not a whole-file or whole-checkpoint fold: `foldSingleItem(events, xrayImageId)` replays only that image's events (small by construction — an item accumulates at most a handful of save/reopen/note events per month) to determine whether the append actually took effect under the true fold order. This closes round 2's cost objection (an unbounded refold on every on-behalf save) without weakening the guarantee: the single-item fold uses the same `authority`-then-`(eventAt,eventId)` precedence as the full fold, so its answer is consistent with what a full fold would produce for that item.

## 6. Freshness signal — closing round 2's Finding 5 correctly this time

**No new writes.** Add `safeAnswerSegmentsSignature = boundedSizeSignature(answersEventsDir, ".ndjson")` — a read-only, bounded (top-N by name) directory listing, the same primitive distribution already uses for exactly this purpose (`workspaceSync.ts:411-419`, `directoryScan.ts`'s `boundedSizeSignature`) — feeding the existing `answers` change-signature family in `workspaceSync.ts`. One listing per 45 s tick, zero additional writes, no new shared-file contention. Segment names are prefixed with a sortable time component so an ongoing session's most recent appends are never evicted from the top-N the bounded signature actually stats.

## 7. Request queues — closing round 2's Finding 6a/6b

Round 2 showed keeping the queues on `updateEmployeeAnswerFile` "unchanged" actually corrupts the frozen-legacy-file premise, because that function's read side returns folded (segment + legacy) state, and its write side writes that whole merged object back. **Fix:** give the three request queues their own file, `{username}.requests.json`, split out of `EmployeeAnswerFile` entirely rather than kept inside it. This is a strictly smaller, cleaner change than v2's "leave them where they are": the legacy `.answers.json` stops being written *at all* after migration (truly frozen, as originally intended), the request-queue file keeps today's exact whole-file-rewrite mechanics (low volume, already correct, not worth touching), and `loadRequestLogs`'s read cost (round 2's Finding 6b) drops rather than growing, since it now reads a small dedicated file instead of folding item-event history it never needed.

`loadEmployeeAnswers` becomes a merge of exactly two sources: item state (legacy-seed-or-segments, per §8) and `{username}.requests.json` — still returning the identical `EmployeeAnswerFile` shape to every existing caller.

## 8. Migration marker — closing round 2's Finding 6c

The marker must be **independently durable and immune to a mis-scoped backup restore**, not stored in a rebuildable checkpoint sidecar (round 2's contradiction: v2 named the sidecar as the marker's home in one place and treated it as absent-until-first-checkpoint in another). **Fix:** the marker is the first event ever appended for an employee-month — a `migration-seed` pseudo-event (`{ eventType: "migration-seed", legacyContentHash, at }`) written into `seq 0` of that employee's first segment. Being an ordinary segment event, it is covered by the exact same backup classification as every other event (`merge-events`, not `skip-derived`/`replace`), so a restore can never silently revert or duplicate it. Fold precedence becomes a single unambiguous read: segments present → look for `migration-seed` at the start of the earliest known segment; found → seed from the named legacy content hash once, never again; segments present with no `migration-seed` → pre-v3-rollback residue (see §9) or a corrupted first segment, treated as a hard read failure per §10, not silently guessed at.

## 9. Rollback

Unchanged from v2's plan: reverting resumes writing `.answers.json` directly; a subsequent roll-forward must not re-fold segments written after the revert against a legacy file that has since diverged. Rollback procedure includes renaming `{username}.answers.events/` directories (now `answers.events/` at the month level, per §3) to a `.disabled` suffix, via script, as an explicit step — not left as "nothing to undo," which v1 incorrectly claimed.

## 10. Explicitly not doing

- Not touching `{supervisor}.decisions.json`.
- Not implementing segment compaction, matching distribution's own choice.
- Not defining corrupt-segment recovery beyond "throw" (matching `distributionEventStore.ts:325-338` and this module's own P0-1 "unreadable never becomes empty" contract).
- Not migrating `saveEmployeeAnswers` (whole-array replace) — stays on the legacy path, documented as test/seed-only usage (per round-1 Finding 7c, unchanged in this revision).
- Not touching `adhocHistoricalImport.ts`'s bulk `upsertItemAnswer` loop in Stage 1 — flagged by round 2 as a sixth bulk-writer path; addressed in Stage 2's wiring review, not a Stage 0/1 concern since ad-hoc months are a separate synthetic-folder code path already.

## 11. Validation plan

**Stage 0** (generalization): distribution's own full test suite, unmodified, byte-identical pass/fail against the refactored internals; a dedicated adversarial review of the extraction before Stage 1 begins, focused specifically on "did any distribution behavior change," not on answers at all.
**Stage 1** (answers-specific module, isolated): unit tests for `AnswerEvent` fold logic, the `authority`-based tie-break, `foldSingleItem`, the `migration-seed` marker — zero production call sites touched.
**Stage 2** (wiring): every existing contract test in `src/data/answers/` and every cross-module test enumerated in round 1's research (`answerOnBehalf.test.ts`, `answerValueHistory.test.ts`, `reopenAnswer.test.ts`, `readContract.test.ts`'s P0-1 test, `staleSnapshot.test.ts`, `pipeline.workflow.test.ts`, `InspectionPanel.test.tsx`, `sampleMirrorDropToZero.test.ts`) must pass unmodified.
**Stage 3**: full whole-repo gate, a real before/after latency measurement (append-only save cost, excluding the now-async cache refresh, measured separately), and independent adversarial validation of the diff before it ships.

This proposal will get a **third** design review before Stage 0 begins, given that Stage 0 modifies a production module with recent incident history — the highest-stakes single step in this whole plan.
