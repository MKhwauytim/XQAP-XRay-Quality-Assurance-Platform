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
 *
 * L1/L2 results may be blank (v159.3): the case enters with "" results. Any
 * other field may be blank too. `buildIncompleteCasesSheet` exports the
 * month's sample cases that still have blanks; when that sheet (or the source
 * file) comes back filled in, a case already in the TARGET month gets each
 * still-blank field filled in place (population and sample, audited per
 * field, v159.4). A recorded value is never overwritten here.
 */
import { projectToDistributionRow } from "../adhocImport/adhocDistributionBridge";
import { EXCEL_FILLABLE_FIELDS, EXCEL_INTO_MONTH_FIELD_CATALOG } from "../adhocImport/adhocFieldCatalog";
import { originalXrayImageIdAnyImport, type AdhocRow } from "../adhocImport/adhocImportModel";
import { listDirectoryEntries } from "../storage/directoryScan";
import { isNotFoundError } from "../storage/transientFileErrors";
import { getSamplesRoot } from "../workspace/workspacePaths";
import { loadOrDeriveDistributionCurrent, refreshDistributionCacheAfterWrite } from "../distribution/distributionStorage";
import { invalidateMonthLockCache, isMonthClosed } from "../population/monthLock";
import { appendPopulationFinalRows, listMonthFolders, loadMonthPopulationFinal } from "../population/populationStorage";
import type { PreparedPopulationRow } from "../population/populationTypes";
import { appendSampleRows, loadSampleMaster } from "../sampling/sampleStorage";
import { applyPopulationFieldCorrections, type FieldChange } from "../population/populationCorrections";
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

/**
 * Original xrayImageId → where it was found. A sample location wins over a
 * population one (v159.7): "in a population only" means the image was never
 * drawn into any sample, so no queue shows it. The planner treats that case
 * in the TARGET month's population as one to add to the sample, not as a
 * duplicate to skip.
 */
export async function buildExistingImageIndex(
  directoryHandle: DirectoryHandleLike
): Promise<Map<string, ExistingLocation>> {
  const index = new Map<string, ExistingLocation>();
  const note = (id: unknown, location: ExistingLocation) => {
    if (typeof id !== "string" || !id) return;
    const original = originalXrayImageIdAnyImport(id);
    const prior = index.get(original);
    if (!prior || (prior.where === "population" && location.where === "sample")) index.set(original, location);
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
  const projected = projectToDistributionRow("excel", row, EXCEL_INTO_MONTH_FIELD_CATALOG, 0);
  const { adhocSourceRowKey: _key, adhocReplicaIndex: _replica, ...rest } = projected;
  void _key;
  void _replica;
  return { ...rest, xrayImageId: row.mapped.xrayImageId as string };
}

export type ExcelRowsPlan = {
  targetMonth: string;
  added: PreparedPopulationRow[];
  /** `assignedTo` (sample locations only): the employee, or null when never distributed. */
  existing: Array<{ xrayImageId: string; location: ExistingLocation; assignedTo?: string | null }>;
  /** Same id twice in the file: only the first is added. */
  repeatedInFile: string[];
  invalid: Array<{ rowKey: string; xrayImageId: string | null; reason: string }>;
  /** Blank fields of cases already in the target month, filled from the file. */
  filled: FieldChange[];
  /**
   * In the target month's population but in no sample anywhere: drawn into the
   * target's sample from the population row as it is (v159.7). Before, these
   * were skipped as «موجودة مسبقاً», so no queue ever showed them.
   */
  fromPopulation: PreparedPopulationRow[];
};


/** Target-month rows by exact id, so a blank result can be found and filled. */
async function loadTargetRows(
  directoryHandle: DirectoryHandleLike,
  targetMonth: string
): Promise<Map<string, Record<string, unknown>>> {
  const byId = new Map<string, Record<string, unknown>>();
  const population = await loadMonthPopulationFinal(directoryHandle, targetMonth);
  // Keyed by the ORIGINAL id: a row merged in from an ad-hoc import keeps its
  // namespaced `ADHOC-…` id on disk, while the file names the original.
  for (const row of population?.rows ?? []) {
    if (typeof row.xrayImageId === "string") byId.set(originalXrayImageIdAnyImport(row.xrayImageId), row as Record<string, unknown>);
  }
  const sample = await loadSampleMaster(directoryHandle, targetMonth);
  for (const row of sample?.rows ?? []) {
    const key = originalXrayImageIdAnyImport(row.xrayImageId);
    if (!byId.has(key)) byId.set(key, row as unknown as Record<string, unknown>);
  }
  return byId;
}

const isBlank = (value: unknown) => value == null || (typeof value === "string" && value.trim() === "");

function blankFieldFills(id: string, existing: Record<string, unknown> | undefined, row: AdhocRow): FieldChange[] {
  if (!existing) return [];
  const out: FieldChange[] = [];
  for (const field of EXCEL_FILLABLE_FIELDS) {
    const incoming = row.mapped[field];
    if (isBlank(existing[field]) && typeof incoming === "string" && !isBlank(incoming)) {
      out.push({ xrayImageId: id, field, oldValue: "", newValue: incoming });
    }
  }
  return out;
}

/** Fields whose blank makes a case "incomplete" for the export. */
const INCOMPLETE_FIELDS = [
  "xrayLevelOneResult", "xrayLevelTwoResult", "xrayEntryDate", "portName", "portType",
  "declarationNumber", "plateOrContainerNumber",
] as const;

/**
 * The month's sample cases with a blank L1/L2 result or key data field, as a
 * sheet whose headers are the catalog's Arabic labels, so uploading it back
 * through this same section maps every column automatically.
 */
export function buildIncompleteCasesSheet(rows: readonly PreparedPopulationRow[]): string[][] {
  const fields = EXCEL_INTO_MONTH_FIELD_CATALOG.filter(
    (field) => field.key === "xrayImageId" || (EXCEL_FILLABLE_FIELDS as readonly string[]).includes(field.key)
  );
  const header = fields.map((field) => field.labelAr);
  const body: string[][] = [];
  for (const row of rows) {
    const record = row as unknown as Record<string, unknown>;
    if (!INCOMPLETE_FIELDS.some((key) => isBlank(record[key]))) continue;
    body.push(fields.map((field) => (isBlank(record[field.key]) ? "" : String(record[field.key]))));
  }
  return [header, ...body];
}

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
  const targetRows = await loadTargetRows(directoryHandle, targetMonth);
  const plan: ExcelRowsPlan = { targetMonth, added: [], existing: [], repeatedInFile: [], invalid: [], filled: [], fromPopulation: [] };
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row.validation.valid) {
      plan.invalid.push({ rowKey: row.rowKey, xrayImageId: row.mapped.xrayImageId ?? null, reason: row.validation.reason });
      continue;
    }
    const id = row.mapped.xrayImageId as string;
    const location = existingIndex.get(id);
    if (location) {
      const inTarget = location.folder === targetMonth && !seen.has(id);
      const existingRow = targetRows.get(id);
      // Fills address the stored id, which may be the namespaced one.
      const storedId = typeof existingRow?.xrayImageId === "string" ? existingRow.xrayImageId : id;
      const fills = inTarget ? blankFieldFills(storedId, existingRow, row) : [];
      const draw = inTarget && location.where === "population" && existingRow !== undefined;
      seen.add(id);
      if (draw) plan.fromPopulation.push(existingRow as unknown as PreparedPopulationRow);
      if (fills.length > 0) plan.filled.push(...fills);
      if (!draw && fills.length === 0) plan.existing.push({ xrayImageId: id, location });
      continue;
    }
    if (seen.has(id)) {
      plan.repeatedInFile.push(id);
      continue;
    }
    seen.add(id);
    plan.added.push(toPopulationRow(row));
  }
  await annotateAssignments(directoryHandle, plan.existing);
  return { ok: true, plan };
}

