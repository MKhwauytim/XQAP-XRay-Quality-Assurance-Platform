import type { DistributionCurrentData, DistributionEntry } from "../distribution/distributionTypes";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeReadJson, safeWriteJson } from "../storage/safeWrite";
import { getSampleEmployeeDir, safeWorkspaceFilePart } from "../workspace/workspacePaths";
import { listDirectoryEntries } from "../storage/directoryScan";
import { mapWithConcurrency } from "../storage/concurrency";
import { logError } from "../storage/errorLogger";
import { listMonthFolders } from "../population/populationStorage";
import { isMonthClosed } from "../population/monthLock";
import { loadEmployeeAnswers } from "../answers/answerStorage";

/**
 * Frozen quota snapshot carried inside the per-employee mirror so an employee
 * view can render "X of Y per day" from the mirror ALONE, without also loading
 * the workspace-wide derived `distribution.current.json` (Design B).
 *
 * Copied verbatim from `current.quotas[username]` at projection time — it is a
 * derived value like everything else in this file, not an independent record.
 * OPTIONAL by contract: mirrors written before this field existed have no
 * `quota`, and readers MUST fall back to the derived file in that case.
 */
export type EmployeeMirrorQuota = {
  dailyQuota: number;
  daysRemainingAtAssignment: number;
  sampleCount: number;
};

export type EmployeeSamplesFile = {
  monthFolderName: string;
  username: string;
  updatedAt: string;
  sourceLogRevision: number;
  /** Absent on mirrors written before the quota field existed — see EmployeeMirrorQuota. */
  quota?: EmployeeMirrorQuota;
  entries: DistributionEntry[];
};

const EMPLOYEE_MIRROR_SUFFIX = ".samples.json";

/** Bounded fan-out budget for the per-employee mirror writes. Each unit of
 *  work is a safeReadJson-free write plus its read-back verify; unbounded
 *  `Promise.all` over every assignee in a month was previously issuing an
 *  unbounded number of concurrent File System Access operations. */
const MIRROR_WRITE_CONCURRENCY = 8;

function employeeSamplesFileName(username: string): string {
  return `${safeWorkspaceFilePart(username)}${EMPLOYEE_MIRROR_SUFFIX}`;
}

type ExistingMirror = { username: string; sourceLogRevision: number | null };

/**
 * Read every per-employee mirror already on disk for this month, keyed by FILE
 * NAME (not username — two usernames can sanitize to the same file name, and
 * the monotonic guard below is inherently per-file).
 *
 * Needed because the projection is a union write: an employee reassigned down
 * to zero entries does not appear in `current.entries` at all, so the only way
 * to learn they still hold a mirror that must be emptied is to look at the
 * directory (bug F8).
 */
async function readExistingMirrors(
  employeesDir: DirectoryHandleLike
): Promise<Map<string, ExistingMirror>> {
  const byFileName = new Map<string, ExistingMirror>();
  let names: string[];
  try {
    names = (await listDirectoryEntries(employeesDir))
      .filter((entry) => entry.kind === "file" && entry.name.endsWith(EMPLOYEE_MIRROR_SUFFIX))
      .map((entry) => entry.name);
  } catch (error) {
    // A listing failure degrades this to the pre-union behaviour (employees in
    // `current.entries` are still written) rather than failing the whole sync.
    logError("sampleMirror:list-existing", error);
    return byFileName;
  }
  const read = await mapWithConcurrency(names, MIRROR_WRITE_CONCURRENCY, async (fileName) => {
    const result = await safeReadJson<Partial<EmployeeSamplesFile>>(employeesDir, fileName);
    if (!result.ok || typeof result.value.username !== "string") {
      // Corrupt/unreadable: we cannot recover the username, so it cannot join
      // the union. It is already unreadable to the employee too.
      return null;
    }
    return {
      fileName,
      username: result.value.username,
      sourceLogRevision:
        typeof result.value.sourceLogRevision === "number" ? result.value.sourceLogRevision : null,
    };
  });
  for (const entry of read) {
    if (entry) byFileName.set(entry.fileName, { username: entry.username, sourceLogRevision: entry.sourceLogRevision });
  }
  return byFileName;
}

/**
 * Regenerate the per-employee sample mirrors for a month.
 *
 * The mirror is a DERIVED PROJECTION, rewritten whole and never edited in
 * place. The commit point is the distribution event log, so a crash partway
 * through this fan-out leaves a stale cache — never wrong history.
 *
 * Union write (F8): the target set is (employees with a mirror on disk) ∪
 * (employees present in `current.entries`). An employee who lost every entry
 * gets an explicit empty-entries file, instead of silently keeping work they
 * no longer own.
 */
export async function syncSampleMirrors(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  current: DistributionCurrentData
): Promise<void> {
  const updatedAt = new Date().toISOString();
  const sourceLogRevision = current.logRevision ?? 0;
  const employeesDir = await getSampleEmployeeDir(directoryHandle, monthFolderName, true);

  const entriesByEmployee = new Map<string, DistributionEntry[]>();
  for (const entry of current.entries) {
    const list = entriesByEmployee.get(entry.assignedTo) ?? [];
    list.push(entry);
    entriesByEmployee.set(entry.assignedTo, list);
  }

  const existingMirrors = await readExistingMirrors(employeesDir);
  for (const { username } of existingMirrors.values()) {
    if (!entriesByEmployee.has(username)) entriesByEmployee.set(username, []);
  }

  await mapWithConcurrency(
    [...entriesByEmployee.entries()],
    MIRROR_WRITE_CONCURRENCY,
    async ([username, entries]) => {
      const fileName = employeeSamplesFileName(username);
      // Monotonic guard: never let an older derivation (lower
      // sourceLogRevision) clobber a mirror already written from a newer log
      // revision. Two machines can derive concurrently; without this an
      // out-of-order write would resurrect stale entries for readers.
      const existingRevision = existingMirrors.get(fileName)?.sourceLogRevision ?? null;
      if (existingRevision !== null && existingRevision >= sourceLogRevision) {
        return; // a newer (or equal) derivation already wrote this mirror
      }
      const quota = current.quotas?.[username];
      await safeWriteJson<EmployeeSamplesFile>(employeesDir, fileName, {
        monthFolderName,
        username,
        updatedAt,
        sourceLogRevision,
        ...(quota
          ? {
              quota: {
                dailyQuota: quota.dailyQuota,
                daysRemainingAtAssignment: quota.daysRemainingAtAssignment,
                sampleCount: quota.sampleCount,
              },
            }
          : {}),
        entries,
      });
    }
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
