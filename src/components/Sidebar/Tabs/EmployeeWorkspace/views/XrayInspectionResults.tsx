import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarOff } from "lucide-react";
import { readSession } from "../../../../../auth/authSession";
import {
  hasFeature,
  readUserManagementState,
  subscribeToUserManagementChanges,
} from "../../../../../auth/userManagement";
import { PageHeader } from "../../../../../components/PageHeader/PageHeader";
import { EmptyState, ErrorState, LoadingState } from "../../../../../components/StateViews/StateViews";
import DataTable, {
  type CellMeta,
  type ColConfig,
  type DataTableCol,
} from "../../../../../components/DataTable";
import {
  formatDate,
  looksLikeDate,
  type DateFormatMode,
} from "../../../../../components/DataTable/utils";
import { loadAllEmployeeFiles, loadEmployeeAnswers } from "../../../../../data/answers/answerStorage";
import type { ItemAnswer } from "../../../../../data/answers/answerTypes";
import {
  loadDistributionLog,
  loadOrDeriveDistributionCurrent,
} from "../../../../../data/distribution/distributionStorage";
import type { DistributionEntry, DistributionEvent } from "../../../../../data/distribution/distributionTypes";
import {
  loadReferralLog,
  loadReplacementLog,
} from "../../../../../data/referral/referralStorage";
import type { ReferralRequest, ReplacementRequest } from "../../../../../data/referral/referralTypes";
import { loadAdminBrowsePreset, loadUserBrowsePreset } from "../../../../../data/preferences/browsePresetStorage";
import { listMonthFolders } from "../../../../../data/population/populationStorage";
import { formatMonthFolderShortLabel } from "../../../../../data/population/monthFolder";
import { loadSampleMaster } from "../../../../../data/sampling/sampleStorage";
import { loadTemplate } from "../../../../../data/templates/templateStorage";
import { loadInspectionTemplateSelection } from "../../../../../data/templates/templateSelectionStorage";
import { getFieldsForPhase, getTemplatePhases } from "../../../../../data/templates/templateRuntime";
import type { TemplateField, TemplateSchema } from "../../../../../data/templates/templateTypes";
import type { DirectoryHandleLike } from "../../../../../data/storage/fileSystemAccess";
import { useLabels, type Labels } from "../../../../../data/labels/useLabels";
import { formatStageLabel } from "../../Population/components/helpers";

const RESULTS_COL_KEY = "xray_inspection_results_cols_v1";
const REFERRALS_PRESET_KEY = "xray-referrals";

const SAMPLE_DEFAULT_VISIBLE = [
  "xrayImageId", "movementStatus", "stage", "assignedTo", "movementFrom", "movementTo", "portName",
  "xrayEntryDate", "lastEventAt", "plateOrContainerNumber", "answerStatus", "submittedAt",
];

