import { useEffect, useRef, type RefObject } from "react";

import type { MonthChangeGuard } from "../data/month/GlobalMonthContext";
import { isElementOnScreen } from "../utils/viewVisibility";

/**
 * Registers a GlobalMonthProvider month-change guard that asks for confirmation
 * only while this view holds unsaved work AND is actually on screen.
 *
 * Switching the global month reloads every view's data from the newly selected
 * month folder, which discards whatever the user had typed but not saved. The
 * provider already owns the confirmation mechanism (`registerMonthChangeGuard`,
 * used by the Population wizard for its unsaved uploads); this is the shared
 * wrapper for it, not a second dialog path.
 *
 * The visibility clause is the load-bearing part. App.tsx keeps up to three tabs
 * mounted at once and every tab with sub-tabs keeps visited sub-views
 * mounted-but-`hidden`, so "still mounted and still dirty" says nothing about
 * "in front of the user". Without the clause, a draft parked on a background
 * view would interrupt a month switch made from a completely different screen
 * with a message whose context is nowhere to be seen.
 *
 * Attach the returned ref to the view's own root element — that is the node
 * whose ancestors are checked for the `hidden` attribute.
 */
export function useVisibleUnsavedWorkMonthGuard(params: {
  registerMonthChangeGuard: (guard: MonthChangeGuard) => () => void;
  /** True while this view holds work a month switch would throw away. */
  hasUnsavedWork: boolean;
  /**
   * The confirm message. Called at guard time rather than read at render time,
   * so an admin's Settings-tab label override applies to the next prompt.
   */
  resolveMessage: () => string;
}): RefObject<HTMLElement | null> {
  const { registerMonthChangeGuard, hasUnsavedWork, resolveMessage } = params;

  const rootRef = useRef<HTMLElement | null>(null);
  // Latest-value refs: the guard is registered once but runs much later, from
  // GlobalMonthProvider's own event handler, so it must not close over a
  // particular render's values. Both are reassigned to the current render's
  // value on every render, which makes StrictMode's double render a no-op.
  const hasUnsavedWorkRef = useRef(hasUnsavedWork);
  // eslint-disable-next-line react-hooks/refs -- see above
  hasUnsavedWorkRef.current = hasUnsavedWork;
  const resolveMessageRef = useRef(resolveMessage);
  // eslint-disable-next-line react-hooks/refs -- see above
  resolveMessageRef.current = resolveMessage;

  useEffect(
    () =>
      registerMonthChangeGuard(() =>
        hasUnsavedWorkRef.current && isElementOnScreen(rootRef.current)
          ? resolveMessageRef.current()
          : null
      ),
    [registerMonthChangeGuard]
  );

  return rootRef;
}
