import { describe, expect, it } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeWriteJson } from "../storage/safeWrite";
import { getSystemRoot } from "../workspace/workspacePaths";
import { restoreBackupSnapshot } from "./backupStorage";
import {
  isRestoreSentinelStale,
  RESTORE_INPROGRESS_FILE,
  readRestoreSentinel,
} from "./restoreSentinel";

function makeRoot(): DirectoryHandleLike {
  return createMemoryDirectory("root") as DirectoryHandleLike;
}

/** A hand-built backup fixture needs the same completion evidence createBackup writes. */
async function seedBackup(root: DirectoryHandleLike, folderName: string): Promise<void> {
  const systemDir = await getSystemRoot(root, true);
  const backupsDir = await systemDir.getDirectoryHandle("backups", { create: true });
  const backupDir = await backupsDir.getDirectoryHandle(folderName, { create: true });
  const jsonDir = await backupDir.getDirectoryHandle("json", { create: true });
  await safeWriteJson(jsonDir, "a-file.json", { value: "a" });
  await safeWriteJson(backupDir, "backup.manifest.json", {
    createdAt: "2026-05-31T10:00:00.000Z",
    createdBy: "admin",
    mode: "manual",
    monthsFolders: [],
    jsonFilesBackedUp: [],
    xlsxFilesBackedUp: [],
    datasets: [],
    rowLimitPerWorkbookPart: 25_000,
    excelSheetRowLimit: 1_048_576,
  });
  await safeWriteJson(backupDir, "backup.complete.json", { completedAt: "2026-05-31T10:00:00.000Z" });
}

/** Fails the write of one file, so the restore walk stops partway through. */
function wrapDirFailingFileWrite(
  real: DirectoryHandleLike,
  failingFileName: string
): DirectoryHandleLike {
  return {
    ...real,
    getFileHandle: async (fileName: string, options?: { create?: boolean }) => {
      if (options?.create && fileName === failingFileName) {
        throw new Error(`Simulated write failure for ${failingFileName}`);
      }
      return real.getFileHandle(fileName, options);
    },
    getDirectoryHandle: async (dirName: string, options?: { create?: boolean }) =>
      wrapDirFailingFileWrite(await real.getDirectoryHandle(dirName, options), failingFileName),
  };
}

describe("readRestoreSentinel — the read side of restore.inprogress.json", () => {
  it("reports nothing for a workspace no restore ever touched", async () => {
    expect(await readRestoreSentinel(makeRoot())).toBeNull();
  });

  it("reports nothing after a restore that COMPLETED (the sentinel is removed)", async () => {
    const root = makeRoot();
    await seedBackup(root, "seed-backup");

    const result = await restoreBackupSnapshot({
      directoryHandle: root,
      months: [],
      backupFolderName: "seed-backup",
      username: "admin",
    });
    expect(result.ok).toBe(true);

    expect(await readRestoreSentinel(root)).toBeNull();
  });

  it("reports the interrupted restore left behind by a walk that threw", async () => {
    const root = makeRoot();
    await seedBackup(root, "seed-backup");

    const result = await restoreBackupSnapshot({
      directoryHandle: wrapDirFailingFileWrite(root, "a-file.json"),
      months: [],
      backupFolderName: "seed-backup",
      username: "admin",
    });
    expect(result.ok).toBe(false);

    const sentinel = await readRestoreSentinel(root);
    expect(sentinel).not.toBeNull();
    expect(sentinel?.startedBy).toBe("admin");
    // Written moments ago, so it is not yet stale — a restore in flight on
    // another machine must not be reported as interrupted.
    expect(isRestoreSentinelStale(sentinel!)).toBe(false);
    expect(isRestoreSentinelStale(sentinel!, Date.now() + 60 * 60 * 1000)).toBe(true);
  });

  it("treats a present-but-corrupt sentinel as an interrupted restore, not as absent", async () => {
    const root = makeRoot();
    const systemDir = await getSystemRoot(root, true);
    const handle = await systemDir.getFileHandle(RESTORE_INPROGRESS_FILE, { create: true });
    const writable = await handle.createWritable!();
    await writable.write("{ not json");
    await writable.close();

    const sentinel = await readRestoreSentinel(root);
    expect(sentinel).toEqual({ startedAt: "", startedBy: "" });
    expect(isRestoreSentinelStale(sentinel!)).toBe(true);
  });
});
