/**
 * Selective backup restore — preview, dependency plan and scoped run
 * (Workstream D, 2026-09-28). The element catalog lives in restoreScope.ts; the
 * copy walk is backupStorage.ts's restoreBackupSnapshot with a `scope`. This
 * module never copies a workspace file itself.
 */
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { listDirectoryEntries } from "../storage/directoryScan";
import { safeReadJson } from "../storage/safeWrite";
import { isNotFoundError } from "../storage/transientFileErrors";
import { logError } from "../storage/errorLogger";
import {
  invalidateDistributionCacheForFieldEdit,
  refreshDistributionCacheAfterWrite,
} from "../distribution/distributionStorage";
import type { OrphanScanResult } from "../integrity/orphanScan";
import { runMonthIntegrityScan } from "../integrity/orphanScanLoader";
import { parseMonthFolderName, type MonthFolderInfo } from "../population/monthFolder";
import { invalidateMonthLockCache } from "../population/monthLock";
import type { PopulationFinalData } from "../population/monthTypes";
import { discardPopulationAggregate } from "../population/populationAggregate";
import { assessPopulationOverwrite, loadPopulationOverwriteImpact } from "../population/populationOverwriteGuard";
import { rebuildPopulationDerivedFiles } from "../population/populationRecovery";
import { archiveBeforeOverwrite, readMonthPopulationFinal, supersedeStamp } from "../population/populationStorage";
import type { PreparedPopulationRow } from "../population/populationTypes";
import { discardReplacementIndexManifest } from "../population/replacementIndexStorage";
import { liveSampleRows, loadSampleMaster } from "../sampling/sampleStorage";
import type { SampleMasterData } from "../sampling/sampleTypes";
import {
  getPopulationMonthDir,
  LEGACY_MONTH_SUBFOLDERS,
  LEGACY_WORKSPACE_ROOTS,
  POPULATION_SUBFOLDERS,
  SAMPLE_SUBFOLDERS,
  WORKSPACE_ROOTS,
} from "../workspace/workspacePaths";
import {
  isSnapshotPayloadFile,
  openCompleteBackupJsonDir,
  restoreActionFor,
  restoreBackupSnapshot,
} from "./backupStorage";
import {
  classifyBackupPath,
  expandRestoreScope,
  isMonthScopedElement,
  RESTORE_ELEMENT_IDS,
  validateRestoreScope,
  type RestoreElementId,
  type RestoreScope,
  type RestoreScopeCell,
  type RestoreScopeProblem,
} from "./restoreScope";

export type RestorePreviewCell = {
  element: RestoreElementId;
  month: string | null;
  fileCount: number;
};

export type RestorePreview = {
  backupFolderName: string;
  /** Month folders the backup holds restorable month-scoped files for, oldest first. */
  months: string[];
  cells: RestorePreviewCell[];
  /** Payload files no element owns — only a FULL restore puts these back. */
  unclassifiedCount: number;
};

/** Real `{m}-{month}-{yyyy}` folders chronologically, then anything else (ad-hoc stores) by name. */
export function compareMonthFolderNames(a: string, b: string): number {
  const left = parseMonthFolderName(a);
  const right = parseMonthFolderName(b);
  if (left && right) return left.year - right.year || left.month - right.month;
  if (left) return -1;
  if (right) return 1;
  return a.localeCompare(b);
}

/** Every path the restore walk would act on: payload files that are not skip-derived. */
async function listRestorablePaths(dir: DirectoryHandleLike, prefix: string, out: string[]): Promise<void> {
  for (const entry of await listDirectoryEntries(dir)) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.kind === "directory") {
      await listRestorablePaths(await dir.getDirectoryHandle(entry.name, { create: false }), path, out);
      continue;
    }
    if (isSnapshotPayloadFile(entry.name) && restoreActionFor(entry.name) !== "skip-derived") out.push(path);
  }
}

const ELEMENT_ORDER: ReadonlyMap<RestoreElementId, number> = new Map(
  RESTORE_ELEMENT_IDS.map((id, index) => [id, index] as const)
);

