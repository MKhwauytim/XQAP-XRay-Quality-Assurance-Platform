/* @vitest-environment jsdom */
// Audit finding 6: handleAssign/handleReassign used to accept ANY string as the
// assignee, with no check that the account exists, is active, or is even an
// employee/supervisor (the only roles that can log in and work a review). This
// mirrors the identical fix in adhocImportAssignment.test.ts's "audit finding 6"
// coverage, applied to the real Population/Distribution manual-assign path
// (PhaseFourDistribution's DistributionRow -> handleAssign/handleReassign).
import { describe, it, expect, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";

import { createMemoryDirectory } from "../../../../data/storage/memoryDirectory";
import { saveMonthRun } from "../../../../data/population/populationStorage";
import { saveSampleMaster } from "../../../../data/sampling/sampleStorage";
import { loadOrDeriveDistributionCurrent } from "../../../../data/distribution/distributionStorage";
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
    totalRequested: 1,
    totalActual: 1,
    certScanRequested: 0,
    nonCertScanRequested: 1,
    certScanActual: 0,
    nonCertScanActual: 1,
    rows: [{ xrayImageId: "A001" } as SampleMasterData["rows"][number]],
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

describe("useDistributionActions manual-assign assignee validation (audit finding 6)", () => {
  it("rejects handleAssign to a username that does not exist in the managed roster", async () => {
    const dir = await setupWorkspace();
    const { result } = renderActions(dir);

    await act(async () => {
      await result.current.handleAssign("A001", "no-such-user");
    });

    expect(result.current.distributionMessage?.type).toBe("error");
    const current = await loadOrDeriveDistributionCurrent(dir, MONTH_FOLDER, makeSample().rows);
    expect(current?.entries ?? []).toHaveLength(0);
  });

  it("rejects handleAssign to a manager username (not an assignable sample role)", async () => {
    const dir = await setupWorkspace();
    const { result } = renderActions(dir);

    // "amonem" is a default manager account -- present in the roster, but
    // cannot log in to work a sample review.
    await act(async () => {
      await result.current.handleAssign("A001", "amonem");
    });

    expect(result.current.distributionMessage?.type).toBe("error");
    const current = await loadOrDeriveDistributionCurrent(dir, MONTH_FOLDER, makeSample().rows);
    expect(current?.entries ?? []).toHaveLength(0);
  });

  it("accepts handleAssign to a real active employee, then rejects handleReassign to an invalid username", async () => {
    const dir = await setupWorkspace();
    const { result } = renderActions(dir);

    await act(async () => {
      await result.current.handleAssign("A001", "jalgahamdi");
    });
    expect(result.current.distributionMessage?.type).toBe("ok");

    await act(async () => {
      await result.current.handleReassign("A001", "no-such-user");
    });
    expect(result.current.distributionMessage?.type).toBe("error");

    const current = await loadOrDeriveDistributionCurrent(dir, MONTH_FOLDER, makeSample().rows);
    // The row stays with its original valid assignee -- the invalid reassign
    // must never have been durably written.
    expect(current?.entries[0]?.assignedTo).toBe("jalgahamdi");
  });
});
