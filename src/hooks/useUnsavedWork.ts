import { useEffect } from "react";

import { reportUnsavedWork } from "../app/unsavedWorkRegistry";
import { useUnloadGuard } from "./useUnloadGuard";

/**
 * Declare that this view holds work that exists nowhere but in component state,
 * and get every protection the app has for it.
 *
 * There are two ways the app can destroy such work without asking, and they are
 * unrelated enough that they were easy to fix one at a time and leave the other
 * open. Both are handled here so a view only has to state the fact once:
 *
 * 1. The BROWSER discards the page — tab closed, reloaded, navigated back.
 *    `useUnloadGuard` asks for confirmation.
 * 2. The APP unmounts the view — the tab-mount LRU keeps only the three most
 *    recently visited tabs, so visiting three others evicts this one and takes
 *    its state with it, silently. Reporting to `unsavedWorkRegistry` pins the
 *    tab until the work is saved.
 *
 * The view's own guards (a panel refusing to re-point, a month switch asking
 * first) stay where they are: those know what the work IS and can describe it.
 * This hook only knows THAT there is some.
 *
 * `tabId` must be the top-level tab id from `tabCatalog.ts` — the LRU is keyed
 * by that, not by the sub-view. The report is cleared on unmount, so a view
 * that goes away for any other reason does not pin its tab for the session.
 */
export function useUnsavedWork(tabId: string, hasUnsavedWork: boolean): void {
  useUnloadGuard(hasUnsavedWork);
  useEffect(() => {
    reportUnsavedWork(tabId, hasUnsavedWork);
    return () => reportUnsavedWork(tabId, false);
  }, [tabId, hasUnsavedWork]);
}
