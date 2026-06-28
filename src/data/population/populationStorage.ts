import type { DirectoryHandleLike, FileHandleLike } from "../storage/fileSystemAccess";
import { safeWriteJson, safeReadJson } from "../storage/safeWrite";
import { logError } from "../storage/errorLogger";
import { formatMonthFolderName, parseMonthFolderName, type MonthFolderInfo } from "./monthFolder";
import type {
  MonthManifestData,
  MonthRawData,
  PopulationFinalData,
  ProcessingSummaryData,
  SourceFileMetadata,
} from "./monthTypes";
import type { SampleMasterData } from "../sampling/sampleTypes";
import type { DistributionCurrentData } from "../distribution/distributionTypes";
import { loadOrDeriveDistributionCurrent } from "../distribution/distributionStorage";
import {
  getPopulationMonthDir,
  getPopulationRoot,
  getSampleMainDir,
} from "../workspace/workspacePaths";

const CERTSCAN_GLOBAL_FILE = "certscan.global.json";

type DirectoryEntryLike = {
  name: string;
  kind: string;
};

function getDirectoryEntries(
  dir: DirectoryHandleLike
): AsyncIterable<DirectoryEntryLike> | null {
  const directory = dir as DirectoryHandleLike & {
    values?: () => AsyncIterable<DirectoryEntryLike>;
    entries?: () => AsyncIterable<[string, DirectoryEntryLike]>;
    [Symbol.asyncIterator]?: () => AsyncIterator<DirectoryEntryLike>;
  };

  if (typeof directory.values === "function") {
    return directory.values.call(directory);
  }

  if (typeof directory.entries === "function") {
    return {
      async *[Symbol.asyncIterator]() {
        for await (const [, entry] of directory.entries!.call(directory)) {
          yield entry;
        }
      }
    };
  }

  if (typeof directory[Symbol.asyncIterator] === "function") {
    return directory as AsyncIterable<DirectoryEntryLike>;
  }

  return null;
}

// ── Binary file helper ────────────────────────────────────────────────────────
async function saveBinaryFile(
  dir: DirectoryHandleLike,
  fileName: string,
  data: ArrayBuffer
): Promise<void> {
  try {
    const fileHandle: FileHandleLike = await dir.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable?.();
    if (!writable) return;
    // Native FileSystemWritableFileStream.write() accepts BufferSource — cast needed
    await (writable as unknown as { write: (d: unknown) => Promise<void> }).write(data);
    await writable.close();
  } catch (error) {
    logError("saveBinaryFile", error);
  }
}

// ── CertScan global persistence ───────────────────────────────────────────────
export async function saveCertScanGlobal(
  directoryHandle: DirectoryHandleLike,
  text: string
): Promise<void> {
  try {
    const populationDir = await getPopulationRoot(directoryHandle, true);
    await safeWriteJson(populationDir, CERTSCAN_GLOBAL_FILE, { text, updatedAt: new Date().toISOString() });
  } catch { /* ignore */ }
}

export async function loadCertScanGlobal(
  directoryHandle: DirectoryHandleLike
): Promise<string> {
  try {
    const populationDir = await getPopulationRoot(directoryHandle, false);
    const result = await safeReadJson<{ text: string }>(populationDir, CERTSCAN_GLOBAL_FILE);
    return result.ok ? (result.value?.text ?? "") : "";
  } catch { return ""; }
}

// ── Sampling proof ────────────────────────────────────────────────────────────
export type SamplingProof = {
  month: number;
  year: number;
  monthFolderName: string;
  drawnAt: string;
  drawnBy: string;
  rngSeed: string;
  samplingRules: unknown;
  portAllocations: unknown[];
  totalRequested: number;
  totalActual: number;
  certScanActual: number;
  nonCertScanActual: number;
};

export async function saveSamplingProof(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  proof: SamplingProof
): Promise<void> {
  try {
    const sampleDir = await getSampleMainDir(directoryHandle, monthFolderName, true);
    await safeWriteJson(sampleDir, "sampling-proof.json", proof);
  } catch { /* ignore */ }
}

