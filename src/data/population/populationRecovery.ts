/**
 * A2 admin recovery: put a previous `population.final.json` back.
 *
 * Candidates are ONLY the month's own copies in `2-processed/`: the
 * `population.final.{stamp}.superseded.json` archives a save writes before it
 * overwrites (populationStorage.ts `archiveBeforeOverwrite`) and safeWrite's
 * `population.final.json.bak`. Backup snapshots under `5-system/backups/` are
 * Workstream D's: it adds them as `source: "backup"` candidates through its own
 * scoped restore engine and routes the post-restore rebuild through
 * `rebuildPopulationDerivedFiles` below. Never the whole-workspace restore.
 *
 * Restoring archives the current file first (the same mandatory archive a save
 * takes), so a restore is itself undoable from this list.
 *
 * A restore obeys the same orphan rule as a save (`assessPopulationOverwrite`,
 * evaluated inside the lock): once the month has a distribution or answers, a
 * candidate lacking any live sampled id is refused — restoring an old copy is
 * an overwrite like any other. Restoring an older copy also drops any
 * population corrections made after that copy was written.
 */
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { listDirectoryEntries } from "../storage/directoryScan";
import { readEnvelopeRevision, safeReadJson, safeWriteJson } from "../storage/safeWrite";
import { casLoop } from "../storage/casLoop";
import { codedMessage, logCodedError } from "../storage/errorCodes";
import { notifyLocalDataChange } from "../workspace/dataRefreshSignal";
import { withResourceLock } from "../storage/webLocks";
import { withWorkspaceWriteAccess } from "../storage/workspaceWriteAccess";
import { logError } from "../storage/errorLogger";
import { getPopulationMonthDir, POPULATION_SUBFOLDERS } from "../workspace/workspacePaths";
import { ensureMonthWritable, manifestLockKey } from "./monthLock";
import { archiveBeforeOverwrite, loadProcessingSummary, supersedeStamp } from "./populationStorage";
import {
  assessPopulationOverwrite,
  loadPopulationOverwriteImpact,
} from "./populationOverwriteGuard";
import { loadPopulationConfig } from "./populationConfig";
import { rebuildReplacementIndex } from "./replacementIndexStorage";
import { buildPopulationAggregate, savePopulationAggregate } from "./populationAggregate";
import type { MonthManifestData, PopulationFinalData } from "./monthTypes";
import type { PreparedPopulationRow } from "./populationTypes";

const LIVE_FILE = "population.final.json";
const BAK_FILE = `${LIVE_FILE}.bak`;
const SUPERSEDED_PATTERN = /^population\.final\..+\.superseded\.json$/;

export type PopulationRecoveryCandidate = {
  fileName: string;
  /**
   * "superseded" / "bak": a copy beside the live file (this module restores it).
   * "backup": a `5-system/backups/{folder}` snapshot — `fileName` is the backup
   * FOLDER name, listed and restored by Workstream D's scoped engine
   * (`backup/selectiveRestore.ts`), never by `restorePopulationCandidate`.
   */
  source: "superseded" | "bak" | "backup";
  rowCount: number;
  processedAt: string | null;
  /** Live sampled ids present in this candidate. */
  coveredSampledIds: number;
  totalSampledIds: number;
  /** True when restoring this candidate would be refused by the orphan rule (the month has work and it lacks sampled ids). */
  wouldBlock: boolean;
};

/** The listing itself failed (unreadable folder/candidates) — distinct from "no candidates". */
export class PopulationRecoveryScanError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = "PopulationRecoveryScanError";
  }
}

/** The restore succeeded but a follow-up step did not; the population itself is back. */
export type PopulationRestoreWarning = "manifest-sync-failed";

export type PopulationRestoreResult =
  | { ok: true; archivedAs: string | null; rowCount: number; warnings?: PopulationRestoreWarning[] }
  | { ok: false; reason: "blocked"; missingCount: number; missingExamples: string[]; distributionCount: number; answerCount: number }
  | { ok: false; reason: "invalid-candidate" | "unreadable" | "guard-unreadable" | "failed"; detail?: string };

function isNotFound(error: unknown): boolean {
  return error instanceof Error && error.name === "NotFoundError";
}

function isCandidateName(fileName: string): boolean {
  return fileName === BAK_FILE || SUPERSEDED_PATTERN.test(fileName);
}

async function openProcessedDir(directoryHandle: DirectoryHandleLike, monthFolderName: string): Promise<DirectoryHandleLike> {
  const monthDir = await getPopulationMonthDir(directoryHandle, monthFolderName, false);
  return monthDir.getDirectoryHandle(POPULATION_SUBFOLDERS.processed, { create: false });
}

