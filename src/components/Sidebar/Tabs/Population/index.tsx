/* eslint-disable react-refresh/only-export-components */

import {
  useMemo,
  useRef,
  useState,
  useEffect,
  type ChangeEvent
} from "react";
import { ScanLine } from "lucide-react";

import type { SidebarTabModule } from "../tabTypes";

import { readSession } from "../../../../auth/authSession";
import { tabAllowedRoles } from "../../../../auth/tabCatalog";
import { usePermissions } from "../../../../auth/usePermissions";
import type { UsePermissionsResult } from "../../../../auth/usePermissions";
import { logError, logRejection } from "../../../../data/storage/errorLogger";
import type { SafeWriteProgressPhase } from "../../../../data/storage/safeWrite";
import { currentMonthFolderInfo, formatMonthFolderName, formatMonthFolderShortLabel } from "../../../../data/population/monthFolder";
import type { MonthFolderInfo } from "../../../../data/population/monthFolder";
import {
  saveMonthRun,
  loadMonthForEditing,
  loadCertScanGlobal,
  saveCertScanGlobal,
  saveSamplingProof,
  updateMonthStatus,
} from "../../../../data/population/populationStorage";
import {
  loadDistributionLog,
  loadOrDeriveDistributionCurrent,
} from "../../../../data/distribution/distributionStorage";
import { loadAllEmployeeFiles } from "../../../../data/answers/answerStorage";
import { scanReferentialIntegrity, type OrphanScanResult } from "../../../../data/integrity/orphanScan";
import { drawSample } from "../../../../data/sampling/sampleAlgorithm";
import { loadSampleMaster, saveSampleMaster } from "../../../../data/sampling/sampleStorage";
import { buildSamplingPlan, saveSamplingPlan } from "../../../../data/sampling/samplingPlanStorage";
import type { SamplingPlanPriorMonthAdvisory } from "../../../../data/sampling/samplingPlanStorage";
import { loadPriorMonthAdvisory } from "../../../../data/sampling/switchingRuleAdvisory";
import type { SampleMasterData } from "../../../../data/sampling/sampleTypes";
import { useWorkspace } from "../../../../data/workspace/useWorkspace";
import { useGlobalMonth } from "../../../../data/month/useGlobalMonth";

import type { BiWorkbookResult } from "./biData/biDataTypes";

import { exportPopulationProcessingResult } from "./processing/populationExporter";
import { processPopulation } from "./processing/populationProcessor";
import type { PopulationProcessingResult } from "./processing/populationProcessingTypes";

import type { RiskWorkbookResult } from "./riskData/riskDataTypes";

import WorkbookWorker from "../../../../workers/workbookWorker?worker&inline";
import type { WorkbookWorkerRequest, WorkbookWorkerResponse } from "../../../../workers/workbookWorkerTypes";

import PhaseOneUpload from "./components/PhaseOneUpload";
import PhaseTwoReportAndProcessing from "./components/PhaseTwoReportAndProcessing";
import PhaseThreeSampling from "./components/PhaseThreeSampling";
import PhaseFourDistribution from "./components/PhaseFourDistribution";
import MappingSettingsModal from "./components/MappingSettingsModal";
import { buildColumnHintsFromRows } from "./components/columnMappingHints";
import {
  loadPopulationConfig,
  savePopulationConfig,
  type PopulationConfig,
  DEFAULT_POPULATION_CONFIG
} from "../../../../data/population/populationConfig";

import { getLabels } from "../../../../data/labels/labelsStore";
import { MonthClosedError, reopenMonth } from "../../../../data/population/monthLock";
import type { MonthManifestData } from "../../../../data/population/monthTypes";
import type { PopulationAggregateLoadResult } from "../../../../data/population/populationAggregate";
import { appendWorkspaceAction } from "../../../../data/audit/actionLog";
import { touchVisitedTabs } from "../../../../app/visitedTabs";

import "./Population.css";
import { ConfirmDialog } from "../../../../components/ConfirmDialog/ConfirmDialog";
import BrowseDataView from "./BrowseDataView";
import {
  computeMonthLoadScope,
  isSupportedExcelFile,
  PHASES,
  reconstructedPopulation,
  sourceFileMetadata,
  stableHash
} from "./populationWorkflowHelpers";
import { useMonthLoad, type LoadedMonthState } from "./useMonthLoad";
import { useDistributionActions } from "./useDistributionActions";
import {
  ClosedMonthBanner,
  PopulationHeader,
  PopulationPhaseFooter,
  PopulationStatusBar,
  PopulationStepper
} from "./components/PopulationWorkflowChrome";

type UploadKey = "riskAgencyData" | "businessIntelligenceData";

type UploadState = {
  file: File | null;
  source: "file-system-api" | "input-fallback" | null;
};


export const tabConfig: SidebarTabModule["tabConfig"] = {
  id: "population",
  label: "إدارة بيانات الأشعة",
  order: 10,
  allowedRoles: tabAllowedRoles("population"),
  icon: <ScanLine size={20} strokeWidth={1.8} aria-hidden />,
  subTabs: [
    { id: "process", label: "معالجة البيانات" },
    { id: "browse",  label: "استعراض البيانات" },
  ]
};

type SaveMessage = { type: "ok" | "error"; text: string } | null;

type SubTab = "process" | "browse";

type WizardCapabilities = {
  canUploadData: boolean;
  canProcessPopulation: boolean;
  canConfigureSample: boolean;
  canDrawSample: boolean;
  canDistributeSamples: boolean;
  canBulkAssign: boolean;
  canViewBrowse: boolean;
  canExportReports: boolean;
  canUploadNow: boolean;
  canProcessNow: boolean;
  canExportNow: boolean;
};

/**
 * Derives every role/feature capability the Population wizard's phase panels read, plus the
 * closed-month/month-loading withdrawal already established for Phase 3/4 (canDrawSample,
 * canDistributeSamples, canBulkAssign) and extended to Phase 1/2's render-time button gating
 * (B13: canUploadNow/canProcessNow/canExportNow). The Phase 1/2 handler-side checks
 * (pickExcelFile, handleProcessPopulation, handleExportPopulation, ...) keep their own existing
 * permission + isLoadingMonthData checks; closed-month writes are independently rejected at the
 * storage layer (MonthClosedError), so the *Now flags below are additive UX gates only, not a
 * new write-path check. Pulled out of PopulationTab itself to stay under this repo's
 * max-lines-per-function/complexity budget (npm run check:complexity) — the component was
 * already at the line ceiling before this fix.
 */
function computeWizardCapabilities(
  can: UsePermissionsResult["can"],
  canMutate: UsePermissionsResult["canMutate"],
  selectedMonthClosed: boolean,
  isLoadingMonthData: boolean
): WizardCapabilities {
  const canUploadData = canMutate("upload-data");
  const canProcessPopulation = canMutate("process-population");
  const canExportReports = can("export-reports");
  return {
    canUploadData,
    canProcessPopulation,
    canConfigureSample: canMutate("configure-sample"),
    canDrawSample: canMutate("draw-sample") && !selectedMonthClosed && !isLoadingMonthData,
    canDistributeSamples: canMutate("distribute-samples") && !selectedMonthClosed && !isLoadingMonthData,
    canBulkAssign: canMutate("bulk-assign") && !selectedMonthClosed && !isLoadingMonthData,
    canViewBrowse: can("view-browse"),
    canExportReports,
    canUploadNow: canUploadData && !selectedMonthClosed && !isLoadingMonthData,
    canProcessNow: canProcessPopulation && !selectedMonthClosed && !isLoadingMonthData,
    canExportNow: canExportReports && !isLoadingMonthData,
  };
}

