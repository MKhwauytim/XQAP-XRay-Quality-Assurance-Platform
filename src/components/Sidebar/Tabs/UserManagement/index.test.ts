// B9 — UserManagement disk-write coalescing.
//
// `saveUsersToDisk` used to guard the disk write with a bare
// `savingToDiskRef.current` skip: any persistState call that arrived while a
// previous write was still in flight was dropped on the floor -- not queued,
// not retried, just silently lost. Since disk is the sole roster persistence
// (SEC-01 users.permissions.json), that meant a rapid second admin edit could
// vanish permanently. `coalesceToLatest` (exported from ./index) replaces the
// skip-guard: a call that arrives mid-write only overwrites a "pending" slot,
// and the in-flight call drains it (and anything even newer) once it settles.
//
// These tests exercise `coalesceToLatest` directly with a controllable mock
// writer instead of rendering the full tab, so the "two/three rapid
// persistState calls" scenario is deterministic (gated on a manually-resolved
// promise) rather than dependent on real disk-write timing.
import { describe, expect, it, vi } from "vitest";

import { coalesceToLatest } from "./index";

function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("coalesceToLatest", () => {
  it("writes only the latest state when a second persistState-style call arrives mid-write (final disk state = last edit)", async () => {
    const runningRef = { current: false };
    const pendingRef = { current: null as string | null };
    const disk: string[] = [];
    const gate = deferred<void>();

    const run = vi.fn(async (value: string) => {
      if (value === "edit-A") await gate.promise; // hold the first write open
      disk.push(value);
    });

    // Call 1: "edit A" -- nothing in flight, starts writing immediately and
    // blocks on the gate (simulating a slow disk write still in progress).
    const call1 = coalesceToLatest(runningRef, pendingRef, run, "edit-A");
    // Call 2: "edit B" arrives synchronously while call 1 is still in flight
    // -- exactly the "two rapid persistState calls" scenario.
    const call2 = coalesceToLatest(runningRef, pendingRef, run, "edit-B");

    // The second call must resolve immediately without starting its own
    // write: it only replaces the pending slot.
    await call2;
    expect(run).toHaveBeenCalledTimes(1);
    expect(pendingRef.current).toBe("edit-B");
    expect(disk).toEqual([]);

    // Let the first write land. The in-flight loop must then immediately
    // drain "edit B" on its own, with no further external call.
    gate.resolve();
    await call1;

    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls.map(([value]) => value)).toEqual(["edit-A", "edit-B"]);
    expect(disk).toEqual(["edit-A", "edit-B"]);
    expect(disk.at(-1)).toBe("edit-B");
    expect(runningRef.current).toBe(false);
    expect(pendingRef.current).toBeNull();
  });

  it("coalesces three rapid calls into two writes -- the superseded middle edit is never written on its own", async () => {
    const runningRef = { current: false };
    const pendingRef = { current: null as number | null };
    const written: number[] = [];
    const gate = deferred<void>();

    const run = vi.fn(async (value: number) => {
      if (value === 1) await gate.promise;
      written.push(value);
    });

    const call1 = coalesceToLatest(runningRef, pendingRef, run, 1);
    // Both arrive while call 1 is still blocked on the gate; each overwrites
    // the pending slot, so only the last ("3") should ever survive it.
    await coalesceToLatest(runningRef, pendingRef, run, 2);
    await coalesceToLatest(runningRef, pendingRef, run, 3);
    expect(pendingRef.current).toBe(3);

    gate.resolve();
    await call1;

    expect(run).toHaveBeenCalledTimes(2);
    expect(written).toEqual([1, 3]);
  });

  it("keeps draining a newer queued value even when the in-flight write rejects", async () => {
    const runningRef = { current: false };
    const pendingRef = { current: null as string | null };
    const written: string[] = [];
    const gate = deferred<void>();

    const run = vi.fn(async (value: string) => {
      if (value === "fails") {
        await gate.promise;
        throw new Error("simulated disk write conflict");
      }
      written.push(value);
    });

    const call1 = coalesceToLatest(runningRef, pendingRef, run, "fails");
    const call2 = coalesceToLatest(runningRef, pendingRef, run, "succeeds");

    gate.resolve();
    await Promise.all([call1, call2]);

    // The rejection is swallowed (matches the previous inline try/catch in
    // saveUsersToDisk: "non-fatal — disk save can be retried") and the
    // queued newer value still lands instead of getting stuck forever.
    expect(written).toEqual(["succeeds"]);
    expect(runningRef.current).toBe(false);
    expect(pendingRef.current).toBeNull();
  });

  it("runs a solo call straight through with no pending value left behind", async () => {
    const runningRef = { current: false };
    const pendingRef = { current: null as string | null };
    const run = vi.fn(async () => {});

    await coalesceToLatest(runningRef, pendingRef, run, "only-edit");

    expect(run).toHaveBeenCalledExactlyOnceWith("only-edit");
    expect(runningRef.current).toBe(false);
    expect(pendingRef.current).toBeNull();
  });
});
