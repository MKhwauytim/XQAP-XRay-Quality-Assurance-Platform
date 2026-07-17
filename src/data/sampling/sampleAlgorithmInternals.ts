import type { PreparedPopulationRow } from "../population/populationTypes";
import { getStageKey } from "../population/stageHelpers";
import type { StageAliasMappings, StageSamplingRule } from "../population/populationConfig";
import { hamiltonApportionment } from "./apportionment";
import { createRng, drawWithoutReplacement, hashSeedString } from "./rng";
import type {
  PortAllocation,
  SampleConfig,
  SampleDrawResult,
  SampleMasterData,
  StageAllocation
} from "./sampleTypes";

type Rng = ReturnType<typeof createRng>;
type StageKey = "first" | "second" | "third" | "fourth";
type StageConfig = {
  rngSeed: string;
  samplingRules: StageSamplingRule[];
  stageMappings?: StageAliasMappings;
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
};
type StageDraw = {
  rows: PreparedPopulationRow[];
  allocations: PortAllocation[];
  counters: DrawCounters;
};

const STAGE_KEYS: StageKey[] = ["first", "second", "third", "fourth"];
const REDISTRIBUTABLE_STAGES: StageKey[] = ["second", "third", "fourth"];
const STAGE_LABELS: Record<StageKey, string> = {
  first: "المستوى الأول",
  second: "المستوى الثاني",
  third: "المستوى الثالث",
  fourth: "المستوى الرابع"
};

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
  return successfulResult(config.rngSeed, username, algorithmVersion, config.totalSampleSize,
    drawnRows, allocations, [], counters);
}

function configuredTarget(rule: StageSamplingRule, available: number): number {
  let target = rule.method === "percentage" ? Math.round((rule.value / 100) * available) : rule.value;
  if (rule.minRequiredCount > 0) {
    target = available < rule.minRequiredCount ? available : Math.max(target, rule.minRequiredCount);
  }
  return Math.min(target, available);
}

