import { Fragment } from "react";
import { ChevronRight } from "lucide-react";

import type { AuthRole } from "../../../../auth/authTypes";
import {
  MANAGED_FEATURE_GROUPS,
  MANAGED_ROLES,
  isTabRestrictedForRole,
  MANAGED_TABS,
  TAB_FEATURE_MAP,
  type FeaturePermission,
  type PermissionLevel,
  type RolePermission,
} from "../../../../auth/userManagement";
import { RoleBadge } from "./UserManagementShared";

export type FeatureSubGroup = "workspace" | "population" | "admin" | "adhoc-import";

const PERMISSION_LABELS: Record<PermissionLevel, string> = {
  none: "لا وصول",
  view: "عرض فقط",
  edit: "تعديل كامل",
};

const PERMISSION_HELP: Record<PermissionLevel, string> = {
  none: "لا تظهر الصفحة لهذا الدور.",
  view: "تظهر الصفحة دون إجراءات تعديل.",
  edit: "عرض الصفحة واستخدام أدواتها.",
};

/**
 * Shown wherever a control would otherwise be a dead toggle: the code ceiling
 * (tabCatalog.ts) excludes this role, so no matrix value can ever take effect.
 */
export const SYSTEM_RESTRICTED_LABEL = "مقيّد بالنظام — غير متاح لهذا الدور";
/** Shown on a sub-tab whose parent page is currently "لا وصول" (recoverable, not permanent). */
export const PARENT_PAGE_REQUIRED_LABEL = "يتطلب تفعيل صلاحية الصفحة الأم أولاً";
const PAGE_REQUIRED_LABEL = "يتطلب تفعيل صلاحية الصفحة أولاً";

// B1: tabId may be a top-level tab OR a sub-tab -- isTabRestrictedForRole resolves
// both, so a sub-tab with a narrower ceiling than its parent (e.g. reports/kpi) is
// locked correctly instead of silently falling back to the parent's ceiling. It is
// the same helper usePermissions/getMutationCapability gate on, so what this matrix
// paints as "restricted" is exactly what the runtime refuses.
const isCeilingLocked = isTabRestrictedForRole;

function getTabAccess(permissions: RolePermission[], role: AuthRole, tabId: string): PermissionLevel {
  if (role === "admin") return "edit";
  return permissions.find((permission) => permission.role === role && permission.tabId === tabId)?.access ?? "none";
}

function PermissionCell(props: {
  role: { id: AuthRole; label: string };
  tabId: string;
  /** Code ceiling excludes this role -- permanently inert, rendered as a notice. */
  locked: boolean;
  /** Parent page is "none" for this role, so any value here is currently inert. */
  parentBlocked: boolean;
  canEdit: boolean;
  permissions: RolePermission[];
  onUpdate: (role: AuthRole, tabId: string, access: PermissionLevel) => void;
}) {
  const { role, tabId, locked, parentBlocked, canEdit, permissions, onUpdate } = props;
  const isAdminRole = role.id === "admin";
  const current = getTabAccess(permissions, role.id, tabId);

  // A ceiling-locked cell is not a toggle at all: no value an admin picks here can
  // ever be honoured (usePermissions.canAccessTab and App.tsx both refuse first).
  // Say so, instead of rendering three greyed buttons that look merely unavailable.
  if (locked && !isAdminRole) {
    return (
      <div className="um-matrix-cell">
        <span className="um-perm-restricted" title={SYSTEM_RESTRICTED_LABEL}>
          {SYSTEM_RESTRICTED_LABEL}
        </span>
      </div>
    );
  }

  const isLocked = isAdminRole || parentBlocked || !canEdit;
  return (
    <div className="um-matrix-cell">
      <div className={`um-seg-group${parentBlocked ? " um-seg-cascade-off" : ""}`}>
        {(["none", "view", "edit"] as PermissionLevel[]).map((level) => (
          <button
            key={level}
            className={`um-seg-btn um-seg-${level} ${current === level ? "active" : ""}`}
            disabled={isLocked}
            onClick={() => onUpdate(role.id, tabId, level)}
            title={isAdminRole
              ? "مسؤول النظام يملك صلاحيات كاملة دائماً"
              : parentBlocked
                ? PARENT_PAGE_REQUIRED_LABEL
                : PERMISSION_HELP[level]}
            aria-label={`${role.label}: ${tabId} - ${PERMISSION_LABELS[level]}`}
          >
            {PERMISSION_LABELS[level]}
          </button>
        ))}
      </div>
    </div>
  );
}

