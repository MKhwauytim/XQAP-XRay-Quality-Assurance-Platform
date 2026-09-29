/* @vitest-environment jsdom */
// Auto-lock must decide from FRESH state, not from the click's locally assembled
// log (pre-append read + own event). If a colleague appends an in-flight
// transition between the click's read and its append, the painted state omits
// it; locking the month on that painted state would close it with a row in flight.
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

import { createMemoryDirectory } from "../../../../data/storage/memoryDirectory";
import type { DirectoryHandleLike, FileHandleLike } from "../../../../data/storage/fileSystemAccess";
import { registerDirectoryPath } from "../../../../data/storage/webLocks";
import { saveMonthRun } from "../../../../data/population/populationStorage";
import { saveSampleMaster } from "../../../../data/sampling/sampleStorage";
import { isMonthClosed } from "../../../../data/population/monthLock";
import {
  appendDistributionEvents,
  flushPendingDistributionPersist,
  flushPendingDistributionProjectionWrites,
} from "../../../../data/distribution/distributionStorage";
import { buildReplacementRequestedEvent } from "../../../../data/distribution/distributionLog";
import type { SampleMasterData } from "../../../../data/sampling/sampleTypes";
import { useDistributionActions } from "./useDistributionActions";

afterEach(async () => {
  await flushPendingDistributionProjectionWrites();
  await flushPendingDistributionPersist();
  cleanup();
});
const M = "5-may-2026";
const sample = (): SampleMasterData =>
  ({
    drawnAt: "2026-05-05T08:00:00.000Z", drawnBy: "admin", rngSeed: "s", portAllocations: [], stageAllocations: [],
    totalRequested: 2, totalActual: 2, certScanRequested: 0, nonCertScanRequested: 2, certScanActual: 0, nonCertScanActual: 2,
    rows: [{ xrayImageId: "A001" }, { xrayImageId: "A002" }],
  }) as unknown as SampleMasterData;

// A share whose FIRST sample.master.json read can be held (the click has already read the log by then).
type Hold = { armed: boolean; reached: Promise<void>; release: () => void };
function holdable(): { dir: DirectoryHandleLike; hold: Hold } {
  let reach!: () => void;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const hold: Hold = { armed: false, reached: new Promise<void>((r) => (reach = r)), release };
  const file = (fh: FileHandleLike): FileHandleLike => {
    const out: FileHandleLike = {
      kind: "file",
      name: fh.name,
      getFile: async () => {
        if (hold.armed && fh.name === "sample.master.json") {
          hold.armed = false;
          reach();
          await gate;
        }
        return fh.getFile();
      },
    };
    if (fh.createWritable) out.createWritable = fh.createWritable.bind(fh);
    return out;
  };
  const wrap = (d: DirectoryHandleLike, path: string): DirectoryHandleLike => {
    const inner = d as DirectoryHandleLike & { values(): AsyncIterable<{ kind: string; name: string }> };
    const out = {
      kind: "directory" as const, name: d.name,
      getFileHandle: async (n: string, o?: { create?: boolean }) => file(await d.getFileHandle(n, o)),
      getDirectoryHandle: async (n: string, o?: { create?: boolean }) => wrap(await d.getDirectoryHandle(n, o), `${path}/${n}`),
      removeEntry: (n: string, o?: { recursive?: boolean }) => d.removeEntry!(n, o),
      queryPermission: d.queryPermission?.bind(d), requestPermission: d.requestPermission?.bind(d),
      values: async function* () {
        for await (const e of inner.values()) {
          yield e.kind === "file" ? file(e as unknown as FileHandleLike) : wrap(e as unknown as DirectoryHandleLike, `${path}/${e.name}`);
        }
      },
    };
    registerDirectoryPath(out as DirectoryHandleLike, path);
    return out as DirectoryHandleLike;
  };
  return { dir: wrap(createMemoryDirectory("root"), "root"), hold };
}

describe("auto-lock decides from fresh state", () => {
  it("does not close the month when a colleague put a completed row back in flight between the click's read and its append", async () => {
    const { dir, hold } = holdable();
    await saveMonthRun({
      directoryHandle: dir, month: 5, year: 2026, username: "admin", riskFileName: "r.xlsx", biFileName: null, certScanUsed: false,
      riskRawRows: [{ id: "A001" }, { id: "A002" }], biRawRows: [],
      processedRows: [{ xrayImageId: "A001", certScanStatus: "NonCertscan" }, { xrayImageId: "A002", certScanStatus: "NonCertscan" }],
      certScanRows: 0, nonCertScanRows: 2,
    });
    await saveSampleMaster(dir, M, sample());
    const { result } = renderHook(() =>
      useDistributionActions({
        directoryHandle: dir, sampleDrawResult: sample(), saveMonth: 5, saveYear: 2026, canDistributeSamples: true,
        canBulkAssign: true, currentUsername: "admin", currentRole: "admin", onDistributionChanged: () => {},
      })
    );
    await act(async () => {
      await result.current.handleAssign("A001", "jalgahamdi");
      await result.current.handleAssign("A002", "jalgahamdi");
      await result.current.handleMarkComplete("A001");
    });
    expect(await isMonthClosed(dir, M)).toBe(false);

    // The click on A002 reads the log, then stalls reading the sample master.
    hold.armed = true;
    let click!: Promise<void>;
    await act(async () => {
      click = result.current.handleMarkComplete("A002");
      await hold.reached;
      // Colleague: A001 (completed) goes back in flight, after the click's read.
      await appendDistributionEvents(dir, M, [
        buildReplacementRequestedEvent({ xrayImageId: "A001", assignedTo: "jalgahamdi", eventBy: "colleague" }),
      ]);
      hold.release();
      await click;
    });
    await flushPendingDistributionProjectionWrites();
    await flushPendingDistributionPersist();
    await new Promise((r) => setTimeout(r, 300)); // let a (wrong) fire-and-forget lock land
    expect(await isMonthClosed(dir, M)).toBe(false);
    await waitFor(() => expect(result.current.distributionMessage?.type).toBe("ok"));
  });
});
