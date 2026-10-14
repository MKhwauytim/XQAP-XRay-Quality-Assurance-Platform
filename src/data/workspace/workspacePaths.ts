import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { dedupeInFlight, workspaceEpoch, workspaceScopeId } from "../storage/inFlightReads";
import { isNotFoundError } from "../storage/transientFileErrors";
import { registerQuietRecoveryFileName } from "../storage/bakRecoveryReport";
import { registerDirectoryPath } from "../storage/webLocks";
import { subscribeToDataRefresh } from "./dataRefreshSignal";
import { hashSeedString } from "../sampling/rng";

export const WORKSPACE_ROOTS = {
  population: "1-population",
  samples: "2-samples",
  userData: "3-user-data",
  reports: "4-reports",
  system: "5-system",
  templates: "6-templates",
} as const;

export const POPULATION_SUBFOLDERS = {
  raw: "1-raw",
  processed: "2-processed",
} as const;

export const SAMPLE_SUBFOLDERS = {
  main: "1-main",
  employees: "2-employees",
  approvals: "3-approvals",
} as const;

/**
 * `2-samples/{month}/1-main/answers.events/` and its layout-v2 children
 * (spec 2026-10-13 §4). THE one definition — `answerEventStore.ts` re-exports
 * `ANSWER_EVENTS_DIR` from `root`.
 *
 * - `layoutMarker`: present = the month is v2 (per-assignee). Written LAST by
 *   the migration; its presence is the commit point.
 * - `migrationLock`: an admin migration is running (or crashed) — writers defer.
 * - `archiveV1`: flat v1 segments, moved untouched by the migration.
 * - `quarantine`: v1 lines the migration could not attribute or parse.
 * - `assigneeArchive` / `assigneeSnapshot`: per-assignee children.
 */
export const ANSWER_EVENTS_FOLDERS = {
  root: "answers.events",
  layoutMarker: "_layout.json",
  migrationLock: "_migration.lock.json",
  archiveV1: "_archive-v1",
  quarantine: "_quarantine",
  assigneeArchive: "archive",
  assigneeSnapshot: "snapshot.json",
  /** Derived change markers for the sync probe (`answerFolderHeads.ts`); never user data. */
  heads: "_heads",
} as const;

// Round 7: the migration lock's `.tmp` fallback is routine on a contended share, not damage.
registerQuietRecoveryFileName(ANSWER_EVENTS_FOLDERS.migrationLock);

const RESERVED_ANSWER_EVENTS_CHILDREN: ReadonlySet<string> = new Set<string>([
  ANSWER_EVENTS_FOLDERS.archiveV1,
  ANSWER_EVENTS_FOLDERS.quarantine,
  ANSWER_EVENTS_FOLDERS.heads,
]);

/**
 * The `{assignee}` folder for a username. Lowercased because every answers
 * comparison is case-insensitive (`sameUser`), so `Emp1` saving and `emp1`
 * answered on behalf must land in ONE folder.
 */
export function answerAssigneeFolderName(assignee: string): string {
  const canonical = assignee.trim().toLowerCase();
  const name = safeWorkspaceFilePart(canonical);
  if (name === "" || name === "." || RESERVED_ANSWER_EVENTS_CHILDREN.has(name)) {
    throw new Error(`Invalid answer assignee "${assignee}": not usable as a folder name`);
  }
  // Review finding 9: sanitizing is lossy (`a/b` and `a_b` both give `a_b`,
  // `a..b` and `a.b` both give `a.b`), and two users sharing a folder would
  // fold each other's answers. A name the sanitizer leaves untouched keeps its
  // exact folder — every folder already written for such names stays valid —
  // while a name it CHANGED gets a deterministic hash of the canonical name.
  // `~` also forces the suffix, so a plain name can never spell a suffixed one.
  if (name === canonical && !canonical.includes(ANSWER_ASSIGNEE_HASH_SEPARATOR)) return name;
  return `${name}${ANSWER_ASSIGNEE_HASH_SEPARATOR}${hashSeedString(canonical).toString(36)}`;
}

const ANSWER_ASSIGNEE_HASH_SEPARATOR = "~";

/** True for a listed `answers.events/` child directory that is an assignee folder. */
export function isAnswerAssigneeFolderName(name: string): boolean {
  return name !== "" && !name.startsWith(".") && !RESERVED_ANSWER_EVENTS_CHILDREN.has(name);
}

