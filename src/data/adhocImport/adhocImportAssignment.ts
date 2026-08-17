import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import type { PreparedPopulationRow } from "../population/populationTypes";
import type { SampleMasterData } from "../sampling/sampleTypes";
import { loadSampleMaster, saveSampleMaster } from "../sampling/sampleStorage";
import { buildAssignEvent } from "../distribution/distributionLog";
import { appendDistributionEvents, loadOrDeriveDistributionCurrent, refreshDistributionCacheAfterWrite } from "../distribution/distributionStorage";
import { findAssignableEmployee } from "../distribution/bulkAssignment";
import { getManagedLoginUsers } from "../../auth/userManagement";
import type { NormalizedRiskRow } from "../../components/Sidebar/Tabs/Population/riskData/riskDataTypes";
import { adhocMonthFolderName, type AdhocImportRecord, type AdhocImportRow } from "./adhocImportTypes";
import { loadAdhocImportRecord, saveAdhocImportRecord } from "./adhocImportStorage";

/**
 * Guarantees no collision with a real population's xrayImageId, which is
 * always the bare value read off the risk sheet (numeric/alphanumeric, never
 * prefixed). This prefix is the entire collision-avoidance mechanism — see
 * `adhocImportTypes.ts`'s module docblock.
 */
export function namespacedXrayImageId(importId: string, originalXrayImageId: string): string {
  return `ADHOC-${importId}-${originalXrayImageId}`;
}

/**
 * Projects a mapped+validated ad-hoc row onto `PreparedPopulationRow` so it
 * can flow through the exact same `sample.master.json` / distribution-event
 * machinery a real drawn sample uses. Fields the real pipeline derives from
 * steps this ad-hoc path deliberately skips (BI enrichment, CertScan
 * snippet matching, L1/L2 reviewer assignment) get honest, documented
 * defaults rather than fabricated values — see the CLAUDE.md-mandated "no
 * spreadsheet/formula engine" scope cut.
 */
export function toPreparedPopulationRow(
  importId: string,
  mapped: NormalizedRiskRow
): PreparedPopulationRow {
  if (!mapped.xrayImageId) {
    throw new Error("toPreparedPopulationRow requires a validated row (xrayImageId present).");
  }
  if (mapped.xrayLevelOneResult !== "سليمة" && mapped.xrayLevelOneResult !== "اشتباه") {
    throw new Error("toPreparedPopulationRow requires a validated row (xrayLevelOneResult).");
  }
  if (mapped.xrayLevelTwoResult !== "سليمة" && mapped.xrayLevelTwoResult !== "اشتباه") {
    throw new Error("toPreparedPopulationRow requires a validated row (xrayLevelTwoResult).");
  }

  return {
    stage: mapped.stage,
    xrayImageId: namespacedXrayImageId(importId, mapped.xrayImageId),
    xrayEntryDate: mapped.xrayEntryDate,
    portCode: mapped.portCode,
    portType: mapped.portType,
    portName: mapped.portName,
    declarationNumber: mapped.declarationNumber,
    declarationDate: mapped.declarationDate,
    transitDeclarationNumber: mapped.transitDeclarationNumber,
    declarationHijriDate: mapped.declarationHijriDate,
    manifestNumber: mapped.manifestNumber,
    manifestType: mapped.manifestType,
    manifestDate: mapped.manifestDate,
    plateOrContainerNumber: mapped.plateOrContainerNumber,
    chassisNumber: mapped.chassisNumber,
    finalDestination: mapped.finalDestination,
    xrayLevelOneResult: mapped.xrayLevelOneResult,
    xrayLevelTwoResult: mapped.xrayLevelTwoResult,
    movementType: mapped.movementType,
    movementNumber: mapped.movementNumber,
    movementDate: mapped.movementDate,
    movementHijriDate: mapped.movementHijriDate,
    reportNumber: mapped.reportNumber,
    entryDate: mapped.entryDate,
    exitDate: mapped.exitDate,
    targetedByRiskEngine: mapped.targetedByRiskEngine,
    riskMessage: mapped.riskMessage,
    // Ad-hoc rows never go through the real pipeline's CertScan-snippet match
    // step (that requires the population's CertScan reference list) —
    // "NonCertscan" is the honest default, not a guess; documented in the
    // owning tab's UI and this module's report to the coordinator.
    certScanStatus: "NonCertscan",
    certScanSnippet: null,
    originalCertScanSnippet: null,
    levelOneEmployee: null,
    levelTwoEmployee: null,
    otherResults: {
      manual: { result: null, code: null, employeeId: null },
      opposite: { result: null, code: null, employeeId: null },
      liveMeans: { result: null, code: null, employeeId: null },
    },
    notes: null,
    // No BI file is ever supplied for an ad-hoc import.
    biEnrichmentStatus: "BI Not Provided",
    biMatched: false,
    biFilledFields: [],
    sourceSheetName: mapped.sourceSheetName,
    sourceRowNumber: mapped.sourceRowNumber,
  };
}

