import {
  groupRowsByStage,
  groupRowsByPort,
  sumCounts,
  groupEntriesByEmployeeStage,
  groupEntriesByEmployeePort,
  groupEntriesByEmployeeCertScan,
} from "./fold";
import { formatMonthLabel } from "../shared/reportChrome";
import type { PreparedPopulationRow, ProcessingSummary } from "../../population/populationTypes";
import type { MonthManifestData } from "../../population/monthTypes";
import type { DistributionEntry } from "../../distribution/distributionTypes";
import type {
  StageBucket,
  PortBreakdown,
  ResultCounts,
  EmployeeStageRow,
  EmployeePortRow,
  EmployeeCertScanRow,
} from "./types";
import type { SourceRevisions } from "../sourceRevisions";

export type PopulationReportInput = {
  monthFolderName: string;
  manifest: MonthManifestData | null;
  processingSummary: ProcessingSummary | null;
  riskRawRowCount: number;
  biRawRowCount: number | null;
  populationRows: PreparedPopulationRow[];
  sampleRows: PreparedPopulationRow[];
  distributionEntries: DistributionEntry[];
  employeeDisplayNames: Record<string, string>;
  sourceRevisions?: SourceRevisions;
};

export type PopulationReportModel = {
  monthFolderName: string;
  monthLabel: string;
  reconciled: {
    riskRawRowCount: number;
    biRawRowCount: number | null;
    processingSummary: ProcessingSummary | null;
    byStage: StageBucket[];
    byPort: PortBreakdown;
    totals: ResultCounts;
  };
  sample: {
    byStage: StageBucket[];
    byPort: PortBreakdown;
    totals: ResultCounts;
  };
  distribution: {
    byEmployeeStage: EmployeeStageRow[];
    byEmployeePort: EmployeePortRow[];
    certScanByEmployee: EmployeeCertScanRow[];
    stageKeysPresent: string[];
  };
  sourceRevisions?: SourceRevisions;
};

export function computePopulationReportModel(input: PopulationReportInput): PopulationReportModel {
  const reconciledByStage = groupRowsByStage(input.populationRows);
  const reconciledByPort = groupRowsByPort(input.populationRows);
  const sampleByStage = groupRowsByStage(input.sampleRows);
  const sampleByPort = groupRowsByPort(input.sampleRows);
  const { rows: byEmployeeStage, stageKeysPresent } = groupEntriesByEmployeeStage(
    input.distributionEntries,
    input.employeeDisplayNames
  );
  const byEmployeePort = groupEntriesByEmployeePort(input.distributionEntries, input.employeeDisplayNames);
  const certScanByEmployee = groupEntriesByEmployeeCertScan(input.distributionEntries, input.employeeDisplayNames);

  return {
    monthFolderName: input.monthFolderName,
    monthLabel: formatMonthLabel(input.monthFolderName),
    reconciled: {
      riskRawRowCount: input.riskRawRowCount,
      biRawRowCount: input.biRawRowCount,
      processingSummary: input.processingSummary,
      byStage: reconciledByStage,
      byPort: reconciledByPort,
      totals: sumCounts(reconciledByStage),
    },
    sample: {
      byStage: sampleByStage,
      byPort: sampleByPort,
      totals: sumCounts(sampleByStage),
    },
    distribution: {
      byEmployeeStage,
      byEmployeePort,
      certScanByEmployee,
      stageKeysPresent,
    },
    sourceRevisions: input.sourceRevisions,
  };
}
