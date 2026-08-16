import type { PreparedPopulationRow } from "../population/populationTypes";
import { getStageKey } from "../population/stageHelpers";
import type { StageAliasMappings } from "../population/stageHelpers";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { readEnvelopeRevision, readOptionalJson, safeWriteJson } from "../storage/safeWrite";
import { casLoop } from "../storage/casLoop";
import { codedMessage, logCodedError } from "../storage/errorCodes";
import { ensureMonthWritable } from "../population/monthLock";
import { getPopulationMonthDir, getSampleMainDir } from "../workspace/workspacePaths";
import type { PortAllocation, SampleApproval, SampleMasterData, StageAllocation } from "./sampleTypes";

const SAMPLE_FILE = "sample.master.json";

async function getSampleDir(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  create = true
): Promise<DirectoryHandleLike> {
  return getSampleMainDir(directoryHandle, monthFolderName, create);
}

async function getLegacySampleDir(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<DirectoryHandleLike> {
  const monthDir = await getPopulationMonthDir(directoryHandle, monthFolderName, false);
  return monthDir.getDirectoryHandle("sample", { create: false });
}

export async function saveSampleMaster(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  data: SampleMasterData
): Promise<{ ok: true } | { ok: false; error: string }> {
  // Month lock gate — rejects with MonthClosedError when the month is closed.
  await ensureMonthWritable(directoryHandle, monthFolderName);
  try {
    const sampleDir = await getSampleDir(directoryHandle, monthFolderName);
    await safeWriteJson(sampleDir, SAMPLE_FILE, data);
    return { ok: true };
  } catch (err) {
    logCodedError("sampling:save-sample-master", "XQ-SMP-007", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, error: msg };
  }
}

/** Envelope revision of `sample.master.json` for report-to-revision linkage (B2). */
export async function loadSampleMasterRevision(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<number | null> {
  try {
    const sampleDir = await getSampleDir(directoryHandle, monthFolderName, false);
    const rev = await readEnvelopeRevision(sampleDir, SAMPLE_FILE);
    if (rev !== null) return rev;
  } catch { /* fall through to legacy layout */ }
  try {
    const legacyDir = await getLegacySampleDir(directoryHandle, monthFolderName);
    return await readEnvelopeRevision(legacyDir, SAMPLE_FILE);
  } catch {
    return null;
  }
}

/**
 * The drawn sample for this month, or `null` when no sample exists.
 *
 * **`null` means "no sample was ever drawn" and nothing else.** It THROWS when
 * `sample.master.json` is there but could not be read. Two callers turn this
 * value into a safety verdict — `saveMonthRunLocked`'s TOCTOU overwrite guard
 * and the Population tab's pre-save check — and both read `null` as "safe to
 * overwrite the population". Answering `null` for a file we merely failed to
 * read told them a sample they would orphan does not exist. Every other caller
 * folds `null` into an empty row set, which is equally wrong to invent.
 */
export async function loadSampleMaster(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<SampleMasterData | null> {
  const read = await readOptionalJson<SampleMasterData>(
    `sampling:${monthFolderName}/${SAMPLE_FILE}`,
    [
      {
        directory: () => getSampleDir(directoryHandle, monthFolderName, false),
        fileName: SAMPLE_FILE,
      },
      {
        directory: () => getLegacySampleDir(directoryHandle, monthFolderName),
        fileName: SAMPLE_FILE,
      },
    ]
  );
  return read.kind === "found" ? read.value : null;
}

function isCertScanRow(row: PreparedPopulationRow): boolean {
  return row.certScanStatus === "Certscan";
}

const clamp0 = (n: number): number => (n > 0 ? n : 0);

/**
 * Move a port's drawn counters by `delta` (+1 when a row joins the sample, -1
 * when a replacement retires one). A `-1` against a port with no allocation row
 * is a no-op rather than a negative count: every drawn row's port exists in
 * `portAllocations`, so that can only happen on a hand-built or damaged file.
 */
function adjustPortAllocations(
  allocations: PortAllocation[],
  row: PreparedPopulationRow,
  delta: 1 | -1
): PortAllocation[] {
  const isCertScan = isCertScanRow(row);
  const portName = row.portName ?? "غير محدد";
  const existing = allocations.find((item) => item.portName === portName);

  if (!existing) {
    if (delta < 0) return allocations;
    return [
      ...allocations,
      {
        portName,
        populationSize: 0,
        certScanCount: 0,
        nonCertScanCount: 0,
        allocatedQuota: 0,
        certScanQuota: 0,
        nonCertScanQuota: 0,
        actualCertScanDrawn: isCertScan ? 1 : 0,
        actualNonCertScanDrawn: isCertScan ? 0 : 1,
        actualTotalDrawn: 1,
      },
    ];
  }

  return allocations.map((item) =>
    item.portName === portName
      ? {
          ...item,
          actualCertScanDrawn: clamp0(
            item.actualCertScanDrawn + (isCertScan ? delta : 0)
          ),
          actualNonCertScanDrawn: clamp0(
            item.actualNonCertScanDrawn + (isCertScan ? 0 : delta)
          ),
          actualTotalDrawn: clamp0(item.actualTotalDrawn + delta),
        }
      : item
  );
}

/** Stage counterpart of {@link adjustPortAllocations}. Rows whose stage does not
 *  resolve under the month's mappings are skipped in BOTH directions, so an
 *  unmapped stage never gains a phantom bucket and never goes negative. */
function adjustStageAllocations(
  allocations: StageAllocation[],
  row: PreparedPopulationRow,
  delta: 1 | -1,
  stageMappings?: Partial<StageAliasMappings>
): StageAllocation[] {
  const stageKey = getStageKey(row.stage, stageMappings);
  if (stageKey === "unknown") {
    return allocations;
  }
  const isCertScan = isCertScanRow(row);
  const existing = allocations.find((item) => item.stageKey === stageKey);

  if (!existing) {
    if (delta < 0) return allocations;
    return [
      ...allocations,
      {
        stageKey,
        stageLabel: row.stage ?? "غير محدد",
        populationSize: 0,
        targetQuota: 0,
        actualDrawn: 1,
        certScanDrawn: isCertScan ? 1 : 0,
        nonCertScanDrawn: isCertScan ? 0 : 1,
      },
    ];
  }

  return allocations.map((item) =>
    item.stageKey === stageKey
      ? {
          ...item,
          actualDrawn: clamp0(item.actualDrawn + delta),
          certScanDrawn: clamp0(item.certScanDrawn + (isCertScan ? delta : 0)),
          nonCertScanDrawn: clamp0(
            item.nonCertScanDrawn + (isCertScan ? 0 : delta)
          ),
        }
      : item
  );
}

/**
 * Record a four-eyes sample-release approval on the sample master (A3), using a
 * CAS retry loop so a concurrent row append/approval on another machine cannot
 * clobber it. Idempotent by outcome: once an approval exists it is preserved
 * (first approval wins) and the call returns ok without overwriting.
 *
 * Data-layer only — this does NOT enforce that the approver differs from
 * `drawnBy` or holds a sufficient role; Wave B gates the UI on those rules.
 */
export async function approveSampleMaster(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  approval: SampleApproval
): Promise<{ ok: true; data: SampleMasterData } | { ok: false; error: string }> {
  // Month lock gate — before the CAS loop so a closed month rejects loudly.
  await ensureMonthWritable(directoryHandle, monthFolderName);
  return casLoop<{ ok: true; data: SampleMasterData } | { ok: false; error: string }>(
    async (writeToken) => {
      const current = await loadSampleMaster(directoryHandle, monthFolderName);
      if (!current) {
        return { done: true, result: { ok: false as const, error: codedMessage("XQ-SMP-006") } };
      }
      // First approval wins — never overwrite an existing release record.
      if (current.approval) {
        return { done: true, result: { ok: true as const, data: current } };
      }
      const nextRevision = (current.revision ?? 0) + 1;
      const updated: SampleMasterData = {
        ...current,
        approval,
        revision: nextRevision,
        _writeToken: writeToken,
      };
      const writeResult = await saveSampleMaster(directoryHandle, monthFolderName, updated);
      if (!writeResult.ok) {
        // Transient write error — let the CAS loop retry rather than aborting permanently.
        return { done: false };
      }
      const verify = await loadSampleMaster(directoryHandle, monthFolderName);
      if (verify?.revision === nextRevision && verify._writeToken === writeToken) {
        return {
          done: true,
          result: { ok: true as const, data: updated },
          verify: async () => {
            const recheck = await loadSampleMaster(directoryHandle, monthFolderName);
            return recheck?.revision === nextRevision && recheck._writeToken === writeToken;
          },
        };
      }
      return { done: false };
    },
    { conflictError: "تعارض في الكتابة: لم يتمكن النظام من تسجيل اعتماد العينة بعد عدة محاولات." }
  );
}

/**
 * Idempotently append a replacement row to the sample master using a CAS retry
 * loop, retiring the row it replaces.
 *
 * When `replacesXrayImageId` names a row already in the sample, the append is a
 * SUBSTITUTION: the dead id is recorded in `replacedRowIds` and every drawn
 * counter (`totalActual`, the CertScan split, port and stage allocations) moves
 * the new row in and the dead row out, so the sample keeps the size it was
 * drawn at. Without it the append is a plain enlargement — which is what every
 * replacement used to do, inflating `totalActual` by one per replacement
 * forever and giving the executive deck a phantom "remaining images" backlog
 * exactly the size of the replacement count (P1-A).
 *
 * The dead row stays in `rows`: it is the audit trail and the dedup set that
 * stops a known-dead image being re-drawn as somebody else's replacement.
 */
export async function appendSampleRow(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  newRow: PreparedPopulationRow,
  // Must match the mappings the month was drawn under. Omitted, getStageKey falls
  // back to DEFAULT_STAGE_MAPPINGS, so a workspace using custom stage aliases
  // classifies the replacement row as "unknown" and silently drops it from
  // stageAllocations — permanently under-counting the stage in every report.
  stageMappings?: Partial<StageAliasMappings>,
  /** Id of the sample row this row replaces. Omit for a non-replacement append. */
  replacesXrayImageId?: string
): Promise<{ ok: true; data: SampleMasterData } | { ok: false; error: string }> {
  // Month lock gate — before the CAS loop so a closed month rejects loudly.
  await ensureMonthWritable(directoryHandle, monthFolderName);
  return casLoop<{ ok: true; data: SampleMasterData } | { ok: false; error: string }>(
    async (writeToken) => {
      const current = await loadSampleMaster(directoryHandle, monthFolderName);
      if (!current) {
        return { done: true, result: { ok: false as const, error: codedMessage("XQ-SMP-006") } };
      }
      const retiredIds = current.replacedRowIds ?? [];
      const appendsRow = !current.rows.some((r) => r.xrayImageId === newRow.xrayImageId);
      // Retire only a row that is actually in the sample and not already
      // retired, so a replayed replacement (the CAS loop, a crash-retry, or an
      // approval re-run) can never double-count the substitution.
      const deadRow =
        replacesXrayImageId !== undefined && !retiredIds.includes(replacesXrayImageId)
          ? current.rows.find((r) => r.xrayImageId === replacesXrayImageId) ?? null
          : null;
      if (!appendsRow && !deadRow) {
        return { done: true, result: { ok: true as const, data: current } };
      }

      const nextRevision = (current.revision ?? 0) + 1;
      const isCertScan = isCertScanRow(newRow);
      const deadIsCertScan = deadRow ? isCertScanRow(deadRow) : false;

      let portAllocations = current.portAllocations;
      let stageAllocations = current.stageAllocations;
      if (appendsRow) {
        portAllocations = adjustPortAllocations(portAllocations, newRow, 1);
        stageAllocations = adjustStageAllocations(stageAllocations, newRow, 1, stageMappings);
      }
      if (deadRow) {
        portAllocations = adjustPortAllocations(portAllocations, deadRow, -1);
        stageAllocations = adjustStageAllocations(stageAllocations, deadRow, -1, stageMappings);
      }

      const nextRows = appendsRow ? [...current.rows, newRow] : current.rows;
      const nextRetiredIds = deadRow ? [...retiredIds, deadRow.xrayImageId] : retiredIds;

      const updated: SampleMasterData = {
        ...current,
        revision: nextRevision,
        _writeToken: writeToken,
        // "Rows the sample currently consists of" — see SampleMasterData.totalActual.
        totalActual: nextRows.length - nextRetiredIds.length,
        certScanActual:
          current.certScanActual +
          (appendsRow && isCertScan ? 1 : 0) -
          (deadRow && deadIsCertScan ? 1 : 0),
        nonCertScanActual:
          current.nonCertScanActual +
          (appendsRow && !isCertScan ? 1 : 0) -
          (deadRow && !deadIsCertScan ? 1 : 0),
        portAllocations,
        stageAllocations,
        // Omit the field entirely while no row has ever been retired, so an
        // untouched month's file keeps the exact shape it was drawn with.
        ...(nextRetiredIds.length > 0 ? { replacedRowIds: nextRetiredIds } : {}),
        rows: nextRows,
      };
      const writeResult = await saveSampleMaster(directoryHandle, monthFolderName, updated);
      if (!writeResult.ok) {
        // Transient write error — let the CAS loop retry rather than aborting permanently.
        return { done: false };
      }
      const verify = await loadSampleMaster(directoryHandle, monthFolderName);
      if (verify?.revision === nextRevision && verify._writeToken === writeToken) {
        return {
          done: true,
          result: { ok: true as const, data: updated },
          verify: async () => {
            const recheck = await loadSampleMaster(directoryHandle, monthFolderName);
            return recheck?.revision === nextRevision && recheck._writeToken === writeToken;
          },
        };
      }
      return { done: false };
    },
    { conflictError: "تعارض في الكتابة: لم يتمكن النظام من إضافة سطر العينة بعد عدة محاولات." }
  );
}
