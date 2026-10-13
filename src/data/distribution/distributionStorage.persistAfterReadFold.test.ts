// Opt-in persistence of distribution.current.json after a READ-side fold
// (`persistAfterReadFold`). Default reads stay A6a: a read never writes.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setReadOnlyMode } from "../storage/readOnlyMode";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import { saveSampleMaster } from "../sampling/sampleStorage";
import type { SampleMasterData } from "../sampling/sampleTypes";
import type { PreparedPopulationRow } from "../population/populationTypes";
import { getSampleMainDir } from "../workspace/workspacePaths";
import { buildAssignEvent } from "./distributionLog";
import {
  __clearDeriveMemoForTests,
  appendDistributionEvents,
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

async function seed() {
  const root = createMemoryDirectory("root");
  const rows = [makeRow("IMG-1"), makeRow("IMG-2")];
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
  });
  afterEach(() => {
    setReadOnlyMode(false);
  });

  it("default: a read-side fold writes nothing", async () => {
    const { root, rows } = await seed();
    const dist = await loadOrDeriveDistributionCurrentStrictForRead(root, MONTH, rows);
    expect(dist?.entries.length).toBe(2);
    expect(await loadCachedEntryCount(root)).toBeNull();
  });

  it("opt-in: a read-side fold persists distribution.current.json", async () => {
    const { root, rows } = await seed();
    const dist = await loadOrDeriveDistributionCurrentStrictForRead(root, MONTH, rows, {
      persistAfterReadFold: true,
    });
    expect(dist?.entries.length).toBe(2);
    expect(await loadCachedEntryCount(root)).toBe(dist?.entries.length);
  });

  it("opt-in: a read served from an existing cache performs no write", async () => {
    const { root, rows } = await seed();
    await loadOrDeriveDistributionCurrentStrictForRead(root, MONTH, rows, { persistAfterReadFold: true });
    const before = await cacheStamp(root);
    __clearDeriveMemoForTests();
    const outcome = await loadOrDeriveDistributionCurrentOutcomeForRead(root, MONTH, rows, {
      persistAfterReadFold: true,
    });
    expect(outcome.kind === "ok" && outcome.source).not.toBe("fold");
    expect(await cacheStamp(root)).toBe(before);
  });

  it("read-only session: no write attempted and no retry stall", async () => {
    const { root, rows } = await seed();
    setReadOnlyMode(true);
    const started = Date.now();
    const dist = await loadOrDeriveDistributionCurrentStrictForRead(root, MONTH, rows, {
      persistAfterReadFold: true,
    });
    expect(dist?.entries.length).toBe(2);
    expect(Date.now() - started).toBeLessThan(900); // the persist retry sleeps >= 1 s
    expect(await loadCachedEntryCount(root)).toBeNull();
  });

  it("a memo-served read with the flag writes nothing", async () => {
    const { root, rows } = await seed();
    await loadOrDeriveDistributionCurrentStrictForRead(root, MONTH, rows); // folds + memoizes, no write
    const outcome = await loadOrDeriveDistributionCurrentOutcomeForRead(root, MONTH, rows, {
      persistAfterReadFold: true,
    });
    expect(outcome.kind === "ok" && outcome.source).toBe("memo");
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
    expect(await loadCachedEntryCount(root)).toBe(2);
    const before = await cacheStamp(root);

    await queueDistributionCurrentPersist(root, MONTH, stale.current);

    expect(await cacheStamp(root)).toBe(before);
    expect(await loadCachedEntryCount(root)).toBe(2);
  });
});
