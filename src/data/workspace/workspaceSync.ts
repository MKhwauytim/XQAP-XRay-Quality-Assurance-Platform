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
import { bumpWorkspaceEpoch, workspaceEpoch, workspaceScopeId } from "../storage/inFlightReads";
import { carryRequestQueuesAcrossEpochBump } from "../answers/answerStorage";
import { ownStableAnswerSegmentMatcher } from "../answers/answerSegmentChain";
import {
  invalidateSealedAnswerSegmentNames,
  invalidateSealedAnswerSegments,
} from "../answers/answerSealedSegments";
import { readRealSession } from "../../auth/authSession";
import { readDistributionLogStamp } from "../distribution/distributionStorage";
import {
  boundedSizeSignature,
  listDirectoryEntriesWithSize,
  type SizedDirectoryEntry,
} from "../storage/directoryScan";
import {
  DISTRIBUTION_EVENTS_DIR,
  DISTRIBUTION_EVENT_SEGMENT_SUFFIX,
} from "../distribution/distributionEventStore";
import {
  ANSWER_EVENTS_DIR,
  ANSWER_EVENT_SEGMENT_SUFFIX,
} from "../answers/answerEventStore";
import { readEnvelopeRevision } from "../storage/safeWrite";
import { logError } from "../storage/errorLogger";
import { isNotFoundError } from "../storage/transientFileErrors";
import { ACK_FILE_SUFFIX } from "../notifications/notificationAckStorage";
import { FEEDBACK_THREAD_FILE_SUFFIX } from "../feedback/feedbackStorage";
import {
  getPopulationMonthDir,
  getSampleMonthDir,
  getSystemRoot,
  FEEDBACK_SUBFOLDERS,
  NOTIFICATIONS_SUBFOLDERS,
  SAMPLE_SUBFOLDERS,
  SYSTEM_FOLDER_NAMES,
} from "./workspacePaths";
import { DEFAULT_SYNC_INTERVAL_MS, readSyncIntervalMs } from "./syncSettings";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { invalidateMonthLockCache } from "../population/monthLock";

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
const REQUESTS_SUFFIX = ".requests.json";
const DECISIONS_SUFFIX = ".json";

/**
 * "This family could not be probed on this tick."
 *
 * Deliberately distinct from every legitimate probe value, INCLUDING the neutral
 * ones a missing folder or a missing file produce (`null` revision, `""`
 * signature): those are real observations of a real workspace and must keep
 * taking part in the diff. A FAILED read is not an observation. Storing its
 * neutral placeholder as the new baseline made the next SUCCESSFUL read differ
 * from it and broadcast a change that never happened — so one transient share
 * blip cost every client a spurious refresh, and a refresh is not free: it can
 * clobber unsaved draft state (see dataRefreshSignal's note). An unprobed family
 * therefore carries its PREVIOUS baseline forward untouched and reports nothing
 * — neither "changed" nor "reset" — until it can be read again.
 */
const UNPROBED = Symbol("unprobed");
type Probed<T> = T | typeof UNPROBED;

function isProbed<T>(value: Probed<T>): value is T {
  return value !== UNPROBED;
}

/** Previous value when this tick could not probe the family; otherwise this tick's. */
function carry<T>(previous: Probed<T>, current: Probed<T>): Probed<T> {
  return isProbed(current) ? current : previous;
}

/** False whenever EITHER side is unprobed — an unreadable tick is never a change. */
function movedFrom<T>(
  previous: Probed<T>,
  current: Probed<T>,
  equals: (a: T, b: T) => boolean
): boolean {
  if (!isProbed(previous) || !isProbed(current)) return false;
  return !equals(previous, current);
}

const sameValue = <T,>(a: T, b: T): boolean => Object.is(a, b);

type DistributionStamp = { revision: number; writeToken: string | undefined };

