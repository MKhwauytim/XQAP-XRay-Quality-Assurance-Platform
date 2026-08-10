import { formatStageLabel } from "../population/stageHelpers";
import type { SampleMasterData } from "../sampling/sampleTypes";
import type {
  ExecutiveReportConfig,
  ExecutiveReportRow,
  PortProfile,
  StageProfile,
} from "./executiveReportTypes";
import { aggregateDecisions, buildDecisionRecords, emptyCounts } from "./executive/model/decisionFactTable";
import type { Counts } from "./executive/model/decisionFactTable";

const UNKNOWN_PORT = "غير محدد";

function rate(num: number, den: number): number | null {
  return den > 0 ? (num / den) * 100 : null;
}

function groupRows(
  rows: ExecutiveReportRow[],
  keyFor: (row: ExecutiveReportRow) => string,
): Map<string, ExecutiveReportRow[]> {
  const groups = new Map<string, ExecutiveReportRow[]>();
  for (const row of rows) {
    const key = keyFor(row);
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(row);
    } else {
      groups.set(key, [row]);
    }
  }
  return groups;
}

/**
 * Status/threshold compliance (excellent/stable/monitor/priority/insufficient)
 * is deliberately computed from the DECISION grain's accuracy/missed-rate
 * (both levels tallied independently), not the IMAGE grain's — see
 * `PortProfile.status`'s doc comment. `reliable` still gates on the IMAGE
 * evaluable count (an unchanged population-sample-size check; "do we have
 * enough images with a reviewer verdict at this port"), so this is a swap of
 * WHICH accuracy number decides the label, not a change to when a port is
 * considered measurable at all.
 */
function determinePortStatus(
  reliable: boolean,
  accuracy: number | null,
  missedRate: number | null,
  config: ExecutiveReportConfig,
): PortProfile["status"] {
  if (!reliable || accuracy === null) return "insufficient";
  if (missedRate === null) return accuracy >= config.accuracyTarget ? "stable" : "monitor";
  if (
    accuracy >= config.accuracyTarget + 3 &&
    missedRate <= config.maximumMissedSuspicionRate / 2
  ) {
    return "excellent";
  }
  if (
    accuracy >= config.accuracyTarget &&
    missedRate <= config.maximumMissedSuspicionRate
  ) {
    return "stable";
  }
  return accuracy >= config.accuracyTarget - 5 ? "monitor" : "priority";
}

/**
 * `imageCounts`/`decisionCounts` both come from the SAME shared fold
 * (`aggregateDecisions` in `decisionFactTable.ts`), just at different grains
 * — see that function's doc comment. This function used to run its own
 * ad-hoc `verified`/`expertSuspicious` filters over `rows` to compute these
 * numbers independently of `aggregates.ts`'s `foldBy`; that independent
 * implementation is exactly what let the workbook/document/deck disagree on
 * a port's accuracy for the same generation run (2026-08-07 edit log).
 */
