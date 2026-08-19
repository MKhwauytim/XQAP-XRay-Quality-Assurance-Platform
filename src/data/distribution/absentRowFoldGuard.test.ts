import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import { safeReadJson } from "../storage/safeWrite";
import { getSampleMainDir } from "../workspace/workspacePaths";
import { saveSampleMaster } from "../sampling/sampleStorage";
import type { SampleMasterData } from "../sampling/sampleTypes";
import type { PreparedPopulationRow } from "../population/populationTypes";
import { buildAssignEvent, deriveCurrentDistribution } from "./distributionLog";
import {
  __clearDeriveMemoForTests,
  appendDistributionEvents,
  loadDistributionLog,
  loadOrDeriveDistributionCurrent,
  saveDistributionCurrent,
} from "./distributionStorage";
import type { DistributionCurrentData } from "./distributionTypes";

const MONTH = "5-may-2026";

/**
 * Makes the guard's own re-read of `sample.master.json` fail the way a
 * contended/flaky share fails. Faults cannot be injected into a memory
 * directory after construction, and the seed below has to write and read that
 * same file, so the failure is switched on at the module boundary instead.
 */
let masterReadFails = false;

vi.mock("../sampling/sampleStorage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../sampling/sampleStorage")>();
  return {
    ...actual,
    loadSampleMaster: async (
      ...args: Parameters<typeof actual.loadSampleMaster>
    ): ReturnType<typeof actual.loadSampleMaster> => {
      if (masterReadFails) {
        const error = new Error("sample.master.json could not be read");
        error.name = "NotReadableError";
        throw error;
      }
      return actual.loadSampleMaster(...args);
    },
  };
});

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

async function readCachedEntryIds(
  root: ReturnType<typeof createMemoryDirectory>
): Promise<string[] | null> {
  const dir = await getSampleMainDir(root, MONTH, false);
  const read = await safeReadJson<DistributionCurrentData>(dir, "distribution.current.json");
  if (!read.ok) return null;
  return read.value.entries.map((entry) => entry.xrayImageId).sort();
}

/**
 * Seed a month whose sample holds IMG-1 + IMG-2, both assigned, and whose
 * `distribution.current.json` cache is healthy (two entries).
 *
 * The cache is written the way Phase 4's own refresh writes it
 * (`useDistributionActions.refreshDistribution`): a derived snapshot stamped
 * with `logRevision` and nothing else — no `eventSetId`, no fold-checkpoint
 * sidecar. That is what puts the next reader on the FULL refold path (there is
 * no checkpoint to resume from and the eventSetId cannot match), which is the
 * path this guard protects. A cache written by the read path itself carries a
 * checkpoint, and the incremental resume already refuses to advance past an
 * absorbed event.
 */
async function seedHealthyMonth(): Promise<ReturnType<typeof createMemoryDirectory>> {
  const root = createMemoryDirectory("root");
  const rows = [makeRow("IMG-1"), makeRow("IMG-2")];
  const saved = await saveSampleMaster(root, MONTH, makeSample(rows));
  if (!saved.ok) throw new Error("seed sample failed");
  const appended = await appendDistributionEvents(root, MONTH, [
    buildAssignEvent({ xrayImageId: "IMG-1", assignedTo: "emp-1", eventBy: "admin" }),
    buildAssignEvent({ xrayImageId: "IMG-2", assignedTo: "emp-2", eventBy: "admin" }),
  ]);
  if (!appended.ok) throw new Error(`seed assign failed: ${appended.error}`);

  const log = await loadDistributionLog(root, MONTH);
  await saveDistributionCurrent(root, MONTH, {
    ...deriveCurrentDistribution(log, rows),
    logRevision: log.revision,
  });
  expect(await readCachedEntryIds(root)).toEqual(["IMG-1", "IMG-2"]);
  __clearDeriveMemoForTests();
  return root;
}

/**
 * The headline data-loss path. `foldDistributionEvents` ABSORBS every event
 * whose xrayImageId is missing from the row set it is handed — correct for a
 * genuine orphan, catastrophic for a row set that was merely stale or partially
 * read off a flaky share. The absorbing fold used to be written straight to
 * `distribution.current.json` and its fold-checkpoint sidecar, after which every
 * machine trusts the cache and the checkpoint is accepted forever: one bad read
 * of `sample.master.json` silently and permanently deleted assignments from an
 * audit month.
 *
 * The fold itself is untouched — these tests only pin WHICH results may reach
 * disk.
 */
describe("absent-row fold guard (never persist a fold that absorbed events)", () => {
  beforeEach(() => {
    masterReadFails = false;
    __clearDeriveMemoForTests();
  });

  it("self-heals from a stale row set by re-reading sample.master.json", async () => {
    const root = await seedHealthyMonth();

    // A caller whose sample read came back short one row — the SMB-flake shape.
    const stale = [makeRow("IMG-1")];
    const derived = await loadOrDeriveDistributionCurrent(root, MONTH, stale, {
      persistCache: true,
      awaitCachePersist: true,
    });

    // IMG-2's assignment can only be here if the guard went back to the master.
    expect(derived?.entries.map((e) => e.xrayImageId).sort()).toEqual(["IMG-1", "IMG-2"]);
    expect(derived?.entries.find((e) => e.xrayImageId === "IMG-2")?.assignedTo).toBe("emp-2");
    expect(await readCachedEntryIds(root)).toEqual(["IMG-1", "IMG-2"]);
  });

  it("leaves the cache untouched when the master cannot be read to confirm the absorption", async () => {
    const root = await seedHealthyMonth();

    masterReadFails = true;
    const stale = [makeRow("IMG-1")];
    const derived = await loadOrDeriveDistributionCurrent(root, MONTH, stale, {
      persistCache: true,
      awaitCachePersist: true,
    });

    // Served in memory (incomplete, but that is all this read can know) …
    expect(derived).not.toBeNull();
    // … and the previous, complete cache is still on disk untouched.
    expect(await readCachedEntryIds(root)).toEqual(["IMG-1", "IMG-2"]);
  });

  it("still persists when the master agrees the row is genuinely gone", async () => {
    // No self-heal is possible and none is needed: the master says so too, so
    // this read lost nothing and the cache stays as trustworthy as before.
    const root = createMemoryDirectory("root");
    const rows = [makeRow("IMG-1")];
    const saved = await saveSampleMaster(root, MONTH, makeSample(rows));
    if (!saved.ok) throw new Error("seed sample failed");
    const appended = await appendDistributionEvents(root, MONTH, [
      buildAssignEvent({ xrayImageId: "IMG-1", assignedTo: "emp-1", eventBy: "admin" }),
      buildAssignEvent({ xrayImageId: "GHOST-9", assignedTo: "emp-2", eventBy: "admin" }),
    ]);
    if (!appended.ok) throw new Error(`seed assign failed: ${appended.error}`);

    const derived = await loadOrDeriveDistributionCurrent(root, MONTH, rows, {
      persistCache: true,
      awaitCachePersist: true,
    });
    expect(derived?.entries.map((e) => e.xrayImageId)).toEqual(["IMG-1"]);
    expect(await readCachedEntryIds(root)).toEqual(["IMG-1"]);
  });
});
