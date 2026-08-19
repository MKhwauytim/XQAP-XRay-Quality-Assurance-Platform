import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { dedupeInFlight, workspaceEpoch, workspaceScopeId } from "../storage/inFlightReads";
import { isNotFoundError } from "../storage/transientFileErrors";
import { registerDirectoryPath } from "../storage/webLocks";
import { subscribeToDataRefresh } from "./dataRefreshSignal";

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
    if (source === "manual") invalidateWorkspaceDirCache();
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

export function safeWorkspaceFilePart(value: string): string {
  return value.trim().replace(/[/\\:*?"<>|]+/g, "_").replace(/\.+/g, ".");
}
