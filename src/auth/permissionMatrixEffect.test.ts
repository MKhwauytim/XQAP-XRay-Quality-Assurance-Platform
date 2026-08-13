/**
 * "No dead controls" contract for the User Management matrices.
 *
 * A cell an admin can toggle must actually change what the role can do, and a
 * combination that is intentionally impossible must be reported as restricted
 * (so the UI renders a notice instead of an inert toggle). These tests walk the
 * full role x tab and role x feature grids rather than spot-checking, so a future
 * ceiling change cannot quietly reintroduce a control that does nothing.
 */
import { describe, expect, it } from "vitest";

import type { AuthRole } from "./authTypes";
import { getMutationCapability } from "./mutationCapability";
import {
  canRoleAccessTab,
  createDefaultFeaturePermissions,
  createDefaultPermissions,
  FEATURE_TAB_LOOKUP,
  isTabRestrictedForRole,
  MANAGED_ROLES,
  MANAGED_TABS,
  type FeaturePermission,
  type RolePermission,
} from "./userManagement";

const MATRIX_ROLES: AuthRole[] = MANAGED_ROLES.map((role) => role.id);
const ALL_FEATURE_IDS = Object.keys(FEATURE_TAB_LOOKUP);

/** Exactly the role x tab cells the matrix is allowed to present as restricted. */
const EXPECTED_RESTRICTED: ReadonlyArray<readonly [AuthRole, string]> = [
  // Admin-only by design: user management and the ad-hoc importer.
  ...(["guest", "employee", "supervisor", "manager"] as const).flatMap((role) =>
    [
      "user-management",
      "user-management/users",
      "user-management/page-permissions",
      "user-management/feature-permissions",
      "user-management/activity",
      "user-management/actions",
      "adhoc-import",
    ].map((tabId) => [role, tabId] as const),
  ),
  // Settings is code-gated to guest + admin.
  ["employee", "settings"],
  ["supervisor", "settings"],
  ["manager", "settings"],
  // KPI dashboard / report designer keep their own narrower sub-tab ceilings.
  ["guest", "reports/kpi"],
  ["employee", "reports/kpi"],
  ["guest", "reports/report-designer"],
  ["employee", "reports/report-designer"],
];

function key(role: AuthRole, tabId: string): string {
  return `${role}:${tabId}`;
}

function grantPage(tabId: string, role: AuthRole, access: "view" | "edit"): RolePermission[] {
  return [
    ...createDefaultPermissions().filter((p) => !(p.role === role && p.tabId === tabId)),
    { role, tabId, access },
  ];
}

function grantFeature(featureId: string, role: AuthRole): FeaturePermission[] {
  return [
    ...createDefaultFeaturePermissions().filter(
      (f) => !(f.role === role && f.featureId === featureId),
    ),
    { role, featureId, enabled: true },
  ];
}

describe("page permission matrix — every settable cell takes effect", () => {
  it("restricts exactly the deliberate role x tab combinations and no others", () => {
    const actual = new Set<string>();
    for (const role of MATRIX_ROLES) {
      for (const tab of MANAGED_TABS) {
        if (isTabRestrictedForRole(role, tab.id)) actual.add(key(role, tab.id));
      }
    }
    const expected = new Set(EXPECTED_RESTRICTED.map(([role, tabId]) => key(role, tabId)));
    expect([...actual].sort()).toEqual([...expected].sort());
  });

  it("admin is never restricted from any tab", () => {
    for (const tab of MANAGED_TABS) {
      expect(isTabRestrictedForRole("admin", tab.id), tab.id).toBe(false);
    }
  });

  it("grants real access for every non-restricted role x tab cell", () => {
    for (const role of MATRIX_ROLES) {
      for (const tab of MANAGED_TABS) {
        if (isTabRestrictedForRole(role, tab.id)) continue;
        const permissions = grantPage(tab.id, role, "edit");
        expect(
          canRoleAccessTab(permissions, role, tab.id, "edit"),
          `granting edit on ${key(role, tab.id)} must take effect`,
        ).toBe(true);
      }
    }
  });

  it("never honours a matrix row that is outside the code ceiling", () => {
    // Reachable only via a hand-edited users.permissions.json or a file written
    // before a ceiling narrowed — it must still be refused, not silently obeyed.
    for (const [role, tabId] of EXPECTED_RESTRICTED) {
      const permissions = grantPage(tabId, role, "edit");
      expect(canRoleAccessTab(permissions, role, tabId), key(role, tabId)).toBe(false);
    }
  });

  it("reopens reports and archive to employees (previously unreachable ceilings)", () => {
    for (const tabId of ["reports", "reports/reports", "archive"]) {
      expect(isTabRestrictedForRole("employee", tabId), tabId).toBe(false);
      expect(canRoleAccessTab(grantPage(tabId, "employee", "edit"), "employee", tabId, "edit")).toBe(true);
    }
  });

  it("keeps the shipped defaults unchanged for the reopened tabs", () => {
    // Widening a ceiling must give the admin the ability to grant, not grant it.
    const defaults = createDefaultPermissions();
    for (const tabId of ["reports", "reports/reports", "archive"]) {
      const row = defaults.find((p) => p.role === "employee" && p.tabId === tabId);
      expect(row?.access, tabId).toBe("none");
      expect(canRoleAccessTab(defaults, "employee", tabId)).toBe(false);
    }
  });
});

