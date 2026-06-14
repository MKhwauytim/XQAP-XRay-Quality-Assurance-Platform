import type { PasswordHashRecord } from "./passwordCrypto";
import type { AuthRole, LoginUser } from "./authTypes";

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

export type UserManagementState = {
  users: ManagedLoginUser[];
  permissions: RolePermission[];
};

const STORAGE_KEY = "xray_user_management_v1";
const CHANGE_EVENT_NAME = "xray-user-management-change";

export const MANAGED_ROLES: Array<{
  id: AuthRole;
  label: string;
  description: string;
}> = [
  {
    id: "employee",
    label: "موظف",
    description: "صلاحيات تشغيلية حسب مصفوفة الصلاحيات."
  },
  {
    id: "supervisor",
    label: "مشرف",
    description: "صلاحيات مراجعة ومتابعة حسب مصفوفة الصلاحيات."
  },
  {
    id: "admin",
    label: "إدارة",
    description: "إدارة المستخدمين والصلاحيات وتشغيل النظام."
  }
];

export const MANAGED_TABS = [
  {
    id: "population",
    label: "معالجة المجتمع"
  },
  {
    id: "template-builder",
    label: "بانئ النماذج"
  },
  {
    id: "user-management",
    label: "إدارة المستخدمين"
  }
] as const;

export function createDefaultPermissions(): RolePermission[] {
  return [
    { role: "employee", tabId: "population", access: "view" },
    { role: "employee", tabId: "template-builder", access: "none" },
    { role: "employee", tabId: "user-management", access: "none" },
    { role: "supervisor", tabId: "population", access: "view" },
    { role: "supervisor", tabId: "template-builder", access: "none" },
    { role: "supervisor", tabId: "user-management", access: "none" },
    { role: "admin", tabId: "population", access: "edit" },
    { role: "admin", tabId: "template-builder", access: "edit" },
    { role: "admin", tabId: "user-management", access: "edit" }
  ];
}

export function createEmptyUserManagementState(): UserManagementState {
  return {
    users: [],
    permissions: createDefaultPermissions()
  };
}

export function createUserId(): string {
  return `user-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function readUserManagementState(): UserManagementState {
  try {
    const rawValue = localStorage.getItem(STORAGE_KEY);

    if (!rawValue) {
      return createEmptyUserManagementState();
    }

    const parsedValue: unknown = JSON.parse(rawValue);

    if (!isUserManagementState(parsedValue)) {
      return createEmptyUserManagementState();
    }

    return normalizeUserManagementState(parsedValue);
  } catch {
    return createEmptyUserManagementState();
  }
}

export function writeUserManagementState(
  state: UserManagementState,
  notify = true
): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));

  if (notify) {
    window.dispatchEvent(new Event(CHANGE_EVENT_NAME));
  }
}

export function getManagedLoginUsers(): ManagedLoginUser[] {
  return readUserManagementState().users;
}

export function getPublicManagedUsers(): Array<{
  username: string;
  displayName: string;
}> {
  return getManagedLoginUsers()
    .filter((user) => user.isActive)
    .map((user) => ({
      username: user.username,
      displayName: user.displayName
    }));
}

export function getRolePermission(
  permissions: RolePermission[],
  role: AuthRole,
  tabId: string
): PermissionLevel {
  return (
    permissions.find(
      (permission) => permission.role === role && permission.tabId === tabId
    )?.access ?? "none"
  );
}

export function hasRolePermission(
  permissions: RolePermission[],
  role: AuthRole,
  tabId: string,
  minimumAccess: Exclude<PermissionLevel, "none"> = "view"
): boolean {
  const access = getRolePermission(permissions, role, tabId);

  if (minimumAccess === "view") {
    return access === "view" || access === "edit";
  }

  return access === "edit";
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

export function isUsernameAvailable(
  users: ManagedLoginUser[],
  username: string,
  currentUserId?: string
): boolean {
  const normalizedUsername = normalizeUsername(username);

  return !users.some(
    (user) =>
      user.id !== currentUserId &&
      normalizeUsername(user.username) === normalizedUsername
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
    updatedAt: now
  };
}

function normalizeUserManagementState(
  state: UserManagementState
): UserManagementState {
  const defaultPermissions = createDefaultPermissions();

  const permissions = defaultPermissions.map((defaultPermission) => {
    const existingPermission = state.permissions.find(
      (permission) =>
        permission.role === defaultPermission.role &&
        permission.tabId === defaultPermission.tabId
    );

    if (!existingPermission) {
      return defaultPermission;
    }

    if (
      existingPermission.role === "admin" &&
      existingPermission.tabId === "user-management"
    ) {
      return {
        ...existingPermission,
        access: "edit" as const
      };
    }

    return existingPermission;
  });

  return {
    users: state.users,
    permissions
  };
}

function isUserManagementState(value: unknown): value is UserManagementState {
  if (!value || typeof value !== "object") {
    return false;
  }

  const state = value as Partial<UserManagementState>;

  return Array.isArray(state.users) && Array.isArray(state.permissions);
}
