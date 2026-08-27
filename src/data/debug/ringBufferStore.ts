/**
 * Generic bounded ring buffer with a plain pub/sub subscription, same shape as
 * `dataRefreshSignal.ts` / `bootProgress.ts` — no external state library.
 *
 * Used by the demo debug tools (`syncMetrics.ts`, `responsivenessMonitor.ts`)
 * to keep the last N samples of something (a sync run, a frame delta, a click
 * latency) without unbounded memory growth over a long demo session.
 */

export type RingBufferStore<T> = {
  push: (item: T) => void;
  getAll: () => T[];
  subscribe: (fn: () => void) => () => void;
  clear: () => void;
};

export function createRingBufferStore<T>(maxEntries: number): RingBufferStore<T> {
  const entries: T[] = [];
  const subscribers = new Set<() => void>();
  // Cached, not recomputed per read: useSyncExternalStore's getSnapshot must
  // return a referentially-stable value between notifications (see
  // bootProgress.ts's cachedEntries for the same reasoning), or React re-renders
  // forever.
  let cached: T[] = [];

  function refreshCache(): void {
    cached = entries.slice();
  }
  refreshCache();

  function notify(): void {
    refreshCache();
    subscribers.forEach((fn) => fn());
  }

  return {
    push(item: T) {
      entries.push(item);
      if (entries.length > maxEntries) entries.splice(0, entries.length - maxEntries);
      notify();
    },
    getAll() {
      return cached;
    },
    subscribe(fn: () => void) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    clear() {
      entries.length = 0;
      notify();
    },
  };
}
