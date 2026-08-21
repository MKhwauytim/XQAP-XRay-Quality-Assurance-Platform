import type { PasswordHashRecord } from "./passwordCrypto";
import type { AuthRole, LoginUser } from "./authTypes";
import { BOOTSTRAP_ADMIN_PASSWORD_HASH } from "./authConfig";
import { MANAGED_TABS, roleCeilingFor as resolveRoleCeiling } from "./tabCatalog";
export { MANAGED_TABS, roleCeilingFor, SUB_TAB_ROLE_CEILINGS, TAB_ROLE_CEILINGS } from "./tabCatalog";
export type { ManagedTab } from "./tabCatalog";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ManagedLoginUser = LoginUser & {
  id: string;
  hasCertScanLicense: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PermissionLevel = "none" | "view" | "edit";

export type RolePermission = {
  role: AuthRole;
  tabId: string;
  access: PermissionLevel;
};

export type FeaturePermission = {
  role: AuthRole;
  featureId: string;
  enabled: boolean;
};

export type FeatureDefinition = {
  id: string;
  label: string;
  description: string;
  /** Defaults to workspace-backed so new mutations fail closed without a mounted workspace. */
  mutationStorage?: "workspace" | "browser";
};

export type FeatureGroup = {
  groupId: string;
  label: string;
  features: readonly FeatureDefinition[];
};

/**
 * The bootstrap admin account's editable settings. Lives alongside users and
 * permissions in `3-user-data/users.permissions.json`, so a passcode change
 * follows the workspace across machines instead of being trapped in one
 * browser's storage.
 */
export type AdminAccountSettings = {
  /** `null` = still using the shipped default (see BOOTSTRAP_ADMIN_PASSWORD_HASH). */
  passwordHash: PasswordHashRecord | null;
  /**
   * When true, "admin" can be typed into the normal sign-in form like any other
   * username. When false, the only way in is the hidden Alt+A / Alt+T shortcut.
   */
  allowUsernameLogin: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
};

export type UserManagementState = {
  users: ManagedLoginUser[];
  permissions: RolePermission[];
  featurePermissions: FeaturePermission[];
  adminAccount: AdminAccountSettings;
};

/**
 * What callers may hand to `writeUserManagementState` /
 * `normalizeUserManagementState`: `adminAccount` and `users` are optional on the
 * way in (the normalizer fills them from defaults) but always present on the way
 * out.
 *
 * `users` distinguishes "never initialised" (absent — seed the shipped roster)
 * from "deliberately emptied" (`[]` — keep it empty). Collapsing the two brought
 * every seeded account, default password included, back the moment an admin
 * deleted the last managed user.
 */
export type UserManagementStateInput = Omit<UserManagementState, "adminAccount" | "users"> & {
  users?: ManagedLoginUser[];
  adminAccount?: AdminAccountSettings;
};

// Shipped default password for every seeded user: "123" (owner request,
// 2026-08-13). Argon2id, m=19456,t=2,p=1. Advisory-only security model — this
// is a convenience default meant to be changed per user from User Management.
const DEFAULT_USER_PASSWORD_HASH: PasswordHashRecord = {
  algorithm: "argon2id",
  encoded: "$argon2id$v=19$m=19456,t=2,p=1$BeVmV3uShU0Y0cJALo5tcw$ihvHPBcz3WBVYg9EmrgY5lg3bJQXLtf4OFCSYAqXaPA"
};

// ── Runtime state & event ─────────────────────────────────────────────────────

const CHANGE_EVENT_NAME = "xray-user-management-change";
let runtimeUserManagementState: UserManagementState | null = null;

// ── Role catalogue (excludes admin — bootstrap superuser managed separately) ──

export const MANAGED_ROLES: Array<{
  id: AuthRole;
  label: string;
  description: string;
}> = [
  {
    id: "guest",
    label: "ضيف",
    description: "وصول قراءة فقط — مراقب أو مدقق خارجي.",
  },
  {
    id: "employee",
    label: "موظف",
    description: "يستلم عينات ويملأ نماذج الفحص.",
  },
  {
    id: "supervisor",
    label: "مشرف",
    description: "يراقب الموظفين ويعتمد الطلبات.",
  },
  {
    id: "manager",
    label: "مدير",
    description: "يدير دورة البيانات كاملةً.",
  },
];

// ── Tab catalogue ─────────────────────────────────────────────────────────────

// ── Feature catalogue ─────────────────────────────────────────────────────────

export const MANAGED_FEATURE_GROUPS: readonly FeatureGroup[] = [
  {
    groupId: "workspace",
    label: "إدارة مساحة العمل",
    features: [
      {
        id: "approve-referrals",
        label: "اعتماد طلبات الإحالة",
        description: "الموافقة على أو رفض طلبات إحالة العينات للموظفين",
      },
      {
        id: "approve-replacements",
        label: "اعتماد طلبات الاستبدال",
        description: "الموافقة على أو رفض طلبات استبدال العينات غير الموصى بها",
      },
      {
        id: "view-all-entries",
        label: "عرض عينات جميع الموظفين",
        description: "مشاهدة عينات الموظفين الآخرين — لا عيناته الشخصية فقط",
      },
      {
        id: "submit-referrals",
        label: "تقديم طلبات الإحالة",
        description: "إحالة عينات معينة لموظفين آخرين",
      },
      {
        id: "request-replacement",
        label: "طلب استبدال عينة",
        description: "طلب استبدال عينة من مجتمع الأشعة",
      },
      {
        id: "bulk-reassign-referrals",
        label: "إعادة تعيين العينات دفعة واحدة",
        description: "تحديد عدة عينات — يدوياً أو حسب التصفية الحالية — وإعادة تعيينها لموظف آخر دفعة واحدة من قائمة الإحالات",
      },
      {
        id: "submit-answers",
        label: "تقديم إجابات الفحص",
        description: "ملء نموذج الفحص وتقديم الإجابات",
      },
      {
        id: "configure-referral-columns",
        label: "تخصيص أعمدة صور الأشعة المحالة",
        description: "إظهار زر الأعمدة وتغيير الأعمدة الظاهرة في جدول صور الأشعة المحالة",
        mutationStorage: "browser",
      },
      {
        id: "ew.reopenAnswer",
        label: "إعادة فتح الإجابات المقدمة",
        description: "إرجاع إجابة مقدمة إلى مسودة ليتمكن الموظف من تصحيحها",
      },
      {
        id: "manage-inspection-template",
        label: "إدارة نموذج الفحص",
        description: "إنشاء وتعديل قوالب نموذج الفحص في مساحة العمل",
      },
      {
        id: "employee-reopen-instant",
        label: "إعادة فتح الحالة فوراً (بدون اعتماد)",
        description: "عند التفعيل يُطبَّق طلب الموظف لإعادة فتح الحالة فوراً؛ وعند التعطيل يُحوَّل الطلب للمشرف للاعتماد",
      },
      {
        id: "post-notification",
        label: "نشر إشعار جديد",
        description: "نشر إشعار لجميع الموظفين والمشرفين في مركز الإشعارات ومتابعة من اطّلع عليه",
      },
    ],
  },
  {
    groupId: "population",
    label: "معالجة المجتمع",
    features: [
      {
        id: "upload-data",
        label: "رفع ملفات المجتمع",
        description: "تحميل ملفات البيانات الخام في المرحلة الأولى",
      },
      {
        id: "process-population",
        label: "معالجة بيانات المجتمع",
        description: "تشغيل عملية المعالجة والتصفية في المرحلة الثانية",
      },
      {
        id: "configure-sample",
        label: "إعداد معايير العينة",
        description: "ضبط معايير ونسب سحب العينة في المرحلة الثالثة",
      },
      {
        id: "draw-sample",
        label: "سحب العينة",
        description: "تنفيذ عملية سحب العينة العشوائية",
      },
      {
        id: "distribute-samples",
        label: "توزيع العينات",
        description: "توزيع العينات على الموظفين في المرحلة الرابعة",
      },
      {
        id: "bulk-assign",
        label: "التعيين الجماعي",
        description: "تعيين العينات للموظفين بالكميات دفعة واحدة",
      },
      {
        id: "view-browse",
        label: "تصفح بيانات المجتمع",
        description: "استعراض جدول بيانات المجتمع والإحصائيات",
      },
      {
        id: "unlock-sampling-stage",
        label: "إلغاء قفل مراحل العينة",
        description: "فتح المراحل المقفلة (تلقائياً أو يدوياً) في إعداد سحب العينة",
      },
    ],
  },
  {
    groupId: "admin",
    label: "الإدارة والتقارير",
    features: [
      {
        id: "manage-users",
        label: "إدارة المستخدمين",
        description: "إضافة وتعديل وتعطيل حسابات المستخدمين",
        mutationStorage: "browser",
      },
      {
        id: "reset-passwords",
        label: "إعادة تعيين كلمات المرور",
        description: "تغيير كلمات مرور المستخدمين الآخرين",
        mutationStorage: "browser",
      },
      {
        id: "edit-permissions",
        label: "تعديل مصفوفة الصلاحيات",
        description: "تغيير صلاحيات الأدوار في مصفوفتَي الصفحات والميزات",
        mutationStorage: "browser",
      },
      {
        id: "export-reports",
        label: "تصدير التقارير",
        description: "تنزيل ملفات التقارير بصيغة Excel أو PDF",
      },
      {
        id: "archive.closeMonth",
        label: "إقفال الأشهر وإعادة فتحها",
        description: "إقفال شهر لمنع أي تعديل على بياناته أو إعادة فتحه للتعديل",
      },
      {
        id: "view-error-log",
        label: "عرض سجل الأخطاء",
        description: "إظهار سجل الأخطاء الأخيرة داخل صفحة الإعدادات",
      },
      {
        id: "archive.createBackup",
        label: "إنشاء النسخ الاحتياطية",
        description: "إنشاء نسخة احتياطية يدوية وتغيير جدول النسخ التلقائي",
      },
      {
        id: "archive.restoreBackup",
        label: "استعادة النسخ الاحتياطية",
        description: "استعادة نسخة سابقة واستيراد المستخدمين والتسميات منها",
      },
      {
        id: "report-designer.edit",
        label: "تحرير تصاميم التقارير",
        description: "إنشاء تصاميم التقارير وتعديلها وحذفها",
      },
      {
        id: "settings.syncInterval",
        label: "تعديل فترة المزامنة التلقائية",
        description: "تغيير عدد الثواني بين عمليات المزامنة التلقائية لكل الأجهزة",
      },
      {
        id: "settings.adminAccount",
        label: "تعديل حساب المدير",
        description: "تغيير طريقة تسجيل دخول المدير أو كلمة مرور حساب المدير الأساسي",
        // Unlike settings.syncInterval, this can legitimately apply with no
        // workspace connected — AdminAccountSection's own persist() falls back
        // to a session-only change (with its own explicit message) rather than
        // hard-failing, so the mutation must not be blocked purely on
        // workspaceReady the way workspace-backed features are.
        mutationStorage: "browser",
      },
      {
        id: "edit-interface-labels",
        label: "تعديل تسميات الواجهة",
        description: "تعديل نصوص الواجهة واستعادة قيمها الافتراضية من صفحة الإعدادات",
        mutationStorage: "browser",
      },
    ],
  },
  {
    // Kept as its own group after the 2026-08-21 move under Population. These
    // groupIds are a UI grouping for the feature-permissions screen only — they are
    // NOT tab ids and nothing resolves them against the catalog (TAB_FEATURE_MAP,
    // which is what drives the cascade, is a separate map). Folding these two into
    // the "population" group would bury them among eight sampling/processing
    // features they have nothing to do with; a named group keeps the admin's mental
    // model of "the ad-hoc importer's permissions" intact.
    groupId: "adhoc-import",
    label: "استيراد بيانات مخصص",
    features: [
      {
        id: "adhoc-import.ingest",
        label: "رفع ومعالجة ملف مخصص",
        description: "رفع ملف إكسل مستقل خارج مسار معالجة المجتمع المعتاد ومطابقة أعمدته",
      },
      {
        id: "adhoc-import.assign",
        label: "تعيين صفوف مخصصة للموظفين",
        description: "تعيين صفوف من ملف مستورد يدوياً لموظف عبر سجل التوزيع القياسي",
      },
    ],
  },
] as const;

// Flat list of all feature IDs — used internally for defaults/normalization
const ALL_FEATURE_IDS = MANAGED_FEATURE_GROUPS.flatMap((g) =>
  g.features.map((f) => f.id)
);

/** Maps each tab to the feature IDs that belong to it. */
export const TAB_FEATURE_MAP: Readonly<Record<string, readonly string[]>> = {
  // adhoc-import.ingest / adhoc-import.assign live here (not under their own tab id)
  // since the ad-hoc importer moved under Population as the `population/adhoc-import`
  // sub-tab (2026-08-21). FEATURE_TAB_LOOKUP is derived from this map and drives
  // can()/getMutationCapability()'s cascade against the PARENT tab's grant, so a key
  // pointing at a tab id that is no longer in the catalog would make both features
  // permanently un-grantable -- read-only for every role, admin included.
  "population":         ["upload-data", "process-population", "configure-sample", "draw-sample", "distribute-samples", "bulk-assign", "view-browse", "unlock-sampling-stage", "adhoc-import.ingest", "adhoc-import.assign"],
  "employee-workspace": ["approve-referrals", "approve-replacements", "view-all-entries", "submit-referrals", "request-replacement", "bulk-reassign-referrals", "submit-answers", "configure-referral-columns", "ew.reopenAnswer", "manage-inspection-template", "employee-reopen-instant"],
  // post-notification is rendered on the ew/notifications top-level tab (NotificationManager),
  // never on employee-workspace -- cascading it against employee-workspace let can()/
  // getMutationCapability() authorize posting off employee-workspace's edit access even when
  // ew/notifications itself was view-only or blocked for the role. Keep in sync with
  // NotificationCenter/index.tsx.
  "ew/notifications":   ["post-notification"],
  "user-management":    ["manage-users", "reset-passwords", "edit-permissions"],
  "reports":            ["export-reports", "report-designer.edit"],
  "archive":            ["archive.closeMonth", "archive.createBackup", "archive.restoreBackup"],
  "settings":           ["view-error-log", "edit-interface-labels", "settings.syncInterval", "settings.adminAccount"],
};

/** Reverse lookup: feature ID → parent tab ID. */
export const FEATURE_TAB_LOOKUP: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(TAB_FEATURE_MAP).flatMap(([tabId, features]) =>
    features.map((f) => [f, tabId])
  )
);

