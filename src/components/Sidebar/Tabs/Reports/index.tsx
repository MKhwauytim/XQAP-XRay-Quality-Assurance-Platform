/* eslint-disable react-refresh/only-export-components */
import { useEffect, useState, type ReactNode } from "react";

import type { SidebarTabModule } from "../tabTypes";
import {
  loadOrDeriveDistributionCurrent
} from "../../../../data/distribution/distributionStorage";
import { listMonthFolders } from "../../../../data/population/populationStorage";
import { buildDistributionReport } from "../../../../data/reporting/distributionReport";
import { openOrDownload } from "../../../../data/reporting/htmlReport";
import { buildSampleReport } from "../../../../data/reporting/sampleReport";
import { loadSampleMaster } from "../../../../data/sampling/sampleStorage";
import { useWorkspace } from "../../../../data/workspace/useWorkspace";
import "./Reports.css";
import { PageHeader } from "../../../../components/PageHeader/PageHeader";

function ReportsIcon(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" className="sidebar-icon" aria-hidden="true">
      <path d="M9 17H7v-7h2v7Zm4 0h-2V7h2v10Zm4 0h-2v-4h2v4ZM5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
    </svg>
  );
}

export const tabConfig: SidebarTabModule["tabConfig"] = {
  id: "reports",
  label: "التقارير",
  order: 25,
  allowedRoles: ["guest", "supervisor", "manager", "admin"],
  icon: <ReportsIcon />
};

type ReportType = "sample" | "distribution";

const REPORT_LABELS: Record<ReportType, string> = {
  sample: "تقرير العينة",
  distribution: "تقرير التوزيع"
};

export default function ReportsTab() {
  const { directoryHandle } = useWorkspace();

  const [months, setMonths] = useState<Array<{ folderName: string }>>([]);
  const [selectedMonth, setSelectedMonth] = useState("");
  const [reportType, setReportType] = useState<ReportType>("distribution");
  const [isGenerating, setIsGenerating] = useState(false);
  const [message, setMessage] = useState<{
    type: "ok" | "error";
    text: string;
  } | null>(null);

  useEffect(() => {
    if (!directoryHandle) return;
    void listMonthFolders(directoryHandle).then((list) => {
      setMonths(list);
      if (list.length > 0) {
        setSelectedMonth(list[list.length - 1]!.folderName);
      }
    });
  }, [directoryHandle]);

  async function handleGenerate(): Promise<void> {
    if (!directoryHandle || !selectedMonth) return;
    setIsGenerating(true);
    setMessage(null);
    try {
      if (reportType === "sample") {
        const data = await loadSampleMaster(directoryHandle, selectedMonth);
        if (!data) {
          setMessage({ type: "error", text: "لم يتم العثور على بيانات عينة لهذا الشهر." });
          return;
        }
        const html = buildSampleReport(data, selectedMonth);
        openOrDownload(html, `تقرير_العينة_${selectedMonth}.html`);
        setMessage({ type: "ok", text: "تم فتح التقرير." });
      } else if (reportType === "distribution") {
        const sample = await loadSampleMaster(directoryHandle, selectedMonth);
        const data = sample
          ? await loadOrDeriveDistributionCurrent(directoryHandle, selectedMonth, sample.rows)
          : null;
        if (!data) {
          setMessage({ type: "error", text: "لم يتم العثور على بيانات توزيع لهذا الشهر." });
          return;
        }
        const html = buildDistributionReport(data, selectedMonth);
        openOrDownload(html, `تقرير_التوزيع_${selectedMonth}.html`);
        setMessage({ type: "ok", text: "تم فتح التقرير." });
      }
    } catch {
      setMessage({ type: "error", text: "حدث خطأ أثناء توليد التقرير." });
    } finally {
      setIsGenerating(false);
    }
  }

  if (!directoryHandle) {
    return (
      <section className="rpt-page">
        <p className="rpt-empty">يجب تحديد مساحة عمل أولاً.</p>
      </section>
    );
  }

  return (
    <section className="rpt-page" dir="rtl">
      <PageHeader
        eyebrow="Reports"
        title="التقارير"
        subtitle="توليد تقارير HTML من بيانات العينة والتوزيع."
      />

      {message ? (
        <div
          className={message.type === "ok" ? "rpt-msg-ok" : "rpt-msg-error"}
          role="status"
        >
          {message.text}
        </div>
      ) : null}

      <div className="rpt-panel">
        <h2>إعدادات التقرير</h2>

        <div className="rpt-controls">
          <label className="rpt-label" htmlFor="rpt-month">
            الشهر
            <select
              id="rpt-month"
              className="rpt-select"
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
          </label>

          <label className="rpt-label" htmlFor="rpt-type">
            نوع التقرير
            <select
              id="rpt-type"
              className="rpt-select"
              value={reportType}
              onChange={(e) => setReportType(e.target.value as ReportType)}
            >
              {(Object.keys(REPORT_LABELS) as ReportType[]).map((t) => (
                <option key={t} value={t}>
                  {REPORT_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="rpt-action-row">
          <button
            type="button"
            className="rpt-btn-primary"
            disabled={isGenerating || !selectedMonth}
            onClick={() => { void handleGenerate(); }}
          >
            {isGenerating ? "جاري التوليد..." : "توليد التقرير"}
          </button>
        </div>

        <div className="rpt-info">
          <h3>وصف التقرير المختار</h3>
          {reportType === "sample" ? (
            <p>يعرض توزيع العينة على المنافذ مع تفاصيل CertScan/NonCertScan ومعاينة الصفوف المسحوبة.</p>
          ) : (
            <p>يعرض حالة التوزيع لكل موظف، مع تفاصيل كل صف (قيد الانتظار، مكتمل، مستبدل).</p>
          )}
        </div>
      </div>
    </section>
  );
}
