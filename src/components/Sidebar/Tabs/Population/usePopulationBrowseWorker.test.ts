/* @vitest-environment jsdom */
// Phase B (large-population perf proposal) — `usePopulationBrowseWorker` owns the
// Population-Browse query worker's spawn/postMessage/terminate lifecycle plus the
// "latest request wins" staleness guard. Same WORKER BOUNDARY limitation noted in
// Population.wizard.test.tsx / populationQueryWorker.test.ts: Vitest's node/jsdom
// environment cannot run a real DedicatedWorker, so the Vite `?worker&inline` import
// is mocked with a WorkerStub (same shape as those precedents) that additionally
// records posted messages and exposes each constructed instance so tests can drive
// `onmessage` directly to simulate the worker's async replies.

import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";

import type {
  PopulationQueryWorkerRequest,
  PopulationQueryWorkerResponse,
} from "../../../../workers/populationQueryWorkerTypes";
import type {
  PopulationQueryParams,
  PopulationQueryResult,
} from "../../../../data/population/populationQuery";

interface WorkerStubInstance {
  onmessage: ((ev: MessageEvent) => void) | null;
  posted: PopulationQueryWorkerRequest[];
  terminated: boolean;
}

// Populated by the WorkerStub's constructor below — vi.mock's factory is hoisted
// above imports, so this array must be created via vi.hoisted (established pattern:
// see useMonthLoad.workspaceSwitch.test.tsx's `loadCalls`).
const workerInstances = vi.hoisted((): WorkerStubInstance[] => []);

vi.mock("../../../../workers/populationQueryWorker?worker&inline", () => {
  class WorkerStub implements WorkerStubInstance {
    onmessage: ((ev: MessageEvent) => void) | null = null;
    posted: PopulationQueryWorkerRequest[] = [];
    terminated = false;
    constructor() {
      workerInstances.push(this);
    }
    postMessage(msg: PopulationQueryWorkerRequest): void {
      this.posted.push(msg);
    }
    terminate(): void {
      this.terminated = true;
    }
    addEventListener(): void {}
    removeEventListener(): void {}
  }
  return { default: WorkerStub };
});

import { usePopulationBrowseWorker } from "./usePopulationBrowseWorker";

function baseParams(overrides: Partial<PopulationQueryParams> = {}): PopulationQueryParams {
  return { search: "", columnFilters: {}, sort: null, page: 1, ...overrides };
}

function fakeResult(totalRows: number): PopulationQueryResult<Record<string, unknown>> {
  return { pageRows: [{ xrayImageId: String(totalRows) }], totalRows, totalPages: 1 };
}

function respond(instance: WorkerStubInstance, response: PopulationQueryWorkerResponse): void {
  instance.onmessage?.({ data: response } as MessageEvent<PopulationQueryWorkerResponse>);
}

