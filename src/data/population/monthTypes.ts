import type { PopulationProcessingResult } from "./populationTypes";

export type MonthManifestData = {
  monthFolderName: string;
  month: number;
  year: number;
  processedAt: string;
  processedBy: string;
  /** @deprecated use processedAt */
  runnedAt?: string;
  /** @deprecated use processedBy */
  runnedBy?: string;
  riskFileName: string | null;
  biFileName: string | null;
  certScanUsed: boolean;
  templateVersion: string | null;
  rngSeed: string | null;
  totalRawRows: number;
  totalProcessedRows: number;
  status: "raw-saved" | "processed-saved" | "sampled" | "distributed" | "closed";
  /** Monotonically increasing counter for CAS conflict detection. */
  revision?: number;
  /** Per-write UUID embedded by casLoop for cross-machine race detection. */
  _writeToken?: string;
  /** Set when status === "closed". */
  closedAt?: string | null;
  closedBy?: string | null;
  closeNote?: string | null;
  /** Status held before closing — restored on reopen. */
  statusBeforeClose?: "raw-saved" | "processed-saved" | "sampled" | "distributed" | null;
  /** Last reopen, if any (history goes to the action log). */
  reopenedAt?: string | null;
  reopenedBy?: string | null;
  processingFingerprint?: string | null;
  processingSummaryFile?: string | null;
  sourceFiles?: {
    risk?: SourceFileMetadata | null;
    bi?: SourceFileMetadata | null;
  };
};

export type PopulationFinalData = {
  sourceMonthFolder: string;
  processedAt: string;
  processedBy: string;
  totalRows: number;
  certScanRows: number;
  nonCertScanRows: number;
  rows: Array<Record<string, unknown>>;
};

export type MonthRawData = {
  sourceFileName: string;
  importedAt: string;
  importedBy: string;
  /**
   * Immutable-raw-layer link (A5). When a re-import supersedes a previous raw
   * file, the prior file is archived to `{base}.{ISO-ts}.superseded.json` and
   * this records that archived file name. Absent on first import / legacy files.
   */
  supersedes?: string | null;
  rows: Array<Record<string, unknown>>;
};

export type SourceFileMetadata = {
  name: string;
  size: number;
  lastModified: number;
};

export type ProcessingSummaryData = Omit<PopulationProcessingResult, "preparedRows"> & {
  savedAt: string;
};
