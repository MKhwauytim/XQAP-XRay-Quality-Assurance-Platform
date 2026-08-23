import { useEffect, useState, useSyncExternalStore } from "react";

import {
  getUiScale,
  isUiScaleCustomized,
  subscribeToUiScale,
  type UiScaleSettings,
} from "./uiScaleStore";

/**
 * Subscribed read of the app-wide UI scale — mirrors `useLabels()` exactly.
 *
 * Only the editor in Settings needs this. Everything else in the app follows
 * the scale through CSS custom properties on the root element, which cost no
 * React work at all: nothing re-renders when the scale changes, the browser
 * simply re-lays-out.
 */
export function useUiScale(): UiScaleSettings {
  const [settings, setSettings] = useState<UiScaleSettings>(getUiScale);
  useEffect(() => subscribeToUiScale(() => setSettings(getUiScale())), []);
  return settings;
}

/**
 * "Is the scale currently something other than 100 %?", as a SUBSCRIBED read.
 *
 * Exactly the hazard `useIsCustomized` in `labelsStore`'s hook documents, and
 * an end-to-end test caught it here for real: calling `isUiScaleCustomized()`
 * straight from a render reads module state the component does not listen to,
 * and — since the call takes no arguments — the React Compiler is entitled to
 * hoist it out of the render entirely. The reset button stayed `disabled`
 * after the slider had already moved, so the only way back to 100 % was gone.
 *
 * `useSyncExternalStore` makes the read reactive and recomputed on every store
 * notification; the snapshot is a boolean, so there is no cached object
 * identity to get wrong.
 */
export function useIsUiScaleCustomized(): boolean {
  return useSyncExternalStore(subscribeToUiScale, isUiScaleCustomized);
}
