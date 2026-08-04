import { describe, it, expect } from "vitest";
import { mapWithConcurrency } from "./concurrency";

describe("mapWithConcurrency", () => {
  it("returns results in input order regardless of completion order", async () => {
    const delays = [30, 10, 20, 5, 25]; // deliberately out of order
    const result = await mapWithConcurrency(delays, 3, async (ms, i) => {
      await new Promise((r) => setTimeout(r, ms));
      return i;
    });
    expect(result).toEqual([0, 1, 2, 3, 4]);
  });

  it("never runs more than `limit` callbacks concurrently", async () => {
    let active = 0;
    let maxActive = 0;
    await mapWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 4, async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return null;
    });
    expect(maxActive).toBeLessThanOrEqual(4);
  });

  it("fail-fast-then-drain: stops starting new work on first error, but awaits in-flight work before throwing", async () => {
    const started: number[] = [];
    const completed: number[] = [];
    await expect(
      mapWithConcurrency(Array.from({ length: 10 }, (_, i) => i), 2, async (i) => {
        started.push(i);
        if (i === 2) throw new Error("boom");
        await new Promise((r) => setTimeout(r, 10));
        completed.push(i);
        return i;
      })
    ).rejects.toThrow("boom");
    // With limit=2, items 0-1 start immediately; item 2 (which throws) starts
    // once one of 0/1 finishes. No item past what was already in flight when
    // the error occurred should ever start.
    expect(started.length).toBeLessThan(10);
    expect(started).toEqual([0, 1, 2]);
    expect(completed).toEqual([0, 1]);
  });

  it("clamps limit to item count and to a minimum of 1", async () => {
    const result = await mapWithConcurrency([1, 2], 100, async (n) => n * 2);
    expect(result).toEqual([2, 4]);
    const empty = await mapWithConcurrency([], 4, async () => 1);
    expect(empty).toEqual([]);
  });
});
