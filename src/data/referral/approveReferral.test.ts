import { beforeEach, describe, expect, it } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import type { PreparedPopulationRow } from "../population/populationTypes";
import type { MonthManifestData } from "../population/monthTypes";
import { getPopulationMonthDir, POPULATION_SUBFOLDERS } from "../workspace/workspacePaths";
import { safeWriteJson } from "../storage/safeWrite";
import {
  MonthClosedError,
  closeMonth,
  invalidateMonthLockCache,
} from "../population/monthLock";
import { appendSampleRow, loadSampleMaster, saveSampleMaster } from "../sampling/sampleStorage";
import { executeReplacement } from "../distribution/replacement";
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
import {
  appendReferralRequest,
  appendReplacementRequest,
  loadReferralLog,
  loadReplacementLog,
} from "./referralStorage";
import type { ReferralRequest, ReplacementRequest } from "./referralTypes";
import {
  approveReferral,
  approveReplacement,
  denyReferral,
  denyReplacement,
} from "./approveReferral";

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

  it("still detects a competing decision written between load and persist, after Task 2's dedupe primitives exist (regression guard)", async () => {
    // Two supervisors race to approve the SAME pending referral request
    // concurrently. approveReferral's own reads (loadReferralLog,
    // loadDistributionLog, loadAllSupervisorDecisions) are never routed
    // through Task 2's dedupeInFlight/...ForRead wrappers -- this test
    // proves that guarantee holds by exercising the real cross-reviewer
    // guard (steps 1, 5a "cross-reviewer guard", and 5c "first-wins
    // reconciliation" in approveReferral's docblock) under genuine
    // concurrent execution. Regardless of how the two calls interleave,
    // exactly one supervisor's decision may become authoritative -- the
    // other must always be rejected as already-reviewed, never both ok:true.
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    await seed(root);

    const [r1, r2] = await Promise.all([
      approveReferral({
        directoryHandle: root, monthFolderName: MONTH, requestId: REQ_ID, reviewedBy: "sup1",
      }),
      approveReferral({
        directoryHandle: root, monthFolderName: MONTH, requestId: REQ_ID, reviewedBy: "sup2",
      }),
    ]);

    const results = [r1, r2];
    const oks = results.filter((r) => r.ok);
    const rejected = results.filter((r) => !r.ok);
    expect(oks).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ ok: false, code: "already-reviewed" });

    // Exactly one reviewer's decision is authoritative in the merged log.
    const refLog = await loadReferralLog(root, MONTH);
    expect(["sup1", "sup2"]).toContain(refLog.requests[0]!.reviewedBy);

    // Ownership converges to the requested target regardless of which
    // reassign batch physically landed first.
    const finalLog = await loadDistributionLog(root, MONTH);
    const finalCurrent = deriveCurrentDistribution(finalLog, [makeRow("A1"), makeRow("A2")]);
    expect(finalCurrent.entries.every((e) => e.assignedTo === "emp2")).toBe(true);
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

