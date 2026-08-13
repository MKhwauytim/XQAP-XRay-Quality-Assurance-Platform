import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { readSession } from "../../../../../auth/authSession";
import { usePermissions } from "../../../../../auth/usePermissions";
import { PageHeader } from "../../../../../components/PageHeader/PageHeader";
import { logError, logRejection } from "../../../../../data/storage/errorLogger";
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
  loadOrDeriveDistributionCurrentForRead,
} from "../../../../../data/distribution/distributionStorage";
import { subscribeToDataRefresh } from "../../../../../data/workspace/dataRefreshSignal";
import {
  registerBootSources,
  markBootSourceLoading,
  markBootSourceLoaded,
  markBootSourceError,
} from "../../../../../data/workspace/bootProgress";
import type { DistributionEntry } from "../../../../../data/distribution/distributionTypes";
import {
  executeReplacement,
} from "../../../../../data/distribution/replacement";
import { executeBulkReassignment } from "../../../../../data/distribution/bulkAssignment";
import { getReplacementCandidatesIndexed } from "../../../../../data/distribution/replacementCandidateLookup";
import { loadMonthPopulationFinal } from "../../../../../data/population/populationStorage";
import type { ReplacementIndexRow } from "../../../../../data/population/replacementIndexTypes";
import { loadPopulationConfig, type StageAliasMappings } from "../../../../../data/population/populationConfig";
import { useGlobalMonth } from "../../../../../data/month/useGlobalMonth";
import {
  loadSampleMaster,
} from "../../../../../data/sampling/sampleStorage";
import { loadEmployeeSampleMirror } from "../../../../../data/samples/sampleMirrorStorage";
import type { SampleMasterData } from "../../../../../data/sampling/sampleTypes";
import {
  loadAdhocEntriesForEmployeeView,
  type AdhocDistributionEntry,
} from "../../../../../data/adhocImport/adhocImportEmployeeView";
import { monthFolderForEntry } from "../../../../../data/adhocImport/adhocImportEmployeeView";
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
  getPendingReplacementIds,
  loadReferralLog,
  loadReplacementLog,
} from "../../../../../data/referral/referralStorage";
import { submitReopenRequest } from "../../../../../data/referral/requestReopen";
import type { ReferralRequest, ReplacementRequest } from "../../../../../data/referral/referralTypes";
import { useLabels } from "../../../../../data/labels/useLabels";
import { formatStageLabel } from "../../../../../data/population/stageHelpers";
import type { PreparedPopulationRow } from "../../../../../data/population/populationTypes";
import {
  QueueToolbar,
  SelectionActionBar,
  BulkReassignSelectionBar,
  BulkReassignModal,
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
  recommended: ReplacementIndexRow[];
  all: ReplacementIndexRow[];
} | null;
type ReferralModalState = {
  /** IDs to transfer. Always manually selected (single-row "reassign" action or
   * the personal multi-select bar) — this flow has no "everything currently
   * filtered" entry point, unlike BulkReassignModalState below. */
  xrayImageIds: string[];
} | null;

// Exported so subComponents.tsx's BulkReassignModal can `import type` it back.
export type BulkReassignModalState = {
  /** IDs to reassign — either manually selected or every row currently
   * matching the active filter/search (all pages, not just the visible one). */
  xrayImageIds: string[];
  source: "selected" | "filtered";
  /** Idempotency key, stable across retries of the same confirm click so a
   * partial-failure retry never re-emits reassignment events already durably
   * written for this batch (see executeBulkReassignment's replay guard). */
  sourceRequestId: string;
} | null;

// Task 6: rows with an outstanding referral/replacement request, or that were
// actually replaced, are no longer hidden from the queue — they're shown with
// a distinct color instead. Pure helper (no closure state beyond its params),
// so it lives at module scope alongside the other pure helpers in this file.
function rowStatusClass(
  entry: DistributionEntry,
  pendingReferralIds: Set<string>,
  pendingReplacementIds: Set<string>
): string | undefined {
  if (entry.status === "replaced") return "dt-tr--resolved";
  if (pendingReferralIds.has(entry.xrayImageId) || pendingReplacementIds.has(entry.xrayImageId)) {
    return "dt-tr--pending";
  }
  return undefined;
}

