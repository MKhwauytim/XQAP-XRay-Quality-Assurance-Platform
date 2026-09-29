// A1: where a row's answer (and its local draft) lives, derived from the ROW the
// panel is rendering. The id-lookup it replaces (`folderForRow`) fell back to the
// selected month whenever the row had left the queue — the retained-draft case —
// which moved an ad-hoc row's draft key and save target to the wrong store.
import { isAdhocEntry, monthFolderForEntry } from "../../../../../../data/adhocImport/adhocImportEmployeeView";
import { answerDraftKey } from "../../../../../../data/answers/answerDraftStore";
import type { DistributionEntry } from "../../../../../../data/distribution/distributionTypes";

export function answerFolderForEntry(entry: DistributionEntry, selectedMonth: string): string {
  return monthFolderForEntry(entry, selectedMonth);
}

export function panelDraftKey(entry: DistributionEntry, selectedMonth: string): string {
  return answerDraftKey(answerFolderForEntry(entry, selectedMonth), entry.xrayImageId, entry.assignedTo);
}

/**
 * The key a draft for this row would have been saved under BEFORE this fix
 * (fix round 1): the old `folderForRow` used the globally selected month —
 * never the row's own ad-hoc store — whenever the row was missing from the
 * currently-loaded entries list, or whenever no month was selected at all
 * (`selectedMonth === ""`). Only an ad-hoc row's key can actually diverge —
 * a real row's folder was always `selectedMonth` either way — so this is
 * `null` for every other row, and also `null` on the rare case the two keys
 * would coincide anyway.
 *
 * Exists purely so an existing on-disk/in-browser draft saved under the old
 * key is still found and migrated forward — never for new writes, which
 * always go through `panelDraftKey` above.
 */
export function legacyPanelDraftKey(entry: DistributionEntry, selectedMonth: string): string | null {
  if (!isAdhocEntry(entry)) return null;
  const legacyKey = answerDraftKey(selectedMonth, entry.xrayImageId, entry.assignedTo);
  const canonicalKey = panelDraftKey(entry, selectedMonth);
  return legacyKey === canonicalKey ? null : legacyKey;
}
