import type { PreparedPopulationRow } from "../population/populationTypes";
import { stripRawRow } from "../population/populationTypes";
import { getStageKey, resolveStageMappings, STAGE_KEY_ORDER, STAGE_LABELS_AR } from "../population/stageHelpers";
import type { StageAliasMappings, StageSamplingRule } from "../population/populationConfig";
import { normalizePortName } from "../distribution/portEligibility";
import { hamiltonApportionment } from "./apportionment";
import { createRng, drawWithoutReplacement, hashSeedString } from "./rng";
import type {
  CertScanShortfall,
  PortAllocation,
  SampleConfig,
  SampleDrawResult,
  SampleMasterData,
  StageAllocation
} from "./sampleTypes";

/** Cap on how many distinct unmapped raw stage strings are pinned to a draw result (P4). */
const UNMAPPED_STAGE_RAW_VALUES_CAP = 20;

type Rng = ReturnType<typeof createRng>;
type StageKey = "first" | "second" | "third" | "fourth";
type StageConfig = {
  rngSeed: string;
  samplingRules: StageSamplingRule[];
  stageMappings?: StageAliasMappings;
  /** High-priority ports (`PopulationConfig.priorityPorts`); see {@link drawStage}. */
  priorityPorts?: readonly string[];
};
type DrawCounters = {
  certRequested: number;
  nonCertRequested: number;
  certActual: number;
  nonCertActual: number;
};
type SpilloverResult = {
  extraRows: PreparedPopulationRow[];
  extraCert: number;
  extraNonCert: number;
};
type StagePlan = {
  rowStageKeys: Map<string, ReturnType<typeof getStageKey>>;
  rulesByStage: Map<StageKey, StageSamplingRule>;
  effectiveTargets: Map<StageKey, number>;
  availableCounts: Map<StageKey, number>;
  configuredValues: Map<StageKey, number>;
  /** Rows whose raw `stage` value mapped to "unknown" (P4) — excluded from every stage's draw. */
  unmappedStageRowCount: number;
  /** Distinct raw values behind the count above, capped to {@link UNMAPPED_STAGE_RAW_VALUES_CAP}. */
  unmappedStageRawValues: string[];
};
type StageDraw = {
  rows: PreparedPopulationRow[];
  allocations: PortAllocation[];
  counters: DrawCounters;
  shortfalls: CertScanShortfall[];
};

const STAGE_KEYS: readonly StageKey[] = STAGE_KEY_ORDER;
const REDISTRIBUTABLE_STAGES: StageKey[] = ["second", "third", "fourth"];
const STAGE_LABELS = STAGE_LABELS_AR;

function emptyCounters(): DrawCounters {
  return { certRequested: 0, nonCertRequested: 0, certActual: 0, nonCertActual: 0 };
}

function addCounters(target: DrawCounters, source: DrawCounters): void {
  target.certRequested += source.certRequested;
  target.nonCertRequested += source.nonCertRequested;
  target.certActual += source.certActual;
  target.nonCertActual += source.nonCertActual;
}

function groupByPort(rows: PreparedPopulationRow[]): Map<string, PreparedPopulationRow[]> {
  const groups = new Map<string, PreparedPopulationRow[]>();
  for (const row of rows) {
    const key = row.portName ?? "غير محدد";
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }
  return groups;
}

function splitCertScanQuota(
  allocated: number,
  certScanCount: number,
  nonCertScanCount: number
): { certScanQuota: number; nonCertScanQuota: number } {
  if (certScanCount + nonCertScanCount === 0 || allocated === 0) {
    return { certScanQuota: 0, nonCertScanQuota: 0 };
  }
  const split = hamiltonApportionment(
    [{ key: "cert", size: certScanCount }, { key: "noncert", size: nonCertScanCount }],
    allocated
  );
  return {
    certScanQuota: split.find((result) => result.key === "cert")?.allocated ?? 0,
    nonCertScanQuota: split.find((result) => result.key === "noncert")?.allocated ?? 0
  };
}

