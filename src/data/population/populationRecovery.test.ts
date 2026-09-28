import { beforeEach, describe, expect, test } from "vitest";

import { appendDistributionEvents, __clearDeriveMemoForTests } from "../distribution/distributionStorage";
import { buildAssignEvent } from "../distribution/distributionLog";
import { loadMonthManifest } from "./populationStorage";

import { createMemoryDirectory, setSimulatedFaults } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { listDirectoryEntries } from "../storage/directoryScan";
import { readEnvelopeRevision } from "../storage/safeWrite";
import { saveSampleMaster } from "../sampling/sampleStorage";
import { formatMonthFolderName } from "./monthFolder";
import { invalidateMonthLockCache } from "./monthLock";
import { loadMonthPopulationFinal, saveMonthRun } from "./populationStorage";
import { loadReplacementIndexManifest } from "./replacementIndexStorage";
import { makePopulationRow, makeSampleMaster } from "./populationTestFixtures";
import { PopulationRecoveryScanError, listPopulationRecoveryCandidates, restorePopulationCandidate } from "./populationRecovery";

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
  __clearDeriveMemoForTests();
});

async function liveBytes(root: DirectoryHandleLike, name = "population.final.json"): Promise<string> {
  const dir = await processedDir(root);
  const handle = await dir.getFileHandle(name, { create: false });
  return (await handle.getFile()).text();
}

