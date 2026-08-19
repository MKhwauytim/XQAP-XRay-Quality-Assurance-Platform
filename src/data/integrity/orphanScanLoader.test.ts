import { describe, expect, it } from "vitest";

import { upsertItemAnswer } from "../answers/answerStorage";
import { appendReferralRequest } from "../referral/referralStorage";
import type { ReferralRequest } from "../referral/referralTypes";
import {
  appendDistributionEvents,
  loadDistributionLog,
  saveDistributionCurrent,
} from "../distribution/distributionStorage";
import { buildAssignEvent, deriveCurrentDistribution } from "../distribution/distributionLog";
import type { DistributionCurrentData } from "../distribution/distributionTypes";
import type { PreparedPopulationRow } from "../population/populationTypes";
import { toEmployeeMirrorRowStub } from "../population/populationTypes";
import { createMemoryDirectory } from "../storage/memoryDirectory";
import { safeWriteJson } from "../storage/safeWrite";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { getPopulationMonthDir, getSampleMainDir } from "../workspace/workspacePaths";

import { runMonthIntegrityScan } from "./orphanScanLoader";

const MONTH = "5-May-2026";

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

function makeRoot(): DirectoryHandleLike {
  return createMemoryDirectory("root") as unknown as DirectoryHandleLike;
}

async function seedPopulation(root: DirectoryHandleLike, ids: string[]): Promise<void> {
  const monthDir = await getPopulationMonthDir(root, MONTH, true);
  const processedDir = await monthDir.getDirectoryHandle("2-processed", { create: true });
  await safeWriteJson(processedDir, "population.final.json", {
    sourceMonthFolder: MONTH,
    processedAt: "2026-05-31T10:00:00.000Z",
    processedBy: "admin",
    totalRows: ids.length,
    certScanRows: 0,
    nonCertScanRows: ids.length,
    rows: ids.map((id) => ({ xrayImageId: id })),
  });
}

async function seedSample(root: DirectoryHandleLike, ids: string[]): Promise<PreparedPopulationRow[]> {
  const rows = ids.map(makeRow);
  const sampleDir = await getSampleMainDir(root, MONTH, true);
  await safeWriteJson(sampleDir, "sample.master.json", {
    monthFolderName: MONTH,
    generatedAt: "2026-05-31T10:00:00.000Z",
    generatedBy: "admin",
    rows,
  });
  return rows;
}

/**
 * Seeds a real assignment for every id in `assignedIds` (so distributionIds
 * legitimately covers them), then overwrites the write-path cache with one
 * EXTRA fabricated entry for `orphanId` -- an id absent from `sampleRows`.
 * Mirrors distributionStorage.test.ts's `writeWritePathCache` helper: the fast
 * path in `loadOrDeriveDistributionCurrentForRead` serves a fully-stamped
 * cache as-is with no refold, which is the only on-disk state that can
 * currently carry a distribution entry the fold's own absent-row branch would
 * otherwise have silently dropped (see orphanScanLoader.ts's docblock).
 */
async function seedDistributionWithOrphan(
  root: DirectoryHandleLike,
  sampleRows: PreparedPopulationRow[],
  assignedIds: string[],
  orphanId: string
): Promise<void> {
  await appendDistributionEvents(
    root,
    MONTH,
    assignedIds.map((id) => buildAssignEvent({ xrayImageId: id, assignedTo: "alice", eventBy: "admin" }))
  );
  const log = await loadDistributionLog(root, MONTH);
  const derived = deriveCurrentDistribution(log, sampleRows);
  const current: DistributionCurrentData = {
    ...derived,
    logRevision: log.revision,
    ...(log.eventSetId === undefined ? {} : { eventSetId: log.eventSetId }),
    entries: [
      ...derived.entries,
      {
        xrayImageId: orphanId,
        assignedTo: "alice",
        status: "pending",
        replacedById: null,
        lastEventAt: new Date().toISOString(),
        row: toEmployeeMirrorRowStub(makeRow(orphanId)),
      },
    ],
  };
  await saveDistributionCurrent(root, MONTH, current);
}

