import { loadOrDeriveDistributionCurrentForRead, loadDistributionCurrentRevision } from "../distribution/distributionStorage";
import { loadMonthPopulationFinal, loadMonthPopulationFinalRevision, loadProcessingSummary } from "../population/populationStorage";
import { loadPopulationConfig } from "../population/populationConfig";
import type { PreparedPopulationRow } from "../population/populationTypes";
import { loadSampleMaster, loadSampleMasterRevision } from "../sampling/sampleStorage";
import { loadAllEmployeeFiles } from "../answers/answerStorage";
import { loadTemplate } from "../templates/templateStorage";
import { loadInspectionTemplateSelection } from "../templates/templateSelectionStorage";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { DEFAULT_EXEC_CONFIG } from "./executiveReportTypes";
import type { ExecutiveReportInput } from "./executiveReportTypes";
import { collectRevisions } from "./sourceRevisions";

/**
 * Assemble the executive-report input for one month from disk -- the SAME
 * inputs that feed openExecutiveReport / openExecutiveDeckV2 /
 * buildExecutiveXlsx, so the live dashboard and the exported artifacts can
 * never disagree.
 */
export async function loadMonthExecInput(directoryHandle: DirectoryHandleLike, month: string): Promise<ExecutiveReportInput | null> {
  const [populationFinal, sample, employeeFiles, templateSelection, popRev, sampleRev, distRev, processingSummary, populationConfig] = await Promise.all([
    loadMonthPopulationFinal(directoryHandle, month),
    loadSampleMaster(directoryHandle, month),
    loadAllEmployeeFiles(directoryHandle, month),
    loadInspectionTemplateSelection(directoryHandle),
    loadMonthPopulationFinalRevision(directoryHandle, month),
    loadSampleMasterRevision(directoryHandle, month),
    loadDistributionCurrentRevision(directoryHandle, month),
    // Feeds the executive workbook's "الصفوف المستبعدة" sheet with the real
    // dropped-row list instead of a placeholder note (see
    // `ExecutiveReportInput.processingSummary`'s doc comment). Best-effort —
    // `loadProcessingSummary` already resolves to null on any read failure.
    loadProcessingSummary(directoryHandle, month),
    // C1: the workspace's own stage alias table, so every stage grouping in
    // the report classifies a custom alias the way processing did.
    loadPopulationConfig(directoryHandle),
  ]);
  if (!populationFinal) return null;
  const template = templateSelection?.templateId
    ? await loadTemplate(directoryHandle, templateSelection.templateId)
    : null;
  const distribution = sample
    ? await loadOrDeriveDistributionCurrentForRead(directoryHandle, month, sample.rows)
    : null;
  // B2: cite the exact source-file revisions this report was built from.
  const sourceRevisions = collectRevisions([
    ["population.final.json", popRev],
    ["sample.master.json", sampleRev],
    ["distribution.current.json", distRev],
  ]);
  return {
    monthFolderName: month,
    populationRows: populationFinal.rows as unknown as PreparedPopulationRow[],
    sample: sample ?? null,
    distribution: distribution ?? null,
    employeeFiles,
    template,
    config: DEFAULT_EXEC_CONFIG,
    sourceRevisions,
    processingSummary,
    stageMappings: populationConfig.stageMappings,
  };
}
