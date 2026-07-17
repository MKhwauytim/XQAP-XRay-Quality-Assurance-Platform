// Executive Presentation (deck) entry points (design §6). Drives ~14 curated 16:9
// landscape slides from a single `ReportModel` (design §3.6) — the same analytical
// layer that powers the Document and Workbook, so the numbers can never disagree.
//
// REFERENCE EDITION (v1). As of 2026-07-14 the Reports tab exports deck2
// (../deck2) instead; this edition is kept for comparison and the dev preview
// (/deck-preview.html) only.
//   buildExecutiveDeck(input, employeeDisplayNames?) → string (self-contained HTML)
//   openExecutiveDeck(input, employeeDisplayNames?)  → void   (open/download)

import { buildReportModel } from "../model/reportModel";
import { buildDeckSlides } from "./slides";
import { buildDeckHtml } from "./viewer";
import { openOrDownload } from "../../htmlReport";
import { esc } from "../primitives";
import { sourceRevisionsFooterHtml } from "../../sourceRevisions";
import type { ExecutiveReportInput } from "../../executiveReportTypes";
import { formatMonthFolderShortLabel } from "../../../population/monthFolder";

export function buildExecutiveDeck(
  input: ExecutiveReportInput,
  employeeDisplayNames: Record<string, string> = {},
): string {
  const model = buildReportModel(input, employeeDisplayNames);
  const slides = buildDeckSlides(model);
  return buildDeckHtml(
    slides,
    formatMonthFolderShortLabel(input.monthFolderName),
    sourceRevisionsFooterHtml(input.sourceRevisions, esc),
  );
}

export function openExecutiveDeck(
  input: ExecutiveReportInput,
  employeeDisplayNames: Record<string, string> = {},
): void {
  openOrDownload(
    buildExecutiveDeck(input, employeeDisplayNames),
    `العرض_التنفيذي_${input.monthFolderName}.html`,
  );
}
