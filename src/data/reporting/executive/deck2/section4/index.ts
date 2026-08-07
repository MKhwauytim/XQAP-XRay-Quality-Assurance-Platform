// Executive deck v2 — القسم 4: التغطية والمساءلة التشغيلية.
//
// R4/R5-for-decks parity task (2026-08-08). The executive DOCUMENT edition
// already shipped R4 (Part 6: coverage + accountability, reusing
// `computeDistributionModel`/`computeManagementModel` verbatim — see
// `document/partCoverageAccountability.ts`) and R5 (a per-employee row
// listing straight from `model.factTable` — see `document/partEmployeeRows.ts`).
// This section brings the DECK up to R4 parity with two pages, `coverage.ts`
// and `accountability.ts`, each reusing the SAME model fields the document
// edition reads (`model.distributionCoverage`/`model.accountabilityProgress`)
// — never a third independent fold of the underlying distribution/management
// data. Section/page decomposition follows this file's own established
// contract (see `../section3/index.ts`'s doc comment for the pattern this
// mirrors): this file is the section's only assembly point, deliberately
// tiny, and adding a page here needs one import + one array entry.
//
// ── R5-for-decks: DELIBERATELY NOT PORTED ───────────────────────────────────
// The document's R5 page (`partEmployeeRows.ts`) lists every fact-table row —
// up to ~2× the population's image count (one record per decision level),
// paginated across as many document pages as it takes. A deck slide is a
// fixed 630px box (`deckTheme.ts`'s `.slide{height:630px;overflow:hidden}`);
// there is no honest way to fit an unbounded row-level listing into that
// shape without either (a) silently clipping past the box, defeating the
// purpose of a "listing", or (b) spawning a deck page per employee per
// dozen-or-so rows — which is not a presentation any more, it's the document
// re-paginated with slide chrome around it. A presentation medium's job is to
// SUMMARIZE for a room, not enumerate every decision — that's what the
// document edition (and the distribution/management Excel exports) are for.
// This section's `coverage.ts`/`accountability.ts` pages are this section's
// deck-appropriate analogue of R5's "who did what" intent: each bucket names
// its top contributing employee (coverage) and every employee's aggregated
// progress is listed by name (accountability) — named, ranked summaries
// bounded by employee/bucket COUNT (naturally small — organization headcount
// and port count, not image count), never by raw row count. Anyone who needs
// the full per-image, per-employee breakdown opens the document edition,
// which already has it.

import type { ReportModel } from "../../model/reportModel";
import type { SlideBuilder } from "../slideKit";
import { sectionSeparatorSlide } from "../slides";
import { COVERAGE_CSS, coverageSlideBuilders } from "./coverage";
import { ACCOUNTABILITY_CSS, accountabilitySlideBuilders } from "./accountability";

/** Every page's own CSS, concatenated once — same convention as
 *  `section3/index.ts`'s `SECTION_THREE_CSS`. Appended after `DECK_V2_CSS`
 *  (and after `SECTION_THREE_CSS`) in `deck2/index.ts`. */
export const SECTION_FOUR_CSS = [COVERAGE_CSS, ACCOUNTABILITY_CSS].join("\n");

export function sectionFourBuilders(model: ReportModel, variantPreview: boolean): SlideBuilder[] {
  return [
    (num, total) =>
      sectionSeparatorSlide({
        sectionNo: 4,
        sectionKey: "section4",
        iconName: "layers",
        title: "التغطية والمساءلة التشغيلية",
        blurb:
          "من وُزِّعت عليه العيّنة، وما مدى إنجازه: التغطية حسب المستوى والمنفذ، وتقدّم كل موظف، وأسباب الاستبدال، وعدد إعادة التعيين.",
        tone: "gold",
        seedBase: model.summary.monthFolderName,
        num,
        total,
        variantPreview,
      }),
    ...coverageSlideBuilders(model, variantPreview),
    ...accountabilitySlideBuilders(model, variantPreview),
  ];
}
