import type { MappedWorkbookRow, MappingReport } from "../data/workbookImport/workbookColumnMap";

export type ComprehensiveWorkerRequest = { file: File };

export type ComprehensiveWorkerMessage =
  | { type: "progress"; sheet: string; done: number; total: number }
  | { type: "done"; rows: MappedWorkbookRow[]; report: MappingReport }
  | { type: "error"; code: string; message: string };
