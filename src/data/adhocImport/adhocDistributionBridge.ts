/**
 * THE seam between ad-hoc import and the rest of the app.
 *
 * Everything else under `src/data/adhocImport/` is pure: source tables,
 * mappings, projection, planning, migration. This module is the only one that
 * touches sampling, distribution or answers, and it exists so that traffic is
 * reviewable in one sitting rather than spread across the feature (correction C1
 * in `adhocImportModel.ts`).
 *
 * Ad-hoc emits `PreparedPopulationRow` and `DistributionEvent` not because it
 * goes through the Population pipeline — it deliberately does not — but because
 * those are the shapes `sample.master.json` and `foldDistributionEvents`
 * consume. Writing them here means every downstream consumer (the fold, the
 * per-employee mirrors, answers, referrals, reports, the Power BI export) works
 * on ad-hoc rows unchanged.
 *
 * The synthetic month (`adhoc-{importId}`) is the only difference from a real
 * distribution write. It never matches the real `{month}-{MonthName}-{year}`
 * pattern, so `ensureMonthWritable` fails OPEN for it — no population manifest
 * exists to be "closed" — exactly like any other month with no manifest. That is
 * the existing fail-open behavior, not a bypass, and
 * `adhocImportAssignment.test.ts` proves the gate is still invoked.
 */

import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import type { CertScanMatchStatus, PreparedPopulationRow } from "../population/populationTypes";
import type { SampleMasterData } from "../sampling/sampleTypes";
import { loadSampleMaster, saveSampleMaster } from "../sampling/sampleStorage";
import type { DistributionEvent } from "../distribution/distributionTypes";
import { buildAssignEvent } from "../distribution/distributionLog";
import {
  appendDistributionEvents,
  loadOrDeriveDistributionCurrent,
  refreshDistributionCacheAfterWrite,
} from "../distribution/distributionStorage";
import { findAssignableEmployee } from "../distribution/bulkAssignment";
import { getManagedLoginUsers } from "../../auth/userManagement";
import { adhocMonthFolder, namespacedXrayImageId } from "./adhocImportModel";
import type {
  AdhocField,
  AdhocRecord,
  AdhocRow,
  AdhocRowAssignment,
  PlannedAssignment,
} from "./adhocImportModel";
import { loadAdhocRecord, saveAdhocRecord } from "./adhocImportStorage";

/**
 * A `PreparedPopulationRow` carrying the provenance an ad-hoc row needs and a
 * real population row does not.
 *
 * Both fields ride along as extra properties: every `PreparedPopulationRow`
 * consumer reads named fields and ignores the rest, so nothing downstream has to
 * learn about them, while an agreement analysis over a fanned-out import — "did
 * these six reviewers answer the same image the same way?" — is computable
 * because the replicas can be grouped back onto the source row they came from
 * (plan §3).
 */
export type AdhocPreparedRow = PreparedPopulationRow & {
  /** The `{sheet}:{rowNumber}` every replica of one source row shares. */
  adhocSourceRowKey: string;
  /** Which reviewer copy this is. 0 for every non-fan-out assignment. */
  adhocReplicaIndex: number;
};

/**
 * A field's canonical value, or the fallback when it is unmapped, blank, or (for
 * an enum) not one of the values the catalog declares.
 *
 * The catalog check matters because `mapped` is a plain string bag: a record
 * whose mapping was edited, or one reconstructed by `normalizeAdhocRecord`, can
 * hold a value the catalog no longer offers, and `PreparedPopulationRow`'s
 * strict unions would take it verbatim.
 */
function catalogValue(
  row: AdhocRow,
  catalog: AdhocField[],
  key: string,
  fallback: string
): string {
  const value = row.mapped[key];
  if (value === null || value === undefined || value === "") return fallback;
  const options = catalog.find((field) => field.key === key)?.options;
  if (options && options.length > 0 && !options.includes(value)) return fallback;
  return value;
}

function text(row: AdhocRow, key: string): string | null {
  return row.mapped[key] ?? null;
}