/** Feature persistence scope. Unannotated features are workspace-backed by design. */
export const FEATURE_MUTATION_STORAGE_LOOKUP: Readonly<
  Record<string, "workspace" | "browser">
> = Object.fromEntries(
  MANAGED_FEATURE_GROUPS.flatMap((group) =>
    group.features.map((feature) => [
      feature.id,
      feature.mutationStorage ?? "workspace",
    ]),
  ),
);

// Default feature enabled-state per role per featureId
// admin is always true (enforced in hasFeature)
const FEATURE_DEFAULTS: Record<string, Partial<Record<AuthRole, boolean>>> = {
  "approve-referrals":    { guest: false, employee: false, supervisor: true,  manager: true  },
  "approve-replacements": { guest: false, employee: false, supervisor: true,  manager: true  },
  "view-all-entries":     { guest: false, employee: false, supervisor: true,  manager: true  },
  "submit-referrals":     { guest: false, employee: true,  supervisor: true,  manager: false },
  "request-replacement":  { guest: false, employee: true,  supervisor: true,  manager: false },
  "bulk-reassign-referrals": { guest: false, employee: false, supervisor: true, manager: true },
  "submit-answers":       { guest: false, employee: true,  supervisor: true,  manager: false },
  "configure-referral-columns": { guest: false, employee: false, supervisor: false, manager: true },
  "ew.reopenAnswer":      { guest: false, employee: false, supervisor: true,  manager: true  },
  "upload-data":          { guest: false, employee: false, supervisor: false, manager: true  },
  "process-population":   { guest: false, employee: false, supervisor: false, manager: true  },
  "configure-sample":     { guest: false, employee: false, supervisor: false, manager: true  },
  "draw-sample":          { guest: false, employee: false, supervisor: false, manager: true  },
  "distribute-samples":   { guest: false, employee: false, supervisor: false, manager: true  },
  "bulk-assign":          { guest: false, employee: false, supervisor: true,  manager: true  },
  "view-browse":          { guest: true,  employee: true,  supervisor: true,  manager: true  },
  "unlock-sampling-stage": { guest: false, employee: false, supervisor: false, manager: false },
  "manage-inspection-template": { guest: false, employee: false, supervisor: false, manager: true },
  "employee-reopen-instant": { guest: false, employee: false, supervisor: false, manager: false },
  "post-notification":    { guest: false, employee: false, supervisor: false, manager: true  },
  "manage-users":         { guest: false, employee: false, supervisor: false, manager: false },
  "reset-passwords":      { guest: false, employee: false, supervisor: false, manager: false },
  "edit-permissions":     { guest: false, employee: false, supervisor: false, manager: false },
  "export-reports":       { guest: false, employee: false, supervisor: true,  manager: true  },
  "archive.closeMonth":   { guest: false, employee: false, supervisor: false, manager: false },
  "archive.createBackup": { guest: false, employee: false, supervisor: false, manager: true },
  "archive.restoreBackup": { guest: false, employee: false, supervisor: false, manager: false },
  "report-designer.edit": { guest: false, employee: false, supervisor: false, manager: true },
  "view-error-log":       { guest: false, employee: false, supervisor: false, manager: false },
  "edit-interface-labels": { guest: false, employee: false, supervisor: false, manager: false },
  // Admin-only by default: the cadence is workspace-wide, so a single careless
  // change affects every client on the shared folder.
  "settings.syncInterval": { guest: false, employee: false, supervisor: false, manager: false },
  // Admin-only by default: this gates the bootstrap admin passcode/login method
  // itself (audit finding 13) — no non-admin role should ever be able to grant
  // this to itself even hypothetically.
  "settings.adminAccount": { guest: false, employee: false, supervisor: false, manager: false },
  // Admin-only by default. The page itself is admin-only via the
  // `population/adhoc-import` SUB-TAB ceiling (tabCatalog.ts); the features now
  // cascade off the Population page grant, so an admin could technically enable them
  // for another role -- the sub-tab ceiling still refuses to open the page, and
  // PopulationTab's own gate refuses to render it. Defaults stay off for every
  // non-admin role, matching manage-users/reset-passwords above.
  "adhoc-import.ingest":  { guest: false, employee: false, supervisor: false, manager: false },
  "adhoc-import.assign":  { guest: false, employee: false, supervisor: false, manager: false },
};

