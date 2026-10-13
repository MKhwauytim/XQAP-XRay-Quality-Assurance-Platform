# Answers compaction, per-assignee layout, and employee load-path speedups

**Date:** 2026-10-13
**Status:** approved by owner in conversation; spec written for plan
**Baseline:** main @ `cbfbf729`, package `153.23.0`
**Tier:** 3 (data format change + migration)

## 1. Problem

Field evidence from a real workspace on an SMB share (employee `hihaloraini`, Oct 11–12 2026):

1. `answers.events/` for one month holds **~2,000 `.ndjson` segment files**. Every employee load lists the folder and opens every unsealed segment; every save re-lists it. This is the "month takes forever to load" symptom.
2. Saves fail in a self-reinforcing loop: a share hiccup (`InvalidStateError` at `close`) makes the append rotate to a new segment, which grows the folder, which slows the next read. One day of logs added ~70 segments (`…-183` → `…-250`).
3. A false `extension-blocked` verdict (`XQ-IO-033`) told the user `.ndjson` is blocked by antivirus. A manual test on the share proved `.ndjson` files are created and survive. The probe (`transientFileErrors.ts` `PROBE_SURVIVAL_WAIT_MS`) flaked on a single name.
4. Five segments from two other devices are listed but unopenable since Oct 11. Every reader re-probes them every ~30 s and logs `XQ-ANS-004` each time.
5. Independently of answers, the employee load path can fall back to a full `sample.master.json` (7,000 rows) read plus a full distribution refold when the per-employee mirror is not trusted, reads **every** employee's `*.requests.json` and every supervisor's `*.decisions.json`, stats every distribution segment, and probes ad-hoc imports unscoped to the month.

The share hiccups themselves are environmental and out of scope. The app must survive them and must not amplify them.

## 2. Goals and non-goals

**Goals**
- An employee's answer load opens a bounded number of files (snapshot + < ~20 live segments), independent of month age or headcount.
- The segment folder stops growing without bound.
- A share hiccup on one save costs one retry, not a new segment and not a wrong permanent verdict.
- Employee month load no longer pays for other employees' files or for a full sample/distribution refold when a trusted mirror exists.
- Nothing is ever hard-deleted. Folded files are archived in place.

**Non-goals**
- Fixing SMB latency per operation.
- Changing the distribution event log format.
- Changing `ItemAnswer`, `AnswerEvent`, or the fold order `(eventAt, authority, eventId)`.
- Making the five quarantined files readable.

## 3. Owner decisions recorded

| Decision | Choice |
|---|---|
| Combine per-assignee folders (B) with compaction (A) | Yes, both |
| Who runs ongoing compaction | The employee's own browser, automatically, own folder only |
| Who runs the one-time flat→per-assignee migration | **Admin only**, prompted on sign-in, confirmed by the admin. Matches CLAUDE.md's post-launch migration policy; no override needed |
| Include the employee load-path fixes (Section 9) | Yes, same spec, separate PR |

## 4. On-disk layout v2

```
2-samples/{month}/1-main/
  answers.events/
    _layout.json                    v2 marker; absent = v1 (flat)
    _archive-v1/                    flat v1 segments, moved untouched by migration
    {assignee}/
      snapshot.json                 JsonEnvelope<AnswerSnapshot>
      {writerBase}[-{seq}].ndjson   live segments, byte-identical format to today
      archive/                      segments folded into snapshot.json, moved by compaction
```

- `{assignee}` is the sanitized `answeredBy` username — the employee whose answers these are. **Every writer appends into the assignee's folder**, whether the writer is the assignee (self-save) or a supervisor (on-behalf). Writer chains stay per `(browser, month, writer)` as today; only the parent directory changes.
- `_layout.json`: `{ layout: "per-assignee", schemaVersion: 1, migratedAt, migratedBy, flatSegmentsArchived: n, assignees: n, unmovable: string[] }`. Written **last** by the migration; its presence is the commit point.
- `AnswerSnapshot`: `{ assignee, monthFolderName, items: ItemAnswer[], legacySeed: { contentHash, items }, foldedOffsets: Record<segmentName, bytes>, foldedEventCount, revision, compactedAt, compactedBy }`. `foldedOffsets` lists every segment (live or archived) whose bytes up to that offset are already inside `items`.
- Paths resolve only through new helpers in `workspacePaths.ts`: `getAnswerEventsLayout(dir, month)`, `getAssigneeAnswerEventsDir(dir, month, assignee, create)`, `getAnswerArchiveV1Dir`, `getAssigneeArchiveDir`. No caller hard-codes names.
- Legacy `{user}.answers.json` seed semantics are unchanged; the seed hash is carried into `snapshot.json.legacySeed`.

