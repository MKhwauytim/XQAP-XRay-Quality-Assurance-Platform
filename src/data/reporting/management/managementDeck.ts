// Management presentation (عرض الإدارة) — Wave 3. Adds the missing Deck output to
// the management report, driven by the SAME `ReportModel` as the management
// Document and executive editions (one model → many renderers). Management lens:
// operational accountability — completion, per-port & per-reviewer performance,
// referral/replacement activity, and the population → sample → studied funnel.
//
// SECURITY: all interpolated model/user values route through the deck `slide()`
// helper (which escapes) or the hardened `esc` primitive for the bespoke title
// slide. Part of the Wave 3 XSS test set.

import { buildReportModel } from "../executive/model/reportModel";
import type { ReportModel } from "../executive/model/reportModel";
import type { DataSufficiencyBand } from "../executive/model/dataSufficiency";
import { esc, fmtNum, fmtPct } from "../executive/primitives";
import { slide, split, heroNumber, heroChart, kpiTile, kpiBand, miniTable, numberedList } from "../executive/deck/shared";
import { donut, rankedBar } from "../executive/ui/charts";
import { icon } from "../executive/ui/icons";
import { buildDeckViewer, formatMonthLabel } from "../shared/reportChrome";
import { openOrDownload } from "../htmlReport";
import { sourceRevisionsFooterHtml } from "../sourceRevisions";
import type { ExecutiveReportInput } from "../executiveReportTypes";

const BAND_LABELS: Record<DataSufficiencyBand, string> = {
  sufficient: "بيانات كافية",
  limited: "بيانات محدودة",
  insufficient: "بيانات غير كافية",
  none: "لا توجد بيانات",
};

function titleSlide(m: ReportModel, monthLabel: string): string {
  return `<section class="slide title-slide" id="m-deck-title" data-title="الغلاف">
  <div class="slide-art"></div>
  <div class="slide-inner">
    <div class="title-mark">${icon("shield", 64)}</div>
    <div class="title-kicker">عرض الإدارة</div>
    <h1>مساءلة أداء ضمان جودة الأشعة</h1>
    <div class="title-sub">${esc(monthLabel)}</div>
    <div class="title-rule"></div>
    <div class="title-meta">الفترة ${esc(m.summary.periodId)} — ${esc(BAND_LABELS[m.dataQuality.overallBand])}</div>
  </div>
</section>`;
}

