/* @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  startResponsivenessMonitor,
  stopResponsivenessMonitor,
  getFrameSamples,
  getClickLatencySamples,
  __resetResponsivenessMonitorForTests,
} from "./responsivenessMonitor";

// A controllable fake rAF queue, keyed by id, so `cancelAnimationFrame` can
// actually remove a specific pending callback the way a real browser does —
// a fake that ignores ids would let a "cancelled" frame still fire and mask a
// stop() that doesn't really stop.
let idCounter = 0;
let scheduled = new Map<number, FrameRequestCallback>();

function flushFrames(time: number): void {
  const toRun = Array.from(scheduled.values());
  scheduled.clear();
  toRun.forEach((cb) => cb(time));
}

describe("responsivenessMonitor", () => {
  beforeEach(() => {
    idCounter = 0;
    scheduled = new Map();
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      idCounter += 1;
      scheduled.set(idCounter, cb);
      return idCounter;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      scheduled.delete(id);
    });
  });

  afterEach(() => {
    __resetResponsivenessMonitorForTests();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("does nothing until started", () => {
    expect(getFrameSamples()).toEqual([]);
    expect(getClickLatencySamples()).toEqual([]);
  });

  it("records a frame delta once two consecutive frames have run", () => {
    startResponsivenessMonitor();
    flushFrames(1000); // first frame only establishes the baseline
    expect(getFrameSamples()).toHaveLength(0);
    flushFrames(1016);
    expect(getFrameSamples()).toHaveLength(1);
    expect(getFrameSamples()[0].deltaMs).toBeCloseTo(16, 0);
  });

  it("stop cancels the pending frame so sampling does not resume", () => {
    startResponsivenessMonitor();
    flushFrames(1000);
    stopResponsivenessMonitor();
    flushFrames(1016);
    expect(getFrameSamples()).toHaveLength(0);
  });

  it("records click latency as the gap between a click and the next frame", () => {
    const nowSpy = vi.spyOn(performance, "now");
    nowSpy.mockReturnValueOnce(100); // clicked at
    startResponsivenessMonitor();
    document.body.click();
    nowSpy.mockReturnValueOnce(108); // sampled on the next frame
    flushFrames(0);

    const samples = getClickLatencySamples();
    expect(samples).toHaveLength(1);
    expect(samples[0].latencyMs).toBeCloseTo(8, 0);
  });

  it("stop removes the click listener so further clicks are not sampled", () => {
    startResponsivenessMonitor();
    stopResponsivenessMonitor();
    document.body.click();
    flushFrames(0);
    expect(getClickLatencySamples()).toHaveLength(0);
  });

  it("start is idempotent — calling it twice does not double-schedule", () => {
    startResponsivenessMonitor();
    startResponsivenessMonitor();
    expect(scheduled.size).toBe(1);
  });
});
