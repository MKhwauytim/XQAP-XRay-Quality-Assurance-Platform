/**
 * Shared Query-cached wrapper around `listMonthFolders` -- the first migrated
 * duplicated load (rework W5). Before this, `App.tsx` (auto-backup),
 * `Archive/index.tsx` (archive status/refresh), `WorkspaceGate.tsx`
 * (onboarding month-count) and `GlobalMonthProvider.tsx` (the month selector)
 * each independently listed the workspace's month folders on mount/workspace
 * change -- four directory reads for one piece of data that changes rarely
 * (only when a month is created/renamed/archived).
 *
 * Query key is `['monthFolders', directoryHandle.name]`. `directoryHandle`
 * itself isn't a stable primitive, but within one workspace connection it's
 * a single stable object whose `.name` (the picked root folder's name) is a
 * reasonable proxy -- consistent with how the rest of the app already keys
 * workspace-scoped state (see `WorkspaceGate.tsx`'s dismiss-key pattern).
 *
 * Call sites keep their own existing effect/token/cancellation structure and
 * simply swap a direct `listMonthFolders(directoryHandle)` call for
 * `queryClient.fetchQuery(monthFoldersQueryOptions(directoryHandle))` --
 * `fetchQuery` dedupes concurrent callers and serves cached data instantly
 * once one caller has populated it, without requiring every consumer to
 * become a `useQuery` component.
 */
import { queryOptions, useQuery, type QueryClient } from "@tanstack/react-query";

import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { listMonthFolders } from "../population/populationStorage";
import type { MonthFolderInfo } from "../population/monthFolder";

export function monthFoldersQueryKey(directoryHandle: DirectoryHandleLike | null): readonly unknown[] {
  return ["monthFolders", directoryHandle?.name ?? null] as const;
}

export function monthFoldersQueryOptions(directoryHandle: DirectoryHandleLike | null) {
  return queryOptions<MonthFolderInfo[]>({
    queryKey: monthFoldersQueryKey(directoryHandle),
    queryFn: () => listMonthFolders(directoryHandle as DirectoryHandleLike),
    enabled: directoryHandle !== null,
  });
}

/** Hook form, for components that want to render straight off the cache. */
export function useMonthFoldersQuery(directoryHandle: DirectoryHandleLike | null) {
  return useQuery(monthFoldersQueryOptions(directoryHandle));
}

/**
 * For a caller's own deliberate "go re-read this" moment (a manual refresh
 * button, or right after a write this tab knows changed which month folders
 * exist -- a restore, an import). `staleTime: Infinity` means a plain
 * `fetchQuery` after such a write would otherwise silently hand back the
 * stale cached list; invalidate first so the next `fetchQuery` actually hits
 * disk.
 */
export function invalidateMonthFolders(
  queryClient: QueryClient,
  directoryHandle: DirectoryHandleLike | null
): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: monthFoldersQueryKey(directoryHandle) });
}
