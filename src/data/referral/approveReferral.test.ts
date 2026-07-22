import { beforeEach, describe, expect, it } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import type { PreparedPopulationRow } from "../population/populationTypes";
import type { MonthManifestData } from "../population/monthTypes";
import { getPopulationMonthDir } from "../workspace/workspacePaths";
import { safeWriteJson } from "../storage/safeWrite";
import {
  MonthClosedError,
  closeMonth,
  invalidateMonthLockCache,
} from "../population/monthLock";
import { saveSampleMaster } from "../sampling/sampleStorage";
import type { SampleMasterData } from "../sampling/sampleTypes";
import {
  appendDistributionEvents,
  loadDistributionLog,
  saveDistributionCurrent,
} from "../distribution/distributionStorage";
import {
  DERIVE_VERSION,
  buildAssignEvent,
  buildReassignEvent,
  deriveCurrentDistribution,
} from "../distribution/distributionLog";
import { appendReferralRequest, loadReferralLog } from "./referralStorage";
import type { ReferralRequest } from "./referralTypes";
import { approveReferral, denyReferral } from "./approveReferral";

const MONTH = "5-May-2026";
const REQ_ID = "req-1";

function makeRow(id: string): PreparedPopulationRow {
  return {
    xrayImageId: id,
    portName: "بري",
    certScanStatus: "NonCertscan",
    stage: null,
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
      liveMeans: { result: null, code: null, employeeId: null }
    },
    notes: null,
    certScanSnippet: null,
    originalCertScanSnippet: null,
    biEnrichmentStatus: "BI Not Provided",
    biMatched: false,
    biFilledFields: [],
    sourceSheetName: "بري",
    sourceRowNumber: 1
  };
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

function makeRequest(overrides: Partial<ReferralRequest> = {}): ReferralRequest {
  return {
    requestId: REQ_ID,
    monthFolderName: MONTH,
    fromEmployee: "emp1",
    toEmployee: "emp2",
    xrayImageIds: ["A1", "A2"],
    reason: "ضغط عمل",
    requestedAt: new Date().toISOString(),
    requestedBy: "emp1",
    status: "pending",
    ...overrides,
  };
}

/** Seed: sample of A1/A2, both assigned to `assignee`, plus a pending referral request. */
async function seed(root: DirectoryHandleLike, assignee = "emp1"): Promise<void> {
  const rows = [makeRow("A1"), makeRow("A2")];
  await saveSampleMaster(root, MONTH, makeSample(rows));
  await appendDistributionEvents(root, MONTH, [
    buildAssignEvent({ xrayImageId: "A1", assignedTo: assignee, eventBy: "admin" }),
    buildAssignEvent({ xrayImageId: "A2", assignedTo: assignee, eventBy: "admin" }),
  ]);
  await appendReferralRequest(root, MONTH, makeRequest());
}