/**
 * Who each «موجودة» case in a sample is assigned to; null = in the sample but
 * never distributed. The queue lists distributed cases only, so the owner saw
 * «موجودة» and then found nothing when searching the id (v159.10): the report
 * now says which of the two it is.
 */
async function annotateAssignments(
  directoryHandle: DirectoryHandleLike,
  existing: ExcelRowsPlan["existing"]
): Promise<void> {
  const folders = new Set(existing.filter((e) => e.location.where === "sample").map((e) => e.location.folder));
  const byFolder = new Map<string, Map<string, string>>();
  for (const folder of folders) {
    const sample = await loadSampleMaster(directoryHandle, folder);
    const current = await loadOrDeriveDistributionCurrent(directoryHandle, folder, sample?.rows ?? []);
    byFolder.set(folder, new Map(
      (current?.entries ?? [])
        .filter((entry) => entry.status !== "replaced")
        .map((entry) => [originalXrayImageIdAnyImport(entry.xrayImageId), entry.assignedTo])
    ));
  }
  for (const item of existing) {
    if (item.location.where !== "sample") continue;
    item.assignedTo = byFolder.get(item.location.folder)?.get(item.xrayImageId) ?? null;
  }
}

export type ExcelRowsResult =
  | { ok: true; plan: ExcelRowsPlan; addedToSample: number; addedToPopulation: number; filledResults: number; drawnFromPopulation: number }
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
  if (plan.added.length === 0 && plan.filled.length === 0 && plan.fromPopulation.length === 0) {
    return { ok: true, plan, addedToSample: 0, addedToPopulation: 0, filledResults: 0, drawnFromPopulation: 0 };
  }
  try {
    // Population-only cases join the sample first, so a fill below patches
    // their sample copy too.
    let drawnFromPopulation = 0;
    if (plan.fromPopulation.length > 0) {
      const drawn = await appendSampleRows(directoryHandle, targetMonth, plan.fromPopulation);
      if (!drawn.ok) return { ok: false, reason: "write-failed", error: drawn.error };
      drawnFromPopulation = drawn.appended.length;
      await refreshDistributionCacheAfterWrite(directoryHandle, targetMonth, drawn.data.rows);
    }
    let filledResults = 0;
    if (plan.filled.length > 0) {
      const applied = await applyPopulationFieldCorrections({
        directoryHandle, monthFolderName: targetMonth, changes: plan.filled, actorUsername: actor, actorRole: "admin",
      });
      if (!applied.ok) return { ok: false, reason: "write-failed", error: applied.error };
      filledResults = plan.filled.length;
    }
    if (plan.added.length === 0) {
      bumpWorkspaceEpoch(directoryHandle, targetMonth);
      return { ok: true, plan, addedToSample: 0, addedToPopulation: 0, filledResults, drawnFromPopulation };
    }
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
      filledResults,
      drawnFromPopulation,
    };
  } catch (error) {
    return { ok: false, reason: "write-failed", error: error instanceof Error ? error.message : String(error) };
  }
}