/**
 * `{sheetName}:{sourceRowNumber}`, split at the LAST colon.
 *
 * `sourceRowNumber` is not stored on `AdhocRow` — `rowKey` already carries it,
 * and a second copy is a second thing to keep in step. Splitting at the last
 * colon rather than the first keeps a sheet name containing one intact.
 */
function sourceLocation(rowKey: string): { sheetName: string; rowNumber: number } {
  const at = rowKey.lastIndexOf(":");
  if (at < 0) return { sheetName: rowKey, rowNumber: 0 };
  const rowNumber = Number(rowKey.slice(at + 1));
  return {
    sheetName: rowKey.slice(0, at),
    rowNumber: Number.isFinite(rowNumber) ? rowNumber : 0,
  };
}

/**
 * One ad-hoc row, as the row shape `sample.master.json` and the distribution
 * fold consume. Replaces v1's `toPreparedPopulationRow`.
 *
 * Fields ad-hoc genuinely does not have keep honest, documented defaults rather
 * than fabricated values: no BI file is ever supplied for an ad-hoc import
 * (`biEnrichmentStatus: "BI Not Provided"`), and the L1/L2 reviewer identities
 * and other-team results are the *outcome* of the review this import is
 * requesting, not an input to it.
 *
 * `certScanStatus` is NO LONGER hardcoded (defect G4). v1 stamped every ad-hoc
 * row `"NonCertscan"`, which quietly reported CertScan-scanned images as
 * un-scanned in every report that groups by the field; it is now an ordinary
 * mapped column, with `"NonCertscan"` kept only as the fallback for a file that
 * does not say.
 *
 * **The one place a value is still invented, stated plainly:**
 * `xrayLevelOneResult` / `xrayLevelTwoResult` are typed `"سليمة" | "اشتباه"` and
 * read by 25 non-test files, so there is no representable "unknown". A bare
 * image list (`kind: "sample"`) legitimately carries neither — the reviewer is
 * being asked to produce them, and their real answer lands in `ItemAnswer`, not
 * here. Such a row falls back to `"سليمة"`. An admin who knows the file's L1/L2
 * value declares it once as a `{ kind: "constant" }` source, which is recorded
 * on the import and attributable to a person; that is the intended path, and
 * widening the union is the tier-3 alternative the plan rejected.
 */
export function projectToDistributionRow(
  importId: string,
  row: AdhocRow,
  catalog: AdhocField[],
  replicaIndex: number
): AdhocPreparedRow {
  const originalId = row.mapped.xrayImageId;
  if (!originalId) {
    // A programmer error, not an operator one: every caller filters on
    // `validation.valid`, and the catalog marks `xrayImageId` required.
    throw new Error("projectToDistributionRow requires a validated row (xrayImageId present).");
  }

  const levelOne = catalogValue(row, catalog, "xrayLevelOneResult", "سليمة");
  const levelTwo = catalogValue(row, catalog, "xrayLevelTwoResult", "سليمة");
  const { sheetName, rowNumber } = sourceLocation(row.rowKey);

  return {
    stage: text(row, "stage"),
    xrayImageId: namespacedXrayImageId(importId, originalId, replicaIndex),
    xrayEntryDate: text(row, "xrayEntryDate"),
    portCode: text(row, "portCode"),
    portType: text(row, "portType"),
    portName: text(row, "portName"),
    declarationNumber: text(row, "declarationNumber"),
    declarationDate: text(row, "declarationDate"),
    transitDeclarationNumber: text(row, "transitDeclarationNumber"),
    declarationHijriDate: text(row, "declarationHijriDate"),
    manifestNumber: text(row, "manifestNumber"),
    manifestType: text(row, "manifestType"),
    manifestDate: text(row, "manifestDate"),
    plateOrContainerNumber: text(row, "plateOrContainerNumber"),
    chassisNumber: text(row, "chassisNumber"),
    finalDestination: text(row, "finalDestination"),
    xrayLevelOneResult: levelOne as "سليمة" | "اشتباه",
    xrayLevelTwoResult: levelTwo as "سليمة" | "اشتباه",
    movementType: text(row, "movementType"),
    movementNumber: text(row, "movementNumber"),
    movementDate: text(row, "movementDate"),
    movementHijriDate: text(row, "movementHijriDate"),
    reportNumber: text(row, "reportNumber"),
    entryDate: text(row, "entryDate"),
    exitDate: text(row, "exitDate"),
    targetedByRiskEngine: text(row, "targetedByRiskEngine"),
    riskMessage: text(row, "riskMessage"),
    certScanStatus: catalogValue(row, catalog, "certScanStatus", "NonCertscan") as CertScanMatchStatus,
    // The real pipeline fills these from the CertScan reference list, which an
    // ad-hoc import has no equivalent of.
    certScanSnippet: null,
    originalCertScanSnippet: null,
    levelOneEmployee: text(row, "levelOneEmployee"),
    levelTwoEmployee: text(row, "levelTwoEmployee"),
    otherResults: {
      manual: { result: null, code: null, employeeId: null },
      opposite: { result: null, code: null, employeeId: null },
      liveMeans: { result: null, code: null, employeeId: null },
    },
    notes: null,
    biEnrichmentStatus: "BI Not Provided",
    biMatched: false,
    biFilledFields: [],
    sourceSheetName: sheetName,
    sourceRowNumber: rowNumber,
    adhocSourceRowKey: row.rowKey,
    adhocReplicaIndex: replicaIndex,
  };
}

