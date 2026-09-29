import { describe, expect, it } from "vitest";

import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { invalidateMonthLockCache } from "../population/monthLock";
import { loadPopulationAggregate } from "../population/populationAggregate";
import { loadReplacementIndexManifest } from "../population/replacementIndexStorage";
import type { RestoreScope } from "./restoreScope";
import { formatMonthFolderShortLabel } from "../population/monthFolder";
import { runSelectiveRestore } from "./selectiveRestore";
import {
  backupFolderNames,
  listNames,
  M1,
  makeRoot,
  openDir,
  readJsonAt,
  seedBackup,
  TEST_BACKUP,
  writeJsonAt,
} from "./selectiveRestoreTestKit";

const POP_M1 = `1-population/${M1}/2-processed/population.final.json`;
const PROCESSED_M1 = `1-population/${M1}/2-processed`;
const MANIFEST_M1 = `1-population/${M1}/month.manifest.json`;

function run(root: DirectoryHandleLike, scope: RestoreScope) {
  return runSelectiveRestore({ directoryHandle: root, months: [], backupFolderName: TEST_BACKUP, username: "admin", scope });
}

function row(id: string): Record<string, unknown> {
  return { xrayImageId: id, certScanStatus: "NonCertscan", stage: "المرحلة الأولى", portName: "ميناء" };
}

function failWritesOf(real: DirectoryHandleLike, fileName: string): DirectoryHandleLike {
  return {
    ...real,
    getFileHandle: async (name: string, options?: { create?: boolean }) => {
      if (options?.create && name.startsWith(fileName)) throw new Error(`Simulated write failure for ${name}`);
      return real.getFileHandle(name, options);
    },
    getDirectoryHandle: async (name: string, options?: { create?: boolean }) =>
      failWritesOf(await real.getDirectoryHandle(name, options), fileName),
  };
}

describe("runSelectiveRestore — closed months (every month-scoped element)", () => {
  const cases: Array<[string, RestoreScope, string]> = [
    ["population", { elements: ["population"], months: [M1] }, POP_M1],
    ["sampleDistribution", { elements: ["sampleDistribution"], months: [M1] }, `2-samples/${M1}/1-main/sample.master.json`],
    ["answers", { elements: ["answers"], months: [M1] }, `2-samples/${M1}/2-employees/e1.answers.json`],
    ["referralsApprovals", { elements: ["referralsApprovals"], months: [M1] }, `2-samples/${M1}/2-employees/e1.requests.json`],
  ];

  it.each(cases)("refuses %s for a closed month and writes nothing", async (_name, scope, path) => {
    const root = makeRoot();
    await writeJsonAt(root, MANIFEST_M1, { monthFolderName: M1, status: "closed" });
    await writeJsonAt(root, path, { source: "live", rows: [], items: [] });
    await seedBackup(root, { [path]: { source: "backup", rows: [], items: [] } });
    invalidateMonthLockCache(M1);

    const outcome = await run(root, scope);

    expect(outcome.ok).toBe(false);
    if (outcome.ok || outcome.reason !== "restore-failed") throw new Error("expected restore-failed");
    expect(outcome.error).toContain(formatMonthFolderShortLabel(M1));
    expect(await backupFolderNames(root)).toEqual([TEST_BACKUP]);
    expect((await readJsonAt<{ source: string }>(root, path))?.source).toBe("live");
  });

  it("checks every selected month before touching any", async () => {
    const root = makeRoot();
    const M2 = "6-june-2026";
    await writeJsonAt(root, `1-population/${M2}/month.manifest.json`, { monthFolderName: M2, status: "closed" });
    await writeJsonAt(root, POP_M1, { source: "live", rows: [row("A")] });
    await seedBackup(root, {
      [POP_M1]: { source: "backup", rows: [row("A")] },
      [`1-population/${M2}/2-processed/population.final.json`]: { rows: [] },
    });
    invalidateMonthLockCache(M1);
    invalidateMonthLockCache(M2);

    const outcome = await run(root, { elements: ["population"], months: [M1, M2] });

    expect(outcome.ok).toBe(false);
    const processed = await openDir(root, ["1-population", M1, "2-processed"]);
    expect((await listNames(processed!)).filter((name) => name.includes("superseded"))).toEqual([]);
    expect((await readJsonAt<{ source: string }>(root, POP_M1))?.source).toBe("live");
  });
});

