import * as XLSX from "xlsx";

import { openOrDownload } from "./htmlReport";
import { ORGANIZATION_PATH_TEXT } from "../../branding/organization";
import type { ExecutiveKPIs, ExecutiveReportInput } from "./executiveReportTypes";
import {
  buildExecutiveReportRows,
  calculateExecutiveKPIs,
  fmtNum,
  fmtPct,
} from "./executiveReportData";

// ─── HTML-escape ─────────────────────────────────────────────────────────────
function esc(s: string | null | undefined): string {
  return (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const ARABIC_MONTH_NAMES = [
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
  "ديسمبر",
] as const;

function formatReportMonthName(monthFolderName: string): string {
  const match = /^(\d{1,2})-[A-Za-z]+-(\d{4})$/.exec(monthFolderName.trim());
  if (!match) return monthFolderName;
  const monthIndex = Number(match[1]) - 1;
  const monthName = ARABIC_MONTH_NAMES[monthIndex];
  return monthName ? `${monthName} ${match[2]}` : monthFolderName;
}

function formatIssueDate(date = new Date()): string {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day} / ${month} / ${date.getFullYear()}`;
}

type ReportGroupRow = {
  portType: string;
  portName: string;
  population: number;
  clean: number;
  suspicious: number;
  sampleSize: number;
  studied: number;
  resultAccuracy: number | null;
  suspicionPrecision: number | null;
  suspiciousDetectionRate: number | null;
  missedSuspicionRate: number | null;
  correctSuspicious: number;
  missedSuspicious: number;
  excessSuspicious: number;
  availableImages: number;
  highQuality: number;
  mediumQuality: number;
  lowQuality: number;
};

const STUDY_LEVEL_DEFINITIONS = [
  {
    title: "المستوى الأول",
    subtitle: "حالات الضبط المؤكدة",
    description: "الحالات التي تتضمن حوادث ضبط أمنية أو جودة قرارات التجاوز للأنظمة، ولم يتم الاشتباه بها من قبل كلا المستويين أو أحدهما.",
    tone: "level-one",
  },
  {
    title: "المستوى الثاني",
    subtitle: "حالات الاشتباه المؤكدة",
    description: "الحالات التي لم يتم الاشتباه بها من قبل كلا المستويين أو أحدهما، وتم الاشتباه بها من أحد الفرق الأمنية الأخرى مثل الوسائل الحية أو المعاينة أو التفتيش الآلي.",
    tone: "level-two",
  },
  {
    title: "المستوى الثالث",
    subtitle: "حالات محرك المخاطر",
    description: "الحالات التي تتضمن مدخلات مخاطر ولم يتم الاشتباه بها من المستوى الأول والثاني.",
    tone: "level-three",
  },
  {
    title: "المستوى الرابع",
    subtitle: "اشتباه الأشعة غير المؤكد",
    description: "الحالات التي تم الاشتباه بها من قبل المستوى الأول أو الثاني في صور الأشعة ولم يتم تأكيد الاشتباه من الفرق الأمنية الأخرى.",
    tone: "level-four",
  },
];

function groupForReport(rows: ReturnType<typeof buildExecutiveReportRows>): ReportGroupRow[] {
  const grouped = new Map<string, typeof rows>();
  for (const row of rows) {
    const portType = row.portType ?? "غير محدد";
    const portName = row.portName ?? "غير محدد";
    const key = `${portType}\u0000${portName}`;
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  return [...grouped.values()].map((items) => {
    const first = items[0]!;
    const valid = items.filter((item) => item.verificationCategory !== null);
    const correct = valid.filter((item) => item.imageResultAccurate === true).length;
    const correctSuspicious = valid.filter((item) => item.verificationCategory === "correct-suspicious").length;
    const missedSuspicious = valid.filter((item) => item.verificationCategory === "missed-suspicious").length;
    const excessSuspicious = valid.filter((item) => item.verificationCategory === "excess-suspicious").length;
    const originalSuspicious = correctSuspicious + excessSuspicious;
    const expertSuspicious = correctSuspicious + missedSuspicious;
    return {
      portType: first.portType ?? "غير محدد",
      portName: first.portName ?? "غير محدد",
      population: items.length,
      clean: items.filter((item) => item.imageResult === "سليمة").length,
      suspicious: items.filter((item) => item.imageResult === "اشتباه").length,
      sampleSize: items.filter((item) => item.selectedInSample).length,
      studied: items.filter((item) => item.selectedInSample && item.answerStatus === "submitted").length,
      resultAccuracy: valid.length > 0 ? (correct / valid.length) * 100 : null,
      suspicionPrecision: originalSuspicious > 0 ? (correctSuspicious / originalSuspicious) * 100 : null,
      suspiciousDetectionRate: expertSuspicious > 0 ? (correctSuspicious / expertSuspicious) * 100 : null,
      missedSuspicionRate: expertSuspicious > 0 ? (missedSuspicious / expertSuspicious) * 100 : null,
      correctSuspicious,
      missedSuspicious,
      excessSuspicious,
      availableImages: items.filter((item) => item.answerStatus === "submitted" && item.imageAvailable === true).length,
      highQuality: items.filter((item) => item.answerStatus === "submitted" && item.imageQuality === "عالي").length,
      mediumQuality: items.filter((item) => item.answerStatus === "submitted" && item.imageQuality === "متوسط").length,
      lowQuality: items.filter((item) => item.answerStatus === "submitted" && item.imageQuality === "منخفض").length,
    };
  }).sort((a, b) => a.portType.localeCompare(b.portType, "ar") || b.population - a.population);
}

function compactPercent(value: number | null): string {
  return value === null ? "غير متاح" : `${value.toFixed(1)}%`;
}

function reportTable(headers: string[], rows: string[][]): string {
  return `<table class="xr-table"><thead><tr>${headers.map((header) => `<th>${esc(header)}</th>`).join("")}</tr></thead><tbody>
    ${rows.length ? rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${headers.length}">لا توجد بيانات كافية</td></tr>`}
  </tbody></table>`;
}

function portTypeTone(portType: string): "land" | "sea" | "other" {
  if (portType.includes("بري")) return "land";
  if (portType.includes("بحري")) return "sea";
  return "other";
}

function portTypeBadge(portType: string): string {
  return `<span class="port-type-badge ${portTypeTone(portType)}">${esc(portType)}</span>`;
}

function qualityBars(kpis: ExecutiveKPIs): string {
  const total = Math.max(kpis.imageQualityEvaluatedCount, 1);
  const items = [
    ["عالية", kpis.highQualityCount, "#007e73"],
    ["متوسطة", kpis.mediumQualityCount, "#0a315f"],
    ["منخفضة", kpis.lowQualityCount, "#c33232"],
  ] as const;
  return `<div class="quality-bars">${items.map(([label, count, color]) => {
    const pct = (count / total) * 100;
    return `<div class="quality-bar-row"><span>${label}</span><div><i style="width:${pct.toFixed(1)}%;background:${color}"></i></div><b>${fmtNum(count)}</b></div>`;
  }).join("")}</div>`;
}

function reasonRows(reasons: ExecutiveKPIs["missingImageReasons"], fallback: string): string {
  if (!reasons.length) return `<div class="empty-note">${esc(fallback)}</div>`;
  return reasons.slice(0, 5).map((item) => `<div class="reason-line"><span>${esc(item.reason)}</span><b>${fmtNum(item.count)}</b><em>${compactPercent(item.percentage)}</em></div>`).join("");
}

function boundedPct(value: number | null): number {
  if (value === null || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function slideFrame(pageNumber: string, title: string, subtitle: string, body: string, extraClass = ""): string {
  return `<section class="xr-page ${extraClass}">
    <header class="slide-head">
      <span>${pageNumber}</span>
      <div><h2>${esc(title)}</h2><p>${esc(subtitle)}</p></div>
    </header>
    ${body}
    <div class="footer">صفحة ${Number(pageNumber)} | ${esc(title)}</div>
  </section>`;
}

function metricCard(label: string, value: string, tone = ""): string {
  return `<div class="metric-card ${tone}"><span>${esc(label)}</span><b>${value}</b></div>`;
}

function insightCard(label: string, value: string, text: string, tone = ""): string {
  return `<article class="insight-card ${tone}"><span>${esc(label)}</span><b>${value}</b><p>${esc(text)}</p></article>`;
}

function topBy<T>(items: T[], score: (item: T) => number): T | null {
  return items.reduce<{ item: T | null; score: number }>((best, item) => {
    const value = score(item);
    return value > best.score ? { item, score: value } : best;
  }, { item: null, score: Number.NEGATIVE_INFINITY }).item;
}

function weightedResultAccuracy(rows: ReportGroupRow[]): { accuracy: number | null; studied: number } {
  const totals = rows.reduce((acc, row) => {
    if (row.resultAccuracy === null || row.studied <= 0) return acc;
    acc.score += row.resultAccuracy * row.studied;
    acc.studied += row.studied;
    return acc;
  }, { score: 0, studied: 0 });
  return {
    accuracy: totals.studied > 0 ? totals.score / totals.studied : null,
    studied: totals.studied,
  };
}

function accuracyCompareCard(label: string, summary: ReturnType<typeof weightedResultAccuracy>, tone = ""): string {
  return `<article class="accuracy-card ${tone}">
    <span>${esc(label)}</span>
    <b>${compactPercent(summary.accuracy)}</b>
    <small>المدروسة ${fmtNum(summary.studied)}</small>
    <div><i style="width:${boundedPct(summary.accuracy).toFixed(1)}%"></i></div>
  </article>`;
}

function portTypeRows(groupedRows: ReportGroupRow[]) {
  return [...groupedRows.reduce((map, row) => {
    const current = map.get(row.portType) ?? {
      portType: row.portType,
      population: 0,
      clean: 0,
      suspicious: 0,
      sampleSize: 0,
      studied: 0,
      accuracyNumerator: 0,
      accuracyDenominator: 0,
    };
    current.population += row.population;
    current.clean += row.clean;
    current.suspicious += row.suspicious;
    current.sampleSize += row.sampleSize;
    current.studied += row.studied;
    if (row.resultAccuracy !== null) {
      current.accuracyNumerator += row.resultAccuracy * row.studied;
      current.accuracyDenominator += row.studied;
    }
    map.set(row.portType, current);
    return map;
  }, new Map<string, {
    portType: string;
    population: number;
    clean: number;
    suspicious: number;
    sampleSize: number;
    studied: number;
    accuracyNumerator: number;
    accuracyDenominator: number;
  }>()).values()];
}

function portTypeStackedChart(rows: ReturnType<typeof portTypeRows>): string {
  if (!rows.length) return `<div class="empty-note">لا توجد بيانات كافية للرسم.</div>`;
  return `<div class="stacked-type-chart">${rows.map((row) => {
    const cleanPct = row.population > 0 ? (row.clean / row.population) * 100 : 0;
    const suspiciousPct = row.population > 0 ? (row.suspicious / row.population) * 100 : 0;
    return `<div class="stacked-type-row">
      ${portTypeBadge(row.portType)}
      <div class="stack-track">
        <i class="clean" style="width:${cleanPct.toFixed(1)}%"></i>
        <i class="suspicious" style="width:${suspiciousPct.toFixed(1)}%"></i>
      </div>
      <b>${fmtNum(row.population)}</b>
    </div>`;
  }).join("")}</div>`;
}

function inspectionBars(rows: ReportGroupRow[]): string {
  const ranked = rows
    .filter((row) => row.studied > 0)
    .sort((a, b) => (b.suspicionPrecision ?? -1) - (a.suspicionPrecision ?? -1))
    .slice(0, 8);
  if (!ranked.length) return `<div class="empty-note">لا توجد إجابات معتمدة كافية لعرض الرسم.</div>`;
  return `<div class="inspection-bars">${ranked.map((row) => `
    <div class="inspection-bar-row">
      <span>${esc(row.portName)}</span>
      <div><i style="width:${boundedPct(row.suspicionPrecision).toFixed(1)}%"></i></div>
      <b>${compactPercent(row.suspicionPrecision)}</b>
    </div>`).join("")}</div>`;
}

function buildCoverPage(input: ExecutiveReportInput, kpis: ExecutiveKPIs): string {
  const reportMonth = formatReportMonthName(input.monthFolderName);
  const issueDate = formatIssueDate();
  return `<section class="xr-page cover">
    <div class="cover-top">
      <div class="cover-badge">التقرير التنفيذي</div>
      <div class="cover-org">${esc(ORGANIZATION_PATH_TEXT)}</div>
    </div>
    <div class="cover-main">
      <div class="cover-mark">تقرير شهري</div>
      <h1><span>التقرير التنفيذي</span><strong>لضمان جودة الأشعة</strong></h1>
      <div class="cover-period">
        <span>فترة التقرير</span><b>${esc(reportMonth)}</b>
        <span>تاريخ الإصدار</span><b>${issueDate}</b>
      </div>
    </div>
    <div class="cover-stats">
      ${metricCard("إجمالي الصور", fmtNum(kpis.totalPopulation))}
      ${metricCard("العينة المسحوبة", fmtNum(kpis.totalSample))}
      ${metricCard("الصور المدروسة", fmtNum(kpis.studiedImages))}
    </div>
    <div class="footer">صفحة 1 | الغلاف</div>
  </section>`;
}

function stageStat(kpis: ExecutiveKPIs, index: number): { population: number; sampleSize: number; studied: number } {
  const profile = kpis.stageProfiles[index];
  return {
    population: profile?.population ?? 0,
    sampleSize: profile?.sampleSize ?? 0,
    studied: profile?.studied ?? 0,
  };
}

function buildStudyLevelsPage(kpis: ExecutiveKPIs): string {
  const studiedStages = kpis.stageProfiles.filter((stage) => stage.sampleSize > 0).length;
  const body = `<div class="level-summary-strip">
    ${insightCard("مستويات ضمن العينة", fmtNum(studiedStages), "عدد المستويات التي تحتوي على صور ضمن عينة الشهر.")}
    ${insightCard("مجتمع الشهر", fmtNum(kpis.totalPopulation), "إجمالي صور الأشعة ضمن فترة التقرير.")}
    ${insightCard("الصور المدروسة", fmtNum(kpis.studiedImages), "الإجابات المعتمدة التي دخلت في مؤشرات الفحص.")}
  </div>
  <div class="levels-grid">
    ${STUDY_LEVEL_DEFINITIONS.map((level, index) => {
      const stats = stageStat(kpis, index);
      return `<article class="level-card ${level.tone}">
        <div class="level-title">
          <h3>${esc(level.title)}</h3>
          <span>${esc(level.subtitle)}</span>
        </div>
        <p>${esc(level.description)}</p>
        <div class="level-stats">
          <div><span>مجتمع الشهر</span><b>${fmtNum(stats.population)}</b></div>
          <div><span>المدروسة</span><b>${fmtNum(stats.studied)}</b></div>
        </div>
      </article>`;
    }).join("")}
  </div>`;
  return slideFrame("02", "مستويات الدراسة", "تعريف المستويات الأربعة ونطاق كل مستوى في عينة الفحص.", body);
}

function buildPopulationPage(kpis: ExecutiveKPIs, groupedRows: ReportGroupRow[]): string {
  const typeRows = portTypeRows(groupedRows);
  const highestSuspicionPort = topBy(groupedRows, (row) => row.suspicious);
  const tableRows = groupedRows.slice(0, 15).map((row) => [
    portTypeBadge(row.portType),
    esc(row.portName),
    fmtNum(row.population),
    fmtNum(row.clean),
    fmtNum(row.suspicious),
    fmtNum(row.studied),
  ]);
  const body = `<div class="metric-grid">
      ${metricCard("إجمالي الصور", fmtNum(kpis.totalPopulation))}
      ${metricCard("سليمة", fmtNum(kpis.cleanCount), "good")}
      ${metricCard("اشتباه", fmtNum(kpis.suspiciousCount), "warn")}
      ${metricCard("العينة", fmtNum(kpis.totalSample))}
    </div>
    <div class="insight-strip">
      ${insightCard("نسبة الاشتباه", fmtPct(kpis.suspicionRate), "حصة الصور المصنفة اشتباه من إجمالي مجتمع الشهر.", "warn")}
      ${insightCard("أعلى منفذ اشتباهاً", highestSuspicionPort ? esc(highestSuspicionPort.portName) : "غير متاح", highestSuspicionPort ? `${fmtNum(highestSuspicionPort.suspicious)} صورة اشتباه ضمن المجتمع.` : "لا توجد بيانات كافية.")}
      ${insightCard("الصور المدروسة", fmtNum(kpis.studiedImages), "إجمالي الصور التي لديها إجابات فحص معتمدة.")}
    </div>
    <div class="population-layout">
      <div class="main-table-panel">
        ${reportTable(["نوع المنفذ", "المنفذ", "إجمالي الصور", "سليمة", "اشتباه", "المدروسة"], tableRows)}
      </div>
      <aside class="side-chart-panel">
        <h3>توزيع النتائج حسب نوع المنفذ</h3>
        ${portTypeStackedChart(typeRows)}
        <div class="legend-row"><span><i class="legend-clean"></i>سليمة</span><span><i class="legend-suspicious"></i>اشتباه</span></div>
        ${reportTable(["نوع المنفذ", "إجمالي الصور", "سليمة", "اشتباه", "المدروسة"], typeRows.map((row) => [
        portTypeBadge(row.portType),
        fmtNum(row.population),
        fmtNum(row.clean),
        fmtNum(row.suspicious),
        fmtNum(row.studied),
      ]))}
      </aside>
    </div>`;
  return slideFrame("03", "مجتمع الدراسة والعينة", "إجمالي الصور ونتائجها وحجم العينة حسب نوع المنفذ والمنفذ.", body);
}

function buildInspectionResultsPage(kpis: ExecutiveKPIs, groupedRows: ReportGroupRow[]): string {
  const rankedRows = groupedRows
    .filter((row) => row.studied > 0)
    .sort((a, b) => (a.suspicionPrecision ?? 101) - (b.suspicionPrecision ?? 101))
    .slice(0, 9);
  const generalAccuracy = { accuracy: kpis.overallAccuracy, studied: kpis.validStudied };
  const landAccuracy = weightedResultAccuracy(groupedRows.filter((row) => portTypeTone(row.portType) === "land"));
  const seaAccuracy = weightedResultAccuracy(groupedRows.filter((row) => portTypeTone(row.portType) === "sea"));
  const body = `<div class="accuracy-comparison">
      ${accuracyCompareCard("نسبة الدقة العامة", generalAccuracy)}
      ${accuracyCompareCard("منفذ بري", landAccuracy, "land")}
      ${accuracyCompareCard("منفذ بحري", seaAccuracy, "sea")}
    </div>
    <div class="results-layout">
      <section class="chart-panel">
        <h3>نسبة دقة الاشتباه حسب المنفذ</h3>
        ${inspectionBars(groupedRows)}
        <div class="panel-note">يعرض الرسم المنافذ التي لديها صور مدروسة، مرتبة حسب دقة الاشتباه المتاحة.</div>
      </section>
      <section class="result-table-panel">
        ${reportTable(["نوع المنفذ", "المنفذ", "المدروسة", "دقة نتائج الأشعة", "دقة الاشتباه", "اشتباه فائت"], rankedRows.map((row) => [
        portTypeBadge(row.portType),
        esc(row.portName),
        fmtNum(row.studied),
        compactPercent(row.resultAccuracy),
        compactPercent(row.suspicionPrecision),
        compactPercent(row.missedSuspicionRate),
      ]))}
      </section>
    </div>`;
  return slideFrame("04", "نتائج الفحص", "دقة نتائج الأشعة ودقة الاشتباه حسب بيانات الفحص المعتمدة.", body);
}

function buildImageQualityPage(kpis: ExecutiveKPIs): string {
  const body = `<div class="quality-top-grid">
      ${metricCard("توفر الصور", fmtPct(kpis.imageAvailabilityRate), "large good")}
      ${metricCard("وجود التحديد", fmtPct(kpis.markingRate), "large")}
      ${metricCard("الجودة المقبولة", fmtPct(kpis.acceptableQualityRate), "large good")}
    </div>
    <div class="insight-strip quality-insights">
      ${insightCard("صور غير متاحة", fmtNum(kpis.imageMissingCount), "عدد الصور التي لم تتوفر للفحص حسب إجابات القالب.", kpis.imageMissingCount > 0 ? "risk" : "good")}
      ${insightCard("جودة منخفضة", fmtNum(kpis.lowQualityCount), "صور تم تقييم مستوى جودة التقاطها كمنخفض.", kpis.lowQualityCount > 0 ? "warn" : "good")}
      ${insightCard("صور مقيمة", fmtNum(kpis.imageQualityEvaluatedCount), "إجمالي الصور التي دخلت في توزيع مستوى الجودة.")}
    </div>
    <div class="quality-layout">
      <div class="quality-card">
          <h3>توزيع مستوى الجودة</h3>
          ${qualityBars(kpis)}
      </div>
      <div class="quality-card"><h3>أسباب عدم وجود الصورة</h3>${reasonRows(kpis.missingImageReasons, "لا توجد أسباب مسجلة.")}</div>
      <div class="quality-card"><h3>أسباب انخفاض الجودة</h3>${reasonRows(kpis.lowQualityReasons, "لا توجد أسباب مسجلة.")}</div>
    </div>`;
  return slideFrame("05", "جودة الصور الملتقطة", "مؤشرات توفر الصورة والتحديد ومستوى الجودة من إجابات قالب الفحص.", body);
}

function buildPrintableExecutiveReport(
  input: ExecutiveReportInput,
  kpis: ExecutiveKPIs,
  groupedRows: ReportGroupRow[]
): string {
  const pages = [
    buildCoverPage(input, kpis),
    buildStudyLevelsPage(kpis),
    buildPopulationPage(kpis, groupedRows),
    buildInspectionResultsPage(kpis, groupedRows),
    buildImageQualityPage(kpis),
  ].join("");
  const reportMonth = formatReportMonthName(input.monthFolderName);

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>التقرير التنفيذي | ${esc(reportMonth)}</title>
<style>${PRINT_REPORT_CSS}</style>
</head>
<body>
  <div class="print-toolbar">
    <div>
      <strong>التقرير التنفيذي | ${esc(reportMonth)}</strong>
      <span>للتصدير PDF: اختر Save to PDF، الاتجاه أفقي، الهوامش لا شيء، وأوقف الرؤوس والتذييلات.</span>
    </div>
    <button onclick="window.print()">تصدير PDF</button>
      </div>
  <main>${pages}</main>
</body>
</html>`;
}

const PRINT_REPORT_CSS = `
@page{size:13.333in 7.5in;margin:0;}
*{box-sizing:border-box;}
@font-face{font-family:"Somar";src:url("${import.meta.env.BASE_URL}fonts/SomarSans-Regular.woff") format("woff");font-weight:400;font-style:normal;font-display:swap;}
@font-face{font-family:"Somar";src:url("${import.meta.env.BASE_URL}fonts/SomarSans-Light.woff") format("woff");font-weight:300;font-style:normal;font-display:swap;}
@font-face{font-family:"Somar";src:url("${import.meta.env.BASE_URL}fonts/SomarSans-Medium.woff") format("woff");font-weight:500;font-style:normal;font-display:swap;}
@font-face{font-family:"Somar";src:url("${import.meta.env.BASE_URL}fonts/SomarSans-Bold.woff") format("woff");font-weight:700;font-style:normal;font-display:swap;}
:root{--navy:#082f55;--navy-2:#0c4a7b;--navy-light:#e9eff5;--teal:#17766f;--cyan:#00a4d6;--cyan-soft:#e9f7fc;--line:#d8e0e8;--ink:#17283a;--muted:#637286;--bg:#e7ebef;--surface:#f5f7f9;--green:#2f7550;--green-bg:#edf6f0;--blue-bg:#e9eff5;--amber:#9b6a19;--red:#a63b43;--red-bg:#faecee;}
html{background:var(--bg);}
body{margin:0;background:var(--bg);color:var(--ink);font-family:"Somar","Segoe UI",Tahoma,Arial,sans-serif;font-variant-numeric:tabular-nums;direction:rtl;}
.print-toolbar{position:sticky;top:0;z-index:10;display:flex;align-items:center;justify-content:space-between;gap:18px;padding:10px 18px;background:#fff;border-bottom:1px solid var(--line);}
.print-toolbar div{display:grid;gap:2px;}
.print-toolbar strong{font-size:15px;color:var(--navy);font-weight:700;}
.print-toolbar span{font-size:11px;color:var(--muted);font-weight:600;}
.print-toolbar button{border:0;border-radius:3px;background:var(--navy);color:#fff;font-weight:800;padding:9px 16px;cursor:pointer;}
main{padding:18px 0 34px;}
.xr-page{width:13.333in;height:7.5in;margin:0 auto 18px;padding:.42in .52in .36in;background:#fff;border:1px solid #ccd5de;border-radius:0;box-shadow:0 12px 30px rgba(21,39,57,.10);position:relative;page-break-after:always;overflow:hidden;isolation:isolate;}
.xr-page::before{content:"";position:absolute;top:0;left:0;right:0;height:.08in;background:var(--navy);}
.xr-page::after{display:none;}
.slide-head{display:flex;align-items:flex-start;justify-content:space-between;gap:.16in;border-bottom:1px solid var(--line);padding:.02in 0 .13in;margin:.02in 0 .16in;}
.slide-head>span{order:2;color:var(--navy);background:transparent;width:auto;height:auto;display:block;font-weight:800;direction:ltr;font-size:.18in;box-shadow:none;border-radius:0;}
.slide-head>div{order:1;}
h2{margin:0;color:var(--navy);font-size:.29in;line-height:1.18;font-weight:800;letter-spacing:0;}
.slide-head p{margin:.035in 0 0;color:var(--muted);font-size:.105in;font-weight:700;}
.footer{position:absolute;left:.52in;right:.52in;bottom:.15in;border-top:1px solid var(--line);padding-top:.055in;color:var(--muted);font-size:.082in;}

.cover{display:block;background:#fff;isolation:isolate;padding:0;}
.cover::before{display:none;}
.cover-top{position:absolute;top:0;right:0;left:0;height:.9in;padding:.28in .72in 0;background:var(--navy);color:#fff;display:flex;align-items:flex-start;justify-content:space-between;gap:.35in;z-index:3;}
.cover-badge{display:inline-flex;align-items:center;min-height:auto;border:1px solid rgba(255,255,255,.45);border-radius:0;background:transparent;color:#fff;font-size:.09in;font-weight:800;padding:.045in .12in;box-shadow:none;}
.cover-org{max-width:7.4in;color:#fff;font-size:.095in;line-height:1.65;font-weight:700;text-align:left;}
.cover-main{position:absolute;top:1.42in;right:.78in;left:.78in;z-index:3;}
.cover-mark{font-size:.125in;font-weight:800;color:var(--teal);margin-bottom:.12in;}
.cover h1{font-size:.52in;line-height:1.18;margin:0;color:var(--navy);font-weight:800;max-width:8.4in;}
.cover h1 span,.cover h1 strong{display:block;}
.cover h1 strong{font-weight:800;}
.cover-period{display:grid;grid-template-columns:auto 1fr;gap:.07in .16in;width:4.15in;margin-top:.28in;border-right:4px solid var(--teal);background:var(--surface);border-radius:0;padding:.12in .17in;box-shadow:none;}
.cover-period span{color:var(--muted);font-size:.09in;font-weight:700;}
.cover-period b{color:var(--navy);font-size:.13in;font-weight:800;direction:ltr;text-align:right;}
.cover-stats{position:absolute;right:.78in;left:.78in;bottom:.72in;display:grid;grid-template-columns:repeat(3,1fr);gap:.12in;z-index:4;}
.cover .metric-card{background:#fff;border-color:var(--line);box-shadow:none;}
.cover .metric-card span{color:#6d7482;}
.cover .metric-card b{font-size:.3in;}
.metric-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:.1in;margin-bottom:.15in;}
.insight-strip,.level-summary-strip{display:grid;grid-template-columns:repeat(3,1fr);gap:.1in;margin-bottom:.13in;}
.level-summary-strip{margin-top:.02in;}
.insight-card{border:1px solid var(--line);border-radius:0;background:#fff;padding:.09in .12in;min-height:.62in;box-shadow:none;}
.insight-card span{display:block;color:#6d7482;font-size:.083in;font-weight:700;margin-bottom:.03in;}
.insight-card b{display:block;color:var(--navy);font-size:.15in;font-weight:800;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.insight-card p{margin:.045in 0 0;color:#5d6675;font-size:.078in;line-height:1.45;}
.insight-card.warn{border-top:4px solid var(--cyan);}.insight-card.risk{border-top:4px solid var(--red);}.insight-card.good{border-top:4px solid var(--green);}
.quality-top-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:.11in;margin-bottom:.15in;}
.metric-card,.quality-card{border:1px solid var(--line);border-top:3px solid var(--navy);border-radius:0;background:#fff;padding:.115in .14in;box-shadow:none;}
.metric-card span{display:block;color:#5d6675;font-weight:700;font-size:.095in;margin-bottom:.04in;}
.metric-card b{display:block;color:var(--navy);font-weight:800;font-size:.24in;direction:ltr;text-align:right;line-height:1.1;}
.metric-card.good{border-top-color:var(--green);}.metric-card.warn{border-top-color:var(--amber);}.metric-card.risk{border-top-color:var(--red);}
.metric-card.good b{color:var(--green);}.metric-card.warn b{color:var(--amber);}.metric-card.risk b{color:var(--red);}.metric-card.large{min-height:.88in;display:flex;flex-direction:column;justify-content:center;}.metric-card.large b{font-size:.29in;}

.levels-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:.1in;margin-top:.04in;}
.level-card{height:4.32in;border:1px solid var(--line);border-radius:0;background:#fff;box-shadow:none;overflow:hidden;display:flex;flex-direction:column;}
.level-title{padding:.12in .12in;text-align:center;color:#fff;background:var(--navy);}
.level-card.level-two .level-title,.level-card.level-three .level-title,.level-card.level-four .level-title{background:var(--navy);}
.level-title h3{font-size:.2in;line-height:1.15;margin:0 0 .055in;font-weight:800;}
.level-title span{font-size:.087in;color:#d9f3ff;font-weight:700;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.level-card.level-four .level-title span{color:#d9f3ff;}
.level-card p{margin:0;padding:.12in .13in;color:var(--ink);font-size:.092in;line-height:1.56;min-height:2.05in;border-bottom:1px solid var(--line);}
.level-stats{display:grid;gap:.045in;padding:.1in .13in;margin-top:auto;}
.level-stats div{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line);padding-bottom:.04in;}
.level-stats div:last-child{border-bottom:0;padding-bottom:0;}
.level-stats span{color:var(--muted);font-size:.078in;font-weight:700;}.level-stats b{color:var(--navy);font-size:.125in;font-weight:800;direction:ltr;}

.population-layout{display:grid;grid-template-columns:1.58fr .72fr;gap:.13in;align-items:start;}
.main-table-panel,.side-chart-panel,.chart-panel,.result-table-panel{border:1px solid var(--line);border-radius:0;background:#fff;box-shadow:none;overflow:hidden;}
.side-chart-panel,.chart-panel{padding:.13in;}
.side-chart-panel h3,.chart-panel h3,.quality-card h3{margin:0 0 .1in;color:var(--navy);font-size:.16in;font-weight:800;text-align:center;}
.xr-table{width:100%;border-collapse:collapse;border-spacing:0;font-size:.085in;}
.xr-table th{background:var(--navy);color:#fff;padding:.07in .055in;text-align:center;font-weight:800;white-space:nowrap;}
.xr-table td{padding:.058in .05in;border-bottom:1px solid var(--line);text-align:center;color:var(--ink);font-weight:700;line-height:1.3;}
.xr-table tr:nth-child(even) td{background:#f5f7fa;}
.xr-table tr:last-child td{border-bottom:0;}
.port-type-badge{display:inline-flex;align-items:center;justify-content:center;min-width:.72in;padding:.025in .065in;border:1px solid var(--line);border-radius:0;font-size:.075in;font-weight:800;white-space:nowrap;}
.port-type-badge.land{background:var(--green-bg);color:var(--green);border-color:var(--line);}
.port-type-badge.sea{background:var(--navy-light);color:var(--navy);border-color:var(--line);}
.port-type-badge.other{background:var(--surface);color:var(--muted);border:1px solid var(--line);}
.stacked-type-chart{display:grid;gap:.09in;margin-bottom:.12in;}
.stacked-type-row{display:grid;grid-template-columns:.82in 1fr .42in;gap:.07in;align-items:center;}
.stack-track{height:.14in;background:#e8edf2;border-radius:0;overflow:hidden;display:flex;direction:rtl;}
.stack-track i{height:100%;display:block;}.stack-track .clean{background:var(--green);}.stack-track .suspicious{background:var(--navy);}.stacked-type-row b{color:var(--navy);font-weight:800;direction:ltr;text-align:left;}
.legend-row{display:flex;align-items:center;justify-content:center;gap:.18in;margin:.02in 0 .11in;color:var(--muted);font-size:.085in;font-weight:700;}
.legend-row span{display:inline-flex;align-items:center;gap:.045in;}.legend-row i{display:inline-block;width:.11in;height:.11in;border-radius:2px;}.legend-clean{background:var(--green);}.legend-suspicious{background:var(--navy);}

.accuracy-comparison{display:grid;grid-template-columns:repeat(3,1fr);gap:.12in;margin-bottom:.14in;}
.accuracy-card{border:1px solid var(--line);border-top:3px solid var(--navy);border-radius:0;background:#fff;padding:.13in .15in;box-shadow:none;position:relative;overflow:hidden;min-height:.96in;}
.accuracy-card::before{content:"";position:absolute;top:0;right:0;width:.065in;height:100%;background:var(--navy);}
.accuracy-card.land::before{background:var(--green);}.accuracy-card.sea::before{background:var(--cyan);}
.accuracy-card span{display:block;color:var(--muted);font-size:.095in;font-weight:700;margin-bottom:.035in;}
.accuracy-card b{display:block;color:var(--navy);font-size:.3in;font-weight:800;line-height:1.05;direction:ltr;text-align:right;}
.accuracy-card small{display:block;color:#52677f;font-size:.078in;font-weight:700;margin-top:.035in;}
.accuracy-card div{height:.08in;background:#e8edf2;border-radius:0;overflow:hidden;margin-top:.09in;}
.accuracy-card i{display:block;height:100%;border-radius:0;background:var(--navy);}
.accuracy-card.land i{background:var(--green);}.accuracy-card.sea i{background:var(--cyan);}
.results-layout{display:grid;grid-template-columns:1fr 1.22fr;gap:.13in;align-items:stretch;}
.panel-note{margin-top:.12in;border-right:4px solid var(--navy);background:var(--surface);color:var(--muted);border-radius:0;padding:.1in .12in;font-size:.087in;font-weight:800;line-height:1.55;}
.panel-summary{display:grid;grid-template-columns:1fr 1fr;gap:.08in;padding:.1in;border-bottom:1px solid var(--line);background:var(--cyan-soft);}
.panel-summary .insight-card{min-height:.68in;padding:.08in .1in;box-shadow:none;background:#fff;}
.inspection-bars{display:grid;gap:.087in;}
.inspection-bar-row{display:grid;grid-template-columns:.9in 1fr .55in;gap:.07in;align-items:center;}
.inspection-bar-row span{color:var(--ink);font-weight:700;font-size:.087in;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.inspection-bar-row div{height:.13in;background:#e8edf2;border-radius:0;overflow:hidden;}
.inspection-bar-row i{display:block;height:100%;border-radius:0;background:var(--navy);}
.inspection-bar-row b{color:var(--navy);font-weight:800;direction:ltr;text-align:left;font-size:.085in;}

.quality-insights{margin-top:-.04in;}
.quality-layout{display:grid;grid-template-columns:1fr 1fr 1fr;gap:.13in;align-items:start;}
.quality-card h3{font-size:.16in;}
.quality-bars{display:grid;gap:.13in;margin-top:.04in;}
.quality-bar-row{display:grid;grid-template-columns:.78in 1fr .5in;gap:.09in;align-items:center;}
.quality-bar-row span{color:var(--ink);font-weight:700;}
.quality-bar-row div{height:.15in;background:#e8edf2;border-radius:0;overflow:hidden;}
.quality-bar-row i{display:block;height:100%;border-radius:0;}
.quality-bar-row b,.reason-line b,.reason-line em{direction:ltr;text-align:left;color:var(--navy);font-weight:800;}
.reason-line{display:grid;grid-template-columns:1fr .5in .5in;gap:.08in;align-items:center;padding:.075in 0;border-bottom:1px solid var(--line);}
.reason-line span{font-weight:700;color:var(--ink);font-size:.095in;}
.reason-line em{font-style:normal;color:var(--muted);}
.empty-note{color:var(--muted);background:#f8fafc;border:1px dashed var(--line);border-radius:4px;padding:.18in;text-align:center;font-weight:800;}
@media print{@page{size:13.333in 7.5in;margin:0;}html,body{width:13.333in;height:7.5in;margin:0;background:#fff;overflow:visible;-webkit-print-color-adjust:exact;print-color-adjust:exact;}.print-toolbar{display:none}main{width:13.333in;margin:0;padding:0;}.xr-page{width:13.333in;height:7.5in;margin:0;padding:.42in .52in .36in;border:0;border-radius:0;box-shadow:none;page-break-after:always;break-after:page;}.xr-page:last-child{page-break-after:auto;break-after:auto;}}
`;

// ─── Main builder ─────────────────────────────────────────────────────────────
export function buildExecutiveReport(input: ExecutiveReportInput): string {
  const execRows = buildExecutiveReportRows(input);
  const kpis = calculateExecutiveKPIs(execRows, input.sample, input.config);
  return buildPrintableExecutiveReport(input, kpis, groupForReport(execRows));
}

export function openExecutiveReport(input: ExecutiveReportInput): void {
  openOrDownload(buildExecutiveReport(input), `التقرير_التنفيذي_${input.monthFolderName}.html`);
}

export function buildExecutiveXlsx(input: ExecutiveReportInput): void {
  const execRows = buildExecutiveReportRows(input);
  const kpis = calculateExecutiveKPIs(execRows, input.sample, input.config);

  // Sheet 1: KPI summary
  const kpiSheet = [
    ["مؤشر", "القيمة"],
    ["الشهر", input.monthFolderName],
    [],
    ["إجمالي المجتمع", kpis.totalPopulation],
    ["إجمالي العينة", kpis.totalSample],
    ["تغطية المجتمع%", kpis.sampleCoverage?.toFixed(2) ?? ""],
    ["مدروسة", kpis.studiedImages],
    ["متبقية", kpis.remainingImages],
    ["إنجاز العينة%", kpis.completionRate?.toFixed(2) ?? ""],
    [],
    ["سليمة", kpis.cleanCount],
    ["اشتباه", kpis.suspiciousCount],
    ["نسبة الاشتباه%", kpis.suspicionRate?.toFixed(2) ?? ""],
    [],
    ["دقة نتيجة الصورة%", kpis.overallAccuracy?.toFixed(2) ?? ""],
    ["قوة اكتشاف الاشتباه%", kpis.suspiciousDetectionRate?.toFixed(2) ?? ""],
    ["اشتباه فائت%", kpis.missedSuspicionRate?.toFixed(2) ?? ""],
    ["دقة الاشتباه (الخصوصية)%", kpis.suspicionPrecision?.toFixed(2) ?? ""],
    ["مؤشر الجودة المتوازن%", kpis.balancedQualityScore?.toFixed(2) ?? ""],
    ["دقة المستوى الأول%", kpis.levelOneAccuracy?.toFixed(2) ?? ""],
    ["دقة المستوى الثاني%", kpis.levelTwoAccuracy?.toFixed(2) ?? ""],
    [],
    ["اشتباه مكتشف", kpis.correctSuspicious],
    ["سليمة مؤكدة", kpis.correctClean],
    ["اشتباه فائت (عدد)", kpis.missedSuspicious],
    ["اشتباه زائد", kpis.excessSuspicious],
    ["صور بتحقق صالح", kpis.validStudied],
    [],
    ["توفر الصور%", kpis.imageAvailabilityRate?.toFixed(2) ?? ""],
    ["صور متاحة", kpis.imageAvailableCount],
    ["صور غير متاحة", kpis.imageMissingCount],
    ["وجود التحديد%", kpis.markingRate?.toFixed(2) ?? ""],
    ["جودة عالية", kpis.highQualityCount],
    ["جودة متوسطة", kpis.mediumQualityCount],
    ["جودة منخفضة", kpis.lowQualityCount],
    ["الجودة المقبولة%", kpis.acceptableQualityRate?.toFixed(2) ?? ""],
  ];

  // Sheet 2: Port profiles
  const portSheet = [
    ["المنفذ", "المجتمع", "سليمة", "اشتباه", "نسبة الاشتباه%", "العينة", "التغطية%",
      "مدروسة", "إنجاز%", "دقة%", "اكتشاف الاشتباه%", "اشتباه فائت%",
      "دقة م.أول%", "دقة م.ثاني%", "التصنيف"],
    ...kpis.portProfiles.map((p) => [
      p.portName,
      p.population,
      p.clean,
      p.suspicious,
      p.suspicionRate?.toFixed(2) ?? "",
      p.sampleSize,
      p.coverage?.toFixed(2) ?? "",
      p.studied,
      p.completionRate?.toFixed(2) ?? "",
      p.accuracy?.toFixed(2) ?? "",
      p.suspiciousDetectionRate?.toFixed(2) ?? "",
      p.missedSuspicionRate?.toFixed(2) ?? "",
      p.levelOneAccuracy?.toFixed(2) ?? "",
      p.levelTwoAccuracy?.toFixed(2) ?? "",
      p.status,
    ]),
  ];

  // Sheet 3: Stage profiles
  const stageSheet = [
    ["المرحلة", "المجتمع", "العينة", "التغطية%", "مدروسة", "إنجاز%"],
    ...kpis.stageProfiles.map((s) => [
      s.stageLabel,
      s.population,
      s.sampleSize,
      s.coverage?.toFixed(2) ?? "",
      s.studied,
      s.completionRate?.toFixed(2) ?? "",
    ]),
  ];

  // Sheet 4: Image quality
  const imageQualitySheet = [
    ["المؤشر", "القيمة"],
    ["إجابات مكتملة", kpis.imagesWithSubmittedAnswers],
    ["صور متاحة", kpis.imageAvailableCount],
    ["صور غير متاحة", kpis.imageMissingCount],
    ["توفر الصور%", kpis.imageAvailabilityRate?.toFixed(2) ?? ""],
    ["يوجد تحديد", kpis.markingPresentCount],
    ["لا يوجد تحديد", kpis.markingMissingCount],
    ["نسبة التحديد%", kpis.markingRate?.toFixed(2) ?? ""],
    ["جودة عالية", kpis.highQualityCount],
    ["جودة متوسطة", kpis.mediumQualityCount],
    ["جودة منخفضة", kpis.lowQualityCount],
    ["الجودة المقبولة%", kpis.acceptableQualityRate?.toFixed(2) ?? ""],
    [],
    ["أسباب عدم وجود الصورة", "العدد", "النسبة%"],
    ...kpis.missingImageReasons.map((item) => [item.reason, item.count, item.percentage.toFixed(2)]),
    [],
    ["أسباب انخفاض الجودة", "العدد", "النسبة%"],
    ...kpis.lowQualityReasons.map((item) => [item.reason, item.count, item.percentage.toFixed(2)]),
  ];

  // Sheet 5: Result quality
  const resultQualitySheet = [
    ["المؤشر", "القيمة"],
    ["دقة نتيجة الصورة%", kpis.overallAccuracy?.toFixed(2) ?? ""],
    ["قوة اكتشاف الاشتباه%", kpis.suspiciousDetectionRate?.toFixed(2) ?? ""],
    ["اشتباه فائت%", kpis.missedSuspicionRate?.toFixed(2) ?? ""],
    ["دقة الاشتباه%", kpis.suspicionPrecision?.toFixed(2) ?? ""],
    ["اشتباه مكتشف", kpis.correctSuspicious],
    ["سليمة مؤكدة", kpis.correctClean],
    ["اشتباه فائت", kpis.missedSuspicious],
    ["اشتباه زائد", kpis.excessSuspicious],
  ];

  // Sheet 6: All individual image rows
  const rowSheet = [
    [
      "رقم الأشعة", "المنفذ", "المرحلة", "م.أول", "م.ثاني", "نتيجة الصورة",
      "في العينة", "الموظف", "حالة التوزيع", "نتيجة الخبير", "حالة الإجابة",
      "هل يوجد صورة", "سبب عدم وجود الصورة", "هل يوجد تحديد", "مستوى جودة الصورة",
      "سبب انخفاض الجودة", "تقييم الاشتباه", "الأصناف المشبوهة", "آلية التهريب المحتملة",
      "تاريخ التعيين", "تاريخ التسليم",
      "دقيق", "م.أول دقيق", "م.ثاني دقيق", "تصنيف التحقق",
    ],
    ...execRows.map((r) => [
      r.xrayImageId,
      r.portName ?? "",
      r.stage ?? "",
      r.levelOneResult,
      r.levelTwoResult,
      r.imageResult,
      r.selectedInSample ? "نعم" : "لا",
      r.assignedTo ?? "",
      r.distributionStatus ?? "",
      r.expertResult ?? "",
      r.answerStatus ?? "",
      r.imageAvailable === null ? "" : r.imageAvailable ? "نعم" : "لا",
      r.noImageReason ?? "",
      r.hasMarking === null ? "" : r.hasMarking ? "نعم" : "لا",
      r.imageQuality ?? "",
      r.lowQualityReason ?? "",
      r.suspicionLevel ?? "",
      r.suspectedTypes ?? "",
      r.smuggleMethod ?? "",
      r.assignedAt ?? "",
      r.submittedAt ?? "",
      r.imageResultAccurate === null ? "" : r.imageResultAccurate ? "نعم" : "لا",
      r.levelOneAccurate === null ? "" : r.levelOneAccurate ? "نعم" : "لا",
      r.levelTwoAccurate === null ? "" : r.levelTwoAccurate ? "نعم" : "لا",
      r.verificationCategory ?? "",
    ]),
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(kpiSheet), "الملخص التنفيذي");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(portSheet), "المنافذ والعينة");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(stageSheet), "مستويات الدراسة");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(imageQualitySheet), "جودة الصور");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resultQualitySheet), "نتائج الفحص");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rowSheet), "بيانات الصور");

  XLSX.writeFile(wb, `التقرير_التنفيذي_${input.monthFolderName}.xlsx`);
}