/**
 * Which replicas of which rows `sample.master.json` must contain.
 *
 * Replica 0 of every valid row is always present — the whole import stays
 * browsable under its synthetic month, which is v1's behavior and what the
 * admin's review table reads. On top of that: every replica already recorded in
 * `row.assignments` (so a re-write never retires a row someone is working on)
 * and every replica the incoming plan is about to name.
 */
function replicaIndicesByRow(record: AdhocRecord, plan: PlannedAssignment[]): Map<string, Set<number>> {
  const byRowKey = new Map<string, Set<number>>();
  const add = (rowKey: string, replicaIndex: number) => {
    const existing = byRowKey.get(rowKey);
    if (existing) existing.add(replicaIndex);
    else byRowKey.set(rowKey, new Set([replicaIndex]));
  };

  for (const row of record.rows) {
    if (!row.validation.valid) continue;
    add(row.rowKey, 0);
    for (const assignment of row.assignments) {
      add(row.rowKey, assignment.replicaIndex);
    }
  }
  for (const planned of plan) {
    // An invalid or unknown rowKey cannot be projected; the assign step filters
    // those out too, so it never ends up referencing a row that is not here.
    if (byRowKey.has(planned.rowKey)) {
      add(planned.rowKey, planned.replicaIndex);
    }
  }
  return byRowKey;
}

/**
 * Writes/refreshes `2-samples/adhoc-{importId}/1-main/sample.master.json` with
 * every row — and every REPLICA — this import can currently reference.
 *
 * This MUST happen before any `assign` event names a row, because
 * `foldDistributionEvents` silently drops an event whose xrayImageId is not
 * found in the sample rows passed to it (see `distributionDerivation.ts`) —
 * skipping this step would make an assignment durably written but invisible.
 * That ordering is why `plan` is a parameter: a fan-out plan's replica ids do
 * not exist on any row yet, so the file has to be rewritten with them *before*
 * the events are appended, not after.
 *
 * Unlike v1 this always rewrites rather than reusing an existing file: a plan
 * that introduces replicas changes the row set, and "the file exists" no longer
 * implies "the file covers what we are about to reference".
 */
