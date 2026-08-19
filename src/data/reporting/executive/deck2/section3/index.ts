// Executive deck v2 — القسم 3: التحاليل المتقدمة.
//
// This file is the section's ONLY assembly point, and it is deliberately tiny.
//
// Contract for adding a page (one import line, one array entry — nothing else):
//   1. Put the page in its own module in this folder (e.g. `./p3PortMatrix`),
//      exporting a builder factory `(model, variantPreview) => SlideBuilder[]`
//      (or a single `SlideBuilder` for a one-page module).
//   2. Add ONE `import` line below.
//   3. Add ONE entry to the returned array below.
// Nothing else in the deck needs to change: `buildDeckV2Slides` already calls
// `sectionThreeBuilders`, counts its length into the deck total, derives the
// section's page range for the المحتويات slide, and renders it between
// section 2 and the closing slide.
//
// The array ORDER is the slide order. The intended order is the section
// separator first, then P1..P5 — so each page agent appends its entry at the
// position matching its page number, keeping the merge of five parallel edits
// to one non-overlapping line each.
//
// An empty array is a valid, fully supported state: the section then
// contributes zero pages, zero TOC rows, and zero page numbers — the deck
// renders exactly as it did before the section existed.

import type { ReportModel } from "../../model/reportModel";
import type { SlideBuilder } from "../slideKit";
import { sectionSeparatorSlide } from "../slides";
import { WORKLOAD_ACCURACY_CSS, workloadAccuracySlideBuilders } from "./workloadAccuracy";
import { DAILY_TREND_CSS, dailyTrendSlide } from "./dailyTrend";
import { OUTCOME_MATRIX_CSS, outcomeMatrixSlideBuilders } from "./outcomeMatrix";
import { LEVEL_ACCURACY_CSS, levelAccuracySlideBuilders } from "./levelAccuracy";
import { SOURCE_AGREEMENT_CSS, sourceAgreementSlide } from "./sourceAgreement";
import { PORT_AGREEMENT_CSS, portAgreementSlideBuilders } from "./portAgreement";
import { MARKING_IMPACT_CSS, markingImpactSlide } from "./markingImpact";
import { QUALITY_IMPACT_CSS, qualityImpactSlide } from "./qualityImpact";

/**
 * Every page's own CSS, concatenated once. Each page module owns its rules and
 * scopes them under its own class prefix, so the order of concatenation here is
 * not load-bearing — that was the point of having six agents build six pages in
 * six files without touching the shared theme.
 * Appended after DECK_V2_CSS in deck2/index.ts so page rules can still override
 * the theme's shared component defaults where a page deliberately needs to.
 */
export const SECTION_THREE_CSS = [
  WORKLOAD_ACCURACY_CSS,
  DAILY_TREND_CSS,
  OUTCOME_MATRIX_CSS,
  LEVEL_ACCURACY_CSS,
  SOURCE_AGREEMENT_CSS,
  PORT_AGREEMENT_CSS,
  MARKING_IMPACT_CSS,
  QUALITY_IMPACT_CSS,
].join("\n");

export function sectionThreeBuilders(model: ReportModel, variantPreview: boolean): SlideBuilder[] {
  return [
    (num, total) =>
      sectionSeparatorSlide({
        sectionNo: 3,
        sectionKey: "section3",
        iconName: "chart",
        title: "التحاليل المتقدمة",
        blurb:
          "قراءة أعمق للأرقام: علاقة حجم العمل بالدقة، ودقة كل مستوى فحص، وتوافق النتائج بين المصادر، وأثر التحديد وجودة الصورة على الدقة.",
        tone: "gold",
        seedBase: model.summary.monthFolderName,
        num,
        total,
        variantPreview,
      }),
    ...workloadAccuracySlideBuilders(model, variantPreview),
    (num, total) => dailyTrendSlide(model, num, total, variantPreview),
    ...outcomeMatrixSlideBuilders(model, variantPreview),
    ...levelAccuracySlideBuilders(model, variantPreview),
    (num, total) => sourceAgreementSlide(model, num, total, variantPreview),
    ...portAgreementSlideBuilders(model, variantPreview),
    (num, total) => markingImpactSlide(model, num, total, variantPreview),
    (num, total) => qualityImpactSlide(model, num, total, variantPreview),
  ];
}