/** Names only — no file is read. */
export async function previewSelectiveRestore(
  directoryHandle: DirectoryHandleLike,
  backupFolderName: string
): Promise<RestorePreview> {
  const jsonDir = await openCompleteBackupJsonDir(directoryHandle, backupFolderName);
  const paths: string[] = [];
  await listRestorablePaths(jsonDir, "", paths);

  const cells = new Map<string, RestorePreviewCell>();
  const months = new Set<string>();
  let unclassifiedCount = 0;
  for (const path of paths) {
    const classified = classifyBackupPath(path);
    if (!classified) {
      unclassifiedCount += 1;
      continue;
    }
    if (classified.derived) continue;
    const key = `${classified.element}|${classified.month ?? ""}`;
    const cell = cells.get(key) ?? { element: classified.element, month: classified.month, fileCount: 0 };
    cell.fileCount += 1;
    cells.set(key, cell);
    if (classified.month !== null) months.add(classified.month);
  }

  const orderedCells = [...cells.values()].sort(
    (a, b) =>
      (ELEMENT_ORDER.get(a.element) ?? 0) - (ELEMENT_ORDER.get(b.element) ?? 0) ||
      compareMonthFolderNames(a.month ?? "", b.month ?? "")
  );
  return {
    backupFolderName,
    months: [...months].sort(compareMonthFolderNames),
    cells: orderedCells,
    unclassifiedCount,
  };
}

export function countPreviewFiles(
  preview: RestorePreview,
  element: RestoreElementId,
  month: string | null
): number {
  return preview.cells.find((cell) => cell.element === element && cell.month === month)?.fileCount ?? 0;
}

/* ───────────── reading single files out of a backup's json/ mirror ───────────── */

type TreeRead<T> = { state: "ok"; value: T } | { state: "missing" } | { state: "corrupt" };

async function readJsonInTree<T>(base: DirectoryHandleLike, segments: readonly string[]): Promise<TreeRead<T>> {
  let dir = base;
  try {
    for (const segment of segments.slice(0, -1)) dir = await dir.getDirectoryHandle(segment, { create: false });
    const result = await safeReadJson<T>(dir, segments[segments.length - 1]);
    return result.ok ? { state: "ok", value: result.value } : { state: result.reason };
  } catch (error) {
    if (isNotFoundError(error)) return { state: "missing" };
    throw error;
  }
}

/** First candidate that exists wins — numbered layout first, then its legacy aliases. */
async function readFirstInTree<T>(
  base: DirectoryHandleLike,
  candidates: ReadonlyArray<readonly string[]>
): Promise<TreeRead<T>> {
  for (const candidate of candidates) {
    const read = await readJsonInTree<T>(base, candidate);
    if (read.state !== "missing") return read;
  }
  return { state: "missing" };
}

const POPULATION_ROOT_NAMES = [WORKSPACE_ROOTS.population, LEGACY_WORKSPACE_ROOTS.population] as const;

function backupPopulationCandidates(month: string): string[][] {
  return POPULATION_ROOT_NAMES.flatMap((root) => [
    [root, month, POPULATION_SUBFOLDERS.processed, "population.final.json"],
    [root, month, LEGACY_MONTH_SUBFOLDERS.processed, "population.final.json"],
    [root, month, "population.final.json"],
  ]);
}

function backupSampleCandidates(month: string): string[][] {
  return [
    [WORKSPACE_ROOTS.samples, month, SAMPLE_SUBFOLDERS.main, "sample.master.json"],
    ...POPULATION_ROOT_NAMES.flatMap((root) => [
      [root, month, LEGACY_MONTH_SUBFOLDERS.sample, "sample.master.json"],
      [root, month, "sample.master.json"],
    ]),
  ];
}

/* ───────────── the dependency plan ───────────── */

export type SelectiveRestoreSelection = RestoreScopeCell & { fileCount: number };

export type SelectiveRestoreBlock = {
  month: string;
  sampledCount: number;
  missingCount: number;
  missingExamples: string[];
};

export type SelectiveRestoreWarning = {
  kind: "sample-without-answers" | "answers-without-sample";
  month: string;
};

