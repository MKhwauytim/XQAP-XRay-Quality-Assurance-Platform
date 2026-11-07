// Daily work report → email. Email clients (Outlook especially) ignore <style>
// blocks and CSS variables, so every style here is inline and colors are
// literal. The .eml carries `X-Unsent: 1`, which makes Outlook open it as a
// ready-to-send draft instead of a received message.
import { esc } from "../executive/primitives";
import type { DailyWorkReport, DailyWorkTotals } from "./dailyWorkReport";

/** Email palette — inline literals on purpose (see header). */
const EMAIL_COLORS = {
  text: "#1f2937",
  muted: "#6b7280",
  border: "#d1d5db",
  headBg: "#0f4c5c",
  headText: "#ffffff",
  totalBg: "#e6f0f2",
  zebra: "#f9fafb",
  accent: "#0f766e",
} as const;

export function formatReportDay(day: Date): { weekday: string; date: string } {
  const weekday = day.toLocaleDateString("ar-SA-u-ca-gregory-nu-latn", { weekday: "long" });
  const date = `${day.getFullYear()}/${String(day.getMonth() + 1).padStart(2, "0")}/${String(day.getDate()).padStart(2, "0")}`;
  return { weekday, date };
}

export function dailyWorkSubject(day: Date): string {
  const { weekday, date } = formatReportDay(day);
  return `تقرير العمل اليومي - إدارة ضمان جودة الأشعة - يوم ${weekday} ${date}`;
}

function pct(done: number, total: number): string {
  return total > 0 ? `${Math.round((done / total) * 100)}%` : "—";
}

const cell = `border:1px solid ${EMAIL_COLORS.border};padding:6px 10px;text-align:center;`;
const headCell = `${cell}background:${EMAIL_COLORS.headBg};color:${EMAIL_COLORS.headText};font-weight:bold;`;
const totalCell = `${cell}background:${EMAIL_COLORS.totalBg};font-weight:bold;`;
const tableStyle = `border-collapse:collapse;width:100%;margin:6px 0 18px;font-size:13px;color:${EMAIL_COLORS.text};`;

const EMPLOYEE_HEADERS = [
  "الموظف",
  "الحالات الموزعة",
  "المفحوصة خلال اليوم",
  "المؤرشفة خلال اليوم",
  "إجمالي المفحوصة",
  "إجمالي المؤرشفة",
  "المتبقية",
  "نسبة الإنجاز",
];

function numberCells(t: DailyWorkTotals, style: string): string {
  return [
    t.assigned,
    t.completedOnDay,
    t.holdOnDay,
    t.completedTotal,
    t.holdTotal,
    t.remaining,
  ].map((n) => `<td style="${style}">${n}</td>`).join("")
    + `<td style="${style}">${pct(t.completedTotal + t.holdTotal, t.assigned)}</td>`;
}

export function buildDailyWorkEmailHtml(report: DailyWorkReport): string {
  const { weekday, date } = formatReportDay(report.day);
  const parts: string[] = [];
  parts.push(`<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;font-size:14px;color:${EMAIL_COLORS.text};line-height:1.7;">`);
  parts.push(`<p>الزملاء الكرام،<br>مع التحية والتقدير،</p>`);
  parts.push(`<p>أرفق لكم تقرير العمل اليومي لإدارة ضمان جودة الأشعة عن أعمال يوم <b>${esc(weekday)} ${esc(date)}</b>، موزعًا حسب الأشهر والموظفين.</p>`);

  if (report.months.length === 0) {
    parts.push(`<p style="color:${EMAIL_COLORS.muted};">لا توجد أشهر موزعة في النظام.</p>`);
  } else {
    parts.push(`<h3 style="color:${EMAIL_COLORS.accent};margin:16px 0 4px;">ملخص الأشهر</h3>`);
    parts.push(`<table style="${tableStyle}"><tr>${["الشهر", ...EMPLOYEE_HEADERS.slice(1)].map((h) => `<th style="${headCell}">${h}</th>`).join("")}</tr>`);
    report.months.forEach((m, i) => {
      const bg = i % 2 ? `background:${EMAIL_COLORS.zebra};` : "";
      parts.push(`<tr><td style="${cell}${bg}font-weight:bold;">${esc(m.label)}</td>${numberCells(m.totals, cell + bg)}</tr>`);
    });
    parts.push(`<tr><td style="${totalCell}">الإجمالي</td>${numberCells(report.totals, totalCell)}</tr></table>`);

    for (const m of report.months) {
      parts.push(`<h3 style="color:${EMAIL_COLORS.accent};margin:16px 0 4px;">مجتمع ${esc(m.label)}</h3>`);
      parts.push(`<p style="margin:0;color:${EMAIL_COLORS.muted};">تم توزيع ${m.totals.assigned} حالة، فُحص منها خلال اليوم ${m.totals.completedOnDay} وأُرشف ${m.totals.holdOnDay}، والمتبقي ${m.totals.remaining}.</p>`);
      parts.push(`<table style="${tableStyle}"><tr>${EMPLOYEE_HEADERS.map((h) => `<th style="${headCell}">${h}</th>`).join("")}</tr>`);
      m.employees.forEach((e, i) => {
        const bg = i % 2 ? `background:${EMAIL_COLORS.zebra};` : "";
        parts.push(`<tr><td style="${cell}${bg}text-align:right;">${esc(e.name)}</td>${numberCells(e, cell + bg)}</tr>`);
      });
      parts.push(`<tr><td style="${totalCell}">الإجمالي</td>${numberCells(m.totals, totalCell)}</tr></table>`);
    }
  }

  parts.push(`<p style="color:${EMAIL_COLORS.muted};font-size:12px;">المفحوصة: فحص مكتمل. المؤرشفة: حالة مقدمة بلا صورة (معلقة). المتبقية: لم تُفحص بعد أو لم تُقدَّم.</p>`);
  parts.push(`<p>وتقبلوا خالص التحية والتقدير،</p></div>`);
  return parts.join("\n");
}

function base64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

/** RFC 5322 draft; `X-Unsent: 1` opens it in Outlook as an editable draft. */
export function buildDailyWorkEml(report: DailyWorkReport): string {
  const html = `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8"></head><body>${buildDailyWorkEmailHtml(report)}</body></html>`;
  const body = base64Utf8(html).replace(/.{76}/g, "$&\r\n");
  return [
    "X-Unsent: 1",
    "To: ",
    `Subject: =?UTF-8?B?${base64Utf8(dailyWorkSubject(report.day))}?=`,
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    body,
    "",
  ].join("\r\n");
}
