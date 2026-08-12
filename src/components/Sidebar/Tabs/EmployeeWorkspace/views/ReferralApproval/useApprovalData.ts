import { useCallback, useEffect, useRef, useState } from "react";
import { readSession } from "../../../../../../auth/authSession";
import { usePermissions } from "../../../../../../auth/usePermissions";
import { readUserManagementState } from "../../../../../../auth/userManagement";
import { appendWorkspaceAction } from "../../../../../../data/audit/actionLog";
import { getLabels } from "../../../../../../data/labels/labelsStore";
import { logError } from "../../../../../../data/storage/errorLogger";
import { loadOrDeriveDistributionCurrentForRead } from "../../../../../../data/distribution/distributionStorage";
import type { DistributionEntry } from "../../../../../../data/distribution/distributionTypes";
import { useGlobalMonth } from "../../../../../../data/month/useGlobalMonth";
import { MonthClosedError } from "../../../../../../data/population/monthLock";
import type { PreparedPopulationRow } from "../../../../../../data/population/populationTypes";
import {
  approveReferral as approveReferralDomain,
  approveReopen as approveReopenDomain,
  approveReplacement as approveReplacementDomain,
  denyReferral as denyReferralDomain,
  denyReopen as denyReopenDomain,
  denyReplacement as denyReplacementDomain,
  type ApprovalResult,
  type DenyResult,
} from "../../../../../../data/referral/approveReferral";
import { loadRequestLogs } from "../../../../../../data/referral/referralStorage";
import type { ReferralRequest, ReopenRequest, ReplacementRequest } from "../../../../../../data/referral/referralTypes";
import { loadSampleMaster } from "../../../../../../data/sampling/sampleStorage";
import type { DirectoryHandleLike } from "../../../../../../data/storage/fileSystemAccess";
import { subscribeToDataRefresh } from "../../../../../../data/workspace/dataRefreshSignal";
import { isReferral, isReplacement, requestKind, type CardRequest } from "./requestKind";

export type LoadState = "idle" | "loading" | "ready" | "error";
export type OpResult = { ok: true } | { ok: false; error: string };
export type BulkOutcome = { requestId: string; label: string; ok: boolean; error?: string };

function approvalErrorMsg(result: Exclude<ApprovalResult, { ok: true }>): string {
  const L = getLabels();
  switch (result.code) {
    case "already-reviewed":
      return L.msg_request_already_reviewed;
    case "stale-ownership":
      return L.msg_referral_stale_ownership.replace("{ids}", result.staleIds.join("، "));
    case "decision-failed":
      return L.msg_referral_decision_retry;
    case "dist-failed":
    case "invalid-request":
      return result.error;
  }
}

function denyErrorMsg(result: Exclude<DenyResult, { ok: true }>): string {
  return result.code === "already-reviewed"
    ? getLabels().msg_request_already_reviewed
    : result.error;
}

function unexpectedErrorMsg(error: unknown): string {
  if (error instanceof MonthClosedError) return getLabels().msg_month_closed_write_blocked;
  return error instanceof Error ? error.message : "خطأ غير معروف";
}

