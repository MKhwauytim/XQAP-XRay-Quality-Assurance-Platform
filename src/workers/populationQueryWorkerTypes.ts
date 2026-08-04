import type { PopulationQueryParams, PopulationQueryResult } from "../data/population/populationQuery";

// `requestId` (absent from workbookWorkerTypes.ts) lets a caller correlate an
// in-flight worker reply back to the request that produced it — workbookWorker.ts
// never needs this because it only ever has one job in flight at a time, but this
// worker fields interleaved "load"/"query" calls, so a later task (staleness
// correlation when a fast-typed query outraces a stale one) depends on it existing.
export type PopulationQueryWorkerRequest =
  | { type: "load"; requestId: number; rawJsonText: string }
  | { type: "query"; requestId: number; params: PopulationQueryParams };

export type PopulationQueryWorkerResponse =
  | { type: "loaded"; requestId: number; totalRows: number }
  | { type: "result"; requestId: number; result: PopulationQueryResult<Record<string, unknown>> }
  | { type: "error"; requestId: number; error: string };