function managementDeckSlides(m: ReportModel): string {
  const slides: string[] = [];
  const total = 5;
  slides.push(titleSlide(m, formatMonthLabel(m.summary.monthFolderName)));

  const s = m.summary;

  // 1 — headline KPIs.
  slides.push(slide({
    id: "m-deck-kpi", title: "المؤشرات الرئيسية", num: 1, total,
    eyebrow: "لوحة الإدارة", iconName: "gauge",
    headline: "المؤشرات التشغيلية الرئيسية",
    subhead: BAND_LABELS[m.dataQuality.overallBand],
    body: kpiBand([
      kpiTile({ label: "دقة الفحص", value: fmtPct(s.overallAccuracy), tone: "gold" }),
      kpiTile({ label: "كشف الاشتباه", value: fmtPct(s.detectionRate), tone: "blue" }),
      kpiTile({ label: "الاشتباه الفائت", value: fmtPct(s.missedSuspicionRate), tone: "coral" }),
      kpiTile({ label: "الإنجاز", value: fmtPct(s.completionRate), tone: "green" }),
    ]),
    decision: "يحدد ما إذا كان الأداء ضمن المستهدفات أم يتطلب تدخلاً إدارياً.",
  }));

  // 2 — population → sample → studied funnel.
  slides.push(slide({
    id: "m-deck-funnel", title: "النطاق والتغطية", num: 2, total,
    eyebrow: "المقارنة", iconName: "layers",
    headline: "المجتمع مقابل العينة مقابل المدروس",
    body: split(
      kpiBand([
        kpiTile({ label: "المجتمع", value: fmtNum(m.population.total), tone: "slate" }),
        kpiTile({ label: "العينة", value: fmtNum(m.sample.total), sub: `${fmtPct(m.sample.coverage)} تغطية`, tone: "gold" }),
        kpiTile({ label: "المدروسة", value: fmtNum(m.sample.studied), sub: `${fmtPct(m.sample.completionRate)} إنجاز`, tone: "green" }),
      ]),
      heroChart(donut([
        { label: "مدروسة", value: m.sample.studied },
        { label: "متبقية", value: m.sample.remaining },
      ], { height: 300, emptyNote: "لا توجد بيانات" }), { height: 300, caption: "من العينة: مدروس مقابل متبقٍ" }),
      "even",
    ),
    decision: "يوضح مدى تمثيل العينة للمجتمع ونسبة ما أُنجز منها.",
  }));

  // 3 — port performance (worst accuracy first).
  const ports = [...m.portAccuracy]
    .filter((p) => p.accuracy !== null)
    .sort((a, b) => (a.accuracy ?? 0) - (b.accuracy ?? 0))
    .slice(0, 8);
  slides.push(slide({
    id: "m-deck-ports", title: "الأداء حسب المنفذ", num: 3, total,
    eyebrow: "المساءلة", iconName: "port",
    headline: "الدقة حسب المنفذ (الأدنى أولاً)",
    body: ports.length === 0
      ? emptyBody("لا توجد بيانات منافذ قابلة للتقييم", "لم تُسجَّل قرارات كافية لتقييم المنافذ هذه الفترة.")
      : split(
          miniTable({
            headers: ["المنفذ", "قابلة للتقييم", "الدقة", "الاشتباه الفائت"],
            rows: ports.map((p) => [p.key, fmtNum(p.evaluable), fmtPct(p.accuracy), fmtPct(p.missedSuspicionRate)]),
          }),
          heroChart(rankedBar(ports.map((p) => ({ label: p.key, value: Math.round(p.accuracy ?? 0) })), { height: 300, emptyNote: "لا توجد بيانات" }), { height: 300, caption: "الدقة٪ لكل منفذ" }),
          "wide-left",
        ),
    decision: "يوجّه الدعم نحو المنافذ الأدنى دقةً والأعلى اشتباهاً فائتاً.",
  }));

  // 4 — reviewer performance.
  const reviewers = m.employeeOverview.reviewerProfiles.slice(0, 8);
  slides.push(slide({
    id: "m-deck-reviewers", title: "أداء المراجعين", num: 4, total,
    eyebrow: "المساءلة", iconName: "users",
    headline: "أداء المراجعين والمقارنة بينهم",
    subhead: m.employeeOverview.inspectorIdentityMapped ? undefined : "هوية المفتش غير مرتبطة — تُعرض أعباء المراجعين فقط",
    body: reviewers.length === 0
      ? emptyBody("لا توجد بيانات مراجعين", "لم تُسجَّل مراجعات كافية لهذه الفترة.")
      : miniTable({
          headers: ["المراجع", "المدروسة", "الدقة", "الاشتباه الفائت", "الحالة"],
          rows: reviewers.map((p) => [
            m.employeeOverview.reviewerDisplayNames[p.username] ?? p.username,
            fmtNum(p.studied), fmtPct(p.overallAccuracy), fmtPct(p.missedSuspicionRate),
            p.reliable ? "موثوق" : "غير كافٍ",
          ]),
        }),
    decision: "يحدد المراجعين الموثوقين ومن يحتاج تدقيقاً إضافياً.",
  }));

  // 5 — actions.
  const actions = m.actions.filter((a) => a && a.trim().length > 0);
  slides.push(slide({
    id: "m-deck-actions", title: "الإجراءات", num: 5, total,
    eyebrow: "القرار", iconName: "flag",
    headline: "الأولويات والإجراءات المطلوبة",
    body: actions.length === 0
      ? heroNumber({ value: fmtPct(s.completionRate), caption: "لا توجد إجراءات ذات أولوية لهذه الفترة", tone: "green" })
      : numberedList(actions),
    decision: "يترجم النتائج إلى إجراءات إدارية قابلة للتنفيذ.",
  }));

  return slides.join("\n");
}

function emptyBody(title: string, detail: string): string {
  return `<div class="deck-empty"><span class="deck-empty-icon">${icon("alert", 36)}</span><b>${esc(title)}</b><span>${esc(detail)}</span></div>`;
}

export function buildManagementDeck(
  input: ExecutiveReportInput,
  employeeDisplayNames: Record<string, string> = {},
): string {
  const model = buildReportModel(input, employeeDisplayNames);
  const monthLabel = formatMonthLabel(input.monthFolderName);
  return buildDeckViewer({
    slides: managementDeckSlides(model),
    docTitle: `عرض الإدارة — ${monthLabel}`,
    brandTitle: "عرض الإدارة",
    brandSub: `ضمان جودة الأشعة — ${monthLabel}`,
    iconName: "shield",
    footerNote: sourceRevisionsFooterHtml(input.sourceRevisions, esc),
  });
}

export function openManagementDeck(
  input: ExecutiveReportInput,
  employeeDisplayNames: Record<string, string> = {},
): void {
  openOrDownload(buildManagementDeck(input, employeeDisplayNames), `عرض_الإدارة_${input.monthFolderName}.html`);
}
