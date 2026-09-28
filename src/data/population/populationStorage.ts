import { codedMessage, logCodedError, resolveErrorCode, taggedError } from "../storage/errorCodes";
import type { DirectoryHandleLike, FileHandleLike } from "../storage/fileSystemAccess";
import {
  safeWriteJson,
  safeWriteJsonText,
  safeReadJson,
  readEnvelopeRevision,
  readDecodedFileTextOutcome,
  copyFileBytes,
  copyFileBytesVerified,
  safeRemoveJson,
  isCompressedFile,
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
import type { CertScanShortfall, SampleMasterData } from "../sampling/sampleTypes";
import type { DistributionCurrentData } from "../distribution/distributionTypes";
import { loadOrDeriveDistributionCurrent } from "../distribution/distributionStorage";
import { loadSampleMaster } from "../sampling/sampleStorage";
import {
  assessPopulationOverwrite,
  loadPopulationOverwriteImpact,
  type PopulationOverwriteImpact,
} from "./populationOverwriteGuard";
import { getLabels } from "../labels/labelsStore";
import { loadPopulationConfig } from "./populationConfig";
import { rebuildReplacementIndex } from "./replacementIndexStorage";
import type { PreparedPopulationRow } from "./populationTypes";
import {
  buildPopulationAggregate,
  loadPopulationAggregate,
  savePopulationAggregate,
  type PopulationAggregateLoadResult,
} from "./populationAggregate";
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
  } catch (error) {
    // Fire-and-forget autosave: the in-session value is unaffected, so this
    // stays non-throwing. But a persistently failing autosave otherwise
    // surfaces later as "my CertScan list vanished" with no trace anywhere.
    logError("population:save-certscan-global", error);
  }
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
  /**
   * CertScan shortfalls detected during the draw (owner decision, 2026-08): a
   * stratum short on CertScan under-fills rather than silently backfilling from
   * NonCertscan; this mirrors `SampleMasterData.certScanShortfalls` so the
   * shortfall is self-describing in the proof document too, not only in the
   * sample master / sampling plan. Optional — absent on proofs written before
   * this field existed, and omitted by callers that don't pass it.
   */
  certScanShortfalls?: CertScanShortfall[];
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
  } catch (error) {
    // Non-throwing by design: the draw's own record (rngSeed, drawnAt, drawnBy,
    // allocations) is already persisted in sample.master.json, so a lost proof
    // document is a reproducibility annoyance rather than lost audit evidence.
    // It must still be visible in the admin error log rather than vanishing.
    logError("population:save-sampling-proof", error);
  }
}

export type SaveMonthRunParams = {
  directoryHandle: DirectoryHandleLike;
  month: number;
  year: number;
  username: string;
  riskFileName: string | null;
  biFileName: string | null;
  riskSourceFile?: File | null;
  /**
   * Every BI source file the run was built from. Multi-file BI (2026-08 handoff
   * §3) merges N files into ONE BI population, so archiving only the first would
   * leave `1-raw/` unable to reproduce the run. One file still writes the
   * historical `bi.source.<ext>` name; two or more write `bi.source.<n>.<ext>`.
   */
  biSourceFiles?: File[];
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
    /**
     * Fix (population, 2026-08-18): multi-file BI means "the" BI source file is
     * no longer singular. Was `SourceFileMetadata | null` and silently recorded
     * only the first attached file; now an array, one entry per attached file,
     * so files 2..N are not misreported as absent (currently write-only — no
     * reader exists yet, so this widening is safe).
     */
    bi?: SourceFileMetadata[] | null;
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
  /**
   * A2: the month has a distribution or answers and the new population lacks
   * live sampled ids. Refused regardless of `confirmedOverwrite`.
   */
  overwriteBlocked?: {
    missingCount: number;
    missingExamples: string[];
    distributionCount: number;
    answerCount: number;
  };
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
    const stamp = new Date().toISOString().replace(/:/g, "");
    const archiveName = `${base}.raw.${stamp}.superseded.json`;
    // A compressed raw file is archived as a BYTE copy: it is already the
    // original record, decoding its gzip member as text would not round-trip,
    // and the copy costs a few MB instead of decompressing and re-serializing
    // hundreds. The archive keeps the same self-describing format, so it reads
    // back through the same dual-read path as any other file.
    if (await isCompressedFile(rawDir, liveName)) {
      await copyFileBytes(rawDir, liveName, rawDir, archiveName);
      return archiveName;
    }
    const existing = await safeReadJson<MonthRawData>(rawDir, liveName);
    if (!existing.ok) return null;
    // Preserve the prior file's exact bytes (including its own `supersedes`
    // chain) rather than re-wrapping — the archive is the original record.
    await safeWriteJsonText(rawDir, archiveName, existing.rawText);
    return archiveName;
  } catch (error) {
    logError("population:archive-raw", error);
    return null;
  }
}

