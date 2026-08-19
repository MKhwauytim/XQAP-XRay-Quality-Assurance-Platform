/* @vitest-environment jsdom */
// The write-path cache stamp (2026-08-19, batch 3 item 14).
//
// `refreshDistribution` persists `distribution.current.json` after every
// distribution write. Until now it stamped `logRevision` only, so the reader's
// acceptance check (deriveVersion + eventSetId + logRevision + row fingerprint)
// rejected it every single time and paid a full refold immediately after the
// most expensive write in the app. It now stamps the complete set, which is
// safe precisely because acceptance is a four-field match and the cache remains
// an optimization with refold self-healing.
//
// This exercises the real hook, not a hand-built snapshot: the assertions are
// about what actually lands on disk and whether the real reader takes it.
import { describe, it, expect, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";

import { createMemoryDirectory } from "../../../../data/storage/memoryDirectory";
import { saveMonthRun } from "../../../../data/population/populationStorage";
import { loadSampleMaster, saveSampleMaster } from "../../../../data/sampling/sampleStorage";
import {
  __clearDeriveMemoForTests,
  loadDistributionLog,
  loadOrDeriveDistributionCurrent,
} from "../../../../data/distribution/distributionStorage";
import {
  DERIVE_VERSION,
  sampleRowsFingerprint,
} from "../../../../data/distribution/distributionLog";
import type { DistributionCurrentData } from "../../../../data/distribution/distributionTypes";
import { getSampleMainDir } from "../../../../data/workspace/workspacePaths";
import { safeReadJson, safeWriteJson } from "../../../../data/storage/safeWrite";
import { formatMonthFolderName } from "../../../../data/population/monthFolder";
import type { SampleMasterData } from "../../../../data/sampling/sampleTypes";
import { useDistributionActions } from "./useDistributionActions";

afterEach(() => cleanup());

const MONTH_FOLDER = formatMonthFolderName(5, 2026);
const CURRENT_FILE = "distribution.current.json";

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
  return renderHook(() =>
    useDistributionActions({
      directoryHandle: dir,
      sampleDrawResult: makeSample(),
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

async function readCache(dir: ReturnType<typeof createMemoryDirectory>): Promise<DistributionCurrentData> {
  const mainDir = await getSampleMainDir(dir, MONTH_FOLDER, true);
  const result = await safeReadJson<DistributionCurrentData>(mainDir, CURRENT_FILE);
  if (!result.ok) throw new Error("distribution.current.json was not written");
  return result.value;
}

describe("useDistributionActions write-path cache stamp", () => {
  it("persists a cache carrying all four validity fields", async () => {
    const dir = await setupWorkspace();
    const { result } = renderActions(dir);

    await act(async () => {
      await result.current.handleAssign("A001", "hihaloraini");
    });

    const cache = await readCache(dir);
    const log = await loadDistributionLog(dir, MONTH_FOLDER);
    const master = await loadSampleMaster(dir, MONTH_FOLDER);

    expect(cache.logRevision).toBe(log.revision);
    expect(cache.eventSetId).toBe(log.eventSetId);
    expect(cache.deriveVersion).toBe(DERIVE_VERSION);
    expect(cache.sampleRowsFingerprint).toBe(sampleRowsFingerprint(master!.rows));
  });

  it("writes a cache the reader accepts on its fast path instead of refolding", async () => {
    const dir = await setupWorkspace();
    const { result } = renderActions(dir);

    await act(async () => {
      await result.current.handleAssign("A001", "hihaloraini");
    });

    // Marker no fold could produce: if the reader returns it, the snapshot came
    // off disk rather than from a fresh derivation.
    const mainDir = await getSampleMainDir(dir, MONTH_FOLDER, true);
    await safeWriteJson(mainDir, CURRENT_FILE, { ...(await readCache(dir)), totalPending: 999 });
    __clearDeriveMemoForTests();

    const master = await loadSampleMaster(dir, MONTH_FOLDER);
    const loaded = await loadOrDeriveDistributionCurrent(dir, MONTH_FOLDER, master!.rows, {
      persistCache: false,
    });
    expect(loaded?.totalPending).toBe(999);
  });

  it("does not let that cache be served for a different row set", async () => {
    // The stamp is only safe because acceptance still checks the row set: a
    // replacement appends a row to sample.master.json without appending an
    // event, so logRevision and eventSetId alone cannot see the change.
    const dir = await setupWorkspace();
    const { result } = renderActions(dir);

    await act(async () => {
      await result.current.handleAssign("A001", "hihaloraini");
    });

    const mainDir = await getSampleMainDir(dir, MONTH_FOLDER, true);
    await safeWriteJson(mainDir, CURRENT_FILE, { ...(await readCache(dir)), totalPending: 999 });
    __clearDeriveMemoForTests();

    const master = await loadSampleMaster(dir, MONTH_FOLDER);
    const loaded = await loadOrDeriveDistributionCurrent(
      dir,
      MONTH_FOLDER,
      [...master!.rows].reverse(),
      { persistCache: false }
    );
    expect(loaded?.totalPending).toBe(1);
  });
});
