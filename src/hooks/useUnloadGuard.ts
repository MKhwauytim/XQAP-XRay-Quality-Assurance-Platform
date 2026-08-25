import { useEffect } from "react";

/**
 * Ask the browser to confirm before the tab is closed, reloaded or navigated
 * away from while there is unsaved work.
 *
 * The app already guards every route it controls — `selectEntry` refuses to
 * re-point a dirty panel, `useVisibleUnsavedWorkMonthGuard` intercepts a global
 * month switch, and a background refresh deliberately retains a vanished-but-
 * dirty entry. What none of those can reach is the browser's own chrome: a
 * closed tab, an F5, a Back gesture. A typed inspection answer lives ONLY in
 * `InspectionPanel`'s `useState` until a save reaches disk, so those three
 * gestures destroy it silently and completely.
 *
 * That gap stops being theoretical the moment saving starts failing. In the
 * 2026-08-25 XQ-IO-032 incident one employee's answer save failed eleven times
 * over 88 minutes; each failure correctly LEFT the draft in the panel and told
 * them to retry, so the work was intact — and one reload of a page that
 * appeared stuck would have taken all of it. A failing save is precisely the
 * situation in which a user reaches for refresh.
 *
 * Mechanics, all of them constrained by the platform rather than chosen:
 *
 * - `preventDefault()` plus a non-empty `returnValue` is the pair every current
 *   engine still honours; older Chromium needs the assignment, the spec wants
 *   the `preventDefault`.
 * - The MESSAGE is not ours. Browsers replaced custom text with their own fixed
 *   sentence years ago, precisely because sites abused it, so there is no label
 *   key to add here — Arabic or otherwise. The string below is only what the
 *   legacy `returnValue` channel requires be non-empty.
 * - The listener is added ONLY while `enabled` is true. A permanently installed
 *   `beforeunload` handler disqualifies the page from the back/forward cache in
 *   every engine, which would make ordinary navigation slower for everyone to
 *   protect a state that usually does not exist.
 */
export function useUnloadGuard(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      // Legacy channel: the value is never displayed, it only has to be set.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [enabled]);
}
