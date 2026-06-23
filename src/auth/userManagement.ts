import type { PasswordHashRecord } from "./passwordCrypto";
import type { AuthRole, LoginUser } from "./authTypes";

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
};

export type FeatureGroup = {
  groupId: string;
  label: string;
  features: readonly FeatureDefinition[];
};

export type UserManagementState = {
  users: ManagedLoginUser[];
  permissions: RolePermission[];
  featurePermissions: FeaturePermission[];
};

// ── Storage key & event ───────────────────────────────────────────────────────

const STORAGE_KEY = "xray_user_management_v1";
const CHANGE_EVENT_NAME = "xray-user-management-change";

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

export type ManagedTab = {
  id: string;
  label: string;
  /** When set, this is a nested sub-tab of the given parent tab. */
  parentId?: string;
};

export const MANAGED_TABS: readonly ManagedTab[] = [
  { id: "population",              label: "إدارة بيانات الأشعة" },
  { id: "employee-workspace",      label: "مساحة العمل" },
  { id: "ew/stats-dashboard",      label: "لوحة الإحصائيات",        parentId: "employee-workspace" },
  { id: "ew/xray-referrals",       label: "صور الأشعة المحالة",      parentId: "employee-workspace" },
  { id: "ew/xray-results",         label: "نتائج فحص الأشعة",       parentId: "employee-workspace" },
  { id: "ew/referral-approval",    label: "اعتماد الطلبات",          parentId: "employee-workspace" },
  { id: "ew/inspection-form",      label: "نموذج الفحص (مساحة العمل)", parentId: "employee-workspace" },
  { id: "template-builder",        label: "نموذج الفحص" },
  { id: "reports",                 label: "التقارير" },
  { id: "archive",                 label: "الأرشيف" },
  { id: "user-management",         label: "إدارة المستخدمين" },
  { id: "settings",                label: "الإعدادات" },
];

// ── Feature catalogue ─────────────────────────────────────────────────────────

export const MANAGED_FEATURE_GROUPS: readonly FeatureGroup[] = [
  {
    groupId: "workspace",
    label: "مساحة العمل",
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
        id: "view-employee-stats",
        label: "إحصائيات تفصيلية لكل موظف",
        description: "جدول تفصيلي لأداء كل موظف في لوحة الإحصائيات",
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
        id: "submit-answers",
        label: "تقديم إجابات الفحص",
        description: "ملء نموذج الفحص وتقديم الإجابات",
      },
      {
        id: "configure-referral-columns",
        label: "تخصيص أعمدة صور الأشعة المحالة",
        description: "إظهار زر الأعمدة وتغيير الأعمدة الظاهرة في جدول صور الأشعة المحالة",
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
      },
      {
        id: "reset-passwords",
        label: "إعادة تعيين كلمات المرور",
        description: "تغيير كلمات مرور المستخدمين الآخرين",
      },
      {
        id: "edit-permissions",
        label: "تعديل مصفوفة الصلاحيات",
        description: "تغيير صلاحيات الأدوار في مصفوفتَي الصفحات والميزات",
      },
      {
        id: "export-reports",
        label: "تصدير التقارير",
        description: "تنزيل ملفات التقارير بصيغة Excel أو PDF",
      },
      {
        id: "export-archive",
        label: "تصدير من الأرشيف",
        description: "تنزيل البيانات المؤرشفة",
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
  "population":         ["upload-data", "process-population", "configure-sample", "draw-sample", "distribute-samples", "bulk-assign", "view-browse"],
  "employee-workspace": ["approve-referrals", "approve-replacements", "view-all-entries", "view-employee-stats", "submit-referrals", "request-replacement", "submit-answers", "configure-referral-columns"],
  "user-management":    ["manage-users", "reset-passwords", "edit-permissions"],
  "reports":            ["export-reports"],
  "archive":            ["export-archive"],
  "template-builder":   [],
  "settings":           [],
};

/** Reverse lookup: feature ID → parent tab ID. */
export const FEATURE_TAB_LOOKUP: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(TAB_FEATURE_MAP).flatMap(([tabId, features]) =>
    features.map((f) => [f, tabId])
  )
);

