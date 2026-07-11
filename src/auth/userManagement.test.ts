import { expect, test } from "vitest";

import type { AuthRole } from "./authTypes";
import {
  createDefaultPermissions,
  createManagedUser,
  getRolePermission,
  MANAGED_TABS,
  type PermissionLevel,
} from "./userManagement";

const baseParams = {
  username: "Sara",
  displayName: "Sara Q",
  role: "employee" as const,
  passwordHash: { algorithm: "argon2id" as const, encoded: "x" },
  isActive: true
};

const ANALYTICS_TAB_ID = "reports/analytics";
const ALL_ROLES: AuthRole[] = ["guest", "employee", "supervisor", "manager", "admin"];

test("createManagedUser defaults hasCertScanLicense to false", () => {
  const user = createManagedUser(baseParams);
  expect(user.hasCertScanLicense).toBe(false);
  expect(user.username).toBe("sara");
});

test("createManagedUser honours an explicit license flag", () => {
  const user = createManagedUser({ ...baseParams, hasCertScanLicense: true });
  expect(user.hasCertScanLicense).toBe(true);
});

test("MANAGED_TABS registers the analytics dashboard as a sub-tab of reports", () => {
  const tab = MANAGED_TABS.find((t) => t.id === ANALYTICS_TAB_ID);
  expect(tab).toBeDefined();
  expect(tab?.parentId).toBe("reports");
});

test("createDefaultPermissions defines reports/analytics for every role", () => {
  const perms = createDefaultPermissions();
  for (const role of ALL_ROLES) {
    const entry = perms.find((p) => p.role === role && p.tabId === ANALYTICS_TAB_ID);
    expect(entry, `missing reports/analytics permission for role ${role}`).toBeDefined();
  }
});

test("C1 regression: 4 formerly-inherited sub-tabs keep their effective access for all roles", () => {
  // These 4 sub-tabs previously had NO explicit rows and resolved via parent-tab
  // inheritance (population / reports). C1 removed that fallback and baked the
  // effective values into explicit rows. EXPECTED = the pre-change effective access;
  // getRolePermission (no fallback) must still return exactly these — 20 assertions.
  const perms = createDefaultPermissions();
  const EXPECTED: Record<string, Record<AuthRole, PermissionLevel>> = {
    "population/process": { guest: "view", employee: "view", supervisor: "view", manager: "edit", admin: "edit" },
    "population/browse":  { guest: "view", employee: "view", supervisor: "view", manager: "edit", admin: "edit" },
    "reports/reports":    { guest: "none", employee: "none", supervisor: "view", manager: "edit", admin: "edit" },
    "reports/kpi":        { guest: "none", employee: "none", supervisor: "view", manager: "edit", admin: "edit" },
  };
  for (const [tabId, roleMap] of Object.entries(EXPECTED)) {
    for (const role of ALL_ROLES) {
      expect(getRolePermission(perms, role, tabId), `${role}:${tabId}`).toBe(roleMap[role]);
    }
  }
});

test("reports/analytics defaults to allowed for manager + admin only", () => {
  const perms = createDefaultPermissions();
  const accessFor = (role: AuthRole) =>
    perms.find((p) => p.role === role && p.tabId === ANALYTICS_TAB_ID)?.access;

  // Manager + admin can access (view or edit); admin keeps full edit.
  expect(accessFor("manager")).not.toBe("none");
  expect(accessFor("admin")).not.toBe("none");
  expect(accessFor("admin")).toBe("edit");

  // Everyone else is denied by default.
  expect(accessFor("guest")).toBe("none");
  expect(accessFor("employee")).toBe("none");
  expect(accessFor("supervisor")).toBe("none");
});