export const SYSTEM_FOLDER_NAMES = {
  locks: "locks",
  audit: "audit",
  backups: "backups",
  powerbiExport: "powerbi-export",
  userPresets: "user-presets",
  feedback: "feedback",
  notifications: "notifications",
  /**
   * Ad-hoc population imports (owner requirement, 2026-08): admin-uploaded
   * one-off Excel files reviewed/assigned outside the regular Population
   * pipeline. Deliberately NOT under `1-population/{month}/` — that folder
   * is reserved for the real monthly risk/BI ingest and month-lock/manifest
   * machinery. See `src/data/adhocImport/`.
   */
  adhocImports: "adhoc-imports",
  /**
   * Persistent error log (owner requirement, 2026-08-24): one
   * `{stem}.errors.json` per user plus per-user per-year archives, written by
   * `src/data/errorLog/`. Deliberately NOT under `audit/` — the audit trail
   * records what PEOPLE deliberately did and is governance evidence; this
   * records what the SOFTWARE failed to do and is diagnostics. Mixing them
   * would put a 6,500-entries-a-month telemetry stream inside the folder an
   * auditor reads, and would drag the audit log's B5 hash-chain semantics onto
   * data that does not warrant them.
   */
  systemErrors: "system-errors",
  /**
   * Rolling per-record pre-change snapshot history (owner requirement,
   * 2026-09-03) — `src/data/history/actionHistory.ts`. Distinct from
   * `backups` (whole-workspace snapshots) and from safeWrite.ts's single
   * `.bak` per file (torn-write recovery only, one prior revision, no
   * history). See that module's doc comment for the full distinction.
   */
  history: "history",
} as const;

export const REPORTS_SUBFOLDERS = {
  designs: "designs",
} as const;

/**
 * Children of `5-system/notifications/`.
 *
 * `acks/` holds ONE file per acknowledging employee (`{username}.acks.json`).
 * Acknowledgements used to live inside the shared `notifications.json`, so
 * every employee pressing "قبول" rewrote the one file every other employee was
 * also rewriting. The per-writer split follows the approvals precedent
 * (`{supervisor}.decisions.json`): an employee only ever writes his own file,
 * so cross-user contention on the acknowledgement path is impossible.
 * Broadcasts themselves stay in the shared file — admin-written, low frequency.
 */
export const NOTIFICATIONS_SUBFOLDERS = {
  acks: "acks",
} as const;

/**
 * Children of `5-system/feedback/`.
 *
 * `threads/` holds ONE self-contained file per conversation
 * (`{threadId}.json`: the original message plus every reply). Feedback used to
 * be a single shared `messages.json` that every employee and every admin
 * rewrote in full on every submit and every reply — the same one-file-many-
 * writers shape the notification acks and the audit logs were already split
 * out of, and for the same reason: on a UNC/SMB share two concurrent writers
 * contend, the loser retries against a growing file, and the CAS ladder
 * exhausts (XQ-IO-032). A reply now rewrites only its own thread.
 */
export const FEEDBACK_SUBFOLDERS = {
  threads: "threads",
} as const;

/**
 * `5-system/audit/` children holding the PER-USER audit logs.
 *
 * The shared single files (`activity.log.json`, `actions.log.json`,
 * `actions.archive.{year}.json`) still sit directly in `audit/` and are read
 * forever — they are never rewritten, moved or deleted. New writes go into
 * these folders, one file per writer, so two employees working at the same time
 * never contend for the same file.
 */
export const AUDIT_SUBFOLDERS = {
  activity: "activity",
  actions: "actions",
} as const;

/**
 * A workspace root folder that is genuinely not there.
 *
 * Named `NotFoundError` on purpose: every optional-file reader in the data layer
 * separates "absent" from "I could not read it" by that name (see
 * `readOptionalJson` in safeWrite.ts), and a plain `Error` here forced them to
 * treat a permission failure and an empty workspace identically. The message is
 * unchanged — `backupStorage.ts` matches on its prefix.
 */
function missingWorkspaceFolder(name: string): Error {
  const error = new Error(`Missing workspace folder: ${name}`);
  error.name = "NotFoundError";
  return error;
}

export const LEGACY_WORKSPACE_ROOTS = {
  population: "Population",
  system: ".system",
  templates: "templates",
} as const;

/**
 * Children of a LEGACY population month folder that predate the numbered
 * layout (`raw/`/`processed/` before `1-raw/`/`2-processed/`, and the
 * sample/answers/approvals folders from before `2-samples/{month}/` existed).
 * Read-only fallbacks — nothing new is ever written under these names. Named
 * once here so every legacy reader and the selective-restore catalog
 * (`backup/restoreScope.ts`) agree on them.
 */
export const LEGACY_MONTH_SUBFOLDERS = {
  raw: "raw",
  processed: "processed",
  sample: "sample",
  employeeAnswers: "employee-answers",
  approvals: "approvals",
} as const;

