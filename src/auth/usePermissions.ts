import { useEffect, useState } from "react";
import { isReadOnlyMode } from "../data/storage/readOnlyMode";
import { useWorkspace } from "../data/workspace/useWorkspace";
import { readSession } from "./authSession";
import type { AuthRole } from "./authTypes";
import {
  getMutationCapability,
  type MutationCapability,
} from "./mutationCapability";
import {
  FEATURE_TAB_LOOKUP,
  hasFeature,
  hasRolePermission,
  readUserManagementState,
  subscribeToUserManagementChanges,
  type FeaturePermission,
  type PermissionLevel,
  type RolePermission,
} from "./userManagement";

export type UsePermissionsResult = {
  role: AuthRole;
  username: string;
  /**
   * True if the current role has at least `min` access on the tab.
   * Checks the tab permission matrix (Matrix A).
   */
  canAccessTab: (tabId: string, min?: Exclude<PermissionLevel, "none">) => boolean;
  /**
   * True if the current role has this feature enabled AND the parent tab
   * is not blocked. Cascade: page=none → all features on that page return false.
   */
  can: (featureId: string) => boolean;
  /**
   * Authorizes a state-changing command. Unlike `can`, this requires edit
   * access on the parent page and rejects the global read-only/demo mode.
   */
  canMutate: (featureId: string) => boolean;
  getMutationCapability: (featureId: string) => MutationCapability;
  permissions: RolePermission[];
  featurePermissions: FeaturePermission[];
};

const GUEST_FALLBACK: UsePermissionsResult = {
  role: "guest",
  username: "",
  canAccessTab: () => false,
  can: () => false,
  canMutate: () => false,
  getMutationCapability: () => ({ allowed: false, reason: "page-not-editable" }),
  permissions: [],
  featurePermissions: [],
};

export function usePermissions(): UsePermissionsResult {
  const [, forceUpdate] = useState(0);
  const { directoryHandle, status: workspaceStatus } = useWorkspace();

  useEffect(() => {
    return subscribeToUserManagementChanges(() => forceUpdate((n) => n + 1));
  }, []);

  const session = readSession();
  if (!session) return GUEST_FALLBACK;

  const state = readUserManagementState();
  const { role, username } = session;
  const mutationCapability = (featureId: string) =>
    getMutationCapability({
      role,
      featureId,
      permissions: state.permissions,
      featurePermissions: state.featurePermissions,
      isReadOnly: session.mode === "demo" || isReadOnlyMode(),
      workspaceReady:
        workspaceStatus === "ready" && directoryHandle !== null,
    });

  return {
    role,
    username,
    canAccessTab: (tabId, min = "view") =>
      hasRolePermission(state.permissions, role, tabId, min),
    can: (featureId) => {
      // Cascade: if the parent tab has no access, block the feature regardless
      // of what the feature toggle says.
      const tabId = FEATURE_TAB_LOOKUP[featureId];
      if (tabId && !hasRolePermission(state.permissions, role, tabId)) {
        return false;
      }
      return hasFeature(state.featurePermissions, role, featureId);
    },
    canMutate: (featureId) => mutationCapability(featureId).allowed,
    getMutationCapability: mutationCapability,
    permissions: state.permissions,
    featurePermissions: state.featurePermissions,
  };
}
