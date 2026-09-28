# Corrective plan — field-reported defects & small features (2026-09-28)

Status: approved design (owner, 2026-09-28). Next step: implementation plan via writing-plans.

Ten owner-reported items, root-caused by code reading (file:line evidence below), grouped into
four workstreams that ship as four separate PRs in priority order:

| WS | PR | Items | Why this order |
|----|----|-------|----------------|
| A — Data safety & correctness | 1 | 2 (submit), 3 (population overwrite), 5 (equal totals), 8 (boot false alarm), 9 (progress bar) | Data/trust is being lost in production today |
| D — Selective backup restore | 2 | 10 | Recovery capability; builds on A2's recovery tool |
| B — Feedback performance & export | 3 | 1 | Painful but not lossy |
| C — Report & UI polish | 4 | 4 (stages), 6 (CertScan ports), 7 (daily quota) | Presentation and new capability |

Every PR: failing test per root cause first (TDD), snapshot before touching sampling /
distribution folding / report builders, tier-3 edit-log entry and gates (data-format changes),
`npm run build` before push.

---

## Workstream A — Data safety & correctness

### A1. Submitted answers flip back / are "lost" (item 2)

**Symptom.** Employee presses submit; item stays as-is; later it is either submitted or not;
they submit again, same thing; after refresh unsubmitted answers are gone.

**Root causes (in order of impact).**

1. *Stale background reload clobbers a successful save.* `XrayReferrals` subscribes to every
   refresh broadcast (`XrayReferrals.tsx:1507-1510`). The 45 s tick marks `answers` changed
   whenever *any* employee's segments change (`workspaceSync.ts:632-644`), i.e. nearly every
   tick. A silent `loadData` that began before the write resolves after it and calls
   `setAnswers(answerItems)` wholesale with pre-write data (`:1382`, `:1423/1428/1472`);
   `handleSave` does not bump `loadTokenRef` (`:1532`). The row flips back to pending and the
   panel re-opens (`InspectionPanel/index.tsx:208`).
2. *One attempt can exceed the 30 s budget.* The casLoop deadline only gates new attempts
   (`casLoop.ts:190`). One `appendEventSegment` attempt has three nested ~11 s ladders
   (`appendOnlyEventLog.ts:598-603, 832-848, 655-714`). Every attempt reads the whole month's
   `answers.events/` sequentially (`directoryScan.ts:680-704`), and a new segment chain is
   created per page load (`distributionEventStore.ts:120`, `answerStorage.ts:694-699`), so
   every reload makes every later save slower.
3. *Invisible outcome.* Errors show only in a page-top banner (`XrayReferrals.tsx:563/566/1969`).
   Failed saves are queued in IndexedDB (`answerStorage.ts:882-890`) and replayed only while
   «نتائج فحص الأشعة» is mounted, for the selected month only, never for ad-hoc folders
   (`XrayInspectionResults.tsx:276-279, 349-351, 422-428`); a successful replay neither
   notifies the queue nor clears the draft.
4. *Draft appears lost after refresh.* Drafts are in localStorage
   (`answerDraftStore.ts:28,51-57`) since 7521a9b, but: the key depends on `folderForRow`
   which falls back to `selMonth` for rows missing from `entries` (`XrayReferrals.tsx:1031-1034,
   2169`); after reload auto-select opens `displayEntries[0]` (`:1164`), not the sample the user
   was on; `setItem` failures are swallowed (`answerDraftStore.ts:103`); `pruneAnswerDrafts`
   is never called.

**Design.**
- **Save generation guard.** A monotonically increasing `saveGenerationRef`; every load
  captures it at start. On commit, a load merges instead of replacing: an item this tab
  submitted locally with a generation newer than the load is never downgraded. `handleSave`
  also bumps `loadTokenRef` so an in-flight stale load is discarded.
- **Own-write suppression.** The sync delta for `answers` excludes the current session's own
  segment(s) so an employee's own save does not trigger their own reload.
- **Faster attempt.** Parallelize the segment read (`DIRECTORY_READ_CONCURRENCY`, 8); reuse a
  stable per-employee-per-month segment chain across reloads (derive chain id from
  `{month, username, deviceId}` — `deviceId` a persisted per-browser id registered in
  `storageRegistry.ts` — instead of the per-page-load session id, so two browsers of the same
  user never share a segment; old per-session segments remain readable — no
  on-disk shape change, reads already fold all segments); thread the operation deadline into
  the inner append/verify ladders so an attempt can't outlive the budget.
