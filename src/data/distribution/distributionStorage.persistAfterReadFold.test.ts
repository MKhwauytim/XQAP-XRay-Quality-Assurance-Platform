// Opt-in persistence of distribution.current.json after a READ-side fold
// (`persistAfterReadFold`). Default reads stay A6a: a read never writes.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setReadOnlyMode } from "../storage/readOnlyMode";

import { clearOperationLog, createMemoryDirectory, getOperationLog } from "../storage/memoryDirectory";
import { clearErrors, getRecentErrors } from "../storage/errorLogger";
import { safeWriteJson } from "../storage/safeWrite";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { saveSampleMaster } from "../sampling/sampleStorage";
import type { SampleMasterData } from "../sampling/sampleTypes";
import type { PreparedPopulationRow } from "../population/populationTypes";
import type { MonthManifestData } from "../population/monthTypes";
import { closeMonth, invalidateMonthLockCache } from "../population/monthLock";
import { getPopulationMonthDir, getSampleMainDir } from "../workspace/workspacePaths";
import { buildAssignEvent } from "./distributionLog";
import {
  __clearDeriveMemoForTests,
  __resetReadFoldPersistClosedMonthLogForTests,
  appendDistributionEvents,
  flushPendingDistributionPersist,
  loadOrDeriveDistributionCurrentOutcomeForRead,
  loadOrDeriveDistributionCurrentStrictForRead,
  queueDistributionCurrentPersist,
} from "./distributionStorage";

const MONTH = "5-may-2026";

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

async function writeOpenManifest(root: DirectoryHandleLike, month: string): Promise<void> {
  const monthDir = await getPopulationMonthDir(root, month, true);
  const manifest: MonthManifestData = {
    monthFolderName: month, month: 5, year: 2026,
    processedAt: new Date().toISOString(), processedBy: "admin",
    riskFileName: null, biFileName: null, certScanUsed: false,
    templateVersion: null, rngSeed: null, totalRawRows: 0, totalProcessedRows: 2,
    status: "distributed",
  };
  await safeWriteJson(monthDir, "month.manifest.json", manifest);
}

async function seed(options: { trackOperations?: boolean; extraRows?: string[] } = {}) {
  const root = createMemoryDirectory("root", { trackOperations: options.trackOperations ?? false });
  const rows = [makeRow("IMG-1"), makeRow("IMG-2"), ...(options.extraRows ?? []).map(makeRow)];
  const saved = await saveSampleMaster(root, MONTH, makeSample(rows));
  if (!saved.ok) throw new Error("seed sample failed");
  const appended = await appendDistributionEvents(root, MONTH, [
    buildAssignEvent({ xrayImageId: "IMG-1", assignedTo: "emp-1", eventBy: "admin" }),
    buildAssignEvent({ xrayImageId: "IMG-2", assignedTo: "emp-2", eventBy: "admin" }),
  ]);
  if (!appended.ok) throw new Error(`seed assign failed: ${appended.error}`);
  __clearDeriveMemoForTests();
  return { root, rows };
}

async function loadCachedEntryCount(root: ReturnType<typeof createMemoryDirectory>): Promise<number | null> {
  const dir = await getSampleMainDir(root, MONTH, true);
  try {
    const file = await (await dir.getFileHandle("distribution.current.json")).getFile();
    const parsed = JSON.parse(await file.text()) as { data?: { entries?: unknown[] } };
    return parsed.data?.entries?.length ?? null;
  } catch {
    return null;
  }
}

async function cacheStamp(root: ReturnType<typeof createMemoryDirectory>): Promise<string> {
  const dir = await getSampleMainDir(root, MONTH, true);
  const file = await (await dir.getFileHandle("distribution.current.json")).getFile();
  return `${file.lastModified}|${await file.text()}`;
}


