export type MonthManifestData = {
  monthFolderName: string;
  month: number;
  year: number;
  runnedAt: string;
  runnedBy: string;
  riskFileName: string | null;
  biFileName: string | null;
  certScanUsed: boolean;
  templateVersion: string | null;
  rngSeed: string | null;
  totalRawRows: number;
  totalProcessedRows: number;
  status: "raw-saved" | "processed-saved" | "sampled" | "distributed";
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
