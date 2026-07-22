import { Fragment } from "react";
import { ChevronRight } from "lucide-react";

import type { AuthRole } from "../../../../auth/authTypes";
import {
  MANAGED_FEATURE_GROUPS,
  MANAGED_ROLES,
  MANAGED_TABS,
  roleCeilingFor,
  TAB_FEATURE_MAP,
  type FeaturePermission,
  type PermissionLevel,
  type RolePermission,
} from "../../../../auth/userManagement";
import { RoleBadge } from "./UserManagementShared";

export type FeatureSubGroup = "workspace" | "population" | "admin";

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

function isCeilingLocked(role: AuthRole, tabId: string): boolean {
  // B1: tabId may be a top-level tab OR a sub-tab -- roleCeilingFor checks both,
  // so a sub-tab with a narrower ceiling than its parent (e.g. reports/kpi) is
  // locked correctly instead of silently falling back to the parent's ceiling.
  const ceiling = roleCeilingFor(tabId);
  return ceiling ? !ceiling.includes(role) : false;
}

/** True when a tab's code ceiling is admin-only -- i.e. no matrix edit can ever open it up. */
function isAdminOnlyCeiling(tabId: string): boolean {
  const ceiling = roleCeilingFor(tabId);
  return !!ceiling && ceiling.length === 1 && ceiling[0] === "admin";
}

function getTabAccess(permissions: RolePermission[], role: AuthRole, tabId: string): PermissionLevel {
  if (role === "admin") return "edit";
  return permissions.find((permission) => permission.role === role && permission.tabId === tabId)?.access ?? "none";
}

function PermissionCell(props: {
  role: { id: AuthRole; label: string };
  tabId: string;
  locked: boolean;
  canEdit: boolean;
  permissions: RolePermission[];
  onUpdate: (role: AuthRole, tabId: string, access: PermissionLevel) => void;
}) {
  const { role, tabId, locked, canEdit, permissions, onUpdate } = props;
  const isAdminRole = role.id === "admin";
  const current = getTabAccess(permissions, role.id, tabId);
  const isLocked = locked || isAdminRole || !canEdit;
  return (
    <div className="um-matrix-cell">
      <div className="um-seg-group">
        {(["none", "view", "edit"] as PermissionLevel[]).map((level) => (
          <button
            key={level}
            className={`um-seg-btn um-seg-${level} ${current === level ? "active" : ""}`}
            disabled={isLocked}
            onClick={() => onUpdate(role.id, tabId, level)}
            title={isAdminRole
              ? "مسؤول النظام يملك صلاحيات كاملة دائماً"
              : locked
                ? "هذه الصفحة مقيدة بالكود لهذه الأدوار"
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
        تعطيل الوصول لصفحة يعطّل تلقائياً جميع ميزاتها. لكل تبويب فرعي إعداد صريح مستقل عن تبويبه الأب.
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
                    {MANAGED_ROLES.map((role) => <td key={role.id} className="um-perm-cell"><PermissionCell role={role} tabId={tab.id} locked={isCeilingLocked(role.id, tab.id)} canEdit={props.canEdit} permissions={props.permissions} onUpdate={props.onUpdate} /></td>)}
                  </tr>
                  {!isCollapsed && subTabs.map((sub) => (
                    <tr key={sub.id} className="um-perm-row-child">
                      <td className="um-perm-tab-name um-perm-subtab"><span className="um-subtab-indicator">↳</span> {sub.label}</td>
                      {MANAGED_ROLES.map((role) => <td key={role.id} className="um-perm-cell"><PermissionCell role={role} tabId={sub.id} locked={isCeilingLocked(role.id, sub.id)} canEdit={props.canEdit} permissions={props.permissions} onUpdate={props.onUpdate} /></td>)}
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
      <div className="um-matrix-desc">فعّل أو عطّل صلاحيات محددة لكل دور. الميزات المرتبطة بصفحة معطَّلة الوصول تظهر بلون رمادي ولا تنتج أثراً — تعطيل الصفحة يلغيها تلقائياً.</div>
      <div className="um-feat-nav">
        {MANAGED_FEATURE_GROUPS.map((group) => <button key={group.groupId} className={`um-feat-tab ${props.featureGroup === group.groupId ? "active" : ""}`} onClick={() => props.onGroupChange(group.groupId as FeatureSubGroup)}>{group.label}</button>)}
      </div>
      {currentGroup && (
        <div className="um-feat-matrix-wrap">
          <table className="um-feat-table">
            <thead><tr><th className="um-feat-label-col">الميزة</th>{MANAGED_ROLES.map((role) => <th key={role.id} className="um-feat-role-col"><RoleBadge role={role.id} /></th>)}</tr></thead>
            <tbody>{currentGroup.features.map((feature) => {
              const parentTabId = Object.entries(TAB_FEATURE_MAP).find(([, features]) => features.includes(feature.id))?.[0];
              // Some features (manage-users, reset-passwords, edit-permissions) live on a
              // page whose ceiling is admin-only in the code -- toggling them on for any
              // other role is permanently inert, not just currently cascade-blocked by the
              // matrix. Annotate that distinction instead of showing the generic "enable
              // the page first" hint, which implies the admin could unlock it via the matrix.
              const adminOnlyPage = parentTabId != null && isAdminOnlyCeiling(parentTabId);
              return <tr key={feature.id}>
                <td className="um-feat-name">
                  <strong>{feature.label}</strong>
                  <span>{feature.description}</span>
                  {adminOnlyPage && (
                    <span style={{ display: "block", fontSize: "0.75em", opacity: 0.7, marginTop: 2 }}>
                      * صفحتها الأصلية خاصة بالمسؤول فقط بحكم الكود — تفعيلها لباقي الأدوار بلا أثر.
                    </span>
                  )}
                </td>
                {MANAGED_ROLES.map((role) => {
                  const pageBlocked = parentTabId != null && getTabAccess(props.permissions, role.id, parentTabId) === "none";
                  const ceilingScoped = adminOnlyPage && role.id !== "admin";
                  const enabled = role.id === "admin" || (props.featurePermissions.find((item) => item.role === role.id && item.featureId === feature.id)?.enabled ?? false);
                  const title = ceilingScoped
                    ? "هذه الصفحة مخصّصة للمسؤول فقط بحكم الكود — لا يمكن فتحها لباقي الأدوار"
                    : pageBlocked
                      ? "يتطلب تفعيل صلاحية الصفحة أولاً"
                      : undefined;
                  return <td key={role.id} className="um-feat-cell"><label className={`um-toggle ${pageBlocked ? "um-toggle-cascade-off" : ""}`} title={title}><input type="checkbox" checked={enabled} disabled={pageBlocked || !props.canEdit} onChange={(event) => props.onUpdate(role.id, feature.id, event.target.checked)} /><span className="um-toggle-slider" /></label></td>;
                })}
              </tr>;
            })}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
