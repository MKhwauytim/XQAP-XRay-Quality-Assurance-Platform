/* eslint-disable react-refresh/only-export-components */
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { AlertTriangle, BarChart2, BarChart3, Building2, Check, ClipboardList, Database, Download, FileStack, FileText, Filter, FolderKanban, Globe, History, Printer, Settings2, User, Users, X } from "lucide-react";

import type { SidebarTabModule } from "../tabTypes";
import { loadOrDeriveDistributionCurrent } from "../../../../data/distribution/distributionStorage";
import { listMonthFolders, loadMonthPopulationFinal, loadMonthForEditing } from "../../../../data/population/populationStorage";
import type { PreparedPopulationRow } from "../../../../data/population/populationTypes";
import { buildDistributionReport, buildDistributionXlsx } from "../../../../data/reporting/distributionReport";
import { openOrDownload } from "../../../../data/reporting/htmlReport";
import { buildSampleXlsx, openSampleReport } from "../../../../data/reporting/sampleReport";
import { openExecutiveReport, buildExecutiveXlsx } from "../../../../data/reporting/executiveReport";
import { DEFAULT_EXEC_CONFIG } from "../../../../data/reporting/executiveReportTypes";
import { loadSampleMaster } from "../../../../data/sampling/sampleStorage";
import { loadAllEmployeeFiles } from "../../../../data/answers/answerStorage";
import { loadPopulationConfig } from "../../../../data/population/populationConfig";
import { getStageKey } from "../../../../data/population/stageHelpers";
import { loadTemplate } from "../../../../data/templates/templateStorage";
import { loadInspectionTemplateSelection } from "../../../../data/templates/templateSelectionStorage";
import { useWorkspace } from "../../../../data/workspace/useWorkspace";
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
  allowedRoles: ["guest", "supervisor", "manager", "admin"],
  icon: <BarChart3 size={20} strokeWidth={1.8} aria-hidden />,
  subTabs: [
    { id: "reports", label: "التقارير" },
    { id: "kpi", label: "مؤشرات الأداء" },
  ],
};

type ReportType = "sample" | "sample-xlsx" | "sample-print" | "distribution" | "distribution-xlsx" | "distribution-print" | "executive" | "executive-xlsx" | "executive-print";
type ReportBaseType = "sample" | "distribution" | "executive";
type ReportFormat = "html" | "xlsx" | "print";
type ReportsSection = "reports" | "kpi";

const KNOWN_REPORT_SECTIONS = new Set<ReportsSection>(["reports", "kpi"]);

type MonthMeta = {
  folderName: string;
  populationCount: number | null;
  sampleCount: number | null;
  studiedCount: number | null;
};

