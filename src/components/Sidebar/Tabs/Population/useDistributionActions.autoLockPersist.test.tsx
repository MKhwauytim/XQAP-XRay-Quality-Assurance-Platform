/* @vitest-environment jsdom */
import { describe, it, expect, afterEach } from "vitest";
import { renderHook, act, cleanup, waitFor } from "@testing-library/react";
import { createMemoryDirectory, setSimulatedFaults } from "../../../../data/storage/memoryDirectory";
import { saveMonthRun } from "../../../../data/population/populationStorage";
import { saveSampleMaster } from "../../../../data/sampling/sampleStorage";
import { isMonthClosed } from "../../../../data/population/monthLock";
import { safeReadJson } from "../../../../data/storage/safeWrite";
import { getSampleMainDir } from "../../../../data/workspace/workspacePaths";
import { flushPendingDistributionPersist, flushPendingDistributionProjectionWrites } from "../../../../data/distribution/distributionStorage";
import { loadEmployeeSampleMirror } from "../../../../data/samples/sampleMirrorStorage";
import type { SampleMasterData } from "../../../../data/sampling/sampleTypes";
import { useDistributionActions } from "../../../../components/Sidebar/Tabs/Population/useDistributionActions";

afterEach(() => cleanup());
const M = "5-may-2026";
const sample = (): SampleMasterData => ({ drawnAt: "2026-05-05T08:00:00.000Z", drawnBy: "admin", rngSeed: "s", portAllocations: [], stageAllocations: [],
  totalRequested: 2, totalActual: 2, certScanRequested: 0, nonCertScanRequested: 2, certScanActual: 0, nonCertScanActual: 2,
  rows: [{ xrayImageId: "A001" } as SampleMasterData["rows"][number], { xrayImageId: "A002" } as SampleMasterData["rows"][number]] });

describe("auto-lock vs the background persist", () => {
  it("the last completion reaches distribution.current.json and the mirror even though it auto-locks the month", async () => {
    const dir = createMemoryDirectory();
    await saveMonthRun({ directoryHandle: dir, month: 5, year: 2026, username: "admin", riskFileName: "r.xlsx", biFileName: null, certScanUsed: false,
      riskRawRows: [{ id: "A001" }, { id: "A002" }], biRawRows: [],
      processedRows: [{ xrayImageId: "A001", certScanStatus: "NonCertscan" }, { xrayImageId: "A002", certScanStatus: "NonCertscan" }],
      certScanRows: 0, nonCertScanRows: 2 });
    await saveSampleMaster(dir, M, sample());
    const { result } = renderHook(() => useDistributionActions({ directoryHandle: dir, sampleDrawResult: sample(), saveMonth: 5, saveYear: 2026,
      canDistributeSamples: true, canBulkAssign: true, currentUsername: "admin", currentRole: "admin", onDistributionChanged: () => {} }));
    await act(async () => { await result.current.handleAssign("A001", "jalgahamdi"); await result.current.handleAssign("A002", "jalgahamdi"); });
    await act(async () => { await result.current.handleMarkComplete("A001"); });
    // Slow share: the projection's compat-log write needs two retries (transient).
    setSimulatedFaults(dir, [{ operation: "createWritable", name: "distribution.log.json", times: 2, errorName: "NoModificationAllowedError" }]);
    await act(async () => { await result.current.handleMarkComplete("A002"); });
    await waitFor(async () => { expect(await isMonthClosed(dir, M)).toBe(true); });
    await flushPendingDistributionProjectionWrites();
    await flushPendingDistributionPersist();
    const main = await getSampleMainDir(dir, M, false);
    const cur = await safeReadJson<{ entries: Array<{ xrayImageId: string; status: string }> }>(main, "distribution.current.json");
    const statuses = cur.ok ? cur.value.entries.map((e) => e.xrayImageId + ":" + e.status).sort() : ["<no cache>"];
    const mirror = await loadEmployeeSampleMirror(dir, M, "jalgahamdi");
    const mstat = (mirror?.entries ?? []).map((e) => e.xrayImageId + ":" + e.status).sort();
    expect({ statuses, mstat }).toEqual({ statuses: ["A001:completed", "A002:completed"], mstat: ["A001:completed", "A002:completed"] });
  });
});