function buildSampleColumns(L: Labels): DataTableCol<DistributionEntry>[] {
  return [
    { id: "xrayImageId",            label: L.col_xray_image_id,             widthFr: 20, alwaysVisible: true, filterKind: "text", accessor: (e) => e.xrayImageId },
    { id: "movementStatus",         label: "حركة العينة",                   widthFr: 10, filterKind: "multiselect", accessor: () => null },
    { id: "stage",                  label: L.col_stage,                     widthFr: 8,  accessor: (e) => e.row.stage },
    { id: "assignedTo",             label: L.col_xray_quality_expert,       widthFr: 9,  accessor: (e) => e.assignedTo },
    { id: "movementFrom",           label: "من",                            widthFr: 9,  accessor: () => null },
    { id: "movementTo",             label: "إلى",                           widthFr: 9,  accessor: () => null },
    { id: "portName",               label: L.col_port_name,                 widthFr: 13, accessor: (e) => e.row.portName },
    { id: "xrayEntryDate",          label: L.col_xray_entry_date,           widthFr: 11, isDate: true, accessor: (e) => e.row.xrayEntryDate },
    { id: "lastEventAt",            label: L.col_distribution_date,         widthFr: 11, isDate: true, accessor: (e) => e.lastEventAt ?? null },
    { id: "plateOrContainerNumber", label: L.col_plate_or_container_number, widthFr: 11, accessor: (e) => e.row.plateOrContainerNumber },
    { id: "answerStatus",           label: L.col_answer_status,             widthFr: 9,  filterKind: "status", accessor: () => null },
    { id: "xrayLevelOneResult",     label: L.col_xray_l1_result,            widthFr: 8,  accessor: (e) => e.row.xrayLevelOneResult },
    { id: "xrayLevelTwoResult",     label: L.col_xray_l2_result,            widthFr: 8,  accessor: (e) => e.row.xrayLevelTwoResult },
    { id: "certScanStatus",         label: L.col_certscan_status,           widthFr: 9,  accessor: (e) => e.row.certScanStatus },
    { id: "declarationNumber",      label: L.col_declaration_number,        widthFr: 11, accessor: (e) => e.row.declarationNumber },
    { id: "declarationDate",        label: L.col_declaration_date,          widthFr: 11, isDate: true, accessor: (e) => e.row.declarationDate },
    { id: "chassisNumber",          label: L.col_chassis_number,            widthFr: 11, accessor: (e) => e.row.chassisNumber },
    { id: "movementType",           label: L.col_movement_type,             widthFr: 9,  accessor: (e) => e.row.movementType },
    { id: "portCode",               label: L.col_port_code,                 widthFr: 8,  accessor: (e) => e.row.portCode },
    { id: "portType",               label: L.col_port_type,                 widthFr: 8,  accessor: (e) => e.row.portType },
    { id: "targetedByRiskEngine",   label: L.col_targeted_by_risk,          widthFr: 10, accessor: (e) => e.row.targetedByRiskEngine },
    { id: "riskMessage",            label: L.col_risk_message,              widthFr: 15, accessor: (e) => e.row.riskMessage },
    { id: "biEnrichmentStatus",     label: L.col_bi_enrichment_status,      widthFr: 10, accessor: (e) => e.row.biEnrichmentStatus },
    { id: "reportNumber",           label: L.col_report_number,             widthFr: 10, accessor: (e) => e.row.reportNumber },
    { id: "submittedAt",            label: L.col_expert_observation_date,    widthFr: 14, isDate: true, accessor: () => null },
  ];
}

type LoadState = "idle" | "loading" | "ready" | "error";

type ResultRow = {
  entry: DistributionEntry;
  answer: ItemAnswer | null;
  movement: MovementInfo;
};

type MovementInfo = {
  status: "normal" | "replaced" | "reassigned";
  from: string | null;
  to: string | null;
  at: string | null;
  by: string | null;
};

type ResultsViewMode = "active" | "replaced" | "reassigned";

type AuditRow = {
  id: string;
  kind: "replacement" | "referral";
  status: "pending" | "approved" | "denied" | "executed";
  xrayImageId: string;
  originalXrayImageId: string | null;
  replacementXrayImageId: string | null;
  fromEmployee: string | null;
  toEmployee: string | null;
  requestedBy: string | null;
  requestedAt: string | null;
  reason: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  eventBy: string | null;
  eventAt: string | null;
};

type MonthOption = {
  month: number;
  year: number;
  folderName: string;
};

type Props = {
  directoryHandle: DirectoryHandleLike;
};