/* --------------------------------------------------------------------------
 * Item 1.7 — directory-handle cache
 *
 * Every workspace read used to re-resolve its whole directory chain: reading
 * `2-samples/{month}/1-main/sample.master.json` cost three `getDirectoryHandle`
 * round trips before the file was even opened, and `getRoot` additionally
 * re-probed the numbered-vs-legacy folder name every single time. On a local
 * SSD that is noise; on the shared UNC/SMB volume this app actually runs
 * against, round trips dominate.
 *
 * Handles are therefore memoized per (workspace root, logical path). The
 * cache is invalidated on:
 *   - `bumpWorkspaceEpoch(root, month)` — checked lazily at lookup time, so
 *     no cross-module wiring is needed: a month-scoped entry stamped with an
 *     older epoch is dropped on read.
 *   - a manual refresh — the `"manual"` `dataRefreshSignal` broadcast, whose
 *     documented contract is "discard any local cache entirely", purges
 *     everything.
 *   - a `NotFoundError` raised while resolving a child through an already
 *     cached parent — the folder was deleted/recreated externally, so the
 *     stale ancestors are dropped and the resolution is retried once from the
 *     workspace root.
 * -------------------------------------------------------------------------- */

type DirCacheEntry = {
  handle: DirectoryHandleLike;
  /** Actual on-disk folder name (differs from the logical path's leaf for a legacy root). */
  resolvedName: string;
  /** Month this entry belongs to, or null when it is not month-scoped. */
  month: string | null;
  /** `workspaceEpoch(root, month)` at the time the entry was stored. */
  epoch: number;
};

type RootCache = {
  /** Generation this cache was created in; a full purge bumps the global one. */
  generation: number;
  /** Logical path → handle. */
  entries: Map<string, DirCacheEntry>;
  /** Logical root name → resolved on-disk name (numbered vs legacy-unnumbered). */
  rootNames: Map<string, string>;
};

/**
 * Keyed on the root HANDLE, not on `workspaceScopeId(root)`: scope ids are
 * recycled (`__clearInFlightForTests` resets the counter), so a string key
 * would let one workspace's entries answer for a different one. Handle
 * identity cannot collide. The scope id is still fine for the transient
 * `dedupeInFlight` keys, which never outlive a single resolution.
 */
const rootCaches = new WeakMap<DirectoryHandleLike, RootCache>();
let cacheGeneration = 0;

function cacheFor(root: DirectoryHandleLike): RootCache {
  const existing = rootCaches.get(root);
  if (existing && existing.generation === cacheGeneration) return existing;
  const fresh: RootCache = { generation: cacheGeneration, entries: new Map(), rootNames: new Map() };
  rootCaches.set(root, fresh);
  return fresh;
}

function cacheKeyFor(root: DirectoryHandleLike, path: string): string {
  return `${workspaceScopeId(root)}|${path}`;
}

function readDirCache(
  root: DirectoryHandleLike,
  path: string
): DirCacheEntry | null {
  const cache = cacheFor(root);
  const entry = cache.entries.get(path);
  if (!entry) return null;
  if (entry.month !== null && workspaceEpoch(root, entry.month) !== entry.epoch) {
    cache.entries.delete(path);
    return null;
  }
  return entry;
}

function storeDirCache(
  root: DirectoryHandleLike,
  path: string,
  month: string | null,
  resolvedName: string,
  handle: DirectoryHandleLike
): void {
  cacheFor(root).entries.set(path, {
    handle,
    resolvedName,
    month,
    epoch: month === null ? 0 : workspaceEpoch(root, month),
  });
  // Item 1.11: the logical path (never the legacy folder name, never a
  // per-session workspace id) is what lock keys are built from.
  registerDirectoryPath(handle, path);
}

/** Drop `path` and everything beneath it for one workspace root. */
function invalidateSubtree(root: DirectoryHandleLike, path: string): void {
  const cache = cacheFor(root);
  if (!path) {
    cache.entries.clear();
    cache.rootNames.clear();
    return;
  }
  for (const key of [...cache.entries.keys()]) {
    if (key === path || key.startsWith(`${path}/`)) cache.entries.delete(key);
  }
  // The top-level segment of the path is a logical root name; a vanished
  // ancestor also invalidates which on-disk folder that name resolved to.
  cache.rootNames.delete(path.split("/")[0]!);
}

/**
 * Drop cached directory handles. With no argument the whole cache is purged
 * (what a manual refresh does); with a root, only that workspace's entries.
 */
export function invalidateWorkspaceDirCache(root?: DirectoryHandleLike): void {
  if (!root) {
    // A WeakMap cannot be iterated; bumping the generation orphans every
    // per-root cache at once and lets GC reclaim them.
    cacheGeneration += 1;
    return;
  }
  rootCaches.delete(root);
}

/** Test-only reset. */
export function __clearWorkspaceDirCacheForTests(): void {
  invalidateWorkspaceDirCache();
}

// A manual refresh means "discard everything" (see dataRefreshSignal's
// DataRefreshSource docs). The periodic tick deliberately does NOT purge:
// month-scoped entries already follow the epoch, and folder *topology* does
// not change every 45 seconds.
if (typeof window !== "undefined") {
  subscribeToDataRefresh((source) => {
    if (source === "manual") {
      invalidateWorkspaceDirCache();
      invalidateAnswerEventsLayout();
    }
  });
}

