import { useEffect, useState } from "react";
import { AlertTriangle, ChevronRight, FilePlus2 } from "lucide-react";
import * as XLSX from "xlsx";

import { usePermissions } from "../../../../auth/usePermissions";
import { useWorkspace } from "../../../../data/workspace/useWorkspace";
import { useLabels } from "../../../../data/labels/useLabels";
import { logError } from "../../../../data/storage/errorLogger";
import { listMonthFolders } from "../../../../data/population/populationStorage";
import { readWorkbookTables } from "../../../../data/adhocImport/adhocSourceTable";
import { autoDetectMapping } from "../../../../data/adhocImport/adhocMappingModel";
import { EXCEL_INTO_MONTH_FIELD_CATALOG } from "../../../../data/adhocImport/adhocFieldCatalog";
import { projectTable } from "../../../../data/adhocImport/adhocRowProjection";
import type { AdhocRow, SourceTable } from "../../../../data/adhocImport/adhocImportModel";
import { loadSampleMaster } from "../../../../data/sampling/sampleStorage";
import {
  buildIncompleteCasesSheet,
  executeExcelRowsIntoMonth,
  planExcelRowsIntoMonth,
  type ExcelRowsPlan,
} from "../../../../data/monthTransfer/excelRowsIntoMonth";
import { broadcastDataRefresh, notifyLocalDataChange } from "../../../../data/workspace/dataRefreshSignal";
import { recordAction } from "../../../../data/audit/actionLog";
import type { Labels } from "../../../../data/labels/useLabels";
import { ConfirmDialog } from "../../../ConfirmDialog/ConfirmDialog";
import "./TemplateRepairSection.css";

type Notice = { kind: "ok" | "info" | "error"; text: string };

function fill(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce((text, [key, value]) => text.split(`{${key}}`).join(String(value)), template);
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

function projectRows(table: SourceTable): AdhocRow[] {
  const mapping = autoDetectMapping(table.headers, EXCEL_INTO_MONTH_FIELD_CATALOG);
  return projectTable({ table, mapping, catalog: EXCEL_INTO_MONTH_FIELD_CATALOG, binding: { kind: "isolated" } });
}

/** «موجودة» cases sitting in a sample with no employee: the queue does not list them. */
const undistributedCount = (plan: ExcelRowsPlan): number =>
  plan.existing.filter((entry) => entry.location.where === "sample" && entry.assignedTo === null).length;

/** One sheet per outcome, so the admin sees exactly what was added and why the rest was not. */
function downloadReport(plan: ExcelRowsPlan, L: Labels): void {
  const wb = XLSX.utils.book_new();
  const sheet = (name: string, rows: unknown[][]) =>
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name.slice(0, 31));
  sheet(L.excel_rows_report_added, [
    [L.excel_rows_report_col_id, L.col_port_name, L.col_xray_entry_date],
    ...plan.added.map((row) => [row.xrayImageId, row.portName ?? "", row.xrayEntryDate ?? ""]),
  ]);
  sheet(L.excel_rows_report_from_population, [
    [L.excel_rows_report_col_id, L.col_port_name],
    ...plan.fromPopulation.map((row) => [row.xrayImageId, row.portName ?? ""]),
  ]);
  sheet(L.excel_rows_report_existing, [
    [L.excel_rows_report_col_id, L.excel_rows_report_col_location, L.excel_rows_report_col_where, L.excel_rows_report_col_assignment],
    ...plan.existing.map((entry) => [
      entry.xrayImageId,
      entry.location.folder,
      entry.location.where === "sample" ? L.excel_rows_where_sample : L.excel_rows_where_population,
      entry.location.where !== "sample" ? "" : entry.assignedTo ?? L.excel_rows_not_distributed,
    ]),
    ...plan.repeatedInFile.map((id) => [id, L.excel_rows_repeated_in_file, ""]),
  ]);
  sheet(L.excel_rows_report_filled, [
    [L.excel_rows_report_col_id, L.excel_rows_report_col_field, L.excel_rows_report_col_value],
    ...plan.filled.map((change) => [
      change.xrayImageId,
      EXCEL_INTO_MONTH_FIELD_CATALOG.find((field) => field.key === change.field)?.labelAr ?? change.field,
      change.newValue,
    ]),
  ]);
  sheet(L.excel_rows_report_invalid, [
    [L.excel_rows_report_col_row, L.excel_rows_report_col_id, L.excel_rows_report_col_reason],
    ...plan.invalid.map((entry) => [entry.rowKey, entry.xrayImageId ?? "", entry.reason]),
  ]);
  XLSX.writeFile(wb, `excel-rows-${plan.targetMonth}.xlsx`);
}

