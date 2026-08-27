import { describe, expect, it, vi } from "vitest";
import { createRingBufferStore } from "./ringBufferStore";

describe("createRingBufferStore", () => {
  it("keeps at most maxEntries, dropping the oldest first", () => {
    const store = createRingBufferStore<number>(3);
    store.push(1);
    store.push(2);
    store.push(3);
    store.push(4);
    expect(store.getAll()).toEqual([2, 3, 4]);
  });

  it("notifies subscribers on push and clear, and unsubscribe stops further notifications", () => {
    const store = createRingBufferStore<number>(5);
    const fn = vi.fn();
    const unsubscribe = store.subscribe(fn);

    store.push(1);
    expect(fn).toHaveBeenCalledTimes(1);

    unsubscribe();
    store.push(2);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("clear empties the buffer and notifies", () => {
    const store = createRingBufferStore<number>(5);
    store.push(1);
    store.push(2);
    const fn = vi.fn();
    store.subscribe(fn);
    store.clear();
    expect(store.getAll()).toEqual([]);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("returns a referentially stable snapshot between notifications (useSyncExternalStore contract)", () => {
    const store = createRingBufferStore<number>(5);
    store.push(1);
    const a = store.getAll();
    const b = store.getAll();
    expect(a).toBe(b);
    store.push(2);
    const c = store.getAll();
    expect(c).not.toBe(a);
  });
});
