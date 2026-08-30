# Employee Performance Evaluation — Design

**Date:** 2026-08-27
**Status:** approved by owner, ready for implementation planning

## Problem

Two governance data sources already exist — the audit action log (سجل الإجراءات) and
the session activity log (متابعة الأنشطة) — but nothing in the live app turns them into
a performance/timing picture: how fast an employee works, where their idle gaps are,
how many samples they finish per day, and how many hours they actually worked. The
owner wants a new subtab under إدارة المستخدمين that answers exactly those questions,
scoped to timing/pace only (not the existing accuracy/quality model, which stays
confined to the offline executive report).

Separately, متابعة الأنشطة has a confirmed bug: a session restored from a persisted
localStorage session (which SEC-02 keeps alive for up to 7 days specifically so
employees don't need to re-login after closing the browser) is stamped with the
*original* login timestamp as `signedInAt`, not the actual restore/reconnect moment.
An employee who logged in Monday and reopens the browser Tuesday gets a new activity
entry whose duration is computed from Monday's login to Tuesday's heartbeat — 24+
hours of apparent "work." This corrupts both the existing متابعة الأنشطة view and any
new feature built on the same data, so it is fixed as part of this work.

## Scope

**In scope:**
- New "تقييم الأداء" subtab under إدارة المستخدمين (id `performance`).
- Per-employee, per-day: samples finished, effective hours worked, gap detection and
  classification, monthly pace baseline.
- All-employees vs one-employee filter, plus date range, mirroring سجل الإجراءات's
  filter bar.
- Trend chart (samples finished per day), working-hours graph (sign-in → last finish
  per day), gap events table, summary stat cards.
- Fix `authActivityLog.ts`'s stale-`signedInAt`-on-restore bug.
- Read-time sanity guard against historically corrupted activity entries (never a
  destructive rewrite of stored data).

**Out of scope (explicitly deferred, not part of this design):**
- Accuracy/quality metrics (`buildEmployeeProfiles`) — stays exclusive to the offline
  executive report.
- Department as a distinct data-model concept — the owner clarified "department"
  meant the existing all-employees aggregate view, not a new field. No department
  attribute is added to user records.
- Assignment-to-completion turnaround (distribution event timestamps) — effective
  time is defined from sign-in to last finish, not assignment to completion, so
  `src/data/distribution/` is not read by this feature.
- Admin-tunable gap-tier thresholds as a settings UI — thresholds are named constants
  in code for v1; making them admin-configurable is a natural, separately-scoped
  follow-up once the fixed defaults have been used in practice.

## Data sources

No new event types or on-disk schema. Reused as-is:

- **`readWorkspaceActions()`** (`src/data/audit/actionLog.ts`) — `answer-submitted`
  and `answer-submitted-on-behalf` entries give `actor` (employee), `at` (timestamp),
  `target` (sample id), `monthFolderName`. This is the backbone for count, trend, and
  gap timestamps. Both submitted-by-self and submitted-on-behalf-of are counted
  against the *assignee* (`details.assignee` for the on-behalf case), not the
  submitting supervisor — an employee's performance record should not include
  someone else typing on their behalf, and should not silently omit work that was in
  fact done on their behalf by policy.
- **`readAuthActivityLog()`** (`src/auth/authActivityLog.ts`) — first `signedInAt` of
  the day per employee, after the historical sanity guard (below) is applied.

## Calculations

New pure module: `src/data/performance/` (mirrors the existing per-domain layout of
`src/data/audit/`, `src/data/answers/`, etc. — pure selectors over already-loaded
data, no new storage format).

Per employee, per calendar day (day boundary = local calendar day of the *employee's*
own timestamps, consistent with how the rest of the app buckets by day):

- **Samples finished** = count of qualifying audit entries (see Data sources above)
  for that employee on that day.
- **Effective time (hours worked)** = `lastFinishTimestamp − signInTimestamp` for
  that day. If the employee signed in but finished 0 samples, effective time is
  `null` (rendered as an explicit empty/neutral state), never `0` — a day with zero
  finishes is "no data," not "worked zero hours," matching the app's existing
  "never show a misleading zero" convention (`kpiCharts.ts`).
- **Gaps within the day**: sort that day's finish timestamps ascending. The first gap
  is `signIn → firstFinish`; each subsequent gap is `finish[i] → finish[i+1]`. Gaps
  never cross a calendar-day boundary — each day's gap sequence starts fresh at that
  day's sign-in, regardless of when the employee last finished a sample the day
  before.
- **Monthly baseline (per employee)** = **median** of all within-day gap durations
  for that employee across the calendar month. Median, not mean, specifically so a
  single extreme gap doesn't drag the baseline (and thus the tier boundaries) upward
  for the rest of the month. A month with fewer than 5 gap samples has no reliable
  baseline; report it as `null`/insufficient-data rather than computing a
  median off 1–2 points.
- **Gap tiers**, relative to that employee's own monthly median (`avg`):
  | Tier | Range |
  |------|-------|
  | Normal | ≤ avg + 5 min |
  | Small | avg + 5 min .. avg + 20 min |
  | Medium | avg + 20 min .. avg + 60 min |
  | Large / extreme | > avg + 60 min |

  These are named constants in the new module (e.g. `GAP_TIER_THRESHOLDS_MS`), not
  hardcoded inline, so a future admin-facing tuning UI is a config change, not a
  logic change.
- **Historical sanity guard**: any `AuthActivityLogEntry` whose `lastSeenAt −
  signedInAt` exceeds a fixed implausibility ceiling (e.g. 16h — longer than any
  realistic single shift) is excluded from sign-in-anchor selection and from any
  aggregate at read time only. Nothing on disk is rewritten, archived, or deleted —
  consistent with the workspace's standing "never migrate/delete history" doctrine.
  This guard is a property of the new performance module's read path; it does not
  change what متابعة الأنشطة itself displays.

## The activity-log bug fix

`startAuthActivitySession()` in `src/auth/authActivityLog.ts` currently always derives
`signedInAt` from `session.loginAt`. It is called from two sites with different
correct answers:

- `writeSession()` (`src/auth/authSession.ts`) — a fresh login. `session.loginAt` is
  "now," so this is already correct.
- `readRealSession()`'s restore branch (`src/auth/authSession.ts:110`) — a session
  resumed from localStorage, where `session.loginAt` can be up to 7 days stale.

**Fix:** `startAuthActivitySession()` takes an explicit start-timestamp parameter
instead of reading it off `session.loginAt` internally. `writeSession()` passes the
login moment (unchanged behavior); the restore branch in `readRealSession()` passes
the actual restore moment. This is a small, local change, but `authActivityLog.ts`
and `AuthGate.tsx`'s heartbeat/boot-timing area is called out in CLAUDE.md as having
regressed five times in a row, caught only by review rather than self-testing —
including after real-browser confirmation. This change is made test-first per
`superpowers:test-driven-development`, and gets an explicit review pass rather than
being self-certified as done from reading the diff.

This fix changes computed durations for **both** the existing متابعة الأنشطة view and
the new تقييم الأداء subtab, since they share the same underlying log — the existing
view's numbers become more correct as a side effect, not a second surface to build.

## UI

All within the new `performance` subtab (`src/components/Sidebar/Tabs/UserManagement/PerformanceSection.tsx`,
wired into `TabView.tsx`'s `PageSection` union next to `ActionsSection`/`ActivitySection`):

- **Filter bar**: employee "all vs one" selector, following the `QueueScopePicker`
  all-with-per-employee-count pattern (`XrayReferrals/subComponents.tsx`) rather than
  a bare `<select>`, plus a `from`/`to` date range matching سجل الإجراءات's filter
  bar. Hand-rolled over a pure filter function (same reasoning `ActionsSection`
  already documents: a seeded, non-row-derived default doesn't fit `DataTable`'s
  multiselect).
- **Summary cards**: total samples finished, total effective hours, gap counts by
  tier, this scope's median pace — for the selected employee(s)/date range.
- **Trend chart**: samples finished per day. New SVG line/bar primitive added to
  `kpiCharts.ts` (or a sibling file in the same style), following its existing
  conventions (`esc()` on labels, `direction:ltr`, `--c-*` tokens, neutral empty
  state). The offline report generator's `timeSeriesBand`
  (`src/data/reporting/executive/ui/analyticsCharts.ts`) is the closest prior art for
  the gap-aware, day-bucketed line shape, but it targets report-deck styling and is
  not imported directly — it's a reference for the day-bucketing/gap-rendering
  approach, re-implemented against the app's own design tokens.
- **Working-hours graph**: one bar/timeline strip per day per employee, spanning
  sign-in → last finish, with gap segments visually marked — so "10:30–11:30, 0
  samples" is visible directly on the strip. No existing precedent in this codebase;
  new component, closest in spirit to a small per-day Gantt strip.
- **Gap events table**: date, employee, gap start, gap end, duration, tier — flat
  list following `ActionsSection`'s hand-rolled `um-activity-table` markup and
  `Pagination`/`clampPage`/`pageSlice` helpers, not `DataTable`.

## Testing

- New `src/data/performance/` module: pure functions, unit-tested directly (gap
  sequencing, day-boundary reset, median baseline with the <5-sample insufficient-data
  case, tier classification at each boundary, the historical sanity guard excluding
  an implausible entry).
- `authActivityLog.ts` fix: test-first per `test-driven-development` — a test
  reproducing the stale-`signedInAt`-on-restore scenario before the fix lands, plus
  the existing fresh-login path staying green.
- `PerformanceSection.tsx` and the new chart primitives: component/rendering tests
  per this repo's existing patterns (`createMemoryDirectory()` for any disk-backed
  test, `@vitest-environment jsdom` for component tests).
- Manual verification in `npm run dev` for the filter interactions and charts, per
  CLAUDE.md's standing "don't claim a UI change works without driving it in a real
  browser" guidance.

## Edit log / release process

Given the scope (new module, new subtab, a fix to a five-time-regressed area), this
is **Tier 3** per CLAUDE.md's edit-log ladder: full `Why:`/`What changed:` prose,
before/after snippets, and the complete Tier 3 gate list
(`lint`, `typecheck`, `test:run`, `check:complexity`, `check:hex-literals`,
`check:release`, `check:vendor`, `build`, `check:bundle-size`) before this is
considered done.
