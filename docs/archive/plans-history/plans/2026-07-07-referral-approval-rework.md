# اعتماد الطلبات (Referral Approval) Rework — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the اعتماد الطلبات page — fix 4 real bugs (double-approval, ownership drift, month-mismatch on writes, stale UI state across month switches), reorganize the UI into a pending-first queue with bulk actions, and add a per-request decision timeline plus a cross-month history view.

**Architecture:** Add an append-only `DecisionEvent` log to the existing per-supervisor decision files (backwards compatible with the current latest-wins fields). Extract all data loading + mutation logic out of the monolithic `ReferralApproval.tsx` into a `useApprovalData` hook with two new pure guard functions (idempotency + ownership). Split the 688-line component into a small folder of focused, single-responsibility files.

**Tech Stack:** React 19 + TypeScript (strict), Vitest (node env for data-layer tests, jsdom for the one hook test), `@testing-library/react`, existing `DataTable` component for the history view, plain CSS (`ew-*` classes in `EmployeeWorkspace.css`).

**Spec:** [docs/superpowers/specs/2026-07-07-referral-approval-rework-design.md](../specs/2026-07-07-referral-approval-rework-design.md)

## Global Constraints

- TypeScript strict mode — no `any`; guard optional fields explicitly.
- Arabic UI text, RTL layout (`dir="rtl"`), matching the existing `ew-*` CSS vocabulary in `src/components/Sidebar/Tabs/EmployeeWorkspace/EmployeeWorkspace.css`.
- Every code edit is logged in `docs/EDIT_LOG.md` **before** it is applied, per `CLAUDE.md`. Because `docs/EDIT_LOG.md` is inlined into the production bundle via a `?raw` import (ChangeLog tab), keep each entry's "After" snippet to the key change only (a signature, a short excerpt) — never paste an entire new file's contents into the log.
- **Deviation from the spec, called out explicitly:** the spec said "New UI strings added as label keys in `labelsStore.ts`". The existing `ReferralApproval.tsx` never used `labelsStore` for any of its ~40 Arabic strings — 100% hardcoded. Introducing label-key indirection for only the *new* strings on this page would leave the page half-migrated (some strings editable via Settings, most not) for no functional benefit nobody asked for, and meaningfully inflates every task below. This plan hardcodes new Arabic strings inline, matching the file's existing, 100%-consistent convention. Flag this during spec review if full label-key coverage is actually wanted — it would be a separate, mechanical follow-up task.
- Tests: Vitest `node` environment is the default for all data-layer tests (`createMemoryDirectory()` helper). One hook-level test uses `/* @vitest-environment jsdom */` (see Task 4) — this is the only test in the plan that needs it. No component-render tests are added for the new UI files: the codebase has zero existing tests for `ReferralApproval.tsx`, and the risky logic (guards, storage) is unit-tested directly. The UI is verified by hand in the final task, per project convention for this page.
- Every relative import below is computed for its actual file location. Files living directly under `src/components/Sidebar/Tabs/EmployeeWorkspace/views/ReferralApproval/` are 6 directories below `src/` (`components/Sidebar/Tabs/EmployeeWorkspace/views/ReferralApproval`), so any import of a top-level `src/` module (`data/...`, `auth/...`, `components/...` outside this folder) uses `../../../../../../` (six levels). Sibling files in the same new folder are imported with `./`.

---

## File Structure

```
src/data/approvals/
  approvalTypes.ts          MODIFY  — add DecisionEvent + DecisionEventKind, extend SupervisorDecisionFile
  approvalStorage.ts        MODIFY  — add appendDecisionEvent/mergeDecisionHistory/effectiveDecision (Task 1);
                                       remove dead upsertReferralDecision/upsertReplacementDecision (Task 3)
  approvalStorage.test.ts   CREATE  — Task 1
  approvalGuards.ts         CREATE  — Task 2: assertRequestPending, assertSamplesOwnedBy
  approvalGuards.test.ts    CREATE  — Task 2

src/data/referral/
  referralTypes.ts          MODIFY  — add `history?: DecisionEvent[]` to both request types (Task 3)
  referralStorage.ts        MODIFY  — wire history into loadReferralLog/loadReplacementLog; switch
                                       updateReferralStatus/updateReplacementStatus to appendDecisionEvent (Task 3)
  referralStorage.test.ts   MODIFY  — extend with history assertions (Task 3)

src/components/Sidebar/Tabs/EmployeeWorkspace/
  EmployeeWorkspace.css     MODIFY  — new ew-approval-view-tab*, ew-summary-*, ew-timeline*, ew-bulk-bar,
                                       ew-request-checkbox, ew-referral-card--selected rules (Task 11)
  views/ReferralApproval.tsx   DELETE (Task 11) — replaced by the folder below
  views/ReferralApproval/
    useApprovalData.ts          CREATE — Task 4: data loading + mutation hook (bug fixes live here)
    useApprovalData.test.tsx    CREATE — Task 4
    RequestTimeline.tsx         CREATE — Task 5
    RequestCard.tsx             CREATE — Task 6 (also exports `isReferral` type guard)
    SummaryBar.tsx               CREATE — Task 7
    RequestList.tsx              CREATE — Task 8 (pending queue + bulk bar + decided list, one component)
    ReviewModal.tsx               CREATE — Task 9 (single + bulk confirmation)
    HistoryView.tsx               CREATE — Task 10 (cross-month DataTable)
    index.tsx                     CREATE — Task 11 (orchestration, replaces the old flat file)
```

**Bug-fix map** (for traceability while implementing):

| Bug | Fixed in |
|---|---|
| #1 Double-approval / approve-after-deny (no idempotency check) | Task 2 (`assertRequestPending`) + Task 4 (called before every mutation) |
| #2 Referral approved without re-verifying current sample ownership | Task 2 (`assertSamplesOwnedBy`) + Task 4 (`approveReferral`) |
| #3 Decision written to the UI's selected month instead of the request's own month | Task 4 (every mutation keys off `request.monthFolderName`, never `selMonth`) |
| #4 Stale UI state across month/section switches (in-flight loads, expanded/selected state) | Task 4 (`loadTokenRef` guards stale loads) + Task 8 (selection resets on filter/kind change) |
| #5 Decisions overwrite each other (no history) | Task 1 + Task 3 (append-only `DecisionEvent` log) |
| #6 Section tabs and status filter tabs look identical | Task 7 (`SummaryBar` gets its own distinct chip style) |

---

### Task 1: Decision-event storage layer

**Files:**
- Modify: `src/data/approvals/approvalTypes.ts`
- Modify: `src/data/approvals/approvalStorage.ts`
- Test: `src/data/approvals/approvalStorage.test.ts`

**Interfaces:**
- Produces: `DecisionEvent` type (`{ requestId, kind: "referral" | "replacement", status: "approved" | "denied", reviewedBy, reviewedAt, reviewNotes? }`), `appendDecisionEvent(directoryHandle, monthFolderName, supervisorUsername, event)`, `mergeDecisionHistory(files: SupervisorDecisionFile[], kind, requestId): DecisionEvent[]`, `effectiveDecision(history: DecisionEvent[]): DecisionEvent | undefined`. Task 3 consumes all four.

- [ ] **Step 1: Write the failing test**

Create `src/data/approvals/approvalStorage.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import {
  appendDecisionEvent,
  effectiveDecision,
  loadSupervisorDecisions,
  mergeDecisionHistory,
} from "./approvalStorage";

describe("approvalStorage decision events", () => {
  it("appends a decision event and persists it", async () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    const result = await appendDecisionEvent(root, "5-may-2026", "sup-1", {
      requestId: "req-1",
      kind: "referral",
      status: "approved",
      reviewedBy: "sup-1",
      reviewedAt: "2026-07-01T10:00:00.000Z",
    });
    expect(result.ok).toBe(true);

    const file = await loadSupervisorDecisions(root, "5-may-2026", "sup-1");
    expect(file.decisionEvents).toHaveLength(1);
    expect(file.decisionEvents?.[0].status).toBe("approved");
  });

  it("keeps every event for repeated decisions on the same request", async () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    await appendDecisionEvent(root, "5-may-2026", "sup-1", {
      requestId: "req-1", kind: "referral", status: "denied",
      reviewedBy: "sup-1", reviewedAt: "2026-07-01T10:00:00.000Z",
    });
    await appendDecisionEvent(root, "5-may-2026", "sup-1", {
      requestId: "req-1", kind: "referral", status: "approved",
      reviewedBy: "sup-1", reviewedAt: "2026-07-02T10:00:00.000Z", reviewNotes: "correction",
    });

    const file = await loadSupervisorDecisions(root, "5-may-2026", "sup-1");
    expect(file.decisionEvents).toHaveLength(2);
  });

  it("merges events across supervisor files and legacy decision arrays, sorted by time", () => {
    const files = [
      {
        supervisorUsername: "sup-1", monthFolderName: "5-may-2026",
        referralDecisions: [{ requestId: "req-1", status: "denied" as const, reviewedBy: "sup-1", reviewedAt: "2026-07-01T09:00:00.000Z" }],
        replacementDecisions: [],
        decisionEvents: [{ requestId: "req-1", kind: "referral" as const, status: "approved" as const, reviewedBy: "sup-1", reviewedAt: "2026-07-03T09:00:00.000Z" }],
        lastUpdatedAt: "2026-07-03T09:00:00.000Z",
      },
      {
        supervisorUsername: "sup-2", monthFolderName: "5-may-2026",
        referralDecisions: [], replacementDecisions: [],
        decisionEvents: [{ requestId: "req-1", kind: "referral" as const, status: "denied" as const, reviewedBy: "sup-2", reviewedAt: "2026-07-02T09:00:00.000Z" }],
        lastUpdatedAt: "2026-07-02T09:00:00.000Z",
      },
    ];

    const history = mergeDecisionHistory(files, "referral", "req-1");
    expect(history.map((e) => e.reviewedBy)).toEqual(["sup-1", "sup-2", "sup-1"]);
    expect(effectiveDecision(history)?.status).toBe("approved");
    expect(effectiveDecision(history)?.reviewedAt).toBe("2026-07-03T09:00:00.000Z");
  });

  it("returns undefined for a request with no history", () => {
    expect(effectiveDecision([])).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/approvals/approvalStorage.test.ts`
Expected: FAIL — `appendDecisionEvent`, `mergeDecisionHistory`, `effectiveDecision` are not exported yet.

- [ ] **Step 3: Add the DecisionEvent type**

In `src/data/approvals/approvalTypes.ts`, add after the existing `ReplacementDecision` type (before `SupervisorDecisionFile`):

```ts
export type DecisionEventKind = "referral" | "replacement";

/** One reviewer decision on one request. Appended, never overwritten — the full
 *  sequence for a request is its audit history; the last event is its effective status. */
export type DecisionEvent = {
  requestId: string;
  kind: DecisionEventKind;
  status: "approved" | "denied";
  reviewedBy: string;
  reviewedAt: string;
  reviewNotes?: string;
};
```

Then extend `SupervisorDecisionFile`:

```ts
export type SupervisorDecisionFile = {
  supervisorUsername: string;
  monthFolderName: string;
  referralDecisions: ReferralDecision[];
  replacementDecisions: ReplacementDecision[];
  /** Append-only decision history. Legacy files predate this field. */
  decisionEvents?: DecisionEvent[];
  lastUpdatedAt: string;
};
```

- [ ] **Step 4: Add the storage functions**

In `src/data/approvals/approvalStorage.ts`, change the type-only import at the top:

```ts
import type { DecisionEvent, DecisionEventKind, SupervisorDecisionFile } from "./approvalTypes";
```

Add these three functions at the end of the file:

```ts
export async function appendDecisionEvent(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  supervisorUsername: string,
  event: DecisionEvent
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const appDir = await getApprovalsDir(directoryHandle, monthFolderName);
    const current = await loadSupervisorDecisions(directoryHandle, monthFolderName, supervisorUsername);
    const updated: SupervisorDecisionFile = {
      ...current,
      decisionEvents: [...(current.decisionEvents ?? []), event],
      lastUpdatedAt: new Date().toISOString(),
    };
    await safeWriteJson(appDir, decisionFileName(supervisorUsername), updated);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "خطأ غير معروف." };
  }
}

/** Combine decision events for one request from every supervisor's file, including
 *  legacy (pre-history) decisions read as single-event history. Sorted oldest → newest. */
export function mergeDecisionHistory(
  files: SupervisorDecisionFile[],
  kind: DecisionEventKind,
  requestId: string
): DecisionEvent[] {
  const events: DecisionEvent[] = [];
  for (const file of files) {
    for (const event of file.decisionEvents ?? []) {
      if (event.kind === kind && event.requestId === requestId) events.push(event);
    }
    const legacy = kind === "referral" ? file.referralDecisions : file.replacementDecisions;
    for (const decision of legacy) {
      if (decision.requestId !== requestId) continue;
      events.push({
        requestId: decision.requestId,
        kind,
        status: decision.status,
        reviewedBy: decision.reviewedBy,
        reviewedAt: decision.reviewedAt,
        reviewNotes: decision.reviewNotes,
      });
    }
  }
  return events.sort((a, b) => a.reviewedAt.localeCompare(b.reviewedAt));
}

/** The request's current effective decision — the most recent event, or undefined
 *  if nobody has reviewed it yet. */
export function effectiveDecision(history: DecisionEvent[]): DecisionEvent | undefined {
  return history.length > 0 ? history[history.length - 1] : undefined;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/data/approvals/approvalStorage.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Log the edit and commit**

Add to `docs/EDIT_LOG.md` (top of file, after the `---`) — use the next version, e.g. `v42.0` (check the current highest version in the file first and increment; this is a major rework so it bumps the whole number):

```markdown
## v42.0 — 2026-07-07 — Referral approval rework (1/11): append-only decision-event log

**File:** `src/data/approvals/approvalTypes.ts`

**Before:** `SupervisorDecisionFile` had only latest-wins `referralDecisions`/`replacementDecisions` arrays — no way to see a request's full review history.

**After:** added `DecisionEvent`/`DecisionEventKind` and an optional `decisionEvents?: DecisionEvent[]` field, additive and backwards compatible.

**File:** `src/data/approvals/approvalStorage.ts`

**Before:** no way to append a decision without overwriting the prior one.

**After:** added `appendDecisionEvent`, `mergeDecisionHistory`, `effectiveDecision`.
```

```bash
git add src/data/approvals/approvalTypes.ts src/data/approvals/approvalStorage.ts src/data/approvals/approvalStorage.test.ts docs/EDIT_LOG.md
git commit -m "feat(approvals): append-only decision-event log for referral/replacement history"
```

---

### Task 2: Approval guards (idempotency + ownership)

**Files:**
- Create: `src/data/approvals/approvalGuards.ts`
- Test: `src/data/approvals/approvalGuards.test.ts`

**Interfaces:**
- Consumes: `DistributionCurrentData` type from `../distribution/distributionTypes` (already exists).
- Produces: `assertRequestPending(status)`, `assertSamplesOwnedBy(distribution, xrayImageIds, expectedOwner)` — both return `{ ok: true } | { ok: false; error: string }`. Task 4 calls both before mutating.

- [ ] **Step 1: Write the failing test**

Create `src/data/approvals/approvalGuards.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { assertRequestPending, assertSamplesOwnedBy } from "./approvalGuards";
import type { DistributionCurrentData } from "../distribution/distributionTypes";
import type { PreparedPopulationRow } from "../population/populationTypes";

const stubRow = {} as unknown as PreparedPopulationRow;

const distribution: DistributionCurrentData = {
  monthFolderName: "5-may-2026",
  derivedAt: "2026-07-01T00:00:00.000Z",
  totalAssigned: 2,
  totalCompleted: 0,
  totalReplaced: 0,
  totalPending: 2,
  entries: [
    { xrayImageId: "img-1", assignedTo: "alice", status: "pending", replacedById: null, lastEventAt: "2026-07-01T00:00:00.000Z", row: stubRow },
    { xrayImageId: "img-2", assignedTo: "bob",   status: "pending", replacedById: null, lastEventAt: "2026-07-01T00:00:00.000Z", row: stubRow },
  ],
};

describe("assertRequestPending", () => {
  it("passes when the request is still pending", () => {
    expect(assertRequestPending("pending")).toEqual({ ok: true });
  });

  it("rejects when the request was already approved", () => {
    expect(assertRequestPending("approved").ok).toBe(false);
  });

  it("rejects when the request was already denied", () => {
    expect(assertRequestPending("denied").ok).toBe(false);
  });
});