function applySpillover(
  portGroups: Map<string, PreparedPopulationRow[]>,
  allocations: PortAllocation[],
  alreadyDrawn: PreparedPopulationRow[],
  underfill: number,
  rng: Rng
): SpilloverResult {
  const drawnIds = new Set(alreadyDrawn.map((row) => row.xrayImageId));
  const candidates = allocations
    .map((allocation) => ({
      portName: allocation.portName,
      remaining: portGroups.get(allocation.portName)!.filter((row) => !drawnIds.has(row.xrayImageId))
    }))
    .filter((candidate) => candidate.remaining.length > 0);
  if (candidates.length === 0) return { extraRows: [], extraCert: 0, extraNonCert: 0 };

  const apportioned = hamiltonApportionment(
    candidates.map((candidate) => ({ key: candidate.portName, size: candidate.remaining.length })),
    underfill
  );
  const result: SpilloverResult = { extraRows: [], extraCert: 0, extraNonCert: 0 };
  for (const entry of apportioned) {
    if (entry.allocated === 0) continue;
    const candidate = candidates.find((item) => item.portName === entry.key)!;
    const drawn = drawWithoutReplacement(candidate.remaining, entry.allocated, rng);
    result.extraRows.push(...drawn);
    result.extraCert += drawn.filter((row) => row.certScanStatus === "Certscan").length;
    result.extraNonCert += drawn.filter((row) => row.certScanStatus === "NonCertscan").length;
  }
  return result;
}

function reconcileSpillover(allocations: PortAllocation[], rows: PreparedPopulationRow[]): void {
  const byPort = new Map(allocations.map((allocation) => [allocation.portName, allocation]));
  for (const row of rows) {
    const allocation = byPort.get(row.portName ?? "غير محدد");
    if (!allocation) continue;
    allocation.actualTotalDrawn += 1;
    if (row.certScanStatus === "Certscan") allocation.actualCertScanDrawn += 1;
    else allocation.actualNonCertScanDrawn += 1;
  }
}

function spillAndReconcile(
  groups: Map<string, PreparedPopulationRow[]>,
  allocations: PortAllocation[],
  drawnRows: PreparedPopulationRow[],
  target: number,
  rng: Rng
): SpilloverResult {
  const underfill = target - drawnRows.length;
  if (underfill <= 0) return { extraRows: [], extraCert: 0, extraNonCert: 0 };
  const spillover = applySpillover(groups, allocations, drawnRows, underfill, rng);
  drawnRows.push(...spillover.extraRows);
  reconcileSpillover(allocations, spillover.extraRows);
  return spillover;
}

function legacyPortDraw(
  portName: string,
  allocated: number,
  portRows: PreparedPopulationRow[],
  rng: Rng
): { allocation: PortAllocation; rows: PreparedPopulationRow[]; counters: DrawCounters } {
  const certRows = portRows.filter((row) => row.certScanStatus === "Certscan");
  const nonCertRows = portRows.filter((row) => row.certScanStatus === "NonCertscan");
  const { certScanQuota, nonCertScanQuota } = splitCertScanQuota(allocated, certRows.length, nonCertRows.length);
  const drawnCert = drawWithoutReplacement(certRows, certScanQuota, rng);
  const drawnNonCert = drawWithoutReplacement(nonCertRows, nonCertScanQuota, rng);
  return {
    rows: [...drawnCert, ...drawnNonCert],
    counters: {
      certRequested: certScanQuota,
      nonCertRequested: nonCertScanQuota,
      certActual: drawnCert.length,
      nonCertActual: drawnNonCert.length
    },
    allocation: {
      portName,
      populationSize: portRows.length,
      certScanCount: certRows.length,
      nonCertScanCount: nonCertRows.length,
      allocatedQuota: allocated,
      certScanQuota,
      nonCertScanQuota,
      actualCertScanDrawn: drawnCert.length,
      actualNonCertScanDrawn: drawnNonCert.length,
      actualTotalDrawn: drawnCert.length + drawnNonCert.length
    }
  };
}

export function drawLegacySample(
  rows: PreparedPopulationRow[],
  config: SampleConfig,
  username: string,
  algorithmVersion: string
): SampleDrawResult {
  // XQ-SMP-002 / XQ-SMP-003 below: both strings are pinned by
  // sampleAlgorithm.golden.test.ts, so they stay byte-identical and uncoded.
  if (config.totalSampleSize <= 0) return { ok: false, reason: "حجم العينة يجب أن يكون أكبر من صفر." };
  const rng = createRng(hashSeedString(config.rngSeed));
  const groups = groupByPort(rows);
  const apportioned = hamiltonApportionment(
    Array.from(groups, ([key, portRows]) => ({ key, size: portRows.length })),
    config.totalSampleSize
  );
  const allocations: PortAllocation[] = [];
  const drawnRows: PreparedPopulationRow[] = [];
  const counters = emptyCounters();

  for (const entry of apportioned) {
    const draw = legacyPortDraw(entry.key, entry.allocated, groups.get(entry.key)!, rng);
    allocations.push(draw.allocation);
    drawnRows.push(...draw.rows);
    addCounters(counters, draw.counters);
  }

  const spillover = spillAndReconcile(groups, allocations, drawnRows, config.totalSampleSize, rng);
  counters.certActual += spillover.extraCert;
  counters.nonCertActual += spillover.extraNonCert;
  // No shortfall detection needed here: legacyPortDraw's certScanQuota comes from
  // a Hamilton split of {certRows.length, nonCertRows.length} whose total seats
  // (`allocated`) can never exceed the sum of those two sizes, so the cert share
  // can never be apportioned above certRows.length — unlike the stage path's
  // `percentage`/`exact` methods, which set their CertScan target independently
  // of what's actually available in that stratum.
  return successfulResult(config.rngSeed, username, algorithmVersion, config.totalSampleSize,
    drawnRows, allocations, [], counters, []);
}

