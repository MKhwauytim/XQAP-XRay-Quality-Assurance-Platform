import { describe, it, expect } from "vitest";
import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import {
  appendReferralRequest,
  loadReferralLog,
  updateReferralStatus,
  getPendingReferralIds,
  appendReplacementRequest,
  loadReplacementLog,
  updateReplacementStatus,
} from "./referralStorage";
import type { ReferralRequest, ReplacementRequest } from "./referralTypes";

describe("referralStorage", () => {
  const mockReferral = (id: string, from: string, to: string, status: ReferralRequest["status"] = "pending"): ReferralRequest => ({
    requestId: id,
    monthFolderName: "5-May-2026",
    fromEmployee: from,
    toEmployee: to,
    xrayImageIds: [`img-${id}-1`, `img-${id}-2`],
    reason: "Needs secondary review",
    requestedAt: new Date().toISOString(),
    requestedBy: from,
    status,
  });

  it("loads an empty referral log when no files exist", async () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    const log = await loadReferralLog(root, "5-May-2026");
    expect(log.requests).toHaveLength(0);
  });

  it("saves a referral request and retrieves it aggregated in log", async () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;

    const req1 = mockReferral("req-1", "alice", "bob");
    const saveResult = await appendReferralRequest(root, "5-May-2026", req1);
    expect(saveResult.ok).toBe(true);

    const log = await loadReferralLog(root, "5-May-2026");
    expect(log.requests).toHaveLength(1);
    expect(log.requests[0].requestId).toBe("req-1");
    expect(log.requests[0].status).toBe("pending");
  });

  it("applies supervisor decisions overlay on pending requests", async () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;

    const req1 = mockReferral("req-1", "alice", "bob");
    await appendReferralRequest(root, "5-May-2026", req1);

    // supervisor reviews and approves it
    const reviewResult = await updateReferralStatus(root, "5-May-2026", "req-1", {
      status: "approved",
      reviewedBy: "supervisor-1",
      reviewedAt: new Date().toISOString(),
      reviewNotes: "Looks good",
    });
    expect(reviewResult.ok).toBe(true);

    const log = await loadReferralLog(root, "5-May-2026");
    expect(log.requests).toHaveLength(1);
    expect(log.requests[0].status).toBe("approved");
    expect(log.requests[0].reviewedBy).toBe("supervisor-1");
    expect(log.requests[0].reviewNotes).toBe("Looks good");
  });

  it("resolves pending referral IDs correctly", async () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;

    const req1 = mockReferral("req-1", "alice", "bob");
    const req2 = mockReferral("req-2", "alice", "charlie");
    await appendReferralRequest(root, "5-May-2026", req1);
    await appendReferralRequest(root, "5-May-2026", req2);

    // approve req2 so only req1 is pending
    await updateReferralStatus(root, "5-May-2026", "req-2", {
      status: "approved",
      reviewedBy: "supervisor-1",
      reviewedAt: new Date().toISOString(),
    });

    const log = await loadReferralLog(root, "5-May-2026");
    const pendingIds = getPendingReferralIds(log, "alice");

    expect(pendingIds.has("img-req-1-1")).toBe(true);
    expect(pendingIds.has("img-req-1-2")).toBe(true);
    expect(pendingIds.has("img-req-2-1")).toBe(false); // approved
  });

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
});

describe("replacement requests in referralStorage", () => {
  const mockReplacement = (id: string, emp: string, status: ReplacementRequest["status"] = "pending"): ReplacementRequest => ({
    requestId: id,
    monthFolderName: "5-May-2026",
    employeeUsername: emp,
    originalXrayImageId: `orig-${id}`,
    replacementXrayImageId: `rep-${id}`,
    reason: "Blurry image",
    requestedAt: new Date().toISOString(),
    requestedBy: emp,
    status,
  });

  it("loads an empty replacement log when no files exist", async () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    const log = await loadReplacementLog(root, "5-May-2026");
    expect(log.requests).toHaveLength(0);
  });

  it("saves a replacement request and aggregates with decisions", async () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;

    const req = mockReplacement("rep-1", "alice");
    const saveResult = await appendReplacementRequest(root, "5-May-2026", req);
    expect(saveResult.ok).toBe(true);

    const logBefore = await loadReplacementLog(root, "5-May-2026");
    expect(logBefore.requests).toHaveLength(1);
    expect(logBefore.requests[0].status).toBe("pending");

    // Approve the replacement request
    const reviewResult = await updateReplacementStatus(root, "5-May-2026", "rep-1", {
      status: "approved",
      reviewedBy: "supervisor-1",
      reviewedAt: new Date().toISOString(),
      reviewNotes: "Approved replacement",
    });
    expect(reviewResult.ok).toBe(true);

    const logAfter = await loadReplacementLog(root, "5-May-2026");
    expect(logAfter.requests).toHaveLength(1);
    expect(logAfter.requests[0].status).toBe("approved");
    expect(logAfter.requests[0].reviewedBy).toBe("supervisor-1");
  });

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
});
