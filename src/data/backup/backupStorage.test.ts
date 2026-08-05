import { describe, expect, it } from "vitest";

import { createMemoryDirectory, setSimulatedWritePermission } from "../storage/memoryDirectory";
import type { DirectoryHandleLike, FileHandleLike } from "../storage/fileSystemAccess";
import { safeReadJson, safeWriteJson } from "../storage/safeWrite";
import { WorkspacePermissionError } from "../storage/workspaceWriteAccess";
import { getSampleMainDir, getSystemRoot, getUserDataRoot } from "../workspace/workspacePaths";
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

/**
 * Wraps a real memory directory so any getDirectoryHandle call for a folder
 * name present in `delayMsByFolder` awaits that many ms before delegating to
 * the real handle -- lets a test make loadArchiveStatus's per-month reads
 * (loadMonthJson repeatedly calls getMonthDir/getSampleMainDir, each of which
 * re-enters getDirectoryHandle(monthFolderName)) complete in a DELIBERATELY
 * different order than the input `months` array, to prove mapWithConcurrency
 * (Task 2) returns results in input order rather than completion order.
 */
function wrapDirWithDelay(
  real: DirectoryHandleLike,
  delayMsByFolder: Record<string, number>
): DirectoryHandleLike {
  const wrapped: DirectoryHandleLike = {
    ...real,
    getDirectoryHandle: async (dirName: string, options?: { create?: boolean }) => {
      const delay = delayMsByFolder[dirName];
      if (delay) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      const child = await real.getDirectoryHandle(dirName, options);
      return wrapDirWithDelay(child, delayMsByFolder);
    },
  };
  return wrapped;
}

/**
 * Wraps a real memory directory so any getFileHandle call for a file name
 * present in `delayMsByFile` awaits that many ms before delegating to the
 * real handle -- lets a test make copyAllJsonFiles's per-file read+write
 * round trips (readTextFile/writeTextFile both call getFileHandle) complete
 * in a DELIBERATELY different order than collectJsonFileEntries' listing
 * order, to prove mapWithConcurrency (Task 3) keeps jsonFilesBackedUp
 * index-addressed (listing order) rather than completion order.
 */
function wrapDirWithFileDelay(
  real: DirectoryHandleLike,
  delayMsByFile: Record<string, number>
): DirectoryHandleLike {
  const wrapped: DirectoryHandleLike = {
    ...real,
    getFileHandle: async (fileName: string, options?: { create?: boolean }) => {
      const delay = delayMsByFile[fileName];
      if (delay) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      return real.getFileHandle(fileName, options);
    },
    getDirectoryHandle: async (dirName: string, options?: { create?: boolean }) => {
      const child = await real.getDirectoryHandle(dirName, options);
      return wrapDirWithFileDelay(child, delayMsByFile);
    },
  };
  return wrapped;
}

/** Seeds a backup folder directly under 5-system/backups/{folderName}/json/
 *  with the given flat files (name -> value), bypassing createBackup so a
 *  test can control the restore source's exact file layout without paying
 *  for a real backup-creation walk first. */
async function seedBackupJsonFiles(
  root: DirectoryHandleLike,
  folderName: string,
  files: Record<string, unknown>
): Promise<void> {
  const systemDir = await getSystemRoot(root, true);
  const backupsDir = await systemDir.getDirectoryHandle("backups", { create: true });
  const backupDir = await backupsDir.getDirectoryHandle(folderName, { create: true });
  const jsonDir = await backupDir.getDirectoryHandle("json", { create: true });
  for (const [name, value] of Object.entries(files)) {
    await safeWriteJson(jsonDir, name, value);
  }
}

/**
 * Wraps a real memory directory so any getFileHandle(name, { create: true })
 * call for a file name present in `watch` appends that name to `log`, in call
 * order -- lets a test prove one write happened strictly before another (e.g.
 * a sentinel file written before any of the actual restored data files)
 * without mocking this module's write helpers directly.
 */
function wrapDirLoggingFileWrites(
  real: DirectoryHandleLike,
  log: string[],
  watch: Set<string>
): DirectoryHandleLike {
  const wrapped: DirectoryHandleLike = {
    ...real,
    getFileHandle: async (fileName: string, options?: { create?: boolean }) => {
      if (options?.create && watch.has(fileName)) {
        log.push(fileName);
      }
      return real.getFileHandle(fileName, options);
    },
    getDirectoryHandle: async (dirName: string, options?: { create?: boolean }) => {
      const child = await real.getDirectoryHandle(dirName, options);
      return wrapDirLoggingFileWrites(child, log, watch);
    },
  };
  return wrapped;
}

