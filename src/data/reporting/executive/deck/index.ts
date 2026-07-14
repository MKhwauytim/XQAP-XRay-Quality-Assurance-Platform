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

const ARABIC_MONTHS = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];

function formatMonthLabel(folderName: string): string {
  const m = /^(\d{1,2})-[A-Za-z]+-(\d{4})$/.exec(folderName.trim());
  if (!m) return folderName;
  const name = ARABIC_MONTHS[Number(m[1]) - 1];
  return name ? `${name} ${m[2]}` : folderName;
}

export function buildExecutiveDeck(
  input: ExecutiveReportInput,
  employeeDisplayNames: Record<string, string> = {},
): string {
  const model = buildReportModel(input, employeeDisplayNames);
  const slides = buildDeckSlides(model);
  return buildDeckHtml(
    slides,
    formatMonthLabel(input.monthFolderName),
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