type BootSourceDescriptor = { key: string; labelEn: string; labelAr: string };

/**
 * Named on-disk sources `loadData`'s single fetch pass below actually reads
 * for this user -- feeds the post-login boot-progress checklist
 * (`src/data/workspace/bootProgress.ts`) so a viewer can see which real files
 * this landing sub-tab's own load touched. Pure reporting: it never changes
 * what `loadData` fetches. `referrals_requests` covers BOTH `loadReferralLog`
 * and `loadReplacementLog` -- they read the exact same underlying per-employee
 * `*.answers.json` (referralRequests/replacementRequests live on
 * `EmployeeAnswerFile`, see answerStorage.ts) and per-supervisor
 * `*.decisions.json` files, just folded differently, so representing them as
 * two separate "loading" entries would misrepresent them as distinct reads.
 * Its `labelEn` names both current on-disk folders relative to the month's
 * sample root -- `2-samples/{month}/2-employees/` (getSampleEmployeeDir, via
 * answerStorage.ts's loadAllEmployeeFiles) and `2-samples/{month}/3-approvals/`
 * (getSampleApprovalsDir, via approvalStorage.ts's loadAllSupervisorDecisions),
 * per workspacePaths.ts's SAMPLE_SUBFOLDERS. Both have unnumbered legacy
 * fallbacks the loaders still read; the label names the current layout.
 * `referrals_sample_mirror` is only included for personal-scope users
 * (`!canSeeAll`) -- oversight users never call `loadEmployeeSampleMirror`
 * (see loadData below), matching that same branch exactly.
 */
function referralsBootSources(username: string, canSeeAll: boolean): BootSourceDescriptor[] {
  return [
    { key: "referrals_sample_master", labelEn: "sample.master.json", labelAr: "العينة الرئيسية" },
    {
      key: "referrals_requests",
      labelEn: "2-employees/*.answers.json + 3-approvals/*.decisions.json",
      labelAr: "طلبات الإحالة والاستبدال",
    },
    { key: "referrals_distribution", labelEn: "distribution.current.json", labelAr: "توزيع العينات" },
    ...(canSeeAll
      ? []
      : [{ key: "referrals_sample_mirror", labelEn: `${username}.samples.json`, labelAr: "نسخة عيناتي" }]),
    { key: "referrals_answers", labelEn: `${username}.answers.json`, labelAr: "إجاباتي" },
    { key: "referrals_adhoc", labelEn: "adhoc-imports.index.json", labelAr: "الاستيرادات اليدوية" },
  ];
}

/** True for a row assigned through an ad-hoc import rather than the real
 *  monthly sampling pipeline — see `adhocImportEmployeeView.ts`. */
