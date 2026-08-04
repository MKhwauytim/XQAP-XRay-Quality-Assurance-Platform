/**
 * Yields the main thread back to the browser for one macrotask tick.
 * Deliberately `setTimeout(resolve, 0)`, not `scheduler.yield()` or a
 * microtask-based alternative -- several report/deck builder tests
 * (distributionReport.test.ts, sampleReport.test.ts) fake only `Date` via
 * `vi.useFakeTimers({ toFake: ["Date"] })`, leaving `setTimeout` real on
 * purpose; faking it too would hang those tests' awaits forever.
 */
export function yieldToMain(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
