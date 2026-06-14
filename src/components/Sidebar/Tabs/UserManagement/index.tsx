/* eslint-disable react-refresh/only-export-components */

import { useMemo, useState, type FormEvent } from "react";

import type { AuthRole } from "../../../../auth/authTypes";
import { readSession } from "../../../../auth/authSession";
import { createPasswordHash } from "../../../../auth/passwordCrypto";
import {
  MANAGED_ROLES,
  MANAGED_TABS,
  createManagedUser,
  hasRolePermission,
  isUsernameAvailable,
  normalizeUsername,
  readUserManagementState,
  writeUserManagementState,
  type ManagedLoginUser,
  type PermissionLevel,
  type UserManagementState
} from "../../../../auth/userManagement";
import type { SidebarTabModule } from "../tabTypes";

import "./UserManagement.css";

type UserFormState = {
  username: string;
  displayName: string;
  password: string;
  role: AuthRole;
  hasCertScanLicense: boolean;
};

const INITIAL_FORM_STATE: UserFormState = {
  username: "",
  displayName: "",
  password: "",
  role: "employee",
  hasCertScanLicense: false
};

const PERMISSION_LEVELS: Array<{
  value: PermissionLevel;
  label: string;
}> = [
  { value: "none", label: "بدون" },
  { value: "view", label: "عرض" },
  { value: "edit", label: "تعديل" }
];

function UserManagementIcon() {
  return (
    <svg viewBox="0 0 24 24" className="sidebar-icon" aria-hidden="true">
      <path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-3.3 0-6 2.2-6 5v1a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-1c0-2.8-2.7-5-6-5Zm8.5-3.5a2.5 2.5 0 0 0-1.5 4.5v1.3l-1 1a1 1 0 0 0 0 1.4l1.3 1.3a1 1 0 0 0 1.4 0l3.3-3.3a1 1 0 0 0 0-1.4L19.7 13A2.5 2.5 0 0 0 17.5 9.5Zm0 2a.5.5 0 1 1 0 1 .5.5 0 0 1 0-1Z" />
    </svg>
  );
}

export const tabConfig: SidebarTabModule["tabConfig"] = {
  id: "user-management",
  label: "إدارة المستخدمين",
  order: 90,
  allowedRoles: ["employee", "supervisor", "admin"],
  icon: <UserManagementIcon />
};

