// Item 1.12 — resolving ONE population row by id without a main-thread JSON.parse.
//
// Two layers are covered here:
//  1. the worker's own `rowById` branch, via the pure `handleWorkerMessage` (no
//     Worker environment needed — the same seam populationQueryWorker.test.ts uses);
//  2. `findPopulationRowById`, driven against the shared worker stub, which runs that
//     same real handler on a macrotask. The stub is injected through the function's
//     own `spawnWorker` option rather than `vi.mock`, so this suite needs neither
//     jsdom nor Vite's `?worker&inline` resolution.

import { describe, it, expect } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import { safeWriteJson } from "../storage/safeWrite";
import { getPopulationMonthDir, POPULATION_SUBFOLDERS } from "../workspace/workspacePaths";
import { createInitialWorkerState, handleWorkerMessage } from "../../workers/populationQueryWorker";
import { createPopulationQueryWorkerStubClass } from "../../components/Sidebar/Tabs/Population/populationQueryWorkerTestStub";
import { findPopulationRowById, type PopulationQueryWorkerLike } from "./populationRowLookup";

const MONTH = "5-May-2026";

const ROWS = [
  { xrayImageId: "XR-1", portName: "ميناء جدة الإسلامي", stage: "L1" },
  { xrayImageId: "XR-2", portName: "ميناء الدمام", stage: "L2" },
];

async function makeWorkspaceWithPopulation(rows: unknown[] = ROWS) {
  const root = createMemoryDirectory();
  const monthDir = await getPopulationMonthDir(root, MONTH, true);
  const processed = await monthDir.getDirectoryHandle(POPULATION_SUBFOLDERS.processed, {
    create: true,
  });
  await safeWriteJson(processed, "population.final.json", { rows });
  return root;
}

const spawnStub = () => {
  const StubClass = createPopulationQueryWorkerStubClass(1);
  return () => Promise.resolve(new StubClass() as unknown as PopulationQueryWorkerLike);
};

describe("populationQueryWorker — rowById branch", () => {
  it("returns the matching row after a load", () => {
    const loaded = handleWorkerMessage(createInitialWorkerState(), {
      type: "load",
      requestId: 1,
      rawJsonText: JSON.stringify({ rows: ROWS }),
    });

    const { response } = handleWorkerMessage(loaded.state, {
      type: "rowById",
      requestId: 2,
      xrayImageId: "XR-2",
    });

    expect(response).toEqual({ type: "row", requestId: 2, row: ROWS[1] });
  });

  it("answers a miss with row:null, NOT an error", () => {
    // The distinction is load-bearing: callers show the "stale candidate" message on
    // a miss but must not treat it as a lookup failure.
    const loaded = handleWorkerMessage(createInitialWorkerState(), {
      type: "load",
      requestId: 1,
      rawJsonText: JSON.stringify({ rows: ROWS }),
    });

    const { response } = handleWorkerMessage(loaded.state, {
      type: "rowById",
      requestId: 2,
      xrayImageId: "XR-nope",
    });

    expect(response).toEqual({ type: "row", requestId: 2, row: null });
  });

  it("errors when asked before any load, and leaves the cache alone", () => {
    const state = createInitialWorkerState();
    const { state: after, response } = handleWorkerMessage(state, {
      type: "rowById",
      requestId: 1,
      xrayImageId: "XR-1",
    });

    expect(response.type).toBe("error");
    // Only a failed "load" is allowed to clear cachedRows; a failed lookup must not.
    expect(after.cachedRows).toBeNull();
  });

  it("matches on the raw id field, not on a display value elsewhere in the row", () => {
    // Guards the reason this is not expressed as a "query" with a search param:
    // search matches display values across every column, so this row would be a
    // false positive for id "XR-1".
    const rows = [{ xrayImageId: "XR-9", riskMessage: "مطابقة مع XR-1" }];
    const loaded = handleWorkerMessage(createInitialWorkerState(), {
      type: "load",
      requestId: 1,
      rawJsonText: JSON.stringify({ rows }),
    });

    const { response } = handleWorkerMessage(loaded.state, {
      type: "rowById",
      requestId: 2,
      xrayImageId: "XR-1",
    });

    expect(response).toEqual({ type: "row", requestId: 2, row: null });
  });
});

describe("findPopulationRowById", () => {
  it("resolves a row through the worker", async () => {
    const root = await makeWorkspaceWithPopulation();
    const result = await findPopulationRowById(root, MONTH, "XR-2", { spawnWorker: spawnStub() });

    expect(result).toEqual({ ok: true, row: ROWS[1] });
  });

  it("reports a miss as ok with a null row", async () => {
    const root = await makeWorkspaceWithPopulation();
    const result = await findPopulationRowById(root, MONTH, "XR-absent", {
      spawnWorker: spawnStub(),
    });

    expect(result).toEqual({ ok: true, row: null });
  });

  it("does NOT attach _monthFolder/_month/_year to the returned row", async () => {
    // Parity guard. loadMonthPopulationFinal — the accessor this replaced — does not
    // run rows through appendMonthInfo, unlike its siblings in populationStorage.ts.
    // The resolved row is written straight into sample.master, so gaining three
    // synthesized fields here would silently change what gets persisted.
    const root = await makeWorkspaceWithPopulation();
    const result = await findPopulationRowById(root, MONTH, "XR-1", { spawnWorker: spawnStub() });

    expect(result.ok && result.row).toBeTruthy();
    expect(Object.keys(result.ok ? result.row! : {})).toEqual(Object.keys(ROWS[0]));
  });

  it("fails cleanly when the month has no population file", async () => {
    const root = createMemoryDirectory();
    const result = await findPopulationRowById(root, MONTH, "XR-1", { spawnWorker: spawnStub() });

    expect(result.ok).toBe(false);
  });

  it("surfaces a worker error when the stored file cannot be parsed", async () => {
    const root = createMemoryDirectory();
    const monthDir = await getPopulationMonthDir(root, MONTH, true);
    const processed = await monthDir.getDirectoryHandle(POPULATION_SUBFOLDERS.processed, {
      create: true,
    });
    const handle = await processed.getFileHandle("population.final.json", { create: true });
    const writable = await handle.createWritable!();
    await writable.write("{ not json");
    await writable.close();

    const result = await findPopulationRowById(root, MONTH, "XR-1", { spawnWorker: spawnStub() });

    expect(result.ok).toBe(false);
  });

  it("terminates the worker once the lookup settles", async () => {
    const root = await makeWorkspaceWithPopulation();
    const StubClass = createPopulationQueryWorkerStubClass(1);
    const instance = new StubClass() as unknown as PopulationQueryWorkerLike & {
      terminate: () => void;
    };
    let terminated = false;
    const realTerminate = instance.terminate.bind(instance);
    instance.terminate = () => {
      terminated = true;
      realTerminate();
    };

    await findPopulationRowById(root, MONTH, "XR-1", {
      spawnWorker: () => Promise.resolve(instance),
    });

    // A leaked worker per replacement confirm would accumulate a full parsed
    // population copy each time.
    expect(terminated).toBe(true);
  });
});
