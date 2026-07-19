import { describe, expect, it } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeWriteJson } from "../storage/safeWrite";
import { getUserDataRoot } from "../workspace/workspacePaths";
import { WORKSPACE_FILE_NAMES } from "../workspace/workspaceDefaults";
import { createBackup, loadArchiveStatus } from "./backupStorage";

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

    const backup = await createBackup(root, [month], "admin", "manual");
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
