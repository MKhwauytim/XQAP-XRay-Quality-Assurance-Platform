import { beforeEach, describe, expect, it } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import type { PreparedPopulationRow } from "../population/populationTypes";
import type { SampleMasterData } from "../sampling/sampleTypes";
import type { ItemAnswer } from "../answers/answerTypes";
import type { ReferralRequest } from "../referral/referralTypes";
import { invalidateMonthLockCache } from "../population/monthLock";
import { saveSampleMaster } from "../sampling/sampleStorage";
import { upsertItemAnswer } from "../answers/answerStorage";
import {
  appendDistributionEvents,
  loadDistributionLog,
  saveDistributionCurrent,
  __clearDeriveMemoForTests,
} from "../distribution/distributionStorage";
import {
  buildAssignEvent,
  buildCompletedEvent,
  buildReassignEvent,
  deriveCurrentDistribution,
} from "../distribution/distributionLog";
import { executeReplacement } from "../distribution/replacement";
import { reopenSubmittedAnswer } from "../answers/reopenAnswer";
import { appendReferralRequest } from "../referral/referralStorage";
import { approveReferral } from "../referral/approveReferral";
import { loadEmployeeSampleMirror } from "./sampleMirrorStorage";

/**
 * DROP-TO-ZERO CONTRACT (Design B, bug F8).
 *
 * The per-employee mirror `2-samples/{month}/2-employees/{username}.samples.json`
 * is the file an employee reads to see their own work. It is a derived
 * projection regenerated whole by `syncSampleMirrors`.
 *
 * The contract pinned here: through EVERY write flow that appends distribution
 * events, an employee who ends up owning ZERO entries ends up with a
 * ZERO-ENTRY mirror file — never a stale one still listing work they no longer
 * own. Before the F8 fix the projection only visited employees present in
 * `current.entries`, so a drop-to-zero employee was never rewritten, and the
 * monotonic `sourceLogRevision` guard then blocked the correction permanently.
 *
 * Four flows are covered:
 *   1. distribute / assign  (useDistributionActions → saveDistributionCurrent)
 *   2. reopen               (reopenSubmittedAnswer)
 *   3. referral approval    (approveReferral)
 *   4. replacement          (executeReplacement) — this one did not refresh at
 *                            all before bug F20 was fixed.
 *
 * Flows 2–4 refresh through `refreshDistributionCacheAfterWrite`, which as of
 * Design B step 1 AWAITS its inner `saveDistributionCurrent`
 * (`awaitCachePersist`, see distributionStorage.ts). The guarantee is
 * therefore SYNCHRONOUS: when the flow's own promise resolves, the mirror on
 * disk is already correct. These assertions used to poll (50 × 5 ms) because
 * the write was fire-and-forget; they now assert ONCE, immediately, which is
 * what makes them a real guard on that synchronicity — restore the
 * fire-and-forget write and every one of them fails.
 */

const MONTH = "5-May-2026";
const GONE = "emp-gone"; // the employee who ends up with zero entries
const KEEP = "emp-keep";

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
    drawnAt: "2026-05-01T00:00:00.000Z",
    drawnBy: "admin",
    rows,
  };
}

/**
 * Reproduces the data-layer shape of `useDistributionActions.refreshDistribution`
 * — the distribute/assign write path: derive from the full log, stamp
 * `logRevision`, persist. This is the one flow that awaits the mirror write.
 */
async function persistDerivedDistribution(
  root: DirectoryHandleLike,
  rows: PreparedPopulationRow[]
): Promise<void> {
  const log = await loadDistributionLog(root, MONTH);
  await saveDistributionCurrent(root, MONTH, {
    ...deriveCurrentDistribution(log, rows),
    logRevision: log.revision,
  });
}

/** Sample master + assignment events + a first mirror sync where GONE owns work. */
async function seed(
  root: DirectoryHandleLike,
  rows: PreparedPopulationRow[],
  assignments: Array<{ id: string; to: string }>
): Promise<void> {
  await saveSampleMaster(root, MONTH, makeSample(rows));
  await appendDistributionEvents(
    root,
    MONTH,
    assignments.map((a) =>
      buildAssignEvent({ xrayImageId: a.id, assignedTo: a.to, eventBy: "admin" })
    )
  );
  await persistDerivedDistribution(root, rows);

  // Precondition for every case below: GONE really does hold work right now.
  const before = await loadEmployeeSampleMirror(root, MONTH, GONE);
  expect(before?.entries.length ?? 0).toBeGreaterThan(0);
}

/**
 * Asserted ONCE, with no polling and no extra tick: the write flow's promise
 * has already resolved by the time this runs, and the mirror refresh it drives
 * is synchronous (see this file's header). The file must EXIST and be empty —
 * not be deleted, and not be absent.
 */
async function expectEmptyMirrorNow(
  root: DirectoryHandleLike,
  username: string
): Promise<void> {
  const mirror = await loadEmployeeSampleMirror(root, MONTH, username);
  expect(mirror, `mirror for ${username} is missing entirely`).not.toBeNull();
  expect(mirror!.username).toBe(username);
  expect(mirror!.entries.map((e) => e.xrayImageId)).toEqual([]);
}

