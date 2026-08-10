/* @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from "vitest";
import {
  STORAGE_REGISTRY,
  isOwnedKey,
  listOwnedKeys,
  clearOwnedStorage,
} from "./storageRegistry";

describe("storageRegistry", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("registers every known storage location with a purpose and a loss consequence", () => {
    const ids = STORAGE_REGISTRY.map((entry) => entry.id);
    expect(ids).toContain("xray_auth_session_v1");
    expect(ids).toContain("xray_custom_labels_v1");
    expect(ids).toContain("xray_distribution_device_id_v1");
    expect(ids).toContain("xray_last_login_username_v1");
    expect(ids).toContain("xray_firstrun_dismissed_v1:");
    expect(ids).toContain("xray_global_month_v1");
    expect(ids).toContain("xray-quality-app-persistence");

    for (const entry of STORAGE_REGISTRY) {
      expect(entry.purpose.length).toBeGreaterThan(0);
      expect(entry.lossConsequence.length).toBeGreaterThan(0);
    }
  });

  it("recognises exact keys and prefixed keys as owned", () => {
    expect(isOwnedKey("xray_auth_session_v1")).toBe(true);
    expect(isOwnedKey("xray_firstrun_dismissed_v1:my-workspace")).toBe(true);
    expect(isOwnedKey("ComplianceSystem_V2_token")).toBe(false);
  });

  it("lists only web-storage keys, not databases", () => {
    expect(listOwnedKeys()).toContain("xray_auth_session_v1");
    expect(listOwnedKeys()).not.toContain("xray-quality-app-persistence");
  });

  it("clears only owned keys and leaves foreign keys untouched", async () => {
    localStorage.setItem("xray_auth_session_v1", "a");
    localStorage.setItem("xray_firstrun_dismissed_v1:ws", "1");
    localStorage.setItem("kanban-fs-state", "keep me");
    sessionStorage.setItem("xray_global_month_v1", "5-May-2026");
    sessionStorage.setItem("other_app_state", "keep me too");

    await clearOwnedStorage();

    expect(localStorage.getItem("xray_auth_session_v1")).toBeNull();
    expect(localStorage.getItem("xray_firstrun_dismissed_v1:ws")).toBeNull();
    expect(localStorage.getItem("kanban-fs-state")).toBe("keep me");
    expect(sessionStorage.getItem("xray_global_month_v1")).toBeNull();
    expect(sessionStorage.getItem("other_app_state")).toBe("keep me too");
  });
});

import { requestStoragePersistence, getPersistenceState } from "./storageRegistry";

describe("storage persistence", () => {
  it("reports unsupported when the API is absent", async () => {
    const original = navigator.storage;
    Object.defineProperty(navigator, "storage", { value: undefined, configurable: true });

    await expect(requestStoragePersistence()).resolves.toBe("unsupported");
    expect(getPersistenceState()).toBe("unsupported");

    Object.defineProperty(navigator, "storage", { value: original, configurable: true });
  });

  it("reports granted when the browser grants persistence", async () => {
    const original = navigator.storage;
    Object.defineProperty(navigator, "storage", {
      value: { persisted: async () => false, persist: async () => true },
      configurable: true,
    });

    await expect(requestStoragePersistence()).resolves.toBe("granted");

    Object.defineProperty(navigator, "storage", { value: original, configurable: true });
  });

  it("reports denied without throwing when the browser refuses", async () => {
    const original = navigator.storage;
    Object.defineProperty(navigator, "storage", {
      value: { persisted: async () => false, persist: async () => false },
      configurable: true,
    });

    await expect(requestStoragePersistence()).resolves.toBe("denied");

    Object.defineProperty(navigator, "storage", { value: original, configurable: true });
  });

  it("does not re-request once already persisted", async () => {
    let persistCalls = 0;
    const original = navigator.storage;
    Object.defineProperty(navigator, "storage", {
      value: {
        persisted: async () => true,
        persist: async () => {
          persistCalls += 1;
          return true;
        },
      },
      configurable: true,
    });

    await expect(requestStoragePersistence()).resolves.toBe("granted");
    expect(persistCalls).toBe(0);

    Object.defineProperty(navigator, "storage", { value: original, configurable: true });
  });
});

import { probeStoragePersisted, wasStoragePreviouslyPersisted } from "./storageRegistry";

describe("probeStoragePersisted (Finding 2 — side-effect-free persistence read)", () => {
  it("returns true when the browser reports persisted storage", async () => {
    const original = navigator.storage;
    Object.defineProperty(navigator, "storage", {
      value: { persisted: async () => true },
      configurable: true,
    });

    await expect(probeStoragePersisted()).resolves.toBe(true);

    Object.defineProperty(navigator, "storage", { value: original, configurable: true });
  });

  it("returns false when the browser reports no persisted storage, without granting it", async () => {
    let persistCalls = 0;
    const original = navigator.storage;
    Object.defineProperty(navigator, "storage", {
      value: {
        persisted: async () => false,
        persist: async () => {
          persistCalls += 1;
          return true;
        },
      },
      configurable: true,
    });

    await expect(probeStoragePersisted()).resolves.toBe(false);
    // The whole point of a "probe" is that it never calls .persist() itself.
    expect(persistCalls).toBe(0);

    Object.defineProperty(navigator, "storage", { value: original, configurable: true });
  });

  it("returns null when navigator.storage.persisted is unavailable", async () => {
    const original = navigator.storage;
    Object.defineProperty(navigator, "storage", { value: undefined, configurable: true });

    await expect(probeStoragePersisted()).resolves.toBeNull();

    Object.defineProperty(navigator, "storage", { value: original, configurable: true });
  });

  it("returns null instead of throwing when persisted() rejects", async () => {
    const original = navigator.storage;
    Object.defineProperty(navigator, "storage", {
      value: { persisted: async () => { throw new Error("boom"); } },
      configurable: true,
    });

    await expect(probeStoragePersisted()).resolves.toBeNull();

    Object.defineProperty(navigator, "storage", { value: original, configurable: true });
  });
});

describe("wasStoragePreviouslyPersisted", () => {
  // `persistenceState` is a module-level singleton mutated by
  // requestStoragePersistence() in other tests in this file, so each test
  // here first forces it to a known non-"granted" value via a real call --
  // rather than asserting its ambient value -- so these are correct
  // regardless of what ran before them (e.g. under --shuffle).
  it("resolves true from a live probe even when the runtime state is not 'granted'", async () => {
    // This is the exact scenario Finding 2 describes: a reload restores the
    // workspace without re-running requestStoragePersistence(), so the
    // module-local runtime state never reaches "granted" on its own -- only
    // a direct probe of the browser can recover the truth.
    const original = navigator.storage;
    Object.defineProperty(navigator, "storage", {
      value: { persisted: async () => false, persist: async () => false },
      configurable: true,
    });
    await requestStoragePersistence();
    expect(getPersistenceState()).toBe("denied");

    Object.defineProperty(navigator, "storage", {
      value: { persisted: async () => true },
      configurable: true,
    });

    await expect(wasStoragePreviouslyPersisted()).resolves.toBe(true);

    Object.defineProperty(navigator, "storage", { value: original, configurable: true });
  });

  it("resolves false when neither the runtime state nor the probe indicate persistence", async () => {
    const original = navigator.storage;
    Object.defineProperty(navigator, "storage", {
      value: { persisted: async () => false, persist: async () => false },
      configurable: true,
    });
    await requestStoragePersistence();
    expect(getPersistenceState()).toBe("denied");

    Object.defineProperty(navigator, "storage", { value: undefined, configurable: true });

    await expect(wasStoragePreviouslyPersisted()).resolves.toBe(false);

    Object.defineProperty(navigator, "storage", { value: original, configurable: true });
  });
});