describe("feature permission matrix — every settable toggle takes effect", () => {
  const capability = (role: AuthRole, featureId: string, permissions: RolePermission[], featurePermissions: FeaturePermission[]) =>
    getMutationCapability({
      role,
      featureId,
      permissions,
      featurePermissions,
      isReadOnly: false,
      workspaceReady: true,
    });

  it("authorizes the mutation once page-edit + the toggle are granted, for every non-restricted cell", () => {
    for (const role of MATRIX_ROLES) {
      for (const featureId of ALL_FEATURE_IDS) {
        const tabId = FEATURE_TAB_LOOKUP[featureId]!;
        if (isTabRestrictedForRole(role, tabId)) continue;
        const result = capability(
          role,
          featureId,
          grantPage(tabId, role, "edit"),
          grantFeature(featureId, role),
        );
        expect(result.allowed, `${key(role, featureId)} must become allowed`).toBe(true);
      }
    }
  });

  it("refuses every feature whose parent page is restricted for the role, even when the toggle is on", () => {
    for (const role of MATRIX_ROLES) {
      for (const featureId of ALL_FEATURE_IDS) {
        const tabId = FEATURE_TAB_LOOKUP[featureId]!;
        if (!isTabRestrictedForRole(role, tabId)) continue;
        const result = capability(
          role,
          featureId,
          grantPage(tabId, role, "edit"),
          grantFeature(featureId, role),
        );
        expect(result.allowed, `${key(role, featureId)} must stay refused`).toBe(false);
        expect(result.reason).toBe("page-not-editable");
      }
    }
  });

  it("lists the feature cells that stay permanently restricted", () => {
    const restricted = new Set<string>();
    for (const role of MATRIX_ROLES) {
      for (const featureId of ALL_FEATURE_IDS) {
        if (isTabRestrictedForRole(role, FEATURE_TAB_LOOKUP[featureId]!)) {
          restricted.add(`${featureId}:${role}`);
        }
      }
    }
    // user-management (3 features) + adhoc-import (2) x 4 roles, plus the two
    // settings features for employee/supervisor/manager. Nothing else.
    const featureIds = new Set([...restricted].map((entry) => entry.split(":")[0]));
    expect([...featureIds].sort()).toEqual(
      [
        "adhoc-import.assign",
        "adhoc-import.ingest",
        "edit-interface-labels",
        "edit-permissions",
        "manage-users",
        "reset-passwords",
        "view-error-log",
      ].sort(),
    );
    expect(restricted.has("view-error-log:guest")).toBe(false);
    expect(restricted.has("view-error-log:manager")).toBe(true);
    // Reports/archive features are no longer dead for employees.
    expect(restricted.has("export-reports:employee")).toBe(false);
    expect(restricted.has("archive.closeMonth:employee")).toBe(false);
    expect(restricted.has("report-designer.edit:employee")).toBe(false);
  });
});
