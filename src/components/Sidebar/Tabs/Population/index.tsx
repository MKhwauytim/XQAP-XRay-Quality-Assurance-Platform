/* eslint-disable react-refresh/only-export-components */

import {
  useMemo,
  useRef,
  useState,
  useEffect,
  type CSSProperties,
  type ChangeEvent,
  type DragEvent
} from "react";
import * as XLSX from "xlsx";
import { Check, Settings2 } from "lucide-react";

import type { SidebarTabModule } from "../tabTypes";

import { readSession } from "../../../../auth/authSession";
import { usePermissions } from "../../../../auth/usePermissions";
import { currentMonthFolderInfo, formatMonthFolderName, parseMonthFolderName } from "../../../../data/population/monthFolder";
import type { MonthFolderInfo } from "../../../../data/population/monthFolder";
import {
  saveMonthRun,
  listMonthFolders,
  loadMonthForEditing,
  loadCertScanGlobal,
  saveCertScanGlobal,
  saveSamplingProof,
  loadBrowseRows,
  type BrowseDatasetKind,
  type BrowseRow,
} from "../../../../data/population/populationStorage";
import {
  appendDistributionEvent,
  appendDistributionEvents,
  loadOrDeriveDistributionCurrent,
  loadDistributionLog,
  saveDistributionCurrent
} from "../../../../data/distribution/distributionStorage";
import {
  buildAssignEvent,
  buildCompletedEvent,
  buildReassignEvent,
  buildReplacementRequestedEvent,
  deriveCurrentDistribution
} from "../../../../data/distribution/distributionLog";
import type {
  DistributionCurrentData,
  DistributionEntry,
  DistributionEvent
} from "../../../../data/distribution/distributionTypes";
import { drawSample } from "../../../../data/sampling/sampleAlgorithm";
import { loadSampleMaster, saveSampleMaster } from "../../../../data/sampling/sampleStorage";
import type { SampleMasterData } from "../../../../data/sampling/sampleTypes";
import {
  loadAdminBrowsePreset,
  loadUserBrowsePreset,
  saveAdminBrowseDatasetPreset,
  type UserBrowsePresetFile
} from "../../../../data/preferences/browsePresetStorage";
import { loadEmployeeAnswers } from "../../../../data/answers/answerStorage";
import { writeEmployeeXlsx } from "../../../../data/answers/employeeXlsx";
import { readUserManagementState } from "../../../../auth/userManagement";
import { useWorkspace } from "../../../../data/workspace/useWorkspace";

import type { BiWorkbookResult, NormalizedBiRow } from "./biData/biDataTypes";

import { exportPopulationProcessingResult } from "./processing/populationExporter";
import { processPopulation } from "./processing/populationProcessor";
import type { PopulationProcessingResult, PreparedPopulationRow } from "./processing/populationProcessingTypes";

import { exportPopulationReport } from "./reporting/reportExporter";

import type { NormalizedRiskRow, RiskWorkbookResult } from "./riskData/riskDataTypes";

import WorkbookWorker from "../../../../workers/workbookWorker?worker&inline";
import type { WorkbookWorkerRequest, WorkbookWorkerResponse } from "../../../../workers/workbookWorkerTypes";

import { formatStageLabel, getPhaseStatus, getStageKey } from "./components/helpers";
import PhaseOneUpload from "./components/PhaseOneUpload";
import PhaseTwoReportAndProcessing from "./components/PhaseTwoReportAndProcessing";
import PhaseThreeSampling from "./components/PhaseThreeSampling";
import PhaseFourDistribution from "./components/PhaseFourDistribution";
import MappingSettingsModal from "./components/MappingSettingsModal";
import {
  loadPopulationConfig,
  savePopulationConfig,
  type PopulationConfig,
  DEFAULT_POPULATION_CONFIG,
  DEFAULT_MAPPING_TEMPLATE,
  DEFAULT_SYSTEM_FIELDS
} from "../../../../data/population/populationConfig";

import "./Population.css";
import { PageHeader } from "../../../../components/PageHeader/PageHeader";

type UploadKey = "riskAgencyData" | "businessIntelligenceData";

type UploadState = {
  file: File | null;
  source: "file-system-api" | "input-fallback" | null;
};

type PhaseDefinition = {
  id: number;
  title: string;
  description: string;
};

const PHASES: PhaseDefinition[] = [
  {
    id: 1,
    title: "رفع البيانات",
    description: "رفع ملفات Excel المطلوبة لبدء معالجة بيانات المجتمع."
  },
  {
    id: 2,
    title: "تقرير البيانات والمعالجة",
    description: "عرض تقرير مصغر للملفات ثم متابعة منطق المعالجة."
  },
  {
    id: 3,
    title: "اختيار العينة",
    description: "تطبيق منطق اختيار العينة حسب قواعد العمل المعتمدة."
  },
  {
    id: 4,
    title: "توزيع العينة",
    description: "توزيع عناصر العينة على الموظفين المصرح لهم داخل النظام."
  }
];

function PopulationIcon() {
  return (
    <svg viewBox="0 0 24 24" className="sidebar-icon" aria-hidden="true">
      <path d="M8.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm7-1a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM8.5 13C5.5 13 3 15.1 3 17.7V19a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-1.3C14 15.1 11.5 13 8.5 13Zm7-1c-.7 0-1.4.1-2 .4 1.5 1.1 2.5 2.8 2.5 4.7V19a3 3 0 0 1-.2 1H20a1 1 0 0 0 1-1v-1.1c0-3.2-2.5-5.9-5.5-5.9Z" />
    </svg>
  );
}

export const tabConfig: SidebarTabModule["tabConfig"] = {
  id: "population",
  label: "إدارة بيانات الأشعة",
  order: 10,
  allowedRoles: ["guest", "employee", "supervisor", "manager", "admin"],
  icon: <PopulationIcon />,
  subTabs: [
    { id: "process", label: "معالجة المجتمع" },
    { id: "browse",  label: "استعراض بيانات الأشعة" },
  ]
};

function isSupportedExcelFile(file: File): boolean {
  const normalizedFileName = file.name.toLowerCase();
  return (
    normalizedFileName.endsWith(".xlsx") || normalizedFileName.endsWith(".xls")
  );
}

type SaveMessage = { type: "ok" | "error"; text: string } | null;

type SubTab = "process" | "browse";

