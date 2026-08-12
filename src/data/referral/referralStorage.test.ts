import { describe, it, expect, vi } from "vitest";
import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { loadAllEmployeeFiles } from "../answers/answerStorage";
import { loadAllSupervisorDecisions } from "../approvals/approvalStorage";
import { getSampleEmployeeDir } from "../workspace/workspacePaths";
import {
  appendReferralRequest,
  loadReferralLog,
  loadReopenLog,
  loadReplacementLog,
  loadRequestLogs,
  updateReferralStatus,
  getPendingReferralIds,
  appendReplacementRequest,
  appendReopenRequest,
  updateReplacementStatus,
  getPendingReplacementIds,
} from "./referralStorage";
import type { ReferralRequest, ReopenRequest, ReplacementLog, ReplacementRequest } from "./referralTypes";

// A4: `loadAllEmployeeFiles`/`loadAllSupervisorDecisions` are the two directory
// scans `loadRequestLogs` is meant to perform exactly once per call, no matter
// how many of the three per-kind exports a caller awaits concurrently. Wrapped
// in `vi.fn(actual)` so the default behaviour is unchanged and only the call
// count is observed.
vi.mock("../answers/answerStorage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../answers/answerStorage")>();
  return { ...actual, loadAllEmployeeFiles: vi.fn(actual.loadAllEmployeeFiles) };
});
vi.mock("../approvals/approvalStorage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../approvals/approvalStorage")>();
  return { ...actual, loadAllSupervisorDecisions: vi.fn(actual.loadAllSupervisorDecisions) };
});

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
    // First-wins: the earliest decision (denied) is authoritative; the later
    // "approved" correction is retained in history but does not override it.
    expect(log.requests[0].status).toBe("denied");
    expect(log.requests[0].history).toHaveLength(2);
    expect(log.requests[0].history?.[0].status).toBe("denied");
    expect(log.requests[0].history?.[1].status).toBe("approved");
  });

  it("cross-supervisor: the earliest decision is authoritative (first-wins)", async () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    await appendReferralRequest(root, "5-May-2026", mockReferral("req-1", "alice", "bob"));

    // Two reviewers each decide the same request in their own file. sup-1 acted
    // first (earlier reviewedAt); sup-2's later denial must NOT override it.
    await updateReferralStatus(root, "5-May-2026", "req-1", {
      status: "approved", reviewedBy: "sup-1", reviewedAt: "2026-07-01T10:00:00.000Z",
    });
    await updateReferralStatus(root, "5-May-2026", "req-1", {
      status: "denied", reviewedBy: "sup-2", reviewedAt: "2026-07-02T10:00:00.000Z",
    });

    const log = await loadReferralLog(root, "5-May-2026");
    expect(log.requests[0].status).toBe("approved");
    expect(log.requests[0].reviewedBy).toBe("sup-1");
  });

  it("two concurrent referral decisions on different requests both persist (cross-machine CAS)", async () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    await appendReferralRequest(root, "5-May-2026", mockReferral("req-1", "alice", "bob"));
    await appendReferralRequest(root, "5-May-2026", mockReferral("req-2", "alice", "charlie"));

    // The same reviewer decides both requests near-simultaneously from two PCs.
    // updateReferralStatus routes through appendDecisionEvent, whose shared
    // decisions file is a read-modify-write append — without CAS the second
    // write would clobber the first decision. Both decisions must survive.
    const [d1, d2] = await Promise.all([
      updateReferralStatus(root, "5-May-2026", "req-1", {
        status: "approved", reviewedBy: "supervisor-1", reviewedAt: "2026-07-01T10:00:00.000Z",
      }),
      updateReferralStatus(root, "5-May-2026", "req-2", {
        status: "denied", reviewedBy: "supervisor-1", reviewedAt: "2026-07-01T10:00:01.000Z",
      }),
    ]);
    expect(d1.ok).toBe(true);
    expect(d2.ok).toBe(true);

    const log = await loadReferralLog(root, "5-May-2026");
    const byId = new Map(log.requests.map((r) => [r.requestId, r.status]));
    expect(byId.get("req-1")).toBe("approved");
    expect(byId.get("req-2")).toBe("denied");
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
    // First-wins: earliest decision (denied) stands; later approval is in history.
    expect(log.requests[0].status).toBe("denied");
    expect(log.requests[0].history).toHaveLength(2);
  });
});

