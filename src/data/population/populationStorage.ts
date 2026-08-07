import type { DirectoryHandleLike, FileHandleLike } from "../storage/fileSystemAccess";
import {
  safeWriteJson,
  safeWriteJsonText,
  safeReadJson,
  readEnvelopeRevision,
  readFileTextWithRetry,
  type SafeWriteProgressPhase,
} from "../storage/safeWrite";
import { casLoop } from "../storage/casLoop";
import { mapWithConcurrency } from "../storage/concurrency";
import { withResourceLock } from "../storage/webLocks";
import { withWorkspaceWriteAccess } from "../storage/workspaceWriteAccess";
import { logError } from "../storage/errorLogger";
import { ensureMonthWritable, manifestLockKey } from "./monthLock";
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
import { loadSampleMaster } from "../sampling/sampleStorage";
import { loadPopulationConfig } from "./populationConfig";
import { rebuildReplacementIndex } from "./replacementIndexStorage";
import type { PreparedPopulationRow } from "./populationTypes";
import {
  getPopulationMonthDir,
  getPopulationRoot,
  getSampleMainDir,
  POPULATION_SUBFOLDERS,
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
  await ensureMonthWritable(directoryHandle, monthFolderName);
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
  /**
   * When false/undefined, saveMonthRun re-checks (under the manifest lock) that
   * no sample was drawn for this month before overwriting the population; if one
   * appeared it aborts with `sampleExists: true` so the caller can prompt for
   * confirmation. Pass true once the user has explicitly confirmed the overwrite.
   */
  confirmedOverwrite?: boolean;
  /**
   * B task 2 — optional observability hook for the largest write in this batch
   * (population.final.json, the one most likely to run 10-15 minutes on a big
   * population). Fired with the safeWriteJson phase so the Population save UI
   * can show progress past the point where processPopulation's own (in-memory,
   * already-100%) progress bar would otherwise go silent. Optional: omitting it
   * changes nothing about the write itself.
   */
  onSaveProgress?: (phase: SafeWriteProgressPhase) => void;
};

export type SaveMonthRunResult = {
  ok: true;
  monthFolderName: string;
} | {
  ok: false;
  error: string;
  /** Set when the abort was caused by a sample that appeared since the pre-check (TOCTOU). */
  sampleExists?: true;
};

async function ensureFolder(
  parent: DirectoryHandleLike,
  name: string
): Promise<DirectoryHandleLike> {
  return parent.getDirectoryHandle(name, { create: true });
}

/**
 * Immutable raw layer (A5). If `{base}.raw.json` already exists in `rawDir`, copy
 * it verbatim to `{base}.raw.{ISO-ts}.superseded.json` (colons stripped from the
 * timestamp for filename safety) before it is overwritten, so the prior import is
 * never silently lost. Returns the archived file name (to stamp `supersedes` on
 * the new file), or null when there was nothing to supersede.
 *
 * Best-effort by contract: an archival failure is logged and returns null rather
 * than aborting the whole save — the re-import still proceeds, and A5's guarantee
 * degrades to "no archive this time" instead of blocking data entry.
 */
async function archiveExistingRaw(
  rawDir: DirectoryHandleLike,
  base: "risk" | "bi"
): Promise<string | null> {
  const liveName = `${base}.raw.json`;
  try {
    const existing = await safeReadJson<MonthRawData>(rawDir, liveName);
    if (!existing.ok) return null;
    const stamp = new Date().toISOString().replace(/:/g, "");
    const archiveName = `${base}.raw.${stamp}.superseded.json`;
    // Preserve the prior file's exact bytes (including its own `supersedes`
    // chain) rather than re-wrapping — the archive is the original record.
    await safeWriteJsonText(rawDir, archiveName, existing.rawText);
    return archiveName;
  } catch (error) {
    logError("population:archive-raw", error);
    return null;
  }
}

export async function saveMonthRun(
  params: SaveMonthRunParams
): Promise<SaveMonthRunResult> {
  const monthFolderName = formatMonthFolderName(params.month, params.year);
  // Month lock gate — rejects with MonthClosedError when the month is closed.
  await ensureMonthWritable(params.directoryHandle, monthFolderName);

  // Serialize the 5-file write against updateMonthStatus / closeMonth / reopenMonth
  // and any concurrent same-browser save (shared `manifestLockKey`). The final
  // manifest write inside safeWriteJson uses its own file-scoped key, distinct
  // from this `:rmw` lock, so there is no self-deadlock.
  return withResourceLock(manifestLockKey(monthFolderName), () =>
    saveMonthRunLocked(params, monthFolderName)
  );
}

