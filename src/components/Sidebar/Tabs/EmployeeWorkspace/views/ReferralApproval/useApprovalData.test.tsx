/* @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
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
import { broadcastDataRefresh } from "../../../../../../data/workspace/dataRefreshSignal";
import { useApprovalData } from "./useApprovalData";

// Mutable so a test can flip the app-wide selection (or the known-months list)
// mid-flight; reset in afterEach.
const globalMonthMock = vi.hoisted(() => {
  type MockSelection =
    | { kind: "existing"; month: number; year: number; folderName: string }
    | { kind: "pending"; month: number; year: number; folderName: string };
  type MockMonthInfo = { month: number; year: number; folderName: string };
  const APRIL: MockSelection = { kind: "existing", month: 4, year: 2026, folderName: "4-april-2026" };
  const APRIL_ONLY: MockMonthInfo[] = [{ month: 4, year: 2026, folderName: "4-april-2026" }];
  return { APRIL, APRIL_ONLY, state: { selection: APRIL as MockSelection, months: APRIL_ONLY } };
});

vi.mock("../../../../../../data/month/useGlobalMonth", () => ({
  useGlobalMonth: () => ({
    months: globalMonthMock.state.months,
    selection: globalMonthMock.state.selection,
    isSelectedMonthClosed: false,
    setSelectedMonth: () => true,
    startNewMonth: () => true,
    refreshMonths: async () => {},
    registerMonthChangeGuard: () => () => {},
  }),
}));

// The production hook is mounted below WorkspaceGate. These focused hook tests
// supply their directory directly, so mirror the ready workspace capability.
vi.mock("../../../../../../data/workspace/useWorkspace", () => ({
  useWorkspace: () => ({
    directoryHandle: {} as DirectoryHandleLike,
    status: "ready",
  }),
}));

afterEach(() => {
  clearSession();
  globalMonthMock.state.selection = globalMonthMock.APRIL;
  globalMonthMock.state.months = globalMonthMock.APRIL_ONLY;
});

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
    await waitFor(() => expect(result.current.loadState).toBe("ready")); // reviewer has a different month open — mocked global selection is "4-april-2026"

    const outcome = await result.current.denyReferral(req, "wrong port");
    expect(outcome.ok).toBe(true);

    const marchLog = await loadReferralLog(root, "3-march-2026");
    expect(marchLog.requests[0].status).toBe("denied");
  });

  it("discards an in-flight load when the selection flips to a pending month mid-flight", async () => {
    setupSupervisor();
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    await appendReferralRequest(root, "4-april-2026", mockReferral("req-3", "4-april-2026"));

    // Mount starts a load for april; flip to a pending month (no folder on disk yet)
    // synchronously, before any of the load's promises can resolve.
    const { result, rerender } = renderHook(() => useApprovalData(root));
    globalMonthMock.state.selection = { kind: "pending", month: 6, year: 2026, folderName: "6-june-2026" };
    rerender();

    // Let the stale april load run to completion — it must not clobber the
    // empty-ready state with april's rows.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(result.current.loadState).toBe("ready");
    expect(result.current.referrals).toHaveLength(0);
  });

  it("picks up a request appended to disk by someone else once the app-wide refresh signal fires", async () => {
    setupSupervisor();
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;

    const { result } = renderHook(() => useApprovalData(root));
    await waitFor(() => expect(result.current.loadState).toBe("ready"));
    expect(result.current.referrals).toHaveLength(0);

    // Simulate another reviewer/employee submitting a referral directly to
    // disk, with no local action in this hook instance to trigger a reload.
    await appendReferralRequest(root, "4-april-2026", mockReferral("req-4", "4-april-2026"));

    act(() => {
      broadcastDataRefresh();
    });

    await waitFor(() => expect(result.current.referrals).toHaveLength(1));
  });

  it("surfaces a pending reassignment (referral) request from a month other than the reviewer's own global month selection (Bug 2 regression)", async () => {
    setupSupervisor();
    // The reviewer's own session is pinned to April (see setupSupervisor/globalMonthMock
    // default), but the workspace also has a May folder — e.g. the employee who
    // submitted the request has since moved on to a newer month while the reviewer's
    // browser tab, per authSession's SEC-02 note, kept its own month selection across
    // reloads. Before the fix, useApprovalData's loadData only ever queried selMonth
    // ("4-april-2026"), so a request submitted for "5-may-2026" was invisible in the
    // review queue with zero indication anything was pending -- even though
    // approveReferral already always acts on request.monthFolderName, not selMonth,
    // so the request WAS fully actionable the moment a reviewer could reach it.
    globalMonthMock.state.months = [
      { month: 4, year: 2026, folderName: "4-april-2026" },
      { month: 5, year: 2026, folderName: "5-may-2026" },
    ];
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    const mayReq = mockReferral("req-may-1", "5-may-2026");
    await appendReferralRequest(root, "5-may-2026", mayReq);

    const { result } = renderHook(() => useApprovalData(root));
    await waitFor(() => expect(result.current.loadState).toBe("ready"));

    // Visible in the merged review queue, with the right home month preserved
    // (approve/deny below must still target May, never April).
    await waitFor(() => expect(result.current.referrals).toHaveLength(1));
    expect(result.current.referrals[0].requestId).toBe("req-may-1");
    expect(result.current.referrals[0].monthFolderName).toBe("5-may-2026");
    expect(result.current.requests.some((r) => r.requestId === "req-may-1")).toBe(true);
    // The reviewer is authorized to act on it (canReviewRequest routes purely on
    // request kind + permission, never on whether it matches selMonth) -- this is
    // the same boolean RequestCard's showActions gates the موافقة/رفض buttons on,
    // so this is precisely "the accept/deny option appears" for a cross-month
    // pending reassignment request.
    expect(result.current.canReviewRequest(mayReq)).toBe(true);

    // Deciding it targets May (its own month) even though the reviewer's own UI
    // selection never left April -- exercising the same request.monthFolderName
    // write path the pre-existing "writes the decision to the request's own
    // month..." test covers, now reached via the fixed review queue instead of a
    // hand-constructed request object.
    const outcome = await result.current.denyReferral(mayReq, "wrong employee");
    expect(outcome.ok).toBe(true);
    const mayLog = await loadReferralLog(root, "5-may-2026");
    expect(mayLog.requests[0].status).toBe("denied");
    const aprilLog = await loadReferralLog(root, "4-april-2026");
    expect(aprilLog.requests).toHaveLength(0);
  });
});