/**
 * Writes/refreshes `2-samples/adhoc-{importId}/1-main/sample.master.json`
 * with every row that has ever passed validation for this import (a stable,
 * append-only-in-spirit superset — see module docs on `adhocImportTypes.ts`).
 * This MUST happen before any `assign` event references a row, because
 * `foldDistributionEvents` silently drops an event whose xrayImageId is not
 * found in the sample rows passed to it (see `distributionDerivation.ts`) —
 * skipping this step would make an assignment durably written but invisible.
 */
export async function ensureAdhocSampleMaster(
  directoryHandle: DirectoryHandleLike,
  record: AdhocImportRecord
): Promise<PreparedPopulationRow[]> {
  const monthFolderName = adhocMonthFolderName(record.importId);
  const rows = record.rows
    .filter((r) => r.validation.valid)
    .map((r) => toPreparedPopulationRow(record.importId, r.mapped));

  const certScanActual = 0; // see certScanStatus default above
  const data: SampleMasterData = {
    rngSeed: "adhoc-import",
    totalRequested: rows.length,
    totalActual: rows.length,
    certScanRequested: 0,
    nonCertScanRequested: rows.length,
    certScanActual,
    nonCertScanActual: rows.length,
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

export type AssignAdhocRowsResult =
  | { ok: true; assignedCount: number; skippedCount: number; record: AdhocImportRecord }
  | { ok: false; error: string };

/**
 * Assigns the given (still-open) rows of an ad-hoc import to one employee,
 * through the EXACT same event-sourced path the real Population/Distribution
 * pipeline uses: `buildAssignEvent` + `appendDistributionEvents` (which
 * itself gates on `ensureMonthWritable` for the target monthFolderName,
 * writes durable per-writer NDJSON event segments, folds a checkpoint, and
 * syncs per-employee mirror files). The only difference from a real
 * distribution write is the monthFolderName: a synthetic
 * `adhoc-{importId}` that never matches the real `{month}-{MonthName}-{year}`
 * pattern, so `ensureMonthWritable` fails OPEN for it (no population
 * manifest exists to be "closed") exactly like any other month with no
 * manifest — this is the existing fail-open behavior, not a bypass.
 *
 * Idempotent: rows already carrying a live distribution entry (per
 * `loadOrDeriveDistributionCurrent`, the actual source of truth — not just
 * this record's own `assigned` bookkeeping) are skipped rather than
 * double-assigned, mirroring `calculateBulkAssignment`'s ownedIds guard.
 *
 * Audit finding 6: `assignedTo` used to be trusted as-is (any string). The
 * caller's dropdown was a mount-time snapshot of the managed-user roster, so
 * an account deactivated (or never valid) after the page loaded could still
 * be durably assigned a review — one that account could never log in and
 * complete. Re-validated here against the live roster with the same
 * active+assignable-role rule `calculateBulkAssignment` already enforces.
 */
export async function assignAdhocRowsToEmployee(
  directoryHandle: DirectoryHandleLike,
  record: AdhocImportRecord,
  rowKeys: string[],
  assignedTo: string,
  eventBy: string
): Promise<AssignAdhocRowsResult> {
  // The caller's `record` is tab React state — potentially hours old on a
  // shared workspace, while saveAdhocImportRecord below is a whole-document
  // overwrite. Trusting it meant a stale tab could assign into an import
  // another machine had CLOSED (and revert its status on save), durably
  // assign a row an admin had excluded meanwhile (writing the exclusion
  // away), and wipe every other machine's assigned/assignedTo/assignedAt
  // bookkeeping by rebuilding `rows` from the stale copy. Re-read the record
  // from disk and use THAT for the status gate, the row filters, and the
  // save base; the ownedIds guard below still covers the event side.
  const freshRecord =
    (await loadAdhocImportRecord(directoryHandle, record.importId)) ?? record;

  if (freshRecord.status === "closed") {
    return { ok: false, error: "هذا الاستيراد مُغلق — لا يمكن تعيين المزيد من الصفوف منه." };
  }

  if (!findAssignableEmployee(assignedTo, getManagedLoginUsers())) {
    return { ok: false, error: "الموظف المحدد غير موجود، أو غير نشط، أو لا يملك صلاحية استلام العينات." };
  }

  const monthFolderName = adhocMonthFolderName(freshRecord.importId);
  const rowKeySet = new Set(rowKeys);
  const targetRows = freshRecord.rows.filter(
    (r) => rowKeySet.has(r.rowKey) && r.validation.valid && !r.excludedByAdmin && !r.assigned
  );
  if (targetRows.length === 0) {
    return { ok: false, error: "لا توجد صفوف صالحة قابلة للتعيين ضمن التحديد." };
  }

  // sample.master.json must already contain every valid row (written at
  // finalize time — see ensureAdhocSampleMaster) so the fold can resolve
  // each assign event's xrayImageId.
  const sampleRows = (await loadSampleMaster(directoryHandle, monthFolderName))?.rows
    ?? await ensureAdhocSampleMaster(directoryHandle, freshRecord);

  const current = await loadOrDeriveDistributionCurrent(directoryHandle, monthFolderName, sampleRows);
  const ownedIds = new Set((current?.entries ?? []).map((e) => e.xrayImageId));

  const sharedEventAt = new Date().toISOString();
  const eventsByRowKey = new Map<string, ReturnType<typeof buildAssignEvent>>();
  for (const row of targetRows) {
    const xrayImageId = namespacedXrayImageId(freshRecord.importId, row.mapped.xrayImageId as string);
    if (ownedIds.has(xrayImageId)) continue;
    eventsByRowKey.set(
      row.rowKey,
      buildAssignEvent({
        xrayImageId,
        assignedTo,
        eventBy,
        notes: `استيراد يدوي: ${freshRecord.fileName}`,
        eventAt: sharedEventAt,
      })
    );
  }

  const skippedCount = targetRows.length - eventsByRowKey.size;
  if (eventsByRowKey.size === 0) {
    return { ok: false, error: "كل الصفوف المحددة معيّنة بالفعل." };
  }

  const appendResult = await appendDistributionEvents(
    directoryHandle,
    monthFolderName,
    [...eventsByRowKey.values()]
  );
  if (!appendResult.ok) {
    return { ok: false, error: appendResult.error };
  }

  // A6b: refresh the derived cache + employee sample mirrors after the append,
  // now that pure reads no longer persist them. Swallows its own failure by
  // contract.
  await refreshDistributionCacheAfterWrite(directoryHandle, monthFolderName, sampleRows);

  const assignedAt = sharedEventAt;
  // Base the rewrite on the FRESH rows so other machines' bookkeeping survives.
  const nextRows: AdhocImportRow[] = freshRecord.rows.map((r) => {
    const event = eventsByRowKey.get(r.rowKey);
    if (!event) return r;
    return {
      ...r,
      assigned: true,
      assignedTo,
      assignedAt,
      namespacedXrayImageId: event.xrayImageId,
    };
  });

  const savedRecord = await saveAdhocImportRecord(directoryHandle, { ...freshRecord, rows: nextRows });

  return {
    ok: true,
    assignedCount: eventsByRowKey.size,
    skippedCount,
    record: savedRecord,
  };
}