/**
 * A stage rule's configured target expressed in ROWS, before any availability
 * cap or `minRequiredCount` floor is applied.
 *
 * `StageSamplingRule.value` is method-dependent: a percentage (0-100) when
 * `method === "percentage"`, an absolute row count when `method === "exact"`
 * (see populationConfig.ts). The percentage denominator is the stage's own
 * available row count — the same denominator {@link configuredTarget} has
 * always used — so "25% of level 2" means 25% of the level-2 rows that exist,
 * not 25% of the whole population.
 *
 * Everything that compares a rule against a row count (the availability cap
 * here, and `redistributeStageShortfall`'s shortfall/weight arithmetic) must go
 * through this, otherwise a raw percentage gets compared against a row count.
 */
function configuredRowCount(rule: StageSamplingRule, available: number): number {
  return rule.method === "percentage" ? Math.round((rule.value / 100) * available) : rule.value;
}

/**
 * The per-stage target after applying `minRequiredCount` as a floor and capping
 * at `available` (never draw more than exists). Exported so UI code (Phase 3's
 * running-total display, B-owner config panel) can show the *effective* target
 * — the number this module will actually use — rather than re-deriving its own
 * copy of the floor logic and risking drift from the real draw.
 */
export function configuredTarget(rule: StageSamplingRule, available: number): number {
  let target = configuredRowCount(rule, available);
  if (rule.minRequiredCount > 0) {
    target = available < rule.minRequiredCount ? available : Math.max(target, rule.minRequiredCount);
  }
  return Math.min(target, available);
}

/**
 * The CertScan target a stage's rule *would* request, before any availability
 * cap is applied — mirrors the `target`/`certScanExactCount` values `drawStage`
 * derives internally. Exported so Phase 3 can warn about a CertScan shortfall
 * BEFORE the draw runs (owner decision, 2026-08): compare this against the
 * stage's actual CertScan row count to estimate the same gap
 * `detectStageCertShortfall` will report after the draw. As of "1.2"
 * (2026-08-19) this is exact rather than an estimate for both methods: the draw
 * now derives its `percentage` CertScan target from this same stage-level
 * rounding before apportioning it across ports, so the pre-draw warning and the
 * post-draw `certScanShortfalls` agree. Under "1.1" and earlier the draw rounded
 * per port instead, and this helper could under-count a shortfall that only
 * appeared once a specific port's quota was apportioned.
 */
export function certScanConfiguredTarget(rule: StageSamplingRule, effectiveTarget: number): number {
  return rule.certScanMethod === "percentage"
    ? Math.round((rule.certScanPercentage / 100) * effectiveTarget)
    : rule.certScanExactCount;
}

// `stageMappings` is the RESOLVED table (defaults merged with the config
// override), resolved once by `drawStageSample` so the object stamped onto the
// result is provably the same one every `getStageKey` call here consumed —
// resolving separately for the stamp would leave room for the two to drift.
function buildStagePlan(
  rows: PreparedPopulationRow[],
  config: StageConfig,
  stageMappings: StageAliasMappings
): StagePlan {
  const rowStageKeys = new Map<string, ReturnType<typeof getStageKey>>();
  const unmappedStageRawValuesSeen = new Set<string>();
  let unmappedStageRowCount = 0;
  for (const row of rows) {
    const stageKey = getStageKey(row.stage, stageMappings);
    rowStageKeys.set(row.xrayImageId, stageKey);
    if (stageKey === "unknown") {
      unmappedStageRowCount += 1;
      // Detection only (P4, 2026-08): a raw stage value with no matching alias
      // resolves to "unknown" and is excluded from every stage's draw below —
      // previously with zero record of that exclusion on the success path.
      // Capped so a workspace with many distinct typos doesn't bloat the file.
      if (unmappedStageRawValuesSeen.size < UNMAPPED_STAGE_RAW_VALUES_CAP) {
        unmappedStageRawValuesSeen.add(String(row.stage ?? "").trim());
      }
    }
  }
  const rulesByStage = new Map(config.samplingRules.map((rule) => [rule.stageKey, rule]));
  const effectiveTargets = new Map<StageKey, number>();
  const availableCounts = new Map<StageKey, number>();
  const configuredValues = new Map<StageKey, number>();
  for (const stageKey of STAGE_KEYS) {
    const available = rows.filter((row) => rowStageKeys.get(row.xrayImageId) === stageKey).length;
    const rule = rulesByStage.get(stageKey);
    availableCounts.set(stageKey, available);
    effectiveTargets.set(stageKey, rule ? configuredTarget(rule, available) : 0);
    // Row count, never the raw `rule.value`: for a `percentage` rule the raw
    // value is a percentage, and redistributeStageShortfall compares this
    // against `available` (a row count) and weights absorbers by it.
    configuredValues.set(stageKey, rule ? configuredRowCount(rule, available) : 0);
  }
  return {
    rowStageKeys,
    rulesByStage,
    effectiveTargets,
    availableCounts,
    configuredValues,
    unmappedStageRowCount,
    unmappedStageRawValues: Array.from(unmappedStageRawValuesSeen)
  };
}

