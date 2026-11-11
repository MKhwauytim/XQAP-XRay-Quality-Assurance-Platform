/**
 * Admin «إضافة للعينة» from Population Browse (owner, 2026-11-11): the rows the
 * browse table currently shows (for example every «المستوى الأول» row) that are
 * not in a sample yet join the month's index sample («مستهدف المؤشر») and are
 * split evenly between the employees the admin picked.
 *
 * Rows are re-read from `population.final.json` by id, never taken from the
 * screen, so what enters the sample is what is on disk. A row counts as already
 * sampled when its id is in the month's sample (live or retired) or in any
 * exceptional-case store, compared by the operator's id.
 *
 * Order: sample rows first, then one `assigned` event per row, exactly as the
 * distribution screen writes. If the events fail, the rows stay in the sample
 * unassigned and show under «غير موزعة», where they can be assigned; a second
 * click skips them rather than adding them twice. The eligibility check is
 * read-then-append with no cross-machine lock, the same exposure
 * `assignUndistributedCases` documents.
 */
import { readUserManagementState } from "../../auth/userManagement";
import { adhocMonthFolder, originalXrayImageIdAnyImport } from "../adhocImport/adhocImportModel";
import { listAdhocStoreImportIds } from "../adhocImport/adhocImportStorage";
import type { EmployeePortRestriction } from "../population/populationConfig";
import { loadMonthPopulationFinal } from "../population/populationStorage";
import type { PreparedPopulationRow } from "../population/populationTypes";
import { appendSampleRows, liveSampleRows, loadSampleMaster } from "../sampling/sampleStorage";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { bumpWorkspaceEpoch } from "../storage/inFlightReads";
import { findAssignableEmployee } from "./bulkAssignment";
import { buildAssignEvent } from "./distributionLog";
import { appendDistributionEvents, refreshDistributionCacheAfterWrite } from "./distributionStorage";
import { isPortEligible, normalizePortName } from "./portEligibility";

type Refusal = { ok: false; error: string };

export type AddToSamplePlan =
  | { ok: true; fresh: string[]; alreadyInSample: number; notInPopulation: number }
  | Refusal;

export type AddToSampleResult =
  /** `unassigned`: added to the sample, but no chosen employee may take that port. */
  | { ok: true; added: number; assigned: number; unassigned: number; skipped: number }
  | Refusal;

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

async function sampledOriginalIds(directoryHandle: DirectoryHandleLike, month: string): Promise<Set<string> | null> {
  const sample = await loadSampleMaster(directoryHandle, month);
  if (!sample) return null;
  const ids = new Set(sample.rows.map((row) => originalXrayImageIdAnyImport(row.xrayImageId)));
  for (const importId of await listAdhocStoreImportIds(directoryHandle)) {
    const store = await loadSampleMaster(directoryHandle, adhocMonthFolder(importId));
    for (const row of store?.rows ?? []) ids.add(originalXrayImageIdAnyImport(row.xrayImageId));
  }
  return ids;
}

async function freshPopulationRows(
  directoryHandle: DirectoryHandleLike,
  month: string,
  ids: readonly string[]
): Promise<{ ok: true; rows: PreparedPopulationRow[]; alreadyInSample: number; notInPopulation: number } | Refusal> {
  const sampled = await sampledOriginalIds(directoryHandle, month);
  if (!sampled) return { ok: false, error: "لا توجد عينة مسحوبة لهذا الشهر. اسحب العينة أولاً." };
  const population = await loadMonthPopulationFinal(directoryHandle, month);
  if (!population) return { ok: false, error: "تعذر تحميل بيانات مجتمع هذا الشهر." };
  const byId = new Map((population.rows as unknown as PreparedPopulationRow[]).map((row) => [row.xrayImageId, row]));
  const rows: PreparedPopulationRow[] = [];
  let alreadyInSample = 0;
  let notInPopulation = 0;
  for (const id of new Set(ids)) {
    const row = byId.get(id);
    if (!row) notInPopulation += 1;
    else if (sampled.has(originalXrayImageIdAnyImport(id))) alreadyInSample += 1;
    else rows.push(row);
  }
  return { ok: true, rows, alreadyInSample, notInPopulation };
}