/**
 * Wraps a real memory directory so any getFileHandle(name, { create: true })
 * call for `failingFileName` throws instead of delegating to the real handle
 * -- lets a test simulate the restore walk failing partway through writing
 * one specific file, to prove restore.inprogress.json survives an
 * interrupted restore (the whole point of the sentinel).
 */
function wrapDirFailingFileWrite(
  real: DirectoryHandleLike,
  failingFileName: string
): DirectoryHandleLike {
  const wrapped: DirectoryHandleLike = {
    ...real,
    getFileHandle: async (fileName: string, options?: { create?: boolean }) => {
      if (options?.create && fileName === failingFileName) {
        throw new Error(`Simulated write failure for ${failingFileName}`);
      }
      return real.getFileHandle(fileName, options);
    },
    getDirectoryHandle: async (dirName: string, options?: { create?: boolean }) => {
      const child = await real.getDirectoryHandle(dirName, options);
      return wrapDirFailingFileWrite(child, failingFileName);
    },
  };
  return wrapped;
}

function flakyNotReadableError(): Error {
  // Mirrors the real Chromium DOMException text for this condition (and the
  // exact wording the user reported hitting during a real backup).
  const error = new Error(
    "The requested file could not be read, typically due to permissions problems that have occurred after a reference to file was acquired."
  );
  error.name = "NotReadableError";
  return error;
}

/**
 * Wraps a real memory directory so any READ (options.create falsy)
 * getFileHandle lookup for `flakyFileName` returns a handle whose getFile()
 * throws a NotReadableError-shaped error the first `state.remainingFailures`
 * times it is called (across this wrapper and any of its recursively-wrapped
 * subdirectories, via the shared `state` object), then delegates to the real
 * handle -- lets a test simulate the transient "could not be read" condition
 * that backupStorage.ts's readTextFile now retries via safeWrite.ts's
 * readFileTextWithRetry. Pass `Number.POSITIVE_INFINITY` as
 * remainingFailures to simulate a NotReadableError that never clears, to
 * prove an exhausted retry still fails the whole backup/restore instead of
 * being silently swallowed.
 */
function wrapDirWithFlakyFileRead(
  real: DirectoryHandleLike,
  flakyFileName: string,
  state: { remainingFailures: number }
): DirectoryHandleLike {
  const wrapped: DirectoryHandleLike = {
    ...real,
    getFileHandle: async (fileName: string, options?: { create?: boolean }) => {
      const handle = await real.getFileHandle(fileName, options);
      if (options?.create || fileName !== flakyFileName) return handle;
      return {
        ...handle,
        getFile: async (): Promise<File> => {
          if (state.remainingFailures > 0) {
            state.remainingFailures -= 1;
            throw flakyNotReadableError();
          }
          return handle.getFile();
        },
      } as FileHandleLike;
    },
    getDirectoryHandle: async (dirName: string, options?: { create?: boolean }) => {
      const child = await real.getDirectoryHandle(dirName, options);
      return wrapDirWithFlakyFileRead(child, flakyFileName, state);
    },
  };
  return wrapped;
}

/**
 * Wraps a real memory directory so any READ lookup (options.create falsy) of
 * `missingDirName` throws a NotFoundError-shaped error instead of delegating
 * to the real handle -- lets a test simulate a backup subdirectory that
 * disappeared out from under an in-progress restore (e.g. another tab's
 * pruneAutoBackups, or a network-share sync client) without touching
 * memoryDirectory.ts. CREATE lookups (targetDir's ensureDir calls during the
 * restore walk) pass straight through, so only the restore-side READ of this
 * one subdirectory name is affected (F1 repro).
 */