type Probe = {
  distributionStamp: Probed<DistributionStamp>;
  notificationsRevision: Probed<number | null>;
  /**
   * Bounded name+size signature of `5-system/notifications/acks/*.acks.json`
   * (see `boundedSizeSignature`), joined to the `notifications` family.
   *
   * The shared `notifications.json` revision above covers broadcasts only. Since
   * acknowledgements moved to one file per employee, an ack writes NOTHING that
   * revision can see, so the manager's "who acknowledged" roster — which reloads
   * on the refresh signal — went stale until someone pressed refresh by hand.
   * This is the signal for it.
   *
   * `""` is a real observation (no acks folder, or no ack files in it) and diffs
   * normally; only a read that FAILED yields `UNPROBED`.
   */
  acksSignature: Probed<string>;
  /** Serialized, sorted name->(size, mtime) map covering BOTH the
   *  employee-answers dir and the approvals (supervisor decisions) dir. A
   *  single combined string because a per-file diff alone cannot cheaply
   *  distinguish "an answer changed" from "a request was appended" -- both
   *  live in the same per-employee/per-supervisor JSON files (F21/F22). See
   *  `diffFamilies` for how that ambiguity is resolved into the "requests" vs
   *  "answers" family split.
   *
   *  SIZE IS NOT ENOUGH ON ITS OWN. These files are `JsonEnvelope`s, and an
   *  envelope edit routinely preserves byte length -- `metadata.revision`
   *  going 9 -> 10, a same-width `writtenAt`, a same-width `contentHash`, an
   *  equal-length answer value. A size-only signature reports such a tick as
   *  "unchanged" and the edit stays invisible until a manual refresh. The
   *  mtime comes free with the `getFile()` the size already costs (see
   *  `listDirectoryEntriesWithSize` for why the envelope revision itself is
   *  deliberately NOT read here, and why it is still the signal for the
   *  single-file manifest/notifications probes). */
  answersSignature: Probed<string>;
  /** Bounded name+size signature of the per-employee `*.requests.json` files
   *  (referral / replacement / reopen queues). Before the answers family was
   *  split from "requests" nothing probed these directly: a request change was
   *  only ever noticed because an answer-segment change happened to mark
   *  "requests" too. Now it has its own signal. */
  requestsFilesSignature: Probed<string>;
  approvalsSignature: Probed<string>;
  manifestRevision: Probed<number | null>;
  /** Bounded name+size signature of `distribution.events/*.ndjson` (see
   *  `boundedSizeSignature`). The compatibility log's CAS stamp above covers
   *  the distribution family only while the stamp and the durable events move
   *  together — a RESTORE moves the events and deliberately leaves the stamp
   *  (backupStorage's `restore-if-absent`), and an append whose projection
   *  write failed leaves events on disk with the stamp unmoved. This is the
   *  independent signal for both. */
  segmentsSignature: Probed<string>;
  /**
   * Bounded name+size signature of `answers.events/*.ndjson` (§6 of the
   * answer-save append-only rewrite) — the read-only freshness signal for
   * another user's answer save. Zero new writes: same primitive and shape as
   * `segmentsSignature` above, joined into the `answers` family below (an
   * answer segment changing is exactly as ambiguous by construction as the
   * legacy per-employee file signature already is — see `answersSignature`'s
   * own doc comment — so it is folded into the same "requests" + "answers"
   * broadcast rather than trying to guess which one moved).
   */
  answersEventsSignature: Probed<string>;
  /**
   * Bounded name+size signature of `5-system/feedback/threads/*.json` — the
   * shared feedback ("chat") threads. It is the signal behind the unread dot on
   * both widget triggers, so a message or a reply posted on another machine has
   * to reach other clients on a tick rather than on a manual refresh.
   *
   * The THREADS directory, not `threads.index.json`: a plain reply deliberately
   * does not touch the index (that is what keeps the one shared file rarely
   * written — see feedbackStorage's `updateThreadsIndex`), so an index-revision
   * probe would go blind to exactly the event this family exists to report.
   * The thread files are the authority, so they are what is watched.
   *
   * Same bounded shape as the segments and acks probes: one listing, no file
   * content, at most DEFAULT_SIZE_SIGNATURE_STAT_BUDGET size stats taken from
   * the TAIL of the name-sorted listing. A new thread adds a NAME (always
   * detected); a reply changes a SIZE (detected for the newest 64 — which is
   * what feedbackStorage's time-ordered thread ids guarantee the tail holds).
   * A reply to an older thread than that is picked up by
   * FeedbackUnreadProvider's own 60 s poll instead; this tick is a latency
   * optimization on top of that poll, never the only path.
   *
   * Deliberately the CURRENT location only: a legacy workspace whose feedback
   * still sits in `messages.json` probes as "no folder" (a real observation,
   * diffed normally) until the first client to open it migrates it forward —
   * see feedbackStorage's `migrateLegacyMessages`. Probing the legacy root too
   * would put a second directory open on every tick of every client to cover a
   * state that heals itself the first time anyone opens the panel.
   */
  feedbackSignature: Probed<string>;
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
  } catch (error) {
    // A folder that does not exist yet is the normal state of a fresh
    // workspace, and must degrade to a neutral probe value, never to a throw.
    // ONLY a genuine absence, though (same rule as distributionStorage's
    // openOptionalDirectory): a transient share failure on the OPEN used to
    // land here too, and every family hanging off that directory then probed
    // as "empty" and became the baseline — so the next healthy tick reported
    // the whole month as changed. Anything else propagates, which aborts this
    // tick's probe with `ok: false` and leaves the previous baseline intact.
    if (!isNotFoundError(error)) throw error;
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
  /** `2-samples/{month}/1-main/distribution.events`, or null when absent. */
  eventsDir: DirectoryHandleLike | null;
  /** `2-samples/{month}/1-main/answers.events`, or null when absent. */
  answersEventsDir: DirectoryHandleLike | null;
  employeesDir: DirectoryHandleLike | null;
  approvalsDir: DirectoryHandleLike | null;
  populationMonthDir: DirectoryHandleLike | null;
  notificationsDir: DirectoryHandleLike | null;
  feedbackDir: DirectoryHandleLike | null;
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
  const [mainDir, employeesDir, approvalsDir, notificationsDir, feedbackDir] = await Promise.all([
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
    systemDir
      ? openOrNull(() => systemDir.getDirectoryHandle(SYSTEM_FOLDER_NAMES.feedback, { create: false }))
      : null,
  ]);
  // The one open that CANNOT join a batch above: it hangs off `mainDir`, which
  // the batch above is what resolves. One extra round trip per tick, in exchange
  // for the only signal that sees a restore (see Probe.segmentsSignature).
  // `answersEventsDir` hangs off the same `mainDir` and joins this batch for
  // the identical reason (§6 of the answer-save proposal).
  const [eventsDir, answersEventsDir] = mainDir
    ? await Promise.all([
        openOrNull(() => mainDir.getDirectoryHandle(DISTRIBUTION_EVENTS_DIR, { create: false })),
        openOrNull(() => mainDir.getDirectoryHandle(ANSWER_EVENTS_DIR, { create: false })),
      ])
    : [null, null];
  return {
    mainDir,
    eventsDir,
    answersEventsDir,
    employeesDir,
    approvalsDir,
    populationMonthDir,
    notificationsDir,
    feedbackDir,
  };
}

