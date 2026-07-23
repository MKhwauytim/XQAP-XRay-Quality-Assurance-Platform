import { describe, expect, it } from "vitest";

import { createMemoryDirectory, setSimulatedWritePermission } from "../storage/memoryDirectory";
import type { DirectoryHandleLike, FileHandleLike } from "../storage/fileSystemAccess";
import { safeWriteJson } from "../storage/safeWrite";
import { WorkspacePermissionError } from "../storage/workspaceWriteAccess";
import { getSystemRoot, getUserDataRoot } from "../workspace/workspacePaths";
import { WORKSPACE_FILE_NAMES } from "../workspace/workspaceDefaults";
import type { MonthManifestData } from "../population/monthTypes";
import {
  assertXlsxDatasetWithinLimit,
  createBackup,
  createDailyAdminBackupIfDue,
  loadArchiveStatus,
  loadBackupHistory,
  restoreBackupSnapshot,
  XLSX_MAX_ROWS_PER_DATASET,
} from "./backupStorage";

function makeRoot(): DirectoryHandleLike {
  return createMemoryDirectory("root") as DirectoryHandleLike;
}

describe("createBackup — Tier-1 Item F coverage", () => {
  it("includes seeded 3-user-data/ files (users.permissions.json + labels snapshot) in jsonFilesBackedUp", async () => {
    const root = makeRoot();
    const userDataDir = await getUserDataRoot(root, true);
    await safeWriteJson(userDataDir, WORKSPACE_FILE_NAMES.usersPermissions, {
      metadata: {
        schemaVersion: "1",
        fileType: "users.permissions",
        revision: 1,
        createdAt: new Date().toISOString(),
        createdBy: "admin",
        updatedAt: new Date().toISOString(),
        updatedBy: "admin",
        contentHash: "",
      },
      data: { users: [], roles: [], permissions: [], featurePermissions: [] },
    });

    const result = await createBackup(root, [], "admin", "manual");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // users.permissions.json (seeded) and labels.snapshot.json (written by
    // createBackup's exportLabelsSnapshot call) must both be captured. Entries
    // are recorded with their source-relative path (e.g. "3-user-data/…"), so
    // match on suffix rather than the bare filename.
    expect(
      result.manifest.jsonFilesBackedUp.some((f) => f.endsWith(WORKSPACE_FILE_NAMES.usersPermissions))
    ).toBe(true);
    expect(
      result.manifest.jsonFilesBackedUp.some((f) => f.endsWith("labels.snapshot.json"))
    ).toBe(true);
    expect(result.manifest.xlsxFilesBackedUp).toEqual([]);
    expect(result.manifest.datasets).toEqual([]);
  });
});

const month = { folderName: "5-may-2026", month: 5, year: 2026 };

async function seedPopulationLayout(
  root: DirectoryHandleLike,
  layout: "current" | "legacy"
): Promise<void> {
  const populationRoot = await root.getDirectoryHandle(
    layout === "current" ? "1-population" : "Population",
    { create: true }
  );
  const monthDir = await populationRoot.getDirectoryHandle(month.folderName, { create: true });
  const rawDir = await monthDir.getDirectoryHandle(layout === "current" ? "1-raw" : "raw", { create: true });
  const processedDir = await monthDir.getDirectoryHandle(
    layout === "current" ? "2-processed" : "processed",
    { create: true }
  );

  await safeWriteJson(monthDir, "month.manifest.json", {
    monthFolderName: month.folderName,
    month: month.month,
    year: month.year,
    processedAt: "2026-05-31T10:00:00.000Z",
    processedBy: "admin",
    riskFileName: "risk.xlsx",
    biFileName: null,
    certScanUsed: false,
    templateVersion: null,
    rngSeed: null,
    totalRawRows: 2,
    totalProcessedRows: 2,
    status: "processed-saved",
  });
  await safeWriteJson(rawDir, "risk.raw.json", {
    sourceFileName: "risk.xlsx",
    importedAt: "2026-05-31T10:00:00.000Z",
    importedBy: "admin",
    rows: [{ id: 1 }, { id: 2 }],
  });
  await safeWriteJson(processedDir, "population.final.json", {
    sourceMonthFolder: month.folderName,
    processedAt: "2026-05-31T10:00:00.000Z",
    processedBy: "admin",
    totalRows: 2,
    certScanRows: 0,
    nonCertScanRows: 2,
    rows: [{ id: 1 }, { id: 2 }],
  });
}

/** Writes ONLY month.manifest.json (current numbered layout) — no population.final.json
 *  — so a test can prove loadArchiveStatus/exportMonthXlsx used the manifest's own
 *  fields instead of falling back to a full read. */
