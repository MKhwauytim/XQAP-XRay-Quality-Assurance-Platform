/* @vitest-environment jsdom */
// NOTE: the plan this shipped with described this file as running in the
// `node` default environment. Verified against this repo's actual Vitest
// config: `node` provides no `localStorage` global at all (Node 22 does not
// expose it without an experimental flag), so a bare `localStorage.getItem`
// call throws `ReferenceError` outside jsdom. `uiScaleStore.test.ts` -- the
// file this is modelled on -- carries the same jsdom pragma for the same
// reason, so this file follows it rather than the plan's parenthetical.
import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_QUEUE_SPLIT, MAX_QUEUE_SPLIT, MIN_QUEUE_SPLIT, QUEUE_SPLIT_STORAGE_KEY,
  __resetQueueSplitCacheForTests, getQueueSplit, isQueueSplitCustomized,
  resetQueueSplit, setQueueSplit, subscribeToQueueSplit,
} from "./queueSplitStore";

describe("queueSplitStore", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetQueueSplitCacheForTests();
  });

  it("defaults to the ratio the fixed 1.15fr/1fr grid always rendered", () => {
    expect(getQueueSplit()).toBeCloseTo(DEFAULT_QUEUE_SPLIT, 4);
  });

  it("clamps out of range values instead of storing them", () => {
    expect(setQueueSplit(0.99)).toBe(MAX_QUEUE_SPLIT);
    expect(setQueueSplit(0.01)).toBe(MIN_QUEUE_SPLIT);
  });

  it("refuses a non-finite value rather than putting an invalid track on the grid", () => {
    // A hand-edited or half-written key must never be able to produce
    // `grid-template-columns: minmax(340px, NaN%)`, which drops the whole
    // declaration and collapses the layout — the same reasoning as
    // uiScaleStore's guard against `zoom: 0`.
    setQueueSplit(0.4);
    localStorage.setItem(QUEUE_SPLIT_STORAGE_KEY, '"not a number"');
    __resetQueueSplitCacheForTests();
    expect(getQueueSplit()).toBe(DEFAULT_QUEUE_SPLIT);
  });

  it("survives a reload", () => {
    setQueueSplit(0.62);
    __resetQueueSplitCacheForTests();
    expect(getQueueSplit()).toBeCloseTo(0.62, 4);
  });

  it("removes the key rather than storing the default", () => {
    setQueueSplit(0.62);
    resetQueueSplit();
    expect(localStorage.getItem(QUEUE_SPLIT_STORAGE_KEY)).toBeNull();
    expect(isQueueSplitCustomized()).toBe(false);
  });

  it("notifies subscribers, and stops after unsubscribe", () => {
    let calls = 0;
    const stop = subscribeToQueueSplit(() => { calls += 1; });
    setQueueSplit(0.6);
    expect(calls).toBe(1);
    stop();
    setQueueSplit(0.4);
    expect(calls).toBe(1);
  });
});
