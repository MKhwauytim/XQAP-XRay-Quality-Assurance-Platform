import { beforeEach, describe, expect, it } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import type { PreparedPopulationRow } from "../population/populationTypes";
import { invalidateMonthLockCache } from "../population/monthLock";
import { saveSampleMaster } from "../sampling/sampleStorage";
import type { SampleMasterData } from "../sampling/sampleTypes";
import { appendDistributionEvents, loadDistributionLog } from "../distribution/distributionStorage";
import { buildAssignEvent, buildCompletedEvent, deriveCurrentDistribution } from "../distribution/distributionLog";
import { appendReferralRequest, loadReferralLog } from "./referralStorage";
import type { ReferralRequest } from "./referralTypes";
import { approveReferral, denyReferral } from "./approveReferral";
import { undoAvailability, undoDecision, undoSourceRequestId } from "./undoDecision";

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
      liveMeans: { result: null, code: null, employeeId: null },
    },
    notes: null,
    certScanSnippet: null,
    originalCertScanSnippet: null,
    biEnrichmentStatus: "BI Not Provided",
    biMatched: false,
    biFilledFields: [],
    sourceSheetName: "بري",
    sourceRowNumber: 1,
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

async function seed(root: DirectoryHandleLike): Promise<void> {
  const rows = [makeRow("A1"), makeRow("A2")];
  await saveSampleMaster(root, MONTH, makeSample(rows));
  await appendDistributionEvents(root, MONTH, [
    buildAssignEvent({ xrayImageId: "A1", assignedTo: "emp1", eventBy: "admin" }),
    buildAssignEvent({ xrayImageId: "A2", assignedTo: "emp1", eventBy: "admin" }),
  ]);
  await appendReferralRequest(root, MONTH, makeRequest());
}

async function ownersOf(root: DirectoryHandleLike): Promise<Record<string, string>> {
  const log = await loadDistributionLog(root, MONTH);
  const current = deriveCurrentDistribution(log, [makeRow("A1"), makeRow("A2")]);
  return Object.fromEntries(current.entries.map((entry) => [entry.xrayImageId, entry.assignedTo]));
}

describe("undoAvailability", () => {
  it("offers undo for every denial — denying has no side effects to unwind", () => {
    expect(undoAvailability("referral", "denied").undoable).toBe(true);
    expect(undoAvailability("replacement", "denied").undoable).toBe(true);
    expect(undoAvailability("reopen", "denied").undoable).toBe(true);
  });

  it("offers undo for an approved referral only — the other approvals cannot be unwound", () => {
    expect(undoAvailability("referral", "approved").undoable).toBe(true);
    expect(undoAvailability("replacement", "approved").undoable).toBe(false);
    expect(undoAvailability("reopen", "approved").undoable).toBe(false);
  });
});

describe("undoDecision", () => {
  beforeEach(() => {
    invalidateMonthLockCache();
  });

  it("returns an approved referral to pending and hands the samples back", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    await seed(root);
    await approveReferral({ directoryHandle: root, monthFolderName: MONTH, requestId: REQ_ID, reviewedBy: "sup1" });
    expect(await ownersOf(root)).toEqual({ A1: "emp2", A2: "emp2" });

    const undone = await undoDecision({
      directoryHandle: root,
      monthFolderName: MONTH,
      kind: "referral",
      requestId: REQ_ID,
      reviewedBy: "sup1",
    });

    expect(undone).toEqual({ ok: true });
    expect(await ownersOf(root)).toEqual({ A1: "emp1", A2: "emp1" });
    expect((await loadReferralLog(root, MONTH)).requests[0]!.status).toBe("pending");
  });

  it("keeps the original decision on the trail — undo appends, never deletes", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    await seed(root);
    await approveReferral({ directoryHandle: root, monthFolderName: MONTH, requestId: REQ_ID, reviewedBy: "sup1" });
    await undoDecision({ directoryHandle: root, monthFolderName: MONTH, kind: "referral", requestId: REQ_ID, reviewedBy: "sup1" });

    const history = (await loadReferralLog(root, MONTH)).requests[0]!.history ?? [];
    expect(history.map((event) => event.status)).toEqual(["approved", "reverted"]);
    expect(history[1]!.revokesDecisionAt).toBe(history[0]!.reviewedAt);
  });

  it("re-approving after an undo re-emits the transfer instead of trusting the reversed events", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    await seed(root);
    await approveReferral({ directoryHandle: root, monthFolderName: MONTH, requestId: REQ_ID, reviewedBy: "sup1" });
    await undoDecision({ directoryHandle: root, monthFolderName: MONTH, kind: "referral", requestId: REQ_ID, reviewedBy: "sup1" });

    const again = await approveReferral({
      directoryHandle: root,
      monthFolderName: MONTH,
      requestId: REQ_ID,
      reviewedBy: "sup1",
    });

    expect(again).toEqual({ ok: true, alreadyApplied: false });
    expect(await ownersOf(root)).toEqual({ A1: "emp2", A2: "emp2" });
    expect((await loadReferralLog(root, MONTH)).requests[0]!.status).toBe("approved");
  });

  it("undoes a denial without touching distribution state", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    await seed(root);
    await denyReferral({ directoryHandle: root, monthFolderName: MONTH, requestId: REQ_ID, reviewedBy: "sup1" });

    const undone = await undoDecision({
      directoryHandle: root,
      monthFolderName: MONTH,
      kind: "referral",
      requestId: REQ_ID,
      reviewedBy: "sup1",
    });

    expect(undone).toEqual({ ok: true });
    expect((await loadReferralLog(root, MONTH)).requests[0]!.status).toBe("pending");
    const log = await loadDistributionLog(root, MONTH);
    expect(log.events.some((event) => event.sourceRequestId === undoSourceRequestId(REQ_ID))).toBe(false);
  });

  it("refuses when the new owner has already worked the samples", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    await seed(root);
    await approveReferral({ directoryHandle: root, monthFolderName: MONTH, requestId: REQ_ID, reviewedBy: "sup1" });
    await appendDistributionEvents(root, MONTH, [
      buildCompletedEvent({ xrayImageId: "A1", assignedTo: "emp2", eventBy: "emp2" }),
    ]);

    const undone = await undoDecision({
      directoryHandle: root,
      monthFolderName: MONTH,
      kind: "referral",
      requestId: REQ_ID,
      reviewedBy: "sup1",
    });

    expect(undone.ok).toBe(false);
    expect((await loadReferralLog(root, MONTH)).requests[0]!.status).toBe("approved");
  });

  it("refuses to undo another reviewer's decision", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    await seed(root);
    await approveReferral({ directoryHandle: root, monthFolderName: MONTH, requestId: REQ_ID, reviewedBy: "sup1" });

    const undone = await undoDecision({
      directoryHandle: root,
      monthFolderName: MONTH,
      kind: "referral",
      requestId: REQ_ID,
      reviewedBy: "sup2",
    });

    expect(undone).toEqual({
      ok: false,
      code: "not-owner",
      error: "لا يمكن التراجع عن قرار سجّله مراجع آخر.",
    });
    expect((await loadReferralLog(root, MONTH)).requests[0]!.status).toBe("approved");
  });
});