describe("persistAfterReadFold", () => {
  beforeEach(() => {
    __clearDeriveMemoForTests();
    __resetReadFoldPersistClosedMonthLogForTests();
    invalidateMonthLockCache();
    clearErrors();
  });
  afterEach(async () => {
    setReadOnlyMode(false);
    vi.restoreAllMocks();
    await flushPendingDistributionPersist();
  });

  it("default: a read-side fold writes nothing", async () => {
    const { root, rows } = await seed();
    const dist = await loadOrDeriveDistributionCurrentStrictForRead(root, MONTH, rows);
    expect(dist?.entries.length).toBe(2);
    await flushPendingDistributionPersist(root, MONTH);
    expect(await loadCachedEntryCount(root)).toBeNull();
  });

  it("opt-in: a read-side fold persists distribution.current.json (behind the read, not awaited by it)", async () => {
    const { root, rows } = await seed();
    const dist = await loadOrDeriveDistributionCurrentStrictForRead(root, MONTH, rows, {
      persistAfterReadFold: true,
    });
    expect(dist?.entries.length).toBe(2);
    await flushPendingDistributionPersist(root, MONTH);
    expect(await loadCachedEntryCount(root)).toBe(dist?.entries.length);
  });

  it("opt-in: a checkpoint resume that folded a newer event persists an updated cache", async () => {
    const { root, rows } = await seed({ extraRows: ["IMG-3"] });
    await loadOrDeriveDistributionCurrentStrictForRead(root, MONTH, rows, { persistAfterReadFold: true });
    await flushPendingDistributionPersist(root, MONTH);
    expect(await loadCachedEntryCount(root)).toBe(2);

    // A newer event lands; the on-disk cache + checkpoint are now one event behind.
    const appended = await appendDistributionEvents(root, MONTH, [
      buildAssignEvent({ xrayImageId: "IMG-3", assignedTo: "emp-1", eventBy: "admin" }),
    ]);
    if (!appended.ok) throw new Error("append failed");
    await flushPendingDistributionPersist(root, MONTH);
    expect(await loadCachedEntryCount(root)).toBe(2);
    __clearDeriveMemoForTests();

    const outcome = await loadOrDeriveDistributionCurrentOutcomeForRead(root, MONTH, rows, {
      persistAfterReadFold: true,
    });
    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") return;
    expect(outcome.source).toBe("checkpoint");
    expect(outcome.resumedWithNewEvents).toBe(true);
    expect(outcome.current.entries.length).toBe(3);
    await flushPendingDistributionPersist(root, MONTH);
    expect(await loadCachedEntryCount(root)).toBe(3);
  });

  it("opt-in: a read served from an existing cache performs no write", async () => {
    const { root, rows } = await seed();
    await loadOrDeriveDistributionCurrentStrictForRead(root, MONTH, rows, { persistAfterReadFold: true });
    await flushPendingDistributionPersist(root, MONTH);
    const before = await cacheStamp(root);
    __clearDeriveMemoForTests();
    const outcome = await loadOrDeriveDistributionCurrentOutcomeForRead(root, MONTH, rows, {
      persistAfterReadFold: true,
    });
    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") return;
    expect(outcome.source).not.toBe("fold");
    await flushPendingDistributionPersist(root, MONTH);
    expect(await cacheStamp(root)).toBe(before);
  });

  it("read-only session: no write attempted and no retry sleep scheduled", async () => {
    const { root, rows } = await seed({ trackOperations: true });
    setReadOnlyMode(true);
    clearOperationLog(root);
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const dist = await loadOrDeriveDistributionCurrentStrictForRead(root, MONTH, rows, {
      persistAfterReadFold: true,
    });
    expect(dist?.entries.length).toBe(2);
    await flushPendingDistributionPersist(root, MONTH);
    // The persist retry sleeps >= 1 s; none was scheduled.
    const longSleeps = timeoutSpy.mock.calls.filter(([, ms]) => typeof ms === "number" && ms >= 1000);
    expect(longSleeps).toEqual([]);
    const writes = getOperationLog(root).filter((entry) => entry.operation === "createWritable");
    expect(writes).toEqual([]);
    expect(await loadCachedEntryCount(root)).toBeNull();
  });

  it("closed month: no write attempt, one log line across two reads", async () => {
    const { root, rows } = await seed({ trackOperations: true });
    await writeOpenManifest(root, MONTH);
    const closed = await closeMonth(root, MONTH, "admin");
    expect(closed).toEqual({ ok: true });
    clearOperationLog(root);
    clearErrors();

    for (let i = 0; i < 2; i += 1) {
      __clearDeriveMemoForTests();
      const outcome = await loadOrDeriveDistributionCurrentOutcomeForRead(root, MONTH, rows, {
        persistAfterReadFold: true,
      });
      expect(outcome.kind === "ok" && outcome.source).toBe("fold");
      await flushPendingDistributionPersist(root, MONTH);
    }

    expect(getOperationLog(root).filter((entry) => entry.operation === "createWritable")).toEqual([]);
    expect(await loadCachedEntryCount(root)).toBeNull();
    const lines = getRecentErrors().filter(
      (entry) => entry.context === "distribution:persist-after-read-fold:month-closed"
    );
    expect(lines).toHaveLength(1);
  });

  it("a memo-served read with the flag writes nothing", async () => {
    const { root, rows } = await seed();
    await loadOrDeriveDistributionCurrentStrictForRead(root, MONTH, rows); // folds + memoizes, no write
    const outcome = await loadOrDeriveDistributionCurrentOutcomeForRead(root, MONTH, rows, {
      persistAfterReadFold: true,
    });
    expect(outcome.kind === "ok" && outcome.source).toBe("memo");
    await flushPendingDistributionPersist(root, MONTH);
    expect(await loadCachedEntryCount(root)).toBeNull();
  });

  it("never replaces a cache that covers more of the event store with a staler snapshot", async () => {
    const root = createMemoryDirectory("root");
    const rows = [makeRow("IMG-1"), makeRow("IMG-2")];
    await saveSampleMaster(root, MONTH, makeSample(rows));
    await appendDistributionEvents(root, MONTH, [
      buildAssignEvent({ xrayImageId: "IMG-1", assignedTo: "emp-1", eventBy: "admin" }),
    ]);
    __clearDeriveMemoForTests();
    const stale = await loadOrDeriveDistributionCurrentOutcomeForRead(root, MONTH, rows);
    if (stale.kind !== "ok") throw new Error("stale read failed");
    await appendDistributionEvents(root, MONTH, [
      buildAssignEvent({ xrayImageId: "IMG-2", assignedTo: "emp-2", eventBy: "admin" }),
    ]);
    __clearDeriveMemoForTests();
    await loadOrDeriveDistributionCurrentStrictForRead(root, MONTH, rows, { persistAfterReadFold: true });
    await flushPendingDistributionPersist(root, MONTH);
    expect(await loadCachedEntryCount(root)).toBe(2);
    const before = await cacheStamp(root);

    await queueDistributionCurrentPersist(root, MONTH, stale.current);

    expect(await cacheStamp(root)).toBe(before);
    expect(await loadCachedEntryCount(root)).toBe(2);
  });
});