// ── Default creators ──────────────────────────────────────────────────────────

export function createDefaultPermissions(): RolePermission[] {
  return [
    // Guest — no default access to population (was "view"; scoped down)
    { role: "guest",      tabId: "population",         access: "none" },
    { role: "guest",      tabId: "employee-workspace", access: "none" },
    { role: "guest",      tabId: "reports",            access: "none" },
    { role: "guest",      tabId: "reports/report-designer", access: "none" },
    { role: "guest",      tabId: "archive",            access: "none" },
    { role: "guest",      tabId: "user-management",    access: "none" },
    { role: "guest",      tabId: "settings",           access: "none" },
    // Employee — no default access to population (was "view"; scoped down)
    { role: "employee",   tabId: "population",         access: "none" },
    { role: "employee",   tabId: "employee-workspace", access: "edit" },
    { role: "employee",   tabId: "reports",            access: "none" },
    { role: "employee",   tabId: "reports/report-designer", access: "none" },
    { role: "employee",   tabId: "archive",            access: "none" },
    { role: "employee",   tabId: "user-management",    access: "none" },
    { role: "employee",   tabId: "settings",           access: "none" },
    // Supervisor — population/reports/archive default to "none" (was "view"; scoped down)
    { role: "supervisor", tabId: "population",         access: "none" },
    { role: "supervisor", tabId: "employee-workspace", access: "edit" },
    { role: "supervisor", tabId: "reports",            access: "none" },
    { role: "supervisor", tabId: "reports/report-designer", access: "none" },
    { role: "supervisor", tabId: "archive",            access: "none" },
    { role: "supervisor", tabId: "user-management",    access: "none" },
    { role: "supervisor", tabId: "settings",           access: "none" },
    // Manager — full access except user-management and archive (archive was
    // "edit"; scoped down) (admin-only by default)
    { role: "manager",    tabId: "population",         access: "edit" },
    { role: "manager",    tabId: "employee-workspace", access: "edit" },
    { role: "manager",    tabId: "reports",            access: "edit" },
    { role: "manager",    tabId: "reports/report-designer", access: "edit" },
    { role: "manager",    tabId: "archive",            access: "none" },
    { role: "manager",    tabId: "user-management",    access: "none" },
    // Settings is code-gated to guest + admin (see TAB_ROLE_CEILINGS); manager
    // has no access, so the shipped default is "none" to match reality.
    { role: "manager",    tabId: "settings",           access: "none" },
    // Admin (bootstrap) — always full, locked in normalizer
    { role: "admin",      tabId: "population",              access: "edit" },
    { role: "admin",      tabId: "employee-workspace",      access: "edit" },
    { role: "admin",      tabId: "ew/xray-referrals",       access: "edit" },
    { role: "admin",      tabId: "ew/xray-results",         access: "edit" },
    { role: "admin",      tabId: "ew/referral-approval",    access: "edit" },
    { role: "admin",      tabId: "ew/inspection-form",      access: "edit" },
    { role: "admin",      tabId: "reports",                 access: "edit" },
    { role: "admin",      tabId: "reports/report-designer", access: "edit" },
    { role: "admin",      tabId: "archive",                 access: "edit" },
    { role: "admin",      tabId: "user-management",         access: "edit" },
    { role: "admin",      tabId: "user-management/users",               access: "edit" },
    { role: "admin",      tabId: "user-management/page-permissions",    access: "edit" },
    { role: "admin",      tabId: "user-management/feature-permissions", access: "edit" },
    { role: "admin",      tabId: "user-management/activity",            access: "edit" },
    { role: "admin",      tabId: "user-management/actions",             access: "edit" },
    { role: "admin",      tabId: "settings",                access: "edit" },
    // Manager — full access to EW sub-tabs except xray-referrals (was "edit"; scoped down)
    { role: "manager",    tabId: "ew/xray-referrals",       access: "none" },
    { role: "manager",    tabId: "ew/xray-results",         access: "edit" },
    { role: "manager",    tabId: "ew/referral-approval",    access: "edit" },
    { role: "manager",    tabId: "ew/inspection-form",      access: "edit" },
    // Supervisor — can see all EW sub-tabs, except inspection-form: manage-inspection-template
    // defaults off for supervisors (FEATURE_DEFAULTS below), so the tab was a guaranteed-blocked
    // dead end (TemplateBuilder renders its own access-denied empty state for it). "none" hides
    // the sidebar entry instead of linking to a page that can never do anything for this role.
    { role: "supervisor", tabId: "ew/xray-referrals",       access: "edit" },
    { role: "supervisor", tabId: "ew/xray-results",         access: "view" },
    { role: "supervisor", tabId: "ew/referral-approval",    access: "edit" },
    { role: "supervisor", tabId: "ew/inspection-form",      access: "none" },
    // Employee — restricted EW sub-tabs; inspection-form is "none" for the same dead-end reason
    // (manage-inspection-template also defaults off for employees). xray-results was "view";
    // scoped down to "none".
    { role: "employee",   tabId: "ew/xray-referrals",       access: "edit" },
    { role: "employee",   tabId: "ew/xray-results",         access: "none" },
    { role: "employee",   tabId: "ew/referral-approval",    access: "none" },
    { role: "employee",   tabId: "ew/inspection-form",      access: "none" },
    // Guest — no EW sub-tab access
    { role: "guest",      tabId: "ew/xray-referrals",       access: "none" },
    { role: "guest",      tabId: "ew/xray-results",         access: "none" },
    { role: "guest",      tabId: "ew/referral-approval",    access: "none" },
    { role: "guest",      tabId: "ew/inspection-form",      access: "none" },
    // Notification center (ew/notifications) is a top-level category for admin + manager;
    // audience roles (employee/supervisor) get the banner, not the manager view.
    { role: "guest",      tabId: "ew/notifications",        access: "none" },
    { role: "employee",   tabId: "ew/notifications",        access: "none" },
    { role: "supervisor", tabId: "ew/notifications",        access: "none" },
    { role: "manager",    tabId: "ew/notifications",        access: "edit" },
    { role: "admin",      tabId: "ew/notifications",        access: "edit" },
    // Sub-tabs that formerly relied on parent-tab inheritance (موروث) — now explicit.
    // Values baked from the pre-removal effective access (parent population / reports rows),
    // so the inheritance fallback can be deleted with zero functional change (see C1 test).
    // guest/employee/supervisor were "view" on both population sub-tabs; scoped down to "none".
    { role: "guest",      tabId: "population/process",       access: "none" },
    { role: "employee",   tabId: "population/process",       access: "none" },
    { role: "supervisor", tabId: "population/process",       access: "none" },
    { role: "manager",    tabId: "population/process",       access: "edit" },
    { role: "admin",      tabId: "population/process",       access: "edit" },
    { role: "guest",      tabId: "population/browse",        access: "none" },
    { role: "employee",   tabId: "population/browse",        access: "none" },
    { role: "supervisor", tabId: "population/browse",        access: "none" },
    { role: "manager",    tabId: "population/browse",        access: "edit" },
    { role: "admin",      tabId: "population/browse",        access: "edit" },
    // Ad-hoc import (owner requirement, 2026-08) — admin-only page. It moved from a
    // stand-alone top-level tab to this Population sub-tab on 2026-08-21; the
    // ADMIN_ONLY ceiling now lives on the sub-tab id, so the non-admin rows below are
    // belt-and-braces (isTabRestrictedForRole already refuses them).
    { role: "guest",      tabId: "population/adhoc-import",  access: "none" },
    { role: "employee",   tabId: "population/adhoc-import",  access: "none" },
    { role: "supervisor", tabId: "population/adhoc-import",  access: "none" },
    { role: "manager",    tabId: "population/adhoc-import",  access: "none" },
    { role: "admin",      tabId: "population/adhoc-import",  access: "edit" },
    // supervisor was "view" on both reports sub-tabs; scoped down to "none".
    { role: "guest",      tabId: "reports/reports",          access: "none" },
    { role: "employee",   tabId: "reports/reports",          access: "none" },
    { role: "supervisor", tabId: "reports/reports",          access: "none" },
    { role: "manager",    tabId: "reports/reports",          access: "edit" },
    { role: "admin",      tabId: "reports/reports",          access: "edit" },
    { role: "guest",      tabId: "reports/kpi",              access: "none" },
    { role: "employee",   tabId: "reports/kpi",              access: "none" },
    { role: "supervisor", tabId: "reports/kpi",              access: "none" },
    { role: "manager",    tabId: "reports/kpi",              access: "edit" },
    { role: "admin",      tabId: "reports/kpi",              access: "edit" },
  ];
}

