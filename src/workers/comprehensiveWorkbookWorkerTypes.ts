import type { PopulationSummary } from "../data/reporting/executiveReportTypes";
import type { MappedWorkbookRow, MappingReport } from "../data/workbookImport/workbookColumnMap";

/** `files`: the examined-sample workbook, optionally with the follow-up workbook (told apart by sheet names). */
export type ComprehensiveWorkerRequest = { files: File[]; /** Reject unless the follow-up workbook is among `files`. */ requireFollowUp?: boolean };

export type ComprehensiveWorkerMessage =
  | { type: "progress"; sheet: string; done: number; total: number }
  | { type: "done"; rows: MappedWorkbookRow[]; report: MappingReport; populationSummary?: PopulationSummary | null }
  | { type: "error"; code: string; message: string };
