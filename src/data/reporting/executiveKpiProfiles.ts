import { formatStageLabel } from "../population/stageHelpers";
import type { SampleMasterData } from "../sampling/sampleTypes";
import type {
  ExecutiveReportConfig,
  ExecutiveReportRow,
  PortProfile,
  StageProfile,
} from "./executiveReportTypes";

function groupRows(
  rows: ExecutiveReportRow[],
  keyFor: (row: ExecutiveReportRow) => string,
): Map<string, ExecutiveReportRow[]> {
  const groups = new Map<string, ExecutiveReportRow[]>();
  for (const row of rows) {
    const key = keyFor(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return groups;
}

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

function buildPortProfile(
  portName: string,
  rows: ExecutiveReportRow[],
  config: ExecutiveReportConfig,
): PortProfile {
  const population = rows.length;
  const clean = rows.filter((row) => row.imageResult === "سليمة").length;
  const suspicious = rows.filter((row) => row.imageResult === "اشتباه").length;
  const sampled = rows.filter((row) => row.selectedInSample);
  const studied = sampled.filter((row) => row.answerStatus === "submitted").length;
  const verified = rows.filter((row) => row.verificationCategory !== null);
  const reliable = verified.length >= config.minimumReliableSampleSize;
  const correct = verified.filter((row) => row.imageResultAccurate === true).length;
  const expertSuspicious = verified.filter(
    (row) =>
      row.verificationCategory === "correct-suspicious" ||
      row.verificationCategory === "missed-suspicious",
  );
  const correctlyDetected = expertSuspicious.filter(
    (row) => row.verificationCategory === "correct-suspicious",
  ).length;
  const missed = expertSuspicious.filter(
    (row) => row.verificationCategory === "missed-suspicious",
  ).length;
  const accuracy = reliable ? (correct / verified.length) * 100 : null;
  const suspiciousDetectionRate =
    reliable && expertSuspicious.length > 0
      ? (correctlyDetected / expertSuspicious.length) * 100
      : null;
  const missedSuspicionRate =
    reliable && expertSuspicious.length > 0 ? (missed / expertSuspicious.length) * 100 : null;

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
    accuracy,
    suspiciousDetectionRate,
    missedSuspicionRate,
    levelOneAccuracy:
      reliable
        ? (verified.filter((row) => row.levelOneAccurate === true).length / verified.length) * 100
        : null,
    levelTwoAccuracy:
      reliable
        ? (verified.filter((row) => row.levelTwoAccurate === true).length / verified.length) * 100
        : null,
    status: determinePortStatus(reliable, accuracy, missedSuspicionRate, config),
  };
}

export function buildPortProfiles(
  rows: ExecutiveReportRow[],
  config: ExecutiveReportConfig,
): PortProfile[] {
  return [...groupRows(rows, (row) => row.portName ?? "غير محدد")]
    .map(([portName, portRows]) => buildPortProfile(portName, portRows, config))
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
