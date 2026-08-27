/**
 * On/off flag for the demo's debug tools panel (AdminToolbar's demo-only
 * toggle → DemoDebugPanel). Plain module-level pub/sub, same shape as
 * `dataRefreshSignal.ts` — no external state library, no persistence: it
 * resets on reload like every other in-memory piece of the demo.
 *
 * Deliberately just the flag. Starting/stopping the responsiveness sampler
 * (`responsivenessMonitor.ts`) lives in `DemoDebugPanel`'s own mount/unmount
 * effect, not here — keeping this module free of side effects avoids an
 * import cycle and means the flag can be read/set from anywhere (e.g. a
 * future test) without pulling in rAF/DOM listener setup.
 */
import { useSyncExternalStore } from "react";

let enabled = false;
const subscribers = new Set<() => void>();

export function isDemoDebugEnabled(): boolean {
  return enabled;
}

export function setDemoDebugEnabled(next: boolean): void {
  if (enabled === next) return;
  enabled = next;
  subscribers.forEach((fn) => fn());
}

export function subscribeDemoDebugEnabled(fn: () => void): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

export function useDemoDebugEnabled(): boolean {
  return useSyncExternalStore(subscribeDemoDebugEnabled, isDemoDebugEnabled);
}

/** @internal test-only. Module state outlives a test file's `beforeEach`. */
export function __resetDemoDebugStoreForTests(): void {
  enabled = false;
  subscribers.clear();
}
