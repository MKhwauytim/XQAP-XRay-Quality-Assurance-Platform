import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X, AlertTriangle, RotateCw } from "lucide-react";
import { useFocusTrap } from "../../../../../hooks/useFocusTrap";
import { readSession } from "../../../../../auth/authSession";
import { PageHeader } from "../../../../../components/PageHeader/PageHeader";
import { logRejection } from "../../../../../data/storage/errorLogger";
import {
  getRolePermission,
  hasFeature,
  readUserManagementState,
  subscribeToUserManagementChanges,
} from "../../../../../auth/userManagement";
import {
  loadEmployeeAnswers,
  upsertItemAnswer,
} from "../../../../../data/answers/answerStorage";
import { reopenSubmittedAnswer } from "../../../../../data/answers/reopenAnswer";
import { MonthClosedError } from "../../../../../data/population/monthLock";
import { getLabels } from "../../../../../data/labels/labelsStore";
import type { FieldAnswer, ItemAnswer } from "../../../../../data/answers/answerTypes";
import {
  loadOrDeriveDistributionCurrent,
} from "../../../../../data/distribution/distributionStorage";
import type { DistributionEntry } from "../../../../../data/distribution/distributionTypes";
import {
  getReplacementCandidates,
  executeReplacement,
} from "../../../../../data/distribution/replacement";
import { isAssignableSampleRole } from "../../../../../data/distribution/bulkAssignment";
import { loadPopulationConfig, type StageAliasMappings } from "../../../../../data/population/populationConfig";
import {
  loadMonthPopulationFinal,
} from "../../../../../data/population/populationStorage";
import { useGlobalMonth } from "../../../../../data/month/useGlobalMonth";
import {
  loadSampleMaster,
} from "../../../../../data/sampling/sampleStorage";
import { loadEmployeeSampleMirror } from "../../../../../data/samples/sampleMirrorStorage";
import type { SampleMasterData } from "../../../../../data/sampling/sampleTypes";
import {
  loadTemplate,
  loadTemplateIndex,
} from "../../../../../data/templates/templateStorage";
import {
  loadInspectionTemplateSelection,
  saveInspectionTemplateSelection,
} from "../../../../../data/templates/templateSelectionStorage";
import type { TemplateSchema } from "../../../../../data/templates/templateTypes";
import type { DirectoryHandleLike } from "../../../../../data/storage/fileSystemAccess";
import DataTable, {
  type CellMeta,
  type ColConfig,
  type DataTableCol,
} from "../../../../../components/DataTable";
import {
  formatDate,
  looksLikeDate,
  type AnyFilter,
  type DateFormatMode,
} from "../../../../../components/DataTable/utils";
import {
  loadAdminBrowsePreset,
  loadUserBrowsePreset,
  saveAdminBrowseDatasetPreset,
  saveUserBrowseDatasetPreset,
} from "../../../../../data/preferences/browsePresetStorage";
import InspectionPanel from "../../../../../components/InspectionPanel";
import {
  appendReferralRequest,
  appendReplacementRequest,
  getPendingReferralIds,
  loadReferralLog,
} from "../../../../../data/referral/referralStorage";
import { submitReopenRequest } from "../../../../../data/referral/requestReopen";
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
  "xrayImageId", "stage", "portName", "xrayEntryDate",
  "plateOrContainerNumber", "xrayLevelOneResult", "xrayLevelTwoResult",
];

const COL_KEY = "xray_ref_cols_v4";

