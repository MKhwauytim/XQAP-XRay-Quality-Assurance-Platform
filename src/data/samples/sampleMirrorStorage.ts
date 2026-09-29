import { tagError } from "../storage/errorCodes";
import { isNotFoundError } from "../storage/transientFileErrors";
import type { DistributionCurrentData, DistributionEntry, EventStoreScanIdentity } from "../distribution/distributionTypes";
import { stableStringify, type DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeReadJson, safeWriteJson } from "../storage/safeWrite";
import { getSampleEmployeeDir, safeWorkspaceFilePart } from "../workspace/workspacePaths";
import { listDirectoryEntries } from "../storage/directoryScan";
import { mapWithConcurrency } from "../storage/concurrency";
import { logError } from "../storage/errorLogger";
import { listMonthFolders } from "../population/populationStorage";
import { isMonthClosed } from "../population/monthLock";
import { loadEmployeeAnswers } from "../answers/answerStorage";
import { loadSampleMaster } from "../sampling/sampleStorage";
// Ad-hoc imports live in synthetic `2-samples/adhoc-{importId}/` folders that
// `listMonthFolders` (which enumerates `1-population/`) can never return. Same
// function-body-only usage rule as the deliberate cycles below.
import { listAdhocSampleFolders } from "../adhocImport/adhocImportEmployeeView";
// distributionStorage.ts imports syncSampleMirrors FROM this module, so this
// is a deliberate circular import: safe here because both sides only use the
// other's exports inside function bodies, never at module-eval time (P6,
// 2026-08 — see getUserWorkspaceFootprint's revision cross-check below).
import {
  eventStoreMatchesScan,
  isDistributionPersistPending,
  isDistributionProjectionPending,
  loadOrDeriveDistributionCurrent,
  scanIdentityOf,
  readDistributionLogStamp,
} from "../distribution/distributionStorage";
// Same deliberate cycle, same rule: DERIVE_VERSION is a plain number constant
// read inside function bodies only. distributionLog.ts imports nothing from
// this module, so this edge is acyclic on its own.
import { DERIVE_VERSION } from "../distribution/distributionLog";

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
  /** Working days (Sun–Thu) in the assignment window since DERIVE_VERSION 5
   *  (C3) — copied verbatim from the derived quota, never recomputed here. */
  daysRemainingAtAssignment: number;
  sampleCount: number;
};

export type EmployeeSamplesFile = {
  monthFolderName: string;
  username: string;
  updatedAt: string;
  sourceLogRevision: number;
  /**
   * `deriveVersion` of the `DistributionCurrentData` this mirror was projected
   * from — i.e. WHICH derivation produced these entries and this quota, not
   * which log revision they came from.
   *
   * Needed because a DERIVE_VERSION bump (v88: employee quota derivation) fixes
   * the DERIVED values while leaving `sourceLogRevision` untouched: the log has
   * not moved, only our reading of it. Without this field the monotonic guard
   * in `syncSampleMirrors` sees `existing === incoming` and skips forever, so
   * the corrected quota never reaches the employee on a month with no further
   * events.
   *
   * OPTIONAL by contract, like `quota`: mirrors written before this field
   * existed have none, and readers MUST treat its absence as version 0 (a
   * pre-versioned derivation, therefore rewritable exactly once).
   */
  deriveVersion?: number;
  /**
   * `eventSetId` of the event log this mirror was derived from. The revision
   * alone cannot prove a mirror current: the projection stamp that carries it
   * is written AFTER the durable events (and off the click path), so it can lag
   * the events indefinitely if that write fails. A reader trusts a mirror only
   * when this matches the CURRENT log's eventSetId (see
   * `isMirrorTrustedForEvents`).
   *
   * OPTIONAL by contract: a mirror written before this field existed has none
   * and is NOT trusted, so it is re-derived once. That needs no migration — the
   * mirror is a rebuildable derived cache, never a source of truth (CLAUDE.md's
   * post-launch migration policy is about changing what business data on disk
   * means; nothing here is read back as data, and no reader treats absence as
   * an error).
   */
  eventSetId?: string;
  /**
   * The event-store scan (segment offsets + legacy file set digest) this mirror
   * was derived from. See `isMirrorTrustedForEvents`. Optional; absent means
   * "never trusted", so an older mirror is re-derived — it is restamped only by
   * the next distribution write in its month.
   */
  scan?: EventStoreScanIdentity;
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
  /**
   * The `deriveVersion` half of `pendingRevision` — the derivation version the
   * in-flight run is writing. Read together with it (see `maxStamp`), so an
   * interrupted run is over-stated in the same safe direction on BOTH axes.
   *
   * Optional: an index written before this field existed has none, read as 0.
   */
  pendingDeriveVersion?: number | null;
  /**
   * `deriveVersion` per mirror, mirroring `EmployeeSamplesFile.deriveVersion`.
   *
   * The index exists precisely so the monotonic guard does not have to open N
   * mirrors; a guard that now compares derive versions cannot evaluate its rule
   * from an index that does not carry them, so the fast path would silently
   * defeat the fix. Optional for the same dual-read reason as everywhere else:
   * an index written by an older client has no `deriveVersion` on its entries
   * and is read as 0.
   */
  mirrors: Record<
    string,
    {
      username: string;
      sourceLogRevision: number | null;
      deriveVersion?: number;
      eventSetId?: string;
      /**
       * SHA-256 of the mirror's CONTENT (entries + quota + username/month, see
       * `mirrorContentHash`), and the event-store scan that content was derived
       * from (R2). Together they let a write that did not change this employee's
       * content skip rewriting the mirror file and restamp only this entry, and
       * let a reader (`isMirrorTrustedForEvents`) accept the older-stamped file:
       * the file's own hash must equal `contentHash` and `scan` must still match
       * the event store. Both optional; absent (an older client wrote the entry)
       * means "rewrite / do not trust by index".
       */
      contentHash?: string;
      scan?: EventStoreScanIdentity;
    }
  >;
};