async function saveMonthRunLocked(
  params: SaveMonthRunParams,
  monthFolderName: string
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
      nonCertScanRows,
      confirmedOverwrite,
    } = params;

    // TOCTOU guard: re-check under the lock that no sample was drawn since the
    // caller's pre-check. Overwriting the population while a sample exists would
    // orphan that sample — abort and let the caller confirm.
    if (!confirmedOverwrite) {
      const existingSample = await loadSampleMaster(directoryHandle, monthFolderName);
      if (existingSample) {
        return {
          ok: false,
          error: `يوجد سحب عينة لهذا الشهر (${monthFolderName}) — تأكيد الاستبدال مطلوب قبل إعادة الحفظ.`,
          sampleExists: true,
        };
      }
    }

    const now = new Date().toISOString();

    // A remembered workspace (PR #36) opens with read permission only — request
    // write access here, before the first folder is created, instead of letting
    // a raw NotAllowedError surface from deep inside ensureFolder/saveBinaryFile.
    return await withWorkspaceWriteAccess(directoryHandle, async () => {
      // Ensure numbered population folder exists
      const populationDir = await getPopulationRoot(directoryHandle, true);

      // Create month folder and subfolders
      const monthDir = await ensureFolder(populationDir, monthFolderName);
      const rawDir = await ensureFolder(monthDir, POPULATION_SUBFOLDERS.raw);
      const processedDir = await ensureFolder(monthDir, POPULATION_SUBFOLDERS.processed);
      await ensureFolder(monthDir, "sample");
      await ensureFolder(monthDir, "reports");

      // Copy source xlsx files and write raw JSON — these four writes target
      // disjoint files with no data dependency on each other, so they run
      // concurrently. Each conditional branch is wrapped in an IIFE so
      // Promise.all can await a uniform array regardless of which conditions
      // are true.
      await Promise.all([
        (async () => {
          if (!params.riskSourceFile) return;
          const buf = await params.riskSourceFile.arrayBuffer();
          const ext = params.riskSourceFile.name.split(".").pop() ?? "xlsx";
          await saveBinaryFile(rawDir, `risk.source.${ext}`, buf);
        })(),
        (async () => {
          if (!params.biSourceFile) return;
          const buf = await params.biSourceFile.arrayBuffer();
          const ext = params.biSourceFile.name.split(".").pop() ?? "xlsx";
          await saveBinaryFile(rawDir, `bi.source.${ext}`, buf);
        })(),
        (async () => {
          if (riskRawRows.length === 0) return;
          const supersedes = await archiveExistingRaw(rawDir, "risk");
          const riskRaw: MonthRawData = {
            sourceFileName: riskFileName ?? "unknown",
            importedAt: now,
            importedBy: username,
            supersedes,
            rows: riskRawRows
          };
          await safeWriteJson(rawDir, "risk.raw.json", riskRaw);
        })(),
        (async () => {
          if (biRawRows.length === 0) return;
          const supersedes = await archiveExistingRaw(rawDir, "bi");
          const biRaw: MonthRawData = {
            sourceFileName: biFileName ?? "unknown",
            importedAt: now,
            importedBy: username,
            supersedes,
            rows: biRawRows
          };
          await safeWriteJson(rawDir, "bi.raw.json", biRaw);
        })(),
      ]);

      // Save processed population. Must complete before the replacement-index
      // rebuild below, which reads this file's envelope revision back.
      const finalData: PopulationFinalData = {
        sourceMonthFolder: monthFolderName,
        processedAt: now,
        processedBy: username,
        totalRows: processedRows.length,
        certScanRows,
        nonCertScanRows,
        rows: processedRows
      };
      await safeWriteJson(processedDir, "population.final.json", finalData, params.onSaveProgress);

      await Promise.all([
        (async () => {
          // Best-effort, non-fatal: a replacement-candidate lookup index
          // (deliberate exception to the pending large-population performance
          // proposal's phase sequence — see docs/edit logs/2026-07-22.md
          // v59.0). Its failure must never sink an otherwise-successful
          // population save; the replacement flow falls back to a
          // full-population read when the index is missing or stale.
          try {
            const sourceRevision = await readEnvelopeRevision(processedDir, "population.final.json");
            if (sourceRevision !== null) {
              const config = await loadPopulationConfig(directoryHandle);
              await rebuildReplacementIndex(
                directoryHandle,
                monthFolderName,
                processedRows as PreparedPopulationRow[],
                config.stageMappings,
                sourceRevision,
                username
              );
            }
          } catch (error) {
            logError("population:rebuild-replacement-index", error);
          }
        })(),
        (async () => {
          if (!params.processingSummary) return;
          const summaryData: ProcessingSummaryData = {
            ...params.processingSummary,
            savedAt: now,
          };
          await safeWriteJson(processedDir, "processing.summary.json", summaryData);
        })(),
      ]);

      // Save month manifest — must be last: it records totals/paths that
      // depend on every write above having committed.
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
        processingSummaryFile: params.processingSummary
          ? `${POPULATION_SUBFOLDERS.processed}/processing.summary.json`
          : null,
        sourceFiles: params.sourceFiles
      };
      await safeWriteJson(monthDir, "month.manifest.json", manifest);

      return { ok: true, monthFolderName };
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error during save";
    return { ok: false, error: message };
  }
}

