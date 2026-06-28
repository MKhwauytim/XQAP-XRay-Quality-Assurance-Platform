export type ExportFileResult = {
  fileName: string;
  rowCount: number;
};

export type ExportManifest = {
  month: string;
  exportedAt: string;
  files: ExportFileResult[];
};
