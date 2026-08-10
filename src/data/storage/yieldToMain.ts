/**
 * Yields the main thread back to the browser for one tick, so a long chunked
 * loop (population processing, exports, ...) doesn't block input/rendering.
 *
 * Prefers `scheduler.postTask()` (Chrome 115+) over `setTimeout(resolve, 0)`
 * when available: this app is Chromium-only (File System Access API, see
 * CLAUDE.md), and `postTask` yields at `"user-visible"` priority through the
 * browser's actual task scheduler rather than a timer-queue macrotask, which
 * `navigator.scheduling.isInputPending()`-aware browsers can service sooner
 * than a `setTimeout` callback under load.
 *
 * Falls back to `setTimeout(resolve, 0)` when `scheduler.postTask` doesn't
 * exist -- non-Chromium browsers, and every test under Node/jsdom, neither of
 * which implements the Prioritized Task Scheduling API. This also keeps
 * `yieldToMain.test.ts` and the report/deck builder tests
 * (distributionReport.test.ts, sampleReport.test.ts, which fake only `Date`
 * via `vi.useFakeTimers({ toFake: ["Date"] })`, leaving `setTimeout` real on
 * purpose) working unchanged: `scheduler` is simply undefined there, so the
 * fallback path is the only one those environments ever take.
 */
type SchedulerLike = { postTask(callback: () => void, options?: { priority?: string }): Promise<void> };

function getScheduler(): SchedulerLike | null {
  const candidate = (globalThis as { scheduler?: SchedulerLike }).scheduler;
  return typeof candidate?.postTask === "function" ? candidate : null;
}

export function yieldToMain(): Promise<void> {
  const scheduler = getScheduler();
  if (scheduler) {
    return scheduler.postTask(() => {}, { priority: "user-visible" });
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
}