export function createDefaultFeaturePermissions(): FeaturePermission[] {
  const roles: AuthRole[] = ["guest", "employee", "supervisor", "manager", "admin"];
  const result: FeaturePermission[] = [];

  for (const featureId of ALL_FEATURE_IDS) {
    for (const role of roles) {
      const enabled =
        role === "admin"
          ? true
          : (FEATURE_DEFAULTS[featureId]?.[role] ?? false);
      result.push({ role, featureId, enabled });
    }
  }

  return result;
}

export function createDefaultAdminAccount(): AdminAccountSettings {
  return {
    passwordHash: null,
    // Owner requirement (2026-08-13): signing in as "admin" from the normal form
    // works out of the box; an admin can switch it off in Settings to force the
    // hidden shortcut instead.
    allowUsernameLogin: true,
    updatedAt: null,
    updatedBy: null,
  };
}

export function createEmptyUserManagementState(): UserManagementState {
  return {
    users: createDefaultManagedUsers(),
    permissions: createDefaultPermissions(),
    featurePermissions: createDefaultFeaturePermissions(),
    adminAccount: createDefaultAdminAccount(),
  };
}

export function createDefaultManagedUsers(): ManagedLoginUser[] {
  const createdAt = "2026-06-24T00:00:00.000Z";
  const users: Array<{
    id: string;
    username: string;
    displayName: string;
    role: AuthRole;
    hasCertScanLicense?: boolean;
  }> = [
    { id: "default-user-mohammed-otaibi", username: "malrogi", displayName: "محمد العتيبي", role: "supervisor", hasCertScanLicense: true },
    { id: "default-user-jamila-ghamdi", username: "jalgahamdi", displayName: "جميلة الغامدي", role: "employee", hasCertScanLicense: true },
    { id: "default-user-hatem-oraini", username: "hihaloraini", displayName: "حاتم العريني", role: "employee" },
    { id: "default-user-salman-hajji", username: "saalhijji", displayName: "سلمان الحجي", role: "employee" },
    { id: "default-user-abdulilah-moneim", username: "amonem", displayName: "عبدالاله المنعم", role: "manager" },
    { id: "default-user-mohammed-khuwaytim", username: "mkhuwaytim", displayName: "محمد الخويتم", role: "manager" },
  ];

  return users.map((user) => ({
    ...user,
    username: normalizeUsername(user.username),
    passwordHash: { ...DEFAULT_USER_PASSWORD_HASH },
    isActive: true,
    hasCertScanLicense: user.hasCertScanLicense ?? false,
    createdAt,
    updatedAt: createdAt,
  }));
}

