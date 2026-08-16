// A Web Worker that DIES sends no message at all. Every worker call site in the
// app awaited a promise that only `onmessage` could settle, so a worker killed
// by the renderer/OS OOM killer left the caller waiting forever:
//
//   - the row lookup's `finally { worker.terminate() }` never ran (leaking the
//     worker) and the replacement confirm dialog spun with no error;
//   - Browse's `isQuerying` never cleared and its XLSX export button stayed
//     dead until a page reload;
//   - the import wizard stayed pinned busy with no error and no log entry.
//
// These are the failures with NO error code at all, which is strictly worse
// than a wrong one: nothing on screen, nothing in the error log.
//
// This suite covers the row lookup, which is the one with a pure data-layer
// seam (`spawnWorker`) and therefore testable without a DOM. It fails against
// the pre-fix code by timing out — the promise never settles.

import { describe, it, expect } from "vitest";

import { findPopulationRowById } from "./populationRowLookup";
import type { PopulationQueryWorkerLike } from "./populationRowLookup";
import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { getPopulationMonthDir } from "../workspace/workspacePaths";
import { safeWriteJson } from "../storage/safeWrite";

const MONTH = "5-May-2026";

/** A worker that accepts messages and then dies, exactly as an OOM kill does. */
function dyingWorker(how: "error" | "messageerror"): PopulationQueryWorkerLike {
  const worker: PopulationQueryWorkerLike = {
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    postMessage: () => {
      // Death is asynchronous, after the caller has registered its handlers.
      queueMicrotask(() => {
        if (how === "error") worker.onerror?.(new Error("worker terminated"));
        else worker.onmessageerror?.(new Event("messageerror"));
      });
    },
    terminate: () => {},
  };
  return worker;
}

async function workspaceWithPopulation(): Promise<DirectoryHandleLike> {
  const root = createMemoryDirectory();
  const monthDir = await getPopulationMonthDir(root, MONTH, true);
  const processed = await monthDir.getDirectoryHandle("2-processed", { create: true });
  await safeWriteJson(processed, "population.final.json", { rows: [] });
  return root;
}

describe("a dead population worker settles the caller instead of hanging", () => {
  it("resolves with a coded failure when the worker errors", async () => {
    const root = await workspaceWithPopulation();

    // Pre-fix this never settled and the test timed out.
    const result = await findPopulationRowById(root, MONTH, "XR-0001", {
      spawnWorker: async () => dyingWorker("error"),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Not silence, and not a raw English worker message: a quotable code with
    // advice that fits the real cause (too much data — split the month).
    expect(result.error).toContain("XQ-POP-007");
  });

  it("resolves the same way on messageerror", async () => {
    // A distinct event: the message was sent but could not be deserialized.
    // Unhandled, it is exactly as silent as `error`.
    const root = await workspaceWithPopulation();

    const result = await findPopulationRowById(root, MONTH, "XR-0001", {
      spawnWorker: async () => dyingWorker("messageerror"),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("XQ-POP-007");
  });

  it("terminates the worker even when it died", async () => {
    // The leak half of the bug: the `finally` that terminates the worker sits
    // after the await, so an unsettled promise leaked the worker too.
    const root = await workspaceWithPopulation();
    let terminated = false;
    const worker = dyingWorker("error");
    worker.terminate = () => {
      terminated = true;
    };

    await findPopulationRowById(root, MONTH, "XR-0001", {
      spawnWorker: async () => worker,
    });

    expect(terminated).toBe(true);
  });
});
