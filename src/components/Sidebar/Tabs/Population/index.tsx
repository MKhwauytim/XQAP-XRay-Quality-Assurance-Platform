/* eslint-disable react-refresh/only-export-components */

import {
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type RefObject
} from "react";

import type { SidebarTabModule } from "../tabTypes";

import { readSession } from "../../../../auth/authSession";
import { currentMonthFolderInfo } from "../../../../data/population/monthFolder";
import { saveMonthRun } from "../../../../data/population/populationStorage";
import { useWorkspace } from "../../../../data/workspace/useWorkspace";

import { processBiWorkbook } from "./biData/biDataWorkbook";
import type { BiWorkbookResult } from "./biData/biDataTypes";

import { exportPopulationProcessingResult } from "./processing/populationExporter";
import { processPopulation } from "./processing/populationProcessor";
import type { PopulationProcessingResult } from "./processing/populationProcessingTypes";

import { exportPopulationReport } from "./reporting/reportExporter";

import { processRiskWorkbook } from "./riskData/riskDataWorkbook";
import type { RiskWorkbookResult } from "./riskData/riskDataTypes";

import "./Population.css";

type UploadKey = "riskAgencyData" | "businessIntelligenceData";

type UploadState = {
  file: File | null;
  source: "file-system-api" | "input-fallback" | null;
};

type PhaseStatus = "available" | "locked" | "completed" | "active";

type PhaseDefinition = {
  id: number;
  title: string;
  description: string;
};

type FilePickerAcceptType = {
  description?: string;
  accept: Record<string, string[]>;
};

type FileSystemFileHandle = {
  getFile: () => Promise<File>;
};

type FilePickerOptions = {
  multiple?: boolean;
  types?: FilePickerAcceptType[];
  excludeAcceptAllOption?: boolean;
};

type BrowserWithFileSystemAccess = Window & {
  showOpenFilePicker?: (
    options?: FilePickerOptions
  ) => Promise<FileSystemFileHandle[]>;
};

type StageCounts = {
  first: number;
  second: number;
  third: number;
  fourth: number;
  unknown: number;
};

type MiniReportSheet = {
  sheetName: string;
  category: string | null;
  stageCounts: StageCounts | null;
  originalRowCount: number;
  normalizedRowCount: number;
  excludedMissingXrayIdCount: number;
};

