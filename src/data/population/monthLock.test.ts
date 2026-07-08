import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import { safeReadJson, safeWriteJson } from "../storage/safeWrite";
import { setReadOnlyMode } from "../storage/readOnlyMode";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { getPopulationMonthDir } from "../workspace/workspacePaths";
import type { MonthManifestData } from "./monthTypes";
import { updateMonthStatus } from "./populationStorage";
import {
  MonthClosedError,
  __resetMonthLockTtlForTests,
  __setMonthLockTtlForTests,
  closeMonth,
  ensureMonthWritable,
  invalidateMonthLockCache,
  isMonthClosed,
  reopenMonth,
} from "./monthLock";
import { saveSampleMaster } from "../sampling/sampleStorage";
import { appendDistributionEvents } from "../distribution/distributionStorage";
import { buildAssignEvent } from "../distribution/distributionLog";
import { upsertItemAnswer } from "../answers/answerStorage";
import { appendDecisionEvent } from "../approvals/approvalStorage";
import type { ItemAnswer } from "../answers/answerTypes";
import type { SampleMasterData } from "../sampling/sampleTypes";

const MONTH = "5-may-2026";

function makeRoot(): DirectoryHandleLike {
  return createMemoryDirectory("root") as DirectoryHandleLike;
}

async function seedManifest(
  root: DirectoryHandleLike,
  status: MonthManifestData["status"] = "distributed"
): Promise<void> {
  const monthDir = await getPopulationMonthDir(root, MONTH, true);
  const manifest: MonthManifestData = {
    monthFolderName: MONTH,
    month: 5,
    year: 2026,
    processedAt: new Date().toISOString(),
    processedBy: "admin",
    riskFileName: null,
    biFileName: null,
    certScanUsed: false,
    templateVersion: null,
    rngSeed: null,
    totalRawRows: 0,
    totalProcessedRows: 0,
    status,
  };
  await safeWriteJson(monthDir, "month.manifest.json", manifest);
}

async function readManifest(root: DirectoryHandleLike): Promise<MonthManifestData> {
  const monthDir = await getPopulationMonthDir(root, MONTH, false);
  const result = await safeReadJson<MonthManifestData>(monthDir, "month.manifest.json");
  if (!result.ok) throw new Error("manifest missing in test");
  return result.value;
}

function makeSample(): SampleMasterData {
  return {
    rngSeed: "s",
    totalRequested: 0,
    totalActual: 0,
    certScanRequested: 0,
    nonCertScanRequested: 0,
    certScanActual: 0,
    nonCertScanActual: 0,
    portAllocations: [],
    stageAllocations: [],
    drawnAt: new Date().toISOString(),
    drawnBy: "admin",
    rows: [],
  };
}

function makeAnswer(): ItemAnswer {
  return {
    xrayImageId: "A1",
    templateId: "t1",
    templateVersion: 1,
    answers: [],
    lastSavedAt: new Date().toISOString(),
    submittedAt: null,
    answeredBy: "emp1",
    status: "draft",
  };
}

