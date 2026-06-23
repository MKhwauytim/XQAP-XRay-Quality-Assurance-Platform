import {
  createDefaultPermissions,
  createDefaultFeaturePermissions,
  getRolePermission,
  hasRolePermission,
  hasFeature,
  MANAGED_TABS,
  MANAGED_ROLES,
  normalizeUserManagementState,
} from "../../auth/userManagement";
import type { RolePermission } from "../../auth/userManagement";
import { expect, type TestSuite } from "../runner";

// normalizeUserManagementState may not be exported — guard
const normalize = (typeof normalizeUserManagementState === "function")
  ? normalizeUserManagementState
  : null;


export const permissionSuite: TestSuite = {
  name: "Permissions",
  tests: [
    // ── Admin bypass ──────────────────────────────────────────────────────────
    {
      name: "admin always gets 'edit' regardless of permissions array",
      fn() {
        for (const tab of MANAGED_TABS) {
          expect(getRolePermission([], "admin", tab.id)).toBe("edit");
        }
      },
    },
    {
      name: "admin bypass works even with explicit 'none' stored",
      fn() {
        const perms: RolePermission[] = [
          { role: "admin", tabId: "population", access: "none" },
        ];
        expect(getRolePermission(perms, "admin", "population")).toBe("edit");
      },
    },

    // ── Guest defaults ────────────────────────────────────────────────────────
    {
      name: "guest gets 'none' on all tabs with empty permissions",
      fn() {
        for (const tab of MANAGED_TABS) {
          const result = getRolePermission([], "guest", tab.id);
          expect(result).toBe("none");
        }
      },
    },

    // ── Sub-tab inheritance ───────────────────────────────────────────────────
    {
      name: "sub-tab inherits 'edit' from parent when no explicit entry",
      fn() {
        const perms: RolePermission[] = [
          { role: "employee", tabId: "employee-workspace", access: "edit" },
        ];
        const subTabs = MANAGED_TABS.filter((t) => t.parentId === "employee-workspace");
        expect(subTabs.length).toBeGreaterThan(0);
        for (const sub of subTabs) {
          expect(getRolePermission(perms, "employee", sub.id)).toBe("edit");
        }
      },
    },
    {
      name: "sub-tab inherits 'view' from parent when no explicit entry",
      fn() {
        const perms: RolePermission[] = [
          { role: "employee", tabId: "employee-workspace", access: "view" },
        ];
        const subTabs = MANAGED_TABS.filter((t) => t.parentId === "employee-workspace");
        for (const sub of subTabs) {
          expect(getRolePermission(perms, "employee", sub.id)).toBe("view");
        }
      },
    },
    {
      name: "explicit sub-tab permission overrides parent inheritance",
      fn() {
        const perms: RolePermission[] = [
          { role: "employee", tabId: "employee-workspace", access: "edit" },
          { role: "employee", tabId: "ew/stats-dashboard", access: "none" },
        ];
        expect(getRolePermission(perms, "employee", "ew/stats-dashboard")).toBe("none");
      },
    },
    {
      name: "sub-tab returns 'none' when parent is absent from permissions",
      fn() {
        const perms: RolePermission[] = [];
        expect(getRolePermission(perms, "employee", "ew/stats-dashboard")).toBe("none");
      },
    },

    // ── hasRolePermission threshold ───────────────────────────────────────────
    {
      name: "hasRolePermission returns true when access >= min",
      fn() {
        const perms: RolePermission[] = [
          { role: "employee", tabId: "population", access: "edit" },
        ];
        expect(hasRolePermission(perms, "employee", "population", "view")).toBe(true);
        expect(hasRolePermission(perms, "employee", "population", "edit")).toBe(true);
      },
    },
    {
      name: "hasRolePermission returns false when access < min",
      fn() {
        const perms: RolePermission[] = [
          { role: "employee", tabId: "population", access: "view" },
        ];
        expect(hasRolePermission(perms, "employee", "population", "edit")).toBe(false);
      },
    },
    {
      name: "admin passes hasRolePermission for any min level",
      fn() {
        expect(hasRolePermission([], "admin", "user-management", "edit")).toBe(true);
        expect(hasRolePermission([], "admin", "settings", "edit")).toBe(true);
      },
    },

    // ── createDefaultPermissions completeness ─────────────────────────────────
    {
      name: "createDefaultPermissions covers all MANAGED_ROLES × top-level MANAGED_TABS",
      fn() {
        const defaults = createDefaultPermissions();
        const topTabs = MANAGED_TABS.filter((t) => !t.parentId);
        for (const role of MANAGED_ROLES) {
          for (const tab of topTabs) {
            const found = defaults.find((p) => p.role === role.id && p.tabId === tab.id);
            if (!found) {
              throw new Error(`Missing default for role="${role.id}" tabId="${tab.id}"`);
            }
          }
        }
      },
    },
    {
      name: "createDefaultPermissions: admin entries all have 'edit'",
      fn() {
        const defaults = createDefaultPermissions();
        const adminPerms = defaults.filter((p) => p.role === "admin");
        for (const p of adminPerms) {
          if (p.access !== "edit") {
            throw new Error(`Admin permission for "${p.tabId}" is "${p.access}", expected "edit"`);
          }
        }
      },
    },
    {
      name: "createDefaultPermissions: guest entries never have 'edit' (read-only role)",
      fn() {
        const defaults = createDefaultPermissions();
        const guestPerms = defaults.filter((p) => p.role === "guest");
        for (const p of guestPerms) {
          if (p.access === "edit") {
            throw new Error(`Guest permission for "${p.tabId}" is "edit" — guest must be read-only`);
          }
        }
      },
    },
    {
      name: "createDefaultPermissions: no duplicate role+tabId entries",
      fn() {
        const defaults = createDefaultPermissions();
        const seen = new Set<string>();
        for (const p of defaults) {
          const key = `${p.role}:${p.tabId}`;
          if (seen.has(key)) throw new Error(`Duplicate entry: ${key}`);
          seen.add(key);
        }
      },
    },

    // ── MANAGED_TABS structure ────────────────────────────────────────────────
    {
      name: "all sub-tabs reference an existing parent tab",
      fn() {
        const topIds = new Set(MANAGED_TABS.filter((t) => !t.parentId).map((t) => t.id));
        for (const tab of MANAGED_TABS.filter((t) => t.parentId)) {
          if (!topIds.has(tab.parentId!)) {
            throw new Error(`Sub-tab "${tab.id}" references missing parent "${tab.parentId}"`);
          }
        }
      },
    },
    {
      name: "all MANAGED_TABS have unique IDs",
      fn() {
        const ids = MANAGED_TABS.map((t) => t.id);
        const unique = new Set(ids);
        if (unique.size !== ids.length) {
          throw new Error(`Duplicate tab IDs detected`);
        }
      },
    },

    // ── hasFeature ────────────────────────────────────────────────────────────
    {
      name: "admin hasFeature returns true for any feature",
      fn() {
        const feats = createDefaultFeaturePermissions();
        // pick a feature that might be false for admin
        expect(hasFeature(feats, "admin", "approve-referrals")).toBe(true);
        expect(hasFeature(feats, "admin", "manage-users")).toBe(true);
      },
    },
    {
      name: "guest hasFeature returns false for privileged features",
      fn() {
        const feats = createDefaultFeaturePermissions();
        expect(hasFeature(feats, "guest", "manage-users")).toBe(false);
        expect(hasFeature(feats, "guest", "approve-referrals")).toBe(false);
      },
    },

    // ── Normalize state idempotency ───────────────────────────────────────────
    {
      name: "normalize preserves custom permissions not in defaults",
      skip: !normalize,
      fn() {
        const custom: RolePermission[] = [
          { role: "employee", tabId: "user-management", access: "view" },
        ];
        const state = { users: [], permissions: custom, featurePermissions: [] } satisfies Parameters<typeof normalizeUserManagementState>[0];
        const result = normalize!(state);
        const found = result.permissions.find(
          (p: RolePermission) => p.role === "employee" && p.tabId === "user-management"
        );
        if (!found) throw new Error("Custom permission was dropped by normalizer");
        expect(found.access).toBe("view");
      },
    },
  ],
};
