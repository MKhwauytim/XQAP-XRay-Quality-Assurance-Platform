# Full-sweep audit findings — hardening-2026-07-08

**Branch:** `feature-batch-2026-07-08`
**Date:** 2026-07-12
**Scope:** Read-only whole-codebase sweep. Areas already covered by prior work
(CSS tokens, CI/build/vendoring, focus-trap a11y, workflow/component tests, XSS
escaping in report builders, permission-matrix inheritance, and cross-machine
CAS-safety for the 8 casLoop consumers) were **not** re-audited.

Findings are ranked by severity per the rubric:
**data-loss/crash > silent-wrong-behavior > UX/hygiene > dead-code.**

---

## Severity-ranked findings

### S1 — `users.permissions.json` written with no lock, no CAS (multi-admin lost update) — DATA-LOSS
**File:** `src/data/workspace/userSync.ts:82` (`syncUserManagementToDisk`)

Writes the whole user/permission/password-hash file as a full-state replace of
the calling machine's in-memory `UserManagementState`. It reads only the prior
`metadata` (for the revision counter) — there is **no `withResourceLock`, no
casLoop, no read-back verify**. This is the one shared-workspace RMW file that
the concurrency-hardening pass did not touch.

**Failure scenario:** Admin A on PC-1 resets user X's password (or adds user Z);
Admin B on PC-2, whose in-memory state predates A's change, deactivates user Y
and saves moments later. B's write is a complete replace built from B's stale
snapshot, so A's password reset / new user Z is silently overwritten and lost.
Because the payload carries Argon2id hashes, a lost password reset is also a
security-relevant regression. `.bak` safety exists (writeJsonFile → safeWriteJson)
but does not help a lost-update race.

---

### S2 — Feedback log is multi-writer but only same-tab-locked (cross-machine lost update) — DATA-LOSS
**File:** `src/data/feedback/feedbackStorage.ts:44` (`saveFeedback`), `:66`
(`submitFeedback`), `:82` (`replyToFeedback`)

`5-system/feedback/messages.json` is appended to by **any user on any machine**.
`submitFeedback`/`replyToFeedback` do a read-modify-write guarded by
`withResourceLock` — which only serializes writers **within one browser tab**,
not across machines. No casLoop.

**Failure scenario:** User A on PC-1 and user B on PC-2 both submit feedback at
the same time. Both read the list of N messages, each unshifts its own and writes
N+1. Last writer wins → one message (or one reply, or a resolve) is silently
dropped. Lower-value data than S1, but the same structural gap.

---

### S3 — `closeMonth`/`reopenMonth` bypass the casLoop protocol guarding the same manifest — SILENT-WRONG (governance)
**File:** `src/data/population/monthLock.ts:128` (`closeMonth`), `:160`
(`reopenMonth`)

Both do a plain `safeWriteJson(monthDir, MANIFEST_FILE, {...manifest, status})` —
they spread the read manifest forward, so they **do not bump `revision` and do not
stamp `_writeToken`**. Meanwhile `updateMonthStatus`
(`populationStorage.ts:317-352`) writes the *same* `month.manifest.json` inside a
casLoop that verifies only its **own** token/revision on read-back. casLoop detects
a conflict only when *both* writers participate in the token protocol; a
non-participating writer is invisible to it.

**Failure scenario (narrow TOCTOU, un-close):** `updateMonthStatus` (fired
automatically at the end of a distribution/sampling save) reads manifest rev N,
status `sampled`. Before it writes, `closeMonth` on another PC writes
`status:closed` at rev N (no bump). `updateMonthStatus` then writes rev N+1
`status:distributed` with its own token; its verify reads back rev N+1 + its token
→ "success". The close is silently overwritten and a month that should be frozen
history re-opens and accepts writes again, defeating the Tier-1 month-lock. The
reverse order is safe (the casLoop re-reads `status==="closed"` and aborts), so the
window is small — but it exists on every automated status advance.

---

### S4 — Uncaught data load leaves the inspection-results view stuck on a spinner — SILENT-WRONG / UX
**File:** `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayInspectionResults.tsx:156`
(also `:167`)

`loadState` initializes to `"loading"`. The mount effect calls
`void listMonthFolders(directoryHandle).then((monthFolders) => { … setLoadState("ready") … })`
with **no `.catch`**. Every sibling view (`XrayReferrals.tsx:300`,
`EmployeeDashboard.tsx:62`, `Reports/index.tsx:149`) uses
`.catch(logRejection(...))`; this file omits it on both `.then` chains.