type MiniReportData = {
  title: string;
  description: string;
  status: "processed" | "not-provided";
  totalOriginalRows: number;
  totalNormalizedRows: number;
  totalExcludedMissingXrayIdCount: number;
  unknownSheetNames: string[];
  sheets: MiniReportSheet[];
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

const EXCEL_ACCEPT_OPTIONS: FilePickerAcceptType[] = [
  {
    description: "Excel Files",
    accept: {
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [
        ".xlsx"
      ],
      "application/vnd.ms-excel": [".xls"]
    }
  }
];

const RISK_AGENCY_INFO_ITEMS = [
  "هذا هو الملف الأساسي المطلوب للانتقال إلى المعالجة.",
  "يتم قراءة ملف Excel كملف خام وليس كجداول Excel، لأن البيانات لا تأتي داخل Table.",
  "يتم التعامل مع أول صف في كل ورقة على أنه صف العناوين، وتبدأ البيانات من الصف الثاني.",
  "يتم حذف الأعمدة الفارغة والصفوف الفارغة قبل أي عملية تطبيع أو دمج.",
  "يتعرف النظام على الأوراق المعروفة مثل: بري، بحري، افراد، وعبور.",
  "أي ورقة غير معروفة يتم تسجيلها في التقرير ولا تدخل في المجتمع النهائي.",
  "يتم توحيد أسماء الأعمدة المختلفة في الأوراق إلى نموذج موحد.",
  "بعد التوحيد، يتم إلحاق جميع الأوراق المعروفة في مجتمع واحد.",
  "يتم استبعاد أي صف لا يحتوي على معرف أشعة، لأن معرف الأشعة هو الحد الأدنى لقبول الصف ضمن مجتمع المعالجة."
];

const BI_INFO_ITEMS = [
  "هذا الملف داعم وليس شرطاً للانتقال إلى مرحلة المعالجة.",
  "إذا تم رفعه، سيقرأ النظام أوراق بحري وارد، بري وارد، بحري صادر، وبري صادر.",
  "يتم التعامل مع أول صف في كل ورقة على أنه صف العناوين.",
  "يتم حذف الأعمدة والصفوف الفارغة قبل التوحيد.",
  "يتم توحيد الأعمدة المختلفة مثل معرف الأشعة، رقم صورة الأشعة، وXRAY_SCAN_ID في حقل موحد.",
  "سيتم استخدام هذا الملف لاحقاً في تعبئة الخانات الفارغة فقط عند وجود تطابق بين معرف الأشعة واسم المنفذ.",
  "عدم رفع هذا الملف لا يمنع تكوين مجتمع وكالة المخاطر ولا يمنع عرض التقرير الأساسي."
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
  label: "معالجة المجتمع",
  order: 10,
  allowedRoles: ["employee", "supervisor", "admin"],
  icon: <PopulationIcon />
};

function isSupportedExcelFile(file: File): boolean {
  const normalizedFileName = file.name.toLowerCase();

  return (
    normalizedFileName.endsWith(".xlsx") || normalizedFileName.endsWith(".xls")
  );
}

function formatFileSize(sizeInBytes: number): string {
  if (sizeInBytes < 1024) {
    return `${sizeInBytes} بايت`;
  }

  const sizeInKilobytes = sizeInBytes / 1024;

  if (sizeInKilobytes < 1024) {
    return `${sizeInKilobytes.toFixed(1)} كيلوبايت`;
  }

  const sizeInMegabytes = sizeInKilobytes / 1024;
  return `${sizeInMegabytes.toFixed(2)} ميجابايت`;
}

function formatNumber(value: number): string {
  return value.toLocaleString("ar-SA");
}

function formatPercentage(value: number): string {
  return `${value.toLocaleString("ar-SA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}%`;
}

function getPhaseStatus(
  phaseId: number,
  currentPhase: number,
  completedPhaseIds: number[]
): PhaseStatus {
  if (completedPhaseIds.includes(phaseId)) {
    return "completed";
  }

  if (phaseId === currentPhase) {
    return "active";
  }

  if (phaseId < currentPhase) {
    return "available";
  }

  return "locked";
}

function createEmptyStageCounts(): StageCounts {
  return {
    first: 0,
    second: 0,
    third: 0,
    fourth: 0,
    unknown: 0
  };
}

function getStageKey(stage: string | null): keyof StageCounts {
  const normalizedStage = String(stage ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");

  if (normalizedStage === "FIRST_STAGE") {
    return "first";
  }

  if (normalizedStage === "SECOND_STAGE" || normalizedStage === "SECOND_STAG") {
    return "second";
  }

  if (normalizedStage === "THIRD_STAGE") {
    return "third";
  }

  if (normalizedStage === "FOURTH_STAGE" || normalizedStage === "FORTH_STAGE") {
    return "fourth";
  }

  return "unknown";
}

function buildRiskStageCountsBySheet(
  result: RiskWorkbookResult
): Record<string, StageCounts> {
  const countsBySheet: Record<string, StageCounts> = {};

  for (const row of result.rows) {
    const sheetName = row.sourceSheetName;

    if (!countsBySheet[sheetName]) {
      countsBySheet[sheetName] = createEmptyStageCounts();
    }

    const stageKey = getStageKey(row.stage);
    countsBySheet[sheetName][stageKey] += 1;
  }

  return countsBySheet;
}

function createRiskMiniReport(result: RiskWorkbookResult): MiniReportData {
  const stageCountsBySheet = buildRiskStageCountsBySheet(result);

  return {
    title: "بيانات وكالة المخاطر",
    description: "الملف الأساسي المستخدم لتكوين مجتمع المعالجة.",
    status: "processed",
    totalOriginalRows: result.totalOriginalRows,
    totalNormalizedRows: result.totalNormalizedRows,
    totalExcludedMissingXrayIdCount: result.totalExcludedMissingXrayIdCount,
    unknownSheetNames: result.unknownSheetNames,
    sheets: result.sheetSummaries.map((sheet) => ({
      sheetName: sheet.sheetName,
      category: null,
      stageCounts:
        stageCountsBySheet[sheet.sheetName] ?? createEmptyStageCounts(),
      originalRowCount: sheet.originalRowCount,
      normalizedRowCount: sheet.normalizedRowCount,
      excludedMissingXrayIdCount: sheet.excludedMissingXrayIdCount
    }))
  };
}

function createBiMiniReport(result: BiWorkbookResult | null): MiniReportData {
  if (!result) {
    return {
      title: "بيانات ذكاء الأعمال",
      description: "ملف داعم لم يتم رفعه أو لم تتم قراءته في هذه المرحلة.",
      status: "not-provided",
      totalOriginalRows: 0,
      totalNormalizedRows: 0,
      totalExcludedMissingXrayIdCount: 0,
      unknownSheetNames: [],
      sheets: []
    };
  }

  return {
    title: "بيانات ذكاء الأعمال",
    description: "ملف داعم سيتم استخدامه لاحقاً في تعبئة الخانات الفارغة.",
    status: "processed",
    totalOriginalRows: result.totalOriginalRows,
    totalNormalizedRows: result.totalNormalizedRows,
    totalExcludedMissingXrayIdCount: result.totalExcludedMissingXrayIdCount,
    unknownSheetNames: result.unknownSheetNames,
    sheets: result.sheetSummaries.map((sheet) => ({
      sheetName: sheet.sheetName,
      category: null,
      stageCounts: null,
      originalRowCount: sheet.originalRowCount,
      normalizedRowCount: sheet.normalizedRowCount,
      excludedMissingXrayIdCount: sheet.excludedMissingXrayIdCount
    }))
  };
}

type SaveMessage = { type: "ok" | "error"; text: string } | null;

export default function PopulationTab() {
  const { directoryHandle } = useWorkspace();
  const sessionRef = useRef(readSession());

  const riskAgencyInputRef = useRef<HTMLInputElement | null>(null);
  const businessIntelligenceInputRef = useRef<HTMLInputElement | null>(null);

  const [currentPhase, setCurrentPhase] = useState(1);
  const [completedPhaseIds, setCompletedPhaseIds] = useState<number[]>([]);

  const initialMonth = currentMonthFolderInfo();
  const [saveMonth, setSaveMonth] = useState(initialMonth.month);
  const [saveYear, setSaveYear] = useState(initialMonth.year);
  const [isSavingToDisk, setIsSavingToDisk] = useState(false);
  const [saveToDiskMessage, setSaveToDiskMessage] = useState<SaveMessage>(null);

  const [uploads, setUploads] = useState<Record<UploadKey, UploadState>>({
    riskAgencyData: {
      file: null,
      source: null
    },
    businessIntelligenceData: {
      file: null,
      source: null
    }
  });

  const [uploadError, setUploadError] = useState("");
  const [processingMessage, setProcessingMessage] = useState("");
  const [isProcessingWorkbooks, setIsProcessingWorkbooks] = useState(false);
  const [isProcessingPopulation, setIsProcessingPopulation] = useState(false);

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

  async function pickExcelFile(uploadKey: UploadKey): Promise<void> {
    setUploadError("");
    setProcessingMessage("");

    const browserWindow = window as BrowserWithFileSystemAccess;

    if (!browserWindow.showOpenFilePicker) {
      openFallbackInput(uploadKey);
      return;
    }

    try {
      const handles = await browserWindow.showOpenFilePicker({
        multiple: false,
        types: EXCEL_ACCEPT_OPTIONS,
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
      [uploadKey]: {
        file,
        source
      }
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
      [uploadKey]: {
        file: null,
        source: null
      }
    }));

    setRiskWorkbookResult(null);
    setBiWorkbookResult(null);
    setPopulationProcessingResult(null);
    setProcessingMessage("");
  }

  async function processPhaseOneAndMoveNext(): Promise<void> {
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

    try {
      const riskResult = await processRiskWorkbook(riskFile);
      setRiskWorkbookResult(riskResult);

      if (biFile) {
        try {
          const biResult = await processBiWorkbook(biFile);
          setBiWorkbookResult(biResult);
        } catch {
          setBiWorkbookResult(null);
          setProcessingMessage(
            "تمت قراءة بيانات وكالة المخاطر، ولكن تعذر قراءة ملف ذكاء الأعمال. يمكنك المتابعة لأن ملف ذكاء الأعمال داعم وليس شرطاً."
          );
        }
      } else {
        setBiWorkbookResult(null);
      }

      setCompletedPhaseIds((currentCompletedPhases) =>
        currentCompletedPhases.includes(1)
          ? currentCompletedPhases
          : [...currentCompletedPhases, 1]
      );

      setCurrentPhase(2);
    } catch {
      setProcessingMessage(
        "تعذر قراءة ملف بيانات وكالة المخاطر. تأكد من أن الملف بصيغة Excel وأن الصف الأول يحتوي على العناوين."
      );
    } finally {
      setIsProcessingWorkbooks(false);
    }
  }

  function handleProcessPopulation(): void {
    if (!riskWorkbookResult) {
      setProcessingMessage("لا يمكن معالجة المجتمع قبل قراءة ملف وكالة المخاطر.");
      return;
    }

    setIsProcessingPopulation(true);
    setProcessingMessage("");

    try {
      const result = processPopulation({
        riskWorkbookResult,
        biWorkbookResult,
        certScanPasteText
      });

      setPopulationProcessingResult(result);
    } catch {
      setPopulationProcessingResult(null);
      setProcessingMessage(
        "تعذر تنفيذ معالجة المجتمع. تحقق من بيانات CertScan أو من بنية البيانات المقروءة."
      );
    } finally {
      setIsProcessingPopulation(false);
    }
  }

  function handleExportPopulation(): void {
    if (!populationProcessingResult || !riskWorkbookResult) {
      setProcessingMessage("لا توجد نتيجة معالجة جاهزة للتصدير.");
      return;
    }

    exportPopulationProcessingResult(
      populationProcessingResult,
      riskWorkbookResult,
      biWorkbookResult
    );
  }

  function handleExportPhaseTwoReport(): void {
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

  async function handleSaveToDisk(): Promise<void> {
    if (!directoryHandle || !populationProcessingResult || !riskWorkbookResult) {
      setSaveToDiskMessage({
        type: "error",
        text: "لا توجد بيانات معالجة أو مساحة عمل."
      });
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
        certScanUsed: certScanPasteText.trim().length > 0,
        riskRawRows: riskWorkbookResult.rows as Array<Record<string, unknown>>,
        biRawRows: biWorkbookResult
          ? (biWorkbookResult.rows as Array<Record<string, unknown>>)
          : [],
        processedRows: populationProcessingResult.preparedRows as Array<
          Record<string, unknown>
        >,
        certScanRows: populationProcessingResult.summary.certScanRows,
        nonCertScanRows: populationProcessingResult.summary.nonCertScanRows
      });

      if (result.ok) {
        setSaveToDiskMessage({
          type: "ok",
          text: `تم حفظ شهر ${result.monthFolderName} على القرص بنجاح.`
        });
      } else {
        setSaveToDiskMessage({ type: "error", text: `فشل الحفظ: ${result.error}` });
      }
    } catch {
      setSaveToDiskMessage({ type: "error", text: "حدث خطأ غير متوقع أثناء الحفظ." });
    } finally {
      setIsSavingToDisk(false);
    }
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

  return (
    <section className="population-page" aria-label="معالجة المجتمع">
      <header className="population-header">
        <div>
          <p className="population-eyebrow">Population Processing</p>
          <h1>معالجة المجتمع</h1>
          <p>
            مسار عمل مخصص لرفع بيانات المجتمع، تحضيرها، اختيار العينة، ثم
            توزيع العينة على الموظفين داخل النظام.
          </p>
        </div>
      </header>

      <div className="phase-tracker" aria-label="مراحل معالجة المجتمع">
        {PHASES.map((phase) => {
          const status = getPhaseStatus(
            phase.id,
            currentPhase,
            completedPhaseIds
          );

          return (
            <article
              key={phase.id}
              className={`phase-step ${status}`}
              aria-current={status === "active" ? "step" : undefined}
            >
              <div className="phase-step-number">{phase.id}</div>

              <div className="phase-step-content">
                <h2>{phase.title}</h2>
                <p>{phase.description}</p>
              </div>
            </article>
          );
        })}
      </div>

      <main className="phase-panel">
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
            saveMonth={saveMonth}
            saveYear={saveYear}
            isSavingToDisk={isSavingToDisk}
            saveToDiskMessage={saveToDiskMessage}
            hasDiskWorkspace={Boolean(directoryHandle)}
            onCertScanPasteTextChange={setCertScanPasteText}
            onProcessPopulation={handleProcessPopulation}
            onExportPopulation={handleExportPopulation}
            onExportPhaseReport={handleExportPhaseTwoReport}
            onMonthChange={setSaveMonth}
            onYearChange={setSaveYear}
            onSaveToDisk={() => { void handleSaveToDisk(); }}
          />
        ) : null}

        {currentPhase > 2 ? (
          <section className="placeholder-phase">
            <h2>{PHASES[currentPhase - 1].title}</h2>
            <p>سيتم تطوير هذه المرحلة لاحقاً بعد اعتماد منطق المعالجة.</p>
          </section>
        ) : null}
      </main>

      <footer className="phase-actions">
        <button
          type="button"
          className="secondary-action"
          onClick={moveToPreviousPhase}
          disabled={
            currentPhase === 1 || isProcessingWorkbooks || isProcessingPopulation
          }
        >
          السابق
        </button>

        <button
          type="button"
          className="primary-action"
          onClick={() => {
            void moveToNextPhase();
          }}
          disabled={
            isProcessingWorkbooks ||
            isProcessingPopulation ||
            (currentPhase === 1 && !isPhaseOneComplete)
          }
        >
          {isProcessingWorkbooks ? "جاري القراءة..." : "التالي"}
        </button>
      </footer>
    </section>
  );
}