async function safeRevision(
  dir: DirectoryHandleLike | null,
  fileName: string
): Promise<Probed<number | null>> {
  // A folder that is not there is an OBSERVATION (revision: none), not a
  // failure — it diffs normally. A read that threw is neither.
  if (!dir) return null;
  try {
    return await readEnvelopeRevision(dir, fileName);
  } catch (error) {
    logError("workspaceSync:probeRevision", error);
    return UNPROBED;
  }
}

function signature(entries: SizedDirectoryEntry[]): string {
  return JSON.stringify(entries.map((entry) => [entry.name, entry.size, entry.lastModified]));
}

async function safeSignature(
  dir: DirectoryHandleLike | null,
  suffix: string
): Promise<Probed<string>> {
  if (!dir) return "";
  try {
    return signature(await listDirectoryEntriesWithSize(dir, suffix));
  } catch (error) {
    logError("workspaceSync:probeSignature", error);
    return UNPROBED;
  }
}

async function safeSegmentsSignature(dir: DirectoryHandleLike | null): Promise<Probed<string>> {
  if (!dir) return "";
  try {
    return await boundedSizeSignature(dir, DISTRIBUTION_EVENT_SEGMENT_SUFFIX);
  } catch (error) {
    logError("workspaceSync:probeSegments", error);
    return UNPROBED;
  }
}

