/**
 * Ambient "who and where" for the error log.
 *
 * WHY THIS EXISTS AS A SEPARATE MODULE. The owner requirement is that every
 * persisted error carries the page the user was on and the username who hit
 * it. There are 56 modules calling `logError(context, error)` today, and
 * almost none of them are in a position to know either fact: half are in the
 * data layer, below React entirely. Threading two new required arguments
 * through all of them would be a large, mechanical, permanently-load-bearing
 * change for information three modules already hold. So the three that hold it
 * write it here once, and `logError` reads it.
 *
 * ZERO IMPORTS, DELIBERATELY. `errorLogger.ts` imports this file, and
 * `safeWrite.ts` imports `errorLogger.ts` — so this module sits at the very
 * bottom of the data layer. An import here could close a cycle that `vitest`
 * (per-file transpile, no module-graph check) would never surface and that
 * would only fail at `vite build` or at module-eval time in the browser.
 * `errorContext.test.ts` pins the constraint.
 */

export type ErrorContext = {
  /** `"tab"` or `"tab/sub-tab"`, or `"unknown"` before the app has navigated. */
  page: string;
  username: string | null;
  role: string | null;
};

let activeTabId: string | null = null;
let activeSubTab: { parentTabId: string; subTabId: string } | null = null;
let actorUsername: string | null = null;
let actorRole: string | null = null;

/** The active top-level tab. Called from `App.tsx`'s navigation effect. */
export function setErrorPageTab(tabId: string): void {
  if (tabId === activeTabId) return;
  activeTabId = tabId;
  // A sub-tab selection belongs to the tab it was made for; once the user has
  // moved to another tab it no longer describes where they are.
  activeSubTab = null;
}

/**
 * The rail's sub-tab selection. Called from the ONE place that records it
 * (`src/app/subTabSelection.ts`), so this needs no second wiring path.
 */
export function setErrorPageSubTab(parentTabId: string, subTabId: string): void {
  activeSubTab = { parentTabId, subTabId };
}

/** Called on sign-in and session restore (`authSession.writeSession`). */
export function setErrorActor(username: string, role: string): void {
  actorUsername = username;
  actorRole = role;
}

/** Called on sign-out (`authSession.clearSession`). */
export function clearErrorActor(): void {
  actorUsername = null;
  actorRole = null;
}

export function readErrorContext(): ErrorContext {
  const page =
    activeTabId === null
      ? "unknown"
      : activeSubTab !== null && activeSubTab.parentTabId === activeTabId
        ? `${activeTabId}/${activeSubTab.subTabId}`
        : activeTabId;
  return { page, username: actorUsername, role: actorRole };
}

/** @internal — test-only. Module state outlives a render and a test. */
export function __resetErrorContextForTests(): void {
  activeTabId = null;
  activeSubTab = null;
  actorUsername = null;
  actorRole = null;
}
