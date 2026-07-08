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
