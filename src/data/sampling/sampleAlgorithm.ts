import type { PreparedPopulationRow } from "../population/populationTypes";
import { hamiltonApportionment } from "./apportionment";
import { createRng, drawWithoutReplacement, hashSeedString } from "./rng";
import { getStageKey } from "../population/stageHelpers";
import type { StageAliasMappings, StageSamplingRule } from "../population/populationConfig";
import type {
  PortAllocation,
  SampleConfig,
  SampleDrawResult,
  SampleMasterData,
  StageAllocation
} from "./sampleTypes";

/**
 * Reproducibility pin (A2). Bound to the RNG seed so a historical draw can be
 * recognised as replayable only under the code version that produced it.
 *
 * RULE: bump this constant on ANY semantic change to `drawSample` (apportionment,
 * split, draw order, spillover, stage redistribution). A pure refactor that
 * provably preserves the exact drawn set for every seed does NOT bump it.
 * Format: "MAJOR.MINOR" — MAJOR for a change that alters which rows are drawn.
 */
export const SAMPLING_ALGORITHM_VERSION = "1.0";

// Group population rows by portName
function groupByPort(
  rows: PreparedPopulationRow[]
): Map<string, PreparedPopulationRow[]> {
  const groups = new Map<string, PreparedPopulationRow[]>();
  for (const row of rows) {
    const key = row.portName ?? "غير محدد";
    let bucket = groups.get(key);
    if (!bucket) {
      bucket = [];
      groups.set(key, bucket);
    }
    bucket.push(row);
  }
  return groups;
}

// Split a port's allocated quota into CertScan / NonCertScan sub-quotas
// using Hamilton apportionment on the port's own CertScan/NonCertScan counts.
function splitCertScanQuota(
  allocated: number,
  certScanCount: number,
  nonCertScanCount: number
): { certScanQuota: number; nonCertScanQuota: number } {
  const portTotal = certScanCount + nonCertScanCount;
  if (portTotal === 0 || allocated === 0) {
    return { certScanQuota: 0, nonCertScanQuota: 0 };
  }

  const split = hamiltonApportionment(
    [
      { key: "cert", size: certScanCount },
      { key: "noncert", size: nonCertScanCount }
    ],
    allocated
  );

  const certScanQuota = split.find((r) => r.key === "cert")?.allocated ?? 0;
  const nonCertScanQuota =
    split.find((r) => r.key === "noncert")?.allocated ?? 0;
  return { certScanQuota, nonCertScanQuota };
}

