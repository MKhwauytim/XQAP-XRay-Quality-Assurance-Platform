import { useEffect, useState } from "react";
import type { DirectoryHandleLike } from "../data/storage/fileSystemAccess";
import { loadPopulationConfig, type StageAliasMappings } from "../data/population/populationConfig";
import { subscribeToDataChange } from "../data/workspace/dataRefreshSignal";
import { logRejection } from "../data/storage/errorLogger";

/**
 * The workspace's stage alias table (`config.json` → `stageMappings`), so a
 * custom alias renders as its Arabic level label. `undefined` until the first
 * read settles (callers then fall back to DEFAULT_STAGE_MAPPINGS).
 *
 * Re-read on a MANUAL refresh only: the config is not one of the periodic
 * change-set families, so an empty family list subscribes to manual
 * broadcasts and nothing else. `alive` drops a read that settles after the
 * workspace changed or the view unmounted.
 */
export function useWorkspaceStageMappings(
  directoryHandle: DirectoryHandleLike | null,
): StageAliasMappings | undefined {
  const [stageMappings, setStageMappings] = useState<StageAliasMappings | undefined>(undefined);

  useEffect(() => {
    if (!directoryHandle) return undefined;
    let alive = true;
    const load = (): void => {
      void loadPopulationConfig(directoryHandle)
        .then((config) => {
          if (alive) setStageMappings(config.stageMappings);
        })
        .catch(logRejection("useWorkspaceStageMappings:loadPopulationConfig"));
    };
    load();
    const unsubscribe = subscribeToDataChange([], load);
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [directoryHandle]);

  return stageMappings;
}
