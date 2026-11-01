/**
 * Admin «إضافة حالات من ملف إكسل إلى شهر»: rows read through the ad-hoc
 * workbench's parser (`adhocSourceTable` → `autoDetectMapping` →
 * `projectTable`) are added to a month's population AND sample under their
 * ORIGINAL xrayImageId — unless that image is already anywhere in the
 * workspace. "Anywhere" is every month's population and sample, and every
 * ad-hoc store's sample, compared by original id, so an image that reached a
 * month as `ADHOC-…-{id}` through a merged ad-hoc import is recognized too.
 *
 * Added rows carry no assignment; they are distributed from the normal
 * distribution screen afterwards.
 */
import { projectToDistributionRow } from "../adhocImport/adhocDistributionBridge";
import { ADHOC_FIELD_CATALOG } from "../adhocImport/adhocFieldCatalog";
import { originalXrayImageIdAnyImport, type AdhocRow } from "../adhocImport/adhocImportModel";
import { listDirectoryEntries } from "../storage/directoryScan";
import { isNotFoundError } from "../storage/transientFileErrors";
import { getSamplesRoot } from "../workspace/workspacePaths";
import { refreshDistributionCacheAfterWrite } from "../distribution/distributionStorage";
import { invalidateMonthLockCache, isMonthClosed } from "../population/monthLock";
import { appendPopulationFinalRows, listMonthFolders, loadMonthPopulationFinal } from "../population/populationStorage";
import type { PreparedPopulationRow } from "../population/populationTypes";
import { appendSampleRows, loadSampleMaster } from "../sampling/sampleStorage";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { bumpWorkspaceEpoch } from "../storage/inFlightReads";

/** Where an image already is: a month or ad-hoc folder, and which file. */
export type ExistingLocation = { folder: string; where: "population" | "sample" };

async function listSampleFolders(directoryHandle: DirectoryHandleLike): Promise<string[]> {
  let root: DirectoryHandleLike;
  try {
    root = await getSamplesRoot(directoryHandle, false);
  } catch (error) {
    if (isNotFoundError(error)) return [];
    throw error;
  }
  return (await listDirectoryEntries(root)).filter((entry) => entry.kind === "directory").map((entry) => entry.name);
}

/** Original xrayImageId → first place it was found. */
export async function buildExistingImageIndex(
  directoryHandle: DirectoryHandleLike
): Promise<Map<string, ExistingLocation>> {
  const index = new Map<string, ExistingLocation>();
  const note = (id: unknown, location: ExistingLocation) => {
    if (typeof id !== "string" || !id) return;
    const original = originalXrayImageIdAnyImport(id);
    if (!index.has(original)) index.set(original, location);
  };
  const populationMonths = (await listMonthFolders(directoryHandle)).map((entry) => entry.folderName);
  for (const folder of populationMonths) {
    const population = await loadMonthPopulationFinal(directoryHandle, folder);
    for (const row of population?.rows ?? []) note(row.xrayImageId, { folder, where: "population" });
  }
  // Every folder under 2-samples/ — months (with or without a population) and
  // ad-hoc stores alike.
  for (const folder of await listSampleFolders(directoryHandle)) {
    const sample = await loadSampleMaster(directoryHandle, folder);
    for (const row of sample?.rows ?? []) note(row.xrayImageId, { folder, where: "sample" });
  }
  return index;
}

/** A valid workbench row as a population row under its original id. */
function toPopulationRow(row: AdhocRow): PreparedPopulationRow {
  const projected = projectToDistributionRow("excel", row, ADHOC_FIELD_CATALOG, 0);
  const { adhocSourceRowKey: _key, adhocReplicaIndex: _replica, ...rest } = projected;
  void _key;
  void _replica;
  return { ...rest, xrayImageId: row.mapped.xrayImageId as string };
}

export type ExcelRowsPlan = {
  targetMonth: string;
  added: PreparedPopulationRow[];
  existing: Array<{ xrayImageId: string; location: ExistingLocation }>;
  /** Same id twice in the file: only the first is added. */
  repeatedInFile: string[];
  invalid: Array<{ rowKey: string; xrayImageId: string | null; reason: string }>;
};

export type ExcelRowsPlanResult =
  | { ok: true; plan: ExcelRowsPlan }
  | { ok: false; reason: "target-no-sample" | "target-closed" };

/** Read-only: which rows would be added and which are already in the workspace. */
export async function planExcelRowsIntoMonth(
  directoryHandle: DirectoryHandleLike,
  rows: readonly AdhocRow[],
  targetMonth: string
): Promise<ExcelRowsPlanResult> {
  invalidateMonthLockCache();
  if (await isMonthClosed(directoryHandle, targetMonth).catch(() => false)) return { ok: false, reason: "target-closed" };
  if (!(await loadSampleMaster(directoryHandle, targetMonth))) return { ok: false, reason: "target-no-sample" };

  const existingIndex = await buildExistingImageIndex(directoryHandle);
  const plan: ExcelRowsPlan = { targetMonth, added: [], existing: [], repeatedInFile: [], invalid: [] };
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row.validation.valid) {
      plan.invalid.push({ rowKey: row.rowKey, xrayImageId: row.mapped.xrayImageId ?? null, reason: row.validation.reason });
      continue;
    }
    const id = row.mapped.xrayImageId as string;
    const location = existingIndex.get(id);
    if (location) {
      plan.existing.push({ xrayImageId: id, location });
      continue;
    }
    if (seen.has(id)) {
      plan.repeatedInFile.push(id);
      continue;
    }
    seen.add(id);
    plan.added.push(toPopulationRow(row));
  }
  return { ok: true, plan };
}

export type ExcelRowsResult =
  | { ok: true; plan: ExcelRowsPlan; addedToSample: number; addedToPopulation: number }
  | { ok: false; reason: "target-no-sample" | "target-closed" }
  | { ok: false; reason: "write-failed"; error: string };

/** Re-plans from disk, then appends the new rows to population, then sample. */
export async function executeExcelRowsIntoMonth(
  directoryHandle: DirectoryHandleLike,
  rows: readonly AdhocRow[],
  targetMonth: string,
  actor: string
): Promise<ExcelRowsResult> {
  const planned = await planExcelRowsIntoMonth(directoryHandle, rows, targetMonth);
  if (!planned.ok) return planned;
  const { plan } = planned;
  if (plan.added.length === 0) return { ok: true, plan, addedToSample: 0, addedToPopulation: 0 };
  try {
    const population = await appendPopulationFinalRows(
      directoryHandle,
      targetMonth,
      plan.added as unknown as Array<Record<string, unknown>>,
      actor
    );
    const sample = await appendSampleRows(directoryHandle, targetMonth, plan.added);
    if (!sample.ok) return { ok: false, reason: "write-failed", error: sample.error };
    await refreshDistributionCacheAfterWrite(directoryHandle, targetMonth, sample.data.rows);
    bumpWorkspaceEpoch(directoryHandle, targetMonth);
    return {
      ok: true,
      plan,
      addedToSample: sample.appended.length,
      addedToPopulation: population.status === "appended" ? population.appended : 0,
    };
  } catch (error) {
    return { ok: false, reason: "write-failed", error: error instanceof Error ? error.message : String(error) };
  }
}
