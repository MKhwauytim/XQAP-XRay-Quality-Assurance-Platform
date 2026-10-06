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
import type { ExecutiveReportRow } from "../../../../../data/reporting/executiveReportTypes";
import {
  COMPREHENSIVE_MONTH_LABEL,
  buildComprehensiveInput,
  isCompletedSampleRow,
  formatComprehensivePeriod,
  mergeCompletedRows,
} from "../../../../../data/workbookImport/mergeWithSystem";
import type { ComprehensiveBase } from "../../../../../data/workbookImport/mergeWithSystem";
import type { MappedWorkbookRow } from "../../../../../data/workbookImport/workbookColumnMap";
import { recordAction } from "../../../../../data/audit/actionLog";
import { logError } from "../../../../../data/storage/errorLogger";
import { StatsPanel } from "./StatsPanel";
import { SourceModeSwitch } from "./SourceModeSwitch";
import { DEFAULT_SOURCE_MODE } from "./sourceMode";
import type { ComprehensiveSourceMode } from "./sourceMode";
import { useComprehensiveWorkbook } from "./useComprehensiveWorkbook";
import { loadDeckStyleChoices } from "../../../../../data/reporting/executive/deck2/styleChoices";
import { loadDeckEditionPreference } from "../../../../../data/reporting/executive/deckEditionPreference";
import type { ExecutiveDeckEdition } from "../../../../../data/reporting/executive/deckEditionPreference";

/** Families whose change can alter a month's completed answers (mirrors the Reports hub). */
const REFRESH_FAMILIES: readonly DataRefreshFamily[] = ["manifest", "distribution", "answers"];

type SystemMonths = { byMonth: Array<{ month: string; rows: ExecutiveReportRow[] }>; base: ComprehensiveBase | null };
type SystemState = { status: "loading" } | { status: "error" } | ({ status: "ready" } & SystemMonths);
// The executive deck (v2 or v3, whichever edition the workspace chose — same rule as the
// Reports tab) honours the completed-only scope: it drops the population/coverage sections.
type ExportKind = "deck" | "xlsx";

/** Names are not shown in the combined report (config.showEmployeeNames is false). */
const NO_NAMES: Record<string, string> = {};
// Stable empties so the merge memo is not invalidated on every render before data arrives.
const NO_MONTHS: SystemMonths["byMonth"] = [];
const NO_ROWS: MappedWorkbookRow[] = [];

/**
 * Load ONE month and keep only what the combined report needs: its completed
 * rows and the workspace-wide base. The month's full input (up to ~500k
 * population rows) goes out of scope on return, so it can be collected before
 * the next month is read.
 */
async function loadCompletedMonth(
  handle: NonNullable<ReturnType<typeof useWorkspace>["directoryHandle"]>,
  month: string,
): Promise<{ rows: ExecutiveReportRow[]; base: ComprehensiveBase } | null> {
  const input = await loadMonthExecInput(handle, month);
  if (!input) return null;
  return {
    rows: buildExecutiveReportRows(input).filter(isCompletedSampleRow),
    base: { template: input.template, config: input.config, stageMappings: input.stageMappings },
  };
}