describe("per-employee mirror drop-to-zero contract", () => {
  beforeEach(() => {
    invalidateMonthLockCache();
    __clearDeriveMemoForTests();
  });

  it("flow 1 — distribute/assign: reassigning every row away empties the mirror", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    const rows = [makeRow("A1"), makeRow("A2")];
    await seed(root, rows, [
      { id: "A1", to: GONE },
      { id: "A2", to: GONE },
    ]);

    await appendDistributionEvents(root, MONTH, [
      buildReassignEvent({ xrayImageId: "A1", assignedTo: GONE, reassignedTo: KEEP, eventBy: "admin" }),
      buildReassignEvent({ xrayImageId: "A2", assignedTo: GONE, reassignedTo: KEEP, eventBy: "admin" }),
    ]);
    await persistDerivedDistribution(root, rows);

    await expectEmptyMirrorNow(root, GONE);
    const keep = await loadEmployeeSampleMirror(root, MONTH, KEEP);
    expect(keep?.entries.map((e) => e.xrayImageId).sort()).toEqual(["A1", "A2"]);
  });

  it("flow 2 — reopen: the reopen refresh empties a mirror that dropped to zero", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    const rows = [makeRow("A1"), makeRow("A2")];
    await seed(root, rows, [
      { id: "A1", to: GONE },
      { id: "A2", to: KEEP },
    ]);

    // KEEP completes and submits A2 — the row the reopen flow will act on.
    await appendDistributionEvents(root, MONTH, [
      buildCompletedEvent({ xrayImageId: "A2", assignedTo: KEEP, eventBy: KEEP }),
    ]);
    await upsertItemAnswer(root, MONTH, KEEP, {
      xrayImageId: "A2",
      templateId: "t1",
      templateVersion: 1,
      answers: [],
      lastSavedAt: "2026-05-10T10:00:00.000Z",
      submittedAt: "2026-05-10T10:00:00.000Z",
      answeredBy: KEEP,
      status: "submitted",
    } satisfies ItemAnswer);

    // Meanwhile A1 moves off GONE (another actor / another machine), leaving
    // GONE's mirror stale at the older revision.
    await appendDistributionEvents(root, MONTH, [
      buildReassignEvent({ xrayImageId: "A1", assignedTo: GONE, reassignedTo: KEEP, eventBy: "admin" }),
    ]);

    const result = await reopenSubmittedAnswer({
      directoryHandle: root,
      monthFolderName: MONTH,
      employeeUsername: KEEP,
      xrayImageId: "A2",
      reopenedBy: "sup1",
      reopenedByRole: "supervisor",
      reason: "خطأ في الإجابة",
    });
    expect(result).toEqual({ ok: true });

    await expectEmptyMirrorNow(root, GONE);
  });

  it("flow 3 — referral approval: the approved transfer empties the sender's mirror", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    const rows = [makeRow("A1"), makeRow("A2")];
    await seed(root, rows, [
      { id: "A1", to: GONE },
      { id: "A2", to: GONE },
    ]);

    await appendReferralRequest(root, MONTH, {
      requestId: "req-1",
      monthFolderName: MONTH,
      fromEmployee: GONE,
      toEmployee: KEEP,
      xrayImageIds: ["A1", "A2"],
      reason: "ضغط عمل",
      requestedAt: "2026-05-11T00:00:00.000Z",
      requestedBy: GONE,
      status: "pending",
    } satisfies ReferralRequest);

    const result = await approveReferral({
      directoryHandle: root,
      monthFolderName: MONTH,
      requestId: "req-1",
      reviewedBy: "sup1",
    });
    expect(result).toEqual({ ok: true, alreadyApplied: false });

    await expectEmptyMirrorNow(root, GONE);
  });

  it("flow 4 — replacement: the replacement refresh empties a mirror that dropped to zero (F20)", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    const sampledRows = [makeRow("A1"), makeRow("A2")];
    // B1 is population-only: eligible as a replacement (same tier, not sampled,
    // not owned).
    const populationRows = [...sampledRows, makeRow("B1")];
    await seed(root, sampledRows, [
      { id: "A1", to: GONE },
      { id: "A2", to: KEEP },
    ]);

    // A1 moves off GONE, leaving GONE's mirror stale at the older revision.
    await appendDistributionEvents(root, MONTH, [
      buildReassignEvent({ xrayImageId: "A1", assignedTo: GONE, reassignedTo: KEEP, eventBy: "admin" }),
    ]);

    const log = await loadDistributionLog(root, MONTH);
    const current = deriveCurrentDistribution(log, sampledRows);
    const deadEntry = current.entries.find((e) => e.xrayImageId === "A2")!;
    expect(deadEntry.assignedTo).toBe(KEEP);

    const result = await executeReplacement({
      directoryHandle: root,
      monthFolderName: MONTH,
      deadEntry,
      replacementRow: populationRows.find((r) => r.xrayImageId === "B1")!,
      reason: "الصورة تالفة",
      eventBy: "sup1",
    });
    expect(result.ok).toBe(true);

    await expectEmptyMirrorNow(root, GONE);
  });
});