/**
 * Filename-safe ISO timestamp — the same stamp shape `archiveExistingRaw`
 * uses, with a short random suffix appended (F20): two archives written
 * within the same millisecond (a fast re-save, or two source files archived
 * back-to-back) must never collide and silently clobber one archive with
 * another rather than actually preserving both.
 */
export function supersedeStamp(now: Date = new Date()): string {
  const random = crypto.randomUUID().slice(0, 8);
  return `${now.toISOString().replace(/:/g, "")}-${random}`;
}

/** `population.final.json` → `population.final.{stamp}.superseded.json`; `risk.source.xlsx` → `risk.source.{stamp}.superseded.xlsx`. */
export function supersededFileName(liveName: string, stamp: string): string {
  const dot = liveName.lastIndexOf(".");
  return dot <= 0
    ? `${liveName}.${stamp}.superseded`
    : `${liveName.slice(0, dot)}.${stamp}.superseded${liveName.slice(dot)}`;
}

/**
 * A2: byte-copy `liveName` aside before it is overwritten. Returns the archive
 * name, or null when there was nothing to archive.
 *
 * `required: true` (population.final.json) turns a verification failure into
 * a thrown, coded (`XQ-POP-009`) error, so the caller's save is refused
 * rather than overwriting the only full copy with an unverified — possibly
 * torn or short — archive sitting next to it; otherwise failures are logged
 * and the save proceeds, matching `archiveExistingRaw`'s existing best-effort
 * contract for the raw JSON archives.
 *
 * F5 / review fix round 1: this used to probe existence itself via a plain
 * `dir.getFileHandle(liveName, { create: false })` and then copy with the
 * unverified `copyFileBytes`. Two bugs followed from that: (1) that probe had
 * no `retryMissing`, so a transient SMB directory-listing lag on an
 * ACTUALLY-existing `population.final.json` reported `NotFoundError`, the
 * function returned `null` ("nothing to archive") even under `required:
 * true`, and the save proceeded to overwrite the live file with zero backup;
 * (2) `copyFileBytes` never reads its own output back, so a torn/short copy
 * (share dropped mid-flush, disk full) counted as a successful archive and
 * the live file was then overwritten with nothing recoverable next to it.
 * `copyFileBytesVerified` (`safeWrite.ts`) is the storage layer's own
 * primitive for exactly this: it never decodes (byte-for-byte, handles a
 * compressed source correctly), reads the copy back, and compares its size
 * and a digest against the bytes it read from the source — so a torn copy is
 * reported, not silently accepted. `source_missing` from it is the ordinary
 * "no live file yet" case (a first save) and stays `null` under `required`
 * too — that case has nothing to archive, which is not a failure.
 *
 * Review fix round 2 (F5, finding #1, closed): `copyFileBytesVerified`'s own
 * SOURCE read used to open the source with no `retryMissing`, so a transient
 * SMB directory-listing lag on an ACTUALLY-existing `liveName` could still
 * report `NotFoundError` on the very first attempt and resolve to
 * `source_missing` — the exact false negative this whole function exists to
 * rule out, just moved one layer down. `copyFileBytesVerified` now takes an
 * opt-in `{ retryMissingSource: true }` (default false, so every OTHER
 * caller is unaffected) that rides the same `retryMissing` ladder
 * `copyFileBytes`/`openFile` already use for post-write verification reads
 * (`VERIFY_READBACK_RETRY_DELAYS_MS`, ~11s worst case — see `safeWrite.ts`).
 * `archiveBeforeOverwrite` passes it for the MANDATORY `population.final.json`
 * archive only (`saveMonthRunLocked`'s `{ required: true }` call), and only
 * WHEN a prior save is known to have happened (the caller gates it on
 * `month.manifest.json` already existing — see the call site's comment):
 * a genuinely first-ever save of a month has no live file to protect, so
 * making it pay the same ~11s worst-case ladder for a file that was never
 * going to be there is not just wasted latency on every new month in
 * production, it broke several existing tests outright when tried
 * unconditionally (their own 20s `testTimeout` exceeded — see
 * task-4-report.md's fix-round-2 section). Only a `NotFoundError` that
 * survives the whole ladder counts as "genuinely no live file" once this IS
 * turned on. The best-effort source-workbook archives (`risk.source.*` /
 * `bi.source*.*`) deliberately do NOT opt in at all: a missed archive of an
 * uploaded workbook is logged and non-fatal by design (the processed
 * population itself is what `required: true` protects), and the same latency
 * tradeoff applies with even less upside.
 */
