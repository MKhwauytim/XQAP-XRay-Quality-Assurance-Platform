/* @vitest-environment jsdom */
// Stale-snapshot guards on the Phase 4 assign paths (recorded audit finding,
// 2026-08-16): both the bulk-assign batch and the manual per-row assign were
// idempotent only against THIS tab's `distributionCurrent` — React state that
// can be hours old on a shared UNC/SMB workspace. A row another machine
// assigned in the meantime looked "unassigned" here, and the fold's `assigned`
// handler overwrites `assignedTo` unconditionally, so committing silently
// transferred ownership: no `reassigned` event, no notification, the original
// assignee's queue just shrank. Both handlers now re-read the on-disk log
// right before the durable write and refuse/skip rows that are already owned.
//
// The hook is rendered with an EMPTY distribution snapshot while the on-disk
// log already contains another machine's assignment — the exact stale state.
import { describe, it, expect, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";

import { createMemoryDirectory } from "../../../../data/storage/memoryDirectory";
import { saveMonthRun } from "../../../../data/population/populationStorage";
import { saveSampleMaster } from "../../../../data/sampling/sampleStorage";
import {
  appendDistributionEvents,
  loadDistributionLog,
} from "../../../../data/distribution/distributionStorage";
import { buildAssignEvent, deriveCurrentDistribution } from "../../../../data/distribution/distributionLog";
import { formatMonthFolderName } from "../../../../data/population/monthFolder";
import type { SampleMasterData } from "../../../../data/sampling/sampleTypes";
import { useDistributionActions } from "./useDistributionActions";

afterEach(() => cleanup());

const MONTH_FOLDER = formatMonthFolderName(5, 2026);

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
  // "Another machine" assigns A001 while this tab's snapshot is still empty.
  await appendDistributionEvents(dir, MONTH_FOLDER, [
    buildAssignEvent({ xrayImageId: "A001", assignedTo: "jalgahamdi", eventBy: "other-machine" }),
  ]);
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

async function foldFromDisk(dir: ReturnType<typeof createMemoryDirectory>) {
  return deriveCurrentDistribution(await loadDistributionLog(dir, MONTH_FOLDER), makeSample().rows);
}

describe("useDistributionActions stale-snapshot guards", () => {
  it("bulk assignment skips rows already owned on disk instead of silently transferring them", async () => {
    const dir = await setupWorkspace();
    const { result } = renderActions(dir);

    await act(async () => {
      await result.current.handleApplyBulkAssignment([
        buildAssignEvent({ xrayImageId: "A001", assignedTo: "hihaloraini", eventBy: "admin" }),
        buildAssignEvent({ xrayImageId: "A002", assignedTo: "hihaloraini", eventBy: "admin" }),
      ]);
    });

    // A001 keeps its cross-machine owner; only the genuinely free row landed.
    const current = await foldFromDisk(dir);
    expect(current.entries.find((e) => e.xrayImageId === "A001")?.assignedTo).toBe("jalgahamdi");
    expect(current.entries.find((e) => e.xrayImageId === "A002")?.assignedTo).toBe("hihaloraini");
    // The skipped event was never durably written, not merely out-folded.
    expect((await loadDistributionLog(dir, MONTH_FOLDER)).events).toHaveLength(2);
    expect(result.current.distributionMessage?.type).toBe("ok");
    expect(result.current.distributionMessage?.text).toContain("تم تخطي");
  });

  it("bulk assignment with every row already owned saves nothing and says so", async () => {
    const dir = await setupWorkspace();
    const { result } = renderActions(dir);

    await act(async () => {
      await result.current.handleApplyBulkAssignment([
        buildAssignEvent({ xrayImageId: "A001", assignedTo: "hihaloraini", eventBy: "admin" }),
      ]);
    });

    expect((await loadDistributionLog(dir, MONTH_FOLDER)).events).toHaveLength(1);
    expect((await foldFromDisk(dir)).entries.find((e) => e.xrayImageId === "A001")?.assignedTo).toBe(
      "jalgahamdi"
    );
    expect(result.current.distributionMessage?.type).toBe("error");
  });

  it("manual assign refuses a row already owned on disk", async () => {
    const dir = await setupWorkspace();
    const { result } = renderActions(dir);

    await act(async () => {
      await result.current.handleAssign("A001", "hihaloraini");
    });

    expect(result.current.distributionMessage?.type).toBe("error");
    expect(result.current.distributionMessage?.text).toContain("jalgahamdi");
    expect((await loadDistributionLog(dir, MONTH_FOLDER)).events).toHaveLength(1);
    expect((await foldFromDisk(dir)).entries.find((e) => e.xrayImageId === "A001")?.assignedTo).toBe(
      "jalgahamdi"
    );
  });

  it("manual assign of a genuinely free row still succeeds", async () => {
    const dir = await setupWorkspace();
    const { result } = renderActions(dir);

    await act(async () => {
      await result.current.handleAssign("A002", "hihaloraini");
    });

    expect(result.current.distributionMessage?.type).toBe("ok");
    expect((await foldFromDisk(dir)).entries.find((e) => e.xrayImageId === "A002")?.assignedTo).toBe(
      "hihaloraini"
    );
  });
});
