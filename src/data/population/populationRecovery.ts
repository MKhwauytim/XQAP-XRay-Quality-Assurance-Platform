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
 */
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { listDirectoryEntries } from "../storage/directoryScan";
import { readEnvelopeRevision, safeReadJson, safeWriteJson } from "../storage/safeWrite";
import { withResourceLock } from "../storage/webLocks";
import { withWorkspaceWriteAccess } from "../storage/workspaceWriteAccess";
import { logError } from "../storage/errorLogger";
import { getPopulationMonthDir, POPULATION_SUBFOLDERS } from "../workspace/workspacePaths";
import { ensureMonthWritable, manifestLockKey } from "./monthLock";
import { archiveBeforeOverwrite, loadProcessingSummary, supersedeStamp } from "./populationStorage";
import { loadPopulationOverwriteImpact } from "./populationOverwriteGuard";
import { loadPopulationConfig } from "./populationConfig";
import { rebuildReplacementIndex } from "./replacementIndexStorage";
import { buildPopulationAggregate, savePopulationAggregate } from "./populationAggregate";
import type { PopulationFinalData } from "./monthTypes";
import type { PreparedPopulationRow } from "./populationTypes";

const LIVE_FILE = "population.final.json";
const BAK_FILE = `${LIVE_FILE}.bak`;
const SUPERSEDED_PATTERN = /^population\.final\..+\.superseded\.json$/;

export type PopulationRecoveryCandidate = {
  fileName: string;
  /** Workstream D extends this with "backup". */
  source: "superseded" | "bak";
  rowCount: number;
  processedAt: string | null;
  /** Live sampled ids present in this candidate. */
  coveredSampledIds: number;
  totalSampledIds: number;
};

export type PopulationRestoreResult =
  | { ok: true; archivedAs: string | null; rowCount: number }
  | { ok: false; reason: "invalid-candidate" | "unreadable" | "failed"; detail?: string };

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
  const processedDir = await openProcessedDir(directoryHandle, monthFolderName);
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
    const read = await safeReadJson<PopulationFinalData>(processedDir, fileName).catch((error: unknown) => {
      logError("population:recovery-read", error);
      return null;
    });
    if (!read?.ok || !Array.isArray(read.value.rows)) continue;
    const ids = rowIds(read.value);
    candidates.push({
      fileName,
      source: fileName === BAK_FILE ? "bak" : "superseded",
      rowCount: read.value.rows.length,
      processedAt: read.value.processedAt ?? null,
      coveredSampledIds: impact.liveSampledIds.filter((id) => ids.has(id)).length,
      totalSampledIds: impact.liveSampledIds.length,
    });
  }
  return candidates;
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

export async function restorePopulationCandidate(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  fileName: string,
  username: string
): Promise<PopulationRestoreResult> {
  if (!isCandidateName(fileName)) return { ok: false, reason: "invalid-candidate" };
  await ensureMonthWritable(directoryHandle, monthFolderName);
  return withResourceLock(manifestLockKey(monthFolderName), () =>
    withWorkspaceWriteAccess(directoryHandle, async (): Promise<PopulationRestoreResult> => {
      try {
        const processedDir = await openProcessedDir(directoryHandle, monthFolderName);
        const read = await safeReadJson<PopulationFinalData>(processedDir, fileName);
        if (!read.ok || !Array.isArray(read.value.rows)) return { ok: false, reason: "unreadable" };
        // Mandatory: the file being replaced is kept, so this restore can itself be undone.
        const archivedAs = await archiveBeforeOverwrite(processedDir, LIVE_FILE, supersedeStamp(), { required: true });
        await safeWriteJson(processedDir, LIVE_FILE, read.value);
        await rebuildPopulationDerivedFiles(
          directoryHandle,
          monthFolderName,
          processedDir,
          read.value.rows as unknown as PreparedPopulationRow[],
          username
        );
        return { ok: true, archivedAs, rowCount: read.value.rows.length };
      } catch (error) {
        logError("population:recovery-restore", error);
        return { ok: false, reason: "failed", detail: error instanceof Error ? error.message : String(error) };
      }
    })
  );
}
