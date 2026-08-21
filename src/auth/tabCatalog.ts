import type { AuthRole } from "./authTypes";

export type ManagedTab = {
  id: string;
  label: string;
  parentId?: string;
};

/**
 * Nav-layout metadata: which heading a TOP-LEVEL tab sits under in the grouped
 * sidebar rail. Deliberately lives here rather than in each tab's `tabConfig`
 * because it describes the navigation's shape, not the tab itself -- the tab
 * set, labels, icons and order still come from `tabConfig` via SIDEBAR_TABS.
 * Sub-tab entries never carry a group (they render beneath their parent).
 */
export type TabNavGroup = "workflow" | "analysis" | "system";

/** Render order of the three sidebar group headings. */
export const TAB_NAV_GROUP_ORDER: readonly TabNavGroup[] = ["workflow", "analysis", "system"];

export type TabCatalogEntry = ManagedTab & {
  allowedRoles: readonly AuthRole[];
  group?: TabNavGroup;
};

const ALL_ROLES = ["guest", "employee", "supervisor", "manager", "admin"] as const;
const ADMIN_ONLY = ["admin"] as const;

export const TAB_CATALOG: readonly TabCatalogEntry[] = [
  { id: "population", label: "إدارة بيانات الأشعة", allowedRoles: ALL_ROLES, group: "workflow" },
  { id: "population/process", label: "معالجة البيانات", parentId: "population", allowedRoles: ALL_ROLES },
  { id: "population/browse", label: "استعراض البيانات", parentId: "population", allowedRoles: ALL_ROLES },
  // Ad-hoc import moved under Population (2026-08-21): it used to be a stand-alone
  // top-level "system" tab. Its ADMIN_ONLY ceiling is a SUB-TAB ceiling now and is
  // independent of the parent's ALL_ROLES ceiling (see SUB_TAB_ROLE_CEILINGS), so
  // the page stays admin-only even though Population itself is open to every role.
  { id: "population/adhoc-import", label: "استيراد بيانات مخصص", parentId: "population", allowedRoles: ADMIN_ONLY },
  { id: "employee-workspace", label: "إدارة مساحة العمل", allowedRoles: ALL_ROLES, group: "workflow" },
  { id: "ew/xray-referrals", label: "صور الأشعة المحالة", parentId: "employee-workspace", allowedRoles: ALL_ROLES },
  { id: "ew/xray-results", label: "نتائج فحص الأشعة", parentId: "employee-workspace", allowedRoles: ALL_ROLES },
  { id: "ew/referral-approval", label: "اعتماد الطلبات", parentId: "employee-workspace", allowedRoles: ALL_ROLES },
  { id: "ew/inspection-form", label: "نموذج الفحص (مساحة العمل)", parentId: "employee-workspace", allowedRoles: ALL_ROLES },
  { id: "ew/notifications", label: "مركز الإشعارات", allowedRoles: ALL_ROLES, group: "workflow" },
  // Reports + Archive used to exclude "employee" from their code ceiling, which made
  // the whole employee column of those matrix rows a dead control: an admin could
  // click it but canAccessTab/App.tsx would still refuse. Nothing in the product
  // requires reports or archive to be closed to employees -- the shipped matrix
  // defaults still ship them as "none", so this only restores the admin's ability to
  // grant them. (reports/kpi and reports/report-designer keep their own, narrower
  // ceilings -- a sub-tab ceiling is independent of its parent's.)
  { id: "reports", label: "إدارة التقارير", allowedRoles: ALL_ROLES, group: "analysis" },
  { id: "reports/reports", label: "التقارير", parentId: "reports", allowedRoles: ALL_ROLES },
  { id: "reports/kpi", label: "مؤشرات الأداء", parentId: "reports", allowedRoles: ["supervisor", "manager", "admin"] },
  { id: "reports/report-designer", label: "مصمم التقارير", parentId: "reports", allowedRoles: ["supervisor", "manager", "admin"] },
  { id: "archive", label: "إدارة الأرشيف", allowedRoles: ALL_ROLES, group: "analysis" },
  { id: "user-management", label: "إدارة المستخدمين", allowedRoles: ADMIN_ONLY, group: "system" },
  { id: "user-management/users", label: "المستخدمون", parentId: "user-management", allowedRoles: ADMIN_ONLY },
  { id: "user-management/page-permissions", label: "صلاحيات الصفحات", parentId: "user-management", allowedRoles: ADMIN_ONLY },
  { id: "user-management/feature-permissions", label: "صلاحيات الميزات", parentId: "user-management", allowedRoles: ADMIN_ONLY },
  { id: "user-management/activity", label: "متابعة الأنشطة", parentId: "user-management", allowedRoles: ADMIN_ONLY },
  { id: "user-management/actions", label: "سجل الإجراءات", parentId: "user-management", allowedRoles: ADMIN_ONLY },
  { id: "settings", label: "إدارة الإعدادات", allowedRoles: ["guest", "admin"], group: "system" },
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

/**
 * Sidebar heading a top-level tab belongs under. Falls back to "system" so a
 * newly registered tab that nobody has grouped yet still renders (at the
 * bottom) instead of vanishing from the rail. `tabCatalog.test.ts` asserts
 * every top-level entry carries an explicit group, so the fallback is a
 * runtime safety net, not a licence to omit one.
 */
export function navGroupFor(tabId: string): TabNavGroup {
  return CATALOG_BY_ID.get(tabId)?.group ?? "system";
}
