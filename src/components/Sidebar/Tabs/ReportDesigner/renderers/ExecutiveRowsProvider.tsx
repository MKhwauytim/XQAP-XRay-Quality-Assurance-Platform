import { useEffect, useState, type ReactNode } from "react";
import { useWorkspace } from "../../../../../data/workspace/useWorkspace";
import { useGlobalMonth } from "../../../../../data/month/useGlobalMonth";
import { loadMonthPopulationFinal } from "../../../../../data/population/populationStorage";
import { loadSampleMaster } from "../../../../../data/sampling/sampleStorage";
import { loadOrDeriveDistributionCurrentForRead } from "../../../../../data/distribution/distributionStorage";
import { loadAllEmployeeFiles } from "../../../../../data/answers/answerStorage";
import { loadInspectionTemplateSelection } from "../../../../../data/templates/templateSelectionStorage";
import { loadTemplate } from "../../../../../data/templates/templateStorage";
import { buildExecutiveReportRows } from "../../../../../data/reporting/executiveReportData";
import { DEFAULT_EXEC_CONFIG } from "../../../../../data/reporting/executiveReportTypes";
import type { PreparedPopulationRow } from "../../../../../data/population/populationTypes";
import { logError } from "../../../../../data/storage/errorLogger";
import { useLabels } from "../../../../../data/labels/useLabels";
import {
  EXECUTIVE_ROWS_EMPTY,
  EXECUTIVE_ROWS_LOADING,
  ExecutiveRowsContext,
  toExecutiveRowsState,
  type ExecutiveRow,
  type ExecutiveRowsState,
} from "./executiveRowsContext";

/**
 * Loads the globally selected month once and builds the executive report rows the same way the
 * Power BI export does (`buildExecutiveReportRows`), shared across every KPI tile on the canvas
 * via context.
 *
 * Previously each `KpiRenderer` instance ran this whole read+build independently in its own
 * `useEffect` (`Canvas.tsx` renders one `<KpiRenderer>` per kpi element, with no de-duplication) —
 * N tiles meant N full `loadMonthPopulationFinal` → `loadSampleMaster` →
 * `loadOrDeriveDistributionCurrent` → `loadAllEmployeeFiles` → `buildExecutiveReportRows` passes
 * over the whole month. This provider runs it once per `(directoryHandle, monthFolder)`.
 *
 * This also fixes a correctness bug: the old per-tile hook hardcoded `template: null` and never
 * resolved `template.selection.json` / called `loadTemplate`, unlike the executive report, the
 * management reports, and `XrayInspectionResults`. That silently broke label-based fields (image
 * quality, marking, suspicion level, suspected types, smuggling method) on KPI tiles, which could
 * then disagree with the executive report for the same field and month. The template is now loaded
 * and passed through so KPI tiles resolve label-based fields identically.
 *
 * Read-only rendering path — distinct from the write-path correctness checks elsewhere in the app
 * that must always read fresh. Those are untouched by this change.
 */
export function ExecutiveRowsProvider({ children }: { children: ReactNode }) {
  const { directoryHandle } = useWorkspace();
  const { selection } = useGlobalMonth();
  const labels = useLabels();
  const monthFolder = selection.kind === "existing" ? selection.folderName : null;
  const [rows, setRows] = useState<ExecutiveRowsState>(EXECUTIVE_ROWS_LOADING);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!directoryHandle || !monthFolder) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync reset so a pending/none selection never shows a previous month's KPIs
      setRows(EXECUTIVE_ROWS_LOADING);
      setLoadError(null);
      return;
    }
    const root = directoryHandle;
    const month = monthFolder;
    let cancelled = false;
    setRows(EXECUTIVE_ROWS_LOADING);
    setLoadError(null);
    void (async () => {
      const [populationData, sample, templateSelection] = await Promise.all([
        loadMonthPopulationFinal(root, month),
        loadSampleMaster(root, month),
        loadInspectionTemplateSelection(root),
      ]);
      const sampleRows = sample?.rows ?? [];
      const [distribution, employeeFiles, template] = await Promise.all([
        loadOrDeriveDistributionCurrentForRead(root, month, sampleRows),
        loadAllEmployeeFiles(root, month),
        templateSelection?.templateId ? loadTemplate(root, templateSelection.templateId) : Promise.resolve(null),
      ]);
      if (cancelled) return;

      const execRows = buildExecutiveReportRows({
        monthFolderName: month,
        populationRows: (populationData?.rows ?? []) as PreparedPopulationRow[],
        sample: sample ?? null,
        distribution: distribution ?? null,
        employeeFiles,
        template,
        config: DEFAULT_EXEC_CONFIG,
      });

      if (!cancelled) {
        setRows(toExecutiveRowsState(execRows.map((r) => r as ExecutiveRow)));
      }
    })().catch((error: unknown) => {
      // Previously a bare `void (async () => {...})()` with no `.catch` — a rejection here became
      // an unhandled promise rejection and `rows` sat at `null` forever, which `KpiRenderer` reads
      // as "still loading". Every KPI tile spun indefinitely instead of showing a failure.
      if (cancelled) return;
      logError("reportDesigner:executiveRowsProvider", error);
      // Settled, with nothing to show. Tiles render «—» (never a fabricated 0) and the
      // banner below explains why.
      setRows(EXECUTIVE_ROWS_EMPTY);
      setLoadError(labels.rd_kpi_rows_load_error);
    });
    return () => { cancelled = true; };
  }, [directoryHandle, monthFolder, labels.rd_kpi_rows_load_error]);

  return (
    <ExecutiveRowsContext.Provider value={rows}>
      {loadError && (
        <div role="alert" style={{ padding: "6px 12px", fontSize: 12, color: "var(--c-danger)", background: "var(--c-danger-bg)" }}>
          {loadError}
        </div>
      )}
      {children}
    </ExecutiveRowsContext.Provider>
  );
}
