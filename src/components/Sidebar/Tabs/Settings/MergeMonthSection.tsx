import { useEffect, useState } from "react";
import { AlertTriangle, ChevronRight, GitMerge } from "lucide-react";

import { usePermissions } from "../../../../auth/usePermissions";
import { useWorkspace } from "../../../../data/workspace/useWorkspace";
import { useLabels } from "../../../../data/labels/useLabels";
import { logError } from "../../../../data/storage/errorLogger";
import { listMonthFolders } from "../../../../data/population/populationStorage";
import { loadAdhocImportIndex } from "../../../../data/adhocImport/adhocImportStorage";
import {
  executeMonthTransfer,
  planMonthTransfer,
  type MonthTransferPhase,
  type MonthTransferPlan,
  type MonthTransferProgress,
  type MonthTransferRefusal,
} from "../../../../data/monthTransfer/monthTransfer";
import { broadcastDataRefresh, notifyLocalDataChange } from "../../../../data/workspace/dataRefreshSignal";
import { recordAction } from "../../../../data/audit/actionLog";
import type { LabelKey } from "../../../../data/labels/labelsStore";
import { ConfirmDialog } from "../../../ConfirmDialog/ConfirmDialog";
import "./TemplateRepairSection.css";

type Notice = { kind: "ok" | "info" | "error"; text: string };
type SourceOption = { value: string; label: string };

