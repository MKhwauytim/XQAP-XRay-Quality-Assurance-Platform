/**
 * Headless, mounted once under the workspace (AuthGate, beside
 * WorkspaceErrorSink): replays this user's pending answers at sign-in and
 * every 30 s while the tab is visible, on every page — not only while
 * «نتائج فحص الأشعة» is open, and not only for the currently selected month
 * (a pending record's own `month` field, a real month or an `adhoc-*`
 * folder, is what `replayPendingAnswers` walks — see its module doc). Also
 * prunes expired answer drafts once at start.
 *
 * F14: `replayPendingAnswers` itself carries the single, module-level
 * in-flight guard (keyed by username) — not this component — so it protects
 * every caller alike, including a second `PendingAnswerReplayRunner`
 * instance briefly mounted during a remount.
 */
import { useEffect } from "react";

import { useWorkspace } from "../workspace/useWorkspace";
import { logError } from "../storage/errorLogger";
import { pruneAnswerDrafts } from "./answerDraftStore";
import { replayPendingAnswers } from "./pendingAnswerReplay";

export const PENDING_REPLAY_INTERVAL_MS = 30_000;

export function PendingAnswerReplayRunner({
  username,
  enabled = true,
}: {
  /** The REAL signed-in username — never a previewed role's identity. */
  username: string;
  enabled?: boolean;
}): null {
  const { directoryHandle, status } = useWorkspace();

  useEffect(() => {
    pruneAnswerDrafts();
  }, []);

  useEffect(() => {
    if (!enabled || status !== "ready" || !directoryHandle) return;
    let disposed = false;
    const tick = (): void => {
      if (disposed) return;
      if (typeof document !== "undefined" && document.hidden) return;
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
  }, [enabled, status, directoryHandle, username]);

  return null;
}