export default function UserManagementTab() {
  const [state, setState] = useState<UserManagementState>(() =>
    readUserManagementState()
  );
  const [form, setForm] = useState<UserFormState>(INITIAL_FORM_STATE);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"ok" | "bad" | "">("");
  const [resetPasswords, setResetPasswords] = useState<Record<string, string>>(
    {}
  );
  const [isSaving, setIsSaving] = useState(false);
  const session = readSession();
  const canEdit =
    session?.role === "admin" ||
    Boolean(
      session &&
        hasRolePermission(
          state.permissions,
          session.role,
          "user-management",
          "edit"
        )
    );

  const activeUsersCount = useMemo(
    () => state.users.filter((user) => user.isActive).length,
    [state.users]
  );

  function persistState(nextState: UserManagementState): void {
    setState(nextState);
    writeUserManagementState(nextState);
  }

  function showMessage(nextMessage: string, nextType: "ok" | "bad"): void {
    setMessage(nextMessage);
    setMessageType(nextType);
  }

  async function handleAddUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canEdit) {
      showMessage("صلاحيتك الحالية للعرض فقط.", "bad");
      return;
    }

    const username = normalizeUsername(form.username);
    const displayName = form.displayName.trim();
    const password = form.password;

    if (!username || !displayName || !password) {
      showMessage("أكمل اسم المستخدم والاسم الظاهر وكلمة المرور.", "bad");
      return;
    }

    if (username === "admin") {
      showMessage("اسم المستخدم admin محجوز لمسؤول النظام الأساسي.", "bad");
      return;
    }

    if (!isUsernameAvailable(state.users, username)) {
      showMessage("اسم المستخدم موجود مسبقا.", "bad");
      return;
    }

    setIsSaving(true);

    try {
      const passwordHash = await createPasswordHash(password);
      const nextUser = createManagedUser({
        username,
        displayName,
        role: form.role,
        passwordHash,
        isActive: true,
        hasCertScanLicense: form.hasCertScanLicense
      });

      persistState({
        ...state,
        users: [...state.users, nextUser]
      });

      setForm(INITIAL_FORM_STATE);
      showMessage("تمت إضافة المستخدم.", "ok");
    } catch {
      showMessage("تعذر إنشاء المستخدم. حاول مرة أخرى.", "bad");
    } finally {
      setIsSaving(false);
    }
  }

  function updateUser(
    userId: string,
    updater: (user: ManagedLoginUser) => ManagedLoginUser
  ): void {
    if (!canEdit) {
      showMessage("صلاحيتك الحالية للعرض فقط.", "bad");
      return;
    }

    persistState({
      ...state,
      users: state.users.map((user) =>
        user.id === userId
          ? {
              ...updater(user),
              updatedAt: new Date().toISOString()
            }
          : user
      )
    });

    showMessage("تم تحديث المستخدم.", "ok");
  }

  async function resetUserPassword(userId: string): Promise<void> {
    if (!canEdit) {
      showMessage("صلاحيتك الحالية للعرض فقط.", "bad");
      return;
    }

    const nextPassword = resetPasswords[userId]?.trim() ?? "";

    if (!nextPassword) {
      showMessage("أدخل كلمة مرور جديدة للمستخدم.", "bad");
      return;
    }

    setIsSaving(true);

    try {
      const passwordHash = await createPasswordHash(nextPassword);

      updateUser(userId, (user) => ({
        ...user,
        passwordHash
      }));

      setResetPasswords((current) => ({
        ...current,
        [userId]: ""
      }));
      showMessage("تم تغيير كلمة المرور.", "ok");
    } catch {
      showMessage("تعذر تغيير كلمة المرور.", "bad");
    } finally {
      setIsSaving(false);
    }
  }

  function updatePermission(
    role: AuthRole,
    tabId: string,
    access: PermissionLevel
  ): void {
    if (!canEdit) {
      showMessage("صلاحيتك الحالية للعرض فقط.", "bad");
      return;
    }

    if (role === "admin" && tabId === "user-management") {
      access = "edit";
    }

    const nextPermissions = state.permissions.map((permission) =>
      permission.role === role && permission.tabId === tabId
        ? { ...permission, access }
        : permission
    );

    const permissionExists = nextPermissions.some(
      (permission) => permission.role === role && permission.tabId === tabId
    );

    persistState({
      ...state,
      permissions: permissionExists
        ? nextPermissions
        : [...nextPermissions, { role, tabId, access }]
    });

    showMessage("تم تحديث الصلاحيات.", "ok");
  }

  function getPermission(role: AuthRole, tabId: string): PermissionLevel {
    return (
      state.permissions.find(
        (permission) => permission.role === role && permission.tabId === tabId
      )?.access ?? "none"
    );
  }

  return (
    <section className="user-management-page" aria-label="إدارة المستخدمين">
      <header className="user-management-header">
        <div>
          <p className="user-management-eyebrow">Administration</p>
          <h1>إدارة المستخدمين والصلاحيات</h1>
          <p>
            أضف الموظفين، حدد أدوارهم، واضبط صلاحيات كل دور على مستوى العرض أو
            التعديل.
          </p>
        </div>

        <div className="user-management-stats" aria-label="ملخص المستخدمين">
          <span>المستخدمون</span>
          <strong>{state.users.length}</strong>
          <span>النشطون</span>
          <strong>{activeUsersCount}</strong>
        </div>
      </header>

      {message ? (
        <div className={`user-management-message ${messageType}`} role="status">
          {message}
        </div>
      ) : null}

      {!canEdit ? (
        <div className="user-management-message view-only" role="status">
          لديك صلاحية عرض فقط. لا يمكن تعديل المستخدمين أو الصلاحيات.
        </div>
      ) : null}

      <div className="user-management-grid">
        <section className="management-panel add-user-panel">
          <div className="management-panel-header">
            <h2>إضافة مستخدم</h2>
            <p>أنشئ حساب موظف أو مشرف أو مسؤول.</p>
          </div>

          <form className="user-form" onSubmit={handleAddUser}>
            <label>
              <span>اسم المستخدم</span>
              <input
                value={form.username}
                disabled={!canEdit || isSaving}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    username: event.target.value
                  }))
                }
                autoComplete="off"
                dir="ltr"
              />
            </label>

            <label>
              <span>الاسم الظاهر</span>
              <input
                value={form.displayName}
                disabled={!canEdit || isSaving}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    displayName: event.target.value
                  }))
                }
                autoComplete="off"
              />
            </label>

            <label>
              <span>الدور</span>
              <select
                value={form.role}
                disabled={!canEdit || isSaving}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    role: event.target.value as AuthRole
                  }))
                }
              >
                {MANAGED_ROLES.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="active-toggle">
              <input
                type="checkbox"
                checked={form.hasCertScanLicense}
                disabled={!canEdit || isSaving}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    hasCertScanLicense: event.target.checked
                  }))
                }
              />
              <span>رخصة CertScan</span>
            </label>

            <label>
              <span>كلمة المرور</span>
              <input
                type="password"
                value={form.password}
                disabled={!canEdit || isSaving}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    password: event.target.value
                  }))
                }
                autoComplete="new-password"
              />
            </label>

            <button type="submit" disabled={!canEdit || isSaving}>
              إضافة المستخدم
            </button>
          </form>
        </section>

        <section className="management-panel users-panel">
          <div className="management-panel-header">
            <h2>المستخدمون</h2>
            <p>تعديل الدور، حالة الحساب، أو كلمة المرور.</p>
          </div>

          {state.users.length === 0 ? (
            <div className="management-empty-state">
              لا يوجد مستخدمون مضافون بعد.
            </div>
          ) : (
            <div className="users-table">
              <div className="users-table-header">
                <span>المستخدم</span>
                <span>الدور</span>
                <span>الحالة</span>
                <span>كلمة المرور</span>
              </div>

              {state.users.map((user) => (
                <article key={user.id} className="users-table-row">
                  <div>
                    <strong>{user.displayName}</strong>
                    <span dir="ltr">{user.username}</span>
                  </div>

                  <select
                    value={user.role}
                    disabled={!canEdit || isSaving}
                    onChange={(event) =>
                      updateUser(user.id, (current) => ({
                        ...current,
                        role: event.target.value as AuthRole
                      }))
                    }
                  >
                    {MANAGED_ROLES.map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.label}
                      </option>
                    ))}
                  </select>

                  <div>
                    <label className="active-toggle">
                      <input
                        type="checkbox"
                        checked={user.isActive}
                        disabled={!canEdit || isSaving}
                        onChange={(event) =>
                          updateUser(user.id, (current) => ({
                            ...current,
                            isActive: event.target.checked
                          }))
                        }
                      />
                      <span>{user.isActive ? "نشط" : "موقوف"}</span>
                    </label>
                    <label className="active-toggle">
                      <input
                        type="checkbox"
                        checked={user.hasCertScanLicense ?? false}
                        disabled={!canEdit || isSaving}
                        onChange={(event) =>
                          updateUser(user.id, (current) => ({
                            ...current,
                            hasCertScanLicense: event.target.checked
                          }))
                        }
                      />
                      <span>رخصة CertScan</span>
                    </label>
                  </div>

                  <div className="password-reset">
                    <input
                      type="password"
                      value={resetPasswords[user.id] ?? ""}
                      disabled={!canEdit || isSaving}
                      onChange={(event) =>
                        setResetPasswords((current) => ({
                          ...current,
                          [user.id]: event.target.value
                        }))
                      }
                      placeholder="كلمة مرور جديدة"
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={() => void resetUserPassword(user.id)}
                      disabled={!canEdit || isSaving}
                    >
                      تحديث
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="management-panel permission-panel">
        <div className="management-panel-header">
          <h2>مصفوفة الصلاحيات</h2>
          <p>حدد صلاحية كل دور لكل تبويب: بدون، عرض، أو تعديل.</p>
        </div>

        <div className="permission-matrix">
          <div className="permission-row permission-header-row">
            <span>الدور</span>
            {MANAGED_TABS.map((tab) => (
              <span key={tab.id}>{tab.label}</span>
            ))}
          </div>

          {MANAGED_ROLES.map((role) => (
            <div key={role.id} className="permission-row">
              <div className="role-cell">
                <strong>{role.label}</strong>
                <span>{role.description}</span>
              </div>

              {MANAGED_TABS.map((tab) => {
                const currentAccess = getPermission(role.id, tab.id);
                const isProtectedAdminPermission =
                  role.id === "admin" && tab.id === "user-management";

                return (
                  <fieldset key={tab.id} className="permission-options">
                    <legend>{tab.label}</legend>

                    {PERMISSION_LEVELS.map((level) => (
                      <label key={level.value}>
                        <input
                          type="radio"
                          name={`${role.id}-${tab.id}`}
                          value={level.value}
                          checked={currentAccess === level.value}
                          disabled={!canEdit || isProtectedAdminPermission}
                          onChange={() =>
                            updatePermission(role.id, tab.id, level.value)
                          }
                        />
                        <span>{level.label}</span>
                      </label>
                    ))}
                  </fieldset>
                );
              })}
            </div>
          ))}
        </div>
      </section>
    </section>
  );
}