export type SaveMonthRunParams = {
  directoryHandle: DirectoryHandleLike;
  month: number;
  year: number;
  username: string;
  riskFileName: string | null;
  biFileName: string | null;
  riskSourceFile?: File | null;
  biSourceFile?: File | null;
  certScanUsed: boolean;
  riskRawRows: Array<Record<string, unknown>>;
  biRawRows: Array<Record<string, unknown>>;
  processedRows: Array<Record<string, unknown>>;
  certScanRows: number;
  nonCertScanRows: number;
  processingSummary?: Omit<ProcessingSummaryData, "savedAt">;
  processingFingerprint?: string | null;
  sourceFiles?: {
    risk?: SourceFileMetadata | null;
    bi?: SourceFileMetadata | null;
  };
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

    // Ensure numbered population folder exists
    const populationDir = await getPopulationRoot(directoryHandle, true);

    // Create month folder and subfolders
    const monthDir = await ensureFolder(populationDir, monthFolderName);
    const rawDir = await ensureFolder(monthDir, "raw");
    const processedDir = await ensureFolder(monthDir, "processed");
    await ensureFolder(monthDir, "sample");
    await ensureFolder(monthDir, "reports");

    // Copy source xlsx files as-is
    if (params.riskSourceFile) {
      const buf = await params.riskSourceFile.arrayBuffer();
      const ext = params.riskSourceFile.name.split(".").pop() ?? "xlsx";
      await saveBinaryFile(rawDir, `risk.source.${ext}`, buf);
    }
    if (params.biSourceFile) {
      const buf = await params.biSourceFile.arrayBuffer();
      const ext = params.biSourceFile.name.split(".").pop() ?? "xlsx";
      await saveBinaryFile(rawDir, `bi.source.${ext}`, buf);
    }

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

    if (params.processingSummary) {
      const summaryData: ProcessingSummaryData = {
        ...params.processingSummary,
        savedAt: now,
      };
      await safeWriteJson(processedDir, "processing.summary.json", summaryData);
    }

    // Save month manifest
    const manifest: MonthManifestData = {
      monthFolderName,
      month,
      year,
      processedAt: now,
      processedBy: username,
      runnedAt: now,
      runnedBy: username,
      riskFileName,
      biFileName,
      certScanUsed,
      templateVersion: null,
      rngSeed: null,
      totalRawRows: riskRawRows.length,
      totalProcessedRows: processedRows.length,
      status: "processed-saved",
      processingFingerprint: params.processingFingerprint ?? null,
      processingSummaryFile: params.processingSummary ? "processed/processing.summary.json" : null,
      sourceFiles: params.sourceFiles
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
    const populationDir = await getPopulationRoot(directoryHandle, false);

    const results: MonthFolderInfo[] = [];
    const iterable = getDirectoryEntries(populationDir);

    if (!iterable) {
      return results;
    }

    for await (const entry of iterable) {
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
  } catch (error) {
    logError("listMonthFolders", error);
    return [];
  }
}

export type MonthSummary = {
  info: MonthFolderInfo;
  manifest: MonthManifestData | null;
  hasPopulation: boolean;
  hasSample: boolean;
  hasDistribution: boolean;
  totalProcessedRows: number;
};

async function resolveSampleDir(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  monthDir: DirectoryHandleLike
): Promise<DirectoryHandleLike | null> {
  try {
    return await getSampleMainDir(directoryHandle, monthFolderName, false);
  } catch {
    try {
      return await monthDir.getDirectoryHandle("sample", { create: false });
    } catch {
      return null;
    }
  }
}

export async function listMonthSummaries(
  directoryHandle: DirectoryHandleLike
): Promise<MonthSummary[]> {
  const infos = await listMonthFolders(directoryHandle);

  let populationDir: DirectoryHandleLike;
  try {
    populationDir = await getPopulationRoot(directoryHandle, false);
  } catch { return []; }

  const settled = await Promise.allSettled(
    infos.map(async (info) => {
      const monthDir = await populationDir.getDirectoryHandle(
        info.folderName, { create: false }
      );

      const manifestResult = await safeReadJson<MonthManifestData>(
        monthDir, "month.manifest.json"
      );
      const manifest = manifestResult.ok ? manifestResult.value : null;

      let hasPopulation = false;
      let totalProcessedRows = manifest?.totalProcessedRows ?? 0;
      try {
        const processedDir = await monthDir.getDirectoryHandle("processed", { create: false });
        const popResult = await safeReadJson<PopulationFinalData>(processedDir, "population.final.json");
        hasPopulation = popResult.ok;
        if (popResult.ok) totalProcessedRows = popResult.value.totalRows;
      } catch { /* directory missing */ }

      let hasSample = false;
      {
        const sampleDir = await resolveSampleDir(directoryHandle, info.folderName, monthDir);
        if (sampleDir) {
          const sResult = await safeReadJson<SampleMasterData>(sampleDir, "sample.master.json");
          hasSample = sResult.ok;
        }
      }

      let hasDistribution = false;
      try {
        const sampleDir = await getSampleMainDir(directoryHandle, info.folderName, false);
        const dResult = await safeReadJson<DistributionCurrentData>(sampleDir, "distribution.current.json");
        hasDistribution = dResult.ok;
      } catch {
        try {
          const dResult = await safeReadJson<DistributionCurrentData>(monthDir, "distribution.current.json");
          hasDistribution = dResult.ok;
        } catch { /* file missing */ }
      }

      return { info, manifest, hasPopulation, hasSample, hasDistribution, totalProcessedRows };
    })
  );

  const results: MonthSummary[] = settled
    .filter((r): r is PromiseFulfilledResult<MonthSummary> => r.status === "fulfilled")
    .map((r) => r.value);

  // newest first
  return results.reverse();
}

// ── Aggregate all months for the browse view ──────────────────────────────────
export type BrowseRow = Record<string, unknown> & {
  _monthFolder: string;
  _month: number;
  _year: number;
};

export type BrowseDatasetKind = "population" | "sample" | "risk-raw" | "bi-raw";

async function getMonthDir(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<DirectoryHandleLike> {
  return getPopulationMonthDir(directoryHandle, monthFolderName, false);
}

function appendMonthInfo(
  row: Record<string, unknown>,
  info: MonthFolderInfo
): BrowseRow {
  return {
    ...row,
    _monthFolder: info.folderName,
    _month: info.month,
    _year: info.year
  };
}

export async function loadAllPopulationRows(
  directoryHandle: DirectoryHandleLike
): Promise<BrowseRow[]> {
  const months = await listMonthFolders(directoryHandle);
  const seen = new Map<string, BrowseRow>(); // xrayImageId → latest row

  for (const info of months) {
    try {
      const monthDir = await getMonthDir(directoryHandle, info.folderName);
      const processedDir = await monthDir.getDirectoryHandle("processed", { create: false });
      const result = await safeReadJson<{ rows: Array<Record<string, unknown>> }>(processedDir, "population.final.json");
      if (!result.ok) continue;
      for (const row of result.value.rows ?? []) {
        const id = String(row["xrayImageId"] ?? "");
        if (!id) continue;
        seen.set(id, appendMonthInfo(row, info));
      }
    } catch (error) {
      logError("loadAllPopulationRows", error);
    }
  }

  return [...seen.values()];
}

export async function loadMonthPopulationFinal(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<PopulationFinalData | null> {
  try {
    const monthDir = await getMonthDir(directoryHandle, monthFolderName);
    const processedDir = await monthDir.getDirectoryHandle("processed", { create: false });
    const result = await safeReadJson<PopulationFinalData>(
      processedDir,
      "population.final.json"
    );
    return result.ok ? result.value : null;
  } catch {
    return null;
  }
}

export async function loadAllSampleRows(
  directoryHandle: DirectoryHandleLike
): Promise<BrowseRow[]> {
  const months = await listMonthFolders(directoryHandle);
  const rows: BrowseRow[] = [];

  for (const info of months) {
    try {
      const monthDir = await getMonthDir(directoryHandle, info.folderName);
      const sampleDir = await resolveSampleDir(directoryHandle, info.folderName, monthDir);
      if (!sampleDir) continue;
      const result = await safeReadJson<{ rows: Array<Record<string, unknown>> }>(
        sampleDir,
        "sample.master.json"
      );
      if (!result.ok) continue;
      rows.push(...(result.value.rows ?? []).map((row) => appendMonthInfo(row, info)));
    } catch { /* skip inaccessible */ }
  }

  return rows;
}

export async function loadAllRawRows(
  directoryHandle: DirectoryHandleLike,
  source: "risk" | "bi"
): Promise<BrowseRow[]> {
  const months = await listMonthFolders(directoryHandle);
  const rows: BrowseRow[] = [];
  const fileName = source === "risk" ? "risk.raw.json" : "bi.raw.json";

  for (const info of months) {
    try {
      const monthDir = await getMonthDir(directoryHandle, info.folderName);
      const rawDir = await monthDir.getDirectoryHandle("raw", { create: false });
      const result = await safeReadJson<{ rows: Array<Record<string, unknown>> }>(
        rawDir,
        fileName
      );
      if (!result.ok) continue;
      rows.push(...(result.value.rows ?? []).map((row) => appendMonthInfo(row, info)));
    } catch { /* skip inaccessible */ }
  }

  return rows;
}

export async function loadBrowseRows(
  directoryHandle: DirectoryHandleLike,
  dataset: BrowseDatasetKind
): Promise<BrowseRow[]> {
  if (dataset === "sample") {
    return loadAllSampleRows(directoryHandle);
  }
  if (dataset === "risk-raw") {
    return loadAllRawRows(directoryHandle, "risk");
  }
  if (dataset === "bi-raw") {
    return loadAllRawRows(directoryHandle, "bi");
  }
  return loadAllPopulationRows(directoryHandle);
}

export type MonthEditData = {
  populationRows: Array<Record<string, unknown>> | null;
  certScanRows: number;
  nonCertScanRows: number;
  riskRawRows: Array<Record<string, unknown>>;
  biRawRows: Array<Record<string, unknown>>;
  processingSummary: ProcessingSummaryData | null;
  sampleData: SampleMasterData | null;
  distributionCurrent: DistributionCurrentData | null;
  manifest: MonthManifestData | null;
};

export async function loadMonthForEditing(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<MonthEditData> {
  const empty: MonthEditData = {
    populationRows: null,
    certScanRows: 0,
    nonCertScanRows: 0,
    riskRawRows: [],
    biRawRows: [],
    processingSummary: null,
    sampleData: null,
    distributionCurrent: null,
    manifest: null
  };

  try {
    const monthDir = await getPopulationMonthDir(directoryHandle, monthFolderName, false);

    const [manifestResult, popBundle, summaryBundle, rawBundle, sampleBundle] = await Promise.all([
      safeReadJson<MonthManifestData>(monthDir, "month.manifest.json"),
      monthDir.getDirectoryHandle("processed", { create: false })
        .then((dir) => safeReadJson<PopulationFinalData>(dir, "population.final.json"))
        .catch(() => null),
      monthDir.getDirectoryHandle("processed", { create: false })
        .then((dir) => safeReadJson<ProcessingSummaryData>(dir, "processing.summary.json"))
        .catch(() => null),
      monthDir.getDirectoryHandle("raw", { create: false })
        .then(async (dir) => {
          const [risk, bi] = await Promise.all([
            safeReadJson<MonthRawData>(dir, "risk.raw.json"),
            safeReadJson<MonthRawData>(dir, "bi.raw.json"),
          ]);
          return { risk, bi };
        })
        .catch(() => null),
      resolveSampleDir(directoryHandle, monthFolderName, monthDir)
        .then((dir) =>
          dir ? safeReadJson<SampleMasterData>(dir, "sample.master.json") : null
        ),
    ]);

    const manifest = manifestResult?.ok ? manifestResult.value : null;

    let populationRows: Array<Record<string, unknown>> | null = null;
    let certScanRows = 0;
    let nonCertScanRows = 0;
    if (popBundle?.ok) {
      populationRows = popBundle.value.rows;
      certScanRows = popBundle.value.certScanRows;
      nonCertScanRows = popBundle.value.nonCertScanRows;
    }

    const riskRawRows: Array<Record<string, unknown>> =
      rawBundle?.risk?.ok ? (rawBundle.risk.value.rows ?? []) : [];
    const biRawRows: Array<Record<string, unknown>> =
      rawBundle?.bi?.ok ? (rawBundle.bi.value.rows ?? []) : [];

    const processingSummary: ProcessingSummaryData | null =
      summaryBundle?.ok ? summaryBundle.value : null;

    const sampleData: SampleMasterData | null =
      sampleBundle?.ok ? sampleBundle.value : null;

    const distributionCurrent: DistributionCurrentData | null = sampleData
      ? await loadOrDeriveDistributionCurrent(
          directoryHandle,
          monthFolderName,
          sampleData.rows
        )
      : null;

    return {
      populationRows,
      certScanRows,
      nonCertScanRows,
      riskRawRows,
      biRawRows,
      processingSummary,
      sampleData,
      distributionCurrent,
      manifest
    };
  } catch {
    return empty;
  }
}