async function writeManifestOnly(
  root: DirectoryHandleLike,
  overrides: Partial<MonthManifestData> = {}
): Promise<void> {
  const populationRoot = await root.getDirectoryHandle("1-population", { create: true });
  const monthDir = await populationRoot.getDirectoryHandle(month.folderName, { create: true });
  const manifest: MonthManifestData = {
    monthFolderName: month.folderName,
    month: month.month,
    year: month.year,
    processedAt: "2026-05-31T10:00:00.000Z",
    processedBy: "admin",
    riskFileName: "risk.xlsx",
    biFileName: null,
    certScanUsed: false,
    templateVersion: null,
    rngSeed: null,
    totalRawRows: 2,
    totalProcessedRows: 2,
    status: "processed-saved",
    ...overrides,
  };
  await safeWriteJson(monthDir, "month.manifest.json", manifest);
}

/** Writes ONLY population.final.json (current numbered layout) — no manifest —
 *  used to prove the legacy-fallback read path still returns accurate data when
 *  the manifest can't be trusted. */
async function writePopulationOnly(root: DirectoryHandleLike, rowCount: number): Promise<void> {
  const populationRoot = await root.getDirectoryHandle("1-population", { create: true });
  const monthDir = await populationRoot.getDirectoryHandle(month.folderName, { create: true });
  const processedDir = await monthDir.getDirectoryHandle("2-processed", { create: true });
  await safeWriteJson(processedDir, "population.final.json", {
    sourceMonthFolder: month.folderName,
    processedAt: "2026-05-31T10:00:00.000Z",
    processedBy: "admin",
    totalRows: rowCount,
    certScanRows: 0,
    nonCertScanRows: rowCount,
    rows: Array.from({ length: rowCount }, (_, i) => ({ id: i })),
  });
}

/**
 * Wraps a real memory directory so every FileHandleLike for a ".xlsx" file is
 * missing createWritable (createWritable is typed optional on FileHandleLike —
 * see CLAUDE.md) while every other path (JSON reads/writes, directory
 * traversal) passes straight through to the real handle. Lets a test simulate
 * "writeBinaryFile got a handle it cannot write through" without needing
 * memoryDirectory.ts (not in this bucket's owned files) to support it directly.
 */
function wrapDirDenyingXlsxWrites(real: DirectoryHandleLike): DirectoryHandleLike {
  const wrapped: DirectoryHandleLike = {
    ...real,
    getFileHandle: async (fileName: string, options?: { create?: boolean }) => {
      const fh = await real.getFileHandle(fileName, options);
      if (!fileName.endsWith(".xlsx")) return fh;
      // Explicitly rebuild without createWritable (rather than destructure-and-
      // discard) — createWritable is OPTIONAL on FileHandleLike, so omitting it
      // here is itself a valid, real shape (see CLAUDE.md's guard-before-calling
      // note), not a hack.
      const stripped: FileHandleLike = { kind: fh.kind, name: fh.name, getFile: fh.getFile };
      return stripped;
    },
    getDirectoryHandle: async (dirName: string, options?: { create?: boolean }) => {
      const child = await real.getDirectoryHandle(dirName, options);
      return wrapDirDenyingXlsxWrites(child);
    },
  };
  return wrapped;
}

describe("archive population path compatibility", () => {
  it("loads current numbered population folders and exports their rows", async () => {
    const root = makeRoot();
    await seedPopulationLayout(root, "current");

    const [status] = await loadArchiveStatus(root, [month]);
    expect(status).toMatchObject({
      hasManifest: true,
      hasPopulation: true,
      hasRawRisk: true,
      totalProcessedRows: 2,
    });

    const backup = await createBackup(root, [month], "admin", "manual", {
      includeXlsxExports: true,
    });
    expect(backup.ok).toBe(true);
    if (!backup.ok) return;
    expect(backup.manifest.datasets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ dataset: "population-final", rowCount: 2 }),
        expect.objectContaining({ dataset: "risk-raw", rowCount: 2 }),
      ])
    );
  });

  it("continues to load legacy unnumbered population folders", async () => {
    const root = makeRoot();
    await seedPopulationLayout(root, "legacy");

    const [status] = await loadArchiveStatus(root, [month]);
    expect(status).toMatchObject({
      hasManifest: true,
      hasPopulation: true,
      hasRawRisk: true,
      totalProcessedRows: 2,
    });
  });
});

describe("backup XLSX compatibility export", () => {
  it("rejects a 400k-row dataset before allocating a worksheet", () => {
    expect(() => assertXlsxDatasetWithinLimit("population-final", 400_000)).toThrow(
      /تعذر إنشاء ملفات XLSX الاختيارية/
    );
    expect(() =>
      assertXlsxDatasetWithinLimit("population-final", XLSX_MAX_ROWS_PER_DATASET)
    ).not.toThrow();
  });
});