async function getRoot(
  directoryHandle: DirectoryHandleLike,
  primaryName: string,
  legacyName: string | null,
  create: boolean
): Promise<DirectoryHandleLike> {
  const cached = readDirCache(directoryHandle, primaryName);
  // A cached *legacy* handle satisfies a `create: true` call too: the create
  // branch below resolves an existing legacy root rather than creating a
  // numbered sibling next to it, so both paths now agree on which folder the
  // writes land in.
  if (cached) return cached.handle;

  return dedupeInFlight(
    `workspaceDir:${cacheKeyFor(directoryHandle, primaryName)}:${create ? "c" : "r"}`,
    async () => {
      const again = readDirCache(directoryHandle, primaryName);
      if (again) return again.handle;

      if (create) {
        // NEVER create the numbered root over a legacy-layout workspace. This
        // branch used to create `1-population/` unconditionally and cache it as
        // the resolved root — so one ordinary autosave (saveCertScanGlobal,
        // savePopulationConfig) next to an existing `Population/` folder made
        // every legacy month permanently invisible: the numbered folder now
        // exists on disk and always wins the primary-first probe, and there is
        // no migration that moves the content across. Resolve an existing root
        // (numbered first, then legacy) and only create when neither is there.
        const existing = legacyName
          ? await resolveExistingRoot(directoryHandle, primaryName, legacyName)
          : null;
        if (existing) {
          cacheFor(directoryHandle).rootNames.set(primaryName, existing.resolvedName);
          storeDirCache(directoryHandle, primaryName, null, existing.resolvedName, existing.handle);
          return existing.handle;
        }
        const handle = await directoryHandle.getDirectoryHandle(primaryName, { create: true });
        cacheFor(directoryHandle).rootNames.set(primaryName, primaryName);
        storeDirCache(directoryHandle, primaryName, null, primaryName, handle);
        return handle;
      }

      const knownName = cacheFor(directoryHandle).rootNames.get(primaryName);
      if (knownName) {
        try {
          const handle = await directoryHandle.getDirectoryHandle(knownName, { create: false });
          storeDirCache(directoryHandle, primaryName, null, knownName, handle);
          return handle;
        } catch (error) {
          if (!isNotFoundError(error)) throw error;
          // The remembered folder disappeared — fall through and re-probe.
          cacheFor(directoryHandle).rootNames.delete(primaryName);
        }
      }

      let handle: DirectoryHandleLike;
      let resolvedName = primaryName;
      try {
        handle = await directoryHandle.getDirectoryHandle(primaryName, { create: false });
      } catch (error) {
        // "I could not look" is not "it is not there". A revoked grant or a
        // transient share failure must reach the caller; only a genuine absence
        // may fall through to the legacy name — or be reported as missing.
        if (!isNotFoundError(error)) throw error;
        if (!legacyName) throw missingWorkspaceFolder(primaryName);
        resolvedName = legacyName;
        handle = await directoryHandle.getDirectoryHandle(legacyName, { create: false });
      }
      cacheFor(directoryHandle).rootNames.set(primaryName, resolvedName);
      storeDirCache(directoryHandle, primaryName, null, resolvedName, handle);
      return handle;
    }
  );
}

/**
 * Probe for an already-existing root, numbered first and then the legacy
 * unnumbered name, without creating anything. `null` means neither is there.
 *
 * As everywhere else in this module, only a named `NotFoundError` counts as
 * absence: a revoked grant or a transient share failure must reach the caller
 * rather than be laundered into "create a fresh empty root here".
 */
async function resolveExistingRoot(
  directoryHandle: DirectoryHandleLike,
  primaryName: string,
  legacyName: string
): Promise<{ handle: DirectoryHandleLike; resolvedName: string } | null> {
  for (const name of [primaryName, legacyName]) {
    try {
      return { handle: await directoryHandle.getDirectoryHandle(name, { create: false }), resolvedName: name };
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }
  }
  return null;
}

/**
 * Resolve `childName` under an already-resolved parent, memoizing the result.
 * `parentPath` is the parent's logical path (used for cache keys, lock keys,
 * and stale-ancestor invalidation); `resolveParent` is re-invoked on the
 * one retry after a NotFoundError, so the retry starts from a fresh chain.
 */
