/**
 * "Which sub-tab did the rail last select for this top-level tab?" — a
 * last-value store, keyed by parent tab id.
 *
 * WHY IT EXISTS. `Sidebar.handleSubTabClick` does two things: it selects the
 * parent tab (a React `setState` in `App.tsx`, which lands on the NEXT commit)
 * and it announces the sub-tab (a `window` CustomEvent, dispatched
 * synchronously, right now). A tab component subscribes to that event from a
 * mount effect — so on the first visit to a tab, and on every visit after the
 * tab-mount LRU evicted it, the announcement is dispatched while nothing is
 * listening. The rail paints `aria-current="page"` on the sub-tab that was
 * clicked; the tab, mounting a commit later, opens on its own default
 * sub-tab; and nothing reconciles the two.
 *
 * A transient event cannot survive a mount, so the selection is also recorded
 * here. The events remain the LIVE channel for tabs that are already mounted
 * (they are what makes an open tab switch section instantly); this store is
 * the DURABLE one, read by a tab as it mounts — which is exactly the moment
 * the event could not reach it.
 *
 * Keyed by parent tab id, so a reader only ever sees selections addressed to
 * it. That is deliberately belt-and-braces with each tab's own set of known
 * sub-tab ids (`KNOWN_POPULATION_SUB_TABS` and siblings), which still filters
 * every value before it is applied: the window events are global and carry no
 * parent id, so those guards remain necessary and are unchanged.
 */

const selectionByTabId = new Map<string, string>();

/** Record the rail's selection. Called by the one place that makes it. */
export function setSubTabSelection(parentTabId: string, subTabId: string): void {
  selectionByTabId.set(parentTabId, subTabId);
}

/** The rail's latest selection for a tab, or `undefined` if it never made one. */
export function getSubTabSelection(parentTabId: string): string | undefined {
  return selectionByTabId.get(parentTabId);
}

/**
 * The sub-tab a tab should open on as it mounts: the rail's latest selection
 * when the tab recognises it, and the tab's own default otherwise.
 *
 * Deliberately NOT consuming — reading it twice (React `useState` initializers
 * run twice under StrictMode) must give the same answer, and a tab that
 * re-mounts after an LRU eviction should open on what the rail is showing, not
 * on a default the rail disagrees with.
 */
export function resolveInitialSubTab<TSubTab extends string>(
  parentTabId: string,
  knownSubTabs: ReadonlySet<string>,
  fallback: TSubTab
): TSubTab {
  const selected = selectionByTabId.get(parentTabId);
  return selected !== undefined && knownSubTabs.has(selected)
    ? (selected as TSubTab)
    : fallback;
}

/**
 * Forget every recorded selection.
 *
 * Called when a session ends: the next user to sign in on the same page load
 * must land on each tab's own default, not on whoever was here before — a
 * sub-tab they may not even be permitted to view.
 */
export function clearSubTabSelections(): void {
  selectionByTabId.clear();
}

/** Test-only reset — the store is module state and outlives a render. */
export function __resetSubTabSelectionsForTests(): void {
  clearSubTabSelections();
}
