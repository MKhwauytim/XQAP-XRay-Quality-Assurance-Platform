/**
 * Keeps a bounded list of recently used tab IDs.
 *
 * The newest tab is always at the end. Filtering against the current access
 * list also prevents a tab that was revoked during the session from remaining
 * mounted in the DOM.
 */
export function touchTabMountLru(
  current: readonly string[],
  activeTabId: string,
  allowedTabIds: ReadonlySet<string>,
  limit = 3,
): string[] {
  if (!activeTabId || !allowedTabIds.has(activeTabId) || limit < 1) return [];

  const next = current.filter(
    (tabId, index) =>
      tabId !== activeTabId &&
      allowedTabIds.has(tabId) &&
      current.indexOf(tabId) === index,
  );
  next.push(activeTabId);
  return next.slice(-limit);
}
