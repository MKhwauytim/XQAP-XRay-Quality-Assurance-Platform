// Test-only stub for the Vite `?worker&inline` import of
// `src/workers/populationQueryWorker.ts`. Not imported by any application code —
// it lives under src/ (rather than a tests/ tree) for the same reason
// `src/data/storage/memoryDirectory.ts` does: it is a typed, lint-checked test
// double that mirrors a real runtime contract and must not drift from it.
//
// WHY THIS EXISTS (and why it must NOT reply on a microtask)
// ---------------------------------------------------------
// Vitest's node/jsdom environment cannot run a real DedicatedWorker (same
// WORKER BOUNDARY limitation documented in Population.wizard.test.tsx and
// populationQueryWorker.test.ts), so component tests mock the worker import.
// Earlier stubs replied on a microtask (`Promise.resolve().then(...)`), which is
// **impossible for a real worker**: a real `postMessage` reply can never be
// delivered before the caller's own synchronous continuation has finished and
// React has flushed the state updates that continuation queued. That unrealistic
// head start silently hid two Critical bugs in the worker-backed Browse path
// (the load response being judged "stale" by a query posted in the same tick,
// and the main table's query being superseded by the filter-dropdown preview's
// unrelated queries).
//
// This stub therefore replies on a **macrotask** (`setTimeout`), and drains its
// inbox **serially, one message per tick**, mirroring the two properties a real
// DedicatedWorker actually guarantees:
//   1. a reply is never delivered synchronously (or on a microtask) relative to
//      the `postMessage` call that produced it, and
//   2. messages are processed in the order they were posted, one at a time.
// The pure `handleWorkerMessage` it runs is the exact same function the real
// worker's `onmessage` runs, so behavior (not just timing) stays faithful.

import {
  createInitialWorkerState,
  handleWorkerMessage,
} from "../../../../workers/populationQueryWorker";
import type { PopulationQueryWorkerRequest } from "../../../../workers/populationQueryWorkerTypes";

/**
 * Builds the stub class a `vi.mock(".../populationQueryWorker?worker&inline")`
 * factory should hand back as its `default` export.
 *
 * `replyDelayMs` defaults to 25ms rather than 0. A 0ms (or 1ms) timer is
 * *technically* a macrotask but is queued the instant `postMessage` is called,
 * and measurably still beats React's own scheduled re-render in this
 * environment (~3ms) — which no real worker ever can, since a real reply costs
 * at minimum a thread hop plus the worker's own JSON.parse of the whole
 * population file. 25ms leaves a comfortable margin on a slow/loaded machine
 * while keeping a round trip cheap. Erring LARGER is always safe: a longer
 * delay only makes the caller-renders-first ordering more certain, it can never
 * reintroduce the unrealistic ordering. Pass a larger value to widen the window
 * deliberately (e.g. to interleave user events with an in-flight query).
 */
export function createPopulationQueryWorkerStubClass(replyDelayMs = 25) {
  return class PopulationQueryWorkerStub {
    onmessage: ((ev: MessageEvent) => void) | null = null;

    private state = createInitialWorkerState();
    private inbox: PopulationQueryWorkerRequest[] = [];
    private draining = false;
    private terminated = false;

    postMessage(request: PopulationQueryWorkerRequest): void {
      if (this.terminated) {
        return;
      }
      this.inbox.push(request);
      this.scheduleDrain();
    }

    terminate(): void {
      this.terminated = true;
      this.inbox.length = 0;
    }

    addEventListener(): void {}

    removeEventListener(): void {}

    private scheduleDrain(): void {
      if (this.draining) {
        return;
      }
      this.draining = true;
      setTimeout(() => {
        this.draining = false;
        const next = this.inbox.shift();
        if (this.terminated || next === undefined) {
          return;
        }
        const { state, response } = handleWorkerMessage(this.state, next);
        this.state = state;
        this.onmessage?.({ data: response } as MessageEvent);
        if (this.inbox.length > 0) {
          this.scheduleDrain();
        }
      }, replyDelayMs);
    }
  };
}