describe("approveReferral", () => {
  beforeEach(() => {
    invalidateMonthLockCache();
  });

  it("happy path: emits reassign events stamped with the request id and records the decision", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    await seed(root);

    const result = await approveReferral({
      directoryHandle: root,
      monthFolderName: MONTH,
      requestId: REQ_ID,
      reviewedBy: "sup1",
      reviewNotes: "موافق",
    });

    expect(result).toEqual({ ok: true, alreadyApplied: false });

    const log = await loadDistributionLog(root, MONTH);
    const reassigns = log.events.filter((e) => e.eventType === "reassigned");
    expect(reassigns).toHaveLength(2);
    expect(reassigns.every((e) => e.sourceRequestId === REQ_ID)).toBe(true);

    const refLog = await loadReferralLog(root, MONTH);
    expect(refLog.requests[0]!.status).toBe("approved");
    expect(refLog.requests[0]!.reviewedBy).toBe("sup1");

    const current = deriveCurrentDistribution(log, [makeRow("A1"), makeRow("A2")]);
    expect(current.entries.every((e) => e.assignedTo === "emp2")).toBe(true);
  });

  it("uses the immutable event log rather than a stale current cache for ownership validation", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    await seed(root);

    const log = await loadDistributionLog(root, MONTH);
    const row = makeRow("A1");
    await saveDistributionCurrent(root, MONTH, {
      monthFolderName: MONTH,
      deriveVersion: DERIVE_VERSION,
      logRevision: log.revision,
      eventSetId: log.eventSetId,
      derivedAt: new Date().toISOString(),
      totalAssigned: 2,
      totalCompleted: 0,
      totalReplaced: 0,
      totalPending: 2,
      entries: [
        { xrayImageId: "A1", assignedTo: "wrong-owner", status: "pending", replacedById: null, lastEventAt: new Date().toISOString(), row },
        { xrayImageId: "A2", assignedTo: "wrong-owner", status: "pending", replacedById: null, lastEventAt: new Date().toISOString(), row: makeRow("A2") },
      ],
    });

    const result = await approveReferral({
      directoryHandle: root,
      monthFolderName: MONTH,
      requestId: REQ_ID,
      reviewedBy: "sup1",
    });

    expect(result).toEqual({ ok: true, alreadyApplied: false });
    const current = deriveCurrentDistribution(await loadDistributionLog(root, MONTH), [makeRow("A1"), makeRow("A2")]);
    expect(current.entries.every((entry) => entry.assignedTo === "emp2")).toBe(true);
    expect((await loadReferralLog(root, MONTH)).requests[0]!.status).toBe("approved");
  });

  it("replay after a decision-write failure emits zero new events and records the decision", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    await seed(root);

    // Simulate the crash state: events already applied (stamped with the
    // request id) but the decision was never recorded — request still pending.
    await appendDistributionEvents(root, MONTH, [
      buildReassignEvent({
        xrayImageId: "A1", assignedTo: "emp1", reassignedTo: "emp2",
        eventBy: "sup1", sourceRequestId: REQ_ID,
      }),
      buildReassignEvent({
        xrayImageId: "A2", assignedTo: "emp1", reassignedTo: "emp2",
        eventBy: "sup1", sourceRequestId: REQ_ID,
      }),
    ]);
    const before = (await loadDistributionLog(root, MONTH)).events.length;

    const result = await approveReferral({
      directoryHandle: root,
      monthFolderName: MONTH,
      requestId: REQ_ID,
      reviewedBy: "sup1",
    });

    expect(result).toEqual({ ok: true, alreadyApplied: true });
    // No re-emission.
    expect((await loadDistributionLog(root, MONTH)).events).toHaveLength(before);
    // Decision recorded.
    const refLog = await loadReferralLog(root, MONTH);
    expect(refLog.requests[0]!.status).toBe("approved");
  });

  it("repairs a partially persisted immutable-event batch before recording approval", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    await seed(root);

    // Simulate interruption after the first independent immutable event file.
    await appendDistributionEvents(root, MONTH, [
      buildReassignEvent({
        xrayImageId: "A1",
        assignedTo: "emp1",
        reassignedTo: "emp2",
        eventBy: "sup1",
        sourceRequestId: REQ_ID,
      }),
    ]);

    const result = await approveReferral({
      directoryHandle: root,
      monthFolderName: MONTH,
      requestId: REQ_ID,
      reviewedBy: "sup1",
    });

    expect(result).toEqual({ ok: true, alreadyApplied: false });
    const log = await loadDistributionLog(root, MONTH);
    const requestEvents = log.events.filter((event) => event.sourceRequestId === REQ_ID);
    expect(requestEvents.map((event) => event.xrayImageId).sort()).toEqual(["A1", "A2"]);
    const current = deriveCurrentDistribution(log, [makeRow("A1"), makeRow("A2")]);
    expect(current.entries.every((entry) => entry.assignedTo === "emp2")).toBe(true);
    expect((await loadReferralLog(root, MONTH)).requests[0]!.status).toBe("approved");
  });

  it("non-pending request: no events, no decision change", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    await seed(root);

    const first = await approveReferral({
      directoryHandle: root, monthFolderName: MONTH, requestId: REQ_ID, reviewedBy: "sup1",
    });
    expect(first.ok).toBe(true);
    const eventsAfterFirst = (await loadDistributionLog(root, MONTH)).events.length;

    const second = await approveReferral({
      directoryHandle: root, monthFolderName: MONTH, requestId: REQ_ID, reviewedBy: "sup2",
    });
    expect(second).toEqual({ ok: false, code: "already-reviewed" });
    expect((await loadDistributionLog(root, MONTH)).events).toHaveLength(eventsAfterFirst);

    const refLog = await loadReferralLog(root, MONTH);
    expect(refLog.requests[0]!.reviewedBy).toBe("sup1"); // unchanged
  });

  it("ownership drift aborts all with no events emitted", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    await seed(root, "emp3"); // samples belong to emp3, request claims emp1

    const result = await approveReferral({
      directoryHandle: root, monthFolderName: MONTH, requestId: REQ_ID, reviewedBy: "sup1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok && result.code === "stale-ownership") {
      expect(result.staleIds.sort()).toEqual(["A1", "A2"]);
    } else {
      throw new Error(`expected stale-ownership, got ${JSON.stringify(result)}`);
    }
    const log = await loadDistributionLog(root, MONTH);
    expect(log.events.filter((e) => e.eventType === "reassigned")).toHaveLength(0);
    // Not auto-denied.
    expect((await loadReferralLog(root, MONTH)).requests[0]!.status).toBe("pending");
  });

  it("closed month rejects with MonthClosedError and writes nothing", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    await seed(root);

    // Seed a manifest so the month can be closed.
    const monthDir = await getPopulationMonthDir(root, MONTH, true);
    const manifest: MonthManifestData = {
      monthFolderName: MONTH, month: 5, year: 2026,
      processedAt: new Date().toISOString(), processedBy: "admin",
      riskFileName: null, biFileName: null, certScanUsed: false,
      templateVersion: null, rngSeed: null, totalRawRows: 0, totalProcessedRows: 2,
      status: "distributed",
    };
    await safeWriteJson(monthDir, "month.manifest.json", manifest);
    await closeMonth(root, MONTH, "admin");

    const before = (await loadDistributionLog(root, MONTH)).events.length;
    await expect(
      approveReferral({ directoryHandle: root, monthFolderName: MONTH, requestId: REQ_ID, reviewedBy: "sup1" })
    ).rejects.toThrow(MonthClosedError);
    expect((await loadDistributionLog(root, MONTH)).events).toHaveLength(before);
    expect((await loadReferralLog(root, MONTH)).requests[0]!.status).toBe("pending");
  });

  it("denyReferral guards against non-pending requests", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    await seed(root);

    const first = await denyReferral({
      directoryHandle: root, monthFolderName: MONTH, requestId: REQ_ID, reviewedBy: "sup1",
    });
    expect(first.ok).toBe(true);

    const second = await denyReferral({
      directoryHandle: root, monthFolderName: MONTH, requestId: REQ_ID, reviewedBy: "sup2",
    });
    expect(second).toEqual({ ok: false, code: "already-reviewed" });
  });
});