// ── Permission helpers ────────────────────────────────────────────────────────

export function getRolePermission(
  permissions: RolePermission[],
  role: AuthRole,
  tabId: string
): PermissionLevel {
  // Admin always has full access regardless of stored permissions
  if (role === "admin") return "edit";

  // Every role×tab pair resolves via an explicit row (or "none"); no parent inheritance.
  const explicit = permissions.find((p) => p.role === role && p.tabId === tabId);
  return explicit ? explicit.access : "none";
}

export function hasRolePermission(
  permissions: RolePermission[],
  role: AuthRole,
  tabId: string,
  minimumAccess: Exclude<PermissionLevel, "none"> = "view"
): boolean {
  const access = getRolePermission(permissions, role, tabId);
  if (minimumAccess === "view") return access === "view" || access === "edit";
  return access === "edit";
}

/**
 * True when `tabId`'s code ceiling (tabCatalog.ts) excludes `role` — i.e. no value
 * an admin can pick in the permission matrix will ever open that page for that role.
 * The User Management matrix uses this to render such a cell as a system-restriction
 * notice rather than a toggle that silently does nothing.
 */
export function isTabRestrictedForRole(role: AuthRole, tabId: string): boolean {
  const ceiling = resolveRoleCeiling(tabId);
  return ceiling ? !ceiling.includes(role) : false;
}

