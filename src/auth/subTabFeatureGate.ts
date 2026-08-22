import type { AuthRole } from "./authTypes";
import { hasFeature, type FeaturePermission } from "./userManagement";

/**
 * Audit finding 14: a sub-tab's sidebar LINK used to be gated purely on
 * page-level "view" access (App.tsx's `allowedTabs` filter / `hasRolePermission`),
 * while the sub-tab's own CONTENT could additionally require one of several
 * specific FEATURE grants (e.g. EmployeeWorkspace's `ew/xray-referrals` view
 * needs at least one of submit-answers/submit-referrals/request-replacement/
 * view-all-entries -- page "view" access alone renders nothing useful). When
 * a role had page access but none of the required features, the sidebar
 * still showed a clickable link whose content was `<AccessDenied />` -- a
 * dead link the admin has no way to predict from the permission matrix alone.
 *
 * This map is the single source of truth for "which features gate this
 * sub-tab's content" so App.tsx's sidebar filter and the owning tab's own
 * internal gate (currently EmployeeWorkspaceTab) read the exact same rule and
 * cannot drift out of sync with each other. A sub-tab absent from this map
 * has no extra feature requirement -- page-level "view" access is sufficient,
 * matching every sub-tab's behavior before this fix.
 */
export const SUB_TAB_FEATURE_MAP: Readonly<Record<string, readonly string[]>> = {
  "ew/xray-referrals": ["submit-answers", "submit-referrals", "request-replacement", "view-all-entries"],
  "ew/referral-approval": ["approve-referrals", "approve-replacements", "ew.reopenAnswer"],
  // Ad-hoc import moved under Population (2026-08-21). Now that its sub-tab ceiling
  // is grantable beyond admin, this map is load-bearing rather than belt-and-braces:
  // a role granted the page but neither feature would otherwise see a link to a page
  // whose every action is refused -- exactly the dead link this map exists to prevent.
  "population/adhoc-import": ["adhoc-import.ingest", "adhoc-import.assign"],
};

/**
 * True when `subTabId` carries no extra feature requirement (absent from
 * `SUB_TAB_FEATURE_MAP`) OR at least one of its required features is enabled
 * for `role` (OR semantics -- any one qualifying feature is enough, matching
 * EmployeeWorkspaceTab's pre-existing per-subtab checks). Callers must still
 * separately check page-level view access (`canAccessTab`/`hasRolePermission`)
 * -- this only covers the feature half of the gate.
 */
export function hasRequiredSubTabFeature(
  subTabId: string,
  role: AuthRole,
  featurePermissions: FeaturePermission[]
): boolean {
  const required = SUB_TAB_FEATURE_MAP[subTabId];
  if (!required || required.length === 0) return true;
  return required.some((featureId) => hasFeature(featurePermissions, role, featureId));
}