describe("approveReplacement", () => {
  const REPL_ROW = "C1";

  beforeEach(() => {
    invalidateMonthLockCache();
  });

  function makeReplacementRequest(overrides: Partial<ReplacementRequest> = {}): ReplacementRequest {
    return {
      requestId: "rep-1",
      monthFolderName: MONTH,
      employeeUsername: "emp1",
      originalXrayImageId: "A1",
      replacementXrayImageId: REPL_ROW,
      reason: "الصورة غير صالحة",
      requestedAt: new Date().toISOString(),
      requestedBy: "emp1",
      status: "pending",
      ...overrides,
    };
  }

  /**
   * A1 owned by emp1, A2 owned by emp2, and one spare population row (C1) that
   * is NOT in the sample — the only legitimate replacement candidate.
   */
  async function seedReplacement(root: DirectoryHandleLike): Promise<void> {
    const sampled = [makeRow("A1"), makeRow("A2")];
    await saveSampleMaster(root, MONTH, makeSample(sampled));
    await appendDistributionEvents(root, MONTH, [
      buildAssignEvent({ xrayImageId: "A1", assignedTo: "emp1", eventBy: "admin" }),
      buildAssignEvent({ xrayImageId: "A2", assignedTo: "emp2", eventBy: "admin" }),
    ]);
    const monthDir = await getPopulationMonthDir(root, MONTH, true);
    const processedDir = await monthDir.getDirectoryHandle(POPULATION_SUBFOLDERS.processed, {
      create: true,
    });
    await safeWriteJson(processedDir, "population.final.json", {
      sourceMonthFolder: MONTH,
      processedAt: new Date().toISOString(),
      processedBy: "admin",
      totalRows: 3,
      certScanRows: 0,
      nonCertScanRows: 3,
      rows: [...sampled, makeRow(REPL_ROW)],
    });
  }

  it("happy path: retires the original, assigns the replacement, records the decision", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    await seedReplacement(root);
    await appendReplacementRequest(root, MONTH, makeReplacementRequest());

    const result = await approveReplacement({
      directoryHandle: root, monthFolderName: MONTH, requestId: "rep-1", reviewedBy: "sup1",
    });
    expect(result).toEqual({ ok: true, alreadyApplied: false });

    const sample = await loadSampleMaster(root, MONTH);
    const current = deriveCurrentDistribution(
      await loadDistributionLog(root, MONTH),
      (sample?.rows ?? []) as PreparedPopulationRow[]
    );
    expect(current.entries.find((e) => e.xrayImageId === "A1")?.status).toBe("replaced");
    const replacement = current.entries.find((e) => e.xrayImageId === REPL_ROW);
    expect(replacement?.assignedTo).toBe("emp1");
    expect(replacement?.status).toBe("pending");
    expect((await loadReplacementLog(root, MONTH)).requests[0]!.status).toBe("approved");
  });

  it("replay after a decision-write failure emits zero new events", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    await seedReplacement(root);
    await appendReplacementRequest(root, MONTH, makeReplacementRequest());

    // The crash state: the replacement already landed (events stamped with the
    // request id) but the decision was never recorded, so the request is still
    // pending and the reviewer retries.
    const sample = await loadSampleMaster(root, MONTH);
    const current = deriveCurrentDistribution(
      await loadDistributionLog(root, MONTH),
      (sample?.rows ?? []) as PreparedPopulationRow[]
    );
    const applied = await executeReplacement({
      directoryHandle: root,
      monthFolderName: MONTH,
      deadEntry: current.entries.find((e) => e.xrayImageId === "A1")!,
      replacementRow: makeRow(REPL_ROW),
      reason: "استبدال معتمد",
      eventBy: "sup1",
      sourceRequestId: "rep-1",
    });
    expect(applied.ok).toBe(true);
    const after = (await loadDistributionLog(root, MONTH)).events.length;

    const replay = await approveReplacement({
      directoryHandle: root, monthFolderName: MONTH, requestId: "rep-1", reviewedBy: "sup1",
    });
    expect(replay).toEqual({ ok: true, alreadyApplied: true });
    expect((await loadDistributionLog(root, MONTH)).events).toHaveLength(after);
    expect((await loadReplacementLog(root, MONTH)).requests[0]!.status).toBe("approved");
  });

  it("rejects a request whose original row is no longer owned by the requester", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    await seedReplacement(root);
    await appendReplacementRequest(
      root, MONTH, makeReplacementRequest({ employeeUsername: "emp-ghost" })
    );

    const result = await approveReplacement({
      directoryHandle: root, monthFolderName: MONTH, requestId: "rep-1", reviewedBy: "sup1",
    });
    expect(result).toEqual({ ok: false, code: "stale-ownership", staleIds: ["A1"] });
    expect((await loadReplacementLog(root, MONTH)).requests[0]!.status).toBe("pending");
  });

  it("refuses to hand a second requester a replacement row the first approval already took", async () => {
    // Two employees independently pick the SAME spare row as their replacement.
    // The first approval consumes it; the second must not silently flip its
    // ownership to the second employee — that transfer emits no `reassigned`
    // event and no notification, so the first employee's queue changes under
    // them with nothing in the audit trail explaining it.
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    await seedReplacement(root);
    await appendReplacementRequest(root, MONTH, makeReplacementRequest());
    await appendReplacementRequest(
      root,
      MONTH,
      makeReplacementRequest({
        requestId: "rep-2",
        employeeUsername: "emp2",
        requestedBy: "emp2",
        originalXrayImageId: "A2",
      })
    );

    const first = await approveReplacement({
      directoryHandle: root, monthFolderName: MONTH, requestId: "rep-1", reviewedBy: "sup1",
    });
    expect(first).toEqual({ ok: true, alreadyApplied: false });

    const second = await approveReplacement({
      directoryHandle: root, monthFolderName: MONTH, requestId: "rep-2", reviewedBy: "sup1",
    });
    expect(second).toEqual({ ok: false, code: "stale-ownership", staleIds: [REPL_ROW] });

    // emp1 keeps the row the first approval granted them, and A2 is untouched.
    const sample = await loadSampleMaster(root, MONTH);
    const current = deriveCurrentDistribution(
      await loadDistributionLog(root, MONTH),
      (sample?.rows ?? []) as PreparedPopulationRow[]
    );
    expect(current.entries.find((e) => e.xrayImageId === REPL_ROW)?.assignedTo).toBe("emp1");
    expect(current.entries.find((e) => e.xrayImageId === "A2")?.status).toBe("pending");
    expect(current.entries.find((e) => e.xrayImageId === "A2")?.assignedTo).toBe("emp2");

    // The losing request stays pending for a human to resolve, never auto-denied.
    const log = await loadReplacementLog(root, MONTH);
    expect(log.requests.find((r) => r.requestId === "rep-2")!.status).toBe("pending");
  });

  it("resumes a partially-written replacement (XQ-DIST-005 crash state) instead of dead-ending", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    await seedReplacement(root);
    await appendReplacementRequest(root, MONTH, makeReplacementRequest());

    // The OPPOSITE half of the replay test above: the sample append landed
    // (row appended + original retired in one CAS write) but the events write
    // failed on the flaky share, so the log knows nothing about the request.
    // The old step-3b guard read this state as "replacement row already in the
    // sample" and returned stale-ownership on every retry, forever.
    const appended = await appendSampleRow(root, MONTH, makeRow(REPL_ROW), undefined, "A1");
    expect(appended.ok).toBe(true);
    const eventsBefore = (await loadDistributionLog(root, MONTH)).events.length;

    const result = await approveReplacement({
      directoryHandle: root, monthFolderName: MONTH, requestId: "rep-1", reviewedBy: "sup1",
    });
    expect(result).toEqual({ ok: true, alreadyApplied: false });

    // The resume re-used the already-appended row: no growth, no double retire.
    const sample = await loadSampleMaster(root, MONTH);
    expect(sample?.rows.map((r) => r.xrayImageId)).toEqual(["A1", "A2", REPL_ROW]);
    expect(sample?.replacedRowIds).toEqual(["A1"]);
    expect(sample?.totalActual).toBe(2);

    const current = deriveCurrentDistribution(
      await loadDistributionLog(root, MONTH),
      (sample?.rows ?? []) as PreparedPopulationRow[]
    );
    expect(current.entries.find((e) => e.xrayImageId === "A1")?.status).toBe("replaced");
    const replacement = current.entries.find((e) => e.xrayImageId === REPL_ROW);
    expect(replacement?.assignedTo).toBe("emp1");
    expect(replacement?.status).toBe("pending");
    expect((await loadDistributionLog(root, MONTH)).events).toHaveLength(eventsBefore + 2);
    expect((await loadReplacementLog(root, MONTH)).requests[0]!.status).toBe("approved");
  });

  it("still refuses an unowned in-sample row when the original was never retired", async () => {
    // The resume exception must stay NARROW: a sample row with no distribution
    // entry is normal in a partially-distributed month, and handing it out as
    // a replacement would double-count it. Only the recorded substitution of
    // THIS dead row (replacedRowIds) unlocks the resume.
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    const sampled = [makeRow("A1"), makeRow("A2"), makeRow("A3")];
    await saveSampleMaster(root, MONTH, makeSample(sampled));
    // A3 is drawn but not yet distributed — no entry owns it.
    await appendDistributionEvents(root, MONTH, [
      buildAssignEvent({ xrayImageId: "A1", assignedTo: "emp1", eventBy: "admin" }),
      buildAssignEvent({ xrayImageId: "A2", assignedTo: "emp2", eventBy: "admin" }),
    ]);
    await appendReplacementRequest(
      root,
      MONTH,
      makeReplacementRequest({
        replacementXrayImageId: "A3",
        replacementRowData: makeRow("A3") as unknown as Record<string, unknown>,
      })
    );

    const result = await approveReplacement({
      directoryHandle: root, monthFolderName: MONTH, requestId: "rep-1", reviewedBy: "sup1",
    });
    expect(result).toEqual({ ok: false, code: "stale-ownership", staleIds: ["A3"] });
  });

  it("fails loudly (XQ-SMP-008) on a different candidate after the partial write, instead of enlarging the sample", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    await seedReplacement(root);
    // Partial write for the ORIGINAL candidate C1 (sample updated, no events).
    const appended = await appendSampleRow(root, MONTH, makeRow(REPL_ROW), undefined, "A1");
    expect(appended.ok).toBe(true);
    // A second request for the same dead row names a different spare row D1.
    // Committing it would be a plain enlargement (totalActual +1 forever) that
    // also strands C1 in the sample with no owner.
    await appendReplacementRequest(
      root,
      MONTH,
      makeReplacementRequest({
        requestId: "rep-2",
        replacementXrayImageId: "D1",
        replacementRowData: makeRow("D1") as unknown as Record<string, unknown>,
      })
    );

    const result = await approveReplacement({
      directoryHandle: root, monthFolderName: MONTH, requestId: "rep-2", reviewedBy: "sup1",
    });
    expect(result).toMatchObject({ ok: false, code: "dist-failed" });
    expect((result as { error?: string }).error).toContain("XQ-SMP-008");

    const sample = await loadSampleMaster(root, MONTH);
    expect(sample?.rows.some((r) => r.xrayImageId === "D1")).toBe(false);
    expect(sample?.totalActual).toBe(2);
  });

  it("refuses a replacement row that is already part of the drawn sample", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    await seedReplacement(root);
    // emp1 names emp2's already-sampled row as their replacement.
    await appendReplacementRequest(
      root, MONTH, makeReplacementRequest({ replacementXrayImageId: "A2" })
    );

    const result = await approveReplacement({
      directoryHandle: root, monthFolderName: MONTH, requestId: "rep-1", reviewedBy: "sup1",
    });
    expect(result).toEqual({ ok: false, code: "stale-ownership", staleIds: ["A2"] });
    expect((await loadDistributionLog(root, MONTH)).events.filter(
      (e) => e.eventType === "replaced"
    )).toHaveLength(0);
  });

  it("denyReplacement guards against non-pending requests", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    await seedReplacement(root);
    await appendReplacementRequest(root, MONTH, makeReplacementRequest());

    const first = await denyReplacement({
      directoryHandle: root, monthFolderName: MONTH, requestId: "rep-1", reviewedBy: "sup1",
    });
    expect(first.ok).toBe(true);

    const second = await denyReplacement({
      directoryHandle: root, monthFolderName: MONTH, requestId: "rep-1", reviewedBy: "sup2",
    });
    expect(second).toEqual({ ok: false, code: "already-reviewed" });
  });
});