function redistributeStageShortfall(plan: StagePlan): void {
  const totalShortfall = REDISTRIBUTABLE_STAGES.reduce((sum, stageKey) => {
    const configured = plan.configuredValues.get(stageKey) ?? 0;
    const available = plan.availableCounts.get(stageKey) ?? 0;
    return sum + (configured > 0 && available < configured ? configured - available : 0);
  }, 0);
  if (totalShortfall <= 0) return;

  const absorbers = REDISTRIBUTABLE_STAGES.map((stageKey) => ({
    stageKey,
    spare: (plan.availableCounts.get(stageKey) ?? 0) - (plan.effectiveTargets.get(stageKey) ?? 0),
    weight: plan.configuredValues.get(stageKey) ?? 0
  })).filter((absorber) => absorber.spare > 0);
  if (absorbers.length === 0) return;

  const totalWeight = absorbers.reduce((sum, absorber) => sum + absorber.weight, 0);
  let remaining = totalShortfall;
  for (const absorber of absorbers) {
    const share = totalWeight > 0 ? Math.round((absorber.weight / totalWeight) * totalShortfall) : 0;
    const extra = Math.min(share, absorber.spare, remaining);
    plan.effectiveTargets.set(absorber.stageKey, (plan.effectiveTargets.get(absorber.stageKey) ?? 0) + extra);
    remaining -= extra;
  }
  for (const absorber of absorbers) {
    if (remaining <= 0) break;
    const current = plan.effectiveTargets.get(absorber.stageKey) ?? 0;
    const extra = Math.min(remaining, (plan.availableCounts.get(absorber.stageKey) ?? 0) - current);
    if (extra <= 0) continue;
    plan.effectiveTargets.set(absorber.stageKey, current + extra);
    remaining -= extra;
  }
}

/**
 * The stage's CertScan target as one row count, capped at the stage's CertScan
 * pool, for both methods. `exact` asks for `certScanExactCount`; `percentage`
 * rounds ONCE at the stage level (see SAMPLING_ALGORITHM_VERSION "1.2" — before
 * 2026-08-19 it rounded once per port against each port's own quota and always
 * broke upward at .5, so ten ports each allocated one seat at a configured 50%
 * drew 100% CertScan). Capping at the pool means no port is ever asked for more
 * CertScan rows than it holds; an over-ask is reported at stage level by
 * `detectStageCertShortfall`.
 */
function stageCertTarget(rule: StageSamplingRule, stageTarget: number, stageRows: PreparedPopulationRow[]): number {
  const pool = stageRows.filter((row) => row.certScanStatus === "Certscan").length;
  if (pool === 0) return 0;
  if (rule.certScanMethod === "percentage") {
    if (rule.certScanPercentage <= 0) return 0;
    return Math.max(0, Math.min(Math.round((rule.certScanPercentage / 100) * stageTarget), pool));
  }
  if (rule.certScanExactCount <= 0) return 0;
  return Math.min(rule.certScanExactCount, pool);
}

/** Every port's share of a CertScan row count, Hamilton-apportioned by each port's CertScan pool. */
function portCertShares(
  certTarget: number,
  portKeys: string[],
  groups: Map<string, PreparedPopulationRow[]>
): Map<string, number> {
  if (certTarget <= 0) return new Map();
  const apportioned = hamiltonApportionment(
    portKeys.map((key) => ({
      key,
      size: groups.get(key)!.filter((row) => row.certScanStatus === "Certscan").length
    })),
    certTarget
  );
  return new Map(apportioned.map((entry) => [entry.key, entry.allocated]));
}

