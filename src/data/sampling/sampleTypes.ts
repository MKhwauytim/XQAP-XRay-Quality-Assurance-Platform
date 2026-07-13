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

/**
 * Four-eyes sample-release record (A3). Optional and absent on legacy files —
 * a missing `approval` means "approved-by-legacy" so old months keep working.
 * Wave B gates the UI on this field; the data layer only stores it.
 */
export type SampleApproval = {
  approvedBy: string;
  approvedAt: string;
  role: string;
  note?: string;
};

export type SampleMasterData = {
  rngSeed: string;
  /**
   * Algorithm version bound to the seed (A2). Absent on legacy files. Any
   * semantic change to `drawSample` must bump `SAMPLING_ALGORITHM_VERSION` so a
   * historical draw can be recognised as non-replayable under the current code.
   */
  samplingAlgorithmVersion?: string;
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
  /** Four-eyes release approval (A3). Absent = approved-by-legacy. */
  approval?: SampleApproval;
  /** Monotonically increasing counter — incremented on each row append. Used for CAS conflict detection. */
  revision?: number;
  /** Per-write UUID embedded by casLoop for cross-machine race detection. */
  _writeToken?: string;
  rows: PreparedPopulationRow[];
};

export type SampleDrawResult =
  | { ok: true; data: SampleMasterData }
  | { ok: false; reason: string };
