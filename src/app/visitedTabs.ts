/**
 * Tracks every tab/sub-tab ID that has ever been the active one, so a caller
 * can keep previously-visited content mounted (hidden, not unmounted)
 * instead of reloading it on every switch back.
 *
 * Unlike touchTabMountLru (which bounds a large, dynamic top-level tab set
 * with LRU eviction), this never evicts -- it's for the small, fixed
 * sub-tab sets under a single parent tab, where keeping everything visited
 * mounted has no meaningful memory cost.
 */
export function touchVisitedTabs<T>(current: ReadonlySet<T>, activeId: T): Set<T> {
  if (current.has(activeId)) return current as Set<T>;
  const next = new Set(current);
  next.add(activeId);
  return next;
}
