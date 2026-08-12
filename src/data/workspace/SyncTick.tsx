/* eslint-disable react-refresh/only-export-components -- this file
   deliberately exports the headless SyncTick component alongside
   runSyncTick/__resetSyncTickStateForTests/SYNC_TICK_INTERVAL_MS so tests can
   exercise the probe logic and shared timing constant directly, mirroring the
   tab index.tsx precedent for this same disable elsewhere in the repo. */
/**
 * Change-set-driven sync tick (perf/sync spec §4.2, §7.1 A7 commits 1-3).
 *
 * Replaces the old "reload everything every 3 minutes" behaviour with a
 * cheap per-family change probe against the CURRENTLY SELECTED month only.
 * When nothing changed, nothing is broadcast at all -- zero invalidation,
 * zero setState, zero re-render anywhere in the app (§4.2's "unchanged ⇒
 * zero" invariant).
 *
 * F17 (why this is its own component, not folded into AuthGate): the tick
 * needs `useGlobalMonth()` to know which month to probe, but AuthGate is the
 * PARENT of `GlobalMonthProvider` (AuthGate.tsx renders
 * `<GlobalMonthProvider><AdminToolbar/>{children}</GlobalMonthProvider>`) and
 * therefore cannot call that hook itself. This headless component is
 * rendered INSIDE `GlobalMonthProvider` instead, alongside `<AdminToolbar>`.
 * `refreshPermissions()` stays behind in AuthGate's own body, on its own
 * ungated interval -- permissions must propagate even on a tick whose data
 * change set is empty (an admin revoking access is not a "data" family).
 *
 * Do NOT read the `xray_global_month_v1` sessionStorage key directly here --
 * that would create a second month-selection authority that diverges from
 * `useGlobalMonth()` after a month switch. Always go through the hook.
 */
import { useEffect, useRef } from "react";

import { useGlobalMonth } from "../month/useGlobalMonth";
import { useWorkspace } from "./useWorkspace";
import { broadcastDataRefresh, type DataRefreshFamily } from "./dataRefreshSignal";
import { bumpWorkspaceEpoch, workspaceScopeId } from "../storage/inFlightReads";
import { readDistributionLogStamp } from "../distribution/distributionStorage";
import { listDirectoryEntriesWithSize } from "../storage/directoryScan";
import { readEnvelopeRevision } from "../storage/safeWrite";
import { logError } from "../storage/errorLogger";
import {
  getPopulationMonthDir,
  getSampleApprovalsDir,
  getSampleEmployeeDir,
  getSystemRoot,
  SYSTEM_FOLDER_NAMES,
} from "./workspacePaths";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";

/** §2's owner-mandated cadence: 30-60s. Also used by SyncTick's own
 *  visibilitychange coalescing window. */
export const SYNC_TICK_INTERVAL_MS = 45_000;

/** Focus-thrashing guard (commit 3): never issue more than one probe within
 *  this window of the last one, whether triggered by the interval or by a
 *  hidden->visible transition. */
const FOCUS_COALESCE_WINDOW_MS = 10_000;

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
   *  per-employee/per-supervisor JSON files (F21/F22). See
   *  computeRequestsAnswersSignature's own comment for how that ambiguity
   *  is resolved into the "requests" vs "answers" family split below. */
  answersSignature: string;
  approvalsSignature: string;
  manifestRevision: number | null;
};

const previousProbes = new Map<string, Probe>();

/** Test-only: forget every remembered probe baseline between test cases. */
export function __resetSyncTickStateForTests(): void {
  previousProbes.clear();
}

function probeKey(directoryHandle: DirectoryHandleLike, monthFolderName: string): string {
  return `${workspaceScopeId(directoryHandle)}|${monthFolderName}`;
}

