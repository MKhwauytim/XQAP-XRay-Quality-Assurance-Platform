import { useCallback, useEffect, useMemo, useState } from "react";
import { readSession } from "../../../../../auth/authSession";
import { PageHeader } from "../../../../../components/PageHeader/PageHeader";
import {
  getRolePermission,
  hasFeature,
  readUserManagementState,
} from "../../../../../auth/userManagement";
import {
  loadEmployeeAnswers,
  upsertItemAnswer,
} from "../../../../../data/answers/answerStorage";
import type { FieldAnswer, ItemAnswer } from "../../../../../data/answers/answerTypes";
import {
  loadOrDeriveDistributionCurrent,
} from "../../../../../data/distribution/distributionStorage";
import type { DistributionEntry } from "../../../../../data/distribution/distributionTypes";
import {
  getReplacementCandidates,
  executeReplacement,
} from "../../../../../data/distribution/replacement";
import { loadPopulationConfig, type StageAliasMappings } from "../../../../../data/population/populationConfig";
import {
  listMonthFolders,
  loadMonthPopulationFinal,
} from "../../../../../data/population/populationStorage";
import {
  loadSampleMaster,
} from "../../../../../data/sampling/sampleStorage";
import type { SampleMasterData } from "../../../../../data/sampling/sampleTypes";
import {
  loadTemplate,
  loadTemplateIndex,
} from "../../../../../data/templates/templateStorage";
import {
  loadInspectionTemplateSelection,
  saveInspectionTemplateSelection,
} from "../../../../../data/templates/templateSelectionStorage";
import {
  getFieldsForPhase,
  getTemplatePhases,
  getVisibleTemplateFields,
  isFieldVisible,
} from "../../../../../data/templates/templateRuntime";
import type { TemplateField, TemplateSchema } from "../../../../../data/templates/templateTypes";
import type { DirectoryHandleLike } from "../../../../../data/storage/fileSystemAccess";
import DataTable, {
  formatDate,
  looksLikeDate,
  type AnyFilter,
  type CellMeta,
  type ColConfig,
  type DateFormatMode,
  type DataTableCol,
} from "../../../../../components/DataTable";
import {
  loadUserBrowsePreset,
  saveUserBrowseDatasetPreset,
} from "../../../../../data/preferences/browsePresetStorage";
import {
  appendReferralRequest,
  appendReplacementRequest,
  getPendingReferralIds,
  loadReferralLog,
} from "../../../../../data/referral/referralStorage";
import type { ReferralRequest, ReplacementRequest } from "../../../../../data/referral/referralTypes";
import { useLabels, type Labels } from "../../../../../data/labels/useLabels";
import { formatStageLabel } from "../../Population/components/helpers";
import type { PreparedPopulationRow } from "../../Population/processing/populationProcessingTypes";

// ── Column definitions ────────────────────────────────────────────────────────

/** Sentinel column id for the row-selection checkbox. Not stored in presets. */
const SELECT_COL_ID = "__select__";
const REFERRALS_PRESET_KEY = "xray-referrals";

