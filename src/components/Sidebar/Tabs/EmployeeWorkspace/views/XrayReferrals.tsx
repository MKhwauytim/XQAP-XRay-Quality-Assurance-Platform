import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarOff, X } from "lucide-react";
import { readSession } from "../../../../../auth/authSession";
import { usePermissions } from "../../../../../auth/usePermissions";
import { PageHeader } from "../../../../../components/PageHeader/PageHeader";
import { EmptyState } from "../../../../../components/StateViews/StateViews";
import { logError, logRejection } from "../../../../../data/storage/errorLogger";
import { thrownErrorText, userFacingErrorText } from "../../../../../data/storage/writeErrorText";
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
  readDistributionLogStamp,
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
  classifyReplacementRowAvailability,
  executeReplacement,
} from "../../../../../data/distribution/replacement";
import { submitReassignmentRequests } from "../../../../../data/referral/submitReassignment";
import { isReassignEligible } from "../../../../../data/referral/planReassignment";
import { appendWorkspaceAction } from "../../../../../data/audit/actionLog";
import { getReplacementCandidatesIndexed } from "../../../../../data/distribution/replacementCandidateLookup";
import {
  findPopulationRowById,
  type PopulationRowLookupResult,
} from "../../../../../data/population/populationRowLookup";
import { PopulationUnreadableError } from "../../../../../data/population/populationStorage";
import type { ReplacementIndexRow } from "../../../../../data/population/replacementIndexTypes";
import { loadPopulationConfig, type StageAliasMappings } from "../../../../../data/population/populationConfig";
import { useGlobalMonth } from "../../../../../data/month/useGlobalMonth";
import {
  loadSampleMaster,
} from "../../../../../data/sampling/sampleStorage";
import { loadEmployeeSampleMirror } from "../../../../../data/samples/sampleMirrorStorage";
import type { SampleMasterData } from "../../../../../data/sampling/sampleTypes";
import {
  loadAdhocAnswerItems,
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
  appendReplacementRequest,
  getPendingReferralIds,
  getPendingReplacementIds,
  loadReferralLog,
  loadReplacementLog,
} from "../../../../../data/referral/referralStorage";
import { submitReopenRequest } from "../../../../../data/referral/requestReopen";
import type { ReplacementRequest } from "../../../../../data/referral/referralTypes";
import { useLabels } from "../../../../../data/labels/useLabels";
import { formatStageLabel } from "../../../../../data/population/stageHelpers";
import type { PreparedPopulationRow } from "../../../../../data/population/populationTypes";
import {
  QueueToolbar,
  ReassignSelectionBar,
  ReassignModal,
  SampleDetailPanel,
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
// Exported so subComponents.tsx's ReassignModal can `import type` it back.
export type ReassignModalState = {
  /** IDs to reassign. The three entry points differ ONLY in how this list is
   * built — one sample from the inspection panel, a manual multi-select, or
   * every row currently matching the filter/search (all pages, not just the
   * visible one) — and then share one dialog, one submit path and one
   * approval. `source` is presentation/audit metadata, never behaviour. */
  xrayImageIds: string[];
  source: "single" | "selected" | "filtered";
  /** Idempotency key, stable across retries of the same confirm click so a
   * partial-failure retry never creates a second copy of a request already
   * durably written for this batch (see submitReassignmentRequests). */
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
 *
 * KNOWN IMPRECISION since the Design B step-3 inversion: this list is
 * registered BEFORE loadData knows which path it will take, and a personal
 * scope user whose mirror is current now reads neither `sample.master.json`
 * nor `distribution.current.json`. Those two keys are still reported as
 * loaded on that path. Deliberate: the checklist's contract is "the data
 * behind this source is available", which the mirror satisfies for both, and
 * the alternative -- registering sources only once the path is known --
 * would mean registering them AFTER the first await, which is exactly the
 * effect-ordering shape this area has regressed on before (v59.190-197).
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

/**
 * Start both ad-hoc reads for the load phase, without awaiting either.
 *
 * THE GAP fix: ad-hoc-imported assignments live in a synthetic
 * `2-samples/adhoc-{importId}/` folder, never the selected month's own
 * sample.master.json, so they are merged in alongside an employee's real
 * assignments. Their ANSWERS live there too — handleSave routes an ad-hoc row's
 * write through folderForRow, so reading answers for the selected month alone
 * never found them and every ad-hoc row came back unanswered after a reload.
 *
 * The answers read is CHAINED off the entries read (it needs their stores)
 * rather than awaited separately, so it still overlaps the rest of the load
 * phase. Entries degrade to [] on any failure; see adhocImportEmployeeView.ts's
 * docblock for the cost bound. Lives outside the component only to keep
 * `XrayReferrals` inside the max-lines-per-function budget.
 */
function beginAdhocReads(
  directoryHandle: DirectoryHandleLike,
  username: string,
  canSeeAll: boolean
): { entries: Promise<AdhocDistributionEntry[]>; answers: Promise<ItemAnswer[]> } {
  const entries = loadAdhocEntriesForEmployeeView(directoryHandle, username, canSeeAll).catch(
    (err) => {
      logError("xrayReferrals:loadAdhocEntries", err);
      return [] as AdhocDistributionEntry[];
    }
  );
  return {
    entries,
    answers: entries.then((list) => loadAdhocAnswerItems(directoryHandle, list)),
  };
}

/**
 * T-08 — a lookup MISS is staleness; a failed READ is not.
 *
 * `findPopulationRowById` answers `absent` only when the month genuinely has no
 * `population.final.json`. `unreadable`/`worker` mean the row may well be there
 * and this call could not see it, so telling the user "البيانات تغيّرت" would
 * report a data change that never happened — and send them looking for a row
 * that is fine.
 */
function isPopulationReadFailure(lookup: PopulationRowLookupResult): boolean {
  return !lookup.ok && lookup.reason !== "absent";
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
  // Oversight-only: select rows (manually or via the active filter) and request
  // their reassignment to another employee in one action, through the same
  // approval flow as إحالة and استبدال (see submitReassignmentRequests).
  const canBulkReassignReferrals = canMutate("bulk-reassign-referrals");
  /**
   * May this user file a reassignment (إسناد لموظف آخر) at all — from the
   * inspection panel, a manual selection, or the whole active filter? Which
   * permission answers that depends only on whose samples are in front of them:
   * an oversight user is acting on other people's work (`bulk-reassign-referrals`),
   * a personal-scope user on their own (`submit-referrals`). Beyond that the three
   * entry points are one flow, so one flag gates the selection UI for all of them —
   * previously the checkbox column could render for a personal-scope user who held
   * no referral permission, giving them a selection with no action to take on it.
   */
  const canReassignSamples = canSeeAll ? canBulkReassignReferrals : canSubmitReferrals;
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
  const [reassignModal, setReassignModal] = useState<ReassignModalState>(null);
  const [reassignBusy, setReassignBusy] = useState(false);
  const [reassignError, setReassignError] = useState<string | null>(null);

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
        : { type: "error", text: userFacingErrorText(result.error, "xrayReferrals:template-selection") }
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
    // Checkbox column: rendered exactly when the user can act on a selection —
    // the same flag that renders the selection bar, so a checkbox never appears
    // without the button that consumes it. The accessor returns a stable empty
    // string; actual checked state is read from selectedIds inside renderCell so
    // this memo doesn't re-create on every checkbox tick.
    if (!canReassignSamples) return mapped;
    const selectCol: DataTableCol<DistributionEntry> = {
      id: SELECT_COL_ID,
      label: "",
      widthFr: 3,
      alwaysVisible: true,
      accessor: () => "",
    };
    return [selectCol, ...mapped];
  }, [baseColumns, stageMappings, canReassignSamples, answersMap]);

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

  const selEntry = useMemo(
    () => selEntryId ? (displayEntries.find((e) => e.xrayImageId === selEntryId) ?? null) : null,
    [selEntryId, displayEntries]
  );

  // ── Unsaved-draft protection (P0) ──────────────────────────────────────────
  // InspectionPanel seeds its answers at mount and SampleDetailPanel keys it on
  // xrayImageId, so ANY re-pointing — or one-commit unmount — of the panel
  // destroys whatever the employee has typed but not saved. The auto-select
  // effect below used to do exactly that on an ordinary background event: a
  // supervisor reassigns the open row, the 45s sync tick re-reads the queue, the
  // row is gone from it, `selEntry` becomes null and the selection jumped to
  // displayEntries[0] — a DIFFERENT x-ray — with no warning and no message.
  // That contradicts this file's own silent-refresh contract ("a refresh must
  // never clobber unsaved local draft state").
  //
  // Two pieces, neither of them touching the load path:
  //   • dirtyEntryId      — which entry the panel has been typed into, reported
  //                         by InspectionPanel from an event handler (never an
  //                         effect), so it is known in the same commit.
  //   • lastPanelEntry    — the last entry object actually handed to the panel.
  //                         Once the row leaves `displayEntries` it exists
  //                         nowhere else, and the panel still needs it to render.
  //
  // The retention itself is DERIVED DURING RENDER, deliberately never committed
  // from an effect: an effect lands one render too late, and in that single
  // intervening commit `panelEntry` would be null, the panel would unmount, and
  // its local answer state — the very thing being protected — would already be
  // gone before the retention arrived. (Measured, not assumed: an effect-based
  // first attempt failed the regression test below with an empty input.)
  // Everything else, including every no-draft case, behaves exactly as before.
  const [dirtyEntryId, setDirtyEntryId] = useState<string | null>(null);
  // "The entry as last rendered into the panel." A ref would be the obvious
  // home for it, but every value derived from a ref read during render is a
  // lint error (react-hooks/refs) and the taint spreads through `panelEntry`
  // into the whole JSX block. This is React's documented "adjusting state
  // during render" pattern instead: the update is discarded-and-re-rendered
  // immediately, before anything commits, so — unlike an effect — it opens no
  // window in which the panel is unmounted.
  const [lastPanelEntry, setLastPanelEntry] = useState<DistributionEntry | null>(null);
  if (selEntry !== null && selEntry !== lastPanelEntry) {
    // Guarded by the identity check above, so it runs once per entry change and
    // cannot loop.
    setLastPanelEntry(selEntry);
  }

  /** The vanished-but-dirty entry the panel must keep showing, or null. */
  const retainedEntry: DistributionEntry | null =
    selEntry === null &&
    selEntryId !== null &&
    dirtyEntryId === selEntryId &&
    lastPanelEntry?.xrayImageId === selEntryId
      ? lastPanelEntry
      : null;

  /** The entry the inspection panel renders: the live one, or the retained one. */
  const panelEntry = selEntry ?? retainedEntry;
  /** True while the panel is showing a row that has left the queue. */
  const showingRetainedDraft = selEntry === null && retainedEntry !== null;

  // Auto-select first entry whenever the list changes and nothing is currently selected
  useEffect(() => {
    if (displayEntries.length === 0) return;
    const valid = selEntryId != null && displayEntries.some((e) => e.xrayImageId === selEntryId);
    if (valid) return;
    // Draft protection: the selected row is gone from the refreshed list AND the
    // panel holds unsaved input for it. Leave the selection alone — the render
    // above keeps the panel (and the draft) up, with a banner explaining why.
    // The employee stays in control: any explicit navigation still moves on.
    if (selEntryId != null && dirtyEntryId === selEntryId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- auto-corrects selection when the display list changes; useMemo cannot accumulate user navigation state
    setSelEntryId(displayEntries[0].xrayImageId);
  }, [displayEntries, selEntryId, dirtyEntryId]);

  /** Explicit user navigation — the one case where dropping a draft is intended. */
  const selectEntry = useCallback((xrayImageId: string | null): void => {
    setSelEntryId(xrayImageId);
    setDirtyEntryId(null);
  }, []);

  const selAnswer = useMemo(
    () => panelEntry ? (answersMap.get(`${panelEntry.xrayImageId}::${panelEntry.assignedTo}`) ?? null) : null,
    [panelEntry, answersMap]
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
      // The month itself changed away — there is no row left to retain a draft
      // against, so the protection state resets with the selection.
      setDirtyEntryId(null);
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
    // DEFECT 8: boot reporting must reach a TERMINAL state on every exit path of
    // this pass -- including the superseded ones. `bootReportedRef` is consumed by
    // the first pass, so a newer pass that supersedes this one registers and
    // reports nothing; leaving these keys in "loading" strands the whole checklist
    // until BootSplashOverlay's 8 s timeout. Reproducible whenever a permission
    // broadcast lands mid-first-load, i.e. right after login.
    //
    // Idempotent and first-writer-wins: once a pass has resolved its own keys
    // (loaded on the mirror fast path, say) a later throw in the SAME pass must
    // not rewrite them to "error". The keys are per-pass by construction --
    // only the initial pass owns any.
    let bootFinalized = false;
    const finalizeBootSources = (error?: string): void => {
      if (!isInitialLoad || bootFinalized) return;
      bootFinalized = true;
      for (const source of bootSources) {
        if (error === undefined) markBootSourceLoaded(source.key);
        else markBootSourceError(source.key, error);
      }
    };
    if (!silent) {
      setLoadState("loading");
      setSelEntryId(null);
      // Non-silent means a real month/user change (or a post-action reload that
      // already closed the panel): the selection is being dropped on purpose, so
      // the draft-protection state goes with it. Silent refreshes never get here
      // — that is the whole point of the branch.
      setDirtyEntryId(null);
      setSelectedIds(new Set());
    }
    // True once the mirror has been painted (Design B, step 3). A failure of
    // the background re-derive AFTER that point must not replace a rendered,
    // correct-as-of-its-revision queue with the error state — same reasoning as
    // the `silent` branch in the catch below.
    let painted = false;
    try {
      // ── Phase 1: the small, per-user reads ────────────────────────────────
      // For a personal-scope user these are, together with the mirror and the
      // distribution log's revision stamp, the WHOLE load when the mirror is
      // current (Design B, step 3). `sample.master.json` (every drawn row for
      // the month) and the workspace-wide derivation are deliberately not in
      // here. population.final.json is not loaded here either; it is loaded
      // lazily only when the replacement dialog opens.
      const { entries: adhocEntriesPromise, answers: adhocAnswersPromise } =
        beginAdhocReads(directoryHandle, username, canSeeAll);
      const [
        referralLog,
        replacementLog,
        adhocEntries,
        adhocAnswerItems,
        personalMirror,
        logStamp,
        ownAnswerFile,
      ] =
        await Promise.all([
          loadReferralLog(directoryHandle, selMonth),
          loadReplacementLog(directoryHandle, selMonth),
          adhocEntriesPromise,
          adhocAnswersPromise,
          // Oversight (canSeeAll) is UNCHANGED and never reads a mirror:
          // reading N mirrors would be N round trips for data the single
          // derived `distribution.current.json` already holds.
          canSeeAll ? null : loadEmployeeSampleMirror(directoryHandle, selMonth, username),
          canSeeAll
            ? null
            : readDistributionLogStamp(directoryHandle, selMonth).catch((err) => {
                // Unknown revision ⇒ we cannot prove the mirror is current ⇒
                // take the slow path. Never the other way round.
                logError("xrayReferrals:readDistributionLogStamp", err);
                return null;
              }),
          canSeeAll ? null : loadEmployeeAnswers(directoryHandle, selMonth, username),
        ]);

      // Both helpers already scope to `username` (fromEmployee / employeeUsername),
      // so the previous `canSeeAll ? new Set() : …` short-circuit bought nothing
      // and cost an oversight user the pending colour on their OWN rows -- the
      // one place in the app where a supervisor's outstanding referral or
      // replacement request rendered as an ordinary row.
      const pendingReferralIds = getPendingReferralIds(referralLog, username);
      const pendingReplacementIds = getPendingReplacementIds(replacementLog, username);

      /** Commits one pass's results. Called twice when a stale mirror is
       *  painted first and the real derivation lands after it. Never touches
       *  selection or panel state — see the `silent` note in this function's
       *  docblock; the same reasoning applies to the intermediate paint. */
      const commit = (
        all: DistributionEntry[],
        quota: PersonalQuota,
        sample: SampleMasterData | null,
        answerItems: ItemAnswer[]
      ): void => {
        // No longer excludes pending/replaced rows — they're shown with a
        // distinct color instead (see rowStatusClass below, wired into
        // getRowClassName in the render). Only the assignedTo/canSeeAll scoping
        // remains a real filter.
        setAllEntries(all);
        setEntries(canSeeAll ? all : all.filter((e) => e.assignedTo === username));
        setPendingReferralIds(pendingReferralIds);
        setPendingReplacementIds(pendingReplacementIds);
        setSampleMaster(sample);
        setMyQuota(quota);
        setAnswers(answerItems);
        setLoadState("ready");
      };

      // ── Phase 2 (personal scope only): can the mirror answer on its own? ──
      // The mirror is a projection of the distribution log stamped with the
      // revision it was derived from. Equal revision ⇒ it IS the derivation,
      // for this employee, and nothing further needs reading. `>=` rather than
      // `===` because a mirror can only ever be ahead of a stamp we read a
      // moment earlier, never legitimately behind-but-correct.
      const mirrorCurrent =
        !canSeeAll && !!personalMirror && !!logStamp && personalMirror.sourceLogRevision >= logStamp.revision;
      // `quota` is OPTIONAL on the mirror by contract (see EmployeeMirrorQuota):
      // a mirror written before that field existed has none, and the reader
      // must fall back to the derived file rather than render "0 per day".
      const mirrorSelfSufficient = mirrorCurrent && personalMirror!.quota !== undefined;

      if (!canSeeAll && personalMirror) {
        const mirrorAll = [...personalMirror.entries, ...adhocEntries];
        const mirrorQuota: PersonalQuota = personalMirror.quota
          ? {
              dailyQuota: personalMirror.quota.dailyQuota,
              daysRemaining: personalMirror.quota.daysRemainingAtAssignment,
              sampleCount: personalMirror.quota.sampleCount,
            }
          : null;
        // Boot reporting is resolved BEFORE the staleness check (DEFECT 8): this
        // pass has finished every read it registered keys for, so the checklist
        // is accurate either way -- only `commit()` below is gated on the token.
        if (mirrorSelfSufficient) finalizeBootSources();
        if (token !== loadTokenRef.current) {
          finalizeBootSources();
          return;
        }
        painted = true;
        if (mirrorSelfSufficient) {
          // The whole read. Nothing else is loaded.
          // `sampleMaster` is deliberately left null: it was not read, and a
          // stale one from a previously selected month would be worse than
          // none. `openReplacementDialog` loads it (and the workspace-wide
          // entry set it needs for its exclusion sets) on demand instead.
          commit(mirrorAll, mirrorQuota, null, [...ownAnswerFile!.items, ...adhocAnswerItems]);
          return;
        }
        // Stale (or quota-less) mirror: paint it NOW so the employee sees their
        // queue immediately, then keep going and re-derive underneath.
        commit(mirrorAll, mirrorQuota, null, [...ownAnswerFile!.items, ...adhocAnswerItems]);
      }

      // ── Phase 3: the full read (oversight always; personal scope only when
      // the mirror could not answer) ───────────────────────────────────────
      const sample = await loadSampleMaster(directoryHandle, selMonth);
      const sampleRows = (sample?.rows ?? []) as PreparedPopulationRow[];
      const dist = await loadOrDeriveDistributionCurrentForRead(directoryHandle, selMonth, sampleRows);
      const all = [...(dist?.entries ?? personalMirror?.entries ?? []), ...adhocEntries];

      // Extract frozen daily quota for the current employee.
      const quota: PersonalQuota = dist?.quotas?.[username]
        ? {
            dailyQuota: dist.quotas[username].dailyQuota,
            daysRemaining: dist.quotas[username].daysRemainingAtAssignment,
            sampleCount: dist.quotas[username].sampleCount,
          }
        : null;

      // Real-month answers, plus the ad-hoc stores' own (see adhocAnswersPromise):
      // every row's answers are read from the store that row's writes go to.
      const answerItems = canSeeAll
        ? [
            ...(
              await Promise.all(
                [...new Set(all.map((e) => e.assignedTo))].map((u) =>
                  loadEmployeeAnswers(directoryHandle, selMonth, u)
                )
              )
            ).flatMap((f) => f.items),
            ...adhocAnswerItems,
          ]
        : [...ownAnswerFile!.items, ...adhocAnswerItems];

      // Boot reporting FIRST, then the staleness check (DEFECT 8). The previous
      // order -- bail on a stale token before touching bootProgress -- assumed a
      // newer load would re-register and re-report these keys. It never does:
      // `bootReportedRef` was already consumed by THIS pass, so the newer one
      // runs with isInitialLoad === false and the six keys stayed "loading"
      // forever. Only `commit()` may be gated on the token.
      finalizeBootSources();
      if (token !== loadTokenRef.current) return; // superseded by a newer month selection

      commit(all, quota, sample, answerItems);
    } catch (err) {
      // Boot reporting FIRST, mirroring the success path above (DEFECT 8) and
      // regardless of the token: the newer pass never re-registers these keys,
      // so a superseded rejection that skipped this left them "loading". A
      // source in "error" is terminal and deliberately does not block
      // `allLoaded` (see bootProgress.ts), so this can only unblock boot.
      // `finalizeBootSources` is first-writer-wins, so a throw AFTER the mirror
      // fast path already marked these loaded does not downgrade them.
      finalizeBootSources(err instanceof Error ? err.message : String(err));
      if (token !== loadTokenRef.current) return;
      // A silent background refresh must not force-close an open inspection form on
      // a transient read hiccup — log it for observability and leave the current
      // selection/panel exactly as it was; the next successful refresh (or manual
      // navigation) will recover the data.
      if (silent || painted) {
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
        setStatusMsg({ type: "error", text: userFacingErrorText(result.error, "xrayReferrals:result") });
      }
    } catch (error) {
      setStatusMsg({
        type: "error",
        // Raw thrown-error text is internal English (Chromium DOMException
        // wording, safeWrite validation strings) and has no place in an Arabic
        // UI -- map it, keep the detail in the admin error log.
        text: error instanceof MonthClosedError
          ? getLabels().msg_month_closed_write_blocked
          : thrownErrorText(error),
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
        // Routed on the ROW, not the selected month — see folderForRow. The
        // answer being reopened was written by handleSave to the row's own
        // store, so an ad-hoc row's reopen must read and rewrite it there.
        monthFolderName: folderForRow(entry.xrayImageId),
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
        setStatusMsg({ type: "error", text: userFacingErrorText(result.error, "xrayReferrals:result") });
      }
    } catch (error) {
      setStatusMsg({
        type: "error",
        // Raw thrown-error text is internal English (Chromium DOMException
        // wording, safeWrite validation strings) and has no place in an Arabic
        // UI -- map it, keep the detail in the admin error log.
        text: error instanceof MonthClosedError
          ? getLabels().msg_month_closed_write_blocked
          : thrownErrorText(error),
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
        // Routed on the ROW (see folderForRow): the request has to land in the
        // same store as the answer its approver will reopen, or approval fails
        // with "no saved answer" while polluting an unrelated month's queue.
        monthFolderName: folderForRow(entry.xrayImageId),
        employeeUsername: entry.assignedTo,
        xrayImageId: entry.xrayImageId,
        assignedTo: entry.assignedTo,
        requestedBy: username,
        requestedByRole: role,
        reason,
        instant: canReopenInstant,
      });
      if (result.ok) {
        selectEntry(null);
        setStatusMsg({
          type: "ok",
          text: result.mode === "instant" ? getLabels().msg_reopen_done : getLabels().msg_reopen_request_sent,
        });
        await loadData();
      } else {
        setStatusMsg({ type: "error", text: userFacingErrorText(result.error, "xrayReferrals:result") });
      }
    } catch (error) {
      setStatusMsg({
        type: "error",
        // Raw thrown-error text is internal English (Chromium DOMException
        // wording, safeWrite validation strings) and has no place in an Arabic
        // UI -- map it, keep the detail in the admin error log.
        text: error instanceof MonthClosedError
          ? getLabels().msg_month_closed_write_blocked
          : thrownErrorText(error),
      });
    }
  }

  /**
   * The sample master + every-employee entry set the replacement dialog needs.
   * Returns what `loadData` already put in state when the full read ran, and
   * pays for it on demand when the mirror fast path skipped it (a null
   * `sampleMaster` is precisely that signal — the fast path clears it, and the
   * full path only leaves it null when the month genuinely has no sample, in
   * which case this correctly returns null and the caller bails as before).
   */
  async function ensureReplacementContext(): Promise<
    { sample: SampleMasterData; entries: DistributionEntry[] } | null
  > {
    if (sampleMaster) return { sample: sampleMaster, entries: allEntries };
    if (!selMonth) return null;
    try {
      const sample = await loadSampleMaster(directoryHandle, selMonth);
      if (!sample) return null;
      const dist = await loadOrDeriveDistributionCurrentForRead(
        directoryHandle, selMonth, (sample.rows ?? []) as PreparedPopulationRow[]
      );
      setSampleMaster(sample);
      // Ad-hoc entries live outside this month's derivation, so carry the ones
      // already loaded rather than dropping them from the exclusion set.
      const merged = [...(dist?.entries ?? []), ...allEntries.filter(isAdhocEntry)];
      // BOTH halves must be committed, not just the sample. The short-circuit at
      // the top of this function pairs a cached `sampleMaster` with component
      // state `allEntries`; committing only the sample meant every subsequent
      // open re-paired the fresh sample with the mirror-only entry list, so the
      // exclusion set silently lost every other employee's rows and the dialog
      // offered rows they already owned.
      setAllEntries(merged);
      return { sample, entries: merged };
    } catch (error) {
      logError("xrayReferrals:ensureReplacementContext", error);
      return null;
    }
  }

  async function openReplacementDialog(entry: DistributionEntry): Promise<void> {
    if (!canRequestReplacement) {
      setStatusMsg({ type: "error", text: "لا تملك صلاحية طلب الاستبدال، أو أن مساحة العمل للقراءة فقط." });
      return;
    }
    if (!selMonth) return;
    // Design B step 3: on the mirror fast path `loadData` reads neither
    // `sample.master.json` nor the workspace-wide derivation, so both are
    // resolved HERE, on demand. They are genuinely needed and cannot be
    // approximated from the mirror: `sampleMaster` is the drawn-row set the
    // candidate pool is filtered against, and `allEntries` must be EVERY
    // employee's entries — an exclusion set built from this employee's mirror
    // alone would offer rows another employee already owns.
    const context = await ensureReplacementContext();
    if (!context) return;
    // Reads only the matching replacement-index bucket when one exists for
    // this month, instead of the full population.final.json — falls back to
    // a full read (and rebuilds the index in the background) for months
    // processed before this index existed.
    let candidates: Awaited<ReturnType<typeof getReplacementCandidatesIndexed>>;
    try {
      candidates = await getReplacementCandidatesIndexed(
        directoryHandle, selMonth, entry, context.sample, context.entries, stageMappings, username
      );
    } catch (error) {
      logError("xrayReferrals:getReplacementCandidatesIndexed", error);
      // T-08: an empty pool would assert "no eligible replacement exists" — a
      // claim about the data that an unreadable population cannot support.
      if (error instanceof PopulationUnreadableError) {
        setStatusMsg({ type: "error", text: getLabels().msg_population_unreadable });
        return;
      }
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

        // "resume-partial" (an earlier attempt appended the sample row for this
        // very substitution and then failed to write the events — XQ-DIST-005)
        // must pass: retrying with the same candidate is the designed recovery,
        // and the dialog stays open with the same candidate for exactly that.
        const replacementTaken =
          classifyReplacementRowAvailability({
            replacementXrayImageId: replacement.xrayImageId,
            deadXrayImageId: entry.xrayImageId,
            sample: { rows: freshRows, replacedRowIds: freshSample?.replacedRowIds },
            entries: freshDist?.entries,
          }) === "taken";

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
        //
        // The read still happens; the PARSE of it does not happen here (1.12).
        // Parsing a large month on the main thread is the freeze users report on
        // this exact click, so the file text goes to the query worker instead and
        // only the one matching row comes back. A miss and a failure are both
        // treated as "stale", exactly as the previous inline `.find()` was.
        const lookup = await findPopulationRowById(directoryHandle, selMonth, replacement.xrayImageId);
        if (isPopulationReadFailure(lookup)) {
          const text = getLabels().msg_population_unreadable;
          setReplacementError(text);
          setStatusMsg({ type: "error", text });
          return;
        }
        const fullReplacementRow = lookup.ok ? lookup.row ?? undefined : undefined;
        if (!fullReplacementRow) {
          setReplacementError(STALE_MSG);
          setStatusMsg({ type: "error", text: STALE_MSG });
          await loadData({ silent: true });
          return;
        }

        // Immediate replacement — no approval needed.
        const result = await executeReplacement({
          directoryHandle,
          // The same store the freshness re-check above read from. Routed on
          // `selMonth` this appended a `replaced` event for an ADHOC-* id into a
          // real month's immutable log (which its fold can never interpret),
          // appended a real population row to an already-drawn sample master,
          // and left the ad-hoc row live — the employee owned both.
          monthFolderName: rowFolder,
          deadEntry: entry,
          replacementRow: fullReplacementRow,
          reason,
          eventBy: username,
          stageMappings,
        });
        if (!result.ok) {
          setReplacementError(userFacingErrorText(result.error, "xrayReferrals:replace"));
          setStatusMsg({ type: "error", text: userFacingErrorText(result.error, "xrayReferrals:result") });
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
        // Deliberate navigation to the replacement row — the old row's panel is
        // being closed on purpose, so any draft protection for it is dropped too.
        selectEntry(replacement.xrayImageId);
      } else {
        // Non-recommended — requires supervisor approval.
        // Store only the id (not the full row) to avoid stale copies.
        const request: ReplacementRequest = {
          requestId: `rep-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          // Must match the folder the request is appended to (below): every
          // distribution read/write approveReplacement performs is keyed off
          // this field, so a record stored in the ad-hoc store while naming the
          // selected month would apply the replacement to the wrong population.
          monthFolderName: folderForRow(entry.xrayImageId),
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
          setReplacementError(userFacingErrorText(result.error, "xrayReferrals:replace"));
          setStatusMsg({ type: "error", text: userFacingErrorText(result.error, "xrayReferrals:result") });
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
    } catch (error) {
      // This block used to be `try { … } finally { … }` with no catch at all.
      // executeReplacement can throw rather than return `{ ok: false }` — its
      // month-lock gate and its directory resolution both run outside
      // appendDistributionEvents' inner try (distributionStorage.ts) — and so
      // can loadSampleMaster / loadMonthPopulationFinal above. Every one of
      // those became an unhandled promise rejection that left the user staring
      // at a dialog with no message and no idea whether the replacement had
      // been applied. Surface it in Arabic and keep the raw detail in the
      // admin error log.
      let text: string;
      if (error instanceof MonthClosedError) {
        text = getLabels().msg_month_closed_write_blocked;
      } else {
        logError("xrayReferrals:handleReplace", error);
        text = getLabels().msg_unexpected_write_error;
      }
      setReplacementError(text);
      setStatusMsg({ type: "error", text });
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

  // ── Reassignment handler (shared by all three sample-choosing methods) ─────

  function openReassignModal(
    xrayImageIds: string[],
    source: "single" | "selected" | "filtered"
  ): void {
    if (xrayImageIds.length === 0) {
      // A click must never be a silent no-op — the buttons are already
      // `disabled` when their respective count is 0, but this guard stays as
      // defense-in-depth against a state race (e.g. the underlying
      // selection/filtered set emptying out between render and click), so it
      // must explain itself instead of doing nothing.
      setStatusMsg({
        type: "error",
        text: source === "filtered"
          ? "لا توجد عينات مطابقة للتصفية/البحث الحالي لإحالتها."
          : "لا توجد عينات محددة لإحالتها.",
      });
      return;
    }
    setReassignError(null);
    setReassignModal({
      xrayImageIds,
      source,
      // Only ever reached from a click (the two bar buttons and the inspection
      // panel's "إسناد لموظف آخر"), never during render — but the compiler
      // cannot see that now that a render-time prop callback forwards to it.
      // The value must be random-and-unique, not a counter: it is the
      // idempotency key a retry replays against, so a value that repeats after
      // a page reload would make a genuinely new batch look like a replay and
      // silently drop it.
      // eslint-disable-next-line react-hooks/purity -- see above
      sourceRequestId: `bulk-reassign-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    });
  }

  async function handleReassignConfirm(toEmployee: string, reason: string): Promise<void> {
    // Handler-boundary check — mirrors every other mutating handler in this
    // file (render-boundary gating alone is not enough: the modal that calls
    // this could in principle be reopened from stale state). Either capability
    // opens this dialog (the panel/personal entry points require
    // `submit-referrals`, the oversight bar `bulk-reassign-referrals`), and
    // both land here.
    if (!canSubmitReferrals && !canBulkReassignReferrals) {
      setReassignError("لا تملك صلاحية إحالة العينات، أو أن مساحة العمل للقراءة فقط.");
      return;
    }
    if (!reassignModal || !selMonth) return;
    setReassignBusy(true);
    setReassignError(null);
    try {
      // ALWAYS a request, never a direct write — identical to إحالة (referral)
      // and استبدال (replacement). The submitter's own permissions decide
      // whether they can then approve it in ew/referral-approval; they never
      // decide whether a reviewable record exists. That record (who asked, when,
      // which samples, who decided, when) is the point of the flow, which is why
      // it is kept even when the same person submits and approves seconds later.
      //
      // A selection can legitimately span the real month and an ad-hoc import
      // (both render in this table) and each lives in its own store, so submit
      // per store rather than refusing the mixed case: a request is per-folder
      // by construction. The old per-row referral path rejected such a
      // selection outright, which is a worse answer than splitting it.
      const byFolder = new Map<string, string[]>();
      for (const id of reassignModal.xrayImageIds) {
        const folder = folderForRow(id);
        const bucket = byFolder.get(folder);
        if (bucket) bucket.push(id);
        else byFolder.set(folder, [id]);
      }

      const createdRequests: { fromEmployee: string; xrayImageIds: string[] }[] = [];
      let skippedTotal = 0;
      for (const folder of [...byFolder.keys()].sort()) {
        const requested = await submitReassignmentRequests({
          directoryHandle,
          monthFolderName: folder,
          xrayImageIds: byFolder.get(folder) ?? [],
          reassignedTo: toEmployee,
          requestedBy: username,
          reason,
          // Namespaced per folder so ids stay unique across stores while
          // remaining stable across retries of this same confirm click.
          sourceRequestId: `${reassignModal.sourceRequestId}::${folder}`,
        });
        if (!requested.ok) {
          // The modal keeps its sourceRequestId, and already-written requests
          // de-duplicate by id, so re-clicking "confirm" is always safe.
          setReassignError(requested.error ?? "حدث خطأ غير متوقع أثناء إرسال طلب إعادة التعيين.");
          return;
        }
        createdRequests.push(...requested.createdRequests);
        skippedTotal += requested.skipped.length;
      }

      const requestedTotal = createdRequests.reduce((sum, g) => sum + g.xrayImageIds.length, 0);
      if (requestedTotal === 0) {
        setReassignError("لا توجد عينات مؤهلة للإحالة ضمن هذا التحديد.");
        return;
      }
      void appendWorkspaceAction(directoryHandle, {
        actor: username,
        actorRole: role,
        action: "referral-requested",
        monthFolderName: selMonth,
        target: toEmployee,
        details: {
          samples: requestedTotal,
          requests: createdRequests.length,
          skipped: skippedTotal,
          source: reassignModal.source,
        },
      });
      setReassignModal(null);
      clearSelection();
      const requestCountText = createdRequests.length > 1
        ? ` (${createdRequests.length} طلبات — طلب لكل موظف مصدر)`
        : "";
      setStatusMsg({
        type: "ok",
        text: skippedTotal > 0
          ? `تم إرسال طلب إحالة ${requestedTotal} عينة إلى ${toEmployee}${requestCountText} — بانتظار موافقة المشرف. تم تخطي ${skippedTotal} عينة.`
          : `تم إرسال طلب إحالة ${requestedTotal} عينة إلى ${toEmployee}${requestCountText} — بانتظار موافقة المشرف.`,
      });
      // Silent — follows an already-successful write, not a month/user change;
      // must refresh the queue in place rather than flashing the loading state.
      await loadData({ silent: true });
    } catch (error) {
      setReassignError(
        error instanceof MonthClosedError
          ? getLabels().msg_month_closed_write_blocked
          : error instanceof Error ? error.message : "خطأ غير معروف"
      );
    } finally {
      setReassignBusy(false);
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

      {/* Zero assignments: the shared EmptyState the sibling Employee Workspace
          views already use (XrayInspectionResults, ReferralApproval), instead of
          a table with a header row and nothing under it. Only in "ready" —
          "idle" is the pre-first-load tick and must not flash an empty state. */}
      {/* `!showingRetainedDraft`: when the employee's last row was reassigned
          away mid-edit, the empty state must not replace the panel that is
          still holding their unsaved answers. */}
      {loadState === "ready" && entries.length === 0 && !showingRetainedDraft && (
        <EmptyState
          icon={<CalendarOff />}
          title={
            canSeeAll
              ? "لا توجد عينات موزّعة في هذا الشهر"
              : "لا توجد عينات مسندة إليك في هذا الشهر"
          }
          description="ستظهر العينات هنا فور توزيعها من تبويب معالجة المجتمع."
        />
      )}

      {(loadState === "idle" ||
        (loadState === "ready" && (entries.length > 0 || showingRetainedDraft))) && (() => {
        // True whenever the `columns` memo actually prepended the select-checkbox
        // column (personal-scope users always; oversight users only when permitted
        // to bulk-reassign — see the `columns` memo above).
        const hasSelectColumn = columns[0]?.id === SELECT_COL_ID;
        // Everything the bar reports and acts on is filtered through the SAME
        // eligibility predicate the submit path uses (referral/planReassignment.ts),
        // so a button that says N requests exactly N. A completed or replaced row
        // can never be reassigned — counting it, or feeding it to the dialog only
        // for the planner to drop it again, is what made these buttons look broken.
        const selectableVisibleIds = filteredTableEntries
          .filter(isReassignEligible)
          .map((e) => e.xrayImageId);
        // Selected ids are kept across filter changes and silent refreshes on
        // purpose (cross-page selection), so they are re-checked against the
        // CURRENT entries here: a row that has since been completed, replaced or
        // dropped from the month must not be counted or submitted.
        const eligibleSelectedIds = [...selectedIds].filter((id) => {
          const entry = entriesById.get(id);
          return entry !== undefined && isReassignEligible(entry);
        });
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
        const tableEl = (
          <div className="ew-ref-queue">
            {canReassignSamples && entries.length > 0 && (
              <ReassignSelectionBar
                selectedCount={selectedIds.size}
                eligibleSelectedCount={eligibleSelectedIds.length}
                filteredCount={filteredTableEntries.length}
                eligibleFilteredCount={selectableVisibleIds.length}
                onReassignSelected={() => openReassignModal(eligibleSelectedIds, "selected")}
                onReassignFiltered={() => openReassignModal(selectableVisibleIds, "filtered")}
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
              onRowClick={(e) => selectEntry(e.xrayImageId)}
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
            <ReferralStatsStrip
              stats={personalStats}
              quota={myQuota}
              username={username}
              // Exactly the branch `personalStats` itself takes: in the "الكل"
              // view an oversight user's figures are the whole workspace's.
              scope={canSeeAll && !showMyOnly ? "all" : "own"}
            />
            {showingRetainedDraft && (
              <p className="ew-msg-warn" role="status">{L.ew_draft_retained_notice}</p>
            )}
            <div className={`ew-split ew-split--right${panelEntry ? "" : " ew-split--empty"}`}>
              {tableEl}
              {panelEntry ? (
                <SampleDetailPanel
                  entry={panelEntry}
                  template={activeTpl}
                  savedAnswer={selAnswer}
                  readonly={!canSubmitAnswers || (canSeeAll && panelEntry.assignedTo !== username)}
                  onClose={() => selectEntry(null)}
                  // Draft protection (P0): the panel tells us it now holds
                  // unsaved input, so a background refresh that removes this
                  // row keeps it on screen instead of swapping the employee to
                  // a different x-ray. See the retention block further up.
                  onDraftDirty={() => setDirtyEntryId(panelEntry.xrayImageId)}
                  onSave={(ans) =>
                    handleSave(panelEntry.xrayImageId, ans, panelEntry.assignedTo)
                  }
                  onReplace={
                    canRequestReplacement && panelEntry.assignedTo === username && panelEntry.status === "pending"
                      ? openReplacementDialog
                      : undefined
                  }
                  onReassign={
                    // Same authority as the selection bar (see canReassignSamples):
                    // the panel is just a third way to build the id list.
                    canReassignSamples && panelEntry.assignedTo === username && panelEntry.status === "pending"
                      ? (entry) => openReassignModal([entry.xrayImageId], "single")
                      : undefined
                  }
                  onReopen={
                    canReopenAnswer
                      // eslint-disable-next-line react-hooks/refs -- handleReopenAnswer's post-write loadData() bumps loadTokenRef.current inside an event-handler call chain, never during render
                      ? (reason) => { void handleReopenAnswer(panelEntry, reason); }
                      : undefined
                  }
                  onRequestReopen={
                    canSubmitAnswers && panelEntry.assignedTo === username
                      // eslint-disable-next-line react-hooks/refs -- see onReopen above; handleRequestReopen's loadData() call is the same pattern
                      ? (reason) => { void handleRequestReopen(panelEntry, reason); }
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

      {reassignModal ? (
        <ReassignModal
          state={reassignModal}
          entries={entries}
          visibleColumns={visiblePreviewColumns}
          dateFmt={effectiveColConfig.dateFmt}
          answersMap={answersMap}
          currentUser={username}
          busy={reassignBusy}
          error={reassignError}
          onClose={() => {
            if (reassignBusy) return;
            setReassignModal(null);
            setReassignError(null);
          }}
          onConfirm={(toEmployee, reason) => { void handleReassignConfirm(toEmployee, reason); }}
        />
      ) : null}
    </section>
  );
}