/** Stat budget for the answer-segment probe: one per live chain head (employees x devices), with headroom. */
const ANSWER_SEGMENT_HEAD_STAT_BUDGET = 64;

/** The `File`s the last answer-segment probe stat'd, kept for the owners peek of the SAME run (runs are single-flight). */
let probedAnswerFiles = new Map<string, Blob>();

async function safeRequestsFilesSignature(dir: DirectoryHandleLike | null): Promise<Probed<string>> {
  if (!dir) return "";
  try {
    return await boundedSizeSignature(dir, REQUESTS_SUFFIX);
  } catch (error) {
    logError("workspaceSync:probeRequestsFiles", error);
    return UNPROBED;
  }
}

/** §6 of the answer-save proposal: read-only, bounded — same primitive and shape as `safeSegmentsSignature` above. */
async function safeAnswerSegmentsSignature(
  dir: DirectoryHandleLike | null,
  monthFolderName: string
): Promise<Probed<string>> {
  if (!dir) return "";
  try {
    // A11: this user's own appends are already reflected locally (the saving
    // view updated its own state). Signing them made every save come back to
    // its author as a remote change one tick later and triggered the stale
    // reload that downgraded the row. Matched by the persisted STABLE CHAIN
    // prefix, not a per-page-load "written" set: the chain outlives a reload,
    // so the exclusion is identical from the baseline onwards and also covers
    // rotations written by an earlier page load. Other writers (and other users
    // of this browser) still count.
    const actor = readRealSession()?.username;
    probedAnswerFiles = new Map();
    return await boundedSizeSignature(
      dir,
      ANSWER_EVENT_SEGMENT_SUFFIX,
      ANSWER_SEGMENT_HEAD_STAT_BUDGET,
      actor ? ownStableAnswerSegmentMatcher(monthFolderName, actor) : undefined,
      // A11: size the chain HEADS, not the newest names (see boundedSizeSignature).
      true,
      probedAnswerFiles
    );
  } catch (error) {
    logError("workspaceSync:probeAnswerSegments", error);
    return UNPROBED;
  }
}

/**
 * Bounded signature of the per-employee acknowledgement files.
 *
 * ONE directory listing plus at most `DEFAULT_SIZE_SIGNATURE_STAT_BUDGET` size
 * stats, and no file content is read — the same shape the segments probe above
 * uses, and the reason `safeRevision` (one envelope read per file) was not
 * reused here: an ack file exists per employee, so a per-file revision read
 * would put N share round trips on every tick of every client.
 *
 * A workspace with no acks folder yet is a real observation (`""`), not a
 * failure; only a read that THREW returns `UNPROBED`.
 */
async function safeAcksSignature(
  notificationsDir: DirectoryHandleLike | null
): Promise<Probed<string>> {
  if (!notificationsDir) return "";
  let acksDir: DirectoryHandleLike;
  try {
    acksDir = await notificationsDir.getDirectoryHandle(NOTIFICATIONS_SUBFOLDERS.acks, {
      create: false,
    });
  } catch (error) {
    // Absent is normal for a legacy or brand-new workspace: nobody has
    // acknowledged anything yet. Anything else is a failed read.
    if (isNotFoundError(error)) return "";
    logError("workspaceSync:probeAcksOpen", error);
    return UNPROBED;
  }
  try {
    return await boundedSizeSignature(acksDir, ACK_FILE_SUFFIX);
  } catch (error) {
    logError("workspaceSync:probeAcks", error);
    return UNPROBED;
  }
}

/**
 * Bounded signature of the per-thread feedback files. Same shape and same
 * reasoning as `safeAcksSignature` above — and the same reason `safeRevision`
 * (one envelope read per file) is not reused: a file exists per conversation.
 */
