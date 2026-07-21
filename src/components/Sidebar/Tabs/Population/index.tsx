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
import { logError, logRejection } from "../../../../data/storage/errorLogger";
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
  appendDistributionEvent,
  appendDistributionEvents,
  loadDistributionLog,
  loadOrDeriveDistributionCurrent,
  saveDistributionCurrent,
  type DistributionWriteProgress,
} from "../../../../data/distribution/distributionStorage";
import { loadAllEmployeeFiles } from "../../../../data/answers/answerStorage";
import { scanReferentialIntegrity, type OrphanScanResult } from "../../../../data/integrity/orphanScan";
import {
  buildAssignEvent,
  buildCompletedEvent,
  buildReassignEvent,
  buildReplacementRequestedEvent,
  deriveCurrentDistribution
} from "../../../../data/distribution/distributionLog";
import type {
  DistributionCurrentData,
  DistributionEvent
} from "../../../../data/distribution/distributionTypes";
import { drawSample } from "../../../../data/sampling/sampleAlgorithm";
import { approveSampleMaster, loadSampleMaster, saveSampleMaster } from "../../../../data/sampling/sampleStorage";
import { buildSamplingPlan, saveSamplingPlan } from "../../../../data/sampling/samplingPlanStorage";
import type { SamplingPlanPriorMonthAdvisory } from "../../../../data/sampling/samplingPlanStorage";
import { loadPriorMonthAdvisory } from "../../../../data/sampling/switchingRuleAdvisory";
import {
  evaluateApprovalEligibility,
  buildSampleApproval,
  isDistributionAllowed,
  sampleRequiresApproval,
} from "../../../../data/sampling/sampleApprovalRules";
import type { SampleMasterData } from "../../../../data/sampling/sampleTypes";
import { writeEmployeeXlsx } from "../../../../data/answers/employeeXlsx";
import { useWorkspace } from "../../../../data/workspace/useWorkspace";
import { useGlobalMonth } from "../../../../data/month/useGlobalMonth";

import type { BiWorkbookResult } from "./biData/biDataTypes";

import { exportPopulationProcessingResult } from "./processing/populationExporter";
import { processPopulation } from "./processing/populationProcessor";
import type { PopulationProcessingResult } from "./processing/populationProcessingTypes";

import { exportPopulationReport } from "./reporting/reportExporter";

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
import { MonthClosedError } from "../../../../data/population/monthLock";
import { appendWorkspaceAction } from "../../../../data/audit/actionLog";

