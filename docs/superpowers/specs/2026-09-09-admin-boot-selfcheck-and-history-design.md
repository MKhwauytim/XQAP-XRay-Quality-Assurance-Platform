# Admin boot self-check, and event-derived action history

**Date:** 2026-09-09
**Status:** approved by owner (in chat, 2026-09-09)

Two changes, decided together because both answer the same production evidence:
the 2026-09-08/09 error-log export. They are independent in code and ship as
separate commits.

---

## Part 1 — Event-derived action history

### The problem

The 2026-09-03 owner requirement: before a mutation overwrites a template, an
answer, or a distribution assignment, keep what it was about to replace, so it
can be inspected or put back.

As built, every such mutation writes a separate file at
`5-system/history/{family}/{month}/{user}/{xrayImageId}/{36-char timestamp}.json`
— about 115 characters relative to the workspace root. On the deployment in the
error log the workspace root already sits ~146–166 characters into a UNC share,
so the path crosses Windows' 260-character cap. **The feature has therefore never
worked for `answers` or `distribution` on that workspace.** v135.1 made that
failure free (a construction-time path budget) rather than expensive, but free
and absent is still absent.

### The insight

For `answers` and `distribution` the snapshot is **duplicate state**. The
pre-change state it copies is already on disk, immutably and permanently:

- `2-samples/{month}/1-main/answers.events/*.ndjson` — append-only, never pruned
- `2-samples/{month}/1-main/distribution.events/{eventId}.json` — immutable by contract

Folding those logs to the point *before* event N reproduces exactly what the
snapshot stored. So the writer is not just failing — it should not exist.

`templates` is the genuine exception: a template save is a whole-file overwrite
with no event log behind it, so it keeps a real file.

### Design

**Writers.** Delete `recordActionHistorySnapshot` from `answerStorage.ts` (both
call sites) and `distributionStorage.ts` (including the extra
`loadDistributionLog` read that exists only to feed it). Keep it for
`templates`, with the API narrowed from `scopeParts: readonly string[]` to
`recordId: string`, so a caller cannot express nesting.

**Templates layout.** One file per record — `5-system/history/templates/{templateId}.json`
holding `{ templateId, revision, _writeToken, snapshots: ActionHistorySnapshot[] }`
capped at `ACTION_HISTORY_RETENTION_COUNT`. Pruning becomes an array slice, so no
`listDirectoryEntries` / `removeEntry` pass. Written under `casLoop`, because two
admins on two machines can edit the same template — the object shape (rather than
a bare array) is what lets `revision` and `_writeToken` be embedded and verified,
matching `audit/actionLog.ts`.

Worst case relative path: `5-system/history/templates/tmpl-1787457917309-ngm1iq.json.tmp.crswap`
= 68 characters, well under the 94 budget v135.1 established.

**Readers.** New `src/data/history/actionHistoryReaders.ts`:
- `loadAnswerActionHistory(dir, month, username, xrayImageId)` — folds that
  item's answer events, emitting the folded state before each event, newest
  first, capped at 10.
- `loadDistributionActionHistory(dir, month, xrayImageId)` — cumulative prefixes
  of that id's distribution events.
- `loadTemplateActionHistory(dir, templateId)` — reads the file.

Requires exporting `readAllAnswerEventsForMonth` and `eventsForEmployee` from
`answerStorage.ts` so the reader folds the same input the deleted writer folded.

**Migration.** None, and deliberately so. The legacy `5-system/history/` tree is
left in place, read-only — the same treatment the legacy `feedback/` and
`Population/` roots already get. Consolidating it would mean re-reading thousands
of small files over SMB, many of which are unopenable from a machine whose mount
is deeper than the one that wrote them, to produce a second copy the app never
reads. On the affected share the tree is nearly empty anyway: the writes failed.

### Regression guards

- `actionHistoryPathBudget.test.ts` (exists, v135.1) — extended for the new shape.
- `actionHistory.test.ts` — "never nests": after 12 template snapshots the
  templates directory holds exactly one file entry and zero directory entries.
- `answerHistoryNoWriter.test.ts` (new) — with a fault injected that rejects any
  name ≥30 characters, three saves and one on-behalf save all return `ok`, log
  NO `actionHistory:record` or `safeWrite:writeText` row, and `5-system/history`
  is never created. Re-adding a writer to the answer path fails all three.
- `distributionStorage.test.ts` — an append creates nothing under
  `5-system/history`, and `loadDistributionLog` is called once, not twice.
- Reader parity — three saves produce two snapshots whose `state` deep-equals the
  fold computed before each event.

---

## Part 2 — Admin boot self-check

### The problem

Damaged, orphaned and missing workspace files are today discovered only when
something happens to read them, reported only to whoever is looking at the
screen, and repaired only if an admin knows to visit a Settings panel nobody
told them about. The production log is the proof: one damaged template ran for
eighteen hours across every user.

### Design

A boot phase that runs **only for `admin`**, after the workspace mounts,
registered as a boot source so `BootSplashOverlay` shows it like any other.

**Scan** reuses the inspectors already in the repo — this adds orchestration,
not new diagnosis:

| Check | Source | Auto-fix |
|---|---|---|
| Template live file damaged | `inspectAllTemplateFiles` | rewrite from `.bak`/`.tmp` |
| Decision file damaged | `inspectMonthDecisionFiles` | rewrite from `.bak`/`.tmp` |
| Orphaned `.bak`/`.tmp` with no live file | new `orphanSiblings.ts` | archive the sibling |
| Required workspace file missing | `workspacePaths` + defaults | recreate from defaults |
| Referential integrity (answers → samples) | `orphanScan.ts` | **report only** |

**Repair** is automatic (owner decision, 2026-09-09) for the first four rows.
Every original is archived, never hard-deleted, following the precedent
`decisionFileRecovery.ts` and `templateFileRecovery.ts` already set.

This reverses `templateFileRecovery.ts`'s stated doctrine — *"never repair
silently on read... a repair nobody asked for, on data nobody has verified, is
worse than the outage"*. The reversal is deliberate and bounded: admin-only, at
one known moment rather than on every read, and it reports everything it did.
That module's docblock must be updated to say so rather than left contradicting
the shipped behaviour.

**Report** is a modal listing three groups: repaired, could not repair, and
needs attention (the referential findings). Shown once per boot, only when the
scan found something. Dismissible; nothing blocks.

**Failure policy.** The scan is best-effort and must never block sign-in. A
failing check is caught, logged, and rendered as "could not check" — a boot
source left in `error` deliberately does not block `allLoaded`, which is the
existing contract in `bootProgress.ts`.

### Regression guards

- Scan is not run at all for non-admin roles.
- A damaged template is repaired and appears under "repaired".
- An orphaned `.bak` is archived, and a subsequent `safeReadJson` reports
  `missing` with no `storage:bak-recovery` logged.
- A scan that throws does not prevent `allLoaded`.
- The modal does not render when the scan found nothing.

### Deliberately out of scope

- Repairing referential-integrity findings. Auto-rewriting broken data links
  could destroy real records; these are reported for a human.
- Any repair of `*.actions.json` audit files, whose orphan origin is still
  unestablished (see the 2026-09-09 PR #168 discussion).
