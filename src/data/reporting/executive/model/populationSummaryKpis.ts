import { STAGE_SAMPLE_TARGETS } from "../../../population/populationConfig";
import { compareStageKeys, getStageKey, stageLabelForKey, type StageAliasMappings } from "../../../population/stageHelpers";
import type {
  ExecutiveKPIs,
  PopulationBucket,
  PopulationSummary,
  PortProfile,
  StageProfile,
} from "../../executiveReportTypes";

/**
 * Overlays a workbook's population totals onto the KPIs of a `rowsOverride`
 * (comprehensive) report, whose rows are completed samples only. Population,
 * clean/suspicious and coverage come from the summary; every sample-scoped
 * figure (sample size, studied, accuracy, status) is left exactly as the rows
 * produced it. Pure; never mutates its inputs.
 */
/** Sample target of one level for the report period; undefined when the level has no defined target. */
function stageTarget(stageKey: string, population: number, months: number): number | undefined {
  if (stageKey === "first") return population;
  const monthly = STAGE_SAMPLE_TARGETS[stageKey as keyof typeof STAGE_SAMPLE_TARGETS];
  return typeof monthly === "number" ? monthly * months : undefined;
}

/** Samples taken over targets set, across the levels that have a target; the plain sample ÷ population share when none does. */
function overallCoverage(stages: StageProfile[], totalSample: number, totalPopulation: number): number {
  const withTarget = stages.filter((s) => s.target !== undefined);
  const target = withTarget.reduce((a, s) => a + (s.target ?? 0), 0);
  if (target > 0) return (withTarget.reduce((a, s) => a + s.sampleSize, 0) / target) * 100;
  return totalPopulation > 0 ? (totalSample / totalPopulation) * 100 : 0;
}

export function applyPopulationSummary(
  kpis: ExecutiveKPIs,
  summary: PopulationSummary,
  stageMappings?: Partial<StageAliasMappings>,
): ExecutiveKPIs {
  const sumOf = (f: (b: PopulationBucket) => number) =>
    Object.values(summary.byStage).reduce((s, b) => s + f(b), 0);
  const total = summary.total;
  const clean = sumOf((b) => b.clean);
  const suspicious = sumOf((b) => b.suspicious);

  // Stage buckets under their canonical key (several raw aliases can share one).
  const stageBuckets = new Map<string, number>();
  for (const [raw, b] of Object.entries(summary.byStage)) {
    const key = getStageKey(raw, stageMappings);
    stageBuckets.set(key, (stageBuckets.get(key) ?? 0) + b.total);
  }
  const stageByKey = new Map<string, StageProfile>(kpis.stageProfiles.map((s) => [s.stageKey, s]));
  for (const key of stageBuckets.keys()) {
    if (!stageByKey.has(key)) {
      stageByKey.set(key, { stageKey: key, stageLabel: stageLabelForKey(key), population: 0, sampleSize: 0, coverage: 0, studied: 0, completionRate: 0 });
    }
  }
  // Months the report covers = the workbook's population sheets (one per month).
  const months = Math.max(1, summary.sheets.length);
  const stageProfiles = [...stageByKey.values()]
    .map((s): StageProfile => {
      const population = stageBuckets.get(s.stageKey) ?? 0;
      const target = stageTarget(s.stageKey, population, months);
      // Coverage is measured against the TARGET: level 1 is a full census of its population, levels 2-4 a fixed monthly count.
      const coverage = target !== undefined && target > 0 ? (s.sampleSize / target) * 100 : population > 0 ? (s.sampleSize / population) * 100 : 0;
      return { ...s, population, coverage, ...(target !== undefined ? { target } : {}) };
    })
    .sort((a, b) => compareStageKeys(a.stageKey, b.stageKey));

  const portByName = new Map<string, PortProfile>(kpis.portProfiles.map((p) => [p.portName, p]));
  for (const p of summary.byPort) {
    if (!portByName.has(p.name)) {
      portByName.set(p.name, {
        portName: p.name, population: 0, clean: 0, suspicious: 0, suspicionRate: 0, sampleSize: 0, coverage: 0,
        studied: 0, completionRate: 0, accuracyByImage: null, suspiciousDetectionRateByImage: null,
        missedSuspicionRateByImage: null, status: "insufficient",
      });
    }
  }
  const popPort = new Map(summary.byPort.map((p) => [p.name, p]));
  const portProfiles = [...portByName.values()]
    .map((p): PortProfile => {
      const b = popPort.get(p.portName);
      const population = b?.total ?? 0;
      return {
        ...p,
        population,
        clean: b?.clean ?? 0,
        suspicious: b?.suspicious ?? 0,
        suspicionRate: population > 0 ? ((b?.suspicious ?? 0) / population) * 100 : 0,
        coverage: population > 0 ? (p.sampleSize / population) * 100 : 0,
      };
    })
    .sort((a, b) => b.population - a.population);

  return {
    ...kpis,
    totalPopulation: total,
    cleanCount: clean,
    suspiciousCount: suspicious,
    suspicionRate: total > 0 ? (suspicious / total) * 100 : 0,
    sampleCoverage: overallCoverage(stageProfiles, kpis.totalSample, total),
    stageProfiles,
    portProfiles,
  };
}
