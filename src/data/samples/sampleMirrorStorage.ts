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
import { loadSampleMaster } from "../sampling/sampleStorage";
// distributionStorage.ts imports syncSampleMirrors FROM this module, so this
// is a deliberate circular import: safe here because both sides only use the
// other's exports inside function bodies, never at module-eval time (P6,
// 2026-08 — see getUserWorkspaceFootprint's revision cross-check below).
import { loadOrDeriveDistributionCurrent, readDistributionLogStamp } from "../distribution/distributionStorage";

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

/** Exported (P6) so backupStorage.ts's restore classification can match on the
 *  same suffix rather than re-declaring a copy that could drift. */
export const EMPLOYEE_MIRROR_SUFFIX = ".samples.json";

/**
 * Derived side-index over the mirrors in `2-samples/{month}/2-employees/`
 * (Design B, step 2). One read of this file replaces N full mirror parses for
 * any consumer that only needs "which employee is at which source revision" —
 * the monotonic guard in `syncSampleMirrors` below, and the sync tick's change
 * probe.
 *
 * It is NEVER authoritative. Every consumer dual-reads: an absent, malformed,
 * or listing-inconsistent index falls back to reading the mirrors themselves,
 * which is always correct, only slower. Nothing is ever decided from the index
 * that could not be decided from the files.
 *
 * The name deliberately does not end in `.samples.json` (nor `.answers.json`,
 * which `answerStorage.ts` writes into this same folder), so no existing
 * suffix-filtered listing picks it up as a mirror.
 *
 * Exported (P6) so backupStorage.ts's restore classification can match on the
 * same literal rather than re-declaring a copy that could drift.
 */
export const EMPLOYEE_MIRROR_INDEX_FILE = "_index.json";

/**
 * Keyed by FILE NAME, exactly like `readExistingMirrors` — two usernames can
 * sanitize to the same file name (see the golden master's collision case), and
 * the monotonic guard is inherently per-file. `username` is carried per entry
 * so a consumer that wants the `username -> revision` view can build it without
 * re-deriving the sanitization (and so a collision resolves the same way the
 * files themselves resolve it: last writer wins).
 */
export type EmployeeMirrorIndexFile = {
  monthFolderName: string;
  updatedAt: string;
  /**
   * Non-null only while a projection is MID-FLIGHT. Set to the revision being
   * written before the first mirror write, cleared after the last one.
   *
   * This is what keeps a crash mid-projection from turning the index into
   * wrong data. Mirrors are written before the index is finalized, so a crash
   * can leave a mirror at a revision the index has never heard of. A reader
   * treats every entry's revision as `max(recorded, pendingRevision)` while
   * this is set: over-stating the on-disk revision only makes the monotonic
   * guard SKIP a write it could have made — and the derivation it would have
   * skipped is by construction no newer than the interrupted one — whereas
   * under-stating it would let an older derivation clobber a newer mirror.
   */
  pendingRevision: number | null;
  mirrors: Record<string, { username: string; sourceLogRevision: number | null }>;
};

function isMirrorIndex(value: unknown): value is EmployeeMirrorIndexFile {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<EmployeeMirrorIndexFile>;
  if (typeof candidate.mirrors !== "object" || candidate.mirrors === null) return false;
  if (candidate.pendingRevision !== null && typeof candidate.pendingRevision !== "number") return false;
  return Object.values(candidate.mirrors).every(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as { username?: unknown }).username === "string" &&
      (typeof (entry as { sourceLogRevision?: unknown }).sourceLogRevision === "number" ||
        (entry as { sourceLogRevision?: unknown }).sourceLogRevision === null)
  );
}

/**
 * Read the derived mirror index for a month, or `null` when it is absent or
 * malformed. Exported for consumers that want the cheap `username -> revision`
 * view (the sync tick's change probe); they MUST dual-read — see the type's
 * docblock — and must treat `null` as "read the mirrors instead", never as
 * "there are no mirrors".
 */
