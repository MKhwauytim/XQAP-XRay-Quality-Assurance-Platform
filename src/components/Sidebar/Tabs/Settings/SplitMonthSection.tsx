import { useEffect, useState } from "react";
import { AlertTriangle, ChevronRight, Split } from "lucide-react";
import * as XLSX from "xlsx";

import { usePermissions } from "../../../../auth/usePermissions";
import { useWorkspace } from "../../../../data/workspace/useWorkspace";
import { useLabels } from "../../../../data/labels/useLabels";
import type { Labels } from "../../../../data/labels/useLabels";
import { logError } from "../../../../data/storage/errorLogger";
import { listMonthFolders } from "../../../../data/population/populationStorage";
import { readWorkbookTables } from "../../../../data/adhocImport/adhocSourceTable";
import { autoDetectMapping } from "../../../../data/adhocImport/adhocMappingModel";
import { EXCEL_INTO_MONTH_FIELD_CATALOG } from "../../../../data/adhocImport/adhocFieldCatalog";
import { projectTable } from "../../../../data/adhocImport/adhocRowProjection";
import type { SourceTable } from "../../../../data/adhocImport/adhocImportModel";
import { executeSplitMonth, planSplitMonth, type SplitPlan } from "../../../../data/monthTransfer/splitMonthByIndexList";
import { broadcastDataRefresh, notifyLocalDataChange } from "../../../../data/workspace/dataRefreshSignal";
import { recordAction } from "../../../../data/audit/actionLog";
import { ConfirmDialog } from "../../../ConfirmDialog/ConfirmDialog";
import "./TemplateRepairSection.css";

type Notice = { kind: "ok" | "info" | "error"; text: string };

function fill(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce((text, [key, value]) => text.split(`{${key}}`).join(String(value)), template);
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** The sheet's image ids, found by the same column detection the Excel import uses. */
function idsOf(table: SourceTable): string[] {
  const mapping = autoDetectMapping(table.headers, EXCEL_INTO_MONTH_FIELD_CATALOG);
  const rows = projectTable({ table, mapping, catalog: EXCEL_INTO_MONTH_FIELD_CATALOG, binding: { kind: "isolated" } });
  return rows.map((row) => row.mapped.xrayImageId).filter((id): id is string => Boolean(id));
}

function downloadReport(plan: SplitPlan, L: Labels): void {
  const wb = XLSX.utils.book_new();
  const sheet = (name: string, rows: unknown[][]) =>
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name.slice(0, 31));
  const id = L.excel_rows_report_col_id;
  sheet(L.split_month_report_moved, [[id, L.col_port_name], ...plan.moved.map((row) => [row.xrayImageId, row.portName ?? ""])]);
  sheet(L.split_month_report_kept_listed, [[id], ...plan.keptListed.map((x) => [x])]);
  sheet(L.split_month_report_kept_studied, [[id], ...plan.keptStudied.map((x) => [x])]);
  sheet(L.split_month_report_not_in_month, [[id], ...plan.listNotInMonth.map((x) => [x])]);
  XLSX.writeFile(wb, `split-${plan.month}.xlsx`);
}

/**
 * Admin «تقسيم الشهر حسب مستهدف المؤشر» (see `splitMonthByIndexList.ts`): pick
 * the month and the sheet listing the index's remaining cases; studied cases
 * and listed cases stay, every other unstudied case moves to the month's
 * exceptional cases.
 */