function stagePortDraw(
  portName: string,
  allocated: number,
  target: number,
  groups: Map<string, PreparedPopulationRow[]>,
  rule: StageSamplingRule,
  rng: Rng
): { allocation: PortAllocation; rows: PreparedPopulationRow[]; counters: DrawCounters; shortfall: CertScanShortfall | null } {
  const portRows = groups.get(portName)!;
  const certRows = portRows.filter((row) => row.certScanStatus === "Certscan");
  const nonCertRows = portRows.filter((row) => row.certScanStatus === "NonCertscan");
  const certScanQuota = Math.min(allocated, target);
  const actualCertQuota = Math.min(certScanQuota, certRows.length);
  const drawnCert = drawWithoutReplacement(certRows, actualCertQuota, rng);
  let nonCertScanQuota = allocated - certScanQuota;
  if (rule.certScanStrategy === "preferred" && actualCertQuota < certScanQuota) {
    nonCertScanQuota += certScanQuota - actualCertQuota;
  }
  const drawnNonCert = drawWithoutReplacement(nonCertRows, Math.min(nonCertScanQuota, nonCertRows.length), rng);
  // Detection only (owner decision, 2026-08). Defensive as of "1.2" (2026-08-19):
  // both CertScan methods now derive this port's target from a stage-level count
  // that is capped at the stage's CertScan pool and Hamilton-apportioned by each
  // port's own pool, so a port's share can no longer exceed `certRows.length` and
  // this branch is not reachable from either path today. It is kept because the
  // draw already under-fills correctly above (`actualCertQuota` caps it) and this
  // records the gap rather than letting a future target source pass it silently;
  // the reachable over-ask is reported at stage level by detectStageCertShortfall.
  const shortfall: CertScanShortfall | null = certScanQuota > certRows.length
    ? {
        stageKey: rule.stageKey,
        stageLabel: STAGE_LABELS[rule.stageKey],
        portName,
        requestedCertScanQuota: certScanQuota,
        actualCertScanDrawn: drawnCert.length,
        availableCertScanRows: certRows.length
      }
    : null;
  return {
    rows: [...drawnCert, ...drawnNonCert],
    counters: {
      certRequested: certScanQuota,
      nonCertRequested: nonCertScanQuota,
      certActual: drawnCert.length,
      nonCertActual: drawnNonCert.length
    },
    allocation: {
      portName,
      populationSize: portRows.length,
      certScanCount: certRows.length,
      nonCertScanCount: nonCertRows.length,
      allocatedQuota: allocated,
      certScanQuota,
      nonCertScanQuota,
      actualCertScanDrawn: drawnCert.length,
      actualNonCertScanDrawn: drawnNonCert.length,
      actualTotalDrawn: drawnCert.length + drawnNonCert.length
    },
    shortfall
  };
}

/**
 * Stage-wide CertScan shortfall check (detection only). BOTH CertScan methods
 * cap their target to the stage's whole CertScan pool ({@link stageCertTarget})
 * *before* per-port apportionment runs, so no
 * single port's request can exceed its own pool in either path — an over-ask is
 * only visible here, against the stage total.
 *
 * The `percentage` arm was added with "1.2" (2026-08-19). Until then a
 * percentage rule rounded its CertScan target per port against that port's own
 * `allocated` quota, so the request was not knowable until apportionment ran and
 * the shortfall surfaced per-port inside `stagePortDraw`. Now that the target is
 * a single stage-level count, the request IS knowable up front, exactly as for
 * `exact` — and it has to be reported here, because the stage-level cap means
 * `stagePortDraw` can no longer observe the gap at all. The reported request is
 * the UNCAPPED figure (what the rule asked for), which is what makes it a
 * shortfall record rather than a silently satisfied one.
 */
function detectStageCertShortfall(
  rule: StageSamplingRule,
  stageRows: PreparedPopulationRow[],
  stageTarget: number
): CertScanShortfall | null {
  const requestedCertScanQuota = rule.certScanMethod === "exact"
    ? rule.certScanExactCount
    : Math.round((rule.certScanPercentage / 100) * stageTarget);
  if (requestedCertScanQuota <= 0) return null;
  const availableCertScanRows = stageRows.filter((row) => row.certScanStatus === "Certscan").length;
  if (requestedCertScanQuota <= availableCertScanRows) return null;
  return {
    stageKey: rule.stageKey,
    stageLabel: STAGE_LABELS[rule.stageKey],
    portName: null,
    requestedCertScanQuota,
    actualCertScanDrawn: availableCertScanRows,
    availableCertScanRows
  };
}

