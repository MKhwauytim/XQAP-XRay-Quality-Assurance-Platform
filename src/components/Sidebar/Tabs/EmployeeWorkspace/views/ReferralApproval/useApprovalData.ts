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
import { MonthClosedError } from "../../../../../../data/population/monthLock";
import type { MonthFolderInfo } from "../../../../../../data/population/monthFolder";
import { listMonthFolders } from "../../../../../../data/population/populationStorage";
import type { PreparedPopulationRow } from "../../../../../../data/population/populationTypes";
import {
  approveReferral as approveReferralDomain,
  approveReplacement as approveReplacementDomain,
  denyReferral as denyReferralDomain,
  denyReplacement as denyReplacementDomain,
  type ApprovalResult,
  type DenyResult,
} from "../../../../../../data/referral/approveReferral";
import {
  loadReferralLog,
  loadReplacementLog,
} from "../../../../../../data/referral/referralStorage";
import type { ReferralRequest, ReplacementRequest } from "../../../../../../data/referral/referralTypes";
import { loadSampleMaster } from "../../../../../../data/sampling/sampleStorage";
import type { DirectoryHandleLike } from "../../../../../../data/storage/fileSystemAccess";

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