describe("assertSamplesOwnedBy", () => {
  it("passes when every sample is currently owned by the expected employee", () => {
    expect(assertSamplesOwnedBy(distribution, ["img-1"], "alice")).toEqual({ ok: true });
  });

  it("rejects when a sample has moved to a different employee", () => {
    const result = assertSamplesOwnedBy(distribution, ["img-1", "img-2"], "alice");
    expect(result.ok).toBe(false);
  });

  it("rejects when distribution data is missing", () => {
    expect(assertSamplesOwnedBy(null, ["img-1"], "alice").ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/approvals/approvalGuards.test.ts`
Expected: FAIL — cannot find module `./approvalGuards`.

- [ ] **Step 3: Write the implementation**

Create `src/data/approvals/approvalGuards.ts`:

```ts
import type { DistributionCurrentData } from "../distribution/distributionTypes";

type GuardResult = { ok: true } | { ok: false; error: string };

/** Rejects a mutation if the request has already been decided by another
 *  reviewer/session since this UI last loaded it — prevents double-approval
 *  and approve-after-deny races. Callers must re-load the current status
 *  immediately before calling this, not rely on cached UI state. */
export function assertRequestPending(
  currentStatus: "pending" | "approved" | "denied"
): GuardResult {
  if (currentStatus !== "pending") {
    return {
      ok: false,
      error: "تم اتخاذ قرار بشأن هذا الطلب مسبقاً من جهاز أو نافذة أخرى — أعد تحميل الصفحة لعرض الحالة الحالية.",
    };
  }
  return { ok: true };
}

/** Rejects a referral approval if any sample has moved to a different employee
 *  since the request was submitted (e.g. a second referral or a replacement
 *  already reassigned it). Requires a freshly-derived distribution snapshot. */
export function assertSamplesOwnedBy(
  distribution: DistributionCurrentData | null,
  xrayImageIds: string[],
  expectedOwner: string
): GuardResult {
  if (!distribution) {
    return { ok: false, error: "تعذر التحقق من ملكية العينات — لم يتم العثور على بيانات التوزيع لهذا الشهر." };
  }
  const entryByImageId = new Map(distribution.entries.map((entry) => [entry.xrayImageId, entry]));
  const mismatched = xrayImageIds.filter((id) => entryByImageId.get(id)?.assignedTo !== expectedOwner);
  if (mismatched.length > 0) {
    return {
      ok: false,
      error: `لم تعد العينات التالية مسندة إلى ${expectedOwner}: ${mismatched.join("، ")}. حدّث الصفحة وأعد المحاولة.`,
    };
  }
  return { ok: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/data/approvals/approvalGuards.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Log the edit and commit**

Add to `docs/EDIT_LOG.md`:

```markdown
## v42.1 — 2026-07-07 — Referral approval rework (2/11): idempotency + ownership guards

**File:** `src/data/approvals/approvalGuards.ts`

**Before:** file did not exist — nothing verified a request was still pending, or that referred samples were still owned by the requester, before mutating.

**After:** added `assertRequestPending` and `assertSamplesOwnedBy`, pure functions consumed by the approval hook (Task 4) before every approve/deny.
```

```bash
git add src/data/approvals/approvalGuards.ts src/data/approvals/approvalGuards.test.ts docs/EDIT_LOG.md
git commit -m "feat(approvals): add idempotency and sample-ownership guards"
```

---

### Task 3: Wire decision history into referralStorage; remove dead upsert functions

**Files:**
- Modify: `src/data/referral/referralTypes.ts`
- Modify: `src/data/referral/referralStorage.ts`
- Modify: `src/data/referral/referralStorage.test.ts`

**Interfaces:**
- Consumes: `appendDecisionEvent`, `mergeDecisionHistory`, `effectiveDecision` from Task 1; `DecisionEvent` type.
- Produces: `ReferralRequest.history?: DecisionEvent[]`, `ReplacementRequest.history?: DecisionEvent[]` — consumed by Task 6 (`RequestTimeline`) and Task 10 (`HistoryView`). `updateReferralStatus`/`updateReplacementStatus` keep their existing signature `(directoryHandle, monthFolderName, requestId, updates)` — Task 4 is responsible for always passing `request.monthFolderName`, never the UI's selected month.

- [ ] **Step 1: Write the failing test**

Add to the end of `src/data/referral/referralStorage.test.ts`, inside the existing first `describe("referralStorage", ...)` block (after the `"resolves pending referral IDs correctly"` test, before its closing `});`):

```ts
  it("keeps a full decision history and exposes it on the loaded request", async () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    const req1 = mockReferral("req-1", "alice", "bob");
    await appendReferralRequest(root, "5-May-2026", req1);

    await updateReferralStatus(root, "5-May-2026", "req-1", {
      status: "denied", reviewedBy: "supervisor-1",
      reviewedAt: "2026-07-01T10:00:00.000Z", reviewNotes: "not enough detail",
    });
    await updateReferralStatus(root, "5-May-2026", "req-1", {
      status: "approved", reviewedBy: "supervisor-1",
      reviewedAt: "2026-07-02T10:00:00.000Z", reviewNotes: "resolved",
    });

    const log = await loadReferralLog(root, "5-May-2026");
    expect(log.requests[0].status).toBe("approved");
    expect(log.requests[0].history).toHaveLength(2);
    expect(log.requests[0].history?.[0].status).toBe("denied");
    expect(log.requests[0].history?.[1].status).toBe("approved");
  });
```

And to the end of the `describe("replacement requests in referralStorage", ...)` block:

```ts
  it("keeps a full decision history for replacement requests", async () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    const req = mockReplacement("rep-1", "alice");
    await appendReplacementRequest(root, "5-May-2026", req);

    await updateReplacementStatus(root, "5-May-2026", "rep-1", {
      status: "denied", reviewedBy: "supervisor-1", reviewedAt: "2026-07-01T10:00:00.000Z",
    });
    await updateReplacementStatus(root, "5-May-2026", "rep-1", {
      status: "approved", reviewedBy: "supervisor-1", reviewedAt: "2026-07-02T10:00:00.000Z",
    });

    const log = await loadReplacementLog(root, "5-May-2026");
    expect(log.requests[0].status).toBe("approved");
    expect(log.requests[0].history).toHaveLength(2);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/referral/referralStorage.test.ts`
Expected: FAIL — `log.requests[0].history` is `undefined`, `toHaveLength(2)` fails.

- [ ] **Step 3: Add the history field to both request types**

In `src/data/referral/referralTypes.ts`, add the import at the top:

```ts
import type { DecisionEvent } from "../approvals/approvalTypes";
```

Add `history?: DecisionEvent[];` as the last field of `ReferralRequest`:

```ts
export type ReferralRequest = {
  requestId: string;
  monthFolderName: string;
  fromEmployee: string;
  toEmployee: string;
  xrayImageIds: string[];
  reason: string;
  requestedAt: string;
  requestedBy: string;
  status: ReferralStatus;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNotes?: string;
  /** Full append-only decision history, newest last. Populated by loadReferralLog. */
  history?: DecisionEvent[];
};
```

And the same field at the end of `ReplacementRequest`:

```ts
  status: ReferralStatus;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNotes?: string;
  /** Full append-only decision history, newest last. Populated by loadReplacementLog. */
  history?: DecisionEvent[];
};
```

- [ ] **Step 4: Switch referralStorage.ts to the event log**

In `src/data/referral/referralStorage.ts`, replace the approvals import:

```ts
import {
  loadAllSupervisorDecisions,
  upsertReferralDecision,
  upsertReplacementDecision,
} from "../approvals/approvalStorage";
```

with:

```ts
import {
  appendDecisionEvent,
  effectiveDecision,
  loadAllSupervisorDecisions,
  mergeDecisionHistory,
} from "../approvals/approvalStorage";
```

Replace `loadReferralLog`'s body (the decision-joining part) — from:

```ts
  const allRequests = empFiles.flatMap((f) => f.referralRequests ?? []);
  const decisionMap = new Map(
    allDecisions.flatMap((d) =>
      d.referralDecisions.map((dec) => [dec.requestId, dec])
    )
  );

  const requests = allRequests.map((r) => {
    const dec = decisionMap.get(r.requestId);
    return dec
      ? { ...r, status: dec.status, reviewedBy: dec.reviewedBy, reviewedAt: dec.reviewedAt, reviewNotes: dec.reviewNotes }
      : r;
  });

  return { monthFolderName, revision: 0, requests };
```

to:

```ts
  const allRequests = empFiles.flatMap((f) => f.referralRequests ?? []);

  const requests = allRequests.map((r) => {
    const history = mergeDecisionHistory(allDecisions, "referral", r.requestId);
    const latest = effectiveDecision(history);
    return latest
      ? { ...r, status: latest.status, reviewedBy: latest.reviewedBy, reviewedAt: latest.reviewedAt, reviewNotes: latest.reviewNotes, history }
      : { ...r, history };
  });

  return { monthFolderName, revision: 0, requests };
```

Replace `updateReferralStatus`'s body — from:

```ts
export async function updateReferralStatus(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  requestId: string,
  updates: { status: ReferralStatus; reviewedBy: string; reviewedAt: string; reviewNotes?: string }
): Promise<{ ok: true } | { ok: false; error: string }> {
  return upsertReferralDecision(directoryHandle, monthFolderName, updates.reviewedBy, {
    requestId,
    status: updates.status as "approved" | "denied",
    reviewedBy: updates.reviewedBy,
    reviewedAt: updates.reviewedAt,
    reviewNotes: updates.reviewNotes,
  });
}
```

to:

```ts
export async function updateReferralStatus(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  requestId: string,
  updates: { status: ReferralStatus; reviewedBy: string; reviewedAt: string; reviewNotes?: string }
): Promise<{ ok: true } | { ok: false; error: string }> {
  return appendDecisionEvent(directoryHandle, monthFolderName, updates.reviewedBy, {
    requestId,
    kind: "referral",
    status: updates.status as "approved" | "denied",
    reviewedBy: updates.reviewedBy,
    reviewedAt: updates.reviewedAt,
    reviewNotes: updates.reviewNotes,
  });
}
```

Apply the mirror-image change to `loadReplacementLog` (same pattern, `"replacement"` kind, `d.replacementDecisions`, `f.replacementRequests`) and `updateReplacementStatus` (same pattern, `kind: "replacement"`).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/data/referral/referralStorage.test.ts`
Expected: PASS (all tests, including the 2 new ones)

- [ ] **Step 6: Confirm no other callers of the deleted functions, then delete them**

Run: `grep -rn "upsertReferralDecision\|upsertReplacementDecision" src`
Expected: no matches (referralStorage.ts no longer imports them after Step 4).

Delete `upsertReferralDecision` and `upsertReplacementDecision` from `src/data/approvals/approvalStorage.ts` entirely (both full function bodies) — they're dead code once Step 4 lands.

- [ ] **Step 7: Run the full data-layer test suite**

Run: `npx vitest run src/data`
Expected: PASS (no regressions from removing the two functions)

- [ ] **Step 8: Log the edit and commit**

Add to `docs/EDIT_LOG.md`:

```markdown
## v42.2 — 2026-07-07 — Referral approval rework (3/11): wire decision history into referralStorage

**File:** `src/data/referral/referralTypes.ts`

**Before:** `ReferralRequest`/`ReplacementRequest` had no history field.

**After:** both gain `history?: DecisionEvent[]`, populated at load time.

**File:** `src/data/referral/referralStorage.ts`

**Before:** `updateReferralStatus`/`updateReplacementStatus` called `upsertReferralDecision`/`upsertReplacementDecision` (latest-wins, history lost on re-review).

**After:** both call `appendDecisionEvent`; `loadReferralLog`/`loadReplacementLog` derive `status` from `effectiveDecision(mergeDecisionHistory(...))` and attach the full `history`.

**File:** `src/data/approvals/approvalStorage.ts`

**Before:** `upsertReferralDecision`/`upsertReplacementDecision` exported.

**After:** removed — no longer called anywhere.
```

```bash
git add src/data/referral/referralTypes.ts src/data/referral/referralStorage.ts src/data/referral/referralStorage.test.ts src/data/approvals/approvalStorage.ts docs/EDIT_LOG.md
git commit -m "feat(referral): expose full decision history; retire latest-wins upsert functions"
```

---

### Task 4: `useApprovalData` hook — data loading, bug fixes, bulk actions

**Files:**
- Create: `src/components/Sidebar/Tabs/EmployeeWorkspace/views/ReferralApproval/useApprovalData.ts`
- Test: `src/components/Sidebar/Tabs/EmployeeWorkspace/views/ReferralApproval/useApprovalData.test.tsx`

**Interfaces:**
- Consumes: `assertRequestPending`, `assertSamplesOwnedBy` (Task 2); `loadReferralLog`, `loadReplacementLog`, `updateReferralStatus`, `updateReplacementStatus` (Task 3, now history-aware).
- Produces: `useApprovalData(directoryHandle): { username, role, canApproveReferrals, canApproveReplacements, userDisplayMap, months, selMonth, setSelMonth, referrals, replacements, sampleDetails, loadState, reload, approveReferral, denyReferral, approveReplacement, denyReplacement, bulkReferralDecision, bulkReplacementDecision }`. `OpResult = { ok: true } | { ok: false; error: string }`. `BulkOutcome = { requestId: string; label: string; ok: boolean; error?: string }`. Every task from 6 onward (via `index.tsx`) consumes this hook's return shape.

This task fixes bugs #1, #2, #3, and #4 (see the map at the top of this plan). Note per Global Constraints: this task's approve-flow is covered only indirectly by the deny-flow tests below (sample/distribution fixtures needed for the approve flow are heavy — see rationale in Step 1); the approve flow is verified by hand in Task 12.

- [ ] **Step 1: Write the failing test**

Create `src/components/Sidebar/Tabs/EmployeeWorkspace/views/ReferralApproval/useApprovalData.test.tsx`:

```tsx
/* @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createMemoryDirectory } from "../../../../../../data/storage/memoryDirectory";
import type { DirectoryHandleLike } from "../../../../../../data/storage/fileSystemAccess";
import { clearSession, writeSession } from "../../../../../../auth/authSession";
import {
  createEmptyUserManagementState,
  writeUserManagementState,
  type FeaturePermission,
} from "../../../../../../auth/userManagement";
import {
  appendReferralRequest,
  loadReferralLog,
  updateReferralStatus,
} from "../../../../../../data/referral/referralStorage";
import type { ReferralRequest } from "../../../../../../data/referral/referralTypes";
import { useApprovalData } from "./useApprovalData";

afterEach(() => clearSession());

function setupSupervisor(): void {
  writeSession({ role: "supervisor", username: "sup-1", loginAt: new Date().toISOString() });
  const base = createEmptyUserManagementState();
  const featurePermissions: FeaturePermission[] = [
    ...base.featurePermissions.filter(
      (f) => !(f.role === "supervisor" && (f.featureId === "approve-referrals" || f.featureId === "approve-replacements"))
    ),
    { role: "supervisor", featureId: "approve-referrals", enabled: true },
    { role: "supervisor", featureId: "approve-replacements", enabled: true },
  ];
  writeUserManagementState({ ...base, featurePermissions }, false);
}

const mockReferral = (id: string, month: string): ReferralRequest => ({
  requestId: id,
  monthFolderName: month,
  fromEmployee: "alice",
  toEmployee: "bob",
  xrayImageIds: [`img-${id}`],
  reason: "Needs secondary review",
  requestedAt: new Date().toISOString(),
  requestedBy: "alice",
  status: "pending",
});

describe("useApprovalData deny-flow regressions", () => {
  it("rejects denying a request that another reviewer already decided (idempotency)", async () => {
    setupSupervisor();
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    const req = mockReferral("req-1", "4-april-2026");
    await appendReferralRequest(root, "4-april-2026", req);
    await updateReferralStatus(root, "4-april-2026", "req-1", {
      status: "approved", reviewedBy: "sup-2", reviewedAt: new Date().toISOString(),
    });

    const { result } = renderHook(() => useApprovalData(root));
    await waitFor(() => expect(result.current.loadState).toBe("ready"));
    act(() => result.current.setSelMonth("4-april-2026"));
    await waitFor(() => expect(result.current.referrals).toHaveLength(1));

    const outcome = await result.current.denyReferral(req, "too late");
    expect(outcome.ok).toBe(false);

    const log = await loadReferralLog(root, "4-april-2026");
    expect(log.requests[0].status).toBe("approved");
    expect(log.requests[0].history).toHaveLength(1);
  });

  it("writes the decision to the request's own month even when a different month is selected in the UI", async () => {
    setupSupervisor();
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    const req = mockReferral("req-2", "3-march-2026");
    await appendReferralRequest(root, "3-march-2026", req);

    const { result } = renderHook(() => useApprovalData(root));
    await waitFor(() => expect(result.current.loadState).toBe("ready"));
    act(() => result.current.setSelMonth("4-april-2026")); // reviewer has a different month open

    const outcome = await result.current.denyReferral(req, "wrong port");
    expect(outcome.ok).toBe(true);

    const marchLog = await loadReferralLog(root, "3-march-2026");
    expect(marchLog.requests[0].status).toBe("denied");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/Sidebar/Tabs/EmployeeWorkspace/views/ReferralApproval/useApprovalData.test.tsx`
Expected: FAIL — cannot find module `./useApprovalData`.

- [ ] **Step 3: Write the hook**

Create `src/components/Sidebar/Tabs/EmployeeWorkspace/views/ReferralApproval/useApprovalData.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import { readSession } from "../../../../../../auth/authSession";
import {
  hasFeature,
  readUserManagementState,
  subscribeToUserManagementChanges,
} from "../../../../../../auth/userManagement";
import {
  assertRequestPending,
  assertSamplesOwnedBy,
} from "../../../../../../data/approvals/approvalGuards";
import {
  appendDistributionEvents,
  loadOrDeriveDistributionCurrent,
} from "../../../../../../data/distribution/distributionStorage";
import { buildReassignEvent } from "../../../../../../data/distribution/distributionLog";
import type { DistributionEntry } from "../../../../../../data/distribution/distributionTypes";
import { executeReplacement } from "../../../../../../data/distribution/replacement";
import type { MonthFolderInfo } from "../../../../../../data/population/monthFolder";
import {
  listMonthFolders,
  loadMonthPopulationFinal,
} from "../../../../../../data/population/populationStorage";
import type { PreparedPopulationRow } from "../../../../../../data/population/populationTypes";
import {
  loadReferralLog,
  loadReplacementLog,
  updateReferralStatus,
  updateReplacementStatus,
} from "../../../../../../data/referral/referralStorage";
import type { ReferralRequest, ReplacementRequest } from "../../../../../../data/referral/referralTypes";
import { loadSampleMaster } from "../../../../../../data/sampling/sampleStorage";
import type { DirectoryHandleLike } from "../../../../../../data/storage/fileSystemAccess";

export type LoadState = "idle" | "loading" | "ready" | "error";
export type OpResult = { ok: true } | { ok: false; error: string };
export type BulkOutcome = { requestId: string; label: string; ok: boolean; error?: string };

export function useApprovalData(directoryHandle: DirectoryHandleLike) {
  const session = readSession();
  const username = session?.username ?? "";
  const role = session?.role ?? "employee";

  const [, forcePermissionRefresh] = useState(0);
  useEffect(() => subscribeToUserManagementChanges(() => forcePermissionRefresh((n) => n + 1)), []);
  const userManagementState = readUserManagementState();
  const canApproveReferrals = hasFeature(userManagementState.featurePermissions, role, "approve-referrals");
  const canApproveReplacements = hasFeature(userManagementState.featurePermissions, role, "approve-replacements");

  const userDisplayMap: Record<string, string> = {};
  for (const u of userManagementState.users) userDisplayMap[u.username] = u.displayName;

  const [months, setMonths] = useState<MonthFolderInfo[]>([]);
  const [selMonth, setSelMonth] = useState("");
  const [referrals, setReferrals] = useState<ReferralRequest[]>([]);
  const [replacements, setReplacements] = useState<ReplacementRequest[]>([]);
  const [sampleDetails, setSampleDetails] = useState<Record<string, DistributionEntry | PreparedPopulationRow>>({});
  const [loadState, setLoadState] = useState<LoadState>("idle");

  // Bug #4: guards a slow load for a previously-selected month from clobbering
  // the results of a later selection.
  const loadTokenRef = useRef(0);

  useEffect(() => {
    listMonthFolders(directoryHandle)
      .then((ms) => {
        setMonths(ms);
        if (ms.length > 0) setSelMonth((cur) => cur || ms[ms.length - 1]!.folderName);
        else setLoadState("ready");
      })
      .catch(() => setLoadState("error"));
  }, [directoryHandle]);

  const loadData = useCallback(async () => {
    if (!selMonth) return;
    const token = ++loadTokenRef.current;
    setLoadState("loading");
    try {
      const [refLog, repLog] = await Promise.all([
        loadReferralLog(directoryHandle, selMonth),
        loadReplacementLog(directoryHandle, selMonth),
      ]);
      const sample = await loadSampleMaster(directoryHandle, selMonth);
      const detailMap: Record<string, DistributionEntry | PreparedPopulationRow> = {};
      if (sample) {
        const distribution = await loadOrDeriveDistributionCurrent(directoryHandle, selMonth, sample.rows);
        for (const row of sample.rows) detailMap[row.xrayImageId] = row;
        for (const entry of distribution?.entries ?? []) detailMap[entry.xrayImageId] = entry;
      }
      if (token !== loadTokenRef.current) return; // superseded by a newer month selection

      const visibleReferrals = canApproveReferrals
        ? refLog.requests
        : refLog.requests.filter((r) => r.fromEmployee === username);
      const visibleReplacements = canApproveReplacements
        ? repLog.requests
        : repLog.requests.filter((r) => r.employeeUsername === username);

      setSampleDetails(detailMap);
      setReferrals(visibleReferrals);
      setReplacements(visibleReplacements);
      setLoadState("ready");
    } catch {
      if (token === loadTokenRef.current) setLoadState("error");
    }
  }, [directoryHandle, selMonth, username, canApproveReferrals, canApproveReplacements]);

  useEffect(() => { void loadData(); }, [loadData]);

  // Bug #1 + #3: every mutation re-checks the request's current status against
  // a fresh load, and always keys writes off request.monthFolderName — never
  // the UI's selected month, which may point at a different month entirely.

  async function approveReferral(request: ReferralRequest, notes: string): Promise<OpResult> {
    const now = new Date().toISOString();
    const freshLog = await loadReferralLog(directoryHandle, request.monthFolderName);
    const fresh = freshLog.requests.find((r) => r.requestId === request.requestId);
    const pendingCheck = assertRequestPending(fresh?.status ?? request.status);
    if (!pendingCheck.ok) return pendingCheck;

    // Bug #2: verify every referred sample is still owned by the requester
    // before reassigning — it may have moved via a second referral/replacement.
    const sample = await loadSampleMaster(directoryHandle, request.monthFolderName);
    const distribution = sample
      ? await loadOrDeriveDistributionCurrent(directoryHandle, request.monthFolderName, sample.rows)
      : null;
    const ownershipCheck = assertSamplesOwnedBy(distribution, request.xrayImageIds, request.fromEmployee);
    if (!ownershipCheck.ok) return ownershipCheck;

    const events = request.xrayImageIds.map((id) =>
      buildReassignEvent({
        xrayImageId: id,
        assignedTo: request.fromEmployee,
        reassignedTo: request.toEmployee,
        eventBy: username,
        notes: `إحالة من ${request.fromEmployee} — ${request.reason}`,
      })
    );
    const distResult = await appendDistributionEvents(directoryHandle, request.monthFolderName, events);
    if (!distResult.ok) return { ok: false, error: distResult.error };

    if (sample) await loadOrDeriveDistributionCurrent(directoryHandle, request.monthFolderName, sample.rows);

    const updateResult = await updateReferralStatus(directoryHandle, request.monthFolderName, request.requestId, {
      status: "approved", reviewedBy: username, reviewedAt: now, reviewNotes: notes.trim() || undefined,
    });
    if (updateResult.ok) await loadData();
    return updateResult;
  }

  async function denyReferral(request: ReferralRequest, notes: string): Promise<OpResult> {
    const freshLog = await loadReferralLog(directoryHandle, request.monthFolderName);
    const fresh = freshLog.requests.find((r) => r.requestId === request.requestId);
    const pendingCheck = assertRequestPending(fresh?.status ?? request.status);
    if (!pendingCheck.ok) return pendingCheck;

    const result = await updateReferralStatus(directoryHandle, request.monthFolderName, request.requestId, {
      status: "denied", reviewedBy: username, reviewedAt: new Date().toISOString(), reviewNotes: notes.trim() || undefined,
    });
    if (result.ok) await loadData();
    return result;
  }

  async function approveReplacement(request: ReplacementRequest, notes: string): Promise<OpResult> {
    const now = new Date().toISOString();
    const freshLog = await loadReplacementLog(directoryHandle, request.monthFolderName);
    const fresh = freshLog.requests.find((r) => r.requestId === request.requestId);
    const pendingCheck = assertRequestPending(fresh?.status ?? request.status);
    if (!pendingCheck.ok) return pendingCheck;

    let replacementRow: PreparedPopulationRow | null = null;
    try {
      const population = await loadMonthPopulationFinal(directoryHandle, request.monthFolderName);
      replacementRow = (population?.rows ?? []).find(
        (r) => (r as PreparedPopulationRow).xrayImageId === request.replacementXrayImageId
      ) as PreparedPopulationRow ?? null;
    } catch { /* fall through to legacy path */ }

    if (!replacementRow) {
      if (request.replacementRowData) {
        replacementRow = request.replacementRowData as unknown as PreparedPopulationRow;
      } else {
        return { ok: false, error: "تعذر إيجاد بيانات سطر البديل في مجتمع الشهر." };
      }
    }

    const sample = await loadSampleMaster(directoryHandle, request.monthFolderName);
    if (!sample) return { ok: false, error: "تعذر تحميل ملف العينة للتحقق من الاستبدال." };

    const distribution = await loadOrDeriveDistributionCurrent(directoryHandle, request.monthFolderName, sample.rows);
    const deadEntry = distribution?.entries.find(
      (entry) => entry.xrayImageId === request.originalXrayImageId && entry.assignedTo === request.employeeUsername
    );
    if (!deadEntry) return { ok: false, error: "تعذر إيجاد العينة الأصلية في التوزيع الحالي." };

    const result = await executeReplacement({
      directoryHandle,
      monthFolderName: request.monthFolderName,
      deadEntry,
      replacementRow,
      reason: `استبدال معتمد — ${request.reason}`,
      eventBy: username,
    });
    if (!result.ok) return { ok: false, error: result.error };

    await loadOrDeriveDistributionCurrent(directoryHandle, request.monthFolderName, result.updatedSample.rows);

    const updateResult = await updateReplacementStatus(directoryHandle, request.monthFolderName, request.requestId, {
      status: "approved", reviewedBy: username, reviewedAt: now, reviewNotes: notes.trim() || undefined,
    });
    if (updateResult.ok) await loadData();
    return updateResult;
  }

  async function denyReplacement(request: ReplacementRequest, notes: string): Promise<OpResult> {
    const freshLog = await loadReplacementLog(directoryHandle, request.monthFolderName);
    const fresh = freshLog.requests.find((r) => r.requestId === request.requestId);
    const pendingCheck = assertRequestPending(fresh?.status ?? request.status);
    if (!pendingCheck.ok) return pendingCheck;

    const result = await updateReplacementStatus(directoryHandle, request.monthFolderName, request.requestId, {
      status: "denied", reviewedBy: username, reviewedAt: new Date().toISOString(), reviewNotes: notes.trim() || undefined,
    });
    if (result.ok) await loadData();
    return result;
  }

  async function bulkReferralDecision(
    requests: ReferralRequest[], action: "approve" | "deny", notes: string
  ): Promise<BulkOutcome[]> {
    const outcomes: BulkOutcome[] = [];
    for (const request of requests) {
      const result = action === "approve" ? await approveReferral(request, notes) : await denyReferral(request, notes);
      outcomes.push({
        requestId: request.requestId,
        label: `${userDisplayMap[request.fromEmployee] ?? request.fromEmployee} ← ${userDisplayMap[request.toEmployee] ?? request.toEmployee}`,
        ok: result.ok,
        error: result.ok ? undefined : result.error,
      });
    }
    return outcomes;
  }

  async function bulkReplacementDecision(
    requests: ReplacementRequest[], action: "approve" | "deny", notes: string
  ): Promise<BulkOutcome[]> {
    const outcomes: BulkOutcome[] = [];
    for (const request of requests) {
      const result = action === "approve" ? await approveReplacement(request, notes) : await denyReplacement(request, notes);
      outcomes.push({
        requestId: request.requestId,
        label: `${request.originalXrayImageId} → ${request.replacementXrayImageId}`,
        ok: result.ok,
        error: result.ok ? undefined : result.error,
      });
    }
    return outcomes;
  }

  return {
    username, role, canApproveReferrals, canApproveReplacements,
    userDisplayMap, months, selMonth, setSelMonth,
    referrals, replacements, sampleDetails, loadState, reload: loadData,
    approveReferral, denyReferral, approveReplacement, denyReplacement,
    bulkReferralDecision, bulkReplacementDecision,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/Sidebar/Tabs/EmployeeWorkspace/views/ReferralApproval/useApprovalData.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Log the edit and commit**

Add to `docs/EDIT_LOG.md`:

```markdown
## v42.3 — 2026-07-07 — Referral approval rework (4/11): useApprovalData hook

**File:** `src/components/Sidebar/Tabs/EmployeeWorkspace/views/ReferralApproval/useApprovalData.ts`

**Before:** file did not exist — this logic lived inline in the 688-line `ReferralApproval.tsx`, with no idempotency check, no ownership re-verification, decisions written against `selMonth` instead of the request's own month, and no stale-load guard across month switches.

**After:** extracted into a hook; every mutation re-checks fresh status (`assertRequestPending`), referrals re-check sample ownership (`assertSamplesOwnedBy`), all writes key off `request.monthFolderName`, and a `loadTokenRef` discards results from a superseded month selection.
```

```bash
git add "src/components/Sidebar/Tabs/EmployeeWorkspace/views/ReferralApproval/useApprovalData.ts" "src/components/Sidebar/Tabs/EmployeeWorkspace/views/ReferralApproval/useApprovalData.test.tsx" docs/EDIT_LOG.md
git commit -m "feat(referral-approval): extract useApprovalData hook with idempotency/ownership/month-key fixes"
```

---

### Task 5: `RequestTimeline` component

**Files:**
- Create: `src/components/Sidebar/Tabs/EmployeeWorkspace/views/ReferralApproval/RequestTimeline.tsx`

**Interfaces:**
- Consumes: `DecisionEvent` type from `../../../../../../data/approvals/approvalTypes`.
- Produces: `export default function RequestTimeline(props: { requestedAt: string; requestedBy: string; history: DecisionEvent[] | undefined; userDisplayMap: Record<string, string> })`. Consumed by Task 6 (`RequestCard`) and Task 10 (`HistoryView`).

No test — purely presentational; verified in Task 12's manual pass alongside the cards that render it.

- [ ] **Step 1: Write the component**

Create `src/components/Sidebar/Tabs/EmployeeWorkspace/views/ReferralApproval/RequestTimeline.tsx`:

```tsx
import type { DecisionEvent } from "../../../../../../data/approvals/approvalTypes";

type Props = {
  requestedAt: string;
  requestedBy: string;
  history: DecisionEvent[] | undefined;
  userDisplayMap: Record<string, string>;
};

const STATUS_LABEL: Record<DecisionEvent["status"], string> = {
  approved: "تمت الموافقة",
  denied: "تم الرفض",
};

function formatAt(iso: string): string {
  return new Date(iso).toLocaleString("ar-SA-u-nu-latn", {
    year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export default function RequestTimeline({ requestedAt, requestedBy, history, userDisplayMap }: Props) {
  const displayName = (u: string) => userDisplayMap[u] ?? u;
  return (
    <ol className="ew-timeline">
      <li className="ew-timeline-item">
        <span className="ew-timeline-dot" />
        <div className="ew-timeline-body">
          <span className="ew-timeline-meta">أُرسل الطلب — {displayName(requestedBy)} · {formatAt(requestedAt)}</span>
        </div>
      </li>
      {(history ?? []).map((event, i) => (
        <li key={`${event.reviewedAt}-${i}`} className={`ew-timeline-item ew-timeline-item--${event.status}`}>
          <span className="ew-timeline-dot" />
          <div className="ew-timeline-body">
            <span className="ew-timeline-meta">
              {STATUS_LABEL[event.status]} — {displayName(event.reviewedBy)} · {formatAt(event.reviewedAt)}
            </span>
            {event.reviewNotes && <p className="ew-timeline-note">{event.reviewNotes}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}
```

- [ ] **Step 2: Log the edit and commit**

Add to `docs/EDIT_LOG.md`:

```markdown
## v42.4 — 2026-07-07 — Referral approval rework (5/11): RequestTimeline component

**File:** `src/components/Sidebar/Tabs/EmployeeWorkspace/views/ReferralApproval/RequestTimeline.tsx`

**Before:** file did not exist — a request's review notes were a single static paragraph with no history.

**After:** renders the full chronological chain (submission + every decision event with reviewer/time/notes), consumed by RequestCard and HistoryView.
```

```bash
git add "src/components/Sidebar/Tabs/EmployeeWorkspace/views/ReferralApproval/RequestTimeline.tsx" docs/EDIT_LOG.md
git commit -m "feat(referral-approval): add RequestTimeline component"
```

---

### Task 6: `RequestCard` component (unified referral/replacement card)

**Files:**
- Create: `src/components/Sidebar/Tabs/EmployeeWorkspace/views/ReferralApproval/RequestCard.tsx`

**Interfaces:**
- Consumes: `RequestTimeline` (Task 5); `ReferralRequest`, `ReplacementRequest` types.
- Produces: `export default function RequestCard(props)`; `export function isReferral(r: ReferralRequest | ReplacementRequest): r is ReferralRequest`. Task 8 (`RequestList`) renders this per row; Task 11 (`index.tsx`) imports `isReferral` for dialog dispatch.

- [ ] **Step 1: Write the component**

Create `src/components/Sidebar/Tabs/EmployeeWorkspace/views/ReferralApproval/RequestCard.tsx`:

```tsx
import RequestTimeline from "./RequestTimeline";
import type { ReferralRequest, ReplacementRequest } from "../../../../../../data/referral/referralTypes";
import type { DistributionEntry } from "../../../../../../data/distribution/distributionTypes";
import type { PreparedPopulationRow } from "../../../../../../data/population/populationTypes";

type CardRequest = ReferralRequest | ReplacementRequest;
type SampleDetail = DistributionEntry | PreparedPopulationRow;

export function isReferral(request: CardRequest): request is ReferralRequest {
  return "toEmployee" in request;
}

type Props = {
  request: CardRequest;
  userDisplayMap: Record<string, string>;
  sampleDetails: Record<string, SampleDetail>;
  expanded: boolean;
  onToggleExpand: () => void;
  canReview: boolean;
  onApprove: () => void;
  onDeny: () => void;
  selectable: boolean;
  selected: boolean;
  onToggleSelect: () => void;
};

const STATUS_LABELS: Record<string, string> = { pending: "معلق", approved: "مقبول", denied: "مرفوض" };
const STATUS_CLASSES: Record<string, string> = { pending: "ew-ref-badge-pending", approved: "ew-ref-badge-approved", denied: "ew-ref-badge-denied" };

function getDetailRow(detail: SampleDetail | undefined): PreparedPopulationRow | undefined {
  if (!detail) return undefined;
  return "row" in detail ? detail.row : detail;
}

function SampleDetailChip({ id, detail, prefix, tone = "neutral" }: {
  id: string; detail: SampleDetail | undefined; prefix?: string; tone?: "neutral" | "danger" | "success";
}) {
  const row = getDetailRow(detail);
  const bg = tone === "danger" ? "#fee2e2" : tone === "success" ? "#dcfce7" : "#f8fafc";
  const color = tone === "danger" ? "#7f1d1d" : tone === "success" ? "#14532d" : "#334155";
  return (
    <span className="ew-referral-id-chip" style={{ background: bg, color, display: "inline-flex", flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
      <span className="dt-mono">{prefix ? `${prefix}: ${id}` : id}</span>
      {row && (
        <span style={{ fontSize: 11, color }}>
          {[row.portName, row.stage, row.plateOrContainerNumber].filter(Boolean).join(" · ")}
        </span>
      )}
    </span>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ar-SA-u-nu-latn", { year: "numeric", month: "long", day: "numeric" });
}

export default function RequestCard(props: Props) {
  const { request, userDisplayMap, sampleDetails, expanded, onToggleExpand, canReview, onApprove, onDeny, selectable, selected, onToggleSelect } = props;
  const showActions = canReview && request.status === "pending";
  const referral = isReferral(request);

  return (
    <article className={`ew-referral-card${selected ? " ew-referral-card--selected" : ""}`}>
      <div className="ew-referral-card-header">
        {selectable && (
          <input
            type="checkbox"
            className="ew-request-checkbox"
            checked={selected}
            onChange={onToggleSelect}
            aria-label="تحديد الطلب"
          />
        )}
        <div className="ew-referral-card-meta">
          {referral ? (
            <>
              <div className="ew-referral-route">
                <span className="ew-referral-emp">{userDisplayMap[request.fromEmployee] ?? request.fromEmployee}</span>
                <span className="ew-referral-arrow">←</span>
                <span className="ew-referral-emp">{userDisplayMap[request.toEmployee] ?? request.toEmployee}</span>
              </div>
              <div className="ew-referral-card-sub">
                <span>{request.xrayImageIds.length} عينة</span>
                <span>·</span>
                <span>{formatDate(request.requestedAt)}</span>
              </div>
            </>
          ) : (
            <>
              <div className="ew-referral-route">
                <span className="ew-referral-emp" style={{ fontSize: 12, color: "#64748b" }}>أصلي</span>
                <span className="dt-mono" style={{ fontSize: 13 }}>{request.originalXrayImageId}</span>
                <span className="ew-referral-arrow">←</span>
                <span className="ew-referral-emp" style={{ fontSize: 12, color: "#64748b" }}>بديل</span>
                <span className="dt-mono" style={{ fontSize: 13 }}>{request.replacementXrayImageId}</span>
              </div>
              <div className="ew-referral-card-sub">
                <span>موظف: {userDisplayMap[request.employeeUsername] ?? request.employeeUsername}</span>
                <span>·</span>
                <span>{formatDate(request.requestedAt)}</span>
              </div>
            </>
          )}
          <p className="ew-referral-reason">السبب: {request.reason}</p>
          <RequestTimeline requestedAt={request.requestedAt} requestedBy={request.requestedBy} history={request.history} userDisplayMap={userDisplayMap} />
        </div>
        <div className="ew-referral-card-actions">
          <span className={`ew-ref-badge ${STATUS_CLASSES[request.status] ?? ""}`}>{STATUS_LABELS[request.status] ?? request.status}</span>
          {showActions && (
            <>
              <button type="button" className="ew-btn-primary ew-btn-sm" onClick={onApprove}>موافقة</button>
              <button type="button" className="ew-btn-deny ew-btn-sm" onClick={onDeny}>رفض</button>
            </>
          )}
          <button type="button" className="ew-btn-secondary ew-btn-sm" onClick={onToggleExpand}>
            {expanded ? "إخفاء العينات" : "عرض العينات"}
          </button>
        </div>
      </div>
      {expanded && referral && (
        <div className="ew-referral-ids-list">
          {request.xrayImageIds.map((id) => (
            <SampleDetailChip key={id} id={id} detail={sampleDetails[id]} />
          ))}
        </div>
      )}
      {expanded && !referral && (
        <div className="ew-referral-ids-list" style={{ flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <SampleDetailChip id={request.originalXrayImageId} detail={sampleDetails[request.originalXrayImageId]} prefix="أصلي" tone="danger" />
            <SampleDetailChip
              id={request.replacementXrayImageId}
              detail={sampleDetails[request.replacementXrayImageId] ?? (request.replacementRowData as PreparedPopulationRow | undefined)}
              prefix="بديل" tone="success"
            />
          </div>
        </div>
      )}
    </article>
  );
}
```

- [ ] **Step 2: Log the edit and commit**

Add to `docs/EDIT_LOG.md`:

```markdown
## v42.5 — 2026-07-07 — Referral approval rework (6/11): unified RequestCard

**File:** `src/components/Sidebar/Tabs/EmployeeWorkspace/views/ReferralApproval/RequestCard.tsx`

**Before:** file did not exist — the old `ReferralCard`/`ReplacementCard` were separate near-duplicate components inside the monolithic file.

**After:** one `RequestCard` discriminates via the exported `isReferral` type guard, adds a bulk-selection checkbox slot, and embeds `RequestTimeline` instead of a single static review-notes line.
```

```bash
git add "src/components/Sidebar/Tabs/EmployeeWorkspace/views/ReferralApproval/RequestCard.tsx" docs/EDIT_LOG.md
git commit -m "feat(referral-approval): unify referral/replacement cards into RequestCard"
```

---

### Task 7: `SummaryBar` component

**Files:**
- Create: `src/components/Sidebar/Tabs/EmployeeWorkspace/views/ReferralApproval/SummaryBar.tsx`

**Interfaces:**
- Produces: `export default function SummaryBar(props: { counts: Record<"all"|"pending"|"approved"|"denied", number>; active: "all"|"pending"|"approved"|"denied"; onSelect: (f) => void })`. Consumed by Task 11 (`index.tsx`).

This fixes bug #6 — status chips get their own visually distinct style, no longer sharing `.ew-referral-status-tab` with the section tabs.

- [ ] **Step 1: Write the component**

Create `src/components/Sidebar/Tabs/EmployeeWorkspace/views/ReferralApproval/SummaryBar.tsx`:

```tsx
type StatusFilter = "all" | "pending" | "approved" | "denied";

type Props = {
  counts: Record<StatusFilter, number>;
  active: StatusFilter;
  onSelect: (filter: StatusFilter) => void;
};

const ORDER: StatusFilter[] = ["pending", "approved", "denied", "all"];
const LABELS: Record<StatusFilter, string> = { pending: "معلّق", approved: "مقبول", denied: "مرفوض", all: "الكل" };

export default function SummaryBar({ counts, active, onSelect }: Props) {
  return (
    <div className="ew-summary-bar" role="tablist" aria-label="تصفية حسب الحالة">
      {ORDER.map((key) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={active === key}
          className={`ew-summary-chip${active === key ? " active" : ""}${key === "pending" && counts.pending > 0 ? " has-pending" : ""}`}
          onClick={() => onSelect(key)}
        >
          {LABELS[key]}
          <span className="ew-status-count">{counts[key]}</span>
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Log the edit and commit**

Add to `docs/EDIT_LOG.md`:

```markdown
## v42.6 — 2026-07-07 — Referral approval rework (7/11): SummaryBar component

**File:** `src/components/Sidebar/Tabs/EmployeeWorkspace/views/ReferralApproval/SummaryBar.tsx`

**Before:** file did not exist — status filters reused the exact same `.ew-referral-status-tab` class as the referral/replacement section tabs, making the two controls visually indistinguishable.

**After:** `SummaryBar` renders status counts as `.ew-summary-chip` pills with their own style (Task 11 adds the CSS).
```

```bash
git add "src/components/Sidebar/Tabs/EmployeeWorkspace/views/ReferralApproval/SummaryBar.tsx" docs/EDIT_LOG.md
git commit -m "feat(referral-approval): add SummaryBar status-filter component"
```

---

### Task 8: `RequestList` component (pending queue, bulk actions, decided list)

**Files:**
- Create: `src/components/Sidebar/Tabs/EmployeeWorkspace/views/ReferralApproval/RequestList.tsx`

**Interfaces:**
- Consumes: `RequestCard` (Task 6); `BulkOutcome` type (Task 4).
- Produces: `export default function RequestList(props: { requests: (ReferralRequest|ReplacementRequest)[]; bulkEnabled: boolean; userDisplayMap; sampleDetails; canReview: boolean; onApprove; onDeny; onBulk: (requests, action, notes) => Promise<BulkOutcome[]> })`. Consumed by Task 11 (`index.tsx`), once per section.

One `RequestList` handles both the pending queue (bulk-enabled, oldest-first) and the decided list (no bulk, newest-first) — which one it is is purely a function of `bulkEnabled` (true only when the caller's active status filter is `"pending"`), avoiding two near-duplicate list components.

- [ ] **Step 1: Write the component**

Create `src/components/Sidebar/Tabs/EmployeeWorkspace/views/ReferralApproval/RequestList.tsx`:

```tsx
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import RequestCard from "./RequestCard";
import type { ReferralRequest, ReplacementRequest } from "../../../../../../data/referral/referralTypes";
import type { DistributionEntry } from "../../../../../../data/distribution/distributionTypes";
import type { PreparedPopulationRow } from "../../../../../../data/population/populationTypes";
import type { BulkOutcome } from "./useApprovalData";

type CardRequest = ReferralRequest | ReplacementRequest;
type SampleDetail = DistributionEntry | PreparedPopulationRow;

type Props = {
  requests: CardRequest[];
  bulkEnabled: boolean;
  userDisplayMap: Record<string, string>;
  sampleDetails: Record<string, SampleDetail>;
  canReview: boolean;
  onApprove: (request: CardRequest) => void;
  onDeny: (request: CardRequest) => void;
  onBulk: (requests: CardRequest[], action: "approve" | "deny", notes: string) => Promise<BulkOutcome[]>;
};

export default function RequestList({ requests, bulkEnabled, userDisplayMap, sampleDetails, canReview, onApprove, onDeny, onBulk }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<"approve" | "deny" | null>(null);
  const [bulkNotes, setBulkNotes] = useState("");
  const [bulkResult, setBulkResult] = useState<BulkOutcome[] | null>(null);
  const [bulkRunning, setBulkRunning] = useState(false);

  // Bug #4: selection only makes sense on the pending queue — drop it whenever
  // the view switches to a decided (non-bulk) filter.
  useEffect(() => { setSelected(new Set()); }, [bulkEnabled]);

  const sorted = requests.slice().sort((a, b) =>
    bulkEnabled ? a.requestedAt.localeCompare(b.requestedAt) : b.requestedAt.localeCompare(a.requestedAt)
  );
  const selectedRequests = sorted.filter((r) => selected.has(r.requestId));

  function toggleSelect(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function confirmBulk(): Promise<void> {
    if (!bulkAction) return;
    setBulkRunning(true);
    const outcomes = await onBulk(selectedRequests, bulkAction, bulkNotes);
    setBulkRunning(false);
    setBulkResult(outcomes);
    setSelected(new Set());
    setBulkAction(null);
    setBulkNotes("");
  }

  return (
    <div className="ew-referral-list">
      {bulkEnabled && canReview && selected.size > 0 && (
        <div className="ew-bulk-bar">
          <span className="ew-bulk-bar-count">تم تحديد {selected.size} طلب</span>
          <button type="button" className="ew-btn-primary ew-btn-sm" onClick={() => setBulkAction("approve")}>موافقة على المحدد</button>
          <button type="button" className="ew-btn-deny ew-btn-sm" onClick={() => setBulkAction("deny")}>رفض المحدد</button>
          <button type="button" className="ew-btn-secondary ew-btn-sm" onClick={() => setSelected(new Set())}>إلغاء التحديد</button>
        </div>
      )}

      {bulkResult && (
        <div className={bulkResult.every((o) => o.ok) ? "ew-msg-ok" : "ew-msg-error"} role="status">
          {bulkResult.filter((o) => o.ok).length} نجحت، {bulkResult.filter((o) => !o.ok).length} فشلت
          {bulkResult.some((o) => !o.ok) && `: ${bulkResult.filter((o) => !o.ok).map((o) => o.error).join(" — ")}`}
          <button type="button" style={{ float: "left", background: "none", border: "none", cursor: "pointer" }} onClick={() => setBulkResult(null)}>
            <X size={14} />
          </button>
        </div>
      )}

      {sorted.map((request) => (
        <RequestCard
          key={request.requestId}
          request={request}
          userDisplayMap={userDisplayMap}
          sampleDetails={sampleDetails}
          expanded={expandedId === request.requestId}
          onToggleExpand={() => setExpandedId((cur) => (cur === request.requestId ? null : request.requestId))}
          canReview={canReview}
          onApprove={() => onApprove(request)}
          onDeny={() => onDeny(request)}
          selectable={bulkEnabled && canReview && request.status === "pending"}
          selected={selected.has(request.requestId)}
          onToggleSelect={() => toggleSelect(request.requestId)}
        />
      ))}

      {bulkAction && (
        <div className="ew-modal-backdrop" role="dialog" aria-modal="true">
          <div className="ew-replace-modal">
            <div className="ew-replace-header">
              <h3>{bulkAction === "approve" ? `تأكيد الموافقة على ${selectedRequests.length} طلب` : `تأكيد رفض ${selectedRequests.length} طلب`}</h3>
              <button type="button" className="ew-modal-close" onClick={() => setBulkAction(null)} aria-label="إغلاق"><X size={16} /></button>
            </div>
            <div className="ew-replace-reason">
              <ul style={{ margin: "0 0 8px", paddingInlineStart: 18 }}>
                {selectedRequests.map((r) => <li key={r.requestId}>{r.requestId}</li>)}
              </ul>
              <label className="ew-field-label" htmlFor="bulk-notes">ملاحظة (اختياري، تُطبَّق على الكل)</label>
              <textarea id="bulk-notes" className="ew-input ew-textarea" rows={2} value={bulkNotes} onChange={(e) => setBulkNotes(e.target.value)} />
            </div>
            <div className="ew-replace-reason" style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8, paddingBottom: 16 }}>
              <button type="button" className="ew-btn-secondary" onClick={() => setBulkAction(null)} disabled={bulkRunning}>إلغاء</button>
              <button
                type="button"
                className={bulkAction === "approve" ? "ew-btn-primary" : "ew-btn-deny"}
                onClick={() => void confirmBulk()}
                disabled={bulkRunning}
              >
                {bulkRunning ? "جارٍ التنفيذ…" : bulkAction === "approve" ? "تأكيد الموافقة" : "تأكيد الرفض"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Log the edit and commit**

Add to `docs/EDIT_LOG.md`:

```markdown
## v42.7 — 2026-07-07 — Referral approval rework (8/11): RequestList with bulk actions

**File:** `src/components/Sidebar/Tabs/EmployeeWorkspace/views/ReferralApproval/RequestList.tsx`

**Before:** file did not exist — no bulk approve/deny; individual `.map(...)` blocks inline in the monolithic component.

**After:** one list component sorts oldest-first with a sticky bulk bar + confirm modal when viewing pending, newest-first with no bulk controls otherwise; each bulk action re-validates every selected request individually (via the hook) and reports partial success/failure.
```

```bash
git add "src/components/Sidebar/Tabs/EmployeeWorkspace/views/ReferralApproval/RequestList.tsx" docs/EDIT_LOG.md
git commit -m "feat(referral-approval): add RequestList with bulk approve/deny"
```

---

### Task 9: `ReviewModal` component

**Files:**
- Create: `src/components/Sidebar/Tabs/EmployeeWorkspace/views/ReferralApproval/ReviewModal.tsx`

**Interfaces:**
- Produces: `export default function ReviewModal(props: { title: string; description: ReactNode; isApprove: boolean; onClose: () => void; onConfirm: (notes: string) => void })`. Consumed by Task 11 (`index.tsx`) for single-request approve/deny confirmation.

This is a near-verbatim move of the original file's `ReviewModal`, widening `description` from `string` to `ReactNode` so the caller can compose richer confirmation text if needed later.

- [ ] **Step 1: Write the component**

Create `src/components/Sidebar/Tabs/EmployeeWorkspace/views/ReferralApproval/ReviewModal.tsx`:

```tsx
import { useState, type ReactNode } from "react";
import { X } from "lucide-react";

type Props = {
  title: string;
  description: ReactNode;
  isApprove: boolean;
  onClose: () => void;
  onConfirm: (notes: string) => void;
};

export default function ReviewModal({ title, description, isApprove, onClose, onConfirm }: Props) {
  const [notes, setNotes] = useState("");

  return (
    <div className="ew-modal-backdrop" role="dialog" aria-modal="true">
      <div className="ew-replace-modal">
        <div className="ew-replace-header">
          <div>
            <h3>{title}</h3>
          </div>
          <button type="button" className="ew-modal-close" onClick={onClose} aria-label="إغلاق"><X size={16} /></button>
        </div>
        <div className="ew-replace-reason">
          <p style={{ margin: 0, color: "#475569" }}>{description}</p>
          <label className="ew-field-label" htmlFor="review-notes" style={{ marginTop: 12 }}>
            ملاحظة (اختياري)
          </label>
          <textarea
            id="review-notes"
            className="ew-input ew-textarea"
            rows={2}
            placeholder="أضف ملاحظة للموظف..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        <div className="ew-replace-reason" style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8, paddingBottom: 16 }}>
          <button type="button" className="ew-btn-secondary" onClick={onClose}>إلغاء</button>
          <button
            type="button"
            className={isApprove ? "ew-btn-primary" : "ew-btn-deny"}
            onClick={() => onConfirm(notes)}
          >
            {isApprove ? "تأكيد الموافقة" : "تأكيد الرفض"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Log the edit and commit**

Add to `docs/EDIT_LOG.md`:

```markdown
## v42.8 — 2026-07-07 — Referral approval rework (9/11): extract ReviewModal

**File:** `src/components/Sidebar/Tabs/EmployeeWorkspace/views/ReferralApproval/ReviewModal.tsx`

**Before:** file did not exist — `ReviewModal` was defined inline at the bottom of the monolithic `ReferralApproval.tsx`.

**After:** moved to its own file, `description` widened from `string` to `ReactNode`. Behavior unchanged.
```

```bash
git add "src/components/Sidebar/Tabs/EmployeeWorkspace/views/ReferralApproval/ReviewModal.tsx" docs/EDIT_LOG.md
git commit -m "refactor(referral-approval): extract ReviewModal into its own file"
```

---

### Task 10: `HistoryView` component (cross-month log)

**Files:**
- Create: `src/components/Sidebar/Tabs/EmployeeWorkspace/views/ReferralApproval/HistoryView.tsx`

**Interfaces:**
- Consumes: `listMonthFolders`, `loadReferralLog`, `loadReplacementLog` (history-aware since Task 3); `DataTable` component; `RequestTimeline` (Task 5).
- Produces: `export default function HistoryView(props: { directoryHandle; username; canApproveReferrals; canApproveReplacements; userDisplayMap })`. Consumed by Task 11 (`index.tsx`) for the «السجل» view tab.

- [ ] **Step 1: Write the component**

Create `src/components/Sidebar/Tabs/EmployeeWorkspace/views/ReferralApproval/HistoryView.tsx`:

```tsx
import { useEffect, useState } from "react";
import DataTable, { type DataTableCol } from "../../../../../../components/DataTable";
import { EmptyState, ErrorState, LoadingState } from "../../../../../../components/StateViews/StateViews";
import { listMonthFolders } from "../../../../../../data/population/populationStorage";
import { loadReferralLog, loadReplacementLog } from "../../../../../../data/referral/referralStorage";
import type { ReferralRequest } from "../../../../../../data/referral/referralTypes";
import type { DirectoryHandleLike } from "../../../../../../data/storage/fileSystemAccess";
import RequestTimeline from "./RequestTimeline";

type HistoryRow = {
  key: string;
  kind: "referral" | "replacement";
  monthFolderName: string;
  requester: string;
  details: string;
  reason: string;
  status: "pending" | "approved" | "denied";
  requestedAt: string;
  requestedBy: string;
  reviewedBy?: string;
  reviewedAt?: string;
  history: ReferralRequest["history"];
};

type Props = {
  directoryHandle: DirectoryHandleLike;
  username: string;
  canApproveReferrals: boolean;
  canApproveReplacements: boolean;
  userDisplayMap: Record<string, string>;
};

const STATUS_OPTIONS = [
  { value: "pending", label: "معلق" },
  { value: "approved", label: "مقبول" },
  { value: "denied", label: "مرفوض" },
];

const STATUS_BADGE_LABEL: Record<HistoryRow["status"], string> = { pending: "معلق", approved: "مقبول", denied: "مرفوض" };
const STATUS_BADGE_CLASS: Record<HistoryRow["status"], string> = { pending: "ew-ref-badge-pending", approved: "ew-ref-badge-approved", denied: "ew-ref-badge-denied" };

export default function HistoryView({ directoryHandle, username, canApproveReferrals, canApproveReplacements, userDisplayMap }: Props) {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [skippedMonths, setSkippedMonths] = useState<string[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run(): Promise<void> {
      setState("loading");
      try {
        const months = await listMonthFolders(directoryHandle);
        const collected: HistoryRow[] = [];
        const skipped: string[] = [];
        for (const month of months) {
          // Each month is loaded independently — one unreadable month must not
          // blank out every other month's history.
          try {
            const [refLog, repLog] = await Promise.all([
              loadReferralLog(directoryHandle, month.folderName),
              loadReplacementLog(directoryHandle, month.folderName),
            ]);
            for (const r of refLog.requests) {
              if (!canApproveReferrals && r.fromEmployee !== username) continue;
              collected.push({
                key: `referral-${r.requestId}`, kind: "referral", monthFolderName: month.folderName,
                requester: userDisplayMap[r.fromEmployee] ?? r.fromEmployee,
                details: `${r.xrayImageIds.length} عينة → ${userDisplayMap[r.toEmployee] ?? r.toEmployee}`,
                reason: r.reason, status: r.status, requestedAt: r.requestedAt, requestedBy: r.requestedBy,
                reviewedBy: r.reviewedBy, reviewedAt: r.reviewedAt, history: r.history,
              });
            }
            for (const r of repLog.requests) {
              if (!canApproveReplacements && r.employeeUsername !== username) continue;
              collected.push({
                key: `replacement-${r.requestId}`, kind: "replacement", monthFolderName: month.folderName,
                requester: userDisplayMap[r.employeeUsername] ?? r.employeeUsername,
                details: `${r.originalXrayImageId} → ${r.replacementXrayImageId}`,
                reason: r.reason, status: r.status, requestedAt: r.requestedAt, requestedBy: r.requestedBy,
                reviewedBy: r.reviewedBy, reviewedAt: r.reviewedAt, history: r.history,
              });
            }
          } catch {
            skipped.push(month.folderName);
          }
        }
        if (!cancelled) { setRows(collected); setSkippedMonths(skipped); setState("ready"); }
      } catch {
        if (!cancelled) setState("error");
      }
    }
    void run();
    return () => { cancelled = true; };
  }, [directoryHandle, username, canApproveReferrals, canApproveReplacements, userDisplayMap]);

  const columns: DataTableCol<HistoryRow>[] = [
    { id: "monthFolderName", label: "الشهر", widthFr: 1.2, accessor: (r) => r.monthFolderName },
    { id: "kind", label: "النوع", widthFr: 1, accessor: (r) => (r.kind === "referral" ? "إحالة" : "استبدال") },
    { id: "requester", label: "مقدّم الطلب", widthFr: 1.4, accessor: (r) => r.requester },
    { id: "details", label: "التفاصيل", widthFr: 2, accessor: (r) => r.details },
    { id: "status", label: "الحالة", widthFr: 1, filterKind: "status", statusOptions: STATUS_OPTIONS, accessor: (r) => r.status },
    { id: "requestedAt", label: "تاريخ الطلب", widthFr: 1.4, isDate: true, accessor: (r) => r.requestedAt },
    { id: "reviewedBy", label: "راجعه", widthFr: 1.2, accessor: (r) => (r.reviewedBy ? userDisplayMap[r.reviewedBy] ?? r.reviewedBy : null) },
    { id: "reviewedAt", label: "تاريخ المراجعة", widthFr: 1.4, isDate: true, accessor: (r) => r.reviewedAt ?? null },
  ];

  if (state === "loading") return <LoadingState />;
  if (state === "error") return <ErrorState description="تعذر تحميل سجل الطلبات." />;
  if (rows.length === 0 && skippedMonths.length === 0) {
    return <EmptyState title="لا يوجد سجل طلبات بعد" description="ستظهر هنا كل طلبات الإحالة والاستبدال من جميع الأشهر." />;
  }

  return (
    <>
      {skippedMonths.length > 0 && (
        <div className="ew-msg-error" role="alert" style={{ marginBottom: 12 }}>
          تعذر قراءة سجل الأشهر التالية، تم تخطيها: {skippedMonths.join("، ")}
        </div>
      )}
      <DataTable<HistoryRow>
        columns={columns}
        rows={rows}
        getRowKey={(r) => r.key}
        renderCell={(col, row) =>
          col.id === "status"
            ? <span className={`ew-ref-badge ${STATUS_BADGE_CLASS[row.status]}`}>{STATUS_BADGE_LABEL[row.status]}</span>
            : (col.accessor(row) ?? "—")
        }
        storageKey="ra-history-table"
        exportFileName="سجل-طلبات-الاعتماد"
        expandedKey={expandedKey}
        onRowClick={(row) => setExpandedKey((cur) => (cur === row.key ? null : row.key))}
        renderExpanded={(row) => (
          <div style={{ padding: "10px 16px" }}>
            {row.reason && <p style={{ margin: "0 0 8px", fontSize: 13, color: "#475569" }}>السبب: {row.reason}</p>}
            <RequestTimeline requestedAt={row.requestedAt} requestedBy={row.requestedBy} history={row.history} userDisplayMap={userDisplayMap} />
          </div>
        )}
      />
    </>
  );
}
```

- [ ] **Step 2: Log the edit and commit**

Add to `docs/EDIT_LOG.md`:

```markdown
## v42.9 — 2026-07-07 — Referral approval rework (10/11): cross-month HistoryView

**File:** `src/components/Sidebar/Tabs/EmployeeWorkspace/views/ReferralApproval/HistoryView.tsx`

**Before:** file did not exist — no way to see decided/all requests across months; the page only ever showed one month at a time.

**After:** aggregates referral + replacement requests across every processed month into a `DataTable` (search/filter/sort/XLSX export for free), row click expands the full `RequestTimeline`. Same visibility rule as the review queue (reviewers see all, employees see their own).
```

```bash
git add "src/components/Sidebar/Tabs/EmployeeWorkspace/views/ReferralApproval/HistoryView.tsx" docs/EDIT_LOG.md
git commit -m "feat(referral-approval): add cross-month HistoryView"
```

---

### Task 11: `index.tsx` orchestration — replace the monolithic file

**Files:**
- Create: `src/components/Sidebar/Tabs/EmployeeWorkspace/views/ReferralApproval/index.tsx`
- Delete: `src/components/Sidebar/Tabs/EmployeeWorkspace/views/ReferralApproval.tsx`
- Modify: `src/components/Sidebar/Tabs/EmployeeWorkspace/EmployeeWorkspace.css`

**Interfaces:**
- Consumes: `useApprovalData` (Task 4), `SummaryBar` (Task 7), `RequestList` (Task 8), `ReviewModal` (Task 9), `HistoryView` (Task 10), `isReferral` (Task 6).
- Produces: the page's default export, imported unchanged by `src/components/Sidebar/Tabs/EmployeeWorkspace/index.tsx:11` as `import ReferralApproval from "./views/ReferralApproval";` — this resolves to the new folder's `index.tsx` automatically, no caller change needed.

- [ ] **Step 1: Delete the old flat file**

```bash
rm "src/components/Sidebar/Tabs/EmployeeWorkspace/views/ReferralApproval.tsx"
```

- [ ] **Step 2: Write the orchestration component**

Create `src/components/Sidebar/Tabs/EmployeeWorkspace/views/ReferralApproval/index.tsx`:

```tsx
import { useState } from "react";
import { CalendarOff, X } from "lucide-react";
import { PageHeader } from "../../../../../../components/PageHeader/PageHeader";
import { EmptyState, ErrorState, LoadingState } from "../../../../../../components/StateViews/StateViews";
import type { DirectoryHandleLike } from "../../../../../../data/storage/fileSystemAccess";
import type { ReferralRequest, ReplacementRequest } from "../../../../../../data/referral/referralTypes";
import { isReferral } from "./RequestCard";
import RequestList from "./RequestList";
import ReviewModal from "./ReviewModal";
import HistoryView from "./HistoryView";
import SummaryBar from "./SummaryBar";
import { useApprovalData } from "./useApprovalData";

type StatusMsg = { type: "ok" | "error"; text: string } | null;
type RequestSection = "referral" | "replacement";
type ViewTab = "review" | "history";
type StatusFilter = "all" | "pending" | "approved" | "denied";
type CardRequest = ReferralRequest | ReplacementRequest;
type ReviewDialog = { request: CardRequest; action: "approve" | "deny" } | null;

type Props = { directoryHandle: DirectoryHandleLike };

export default function ReferralApproval({ directoryHandle }: Props) {
  const {
    username, canApproveReferrals, canApproveReplacements,
    userDisplayMap, months, selMonth, setSelMonth,
    referrals, replacements, sampleDetails, loadState, reload,
    approveReferral, denyReferral, approveReplacement, denyReplacement,
    bulkReferralDecision, bulkReplacementDecision,
  } = useApprovalData(directoryHandle);

  const canReview = canApproveReferrals || canApproveReplacements;

  const [view, setView] = useState<ViewTab>("review");
  const [section, setSection] = useState<RequestSection>("referral");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
  const [statusMsg, setStatusMsg] = useState<StatusMsg>(null);
  const [dialog, setDialog] = useState<ReviewDialog>(null);

  function switchSection(next: RequestSection): void {
    setSection(next);
    setStatusFilter("pending");
    setStatusMsg(null);
  }

  const requestsForSection = section === "referral" ? referrals : replacements;
  const counts: Record<StatusFilter, number> = {
    all: requestsForSection.length,
    pending: requestsForSection.filter((r) => r.status === "pending").length,
    approved: requestsForSection.filter((r) => r.status === "approved").length,
    denied: requestsForSection.filter((r) => r.status === "denied").length,
  };
  const filtered = requestsForSection.filter((r) => statusFilter === "all" || r.status === statusFilter);

  async function handleApprove(request: CardRequest, notes: string): Promise<void> {
    const result = isReferral(request) ? await approveReferral(request, notes) : await approveReplacement(request, notes);
    setDialog(null);
    setStatusMsg(result.ok ? { type: "ok", text: "تمت الموافقة على الطلب." } : { type: "error", text: result.error });
  }

  async function handleDeny(request: CardRequest, notes: string): Promise<void> {
    const result = isReferral(request) ? await denyReferral(request, notes) : await denyReplacement(request, notes);
    setDialog(null);
    setStatusMsg(result.ok ? { type: "ok", text: "تم رفض الطلب." } : { type: "error", text: result.error });
  }

  async function handleBulk(requests: CardRequest[], action: "approve" | "deny", notes: string) {
    const outcomes = section === "referral"
      ? await bulkReferralDecision(requests as ReferralRequest[], action, notes)
      : await bulkReplacementDecision(requests as ReplacementRequest[], action, notes);
    const failed = outcomes.filter((o) => !o.ok).length;
    setStatusMsg(failed === 0
      ? { type: "ok", text: `تمت معالجة ${outcomes.length} طلب بنجاح.` }
      : { type: "error", text: `نجح ${outcomes.length - failed} من ${outcomes.length}. فشل ${failed}.` });
    return outcomes;
  }

  function describeDialog(request: CardRequest, action: "approve" | "deny"): string {
    const name = (u: string) => userDisplayMap[u] ?? u;
    if (isReferral(request)) {
      return action === "approve"
        ? `ستتم إحالة ${request.xrayImageIds.length} عينة من ${name(request.fromEmployee)} إلى ${name(request.toEmployee)} بشكل دائم.`
        : `سيتم رفض الطلب وستبقى العينات مع ${name(request.fromEmployee)}.`;
    }
    return action === "approve"
      ? `سيتم استبدال ${request.originalXrayImageId} بـ ${request.replacementXrayImageId} للموظف ${name(request.employeeUsername)}.`
      : `سيتم رفض الطلب وتبقى العينة الأصلية ${request.originalXrayImageId} مع الموظف.`;
  }

  return (
    <section className="ew-page" dir="rtl">
      <PageHeader
        eyebrow="Request Approval"
        title="اعتماد الطلبات"
        subtitle={canReview ? "مراجعة طلبات الإحالة والاستبدال." : "الطلبات التي أرسلتها."}
      />

      <div className="ew-approval-view-tabs">
        <button type="button" className={`ew-approval-view-tab${view === "review" ? " active" : ""}`} onClick={() => setView("review")}>المراجعة</button>
        <button type="button" className={`ew-approval-view-tab${view === "history" ? " active" : ""}`} onClick={() => setView("history")}>السجل</button>
      </div>

      {statusMsg && (
        <div className={statusMsg.type === "ok" ? "ew-msg-ok" : "ew-msg-error"} role="status">
          {statusMsg.text}
          <button type="button" style={{ float: "left", background: "none", border: "none", cursor: "pointer" }} onClick={() => setStatusMsg(null)}>
            <X size={14} />
          </button>
        </div>
      )}

      {view === "history" ? (
        <HistoryView
          directoryHandle={directoryHandle}
          username={username}
          canApproveReferrals={canApproveReferrals}
          canApproveReplacements={canApproveReplacements}
          userDisplayMap={userDisplayMap}
        />
      ) : (
        <>
          <div className="ew-referral-toolbar">
            <label className="ew-label" htmlFor="ra-month">
              الشهر
              <select id="ra-month" className="ew-select" value={selMonth} onChange={(e) => setSelMonth(e.target.value)}>
                {months.map((m) => <option key={m.folderName} value={m.folderName}>{m.folderName}</option>)}
              </select>
            </label>

            <div className="ew-referral-status-tabs" style={{ gap: 4 }}>
              <button type="button" className={`ew-referral-status-tab${section === "referral" ? " active" : ""}`} onClick={() => switchSection("referral")}>
                الإحالة{referrals.length > 0 && <span className="ew-status-count">{referrals.length}</span>}
              </button>
              <button type="button" className={`ew-referral-status-tab${section === "replacement" ? " active" : ""}`} onClick={() => switchSection("replacement")}>
                الاستبدال{replacements.length > 0 && <span className="ew-status-count">{replacements.length}</span>}
              </button>
            </div>

            <SummaryBar counts={counts} active={statusFilter} onSelect={setStatusFilter} />
          </div>

          {loadState === "loading" && <LoadingState />}
          {loadState === "error" && (
            <ErrorState
              description="تعذر تحميل بيانات الطلبات. أعد المحاولة أو تحقق من مساحة العمل."
              actions={<button type="button" className="ew-btn-secondary ew-btn-sm" onClick={() => void reload()}>إعادة المحاولة</button>}
            />
          )}

          {loadState === "ready" && months.length === 0 && (
            <EmptyState icon={<CalendarOff />} title="لا توجد أشهر معالجة بعد"
              description="اعتماد الطلبات يعتمد على شهر معالج — ابدأ بمعالجة شهر من تبويب معالجة المجتمع." />
          )}

          {loadState === "ready" && months.length > 0 && filtered.length === 0 && (
            <EmptyState title={`لا توجد طلبات ${section === "referral" ? "إحالة" : "استبدال"} لهذا التصنيف`}
              description="ستظهر الطلبات هنا فور إرسالها من مساحة عمل الموظفين." />
          )}

          {loadState === "ready" && filtered.length > 0 && (
            <RequestList
              requests={filtered}
              bulkEnabled={statusFilter === "pending"}
              userDisplayMap={userDisplayMap}
              sampleDetails={sampleDetails}
              canReview={section === "referral" ? canApproveReferrals : canApproveReplacements}
              onApprove={(request) => setDialog({ request, action: "approve" })}
              onDeny={(request) => setDialog({ request, action: "deny" })}
              onBulk={handleBulk}
            />
          )}
        </>
      )}

      {dialog && (
        <ReviewModal
          title={dialog.action === "approve" ? "تأكيد الموافقة" : "تأكيد الرفض"}
          description={describeDialog(dialog.request, dialog.action)}
          isApprove={dialog.action === "approve"}
          onClose={() => setDialog(null)}
          onConfirm={(notes) => void (dialog.action === "approve" ? handleApprove(dialog.request, notes) : handleDeny(dialog.request, notes))}
        />
      )}
    </section>
  );
}
```

- [ ] **Step 3: Add the new CSS rules**

In `src/components/Sidebar/Tabs/EmployeeWorkspace/EmployeeWorkspace.css`, append after the final line (`.ew-btn-referral-inline:hover { background: var(--c-sky-light, #E5F5FB); border-color: var(--c-sky, #009ADE); }`):

```css

/* ── Approval view tabs (المراجعة / السجل) ────────────────── */

.ew-approval-view-tabs { display: flex; gap: 4px; margin-bottom: 16px; border-bottom: 2px solid var(--c-border, #DDE6EF); }

.ew-approval-view-tab {
  padding: 10px 18px;
  border: none;
  background: none;
  color: var(--c-ink-3, #50536F);
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  font-family: inherit;
  border-bottom: 2px solid transparent;
  margin-bottom: -2px;
  transition: color 140ms ease, border-color 140ms ease;
}

.ew-approval-view-tab:hover { color: var(--c-navy, #0E2444); }
.ew-approval-view-tab.active { color: var(--c-navy, #0E2444); border-color: var(--c-sky, #009ADE); }

/* ── Summary bar (status-count chips) ─────────────────────── */

.ew-summary-bar { display: flex; gap: 6px; }

.ew-summary-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 13px;
  border-radius: 999px;
  border: 1.5px solid var(--c-border, #DDE6EF);
  background: var(--c-surface-2, #F6F8FA);
  color: var(--c-ink-2, #263C58);
  font-size: 12.5px;
  font-weight: 700;
  cursor: pointer;
  font-family: inherit;
  transition: background 140ms ease, border-color 140ms ease, color 140ms ease;
}

.ew-summary-chip:hover { border-color: var(--c-border-2, #C2CEDC); }
.ew-summary-chip.active { background: var(--c-navy, #0E2444); color: #FFFFFF; border-color: var(--c-navy, #0E2444); }
.ew-summary-chip.active .ew-status-count { background: rgba(255,255,255,0.22); color: #FFFFFF; }
.ew-summary-chip.has-pending { border-color: var(--c-warning-border, #E5B46E); }

/* ── Request timeline ──────────────────────────────────────── */

.ew-timeline { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.ew-timeline-item { display: flex; align-items: flex-start; gap: 8px; font-size: 12px; }

.ew-timeline-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--c-ink-4, #8395AC);
  margin-top: 4px; flex-shrink: 0;
}

.ew-timeline-item--approved .ew-timeline-dot { background: var(--c-success, #004030); }
.ew-timeline-item--denied .ew-timeline-dot { background: var(--c-danger, #9F1624); }

.ew-timeline-body { flex: 1; }
.ew-timeline-meta { color: var(--c-ink-3, #50536F); font-weight: 500; }
.ew-timeline-note { margin: 2px 0 0; color: var(--c-ink-2, #263C58); font-style: italic; }

/* ── Bulk selection ────────────────────────────────────────── */

.ew-request-checkbox { width: 18px; height: 18px; margin-top: 4px; cursor: pointer; flex-shrink: 0; }

.ew-bulk-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  background: var(--c-navy-soft, #E8EEF6);
  border: 1px solid var(--c-border-2, #C2CEDC);
  border-radius: var(--r-sm, 8px);
  position: sticky;
  top: 0;
  z-index: 5;
}

.ew-bulk-bar-count { font-size: 13px; font-weight: 700; color: var(--c-navy, #0E2444); margin-inline-end: auto; }

.ew-referral-card--selected { border-color: var(--c-sky, #009ADE); box-shadow: 0 0 0 2px rgba(0, 154, 222, 0.15); }
```

- [ ] **Step 4: Type-check and run the full test suite**

Run: `npx tsc -b`
Expected: no errors (confirms the deleted old file has no remaining references, and every new file's types line up).

Run: `npx vitest run`
Expected: PASS, all suites (including Tasks 1–4's new/modified tests).

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 6: Log the edit and commit**

Add to `docs/EDIT_LOG.md`:

```markdown
## v42.10 — 2026-07-07 — Referral approval rework (11/11): orchestration + CSS, retire monolithic file

**File:** `src/components/Sidebar/Tabs/EmployeeWorkspace/views/ReferralApproval.tsx`

**Before:** 688-line single file: data loading, mutations, both cards, both dialogs, and the review modal all inline. Status filter tabs and section tabs shared one CSS class; no bulk actions; no cross-month history; decisions overwrote each other; idempotency/ownership/month-key bugs (see bug-fix map in the plan).

**After:** replaced by `views/ReferralApproval/` — `index.tsx` orchestrates `useApprovalData`, `SummaryBar`, `RequestList`, `ReviewModal`, `HistoryView`; each is independently readable and (where it carries real logic risk) tested.

**File:** `src/components/Sidebar/Tabs/EmployeeWorkspace/EmployeeWorkspace.css`

**Before:** no styles for view tabs, summary chips, timeline, or bulk selection.

**After:** added `.ew-approval-view-tab*`, `.ew-summary-*`, `.ew-timeline*`, `.ew-bulk-bar*`, `.ew-request-checkbox`, `.ew-referral-card--selected`.
```

```bash
git add "src/components/Sidebar/Tabs/EmployeeWorkspace/views/ReferralApproval/index.tsx" "src/components/Sidebar/Tabs/EmployeeWorkspace/views/ReferralApproval.tsx" "src/components/Sidebar/Tabs/EmployeeWorkspace/EmployeeWorkspace.css" docs/EDIT_LOG.md
git commit -m "feat(referral-approval): wire up reworked page, retire monolithic component"
```

(Note: `git add` on a deleted path stages the deletion.)

---

### Task 12: Manual verification in the browser

**Files:** none (no code changes — verification only, per the project's "test UI changes in a real browser" convention).

- [ ] **Step 1: Start the dev server and open the page**

Use the preview tool to start `npm run dev`, log in as a role with `approve-referrals`/`approve-replacements` enabled (e.g. `admin` or a supervisor account with those feature permissions on), and navigate to اعتماد الطلبات (`employee-workspace` tab → `ew/referral-approval` sub-tab).

- [ ] **Step 2: Verify the golden path**

- Both view tabs render (المراجعة / السجل) and switching between them works.
- Section tabs (الإحالة / الاستبدال) and the SummaryBar status chips are visually distinct from each other (bug #6 check).
- With at least one pending referral or replacement request present (create one via the employee-side referral/replacement flow if none exist), approve it: confirm the modal text, confirm the request's timeline shows both the submission and the decision afterward, confirm the status badge updates.
- Deny a different pending request the same way.
- Select 2+ pending requests, use the bulk bar to approve them together; confirm the modal lists every selected request ID and the resulting banner reports success count.
- Switch to السجل (history) and confirm the just-decided requests appear there with the correct month, status, and an expandable timeline; try the XLSX export button.

- [ ] **Step 3: Verify the four bug fixes specifically**

- **Idempotency (#1):** open the same pending request's approve dialog in two ways (e.g. two browser tabs, or approve then immediately try denying the same request before reloading) — confirm the second action is rejected with the "تم اتخاذ قرار بشأن هذا الطلب مسبقاً" message rather than silently succeeding or double-writing.
- **Ownership (#2):** not easily triggerable by hand without a second concurrent actor; rely on the automated coverage in Task 2 (`approvalGuards.test.ts`) for this one.
- **Month mismatch (#3):** select a different month in the month dropdown than the one a pending request belongs to (if your workspace has multiple processed months), approve/deny a request via a still-open dialog from the other month, and confirm via the السجل view that the decision landed on the request's own month, not the currently-selected one.
- **Stale state (#4):** switch months or sections rapidly while a load is in flight (throttle the network in devtools if needed) and confirm the list settles on the last selection, not a stale one.

- [ ] **Step 4: Check for console/runtime errors**

Use `preview_console_logs` (level: `error`) and `preview_network` (filter: `failed`) — expect no new errors introduced by this rework.

- [ ] **Step 5: Report results to the user**

Summarize what was exercised and any screenshots taken; do not mark this plan complete without having actually run this verification pass in the browser.
