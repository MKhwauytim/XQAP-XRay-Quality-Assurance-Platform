import type { PreparedPopulationRow } from "../population/populationTypes";
import { getStageKey } from "../population/stageHelpers";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeReadJson, safeWriteJson } from "../storage/safeWrite";
import { casLoop } from "../storage/casLoop";
import { ensureMonthWritable } from "../population/monthLock";
import { getPopulationMonthDir, getSampleMainDir } from "../workspace/workspacePaths";
import type { PortAllocation, SampleMasterData, StageAllocation } from "./sampleTypes";

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
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, error: msg };
  }
}

export async function loadSampleMaster(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<SampleMasterData | null> {
  try {
    const sampleDir = await getSampleDir(directoryHandle, monthFolderName, false);
    const result = await safeReadJson<SampleMasterData>(sampleDir, SAMPLE_FILE);
    if (result.ok) return result.value;
  } catch {
    // Fallback below.
  }

  try {
    const legacyDir = await getLegacySampleDir(directoryHandle, monthFolderName);
    const result = await safeReadJson<SampleMasterData>(legacyDir, SAMPLE_FILE);
    return result.ok ? result.value : null;
  } catch {
    return null;
  }
}

function isCertScanRow(row: PreparedPopulationRow): boolean {
  return row.certScanStatus === "Certscan";
}

function incrementPortAllocations(
  allocations: PortAllocation[],
  row: PreparedPopulationRow
): PortAllocation[] {
  const isCertScan = isCertScanRow(row);
  const portName = row.portName ?? "غير محدد";
  const existing = allocations.find((item) => item.portName === portName);

  if (!existing) {
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
          actualCertScanDrawn:
            item.actualCertScanDrawn + (isCertScan ? 1 : 0),
          actualNonCertScanDrawn:
            item.actualNonCertScanDrawn + (isCertScan ? 0 : 1),
          actualTotalDrawn: item.actualTotalDrawn + 1,
        }
      : item
  );
}

function incrementStageAllocations(
  allocations: StageAllocation[],
  row: PreparedPopulationRow
): StageAllocation[] {
  const stageKey = getStageKey(row.stage);
  if (stageKey === "unknown") {
    return allocations;
  }
  const isCertScan = isCertScanRow(row);
  const existing = allocations.find((item) => item.stageKey === stageKey);

  if (!existing) {
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
          actualDrawn: item.actualDrawn + 1,
          certScanDrawn: item.certScanDrawn + (isCertScan ? 1 : 0),
          nonCertScanDrawn: item.nonCertScanDrawn + (isCertScan ? 0 : 1),
        }
      : item
  );
}

/** Idempotently append a replacement row to the sample master using a CAS retry loop. */
export async function appendSampleRow(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  newRow: PreparedPopulationRow
): Promise<{ ok: true; data: SampleMasterData } | { ok: false; error: string }> {
  // Month lock gate — before the CAS loop so a closed month rejects loudly.
  await ensureMonthWritable(directoryHandle, monthFolderName);
  return casLoop<{ ok: true; data: SampleMasterData } | { ok: false; error: string }>(
    async (writeToken) => {
      const current = await loadSampleMaster(directoryHandle, monthFolderName);
      if (!current) {
        return { done: true, result: { ok: false as const, error: "لا توجد بيانات عينة للشهر المحدد." } };
      }
      if (current.rows.some((r) => r.xrayImageId === newRow.xrayImageId)) {
        return { done: true, result: { ok: true as const, data: current } };
      }
      const nextRevision = (current.revision ?? 0) + 1;
      const isCertScan = isCertScanRow(newRow);
      const updated: SampleMasterData = {
        ...current,
        revision: nextRevision,
        _writeToken: writeToken,
        totalActual: current.rows.length + 1,
        certScanActual: current.certScanActual + (isCertScan ? 1 : 0),
        nonCertScanActual: current.nonCertScanActual + (isCertScan ? 0 : 1),
        portAllocations: incrementPortAllocations(current.portAllocations, newRow),
        stageAllocations: incrementStageAllocations(current.stageAllocations, newRow),
        rows: [...current.rows, newRow],
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
