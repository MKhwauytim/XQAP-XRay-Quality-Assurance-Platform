import { liveSampleRows } from "../sampling/sampleStorage";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { loadMonthPopulationFinal } from "../population/populationStorage";
import { loadSampleMaster } from "../sampling/sampleStorage";
import { loadOrDeriveDistributionCurrent } from "../distribution/distributionStorage";
import { loadAllEmployeeFiles } from "../answers/answerStorage";
import { buildExecutiveReportRows } from "../reporting/executiveReportData";
import { DEFAULT_EXEC_CONFIG } from "../reporting/executiveReportTypes";
import type { PreparedPopulationRow } from "../population/populationTypes";
import type { ExportManifest } from "./exportTypes";
import { writeCsvExport } from "./exportWriter";

const POPULATION_HEADERS = [
  "xrayImageId", "portName", "portType", "stage",
  "levelOneResult", "levelTwoResult", "imageResult",
  "selectedInSample", "assignedTo", "distributionStatus", "expertResult",
  "imageAvailable", "noImageReason", "hasMarking", "imageQuality",
  "lowQualityReason", "suspicionLevel", "suspectedTypes", "smuggleMethod",
  "answerStatus", "assignedAt", "submittedAt",
  "imageResultAccurate", "levelOneAccurate", "levelTwoAccurate", "verificationCategory",
];

// A2: sample.csv (the file that carries snapshot rows) gets one extra column, at
// the END, so a Power BI report can tell a row rebuilt from the sample snapshot
// from a population row. population.csv never contains such rows, so it is unchanged.
const SAMPLE_HEADERS = [...POPULATION_HEADERS, "fromSampleSnapshot"];

export type PowerBiExportResult = { manifest: ExportManifest; snapshotRowCount: number };

export async function runPowerBiExportDetailed(
  root: DirectoryHandleLike,
  month: string
): Promise<PowerBiExportResult> {
  const populationData = await loadMonthPopulationFinal(root, month);
  const sample = await loadSampleMaster(root, month);
  // Retired-by-replacement rows are excluded here for the same reason as in the
  // executive report: they are audit trail, not live sample.
  const sampleRows = liveSampleRows(sample);
  // A6a: export is a pure read — never persist the derived cache from here.
  const distribution = await loadOrDeriveDistributionCurrent(root, month, sampleRows, {
    persistCache: false,
  });
  const employeeFiles = await loadAllEmployeeFiles(root, month);

  const execRows = buildExecutiveReportRows({
    monthFolderName: month,
    populationRows: (populationData?.rows ?? []) as PreparedPopulationRow[],
    sample: sample ?? null,
    distribution: distribution ?? null,
    employeeFiles,
    template: null,
    config: DEFAULT_EXEC_CONFIG,
  });

  // A2: rows rebuilt from the sample snapshot are not population rows —
  // population.csv stays the population; sample.csv keeps them so their
  // answers are not lost.
  const snapshotRowCount = execRows.filter((r) => r.fromSampleSnapshot).length;
  const allRows: Record<string, unknown>[] = execRows.map((r) => r as Record<string, unknown>);
  const populationRowsOut = snapshotRowCount > 0 ? allRows.filter((r) => r["fromSampleSnapshot"] !== true) : allRows;
  const sampleRowsOut = allRows.filter((r) => r["selectedInSample"] === true);

  const manifest = await writeCsvExport(root, month, [
    { fileName: "population.csv", headers: POPULATION_HEADERS, rows: populationRowsOut },
    { fileName: "sample.csv", headers: SAMPLE_HEADERS, rows: sampleRowsOut },
  ]);
  return { manifest, snapshotRowCount };
}

/** The manifest alone — the long-standing contract (golden-tested). */
export async function runPowerBiExport(root: DirectoryHandleLike, month: string): Promise<ExportManifest> {
  return (await runPowerBiExportDetailed(root, month)).manifest;
}
