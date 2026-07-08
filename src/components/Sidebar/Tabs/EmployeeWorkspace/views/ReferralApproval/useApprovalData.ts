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
