import { loadAllEmployeeFiles } from "../../../../../data/answers/answerStorage";
import type { ItemAnswer } from "../../../../../data/answers/answerTypes";
import {
  loadDistributionLogForRead,
  loadOrDeriveDistributionCurrentStrictForRead,
} from "../../../../../data/distribution/distributionStorage";
import type { DistributionEntry, DistributionEvent } from "../../../../../data/distribution/distributionTypes";
import { loadReferralLog, loadReplacementLog } from "../../../../../data/referral/referralStorage";
import type { ReferralRequest, ReplacementRequest } from "../../../../../data/referral/referralTypes";
import { loadSampleMaster } from "../../../../../data/sampling/sampleStorage";
import { logError } from "../../../../../data/storage/errorLogger";
import type { DirectoryHandleLike } from "../../../../../data/storage/fileSystemAccess";

/** Everything the results page reads for one month, unjoined. */
export type MonthResultBundle = {
  monthFolder: string;
  entries: DistributionEntry[];
  events: DistributionEvent[];
  referralRequests: ReferralRequest[];
  replacementRequests: ReplacementRequest[];
  answerItems: ItemAnswer[];
};

export type AllMonthsResults = {
  bundles: MonthResultBundle[];
  /** Months that could not be read. The page names them instead of showing them as empty. */
  failedMonths: string[];
};

/**
 * The results page's «جميع النتائج في النظام» read: the same files the page reads
 * for the selected month, for every month folder.
 *
 * Months are read one after another, not in parallel: on the shared folder a
 * burst of parallel month reads slows every other user's saves. Read-only, and
 * the derived distribution cache is not written from here.
 *
 * A month with no sample is skipped. A month that fails to read is reported in
 * `failedMonths` and the others still load.
 */
export async function loadAllMonthsResults(
  directoryHandle: DirectoryHandleLike,
  monthFolders: readonly string[]
): Promise<AllMonthsResults> {
  const bundles: MonthResultBundle[] = [];
  const failedMonths: string[] = [];
  for (const monthFolder of monthFolders) {
    try {
      const sampleMaster = await loadSampleMaster(directoryHandle, monthFolder);
      if (!sampleMaster) continue;
      const distribution = await loadOrDeriveDistributionCurrentStrictForRead(
        directoryHandle,
        monthFolder,
        sampleMaster.rows ?? []
      );
      const [log, referralLog, replacementLog, answerFiles] = await Promise.all([
        loadDistributionLogForRead(directoryHandle, monthFolder),
        loadReferralLog(directoryHandle, monthFolder),
        loadReplacementLog(directoryHandle, monthFolder),
        loadAllEmployeeFiles(directoryHandle, monthFolder),
      ]);
      bundles.push({
        monthFolder,
        entries: distribution?.entries ?? [],
        events: log.events,
        referralRequests: referralLog.requests,
        replacementRequests: replacementLog.requests,
        answerItems: answerFiles.flatMap((file) => file.items),
      });
    } catch (error) {
      logError("allMonthsResults:loadMonth", error);
      failedMonths.push(monthFolder);
    }
  }
  return { bundles, failedMonths };
}