async function safeFeedbackSignature(
  feedbackDir: DirectoryHandleLike | null
): Promise<Probed<string>> {
  if (!feedbackDir) return "";
  let threadsDir: DirectoryHandleLike;
  try {
    threadsDir = await feedbackDir.getDirectoryHandle(FEEDBACK_SUBFOLDERS.threads, {
      create: false,
    });
  } catch (error) {
    // Absent is normal for a brand-new or not-yet-migrated workspace.
    if (isNotFoundError(error)) return "";
    logError("workspaceSync:probeFeedbackOpen", error);
    return UNPROBED;
  }
  try {
    return await boundedSizeSignature(threadsDir, FEEDBACK_THREAD_FILE_SUFFIX);
  } catch (error) {
    logError("workspaceSync:probeFeedback", error);
    return UNPROBED;
  }
}

/**
 * One run's worth of probing (§4.2's per-family change set).
 *
 * A folder or file that is NOT THERE (a fresh workspace, a month with no
 * samples yet) is a real observation: it probes as a neutral value, diffs
 * normally, and never blocks the other families' probes. A read that FAILED is
 * not — it yields UNPROBED, which carries the previous baseline forward instead
 * of replacing it, so a blip cannot manufacture a change on the next healthy
 * tick (see `carryUnprobed`/`movedFrom`).
 *
 * The one case that is NOT contained here is a failure on a directory OPEN:
 * `openOrNull` rethrows anything that is not a genuine NotFound, which aborts
 * the whole run with `ok: false` and leaves the entire baseline intact. That is
 * deliberate — every family hanging off an unopenable directory would otherwise
 * probe as "empty" together, and one neutral-looking baseline for all of them is
 * worse than one visibly failed tick.
 */
async function probeMonth(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  systemDir: DirectoryHandleLike | null
): Promise<Probe> {
  const dirs = await resolveProbeDirs(directoryHandle, monthFolderName, systemDir);
  const [
    distStamp,
    notificationsRevision,
    acksSignature,
    answersSignature,
    requestsFilesSignature,
    approvalsSignature,
    manifestRevision,
    segmentsSignature,
    answersEventsSignature,
    feedbackSignature,
  ] =
    await Promise.all([
      readDistributionLogStamp(directoryHandle, monthFolderName, {
        currentDir: dirs.mainDir,
        legacyDir: dirs.populationMonthDir,
      }).catch((error: unknown): Probed<DistributionStamp> => {
        // Used to fall back to `{ revision: -1 }`, which then became the
        // baseline: the next readable tick reported revision 12 != -1 and
        // broadcast a distribution change nobody had made.
        logError("workspaceSync:probeDistributionStamp", error);
        return UNPROBED;
      }),
      safeRevision(dirs.notificationsDir, NOTIFICATIONS_FILE),
      safeAcksSignature(dirs.notificationsDir),
      safeSignature(dirs.employeesDir, ANSWERS_SUFFIX),
      safeRequestsFilesSignature(dirs.employeesDir),
      safeSignature(dirs.approvalsDir, DECISIONS_SUFFIX),
      safeRevision(dirs.populationMonthDir, MONTH_MANIFEST_FILE),
      safeSegmentsSignature(dirs.eventsDir),
      safeAnswerSegmentsSignature(dirs.answersEventsDir, monthFolderName),
      safeFeedbackSignature(dirs.feedbackDir),
    ]);

  return {
    distributionStamp: distStamp,
    notificationsRevision,
    acksSignature,
    answersSignature,
    requestsFilesSignature,
    approvalsSignature,
    manifestRevision,
    segmentsSignature,
    answersEventsSignature,
    feedbackSignature,
  };
}