export async function ensureAdhocSampleMaster(
  directoryHandle: DirectoryHandleLike,
  record: AdhocRecord,
  plan: PlannedAssignment[] = []
): Promise<AdhocPreparedRow[]> {
  const monthFolderName = adhocMonthFolder(record.importId);
  const indices = replicaIndicesByRow(record, plan);

  const rows: AdhocPreparedRow[] = [];
  for (const row of record.rows) {
    const replicas = indices.get(row.rowKey);
    if (!replicas) continue;
    // Ascending, so the file's row order is a pure function of the record and
    // the plan — a re-run of the same inputs rewrites the same bytes.
    for (const replicaIndex of [...replicas].sort((left, right) => left - right)) {
      rows.push(projectToDistributionRow(record.importId, row, record.fieldCatalog, replicaIndex));
    }
  }

  const certScanActual = rows.filter((row) => row.certScanStatus === "Certscan").length;
  const data: SampleMasterData = {
    // Not a draw: no seed, no apportionment, no algorithm version. Naming it
    // keeps `sample.master.json` readable while making it obvious that replaying
    // this "sample" is not a thing that means anything.
    rngSeed: "adhoc-import",
    totalRequested: rows.length,
    totalActual: rows.length,
    certScanRequested: 0,
    nonCertScanRequested: rows.length - certScanActual,
    certScanActual,
    nonCertScanActual: rows.length - certScanActual,
    portAllocations: [],
    stageAllocations: [],
    drawnAt: record.importedAt,
    drawnBy: record.importedBy,
    rows,
  };

  const result = await saveSampleMaster(directoryHandle, monthFolderName, data);
  if (!result.ok) {
    throw new Error(result.error);
  }
  return rows;
}

export type AssignAdhocPlanResult =
  | { ok: true; assignedCount: number; skippedCount: number; record: AdhocRecord }
  | { ok: false; error: string };

const NO_ELIGIBLE_ROWS = "لا توجد صفوف صالحة قابلة للتعيين ضمن التحديد.";
const ALREADY_ASSIGNED = "كل الصفوف المحددة معيّنة بالفعل.";
const IMPORT_CLOSED = "هذا الاستيراد مُغلق — لا يمكن تعيين المزيد من الصفوف منه.";
const UNASSIGNABLE_EMPLOYEE =
  "الموظف المحدد غير موجود، أو غير نشط، أو لا يملك صلاحية استلام العينات.";

/**
 * Every distinct target in the plan, re-validated against the LIVE roster.
 *
 * Audit finding 6: `assignedTo` used to be trusted as-is (any string). The
 * caller's employee list is a mount-time snapshot, so an account deactivated (or
 * never valid) after the page loaded could still be durably assigned a review —
 * one that account could never log in and complete. The same active +
 * assignable-role rule `calculateBulkAssignment` enforces applies here, and it
 * rejects the WHOLE plan rather than silently dropping one reviewer's slice: a
 * fan-out missing a reviewer is not the distribution the admin asked for.
 */
function allTargetsAssignable(plan: PlannedAssignment[]): boolean {
  const roster = getManagedLoginUsers();
  const usernames = new Set(plan.map((planned) => planned.username));
  return [...usernames].every((username) => findAssignableEmployee(username, roster) !== null);
}

/**
 * Commits a planned assignment to disk.
 *
 * Keeps every safety property of v1's `assignAdhocRowsToEmployee`:
 *
 * - **The caller's record is never trusted.** It is tab React state, potentially
 *   hours old on a shared workspace, while the save below is a whole-document
 *   overwrite. Trusting it meant a stale tab could assign into an import another
 *   machine had CLOSED (and revert its status on save), durably assign a row an
 *   admin had excluded meanwhile, and wipe every other machine's assignment
 *   bookkeeping. The status gate, the row filters and the save base all come
 *   from the freshly-read record.
 * - **The distribution log is the authority on what is already assigned**, not
 *   the record's own bookkeeping — `ownedIds` from `loadOrDeriveDistributionCurrent`,
 *   mirroring `calculateBulkAssignment`'s guard. The record's `assignments` are
 *   checked too, because a row another machine assigned may be bookkept before
 *   this machine's derived cache catches up.
 * - **One shared `eventAt`** across the batch, so a distribution folded from
 *   these events cannot order them by clock jitter.
 * - **Sample rows before events** — see `ensureAdhocSampleMaster`.
 */