export function drawSample(
  rows: PreparedPopulationRow[],
  config: SampleConfig | { rngSeed: string; samplingRules: StageSamplingRule[]; stageMappings?: StageAliasMappings },
  username: string
): SampleDrawResult {
  if (rows.length === 0) {
    return { ok: false, reason: "لا توجد صفوف مجتمع للسحب منها." };
  }

  // Check if old config (backward compatibility)
  if ("totalSampleSize" in config) {
    const sampleSize = config.totalSampleSize;
    if (sampleSize <= 0) {
      return { ok: false, reason: "حجم العينة يجب أن يكون أكبر من صفر." };
    }

    const rng = createRng(hashSeedString(config.rngSeed));
    const portGroups = groupByPort(rows);

    // Compute port-level allocations via Hamilton
    const portKeys = Array.from(portGroups.keys());
    const portSizes = portKeys.map((k) => ({
      key: k,
      size: portGroups.get(k)!.length
    }));

    const apportioned = hamiltonApportionment(portSizes, sampleSize);

    const portAllocations: PortAllocation[] = [];
    const allDrawnRows: PreparedPopulationRow[] = [];

    let totalCertScanRequested = 0;
    let totalNonCertScanRequested = 0;
    let totalCertScanActual = 0;
    let totalNonCertScanActual = 0;

    for (const entry of apportioned) {
      const portRows = portGroups.get(entry.key)!;
      const certScanRows = portRows.filter((r) => r.certScanStatus === "Certscan");
      const nonCertScanRows = portRows.filter(
        (r) => r.certScanStatus === "NonCertscan"
      );

      const { certScanQuota, nonCertScanQuota } = splitCertScanQuota(
        entry.allocated,
        certScanRows.length,
        nonCertScanRows.length
      );

      // Draw from each tier independently using the shared RNG
      const drawnCert = drawWithoutReplacement(certScanRows, certScanQuota, rng);
      const drawnNonCert = drawWithoutReplacement(
        nonCertScanRows,
        nonCertScanQuota,
        rng
      );

      const portActualTotal = drawnCert.length + drawnNonCert.length;

      portAllocations.push({
        portName: entry.key,
        populationSize: portRows.length,
        certScanCount: certScanRows.length,
        nonCertScanCount: nonCertScanRows.length,
        allocatedQuota: entry.allocated,
        certScanQuota,
        nonCertScanQuota,
        actualCertScanDrawn: drawnCert.length,
        actualNonCertScanDrawn: drawnNonCert.length,
        actualTotalDrawn: portActualTotal
      });

      allDrawnRows.push(...drawnCert, ...drawnNonCert);
      totalCertScanRequested += certScanQuota;
      totalNonCertScanRequested += nonCertScanQuota;
      totalCertScanActual += drawnCert.length;
      totalNonCertScanActual += drawnNonCert.length;
    }

    // Handle spillover
    const underfill = sampleSize - allDrawnRows.length;

    if (underfill > 0) {
      const spillResult = applySpillover(
        portGroups,
        portAllocations,
        allDrawnRows,
        underfill,
        rng
      );
      allDrawnRows.push(...spillResult.extraRows);
      totalCertScanActual += spillResult.extraCert;
      totalNonCertScanActual += spillResult.extraNonCert;

      // Reconcile per-port actuals with the spillover extras so that
      // sum(portAllocations actuals) === totalActual (mirrors the stage path).
      const allocByPort = new Map(portAllocations.map((a) => [a.portName, a]));
      for (const row of spillResult.extraRows) {
        const portName = row.portName ?? "غير محدد";
        const alloc = allocByPort.get(portName);
        if (alloc) {
          alloc.actualTotalDrawn += 1;
          if (row.certScanStatus === "Certscan") {
            alloc.actualCertScanDrawn += 1;
          } else {
            alloc.actualNonCertScanDrawn += 1;
          }
        }
      }
    }

    const data: SampleMasterData = {
      rngSeed: config.rngSeed,
      samplingAlgorithmVersion: SAMPLING_ALGORITHM_VERSION,
      totalRequested: sampleSize,
      totalActual: allDrawnRows.length,
      certScanRequested: totalCertScanRequested,
      nonCertScanRequested: totalNonCertScanRequested,
      certScanActual: totalCertScanActual,
      nonCertScanActual: totalNonCertScanActual,
      portAllocations,
      stageAllocations: [],
      drawnAt: new Date().toISOString(),
      drawnBy: username,
      rows: allDrawnRows
    };

    return { ok: true, data };
  }

  // STAGE-BY-STAGE ALGORITHM
  const rngSeed = config.rngSeed;
  const rules = config.samplingRules;
  const rng = createRng(hashSeedString(rngSeed));

  const allDrawnRows: PreparedPopulationRow[] = [];
  const portAllocationsMap = new Map<string, PortAllocation>();
  const stageAllocations: StageAllocation[] = [];

  let totalCertScanRequested = 0;
  let totalNonCertScanRequested = 0;
  let totalCertScanActual = 0;
  let totalNonCertScanActual = 0;
  let totalRequested = 0;

  const stageKeys: Array<"first" | "second" | "third" | "fourth"> = ["first", "second", "third", "fourth"];

  // Pre-compute stage key for every row once — avoids repeated Arabic regex normalization
  // inside every filter/loop below (was O(n × stages × passes)).
  const rowStageKeys = new Map<string, ReturnType<typeof getStageKey>>();
  for (const row of rows) {
    rowStageKeys.set(row.xrayImageId, getStageKey(row.stage, config.stageMappings));
  }

  // Pre-index rules by stageKey to avoid repeated linear searches.
  const rulesByStage = new Map(rules.map((r) => [r.stageKey, r]));

  // Pre-pass: compute targets for each stage, then redistribute any shortfall from
  // stages 2/3/4 (where population < target) to the remaining stages with spare capacity.
  const effectiveTargets = new Map<"first" | "second" | "third" | "fourth", number>();
  const stageAvailableCounts = new Map<"first" | "second" | "third" | "fourth", number>();
  const configuredValues = new Map<"first" | "second" | "third" | "fourth", number>();

  for (const sk of stageKeys) {
    const available = rows.filter((row) => rowStageKeys.get(row.xrayImageId) === sk).length;
    stageAvailableCounts.set(sk, available);
    const r = rulesByStage.get(sk);
    if (!r) {
      // Stage not configured by the operator — draw nothing for it.
      effectiveTargets.set(sk, 0);
      configuredValues.set(sk, 0);
      continue;
    }
    let target = r.method === "percentage"
      ? Math.round((r.value / 100) * available)
      : r.value;
    if (r.minRequiredCount > 0) {
      target = available < r.minRequiredCount ? available : Math.max(target, r.minRequiredCount);
    }
    target = Math.min(target, available);
    effectiveTargets.set(sk, target);
    configuredValues.set(sk, r.value);
  }

  // Guard: if none of the population rows matched ANY of the four configured
  // stages, every row's `stage` text failed to match the stage-mapping aliases
  // (e.g. the source data uses "Level 1" wording instead of "STAGE 1" /
  // "المستوى الأول"). Silently "succeeding" with a zeroed draw here is
  // indistinguishable from a real empty result once saved to disk — fail
  // loudly instead so the operator fixes stage mapping before proceeding.
  const totalMappedRows = stageKeys.reduce((sum, sk) => sum + (stageAvailableCounts.get(sk) ?? 0), 0);
  if (totalMappedRows === 0) {
    return {
      ok: false,
      reason: "لم يتم العثور على أي صف مطابق لأحد المستويات الأربعة المُهيأة. تحقق من إعداد \"تعيين المستويات\" (Stage Mapping) في الإعدادات ومطابقته لقيم عمود المستوى الفعلية في بيانات المجتمع."
    };
  }

  // Compute total shortfall for non-first stages
  const redistributableStages: Array<"second" | "third" | "fourth"> = ["second", "third", "fourth"];
  let totalShortfall = 0;
  for (const sk of redistributableStages) {
    const configured = configuredValues.get(sk) ?? 0;
    const available = stageAvailableCounts.get(sk) ?? 0;
    if (configured > 0 && available < configured) {
      totalShortfall += configured - available;
    }
  }

  // Redistribute shortfall to non-first stages that have spare capacity
  if (totalShortfall > 0) {
    const absorbers = redistributableStages
      .map((sk) => ({
        sk,
        spare: (stageAvailableCounts.get(sk) ?? 0) - (effectiveTargets.get(sk) ?? 0),
        weight: configuredValues.get(sk) ?? 0
      }))
      .filter((a) => a.spare > 0);

    if (absorbers.length > 0) {
      const totalWeight = absorbers.reduce((s, a) => s + a.weight, 0);
      let remaining = totalShortfall;
      for (const absorber of absorbers) {
        const share = totalWeight > 0
          ? Math.round((absorber.weight / totalWeight) * totalShortfall)
          : 0;
        const extra = Math.min(share, absorber.spare, remaining);
        effectiveTargets.set(absorber.sk, (effectiveTargets.get(absorber.sk) ?? 0) + extra);
        remaining -= extra;
      }
      // Distribute rounding remainder to the first absorber with capacity
      if (remaining > 0) {
        for (const absorber of absorbers) {
          const cur = effectiveTargets.get(absorber.sk) ?? 0;
          const cap = (stageAvailableCounts.get(absorber.sk) ?? 0) - cur;
          if (cap > 0) {
            const extra = Math.min(remaining, cap);
            effectiveTargets.set(absorber.sk, cur + extra);
            remaining -= extra;
            if (remaining <= 0) break;
          }
        }
      }
    }
  }

  for (const stageKey of stageKeys) {
    const stageRows = rows.filter((r) => rowStageKeys.get(r.xrayImageId) === stageKey);

    if (stageRows.length === 0) {
      continue;
    }

    const stageTarget = effectiveTargets.get(stageKey) ?? 0;
    if (stageTarget <= 0) {
      continue;
    }

    totalRequested += stageTarget;

    const rule = rulesByStage.get(stageKey)!;
    const portGroups = groupByPort(stageRows);
    const portKeys = Array.from(portGroups.keys());
    const portSizes = portKeys.map((k) => ({
      key: k,
      size: portGroups.get(k)!.length
    }));

    const apportioned = hamiltonApportionment(portSizes, stageTarget);
    const stageDrawnRows: PreparedPopulationRow[] = [];
    const stagePortAllocations: PortAllocation[] = [];

    for (const entry of apportioned) {
      const portRows = portGroups.get(entry.key)!;
      const certScanRows = portRows.filter((r) => r.certScanStatus === "Certscan");
      const nonCertScanRows = portRows.filter((r) => r.certScanStatus === "NonCertscan");

      let portCertScanTarget = 0;
      if (rule.certScanMethod === "percentage") {
        portCertScanTarget = Math.round((rule.certScanPercentage / 100) * entry.allocated);
      } else {
        const stageCertScanRows = stageRows.filter((r) => r.certScanStatus === "Certscan");
        if (stageCertScanRows.length > 0 && rule.certScanExactCount > 0) {
          const certApportioned = hamiltonApportionment(
            portKeys.map((k) => ({
              key: k,
              size: portGroups.get(k)!.filter((r) => r.certScanStatus === "Certscan").length
            })),
            Math.min(rule.certScanExactCount, stageCertScanRows.length)
          );
          portCertScanTarget = certApportioned.find((a) => a.key === entry.key)?.allocated ?? 0;
        }
      }

      const certScanQuota = Math.min(entry.allocated, portCertScanTarget);
      const actualCertQuota = Math.min(certScanQuota, certScanRows.length);
      const drawnCert = drawWithoutReplacement(certScanRows, actualCertQuota, rng);

      let nonCertScanQuota = entry.allocated - certScanQuota;
      if (rule.certScanStrategy === "preferred" && actualCertQuota < certScanQuota) {
        nonCertScanQuota += (certScanQuota - actualCertQuota);
      }

      const actualNonCertQuota = Math.min(nonCertScanQuota, nonCertScanRows.length);
      const drawnNonCert = drawWithoutReplacement(nonCertScanRows, actualNonCertQuota, rng);

      stageDrawnRows.push(...drawnCert, ...drawnNonCert);

      totalCertScanRequested += certScanQuota;
      totalNonCertScanRequested += nonCertScanQuota;
      totalCertScanActual += drawnCert.length;
      totalNonCertScanActual += drawnNonCert.length;

      stagePortAllocations.push({
        portName: entry.key,
        populationSize: portRows.length,
        certScanCount: certScanRows.length,
        nonCertScanCount: nonCertScanRows.length,
        allocatedQuota: entry.allocated,
        certScanQuota,
        nonCertScanQuota,
        actualCertScanDrawn: drawnCert.length,
        actualNonCertScanDrawn: drawnNonCert.length,
        actualTotalDrawn: drawnCert.length + drawnNonCert.length
      });
    }

    const stageUnderfill = stageTarget - stageDrawnRows.length;
    if (stageUnderfill > 0) {
      const spillResult = applySpillover(
        portGroups,
        stagePortAllocations,
        stageDrawnRows,
        stageUnderfill,
        rng
      );
      stageDrawnRows.push(...spillResult.extraRows);
      totalCertScanActual += spillResult.extraCert;
      totalNonCertScanActual += spillResult.extraNonCert;

      const allocByPort = new Map(stagePortAllocations.map((a) => [a.portName, a]));
      for (const row of spillResult.extraRows) {
        const portName = row.portName ?? "غير محدد";
        const alloc = allocByPort.get(portName);
        if (alloc) {
          alloc.actualTotalDrawn += 1;
          if (row.certScanStatus === "Certscan") {
            alloc.actualCertScanDrawn += 1;
          } else {
            alloc.actualNonCertScanDrawn += 1;
          }
        }
      }
    }

    allDrawnRows.push(...stageDrawnRows);

    const STAGE_LABELS_MAP: Record<string, string> = {
      first: "المستوى الأول", second: "المستوى الثاني",
      third: "المستوى الثالث", fourth: "المستوى الرابع"
    };
    stageAllocations.push({
      stageKey: stageKey as "first" | "second" | "third" | "fourth",
      stageLabel: STAGE_LABELS_MAP[stageKey] ?? stageKey,
      populationSize: stageRows.length,
      targetQuota: stageTarget,
      actualDrawn: stageDrawnRows.length,
      certScanDrawn: stageDrawnRows.filter(r => r.certScanStatus === "Certscan").length,
      nonCertScanDrawn: stageDrawnRows.filter(r => r.certScanStatus === "NonCertscan").length,
    });

    for (const alloc of stagePortAllocations) {
      const existing = portAllocationsMap.get(alloc.portName);
      if (existing) {
        existing.populationSize += alloc.populationSize;
        existing.certScanCount += alloc.certScanCount;
        existing.nonCertScanCount += alloc.nonCertScanCount;
        existing.allocatedQuota += alloc.allocatedQuota;
        existing.certScanQuota += alloc.certScanQuota;
        existing.nonCertScanQuota += alloc.nonCertScanQuota;
        existing.actualCertScanDrawn += alloc.actualCertScanDrawn;
        existing.actualNonCertScanDrawn += alloc.actualNonCertScanDrawn;
        existing.actualTotalDrawn += alloc.actualTotalDrawn;
      } else {
        portAllocationsMap.set(alloc.portName, { ...alloc });
      }
    }
  }

  const portAllocations = Array.from(portAllocationsMap.values());
  const data: SampleMasterData = {
    rngSeed,
    samplingAlgorithmVersion: SAMPLING_ALGORITHM_VERSION,
    totalRequested,
    totalActual: allDrawnRows.length,
    certScanRequested: totalCertScanRequested,
    nonCertScanRequested: totalNonCertScanRequested,
    certScanActual: totalCertScanActual,
    nonCertScanActual: totalNonCertScanActual,
    portAllocations,
    stageAllocations,
    drawnAt: new Date().toISOString(),
    drawnBy: username,
    rows: allDrawnRows
  };

  return { ok: true, data };
}