function carryUnprobed(previous: Probe, current: Probe): Probe {
  return {
    distributionStamp: carry(previous.distributionStamp, current.distributionStamp),
    notificationsRevision: carry(previous.notificationsRevision, current.notificationsRevision),
    acksSignature: carry(previous.acksSignature, current.acksSignature),
    answersSignature: carry(previous.answersSignature, current.answersSignature),
    requestsFilesSignature: carry(previous.requestsFilesSignature, current.requestsFilesSignature),
    approvalsSignature: carry(previous.approvalsSignature, current.approvalsSignature),
    manifestRevision: carry(previous.manifestRevision, current.manifestRevision),
    segmentsSignature: carry(previous.segmentsSignature, current.segmentsSignature),
    answersEventsSignature: carry(previous.answersEventsSignature, current.answersEventsSignature),
    feedbackSignature: carry(previous.feedbackSignature, current.feedbackSignature),
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
    movedFrom(
      previous.distributionStamp,
      current.distributionStamp,
      (a, b) => a.revision === b.revision && a.writeToken === b.writeToken
    ) ||
    movedFrom(previous.segmentsSignature, current.segmentsSignature, sameValue)
  ) {
    changed.add("distribution");
  }
  if (
    movedFrom(previous.notificationsRevision, current.notificationsRevision, sameValue) ||
    // The shared notifications.json revision covers broadcasts only; a
    // per-employee ack file moves nothing it can see. Second, independent
    // signal for the same family. `movedFrom` keeps an unprobed tick on either
    // side from counting as a change.
    movedFrom(previous.acksSignature, current.acksSignature, sameValue)
  ) {
    changed.add("notifications");
  }
  if (movedFrom(previous.answersSignature, current.answersSignature, sameValue)) {
    // The legacy per-employee `.answers.json` listing stays ambiguous by
    // construction (a pre-migration item file OR a queue written into it), so
    // it marks both, as it always did.
    changed.add("requests");
    changed.add("answers");
  }
  if (movedFrom(previous.requestsFilesSignature, current.requestsFilesSignature, sameValue)) {
    changed.add("requests");
  }
  if (
    // §6 of the answer-save proposal: the item-answer event log's own
    // freshness signal. Event segments hold answers only (requests live in
    // `.requests.json` / the approvals log, probed above), so this marks
    // "answers" alone: a colleague saving their own answer no longer looks
    // like a request change to every subscriber of "requests".
    movedFrom(previous.answersEventsSignature, current.answersEventsSignature, sameValue)
  ) {
    changed.add("answers");
  }
  if (movedFrom(previous.approvalsSignature, current.approvalsSignature, sameValue)) {
    changed.add("requests");
  }
  if (movedFrom(previous.manifestRevision, current.manifestRevision, sameValue)) {
    changed.add("manifest");
  }
  if (movedFrom(previous.feedbackSignature, current.feedbackSignature, sameValue)) {
    changed.add("feedback");
  }
  return changed;
}

type ParsedSizeSignature = { names: Set<string>; sizes: Map<string, number> };

/** Inverse of `boundedSizeSignature`'s `JSON.stringify([names, sized])`; null when it is not that shape. */
function parseSizeSignature(signature: string): ParsedSizeSignature | null {
  if (signature === "") return { names: new Set(), sizes: new Map() };
  try {
    const parsed: unknown = JSON.parse(signature);
    if (!Array.isArray(parsed) || parsed.length !== 2) return null;
    const [names, sized] = parsed as [unknown, unknown];
    if (!Array.isArray(names) || !Array.isArray(sized)) return null;
    const sizes = new Map<string, number>();
    for (const entry of sized) {
      if (!Array.isArray(entry) || typeof entry[0] !== "string" || typeof entry[1] !== "number") return null;
      sizes.set(entry[0], entry[1]);
    }
    return { names: new Set(names.filter((n): n is string => typeof n === "string")), sizes };
  } catch {
    return null;
  }
}

/**
 * The answer-segment names whose signature entry moved between two ticks: a
 * probed size that changed (a segment that grew), a name that appeared or
 * vanished, or a name that was listed-but-unprobed before and is probed now
 * (no baseline to compare against, so treated as possibly moved). Only these can
 * have grown since the reader confirmed them sealed — every other confirmation
 * is still good. `null` when either signature cannot be parsed or the set is
 * implausibly large: the caller falls back to forgetting every confirmation.
 */
