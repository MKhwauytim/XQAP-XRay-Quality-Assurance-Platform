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

export async function runPowerBiExport(
  root: DirectoryHandleLike,
  month: string
): Promise<ExportManifest> {
  const populationData = await loadMonthPopulationFinal(root, month);
  const sample = await loadSampleMaster(root, month);
  const sampleRows = sample?.rows ?? [];
  const distribution = await loadOrDeriveDistributionCurrent(root, month, sampleRows);
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

  const allRows: Record<string, unknown>[] = execRows.map((r) => r as Record<string, unknown>);
  const sampleRowsOut = allRows.filter((r) => r["selectedInSample"] === true);

  return writeCsvExport(root, month, [
    { fileName: "population.csv", headers: POPULATION_HEADERS, rows: allRows },
    { fileName: "sample.csv", headers: POPULATION_HEADERS, rows: sampleRowsOut },
  ]);
}
