/**
 * Headless, mounted once under the workspace (AuthGate, beside
 * WorkspaceErrorSink): replays this user's pending answers at sign-in and
 * on the app sync interval (`getSyncIntervalMs()`, restarted when an admin
 * changes it) while the tab is visible, and immediately when the browser
 * comes back `online` or the tab becomes visible again, on every page — not only while
 * «نتائج فحص الأشعة» is open, and not only for the currently selected month
 * (a pending record's own `month` field, a real month or an `adhoc-*`
 * folder, is what `replayPendingAnswers` walks — see its module doc). Also
 * prunes expired answer drafts once at start.
 *
 * F14: `replayPendingAnswers` itself carries the shared in-flight guard (an
 * in-tab join plus a cross-tab try-lock — see its own doc) — not this
 * component — so it protects every caller alike, including a second
 * `PendingAnswerReplayRunner` instance briefly mounted during a remount, or
 * another browser tab open on the same workspace.
 *
 * IMPORTANT 4 (fix round 1): this is a background poller that WRITES to the
 * shared workspace on the signed-in user's behalf with no one watching it —
 * it must never run somewhere a foreground save wouldn't be allowed to. Two
 * independent gates:
 *  - `isReadOnlyMode()` directly. `canMutate` already folds this in (see
 *    `mutationCapability.ts`), so this is a second, explicit gate kept for
 *    defense in depth: a background poller should fail CLOSED even if a
 *    future change ever decoupled the permission matrix's mutation check
 *    from the global read-only flag.
 *  - `canMutate("submit-answers")` — the SAME feature id the answer-save UI
 *    itself gates on (`XrayReferrals.tsx`'s `canSubmitAnswers`), so replay
 *    never writes an answer the signed-in role/permission state would not
 *    have been allowed to save in the first place.
 *
 * Fix round 2 (minor): `canMutate` is a brand-new function reference on
 * every render of `usePermissions()` (it is not memoized there), so using it
 * directly as an effect dependency tore the interval down and fired an
 * immediate full tick on literally every unrelated re-render of this
 * component. `canReplay` below derives a plain BOOLEAN at render time and is
 * what the effect actually depends on — React only re-runs the effect when
 * that boolean's VALUE changes (mount, a permission-matrix change via
 * `usePermissions`'s own subscription, or `directoryHandle`/`status`
 * changing), which also means the interval installs itself the moment
 * `canReplay` flips from false to true (e.g. permissions finish loading)
 * rather than needing a special case for "the gate started out false."
 * `isReadOnlyMode()` has no such subscription/re-render mechanism at all, so
 * it is still re-checked directly inside `tick()` on every firing, not
 * only through the (possibly stale-by-then) captured `canReplay` boolean.
 */
import { useEffect } from "react";

import { useWorkspace } from "../workspace/useWorkspace";
import { usePermissions } from "../../auth/usePermissions";
import { isReadOnlyMode } from "../storage/readOnlyMode";
import { logError } from "../storage/errorLogger";
import { pruneAnswerDrafts } from "./answerDraftStore";
import { getSyncIntervalMs, subscribeToSyncInterval } from "../workspace/workspaceSync";
import { replayPendingAnswers } from "./pendingAnswerReplay";
import { usePendingAnswerCount } from "./usePendingAnswerCount";
import { useUnloadGuard } from "../../hooks/useUnloadGuard";

/** The feature id the answer-save UI itself gates on (`XrayReferrals.tsx`). */
const SUBMIT_ANSWERS_FEATURE_ID = "submit-answers";

export function PendingAnswerReplayRunner({
  username,
  enabled = true,
}: {
  /** The REAL signed-in username — never a previewed role's identity. */
  username: string;
  enabled?: boolean;
}): null {
  const { directoryHandle, status } = useWorkspace();
  const { canMutate } = usePermissions();
  const canReplay = !isReadOnlyMode() && canMutate(SUBMIT_ANSWERS_FEATURE_ID);

  // Closing/reloading the tab with answers still unsent would lose nothing
  // (they live in IndexedDB) but would delay landing; ask the browser to confirm.
  const unsent = usePendingAnswerCount({ username });
  useUnloadGuard(unsent > 0);

  useEffect(() => {
    pruneAnswerDrafts();
  }, []);

  useEffect(() => {
    if (!enabled || status !== "ready" || !directoryHandle || !canReplay) return;
    let disposed = false;
    // `force` is set by the `online` / became-visible triggers, which are
    // themselves the "user is looking / network is back" signal, so they must
    // not be swallowed by the hidden-tab early return meant for the timer.
    const tick = (force = false): void => {
      if (disposed) return;
      if (!force && typeof document !== "undefined" && document.hidden) return;
      // isReadOnlyMode() is a bare module flag with no React subscription --
      // unlike a permission-matrix change (which re-renders this component
      // via usePermissions' own subscription and so refreshes `canReplay`),
      // toggling it mid-interval would otherwise not be seen until whatever
      // NEXT happens to re-render this component. Re-check it directly here.
      if (isReadOnlyMode()) return;
      void replayPendingAnswers(directoryHandle, username).catch((error: unknown) => {
        logError("answers:pending-replay", error);
      });
    };
    const onOnline = (): void => tick(true);
    const onVisibility = (): void => {
      if (document.visibilityState === "visible") tick(true);
    };
    let interval = window.setInterval(() => tick(), getSyncIntervalMs());
    const stopWatchingInterval = subscribeToSyncInterval((intervalMs) => {
      window.clearInterval(interval);
      interval = window.setInterval(() => tick(), intervalMs);
    });
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisibility);
    tick();
    return () => {
      disposed = true;
      window.clearInterval(interval);
      stopWatchingInterval();
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, status, directoryHandle, username, canReplay]);

  return null;
}