// Default feature enabled-state per role per featureId
// admin is always true (enforced in hasFeature)
const FEATURE_DEFAULTS: Record<string, Partial<Record<AuthRole, boolean>>> = {
  "approve-referrals":    { guest: false, employee: false, supervisor: true,  manager: true  },
  "approve-replacements": { guest: false, employee: false, supervisor: true,  manager: true  },
  "view-all-entries":     { guest: false, employee: false, supervisor: true,  manager: true  },
  "view-employee-stats":  { guest: false, employee: false, supervisor: true,  manager: true  },
  "submit-referrals":     { guest: false, employee: true,  supervisor: true,  manager: false },
  "request-replacement":  { guest: false, employee: true,  supervisor: false, manager: false },
  "submit-answers":       { guest: false, employee: true,  supervisor: false, manager: false },
  "configure-referral-columns": { guest: false, employee: false, supervisor: true, manager: true },
  "upload-data":          { guest: false, employee: false, supervisor: false, manager: true  },
  "process-population":   { guest: false, employee: false, supervisor: false, manager: true  },
  "configure-sample":     { guest: false, employee: false, supervisor: false, manager: true  },
  "draw-sample":          { guest: false, employee: false, supervisor: false, manager: true  },
  "distribute-samples":   { guest: false, employee: false, supervisor: false, manager: true  },
  "bulk-assign":          { guest: false, employee: false, supervisor: true,  manager: true  },
  "view-browse":          { guest: true,  employee: true,  supervisor: true,  manager: true  },
  "manage-users":         { guest: false, employee: false, supervisor: false, manager: false },
  "reset-passwords":      { guest: false, employee: false, supervisor: false, manager: false },
  "edit-permissions":     { guest: false, employee: false, supervisor: false, manager: false },
  "export-reports":       { guest: false, employee: false, supervisor: true,  manager: true  },
  "export-archive":       { guest: false, employee: false, supervisor: false, manager: true  },
};

// ── Default creators ──────────────────────────────────────────────────────────