function wrapDirMissingSubdirectory(
  real: DirectoryHandleLike,
  missingDirName: string
): DirectoryHandleLike {
  const wrapped: DirectoryHandleLike = {
    ...real,
    getDirectoryHandle: async (dirName: string, options?: { create?: boolean }) => {
      if (dirName === missingDirName && !options?.create) {
        const error = new Error(`Simulated missing directory: ${missingDirName}`);
        error.name = "NotFoundError";
        throw error;
      }
      const child = await real.getDirectoryHandle(dirName, options);
      return wrapDirMissingSubdirectory(child, missingDirName);
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

describe("loadArchiveStatus — distribution completed/pending surfacing (P2-1)", () => {
  it("surfaces totalCompleted/totalPending from the already-loaded DistributionCurrentData without a new file read", async () => {
    const root = makeRoot();
    await seedPopulationLayout(root, "current");
    const sampleMainDir = await getSampleMainDir(root, month.folderName, true);
    await safeWriteJson(sampleMainDir, "distribution.current.json", {
      monthFolderName: month.folderName,
      derivedAt: "2026-05-31T12:00:00.000Z",
      totalAssigned: 10,
      totalCompleted: 6,
      totalReplaced: 0,
      totalPending: 4,
      entries: [],
    });

    const [status] = await loadArchiveStatus(root, [month]);
    expect(status).toMatchObject({
      hasDistribution: true,
      distributionCompleted: 6,
      distributionPending: 4,
    });
  });

  it("defaults distributionCompleted/distributionPending to 0 when no distribution.current.json exists", async () => {
    const root = makeRoot();
    await seedPopulationLayout(root, "current");

    const [status] = await loadArchiveStatus(root, [month]);
    expect(status).toMatchObject({
      hasDistribution: false,
      distributionCompleted: 0,
      distributionPending: 0,
    });
  });
});

describe("loadArchiveStatus — result order survives out-of-order completion (Task 2)", () => {
  it("returns statuses in input `months` order even when an earlier month's reads finish last", async () => {
    const root = makeRoot();
    const months = [
      { folderName: "1-january-2026", month: 1, year: 2026 },
      { folderName: "2-february-2026", month: 2, year: 2026 },
      { folderName: "3-march-2026", month: 3, year: 2026 },
    ];

    for (const m of months) {
      const populationRoot = await root.getDirectoryHandle("1-population", { create: true });
      const monthDir = await populationRoot.getDirectoryHandle(m.folderName, { create: true });
      await safeWriteJson(monthDir, "month.manifest.json", {
        monthFolderName: m.folderName,
        month: m.month,
        year: m.year,
        processedAt: "2026-01-31T10:00:00.000Z",
        processedBy: "admin",
        riskFileName: "risk.xlsx",
        biFileName: null,
        certScanUsed: false,
        templateVersion: null,
        rngSeed: null,
        totalRawRows: m.month,
        totalProcessedRows: m.month,
        status: "processed-saved",
      });
    }

    // Deliberately reversed relative to input order: months[0]'s reads are the
    // SLOWEST and months[2]'s the FASTEST, so under real concurrency months[2]
    // finishes first -- exactly the scenario a naive "push as each resolves"
    // implementation would get wrong. This may pass even against the current
    // (pre-Task-2) sequential loop, since a strictly sequential for-loop can
    // never observe out-of-order completion in the first place -- that's
    // expected; the value here is regression protection once concurrency lands.
    const delayed = wrapDirWithDelay(root, {
      [months[0]!.folderName]: 30,
      [months[1]!.folderName]: 15,
      [months[2]!.folderName]: 2,
    });

    const statuses = await loadArchiveStatus(delayed, months);

    expect(statuses.map((s) => s.folderName)).toEqual(months.map((m) => m.folderName));
    expect(statuses.map((s) => s.totalProcessedRows)).toEqual([1, 2, 3]);
  });
});

describe("createBackup — jsonFilesBackedUp order survives out-of-order completion (Task 3)", () => {
  it("keeps jsonFilesBackedUp in the walk's listing order even when an earlier file's copy finishes last", async () => {
    const root = makeRoot();
    await safeWriteJson(root, "a-file.json", { value: "a" });
    await safeWriteJson(root, "b-file.json", { value: "b" });
    await safeWriteJson(root, "c-file.json", { value: "c" });

    // Deliberately reversed relative to listing order: a-file's copy is the
    // SLOWEST and c-file's the FASTEST, so under real concurrency c-file
    // finishes first -- exactly the scenario a naive "push as each resolves"
    // implementation would get wrong. This may pass even against the current
    // (pre-Task-3) sequential walk, since a strictly sequential loop can
    // never observe out-of-order completion in the first place -- that's
    // expected; the value here is regression protection once concurrency lands.
    const delayed = wrapDirWithFileDelay(root, {
      "a-file.json": 30,
      "b-file.json": 15,
      "c-file.json": 2,
    });

    const result = await createBackup(delayed, [], "admin", "manual");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const relevant = result.manifest.jsonFilesBackedUp.filter((f) =>
      ["a-file.json", "b-file.json", "c-file.json"].includes(f)
    );
    expect(relevant).toEqual(["a-file.json", "b-file.json", "c-file.json"]);
  });
});

describe("restoreBackupSnapshot — restoredFiles order survives out-of-order completion (Task 4)", () => {
  it("keeps restoredFiles in the walk's listing order even when an earlier file's restore finishes last", async () => {
    const root = makeRoot();
    await seedBackupJsonFiles(root, "seed-backup", {
      "a-file.json": { value: "a" },
      "b-file.json": { value: "b" },
      "c-file.json": { value: "c" },
    });

    // Deliberately reversed relative to listing order: a-file's restore is the
    // SLOWEST and c-file's the FASTEST, so under real concurrency c-file
    // finishes first -- exactly the scenario a naive "push as each resolves"
    // implementation would get wrong. Mirrors the Task 3 jsonFilesBackedUp
    // order test above, but for the restore direction (restoreJsonTree used
    // to be a strictly sequential live-async-iterator walk, which could never
    // observe out-of-order completion in the first place).
    const delayed = wrapDirWithFileDelay(root, {
      "a-file.json": 30,
      "b-file.json": 15,
      "c-file.json": 2,
    });

    const result = await restoreBackupSnapshot({
      directoryHandle: delayed,
      months: [],
      backupFolderName: "seed-backup",
      username: "admin",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const relevant = result.restoredFiles.filter((f) =>
      ["a-file.json", "b-file.json", "c-file.json"].includes(f)
    );
    expect(relevant).toEqual(["a-file.json", "b-file.json", "c-file.json"]);
  });
});

describe("restoreBackupSnapshot — restore.inprogress.json sentinel (Task 4)", () => {
  it("writes restore.inprogress.json before any data file is restored, and removes it after a successful restore", async () => {
    const root = makeRoot();
    await seedBackupJsonFiles(root, "seed-backup", {
      "a-file.json": { value: "a" },
      "b-file.json": { value: "b" },
      "c-file.json": { value: "c" },
    });

    const log: string[] = [];
    const watch = new Set(["restore.inprogress.json", "a-file.json", "b-file.json", "c-file.json"]);
    const logged = wrapDirLoggingFileWrites(root, log, watch);

    const result = await restoreBackupSnapshot({
      directoryHandle: logged,
      months: [],
      backupFolderName: "seed-backup",
      username: "admin",
    });

    expect(result.ok).toBe(true);

    // The sentinel's own write is fully awaited to completion before
    // restoreJsonTree (and therefore any of its concurrent workers) even
    // starts, so it must be the very first watched write logged.
    expect(log[0]).toBe("restore.inprogress.json");
    expect(log.slice(1).sort()).toEqual(["a-file.json", "b-file.json", "c-file.json"]);

    // Removed after successful completion.
    const systemDir = await getSystemRoot(root, false);
    await expect(
      systemDir.getFileHandle("restore.inprogress.json", { create: false })
    ).rejects.toMatchObject({ name: "NotFoundError" });
  });
});

describe("restoreBackupSnapshot — restore.inprogress.json survives an interrupted restore (Task 4)", () => {
  it("leaves restore.inprogress.json behind when the restore walk throws partway through", async () => {
    const root = makeRoot();
    await seedBackupJsonFiles(root, "seed-backup", {
      "a-file.json": { value: "a" },
      "b-file.json": { value: "b" },
      "c-file.json": { value: "c" },
    });

    // Simulates the restore walk being interrupted partway through -- b-file's
    // write throws, so the whole restore fails, and restore.inprogress.json
    // (written before the walk started) must be left behind: that's the
    // detectability property the sentinel exists for.
    const failing = wrapDirFailingFileWrite(root, "b-file.json");

    const result = await restoreBackupSnapshot({
      directoryHandle: failing,
      months: [],
      backupFolderName: "seed-backup",
      username: "admin",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/b-file\.json/);

    const systemDir = await getSystemRoot(root, false);
    await expect(
      systemDir.getFileHandle("restore.inprogress.json", { create: false })
    ).resolves.toBeDefined();
  });
});

describe("restoreBackupSnapshot — partial-restore detection when a backup subdirectory is missing (F1)", () => {
  it("reports ok:false and leaves restore.inprogress.json in place when a nested backup subdirectory cannot be read", async () => {
    const root = makeRoot();
    const systemDir = await getSystemRoot(root, true);
    const backupsDir = await systemDir.getDirectoryHandle("backups", { create: true });
    const backupDir = await backupsDir.getDirectoryHandle("seed-backup", { create: true });
    const jsonDir = await backupDir.getDirectoryHandle("json", { create: true });
    await safeWriteJson(jsonDir, "top-file.json", { value: "top" });
    const subDir = await jsonDir.getDirectoryHandle("missing-during-restore", { create: true });
    await safeWriteJson(subDir, "nested-file.json", { value: "nested" });

    // Simulates another tab's pruneAutoBackups (or a sync client) deleting
    // this subdirectory out from under the restore walk -- the walk must NOT
    // silently drop the whole subtree and report success (F1).
    const missing = wrapDirMissingSubdirectory(root, "missing-during-restore");

    const result = await restoreBackupSnapshot({
      directoryHandle: missing,
      months: [],
      backupFolderName: "seed-backup",
      username: "admin",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Concise Arabic partial-restore message, not a raw browser NotFoundError.
    expect(result.error).toMatch(/جزئ/);

    // The sentinel must survive: its whole purpose is making an interrupted
    // (here: partial) restore detectable on a later check.
    const systemDirCheck = await getSystemRoot(root, false);
    await expect(
      systemDirCheck.getFileHandle("restore.inprogress.json", { create: false })
    ).resolves.toBeDefined();
  });
});

describe("createBackup — backup.complete.json written last (Task 4)", () => {
  it("writes backup.complete.json only after backup.manifest.json has already been written", async () => {
    const root = makeRoot();

    const log: string[] = [];
    const watch = new Set(["backup.manifest.json", "backup.complete.json"]);
    const logged = wrapDirLoggingFileWrites(root, log, watch);

    const result = await createBackup(logged, [], "admin", "manual");

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(log).toEqual(["backup.manifest.json", "backup.complete.json"]);

    const systemDir = await getSystemRoot(root, false);
    const backupsDir = await systemDir.getDirectoryHandle("backups", { create: false });
    const backupDir = await backupsDir.getDirectoryHandle(result.folderName, { create: false });
    await expect(
      backupDir.getFileHandle("backup.complete.json", { create: false })
    ).resolves.toBeDefined();
  });
});

describe("createBackup — transient NotReadableError recovery (readTextFile retry)", () => {
  it("completes the backup after a transiently unreadable file's read succeeds on retry", async () => {
    const root = makeRoot();
    await safeWriteJson(root, "a-file.json", { value: "a" });
    await safeWriteJson(root, "b-file.json", { value: "b" });
    await safeWriteJson(root, "c-file.json", { value: "c" });

    // b-file's read throws NotReadableError twice (matching
    // NOT_READABLE_RETRY_DELAYS_MS = [20, 60] in safeWrite.ts, i.e. 2
    // retries available) before succeeding on the 3rd attempt -- simulating
    // the transient "could not be read" window a concurrent write, sync
    // client, or antivirus scan can open up. This is exactly the report:
    // the user's exact NotReadableError message, hit during a real backup
    // after the copy walk went from 1 concurrent file read to 8 (widening
    // the window in which this transient condition gets landed on).
    const flaky = wrapDirWithFlakyFileRead(root, "b-file.json", { remainingFailures: 2 });

    const result = await createBackup(flaky, [], "admin", "manual");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const relevant = result.manifest.jsonFilesBackedUp.filter((f) =>
      ["a-file.json", "b-file.json", "c-file.json"].includes(f)
    );
    expect(relevant.sort()).toEqual(["a-file.json", "b-file.json", "c-file.json"]);

    // The retry must have recovered the REAL content, not silently skipped
    // or substituted the file.
    const systemDir = await getSystemRoot(root, false);
    const backupsDir = await systemDir.getDirectoryHandle("backups", { create: false });
    const backupDir = await backupsDir.getDirectoryHandle(result.folderName, { create: false });
    const jsonDir = await backupDir.getDirectoryHandle("json", { create: false });
    const copied = await safeReadJson<{ value: string }>(jsonDir, "b-file.json");
    expect(copied.ok && copied.value.value).toBe("b");
  });
});

describe("createBackup — persistent NotReadableError still fails the backup (retry does not mask real failures)", () => {
  it("reports ok:false and does not produce a partial backup when a file's read never recovers", async () => {
    const root = makeRoot();
    await safeWriteJson(root, "a-file.json", { value: "a" });
    await safeWriteJson(root, "b-file.json", { value: "b" });
    await safeWriteJson(root, "c-file.json", { value: "c" });

    // b-file's read NEVER succeeds -- the retry budget is exhausted and the
    // error must still propagate. A genuinely failed read (permissions
    // denied, corrupt handle, etc.) must keep failing the backup loud
    // rather than retrying forever or silently producing a partial backup.
    const flaky = wrapDirWithFlakyFileRead(root, "b-file.json", {
      remainingFailures: Number.POSITIVE_INFINITY,
    });

    const result = await createBackup(flaky, [], "admin", "manual");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/NotReadable|permission/i);

    // No partial backup: backup.manifest.json (written only after the whole
    // json copy walk completes) must not exist for this attempt, so
    // loadBackupHistory (which only counts folders with a readable manifest)
    // must not report it -- confirming the failure was not silently
    // swallowed into an incomplete-but-"successful" backup.
    const history = await loadBackupHistory(root);
    expect(history).toEqual([]);
  });
});
