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
import { openReportWindow, writeOrCloseOnFailure } from "../htmlReport";
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

/**
 * Yields a turn to the main thread (P3-7). Same convention as
 * `sampleReport.ts`/`distributionReport.ts`/`Population/processing/populationProcessor.ts`
 * — a bare `setTimeout(resolve, 0)`, not a shared import (there isn't one;
 * every yielding module keeps its own copy).
 */
const yieldToMain = () => new Promise((resolve) => setTimeout(resolve, 0));

async function managementDeckSlides(m: ReportModel): Promise<string> {
  const slides: string[] = [];
  const total = 5;
  slides.push(titleSlide(m, formatMonthLabel(m.summary.monthFolderName)));
  await yieldToMain();

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
  await yieldToMain();

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
  await yieldToMain();

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
  await yieldToMain();

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
  await yieldToMain();

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

export async function buildManagementDeck(
  input: ExecutiveReportInput,
  employeeDisplayNames: Record<string, string> = {},
): Promise<string> {
  const model = buildReportModel(input, employeeDisplayNames);
  const monthLabel = formatMonthLabel(input.monthFolderName);
  return buildDeckViewer({
    slides: await managementDeckSlides(model),
    docTitle: `عرض الإدارة — ${monthLabel}`,
    brandTitle: "عرض الإدارة",
    brandSub: `ضمان جودة الأشعة — ${monthLabel}`,
    iconName: "shield",
    footerNote: sourceRevisionsFooterHtml(input.sourceRevisions, esc),
  });
}

/**
 * Opens the target tab synchronously (still inside the click's user gesture,
 * P3-7) BEFORE the now-chunked `buildManagementDeck` build runs, then writes
 * the finished HTML in once ready — same pattern as `openSampleReport`/
 * `openDistributionDocument` in sampleReport.ts/distributionReport.ts.
 * `writeOrCloseOnFailure` closes the already-opened tab instead of
 * abandoning it blank if the build throws (see its doc comment in
 * htmlReport.ts).
 */
export async function openManagementDeck(
  input: ExecutiveReportInput,
  employeeDisplayNames: Record<string, string> = {},
): Promise<void> {
  const reportWindow = openReportWindow();
  await writeOrCloseOnFailure(
    reportWindow,
    () => buildManagementDeck(input, employeeDisplayNames),
    `عرض_الإدارة_${input.monthFolderName}.html`,
  );
}
