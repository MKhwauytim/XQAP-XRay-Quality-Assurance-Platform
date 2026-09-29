import { useEffect, useState } from "react";

import type { DirectoryHandleLike } from "../../../../data/storage/fileSystemAccess";
import { workspaceScopeId } from "../../../../data/storage/inFlightReads";
import { loadPriorMonthAdvisory } from "../../../../data/sampling/switchingRuleAdvisory";
import type { SamplingPlanPriorMonthAdvisory } from "../../../../data/sampling/samplingPlanStorage";

/**
 * B4 / D7: the prior-month switching-rule advisory, shown in Phase 3 of the
 * Process sub-tab only. It is a fact about the PRIOR month, so nothing done to
 * the selected month (every Population mutation bumps its refresh key) can
 * change it. It is therefore read only while the view that shows it is
 * visible, and at most once per (workspace, month) per interval — it can
 * touch the prior month's whole `population.final` on a month processed before
 * the aggregate carried the suspicion rate, on the same share every write uses.
 * The cache is not invalidated by changes to the prior month's data; the
 * sampling plan saved on the draw path still reads the advisory fresh.
 */
export const PRIOR_MONTH_ADVISORY_TTL_MS = 5 * 60_000;

/**
 * `loadPriorMonthAdvisory` never rejects: a failed read comes back as the
 * "none" result (`priorMonthFolderName === null`), indistinguishable from a
 * genuinely first month. A "none" is therefore only remembered briefly, so a
 * transient read failure cannot hide the advisory for the whole interval.
 */
export const PRIOR_MONTH_ADVISORY_NONE_TTL_MS = 15_000;

type CacheEntry = { at: number; advisory: SamplingPlanPriorMonthAdvisory };
const cache = new Map<string, CacheEntry>();

/** @internal — test-only. */
export function __resetPriorMonthAdvisoryCacheForTests(): void {
  cache.clear();
}

export function usePriorMonthAdvisory(
  directoryHandle: DirectoryHandleLike | null,
  monthFolderName: string,
  enabled: boolean
): SamplingPlanPriorMonthAdvisory | null {
  const key = directoryHandle ? `${workspaceScopeId(directoryHandle)}|${monthFolderName}` : null;
  // Tagged with its key so a month switch never shows the previous month's value.
  const [held, setHeld] = useState<{ key: string; advisory: SamplingPlanPriorMonthAdvisory } | null>(null);

  useEffect(() => {
    if (!enabled || !directoryHandle || key === null) return;
    const fresh = cache.get(key);
    const ttl = fresh?.advisory.priorMonthFolderName === null ? PRIOR_MONTH_ADVISORY_NONE_TTL_MS : PRIOR_MONTH_ADVISORY_TTL_MS;
    if (fresh && Date.now() - fresh.at < ttl) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- adopting a value read earlier this interval
      setHeld({ key, advisory: fresh.advisory });
      return;
    }
    let cancelled = false;
    loadPriorMonthAdvisory(directoryHandle, monthFolderName)
      .then((advisory) => {
        cache.set(key, { at: Date.now(), advisory });
        if (!cancelled) setHeld({ key, advisory });
      })
      .catch(() => {
        // Not reachable today (the loader swallows its errors) but kept honest:
        // advisory only, never blocks the draw, not cached.
        if (!cancelled) setHeld(null);
      });
    return () => { cancelled = true; };
  }, [enabled, directoryHandle, key, monthFolderName]);

  return held !== null && held.key === key ? held.advisory : null;
}