/**
 * The pre-priority draw over a group of ports: Hamilton by port size, each
 * port's CertScan share Hamilton by its CertScan pool, then (when `spill`)
 * any underfill spilled over the group's remaining rows. With every stage row
 * as the group and the rule's own CertScan target this IS the stage draw, step
 * for step and RNG call for RNG call, exactly as it was before priority ports.
 */
function drawPortGroup(
  groupRows: PreparedPopulationRow[],
  target: number,
  certTarget: number,
  rule: StageSamplingRule,
  rng: Rng,
  spill: boolean
): { draw: StageDraw; groups: Map<string, PreparedPopulationRow[]> } {
  const groups = groupByPort(groupRows);
  const portKeys = Array.from(groups.keys());
  const apportioned = hamiltonApportionment(
    portKeys.map((key) => ({ key, size: groups.get(key)!.length })),
    target
  );
  const certShares = portCertShares(certTarget, portKeys, groups);
  const draw: StageDraw = { rows: [], allocations: [], counters: emptyCounters(), shortfalls: [] };
  for (const entry of apportioned) {
    const port = stagePortDraw(entry.key, entry.allocated, certShares.get(entry.key) ?? 0, groups, rule, rng);
    draw.rows.push(...port.rows);
    draw.allocations.push(port.allocation);
    addCounters(draw.counters, port.counters);
    if (port.shortfall) draw.shortfalls.push(port.shortfall);
  }
  if (spill) {
    const spillover = spillAndReconcile(groups, draw.allocations, draw.rows, target, rng);
    draw.counters.certActual += spillover.extraCert;
    draw.counters.nonCertActual += spillover.extraNonCert;
  }
  return { draw, groups };
}

/**
 * The high-priority ports' part of a stage: up to `certWanted` CertScan and
 * `nonCertWanted` non-CertScan rows, each type Hamilton-apportioned across the
 * priority ports by that port's pool of the type. Both counts are already
 * capped at the priority ports' pools by the caller, so no port is asked for
 * more of a type than it holds.
 */
function drawPriorityPorts(
  priorityRows: PreparedPopulationRow[],
  certWanted: number,
  nonCertWanted: number,
  rng: Rng
): { draw: StageDraw; groups: Map<string, PreparedPopulationRow[]> } {
  const groups = groupByPort(priorityRows);
  const portKeys = Array.from(groups.keys());
  const byType = (status: "Certscan" | "NonCertscan", wanted: number): Map<string, number> => {
    if (wanted <= 0) return new Map();
    const apportioned = hamiltonApportionment(
      portKeys.map((key) => ({ key, size: groups.get(key)!.filter((row) => row.certScanStatus === status).length })),
      wanted
    );
    return new Map(apportioned.map((entry) => [entry.key, entry.allocated]));
  };
  const certShares = byType("Certscan", certWanted);
  const nonCertShares = byType("NonCertscan", nonCertWanted);
  const draw: StageDraw = { rows: [], allocations: [], counters: emptyCounters(), shortfalls: [] };
  for (const portName of portKeys) {
    const portRows = groups.get(portName)!;
    const certRows = portRows.filter((row) => row.certScanStatus === "Certscan");
    const nonCertRows = portRows.filter((row) => row.certScanStatus === "NonCertscan");
    const certScanQuota = certShares.get(portName) ?? 0;
    const nonCertScanQuota = nonCertShares.get(portName) ?? 0;
    const drawnCert = drawWithoutReplacement(certRows, Math.min(certScanQuota, certRows.length), rng);
    const drawnNonCert = drawWithoutReplacement(nonCertRows, Math.min(nonCertScanQuota, nonCertRows.length), rng);
    draw.rows.push(...drawnCert, ...drawnNonCert);
    addCounters(draw.counters, {
      certRequested: certScanQuota,
      nonCertRequested: nonCertScanQuota,
      certActual: drawnCert.length,
      nonCertActual: drawnNonCert.length
    });
    draw.allocations.push({
      portName,
      populationSize: portRows.length,
      certScanCount: certRows.length,
      nonCertScanCount: nonCertRows.length,
      allocatedQuota: certScanQuota + nonCertScanQuota,
      certScanQuota,
      nonCertScanQuota,
      actualCertScanDrawn: drawnCert.length,
      actualNonCertScanDrawn: drawnNonCert.length,
      actualTotalDrawn: drawnCert.length + drawnNonCert.length,
      priority: true
    });
  }
  return { draw, groups };
}

function countCert(rows: PreparedPopulationRow[]): number {
  return rows.filter((row) => row.certScanStatus === "Certscan").length;
}

