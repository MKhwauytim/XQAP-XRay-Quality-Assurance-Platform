import type { PopulationQueryParams, PopulationQueryResult } from "../data/population/populationQuery";
// Type-only import -- erased at compile time, so this does NOT pull populationConfig.ts's
// runtime dependency graph (safeReadJson/casLoop/webLocks/workspacePaths) into the worker
// bundle. See populationQueryWorker.ts's own comment for why the worker duplicates the
// small pure stage-label logic instead of importing it at runtime.
import type { StageAliasMappings } from "../data/population/populationConfig";

// `requestId` (absent from workbookWorkerTypes.ts) lets a caller correlate an
// in-flight worker reply back to the request that produced it — workbookWorker.ts
// never needs this because it only ever has one job in flight at a time, but this
// worker fields interleaved "load"/"query" calls, so a later task (staleness
// correlation when a fast-typed query outraces a stale one) depends on it existing.
export type PopulationQueryWorkerRequest =
  | {
      type: "load";
      requestId: number;
      rawJsonText: string;
      /**
       * Display-parity inputs (Task 4 / BrowseDataView integration). Both optional and
       * purely additive: omitting them keeps this worker's generic display-value
       * formatter exactly as Task 2 shipped it, so existing callers/tests are unaffected.
       * When provided:
       *  - `stageMappings` lets the worker's own display-value formatter special-case
       *    the "stage" column (stage-alias -> canonical Arabic label) instead of falling
       *    back to a raw String(value) -- mirroring BrowseDataView.tsx's real
       *    getBrowseDisplayValue, so search/filter matching against a stage's DISPLAYED
       *    label (not just its raw stored alias) works identically to the pre-worker
       *    inline implementation.
       *  - `monthFolder` is attached (with its parsed month/year) to every cached row as
       *    `_monthFolder`/`_month`/`_year`, mirroring populationStorage.ts's
       *    appendMonthInfo -- the raw population.final.json file itself carries no such
       *    field, since it's synthesized metadata about WHICH file was loaded, not part
       *    of the file's own content. Also lets the "_monthFolder" column's display value
       *    (folder name -> short Arabic month/year label) match the pre-worker behavior.
       */
      stageMappings?: StageAliasMappings;
      monthFolder?: string;
    }
  | { type: "query"; requestId: number; params: PopulationQueryParams }
  /**
   * Resolve ONE row by its `xrayImageId` against the loaded cache (item 1.12).
   *
   * Deliberately not expressed as a `"query"` with a search param: `runPopulationQuery`
   * runs the whole search -> filter -> sort -> paginate pipeline and returns a page
   * plus aggregate stats, all of which the single-row callers throw away. More to the
   * point, its search matches on DISPLAY values across every column, so an id that
   * happens to appear inside another row's text field would come back as a false
   * positive. This is an exact-match lookup on one field and needs to stay one.
   */
  | { type: "rowById"; requestId: number; xrayImageId: string };

export type PopulationQueryWorkerResponse =
  | { type: "loaded"; requestId: number; totalRows: number }
  | { type: "result"; requestId: number; result: PopulationQueryResult<Record<string, unknown>> }
  /**
   * Reply to `"rowById"`. `row: null` means "loaded fine, no such id" — a normal
   * negative answer, distinct from an `"error"` reply (which means the lookup itself
   * could not be performed). Callers act on the two differently: a missing row is the
   * stale-candidate case the UI already has a message for, an error is not.
   */
  | { type: "row"; requestId: number; row: Record<string, unknown> | null }
  | { type: "error"; requestId: number; error: string };
