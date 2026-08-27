import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isDemoDebugEnabled,
  setDemoDebugEnabled,
  subscribeDemoDebugEnabled,
  __resetDemoDebugStoreForTests,
} from "./demoDebugStore";

describe("demoDebugStore", () => {
  afterEach(() => {
    __resetDemoDebugStoreForTests();
  });

  it("starts disabled", () => {
    expect(isDemoDebugEnabled()).toBe(false);
  });

  it("toggles and notifies subscribers only on an actual change", () => {
    const fn = vi.fn();
    subscribeDemoDebugEnabled(fn);

    setDemoDebugEnabled(true);
    expect(isDemoDebugEnabled()).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);

    // Setting the same value again must not notify — same shape as every
    // other plain pub/sub store in this codebase (see dataRefreshSignal.ts).
    setDemoDebugEnabled(true);
    expect(fn).toHaveBeenCalledTimes(1);

    setDemoDebugEnabled(false);
    expect(isDemoDebugEnabled()).toBe(false);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("unsubscribe stops further notifications", () => {
    const fn = vi.fn();
    const unsubscribe = subscribeDemoDebugEnabled(fn);
    unsubscribe();
    setDemoDebugEnabled(true);
    expect(fn).not.toHaveBeenCalled();
  });
});
