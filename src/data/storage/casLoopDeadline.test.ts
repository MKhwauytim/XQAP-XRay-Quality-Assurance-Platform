// Symptom A/E from the 2026-09-13 field reports: "saving an answer takes 4
// minutes", "submitting a ticket takes forever". The arithmetic behind it is in
// operationDeadline.ts — 14 casLoop attempts over safeWriteJson's two ~11 s
// verify-readback ladders is ~308 s of pure sleeping, and NOTHING owned that
// product. Each layer's own budget was defensible; their multiplication was not.
//
// These tests pin the bound casLoop now applies, and — just as important — the
// three things it must NOT change: the first attempt always runs, a success is
// never discarded, and a loop with no deadline keeps its old behaviour exactly.

import { describe, it, expect, vi, afterEach } from "vitest";

import { casLoop } from "./casLoop";
import {
  createDeadline,
  isDeadlineExpired,
  nextRetryDelayMs,
  deadlineRemainingMs,
} from "./operationDeadline";

afterEach(() => {
  vi.useRealTimers();
});

describe("operationDeadline", () => {
  it("treats a missing deadline as unbounded", () => {
    expect(isDeadlineExpired(undefined)).toBe(false);
    expect(deadlineRemainingMs(undefined)).toBe(Number.POSITIVE_INFINITY);
    expect(nextRetryDelayMs(5000, undefined)).toBe(5000);
  });

  it("truncates a delay that would overrun rather than refusing it", () => {
    const deadline = createDeadline(100, "test");
    // The remaining time is still a real chance for the condition to clear, so
    // the rung is shortened, not skipped.
    const delay = nextRetryDelayMs(5000, deadline);
    expect(delay).not.toBeNull();
    expect(delay!).toBeLessThanOrEqual(100);
  });

  it("returns null once the budget is spent", () => {
    const deadline = createDeadline(-1, "test");
    expect(isDeadlineExpired(deadline)).toBe(true);
    expect(nextRetryDelayMs(20, deadline)).toBeNull();
  });
});

describe("casLoop — deadline bounds the retry ladder", () => {
  it("stops retrying once the budget is spent instead of burning all attempts", async () => {
    let attempts = 0;
    const result = await casLoop(
      async () => {
        attempts += 1;
        throw Object.assign(new Error("stale snapshot"), { name: "InvalidStateError" });
      },
      {
        maxRetries: 14,
        baseDelayMs: 150,
        // Already spent: only the first attempt should run.
        deadline: createDeadline(-1, "test:spent"),
        context: "test:bounded",
      }
    );

    expect(attempts).toBe(1);
    expect(result).toMatchObject({ ok: false });
  });

  it("still runs the first attempt — a deadline bounds retries, never the action", async () => {
    // The guard against the obvious over-correction: an already-expired budget
    // must not turn a user's save into a silent no-op.
    let ran = false;
    const result = await casLoop(
      async () => {
        ran = true;
        return { done: true, result: { ok: true as const } };
      },
      { deadline: createDeadline(-1, "test:spent"), context: "test:first-attempt" }
    );

    expect(ran).toBe(true);
    expect(result).toEqual({ ok: true });
  });

  it("never discards a success just because the budget ran out during it", async () => {
    const result = await casLoop(
      async () => {
        // Overruns the budget, then succeeds. The write committed; reporting a
        // failure here would be the same class of bug as the replacement trap.
        await new Promise((resolve) => setTimeout(resolve, 25));
        return { done: true, result: { ok: true as const, value: 7 } };
      },
      { deadline: createDeadline(10, "test:overrun"), context: "test:success-kept" }
    );

    expect(result).toEqual({ ok: true, value: 7 });
  });

  it("uses every attempt when no deadline is supplied (unchanged behaviour)", async () => {
    let attempts = 0;
    await casLoop(
      async () => {
        attempts += 1;
        return { done: false };
      },
      { maxRetries: 4, baseDelayMs: 1, context: "test:unbounded" }
    );

    expect(attempts).toBe(4);
  });

  it("bounds total wall-clock well below the unbounded ladder", async () => {
    // The end-to-end shape of the production bug, scaled down: an attempt that
    // always fails, over a ladder whose rungs would far outlast the budget.
    const started = Date.now();
    let attempts = 0;
    await casLoop(
      async () => {
        attempts += 1;
        throw Object.assign(new Error("stale"), { name: "InvalidStateError" });
      },
      {
        maxRetries: 14,
        baseDelayMs: 200, // unbounded worst case here is ~9 s of sleeping
        deadline: createDeadline(300, "test:budget"),
        context: "test:wallclock",
      }
    );
    const elapsed = Date.now() - started;

    expect(elapsed).toBeLessThan(2000);
    expect(attempts).toBeLessThan(14);
  });
});
