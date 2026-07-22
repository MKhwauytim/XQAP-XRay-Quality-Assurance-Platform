import { describe, expect, it } from "vitest";
import {
  MANAGED_TABS,
  roleCeilingFor,
  SUB_TAB_ROLE_CEILINGS,
  TAB_CATALOG,
  TAB_ROLE_CEILINGS,
  tabAllowedRoles,
} from "./tabCatalog";

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

  it("widens reports/kpi to include supervisor while report-designer keeps excluding guest", () => {
    // Synthesis finding: reports/kpi's sub-tab ceiling was never actually enforced,
    // so supervisors already got working "view" access per the permission matrix
    // defaults. Once sub-tab ceilings are enforced (B1), the ceiling itself must
    // widen to match that tested reality instead of silently breaking supervisors.
    expect(roleCeilingFor("reports/kpi")).toEqual(["supervisor", "manager", "admin"]);
    expect(roleCeilingFor("reports/kpi")).not.toContain("guest");
    expect(roleCeilingFor("reports/kpi")).not.toContain("employee");
    expect(roleCeilingFor("reports/report-designer")).not.toContain("guest");
  });
});