export function movedAnswerSegmentNames(previous: string, current: string): Set<string> | null {
  const before = parseSizeSignature(previous);
  const after = parseSizeSignature(current);
  if (!before || !after) return null;
  const moved = new Set<string>();
  for (const [name, size] of after.sizes) {
    // Quiet only when it was probed before at the SAME size. A changed size, a
    // name with no previous size (brand new, or unprobed before) all count as
    // moved: cheap, and such a name may already have been read by this tab.
    if (before.sizes.get(name) !== size) moved.add(name);
  }
  for (const name of after.names) if (!before.names.has(name)) moved.add(name);
  for (const name of before.names) if (!after.names.has(name)) moved.add(name);
  return moved.size > 500 ? null : moved;
}

/** Bounds on the owners peek: a tick never reads more than this to classify a colleague's change. */
const OWNER_PEEK_MAX_SEGMENTS = 48;
const OWNER_PEEK_MAX_BYTES = 256 * 1024;

/**
 * Whose answers did the moved segments gain? Reads ONLY the bytes appended since
 * the previous tick (`slice(previousSize)`) of at most `OWNER_PEEK_MAX_SEGMENTS`
 * segments and collects the lower-cased `answeredBy` of every new event. Returns
 * null ("unknown -- assume it is yours") for anything it cannot prove: too many
 * or too large a change, a segment that shrank, an unreadable segment, a line
 * that does not parse. Never throws.
 */
async function peekAnswerOwners(
  prevSizes: Map<string, number>
): Promise<Set<string> | null> {
  if (prevSizes.size === 0 || prevSizes.size > OWNER_PEEK_MAX_SEGMENTS) return null;
  try {
    const owners = new Set<string>();
    let budget = OWNER_PEEK_MAX_BYTES;
    const results = await Promise.all(
      [...prevSizes].map(async ([name, previousSize]) => {
        // The File the probe's own stat already obtained: one read, no new open.
        // A moved name the probe did not stat (outside its budget) is unknown.
        const file = probedAnswerFiles.get(name);
        if (!file) return null;
        if (file.size < previousSize) return null;
        if (file.size === previousSize) return [] as string[];
        budget -= file.size - previousSize;
        if (budget < 0) return null;
        const text = await file.slice(previousSize).text();
        const out: string[] = [];
        for (const line of text.split("\n")) {
          if (line.trim() === "") continue;
          const event = JSON.parse(line) as { answeredBy?: unknown };
          if (typeof event.answeredBy !== "string") return null;
          out.push(event.answeredBy.trim().toLowerCase());
        }
        return out;
      })
    );
    for (const result of results) {
      if (result === null) return null;
      for (const owner of result) owners.add(owner);
    }
    return owners;
  } catch (error) {
    logError("workspaceSync:peekAnswerOwners", error);
    return null;
  }
}