type ReportKpi = {
  totalAssigned: number;
  totalCompleted: number;
  totalTarget: number;
  completionPct: number;
  remaining: number;
  status: "complete" | "over" | "short";
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

const STAGE_SAMPLE_TARGETS: Record<"first" | "second" | "third" | "fourth", number | null> = {
  first: null,
  second: 2500,
  third: 1875,
  fourth: 1875,
};

const STAGE_LABELS_AR: Record<"first" | "second" | "third" | "fourth", string> = {
  first: "المستوى الأول",
  second: "المستوى الثاني",
  third: "المستوى الثالث",
  fourth: "المستوى الرابع",
};

export default function ReportsTab() {
  const { directoryHandle } = useWorkspace();

  const [months, setMonths] = useState<Array<{ folderName: string }>>([]);
  const [selectedMonth, setSelectedMonth] = useState("");
  const [monthMeta, setMonthMeta] = useState<MonthMeta | null>(null);
  const [monthKpi, setMonthKpi] = useState<ReportKpi | null>(null);
  const [section, setSection] = useState<ReportsSection>("reports");
  const [generating, setGenerating] = useState<ReportType | null>(null);
  const [formats, setFormats] = useState<Record<ReportBaseType, ReportFormat>>({
    executive: "html",
    sample: "html",
    distribution: "html",
  });
  const [toast, setToast] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (!directoryHandle) return;
    void listMonthFolders(directoryHandle).then((list) => {
      setMonths(list);
      if (list.length > 0) setSelectedMonth(list[list.length - 1]!.folderName);
    });
  }, [directoryHandle]);

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

  // Load lightweight meta for the month bar chips
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync null-clear when workspace or month is deselected; synchronizes with external workspace state
    if (!directoryHandle || !selectedMonth) { setMonthMeta(null); setMonthKpi(null); return; }
    setMonthMeta(null);
    setMonthKpi(null);
    void (async () => {
      try {
        const [pop, sample, config] = await Promise.all([
          loadMonthPopulationFinal(directoryHandle, selectedMonth),
          loadSampleMaster(directoryHandle, selectedMonth),
          loadPopulationConfig(directoryHandle),
        ]);
        const popRows = pop ? (pop.rows as unknown as PreparedPopulationRow[]) : [];
        const employeeFiles = sample ? await loadAllEmployeeFiles(directoryHandle, selectedMonth) : [];
        const submittedIds = new Set(
          employeeFiles.flatMap((file) =>
            file.items
              .filter((item) => item.status === "submitted")
              .map((item) => item.xrayImageId)
          )
        );
        const answered = submittedIds.size;
        setMonthMeta({
          folderName: selectedMonth,
          populationCount: popRows.length,
          sampleCount: sample ? sample.rows.length : null,
          studiedCount: answered > 0 ? answered : null,
        });
        if (sample) {
          const distribution = await loadOrDeriveDistributionCurrent(directoryHandle, selectedMonth, sample.rows);
          const entries = distribution?.entries ?? [];
          const totalAssigned = sample.rows.length;
          const totalCompleted = answered;
          const stageRows = (["first", "second", "third", "fourth"] as const).map((stageKey) => {
            const assigned = sample.rows.filter(
              (row) => getStageKey(String(row.stage ?? ""), config.stageMappings) === stageKey
            ).length;
            const completed = entries.filter(
              (entry) =>
                submittedIds.has(entry.xrayImageId) &&
                getStageKey(String(entry.row.stage ?? ""), config.stageMappings) === stageKey
            ).length;
            const population = popRows.filter(
              (row) => getStageKey(String(row.stage ?? ""), config.stageMappings) === stageKey
            ).length;

            return {
              stageKey,
              label: STAGE_LABELS_AR[stageKey],
              assigned,
              completed,
              target: stageKey === "first" ? population : STAGE_SAMPLE_TARGETS[stageKey],
              population,
              remaining: Math.max(0, assigned - completed),
              completionPct: assigned > 0 ? (completed / assigned) * 100 : null,
            };
          });

          setMonthKpi({
            totalAssigned,
            totalCompleted,
            totalTarget: DEFAULT_EXEC_CONFIG.monthlyTarget,
            completionPct: totalAssigned > 0 ? (totalCompleted / totalAssigned) * 100 : 0,
            remaining: Math.max(0, totalAssigned - totalCompleted),
            status: totalAssigned > 0 && totalCompleted === totalAssigned ? "complete" : totalCompleted > totalAssigned ? "over" : "short",
            stageRows,
          });
        }
      } catch {
        setMonthMeta({ folderName: selectedMonth, populationCount: null, sampleCount: null, studiedCount: null });
        setMonthKpi(null);
      }
    })();
  }, [directoryHandle, selectedMonth]);

  function showToast(type: "ok" | "error", text: string) {
    setToast({ type, text });
    setTimeout(() => setToast(null), 5000);
  }

  async function generate(type: ReportType): Promise<void> {
    if (!directoryHandle || !selectedMonth || generating) return;
    setGenerating(type);
    try {
      if (type === "sample" || type === "sample-xlsx" || type === "sample-print") {
        const { populationRows, sampleData, manifest } = await loadMonthForEditing(directoryHandle, selectedMonth);
        if (!sampleData) { showToast("error", "لم يتم العثور على بيانات عينة لهذا الشهر."); return; }
        const sampleInput = {
          monthFolderName: selectedMonth,
          manifest,
          populationRows: (populationRows ?? []) as unknown as PreparedPopulationRow[],
          sample: sampleData,
        };
        if (type === "sample-xlsx") {
          buildSampleXlsx(sampleInput);
          showToast("ok", "تم تنزيل ملف Excel.");
        } else {
          openSampleReport(sampleInput);
          showToast("ok", type === "sample-print" ? "تم فتح تقرير العينة للتصدير PDF." : "تم فتح تقرير العينة.");
        }
      } else if (type === "distribution" || type === "distribution-xlsx" || type === "distribution-print") {
        const sample = await loadSampleMaster(directoryHandle, selectedMonth);
        const data = sample ? await loadOrDeriveDistributionCurrent(directoryHandle, selectedMonth, sample.rows) : null;
        if (!data) { showToast("error", "لم يتم العثور على بيانات توزيع لهذا الشهر."); return; }
        if (type === "distribution-xlsx") {
          buildDistributionXlsx(data, selectedMonth);
          showToast("ok", "تم تنزيل ملف Excel.");
        } else {
          openOrDownload(buildDistributionReport(data, selectedMonth), `تقرير_التوزيع_${selectedMonth}.html`);
          showToast("ok", type === "distribution-print" ? "تم فتح تقرير التوزيع للتصدير PDF." : "تم فتح تقرير التوزيع.");
        }
      } else if (type === "executive" || type === "executive-xlsx" || type === "executive-print") {
        const [populationFinal, sample, employeeFiles, templateSelection] = await Promise.all([
          loadMonthPopulationFinal(directoryHandle, selectedMonth),
          loadSampleMaster(directoryHandle, selectedMonth),
          loadAllEmployeeFiles(directoryHandle, selectedMonth),
          loadInspectionTemplateSelection(directoryHandle),
        ]);
        if (!populationFinal) { showToast("error", "لم يتم العثور على بيانات المجتمع. يجب معالجة المجتمع أولاً."); return; }
        const template = templateSelection?.templateId
          ? await loadTemplate(directoryHandle, templateSelection.templateId)
          : null;
        const distribution = sample
          ? await loadOrDeriveDistributionCurrent(directoryHandle, selectedMonth, sample.rows)
          : null;
        const execInput = {
          monthFolderName: selectedMonth,
          populationRows: populationFinal.rows as unknown as PreparedPopulationRow[],
          sample: sample ?? null,
          distribution: distribution ?? null,
          employeeFiles,
          template,
          config: DEFAULT_EXEC_CONFIG,
        };
        if (type === "executive-xlsx") {
          buildExecutiveXlsx(execInput);
          showToast("ok", "تم تنزيل ملف Excel.");
        } else {
          openExecutiveReport(execInput);
          showToast("ok", type === "executive-print" ? "تم فتح التقرير التنفيذي للتصدير PDF." : "تم فتح التقرير التنفيذي.");
        }
      }
    } catch {
      showToast("error", "حدث خطأ أثناء توليد التقرير.");
    } finally {
      setGenerating(null);
    }
  }

  function selectedReportType(baseType: ReportBaseType): ReportType {
    const format = formats[baseType];
    if (format === "print") return `${baseType}-print` as ReportType;
    if (format === "xlsx") return `${baseType}-xlsx` as ReportType;
    return baseType;
  }

  function renderExportControls(baseType: ReportBaseType, toneClass: string): ReactNode {
    const selectedType = selectedReportType(baseType);
    const isBusy = generating === selectedType;
    const availableFormats: ReportFormat[] = ["html", "xlsx", "print"];
    return (
      <div className="rh-export-controls" role="group" aria-label="صيغة التصدير">
        <button
          type="button"
          className={`rh-btn ${toneClass}`}
          disabled={busy || !selectedMonth}
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
              title={format === "html" ? "HTML" : format === "xlsx" ? "Excel" : "PDF من HTML"}
              aria-label={format === "html" ? "HTML" : format === "xlsx" ? "Excel" : "PDF من HTML"}
              onClick={() => setFormats((prev) => ({ ...prev, [baseType]: format }))}
            >
              {format === "html" ? <PresentationFormatIcon /> : format === "xlsx" ? <ExcelFormatIcon /> : <FileText size={17} strokeWidth={2.2} />}
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
          <span className="rh-empty-icon">🗂</span>
          <strong>لم يتم تحديد مساحة عمل</strong>
          <span>اختر مجلد العمل من الشريط الجانبي للمتابعة.</span>
        </div>
      </section>
    );
  }

  const fmtNum = (n: number | null | undefined) =>
    n != null ? n.toLocaleString("ar-SA") : "—";

  const busy = generating !== null;

  return (
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
          <div className="rh-eyebrow">Reports</div>
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
        <select
          className="rh-month-select"
          value={selectedMonth}
          onChange={(e) => setSelectedMonth(e.target.value)}
        >
          {months.length === 0 ? (
            <option value="">لا توجد أشهر</option>
          ) : (
            months.map((m) => (
              <option key={m.folderName} value={m.folderName}>
                {m.folderName}
              </option>
            ))
          )}
        </select>
        <div className="rh-month-sep" />
        <div className="rh-month-chips">
          <span className="rh-chip rh-chip-pop">
            <Database size={12} />
            {monthMeta ? `${fmtNum(monthMeta.populationCount)} صورة` : "—"}
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

      {section === "kpi" && monthKpi && (
        <section className="rh-kpi-panel" aria-label="مؤشرات الشهر">
          <div className={`rh-kpi-hero ${monthKpi.status}`}>
            <div className="rh-kpi-hero-main">
              <span className="rh-kpi-label">مؤشر الشهر الرئيسي</span>
              <h2>العينة المدروسة لشهر {selectedMonth}</h2>
              <p>
                {monthKpi.status === "complete"
                  ? "تمت دراسة كامل العينة المحالة لهذا الشهر."
                  : `متبقي ${fmtNum(monthKpi.remaining)} من أصل ${fmtNum(monthKpi.totalAssigned)} صورة محالة.`}
              </p>
            </div>
            <div className="rh-kpi-meter-wrap">
              <div
                className="rh-kpi-meter"
                style={{ "--rh-kpi-progress": `${Math.min(100, monthKpi.completionPct)}%` } as CSSProperties}
              >
                <strong>{Math.min(100, monthKpi.completionPct).toFixed(1)}%</strong>
                <span>مدروس</span>
              </div>
            </div>
          </div>

          <div className="rh-kpi-grid">
            <div className="rh-stat-card">
              <span className="rh-stat-label">الهدف الشهري</span>
              <strong className="rh-stat-value">{fmtNum(monthKpi.totalTarget)}</strong>
            </div>
            <div className="rh-stat-card">
              <span>المحالة للفحص</span>
              <strong className="rh-stat-value">{fmtNum(monthKpi.totalAssigned)}</strong>
            </div>
            <div className="rh-stat-card">
              <span>المدروسة</span>
              <strong className="rh-stat-value">{fmtNum(monthKpi.totalCompleted)}</strong>
            </div>
            <div className="rh-stat-card">
              <span>المتبقية</span>
              <strong className="rh-stat-value">{fmtNum(monthKpi.remaining)}</strong>
            </div>
            <div className="rh-stat-card">
              <span>الحالة</span>
              <strong className="rh-stat-value">
                {monthKpi.status === "complete"
                  ? "مكتمل"
                  : monthKpi.status === "over"
                    ? "أعلى من الهدف"
                    : "قيد الاستكمال"}
              </strong>
            </div>
          </div>

          <div className="rh-stage-grid">
            {monthKpi.stageRows.map((stage) => (
              <article className="rh-stage-card" key={stage.stageKey}>
                <div className="rh-stage-head">
                  <span className="rh-stage-label">{stage.label}</span>
                  <span className="rh-stage-target">
                    الهدف {stage.target == null ? "كامل المجتمع" : fmtNum(stage.target)}
                  </span>
                </div>
                <div className="rh-stage-donut-row">
                  <div
                    className="rh-stage-donut"
                    style={{ "--rh-stage-progress": `${Math.min(100, stage.completionPct ?? 0)}%` } as CSSProperties}
                  >
                    <strong>{Math.min(100, stage.completionPct ?? 0).toFixed(1)}%</strong>
                  </div>
                  <dl className="rh-stage-metrics">
                    <div>
                      <dt>المحالة للفحص</dt>
                      <dd>{fmtNum(stage.assigned)}</dd>
                    </div>
                    <div>
                      <dt>المدروسة</dt>
                      <dd>{fmtNum(stage.completed)}</dd>
                    </div>
                    <div>
                      <dt>المتبقي</dt>
                      <dd>{fmtNum(stage.remaining)}</dd>
                    </div>
                    <div>
                      <dt>مجتمع الشهر</dt>
                      <dd>{fmtNum(stage.population)}</dd>
                    </div>
                  </dl>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {section === "kpi" && !monthKpi && (
        <div className="rh-empty rh-kpi-empty">
          <strong>لا توجد مؤشرات لهذا الشهر</strong>
          <span>اختر شهراً يحتوي على عينة وإجابات مدروسة لعرض مؤشرات الأداء.</span>
        </div>
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
              <span className="rh-badge rh-badge-main">الرئيسي</span>
            </div>
            <div className="rh-card-title">التقرير التنفيذي</div>
            <p className="rh-card-desc">
              عرض تقديمي من 8 شرائح يغطي الأداء الكلي، تحليل المنافذ، مصفوفة التحقق،
              مقارنة المستويين، والقرارات التنفيذية. مُصمَّم للمشاركة مع الإدارة.
            </p>
            <div className="rh-tags">
              <span className="rh-tag"><FolderKanban size={12} style={{ verticalAlign: "middle", marginInlineEnd: 3 }} /> 5 شرائح</span>
              <span className="rh-tag"><Globe size={12} style={{ verticalAlign: "middle", marginInlineEnd: 3 }} /> كل المنافذ</span>
              <span className="rh-tag"><Printer size={12} style={{ verticalAlign: "middle", marginInlineEnd: 3 }} /> PDF</span>
              <span className="rh-tag"><Download size={12} style={{ verticalAlign: "middle", marginInlineEnd: 3 }} /> XLSX</span>
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

        {/* Department — coming soon */}
        <div className="rh-card rh-card-disabled">
          <div className="rh-card-accent rh-acc-purple" />
          <div className="rh-card-body">
            <div className="rh-card-top">
              <div className="rh-icon rh-icon-purple"><Building2 size={22} /></div>
              <span className="rh-badge rh-badge-soon">قريباً</span>
            </div>
            <div className="rh-card-title">تقرير الإدارة</div>
            <p className="rh-card-desc">
              نظرة شاملة قابلة للتخصيص حسب الموظف — الإنجاز الفردي، الدقة، الاشتباه الفائت، والمقارنة بين الموظفين.
            </p>
            <div className="rh-tags">
              <span className="rh-tag"><Settings2 size={12} style={{ verticalAlign: "middle", marginInlineEnd: 3 }} /> قابل للتخصيص</span>
              <span className="rh-tag"><User size={12} style={{ verticalAlign: "middle", marginInlineEnd: 3 }} /> فردي / كلي</span>
            </div>
          </div>
          <div className="rh-card-footer">
            <span className="rh-req">
              <i className="rh-dot rh-dot-amber" />
              قيد التطوير
            </span>
            <button className="rh-btn rh-btn-ghost" disabled>قريباً</button>
          </div>
        </div>

        {/* XLSX exports note */}
        <div className="rh-card rh-card-disabled rh-card-dashed">
          <div className="rh-card-accent" style={{ background: "#e8eff8" }} />
          <div className="rh-card-body">
            <div className="rh-card-top">
              <div className="rh-icon rh-icon-muted"><Download size={22} /></div>
              <span className="rh-badge rh-badge-muted">تصديرات</span>
            </div>
            <div className="rh-card-title" style={{ color: "#8390a2" }}>تصدير Excel / CSV</div>
            <p className="rh-card-desc">
              تصدير بيانات المجتمع، العينة، والإجابات مباشرةً إلى ملفات XLSX — متاح من داخل الجداول التفاعلية في كل تبويب.
            </p>
          </div>
          <div className="rh-card-footer">
            <span className="rh-req">
              <i className="rh-dot" style={{ background: "#d8e3ef" }} />
              متاح داخل الجداول
            </span>
            <button className="rh-btn rh-btn-ghost" disabled>من داخل الجداول</button>
          </div>
        </div>
          </div>

          {/* ── Quick actions ───────────────────────────── */}
          <div className="rh-quick">
            <span className="rh-quick-label">إجراءات سريعة</span>
            <div className="rh-quick-actions">
              <button
                className="rh-quick-btn"
                disabled={busy || !selectedMonth}
                onClick={() => { void generate("executive"); }}
              >
                <BarChart2 size={16} style={{ verticalAlign: "middle", marginInlineEnd: 5 }} /> التقرير التنفيذي
              </button>
              <button
                className="rh-quick-btn"
                disabled={busy || !selectedMonth}
                onClick={() => { void generate("sample"); }}
              >
                <FileStack size={16} style={{ verticalAlign: "middle" }} /> تقرير العينة
              </button>
              <button
                className="rh-quick-btn"
                disabled={busy || !selectedMonth}
                onClick={() => { void generate("distribution"); }}
              >
                <Users size={16} style={{ verticalAlign: "middle", marginInlineEnd: 5 }} /> تقرير التوزيع
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