describe("getPendingReplacementIds (Task 6)", () => {
  it("returns the originalXrayImageId of pending replacement requests for the given employee", () => {
    const log: ReplacementLog = {
      monthFolderName: "5-May-2026",
      revision: 0,
      requests: [
        {
          requestId: "r1",
          monthFolderName: "5-May-2026",
          employeeUsername: "alice",
          originalXrayImageId: "img-1",
          replacementXrayImageId: "img-2",
          reason: "test",
          requestedAt: new Date().toISOString(),
          requestedBy: "alice",
          status: "pending",
        },
        {
          requestId: "r2",
          monthFolderName: "5-May-2026",
          employeeUsername: "alice",
          originalXrayImageId: "img-3",
          replacementXrayImageId: "img-4",
          reason: "test",
          requestedAt: new Date().toISOString(),
          requestedBy: "alice",
          status: "approved",
        },
        {
          requestId: "r3",
          monthFolderName: "5-May-2026",
          employeeUsername: "bob",
          originalXrayImageId: "img-5",
          replacementXrayImageId: "img-6",
          reason: "test",
          requestedAt: new Date().toISOString(),
          requestedBy: "bob",
          status: "pending",
        },
      ],
    };

    const ids = getPendingReplacementIds(log, "alice");
    expect(ids).toEqual(new Set(["img-1"]));
  });

  it("returns an empty set when the employee has no pending replacement requests", () => {
    const log: ReplacementLog = { monthFolderName: "5-May-2026", revision: 0, requests: [] };
    expect(getPendingReplacementIds(log, "alice")).toEqual(new Set());
  });
});

