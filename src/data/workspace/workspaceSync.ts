/**
 * The app's ONE workspace-sync path (owner mandate, 2026-08-13).
 *
 * There used to be three overlapping refresh mechanisms: SyncTick's 45s
 * change-set probe, a SECOND 45s interval in AuthGate that only called
 * `refreshPermissions()`, and the AdminToolbar refresh button, which
 * broadcast a blind `"manual"` refresh with no probe at all. They shared no
 * code, no in-flight guard, and no probe baseline. `runSync()` below is now
 * the single function all of it goes through; it has exactly TWO triggers:
 *
 *   - the automatic timer in `SyncTick.tsx` (`manual: false`)
 *   - the AdminToolbar refresh button (`manual: true`)
 *
 * Automatic vs manual differ in exactly one way, deliberately:
 *   - automatic is DELTA-ONLY. It probes, and broadcasts only the families it
 *     found changed (§4.2's "unchanged ⇒ zero invalidation" invariant). An
 *     empty change set broadcasts nothing at all.
 *   - manual still probes -- so the baseline stays correct and the reported
 *     change set is accurate -- but ALWAYS broadcasts `"manual"`, even when
 *     nothing changed. That preserves the full-cache purge in
 *     `directoryScan.ts` and the full query invalidation in
 *     `queryRefreshBridge.ts`: clicking refresh because something looks stale
 *     has to reliably fix it, which a delta-only manual path could not
 *     guarantee.
 *
 * BASELINE HAZARD (read before changing `probeChangedFamilies`): the first
 * probe for a given (workspace, month) has nothing to diff against, so it
 * establishes the baseline SILENTLY and reports an empty change set. A manual
 * run can be that first probe. This is safe only because a manual run
 * broadcasts unconditionally -- the silent baseline can never hide state from
 * subscribers, because they are told to discard everything anyway. If the
 * manual path is ever made conditional on `changed.size > 0`, that safety
 * disappears. Covered by `workspaceSync.test.tsx`'s "baseline hazard" block.
 *
 * Arguments are passed in explicitly (no module-level registration of the
 * "current" workspace/month/permissions callback) so that both callers derive
 * them from the same hooks -- `useWorkspace()` and `useGlobalMonth()` -- and
 * there is no second month-selection authority that can drift from
 * `useGlobalMonth()` after a month switch. The only module-level state here is
 * the probe baseline and the shared in-flight guard, both of which are
 * genuinely process-wide.
 */
import { broadcastDataRefresh, type DataRefreshFamily } from "./dataRefreshSignal";
import { bumpWorkspaceEpoch, workspaceScopeId } from "../storage/inFlightReads";
import { readDistributionLogStamp } from "../distribution/distributionStorage";
import { listDirectoryEntriesWithSize } from "../storage/directoryScan";
import { readEnvelopeRevision } from "../storage/safeWrite";
import { logError } from "../storage/errorLogger";
import {
  getPopulationMonthDir,
  getSampleMonthDir,
  getSystemRoot,
  SAMPLE_SUBFOLDERS,
  SYSTEM_FOLDER_NAMES,
} from "./workspacePaths";
import { DEFAULT_SYNC_INTERVAL_MS, readSyncIntervalMs } from "./syncSettings";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";

/** The cadence used until the workspace's own setting has been read (and
 *  whenever there is no workspace, no setting, or an unreadable one). §2's
 *  owner-mandated 30-60s band; the admin can now move it within the bounds
 *  documented in `syncSettings.ts`. */
export const SYNC_TICK_INTERVAL_MS = DEFAULT_SYNC_INTERVAL_MS;

/** Focus-thrashing guard: never issue an automatic run within this window of
 *  the last run of EITHER trigger, whether that was the interval, a
 *  hidden->visible transition, or a manual button press. */
export const FOCUS_COALESCE_WINDOW_MS = 10_000;

const MONTH_MANIFEST_FILE = "month.manifest.json";
const NOTIFICATIONS_FILE = "notifications.json";
const ANSWERS_SUFFIX = ".answers.json";
const DECISIONS_SUFFIX = ".json";

type Probe = {
  distributionRevision: number | null;
  distributionWriteToken: string | undefined;
  notificationsRevision: number | null;
  /** Serialized, sorted name->size map covering BOTH the employee-answers
   *  dir and the approvals (supervisor decisions) dir. A single combined
   *  string because a size-diff alone cannot cheaply distinguish "an answer
   *  changed" from "a request was appended" -- both live in the same
   *  per-employee/per-supervisor JSON files (F21/F22). See `diffFamilies`
   *  for how that ambiguity is resolved into the "requests" vs "answers"
   *  family split. */
  answersSignature: string;
  approvalsSignature: string;
  manifestRevision: number | null;
};

const previousProbes = new Map<string, Probe>();