export default function XrayInspectionResults({ directoryHandle }: Props) {
  const L = useLabels();
  const sampleColumns = useMemo(() => buildSampleColumns(L), [L]);
  const session = readSession();
  const username = session?.username ?? "";
  const role = session?.role ?? "employee";
  // Re-render on permission-matrix changes so canSeeAll doesn't stay stale while mounted.
  const [, forcePermissionRefresh] = useState(0);
  useEffect(() => subscribeToUserManagementChanges(() => forcePermissionRefresh((n) => n + 1)), []);
  const userManagementState = readUserManagementState();
  const canSeeAll = hasFeature(
    userManagementState.featurePermissions,
    role,
    "view-all-entries"
  );

  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [months, setMonths] = useState<MonthOption[]>([]);
  const [selectedMonth, setSelectedMonth] = useState("");
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [auditRows, setAuditRows] = useState<AuditRow[]>([]);
  const [viewMode, setViewMode] = useState<ResultsViewMode>("active");
  const [template, setTemplate] = useState<TemplateSchema | null>(null);
  const [referralColConfig, setReferralColConfig] = useState<ColConfig | null>(null);

  useEffect(() => {
    void listMonthFolders(directoryHandle).then((monthFolders) => {
      setMonths(monthFolders);
      if (monthFolders.length > 0) {
        setSelectedMonth(monthFolders[monthFolders.length - 1]!.folderName);
      } else {
        setRows([]);
        setTemplate(null);
        setLoadState("ready");
      }
    });

    void Promise.all([
      loadAdminBrowsePreset(directoryHandle),
      loadUserBrowsePreset(directoryHandle, username),
    ]).then(([adminFile, userFile]) => {
      const preset = adminFile.browseData[REFERRALS_PRESET_KEY] ?? userFile.browseData[REFERRALS_PRESET_KEY];
      if (preset) {
        setReferralColConfig({
          order: preset.columnOrder,
          // Only hide columns the preset actually knew about. Columns added in a newer
          // version (e.g. "تاريخ رصد الخبير") aren't in the old columnOrder and must
          // default to visible rather than being auto-hidden.
          hidden: sampleColumns
            .map((column) => column.id)
            .filter((id) => !preset.visibleColumns.includes(id) && preset.columnOrder.includes(id)),
          widths: preset.widths ?? {},
          dateFmt: (preset.dateFmt ?? {}) as Record<string, DateFormatMode>,
        });
        return;
      }
      setReferralColConfig(loadLocalReferralColConfig() ?? buildDefaultReferralColConfig(sampleColumns));
    });
  }, [directoryHandle, sampleColumns, username]);

  const loadData = useCallback(async () => {
    if (!selectedMonth) return;
    setLoadState("loading");
    try {
      const [sampleMaster, selection, referralLog, replacementLog] = await Promise.all([
        loadSampleMaster(directoryHandle, selectedMonth),
        loadInspectionTemplateSelection(directoryHandle),
        loadReferralLog(directoryHandle, selectedMonth),
        loadReplacementLog(directoryHandle, selectedMonth),
      ]);

      const distribution = await loadOrDeriveDistributionCurrent(
        directoryHandle,
        selectedMonth,
        sampleMaster?.rows ?? []
      );
      const log = await loadDistributionLog(directoryHandle, selectedMonth);

      const activeTemplate = selection?.templateId
        ? await loadTemplate(directoryHandle, selection.templateId)
        : null;

      const movementById = buildMovementMap(log.events);
      const entries = (distribution?.entries ?? [])
        .map((entry) => ({
          entry,
          movement: buildMovementInfo(entry, movementById.get(entry.xrayImageId)),
        }))
        .filter(({ entry, movement }) => {
          if (!canSeeAll && !isVisibleToUser(entry, movement, username)) return false;
          return entry.status !== "replaced";
        });
      const audit = buildAuditRows({
        events: log.events,
        referralRequests: referralLog.requests,
        replacementRequests: replacementLog.requests,
        canSeeAll,
        username,
        mode: viewMode,
      });

      const answerFiles = canSeeAll
        ? await loadAllEmployeeFiles(directoryHandle, selectedMonth)
        : [await loadEmployeeAnswers(directoryHandle, selectedMonth, username)];

      const answerByKey = new Map<string, ItemAnswer>();
      for (const file of answerFiles) {
        for (const item of file.items) {
          answerByKey.set(`${item.xrayImageId}::${item.answeredBy}`, item);
        }
      }

      setTemplate(activeTemplate);
      setRows(entries.map(({ entry, movement }) => ({
        entry,
        movement,
        answer: answerByKey.get(`${entry.xrayImageId}::${entry.assignedTo}`) ?? null,
      })));
      setAuditRows(audit);
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }, [canSeeAll, directoryHandle, selectedMonth, username, viewMode]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadData();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadData]);

  const answerFields = useMemo(
    () =>
      template
        ? getTemplatePhases(template).flatMap((phase) =>
            getFieldsForPhase(template, phase.phaseId).filter((field) => field.type !== "empty")
          )
        : [],
    [template]
  );

  const columns = useMemo<DataTableCol<ResultRow>[]>(() => {
    const visibleSampleColumns = getVisibleSampleColumns(sampleColumns, referralColConfig).map<DataTableCol<ResultRow>>((column) => ({
      ...column,
      accessor: (row) => getSampleColumnValue(row, column, L),
    }));

    const answerColumns = answerFields.map<DataTableCol<ResultRow>>((field) => ({
      id: `answer:${field.fieldId}`,
      label: field.label,
      widthFr: Math.max(10, Math.min(18, Math.ceil(field.label.length / 2))),
      filterKind: field.type === "date" ? "date" : "multiselect",
      isDate: field.type === "date",
      accessor: (row) => formatAnswerValue(field, getAnswerValue(row.answer, field.fieldId)),
    }));

    return [...visibleSampleColumns, ...answerColumns];
  }, [L, answerFields, referralColConfig, sampleColumns]);

  const auditColumns = useMemo<DataTableCol<AuditRow>[]>(() => buildAuditColumns(), []);

  function renderCell(column: DataTableCol<ResultRow>, row: ResultRow, meta: CellMeta) {
    const value = column.accessor(row);
    if (!value) return <span className="dt-muted">{L.value_empty}</span>;
    // The expert observation timestamp is shown with date AND time by default.
    if (column.id === "submittedAt") {
      return <span className="dt-cell">{formatDate(value, meta.dateFmt === "date" ? "datetime" : meta.dateFmt)}</span>;
    }
    if (meta.isDate || looksLikeDate(value)) {
      return <span className="dt-cell">{formatDate(value, meta.dateFmt)}</span>;
    }
    if (column.id === "xrayImageId") return <span className="dt-mono">{value}</span>;
    return <span className="dt-cell">{value}</span>;
  }

  return (
    <section className="ew-page" dir="rtl">
      <PageHeader
        eyebrow={L.page_xray_results_eyebrow}
        title={L.page_xray_results_title}
        subtitle={L.page_xray_results_subtitle}
      />

      {loadState === "loading" && <LoadingState label={L.xray_results_loading} />}
      {loadState === "error" && <ErrorState description={L.xray_results_error} />}
      {loadState === "ready" && months.length === 0 && (
        <EmptyState
          icon={<CalendarOff />}
          title={L.xray_results_no_months}
          description="ابدأ بمعالجة شهر وسحب عينته من تبويب معالجة المجتمع."
        />
      )}
      {loadState === "ready" && months.length > 0 && viewMode === "active" && rows.length === 0 && (
        <EmptyState title={L.xray_results_no_rows} />
      )}
      {loadState === "ready" && months.length > 0 && viewMode !== "active" && auditRows.length === 0 && (
        <EmptyState title="لا توجد سجلات تاريخية لهذا النوع في الشهر المحدد" />
      )}

      {loadState === "ready" && months.length > 0 && viewMode === "active" && (
        <DataTable<ResultRow>
          columns={columns}
          rows={rows}
          getRowKey={(row) => `${row.entry.xrayImageId}::${row.entry.assignedTo}`}
          renderCell={renderCell}
          storageKey={RESULTS_COL_KEY}
          defaultVisible={columns.map((column) => column.id)}
          isAdmin={canSeeAll}
          canConfigureColumns={false}
          exportFileName={`نتائج فحص الأشعة - ${selectedMonth || "كل الأشهر"}.xlsx`}
          toolbarEndExtra={renderViewSwitcher(viewMode, setViewMode)}
          toolbarStart={
            <label className="ew-label" htmlFor="xray-results-month">
              {L.label_month}
              <select
                id="xray-results-month"
                className="ew-select"
                value={selectedMonth}
                onChange={(event) => setSelectedMonth(event.target.value)}
              >
                {months.map((month) => (
                  <option key={month.folderName} value={month.folderName}>{formatMonthFolderShortLabel(month.folderName)}</option>
                ))}
              </select>
            </label>
          }
        />
      )}
      {loadState === "ready" && months.length > 0 && viewMode !== "active" && (
        <DataTable<AuditRow>
          columns={auditColumns}
          rows={auditRows}
          getRowKey={(row) => row.id}
          renderCell={renderAuditCell}
          storageKey={`${RESULTS_COL_KEY}_audit_${viewMode}`}
          defaultVisible={auditColumns.map((column) => column.id)}
          isAdmin={canSeeAll}
          canConfigureColumns={false}
          exportFileName={`${viewMode === "replaced" ? "سجل المستبدلة" : "سجل المحالة والمنقولة"} - ${selectedMonth || "كل الأشهر"}.xlsx`}
          toolbarEndExtra={renderViewSwitcher(viewMode, setViewMode)}
          toolbarStart={
            <label className="ew-label" htmlFor="xray-results-month-audit">
              {L.label_month}
              <select
                id="xray-results-month-audit"
                className="ew-select"
                value={selectedMonth}
                onChange={(event) => setSelectedMonth(event.target.value)}
              >
                {months.map((month) => (
                  <option key={month.folderName} value={month.folderName}>{formatMonthFolderShortLabel(month.folderName)}</option>
                ))}
              </select>
            </label>
          }
        />
      )}
    </section>
  );
}

