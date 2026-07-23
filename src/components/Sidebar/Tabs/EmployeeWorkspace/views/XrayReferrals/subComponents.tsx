/* eslint-disable react-refresh/only-export-components -- mirrors the file-level disable already
   used by Tabs/EmployeeWorkspace/index.tsx etc.: this sibling file legitimately exports both
   sub-components and the pure helper functions/constants they (and the main XrayReferrals
   component) share. */
import { useMemo, useState } from "react";
import { X, AlertTriangle, RotateCw } from "lucide-react";
import { useFocusTrap } from "../../../../../../hooks/useFocusTrap";
import { readUserManagementState } from "../../../../../../auth/userManagement";
import type { FieldAnswer, ItemAnswer } from "../../../../../../data/answers/answerTypes";
import type { DistributionEntry } from "../../../../../../data/distribution/distributionTypes";
import { isAssignableSampleRole } from "../../../../../../data/distribution/bulkAssignment";
import type { StageAliasMappings } from "../../../../../../data/population/populationConfig";
import type { TemplateSchema } from "../../../../../../data/templates/templateTypes";
import type { ColConfig, DataTableCol } from "../../../../../../components/DataTable";
import {
  formatDate,
  looksLikeDate,
  type DateFormatMode,
} from "../../../../../../components/DataTable/utils";
import InspectionPanel from "../../../../../../components/InspectionPanel";
import Pagination from "../../../../../../components/Pagination/Pagination";
import { clampPage, pageSlice } from "../../../../../../components/Pagination/paginationUtils";
import { useLabels, type Labels } from "../../../../../../data/labels/useLabels";
import { formatStageLabel } from "../../../Population/components/helpers";
import type { PreparedPopulationRow } from "../../../Population/processing/populationProcessingTypes";
import type { PersonalStats, PersonalQuota, ReplacementDialogState } from "../XrayReferrals";

// ── Column definitions ────────────────────────────────────────────────────────

/** Sentinel column id for the row-selection checkbox. Not stored in presets. */
export const SELECT_COL_ID = "__select__";

export function buildXrayColumns(L: Labels): DataTableCol<DistributionEntry>[] {
  return [
  { id: "xrayImageId",            label: L.col_xray_image_id,             widthFr: 20, alwaysVisible: true, filterKind: "text", accessor: (e) => e.xrayImageId },
  { id: "stage",                  label: L.col_stage,                     widthFr: 8,  accessor: (e) => e.row.stage },
  { id: "assignedTo",             label: L.col_xray_quality_expert,       widthFr: 9,  adminOnly: true,     accessor: (e) => e.assignedTo },
  { id: "portName",               label: L.col_port_name,                 widthFr: 13, accessor: (e) => e.row.portName },
  { id: "xrayEntryDate",          label: L.col_xray_entry_date,           widthFr: 11, isDate: true,        accessor: (e) => e.row.xrayEntryDate },
  { id: "lastEventAt",            label: L.col_distribution_date,         widthFr: 11, isDate: true,        accessor: (e) => e.lastEventAt ?? null },
  { id: "plateOrContainerNumber", label: L.col_plate_or_container_number, widthFr: 11, accessor: (e) => e.row.plateOrContainerNumber },
  { id: "answerStatus",           label: L.col_answer_status,             widthFr: 9,  filterKind: "status",
    statusOptions: [
      { value: "all",       label: L.status_all },
      { value: "submitted", label: L.status_completed },
      { value: "pending",   label: L.status_pending },
      { value: "replaced",  label: L.status_replaced },
    ],
    accessor: () => null,
  },
  { id: "submittedAt",            label: L.col_expert_observation_date,   widthFr: 13, isDate: true, accessor: () => null },
  { id: "xrayLevelOneResult",     label: L.col_xray_l1_result,            widthFr: 8,  accessor: (e) => e.row.xrayLevelOneResult },
  { id: "xrayLevelTwoResult",     label: L.col_xray_l2_result,            widthFr: 8,  accessor: (e) => e.row.xrayLevelTwoResult },
  { id: "certScanStatus",         label: L.col_certscan_status,           widthFr: 9,  accessor: (e) => e.row.certScanStatus },
  { id: "declarationNumber",      label: L.col_declaration_number,        widthFr: 11, accessor: (e) => e.row.declarationNumber },
  { id: "declarationDate",        label: L.col_declaration_date,          widthFr: 11, isDate: true,        accessor: (e) => e.row.declarationDate },
  { id: "chassisNumber",          label: L.col_chassis_number,            widthFr: 11, accessor: (e) => e.row.chassisNumber },
  { id: "movementType",           label: L.col_movement_type,             widthFr: 9,  accessor: (e) => e.row.movementType },
  { id: "portCode",               label: L.col_port_code,                 widthFr: 8,  accessor: (e) => e.row.portCode },
  { id: "portType",               label: L.col_port_type,                 widthFr: 8,  accessor: (e) => e.row.portType },
  { id: "targetedByRiskEngine",   label: L.col_targeted_by_risk,          widthFr: 10, accessor: (e) => e.row.targetedByRiskEngine },
  { id: "riskMessage",            label: L.col_risk_message,              widthFr: 15, accessor: (e) => e.row.riskMessage },
  { id: "biEnrichmentStatus",     label: L.col_bi_enrichment_status,      widthFr: 10, accessor: (e) => e.row.biEnrichmentStatus },
  { id: "reportNumber",           label: L.col_report_number,             widthFr: 10, accessor: (e) => e.row.reportNumber },
  ];
}

