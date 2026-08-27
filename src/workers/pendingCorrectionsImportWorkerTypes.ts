/** Request/response contract for `pendingCorrectionsImportWorker.ts` — the
 *  off-main-thread XLSX parse for the معلقة (pending) corrections re-import
 *  (see `data/population/populationCorrections.ts`). Deliberately generic
 *  (header row + string-keyed records): the worker only turns a sheet into
 *  rows, the main thread owns every domain rule (which columns are known,
 *  which ids exist, what changed). */

export type PendingCorrectionsImportRequest = {
  file: File;
};

export type PendingCorrectionsImportRow = Record<string, string>;

export type PendingCorrectionsImportResponse =
  | { type: "progress"; message: string }
  | { type: "done"; headerRow: string[]; rows: PendingCorrectionsImportRow[] }
  | { type: "error"; error: string };