- **In-panel status.** The InspectionPanel shows `saving → submitted ✓` / `not saved — retry`
  inline, sourced from `handleSave`'s result (the dead `catch` at `InspectionPanel:240` is
  replaced by a real result contract).
- **App-level replay.** Pending-answer replay moves to an app-level runner (mounted once
  under the workspace provider, all pages), covers every month and ad-hoc folders, and on
  success broadcasts a local `answers` change for that item and clears its draft.
- **Draft robustness.** Draft key uses the row's canonical folder from the sample/ad-hoc
  source (not the `entriesById` fallback); last-open sample id persisted per user in
  sessionStorage and restored after reload; `setItem` failure surfaces a visible warning
  via label key; `pruneAnswerDrafts` wired at app start.

**Tests.** Stale-load-after-save does not downgrade (jsdom); replay success clears draft and
updates row; draft key stable for ad-hoc/retained rows; attempt respects deadline; stable
segment chain across two simulated sessions; reading N segments is concurrent.

### A2. Population re-process orphans the sample (item 3)

**Root cause.** Processing auto-saves (`Population/index.tsx:917-921`); the only guard is a
generic confirm (`:981-1002`, label `population_reprocess_confirm_message`) and
`confirmedOverwrite: true` bypasses the data-layer check (`populationStorage.ts:317-329`).
`population.final.json` is overwritten in place with only a single `.bak`
(`populationStorage.ts:401-410`); source xlsx are overwritten with no backup (`:85-100`).
Reports drive from the population and look up sample/answers by `xrayImageId`
(`executiveReportData.ts:89-212`, `:129`), so any sampled id absent from the new population
vanishes — 0 answers means the new file shares no ids with the sample (wrong month/period).

**Owner decision: block if IDs mismatch.**
- **Data-layer rule** in `saveMonthRun` (enforced regardless of `confirmedOverwrite`): if the
  month has a distribution or any answers, the save is allowed **only if every live sampled
  `xrayImageId` exists in the new population**. Otherwise it is refused with a typed error
  carrying `missingCount` and up to 10 example ids. Month with a sample but no distribution/
  answers keeps today's confirm.
- **Dialog** shows answer count, distribution count, and (pre-computed before save) missing
  count; when blocked it explains why and does not offer continue.
- **Versioned archive before overwrite.** Copy the existing `population.final.json` to
  `2-processed/population.final.{ISO-ts}.superseded.json` (mirrors `archiveExistingRaw`,
  `populationStorage.ts:251-278`), and archive `risk.source.*` / `bi.source.*` the same way.
  New files only; no existing file changes shape.
- **Report fallback.** In `buildExecutiveReportRows`, live sample rows whose id is missing
  from the population are emitted from the `sample.master.json` snapshot rows and flagged
  `fromSampleSnapshot`. Reports / KPI / Report Designer / Power BI export show a label-keyed
  warning banner with the count. Population-wide denominators are unchanged.
- **Integrity check at save and at report time.** `scanReferentialIntegrity`'s
  `sampleOrphans` runs after each population save and when Reports loads a month; non-empty
  result drives the banner.
- **Admin recovery tool** ("استعادة المجتمع السابق", admin only): lists candidates —
  `*.superseded.json` archives, `population.final.json.bak`, and `population.final.json`
  inside each `5-system/backups/*` snapshot — each with its sampled-id coverage
  (x / N). Restoring copies that single file into place via `safeWriteJson` (archiving the
  current one first), then rebuilds the replacement index and aggregate. Never uses the
  whole-workspace `restoreBackupSnapshot`.

**Tests.** Save blocked on mismatch even with `confirmedOverwrite`; allowed when ids are a
superset; archive written before overwrite; report emits snapshot rows + flag; recovery
restores the chosen candidate and rebuilds the index.

### A3. Equal monthly totals under port restrictions (item 5)

**Root cause.** `calculateBulkAssignment` computes targets per stage
(`bulkAssignment.ts:383-388`); if the restricted employee's allowed rows in a stage are fewer
than their share, the surplus goes to others and nothing compensates in other stages. Re-runs
ignore rows already owned (`:296-301`). CertScan branches can override exact per-port values
(`:169-177`, `:203-214`).

