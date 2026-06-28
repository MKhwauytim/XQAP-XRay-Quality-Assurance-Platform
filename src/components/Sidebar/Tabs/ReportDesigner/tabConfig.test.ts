import { describe, it, expect } from "vitest";
import { tabConfig } from "./index";
import { MANAGED_TABS, createDefaultPermissions } from "../../../../auth/userManagement";

describe("Report Designer tab registration", () => {
  it("exposes a well-formed tabConfig", () => {
    // tabConfig is typed as optional in SidebarTabModule; assert it exists first
    expect(tabConfig).toBeDefined();
    if (!tabConfig) return;
    expect(tabConfig.id).toBe("report-designer");
    expect(tabConfig.label).toBe("مصمم التقارير");
    expect(tabConfig.allowedRoles).toEqual(["supervisor", "manager", "admin"]);
  });
  it("is listed in MANAGED_TABS", () => {
    expect(MANAGED_TABS.some((t) => t.id === "report-designer")).toBe(true);
  });
  it("has a default permission row for every role", () => {
    const rows = createDefaultPermissions().filter((p) => p.tabId === "report-designer");
    expect(rows.map((r) => r.role).sort()).toEqual(
      ["employee", "guest", "manager", "supervisor"].sort()
    );
  });
});
