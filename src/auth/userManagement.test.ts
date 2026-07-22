import { expect, test } from "vitest";

import type { AuthRole } from "./authTypes";
import {
  createDefaultFeaturePermissions,
  createDefaultPermissions,
  createManagedUser,
  FEATURE_TAB_LOOKUP,
  getRolePermission,
  hasFeature,
  MANAGED_TABS,
  roleCeilingFor,
  TAB_FEATURE_MAP,
  TAB_ROLE_CEILINGS,
  type PermissionLevel,
} from "./userManagement";

const baseParams = {
  username: "Sara",
  displayName: "Sara Q",
  role: "employee" as const,
  passwordHash: { algorithm: "argon2id" as const, encoded: "x" },
  isActive: true
};

const KPI_TAB_ID = "reports/kpi";
const NOTIFICATIONS_TAB_ID = "ew/notifications";
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

test("MANAGED_TABS registers the KPI dashboard as a sub-tab of reports and no longer has the stale analytics key", () => {
  const kpi = MANAGED_TABS.find((t) => t.id === KPI_TAB_ID);
  expect(kpi).toBeDefined();
  expect(kpi?.parentId).toBe("reports");
  // The dead reports/analytics key was merged into reports/kpi (sidebar + content
  // gates now share one key); it must be gone from the catalogue.
  expect(MANAGED_TABS.find((t) => t.id === "reports/analytics")).toBeUndefined();
});