export type SelectiveRestorePlan = {
  scope: RestoreScope;
  invalidReason: RestoreScopeProblem | null;
  selections: SelectiveRestoreSelection[];
  selectedFileCount: number;
  /** Selected element × month cells the backup holds no file for. */
  emptySelections: RestoreScopeCell[];
  /** Months whose population restore would orphan live sampled ids (A2's rule). */
  blocked: SelectiveRestoreBlock[];
  warnings: SelectiveRestoreWarning[];
  canConfirm: boolean;
};

/**
 * The sampled ids that will be LIVE once the restore lands: the backup's own
 * sample when this restore also puts back Sample & distribution for the month
 * (and the backup has one), otherwise the live ones A2's impact already holds.
 */
async function sampledIdsAfterRestore(
  jsonDir: DirectoryHandleLike,
  month: string,
  restoresSample: boolean,
  liveSampledIds: string[]
): Promise<string[]> {
  if (!restoresSample) return liveSampledIds;
  const backupSample = await readFirstInTree<SampleMasterData>(jsonDir, backupSampleCandidates(month));
  return backupSample.state === "ok"
    ? liveSampleRows(backupSample.value).map((row) => row.xrayImageId)
    : liveSampledIds;
}

/**
 * A2's rule, through Workstream A's own guard: a population restore for a month
 * with a distribution or any answer is allowed only if every sampled id exists
 * in the backup's population. A corrupt backup population covers nothing.
 */
async function populationCoverageBlocks(
  directoryHandle: DirectoryHandleLike,
  backupFolderName: string,
  scope: RestoreScope
): Promise<SelectiveRestoreBlock[]> {
  if (!scope.elements.includes("population")) return [];
  const jsonDir = await openCompleteBackupJsonDir(directoryHandle, backupFolderName);
  const restoresSample = scope.elements.includes("sampleDistribution");
  const blocks: SelectiveRestoreBlock[] = [];
  for (const month of scope.months) {
    const backupPopulation = await readFirstInTree<PopulationFinalData>(jsonDir, backupPopulationCandidates(month));
    // No population.final.json in the backup: the live one is not replaced, so nothing can be orphaned.
    if (backupPopulation.state === "missing") continue;
    const impact = await loadPopulationOverwriteImpact(directoryHandle, month);
    const liveSampledIds = await sampledIdsAfterRestore(jsonDir, month, restoresSample, impact.liveSampledIds);
    const newRows =
      backupPopulation.state === "ok" && Array.isArray(backupPopulation.value.rows) ? backupPopulation.value.rows : [];
    const assessment = assessPopulationOverwrite({ ...impact, liveSampledIds }, newRows);
    if (assessment.blocked) {
      blocks.push({
        month,
        sampledCount: liveSampledIds.length,
        missingCount: assessment.missingCount,
        missingExamples: assessment.missingExamples,
      });
    }
  }
  return blocks;
}

function dependencyWarnings(scope: RestoreScope): SelectiveRestoreWarning[] {
  const hasSample = scope.elements.includes("sampleDistribution");
  const hasAnswers = scope.elements.includes("answers");
  if (hasSample === hasAnswers) return [];
  const kind = hasSample ? "sample-without-answers" : "answers-without-sample";
  return scope.months.map((month) => ({ kind, month }));
}

export async function planSelectiveRestore(params: {
  directoryHandle: DirectoryHandleLike;
  backupFolderName: string;
  scope: RestoreScope;
  /** Reuse an already-loaded preview of the SAME backup (the dialog's). */
  preview?: RestorePreview;
}): Promise<SelectiveRestorePlan> {
  const { scope } = params;
  const invalidReason = validateRestoreScope(scope);
  if (invalidReason) {
    return {
      scope,
      invalidReason,
      selections: [],
      selectedFileCount: 0,
      emptySelections: [],
      blocked: [],
      warnings: [],
      canConfirm: false,
    };
  }
  const preview =
    params.preview && params.preview.backupFolderName === params.backupFolderName
      ? params.preview
      : await previewSelectiveRestore(params.directoryHandle, params.backupFolderName);
  const selections = expandRestoreScope(scope).map((cell) => ({
    ...cell,
    fileCount: countPreviewFiles(preview, cell.element, cell.month),
  }));
  const emptySelections = selections
    .filter((selection) => selection.fileCount === 0)
    .map(({ element, month }) => ({ element, month }));
  const selectedFileCount = selections.reduce((sum, selection) => sum + selection.fileCount, 0);
  const blocked = await populationCoverageBlocks(params.directoryHandle, params.backupFolderName, scope);
  return {
    scope,
    invalidReason: null,
    selections,
    selectedFileCount,
    emptySelections,
    blocked,
    warnings: dependencyWarnings(scope),
    canConfirm: selectedFileCount > 0 && emptySelections.length === 0 && blocked.length === 0,
  };
}