**Owner decision: make-up comes from other stages.**
- Compute a **month-level target per employee** = Hamilton split of (already-owned live
  entries + unassigned rows) by the configured weights. Stage allocations remain the first
  pass; per-employee shortfall from a stage (because of port restrictions) carries into the
  employee's remaining stages, taking the surplus from the employees who over-filled.
- **Existing ownership counts** toward the target, so a re-run rebalances unassigned rows
  toward equality instead of drifting.
- Port pass (forced-then-proportional) is kept; after the CertScan split, per-employee
  exact values are reconciled so the last port cannot silently break totals.
- **Preview warning** when an employee's total allowed rows across all stages is below their
  target (the only case totals can't be equal).
- Deterministic by contract: snapshot current outputs for the existing fixtures first; no
  change for runs with no restrictions (asserted).

**Tests.** 4 employees, one excluded from port A holding most of stage 1 → all totals equal
(±1 rounding); unrestricted fixtures byte-identical to snapshot; re-run with prior ownership
converges; infeasible case produces the warning.

### A4. Boot self-check flags the deck-edition file as unrecoverable (item 8)

**Root cause.** `inspectAllTemplateFiles` treats every `*.json` in `6-templates` as a template
(`templateFileRecovery.ts:317-331`) except two hard-coded names; `executive-deck-edition.json`
(`deckEditionPreference.ts:7,23-27`) and `deck2.style-choices.json` (`styleChoices.ts:7,25`)
live there but have no `templateId`/`fields`, so `classifyLive` returns `corrupt`
(`:132`), no sibling qualifies, → `unrecoverable` (`:256`), surfaced by the boot scan
(`bootIntegrityScan.ts:136-174`) since 9c61691. The file is healthy; regenerating it can't help.

**Design.** Owning modules export their file-name constants; `templateFileRecovery.ts`
imports them into a single `NON_TEMPLATE_FILES` set (together with `templates.index.json`,
`template.selection.json`). Additionally, readable JSON lacking a `templateId` is reported as
`not-a-template` (ignored), never `corrupt`. No files move.

**Tests.** `saveDeckEditionPreference` + `saveStyleChoices` then `runBootIntegrityScan` →
`hasFindings === false`; a genuinely torn template is still flagged.

### A5. «متابعة العمل» ignores the case-filter chips (item 9)

**Root cause.** `computePersonalStats` (`XrayReferrals.tsx:754-790`) reads `scopedEntries`
(before the chips) for oversight users — documented as deliberate — and for employees
re-filters `allEntries` by username, bypassing the chips entirely.

**Design.** The strip is computed from `caseFilter.entries` (the same list the table shows):
all / المستهدفة / الاستثنائية. For employees, `caseFilter` is fed the user's own entries so the
same path applies. The strip title appends the active chip label via new label keys
(e.g. «متابعة العمل — الحالات المستهدفة»). The daily-quota tile is **not** filtered (it is a
property of the whole assignment, see C3). Update the code comment that called the old
behaviour deliberate.

**Tests.** jsdom: switching chips changes assigned/submitted/pending counts and title for both
oversight and employee roles.

---

## Workstream B — Feedback performance & export (item 1)

**Root causes.**
- Open reads **every** thread before rendering: `refresh()` awaits `reloadUnread()`
  → `loadFeedback` (all N) before `listThreadSummaries` (`FeedbackWidget.tsx:126-148`),
  then the page effect re-reads P threads already in the provider's `messages`
  (`:325-345`, `FeedbackUnreadProvider.tsx:136-143`), possibly twice as `visibleIdsKey`
  reorders (`:292-323`).
- Submit/reply fire `void refresh(); void reloadUnread();` (`:189-190, :223-224`) → 2×N reads,
  plus N more on the next sync tick.
- Reply deletes `threadsById[msgId]` (`:218-222`) and the reload effect only re-runs on
  `visibleIdsKey` change (`:345`) → card stuck on «جارٍ التحميل».
- `createThread` awaits the best-effort index CAS (`feedbackStorage.ts:368-374`); inner
  `safeWriteJson` calls carry no deadline.

**Design.**
- Panel renders from `threads.index.json` summaries immediately; `reloadUnread` runs in the
  background, not before first render.
- Page bodies come from the provider's in-memory `messages`; only ids missing there are read.
  The page effect keys on a sorted id set.
- Submit/reply: apply the thread returned by `createThread`/`appendReply` optimistically
  (`replyToFeedback` returns it instead of discarding it); remove the duplicate reloads —
  one provider reload, no widget reload.
- Index update after create/resolve is fire-and-forget (still logged on failure); the
  interactive deadline is passed to inner `safeWriteJson` calls.
- New optional thread fields `resolvedAt`, `resolvedBy`, set on resolve going forward
  (additive, optional; older threads simply lack them — no migration needed since no
  existing field changes shape).

**Export (admin, FeedbackWidget "all messages" tab).** New pure builder
`src/data/feedback/feedbackExport.ts` (template: `errorLog/errorLogExport.ts`), zero extra I/O
(uses provider data), Arabic headers via label keys, chunked with `yieldToMain()`:
- Sheet «المحادثات»: thread id, sender, role, category, status, created date, last activity,
  reply count, resolved date/by (field, else approximated from the last reply and marked
  تقديري), original text.
- Sheet «الرسائل»: one row per message (original + each reply): thread id, category, status,
  sequence, author, role, date, text.

**Tests.** Open renders summaries before any thread read (I/O counter on memory directory);
submit performs no full reload; reply renders the new reply without re-fetch; export row
builder unit tests incl. legacy threads without `resolvedAt`.

---

## Workstream C — Report & UI polish

### C1. Stages in Arabic and canonical order (item 4)

**Root cause.** `stageHelpers.ts` has `STAGE_LABELS_AR` / `STAGE_KEY_ORDER` but keeps them
private, so ~8 modules copy them; several report paths group by the raw file text
(`FIRST_STAGE`…) and sort by count or insertion order:
`executiveKpiProfiles.ts:185-199` (fallback), `distributionCoverageModel.ts:98-100,158`,
`managementModel.ts:94-126,175`, `aggregates.ts:413` (via `decisionFactTable.ts:126`),
`sampleStorage.ts:179` (manual-add allocation label), employee table stage cells
(`XrayReferrals/subComponents.tsx:47`, `XrayInspectionResults.tsx:91`).

**Design.** `stageHelpers.ts` exports `STAGE_LABELS_AR`, `STAGE_KEY_ORDER`, and
`compareStageKeys` (first→fourth, `unknown` last). Every stage grouping keys by
`getStageKey(stage, workspace stageMappings)`, labels with the Arabic map, and sorts
canonically. Duplicate maps are deleted and replaced by imports (the worker keeps its copy only
if it cannot import — then a test asserts equality). deck2 `levelIndexForStage` receives the
workspace mappings. Snapshot deck2/document/workbook output first.

**Tests.** Raw `FIRST_STAGE`/`SECOND_STAG` rows produce Arabic labels in first→fourth order in
each model; duplicate-map equality test where a copy must remain.

### C2. Flag whole ports as CertScan (item 6)

**Owner decisions:** port flag means CertScan; a row is CertScan if its port is flagged **OR**
its id is in the pasted list; applies from the next processing (existing samples unchanged).

**Design.**
- `certScanPorts: string[]` (normalized via `normalizePortName`) in population `config.json`
  alongside `employeePortRestrictions`, following the same load-default/merge pattern
  (`populationConfig.ts:398-428`). Additive optional field with default `[]`.
- Admin port picker (reusing the port-restriction modal UI) in Population settings.
- Processing sets `certScanStatus = "Certscan"` when the port is flagged, else the existing
  list match (`certScanParser.ts`). Sampling split and licensed routing then work unchanged.
- Filters: a CertScan chip in the employee case queue (composes with the case chips),
  `certScanStatus` status-filter column in DataTable views, and a CertScan filter in Population
  Browse (worker + fallback path).

**Tests.** Flagged port → all rows CertScan; union with list; unflagged unaffected; filter
predicates; config round-trip with old config lacking the field.

### C3. Stable daily quota — «الحصة اليومية» (item 7)

**Root cause.** `dailyQuota = ceil(sampleCount / max(1, daysRemaining))`
(`distributionDerivation.ts:363-369`) where `sampleCount` is recomputed from live entries and
`daysRemaining` counts calendar days; it moves with every reassignment/replacement and becomes
the whole assignment once the deadline passes.

**Owner rule.** Keep today's deadline (sample month's last day − 3) and today's start (the
employee's first `assigned` event). Count **working days only (Sun–Thu; Fri/Sat excluded)**
from the start date to the deadline, inclusive. `dailyQuota = ceil(assignedCount / workingDays)`,
minimum 1 working day. Frozen: recomputed only when that employee's assigned count changes
(assignment added or removed), never by completion or by the passage of time.