/**
 * The single authority for "can this role open this tab": the code ceiling first,
 * then the permission matrix. `usePermissions.canAccessTab` is a thin wrapper around
 * it, so a test that exercises this function is testing the real navigation gate.
 */
export function canRoleAccessTab(
  permissions: RolePermission[],
  role: AuthRole,
  tabId: string,
  minimumAccess: Exclude<PermissionLevel, "none"> = "view"
): boolean {
  if (isTabRestrictedForRole(role, tabId)) return false;
  return hasRolePermission(permissions, role, tabId, minimumAccess);
}

export function hasFeature(
  featurePermissions: FeaturePermission[],
  role: AuthRole,
  featureId: string
): boolean {
  if (role === "admin") return true;
  return (
    featurePermissions.find((f) => f.role === role && f.featureId === featureId)
      ?.enabled ?? false
  );
}

// ── Read / Write ──────────────────────────────────────────────────────────────

export function readUserManagementState(): UserManagementState {
  return runtimeUserManagementState ?? createEmptyUserManagementState();
}

export function writeUserManagementState(
  state: UserManagementStateInput,
  notify = true
): void {
  runtimeUserManagementState = normalizeUserManagementState(state);
  if (notify) window.dispatchEvent(new Event(CHANGE_EVENT_NAME));
}