export default function PopulationTab() {
  const { directoryHandle } = useWorkspace();
  const { can } = usePermissions();
  const sessionRef = useRef(readSession());
  const [activeSubTab, setActiveSubTab] = useState<SubTab>("process");
  const canUploadData = can("upload-data");
  const canProcessPopulation = can("process-population");
  const canConfigureSample = can("configure-sample");
  const canDrawSample = can("draw-sample");
  const canDistributeSamples = can("distribute-samples");
  const canBulkAssign = can("bulk-assign");
  const canViewBrowse = can("view-browse");
  const canExportReports = can("export-reports");

  const [config, setConfig] = useState<PopulationConfig>(DEFAULT_POPULATION_CONFIG);
  const [settingsModalMode, setSettingsModalMode] = useState<"mapping" | "processing" | null>(null);

  useEffect(() => {
    if (directoryHandle) {
      loadPopulationConfig(directoryHandle).then((c) => setConfig(c));
    } else {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync reset when workspace is disconnected; synchronizing with the FSA external system is the correct use of effects
      setConfig(DEFAULT_POPULATION_CONFIG);
    }
  }, [directoryHandle]);

  // Month picker state
  const [existingMonths, setExistingMonths] = useState<MonthFolderInfo[]>([]);
  const [isLoadingMonths, setIsLoadingMonths] = useState(false);
  const [isLoadingMonthData, setIsLoadingMonthData] = useState(false);
  const [monthRefreshKey, setMonthRefreshKey] = useState(0);

  useEffect(() => {
    if (!directoryHandle) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync cleanup when workspace is removed; effect correctly synchronizes with File System Access API
      setExistingMonths([]);
      return;
    }
    setIsLoadingMonths(true);
    listMonthFolders(directoryHandle)
      .then((months) => setExistingMonths([...months].reverse()))
      .catch(() => setExistingMonths([]))
      .finally(() => setIsLoadingMonths(false));
  }, [directoryHandle, monthRefreshKey]);

  // Load cumulative CertScan data from workspace on mount
  useEffect(() => {
    if (!directoryHandle) return;
    loadCertScanGlobal(directoryHandle).then((text) => {
      if (text) setCertScanPasteText(text);
    });
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
      void handleLoadExistingMonth(e.detail);
    };
    window.addEventListener("pop-load-month", handler as EventListener);
    return () => window.removeEventListener("pop-load-month", handler as EventListener);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [directoryHandle]);

  async function handleLoadExistingMonth(info: MonthFolderInfo): Promise<void> {
    if (!directoryHandle) return;
    setIsLoadingMonthData(true);
    try {
      const data = await loadMonthForEditing(directoryHandle, info.folderName);

      // Reconstruct RiskWorkbookResult from saved raw rows
      if (data.riskRawRows.length > 0) {
        const reconstructed: RiskWorkbookResult = {
          rows: data.riskRawRows as unknown as NormalizedRiskRow[],
          sheetSummaries: [],
          unknownSheetNames: [],
          totalOriginalRows: data.riskRawRows.length,
          totalNormalizedRows: data.riskRawRows.length,
          totalExcludedMissingXrayIdCount: 0,
        };
        setRiskWorkbookResult(reconstructed);
      }

      // Reconstruct BiWorkbookResult from saved raw rows
      if (data.biRawRows.length > 0) {
        const reconstructed: BiWorkbookResult = {
          rows: data.biRawRows as unknown as NormalizedBiRow[],
          sheetSummaries: [],
          unknownSheetNames: [],
          totalOriginalRows: data.biRawRows.length,
          totalNormalizedRows: data.biRawRows.length,
          totalExcludedMissingXrayIdCount: 0,
        };
        setBiWorkbookResult(reconstructed);
      }

      if (data.populationRows) {
        setPopulationProcessingResult({
          preparedRows: data.populationRows as unknown as PreparedPopulationRow[],
          removedRows: [],
          duplicateRows: [],
          invalidResultRows: [],
          summary: {
            riskOriginalRows: data.populationRows.length,
            validRiskIdRows: data.populationRows.length,
            invalidRiskIdRows: 0,
            duplicateRiskIdRows: 0,
            rowsAfterDeduplication: data.populationRows.length,
            removedInvalidResultRows: 0,
            finalPreparedPopulationRows: data.populationRows.length,
            certScanRows: data.certScanRows,
            nonCertScanRows: data.nonCertScanRows,
            certScanPercentage: data.populationRows.length > 0
              ? Math.round((data.certScanRows / data.populationRows.length) * 100)
              : 0,
            nonCertScanPercentage: data.populationRows.length > 0
              ? Math.round((data.nonCertScanRows / data.populationRows.length) * 100)
              : 0,
            biProvided: data.biRawRows.length > 0,
            biMatchedRows: 0,
            biUnmatchedRows: 0,
            biMatchPercentage: 0,
            totalBiFilledFields: 0,
            biFieldFillSummary: []
          }
        });
        setSaveMonth(info.month);
        setSaveYear(info.year);
      }

      if (data.sampleData) setSampleDrawResult(data.sampleData);
      if (data.distributionCurrent) setDistributionCurrent(data.distributionCurrent);

      if (data.distributionCurrent || data.sampleData) {
        setCurrentPhase(4);
        setCompletedPhaseIds([1, 2, 3]);
      } else if (data.populationRows) {
        setCurrentPhase(3);
        setCompletedPhaseIds([1, 2]);
      }
    } finally {
      setIsLoadingMonthData(false);
    }
  }

  async function handleConfigChange(newConfig: PopulationConfig) {
    if (!canConfigureSample) {
      setProcessingMessage("لا تملك صلاحية تعديل إعدادات المعالجة أو العينة.");
      return;
    }
    setConfig(newConfig);
    if (directoryHandle) {
      await savePopulationConfig(directoryHandle, newConfig);
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

  const initialMonth = currentMonthFolderInfo();
  const [saveMonth, setSaveMonth] = useState(initialMonth.month);
  const [saveYear, setSaveYear] = useState(initialMonth.year);
  const [isSavingToDisk, setIsSavingToDisk] = useState(false);
  const [saveToDiskMessage, setSaveToDiskMessage] = useState<SaveMessage>(null);

  // Phase 3 — sampling
  const [sampleSeed, setSampleSeed] = useState(() => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10));
  const [isDrawingSample, setIsDrawingSample] = useState(false);
  const [sampleDrawResult, setSampleDrawResult] =
    useState<SampleMasterData | null>(null);
  const [sampleSaveMessage, setSampleSaveMessage] =
    useState<SaveMessage>(null);

  // Phase 4 — distribution
  const [distributionCurrent, setDistributionCurrent] =
    useState<DistributionCurrentData | null>(null);
  const [distributionMessage, setDistributionMessage] =
    useState<SaveMessage>(null);
  const [isDistributing, setIsDistributing] = useState(false);

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
    if (!canProcessPopulation) {
      setProcessingMessage("لا تملك صلاحية معالجة المجتمع.");
      return;
    }

    if (!riskWorkbookResult) {
      setProcessingMessage("لا يمكن معالجة المجتمع قبل قراءة ملف وكالة المخاطر.");
      return;
    }

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
    if (!directoryHandle) return;

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
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          ({ rawRow: _rawRow, ...rest }) => rest
        ) as Array<Record<string, unknown>>,
        certScanRows: processingResult.summary.certScanRows,
        nonCertScanRows: processingResult.summary.nonCertScanRows
      });

      if (result.ok) {
        setSaveToDiskMessage({
          type: "ok",
          text: `تم حفظ شهر ${result.monthFolderName} على القرص بنجاح.`
        });
        setMonthRefreshKey((k) => k + 1);
      } else {
        setSaveToDiskMessage({ type: "error", text: `فشل الحفظ: ${result.error}` });
      }
    } catch {
      setSaveToDiskMessage({ type: "error", text: "حدث خطأ غير متوقع أثناء الحفظ." });
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
    setSampleDrawResult(null);

    try {
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

      if (directoryHandle) {
        const monthFolderName = formatMonthFolderName(saveMonth, saveYear);
        const saveResult = await saveSampleMaster(
          directoryHandle,
          monthFolderName,
          drawResult.data
        );
        if (saveResult.ok) {
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
    } finally {
      setIsDrawingSample(false);
    }
  }

  async function refreshDistribution(monthFolderName: string): Promise<void> {
    if (!directoryHandle) return;
    const sampleRows = sampleDrawResult?.rows ?? [];
    const log = await loadDistributionLog(directoryHandle, monthFolderName);
    const current = deriveCurrentDistribution(log, sampleRows);
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
    const result = await appendDistributionEvent(
      directoryHandle,
      monthFolderName,
      event
    );
    if (result.ok) {
      await refreshDistribution(monthFolderName);
      setDistributionMessage({ type: "ok", text: "تم التعيين." });
    } else {
      setDistributionMessage({ type: "error", text: result.error });
    }
    setIsDistributing(false);
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
    setIsDistributing(true);
    setDistributionMessage(null);
    const monthFolderName = formatMonthFolderName(saveMonth, saveYear);
    const username = sessionRef.current?.username ?? "unknown";
    const existing = distributionCurrent?.entries.find(
      (e) => e.xrayImageId === xrayImageId
    );
    const event = buildReassignEvent({
      xrayImageId,
      assignedTo: existing?.assignedTo ?? reassignedTo,
      reassignedTo,
      eventBy: username
    });
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
    setIsDistributing(false);
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
    setIsDistributing(false);
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
    setIsDistributing(false);
  }

  async function handleApplyBulkAssignment(events: DistributionEvent[]): Promise<void> {
    if (!canBulkAssign) {
      setDistributionMessage({ type: "error", text: "لا تملك صلاحية التوزيع الجماعي." });
      return;
    }
    if (!directoryHandle || !sampleDrawResult) return;
    setIsDistributing(true);
    setDistributionMessage(null);
    const monthFolderName = formatMonthFolderName(saveMonth, saveYear);
    const result = await appendDistributionEvents(
      directoryHandle,
      monthFolderName,
      events
    );
    if (result.ok) {
      await refreshDistribution(monthFolderName);
      // Build per-employee entry lists then write one XLSX per employee (fire-and-forget).
      const rowMap = new Map(sampleDrawResult.rows.map((r) => [r.xrayImageId, r]));
      const assignedMap = new Map<string, DistributionEntry[]>();
      for (const ev of events) {
        if (ev.eventType !== "assigned") continue;
        const row = rowMap.get(ev.xrayImageId);
        if (!row) continue;
        const entry: DistributionEntry = {
          xrayImageId: ev.xrayImageId,
          assignedTo: ev.assignedTo,
          status: "pending",
          replacedById: null,
          lastEventAt: ev.eventAt,
          row,
        };
        const list = assignedMap.get(ev.assignedTo) ?? [];
        list.push(entry);
        assignedMap.set(ev.assignedTo, list);
      }
      for (const [emp, empEntries] of assignedMap) {
        void writeEmployeeXlsx(directoryHandle, monthFolderName, emp, empEntries).catch(() => undefined);
      }
      setDistributionMessage({ type: "ok", text: "تم تطبيق وحفظ التوزيع الجماعي بنجاح." });
    } else {
      setDistributionMessage({ type: "error", text: result.error });
    }
    setIsDistributing(false);
  }

  async function moveToNextPhase(): Promise<void> {
    if (currentPhase === 1) {
      await processPhaseOneAndMoveNext();
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
            <p>لا تملك صلاحية استعراض بيانات الأشعة.</p>
          </div>
        )
      )}

      {/* ── Process sub-tab ── */}
      {activeSubTab !== "process" ? null : (<>

      {/* ── Header ── */}
      <PageHeader
        eyebrow="Population Processing"
        title="معالجة المجتمع"
        subtitle="مسار عمل مخصص لرفع بيانات المجتمع، تحضيرها، اختيار العينة، ثم توزيع العينة على الموظفين داخل النظام."
      >
        <div className="header-settings-stack">
          <button
            type="button"
            className="header-settings-btn"
            onClick={() => {
              if (canConfigureSample) {
                setSettingsModalMode("mapping");
              } else {
                setProcessingMessage("لا تملك صلاحية تعديل إعدادات الربط والتصدير.");
              }
            }}
            aria-label="فتح إعدادات الربط والتصدير"
            disabled={!canConfigureSample}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
            إعدادات الربط والتصدير
          </button>
          <button
            type="button"
            className="header-settings-btn"
            onClick={() => {
              if (canConfigureSample) {
                setSettingsModalMode("processing");
              } else {
                setProcessingMessage("لا تملك صلاحية تعديل إعدادات المعالجة.");
              }
            }}
            aria-label="فتح إعدادات المعالجة"
            disabled={!canConfigureSample}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 3v4"/><path d="M18 3v4"/><path d="M3 9h18"/><path d="M8 14h8"/><path d="M8 18h5"/><rect x="3" y="5" width="18" height="16" rx="2"/>
            </svg>
            إعدادات المعالجة
          </button>
        </div>
      </PageHeader>

      {/* ── Status Bar ── */}
      <div className="population-status-bar" aria-label="حالة معالجة المجتمع">
        <span className="status-bar-label">الحالة:</span>

        <div className="status-chip">
          <span className="status-chip-key">الشهر</span>
          <span className="status-chip-val">{saveMonth}/{saveYear}</span>
        </div>

        <div className="status-bar-divider" aria-hidden="true" />

        <div className="status-chip">
          <span className="status-chip-key">المجتمع</span>
          <span className={`status-chip-val ${populationProcessingResult ? "ok" : "idle"}`}>
            {populationProcessingResult
              ? `${populationProcessingResult.preparedRows.length.toLocaleString("ar-SA-u-nu-latn")} صف`
              : "—"}
          </span>
        </div>

        <div className="status-bar-divider" aria-hidden="true" />

        <div className="status-chip">
          <span className="status-chip-key">العينة</span>
          <span className={`status-chip-val ${sampleDrawResult ? "ok" : "idle"}`}>
            {sampleDrawResult
              ? `${sampleDrawResult.totalActual.toLocaleString("ar-SA-u-nu-latn")} عنصر`
              : "—"}
          </span>
        </div>

        <div className="status-bar-divider" aria-hidden="true" />

        <div className="status-chip">
          <span className="status-chip-key">التوزيع</span>
          <span className={`status-chip-val ${distributionCurrent && distributionCurrent.totalAssigned > 0 ? "ok" : "idle"}`}>
            {distributionCurrent && distributionCurrent.totalAssigned > 0
              ? `${distributionCurrent.totalAssigned.toLocaleString("ar-SA-u-nu-latn")} معين`
              : "—"}
          </span>
        </div>

        <div className="status-bar-divider" aria-hidden="true" />

        <div className="status-chip">
          <span className="status-chip-key">بيانات BI</span>
          <span className={`status-chip-val ${biWorkbookResult ? "ok" : "idle"}`}>
            {biWorkbookResult
              ? `${biWorkbookResult.totalNormalizedRows.toLocaleString("ar-SA-u-nu-latn")} صف`
              : "غير مرفوع"}
          </span>
        </div>
      </div>

      {/* ── Horizontal Stepper ── */}
      <nav className="phase-stepper" aria-label="مراحل معالجة المجتمع">
        {PHASES.map((phase) => {
          const status = getPhaseStatus(phase.id, currentPhase, completedPhaseIds);
          const isClickable = status === "completed" || status === "active";
          return (
            <div
              key={phase.id}
              className={`stepper-item ${status}${isClickable ? " clickable" : ""}`}
              aria-current={status === "active" ? "step" : undefined}
              role={isClickable ? "button" : undefined}
              tabIndex={isClickable ? 0 : undefined}
              onClick={() => isClickable && setCurrentPhase(phase.id)}
              onKeyDown={(e) => {
                if (isClickable && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  setCurrentPhase(phase.id);
                }
              }}
            >
              <div className="stepper-node">
                <div className="stepper-circle" aria-hidden="true">
                  {status === "completed" ? <Check size={13} /> : phase.id}
                </div>
                <div className="stepper-text">
                  <span className="stepper-num">المرحلة {phase.id}</span>
                  <strong className="stepper-title">{phase.title}</strong>
                  <span className="stepper-desc">{phase.description}</span>
                </div>
              </div>
            </div>
          );
        })}
      </nav>

      {/* ── Active Phase Panel ── */}
      <main className="phase-panel">
        {currentPhase === 1 ? (
          <>
            {directoryHandle && (isLoadingMonths || existingMonths.length > 0) && (
              <div className="month-picker-section">
                <div className="month-picker-header">
                  <h3>فتح شهر سابق</h3>
                  <p>اختر شهراً محفوظاً مسبقاً للمتابعة من حيث توقفت.</p>
                </div>
                {isLoadingMonthData && (
                  <div className="month-picker-loading">جاري تحميل بيانات الشهر...</div>
                )}
                <div className="month-picker-grid">
                  {isLoadingMonths ? (
                    <div className="month-picker-loading">جاري تحميل الأشهر المحفوظة...</div>
                  ) : (
                    existingMonths.map((s) => (
                      <button
                        key={s.folderName}
                        type="button"
                        className="month-card"
                        onClick={() => { void handleLoadExistingMonth(s); }}
                        disabled={isLoadingMonthData}
                      >
                        <span className="month-card-name">{s.folderName}</span>
                        <span className="month-card-rows">{s.month}/{s.year}</span>
                      </button>
                    ))
                  )}
                </div>
                <div className="month-picker-divider">
                  <span>أو ارفع بيانات شهر جديد</span>
                </div>
              </div>
            )}
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
          </>
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
            saveMonth={saveMonth}
            isSavingToDisk={isSavingToDisk}
            saveToDiskMessage={saveToDiskMessage}
            hasDiskWorkspace={Boolean(directoryHandle)}
            onCertScanPasteTextChange={handleCertScanChange}
            onProcessPopulation={handleProcessPopulation}
            onExportPopulation={handleExportPopulation}
            onExportPhaseReport={handleExportPhaseTwoReport}
            onMonthChange={setSaveMonth}
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

      <footer className="phase-actions">
        <p className="phase-actions-hint">
          {currentPhase < PHASES.length
            ? <strong>{PHASE_HINTS[currentPhase]}</strong>
            : <strong>اكتملت جميع المراحل <Check size={14} style={{ verticalAlign: "middle" }} /></strong>
          }
        </p>

        <button
          type="button"
          className="secondary-action"
          onClick={moveToPreviousPhase}
          disabled={currentPhase === 1 || isProcessingWorkbooks || isProcessingPopulation}
        >
          السابق →
        </button>

        {currentPhase < PHASES.length && (
          <button
            type="button"
            className="primary-action"
            onClick={() => { void moveToNextPhase(); }}
            disabled={
              isProcessingWorkbooks ||
              isProcessingPopulation ||
              (currentPhase === 1 && !isPhaseOneComplete)
            }
          >
            {isProcessingWorkbooks ? "جاري القراءة..." : "← التالي"}
          </button>
        )}
      </footer>

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
      </>)}
    </section>
  );
}

function normalizeHeaderToken(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[ـ]/g, "")
    .toLowerCase();
}