/** The ONE in-flight guard, shared by both triggers: a promise while a run is
 *  open, null otherwise. Module-level rather than a component ref precisely
 *  because the manual button and the timer live in different components and
 *  must not probe concurrently -- two interleaved probes would race on
 *  `previousProbes` and could drop a change set. */
let inFlight: Promise<SyncRunResult> | null = null;

/** When the last run of either trigger started (epoch ms). */
let lastSyncStartedAt = 0;

/**
 * The workspace's effective sync cadence, as last read from disk.
 *
 * LIVE RE-ARM WITHOUT A SECOND TIMER: the settings read rides along on the sync
 * run itself (`performSync` below). Every automatic tick already goes to disk
 * for the probe, so one more tiny JSON read costs nothing measurable, and it
 * means an admin's change reaches every other client within at most one
 * interval — with no extra poll, no extra listener and no extra timer. When the
 * value moves, subscribers (i.e. `SyncTick`) are notified and re-arm their
 * interval in place; the currently-armed timer does NOT have to expire at the
 * old cadence first, because SyncTick clears and reinstalls it on change.
 *
 * Deliberately NOT reset by `__resetWorkspaceSyncStateForTests` alone — see
 * that function; both are cleared there so a test never inherits another
 * test's cadence.
 */
let effectiveSyncIntervalMs = DEFAULT_SYNC_INTERVAL_MS;
const syncIntervalSubscribers = new Set<(intervalMs: number) => void>();

/** The cadence every automatic trigger should currently be using. */
export function getSyncIntervalMs(): number {
  return effectiveSyncIntervalMs;
}

/** Subscribe to cadence changes. Returns an unsubscribe function. */
export function subscribeToSyncInterval(listener: (intervalMs: number) => void): () => void {
  syncIntervalSubscribers.add(listener);
  return () => {
    syncIntervalSubscribers.delete(listener);
  };
}

function applySyncInterval(next: number): void {
  if (next === effectiveSyncIntervalMs) return;
  effectiveSyncIntervalMs = next;
  for (const listener of [...syncIntervalSubscribers]) {
    try {
      listener(next);
    } catch (error) {
      // One misbehaving subscriber must not stop the others from re-arming.
      logError("workspaceSync:intervalListener", error);
    }
  }
}

/**
 * Read the stored cadence and publish it. Called by every sync run, and once
 * by `SyncTick` on mount so a client that loads with a stored 5-minute cadence
 * does not spend its first tick at 45s. This is a one-shot read, NOT a poll —
 * the recurring carrier is the sync run itself.
 */
export async function refreshSyncIntervalFromDisk(
  directoryHandle: DirectoryHandleLike | null,
  /** An already-open `5-system/` handle, when the caller has one. */
  systemDir?: DirectoryHandleLike | null
): Promise<number> {
  const next = await readSyncIntervalMs(directoryHandle, { systemDir });
  applySyncInterval(next);
  return next;
}

/** Test-only: forget every remembered probe baseline and release the guard. */
export function __resetWorkspaceSyncStateForTests(): void {
  previousProbes.clear();
  inFlight = null;
  lastSyncStartedAt = 0;
  effectiveSyncIntervalMs = DEFAULT_SYNC_INTERVAL_MS;
  syncIntervalSubscribers.clear();
}

/** Exposed for SyncTick's visibilitychange coalescing. */
export function getLastSyncStartedAt(): number {
  return lastSyncStartedAt;
}

function probeKey(directoryHandle: DirectoryHandleLike, monthFolderName: string): string {
  return `${workspaceScopeId(directoryHandle)}|${monthFolderName}`;
}

async function openOrNull(
  resolve: () => Promise<DirectoryHandleLike>
): Promise<DirectoryHandleLike | null> {
  try {
    return await resolve();
  } catch {
    // A folder that does not exist yet is the normal state of a fresh
    // workspace, and must degrade to a neutral probe value, never to a throw.
    return null;
  }
}

/**
 * The directories one probe run needs, each resolved EXACTLY ONCE.
 *
 * Every `getDirectoryHandle` is a network round trip on the UNC/SMB share this
 * app is deployed on, and the five probe families overlap heavily: three of them
 * hang off `2-samples/{month}`, two off `1-population/{month}`, two off
 * `5-system`. Resolving per family re-walked those shared parents and cost 16
 * directory opens per tick per client; resolving them here costs 9, with
 * identical results. (Handles are used only for the duration of this one run —
 * nothing is cached across runs, so there is no stale-handle window.)
 */
type ProbeDirs = {
  mainDir: DirectoryHandleLike | null;
  employeesDir: DirectoryHandleLike | null;
  approvalsDir: DirectoryHandleLike | null;
  populationMonthDir: DirectoryHandleLike | null;
  notificationsDir: DirectoryHandleLike | null;
};