export function subscribeToUserManagementChanges(
  callback: () => void
): () => void {
  window.addEventListener(CHANGE_EVENT_NAME, callback);
  return () => {
    window.removeEventListener(CHANGE_EVENT_NAME, callback);
  };
}

// ── Disk sync ─────────────────────────────────────────────────────────────────

export function syncUsersFromDisk(
  diskUsers: ManagedLoginUser[],
  diskPermissions?: RolePermission[],
  diskFeaturePermissions?: FeaturePermission[],
  diskAdminAccount?: AdminAccountSettings
): void {
  writeUserManagementState(
    {
      users: diskUsers,
      permissions: diskPermissions ?? createDefaultPermissions(),
      featurePermissions: diskFeaturePermissions ?? createDefaultFeaturePermissions(),
      // A workspace written before this field existed has no adminAccount block;
      // fall back to the shipped defaults rather than wiping a later write.
      adminAccount: diskAdminAccount ?? createDefaultAdminAccount(),
    },
    true
  );
}

// ── Normalization ─────────────────────────────────────────────────────────────

export function normalizeUserManagementState(
  state: UserManagementStateInput
): UserManagementState {
  // Fill any missing tab permissions from defaults
  const defaultPerms = createDefaultPermissions();
  const knownTabIds = new Set(MANAGED_TABS.map((tab) => tab.id));
  // Start with all existing entries (preserves manually-set sub-tab permissions)
  const mergedMap = new Map<string, RolePermission>();
  for (const p of state.permissions) {
    if (knownTabIds.has(p.tabId)) mergedMap.set(`${p.role}:${p.tabId}`, p);
  }
  // Apply defaults for anything not yet explicitly set
  for (const def of defaultPerms) {
    const key = `${def.role}:${def.tabId}`;
    if (!mergedMap.has(key)) mergedMap.set(key, def);
  }
  // The admin role is always forced to full edit access on every tab.
  for (const p of mergedMap.values()) {
    if (p.role === "admin") mergedMap.set(`admin:${p.tabId}`, { ...p, access: "edit" });
  }
  const permissions = Array.from(mergedMap.values());

  // Fill any missing feature permissions from defaults
  const defaultFeats = createDefaultFeaturePermissions();
  const featurePermissions = defaultFeats.map((def) => {
    const existing = (state.featurePermissions ?? []).find(
      (f) => f.role === def.role && f.featureId === def.featureId
    );
    // Admin is always true
    if (def.role === "admin") return { ...def, enabled: true };
    return existing ?? def;
  });

  // Seed ONLY when the roster was never initialised. An empty array is an
  // administrative decision (the last managed user was deleted) — re-seeding it
  // handed the six shipped accounts, and their shipped default password, back to
  // anyone who could reach the login form.
  const users = state.users ?? createDefaultManagedUsers();

  // Tolerate a state object built before this field existed (older callers,
  // older disk files, tests) rather than letting `undefined` reach the login path.
  const defaultAdminAccount = createDefaultAdminAccount();
  const rawAdminAccount = state.adminAccount;
  const adminAccount: AdminAccountSettings = {
    passwordHash: rawAdminAccount?.passwordHash ?? null,
    allowUsernameLogin:
      typeof rawAdminAccount?.allowUsernameLogin === "boolean"
        ? rawAdminAccount.allowUsernameLogin
        : defaultAdminAccount.allowUsernameLogin,
    updatedAt: rawAdminAccount?.updatedAt ?? null,
    updatedBy: rawAdminAccount?.updatedBy ?? null,
  };

  return { users, permissions, featurePermissions, adminAccount };
}