export async function archiveBeforeOverwrite(
  dir: DirectoryHandleLike,
  liveName: string,
  stamp: string,
  options: { required?: boolean; retryMissingSource?: boolean } = {}
): Promise<string | null> {
  const archiveName = supersededFileName(liveName, stamp);
  let outcome;
  try {
    outcome = await copyFileBytesVerified(dir, liveName, dir, archiveName, {
      retryMissingSource: options.retryMissingSource,
    });
  } catch (error) {
    // copyFileBytesVerified opens its target via `getFileHandle(..., { create:
    // true })` before it ever reads the source, so a source read that fails
    // mid-copy (this catch) still leaves a 0-byte `archiveName` behind. Clean
    // it up rather than leaving an empty, misleading "archive" next to the
    // live file — best-effort: a failure here must never mask the original
    // copy failure above it. `safeRemoveJson`, not a raw `removeEntry`: it is
    // the storage layer's own delete primitive (lint-enforced everywhere
    // else in this codebase); its `.tmp`/`.bak` sibling cleanup is a no-op
    // here (this is a fresh byte-copy target, never a `safeWriteJson`
    // envelope), but the plain-live-name removal is exactly what is needed.
    await safeRemoveJson(dir, archiveName).catch(() => {});
    if (options.required) {
      throw taggedError(
        "XQ-POP-009",
        `Archiving ${liveName} before overwrite threw.`,
        { cause: error }
      );
    }
    logError("population:archive-superseded", error);
    return null;
  }
  if (outcome.status === "source_missing") return null;
  if (outcome.status === "verify_failed") {
    // Same stray-file cleanup as above (see that comment): a verify_failed
    // outcome still landed whatever bytes it managed to write at
    // `archiveName` before the read-back proved them wrong.
    await safeRemoveJson(dir, archiveName).catch(() => {});
    const error = taggedError(
      "XQ-POP-009",
      `Archiving ${liveName} before overwrite failed verification: ${outcome.detail}`
    );
    if (options.required) throw error;
    logError("population:archive-superseded", error);
    return null;
  }
  return archiveName;
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

    // A2 overwrite rule (owner decision 2026-09-28), enforced HERE, under the
    // manifest lock, whatever the caller confirmed: once a month has a
    // distribution or answers, a population that lacks any live sampled id is
    // refused — it would orphan that work in every report. A read failure on
    // the sample/distribution/answers below is never swallowed into "no
    // work" (F21) — it is caught in its OWN try/catch, distinct from the
    // function-wide one below, so it maps to a dedicated coded refusal
    // (XQ-POP-008) that tells the admin the check itself could not complete,
    // rather than falling through to the generic "unexpected error while
    // saving" (XQ-POP-006) every other failure in this function produces.
    let impact: PopulationOverwriteImpact;
    try {
      impact = await loadPopulationOverwriteImpact(directoryHandle, monthFolderName);
    } catch (error) {
      logCodedError("population:overwrite-guard-unreadable", "XQ-POP-008", error);
      return { ok: false, error: codedMessage("XQ-POP-008") };
    }
    const assessment = assessPopulationOverwrite(impact, processedRows);
    if (assessment.blocked) {
      return {
        ok: false,
        error: getLabels().population_overwrite_blocked_error.replace(
          "{missing}",
          String(assessment.missingCount)
        ),
        overwriteBlocked: {
          missingCount: assessment.missingCount,
          missingExamples: assessment.missingExamples,
          distributionCount: assessment.distributionCount,
          answerCount: assessment.answerCount,
        },
      };
    }

    // TOCTOU guard: re-check under the lock that no sample was drawn since the
    // caller's pre-check. Overwriting the population while a sample exists would
    // orphan that sample — abort and let the caller confirm.
    if (!confirmedOverwrite && impact.sampleExists) {
      return {
        ok: false,
        error: `يوجد سحب عينة لهذا الشهر (${monthFolderName}) — تأكيد الاستبدال مطلوب قبل إعادة الحفظ.`,
        sampleExists: true,
      };
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

      // A2: one stamp per save, shared by every archive this save writes, so
      // the population and the sources it was built from stay pairable.
      const stamp = supersedeStamp(new Date(now));
      // Fix round 2 (F5 finding #1): whether the mandatory archive below rides
      // the patient `retryMissingSource` ladder (~11s worst case) depends on
      // whether a population was ever actually written for this month before.
      // `month.manifest.json` is written LAST by every prior successful call
      // to this function ("must be last: it records totals/paths that depend
      // on every write above having committed" — see the manifest write
      // below), so its presence is proof `population.final.json` was
      // committed by a prior run and SHOULD still be there; its absence means
      // this is this month's first-ever save, which has nothing to protect.
      // Gating on that — rather than always retrying — matters for more than
      // latency: unconditionally retrying on EVERY save, including the
      // ordinary first save of a brand-new month, made every fresh month's
      // save pay the full ~11s ladder for a file that was never going to
      // exist, which is not just slow but broke several existing tests
      // outright (20s `testTimeout` exceeded — see task-4-report.md's
      // fix-round-2 section for the measured numbers).
      const priorManifest = await loadMonthManifest(directoryHandle, monthFolderName);
      // Mandatory, and BEFORE anything is overwritten: without this copy a
      // re-process leaves only safeWrite's single `.bak` of the population.
      // `retryMissingSource: priorManifest !== null`: a transient SMB
      // NotFound on an ACTUALLY-existing population.final.json must never be
      // read as "nothing to archive" — see archiveBeforeOverwrite's doc
      // comment for why this is the mandatory call's only opt-in.
      await archiveBeforeOverwrite(processedDir, "population.final.json", stamp, {
        required: true,
        retryMissingSource: priorManifest !== null,
      });

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
          await archiveBeforeOverwrite(rawDir, `risk.source.${ext}`, stamp);
          await saveBinaryFile(rawDir, `risk.source.${ext}`, buf);
        })(),
        (async () => {
          const biFiles = params.biSourceFiles ?? [];
          if (biFiles.length === 0) return;
          const single = biFiles.length === 1;
          // Sequential, not Promise.all: these can be tens of MB each, and a
          // shared-folder handle does not benefit from racing several large
          // binary writes against each other.
          for (const [index, file] of biFiles.entries()) {
            const buf = await file.arrayBuffer();
            const ext = file.name.split(".").pop() ?? "xlsx";
            const name = single ? `bi.source.${ext}` : `bi.source.${index + 1}.${ext}`;
            await archiveBeforeOverwrite(rawDir, name, stamp);
            await saveBinaryFile(rawDir, name, buf);
          }
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
        (async () => {
          // Best-effort, non-fatal — same contract as the replacement-index
          // rebuild above: a persisted month aggregate (owner requirement)
          // lets the Population tab render an already-processed/locked month
          // with zero reads of population.final.json/risk.raw.json/bi.raw.json.
          // Its failure must never sink an otherwise-successful population
          // save; the tab falls back to an explicit "missing aggregate"
          // recovery prompt on next open rather than silently re-reading rows.
          if (!params.processingSummary) return;
          try {
            const aggregate = buildPopulationAggregate({
              monthFolderName,
              computedBy: username,
              summary: params.processingSummary.summary,
              preparedRows: processedRows as PreparedPopulationRow[],
            });
            await savePopulationAggregate(directoryHandle, monthFolderName, aggregate);
          } catch (error) {
            logError("population:save-aggregate", error);
          }
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
    // Was `error.message` — which destroyed the code every layer below had
    // attached. This catch wraps the WHOLE month write (five files), so a full
    // disk (XQ-IO-020), a revoked grant (XQ-IO-017) and a moved workspace
    // folder (XQ-IO-030, where retrying can never work) all collapsed into one
    // raw English string that the UI then rendered inside an Arabic sentence.
    const code = resolveErrorCode(error) ?? "XQ-POP-006";
    logCodedError("population:save-month-run", code, error);
    return { ok: false, error: codedMessage(code) };
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
          { context: "population:manifestStatus", maxRetries: 5, baseDelayMs: 50, conflictError: "manifest status update conflict" }
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

/**
 * Absent vs unreadable, kept apart (T-08).
 *
 * `population.final.json` reads used to collapse "this month was never
 * processed" and "this month's file could not be read right now" into the same
 * `null`. Every surface downstream then rendered the friendly empty state —
 * Population Browse literally invites the user to go re-process the month, and
 * the replacement flow reports zero candidates — so a transient SMB read
 * failure looks exactly like a month with no data, and the user's natural next
 * click destroys the data that is actually still there.
 *
 * `absent` is only ever reported when the month folder, the processed
 * subfolder, or the file itself said NotFound. Anything else — a damaged file,
 * exhausted NotReadableError retries, a permission failure — is `unreadable`
 * and must block rather than degrade to "empty".
 */
export type PopulationFinalOutcome<T> =
  | { status: "loaded"; value: T }
  | { status: "absent" }
  | { status: "unreadable" };

/** Thrown where a caller's contract has no room for an outcome union but must
 *  still refuse to treat an unreadable month as an empty one. */
export class PopulationUnreadableError extends Error {
  readonly monthFolderName: string;
  constructor(monthFolderName: string) {
    super(`population.final.json for ${monthFolderName} exists but could not be read.`);
    this.name = "PopulationUnreadableError";
    this.monthFolderName = monthFolderName;
  }
}

function isMissingEntryError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    (error as { name?: string }).name === "NotFoundError"
  );
}

/**
 * Resolve the month's `2-processed/` directory, telling "not there" apart from
 * "could not be opened". Returns `null` for a genuinely absent folder.
 */
async function openProcessedDir(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<{ status: "open"; dir: DirectoryHandleLike } | { status: "absent" } | { status: "unreadable" }> {
  try {
    const monthDir = await getMonthDir(directoryHandle, monthFolderName);
    const dir = await monthDir.getDirectoryHandle(POPULATION_SUBFOLDERS.processed, { create: false });
    return { status: "open", dir };
  } catch (error) {
    return isMissingEntryError(error) ? { status: "absent" } : { status: "unreadable" };
  }
}

/** Discriminating counterpart of {@link loadMonthPopulationFinal}. */
export async function readMonthPopulationFinal(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<PopulationFinalOutcome<PopulationFinalData>> {
  const opened = await openProcessedDir(directoryHandle, monthFolderName);
  if (opened.status !== "open") return opened;
  let result: Awaited<ReturnType<typeof safeReadJson<PopulationFinalData>>>;
  try {
    result = await safeReadJson<PopulationFinalData>(opened.dir, "population.final.json");
  } catch {
    return { status: "unreadable" };
  }
  if (result.ok) return { status: "loaded", value: result.value };
  // safeReadJson already walked live -> .bak -> .tmp: "missing" means every rung
  // was absent, "corrupt" means at least one existed and could not be used.
  return result.reason === "missing" ? { status: "absent" } : { status: "unreadable" };
}

export async function loadMonthPopulationFinal(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<PopulationFinalData | null> {
  const outcome = await readMonthPopulationFinal(directoryHandle, monthFolderName);
  return outcome.status === "loaded" ? outcome.value : null;
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
 * calls the lower-level `readDecodedFileTextOutcome` (text-only, no parse) instead —
 * which also transparently decompresses a compressed file, handing the worker the
 * body text rather than gzip bytes.
 *
 * Reports `absent` when the file doesn't exist yet (e.g. an unprocessed/pending
 * month) and `unreadable` when a copy of it is there but could not be read — see
 * {@link PopulationFinalOutcome}. `loadMonthPopulationFinalRawText` below keeps the
 * older null-for-both contract for callers that genuinely cannot act on the
 * difference.
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
export async function readMonthPopulationFinalRawText(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<PopulationFinalOutcome<string>> {
  const opened = await openProcessedDir(directoryHandle, monthFolderName);
  if (opened.status !== "open") return opened;

  // A rung that EXISTED but produced nothing usable is remembered: once the
  // whole ladder has been walked, "every rung was NotFound" is absence, while
  // "at least one rung was there and unusable" is a read failure. Collapsing
  // the two is what let a transient SMB failure render as "no data yet".
  let sawUnreadableRung = false;

  for (const candidate of [
    "population.final.json",
    "population.final.json.bak",
    "population.final.json.tmp"
  ]) {
    // Dual read, not the raw one: a compressed file must be handed to the
    // worker as its DECOMPRESSED body (which the worker's `unwrap` tolerates
    // exactly like a legacy bare payload), while a plain file is still
    // passed through verbatim with no parse on this thread.
    const outcome = await readDecodedFileTextOutcome(opened.dir, candidate);
    if (outcome.status === "unreadable") {
      // The next rung of the ladder may still hold a usable copy, so keep
      // walking — but do not let a later NotFound erase the fact that a copy
      // of this file exists and could not be read.
      sawUnreadableRung = true;
      continue;
    }
    if (outcome.status === "absent") continue;
    // A zero-byte torn write (a live file caught mid-safeWriteJson) reads back
    // as "" rather than absent -- treat it as an unusable rung so the ladder
    // still falls through to .bak/.tmp instead of handing the worker an empty
    // string it can only fail to parse.
    if (outcome.text.trim() === "") {
      sawUnreadableRung = true;
      continue;
    }
    return { status: "loaded", value: outcome.text };
  }

  return sawUnreadableRung ? { status: "unreadable" } : { status: "absent" };
}

export async function loadMonthPopulationFinalRawText(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<string | null> {
  const outcome = await readMonthPopulationFinalRawText(directoryHandle, monthFolderName);
  return outcome.status === "loaded" ? outcome.value : null;
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
  /**
   * True when this month's manifest reports `status === "closed"` — the
   * owner-mandated lock. When true, `populationRows`/`riskRawRows`/
   * `biRawRows` above are deliberately NOT fetched even if the caller's
   * `MonthLoadScope` asked for them (see `loadMonthForEditing`); the Population
   * tab must render from `populationAggregate` below instead.
   */
  populationLocked: boolean;
  /**
   * Populated only when `populationLocked` is true and the caller's scope
   * requested population data. `status: "ok"` carries the persisted aggregate
   * to render from; `"missing"`/`"corrupt"` tell the caller to show the
   * explicit reprocessing-recovery prompt instead of silently falling back to
   * a row read (owner requirement — no silent fallback).
   */
  populationAggregate: PopulationAggregateLoadResult | null;
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
    manifest: null,
    populationLocked: false,
    populationAggregate: null,
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
    // Owner requirement (2026-08-07): a LOCKED month is frozen history — the
    // Population tab must never re-read population.final.json/risk.raw.json/
    // bi.raw.json for it, regardless of what the caller's scope asked for. It
    // reads the persisted aggregate instead (populationAggregate.ts). A
    // missing/unreadable manifest is NOT treated as locked — same fail-open
    // stance as monthLock.ts's isMonthClosed, since this is governance, not a
    // security boundary.
    const populationLocked = manifest?.status === "closed";
    const wantsPopulation = (scope.population ?? false) && !populationLocked;
    const wantsRaw = needsRawWorkbooks && !populationLocked;

    const [popData, processingSummary, rawRows, sampleData, aggregateResult] = await Promise.all([
      wantsPopulation ? loadMonthPopulationFinal(directoryHandle, monthFolderName) : Promise.resolve(null),
      scope.summary ? loadProcessingSummary(directoryHandle, monthFolderName) : Promise.resolve(null),
      wantsRaw
        ? Promise.all([
            loadRawDataset(directoryHandle, monthFolderName, "risk"),
            loadRawDataset(directoryHandle, monthFolderName, "bi"),
          ])
        : Promise.resolve([[], []] as [Array<Record<string, unknown>>, Array<Record<string, unknown>>]),
      wantsSample ? loadMonthSampleState(directoryHandle, monthFolderName) : Promise.resolve(null),
      populationLocked && (scope.population ?? false)
        ? loadPopulationAggregate(directoryHandle, monthFolderName)
        : Promise.resolve(null),
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
      manifest,
      populationLocked,
      populationAggregate: aggregateResult,
    };
  } catch {
    return empty;
  }
}
