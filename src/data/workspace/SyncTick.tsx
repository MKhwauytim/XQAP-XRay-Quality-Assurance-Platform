/**
 * The AUTOMATIC trigger of the app's one sync path (`workspaceSync.ts`).
 *
 * This headless component owns nothing but the timer: every ~45s by default —
 * the admin can change the cadence workspace-wide, see `syncSettings.ts` — (and
 * once on a hidden->visible transition, coalesced) it calls `runSync()`, which
 * re-syncs users/roles/permissions from disk AND probes the currently selected
 * month for per-family data changes, broadcasting only what actually changed.
 * The AdminToolbar refresh button calls the SAME `runSync()` with
 * `manual: true` -- there is no second code path, no second timer, and no
 * second in-flight guard (that one lives in `workspaceSync.ts`, shared by both
 * triggers).
 *
 * F17 (why this is its own component, not folded into AuthGate): the tick
 * needs `useGlobalMonth()` to know which month to probe, but AuthGate is the
 * PARENT of `GlobalMonthProvider` (AuthGate.tsx renders
 * `<GlobalMonthProvider><AdminToolbar/>{children}</GlobalMonthProvider>`) and
 * therefore cannot call that hook itself. This component is rendered INSIDE
 * `GlobalMonthProvider` instead, alongside `<AdminToolbar>`. AuthGate's own
 * former permissions-only interval has been folded into this one (owner
 * mandate, 2026-08-13) -- which is why the timer is installed as soon as the
 * workspace is ready, month or no month: permission propagation (an admin
 * revoking access) must not depend on a month being selected, so with no
 * month the run simply skips the data probe and re-syncs permissions only.
 *
 * Do NOT read the `xray_global_month_v1` sessionStorage key directly here --
 * that would create a second month-selection authority that diverges from
 * `useGlobalMonth()` after a month switch. Always go through the hook.
 */
import { useEffect, useState } from "react";

import { useGlobalMonth } from "../month/useGlobalMonth";
import { useWorkspace } from "./useWorkspace";
import {
  FOCUS_COALESCE_WINDOW_MS,
  getLastSyncStartedAt,
  getSyncIntervalMs,
  refreshSyncIntervalFromDisk,
  runSync,
  subscribeToSyncInterval,
} from "./workspaceSync";

type SyncTickProps = {
  /** false for the read-only demo/viewer session, which has no disk workspace
   *  worth polling and no permissions to re-sync. */
  enabled?: boolean;
};

export function SyncTick({ enabled = true }: SyncTickProps): null {
  const { directoryHandle, status, refreshPermissions } = useWorkspace();
  const { selection } = useGlobalMonth();

  const monthFolderName = selection.kind === "existing" ? selection.folderName : null;

  // The admin-configurable cadence (`syncSettings.ts`). Seeded from whatever
  // the sync module already knows, then kept current by the subscription below
  // — which is fed by the sync run itself, so there is no second timer.
  const [intervalMs, setIntervalMs] = useState(getSyncIntervalMs);

  // Subscription + a single on-mount read, kept in their OWN effect so that a
  // cadence change re-arms only the timer effect below and does not tear down
  // and reinstall the subscription (which would re-read disk on every change).
  useEffect(() => {
    if (!enabled) return;
    if (status !== "ready" || !directoryHandle) return;

    const unsubscribe = subscribeToSyncInterval(setIntervalMs);
    // One-shot, not a poll: without it a client that loads while the workspace
    // stores a 5-minute cadence would still spend its first tick at the 45s
    // default. Recurring updates arrive via the subscription.
    void refreshSyncIntervalFromDisk(directoryHandle);
    return unsubscribe;
  }, [enabled, status, directoryHandle]);

  useEffect(() => {
    if (!enabled) return;
    if (status !== "ready" || !directoryHandle) return;

    const tick = () => {
      // A backgrounded/minimized tab has nothing on screen that benefits from
      // this run -- skip the disk reads entirely rather than paying their cost
      // for no visible effect. The interval itself keeps running on its normal
      // cadence; a later tick does the real work once the tab is visible
      // again. This skip is AUTOMATIC-only by design: a manual button press
      // goes straight to runSync() and always runs.
      if (document.hidden) return;
      // Concurrency is handled inside runSync() by the guard shared with the
      // manual trigger -- an automatic run that lands mid-run is dropped.
      void runSync({ directoryHandle, monthFolderName, refreshPermissions });
    };

    // `intervalMs` is a dependency, so an admin's cadence change (delivered by
    // the subscription above, off the sync run) clears the in-flight timer and
    // reinstalls it at the new value immediately — the old cadence does not
    // have to elapse one more time first.
    const intervalId = window.setInterval(tick, intervalMs);

    // Fire one gated run on hidden->visible, coalesced against the last run of
    // EITHER trigger so tab-switch-thrashing cannot issue more than one probe
    // per ~10s -- staleness on return drops from up-to-one-interval to one
    // probe depth.
    const handleVisibilityChange = () => {
      if (document.hidden) return;
      if (Date.now() - getLastSyncStartedAt() < FOCUS_COALESCE_WINDOW_MS) return;
      tick();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [enabled, status, directoryHandle, monthFolderName, refreshPermissions, intervalMs]);

  return null;
}