## 5. Read model (v2)

`loadEmployeeItemState(dir, month, user)`:
1. Read `{user}/snapshot.json` (may be absent → empty snapshot, offsets `{}`).
2. List `{user}/` live segments. For each, read bytes **past** `foldedOffsets[name]` (0 if unknown). Archived segments are never listed.
3. Fold `snapshot.items` as the starting state, then the delta events in canonical order. Result must equal a full fold of all events from scratch (tested).

Supervisors / reports / `loadAllEmployeeFiles`: list `answers.events/` for assignee folders, then run the per-assignee read above per folder, concurrency 8. `_archive-v1/` and `_layout.json` are skipped. The in-tab `answerEventsCache` keys offsets by `{assignee}/{segmentName}`.

v1 (no `_layout.json`): the existing flat reader runs unchanged.

Mixed-state rule: a month is v1 until `_layout.json` exists, then v2. Writers check the layout once per save (cached per month per tab, invalidated by the sync tick's `_layout.json` probe). A tab that still believes v1 while the admin migrates will have its next append land in the flat folder; the migration lock (Section 6) makes the window explicit, and the migration's final pass re-scans the flat folder for stragglers before writing `_layout.json`.

## 6. Admin migration (one-time, prompted)

Trigger: admin role signs in; `bootProgress` month probe finds `answers.events/*.ndjson` at the flat level and no `_layout.json`. Modal (Arabic label keys added to `labelsStore.ts`): segment count, assignee count, estimate (`segments × ~150 ms`), Confirm / Later. Never automatic, never for non-admin.

Steps, module `src/data/answers/migration/flatToPerAssignee.ts`:
1. Create `answers.events/_migration.lock.json` with `{ by, startedAt, token }` via CAS; if one exists and is < 30 min old, abort with "migration in progress elsewhere".
2. Read every flat segment once (concurrency 8). Group lines by `answeredBy`. Lines with no `answeredBy` fall back to `eventBy`. Unparseable lines are copied verbatim into `_quarantine/_unparsed-v1.ndjson` and counted.
3. Per assignee: fold with the legacy seed (`loadLegacyAnswersFile`) and write `{assignee}/snapshot.json` with `foldedOffsets` covering every v1 segment at its full length. No live segments are created.
4. Move every flat segment into `_archive-v1/` (`move` where the handle supports it; otherwise copy → verify size → remove original only after verification). The five unopenable files are left in place and listed in `_layout.json.unmovable`.
5. Final straggler pass: re-list the flat level; any `.ndjson` written since step 2 is processed through steps 2–4 again.
6. Write `_layout.json`. Remove the lock.

Crash at any point before step 6 leaves the month v1 and re-runnable; files are only ever moved to archive, never deleted. During the lock, non-admin clients read v1 and **defer saves to the pending queue** (`markAnswerPendingLocally`, already exists) rather than appending to a folder being moved.

## 7. Automatic per-assignee compaction

Module `src/data/answers/compaction/compactAssignee.ts`. Runs in the employee's own browser, for their own folder only, after a successful load, when either: live segment count > `COMPACTION_SEGMENT_THRESHOLD` (20) or `snapshot.compactedAt` older than 7 days with ≥ 1 live segment.

1. Candidate set = live segments whose `lastModified` is older than `COMPACTION_QUIET_MS` (10 min) **and** which are not this tab's own open head (`openSegmentSeqByWriter`) **and** whose name is not the highest seq of any writer base present in the folder (another writer's head). This keeps a supervisor's in-flight on-behalf append safe.
2. Fold snapshot + candidate deltas → new `snapshot.json` with updated offsets, `revision + 1`, written via `casLoop` on `revision`. If CAS loses, abort; another tab compacted.
3. Move candidates to `archive/`, same move-or-copy-verify rule as Section 6. A segment that fails to move stays live; its offset in the snapshot already covers its bytes, so the next read skips them.
4. Rate-limited: at most one compaction per (month, assignee) per tab per hour.

Correctness invariant (tested): for any interleaving of a compaction and a concurrent append to a non-candidate segment, `read(snapshot, live)` equals `fold(all events ever written)`.

