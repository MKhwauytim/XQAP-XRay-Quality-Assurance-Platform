import { afterEach, describe, expect, it, vi } from "vitest";
import { recordSyncSample, getSyncSamples, subscribeSyncSamples, __clearSyncSamplesForTests } from "./syncMetrics";

describe("syncMetrics", () => {
  afterEach(() => {
    __clearSyncSamplesForTests();
  });

  it("records samples in order and notifies subscribers", () => {
    const fn = vi.fn();
    subscribeSyncSamples(fn);

    recordSyncSample({ at: 1, ok: true, ran: true, broadcast: true, changedCount: 0, durationMs: 12 });
    recordSyncSample({ at: 2, ok: false, ran: true, broadcast: true, changedCount: 2, durationMs: 34 });

    expect(fn).toHaveBeenCalledTimes(2);
    expect(getSyncSamples()).toEqual([
      { at: 1, ok: true, ran: true, broadcast: true, changedCount: 0, durationMs: 12 },
      { at: 2, ok: false, ran: true, broadcast: true, changedCount: 2, durationMs: 34 },
    ]);
  });

  it("caps history at 20 samples, dropping the oldest", () => {
    for (let i = 0; i < 25; i++) {
      recordSyncSample({ at: i, ok: true, ran: true, broadcast: true, changedCount: 0, durationMs: i });
    }
    const samples = getSyncSamples();
    expect(samples).toHaveLength(20);
    expect(samples[0].at).toBe(5);
    expect(samples[19].at).toBe(24);
  });
});
