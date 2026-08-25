/**
 * Which tabs currently hold work that exists nowhere but in memory.
 *
 * A plain pub/sub module in the same shape as `dataRefreshSignal.ts` — no state
 * library, no storage. It deliberately records only WHICH tab is dirty, never
 * the work itself: an inspection answer is business data, and this repo's two
 * persistence layers put business data on the workspace side of the line
 * (see CLAUDE.md). A draft cached in `localStorage` would cross that line and
 * needs an owner decision and a `storageRegistry.ts` key; a set of tab ids does
 * not.
 *
 * It exists because the app can destroy a typed answer without asking. The
 * tab-mount LRU keeps only the three most recently visited tabs mounted, so
 * visiting three other tabs unmounts `InspectionPanel` and takes its `useState`
 * draft with it — silently, with no dialog. The confirm guards cover the panel's
 * own navigation, a global month switch and (since `useUnloadGuard`) closing the
 * browser tab; none of them can see an LRU eviction coming. `touchTabMountLru`
 * consults this registry so a dirty tab survives eviction instead.
 *
 * Reporting is idempotent and the value is a plain boolean, so a component can
 * call it from an effect on every render of a dirty state without churn.
 */

const dirtyTabIds = new Set<string>();
type Listener = () => void;
const listeners = new Set<Listener>();

/**
 * Mark `tabId` as holding (or no longer holding) unsaved work.
 *
 * Callers should report `false` from their effect cleanup as well as on save,
 * so a tab that unmounts for a reason other than eviction does not stay pinned
 * for the rest of the session.
 */
export function reportUnsavedWork(tabId: string, dirty: boolean): void {
  const had = dirtyTabIds.has(tabId);
  if (dirty === had) return;
  if (dirty) dirtyTabIds.add(tabId);
  else dirtyTabIds.delete(tabId);
  for (const listener of listeners) listener();
}

/** The dirty set. A snapshot — safe to hold, never mutated in place. */
export function getDirtyTabIds(): ReadonlySet<string> {
  return new Set(dirtyTabIds);
}

/** Subscribe to changes; returns the unsubscribe function. */
export function subscribeToUnsavedWork(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** @internal — test-only. Forget every report. */
export function __resetUnsavedWorkForTests(): void {
  dirtyTabIds.clear();
  listeners.clear();
}
