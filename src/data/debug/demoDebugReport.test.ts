/* @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildDemoDebugReport } from "./demoDebugReport";
import { recordSyncSample, __clearSyncSamplesForTests } from "./syncMetrics";
import { clearErrors, logError } from "../storage/errorLogger";
import { setErrorActor, clearErrorActor, __resetErrorContextForTests } from "../storage/errorContext";

describe("buildDemoDebugReport", () => {
  beforeEach(() => {
    clearErrors();
    __resetErrorContextForTests();
  });

  afterEach(() => {
    clearErrors();
    __resetErrorContextForTests();
  });

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

  it("strips username, role and stack from a prior real user's error entries — the demo debug export must never carry them, even when the ring buffer outlived that user's logout", async () => {
    // Simulate a real signed-in manager hitting an error, then signing out —
    // the module-scoped ring buffer in errorLogger.ts is never cleared on
    // logout, so this entry is still present when a later demo session in
    // the same tab builds its debug report.
    setErrorActor("real.manager", "manager");
    logError("population:save", new Error("boom"), { errorCode: "XQ-WS-006" });
    clearErrorActor();

    const report = await buildDemoDebugReport();

    expect(report.errors.length).toBeGreaterThan(0);
    const entry = report.errors[report.errors.length - 1];

    // The identifying fields must be absent entirely, not merely falsy.
    expect(entry).not.toHaveProperty("username");
    expect(entry).not.toHaveProperty("role");
    expect(entry).not.toHaveProperty("stack");
    expect(JSON.stringify(entry)).not.toContain("real.manager");

    // Everything useful for debugging the demo session itself is preserved.
    expect(entry.message).toBe("boom");
    expect(entry.context).toBe("population:save");
    expect(entry.errorCode).toBe("XQ-WS-006");
    expect(typeof entry.timestamp).toBe("string");
  });
});
