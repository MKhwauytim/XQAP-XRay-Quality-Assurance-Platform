/* eslint-disable react-refresh/only-export-components */
import { useEffect, useState, type ReactNode } from "react";

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
import { useWorkspace } from "../../../../data/workspace/useWorkspace";
import "./Reports.css";

function ReportsIcon(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" className="sidebar-icon" aria-hidden="true">
      <path d="M9 17H7v-7h2v7Zm4 0h-2V7h2v10Zm4 0h-2v-4h2v4ZM5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
    </svg>
  );
}

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
  icon: <ReportsIcon />,
};

type ReportType = "sample" | "sample-xlsx" | "distribution" | "distribution-xlsx" | "executive" | "executive-xlsx";
type ReportBaseType = "sample" | "distribution" | "executive";
type ReportFormat = "html" | "xlsx";

type MonthMeta = {
  folderName: string;
  populationCount: number | null;
  sampleCount: number | null;
  studiedCount: number | null;
};

export default function ReportsTab() {
  const { directoryHandle } = useWorkspace();

  const [months, setMonths] = useState<Array<{ folderName: string }>>([]);
  const [selectedMonth, setSelectedMonth] = useState("");
  const [monthMeta, setMonthMeta] = useState<MonthMeta | null>(null);
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

  // Load lightweight meta for the month bar chips
  useEffect(() => {
    if (!directoryHandle || !selectedMonth) { setMonthMeta(null); return; }
    setMonthMeta(null);
    void (async () => {
      try {
        const [pop, sample] = await Promise.all([
          loadMonthPopulationFinal(directoryHandle, selectedMonth),
          loadSampleMaster(directoryHandle, selectedMonth),
        ]);
        const popRows = pop ? (pop.rows as unknown as PreparedPopulationRow[]) : [];
        const answered = sample
          ? await loadAllEmployeeFiles(directoryHandle, selectedMonth).then((files) =>
              files.reduce((n, f) => n + f.items.filter((a) => a.status === "submitted").length, 0)
            )
          : 0;
        setMonthMeta({
          folderName: selectedMonth,
          populationCount: popRows.length,
          sampleCount: sample ? sample.rows.length : null,
          studiedCount: answered > 0 ? answered : null,
        });
      } catch {
        setMonthMeta({ folderName: selectedMonth, populationCount: null, sampleCount: null, studiedCount: null });
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
      if (type === "sample" || type === "sample-xlsx") {
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
          showToast("ok", "تم فتح تقرير العينة.");
        }
      } else if (type === "distribution" || type === "distribution-xlsx") {
        const sample = await loadSampleMaster(directoryHandle, selectedMonth);
        const data = sample ? await loadOrDeriveDistributionCurrent(directoryHandle, selectedMonth, sample.rows) : null;
        if (!data) { showToast("error", "لم يتم العثور على بيانات توزيع لهذا الشهر."); return; }
        if (type === "distribution-xlsx") {
          buildDistributionXlsx(data, selectedMonth);
          showToast("ok", "تم تنزيل ملف Excel.");
        } else {
          openOrDownload(buildDistributionReport(data, selectedMonth), `تقرير_التوزيع_${selectedMonth}.html`);
          showToast("ok", "تم فتح تقرير التوزيع.");
        }
      } else if (type === "executive" || type === "executive-xlsx") {
        const [populationFinal, sample, employeeFiles] = await Promise.all([
          loadMonthPopulationFinal(directoryHandle, selectedMonth),
          loadSampleMaster(directoryHandle, selectedMonth),
          loadAllEmployeeFiles(directoryHandle, selectedMonth),
        ]);
        if (!populationFinal) { showToast("error", "لم يتم العثور على بيانات المجتمع. يجب معالجة المجتمع أولاً."); return; }
        const distribution = sample
          ? await loadOrDeriveDistributionCurrent(directoryHandle, selectedMonth, sample.rows)
          : null;
        const execInput = {
          monthFolderName: selectedMonth,
          populationRows: populationFinal.rows as unknown as PreparedPopulationRow[],
          sample: sample ?? null,
          distribution: distribution ?? null,
          employeeFiles,
          config: DEFAULT_EXEC_CONFIG,
        };
        if (type === "executive-xlsx") {
          buildExecutiveXlsx(execInput);
          showToast("ok", "تم تنزيل ملف Excel.");
        } else {
          openExecutiveReport(execInput);
          showToast("ok", "تم فتح التقرير التنفيذي.");
        }
      }
    } catch {
      showToast("error", "حدث خطأ أثناء توليد التقرير.");
    } finally {
      setGenerating(null);
    }
  }

  function selectedReportType(baseType: ReportBaseType): ReportType {
    return formats[baseType] === "xlsx" ? `${baseType}-xlsx` as ReportType : baseType;
  }

  function renderExportControls(baseType: ReportBaseType, toneClass: string): ReactNode {
    const selectedType = selectedReportType(baseType);
    const isBusy = generating === selectedType;
    return (
      <div className="rh-export-controls" role="group" aria-label="صيغة التصدير">
        <div className="rh-format-toggle">
          <button
            type="button"
            className={formats[baseType] === "html" ? "active" : ""}
            title="عرض تقديمي"
            aria-label="عرض تقديمي"
            onClick={() => setFormats((prev) => ({ ...prev, [baseType]: "html" }))}
          >
            <PresentationFormatIcon />
          </button>
          <button
            type="button"
            className={formats[baseType] === "xlsx" ? "active" : ""}
            title="Excel"
            aria-label="Excel"
            onClick={() => setFormats((prev) => ({ ...prev, [baseType]: "xlsx" }))}
          >
            <ExcelFormatIcon />
          </button>
        </div>
        <button
          className={`rh-btn ${toneClass}`}
          disabled={busy || !selectedMonth}
          onClick={() => { void generate(selectedType); }}
        >
          {isBusy ? <span className="rh-spinner" /> : null}
          {isBusy ? "جاري…" : "التصدير"}
        </button>
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

  const fmtNum = (n: number | null) =>
    n !== null ? n.toLocaleString("ar-SA") : "—";

  const busy = generating !== null;

  return (
    <section className="rh-page" dir="rtl">
      {/* ── Toast ───────────────────────────────────── */}
      {toast && (
        <div className={`rh-toast rh-toast-${toast.type}`} role="status">
          <span>{toast.type === "ok" ? "✓" : "⚠"}</span>
          {toast.text}
          <button className="rh-toast-close" onClick={() => setToast(null)}>×</button>
        </div>
      )}

      {/* ── Page header ─────────────────────────────── */}
      <div className="rh-header">
        <div className="rh-eyebrow">Reports</div>
        <h1 className="rh-title">مركز التقارير</h1>
        <p className="rh-sub">اختر التقرير المناسب وولّده مباشرةً — تقارير HTML تفاعلية جاهزة للمشاركة والطباعة.</p>
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
            <i>⊙</i>
            {monthMeta ? `${fmtNum(monthMeta.populationCount)} صورة` : "—"}
          </span>
          <span className="rh-chip rh-chip-samp">
            <i>◈</i>
            {monthMeta?.sampleCount != null ? `${fmtNum(monthMeta.sampleCount)} عينة` : "—"}
          </span>
          <span className="rh-chip rh-chip-ans">
            <i>✓</i>
            {monthMeta?.studiedCount != null ? `${fmtNum(monthMeta.studiedCount)} مدروسة` : "—"}
          </span>
        </div>
      </div>

      {/* ── Section label ───────────────────────────── */}
      <div className="rh-section-label">التقارير الرئيسية</div>

      {/* ── Cards grid ──────────────────────────────── */}
      <div className="rh-grid">

        {/* Executive — featured */}
        <div className="rh-card rh-card-featured">
          <div className="rh-card-accent rh-acc-teal" />
          <div className="rh-card-body">
            <div className="rh-card-top">
              <div className="rh-icon rh-icon-teal">📊</div>
              <span className="rh-badge rh-badge-main">الرئيسي</span>
            </div>
            <div className="rh-card-title">التقرير التنفيذي</div>
            <p className="rh-card-desc">
              عرض تقديمي من 8 شرائح يغطي الأداء الكلي، تحليل المنافذ، مصفوفة التحقق،
              مقارنة المستويين، والقرارات التنفيذية. مُصمَّم للمشاركة مع الإدارة.
            </p>
            <div className="rh-tags">
              <span className="rh-tag">🗂 5 شرائح</span>
              <span className="rh-tag">◈ كل المنافذ</span>
              <span className="rh-tag">🖨 PDF</span>
              <span className="rh-tag">📥 XLSX</span>
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
              <div className="rh-icon rh-icon-navy">◈</div>
              <span className="rh-badge rh-badge-ready">جاهز</span>
            </div>
            <div className="rh-card-title">تقرير العينة</div>
            <p className="rh-card-desc">
              تفصيل المنافذ والمراحل — بيانات Risk وBI، خام مقابل معالجة، CertScan/NonCertScan، والصفوف المسحوبة للدراسة.
            </p>
            <div className="rh-tags">
              <span className="rh-tag">⊙ Risk + BI</span>
              <span className="rh-tag">◎ كل المنافذ</span>
              <span className="rh-tag">📋 مراحل</span>
              <span className="rh-tag">📥 XLSX</span>
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
              <div className="rh-icon rh-icon-navy">👥</div>
              <span className="rh-badge rh-badge-ready">جاهز</span>
            </div>
            <div className="rh-card-title">تقرير التوزيع</div>
            <p className="rh-card-desc">
              حالة التوزيع لكل موظف مع تفاصيل كل صف — قيد الانتظار، مكتمل، مستبدل. يُستخدم لمتابعة سير العمل اليومي.
            </p>
            <div className="rh-tags">
              <span className="rh-tag">👤 حسب الموظف</span>
              <span className="rh-tag">⟳ أحداث اللوج</span>
              <span className="rh-tag">📥 XLSX</span>
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
              <div className="rh-icon rh-icon-purple">🏢</div>
              <span className="rh-badge rh-badge-soon">قريباً</span>
            </div>
            <div className="rh-card-title">تقرير الإدارة</div>
            <p className="rh-card-desc">
              نظرة شاملة قابلة للتخصيص حسب الموظف — الإنجاز الفردي، الدقة، الاشتباه الفائت، والمقارنة بين الموظفين.
            </p>
            <div className="rh-tags">
              <span className="rh-tag">⚙ قابل للتخصيص</span>
              <span className="rh-tag">👤 فردي / كلي</span>
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
              <div className="rh-icon rh-icon-muted">📥</div>
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
            <span>📊</span> التقرير التنفيذي
          </button>
          <button
            className="rh-quick-btn"
            disabled={busy || !selectedMonth}
            onClick={() => { void generate("sample"); }}
          >
            <span>◈</span> تقرير العينة
          </button>
          <button
            className="rh-quick-btn"
            disabled={busy || !selectedMonth}
            onClick={() => { void generate("distribution"); }}
          >
            <span>👥</span> تقرير التوزيع
          </button>
        </div>
      </div>
    </section>
  );
}
