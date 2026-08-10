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
 * Detection-only record (owner decision, 2026-08): when a stratum cannot reach
 * its configured CertScan target because too few CertScan rows exist, the draw
 * under-fills rather than silently backfilling from NonCertscan rows — a silent
 * substitution would misrepresent the stratum composition of a sample that feeds
 * audit/statistical claims. This record makes that under-fill visible instead of
 * invisible: it never changes what gets drawn, it only reports the gap.
 *
 * `portName: null` marks a stage-wide shortfall detected before per-port
 * apportionment (an `exact` CertScan target that already exceeds the whole
 * stage's available CertScan pool). A non-null `portName` is a per-port
 * shortfall detected during that port's draw (the `percentage` method, whose
 * per-port request isn't known until the port's allocated quota is apportioned).
 */
export type CertScanShortfall = {
  stageKey: "first" | "second" | "third" | "fourth";
  stageLabel: string;
  portName: string | null;
  /** CertScan rows requested for this stratum before capping to what's available. */
  requestedCertScanQuota: number;
  /** CertScan rows actually drawn (capped at `availableCertScanRows`). */
  actualCertScanDrawn: number;
  /** Size of the CertScan-eligible pool this stratum could draw from. */
  availableCertScanRows: number;
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
  /**
   * CertScan shortfalls detected during this draw (see {@link CertScanShortfall}).
   * Empty when every configured CertScan target was fully met. Absent only on
   * legacy sample masters written before this field existed.
   */
  certScanShortfalls?: CertScanShortfall[];
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