function buildXrayColumns(L: Labels): DataTableCol<DistributionEntry>[] {
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
      { value: "draft",     label: L.status_draft },
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

const DEFAULT_VISIBLE = [
  "xrayImageId", "stage", "assignedTo", "portName",
  "xrayEntryDate", "lastEventAt", "plateOrContainerNumber", "answerStatus", "submittedAt",
];

const COL_KEY = "xray_ref_cols_v4";

function buildDefaultColConfig(columns: DataTableCol<DistributionEntry>[]): ColConfig {
  const visible = new Set(DEFAULT_VISIBLE);
  return {
    order: columns.map((column) => column.id),
    hidden: columns.filter((column) => !visible.has(column.id)).map((column) => column.id),
    dateFmt: {},
    widths: {},
  };
}

function loadLocalColConfig(columns: DataTableCol<DistributionEntry>[]): ColConfig | null {
  try {
    const raw = localStorage.getItem(COL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ColConfig>;
    return {
      order: parsed.order ?? columns.map((column) => column.id),
      hidden: parsed.hidden ?? [],
      dateFmt: parsed.dateFmt ?? {},
      widths: parsed.widths ?? {},
    };
  } catch {
    return null;
  }
}

function getVisibleReferralColumns(
  columns: DataTableCol<DistributionEntry>[],
  cfg: ColConfig,
  isAdmin: boolean
): DataTableCol<DistributionEntry>[] {
  const orderedIds = new Set(cfg.order);
  const missingAlways = columns.filter((column) => column.alwaysVisible && !orderedIds.has(column.id));
  return [
    ...missingAlways,
    ...cfg.order
      .map((id) => columns.find((column) => column.id === id))
      .filter((column): column is DataTableCol<DistributionEntry> => Boolean(column)),
  ].filter((column) =>
    column.id !== SELECT_COL_ID &&
    !cfg.hidden.includes(column.id) &&
    (!column.adminOnly || isAdmin)
  );
}

// ── Main component ────────────────────────────────────────────────────────────

type Props = { directoryHandle: DirectoryHandleLike };
type LoadState = "idle" | "loading" | "ready" | "error";
type StatusMsg = { type: "ok" | "error"; text: string } | null;
type ReplacementDialogState = {
  entry: DistributionEntry;
  recommended: PreparedPopulationRow[];
  all: PreparedPopulationRow[];
} | null;
type ReferralModalState = {
  /** IDs to transfer — either manually selected or from current filter. */
  xrayImageIds: string[];
  source: "selected" | "filtered";
} | null;

export default function XrayReferrals({ directoryHandle }: Props) {
  const session  = readSession();
  const username = session?.username ?? "";
  const role     = session?.role ?? "employee";
  /** Supervisor + admin can see all employees' entries (oversight / audit). */
  const canSeeAll = role === "admin" || role === "supervisor";
  /** Only admin can mutate distribution data (replacements, etc.). */
  const canEdit   = role === "admin";
  const userManagementState = readUserManagementState();
  const canSetTemplate =
    canEdit ||
    getRolePermission(
      userManagementState.permissions,
      role,
      "template-builder"
    ) === "edit";
  const canConfigureColumns = hasFeature(
    userManagementState.featurePermissions,
    role,
    "configure-referral-columns"
  );
  const L = useLabels();
  const baseColumns = useMemo(() => buildXrayColumns(L), [L]);

  const [loadState, setLoadState]   = useState<LoadState>("idle");
  const [months, setMonths]         = useState<Array<{ month: number; year: number; folderName: string }>>([]);
  const [selMonth, setSelMonth]     = useState("");
  const [entries, setEntries]       = useState<DistributionEntry[]>([]);
  const [allEntries, setAllEntries] = useState<DistributionEntry[]>([]);
  const [tplIndex, setTplIndex]     = useState<Array<{ templateId: string; templateName: string; version: number }>>([]);
  const [selTplId, setSelTplId]     = useState("");
  const [activeTpl, setActiveTpl]   = useState<TemplateSchema | null>(null);
  const [answers, setAnswers]       = useState<ItemAnswer[]>([]);
  const [selEntryId, setSelEntryId] = useState<string | null>(null);
  const [statusMsg, setStatusMsg]   = useState<StatusMsg>(null);
  const [stageMappings, setStageMappings] = useState<StageAliasMappings | undefined>(undefined);
  const [sampleMaster, setSampleMaster] = useState<SampleMasterData | null>(null);
  const [populationRows, setPopulationRows] = useState<PreparedPopulationRow[]>([]);
  const [replacementDialog, setReplacementDialog] = useState<ReplacementDialogState>(null);
  const [replacementError, setReplacementError] = useState<string | null>(null);
  // Supervisor/admin-only filter: "مسنداتي فقط" shows only rows assigned to the current user.
  const [showMyOnly, setShowMyOnly] = useState(false);
  const [replacementBusy, setReplacementBusy] = useState(false);
  const [colPreset, setColPreset]     = useState<ColConfig | undefined>(undefined);
  const [myQuota, setMyQuota]         = useState<{ dailyQuota: number; daysRemaining: number; sampleCount: number } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [referralModal, setReferralModal] = useState<ReferralModalState>(null);
  useEffect(() => {
    void listMonthFolders(directoryHandle).then((ms) => {
      setMonths(ms);
      if (ms.length > 0) setSelMonth(ms[ms.length - 1]!.folderName);
    });
    void loadTemplateIndex(directoryHandle).then((idx) => setTplIndex(idx.templates));
    void loadInspectionTemplateSelection(directoryHandle).then((selection) => {
      if (selection?.templateId) void applyTemplate(selection.templateId, false);
    });
    void loadPopulationConfig(directoryHandle).then((cfg) => setStageMappings(cfg.stageMappings));
    void loadUserBrowsePreset(directoryHandle, username).then((file) => {
      const p = file.browseData[REFERRALS_PRESET_KEY];
      if (p) {
        setColPreset({
          order:   p.columnOrder,
          // Only hide columns the preset knew about; columns added later default visible.
          hidden:  baseColumns.map((c) => c.id).filter((id) => !p.visibleColumns.includes(id) && p.columnOrder.includes(id)),
          widths:  p.widths ?? {},
          dateFmt: (p.dateFmt ?? {}) as ColConfig["dateFmt"],
        });
      }
    });
  }, [baseColumns, directoryHandle, username]);

  // O(1) answer lookup keyed by `${xrayImageId}::${answeredBy}`.
  const answersMap = useMemo(() => {
    const m = new Map<string, ItemAnswer>();
    for (const a of answers) {
      m.set(`${a.xrayImageId}::${a.answeredBy}`, a);
    }
    return m;
  }, [answers]);

  const columns = useMemo<DataTableCol<DistributionEntry>[]>(() => {
    const mapped = baseColumns.map((col) => {
      if (col.id === "stage") {
        return { ...col, accessor: (entry: DistributionEntry) => formatStageLabel(entry.row.stage, stageMappings) };
      }
      // The submitted-at timestamp lives on the answer, not the distribution entry,
      // so inject an accessor that reads it from the answers map (renders + exports).
      if (col.id === "submittedAt") {
        return {
          ...col,
          accessor: (entry: DistributionEntry) =>
            answersMap.get(`${entry.xrayImageId}::${entry.assignedTo}`)?.submittedAt ?? null,
        };
      }
      return col;
    });
    // Checkbox column only for employees — admin/supervisor have no referral actions.
    // The accessor returns a stable empty string; actual checked state is read from
    // selectedIds inside renderCell so this memo doesn't re-create on every checkbox tick.
    if (canSeeAll) return mapped;
    const selectCol: DataTableCol<DistributionEntry> = {
      id: SELECT_COL_ID,
      label: "",
      widthFr: 3,
      alwaysVisible: true,
      accessor: () => "",
    };
    return [selectCol, ...mapped];
  }, [baseColumns, stageMappings, canSeeAll, answersMap]);

  const effectiveColConfig = useMemo(
    () => colPreset ?? loadLocalColConfig(columns) ?? buildDefaultColConfig(columns),
    [columns, colPreset]
  );

  const visiblePreviewColumns = useMemo(
    () => getVisibleReferralColumns(columns, effectiveColConfig, canSeeAll),
    [columns, effectiveColConfig, canSeeAll]
  );

  // Filtered view for supervisors/admins: "مسنداتي فقط" shows only their own assigned rows.
  const displayEntries = useMemo(
    () => (canSeeAll && showMyOnly ? entries.filter((e) => e.assignedTo === username) : entries),
    [entries, canSeeAll, showMyOnly, username]
  );

  const loadData = useCallback(async () => {
    if (!selMonth) return;
    setLoadState("loading");
    setSelEntryId(null);
    setSelectedIds(new Set());
    try {
      // Load sample.master first — its rows are the only ones needed for the
      // distribution derivation. population.final.json is NOT loaded here;
      // it is loaded lazily only when the replacement dialog opens.
      const [sample, referralLog] = await Promise.all([
        loadSampleMaster(directoryHandle, selMonth),
        loadReferralLog(directoryHandle, selMonth),
      ]);
      const sampleRows = (sample?.rows ?? []) as PreparedPopulationRow[];
      const dist = await loadOrDeriveDistributionCurrent(directoryHandle, selMonth, sampleRows);
      const all = dist?.entries ?? [];

      // Samples with a pending outgoing referral are hidden from the requesting employee
      const pendingIds = canSeeAll ? new Set<string>() : getPendingReferralIds(referralLog, username);

      const visible = canSeeAll
        ? all
        : all.filter(
            (e) =>
              e.assignedTo === username &&
              e.status !== "replaced" &&
              !pendingIds.has(e.xrayImageId)
          );
      setAllEntries(all);
      setEntries(visible);
      setSampleMaster(sample);

      // Extract frozen daily quota for the current employee
      if (!canSeeAll && dist?.quotas?.[username]) {
        const q = dist.quotas[username];
        setMyQuota({ dailyQuota: q.dailyQuota, daysRemaining: q.daysRemainingAtAssignment, sampleCount: q.sampleCount });
      } else {
        setMyQuota(null);
      }
      // populationRows is intentionally left empty here — populated on demand when
      // the replacement dialog is opened (see openReplacementDialog).
      setPopulationRows([]);

      const users = canSeeAll ? [...new Set(all.map((e) => e.assignedTo))] : [username];
      const files = await Promise.all(
        users.map((u) => loadEmployeeAnswers(directoryHandle, selMonth, u))
      );
      setAnswers(files.flatMap((f) => f.items));
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }, [directoryHandle, selMonth, username, canSeeAll]);

  useEffect(() => { void loadData(); }, [loadData]);

  async function applyTemplate(id: string, shouldSave: boolean): Promise<void> {
    setSelTplId(id);
    if (!id) { setActiveTpl(null); return; }
    setActiveTpl(await loadTemplate(directoryHandle, id));
    if (!shouldSave) return;
    const result = await saveInspectionTemplateSelection(directoryHandle, {
      templateId: id,
      updatedAt: new Date().toISOString(),
      updatedBy: username,
    });
    setStatusMsg(
      result.ok
        ? { type: "ok", text: "تم تعيين نموذج الفحص." }
        : { type: "error", text: result.error }
    );
  }

  async function handleTplSelect(id: string): Promise<void> {
    await applyTemplate(id, canSetTemplate);
  }

  async function handleSave(
    xrayImageId: string, ans: FieldAnswer[], submit: boolean, forUser: string
  ): Promise<void> {
    if (!activeTpl) return;
    const now  = new Date().toISOString();
    const item: ItemAnswer = {
      xrayImageId, templateId: activeTpl.templateId, templateVersion: activeTpl.version,
      answers: ans, lastSavedAt: now,
      submittedAt: submit ? now : null, answeredBy: forUser,
      status: submit ? "submitted" : "draft",
    };
    const result = await upsertItemAnswer(directoryHandle, selMonth, forUser, item);
    if (result.ok) {
      setAnswers((prev) => [
        ...prev.filter((a) => !(a.xrayImageId === xrayImageId && a.answeredBy === forUser)),
        item,
      ]);
      setStatusMsg({ type: "ok", text: submit ? "تم التقديم." : "تم حفظ المسودة." });
    } else {
      setStatusMsg({ type: "error", text: result.error });
    }
  }

  async function openReplacementDialog(entry: DistributionEntry): Promise<void> {
    if (!sampleMaster) return;
    // Load full population lazily — only when the replacement dialog is opened.
    let pop = populationRows;
    if (pop.length === 0 && selMonth) {
      try {
        const population = await loadMonthPopulationFinal(directoryHandle, selMonth);
        pop = (population?.rows ?? []) as PreparedPopulationRow[];
        setPopulationRows(pop);
      } catch { /* dialog will show empty candidates gracefully */ }
    }
    const candidates = getReplacementCandidates(
      entry, pop, sampleMaster, allEntries, stageMappings
    );
    setReplacementError(null);
    setReplacementDialog({ entry, ...candidates });
  }

  async function handleReplace(
    entry: DistributionEntry,
    replacement: PreparedPopulationRow,
    reason: string,
    fromRecommended: boolean
  ): Promise<void> {
    if (!selMonth || replacementBusy) return;

    setReplacementBusy(true);
    setReplacementError(null);

    try {
      if (fromRecommended) {
        // Immediate replacement — no approval needed.
        const result = await executeReplacement({
          directoryHandle,
          monthFolderName: selMonth,
          deadEntry: entry,
          replacementRow: replacement,
          reason,
          eventBy: username,
        });
        if (!result.ok) {
          setReplacementError(result.error);
          setStatusMsg({ type: "error", text: result.error });
          return;
        }
        if (result.ok) setSampleMaster(result.updatedSample);
        setReplacementDialog(null);
        setStatusMsg({ type: "ok", text: "تم استبدال العينة وإسناد البديل." });
        await loadData();
        setSelEntryId(replacement.xrayImageId);
      } else {
        // Non-recommended — requires supervisor approval.
        // Store only the id (not the full row) to avoid stale copies.
        const request: ReplacementRequest = {
          requestId: `rep-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          monthFolderName: selMonth,
          employeeUsername: entry.assignedTo,
          originalXrayImageId: entry.xrayImageId,
          replacementXrayImageId: replacement.xrayImageId,
          reason,
          requestedAt: new Date().toISOString(),
          requestedBy: username,
          status: "pending",
        };
        const result = await appendReplacementRequest(directoryHandle, selMonth, request);
        if (!result.ok) {
          setReplacementError(result.error);
          setStatusMsg({ type: "error", text: result.error });
          return;
        }
        setReplacementDialog(null);
        setStatusMsg({ type: "ok", text: "تم إرسال طلب الاستبدال — بانتظار موافقة المشرف." });
        await loadData();
      }
    } finally {
      setReplacementBusy(false);
    }
  }

  // ── Selection helpers ──────────────────────────────────────────────────────

  function toggleSelect(id: string, checked: boolean): void {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  function selectAll(ids: string[]): void {
    setSelectedIds(new Set(ids));
  }

  function clearSelection(): void {
    setSelectedIds(new Set());
  }

  // ── Referral request handler ───────────────────────────────────────────────

  async function handleReferralRequest(
    toEmployee: string,
    reason: string,
    xrayImageIds: string[]
  ): Promise<void> {
    if (!selMonth || xrayImageIds.length === 0) return;
    const request: ReferralRequest = {
      requestId: `ref-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      monthFolderName: selMonth,
      fromEmployee: username,
      toEmployee,
      xrayImageIds,
      reason,
      requestedAt: new Date().toISOString(),
      requestedBy: username,
      status: "pending",
    };
    const result = await appendReferralRequest(directoryHandle, selMonth, request);
    if (result.ok) {
      setReferralModal(null);
      clearSelection();
      setStatusMsg({ type: "ok", text: `تم إرسال طلب الإحالة لـ ${toEmployee} — بانتظار موافقة المشرف.` });
      await loadData();
    } else {
      setStatusMsg({ type: "error", text: result.error });
    }
  }

  // ── Cell renderer ──────────────────────────────────────────────────────────

  function renderCell(
    col: DataTableCol<DistributionEntry>,
    entry: DistributionEntry,
    { isDate, dateFmt }: CellMeta
  ) {
    if (col.id === SELECT_COL_ID) {
      if (entry.status === "replaced") return null;
      return (
        <input
          type="checkbox"
          className="ew-row-check"
          checked={selectedIds.has(entry.xrayImageId)}
          onChange={(e) => toggleSelect(entry.xrayImageId, e.target.checked)}
          onClick={(e) => e.stopPropagation()}
          aria-label={`تحديد ${entry.xrayImageId}`}
        />
      );
    }
    if (col.id === "xrayImageId") {
      return <span className="dt-mono">{entry.xrayImageId}</span>;
    }
    if (col.id === "answerStatus") {
      const answer = answersMap.get(`${entry.xrayImageId}::${entry.assignedTo}`);
      return <StatusBadge answer={answer} entryStatus={entry.status} labels={L} />;
    }
    const raw = col.id === "stage"
      ? formatStageLabel(entry.row.stage, stageMappings)
      : col.accessor(entry);
    if (!raw) return <span className="dt-muted">{L.value_empty}</span>;
    // The expert observation timestamp is shown with date AND time by default.
    if (col.id === "submittedAt") {
      return <span className="dt-cell">{formatDate(raw, dateFmt === "date" ? "datetime" : dateFmt)}</span>;
    }
    if (isDate) return <span className="dt-cell">{formatDate(raw, dateFmt)}</span>;
    return <span className="dt-cell">{raw}</span>;
  }

  // ── Custom filter override for answerStatus ────────────────────────────────

  function rowMatchesFilter(
    entry: DistributionEntry,
    colId: string,
    filter: AnyFilter
  ): boolean | null {
    if (colId !== "answerStatus" || filter.kind !== "status") return null;
    const v = filter.value;
    if (!v || v === "all") return true;
    if (entry.status === "replaced") return v === "replaced";
    const answer = answersMap.get(`${entry.xrayImageId}::${entry.assignedTo}`);
    const s = answer?.status;
    if (v === "submitted") return s === "submitted";
    if (v === "draft")     return s === "draft";
    if (v === "pending")   return !s;
    return true;
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <section className="ew-page" dir="rtl">
      <PageHeader
        eyebrow={L.page_xray_referrals_eyebrow}
        title={L.page_xray_referrals_title}
        subtitle={canSeeAll ? L.page_xray_referrals_subtitle_all : L.page_xray_referrals_subtitle_own}
      >
        {myQuota && (
          <div className="ew-quota-badge" title={`إجمالي العينة: ${myQuota.sampleCount} | أيام متبقية عند التعيين: ${myQuota.daysRemaining}`}>
            <span className="ew-quota-label">الحصة اليومية</span>
            <span className="ew-quota-value">{myQuota.dailyQuota}</span>
            <span className="ew-quota-sub">صورة / يوم</span>
          </div>
        )}
      </PageHeader>

      {statusMsg && (
        <div className={statusMsg.type === "ok" ? "ew-msg-ok" : "ew-msg-error"} role="status">
          {statusMsg.text}
          <button
            type="button"
            style={{ float: "left", background: "none", border: "none", cursor: "pointer", fontSize: 13 }}
            onClick={() => setStatusMsg(null)}
          >✕</button>
        </div>
      )}

      {loadState === "loading" && <p className="ew-empty">جاري التحميل...</p>}
      {loadState === "error"   && <p className="ew-empty">تعذر تحميل البيانات.</p>}

      {(loadState === "ready" || loadState === "idle") && (
        <DataTable<DistributionEntry>
          columns={columns}
          rows={displayEntries}
          getRowKey={(e) => e.xrayImageId}
          renderCell={renderCell}
          storageKey={COL_KEY}
          defaultVisible={DEFAULT_VISIBLE}
          isAdmin={canSeeAll}
          canConfigureColumns={canConfigureColumns}
          initialColConfig={colPreset}
          onColConfigChange={(cfg) => {
            setColPreset(cfg);
            void saveUserBrowseDatasetPreset(directoryHandle, username, REFERRALS_PRESET_KEY, {
              columnOrder:    cfg.order,
              visibleColumns: baseColumns.map((c) => c.id).filter((id) => !cfg.hidden.includes(id)),
              widths:         cfg.widths,
              dateFmt:        cfg.dateFmt,
            });
          }}
          rowMatchesFilter={rowMatchesFilter}
          exportFileName={`صور الأشعة المحالة - ${selMonth || "كل الأشهر"}.xlsx`}
          expandedKey={selEntryId}
          renderExpanded={(entry) => {
            const answer = answersMap.get(`${entry.xrayImageId}::${entry.assignedTo}`) ?? null;
            return (
              <ItemFormCard
                entry={entry}
                template={activeTpl}
                savedAnswer={answer}
                stageLabel={formatStageLabel(entry.row.stage, stageMappings)}
                onSave={handleSave}
                onReplace={openReplacementDialog}
                readonly={canSeeAll && entry.assignedTo !== username}
              />
            );
          }}
          onRowClick={(e) =>
            setSelEntryId((cur) => (cur === e.xrayImageId ? null : e.xrayImageId))
          }
          toolbarEndExtra={
            canSeeAll ? (
              <div className="ew-view-switcher" role="group" aria-label="نطاق العرض">
                <button
                  type="button"
                  className={`ew-view-seg${!showMyOnly ? " active" : ""}`}
                  onClick={() => setShowMyOnly(false)}
                >
                  الكل
                </button>
                <button
                  type="button"
                  className={`ew-view-seg${showMyOnly ? " active" : ""}`}
                  onClick={() => setShowMyOnly(true)}
                >
                  مسنداتي فقط
                </button>
              </div>
            ) : undefined
          }
          toolbarStart={
            <>
              <label className="ew-label" htmlFor="ref-month">
                {L.label_month}
                <select
                  id="ref-month"
                  className="ew-select"
                  value={selMonth}
                  onChange={(e) => setSelMonth(e.target.value)}
                >
                  {months.map((m) => (
                    <option key={m.folderName} value={m.folderName}>{m.folderName}</option>
                  ))}
                </select>
              </label>

              <label className="ew-label" htmlFor="ref-tpl">
                {L.label_template}
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {canSetTemplate ? (
                    <select
                      id="ref-tpl"
                      className="ew-select"
                      value={selTplId}
                      onChange={(e) => { void handleTplSelect(e.target.value); }}
                    >
                      <option value="">اختر نموذجاً...</option>
                      {tplIndex.map((t) => (
                        <option key={t.templateId} value={t.templateId}>
                          {t.templateName} (v{t.version})
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="ew-template-locked" id="ref-tpl">
                      {activeTpl ? `${activeTpl.templateName} (v${activeTpl.version})` : "لم يتم تعيين نموذج"}
                    </div>
                  )}
                  {selTplId && (
                    <button
                      type="button"
                      className="ew-btn-secondary ew-btn-sm"
                      title="إعادة تحميل النموذج من القرص"
                      onClick={() => { void applyTemplate(selTplId, false); }}
                    >↻</button>
                  )}
                </div>
              </label>

              {/* Referral action buttons — only for non-admin (employees request; admins/supervisors approve) */}
              {!canSeeAll && entries.length > 0 && (
                <div className="ew-referral-actions">
                  <button
                    type="button"
                    className="ew-btn-referral"
                    disabled={selectedIds.size === 0}
                    onClick={() =>
                      setReferralModal({ xrayImageIds: [...selectedIds], source: "selected" })
                    }
                  >
                    {selectedIds.size > 0 ? `إحالة (${selectedIds.size})` : "إحالة"}
                  </button>
                  <button
                    type="button"
                    className="ew-btn-secondary ew-btn-sm"
                    onClick={
                      selectedIds.size > 0
                        ? clearSelection
                        : () => selectAll(entries.filter((e) => e.status !== "replaced").map((e) => e.xrayImageId))
                    }
                  >
                    {selectedIds.size > 0 ? "إلغاء التحديد" : "تحديد الكل"}
                  </button>
                </div>
              )}
            </>
          }
        />
      )}

      {replacementDialog ? (
        <ReplacementDialog
          state={replacementDialog}
          stageMappings={stageMappings}
          error={replacementError}
          busy={replacementBusy}
          onClose={() => {
            setReplacementDialog(null);
            setReplacementError(null);
          }}
          onSelect={(row, reason, fromRecommended) => { void handleReplace(replacementDialog.entry, row, reason, fromRecommended); }}
        />
      ) : null}

      {referralModal ? (
        <ReferralRequestModal
          xrayImageIds={referralModal.xrayImageIds}
          entries={referralModal.xrayImageIds
            .map((id) => entries.find((entry) => entry.xrayImageId === id))
            .filter((entry): entry is DistributionEntry => Boolean(entry))}
          visibleColumns={visiblePreviewColumns}
          dateFmt={effectiveColConfig.dateFmt}
          answersMap={answersMap}
          currentUser={username}
          onClose={() => setReferralModal(null)}
          onSubmit={(toEmployee, reason) =>
            void handleReferralRequest(toEmployee, reason, referralModal.xrayImageIds)
          }
        />
      ) : null}
    </section>
  );
}

// ── ReferralRequestModal ──────────────────────────────────────────────────────

function ReferralRequestModal({
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
  const entriesById = useMemo(
    () => new Map(entries.map((entry) => [entry.xrayImageId, entry])),
    [entries]
  );

  const employees = readUserManagementState()
    .users.filter((u) => u.isActive && u.username !== currentUser)
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "ar"));

  const canSubmit = toEmployee.trim() !== "" && reason.trim() !== "" && !submitting;

  function handleSubmit(): void {
    if (!canSubmit) return;
    setSubmitting(true);
    onSubmit(toEmployee, reason.trim());
  }

  return (
    <div className="ew-modal-backdrop" role="dialog" aria-modal="true">
      <div className="ew-replace-modal">
        <div className="ew-replace-header">
          <div>
            <h3>إحالة العينات</h3>
            <p>{xrayImageIds.length} عينة محددة للإحالة</p>
          </div>
          <button type="button" className="ew-modal-close" onClick={onClose} aria-label="إغلاق">×</button>
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

function ReferralSamplePreview({
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

function getReferralPreviewValue(
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
    if (answer?.status === "draft") return labels.status_draft;
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

function StatusBadge({ answer, entryStatus, labels }: { answer?: ItemAnswer; entryStatus: string; labels: Labels }) {
  if (entryStatus === "replaced")
    return <span className="ew-status-badge" style={{ background: "#f1f5f9", color: "#64748b" }}>{labels.status_replaced}</span>;
  if (answer?.status === "submitted")
    return <span className="ew-status-badge ew-badge-done">{labels.status_completed}</span>;
  if (answer?.status === "draft")
    return <span className="ew-status-badge" style={{ background: "#fef9c3", color: "#854d0e" }}>{labels.status_draft}</span>;
  return <span className="ew-status-badge ew-badge-pending">{labels.status_pending}</span>;
}

// ── ItemFormCard ──────────────────────────────────────────────────────────────

type FormCardProps = {
  entry: DistributionEntry;
  template: TemplateSchema | null;
  savedAnswer: ItemAnswer | null;
  stageLabel: string;
  onSave: (xrayImageId: string, ans: FieldAnswer[], submit: boolean, forUser: string) => void;
  /** Omit to hide the replacement button (non-admin viewers). */
  onReplace?: (entry: DistributionEntry) => void;
  readonly: boolean;
};

function ItemFormCard({ entry, template, savedAnswer, stageLabel, onSave, onReplace, readonly }: FormCardProps) {
  const [ans, setAns] = useState<Record<string, string | number | boolean>>(() => {
    if (!savedAnswer) return {};
    const m: Record<string, string | number | boolean> = {};
    for (const a of savedAnswer.answers) { if (a.value !== null) m[a.fieldId] = a.value; }
    return m;
  });

  const isSubmitted = savedAnswer?.status === "submitted";
  const row = entry.row;

  function collect(): FieldAnswer[] {
    return template
      ? getVisibleTemplateFields(template, ans).map((field) => ({
          fieldId: field.fieldId,
          value: field.type === "empty" ? null : ans[field.fieldId] ?? null,
        }))
      : [];
  }

  return (
    <article className={`ew-item-card ${isSubmitted ? "ew-submitted" : ""}`}>
      <div className="ew-item-header">
        <div>
          <h3 className="ew-item-id">{row.xrayImageId}</h3>
          <p className="ew-item-meta">
            {row.portName ?? "—"} · {row.certScanStatus} · {stageLabel || "—"}
            {readonly && <span style={{ marginRight: 8, color: "#64748b", fontSize: 12 }}>(عرض فقط)</span>}
          </p>
        </div>
        <span className={`ew-status-badge ${isSubmitted ? "ew-badge-done" : "ew-badge-pending"}`}>
          {isSubmitted ? "مقدم" : "قيد التحرير"}
        </span>
      </div>

      {!template ? (
        <p className="ew-no-template">اختر نموذجاً لعرض حقول الفحص.</p>
      ) : isSubmitted || readonly ? (
        <div className="ew-submitted-view">
          {getTemplatePhases(template).map((phase) => {
            const fields = getFieldsForPhase(template, phase.phaseId).filter((field) =>
              isFieldVisible(field, ans)
            );
            if (fields.length === 0) return null;
            return (
              <section key={phase.phaseId} className="ew-form-phase">
                <h4>{phase.title}</h4>
                {phase.description ? <p>{phase.description}</p> : null}
                {fields.map((field) => (
                  <div key={field.fieldId} className="ew-answer-row">
                    <span className="ew-answer-label">{field.label}</span>
                    <span className="ew-answer-value">{formatAnswerValue(field, ans[field.fieldId])}</span>
                  </div>
                ))}
              </section>
            );
          })}
        </div>
      ) : (
        <>
          <div className="ew-form-flow">
            {getTemplatePhases(template).map((phase) => {
              const fields = getFieldsForPhase(template, phase.phaseId).filter((field) =>
                isFieldVisible(field, ans)
              );
              if (fields.length === 0) return null;
              return (
                <section key={phase.phaseId} className="ew-form-phase">
                  <h4>{phase.title}</h4>
                  {phase.description ? <p>{phase.description}</p> : null}
                  <div className="ew-form-fields">
                    {fields.map((field) => (
                      <FormField
                        key={field.fieldId}
                        field={field}
                        value={ans[field.fieldId] ?? ""}
                        onChange={(value) => setAns((previous) => ({ ...previous, [field.fieldId]: value }))}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
          <div className="ew-form-actions">
            {onReplace && (
              <button
                type="button"
                className="ew-btn-warning"
                onClick={() => onReplace(entry)}
              >استبدال العينة</button>
            )}
            <button
              type="button"
              className="ew-btn-secondary"
              onClick={() => onSave(row.xrayImageId, collect(), false, entry.assignedTo)}
            >حفظ مسودة</button>
            <button
              type="button"
              className="ew-btn-primary"
              onClick={() => onSave(row.xrayImageId, collect(), true, entry.assignedTo)}
            >تقديم</button>
          </div>
        </>
      )}
    </article>
  );
}

function formatAnswerValue(field: TemplateField, value: string | number | boolean | undefined): string {
  if (field.type === "empty") return "—";
  if (value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "نعم" : "لا";
  return String(value);
}

function ReplacementDialog({
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
  const rows = tab === "recommended" ? state.recommended : state.all;
  const stageLabel = formatStageLabel(state.entry.row.stage, stageMappings);
  const reasonTrimmed = reason.trim();
  const canSelect = reasonTrimmed.length > 0;
  const isRecommended = tab === "recommended";

  return (
    <div className="ew-modal-backdrop" role="dialog" aria-modal="true">
      <div className="ew-replace-modal">
        <div className="ew-replace-header">
          <div>
            <h3>استبدال العينة</h3>
            <p>
              {state.entry.xrayImageId} · {stageLabel} · {state.entry.row.portName ?? "—"}
            </p>
          </div>
          <button type="button" className="ew-modal-close" onClick={onClose} aria-label="إغلاق">
            ×
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
            onClick={() => setTab("recommended")}
          >
            الموصى بها ({state.recommended.length})
          </button>
          <button
            type="button"
            className={tab === "all" ? "active" : ""}
            onClick={() => setTab("all")}
          >
            كل البدائل ({state.all.length})
          </button>
        </div>

        {!isRecommended && (
          <div style={{ margin: "0 0 10px", padding: "8px 12px", background: "#fef9c3", border: "1px solid #fde68a", borderRadius: 8, fontSize: 12, color: "#78350f" }}>
            ⚠ الاستبدال من هذه القائمة يحتاج موافقة المشرف — سيُرسل كطلب معلق في اعتماد الطلبات.
          </div>
        )}

        {rows.length === 0 ? (
          <div className="ew-replace-empty">
            لا توجد بدائل غير معينة في {tab === "recommended" ? "نفس المنفذ والمستوى" : "نفس المستوى"}.
          </div>
        ) : (
          <div className="ew-replace-list">
            {rows.map((row) => (
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
      </div>
    </div>
  );
}

// ── FormField ─────────────────────────────────────────────────────────────────

function FormField({
  field, value, onChange,
}: {
  field: TemplateField;
  value: string | number | boolean;
  onChange: (v: string | number | boolean) => void;
}) {
  const id = `field-${field.fieldId}`;
  if (field.type === "empty") {
    return (
      <div className="ew-form-field ew-form-note">
        <span className="ew-field-label">{field.label}</span>
      </div>
    );
  }

  return (
    <div className="ew-form-field">
      <label className="ew-field-label" htmlFor={id}>
        {field.label}
        {field.required ? <span className="ew-required">*</span> : null}
      </label>
      {field.type === "text"     ? <input id={id} type="text"     className="ew-input"    placeholder={field.placeholder} value={String(value)}  onChange={(e) => onChange(e.target.value)} /> :
       field.type === "textarea" ? <textarea id={id} className="ew-input ew-textarea" placeholder={field.placeholder} value={String(value)} onChange={(e) => onChange(e.target.value)} /> :
       field.type === "number"   ? <input id={id} type="number"   className="ew-input"    placeholder={field.placeholder} value={String(value)}  onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))} /> :
       field.type === "date"     ? <input id={id} type="date"     className="ew-input"    value={String(value)}  onChange={(e) => onChange(e.target.value)} /> :
       field.type === "checkbox" ? <input id={id} type="checkbox" className="ew-checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} /> :
       field.type === "dropdown" ? (
         <select id={id} className="ew-select" value={String(value)} onChange={(e) => onChange(e.target.value)}>
           <option value="">اختر...</option>
           {field.options.map((o) => <option key={o} value={o}>{o}</option>)}
         </select>
       ) : null}
    </div>
  );
}
