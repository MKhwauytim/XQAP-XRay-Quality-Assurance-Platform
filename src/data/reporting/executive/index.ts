// Executive Document entry points. Keeps the public API the Reports tab calls
// (`buildExecutiveReport` / `openExecutiveReport`) while driving every page from a
// single `ReportModel` (design §3.6) through the new document/ renderer.
//
// The auto-scale (`fitPages` transform:scale) hack is gone (see viewer.ts), all
// emoji are replaced by ui/icons.ts SVGs, and long tables paginate explicitly
// (document/pagination.ts).

import { buildReportModel } from "./model/reportModel";
import { buildDocumentSlides } from "./document/index";
import { buildViewerHtml } from "./viewer";
import { openReportWindow, writeOrCloseOnFailure } from "../htmlReport";
import { esc } from "./primitives";
import { sourceRevisionsFooterHtml } from "../sourceRevisions";
import type { ExecutiveReportInput } from "../executiveReportTypes";
import { formatMonthFolderShortLabel } from "../../population/monthFolder";
import { formatIssueDate } from "../shared/reportChrome";

export async function buildExecutiveReport(
  input: ExecutiveReportInput,
  employeeDisplayNames: Record<string, string> = {},
): Promise<string> {
  const model = buildReportModel(input, employeeDisplayNames);
  const slides = await buildDocumentSlides(model, formatIssueDate());
  return buildViewerHtml(
    slides,
    formatMonthFolderShortLabel(input.monthFolderName),
    sourceRevisionsFooterHtml(input.sourceRevisions, esc),
  );
}

/**
 * Opens the target tab synchronously (still inside the click's user gesture,
 * P3-7) BEFORE the now-chunked `buildExecutiveReport` build runs, then writes
 * the finished HTML in once ready — same pattern as `openSampleReport`/
 * `openDistributionDocument`/`openManagementDeck`. `writeOrCloseOnFailure`
 * closes the already-opened tab instead of abandoning it blank if the build
 * throws (see its doc comment in htmlReport.ts).
 */
export async function openExecutiveReport(
  input: ExecutiveReportInput,
  employeeDisplayNames: Record<string, string> = {},
): Promise<void> {
  const reportWindow = openReportWindow();
  await writeOrCloseOnFailure(
    reportWindow,
    () => buildExecutiveReport(input, employeeDisplayNames),
    `التقرير_التنفيذي_${input.monthFolderName}.html`,
  );
}