function renderViewSwitcher(
  viewMode: ResultsViewMode,
  setViewMode: (mode: ResultsViewMode) => void
) {
  return (
    <div className="ew-view-switcher" role="group" aria-label="نطاق النتائج">
      <button
        type="button"
        className={`ew-view-seg${viewMode === "active" ? " active" : ""}`}
        onClick={() => setViewMode("active")}
      >
        النتائج
      </button>
      <button
        type="button"
        className={`ew-view-seg${viewMode === "replaced" ? " active" : ""}`}
        onClick={() => setViewMode("replaced")}
      >
        المستبدلة
      </button>
      <button
        type="button"
        className={`ew-view-seg${viewMode === "reassigned" ? " active" : ""}`}
        onClick={() => setViewMode("reassigned")}
      >
        المحالة/المنقولة
      </button>
    </div>
  );
}

function buildAuditColumns(): DataTableCol<AuditRow>[] {
  return [
    { id: "kind", label: "النوع", widthFr: 9, accessor: (row) => row.kind === "replacement" ? "استبدال" : "إحالة/نقل" },
    { id: "status", label: "الحالة", widthFr: 8, accessor: (row) => getAuditStatusLabel(row.status) },
    { id: "xrayImageId", label: "معرف الأشعة", widthFr: 17, alwaysVisible: true, filterKind: "text", accessor: (row) => row.xrayImageId },
    { id: "originalXrayImageId", label: "العينة الأصلية", widthFr: 17, filterKind: "text", accessor: (row) => row.originalXrayImageId },
    { id: "replacementXrayImageId", label: "العينة البديلة", widthFr: 17, filterKind: "text", accessor: (row) => row.replacementXrayImageId },
    { id: "fromEmployee", label: "من", widthFr: 10, accessor: (row) => row.fromEmployee },
    { id: "toEmployee", label: "إلى", widthFr: 10, accessor: (row) => row.toEmployee },
    { id: "reason", label: "السبب", widthFr: 22, filterKind: "text", accessor: (row) => row.reason },
    { id: "requestedBy", label: "طلب بواسطة", widthFr: 10, accessor: (row) => row.requestedBy },
    { id: "requestedAt", label: "تاريخ الطلب", widthFr: 13, isDate: true, accessor: (row) => row.requestedAt },
    { id: "reviewedBy", label: "اعتمد بواسطة", widthFr: 10, accessor: (row) => row.reviewedBy },
    { id: "reviewedAt", label: "تاريخ الاعتماد", widthFr: 13, isDate: true, accessor: (row) => row.reviewedAt },
    { id: "reviewNotes", label: "ملاحظة الاعتماد", widthFr: 18, filterKind: "text", accessor: (row) => row.reviewNotes },
    { id: "eventBy", label: "نفذ بواسطة", widthFr: 10, accessor: (row) => row.eventBy },
    { id: "eventAt", label: "تاريخ التنفيذ", widthFr: 13, isDate: true, accessor: (row) => row.eventAt },
  ];
}