function isMirrorIndex(value: unknown): value is EmployeeMirrorIndexFile {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<EmployeeMirrorIndexFile>;
  if (typeof candidate.mirrors !== "object" || candidate.mirrors === null) return false;
  if (candidate.pendingRevision !== null && typeof candidate.pendingRevision !== "number") return false;
  if (
    candidate.pendingDeriveVersion !== undefined &&
    candidate.pendingDeriveVersion !== null &&
    typeof candidate.pendingDeriveVersion !== "number"
  ) {
    return false;
  }
  return Object.values(candidate.mirrors).every(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as { username?: unknown }).username === "string" &&
      (typeof (entry as { sourceLogRevision?: unknown }).sourceLogRevision === "number" ||
        (entry as { sourceLogRevision?: unknown }).sourceLogRevision === null) &&
      // Absent is legal (legacy index, read as 0); present-but-not-a-number is
      // not — a malformed index is rejected whole and the mirrors are read.
      ((entry as { deriveVersion?: unknown }).deriveVersion === undefined ||
        typeof (entry as { deriveVersion?: unknown }).deriveVersion === "number") &&
      ((entry as { eventSetId?: unknown }).eventSetId === undefined ||
        typeof (entry as { eventSetId?: unknown }).eventSetId === "string") &&
      ((entry as { contentHash?: unknown }).contentHash === undefined ||
        typeof (entry as { contentHash?: unknown }).contentHash === "string") &&
      ((entry as { scan?: unknown }).scan === undefined ||
        (typeof (entry as { scan?: unknown }).scan === "object" && (entry as { scan?: unknown }).scan !== null))
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

/**
 * What is (believed to be) on disk for one mirror file. `deriveVersion` is a
 * plain number, never null: a mirror or index entry that does not carry one was
 * written by a pre-versioned client and is read as 0.
 */
type ExistingMirror = {
  username: string;
  sourceLogRevision: number | null;
  deriveVersion: number;
  /** Absent on a legacy mirror/index entry: never equal to a real event set. */
  eventSetId?: string;
  /** From the index entry only, and only while no projection is in flight (see `readExistingMirrors`). */
  contentHash?: string;
  scan?: EventStoreScanIdentity;
};

/**
 * SHA-256 of what a reader actually consumes from a mirror: who it is for, which
 * month, the frozen quota and the SET of entries (order-insensitive, see below). Key order and undefined-valued keys
 * must not matter (the file round-trips through JSON), so the payload is
 * normalized through a JSON round trip and stringified with sorted keys.
 * `undefined` when no WebCrypto is available: callers then never skip a write
 * and never trust by index, i.e. they behave exactly as before R2.
 */
export async function mirrorContentHash(
  mirror: Pick<EmployeeSamplesFile, "username" | "monthFolderName" | "quota" | "entries">
): Promise<string | undefined> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return undefined;
  const payload = JSON.parse(
    JSON.stringify({
      monthFolderName: mirror.monthFolderName,
      username: mirror.username,
      quota: mirror.quota ?? null,
      // Order-insensitive: the position of an entry inside a mirror is the fold's
      // tie-break for events sharing an `eventAt` (batch order when the log comes
      // back from an append, read order after a reload), so two derivations of
      // the SAME set of entries legitimately disagree on it. A retained file
      // keeps whichever order it was last written with.
      entries: [...mirror.entries].sort((a, b) => (a.xrayImageId < b.xrayImageId ? -1 : a.xrayImageId > b.xrayImageId ? 1 : 0)),
    })
  ) as unknown;
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(stableStringify(payload)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

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

type MirrorStamp = { sourceLogRevision: number | null; deriveVersion: number };

/**
 * The later of two mirror stamps, ordered as (revision, deriveVersion) —
 * revision first, derive version only as the tie-break, exactly the ordering
 * the monotonic guard itself uses. A null revision is "unknown", which loses to
 * any known one.
 *
 * Used only to fold `pendingRevision` into a recorded entry, where over-stating
 * is the documented safe direction (it can only make the guard SKIP a write).
 */
function maxStamp(a: MirrorStamp, b: MirrorStamp): MirrorStamp {
  if (a.sourceLogRevision === null) return b;
  if (b.sourceLogRevision === null) return a;
  if (a.sourceLogRevision > b.sourceLogRevision) return a;
  if (b.sourceLogRevision > a.sourceLogRevision) return b;
  return {
    sourceLogRevision: a.sourceLogRevision,
    deriveVersion: Math.max(a.deriveVersion, b.deriveVersion),
  };
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
      // See EmployeeMirrorIndexFile.pendingRevision: while a projection is in
      // flight the recorded stamp is a LOWER bound on what may already be on
      // disk, so raise it to the pending stamp. A legacy index carries no
      // deriveVersion on either side; 0 makes such a mirror rewritable exactly
      // once (the rewrite is by definition from the newest derivation, so it
      // can only improve the file — and the revision comparison, which is what
      // protects against resurrecting stale entries, is untouched).
      const stamp = maxStamp(
        { sourceLogRevision: entry.sourceLogRevision, deriveVersion: entry.deriveVersion ?? 0 },
        {
          sourceLogRevision: index.pendingRevision,
          deriveVersion: index.pendingDeriveVersion ?? 0,
        }
      );
      byFileName.set(fileName, {
        username: entry.username,
        ...stamp,
        ...(entry.eventSetId === undefined ? {} : { eventSetId: entry.eventSetId }),
        // A crashed run may have rewritten mirrors the index never heard of, so
        // while `pendingRevision` is set the index does not vouch for content.
        ...(index.pendingRevision === null && entry.contentHash !== undefined && entry.scan !== undefined
          ? { contentHash: entry.contentHash, scan: entry.scan }
          : {}),
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
      // Absent on a mirror written before the field existed → 0.
      deriveVersion:
        typeof result.value.deriveVersion === "number" ? result.value.deriveVersion : 0,
      eventSetId: typeof result.value.eventSetId === "string" ? result.value.eventSetId : undefined,
    };
  });
  for (const entry of read) {
    if (entry) {
      byFileName.set(entry.fileName, {
        username: entry.username,
        sourceLogRevision: entry.sourceLogRevision,
        deriveVersion: entry.deriveVersion,
        ...(entry.eventSetId === undefined ? {} : { eventSetId: entry.eventSetId }),
      });
    }
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
  // The mirror's derivation quality is the quality of the snapshot it projects,
  // so a stamped snapshot is trusted verbatim — a `current` folded by an older
  // build must not be able to masquerade as this build's derivation and lock
  // out the corrected one. An UNSTAMPED snapshot is one nothing on the storage
  // path can produce (`loadOrDeriveDistributionCurrent` refolds anything whose
  // deriveVersion !== DERIVE_VERSION), i.e. a hand-built one from this build,
  // so it carries this build's semantics.
  const deriveVersion = current.deriveVersion ?? DERIVE_VERSION;
  const eventSetId = current.eventSetId;
  const scan = scanIdentityOf(current);
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

  // Decide, per employee, whether this run must REWRITE the mirror file, may
  // merely RESTAMP its index entry (R2), or must leave it alone (the monotonic
  // guard). Pure decision + one hash per employee; no share operations.
  type Plan =
    | { kind: "keep" }
    | { kind: "restamp"; contentHash: string }
    | { kind: "write"; contentHash: string | undefined };
  const buildMirror = (username: string, entries: DistributionEntry[]): EmployeeSamplesFile => {
    const quota = current.quotas?.[username];
    return {
      monthFolderName,
      username,
      updatedAt,
      sourceLogRevision,
      deriveVersion,
      ...(eventSetId === undefined ? {} : { eventSetId }),
      ...(scan === undefined ? {} : { scan }),
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
    };
  };
  const plans = new Map<string, { username: string; mirror: EmployeeSamplesFile; plan: Plan }>();
  await Promise.all(
    [...entriesByEmployee.entries()].map(async ([username, entries]) => {
      const fileName = employeeSamplesFileName(username);
      // Monotonic guard, ordered (revision, deriveVersion) — the two axes are
      // NOT interchangeable and must be tested in this order:
      //
      //   existing.revision >  ours  → never overwrite, whatever the versions.
      //       They hold newer DATA (two machines can derive concurrently);
      //       overwriting resurrects stale entries for the employee, which is
      //       strictly worse than serving a slightly-old derivation. A version
      //       difference must never defeat this case.
      //   existing.revision === ours → overwrite only if OUR derivation is
      //       newer. Same log, better reading of it — this is what lets a
      //       DERIVE_VERSION bump (v88's employee quota fix) actually reach the
      //       employee on a month with no further events, where the revision
      //       alone never changes again.
      //   existing.revision <  ours  → overwrite; we hold newer data.
      const existing = existingMirrors.get(fileName);
      const existingRevision = existing?.sourceLogRevision ?? null;
      const mirror = buildMirror(username, entries);
      if (existingRevision !== null) {
        if (existingRevision > sourceLogRevision) {
          plans.set(fileName, { username, mirror, plan: { kind: "keep" } });
          return;
        }
        if (
          existingRevision === sourceLogRevision &&
          (existing?.deriveVersion ?? 0) >= deriveVersion &&
          // Equal revision is NOT equal data: the projection stamp can lag the
          // events (a pending or failed background bump), so a different event
          // set at the same revision must still be written. A snapshot with no
          // eventSetId cannot say, and keeps the old skip.
          (eventSetId === undefined || existing?.eventSetId === eventSetId)
        ) {
          plans.set(fileName, { username, mirror, plan: { kind: "keep" } }); // same data, and their derivation is no older than ours
          return;
        }
      }
      const contentHash = await mirrorContentHash(mirror);
      // R2: the revision moved but THIS employee's content did not (their mirror
      // is byte-for-byte what we would write, apart from the stamps). Keep the
      // file and restamp only the index entry. Requires the same derivation
      // version (a version bump must reach the file) and a scan to restamp with.
      if (
        contentHash !== undefined &&
        scan !== undefined &&
        existing?.contentHash === contentHash &&
        existingRevision !== null &&
        existing.deriveVersion === deriveVersion
      ) {
        plans.set(fileName, { username, mirror, plan: { kind: "restamp", contentHash } });
        return;
      }
      plans.set(fileName, { username, mirror, plan: { kind: "write", contentHash } });
    })
  );
  const writes = [...plans.entries()].filter(([, p]) => p.plan.kind === "write");

  // Phase 1 of the index write: mark the projection in flight BEFORE any mirror
  // is touched, carrying the revisions as they stand right now. A crash between
  // here and phase 2 therefore leaves an index that over-states rather than
  // under-states what is on disk — see EmployeeMirrorIndexFile.pendingRevision
  // for why that direction is the safe one. Best-effort: a failure here must
  // not stop the mirrors themselves being written, and only costs the next
  // reader its fast path. Skipped when no mirror file will be touched (R2:
  // restamp-only runs): there is nothing the index could under-state.
  if (writes.length > 0) {
    await writeMirrorIndex(
      employeesDir,
      monthFolderName,
      existingMirrors,
      sourceLogRevision,
      deriveVersion
    );
  }

  /** File name -> the revision that will be on disk when this run finishes. */
  const finalRevisions = new Map<string, ExistingMirror>(existingMirrors);

  await mapWithConcurrency(writes, MIRROR_WRITE_CONCURRENCY, async ([fileName, { username, mirror, plan }]) => {
    await safeWriteJson<EmployeeSamplesFile>(employeesDir, fileName, mirror);
    finalRevisions.set(fileName, {
      username,
      sourceLogRevision,
      deriveVersion,
      ...(eventSetId === undefined ? {} : { eventSetId }),
      ...(plan.kind === "write" && plan.contentHash !== undefined && scan !== undefined
        ? { contentHash: plan.contentHash, scan }
        : {}),
    });
  });
  for (const [fileName, { username, plan }] of plans) {
    if (plan.kind !== "restamp" || scan === undefined) continue;
    finalRevisions.set(fileName, {
      username,
      sourceLogRevision,
      deriveVersion,
      ...(eventSetId === undefined ? {} : { eventSetId }),
      contentHash: plan.contentHash,
      scan,
    });
  }

  // Phase 2: commit the index. `pendingRevision` back to null, revisions now
  // describing what this run actually left on disk (skipped files keep their
  // higher existing revision, written files carry this run's).
  await writeMirrorIndex(employeesDir, monthFolderName, finalRevisions, null, null);
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
  pendingRevision: number | null,
  pendingDeriveVersion: number | null
): Promise<void> {
  try {
    await safeWriteJson<EmployeeMirrorIndexFile>(employeesDir, EMPLOYEE_MIRROR_INDEX_FILE, {
      monthFolderName,
      updatedAt: new Date().toISOString(),
      pendingRevision,
      pendingDeriveVersion,
      mirrors: Object.fromEntries(
        [...mirrors.entries()].map(([fileName, mirror]) => [
          fileName,
          {
            username: mirror.username,
            sourceLogRevision: mirror.sourceLogRevision,
            deriveVersion: mirror.deriveVersion,
            ...(mirror.eventSetId === undefined ? {} : { eventSetId: mirror.eventSetId }),
            ...(mirror.contentHash === undefined || mirror.scan === undefined
              ? {}
              : { contentHash: mirror.contentHash, scan: mirror.scan }),
          },
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
    if (result.ok) return result.value;
    // A read that FAILED is not a mirror that is absent. `corrupt`/unreadable
    // must propagate for the same reason as the catch below.
    if (result.reason !== "missing") {
      throw tagError(
        new Error(`Employee mirror unreadable: ${employeeSamplesFileName(username)} (${result.reason})`),
        "XQ-IO-029"
      );
    }
    return null;
  } catch (error) {
    // ONLY a genuine absence is null. The bare `catch { return null }` this
    // replaces was the documented month-overwriting shape in the one place with
    // an IRREVERSIBLE consequence: `getUserWorkspaceFootprint` treats a null
    // mirror as "not stale", skips the authoritative fold, and reports
    // pendingCount 0 — which UserManagement reads as "this employee has no
    // active assignments, safe to delete". One transient NotReadableError on
    // the share was enough to turn "I could not look" into "there is nothing
    // there" and orphan a live workload.
    if (!isNotFoundError(error)) throw error;
    return null;
  }
}

/**
 * Authoritative fallback for a mirror found stale by
 * {@link getUserWorkspaceFootprint}'s revision cross-check: fold the real
 * event log (via the same derivation the rest of the app trusts) rather than
 * serve the mirror's out-of-date `entries`. Best-effort — a month whose
 * sample master that is genuinely ABSENT (read successfully as absent, or with
 * no rows) has nothing to fold against and counts 0. A THROWN read is never
 * read as zero: the guard treats 0 as "safe to delete", which is irreversible.
 * The failure is logged and the count falls back to the mirror's own pending
 * entries (a DERIVE_VERSION bump changes quotas, not statuses); with no mirror
 * to fall back on the error propagates so the guard refuses to delete.
 */
function countPendingEntries(entries: ReadonlyArray<{ status: string }>): number {
  return entries.filter((e) => e.status === "pending" || e.status === "replacement-requested").length;
}

async function staleMirrorPendingCount(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  username: string,
  mirror: Pick<EmployeeSamplesFile, "entries"> | null
): Promise<number> {
  try {
    const sample = await loadSampleMaster(directoryHandle, monthFolderName);
    if (!sample || sample.rows.length === 0) return 0;
    const current = await loadOrDeriveDistributionCurrent(directoryHandle, monthFolderName, sample.rows, {
      persistCache: false, // a guard is a read: it must not fan out cache/mirror writes
    });
    if (!current) return 0;
    return current.entries.filter(
      (e) =>
        e.assignedTo === username &&
        (e.status === "pending" || e.status === "replacement-requested")
    ).length;
  } catch (error) {
    logError("sampleMirror:stale-mirror-fallback", error);
    if (!mirror) throw error;
    return countPendingEntries(mirror.entries);
  }
}

/**
 * May a reader serve `mirror` as the employee's current queue without folding?
 * Only when BOTH hold: its revision is at or above the projection stamp, AND the
 * event store still holds exactly what the mirror was derived from
 * (`eventStoreMatchesScan`: a sizes-only listing of `distribution.events/`, no
 * content read — segments are append-only, so an unchanged listing proves no
 * event has been added). The second condition is what makes the answer
 * independent of the projection stamp, which lags the durable events whenever the
 * background projection job is pending, failed, or lost with a closed tab.
 *
 * R2: a mirror whose content did not change in a later write keeps its old file
 * (and old stamps); the `_index.json` entry, restamped by that write, vouches for
 * it instead — see the R2 branch below.
 *
 * Not trusted: a mirror stamped with an OLDER `deriveVersion` than this build's
 * (C3: v4 carried calendar-day quotas; serving it would skip the refold), and a
 * mirror with no `scan` (older build, or derived from a snapshot
 * that carried none — it is re-derived, no migration needed), and any case where
 * the listing fails. No memo: every call lists afresh (one listing plus one size
 * stat per segment), which is what the irreversible delete-user guard needs.
 */
export async function isMirrorTrustedForEvents(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  mirror: Pick<EmployeeSamplesFile, "sourceLogRevision" | "scan" | "deriveVersion"> &
    Partial<Pick<EmployeeSamplesFile, "username" | "monthFolderName" | "quota" | "entries">>,
  stampRevision: number
): Promise<boolean> {
  if ((mirror.deriveVersion ?? 0) < DERIVE_VERSION) return false;
  // Direct path: the file's own stamp is current.
  if (mirror.sourceLogRevision >= stampRevision && mirror.scan) {
    return eventStoreMatchesScan(directoryHandle, monthFolderName, mirror.scan);
  }
  // R2 path: a write that did not change this employee's content left the file
  // alone and restamped only its `_index.json` entry. Trust it only when ALL of:
  // the index is settled (no projection mid-flight), its entry's derivation
  // version and revision are current, the FILE's content hash is exactly what
  // the entry vouches for, and the entry's scan still matches the event store.
  // Any mismatch is "not trusted": the caller folds.
  if (mirror.username === undefined || mirror.entries === undefined || mirror.monthFolderName === undefined) return false;
  const index = await readEmployeeMirrorIndex(directoryHandle, monthFolderName);
  if (!index || index.pendingRevision !== null) return false;
  const entry = index.mirrors[employeeSamplesFileName(mirror.username)];
  if (!entry || entry.contentHash === undefined || entry.scan === undefined) return false;
  if ((entry.deriveVersion ?? 0) < DERIVE_VERSION) return false;
  if (entry.sourceLogRevision === null || entry.sourceLogRevision < stampRevision) return false;
  if ((await mirrorContentHash(mirror as Pick<EmployeeSamplesFile, "username" | "monthFolderName" | "quota" | "entries">)) !== entry.contentHash) {
    return false;
  }
  return eventStoreMatchesScan(directoryHandle, monthFolderName, entry.scan);
}

export type UserWorkspaceFootprint = {
  /**
   * Months (open only) where this user still owns pending/replacement-requested
   * samples. Ad-hoc import stores (`adhoc-{importId}`) appear here under their
   * synthetic folder name — they carry live assignments exactly like a real month.
   */
  activeAssignments: Array<{ monthFolderName: string; pendingCount: number }>;
  /** Months (real or ad-hoc) where this user has saved answer/referral/replacement data — never deleted. */
  answerFileMonths: string[];
};

/**
 * Scans every month folder — real months AND ad-hoc import stores — for a
 * user's workspace footprint before deletion or a username rename (Tier-1
 * Item B; T-10/T-11, 2026-08-19): active (pending / replacement-requested)
 * sample assignments that would be orphaned, and months with saved answer
 * data that must be preserved regardless (reports read them by `answeredBy`).
 *
 * Closed months are skipped for `activeAssignments`: they are frozen history,
 * so a deletion cannot affect anything there.
 *
 * Reads the small per-employee sample mirror (`{username}.samples.json`)
 * and trusts it only when `isMirrorTrustedForEvents` proves it was derived from
 * exactly the events now on disk. A mirror that is ABSENT, untrusted, or whose
 * background persist is still pending is never read as "no work": the guard
 * folds the event log instead (mirrors are written off the click path since R1,
 * so an absent mirror is normal for a first-time assignee moments after the
 * click and must not read as zero).
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
  // Ad-hoc imports are assigned through the exact same event-log +
  // mirror-sync path as a real month (see `adhocDistributionBridge.ts`), just
  // against a synthetic `adhoc-{importId}` folder that `listMonthFolders`
  // structurally cannot return. Walking only the real months therefore
  // reported "no work on disk" for a user whose entire live workload was
  // ad-hoc — and this is the one caller where that answer is IRREVERSIBLE
  // (UserManagement reads it as "safe to delete"). Reuses the listing helper
  // `adhocImportEmployeeView.ts` already exports rather than re-deriving the
  // folder names here.
  const adhocFolders = await listAdhocSampleFolders(directoryHandle);
  const scanFolders: Array<{ folderName: string; canBeClosed: boolean }> = [
    ...months.map((month) => ({ folderName: month.folderName, canBeClosed: true })),
    // An ad-hoc store has no `month.manifest.json`, so the month lock is
    // meaningless for it (`isMonthClosed` would fail open anyway); skip the
    // probe and always count its pending work — the safe direction for a
    // pre-deletion guard.
    ...adhocFolders.map((folderName) => ({ folderName, canBeClosed: false })),
  ];
  const activeAssignments: Array<{ monthFolderName: string; pendingCount: number }> = [];
  const answerFileMonths: string[] = [];

  for (const folder of scanFolders) {
    const monthFolderName = folder.folderName;

    const closed = folder.canBeClosed && (await isMonthClosed(directoryHandle, monthFolderName));
    if (!closed) {
      const mirror = await loadEmployeeSampleMirror(directoryHandle, monthFolderName, username);
      const stamp = await readDistributionLogStamp(directoryHandle, monthFolderName);
      // Revision alone cannot prove the mirror current (the projection stamp can
      // lag the events); it must also be for the CURRENT event set. Otherwise
      // take the authoritative fold — the safe direction for a guard whose wrong
      // answer is irreversible.
      // A mirror that does not exist is "I could not look", never "zero": the
      // background persist that would have written it (R1) may have failed, may
      // never have run (tab closed), or may still be in its window on another
      // machine, and this is the one caller whose wrong answer is irreversible.
      // Likewise while THIS tab has a persist or projection bump in flight the
      // on-disk mirrors lag the durable events. All of those fold from the events;
      // deletion is rare, so O(months) folds is the right price.
      const writesInFlight =
        isDistributionPersistPending(directoryHandle, monthFolderName) ||
        isDistributionProjectionPending(directoryHandle, monthFolderName);
      const mirrorIsStale =
        mirror === null ||
        writesInFlight ||
        !(await isMirrorTrustedForEvents(directoryHandle, monthFolderName, mirror, stamp.revision));

      let pendingCount: number;
      if (mirrorIsStale) {
        pendingCount = await staleMirrorPendingCount(directoryHandle, monthFolderName, username, mirror);
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
