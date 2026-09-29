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
import { parseMonthFolderName } from "../population/monthFolder";
import type { PopulationFinalData } from "../population/monthTypes";
import { assessPopulationOverwrite, loadPopulationOverwriteImpact } from "../population/populationOverwriteGuard";
import { liveSampleRows } from "../sampling/sampleStorage";
import type { SampleMasterData } from "../sampling/sampleTypes";
import {
  LEGACY_MONTH_SUBFOLDERS,
  LEGACY_WORKSPACE_ROOTS,
  POPULATION_SUBFOLDERS,
  SAMPLE_SUBFOLDERS,
  WORKSPACE_ROOTS,
} from "../workspace/workspacePaths";
import { isSnapshotPayloadFile, openCompleteBackupJsonDir, restoreActionFor } from "./backupStorage";
import {
  classifyBackupPath,
  expandRestoreScope,
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
