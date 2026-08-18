import { createContext, useContext } from "react";

/**
 * Session-level actions that `AuthGate` owns but that are invoked from further
 * down the tree.
 *
 * Nav 1b moved logout out of the `AdminToolbar` (a direct child of AuthGate)
 * and into the sidebar footer, which renders inside `AppContent`. A context is
 * used rather than the render prop because `logout` reads `isDemoSessionRef`,
 * and `react-hooks/refs` correctly refuses to let a ref-reading function be
 * reachable from a function that is *called* during render — which
 * AuthGate's `renderAuthenticatedChildren(...)` is. Handing it over as a
 * provider `value` is a plain prop, not a render-time call, so the ref stays
 * untouched until someone actually clicks.
 */
export type SessionActions = {
  logout: () => void;
};

const NOT_IN_PROVIDER: SessionActions = {
  logout: () => {
    throw new Error("useSessionActions must be used inside AuthGate's SessionActionsProvider.");
  },
};

export const SessionActionsContext = createContext<SessionActions>(NOT_IN_PROVIDER);

export function useSessionActions(): SessionActions {
  return useContext(SessionActionsContext);
}