type SpilloverResult = {
  extraRows: PreparedPopulationRow[];
  extraCert: number;
  extraNonCert: number;
};

function applySpillover(
  portGroups: Map<string, PreparedPopulationRow[]>,
  allocations: PortAllocation[],
  alreadyDrawn: PreparedPopulationRow[],
  underfill: number,
  rng: ReturnType<typeof createRng>
): SpilloverResult {
  const drawnIds = new Set(alreadyDrawn.map((r) => r.xrayImageId));

  // Ports with remaining capacity (population > drawn)
  const candidates = allocations
    .map((a) => {
      const portRows = portGroups.get(a.portName)!;
      const remaining = portRows.filter((r) => !drawnIds.has(r.xrayImageId));
      return { portName: a.portName, remaining };
    })
    .filter((c) => c.remaining.length > 0);

  if (candidates.length === 0) {
    return { extraRows: [], extraCert: 0, extraNonCert: 0 };
  }

  const spillApportionment = hamiltonApportionment(
    candidates.map((c) => ({ key: c.portName, size: c.remaining.length })),
    underfill
  );

  const extraRows: PreparedPopulationRow[] = [];
  let extraCert = 0;
  let extraNonCert = 0;

  for (const entry of spillApportionment) {
    if (entry.allocated === 0) continue;
    const candidate = candidates.find((c) => c.portName === entry.key)!;
    const drawn = drawWithoutReplacement(
      candidate.remaining,
      entry.allocated,
      rng
    );
    extraRows.push(...drawn);
    extraCert += drawn.filter((r) => r.certScanStatus === "Certscan").length;
    extraNonCert += drawn.filter(
      (r) => r.certScanStatus === "NonCertscan"
    ).length;
  }

  return { extraRows, extraCert, extraNonCert };
}
