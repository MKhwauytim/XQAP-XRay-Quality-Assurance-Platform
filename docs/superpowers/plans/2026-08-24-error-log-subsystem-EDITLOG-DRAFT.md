# Edit-log draft — error-log subsystem plan (2026-08-24)

Per coordinator instruction (this worktree is shared with several other
concurrently-running plan sessions, and direct edits to `docs/edit logs/2026-08-24.md`
and `package.json` were causing repeated conflicts): this file holds the
Why/What-changed/File/Lines prose for the remaining tasks of
`docs/superpowers/plans/2026-08-24-error-log-subsystem-plan.md`, to be merged into
the real edit log (with real version numbers, via `npm run editlog`) by whoever is
reconciling all in-flight plans.

## Status of the 8 tasks

Tasks 1–6 were already committed directly to the shared edit log (before this
protocol change) at versions **v115.3 through v117.5** — see
`docs/edit logs/2026-08-24.md` for their entries. Commits:

| Task | Commit | Subject |
|---|---|---|
| 1 | `cab881eb` | Ambient page/actor context (`errorContext.ts`) |
| 2 | `8ccd671e` | `ErrorEntry` enrichment + sink hook (`errorLogger.ts`) |
| 3 | `279d1771` | `5-system/system-errors/` root + per-user file naming (`errorLogPaths.ts`) |
| 4 | `569352a0` | Per-user CAS-protected error store (`errorLogStorage.ts`, `errorLogTypes.ts`) — TIER 3 |
| 5 | `c1b435fe` | Batching sink (`errorLogSink.ts`, `WorkspaceErrorSink.tsx`) |
| 6 | `5164eb24` | XLSX export builder (`errorLogExport.ts`) |
| fix | `0ba1f6d5` | `errorLogSink.test.ts`: `advanceTimersByTimeAsync` → `runAllTimersAsync` to avoid a cross-test lock deadlock (see below) |
| 7 | `7561b279` | Settings export button (`ErrorLogSection.tsx`, `labelsStore.ts`) |
| 8 (partial) | `f23202ef` | `SECURITY_MODEL.md` addendum + this draft file |