type PhaseOneUploadProps = {
  uploads: Record<UploadKey, UploadState>;
  uploadError: string;
  processingMessage: string;
  isProcessingWorkbooks: boolean;
  riskAgencyInputRef: RefObject<HTMLInputElement | null>;
  businessIntelligenceInputRef: RefObject<HTMLInputElement | null>;
  onPickFile: (uploadKey: UploadKey) => void;
  onClearFile: (uploadKey: UploadKey) => void;
  onFallbackFileChange: (
    uploadKey: UploadKey,
    event: ChangeEvent<HTMLInputElement>
  ) => void;
};

function PhaseOneUpload({
  uploads,
  uploadError,
  processingMessage,
  isProcessingWorkbooks,
  riskAgencyInputRef,
  businessIntelligenceInputRef,
  onPickFile,
  onClearFile,
  onFallbackFileChange
}: PhaseOneUploadProps) {
  return (
    <section className="upload-phase" aria-label="رفع البيانات">
      <div className="phase-panel-header">
        <div>
          <h2>المرحلة 1: رفع البيانات</h2>
          <p>
            ملف وكالة المخاطر هو الملف الأساسي المطلوب. ملف ذكاء الأعمال داعم
            ويمكن رفعه الآن أو إضافته لاحقاً حسب منطق المعالجة.
          </p>
        </div>
      </div>

      <div className="upload-grid">
        <FileUploadCard
          title="بيانات وكالة المخاطر"
          description="ملف أساسي يحتوي على أوراق بري، بحري، افراد، وعبور."
          uploadState={uploads.riskAgencyData}
          onPickFile={() => onPickFile("riskAgencyData")}
          onClearFile={() => onClearFile("riskAgencyData")}
          infoTitle="آلية معالجة بيانات وكالة المخاطر"
          infoContent={RISK_AGENCY_INFO_ITEMS}
          isRequired
        />

        <FileUploadCard
          title="بيانات ذكاء الأعمال"
          description="ملف داعم يحتوي على أوراق بحري وارد، بري وارد، بحري صادر، وبري صادر."
          uploadState={uploads.businessIntelligenceData}
          onPickFile={() => onPickFile("businessIntelligenceData")}
          onClearFile={() => onClearFile("businessIntelligenceData")}
          infoTitle="آلية معالجة بيانات ذكاء الأعمال"
          infoContent={BI_INFO_ITEMS}
        />
      </div>

      {uploadError ? (
        <div className="upload-error" role="alert">
          {uploadError}
        </div>
      ) : null}

      {processingMessage ? (
        <div className="upload-warning" role="status">
          {processingMessage}
        </div>
      ) : null}

      {isProcessingWorkbooks ? (
        <div className="processing-note" role="status">
          جاري قراءة الملفات وتحضير التقرير المصغر...
        </div>
      ) : null}

      <input
        ref={riskAgencyInputRef}
        className="hidden-file-input"
        type="file"
        accept=".xlsx,.xls"
        onChange={(event) => onFallbackFileChange("riskAgencyData", event)}
      />

      <input
        ref={businessIntelligenceInputRef}
        className="hidden-file-input"
        type="file"
        accept=".xlsx,.xls"
        onChange={(event) =>
          onFallbackFileChange("businessIntelligenceData", event)
        }
      />
    </section>
  );
}