function buildDefaultColConfig(columns: DataTableCol<DistributionEntry>[]): ColConfig {
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

function loadLocalColConfig(): ColConfig | null {
  return null;
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

function pct(n: number, d: number): number {
  return d === 0 ? 0 : Math.round((n / d) * 100);
}

// ── Main component ────────────────────────────────────────────────────────────

type Props = { directoryHandle: DirectoryHandleLike };
type LoadState = "idle" | "loading" | "ready" | "error";
type StatusMsg = { type: "ok" | "error"; text: string } | null;
type PersonalStats = {
  assigned: number;
  submitted: number;
  notStarted: number;
  replaced: number;
  active: number;
  completionPct: number;
};
type PersonalQuota = { dailyQuota: number; daysRemaining: number; sampleCount: number } | null;
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
  /** Only admin can mutate distribution data (replacements, etc.). */
  const canEdit   = role === "admin";
  // Re-render when the permission matrix changes (e.g. admin edits User Management while
  // this tab stays mounted) — otherwise canSeeAll/canEdit/etc. below stay frozen at the
  // last unrelated render's snapshot.
  const [, forcePermissionRefresh] = useState(0);
  useEffect(() => subscribeToUserManagementChanges(() => forcePermissionRefresh((n) => n + 1)), []);
  const userManagementState = readUserManagementState();
  /** Oversight view is permission-driven; ordinary users only see their own samples. */
  const canSeeAll = hasFeature(
    userManagementState.featurePermissions,
    role,
    "view-all-entries"
  );
  const canSetTemplate =
    canEdit ||
    getRolePermission(
      userManagementState.permissions,
      role,
      "ew/inspection-form"
    ) === "edit";
  const canConfigureColumns = hasFeature(
    userManagementState.featurePermissions,
    role,
    "configure-referral-columns"
  );
  const canRequestReplacement = hasFeature(
    userManagementState.featurePermissions,
    role,
    "request-replacement"
  );
  const canSubmitReferrals = hasFeature(
    userManagementState.featurePermissions,
    role,
    "submit-referrals"
  );
  const canReopenAnswer = hasFeature(
    userManagementState.featurePermissions,
    role,
    "ew.reopenAnswer"
  );
  // Batch B: when enabled for this role, the employee's self-service reopen request
  // is applied instantly; when disabled it is routed to a supervisor for approval.
  const canReopenInstant = hasFeature(
    userManagementState.featurePermissions,
    role,
    "employee-reopen-instant"
  );
  const L = useLabels();
  const baseColumns = useMemo(() => buildXrayColumns(L), [L]);

  const [loadState, setLoadState]   = useState<LoadState>("idle");
  const { selection: globalMonth } = useGlobalMonth();
  // Pending months have no folder on disk yet — treat them as "no data" (empty states).
  const selMonth = globalMonth.kind === "existing" ? globalMonth.folderName : "";
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
  // Permissioned oversight users can switch to "all", but the page opens on personal samples.
  const [showMyOnly, setShowMyOnly] = useState(true);
  const [replacementBusy, setReplacementBusy] = useState(false);
  const [colPreset, setColPreset]     = useState<ColConfig | undefined>(undefined);
  const [myQuota, setMyQuota]         = useState<PersonalQuota>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filteredTableEntries, setFilteredTableEntries] = useState<DistributionEntry[]>([]);
  const [referralModal, setReferralModal] = useState<ReferralModalState>(null);

  // Function declaration (hoisted) — safe to reference from the mount effect
  // below even though it appears earlier in source, with no TDZ/identity
  // concerns for the React Compiler.
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

  useEffect(() => {
    void loadTemplateIndex(directoryHandle)
      .then((idx) => setTplIndex(idx.templates))
      .catch(logRejection("xrayReferrals:loadTemplateIndex"));
    void loadInspectionTemplateSelection(directoryHandle)
      .then((selection) => {
        if (selection?.templateId) void applyTemplate(selection.templateId, false);
      })
      .catch(logRejection("xrayReferrals:loadInspectionTemplateSelection"));
    void loadPopulationConfig(directoryHandle)
      .then((cfg) => setStageMappings(cfg.stageMappings))
      .catch(logRejection("xrayReferrals:loadPopulationConfig"));
    void Promise.all([
      loadAdminBrowsePreset(directoryHandle),
      loadUserBrowsePreset(directoryHandle, username),
    ])
      .then(([adminFile, userFile]) => {
      // Personal-over-admin: a user's own saved column layout wins; the admin
      // shared preset is only the default for users who never customized.
      const p = userFile.browseData[REFERRALS_PRESET_KEY] ?? adminFile.browseData[REFERRALS_PRESET_KEY];
      if (p) {
        setColPreset({
          order:   p.columnOrder,
          // Only hide columns the preset knew about; columns added later default visible.
          hidden:  baseColumns.map((c) => c.id).filter((id) => !p.visibleColumns.includes(id) && p.columnOrder.includes(id)),
          widths:  p.widths ?? {},
          dateFmt: (p.dateFmt ?? {}) as ColConfig["dateFmt"],
        });
      }
      })
      .catch(logRejection("xrayReferrals:loadBrowsePresets"));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- applyTemplate is intentionally excluded; it is recreated on every render and including it would trigger an infinite loop
  }, [baseColumns, directoryHandle, username]);

  // O(1) answer lookup keyed by `${xrayImageId}::${answeredBy}`.
  const answersMap = useMemo(() => {
    const m = new Map<string, ItemAnswer>();
    for (const a of answers) {
      m.set(`${a.xrayImageId}::${a.answeredBy}`, a);
    }
    return m;
  }, [answers]);

  /* eslint-disable react-hooks/preserve-manual-memoization -- React Compiler can't prove
     stageMappings/canSeeAll/answersMap/username are stable across renders (they come from
     useState/session/derived useMemo values that are safe in practice); these hooks keep
     their manual dependency arrays and behave correctly, just without compiler auto-memoization. */
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
    // Checkbox column only for personal-scope users — oversight users have no referral actions.
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
    () => colPreset ?? loadLocalColConfig() ?? buildDefaultColConfig(columns),
    [columns, colPreset]
  );

  const visiblePreviewColumns = useMemo(
    () => getVisibleReferralColumns(columns, effectiveColConfig, canSeeAll),
    [columns, effectiveColConfig, canSeeAll]
  );

  // Permissioned oversight view: "المحالة لي" shows only rows assigned to the current user.
  const displayEntries = useMemo(
    () => (canSeeAll && showMyOnly ? entries.filter((e) => e.assignedTo === username) : entries),
    [entries, canSeeAll, showMyOnly, username]
  );

  // Auto-select first entry whenever the list changes and nothing is currently selected
  useEffect(() => {
    if (displayEntries.length === 0) return;
    const valid = selEntryId != null && displayEntries.some((e) => e.xrayImageId === selEntryId);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- auto-corrects selection when the display list changes; useMemo cannot accumulate user navigation state
    if (!valid) setSelEntryId(displayEntries[0].xrayImageId);
  }, [displayEntries, selEntryId]);

  const selEntry = useMemo(
    () => selEntryId ? (displayEntries.find((e) => e.xrayImageId === selEntryId) ?? null) : null,
    [selEntryId, displayEntries]
  );

  const selAnswer = useMemo(
    () => selEntry ? (answersMap.get(`${selEntry.xrayImageId}::${selEntry.assignedTo}`) ?? null) : null,
    [selEntry, answersMap]
  );

  const personalStats = useMemo<PersonalStats>(() => {
    const source = canSeeAll
      ? displayEntries
      : (allEntries.length > 0 ? allEntries : entries).filter((entry) => entry.assignedTo === username);
    const submitted = source.filter((entry) => isStudyCompleted(entry, answersMap)).length;
    const replaced = source.filter((entry) => entry.status === "replaced").length;
    const notStarted = Math.max(0, source.length - submitted - replaced);
    return {
      assigned: source.length,
      submitted,
      notStarted,
      replaced,
      active: Math.max(0, source.length - replaced),
      completionPct: pct(submitted, source.length),
    };
  }, [allEntries, entries, displayEntries, canSeeAll, username, answersMap]);

  // Bug (load-token): guards a slow load for a previously-selected month from
  // clobbering a later selection — including the truthy→"" empty transition.
  const loadTokenRef = useRef(0);

  // No selected on-disk month (empty workspace or a pending new month) → clear the
  // loaded queue and land in the ready/empty state (sibling to the load-token guard).
  useEffect(() => {
    if (!selMonth) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync empty-state reset when no month folder is selected
      setEntries([]);
      setAllEntries([]);
      setAnswers([]);
      setSampleMaster(null);
      setMyQuota(null);
      setPopulationRows([]);
      setSelEntryId(null);
      setSelectedIds(new Set());
      setLoadState("ready");
    }
  }, [selMonth]);

  const loadData = useCallback(async () => {
    // Invalidate any in-flight load first — even the no-month early return must
    // stale older loads, or a truthy→"" selMonth transition would let an in-flight
    // load commit stale rows over the empty-ready state.
    const token = ++loadTokenRef.current;
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
      const personalMirror = canSeeAll
        ? null
        : await loadEmployeeSampleMirror(directoryHandle, selMonth, username);
      const all = dist?.entries ?? personalMirror?.entries ?? [];

      // Samples with a pending outgoing referral are hidden from the requesting employee
      const pendingIds = canSeeAll ? new Set<string>() : getPendingReferralIds(referralLog, username);

      // Filter over `all` (fresh derived dist first; the personal mirror is only
      // the fallback baked into `all` when dist is null). Preferring the mirror
      // here would show a stale snapshot even when a fresh derivation exists.
      const visible = canSeeAll
        ? all
        : all.filter(
            (e) =>
              e.assignedTo === username &&
              e.status !== "replaced" &&
              !pendingIds.has(e.xrayImageId)
          );

      // Extract frozen daily quota for the current employee.
      const quota: PersonalQuota = dist?.quotas?.[username]
        ? {
            dailyQuota: dist.quotas[username].dailyQuota,
            daysRemaining: dist.quotas[username].daysRemainingAtAssignment,
            sampleCount: dist.quotas[username].sampleCount,
          }
        : null;

      const users = canSeeAll ? [...new Set(all.map((e) => e.assignedTo))] : [username];
      const files = await Promise.all(
        users.map((u) => loadEmployeeAnswers(directoryHandle, selMonth, u))
      );
      const answerItems = files.flatMap((f) => f.items);

      if (token !== loadTokenRef.current) return; // superseded by a newer month selection

      setAllEntries(all);
      setEntries(visible);
      setSampleMaster(sample);
      setMyQuota(quota);
      // populationRows is intentionally left empty here — populated on demand when
      // the replacement dialog is opened (see openReplacementDialog).
      setPopulationRows([]);
      setAnswers(answerItems);
      setLoadState("ready");
    } catch {
      if (token === loadTokenRef.current) setLoadState("error");
    }
  }, [directoryHandle, selMonth, username, canSeeAll]);
  /* eslint-enable react-hooks/preserve-manual-memoization */

  // eslint-disable-next-line react-hooks/set-state-in-effect -- async data load; setState fires inside loadData's async callback, not synchronously in the effect body
  useEffect(() => { void loadData(); }, [loadData]);

  async function handleTplSelect(id: string): Promise<void> {
    await applyTemplate(id, canSetTemplate);
  }

  async function handleSave(
    xrayImageId: string, ans: FieldAnswer[], _submit: boolean, forUser: string
  ): Promise<void> {
    // No on-disk month selected → the upsert target folder would be "" (writes
    // to the workspace root). Bail before touching disk.
    if (!activeTpl || !selMonth) return;
    const now  = new Date().toISOString();
    const item: ItemAnswer = {
      xrayImageId, templateId: activeTpl.templateId, templateVersion: activeTpl.version,
      answers: ans, lastSavedAt: now,
      submittedAt: now, answeredBy: forUser,
      status: "submitted",
    };
    try {
      const result = await upsertItemAnswer(directoryHandle, selMonth, forUser, item);
      if (result.ok) {
        setAnswers((prev) => [
          ...prev.filter((a) => !(a.xrayImageId === xrayImageId && a.answeredBy === forUser)),
          item,
        ]);
        setStatusMsg({ type: "ok", text: "تم التقديم." });
      } else {
        setStatusMsg({ type: "error", text: result.error });
      }
    } catch (error) {
      setStatusMsg({
        type: "error",
        text: error instanceof MonthClosedError
          ? getLabels().msg_month_closed_write_blocked
          : error instanceof Error ? error.message : "خطأ غير معروف",
      });
    }
  }

  async function handleReopenAnswer(entry: DistributionEntry, reason: string): Promise<void> {
    if (!selMonth) return;
    try {
      const result = await reopenSubmittedAnswer({
        directoryHandle,
        monthFolderName: selMonth,
        employeeUsername: entry.assignedTo,
        xrayImageId: entry.xrayImageId,
        reopenedBy: username,
        reopenedByRole: role,
        reason,
      });
      if (result.ok) {
        setStatusMsg({ type: "ok", text: getLabels().msg_reopen_done });
        await loadData();
      } else {
        setStatusMsg({ type: "error", text: result.error });
      }
    } catch (error) {
      setStatusMsg({
        type: "error",
        text: error instanceof MonthClosedError
          ? getLabels().msg_month_closed_write_blocked
          : error instanceof Error ? error.message : "خطأ غير معروف",
      });
    }
  }

  // Batch B: employee self-service reopen. Branches on canReopenInstant — either
  // applies immediately or files a pending request routed to a supervisor.
  async function handleRequestReopen(entry: DistributionEntry, reason: string): Promise<void> {
    if (!selMonth) return;
    try {
      const result = await submitReopenRequest({
        directoryHandle,
        monthFolderName: selMonth,
        employeeUsername: entry.assignedTo,
        xrayImageId: entry.xrayImageId,
        assignedTo: entry.assignedTo,
        requestedBy: username,
        requestedByRole: role,
        reason,
        instant: canReopenInstant,
      });
      if (result.ok) {
        setSelEntryId(null);
        setStatusMsg({
          type: "ok",
          text: result.mode === "instant" ? getLabels().msg_reopen_done : getLabels().msg_reopen_request_sent,
        });
        await loadData();
      } else {
        setStatusMsg({ type: "error", text: result.error });
      }
    } catch (error) {
      setStatusMsg({
        type: "error",
        text: error instanceof MonthClosedError
          ? getLabels().msg_month_closed_write_blocked
          : error instanceof Error ? error.message : "خطأ غير معروف",
      });
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
        // Freshness re-check (mirror approveReferral): the rendered candidate
        // list can be seconds stale on a shared folder. Reload the live state
        // and confirm (a) the dead row is still owned by the same employee and
        // still replacement-eligible, and (b) the chosen replacement is not
        // already sampled or owned — otherwise a concurrent action already used
        // one side and committing would double-assign / orphan.
        const freshSample = await loadSampleMaster(directoryHandle, selMonth);
        const freshRows = (freshSample?.rows ?? []) as PreparedPopulationRow[];
        const freshDist = await loadOrDeriveDistributionCurrent(directoryHandle, selMonth, freshRows);
        const STALE_MSG = "البيانات تغيّرت، حدّث الصفحة";

        const freshDead = freshDist?.entries.find((e) => e.xrayImageId === entry.xrayImageId);
        const deadStillEligible =
          !!freshDead &&
          freshDead.assignedTo === entry.assignedTo &&
          (freshDead.status === "pending" || freshDead.status === "replacement-requested");

        const replacementTaken =
          freshRows.some((r) => r.xrayImageId === replacement.xrayImageId) ||
          (freshDist?.entries.some((e) => e.xrayImageId === replacement.xrayImageId) ?? false);

        if (!deadStillEligible || replacementTaken) {
          setReplacementError(STALE_MSG);
          setStatusMsg({ type: "error", text: STALE_MSG });
          await loadData();
          return;
        }

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

  // LOG-03: memoized — an unstable identity here makes DataTable's filteredRows
  // memo recompute every render and re-emit onFilteredRowsChange.
  const rowMatchesFilter = useCallback((
    entry: DistributionEntry,
    colId: string,
    filter: AnyFilter
  ): boolean | null => {
    if (colId !== "answerStatus" || filter.kind !== "status") return null;
    const v = filter.value;
    if (!v || v === "all") return true;
    if (entry.status === "replaced") return v === "replaced";
    const answer = answersMap.get(`${entry.xrayImageId}::${entry.assignedTo}`);
    const s = answer?.status;
    if (v === "submitted") return s === "submitted";
    if (v === "pending")   return !s || s === "draft";
    return true;
  }, [answersMap]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <section className="ew-page" dir="rtl">
      <PageHeader
        eyebrow={L.page_xray_referrals_eyebrow}
        title={L.page_xray_referrals_title}
        subtitle={canSeeAll ? L.page_xray_referrals_subtitle_all : L.page_xray_referrals_subtitle_own}
      >
        <QueueToolbar
          labels={L}
          templates={tplIndex}
          selectedTemplateId={selTplId}
          activeTemplate={activeTpl}
          canSetTemplate={canSetTemplate}
          onTemplateChange={(id) => { void handleTplSelect(id); }}
          onReloadTemplate={() => { if (selTplId) void applyTemplate(selTplId, false); }}
        />
      </PageHeader>

      {statusMsg && (
        <div className={statusMsg.type === "ok" ? "ew-msg-ok" : "ew-msg-error"} role="status">
          {statusMsg.text}
          <button
            type="button"
            aria-label="إغلاق"
            style={{ float: "left", background: "none", border: "none", cursor: "pointer" }}
            onClick={() => setStatusMsg(null)}
          ><X size={14} /></button>
        </div>
      )}

      {loadState === "loading" && <p className="ew-empty">جاري التحميل...</p>}
      {loadState === "error"   && <p className="ew-empty">تعذر تحميل البيانات.</p>}

      {(loadState === "ready" || loadState === "idle") && (() => {
        const selectableVisibleIds = filteredTableEntries
          .filter((e) => e.status !== "replaced")
          .map((e) => e.xrayImageId);
        const showSelectionBar =
          !canSeeAll &&
          canSubmitReferrals &&
          entries.length > 0 &&
          selectedIds.size > 0;
        const tableEl = (
          <div className="ew-ref-queue">
            {showSelectionBar && (
              <SelectionActionBar
                selectedCount={selectedIds.size}
                visibleCount={selectableVisibleIds.length}
                onReferSelected={() => {
                  if (selectedIds.size === 0) return;
                  setReferralModal({ xrayImageIds: [...selectedIds], source: "selected" });
                }}
                onSelectVisible={() => selectAll(selectableVisibleIds)}
                onClear={clearSelection}
              />
            )}
            <DataTable<DistributionEntry>
              columns={columns}
              rows={displayEntries}
              getRowKey={(e) => e.xrayImageId}
              renderCell={renderCell}
              storageKey={COL_KEY}
              defaultVisible={DEFAULT_VISIBLE}
              density="compact"
              stickyColumnIds={canSeeAll ? ["xrayImageId", "answerStatus"] : [SELECT_COL_ID, "xrayImageId", "answerStatus"]}
              isAdmin={canSeeAll}
              canConfigureColumns={canConfigureColumns}
              initialColConfig={colPreset}
              onColConfigChange={(cfg) => {
                setColPreset(cfg);
                const preset = {
                  columnOrder:    cfg.order,
                  visibleColumns: baseColumns.map((c) => c.id).filter((id) => !cfg.hidden.includes(id)),
                  widths:         cfg.widths,
                  dateFmt:        cfg.dateFmt,
                };
                // Every user persists their own personal layout (isolated).
                void saveUserBrowseDatasetPreset(directoryHandle, username, REFERRALS_PRESET_KEY, preset);
                // Admins/permitted users additionally update the shared default.
                if (canConfigureColumns) {
                  void saveAdminBrowseDatasetPreset(directoryHandle, REFERRALS_PRESET_KEY, preset);
                }
              }}
              rowMatchesFilter={rowMatchesFilter}
              onFilteredRowsChange={setFilteredTableEntries}
              exportFileName={`صور الأشعة المحالة - ${selMonth || "كل الأشهر"}.xlsx`}
              expandedKey={selEntryId}
              onRowClick={(e) => setSelEntryId(e.xrayImageId)}
              getRowClassName={(entry) =>
                isStudyCompleted(entry, answersMap) ? "dt-tr--completed" : undefined
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
                      المحالة لي
                    </button>
                  </div>
                ) : undefined
              }
            />
          </div>
        );

        return (
          <div className="ew-ref-workspace">
            <ReferralStatsStrip stats={personalStats} quota={myQuota} username={username} />
            <div className={`ew-split ew-split--right${selEntry ? "" : " ew-split--empty"}`}>
              {tableEl}
              {selEntry ? (
                <SampleDetailPanel
                  entry={selEntry}
                  template={activeTpl}
                  savedAnswer={selAnswer}
                  readonly={canSeeAll && selEntry.assignedTo !== username}
                  onClose={() => setSelEntryId(null)}
                  onSave={(ans, submit) =>
                    handleSave(selEntry.xrayImageId, ans, submit, selEntry.assignedTo)
                  }
                  onReplace={
                    (canRequestReplacement || canSubmitReferrals) && selEntry.assignedTo === username && selEntry.status === "pending"
                      ? openReplacementDialog
                      : undefined
                  }
                  onReassign={
                    canSubmitReferrals && selEntry.assignedTo === username && selEntry.status === "pending"
                      ? (entry) => setReferralModal({ xrayImageIds: [entry.xrayImageId], source: "selected" })
                      : undefined
                  }
                  onReopen={
                    canReopenAnswer
                      // eslint-disable-next-line react-hooks/refs -- handleReopenAnswer's post-write loadData() bumps loadTokenRef.current inside an event-handler call chain, never during render
                      ? (reason) => { void handleReopenAnswer(selEntry, reason); }
                      : undefined
                  }
                  onRequestReopen={
                    selEntry.assignedTo === username
                      // eslint-disable-next-line react-hooks/refs -- see onReopen above; handleRequestReopen's loadData() call is the same pattern
                      ? (reason) => { void handleRequestReopen(selEntry, reason); }
                      : undefined
                  }
                />
              ) : (
                <div className="ew-ref-empty-panel">
                  <strong>اختر عينة لعرض التفاصيل</strong>
                  <span>اضغط على أي صف في القائمة لفتح نموذج الفحص والإجراءات.</span>
                </div>
              )}
            </div>
          </div>
        );
      })()}

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

function QueueToolbar({
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

function SelectionActionBar({
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

function SampleDetailPanel({
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
  onSave: (ans: FieldAnswer[], submit: boolean) => Promise<void>;
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
  return <span className="ew-status-badge ew-badge-pending">{labels.status_pending}</span>;
}

function ReferralStatsStrip({
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

function isStudyCompleted(
  entry: DistributionEntry,
  answersMap: Map<string, ItemAnswer>
): boolean {
  if (entry.status === "completed") return true;
  return answersMap.get(`${entry.xrayImageId}::${entry.assignedTo}`)?.status === "submitted";
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
  const dialogRef = useFocusTrap<HTMLDivElement>({ onEscape: onClose });
  const rows = tab === "recommended" ? state.recommended : state.all;
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