const STATUS_RANK: Record<MonthManifestData["status"], number> = {
  "raw-saved": 0,
  "processed-saved": 1,
  sampled: 2,
  distributed: 3,
  closed: 4,
};

/**
 * Advance the month manifest status (monotonic — never downgrades).
 * Best-effort: failures are logged to the error ring buffer, never thrown.
 */
export async function updateMonthStatus(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  status: MonthManifestData["status"]
): Promise<void> {
  try {
    // Shared, multi-writer file: two PCs can advance the same month's status
    // near-simultaneously. The `:rmw` outer lock serializes same-tab writers;
    // casLoop's revision + _writeToken read-back guards cross-machine races so a
    // monotonic advance is never lost to a stale overwrite. `manifestLockKey` is
    // shared with monthLock.closeMonth/reopenMonth so all three writers to this
    // manifest run in one protocol (finding S3). Best-effort: a persistent
    // conflict is logged, never thrown.
    const result = await withResourceLock(
      manifestLockKey(monthFolderName),
      () =>
        casLoop<{ ok: true }>(
          async (writeToken) => {
            let monthDir: DirectoryHandleLike;
            try {
              monthDir = await getPopulationMonthDir(directoryHandle, monthFolderName, false);
            } catch {
              // Month folder does not exist — nothing to advance; not a conflict.
              return { done: true, result: { ok: true as const } };
            }
            const manifestResult = await safeReadJson<MonthManifestData>(monthDir, "month.manifest.json");
            if (!manifestResult.ok) return { done: true, result: { ok: true as const } };
            const manifest = manifestResult.value;
            // A closed month is frozen: status advancement must never overwrite it
            // ("closed" is deliberately NOT in STATUS_RANK — see monthLock.ts).
            if (manifest.status === "closed") return { done: true, result: { ok: true as const } };
            const currentRank = STATUS_RANK[manifest.status] ?? -1;
            if (currentRank >= STATUS_RANK[status]) return { done: true, result: { ok: true as const } };
            const nextRevision = (manifest.revision ?? 0) + 1;
            await safeWriteJson(monthDir, "month.manifest.json", {
              ...manifest,
              status,
              revision: nextRevision,
              _writeToken: writeToken,
            });
            const verifyResult = await safeReadJson<MonthManifestData>(monthDir, "month.manifest.json");
            if (
              verifyResult.ok &&
              verifyResult.value.revision === nextRevision &&
              verifyResult.value._writeToken === writeToken
            ) {
              return { done: true, result: { ok: true as const } };
            }
            return { done: false };
          },
          { maxRetries: 5, baseDelayMs: 50, conflictError: "manifest status update conflict" }
        )
    );
    if (!result.ok) {
      logError("population:update-month-status", new Error(result.error));
    }
  } catch (error) {
    logError("population:update-month-status", error);
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

  // Index-addressed via mapWithConcurrency (budget 4 -- each read here is a
  // full population.final.json, heavier than loadArchiveStatus's per-employee
  // files, so this stays below its 4-8 range at 4) so the fold below still
  // walks months in listMonthFolders' chronological order -- and therefore a
  // later month still overwrites an earlier month's duplicate xrayImageId in
  // `seen` -- regardless of which month's file read actually finishes first.
  // See populationStorage.test.ts's "the chronologically later month wins..."
  // characterization test.
  const perMonthRows = await mapWithConcurrency(months, 4, async (info): Promise<BrowseRow[]> => {
    try {
      const monthDir = await getMonthDir(directoryHandle, info.folderName);
      const processedDir = await monthDir.getDirectoryHandle(POPULATION_SUBFOLDERS.processed, { create: false });
      const result = await safeReadJson<{ rows: Array<Record<string, unknown>> }>(processedDir, "population.final.json");
      if (!result.ok) return [];
      return (result.value.rows ?? []).map((row) => appendMonthInfo(row, info));
    } catch (error) {
      logError("loadAllPopulationRows", error);
      return [];
    }
  });

  for (const monthRows of perMonthRows) {
    for (const row of monthRows) {
      const id = String(row["xrayImageId"] ?? "");
      if (!id) continue;
      seen.set(id, row);
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
    const processedDir = await monthDir.getDirectoryHandle(POPULATION_SUBFOLDERS.processed, { create: false });
    const result = await safeReadJson<PopulationFinalData>(
      processedDir,
      "population.final.json"
    );
    return result.ok ? result.value : null;
  } catch {
    return null;
  }
}

/**
 * Raw (unparsed) file text of `population.final.json` -- the worker-owned Population
 * Browse query path (Phase B, large-population perf proposal) hands this straight to
 * `usePopulationBrowseWorker().loadRawJson` so the MAIN thread never runs `JSON.parse`
 * over what can be a 200k-400k row file; only the dedicated query worker
 * (`src/workers/populationQueryWorker.ts`) parses it, off the main thread.
 *
 * Deliberately does NOT reuse `safeReadJson` here: `safeReadJson` also returns
 * `rawText`, but it gets there by calling `unwrap(JSON.parse(...))` first -- i.e. it
 * already pays the exact main-thread parse cost this accessor exists to avoid. This
 * calls the lower-level `readFileTextWithRetry` (text-only, no parse) instead.
 *
 * Returns null when the file doesn't exist yet (e.g. an unprocessed/pending month),
 * matching `loadMonthPopulationFinal`'s null-on-missing contract.
 *
 * Recovery ladder (I1): skipping `safeReadJson` also skipped its `.bak` -> `.tmp`
 * fallback, so a lost/unreadable live file degraded straight to "no data" even with
 * a perfectly good snapshot sitting next to it. The ladder below restores the SPIRIT
 * of that recovery at raw-text level: live -> `.bak` -> `.tmp`, same order
 * `safeReadJson` uses. DELIBERATE, DOCUMENTED GAP: `safeReadJson` also falls back
 * when the live file is present but *unparseable*, and validates the envelope's
 * contentHash — both require a `JSON.parse` of the whole file on the main thread,
 * which is the exact cost this accessor exists to avoid. So a present-but-corrupt
 * live file is still handed to the worker as-is; the worker's parse fails, it
 * answers with an "error" response, and `BrowseDataView` surfaces that to the user
 * (rather than spinning forever, which is what it used to do).
 */
export async function loadMonthPopulationFinalRawText(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<string | null> {
  try {
    const monthDir = await getMonthDir(directoryHandle, monthFolderName);
    const processedDir = await monthDir.getDirectoryHandle(POPULATION_SUBFOLDERS.processed, { create: false });

    for (const candidate of [
      "population.final.json",
      "population.final.json.bak",
      "population.final.json.tmp"
    ]) {
      try {
        const text = await readFileTextWithRetry(processedDir, candidate);
        // A zero-byte torn write (a live file caught mid-safeWriteJson) reads back
        // as "" rather than null -- treat it the same as a missing rung so the
        // ladder still falls through to .bak/.tmp instead of handing the worker an
        // empty string it can only fail to parse.
        if (text !== null && text.trim() !== "") {
          return text;
        }
      } catch {
        // A read that fails outright (permissions, exhausted NotReadableError
        // retries) is treated the same as a missing file HERE, and only here:
        // the next rung of the ladder may still hold a usable copy. If every
        // rung fails the caller still gets null, exactly as before.
      }
    }

    return null;
  } catch {
    return null;
  }
}

/** Envelope revision of `population.final.json` for report-to-revision linkage (B2). */
export async function loadMonthPopulationFinalRevision(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<number | null> {
  try {
    const monthDir = await getMonthDir(directoryHandle, monthFolderName);
    const processedDir = await monthDir.getDirectoryHandle(POPULATION_SUBFOLDERS.processed, { create: false });
    return await readEnvelopeRevision(processedDir, "population.final.json");
  } catch {
    return null;
  }
}

export async function loadAllSampleRows(
  directoryHandle: DirectoryHandleLike
): Promise<BrowseRow[]> {
  const months = await listMonthFolders(directoryHandle);

  // Index-addressed via mapWithConcurrency (budget 4) so the flat
  // concatenation below still walks months in listMonthFolders' chronological
  // order, regardless of which month's sample.master.json read actually
  // finishes first. See populationStorage.test.ts's "rows stay in
  // month-chronological order..." characterization test.
  const perMonthRows = await mapWithConcurrency(months, 4, async (info): Promise<BrowseRow[]> => {
    try {
      const monthDir = await getMonthDir(directoryHandle, info.folderName);
      const sampleDir = await resolveSampleDir(directoryHandle, info.folderName, monthDir);
      if (!sampleDir) return [];
      const result = await safeReadJson<{ rows: Array<Record<string, unknown>> }>(
        sampleDir,
        "sample.master.json"
      );
      if (!result.ok) return [];
      return (result.value.rows ?? []).map((row) => appendMonthInfo(row, info));
    } catch {
      return [];
    }
  });

  return perMonthRows.flat();
}

export async function loadAllRawRows(
  directoryHandle: DirectoryHandleLike,
  source: "risk" | "bi"
): Promise<BrowseRow[]> {
  const months = await listMonthFolders(directoryHandle);
  const fileName = source === "risk" ? "risk.raw.json" : "bi.raw.json";

  // Index-addressed via mapWithConcurrency (budget 4) -- same ordering
  // rationale as loadAllSampleRows above.
  const perMonthRows = await mapWithConcurrency(months, 4, async (info): Promise<BrowseRow[]> => {
    try {
      const monthDir = await getMonthDir(directoryHandle, info.folderName);
      const rawDir = await monthDir.getDirectoryHandle(POPULATION_SUBFOLDERS.raw, { create: false });
      const result = await safeReadJson<{ rows: Array<Record<string, unknown>> }>(
        rawDir,
        fileName
      );
      if (!result.ok) return [];
      return (result.value.rows ?? []).map((row) => appendMonthInfo(row, info));
    } catch {
      return [];
    }
  });

  return perMonthRows.flat();
}

export async function loadBrowseRows(
  directoryHandle: DirectoryHandleLike,
  dataset: BrowseDatasetKind,
  monthFolderName?: string
): Promise<BrowseRow[]> {
  if (monthFolderName) {
    const info = parseMonthFolderName(monthFolderName);
    if (!info) return [];

    if (dataset === "sample") {
      const sample = await loadSampleMaster(directoryHandle, monthFolderName);
      return (sample?.rows ?? []).map((row) => appendMonthInfo(row, info));
    }

    if (dataset === "population") {
      const population = await loadMonthPopulationFinal(directoryHandle, monthFolderName);
      return (population?.rows ?? []).map((row) => appendMonthInfo(row, info));
    }

    try {
      const monthDir = await getMonthDir(directoryHandle, monthFolderName);
      const rawDir = await monthDir.getDirectoryHandle(POPULATION_SUBFOLDERS.raw, { create: false });
      const fileName = dataset === "risk-raw" ? "risk.raw.json" : "bi.raw.json";
      const result = await safeReadJson<{ rows: Array<Record<string, unknown>> }>(rawDir, fileName);
      return result.ok ? (result.value.rows ?? []).map((row) => appendMonthInfo(row, info)) : [];
    } catch {
      return [];
    }
  }

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

// ── Focused loaders (Large-Population Performance Proposal, Phase A step 1) ────
// Each is independently callable and independently fault-tolerant (a read
// failure for one never blanks another's result) -- the property Phase A's
// upcoming opt-in MonthLoadScope needs to fetch only what a screen actually
// requires. loadMonthForEditing (below) composes all five and must remain
// byte-identical to its pre-extraction output for every existing caller.

export async function loadMonthManifest(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<MonthManifestData | null> {
  try {
    const monthDir = await getPopulationMonthDir(directoryHandle, monthFolderName, false);
    const result = await safeReadJson<MonthManifestData>(monthDir, "month.manifest.json");
    return result.ok ? result.value : null;
  } catch {
    return null;
  }
}

export async function loadProcessingSummary(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<ProcessingSummaryData | null> {
  try {
    const monthDir = await getPopulationMonthDir(directoryHandle, monthFolderName, false);
    const processedDir = await monthDir.getDirectoryHandle(POPULATION_SUBFOLDERS.processed, { create: false });
    const result = await safeReadJson<ProcessingSummaryData>(processedDir, "processing.summary.json");
    return result.ok ? result.value : null;
  } catch {
    return null;
  }
}

export async function loadRawDataset(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  source: "risk" | "bi"
): Promise<Array<Record<string, unknown>>> {
  try {
    const monthDir = await getPopulationMonthDir(directoryHandle, monthFolderName, false);
    const rawDir = await monthDir.getDirectoryHandle(POPULATION_SUBFOLDERS.raw, { create: false });
    const fileName = source === "risk" ? "risk.raw.json" : "bi.raw.json";
    const result = await safeReadJson<MonthRawData>(rawDir, fileName);
    return result.ok ? (result.value.rows ?? []) : [];
  } catch {
    return [];
  }
}

export async function loadMonthSampleState(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<SampleMasterData | null> {
  try {
    const monthDir = await getPopulationMonthDir(directoryHandle, monthFolderName, false);
    const sampleDir = await resolveSampleDir(directoryHandle, monthFolderName, monthDir);
    if (!sampleDir) return null;
    const result = await safeReadJson<SampleMasterData>(sampleDir, "sample.master.json");
    return result.ok ? result.value : null;
  } catch {
    return null;
  }
}

export async function loadMonthDistributionState(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  sampleRows: SampleMasterData["rows"] | null | undefined
): Promise<DistributionCurrentData | null> {
  if (!sampleRows) return null;
  return loadOrDeriveDistributionCurrent(directoryHandle, monthFolderName, sampleRows);
}

/**
 * Which pieces of a month's edit data to load. Every field defaults to "don't
 * load" when a caller passes a partial scope object -- omitting the whole
 * `scope` argument is the only way to get today's always-load-everything
 * behavior (see FULL_MONTH_LOAD_SCOPE below), so every pre-existing call site
 * that never passed a third argument keeps working byte-for-byte unchanged.
 */
export type MonthLoadScope = {
  population?: boolean;
  summary?: boolean;
  /** Also gated by the existing manifest-status check regardless of this flag. */
  raw?: boolean;
  sample?: boolean;
  /** Implies loading sample data too (distribution is derived from sample rows). */
  distribution?: boolean;
};

const FULL_MONTH_LOAD_SCOPE: Required<MonthLoadScope> = {
  population: true,
  summary: true,
  raw: true,
  sample: true,
  distribution: true,
};

export async function loadMonthForEditing(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  scope: MonthLoadScope = FULL_MONTH_LOAD_SCOPE
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
    // Read the manifest first (small, fast) to decide whether the two raw
    // import files are worth reading at all -- they can each hold up to the
    // full 200k-400k row population for the month. A2026-07-22 perf finding:
    // once a month has actually been processed (any status past "raw-saved"),
    // nothing downstream of loadMonthForEditing reads riskRawRows/biRawRows
    // for phase derivation, sampling, distribution, or browse -- only Phase
    // 1/2's own display of the originally-uploaded workbook needs them, and
    // that only applies while the month is still awaiting processing. A
    // missing/unreadable manifest keeps the previous always-attempt behavior
    // (safe fallback -- never skip on uncertainty).
    const manifest = await loadMonthManifest(directoryHandle, monthFolderName);
    const needsRawWorkbooks = (scope.raw ?? false) && (!manifest || manifest.status === "raw-saved");
    const wantsSample = (scope.sample ?? false) || (scope.distribution ?? false);

    const [popData, processingSummary, rawRows, sampleData] = await Promise.all([
      scope.population ? loadMonthPopulationFinal(directoryHandle, monthFolderName) : Promise.resolve(null),
      scope.summary ? loadProcessingSummary(directoryHandle, monthFolderName) : Promise.resolve(null),
      needsRawWorkbooks
        ? Promise.all([
            loadRawDataset(directoryHandle, monthFolderName, "risk"),
            loadRawDataset(directoryHandle, monthFolderName, "bi"),
          ])
        : Promise.resolve([[], []] as [Array<Record<string, unknown>>, Array<Record<string, unknown>>]),
      wantsSample ? loadMonthSampleState(directoryHandle, monthFolderName) : Promise.resolve(null),
    ]);

    const [riskRawRows, biRawRows] = rawRows;
    const distributionCurrent = (scope.distribution ?? false)
      ? await loadMonthDistributionState(directoryHandle, monthFolderName, sampleData?.rows)
      : null;

    return {
      populationRows: popData?.rows ?? null,
      certScanRows: popData?.certScanRows ?? 0,
      nonCertScanRows: popData?.nonCertScanRows ?? 0,
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