function renderAuditCell(column: DataTableCol<AuditRow>, row: AuditRow, meta: CellMeta) {
  const value = column.accessor(row);
  if (!value) return <span className="dt-muted">—</span>;
  if (column.id === "xrayImageId" || column.id === "originalXrayImageId" || column.id === "replacementXrayImageId") {
    return <span className="dt-mono">{value}</span>;
  }
  if (meta.isDate || looksLikeDate(value)) {
    return <span className="dt-cell">{formatDate(value, meta.dateFmt === "date" ? "datetime" : meta.dateFmt)}</span>;
  }
  return <span className="dt-cell">{value}</span>;
}

function buildAuditRows(params: {
  events: DistributionEvent[];
  referralRequests: ReferralRequest[];
  replacementRequests: ReplacementRequest[];
  canSeeAll: boolean;
  username: string;
  mode: ResultsViewMode;
}): AuditRow[] {
  const { events, referralRequests, replacementRequests, canSeeAll, username, mode } = params;
  if (mode === "active") return [];

  if (mode === "reassigned") {
    return referralRequests
      .flatMap((request) =>
        request.xrayImageIds.map<AuditRow>((xrayImageId) => ({
          id: `${request.requestId}:${xrayImageId}`,
          kind: "referral",
          status: request.status,
          xrayImageId,
          originalXrayImageId: null,
          replacementXrayImageId: null,
          fromEmployee: request.fromEmployee,
          toEmployee: request.toEmployee,
          requestedBy: request.requestedBy,
          requestedAt: request.requestedAt,
          reason: request.reason,
          reviewedBy: request.reviewedBy ?? null,
          reviewedAt: request.reviewedAt ?? null,
          reviewNotes: request.reviewNotes ?? null,
          eventBy: request.status === "approved" ? request.reviewedBy ?? null : null,
          eventAt: request.status === "approved" ? request.reviewedAt ?? null : null,
        }))
      )
      .filter((row) => canSeeAll || row.fromEmployee === username || row.toEmployee === username || row.requestedBy === username)
      .sort(sortAuditRows);
  }

  const requestOriginalIds = new Set(replacementRequests.map((request) => request.originalXrayImageId));
  const requestRows = replacementRequests.map<AuditRow>((request) => ({
    id: request.requestId,
    kind: "replacement",
    status: request.status,
    xrayImageId: request.originalXrayImageId,
    originalXrayImageId: request.originalXrayImageId,
    replacementXrayImageId: request.replacementXrayImageId,
    fromEmployee: request.employeeUsername,
    toEmployee: request.employeeUsername,
    requestedBy: request.requestedBy,
    requestedAt: request.requestedAt,
    reason: request.reason,
    reviewedBy: request.reviewedBy ?? null,
    reviewedAt: request.reviewedAt ?? null,
    reviewNotes: request.reviewNotes ?? null,
    eventBy: request.status === "approved" ? request.reviewedBy ?? null : null,
    eventAt: request.status === "approved" ? request.reviewedAt ?? null : null,
  }));

  const directEventRows = events
    .filter((event) => event.eventType === "replaced" && !requestOriginalIds.has(event.xrayImageId))
    .map<AuditRow>((event) => ({
      id: event.eventId,
      kind: "replacement",
      status: "executed",
      xrayImageId: event.xrayImageId,
      originalXrayImageId: event.xrayImageId,
      replacementXrayImageId: event.replacedById ?? null,
      fromEmployee: event.assignedTo,
      toEmployee: event.assignedTo,
      requestedBy: event.eventBy,
      requestedAt: event.eventAt,
      reason: event.notes ?? null,
      reviewedBy: null,
      reviewedAt: null,
      reviewNotes: null,
      eventBy: event.eventBy,
      eventAt: event.eventAt,
    }));

  return [...requestRows, ...directEventRows]
    .filter((row) => canSeeAll || row.fromEmployee === username || row.toEmployee === username || row.requestedBy === username)
    .sort(sortAuditRows);
}