export function createDefaultPermissions(): RolePermission[] {
  return [
    // Guest — read-only on population only
    { role: "guest",      tabId: "population",         access: "view" },
    { role: "guest",      tabId: "employee-workspace", access: "none" },
    { role: "guest",      tabId: "template-builder",   access: "none" },
    { role: "guest",      tabId: "reports",            access: "none" },
    { role: "guest",      tabId: "archive",            access: "none" },
    { role: "guest",      tabId: "user-management",    access: "none" },
    { role: "guest",      tabId: "settings",           access: "none" },
    // Employee
    { role: "employee",   tabId: "population",         access: "view" },
    { role: "employee",   tabId: "employee-workspace", access: "edit" },
    { role: "employee",   tabId: "template-builder",   access: "none" },
    { role: "employee",   tabId: "reports",            access: "none" },
    { role: "employee",   tabId: "archive",            access: "none" },
    { role: "employee",   tabId: "user-management",    access: "none" },
    { role: "employee",   tabId: "settings",           access: "none" },
    // Supervisor
    { role: "supervisor", tabId: "population",         access: "view" },
    { role: "supervisor", tabId: "employee-workspace", access: "edit" },
    { role: "supervisor", tabId: "template-builder",   access: "none" },
    { role: "supervisor", tabId: "reports",            access: "view" },
    { role: "supervisor", tabId: "archive",            access: "view" },
    { role: "supervisor", tabId: "user-management",    access: "none" },
    { role: "supervisor", tabId: "settings",           access: "none" },
    // Manager — full access except user-management (admin-only by default)
    { role: "manager",    tabId: "population",         access: "edit" },
    { role: "manager",    tabId: "employee-workspace", access: "edit" },
    { role: "manager",    tabId: "template-builder",   access: "edit" },
    { role: "manager",    tabId: "reports",            access: "edit" },
    { role: "manager",    tabId: "archive",            access: "edit" },
    { role: "manager",    tabId: "user-management",    access: "none" },
    { role: "manager",    tabId: "settings",           access: "edit" },
    // Admin (bootstrap) — always full, locked in normalizer
    { role: "admin",      tabId: "population",              access: "edit" },
    { role: "admin",      tabId: "employee-workspace",      access: "edit" },
    { role: "admin",      tabId: "ew/stats-dashboard",      access: "edit" },
    { role: "admin",      tabId: "ew/xray-referrals",       access: "edit" },
    { role: "admin",      tabId: "ew/xray-results",         access: "edit" },
    { role: "admin",      tabId: "ew/referral-approval",    access: "edit" },
    { role: "admin",      tabId: "ew/inspection-form",      access: "edit" },
    { role: "admin",      tabId: "template-builder",        access: "edit" },
    { role: "admin",      tabId: "reports",                 access: "edit" },
    { role: "admin",      tabId: "archive",                 access: "edit" },
    { role: "admin",      tabId: "user-management",         access: "edit" },
    { role: "admin",      tabId: "settings",                access: "edit" },
    // Manager — full access to EW sub-tabs
    { role: "manager",    tabId: "ew/stats-dashboard",      access: "edit" },
    { role: "manager",    tabId: "ew/xray-referrals",       access: "edit" },
    { role: "manager",    tabId: "ew/xray-results",         access: "edit" },
    { role: "manager",    tabId: "ew/referral-approval",    access: "edit" },
    { role: "manager",    tabId: "ew/inspection-form",      access: "edit" },
    // Supervisor — can see all EW sub-tabs
    { role: "supervisor", tabId: "ew/stats-dashboard",      access: "view" },
    { role: "supervisor", tabId: "ew/xray-referrals",       access: "edit" },
    { role: "supervisor", tabId: "ew/xray-results",         access: "edit" },
    { role: "supervisor", tabId: "ew/referral-approval",    access: "edit" },
    { role: "supervisor", tabId: "ew/inspection-form",      access: "view" },
    // Employee — restricted EW sub-tabs
    { role: "employee",   tabId: "ew/stats-dashboard",      access: "view" },
    { role: "employee",   tabId: "ew/xray-referrals",       access: "edit" },
    { role: "employee",   tabId: "ew/xray-results",         access: "view" },
    { role: "employee",   tabId: "ew/referral-approval",    access: "none" },
    { role: "employee",   tabId: "ew/inspection-form",      access: "edit" },
    // Guest — no EW sub-tab access
    { role: "guest",      tabId: "ew/stats-dashboard",      access: "none" },
    { role: "guest",      tabId: "ew/xray-referrals",       access: "none" },
    { role: "guest",      tabId: "ew/xray-results",         access: "none" },
    { role: "guest",      tabId: "ew/referral-approval",    access: "none" },
    { role: "guest",      tabId: "ew/inspection-form",      access: "none" },
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

export function createEmptyUserManagementState(): UserManagementState {
  return {
    users: [],
    permissions: createDefaultPermissions(),
    featurePermissions: createDefaultFeaturePermissions(),
  };
}

// ── Permission helpers ────────────────────────────────────────────────────────

export function getRolePermission(
  permissions: RolePermission[],
  role: AuthRole,
  tabId: string
): PermissionLevel {
  // Admin always has full access regardless of stored permissions
  if (role === "admin") return "edit";

  const explicit = permissions.find((p) => p.role === role && p.tabId === tabId);
  if (explicit) return explicit.access;

  // Inherit from parent tab when no explicit entry exists
  const tab = MANAGED_TABS.find((t) => t.id === tabId);
  if (tab?.parentId) {
    return permissions.find((p) => p.role === role && p.tabId === tab.parentId)?.access ?? "none";
  }

  return "none";
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
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createEmptyUserManagementState();
    const parsed: unknown = JSON.parse(raw);
    if (!isUserManagementState(parsed)) return createEmptyUserManagementState();
    return normalizeUserManagementState(parsed);
  } catch {
    return createEmptyUserManagementState();
  }
}

export function writeUserManagementState(
  state: UserManagementState,
  notify = true
): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (notify) window.dispatchEvent(new Event(CHANGE_EVENT_NAME));
}

