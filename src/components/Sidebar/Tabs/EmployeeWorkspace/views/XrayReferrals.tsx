import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { readSession } from "../../../../../auth/authSession";
import { usePermissions } from "../../../../../auth/usePermissions";
import { PageHeader } from "../../../../../components/PageHeader/PageHeader";
import { logRejection } from "../../../../../data/storage/errorLogger";
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
  type AnyFilter,
} from "../../../../../components/DataTable/utils";
import {
  loadAdminBrowsePreset,
  loadUserBrowsePreset,
  saveAdminBrowseDatasetPreset,
  saveUserBrowseDatasetPreset,
} from "../../../../../data/preferences/browsePresetStorage";
import {
  appendReferralRequest,
  appendReplacementRequest,
  getPendingReferralIds,
  loadReferralLog,
} from "../../../../../data/referral/referralStorage";
import { submitReopenRequest } from "../../../../../data/referral/requestReopen";
import type { ReferralRequest, ReplacementRequest } from "../../../../../data/referral/referralTypes";
import { useLabels } from "../../../../../data/labels/useLabels";
import { formatStageLabel } from "../../Population/components/helpers";
import type { PreparedPopulationRow } from "../../Population/processing/populationProcessingTypes";
import {
  QueueToolbar,
  SelectionActionBar,
  SampleDetailPanel,
  ReferralRequestModal,
  StatusBadge,
  ReferralStatsStrip,
  ReplacementDialog,
  SELECT_COL_ID,
  DEFAULT_VISIBLE,
  buildXrayColumns,
  buildDefaultColConfig,
  loadLocalColConfig,
  getVisibleReferralColumns,
  pct,
  isStudyCompleted,
} from "./XrayReferrals/subComponents";

// ── Column definitions ────────────────────────────────────────────────────────

const REFERRALS_PRESET_KEY = "xray-referrals";

const COL_KEY = "xray_ref_cols_v4";

// ── Main component ────────────────────────────────────────────────────────────

type Props = { directoryHandle: DirectoryHandleLike };
type LoadState = "idle" | "loading" | "ready" | "error";
type StatusMsg = { type: "ok" | "error"; text: string } | null;
// Exported (not just used locally) so the moved ReferralStatsStrip/ReplacementDialog
// sub-components in ./XrayReferrals/subComponents.tsx can `import type` them back —
// this component's state shape itself is unchanged.
export type PersonalStats = {
  assigned: number;
  submitted: number;
  notStarted: number;
  replaced: number;
  active: number;
  completionPct: number;
};
export type PersonalQuota = { dailyQuota: number; daysRemaining: number; sampleCount: number } | null;
export type ReplacementDialogState = {
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
  const { can, canMutate } = usePermissions();
  /** Oversight view is permission-driven; ordinary users only see their own samples. */
  const canSeeAll = can("view-all-entries");
  const canSetTemplate = canMutate("manage-inspection-template");
  const canConfigureColumns = canMutate("configure-referral-columns");
  const canRequestReplacement = canMutate("request-replacement");
  const canSubmitReferrals = canMutate("submit-referrals");
  const canSubmitAnswers = canMutate("submit-answers");
  const canReopenAnswer = canMutate("ew.reopenAnswer");
  // Batch B: when enabled for this role, the employee's self-service reopen request
  // is applied instantly; when disabled it is routed to a supervisor for approval.
  const canReopenInstant = can("employee-reopen-instant");
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
    xrayImageId: string, ans: FieldAnswer[], forUser: string
  ): Promise<void> {
    // No on-disk month selected → the upsert target folder would be "" (writes
    // to the workspace root). Bail before touching disk.
    if (!canSubmitAnswers) {
      setStatusMsg({ type: "error", text: "لا تملك صلاحية تقديم الإجابات، أو أن مساحة العمل للقراءة فقط." });
      return;
    }
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
    if (!canReopenAnswer) {
      setStatusMsg({ type: "error", text: "لا تملك صلاحية إعادة فتح الإجابات، أو أن مساحة العمل للقراءة فقط." });
      return;
    }
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
    if (!canSubmitAnswers) {
      setStatusMsg({ type: "error", text: "لا تملك صلاحية طلب إعادة فتح الإجابة، أو أن مساحة العمل للقراءة فقط." });
      return;
    }
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
    if (!canRequestReplacement) {
      setStatusMsg({ type: "error", text: "لا تملك صلاحية طلب الاستبدال، أو أن مساحة العمل للقراءة فقط." });
      return;
    }
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
    if (!canRequestReplacement) {
      setStatusMsg({ type: "error", text: "لا تملك صلاحية طلب الاستبدال، أو أن مساحة العمل للقراءة فقط." });
      return;
    }
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
    if (!canSubmitReferrals) {
      setStatusMsg({ type: "error", text: "لا تملك صلاحية تقديم الإحالات، أو أن مساحة العمل للقراءة فقط." });
      return;
    }
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
                  onSave={(ans) =>
                    handleSave(selEntry.xrayImageId, ans, selEntry.assignedTo)
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
