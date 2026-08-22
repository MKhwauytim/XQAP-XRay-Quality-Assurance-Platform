import { useEffect, useRef } from "react";

import { getSubTabSelection } from "./subTabSelection";

/**
 * Everything a tab component needs to follow the sidebar rail's sub-tab
 * selection, in one place: the live channel AND the value that was selected
 * before this component existed.
 *
 * The rail announces a selection on two global `window` events —
 * `pop-set-subtab` (legacy, carries only the sub-tab id) and
 * `sidebar-subtab-changed` (carries the parent tab id too). Both are
 * fire-and-forget, so a click that happens while the owning tab is not mounted
 * yet — the first visit to any tab, and every visit after the tab-mount LRU
 * evicted it — used to be lost outright, leaving the rail highlighting one
 * sub-tab and the tab showing another. `subTabSelection.ts` records the same
 * selection durably; this hook replays it once, as the tab mounts.
 *
 * `knownSubTabs` is still applied to every value from either source. The
 * events are global — up to three tabs are mounted at once and each hears the
 * others' clicks — so a tab must never act on an id it does not own. Keeping
 * that filter here means it is applied identically to the live events and to
 * the replayed selection.
 *
 * Pass stable arguments (a module-level `Set`, a `useState` setter or a
 * `useCallback`): the listeners are re-subscribed whenever they change. The
 * mount replay is not repeated on a re-subscription — it is a one-shot
 * recovery of a lost click, and re-running it later would undo a navigation
 * the tab made on its own (Population's "open this month" jump, say).
 */
export function useSubTabSelection(
  parentTabId: string,
  knownSubTabs: ReadonlySet<string>,
  onSelect: (subTabId: string) => void
): void {
  const replayedRef = useRef(false);

  useEffect(() => {
    if (!replayedRef.current) {
      replayedRef.current = true;
      const pending = getSubTabSelection(parentTabId);
      // A no-op when it matches what the tab already opened on: React bails
      // out of a setState that does not change the value.
      if (pending !== undefined && knownSubTabs.has(pending)) onSelect(pending);
    }

    const handleLegacyEvent = (event: Event) => {
      const { subTabId } = (event as CustomEvent<{ subTabId?: string }>).detail ?? {};
      if (typeof subTabId === "string" && knownSubTabs.has(subTabId)) onSelect(subTabId);
    };
    const handleGenericEvent = (event: Event) => {
      const detail =
        (event as CustomEvent<{ parentTabId?: string; subTabId?: string }>).detail ?? {};
      if (detail.parentTabId !== parentTabId) return;
      if (typeof detail.subTabId === "string" && knownSubTabs.has(detail.subTabId)) {
        onSelect(detail.subTabId);
      }
    };

    window.addEventListener("pop-set-subtab", handleLegacyEvent);
    window.addEventListener("sidebar-subtab-changed", handleGenericEvent);
    return () => {
      window.removeEventListener("pop-set-subtab", handleLegacyEvent);
      window.removeEventListener("sidebar-subtab-changed", handleGenericEvent);
    };
  }, [parentTabId, knownSubTabs, onSelect]);
}
