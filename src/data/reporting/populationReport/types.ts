export type ResultCounts = { سليمة: number; اشتباه: number; total: number };

export type StageBucket = { stageKey: string; stageLabel: string; counts: ResultCounts };

export type PortBucket = { portName: string; counts: ResultCounts };

export type PortBreakdown = { land: PortBucket[]; sea: PortBucket[] };

export type EmployeeStageRow = {
  username: string;
  displayName: string;
  stages: Record<string, ResultCounts>;
  total: ResultCounts;
};

export type EmployeePortRow = {
  username: string;
  displayName: string;
  ports: { land: ResultCounts; sea: ResultCounts };
  total: ResultCounts;
};

export type EmployeeCertScanRow = {
  username: string;
  displayName: string;
  certScanCount: number;
  nonCertScanCount: number;
  total: number;
};

export type PopulationReportScope = "population" | "sample" | "both";
