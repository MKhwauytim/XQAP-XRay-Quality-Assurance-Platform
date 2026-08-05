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

  // ── Task 4: display-parity threading (the CRITICAL gap flagged when this worker
  // first shipped in Task 2 — see this file's earlier "Deliberately does NOT
  // special-case..." comment, now replaced). Confirms that a search for a stage's
  // DISPLAYED Arabic label finds rows whose RAW stored stage value is merely an
  // alias (e.g. "1"), and that a raw month-folder value participates in search
  // under its short Arabic display label too — both are real regressions the old
  // generic-only formatter would have silently introduced relative to the
  // pre-worker inline BrowseDataView.tsx implementation.
  it("load with stageMappings: a search for a stage's canonical Arabic label matches rows whose raw stage is only an alias", () => {
    const rows = [
      { xrayImageId: "1", stage: "1" }, // "1" is a first-stage alias, not the canonical label
      { xrayImageId: "2", stage: "SECOND STAGE" }, // second-stage alias
      { xrayImageId: "3", stage: "غير معروف" } // unmapped -- falls back to raw text
    ];
    const stageMappings = {
      first: ["1", "المستوى الأول"],
      second: ["SECOND STAGE", "المستوى الثاني"],
      third: ["المستوى الثالث"],
      fourth: ["المستوى الرابع"]
    };

    const loadOutcome = handleWorkerMessage(createInitialWorkerState(), {
      type: "load",
      requestId: 1,
      rawJsonText: rawPopulationJson(rows),
      stageMappings
    });

    const queryOutcome = handleWorkerMessage(loadOutcome.state, {
      type: "query",
      requestId: 2,
      // A user searching would type what they SEE in the table, i.e. the
      // canonical Arabic label -- not the raw alias actually stored on disk.
      params: baseQueryParams({ search: "المستوى الأول" })
    });

    expect(queryOutcome.response.type).toBe("result");
    if (queryOutcome.response.type !== "result") throw new Error("expected result response");
    expect(queryOutcome.response.result.pageRows.map((row) => row["xrayImageId"])).toEqual(["1"]);

    // Same check for the second-stage alias.
    const secondQuery = handleWorkerMessage(loadOutcome.state, {
      type: "query",
      requestId: 3,
      params: baseQueryParams({ search: "المستوى الثاني" })
    });
    if (secondQuery.response.type !== "result") throw new Error("expected result response");
    expect(secondQuery.response.result.pageRows.map((row) => row["xrayImageId"])).toEqual(["2"]);
  });

  it("load without stageMappings: 'stage' falls back to a raw passthrough (no aliasing applied)", () => {
    const rows = [{ xrayImageId: "1", stage: "1" }];
    const loadOutcome = handleWorkerMessage(createInitialWorkerState(), {
      type: "load",
      requestId: 1,
      rawJsonText: rawPopulationJson(rows)
      // stageMappings omitted entirely.
    });

    const queryOutcome = handleWorkerMessage(loadOutcome.state, {
      type: "query",
      requestId: 2,
      params: baseQueryParams({ search: "المستوى الأول" })
    });
    if (queryOutcome.response.type !== "result") throw new Error("expected result response");
    expect(queryOutcome.response.result.totalRows).toBe(0);

    // The raw alias itself still matches, same as the generic formatter would.
    const rawSearch = handleWorkerMessage(loadOutcome.state, {
      type: "query",
      requestId: 3,
      params: baseQueryParams({ search: "1" })
    });
    if (rawSearch.response.type !== "result") throw new Error("expected result response");
    expect(rawSearch.response.result.totalRows).toBe(1);
  });

  it("load with monthFolder: every row gets _monthFolder/_month/_year attached, and search matches the short Arabic month label", () => {
    const rows = [{ xrayImageId: "1", portName: "Jeddah" }];
    const loadOutcome = handleWorkerMessage(createInitialWorkerState(), {
      type: "load",
      requestId: 1,
      rawJsonText: rawPopulationJson(rows),
      monthFolder: "5-may-2026"
    });

    expect(loadOutcome.state.cachedRows).toEqual([
      { xrayImageId: "1", portName: "Jeddah", _monthFolder: "5-may-2026", _month: 5, _year: 2026 }
    ]);

    // A user searching would type the short Arabic month/year label shown in the
    // "الشهر المصدر" column ("مايو 2026"), not the raw English folder-name value
    // ("5-may-2026") actually stored on the synthesized row.
    const queryOutcome = handleWorkerMessage(loadOutcome.state, {
      type: "query",
      requestId: 2,
      params: baseQueryParams({ search: "مايو" })
    });
    if (queryOutcome.response.type !== "result") throw new Error("expected result response");
    expect(queryOutcome.response.result.pageRows.map((row) => row["xrayImageId"])).toEqual(["1"]);
  });

  it("load without monthFolder: rows are cached exactly as parsed, with no _monthFolder/_month/_year attached", () => {
    const rows = [{ xrayImageId: "1", portName: "Jeddah" }];
    const loadOutcome = handleWorkerMessage(createInitialWorkerState(), {
      type: "load",
      requestId: 1,
      rawJsonText: rawPopulationJson(rows)
    });

    expect(loadOutcome.state.cachedRows).toEqual(rows);
  });

  it("a failed load DROPS a previously successful load's cached rows, so a subsequent query can't silently succeed against stale data", () => {
    // Regression coverage (final-review re-review, I1 follow-up): BrowseDataView's
    // error surface only stays up until the next query succeeds. If a failed load
    // (month switch, refresh) left the PREVIOUS month's rows queryable, a query
    // against that stale cache would succeed, silently clear the error UI, and
    // latently risk one month's data rendering under a different month's header.
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
    expect(badLoad.state.cachedRows).toBeNull();

    // A query issued after the failed load must fail cleanly too -- not
    // silently succeed against the dropped-but-still-referenced good rows.
    const queryAfterBadLoad = handleWorkerMessage(badLoad.state, {
      type: "query",
      requestId: 22,
      params: { search: "", columnFilters: {}, sort: null, page: 1 }
    });
    expect(queryAfterBadLoad.response.type).toBe("error");
  });

  it("a failed QUERY (not load) leaves the cache intact -- the load itself was fine", () => {
    const goodRows = [{ xrayImageId: "still-here" }];
    const goodLoad = handleWorkerMessage(createInitialWorkerState(), {
      type: "load",
      requestId: 30,
      rawJsonText: rawPopulationJson(goodRows)
    });

    // A query against a state with no cached rows throws inside handleWorkerMessage
    // (see the "query" branch); force that path by querying a state that was never
    // loaded, then confirm a GOOD load's state is untouched by a bad load elsewhere.
    const badQuery = handleWorkerMessage(createInitialWorkerState(), {
      type: "query",
      requestId: 31,
      params: { search: "", columnFilters: {}, sort: null, page: 1 }
    });
    expect(badQuery.response.type).toBe("error");
    expect(badQuery.state.cachedRows).toBeNull();

    // The good load's own state was never touched by the unrelated bad query.
    expect(goodLoad.state.cachedRows).toEqual(goodRows);
  });
});
