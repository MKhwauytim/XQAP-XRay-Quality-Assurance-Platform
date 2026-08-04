/* eslint-disable react-refresh/only-export-components */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import ReportDesignerTab from "../ReportDesigner";
import { AlertTriangle, BarChart2, BarChart3, Building2, Check, ClipboardList, Database, Download, FileStack, FileText, Filter, FolderOpen, Globe, History, Presentation, Settings2, User, Users, X } from "lucide-react";

import type { SidebarTabModule } from "../tabTypes";
import { loadOrDeriveDistributionCurrentForRead, loadDistributionCurrentRevision } from "../../../../data/distribution/distributionStorage";
import { logRejection } from "../../../../data/storage/errorLogger";
import { loadMonthPopulationFinal, loadMonthForEditing, loadMonthPopulationFinalRevision, loadMonthManifest } from "../../../../data/population/populationStorage";
import { useGlobalMonth } from "../../../../data/month/useGlobalMonth";
import type { SourceRevisions } from "../../../../data/reporting/sourceRevisions";
import { formatMonthFolderShortLabel } from "../../../../data/population/monthFolder";
import type { PreparedPopulationRow } from "../../../../data/population/populationTypes";
import { useLabels } from "../../../../data/labels/useLabels";
import { buildReportModel } from "../../../../data/reporting/executive/model/reportModel";
import type { ReportModel } from "../../../../data/reporting/executive/model/reportModel";
import { rankedBar, gauge, donut, heatmap } from "../../../../data/reporting/executive/ui/charts";
import ReviewerKpiPanel from "./ReviewerKpiPanel";
import { DEFAULT_EXEC_CONFIG } from "../../../../data/reporting/executiveReportTypes";
import type { ExecutiveReportInput } from "../../../../data/reporting/executiveReportTypes";
import { getManagedLoginUsers } from "../../../../auth/userManagement";
import { tabAllowedRoles } from "../../../../auth/tabCatalog";
import { usePermissions } from "../../../../auth/usePermissions";
import { TabGuard } from "../../../PermissionGuard";
import { loadSampleMaster, loadSampleMasterRevision } from "../../../../data/sampling/sampleStorage";
import { loadAllEmployeeFiles } from "../../../../data/answers/answerStorage";
import { loadTemplate } from "../../../../data/templates/templateStorage";
import { loadInspectionTemplateSelection } from "../../../../data/templates/templateSelectionStorage";
import { useWorkspace } from "../../../../data/workspace/useWorkspace";
import { readSession } from "../../../../auth/authSession";
import { loadDeckStyleChoices } from "../../../../data/reporting/executive/deck2/styleChoices";
import DeckDesignCustomizer from "./DeckDesignCustomizer";
import type { ExportManifest } from "../../../../data/powerbiExport/exportTypes";
import "./Reports.css";


function PresentationFormatIcon(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" className="rh-format-icon" aria-hidden="true">
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H13v2h3a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2h3v-2H5.5A1.5 1.5 0 0 1 4 14.5v-9Zm2 1V14h12V6.5H6Z" />
      <path d="M8 12h2V9H8v3Zm3 0h2V8h-2v4Zm3 0h2v-2h-2v2Z" />
    </svg>
  );
}

function ExcelFormatIcon(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" className="rh-format-icon" aria-hidden="true">
      <path d="M5 4h11l3 3v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm10 1.8V8h2.2L15 5.8ZM7 9v8h10V9H7Z" />
      <path d="M8.5 10.5h3v2h-3v-2Zm4 0h3v2h-3v-2Zm-4 3h3v2h-3v-2Zm4 0h3v2h-3v-2Z" />
    </svg>
  );
}

export const tabConfig: SidebarTabModule["tabConfig"] = {
  id: "reports",
  label: "إدارة التقارير",
  order: 25,
  allowedRoles: tabAllowedRoles("reports"),
  icon: <BarChart3 size={20} strokeWidth={1.8} aria-hidden />,
  subTabs: [
    { id: "reports", label: "التقارير" },
    { id: "kpi", label: "مؤشرات الأداء", allowedRoles: tabAllowedRoles("reports/kpi") },
    { id: "report-designer", label: "مصمم التقارير", allowedRoles: tabAllowedRoles("reports/report-designer") },
  ],
};

type ReportType =
  | "sample" | "sample-xlsx" | "sample-deck"
  | "distribution" | "distribution-xlsx" | "distribution-deck"
  | "executive" | "executive-xlsx" | "executive-deck"
  | "management" | "management-xlsx" | "management-deck";
type ReportBaseType = "sample" | "distribution" | "executive" | "management";
type ReportFormat = "xlsx" | "deck" | "document";
type ReportsSection = "reports" | "kpi";

const KNOWN_REPORT_SECTIONS = new Set<ReportsSection>(["reports", "kpi"]);

type MonthMeta = {
  folderName: string;
  populationCount: number | null;
  sampleCount: number | null;
  studiedCount: number | null;
};

// ── Analytics dashboard helpers ─────────────────────────────────────────────

const RESULT_SOURCE_LABELS_AR: Record<string, string> = {
  levelOne: "المستوى الأول",
  levelTwo: "المستوى الثاني",
  manual: "الفحص اليدوي",
  opposite: "الطرف المقابل",
  liveMeans: "الوسائل الحية",
  review: "المراجعة (المرجع)",
};

const BAND_LABELS_AR: Record<string, string> = {
  none: "لا بيانات",
  insufficient: "بيانات غير كافية",
  limited: "بيانات محدودة",
  sufficient: "بيانات كافية",
};

const INSUFFICIENT_NOTE = "بيانات غير كافية";

