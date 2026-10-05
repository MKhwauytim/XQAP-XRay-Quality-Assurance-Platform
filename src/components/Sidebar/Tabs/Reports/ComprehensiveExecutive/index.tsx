import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import "./ComprehensiveExecutive.css";
import { PageHeader } from "../../../../PageHeader/PageHeader";
import { usePermissions } from "../../../../../auth/usePermissions";
import { useLabels } from "../../../../../data/labels/useLabels";
import type { MutationCapability } from "../../../../../auth/mutationCapability";
import { useWorkspace } from "../../../../../data/workspace/useWorkspace";
import { subscribeToDataChange } from "../../../../../data/workspace/dataRefreshSignal";
import type { DataRefreshFamily } from "../../../../../data/workspace/dataRefreshSignal";
import { listMonthFolders } from "../../../../../data/population/populationStorage";
import { loadMonthExecInput } from "../../../../../data/reporting/loadMonthExecInput";
import { buildExecutiveReportRows } from "../../../../../data/reporting/executiveReportData";
import { DEFAULT_EXEC_CONFIG } from "../../../../../data/reporting/executiveReportTypes";
import type { ExecutiveReportInput, ExecutiveReportRow } from "../../../../../data/reporting/executiveReportTypes";
import { loadDeckEditionPreference } from "../../../../../data/reporting/executive/deckEditionPreference";
import type { ExecutiveDeckEdition } from "../../../../../data/reporting/executive/deckEditionPreference";
import { loadDeckStyleChoices } from "../../../../../data/reporting/executive/deck2/styleChoices";
import {
  COMPREHENSIVE_MONTH_LABEL,
  buildComprehensiveInput,
  mergeCompletedRows,
} from "../../../../../data/workbookImport/mergeWithSystem";
import type { MappedWorkbookRow } from "../../../../../data/workbookImport/workbookColumnMap";
import { recordAction } from "../../../../../data/audit/actionLog";
import { logError } from "../../../../../data/storage/errorLogger";
import { StatsPanel } from "./StatsPanel";
import { useComprehensiveWorkbook } from "./useComprehensiveWorkbook";

/** Families whose change can alter a month's completed answers (mirrors the Reports hub). */
const REFRESH_FAMILIES: readonly DataRefreshFamily[] = ["manifest", "distribution", "answers"];

type SystemMonths = { byMonth: Array<{ month: string; rows: ExecutiveReportRow[] }>; base: ExecutiveReportInput | null };
type SystemState = { status: "loading" } | { status: "error" } | ({ status: "ready" } & SystemMonths);
type ExportKind = "document" | "deck" | "xlsx";

/** Names are not shown in the combined report (config.showEmployeeNames is false). */
const NO_NAMES: Record<string, string> = {};
// Stable empties so the merge memo is not invalidated on every render before data arrives.
const NO_MONTHS: SystemMonths["byMonth"] = [];
const NO_ROWS: MappedWorkbookRow[] = [];