type PhaseTwoReportAndProcessingProps = {
  riskWorkbookResult: RiskWorkbookResult | null;
  biWorkbookResult: BiWorkbookResult | null;
  processingMessage: string;
  certScanPasteText: string;
  populationProcessingResult: PopulationProcessingResult | null;
  isProcessingPopulation: boolean;
  saveMonth: number;
  saveYear: number;
  isSavingToDisk: boolean;
  saveToDiskMessage: SaveMessage;
  hasDiskWorkspace: boolean;
  onCertScanPasteTextChange: (value: string) => void;
  onProcessPopulation: () => void;
  onExportPopulation: () => void;
  onExportPhaseReport: () => void;
  onMonthChange: (month: number) => void;
  onYearChange: (year: number) => void;
  onSaveToDisk: () => void;
};

function PhaseTwoReportAndProcessing({
  riskWorkbookResult,
  biWorkbookResult,
  processingMessage,
  certScanPasteText,
  populationProcessingResult,
  isProcessingPopulation,
  saveMonth,
  saveYear,
  isSavingToDisk,
  saveToDiskMessage,
  hasDiskWorkspace,
  onCertScanPasteTextChange,
  onProcessPopulation,
  onExportPopulation,
  onExportPhaseReport,
  onMonthChange,
  onYearChange,
  onSaveToDisk
}: PhaseTwoReportAndProcessingProps) {
  if (!riskWorkbookResult) {
    return (
      <section className="placeholder-phase">
        <h2>تقرير البيانات والمعالجة</h2>
        <p>لم يتم تجهيز التقرير المصغر بعد.</p>
      </section>
    );
  }

  const reports = [
    createRiskMiniReport(riskWorkbookResult),
    createBiMiniReport(biWorkbookResult)
  ];

  return (
    <section
      className="report-processing-phase"
      aria-label="تقرير البيانات والمعالجة"
    >
      <div className="phase-panel-header compact">
        <div>
          <h2>المرحلة 2: تقرير البيانات والمعالجة</h2>
          <p>
            يعرض هذا القسم تقرير قراءة الملفات، ثم يسمح بإدخال قائمة CertScan
            وتنفيذ معالجة المجتمع النهائي.
          </p>
        </div>
      </div>

      {processingMessage ? (
        <div className="upload-warning" role="status">
          {processingMessage}
        </div>
      ) : null}

      <div className="report-layout">
        {reports.map((report) => (
          <MiniWorkbookReport key={report.title} report={report} />
        ))}
      </div>

      <section className="processing-workspace" aria-label="المعالجة">
        <div className="processing-workspace-header">
          <h3>المعالجة</h3>
          <p>
            الصق قائمة CertScan من Excel. الأعمدة المطلوبة هي Port Name وSystem
            S/N فقط. سيتم استخدام اسم المنفذ والرقم التسلسلي لتصنيف السجلات إلى
            Certscan أو NonCertscan.
          </p>
        </div>

        <div className="processing-control-panel">
          <label className="certscan-paste-label" htmlFor="certscan-paste">
            قائمة CertScan
          </label>

          <textarea
            id="certscan-paste"
            className="certscan-paste-textarea"
            value={certScanPasteText}
            onChange={(event) => onCertScanPasteTextChange(event.target.value)}
            placeholder={
              "Port Name\tPort Type\tOEM\tColumn1\tSystem S/N\nالبطحاء\tLand Port\tNuctech\tCargo\tTFNCS-11806"
            }
          />

          <div className="processing-action-row">
            <button
              type="button"
              className="primary-action"
              onClick={onProcessPopulation}
              disabled={isProcessingPopulation}
            >
              {isProcessingPopulation ? "جاري المعالجة..." : "معالجة المجتمع"}
            </button>

            <button
              type="button"
              className="secondary-action"
              onClick={onExportPhaseReport}
              disabled={isProcessingPopulation}
            >
              تصدير تقرير المعالجة
            </button>

            <button
              type="button"
              className="secondary-action"
              onClick={onExportPopulation}
              disabled={!populationProcessingResult || isProcessingPopulation}
            >
              تصدير المجتمع النهائي
            </button>
          </div>
        </div>

        {populationProcessingResult ? (
          <PopulationProcessingReport result={populationProcessingResult} />
        ) : (
          <div className="processing-placeholder">
            <p>لم يتم تنفيذ معالجة المجتمع بعد.</p>
          </div>
        )}
      </section>

      {populationProcessingResult && hasDiskWorkspace ? (
        <section className="save-to-disk-section" aria-label="حفظ على القرص">
          <div className="processing-workspace-header">
            <h3>حفظ المجتمع على القرص</h3>
            <p>
              سيتم إنشاء مجلد الشهر داخل مجلد Population في مساحة العمل
              المحددة، وحفظ البيانات الخام والمعالجة بصيغة JSON.
            </p>
          </div>

          <div className="save-disk-controls">
            <label className="save-disk-label" htmlFor="save-month">
              الشهر
              <input
                id="save-month"
                type="number"
                min={1}
                max={12}
                value={saveMonth}
                className="save-disk-input"
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (v >= 1 && v <= 12) onMonthChange(v);
                }}
              />
            </label>

            <label className="save-disk-label" htmlFor="save-year">
              السنة
              <input
                id="save-year"
                type="number"
                min={2020}
                max={2100}
                value={saveYear}
                className="save-disk-input"
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (v >= 2020) onYearChange(v);
                }}
              />
            </label>

            <button
              type="button"
              className="primary-action"
              onClick={onSaveToDisk}
              disabled={isSavingToDisk}
            >
              {isSavingToDisk ? "جاري الحفظ..." : "حفظ على القرص"}
            </button>
          </div>

          {saveToDiskMessage ? (
            <div
              className={
                saveToDiskMessage.type === "ok"
                  ? "save-disk-success"
                  : "save-disk-error"
              }
              role="status"
            >
              {saveToDiskMessage.text}
            </div>
          ) : null}
        </section>
      ) : null}
    </section>
  );
}

