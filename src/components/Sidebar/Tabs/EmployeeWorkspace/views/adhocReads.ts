import type { ItemAnswer } from "../../../../../data/answers/answerTypes";
import {
  loadAdhocAnswerItems,
  loadAdhocEntriesForEmployeeView,
  type AdhocDistributionEntry,
} from "../../../../../data/adhocImport/adhocImportEmployeeView";
import type { DirectoryHandleLike } from "../../../../../data/storage/fileSystemAccess";
import { logError } from "../../../../../data/storage/errorLogger";

/**
 * Start both ad-hoc reads for the load phase, without awaiting either.
 *
 * THE GAP fix: ad-hoc-imported assignments live in a synthetic
 * `2-samples/adhoc-{importId}/` folder, never the selected month's own
 * sample.master.json, so they are merged in alongside an employee's real
 * assignments. Their ANSWERS live there too — handleSave routes an ad-hoc row's
 * write through folderForRow, so reading answers for the selected month alone
 * never found them and every ad-hoc row came back unanswered after a reload.
 *
 * The answers read is CHAINED off the entries read (it needs their stores)
 * rather than awaited separately, so it still overlaps the rest of the load
 * phase. Entries degrade to [] on any failure; see adhocImportEmployeeView.ts's
 * docblock for the cost bound. Lives outside the component only to keep
 * `XrayReferrals` inside the max-lines-per-function budget.
 *
 * `monthFolderName` scopes the probe to the selected month, so an employee's
 * view opens only that month's ad-hoc import stores rather than every import
 * in the workspace.
 */
export function beginAdhocReads(
  directoryHandle: DirectoryHandleLike,
  username: string,
  canSeeAll: boolean,
  monthFolderName: string
): { entries: Promise<AdhocDistributionEntry[]>; answers: Promise<ItemAnswer[]> } {
  const entries = loadAdhocEntriesForEmployeeView(directoryHandle, username, canSeeAll, monthFolderName).catch(
    (err) => {
      logError("xrayReferrals:loadAdhocEntries", err);
      return [] as AdhocDistributionEntry[];
    }
  );
  return {
    entries,
    answers: entries.then((list) => loadAdhocAnswerItems(directoryHandle, list)),
  };
}
