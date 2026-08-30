// Pure, side-effect-free grouping helpers shared by Section 1/2 (population/
// sample rows) and Section 3 (per-employee distribution entries) of تقرير
// المجتمع. Every grouping in this report uses the same سليمة/اشتباه/total
// grain (spec §4.3) — one set of helpers, reused with different row sources,
// rather than re-deriving the fold per section.
import { classifyImageResult } from "../../population/imageResult";
import { getStageKey } from "../../population/stageHelpers";
import type { PreparedPopulationRow } from "../../population/populationTypes";
import type { DistributionEntry } from "../../distribution/distributionTypes";
import type {
  ResultCounts,
  StageBucket,
  PortBucket,
  PortBreakdown,
  EmployeeStageRow,
  EmployeePortRow,
  EmployeeCertScanRow,
} from "./types";

// Local label map, not imported from stageHelpers.ts (STAGE_LABELS_AR there is
// module-private, and formatStageLabel() expects a RAW stage value to
// re-derive the key from — passing an already-canonical key like "first"
// back through it would misclassify to "unknown"). Same pattern
// sampleReport.ts/distributionReport.ts already use for their own label maps.
export const STAGE_LABELS: Record<string, string> = {
  first: "المستوى الأول",
  second: "المستوى الثاني",
  third: "المستوى الثالث",
  fourth: "المستوى الرابع",
  unknown: "غير محدد",
};

const STAGE_ORDER = ["first", "second", "third", "fourth", "unknown"];

function emptyCounts(): ResultCounts {
  return { سليمة: 0, اشتباه: 0, total: 0 };
}

function addResult(counts: ResultCounts, result: "سليمة" | "اشتباه"): void {
  counts[result] += 1;
  counts.total += 1;
}

function isSeaPort(portType: string | null | undefined): boolean {
  return (portType ?? "").includes("بحري");
}

export function groupRowsByStage(rows: PreparedPopulationRow[]): StageBucket[] {
  const buckets = new Map<string, ResultCounts>();
  for (const row of rows) {
    const key = getStageKey(row.stage);
    const counts = buckets.get(key) ?? emptyCounts();
    addResult(counts, classifyImageResult(row.xrayLevelOneResult, row.xrayLevelTwoResult));
    buckets.set(key, counts);
  }
  return STAGE_ORDER.filter((key) => buckets.has(key)).map((stageKey) => ({
    stageKey,
    stageLabel: STAGE_LABELS[stageKey] ?? stageKey,
    counts: buckets.get(stageKey)!,
  }));
}

export function groupRowsByPort(rows: PreparedPopulationRow[]): PortBreakdown {
  const map = new Map<string, { sea: boolean; counts: ResultCounts }>();
  for (const row of rows) {
    const name = row.portName ?? "غير محدد";
    let bucket = map.get(name);
    if (!bucket) {
      bucket = { sea: isSeaPort(row.portType), counts: emptyCounts() };
      map.set(name, bucket);
    }
    addResult(bucket.counts, classifyImageResult(row.xrayLevelOneResult, row.xrayLevelTwoResult));
  }
  const all: PortBucket[] = [...map.entries()].map(([portName, b]) => ({ portName, counts: b.counts }));
  const seaNames = new Set([...map.entries()].filter(([, b]) => b.sea).map(([name]) => name));
  const bySize = (a: PortBucket, b: PortBucket) => b.counts.total - a.counts.total;
  return {
    land: all.filter((p) => !seaNames.has(p.portName)).sort(bySize),
    sea: all.filter((p) => seaNames.has(p.portName)).sort(bySize),
  };
}

export function sumCounts(buckets: Array<{ counts: ResultCounts }>): ResultCounts {
  const total = emptyCounts();
  for (const b of buckets) {
    total.سليمة += b.counts.سليمة;
    total.اشتباه += b.counts.اشتباه;
    total.total += b.counts.total;
  }
  return total;
}

export function groupEntriesByEmployeeStage(
  entries: DistributionEntry[],
  employeeDisplayNames: Record<string, string>
): { rows: EmployeeStageRow[]; stageKeysPresent: string[] } {
  const byUser = new Map<string, EmployeeStageRow>();
  const stageKeysSeen = new Set<string>();
  for (const entry of entries) {
    const stageKey = getStageKey(entry.row.stage);
    stageKeysSeen.add(stageKey);
    let user = byUser.get(entry.assignedTo);
    if (!user) {
      user = {
        username: entry.assignedTo,
        displayName: employeeDisplayNames[entry.assignedTo] ?? entry.assignedTo,
        stages: {},
        total: emptyCounts(),
      };
      byUser.set(entry.assignedTo, user);
    }
    const result = classifyImageResult(entry.row.xrayLevelOneResult, entry.row.xrayLevelTwoResult);
    const stageCounts = user.stages[stageKey] ?? emptyCounts();
    addResult(stageCounts, result);
    user.stages[stageKey] = stageCounts;
    addResult(user.total, result);
  }
  const rows = [...byUser.values()].sort((a, b) => b.total.total - a.total.total);
  const stageKeysPresent = STAGE_ORDER.filter((key) => stageKeysSeen.has(key));
  return { rows, stageKeysPresent };
}

export function groupEntriesByEmployeePort(
  entries: DistributionEntry[],
  employeeDisplayNames: Record<string, string>
): EmployeePortRow[] {
  const byUser = new Map<string, EmployeePortRow>();
  for (const entry of entries) {
    const sea = isSeaPort(entry.row.portType);
    let user = byUser.get(entry.assignedTo);
    if (!user) {
      user = {
        username: entry.assignedTo,
        displayName: employeeDisplayNames[entry.assignedTo] ?? entry.assignedTo,
        ports: { land: emptyCounts(), sea: emptyCounts() },
        total: emptyCounts(),
      };
      byUser.set(entry.assignedTo, user);
    }
    const result = classifyImageResult(entry.row.xrayLevelOneResult, entry.row.xrayLevelTwoResult);
    addResult(user.ports[sea ? "sea" : "land"], result);
    addResult(user.total, result);
  }
  return [...byUser.values()].sort((a, b) => b.total.total - a.total.total);
}

export function groupEntriesByEmployeeCertScan(
  entries: DistributionEntry[],
  employeeDisplayNames: Record<string, string>
): EmployeeCertScanRow[] {
  const byUser = new Map<string, EmployeeCertScanRow>();
  for (const entry of entries) {
    let user = byUser.get(entry.assignedTo);
    if (!user) {
      user = {
        username: entry.assignedTo,
        displayName: employeeDisplayNames[entry.assignedTo] ?? entry.assignedTo,
        certScanCount: 0,
        nonCertScanCount: 0,
        total: 0,
      };
      byUser.set(entry.assignedTo, user);
    }
    // Spec §4.5: degrade to neither bucket (never crash) when certScanStatus
    // is absent on a pre-B5 legacy distribution entry.
    if (entry.row.certScanStatus === "Certscan") user.certScanCount += 1;
    else if (entry.row.certScanStatus === "NonCertscan") user.nonCertScanCount += 1;
    user.total += 1;
  }
  return [...byUser.values()].sort((a, b) => b.certScanCount - a.certScanCount);
}