/**
 * One stage's draw.
 *
 * With no high-priority port among the stage's rows this is the plain draw
 * ({@link drawPortGroup} over every stage row), unchanged.
 *
 * With high-priority ports ("1.3", 2026-10-19, owner request) the stage's
 * CertScan / non-CertScan split is kept and each type is filled from the
 * priority ports FIRST: up to the stage's CertScan target from their CertScan
 * rows, up to the rest of the stage target from their non-CertScan rows. What
 * they cannot cover is drawn from the other ports exactly the normal way (by
 * port size, CertScan share by pool). A stage still short after both — a type
 * ran out everywhere — is topped up from any row left, priority ports first,
 * then the others.
 */
function drawStage(
  stageRows: PreparedPopulationRow[],
  target: number,
  rule: StageSamplingRule,
  rng: Rng,
  priorityPorts: ReadonlySet<string>
): StageDraw {
  const stageShortfall = detectStageCertShortfall(rule, stageRows, target);
  const certTarget = stageCertTarget(rule, target, stageRows);
  const priorityRows = priorityPorts.size > 0
    ? stageRows.filter((row) => priorityPorts.has(normalizePortName(row.portName)))
    : [];

  if (priorityRows.length === 0) {
    const { draw } = drawPortGroup(stageRows, target, certTarget, rule, rng, true);
    if (stageShortfall) draw.shortfalls.unshift(stageShortfall);
    return draw;
  }

  const certWanted = Math.min(certTarget, target);
  const nonCertWanted = target - certWanted;
  const priorityCertPool = countCert(priorityRows);
  const priority = drawPriorityPorts(
    priorityRows,
    Math.min(certWanted, priorityCertPool),
    Math.min(nonCertWanted, priorityRows.length - priorityCertPool),
    rng
  );

  const otherRows = stageRows.filter((row) => !priorityPorts.has(normalizePortName(row.portName)));
  const otherTarget = Math.min(target - priority.draw.rows.length, otherRows.length);
  const otherCert = Math.min(Math.max(0, certWanted - priority.draw.counters.certActual), countCert(otherRows));
  const others = drawPortGroup(otherRows, otherTarget, otherCert, rule, rng, false);

  const rows = [...priority.draw.rows, ...others.draw.rows];
  const counters = emptyCounters();
  addCounters(counters, priority.draw.counters);
  addCounters(counters, others.draw.counters);
  for (const [groups, allocations] of [
    [priority.groups, priority.draw.allocations],
    [others.groups, others.draw.allocations]
  ] as const) {
    const spillover = spillAndReconcile(groups, allocations, rows, target, rng);
    counters.certActual += spillover.extraCert;
    counters.nonCertActual += spillover.extraNonCert;
  }
  return {
    rows,
    allocations: [...priority.draw.allocations, ...others.draw.allocations],
    counters,
    shortfalls: [...(stageShortfall ? [stageShortfall] : []), ...priority.draw.shortfalls, ...others.draw.shortfalls]
  };
}

function mergePortAllocations(target: Map<string, PortAllocation>, additions: PortAllocation[]): void {
  for (const addition of additions) {
    const existing = target.get(addition.portName);
    if (!existing) {
      target.set(addition.portName, { ...addition });
      continue;
    }
    existing.populationSize += addition.populationSize;
    existing.certScanCount += addition.certScanCount;
    existing.nonCertScanCount += addition.nonCertScanCount;
    existing.allocatedQuota += addition.allocatedQuota;
    existing.certScanQuota += addition.certScanQuota;
    existing.nonCertScanQuota += addition.nonCertScanQuota;
    existing.actualCertScanDrawn += addition.actualCertScanDrawn;
    existing.actualNonCertScanDrawn += addition.actualNonCertScanDrawn;
    existing.actualTotalDrawn += addition.actualTotalDrawn;
  }
}

function stageAllocation(stageKey: StageKey, populationSize: number, target: number, rows: PreparedPopulationRow[]): StageAllocation {
  return {
    stageKey,
    stageLabel: STAGE_LABELS[stageKey],
    populationSize,
    targetQuota: target,
    actualDrawn: rows.length,
    certScanDrawn: rows.filter((row) => row.certScanStatus === "Certscan").length,
    nonCertScanDrawn: rows.filter((row) => row.certScanStatus === "NonCertscan").length
  };
}