function buildColumnHintsFromRows(
  rows: Array<{ rawRow?: Record<string, unknown> }>,
  config: PopulationConfig
): Record<string, string[]> {
  const headers = new Set<string>();
  for (const row of rows.slice(0, 1500)) {
    for (const header of Object.keys(row.rawRow ?? {})) {
      if (header.trim()) headers.add(header.trim());
    }
  }

  const normalizedHeaders = Array.from(headers).map((header) => ({
    header,
    normalized: normalizeHeaderToken(header),
  }));
  const template = config.mappingTemplates[0] ?? DEFAULT_MAPPING_TEMPLATE;
  const hints: Record<string, string[]> = {};

  for (const field of config.systemFields.filter((item) => item.isRequired)) {
    const aliases = [
      field.labelAr,
      ...(template.columnMappings[field.key] ?? []),
      ...(template.biColumnMappings?.[field.key] ?? []),
    ].map(normalizeHeaderToken);
    const matches = normalizedHeaders
      .filter(({ normalized }) => aliases.some((alias) => normalized === alias || normalized.includes(alias) || alias.includes(normalized)))
      .map(({ header }) => header);
    hints[field.key] = Array.from(new Set(matches));
  }

  return hints;
}

// ── Browse sub-tab ────────────────────────────────────────────────────────────
const BROWSE_COLUMNS: { key: string; label: string; default: boolean }[] = [
  { key: "xrayImageId",           label: "معرف الأشعة",          default: true  },
  { key: "portName",              label: "المنفذ",               default: true  },
  { key: "stage",                 label: "المستوى",              default: true  },
  { key: "certScanStatus",        label: "CertScan",             default: true  },
  { key: "xrayLevelOneResult",    label: "نتيجة المستوى 1",      default: true  },
  { key: "xrayLevelTwoResult",    label: "نتيجة المستوى 2",      default: false },
  { key: "xrayEntryDate",         label: "تاريخ الدخول",         default: false },
  { key: "declarationNumber",     label: "رقم البيان",           default: false },
  { key: "plateOrContainerNumber",label: "رقم اللوحة/الحاوية",   default: false },
  { key: "movementType",          label: "نوع الحركة",           default: false },
  { key: "biEnrichmentStatus",    label: "حالة BI",              default: false },
  { key: "_monthFolder",          label: "الشهر المصدر",         default: true  },
];

