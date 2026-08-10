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