import "./Population.css";
import { ConfirmDialog } from "../../../../components/ConfirmDialog/ConfirmDialog";
import BrowseDataView from "./BrowseDataView";
import {
  buildAssignedEntryMap,
  buildLoadedMonthState,
  distributionErrorText,
  isSupportedExcelFile,
  PHASES,
  sourceFileMetadata,
  stableHash
} from "./populationWorkflowHelpers";
import {
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
type DistributionProgressState = { percent: number; message: string } | null;

function distributionProgressFromWrite(progress: DistributionWriteProgress): Exclude<DistributionProgressState, null> {
  if (progress.phase === "events") {
    const ratio = progress.total === 0 ? 1 : progress.completed / progress.total;
    return {
      percent: 5 + Math.round(ratio * 65),
      message: `جارٍ حفظ التعيينات (${progress.completed.toLocaleString("ar-SA")} من ${progress.total.toLocaleString("ar-SA")})...`,
    };
  }
  if (progress.phase === "projection") {
    return { percent: 74, message: "جارٍ تحديث سجل التوزيع المجمع..." };
  }
  if (progress.phase === "verification") {
    return { percent: 82, message: "جارٍ التحقق من سلامة الحفظ..." };
  }
  return { percent: 86, message: "تم حفظ التعيينات، جارٍ تحديث حالة الشهر..." };
}

type SubTab = "process" | "browse";

export default function PopulationTab() {
  const { directoryHandle } = useWorkspace();
  const { can, canMutate } = usePermissions();
  const sessionRef = useRef(readSession());
  const [activeSubTab, setActiveSubTab] = useState<SubTab>("process");
  const {
    selection: globalMonth,
    setSelectedMonth: setGlobalMonth,
    refreshMonths,
    registerMonthChangeGuard,
    isSelectedMonthClosed,
  } = useGlobalMonth();
  // Month close-out (Tier-1 Item A): a closed month is view-only — draw and
  // distribution capabilities are withdrawn regardless of role permissions.
  const selectedMonthClosed = isSelectedMonthClosed;
  // True while an existing month's data is being loaded from disk. During this
  // window the in-memory population/sample/distribution still belong to the
  // PREVIOUS month while saveMonth/saveYear already point at the new one, so
  // every mutating capability is withdrawn until the load resolves (CRITICAL 1).
  const [isLoadingMonthData, setIsLoadingMonthData] = useState(false);
  const canUploadData = canMutate("upload-data");
  const canProcessPopulation = canMutate("process-population");
  const canConfigureSample = canMutate("configure-sample");
  const canDrawSample = canMutate("draw-sample") && !selectedMonthClosed && !isLoadingMonthData;
  const canDistributeSamples = canMutate("distribute-samples") && !selectedMonthClosed && !isLoadingMonthData;
  const canBulkAssign = canMutate("bulk-assign") && !selectedMonthClosed && !isLoadingMonthData;
  const canViewBrowse = can("view-browse");
  const canExportReports = can("export-reports");

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
      // The auto-load effect reacts to the selection change (guard included).
      setGlobalMonth(e.detail.folderName);
    };
    window.addEventListener("pop-load-month", handler as EventListener);
    return () => window.removeEventListener("pop-load-month", handler as EventListener);
  }, [setGlobalMonth]);

  async function handleLoadExistingMonth(info: MonthFolderInfo, token: number): Promise<void> {
    if (!directoryHandle) return;
    setIsLoadingMonthData(true);
    try {
      hasUnsavedSessionWorkRef.current = false;
      const data = await loadMonthForEditing(directoryHandle, info.folderName);
      if (token !== loadMonthTokenRef.current) return; // superseded by a newer month selection
      const loaded = buildLoadedMonthState(data);
      setRiskWorkbookResult(loaded.riskWorkbook);
      setBiWorkbookResult(loaded.biWorkbook);
      setPopulationProcessingResult(loaded.population);
      setSampleDrawResult(loaded.sample);
      // Loaded from disk → not a this-session draw, so the four-eyes gate treats it
      // as approved-by-legacy (B1) and does not block distribution of existing months.
      setSampleNeedsApproval(false);
      setDistributionCurrent(loaded.distribution);

      if (loaded.phase) {
        setCurrentPhase(loaded.phase.current);
        setCompletedPhaseIds(loaded.phase.completed);
      }
    } finally {
      if (token === loadMonthTokenRef.current) setIsLoadingMonthData(false);
    }
  }

  // Unsaved in-session work (parsed uploads not yet auto-saved) — switching the
  // global month would discard it, so the provider asks for confirmation first.
  const hasUnsavedSessionWorkRef = useRef(false);
  useEffect(
    () =>
      registerMonthChangeGuard(() =>
        hasUnsavedSessionWorkRef.current ? getLabels().gm_month_switch_confirm : null
      ),
    [registerMonthChangeGuard]
  );

  /** Clean Phase-1 state targeting the (pending) global month. */
  function resetForNewMonth(): void {
    hasUnsavedSessionWorkRef.current = false;
    // Clear unconditionally: a stale existing-month load may still be
    // in-flight (its token already invalidated by the caller), in which case
    // its own `finally` will skip clearing this flag once it resolves — so a
    // clean new-month state must clear it here itself, or the wizard would be
    // stuck permanently "loading" (CRITICAL — I-2 follow-up regression).
    setIsLoadingMonthData(false);
    setUploads({
      riskAgencyData: { file: null, source: null },
      businessIntelligenceData: { file: null, source: null },
    });
    setRiskWorkbookResult(null);
    setBiWorkbookResult(null);
    setPopulationProcessingResult(null);
    setSampleDrawResult(null);
    setSampleNeedsApproval(false);
    setDistributionCurrent(null);
    setSaveToDiskMessage(null);
    setSampleSaveMessage(null);
    setDistributionMessage(null);
    setUploadError("");
    setProcessingMessage("");
    setCurrentPhase(1);
    setCompletedPhaseIds([]);
    setPendingReprocessSave(null);
  }

  // The global month IS the wizard's month: selecting an existing month loads it
  // from disk; selecting a pending (new) month resets to a clean import flow.
  const loadMonthTokenRef = useRef(0);
  const loadedFolderRef = useRef<string | null>(null);
  useEffect(() => {
    if (!directoryHandle || globalMonth.kind === "none") return;
    if (loadedFolderRef.current === globalMonth.folderName) return;
    loadedFolderRef.current = globalMonth.folderName;
    if (globalMonth.kind === "existing") {
      const targetFolder = globalMonth.folderName;
      const token = ++loadMonthTokenRef.current;
      void handleLoadExistingMonth({
        month: globalMonth.month,
        year: globalMonth.year,
        folderName: globalMonth.folderName,
      }, token).catch((error) => {
        // Guarded on the token so a STALE (superseded) rejection can never
        // wipe a newer load's already-committed, successful data.
        if (token !== loadMonthTokenRef.current) return;
        // A rejected load leaves the previous month's data under this month's
        // header. Reset to a clean empty state, surface the failure, and clear
        // the stamp so re-selecting the same month retries the load (CRITICAL 1b).
        logError("population:auto-load-month", error);
        resetForNewMonth();
        setProcessingMessage("تعذر تحميل بيانات الشهر — أعد المحاولة");
        if (loadedFolderRef.current === targetFolder) loadedFolderRef.current = null;
      });
    } else {
      // Invalidate any in-flight existing-month load so it can never resolve
      // later and commit its stale data over this clean new-month reset.
      ++loadMonthTokenRef.current;
      resetForNewMonth();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleLoadExistingMonth/resetForNewMonth are stable per render cycle; keying on folderName prevents load loops
  }, [directoryHandle, globalMonth]);

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
  // B1 four-eyes gate: a sample drawn in THIS session must be approved by a second
  // person before distribution. Legacy/previous-session samples (loaded from disk,
  // flag stays false) are treated as approved-by-legacy so existing months aren't bricked.
  const [sampleNeedsApproval, setSampleNeedsApproval] = useState(false);
  // Reload-safe gate: a new-era sample (samplingAlgorithmVersion stamped) without an
  // approval requires one even when loaded from disk in a fresh session.
  const effectiveSampleNeedsApproval =
    sampleNeedsApproval ||
    (sampleDrawResult ? sampleRequiresApproval(sampleDrawResult) : false);
  const [isApprovingSample, setIsApprovingSample] = useState(false);
  // B4 switching-rule advisory computed for the currently-selected month.
  const [priorMonthAdvisory, setPriorMonthAdvisory] =
    useState<SamplingPlanPriorMonthAdvisory | null>(null);
  // B3 referential-integrity orphan scan for the selected month (Phase 2 view).
  const [orphanScan, setOrphanScan] = useState<OrphanScanResult | null>(null);

  // Phase 4 — distribution
  const [distributionCurrent, setDistributionCurrent] =
    useState<DistributionCurrentData | null>(null);
  const [distributionMessage, setDistributionMessage] = useState<SaveMessage>(null);
  const [isDistributing, setIsDistributing] = useState(false);
  const [distributionProgress, setDistributionProgress] = useState<DistributionProgressState>(null);

  const [uploads, setUploads] = useState<Record<UploadKey, UploadState>>({
    riskAgencyData: { file: null, source: null },
    businessIntelligenceData: { file: null, source: null }
  });

  const [uploadError, setUploadError] = useState("");
  const [processingMessage, setProcessingMessage] = useState("");
  const [isProcessingWorkbooks, setIsProcessingWorkbooks] = useState(false);
  const [isProcessingPopulation, setIsProcessingPopulation] = useState(false);

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

  async function processPhaseOneAndMoveNext(): Promise<void> {
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
          setCompletedPhaseIds((prev) =>
            prev.includes(1) ? prev : [...prev, 1]
          );
          setCurrentPhase(2);
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

  function handleExportPhaseTwoReport(): void {
    if (isLoadingMonthData) {
      setProcessingMessage("جارٍ تحميل بيانات الشهر — انتظر حتى يكتمل التحميل قبل التصدير.");
      return;
    }
    if (!canExportReports) {
      setProcessingMessage("لا تملك صلاحية تصدير التقارير.");
      return;
    }

    if (!riskWorkbookResult) {
      setProcessingMessage("لا توجد بيانات وكالة مخاطر جاهزة لتصدير التقرير.");
      return;
    }

    exportPopulationReport({
      scope: "phase-2",
      riskWorkbookResult,
      biWorkbookResult,
      populationProcessingResult
    });
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

    try {
      const result = await saveMonthRun({
        directoryHandle,
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

    if (!populationProcessingResult) {
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
        populationProcessingResult.preparedRows,
        { rngSeed: sampleSeed, samplingRules: config.samplingRules, stageMappings: config.stageMappings },
        username
      );

      if (!drawResult.ok) {
        setSampleSaveMessage({ type: "error", text: drawResult.reason });
        return;
      }

      setSampleDrawResult(drawResult.data);
      // B1: a freshly-drawn sample requires four-eyes approval before distribution.
      setSampleNeedsApproval(!drawResult.data.approval);

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
              populationRows: populationProcessingResult.preparedRows,
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

  // B1: four-eyes sample-release approval. Available to supervisor/manager/admin who
  // is NOT the drawer; admin may self-approve but an explicit warning note is recorded.
  async function handleApproveSample(): Promise<void> {
    if (!canDrawSample) {
      setSampleSaveMessage({ type: "error", text: "لا تملك صلاحية اعتماد العينة، أو أن مساحة العمل للقراءة فقط." });
      return;
    }
    if (isLoadingMonthData) {
      setSampleSaveMessage({ type: "error", text: "جارٍ تحميل بيانات الشهر — انتظر حتى يكتمل التحميل." });
      return;
    }
    if (!directoryHandle || !sampleDrawResult) {
      setSampleSaveMessage({ type: "error", text: getLabels().sample_approve_no_sample });
      return;
    }
    const role = sessionRef.current?.role ?? "guest";
    const username = sessionRef.current?.username ?? "unknown";
    const eligibility = evaluateApprovalEligibility(role, username, sampleDrawResult.drawnBy);
    if (!eligibility.allowed) {
      setSampleSaveMessage({
        type: "error",
        text: eligibility.reason === "self-approval-blocked"
          ? getLabels().sample_approve_self_blocked
          : getLabels().sample_approve_no_permission,
      });
      return;
    }
    setIsApprovingSample(true);
    setSampleSaveMessage(null);
    try {
      const monthFolderName = formatMonthFolderName(saveMonth, saveYear);
      const approval = buildSampleApproval({
        approvedBy: username,
        role,
        drawnBy: sampleDrawResult.drawnBy,
        approvedAt: new Date().toISOString(),
        selfApprovalNote: getLabels().sample_approve_admin_self_note,
      });
      const result = await approveSampleMaster(directoryHandle, monthFolderName, approval);
      if (result.ok) {
        setSampleDrawResult(result.data);
        setSampleNeedsApproval(false);
        void appendWorkspaceAction(directoryHandle, {
          actor: username,
          actorRole: role,
          action: "sample-drawn",
          monthFolderName,
          target: sampleDrawResult.drawnBy,
          details: { event: "sample-approved", selfApproval: eligibility.selfApproval },
        });
        setSampleSaveMessage({ type: "ok", text: getLabels().sample_approve_done });
      } else {
        setSampleSaveMessage({ type: "error", text: result.error });
      }
    } catch (error) {
      if (error instanceof MonthClosedError) {
        setSampleSaveMessage({ type: "error", text: getLabels().msg_month_closed_write_blocked });
      } else {
        logError("population:approve-sample", error);
        setSampleSaveMessage({ type: "error", text: "حدث خطأ غير متوقع أثناء اعتماد العينة." });
      }
    } finally {
      setIsApprovingSample(false);
    }
  }

  async function refreshDistribution(monthFolderName: string): Promise<void> {
    if (!directoryHandle) return;
    let sampleRows = sampleDrawResult?.rows ?? [];
    const log = await loadDistributionLog(directoryHandle, monthFolderName);

    // Guard: never derive against an empty row set while events exist — a
    // zeroed derive would PERSIST an empty snapshot + zeroed employee mirrors
    // (visible data loss). Fall back to the on-disk sample master.
    if (sampleRows.length === 0 && log.events.length > 0) {
      const master = await loadSampleMaster(directoryHandle, monthFolderName);
      sampleRows = master?.rows ?? [];
      if (sampleRows.length === 0) {
        logError(
          "population:refresh-distribution",
          new Error(`Refusing to persist zeroed distribution.current for ${monthFolderName}`)
        );
        setDistributionMessage({ type: "error", text: getLabels().msg_distribution_refresh_no_sample });
        return; // keep the existing on-disk snapshot untouched
      }
    }

    // Stamp logRevision so the next loadOrDeriveDistributionCurrent takes the fast path.
    const current: DistributionCurrentData = {
      ...deriveCurrentDistribution(log, sampleRows),
      logRevision: log.revision,
    };
    setDistributionCurrent(current);
    await saveDistributionCurrent(directoryHandle, monthFolderName, current);
    setMonthRefreshKey((k) => k + 1);
  }

  async function handleAssign(
    xrayImageId: string,
    assignedTo: string
  ): Promise<void> {
    if (!canDistributeSamples) {
      setDistributionMessage({ type: "error", text: "لا تملك صلاحية توزيع العينات." });
      return;
    }
    if (!directoryHandle || !sampleDrawResult) return;
    setIsDistributing(true);
    setDistributionMessage(null);
    const monthFolderName = formatMonthFolderName(saveMonth, saveYear);
    const username = sessionRef.current?.username ?? "unknown";
    const event = buildAssignEvent({ xrayImageId, assignedTo, eventBy: username });
    try {
      const result = await appendDistributionEvent(
        directoryHandle,
        monthFolderName,
        event
      );
      if (result.ok) {
        await updateMonthStatus(directoryHandle, monthFolderName, "distributed");
        await refreshDistribution(monthFolderName);
        setDistributionMessage({ type: "ok", text: "تم التعيين." });
      } else {
        setDistributionMessage({ type: "error", text: result.error });
      }
    } catch (error) {
      setDistributionMessage({ type: "error", text: distributionErrorText(error, getLabels().msg_month_closed_write_blocked) });
    } finally {
      setIsDistributing(false);
    }
  }

  async function handleReassign(
    xrayImageId: string,
    reassignedTo: string
  ): Promise<void> {
    if (!canDistributeSamples) {
      setDistributionMessage({ type: "error", text: "لا تملك صلاحية إعادة توزيع العينات." });
      return;
    }
    if (!directoryHandle || !sampleDrawResult) return;
    const existing = distributionCurrent?.entries.find(
      (e) => e.xrayImageId === xrayImageId
    );
    // A completed row is terminal for reassignment: moving it would either be
    // dropped by the derivation guard or lose the submitted answer. Require the
    // reopen flow first.
    if (existing?.status === "completed") {
      setDistributionMessage({
        type: "error",
        text: "لا يمكن إعادة تعيين عينة مكتملة — يجب إعادة فتحها أولاً عبر مسار إعادة الفتح.",
      });
      return;
    }
    setIsDistributing(true);
    setDistributionMessage(null);
    const monthFolderName = formatMonthFolderName(saveMonth, saveYear);
    const username = sessionRef.current?.username ?? "unknown";
    const event = buildReassignEvent({
      xrayImageId,
      assignedTo: existing?.assignedTo ?? reassignedTo,
      reassignedTo,
      eventBy: username
    });
    try {
      const result = await appendDistributionEvent(
        directoryHandle,
        monthFolderName,
        event
      );
      if (result.ok) {
        await refreshDistribution(monthFolderName);
        setDistributionMessage({ type: "ok", text: "تم إعادة التعيين." });
      } else {
        setDistributionMessage({ type: "error", text: result.error });
      }
    } catch (error) {
      setDistributionMessage({ type: "error", text: distributionErrorText(error, getLabels().msg_month_closed_write_blocked) });
    } finally {
      setIsDistributing(false);
    }
  }

  async function handleMarkComplete(xrayImageId: string): Promise<void> {
    if (!canDistributeSamples) {
      setDistributionMessage({ type: "error", text: "لا تملك صلاحية تعديل حالة التوزيع." });
      return;
    }
    if (!directoryHandle || !sampleDrawResult) return;
    setIsDistributing(true);
    setDistributionMessage(null);
    const monthFolderName = formatMonthFolderName(saveMonth, saveYear);
    const username = sessionRef.current?.username ?? "unknown";
    const existing = distributionCurrent?.entries.find(
      (e) => e.xrayImageId === xrayImageId
    );
    const event = buildCompletedEvent({
      xrayImageId,
      assignedTo: existing?.assignedTo ?? username,
      eventBy: username
    });
    try {
      const result = await appendDistributionEvent(
        directoryHandle,
        monthFolderName,
        event
      );
      if (result.ok) {
        await refreshDistribution(monthFolderName);
        setDistributionMessage({ type: "ok", text: "تم تعليم الصف كمكتمل." });
      } else {
        setDistributionMessage({ type: "error", text: result.error });
      }
    } catch (error) {
      setDistributionMessage({ type: "error", text: distributionErrorText(error, getLabels().msg_month_closed_write_blocked) });
    } finally {
      setIsDistributing(false);
    }
  }

  async function handleRequestReplacement(xrayImageId: string): Promise<void> {
    if (!canDistributeSamples) {
      setDistributionMessage({ type: "error", text: "لا تملك صلاحية طلب الاستبدال من شاشة التوزيع." });
      return;
    }
    if (!directoryHandle || !sampleDrawResult) return;
    setIsDistributing(true);
    setDistributionMessage(null);
    const monthFolderName = formatMonthFolderName(saveMonth, saveYear);
    const username = sessionRef.current?.username ?? "unknown";
    const existing = distributionCurrent?.entries.find(
      (e) => e.xrayImageId === xrayImageId
    );
    const event = buildReplacementRequestedEvent({
      xrayImageId,
      assignedTo: existing?.assignedTo ?? username,
      eventBy: username
    });
    try {
      const result = await appendDistributionEvent(
        directoryHandle,
        monthFolderName,
        event
      );
      if (result.ok) {
        await refreshDistribution(monthFolderName);
        setDistributionMessage({ type: "ok", text: "تم تسجيل طلب الاستبدال." });
      } else {
        setDistributionMessage({ type: "error", text: result.error });
      }
    } catch (error) {
      setDistributionMessage({ type: "error", text: distributionErrorText(error, getLabels().msg_month_closed_write_blocked) });
    } finally {
      setIsDistributing(false);
    }
  }

  async function handleApplyBulkAssignment(events: DistributionEvent[]): Promise<void> {
    if (!canBulkAssign) {
      setDistributionMessage({ type: "error", text: "لا تملك صلاحية التوزيع الجماعي." });
      return;
    }
    if (!directoryHandle || !sampleDrawResult) return;
    setIsDistributing(true);
    setDistributionMessage(null);
    setDistributionProgress({ percent: 2, message: "جارٍ تجهيز ملفات التعيينات للحفظ..." });
    const monthFolderName = formatMonthFolderName(saveMonth, saveYear);
    try {
      const result = await appendDistributionEvents(
        directoryHandle,
        monthFolderName,
        events,
        {
          onProgress: (progress) => setDistributionProgress(distributionProgressFromWrite(progress)),
        }
      );
      if (result.ok) {
        setDistributionProgress({ percent: 88, message: "جارٍ تحديث حالة الشهر..." });
        await updateMonthStatus(directoryHandle, monthFolderName, "distributed");
        void appendWorkspaceAction(directoryHandle, {
          actor: sessionRef.current?.username ?? "unknown",
          actorRole: sessionRef.current?.role ?? "unknown",
          action: "distribution-bulk-assigned",
          monthFolderName,
          details: { events: events.length },
        });
        setDistributionProgress({ percent: 92, message: "جارٍ بناء ملخص التوزيع النهائي..." });
        await refreshDistribution(monthFolderName);
        // Build per-employee entry lists then write one XLSX per employee (fire-and-forget).
        const assignedMap = buildAssignedEntryMap(events, sampleDrawResult.rows);
        for (const [emp, empEntries] of assignedMap) {
          void writeEmployeeXlsx(directoryHandle, monthFolderName, emp, empEntries).catch(() => undefined);
        }
        setDistributionProgress({ percent: 100, message: "اكتمل حفظ التوزيع بنجاح." });
        setDistributionMessage({ type: "ok", text: "تم تطبيق وحفظ التوزيع الجماعي بنجاح." });
      } else {
        setDistributionMessage({ type: "error", text: result.error });
      }
    } catch (error) {
      setDistributionMessage({ type: "error", text: distributionErrorText(error, getLabels().msg_month_closed_write_blocked) });
    } finally {
      setIsDistributing(false);
      setDistributionProgress(null);
    }
  }

  async function moveToNextPhase(): Promise<void> {
    if (currentPhase === 1) {
      await processPhaseOneAndMoveNext();
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
    // B1: four-eyes gate — a sample drawn this session must carry an approval before
    // distribution. Legacy/previous-session samples (sampleNeedsApproval=false) pass.
    if (
      currentPhase === 3 &&
      !isDistributionAllowed({ approval: sampleDrawResult?.approval, needsApproval: effectiveSampleNeedsApproval })
    ) {
      setSampleSaveMessage({ type: "error", text: getLabels().sample_gate_blocked });
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

      {/* ── Browse sub-tab ── */}
      {activeSubTab === "browse" && (
        canViewBrowse ? (
          <BrowseDataView
            directoryHandle={directoryHandle}
            refreshKey={monthRefreshKey}
            username={sessionRef.current?.username ?? "unknown"}
            config={config}
          />
        ) : (
          <div className="placeholder-phase">
            <h2>غير مصرح</h2>
            <p>لا تملك صلاحية استعراض البيانات.</p>
          </div>
        )
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
        sample={sampleDrawResult}
        distribution={distributionCurrent}
        biWorkbook={biWorkbookResult}
      />
      {/* ── Closed-month banner (Tier-1 Item A) ── */}
      {selectedMonthClosed ? (
        <div className="upload-warning" role="status">
          {getLabels().msg_month_closed_banner}
        </div>
      ) : null}

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
            riskAgencyInputRef={riskAgencyInputRef}
            businessIntelligenceInputRef={businessIntelligenceInputRef}
            onPickFile={pickExcelFile}
            onClearFile={clearSelectedFile}
            onFallbackFileChange={handleFallbackFileChange}
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
            saveToDiskMessage={saveToDiskMessage}
            hasDiskWorkspace={Boolean(directoryHandle)}
            orphanScan={orphanScan}
            onCertScanPasteTextChange={handleCertScanChange}
            onProcessPopulation={handleProcessPopulation}
            onExportPopulation={handleExportPopulation}
            onExportPhaseReport={handleExportPhaseTwoReport}
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
            sampleNeedsApproval={effectiveSampleNeedsApproval}
            isApprovingSample={isApprovingSample}
            onApproveSample={() => { void handleApproveSample(); }}
            onConfigChange={handleConfigChange}
            onSampleSeedChange={setSampleSeed}
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

        {currentPhase > 4 ? (
          <section className="placeholder-phase">
            <h2>{PHASES[currentPhase - 1]?.title ?? ""}</h2>
            <p>سيتم تطوير هذه المرحلة لاحقاً.</p>
          </section>
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