async function seedAnswer(root: DirectoryHandleLike, username: string, xrayImageId: string): Promise<void> {
  const result = await upsertItemAnswer(root, MONTH, username, {
    xrayImageId,
    templateId: "t1",
    templateVersion: 1,
    answers: [],
    lastSavedAt: new Date().toISOString(),
    submittedAt: null,
    answeredBy: username,
    status: "draft",
  });
  expect(result.ok).toBe(true);
}

async function seedReferral(root: DirectoryHandleLike, xrayImageIds: string[]): Promise<void> {
  const request: ReferralRequest = {
    requestId: "req-1",
    monthFolderName: MONTH,
    fromEmployee: "bob",
    toEmployee: "carol",
    xrayImageIds,
    reason: "needs secondary review",
    requestedAt: new Date().toISOString(),
    requestedBy: "bob",
    status: "pending",
  };
  const result = await appendReferralRequest(root, MONTH, request);
  expect(result.ok).toBe(true);
}

describe("runMonthIntegrityScan", () => {
  it("flags one orphan in every category for a month seeded with exactly one of each", async () => {
    const root = makeRoot();

    // population: p1, p2, p3
    await seedPopulation(root, ["p1", "p2", "p3"]);
    // sample: p1, p2, sample-orphan (sample-orphan absent from population)
    const sampleRows = await seedSample(root, ["p1", "p2", "sample-orphan"]);
    // distribution: real assignments for p1 + p2 (both in sample), plus a
    // fabricated cache entry for dist-orphan (absent from sample).
    await seedDistributionWithOrphan(root, sampleRows, ["p1", "p2"], "dist-orphan");
    // answers: p1 (anchored) + answer-orphan (absent from distribution)
    await seedAnswer(root, "bob", "p1");
    await seedAnswer(root, "bob", "answer-orphan");
    // approvals: a referral request for approval-orphan (absent from distribution)
    await seedReferral(root, ["approval-orphan"]);

    const result = await runMonthIntegrityScan(root, MONTH);

    expect(result.sampleOrphans).toEqual(["sample-orphan"]);
    expect(result.distributionOrphans).toEqual(["dist-orphan"]);
    expect(result.answersOrphans).toEqual(["answer-orphan"]);
    expect(result.approvalsOrphans).toEqual(["approval-orphan"]);
    expect(result.clean).toBe(false);
  });

  it("reports a clean month when every id is anchored", async () => {
    const root = makeRoot();
    await seedPopulation(root, ["p1", "p2"]);
    const sampleRows = await seedSample(root, ["p1"]);
    await appendDistributionEvents(root, MONTH, [
      buildAssignEvent({ xrayImageId: "p1", assignedTo: "alice", eventBy: "admin" }),
    ]);
    // Force a refold from the real events (no orphan injected) so entries
    // exactly match the sample.
    const log = await loadDistributionLog(root, MONTH);
    const derived = deriveCurrentDistribution(log, sampleRows);
    await saveDistributionCurrent(root, MONTH, {
      ...derived,
      logRevision: log.revision,
      ...(log.eventSetId === undefined ? {} : { eventSetId: log.eventSetId }),
    });
    await seedAnswer(root, "bob", "p1");

    const result = await runMonthIntegrityScan(root, MONTH);

    expect(result.clean).toBe(true);
    expect(result.sampleOrphans).toEqual([]);
    expect(result.distributionOrphans).toEqual([]);
    expect(result.answersOrphans).toEqual([]);
    expect(result.approvalsOrphans).toEqual([]);
  });

  it("returns an all-clean scan for a month with nothing on disk yet", async () => {
    const root = makeRoot();
    const result = await runMonthIntegrityScan(root, "9-September-2026");
    expect(result).toEqual({
      answersOrphans: [],
      approvalsOrphans: [],
      sampleOrphans: [],
      distributionOrphans: [],
      clean: true,
    });
  });
});