**Note on Task 8's other two files:** `docs/architecture/data-system-report.md`
and `CLAUDE.md` were edited by this session (the two new file-table rows and the
disk-layout/module-table entries described below), but this is a SHARED,
non-isolated worktree and another concurrently-running session's commit
(`844601b3`, "Docs (feedback): document the per-thread layout in
data-system-report, CLAUDE.md and feedbackUnread") captured the full contents of
both files — including this session's error-log edits — before this session got
to commit them separately. Verified: `git show 844601b3:CLAUDE.md` and `git show
844601b3:docs/architecture/data-system-report.md` both contain the
`system-errors/`/`Error log` content described in the Task 8 section below, so
nothing was lost — it just landed under someone else's commit message rather than
this session's own. No further action needed for those two files; only
`SECURITY_MODEL.md` and this draft needed a dedicated commit.

A found-and-fixed test bug, not one of the plan's 8 tasks: the "flushes on a
timer even when the batch never fills" test in `errorLogSink.test.ts` used a
bounded `vi.advanceTimersByTimeAsync(5_000)` that left a nested fake timer
(casLoop's own post-write verify-delay sleep) dangling once the test's `afterEach`
restored real timers. Because `withResourceLock`'s fallback-lock chain
(`webLocks.ts`) is a module-level `Map` keyed only by the deterministic per-user
lock string (not by which `createMemoryDirectory()` instance is in play), that one
dangling promise permanently held the "alice" lock for the rest of the test file,
hanging the 4 tests declared after it (each timing out at vitest's 20s default —
~80s of wall time for the file). Fixed by switching to `vi.runAllTimersAsync()`,
which fully drains the nested timer before the assertion runs; all 8 tests in the
file now pass in ~1.4s. Worth flagging to whoever else in this worktree writes a
`vi.useFakeTimers()` test that goes through `casLoop` (any CAS-protected write)
with a BOUNDED timer advance rather than `runAllTimersAsync` — the same trap is
generic to `casLoop`'s always-present verify-delay sleep, not specific to this
plan's code.

Tasks 7 and 8 below are **implemented and committed** as of this draft (see the
table above for exact commits) —
entries written here instead of the shared log per the protocol change. Their
source/test changes will be committed with a specific `git add` (never
`package.json`, never the edit-log file).

---

## Task 7 — Add (settings): admin export of the workspace-wide error log to Excel

**Tier:** 2

**Why:** The owner requirement is admin-exportable error history from Settings.
`ErrorLogSection` already shows this browser's local ring buffer; this task adds a
button that exports the whole workspace's persisted history (Task 4/6) to Excel,
reusing the existing `view-error-log` feature permission for both viewing and
exporting (and its `canMutate` for clearing) rather than inventing a new permission
id — `userManagement.ts` defaults `view-error-log` to `false` for every non-admin
role and scopes it to the `settings` tab (admin-only by default in `tabCatalog`),
which already matches "admin-exportable" without a broader permission change.

**What changed:** `ErrorLogSection.tsx` gained a `useWorkspace()` read, a
`useLabels()` read, `isExporting`/`exportNotice` state, and a `handleExport`
handler that calls `exportWorkspaceErrorLog(directoryHandle, { includeArchives: true })`,
distinguishing a zero-row export (shown as an explicit "no errors recorded" status,
not a silent success) from a thrown failure (shown as an `alert`-role notice, and
logged to the LOCAL ring buffer only via `logError("errorlog:export", err)` — the
`errorlog:` prefix the sink already drops, so an export failure caused by the same
disk problem the export was trying to read past doesn't queue another doomed write).
The export button (`directoryHandle && (...)`, hidden with no workspace connected)
composes the existing `.ui-btn.ui-btn--primary.ui-btn--sm` primitives
(`src/styles/primitives.css`) rather than hand-rolled color CSS, specifically to
avoid adding a new raw hex literal to `ErrorLogSection.css` and tripping
`check:hex-literals`' regression guard (that file's baseline is 3, already at cap).
Added four label keys to `labelsStore.ts`
(`errlog_export_btn`/`errlog_exporting`/`errlog_export_failed`/`errlog_export_empty`).
The existing behaviour (badge count, expand/collapse, clear gating, 60s refresh, the
local-ring-buffer list) is unchanged — the panel still shows THIS browser's recent
errors; only the new button reaches into the whole workspace.

**File:** `src/components/Sidebar/Tabs/Settings/ErrorLogSection.tsx`

**File:** `src/components/Sidebar/Tabs/Settings/ErrorLogSection.css`

**File:** `src/components/Sidebar/Tabs/Settings/ErrorLogSection.test.tsx`

**File:** `src/data/labels/labelsStore.ts`

**Before:**
```tsx
<div className="error-log-toolbar">
  <button className="error-log-clear-btn" onClick={handleClear} disabled={!canClear}>مسح السجل</button>
  <button className="error-log-refresh-btn" onClick={handleRefresh}>تحديث</button>
</div>
```

**After:**
```tsx
<div className="error-log-toolbar">
  <button className="error-log-clear-btn" onClick={handleClear} disabled={!canClear}>مسح السجل</button>
  {directoryHandle && (
    <button
      className="ui-btn ui-btn--primary ui-btn--sm error-log-export-btn"
      onClick={() => { void handleExport(); }}
      disabled={isExporting}
    >
      {isExporting ? L.errlog_exporting : L.errlog_export_btn}
    </button>
  )}
  <button className="error-log-refresh-btn" onClick={handleRefresh}>تحديث</button>
</div>
{exportNotice && (
  <p className={`error-log-export-notice is-${exportNotice.kind}`} role={exportNotice.kind === "error" ? "alert" : "status"}>
    {exportNotice.text}
  </p>
)}
```

**Verification:** Scoped, not whole-repo (see the session report). `npx vitest run
src/components/Sidebar/Tabs/Settings/ErrorLogSection.test.tsx` — deliberate deviation
from the plan's own Step 7 ("see it in the real app" Chrome/Edge confirmation,
marked "not optional" in the plan): skipped in this session per the coordinator's
protocol-change instruction to avoid the whole-repo/shared-file gate contention;
flagging this explicitly rather than silently skipping it. A follow-up manual
confirmation in Chrome/Edge is recommended before this ships in a release, per
CLAUDE.md's documented history of effect-timing bugs in workspace-readiness-gated
components surviving self-review.

**Lines:** 4 files — `ErrorLogSection.tsx` +~45/-3, `ErrorLogSection.css` +~25/-0,
`ErrorLogSection.test.tsx` +~65/-0, `labelsStore.ts` +4/-0 (approximate; this
worktree is shared with other concurrently-running plan sessions, so a whole-file
`git diff --stat` is not a clean signal — see the v115.5 shared-log entry's note for
the same caveat)

---

## Task 8 — Docs (error-log): sync data-system-report, CLAUDE.md and the security model

**Tier:** 3 (docs-sync + release wrap, per the plan's tier ruling)

**Why:** CLAUDE.md names `docs/architecture/data-system-report.md` as "the
authoritative, detailed reference for every file and path — keep it in sync", and
this plan introduces a new workspace folder family (`5-system/system-errors/`) and a
new data-layer module (`src/data/errorLog/`), both of which needed entries there and
in CLAUDE.md's own disk-layout block and data-layer module table. The security model
doc needed one paragraph so the error log's storage posture (plain, tamperable JSON,
deliberately no hash chain) is recorded as an explicit risk-acceptance rather than
left implicit.

**What changed:**
- `docs/architecture/data-system-report.md` — added two rows to the on-disk file
  table, next to the existing `actions.log.json`/`actions.archive.{year}.json`
  audit-trail rows: `{stem}.errors.json` (per-user live log, 2,000-entry cap,
  archive-before-trim, casLoop 6×100ms) and `{stem}.errors.{year}.json` (per-user
  yearly archive, explicitly no `previousArchiveHash` chain, no migration, rollback
  = orphan the folder).
- `CLAUDE.md` — added `system-errors/` to the `5-system/` line of the disk-layout
  block; added an `Error log` row to the *Data-layer modules* table (`src/data/errorLog/`);
  amended the existing `Error logger` row to describe the ring buffer as the LOCAL
  half of a two-tier log, pointing at `src/data/errorLog/` for the durable half and
  noting the `registerErrorSink` sink-inversion pattern.
- `docs/architecture/SECURITY_MODEL.md` — added addendum `(e)` under §6, dated
  2026-08-24: the persistent error log stores plain, tamperable JSON like every
  other business file (no new trust boundary), deliberately carries no B5-style
  hash chain (diagnostic telemetry about software, not evidence about people), and
  the only bound on what reaches disk is `errorLogger.ts`'s existing 500-character
  truncation.

**Migration/rollback:** No migration and none needed — this task is documentation
only, touching no code and no on-disk format (Task 4 already carries the actual
migration/rollback prose for the new format, recorded in its own shared-log entry
at v117.0). Rollback here is simply reverting the three doc files.

**File:** `docs/architecture/data-system-report.md`

**File:** `CLAUDE.md`

**File:** `docs/architecture/SECURITY_MODEL.md`

**Before:**
```
(system-errors/ undocumented in data-system-report.md and CLAUDE.md; no
SECURITY_MODEL.md addendum for the error log's storage posture)
```

**After:**
```
data-system-report.md: two new file-table rows for {stem}.errors.json /
{stem}.errors.{year}.json, next to the audit-trail rows they were modelled on.
CLAUDE.md: system-errors/ in the disk layout block; new "Error log" row; amended
"Error logger" row.
SECURITY_MODEL.md: new §6(e) addendum, dated 2026-08-24.
```

**Verification:** Scoped, not whole-repo — this task is docs-only (no source or
test files), so no test/typecheck/lint gate applies to it directly; the plan's own
full tier-3 sweep (`test:run`, `typecheck`, `lint`, `check:complexity`,
`check:hex-literals`, `check:vendor`, `build`, `check:bundle-size`, `check:release`)
is explicitly deferred to whoever reconciles all in-flight plans and re-runs the
whole-repo gates after merging, per the coordinator's protocol change.

**Lines:** 3 files, prose-only additions (~15 lines in data-system-report.md, ~4
lines in CLAUDE.md, ~20 lines in SECURITY_MODEL.md)

---

## Notes for whoever reconciles this into the real edit log

- Tasks 7 and 8 above are ready to fold into `docs/edit logs/2026-08-24.md` via
  `npm run editlog -- --tier=2 --append "Add (settings): admin export of the
  workspace-wide error log to Excel"` (Task 7) and
  `npm run editlog -- --tier=3 --append --sync-package "Docs (error-log): sync
  data-system-report, CLAUDE.md and the security model"` (Task 8), each followed by
  pasting this draft's Why/What-changed/File/Lines prose into the generated skeleton
  and running `--sync-package` for Task 8 per the plan (`package.json` bump).
- Task 8's own gate sweep in the plan is the FULL tier-3 sweep run once after ALL
  8 tasks' code exists — this session wrote all 8 tasks' code but, per the
  coordinator's protocol change, only ran gates scoped to its own error-log files
  (see the session's final report for exact commands/results), not the whole-repo
  sweep. Whoever lands this last should run the full sweep
  (`test:run && typecheck && lint && check:complexity && check:hex-literals &&
  check:vendor && build && check:bundle-size`, then `check:release` last) once,
  after merging every in-flight plan, and fix anything that surfaces.
- `git add`/`git commit` for Tasks 7 and 8's own files (never `-A`, never
  `package.json`, never the edit-log file) is this session's responsibility and is
  done separately from this draft — see the session's final report for the exact
  commit hashes.
