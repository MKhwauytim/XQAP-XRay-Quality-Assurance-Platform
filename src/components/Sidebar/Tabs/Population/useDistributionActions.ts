import { useState } from "react";

import type { DirectoryHandleLike } from "../../../../data/storage/fileSystemAccess";
import { formatMonthFolderName } from "../../../../data/population/monthFolder";
import { updateMonthStatus } from "../../../../data/population/populationStorage";
import { closeMonth, isMonthClosed, SYSTEM_AUTO_LOCK_ACTOR } from "../../../../data/population/monthLock";
import {
  appendDistributionEvent,
  appendDistributionEvents,
  loadDistributionLog,
  saveDistributionCurrent,
  type DistributionWriteProgress,
} from "../../../../data/distribution/distributionStorage";
import {
  buildAssignEvent,
  buildCompletedEvent,
  buildReassignEvent,
  buildReplacementRequestedEvent,
  deriveCurrentDistribution
} from "../../../../data/distribution/distributionLog";
import type {
  DistributionCurrentData,
  DistributionEvent,
  DistributionLog
} from "../../../../data/distribution/distributionTypes";
import { loadSampleMaster } from "../../../../data/sampling/sampleStorage";
import type { SampleMasterData } from "../../../../data/sampling/sampleTypes";
import { writeEmployeeXlsx } from "../../../../data/answers/employeeXlsx";
import { getLabels } from "../../../../data/labels/labelsStore";
import { logError } from "../../../../data/storage/errorLogger";
import { appendWorkspaceAction } from "../../../../data/audit/actionLog";
import { buildAssignedEntryMap, distributionErrorText } from "./populationWorkflowHelpers";

type SaveMessage = { type: "ok" | "error"; text: string } | null;
type DistributionProgressState = { percent: number; message: string } | null;

function distributionProgressFromWrite(progress: DistributionWriteProgress): Exclude<DistributionProgressState, null> {
  if (progress.phase === "events") {
    const ratio = progress.total === 0 ? 1 : progress.completed / progress.total;
    return {
      percent: 5 + Math.round(ratio * 65),
      message: `جارٍ حفظ التعيينات (${progress.completed.toLocaleString("ar-SA")} من ${progress.total.toLocaleString("ar-SA")})...`,
    };
  }
  if (progress.phase === "projection") {
    return { percent: 74, message: "جارٍ تحديث سجل التوزيع المجمع..." };
  }
  if (progress.phase === "verification") {
    return { percent: 82, message: "جارٍ التحقق من سلامة الحفظ..." };
  }
  return { percent: 86, message: "تم حفظ التعيينات، جارٍ تحديث حالة الشهر..." };
}

/**
 * Owns Phase 4's distribution state (current snapshot, save/progress messages,
 * in-flight flag) plus every mutating handler (assign/reassign/mark-complete/
 * request-replacement/bulk-assign) -- extracted out of PopulationTab itself
 * purely to stay under this repo's `max-lines-per-function`/`check:complexity`
 * budget (`npm run check:complexity`): PopulationTab was at 1438/1450 lines,
 * 12 lines from tripping the CI gate on the next routine addition (audit
 * follow-up, 2026-08-01).
 *
 * This is a byte-for-byte behavioral move of the pre-existing
 * `refreshDistribution`/`handleAssign`/`handleReassign`/`handleMarkComplete`/
 * `handleRequestReplacement`/`handleApplyBulkAssignment` functions and the
 * `distributionCurrent`/`distributionMessage`/`isDistributing`/
 * `distributionProgress` state they owned -- no logic changed. `sampleDrawResult`
 * stays a read-only input here (PopulationTab/useMonthLoad still own drawing and
 * loading it). `onDistributionChanged` lets the caller bump its own
 * `monthRefreshKey` after every successful mutation, since that key is shared
 * with other wizard state (Phase 2's orphan scan, BrowseDataView) outside this
 * hook's remit. `setDistributionCurrent`/`setDistributionMessage` are returned
 * directly so the caller's `applyLoadedState`/`resetWizardState` can still
 * seed/clear this state the same way they did before the extraction.
 */
