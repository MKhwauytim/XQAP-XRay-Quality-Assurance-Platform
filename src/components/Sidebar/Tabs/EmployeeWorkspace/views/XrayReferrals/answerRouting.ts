// A1: where a row's answer (and its local draft) lives, derived from the ROW the
// panel is rendering. The id-lookup it replaces (`folderForRow`) fell back to the
// selected month whenever the row had left the queue — the retained-draft case —
// which moved an ad-hoc row's draft key and save target to the wrong store.
import { monthFolderForEntry } from "../../../../../../data/adhocImport/adhocImportEmployeeView";
import { answerDraftKey } from "../../../../../../data/answers/answerDraftStore";
import type { DistributionEntry } from "../../../../../../data/distribution/distributionTypes";

export function answerFolderForEntry(entry: DistributionEntry, selectedMonth: string): string {
  return monthFolderForEntry(entry, selectedMonth);
}

export function panelDraftKey(entry: DistributionEntry, selectedMonth: string): string {
  return answerDraftKey(answerFolderForEntry(entry, selectedMonth), entry.xrayImageId, entry.assignedTo);
}
