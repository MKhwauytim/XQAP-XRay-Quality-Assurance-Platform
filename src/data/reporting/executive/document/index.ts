// The Document orchestrator (design §5). Drives the full A4-portrait page set from
// a single ReportModel, assigning sequential page numbers (per-port pages are
// dynamic). No per-page recomputation; no runtime scaling; no emoji.

import type { ReportModel } from "../model/reportModel";
import { divider } from "./dividers";
import { buildCover, buildGlossary, buildToc, type TocPart } from "./frontMatter";
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

/**
 * Build every Document page in order, returning the joined HTML slides.
 *
 * The front-matter TOC (page 2) is rendered from the SAME page-numbering pass as the
 * real content — never hand-typed literals — so it always matches reality, including
 * the per-port page count, which is dynamic (one page per non-empty port).
 */
export function buildDocumentSlides(model: ReportModel, issueDate: string): string {
  const pages: string[] = [];
  const toc: TocPart[] = [
    { title: "الجزء الأول: النطاق والمنهجية", blurb: "ما حجم المجتمع، وكيف اخترنا العينة منه؟", pages: [] },
    { title: "الجزء الثاني: جودة الفحص", blurb: "هل قرارات المستوى الأول والثاني دقيقة أمنيًا؟", pages: [] },
    { title: "الجزء الثالث: التطابق", blurb: "هل تتفق الفرق الأخرى مع أحكام المستويين؟", pages: [] },
    { title: "الجزء الرابع: المساءلة", blurb: "من الأدق بين المفتشين، ومن يحتاج دعمًا؟", pages: [] },
    { title: "الجزء الخامس: المخاطر والإجراءات", blurb: "ما الأولويات، وما الإجراء المطلوب من الإدارة؟", pages: [] },
  ];
  const [tocPart1, tocPart2, tocPart3, tocPart4, tocPart5] = toc;

  // ── Front matter — TOC content is filled in at the end once real numbers are known ──
  pages.push(buildCover(model, issueDate));
  const tocSlot = pages.push("") - 1;
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
  pages.push(buildPopulationGlance(model, pad(n))); tocPart1!.pages.push({ n: pad(n), t: "مجتمع الحالات في لمحة" }); n += 1;
  pages.push(buildPopulationByPort(model, pad(n))); tocPart1!.pages.push({ n: pad(n), t: "المجتمع حسب المنفذ" }); n += 1;
  pages.push(buildPopulationByStage(model, pad(n))); tocPart1!.pages.push({ n: pad(n), t: "المجتمع حسب المستوى" }); n += 1;
  pages.push(buildSampleCompletion(model, pad(n))); tocPart1!.pages.push({ n: pad(n), t: "العينة والإنجاز" }); n += 1;
  pages.push(buildDataQualityExclusions(model, pad(n))); tocPart1!.pages.push({ n: pad(n), t: "جودة البيانات والاستبعادات" }); n += 1;

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
  pages.push(buildAccuracyHeadline(model, pad(n))); tocPart2!.pages.push({ n: pad(n), t: "الدقة والكشف" }); n += 1;
  pages.push(buildAccuracyByPort(model, pad(n))); tocPart2!.pages.push({ n: pad(n), t: "الدقة حسب المنفذ" }); n += 1;
  pages.push(buildLevelComparison(model, pad(n))); tocPart2!.pages.push({ n: pad(n), t: "المستوى الأول مقابل الثاني" }); n += 1;
  pages.push(buildQualityImpact(model, pad(n))); tocPart2!.pages.push({ n: pad(n), t: "جودة الصورة والتحديد" }); n += 1;

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
  pages.push(buildReviewerAgreement(model, pad(n))); tocPart3!.pages.push({ n: pad(n), t: "كل فريق مقابل المراجع" }); n += 1;
  pages.push(buildAgreementMatrix(model, pad(n))); tocPart3!.pages.push({ n: pad(n), t: "مصفوفة التطابق الكاملة" }); n += 1;

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
  pages.push(buildEmployeeOverview(model, pad(n))); tocPart4!.pages.push({ n: pad(n), t: "النظرة العامة للمفتشين" }); n += 1;
  pages.push(buildAccuracyByDecision(model, pad(n))); tocPart4!.pages.push({ n: pad(n), t: "الدقة حسب نوع القرار" }); n += 1;
  const perPortStart = n;
  const perPort = buildPerPortPages(model, n);
  pages.push(...perPort.html);
  n = perPort.nextPageNo;
  const perPortEnd = n - 1;
  if (perPort.html.length > 0) {
    const range = perPortEnd > perPortStart ? `${pad(perPortStart)}–${pad(perPortEnd)}` : pad(perPortStart);
    tocPart4!.pages.push({ n: range, t: `صفحة لكل منفذ (${perPort.html.length} منافذ)` });
  }
  pages.push(buildPortComparison(model, pad(n))); tocPart4!.pages.push({ n: pad(n), t: "مقارنة المنافذ" }); n += 1;

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
  pages.push(buildErrorAnalysis(model, pad(n))); tocPart5!.pages.push({ n: pad(n), t: "تحليل أنواع الأخطاء" }); n += 1;
  pages.push(buildPriorityActions(model, pad(n))); tocPart5!.pages.push({ n: pad(n), t: "الأولويات والإجراءات" }); n += 1;
  pages.push(buildExclusions(model, pad(n))); tocPart5!.pages.push({ n: pad(n), t: "الاستبعادات" }); n += 1;
  pages.push(buildAppendix(model, pad(n))); tocPart5!.pages.push({ n: pad(n), t: "المنهجية والملاحق" });

  pages[tocSlot] = buildToc(toc);

  return pages.join("\n");
}