describe("loadBackupHistory compatibility", () => {
  it("reads legacy manifests with populated XLSX fields", async () => {
    const root = makeRoot();
    const systemDir = await getSystemRoot(root, true);
    const backupsDir = await systemDir.getDirectoryHandle("backups", { create: true });
    const legacyDir = await backupsDir.getDirectoryHandle("legacy-with-xlsx", { create: true });
    await safeWriteJson(legacyDir, "backup.manifest.json", {
      createdAt: "2026-07-01T00:00:00.000Z",
      createdBy: "admin",
      mode: "manual",
      monthsFolders: [month.folderName],
      jsonFilesBackedUp: ["1-population/month.json"],
      xlsxFilesBackedUp: ["xlsx/population.xlsx"],
      datasets: [{
        dataset: "population-final",
        monthFolderName: month.folderName,
        rowCount: 400_000,
        xlsxFiles: ["xlsx/population.xlsx"],
      }],
      rowLimitPerWorkbookPart: 250_000,
      excelSheetRowLimit: 1_048_576,
    });

    await expect(loadBackupHistory(root)).resolves.toEqual([
      expect.objectContaining({
        folderName: "legacy-with-xlsx",
        xlsxFilesCount: 1,
        totalRows: 400_000,
      }),
    ]);
  });
});

describe("createBackup — month folder missing from population root (repro)", () => {
  it("does not abort the whole backup when a listed month has no population folder", async () => {
    const root = makeRoot();
    // Population root exists but has no subfolder for this month — e.g. the
    // month only has sample/distribution data, or its population folder was
    // removed/renamed concurrently with the backup walk (the same class of
    // race documented in v41.4, but hitting the unguarded loadMonthJson path
    // instead of the guarded copyAllJsonFiles/copyJsonTree walk).
    await root.getDirectoryHandle("1-population", { create: true });

    const result = await createBackup(root, [month], "admin", "manual");
    expect(result.ok).toBe(true);
  });
});

describe("write-permission gate (deferred workspace write access, PR #36 follow-up)", () => {
  it("createBackup requests write permission and succeeds on a freshly-restored read-only workspace", async () => {
    const root = createMemoryDirectory("root", {
      initialWritePermission: "prompt",
      writePermissionRequestOutcome: "granted",
    });

    const result = await createBackup(root, [], "admin", "manual");
    expect(result.ok).toBe(true);
  });

  it("createBackup fails with the Arabic permission message, not a raw browser error, when write access is declined", async () => {
    const root = createMemoryDirectory("root", {
      initialWritePermission: "prompt",
      writePermissionRequestOutcome: "denied",
    });

    const result = await createBackup(root, [], "admin", "manual");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe(new WorkspacePermissionError().message);
  });

  it("restoreBackupSnapshot re-checks write permission independently of the backup that created the snapshot", async () => {
    const root = makeRoot();
    await seedPopulationLayout(root, "current");
    const backup = await createBackup(root, [month], "admin", "manual");
    expect(backup.ok).toBe(true);
    if (!backup.ok) return;

    // Simulate a new session reconnecting the same on-disk workspace read-only
    // (PR #36) before the user triggers a restore.
    setSimulatedWritePermission(root, "prompt", "denied");

    const restored = await restoreBackupSnapshot({
      directoryHandle: root,
      months: [month],
      backupFolderName: backup.folderName,
      username: "admin",
    });
    expect(restored.ok).toBe(false);
    if (restored.ok) return;
    expect(restored.error).toBe(new WorkspacePermissionError().message);
  });

  it("createDailyAdminBackupIfDue resolves with a clean error instead of rejecting when write permission is unavailable", async () => {
    const root = createMemoryDirectory("root", {
      initialWritePermission: "prompt",
      writePermissionRequestOutcome: "denied",
    });

    await expect(
      createDailyAdminBackupIfDue(root, [], "admin")
    ).resolves.toMatchObject({ ok: false });
  });
});