export function useApprovalData(directoryHandle: DirectoryHandleLike) {
  const session = readSession();
  const username = session?.username ?? "";
  const role = session?.role ?? "employee";

  const { canMutate } = usePermissions();
  const userManagementState = readUserManagementState();
  const canApproveReferrals = canMutate("approve-referrals");
  const canApproveReplacements = canMutate("approve-replacements");
  // Reopen requests are gated on the existing supervisor reopen-authority feature —
  // whoever may directly reopen answers may approve employee reopen requests.
  const canApproveReopens = canMutate("ew.reopenAnswer");

  const userDisplayMap: Record<string, string> = {};
  for (const u of userManagementState.users) userDisplayMap[u.username] = u.displayName;

  const { months, selection: globalMonth } = useGlobalMonth();
  const selMonth = globalMonth.kind === "existing" ? globalMonth.folderName : "";
  const [referrals, setReferrals] = useState<ReferralRequest[]>([]);
  const [replacements, setReplacements] = useState<ReplacementRequest[]>([]);
  const [reopens, setReopens] = useState<ReopenRequest[]>([]);
  const [sampleDetails, setSampleDetails] = useState<Record<string, DistributionEntry | PreparedPopulationRow>>({});
  const [loadState, setLoadState] = useState<LoadState>("idle");

  // Bug #4: guards a slow load for a previously-selected month from clobbering
  // the results of a later selection.
  const loadTokenRef = useRef(0);

  // No selected on-disk month → nothing to load; land in the ready/empty state.
  useEffect(() => {
    if (!selMonth) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync empty-state reset when no month folder is selected
      setLoadState("ready");
    }
  }, [selMonth]);

  const loadData = useCallback(async (opts?: { silent?: boolean }) => {
    // Invalidate any in-flight load first — even the no-month early return must
    // stale older loads, or a truthy→"" selMonth transition would let an in-flight
    // load commit stale rows over the empty-ready state.
    const token = ++loadTokenRef.current;
    if (!selMonth) return;
    // `silent` is set only by the background/manual data-refresh signal (and by
    // the post-decision reloads below), never by a real month/user change.
    // Flipping loadState to "loading" unmounts the whole ready-state list —
    // see the render gate in index.tsx — so a silent refresh must re-fetch and
    // swap the underlying rows in place without ever blanking the view.
    const silent = opts?.silent ?? false;
    if (!silent) setLoadState("loading");
    try {
      const { referrals: refLog, replacements: repLog, reopens: reoLog } =
        await loadRequestLogs(directoryHandle, selMonth);

      // Cross-month pending gap: the reviewer's own global month selector is a
      // browsing convenience (persisted per-tab in sessionStorage, unaffected by
      // other users' work — see authSession's SEC-02 note) with no bearing on
      // which month a request belongs to. approve/deny already act on
      // request.monthFolderName, never selMonth (see approveReferral/
      // approveReplacement/approveReopen below), so a request submitted for a
      // month other than whichever one the reviewer's own session happens to be
      // pinned to was previously invisible here with zero indication anything
      // was pending — while the exact same request still showed up as a plain
      // row in the read-only, all-months "السجل" history tab. That combination
      // ("the request is logged somewhere, but there's no accept/deny for it")
      // is indistinguishable from a real approval-UI bug to the reviewer. Pull
      // in PENDING-only requests from every other known month so the review
      // queue is never silently empty just because of where the month picker
      // happens to sit. Decided (approved/denied) requests stay scoped to
      // selMonth only — already fully covered by the History tab — so the extra
      // reads stay proportional to "what still needs a decision" rather than
      // duplicating full cross-month history on every load.
      const otherMonths = months.map((m) => m.folderName).filter((name) => name !== selMonth);
      const otherMonthPending = await Promise.all(
        otherMonths.map(async (month) => {
          try {
            const { referrals: r, replacements: p, reopens: o } = await loadRequestLogs(directoryHandle, month);
            return {
              referrals: r.requests.filter((x) => x.status === "pending"),
              replacements: p.requests.filter((x) => x.status === "pending"),
              reopens: o.requests.filter((x) => x.status === "pending"),
            };
          } catch {
            // One unreadable month must not blank out every other month's queue.
            return { referrals: [], replacements: [], reopens: [] };
          }
        })
      );
      const crossMonthReferrals = otherMonthPending.flatMap((entry) => entry.referrals);
      const crossMonthReplacements = otherMonthPending.flatMap((entry) => entry.replacements);
      const crossMonthReopens = otherMonthPending.flatMap((entry) => entry.reopens);

      const sample = await loadSampleMaster(directoryHandle, selMonth);
      const detailMap: Record<string, DistributionEntry | PreparedPopulationRow> = {};
      if (sample) {
        const distribution = await loadOrDeriveDistributionCurrentForRead(directoryHandle, selMonth, sample.rows);
        for (const row of sample.rows) detailMap[row.xrayImageId] = row;
        for (const entry of distribution?.entries ?? []) detailMap[entry.xrayImageId] = entry;
      }
      if (token !== loadTokenRef.current) return; // superseded by a newer month selection

      const allReferrals = [...refLog.requests, ...crossMonthReferrals];
      const allReplacements = [...repLog.requests, ...crossMonthReplacements];
      const allReopens = [...reoLog.requests, ...crossMonthReopens];

      const visibleReferrals = canApproveReferrals
        ? allReferrals
        : allReferrals.filter((r) => r.fromEmployee === username);
      const visibleReplacements = canApproveReplacements
        ? allReplacements
        : allReplacements.filter((r) => r.employeeUsername === username);
      const visibleReopens = canApproveReopens
        ? allReopens
        : allReopens.filter((r) => r.employeeUsername === username || r.requestedBy === username);

      setSampleDetails(detailMap);
      setReferrals(visibleReferrals);
      setReplacements(visibleReplacements);
      setReopens(visibleReopens);
      setLoadState("ready");
    } catch (err) {
      if (token !== loadTokenRef.current) return;
      // A silent background refresh must not blank a previously rendered
      // review queue on a transient read hiccup — log it for observability
      // and leave the current state exactly as it was; the next successful
      // refresh (or manual navigation) will recover the data. Mirrors
      // XrayReferrals.tsx's silent-refresh error handling.
      if (silent) {
        logError("useApprovalData:loadData:silentRefresh", err);
        return;
      }
      setLoadState("error");
    }
  }, [directoryHandle, selMonth, username, months, canApproveReferrals, canApproveReplacements, canApproveReopens]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- async data load; setState fires inside loadData's async callback, not synchronously in the effect body
  useEffect(() => { void loadData(); }, [loadData]);

  // Re-fetch on the app-wide refresh signal (manual toolbar button + 5-minute
  // auto-refresh) so a request submitted/approved by someone else -- or on
  // another machine -- shows up without navigating away and back. Passed
  // silently so it never blanks the review queue mid-refresh (see the
  // `silent` handling inside loadData above). Rewritten as an explicit lambda
  // rather than `subscribeToDataRefresh(loadData)`: the subscription invokes
  // its callback with the bare `DataRefreshSource` string as its first
  // argument, which would otherwise land in `opts` and make `opts?.silent`
  // undefined -- silently defeating the silent-refresh behaviour.
  useEffect(() => subscribeToDataRefresh(() => { void loadData({ silent: true }); }), [loadData]);

  // Approve/deny delegate to the domain module in data/referral/approveReferral.ts,
  // which owns the idempotency re-check (bug #1), the ownership re-check (bug #2),
  // and a replay guard (retrying after a decision-write failure never re-emits the
  // already-applied distribution events). Every call here is keyed off
  // request.monthFolderName, never the UI's selected month (bug #3).

  // `opts.reload` defaults to true (the single-item interactive path always
  // reconciles). `bulkDecision` below passes `{ reload: false }` so a
  // multi-item bulk run reloads once after the whole loop instead of once
  // per item (A3) — the reload itself is always silent so it never blanks
  // the list that's already on screen mid-bulk-run.
  async function approveReferral(request: ReferralRequest, notes: string, opts?: { reload?: boolean }): Promise<OpResult> {
    if (!canApproveReferrals) return { ok: false, error: "لا تملك صلاحية اعتماد الإحالات، أو أن مساحة العمل للقراءة فقط." };
    try {
      const result = await approveReferralDomain({
        directoryHandle,
        monthFolderName: request.monthFolderName,
        requestId: request.requestId,
        reviewedBy: username,
        reviewNotes: notes,
      });
      if (result.ok) {
        void appendWorkspaceAction(directoryHandle, {
          actor: username,
          actorRole: role,
          action: "referral-approved",
          monthFolderName: request.monthFolderName,
          target: request.requestId,
          details: { samples: request.xrayImageIds.length, toEmployee: request.toEmployee },
        });
        if (opts?.reload ?? true) await loadData({ silent: true });
        return { ok: true };
      }
      return { ok: false, error: approvalErrorMsg(result) };
    } catch (error) {
      return { ok: false, error: unexpectedErrorMsg(error) };
    }
  }

  async function denyReferral(request: ReferralRequest, notes: string, opts?: { reload?: boolean }): Promise<OpResult> {
    if (!canApproveReferrals) return { ok: false, error: "لا تملك صلاحية رفض الإحالات، أو أن مساحة العمل للقراءة فقط." };
    try {
      const result = await denyReferralDomain({
        directoryHandle,
        monthFolderName: request.monthFolderName,
        requestId: request.requestId,
        reviewedBy: username,
        reviewNotes: notes,
      });
      if (result.ok) {
        void appendWorkspaceAction(directoryHandle, {
          actor: username,
          actorRole: role,
          action: "referral-denied",
          monthFolderName: request.monthFolderName,
          target: request.requestId,
        });
        if (opts?.reload ?? true) await loadData({ silent: true });
        return { ok: true };
      }
      return { ok: false, error: denyErrorMsg(result) };
    } catch (error) {
      return { ok: false, error: unexpectedErrorMsg(error) };
    }
  }

  async function approveReplacement(request: ReplacementRequest, notes: string, opts?: { reload?: boolean }): Promise<OpResult> {
    if (!canApproveReplacements) return { ok: false, error: "لا تملك صلاحية اعتماد الاستبدالات، أو أن مساحة العمل للقراءة فقط." };
    try {
      const result = await approveReplacementDomain({
        directoryHandle,
        monthFolderName: request.monthFolderName,
        requestId: request.requestId,
        reviewedBy: username,
        reviewNotes: notes,
      });
      if (result.ok) {
        void appendWorkspaceAction(directoryHandle, {
          actor: username,
          actorRole: role,
          action: "replacement-approved",
          monthFolderName: request.monthFolderName,
          target: request.requestId,
          details: { original: request.originalXrayImageId, replacement: request.replacementXrayImageId },
        });
        if (opts?.reload ?? true) await loadData({ silent: true });
        return { ok: true };
      }
      return { ok: false, error: approvalErrorMsg(result) };
    } catch (error) {
      return { ok: false, error: unexpectedErrorMsg(error) };
    }
  }

  async function denyReplacement(request: ReplacementRequest, notes: string, opts?: { reload?: boolean }): Promise<OpResult> {
    if (!canApproveReplacements) return { ok: false, error: "لا تملك صلاحية رفض الاستبدالات، أو أن مساحة العمل للقراءة فقط." };
    try {
      const result = await denyReplacementDomain({
        directoryHandle,
        monthFolderName: request.monthFolderName,
        requestId: request.requestId,
        reviewedBy: username,
        reviewNotes: notes,
      });
      if (result.ok) {
        void appendWorkspaceAction(directoryHandle, {
          actor: username,
          actorRole: role,
          action: "replacement-denied",
          monthFolderName: request.monthFolderName,
          target: request.requestId,
        });
        if (opts?.reload ?? true) await loadData({ silent: true });
        return { ok: true };
      }
      return { ok: false, error: denyErrorMsg(result) };
    } catch (error) {
      return { ok: false, error: unexpectedErrorMsg(error) };
    }
  }

  async function approveReopen(request: ReopenRequest, notes: string, opts?: { reload?: boolean }): Promise<OpResult> {
    if (!canApproveReopens) return { ok: false, error: "لا تملك صلاحية اعتماد إعادة الفتح، أو أن مساحة العمل للقراءة فقط." };
    try {
      const result = await approveReopenDomain({
        directoryHandle,
        monthFolderName: request.monthFolderName,
        requestId: request.requestId,
        reviewedBy: username,
        reviewedByRole: role,
        reviewNotes: notes,
      });
      if (result.ok) {
        void appendWorkspaceAction(directoryHandle, {
          actor: username,
          actorRole: role,
          action: "reopen-approved",
          monthFolderName: request.monthFolderName,
          target: request.requestId,
          details: { xrayImageId: request.xrayImageId, employee: request.employeeUsername },
        });
        if (opts?.reload ?? true) await loadData({ silent: true });
        return { ok: true };
      }
      return { ok: false, error: approvalErrorMsg(result) };
    } catch (error) {
      return { ok: false, error: unexpectedErrorMsg(error) };
    }
  }

  async function denyReopen(request: ReopenRequest, notes: string, opts?: { reload?: boolean }): Promise<OpResult> {
    if (!canApproveReopens) return { ok: false, error: "لا تملك صلاحية رفض إعادة الفتح، أو أن مساحة العمل للقراءة فقط." };
    try {
      const result = await denyReopenDomain({
        directoryHandle,
        monthFolderName: request.monthFolderName,
        requestId: request.requestId,
        reviewedBy: username,
        reviewNotes: notes,
      });
      if (result.ok) {
        void appendWorkspaceAction(directoryHandle, {
          actor: username,
          actorRole: role,
          action: "reopen-denied",
          monthFolderName: request.monthFolderName,
          target: request.requestId,
        });
        if (opts?.reload ?? true) await loadData({ silent: true });
        return { ok: true };
      }
      return { ok: false, error: denyErrorMsg(result) };
    } catch (error) {
      return { ok: false, error: unexpectedErrorMsg(error) };
    }
  }

  // ── Unified per-kind dispatch (used by the merged approval list) ────────────

  const requests: CardRequest[] = [...referrals, ...replacements, ...reopens];

  function canReviewRequest(request: CardRequest): boolean {
    const kind = requestKind(request);
    if (kind === "referral") return canApproveReferrals;
    if (kind === "replacement") return canApproveReplacements;
    return canApproveReopens;
  }

  async function approve(request: CardRequest, notes: string, opts?: { reload?: boolean }): Promise<OpResult> {
    if (!canReviewRequest(request)) return { ok: false, error: "لا تملك صلاحية اعتماد هذا الطلب، أو أن مساحة العمل للقراءة فقط." };
    if (isReferral(request)) return approveReferral(request, notes, opts);
    if (isReplacement(request)) return approveReplacement(request, notes, opts);
    return approveReopen(request, notes, opts);
  }

  async function deny(request: CardRequest, notes: string, opts?: { reload?: boolean }): Promise<OpResult> {
    if (!canReviewRequest(request)) return { ok: false, error: "لا تملك صلاحية رفض هذا الطلب، أو أن مساحة العمل للقراءة فقط." };
    if (isReferral(request)) return denyReferral(request, notes, opts);
    if (isReplacement(request)) return denyReplacement(request, notes, opts);
    return denyReopen(request, notes, opts);
  }

  function describeRequestShort(request: CardRequest): string {
    if (isReferral(request)) {
      return `${userDisplayMap[request.fromEmployee] ?? request.fromEmployee} ← ${userDisplayMap[request.toEmployee] ?? request.toEmployee}`;
    }
    if (isReplacement(request)) {
      return `${request.originalXrayImageId} → ${request.replacementXrayImageId}`;
    }
    return `إعادة فتح ${request.xrayImageId}`;
  }

  /**
   * Bulk decision over a mixed-kind selection — each row routed to its kind.
   *
   * A3: each per-item approve/deny call is told not to reload (F11 — the six
   * approve/deny functions used to reload after every single item, so an
   * N-item bulk run fired N full reloads, each of which used to blank the
   * progress modal mid-run). The single reload happens once, after the whole
   * loop, in a `finally` — so a mid-loop throw still reconciles the list
   * against whatever partially applied before it failed.
   */
  async function bulkDecision(
    selected: CardRequest[], action: "approve" | "deny", notes: string
  ): Promise<BulkOutcome[]> {
    const outcomes: BulkOutcome[] = [];
    try {
      for (const request of selected) {
        const result = action === "approve"
          ? await approve(request, notes, { reload: false })
          : await deny(request, notes, { reload: false });
        outcomes.push({
          requestId: request.requestId,
          label: describeRequestShort(request),
          ok: result.ok,
          error: result.ok ? undefined : result.error,
        });
      }
    } finally {
      await loadData({ silent: true });
    }
    return outcomes;
  }

  return {
    username, role, canApproveReferrals, canApproveReplacements, canApproveReopens,
    userDisplayMap, months, selMonth,
    referrals, replacements, reopens, requests, sampleDetails, loadState, reload: loadData,
    approveReferral, denyReferral, approveReplacement, denyReplacement, approveReopen, denyReopen,
    approve, deny, canReviewRequest, bulkDecision,
  };
}
