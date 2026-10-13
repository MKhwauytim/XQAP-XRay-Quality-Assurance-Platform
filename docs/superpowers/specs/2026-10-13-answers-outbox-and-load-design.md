# Local-first answer outbox, calm sync, and unified load-path plan

**Date:** 2026-10-13
**Status:** draft for owner review (design approved in conversation; written spec awaiting approval)
**Baseline:** origin/main @ `3dfe205b` (v153.25 — PRs #215, #217 shipped)
**Tier:** 3 (storage behaviour + IndexedDB schema bump)
**Inputs:** `2026-10-13-local-first-answer-outbox-study.md` (code-grounded study, this branch) and `2026-10-13-answers-compaction-and-load-path-design.md` (main; "Plan 2")

## 1. Problem (owner field report, latest build)

- Opening مساحة العمل takes 6–7 min with < 10k sample rows; Population (50k+) is fast.
- Pressing «تقديم» shows «جاري تقديم الحالة» for 6–7 min; some cases stay unconfirmed and the employee resubmits.

Study findings (code-derived, not yet measured on the slow PC): retry sleeps are **not** the cause (capped 30 s/action). The cost is the file count: `answers.events` holds ~2,000 files; every read lists the folder and opens every newest-in-chain file; the same read runs several times concurrently in one tab (supervisor fan-out, silent reloads, replay runner); the 45 s sync reloads every employee when it cannot tell whose answers changed. Unconfirmed cases: the local copy is made only **after** the share write fails, and the UI shows no pending state after a reload.

## 2. Owner decisions

| Decision | Choice |
|---|---|
| Real-time sync | Not required. Anything that mimics real time and costs load is reworked onto the existing sync interval (default 45 s, admin-editable 15 s–30 min, `syncSettings.ts`). |
| Outbox flush cadence | The **same** sync interval; no new setting. |
| «محفوظ على هذا الجهاز» wording; supervisors see answers after the interval | Accepted. |
| Employee switches PC with unsent items | Export / admin-import of the unsent backlog (rare path; the flush interval normally clears the backlog first). No per-device status file. |
| Outbox vs Plan 2 ordering | Delegated to Claude: outbox + quick wins first, then Plan 2 PR 3. |

## 3. Rollout (4 PRs, each with its own edit-log entry)

1. **Outbox phase 1 + telemetry** (tier 3, flag `sync | shadow | outbox`, default `shadow`).
2. **Calm reads** (tier 2): dedupe the month read, single read for the supervisor view, single-flight reloads, bounded oversight fan-out, replay runner stops strict all-employee reads, sync tick stops reloading everyone when the changed-chain set is unknown (reload only own scope; supervisors on the interval).
3. **Plan 2 PR 3** (tier 3, `154.0.0`): layout v2 per-assignee folders, admin migration, auto compaction — as specified in Plan 2, unchanged except §6 below.
4. **Outbox phase 2**: batch flush of multiple items per month, audit batching, backlog export/import, flip default to `outbox`.

PRs 1–2 change no on-disk format. PR 1 raises the IndexedDB `xray_answers_local_mirror_v1` version 1 → 2 (additive object store).

## 4. Outbox design

**Commit point = IndexedDB.** On submit, build the final `AnswerEvent` (eventId, eventAt fixed now) and write it to the new `outbox` store with `durability: "strict"`, then return. UI shows «تم الحفظ على هذا الجهاز» immediately and advances to the next case. No `await` on the share in the submit path.

**Syncer.** One per browser, elected with a Web Lock (`xray-answer-outbox`). On each sync-interval tick, on app start, on `online`/focus, and on a manual «إرسال الآن» button: read the outbox, group by (month, assignee), append the **stored event unchanged** (same eventId and eventAt) in one append per month, then mark `sent`. Because identity is preserved, a double append is harmless: read-side dedupe is by eventId (`answerStorage.ts:517-518`, `answerEventStore.ts:754-766`), ordering `(eventAt, authority, eventId)`. This removes the replay runner's strict all-employee pre-check (`pendingAnswerReplay.ts:313`).

**Failure handling.** Patient backoff, no attempt cap and no deadline; poison items (event rejected as invalid, 5 consecutive structural failures) move to a `quarantine` state, stay visible and exportable, never dropped. A migration lock (Plan 2 §6) simply leaves items queued.

**Visibility.**
- Per case: «تم الحفظ على هذا الجهاز» → «تم الإرسال».
- Banner on `XrayReferrals` / results: «لديك N حالات لم تُرسل بعد» with «إرسال الآن».
- `useUnloadGuard` warns on close while unsent items exist.
- Employee's own `loadData` overlays pending outbox items on remote events, so the queue is correct after a reload, before sync.

**Storage safety.**
- Request `navigator.storage.persist()` at first outbox write.
- `clearOwnedStorage` refuses (with Arabic explanation) while unsent items exist; the registry entry text in `storageRegistry.ts` (currently "no effect") is corrected.
- «تصدير غير المرسل» writes a JSON file; admin import appends through the normal path (idempotent by eventId).
- Outbox schema carries `schemaVersion`; unknown version → read-only, never discarded.

**Scope.** Own-answer submits go through the outbox. On-behalf, reopen and quality-note saves stay synchronous in phase 1 (open question 1).

## 5. Telemetry (ships with PR 1, off by default, enabled from Settings)

Per phase, with `monthFolder`, counts, and ms: `load.listAnswers`, `load.openSegments(n)`, `load.fold`, `load.listDistribution`, `load.loadSampleMaster`, `submit.localWrite`, `flush.batch(n)`, `flush.append`, `flush.verify`, `lock.wait`, `retry.count`. Written to the existing error-log export (`ladder-dwell` lines already present). A PowerShell recipe to count files in `answers.events` / `distribution.events` and time one listing is in the study §F.

## 6. Interaction with Plan 2

- Plan 2 PR 3 routes appends into `answers.events/{assignee}/`. The outbox appends through the same `appendAnswerEventSegment` path, so it inherits the new routing with no outbox change.
- During the admin migration lock, the outbox is the deferral queue Plan 2 §6 relied on (`markAnswerPendingLocally`), so that mechanism is replaced, not duplicated (one place, one name).
- Plan 2 §8 hardening items already merged (#215) stay.
- `persistAfterReadFold` (Plan 2 §9.4) is honoured only for supervisor/manager/admin browsers; employee browsers do not write the shared distribution cache on read.

## 7. Testing

`createMemoryDirectory()` for the share; `fake-indexeddb` (v6.2.5, maintained) as a dev dependency for the outbox.
- Submit returns without touching the share; outbox row exists; kill-before-flush then restart still flushes.
- Same event appended twice → folds once, in both flat and v2 layouts.
- Flush ordering and batching across months/assignees; partial-batch failure leaves unsent items queued.
- Multi-tab: two syncers → only the lock holder flushes.
- Poison item quarantined, not lost; export/import round-trips.
- `clearOwnedStorage` blocked with unsent items.
- Reload overlay shows pending items; banner counts correct.
- `answerSaveReadCost.test.ts` updated; no report/export snapshot changes expected.

## 8. Rollback

Flag back to `sync` restores the synchronous path; unsent outbox items still flush via the syncer (it runs in any mode). No workspace data changes in PRs 1, 2, 4; PR 3 rollback as in Plan 2 §11.

## 9. Open questions (defaults in brackets)

1. On-behalf / reopen / quality-note saves stay synchronous in phase 1? [yes]
2. Syncer keeps flushing while the tab is hidden? [yes, with the interval]
3. Stable workspace id for local snapshots: derive from the workspace schema stamp? [yes]
4. Both Plan 2 PR 3 and this work claim `154.0.0`; this work ships as `153.26.x`/`153.27.x` first. [yes]
5. Audit batching in phase 2 acceptable (audit rows land with the flush, not per submit)? [yes]
