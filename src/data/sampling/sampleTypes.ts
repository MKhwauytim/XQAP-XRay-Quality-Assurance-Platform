import type { PreparedPopulationRow } from "../population/populationTypes";
import type { StageAliasMappings } from "../population/populationConfig";

export type SampleConfig = {
  totalSampleSize: number;
  rngSeed: string;
  stageMappings?: StageAliasMappings;
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

export type StageAllocation = {
  stageKey: "first" | "second" | "third" | "fourth";
  stageLabel: string;
  populationSize: number;
  targetQuota: number;
  actualDrawn: number;
  certScanDrawn: number;
  nonCertScanDrawn: number;
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
  stageAllocations: StageAllocation[];
  drawnAt: string;
  drawnBy: string;
  /** Monotonically increasing counter — incremented on each row append. Used for CAS conflict detection. */
  revision?: number;
  /** Per-write UUID embedded by casLoop for cross-machine race detection. */
  _writeToken?: string;
  rows: PreparedPopulationRow[];
};

export type SampleDrawResult =
  | { ok: true; data: SampleMasterData }
  | { ok: false; reason: string };