async function probeChangedFamilies(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  systemDir: DirectoryHandleLike | null
): Promise<{
  changed: Set<DataRefreshFamily>;
  sealedInvalidation: "none" | "all" | ReadonlySet<string>;
  /** segment name -> its size at the previous tick (0 when new), for the owners peek; null = unknown. */
  movedSegmentPrevSizes: Map<string, number> | null;
  /** The legacy `.answers.json` listing moved too: whose answers is then unknowable from segments. */
  legacyAnswersMoved: boolean;
}> {
  const key = probeKey(directoryHandle, monthFolderName);
  const previous = previousProbes.get(key);
  // First look at this (workspace, month) this session: the diff below has
  // nothing to compare against and stays silent, but a month-lock verdict
  // cached BEFORE this baseline may predate a close made by another machine.
  if (!previous) invalidateMonthLockCache(monthFolderName);
  const probed = await probeMonth(directoryHandle, monthFolderName, systemDir);
  // Carry BEFORE storing: a family this tick could not read keeps the last value
  // that was actually observed, so the next readable tick diffs against real
  // state instead of against a placeholder.
  const current = previous ? carryUnprobed(previous, probed) : probed;
  const changed = diffFamilies(previous, current);
  previousProbes.set(key, current);
  // Which sealed-segment confirmations the reader must forget. Only a moved
  // `answers.events` signature can have grown a segment (the legacy answers dir
  // and the requests families never touch a segment); and only the names that
  // moved can have grown, so a colleague's activity elsewhere keeps the rest.
  let sealedInvalidation: "none" | "all" | ReadonlySet<string> = "none";
  let movedSegmentPrevSizes: Map<string, number> | null = null;
  if (
    previous &&
    movedFrom(previous.answersEventsSignature, current.answersEventsSignature, sameValue) &&
    isProbed(previous.answersEventsSignature) &&
    isProbed(current.answersEventsSignature)
  ) {
    const moved = movedAnswerSegmentNames(previous.answersEventsSignature, current.answersEventsSignature);
    sealedInvalidation = moved ?? "all";
    if (moved) {
      const before = parseSizeSignature(previous.answersEventsSignature);
      movedSegmentPrevSizes = new Map([...moved].map((name) => [name, before?.sizes.get(name) ?? 0]));
    }
  }
  const legacyAnswersMoved = !!previous && movedFrom(previous.answersSignature, current.answersSignature, sameValue);
  return { changed, sealedInvalidation, movedSegmentPrevSizes, legacyAnswersMoved };
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
  let sealedInvalidation: "none" | "all" | ReadonlySet<string> = "none";
  let answerOwners: Set<string> | null = null;
  let legacyAnswersMoved = false;
  if (directoryHandle && monthFolderName) {
    try {
      let movedSegmentPrevSizes: Map<string, number> | null;
      ({ changed, sealedInvalidation, movedSegmentPrevSizes, legacyAnswersMoved } = await probeChangedFamilies(directoryHandle, monthFolderName, systemDir));
      if (changed.has("answers") && movedSegmentPrevSizes) {
        answerOwners = await peekAnswerOwners(movedSegmentPrevSizes);
      }
    } catch (error) {
      logError("workspaceSync:probe", error);
      ok = false;
    }
  }

  // The month manifest moved (another machine closed/reopened the month, or a
  // status advance): the 5-minute month-lock verdict is no longer trustworthy.
  // A manual refresh drops it unconditionally, like every other cache.
  if (directoryHandle && monthFolderName && (manual || changed.has("manifest"))) {
    invalidateMonthLockCache(monthFolderName);
  }

  // The probe saw answer segments move: a segment this tab believes is sealed
  // may have grown. Forget the confirmation of exactly the names that moved
  // (all of them only when the probe cannot tell which).
  if (sealedInvalidation === "all") invalidateSealedAnswerSegments();
  else if (sealedInvalidation !== "none") invalidateSealedAnswerSegmentNames(sealedInvalidation);

  const broadcast = manual || changed.size > 0;
  if (broadcast) {
    // §4.1's rule: a Query invalidation must be paired with
    // bumpWorkspaceEpoch to actually reach disk on the NEXT read -- this is
    // also what keeps A6c's session-scoped derive memo
    // (distributionStorage.ts) from serving a now-known-stale value past
    // this run. A manual run bumps it unconditionally: "discard everything"
    // that still lets a memo answer from cache is not a hard refresh.
    if (directoryHandle && monthFolderName) {
      const epochBefore = workspaceEpoch(directoryHandle, monthFolderName);
      bumpWorkspaceEpoch(directoryHandle, monthFolderName);
      // A tick that saw answers/distribution/notifications move but NOT `requests`
      // leaves every employee's request queue exactly as this tab last read it.
      if (!manual && !changed.has("requests")) {
        carryRequestQueuesAcrossEpochBump(directoryHandle, monthFolderName, epochBefore);
      }
    }
    if (manual) {
      broadcastDataRefresh("manual");
    } else {
      // A legacy-file answers change (or a peek that could not classify) leaves the
      // owners unknown; consumers then assume the change may be theirs.
      broadcastDataRefresh({
        source: "periodic",
        changed,
        answerOwners: changed.has("answers") && !legacyAnswersMoved ? answerOwners : null,
      });
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