function successfulResult(
  rngSeed: string,
  username: string,
  algorithmVersion: string,
  totalRequested: number,
  rows: PreparedPopulationRow[],
  portAllocations: PortAllocation[],
  stageAllocations: StageAllocation[],
  counters: DrawCounters,
  certScanShortfalls: CertScanShortfall[],
  unmappedStage?: { rowCount: number; rawValues: string[] },
  // The resolved stage alias table the caller classified its rows against.
  // Omitted by `drawLegacySample`, which has no stages: the legacy path never
  // calls `getStageKey`, so there is no mapping table it could honestly claim
  // to have drawn under, and stamping the defaults there would be a fabricated
  // provenance record rather than a true one.
  stageMappingsSnapshot?: StageAliasMappings
): SampleDrawResult {
  const data: SampleMasterData = {
    rngSeed,
    samplingAlgorithmVersion: algorithmVersion,
    totalRequested,
    totalActual: rows.length,
    certScanRequested: counters.certRequested,
    nonCertScanRequested: counters.nonCertRequested,
    certScanActual: counters.certActual,
    nonCertScanActual: counters.nonCertActual,
    portAllocations,
    stageAllocations,
    certScanShortfalls,
    ...(unmappedStage
      ? {
          unmappedStageRowCount: unmappedStage.rowCount,
          unmappedStageRawValues: unmappedStage.rawValues
        }
      : {}),
    // Spread-conditional for the same reason as the block above: a legacy-path
    // draw keeps the exact file shape it has always been written with, so this
    // stays a purely additive field on the stage path.
    ...(stageMappingsSnapshot ? { stageMappingsSnapshot } : {}),
    drawnAt: new Date().toISOString(),
    drawnBy: username,
    // B5 (disk-bloat fix): `handleDrawSample` can run this draw on the
    // freshly-processed, not-yet-saved in-memory population rows, which still
    // carry `rawRow` (the full original Excel row) for the live "export
    // processed population" / BI-enrichment consumers upstream. Strip it here
    // so it never lands in sample.master.json regardless of which rows were
    // passed in — population.final.json already strips it independently
    // (Tabs/Population/index.tsx's commitSaveToDisk), this is the equivalent
    // guard for the sample-draw write path this module owns.
    rows: rows.map(stripRawRow)
  };
  return { ok: true, data };
}

export function drawStageSample(
  rows: PreparedPopulationRow[],
  config: StageConfig,
  username: string,
  algorithmVersion: string
): SampleDrawResult {
  // Resolve the alias table ONCE: it is both what classifies every row below
  // and what gets stamped onto the result as the draw's own record of the
  // mappings it ran under (see SampleMasterData.stageMappingsSnapshot).
  const stageMappingsSnapshot = resolveStageMappings(config.stageMappings);
  const plan = buildStagePlan(rows, config, stageMappingsSnapshot);
  const totalMappedRows = STAGE_KEYS.reduce((sum, key) => sum + (plan.availableCounts.get(key) ?? 0), 0);
  if (totalMappedRows === 0) {
    return {
      ok: false,
      reason: "لم يتم العثور على أي صف مطابق لأحد المستويات الأربعة المُهيأة. تحقق من إعداد \"تعيين المستويات\" (Stage Mapping) في الإعدادات ومطابقته لقيم عمود المستوى الفعلية في بيانات المجتمع."
    };
  }
  redistributeStageShortfall(plan);

  const rng = createRng(hashSeedString(config.rngSeed));
  const priorityPorts = new Set(config.priorityPorts ?? []);
  const allRows: PreparedPopulationRow[] = [];
  const portAllocations = new Map<string, PortAllocation>();
  const stageAllocations: StageAllocation[] = [];
  const counters = emptyCounters();
  const certScanShortfalls: CertScanShortfall[] = [];
  let totalRequested = 0;
  for (const stageKey of STAGE_KEYS) {
    const stageRows = rows.filter((row) => plan.rowStageKeys.get(row.xrayImageId) === stageKey);
    const target = plan.effectiveTargets.get(stageKey) ?? 0;
    if (stageRows.length === 0 || target <= 0) continue;
    const draw = drawStage(stageRows, target, plan.rulesByStage.get(stageKey)!, rng, priorityPorts);
    totalRequested += target;
    allRows.push(...draw.rows);
    addCounters(counters, draw.counters);
    stageAllocations.push(stageAllocation(stageKey, stageRows.length, target, draw.rows));
    mergePortAllocations(portAllocations, draw.allocations);
    certScanShortfalls.push(...draw.shortfalls);
  }
  const result = successfulResult(config.rngSeed, username, algorithmVersion, totalRequested,
    allRows, Array.from(portAllocations.values()), stageAllocations, counters, certScanShortfalls,
    { rowCount: plan.unmappedStageRowCount, rawValues: plan.unmappedStageRawValues },
    stageMappingsSnapshot);
  // Recorded only when set, so a draw without priority ports keeps the exact
  // file shape it has always had.
  if (result.ok && priorityPorts.size > 0) result.data.priorityPorts = [...priorityPorts];
  return result;
}
