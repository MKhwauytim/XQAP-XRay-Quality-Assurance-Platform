/* @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { buildDemoDebugReport } from "./demoDebugReport";
import { recordSyncSample, __clearSyncSamplesForTests } from "./syncMetrics";

describe("buildDemoDebugReport", () => {
  it("assembles environment, sync, responsiveness and error sections", async () => {
    __clearSyncSamplesForTests();
    recordSyncSample({ at: 1, ok: true, ran: true, broadcast: true, changedCount: 1, durationMs: 42 });

    const report = await buildDemoDebugReport();

    expect(typeof report.generatedAt).toBe("string");
    expect(report.environment.network.online).toBe(true);
    expect(report.environment.storage).toBeNull();
    expect(report.sync.manualSamples).toHaveLength(1);
    expect(report.sync.manualSamples[0].durationMs).toBe(42);
    expect(typeof report.sync.intervalMs).toBe("number");
    expect(report.responsiveness.frameStats).toEqual({ avgMs: 0, maxMs: 0, sampleCount: 0 });
    expect(report.responsiveness.clickStats).toEqual({ avgMs: 0, maxMs: 0, sampleCount: 0 });
    expect(Array.isArray(report.errors)).toBe(true);
  });
});
