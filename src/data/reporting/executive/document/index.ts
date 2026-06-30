// The Document orchestrator (design §5). Drives the full A4-portrait page set from
// a single ReportModel, assigning sequential page numbers (per-port pages are
// dynamic). No per-page recomputation; no runtime scaling; no emoji.

import type { ReportModel } from "../model/reportModel";
import { divider } from "./dividers";
import { buildCover, buildGlossary, buildToc } from "./frontMatter";
import {
  buildDataQualityExclusions,
  buildPopulationByPort,
  buildPopulationByStage,
  buildPopulationGlance,
  buildSampleCompletion,
} from "./partScope";
import {
  buildAccuracyByPort,
  buildAccuracyHeadline,
  buildLevelComparison,
  buildQualityImpact,
} from "./partQuality";
import { buildAgreementMatrix, buildReviewerAgreement } from "./partCorroboration";
import {
  buildAccuracyByDecision,
  buildEmployeeOverview,
  buildPerPortPages,
  buildPortComparison,
} from "./partAccountability";
import {
  buildAppendix,
  buildErrorAnalysis,
  buildExclusions,
  buildPriorityActions,
} from "./partRisk";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Build every Document page in order, returning the joined HTML slides. */
export function buildDocumentSlides(model: ReportModel, issueDate: string): string {
  const pages: string[] = [];

  // ── Front matter (cover/TOC/glossary carry their own fixed numbers 01–03) ──
  pages.push(buildCover(model, issueDate));
  pages.push(
    buildToc([
      { n: "1", title: "الجزء الأول: النطاق والمنهجية", pages: [
        { n: "05", t: "مجتمع الحالات في لمحة" },
        { n: "06", t: "المجتمع حسب المنفذ" },
        { n: "07", t: "المجتمع حسب المستوى" },
        { n: "08", t: "العينة والإنجاز" },
        { n: "09", t: "جودة البيانات والاستبعادات" },
      ] },
      { n: "2", title: "الجزء الثاني: جودة الفحص", pages: [
        { n: "11", t: "الدقة والكشف" },
        { n: "12", t: "الدقة حسب المنفذ" },
        { n: "13", t: "المستوى الأول مقابل الثاني" },
        { n: "14", t: "جودة الصورة والتحديد" },
      ] },
      { n: "3", title: "الجزء الثالث: التطابق", pages: [
        { n: "16", t: "كل فريق مقابل المراجع" },
        { n: "17", t: "مصفوفة التطابق الكاملة" },
      ] },
      { n: "4 و 5", title: "المساءلة والمخاطر", pages: [
        { n: "19", t: "النظرة العامة للمفتشين" },
        { n: "20", t: "الدقة حسب نوع القرار" },
        { n: "+", t: "صفحة لكل منفذ" },
        { n: "—", t: "المخاطر والأولويات والملاحق" },
      ] },
    ]),
  );
  pages.push(buildGlossary(model));

  let n = 4;

  // ── Part 1 — Scope & Method ──
  pages.push(divider({
    id: "page-p1", dataTitle: "غلاف الجزء الأول", partLabel: "الجزء الأول", title: "النطاق والمنهجية",
    subtitle: "حجم المجتمع وتوزيعه، العينة والتغطية، وجودة البيانات.",
    iconName: "layers", pageNo: pad(n), dividerNum: "1",
    toc: [
      { n: pad(n + 1), t: "مجتمع الحالات في لمحة" },
      { n: pad(n + 2), t: "المجتمع حسب المنفذ" },
      { n: pad(n + 4), t: "العينة والإنجاز" },
    ],
  }));
  n += 1;
  pages.push(buildPopulationGlance(model, pad(n))); n += 1;
  pages.push(buildPopulationByPort(model, pad(n))); n += 1;
  pages.push(buildPopulationByStage(model, pad(n))); n += 1;
  pages.push(buildSampleCompletion(model, pad(n))); n += 1;
  pages.push(buildDataQualityExclusions(model, pad(n))); n += 1;

  // ── Part 2 — Inspection Quality ──
  pages.push(divider({
    id: "page-p2", dataTitle: "غلاف الجزء الثاني", partLabel: "الجزء الثاني", title: "جودة الفحص",
    subtitle: "حُكم دقة المستوى الأول والثاني بعدسة المخاطر الأمنية.",
    iconName: "gauge", pageNo: pad(n), dividerNum: "2",
    toc: [
      { n: pad(n + 1), t: "الدقة والكشف" },
      { n: pad(n + 2), t: "الدقة حسب المنفذ" },
      { n: pad(n + 3), t: "المستوى الأول مقابل الثاني" },
    ],
  }));
  n += 1;
  pages.push(buildAccuracyHeadline(model, pad(n))); n += 1;
  pages.push(buildAccuracyByPort(model, pad(n))); n += 1;
  pages.push(buildLevelComparison(model, pad(n))); n += 1;
  pages.push(buildQualityImpact(model, pad(n))); n += 1;

  // ── Part 3 — Corroboration ──
  pages.push(divider({
    id: "page-p3", dataTitle: "غلاف الجزء الثالث", partLabel: "الجزء الثالث", title: "التطابق",
    subtitle: "مقارنة قرارات المستويين بالمراجع وبالفرق الأخرى كدليل مساند.",
    iconName: "users", pageNo: pad(n), dividerNum: "3",
    toc: [
      { n: pad(n + 1), t: "كل فريق مقابل المراجع" },
      { n: pad(n + 2), t: "مصفوفة التطابق الكاملة" },
    ],
  }));
  n += 1;
  pages.push(buildReviewerAgreement(model, pad(n))); n += 1;
  pages.push(buildAgreementMatrix(model, pad(n))); n += 1;

  // ── Part 4 — Accountability ──
  pages.push(divider({
    id: "page-p4", dataTitle: "غلاف الجزء الرابع", partLabel: "الجزء الرابع", title: "المساءلة",
    subtitle: "دقة مفتشي المستوى الأول والثاني حسب الهوية والمنفذ.",
    iconName: "flag", pageNo: pad(n), dividerNum: "4",
    toc: [
      { n: pad(n + 1), t: "النظرة العامة للمفتشين" },
      { n: pad(n + 2), t: "الدقة حسب نوع القرار" },
      { n: pad(n + 3), t: "صفحة لكل منفذ" },
    ],
  }));
  n += 1;
  pages.push(buildEmployeeOverview(model, pad(n))); n += 1;
  pages.push(buildAccuracyByDecision(model, pad(n))); n += 1;
  const perPort = buildPerPortPages(model, n);
  pages.push(...perPort.html);
  n = perPort.nextPageNo;
  pages.push(buildPortComparison(model, pad(n))); n += 1;

  // ── Part 5 — Risk, Priorities & Actions + Exclusions + Appendix ──
  pages.push(divider({
    id: "page-p5", dataTitle: "غلاف الجزء الخامس", partLabel: "الجزء الخامس", title: "المخاطر والإجراءات",
    subtitle: "تركّز الأخطاء، أولويات المعالجة، والقيود المنهجية.",
    iconName: "alert", pageNo: pad(n), dividerNum: "5",
    toc: [
      { n: pad(n + 1), t: "تحليل أنواع الأخطاء" },
      { n: pad(n + 2), t: "الأولويات والإجراءات" },
      { n: pad(n + 4), t: "المنهجية والملاحق" },
    ],
  }));
  n += 1;
  pages.push(buildErrorAnalysis(model, pad(n))); n += 1;
  pages.push(buildPriorityActions(model, pad(n))); n += 1;
  pages.push(buildExclusions(model, pad(n))); n += 1;
  pages.push(buildAppendix(model, pad(n))); n += 1;

  return pages.join("\n");
}
