/**
 * Admin «حذف شهر»: removes a month's `1-population/{month}` and
 * `2-samples/{month}` folders from inside the app, replacing the by-hand folder
 * deletion an owner used for test months. Doing it here closes what the hand
 * deletion left open: this tab's folder and fold caches still pointed at the
 * month, and nothing told anyone what was deleted (it is now an audit action).
 * Other windows stop recreating the folders on their own — the derived cache
 * and the answer-event read no longer create a missing month folder.
 *
 * Guards, re-checked here at delete time (not only in the UI):
 *  - a CLOSED month is never deleted — a closed month is a finished real one;
 *  - a month with answers is deleted only when the caller acknowledged at
 *    least that many answers (test months are answered too, so answers alone
 *    cannot block it; the count the admin confirmed must still be current).
 *
 * This is a deliberate, confirmed hard delete of the month's folders, as the
 * hand deletion was. Backups taken earlier keep their copy.
 */
import { loadAllEmployeeFiles } from "../answers/answerStorage";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { bumpWorkspaceEpoch } from "../storage/inFlightReads";
import { isNotFoundError } from "../storage/transientFileErrors";
import { getPopulationRoot, getSamplesRoot, invalidateWorkspaceDirCache } from "../workspace/workspacePaths";
import { invalidateMonthLockCache, isMonthClosed } from "./monthLock";

export type MonthDeletionAssessment = {
  monthFolderName: string;
  closed: boolean;
  /** Answer items (draft or submitted) of every employee in the month. */
  answerCount: number;
  hasPopulation: boolean;
  hasSamples: boolean;
};

export type MonthDeletionResult =
  | { ok: true; assessment: MonthDeletionAssessment }
  | { ok: false; reason: "closed" | "not-found" | "answers-changed"; assessment: MonthDeletionAssessment };

async function hasChild(parent: () => Promise<DirectoryHandleLike>, name: string): Promise<boolean> {
  try {
    await (await parent()).getDirectoryHandle(name, { create: false });
    return true;
  } catch (error) {
    if (isNotFoundError(error)) return false;
    throw error;
  }
}

/** What deleting `monthFolderName` would remove. Throws when the answers cannot be counted — never guess "none". */
export async function assessMonthDeletion(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<MonthDeletionAssessment> {
  const [hasPopulation, hasSamples] = await Promise.all([
    hasChild(() => getPopulationRoot(directoryHandle, false), monthFolderName),
    hasChild(() => getSamplesRoot(directoryHandle, false), monthFolderName),
  ]);
  invalidateMonthLockCache();
  const closed = hasPopulation ? await isMonthClosed(directoryHandle, monthFolderName) : false;
  const files = hasSamples ? await loadAllEmployeeFiles(directoryHandle, monthFolderName, { strict: true }) : [];
  const answerCount = files.reduce((sum, file) => sum + file.items.length, 0);
  return { monthFolderName, closed, answerCount, hasPopulation, hasSamples };
}

async function removeChild(parent: () => Promise<DirectoryHandleLike>, name: string): Promise<void> {
  let dir: DirectoryHandleLike;
  try {
    dir = await parent();
  } catch (error) {
    if (isNotFoundError(error)) return;
    throw error;
  }
  try {
    await dir.removeEntry!(name, { recursive: true });
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
  }
}

export async function deleteMonth(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  acknowledgedAnswerCount: number
): Promise<MonthDeletionResult> {
  const assessment = await assessMonthDeletion(directoryHandle, monthFolderName);
  if (!assessment.hasPopulation && !assessment.hasSamples) return { ok: false, reason: "not-found", assessment };
  if (assessment.closed) return { ok: false, reason: "closed", assessment };
  if (assessment.answerCount > acknowledgedAnswerCount) return { ok: false, reason: "answers-changed", assessment };

  // Samples first: if the population removal then fails, the month is left
  // without a sample (redrawable), never with a sample and no population.
  await removeChild(() => getSamplesRoot(directoryHandle, false), monthFolderName);
  await removeChild(() => getPopulationRoot(directoryHandle, false), monthFolderName);

  invalidateWorkspaceDirCache(directoryHandle);
  invalidateMonthLockCache();
  bumpWorkspaceEpoch(directoryHandle, monthFolderName);
  return { ok: true, assessment };
}