/**
 * Admin «إضافة حالات من ملف إكسل إلى شهر» (see `excelRowsIntoMonth.ts`): pick a
 * workbook and sheet, pick the month, preview what is new versus already in the
 * workspace, confirm, and download the report of what happened.
 */
export function ExcelRowsIntoMonthSection() {
  const { canMutate, username, role } = usePermissions();
  const canImport = role === "admin" && canMutate("view-error-log");
  const { directoryHandle } = useWorkspace();
  const L = useLabels();
  const [isOpen, setIsOpen] = useState(false);
  const [months, setMonths] = useState<string[]>([]);
  const [tables, setTables] = useState<SourceTable[]>([]);
  const [sheet, setSheet] = useState("");
  const [target, setTarget] = useState("");
  const [rows, setRows] = useState<AdhocRow[] | null>(null);
  const [plan, setPlan] = useState<ExcelRowsPlan | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    if (!isOpen || !canImport || !directoryHandle) return;
    let cancelled = false;
    void listMonthFolders(directoryHandle)
      .then((found) => { if (!cancelled) setMonths(found.map((entry) => entry.folderName)); })
      .catch((error: unknown) => {
        logError("settings:excel-rows-list", error);
        if (!cancelled) setNotice({ kind: "error", text: fill(L.delete_month_list_failed, { error: errorText(error) }) });
      });
    return () => { cancelled = true; };
  }, [isOpen, canImport, directoryHandle, L.delete_month_list_failed]);

  if (!canImport) return null;

  /** The target month's cases that still have blanks, to fill in Excel and upload back here. */
  async function exportIncomplete(): Promise<void> {
    if (!directoryHandle || !target) return;
    setBusy(true);
    try {
      const sample = await loadSampleMaster(directoryHandle, target);
      const sheetRows = buildIncompleteCasesSheet(sample?.rows ?? []);
      if (sheetRows.length <= 1) {
        setNotice({ kind: "info", text: L.excel_rows_incomplete_none });
        return;
      }
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheetRows), L.excel_rows_incomplete_sheet.slice(0, 31));
      XLSX.writeFile(wb, `incomplete-cases-${target}.xlsx`);
      setNotice({ kind: "info", text: fill(L.excel_rows_incomplete_done, { n: sheetRows.length - 1, target }) });
    } catch (error) {
      logError("settings:excel-rows-export-incomplete", error);
      setNotice({ kind: "error", text: fill(L.excel_rows_failed, { error: errorText(error) }) });
    } finally {
      setBusy(false);
    }
  }

  function pickSheet(name: string, from: SourceTable[] = tables): void {
    setSheet(name);
    setPlan(null);
    const table = from.find((entry) => entry.sheetName === name);
    setRows(table ? projectRows(table) : null);
  }

  async function pickFile(file: File | undefined): Promise<void> {
    setNotice(null);
    setPlan(null);
    setRows(null);
    setTables([]);
    setSheet("");
    if (!file) return;
    setBusy(true);
    try {
      const read = await readWorkbookTables(file);
      setTables(read);
      if (read.length === 1) pickSheet(read[0].sheetName, read);
    } catch (error) {
      logError("settings:excel-rows-read", error);
      setNotice({ kind: "error", text: fill(L.excel_rows_read_failed, { error: errorText(error) }) });
    } finally {
      setBusy(false);
    }
  }

  async function preview(): Promise<void> {
    if (!directoryHandle || !rows || !target) return;
    setBusy(true);
    setNotice({ kind: "info", text: L.excel_rows_checking });
    try {
      const result = await planExcelRowsIntoMonth(directoryHandle, rows, target);
      if (!result.ok) {
        setNotice({ kind: "error", text: result.reason === "target-closed" ? L.merge_month_refused_target_closed : L.merge_month_refused_target_no_sample });
        return;
      }
      setPlan(result.plan);
      setNotice(null);
    } catch (error) {
      logError("settings:excel-rows-plan", error);
      setNotice({ kind: "error", text: fill(L.merge_month_check_failed, { error: errorText(error) }) });
    } finally {
      setBusy(false);
    }
  }

  async function run(): Promise<void> {
    setConfirming(false);
    if (!directoryHandle || !rows || !target || !canImport) return;
    setBusy(true);
    setNotice({ kind: "info", text: L.excel_rows_running });
    try {
      const result = await executeExcelRowsIntoMonth(directoryHandle, rows, target, username);
      if (!result.ok) {
        const text = result.reason === "write-failed"
          ? fill(L.excel_rows_failed, { error: result.error })
          : result.reason === "target-closed" ? L.merge_month_refused_target_closed : L.merge_month_refused_target_no_sample;
        setNotice({ kind: "error", text });
        return;
      }
      recordAction(directoryHandle, username, role, "month-merged", {
        monthFolderName: target,
        target: sheet,
        details: { kind: "excel-rows", drawn: result.drawnFromPopulation, added: result.addedToSample, filled: result.filledResults, existing: result.plan.existing.length, invalid: result.plan.invalid.length },
      });
      notifyLocalDataChange(["manifest"]);
      broadcastDataRefresh("manual");
      downloadReport(result.plan, L);
      setPlan(null);
      setNotice({
        kind: "ok",
        text: (result.drawnFromPopulation > 0 ? fill(L.excel_rows_from_population_done, { n: result.drawnFromPopulation }) + " " : "") + fill(L.excel_rows_done, { added: result.addedToSample, filled: result.filledResults, existing: result.plan.existing.length, target }),
      });
    } catch (error) {
      logError("settings:excel-rows", error);
      setNotice({ kind: "error", text: fill(L.excel_rows_failed, { error: errorText(error) }) });
    } finally {
      setBusy(false);
    }
  }

  const invalidCount = rows?.filter((row) => !row.validation.valid).length ?? 0;

  return (
    <section className="template-repair-section" dir="rtl">
      <button type="button" className="template-repair-header" onClick={() => setIsOpen((open) => !open)} aria-expanded={isOpen}>
        <ChevronRight size={16} className={isOpen ? "template-repair-chevron-open" : ""} />
        <FilePlus2 size={16} />
        <span>{L.excel_rows_title}</span>
      </button>

      {isOpen && (
        <div className="template-repair-body">
          <p className="template-repair-hint">{L.excel_rows_hint}</p>

          <div className="template-repair-controls">
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
            <label>
              {L.merge_month_target}{" "}
              <select value={target} onChange={(e) => { setTarget(e.target.value); setPlan(null); }} disabled={busy}>
                <option value="">—</option>
                {months.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </label>
            <button type="button" className="ew-btn-secondary" onClick={() => void preview()} disabled={busy || !rows || !target}>
              {L.excel_rows_check}
            </button>
            <button type="button" className="ew-btn-secondary" onClick={() => void exportIncomplete()} disabled={busy || !target}>
              {L.excel_rows_incomplete_button}
            </button>
          </div>

          {rows && !plan && (
            <p>{fill(L.excel_rows_read_summary, { rows: rows.length, invalid: invalidCount })}</p>
          )}

          {plan && (
            <div className="template-repair-controls">
              <p>{fill(L.excel_rows_preview, {
                added: plan.added.length,
                existing: plan.existing.length,
                repeated: plan.repeatedInFile.length,
                invalid: plan.invalid.length,
                filled: plan.filled.length,
                target: plan.targetMonth,
              })}</p>
              {undistributedCount(plan) > 0 && <p>{fill(L.excel_rows_existing_undistributed, { n: undistributedCount(plan) })}</p>}
              {plan.fromPopulation.length > 0 && <p>{fill(L.excel_rows_from_population, { n: plan.fromPopulation.length, target: plan.targetMonth })}</p>}
              <button type="button" className="ew-btn-secondary" onClick={() => downloadReport(plan, L)} disabled={busy}>
                {L.excel_rows_report_button}
              </button>
              <button type="button" className="ew-btn-secondary" onClick={() => setConfirming(true)} disabled={busy || (plan.added.length === 0 && plan.filled.length === 0 && plan.fromPopulation.length === 0)}>
                {L.excel_rows_button}
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
        title={L.excel_rows_title}
        message={<p>{fill(L.excel_rows_confirm, { added: plan?.added.length ?? 0, filled: plan?.filled.length ?? 0, target })}</p>}
        confirmLabel={L.excel_rows_button}
        onConfirm={() => void run()}
        onCancel={() => setConfirming(false)}
      />
    </section>
  );
}
