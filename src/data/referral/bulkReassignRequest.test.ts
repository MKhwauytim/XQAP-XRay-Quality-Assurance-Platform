import { beforeEach, describe, expect, it } from "vitest";
import type { PreparedPopulationRow } from "../population/populationTypes";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { createMemoryDirectory } from "../storage/memoryDirectory";
import { saveSampleMaster } from "../sampling/sampleStorage";
import type { SampleMasterData } from "../sampling/sampleTypes";
import { appendDistributionEvents, loadDistributionLog } from "../distribution/distributionStorage";
import { buildAssignEvent, buildCompletedEvent } from "../distribution/distributionLog";
import { invalidateMonthLockCache } from "../population/monthLock";
import { loadReferralLog } from "./referralStorage";
import { approveReferral } from "./approveReferral";
import { bulkReassignRequestId, submitBulkReassignmentRequests } from "./bulkReassignRequest";

const MONTH = "5-May-2026";

function makeRow(id: string): PreparedPopulationRow {
  return {
    xrayImageId: id,
    portName: "المنفذ",
    certScanStatus: "NonCertscan",
    stage: "SECOND_STAGE",
    xrayEntryDate: null,
    portCode: null,
    portType: null,
    declarationNumber: null,
    declarationDate: null,
    plateOrContainerNumber: null,
    chassisNumber: null,
    xrayLevelOneResult: "سليمة",
    xrayLevelTwoResult: "سليمة",
    movementType: "LAND",
    reportNumber: null,
    targetedByRiskEngine: null,
    riskMessage: null,
    levelOneEmployee: null,
    levelTwoEmployee: null,
    otherResults: {
      manual: { result: null, code: null, employeeId: null },
      opposite: { result: null, code: null, employeeId: null },
      inspection: { result: null, code: null, employeeId: null },
    },
    biMatched: false,
  } as unknown as PreparedPopulationRow;
}

function makeSample(rows: PreparedPopulationRow[]): SampleMasterData {
  return {
    rngSeed: "seed",
    totalRequested: rows.length,
    totalActual: rows.length,
    certScanRequested: 0,
    nonCertScanRequested: 0,
    certScanActual: 0,
    nonCertScanActual: rows.length,
    portAllocations: [],
    stageAllocations: [],
    drawnAt: new Date().toISOString(),
    drawnBy: "admin",
    rows,
  };
}

async function seed(ids: Array<[string, string]>): Promise<DirectoryHandleLike> {
  const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
  const rows = ids.map(([id]) => makeRow(id));
  await saveSampleMaster(root, MONTH, makeSample(rows));
  const result = await appendDistributionEvents(
    root,
    MONTH,
    ids.map(([id, owner]) => buildAssignEvent({ xrayImageId: id, assignedTo: owner, eventBy: "admin" }))
  );
  if (!result.ok) throw new Error(`seed failed: ${result.error}`);
  return root;
}

describe("submitBulkReassignmentRequests", () => {
  beforeEach(() => {
    invalidateMonthLockCache();
  });

  it("creates pending referral requests instead of moving samples, one per source employee", async () => {
    const root = await seed([["A1", "emp1"], ["A2", "emp1"], ["A3", "emp2"]]);

    const result = await submitBulkReassignmentRequests({
      directoryHandle: root,
      monthFolderName: MONTH,
      xrayImageIds: ["A1", "A2", "A3"],
      reassignedTo: "emp3",
      requestedBy: "sup1",
      reason: "إعادة توزيع العمل",
      sourceRequestId: "batch-1",
    });

    expect(result.ok).toBe(true);
    expect(result.createdRequests).toEqual([
      { requestId: bulkReassignRequestId("batch-1", "emp1"), fromEmployee: "emp1", xrayImageIds: ["A1", "A2"] },
      { requestId: bulkReassignRequestId("batch-1", "emp2"), fromEmployee: "emp2", xrayImageIds: ["A3"] },
    ]);

    // Nothing is applied until a supervisor approves.
    const log = await loadDistributionLog(root, MONTH);
    expect(log.events.filter((e) => e.eventType === "reassigned")).toHaveLength(0);

    const referrals = await loadReferralLog(root, MONTH);
    expect(referrals.requests).toHaveLength(2);
    expect(referrals.requests.every((r) => r.status === "pending" && r.toEmployee === "emp3")).toBe(true);
    expect(referrals.requests.every((r) => r.requestedBy === "sup1")).toBe(true);
    expect(referrals.requests[0]!.reason).toContain("إعادة توزيع العمل");
  });

  it("skips terminal and unknown rows with the same reasons the direct path reports", async () => {
    const root = await seed([["A1", "emp1"], ["A2", "emp1"]]);
    const completed = await appendDistributionEvents(root, MONTH, [
      buildCompletedEvent({ xrayImageId: "A1", assignedTo: "emp1", eventBy: "emp1" }),
    ]);
    if (!completed.ok) throw new Error(completed.error);

    const result = await submitBulkReassignmentRequests({
      directoryHandle: root,
      monthFolderName: MONTH,
      xrayImageIds: ["A1", "A2", "nope"],
      reassignedTo: "emp3",
      requestedBy: "sup1",
      sourceRequestId: "batch-2",
    });

    expect(result.ok).toBe(true);
    expect(result.createdRequests).toHaveLength(1);
    expect(result.createdRequests[0]!.xrayImageIds).toEqual(["A2"]);
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        { xrayImageId: "A1", reason: "terminal-completed" },
        { xrayImageId: "nope", reason: "not-found" },
      ])
    );
  });

  it("is idempotent under retry — a resubmitted batch creates no duplicate requests", async () => {
    const root = await seed([["A1", "emp1"], ["A2", "emp2"]]);
    const params = {
      directoryHandle: root,
      monthFolderName: MONTH,
      xrayImageIds: ["A1", "A2"],
      reassignedTo: "emp3",
      requestedBy: "sup1",
      sourceRequestId: "batch-3",
    };

    await submitBulkReassignmentRequests(params);
    const second = await submitBulkReassignmentRequests(params);

    expect(second.ok).toBe(true);
    const referrals = await loadReferralLog(root, MONTH);
    expect(referrals.requests).toHaveLength(2);
  });

  it("produces requests the normal approval path can approve, which then applies the move", async () => {
    const root = await seed([["A1", "emp1"], ["A2", "emp1"]]);

    const submitted = await submitBulkReassignmentRequests({
      directoryHandle: root,
      monthFolderName: MONTH,
      xrayImageIds: ["A1", "A2"],
      reassignedTo: "emp3",
      requestedBy: "sup1",
      sourceRequestId: "batch-4",
    });
    expect(submitted.ok).toBe(true);

    const approval = await approveReferral({
      directoryHandle: root,
      monthFolderName: MONTH,
      requestId: submitted.createdRequests[0]!.requestId,
      reviewedBy: "sup2",
    });
    expect(approval).toEqual({ ok: true, alreadyApplied: false });

    const log = await loadDistributionLog(root, MONTH);
    const reassigns = log.events.filter((e) => e.eventType === "reassigned");
    expect(reassigns).toHaveLength(2);
    expect(reassigns.every((e) => e.reassignedTo === "emp3")).toBe(true);
  });
});
