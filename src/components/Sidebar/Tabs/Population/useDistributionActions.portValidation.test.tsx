/* @vitest-environment jsdom */
// Manual assign/reassign must re-validate PORT eligibility against the live
// roster at write time, the same way audit finding 6 already re-validates
// active+assignable-role (see useDistributionActions.assigneeValidation.test.tsx).
// A restricted employee must never be durably assigned a row outside their
// allowed ports, even from a stale dropdown or a hand-crafted call.
import { describe, it, expect, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";

import { createMemoryDirectory } from "../../../../data/storage/memoryDirectory";
import { saveMonthRun } from "../../../../data/population/populationStorage";
import { saveSampleMaster } from "../../../../data/sampling/sampleStorage";
import { loadOrDeriveDistributionCurrent } from "../../../../data/distribution/distributionStorage";
import type { SampleMasterData } from "../../../../data/sampling/sampleTypes";
import type { EmployeePortRestriction } from "../../../../data/population/populationConfig";
import { useDistributionActions } from "./useDistributionActions";

afterEach(() => cleanup());

const MONTH_FOLDER = "5-may-2026";

function makeSample(portName: string | null): SampleMasterData {
  return {
    drawnAt: new Date().toISOString(),
    drawnBy: "admin",
    rngSeed: "seed",
    portAllocations: [],
    stageAllocations: [],
    totalRequested: 1,
    totalActual: 1,
    certScanRequested: 0,
    nonCertScanRequested: 1,
    certScanActual: 0,
    nonCertScanActual: 1,
    rows: [{ xrayImageId: "A001", portName } as SampleMasterData["rows"][number]],
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
    riskRawRows: [{ id: "A001" }],
    biRawRows: [],
    processedRows: [{ xrayImageId: "A001", certScanStatus: "NonCertscan" }],
    certScanRows: 0,
    nonCertScanRows: 1,
  });
  await saveSampleMaster(dir, MONTH_FOLDER, makeSample("ميناء جدة"));
  return dir;
}

function renderActions(
  dir: ReturnType<typeof createMemoryDirectory>,
  sample: SampleMasterData,
  portRestrictions: EmployeePortRestriction[]
) {
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
      portRestrictions,
    })
  );
}

describe("useDistributionActions manual-assign port validation", () => {
  it("rejects handleAssign to an employee restricted away from the row's port", async () => {
    const dir = await setupWorkspace();
    const sample = makeSample("ميناء جدة");
    const { result } = renderActions(dir, sample, [
      { username: "jalgahamdi", restricted: true, enabledPorts: ["ميناء الدمام"] },
    ]);

    await act(async () => {
      await result.current.handleAssign("A001", "jalgahamdi");
    });

    expect(result.current.distributionMessage?.type).toBe("error");
    const current = await loadOrDeriveDistributionCurrent(dir, MONTH_FOLDER, sample.rows);
    expect(current?.entries ?? []).toHaveLength(0);
  });

  it("accepts handleAssign to an employee eligible for the row's port", async () => {
    const dir = await setupWorkspace();
    const sample = makeSample("ميناء جدة");
    const { result } = renderActions(dir, sample, [
      { username: "jalgahamdi", restricted: true, enabledPorts: ["ميناء جدة"] },
    ]);

    await act(async () => {
      await result.current.handleAssign("A001", "jalgahamdi");
    });

    expect(result.current.distributionMessage?.type).toBe("ok");
    const current = await loadOrDeriveDistributionCurrent(dir, MONTH_FOLDER, sample.rows);
    expect(current?.entries[0]?.assignedTo).toBe("jalgahamdi");
  });

  it("rejects handleReassign to an employee restricted away from the row's port", async () => {
    const dir = await setupWorkspace();
    const sample = makeSample("ميناء جدة");
    const { result } = renderActions(dir, sample, []);

    await act(async () => {
      await result.current.handleAssign("A001", "jalgahamdi");
    });
    expect(result.current.distributionMessage?.type).toBe("ok");

    const { result: restrictedResult } = renderActions(dir, sample, [
      { username: "hihaloraini", restricted: true, enabledPorts: ["ميناء الدمام"] },
    ]);
    await act(async () => {
      await restrictedResult.current.handleReassign("A001", "hihaloraini");
    });
    expect(restrictedResult.current.distributionMessage?.type).toBe("error");

    const current = await loadOrDeriveDistributionCurrent(dir, MONTH_FOLDER, sample.rows);
    expect(current?.entries[0]?.assignedTo).toBe("jalgahamdi");
  });
});