async function getChildDir(
  root: DirectoryHandleLike,
  parentPath: string,
  resolveParent: () => Promise<DirectoryHandleLike>,
  childName: string,
  create: boolean,
  month: string | null
): Promise<DirectoryHandleLike> {
  const path = `${parentPath}/${childName}`;
  const cached = readDirCache(root, path);
  if (cached) return cached.handle;

  return dedupeInFlight(
    `workspaceDir:${cacheKeyFor(root, path)}:${create ? "c" : "r"}`,
    async () => {
      const again = readDirCache(root, path);
      if (again) return again.handle;

      const parentWasCached = readDirCache(root, parentPath) !== null;
      const parent = await resolveParent();
      let handle: DirectoryHandleLike;
      try {
        handle = await parent.getDirectoryHandle(childName, { create });
      } catch (error) {
        // A cached ancestor can outlive the folder it points at (deleted and
        // recreated on the share by another machine). Retry exactly once from
        // a freshly resolved chain; if the parent wasn't cached this is a
        // genuine miss and the error stands.
        if (!parentWasCached || !isNotFoundError(error)) throw error;
        invalidateSubtree(root, parentPath);
        const freshParent = await resolveParent();
        handle = await freshParent.getDirectoryHandle(childName, { create });
      }
      storeDirCache(root, path, month, childName, handle);
      return handle;
    }
  );
}

export async function getPopulationRoot(
  directoryHandle: DirectoryHandleLike,
  create = true
): Promise<DirectoryHandleLike> {
  return getRoot(directoryHandle, WORKSPACE_ROOTS.population, LEGACY_WORKSPACE_ROOTS.population, create);
}

export async function getPopulationMonthDir(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  create = false
): Promise<DirectoryHandleLike> {
  return getChildDir(
    directoryHandle,
    WORKSPACE_ROOTS.population,
    () => getPopulationRoot(directoryHandle, create),
    monthFolderName,
    create,
    monthFolderName
  );
}

export async function getSamplesRoot(
  directoryHandle: DirectoryHandleLike,
  create = true
): Promise<DirectoryHandleLike> {
  return getRoot(directoryHandle, WORKSPACE_ROOTS.samples, null, create);
}

export async function getSampleMonthDir(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  create = true
): Promise<DirectoryHandleLike> {
  return getChildDir(
    directoryHandle,
    WORKSPACE_ROOTS.samples,
    () => getSamplesRoot(directoryHandle, create),
    monthFolderName,
    create,
    monthFolderName
  );
}

/** `2-samples/{month}/{sub}` — the three per-month sample subfolders. */
function getSampleSubDir(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  subFolder: string,
  create: boolean
): Promise<DirectoryHandleLike> {
  return getChildDir(
    directoryHandle,
    `${WORKSPACE_ROOTS.samples}/${monthFolderName}`,
    () => getSampleMonthDir(directoryHandle, monthFolderName, create),
    subFolder,
    create,
    monthFolderName
  );
}

export async function getSampleMainDir(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  create = true
): Promise<DirectoryHandleLike> {
  return getSampleSubDir(directoryHandle, monthFolderName, SAMPLE_SUBFOLDERS.main, create);
}

export async function getSampleEmployeeDir(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  create = true
): Promise<DirectoryHandleLike> {
  return getSampleSubDir(directoryHandle, monthFolderName, SAMPLE_SUBFOLDERS.employees, create);
}

export async function getSampleApprovalsDir(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  create = true
): Promise<DirectoryHandleLike> {
  return getSampleSubDir(directoryHandle, monthFolderName, SAMPLE_SUBFOLDERS.approvals, create);
}

function sampleMainPath(monthFolderName: string): string {
  return `${WORKSPACE_ROOTS.samples}/${monthFolderName}/${SAMPLE_SUBFOLDERS.main}`;
}

function answerEventsPath(monthFolderName: string): string {
  return `${sampleMainPath(monthFolderName)}/${ANSWER_EVENTS_FOLDERS.root}`;
}

/** `2-samples/{month}/1-main/answers.events/`. */
export async function getAnswerEventsDir(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  create = false
): Promise<DirectoryHandleLike> {
  return getChildDir(
    directoryHandle,
    sampleMainPath(monthFolderName),
    () => getSampleMainDir(directoryHandle, monthFolderName, create),
    ANSWER_EVENTS_FOLDERS.root,
    create,
    monthFolderName
  );
}

/** `answers.events/{assignee}/` — live segments + `snapshot.json`. */
export async function getAssigneeAnswerEventsDir(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  assignee: string,
  create = false
): Promise<DirectoryHandleLike> {
  return getChildDir(
    directoryHandle,
    answerEventsPath(monthFolderName),
    () => getAnswerEventsDir(directoryHandle, monthFolderName, create),
    answerAssigneeFolderName(assignee),
    create,
    monthFolderName
  );
}

/** `answers.events/{assignee}/archive/` — segments folded into the snapshot. */
export async function getAssigneeArchiveDir(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  assignee: string,
  create = false
): Promise<DirectoryHandleLike> {
  return getChildDir(
    directoryHandle,
    `${answerEventsPath(monthFolderName)}/${answerAssigneeFolderName(assignee)}`,
    () => getAssigneeAnswerEventsDir(directoryHandle, monthFolderName, assignee, create),
    ANSWER_EVENTS_FOLDERS.assigneeArchive,
    create,
    monthFolderName
  );
}

