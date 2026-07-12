import type { DistributionCurrentData, DistributionEntry } from "../distribution/distributionTypes";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeReadJson, safeWriteJson } from "../storage/safeWrite";
import {
  getSampleEmployeeDir,
  getSampleMainDir,
  safeWorkspaceFilePart,
} from "../workspace/workspacePaths";
import { listMonthFolders } from "../population/populationStorage";
import { isMonthClosed } from "../population/monthLock";
import { loadEmployeeAnswers } from "../answers/answerStorage";

export type MainSamplesFile = {
  monthFolderName: string;
  updatedAt: string;
  sourceLogRevision: number;
  entries: DistributionEntry[];
};

export type EmployeeSamplesFile = MainSamplesFile & {
  username: string;
};

const MAIN_SAMPLES_FILE = "main.samples.json";

function employeeSamplesFileName(username: string): string {
  return `${safeWorkspaceFilePart(username)}.samples.json`;
}

export async function syncSampleMirrors(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  current: DistributionCurrentData
): Promise<void> {
  const updatedAt = new Date().toISOString();
  const sourceLogRevision = current.logRevision ?? 0;
  const mainDir = await getSampleMainDir(directoryHandle, monthFolderName, true);
  const employeesDir = await getSampleEmployeeDir(directoryHandle, monthFolderName, true);

  const mainFile: MainSamplesFile = {
    monthFolderName,
    updatedAt,
    sourceLogRevision,
    entries: current.entries,
  };

  await safeWriteJson(mainDir, MAIN_SAMPLES_FILE, mainFile);

  const entriesByEmployee = new Map<string, DistributionEntry[]>();
  for (const entry of current.entries) {
    const list = entriesByEmployee.get(entry.assignedTo) ?? [];
    list.push(entry);
    entriesByEmployee.set(entry.assignedTo, list);
  }

  await Promise.all(
    [...entriesByEmployee.entries()].map(([username, entries]) =>
      safeWriteJson<EmployeeSamplesFile>(
        employeesDir,
        employeeSamplesFileName(username),
        {
          monthFolderName,
          username,
          updatedAt,
          sourceLogRevision,
          entries,
        }
      )
    )
  );
}

export async function loadEmployeeSampleMirror(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  username: string
): Promise<EmployeeSamplesFile | null> {
  try {
    const dir = await getSampleEmployeeDir(directoryHandle, monthFolderName, false);
    const result = await safeReadJson<EmployeeSamplesFile>(dir, employeeSamplesFileName(username));
    return result.ok ? result.value : null;
  } catch {
    return null;
  }
}

export type UserWorkspaceFootprint = {
  /** Months (open only) where this user still owns pending/replacement-requested samples. */
  activeAssignments: Array<{ monthFolderName: string; pendingCount: number }>;
  /** Months where this user has saved answer/referral/replacement data — never deleted. */
  answerFileMonths: string[];
};

/**
 * Scans every month folder for a user's workspace footprint before deletion
 * (Tier-1 Item B): active (pending / replacement-requested) sample assignments
 * that would be orphaned by deletion, and months with saved answer data that
 * must be preserved regardless (reports read them by `answeredBy`).
 *
 * Closed months are skipped for `activeAssignments`: they are frozen history,
 * so a deletion cannot affect anything there.
 *
 * Reads the small per-employee sample mirror (`{username}.samples.json`,
 * kept in sync by `syncSampleMirrors`) rather than the full
 * `distribution.current.json` per month. NB: mirrors sync on
 * `saveDistributionCurrent`, so this can miss an assignment made moments ago
 * in another tab/machine — acceptable for a pre-deletion advisory check;
 * deriving from the full event log per month would be O(months × log size)
 * and is not worth the cost here.
 */
export async function getUserWorkspaceFootprint(
  directoryHandle: DirectoryHandleLike,
  username: string
): Promise<UserWorkspaceFootprint> {
  const months = await listMonthFolders(directoryHandle);
  const activeAssignments: Array<{ monthFolderName: string; pendingCount: number }> = [];
  const answerFileMonths: string[] = [];

  for (const month of months) {
    const monthFolderName = month.folderName;

    const closed = await isMonthClosed(directoryHandle, monthFolderName);
    if (!closed) {
      const mirror = await loadEmployeeSampleMirror(directoryHandle, monthFolderName, username);
      const pendingCount = (mirror?.entries ?? []).filter(
        (e) => e.status === "pending" || e.status === "replacement-requested"
      ).length;
      if (pendingCount > 0) {
        activeAssignments.push({ monthFolderName, pendingCount });
      }
    }

    const answerFile = await loadEmployeeAnswers(directoryHandle, monthFolderName, username);
    const hasAnswerData =
      answerFile.items.length > 0 ||
      (answerFile.referralRequests?.length ?? 0) > 0 ||
      (answerFile.replacementRequests?.length ?? 0) > 0;
    if (hasAnswerData) {
      answerFileMonths.push(monthFolderName);
    }
  }

  return { activeAssignments, answerFileMonths };
}