**Design.** `countWorkingDays(start, deadline)` in `src/utils/` (one definition); quota derived
from the assignment facts at the latest assignment-count change, not from `now`. Update
`deriveEmployeeQuotasWithFacts`, the mirror writer (`sampleMirrorStorage.ts:427-437`), and the
tile (`subComponents.tsx:778-793`) whose hard-coded strings move to label keys.

**Tests.** Assigned on the 4th, deadline the 28th, weekends excluded → expected value; value
unchanged after completing items and across days; changes after reassignment; past-deadline →
floor of 1 day.

---

## Workstream D — Selective backup restore (item 10)

**Today.** `restoreBackupSnapshot` (`backupStorage.ts:1778-1860`) restores the whole `json/`
tree of a backup: `assertBackupComplete` → full `pre-restore` rollback backup → restore
sentinel (`RESTORE_INPROGRESS_FILE`) → `restoreJsonTree` walk applying `restoreActionFor`
(`:888-907`: `merge-events` for distribution event segments, `skip-derived` for
`distribution.current`/checkpoint/employee mirrors, `restore-if-absent` for
`distribution.log.json`, else `replace`). The only UI is the Archive tab restore dialog
(`Archive/index.tsx:290`). There is no way to restore one element or one month.

**Owner decision: element × month.**
- **Element catalog** (`src/data/backup/restoreScope.ts`, one definition): each element maps
  to backup-relative path predicates resolved through `workspacePaths.ts` names (never
  hard-coded folder names), with legacy-layout aliases:
  - *Month-scoped:* Population (`1-population/{month}/`), Sample & distribution
    (`2-samples/{month}/1-main/`), Answers (the month's answer event segments / per-employee
    answer files under `2-samples/{month}/`), Referrals & approvals (their month files).
  - *Workspace-wide:* Templates (`6-templates/`), Users & permissions (`3-user-data/`),
    Report designs (`4-reports/`), Feedback (`5-system/feedback/`), System settings (the rest
    of `5-system/` except `backups/`, `audit/`, `locks/`, `system-errors/`).
  - The exact file-to-element mapping is verified against the real tree during planning; a
    file matching no element is never restored by a selective restore.
