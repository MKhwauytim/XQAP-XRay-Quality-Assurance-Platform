import { useCallback, useEffect, useMemo, useState } from "react";
import { readSession } from "../../../../../auth/authSession";
import { PageHeader } from "../../../../../components/PageHeader/PageHeader";
import DataTable, {
  formatDate,
  looksLikeDate,
  type CellMeta,
  type ColConfig,
  type DataTableCol,
  type DateFormatMode,
} from "../../../../../components/DataTable";
import { loadAllEmployeeFiles, loadEmployeeAnswers } from "../../../../../data/answers/answerStorage";
import type { ItemAnswer } from "../../../../../data/answers/answerTypes";
import { loadOrDeriveDistributionCurrent } from "../../../../../data/distribution/distributionStorage";
import type { DistributionEntry } from "../../../../../data/distribution/distributionTypes";
import { loadUserBrowsePreset } from "../../../../../data/preferences/browsePresetStorage";
import { listMonthFolders } from "../../../../../data/population/populationStorage";
import { loadSampleMaster } from "../../../../../data/sampling/sampleStorage";
import { loadTemplate } from "../../../../../data/templates/templateStorage";
import { loadInspectionTemplateSelection } from "../../../../../data/templates/templateSelectionStorage";
import { getFieldsForPhase, getTemplatePhases } from "../../../../../data/templates/templateRuntime";
import type { TemplateField, TemplateSchema } from "../../../../../data/templates/templateTypes";
import type { DirectoryHandleLike } from "../../../../../data/storage/fileSystemAccess";
import { useLabels, type Labels } from "../../../../../data/labels/useLabels";
import { formatStageLabel } from "../../Population/components/helpers";

const REFERRALS_COL_KEY = "xray_ref_cols_v4";
const RESULTS_COL_KEY = "xray_inspection_results_cols_v1";
const REFERRALS_PRESET_KEY = "xray-referrals";

const SAMPLE_DEFAULT_VISIBLE = [
  "xrayImageId", "stage", "assignedTo", "portName",
  "xrayEntryDate", "lastEventAt", "plateOrContainerNumber", "answerStatus", "submittedAt",
];

function buildSampleColumns(L: Labels): DataTableCol<DistributionEntry>[] {
  return [
    { id: "xrayImageId",            label: L.col_xray_image_id,             widthFr: 20, alwaysVisible: true, filterKind: "text", accessor: (e) => e.xrayImageId },
    { id: "stage",                  label: L.col_stage,                     widthFr: 8,  accessor: (e) => e.row.stage },
    { id: "assignedTo",             label: L.col_xray_quality_expert,       widthFr: 9,  accessor: (e) => e.assignedTo },
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
    { id: "submittedAt",            label: "تاريخ رصد خبير الجودة",          widthFr: 14, isDate: true, accessor: () => null },
  ];
}

type LoadState = "idle" | "loading" | "ready" | "error";

type ResultRow = {
  entry: DistributionEntry;
  answer: ItemAnswer | null;
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
  const canSeeAll = role === "admin" || role === "supervisor";

  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [months, setMonths] = useState<MonthOption[]>([]);
  const [selectedMonth, setSelectedMonth] = useState("");
  const [rows, setRows] = useState<ResultRow[]>([]);
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

    void loadUserBrowsePreset(directoryHandle, username).then((file) => {
      const preset = file.browseData[REFERRALS_PRESET_KEY];
      if (preset) {
        setReferralColConfig({
          order: preset.columnOrder,
          hidden: sampleColumns.map((column) => column.id).filter((id) => !preset.visibleColumns.includes(id)),
          widths: preset.widths ?? {},
          dateFmt: (preset.dateFmt ?? {}) as Record<string, DateFormatMode>,
        });
        return;
      }
      setReferralColConfig(loadLocalReferralColConfig(sampleColumns) ?? buildDefaultReferralColConfig(sampleColumns));
    });
  }, [directoryHandle, sampleColumns, username]);

  const loadData = useCallback(async () => {
    if (!selectedMonth) return;
    setLoadState("loading");
    try {
      const [sampleMaster, selection] = await Promise.all([
        loadSampleMaster(directoryHandle, selectedMonth),
        loadInspectionTemplateSelection(directoryHandle),
      ]);

      const distribution = await loadOrDeriveDistributionCurrent(
        directoryHandle,
        selectedMonth,
        sampleMaster?.rows ?? []
      );

      const activeTemplate = selection?.templateId
        ? await loadTemplate(directoryHandle, selection.templateId)
        : null;

      const entries = (distribution?.entries ?? []).filter((entry) =>
        canSeeAll ? entry.status !== "replaced" : entry.assignedTo === username && entry.status !== "replaced"
      );

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
      setRows(entries.map((entry) => ({
        entry,
        answer: answerByKey.get(`${entry.xrayImageId}::${entry.assignedTo}`) ?? null,
      })));
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }, [canSeeAll, directoryHandle, selectedMonth, username]);

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

  function renderCell(column: DataTableCol<ResultRow>, row: ResultRow, meta: CellMeta) {
    const value = column.accessor(row);
    if (!value) return <span className="dt-muted">{L.value_empty}</span>;
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

      {loadState === "loading" && <p className="ew-empty">{L.xray_results_loading}</p>}
      {loadState === "error" && <p className="ew-empty">{L.xray_results_error}</p>}
      {loadState === "ready" && months.length === 0 && (
        <p className="ew-empty">{L.xray_results_no_months}</p>
      )}
      {loadState === "ready" && months.length > 0 && rows.length === 0 && (
        <p className="ew-empty">{L.xray_results_no_rows}</p>
      )}

      {loadState === "ready" && months.length > 0 && rows.length > 0 && (
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
                  <option key={month.folderName} value={month.folderName}>{month.folderName}</option>
                ))}
              </select>
            </label>
          }
        />
      )}
    </section>
  );
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

function loadLocalReferralColConfig(sampleColumns: DataTableCol<DistributionEntry>[]): ColConfig | null {
  try {
    const raw = localStorage.getItem(REFERRALS_COL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ColConfig>;
    return {
      order: parsed.order ?? sampleColumns.map((column) => column.id),
      hidden: parsed.hidden ?? [],
      dateFmt: parsed.dateFmt ?? {},
      widths: parsed.widths ?? {},
    };
  } catch {
    return null;
  }
}

function getVisibleSampleColumns(
  sampleColumns: DataTableCol<DistributionEntry>[],
  config: ColConfig | null
): DataTableCol<DistributionEntry>[] {
  const cfg = config ?? buildDefaultReferralColConfig(sampleColumns);
  return cfg.order
    .map((id) => sampleColumns.find((column) => column.id === id))
    .filter((column): column is DataTableCol<DistributionEntry> => Boolean(column))
    .filter((column) => !cfg.hidden.includes(column.id));
}

function getSampleColumnValue(row: ResultRow, column: DataTableCol<DistributionEntry>, labels: Labels): string | null {
  if (column.id === "stage") return formatStageLabel(row.entry.row.stage);
  if (column.id === "answerStatus") return getAnswerStatusLabel(row.answer, row.entry.status, labels);
  if (column.id === "submittedAt") return row.answer?.submittedAt ?? null;
  return column.accessor(row.entry);
}

function getAnswerStatusLabel(answer: ItemAnswer | null, entryStatus: string, labels: Labels): string {
  if (entryStatus === "completed") return labels.status_completed;
  if (entryStatus === "replaced") return labels.status_replaced;
  if (answer?.status === "submitted") return labels.status_completed;
  if (answer?.status === "draft") return labels.status_draft;
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