## 8. Save-path hardening (no format change; ships first)

`appendOnlyEventLog.ts`, `transientFileErrors.ts`, `directoryScan.ts`, `answerStorage.ts`:
1. `InvalidStateError` / `NoModificationAllowedError` at `write`/`close` → retry the **same** segment on `SEGMENT_REPLACE_BLOCKED_RETRY_DELAYS_MS` extended from `[20]` to `[20, 200, 1000, 3000]`; rotate only on a confirmed `NotFoundError` of the target after the patient ladder.
2. `extension-blocked` verdict requires the survival probe to fail on **two distinct names** written 1.2 s apart; a single failure yields `unknown` (plain `XQ-IO-027`).
3. Unopenable segments: remembered per `(month, segmentName)` for the session after one failed open ladder; skipped on later scans without re-probing; one `XQ-ANS-004` per session per name, not per scan. Cleared by manual refresh.
4. `MAX_OPEN_SEGMENT_BYTES` 131,072 → 1,048,576; `MAX_OPEN_SEGMENT_LINES` 2,000 → 10,000.
5. `logLadderDwell` unchanged; add `rotationReason` to the segment-rotation log line so future logs say why a rotation happened.

## 9. Employee load-path fixes (no format change; own PR)

1. `beginAdhocReads` (`XrayReferrals.tsx`, `XrayInspectionResults.tsx`) passes the selected month to `loadAdhocEntriesForEmployeeView`.
2. `loadRequestLogs` gains a `{ scopeToUser }` option; employee-role callers read only their own `{user}.requests.json`. Decisions files: memoised per epoch and **not** invalidated by the user's own answer saves (own saves cannot change request state); whole-file read stays, concurrency 8. (A per-file id index was considered and rejected as too invasive for this round.)
3. `isMirrorTrustedForEvents`: short-circuit when the distribution listing's `(count, totalBytes)` signature equals the one stored in the mirror; the per-segment stat runs only on mismatch.
4. `loadOrDeriveDistributionCurrentStrictForRead`: when a read-side refold happens and the caller holds a writable handle, persist `distribution.current.json` + checkpoint behind an opt-in flag `persistAfterReadFold` — on for `XrayReferrals`/`XrayInspectionResults`, off for exports and integrity scans, preserving A6a's "a read never writes" where that invariant matters.
5. `XrayInspectionResults` adopts the same mirror fast path as `XrayReferrals` (`loadEmployeeSampleMirror` + trust check before any `loadSampleMaster`).

## 10. Testing

All with `createMemoryDirectory()`:
- Routing: self-save and on-behalf both land under the assignee's folder.
- Snapshot read parity: `read(snapshot + live)` == full fold, over randomized event sets (deterministic seed).
- Migration: idempotent re-run after crash at each step; unparseable lines quarantined and counted; `_layout.json` absent until the end; stragglers picked up.
- Compaction: never moves a head segment; CAS loss aborts cleanly; failed move leaves a correct read.
- Hardening: `InvalidStateError` at close does not rotate; single probe failure yields `unknown`; dead segment probed once per session.
- Load path: ad-hoc probe receives the month; employee request scan opens only own file; mirror trust short-circuits on matching signature.
- Snapshot tests on any report/export builder touched — none are expected to be.
- Update `answerSaveReadCost.test.ts` expectations and add a v2 variant (≤ 3 opens warm, ≤ snapshot + live cold).

## 11. Rollout

Three PRs, in order, each with its own edit-log entry:
1. **Hardening (Section 8)** — tier 2. Unblocks saves immediately on the current flat layout.
2. **Load-path fixes (Section 9)** — tier 2.
3. **Layout v2 + migration + compaction (Sections 4–7)** — tier 3, release gates, `data-system-report.md` updated, `check:release` version bump to `154.0.0`.

Rollback for PR 3: a workspace already migrated stays readable by v2 code only; the archive preserves every original byte, so a manual rollback is "move `_archive-v1/*` back, delete `_layout.json`". Documented in `docs/architecture/data-system-report.md`.

## 12. Open risks

- `move()` on `FileSystemFileHandle` is not universally available; the copy-verify-remove fallback adds two round trips per file during migration (one-time cost, admin-visible progress).
- A tab that caches "v1" across the migration window appends one event to the flat folder; the straggler pass covers it only if it lands before step 5. Mitigation: the lock defers non-admin saves to the pending queue.