describe("runSelectiveRestore — the month manifest", () => {
  it("syncs source fields but never restores status, closure, revision or rngSeed", async () => {
    const root = makeRoot();
    await writeJsonAt(root, MANIFEST_M1, {
      monthFolderName: M1,
      status: "distributed",
      rngSeed: "live-seed",
      totalRawRows: 1,
      totalProcessedRows: 1,
      processedAt: "2026-06-01T00:00:00.000Z",
      processingFingerprint: "live-fp",
    });
    await writeJsonAt(root, POP_M1, { rows: [row("A")] });
    await seedBackup(root, {
      [POP_M1]: { rows: [row("A"), row("B")] },
      [MANIFEST_M1]: {
        monthFolderName: M1,
        status: "closed",
        statusBeforeClose: "processed-saved",
        closedAt: "2026-05-30T00:00:00.000Z",
        closedBy: "someone",
        rngSeed: "backup-seed",
        totalRawRows: 9,
        totalProcessedRows: 2,
        processedAt: "2026-05-01T00:00:00.000Z",
        processingFingerprint: "backup-fp",
        riskFileName: "risk-backup.xlsx",
      },
    });
    invalidateMonthLockCache(M1);

    const outcome = await run(root, { elements: ["population"], months: [M1] });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.restoredFiles).not.toContain(MANIFEST_M1);
    const live = await readJsonAt<Record<string, unknown>>(root, MANIFEST_M1);
    expect(live?.status).toBe("distributed");
    expect(live?.closedAt).toBeUndefined();
    expect(live?.statusBeforeClose).toBeUndefined();
    expect(live?.rngSeed).toBe("live-seed");
    expect(live?.totalProcessedRows).toBe(2);
    expect(live?.totalRawRows).toBe(9);
    expect(live?.processedAt).toBe("2026-05-01T00:00:00.000Z");
    expect(live?.processingFingerprint).toBe("backup-fp");
    expect(live?.riskFileName).toBe("risk-backup.xlsx");
  });
});

describe("runSelectiveRestore — derived rebuild failures are reported, not silent", () => {
  it("returns a derivedWarnings entry when the replacement index could not be rebuilt", async () => {
    const root = makeRoot();
    // Readable but malformed: no `rows`, so the rebuild has nothing to index.
    await seedBackup(root, { [POP_M1]: { noRows: true } });

    const outcome = await run(root, { elements: ["population"], months: [M1] });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.derivedWarnings.some((warning) => warning.month === M1 && warning.step === "replacement-index")).toBe(true);
  });

  it("has no warnings when everything rebuilt", async () => {
    const root = makeRoot();
    await seedBackup(root, { [POP_M1]: { rows: [row("A")] } });

    const outcome = await run(root, { elements: ["population"], months: [M1] });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.derivedWarnings).toEqual([]);
  });
});

