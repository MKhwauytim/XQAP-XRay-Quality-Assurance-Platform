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
  /**
   * The number of images the sample CURRENTLY consists of — drawn rows minus
   * rows retired by a replacement (see {@link SampleMasterData.replacedRowIds}).
   * At draw time this equals `rows.length`; a replacement substitutes a row
   * rather than enlarging the sample, so it leaves this number unchanged.
   *
   * Every consumer wants this "live" reading, not "rows ever drawn":
   * `sampleReport.ts` divides it by `totalRequested` for the fulfilment percent
   * (a substitution must not push it past 100%) and by the processed population
   * for coverage; `samplingPlanStorage` uses it for `targetSampleFraction`; and
   * `executiveReportData.calculateExecutiveKPIs` subtracts the submitted-answer
   * count from it for `remainingImages` — a retired row can never be answered,
   * so counting it here produces a phantom backlog exactly the size of the
   * replacement count.
   *
   * **Legacy note.** Sample masters written before this field's semantics were
   * fixed carry an inflated value (one per replacement performed under the old
   * code). It is NOT recomputed on read: `sample.master.json` holds no record of
   * which rows those replacements retired — that lives only in the immutable
   * `distribution.events/` `replaced` events — so the value is left exactly as
   * stored. Replacements performed from now on are counted correctly.
   */
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
  /**
   * Count of population rows whose raw `stage` value did not match any
   * configured stage alias (`getStageKey` returned `"unknown"`) and were
   * therefore excluded from this draw entirely (P4, 2026-08). Only meaningful
   * for the stage-rule draw path (`drawStageSample`) — the legacy
   * `totalSampleSize` path never classifies rows by stage, so this is
   * `undefined` there. `undefined`/absent also covers legacy sample masters
   * written before this field existed; treat those the same as "0 known" —
   * i.e. don't warn — rather than as a hidden shortfall.
   */
  unmappedStageRowCount?: number;
  /**
   * Distinct raw `stage` strings that triggered the count above, capped to a
   * small sample so a workspace with many distinct typos doesn't bloat the
   * file — enough to diagnose the mapping gap without being a full audit log.
   */
  unmappedStageRawValues?: string[];
  /**
   * The stage alias table this draw actually classified its rows against —
   * `DEFAULT_STAGE_MAPPINGS` merged with the draw config's `stageMappings`,
   * i.e. the exact object `getStageKey` consumed inside `drawStageSample`.
   *
   * **Why it is stored on the draw.** The audit claim this app makes is that a
   * sample is reproducible from what is recorded alongside it. The seed and the
   * algorithm version were recorded; the stage mappings were not. They live in
   * `1-population/config.json`, which is workspace-GLOBAL and admin-editable at
   * any time — so every consumer that had to re-classify a row after the draw
   * (`appendSampleRow` folding a replacement into `stageAllocations`,
   * `getReplacementCandidates` picking a same-stage pool) was reading a table
   * that may no longer be the one the month was drawn under. Editing the aliases
   * mid-month silently re-bucketed replacements against the NEW table while the
   * drawn rows stayed bucketed under the OLD one. Stamping the resolved table
   * here makes the draw self-describing: those consumers prefer this snapshot
   * over live config whenever they already hold the sample master.
   *
   * Absent on: legacy sample masters written before this field existed (fall
   * back to live config — deliberate, no history is rewritten), and on every
   * legacy-path draw (`drawLegacySample` never classifies by stage at all, so
   * it has no mappings to record).
   */
  stageMappingsSnapshot?: StageAliasMappings;
  /**
   * Ids of rows retired by a replacement — still present in `rows`, but no
   * longer part of the sample under study.
   *
   * They are deliberately NOT removed from `rows`: that array is both the audit
   * trail of the draw and the replacement dedup set (`buildExclusionSets` in
   * `distribution/replacement.ts` excludes every id in it), so deleting a
   * retired row would let a known-dead image be re-drawn as somebody else's
   * replacement. Absent on legacy files and on months with no replacements —
   * treat as `[]`.
   */
  replacedRowIds?: string[];
  rows: PreparedPopulationRow[];
};

export type SampleDrawResult =
  | { ok: true; data: SampleMasterData }
  | { ok: false; reason: string };
