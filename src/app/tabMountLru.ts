/**
 * Keeps a bounded list of recently used tab IDs.
 *
 * The newest tab is always at the end. Filtering against the current access
 * list also prevents a tab that was revoked during the session from remaining
 * mounted in the DOM.
 *
 * `pinnedTabIds` are tabs that must survive eviction because unmounting them
 * would destroy work that exists nowhere else — see `unsavedWorkRegistry.ts`.
 * A pinned tab is NOT exempt from the access filter: a tab the user may no
 * longer open is unmounted whatever it holds. Pinning only outranks recency.
 */
export function touchTabMountLru(
  current: readonly string[],
  activeTabId: string,
  allowedTabIds: ReadonlySet<string>,
  limit = 3,
  pinnedTabIds?: ReadonlySet<string>,
): string[] {
  if (!activeTabId || !allowedTabIds.has(activeTabId) || limit < 1) return [];

  const next = current.filter(
    (tabId, index) =>
      tabId !== activeTabId &&
      allowedTabIds.has(tabId) &&
      current.indexOf(tabId) === index,
  );
  next.push(activeTabId);
  const kept = next.slice(-limit);
  if (!pinnedTabIds || pinnedTabIds.size === 0) return kept;

  // Re-admit pinned survivors ahead of the kept window, oldest first, so the
  // list stays newest-last. This can push the mounted count above `limit` — on
  // purpose: the limit exists to bound memory, and losing an employee's typed
  // inspection answers to save one mounted subtree is not a trade worth making.
  // The overflow is bounded by how many tabs can hold unsaved work at once,
  // which in practice is one.
  for (const tabId of next) {
    if (pinnedTabIds.has(tabId) && !kept.includes(tabId)) kept.unshift(tabId);
  }
  return kept;
}
