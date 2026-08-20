/**
 * "Is this view actually on screen?" for the app's two hide-without-unmounting
 * mechanisms.
 *
 * App.tsx keeps up to three tabs mounted (tabMountLru) and hides the inactive
 * ones with a `hidden` attribute on their wrapper div; every tab with sub-tabs
 * (Population, EmployeeWorkspace, Reports) does the same thing one level down
 * for its visited-but-inactive sub-views. So "mounted" says nothing about "on
 * screen" — the only reliable signal available synchronously is whether an
 * ancestor carries that attribute.
 *
 * Deliberately a DOM read at call time rather than a piece of React state: it
 * is evaluated inside event-driven callbacks (a data-refresh broadcast, a
 * month-change guard) that would otherwise have to close over a visibility
 * flag and could then read a stale value.
 *
 * Not a substitute for a full visibility check (`checkVisibility()`,
 * `offsetParent`): CSS-based hiding is not consulted, and jsdom — where this
 * app's component tests run — performs no layout at all, so a layout-based
 * check would be untestable and would report every element as hidden.
 */
export function isElementOnScreen(element: Element | null): boolean {
  if (!element) return false;
  return element.closest("[hidden]") === null;
}
