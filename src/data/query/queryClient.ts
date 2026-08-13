/**
 * Shared TanStack Query client -- the app-wide, per-tab, in-memory cache that
 * fixes "navigate from page A to page B and it reloads the same data"
 * (owner's words). This is a caching layer, not a network layer: `queryFn`
 * here always resolves against the File System Access API, never `fetch`.
 *
 * ONE INVALIDATION AUTHORITY (do not add a second one). This app already has
 * a single tick that decides when workspace data is stale: `runSync()` in
 * `data/workspace/workspaceSync.ts`, driven by its two triggers (the 45s
 * automatic timer in `SyncTick.tsx` and the manual refresh button), which
 * broadcasts `dataRefreshSignal.ts`'s `xray-data-refresh` event. That
 * broadcast — not Query's own staleness heuristics — is wired (see
 * `queryRefreshBridge.ts`) to call `invalidateQueries`. Every query below is
 * therefore configured with an effectively-infinite `staleTime` and with
 * `refetchOnWindowFocus`/`refetchOnReconnect`/`refetchOnMount` all disabled:
 * there is no network here, so "window focus" and "reconnect" are meaningless,
 * and a second automatic refetch trigger racing the explicit one would only
 * reintroduce the duplicate-load problem this layer exists to remove.
 *
 * Write call sites (`safeWriteJson`/`casLoop`) that want their own writes
 * reflected immediately (not just on the next 45s tick) should call
 * `queryClient.invalidateQueries({ queryKey: [...] })` directly after a
 * successful write, scoped to the specific key they changed.
 */
import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: Infinity,
      gcTime: 30 * 60_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      refetchOnMount: false,
      retry: false,
    },
  },
});
