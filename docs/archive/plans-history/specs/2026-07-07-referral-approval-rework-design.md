# اعتماد الطلبات (Referral Approval) — Rework Design

**Date:** 2026-07-07
**Status:** Approved by user
**Page:** `src/components/Sidebar/Tabs/EmployeeWorkspace/views/ReferralApproval.tsx` (sub-tab `ew/referral-approval`)

## Goals

1. Fix all known bugs on the page.
2. Reorganize the UI into a pending-first review queue with clear hierarchy.
3. Add a per-request status timeline and a global history view of all requests (all months) with search, filters, and XLSX export.
4. Add bulk approve/deny with per-request validation and confirmation.

## Non-goals

- Month close-out/lock (separate Tier-1 item).
- Changing how requests are *created* (XrayReferrals / XrayInspectionResults flows).
- Backend or cross-machine sync changes.

## Bugs being fixed

| # | Bug | Fix |
|---|-----|-----|
| 1 | No idempotency guard — a request can be approved twice (duplicate reassign events) or approved after denial (`ReferralApproval.tsx` handlers never re-check status against fresh data). | Re-load the log and require effective status `pending` before executing any side effect. |
| 2 | Ownership not verified — approving a referral emits reassign events assuming `fromEmployee` still owns every `xrayImageId`. | Verify current ownership via `deriveCurrentDistribution` before emitting events; reject with a clear Arabic message otherwise. |
| 3 | Month mismatch — `handleApproveReplacement` executes the swap against `request.monthFolderName` but writes the decision to the currently selected month (`selMonth`). | All decision writes take `monthFolderName` from the request object. |
| 4 | Stale UI state — expanded card, selection, and status banner persist across month/section switches; async load has no in-flight month check. | Reset transient state on month/section change; ignore stale responses. |
| 5 | Decisions stored latest-wins (upsert) — no history of status changes. | Append-only decision events (below). |
| 6 | Visual hierarchy — section tabs and status filter tabs look identical. | Distinct view tabs / section tabs / summary-chip filters. |

## Data model & storage (Approach A — append-only decision events)

In `src/data/approvals/approvalTypes.ts`:

```ts
type DecisionEvent = {
  requestId: string;
  kind: "referral" | "replacement";
  status: "approved" | "denied";
  reviewedBy: string;
  reviewedAt: string; // ISO
  reviewNotes?: string;
};

type SupervisorDecisionFile = {
  supervisorUsername: string;
  monthFolderName: string;
  referralDecisions: ReferralDecision[];        // legacy, read-only from now on
  replacementDecisions: ReplacementDecision[];  // legacy, read-only from now on
  decisionEvents?: DecisionEvent[];             // NEW — append-only
  lastUpdatedAt: string;
};
```

- **Writes** append to `decisionEvents` only; legacy arrays are no longer written.
- **Reads** merge legacy entries (as single events with `kind` inferred from which array they sit in) + `decisionEvents`, sorted by `reviewedAt`. Effective status per request = latest event. Fully backwards compatible; no migration.
- **Timeline** per request = `requestedAt` (from the request) + all its decision events, time-sorted.
- Storage mechanics unchanged: `safeWriteJson` / `JsonEnvelope`, per-supervisor decision files under the month's approvals dir.

### Storage-layer API changes (`approvalStorage.ts`, `referralStorage.ts`)

- `appendDecisionEvent(directoryHandle, monthFolderName, supervisorUsername, event)` — replaces the two upsert functions for new writes (upserts kept only for legacy compatibility reads, not called anymore).
- `loadReferralLog` / `loadReplacementLog` join requests with the merged event history; each returned request gains `history: DecisionEvent[]`.
- `updateReferralStatus` / `updateReplacementStatus` accept the request's own `monthFolderName` (bug #3).
- New guard helpers in `src/data/approvals/approvalGuards.ts`:
  - `assertStillPending(log, requestId)` — idempotency (bug #1).
  - `assertOwnership(distribution, request)` — every `xrayImageId` currently assigned to `fromEmployee` (bug #2, referrals only).

## UI & components

Split `views/ReferralApproval.tsx` into `views/ReferralApproval/`:

```
index.tsx            — orchestration: month, section, view, data loading
SummaryBar.tsx       — clickable count chips: معلّق / مقبول / مرفوض (act as status filter)
PendingQueue.tsx     — pending cards, bulk-select checkboxes, sticky bulk action bar
RequestCard.tsx      — unified card (referral + replacement variants)
RequestTimeline.tsx  — vertical timeline: أُرسل الطلب → قرارات (who/when/notes)
HistoryView.tsx      — DataTable of all requests across all months
ReviewModal.tsx      — approve/deny confirmation (single + bulk), notes field
useApprovalData.ts   — hook: months, requests, merged decisions, sample details
```

### Layout (RTL, top → bottom)

1. `PageHeader` + two **view tabs**: «المراجعة» (review) / «السجل» (history).
2. **Review view:** month select + section tabs (الإحالة / الاستبدال) on one row; `SummaryBar` chips beneath, visually distinct from tabs; a search box filtering by employee, sample ID, or reason.
3. **Pending queue:** pending cards **oldest-first**; checkbox per card when the user has the approve permission. Selection reveals a sticky bulk bar: «موافقة على المحدد (n)» / «رفض المحدد (n)». Bulk always routes through the confirm modal listing every affected request.
4. **Decided list** below a «الطلبات المكتملة» divider, newest-first, timeline expandable.
5. **History view:** existing `DataTable` component (sorting/filtering/column visibility/XLSX export for free). Columns: month, type, requester, sample count/IDs, status, requested-at, reviewed-by, reviewed-at, notes. Aggregates every month folder. Row click expands the full timeline.

### Visibility

- Reviewers (users with `approve-referrals` / `approve-replacements`): see all requests, everywhere.
- Employees: see only their own requests — in the queue and in history (same rule as today, extended to the new view).

### Bulk semantics

Sequential processing; each request individually re-validated (pending + ownership). Result banner reports partial outcomes: «تمت الموافقة على 4، فشل 1: …». No all-or-nothing batch.

### State hygiene

Expanded card, selection set, and status banner reset on month/section/view change. Data loads carry the requested month and are discarded if the selection changed mid-flight.

## Error handling

- Every mutation returns `{ ok: true } | { ok: false; error }` to the UI; shown in the status banner in Arabic and recorded via `logError`.
- Validation failures vs I/O failures get distinct messages: «الطلب لم يعد معلقاً — حدّث الصفحة» vs «تعذر الحفظ — أعد المحاولة».
- Partial-failure case (distribution events written, decision write failed): the banner states it precisely and offers retrying the decision write only; the idempotency guard prevents duplicate reassign events on retry.
- History view skips unreadable months and names them in a warning line; the rest still renders.

## Testing (Vitest, node env, `createMemoryDirectory()`)

- `approvalStorage.test.ts` (new): event append; effective status = latest; legacy merge; multi-supervisor aggregation.
- `referralStorage.test.ts` (extend): status join uses event history; `getPendingReferralIds` behavior unchanged.
- `approvalGuards.test.ts` (new): double-approve rejected; approve-after-deny rejected; ownership mismatch rejected; decision written to request's month.
- Bulk flow: 3 requests with 1 invalid → 2 succeed, 1 reported, no corrupt events.
- Business logic lives in the hook + pure helpers so it is testable without a DOM.

## Conventions

- All edits logged in `docs/EDIT_LOG.md` (before/after) per project rule.
- New UI strings added as label keys in `labelsStore.ts`, not hard-coded Arabic.
- Plain CSS in the existing `EmployeeWorkspace.css` `ew-*` vocabulary.