async function resolveProbeDirs(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  systemDir: DirectoryHandleLike | null
): Promise<ProbeDirs> {
  const [samplesMonthDir, populationMonthDir] = await Promise.all([
    openOrNull(() => getSampleMonthDir(directoryHandle, monthFolderName, false)),
    openOrNull(() => getPopulationMonthDir(directoryHandle, monthFolderName, false)),
  ]);
  const [mainDir, employeesDir, approvalsDir, notificationsDir] = await Promise.all([
    samplesMonthDir
      ? openOrNull(() => samplesMonthDir.getDirectoryHandle(SAMPLE_SUBFOLDERS.main, { create: false }))
      : null,
    samplesMonthDir
      ? openOrNull(() => samplesMonthDir.getDirectoryHandle(SAMPLE_SUBFOLDERS.employees, { create: false }))
      : null,
    samplesMonthDir
      ? openOrNull(() => samplesMonthDir.getDirectoryHandle(SAMPLE_SUBFOLDERS.approvals, { create: false }))
      : null,
    systemDir
      ? openOrNull(() => systemDir.getDirectoryHandle(SYSTEM_FOLDER_NAMES.notifications, { create: false }))
      : null,
  ]);
  return { mainDir, employeesDir, approvalsDir, populationMonthDir, notificationsDir };
}

async function safeRevision(
  dir: DirectoryHandleLike | null,
  fileName: string
): Promise<number | null> {
  if (!dir) return null;
  try {
    return await readEnvelopeRevision(dir, fileName);
  } catch {
    return null;
  }
}

function signature(entries: { name: string; size: number }[]): string {
  return JSON.stringify(entries.map((entry) => [entry.name, entry.size]));
}

async function safeSignature(dir: DirectoryHandleLike | null, suffix: string): Promise<string> {
  if (!dir) return "";
  try {
    return signature(await listDirectoryEntriesWithSize(dir, suffix));
  } catch {
    return "";
  }
}

/**
 * One run's worth of probing (§4.2's per-family change set). Every probe
 * degrades to a neutral "unreadable" value on failure (missing folder on a
 * fresh workspace, permission hiccup, ...) rather than throwing -- a probe
 * failure must never crash the run or block the OTHER families' probes.
 */
async function probeMonth(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  systemDir: DirectoryHandleLike | null
): Promise<Probe> {
  const dirs = await resolveProbeDirs(directoryHandle, monthFolderName, systemDir);
  const [distStamp, notificationsRevision, answersSignature, approvalsSignature, manifestRevision] =
    await Promise.all([
      readDistributionLogStamp(directoryHandle, monthFolderName, {
        currentDir: dirs.mainDir,
        legacyDir: dirs.populationMonthDir,
      }).catch(() => ({
        revision: -1,
        writeToken: undefined,
      })),
      safeRevision(dirs.notificationsDir, NOTIFICATIONS_FILE),
      safeSignature(dirs.employeesDir, ANSWERS_SUFFIX),
      safeSignature(dirs.approvalsDir, DECISIONS_SUFFIX),
      safeRevision(dirs.populationMonthDir, MONTH_MANIFEST_FILE),
    ]);

  return {
    distributionRevision: distStamp.revision,
    distributionWriteToken: distStamp.writeToken,
    notificationsRevision,
    answersSignature,
    approvalsSignature,
    manifestRevision,
  };
}

function diffFamilies(previous: Probe | undefined, current: Probe): Set<DataRefreshFamily> {
  const changed = new Set<DataRefreshFamily>();
  if (!previous) {
    // First probe for this (workspace, month) this session -- nothing to
    // diff against yet. Establish the baseline silently; do not report
    // every family as "changed" just because we've never looked before.
    // See the BASELINE HAZARD note in this file's header for why a manual
    // run landing here is still safe.
    return changed;
  }
  if (
    previous.distributionRevision !== current.distributionRevision ||
    previous.distributionWriteToken !== current.distributionWriteToken
  ) {
    changed.add("distribution");
  }
  if (previous.notificationsRevision !== current.notificationsRevision) {
    changed.add("notifications");
  }
  if (previous.answersSignature !== current.answersSignature) {
    // Ambiguous by construction (see Probe's doc comment): an answers-dir
    // size change could be a new referral/replacement/reopen request OR a
    // changed item answer. Mark both rather than guessing -- the cost is an
    // extra invalidation on subscribers of one family, never a missed one.
    changed.add("requests");
    changed.add("answers");
  }
  if (previous.approvalsSignature !== current.approvalsSignature) {
    changed.add("requests");
  }
  if (previous.manifestRevision !== current.manifestRevision) {
    changed.add("manifest");
  }
  return changed;
}