/** `answers.events/_archive-v1/` — flat v1 segments, moved untouched. */
export async function getAnswerArchiveV1Dir(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  create = false
): Promise<DirectoryHandleLike> {
  return getChildDir(
    directoryHandle,
    answerEventsPath(monthFolderName),
    () => getAnswerEventsDir(directoryHandle, monthFolderName, create),
    ANSWER_EVENTS_FOLDERS.archiveV1,
    create,
    monthFolderName
  );
}

/** `answers.events/_quarantine/` — v1 lines the migration could not attribute or parse. */
export async function getAnswerQuarantineDir(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  create = false
): Promise<DirectoryHandleLike> {
  return getChildDir(
    directoryHandle,
    answerEventsPath(monthFolderName),
    () => getAnswerEventsDir(directoryHandle, monthFolderName, create),
    ANSWER_EVENTS_FOLDERS.quarantine,
    create,
    monthFolderName
  );
}

export type AnswerEventsLayout = "absent" | "v1" | "v1-migrating" | "v2";

/** A migration lock whose last heartbeat is older than this is abandoned (taken over by a rerun; ignored by the layout probe). */
export const MIGRATION_LOCK_STALE_MS = 30 * 60 * 1000;

/**
 * Months this tab has SEEN as v2, per workspace root. Monotone on purpose: the
 * layout only moves forward (rollback is a manual, reload-requiring operation —
 * see data-system-report.md), so one transient NotFound on `_layout.json` from a
 * lagging SMB listing can never flip a v2 month back to the flat reader, which
 * would show an employee an empty month. Every OTHER verdict is re-probed on
 * every call (three handle opens in parallel, one round trip): a stale "v1"
 * would send a save into the flat folder after the admin committed v2.
 */
let answerLayoutV2ByRoot = new WeakMap<DirectoryHandleLike, Set<string>>();

export function noteAnswerEventsLayoutV2(directoryHandle: DirectoryHandleLike, monthFolderName: string): void {
  let months = answerLayoutV2ByRoot.get(directoryHandle);
  if (!months) {
    months = new Set();
    answerLayoutV2ByRoot.set(directoryHandle, months);
  }
  months.add(monthFolderName);
}

export function invalidateAnswerEventsLayout(directoryHandle?: DirectoryHandleLike, monthFolderName?: string): void {
  if (!directoryHandle) {
    answerLayoutV2ByRoot = new WeakMap();
    return;
  }
  if (monthFolderName === undefined) answerLayoutV2ByRoot.delete(directoryHandle);
  else answerLayoutV2ByRoot.get(directoryHandle)?.delete(monthFolderName);
}

async function entryExists(open: () => Promise<unknown>): Promise<boolean> {
  try {
    await open();
    return true;
  } catch (error) {
    // "I could not look" is not "it is not there" — same rule as getRoot.
    if (isNotFoundError(error)) return false;
    throw error;
  }
}