type BrowseColumn = { key: string; label: string; default: boolean };

const RAW_COLUMN_LABELS: Record<string, string> = {
  source: "المصدر",
  portType: "نوع المنفذ",
  portCode: "رمز المنفذ",
  preliminaryDeclarationNumber: "رقم البيان المبدئي",
  declarationNumber: "رقم البيان",
  declarationDate: "تاريخ البيان",
  declarationHijriDate: "تاريخ البيان هجري",
  inboundOutboundType: "نوع الوارد/الصادر",
  declarationType: "نوع البيان",
  declarationStatus: "حالة البيان",
  chassisNumber: "رقم الهيكل",
  governance: "الحوكمة",
  levelOneEmployee: "موظف المستوى الأول",
  movementType: "نوع الحركة",
  plateOrContainerNumber: "رقم اللوحة/الحاوية",
  xrayEntryDate: "تاريخ دخول الأشعة",
  reportNumber: "رقم المحضر",
  targetedByRiskEngine: "مستهدف محرك المخاطر",
  riskMessage: "رسالة المخاطر",
  sourceSheetName: "اسم الورقة",
  sourceRowNumber: "رقم الصف في المصدر",
  certScanStatus: "حالة CertScan",
  certScanSnippet: "نص CertScan",
  originalCertScanSnippet: "نص CertScan الأصلي",
  biEnrichmentStatus: "حالة إثراء ذكاء الأعمال",
  biMatched: "مطابق في ذكاء الأعمال",
  biFilledFields: "حقول ذكاء الأعمال المضافة",
  xrayLevelOneResult: "نتيجة المستوى الأول",
  xrayLevelTwoResult: "نتيجة المستوى الثاني",
  stage: "المستوى",
  _monthFolder: "الشهر المصدر"
};

const NORMALIZED_COLUMN_LABELS: Record<string, string> = (() => {
  const labels: Record<string, string> = {};

  function add(key: string, label: string): void {
    labels[normalizeColumnKey(key)] = label;
  }

  for (const column of BROWSE_COLUMNS) {
    add(column.key, column.label);
  }

  for (const field of DEFAULT_SYSTEM_FIELDS) {
    add(field.key, field.labelAr);
  }

  for (const [fieldKey, aliases] of Object.entries(DEFAULT_MAPPING_TEMPLATE.columnMappings)) {
    const fieldLabel =
      DEFAULT_SYSTEM_FIELDS.find((field) => field.key === fieldKey)?.labelAr ??
      RAW_COLUMN_LABELS[fieldKey];

    if (!fieldLabel) {
      continue;
    }

    add(fieldKey, fieldLabel);
    for (const alias of aliases) {
      add(alias, fieldLabel);
    }
  }

  for (const [key, label] of Object.entries(RAW_COLUMN_LABELS)) {
    add(key, label);
  }

  return labels;
})();

function normalizeColumnKey(key: string): string {
  return key
    .trim()
    .replace(/[\s_\-/\\]+/g, "")
    .toLowerCase();
}

function getBrowseColumnLabel(key: string): string {
  return NORMALIZED_COLUMN_LABELS[normalizeColumnKey(key)] ?? key;
}

function buildBrowseColumns(rows: BrowseRow[]): BrowseColumn[] {
  const baseKeys = new Set(BROWSE_COLUMNS.map((column) => column.key));
  const dynamicKeys = new Set<string>();

  for (const row of rows.slice(0, 100)) {
    for (const key of Object.keys(row)) {
      if (key === "_month" || key === "_year" || baseKeys.has(key)) {
        continue;
      }
      dynamicKeys.add(key);
    }
  }

  return [
    ...BROWSE_COLUMNS,
    ...Array.from(dynamicKeys).map((key) => ({
      key,
      label: getBrowseColumnLabel(key),
      default: false
    }))
  ];
}

function orderBrowseColumns(
  columns: BrowseColumn[],
  columnOrder: string[]
): BrowseColumn[] {
  const orderIndex = new Map(columnOrder.map((key, index) => [key, index]));

  return [...columns].sort((first, second) => {
    const firstIndex = orderIndex.get(first.key) ?? Number.MAX_SAFE_INTEGER;
    const secondIndex = orderIndex.get(second.key) ?? Number.MAX_SAFE_INTEGER;

    if (firstIndex !== secondIndex) {
      return firstIndex - secondIndex;
    }

    return columns.indexOf(first) - columns.indexOf(second);
  });
}

function mergeColumnOrder(
  savedOrder: string[] | undefined,
  availableKeys: string[]
): string[] {
  if (!savedOrder || savedOrder.length === 0) {
    return availableKeys;
  }

  const available = new Set(availableKeys);
  const ordered = savedOrder.filter((key) => available.has(key));
  const missing = availableKeys.filter((key) => !ordered.includes(key));
  return [...ordered, ...missing];
}

function resolveVisibleColumns(
  dataset: BrowseDatasetKind,
  columns: BrowseColumn[],
  savedVisibleColumns: string[] | undefined
): Set<string> {
  const availableKeys = new Set(columns.map((column) => column.key));

  if (savedVisibleColumns && savedVisibleColumns.length > 0) {
    return new Set(savedVisibleColumns.filter((key) => availableKeys.has(key)));
  }

  return defaultVisibleColumns(dataset, columns);
}

