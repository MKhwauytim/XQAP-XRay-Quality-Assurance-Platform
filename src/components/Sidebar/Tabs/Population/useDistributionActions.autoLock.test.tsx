/* @vitest-environment jsdom */
// Owner requirement (2026-08-07): "once for a month i finish uploading and
// distributing sample using إدارة بيانات الأشعة it get locked ... auto lock
// ... and admin can unlock it if he wants". This exercises the real
// auto-lock trigger added to useDistributionActions' refreshDistribution
// (autoLockWhenFullyDistributed) against a real in-memory workspace — every
// sample row getting a distribution entry must close the month automatically,
// stamping the SYSTEM_AUTO_LOCK_ACTOR sentinel (distinct from a person
// closing it manually), and it must be idempotent / never fire early.

import { describe, it, expect, afterEach } from "vitest";
import { renderHook, act, cleanup, waitFor } from "@testing-library/react";

import { createMemoryDirectory } from "../../../../data/storage/memoryDirectory";
import { saveMonthRun } from "../../../../data/population/populationStorage";
import { saveSampleMaster } from "../../../../data/sampling/sampleStorage";
import { isMonthClosed, SYSTEM_AUTO_LOCK_ACTOR } from "../../../../data/population/monthLock";
import { loadMonthManifest } from "../../../../data/population/populationStorage";
import type { SampleMasterData } from "../../../../data/sampling/sampleTypes";
import { useDistributionActions } from "./useDistributionActions";

afterEach(() => cleanup());

const MONTH_FOLDER = "5-may-2026";

function makeSample(): SampleMasterData {
  return {
    drawnAt: new Date().toISOString(),
    drawnBy: "admin",
    rngSeed: "seed",
    portAllocations: [],
    stageAllocations: [],
    totalRequested: 2,
    totalActual: 2,
    certScanRequested: 0,
    nonCertScanRequested: 2,
    certScanActual: 0,
    nonCertScanActual: 2,
    rows: [
      { xrayImageId: "A001" } as SampleMasterData["rows"][number],
      { xrayImageId: "A002" } as SampleMasterData["rows"][number],
    ],
  };
}

async function setupWorkspace() {
  const dir = createMemoryDirectory();
  await saveMonthRun({
    directoryHandle: dir,
    month: 5,
    year: 2026,
    username: "admin",
    riskFileName: "risk.xlsx",
    biFileName: null,
    certScanUsed: false,
    riskRawRows: [{ id: "A001" }, { id: "A002" }],
    biRawRows: [],
    processedRows: [
      { xrayImageId: "A001", certScanStatus: "NonCertscan" },
      { xrayImageId: "A002", certScanStatus: "NonCertscan" },
    ],
    certScanRows: 0,
    nonCertScanRows: 2,
  });
  await saveSampleMaster(dir, MONTH_FOLDER, makeSample());
  return dir;
}

describe("useDistributionActions auto-lock", () => {
  it("locks the month once every sample row has a distribution entry, stamping the system-lock sentinel", async () => {
    const dir = await setupWorkspace();
    const sample = makeSample();
    const { result } = renderHook(() =>
      useDistributionActions({
        directoryHandle: dir,
        sampleDrawResult: sample,
        saveMonth: 5,
        saveYear: 2026,
        canDistributeSamples: true,
        canBulkAssign: true,
        currentUsername: "admin",
        currentRole: "admin",
        onDistributionChanged: () => {},
      })
    );

    // First assignment leaves one row unassigned -- must NOT lock yet.
    await act(async () => {
      await result.current.handleAssign("A001", "employee-1");
    });
    expect(await isMonthClosed(dir, MONTH_FOLDER)).toBe(false);

    // Second assignment completes distribution of every sample row -- auto-lock fires.
    await act(async () => {
      await result.current.handleAssign("A002", "employee-2");
    });

    await waitFor(async () => {
      expect(await isMonthClosed(dir, MONTH_FOLDER)).toBe(true);
    });
    const manifest = await loadMonthManifest(dir, MONTH_FOLDER);
    expect(manifest?.closedBy).toBe(SYSTEM_AUTO_LOCK_ACTOR);
    expect(manifest?.status).toBe("closed");
  });
});