type MiniWorkbookReportProps = {
  report: MiniReportData;
};

function MiniWorkbookReport({ report }: MiniWorkbookReportProps) {
  const isNotProvided = report.status === "not-provided";
  const hasStageCounts = report.sheets.some(
    (sheet) => sheet.stageCounts !== null
  );

  const totalStageCounts = report.sheets.reduce<StageCounts>(
    (totals, sheet) => {
      const stageCounts = sheet.stageCounts ?? createEmptyStageCounts();

      return {
        first: totals.first + stageCounts.first,
        second: totals.second + stageCounts.second,
        third: totals.third + stageCounts.third,
        fourth: totals.fourth + stageCounts.fourth,
        unknown: totals.unknown + stageCounts.unknown
      };
    },
    createEmptyStageCounts()
  );

  const tableTotals = report.sheets.reduce(
    (totals, sheet) => ({
      originalRowCount: totals.originalRowCount + sheet.originalRowCount,
      normalizedRowCount: totals.normalizedRowCount + sheet.normalizedRowCount,
      excludedMissingXrayIdCount:
        totals.excludedMissingXrayIdCount + sheet.excludedMissingXrayIdCount
    }),
    {
      originalRowCount: 0,
      normalizedRowCount: 0,
      excludedMissingXrayIdCount: 0
    }
  );

  return (
    <article className={`report-card ${isNotProvided ? "muted" : ""}`}>
      <header className="report-card-header">
        <div>
          <h3>{report.title}</h3>
          <p>{report.description}</p>
        </div>

        <span className={`report-status ${isNotProvided ? "muted" : "ok"}`}>
          {isNotProvided ? "اختياري" : "تمت القراءة"}
        </span>
      </header>

      {isNotProvided ? (
        <div className="report-empty-state">
          <p>لم يتم رفع هذا الملف. يمكن المتابعة بملف وكالة المخاطر فقط.</p>
        </div>
      ) : (
        <>
          <div className="report-totals">
            <SummaryCard label="الأصلية" value={report.totalOriginalRows} />
            <SummaryCard
              label="المقبولة قبل المعالجة"
              value={report.totalNormalizedRows}
            />
            <SummaryCard
              label="المستبعدة عند القراءة"
              value={report.totalExcludedMissingXrayIdCount}
            />
            <SummaryCard label="الأوراق" value={report.sheets.length} />
          </div>

          {hasStageCounts ? (
            <div className="report-sheet-table stage-report-table" role="table">
              <div className="report-sheet-header stage-report-row" role="row">
                <span>الورقة</span>
                <span>المستوى الأول</span>
                <span>المستوى الثاني</span>
                <span>المستوى الثالث</span>
                <span>المستوى الرابع</span>
                <span>غير محدد</span>
                <span>إجمالي الصفوف المقبولة</span>
              </div>

              {report.sheets.map((sheet) => {
                const stageCounts =
                  sheet.stageCounts ?? createEmptyStageCounts();

                return (
                  <div
                    key={sheet.sheetName}
                    className="report-sheet-row stage-report-row"
                    role="row"
                  >
                    <span>{sheet.sheetName}</span>
                    <span>{formatNumber(stageCounts.first)}</span>
                    <span>{formatNumber(stageCounts.second)}</span>
                    <span>{formatNumber(stageCounts.third)}</span>
                    <span>{formatNumber(stageCounts.fourth)}</span>
                    <span>{formatNumber(stageCounts.unknown)}</span>
                    <span>{formatNumber(sheet.normalizedRowCount)}</span>
                  </div>
                );
              })}

              <div
                className="report-sheet-row stage-report-row report-total-row"
                role="row"
              >
                <span>المجموع</span>
                <span>{formatNumber(totalStageCounts.first)}</span>
                <span>{formatNumber(totalStageCounts.second)}</span>
                <span>{formatNumber(totalStageCounts.third)}</span>
                <span>{formatNumber(totalStageCounts.fourth)}</span>
                <span>{formatNumber(totalStageCounts.unknown)}</span>
                <span>{formatNumber(report.totalNormalizedRows)}</span>
              </div>
            </div>
          ) : (
            <div className="report-sheet-table" role="table">
              <div className="report-sheet-header standard-report-row" role="row">
                <span>الورقة</span>
                <span>الأصلية</span>
                <span>المقبولة قبل المعالجة</span>
                <span>المستبعدة عند القراءة</span>
              </div>

              {report.sheets.map((sheet) => (
                <div
                  key={sheet.sheetName}
                  className="report-sheet-row standard-report-row"
                  role="row"
                >
                  <span>{sheet.sheetName}</span>
                  <span>{formatNumber(sheet.originalRowCount)}</span>
                  <span>{formatNumber(sheet.normalizedRowCount)}</span>
                  <span>{formatNumber(sheet.excludedMissingXrayIdCount)}</span>
                </div>
              ))}

              <div
                className="report-sheet-row standard-report-row report-total-row"
                role="row"
              >
                <span>المجموع</span>
                <span>{formatNumber(tableTotals.originalRowCount)}</span>
                <span>{formatNumber(tableTotals.normalizedRowCount)}</span>
                <span>{formatNumber(tableTotals.excludedMissingXrayIdCount)}</span>
              </div>
            </div>
          )}

          {report.unknownSheetNames.length > 0 ? (
            <div className="unknown-sheets-warning" role="status">
              <h4>أوراق لم يتم التعرف عليها</h4>
              <p>{report.unknownSheetNames.join("، ")}</p>
            </div>
          ) : null}
        </>
      )}
    </article>
  );
}

