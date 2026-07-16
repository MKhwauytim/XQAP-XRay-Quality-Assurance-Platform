import { useCallback, useEffect, useRef, useState } from "react";
import { readSession } from "../../../../../../auth/authSession";
import {
  hasFeature,
  readUserManagementState,
  subscribeToUserManagementChanges,
} from "../../../../../../auth/userManagement";
import { appendWorkspaceAction } from "../../../../../../data/audit/actionLog";
import { getLabels } from "../../../../../../data/labels/labelsStore";
import { loadOrDeriveDistributionCurrent } from "../../../../../../data/distribution/distributionStorage";
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
import {
  loadReferralLog,
  loadReopenLog,
  loadReplacementLog,
} from "../../../../../../data/referral/referralStorage";
import type { ReferralRequest, ReopenRequest, ReplacementRequest } from "../../../../../../data/referral/referralTypes";
import { loadSampleMaster } from "../../../../../../data/sampling/sampleStorage";
import type { DirectoryHandleLike } from "../../../../../../data/storage/fileSystemAccess";
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

  const [, forcePermissionRefresh] = useState(0);
  useEffect(() => subscribeToUserManagementChanges(() => forcePermissionRefresh((n) => n + 1)), []);
  const userManagementState = readUserManagementState();
  const canApproveReferrals = hasFeature(userManagementState.featurePermissions, role, "approve-referrals");
  const canApproveReplacements = hasFeature(userManagementState.featurePermissions, role, "approve-replacements");
  // Reopen requests are gated on the existing supervisor reopen-authority feature —
  // whoever may directly reopen answers may approve employee reopen requests.
  const canApproveReopens = hasFeature(userManagementState.featurePermissions, role, "ew.reopenAnswer");

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

  const loadData = useCallback(async () => {
    if (!selMonth) return;
    const token = ++loadTokenRef.current;
    setLoadState("loading");
    try {
      const [refLog, repLog, reoLog] = await Promise.all([
        loadReferralLog(directoryHandle, selMonth),
        loadReplacementLog(directoryHandle, selMonth),
        loadReopenLog(directoryHandle, selMonth),
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
      const visibleReopens = canApproveReopens
        ? reoLog.requests
        : reoLog.requests.filter((r) => r.employeeUsername === username || r.requestedBy === username);

      setSampleDetails(detailMap);
      setReferrals(visibleReferrals);
      setReplacements(visibleReplacements);
      setReopens(visibleReopens);
      setLoadState("ready");
    } catch {
      if (token === loadTokenRef.current) setLoadState("error");
    }
  }, [directoryHandle, selMonth, username, canApproveReferrals, canApproveReplacements, canApproveReopens]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- async data load; setState fires inside loadData's async callback, not synchronously in the effect body
  useEffect(() => { void loadData(); }, [loadData]);

  // Approve/deny delegate to the domain module in data/referral/approveReferral.ts,
  // which owns the idempotency re-check (bug #1), the ownership re-check (bug #2),
  // and a replay guard (retrying after a decision-write failure never re-emits the
  // already-applied distribution events). Every call here is keyed off
  // request.monthFolderName, never the UI's selected month (bug #3).

  async function approveReferral(request: ReferralRequest, notes: string): Promise<OpResult> {
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
        await loadData();
        return { ok: true };
      }
      return { ok: false, error: approvalErrorMsg(result) };
    } catch (error) {
      return { ok: false, error: unexpectedErrorMsg(error) };
    }
  }

  async function denyReferral(request: ReferralRequest, notes: string): Promise<OpResult> {
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
        await loadData();
        return { ok: true };
      }
      return { ok: false, error: denyErrorMsg(result) };
    } catch (error) {
      return { ok: false, error: unexpectedErrorMsg(error) };
    }
  }

  async function approveReplacement(request: ReplacementRequest, notes: string): Promise<OpResult> {
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
        await loadData();
        return { ok: true };
      }
      return { ok: false, error: approvalErrorMsg(result) };
    } catch (error) {
      return { ok: false, error: unexpectedErrorMsg(error) };
    }
  }

  async function denyReplacement(request: ReplacementRequest, notes: string): Promise<OpResult> {
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
        await loadData();
        return { ok: true };
      }
      return { ok: false, error: denyErrorMsg(result) };
    } catch (error) {
      return { ok: false, error: unexpectedErrorMsg(error) };
    }
  }

  async function approveReopen(request: ReopenRequest, notes: string): Promise<OpResult> {
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
        await loadData();
        return { ok: true };
      }
      return { ok: false, error: approvalErrorMsg(result) };
    } catch (error) {
      return { ok: false, error: unexpectedErrorMsg(error) };
    }
  }

  async function denyReopen(request: ReopenRequest, notes: string): Promise<OpResult> {
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
        await loadData();
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

  async function approve(request: CardRequest, notes: string): Promise<OpResult> {
    if (isReferral(request)) return approveReferral(request, notes);
    if (isReplacement(request)) return approveReplacement(request, notes);
    return approveReopen(request, notes);
  }

  async function deny(request: CardRequest, notes: string): Promise<OpResult> {
    if (isReferral(request)) return denyReferral(request, notes);
    if (isReplacement(request)) return denyReplacement(request, notes);
    return denyReopen(request, notes);
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

  /** Bulk decision over a mixed-kind selection — each row routed to its kind. */
  async function bulkDecision(
    selected: CardRequest[], action: "approve" | "deny", notes: string
  ): Promise<BulkOutcome[]> {
    const outcomes: BulkOutcome[] = [];
    for (const request of selected) {
      const result = action === "approve" ? await approve(request, notes) : await deny(request, notes);
      outcomes.push({
        requestId: request.requestId,
        label: describeRequestShort(request),
        ok: result.ok,
        error: result.ok ? undefined : result.error,
      });
    }
    return outcomes;
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
    username, role, canApproveReferrals, canApproveReplacements, canApproveReopens,
    userDisplayMap, months, selMonth,
    referrals, replacements, reopens, requests, sampleDetails, loadState, reload: loadData,
    approveReferral, denyReferral, approveReplacement, denyReplacement, approveReopen, denyReopen,
    approve, deny, canReviewRequest, bulkDecision,
    bulkReferralDecision, bulkReplacementDecision,
  };
}
