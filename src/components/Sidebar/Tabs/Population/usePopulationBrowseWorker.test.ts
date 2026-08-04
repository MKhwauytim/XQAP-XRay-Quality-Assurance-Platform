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