function defaultVisibleColumns(
  dataset: BrowseDatasetKind,
  columns: BrowseColumn[]
): Set<string> {
  if (dataset === "population" || dataset === "sample") {
    return new Set(columns.filter((column) => column.default).map((column) => column.key));
  }

  const rawKeys = columns
    .filter((column) => !column.key.startsWith("_") && !BROWSE_COLUMNS.some((base) => base.key === column.key))
    .slice(0, 12)
    .map((column) => column.key);

  return new Set([...rawKeys, "_monthFolder"]);
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bv-stat-card">
      <span className="bv-stat-label">{label}</span>
      <strong className="bv-stat-value">{typeof value === "number" ? value.toLocaleString("ar-SA-u-nu-latn") : value}</strong>
      {sub && <span className="bv-stat-sub">{sub}</span>}
    </div>
  );
}

type MonthlySampleKpi = {
  monthFolder: string;
  totalAssigned: number;
  totalCompleted: number;
  totalTarget: number;
  completionPct: number;
  remaining: number;
  status: "complete" | "short" | "over";
  stageRows: Array<{
    stageKey: "first" | "second" | "third" | "fourth";
    label: string;
    assigned: number;
    completed: number;
    target: number | null;
    population: number;
    remaining: number;
    completionPct: number | null;
  }>;
};

type KpiDistributionEntry = {
  monthFolder: string;
  xrayImageId: string;
  status: "pending" | "completed" | "replacement-requested" | "replaced";
  stageKey: "first" | "second" | "third" | "fourth" | null;
};

function getRowStageKey(
  stage: unknown,
  stageMappings?: PopulationConfig["stageMappings"]
): "first" | "second" | "third" | "fourth" | null {
  const stageKey = getStageKey(String(stage ?? ""), stageMappings);
  return stageKey === "unknown" ? null : stageKey;
}

function buildMonthlySampleKpis(
  sampleRows: BrowseRow[],
  populationRows: BrowseRow[],
  distributionEntries: KpiDistributionEntry[],
  stageMappings?: PopulationConfig["stageMappings"]
): MonthlySampleKpi[] {
  const monthKeys = new Set<string>();
  for (const row of sampleRows) {
    if (row._monthFolder) monthKeys.add(row._monthFolder);
  }
  for (const row of populationRows) {
    if (row._monthFolder) monthKeys.add(row._monthFolder);
  }
  for (const entry of distributionEntries) {
    monthKeys.add(entry.monthFolder);
  }

  return Array.from(monthKeys)
    .map((monthFolder) => {
      const monthSampleRows = sampleRows.filter((row) => row._monthFolder === monthFolder);
      const monthPopulationRows = populationRows.filter((row) => row._monthFolder === monthFolder);
      const monthDistributionEntries = distributionEntries.filter((entry) => entry.monthFolder === monthFolder);
      const totalAssigned = monthSampleRows.length;
      const totalCompleted = monthDistributionEntries.filter((entry) => entry.status === "completed").length;
      const completionPct = totalAssigned > 0
        ? (totalCompleted / totalAssigned) * 100
        : 0;
      const remaining = Math.max(0, totalAssigned - totalCompleted);
      const status: MonthlySampleKpi["status"] =
        totalAssigned > 0 && totalCompleted === totalAssigned
          ? "complete"
          : totalCompleted > totalAssigned
            ? "over"
            : "short";

      const stageRows = (["first", "second", "third", "fourth"] as const).map((stageKey) => {
        const assigned = monthSampleRows.filter((row) => getRowStageKey(row["stage"], stageMappings) === stageKey).length;
        const completed = monthDistributionEntries.filter((entry) => entry.stageKey === stageKey && entry.status === "completed").length;
        const population = monthPopulationRows.filter((row) => getRowStageKey(row["stage"], stageMappings) === stageKey).length;
        const target = stageKey === "first"
          ? population
          : STAGE_SAMPLE_TARGETS[stageKey];

        return {
          stageKey,
          label: STAGE_LABELS_AR[stageKey],
          assigned,
          completed,
          target,
          population,
          remaining: Math.max(0, assigned - completed),
          completionPct: assigned > 0 ? (completed / assigned) * 100 : null
        };
      });

      return {
        monthFolder,
        totalAssigned,
        totalCompleted,
        totalTarget: MONTHLY_SAMPLE_TARGET,
        completionPct,
        remaining,
        status,
        stageRows
      };
    })
    .sort((first, second) => second.monthFolder.localeCompare(first.monthFolder));
}

const BROWSE_DATASETS: Array<{
  id: BrowseDatasetKind;
  label: string;
  description: string;
}> = [
  {
    id: "population",
    label: "المجتمع النهائي",
    description: "البيانات المعالجة التي تُستخدم لاحقاً لسحب العينة."
  },
  {
    id: "sample",
    label: "العينة المسحوبة",
    description: "السجلات التي تم اختيارها كعينة من المجتمع النهائي."
  },
  {
    id: "risk-raw",
    label: "تحليل المخاطر",
    description: "صفوف ملف المخاطر كما قُرئت من Excel ومحفوظة للرجوع فقط."
  },
  {
    id: "bi-raw",
    label: "ذكاء الأعمال",
    description: "صفوف ذكاء الأعمال كما قُرئت من Excel ومحفوظة للرجوع فقط."
  }
];

const MONTHLY_SAMPLE_TARGET = 6500;
const STAGE_SAMPLE_TARGETS: Record<"first" | "second" | "third" | "fourth", number | null> = {
  first: null,
  second: 2500,
  third: 1875,
  fourth: 1875
};

const STAGE_LABELS_AR: Record<"first" | "second" | "third" | "fourth", string> = {
  first: "المستوى الأول",
  second: "المستوى الثاني",
  third: "المستوى الثالث",
  fourth: "المستوى الرابع"
};

const STAGE_FILTER_ORDER: Record<string, number> = {
  "المستوى الأول": 1,
  "المستوى الثاني": 2,
  "المستوى الثالث": 3,
  "المستوى الرابع": 4
};

function compareBrowseFilterOptions(first: string, second: string): number {
  const firstStageOrder = STAGE_FILTER_ORDER[first];
  const secondStageOrder = STAGE_FILTER_ORDER[second];
  if (firstStageOrder !== undefined || secondStageOrder !== undefined) {
    return (firstStageOrder ?? Number.MAX_SAFE_INTEGER) - (secondStageOrder ?? Number.MAX_SAFE_INTEGER);
  }
  return first.localeCompare(second, "ar");
}

const MONTH_NAMES_AR = [
  "يناير",
  "فبراير",
  "مارس",
  "أبريل",
  "مايو",
  "يونيو",
  "يوليو",
  "أغسطس",
  "سبتمبر",
  "أكتوبر",
  "نوفمبر",
  "ديسمبر"
] as const;

function formatArabicMonthFolder(monthFolder: string): string {
  const info = parseMonthFolderName(monthFolder);
  if (!info) {
    return monthFolder;
  }

  return `${MONTH_NAMES_AR[info.month - 1]} ${info.year}`;
}

function collectMonthOptions(rows: BrowseRow[]): string[] {
  return Array.from(
    new Set(rows.map((row) => row._monthFolder).filter(Boolean))
  ).sort((first, second) => second.localeCompare(first));
}

function formatBrowseCellValue(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "—";
  }

  if (Array.isArray(value)) {
    return value.map(formatBrowseCellValue).join("، ");
  }

  if (typeof value === "boolean") {
    return value ? "نعم" : "لا";
  }

  return String(value);
}

function getBrowseDisplayValue(
  row: BrowseRow,
  key: string,
  stageMappings?: PopulationConfig["stageMappings"]
): string {
  if (key === "stage") {
    return formatStageLabel(row[key], stageMappings);
  }

  if (key === "_monthFolder") {
    return formatArabicMonthFolder(String(row[key] ?? ""));
  }

  return formatBrowseCellValue(row[key]);
}

function rowMatchesSearch(
  row: BrowseRow,
  search: string,
  stageMappings?: PopulationConfig["stageMappings"]
): boolean {
  const normalizedSearch = search.trim().toLowerCase();
  if (!normalizedSearch) {
    return true;
  }

  return Object.keys(row).some((key) =>
    getBrowseDisplayValue(row, key, stageMappings).toLowerCase().includes(normalizedSearch)
  );
}