export default function PopulationTab() {
  const { directoryHandle } = useWorkspace();
  const { can, canMutate } = usePermissions();
  const sessionRef = useRef(readSession());
  const [activeSubTab, setActiveSubTab] = useState<SubTab>("process");
  // Browse owns its own data-load effect (BrowseDataView) with no
  // "already loaded" guard; keeping it mounted-but-hidden once visited,
  // instead of unmounting on every sub-tab switch, avoids re-loading its
  // full dataset (up to ~400k rows) every time — §M/§T.
  // Adjusted during render (not in an effect) per React's "adjusting state
  // during render" pattern — mirrors EmployeeWorkspaceTab's and ReportsTab's
  // identical fix — avoiding both react-hooks/set-state-in-effect and the
  // extra effect-driven render pass a useEffect version would add.
  const [visitedSubTabs, setVisitedSubTabs] = useState<Set<SubTab>>(
    () => new Set([activeSubTab])
  );
  if (!visitedSubTabs.has(activeSubTab)) {
    setVisitedSubTabs((prev) => touchVisitedTabs(prev, activeSubTab));
  }
  const {
    selection: globalMonth,
    setSelectedMonth: setGlobalMonth,
    refreshMonths,
    registerMonthChangeGuard,
    isSelectedMonthClosed,
  } = useGlobalMonth();
  // Owner requirement (2026-08-07): the selected month's manifest + persisted
  // aggregate, kept in sync with useMonthLoad's applyLoadedState below so the
  // closed-month banner can distinguish a system auto-lock from a person
  // manually closing the month, and so Phase 2's report can render a locked
  // month from the aggregate alone (zero population.final.json/risk.raw.json/
  // bi.raw.json reads).
  const [selectedMonthManifest, setSelectedMonthManifest] = useState<MonthManifestData | null>(null);
  const [populationLocked, setPopulationLocked] = useState(false);
  const [populationAggregate, setPopulationAggregate] = useState<PopulationAggregateLoadResult | null>(null);
  const [isUnlockingMonth, setIsUnlockingMonth] = useState(false);
  // Month close-out (Tier-1 Item A): a closed month is view-only — draw and
  // distribution capabilities are withdrawn regardless of role permissions.
  const selectedMonthClosed = isSelectedMonthClosed;
  // True while an existing month's data is being loaded from disk. During this
  // window the in-memory population/sample/distribution still belong to the
  // PREVIOUS month while saveMonth/saveYear already point at the new one, so
  // every mutating capability is withdrawn until the load resolves (CRITICAL 1).
  // Owned by useMonthLoad (extracted for check:complexity's max-lines-per-function
  // budget); applyLoadedState/resetWizardState below still own every OTHER field.
  // Sync extension (Task 6): true while a mutating wizard operation (processing,
  // drawing/saving a sample, distributing) is writing its own not-yet-persisted
  // result into a field the periodic/manual background-refresh subscriber inside
  // useMonthLoad would also overwrite -- reassigned below, after every flag it
  // reads is declared, same "plain ref updated every render" idiom as
  // wizardFolderRef further down. Read only via `.current`, never as a dependency,
  // so useMonthLoad's subscriber effect isn't forced to resubscribe on every tick.
  const isWizardBusyRef = useRef(false);
  const { isLoadingMonthData, hasUnsavedSessionWorkRef } = useMonthLoad({
    directoryHandle,
    globalMonth,
    registerMonthChangeGuard,
    // population/raw (each up to ~400k rows) are gated by sub-tab + the viewer's
    // OWN capability -- not computeWizardCapabilities' gated values below (circular
    // here, and those gates are about WRITE capability, not read/display need).
    computeScope: () =>
      computeMonthLoadScope({
        activeSubTab,
        canDrawSample: canMutate("draw-sample"),
        canProcessPopulation: canMutate("process-population"),
      }),
    applyLoadedState,
    resetWizardState,
    isWizardBusyRef,
    onLoadError: (message) => setProcessingMessage(message),
  });
  const { canUploadData, canProcessPopulation, canConfigureSample, canDrawSample, canDistributeSamples, canBulkAssign, canViewBrowse, canExportReports, canUploadNow, canProcessNow, canExportNow } = computeWizardCapabilities(can, canMutate, selectedMonthClosed, isLoadingMonthData);
  const [config, setConfig] = useState<PopulationConfig>(DEFAULT_POPULATION_CONFIG);
  const [settingsModalMode, setSettingsModalMode] = useState<"mapping" | "processing" | null>(null);

  useEffect(() => {
    if (directoryHandle) {
      loadPopulationConfig(directoryHandle)
        .then((c) => setConfig(c))
        .catch(logRejection("population:loadPopulationConfig"));
    } else {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync reset when workspace is disconnected; synchronizing with the FSA external system is the correct use of effects
      setConfig(DEFAULT_POPULATION_CONFIG);
    }
  }, [directoryHandle]);

  // Month picker state
  const [monthRefreshKey, setMonthRefreshKey] = useState(0);

  // Stable element reference (recomputed only when its own inputs change) so
  // switching activeSubTab back and forth — which re-renders PopulationTab on
  // every Excel-import/wizard/distribution progress tick — doesn't also
  // re-invoke BrowseDataView's own render while it's hidden; React bails out
  // of re-rendering a child subtree when the exact same element reference is
  // passed again. Mirrors EmployeeWorkspaceTab's identical fix.
  const browseElement = useMemo(
    () => (
      <BrowseDataView
        directoryHandle={directoryHandle}
        refreshKey={monthRefreshKey}
        username={sessionRef.current?.username ?? "unknown"}
        config={config}
      />
    ),
    [directoryHandle, monthRefreshKey, config]
  );

  // Load cumulative CertScan data from workspace on mount
  useEffect(() => {
    if (!directoryHandle) return;
    loadCertScanGlobal(directoryHandle)
      .then((text) => {
        if (text) setCertScanPasteText(text);
      })
      .catch(logRejection("population:loadCertScanGlobal"));
  }, [directoryHandle]);

  // Listen for sub-tab changes dispatched from the Sidebar
  useEffect(() => {
    const handler = (e: CustomEvent<{ subTabId: SubTab }>) => {
      setActiveSubTab(e.detail.subTabId);
    };
    window.addEventListener("pop-set-subtab", handler as EventListener);
    return () => window.removeEventListener("pop-set-subtab", handler as EventListener);
  }, []);

  // Notify Sidebar of active sub-tab so it can highlight the correct item
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("pop-subtab-changed", { detail: activeSubTab }));
  }, [activeSubTab]);

  // Listen for "open month" events dispatched from BrowseDataView
  useEffect(() => {
    const handler = (e: CustomEvent<MonthFolderInfo>) => {
      setActiveSubTab("process");
      window.dispatchEvent(new CustomEvent("pop-subtab-changed", { detail: "process" }));
      // useMonthLoad's auto-load effect reacts to the selection change (guard included).
      setGlobalMonth(e.detail.folderName);
    };
    window.addEventListener("pop-load-month", handler as EventListener);
    return () => window.removeEventListener("pop-load-month", handler as EventListener);
  }, [setGlobalMonth]);

  /** useMonthLoad's success path: apply a freshly loaded month's data. */
  function applyLoadedState(loaded: LoadedMonthState): void {
    setRiskWorkbookResult(loaded.riskWorkbook);
    setBiWorkbookResult(loaded.biWorkbook);
    setPopulationProcessingResult(loaded.population);
    setSampleDrawResult(loaded.sample);
    setDistributionCurrent(loaded.distribution);
    setSelectedMonthManifest(loaded.manifest);
    setPopulationLocked(loaded.populationLocked);
    setPopulationAggregate(loaded.populationAggregate);

    if (loaded.phase) {
      setCurrentPhase(loaded.phase.current);
      setCompletedPhaseIds(loaded.phase.completed);
    }
  }

  /**
   * Clean Phase-1 state targeting the (pending) global month, or a failed
   * existing-month load's fallback. Called by useMonthLoad, which separately
   * owns (and unconditionally clears, per the CRITICAL I-2 follow-up) the
   * isLoadingMonthData/hasUnsavedSessionWorkRef fields it keeps to itself.
   */
  function resetWizardState(): void {
    setUploads({
      riskAgencyData: { file: null, source: null },
      businessIntelligenceData: { file: null, source: null },
    });
    setRiskWorkbookResult(null);
    setBiWorkbookResult(null);
    setPopulationProcessingResult(null);
    setSampleDrawResult(null);
    setDistributionCurrent(null);
    setSelectedMonthManifest(null);
    setPopulationLocked(false);
    setPopulationAggregate(null);
    setSaveToDiskMessage(null);
    setSampleSaveMessage(null);
    setDistributionMessage(null);
    setUploadError("");
    setProcessingMessage("");
    setCurrentPhase(1);
    setCompletedPhaseIds([]);
    setPendingReprocessSave(null);
  }

  // Lazy top-up for the one field computeMonthLoadScope may have deferred. Returns
  // the already-loaded result if present; otherwise fetches population + summary
  // (real summary preferred over reconstructedPopulation's row-count fallback) for
  // the current month, guarded by the same wizardFolderRef epoch check
  // handleProcessPopulation uses against a month switch mid-flight.
  async function ensurePopulationLoaded(): Promise<PopulationProcessingResult | null> {
    if (populationProcessingResult) return populationProcessingResult;
    if (!directoryHandle || globalMonth.kind !== "existing") return null;
    const epochFolder = wizardFolderRef.current;
    const data = await loadMonthForEditing(directoryHandle, globalMonth.folderName, {
      population: true,
      summary: true,
    });
    if (wizardFolderRef.current !== epochFolder) return null; // superseded by a month switch
    const population = reconstructedPopulation(data);
    if (population) setPopulationProcessingResult(population);
    return population;
  }

  async function handleConfigChange(newConfig: PopulationConfig) {
    if (!canConfigureSample) {
      setProcessingMessage("لا تملك صلاحية تعديل إعدادات المعالجة أو العينة.");
      return;
    }
    setConfig(newConfig);
    if (directoryHandle) {
      // B6: surface a CAS conflict instead of silently dropping the config change.
      const result = await savePopulationConfig(directoryHandle, newConfig);
      if (!result.ok) {
        setProcessingMessage(result.error);
      }
    }
  }

  const riskAgencyInputRef = useRef<HTMLInputElement | null>(null);
  const businessIntelligenceInputRef = useRef<HTMLInputElement | null>(null);
  const workerRef = useRef<Worker | null>(null);
  useEffect(() => {
    const w = new WorkbookWorker();
    workerRef.current = w;
    return () => { w.terminate(); };
  }, []);

  const [currentPhase, setCurrentPhase] = useState(1);
  const [completedPhaseIds, setCompletedPhaseIds] = useState<number[]>([]);

  // The save target is ALWAYS the globally selected month. The current-calendar
  // fallback only covers the no-workspace state, where saving is impossible anyway.
  const fallbackMonth = currentMonthFolderInfo();
  const saveMonth = globalMonth.kind === "none" ? fallbackMonth.month : globalMonth.month;
  const saveYear = globalMonth.kind === "none" ? fallbackMonth.year : globalMonth.year;

  // Tracks the folder the wizard's save target currently points at, reassigned on
  // every render. The epoch check in handleProcessPopulation compares against this
  // to detect a month switch that landed while processing was in flight (CRITICAL 1).
  const wizardFolderRef = useRef("");
  wizardFolderRef.current = globalMonth.kind === "none" ? "" : globalMonth.folderName;

  // B4: compute the prior-month switching-rule advisory for the selected month so
  // it can be surfaced in Phase 3 BEFORE the draw. Advisory only — never blocks.
  useEffect(() => {
    if (!directoryHandle) {
      setPriorMonthAdvisory(null);
      return;
    }
    let cancelled = false;
    const monthFolderName = formatMonthFolderName(saveMonth, saveYear);
    loadPriorMonthAdvisory(directoryHandle, monthFolderName)
      .then((advisory) => { if (!cancelled) setPriorMonthAdvisory(advisory); })
      .catch(() => { if (!cancelled) setPriorMonthAdvisory(null); });
    return () => { cancelled = true; };
  }, [directoryHandle, saveMonth, saveYear, monthRefreshKey]);

  const [isSavingToDisk, setIsSavingToDisk] = useState(false);
  const [saveToDiskMessage, setSaveToDiskMessage] = useState<SaveMessage>(null);
  // B task 2: the write-phase progress for population.final.json (the largest
  // file in the save batch), surfaced so "جاري الحفظ التلقائي..." doesn't sit
  // unchanged for the 10-15 minutes safeWriteJson's own passes (backup, stage,
  // verify, commit, verify) can take on a big population — see safeWrite.ts's
  // SafeWriteProgressPhase.
  const [saveProgressPhase, setSaveProgressPhase] = useState<SafeWriteProgressPhase | null>(null);
  // Pending re-process save awaiting user confirmation (month already has a drawn sample).
  const [pendingReprocessSave, setPendingReprocessSave] = useState<{
    processingResult: PopulationProcessingResult;
    riskResult: RiskWorkbookResult;
  } | null>(null);

  // Phase 3 — sampling
  const [sampleSeed, setSampleSeed] = useState(() => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10));
  const [isDrawingSample, setIsDrawingSample] = useState(false);
  const [sampleDrawResult, setSampleDrawResult] =
    useState<SampleMasterData | null>(null);
  const [sampleSaveMessage, setSampleSaveMessage] =
    useState<SaveMessage>(null);
  // B4 switching-rule advisory computed for the currently-selected month.
  const [priorMonthAdvisory, setPriorMonthAdvisory] =
    useState<SamplingPlanPriorMonthAdvisory | null>(null);
  // B3 referential-integrity orphan scan for the selected month (Phase 2 view).
  const [orphanScan, setOrphanScan] = useState<OrphanScanResult | null>(null);

  // Phase 4 — distribution (state + mutating handlers extracted to
  // useDistributionActions.ts to stay under check:complexity's
  // max-lines-per-function budget; see that file's header comment)
  const {
    distributionCurrent,
    setDistributionCurrent,
    distributionMessage,
    setDistributionMessage,
    isDistributing,
    distributionProgress,
    handleAssign,
    handleReassign,
    handleMarkComplete,
    handleRequestReplacement,
    handleApplyBulkAssignment,
  } = useDistributionActions({
    directoryHandle,
    sampleDrawResult,
    saveMonth,
    saveYear,
    canDistributeSamples,
    canBulkAssign,
    currentUsername: sessionRef.current?.username ?? "unknown",
    currentRole: sessionRef.current?.role ?? "unknown",
    onDistributionChanged: () => setMonthRefreshKey((k) => k + 1),
    refreshGlobalMonths: refreshMonths,
  });

  const [uploads, setUploads] = useState<Record<UploadKey, UploadState>>({
    riskAgencyData: { file: null, source: null },
    businessIntelligenceData: { file: null, source: null }
  });

  const [uploadError, setUploadError] = useState("");
  const [processingMessage, setProcessingMessage] = useState("");
  const [isProcessingWorkbooks, setIsProcessingWorkbooks] = useState(false);
  const [isProcessingPopulation, setIsProcessingPopulation] = useState(false);

  // Sync extension (Task 6): every flag isWizardBusyRef needs to combine is
  // now in scope -- reassigned on every render (isWizardBusyRef itself is
  // declared up near the useMonthLoad call, above), same "plain ref updated
  // every render" pattern as wizardFolderRef further down.
  isWizardBusyRef.current =
    isProcessingWorkbooks || isProcessingPopulation || isDrawingSample || isSavingToDisk || isDistributing;

  // Progress indicators
  const [processingProgressMessage, setProcessingProgressMessage] = useState("");
  const [processingProgressPercent, setProcessingProgressPercent] = useState(0);

  const [riskWorkbookResult, setRiskWorkbookResult] =
    useState<RiskWorkbookResult | null>(null);
  const [biWorkbookResult, setBiWorkbookResult] =
    useState<BiWorkbookResult | null>(null);

  const [certScanPasteText, setCertScanPasteText] = useState("");
  const [populationProcessingResult, setPopulationProcessingResult] =
    useState<PopulationProcessingResult | null>(null);

  // Proactively top up population on landing at Phase 3 with it still missing --
  // covers "loaded while on Browse, switched to Process" for the stage-count display
  // AND draw-button reachability, not just handleDrawSample's own on-click top-up.
  // Gated on activeSubTab === "process": phase alone (from manifest.status, always
  // loaded) can already read 3 while still on Browse; fetching population in the
  // background for a pure-browse user would reintroduce the read this feature defers.
  useEffect(() => {
    if (activeSubTab !== "process" || currentPhase !== 3 || populationProcessingResult) return;
    if (!canDrawSample && !canProcessPopulation) return;
    void ensurePopulationLoaded();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fresh closure each render; its own body already guards re-fetching via populationProcessingResult
  }, [activeSubTab, currentPhase, populationProcessingResult, canDrawSample, canProcessPopulation]);

  // W9: auto-process on arriving at Phase 2 with a freshly-read workbook still
  // unprocessed — the owner should not have to press "معالجة المجتمع" for the
  // very first run. Guarded by object-identity on riskWorkbookResult (not just
  // "!populationProcessingResult", which a FAILED attempt would leave true
  // forever and retry on every render) so this fires at most once per distinct
  // parsed workbook. A month already processed/loaded from disk reconstructs
  // populationProcessingResult directly (see reconstructedPopulation), so this
  // never re-runs for it. handleProcessPopulation itself still owns every
  // permission/closed-month/in-flight check — canProcessNow here is only an
  // additional render-time gate so the effect doesn't even attempt a call the
  // handler would reject anyway. Manual re-process ("إعادة معالجة المجتمع")
  // stays available and does not go through this effect at all.
  const autoProcessAttemptedForRef = useRef<RiskWorkbookResult | null>(null);
  useEffect(() => {
    if (activeSubTab !== "process" || currentPhase !== 2) return;
    if (!riskWorkbookResult) return;
    if (populationProcessingResult) return;
    if (isProcessingPopulation || isLoadingMonthData) return;
    if (!canProcessNow) return;
    if (autoProcessAttemptedForRef.current === riskWorkbookResult) return;
    autoProcessAttemptedForRef.current = riskWorkbookResult;
    void handleProcessPopulation();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleProcessPopulation is a fresh closure every render; the ref guard above (not a dependency) is what actually prevents repeat firing
  }, [activeSubTab, currentPhase, riskWorkbookResult, populationProcessingResult, isProcessingPopulation, isLoadingMonthData, canProcessNow]);

  // B3: compute the orphan scan for the selected month when the Phase 2 report is
  // visible. Best-effort — any load failure clears the scan (section renders nothing).
  useEffect(() => {
    if (!directoryHandle || currentPhase !== 2 || !populationProcessingResult) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync clear when preconditions unmet
      setOrphanScan(null);
      return;
    }
    let cancelled = false;
    const monthFolderName = formatMonthFolderName(saveMonth, saveYear);
    const populationRows = populationProcessingResult.preparedRows;
    void (async () => {
      try {
        const sample = await loadSampleMaster(directoryHandle, monthFolderName);
        const distribution = sample
          ? await loadOrDeriveDistributionCurrent(directoryHandle, monthFolderName, sample.rows)
          : null;
        const employeeFiles = await loadAllEmployeeFiles(directoryHandle, monthFolderName);
        if (cancelled) return;
        const answersIds: string[] = [];
        const approvalsIds: string[] = [];
        for (const file of employeeFiles) {
          for (const item of file.items) answersIds.push(item.xrayImageId);
          for (const req of file.referralRequests ?? []) approvalsIds.push(...req.xrayImageIds);
          for (const req of file.replacementRequests ?? []) {
            approvalsIds.push(req.originalXrayImageId, req.replacementXrayImageId);
          }
        }
        const scan = scanReferentialIntegrity({
          populationIds: populationRows.map((r) => r.xrayImageId),
          sampleIds: (sample?.rows ?? []).map((r) => r.xrayImageId),
          distributionIds: (distribution?.entries ?? []).map((e) => e.xrayImageId),
          answersIds,
          approvalsIds,
        });
        if (!cancelled) setOrphanScan(scan);
      } catch {
        if (!cancelled) setOrphanScan(null);
      }
    })();
    return () => { cancelled = true; };
  }, [directoryHandle, currentPhase, populationProcessingResult, saveMonth, saveYear, monthRefreshKey]);

  const isPhaseOneComplete = useMemo(
    () => Boolean(uploads.riskAgencyData.file),
    [uploads.riskAgencyData.file]
  );

  const riskColumnHints = useMemo(
    () => buildColumnHintsFromRows(riskWorkbookResult?.rows ?? [], config),
    [riskWorkbookResult, config]
  );

  const biColumnHints = useMemo(
    () => buildColumnHintsFromRows(biWorkbookResult?.rows ?? [], config),
    [biWorkbookResult, config]
  );

  async function pickExcelFile(uploadKey: UploadKey): Promise<void> {
    if (!canUploadData) {
      setUploadError("لا تملك صلاحية رفع ملفات البيانات.");
      return;
    }
    setUploadError("");
    setProcessingMessage("");

    const browserWindow = window as Window & { showOpenFilePicker?: (...args: unknown[]) => Promise<FileSystemFileHandle[]> };

    if (!browserWindow.showOpenFilePicker) {
      openFallbackInput(uploadKey);
      return;
    }

    try {
      const handles = await browserWindow.showOpenFilePicker({
        multiple: false,
        types: [
          {
            description: "Excel Files",
            accept: {
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [
                ".xlsx"
              ],
              "application/vnd.ms-excel": [".xls"]
            }
          }
        ],
        excludeAcceptAllOption: true
      });

      const selectedFile = await handles[0]?.getFile();

      if (!selectedFile) {
        return;
      }

      applySelectedFile(uploadKey, selectedFile, "file-system-api");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }

      setUploadError(
        "تعذر فتح نافذة اختيار الملف. سيتم استخدام طريقة الرفع البديلة."
      );
      openFallbackInput(uploadKey);
    }
  }

  function openFallbackInput(uploadKey: UploadKey): void {
    if (uploadKey === "riskAgencyData") {
      riskAgencyInputRef.current?.click();
      return;
    }
    businessIntelligenceInputRef.current?.click();
  }

  function handleFallbackFileChange(
    uploadKey: UploadKey,
    event: ChangeEvent<HTMLInputElement>
  ): void {
    const selectedFile = event.target.files?.[0];

    if (!selectedFile) {
      return;
    }

    if (!canUploadData) {
      setUploadError("لا تملك صلاحية رفع ملفات البيانات.");
      event.target.value = "";
      return;
    }

    applySelectedFile(uploadKey, selectedFile, "input-fallback");
    event.target.value = "";
  }

  function applySelectedFile(
    uploadKey: UploadKey,
    file: File,
    source: UploadState["source"]
  ): void {
    if (!isSupportedExcelFile(file)) {
      setUploadError(
        "صيغة الملف غير مدعومة. الرجاء اختيار ملف Excel بصيغة XLSX أو XLS."
      );
      return;
    }

    setUploads((currentUploads) => ({
      ...currentUploads,
      [uploadKey]: { file, source }
    }));

    setRiskWorkbookResult(null);
    setBiWorkbookResult(null);
    setPopulationProcessingResult(null);
    setUploadError("");
    setProcessingMessage("");
  }

  function clearSelectedFile(uploadKey: UploadKey): void {
    setUploads((currentUploads) => ({
      ...currentUploads,
      [uploadKey]: { file: null, source: null }
    }));

    setRiskWorkbookResult(null);
    setBiWorkbookResult(null);
    setPopulationProcessingResult(null);
    setProcessingMessage("");
  }

  // W4/W10 (cheap half of the requested upload→process→compare restructure): this
  // used to both parse the uploaded workbook(s) AND immediately advance to Phase 2
  // in the same click. It now only parses, so the raw-file summary (rendered by
  // PhaseOneUpload once riskWorkbookResult/biWorkbookResult are set) is visible on
  // THIS page first — matching the owner's requested "upload sources, see general
  // info below them" flow. moveToNextPhase's generic phase-1 branch below performs
  // the actual advance once this has already run (a second "التالي" press).
  async function parsePhaseOneWorkbooks(): Promise<void> {
    if (!canUploadData) {
      setUploadError("لا تملك صلاحية قراءة ملفات البيانات.");
      return;
    }

    const riskFile = uploads.riskAgencyData.file;
    const biFile = uploads.businessIntelligenceData.file;

    if (!riskFile) {
      setUploadError(
        "يجب رفع ملف بيانات وكالة المخاطر قبل الانتقال إلى المرحلة التالية."
      );
      return;
    }

    setIsProcessingWorkbooks(true);
    setUploadError("");
    setProcessingMessage("");
    setPopulationProcessingResult(null);

    const activeTemplate = config.mappingTemplates[0];
    const worker = workerRef.current;
    if (!worker) {
      setProcessingMessage("تعذر تهيئة معالج البيانات.");
      setIsProcessingWorkbooks(false);
      return;
    }

    await new Promise<void>((resolve) => {
      const cleanup = () => {
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onError);
        setIsProcessingWorkbooks(false);
        resolve();
      };

      const onMessage = (ev: MessageEvent) => {
        const msg = ev.data as WorkbookWorkerResponse;
        if (msg.type === "progress") {
          setProcessingMessage(msg.message);
        } else if (msg.type === "done") {
          setRiskWorkbookResult(msg.riskResult);
          setBiWorkbookResult(msg.biResult);
          hasUnsavedSessionWorkRef.current = true;
          if (msg.warning) setProcessingMessage(msg.warning);
          // No longer advances the phase here — see this function's header
          // comment. Stays on Phase 1 so the raw-file summary renders.
          cleanup();
        } else {
          setProcessingMessage(
            "تعذر قراءة ملف بيانات وكالة المخاطر. تأكد من أن الملف بصيغة Excel وأن الصف الأول يحتوي على العناوين."
          );
          cleanup();
        }
      };

      const onError = () => {
        setProcessingMessage(
          "تعذر قراءة ملف بيانات وكالة المخاطر. تأكد من أن الملف بصيغة Excel وأن الصف الأول يحتوي على العناوين."
        );
        cleanup();
      };

      worker.addEventListener("message", onMessage);
      worker.addEventListener("error", onError);
      worker.postMessage({
        riskFile,
        biFile,
        riskSheetPatterns: activeTemplate?.sheetPatterns?.risk,
        biSheetPatterns: activeTemplate?.sheetPatterns?.bi,
        columnMappings: activeTemplate?.columnMappings,
        biColumnMappings: activeTemplate?.biColumnMappings,
      } satisfies WorkbookWorkerRequest);
    });
  }

  async function handleProcessPopulation(): Promise<void> {
    if (isLoadingMonthData) {
      setProcessingMessage("جارٍ تحميل بيانات الشهر — انتظر حتى يكتمل التحميل قبل المعالجة.");
      return;
    }
    if (!canProcessPopulation) {
      setProcessingMessage("لا تملك صلاحية معالجة المجتمع.");
      return;
    }

    if (!riskWorkbookResult) {
      setProcessingMessage("لا يمكن معالجة المجتمع قبل قراءة ملف وكالة المخاطر.");
      return;
    }

    // Capture the target folder so we can detect a month switch that resolves
    // while processing is in flight (CRITICAL 1c).
    const epochFolder = wizardFolderRef.current;
    setIsProcessingPopulation(true);
    setProcessingMessage("");
    setProcessingProgressMessage("بدء معالجة المجتمع...");
    setProcessingProgressPercent(0);

    try {
      const result = await processPopulation({
        riskWorkbookResult,
        biWorkbookResult,
        certScanPasteText
      }, (stage, percent) => {
        setProcessingProgressMessage(stage);
        setProcessingProgressPercent(percent);
      });

      // The global month changed while processing ran — committing would repopulate
      // the old month's rows under the new month's header and auto-save into the
      // wrong folder. Discard the stale result.
      if (wizardFolderRef.current !== epochFolder) {
        setProcessingMessage("تغيّر الشهر أثناء المعالجة — تم تجاهل النتيجة. أعد المحاولة للشهر الحالي.");
        return;
      }

      setPopulationProcessingResult(result);
      // Auto-save to disk after successful processing
      if (directoryHandle && riskWorkbookResult) {
        await performSaveToDisk(result, riskWorkbookResult);
      }
    } catch {
      setPopulationProcessingResult(null);
      setProcessingMessage(
        "تعذر تنفيذ معالجة المجتمع. تحقق من بيانات CertScan أو من بنية البيانات المقروءة."
      );
    } finally {
      setIsProcessingPopulation(false);
    }
  }

  // Persist certScan text globally whenever it changes
  function handleCertScanChange(text: string): void {
    if (!canProcessPopulation) {
      setProcessingMessage("لا تملك صلاحية تعديل بيانات CertScan المستخدمة في المعالجة.");
      return;
    }

    setCertScanPasteText(text);
    if (directoryHandle) {
      void saveCertScanGlobal(directoryHandle, text);
    }
  }

  function handleExportPopulation(): void {
    if (isLoadingMonthData) {
      setProcessingMessage("جارٍ تحميل بيانات الشهر — انتظر حتى يكتمل التحميل قبل التصدير.");
      return;
    }
    if (!canExportReports) {
      setProcessingMessage("لا تملك صلاحية تصدير التقارير.");
      return;
    }

    if (!populationProcessingResult || !riskWorkbookResult) {
      setProcessingMessage("لا توجد نتيجة معالجة جاهزة للتصدير.");
      return;
    }

    exportPopulationProcessingResult(
      populationProcessingResult,
      riskWorkbookResult,
      biWorkbookResult,
      config.exportTemplates[0]?.columns
    );
  }

  async function performSaveToDisk(
    processingResult: PopulationProcessingResult,
    riskResult: RiskWorkbookResult
  ): Promise<void> {
    if (!directoryHandle || !canProcessPopulation) {
      setSaveToDiskMessage({ type: "error", text: "لا تملك صلاحية حفظ بيانات المجتمع، أو أن مساحة العمل للقراءة فقط." });
      return;
    }

    // Guard: re-processing a month that already has a drawn sample would make
    // that sample no longer match the new population — confirm before overwriting.
    const monthFolderName = formatMonthFolderName(saveMonth, saveYear);
    const existingSample = await loadSampleMaster(directoryHandle, monthFolderName);
    if (existingSample) {
      setPendingReprocessSave({ processingResult, riskResult });
      return;
    }

    await commitSaveToDisk(processingResult, riskResult, false);
  }

  async function commitSaveToDisk(
    processingResult: PopulationProcessingResult,
    riskResult: RiskWorkbookResult,
    confirmedOverwrite: boolean
  ): Promise<void> {
    if (!directoryHandle || !canProcessPopulation) {
      setSaveToDiskMessage({ type: "error", text: "لا تملك صلاحية حفظ بيانات المجتمع، أو أن مساحة العمل للقراءة فقط." });
      return;
    }

    const username = sessionRef.current?.username ?? "unknown";
    setIsSavingToDisk(true);
    setSaveToDiskMessage(null);
    setSaveProgressPhase(null);

    try {
      const result = await saveMonthRun({
        directoryHandle,
        onSaveProgress: (phase) => setSaveProgressPhase(phase),
        month: saveMonth,
        year: saveYear,
        username,
        riskFileName: uploads.riskAgencyData.file?.name ?? null,
        biFileName: uploads.businessIntelligenceData.file?.name ?? null,
        riskSourceFile: uploads.riskAgencyData.file,
        biSourceFile: uploads.businessIntelligenceData.file,
        certScanUsed: certScanPasteText.trim().length > 0,
        riskRawRows: riskResult.rows as Array<Record<string, unknown>>,
        biRawRows: biWorkbookResult
          ? (biWorkbookResult.rows as Array<Record<string, unknown>>)
          : [],
        // Strip rawRow before persisting — raw data is already in risk.raw.json
        processedRows: processingResult.preparedRows.map(
          ({ rawRow: _rawRow, ...rest }) => rest
        ) as Array<Record<string, unknown>>,
        certScanRows: processingResult.summary.certScanRows,
        nonCertScanRows: processingResult.summary.nonCertScanRows,
        processingSummary: {
          removedRows: processingResult.removedRows,
          duplicateRows: processingResult.duplicateRows,
          invalidResultRows: processingResult.invalidResultRows,
          summary: processingResult.summary,
        },
        processingFingerprint: stableHash({
          risk: sourceFileMetadata(uploads.riskAgencyData.file),
          bi: sourceFileMetadata(uploads.businessIntelligenceData.file),
          certScan: stableHash(certScanPasteText.trim()),
          mappingTemplate: config.mappingTemplates[0] ?? null,
          stageMappings: config.stageMappings,
          workflow: config.processingWorkflow,
        }),
        sourceFiles: {
          risk: sourceFileMetadata(uploads.riskAgencyData.file),
          bi: sourceFileMetadata(uploads.businessIntelligenceData.file),
        },
        confirmedOverwrite,
      });

      if (result.ok) {
        setSaveToDiskMessage({
          type: "ok",
          text: `تم حفظ شهر ${result.monthFolderName} على القرص بنجاح.`
        });
        setMonthRefreshKey((k) => k + 1);
        hasUnsavedSessionWorkRef.current = false;
        void refreshMonths();
      } else if (result.sampleExists) {
        // A sample was drawn between the pre-check and the locked write (TOCTOU):
        // prompt for explicit overwrite confirmation instead of silently failing.
        setPendingReprocessSave({ processingResult, riskResult });
      } else {
        setSaveToDiskMessage({ type: "error", text: `فشل الحفظ: ${result.error}` });
      }
    } catch (error) {
      setSaveToDiskMessage({
        type: "error",
        text: error instanceof MonthClosedError
          ? getLabels().msg_month_closed_write_blocked
          : "حدث خطأ غير متوقع أثناء الحفظ.",
      });
    } finally {
      setIsSavingToDisk(false);
      setSaveProgressPhase(null);
    }
  }



  async function handleDrawSample(): Promise<void> {
    if (!canDrawSample) {
      setSampleSaveMessage({
        type: "error",
        text: "لا تملك صلاحية سحب العينة."
      });
      return;
    }

    // Phase A step 3d: a viewer whose scope deferred population (never drew/
    // processed before, no capability at load time -- but canDrawSample just
    // passed above, so they DO hold it now) gets it fetched here on demand.
    const population = await ensurePopulationLoaded();
    if (!population) {
      setSampleSaveMessage({
        type: "error",
        text: "يجب تنفيذ معالجة المجتمع أولاً قبل سحب العينة."
      });
      return;
    }

    setIsDrawingSample(true);
    setSampleSaveMessage(null);

    try {
      // Hard block: re-drawing after distribution would orphan every existing
      // assignment and answer (deriveCurrentDistribution drops events whose id
      // is not in the new sample rows). No cascade in this phase — abort.
      if (directoryHandle) {
        const monthFolderName = formatMonthFolderName(saveMonth, saveYear);
        const existingLog = await loadDistributionLog(directoryHandle, monthFolderName);
        if (existingLog.events.length > 0) {
          setSampleSaveMessage({ type: "error", text: getLabels().sample_redraw_blocked });
          return;
        }
      }

      setSampleDrawResult(null);
      const username = sessionRef.current?.username ?? "unknown";
      const drawResult = drawSample(
        population.preparedRows,
        { rngSeed: sampleSeed, samplingRules: config.samplingRules, stageMappings: config.stageMappings },
        username
      );

      if (!drawResult.ok) {
        setSampleSaveMessage({ type: "error", text: drawResult.reason });
        return;
      }

      setSampleDrawResult(drawResult.data);

      if (directoryHandle) {
        const monthFolderName = formatMonthFolderName(saveMonth, saveYear);
        const saveResult = await saveSampleMaster(
          directoryHandle,
          monthFolderName,
          drawResult.data
        );
        if (saveResult.ok) {
          await updateMonthStatus(directoryHandle, monthFolderName, "sampled");
          // A1: persist the documented sampling plan next to the sample master.
          // Best-effort — a plan-write failure must not fail the draw itself.
          try {
            // B4: fold the switching-rule advisory (prior-month suspicion signal)
            // into the plan. Advisory only — never changes the quotas above.
            const advisory = await loadPriorMonthAdvisory(directoryHandle, monthFolderName);
            const plan = buildSamplingPlan({
              monthFolderName,
              populationRows: population.preparedRows,
              sampleData: drawResult.data,
              createdBy: username,
              priorMonthAdvisory: advisory,
            });
            const planResult = await saveSamplingPlan(directoryHandle, monthFolderName, plan);
            if (!planResult.ok) {
              logError("population:save-sampling-plan", new Error(planResult.error));
            }
          } catch (planError) {
            logError("population:save-sampling-plan", planError);
          }
          void appendWorkspaceAction(directoryHandle, {
            actor: username,
            actorRole: sessionRef.current?.role ?? "unknown",
            action: "sample-drawn",
            monthFolderName,
            details: { seed: sampleSeed, totalActual: drawResult.data.totalActual },
          });
          setSampleSaveMessage({
            type: "ok",
            text: `تم حفظ العينة في ${monthFolderName}/sample/sample.master.json`
          });
          setMonthRefreshKey((k) => k + 1);
        } else {
          setSampleSaveMessage({
            type: "error",
            text: `تم سحب العينة ولكن فشل الحفظ: ${saveResult.error}`
          });
        }

        // Save sampling proof document
        await saveSamplingProof(directoryHandle, monthFolderName, {
          month: saveMonth,
          year: saveYear,
          monthFolderName,
          drawnAt: drawResult.data.drawnAt,
          drawnBy: sessionRef.current?.username ?? "unknown",
          rngSeed: sampleSeed,
          samplingRules: config.samplingRules,
          portAllocations: drawResult.data.portAllocations ?? [],
          totalRequested: drawResult.data.totalRequested,
          totalActual: drawResult.data.totalActual,
          certScanActual: drawResult.data.certScanActual,
          nonCertScanActual: drawResult.data.nonCertScanActual,
          certScanShortfalls: drawResult.data.certScanShortfalls ?? [],
        });
      }
    } catch (error) {
      if (error instanceof MonthClosedError) {
        setSampleSaveMessage({ type: "error", text: getLabels().msg_month_closed_write_blocked });
      } else {
        logError("population:draw-sample", error);
        setSampleSaveMessage({ type: "error", text: "حدث خطأ غير متوقع أثناء سحب العينة." });
      }
    } finally {
      setIsDrawingSample(false);
    }
  }

  // Owner requirement: admin unlock affordance directly in this tab (the
  // mechanism itself — reopenMonth — is unchanged; this only calls it).
  async function handleUnlockMonth(): Promise<void> {
    if (!directoryHandle || !canMutate("archive.closeMonth")) return;
    const monthFolderName = formatMonthFolderName(saveMonth, saveYear);
    setIsUnlockingMonth(true);
    try {
      const result = await reopenMonth(directoryHandle, monthFolderName, sessionRef.current?.username ?? "unknown");
      if (result.ok) {
        await refreshMonths();
        setMonthRefreshKey((k) => k + 1);
      } else {
        setProcessingMessage(result.error);
      }
    } finally {
      setIsUnlockingMonth(false);
    }
  }

  async function moveToNextPhase(): Promise<void> {
    if (currentPhase === 1 && !riskWorkbookResult) {
      // First "التالي" press on Phase 1: parse only, stay put so the raw-file
      // summary shows. A second press (riskWorkbookResult now set) falls
      // through to the generic advance below, same as every other phase.
      await parsePhaseOneWorkbooks();
      return;
    }

    // Gate Phase 2→3 on a completed processing result, and Phase 3→4 on a drawn
    // sample — mirror the Phase-1 gate so downstream phases never open with the
    // data they depend on still missing.
    if (currentPhase === 2 && !populationProcessingResult) {
      setProcessingMessage("يجب إتمام معالجة المجتمع أولاً قبل الانتقال إلى سحب العينة.");
      return;
    }
    if (currentPhase === 3 && !sampleDrawResult) {
      setProcessingMessage("يجب إتمام سحب العينة أولاً قبل الانتقال إلى التوزيع.");
      return;
    }

    setCompletedPhaseIds((currentCompletedPhases) =>
      currentCompletedPhases.includes(currentPhase)
        ? currentCompletedPhases
        : [...currentCompletedPhases, currentPhase]
    );

    setCurrentPhase((current) => Math.min(current + 1, PHASES.length));
  }

  function moveToPreviousPhase(): void {
    setCurrentPhase((current) => Math.max(current - 1, 1));
  }

  /* ---- next-step hint labels ---- */
  const PHASE_HINTS: Record<number, string> = {
    1: "التالي: عرض التقرير وتشغيل المعالجة",
    2: "التالي: ضبط قواعد اختيار العينة",
    3: "التالي: توزيع العينة على الموظفين",
    4: "اكتملت جميع المراحل"
  };

  return (
    <section className="population-page" aria-label="إدارة بيانات الأشعة">

      {/* ── Browse sub-tab (mounted once visited, hidden — not unmounted —
          afterward, so switching away and back doesn't re-load the full
          dataset; §M/§T) ── */}
      {visitedSubTabs.has("browse") && canViewBrowse && (
        <div hidden={activeSubTab !== "browse"}>{browseElement}</div>
      )}
      {activeSubTab === "browse" && !canViewBrowse && (
        <div className="placeholder-phase">
          <h2>غير مصرح</h2>
          <p>لا تملك صلاحية استعراض البيانات.</p>
        </div>
      )}

      {/* ── Process sub-tab ── */}
      {activeSubTab !== "process" ? null : (<>

      <PopulationHeader
        canConfigure={canConfigureSample}
        onOpenSettings={setSettingsModalMode}
      />
      <PopulationStatusBar
        month={saveMonth}
        year={saveYear}
        population={populationProcessingResult}
        populationAggregate={populationAggregate}
        sample={sampleDrawResult}
        distribution={distributionCurrent}
        biWorkbook={biWorkbookResult}
      />
      {/* ── Closed-month banner (Tier-1 Item A + owner's system/person-lock distinction) ── */}
      <ClosedMonthBanner
        visible={selectedMonthClosed}
        manifest={selectedMonthManifest}
        canUnlock={canMutate("archive.closeMonth")}
        isUnlocking={isUnlockingMonth}
        onUnlock={() => { void handleUnlockMonth(); }}
      />

      {/* ── Horizontal Stepper ── */}
      <PopulationStepper
        currentPhase={currentPhase}
        completedPhaseIds={completedPhaseIds}
        onSelect={setCurrentPhase}
      />

      {/* ── Active Phase Panel ── */}
      <main className="phase-panel">
        {/* Loading indicator renders for ALL phases so a mid-load Phase 3/4 view
            makes the in-flight month switch visible, not just Phase 1 (CRITICAL 1). */}
        {isLoadingMonthData && (
          <div className="month-picker-loading">جاري تحميل بيانات الشهر...</div>
        )}
        {currentPhase === 1 ? (
          <PhaseOneUpload
            uploads={uploads}
            uploadError={uploadError}
            processingMessage={processingMessage}
            isProcessingWorkbooks={isProcessingWorkbooks}
            canUpload={canUploadNow}
            riskAgencyInputRef={riskAgencyInputRef}
            businessIntelligenceInputRef={businessIntelligenceInputRef}
            onPickFile={pickExcelFile}
            onClearFile={clearSelectedFile}
            onFallbackFileChange={handleFallbackFileChange}
            riskWorkbookResult={riskWorkbookResult}
            biWorkbookResult={biWorkbookResult}
          />
        ) : null}

        {currentPhase === 2 ? (
          <PhaseTwoReportAndProcessing
            riskWorkbookResult={riskWorkbookResult}
            biWorkbookResult={biWorkbookResult}
            processingMessage={processingMessage}
            certScanPasteText={certScanPasteText}
            populationProcessingResult={populationProcessingResult}
            isProcessingPopulation={isProcessingPopulation}
            processingProgressMessage={processingProgressMessage}
            processingProgressPercent={processingProgressPercent}
            monthLabel={formatMonthFolderShortLabel(formatMonthFolderName(saveMonth, saveYear))}
            isSavingToDisk={isSavingToDisk}
            saveProgressPhase={saveProgressPhase}
            saveToDiskMessage={saveToDiskMessage}
            hasDiskWorkspace={Boolean(directoryHandle)}
            orphanScan={orphanScan}
            canProcess={canProcessNow}
            canExport={canExportNow}
            populationLocked={populationLocked}
            populationAggregate={populationAggregate}
            onProcessPopulation={handleProcessPopulation}
            onExportPopulation={handleExportPopulation}
          />
        ) : null}

        {currentPhase === 3 ? (
          <PhaseThreeSampling
            populationRows={populationProcessingResult?.preparedRows ?? []}
            sampleSeed={sampleSeed}
            isDrawingSample={isDrawingSample}
            sampleDrawResult={sampleDrawResult}
            sampleSaveMessage={sampleSaveMessage}
            config={config}
            userRole={sessionRef.current?.role ?? "employee"}
            currentUsername={sessionRef.current?.username ?? "unknown"}
            priorMonthAdvisory={priorMonthAdvisory}
            canDrawSample={canDrawSample}
            canConfigureSample={canConfigureSample}
            processingMessage={processingMessage}
            onConfigChange={handleConfigChange}
            onDrawSample={() => { void handleDrawSample(); }}
          />
        ) : null}

        {currentPhase === 4 ? (
          <PhaseFourDistribution
            sampleDrawResult={sampleDrawResult}
            distributionCurrent={distributionCurrent}
            distributionMessage={distributionMessage}
            isDistributing={isDistributing}
            distributionProgress={distributionProgress}
            canConfigure={canConfigureSample}
            canDistribute={canDistributeSamples}
            canBulkAssign={canBulkAssign}
            config={config}
            operatorUsername={sessionRef.current?.username ?? "unknown"}
            saveMonth={saveMonth}
            saveYear={saveYear}
            onConfigChange={handleConfigChange}
            onAssign={handleAssign}
            onReassign={handleReassign}
            onMarkComplete={handleMarkComplete}
            onRequestReplacement={handleRequestReplacement}
            onApplyBulkAssignment={handleApplyBulkAssignment}
          />
        ) : null}
      </main>

      <PopulationPhaseFooter
        currentPhase={currentPhase}
        hint={PHASE_HINTS[currentPhase]}
        busy={isProcessingWorkbooks || isProcessingPopulation}
        reading={isProcessingWorkbooks}
        nextDisabled={isProcessingWorkbooks || isProcessingPopulation || (currentPhase === 1 && !isPhaseOneComplete)}
        onPrevious={moveToPreviousPhase}
        onNext={() => { void moveToNextPhase(); }}
      />

      <MappingSettingsModal
        isOpen={settingsModalMode !== null}
        onClose={() => setSettingsModalMode(null)}
        mode={settingsModalMode ?? "mapping"}
        config={config}
        onConfigChange={handleConfigChange}
        certScanPasteText={certScanPasteText}
        onCertScanPasteTextChange={handleCertScanChange}
        sampleSeed={sampleSeed}
        onSampleSeedChange={setSampleSeed}
        processingContext={{
          riskFileName: uploads.riskAgencyData.file?.name ?? null,
          biFileName: uploads.businessIntelligenceData.file?.name ?? null,
          riskRows: riskWorkbookResult?.rows.length ?? null,
          biRows: biWorkbookResult?.rows.length ?? null,
          certScanProvided: certScanPasteText.trim().length > 0,
          finalRows: populationProcessingResult?.preparedRows.length ?? null,
          riskSheetNames: [
            ...(riskWorkbookResult?.sheetSummaries.map((sheet) => sheet.sheetName) ?? []),
            ...(riskWorkbookResult?.unknownSheetNames ?? [])
          ],
          biSheetNames: [
            ...(biWorkbookResult?.sheetSummaries.map((sheet) => sheet.sheetName) ?? []),
            ...(biWorkbookResult?.unknownSheetNames ?? [])
          ],
          riskColumnHints,
          biColumnHints
        }}
      />

      <ConfirmDialog
        open={pendingReprocessSave !== null}
        danger
        title={getLabels().population_reprocess_confirm_title}
        message={getLabels().population_reprocess_confirm_message}
        onConfirm={() => {
          const pending = pendingReprocessSave;
          setPendingReprocessSave(null);
          if (pending) {
            void commitSaveToDisk(pending.processingResult, pending.riskResult, true);
          }
        }}
        onCancel={() => {
          setPendingReprocessSave(null);
          setSaveToDiskMessage({ type: "error", text: getLabels().population_reprocess_cancelled });
        }}
      />
      </>)}
    </section>
  );
}