export const DEFAULT_VISIBLE = [
  "xrayImageId", "stage", "portName", "xrayEntryDate",
  "plateOrContainerNumber", "xrayLevelOneResult", "xrayLevelTwoResult",
];

export function buildDefaultColConfig(columns: DataTableCol<DistributionEntry>[]): ColConfig {
  const visible = new Set(DEFAULT_VISIBLE);
  // Order follows DEFAULT_VISIBLE's intended arrangement first (so the sticky
  // answerStatus column lands right next to the sticky xrayImageId column
  // instead of wherever it happens to sit in buildXrayColumns's definition
  // order), then appends any remaining columns.
  const known = new Set(columns.map((column) => column.id));
  const orderedVisible = DEFAULT_VISIBLE.filter((id) => known.has(id));
  const orderedVisibleSet = new Set(orderedVisible);
  const rest = columns.map((column) => column.id).filter((id) => !orderedVisibleSet.has(id));
  return {
    order: [...orderedVisible, ...rest],
    hidden: columns.filter((column) => !visible.has(column.id)).map((column) => column.id),
    dateFmt: {},
    widths: {},
  };
}

export function loadLocalColConfig(): ColConfig | null {
  return null;
}

export function getVisibleReferralColumns(
  columns: DataTableCol<DistributionEntry>[],
  cfg: ColConfig,
  isAdmin: boolean
): DataTableCol<DistributionEntry>[] {
  // Reconcile the saved column order with the current column set (mirrors
  // DataTable/index.tsx's own normalizedOrder reconciliation):
  //  • keep known ids in their saved position,
  //  • prepend any missing alwaysVisible columns,
  //  • append any other column added to buildXrayColumns after this preset was
  //    saved — otherwise it would silently vanish from the referral-request
  //    preview forever for any user with a saved layout.
  const known = new Set(columns.map((column) => column.id));
  const kept = cfg.order.filter((id) => known.has(id));
  const keptSet = new Set(kept);
  const missingAlways = columns.filter((column) => column.alwaysVisible && !keptSet.has(column.id)).map((column) => column.id);
  const missingRest = columns.filter((column) => !column.alwaysVisible && !keptSet.has(column.id)).map((column) => column.id);
  const order = [...missingAlways, ...kept, ...missingRest];
  return order
    .map((id) => columns.find((column) => column.id === id))
    .filter((column): column is DataTableCol<DistributionEntry> => Boolean(column))
    .filter((column) =>
      column.id !== SELECT_COL_ID &&
      !cfg.hidden.includes(column.id) &&
      (!column.adminOnly || isAdmin)
    );
}

export function pct(n: number, d: number): number {
  return d === 0 ? 0 : Math.round((n / d) * 100);
}

// ── ReferralRequestModal ──────────────────────────────────────────────────────

