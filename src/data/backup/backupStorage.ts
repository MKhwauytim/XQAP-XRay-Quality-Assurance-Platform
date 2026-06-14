import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeWriteJson } from "../storage/safeWrite";
import type { MonthFolderInfo } from "../population/monthFolder";

const POPULATION_FOLDER = "Population";
const SYSTEM_FOLDER = ".system";
const BACKUPS_FOLDER = "backups";

function backupFolderName(now: Date): string {
  const y = now.getFullYear();
  const mo = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const h = String(now.getHours()).padStart(2, "0");
  const m = String(now.getMinutes()).padStart(2, "0");
  const s = String(now.getSeconds()).padStart(2, "0");
  return `${y}-${mo}-${d}T${h}-${m}-${s}`;
}

export type BackupManifest = {
  createdAt: string;
  createdBy: string;
  monthsFolders: string[];
  filesBackedUp: string[];
};

const KEY_FILES = [
  "month.manifest.json",
  "sample/sample.master.json",
  "distribution.log.json",
  "distribution.current.json"
];

async function tryReadFile(
  dir: DirectoryHandleLike,
  path: string[]
): Promise<string | null> {
  try {
    let current = dir;
    for (let i = 0; i < path.length - 1; i++) {
      current = await current.getDirectoryHandle(path[i]!, { create: false });
    }
    const fileName = path[path.length - 1]!;
    const fh = await current.getFileHandle(fileName, { create: false });
    const file = await fh.getFile();
    return await file.text();
  } catch {
    return null;
  }
}

export async function createBackup(
  directoryHandle: DirectoryHandleLike,
  months: MonthFolderInfo[],
  username: string
): Promise<{ ok: true; folderName: string } | { ok: false; error: string }> {
  try {
    const now = new Date();
    const folderName = backupFolderName(now);

    const systemDir = await directoryHandle.getDirectoryHandle(
      SYSTEM_FOLDER,
      { create: true }
    );
    const backupsDir = await systemDir.getDirectoryHandle(BACKUPS_FOLDER, {
      create: true
    });
    const backupDir = await backupsDir.getDirectoryHandle(folderName, {
      create: true
    });

    const filesBackedUp: string[] = [];

    // Backup population folder structure
    const populationDir = await directoryHandle.getDirectoryHandle(
      POPULATION_FOLDER,
      { create: false }
    );

    for (const month of months) {
      let monthDir: DirectoryHandleLike;
      try {
        monthDir = await populationDir.getDirectoryHandle(month.folderName, {
          create: false
        });
      } catch {
        continue;
      }

      const monthBackupDir = await backupDir.getDirectoryHandle(
        month.folderName,
        { create: true }
      );

      for (const filePath of KEY_FILES) {
        const parts = filePath.split("/");
        const content = await tryReadFile(monthDir, parts);
        if (content && content !== "{}") {
          const fileName = parts[parts.length - 1]!;
          const fh = await monthBackupDir.getFileHandle(fileName, {
            create: true
          });
          if (!fh.createWritable) continue;
          const writable = await fh.createWritable();
          await writable.write(content);
          await writable.close();
          filesBackedUp.push(`${month.folderName}/${filePath}`);
        }
      }
    }

    const manifest: BackupManifest = {
      createdAt: now.toISOString(),
      createdBy: username,
      monthsFolders: months.map((m) => m.folderName),
      filesBackedUp
    };

    await safeWriteJson(backupDir, "backup.manifest.json", manifest);

    return { ok: true, folderName };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, error: msg };
  }
}

export type MonthArchiveStatus = {
  folderName: string;
  month: number;
  year: number;
  hasManifest: boolean;
  hasSample: boolean;
  hasDistribution: boolean;
  manifestStatus: string | null;
};

export async function loadArchiveStatus(
  directoryHandle: DirectoryHandleLike,
  months: MonthFolderInfo[]
): Promise<MonthArchiveStatus[]> {
  const statuses: MonthArchiveStatus[] = [];

  let populationDir: DirectoryHandleLike;
  try {
    populationDir = await directoryHandle.getDirectoryHandle(
      POPULATION_FOLDER,
      { create: false }
    );
  } catch {
    return statuses;
  }

  for (const month of months) {
    let monthDir: DirectoryHandleLike;
    try {
      monthDir = await populationDir.getDirectoryHandle(month.folderName, {
        create: false
      });
    } catch {
      statuses.push({
        folderName: month.folderName,
        month: month.month,
        year: month.year,
        hasManifest: false,
        hasSample: false,
        hasDistribution: false,
        manifestStatus: null
      });
      continue;
    }

    const manifestContent = await tryReadFile(monthDir, [
      "month.manifest.json"
    ]);
    const sampleContent = await tryReadFile(monthDir, [
      "sample",
      "sample.master.json"
    ]);
    const distContent = await tryReadFile(monthDir, [
      "distribution.current.json"
    ]);

    let manifestStatus: string | null = null;
    if (manifestContent && manifestContent !== "{}") {
      try {
        const parsed = JSON.parse(manifestContent) as { status?: string };
        manifestStatus = parsed.status ?? null;
      } catch {
        // ignore
      }
    }

    statuses.push({
      folderName: month.folderName,
      month: month.month,
      year: month.year,
      hasManifest: Boolean(manifestContent && manifestContent !== "{}"),
      hasSample: Boolean(sampleContent && sampleContent !== "{}"),
      hasDistribution: Boolean(distContent && distContent !== "{}"),
      manifestStatus
    });
  }

  return statuses;
}
