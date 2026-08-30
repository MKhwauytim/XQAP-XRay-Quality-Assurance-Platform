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

/**
 * Exactly the role x tab cells the matrix is allowed to present as restricted.
 *
 * Every one of these used to hold a `guest`-only entry (ad-hoc import, the six
 * user-management sub-tabs, reports/kpi, reports/report-designer): each was
 * widened for the operational roles first, but kept excluding `guest` on the
 * rationale that it is the read-only observer role. On 2026-08-30 the owner
 * asked for that pattern to end entirely -- no ceiling should be the reason a
 * "مقيّد بالنظام" cell shows up in the matrix, `guest` included. This list is
 * now empty on purpose, and stays a live variable (not deleted) so a future
 * ceiling re-narrowing shows up here instead of silently landing unnoticed.
 */
const EXPECTED_RESTRICTED: ReadonlyArray<readonly [AuthRole, string]> = [];

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

  // The prior version of this test walked every restricted role x feature pair
  // and proved getMutationCapability refuses it even with the toggle on. As of
  // 2026-08-30 EXPECTED_RESTRICTED (and therefore isTabRestrictedForRole, for
  // every role and tab) is empty -- see the comment on EXPECTED_RESTRICTED above
  // -- so there is no restricted pair left to walk. getMutationCapability's own
  // ceiling check stays in place as defense-in-depth for a future ceiling.

  it("keeps the ad-hoc import features grantable through their new population parent", () => {
    // THE regression this move is most likely to cause: FEATURE_TAB_LOOKUP is derived
    // from TAB_FEATURE_MAP, and getMutationCapability resolves the feature's PARENT
    // tab through it. Left pointing at the retired "adhoc-import" tab id, both
    // features would resolve to a tab absent from the catalog and — because
    // hasRolePermission finds no row for it — become un-grantable for every role,
    // admin included: the whole workbench silently read-only.
    for (const featureId of ["adhoc-import.ingest", "adhoc-import.assign"]) {
      expect(FEATURE_TAB_LOOKUP[featureId], featureId).toBe("population");
      // Admin, on the shipped defaults, with nothing granted by hand.
      expect(
        capability("admin", featureId, createDefaultPermissions(), createDefaultFeaturePermissions())
          .allowed,
        `admin must keep ${featureId}`,
      ).toBe(true);
      // And a managed role can still be granted it (page edit + the toggle).
      expect(
        capability("manager", featureId, grantPage("population", "manager", "edit"), grantFeature(featureId, "manager"))
          .allowed,
      ).toBe(true);
      // ...but not off the Population page alone — the toggle is still required.
      expect(
        capability("manager", featureId, grantPage("population", "manager", "edit"), createDefaultFeaturePermissions())
          .reason,
      ).toBe("feature-disabled");
    }
    // The retired tab id must no longer appear anywhere in the map.
    expect(Object.values(FEATURE_TAB_LOOKUP)).not.toContain("adhoc-import");
  });

  it("lists the feature cells that stay permanently restricted — none, as of 2026-08-30", () => {
    const restricted = new Set<string>();
    for (const role of MATRIX_ROLES) {
      for (const featureId of ALL_FEATURE_IDS) {
        if (isTabRestrictedForRole(role, FEATURE_TAB_LOOKUP[featureId]!)) {
          restricted.add(`${featureId}:${role}`);
        }
      }
    }
    // user-management's 3 mutation features (manage-users, reset-passwords,
    // edit-permissions) x guest were the last permanently-dead cells, per the
    // 2026-08-25 widening. The owner asked for every "مقيّد بالنظام" cell to go,
    // guest included (2026-08-30) — see EXPECTED_RESTRICTED above — so this set
    // is empty now: no feature toggle is permanently inert for any role.
    expect(restricted.size).toBe(0);
  });
});
