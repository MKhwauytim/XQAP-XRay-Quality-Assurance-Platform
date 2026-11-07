import { useState } from "react";
import { Mail } from "lucide-react";
import type { DirectoryHandleLike } from "../../../../data/storage/fileSystemAccess";
import { logError } from "../../../../data/storage/errorLogger";
import { getManagedLoginUsers } from "../../../../auth/userManagement";
import { loadDailyWorkSource } from "../../../../data/reporting/dailyWork/dailyWorkSource";
import { buildDailyWorkReport, monthOf, previousDay, previousMonth, previousWeek, weekOf } from "../../../../data/reporting/dailyWork/dailyWorkReport";
import type { DailyWorkKind } from "../../../../data/reporting/dailyWork/dailyWorkReport";
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
  const [kind, setKind] = useState<DailyWorkKind>("day");
  // Defaults: yesterday, the last full Sunday–Saturday week, the previous month. Weekends count,
  // because the team sometimes works on Friday and Saturday.
  const [day, setDay] = useState(() => toInputValue(previousDay(new Date())));
  const [weekDay, setWeekDay] = useState(() => toInputValue(previousWeek(new Date()).from));
  const [month, setMonth] = useState(() => toInputValue(previousMonth(new Date()).from).slice(0, 7));
  const [rangeFrom, setRangeFrom] = useState(() => toInputValue(previousWeek(new Date()).from));
  const [rangeTo, setRangeTo] = useState(() => toInputValue(previousDay(new Date())));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  /** The report's first and last day for the current choice, or null when a date is invalid. */
  function period(): { from: Date; until?: Date } | null {
    if (kind === "day") {
      const d = fromInputValue(day);
      return d ? { from: d } : null;
    }
    if (kind === "week") {
      const d = fromInputValue(weekDay);
      return d ? weekOf(d) : null;
    }
    if (kind === "month") {
      const d = fromInputValue(`${month}-01`);
      return d ? monthOf(d) : null;
    }
    const from = fromInputValue(rangeFrom);
    const until = fromInputValue(rangeTo);
    return from && until && from <= until ? { from, until } : null;
  }

  async function generate(): Promise<void> {
    const p = period();
    if (!directoryHandle || !p) return;
    const reportDay = p.from;
    setBusy(true);
    setStatus(null);
    try {
      const source = await loadDailyWorkSource(directoryHandle);
      const names: Record<string, string> = {};
      for (const u of getManagedLoginUsers()) names[u.username] = u.displayName || u.username;
      const report = buildDailyWorkReport({ months: source.months, day: reportDay, until: p.until, kind, names });

      const eml = buildDailyWorkEml(report);
      const url = URL.createObjectURL(new Blob([eml], { type: "message/rfc822" }));
      const a = document.createElement("a");
      a.href = url;
      const fileDate = (d: Date) => formatReportDay(d).date.replace(/\//g, "-");
      const fileName: Record<DailyWorkKind, string> = {
        day: `تقرير العمل اليومي ${fileDate(reportDay)}`,
        week: `تقرير العمل الأسبوعي ${fileDate(report.day)} إلى ${fileDate(report.until)}`,
        month: `تقرير العمل الشهري ${month}`,
        range: `تقرير العمل للفترة ${fileDate(report.day)} إلى ${fileDate(report.until)}`,
      };
      a.download = `${fileName[report.kind]}.eml`;
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
        <div className="rh-card-title">تقرير العمل (إيميل): يومي، أسبوعي، شهري أو لفترة</div>
        <p className="rh-card-desc">
          إيميل جاهز للإرسال يغطي جميع الأشهر الموزعة: لكل شهر جدول بالموظفين وعدد ما فحصه وأرشفه كل منهم
          خلال الفترة المختارة، والمتبقي من حصته. أيام الجمعة والسبت محسوبة. الأسبوع من الأحد إلى السبت.
        </p>
        <div className="rh-scope-toggle">
          <label htmlFor="rh-daily-kind">نوع التقرير</label>
          <select id="rh-daily-kind" value={kind} onChange={(ev) => setKind(ev.target.value as DailyWorkKind)}>
            <option value="day">يومي</option>
            <option value="week">أسبوعي</option>
            <option value="month">شهري</option>
            <option value="range">فترة محددة</option>
          </select>
        </div>
        {kind === "day" && (
          <div className="rh-scope-toggle">
            <label htmlFor="rh-daily-day">يوم التقرير</label>
            <input id="rh-daily-day" type="date" value={day} onChange={(ev) => setDay(ev.target.value)} />
          </div>
        )}
        {kind === "week" && (
          <div className="rh-scope-toggle">
            <label htmlFor="rh-weekly-day">أي يوم من الأسبوع</label>
            <input id="rh-weekly-day" type="date" value={weekDay} onChange={(ev) => setWeekDay(ev.target.value)} />
          </div>
        )}
        {kind === "month" && (
          <div className="rh-scope-toggle">
            <label htmlFor="rh-monthly">الشهر</label>
            <input id="rh-monthly" type="month" value={month} onChange={(ev) => setMonth(ev.target.value)} />
          </div>
        )}
        {kind === "range" && (
          <div className="rh-scope-toggle">
            <label htmlFor="rh-range-from">من</label>
            <input id="rh-range-from" type="date" value={rangeFrom} onChange={(ev) => setRangeFrom(ev.target.value)} />
            <label htmlFor="rh-range-to">إلى</label>
            <input id="rh-range-to" type="date" value={rangeTo} onChange={(ev) => setRangeTo(ev.target.value)} />
          </div>
        )}
        {status ? <p className="rh-card-desc" role="status">{status}</p> : null}
      </div>
      <div className="rh-card-footer">
        <button
          type="button"
          className="rh-btn rh-btn-teal"
          disabled={disabled || busy || !directoryHandle || !period()}
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