function sortAuditRows(a: AuditRow, b: AuditRow): number {
  const aTime = a.eventAt ?? a.reviewedAt ?? a.requestedAt ?? "";
  const bTime = b.eventAt ?? b.reviewedAt ?? b.requestedAt ?? "";
  return bTime.localeCompare(aTime);
}

function getAuditStatusLabel(status: AuditRow["status"]): string {
  if (status === "pending") return "معلق";
  if (status === "approved") return "مقبول";
  if (status === "denied") return "مرفوض";
  return "منفذ مباشرة";
}

function buildDefaultReferralColConfig(sampleColumns: DataTableCol<DistributionEntry>[]): ColConfig {
  const visible = new Set(SAMPLE_DEFAULT_VISIBLE);
  return {
    order: sampleColumns.map((column) => column.id),
    hidden: sampleColumns.filter((column) => !visible.has(column.id)).map((column) => column.id),
    dateFmt: {},
    widths: {},
  };
}

function loadLocalReferralColConfig(): ColConfig | null {
  return null;
}

function getVisibleSampleColumns(
  sampleColumns: DataTableCol<DistributionEntry>[],
  config: ColConfig | null
): DataTableCol<DistributionEntry>[] {
  const cfg = config ?? buildDefaultReferralColConfig(sampleColumns);
  // Reconcile the saved order with the current columns so a newly added sample column
  // (e.g. submittedAt) is appended instead of dropped.
  const known = new Set(sampleColumns.map((c) => c.id));
  const kept = cfg.order.filter((id) => known.has(id));
  const keptSet = new Set(kept);
  const appended = sampleColumns.filter((c) => !keptSet.has(c.id)).map((c) => c.id);
  return [...kept, ...appended]
    .map((id) => sampleColumns.find((column) => column.id === id))
    .filter((column): column is DataTableCol<DistributionEntry> => Boolean(column))
    .filter((column) => !cfg.hidden.includes(column.id));
}