function buildStagePlan(rows: PreparedPopulationRow[], config: StageConfig): StagePlan {
  const rowStageKeys = new Map<string, ReturnType<typeof getStageKey>>();
  for (const row of rows) rowStageKeys.set(row.xrayImageId, getStageKey(row.stage, config.stageMappings));
  const rulesByStage = new Map(config.samplingRules.map((rule) => [rule.stageKey, rule]));
  const effectiveTargets = new Map<StageKey, number>();
  const availableCounts = new Map<StageKey, number>();
  const configuredValues = new Map<StageKey, number>();
  for (const stageKey of STAGE_KEYS) {
    const available = rows.filter((row) => rowStageKeys.get(row.xrayImageId) === stageKey).length;
    const rule = rulesByStage.get(stageKey);
    availableCounts.set(stageKey, available);
    effectiveTargets.set(stageKey, rule ? configuredTarget(rule, available) : 0);
    configuredValues.set(stageKey, rule?.value ?? 0);
  }
  return { rowStageKeys, rulesByStage, effectiveTargets, availableCounts, configuredValues };
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

function exactCertTarget(
  rule: StageSamplingRule,
  stageRows: PreparedPopulationRow[],
  portKeys: string[],
  groups: Map<string, PreparedPopulationRow[]>,
  portName: string
): number {
  const stageCertRows = stageRows.filter((row) => row.certScanStatus === "Certscan");
  if (stageCertRows.length === 0 || rule.certScanExactCount <= 0) return 0;
  const apportioned = hamiltonApportionment(
    portKeys.map((key) => ({
      key,
      size: groups.get(key)!.filter((row) => row.certScanStatus === "Certscan").length
    })),
    Math.min(rule.certScanExactCount, stageCertRows.length)
  );
  return apportioned.find((entry) => entry.key === portName)?.allocated ?? 0;
}

function stagePortDraw(
  portName: string,
  allocated: number,
  stageRows: PreparedPopulationRow[],
  portKeys: string[],
  groups: Map<string, PreparedPopulationRow[]>,
  rule: StageSamplingRule,
  rng: Rng
): { allocation: PortAllocation; rows: PreparedPopulationRow[]; counters: DrawCounters } {
  const portRows = groups.get(portName)!;
  const certRows = portRows.filter((row) => row.certScanStatus === "Certscan");
  const nonCertRows = portRows.filter((row) => row.certScanStatus === "NonCertscan");
  const target = rule.certScanMethod === "percentage"
    ? Math.round((rule.certScanPercentage / 100) * allocated)
    : exactCertTarget(rule, stageRows, portKeys, groups, portName);
  const certScanQuota = Math.min(allocated, target);
  const actualCertQuota = Math.min(certScanQuota, certRows.length);
  const drawnCert = drawWithoutReplacement(certRows, actualCertQuota, rng);
  let nonCertScanQuota = allocated - certScanQuota;
  if (rule.certScanStrategy === "preferred" && actualCertQuota < certScanQuota) {
    nonCertScanQuota += certScanQuota - actualCertQuota;
  }
  const drawnNonCert = drawWithoutReplacement(nonCertRows, Math.min(nonCertScanQuota, nonCertRows.length), rng);
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

function drawStage(stageRows: PreparedPopulationRow[], target: number, rule: StageSamplingRule, rng: Rng): StageDraw {
  const groups = groupByPort(stageRows);
  const portKeys = Array.from(groups.keys());
  const apportioned = hamiltonApportionment(
    portKeys.map((key) => ({ key, size: groups.get(key)!.length })),
    target
  );
  const rows: PreparedPopulationRow[] = [];
  const allocations: PortAllocation[] = [];
  const counters = emptyCounters();
  for (const entry of apportioned) {
    const draw = stagePortDraw(entry.key, entry.allocated, stageRows, portKeys, groups, rule, rng);
    rows.push(...draw.rows);
    allocations.push(draw.allocation);
    addCounters(counters, draw.counters);
  }
  const spillover = spillAndReconcile(groups, allocations, rows, target, rng);
  counters.certActual += spillover.extraCert;
  counters.nonCertActual += spillover.extraNonCert;
  return { rows, allocations, counters };
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
  counters: DrawCounters
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
    drawnAt: new Date().toISOString(),
    drawnBy: username,
    rows
  };
  return { ok: true, data };
}

export function drawStageSample(
  rows: PreparedPopulationRow[],
  config: StageConfig,
  username: string,
  algorithmVersion: string
): SampleDrawResult {
  const plan = buildStagePlan(rows, config);
  const totalMappedRows = STAGE_KEYS.reduce((sum, key) => sum + (plan.availableCounts.get(key) ?? 0), 0);
  if (totalMappedRows === 0) {
    return {
      ok: false,
      reason: "لم يتم العثور على أي صف مطابق لأحد المستويات الأربعة المُهيأة. تحقق من إعداد \"تعيين المستويات\" (Stage Mapping) في الإعدادات ومطابقته لقيم عمود المستوى الفعلية في بيانات المجتمع."
    };
  }
  redistributeStageShortfall(plan);

  const rng = createRng(hashSeedString(config.rngSeed));
  const allRows: PreparedPopulationRow[] = [];
  const portAllocations = new Map<string, PortAllocation>();
  const stageAllocations: StageAllocation[] = [];
  const counters = emptyCounters();
  let totalRequested = 0;
  for (const stageKey of STAGE_KEYS) {
    const stageRows = rows.filter((row) => plan.rowStageKeys.get(row.xrayImageId) === stageKey);
    const target = plan.effectiveTargets.get(stageKey) ?? 0;
    if (stageRows.length === 0 || target <= 0) continue;
    const draw = drawStage(stageRows, target, plan.rulesByStage.get(stageKey)!, rng);
    totalRequested += target;
    allRows.push(...draw.rows);
    addCounters(counters, draw.counters);
    stageAllocations.push(stageAllocation(stageKey, stageRows.length, target, draw.rows));
    mergePortAllocations(portAllocations, draw.allocations);
  }
  return successfulResult(config.rngSeed, username, algorithmVersion, totalRequested,
    allRows, Array.from(portAllocations.values()), stageAllocations, counters);
}
