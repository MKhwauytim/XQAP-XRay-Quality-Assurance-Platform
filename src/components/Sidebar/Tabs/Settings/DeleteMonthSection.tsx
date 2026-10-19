import { useEffect, useState } from "react";
import { AlertTriangle, ChevronRight, Trash2 } from "lucide-react";

import { usePermissions } from "../../../../auth/usePermissions";
import { useWorkspace } from "../../../../data/workspace/useWorkspace";
import { useLabels } from "../../../../data/labels/useLabels";
import { logError } from "../../../../data/storage/errorLogger";
import type { MonthFolderInfo } from "../../../../data/population/monthFolder";
import { listMonthFolders } from "../../../../data/population/populationStorage";
import {
  assessMonthDeletion,
  deleteMonth,
  type MonthDeletionAssessment,
} from "../../../../data/population/deleteMonth";
import { broadcastDataRefresh, notifyLocalDataChange } from "../../../../data/workspace/dataRefreshSignal";
import { recordAction } from "../../../../data/audit/actionLog";
import { ConfirmDialog } from "../../../ConfirmDialog/ConfirmDialog";
import "./TemplateRepairSection.css";

type Notice = { kind: "ok" | "info" | "error"; text: string };

function fill(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce((text, [key, value]) => text.split(`{${key}}`).join(String(value)), template);
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Admin «حذف شهر»: deletes a month's population and sample folders from inside
 * the app (see `deleteMonth.ts`), instead of deleting them by hand. Admin only,
 * at render and in the handler. The admin checks the month first (closed?
 * how many answers?), types its folder name, and ticks an acknowledgement when
 * it has answers; the engine re-checks all of it at delete time.
 */
export function DeleteMonthSection() {
  const { canMutate, username, role } = usePermissions();
  const canDelete = role === "admin" && canMutate("view-error-log");
  const { directoryHandle } = useWorkspace();
  const L = useLabels();
  const [isOpen, setIsOpen] = useState(false);
  const [months, setMonths] = useState<MonthFolderInfo[]>([]);
  const [month, setMonth] = useState("");
  const [assessment, setAssessment] = useState<MonthDeletionAssessment | null>(null);
  const [typed, setTyped] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [listTick, setListTick] = useState(0);

  useEffect(() => {
    if (!isOpen || !canDelete || !directoryHandle) return;
    let cancelled = false;
    void listMonthFolders(directoryHandle)
      .then((found) => {
        if (cancelled) return;
        setMonths(found);
        setMonth((current) => (found.some((entry) => entry.folderName === current) ? current : ""));
      })
      .catch((error: unknown) => {
        logError("settings:delete-month-list", error);
        if (!cancelled) setNotice({ kind: "error", text: fill(L.delete_month_list_failed, { error: errorText(error) }) });
      });
    return () => { cancelled = true; };
  }, [isOpen, canDelete, directoryHandle, listTick, L.delete_month_list_failed]);

  if (!canDelete) return null;

  function pick(folderName: string): void {
    setMonth(folderName);
    setAssessment(null);
    setTyped("");
    setAcknowledged(false);
    setNotice(null);
  }

  async function check(): Promise<void> {
    if (!directoryHandle || !month) return;
    setBusy(true);
    setNotice(null);
    try {
      setAssessment(await assessMonthDeletion(directoryHandle, month));
    } catch (error) {
      logError("settings:delete-month-assess", error);
      setAssessment(null);
      setNotice({ kind: "error", text: fill(L.delete_month_check_failed, { error: errorText(error) }) });
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    setConfirming(false);
    if (!directoryHandle || !assessment || !canDelete) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await deleteMonth(directoryHandle, assessment.monthFolderName, acknowledged ? assessment.answerCount : 0);
      if (!result.ok) {
        setAssessment(result.assessment);
        setAcknowledged(false);
        const text = result.reason === "closed"
          ? L.delete_month_refused_closed
          : result.reason === "answers-changed"
            ? fill(L.delete_month_refused_answers_changed, { count: result.assessment.answerCount })
            : L.delete_month_refused_not_found;
        setNotice({ kind: "error", text });
        return;
      }
      recordAction(directoryHandle, username, role, "month-deleted", {
        monthFolderName: assessment.monthFolderName,
        details: { answers: assessment.answerCount },
      });
      // "manifest" makes the month picker re-list (and drop a selection of
      // this month); the broadcast makes every open view re-read.
      notifyLocalDataChange(["manifest"]);
      broadcastDataRefresh("manual");
      setNotice({ kind: "ok", text: fill(L.delete_month_done, { month: assessment.monthFolderName }) });
      pick("");
      setListTick((tick) => tick + 1);
    } catch (error) {
      logError("settings:delete-month", error);
      setNotice({ kind: "error", text: fill(L.delete_month_failed, { error: errorText(error) }) });
    } finally {
      setBusy(false);
    }
  }

  const needsAck = (assessment?.answerCount ?? 0) > 0;
  const ready = !!assessment && !assessment.closed && typed.trim() === assessment.monthFolderName && (!needsAck || acknowledged);

  return (
    <section className="template-repair-section" dir="rtl">
      <button type="button" className="template-repair-header" onClick={() => setIsOpen((open) => !open)} aria-expanded={isOpen}>
        <ChevronRight size={16} className={isOpen ? "template-repair-chevron-open" : ""} />
        <Trash2 size={16} />
        <span>{L.delete_month_title}</span>
      </button>

      {isOpen && (
        <div className="template-repair-body">
          <p className="template-repair-hint">{L.delete_month_hint}</p>

          <div className="template-repair-controls">
            <label>
              {L.delete_month_pick}{" "}
              <select value={month} onChange={(e) => pick(e.target.value)} disabled={busy}>
                <option value="">—</option>
                {months.map((entry) => (
                  <option key={entry.folderName} value={entry.folderName}>{entry.folderName}</option>
                ))}
              </select>
            </label>
            <button type="button" className="ew-btn-secondary" onClick={() => void check()} disabled={busy || !month}>
              {L.delete_month_check}
            </button>
          </div>

          {assessment && (
            <div className="template-repair-controls">
              {assessment.closed ? (
                <p className="template-repair-notice template-repair-notice-error" role="status">
                  <AlertTriangle size={14} />
                  {L.delete_month_refused_closed}
                </p>
              ) : (
                <>
                  <p>{assessment.answerCount > 0
                    ? fill(L.delete_month_has_answers, { count: assessment.answerCount })
                    : L.delete_month_no_answers}</p>
                  {needsAck && (
                    <label>
                      <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />{" "}
                      {fill(L.delete_month_ack_answers, { count: assessment.answerCount })}
                    </label>
                  )}
                  <label>
                    {fill(L.delete_month_type_name, { month: assessment.monthFolderName })}{" "}
                    <input type="text" dir="ltr" value={typed} onChange={(e) => setTyped(e.target.value)} />
                  </label>
                  <button type="button" className="ew-btn-secondary" onClick={() => setConfirming(true)} disabled={busy || !ready}>
                    {L.delete_month_button}
                  </button>
                </>
              )}
            </div>
          )}

          {notice && (
            <p className={`template-repair-notice template-repair-notice-${notice.kind}`} role="status">
              {notice.kind === "error" && <AlertTriangle size={14} />}
              {notice.text}
            </p>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirming}
        danger
        title={L.delete_month_title}
        message={<p>{fill(L.delete_month_confirm, { month: assessment?.monthFolderName ?? "" })}</p>}
        confirmLabel={L.delete_month_button}
        onConfirm={() => void remove()}
        onCancel={() => setConfirming(false)}
      />
    </section>
  );
}
