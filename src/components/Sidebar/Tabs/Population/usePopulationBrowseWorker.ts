import { useCallback, useEffect, useRef, useState } from "react";

import type {
  PopulationQueryWorkerRequest,
  PopulationQueryWorkerResponse,
} from "../../../../workers/populationQueryWorkerTypes";
import type {
  PopulationQueryParams,
  PopulationQueryResult,
} from "../../../../data/population/populationQuery";
// Type-only import — erased at compile time, so this doesn't add anything to this
// (main-thread) hook file's runtime bundle; only used to type `loadRawJson`'s new
// optional display-parity argument (see populationQueryWorkerTypes.ts's "load" doc
// comment for why the worker needs this).
import type { StageAliasMappings } from "../../../../data/population/populationConfig";
import PopulationQueryWorker from "../../../../workers/populationQueryWorker?worker&inline";

export type LoadRawJsonOptions = {
  /** Threaded through to the worker so its own display-value formatter can special-case "stage". */
  stageMappings?: StageAliasMappings;
  /** Threaded through to the worker so every cached row gets _monthFolder/_month/_year attached. */
  monthFolder?: string;
};

export type UsePopulationBrowseWorkerResult = {
  /**
   * Fire a "load" request — does not itself return anything; watch `isLoaded`.
   * `options` is optional and purely additive (see LoadRawJsonOptions / the "load"
   * request's own doc comment in populationQueryWorkerTypes.ts) — omitting it posts
   * the exact same request shape as before this option existed.
   */
  loadRawJson: (rawJsonText: string, options?: LoadRawJsonOptions) => void;
  /** Fire a "query" request. Resolves `null` if superseded by a later `runQuery` call. */
  runQuery: (
    params: PopulationQueryParams
  ) => Promise<PopulationQueryResult<Record<string, unknown>> | null>;
  isLoaded: boolean;
  isQuerying: boolean;
  error: string | null;
  /**
   * Total row count from the most recent "loaded" response (unaffected by any
   * search/filter — the whole point is that it changes ONLY when a fresh
   * `loadRawJson` actually lands, unlike a query result's `totalRows`, which
   * reflects whatever search/filter params that particular query happened to
   * carry). `null` before the first successful load. Added for Task 4 /
   * BrowseDataView, which needs "is this dataset empty at all" independent of
   * the user's current search/filter state.
   */
  totalRows: number | null;
};

/**
 * Owns the Population-Browse query worker's lifecycle (Phase B of
 * docs/architecture/LARGE_POPULATION_PERFORMANCE_PROPOSAL_2026-07-22.md): spawns
 * `PopulationQueryWorker` once per hook-instance mount and keeps it alive for the
 * whole Browse session, terminating it on unmount — mirrors `Population/index.tsx`'s
 * `WorkbookWorker` spawn/`terminate()`-on-cleanup shape exactly (~line 369-374), but
 * unlike that per-job worker, this one is long-lived: Browse issues many interleaved
 * "query" requests (search/filter/sort/page) against data loaded once via "load".
 *
 * "Latest request wins" staleness guard: copies `useMonthLoad.ts`'s
 * `loadMonthTokenRef` token-ref idiom exactly (increment before dispatch, compare on
 * response, discard if stale), generalized to a single `requestIdRef` counter shared
 * across both "load" and "query" requests and threaded through
 * `PopulationQueryWorkerRequest.requestId`/`PopulationQueryWorkerResponse.requestId`
 * (added specifically so this worker — unlike `workbookWorker.ts`, which only ever
 * has one job in flight — can correlate a reply back to the request that produced
 * it even when calls interleave). Any response whose `requestId` no longer matches
 * the ref's current value is a stale reply and is DISCARDED as far as `isLoaded` /
 * `isQuerying` / `error` state goes. A `runQuery` call superseded by a later
 * `runQuery` call still resolves ITS OWN promise — with `null` — once its stale
 * response eventually arrives, rather than hanging forever; the pending resolver is
 * looked up by that response's own `requestId` in `pendingQueriesRef`.
 */
export function usePopulationBrowseWorker(): UsePopulationBrowseWorkerResult {
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const pendingQueriesRef = useRef(
    new Map<
      number,
      (result: PopulationQueryResult<Record<string, unknown>> | null) => void
    >()
  );

  const [isLoaded, setIsLoaded] = useState(false);
  const [isQuerying, setIsQuerying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalRows, setTotalRows] = useState<number | null>(null);

  useEffect(() => {
    const worker = new PopulationQueryWorker();
    workerRef.current = worker;

    worker.onmessage = (ev: MessageEvent<PopulationQueryWorkerResponse>) => {
      const response = ev.data;
      const isCurrent = response.requestId === requestIdRef.current;

      if (response.type === "loaded") {
        if (isCurrent) {
          setIsLoaded(true);
          setTotalRows(response.totalRows);
        }
        return;
      }

      if (response.type === "result") {
        const resolve = pendingQueriesRef.current.get(response.requestId);
        pendingQueriesRef.current.delete(response.requestId);
        if (isCurrent) {
          setIsQuerying(false);
          setError(null);
          resolve?.(response.result);
        } else {
          // Superseded by a newer call — discard the stale payload as far as
          // hook state goes, but still resolve THIS call's own promise so it
          // never hangs forever.
          resolve?.(null);
        }
        return;
      }

      // response.type === "error"
      const resolve = pendingQueriesRef.current.get(response.requestId);
      pendingQueriesRef.current.delete(response.requestId);
      if (isCurrent) {
        setIsQuerying(false);
        setError(response.error);
      }
      resolve?.(null);
    };

    return () => {
      worker.terminate();
    };
  }, []);

  const loadRawJson = useCallback((rawJsonText: string, options?: LoadRawJsonOptions) => {
    const worker = workerRef.current;
    if (!worker) return;
    const requestId = ++requestIdRef.current;
    const request: PopulationQueryWorkerRequest = {
      type: "load",
      requestId,
      rawJsonText,
      // Conditionally spread rather than always including (possibly undefined) keys,
      // so a caller that omits `options` entirely posts the exact same request shape
      // pre-Task-4 callers/tests already assert on.
      ...(options?.stageMappings ? { stageMappings: options.stageMappings } : {}),
      ...(options?.monthFolder ? { monthFolder: options.monthFolder } : {}),
    };
    worker.postMessage(request);
  }, []);

  const runQuery = useCallback(
    (
      params: PopulationQueryParams
    ): Promise<PopulationQueryResult<Record<string, unknown>> | null> => {
      const worker = workerRef.current;
      if (!worker) return Promise.resolve(null);

      const requestId = ++requestIdRef.current;
      setIsQuerying(true);

      return new Promise((resolve) => {
        pendingQueriesRef.current.set(requestId, resolve);
        const request: PopulationQueryWorkerRequest = {
          type: "query",
          requestId,
          params,
        };
        worker.postMessage(request);
      });
    },
    []
  );

  return { loadRawJson, runQuery, isLoaded, isQuerying, error, totalRows };
}