/* ───────────── the scoped run ───────────── */

export type SelectiveRestoreIntegrity = {
  month: string;
  result: OrphanScanResult | null;
  error: string | null;
};

export type SelectiveRestoreOutcome =
  | { ok: true; restoredFiles: string[]; rollbackFolderName: string; integrity: SelectiveRestoreIntegrity[] }
  | { ok: false; reason: "plan-rejected"; plan: SelectiveRestorePlan }
  | { ok: false; reason: "restore-failed"; error: string };

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Months the engine actually wrote files of `element` into — read off its own restoredFiles. */
function restoredMonthsFor(restoredFiles: readonly string[], element: RestoreElementId): Set<string> {
  const months = new Set<string>();
  for (const path of restoredFiles) {
    const classified = classifyBackupPath(path);
    if (classified && classified.element === element && classified.month !== null) months.add(classified.month);
  }
  return months;
}

/**
 * The replacement-candidate index and the month aggregate were deliberately
 * NOT copied (restoreScope marks them derived). Rebuild them through Workstream
 * A's `rebuildPopulationDerivedFiles` — the single post-restore rebuild A2
 * exported for D — after clearing what would block or mislead it (see Task 5's
 * note on the monotonic guard). Best-effort: the restored data is already on
 * disk, so a failure here is logged, never reported as a failed restore.
 */
async function rebuildPopulationDerived(
  directoryHandle: DirectoryHandleLike,
  month: string,
  username: string
): Promise<void> {
  // month.manifest.json (status/lock) may have come back with the population.
  invalidateMonthLockCache(month);
  await discardReplacementIndexManifest(directoryHandle, month);
  await discardPopulationAggregate(directoryHandle, month);
  try {
    const outcome = await readMonthPopulationFinal(directoryHandle, month);
    if (outcome.status !== "loaded") return;
    const monthDir = await getPopulationMonthDir(directoryHandle, month, false);
    const processedDir = await monthDir.getDirectoryHandle(POPULATION_SUBFOLDERS.processed, { create: false });
    await rebuildPopulationDerivedFiles(
      directoryHandle,
      month,
      processedDir,
      outcome.value.rows as unknown as PreparedPopulationRow[],
      username
    );
  } catch (error) {
    logError("backup:selective-rebuild-population", error);
  }
}

/** distribution.current.json + checkpoint + employee mirrors, refolded from the restored events. */
async function rebuildDistributionDerived(directoryHandle: DirectoryHandleLike, month: string): Promise<void> {
  try {
    await invalidateDistributionCacheForFieldEdit(directoryHandle, month);
    const sample = await loadSampleMaster(directoryHandle, month);
    await refreshDistributionCacheAfterWrite(directoryHandle, month, sample?.rows ?? []);
  } catch (error) {
    logError("backup:selective-rebuild-distribution", error);
  }
}

const LIVE_POPULATION_FILE = "population.final.json";

/**
 * Where a month's live population.final.json sits: the numbered `2-processed/`,
 * else the legacy `processed/`, else flat in the month folder (oldest layout).
 * Null when the month has none (nothing to protect).
 */
