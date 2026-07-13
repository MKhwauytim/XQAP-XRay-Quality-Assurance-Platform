import { describe, expect, test } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeReadJson, safeWriteJson } from "../storage/safeWrite";
import { AUTO_BACKUP_RETENTION_COUNT, pruneAutoBackups } from "./backupStorage";

async function getBackupsDir(dir: DirectoryHandleLike): Promise<DirectoryHandleLike> {
  const system = await dir.getDirectoryHandle("5-system", { create: true });
  const backups = await system.getDirectoryHandle("backups", { create: true });
  return backups;
}

async function writeBackup(
  backupsDir: DirectoryHandleLike,
  folderName: string,
  mode: "manual" | "automatic" | "pre-restore",
  createdAt: string
): Promise<void> {
  const backupDir = await backupsDir.getDirectoryHandle(folderName, { create: true });
  await safeWriteJson(backupDir, "backup.manifest.json", {
    createdAt,
    createdBy: "admin",
    mode,
    monthsFolders: [],
    jsonFilesBackedUp: [],
    xlsxFilesBackedUp: [],
    datasets: [],
    rowLimitPerWorkbookPart: 0,
    excelSheetRowLimit: 0,
  });
}

async function folderNames(backupsDir: DirectoryHandleLike): Promise<string[]> {
  const names: string[] = [];
  const iterable = (backupsDir as unknown as {
    values: () => AsyncIterable<{ name: string; kind: string }>;
  }).values();
  for await (const entry of iterable) {
    if (entry.kind === "directory") names.push(entry.name);
  }
  return names;
}

describe("auto-backup retention prune (A8)", () => {
  test("prunes automatic backups beyond the retention count, keeping manual + pre-restore", async () => {
    const dir = createMemoryDirectory();
    const backupsDir = await getBackupsDir(dir);

    const overBy = 2;
    const totalAuto = AUTO_BACKUP_RETENTION_COUNT + overBy;
    for (let i = 0; i < totalAuto; i += 1) {
      // Increasing timestamps → the lowest-numbered folders are the oldest.
      const createdAt = new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString();
      await writeBackup(backupsDir, `auto-${String(i).padStart(3, "0")}`, "automatic", createdAt);
    }
    await writeBackup(backupsDir, "manual-a", "manual", new Date(Date.UTC(2025, 0, 1)).toISOString());
    await writeBackup(backupsDir, "manual-b", "manual", new Date(Date.UTC(2025, 0, 2)).toISOString());
    await writeBackup(backupsDir, "rollback", "pre-restore", new Date(Date.UTC(2025, 0, 3)).toISOString());

    const removed = await pruneAutoBackups(dir);
    expect(removed).toHaveLength(overBy);
    // The two oldest automatic folders were removed.
    expect(removed.sort()).toEqual(["auto-000", "auto-001"]);

    const remaining = await folderNames(backupsDir);
    expect(remaining).toContain("manual-a");
    expect(remaining).toContain("manual-b");
    expect(remaining).toContain("rollback");
    expect(remaining.filter((n) => n.startsWith("auto-"))).toHaveLength(AUTO_BACKUP_RETENTION_COUNT);
    expect(remaining).not.toContain("auto-000");
    expect(remaining).not.toContain("auto-001");
  });

  test("no-op when automatic backups are at or under the retention count", async () => {
    const dir = createMemoryDirectory();
    const backupsDir = await getBackupsDir(dir);
    await writeBackup(backupsDir, "auto-1", "automatic", new Date().toISOString());
    await writeBackup(backupsDir, "manual-1", "manual", new Date().toISOString());

    const removed = await pruneAutoBackups(dir);
    expect(removed).toHaveLength(0);

    // The pruned manifest is still readable/intact.
    const backupDir = await backupsDir.getDirectoryHandle("auto-1", { create: false });
    const manifest = await safeReadJson<{ mode: string }>(backupDir, "backup.manifest.json");
    expect(manifest.ok).toBe(true);
  });
});