test("createDefaultPermissions defines reports/kpi for every role", () => {
  const perms = createDefaultPermissions();
  for (const role of ALL_ROLES) {
    const entry = perms.find((p) => p.role === role && p.tabId === KPI_TAB_ID);
    expect(entry, `missing reports/kpi permission for role ${role}`).toBeDefined();
  }
  // The stale analytics key must have no default rows anymore.
  expect(perms.some((p) => p.tabId === "reports/analytics")).toBe(false);
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

test("MANAGED_TABS registers the notification center as a top-level category", () => {
  const tab = MANAGED_TABS.find((t) => t.id === NOTIFICATIONS_TAB_ID);
  expect(tab).toBeDefined();
  expect(tab?.parentId).toBeUndefined();
  expect(TAB_ROLE_CEILINGS[NOTIFICATIONS_TAB_ID]).toEqual(ALL_ROLES);
});

test("ew/notifications manager view defaults to admin + manager only", () => {
  const perms = createDefaultPermissions();
  const accessFor = (role: AuthRole) => getRolePermission(perms, role, NOTIFICATIONS_TAB_ID);

  expect(accessFor("admin")).toBe("edit");
  expect(accessFor("manager")).toBe("edit");
  // Audience + guest roles get the banner, never the manager view.
  expect(accessFor("supervisor")).toBe("none");
  expect(accessFor("employee")).toBe("none");
  expect(accessFor("guest")).toBe("none");
});

test("post-notification feature defaults enabled for admin + manager only (defense-in-depth)", () => {
  const feats = createDefaultFeaturePermissions();
  expect(hasFeature(feats, "admin", "post-notification")).toBe(true);
  expect(hasFeature(feats, "manager", "post-notification")).toBe(true);
  // Employees/supervisors/guests must not be able to post.
  expect(hasFeature(feats, "supervisor", "post-notification")).toBe(false);
  expect(hasFeature(feats, "employee", "post-notification")).toBe(false);
  expect(hasFeature(feats, "guest", "post-notification")).toBe(false);
});

test("reports/kpi defaults: supervisor view, manager+admin edit, others none", () => {
  const perms = createDefaultPermissions();
  const accessFor = (role: AuthRole) => getRolePermission(perms, role, KPI_TAB_ID);

  expect(accessFor("admin")).toBe("edit");
  expect(accessFor("manager")).toBe("edit");
  // Supervisor keeps "view" — it now actually works after the dead-cell fix.
  expect(accessFor("supervisor")).toBe("view");
  expect(accessFor("employee")).toBe("none");
  expect(accessFor("guest")).toBe("none");
});

test("every non-'none' default permission stays within its tab's code role ceiling", () => {
  // Guards the shipped matrix against granting a role access the code will never
  // honor (e.g. manager×settings). Sub-tabs map to their parent's ceiling.
  const perms = createDefaultPermissions();
  for (const p of perms) {
    if (p.role === "admin" || p.access === "none") continue;
    const topLevelTabId = MANAGED_TABS.find((t) => t.id === p.tabId)?.parentId ?? p.tabId;
    const ceiling = TAB_ROLE_CEILINGS[topLevelTabId];
    if (!ceiling) continue;
    expect(
      ceiling.includes(p.role),
      `${p.role}:${p.tabId} default="${p.access}" is outside the code ceiling`
    ).toBe(true);
  }
});

test("manager has no settings access by default (matches code ceiling)", () => {
  const perms = createDefaultPermissions();
  expect(getRolePermission(perms, "manager", "settings")).toBe("none");
});

// ── B1: sub-tab role ceilings ───────────────────────────────────────────────

test("every non-'none' default permission stays within its OWN tab's code role ceiling (sub-tabs included)", () => {
  // Stronger than the parent-ceiling check above: now that sub-tab ceilings are
  // enforced at runtime (App.tsx sub-tab filter, usePermissions.canAccessTab,
  // PermissionSections' isCeilingLocked), every default must respect its OWN
  // ceiling too, not just its parent's -- e.g. reports/kpi vs. reports.
  const perms = createDefaultPermissions();
  for (const p of perms) {
    if (p.role === "admin" || p.access === "none") continue;
    const ceiling = roleCeilingFor(p.tabId);
    if (!ceiling) continue;
    expect(
      ceiling.includes(p.role),
      `${p.role}:${p.tabId} default="${p.access}" is outside its own code role ceiling`
    ).toBe(true);
  }
});

test("reports/kpi ceiling includes supervisor (widened) while report-designer keeps excluding guest", () => {
  expect(roleCeilingFor("reports/kpi")).toEqual(["supervisor", "manager", "admin"]);
  expect(roleCeilingFor("reports/report-designer")).not.toContain("guest");
});

// ── B1 (task 2): post-notification cascade fix ──────────────────────────────

test("post-notification cascades against ew/notifications, not employee-workspace", () => {
  expect(FEATURE_TAB_LOOKUP["post-notification"]).toBe("ew/notifications");
  expect(TAB_FEATURE_MAP["employee-workspace"]).not.toContain("post-notification");
  expect(TAB_FEATURE_MAP["ew/notifications"]).toContain("post-notification");
});

// ── B1 (task 3): ew/inspection-form dead end ────────────────────────────────

test("ew/inspection-form defaults to none for employee and supervisor (dead-end fix); manager keeps edit", () => {
  const perms = createDefaultPermissions();
  const feats = createDefaultFeaturePermissions();
  for (const role of ["employee", "supervisor"] as const) {
    expect(getRolePermission(perms, role, "ew/inspection-form"), `${role}:ew/inspection-form`).toBe("none");
    // The tab was hidden precisely because manage-inspection-template is off for
    // these roles by default -- guard that the two facts stay in sync.
    expect(hasFeature(feats, role, "manage-inspection-template"), `${role}:manage-inspection-template`).toBe(false);
  }
  expect(getRolePermission(perms, "manager", "ew/inspection-form")).toBe("edit");
  expect(hasFeature(feats, "manager", "manage-inspection-template")).toBe(true);
});

// ── B1 (task 4): decorative feature toggles removed ─────────────────────────

test("export-archive and view-employee-stats are removed (zero consumers)", () => {
  const ids = new Set(createDefaultFeaturePermissions().map((f) => f.featureId));
  expect(ids.has("export-archive")).toBe(false);
  expect(ids.has("view-employee-stats")).toBe(false);
  expect(TAB_FEATURE_MAP["archive"]).not.toContain("export-archive");
  expect(TAB_FEATURE_MAP["employee-workspace"]).not.toContain("view-employee-stats");
  expect(FEATURE_TAB_LOOKUP["export-archive"]).toBeUndefined();
  expect(FEATURE_TAB_LOOKUP["view-employee-stats"]).toBeUndefined();
});