**Failure scenario:** `listMonthFolders` rejects (directory permission lost after a
handle goes stale, or a transient FS error). The `.then` never runs, so
`setLoadState("ready")` never fires, `selectedMonth` stays `""` (so `loadData`
early-returns), and the view is pinned on the loading spinner forever with no error
surfaced and no `logError` entry. Unhandled promise rejection to boot.

---

### S5 — Template & report-design index files are multi-writer but only same-tab-locked — SILENT-WRONG (low frequency)
**Files:** `src/data/templates/templateStorage.ts:49` (`saveTemplate` index write),
`:131` (`deleteTemplate` index write);
`src/data/reportDesigner/storage/reportDesignStorage.ts:55` (`saveDesign` index),
`:106` (`deleteDesign` index)

Same shape as S2: the `{templateId}.json` / `{reportId}.json` doc plus its index
entry are written inside `withResourceLock` (same-tab only), no casLoop.
`templates.index.json` / `designs.index.json` are edited by every
supervisor/manager/admin on every machine.

**Failure scenario:** Two supervisors on two PCs each save a new template at the
same instant. Both read index `{t1}`, each appends its own and writes — A writes
`{t1,t2}`, B (never saw t2) writes `{t1,t3}`. The `t2.json` doc file survives on
disk but its index entry is gone, so it is invisible in the picker (orphaned).
Re-saving repairs it. Lower frequency than S1/S2 (concurrent authoring is rarer),
but the doc/index split makes the symptom confusing.

---

### S6 — Auth session activity log RMW is same-tab-serialized only — UX/hygiene (audit completeness)
**File:** `src/auth/authActivityLog.ts:117` (`flushMemoryToWorkspace`)

`5-system/…/activity.log.json` is written by every machine's login/logout/heartbeat.
Writes are serialized by an in-module `writeChain` promise (line 126) — same-tab
only — not casLoop. `mergeEntries` unions by unique session `id`, which softens but
does not eliminate a lost update.

