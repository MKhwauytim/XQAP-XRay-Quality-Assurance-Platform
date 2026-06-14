import type { PreparedPopulationRow } from "../../components/Sidebar/Tabs/Population/processing/populationProcessingTypes";

export type SampleConfig = {
  totalSampleSize: number;
  rngSeed: string;
};

export type PortAllocation = {
  portName: string;
  populationSize: number;
  certScanCount: number;
  nonCertScanCount: number;
  allocatedQuota: number;
  certScanQuota: number;
  nonCertScanQuota: number;
  actualCertScanDrawn: number;
  actualNonCertScanDrawn: number;
  actualTotalDrawn: number;
};

export type SampleMasterData = {
  rngSeed: string;
  totalRequested: number;
  totalActual: number;
  certScanRequested: number;
  nonCertScanRequested: number;
  certScanActual: number;
  nonCertScanActual: number;
  portAllocations: PortAllocation[];
  drawnAt: string;
  drawnBy: string;
  rows: PreparedPopulationRow[];
};

export type SampleDrawResult =
  | { ok: true; data: SampleMasterData }
  | { ok: false; reason: string };