type PopulationProcessingReportProps = {
  result: PopulationProcessingResult;
};

function PopulationProcessingReport({
  result
}: PopulationProcessingReportProps) {
  const summary = result.summary;
  const previewRows = result.preparedRows.slice(0, 10);

  const totalExcludedAfterProcessing =
    summary.duplicateRiskIdRows +
    summary.removedInvalidResultRows +
    summary.invalidRiskIdRows;

  return (
    <section className="population-processing-result">
      <div className="processing-summary-grid">
        <SummaryCard
          label="المجتمع النهائي"
          value={summary.finalPreparedPopulationRows}
        />

        <SummaryCard
          label="إجمالي المستبعد بعد المعالجة"
          value={totalExcludedAfterProcessing}
        />

        <SummaryCard
          label="المكررات المستبعدة"
          value={summary.duplicateRiskIdRows}
        />

        <SummaryCard
          label="نتائج غير صالحة"
          value={summary.removedInvalidResultRows}
        />

        <SummaryCard label="CertScan" value={summary.certScanRows} />
        <SummaryCard label="NonCertScan" value={summary.nonCertScanRows} />
        <SummaryCard label="مطابقة BI" value={summary.biMatchedRows} />
        <SummaryCard label="تعبئة من BI" value={summary.totalBiFilledFields} />

        <SummaryCard
          label="معرفات غير صالحة"
          value={summary.invalidRiskIdRows}
        />
      </div>

      <div className="processing-detail-grid">
        <article className="processing-detail-card">
          <h4>نسب CertScan</h4>
          <p>CertScan: {formatPercentage(summary.certScanPercentage)}</p>
          <p>NonCertScan: {formatPercentage(summary.nonCertScanPercentage)}</p>
        </article>

        <article className="processing-detail-card">
          <h4>مطابقة ذكاء الأعمال</h4>
          <p>تم رفع BI: {summary.biProvided ? "نعم" : "لا"}</p>
          <p>نسبة المطابقة: {formatPercentage(summary.biMatchPercentage)}</p>
          <p>غير مطابق: {formatNumber(summary.biUnmatchedRows)}</p>
        </article>

        <article className="processing-detail-card">
          <h4>تنظيف بيانات وكالة المخاطر</h4>
          <p>الأصلية: {formatNumber(summary.riskOriginalRows)}</p>
          <p>بعد حذف المكررات: {formatNumber(summary.rowsAfterDeduplication)}</p>
          <p>النهائية: {formatNumber(summary.finalPreparedPopulationRows)}</p>
        </article>
      </div>

      <div className="bi-fill-summary-section">
        <h4>ملخص تعبئة الخانات من BI</h4>

        <div className="bi-fill-summary-table">
          <div className="bi-fill-summary-header">
            <span>العمود</span>
            <span>فارغ قبل BI</span>
            <span>تمت تعبئته</span>
            <span>بقي فارغاً</span>
            <span>نسبة التعبئة</span>
          </div>

          {summary.biFieldFillSummary.map((field) => (
            <div key={field.fieldName} className="bi-fill-summary-row">
              <span>{field.fieldName}</span>
              <span>{formatNumber(field.riskEmptyBefore)}</span>
              <span>{formatNumber(field.filledFromBi)}</span>
              <span>{formatNumber(field.stillEmptyAfter)}</span>
              <span>{formatPercentage(field.fillPercentage)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="prepared-preview-section">
        <h4>معاينة المجتمع النهائي</h4>

        {previewRows.length > 0 ? (
          <div className="prepared-preview-table">
            <div className="prepared-preview-header">
              <span>معرف الأشعة</span>
              <span>اسم المنفذ</span>
              <span>المستوى</span>
              <span>المستوى الأول</span>
              <span>المستوى الثاني</span>
              <span>CertScan</span>
            </div>

            {previewRows.map((row) => (
              <div
                key={`${row.xrayImageId}-${row.sourceRowNumber}`}
                className="prepared-preview-row"
              >
                <span>{row.xrayImageId}</span>
                <span>{row.portName ?? ""}</span>
                <span>{row.stage ?? ""}</span>
                <span>{row.xrayLevelOneResult}</span>
                <span>{row.xrayLevelTwoResult}</span>
                <span>{row.certScanStatus}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="processing-placeholder">
            <p>لا توجد صفوف نهائية بعد تطبيق شروط المعالجة.</p>
          </div>
        )}
      </div>
    </section>
  );
}

type SummaryCardProps = {
  label: string;
  value: number;
};

function SummaryCard({ label, value }: SummaryCardProps) {
  return (
    <article className="summary-card">
      <span>{label}</span>
      <strong>{formatNumber(value)}</strong>
    </article>
  );
}

type FileUploadCardProps = {
  title: string;
  description: string;
  uploadState: UploadState;
  onPickFile: () => void;
  onClearFile: () => void;
  infoTitle?: string;
  infoContent?: string[];
  isRequired?: boolean;
};

function FileUploadCard({
  title,
  description,
  uploadState,
  onPickFile,
  onClearFile,
  infoTitle,
  infoContent,
  isRequired = false
}: FileUploadCardProps) {
  const [isInfoOpen, setIsInfoOpen] = useState(false);
  const file = uploadState.file;
  const hasInfo = Boolean(infoTitle && infoContent && infoContent.length > 0);

  return (
    <article className={`upload-card ${file ? "has-file" : ""}`}>
      <div className="upload-card-header">
        <div>
          <div className="upload-title-row">
            <h3>{title}</h3>

            <span className={`requirement-badge ${isRequired ? "required" : ""}`}>
              {isRequired ? "أساسي" : "اختياري"}
            </span>

            {hasInfo ? (
              <button
                type="button"
                className="upload-info-button"
                onClick={() => setIsInfoOpen((current) => !current)}
                aria-label={`عرض معلومات عن ${title}`}
                aria-expanded={isInfoOpen}
              >
                ?
              </button>
            ) : null}
          </div>

          <p>{description}</p>
        </div>

        <div
          className="upload-status"
          aria-label={file ? "تم اختيار ملف" : "لم يتم اختيار ملف"}
        >
          {file ? "جاهز" : isRequired ? "مطلوب" : "اختياري"}
        </div>
      </div>

      {hasInfo && isInfoOpen ? (
        <div className="upload-info-panel" role="note">
          <h4>{infoTitle}</h4>

          <ul>
            {infoContent?.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {file ? (
        <div className="selected-file">
          <div>
            <strong>{file.name}</strong>
            <span>{formatFileSize(file.size)}</span>
          </div>

          <button type="button" onClick={onClearFile}>
            إزالة
          </button>
        </div>
      ) : (
        <div className="empty-upload">
          <p>
            {isRequired
              ? "لم يتم اختيار الملف الأساسي بعد."
              : "لم يتم اختيار ملف داعم."}
          </p>
        </div>
      )}

      <button type="button" className="upload-button" onClick={onPickFile}>
        {file ? "تغيير الملف" : "اختيار ملف Excel"}
      </button>
    </article>
  );
}