function getSampleColumnValue(row: ResultRow, column: DataTableCol<DistributionEntry>, labels: Labels): string | null {
  if (column.id === "stage") return formatStageLabel(row.entry.row.stage);
  if (column.id === "movementStatus") return getMovementStatusLabel(row.movement.status);
  if (column.id === "movementFrom") return row.movement.from;
  if (column.id === "movementTo") return row.movement.to;
  if (column.id === "answerStatus") return getAnswerStatusLabel(row.answer, row.entry.status, labels);
  if (column.id === "submittedAt") return row.answer?.submittedAt ?? null;
  return column.accessor(row.entry);
}

function getAnswerStatusLabel(answer: ItemAnswer | null, entryStatus: string, labels: Labels): string {
  if (entryStatus === "completed") return labels.status_completed;
  if (entryStatus === "replaced") return labels.status_replaced;
  if (answer?.status === "submitted") return labels.status_completed;
  return labels.status_pending;
}

function getAnswerValue(answer: ItemAnswer | null, fieldId: string): string | number | boolean | null {
  return answer?.answers.find((item) => item.fieldId === fieldId)?.value ?? null;
}

function formatAnswerValue(field: TemplateField, value: string | number | boolean | null): string | null {
  if (value === null || value === "") return null;
  if (typeof value === "boolean") return value ? "نعم" : "لا";
  if (field.type === "date") return String(value);
  return String(value);
}

function buildMovementMap(events: DistributionEvent[]): Map<string, DistributionEvent> {
  const movementById = new Map<string, DistributionEvent>();
  for (const event of events) {
    if (event.eventType !== "reassigned") continue;
    movementById.set(event.xrayImageId, event);
  }
  return movementById;
}

function buildMovementInfo(
  entry: DistributionEntry,
  reassignedEvent: DistributionEvent | undefined
): MovementInfo {
  if (entry.status === "replaced") {
    return {
      status: "replaced",
      from: entry.assignedTo,
      to: entry.replacedById,
      at: entry.lastEventAt,
      by: null,
    };
  }
  if (reassignedEvent) {
    return {
      status: "reassigned",
      from: reassignedEvent.assignedTo,
      to: reassignedEvent.reassignedTo ?? entry.assignedTo,
      at: reassignedEvent.eventAt,
      by: reassignedEvent.eventBy,
    };
  }
  return {
    status: "normal",
    from: null,
    to: null,
    at: null,
    by: null,
  };
}

function isVisibleToUser(
  entry: DistributionEntry,
  movement: MovementInfo,
  username: string
): boolean {
  return (
    entry.assignedTo === username ||
    movement.from === username ||
    movement.to === username
  );
}

function getMovementStatusLabel(status: MovementInfo["status"]): string {
  if (status === "replaced") return "مستبدلة";
  if (status === "reassigned") return "محالة/منقولة";
  return "عادية";
}