export function QueueToolbar({
  labels,
  templates,
  selectedTemplateId,
  activeTemplate,
  canSetTemplate,
  onTemplateChange,
  onReloadTemplate,
}: {
  labels: Labels;
  templates: Array<{ templateId: string; templateName: string; version: number }>;
  selectedTemplateId: string;
  activeTemplate: TemplateSchema | null;
  canSetTemplate: boolean;
  onTemplateChange: (id: string) => void;
  onReloadTemplate: () => void;
}) {
  return (
    <div className="ew-ref-queue-toolbar">
      <label className="ew-label" htmlFor="ref-tpl">
        {labels.label_template}
        <div className="ew-ref-template-control">
          {canSetTemplate ? (
            <select
              id="ref-tpl"
              className="ew-select"
              value={selectedTemplateId}
              onChange={(e) => onTemplateChange(e.target.value)}
            >
              <option value="">اختر نموذجاً...</option>
              {templates.map((t) => (
                <option key={t.templateId} value={t.templateId}>
                  {t.templateName} (v{t.version})
                </option>
              ))}
            </select>
          ) : (
            <div className="ew-template-locked" id="ref-tpl">
              {activeTemplate ? `${activeTemplate.templateName} (v${activeTemplate.version})` : "لم يتم تعيين نموذج"}
            </div>
          )}
          {selectedTemplateId && (
            <button
              type="button"
              className="ew-btn-secondary ew-btn-sm"
              title="إعادة تحميل النموذج من القرص"
              aria-label="إعادة تحميل النموذج من القرص"
              onClick={onReloadTemplate}
              style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}
            ><RotateCw size={14} /></button>
          )}
        </div>
      </label>
    </div>
  );
}

export function SelectionActionBar({
  selectedCount,
  visibleCount,
  onReferSelected,
  onSelectVisible,
  onClear,
}: {
  selectedCount: number;
  visibleCount: number;
  onReferSelected: () => void;
  onSelectVisible: () => void;
  onClear: () => void;
}) {
  const selectedLabel = selectedCount.toLocaleString("ar-SA-u-nu-latn");
  const visibleLabel = visibleCount.toLocaleString("ar-SA-u-nu-latn");

  return (
    <div className="ew-selection-bar" role="region" aria-label="إجراءات العينات المحددة">
      <strong>{selectedLabel} عينة محددة</strong>
      <span>{visibleLabel} ظاهرة قابلة للتحديد</span>
      <div className="ew-selection-actions">
        <button
          type="button"
          className="ew-btn-referral"
          disabled={selectedCount === 0}
          onClick={onReferSelected}
        >
          إحالة المحدد
        </button>
        <button type="button" className="ew-btn-secondary ew-btn-sm" onClick={onSelectVisible}>
          تحديد الظاهر
        </button>
        <button type="button" className="ew-btn-secondary ew-btn-sm" onClick={onClear}>
          إلغاء التحديد
        </button>
      </div>
    </div>
  );
}

export function SampleDetailPanel({
  entry,
  template,
  savedAnswer,
  readonly,
  onClose,
  onSave,
  onReplace,
  onReassign,
  onReopen,
  onRequestReopen,
}: {
  entry: DistributionEntry;
  template: TemplateSchema | null;
  savedAnswer: ItemAnswer | null;
  readonly: boolean;
  onClose: () => void;
  onSave: (ans: FieldAnswer[]) => Promise<void>;
  onReplace?: (entry: DistributionEntry) => void;
  onReassign?: (entry: DistributionEntry) => void;
  onReopen?: (reason: string) => void;
  onRequestReopen?: (reason: string) => void;
}) {
  return (
    <InspectionPanel
      key={entry.xrayImageId}
      entry={entry}
      template={template}
      savedAnswer={savedAnswer}
      readonly={readonly}
      onClose={onClose}
      onSave={onSave}
      onReplace={onReplace}
      onReassign={onReassign}
      onReopen={onReopen}
      onRequestReopen={onRequestReopen}
    />
  );
}