export function SplitMonthSection() {
  const { canMutate, username, role } = usePermissions();
  const canRun = role === "admin" && canMutate("view-error-log");
  const { directoryHandle } = useWorkspace();
  const L = useLabels();
  const [isOpen, setIsOpen] = useState(false);
  const [months, setMonths] = useState<string[]>([]);
  const [tables, setTables] = useState<SourceTable[]>([]);
  const [sheet, setSheet] = useState("");
  const [month, setMonth] = useState("");
  const [ids, setIds] = useState<string[] | null>(null);
  const [plan, setPlan] = useState<SplitPlan | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    if (!isOpen || !canRun || !directoryHandle) return;
    let cancelled = false;
    void listMonthFolders(directoryHandle)
      .then((found) => { if (!cancelled) setMonths(found.map((entry) => entry.folderName)); })
      .catch((error: unknown) => {
        logError("settings:split-month-list", error);
        if (!cancelled) setNotice({ kind: "error", text: fill(L.delete_month_list_failed, { error: errorText(error) }) });
      });
    return () => { cancelled = true; };
  }, [isOpen, canRun, directoryHandle, L.delete_month_list_failed]);

  if (!canRun) return null;

  function pickSheet(name: string, from: SourceTable[] = tables): void {
    setSheet(name);
    setPlan(null);
    const table = from.find((entry) => entry.sheetName === name);
    setIds(table ? idsOf(table) : null);
  }

  async function pickFile(file: File | undefined): Promise<void> {
    setNotice(null);
    setPlan(null);
    setIds(null);
    setTables([]);
    setSheet("");
    if (!file) return;
    setBusy(true);
    try {
      const read = await readWorkbookTables(file);
      setTables(read);
      if (read.length === 1) pickSheet(read[0].sheetName, read);
    } catch (error) {
      logError("settings:split-month-read", error);
      setNotice({ kind: "error", text: fill(L.excel_rows_read_failed, { error: errorText(error) }) });
    } finally {
      setBusy(false);
    }
  }

  const refusal = (reason: "month-closed" | "no-sample") =>
    reason === "month-closed" ? L.merge_month_refused_target_closed : L.merge_month_refused_target_no_sample;

  async function preview(): Promise<void> {
    if (!directoryHandle || !ids || !month) return;
    setBusy(true);
    setNotice({ kind: "info", text: L.excel_rows_checking });
    try {
      const result = await planSplitMonth(directoryHandle, month, ids);
      if (!result.ok) {
        setNotice({ kind: "error", text: refusal(result.reason) });
        return;
      }
      setPlan(result.plan);
      setNotice(null);
    } catch (error) {
      logError("settings:split-month-plan", error);
      setNotice({ kind: "error", text: fill(L.merge_month_check_failed, { error: errorText(error) }) });
    } finally {
      setBusy(false);
    }
  }

  async function run(): Promise<void> {
    setConfirming(false);
    if (!directoryHandle || !ids || !month || !canRun) return;
    setBusy(true);
    setNotice({ kind: "info", text: L.excel_rows_running });
    try {
      const result = await executeSplitMonth(directoryHandle, month, ids, username);
      if (!result.ok) {
        setNotice({ kind: "error", text: result.reason === "write-failed" ? fill(L.excel_rows_failed, { error: result.error }) : refusal(result.reason) });
        return;
      }
      recordAction(directoryHandle, username, role, "month-merged", {
        monthFolderName: month,
        target: sheet,
        details: { kind: "split-by-index-list", moved: result.moved, restored: result.restored, unrestored: result.unrestored, keptListed: result.plan.keptListed.length, keptStudied: result.plan.keptStudied.length },
      });
      notifyLocalDataChange(["manifest"]);
      broadcastDataRefresh("manual");
      downloadReport(result.plan, L);
      setPlan(null);
      setNotice({
        kind: result.unrestored > 0 ? "error" : "ok",
        text: fill(L.split_month_done, { moved: result.moved, restored: result.restored, unrestored: result.unrestored, month }),
      });
    } catch (error) {
      logError("settings:split-month", error);
      setNotice({ kind: "error", text: fill(L.excel_rows_failed, { error: errorText(error) }) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="template-repair-section" dir="rtl">
      <button type="button" className="template-repair-header" onClick={() => setIsOpen((open) => !open)} aria-expanded={isOpen}>
        <ChevronRight size={16} className={isOpen ? "template-repair-chevron-open" : ""} />
        <Split size={16} />
        <span>{L.split_month_title}</span>
      </button>

      {isOpen && (
        <div className="template-repair-body">
          <p className="template-repair-hint">{L.split_month_hint}</p>

          <div className="template-repair-controls">
            <label>
              {L.merge_month_target}{" "}
              <select value={month} onChange={(e) => { setMonth(e.target.value); setPlan(null); }} disabled={busy}>
                <option value="">—</option>
                {months.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </label>
            <label>
              {L.excel_rows_file}{" "}
              <input type="file" accept=".xlsx,.xls" disabled={busy} onChange={(e) => void pickFile(e.target.files?.[0])} />
            </label>
            {tables.length > 1 && (
              <label>
                {L.excel_rows_sheet}{" "}
                <select value={sheet} onChange={(e) => pickSheet(e.target.value)} disabled={busy}>
                  <option value="">—</option>
                  {tables.map((table) => (
                    <option key={table.sheetName} value={table.sheetName}>{`${table.sheetName} (${table.rows.length})`}</option>
                  ))}
                </select>
              </label>
            )}
            <button type="button" className="ew-btn-secondary" onClick={() => void preview()} disabled={busy || !ids || !month}>
              {L.excel_rows_check}
            </button>
          </div>

          {ids && !plan && <p>{fill(L.split_month_read_summary, { n: ids.length })}</p>}

          {plan && (
            <div className="template-repair-controls">
              <p>{fill(L.split_month_preview, {
                studied: plan.keptStudied.length,
                listed: plan.keptListed.length,
                moved: plan.moved.length,
                assigned: plan.movedAssigned,
                missing: plan.listNotInMonth.length,
                month: plan.month,
              })}</p>
              {plan.restorable > 0 && <p>{fill(L.split_month_restorable, { n: plan.restorable })}</p>}
              <button type="button" className="ew-btn-secondary" onClick={() => downloadReport(plan, L)} disabled={busy}>
                {L.excel_rows_report_button}
              </button>
              <button type="button" className="ew-btn-secondary" onClick={() => setConfirming(true)} disabled={busy || (plan.moved.length === 0 && plan.restorable === 0)}>
                {L.split_month_button}
              </button>
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
        title={L.split_month_title}
        message={<p>{fill(L.split_month_confirm, { moved: plan?.moved.length ?? 0, assigned: (plan?.movedAssigned ?? 0) + (plan?.restorable ?? 0), month })}</p>}
        confirmLabel={L.split_month_button}
        onConfirm={() => void run()}
        onCancel={() => setConfirming(false)}
      />
    </section>
  );
}
