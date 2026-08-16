/* @vitest-environment jsdom */
// Owner requirement (2026-08-07): "once for a month i finish uploading and
// distributing sample using إدارة بيانات الأشعة it get locked ... auto lock
// ... and admin can unlock it if he wants". This exercises the real
// auto-lock trigger added to useDistributionActions' refreshDistribution
// (autoLockWhenFullyDistributed) against a real in-memory workspace — the month
// must close automatically, stamping the SYSTEM_AUTO_LOCK_ACTOR sentinel
// (distinct from a person closing it manually), and it must be idempotent /
// never fire early.
//
// *** DELIBERATE SEMANTICS CHANGE (2026-08-16) — NEEDS OWNER CONFIRMATION ***
// This file previously PINNED "fires as soon as every sample row carries a
// distribution entry, regardless of status", i.e. the lock fired on ASSIGNMENT.
// That made the app unusable end to end: the bulk-assign click that hands work
// out also closed the month, and `ensureMonthWritable` is the single choke point
// for every employee-facing write — so the first answer, referral or replacement
// request after distribution failed with MonthClosedError / "الشهر مُقفل".
// `archive.closeMonth` is false for every managed role (userManagement.ts), so
// the manager who triggered the lock cannot even see the unlock affordance; every
// month needed an admin reopen before review could start.
// The trigger is now "every entry has reached a TERMINAL state (completed or
// replaced)" — i.e. the month locks when the review work is finished, which is
// the reading of "i finish ... distributing sample" that leaves the workflow
// runnable. The assertion below that full assignment does NOT lock is the
// intentional inversion of the old pin.

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

function renderActions(dir: ReturnType<typeof createMemoryDirectory>) {
  const sample = makeSample();
  return renderHook(() =>
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
}

describe("useDistributionActions auto-lock", () => {
  // Regression for DEFECT 3: assignment alone must leave the month writable, or
  // no employee can ever answer the sample they were just handed.
  it("does NOT lock the month when every row is merely assigned (entries still pending)", async () => {
    const dir = await setupWorkspace();
    const { result } = renderActions(dir);

    await act(async () => {
      await result.current.handleAssign("A001", "employee-1");
    });
    expect(await isMonthClosed(dir, MONTH_FOLDER)).toBe(false);

    // Every sample row now carries a distribution entry, but both are `pending`.
    // The old (pinned) behaviour closed the month here; it must stay open.
    await act(async () => {
      await result.current.handleAssign("A002", "employee-2");
    });
    expect(await isMonthClosed(dir, MONTH_FOLDER)).toBe(false);
    expect((await loadMonthManifest(dir, MONTH_FOLDER))?.status).not.toBe("closed");
  });

  it("locks the month once every entry is terminal, stamping the system-lock sentinel", async () => {
    const dir = await setupWorkspace();
    const { result } = renderActions(dir);

    await act(async () => {
      await result.current.handleAssign("A001", "employee-1");
      await result.current.handleAssign("A002", "employee-2");
    });

    // One row completed, one still pending -- must NOT lock yet.
    await act(async () => {
      await result.current.handleMarkComplete("A001");
    });
    expect(await isMonthClosed(dir, MONTH_FOLDER)).toBe(false);

    // Last outstanding entry reaches a terminal state -- auto-lock fires.
    await act(async () => {
      await result.current.handleMarkComplete("A002");
    });

    await waitFor(async () => {
      expect(await isMonthClosed(dir, MONTH_FOLDER)).toBe(true);
    });
    const manifest = await loadMonthManifest(dir, MONTH_FOLDER);
    expect(manifest?.closedBy).toBe(SYSTEM_AUTO_LOCK_ACTOR);
    expect(manifest?.status).toBe("closed");
  });
});