/** What a click would add, for the confirmation dialog. Reads only. */
export async function planPopulationRowsIntoSample(
  directoryHandle: DirectoryHandleLike,
  month: string,
  ids: readonly string[]
): Promise<AddToSamplePlan> {
  try {
    const fresh = await freshPopulationRows(directoryHandle, month, ids);
    if (!fresh.ok) return fresh;
    return { ok: true, fresh: fresh.rows.map((row) => row.xrayImageId), alreadyInSample: fresh.alreadyInSample, notInPopulation: fresh.notInPopulation };
  } catch (error) {
    return { ok: false, error: errorText(error) };
  }
}

/** Each row goes to the eligible employee holding the fewest rows of this batch; ties follow the chosen order. */
function splitEvenly(
  rows: readonly PreparedPopulationRow[],
  employees: readonly string[],
  portRestrictions: EmployeePortRestriction[]
): Map<string, string> {
  const load = new Map(employees.map((username) => [username, 0]));
  const owners = new Map<string, string>();
  for (const row of rows) {
    const port = normalizePortName(row.portName);
    const eligible = employees.filter((username) => isPortEligible(username, port, portRestrictions));
    if (eligible.length === 0) continue;
    const owner = eligible.reduce((best, username) => (load.get(username)! < load.get(best)! ? username : best));
    load.set(owner, load.get(owner)! + 1);
    owners.set(row.xrayImageId, owner);
  }
  return owners;
}

export async function addPopulationRowsToSample(
  directoryHandle: DirectoryHandleLike,
  month: string,
  ids: readonly string[],
  employees: readonly string[],
  portRestrictions: EmployeePortRestriction[],
  actor: string,
  now: Date = new Date()
): Promise<AddToSampleResult> {
  const chosen = [...new Set(employees)];
  if (chosen.length === 0) return { ok: false, error: "اختر موظفاً واحداً على الأقل." };
  const roster = readUserManagementState().users;
  if (chosen.some((username) => !findAssignableEmployee(username, roster))) {
    return { ok: false, error: "أحد الموظفين المحددين غير موجود، أو غير نشط، أو لا يملك صلاحية استلام العينات." };
  }
  try {
    const fresh = await freshPopulationRows(directoryHandle, month, ids);
    if (!fresh.ok) return fresh;
    const skipped = fresh.alreadyInSample + fresh.notInPopulation;
    if (fresh.rows.length === 0) return { ok: true, added: 0, assigned: 0, unassigned: 0, skipped };

    const appended = await appendSampleRows(directoryHandle, month, fresh.rows);
    if (!appended.ok) return appended;
    const added = new Set(appended.appended);
    const owners = splitEvenly(fresh.rows.filter((row) => added.has(row.xrayImageId)), chosen, portRestrictions);
    if (owners.size > 0) {
      const eventAt = now.toISOString();
      const events = [...owners].map(([xrayImageId, assignedTo]) => buildAssignEvent({ xrayImageId, assignedTo, eventBy: actor, eventAt }));
      const written = await appendDistributionEvents(directoryHandle, month, events);
      if (!written.ok) {
        return { ok: false, error: `أُضيفت ${added.size} حالة إلى العينة لكن تعذّر توزيعها، وتظهر الآن ضمن «غير موزعة»: ${written.error}` };
      }
    }
    await refreshDistributionCacheAfterWrite(directoryHandle, month, liveSampleRows(appended.data));
    bumpWorkspaceEpoch(directoryHandle, month);
    return { ok: true, added: added.size, assigned: owners.size, unassigned: added.size - owners.size, skipped: skipped + (fresh.rows.length - added.size) };
  } catch (error) {
    return { ok: false, error: errorText(error) };
  }
}
