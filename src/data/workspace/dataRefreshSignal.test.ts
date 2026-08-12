/* @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import {
  ALL_DATA_REFRESH_FAMILIES,
  broadcastDataRefresh,
  subscribeToDataChange,
  subscribeToDataRefresh,
  type DataRefreshDetail,
  type DataRefreshFamily,
} from "./dataRefreshSignal";

describe("dataRefreshSignal", () => {
  it("notifies a subscriber when a refresh is broadcast", () => {
    const callback = vi.fn();
    const unsubscribe = subscribeToDataRefresh(callback);

    broadcastDataRefresh();

    expect(callback).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it("notifies every subscriber, in any number", () => {
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = subscribeToDataRefresh(first);
    const unsubscribeSecond = subscribeToDataRefresh(second);

    broadcastDataRefresh();

    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    unsubscribeFirst();
    unsubscribeSecond();
  });

  it("stops notifying once unsubscribed", () => {
    const callback = vi.fn();
    const unsubscribe = subscribeToDataRefresh(callback);
    unsubscribe();

    broadcastDataRefresh();

    expect(callback).not.toHaveBeenCalled();
  });

  it("passes 'manual' as the default source when broadcastDataRefresh is called with no argument", () => {
    const spy = vi.fn();
    const unsubscribe = subscribeToDataRefresh(spy);
    broadcastDataRefresh();
    expect(spy).toHaveBeenCalledWith("manual");
    unsubscribe();
  });

  it("passes the explicit source through to subscribers", () => {
    const spy = vi.fn();
    const unsubscribe = subscribeToDataRefresh(spy);
    broadcastDataRefresh("periodic");
    expect(spy).toHaveBeenCalledWith("periodic");
    unsubscribe();
  });

  it("still supports zero-arg subscriber callbacks (existing consumers ignore the source)", () => {
    const spy = vi.fn<() => void>();
    const unsubscribe = subscribeToDataRefresh(spy);
    broadcastDataRefresh("periodic");
    expect(spy).toHaveBeenCalled();
    unsubscribe();
  });
});

describe("dataRefreshSignal — change-set contract (§4.2)", () => {
  it("subscribeToDataChange fires on manual regardless of the requested families", () => {
    const spy = vi.fn<(detail: DataRefreshDetail) => void>();
    const unsubscribe = subscribeToDataChange(["distribution"], spy);
    broadcastDataRefresh({ source: "manual" });
    expect(spy).toHaveBeenCalledWith({ source: "manual" });
    unsubscribe();
  });

  it("subscribeToDataChange fires on a periodic broadcast only when a requested family changed", () => {
    const distributionSpy = vi.fn();
    const notificationsSpy = vi.fn();
    const unsubDist = subscribeToDataChange(["distribution"], distributionSpy);
    const unsubNotif = subscribeToDataChange(["notifications"], notificationsSpy);

    broadcastDataRefresh({ source: "periodic", changed: new Set<DataRefreshFamily>(["distribution"]) });

    expect(distributionSpy).toHaveBeenCalledTimes(1);
    expect(notificationsSpy).not.toHaveBeenCalled();
    unsubDist();
    unsubNotif();
  });

  it("subscribeToDataChange passes the full changed set through, not just the intersection", () => {
    const spy = vi.fn<(detail: DataRefreshDetail) => void>();
    const unsubscribe = subscribeToDataChange(["answers"], spy);
    broadcastDataRefresh({ source: "periodic", changed: new Set<DataRefreshFamily>(["answers", "manifest"]) });
    expect(spy).toHaveBeenCalledWith({ source: "periodic", changed: new Set<DataRefreshFamily>(["answers", "manifest"]) });
    unsubscribe();
  });

  it("subscribeToDataChange does not fire when the change set is empty", () => {
    const spy = vi.fn();
    const unsubscribe = subscribeToDataChange(["distribution", "notifications"], spy);
    broadcastDataRefresh({ source: "periodic", changed: new Set<DataRefreshFamily>() });
    expect(spy).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("a bare 'periodic' broadcast is treated as every family changed (back-compat 'discard everything')", () => {
    const spy = vi.fn<(detail: DataRefreshDetail) => void>();
    const unsubscribe = subscribeToDataChange(["manifest"], spy);
    broadcastDataRefresh("periodic");
    expect(spy).toHaveBeenCalledWith({ source: "periodic", changed: new Set(ALL_DATA_REFRESH_FAMILIES) });
    unsubscribe();
  });

  it("subscribeToDataRefresh (legacy) still receives the bare source string for a granular periodic broadcast", () => {
    const spy = vi.fn();
    const unsubscribe = subscribeToDataRefresh(spy);
    broadcastDataRefresh({ source: "periodic", changed: new Set<DataRefreshFamily>(["distribution"]) });
    expect(spy).toHaveBeenCalledWith("periodic");
    unsubscribe();
  });
});