function isAdhocEntry(entry: DistributionEntry): entry is AdhocDistributionEntry {
  return typeof (entry as AdhocDistributionEntry).adhocImportId === "string";
}

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
  // Oversight-only: select rows (manually or via the active filter) and reassign
  // them to another employee in one action, going through the same distribution
  // event log as every other mutation (see executeBulkReassignment).
  const canBulkReassignReferrals = canMutate("bulk-reassign-referrals");
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
  const [pendingReferralIds, setPendingReferralIds] = useState<Set<string>>(new Set());
  const [pendingReplacementIds, setPendingReplacementIds] = useState<Set<string>>(new Set());
  const [tplIndex, setTplIndex]     = useState<Array<{ templateId: string; templateName: string; version: number }>>([]);
  const [selTplId, setSelTplId]     = useState("");
  const [activeTpl, setActiveTpl]   = useState<TemplateSchema | null>(null);
  const [answers, setAnswers]       = useState<ItemAnswer[]>([]);
  const [selEntryId, setSelEntryId] = useState<string | null>(null);
  const [statusMsg, setStatusMsg]   = useState<StatusMsg>(null);
  const [stageMappings, setStageMappings] = useState<StageAliasMappings | undefined>(undefined);
  const [sampleMaster, setSampleMaster] = useState<SampleMasterData | null>(null);
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
  const [bulkReassignModal, setBulkReassignModal] = useState<BulkReassignModalState>(null);
  const [bulkReassignBusy, setBulkReassignBusy] = useState(false);
  const [bulkReassignError, setBulkReassignError] = useState<string | null>(null);

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

  // O(1) entry lookup by xrayImageId — built once per `entries` change instead
  // of an `entries.find()` per selected id (was O(n×m): every id in a
  // referral/bulk-reassign selection re-scanned the full entries array).
  const entriesById = useMemo(() => new Map(entries.map((e) => [e.xrayImageId, e])), [entries]);

  /**
   * The workspace folder that owns a given row's writes.
   *
   * This view renders the union of the selected month's entries and every
   * ad-hoc import's entries, and those live in different stores. Every write
   * (answer, referral/replacement/reopen request, and the fresh pre-write read
   * that guards against double-assignment) must target the store the row
   * actually came from — routing on the ROW, never on the globally-selected
   * month. Writing an ad-hoc row into the real month would contaminate a real
   * audit trail with an unrelated population; the reverse would silently lose
   * the write.
   *
   * Falls back to the selected month for an unknown id, which is the correct
   * conservative default: a real row is the only thing that can be missing from
   * `entriesById` while still being actionable.
   */
  const folderForRow = useCallback((xrayImageId: string): string => {
    const entry = entriesById.get(xrayImageId);
    return entry && selMonth ? monthFolderForEntry(entry, selMonth) : (selMonth ?? "");
  }, [entriesById, selMonth]);

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
    // Checkbox column: personal-scope users always get it (referral requests);
    // oversight (canSeeAll) users get it only when permitted to bulk-reassign —
    // otherwise they have no selection-driven action to take on it. The
    // accessor returns a stable empty string; actual checked state is read from
    // selectedIds inside renderCell so this memo doesn't re-create on every checkbox tick.
    if (canSeeAll && !canBulkReassignReferrals) return mapped;
    const selectCol: DataTableCol<DistributionEntry> = {
      id: SELECT_COL_ID,
      label: "",
      widthFr: 3,
      alwaysVisible: true,
      accessor: () => "",
    };
    return [selectCol, ...mapped];
  }, [baseColumns, stageMappings, canSeeAll, canBulkReassignReferrals, answersMap]);

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
  // Boot-progress reporting: only the very first data-fetching pass of this
  // component's lifetime reports to the post-login checklist (bootProgress.ts)
  // -- every later call (a real month switch, which also re-runs the mount
  // effect below since loadData's identity changes with selMonth; the
  // post-action reloads inside handleReopenAnswer/handleRequestReopen, which
  // pass no options and are therefore non-silent too; and every
  // `{ silent: true }` background/action refresh) must never re-flicker a
  // checklist the user is already long past.
  const bootReportedRef = useRef(false);

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
      setSelEntryId(null);
      setSelectedIds(new Set());
      setLoadState("ready");
    }
  }, [selMonth]);

  const loadData = useCallback(async (opts?: { silent?: boolean }) => {
    // Invalidate any in-flight load first — even the no-month early return must
    // stale older loads, or a truthy→"" selMonth transition would let an in-flight
    // load commit stale rows over the empty-ready state.
    const token = ++loadTokenRef.current;
    if (!selMonth) return;
    // `silent` is set only by the background/manual data-refresh signal below, never
    // by a real month/user change. Flipping loadState to "loading" unmounts the whole
    // detail-panel block (see the `loadState === "ready" || "idle"` render gate further
    // down), and clearing selEntryId/selectedIds drops whatever selection was active —
    // together they force-close an employee's open inspection form and, with it, any
    // in-progress answer draft InspectionPanel is holding in local state but hasn't
    // saved yet. A silent refresh must re-fetch and swap the underlying rows in place
    // while leaving the current selection and panel mounted.
    const silent = opts?.silent ?? false;
    const isInitialLoad = !bootReportedRef.current;
    if (isInitialLoad) bootReportedRef.current = true;
    const bootSources = isInitialLoad ? referralsBootSources(username, canSeeAll) : [];
    if (isInitialLoad) {
      registerBootSources(bootSources);
      bootSources.forEach((source) => markBootSourceLoading(source.key));
    }
    if (!silent) {
      setLoadState("loading");
      setSelEntryId(null);
      setSelectedIds(new Set());
    }
    try {
      // Load sample.master first — its rows are the only ones needed for the
      // distribution derivation. population.final.json is NOT loaded here;
      // it is loaded lazily only when the replacement dialog opens.
      const [sample, referralLog, replacementLog, adhocEntries] = await Promise.all([
        loadSampleMaster(directoryHandle, selMonth),
        loadReferralLog(directoryHandle, selMonth),
        loadReplacementLog(directoryHandle, selMonth),
        // THE GAP fix: ad-hoc-imported assignments live in a synthetic
        // `2-samples/adhoc-{importId}/` folder, never the selected month's own
        // sample.master.json — merged in here so an employee can see them
        // alongside their real assignments. Degrades to [] on any failure; see
        // adhocImportEmployeeView.ts's docblock for the cost bound.
        loadAdhocEntriesForEmployeeView(directoryHandle, username, canSeeAll).catch((err) => {
          logError("xrayReferrals:loadAdhocEntries", err);
          return [];
        }),
      ]);
      const sampleRows = (sample?.rows ?? []) as PreparedPopulationRow[];
      const dist = await loadOrDeriveDistributionCurrentForRead(directoryHandle, selMonth, sampleRows);
      const personalMirror = canSeeAll
        ? null
        : await loadEmployeeSampleMirror(directoryHandle, selMonth, username);
      const all = [...(dist?.entries ?? personalMirror?.entries ?? []), ...adhocEntries];

      const pendingReferralIds = canSeeAll ? new Set<string>() : getPendingReferralIds(referralLog, username);
      const pendingReplacementIds = canSeeAll ? new Set<string>() : getPendingReplacementIds(replacementLog, username);

      // No longer excludes pending/replaced rows — they're shown with a
      // distinct color instead (see rowStatusClass below, wired into
      // getRowClassName in the render). Only the assignedTo/canSeeAll scoping
      // remains a real filter.
      const visible = canSeeAll
        ? all
        : all.filter((e) => e.assignedTo === username);

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

      // Staleness check FIRST: a superseded load must not touch the shared
      // boot-progress store at all -- marking its keys "loaded" would show
      // the checklist ticking off sources the newer, still-pending load is
      // about to re-read from scratch.
      if (token !== loadTokenRef.current) return; // superseded by a newer month selection

      if (isInitialLoad) bootSources.forEach((source) => markBootSourceLoaded(source.key));

      setAllEntries(all);
      setEntries(visible);
      setPendingReferralIds(pendingReferralIds);
      setPendingReplacementIds(pendingReplacementIds);
      setSampleMaster(sample);
      setMyQuota(quota);
      setAnswers(answerItems);
      setLoadState("ready");
    } catch (err) {
      // Staleness check FIRST, mirroring the success path above: a
      // superseded load's rejection must not touch the shared boot-progress
      // store either -- it would show a false failure on keys the newer,
      // still-pending load has already re-registered and is midway through
      // re-loading fresh.
      if (isInitialLoad && token === loadTokenRef.current) {
        const message = err instanceof Error ? err.message : String(err);
        bootSources.forEach((source) => markBootSourceError(source.key, message));
      }
      if (token !== loadTokenRef.current) return;
      // A silent background refresh must not force-close an open inspection form on
      // a transient read hiccup — log it for observability and leave the current
      // selection/panel exactly as it was; the next successful refresh (or manual
      // navigation) will recover the data.
      if (silent) {
        logError("xrayReferrals:loadData:silentRefresh", err);
        return;
      }
      setLoadState("error");
    }
  }, [directoryHandle, selMonth, username, canSeeAll]);
  /* eslint-enable react-hooks/preserve-manual-memoization */

  // eslint-disable-next-line react-hooks/set-state-in-effect -- async data load; setState fires inside loadData's async callback, not synchronously in the effect body
  useEffect(() => { void loadData(); }, [loadData]);

  // Re-fetch on the app-wide refresh signal (manual toolbar button + 5-minute
  // auto-refresh) so a referral/reassignment made by someone else -- or on
  // another machine -- shows up without navigating away and back. Passed silently
  // so it never force-closes an employee's currently open inspection form (see the
  // `silent` handling inside loadData above).
  useEffect(() => subscribeToDataRefresh(() => { void loadData({ silent: true }); }), [loadData]);

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
      const result = await upsertItemAnswer(directoryHandle, folderForRow(xrayImageId), forUser, item);
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
    if (!sampleMaster || !selMonth) return;
    // Reads only the matching replacement-index bucket when one exists for
    // this month, instead of the full population.final.json — falls back to
    // a full read (and rebuilds the index in the background) for months
    // processed before this index existed.
    let candidates: Awaited<ReturnType<typeof getReplacementCandidatesIndexed>>;
    try {
      candidates = await getReplacementCandidatesIndexed(
        directoryHandle, selMonth, entry, sampleMaster, allEntries, stageMappings, username
      );
    } catch (error) {
      logError("xrayReferrals:getReplacementCandidatesIndexed", error);
      candidates = { recommended: [], all: [] }; // dialog will show empty candidates gracefully
    }
    setReplacementError(null);
    setReplacementDialog({ entry, ...candidates });
  }

  async function handleReplace(
    entry: DistributionEntry,
    replacement: ReplacementIndexRow,
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
        const rowFolder = folderForRow(entry.xrayImageId);
        const freshSample = await loadSampleMaster(directoryHandle, rowFolder);
        const freshRows = (freshSample?.rows ?? []) as PreparedPopulationRow[];
        const freshDist = await loadOrDeriveDistributionCurrent(directoryHandle, rowFolder, freshRows);
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
          await loadData({ silent: true });
          return;
        }

        // The candidate list only ever carries the slim replacement-index
        // projection (see replacementIndexTypes.ts) — the sample master needs
        // the FULL population row, so resolve it here by id. This is the one
        // full-population read on the immediate-replace path, and it's paid
        // for exactly one row (the chosen candidate), never the whole pool.
        const population = await loadMonthPopulationFinal(directoryHandle, selMonth);
        const fullReplacementRow = (population?.rows ?? []).find(
          (r) => (r as PreparedPopulationRow).xrayImageId === replacement.xrayImageId
        ) as PreparedPopulationRow | undefined;
        if (!fullReplacementRow) {
          setReplacementError(STALE_MSG);
          setStatusMsg({ type: "error", text: STALE_MSG });
          await loadData({ silent: true });
          return;
        }

        // Immediate replacement — no approval needed.
        const result = await executeReplacement({
          directoryHandle,
          monthFolderName: selMonth,
          deadEntry: entry,
          replacementRow: fullReplacementRow,
          reason,
          eventBy: username,
          stageMappings,
        });
        if (!result.ok) {
          setReplacementError(result.error);
          setStatusMsg({ type: "error", text: result.error });
          return;
        }
        if (result.ok) setSampleMaster(result.updatedSample);
        setReplacementDialog(null);
        setStatusMsg({ type: "ok", text: "تم استبدال العينة وإسناد البديل." });
        // Silent: this refresh follows a successful action already reflected in
        // local state (setSampleMaster/setReplacementDialog above) — it must
        // update the underlying rows in place, not flash the loading state or
        // force-close the panel the way the periodic/manual refresh signal would
        // if it weren't passed { silent: true } either (see loadData's own
        // docblock further up).
        await loadData({ silent: true });
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
        const result = await appendReplacementRequest(directoryHandle, folderForRow(entry.xrayImageId), request);
        if (!result.ok) {
          setReplacementError(result.error);
          setStatusMsg({ type: "error", text: result.error });
          return;
        }
        setReplacementDialog(null);
        setStatusMsg({ type: "ok", text: "تم إرسال طلب الاستبدال — بانتظار موافقة المشرف." });
        // Silent for the same reason as the recommended-replacement branch above —
        // this is a background refresh after an already-successful write, not a
        // month/user change, so it must not flash the loading state or force-close
        // the currently open inspection panel.
        await loadData({ silent: true });
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
    if (!selMonth) return;
    if (xrayImageIds.length === 0) {
      // A click must never be a silent no-op: the referral modal can in
      // principle be confirmed after its underlying selection emptied out
      // from under it (e.g. a background refresh dropped the selected rows).
      setReferralModal(null);
      setStatusMsg({ type: "error", text: "لم يتبقَّ أي عينة محددة لإحالتها — تم إلغاء الطلب." });
      return;
    }
    // A referral request is ONE record covering many rows, so every row in it
    // must belong to the same store. A selection can legitimately span the real
    // month and an ad-hoc import (both render in this table), and splitting the
    // request silently would produce two records the supervisor sees as one
    // action — with a partial approval leaving half the rows in limbo. Refuse
    // the mixed case explicitly and let the user send them separately.
    const targetFolders = new Set(xrayImageIds.map(folderForRow));
    if (targetFolders.size > 1) {
      setStatusMsg({
        type: "error",
        text: "لا يمكن إحالة عينات من الشهر الحالي ومن استيراد يدوي في طلب واحد — أرسل كل مجموعة على حدة.",
      });
      return;
    }
    const referralFolder = targetFolders.values().next().value ?? selMonth;

    const request: ReferralRequest = {
      requestId: `ref-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      monthFolderName: referralFolder,
      fromEmployee: username,
      toEmployee,
      xrayImageIds,
      reason,
      requestedAt: new Date().toISOString(),
      requestedBy: username,
      status: "pending",
    };
    const result = await appendReferralRequest(directoryHandle, referralFolder, request);
    if (result.ok) {
      setReferralModal(null);
      clearSelection();
      setStatusMsg({ type: "ok", text: `تم إرسال طلب الإحالة لـ ${toEmployee} — بانتظار موافقة المشرف.` });
      // Silent — same reasoning as handleReplace's post-success reloads: this
      // follows an already-successful write, not a month/user change, so it must
      // refresh the queue in place instead of flashing the loading state or
      // force-closing whatever inspection panel is currently open.
      await loadData({ silent: true });
    } else {
      setStatusMsg({ type: "error", text: result.error });
    }
  }

  // ── Bulk reassignment handler (oversight roles) ────────────────────────────

  function openBulkReassignModal(xrayImageIds: string[], source: "selected" | "filtered"): void {
    if (xrayImageIds.length === 0) {
      // A click must never be a silent no-op — both bulk-reassign buttons are
      // already `disabled` when their respective count is 0, but this guard
      // stays as defense-in-depth against a state race (e.g. the underlying
      // selection/filtered set emptying out between render and click), so it
      // must explain itself instead of doing nothing.
      setStatusMsg({
        type: "error",
        text: source === "selected"
          ? "لا توجد عينات محددة يدوياً لإعادة تعيينها."
          : "لا توجد عينات مطابقة للتصفية/البحث الحالي لإعادة تعيينها.",
      });
      return;
    }
    setBulkReassignError(null);
    setBulkReassignModal({
      xrayImageIds,
      source,
      sourceRequestId: `bulk-reassign-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    });
  }

  async function handleBulkReassignConfirm(toEmployee: string, reason: string): Promise<void> {
    // Handler-boundary check — mirrors every other mutating handler in this
    // file (render-boundary gating alone is not enough: the modal that calls
    // this could in principle be reopened from stale state).
    if (!canBulkReassignReferrals) {
      setBulkReassignError("لا تملك صلاحية إعادة التعيين الجماعي، أو أن مساحة العمل للقراءة فقط.");
      return;
    }
    if (!bulkReassignModal || !selMonth) return;
    setBulkReassignBusy(true);
    setBulkReassignError(null);
    try {
      const result = await executeBulkReassignment({
        directoryHandle,
        monthFolderName: selMonth,
        xrayImageIds: bulkReassignModal.xrayImageIds,
        reassignedTo: toEmployee,
        eventBy: username,
        reason: reason || undefined,
        sourceRequestId: bulkReassignModal.sourceRequestId,
      });
      if (!result.ok) {
        // Keep the modal open with the same sourceRequestId — a retry only
        // re-emits whatever this attempt did not durably write (see
        // executeBulkReassignment's replay guard), so re-clicking "confirm" is
        // always safe.
        setBulkReassignError(result.error ?? "حدث خطأ غير متوقع أثناء إعادة التعيين.");
        return;
      }
      const appliedTotal = result.appliedIds.length + result.alreadyAppliedIds.length;
      const skippedTotal = result.skipped.length;
      setBulkReassignModal(null);
      clearSelection();
      setStatusMsg({
        type: "ok",
        text: skippedTotal > 0
          ? `تم إعادة تعيين ${appliedTotal} عينة إلى ${toEmployee} — تم تخطي ${skippedTotal} عينة (راجع ملخص الحوار السابق لسبب كل حالة).`
          : `تم إعادة تعيين ${appliedTotal} عينة إلى ${toEmployee}.`,
      });
      // Silent — follows an already-successful write, not a month/user change;
      // must refresh the queue in place rather than flashing the loading state.
      await loadData({ silent: true });
    } catch (error) {
      setBulkReassignError(
        error instanceof MonthClosedError
          ? getLabels().msg_month_closed_write_blocked
          : error instanceof Error ? error.message : "خطأ غير معروف"
      );
    } finally {
      setBulkReassignBusy(false);
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
      return (
        <span className="dt-mono ew-xray-id-cell">
          {entry.xrayImageId}
          {isAdhocEntry(entry) && (
            <span className="ew-adhoc-badge" title={`${L.badge_adhoc_import_title}: ${entry.adhocFileName}`}>
              {L.badge_adhoc_import}
            </span>
          )}
        </span>
      );
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
        // True whenever the `columns` memo actually prepended the select-checkbox
        // column (personal-scope users always; oversight users only when permitted
        // to bulk-reassign — see the `columns` memo above).
        const hasSelectColumn = columns[0]?.id === SELECT_COL_ID;
        // Bug fix: SELECT_COL_ID is `alwaysVisible: true`, but DataTable's own
        // default-column-config builder (used whenever no saved preset exists yet —
        // i.e. every first-time user) only marks a column visible if its id is in
        // `defaultVisible`; `alwaysVisible` only affects column ORDER, not whether
        // it's filtered out of `visibleCols`. DEFAULT_VISIBLE never listed the select
        // column, so on a fresh workspace the checkbox column was silently hidden for
        // BOTH the personal referral-selection flow and this new oversight bulk-reassign
        // flow until a user happened to open "الأعمدة" and turn it on manually — a real
        // contributor to the reported "not able to do that" gap.
        const defaultVisibleCols = hasSelectColumn ? [SELECT_COL_ID, ...DEFAULT_VISIBLE] : DEFAULT_VISIBLE;
        const selectableVisibleIds = filteredTableEntries
          .filter((e) => e.status !== "replaced")
          .map((e) => e.xrayImageId);
        const showSelectionBar =
          !canSeeAll &&
          canSubmitReferrals &&
          entries.length > 0 &&
          selectedIds.size > 0;
        const showBulkReassignBar =
          canSeeAll &&
          canBulkReassignReferrals &&
          entries.length > 0;
        const tableEl = (
          <div className="ew-ref-queue">
            {showSelectionBar && (
              <SelectionActionBar
                selectedCount={selectedIds.size}
                visibleCount={selectableVisibleIds.length}
                onReferSelected={() => {
                  // Defense-in-depth: the button is already `disabled` when
                  // selectedIds is empty, but a click must never be a silent
                  // no-op if it's somehow reached anyway.
                  if (selectedIds.size === 0) {
                    setStatusMsg({ type: "error", text: "لا توجد عينات محددة يدوياً لإحالتها." });
                    return;
                  }
                  setReferralModal({ xrayImageIds: [...selectedIds] });
                }}
                onSelectVisible={() => selectAll(selectableVisibleIds)}
                onClear={clearSelection}
              />
            )}
            {showBulkReassignBar && (
              <BulkReassignSelectionBar
                selectedCount={selectedIds.size}
                filteredCount={selectableVisibleIds.length}
                onReassignSelected={() => openBulkReassignModal([...selectedIds], "selected")}
                onReassignFiltered={() => openBulkReassignModal(selectableVisibleIds, "filtered")}
                onSelectAllFiltered={() => selectAll(selectableVisibleIds)}
                onClear={clearSelection}
              />
            )}
            <DataTable<DistributionEntry>
              columns={columns}
              rows={displayEntries}
              getRowKey={(e) => e.xrayImageId}
              renderCell={renderCell}
              storageKey={COL_KEY}
              defaultVisible={defaultVisibleCols}
              density="compact"
              stickyColumnIds={hasSelectColumn ? [SELECT_COL_ID, "xrayImageId", "answerStatus"] : ["xrayImageId", "answerStatus"]}
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
                isStudyCompleted(entry, answersMap)
                  ? "dt-tr--completed"
                  : rowStatusClass(entry, pendingReferralIds, pendingReplacementIds)
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
                  readonly={!canSubmitAnswers || (canSeeAll && selEntry.assignedTo !== username)}
                  onClose={() => setSelEntryId(null)}
                  onSave={(ans) =>
                    handleSave(selEntry.xrayImageId, ans, selEntry.assignedTo)
                  }
                  onReplace={
                    canRequestReplacement && selEntry.assignedTo === username && selEntry.status === "pending"
                      ? openReplacementDialog
                      : undefined
                  }
                  onReassign={
                    canSubmitReferrals && selEntry.assignedTo === username && selEntry.status === "pending"
                      ? (entry) => setReferralModal({ xrayImageIds: [entry.xrayImageId] })
                      : undefined
                  }
                  onReopen={
                    canReopenAnswer
                      // eslint-disable-next-line react-hooks/refs -- handleReopenAnswer's post-write loadData() bumps loadTokenRef.current inside an event-handler call chain, never during render
                      ? (reason) => { void handleReopenAnswer(selEntry, reason); }
                      : undefined
                  }
                  onRequestReopen={
                    canSubmitAnswers && selEntry.assignedTo === username
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
            .map((id) => entriesById.get(id))
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

      {bulkReassignModal ? (
        <BulkReassignModal
          state={bulkReassignModal}
          entries={entries}
          currentUser={username}
          busy={bulkReassignBusy}
          error={bulkReassignError}
          onClose={() => {
            if (bulkReassignBusy) return;
            setBulkReassignModal(null);
            setBulkReassignError(null);
          }}
          onConfirm={(toEmployee, reason) => { void handleBulkReassignConfirm(toEmployee, reason); }}
        />
      ) : null}
    </section>
  );
}
