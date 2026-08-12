/**
 * Bridges the app's existing single invalidation authority
 * (`dataRefreshSignal.ts` -- the sync tick in `SyncTick.tsx` plus the manual
 * refresh button in `AdminToolbar`) into TanStack Query.
 *
 * H6 (perf/sync spec, corrected in r2): the ORIGINAL version of this bridge
 * invalidated EVERY registered query on ANY broadcast, including a granular
 * periodic tick that only found (say) a new notification. That made the
 * whole point of computing a per-family change set moot for anything backed
 * by Query -- the query would refetch every tick regardless of what changed,
 * silently, with no visible symptom other than "the app didn't get any
 * faster". This version narrows to:
 * - `"manual"` -- full `invalidateQueries()`, unchanged. An admin asked for
 *   a hard refresh; every Query-backed read should treat its cache as gone.
 * - `"periodic"` with a `changed` set -- only the query keys mapped to a
 *   changed family are invalidated, via `invalidateQueries({ queryKey })`'s
 *   prefix-matching semantics.
 *
 * FAMILY_QUERY_KEY_PREFIXES is intentionally small today: `monthFoldersQuery`
 * is the only dataset actually migrated onto Query so far (Phase 2 of the
 * perf/sync spec migrates the rest -- XrayReferrals, XrayInspectionResults,
 * useApprovalData, NotificationManager -- onto Query-backed reads). A month
 * folder's list/lock-adjacent state is closest to the `manifest` family
 * (month creation, lock/unlock all bump the manifest's envelope revision),
 * so that's the one mapping wired here. Extend this table, not the callback
 * body, as more datasets migrate onto Query.
 */
import { useEffect } from "react";
import type { QueryClient } from "@tanstack/react-query";

import { subscribeToDataChange, type DataRefreshFamily } from "../workspace/dataRefreshSignal";
import { ALL_DATA_REFRESH_FAMILIES } from "../workspace/dataRefreshSignal";

const FAMILY_QUERY_KEY_PREFIXES: Partial<Record<DataRefreshFamily, readonly unknown[]>> = {
  manifest: ["monthFolders"],
};

export function useQueryRefreshBridge(queryClient: QueryClient): void {
  useEffect(
    () =>
      subscribeToDataChange(ALL_DATA_REFRESH_FAMILIES, (detail) => {
        if (detail.source === "manual") {
          void queryClient.invalidateQueries();
          return;
        }
        for (const family of detail.changed) {
          const queryKey = FAMILY_QUERY_KEY_PREFIXES[family];
          if (queryKey) void queryClient.invalidateQueries({ queryKey });
        }
      }),
    [queryClient]
  );
}
