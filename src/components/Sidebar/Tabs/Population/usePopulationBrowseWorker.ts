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

/**
 * Identifies one independent "latest request wins" stream against the SAME worker
 * instance. Callers that ask two simultaneously-valid questions of the worker
 * ("what rows does the visible table show" vs. "what options does the open filter
 * dropdown list") must use different lanes, or each will silently invalidate the
 * other's answers — see the hook's own doc comment for the bug this prevents.
 * Any string works; the constants below name the lanes BrowseDataView uses.
 */
export type PopulationQueryLane = string;

/** Default lane for callers with only one query stream. */
export const DEFAULT_QUERY_LANE: PopulationQueryLane = "default";

export type UsePopulationBrowseWorkerResult = {
  /**
   * Fire a "load" request — does not itself return anything; watch `isLoaded`.
   * `options` is optional and purely additive (see LoadRawJsonOptions / the "load"
   * request's own doc comment in populationQueryWorkerTypes.ts) — omitting it posts
   * the exact same request shape as before this option existed.
   *
   * Resets `isLoaded`/`totalRows`/`error` back to their pre-load values, so a stale
   * previous dataset's stats can never be read as if they described the new one.
   */
  loadRawJson: (rawJsonText: string, options?: LoadRawJsonOptions) => void;
  /**
   * Fire a "query" request on `lane` (default: `DEFAULT_QUERY_LANE`). Resolves
   * `null` if superseded by a later `runQuery` call **on the same lane**; queries on
   * other lanes never supersede it.
   */
  runQuery: (
    params: PopulationQueryParams,
    lane?: PopulationQueryLane
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

type PendingQuery = {
  lane: PopulationQueryLane;
  resolve: (result: PopulationQueryResult<Record<string, unknown>> | null) => void;
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
 * ## Staleness tracking: one id space, THREE independent "latest" slots
 *
 * Every request still carries a unique, monotonically increasing `requestId` (the
 * one thing that must stay global, since it's how a reply is correlated back to the
 * request that produced it — `workbookWorker.ts` needs no such field because it only
 * ever has one job in flight).
 *
 * What is deliberately NOT global is the "is this reply still the latest?" test.
 * An earlier version compared every response against a single shared counter, which
 * conflated three semantically unrelated questions and produced two Critical bugs
 * (both invisible to tests whose worker stub replied on a microtask — impossible for
 * a real worker; see populationQueryWorkerTestStub.ts):
 *
 *  1. **The load.** `BrowseDataView`'s load effect posts "load", then SYNCHRONOUSLY
 *     bumps `loadGeneration`, which makes its query effect post a "query" before any
 *     real worker could possibly have answered the load. Against a shared counter
 *     the load's own reply then looked stale and was dropped — `isLoaded`/`totalRows`
 *     never updated, so Browse rendered its "no data" empty state over a perfectly
 *     good dataset. Load completion is therefore tracked by `loadRequestIdRef`,
 *     compared only against the most recent LOAD, never against any query.
 *  2. **The main table's query stream.**
 *  3. **The filter dropdown's preview query stream** — a different effect answering a
 *     different question (which options to list), which can fire in the SAME React
 *     commit as (2) (toggling a filter changes `columnFilters`, a dependency of both)
 *     and, being declared later, got the higher request id. Against a shared counter
 *     that made the main table's own result look stale, so it was discarded and
 *     filtering appeared to do nothing at all.
 *
 * (2) and (3) are answered by `laneLatestRef`: each lane keeps its own "latest
 * request id", so a later request supersedes an earlier one of the SAME lane (fast
 * typing in search still only applies the last keystroke's result) and nothing else.
 * A `runQuery` superseded within its lane still resolves ITS OWN promise — with
 * `null` — once its stale response arrives, rather than hanging forever.
 */
export function usePopulationBrowseWorker(): UsePopulationBrowseWorkerResult {
  const workerRef = useRef<Worker | null>(null);
  // Global id space: unique per request across BOTH "load" and "query", so a reply
  // is always unambiguously correlatable. Staleness is judged per-concern below.
  const requestIdRef = useRef(0);
  // Concern 1: the most recent "load" request's id (0 = no load posted yet).
  const loadRequestIdRef = useRef(0);
  // Concerns 2..N: lane -> that lane's most recent query request id.
  const laneLatestRef = useRef(new Map<PopulationQueryLane, number>());
  // Lanes with an outstanding (not-yet-superseded, not-yet-answered) query; drives
  // the aggregate `isQuerying` flag.
  const inFlightLanesRef = useRef(new Set<PopulationQueryLane>());
  const pendingQueriesRef = useRef(new Map<number, PendingQuery>());

  const [isLoaded, setIsLoaded] = useState(false);
  const [isQuerying, setIsQuerying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalRows, setTotalRows] = useState<number | null>(null);

  useEffect(() => {
    const worker = new PopulationQueryWorker();
    workerRef.current = worker;

    const settleLane = (lane: PopulationQueryLane): void => {
      inFlightLanesRef.current.delete(lane);
      setIsQuerying(inFlightLanesRef.current.size > 0);
    };

    worker.onmessage = (ev: MessageEvent<PopulationQueryWorkerResponse>) => {
      const response = ev.data;

      if (response.type === "loaded") {
        // Compared against the LOAD's own id only — a query posted after this load
        // (which BrowseDataView always does, in the very same tick) must never be
        // able to make the load's reply look stale.
        if (response.requestId === loadRequestIdRef.current) {
          setIsLoaded(true);
          setTotalRows(response.totalRows);
        }
        return;
      }

      if (response.type === "row") {
        // Browse never posts "rowById" — that single-row lookup owns its own
        // short-lived worker (see data/population/populationRowLookup.ts), so this
        // reply cannot reach this handler. Handled explicitly all the same, because
        // everything below narrows the union to "error" by elimination and would
        // silently start treating a "row" reply as a failure if this were omitted.
        return;
      }

      const pending = pendingQueriesRef.current.get(response.requestId);
      if (pending) {
        pendingQueriesRef.current.delete(response.requestId);
      }
      const isCurrentInLane =
        pending !== undefined && laneLatestRef.current.get(pending.lane) === response.requestId;

      if (response.type === "result") {
        if (isCurrentInLane) {
          settleLane(pending!.lane);
          setError(null);
          pending!.resolve(response.result);
        } else {
          // Superseded within its own lane — discard the stale payload as far as
          // hook state goes, but still resolve THIS call's own promise so it
          // never hangs forever.
          pending?.resolve(null);
        }
        return;
      }

      // response.type === "error"
      if (pending) {
        if (isCurrentInLane) {
          settleLane(pending.lane);
          setError(response.error);
        }
        pending.resolve(null);
        return;
      }

      // No pending resolver: the failure belongs to a "load" request (e.g. the raw
      // text didn't parse). Surface it only while it's still the current load —
      // otherwise Browse would hang on its spinner with nothing to show the user.
      if (response.requestId === loadRequestIdRef.current) {
        setError(response.error);
      }
    };

    return () => {
      worker.terminate();
    };
  }, []);

  const loadRawJson = useCallback((rawJsonText: string, options?: LoadRawJsonOptions) => {
    const worker = workerRef.current;
    if (!worker) return;
    const requestId = ++requestIdRef.current;
    loadRequestIdRef.current = requestId;
    // A new dataset is being loaded: the previous one's stats no longer describe
    // what's about to be shown, and a previous load/query failure must not keep the
    // error surface up once a fresh (possibly healthy) month is being loaded.
    setIsLoaded(false);
    setTotalRows(null);
    setError(null);
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
      params: PopulationQueryParams,
      lane: PopulationQueryLane = DEFAULT_QUERY_LANE
    ): Promise<PopulationQueryResult<Record<string, unknown>> | null> => {
      const worker = workerRef.current;
      if (!worker) return Promise.resolve(null);

      const requestId = ++requestIdRef.current;
      laneLatestRef.current.set(lane, requestId);
      inFlightLanesRef.current.add(lane);
      setIsQuerying(true);

      return new Promise((resolve) => {
        pendingQueriesRef.current.set(requestId, { lane, resolve });
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