describe("usePopulationBrowseWorker", () => {
  afterEach(() => {
    cleanup();
    workerInstances.length = 0;
    vi.clearAllMocks();
  });

  it("spawns the worker on mount and terminates it on unmount", () => {
    const { unmount } = renderHook(() => usePopulationBrowseWorker());

    expect(workerInstances).toHaveLength(1);
    expect(workerInstances[0].terminated).toBe(false);

    unmount();

    expect(workerInstances[0].terminated).toBe(true);
  });

  it("loadRawJson posts a load message; isLoaded flips true only after a matching loaded response", () => {
    const { result } = renderHook(() => usePopulationBrowseWorker());
    const instance = workerInstances[0];

    act(() => {
      result.current.loadRawJson("RAW_JSON");
    });

    expect(instance.posted).toEqual([{ type: "load", requestId: 1, rawJsonText: "RAW_JSON" }]);
    expect(result.current.isLoaded).toBe(false);

    act(() => {
      respond(instance, { type: "loaded", requestId: 1, totalRows: 3 });
    });

    expect(result.current.isLoaded).toBe(true);
  });

  it("loadRawJson threads stageMappings/monthFolder into the posted request when given options, and omits them entirely when not", () => {
    const { result } = renderHook(() => usePopulationBrowseWorker());
    const instance = workerInstances[0];
    const stageMappings = { first: ["1"], second: ["2"], third: ["3"], fourth: ["4"] };

    act(() => {
      result.current.loadRawJson("RAW_JSON", { stageMappings, monthFolder: "5-may-2026" });
    });
    expect(instance.posted).toEqual([
      { type: "load", requestId: 1, rawJsonText: "RAW_JSON", stageMappings, monthFolder: "5-may-2026" },
    ]);

    act(() => {
      result.current.loadRawJson("RAW_JSON_2");
    });
    // Omitting `options` entirely must post the exact same shape as before this
    // option existed -- no stray `stageMappings`/`monthFolder` keys.
    expect(instance.posted[1]).toEqual({ type: "load", requestId: 2, rawJsonText: "RAW_JSON_2" });
  });

  it("totalRows is set from a matching 'loaded' response's totalRows, and stays null before the first load", () => {
    const { result } = renderHook(() => usePopulationBrowseWorker());
    const instance = workerInstances[0];

    expect(result.current.totalRows).toBeNull();

    act(() => {
      result.current.loadRawJson("RAW_JSON");
    });
    act(() => {
      respond(instance, { type: "loaded", requestId: 1, totalRows: 12345 });
    });

    expect(result.current.totalRows).toBe(12345);
  });

  it("runQuery resolves with the query result on a matching result response", async () => {
    const { result } = renderHook(() => usePopulationBrowseWorker());
    const instance = workerInstances[0];

    let queryPromise!: Promise<PopulationQueryResult<Record<string, unknown>> | null>;
    act(() => {
      queryPromise = result.current.runQuery(baseParams());
    });

    expect(result.current.isQuerying).toBe(true);
    expect(instance.posted).toEqual([{ type: "query", requestId: 1, params: baseParams() }]);

    const expected = fakeResult(5);
    act(() => {
      respond(instance, { type: "result", requestId: 1, result: expected });
    });

    await expect(queryPromise).resolves.toEqual(expected);
    expect(result.current.isQuerying).toBe(false);
  });

  it("a superseded runQuery resolves null when its stale response arrives late, without disturbing the newer call's state", async () => {
    const { result } = renderHook(() => usePopulationBrowseWorker());
    const instance = workerInstances[0];

    let promiseA!: Promise<PopulationQueryResult<Record<string, unknown>> | null>;
    act(() => {
      promiseA = result.current.runQuery(baseParams({ search: "a" }));
    });

    let promiseB!: Promise<PopulationQueryResult<Record<string, unknown>> | null>;
    act(() => {
      promiseB = result.current.runQuery(baseParams({ search: "b" }));
    });

    expect(instance.posted).toEqual([
      { type: "query", requestId: 1, params: baseParams({ search: "a" }) },
      { type: "query", requestId: 2, params: baseParams({ search: "b" }) },
    ]);

    // A's response arrives late, after B was already issued — must be discarded
    // as far as hook state goes, and resolve ONLY promiseA, with null.
    const staleResult = fakeResult(1);
    act(() => {
      respond(instance, { type: "result", requestId: 1, result: staleResult });
    });

    await expect(promiseA).resolves.toBeNull();
    // B is still pending — the stale A response must not have flipped isQuerying
    // or touched error, which belong to the still-in-flight, newer call.
    expect(result.current.isQuerying).toBe(true);
    expect(result.current.error).toBeNull();

    const freshResult = fakeResult(2);
    act(() => {
      respond(instance, { type: "result", requestId: 2, result: freshResult });
    });

    await expect(promiseB).resolves.toEqual(freshResult);
    expect(result.current.isQuerying).toBe(false);
  });

  // C2 regression (unit level): BrowseDataView posts "load" and then, in the very
  // same tick, "query" — no real worker can answer the load before that happens.
  // Gating the "loaded" response on a counter shared with queries therefore threw
  // the load's own reply away, leaving isLoaded/totalRows unset forever and Browse
  // showing its "no data" empty state over a perfectly good month.
  it("applies a 'loaded' response even when a query was already posted after the load", async () => {
    const { result } = renderHook(() => usePopulationBrowseWorker());
    const instance = workerInstances[0];

    act(() => {
      result.current.loadRawJson("RAW_JSON");
      result.current.runQuery(baseParams());
    });

    expect(instance.posted.map((request) => request.requestId)).toEqual([1, 2]);

    // The load's reply (requestId 1) arrives after query 2 was already posted.
    act(() => {
      respond(instance, { type: "loaded", requestId: 1, totalRows: 42 });
    });

    expect(result.current.isLoaded).toBe(true);
    expect(result.current.totalRows).toBe(42);
  });

  // C1 regression (unit level): two callers asking two different, simultaneously
  // valid questions of the same worker must not invalidate each other's answers.
  it("queries on different lanes never supersede each other", async () => {
    const { result } = renderHook(() => usePopulationBrowseWorker());
    const instance = workerInstances[0];

    // Both posted in the same commit, "table" first — exactly what happens when a
    // filter toggle re-runs BrowseDataView's main query effect AND its filter
    // dropdown preview effect.
    let tableQuery!: Promise<PopulationQueryResult<Record<string, unknown>> | null>;
    let previewQuery!: Promise<PopulationQueryResult<Record<string, unknown>> | null>;
    act(() => {
      tableQuery = result.current.runQuery(baseParams(), "table");
      previewQuery = result.current.runQuery(baseParams({ page: 2 }), "preview");
    });

    const tableResult = fakeResult(7);
    const previewResult = fakeResult(9);
    act(() => {
      respond(instance, { type: "result", requestId: 1, result: tableResult });
      respond(instance, { type: "result", requestId: 2, result: previewResult });
    });

    // The table's reply came back while a LATER request (the preview's) existed —
    // it must still be delivered in full, not nulled out as "superseded".
    await expect(tableQuery).resolves.toEqual(tableResult);
    await expect(previewQuery).resolves.toEqual(previewResult);
  });

  it("still supersedes within a single lane, so fast typing only applies the last keystroke's result", async () => {
    const { result } = renderHook(() => usePopulationBrowseWorker());
    const instance = workerInstances[0];

    let first!: Promise<PopulationQueryResult<Record<string, unknown>> | null>;
    let second!: Promise<PopulationQueryResult<Record<string, unknown>> | null>;
    act(() => {
      first = result.current.runQuery(baseParams({ search: "a" }), "table");
      second = result.current.runQuery(baseParams({ search: "ab" }), "table");
    });

    act(() => {
      respond(instance, { type: "result", requestId: 1, result: fakeResult(1) });
    });
    await expect(first).resolves.toBeNull();

    const latest = fakeResult(2);
    act(() => {
      respond(instance, { type: "result", requestId: 2, result: latest });
    });
    await expect(second).resolves.toEqual(latest);
  });

  it("surfaces a load failure (no pending query resolver) through `error`", async () => {
    const { result } = renderHook(() => usePopulationBrowseWorker());
    const instance = workerInstances[0];

    act(() => {
      result.current.loadRawJson("NOT_JSON");
      result.current.runQuery(baseParams());
    });

    act(() => {
      respond(instance, { type: "error", requestId: 1, error: "تعذّر تحليل الملف" });
    });

    // Without this, a corrupt population.final.json left BrowseDataView spinning
    // forever with nothing to show the user.
    expect(result.current.error).toBe("تعذّر تحليل الملف");
  });

  it("a fresh loadRawJson clears the previous dataset's stats and any previous error", async () => {
    const { result } = renderHook(() => usePopulationBrowseWorker());
    const instance = workerInstances[0];

    act(() => {
      result.current.loadRawJson("RAW_JSON");
    });
    act(() => {
      respond(instance, { type: "loaded", requestId: 1, totalRows: 5 });
    });
    act(() => {
      respond(instance, { type: "error", requestId: 1, error: "boom" });
    });
    expect(result.current.totalRows).toBe(5);
    expect(result.current.error).toBe("boom");

    act(() => {
      result.current.loadRawJson("RAW_JSON_2");
    });

    expect(result.current.isLoaded).toBe(false);
    expect(result.current.totalRows).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("an error response sets `error` without crashing, and resolves the pending query promise with null", async () => {
    const { result } = renderHook(() => usePopulationBrowseWorker());
    const instance = workerInstances[0];

    let queryPromise!: Promise<PopulationQueryResult<Record<string, unknown>> | null>;
    act(() => {
      queryPromise = result.current.runQuery(baseParams());
    });

    act(() => {
      respond(instance, { type: "error", requestId: 1, error: "خطأ في المعالجة" });
    });

    await expect(queryPromise).resolves.toBeNull();
    expect(result.current.error).toBe("خطأ في المعالجة");
    expect(result.current.isQuerying).toBe(false);
  });
});
