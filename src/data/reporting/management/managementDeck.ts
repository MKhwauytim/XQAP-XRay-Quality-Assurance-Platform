// Management presentation (عرض الإدارة) — R3 restructure (2026-08-07). Renders
// the SAME progress/accountability `ManagementModel` as the management
// Document and Workbook (see `managementModel.ts`): per-employee completion
// progress grouped section 1 per stage/level, section 2 per port; replacement
// counts with reasons; reassignment counts. Previously reused the accuracy
// -shaped executive `ReportModel` — full model swap, not a bolt-on.
//
// SECURITY: all interpolated model/user values route through the deck
// `slide()` helper (which escapes) or the hardened `esc` primitive for the
// bespoke title slide. Part of the Wave 3 XSS test set.

import type { DistributionCurrentData } from "../../distribution/distributionTypes";
import { esc, fmtNum, fmtPct } from "../executive/primitives";
import { slide, kpiTile, kpiBand, miniTable, numberedList } from "../executive/deck/shared";
import { icon } from "../executive/ui/icons";
import { buildDeckViewer, formatMonthLabel } from "../shared/reportChrome";
import { openReportWindow, writeOrCloseOnFailure } from "../htmlReport";
import { sourceRevisionsFooterHtml } from "../sourceRevisions";
import type { ExecutiveReportInput } from "../executiveReportTypes";
import { yieldToMain } from "../../storage/yieldToMain";
import { computeManagementModel, type ManagementModel, type ManagementBucket } from "./managementModel";

function titleSlide(m: ManagementModel): string {
  return `<section class="slide title-slide" id="m-deck-title" data-title="الغلاف">
  <div class="slide-art"></div>
  <div class="slide-inner">
    <div class="title-mark">${icon("shield", 64)}</div>
    <div class="title-kicker">عرض الإدارة</div>
    <h1>متابعة الإنجاز والمساءلة</h1>
    <div class="title-sub">${esc(m.monthLabel)}</div>
    <div class="title-rule"></div>
    <div class="title-meta">تم التوليد ${esc(m.derivedAt)}</div>
  </div>
</section>`;
}

function bucketMiniTable(buckets: ManagementBucket[]): string {
  return miniTable({
    headers: ["المستوى/المنفذ", "المعيّنة", "المكتملة", "الإنجاز"],
    rows: buckets.slice(0, 8).map((b) => [b.label, fmtNum(b.totalAssigned), fmtNum(b.totalCompleted), fmtPct(b.completionRate)]),
  });
}

function emptyBody(title: string, detail: string): string {
  return `<div class="deck-empty"><span class="deck-empty-icon">${icon("alert", 36)}</span><b>${esc(title)}</b><span>${esc(detail)}</span></div>`;
}