describe("writeBinaryFile — accurate xlsx chunk accounting (item 5)", () => {
  it("does not record an xlsx chunk as backed up when the handle cannot be written through", async () => {
    const real = makeRoot();
    await seedPopulationLayout(real, "current");
    const root = wrapDirDenyingXlsxWrites(real);

    const result = await createBackup(root, [month], "admin", "manual", {
      includeXlsxExports: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Every dataset with rows (population-final, risk-raw) attempted a chunk
    // write; every one of those handles was denied a writable stream, so NONE
    // of them may appear as backed up — previously the file name was pushed
    // unconditionally regardless of whether the write actually happened.
    expect(result.manifest.xlsxFilesBackedUp).toEqual([]);
    const populationDataset = result.manifest.datasets.find((d) => d.dataset === "population-final");
    expect(populationDataset?.rowCount).toBe(2);
    expect(populationDataset?.xlsxFiles).toEqual([]);
  });

  it("still records xlsx chunks normally once the handle CAN be written through (control)", async () => {
    const root = makeRoot();
    await seedPopulationLayout(root, "current");

    const result = await createBackup(root, [month], "admin", "manual", {
      includeXlsxExports: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.manifest.xlsxFilesBackedUp.length).toBeGreaterThan(0);
    const populationDataset = result.manifest.datasets.find((d) => d.dataset === "population-final");
    expect(populationDataset?.xlsxFiles.length).toBe(1);
  });
});

describe("exportMonthXlsx — manifest pre-check before loading population.final.json (B3 perf)", () => {
  it("rejects an oversized population dataset using the manifest's cheap totalProcessedRows, even when the real file is small", async () => {
    const root = makeRoot();
    // Manifest claims a dataset far past the safe XLSX limit; the actual
    // population.final.json is tiny. Under the OLD code (which only checked
    // population.rows.length AFTER loading it) this would NOT reject — proving
    // the manifest-based pre-check is really what fires here.
    await writeManifestOnly(root, { totalProcessedRows: XLSX_MAX_ROWS_PER_DATASET + 1 });
    await writePopulationOnly(root, 2);

    const result = await createBackup(root, [month], "admin", "manual", {
      includeXlsxExports: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.xlsxWarning).toMatch(/تعذر إنشاء ملفات XLSX الاختيارية/);
    expect(result.xlsxWarning).toMatch(/population-final/);
  });

  it("still succeeds for a population dataset within the limit (control)", async () => {
    const root = makeRoot();
    await writeManifestOnly(root, { totalProcessedRows: 2 });
    await writePopulationOnly(root, 2);

    const result = await createBackup(root, [month], "admin", "manual", {
      includeXlsxExports: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.xlsxWarning).toBeUndefined();
  });
});

describe("loadArchiveStatus — manifest-based population shortcut (B3 perf)", () => {
  it("trusts manifest.totalProcessedRows/status once population processing was reached, without needing population.final.json", async () => {
    const root = makeRoot();
    // No population.final.json written at all — if the shortcut weren't taken,
    // the legacy full-read fallback would report hasPopulation: false.
    await writeManifestOnly(root, { status: "sampled", totalProcessedRows: 7 });

    const [status] = await loadArchiveStatus(root, [month]);
    expect(status).toMatchObject({ hasPopulation: true, totalProcessedRows: 7 });
  });

  it("reports no population for a month still at raw-saved (population not yet processed)", async () => {
    const root = makeRoot();
    await writeManifestOnly(root, { status: "raw-saved", totalProcessedRows: 0 });

    const [status] = await loadArchiveStatus(root, [month]);
    expect(status.hasPopulation).toBe(false);
  });

  it("reports no population for a month CLOSED before processing (statusBeforeClose: raw-saved) — truthfulness edge case", async () => {
    const root = makeRoot();
    // A month can be closed at any stage. If closed while still raw-saved,
    // population.final.json never existed — the shortcut must not claim
    // otherwise just because status itself reads "closed".
    await writeManifestOnly(root, {
      status: "closed",
      statusBeforeClose: "raw-saved",
      totalProcessedRows: 0,
    });

    const [status] = await loadArchiveStatus(root, [month]);
    expect(status.hasPopulation).toBe(false);
  });

  it("trusts the manifest for a month CLOSED after processing (statusBeforeClose: distributed)", async () => {
    const root = makeRoot();
    await writeManifestOnly(root, {
      status: "closed",
      statusBeforeClose: "distributed",
      totalProcessedRows: 42,
    });

    const [status] = await loadArchiveStatus(root, [month]);
    expect(status).toMatchObject({ hasPopulation: true, totalProcessedRows: 42 });
  });

  it("falls back to a full population.final.json read when the manifest is missing totalProcessedRows (legacy shape)", async () => {
    const root = makeRoot();
    const populationRoot = await root.getDirectoryHandle("1-population", { create: true });
    const monthDir = await populationRoot.getDirectoryHandle(month.folderName, { create: true });
    // Legacy manifest shape missing totalProcessedRows entirely — the shortcut
    // must recognize it cannot trust this manifest and fall back to the real file.
    const legacyManifest = {
      monthFolderName: month.folderName,
      month: month.month,
      year: month.year,
      processedAt: "2026-05-31T10:00:00.000Z",
      processedBy: "admin",
      riskFileName: "risk.xlsx",
      biFileName: null,
      certScanUsed: false,
      templateVersion: null,
      rngSeed: null,
      totalRawRows: 2,
      status: "processed-saved" as const,
    };
    await safeWriteJson(monthDir, "month.manifest.json", legacyManifest);
    await writePopulationOnly(root, 9);

    const [status] = await loadArchiveStatus(root, [month]);
    expect(status).toMatchObject({ hasPopulation: true, totalProcessedRows: 9 });
  });
});
