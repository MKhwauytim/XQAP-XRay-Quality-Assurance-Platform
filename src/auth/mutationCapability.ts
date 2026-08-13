import type { AuthRole } from "./authTypes";
import {
  FEATURE_MUTATION_STORAGE_LOOKUP,
  FEATURE_TAB_LOOKUP,
  hasFeature,
  hasRolePermission,
  isTabRestrictedForRole,
  type FeaturePermission,
  type RolePermission,
} from "./userManagement";

export type MutationDenialReason =
  | "unknown-feature"
  | "page-not-editable"
  | "feature-disabled"
  | "read-only-mode"
  | "workspace-unavailable";

export type MutationCapability =
  | { allowed: true; reason: null }
  | { allowed: false; reason: MutationDenialReason };

type MutationCapabilityInput = {
  role: AuthRole;
  featureId: string;
  permissions: RolePermission[];
  featurePermissions: FeaturePermission[];
  isReadOnly: boolean;
  workspaceReady: boolean;
};

/**
 * Central authorization decision for commands that change application or
 * workspace state. Visibility checks use `can`; mutations must use this helper.
 */
export function getMutationCapability({
  role,
  featureId,
  permissions,
  featurePermissions,
  isReadOnly,
  workspaceReady,
}: MutationCapabilityInput): MutationCapability {
  const tabId = FEATURE_TAB_LOOKUP[featureId];
  if (!tabId) return { allowed: false, reason: "unknown-feature" };

  // The code ceiling caps what the matrix can grant (canAccessTab enforces the same
  // rule for navigation). Without this, a permission row that is outside the ceiling
  // -- impossible to create in the UI, but reachable via a hand-edited
  // users.permissions.json or a file written before a ceiling narrowed -- would still
  // authorize mutations on a page the role can never actually open.
  if (isTabRestrictedForRole(role, tabId)) {
    return { allowed: false, reason: "page-not-editable" };
  }

  if (!hasRolePermission(permissions, role, tabId, "edit")) {
    return { allowed: false, reason: "page-not-editable" };
  }

  if (!hasFeature(featurePermissions, role, featureId)) {
    return { allowed: false, reason: "feature-disabled" };
  }

  if (isReadOnly) return { allowed: false, reason: "read-only-mode" };

  if (
    FEATURE_MUTATION_STORAGE_LOOKUP[featureId] === "workspace" &&
    !workspaceReady
  ) {
    return { allowed: false, reason: "workspace-unavailable" };
  }

  return { allowed: true, reason: null };
}