/** Month whose sample (A1, A2) has work, and whose only archive is a Z1-only population. */
async function seedBlockedMonth(root: DirectoryHandleLike): Promise<void> {
  const first = await saveMonthRun({ directoryHandle: root, ...baseParams, processedRows: rowsFor(["Z1"]) });
  if (!first.ok) throw new Error(first.error);
  const sampled = await saveSampleMaster(root, MONTH, makeSampleMaster([makePopulationRow("A1"), makePopulationRow("A2")]));
  if (!sampled.ok) throw new Error(sampled.error);
  const assigned = await appendDistributionEvents(root, MONTH, [
    buildAssignEvent({ xrayImageId: "A1", assignedTo: "emp1", eventBy: "admin" }),
  ]);
  if (!assigned.ok) throw new Error(assigned.error);
  const second = await saveMonthRun({ directoryHandle: root, ...baseParams, processedRows: rowsFor(["A1", "A2", "A3"]), confirmedOverwrite: true });
  if (!second.ok) throw new Error(second.error);
  __clearDeriveMemoForTests();
}

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

  test("refuses to restore a candidate that lacks a sampled id once the month has work, and writes nothing", async () => {
    const root = createMemoryDirectory("root");
    await seedBlockedMonth(root);
    const candidates = await listPopulationRecoveryCandidates(root, MONTH);
    const archive = candidates.find((c) => c.source === "superseded")!;
    expect(archive.coveredSampledIds).toBe(0);
    expect(archive.wouldBlock).toBe(true);
    const before = await liveBytes(root);
    const manifestBefore = await loadMonthManifest(root, MONTH);

    const result = await restorePopulationCandidate(root, MONTH, archive.fileName, "admin");

    expect(result).toMatchObject({ ok: false, reason: "blocked", missingCount: 2 });
    expect(await liveBytes(root)).toBe(before);
    expect(await loadMonthManifest(root, MONTH)).toEqual(manifestBefore);
  });

  test("refuses when the guard cannot read the month's work (XQ-POP-008)", async () => {
    const root = createMemoryDirectory("root");
    await seedBlockedMonth(root);
    const [archive] = await listPopulationRecoveryCandidates(root, MONTH);
    const before = await liveBytes(root);
    setSimulatedFaults(root, [
      { operation: "readFile", nameSuffix: ".ndjson", errorName: "NotReadableError", times: Number.POSITIVE_INFINITY },
      { operation: "getFile", nameSuffix: ".ndjson", errorName: "NotReadableError", times: Number.POSITIVE_INFINITY },
    ]);

    const result = await restorePopulationCandidate(root, MONTH, archive!.fileName, "admin");
    setSimulatedFaults(root, []);

    expect(result).toMatchObject({ ok: false, reason: "guard-unreadable" });
    expect(await liveBytes(root)).toBe(before);
  });

  test("an archive failure leaves the live file byte-identical", async () => {
    const root = createMemoryDirectory("root");
    await seedOverwrittenMonth(root);
    const [archive] = await listPopulationRecoveryCandidates(root, MONTH);
    const before = await liveBytes(root);
    setSimulatedFaults(root, [
      { operation: "createWritable", nameSuffix: ".superseded.json", errorName: "NoModificationAllowedError", times: Number.POSITIVE_INFINITY },
    ]);

    const result = await restorePopulationCandidate(root, MONTH, archive!.fileName, "admin");
    setSimulatedFaults(root, []);

    expect(result).toMatchObject({ ok: false, reason: "failed" });
    expect(await liveBytes(root)).toBe(before);
  });

  test("keeps the manifest's processed-row total in step with the restored population", async () => {
    const root = createMemoryDirectory("root");
    await seedOverwrittenMonth(root);
    expect((await loadMonthManifest(root, MONTH))?.totalProcessedRows).toBe(1);
    const [archive] = await listPopulationRecoveryCandidates(root, MONTH);

    const result = await restorePopulationCandidate(root, MONTH, archive!.fileName, "admin");

    expect(result.ok).toBe(true);
    const manifest = await loadMonthManifest(root, MONTH);
    expect(manifest?.totalProcessedRows).toBe(3);
    expect(manifest?.processingFingerprint ?? null).toBeNull();
  });

  test("restores from the .bak candidate", async () => {
    const root = createMemoryDirectory("root");
    await seedOverwrittenMonth(root);
    const bak = (await listPopulationRecoveryCandidates(root, MONTH)).find((c) => c.source === "bak")!;

    const result = await restorePopulationCandidate(root, MONTH, bak.fileName, "admin");

    expect(result).toMatchObject({ ok: true, rowCount: 3 });
    const live = await loadMonthPopulationFinal(root, MONTH);
    expect((live?.rows ?? []).map((row) => row["xrayImageId"])).toEqual(["A1", "A2", "A3"]);
  });

  test("restores when there is no live population file to archive", async () => {
    const root = createMemoryDirectory("root");
    await seedOverwrittenMonth(root);
    const [archive] = await listPopulationRecoveryCandidates(root, MONTH);
    const dir = await processedDir(root);
    await dir.removeEntry?.("population.final.json");

    const result = await restorePopulationCandidate(root, MONTH, archive!.fileName, "admin");

    expect(result).toMatchObject({ ok: true, archivedAs: null, rowCount: 3 });
    const live = await loadMonthPopulationFinal(root, MONTH);
    expect((live?.rows ?? []).map((row) => row["xrayImageId"])).toEqual(["A1", "A2", "A3"]);
  }, 60_000);

  test("skips a corrupt candidate in the listing", async () => {
    const root = createMemoryDirectory("root");
    await seedOverwrittenMonth(root);
    const dir = await processedDir(root);
    const handle = await dir.getFileHandle("population.final.9999-01-01T000000.000Z-deadbeef.superseded.json", { create: true });
    const writable = await handle.createWritable?.();
    if (!writable) throw new Error("no writable");
    await writable.write("{ not json");
    await writable.close();

    const candidates = await listPopulationRecoveryCandidates(root, MONTH);

    expect(candidates.map((c) => c.source)).toEqual(["superseded", "bak"]);
    expect(candidates.every((c) => !c.fileName.includes("9999"))).toBe(true);
  });

  test("a failed listing throws a typed error instead of looking like no candidates", async () => {
    const root = createMemoryDirectory("root");
    await seedOverwrittenMonth(root);
    setSimulatedFaults(root, [
      { operation: "getDirectoryHandle", name: "2-processed", errorName: "NotReadableError", times: Number.POSITIVE_INFINITY },
    ]);

    await expect(listPopulationRecoveryCandidates(root, MONTH)).rejects.toBeInstanceOf(PopulationRecoveryScanError);
    setSimulatedFaults(root, []);
  });

  test("a month with no processed folder lists no candidates", async () => {
    const root = createMemoryDirectory("root");
    const first = await saveMonthRun({ directoryHandle: root, ...baseParams, processedRows: rowsFor(["A1"]) });
    expect(first.ok).toBe(true);
    const candidates = await listPopulationRecoveryCandidates(root, MONTH);
    expect(candidates).toEqual([]);
  });
});
