/* @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { getNetworkInfo, getMemoryInfo, getStorageEstimate, getEnvironmentSnapshot } from "./environmentInfo";

describe("getNetworkInfo", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reports online with no connection details when the API is absent", () => {
    expect(getNetworkInfo()).toEqual({ online: true });
  });

  it("reports offline via navigator.onLine", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    expect(getNetworkInfo().online).toBe(false);
  });

  it("reads effectiveType/downlink/rtt/saveData when navigator.connection exists", () => {
    Object.defineProperty(navigator, "connection", {
      configurable: true,
      value: { effectiveType: "4g", downlink: 10, rtt: 50, saveData: false },
    });
    expect(getNetworkInfo()).toEqual({
      online: true,
      effectiveType: "4g",
      downlinkMbps: 10,
      rttMs: 50,
      saveData: false,
    });
    // @ts-expect-error -- test-only cleanup of a non-standard property
    delete navigator.connection;
  });
});

describe("getMemoryInfo", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns null when performance.memory is absent", () => {
    expect(getMemoryInfo()).toBeNull();
  });

  it("converts bytes to rounded MB when performance.memory exists", () => {
    Object.defineProperty(performance, "memory", {
      configurable: true,
      value: {
        usedJSHeapSize: 10 * 1024 * 1024,
        totalJSHeapSize: 20 * 1024 * 1024,
        jsHeapSizeLimit: 100 * 1024 * 1024,
      },
    });
    expect(getMemoryInfo()).toEqual({ usedMB: 10, totalMB: 20, limitMB: 100 });
    // @ts-expect-error -- test-only cleanup of a non-standard property
    delete performance.memory;
  });
});

describe("getStorageEstimate", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("resolves null when navigator.storage.estimate is unavailable", async () => {
    await expect(getStorageEstimate()).resolves.toBeNull();
  });

  it("converts usage/quota bytes to rounded MB", async () => {
    vi.stubGlobal("navigator", {
      ...navigator,
      storage: { estimate: async () => ({ usage: 5 * 1024 * 1024, quota: 50 * 1024 * 1024 }) },
    });
    await expect(getStorageEstimate()).resolves.toEqual({ usageMB: 5, quotaMB: 50 });
  });

  it("resolves null if estimate() throws", async () => {
    vi.stubGlobal("navigator", {
      ...navigator,
      storage: {
        estimate: async () => {
          throw new Error("denied");
        },
      },
    });
    await expect(getStorageEstimate()).resolves.toBeNull();
  });
});

describe("getEnvironmentSnapshot", () => {
  it("includes the app version and a network/memory snapshot", () => {
    const snapshot = getEnvironmentSnapshot();
    expect(typeof snapshot.appVersion).toBe("string");
    expect(snapshot.appVersion.length).toBeGreaterThan(0);
    expect(snapshot.network.online).toBe(true);
    expect(snapshot.viewport).not.toBeNull();
  });
});