async function findLivePopulationDir(
  directoryHandle: DirectoryHandleLike,
  month: string
): Promise<DirectoryHandleLike | null> {
  let monthDir: DirectoryHandleLike;
  try {
    monthDir = await getPopulationMonthDir(directoryHandle, month, false);
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
  const candidates: Array<string | null> = [POPULATION_SUBFOLDERS.processed, LEGACY_MONTH_SUBFOLDERS.processed, null];
  for (const name of candidates) {
    let dir: DirectoryHandleLike;
    try {
      dir = name === null ? monthDir : await monthDir.getDirectoryHandle(name, { create: false });
    } catch (error) {
      if (isNotFoundError(error)) continue;
      throw error;
    }
    if ((await listDirectoryEntries(dir)).some((entry) => entry.name === LIVE_POPULATION_FILE)) return dir;
  }
  return null;
}

/**
 * Population rule (same as A2's recovery): the live population.final.json is
 * ARCHIVED next to itself (`...superseded.json`, never deleted) before a
 * restore overwrites it, so the restore can itself be undone from Settings ->
 * «استعادة المجتمع السابق». Returns an error text when a live file could not be
 * archived (the restore must then not start), else null.
 */
async function archiveLivePopulations(
  directoryHandle: DirectoryHandleLike,
  months: readonly string[]
): Promise<string | null> {
  for (const month of months) {
    try {
      const dir = await findLivePopulationDir(directoryHandle, month);
      if (!dir) continue;
      const archivedAs = await archiveBeforeOverwrite(dir, LIVE_POPULATION_FILE, supersedeStamp(), {
        required: true,
        retryMissingSource: true,
      });
      if (archivedAs === null) return `${month}: ${LIVE_POPULATION_FILE} could not be archived before the restore.`;
    } catch (error) {
      logError("backup:selective-archive-population", error);
      return `${month}: ${errorText(error)}`;
    }
  }
  return null;
}

/**
 * Selective restore, end to end. Re-plans from disk first (never trusts the
 * dialog's earlier plan), then runs the SAME engine as a full restore with a
 * scope — assertBackupComplete, full pre-restore rollback backup, sentinel,
 * restoreActionFor semantics — then rebuilds derived caches for the months it
 * actually touched and runs the B3 integrity scan for every selected month.
 */
export async function runSelectiveRestore(params: {
  directoryHandle: DirectoryHandleLike;
  months: MonthFolderInfo[];
  backupFolderName: string;
  username: string;
  scope: RestoreScope;
}): Promise<SelectiveRestoreOutcome> {
  let plan: SelectiveRestorePlan;
  try {
    plan = await planSelectiveRestore({
      directoryHandle: params.directoryHandle,
      backupFolderName: params.backupFolderName,
      scope: params.scope,
    });
  } catch (error) {
    return { ok: false, reason: "restore-failed", error: errorText(error) };
  }
  if (!plan.canConfirm) return { ok: false, reason: "plan-rejected", plan };

  // Before ANY mutation (rollback backup, sentinel, walk): archive, never delete.
  if (params.scope.elements.includes("population")) {
    const archiveError = await archiveLivePopulations(params.directoryHandle, params.scope.months);
    if (archiveError) return { ok: false, reason: "restore-failed", error: archiveError };
  }

  const result = await restoreBackupSnapshot({
    directoryHandle: params.directoryHandle,
    months: params.months,
    backupFolderName: params.backupFolderName,
    username: params.username,
    scope: params.scope,
  });
  if (!result.ok) return { ok: false, reason: "restore-failed", error: result.error };

  for (const month of restoredMonthsFor(result.restoredFiles, "population")) {
    await rebuildPopulationDerived(params.directoryHandle, month, params.username);
  }
  for (const month of restoredMonthsFor(result.restoredFiles, "sampleDistribution")) {
    await rebuildDistributionDerived(params.directoryHandle, month);
  }

  const integrity: SelectiveRestoreIntegrity[] = [];
  const scannedMonths = params.scope.elements.some((element) => isMonthScopedElement(element))
    ? params.scope.months
    : [];
  for (const month of scannedMonths) {
    try {
      integrity.push({ month, result: await runMonthIntegrityScan(params.directoryHandle, month), error: null });
    } catch (error) {
      integrity.push({ month, result: null, error: errorText(error) });
    }
  }

  return {
    ok: true,
    restoredFiles: result.restoredFiles,
    rollbackFolderName: result.rollbackFolderName,
    integrity,
  };
}
