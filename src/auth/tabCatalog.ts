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

export const TAB_CATALOG: readonly TabCatalogEntry[] = [
  { id: "population", label: "إدارة بيانات الأشعة", allowedRoles: ALL_ROLES, group: "workflow" },
  { id: "population/process", label: "معالجة البيانات", parentId: "population", allowedRoles: ALL_ROLES },
  { id: "population/browse", label: "استعراض البيانات", parentId: "population", allowedRoles: ALL_ROLES },
  // Ad-hoc import ("ارفاق حالات استثنائية") moved under Population (2026-08-21): it
  // used to be a stand-alone top-level "system" tab. Its ceiling is a SUB-TAB ceiling
  // now and is independent of the parent's ALL_ROLES ceiling (see SUB_TAB_ROLE_CEILINGS).
  //
  // Widened ADMIN_ONLY -> OPERATIONAL_ROLES (2026-08-21) -> ALL_ROLES (2026-08-30):
  // a ceiling is a hard cap on what an admin may EVER grant, and excluding `guest`
  // (the read-only observer/external-auditor role) kept this row a dead "مقيّد
  // بالنظام" notice in that one column even after the first widening -- the owner's
  // requirement is that the app be fully customizable from admin, `guest` included.
  // Widening the ceiling makes the page GRANTABLE, not granted: createDefaultPermissions()
  // still ships "none" for every managed role, and the two ad-hoc features stay off
  // by default (FEATURE_DEFAULTS).
  { id: "population/adhoc-import", label: "ارفاق حالات استثنائية", parentId: "population", allowedRoles: ALL_ROLES },
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
  // grant them. (reports/kpi and reports/report-designer carry their own sub-tab
  // ceiling, independent of their parent's -- see below.)
  { id: "reports", label: "إدارة التقارير", allowedRoles: ALL_ROLES, group: "analysis" },
  { id: "reports/reports", label: "التقارير", parentId: "reports", allowedRoles: ALL_ROLES },
  // Widened ["supervisor","manager","admin"] -> OPERATIONAL_ROLES (2026-08-27,
  // added employee) -> ALL_ROLES (2026-08-30, added guest): each step closed a
  // dead matrix row/column an admin could click but the ceiling still refused.
  // createDefaultPermissions() still ships "none" for guest/employee on both,
  // so nothing is auto-elevated by this change alone.
  { id: "reports/kpi", label: "مؤشرات الأداء", parentId: "reports", allowedRoles: ALL_ROLES },
  { id: "reports/report-designer", label: "مصمم التقارير", parentId: "reports", allowedRoles: ALL_ROLES },
  { id: "archive", label: "إدارة الأرشيف", allowedRoles: ALL_ROLES, group: "analysis" },
  // Widened ADMIN_ONLY -> OPERATIONAL_ROLES (2026-08-25): an admin-only ceiling made
  // the entire section a dead "مقيّد بالنظام" block in the page-permissions matrix,
  // since admin is never a column there (MANAGED_ROLES excludes it -- see
  // userManagement.ts). That widening still excluded `guest` "deliberately" (it
  // mutates other accounts/permissions -- nothing for a viewer to view), but two of
  // these six sub-tabs (activity, actions) are pure audit-trail reads, exactly what
  // the read-only-observer role exists for, and the owner asked for every remaining
  // "مقيّد بالنظام" cell to go regardless. Widened to ALL_ROLES (2026-08-30) across
  // the board rather than splitting the six by mutate-vs-view, for one matrix rule
  // admins can reason about instead of two. Widening only makes a row GRANTABLE;
  // every managed role -- guest included -- still ships "none" by default
  // (createDefaultPermissions()), so nothing is auto-elevated by this change alone.
  { id: "user-management", label: "إدارة المستخدمين", allowedRoles: ALL_ROLES, group: "system" },
  { id: "user-management/users", label: "المستخدمون", parentId: "user-management", allowedRoles: ALL_ROLES },
  { id: "user-management/page-permissions", label: "صلاحيات الصفحات", parentId: "user-management", allowedRoles: ALL_ROLES },
  { id: "user-management/feature-permissions", label: "صلاحيات الميزات", parentId: "user-management", allowedRoles: ALL_ROLES },
  { id: "user-management/activity", label: "متابعة الأنشطة", parentId: "user-management", allowedRoles: ALL_ROLES },
  { id: "user-management/actions", label: "سجل الإجراءات", parentId: "user-management", allowedRoles: ALL_ROLES },
  { id: "user-management/performance", label: "تقييم الأداء", parentId: "user-management", allowedRoles: ALL_ROLES },
  // Widened from ["guest", "admin"] (2026-08-27): excluding employee/supervisor/
  // manager made the entire settings row a dead "مقيّد بالنظام" block for 3 of
  // the 4 managed-role columns in the page-permissions matrix. Widening only
  // makes the section GRANTABLE; createDefaultPermissions() still ships "none"
  // for every non-admin role on settings, so nothing is auto-elevated by this
  // change alone. `guest` was already allowed and stays allowed -- only widening.
  // Read-only, informational: the latest 10 notable app updates (see
  // src/data/changelog/). Ceiling is ALL_ROLES so an admin can grant it to
  // anyone; createDefaultPermissions() has no explicit row for it, so every
  // non-admin role defaults to "none" (see getRolePermission's fallback) until
  // an admin opts a role in.
  { id: "changelog", label: "سجل التحديثات", allowedRoles: ALL_ROLES, group: "system" },
  { id: "settings", label: "إدارة الإعدادات", allowedRoles: ALL_ROLES, group: "system" },
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