async function probeChangedFamilies(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  systemDir: DirectoryHandleLike | null
): Promise<Set<DataRefreshFamily>> {
  const key = probeKey(directoryHandle, monthFolderName);
  const current = await probeMonth(directoryHandle, monthFolderName, systemDir);
  const changed = diffFamilies(previousProbes.get(key), current);
  previousProbes.set(key, current);
  return changed;
}

export type SyncRunOptions = {
  /** true for the AdminToolbar button, false/absent for the automatic timer. */
  manual?: boolean;
  directoryHandle: DirectoryHandleLike | null;
  /** The globally selected month folder, or null when no month is selected --
   *  in which case the data probe is skipped and only permissions re-sync. */
  monthFolderName: string | null;
  /** `WorkspaceProvider.refreshPermissions`; omitted only in tests that
   *  exercise the probe alone. */
  refreshPermissions?: () => Promise<boolean>;
};

export type SyncRunResult = {
  /** false only when an AUTOMATIC run was coalesced away by the in-flight
   *  guard. A manual run always ends up running. */
  ran: boolean;
  /** false when the permission re-sync failed or the probe threw -- this is
   *  what drives the refresh button's red state. */
  ok: boolean;
  changed: Set<DataRefreshFamily>;
  /** Whether this run emitted a `dataRefreshSignal` broadcast. */
  broadcast: boolean;
};

function skippedResult(): SyncRunResult {
  return { ran: false, ok: true, changed: new Set(), broadcast: false };
}

async function performSync(options: SyncRunOptions, manual: boolean): Promise<SyncRunResult> {
  lastSyncStartedAt = Date.now();
  const { directoryHandle, monthFolderName, refreshPermissions } = options;

  let ok = true;
  if (refreshPermissions) {
    try {
      ok = await refreshPermissions();
    } catch (error) {
      logError("workspaceSync:permissions", error);
      ok = false;
    }
  }

  // `5-system/` is opened ONCE per run and handed to both the cadence read and
  // the notifications probe. Each of them used to resolve it independently, and
  // on a UNC/SMB share that second resolution is a network round trip paid by
  // every client on every tick for no new information.
  const systemDir = directoryHandle
    ? await openOrNull(() => getSystemRoot(directoryHandle, false))
    : null;

  // The cadence rides along on every run (see `effectiveSyncIntervalMs`), so
  // an admin's change propagates to other clients without a second timer. It
  // is deliberately NOT gated on a month being selected — the cadence is
  // workspace-wide, and a client sitting with no month selected still needs to
  // pick up a change. `readSyncIntervalMs` never throws and never fails a run:
  // an unreadable settings file yields the default and leaves `ok` alone.
  if (directoryHandle) {
    await refreshSyncIntervalFromDisk(directoryHandle, systemDir);
  }

  let changed = new Set<DataRefreshFamily>();
  if (directoryHandle && monthFolderName) {
    try {
      changed = await probeChangedFamilies(directoryHandle, monthFolderName, systemDir);
    } catch (error) {
      logError("workspaceSync:probe", error);
      ok = false;
    }
  }

  const broadcast = manual || changed.size > 0;
  if (broadcast) {
    // §4.1's rule: a Query invalidation must be paired with
    // bumpWorkspaceEpoch to actually reach disk on the NEXT read -- this is
    // also what keeps A6c's session-scoped derive memo
    // (distributionStorage.ts) from serving a now-known-stale value past
    // this run. A manual run bumps it unconditionally: "discard everything"
    // that still lets a memo answer from cache is not a hard refresh.
    if (directoryHandle && monthFolderName) {
      bumpWorkspaceEpoch(directoryHandle, monthFolderName);
    }
    if (manual) {
      broadcastDataRefresh("manual");
    } else {
      broadcastDataRefresh({ source: "periodic", changed });
    }
  }

  return { ran: true, ok, changed, broadcast };
}

/**
 * The single sync entry point. Never throws: a probe or permission failure
 * comes back as `ok: false`.
 *
 * Concurrency: one run at a time, process-wide. An AUTOMATIC run that arrives
 * while another is open is dropped (the next tick catches up); a MANUAL run
 * waits for the open run to settle and then performs its own forced pass, so
 * a click can never be silently absorbed into someone else's delta-only run.
 */
export async function runSync(options: SyncRunOptions): Promise<SyncRunResult> {
  const manual = options.manual === true;

  while (inFlight) {
    if (!manual) return skippedResult();
    // Wait out the open run, then re-check: another manual click may have
    // claimed the guard in the meantime. The claim below is synchronous
    // (no await between the loop exit and the assignment), so exactly one
    // caller can win.
    await inFlight.catch(() => undefined);
  }

  const promise = performSync(options, manual);
  inFlight = promise;
  try {
    return await promise;
  } finally {
    if (inFlight === promise) inFlight = null;
  }
}