describe("loadRequestLogs (A4 — one shared scan backing all three request logs)", () => {
  const mockReferral = (id: string, from: string, to: string): ReferralRequest => ({
    requestId: id,
    monthFolderName: "5-May-2026",
    fromEmployee: from,
    toEmployee: to,
    xrayImageIds: [`img-${id}`],
    reason: "test",
    requestedAt: new Date().toISOString(),
    requestedBy: from,
    status: "pending",
  });
  const mockReplacement = (id: string, emp: string): ReplacementRequest => ({
    requestId: id,
    monthFolderName: "5-May-2026",
    employeeUsername: emp,
    originalXrayImageId: `orig-${id}`,
    replacementXrayImageId: `rep-${id}`,
    reason: "test",
    requestedAt: new Date().toISOString(),
    requestedBy: emp,
    status: "pending",
  });
  const mockReopen = (id: string, emp: string): ReopenRequest => ({
    requestId: id,
    monthFolderName: "5-May-2026",
    employeeUsername: emp,
    xrayImageId: `case-${id}`,
    reason: "test",
    requestedAt: new Date().toISOString(),
    requestedBy: emp,
    status: "pending",
  });

  it("performs exactly one loadAllEmployeeFiles scan and one loadAllSupervisorDecisions scan for a Promise.all of all three exported loaders (down from three each)", async () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    await appendReferralRequest(root, "5-May-2026", mockReferral("req-1", "alice", "bob"));
    await appendReplacementRequest(root, "5-May-2026", mockReplacement("rep-1", "alice"));
    await appendReopenRequest(root, "5-May-2026", mockReopen("reo-1", "alice"));

    vi.mocked(loadAllEmployeeFiles).mockClear();
    vi.mocked(loadAllSupervisorDecisions).mockClear();

    const [referrals, replacements, reopens] = await Promise.all([
      loadReferralLog(root, "5-May-2026"),
      loadReplacementLog(root, "5-May-2026"),
      loadReopenLog(root, "5-May-2026"),
    ]);

    expect(referrals.requests).toHaveLength(1);
    expect(replacements.requests).toHaveLength(1);
    expect(reopens.requests).toHaveLength(1);
    expect(vi.mocked(loadAllEmployeeFiles)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(loadAllSupervisorDecisions)).toHaveBeenCalledTimes(1);
  });

  it("loadRequestLogs itself also dedupes concurrent direct callers to a single pair of scans", async () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    await appendReferralRequest(root, "5-May-2026", mockReferral("req-1", "alice", "bob"));

    vi.mocked(loadAllEmployeeFiles).mockClear();
    vi.mocked(loadAllSupervisorDecisions).mockClear();

    const [a, b, c] = await Promise.all([
      loadRequestLogs(root, "5-May-2026"),
      loadRequestLogs(root, "5-May-2026"),
      loadRequestLogs(root, "5-May-2026"),
    ]);
    expect(a.referrals.requests).toHaveLength(1);
    expect(b.referrals.requests).toHaveLength(1);
    expect(c.referrals.requests).toHaveLength(1);
    expect(vi.mocked(loadAllEmployeeFiles)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(loadAllSupervisorDecisions)).toHaveBeenCalledTimes(1);

    // A call started after the previous one settled is fresh work again --
    // dedupeInFlight is not a TTL cache.
    await loadRequestLogs(root, "5-May-2026");
    expect(vi.mocked(loadAllEmployeeFiles)).toHaveBeenCalledTimes(2);
  });

  it("one corrupt *.answers.json among three still returns the requests from the two good files, for all three request kinds", async () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    await appendReferralRequest(root, "5-May-2026", mockReferral("req-good-1", "alice", "bob"));
    await appendReferralRequest(root, "5-May-2026", mockReferral("req-good-2", "carol", "dave"));
    await appendReplacementRequest(root, "5-May-2026", mockReplacement("rep-good-1", "alice"));
    await appendReopenRequest(root, "5-May-2026", mockReopen("reo-good-1", "alice"));

    // A third employee's file is unreadable JSON -- readJsonDirectory's
    // onUnreadable: "skip" (preserved by the shared scan, per A4's failure-
    // domain note) must drop only this one file, for every request kind.
    const answersDir = await getSampleEmployeeDir(root, "5-May-2026", true);
    const badHandle = await answersDir.getFileHandle("badeemployee.answers.json", { create: true });
    const writable = await badHandle.createWritable!();
    await writable.write("{not valid json");
    await writable.close();

    const { referrals, replacements, reopens } = await loadRequestLogs(root, "5-May-2026");
    expect(referrals.requests.map((r) => r.requestId).sort()).toEqual(["req-good-1", "req-good-2"]);
    expect(replacements.requests.map((r) => r.requestId)).toEqual(["rep-good-1"]);
    expect(reopens.requests.map((r) => r.requestId)).toEqual(["reo-good-1"]);
  });

  it("byte-identical output before/after the shared-loader refactor: the effectiveDecision status join and history field", async () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    await appendReferralRequest(root, "5-May-2026", mockReferral("req-1", "alice", "bob"));
    await updateReferralStatus(root, "5-May-2026", "req-1", {
      status: "denied", reviewedBy: "sup-1", reviewedAt: "2026-07-01T10:00:00.000Z", reviewNotes: "n1",
    });
    await updateReferralStatus(root, "5-May-2026", "req-1", {
      status: "approved", reviewedBy: "sup-1", reviewedAt: "2026-07-02T10:00:00.000Z",
    });

    const viaDelegate = await loadReferralLog(root, "5-May-2026");
    const viaShared = (await loadRequestLogs(root, "5-May-2026")).referrals;

    expect(viaShared).toEqual(viaDelegate);
    expect(viaShared.requests[0].status).toBe("denied"); // first-wins
    expect(viaShared.requests[0].history).toHaveLength(2);
    expect(viaShared.requests[0].history?.[0].status).toBe("denied");
    expect(viaShared.requests[0].history?.[1].status).toBe("approved");
  });
});
