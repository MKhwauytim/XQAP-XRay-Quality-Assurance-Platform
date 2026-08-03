/* @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { broadcastDataRefresh, subscribeToDataRefresh } from "./dataRefreshSignal";

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
