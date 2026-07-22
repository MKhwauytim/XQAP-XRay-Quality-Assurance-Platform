import type { AuthRole } from "./authTypes";

export type ManagedTab = {
  id: string;
  label: string;
  parentId?: string;
};

export type TabCatalogEntry = ManagedTab & {
  allowedRoles: readonly AuthRole[];
};

const ALL_ROLES = ["guest", "employee", "supervisor", "manager", "admin"] as const;
const REPORT_ROLES = ["guest", "supervisor", "manager", "admin"] as const;
const ADMIN_ONLY = ["admin"] as const;

export const TAB_CATALOG: readonly TabCatalogEntry[] = [
  { id: "population", label: "إدارة بيانات الأشعة", allowedRoles: ALL_ROLES },
  { id: "population/process", label: "معالجة البيانات", parentId: "population", allowedRoles: ALL_ROLES },
  { id: "population/browse", label: "استعراض البيانات", parentId: "population", allowedRoles: ALL_ROLES },
  { id: "employee-workspace", label: "إدارة مساحة العمل", allowedRoles: ALL_ROLES },
  { id: "ew/xray-referrals", label: "صور الأشعة المحالة", parentId: "employee-workspace", allowedRoles: ALL_ROLES },
  { id: "ew/xray-results", label: "نتائج فحص الأشعة", parentId: "employee-workspace", allowedRoles: ALL_ROLES },
  { id: "ew/referral-approval", label: "اعتماد الطلبات", parentId: "employee-workspace", allowedRoles: ALL_ROLES },
  { id: "ew/inspection-form", label: "نموذج الفحص (مساحة العمل)", parentId: "employee-workspace", allowedRoles: ALL_ROLES },
  { id: "ew/notifications", label: "مركز الإشعارات", allowedRoles: ALL_ROLES },
  { id: "reports", label: "إدارة التقارير", allowedRoles: REPORT_ROLES },
  { id: "reports/reports", label: "التقارير", parentId: "reports", allowedRoles: REPORT_ROLES },
  { id: "reports/kpi", label: "مؤشرات الأداء", parentId: "reports", allowedRoles: ["supervisor", "manager", "admin"] },
  { id: "reports/report-designer", label: "مصمم التقارير", parentId: "reports", allowedRoles: ["supervisor", "manager", "admin"] },
  { id: "archive", label: "إدارة الأرشيف", allowedRoles: REPORT_ROLES },
  { id: "user-management", label: "إدارة المستخدمين", allowedRoles: ADMIN_ONLY },
  { id: "user-management/users", label: "المستخدمون", parentId: "user-management", allowedRoles: ADMIN_ONLY },
  { id: "user-management/page-permissions", label: "صلاحيات الصفحات", parentId: "user-management", allowedRoles: ADMIN_ONLY },
  { id: "user-management/feature-permissions", label: "صلاحيات الميزات", parentId: "user-management", allowedRoles: ADMIN_ONLY },
  { id: "user-management/activity", label: "متابعة الأنشطة", parentId: "user-management", allowedRoles: ADMIN_ONLY },
  { id: "user-management/actions", label: "سجل الإجراءات", parentId: "user-management", allowedRoles: ADMIN_ONLY },
  { id: "settings", label: "إدارة الإعدادات", allowedRoles: ["guest", "admin"] },
  { id: "change-log", label: "سجل الإصدارات", allowedRoles: ADMIN_ONLY },
] as const;

export const MANAGED_TABS: readonly ManagedTab[] = TAB_CATALOG.map(
  ({ id, label, parentId }) => ({ id, label, ...(parentId ? { parentId } : {}) }),
);

export const TAB_ROLE_CEILINGS: Readonly<Record<string, readonly AuthRole[]>> = Object.fromEntries(
  TAB_CATALOG.filter((tab) => !tab.parentId).map((tab) => [tab.id, tab.allowedRoles]),
);

/**
 * Mirrors TAB_ROLE_CEILINGS for sub-tabs (entries with a parentId). A sub-tab's
 * ceiling is independent of its parent's and may be narrower (e.g. reports/kpi
 * vs. reports) -- callers that need to gate a specific sub-tab id must consult
 * this map (or `roleCeilingFor`), not TAB_ROLE_CEILINGS alone. Kept separate
 * from TAB_ROLE_CEILINGS because some call sites intentionally enumerate only
 * top-level tabs.
 */
export const SUB_TAB_ROLE_CEILINGS: Readonly<Record<string, readonly AuthRole[]>> = Object.fromEntries(
  TAB_CATALOG.filter((tab) => tab.parentId).map((tab) => [tab.id, tab.allowedRoles]),
);

const CATALOG_BY_ID = new Map(TAB_CATALOG.map((entry) => [entry.id, entry]));

export function tabAllowedRoles(tabId: string): readonly AuthRole[] {
  const entry = CATALOG_BY_ID.get(tabId);
  if (!entry) throw new Error(`Unknown tab catalog id: ${tabId}`);
  return entry.allowedRoles;
}

/**
 * Role ceiling for a tab OR sub-tab id, or undefined if the id is not in the
 * catalog. Use this (rather than TAB_ROLE_CEILINGS alone) whenever the id
 * might be a sub-tab -- e.g. gating `reports/kpi`, not just `reports`.
 */
export function roleCeilingFor(tabId: string): readonly AuthRole[] | undefined {
  return CATALOG_BY_ID.get(tabId)?.allowedRoles;
}