export async function assignAdhocPlan(
  directoryHandle: DirectoryHandleLike,
  record: AdhocRecord,
  plan: PlannedAssignment[],
  eventBy: string
): Promise<AssignAdhocPlanResult> {
  const fresh = (await loadAdhocRecord(directoryHandle, record.importId)) ?? record;

  if (fresh.status === "closed") {
    return { ok: false, error: IMPORT_CLOSED };
  }
  if (plan.length === 0) {
    return { ok: false, error: NO_ELIGIBLE_ROWS };
  }
  if (!allTargetsAssignable(plan)) {
    return { ok: false, error: UNASSIGNABLE_EMPLOYEE };
  }

  const rowsByKey = new Map(fresh.rows.map((row) => [row.rowKey, row]));
  const eligible = plan.filter((planned) => {
    const row = rowsByKey.get(planned.rowKey);
    return row !== undefined && row.validation.valid && !row.excludedByAdmin;
  });
  if (eligible.length === 0) {
    return { ok: false, error: NO_ELIGIBLE_ROWS };
  }

  const monthFolderName = adhocMonthFolder(fresh.importId);
  const sampleRows = await ensureAdhocSampleMaster(directoryHandle, fresh, eligible);

  const current = await loadOrDeriveDistributionCurrent(directoryHandle, monthFolderName, sampleRows);
  const ownedIds = new Set((current?.entries ?? []).map((entry) => entry.xrayImageId));

  const sharedEventAt = new Date().toISOString();
  const events: DistributionEvent[] = [];
  const committed: PlannedAssignment[] = [];
  for (const planned of eligible) {
    const row = rowsByKey.get(planned.rowKey);
    const alreadyBookkept = row?.assignments.some(
      (assignment) => assignment.xrayImageId === planned.xrayImageId
    );
    if (alreadyBookkept || ownedIds.has(planned.xrayImageId)) continue;
    // Guards against a plan that names the same replica twice, which would fold
    // as a reassignment of the id to itself.
    if (committed.some((entry) => entry.xrayImageId === planned.xrayImageId)) continue;

    committed.push(planned);
    events.push(
      buildAssignEvent({
        xrayImageId: planned.xrayImageId,
        assignedTo: planned.username,
        eventBy,
        notes: `استيراد يدوي: ${fresh.fileName}`,
        eventAt: sharedEventAt,
      })
    );
  }

  const skippedCount = eligible.length - committed.length;
  if (events.length === 0) {
    return { ok: false, error: ALREADY_ASSIGNED };
  }

  const appendResult = await appendDistributionEvents(directoryHandle, monthFolderName, events);
  if (!appendResult.ok) {
    return { ok: false, error: appendResult.error };
  }

  // A6b: refresh the derived cache + employee sample mirrors after the append,
  // now that pure reads no longer persist them. Swallows its own failure by
  // contract.
  await refreshDistributionCacheAfterWrite(directoryHandle, monthFolderName, sampleRows);

  const newAssignments = new Map<string, AdhocRowAssignment[]>();
  for (const planned of committed) {
    const list = newAssignments.get(planned.rowKey) ?? [];
    list.push({
      username: planned.username,
      replicaIndex: planned.replicaIndex,
      xrayImageId: planned.xrayImageId,
      assignedAt: sharedEventAt,
    });
    newAssignments.set(planned.rowKey, list);
  }

  // Rebuilt from the FRESH rows, so another machine's bookkeeping survives.
  const nextRows: AdhocRow[] = fresh.rows.map((row) => {
    const added = newAssignments.get(row.rowKey);
    return added === undefined ? row : { ...row, assignments: [...row.assignments, ...added] };
  });

  const saved = await saveAdhocRecord(directoryHandle, { ...fresh, rows: nextRows });

  return { ok: true, assignedCount: committed.length, skippedCount, record: saved };
}

/**
 * The sample rows currently on disk for an import, or `null` when it has none
 * yet. A convenience for readers that must not write — `ensureAdhocSampleMaster`
 * is the only writer.
 */
export async function loadAdhocSampleRows(
  directoryHandle: DirectoryHandleLike,
  importId: string
): Promise<PreparedPopulationRow[] | null> {
  const master = await loadSampleMaster(directoryHandle, adhocMonthFolder(importId));
  return master?.rows ?? null;
}
