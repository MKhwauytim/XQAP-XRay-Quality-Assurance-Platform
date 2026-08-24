import type { BiWorkbookResult, NormalizedBiRow } from "../components/Sidebar/Tabs/Population/biData/biDataTypes";
import type { NormalizedRiskRow } from "../components/Sidebar/Tabs/Population/riskData/riskDataTypes";
import type { BiFileShell, RiskWorkbookShell } from "./workbookResultStream";

export type WorkbookWorkerRequest = {
  riskFile: File;
  /**
   * Zero to ten BI files. They are DIFFERENT populations that share the same
   * sheet patterns and column mappings, so the worker loops the same
   * `processBiWorkbook` call over the array with identical settings and the
   * main thread appends the results into one BI population.
   */
  biFiles: File[];
  riskSheetPatterns?: string[];
  biSheetPatterns?: string[];
  columnMappings?: Record<string, string[]>;
  biColumnMappings?: Record<string, string[]>;
};

/**
 * One entry per requested BI file, index-aligned with `biFiles`.
 *
 * A BI file that throws is a SOFT failure — it produces `result: null` plus an
 * `error`, never a failed import — because the risk file is the only required
 * one. The per-file shape is what lets the UI show an error on the offending
 * row while the other files still contribute their rows.
 */
export type BiFileResult = {
  fileName: string;
  result: BiWorkbookResult | null;
  error?: string;
};

/**
 * The result is streamed, not posted whole.
 *
 * Posting `riskResult` + every `biResults[i].result` in ONE message asked
 * structured clone for a single contiguous allocation of the entire ingest
 * output -- rows plus their full `rawRow`s -- and a large month failed it with
 * `DataCloneError: Data cannot be cloned, out of memory` (XQ-POP-003).
 *
 * The sequence is now: `progress`* → `risk-rows`* → (`bi-rows`* per file)
 * → `done`. `done` is the single commit point and carries only the small
 * metadata shells; the window stitches the streamed rows back into them
 * (`createWorkbookResultAccumulator`), producing exactly the object graph a
 * single `done` used to carry. Nothing downstream of `applyBiFileResults` /
 * `setRiskWorkbookResult` can tell the difference.
 *
 * There is no `requestId` here, unlike `populationQueryWorkerTypes.ts` -- this
 * worker runs one job at a time and its listener is torn down per run, so a
 * stale chunk has no accumulator to land in.
 */
export type WorkbookWorkerResponse =
  | { type: "progress"; message: string }
  | { type: "risk-rows"; rows: NormalizedRiskRow[] }
  /** `fileIndex` is index-aligned with `WorkbookWorkerRequest.biFiles`. */
  | { type: "bi-rows"; fileIndex: number; rows: NormalizedBiRow[] }
  | { type: "done"; riskResult: RiskWorkbookShell; biResults: BiFileShell[]; warning?: string }
  | { type: "error"; error: string };