- **Engine.** `restoreBackupSnapshot` gains an optional `scope?: RestoreScope`
  (`{ elements: RestoreElementId[]; months: string[] }`); absent = today's full restore
  (behaviour unchanged, asserted by existing tests). The walk skips any path the scope does
  not select. Same guarantees as full restore: `assertBackupComplete`, a full `pre-restore`
  rollback backup, the sentinel, and the same `restoreActionFor` semantics per file.
- **Preview.** Before confirming, list per element × month the file count found in the
  backup (and "not present in this backup" for empty selections, which disables confirm).
- **Dependency safety.**
  - Population for a month that has a live distribution/answers: run A2's coverage rule
    (every live sampled id must exist in the backup's population) — blocked otherwise, with
    the missing count.
  - Sample & distribution without Answers (or vice-versa): allowed with a warning; after
    restore, `scanReferentialIntegrity` runs for the affected months and the result is shown.
  - Derived caches for restored months are rebuilt after restore (distribution current,
    replacement index), not copied.
- **UI.** Archive tab restore dialog gets a mode switch «استعادة كاملة / استعادة انتقائية»;
  selective mode shows element checkboxes and a month multi-select (months present in the
  backup), the preview, and the dependency warnings. Admin only; strings via label keys.
- **A2 link.** A2's "restore previous population" backup candidates call this engine with
  `{ elements: ["population"], months: [month] }` instead of their own copy logic.

**Tests.** Scope absent → identical to full restore; population-only for one month touches
only that month's population files; merge-events still applied for a sample-only restore;
blocked population restore on id mismatch; preview counts; rollback backup always created;
sentinel left on partial failure.

---

## Out of scope

- Moving preference files out of `6-templates` (A4 fixes the scanner instead).
- Proposal phases C/D (port-partitioned storage).
- Retroactively re-flagging CertScan on existing samples.
- Holiday calendars beyond Fri/Sat weekends.

## Migration & rollback

No existing workspace file changes shape. New artifacts are additive: `*.superseded.json`
archives, optional `resolvedAt`/`resolvedBy`, optional `certScanPorts`. Stable answer segment
chains write new segments alongside old per-session ones; the fold already reads all segments.
Selective restore adds only an optional parameter. Rollback = revert the PR; older builds ignore the additive fields and still read all segments.