describe("monthLock", () => {
  beforeEach(() => {
    invalidateMonthLockCache();
    setReadOnlyMode(false);
  });

  afterEach(() => {
    __resetMonthLockTtlForTests();
    setReadOnlyMode(false);
  });

  it("closeMonth marks the month closed and stamps audit fields", async () => {
    const root = makeRoot();
    await seedManifest(root, "distributed");

    const result = await closeMonth(root, MONTH, "admin", "نهاية الشهر");
    expect(result.ok).toBe(true);
    expect(await isMonthClosed(root, MONTH)).toBe(true);

    const manifest = await readManifest(root);
    expect(manifest.status).toBe("closed");
    expect(manifest.statusBeforeClose).toBe("distributed");
    expect(manifest.closedBy).toBe("admin");
    expect(manifest.closeNote).toBe("نهاية الشهر");
    expect(manifest.closedAt).toBeTruthy();
  });

  it("reopenMonth restores statusBeforeClose; double close/reopen are idempotent", async () => {
    const root = makeRoot();
    await seedManifest(root, "sampled");

    await closeMonth(root, MONTH, "admin");
    expect((await closeMonth(root, MONTH, "admin")).ok).toBe(true); // idempotent

    const reopened = await reopenMonth(root, MONTH, "admin");
    expect(reopened.ok).toBe(true);
    expect((await reopenMonth(root, MONTH, "admin")).ok).toBe(true); // idempotent

    const manifest = await readManifest(root);
    expect(manifest.status).toBe("sampled");
    expect(manifest.reopenedBy).toBe("admin");
    expect(await isMonthClosed(root, MONTH)).toBe(false);
  });

  it("ensureMonthWritable throws on closed, resolves on open and on missing manifest", async () => {
    const root = makeRoot();
    // Missing manifest: fail-open.
    await expect(ensureMonthWritable(root, MONTH)).resolves.toBeUndefined();

    await seedManifest(root, "distributed");
    invalidateMonthLockCache();
    await expect(ensureMonthWritable(root, MONTH)).resolves.toBeUndefined();

    await closeMonth(root, MONTH, "admin");
    await expect(ensureMonthWritable(root, MONTH)).rejects.toThrow(MonthClosedError);
  });

  it("guarded writers reject with MonthClosedError after close and succeed after reopen", async () => {
    const root = makeRoot();
    await seedManifest(root, "distributed");
    await closeMonth(root, MONTH, "admin");

    await expect(saveSampleMaster(root, MONTH, makeSample())).rejects.toThrow(MonthClosedError);
    await expect(
      appendDistributionEvents(root, MONTH, [
        buildAssignEvent({ xrayImageId: "A1", assignedTo: "emp1", eventBy: "admin" }),
      ])
    ).rejects.toThrow(MonthClosedError);
    await expect(upsertItemAnswer(root, MONTH, "emp1", makeAnswer())).rejects.toThrow(
      MonthClosedError
    );
    await expect(
      appendDecisionEvent(root, MONTH, "sup1", {
        requestId: "r1",
        kind: "referral",
        status: "approved",
        reviewedBy: "sup1",
        reviewedAt: new Date().toISOString(),
      })
    ).rejects.toThrow(MonthClosedError);

    await reopenMonth(root, MONTH, "admin");

    expect((await saveSampleMaster(root, MONTH, makeSample())).ok).toBe(true);
    expect(
      (
        await appendDistributionEvents(root, MONTH, [
          buildAssignEvent({ xrayImageId: "A1", assignedTo: "emp1", eventBy: "admin" }),
        ])
      ).ok
    ).toBe(true);
    expect((await upsertItemAnswer(root, MONTH, "emp1", makeAnswer())).ok).toBe(true);
    expect(
      (
        await appendDecisionEvent(root, MONTH, "sup1", {
          requestId: "r1",
          kind: "referral",
          status: "approved",
          reviewedBy: "sup1",
          reviewedAt: new Date().toISOString(),
        })
      ).ok
    ).toBe(true);
  });

  it("updateMonthStatus is a no-op on a closed month", async () => {
    const root = makeRoot();
    await seedManifest(root, "sampled");
    await closeMonth(root, MONTH, "admin");

    await updateMonthStatus(root, MONTH, "distributed");

    const manifest = await readManifest(root);
    expect(manifest.status).toBe("closed");
  });

  it("caches the closed state until invalidated; TTL 0 sees external changes immediately", async () => {
    const root = makeRoot();
    await seedManifest(root, "distributed");

    // Prime the cache as open.
    expect(await isMonthClosed(root, MONTH)).toBe(false);

    // Simulate another machine closing the month by writing the manifest
    // directly (bypassing closeMonth's cache invalidation).
    const monthDir = await getPopulationMonthDir(root, MONTH, false);
    const manifest = await readManifest(root);
    await safeWriteJson(monthDir, "month.manifest.json", {
      ...manifest,
      status: "closed" as const,
    });

    // Cached: still reported open within the TTL window.
    expect(await isMonthClosed(root, MONTH)).toBe(false);

    // Invalidation makes it visible.
    invalidateMonthLockCache(MONTH);
    expect(await isMonthClosed(root, MONTH)).toBe(true);

    // TTL 0: every check re-reads the manifest.
    __setMonthLockTtlForTests(0);
    await safeWriteJson(monthDir, "month.manifest.json", { ...manifest, status: "distributed" as const });
    expect(await isMonthClosed(root, MONTH)).toBe(false);
  });

  it("demo read-only mode never throws from ensureMonthWritable", async () => {
    const root = makeRoot();
    await seedManifest(root, "distributed");
    await closeMonth(root, MONTH, "admin");

    setReadOnlyMode(true);
    await expect(ensureMonthWritable(root, MONTH)).resolves.toBeUndefined();
  });
});
