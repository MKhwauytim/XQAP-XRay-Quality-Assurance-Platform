/* @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";

import { useQueryRefreshBridge } from "./queryRefreshBridge";
import { broadcastDataRefresh, type DataRefreshFamily } from "../workspace/dataRefreshSignal";

describe("useQueryRefreshBridge — H6 narrowed invalidation", () => {
  let queryClient: QueryClient;
  let invalidateSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    queryClient = new QueryClient();
    invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
  });

  afterEach(() => {
    invalidateSpy.mockRestore();
  });

  it("a manual broadcast still invalidates everything (unscoped)", () => {
    renderHook(() => useQueryRefreshBridge(queryClient));
    broadcastDataRefresh("manual");
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
    expect(invalidateSpy).toHaveBeenCalledWith();
  });

  it("a periodic broadcast whose changed set maps to a known family invalidates only that scoped key", () => {
    renderHook(() => useQueryRefreshBridge(queryClient));
    broadcastDataRefresh({ source: "periodic", changed: new Set<DataRefreshFamily>(["manifest"]) });
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["monthFolders"] });
  });

  it("a periodic broadcast whose changed set has no mapped family invalidates nothing at all", () => {
    renderHook(() => useQueryRefreshBridge(queryClient));
    broadcastDataRefresh({ source: "periodic", changed: new Set<DataRefreshFamily>(["distribution", "notifications"]) });
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it("two consecutive empty-change-set ticks issue zero invalidateQueries calls (A7 + H6 DONE criterion)", () => {
    renderHook(() => useQueryRefreshBridge(queryClient));
    broadcastDataRefresh({ source: "periodic", changed: new Set<DataRefreshFamily>() });
    broadcastDataRefresh({ source: "periodic", changed: new Set<DataRefreshFamily>() });
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it("unsubscribes on unmount -- no invalidation after the hook is torn down", () => {
    const { unmount } = renderHook(() => useQueryRefreshBridge(queryClient));
    unmount();
    broadcastDataRefresh("manual");
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
