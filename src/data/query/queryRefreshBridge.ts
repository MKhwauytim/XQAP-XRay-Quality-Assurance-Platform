/**
 * Bridges the app's existing single invalidation authority
 * (`dataRefreshSignal.ts` -- the 3-minute auto-refresh tick in `AuthGate.tsx`
 * plus the manual refresh button in `AdminToolbar`) into TanStack Query.
 *
 * Deliberately dumb: on ANY broadcast (manual or periodic) it invalidates
 * every query this app has registered through `queryClient`. It does not
 * duplicate `dataRefreshSignal`'s own "manual vs periodic" distinction --
 * Query has no independent staleness opinion here, it is purely told when to
 * refetch. Mount this once, near the app root, alongside
 * `QueryClientProvider`.
 */
import { useEffect } from "react";
import type { QueryClient } from "@tanstack/react-query";

import { subscribeToDataRefresh } from "../workspace/dataRefreshSignal";

export function useQueryRefreshBridge(queryClient: QueryClient): void {
  useEffect(
    () => subscribeToDataRefresh(() => { void queryClient.invalidateQueries(); }),
    [queryClient]
  );
}