**Failure scenario:** PC-1 and PC-2 both `flushMemoryToWorkspace`. Both read the log
at rev K; A merges its session and writes {…,eA}; B (didn't see eA) writes {…,eB}.
eA is dropped from the persisted audit. Only affects audit-log completeness, not
business data — hence low severity — but it is the same class of gap as S1/S2 and
was missed by the CAS pass (the *action* log `audit/actionLog.ts` got casLoop; this
sibling *auth-session* log did not).

---

## Area 3 — full classification of every `safeWriteJson` call site

Legend: **(a)** casLoop-protected · **(b)** single-writer / derived by design (fine) ·
**(c)** shared multi-writer, NOT casLoop-protected (findings above).

| Site | Class | Note |
|------|-------|------|
| `distribution/distributionStorage.ts:92` (log) | a | casLoop, append-only event log |
| `distribution/distributionStorage.ts:111` (current) | b | derived snapshot of the CAS-protected log; re-derivable |
| `answers/answerStorage.ts:108` | a | casLoop |
| `approvals/approvalStorage.ts:122` | a | casLoop |
| `audit/actionLog.ts:136` | a | casLoop |
| `notifications/notificationStorage.ts:106` | a | casLoop (verified correct — newer consumer) |
| `population/populationConfig.ts:431` | a | casLoop |
| `population/populationConfig.ts:405` | b | fallback default-config write inside load catch; single-shot |
| `population/populationStorage.ts:335` (manifest, updateMonthStatus) | a | casLoop |
| `sampling/sampleStorage.ts:37` | a | casLoop (per done-list) |
| `preferences/browsePresetStorage.ts:99,169` | a | casLoop (per done-list) |
| `population/populationStorage.ts:87,125,224,235,248,255,281` | b | single-admin processing/save op (Phase 1-3) |
| `samples/sampleMirrorStorage.ts:47,58` | b | full-overwrite derived mirror of distribution.current |
| `workspace/labelsSnapshot.ts:38` | b | full-overwrite mirror of one machine's localStorage labels |
| `templates/templateSelectionStorage.ts:40` | b | single "active template" pointer; last-writer-wins acceptable |
| `backup/backupStorage.ts:391,601,604,665` | b | backup is a single operation; auto-state/settings are single-config |
| `reportDesigner/storage/reportDesignStorage.ts:36,112` (doc) | b | per-id doc; index is the (c) risk |
| `templates/templateStorage.ts:28,102,117,137` (doc/selection/bak) | b | per-id doc; index is the (c) risk |
| `auth/authActivityLog.ts:117` | **c** | S6 |
| `feedback/feedbackStorage.ts:44` | **c** | S2 |
| `workspace/userSync.ts:82` | **c** | S1 |
| `population/monthLock.ts:128,160` | **c** | S3 |
| `templates/templateStorage.ts:49,131` (index) | **c** | S5 |
| `reportDesigner/storage/reportDesignStorage.ts:55,106` (index) | **c** | S5 |

---

## Area 1 — Dead code

### Dead files (zero importers anywhere in `src/`)
1. `src/components/Sidebar/Tabs/EmployeeWorkspace/views/EmployeeDashboard.tsx` — a
   full ~200-line view. `EmployeeWorkspace/index.tsx` imports the other four views
   (XrayReferrals, XrayInspectionResults, ReferralApproval, NotificationManager) but
   **not** this one; nothing else references it. (Note: `EmployeeWorkspace/index.tsx:3`
   still imports the `LayoutDashboard` icon, but that is used for the tab config at
   line 45 — it is *not* orphaned.)
2. `src/components/Sidebar/Tabs/ReportDesigner/editor/Toolbar.tsx` — never imported;
   the editor uses `Ribbon.tsx`. The only "Toolbar" references elsewhere are
   `AdminToolbar`, local `QueueToolbar`, and comments.
3. `src/components/ui/Button.tsx` — never imported. (`../ui/*` imports elsewhere point
   at `data/reporting/executive/ui/`, a different directory.)
4. `src/components/ui/StatCard.tsx` — never imported. The entire `src/components/ui/`
   directory is dead.

### Dead subsystem — legacy optimistic edit-lock API (superseded by webLocks + casLoop)
**File:** `src/data/storage/fileSystemAccess.ts`
- `acquireEditLock` (`:395`) — zero call sites.
- `saveJsonWithRevisionCheck` (`:539`) — zero call sites.
- `releaseEditLock` (`:492`) — called only from `saveJsonWithRevisionCheck:605`,
  which is itself dead → transitively dead.

The associated result types (`AcquireLockResult`, `SaveWithRevisionResult`) and the
lock-file read/expire helpers around lines 460-537 exist only to serve this trio.
~230 lines of dead concurrency machinery.

### Dead exports (function bodies present, zero references incl. own file)
- `listMonthSummaries` — `src/data/population/populationStorage.ts:422`
- `loadMainSampleMirror` — `src/data/samples/sampleMirrorStorage.ts:73`
  (`loadEmployeeSampleMirror` is used; the "main" variant is not.)

### Over-exported (used only inside own file — not dead, but `export` is unnecessary)
- `saveFeedback` (feedbackStorage.ts) — only `submit/replyToFeedback` call it.
- `buildSampleReport` (reporting/sampleReport.ts:27) — used at `:381`.
- `loadDistributionCurrent` (distributionStorage.ts:115) — used at `:178`.
- `createReportId` (reportDesigner/reportTypes.ts:150) — used at `:164`.
- `formatMonthShortLabel` (population/monthFolder.ts:47) — used at `:56`.

### Reporting/executive cluster — needs its own pass (NOT all confirmed dead)
~30 exported slide/primitive/token builders under `src/data/reporting/executive/`
show zero references outside their own file:
`deck/slides.ts` (agendaSlide, execSummarySlide, scopeSlide, verdictSlide,
portsSlide, levelSlide, corroborationSlide, driversSlide, topInspectorsSlide,
supportSlide, riskSlide, actionsSlide, decisionsSlide, nextPeriodSlide);
`deck2/index.ts` (buildDeckV2Html, openExecutiveDeckV2); `deck2/slides.ts`
(coverSlide, tocSlide, glossarySlideBuilders, sectionSeparatorSlide,
portPopulationSlideBuilders, portSampleSlideBuilders, stagePortPopulationSlide,
stagePortSampleSlide, qualityPortSlideBuilders, accuracyPortSlideBuilders);
`primitives.ts` (barRow, badgeHtml, heatCell, statPill, noticeBox, pagePanel,
radarSvg); `document/pagination.ts` (paginateRows); `document/shared.ts`
(rightRail); `ui/tokens.ts` (colorVarName, tokensCss); `executiveReportData.ts`
(fmtK). There are **no `export *` barrels** in `reporting/`, so these are genuinely
unreferenced by name — **but** per project memory the deck2 rework is "NOT wired
into app UI yet," so much of this is intentional not-yet-wired scaffolding rather
than rot. Recommend a dedicated triage of this subtree rather than bulk deletion.

---

## Area 2 — Remaining hardcoded Arabic UI strings

Genuine hardcoded JSX/config Arabic literals (verified by sampling — not label-key
lookups; `getLabels()` values live in the `.ts` `labelsStore`, so any Arabic in a
`.tsx` is a hardcoded string). **54 non-test `.tsx` files, ~1592 Arabic-bearing
lines.** CLAUDE.md convention is to route these through `labelsStore.ts`. Highest-
traffic offenders (most end-user visible) to prioritize:

| Lines | File |
|------:|------|
| 172 | `Sidebar/Tabs/Population/index.tsx` |
| 146 | `Sidebar/Tabs/Reports/index.tsx` |
| 114 | `Sidebar/Tabs/Settings/index.tsx` |
| 109 | `Sidebar/Tabs/Population/components/MappingSettingsModal.tsx` |
| 105 | `Sidebar/Tabs/TemplateBuilder/index.tsx` |
| 102 | `Sidebar/Tabs/UserManagement/index.tsx` |
| 75  | `Sidebar/Tabs/Archive/index.tsx` |
| 62  | `Sidebar/Tabs/Population/components/DataAccuracyReport.tsx` |
| 62  | `Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx` |
| 52  | `Sidebar/Tabs/Population/components/PhaseFourDistribution.tsx` |
| 39  | `Sidebar/Tabs/Population/components/PhaseThreeSampling.tsx` |
| 35  | `Sidebar/Tabs/EmployeeWorkspace/views/XrayInspectionResults.tsx` |
| 30  | `Sidebar/Tabs/ReportDesigner/index.tsx` |
| 29  | `ReportDesigner/editor/Inspector.tsx`, `Population/components/PopulationProcessingReport.tsx`, `.../PhaseTwoReportAndProcessing.tsx` |
| 28  | `auth/AuthGate.tsx` |
| 24  | `data/workspace/WorkspaceProvider.tsx` (sibling of the already-fixed WorkspaceGate) |

(Long tail of 38 more files at ≤27 lines each.) This is a known convention debt, not
a bug — listed for follow-up prioritization only.

---

## Area 4 — Error-handling gaps

- **Material:** `XrayInspectionResults.tsx:156` / `:167` — see S4. The only data
  loader in the tree with an uncaught rejection that can wedge the UI.
- **Intentional / fine (not findings):** `reporting/executive/deck2/index.ts:103,130`
  — `.catch(function(){})` inside browser-injected dev-preview script (best-effort
  style persistence). The demo-seed and best-effort background loaders
  (`NotificationBanner.tsx:43`, `labelsStore.ts:313`, `monthLock.ts:68`,
  `labelsSnapshot.ts` catches → `logError`) are documented silent-by-design.
- No empty `catch {}` blocks in application source. All other `.then()` chains
  surveyed carry `.catch(logRejection(...))` or `.catch(() => default)`.

---

## Area 5 — Other correctness red flags

- **`monthLock.ts` un-close race** — see S3 (highest-confidence correctness bug).
- **`XrayInspectionResults.tsx:156` stuck loading** — see S4.
- **Smell only:** `ReportDesigner/index.tsx:375` — `JSON.parse(e.dataTransfer.getData(
  "application/x-rd-field"))` is not wrapped in try/catch. No concrete failure
  scenario in normal use (the payload is produced by the app's own drag source), so
  flagging as a smell, not a bug.
- Clean signals: no `as any` / `@ts-ignore` / `@ts-expect-error` in source; no
  TODO/FIXME/HACK markers; all `eslint-disable` directives carry justifying comments.

---

## Counts per category

| Category | Count |
|----------|------:|
| Storage multi-writer gaps NOT casLoop-protected — class (c) | **6** (S1, S2, S3, S5×2 files, S6) |
| Error-handling: material uncaught-rejection / stuck-UI | **1** (S4, 2 call sites) |
| Dead files | **4** |
| Dead subsystem (edit-lock trio) | **3 functions** (~230 lines) |
| Dead exports (truly unreferenced) | **2** |
| Over-exported (used internally only) | **5** |
| Reporting/executive unreferenced builders (needs triage) | **~30** |
| Hardcoded-Arabic `.tsx` files (non-test) | **54 files / ~1592 lines** |