describe("runSelectiveRestore — failure after the engine started", () => {
  it("still discards the stale aggregate and index and names the rollback folder", async () => {
    const root = makeRoot();
    await writeJsonAt(root, `${PROCESSED_M1}/replacement-index/index.manifest.json`, {
      formatVersion: 1, monthFolderName: M1, sourceRevision: 9, stageMappingsHash: "x", builtAt: "x", builtBy: "x", totalIndexedRows: 0, buckets: [],
    });
    await writeJsonAt(root, `${PROCESSED_M1}/population.aggregate.json`, {
      schemaVersion: 1, monthFolderName: M1, computedAt: "x", computedBy: "x", summary: {}, previewRows: [],
    });
    await seedBackup(root, { [POP_M1]: { rows: [row("A")] } });

    const outcome = await runSelectiveRestore({
      directoryHandle: failWritesOf(root, "population.final.json"),
      months: [],
      backupFolderName: TEST_BACKUP,
      username: "admin",
      scope: { elements: ["population"], months: [M1] },
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok || outcome.reason !== "restore-failed") throw new Error("expected restore-failed");
    expect(outcome.rollbackFolderName).toContain("pre-restore");
    expect(await loadReplacementIndexManifest(root, M1)).toBeNull();
    expect((await loadPopulationAggregate(root, M1)).status).toBe("missing");
  });
});

describe("runSelectiveRestore — population archive is only for months the backup replaces", () => {
  it("does not archive the live population when the backup holds no population.final.json for the month", async () => {
    const root = makeRoot();
    await writeJsonAt(root, POP_M1, { source: "live", rows: [row("A")] });
    await seedBackup(root, { [`1-population/${M1}/1-raw/risk.raw.json`]: { rows: [] } });

    const outcome = await run(root, { elements: ["population"], months: [M1] });

    expect(outcome.ok).toBe(true);
    const processed = await openDir(root, ["1-population", M1, "2-processed"]);
    expect((await listNames(processed!)).filter((name) => name.includes("superseded"))).toEqual([]);
  });
});

/** Reads of `fileName` INSIDE the seeded backup folder fail like an unreadable share. */
function unreadableInBackups(real: DirectoryHandleLike, fileName: string, inBackups = false): DirectoryHandleLike {
  return {
    ...real,
    getFileHandle: async (name: string, options?: { create?: boolean }) => {
      if (inBackups && !options?.create && name === fileName) {
        throw Object.assign(new Error("access denied"), { name: "SecurityError" });
      }
      return real.getFileHandle(name, options);
    },
    getDirectoryHandle: async (name: string, options?: { create?: boolean }) =>
      unreadableInBackups(await real.getDirectoryHandle(name, options), fileName, inBackups || name === TEST_BACKUP),
  };
}

describe("runSelectiveRestore — the backup manifest cannot be read after the restore landed", () => {
  it("reports a manifest warning, still discards stale derived files, and does not reject", async () => {
    const root = makeRoot();
    await writeJsonAt(root, `${PROCESSED_M1}/population.aggregate.json`, {
      schemaVersion: 1, monthFolderName: M1, computedAt: "x", computedBy: "stale", summary: {}, previewRows: [],
    });
    await writeJsonAt(root, MANIFEST_M1, { monthFolderName: M1, status: "distributed", processingFingerprint: "live-fp" });
    await seedBackup(root, { [POP_M1]: { rows: [row("A")] }, [MANIFEST_M1]: { monthFolderName: M1, status: "closed" } });

    const outcome = await runSelectiveRestore({
      directoryHandle: unreadableInBackups(root, "month.manifest.json"),
      months: [],
      backupFolderName: TEST_BACKUP,
      username: "admin",
      scope: { elements: ["population"], months: [M1] },
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.derivedWarnings.some((warning) => warning.step === "manifest")).toBe(true);
    expect((await loadPopulationAggregate(root, M1)).status).toBe("missing");
    expect((await readJsonAt<Record<string, unknown>>(root, MANIFEST_M1))?.processingFingerprint).toBe("live-fp");
  });
});

describe("runSelectiveRestore — a month with no live manifest", () => {
  it("writes the backup's manifest when the live month has none (nothing to regress)", async () => {
    const root = makeRoot();
    await seedBackup(root, {
      [POP_M1]: { rows: [row("A")] },
      [MANIFEST_M1]: { monthFolderName: M1, status: "sampled", rngSeed: "backup-seed", totalRawRows: 5, totalProcessedRows: 1 },
    });

    const outcome = await run(root, { elements: ["population"], months: [M1] });

    expect(outcome.ok).toBe(true);
    const live = await readJsonAt<Record<string, unknown>>(root, MANIFEST_M1);
    expect(live?.status).toBe("sampled");
    expect(live?.rngSeed).toBe("backup-seed");
    expect(live?.totalRawRows).toBe(5);
    expect(live?.totalProcessedRows).toBe(1);
  });
});

describe("runSelectiveRestore — manifest sync only where the population file came back", () => {
  it("leaves the live manifest alone when only raw files were restored", async () => {
    const root = makeRoot();
    await writeJsonAt(root, MANIFEST_M1, {
      monthFolderName: M1, status: "distributed", processedAt: "2026-06-01T00:00:00.000Z", processingFingerprint: "live-fp",
    });
    await writeJsonAt(root, POP_M1, { rows: [row("A")] });
    await seedBackup(root, {
      [`1-population/${M1}/1-raw/risk.raw.json`]: { rows: [] },
      [MANIFEST_M1]: { monthFolderName: M1, processedAt: "2026-05-01T00:00:00.000Z", processingFingerprint: "backup-fp" },
    });
    invalidateMonthLockCache(M1);

    const outcome = await run(root, { elements: ["population"], months: [M1] });

    expect(outcome.ok).toBe(true);
    const live = await readJsonAt<Record<string, unknown>>(root, MANIFEST_M1);
    expect(live?.processedAt).toBe("2026-06-01T00:00:00.000Z");
    expect(live?.processingFingerprint).toBe("live-fp");
  });
});

describe("runSelectiveRestore — aggregate verification", () => {
  it("warns when the aggregate of a month with a processing summary could not be rebuilt", async () => {
    const root = makeRoot();
    await seedBackup(root, {
      [POP_M1]: { rows: [row("A")] },
      [`${PROCESSED_M1}/processing.summary.json`]: {
        summary: { totalRows: 1 }, removedRows: [], duplicateRows: [], invalidResultRows: [], savedAt: "2026-05-31T10:00:00.000Z",
      },
    });

    const outcome = await runSelectiveRestore({
      directoryHandle: failWritesOf(root, "population.aggregate.json"),
      months: [],
      backupFolderName: TEST_BACKUP,
      username: "admin",
      scope: { elements: ["population"], months: [M1] },
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.derivedWarnings.some((warning) => warning.step === "aggregate")).toBe(true);
  });
});

/** After the walk started (population.final.json created), the first reads of the manifest miss like a flaky share. */
function transientManifestMisses(real: DirectoryHandleLike, state: { armed: boolean; misses: number }, inBackups = false): DirectoryHandleLike {
  return {
    ...real,
    getFileHandle: async (name: string, options?: { create?: boolean }) => {
      if (!inBackups && options?.create && name === "population.final.json") state.armed = true;
      if (!inBackups && state.armed && !options?.create && name.startsWith("month.manifest.json") && state.misses < 3) {
        state.misses += 1;
        throw Object.assign(new Error("transient"), { name: "NotFoundError" });
      }
      return real.getFileHandle(name, options);
    },
    getDirectoryHandle: async (name: string, options?: { create?: boolean }) =>
      transientManifestMisses(await real.getDirectoryHandle(name, options), state, inBackups || name === "backups"),
  } as DirectoryHandleLike;
}

describe("runSelectiveRestore — an existing live manifest that reads as missing", () => {
  it("never overwrites the live status and seed with the backup's after transient NotFound reads", async () => {
    const root = makeRoot();
    await writeJsonAt(root, MANIFEST_M1, { monthFolderName: M1, status: "processed-saved", rngSeed: "live-seed" });
    await writeJsonAt(root, MANIFEST_M1, { monthFolderName: M1, status: "distributed", rngSeed: "live-seed" });
    await writeJsonAt(root, POP_M1, { rows: [row("A")] });
    await seedBackup(root, {
      [POP_M1]: { rows: [row("A")] },
      [MANIFEST_M1]: { monthFolderName: M1, status: "imported", rngSeed: "backup-seed" },
    });
    invalidateMonthLockCache(M1);

    const outcome = await runSelectiveRestore({
      directoryHandle: transientManifestMisses(root, { armed: false, misses: 0 }),
      months: [],
      backupFolderName: TEST_BACKUP,
      username: "admin",
      scope: { elements: ["population"], months: [M1] },
    });

    expect(outcome.ok).toBe(true);
    const live = await readJsonAt<Record<string, unknown>>(root, MANIFEST_M1);
    expect(live?.status).toBe("distributed");
    expect(live?.rngSeed).toBe("live-seed");
  });
});

describe("runSelectiveRestore — replacement index revision check", () => {
  it("warns when a stale index of a NEWER revision survives because its discard failed", async () => {
    const root = makeRoot();
    await writeJsonAt(root, `${PROCESSED_M1}/replacement-index/index.manifest.json`, {
      formatVersion: 1, monthFolderName: M1, sourceRevision: 999, stageMappingsHash: "x", builtAt: "x", builtBy: "x", totalIndexedRows: 0, buckets: [],
    });
    await seedBackup(root, { [POP_M1]: { rows: [row("A")] } });
    const failRemoval = (real: DirectoryHandleLike): DirectoryHandleLike =>
      ({
        ...real,
        removeEntry: async (name: string, options?: { recursive?: boolean }) => {
          if (name.startsWith("index.manifest.json")) throw new Error("locked");
          return real.removeEntry?.(name, options);
        },
        getDirectoryHandle: async (name: string, options?: { create?: boolean }) =>
          failRemoval(await real.getDirectoryHandle(name, options)),
      }) as DirectoryHandleLike;

    const outcome = await runSelectiveRestore({
      directoryHandle: failRemoval(root),
      months: [],
      backupFolderName: TEST_BACKUP,
      username: "admin",
      scope: { elements: ["population"], months: [M1] },
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.derivedWarnings.some((warning) => warning.step === "replacement-index")).toBe(true);
  });
});
