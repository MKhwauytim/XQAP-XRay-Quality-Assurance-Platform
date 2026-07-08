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
