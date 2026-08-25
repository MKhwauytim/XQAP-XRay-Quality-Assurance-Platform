import { afterEach, describe, expect, it, vi } from "vitest";

import {
  __resetUnsavedWorkForTests,
  getDirtyTabIds,
  reportUnsavedWork,
  subscribeToUnsavedWork,
} from "./unsavedWorkRegistry";

afterEach(() => {
  __resetUnsavedWorkForTests();
});

describe("unsavedWorkRegistry", () => {
  it("records and clears which tabs hold unsaved work", () => {
    expect(getDirtyTabIds().size).toBe(0);
    reportUnsavedWork("employee-workspace", true);
    expect([...getDirtyTabIds()]).toEqual(["employee-workspace"]);
    reportUnsavedWork("employee-workspace", false);
    expect(getDirtyTabIds().size).toBe(0);
  });

  it("notifies subscribers only when the value actually changes", () => {
    // A view reports from an effect that re-runs on every render of a dirty
    // state, so a repeated report must not churn the App-level subscription.
    const listener = vi.fn();
    subscribeToUnsavedWork(listener);

    reportUnsavedWork("population", true);
    reportUnsavedWork("population", true);
    reportUnsavedWork("population", true);
    expect(listener).toHaveBeenCalledTimes(1);

    reportUnsavedWork("population", false);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("hands out a snapshot, not the live set", () => {
    reportUnsavedWork("reports", true);
    const snapshot = getDirtyTabIds() as Set<string>;
    snapshot.clear();
    expect([...getDirtyTabIds()]).toEqual(["reports"]);
  });

  it("stops notifying after unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToUnsavedWork(listener);
    unsubscribe();
    reportUnsavedWork("settings", true);
    expect(listener).not.toHaveBeenCalled();
  });
});
