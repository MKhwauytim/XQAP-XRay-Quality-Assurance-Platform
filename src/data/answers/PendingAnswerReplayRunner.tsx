/**
 * Headless, mounted once under the workspace (AuthGate, beside
 * WorkspaceErrorSink): replays this user's pending answers at sign-in and
 * every 30 s while the tab is visible, on every page — not only while
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
 * independent gates, both re-checked every tick (permissions/read-only mode
 * can change mid-session, e.g. an admin revokes a feature or read-only mode
 * is toggled):
 *  - `isReadOnlyMode()` directly. `canMutate` already folds this in (see
 *    `mutationCapability.ts`), so this is a second, explicit gate kept for
 *    defense in depth: a background poller should fail CLOSED even if a
 *    future change ever decoupled the permission matrix's mutation check
 *    from the global read-only flag.
 *  - `canMutate("submit-answers")` — the SAME feature id the answer-save UI
 *    itself gates on (`XrayReferrals.tsx`'s `canSubmitAnswers`), so replay
 *    never writes an answer the signed-in role/permission state would not
 *    have been allowed to save in the first place.
 */
import { useEffect } from "react";

import { useWorkspace } from "../workspace/useWorkspace";
import { usePermissions } from "../../auth/usePermissions";
import { isReadOnlyMode } from "../storage/readOnlyMode";
import { logError } from "../storage/errorLogger";
import { pruneAnswerDrafts } from "./answerDraftStore";
import { replayPendingAnswers } from "./pendingAnswerReplay";

export const PENDING_REPLAY_INTERVAL_MS = 30_000;

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

  useEffect(() => {
    pruneAnswerDrafts();
  }, []);

  useEffect(() => {
    if (!enabled || status !== "ready" || !directoryHandle) return;
    if (isReadOnlyMode() || !canMutate(SUBMIT_ANSWERS_FEATURE_ID)) return;
    let disposed = false;
    const tick = (): void => {
      if (disposed) return;
      if (typeof document !== "undefined" && document.hidden) return;
      // Re-checked on every tick, not just at effect-setup time: a role/
      // permission change or a read-only toggle mid-session must take
      // effect on the very next tick, not only after directoryHandle/status
      // happen to change and re-run this effect.
      if (isReadOnlyMode() || !canMutate(SUBMIT_ANSWERS_FEATURE_ID)) return;
      void replayPendingAnswers(directoryHandle, username).catch((error: unknown) => {
        logError("answers:pending-replay", error);
      });
    };
    tick();
    const interval = window.setInterval(tick, PENDING_REPLAY_INTERVAL_MS);
    return () => {
      disposed = true;
      window.clearInterval(interval);
    };
  }, [enabled, status, directoryHandle, username, canMutate]);

  return null;
}
