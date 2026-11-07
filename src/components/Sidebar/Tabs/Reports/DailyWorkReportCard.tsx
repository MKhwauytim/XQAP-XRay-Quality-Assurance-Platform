import { useState } from "react";
import { Mail } from "lucide-react";
import type { DirectoryHandleLike } from "../../../../data/storage/fileSystemAccess";
import { logError } from "../../../../data/storage/errorLogger";
import { getManagedLoginUsers } from "../../../../auth/userManagement";
import { loadDailyWorkSource } from "../../../../data/reporting/dailyWork/dailyWorkSource";
import { buildDailyWorkReport, previousWorkingDay } from "../../../../data/reporting/dailyWork/dailyWorkReport";
import { buildDailyWorkEml, buildDailyWorkEmailHtml, formatReportDay } from "../../../../data/reporting/dailyWork/dailyWorkEmail";

function toInputValue(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fromInputValue(v: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

type Props = {
  directoryHandle: DirectoryHandleLike | null;
  disabled: boolean;
  disabledTitle?: string;
};

/**
 * «تقرير العمل اليومي»: one click builds an email draft (.eml, opens in Outlook
 * ready to send) covering every distributed month, and also copies the same
 * formatted body to the clipboard for pasting into any other mail client.
 */
export default function DailyWorkReportCard({ directoryHandle, disabled, disabledTitle }: Props) {
  const [day, setDay] = useState(() => toInputValue(previousWorkingDay(new Date())));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function generate(): Promise<void> {
    const reportDay = fromInputValue(day);
    if (!directoryHandle || !reportDay) return;
    setBusy(true);
    setStatus(null);
    try {
      const source = await loadDailyWorkSource(directoryHandle);
      const names: Record<string, string> = {};
      for (const u of getManagedLoginUsers()) names[u.username] = u.displayName || u.username;
      const report = buildDailyWorkReport({ months: source.months, day: reportDay, names });

      const eml = buildDailyWorkEml(report);
      const url = URL.createObjectURL(new Blob([eml], { type: "message/rfc822" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `تقرير العمل اليومي ${formatReportDay(reportDay).date.replace(/\//g, "-")}.eml`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);

      let copied = false;
      try {
        const html = buildDailyWorkEmailHtml(report);
        await navigator.clipboard.write([
          new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }) }),
        ]);
        copied = true;
      } catch {
        // Clipboard can be refused (no focus / permission); the .eml still works.
      }
      const parts = [`تم تجهيز الإيميل لـ ${report.months.length} شهر — افتح الملف الذي تم تنزيله ليفتح في Outlook جاهزًا للإرسال.`];
      if (copied) parts.push("ونُسخ نص التقرير أيضًا للصقه في أي بريد.");
      if (source.failedMonths.length) parts.push(`تعذرت قراءة: ${source.failedMonths.join("، ")}.`);
      setStatus(parts.join(" "));
    } catch (err) {
      logError("DailyWorkReportCard.generate", err);
      setStatus("تعذر إنشاء التقرير اليومي.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rh-card" data-testid="rh-daily-work-card">
      <div className="rh-card-accent rh-acc-teal" />
      <div className="rh-card-body">
        <div className="rh-card-top">
          <div className="rh-icon rh-icon-teal"><Mail size={22} /></div>
        </div>
        <div className="rh-card-title">تقرير العمل اليومي (إيميل)</div>
        <p className="rh-card-desc">
          إيميل جاهز للإرسال يغطي جميع الأشهر الموزعة: لكل شهر جدول بالموظفين وعدد ما فحصه وأرشفه كل منهم
          خلال اليوم المحدد، والمتبقي من حصته. اليوم الافتراضي هو آخر يوم عمل.
        </p>
        <div className="rh-scope-toggle">
          <label htmlFor="rh-daily-day">يوم التقرير</label>
          <input id="rh-daily-day" type="date" value={day} onChange={(ev) => setDay(ev.target.value)} />
        </div>
        {status ? <p className="rh-card-desc" role="status">{status}</p> : null}
      </div>
      <div className="rh-card-footer">
        <button
          type="button"
          className="rh-btn rh-btn-teal"
          disabled={disabled || busy || !directoryHandle || !fromInputValue(day)}
          title={disabledTitle}
          onClick={() => { void generate(); }}
        >
          {busy ? <span className="rh-spinner" /> : null}
          {busy ? "جاري…" : "إنشاء الإيميل"}
        </button>
      </div>
    </div>
  );
}
