// Loads every distributed month into TrackingRows for the daily work report.
// Read-only. Mirrors the results page's row build (XrayInspectionResults
// `trackingRows`): ad-hoc and replaced entries are excluded, and each answer is
// classified under the template it was actually answered with.
import type { DirectoryHandleLike } from "../../storage/fileSystemAccess";
import { listMonthFolders } from "../../population/populationStorage";
import { loadSampleMaster } from "../../sampling/sampleStorage";
import { loadOrDeriveDistributionCurrentStrictForRead } from "../../distribution/distributionStorage";
import { loadAllEmployeeFiles } from "../../answers/answerStorage";
import type { ItemAnswer } from "../../answers/answerTypes";
import { isAdhocEntry } from "../../adhocImport/adhocImportEmployeeView";
import { loadTemplate } from "../../templates/templateStorage";
import { loadInspectionTemplateSelection } from "../../templates/templateSelectionStorage";
import { resolveAnswerTemplates, resolveTemplateForAnswer } from "../../templates/templateAnswerResolution";
import { classifyAnswerState, trackingDoneAt, type TrackingRow } from "../../tracking/deadlineTracking";
import { formatMonthLabel } from "../shared/reportChrome";
import type { DailyWorkMonthInput } from "./dailyWorkReport";

export type DailyWorkSource = {
  months: DailyWorkMonthInput[];
  /** Month labels that could not be read; the report says so instead of showing zeros. */
  failedMonths: string[];
};

export async function loadDailyWorkSource(directoryHandle: DirectoryHandleLike): Promise<DailyWorkSource> {
  const folders = await listMonthFolders(directoryHandle);
  folders.sort((a, b) => a.year - b.year || a.month - b.month);
  const selection = await loadInspectionTemplateSelection(directoryHandle);
  const activeTemplate = selection?.templateId ? await loadTemplate(directoryHandle, selection.templateId) : null;

  const months: DailyWorkMonthInput[] = [];
  const failedMonths: string[] = [];
  for (const folder of folders) {
    const label = formatMonthLabel(folder.folderName);
    try {
      const sampleMaster = await loadSampleMaster(directoryHandle, folder.folderName);
      if (!sampleMaster) continue;
      const distribution = await loadOrDeriveDistributionCurrentStrictForRead(
        directoryHandle,
        folder.folderName,
        sampleMaster.rows ?? [],
      );
      const entries = (distribution?.entries ?? []).filter((e) => !isAdhocEntry(e) && e.status !== "replaced");
      if (entries.length === 0) continue;

      const files = await loadAllEmployeeFiles(directoryHandle, folder.folderName);
      const answerByKey = new Map<string, ItemAnswer>();
      for (const file of files) {
        for (const item of file.items) answerByKey.set(`${item.xrayImageId}::${item.answeredBy}`, item);
      }
      const templatesById = await resolveAnswerTemplates(directoryHandle, activeTemplate, [...answerByKey.values()]);

      const rows: TrackingRow[] = [];
      for (const entry of entries) {
        const answer = answerByKey.get(`${entry.xrayImageId}::${entry.assignedTo}`) ?? null;
        const state = classifyAnswerState(entry.status, answer, resolveTemplateForAnswer(answer, templatesById, activeTemplate));
        if (state === "replaced") continue;
        rows.push({ assignedTo: entry.assignedTo, state, doneAt: trackingDoneAt(state, answer, entry.lastEventAt) });
      }
      months.push({ folderName: folder.folderName, label, rows });
    } catch {
      failedMonths.push(label);
    }
  }
  return { months, failedMonths };
}