export async function readEmployeeMirrorIndex(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<EmployeeMirrorIndexFile | null> {
  try {
    const dir = await getSampleEmployeeDir(directoryHandle, monthFolderName, false);
    return await readMirrorIndexIn(dir);
  } catch {
    return null;
  }
}

/** Bounded fan-out budget for the per-employee mirror writes. Each unit of
 *  work is a safeReadJson-free write plus its read-back verify; unbounded
 *  `Promise.all` over every assignee in a month was previously issuing an
 *  unbounded number of concurrent File System Access operations. */
const MIRROR_WRITE_CONCURRENCY = 8;

function employeeSamplesFileName(username: string): string {
  return `${safeWorkspaceFilePart(username)}${EMPLOYEE_MIRROR_SUFFIX}`;
}

type ExistingMirror = { username: string; sourceLogRevision: number | null };

/** Same read as `readEmployeeMirrorIndex`, against an already-resolved dir. */
async function readMirrorIndexIn(
  employeesDir: DirectoryHandleLike
): Promise<EmployeeMirrorIndexFile | null> {
  try {
    const result = await safeReadJson<unknown>(employeesDir, EMPLOYEE_MIRROR_INDEX_FILE);
    if (!result.ok || !isMirrorIndex(result.value)) return null;
    return result.value;
  } catch {
    return null; // accelerator only — never fail a sync over it
  }
}

/** The index may be used only when it describes exactly the mirror files that
 *  are actually there — no missing entry, no entry for a vanished file. */
function indexCoversListing(index: EmployeeMirrorIndexFile, fileNames: string[]): boolean {
  const keys = Object.keys(index.mirrors);
  if (keys.length !== fileNames.length) return false;
  return fileNames.every((name) => index.mirrors[name] !== undefined);
}

function maxRevision(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

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

  // Fast path (step 2): one small read instead of N full mirror parses. Taken
  // ONLY when the index covers exactly the mirrors the listing just reported —
  // any file the index has not heard of, or any entry naming a file that is no
  // longer there, means the index is stale and the mirrors are read instead.
  // The listing is still needed either way; it is the index's own validator.
  const index = await readMirrorIndexIn(employeesDir);
  if (index && indexCoversListing(index, names)) {
    for (const fileName of names) {
      const entry = index.mirrors[fileName];
      byFileName.set(fileName, {
        username: entry.username,
        // See EmployeeMirrorIndexFile.pendingRevision: while a projection is
        // in flight the recorded revision is a LOWER bound on what may already
        // be on disk, so raise it to the pending revision.
        sourceLogRevision: maxRevision(entry.sourceLogRevision, index.pendingRevision),
      });
    }
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

  // Phase 1 of the index write: mark the projection in flight BEFORE any mirror
  // is touched, carrying the revisions as they stand right now. A crash between
  // here and phase 2 therefore leaves an index that over-states rather than
  // under-states what is on disk — see EmployeeMirrorIndexFile.pendingRevision
  // for why that direction is the safe one. Best-effort: a failure here must
  // not stop the mirrors themselves being written, and only costs the next
  // reader its fast path.
  await writeMirrorIndex(employeesDir, monthFolderName, existingMirrors, sourceLogRevision);

  /** File name -> the revision that will be on disk when this run finishes. */
  const finalRevisions = new Map<string, ExistingMirror>(existingMirrors);

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
      finalRevisions.set(fileName, { username, sourceLogRevision });
    }
  );

  // Phase 2: commit the index. `pendingRevision` back to null, revisions now
  // describing what this run actually left on disk (skipped files keep their
  // higher existing revision, written files carry this run's).
  await writeMirrorIndex(employeesDir, monthFolderName, finalRevisions, null);
}

/**
 * Write the derived mirror index. Best-effort by contract: the index is a
 * pure accelerator, so a failure is logged and swallowed — every consumer
 * dual-reads and simply pays the N mirror parses instead.
 */
async function writeMirrorIndex(
  employeesDir: DirectoryHandleLike,
  monthFolderName: string,
  mirrors: Map<string, ExistingMirror>,
  pendingRevision: number | null
): Promise<void> {
  try {
    await safeWriteJson<EmployeeMirrorIndexFile>(employeesDir, EMPLOYEE_MIRROR_INDEX_FILE, {
      monthFolderName,
      updatedAt: new Date().toISOString(),
      pendingRevision,
      mirrors: Object.fromEntries(
        [...mirrors.entries()].map(([fileName, mirror]) => [
          fileName,
          { username: mirror.username, sourceLogRevision: mirror.sourceLogRevision },
        ])
      ),
    });
  } catch (error) {
    logError("sampleMirror:write-index", error);
  }
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

/**
 * Authoritative fallback for a mirror found stale by
 * {@link getUserWorkspaceFootprint}'s revision cross-check: fold the real
 * event log (via the same derivation the rest of the app trusts) rather than
 * serve the mirror's out-of-date `entries`. Best-effort — a month whose
 * sample rows cannot be loaded (or that has no rows at all) has nothing
 * authoritative to fold against, so it falls back to 0 pending rather than
 * throwing and aborting the whole footprint scan; any read failure is logged
 * rather than silently swallowed with no trace.
 */
async function staleMirrorPendingCount(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  username: string
): Promise<number> {
  try {
    const sample = await loadSampleMaster(directoryHandle, monthFolderName);
    if (!sample || sample.rows.length === 0) return 0;
    const current = await loadOrDeriveDistributionCurrent(directoryHandle, monthFolderName, sample.rows);
    if (!current) return 0;
    return current.entries.filter(
      (e) =>
        e.assignedTo === username &&
        (e.status === "pending" || e.status === "replacement-requested")
    ).length;
  } catch (error) {
    logError("sampleMirror:stale-mirror-fallback", error);
    return 0;
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
 *
 * Revision cross-check (P6, 2026-08): a mirror is a rewritten-whole
 * projection stamped with the compat-log `revision` it was derived from
 * (`sourceLogRevision`). A restore can put back an OLDER mirror byte-for-byte
 * while the event log it was derived from moves on (see backupStorage.ts's
 * `RestoreAction` classification) — trusting `mirror.entries` unconditionally
 * would then silently serve stale assignment data, which for THIS function
 * specifically risks the dangerous direction: an assignment made after the
 * mirror was frozen would read as "no pending work", letting a delete proceed
 * and orphan it. `readDistributionLogStamp` is the same cheap (no
 * event-directory scan) revision probe the sync tick already uses, so the
 * common case (mirror already current) pays only one extra small file read.
 * Only when the mirror is found stale does this pay for a full authoritative
 * fold via `loadOrDeriveDistributionCurrent` — correctness over performance in
 * the exceptional case, not the common one.
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
      const stamp = await readDistributionLogStamp(directoryHandle, monthFolderName);
      const mirrorIsStale = mirror !== null && mirror.sourceLogRevision < stamp.revision;

      let pendingCount: number;
      if (mirrorIsStale) {
        pendingCount = await staleMirrorPendingCount(directoryHandle, monthFolderName, username);
      } else {
        pendingCount = (mirror?.entries ?? []).filter(
          (e) => e.status === "pending" || e.status === "replacement-requested"
        ).length;
      }
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