export async function getAnswerEventsLayout(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<AnswerEventsLayout> {
  if (answerLayoutV2ByRoot.get(directoryHandle)?.has(monthFolderName)) return "v2";
  let eventsDir: DirectoryHandleLike;
  try {
    eventsDir = await getAnswerEventsDir(directoryHandle, monthFolderName, false);
  } catch (error) {
    if (isNotFoundError(error)) return "absent";
    throw error;
  }
  const [marker, lockFresh, archiveHoldsFiles] = await Promise.all([
    entryExists(() => eventsDir.getFileHandle(ANSWER_EVENTS_FOLDERS.layoutMarker, { create: false })),
    isMigrationLockFresh(eventsDir),
    archiveV1HoldsEntries(eventsDir),
  ]);
  if (marker) {
    noteAnswerEventsLayoutV2(directoryHandle, monthFolderName);
    return "v2";
  }
  // v154.0 review finding 2: an ABANDONED run (stale lock, nothing moved yet)
  // must not freeze every write for the month until an admin reruns. Only a
  // live lock, or flat segments already moved into _archive-v1/ (invisible to
  // a plain v1 read), keep the month v1-migrating -- and the probe re-offers
  // that second case as "incomplete".
  return lockFresh || archiveHoldsFiles ? "v1-migrating" : "v1";
}

/**
 * Freshness of `_migration.lock.json`, measured like the migration measures it:
 * the later of `startedAt`/`heartbeatAt`, else the file's own lastModified.
 * Absent = not fresh. Any read failure other than NotFound counts as FRESH --
 * "I could not look" must not unblock writers during a live run.
 */
async function isMigrationLockFresh(eventsDir: DirectoryHandleLike): Promise<boolean> {
  let file: File;
  try {
    file = await (await eventsDir.getFileHandle(ANSWER_EVENTS_FOLDERS.migrationLock, { create: false })).getFile();
  } catch (error) {
    if (isNotFoundError(error)) return false;
    return true;
  }
  return Date.now() - (await migrationLockLastSeenMs(eventsDir, file)) < MIGRATION_LOCK_STALE_MS;
}

/**
 * Round 7 field report: every v154 client called this on every save and every
 * sync probe, and each call OPENED the lock's content -- so during a run the
 * lock was almost always open on some machine, and the share refused the
 * migration's replace-in-place heartbeat. The content is now parsed once per
 * (size, lastModified) -- metadata from getFile(), which does not open the file
 * -- and reused until the lock is rewritten (one open per heartbeat, ~30 s).
 */
const lockLastSeenByDir = new WeakMap<DirectoryHandleLike, { size: number; lastModified: number; lastSeenMs: number }>();

async function migrationLockLastSeenMs(eventsDir: DirectoryHandleLike, file: File): Promise<number> {
  const cached = lockLastSeenByDir.get(eventsDir);
  if (cached && cached.size === file.size && cached.lastModified === file.lastModified && file.lastModified > 0) return cached.lastSeenMs;
  let lastSeenMs = file.lastModified || 0;
  try {
    const parsed = JSON.parse(await file.text()) as { data?: { startedAt?: string; heartbeatAt?: string }; startedAt?: string; heartbeatAt?: string };
    const lock = parsed?.data ?? parsed;
    const fromContent = Math.max(Date.parse(lock?.startedAt ?? "") || 0, Date.parse(lock?.heartbeatAt ?? "") || 0);
    if (fromContent > 0) lastSeenMs = fromContent;
  } catch {
    // Unparseable (torn write) or unreadable mid-replace: fall back to the file's own timestamp, uncached.
    return lastSeenMs;
  }
  lockLastSeenByDir.set(eventsDir, { size: file.size, lastModified: file.lastModified, lastSeenMs });
  return lastSeenMs;
}

/** True when `_archive-v1/` exists and holds at least one entry. A non-NotFound open error propagates (same rule as entryExists). */
async function archiveV1HoldsEntries(eventsDir: DirectoryHandleLike): Promise<boolean> {
  let archive: DirectoryHandleLike;
  try {
    archive = await eventsDir.getDirectoryHandle(ANSWER_EVENTS_FOLDERS.archiveV1, { create: false });
  } catch (error) {
    if (isNotFoundError(error)) return false;
    throw error;
  }
  const iterable = archive as DirectoryHandleLike & {
    values?: () => AsyncIterable<unknown>;
    entries?: () => AsyncIterable<unknown>;
  };
  const source = iterable.values?.() ?? iterable.entries?.();
  if (!source) return true;
  for await (const entry of source) {
    void entry;
    return true;
  }
  return false;
}

export async function getUserDataRoot(
  directoryHandle: DirectoryHandleLike,
  create = true
): Promise<DirectoryHandleLike> {
  return getRoot(directoryHandle, WORKSPACE_ROOTS.userData, null, create);
}

export async function getSystemRoot(
  directoryHandle: DirectoryHandleLike,
  create = true
): Promise<DirectoryHandleLike> {
  return getRoot(directoryHandle, WORKSPACE_ROOTS.system, LEGACY_WORKSPACE_ROOTS.system, create);
}

export async function getReportsRoot(
  directoryHandle: DirectoryHandleLike,
  create = true
): Promise<DirectoryHandleLike> {
  return getRoot(directoryHandle, WORKSPACE_ROOTS.reports, null, create);
}

export async function getTemplatesRoot(
  directoryHandle: DirectoryHandleLike,
  create = true
): Promise<DirectoryHandleLike> {
  return getRoot(directoryHandle, WORKSPACE_ROOTS.templates, LEGACY_WORKSPACE_ROOTS.templates, create);
}

/** `5-system/notifications/` — the shared broadcast log plus the `acks/` subfolder. */
export async function getNotificationsDir(
  directoryHandle: DirectoryHandleLike,
  create = true
): Promise<DirectoryHandleLike> {
  return getChildDir(
    directoryHandle,
    WORKSPACE_ROOTS.system,
    () => getSystemRoot(directoryHandle, create),
    SYSTEM_FOLDER_NAMES.notifications,
    create,
    null
  );
}

/** `5-system/notifications/acks/` — see `NOTIFICATIONS_SUBFOLDERS.acks`. */
export async function getNotificationAcksDir(
  directoryHandle: DirectoryHandleLike,
  create = true
): Promise<DirectoryHandleLike> {
  return getChildDir(
    directoryHandle,
    `${WORKSPACE_ROOTS.system}/${SYSTEM_FOLDER_NAMES.notifications}`,
    () => getNotificationsDir(directoryHandle, create),
    NOTIFICATIONS_SUBFOLDERS.acks,
    create,
    null
  );
}

/** `5-system/adhoc-imports/` — see `SYSTEM_FOLDER_NAMES.adhocImports`. */
export async function getAdhocImportsDir(
  directoryHandle: DirectoryHandleLike,
  create = true
): Promise<DirectoryHandleLike> {
  return getChildDir(
    directoryHandle,
    WORKSPACE_ROOTS.system,
    () => getSystemRoot(directoryHandle, create),
    SYSTEM_FOLDER_NAMES.adhocImports,
    create,
    null
  );
}

/**
 * `5-system/audit/` — resolved through `getChildDir`, so it is handle-cached
 * AND registered with `registerDirectoryPath`. `authActivityLog` and `actionLog`
 * used to call `systemDir.getDirectoryHandle("audit", …)` directly, which
 * skipped both: every write re-walked the chain, and `withResourceLock` keys
 * degraded to the bare leaf name — the "one lock for everything" defect
 * `webLocks.ts` was written to remove.
 */
export async function getAuditRoot(
  directoryHandle: DirectoryHandleLike,
  create = true
): Promise<DirectoryHandleLike> {
  return getChildDir(
    directoryHandle,
    WORKSPACE_ROOTS.system,
    () => getSystemRoot(directoryHandle, create),
    SYSTEM_FOLDER_NAMES.audit,
    create,
    null
  );
}

/** `5-system/audit/activity/` — one `{stem}.activity.json` per user. */
export async function getAuditActivityDir(
  directoryHandle: DirectoryHandleLike,
  create = true
): Promise<DirectoryHandleLike> {
  return getChildDir(
    directoryHandle,
    `${WORKSPACE_ROOTS.system}/${SYSTEM_FOLDER_NAMES.audit}`,
    () => getAuditRoot(directoryHandle, create),
    AUDIT_SUBFOLDERS.activity,
    create,
    null
  );
}

/** `5-system/audit/actions/` — one `{stem}.actions.json` per actor, plus per-actor yearly archives. */
export async function getAuditActionsDir(
  directoryHandle: DirectoryHandleLike,
  create = true
): Promise<DirectoryHandleLike> {
  return getChildDir(
    directoryHandle,
    `${WORKSPACE_ROOTS.system}/${SYSTEM_FOLDER_NAMES.audit}`,
    () => getAuditRoot(directoryHandle, create),
    AUDIT_SUBFOLDERS.actions,
    create,
    null
  );
}

/**
 * `5-system/system-errors/` — one `{stem}.errors.json` per user, plus per-user
 * yearly archives. Resolved through `getChildDir` for the same two reasons
 * `getAuditRoot` documents: the handle is cached (no re-walk per write) and the
 * path is registered with `registerDirectoryPath`, so `withResourceLock` keys
 * stay path-qualified instead of degrading to the bare leaf name.
 */
export async function getSystemErrorsDir(
  directoryHandle: DirectoryHandleLike,
  create = true
): Promise<DirectoryHandleLike> {
  return getChildDir(
    directoryHandle,
    WORKSPACE_ROOTS.system,
    () => getSystemRoot(directoryHandle, create),
    SYSTEM_FOLDER_NAMES.systemErrors,
    create,
    null
  );
}

/** `5-system/feedback/` — the feedback ("chat") root. */
export async function getFeedbackDir(
  directoryHandle: DirectoryHandleLike,
  create = true
): Promise<DirectoryHandleLike> {
  return getChildDir(
    directoryHandle,
    WORKSPACE_ROOTS.system,
    () => getSystemRoot(directoryHandle, create),
    SYSTEM_FOLDER_NAMES.feedback,
    create,
    null
  );
}

/** `5-system/feedback/threads/` — see `FEEDBACK_SUBFOLDERS.threads`. */
export async function getFeedbackThreadsDir(
  directoryHandle: DirectoryHandleLike,
  create = true
): Promise<DirectoryHandleLike> {
  return getChildDir(
    directoryHandle,
    `${WORKSPACE_ROOTS.system}/${SYSTEM_FOLDER_NAMES.feedback}`,
    () => getFeedbackDir(directoryHandle, create),
    FEEDBACK_SUBFOLDERS.threads,
    create,
    null
  );
}

/**
 * The legacy workspace-ROOT `feedback/` folder — an undocumented 7th top-level
 * folder that predates the move under `5-system/`. READ-ONLY by contract:
 * `create` is not a parameter because nothing may ever create it again, and
 * nothing may ever write into it. See `data-system-report.md` and
 * `feedbackStorage.ts`'s module note.
 */
export async function getLegacyFeedbackDir(
  directoryHandle: DirectoryHandleLike
): Promise<DirectoryHandleLike> {
  return directoryHandle.getDirectoryHandle(SYSTEM_FOLDER_NAMES.feedback, { create: false });
}

export function safeWorkspaceFilePart(value: string): string {
  return value.trim().replace(/[/\\:*?"<>|]+/g, "_").replace(/\.+/g, ".");
}
