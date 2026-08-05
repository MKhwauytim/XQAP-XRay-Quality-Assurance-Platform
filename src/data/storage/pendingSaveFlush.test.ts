/* @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from "vitest";
import { registerPendingSaveFlush, __clearPendingSaveFlushesForTests } from "./pendingSaveFlush";

describe("pendingSaveFlush registry", () => {
  afterEach(() => __clearPendingSaveFlushesForTests());

  it("calls every registered flush when a pagehide event fires", () => {
    const flushA = vi.fn();
    const flushB = vi.fn();
    registerPendingSaveFlush(flushA);
    registerPendingSaveFlush(flushB);

    window.dispatchEvent(new Event("pagehide"));

    expect(flushA).toHaveBeenCalledOnce();
    expect(flushB).toHaveBeenCalledOnce();
  });

  it("stops calling a flush after it has been unregistered", () => {
    const flush = vi.fn();
    const unregister = registerPendingSaveFlush(flush);
    unregister();

    window.dispatchEvent(new Event("pagehide"));

    expect(flush).not.toHaveBeenCalled();
  });

  it("a throwing flush does not prevent other registered flushes from running", () => {
    const throwing = vi.fn(() => { throw new Error("boom"); });
    const normal = vi.fn();
    registerPendingSaveFlush(throwing);
    registerPendingSaveFlush(normal);

    expect(() => window.dispatchEvent(new Event("pagehide"))).not.toThrow();
    expect(normal).toHaveBeenCalledOnce();
  });
});