export function ReferralRequestModal({
  xrayImageIds,
  entries,
  visibleColumns,
  dateFmt,
  answersMap,
  currentUser,
  onClose,
  onSubmit,
}: {
  xrayImageIds: string[];
  entries: DistributionEntry[];
  visibleColumns: DataTableCol<DistributionEntry>[];
  dateFmt: Record<string, DateFormatMode>;
  answersMap: Map<string, ItemAnswer>;
  currentUser: string;
  onClose: () => void;
  onSubmit: (toEmployee: string, reason: string) => void;
}) {
  const [toEmployee, setToEmployee] = useState("");
  const [reason, setReason]         = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const dialogRef = useFocusTrap<HTMLDivElement>({ onEscape: onClose });
  const entriesById = useMemo(
    () => new Map(entries.map((entry) => [entry.xrayImageId, entry])),
    [entries]
  );

  const employees = readUserManagementState()
    .users.filter((u) => u.isActive && u.username !== currentUser && isAssignableSampleRole(u))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "ar"));

  const canSubmit = toEmployee.trim() !== "" && reason.trim() !== "" && !submitting;

  function handleSubmit(): void {
    if (!canSubmit) return;
    setSubmitting(true);
    onSubmit(toEmployee, reason.trim());
  }

  return (
    <div ref={dialogRef} className="ew-modal-backdrop" role="dialog" aria-modal="true">
      <div className="ew-replace-modal">
        <div className="ew-replace-header">
          <div>
            <h3>إحالة العينات</h3>
            <p>{xrayImageIds.length} عينة محددة للإحالة</p>
          </div>
          <button type="button" className="ew-modal-close" onClick={onClose} aria-label="إغلاق"><X size={16} /></button>
        </div>

        <div className="ew-replace-reason">
          <label className="ew-field-label" htmlFor="ref-to-emp">
            الموظف المستلم <span className="ew-required">*</span>
          </label>
          <select
            id="ref-to-emp"
            className="ew-select"
            value={toEmployee}
            onChange={(e) => setToEmployee(e.target.value)}
          >
            <option value="">اختر موظفاً...</option>
            {employees.map((u) => (
              <option key={u.username} value={u.username}>
                {u.displayName} ({u.username})
              </option>
            ))}
          </select>

          <label className="ew-field-label" htmlFor="ref-reason" style={{ marginTop: 12 }}>
            سبب الإحالة <span className="ew-required">*</span>
          </label>
          <textarea
            id="ref-reason"
            className="ew-input ew-textarea"
            rows={3}
            placeholder="اذكر سبب إحالة هذه العينات..."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>

        <div className="ew-replace-reason" style={{ paddingTop: 8 }}>
          <details className="ew-referral-ids-summary">
            <summary>عرض معرفات العينات ({xrayImageIds.length})</summary>
            <div className="ew-referral-ids-list">
              {xrayImageIds.map((id) => {
                const entry = entriesById.get(id);
                const isExpanded = expandedId === id;
                return (
                  <div key={id} className="ew-referral-id-item">
                    <button
                      type="button"
                      className={`dt-mono ew-referral-id-chip${isExpanded ? " active" : ""}`}
                      onClick={() => setExpandedId((current) => (current === id ? null : id))}
                      aria-expanded={isExpanded}
                      title="عرض بيانات العينة"
                    >
                      {id}
                    </button>
                    {isExpanded && entry ? (
                      <ReferralSamplePreview
                        entry={entry}
                        visibleColumns={visibleColumns}
                        dateFmt={dateFmt}
                        answersMap={answersMap}
                      />
                    ) : null}
                  </div>
                );
              })}
            </div>
          </details>
        </div>

        <div className="ew-replace-reason" style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8, paddingBottom: 16 }}>
          <button type="button" className="ew-btn-secondary" onClick={onClose}>إلغاء</button>
          <button
            type="button"
            className="ew-btn-primary"
            disabled={!canSubmit}
            onClick={handleSubmit}
          >
            {submitting ? "جاري الإرسال..." : "إرسال طلب الإحالة"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ReferralSamplePreview({
  entry,
  visibleColumns,
  dateFmt,
  answersMap,
}: {
  entry: DistributionEntry;
  visibleColumns: DataTableCol<DistributionEntry>[];
  dateFmt: Record<string, DateFormatMode>;
  answersMap: Map<string, ItemAnswer>;
}) {
  const L = useLabels();
  return (
    <div className="ew-referral-sample-preview">
      {visibleColumns.map((column) => (
        <div key={column.id} className="ew-referral-sample-field">
          <span>{column.label}</span>
          <strong>{getReferralPreviewValue(entry, column, dateFmt, answersMap, L)}</strong>
        </div>
      ))}
    </div>
  );
}

export function getReferralPreviewValue(
  entry: DistributionEntry,
  column: DataTableCol<DistributionEntry>,
  dateFmt: Record<string, DateFormatMode>,
  answersMap: Map<string, ItemAnswer>,
  labels: Labels
): string {
  if (column.id === "answerStatus") {
    if (entry.status === "replaced") return labels.status_replaced;
    const answer = answersMap.get(`${entry.xrayImageId}::${entry.assignedTo}`);
    if (answer?.status === "submitted") return labels.status_completed;
    return labels.status_pending;
  }

  const raw = column.accessor(entry);
  if (!raw) return labels.value_empty;
  if (column.isDate || looksLikeDate(raw)) {
    return formatDate(raw, dateFmt[column.id] ?? "date");
  }
  return raw;
}

// ── StatusBadge ───────────────────────────────────────────────────────────────

export function StatusBadge({ answer, entryStatus, labels }: { answer?: ItemAnswer; entryStatus: string; labels: Labels }) {
  if (entryStatus === "replaced")
    return <span className="ew-status-badge" style={{ background: "#f1f5f9", color: "#64748b" }}>{labels.status_replaced}</span>;
  if (answer?.status === "submitted")
    return <span className="ew-status-badge ew-badge-done">{labels.status_completed}</span>;
  return <span className="ew-status-badge ew-badge-pending">{labels.status_pending}</span>;
}

export function ReferralStatsStrip({
  stats,
  quota,
  username,
}: {
  stats: PersonalStats;
  quota: PersonalQuota;
  username: string;
}) {
  const statsItems = [
    { label: "حصة اليوم", value: quota ? quota.dailyQuota.toLocaleString("ar-SA-u-nu-latn") : "—", tone: "quota" },
    { label: "الإجمالي", value: stats.assigned.toLocaleString("ar-SA-u-nu-latn"), tone: "total" },
    { label: "مكتملة", value: stats.submitted.toLocaleString("ar-SA-u-nu-latn"), tone: "done" },
    { label: "لم تبدأ", value: stats.notStarted.toLocaleString("ar-SA-u-nu-latn"), tone: "pending" },
    { label: "المستبدلة \\ المحالة", value: stats.replaced.toLocaleString("ar-SA-u-nu-latn"), tone: "replaced" },
    { label: "نسبة الإنجاز", value: `${stats.completionPct}%`, tone: "done" },
  ];
  const quotaTitle = quota
    ? `الحصة اليومية: ${quota.dailyQuota.toLocaleString("ar-SA-u-nu-latn")} صورة / يوم · الحصة: ${quota.sampleCount.toLocaleString("ar-SA-u-nu-latn")} · الأيام المتبقية: ${quota.daysRemaining.toLocaleString("ar-SA-u-nu-latn")}`
    : "لا توجد حصة محفوظة لهذا الشهر";

  return (
    <section className="ew-ref-stats" aria-label="إحصائياتي">
      <div className="ew-ref-stats-title" title={quotaTitle}>
        <strong>متابعة العمل</strong>
      </div>

      <div className="ew-ref-stats-inline">
        {statsItems.map((item) => (
          <span key={item.label} className={`ew-ref-stat-token ew-ref-stat-token--${item.tone}`}>
            <em>{item.label}</em>
            <strong>{item.value}</strong>
          </span>
        ))}
      </div>

      <div className="ew-ref-progress" title={`المستخدم: ${username}`}>
        <div className="ew-ref-progress-track" aria-hidden="true">
          <div
            className="ew-ref-progress-fill"
            style={{ width: `${stats.completionPct}%` }}
          />
        </div>
      </div>
    </section>
  );
}

export function isStudyCompleted(
  entry: DistributionEntry,
  answersMap: Map<string, ItemAnswer>
): boolean {
  if (entry.status === "completed") return true;
  return answersMap.get(`${entry.xrayImageId}::${entry.assignedTo}`)?.status === "submitted";
}


export function ReplacementDialog({
  state,
  stageMappings,
  error,
  busy,
  onClose,
  onSelect,
}: {
  state: Exclude<ReplacementDialogState, null>;
  stageMappings?: StageAliasMappings;
  error: string | null;
  busy: boolean;
  onClose: () => void;
  onSelect: (row: PreparedPopulationRow, reason: string, fromRecommended: boolean) => void;
}) {
  const [tab, setTab] = useState<"recommended" | "all">(
    state.recommended.length > 0 ? "recommended" : "all"
  );
  const [reason, setReason] = useState("");
  const [page, setPage] = useState(1);
  const dialogRef = useFocusTrap<HTMLDivElement>({ onEscape: onClose });
  const rows = tab === "recommended" ? state.recommended : state.all;
  const safePage = clampPage(page, rows.length);
  const pagedRows = pageSlice(rows, safePage);
  const stageLabel = formatStageLabel(state.entry.row.stage, stageMappings);
  const reasonTrimmed = reason.trim();
  const canSelect = reasonTrimmed.length > 0;
  const isRecommended = tab === "recommended";

  return (
    <div ref={dialogRef} className="ew-modal-backdrop" role="dialog" aria-modal="true">
      <div className="ew-replace-modal">
        <div className="ew-replace-header">
          <div>
            <h3>استبدال العينة</h3>
            <p>
              {state.entry.xrayImageId} · {stageLabel} · {state.entry.row.portName ?? "—"}
            </p>
          </div>
          <button type="button" className="ew-modal-close" onClick={onClose} aria-label="إغلاق">
            <X size={16} />
          </button>
        </div>

        <div className="ew-replace-reason">
          <label className="ew-field-label" htmlFor="replace-reason">
            سبب الاستبدال <span className="ew-required">*</span>
          </label>
          <textarea
            id="replace-reason"
            className="ew-input ew-textarea"
            rows={3}
            placeholder="اذكر سبب طلب الاستبدال..."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          {!canSelect && (
            <p className="ew-replace-reason-hint">يجب إدخال سبب الاستبدال قبل اختيار البديل.</p>
          )}
          {error ? (
            <p className="ew-replace-error" role="alert">{error}</p>
          ) : null}
        </div>

        <div className="ew-replace-tabs">
          <button
            type="button"
            className={tab === "recommended" ? "active" : ""}
            onClick={() => { setTab("recommended"); setPage(1); }}
          >
            الموصى بها ({state.recommended.length})
          </button>
          <button
            type="button"
            className={tab === "all" ? "active" : ""}
            onClick={() => { setTab("all"); setPage(1); }}
          >
            كل البدائل ({state.all.length})
          </button>
        </div>

        {!isRecommended && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 0 10px", padding: "8px 12px", background: "var(--c-warning-bg)", border: "1px solid var(--c-warning-border)", borderRadius: 8, fontSize: 12, color: "var(--c-warning)" }}>
            <AlertTriangle size={14} style={{ flexShrink: 0 }} /> الاستبدال من هذه القائمة يحتاج موافقة المشرف — سيُرسل كطلب معلق في اعتماد الطلبات.
          </div>
        )}

        {rows.length === 0 ? (
          <div className="ew-replace-empty">
            لا توجد بدائل غير معينة في {tab === "recommended" ? "نفس المنفذ والمستوى" : "نفس المستوى"}.
          </div>
        ) : (
          <div className="ew-replace-list">
            {pagedRows.map((row) => (
              <article key={row.xrayImageId} className="ew-replace-row">
                <div>
                  <strong>{row.xrayImageId}</strong>
                  <span>
                    {row.portName ?? "—"} · {formatStageLabel(row.stage, stageMappings)}
                  </span>
                  <span>
                    {row.xrayEntryDate ? formatDate(row.xrayEntryDate, "date") : "—"} ·{" "}
                    {row.plateOrContainerNumber ?? "—"}
                  </span>
                </div>
                <button
                  type="button"
                  className={isRecommended ? "ew-btn-primary" : "ew-btn-warning"}
                  disabled={!canSelect || busy}
                  title={canSelect ? undefined : "أدخل سبب الاستبدال أولاً"}
                  onClick={() => onSelect(row, reasonTrimmed, isRecommended)}
                >
                  {busy ? "جاري التنفيذ..." : isRecommended ? "اختيار" : "طلب استبدال"}
                </button>
              </article>
            ))}
          </div>
        )}
        <Pagination page={safePage} totalItems={rows.length} onPageChange={setPage} itemLabel="بديل" />
      </div>
    </div>
  );
}
