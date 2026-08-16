import { describe, expect, it } from "vitest";
import { SIDEBAR_TABS } from "./tabRegistry";
import { roleCeilingFor, TAB_CATALOG } from "../../../auth/tabCatalog";

/**
 * Registry <-> catalog agreement (audit item 15).
 *
 * `tabRegistry.ts` (auto-discovered via `import.meta.glob`) and
 * `auth/tabCatalog.ts` (hand-maintained) are two independent sources for the
 * same tab/sub-tab ids. Nothing previously checked that they agree, even
 * though CLAUDE.md's "Add a tab" section claims `tabCatalog.test.ts` enforces
 * it -- that file only checks TAB_CATALOG's internal consistency, never
 * cross-references the actual registered tabs.
 *
 * The failure mode this guards against: a sub-tab id typo'd in a tab's
 * `tabConfig` (e.g. `EmployeeWorkspace/index.tsx`) builds a runtime sub-tab id
 * (App.tsx: `${prefix}${sub.id}`) that has no entry in the catalog.
 * `roleCeilingFor` then returns `undefined` for it, which App.tsx treats as
 * "no code ceiling to enforce" -- and `getRolePermission` in userManagement.ts
 * unconditionally grants admin "edit" regardless of tabId, while every other
 * role's permission-matrix lookup finds no row and defaults to "none". Net
 * effect: the mistyped tab renders and is clickable for admin only, and is
 * silently invisible/dead for every other role -- with no error anywhere.
 */

const EMPLOYEE_WORKSPACE_PREFIX = "ew/";

function subTabRuntimeId(parentId: string, subId: string): string {
  const prefix = parentId === "employee-workspace" ? EMPLOYEE_WORKSPACE_PREFIX : `${parentId}/`;
  return `${prefix}${subId}`;
}

describe("tab registry <-> tab catalog agreement", () => {
  it("has a catalog entry for every registered top-level tab, with matching allowedRoles", () => {
    for (const tab of SIDEBAR_TABS) {
      const catalogEntry = TAB_CATALOG.find((entry) => entry.id === tab.id && !entry.parentId);
      expect(catalogEntry, `top-level tab "${tab.id}" is registered but missing from TAB_CATALOG`).toBeDefined();
      expect(roleCeilingFor(tab.id), tab.id).toEqual(tab.allowedRoles);
    }
  });

  it("has a catalog entry for every registered sub-tab, with matching allowedRoles", () => {
    for (const tab of SIDEBAR_TABS) {
      if (!tab.subTabs || tab.subTabs.length === 0) continue;
      for (const sub of tab.subTabs) {
        const runtimeId = subTabRuntimeId(tab.id, sub.id);
        const catalogEntry = TAB_CATALOG.find((entry) => entry.id === runtimeId && entry.parentId);
        expect(
          catalogEntry,
          `sub-tab "${sub.id}" of "${tab.id}" resolves to runtime id "${runtimeId}", ` +
            `which is missing from TAB_CATALOG (or missing its parentId) -- this tab ` +
            `would be visible to admin only and silently dead for every other role.`
        ).toBeDefined();

        const ceiling = roleCeilingFor(runtimeId);
        if (sub.allowedRoles) {
          // A sub-tab that declares its own (narrower) allowedRoles in tabConfig must
          // agree with the catalog's own ceiling for that id.
          expect(ceiling, runtimeId).toEqual(sub.allowedRoles);
        } else {
          // A sub-tab with no explicit allowedRoles still resolves to a real ceiling
          // in the catalog (never undefined -- see failure mode above).
          expect(ceiling, runtimeId).toBeDefined();
        }
      }
    }
  });

  it("has no catalog sub-tab entry that no registered tab actually exposes", () => {
    // The reverse direction: a catalog sub-tab entry with nothing in the live
    // registry pointing at it is a dead permission-matrix row (harmless, but
    // worth surfacing rather than silently accumulating).
    const registeredRuntimeIds = new Set(
      SIDEBAR_TABS.flatMap((tab) =>
        (tab.subTabs ?? []).map((sub) => subTabRuntimeId(tab.id, sub.id))
      )
    );
    const orphanedCatalogSubTabs = TAB_CATALOG.filter(
      (entry) => entry.parentId && !registeredRuntimeIds.has(entry.id)
    ).map((entry) => entry.id);
    expect(orphanedCatalogSubTabs).toEqual([]);
  });
});
