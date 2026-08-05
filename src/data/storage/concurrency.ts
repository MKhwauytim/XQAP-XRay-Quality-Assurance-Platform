/**
 * Bounded-concurrency map with index-addressed, input-ordered results and
 * fail-fast-then-drain error handling: on the first rejection, no new work
 * starts, but everything already in flight is awaited before the first
 * error is thrown. Never `Promise.all(items.map(fn))` unbounded -- that
 * pattern is what this exists to replace at call sites that need a budget.
 *
 * Modeled on the worker-pool shape already proven in this codebase
 * (directoryScan.ts's readNamedJsonFiles, distributionStorage.ts's
 * writeImmutableEventBatch): a shared nextIndex counter, `limit` concurrent
 * "worker" loops each pulling the next index and writing into a pre-sized
 * results array.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  const workerCount = Math.max(1, Math.min(limit, items.length || 1));
  let nextIndex = 0;
  let firstError: unknown;
  let hasError = false;
  let stopped = false;

  async function worker(): Promise<void> {
    while (true) {
      if (stopped) return;
      const index = nextIndex++;
      if (index >= items.length) return;
      try {
        results[index] = await fn(items[index] as T, index);
      } catch (error) {
        if (!hasError) {
          hasError = true;
          firstError = error;
        }
        stopped = true;
        return;
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  if (hasError) throw firstError;
  return results;
}
