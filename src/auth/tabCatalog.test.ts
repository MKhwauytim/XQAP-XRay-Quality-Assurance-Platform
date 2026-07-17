import { describe, expect, it } from "vitest";
import { MANAGED_TABS, TAB_CATALOG, TAB_ROLE_CEILINGS, tabAllowedRoles } from "./tabCatalog";

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
});