export function useDistributionActions(params: {
  directoryHandle: DirectoryHandleLike | null;
  sampleDrawResult: SampleMasterData | null;
  saveMonth: number;
  saveYear: number;
  canDistributeSamples: boolean;
  canBulkAssign: boolean;
  currentUsername: string;
  currentRole: string;
  onDistributionChanged: () => void;
  /** Owner requirement: bumps the global-month lock-check tick so `isSelectedMonthClosed`
   *  reflects an auto-lock immediately instead of waiting for the 30s TTL/next navigation. */
  refreshGlobalMonths?: () => Promise<void>;
}) {
  const {
    directoryHandle,
    sampleDrawResult,
    saveMonth,
    saveYear,
    canDistributeSamples,
    canBulkAssign,
    currentUsername,
    currentRole,
    onDistributionChanged,
    refreshGlobalMonths,
  } = params;

  const [distributionCurrent, setDistributionCurrent] =
    useState<DistributionCurrentData | null>(null);
  const [distributionMessage, setDistributionMessage] = useState<SaveMessage>(null);
  const [isDistributing, setIsDistributing] = useState(false);
  const [distributionProgress, setDistributionProgress] = useState<DistributionProgressState>(null);

  async function refreshDistribution(
    monthFolderName: string,
    preloadedLog?: DistributionLog
  ): Promise<void> {
    if (!directoryHandle) return;
    let sampleRows = sampleDrawResult?.rows ?? [];
    const log = preloadedLog ?? await loadDistributionLog(directoryHandle, monthFolderName);

    // Guard: never derive against an empty row set while events exist — a
    // zeroed derive would PERSIST an empty snapshot + zeroed employee mirrors
    // (visible data loss). Fall back to the on-disk sample master.
    if (sampleRows.length === 0 && log.events.length > 0) {
      const master = await loadSampleMaster(directoryHandle, monthFolderName);
      sampleRows = master?.rows ?? [];
      if (sampleRows.length === 0) {
        logError(
          "population:refresh-distribution",
          new Error(`Refusing to persist zeroed distribution.current for ${monthFolderName}`)
        );
        setDistributionMessage({ type: "error", text: getLabels().msg_distribution_refresh_no_sample });
        return; // keep the existing on-disk snapshot untouched
      }
    }

    // Stamp logRevision so the next loadOrDeriveDistributionCurrent takes the fast path.
    const current: DistributionCurrentData = {
      ...deriveCurrentDistribution(log, sampleRows),
      logRevision: log.revision,
    };
    setDistributionCurrent(current);
    await saveDistributionCurrent(directoryHandle, monthFolderName, current);
    void autoLockWhenFullyDistributed(monthFolderName, current, sampleRows);
    onDistributionChanged();
  }

  /**
   * Owner requirement (2026-08-07): "once for a month i finish uploading and
   * distributing sample ... it get locked same as phase 3 in which it auto
   * lock". Every sample row now carrying a distribution entry (assigned,
   * regardless of completion status) is "distribution finished" in the
   * owner's sense — mirrors Phase 3's own auto-advance-to-sampled pattern.
   * Best-effort and idempotent: `closeMonth` no-ops on an already-closed
   * month, so calling this on every refresh once fully distributed is safe.
   * Stamps `SYSTEM_AUTO_LOCK_ACTOR` as `closedBy` so the UI can distinguish
   * this from a person manually closing the month (Archive tab / this tab's
   * own admin unlock affordance).
   */
  async function autoLockWhenFullyDistributed(
    monthFolderName: string,
    current: DistributionCurrentData,
    sampleRows: SampleMasterData["rows"]
  ): Promise<void> {
    if (!directoryHandle) return;
    if (sampleRows.length === 0 || current.entries.length < sampleRows.length) return;
    try {
      if (await isMonthClosed(directoryHandle, monthFolderName)) return;
      const result = await closeMonth(
        directoryHandle,
        monthFolderName,
        SYSTEM_AUTO_LOCK_ACTOR,
        "إقفال تلقائي بعد اكتمال توزيع كل عناصر العينة."
      );
      if (result.ok) {
        void refreshGlobalMonths?.();
      } else {
        logError("population:auto-lock-month", new Error(result.error));
      }
    } catch (error) {
      logError("population:auto-lock-month", error);
    }
  }

  async function handleAssign(
    xrayImageId: string,
    assignedTo: string
  ): Promise<void> {
    if (!canDistributeSamples) {
      setDistributionMessage({ type: "error", text: "لا تملك صلاحية توزيع العينات." });
      return;
    }
    if (!directoryHandle || !sampleDrawResult) return;
    setIsDistributing(true);
    setDistributionMessage(null);
    const monthFolderName = formatMonthFolderName(saveMonth, saveYear);
    const event = buildAssignEvent({ xrayImageId, assignedTo, eventBy: currentUsername });
    try {
      const result = await appendDistributionEvent(
        directoryHandle,
        monthFolderName,
        event
      );
      if (result.ok) {
        await updateMonthStatus(directoryHandle, monthFolderName, "distributed");
        await refreshDistribution(monthFolderName, result.log);
        setDistributionMessage({ type: "ok", text: "تم التعيين." });
      } else {
        setDistributionMessage({ type: "error", text: result.error });
      }
    } catch (error) {
      setDistributionMessage({ type: "error", text: distributionErrorText(error, getLabels().msg_month_closed_write_blocked) });
    } finally {
      setIsDistributing(false);
    }
  }

  async function handleReassign(
    xrayImageId: string,
    reassignedTo: string
  ): Promise<void> {
    if (!canDistributeSamples) {
      setDistributionMessage({ type: "error", text: "لا تملك صلاحية إعادة توزيع العينات." });
      return;
    }
    if (!directoryHandle || !sampleDrawResult) return;
    const existing = distributionCurrent?.entries.find(
      (e) => e.xrayImageId === xrayImageId
    );
    // A completed row is terminal for reassignment: moving it would either be
    // dropped by the derivation guard or lose the submitted answer. Require the
    // reopen flow first.
    if (existing?.status === "completed") {
      setDistributionMessage({
        type: "error",
        text: "لا يمكن إعادة تعيين عينة مكتملة — يجب إعادة فتحها أولاً عبر مسار إعادة الفتح.",
      });
      return;
    }
    setIsDistributing(true);
    setDistributionMessage(null);
    const monthFolderName = formatMonthFolderName(saveMonth, saveYear);
    const event = buildReassignEvent({
      xrayImageId,
      assignedTo: existing?.assignedTo ?? reassignedTo,
      reassignedTo,
      eventBy: currentUsername
    });
    try {
      const result = await appendDistributionEvent(
        directoryHandle,
        monthFolderName,
        event
      );
      if (result.ok) {
        await refreshDistribution(monthFolderName, result.log);
        setDistributionMessage({ type: "ok", text: "تم إعادة التعيين." });
      } else {
        setDistributionMessage({ type: "error", text: result.error });
      }
    } catch (error) {
      setDistributionMessage({ type: "error", text: distributionErrorText(error, getLabels().msg_month_closed_write_blocked) });
    } finally {
      setIsDistributing(false);
    }
  }

  async function handleMarkComplete(xrayImageId: string): Promise<void> {
    if (!canDistributeSamples) {
      setDistributionMessage({ type: "error", text: "لا تملك صلاحية تعديل حالة التوزيع." });
      return;
    }
    if (!directoryHandle || !sampleDrawResult) return;
    setIsDistributing(true);
    setDistributionMessage(null);
    const monthFolderName = formatMonthFolderName(saveMonth, saveYear);
    const existing = distributionCurrent?.entries.find(
      (e) => e.xrayImageId === xrayImageId
    );
    const event = buildCompletedEvent({
      xrayImageId,
      assignedTo: existing?.assignedTo ?? currentUsername,
      eventBy: currentUsername
    });
    try {
      const result = await appendDistributionEvent(
        directoryHandle,
        monthFolderName,
        event
      );
      if (result.ok) {
        await refreshDistribution(monthFolderName, result.log);
        setDistributionMessage({ type: "ok", text: "تم تعليم الصف كمكتمل." });
      } else {
        setDistributionMessage({ type: "error", text: result.error });
      }
    } catch (error) {
      setDistributionMessage({ type: "error", text: distributionErrorText(error, getLabels().msg_month_closed_write_blocked) });
    } finally {
      setIsDistributing(false);
    }
  }

  async function handleRequestReplacement(xrayImageId: string): Promise<void> {
    if (!canDistributeSamples) {
      setDistributionMessage({ type: "error", text: "لا تملك صلاحية طلب الاستبدال من شاشة التوزيع." });
      return;
    }
    if (!directoryHandle || !sampleDrawResult) return;
    setIsDistributing(true);
    setDistributionMessage(null);
    const monthFolderName = formatMonthFolderName(saveMonth, saveYear);
    const existing = distributionCurrent?.entries.find(
      (e) => e.xrayImageId === xrayImageId
    );
    const event = buildReplacementRequestedEvent({
      xrayImageId,
      assignedTo: existing?.assignedTo ?? currentUsername,
      eventBy: currentUsername
    });
    try {
      const result = await appendDistributionEvent(
        directoryHandle,
        monthFolderName,
        event
      );
      if (result.ok) {
        await refreshDistribution(monthFolderName, result.log);
        setDistributionMessage({ type: "ok", text: "تم تسجيل طلب الاستبدال." });
      } else {
        setDistributionMessage({ type: "error", text: result.error });
      }
    } catch (error) {
      setDistributionMessage({ type: "error", text: distributionErrorText(error, getLabels().msg_month_closed_write_blocked) });
    } finally {
      setIsDistributing(false);
    }
  }

  async function handleApplyBulkAssignment(events: DistributionEvent[]): Promise<void> {
    if (!canBulkAssign) {
      setDistributionMessage({ type: "error", text: "لا تملك صلاحية التوزيع الجماعي." });
      return;
    }
    if (!directoryHandle || !sampleDrawResult) return;
    setIsDistributing(true);
    setDistributionMessage(null);
    setDistributionProgress({ percent: 2, message: "جارٍ تجهيز ملفات التعيينات للحفظ..." });
    const monthFolderName = formatMonthFolderName(saveMonth, saveYear);
    try {
      const result = await appendDistributionEvents(
        directoryHandle,
        monthFolderName,
        events,
        {
          onProgress: (progress) => setDistributionProgress(distributionProgressFromWrite(progress)),
        }
      );
      if (result.ok) {
        setDistributionProgress({ percent: 88, message: "جارٍ تحديث حالة الشهر..." });
        await updateMonthStatus(directoryHandle, monthFolderName, "distributed");
        void appendWorkspaceAction(directoryHandle, {
          actor: currentUsername,
          actorRole: currentRole,
          action: "distribution-bulk-assigned",
          monthFolderName,
          details: { events: events.length },
        });
        setDistributionProgress({ percent: 92, message: "جارٍ بناء ملخص التوزيع النهائي..." });
        await refreshDistribution(monthFolderName, result.log);
        // Build per-employee entry lists then write one XLSX per employee (fire-and-forget).
        const assignedMap = buildAssignedEntryMap(events, sampleDrawResult.rows);
        for (const [emp, empEntries] of assignedMap) {
          void writeEmployeeXlsx(directoryHandle, monthFolderName, emp, empEntries).catch(() => undefined);
        }
        setDistributionProgress({ percent: 100, message: "اكتمل حفظ التوزيع بنجاح." });
        setDistributionMessage({ type: "ok", text: "تم تطبيق وحفظ التوزيع الجماعي بنجاح." });
      } else {
        setDistributionMessage({ type: "error", text: result.error });
      }
    } catch (error) {
      setDistributionMessage({ type: "error", text: distributionErrorText(error, getLabels().msg_month_closed_write_blocked) });
    } finally {
      setIsDistributing(false);
      setDistributionProgress(null);
    }
  }

  return {
    distributionCurrent,
    setDistributionCurrent,
    distributionMessage,
    setDistributionMessage,
    isDistributing,
    distributionProgress,
    refreshDistribution,
    handleAssign,
    handleReassign,
    handleMarkComplete,
    handleRequestReplacement,
    handleApplyBulkAssignment,
  };
}
