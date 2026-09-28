import { beforeEach, describe, expect, test } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { listDirectoryEntries } from "../storage/directoryScan";
import { readEnvelopeRevision } from "../storage/safeWrite";
import { saveSampleMaster } from "../sampling/sampleStorage";
import { formatMonthFolderName } from "./monthFolder";
import { invalidateMonthLockCache } from "./monthLock";
import { loadMonthPopulationFinal, saveMonthRun } from "./populationStorage";
import { loadReplacementIndexManifest } from "./replacementIndexStorage";
import { makePopulationRow, makeSampleMaster } from "./populationTestFixtures";
import { listPopulationRecoveryCandidates, restorePopulationCandidate } from "./populationRecovery";

const MONTH = formatMonthFolderName(5, 2026);

const baseParams = {
  month: 5,
  year: 2026,
  username: "admin",
  riskFileName: "risk.xlsx",
  biFileName: null,
  certScanUsed: false,
  riskRawRows: [{ id: "raw-1" }],
  biRawRows: [],
  certScanRows: 0,
  nonCertScanRows: 1,
};

function rowsFor(ids: string[]): Array<Record<string, unknown>> {
  return ids.map((id) => makePopulationRow(id) as unknown as Record<string, unknown>);
}

async function processedDir(root: DirectoryHandleLike): Promise<DirectoryHandleLike> {
  const population = await root.getDirectoryHandle("1-population", { create: false });
  const month = await population.getDirectoryHandle(MONTH, { create: false });
  return month.getDirectoryHandle("2-processed", { create: false });
}

/** Month with sample A1+A2, whose population was then overwritten by a Z1-only one. */
async function seedOverwrittenMonth(root: DirectoryHandleLike): Promise<void> {
  const first = await saveMonthRun({ directoryHandle: root, ...baseParams, processedRows: rowsFor(["A1", "A2", "A3"]) });
  if (!first.ok) throw new Error(first.error);
  const sampled = await saveSampleMaster(root, MONTH, makeSampleMaster([makePopulationRow("A1"), makePopulationRow("A2")]));
  if (!sampled.ok) throw new Error(sampled.error);
  const second = await saveMonthRun({ directoryHandle: root, ...baseParams, processedRows: rowsFor(["Z1"]), confirmedOverwrite: true });
  if (!second.ok) throw new Error(second.error);
}

beforeEach(() => {
  invalidateMonthLockCache();
});

describe("population recovery (A2)", () => {
  test("lists the superseded archive and the .bak with their sampled-id coverage", async () => {
    const root = createMemoryDirectory("root");
    await seedOverwrittenMonth(root);

    const candidates = await listPopulationRecoveryCandidates(root, MONTH);

    expect(candidates.map((c) => c.source)).toEqual(["superseded", "bak"]);
    expect(candidates[0]!.fileName).toMatch(/^population\.final\..+\.superseded\.json$/);
    for (const candidate of candidates) {
      expect(candidate.rowCount).toBe(3);
      expect(candidate.coveredSampledIds).toBe(2);
      expect(candidate.totalSampledIds).toBe(2);
    }
  });

  test("restores the chosen candidate, archives the current file, and rebuilds the replacement index", async () => {
    const root = createMemoryDirectory("root");
    await seedOverwrittenMonth(root);
    const [archive] = await listPopulationRecoveryCandidates(root, MONTH);

    const result = await restorePopulationCandidate(root, MONTH, archive!.fileName, "admin");

    expect(result).toMatchObject({ ok: true, rowCount: 3 });
    const live = await loadMonthPopulationFinal(root, MONTH);
    expect((live?.rows ?? []).map((row) => row["xrayImageId"])).toEqual(["A1", "A2", "A3"]);

    const dir = await processedDir(root);
    const archives = (await listDirectoryEntries(dir))
      .map((entry) => entry.name)
      .filter((name) => /^population\.final\..+\.superseded\.json$/.test(name));
    expect(archives).toHaveLength(2);

    const revision = await readEnvelopeRevision(dir, "population.final.json");
    const manifest = await loadReplacementIndexManifest(root, MONTH);
    expect(manifest?.sourceRevision).toBe(revision);
  });

  test("refuses a file name that is not a recovery candidate", async () => {
    const root = createMemoryDirectory("root");
    await seedOverwrittenMonth(root);

    const result = await restorePopulationCandidate(root, MONTH, "processing.summary.json", "admin");

    expect(result).toEqual({ ok: false, reason: "invalid-candidate" });
    const live = await loadMonthPopulationFinal(root, MONTH);
    expect((live?.rows ?? []).map((row) => row["xrayImageId"])).toEqual(["Z1"]);
  });
});