function buildPortProfile(
  portName: string,
  rows: ExecutiveReportRow[],
  imageCounts: Counts,
  decisionCounts: Counts,
  config: ExecutiveReportConfig,
): PortProfile {
  const population = rows.length;
  const clean = rows.filter((row) => row.imageResult === "سليمة").length;
  const suspicious = rows.filter((row) => row.imageResult === "اشتباه").length;
  const sampled = rows.filter((row) => row.selectedInSample);
  const studied = sampled.filter((row) => row.answerStatus === "submitted").length;

  // Unchanged population-sample-size gate: "do we have enough images with a
  // reviewer verdict at this port". `imageCounts.evaluable` is exactly the
  // old `verified.length` (both require only `expertResult !== null`).
  const reliable = imageCounts.evaluable >= config.minimumReliableSampleSize;

  const accuracyByImage = reliable
    ? rate(imageCounts.correctClean + imageCounts.correctSuspicion, imageCounts.evaluable)
    : null;
  const imageReviewerSuspicious = imageCounts.correctSuspicion + imageCounts.missedSuspicion;
  const suspiciousDetectionRateByImage =
    reliable && imageReviewerSuspicious > 0
      ? rate(imageCounts.correctSuspicion, imageReviewerSuspicious)
      : null;
  const missedSuspicionRateByImage =
    reliable && imageReviewerSuspicious > 0
      ? rate(imageCounts.missedSuspicion, imageReviewerSuspicious)
      : null;

  // Status/threshold compliance: DECISION grain, not image grain — see
  // `determinePortStatus`'s doc comment.
  const decisionAccuracy = reliable
    ? rate(decisionCounts.correctClean + decisionCounts.correctSuspicion, decisionCounts.evaluable)
    : null;
  const decisionReviewerSuspicious = decisionCounts.correctSuspicion + decisionCounts.missedSuspicion;
  const decisionMissedRate =
    reliable && decisionReviewerSuspicious > 0
      ? rate(decisionCounts.missedSuspicion, decisionReviewerSuspicious)
      : null;

  return {
    portName,
    population,
    clean,
    suspicious,
    suspicionRate: population > 0 ? (suspicious / population) * 100 : 0,
    sampleSize: sampled.length,
    coverage: population > 0 ? (sampled.length / population) * 100 : 0,
    studied,
    completionRate: sampled.length > 0 ? (studied / sampled.length) * 100 : 0,
    accuracyByImage,
    suspiciousDetectionRateByImage,
    missedSuspicionRateByImage,
    status: determinePortStatus(reliable, decisionAccuracy, decisionMissedRate, config),
  };
}

export function buildPortProfiles(
  rows: ExecutiveReportRow[],
  config: ExecutiveReportConfig,
): PortProfile[] {
  // `periodId` is not used by grouping/aggregation, only stamped onto records
  // for traceability elsewhere — harmless to pass "" for this internal fold.
  const factTable = buildDecisionRecords(rows, "");
  const imageMap = aggregateDecisions(factTable, "image", (r) => r.portName ?? UNKNOWN_PORT);
  const decisionMap = aggregateDecisions(factTable, "decision", (r) => r.portName ?? UNKNOWN_PORT);
  return [...groupRows(rows, (row) => row.portName ?? UNKNOWN_PORT)]
    .map(([portName, portRows]) =>
      buildPortProfile(
        portName,
        portRows,
        imageMap.get(portName) ?? emptyCounts(),
        decisionMap.get(portName) ?? emptyCounts(),
        config,
      )
    )
    .sort((left, right) => right.population - left.population);
}

export function buildStageProfiles(
  rows: ExecutiveReportRow[],
  sample: SampleMasterData | null,
): StageProfile[] {
  if (sample?.stageAllocations?.length) {
    return sample.stageAllocations.map((allocation) => {
      const studied = rows.filter(
        (row) =>
          row.selectedInSample &&
          row.answerStatus === "submitted" &&
          formatStageLabel(row.stage) === allocation.stageLabel,
      ).length;
      return {
        stageKey: allocation.stageKey,
        stageLabel: allocation.stageLabel,
        population: allocation.populationSize,
        sampleSize: allocation.actualDrawn,
        coverage:
          allocation.populationSize > 0
            ? (allocation.actualDrawn / allocation.populationSize) * 100
            : 0,
        studied,
        completionRate: allocation.actualDrawn > 0 ? (studied / allocation.actualDrawn) * 100 : 0,
      };
    });
  }

  return [...groupRows(rows, (row) => row.stage ?? "غير محدد")].map(
    ([stageLabel, stageRows], index) => {
      const sampled = stageRows.filter((row) => row.selectedInSample);
      const studied = sampled.filter((row) => row.answerStatus === "submitted").length;
      return {
        stageKey: String(index),
        stageLabel,
        population: stageRows.length,
        sampleSize: sampled.length,
        coverage: stageRows.length > 0 ? (sampled.length / stageRows.length) * 100 : 0,
        studied,
        completionRate: sampled.length > 0 ? (studied / sampled.length) * 100 : 0,
      };
    },
  );
}