async function managementDeckSlides(m: ManagementModel): Promise<string> {
  const slides: string[] = [];
  const total = 5;
  slides.push(titleSlide(m));
  await yieldToMain();

  // 1 — headline KPIs.
  slides.push(slide({
    id: "m-deck-kpi", title: "المؤشرات الرئيسية", num: 1, total,
    eyebrow: "لوحة الإدارة", iconName: "gauge",
    headline: "المؤشرات التشغيلية الرئيسية",
    body: kpiBand([
      kpiTile({ label: "المعيّنة", value: fmtNum(m.totals.assigned), tone: "slate" }),
      kpiTile({ label: "مكتملة", value: fmtNum(m.totals.completed), sub: fmtPct(m.totals.completionRate), tone: "green" }),
      kpiTile({ label: "طلبات استبدال", value: fmtNum(m.totals.requested), tone: "coral" }),
      kpiTile({ label: "مستبدلة", value: fmtNum(m.totals.replaced), tone: "purple" }),
    ]),
    decision: "يحدد ما إذا كان الإيقاع الحالي يفي بالموعد النهائي الشهري.",
  }));
  await yieldToMain();

  // 2 — section 1: per stage/level (R3, same ordering as R2).
  slides.push(slide({
    id: "m-deck-stage", title: "القسم 1 — حسب المستوى", num: 2, total,
    eyebrow: "القسم 1", iconName: "layers",
    headline: "تقدّم الإنجاز حسب المستوى",
    body: m.byStage.length === 0
      ? emptyBody("لا توجد بيانات", "لم تُوزَّع أي صور بعد.")
      : bucketMiniTable(m.byStage),
    decision: "يوضح تقدّم كل مستوى على حدة ومساهمة كل موظف فيه.",
  }));
  await yieldToMain();

  // 3 — section 2: per port.
  slides.push(slide({
    id: "m-deck-port", title: "القسم 2 — حسب المنفذ", num: 3, total,
    eyebrow: "القسم 2", iconName: "port",
    headline: "تقدّم الإنجاز حسب المنفذ",
    body: m.byPort.length === 0
      ? emptyBody("لا توجد بيانات", "لم تُوزَّع أي صور بعد.")
      : bucketMiniTable(m.byPort),
    decision: "يبرز المنافذ الأعلى حملاً ومدى تقدّم الإنجاز فيها.",
  }));
  await yieldToMain();

  // 4 — replacement / reassignment activity, with reasons.
  const reasonItems = m.replacements.byReason.slice(0, 6).map((r) => `${r.reason} — ${fmtNum(r.count)}`);
  slides.push(slide({
    id: "m-deck-replacements", title: "الاستبدال وإعادة التعيين", num: 4, total,
    eyebrow: "المساءلة", iconName: "flag",
    headline: "نشاط الاستبدال وإعادة التعيين",
    body: kpiBand([
      kpiTile({ label: "صور مستبدلة", value: fmtNum(m.replacements.total), tone: "coral" }),
      kpiTile({ label: "إعادة تعيين", value: fmtNum(m.reassignments.total), tone: "purple" }),
    ]) + (reasonItems.length > 0
      ? numberedList(reasonItems)
      : `<p class="deck-note">لا توجد أسباب استبدال مسجَّلة لهذا الشهر.</p>`),
    decision: "يوجّه قرارات إعادة التوزيع ومعالجة أسباب الاستبدال المتكرر.",
  }));
  await yieldToMain();

  // 5 — actions summary (derived directly, no bolted-on accuracy narrative).
  slides.push(slide({
    id: "m-deck-summary", title: "الملخص", num: 5, total,
    eyebrow: "القرار", iconName: "check",
    headline: "ملخص الإنجاز والمساءلة",
    body: numberedList([
      `أُنجز ${fmtPct(m.totals.completionRate)} من إجمالي ${fmtNum(m.totals.assigned)} صورة معيّنة.`,
      `${fmtNum(m.totals.requested)} طلب استبدال قيد المراجعة، و${fmtNum(m.replacements.total)} صورة استُبدلت فعلياً.`,
      `${fmtNum(m.reassignments.total)} عملية إعادة تعيين سُجِّلت هذا الشهر.`,
    ]),
    decision: "يترجم النتائج إلى إجراءات إدارية قابلة للتنفيذ.",
  }));

  return slides.join("\n");
}

export async function buildManagementDeck(
  input: ExecutiveReportInput,
  employeeDisplayNames: Record<string, string> = {},
): Promise<string> {
  const empty: DistributionCurrentData = {
    monthFolderName: input.monthFolderName, derivedAt: "—",
    totalAssigned: 0, totalCompleted: 0, totalReplaced: 0, totalPending: 0, entries: [],
  };
  const m = computeManagementModel(
    input.distribution ?? empty,
    input.monthFolderName,
    employeeDisplayNames,
    input.distributionEvents ?? [],
    input.replacementReasons ?? {},
  );
  const monthLabel = formatMonthLabel(input.monthFolderName);
  return buildDeckViewer({
    slides: await managementDeckSlides(m),
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
