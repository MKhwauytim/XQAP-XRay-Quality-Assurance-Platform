import { createContext, useContext } from "react";

/**
 * Whether the top-level tab that contains this component is the one on screen.
 *
 * `App.tsx` keeps up to three visited tabs mounted (hidden, not unmounted) so
 * switching back does not re-trigger their loads, which means a hidden tab's
 * views keep receiving every data-refresh broadcast. A view that would do a
 * heavy silent reload on each broadcast reads this to defer the reload until
 * it is shown again. Defaults to `true` so a view rendered outside the shell
 * (unit tests, previews) behaves exactly as before.
 */
export const TabActiveContext = createContext<boolean>(true);

export function useTabActive(): boolean {
  return useContext(TabActiveContext);
}
