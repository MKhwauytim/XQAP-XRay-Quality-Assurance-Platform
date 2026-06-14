import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeWriteJson } from "../storage/safeWrite";
import { formatMonthFolderName, parseMonthFolderName, type MonthFolderInfo } from "./monthFolder";
import type { MonthManifestData, MonthRawData, PopulationFinalData } from "./monthTypes";

const POPULATION_FOLDER = "Population";

export type SaveMonthRunParams = {
  directoryHandle: DirectoryHandleLike;
  month: number;
  year: number;
  username: string;
  riskFileName: string | null;
  biFileName: string | null;
  certScanUsed: boolean;
  riskRawRows: Array<Record<string, unknown>>;
  biRawRows: Array<Record<string, unknown>>;
  processedRows: Array<Record<string, unknown>>;
  certScanRows: number;
  nonCertScanRows: number;
};

export type SaveMonthRunResult = {
  ok: true;
  monthFolderName: string;
} | {
  ok: false;
  error: string;
};

async function ensureFolder(
  parent: DirectoryHandleLike,
  name: string
): Promise<DirectoryHandleLike> {
  return parent.getDirectoryHandle(name, { create: true });
}

export async function saveMonthRun(
  params: SaveMonthRunParams
): Promise<SaveMonthRunResult> {
  try {
    const {
      directoryHandle,
      month,
      year,
      username,
      riskFileName,
      biFileName,
      certScanUsed,
      riskRawRows,
      biRawRows,
      processedRows,
      certScanRows,
      nonCertScanRows
    } = params;

    const monthFolderName = formatMonthFolderName(month, year);
    const now = new Date().toISOString();

    // Ensure Population/ folder exists
    const populationDir = await ensureFolder(directoryHandle, POPULATION_FOLDER);

    // Create month folder and subfolders
    const monthDir = await ensureFolder(populationDir, monthFolderName);
    const rawDir = await ensureFolder(monthDir, "raw");
    const processedDir = await ensureFolder(monthDir, "processed");
    await ensureFolder(monthDir, "sample");
    await ensureFolder(monthDir, "reports");

    // Save risk raw JSON
    if (riskRawRows.length > 0) {
      const riskRaw: MonthRawData = {
        sourceFileName: riskFileName ?? "unknown",
        importedAt: now,
        importedBy: username,
        rows: riskRawRows
      };
      await safeWriteJson(rawDir, "risk.raw.json", riskRaw);
    }

    // Save BI raw JSON
    if (biRawRows.length > 0) {
      const biRaw: MonthRawData = {
        sourceFileName: biFileName ?? "unknown",
        importedAt: now,
        importedBy: username,
        rows: biRawRows
      };
      await safeWriteJson(rawDir, "bi.raw.json", biRaw);
    }

    // Save processed population
    const finalData: PopulationFinalData = {
      sourceMonthFolder: monthFolderName,
      processedAt: now,
      processedBy: username,
      totalRows: processedRows.length,
      certScanRows,
      nonCertScanRows,
      rows: processedRows
    };
    await safeWriteJson(processedDir, "population.final.json", finalData);

    // Save month manifest
    const manifest: MonthManifestData = {
      monthFolderName,
      month,
      year,
      runnedAt: now,
      runnedBy: username,
      riskFileName,
      biFileName,
      certScanUsed,
      templateVersion: null,
      rngSeed: null,
      totalRawRows: riskRawRows.length,
      totalProcessedRows: processedRows.length,
      status: "processed-saved"
    };
    await safeWriteJson(monthDir, "month.manifest.json", manifest);

    return { ok: true, monthFolderName };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error during save";
    return { ok: false, error: message };
  }
}

export async function listMonthFolders(
  directoryHandle: DirectoryHandleLike
): Promise<MonthFolderInfo[]> {
  try {
    const populationDir = await directoryHandle.getDirectoryHandle(
      POPULATION_FOLDER,
      { create: false }
    );

    const results: MonthFolderInfo[] = [];
    const entries = (populationDir as unknown as {
      values?: () => AsyncIterable<{ name: string; kind: string }>;
    }).values;

    if (!entries) {
      return results;
    }

    for await (const entry of entries.call(populationDir as unknown as { values: () => AsyncIterable<{ name: string; kind: string }> })) {
      if (entry.kind !== "directory") {
        continue;
      }
      const info = parseMonthFolderName(entry.name);
      if (info) {
        results.push(info);
      }
    }

    return results.sort((a, b) => {
      if (a.year !== b.year) {
        return a.year - b.year;
      }
      return a.month - b.month;
    });
  } catch {
    return [];
  }
}