/** Sub-tab of the Reports page. Sub-tab only: default export, nothing else. */
export default function ComprehensiveExecutive() {
  const labels = useLabels();
  const { directoryHandle } = useWorkspace();
  const { can, getMutationCapability, role, username } = usePermissions();
  const { state: workbook, selectFile, removeFile } = useComprehensiveWorkbook();
  const [mode, setMode] = useState<ComprehensiveSourceMode>(DEFAULT_SOURCE_MODE);
  const excelOnly = mode === "excel-only";
  const [system, setSystem] = useState<SystemState>({ status: "loading" });
  const [exporting, setExporting] = useState<ExportKind | null>(null);
  const [deckEdition, setDeckEdition] = useState<ExecutiveDeckEdition>("v2");
  const [exportError, setExportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const loadRunRef = useRef(0);
  const busyRef = useRef(false);
  const queuedRef = useRef(false);
  const unmountedRef = useRef(false);
  const latestRunRef = useRef<(() => Promise<void>) | null>(null);

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
      let base: ComprehensiveBase | null = null;
      for (const folder of folders) {
        const loaded = await loadCompletedMonth(directoryHandle, folder.folderName);
        if (!loaded) continue;
        base ??= loaded.base;
        byMonth.push({ month: folder.folderName, rows: loaded.rows });
      }
      if (loadRunRef.current === run) setSystem({ status: "ready", byMonth, base });
    } catch (error) {
      logError("comprehensive-executive:load-system", error);
      if (loadRunRef.current === run) setSystem({ status: "error" });
    }
  }, [directoryHandle]);

  // Coalesce: at most one load runs at a time; any number of requests made while
  // it runs collapse into exactly one trailing load (using the latest closure).
  const requestLoad = useCallback((run: () => Promise<void>) => {
    latestRunRef.current = run;
    if (busyRef.current) {
      queuedRef.current = true;
      return;
    }
    busyRef.current = true;
    void (async () => {
      try {
        do {
          queuedRef.current = false;
          await latestRunRef.current?.();
        } while (queuedRef.current && !unmountedRef.current);
      } finally {
        busyRef.current = false;
      }
    })();
  }, []);

  // A load still in flight at unmount must not set state: invalidate its run token.
  useEffect(() => {
    unmountedRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a run counter, not a DOM ref; the latest value is the point
    return () => { unmountedRef.current = true; loadRunRef.current++; };
  }, []);

  // System months are only read in "app+excel" mode; switching back re-runs this effect.
  useEffect(() => {
    if (!excelOnly) requestLoad(loadSystem);
  }, [excelOnly, loadSystem, requestLoad]);

  useEffect(() => {
    if (excelOnly) return undefined;
    return subscribeToDataChange(REFRESH_FAMILIES, () => { requestLoad(loadSystem); });
  }, [excelOnly, loadSystem, requestLoad]);

  // The workspace's chosen deck edition (same global preference the Reports tab reads);
  // v2 when none is recorded or no workspace is mounted.
  useEffect(() => {
    if (!directoryHandle) return undefined;
    let cancelled = false;
    void loadDeckEditionPreference(directoryHandle).then((pref) => {
      if (!cancelled && pref) setDeckEdition(pref.edition);
    });
    return () => { cancelled = true; };
  }, [directoryHandle]);

  // Changing mode drops any stored system rows (releases memory) and invalidates
  // an in-flight load so its stale result cannot win. The workbook is untouched.
  function handleModeChange(next: ComprehensiveSourceMode): void {
    if (next === mode) return;
    loadRunRef.current++;
    setSystem({ status: "loading" });
    setMode(next);
  }

  // On a system-load error the workbook alone can still produce a report (fallback base below).
  const systemByMonth = !excelOnly && system.status === "ready" ? system.byMonth : NO_MONTHS;
  const systemLoading = !excelOnly && system.status === "loading";
  const systemFailed = !excelOnly && system.status === "error";
  const workbookRows = workbook.status === "read" ? workbook.rows : NO_ROWS;
  const merged = useMemo(() => mergeCompletedRows(systemByMonth, workbookRows), [systemByMonth, workbookRows]);
  const report = workbook.status === "read" ? workbook.report : null;

  // Export gating mirrors Reports TabView: the feature flag at render, and the
  // authoritative mutation capability again in the handler.
  const canExportReports = can("export-reports");
  const hasRows = merged.rows.length > 0;
  const exportDisabled = !canExportReports || !hasRows || exporting !== null || systemLoading;

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
    if (exporting || !hasRows) return;
    const capability: MutationCapability = getMutationCapability("export-reports");
    if (!capability.allowed) {
      setExportError(capability.reason === "read-only-mode" ? labels.msg_export_read_only_demo : labels.msg_export_not_permitted);
      return;
    }
    setExportError(null);
    setExporting(kind);
    try {
      const base: ComprehensiveBase = (!excelOnly && system.status === "ready" ? system.base : null) ?? {
        template: null,
        config: DEFAULT_EXEC_CONFIG,
      };
      const input = buildComprehensiveInput(merged.rows, base, merged.period);
      if (kind === "deck" && deckEdition === "v3") {
        const { openExecutiveDeckV3 } = await import("../../../../../data/reporting/executive/deck3");
        await openExecutiveDeckV3(input, NO_NAMES);
      } else if (kind === "deck") {
        // Same saved slide styles the Reports tab's deck uses; none without a workspace.
        const saved = directoryHandle ? await loadDeckStyleChoices(directoryHandle) : null;
        const { openExecutiveDeckV2 } = await import("../../../../../data/reporting/executive/deck2");
        await openExecutiveDeckV2(input, NO_NAMES, saved?.choices);
      } else {
        const { buildExecutiveXlsx } = await import("../../../../../data/reporting/executiveReport");
        await buildExecutiveXlsx(input, NO_NAMES);
      }
      // The audit trail lives in the workspace; with none mounted there is nowhere to write it.
      if (directoryHandle) {
        recordAction(directoryHandle, username, role, "report-generated", {
          monthFolderName: COMPREHENSIVE_MONTH_LABEL,
          details: { kind: `comprehensive-${kind}` },
        });
      }
    } catch (error) {
      logError("comprehensive-executive:generate", error);
      setExportError(labels.ce_generate_failed);
    } finally {
      setExporting(null);
    }
  }

  const reading = workbook.status === "reading";
  const needsFile = excelOnly && workbook.status !== "read" && !reading;

  return (
    <section className="page-shell ce-page" dir="rtl" data-testid="comprehensive-executive">
      <PageHeader eyebrow={labels.ce_eyebrow} title={labels.ce_title} subtitle={labels.ce_subtitle} />

      <SourceModeSwitch labels={labels} mode={mode} onChange={handleModeChange} />

      <div className="ce-card">
        <p className="ce-hint">{excelOnly ? labels.ce_upload_hint_required : labels.ce_upload_hint}</p>
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

      {systemLoading && <p className="ce-status" role="status">{labels.ce_load_system}</p>}
      {systemFailed && <p className="ce-error" role="alert">{labels.ce_system_load_failed}</p>}

      {!systemLoading && (
        <StatsPanel labels={labels} stats={merged.stats} totalRows={merged.rows.length} report={report} mode={mode} />
      )}
      {!systemLoading && merged.period && (
        <p className="ce-status" data-testid="ce-period">
          {labels.ce_period_title}: {formatComprehensivePeriod(merged.period)}
        </p>
      )}
      {needsFile && <p className="ce-empty" role="status" data-testid="ce-excel-only-hint">{labels.ce_source_excel_only_hint}</p>}
      {!systemLoading && !hasRows && !needsFile && <p className="ce-empty" role="status">{labels.ce_empty}</p>}

      <div className="ce-row ce-actions">
        <button type="button" className="ce-btn" disabled={exportDisabled} onClick={() => void handleExport("deck")}>
          {labels.ce_generate_deck}
        </button>
        <button type="button" className="ce-btn" disabled={exportDisabled} onClick={() => void handleExport("xlsx")}>
          {labels.ce_generate_xlsx}
        </button>
      </div>
      {exportError && <p className="ce-error" role="alert">{exportError}</p>}
    </section>
  );
}