function rowIds(data: PopulationFinalData): Set<string> {
  const ids = new Set<string>();
  for (const row of data.rows) {
    const id = row["xrayImageId"];
    if (typeof id === "string") ids.add(id);
  }
  return ids;
}

/**
 * Every candidate, newest archive first, then the `.bak`. Reads each candidate
 * in full to measure coverage — an on-demand admin action, one file at a time.
 */
export async function listPopulationRecoveryCandidates(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<PopulationRecoveryCandidate[]> {
  try {
    let processedDir: DirectoryHandleLike;
    try {
      processedDir = await openProcessedDir(directoryHandle, monthFolderName);
    } catch (error) {
      // A month with no processed folder genuinely has nothing to recover;
      // any other failure is a failed scan, which must not read as "none".
      if (isNotFound(error)) return [];
      throw error;
    }
    const names = (await listDirectoryEntries(processedDir))
      .filter((entry) => entry.kind === "file")
      .map((entry) => entry.name);
    const ordered = [
      ...names.filter((name) => SUPERSEDED_PATTERN.test(name)).sort((a, b) => b.localeCompare(a)),
      ...(names.includes(BAK_FILE) ? [BAK_FILE] : []),
    ];
    const impact = await loadPopulationOverwriteImpact(directoryHandle, monthFolderName);
    const candidates: PopulationRecoveryCandidate[] = [];
    for (const fileName of ordered) {
      const read = await readCandidate(processedDir, fileName);
      if (!read) continue;
      const ids = rowIds(read);
      const assessment = assessPopulationOverwrite(impact, read.rows);
      candidates.push({
        fileName,
        source: fileName === BAK_FILE ? "bak" : "superseded",
        rowCount: read.rows.length,
        processedAt: read.processedAt ?? null,
        coveredSampledIds: impact.liveSampledIds.filter((id) => ids.has(id)).length,
        totalSampledIds: impact.liveSampledIds.length,
        wouldBlock: assessment.blocked,
      });
    }
    return candidates;
  } catch (error) {
    logError("population:recovery-scan", error);
    throw new PopulationRecoveryScanError(error);
  }
}

/** A candidate's payload, or null when it is unreadable/corrupt (skipped, never a sibling's data). */
async function readCandidate(processedDir: DirectoryHandleLike, fileName: string): Promise<PopulationFinalData | null> {
  const read = await safeReadJson<PopulationFinalData>(processedDir, fileName, { siblingFallback: false }).catch(
    (error: unknown) => {
      logError("population:recovery-read", error);
      return null;
    }
  );
  return read?.ok && Array.isArray(read.value.rows) ? read.value : null;
}

/**
 * Rebuild what a population save derives from `population.final.json`: the
 * replacement-candidate index (keyed on the new envelope revision) and the
 * month aggregate. Best-effort, logged — the same contract saveMonthRun gives
 * both. The aggregate reuses the month's `processing.summary.json` (not
 * versioned), so its summary block describes the most recent processing run.
 */
export async function rebuildPopulationDerivedFiles(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  processedDir: DirectoryHandleLike,
  rows: PreparedPopulationRow[],
  username: string
): Promise<void> {
  try {
    const revision = await readEnvelopeRevision(processedDir, LIVE_FILE);
    if (revision !== null) {
      const config = await loadPopulationConfig(directoryHandle);
      const rebuilt = await rebuildReplacementIndex(
        directoryHandle,
        monthFolderName,
        rows,
        config.stageMappings,
        revision,
        username
      );
      if (!rebuilt.ok) logError("population:recovery-index", new Error(rebuilt.error));
    }
  } catch (error) {
    logError("population:recovery-index", error);
  }
  try {
    const summary = await loadProcessingSummary(directoryHandle, monthFolderName);
    if (summary) {
      await savePopulationAggregate(
        directoryHandle,
        monthFolderName,
        buildPopulationAggregate({ monthFolderName, computedBy: username, summary: summary.summary, preparedRows: rows })
      );
    }
  } catch (error) {
    logError("population:recovery-aggregate", error);
  }
}

/**
 * Keep `month.manifest.json` describing the population that is now live:
 * `totalProcessedRows` (read by reports) follows the restored rows, and the
 * processing fingerprint is cleared — it fingerprints the run that produced
 * the overwritten file, not this one. Same casLoop protocol as
 * `updateMonthStatus`; no shape change. A month with no manifest is skipped.
 */
async function syncManifestToRestoredPopulation(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  rowCount: number
): Promise<void> {
  const monthDir = await getPopulationMonthDir(directoryHandle, monthFolderName, false);
  const result = await casLoop<{ ok: true }>(
    async (writeToken) => {
      const current = await safeReadJson<MonthManifestData>(monthDir, "month.manifest.json");
      if (!current.ok) {
        // No readable manifest to update (absent, or unreadable): nothing to keep
        // in step, but say so rather than treating it as done in silence.
        logError("population:recovery-manifest-unreadable", new Error(`month.manifest.json not readable: ${current.reason}`));
        return { done: true, result: { ok: true as const } };
      }
      const nextRevision = (current.value.revision ?? 0) + 1;
      await safeWriteJson(monthDir, "month.manifest.json", {
        ...current.value,
        totalProcessedRows: rowCount,
        processingFingerprint: null,
        revision: nextRevision,
        _writeToken: writeToken,
      });
      const verify = await safeReadJson<MonthManifestData>(monthDir, "month.manifest.json");
      if (verify.ok && verify.value.revision === nextRevision && verify.value._writeToken === writeToken) {
        return { done: true, result: { ok: true as const } };
      }
      return { done: false };
    },
    { context: "population:recovery-manifest", maxRetries: 5, baseDelayMs: 50, conflictError: "manifest recovery update conflict" }
  );
  if (!result.ok) throw new Error(result.error);
}

export async function restorePopulationCandidate(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  fileName: string,
  username: string
): Promise<PopulationRestoreResult> {
  if (!isCandidateName(fileName)) return { ok: false, reason: "invalid-candidate" };
  await ensureMonthWritable(directoryHandle, monthFolderName);
  const result = await withResourceLock(manifestLockKey(monthFolderName), () =>
    withWorkspaceWriteAccess(directoryHandle, async (): Promise<PopulationRestoreResult> => {
      try {
        const processedDir = await openProcessedDir(directoryHandle, monthFolderName);
        const candidate = await readCandidate(processedDir, fileName);
        if (!candidate) return { ok: false, reason: "unreadable" };

        // Same rule as a save, enforced here under the manifest lock whatever
        // the UI showed: a guard that cannot read the month's work refuses
        // (XQ-POP-008), and a candidate that would orphan live sampled ids
        // once the month has work is refused. Nothing is written either way.
        let assessment;
        try {
          assessment = assessPopulationOverwrite(
            await loadPopulationOverwriteImpact(directoryHandle, monthFolderName),
            candidate.rows
          );
        } catch (error) {
          logCodedError("population:recovery-guard-unreadable", "XQ-POP-008", error);
          return { ok: false, reason: "guard-unreadable", detail: codedMessage("XQ-POP-008") };
        }
        if (assessment.blocked) {
          return {
            ok: false,
            reason: "blocked",
            missingCount: assessment.missingCount,
            missingExamples: assessment.missingExamples,
            distributionCount: assessment.distributionCount,
            answerCount: assessment.answerCount,
          };
        }

        // Mandatory: the file being replaced is kept, so this restore can itself
        // be undone. `retryMissingSource` rides the storage layer's ladder so a
        // transient directory-listing miss is not mistaken for "no live file".
        const archivedAs = await archiveBeforeOverwrite(processedDir, LIVE_FILE, supersedeStamp(), {
          required: true,
          retryMissingSource: true,
        });
        if (archivedAs === null) {
          // Still "missing" after the ladder. Genuinely absent is fine (that is
          // what a recovery is for); a file the directory still lists is a miss
          // we must not overwrite blind.
          const listed = (await listDirectoryEntries(processedDir)).some((entry) => entry.name === LIVE_FILE);
          if (listed) {
            return { ok: false, reason: "failed", detail: "population.final.json could not be archived before the restore." };
          }
        }
        await safeWriteJson(processedDir, LIVE_FILE, candidate);
        // From here the population IS restored, so nothing below may turn this
        // into a failure: the manifest sync is best-effort (logged, surfaced as
        // a warning), like the derived rebuild.
        const warnings: PopulationRestoreWarning[] = [];
        try {
          await syncManifestToRestoredPopulation(directoryHandle, monthFolderName, candidate.rows.length);
        } catch (error) {
          logError("population:recovery-manifest-sync", error);
          warnings.push("manifest-sync-failed");
        }
        await rebuildPopulationDerivedFiles(
          directoryHandle,
          monthFolderName,
          processedDir,
          candidate.rows as unknown as PreparedPopulationRow[],
          username
        );
        return warnings.length > 0
          ? { ok: true, archivedAs, rowCount: candidate.rows.length, warnings }
          : { ok: true, archivedAs, rowCount: candidate.rows.length };
      } catch (error) {
        logError("population:recovery-restore", error);
        return { ok: false, reason: "failed", detail: error instanceof Error ? error.message : String(error) };
      }
    })
  );
  if (result.ok) notifyLocalDataChange(["manifest"]);
  return result;
}