// ── Admin account helpers ─────────────────────────────────────────────────────

export function readAdminAccount(): AdminAccountSettings {
  return readUserManagementState().adminAccount;
}

/**
 * The hash the bootstrap-admin passcode is checked against: the workspace's own
 * hash once an admin has set one, otherwise the shipped default.
 */
export function resolveAdminPasswordHash(): PasswordHashRecord {
  return readAdminAccount().passwordHash ?? BOOTSTRAP_ADMIN_PASSWORD_HASH;
}

/**
 * The state an admin-account change WOULD produce, without applying it.
 *
 * Callers that must persist the change before it takes effect — the bootstrap
 * passcode and its sign-in method both lock their own author out when the
 * runtime state and the workspace file disagree — build the candidate with
 * this, write it, and only then commit it with `writeUserManagementState`.
 */
export function buildAdminAccountUpdate(
  changes: Partial<Pick<AdminAccountSettings, "passwordHash" | "allowUsernameLogin">>,
  actor: string
): UserManagementState {
  const state = readUserManagementState();
  return {
    ...state,
    adminAccount: {
      ...state.adminAccount,
      ...changes,
      updatedAt: new Date().toISOString(),
      updatedBy: actor,
    },
  };
}

/**
 * Applies an admin-account change to the runtime state and returns the full new
 * state, so the caller can persist it with `syncUserManagementToDisk` — this
 * module never touches disk itself.
 *
 * There is no rollback, so a caller whose persist can fail should use
 * `buildAdminAccountUpdate` + `writeUserManagementState` in that order instead:
 * a passcode applied at runtime but rejected by the workspace write locks its
 * own author out.
 */
export function updateAdminAccount(
  changes: Partial<Pick<AdminAccountSettings, "passwordHash" | "allowUsernameLogin">>,
  actor: string
): UserManagementState {
  writeUserManagementState(buildAdminAccountUpdate(changes, actor), true);
  return readUserManagementState();
}

// ── User helpers ──────────────────────────────────────────────────────────────

export function createUserId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `user-${crypto.randomUUID()}`;
  }
  return `user-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function isUsernameAvailable(
  users: ManagedLoginUser[],
  username: string,
  currentUserId?: string
): boolean {
  const normalized = normalizeUsername(username);
  return !users.some(
    (u) => u.id !== currentUserId && normalizeUsername(u.username) === normalized
  );
}

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export function createManagedUser(params: {
  username: string;
  displayName: string;
  role: AuthRole;
  passwordHash: PasswordHashRecord;
  isActive: boolean;
  hasCertScanLicense?: boolean;
}): ManagedLoginUser {
  const now = new Date().toISOString();
  return {
    id: createUserId(),
    username: normalizeUsername(params.username),
    displayName: params.displayName.trim(),
    role: params.role,
    passwordHash: params.passwordHash,
    isActive: params.isActive,
    hasCertScanLicense: params.hasCertScanLicense ?? false,
    createdAt: now,
    updatedAt: now,
  };
}

export function getManagedLoginUsers(): ManagedLoginUser[] {
  return readUserManagementState().users;
}

/**
 * Replace a managed user's stored password hash (used to transparently upgrade
 * legacy PBKDF2 hashes to Argon2id after a successful login). No-op if the user
 * is gone (e.g. bootstrap admin, which is not a managed user).
 */
export function persistUserPasswordHash(
  userId: string,
  passwordHash: PasswordHashRecord
): void {
  const state = readUserManagementState();
  const index = state.users.findIndex((u) => u.id === userId);
  if (index === -1) return;
  const users = state.users.slice();
  users[index] = {
    ...users[index],
    passwordHash,
    updatedAt: new Date().toISOString(),
  };
  writeUserManagementState({ ...state, users }, true);
}