async function safeManifestRevision(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<number | null> {
  try {
    const monthDir = await getPopulationMonthDir(directoryHandle, monthFolderName, false);
    return await readEnvelopeRevision(monthDir, MONTH_MANIFEST_FILE);
  } catch {
    return null;
  }
}

async function safeNotificationsRevision(directoryHandle: DirectoryHandleLike): Promise<number | null> {
  try {
    const systemDir = await getSystemRoot(directoryHandle, false);
    const notificationsDir = await systemDir.getDirectoryHandle(SYSTEM_FOLDER_NAMES.notifications, { create: false });
    return await readEnvelopeRevision(notificationsDir, NOTIFICATIONS_FILE);
  } catch {
    return null;
  }
}

function signature(entries: { name: string; size: number }[]): string {
  return JSON.stringify(entries.map((entry) => [entry.name, entry.size]));
}

async function safeAnswersSignature(directoryHandle: DirectoryHandleLike, monthFolderName: string): Promise<string> {
  try {
    const dir = await getSampleEmployeeDir(directoryHandle, monthFolderName, false);
    return signature(await listDirectoryEntriesWithSize(dir, ANSWERS_SUFFIX));
  } catch {
    return "";
  }
}

async function safeApprovalsSignature(directoryHandle: DirectoryHandleLike, monthFolderName: string): Promise<string> {
  try {
    const dir = await getSampleApprovalsDir(directoryHandle, monthFolderName, false);
    return signature(await listDirectoryEntriesWithSize(dir, DECISIONS_SUFFIX));
  } catch {
    return "";
  }
}

/**
 * One tick's worth of probing (§4.2's per-family change set). Every probe
 * degrades to a neutral "unreadable" value on failure (missing folder on a
 * fresh workspace, permission hiccup, ...) rather than throwing -- a probe
 * failure must never crash the tick or block the OTHER families' probes.
 */
async function probeMonth(directoryHandle: DirectoryHandleLike, monthFolderName: string): Promise<Probe> {
  const [distStamp, notificationsRevision, answersSignature, approvalsSignature, manifestRevision] =
    await Promise.all([
      readDistributionLogStamp(directoryHandle, monthFolderName).catch(() => ({
        revision: -1,
        writeToken: undefined,
      })),
      safeNotificationsRevision(directoryHandle),
      safeAnswersSignature(directoryHandle, monthFolderName),
      safeApprovalsSignature(directoryHandle, monthFolderName),
      safeManifestRevision(directoryHandle, monthFolderName),
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

/** Exported for the round-trip-budget test and for SyncTick itself. */
export async function runSyncTick(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<Set<DataRefreshFamily>> {
  const key = probeKey(directoryHandle, monthFolderName);
  const current = await probeMonth(directoryHandle, monthFolderName);
  const changed = diffFamilies(previousProbes.get(key), current);
  previousProbes.set(key, current);

  if (changed.size > 0) {
    // §4.1's rule: a Query invalidation must be paired with
    // bumpWorkspaceEpoch to actually reach disk on the NEXT read -- this is
    // also what keeps A6c's session-scoped derive memo
    // (distributionStorage.ts) from serving a now-known-stale value past
    // this tick.
    bumpWorkspaceEpoch(directoryHandle, monthFolderName);
    broadcastDataRefresh({ source: "periodic", changed });
  }
  return changed;
}

export function SyncTick(): null {
  const { directoryHandle } = useWorkspace();
  const { selection } = useGlobalMonth();
  const inFlightRef = useRef(false);
  const lastCheckedAtRef = useRef(0);

  const monthFolderName = selection.kind === "existing" ? selection.folderName : null;

  useEffect(() => {
    if (!directoryHandle || !monthFolderName) return;

    const tick = async () => {
      // Concurrency guard: a tick becomes a no-op while the previous one is
      // still unresolved -- mandatory once the callback is async, since a
      // ~dozens-of-round-trips probe can outlive its own interval on a slow
      // network share.
      if (inFlightRef.current) return;
      if (document.hidden) return;
      inFlightRef.current = true;
      lastCheckedAtRef.current = Date.now();
      try {
        await runSyncTick(directoryHandle, monthFolderName);
      } catch (error) {
        logError("syncTick:probe", error);
      } finally {
        inFlightRef.current = false;
      }
    };

    const intervalId = window.setInterval(() => { void tick(); }, SYNC_TICK_INTERVAL_MS);

    // Commit 3: fire one gated tick on hidden->visible, coalesced with the
    // interval so tab-switch-thrashing cannot issue more than one probe per
    // ~10s -- this is the single cheapest change toward the "unsynced"
    // complaint: staleness on return drops from up-to-one-interval to one
    // probe depth.
    const handleVisibilityChange = () => {
      if (document.hidden) return;
      if (Date.now() - lastCheckedAtRef.current < FOCUS_COALESCE_WINDOW_MS) return;
      void tick();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [directoryHandle, monthFolderName]);

  return null;
}
