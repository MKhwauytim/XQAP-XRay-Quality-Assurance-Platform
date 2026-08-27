/**
 * Bounded history of the demo debug panel's own sync observations.
 *
 * Deliberately observes only the MANUAL trigger (AdminToolbar's refresh
 * button), which this feature already wraps with timing at its one call site.
 * It does NOT hook into `workspaceSync.ts`'s automatic timer/internals —
 * that module is explicitly documented as "the one sync path" with exactly
 * two triggers and one in-flight guard, and `SyncTick.tsx` is flagged as
 * effect-timing-sensitive history of regressions. Recording a sample here is
 * a pure read of a result already returned to an existing caller, never a
 * new trigger, so it stays outside both files. The panel additionally shows
 * `getSyncIntervalMs()`/`getLastSyncStartedAt()` (already exported by
 * `workspaceSync.ts`) to give the automatic timer some visibility too.
 */
import { createRingBufferStore } from "./ringBufferStore";

export type SyncSample = {
  /** Epoch ms when this run was recorded. */
  at: number;
  ok: boolean;
  ran: boolean;
  broadcast: boolean;
  changedCount: number;
  durationMs: number;
};

const MAX_SYNC_SAMPLES = 20;

const store = createRingBufferStore<SyncSample>(MAX_SYNC_SAMPLES);

export function recordSyncSample(sample: SyncSample): void {
  store.push(sample);
}

export function getSyncSamples(): SyncSample[] {
  return store.getAll();
}

export function subscribeSyncSamples(fn: () => void): () => void {
  return store.subscribe(fn);
}

/** @internal test-only. */
export function __clearSyncSamplesForTests(): void {
  store.clear();
}