function rowMatchesColumnFilters(
  row: BrowseRow,
  filters: Record<string, string[]>,
  exceptKey?: string,
  stageMappings?: PopulationConfig["stageMappings"]
): boolean {
  return Object.entries(filters).every(([key, selectedValues]) => {
    if (key === exceptKey || selectedValues.length === 0) {
      return true;
    }

    return selectedValues.includes(getBrowseDisplayValue(row, key, stageMappings));
  });
}

function safeExportFileName(value: string): string {
  // eslint-disable-next-line no-control-regex -- intentionally strips ASCII control characters (U+0000-U+001F) from file names
  return value.replace(/[<>:"/\\|?*\u0000-\u001F]+/g, "-").replace(/\s+/g, "_");
}

function BrowseDataView({
  directoryHandle,
  refreshKey,
  username,
  config
}: {
  directoryHandle: unknown;
  refreshKey: number;
  username: string;
  config: PopulationConfig;
}) {
  const [dataset, setDataset] = useState<BrowseDatasetKind>("population");
  const [view, setView] = useState<"graphic" | "table">("graphic");
  const [rows, setRows] = useState<BrowseRow[]>([]);
  const [kpiSampleRows, setKpiSampleRows] = useState<BrowseRow[]>([]);
  const [kpiPopulationRows, setKpiPopulationRows] = useState<BrowseRow[]>([]);
  const [kpiDistributionEntries, setKpiDistributionEntries] = useState<KpiDistributionEntry[]>([]);
  const [selectedMonthFilter, setSelectedMonthFilter] = useState("all");
  const [loading, setLoading] = useState(false);
  const [browsePreset, setBrowsePreset] = useState<UserBrowsePresetFile | null>(null);
  const [isPresetLoaded, setIsPresetLoaded] = useState(false);
  const [visibleCols, setVisibleCols] = useState<Set<string>>(
    () => new Set(BROWSE_COLUMNS.filter((c) => c.default).map((c) => c.key))
  );
  const [columnOrder, setColumnOrder] = useState<string[]>(
    () => BROWSE_COLUMNS.map((column) => column.key)
  );
  const [draggedColumnKey, setDraggedColumnKey] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [columnFilters, setColumnFilters] = useState<Record<string, string[]>>({});
  const [openFilterColumn, setOpenFilterColumn] = useState<string | null>(null);
  const [colPickerOpen, setColPickerOpen] = useState(false);

  useEffect(() => {
    if (!directoryHandle) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync cleanup when workspace is removed; effect correctly synchronizes with File System Access API
      setBrowsePreset(null);
      setIsPresetLoaded(true);
      return;
    }

    setIsPresetLoaded(false);
    const workspaceHandle = directoryHandle as Parameters<typeof loadUserBrowsePreset>[0];
    void Promise.all([
      loadAdminBrowsePreset(workspaceHandle),
      loadUserBrowsePreset(workspaceHandle, username)
    ])
      .then(([adminPreset, userPreset]) => {
        setBrowsePreset({
          username,
          browseData: {
            ...userPreset.browseData,
            ...adminPreset.browseData
          }
        });
      })
      .catch(() => setBrowsePreset({ username, browseData: {} }))
      .finally(() => setIsPresetLoaded(true));
  }, [directoryHandle, username]);

  useEffect(() => {
    if (!directoryHandle || !isPresetLoaded) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync loading indicator before async browse row load; necessary to show spinner while data fetches
    setLoading(true);
    loadBrowseRows(
      directoryHandle as Parameters<typeof loadBrowseRows>[0],
      dataset
    )
      .then((nextRows) => {
        const nextColumns = buildBrowseColumns(nextRows);
        const datasetPreset = browsePreset?.browseData[dataset];
        const nextOrder = mergeColumnOrder(
          datasetPreset?.columnOrder,
          nextColumns.map((column) => column.key)
        );
        const nextVisible = resolveVisibleColumns(
          dataset,
          nextColumns,
          datasetPreset?.visibleColumns
        );

        setRows(nextRows);
        setColumnOrder(nextOrder);
        setVisibleCols(nextVisible);
      })
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [browsePreset, dataset, directoryHandle, isPresetLoaded, refreshKey]);

  useEffect(() => {
    const workspaceHandle = directoryHandle as Parameters<typeof loadBrowseRows>[0] | null;

    const promise = workspaceHandle
      ? Promise.all([
          loadBrowseRows(workspaceHandle, "sample"),
          loadBrowseRows(workspaceHandle, "population"),
          listMonthFolders(workspaceHandle)
        ])
      : Promise.resolve([[], [], []] as [BrowseRow[], BrowseRow[], MonthFolderInfo[]]);


    void promise
      .then(async ([sampleRows, populationRows, months]) => {
        if (!workspaceHandle) {
          setKpiSampleRows([]);
          setKpiPopulationRows([]);
          setKpiDistributionEntries([]);
          return;
        }
        const [distributions, answersPerMonth] = await Promise.all([
          Promise.all(
            months.map(async (month) => {
              const sample = await loadSampleMaster(workspaceHandle, month.folderName);
              return {
                monthFolder: month.folderName,
                current: sample
                  ? await loadOrDeriveDistributionCurrent(
                      workspaceHandle,
                      month.folderName,
                      sample.rows
                    )
                  : null
              };
            })
          ),
          // Build a submitted-answer Set per month by loading all active employees' files
          (async () => {
            const usernames = readUserManagementState().users
              .filter((u) => u.isActive)
              .map((u) => u.username);
            const byMonth = new Map<string, Set<string>>();
            await Promise.all(
              months.map(async (month) => {
                const files = await Promise.all(
                  usernames.map((u) =>
                    loadEmployeeAnswers(workspaceHandle, month.folderName, u)
                  )
                );
                const submitted = new Set<string>();
                for (const file of files) {
                  for (const item of file.items) {
                    if (item.status === "submitted") submitted.add(item.xrayImageId);
                  }
                }
                byMonth.set(month.folderName, submitted);
              })
            );
            return byMonth;
          })(),
        ]);

        setKpiSampleRows(sampleRows);
        setKpiPopulationRows(populationRows);
        setKpiDistributionEntries(
          distributions.flatMap(({ monthFolder, current }) => {
            const submittedIds = answersPerMonth.get(monthFolder) ?? new Set<string>();
            return (current?.entries ?? []).map((entry) => ({
              monthFolder,
              xrayImageId: entry.xrayImageId,
              // An entry is "completed" when the assigned employee has submitted answers for it
              status: submittedIds.has(entry.xrayImageId) ? "completed" : entry.status,
              stageKey: getRowStageKey(entry.row.stage, config.stageMappings)
            }));
          })
        );
      })
      .catch(() => {
        setKpiSampleRows([]);
        setKpiPopulationRows([]);
        setKpiDistributionEntries([]);
      });
  }, [directoryHandle, refreshKey, config.stageMappings]);

  const monthOptions = useMemo(
    () =>
      Array.from(
        new Set([
          ...collectMonthOptions([...rows, ...kpiSampleRows, ...kpiPopulationRows]),
          ...kpiDistributionEntries.map((entry) => entry.monthFolder)
        ])
      ).sort((first, second) => second.localeCompare(first)),
    [kpiDistributionEntries, kpiPopulationRows, kpiSampleRows, rows]
  );

  const effectiveMonthFilter = useMemo(
    () =>
      selectedMonthFilter === "all" || monthOptions.includes(selectedMonthFilter)
        ? selectedMonthFilter
        : "all",
    [monthOptions, selectedMonthFilter]
  );

  const monthFilteredRows = useMemo(
    () =>
      effectiveMonthFilter === "all"
        ? rows
        : rows.filter((row) => row._monthFolder === effectiveMonthFilter),
    [rows, effectiveMonthFilter]
  );
  const monthFilteredSampleRows = useMemo(
    () =>
      effectiveMonthFilter === "all"
        ? kpiSampleRows
        : kpiSampleRows.filter((row) => row._monthFolder === effectiveMonthFilter),
    [kpiSampleRows, effectiveMonthFilter]
  );
  const monthFilteredPopulationRows = useMemo(
    () =>
      effectiveMonthFilter === "all"
        ? kpiPopulationRows
        : kpiPopulationRows.filter((row) => row._monthFolder === effectiveMonthFilter),
    [kpiPopulationRows, effectiveMonthFilter]
  );
  const monthFilteredDistributionEntries = useMemo(
    () =>
      effectiveMonthFilter === "all"
        ? kpiDistributionEntries
        : kpiDistributionEntries.filter((entry) => entry.monthFolder === effectiveMonthFilter),
    [kpiDistributionEntries, effectiveMonthFilter]
  );

  // LINT-01c: Instead of a setState-in-effect, reset column filters by
  // deriving the key from `dataset` and using it as a React key on the
  // filter container (see BrowseDataView render). Here we set state
  // safely inside a microtask to avoid the synchronous-setState lint error.
  useEffect(() => {
    const id = setTimeout(() => {
      setColumnFilters({});
      setOpenFilterColumn(null);
    }, 0);
    return () => clearTimeout(id);
  }, [dataset]);

  // ── Derived stats ──
  const total = monthFilteredRows.length;

  const browseColumns = useMemo(() => buildBrowseColumns(rows), [rows]);
  const orderedColumns = useMemo(
    () => orderBrowseColumns(browseColumns, columnOrder),
    [browseColumns, columnOrder]
  );
  const activeCols = orderedColumns.filter((c) => visibleCols.has(c.key));
  const activeDataset = BROWSE_DATASETS.find((item) => item.id === dataset) ?? BROWSE_DATASETS[0]!;

  // ── Filtered table rows ──
  const searchFilteredRows = useMemo(
    () => monthFilteredRows.filter((row) => rowMatchesSearch(row, search, config.stageMappings)),
    [monthFilteredRows, search, config.stageMappings]
  );
  const filteredRows = useMemo(
    () =>
      searchFilteredRows.filter((row) =>
        rowMatchesColumnFilters(row, columnFilters, undefined, config.stageMappings)
      ),
    [columnFilters, searchFilteredRows, config.stageMappings]
  );
  const activeFilterCount = Object.values(columnFilters).filter((values) => values.length > 0).length;
  const monthlyKpis = useMemo(
    () =>
      buildMonthlySampleKpis(
        monthFilteredSampleRows,
        monthFilteredPopulationRows,
        monthFilteredDistributionEntries,
        config.stageMappings
      ),
    [monthFilteredDistributionEntries, monthFilteredPopulationRows, monthFilteredSampleRows, config.stageMappings]
  );
  const latestKpi = monthlyKpis[0] ?? null;

  function saveCurrentPreset(nextOrder: string[], nextVisible: Set<string>): void {
    if (!directoryHandle) {
      return;
    }

    const visibleColumns = Array.from(nextVisible);
    const datasetPreset = {
      columnOrder: nextOrder,
      visibleColumns
    };

    setBrowsePreset((current) => ({
      username,
      browseData: {
        ...(current?.browseData ?? {}),
        [dataset]: {
          ...datasetPreset,
          updatedAt: new Date().toISOString()
        }
      }
    }));

    if (readSession()?.role === "admin") {
      void saveAdminBrowseDatasetPreset(
        directoryHandle as Parameters<typeof saveAdminBrowseDatasetPreset>[0],
        dataset,
        datasetPreset
      );
    }
  }

  function handleColumnDrop(targetKey: string): void {
    if (!draggedColumnKey || draggedColumnKey === targetKey) {
      setDraggedColumnKey(null);
      return;
    }

    setColumnOrder((currentOrder) => {
      const currentKeys = orderedColumns.map((column) => column.key);
      const baseOrder = currentOrder.length > 0 ? currentOrder : currentKeys;
      const nextOrder = baseOrder.filter((key) => key !== draggedColumnKey);
      const targetIndex = nextOrder.indexOf(targetKey);

      if (targetIndex === -1) {
        return baseOrder;
      }

      nextOrder.splice(targetIndex, 0, draggedColumnKey);
      saveCurrentPreset(nextOrder, visibleCols);
      return nextOrder;
    });
    setDraggedColumnKey(null);
  }

  function handleColumnDragOver(event: DragEvent<HTMLTableCellElement>): void {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }

  function getColumnFilterOptions(columnKey: string): string[] {
    return Array.from(
      new Set(filteredRows.map((row) => getBrowseDisplayValue(row, columnKey, config.stageMappings)))
    ).sort(compareBrowseFilterOptions);
  }

  function toggleColumnFilterValue(columnKey: string, value: string): void {
    setColumnFilters((current) => {
      const selected = new Set(current[columnKey] ?? []);
      if (selected.has(value)) {
        selected.delete(value);
      } else {
        selected.add(value);
      }

      const next = { ...current };
      if (selected.size === 0) {
        delete next[columnKey];
      } else {
        next[columnKey] = Array.from(selected);
      }
      return next;
    });
  }

  function clearColumnFilter(columnKey: string): void {
    setColumnFilters((current) => {
      const next = { ...current };
      delete next[columnKey];
      return next;
    });
  }

  function clearAllTableFilters(): void {
    setSearch("");
    setColumnFilters({});
    setOpenFilterColumn(null);
  }

  function exportFilteredRowsToXlsx(): void {
    const header = activeCols.map((column) => column.label);
    const body = filteredRows.map((row) =>
      activeCols.map((column) => getBrowseDisplayValue(row, column.key, config.stageMappings))
    );
    const worksheet = XLSX.utils.aoa_to_sheet([header, ...body]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "البيانات");

    const monthName =
      selectedMonthFilter === "all"
        ? "كل الأشهر"
        : formatArabicMonthFolder(selectedMonthFilter);
    const fileName = safeExportFileName(
      `استعراض بيانات الأشعة - ${activeDataset.label} - ${monthName}.xlsx`
    );

    XLSX.writeFile(workbook, fileName);
  }

  if (!directoryHandle) {
    return (
      <div className="placeholder-phase" style={{ marginTop: 40 }}>
        <p>يجب اختيار مساحة عمل أولاً.</p>
      </div>
    );
  }

  return (
    <section className="browse-data-view" aria-label="استعراض بيانات الأشعة">
      <PageHeader
        eyebrow="Browse Data"
        title="استعراض بيانات الأشعة"
        subtitle={activeDataset.description}
      >
        <div className="bv-header-actions">
          <label className="bv-month-filter" htmlFor="browseMonthFilter">
            <span>الشهر</span>
            <select
              id="browseMonthFilter"
              value={selectedMonthFilter}
              onChange={(event) => setSelectedMonthFilter(event.target.value)}
            >
              <option value="all">كل الأشهر</option>
              {monthOptions.map((monthFolder) => (
                <option key={monthFolder} value={monthFolder}>
                  {formatArabicMonthFolder(monthFolder)}
                </option>
              ))}
            </select>
          </label>
          <div className="bv-view-toggle" role="group" aria-label="طريقة العرض">
            <button
              type="button"
              className={`bv-toggle-btn${view === "graphic" ? " active" : ""}`}
              onClick={() => {
                setDataset("population");
                setView("graphic");
              }}
            >
              مؤشرات
            </button>
            <button
              type="button"
              className={`bv-toggle-btn${view === "table" ? " active" : ""}`}
              onClick={() => setView("table")}
            >
              البيانات
            </button>
          </div>
        </div>
      </PageHeader>

      {view === "table" && (
        <div className="bv-dataset-row">
          <div className="bv-dataset-toggle" role="group" aria-label="مصدر البيانات">
            {BROWSE_DATASETS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`bv-toggle-btn${dataset === item.id ? " active" : ""}`}
                onClick={() => setDataset(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {loading && (
        <div className="bv-loading">جاري تحميل بيانات جميع الأشهر...</div>
      )}

      {!loading && total === 0 && (
        <div className="placeholder-phase">
          <p>لا توجد بيانات محفوظة لهذا المصدر بعد. ابدأ بمعالجة شهر من تبويب معالجة المجتمع.</p>
        </div>
      )}

      {!loading && total > 0 && view === "graphic" && (
        <div className="bv-graphic">
          {latestKpi && (
            <div className="bv-kpi-dashboard" aria-label="متابعة عينة الشهر">
              <section className={`bv-kpi-hero ${latestKpi.status}`}>
                <div className="bv-kpi-hero-main">
                  <span className="bv-kpi-label">مؤشر الشهر الرئيسي</span>
                  <h2>العينة المدروسة لشهر {formatArabicMonthFolder(latestKpi.monthFolder)}</h2>
                </div>
                <div className="bv-kpi-meter-wrap">
                  <div
                    className="bv-kpi-meter"
                    style={{ "--kpi-progress": `${Math.min(100, latestKpi.completionPct)}%` } as CSSProperties}
                  >
                    <strong>{Math.min(100, latestKpi.completionPct).toFixed(1)}%</strong>
                    <span>مدروس</span>
                  </div>
                </div>
              </section>

              <div className="bv-kpi-summary-grid">
                <StatCard label="الهدف الشهري" value={latestKpi.totalTarget} />
                <StatCard label="المحالة للفحص" value={latestKpi.totalAssigned} />
                <StatCard label="المدروسة" value={latestKpi.totalCompleted} />
                <StatCard label="المتبقي" value={latestKpi.remaining} />
                <StatCard
                  label="الحالة"
                  value={
                    latestKpi.status === "complete"
                      ? "مكتمل"
                      : latestKpi.status === "over"
                        ? "أعلى من الهدف"
                        : "قيد الاستكمال"
                  }
                />
              </div>

              <div className="bv-stage-target-grid">
                {latestKpi.stageRows.map((stage) => (
                  <article key={stage.stageKey} className="bv-stage-target-card">
                    <div className="bv-stage-card-head">
                      <span className="bv-stage-label">{stage.label}</span>
                      <span className="bv-stage-target">
                        الهدف {stage.target?.toLocaleString("ar-SA-u-nu-latn") ?? "كامل المجتمع"}
                      </span>
                    </div>
                    <div className="bv-stage-donut-row">
                      <div
                        className="bv-stage-donut"
                        style={{ "--stage-progress": `${Math.min(100, stage.completionPct ?? 0)}%` } as CSSProperties}
                      >
                        <strong>{Math.min(100, stage.completionPct ?? 0).toFixed(1)}%</strong>
                      </div>
                      <dl className="bv-stage-metrics">
                        <div>
                          <dt>المحالة للفحص</dt>
                          <dd>{stage.assigned.toLocaleString("ar-SA-u-nu-latn")}</dd>
                        </div>
                        <div>
                          <dt>المدروسة</dt>
                          <dd>{stage.completed.toLocaleString("ar-SA-u-nu-latn")}</dd>
                        </div>
                        <div>
                          <dt>المتبقي</dt>
                          <dd>{stage.remaining.toLocaleString("ar-SA-u-nu-latn")}</dd>
                        </div>
                        <div>
                          <dt>مجتمع الشهر</dt>
                          <dd>{stage.population.toLocaleString("ar-SA-u-nu-latn")}</dd>
                        </div>
                      </dl>
                    </div>
                  </article>
                ))}
              </div>

              {monthlyKpis.length > 1 && (
                <section className="bv-month-history">
                  <h3>متابعة الأشهر</h3>
                  {monthlyKpis.slice(0, 6).map((month) => (
                    <div key={month.monthFolder} className="bv-month-history-row">
                      <span>{formatArabicMonthFolder(month.monthFolder)}</span>
                      <div className="bv-history-progress-track">
                        <span
                          className="bv-history-progress-fill"
                          style={{ width: `${Math.min(100, month.completionPct)}%` }}
                        />
                      </div>
                      <strong>
                        {month.totalCompleted.toLocaleString("ar-SA-u-nu-latn")} / {month.totalAssigned.toLocaleString("ar-SA-u-nu-latn")}
                      </strong>
                    </div>
                  ))}
                </section>
              )}
            </div>
          )}

        </div>
      )}

      {!loading && total > 0 && view === "table" && (
        <div className="bv-table-view">
          {/* Toolbar */}
          <div className="bv-table-toolbar">
            <input
              type="text"
              className="bv-search"
              placeholder="بحث في جميع الأعمدة..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <span className="bv-row-count">
              {filteredRows.length.toLocaleString("ar-SA-u-nu-latn")} صف
              {(search || activeFilterCount > 0) && ` من ${total.toLocaleString("ar-SA-u-nu-latn")}`}
            </span>
            <button
              type="button"
              className="bv-export-btn"
              onClick={exportFilteredRowsToXlsx}
              disabled={activeCols.length === 0}
            >
              تصدير XLSX
            </button>
            {(search || activeFilterCount > 0) && (
              <button
                type="button"
                className="bv-clear-filters-btn"
                onClick={clearAllTableFilters}
              >
                مسح التصفية
              </button>
            )}
            <div className="bv-col-picker-wrap">
              <button
                type="button"
                className="bv-col-picker-btn"
                onClick={() => setColPickerOpen((o) => !o)}
              >
                <Settings2 size={14} style={{ verticalAlign: "middle", marginInlineEnd: 4 }} /> الأعمدة ({visibleCols.size})
              </button>
              {colPickerOpen && (
                <div className="bv-col-picker-dropdown">
                  {orderedColumns.map((c) => (
                    <label key={c.key} className="bv-col-option">
                      <input
                        type="checkbox"
                        checked={visibleCols.has(c.key)}
                        onChange={() => {
                          setVisibleCols((prev) => {
                            const next = new Set(prev);
                            if (next.has(c.key)) { next.delete(c.key); } else { next.add(c.key); }
                            saveCurrentPreset(columnOrder, next);
                            return next;
                          });
                        }}
                      />
                      {c.label}
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Table */}
          <div className="bv-table-scroll">
            <table className="bv-table">
              <thead>
                <tr>
                  {activeCols.map((c) => (
                    <th
                      key={c.key}
                      className={`bv-th bv-th-draggable${draggedColumnKey === c.key ? " dragging" : ""}`}
                      draggable
                      title="اسحب العمود لتغيير ترتيبه"
                      onDragStart={(event) => {
                        setDraggedColumnKey(c.key);
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", c.key);
                      }}
                      onDragOver={handleColumnDragOver}
                      onDrop={() => handleColumnDrop(c.key)}
                      onDragEnd={() => setDraggedColumnKey(null)}
                    >
                      <div className="bv-th-content">
                        <span className="bv-th-actions">
                          <span className="bv-th-grip" aria-hidden="true">⋮⋮</span>
                        </span>
                        <button
                          type="button"
                          className={`bv-filter-btn${columnFilters[c.key]?.length ? " active" : ""}`}
                          aria-label={`تصفية ${c.label}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            setOpenFilterColumn((current) => current === c.key ? null : c.key);
                          }}
                          onMouseDown={(event) => event.stopPropagation()}
                          draggable={false}
                        >
                          ▾
                        </button>
                        <span className="bv-th-label">{c.label}</span>
                      </div>
                      {openFilterColumn === c.key && (
                        <div
                          className="bv-column-filter-menu"
                          onClick={(event) => event.stopPropagation()}
                          onMouseDown={(event) => event.stopPropagation()}
                        >
                          <div className="bv-filter-menu-head">
                            <strong>{c.label}</strong>
                            <button
                              type="button"
                              onClick={() => clearColumnFilter(c.key)}
                              disabled={!columnFilters[c.key]?.length}
                            >
                              مسح
                            </button>
                          </div>
                          <div className="bv-filter-options">
                            {getColumnFilterOptions(c.key).length === 0 && (
                              <span className="bv-filter-empty">لا توجد خيارات</span>
                            )}
                            {getColumnFilterOptions(c.key).map((option) => (
                              <label key={option} className="bv-filter-option">
                                <input
                                  type="checkbox"
                                  checked={(columnFilters[c.key] ?? []).includes(option)}
                                  onChange={() => toggleColumnFilterValue(c.key, option)}
                                />
                                <span title={option}>{option}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredRows.slice(0, 500).map((row, i) => (
                  <tr key={i} className={i % 2 === 0 ? "bv-row-even" : ""}>
                    {activeCols.map((c) => {
                      const val = getBrowseDisplayValue(row, c.key, config.stageMappings);
                      return <td key={c.key} className="bv-td">{val}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredRows.length > 500 && (
              <div className="certscan-overflow-note">
                عرض أول 500 صف من {filteredRows.length.toLocaleString("ar-SA-u-nu-latn")}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