function fill(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce((text, [key, value]) => text.split(`{${key}}`).join(String(value)), template);
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const REFUSAL_LABEL: Record<MonthTransferRefusal, LabelKey> = {
  "same-month": "merge_month_refused_same_month",
  "source-empty": "merge_month_refused_source_empty",
  "target-no-sample": "merge_month_refused_target_no_sample",
  "source-closed": "merge_month_refused_source_closed",
  "target-closed": "merge_month_refused_target_closed",
};

const PREVIEW_IDS = 20;

const PHASE_LABEL: Record<MonthTransferPhase, LabelKey> = {
  plan: "merge_month_phase_plan",
  rows: "merge_month_phase_rows",
  events: "merge_month_phase_events",
  answers: "merge_month_phase_answers",
  population: "merge_month_phase_population",
  archive: "merge_month_phase_archive",
};

/**
 * Admin «دمج شهر»: moves a month — or an ad-hoc sample — into another month
 * (see `monthTransfer.ts`). The admin previews first (counts, duplicates,
 * requests left behind); the engine re-plans from disk when it runs.
 */
export function MergeMonthSection() {
  const { canMutate, username, role } = usePermissions();
  const canMerge = role === "admin" && canMutate("view-error-log");
  const { directoryHandle } = useWorkspace();
  const L = useLabels();
  const [isOpen, setIsOpen] = useState(false);
  const [sources, setSources] = useState<SourceOption[]>([]);
  const [targets, setTargets] = useState<string[]>([]);
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");
  const [plan, setPlan] = useState<MonthTransferPlan | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [listTick, setListTick] = useState(0);
  const [progress, setProgress] = useState<MonthTransferProgress | null>(null);

  useEffect(() => {
    if (!isOpen || !canMerge || !directoryHandle) return;
    let cancelled = false;
    void Promise.all([listMonthFolders(directoryHandle), loadAdhocImportIndex(directoryHandle)])
      .then(([months, adhoc]) => {
        if (cancelled) return;
        const monthNames = months.map((entry) => entry.folderName);
        setTargets(monthNames);
        setSources([
          ...monthNames.map((name) => ({ value: name, label: name })),
          ...adhoc.map((entry) => ({
            value: `adhoc-${entry.importId}`,
            label: fill(L.merge_month_adhoc_option, { name: entry.fileName }),
          })),
        ]);
      })
      .catch((error: unknown) => {
        logError("settings:merge-month-list", error);
        if (!cancelled) setNotice({ kind: "error", text: fill(L.delete_month_list_failed, { error: errorText(error) }) });
      });
    return () => { cancelled = true; };
  }, [isOpen, canMerge, directoryHandle, listTick, L.delete_month_list_failed, L.merge_month_adhoc_option]);

  if (!canMerge) return null;

  function reset(): void {
    setPlan(null);
    setNotice(null);
  }

  async function preview(): Promise<void> {
    if (!directoryHandle || !source || !target) return;
    setBusy(true);
    reset();
    try {
      const result = await planMonthTransfer(directoryHandle, source, target);
      if (!result.ok) setNotice({ kind: "error", text: L[REFUSAL_LABEL[result.reason]] });
      else setPlan(result.plan);
    } catch (error) {
      logError("settings:merge-month-plan", error);
      setNotice({ kind: "error", text: fill(L.merge_month_check_failed, { error: errorText(error) }) });
    } finally {
      setBusy(false);
    }
  }

  async function merge(): Promise<void> {
    setConfirming(false);
    if (!directoryHandle || !plan || !canMerge) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await executeMonthTransfer(directoryHandle, plan.sourceMonth, plan.targetMonth, username, setProgress);
      if (!result.ok) {
        const text = result.reason === "write-failed"
          ? fill(L.merge_month_failed, { error: result.error })
          : L[REFUSAL_LABEL[result.reason]];
        setNotice({ kind: "error", text });
        return;
      }
      recordAction(directoryHandle, username, role, "month-merged", {
        monthFolderName: plan.targetMonth,
        target: plan.sourceMonth,
        details: { rows: result.movedRows, answers: result.movedAnswers, duplicates: result.duplicates.length, archive: result.archiveName },
      });
      notifyLocalDataChange(["manifest"]);
      broadcastDataRefresh("manual");
      setNotice({
        kind: "ok",
        text: fill(L.merge_month_done, { rows: result.movedRows, answers: result.movedAnswers, target: plan.targetMonth, archive: result.archiveName }),
      });
      setPlan(null);
      setSource("");
      setListTick((tick) => tick + 1);
    } catch (error) {
      logError("settings:merge-month", error);
      setNotice({ kind: "error", text: fill(L.merge_month_failed, { error: errorText(error) }) });
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  const sourceLabel = sources.find((entry) => entry.value === plan?.sourceMonth)?.label ?? plan?.sourceMonth ?? "";

  return (
    <section className="template-repair-section" dir="rtl">
      <button type="button" className="template-repair-header" onClick={() => setIsOpen((open) => !open)} aria-expanded={isOpen}>
        <ChevronRight size={16} className={isOpen ? "template-repair-chevron-open" : ""} />
        <GitMerge size={16} />
        <span>{L.merge_month_title}</span>
      </button>

      {isOpen && (
        <div className="template-repair-body">
          <p className="template-repair-hint">{L.merge_month_hint}</p>

          <div className="template-repair-controls">
            <label>
              {L.merge_month_source}{" "}
              <select value={source} onChange={(e) => { setSource(e.target.value); reset(); }} disabled={busy}>
                <option value="">—</option>
                {sources.map((entry) => (
                  <option key={entry.value} value={entry.value}>{entry.label}</option>
                ))}
              </select>
            </label>
            <label>
              {L.merge_month_target}{" "}
              <select value={target} onChange={(e) => { setTarget(e.target.value); reset(); }} disabled={busy}>
                <option value="">—</option>
                {targets.filter((name) => name !== source).map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </label>
            <button type="button" className="ew-btn-secondary" onClick={() => void preview()} disabled={busy || !source || !target}>
              {L.merge_month_check}
            </button>
          </div>

          {plan && (
            <div className="template-repair-controls">
              <p>{fill(L.merge_month_preview, {
                rows: plan.rows.length,
                events: plan.events.length,
                answers: plan.answerCount,
                population: plan.populationRows.length,
              })}</p>
              {plan.duplicates.length > 0 && (
                <p className="template-repair-notice template-repair-notice-info" role="status">
                  {fill(L.merge_month_duplicates, {
                    count: plan.duplicates.length,
                    ids: plan.duplicates.slice(0, PREVIEW_IDS).join("، ") + (plan.duplicates.length > PREVIEW_IDS ? " …" : ""),
                  })}
                </p>
              )}
              {plan.pendingRequestCount > 0 && (
                <p className="template-repair-notice template-repair-notice-info" role="status">
                  {fill(L.merge_month_pending_requests, { count: plan.pendingRequestCount })}
                </p>
              )}
              <button type="button" className="ew-btn-secondary" onClick={() => setConfirming(true)} disabled={busy}>
                {L.merge_month_button}
              </button>
            </div>
          )}

          {progress && (
            <div className="template-repair-notice template-repair-notice-info" role="status" aria-live="polite">
              <p>{fill(L.merge_month_progress, {
                phase: L[PHASE_LABEL[progress.phase]],
                done: progress.done.toLocaleString("ar-SA-u-nu-latn"),
                total: progress.total.toLocaleString("ar-SA-u-nu-latn"),
              })}</p>
              <progress max={Math.max(progress.total, 1)} value={progress.done} style={{ width: "100%" }} />
              <p>{L.merge_month_progress_keep_open}</p>
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
        title={L.merge_month_title}
        message={<p>{fill(L.merge_month_confirm, { source: sourceLabel, target: plan?.targetMonth ?? "" })}</p>}
        confirmLabel={L.merge_month_button}
        onConfirm={() => void merge()}
        onCancel={() => setConfirming(false)}
      />
    </section>
  );
}
