import { describe, expect, it } from "vitest";
import { createInitialWorkerState, handleWorkerMessage } from "./populationQueryWorker";
import type { PopulationQueryParams } from "../data/population/populationQuery";
import type { PopulationQueryWorkerRequest } from "./populationQueryWorkerTypes";

// This worker cannot be exercised through a real postMessage round-trip — Vitest's
// node/jsdom environment cannot run a real DedicatedWorker (same limitation noted in
// Population.wizard.test.tsx's WORKER BOUNDARY comment for workbookWorker.ts). So
// these tests drive the extracted pure `handleWorkerMessage` function directly,
// threading state through exactly the way `ctx.onmessage` does at runtime.

function baseQueryParams(overrides: Partial<PopulationQueryParams> = {}): PopulationQueryParams {
  return {
    search: "",
    columnFilters: {},
    sort: null,
    page: 1,
    ...overrides
  };
}

function rawPopulationJson(rows: Array<Record<string, unknown>>): string {
  // Matches the real on-disk shape written by safeWriteJson: a JsonEnvelope wrapping
  // PopulationFinalData, with the rows array at `.data.rows`.
  return JSON.stringify({
    metadata: {
      schemaVersion: 1,
      revision: 1,
      contentHash: "irrelevant-for-this-test",
      writtenAt: "2026-08-04T00:00:00.000Z"
    },
    data: {
      sourceMonthFolder: "8-August-2026",
      processedAt: "2026-08-04T00:00:00.000Z",
      processedBy: "tester",
      totalRows: rows.length,
      certScanRows: rows.length,
      nonCertScanRows: 0,
      rows
    }
  });
}

describe("populationQueryWorker — handleWorkerMessage", () => {
  it("load then query: parses the envelope, caches rows, and answers a query against them", () => {
    const rows = [
      { xrayImageId: "1", portName: "Jeddah" },
      { xrayImageId: "2", portName: "Dammam" },
      { xrayImageId: "3", portName: "Jeddah" }
    ];

    const loadRequest: PopulationQueryWorkerRequest = {
      type: "load",
      requestId: 1,
      rawJsonText: rawPopulationJson(rows)
    };
    const loadOutcome = handleWorkerMessage(createInitialWorkerState(), loadRequest);

    expect(loadOutcome.response).toEqual({ type: "loaded", requestId: 1, totalRows: 3 });
    expect(loadOutcome.state.cachedRows).toEqual(rows);

    const queryRequest: PopulationQueryWorkerRequest = {
      type: "query",
      requestId: 2,
      params: baseQueryParams({ search: "jeddah" })
    };
    const queryOutcome = handleWorkerMessage(loadOutcome.state, queryRequest);

    expect(queryOutcome.response.type).toBe("result");
    if (queryOutcome.response.type !== "result") throw new Error("expected result response");
    expect(queryOutcome.response.requestId).toBe(2);
    expect(queryOutcome.response.result.totalRows).toBe(2);
    expect(queryOutcome.response.result.pageRows.map((row) => row["xrayImageId"])).toEqual(["1", "3"]);
    // Querying must not mutate cached state.
    expect(queryOutcome.state.cachedRows).toEqual(rows);
  });

  it("query before any load: replies with an error response instead of throwing", () => {
    const queryRequest: PopulationQueryWorkerRequest = {
      type: "query",
      requestId: 5,
      params: baseQueryParams()
    };

    const outcome = handleWorkerMessage(createInitialWorkerState(), queryRequest);

    expect(outcome.response.type).toBe("error");
    if (outcome.response.type !== "error") throw new Error("expected error response");
    expect(outcome.response.requestId).toBe(5);
    expect(typeof outcome.response.error).toBe("string");
    expect(outcome.response.error.length).toBeGreaterThan(0);
    // State is unchanged — still nothing cached.
    expect(outcome.state.cachedRows).toBeNull();
  });

  it("malformed JSON on load: replies with an error response instead of throwing", () => {
    const loadRequest: PopulationQueryWorkerRequest = {
      type: "load",
      requestId: 7,
      rawJsonText: "{ this is not valid JSON"
    };

    const outcome = handleWorkerMessage(createInitialWorkerState(), loadRequest);

    expect(outcome.response.type).toBe("error");
    if (outcome.response.type !== "error") throw new Error("expected error response");
    expect(outcome.response.requestId).toBe(7);
    expect(outcome.response.error.length).toBeGreaterThan(0);
    // Failed load must not leave stale/partial cached rows.
    expect(outcome.state.cachedRows).toBeNull();
  });

  it("two sequential loads: the second load fully replaces the first's cached rows", () => {
    const firstRows = [{ xrayImageId: "a" }, { xrayImageId: "b" }];
    const secondRows = [{ xrayImageId: "z" }];

    const firstLoad = handleWorkerMessage(createInitialWorkerState(), {
      type: "load",
      requestId: 10,
      rawJsonText: rawPopulationJson(firstRows)
    });
    expect(firstLoad.response).toEqual({ type: "loaded", requestId: 10, totalRows: 2 });

    const secondLoad = handleWorkerMessage(firstLoad.state, {
      type: "load",
      requestId: 11,
      rawJsonText: rawPopulationJson(secondRows)
    });
    expect(secondLoad.response).toEqual({ type: "loaded", requestId: 11, totalRows: 1 });
    expect(secondLoad.state.cachedRows).toEqual(secondRows);

    const queryAfterSecondLoad = handleWorkerMessage(secondLoad.state, {
      type: "query",
      requestId: 12,
      params: baseQueryParams()
    });
    expect(queryAfterSecondLoad.response.type).toBe("result");
    if (queryAfterSecondLoad.response.type !== "result") throw new Error("expected result response");
    expect(queryAfterSecondLoad.response.result.totalRows).toBe(1);
    expect(queryAfterSecondLoad.response.result.pageRows.map((row) => row["xrayImageId"])).toEqual(["z"]);
  });

  it("a failed load does not clobber a previously successful load's cached rows", () => {
    const goodRows = [{ xrayImageId: "keep-me" }];

    const goodLoad = handleWorkerMessage(createInitialWorkerState(), {
      type: "load",
      requestId: 20,
      rawJsonText: rawPopulationJson(goodRows)
    });

    const badLoad = handleWorkerMessage(goodLoad.state, {
      type: "load",
      requestId: 21,
      rawJsonText: "not json at all"
    });

    expect(badLoad.response.type).toBe("error");
    expect(badLoad.state.cachedRows).toEqual(goodRows);
  });
});
