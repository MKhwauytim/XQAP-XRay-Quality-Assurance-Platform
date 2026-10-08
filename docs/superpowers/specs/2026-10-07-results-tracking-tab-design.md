# Results page: deadline & daily-progress tab (default tab) — design

Date: 2026-10-07 · Status: draft for owner review · Path: architectural

## Intent (owner's words, confirmed in brainstorm)

Inside the «نتائج فحص الأشعة» page (`ew/xray-results`) add a tab that shows the
month's **deadline** (admin-settable; default = the deadline we follow when
distributing the sample), the **daily quota (الحصة اليومية)** adjusted to that
deadline, a **calendar of every day of the month**, how many samples are **done**
and how many are **archived (مؤرشفة)**, and per-employee **daily averages** — one
including archived, one counting only «مكتملة».

Decisions from the owner:

1. **Placement:** a tab strip inside the existing page. The new tracking view is
   the **default (first) tab**; today's results table becomes the **second** tab,
   unchanged. Same permissions as the page (admin/manager edit, supervisor view;
   employee/guest none) — no new permission row.
2. **«مؤرشفة» = «المعلقة»:** a *submitted* answer where «هل يوجد صورة» is «لا»
   (the app's existing `isNoImageSubmission`, shown today as «معلق»). It is not a
   new status and needs no new stored data.
3. **Quota:** *original* quota recalculated for the new deadline — not a live
   "remaining ÷ remaining days" figure.

## Definitions

- **مكتملة** — `entry.status === "completed"` OR `answer.status === "submitted"`
  and not a no-image submission (rule today at `XrayInspectionResults.tsx:1286`).
- **مؤرشفة / معلقة** — submitted no-image answer.
- **Day of completion** — local calendar day of `ItemAnswer.submittedAt`.
- **Working days** — `utils/workingDays.ts` (Friday + Saturday weekend, no holiday
  calendar, inclusive counting).
- **Daily quota (display)** = `ceil(assignedSamples / workingDays(assignmentDay → deadline))`,
  `assignmentDay` from the employee's first `assigned` event (`EmployeeQuota.assignedAt`).
- **Average per day (all)** = (مكتملة + معلقة) ÷ working days elapsed.
- **Average per day (completed only)** = مكتملة ÷ working days elapsed.
- **Working days elapsed** = working days from the employee's assignment day to
  `min(today, deadline)`; for a closed/past month, to the deadline.

## Design

### 1. Tab strip
`XrayInspectionResults` page gains a tab strip: «المتابعة والمواعيد» (default) and
«النتائج» (the current table, kept mounted, untouched). Landing tab is the
tracking view. Page eyebrow/labels via `DEFAULT_LABELS` keys, no inline Arabic.

### 2. Deadline
- Single source `defaultDeadlineFor(year, month)` = last day of month − 3
  (today hard-coded in `distributionDerivation.ts:92-96`); both distribution and
  the new tab call it.
- Override stored per month in `5-system/month-deadlines.json`:
  `{ [monthKey]: { date: "YYYY-MM-DD", updatedAt, updatedBy } }` + `revision`,
  `_writeToken`; written with `casLoop` / `withResourceLock` / `safeWriteJson`
  (pattern of `templateSelectionStorage.ts`), path via `workspacePaths.ts`.
  Lives outside the month folder so a closed month never blocks it.
- Admin edits via a date picker + «استعادة الافتراضي», gated by `canMutate`.
  Others see the date read-only, marked «افتراضي» or «معدّل بواسطة … في …».
- Validation: date must fall inside the selected month.

### 3. Calendar
Full month grid (Saturday-first like `buildInaccuracyCalendar`), weekends greyed,
today ringed, deadline day highlighted. Each day cell: مكتملة count and معلقة
count (team total), plus the team's summed daily quota as the target on working
days. Employee filter: team total or one employee. Summary strip above: assigned,
مكتملة, معلقة, remaining, days left to deadline.

### 4. Per-employee table
Employee · assigned · مكتملة · معلقة · daily quota · avg/day (مكتملة + معلقة) ·
avg/day (مكتملة فقط). Sortable via the shared `DataTable`.

### 5. Code shape
- `src/data/tracking/deadlineTracking.ts` — pure selectors: day buckets, quota,
  averages, calendar grid. Fully unit-tested (weekends, deadline override,
  month with no data, employee with no quota row).
- `src/data/tracking/monthDeadlineStorage.ts` — load/save override (CAS).
- Extract the مكتملة/معلق rule into the tracking module and make
  `XrayInspectionResults` import it (one copy).
- View `views/ResultsTracking/` + CSS co-located; reads data through the same
  loaders the results page already uses and subscribes to `dataRefreshSignal`
  without clobbering the admin's unsaved deadline draft.
- Register new storage file in `templateFileRecovery`/backup coverage if the
  chosen folder requires it; no `DERIVE_VERSION` change; no distribution events
  rewritten.

## Assumptions / known limits (to confirm)

1. Weekend = Friday + Saturday (per `workingDays.ts`).
2. Only the latest submit per sample counts toward a day: a reopen clears
   `submittedAt`, so a sample reopened later vanishes from its original day.
   Fixing needs new history data — out of scope.
3. The override does not rewrite quotas stamped at distribution time; the
   distribution screen can adopt the override later.
4. An employee who only got samples by reassignment has no assignment date, so
   their working-day span falls back to the month start.
5. Quota and averages use per-employee spans, so two employees' averages are not
   directly comparable if assigned on different days — the table shows the span.

## Testing

Pure-selector tests; storage CAS round-trip with `createMemoryDirectory`;
component test for default-tab landing, admin vs read-only deadline, filter;
catalog/registry agreement tests unchanged (no new tab id); `check:*` per tier 3.
