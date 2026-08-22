import { useEffect, useState, useSyncExternalStore } from "react";
import { getLabels, isCustomized, subscribe, type LabelKey, type Labels } from "./labelsStore";

export type { Labels };

export function useLabels(): Labels {
  const [labels, setLabels] = useState<Labels>(() => getLabels());
  useEffect(() => subscribe(() => setLabels(getLabels())), []);
  return labels;
}

/**
 * "Does this key currently have an admin override?", as a SUBSCRIBED read.
 *
 * `isCustomized()` on its own is a plain function call over module state: a
 * component that calls it directly is reading a store it does not listen to,
 * so its own write (the Settings label editor writes exactly this state) never
 * comes back to it — and, because the call's only argument is a constant prop,
 * the React Compiler is entitled to hoist the result out of the render
 * entirely. `useSyncExternalStore` makes the read reactive and the value
 * recomputed on every store notification; the snapshot is a boolean, so there
 * is no cached-object identity to get wrong.
 */
export function useIsCustomized(key: LabelKey): boolean {
  return useSyncExternalStore(
    subscribe,
    () => isCustomized(key)
  );
}