/** Format a rate that may be null (empty denominator) — never shows 0% on no data. */
function fmtPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${Math.max(0, Math.min(100, value)).toFixed(1)}%`;
}

function fmtCount(value: number | null | undefined): string {
  // App standard is Latin (Western) digits — "ar-SA-u-nu-latn" — not the
  // Arabic-Indic digits "ar-SA" yields (audit C-10).
  return value != null && Number.isFinite(value) ? value.toLocaleString("ar-SA-u-nu-latn") : "—";
}

/** username → display name map for reviewers, from managed users. */
function buildDisplayNameMap(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const u of getManagedLoginUsers()) map[u.username] = u.displayName || u.username;
  return map;
}

function Chart({ svg }: { svg: string }) {
  return <div className="rh-chart" dangerouslySetInnerHTML={{ __html: svg }} />;
}

/** B2: fold (fileName → revision|null) pairs into a SourceRevisions map, dropping absent files. */
function collectRevisions(pairs: Array<[string, number | null]>): SourceRevisions {
  const out: SourceRevisions = {};
  for (const [file, rev] of pairs) {
    if (rev !== null) out[file] = rev;
  }
  return out;
}

// Inner component that holds all the existing Reports state and logic.
function ReportsContent() {
  const { directoryHandle } = useWorkspace();
  const { can, canMutate } = usePermissions();
  const labels = useLabels();

  const { selection: globalMonth } = useGlobalMonth();
  // Pending months have no folder on disk yet — treat them as "no data" (empty states).
  const selectedMonth = globalMonth.kind === "existing" ? globalMonth.folderName : "";
  // B5: export/generate controls must be permission-gated — previously ANY authenticated
  // user who could reach this tab could trigger real exports (including the PowerBI
  // disk write in handlePbiExport) with no check against the "export-reports" feature.
  // canExportReports drives render-time disable/hide (mirrors Population/index.tsx:183);
  // the mutating handlers (handleExport, handlePbiExport, generate) additionally
  // re-check canMutate() as the authoritative, defense-in-depth gate right before doing
  // real work, so a control that is (incorrectly) left enabled can never still mutate.
  const canExportReports = can("export-reports");
  const isAdmin = readSession()?.role === "admin";
  const [customizerOpen, setCustomizerOpen] = useState(false);
  const [customizerInput, setCustomizerInput] = useState<{ execInput: ExecutiveReportInput; names: Record<string, string> } | null>(null);
  const [monthMeta, setMonthMeta] = useState<MonthMeta | null>(null);
  const [section, setSection] = useState<ReportsSection>("reports");
  const [generating, setGenerating] = useState<ReportType | null>(null);
  const [formats, setFormats] = useState<Record<ReportBaseType, ReportFormat>>({
    executive: "document",
    sample: "document",
    distribution: "document",
    management: "document",
  });
  const [toast, setToast] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [model, setModel] = useState<ReportModel | null>(null);
  const [modelError, setModelError] = useState<"no-population" | "build-error" | null>(null);
  const [modelLoading, setModelLoading] = useState(false);
  // Remembers which (directoryHandle, month) pair the current `model` was
  // built for, so switching sub-tabs away from "kpi" and back does not
  // rebuild it from scratch -- loadExecInput is the heaviest read path in
  // this tab (population + sample + all employee files + template +
  // distribution). A stale ref value never causes a false cache hit: a
  // handle/month change means the key comparison below simply fails to
  // match, and a build failure leaves the ref untouched (not matching
  // either), so both cases still trigger a rebuild -- only the
  // `!directoryHandle || !selectedMonth` branch explicitly sets it back to
  // null.
  const kpiModelBuiltForRef = useRef<{ directoryHandle: typeof directoryHandle; month: string } | null>(null);
  const [exporting, setExporting] = useState<"document" | "deck" | "xlsx" | null>(null);
  const [pbiExporting, setPbiExporting] = useState(false);
  const [pbiResult, setPbiResult] = useState<ExportManifest | null>(null);
  const [pbiError, setPbiError] = useState<string | null>(null);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("pop-subtab-changed", { detail: section }));
  }, [section]);

  useEffect(() => {
    function handler(e: CustomEvent<{ subTabId: string }>) {
      const { subTabId } = e.detail;
      if (KNOWN_REPORT_SECTIONS.has(subTabId as ReportsSection)) {
        setSection(subTabId as ReportsSection);
      }
    }
    window.addEventListener("pop-set-subtab", handler as EventListener);
    return () => window.removeEventListener("pop-set-subtab", handler as EventListener);
  }, []);

  // Load lightweight meta for the month bar chips (§L Tier 1/2: manifest
  // instead of the full population, no employee-files read at all --
  // studiedCount is sourced from the KPI model below once it's built,
  // matching the pattern that model already uses to defer its own cost).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync null-clear when workspace or month is deselected; synchronizes with external workspace state
    if (!directoryHandle || !selectedMonth) { setMonthMeta(null); return; }
    let cancelled = false;
    setMonthMeta(null);
    void (async () => {
      try {
        const [manifest, sample] = await Promise.all([
          loadMonthManifest(directoryHandle, selectedMonth),
          loadSampleMaster(directoryHandle, selectedMonth),
        ]);
        if (cancelled) return;
        setMonthMeta({
          folderName: selectedMonth,
          populationCount: manifest?.totalProcessedRows ?? null,
          sampleCount: sample ? sample.rows.length : null,
          studiedCount: null,
        });
      } catch {
        if (!cancelled) {
          setMonthMeta({ folderName: selectedMonth, populationCount: null, sampleCount: null, studiedCount: null });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [directoryHandle, selectedMonth]);

  // Assemble the executive-report input from disk — the SAME inputs that feed
  // openExecutiveReport / openExecutiveDeckV2 / buildExecutiveXlsx, so the live
  // dashboard and the exported artifacts can never disagree.
  const loadExecInput = useCallback(async (): Promise<ExecutiveReportInput | null> => {
    if (!directoryHandle || !selectedMonth) return null;
    const [populationFinal, sample, employeeFiles, templateSelection, popRev, sampleRev, distRev] = await Promise.all([
      loadMonthPopulationFinal(directoryHandle, selectedMonth),
      loadSampleMaster(directoryHandle, selectedMonth),
      loadAllEmployeeFiles(directoryHandle, selectedMonth),
      loadInspectionTemplateSelection(directoryHandle),
      loadMonthPopulationFinalRevision(directoryHandle, selectedMonth),
      loadSampleMasterRevision(directoryHandle, selectedMonth),
      loadDistributionCurrentRevision(directoryHandle, selectedMonth),
    ]);
    if (!populationFinal) return null;
    const template = templateSelection?.templateId
      ? await loadTemplate(directoryHandle, templateSelection.templateId)
      : null;
    const distribution = sample
      ? await loadOrDeriveDistributionCurrentForRead(directoryHandle, selectedMonth, sample.rows)
      : null;
    // B2: cite the exact source-file revisions this report was built from.
    const sourceRevisions = collectRevisions([
      ["population.final.json", popRev],
      ["sample.master.json", sampleRev],
      ["distribution.current.json", distRev],
    ]);
    return {
      monthFolderName: selectedMonth,
      populationRows: populationFinal.rows as unknown as PreparedPopulationRow[],
      sample: sample ?? null,
      distribution: distribution ?? null,
      employeeFiles,
      template,
      config: DEFAULT_EXEC_CONFIG,
      sourceRevisions,
    };
  }, [directoryHandle, selectedMonth]);

  // Build the live analytics model ONCE per (directoryHandle, month) while the
  // dashboard is open -- and keep it cached (not nulled) across a plain
  // switch away from "kpi" and back, so returning to the dashboard is
  // instant instead of re-running the heaviest read path in this tab.
  useEffect(() => {
    if (section !== "kpi") return;
    if (!directoryHandle || !selectedMonth) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync-clear when dashboard closed / no month
      setModel(null);
      kpiModelBuiltForRef.current = null;
      return;
    }
    const alreadyBuilt =
      kpiModelBuiltForRef.current !== null &&
      kpiModelBuiltForRef.current.directoryHandle === directoryHandle &&
      kpiModelBuiltForRef.current.month === selectedMonth;
    if (alreadyBuilt) return;

    let cancelled = false;
    setModelLoading(true);
    setModel(null);
    setModelError(null);
    void (async () => {
      try {
        const execInput = await loadExecInput();
        if (cancelled) return;
        if (!execInput) { setModel(null); setModelError("no-population"); return; }
        const builtModel = buildReportModel(execInput, buildDisplayNameMap());
        setModel(builtModel);
        kpiModelBuiltForRef.current = { directoryHandle, month: selectedMonth };
        // §L Tier 2: backfill the studied-count chip from the model we just
        // built instead of a separate loadAllEmployeeFiles read -- only
        // available once the KPI dashboard has actually been opened.
        setMonthMeta((current) =>
          current && current.folderName === selectedMonth
            ? { ...current, studiedCount: builtModel.sample.studied }
            : current
        );
      } catch (err) {
        if (!cancelled) {
          setModel(null);
          setModelError("build-error");
          logRejection("reports:buildReportModel")(err);
        }
      } finally {
        if (!cancelled) setModelLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [section, directoryHandle, selectedMonth, loadExecInput]);

  function showToast(type: "ok" | "error", text: string) {
    setToast({ type, text });
    setTimeout(() => setToast(null), 5000);
  }

  // Dashboard export actions — reuse the assembled exec input for all three.
  async function handleExport(kind: "document" | "deck" | "xlsx"): Promise<void> {
    if (!directoryHandle || !selectedMonth || exporting) return;
    if (!canMutate("export-reports")) {
      showToast("error", "لا تملك صلاحية تصدير التقارير.");
      return;
    }
    setExporting(kind);
    try {
      const execInput = await loadExecInput();
      if (!execInput) { showToast("error", "لم يتم العثور على بيانات المجتمع. يجب معالجة المجتمع أولاً."); return; }
      const names = buildDisplayNameMap();
      if (kind === "document") {
        const { openExecutiveReport } = await import("../../../../data/reporting/executiveReport");
        await openExecutiveReport(execInput, names);
        showToast("ok", "تم فتح التقرير التفصيلي.");
      } else if (kind === "deck") {
        const saved = directoryHandle ? await loadDeckStyleChoices(directoryHandle) : null;
        const { openExecutiveDeckV2 } = await import("../../../../data/reporting/executive/deck2");
        await openExecutiveDeckV2(execInput, names, saved?.choices);
        showToast("ok", "تم فتح العرض التنفيذي.");
      } else {
        const { buildExecutiveXlsx } = await import("../../../../data/reporting/executiveReport");
        await buildExecutiveXlsx(execInput, names);
        showToast("ok", "تم تنزيل بيانات التقرير (Excel).");
      }
    } catch {
      showToast("error", "حدث خطأ أثناء توليد التقرير.");
    } finally {
      setExporting(null);
    }
  }

  async function handleOpenCustomizer(): Promise<void> {
    if (!directoryHandle || !selectedMonth) return;
    if (!canMutate("export-reports")) {
      showToast("error", "لا تملك صلاحية تصدير التقارير.");
      return;
    }
    const execInput = await loadExecInput();
    if (!execInput) { showToast("error", "لم يتم العثور على بيانات المجتمع. يجب معالجة المجتمع أولاً."); return; }
    setCustomizerInput({ execInput, names: buildDisplayNameMap() });
    setCustomizerOpen(true);
  }

  async function handlePbiExport() {
    if (!directoryHandle || !selectedMonth) return;
    if (!canMutate("export-reports")) {
      setPbiError("لا تملك صلاحية تصدير التقارير.");
      return;
    }
    setPbiExporting(true);
    setPbiResult(null);
    setPbiError(null);
    try {
      const { runPowerBiExport } = await import("../../../../data/powerbiExport/exportManager");
      const manifest = await runPowerBiExport(directoryHandle, selectedMonth);
      setPbiResult(manifest);
    } catch (err) {
      setPbiError(err instanceof Error ? err.message : "حدث خطأ أثناء التصدير");
    } finally {
      setPbiExporting(false);
    }
  }

  async function generate(type: ReportType): Promise<void> {
    if (!directoryHandle || !selectedMonth || generating) return;
    if (!canMutate("export-reports")) {
      showToast("error", "لا تملك صلاحية تصدير التقارير.");
      return;
    }
    setGenerating(type);
    try {
      if (type === "sample" || type === "sample-xlsx" || type === "sample-deck") {
        const { populationRows, sampleData, manifest } = await loadMonthForEditing(directoryHandle, selectedMonth);
        if (!sampleData) { showToast("error", "لم يتم العثور على بيانات عينة لهذا الشهر."); return; }
        const [samplePopRev, sampleMasterRev] = await Promise.all([
          loadMonthPopulationFinalRevision(directoryHandle, selectedMonth),
          loadSampleMasterRevision(directoryHandle, selectedMonth),
        ]);
        const sampleInput = {
          monthFolderName: selectedMonth,
          manifest,
          populationRows: (populationRows ?? []) as unknown as PreparedPopulationRow[],
          sample: sampleData,
          sourceRevisions: collectRevisions([
            ["population.final.json", samplePopRev],
            ["sample.master.json", sampleMasterRev],
          ]),
        };
        if (type === "sample-xlsx") {
          const { buildSampleXlsx } = await import("../../../../data/reporting/sampleReport");
          await buildSampleXlsx(sampleInput);
          showToast("ok", "تم تنزيل ملف Excel.");
        } else if (type === "sample-deck") {
          const { openSampleDeck } = await import("../../../../data/reporting/sampleReport");
          await openSampleDeck(sampleInput);
          showToast("ok", "تم فتح عرض العينة. استخدم أمر الطباعة للحفظ بصيغة PDF.");
        } else {
          const { openSampleReport } = await import("../../../../data/reporting/sampleReport");
          await openSampleReport(sampleInput);
          showToast("ok", "تم فتح تقرير العينة التفصيلي. استخدم أمر الطباعة للحفظ بصيغة PDF.");
        }
      } else if (type === "distribution" || type === "distribution-xlsx" || type === "distribution-deck") {
        const sample = await loadSampleMaster(directoryHandle, selectedMonth);
        const data = sample ? await loadOrDeriveDistributionCurrentForRead(directoryHandle, selectedMonth, sample.rows) : null;
        if (!data) { showToast("error", "لم يتم العثور على بيانات توزيع لهذا الشهر."); return; }
        const names = buildDisplayNameMap();
        const [distSampleRev, distCurrentRev] = await Promise.all([
          loadSampleMasterRevision(directoryHandle, selectedMonth),
          loadDistributionCurrentRevision(directoryHandle, selectedMonth),
        ]);
        const distRevisions = collectRevisions([
          ["sample.master.json", distSampleRev],
          ["distribution.current.json", distCurrentRev],
        ]);
        if (type === "distribution-xlsx") {
          const { buildDistributionXlsx } = await import("../../../../data/reporting/distributionReport");
          await buildDistributionXlsx(data, selectedMonth, names, distRevisions);
          showToast("ok", "تم تنزيل ملف Excel.");
        } else if (type === "distribution-deck") {
          const { openDistributionDeck } = await import("../../../../data/reporting/distributionReport");
          await openDistributionDeck(data, selectedMonth, names, distRevisions);
          showToast("ok", "تم فتح عرض التوزيع. استخدم أمر الطباعة للحفظ بصيغة PDF.");
        } else {
          const { openDistributionDocument } = await import("../../../../data/reporting/distributionReport");
          await openDistributionDocument(data, selectedMonth, names, distRevisions);
          showToast("ok", "تم فتح تقرير التوزيع التفصيلي. استخدم أمر الطباعة للحفظ بصيغة PDF.");
        }
      } else if (type === "executive" || type === "executive-xlsx" || type === "executive-deck") {
        const execInput = await loadExecInput();
        if (!execInput) { showToast("error", "لم يتم العثور على بيانات المجتمع. يجب معالجة المجتمع أولاً."); return; }
        const names = buildDisplayNameMap();
        if (type === "executive-xlsx") {
          const { buildExecutiveXlsx } = await import("../../../../data/reporting/executiveReport");
          await buildExecutiveXlsx(execInput, names);
          showToast("ok", "تم تنزيل ملف بيانات التقرير (Excel).");
        } else if (type === "executive-deck") {
          const saved = directoryHandle ? await loadDeckStyleChoices(directoryHandle) : null;
          const { openExecutiveDeckV2 } = await import("../../../../data/reporting/executive/deck2");
          await openExecutiveDeckV2(execInput, names, saved?.choices);
          showToast("ok", "تم فتح العرض التنفيذي. استخدم أمر الطباعة للحفظ بصيغة PDF.");
        } else {
          const { openExecutiveReport } = await import("../../../../data/reporting/executiveReport");
          await openExecutiveReport(execInput, names);
          showToast("ok", "تم فتح التقرير التفصيلي. استخدم أمر الطباعة للحفظ بصيغة PDF.");
        }
      } else if (type === "management" || type === "management-xlsx" || type === "management-deck") {
        const execInput = await loadExecInput();
        if (!execInput) { showToast("error", labels.mgmt_card_toast_no_population); return; }
        const names = buildDisplayNameMap();
        if (type === "management-xlsx") {
          const { buildManagementWorkbook } = await import("../../../../data/reporting/management/managementWorkbook");
          buildManagementWorkbook(execInput, names);
          showToast("ok", "تم تنزيل ملف بيانات الإدارة (Excel).");
        } else if (type === "management-deck") {
          const { openManagementDeck } = await import("../../../../data/reporting/management/managementDeck");
          await openManagementDeck(execInput, names);
          showToast("ok", "تم فتح عرض الإدارة. استخدم أمر الطباعة للحفظ بصيغة PDF.");
        } else {
          const { openManagementReport } = await import("../../../../data/reporting/management/managementReport");
          openManagementReport(execInput, names);
          showToast("ok", labels.mgmt_card_toast_opened);
        }
      }
    } catch {
      showToast("error", "حدث خطأ أثناء توليد التقرير.");
    } finally {
      setGenerating(null);
    }
  }

  function selectedReportType(baseType: ReportBaseType): ReportType {
    // Uniform mapping across all four cards: document → base id, deck → `${base}-deck`,
    // xlsx → `${base}-xlsx`. Executive keeps its existing "executive" document id.
    const format = formats[baseType];
    if (format === "deck") return `${baseType}-deck` as ReportType;
    if (format === "xlsx") return `${baseType}-xlsx` as ReportType;
    return baseType as ReportType; // document
  }

  // Explains why an export/generate control is disabled — permission first (an
  // outright "you cannot export" is the most actionable reason), then the pending-
  // vs-no-month distinction (B5 polish: a pending month has no processed population
  // yet, which reads very differently from "no months exist at all"). Returns
  // undefined once the control is fully enabled, so callers can pass it straight to
  // `title` without an extra ternary at each call site.
  function exportDisabledTitle(): string | undefined {
    if (!canExportReports) return "لا تملك صلاحية تصدير التقارير.";
    if (!selectedMonth) {
      return globalMonth.kind === "pending"
        ? "لم تتم معالجة مجتمع هذا الشهر بعد — لا توجد بيانات جاهزة للتصدير."
        : "لا يوجد شهر محدد يحتوي بيانات — لا يوجد ما يمكن تصديره.";
    }
    return undefined;
  }

  function renderExportControls(baseType: ReportBaseType, toneClass: string): ReactNode {
    const selectedType = selectedReportType(baseType);
    const isBusy = generating === selectedType;
    // Every card now offers the same three formats (audit / Wave 3 rework).
    const availableFormats: ReportFormat[] = ["deck", "xlsx", "document"];
    const formatTitle = (f: ReportFormat): string =>
      f === "xlsx" ? "بيانات (Excel)"
      : f === "deck" ? "عرض تقديمي تفاعلي (HTML)"
      : "تقرير تفصيلي تفاعلي (HTML)";
    return (
      <div className="rh-export-controls" role="group" aria-label="صيغة التصدير">
        <button
          type="button"
          className={`rh-btn ${toneClass}`}
          disabled={busy || !selectedMonth || !canExportReports}
          title={exportDisabledTitle()}
          onClick={() => { void generate(selectedType); }}
        >
          {isBusy ? <span className="rh-spinner" /> : null}
          {isBusy ? "جاري…" : "التصدير"}
        </button>
        <div className="rh-format-toggle">
          {availableFormats.map((format) => (
            <button
              key={format}
              type="button"
              className={formats[baseType] === format ? "active" : ""}
              title={formatTitle(format)}
              aria-label={formatTitle(format)}
              onClick={() => setFormats((prev) => ({ ...prev, [baseType]: format }))}
            >
              {format === "xlsx" ? <ExcelFormatIcon /> : format === "deck" ? <PresentationFormatIcon /> : <FileText size={17} strokeWidth={2.2} />}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (!directoryHandle) {
    return (
      <section className="rh-page" dir="rtl">
        <div className="rh-empty">
          <span className="rh-empty-icon"><FolderOpen size={28} strokeWidth={1.75} aria-hidden /></span>
          <strong>لم يتم تحديد مساحة عمل</strong>
          <span>اختر مجلد العمل من الشريط الجانبي للمتابعة.</span>
        </div>
      </section>
    );
  }

  const fmtNum = (n: number | null | undefined) =>
    n != null ? n.toLocaleString("ar-SA-u-nu-latn") : "—";

  const busy = generating !== null;

  // ── Analytics dashboard (the upgraded "مؤشرات الأداء" sub-section) ──────────
  function renderDashboard(): ReactNode {
    if (modelLoading) {
      return (
        <div className="rh-dash-loading">
          <span className="rh-spinner" /> جارٍ تجهيز لوحة التحليلات…
        </div>
      );
    }
    if (!model) {
      if (modelError === "build-error") {
        return (
          <div className="rh-empty rh-kpi-empty">
            <strong>تعذّر بناء لوحة التحليلات لهذا الشهر</strong>
            <span>
              حدث خطأ غير متوقع أثناء تحليل بيانات الشهر — البيانات موجودة لكن معالجتها فشلت.
              افتح وحدة تحكم المتصفح (F12 ثم Console) وأرسل نص الخطأ الظاهر للدعم.
            </span>
          </div>
        );
      }
      return (
        <div className="rh-empty rh-kpi-empty">
          <strong>لا يوجد مجتمع معالج لهذا الشهر</strong>
          <span>
            لم يتم العثور على ملف المجتمع المعالج (population.final.json) داخل مجلد الشهر.
            عالج مجتمع هذا الشهر من تبويب «المجتمع» أولاً، ثم عد إلى هذه الصفحة.
          </span>
        </div>
      );
    }

    const s = model.summary;
    const dq = model.dataQuality;
    const reviewerNames = buildDisplayNameMap();
    const headlineNote = (band: string) =>
      band === "none" || band === "insufficient" ? INSUFFICIENT_NOTE : undefined;

    // Reviewer-agreement ranked bar (cross-team view) — agreement rate per source.
    const agreementBars = model.resultComparison.reviewerAgreement
      .filter((r) => r.comparable > 0 && r.agreementRate != null)
      .map((r) => ({ label: RESULT_SOURCE_LABELS_AR[r.source] ?? r.source, value: Math.round(r.agreementRate ?? 0) }));

    // Port accuracy ranked bar.
    const portBars = model.portAccuracy
      .filter((p) => p.accuracy != null)
      .sort((a, b) => (b.accuracy ?? 0) - (a.accuracy ?? 0))
      .slice(0, 8)
      .map((p) => ({ label: p.key, value: Math.round(p.accuracy ?? 0) }));

    // Outcome donut (error-mix).
    const t = model.errorAnalysis.totals;
    const outcomeDonut = [
      { label: "سليمة صحيحة", value: t.correctClean },
      { label: "اشتباه صحيح", value: t.correctSuspicion },
      { label: "اشتباه فائت", value: t.missedSuspicion },
      { label: "اشتباه زائد", value: t.falseSuspicion },
    ];

    return (
      <div className="rh-dash" aria-label="لوحة التحليلات التنفيذية">
        {/* Exports toolbar */}
        <div className="rh-dash-toolbar" role="group" aria-label="تصدير التقارير">
          <span className="rh-dash-toolbar-label">تصدير</span>
          <button
            type="button"
            className="rh-btn rh-btn-teal"
            disabled={exporting !== null || !selectedMonth || !canExportReports}
            title={exportDisabledTitle()}
            onClick={() => { void handleExport("document"); }}
          >
            {exporting === "document" ? <span className="rh-spinner" /> : <FileText size={15} strokeWidth={2} />}
            فتح التقرير التفصيلي (HTML)
          </button>
          <button
            type="button"
            className="rh-btn rh-btn-navy"
            disabled={exporting !== null || !selectedMonth || !canExportReports}
            title={exportDisabledTitle()}
            onClick={() => { void handleExport("deck"); }}
          >
            {exporting === "deck" ? <span className="rh-spinner" /> : <BarChart2 size={15} strokeWidth={2} />}
            فتح العرض التنفيذي (HTML)
          </button>
          {isAdmin ? (
            <button
              type="button"
              className="rh-btn"
              disabled={exporting !== null || !selectedMonth || !canExportReports}
              title="تخصيص تصميم العرض التنفيذي (للمدير فقط)"
              onClick={() => { void handleOpenCustomizer(); }}
            >
              <Settings2 size={15} strokeWidth={2} />
              تخصيص تصميم العرض
            </button>
          ) : null}
          <button
            type="button"
            className="rh-btn rh-btn-indigo"
            disabled={exporting !== null || !selectedMonth || !canExportReports}
            title={exportDisabledTitle()}
            onClick={() => { void handleExport("xlsx"); }}
          >
            {exporting === "xlsx" ? <span className="rh-spinner" /> : <Download size={15} strokeWidth={2} />}
            بيانات التقرير (Excel)
          </button>
        </div>

        {/* Data-quality banner */}
        <div className={`rh-dash-band rh-band-${dq.overallBand}`}>
          <span className="rh-dash-band-tag">{BAND_LABELS_AR[dq.overallBand]}</span>
          <span>
            {fmtCount(dq.evaluableDecisionRecords)} قرار قابل للتقييم من أصل {fmtCount(dq.totalDecisionRecords)}.
            {!dq.biAvailable && " لا تتوفر بيانات BI لهذا الشهر."}
          </span>
        </div>

        {/* Headline KPI cards */}
        <div className="rh-dash-kpis">
          <article className="rh-dash-kpi">
            <span className="rh-dash-kpi-label">دقة الفحص الإجمالية</span>
            <strong className="rh-dash-kpi-value">{fmtPct(s.overallAccuracy)}</strong>
            {headlineNote(dq.overallBand) && <span className="rh-dash-kpi-note">{headlineNote(dq.overallBand)}</span>}
          </article>
          <article className="rh-dash-kpi">
            <span className="rh-dash-kpi-label">معدل كشف الاشتباه</span>
            <strong className="rh-dash-kpi-value">{fmtPct(s.detectionRate)}</strong>
          </article>
          <article className="rh-dash-kpi rh-dash-kpi-risk">
            <span className="rh-dash-kpi-label">الاشتباه الفائت (المخاطرة الرئيسية)</span>
            <strong className="rh-dash-kpi-value">{fmtPct(s.missedSuspicionRate)}</strong>
          </article>
          <article className="rh-dash-kpi">
            <span className="rh-dash-kpi-label">نسبة الإنجاز</span>
            <strong className="rh-dash-kpi-value">{fmtPct(s.completionRate)}</strong>
          </article>
        </div>

        {/* Gauges + outcome donut */}
        <div className="rh-dash-charts">
          <div className="rh-dash-chart-card">
            <h4>دقة الفحص الإجمالية</h4>
            <Chart svg={gauge(s.overallAccuracy, { emptyNote: INSUFFICIENT_NOTE })} />
          </div>
          <div className="rh-dash-chart-card">
            <h4>معدل كشف الاشتباه</h4>
            <Chart svg={gauge(s.detectionRate, { emptyNote: INSUFFICIENT_NOTE })} />
          </div>
          <div className="rh-dash-chart-card">
            <h4>توزيع نتائج القرارات</h4>
            <Chart svg={donut(outcomeDonut, { emptyNote: INSUFFICIENT_NOTE })} />
          </div>
        </div>

        {/* Reviewer-agreement (cross-team) */}
        <section className="rh-dash-section">
          <h3>اتفاق الفرق مع المراجعة (المرجع)</h3>
          <div className="rh-dash-split">
            <div className="rh-dash-chart-card rh-dash-grow">
              <h4>معدل الاتفاق لكل مصدر</h4>
              <Chart svg={rankedBar(agreementBars, { width: 380, emptyNote: INSUFFICIENT_NOTE })} />
            </div>
            <div className="rh-dash-table-wrap">
              <table className="rh-dash-table">
                <thead>
                  <tr>
                    <th>المصدر</th>
                    <th>قابلة للمقارنة</th>
                    <th>اتفاق</th>
                    <th>اختلاف</th>
                    <th>معدل الاتفاق</th>
                  </tr>
                </thead>
                <tbody>
                  {model.resultComparison.reviewerAgreement.map((r) => (
                    <tr key={r.source}>
                      <td>{RESULT_SOURCE_LABELS_AR[r.source] ?? r.source}</td>
                      <td>{fmtCount(r.comparable)}</td>
                      <td>{fmtCount(r.agree)}</td>
                      <td>{fmtCount(r.disagree)}</td>
                      <td>{r.comparable > 0 ? fmtPct(r.agreementRate) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* Port accuracy */}
        <section className="rh-dash-section">
          <h3>الدقة حسب المنفذ</h3>
          <div className="rh-dash-split">
            <div className="rh-dash-chart-card rh-dash-grow">
              <Chart svg={rankedBar(portBars, { width: 380, emptyNote: INSUFFICIENT_NOTE })} />
            </div>
            <div className="rh-dash-table-wrap">
              <table className="rh-dash-table">
                <thead>
                  <tr>
                    <th>المنفذ</th>
                    <th>قابلة للتقييم</th>
                    <th>الدقة</th>
                    <th>الاشتباه الفائت</th>
                    <th>الكفاية</th>
                  </tr>
                </thead>
                <tbody>
                  {model.portAccuracy.map((p) => (
                    <tr key={p.key}>
                      <td>{p.key}</td>
                      <td>{fmtCount(p.evaluable)}</td>
                      <td>{fmtPct(p.accuracy)}</td>
                      <td>{fmtPct(p.missedSuspicionRate)}</td>
                      <td><span className={`rh-band-pill rh-band-${p.band}`}>{BAND_LABELS_AR[p.band]}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* Stage coverage */}
        <section className="rh-dash-section">
          <h3>التغطية حسب المستوى</h3>
          <div className="rh-dash-table-wrap">
            <table className="rh-dash-table">
              <thead>
                <tr>
                  <th>المستوى</th>
                  <th>المجتمع</th>
                  <th>حجم العينة</th>
                  <th>التغطية</th>
                  <th>المدروسة</th>
                  <th>الإنجاز</th>
                </tr>
              </thead>
              <tbody>
                {model.population.byStage.map((st) => (
                  <tr key={st.stageKey}>
                    <td>{st.stageLabel}</td>
                    <td>{fmtCount(st.population)}</td>
                    <td>{fmtCount(st.sampleSize)}</td>
                    <td>{fmtPct(st.coverage)}</td>
                    <td>{fmtCount(st.studied)}</td>
                    <td>{fmtPct(st.completionRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Employee / reviewer overview */}
        <section className="rh-dash-section">
          <h3>نظرة عامة على المراجعين</h3>
          {!model.employeeOverview.inspectorIdentityMapped && (
            <div className="rh-dash-band rh-band-insufficient">
              <span className="rh-dash-band-tag">تنبيه</span>
              <span>هوية المفتش غير مرتبطة (لم تتم مطابقة BI) — تُعرض أعباء عمل المراجعين فقط، لا دقة المفتشين.</span>
            </div>
          )}
          <div className="rh-dash-table-wrap">
            <table className="rh-dash-table">
              <thead>
                <tr>
                  <th>المراجع</th>
                  <th>المدروسة</th>
                  <th>الدقة</th>
                  <th>كشف الاشتباه</th>
                  <th>الاشتباه الفائت</th>
                  <th>الكفاية</th>
                </tr>
              </thead>
              <tbody>
                {model.employeeOverview.reviewerProfiles.length === 0 ? (
                  <tr><td colSpan={6} className="rh-dash-empty-cell">{INSUFFICIENT_NOTE}</td></tr>
                ) : (
                  model.employeeOverview.reviewerProfiles.map((p) => (
                    <tr key={p.username}>
                      <td>{model.employeeOverview.reviewerDisplayNames[p.username] ?? p.username}</td>
                      <td>{fmtCount(p.studied)}</td>
                      <td>{fmtPct(p.overallAccuracy)}</td>
                      <td>{fmtPct(p.suspiciousDetectionRate)}</td>
                      <td>{fmtPct(p.missedSuspicionRate)}</td>
                      <td><span className={`rh-band-pill ${p.reliable ? "rh-band-sufficient" : "rh-band-insufficient"}`}>{p.reliable ? "موثوق" : INSUFFICIENT_NOTE}</span></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Per-reviewer KPIs + SPC p-charts (Tier-2 / research gap #18) */}
        <ReviewerKpiPanel
          model={model.reviewerKpis}
          resolveName={(username) => reviewerNames[username] ?? username}
        />

        {/* Error-type mix by port (heatmap) */}
        {model.errorAnalysis.byPort.length > 0 && (
          <section className="rh-dash-section">
            <h3>أنواع الأخطاء حسب المنفذ</h3>
            <div className="rh-dash-chart-card">
              <Chart
                svg={heatmap(
                  {
                    rows: model.errorAnalysis.byPort.map((p) => p.key),
                    cols: ["سليمة صحيحة", "اشتباه صحيح", "اشتباه فائت", "اشتباه زائد"],
                    values: model.errorAnalysis.byPort.map((p) => [
                      p.correctClean,
                      p.correctSuspicion,
                      p.missedSuspicion,
                      p.falseSuspicion,
                    ]),
                  },
                  { emptyNote: INSUFFICIENT_NOTE }
                )}
              />
            </div>
          </section>
        )}
      </div>
    );
  }

  return (
    <>
    <section className="rh-page" dir="rtl">
      {/* ── Toast ───────────────────────────────────── */}
      {toast && (
        <div className={`rh-toast rh-toast-${toast.type}`} role="status">
          <span>{toast.type === "ok" ? <Check size={14} style={{ verticalAlign: "middle" }} /> : <AlertTriangle size={14} style={{ verticalAlign: "middle" }} />}</span>
          {toast.text}
          <button className="rh-toast-close" onClick={() => setToast(null)}><X size={16} /></button>
        </div>
      )}

      {/* ── Page header ─────────────────────────────── */}
      <div className="rh-header">
        <div className="rh-header-main">
          <div className="rh-eyebrow">إدارة التقارير</div>
          <h1 className="rh-title">مركز التقارير</h1>
          <p className="rh-sub">اختر التقرير المناسب وولّده مباشرةً — تقارير HTML تفاعلية جاهزة للمشاركة والطباعة.</p>
        </div>
        <div className="rh-nav" role="tablist" aria-label="أقسام إدارة التقارير">
          <button
            type="button"
            role="tab"
            aria-selected={section === "reports"}
            className={`rh-nav-btn${section === "reports" ? " active" : ""}`}
            onClick={() => setSection("reports")}
          >
            التقارير
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={section === "kpi"}
            className={`rh-nav-btn${section === "kpi" ? " active" : ""}`}
            onClick={() => setSection("kpi")}
          >
            مؤشرات
          </button>
        </div>
      </div>

      {/* ── Month bar ───────────────────────────────── */}
      <div className="rh-month-bar">
        <span className="rh-month-label">الشهر</span>
        <strong className="rh-month-current">
          {globalMonth.kind === "none"
            ? "لا توجد أشهر"
            : formatMonthFolderShortLabel(globalMonth.folderName)}
        </strong>
        <div className="rh-month-sep" />
        <div className="rh-month-chips">
          <span className="rh-chip rh-chip-pop">
            <Database size={12} />
            {monthMeta?.populationCount != null ? `${fmtNum(monthMeta.populationCount)} صورة` : "—"}
          </span>
          <span className="rh-chip rh-chip-samp">
            <Filter size={12} />
            {monthMeta?.sampleCount != null ? `${fmtNum(monthMeta.sampleCount)} عينة` : "—"}
          </span>
          <span className="rh-chip rh-chip-ans">
            <Check size={12} />
            {monthMeta?.studiedCount != null ? `${fmtNum(monthMeta.studiedCount)} مدروسة` : "—"}
          </span>
        </div>
      </div>

      {/* B5: a "pending" month has no folder on disk yet, so every export/generate
          control below is disabled — explain why instead of leaving it a silent gap
          next to a header that already shows the pending month's name. */}
      {globalMonth.kind === "pending" && (
        <p className="rh-pbi-month-empty">
          لم تتم معالجة مجتمع الشهر المحدد بعد — عناصر التقارير والتصدير تبقى معطّلة حتى تتم معالجة بيانات هذا الشهر من تبويب «إدارة بيانات الأشعة».
        </p>
      )}

      {section === "kpi" && (
        <TabGuard tabId="reports/kpi">
          {renderDashboard()}
        </TabGuard>
      )}


      {section === "reports" && (
        <>
          {/* ── Section label ───────────────────────────── */}
          <div className="rh-section-label">التقارير الرئيسية</div>

          {/* ── Cards grid ──────────────────────────────── */}
          <div className="rh-grid">

        {/* Executive — featured */}
        <div className="rh-card rh-card-featured">
          <div className="rh-card-accent rh-acc-teal" />
          <div className="rh-card-body">
            <div className="rh-card-top">
              <div className="rh-icon rh-icon-teal"><BarChart2 size={22} /></div>
              <div className="rh-card-top-left">
                <span className="rh-badge rh-badge-main">الرئيسي</span>
                {isAdmin ? (
                  <button
                    type="button"
                    className="rh-card-customize-btn"
                    disabled={busy || !selectedMonth || !canExportReports}
                    title="تخصيص تصميم العرض التنفيذي (للمدير فقط)"
                    aria-label="تخصيص التصميم"
                    onClick={() => { void handleOpenCustomizer(); }}
                  >
                    <Settings2 size={15} strokeWidth={2} />
                  </button>
                ) : null}
              </div>
            </div>
            <div className="rh-card-title">التقرير التنفيذي</div>
            <p className="rh-card-desc">
              ثلاث صيغ من نفس التحليل: عرض تنفيذي بالشرائح للاجتماعات، وتقرير تفصيلي كامل
              للسجل، وملف Excel ببيانات التقرير الخام والمعالجة. اختر الصيغة من الأيقونات.
            </p>
            <div className="rh-tags">
              <span className="rh-tag"><Presentation size={12} style={{ verticalAlign: "middle", marginInlineEnd: 3 }} /> عرض تقديمي</span>
              <span className="rh-tag"><FileText size={12} style={{ verticalAlign: "middle", marginInlineEnd: 3 }} /> تقرير تفصيلي</span>
              <span className="rh-tag"><Download size={12} style={{ verticalAlign: "middle", marginInlineEnd: 3 }} /> Excel</span>
            </div>
          </div>
          <div className="rh-card-footer">
            {renderExportControls("executive", "rh-btn-teal")}
          </div>
        </div>

        {/* Sample */}
        <div className="rh-card">
          <div className="rh-card-accent rh-acc-navy" />
          <div className="rh-card-body">
            <div className="rh-card-top">
              <div className="rh-icon rh-icon-navy"><Filter size={22} /></div>
              <span className="rh-badge rh-badge-ready">جاهز</span>
            </div>
            <div className="rh-card-title">تقرير العينة</div>
            <p className="rh-card-desc">
              تفصيل المنافذ والمراحل — بيانات Risk وBI، خام مقابل معالجة، CertScan/NonCertScan، والصفوف المسحوبة للدراسة.
            </p>
            <div className="rh-tags">
              <span className="rh-tag"><Database size={12} style={{ verticalAlign: "middle", marginInlineEnd: 3 }} /> Risk + BI</span>
              <span className="rh-tag"><Globe size={12} style={{ verticalAlign: "middle", marginInlineEnd: 3 }} /> كل المنافذ</span>
              <span className="rh-tag"><ClipboardList size={12} style={{ verticalAlign: "middle", marginInlineEnd: 3 }} /> مراحل</span>
              <span className="rh-tag"><Download size={12} style={{ verticalAlign: "middle", marginInlineEnd: 3 }} /> XLSX</span>
            </div>
          </div>
          <div className="rh-card-footer">
            {renderExportControls("sample", "rh-btn-navy")}
          </div>
        </div>

        {/* Distribution */}
        <div className="rh-card">
          <div className="rh-card-accent rh-acc-navy" />
          <div className="rh-card-body">
            <div className="rh-card-top">
              <div className="rh-icon rh-icon-navy"><Users size={22} /></div>
              <span className="rh-badge rh-badge-ready">جاهز</span>
            </div>
            <div className="rh-card-title">تقرير التوزيع</div>
            <p className="rh-card-desc">
              حالة التوزيع لكل موظف مع تفاصيل كل صف — قيد الانتظار، مكتمل، مستبدل. يُستخدم لمتابعة سير العمل اليومي.
            </p>
            <div className="rh-tags">
              <span className="rh-tag"><User size={12} style={{ verticalAlign: "middle", marginInlineEnd: 3 }} /> حسب الموظف</span>
              <span className="rh-tag"><History size={12} style={{ verticalAlign: "middle", marginInlineEnd: 3 }} /> أحداث اللوج</span>
              <span className="rh-tag"><Download size={12} style={{ verticalAlign: "middle", marginInlineEnd: 3 }} /> XLSX</span>
            </div>
          </div>
          <div className="rh-card-footer">
            {renderExportControls("distribution", "rh-btn-navy")}
          </div>
        </div>

        {/* Management report — live (C2) */}
        <div className="rh-card">
          <div className="rh-card-accent rh-acc-purple" />
          <div className="rh-card-body">
            <div className="rh-card-top">
              <div className="rh-icon rh-icon-purple"><Building2 size={22} /></div>
              <span className="rh-badge rh-badge-ready">{labels.mgmt_card_badge_ready}</span>
            </div>
            <div className="rh-card-title">{labels.mgmt_report_title}</div>
            <p className="rh-card-desc">{labels.mgmt_card_desc}</p>
            <div className="rh-tags">
              <span className="rh-tag"><Presentation size={12} style={{ verticalAlign: "middle", marginInlineEnd: 3 }} /> عرض تقديمي</span>
              <span className="rh-tag"><FileText size={12} style={{ verticalAlign: "middle", marginInlineEnd: 3 }} /> {labels.mgmt_card_tag_summary}</span>
              <span className="rh-tag"><Download size={12} style={{ verticalAlign: "middle", marginInlineEnd: 3 }} /> Excel</span>
            </div>
          </div>
          <div className="rh-card-footer">
            {renderExportControls("management", "rh-btn-indigo")}
          </div>
        </div>

        {/* Power BI / CSV export */}
        <div className="rh-card">
          <div className="rh-card-accent rh-acc-indigo" />
          <div className="rh-card-body">
            <div className="rh-card-top">
              <div className="rh-icon rh-icon-indigo"><BarChart2 size={22} /></div>
              <span className="rh-badge rh-badge-ready">جاهز</span>
            </div>
            <div className="rh-card-title">تصدير Power BI / CSV</div>
            <p className="rh-card-desc">
              يصدّر بيانات المجتمع والعينة للشهر المحدد كملفات CSV يمكن فتحها مباشرة في Power BI Desktop.
            </p>
            <div className="rh-tags">
              <span className="rh-tag"><Database size={12} style={{ verticalAlign: "middle", marginInlineEnd: 3 }} /> بيانات المجتمع</span>
              <span className="rh-tag"><Filter size={12} style={{ verticalAlign: "middle", marginInlineEnd: 3 }} /> بيانات العينة</span>
              <span className="rh-tag"><Download size={12} style={{ verticalAlign: "middle", marginInlineEnd: 3 }} /> CSV</span>
            </div>
          </div>
          <div className="rh-card-footer">
            <div className="rh-export-controls" role="group">
              {selectedMonth ? (
                <span className="rh-pbi-month-pill">
                  <Database size={12} strokeWidth={1.8} />
                  {selectedMonth}
                </span>
              ) : globalMonth.kind === "pending" ? (
                <span className="rh-pbi-month-empty">لم تتم معالجة مجتمع الشهر المحدد بعد</span>
              ) : (
                <span className="rh-pbi-month-empty">اختر شهراً من الشريط العلوي</span>
              )}
              <button
                className="rh-btn rh-btn-indigo"
                onClick={() => void handlePbiExport()}
                disabled={!selectedMonth || pbiExporting || !directoryHandle || !canExportReports}
                title={exportDisabledTitle()}
                type="button"
              >
                {pbiExporting ? <span className="rh-spinner" /> : null}
                {pbiExporting ? "جاري…" : "تصدير"}
              </button>
            </div>
          </div>
        </div>
          </div>

          {/* ── Quick actions ───────────────────────────── */}
          <div className="rh-quick">
            <span className="rh-quick-label">إجراءات سريعة</span>
            <div className="rh-quick-actions">
              <button
                className="rh-quick-btn"
                disabled={busy || !selectedMonth || !canExportReports}
                title={exportDisabledTitle()}
                onClick={() => { void generate("executive"); }}
              >
                <BarChart2 size={16} style={{ verticalAlign: "middle", marginInlineEnd: 5 }} /> التقرير التنفيذي
              </button>
              <button
                className="rh-quick-btn"
                disabled={busy || !selectedMonth || !canExportReports}
                title={exportDisabledTitle()}
                onClick={() => { void generate("sample"); }}
              >
                <FileStack size={16} style={{ verticalAlign: "middle" }} /> تقرير العينة
              </button>
              <button
                className="rh-quick-btn"
                disabled={busy || !selectedMonth || !canExportReports}
                title={exportDisabledTitle()}
                onClick={() => { void generate("distribution"); }}
              >
                <Users size={16} style={{ verticalAlign: "middle", marginInlineEnd: 5 }} /> تقرير التوزيع
              </button>
            </div>
          </div>

          {/* ── Power BI export result (shown below grid after export) ── */}
          {pbiResult && (() => {
            const relPath = `5-system\\powerbi-export\\${pbiResult.month}`;
            const fullHint = directoryHandle
              ? `${directoryHandle.name}\\${relPath}`
              : relPath;
            return (
              <div className="rh-pbi-result">
                <p className="rh-pbi-success" style={{ display: "flex", alignItems: "center", gap: 6 }}><Check size={15} style={{ flexShrink: 0 }} /> تم التصدير بنجاح</p>
                <div className="rh-pbi-path-box">
                  <span className="rh-pbi-path-label">المسار داخل مجلد العمل:</span>
                  <div className="rh-pbi-path-row">
                    <code className="rh-pbi-path-code">{fullHint}</code>
                    <button
                      type="button"
                      className="rh-pbi-copy-btn"
                      title="نسخ المسار"
                      onClick={() => {
                        navigator.clipboard.writeText(fullHint).catch(logRejection("reports:copyPbiPath"));
                      }}
                    >
                      نسخ
                    </button>
                  </div>
                  <span className="rh-pbi-path-hint">
                    افتح مجلد العمل على جهازك، ثم انتقل إلى المسار أعلاه.
                  </span>
                </div>
                <ul className="rh-pbi-file-list">
                  {pbiResult.files.map((f) => (
                    <li key={f.fileName}>
                      {/* App standard is Latin (Western) digits — "ar-SA-u-nu-latn" — not
                          the Arabic-Indic digits plain "ar" yields (mirrors fmtCount above). */}
                      <code>{f.fileName}</code> — {f.rowCount.toLocaleString("ar-SA-u-nu-latn")} سطر
                    </li>
                  ))}
                  <li><code>README.txt</code> — تعليمات الاتصال</li>
                </ul>
              </div>
            );
          })()}
          {pbiError && <p className="rh-pbi-error">{pbiError}</p>}
        </>
      )}
    </section>
    {customizerOpen && customizerInput && directoryHandle ? (
      <DeckDesignCustomizer
        execInput={customizerInput.execInput}
        employeeDisplayNames={customizerInput.names}
        directoryHandle={directoryHandle}
        canMutate={canMutate}
        onClose={() => setCustomizerOpen(false)}
      />
    ) : null}
    </>
  );
}

// Wrapper that handles sub-tab routing for "مصمم التقارير" sub-tab.
export default function ReportsTab() {
  const [activeSubTab, setActiveSubTab] = useState("reports");
  // Once Report Designer has been opened, keep it mounted (hidden, not
  // unmounted) so switching back to it doesn't lose in-progress canvas
  // edits and doesn't re-trigger ReportsContent's own reload on the way
  // back — §T. ReportsContent itself is the initial/default view, so it's
  // always mounted from the start; only Report Designer needs a visited gate.
  // Derived from activeSubTab, but needs to "stick" across later renders once
  // true, so it can't be plain derivation — computed here (render body, not
  // an effect) per React's "adjusting state during render" pattern, guarded
  // so it only ever setState once (avoids react-hooks/set-state-in-effect
  // and the extra effect-driven render pass a useEffect version would add).
  const [visitedReportDesigner, setVisitedReportDesigner] = useState(activeSubTab === "report-designer");
  if (activeSubTab === "report-designer" && !visitedReportDesigner) {
    setVisitedReportDesigner(true);
  }
  const handleSubTabEvent = useCallback((e: Event) => {
    const { parentTabId, subTabId } = (e as CustomEvent<{ parentTabId: string; subTabId: string }>).detail;
    if (parentTabId === "reports") setActiveSubTab(subTabId);
  }, []);
  useEffect(() => {
    window.addEventListener("sidebar-subtab-changed", handleSubTabEvent);
    return () => window.removeEventListener("sidebar-subtab-changed", handleSubTabEvent);
  }, [handleSubTabEvent]);
  // Stable element reference (created once, never recomputed) so switching
  // `activeSubTab` back and forth — which re-renders ReportsTab — doesn't
  // also re-invoke ReportDesignerTab's own render on every unrelated
  // re-render; React bails out of re-rendering a child subtree when the
  // exact same element reference is passed again.
  const reportDesignerElement = useMemo(
    () => (
      <TabGuard tabId="reports/report-designer">
        <ReportDesignerTab />
      </TabGuard>
    ),
    []
  );

  return (
    <>
      <div hidden={activeSubTab === "report-designer"}>
        <ReportsContent />
      </div>
      {visitedReportDesigner && (
        <div hidden={activeSubTab !== "report-designer"}>{reportDesignerElement}</div>
      )}
    </>
  );
}
