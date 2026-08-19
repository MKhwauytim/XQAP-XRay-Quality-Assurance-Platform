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
  DistributionEntry,
  DistributionEvent,
  DistributionLog
} from "../../../../data/distribution/distributionTypes";
import { loadSampleMaster } from "../../../../data/sampling/sampleStorage";
import type { SampleMasterData } from "../../../../data/sampling/sampleTypes";
import { writeEmployeeXlsx } from "../../../../data/answers/employeeXlsx";
import { getLabels } from "../../../../data/labels/labelsStore";
import { logError, logRejection } from "../../../../data/storage/errorLogger";
import { userFacingErrorText } from "../../../../data/storage/writeErrorText";
import { appendWorkspaceAction } from "../../../../data/audit/actionLog";
import { buildAssignedEntryMap, distributionErrorText } from "./populationWorkflowHelpers";
import { findAssignableEmployee } from "../../../../data/distribution/bulkAssignment";
import { getManagedLoginUsers } from "../../../../auth/userManagement";

type SaveMessage = { type: "ok" | "error"; text: string } | null;
type DistributionProgressState = { percent: number; message: string } | null;

function distributionProgressFromWrite(progress: DistributionWriteProgress): Exclude<DistributionProgressState, null> {
  if (progress.phase === "events") {
    const ratio = progress.total === 0 ? 1 : progress.completed / progress.total;
    return {
      percent: 5 + Math.round(ratio * 65),
      message: `جارٍ حفظ التعيينات (${progress.completed.toLocaleString("ar-SA-u-nu-latn")} من ${progress.total.toLocaleString("ar-SA-u-nu-latn")})...`,
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
    const log = preloadedLog ?? await loadDistributionLog(directoryHandle, monthFolderName);

    // ALWAYS read the sample master, not just when the in-memory rows are empty.
    //
    // `sampleDrawResult` is React state from whenever this tab last loaded the
    // month — potentially hours ago. Every row another machine has added since
    // (i.e. every replacement) is missing from it, and the derived snapshot
    // written below is the sole input to `syncSampleMirrors`. So a supervisor
    // doing anything at all here ERASED those rows from the assignee's mirror,
    // and the monotonic guard could not prevent it: this write carries a higher
    // logRevision, so it wins. The assignee watched replacement rows disappear
    // from their queue until some later derive happened to have fresh rows.
    //
    // The old guard only fired when the array was EMPTY, which is the rare
    // case; stale-but-non-empty is the normal one on a shared folder. This is
    // one small read on a path that has already done a full log read.
    const master = await loadSampleMaster(directoryHandle, monthFolderName);
    let sampleRows = master?.rows ?? sampleDrawResult?.rows ?? [];

    // Guard: never derive against an empty row set while events exist — a
    // zeroed derive would PERSIST an empty snapshot + zeroed employee mirrors
    // (visible data loss).
    if (sampleRows.length === 0 && log.events.length > 0) {
      sampleRows = sampleDrawResult?.rows ?? [];
      if (sampleRows.length === 0) {
        logError(
          "population:refresh-distribution",
          new Error(`Refusing to persist zeroed distribution.current for ${monthFolderName}`)
        );
        setDistributionMessage({ type: "error", text: getLabels().msg_distribution_refresh_no_sample });
        return; // keep the existing on-disk snapshot untouched
      }
    }

    // Stamp the cache FULLY so the next `loadOrDeriveDistributionCurrent` can
    // actually take its fast path (reviewed change, 2026-08-19).
    //
    // Until v4 this stamped `logRevision` only. `deriveCurrentDistribution`
    // supplies `deriveVersion` and (v4) `sampleRowsFingerprint`, but nothing
    // supplied `eventSetId`, so the reader rejected every cache written here and
    // paid a full refold immediately after every distribution write — the most
    // expensive moment to pay it. The four fields below are exactly the reader's
    // acceptance set, so stamping them is what makes this write worth doing.
    //
    // Safe to make authoritative because acceptance is a FOUR-field match, each
    // independent: any appended event changes `eventSetId`, any changed row set
    // changes `sampleRowsFingerprint`, any fold-semantics change bumps
    // `deriveVersion`, and `logRevision` still pins the compat log. Plus the two
    // guards this call site has of its own: it re-reads `sample.master.json`
    // fresh on every call (never trusting React state that may be hours old —
    // see the comment above), and it refuses to persist a zeroed derive when
    // events exist. A wrong-but-stamped cache would still self-heal on the next
    // event, since the cache is an optimization and never a correctness input.
    //
    // `eventSetId` is stamped only when the log actually carries one: a legacy
    // log with no digest must leave the field absent, or the cache would claim
    // an identity nothing can re-verify.
    const current: DistributionCurrentData = {
      ...deriveCurrentDistribution(log, sampleRows),
      logRevision: log.revision,
      ...(log.eventSetId === undefined ? {} : { eventSetId: log.eventSetId }),
    };
    setDistributionCurrent(current);
    await saveDistributionCurrent(directoryHandle, monthFolderName, current);
    void autoLockWhenFullyDistributed(monthFolderName, current, sampleRows);
    onDistributionChanged();
  }

  /**
   * Owner requirement (2026-08-07): "once for a month i finish uploading and
   * distributing sample ... it get locked same as phase 3 in which it auto
   * lock".
   *
   * SEMANTICS CHANGE (2026-08-16, needs owner confirmation — see
   * useDistributionActions.autoLock.test.tsx): this used to fire the moment
   * every sample row carried a distribution entry *regardless of status*, i.e.
   * on ASSIGNMENT. That conflated "the work has been handed out" with "the work
   * is done" and broke the workflow outright: the bulk-assign click that
   * distributes the month also closed it, and `ensureMonthWritable` is the one
   * choke point for every employee-facing write, so the first answer / referral
   * / replacement request afterwards failed with MonthClosedError ("الشهر
   * مُقفل"). `archive.closeMonth` is false for every managed role, so the
   * manager who triggered it could not even see the unlock affordance.
   *
   * The trigger is now "every sample row is covered AND every entry has reached
   * a TERMINAL state" — `completed` or `replaced`. `pending` and
   * `replacement-requested` are explicitly in-flight (the latter still needs an
   * approval decision), so they hold the month open.
   *
   * Best-effort and idempotent: `closeMonth` no-ops on an already-closed month,
   * so calling this on every refresh once finished is safe. Stamps
   * `SYSTEM_AUTO_LOCK_ACTOR` as `closedBy` so the UI can distinguish this from a
   * person manually closing the month (Archive tab / this tab's own admin
   * unlock affordance).
   */
  async function autoLockWhenFullyDistributed(
    monthFolderName: string,
    current: DistributionCurrentData,
    sampleRows: SampleMasterData["rows"]
  ): Promise<void> {
    if (!directoryHandle) return;
    if (sampleRows.length === 0 || current.entries.length < sampleRows.length) return;
    if (!current.entries.every((entry) => entry.status === "completed" || entry.status === "replaced")) {
      return;
    }
    try {
      if (await isMonthClosed(directoryHandle, monthFolderName)) return;
      const result = await closeMonth(
        directoryHandle,
        monthFolderName,
        SYSTEM_AUTO_LOCK_ACTOR,
        getLabels().msg_month_auto_lock_reason
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

  /**
   * The row's CURRENT on-disk distribution entry, read fresh — never from
   * `distributionCurrent`, which is React state that can be hours old on a
   * shared UNC/SMB workspace. Every mutating handler gates on this right
   * before its durable write. The fold protects `assignedTo` on most
   * transitions (priorTransitionValues reads the existing entry, not the
   * event), but it does NOT protect status everywhere: its terminal guard
   * blocks only `assigned`/`reassigned` after `completed`, so a
   * `replacement-requested` event REGRESSES a completed row back to an
   * in-flight state — reopening it to executeReplacement's retire path and
   * orphaning the submitted answer. And an event the fold DOES drop still
   * read as success to the user ("تم ..." over a write that did nothing).
   * Refusing here, with a repaint, is the one place that can stop both.
   */
  async function readFreshEntry(
    monthFolderName: string,
    xrayImageId: string
  ): Promise<{ log: DistributionLog; entry: DistributionEntry | undefined }> {
    if (!directoryHandle) throw new Error("readFreshEntry: no workspace directory");
    const log = await loadDistributionLog(directoryHandle, monthFolderName);
    if (log.events.length === 0) return { log, entry: undefined };
    const master = await loadSampleMaster(directoryHandle, monthFolderName);
    const current = deriveCurrentDistribution(log, master?.rows ?? sampleDrawResult?.rows ?? []);
    return { log, entry: current.entries.find((entry) => entry.xrayImageId === xrayImageId) };
  }

  /** Refuse a handler whose target row changed on disk: repaint from the
   *  fresh log so the user sees WHY, then surface the message. */
  async function refuseChangedRow(
    monthFolderName: string,
    log: DistributionLog,
    text: string
  ): Promise<void> {
    await refreshDistribution(monthFolderName, log);
    setDistributionMessage({ type: "error", text });
  }

  async function handleAssign(
    xrayImageId: string,
    assignedTo: string
  ): Promise<void> {
    if (!canDistributeSamples) {
      setDistributionMessage({ type: "error", text: "لا تملك صلاحية توزيع العينات." });
      return;
    }
    // Audit finding 6: the manual-assign dropdown (DistributionRow, fed by
    // PhaseFourDistribution's `employees`) is now live, but a stale render, a
    // race with the account being deactivated mid-session, or any other caller
    // of this handler could still hand in a username that is no longer valid.
    // Re-validate against the live roster right before the durable write --
    // the same active+assignable-role rule `calculateBulkAssignment` already
    // enforces for the bulk path.
    if (!findAssignableEmployee(assignedTo, getManagedLoginUsers())) {
      setDistributionMessage({ type: "error", text: "الموظف المحدد غير موجود، أو غير نشط، أو لا يملك صلاحية استلام العينات." });
      return;
    }
    if (!directoryHandle || !sampleDrawResult) return;
    setIsDistributing(true);
    setDistributionMessage(null);
    const monthFolderName = formatMonthFolderName(saveMonth, saveYear);
    const event = buildAssignEvent({ xrayImageId, assignedTo, eventBy: currentUsername });
    try {
      // Stale-snapshot guard: the row this tab renders as unassigned may have
      // been assigned from another machine since the snapshot loaded, and the
      // fold's `assigned` handler overwrites `assignedTo` unconditionally —
      // appending blindly silently transfers ownership. An owned row refuses
      // and repaints instead (see readFreshEntry).
      const { log: freshLog, entry: owned } = await readFreshEntry(monthFolderName, xrayImageId);
      if (owned) {
        await refuseChangedRow(
          monthFolderName,
          freshLog,
          getLabels().msg_assign_row_already_owned.split("{assignee}").join(owned.assignedTo)
        );
        return;
      }
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
        setDistributionMessage({ type: "error", text: userFacingErrorText(result.error, "distribution:action-result") });
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
    // Audit finding 6: same live-roster re-validation as handleAssign above.
    if (!findAssignableEmployee(reassignedTo, getManagedLoginUsers())) {
      setDistributionMessage({ type: "error", text: "الموظف المحدد غير موجود، أو غير نشط، أو لا يملك صلاحية استلام العينات." });
      return;
    }
    if (!directoryHandle || !sampleDrawResult) return;
    // Snapshot fast-path: a completed row is terminal for reassignment —
    // moving it would either be dropped by the derivation guard or lose the
    // submitted answer. Require the reopen flow first. (Re-checked FRESH
    // below; this only saves the disk read when this tab already knows.)
    const existing = distributionCurrent?.entries.find(
      (e) => e.xrayImageId === xrayImageId
    );
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
    try {
      // Fresh status gate: the fold DROPS a reassign on a completed/replaced
      // row, but the user was still told "تم إعادة التعيين." for a write that
      // did nothing. A missing entry means the snapshot row no longer exists.
      const { log: freshLog, entry: fresh } = await readFreshEntry(monthFolderName, xrayImageId);
      if (fresh?.status === "completed") {
        await refuseChangedRow(
          monthFolderName,
          freshLog,
          "لا يمكن إعادة تعيين عينة مكتملة — يجب إعادة فتحها أولاً عبر مسار إعادة الفتح."
        );
        return;
      }
      if (!fresh || fresh.status === "replaced") {
        await refuseChangedRow(monthFolderName, freshLog, getLabels().msg_row_state_changed_on_disk);
        return;
      }
      // Built from the FRESH entry so the event's "from" side names the actual
      // current owner (row history renders it), not this tab's stale guess.
      const event = buildReassignEvent({
        xrayImageId,
        assignedTo: fresh.assignedTo,
        reassignedTo,
        eventBy: currentUsername
      });
      const result = await appendDistributionEvent(
        directoryHandle,
        monthFolderName,
        event
      );
      if (result.ok) {
        await refreshDistribution(monthFolderName, result.log);
        setDistributionMessage({ type: "ok", text: "تم إعادة التعيين." });
      } else {
        setDistributionMessage({ type: "error", text: userFacingErrorText(result.error, "distribution:action-result") });
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
    try {
      // Fresh status gate: completing an already-completed row is a no-op the
      // fold accepts (it just advances the entry's last-activity stamp), a
      // replaced row's completion is dropped — and both told the user "تم".
      // A missing entry means the row was never assigned or no longer exists.
      // `replacement-requested` is deliberately allowed: completing it is a
      // real supervisor decision that supersedes the pending request.
      const { log: freshLog, entry: fresh } = await readFreshEntry(monthFolderName, xrayImageId);
      if (!fresh || fresh.status === "completed" || fresh.status === "replaced") {
        await refuseChangedRow(monthFolderName, freshLog, getLabels().msg_row_state_changed_on_disk);
        return;
      }
      const event = buildCompletedEvent({
        xrayImageId,
        assignedTo: fresh.assignedTo,
        eventBy: currentUsername
      });
      const result = await appendDistributionEvent(
        directoryHandle,
        monthFolderName,
        event
      );
      if (result.ok) {
        await refreshDistribution(monthFolderName, result.log);
        setDistributionMessage({ type: "ok", text: "تم تعليم الصف كمكتمل." });
      } else {
        setDistributionMessage({ type: "error", text: userFacingErrorText(result.error, "distribution:action-result") });
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
    try {
      // Fresh status gate — and the one that closes a real terminal-state
      // hole: the fold's terminal guard blocks only `assigned`/`reassigned`
      // after `completed`, so a `replacement-requested` event on a row another
      // machine completed meanwhile would fold through and REGRESS the
      // terminal state — reopening the row to executeReplacement's retire
      // path and orphaning the submitted answer, and un-arming the month
      // auto-lock. Only a fresh `pending` row may request a replacement (a
      // duplicate request on `replacement-requested` is refused here too).
      const { log: freshLog, entry: fresh } = await readFreshEntry(monthFolderName, xrayImageId);
      if (fresh?.status !== "pending") {
        await refuseChangedRow(monthFolderName, freshLog, getLabels().msg_row_state_changed_on_disk);
        return;
      }
      const event = buildReplacementRequestedEvent({
        xrayImageId,
        assignedTo: fresh.assignedTo,
        eventBy: currentUsername
      });
      const result = await appendDistributionEvent(
        directoryHandle,
        monthFolderName,
        event
      );
      if (result.ok) {
        await refreshDistribution(monthFolderName, result.log);
        setDistributionMessage({ type: "ok", text: "تم تسجيل طلب الاستبدال." });
      } else {
        setDistributionMessage({ type: "error", text: userFacingErrorText(result.error, "distribution:action-result") });
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
      // Fresh on-disk ownership re-check right before the durable write. The
      // events were computed against THIS tab's `distributionCurrent` — React
      // state from whenever the month was last loaded, potentially hours old
      // on a shared UNC/SMB workspace. Every row another supervisor assigned
      // since then looks "unassigned" in that snapshot, and the fold's
      // `assigned` handler overwrites `assignedTo` unconditionally — so
      // appending blindly silently transfers those rows, with no reassign
      // event and no notification to either side. Filter against what is
      // actually on disk instead. The residual race is the append window
      // itself, which no backend-free design can close (see CLAUDE.md).
      const freshLog = await loadDistributionLog(directoryHandle, monthFolderName);
      let eventsToAppend = events;
      let staleSkipped = 0;
      if (freshLog.events.length > 0) {
        const master = await loadSampleMaster(directoryHandle, monthFolderName);
        const freshCurrent = deriveCurrentDistribution(
          freshLog,
          master?.rows ?? sampleDrawResult.rows
        );
        const ownedIds = new Set(freshCurrent.entries.map((entry) => entry.xrayImageId));
        eventsToAppend = events.filter((event) => !ownedIds.has(event.xrayImageId));
        staleSkipped = events.length - eventsToAppend.length;
      }
      if (eventsToAppend.length === 0) {
        await refreshDistribution(monthFolderName, freshLog);
        setDistributionMessage({ type: "error", text: getLabels().msg_bulk_assign_all_taken });
        return;
      }
      const result = await appendDistributionEvents(
        directoryHandle,
        monthFolderName,
        eventsToAppend,
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
          details: { events: eventsToAppend.length, staleSkipped },
        });
        setDistributionProgress({ percent: 92, message: "جارٍ بناء ملخص التوزيع النهائي..." });
        await refreshDistribution(monthFolderName, result.log);
        // Build per-employee entry lists then write one XLSX per employee (fire-and-forget).
        const assignedMap = buildAssignedEntryMap(eventsToAppend, sampleDrawResult.rows);
        for (const [emp, empEntries] of assignedMap) {
          void writeEmployeeXlsx(directoryHandle, monthFolderName, emp, empEntries).catch(logRejection(`distribution:write-employee-xlsx:${emp}`));
        }
        setDistributionProgress({ percent: 100, message: "اكتمل حفظ التوزيع بنجاح." });
        setDistributionMessage({
          type: "ok",
          text:
            staleSkipped > 0
              ? `تم تطبيق وحفظ التوزيع الجماعي بنجاح. ${getLabels()
                  .msg_bulk_assign_stale_skipped.split("{count}")
                  .join(staleSkipped.toLocaleString("ar-SA-u-nu-latn"))}`
              : "تم تطبيق وحفظ التوزيع الجماعي بنجاح.",
        });
      } else {
        setDistributionMessage({ type: "error", text: userFacingErrorText(result.error, "distribution:action-result") });
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