export function subscribeToUserManagementChanges(
  callback: () => void
): () => void {
  window.addEventListener(CHANGE_EVENT_NAME, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(CHANGE_EVENT_NAME, callback);
    window.removeEventListener("storage", callback);
  };
}

// ── Disk sync ─────────────────────────────────────────────────────────────────

export function syncUsersFromDisk(
  diskUsers: ManagedLoginUser[],
  diskPermissions?: RolePermission[],
  diskFeaturePermissions?: FeaturePermission[]
): void {
  const current = readUserManagementState();

  const mergedUsersMap = new Map<string, ManagedLoginUser>();
  for (const u of current.users) mergedUsersMap.set(u.username, u);
  for (const u of diskUsers) mergedUsersMap.set(u.username, u);

  const mergedPermissions = diskPermissions
    ? mergePermissions(current.permissions, diskPermissions)
    : current.permissions;

  const mergedFeaturePermissions = diskFeaturePermissions
    ? mergeFeaturePermissions(current.featurePermissions, diskFeaturePermissions)
    : current.featurePermissions;

  writeUserManagementState(
    {
      users: Array.from(mergedUsersMap.values()),
      permissions: mergedPermissions,
      featurePermissions: mergedFeaturePermissions,
    },
    true
  );
}

function mergePermissions(
  local: RolePermission[],
  disk: RolePermission[]
): RolePermission[] {
  const map = new Map<string, RolePermission>();
  for (const p of local) map.set(`${p.role}:${p.tabId}`, p);
  for (const p of disk) map.set(`${p.role}:${p.tabId}`, p);
  return Array.from(map.values());
}

function mergeFeaturePermissions(
  local: FeaturePermission[],
  disk: FeaturePermission[]
): FeaturePermission[] {
  const map = new Map<string, FeaturePermission>();
  for (const f of local) map.set(`${f.role}:${f.featureId}`, f);
  for (const f of disk) map.set(`${f.role}:${f.featureId}`, f);
  return Array.from(map.values());
}

// ── Normalization ─────────────────────────────────────────────────────────────

export function normalizeUserManagementState(
  state: UserManagementState
): UserManagementState {
  // Fill any missing tab permissions from defaults
  const defaultPerms = createDefaultPermissions();
  // Start with all existing entries (preserves manually-set sub-tab permissions)
  const mergedMap = new Map<string, RolePermission>();
  for (const p of state.permissions) mergedMap.set(`${p.role}:${p.tabId}`, p);
  // Apply defaults for anything not yet explicitly set
  for (const def of defaultPerms) {
    const key = `${def.role}:${def.tabId}`;
    if (!mergedMap.has(key)) mergedMap.set(key, def);
  }
  // Admin and user-management are always locked
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

  return { users: state.users, permissions, featurePermissions };
}

// ── User helpers ──────────────────────────────────────────────────────────────

export function createUserId(): string {
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

export function getPublicManagedUsers(): Array<{
  username: string;
  displayName: string;
}> {
  return getManagedLoginUsers()
    .filter((u) => u.isActive)
    .map((u) => ({ username: u.username, displayName: u.displayName }));
}

// ── Type guard ────────────────────────────────────────────────────────────────

function isUserManagementState(value: unknown): value is UserManagementState {
  if (!value || typeof value !== "object") return false;
  const s = value as Partial<UserManagementState>;
  return Array.isArray(s.users) && Array.isArray(s.permissions);
  // featurePermissions may be absent in old localStorage data — normalizer fills it
}