/** Sub-tab of the Reports page. Sub-tab only: default export, nothing else. */
export default function ComprehensiveExecutive() {
  const labels = useLabels();
  const { directoryHandle } = useWorkspace();
  const { can, getMutationCapability, role, username } = usePermissions();
  const { state: workbook, selectFile, removeFile } = useComprehensiveWorkbook();
  const [system, setSystem] = useState<SystemState>({ status: "loading" });
  const [deckEdition, setDeckEdition] = useState<ExecutiveDeckEdition>("v2");
  const [exporting, setExporting] = useState<ExportKind | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const loadRunRef = useRef(0);

  // Reload every month's completed rows. Touches ONLY system state, so a refresh
  // can never clobber a workbook the user has already read.
  const loadSystem = useCallback(async () => {
    if (!directoryHandle) {
      setSystem({ status: "ready", byMonth: [], base: null });
      return;
    }
    const run = ++loadRunRef.current;
    try {
      const folders = await listMonthFolders(directoryHandle);
      const byMonth: SystemMonths["byMonth"] = [];
      let base: ExecutiveReportInput | null = null;
      for (const folder of folders) {
        const input = await loadMonthExecInput(directoryHandle, folder.folderName);
        if (!input) continue;
        base ??= input;
        byMonth.push({ month: folder.folderName, rows: buildExecutiveReportRows(input) });
      }
      if (loadRunRef.current === run) setSystem({ status: "ready", byMonth, base });
    } catch (error) {
      logError("comprehensive-executive:load-system", error);
      if (loadRunRef.current === run) setSystem({ status: "error" });
    }
  }, [directoryHandle]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial async load; loadSystem only sets state after awaiting disk
    void loadSystem();
  }, [loadSystem]);

  useEffect(
    () => subscribeToDataChange(REFRESH_FAMILIES, () => { void loadSystem(); }),
    [loadSystem]
  );

  useEffect(() => {
    if (!directoryHandle) return;
    let cancelled = false;
    void loadDeckEditionPreference(directoryHandle).then((pref) => {
      if (!cancelled && pref) setDeckEdition(pref.edition);
    });
    return () => { cancelled = true; };
  }, [directoryHandle]);

  const systemByMonth = system.status === "ready" ? system.byMonth : NO_MONTHS;
  const workbookRows = workbook.status === "read" ? workbook.rows : NO_ROWS;
  const merged = useMemo(() => mergeCompletedRows(systemByMonth, workbookRows), [systemByMonth, workbookRows]);
  const report = workbook.status === "read" ? workbook.report : null;

  // Export gating mirrors Reports TabView: the feature flag at render, and the
  // authoritative mutation capability again in the handler.
  const canExportReports = can("export-reports");
  const hasRows = merged.rows.length > 0;
  const exportDisabled = !canExportReports || !hasRows || exporting !== null || system.status !== "ready";

  function handleFileChange(ev: ChangeEvent<HTMLInputElement>): void {
    const file = ev.target.files?.[0];
    ev.target.value = "";
    if (file) selectFile(file);
  }

  function handleRemove(): void {
    removeFile();
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleExport(kind: ExportKind): Promise<void> {
    if (!directoryHandle || exporting || !hasRows) return;
    const capability: MutationCapability = getMutationCapability("export-reports");
    if (!capability.allowed) {
      setExportError(capability.reason === "read-only-mode" ? labels.msg_export_read_only_demo : labels.msg_export_not_permitted);
      return;
    }
    setExportError(null);
    setExporting(kind);
    try {
      const base: ExecutiveReportInput = (system.status === "ready" ? system.base : null) ?? {
        monthFolderName: COMPREHENSIVE_MONTH_LABEL,
        populationRows: [],
        sample: null,
        distribution: null,
        employeeFiles: [],
        template: null,
        config: DEFAULT_EXEC_CONFIG,
      };
      const input = buildComprehensiveInput(merged.rows, base);
      if (kind === "document") {
        const { openExecutiveReport } = await import("../../../../../data/reporting/executiveReport");
        await openExecutiveReport(input, NO_NAMES);
      } else if (kind === "deck") {
        if (deckEdition === "v3") {
          const { openExecutiveDeckV3 } = await import("../../../../../data/reporting/executive/deck3");
          await openExecutiveDeckV3(input, NO_NAMES);
        } else {
          const saved = await loadDeckStyleChoices(directoryHandle);
          const { openExecutiveDeckV2 } = await import("../../../../../data/reporting/executive/deck2");
          await openExecutiveDeckV2(input, NO_NAMES, saved?.choices);
        }
      } else {
        const { buildExecutiveXlsx } = await import("../../../../../data/reporting/executiveReport");
        await buildExecutiveXlsx(input, NO_NAMES);
      }
      recordAction(directoryHandle, username, role, "report-generated", {
        monthFolderName: COMPREHENSIVE_MONTH_LABEL,
        details: { kind: `comprehensive-${kind}` },
      });
    } catch (error) {
      logError("comprehensive-executive:generate", error);
      setExportError(labels.ce_generate_failed);
    } finally {
      setExporting(null);
    }
  }

  const reading = workbook.status === "reading";
  const deckLabel = deckEdition === "v3" ? labels.ce_generate_deck3 : labels.ce_generate_deck2;

  return (
    <section className="page-shell ce-page" dir="rtl" data-testid="comprehensive-executive">
      <PageHeader eyebrow={labels.ce_eyebrow} title={labels.ce_title} subtitle={labels.ce_subtitle} />

      <div className="ce-card">
        <p className="ce-hint">{labels.ce_upload_hint}</p>
        <div className="ce-row">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx"
            className="ce-file-input"
            aria-label={labels.ce_choose_file}
            data-testid="ce-file-input"
            disabled={reading}
            onChange={handleFileChange}
          />
          {workbook.status !== "none" && (
            <>
              <span className="ce-file-name" dir="auto">{workbook.fileName}</span>
              <button type="button" className="ce-btn ce-btn-secondary" onClick={handleRemove}>
                {labels.ce_remove_file}
              </button>
            </>
          )}
        </div>
        {reading && (
          <p className="ce-status" role="status">
            {workbook.sheet ? labels.ce_reading_sheet.replace("{sheet}", workbook.sheet) : labels.ce_reading}
          </p>
        )}
        {workbook.status === "error" && (
          <p className="ce-error" role="alert">{labels[`ce_error_${workbook.code}` as const]}</p>
        )}
      </div>

      {system.status === "loading" && <p className="ce-status" role="status">{labels.ce_load_system}</p>}
      {system.status === "error" && <p className="ce-error" role="alert">{labels.ce_system_load_failed}</p>}

      {system.status === "ready" && (
        <StatsPanel labels={labels} stats={merged.stats} totalRows={merged.rows.length} report={report} />
      )}
      {system.status === "ready" && !hasRows && <p className="ce-empty" role="status">{labels.ce_empty}</p>}

      <div className="ce-row ce-actions">
        <button type="button" className="ce-btn" disabled={exportDisabled} onClick={() => void handleExport("document")}>
          {labels.ce_generate_doc}
        </button>
        <button type="button" className="ce-btn" disabled={exportDisabled} onClick={() => void handleExport("deck")}>
          {deckLabel}
        </button>
        <button type="button" className="ce-btn" disabled={exportDisabled} onClick={() => void handleExport("xlsx")}>
          {labels.ce_generate_xlsx}
        </button>
      </div>
      {exportError && <p className="ce-error" role="alert">{exportError}</p>}
    </section>
  );
}
