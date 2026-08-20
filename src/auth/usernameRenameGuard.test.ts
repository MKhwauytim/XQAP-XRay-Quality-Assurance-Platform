// T-11 (2026-08-19): renaming a managed user's username orphans every on-disk
// record keyed on the old string (answers, per-employee mirrors, immutable
// distribution events, quotas, referral/replacement requests, approvals,
// acknowledgements) because nothing migrates them and — the event log being
// append-only — nothing cheaply can. The guard therefore BLOCKS a rename for a
// user with any workspace footprint, and fails CLOSED when the footprint
// cannot be established at all.
import { describe, expect, it } from "vitest";

import { createMemoryDirectory } from "../data/storage/memoryDirectory";
import type { DirectoryHandleLike } from "../data/storage/fileSystemAccess";
import { getPopulationMonthDir, getSampleEmployeeDir } from "../data/workspace/workspacePaths";
import { saveSampleMaster } from "../data/sampling/sampleStorage";
import type { SampleMasterData } from "../data/sampling/sampleTypes";
import type { PreparedPopulationRow } from "../data/population/populationTypes";
import { appendDistributionEvents, loadDistributionLog, saveDistributionCurrent } from "../data/distribution/distributionStorage";
import { buildAssignEvent, deriveCurrentDistribution } from "../data/distribution/distributionLog";
import { invalidateMonthLockCache } from "../data/population/monthLock";
import { checkUsernameRenameBlocked } from "./usernameRenameGuard";

const MONTH = "5-may-2026";
const EMP = "emp1";

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
    drawnAt: new Date().toISOString(),
    drawnBy: "admin",
    rows,
  };
}

async function seedPendingAssignment(root: DirectoryHandleLike): Promise<void> {
  const rows = [makeRow("A1")];
  await getPopulationMonthDir(root, MONTH, true);
  await saveSampleMaster(root, MONTH, makeSample(rows));
  await appendDistributionEvents(root, MONTH, [
    buildAssignEvent({ xrayImageId: "A1", assignedTo: EMP, eventBy: "admin" }),
  ]);
  const log = await loadDistributionLog(root, MONTH);
  await saveDistributionCurrent(root, MONTH, deriveCurrentDistribution(log, rows));
}

function unreadable(): Error {
  const error = new Error("The file could not be read at this time");
  error.name = "NotReadableError";
  return error;
}

/** Fails opening any file whose name matches, as a flaky share does mid-read. */
function failReadingFile(
  root: DirectoryHandleLike,
  match: (name: string) => boolean,
  error: Error
): DirectoryHandleLike {
  const wrap = (dir: DirectoryHandleLike): DirectoryHandleLike =>
    new Proxy(dir, {
      get(target, prop, receiver) {
        if (prop === "getFileHandle") {
          return async (name: string, options?: { create?: boolean }) => {
            if (match(name)) throw error;
            return target.getFileHandle(name, options);
          };
        }
        if (prop === "getDirectoryHandle") {
          return async (name: string, options?: { create?: boolean }) =>
            wrap(await target.getDirectoryHandle(name, options));
        }
        return Reflect.get(target, prop, receiver) as unknown;
      },
    }) as DirectoryHandleLike;
  return wrap(root);
}

describe("checkUsernameRenameBlocked", () => {
  it("blocks a rename for a user who still owns a pending assignment on disk", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    invalidateMonthLockCache();
    await seedPendingAssignment(root);

    expect(await checkUsernameRenameBlocked(root, EMP)).toBe("has-workspace-data");
  });

  it("allows a rename for a user with no footprint anywhere in the workspace", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    invalidateMonthLockCache();
    await seedPendingAssignment(root);

    // Someone else's month/assignment must not block an unrelated user.
    expect(await checkUsernameRenameBlocked(root, "ghost-user")).toBeNull();
  });

  it("fails CLOSED when no workspace is mounted — unverifiable is not 'no work'", async () => {
    expect(await checkUsernameRenameBlocked(null, EMP)).toBe("no-workspace");
  });

  it("fails CLOSED when the footprint scan itself throws (unreadable mirror)", async () => {
    const seeded = createMemoryDirectory("root") as DirectoryHandleLike;
    invalidateMonthLockCache();
    await getPopulationMonthDir(seeded, MONTH, true);
    await getSampleEmployeeDir(seeded, MONTH, true);
    const root = failReadingFile(seeded, (name) => name.endsWith(".samples.json"), unreadable());

    expect(await checkUsernameRenameBlocked(root, EMP)).toBe("unreadable-workspace");
  });
});
