import type { BiWorkbookResult } from "../components/Sidebar/Tabs/Population/biData/biDataTypes";
import type { RiskWorkbookResult } from "../components/Sidebar/Tabs/Population/riskData/riskDataTypes";

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

export type WorkbookWorkerResponse =
  | { type: "progress"; message: string }
  | { type: "done"; riskResult: RiskWorkbookResult; biResults: BiFileResult[]; warning?: string }
  | { type: "error"; error: string };