export function PagePermissionsSection(props: {
  permissions: RolePermission[];
  collapsedParents: Set<string>;
  canEdit: boolean;
  onToggleParent: (tabId: string) => void;
  onUpdate: (role: AuthRole, tabId: string, access: PermissionLevel) => void;
}) {
  const topLevelTabs = MANAGED_TABS.filter((tab) => !tab.parentId);
  return (
    <div className="um-section">
      <div className="um-matrix-desc">
        حدد ما إذا كان كل دور يستطيع <strong>رؤية</strong> التبويب، أو <strong>تعديله</strong> بشكل كامل، أو لا يملك وصولاً إليه.
        تعطيل الوصول لصفحة يعطّل تلقائياً جميع ميزاتها وجميع تبويباتها الفرعية. لكل تبويب فرعي إعداد صريح مستقل عن تبويبه الأب.
        الخانات التي تحمل «{SYSTEM_RESTRICTED_LABEL}» مقيدة في الكود ولا يمكن فتحها لهذا الدور من هذه المصفوفة.
      </div>
      <div className="um-permission-legend" aria-label="شرح مستويات صلاحيات الصفحات">
        {(["edit", "view", "none"] as PermissionLevel[]).map((level) => (
          <div key={level} className={`um-permission-legend-item um-legend-${level}`}>
            <span className="um-permission-dot" aria-hidden="true" />
            <strong>{PERMISSION_LABELS[level]}</strong>
            <span>{PERMISSION_HELP[level]}</span>
          </div>
        ))}
      </div>
      <div className="um-perm-table-wrap">
        <table className="um-perm-table">
          <thead><tr><th className="um-perm-tab-col">الصفحة / التبويب</th>{MANAGED_ROLES.map((role) => <th key={role.id} className="um-perm-role-col"><RoleBadge role={role.id} /></th>)}</tr></thead>
          <tbody>
            {topLevelTabs.map((tab) => {
              const subTabs = MANAGED_TABS.filter((item) => item.parentId === tab.id);
              const hasSubTabs = subTabs.length > 0;
              const isCollapsed = props.collapsedParents.has(tab.id);
              return (
                <Fragment key={tab.id}>
                  <tr className={`um-perm-row-parent${hasSubTabs ? " um-perm-row-expandable" : ""}`} onClick={hasSubTabs ? () => props.onToggleParent(tab.id) : undefined}>
                    <td className="um-perm-tab-name">
                      {hasSubTabs && <span className="um-parent-chevron" style={{ transform: isCollapsed ? "rotate(0deg)" : "rotate(90deg)" }} aria-hidden="true"><ChevronRight size={14} /></span>}
                      <strong>{tab.label}</strong>
                      {hasSubTabs && <span className="um-subtabs-count">{subTabs.length}</span>}
                    </td>
                    {MANAGED_ROLES.map((role) => <td key={role.id} className="um-perm-cell"><PermissionCell role={role} tabId={tab.id} locked={isCeilingLocked(role.id, tab.id)} parentBlocked={false} canEdit={props.canEdit} permissions={props.permissions} onUpdate={props.onUpdate} /></td>)}
                  </tr>
                  {!isCollapsed && subTabs.map((sub) => (
                    <tr key={sub.id} className="um-perm-row-child">
                      <td className="um-perm-tab-name um-perm-subtab"><span className="um-subtab-indicator">↳</span> {sub.label}</td>
                      {/* A sub-tab is only reachable through its parent (App.tsx filters the
                          parent first, then its sub-tabs), so a grant here while the parent is
                          "لا وصول" is inert. Disable it and say why, instead of letting the
                          admin set a value that changes nothing. */}
                      {MANAGED_ROLES.map((role) => <td key={role.id} className="um-perm-cell"><PermissionCell role={role} tabId={sub.id} locked={isCeilingLocked(role.id, sub.id)} parentBlocked={getTabAccess(props.permissions, role.id, tab.id) === "none"} canEdit={props.canEdit} permissions={props.permissions} onUpdate={props.onUpdate} /></td>)}
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function FeaturePermissionsSection(props: {
  permissions: RolePermission[];
  featurePermissions: FeaturePermission[];
  featureGroup: FeatureSubGroup;
  canEdit: boolean;
  onGroupChange: (group: FeatureSubGroup) => void;
  onUpdate: (role: AuthRole, featureId: string, enabled: boolean) => void;
}) {
  const currentGroup = MANAGED_FEATURE_GROUPS.find((group) => group.groupId === props.featureGroup);
  return (
    <div className="um-section">
      <div className="um-matrix-desc">فعّل أو عطّل صلاحيات محددة لكل دور. الميزات المرتبطة بصفحة معطَّلة الوصول تظهر بلون رمادي ولا تنتج أثراً — تعطيل الصفحة يلغيها تلقائياً. أما «{SYSTEM_RESTRICTED_LABEL}» فتعني أن صفحة الميزة مقيدة في الكود لهذا الدور، ولا يمكن فتحها من المصفوفة إطلاقاً.</div>
      <div className="um-feat-nav">
        {MANAGED_FEATURE_GROUPS.map((group) => <button key={group.groupId} className={`um-feat-tab ${props.featureGroup === group.groupId ? "active" : ""}`} onClick={() => props.onGroupChange(group.groupId as FeatureSubGroup)}>{group.label}</button>)}
      </div>
      {currentGroup && (
        <div className="um-feat-matrix-wrap">
          <table className="um-feat-table">
            <thead><tr><th className="um-feat-label-col">الميزة</th>{MANAGED_ROLES.map((role) => <th key={role.id} className="um-feat-role-col"><RoleBadge role={role.id} /></th>)}</tr></thead>
            <tbody>{currentGroup.features.map((feature) => {
              const parentTabId = Object.entries(TAB_FEATURE_MAP).find(([, features]) => features.includes(feature.id))?.[0];
              const parentTabLabel = parentTabId != null ? MANAGED_TABS.find((tab) => tab.id === parentTabId)?.label : undefined;
              return <tr key={feature.id}>
                <td className="um-feat-name">
                  <strong>{feature.label}</strong>
                  <span>{feature.description}</span>
                </td>
                {MANAGED_ROLES.map((role) => {
                  // Two different reasons a feature toggle would do nothing, and they are
                  // NOT the same thing for the admin:
                  //  - restricted: the parent page's code ceiling excludes this role, so no
                  //    matrix edit anywhere can ever make the toggle count. Permanent.
                  //  - pageBlocked: the parent page is currently "لا وصول" for this role.
                  //    Recoverable -- grant the page and the toggle comes alive.
                  // The old code only recognised an *admin-only* ceiling, so settings-backed
                  // features (view-error-log, edit-interface-labels) showed the recoverable
                  // "enable the page first" hint to employee/supervisor/manager even though
                  // settings is code-gated to guest + admin and can never be granted to them.
                  const restricted = parentTabId != null && isCeilingLocked(role.id, parentTabId);
                  const pageBlocked = !restricted && parentTabId != null && getTabAccess(props.permissions, role.id, parentTabId) === "none";
                  const enabled = role.id === "admin" || (props.featurePermissions.find((item) => item.role === role.id && item.featureId === feature.id)?.enabled ?? false);
                  if (restricted) {
                    return <td key={role.id} className="um-feat-cell"><span className="um-perm-restricted" title={`${SYSTEM_RESTRICTED_LABEL}${parentTabLabel ? ` (${parentTabLabel})` : ""}`}>{SYSTEM_RESTRICTED_LABEL}</span></td>;
                  }
                  return <td key={role.id} className="um-feat-cell"><label className={`um-toggle ${pageBlocked ? "um-toggle-cascade-off" : ""}`} title={pageBlocked ? PAGE_REQUIRED_LABEL : undefined}><input type="checkbox" checked={enabled} disabled={pageBlocked || !props.canEdit} onChange={(event) => props.onUpdate(role.id, feature.id, event.target.checked)} /><span className="um-toggle-slider" /></label></td>;
                })}
              </tr>;
            })}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
