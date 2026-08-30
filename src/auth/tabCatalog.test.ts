import { describe, expect, it } from "vitest";
import {
  MANAGED_TABS,
  navGroupFor,
  roleCeilingFor,
  SUB_TAB_ROLE_CEILINGS,
  TAB_CATALOG,
  TAB_NAV_GROUP_ORDER,
  TAB_ROLE_CEILINGS,
  tabAllowedRoles,
} from "./tabCatalog";
import { createDefaultFeaturePermissions, createDefaultPermissions } from "./userManagement";

describe("tab catalog", () => {
  it("has unique IDs and valid parent references", () => {
    const ids = TAB_CATALOG.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of TAB_CATALOG) {
      if (entry.parentId) expect(ids).toContain(entry.parentId);
    }
  });

  it("derives managed tabs and top-level role ceilings from one source", () => {
    expect(MANAGED_TABS).toHaveLength(TAB_CATALOG.length);
    const topLevel = TAB_CATALOG.filter((entry) => !entry.parentId);
    expect(Object.keys(TAB_ROLE_CEILINGS).sort()).toEqual(
      topLevel.map((entry) => entry.id).sort(),
    );
    for (const entry of topLevel) {
      expect(TAB_ROLE_CEILINGS[entry.id]).toEqual(tabAllowedRoles(entry.id));
    }
  });

  it("gives every top-level tab an explicit nav group, and no sub-tab one", () => {
    // navGroupFor() falls back to "system" so an ungrouped tab still renders
    // rather than vanishing from the rail — this asserts nobody relies on that
    // fallback, which is what makes it a safety net rather than an excuse.
    for (const entry of TAB_CATALOG) {
      if (entry.parentId) {
        expect(entry.group).toBeUndefined();
      } else {
        expect(TAB_NAV_GROUP_ORDER).toContain(entry.group);
        expect(navGroupFor(entry.id)).toBe(entry.group);
      }
    }
  });

  it("puts every nav group to use and keeps the workflow stages first", () => {
    const used = new Set(
      TAB_CATALOG.filter((entry) => !entry.parentId).map((entry) => entry.group),
    );
    expect([...TAB_NAV_GROUP_ORDER].every((group) => used.has(group))).toBe(true);
    expect(TAB_NAV_GROUP_ORDER[0]).toBe("workflow");
  });

  it("fails closed for unknown tab IDs", () => {
    expect(() => tabAllowedRoles("unknown")).toThrow("Unknown tab catalog id");
  });

  it("derives sub-tab role ceilings from the same catalog, independent of the parent", () => {
    // B1 (sub-tab role ceilings): every sub-tab (entry with a parentId) must have
    // its OWN ceiling entry, distinct from TAB_ROLE_CEILINGS (top-level only).
    const subTabs = TAB_CATALOG.filter((entry) => entry.parentId);
    expect(Object.keys(SUB_TAB_ROLE_CEILINGS).sort()).toEqual(
      subTabs.map((entry) => entry.id).sort(),
    );
    for (const entry of subTabs) {
      expect(SUB_TAB_ROLE_CEILINGS[entry.id]).toEqual(tabAllowedRoles(entry.id));
    }
    // No overlap: a sub-tab id must never also appear as a top-level ceiling key.
    for (const id of Object.keys(SUB_TAB_ROLE_CEILINGS)) {
      expect(TAB_ROLE_CEILINGS[id]).toBeUndefined();
    }
  });

  it("roleCeilingFor resolves both top-level and sub-tab ids, and is undefined for unknown ids", () => {
    expect(roleCeilingFor("reports")).toEqual(TAB_ROLE_CEILINGS["reports"]);
    expect(roleCeilingFor("reports/kpi")).toEqual(SUB_TAB_ROLE_CEILINGS["reports/kpi"]);
    expect(roleCeilingFor("unknown-tab-id")).toBeUndefined();
  });

  it("widens reports/kpi and report-designer to every role, guest included", () => {
    // Widened ["supervisor","manager","admin"] -> +employee (2026-08-27) -> +guest
    // (2026-08-30, owner: no "مقيّد بالنظام" cell should remain anywhere admin can
    // otherwise customize the matrix).
    expect(roleCeilingFor("reports/kpi")).toEqual(["guest", "employee", "supervisor", "manager", "admin"]);
    expect(roleCeilingFor("reports/report-designer")).toEqual(["guest", "employee", "supervisor", "manager", "admin"]);
  });

  it("keeps reports and archive open to every role so the matrix column is not a dead control", () => {
    // A ceiling that excludes a role turns that role's whole matrix row into a
    // control an admin can click but that can never take effect. Nothing in the
    // product requires reports/archive to be closed to employees, so the ceiling
    // was widened and the decision now lives in the shipped matrix defaults
    // (still "none") rather than in code.
    for (const tabId of ["reports", "reports/reports", "archive"]) {
      expect(roleCeilingFor(tabId), tabId).toContain("employee");
    }
  });

  it("widens every user-management tab and sub-tab to every role, guest included", () => {
    // Widened ADMIN_ONLY -> OPERATIONAL_ROLES (2026-08-25, admin is never a column
    // in the page-permissions matrix so an admin-only ceiling was a permanently
    // dead "مقيّد بالنظام" block) -> ALL_ROLES (2026-08-30, owner: no "مقيّد
    // بالنظام" cell should remain anywhere admin can otherwise customize the
    // matrix, including guest).
    for (const tabId of [
      "user-management",
      "user-management/users",
      "user-management/page-permissions",
      "user-management/feature-permissions",
      "user-management/activity",
      "user-management/actions",
      "user-management/performance",
    ]) {
      expect(roleCeilingFor(tabId), tabId).toEqual(["guest", "employee", "supervisor", "manager", "admin"]);
    }
  });

  it("widens settings to every role, like the 2026-08-25 user-management fix", () => {
    // Widened from ["guest", "admin"] (2026-08-27): the owner reported that
    // Settings could not be granted to employee/supervisor/manager from the
    // page-permissions matrix, which was true -- an admin-only-plus-guest
    // ceiling made 3 of the 4 managed-role columns dead controls, same bug
    // pattern as the earlier user-management fix (#109). `guest` was already
    // allowed and stays allowed.
    expect(roleCeilingFor("settings")).toEqual(["guest", "employee", "supervisor", "manager", "admin"]);
  });

  it("keeps ad-hoc import under population as a sub-tab, with no top-level entry", () => {
    const entry = TAB_CATALOG.find((tab) => tab.id === "population/adhoc-import");
    expect(entry).toBeDefined();
    expect(entry?.parentId).toBe("population");
    expect(entry?.group).toBeUndefined();
    expect(entry?.label).toBe("ارفاق حالات استثنائية");
    // Ceiling widened from ADMIN_ONLY, then to include guest (2026-08-30) so an
    // admin can actually grant the page to any role (owner: "the app must be
    // fully customizable from admin").
    expect(entry?.allowedRoles).toEqual(["guest", "employee", "supervisor", "manager", "admin"]);
    // The stand-alone tab id is gone: nothing may resolve it any more, or a stale
    // TAB_FEATURE_MAP/permission row pointing at it would silently keep "working".
    expect(TAB_CATALOG.some((tab) => tab.id === "adhoc-import")).toBe(false);
    expect(roleCeilingFor("adhoc-import")).toBeUndefined();
    expect(TAB_ROLE_CEILINGS["adhoc-import"]).toBeUndefined();
    // The parent stays open to everyone -- the sub-tab ceiling does the gating.
    expect(roleCeilingFor("population")).toContain("employee");
  });

  it("ships ad-hoc import granted to nobody but admin, despite the widened ceiling", () => {
    // A ceiling is a cap on what an admin MAY grant, never a grant itself. This
    // pins the distinction: a fresh workspace must hand the page to no managed
    // role, and must leave both ad-hoc features off for all of them.
    const defaults = createDefaultPermissions();
    for (const role of ["guest", "employee", "supervisor", "manager"] as const) {
      const row = defaults.find(
        (permission) => permission.role === role && permission.tabId === "population/adhoc-import",
      );
      expect(row?.access, role).toBe("none");
    }
    expect(
      defaults.find(
        (permission) => permission.role === "admin" && permission.tabId === "population/adhoc-import",
      )?.access,
    ).toBe("edit");

    const featureDefaults = createDefaultFeaturePermissions();
    for (const featureId of ["adhoc-import.ingest", "adhoc-import.assign"]) {
      for (const role of ["guest", "employee", "supervisor", "manager"] as const) {
        expect(
          featureDefaults.find((item) => item.role === role && item.featureId === featureId)?.enabled,
          `${role}:${featureId}`,
        ).toBe(false);
      }
      expect(
        featureDefaults.find((item) => item.role === "admin" && item.featureId === featureId)?.enabled,
      ).toBe(true);
    }
  });

  it("never excludes admin from any tab", () => {
    for (const entry of TAB_CATALOG) {
      expect(entry.allowedRoles, entry.id).toContain("admin");
    }
  });

  it("no tab or sub-tab ceiling excludes any role any more (2026-08-30)", () => {
    // Every prior widening (adhoc-import, user-management, reports/kpi,
    // report-designer, settings) still excluded `guest` "deliberately". The owner
    // asked for that pattern to end entirely: the code ceiling should never be the
    // reason a "مقيّد بالنظام" cell shows up in the page-permissions matrix -- what
    // each role can actually do stays governed by the matrix itself
    // (createDefaultPermissions/RolePermission rows), not by a hidden code cap.
    // This is a whole-catalog guard so a future narrow ceiling gets caught here
    // instead of silently reintroducing a dead matrix cell.
    for (const entry of TAB_CATALOG) {
      expect(entry.allowedRoles, entry.id).toEqual(["guest", "employee", "supervisor", "manager", "admin"]);
    }
  });
});
