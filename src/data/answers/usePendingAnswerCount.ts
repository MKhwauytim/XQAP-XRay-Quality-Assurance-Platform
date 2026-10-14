import { useEffect, useState } from "react";

import { subscribeToDataRefresh } from "../workspace/dataRefreshSignal";
import { countPendingAnswers, countUnsentAnswers } from "./answerLocalMirror";

const POLL_MS = 10_000;

/**
 * How many of `username`'s answers are still unsent on this device. With
 * `month` it counts that month only (the banner); without it, every month and
 * ad-hoc folder (the unload guard). Local IndexedDB only — never reads the
 * share. Refreshes on mount, on every data-refresh broadcast, and every 10 s.
 */
export function usePendingAnswerCount(opts: { username: string; month?: string }): number {
  const { username, month } = opts;
  const [count, setCount] = useState(0);

  useEffect(() => {
    let disposed = false;
    const refresh = (): void => {
      const pending = month === undefined ? countUnsentAnswers(username) : countPendingAnswers(month, username);
      void pending
        .then((n) => { if (!disposed) setCount(n); })
        .catch(() => { /* absence is never meaningful here; keep the last count */ });
    };
    refresh();
    const unsubscribe = subscribeToDataRefresh(refresh);
    const interval = window.setInterval(refresh, POLL_MS);
    return () => {
      disposed = true;
      unsubscribe();
      window.clearInterval(interval);
    };
  }, [username, month]);

  return count;
}
