/* eslint-disable react-refresh/only-export-components */

import {
  Fragment,
  useCallback,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";

import type { AuthRole } from "../../../../auth/authTypes";
import { readSession } from "../../../../auth/authSession";
import { createPasswordHash } from "../../../../auth/passwordCrypto";
import {
  MANAGED_FEATURE_GROUPS,
  MANAGED_ROLES,
  MANAGED_TABS,
  TAB_FEATURE_MAP,
  createManagedUser,
  hasFeature,
  hasRolePermission,
  isUsernameAvailable,
  normalizeUsername,
  readUserManagementState,
  writeUserManagementState,
  type FeaturePermission,
  type ManagedLoginUser,
  type PermissionLevel,
  type RolePermission,
  type UserManagementState,
} from "../../../../auth/userManagement";
import { useWorkspace } from "../../../../data/workspace/useWorkspace";
import { readJsonFile, writeJsonFile } from "../../../../data/storage/fileSystemAccess";
import { WORKSPACE_FILE_NAMES } from "../../../../data/workspace/workspaceDefaults";
import type { UsersPermissionsFile } from "../../../../data/workspace/workspaceTypes";
import { WORKSPACE_SCHEMA_VERSION } from "../../../../data/workspace/workspaceTypes";
import type { SidebarTabModule } from "../tabTypes";

import "./UserManagement.css";
import { PageHeader } from "../../../../components/PageHeader/PageHeader";

// ── Tab config ────────────────────────────────────────────────────────────────

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
  order: 40,
  allowedRoles: ["admin"],
  icon: <UserManagementIcon />,
};

// ── Types ─────────────────────────────────────────────────────────────────────

type PageSection = "users" | "page-permissions" | "feature-permissions";
type FeatureSubGroup = "workspace" | "population" | "admin";

type UserFormState = {
  username: string;
  displayName: string;
  password: string;
  role: AuthRole;
  hasCertScanLicense: boolean;
};

const INITIAL_FORM: UserFormState = {
  username: "",
  displayName: "",
  password: "",
  role: "employee",
  hasCertScanLicense: false,
};

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

// ── Main component ────────────────────────────────────────────────────────────

export default function UserManagementTab() {
  const [state, setState] = useState<UserManagementState>(() =>
    readUserManagementState()
  );
  const [section, setSection] = useState<PageSection>("users");
  const [featureGroup, setFeatureGroup] = useState<FeatureSubGroup>("workspace");
  const [form, setForm] = useState<UserFormState>(INITIAL_FORM);
  const [showAddForm, setShowAddForm] = useState(false);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<AuthRole | "all">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"ok" | "bad" | "">("");
  const [resetPasswords, setResetPasswords] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [collapsedParents, setCollapsedParents] = useState<Set<string>>(new Set());

  const session = readSession();
  const { directoryHandle } = useWorkspace();
  const savingToDiskRef = useRef(false);

  const canEdit =
    session?.role === "admin" ||
    Boolean(
      session &&
        hasRolePermission(state.permissions, session.role, "user-management", "edit") &&
        hasFeature(state.featurePermissions, session.role, "manage-users")
    );

  const canEditPermissions =
    session?.role === "admin" ||
    Boolean(
      session &&
        hasFeature(state.featurePermissions, session.role, "edit-permissions")
    );

  const canResetPasswords =
    session?.role === "admin" ||
    Boolean(
      session &&
        hasFeature(state.featurePermissions, session.role, "reset-passwords")
    );

  // ── Derived lists ───────────────────────────────────────────────────────────

  const activeCount = useMemo(
    () => state.users.filter((u) => u.isActive).length,
    [state.users]
  );

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return state.users.filter((u) => {
      if (q && !u.displayName.toLowerCase().includes(q) && !u.username.includes(q)) return false;
      if (roleFilter !== "all" && u.role !== roleFilter) return false;
      if (statusFilter === "active" && !u.isActive) return false;
      if (statusFilter === "inactive" && u.isActive) return false;
      return true;
    });
  }, [state.users, search, roleFilter, statusFilter]);

  // ── Persistence ─────────────────────────────────────────────────────────────

  const saveUsersToDisk = useCallback(async (next: UserManagementState): Promise<void> => {
    if (!directoryHandle || savingToDiskRef.current) return;
    savingToDiskRef.current = true;
    try {
      const actor = readSession()?.username ?? "admin";
      const existing = await readJsonFile<UsersPermissionsFile>(
        directoryHandle,
        WORKSPACE_FILE_NAMES.usersPermissions
      );
      const prevMeta = existing.ok ? existing.file.metadata : null;
      const now = new Date().toISOString();

      const diskFile: UsersPermissionsFile = {
        metadata: {
          schemaVersion: WORKSPACE_SCHEMA_VERSION,
          fileType: "users.permissions",
          revision: prevMeta ? prevMeta.revision + 1 : 1,
          createdAt: prevMeta?.createdAt ?? now,
          createdBy: prevMeta?.createdBy ?? actor,
          updatedAt: now,
          updatedBy: actor,
          contentHash: "",
        },
        data: {
          users: next.users.map((u) => ({
            id: u.id,
            username: u.username,
            displayName: u.displayName,
            passwordHash: u.passwordHash,
            role: u.role,
            isActive: u.isActive,
            hasCertScanLicense: u.hasCertScanLicense ?? false,
            createdAt: u.createdAt,
            createdBy: actor,
            updatedAt: u.updatedAt,
            updatedBy: actor,
          })),
          roles: [
            { id: "guest",      label: "ضيف",  description: "وصول قراءة فقط.",          isSystemRole: true },
            { id: "employee",   label: "موظف",  description: "صلاحيات تشغيلية.",          isSystemRole: true },
            { id: "supervisor", label: "مشرف",  description: "صلاحيات إشرافية.",           isSystemRole: true },
            { id: "manager",    label: "مدير",  description: "صلاحيات إدارية وتشغيلية.", isSystemRole: true },
          ],
          permissions: next.permissions.map((p) => ({
            role: p.role,
            tabId: p.tabId,
            access: p.access,
          })),
          featurePermissions: next.featurePermissions.map((f) => ({
            role: f.role,
            featureId: f.featureId,
            enabled: f.enabled,
          })),
        },
      };

      await writeJsonFile(directoryHandle, WORKSPACE_FILE_NAMES.usersPermissions, diskFile);
    } catch {
      // non-fatal — localStorage is the primary store
    } finally {
      savingToDiskRef.current = false;
    }
  }, [directoryHandle]);

  const persistState = useCallback(
    (next: UserManagementState): void => {
      setState(next);
      writeUserManagementState(next);
      void saveUsersToDisk(next);
    },
    [saveUsersToDisk]
  );

  // ── Message helpers ──────────────────────────────────────────────────────────

  function showMsg(text: string, type: "ok" | "bad"): void {
    setMessage(text);
    setMessageType(type);
    setTimeout(() => { setMessage(""); setMessageType(""); }, 5000);
  }

  // ── User CRUD ────────────────────────────────────────────────────────────────

  async function handleAddUser(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canEdit) { showMsg("صلاحيتك للعرض فقط.", "bad"); return; }

    const username = normalizeUsername(form.username);
    const displayName = form.displayName.trim();

    if (!username || !displayName || !form.password) {
      showMsg("أكمل جميع الحقول المطلوبة.", "bad");
      return;
    }
    if (username === "admin") {
      showMsg("اسم المستخدم «admin» محجوز للمسؤول الأساسي.", "bad");
      return;
    }
    if (!isUsernameAvailable(state.users, username)) {
      showMsg("اسم المستخدم موجود مسبقاً.", "bad");
      return;
    }

    setIsSaving(true);
    try {
      const passwordHash = await createPasswordHash(form.password);
      const newUser = createManagedUser({
        username,
        displayName,
        role: form.role,
        passwordHash,
        isActive: true,
        hasCertScanLicense: form.hasCertScanLicense,
      });
      persistState({ ...state, users: [...state.users, newUser] });
      setForm(INITIAL_FORM);
      setShowAddForm(false);
      showMsg("تمت إضافة المستخدم.", "ok");
    } catch {
      showMsg("تعذر إنشاء المستخدم. حاول مرة أخرى.", "bad");
    } finally {
      setIsSaving(false);
    }
  }

  function updateUser(
    userId: string,
    updater: (u: ManagedLoginUser) => ManagedLoginUser
  ): void {
    if (!canEdit) { showMsg("صلاحيتك للعرض فقط.", "bad"); return; }
    persistState({
      ...state,
      users: state.users.map((u) =>
        u.id === userId ? { ...updater(u), updatedAt: new Date().toISOString() } : u
      ),
    });
    showMsg("تم تحديث المستخدم.", "ok");
  }

  async function handleResetPassword(userId: string): Promise<void> {
    if (!canResetPasswords) { showMsg("لا تملك صلاحية إعادة تعيين كلمات المرور.", "bad"); return; }
    const next = resetPasswords[userId]?.trim() ?? "";
    if (!next) { showMsg("أدخل كلمة المرور الجديدة.", "bad"); return; }
    setIsSaving(true);
    try {
      const passwordHash = await createPasswordHash(next);
      updateUser(userId, (u) => ({ ...u, passwordHash }));
      setResetPasswords((r) => ({ ...r, [userId]: "" }));
      showMsg("تم تغيير كلمة المرور.", "ok");
    } catch {
      showMsg("تعذر تغيير كلمة المرور.", "bad");
    } finally {
      setIsSaving(false);
    }
  }

  function handleDeleteUser(userId: string): void {
    if (!canEdit) { showMsg("صلاحيتك للعرض فقط.", "bad"); return; }
    if (session?.username && state.users.find((u) => u.id === userId)?.username === session.username) {
      showMsg("لا يمكنك حذف حسابك الخاص.", "bad");
      return;
    }
    persistState({ ...state, users: state.users.filter((u) => u.id !== userId) });
    setConfirmDelete(null);
    showMsg("تم حذف المستخدم.", "ok");
  }

  // ── Permission updaters ──────────────────────────────────────────────────────

  function updateTabPermission(role: AuthRole, tabId: string, access: PermissionLevel): void {
    if (!canEditPermissions) { showMsg("لا تملك صلاحية تعديل المصفوفة.", "bad"); return; }
    if (role === "admin") return;

    const next: RolePermission[] = state.permissions.some(
      (p) => p.role === role && p.tabId === tabId
    )
      ? state.permissions.map((p) =>
          p.role === role && p.tabId === tabId ? { ...p, access } : p
        )
      : [...state.permissions, { role, tabId, access }];

    persistState({ ...state, permissions: next });
  }

  function updateFeaturePermission(
    role: AuthRole,
    featureId: string,
    enabled: boolean
  ): void {
    if (!canEditPermissions) { showMsg("لا تملك صلاحية تعديل المصفوفة.", "bad"); return; }
    if (role === "admin") return;

    const next: FeaturePermission[] = state.featurePermissions.some(
      (f) => f.role === role && f.featureId === featureId
    )
      ? state.featurePermissions.map((f) =>
          f.role === role && f.featureId === featureId ? { ...f, enabled } : f
        )
      : [...state.featurePermissions, { role, featureId, enabled }];

    persistState({ ...state, featurePermissions: next });
  }

  function getTabAccess(role: AuthRole, tabId: string): PermissionLevel {
    if (role === "admin") return "edit";
    const explicit = state.permissions.find((p) => p.role === role && p.tabId === tabId);
    if (explicit) return explicit.access;
    // Sub-tab inherits from parent when no explicit rule is set
    const tab = MANAGED_TABS.find((t) => t.id === tabId);
    if (tab?.parentId) {
      return state.permissions.find((p) => p.role === role && p.tabId === tab.parentId)?.access ?? "none";
    }
    return "none";
  }

  function toggleParent(tabId: string) {
    setCollapsedParents((prev) => {
      const next = new Set(prev);
      if (next.has(tabId)) next.delete(tabId); else next.add(tabId);
      return next;
    });
  }

  function getFeatureEnabled(role: AuthRole, featureId: string): boolean {
    if (role === "admin") return true;
    return (
      state.featurePermissions.find((f) => f.role === role && f.featureId === featureId)
        ?.enabled ?? false
    );
  }

  // ── Render helpers ───────────────────────────────────────────────────────────

  const ROLE_BADGE_COLORS: Record<string, string> = {
    guest: "um-badge-guest",
    employee: "um-badge-employee",
    supervisor: "um-badge-supervisor",
    manager: "um-badge-manager",
    admin: "um-badge-admin",
  };

  function RoleBadge({ role }: { role: AuthRole }) {
    const label = MANAGED_ROLES.find((r) => r.id === role)?.label ?? role;
    return <span className={`um-role-badge ${ROLE_BADGE_COLORS[role] ?? ""}`}>{label}</span>;
  }

  // ── Section: Users ───────────────────────────────────────────────────────────

  function renderUsers() {
    return (
      <div className="um-section">
        {/* Toolbar */}
        <div className="um-users-toolbar">
          <input
            className="um-search"
            type="search"
            placeholder="ابحث باسم المستخدم أو الاسم الظاهر…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            dir="rtl"
          />
          <div className="um-filter-pills">
            {(["all", "active", "inactive"] as const).map((s) => (
              <button
                key={s}
                className={`um-filter-pill ${statusFilter === s ? "active" : ""}`}
                onClick={() => setStatusFilter(s)}
              >
                {s === "all" ? "الكل" : s === "active" ? "نشط" : "موقوف"}
              </button>
            ))}
          </div>
          <div className="um-filter-pills">
            <button
              className={`um-filter-pill ${roleFilter === "all" ? "active" : ""}`}
              onClick={() => setRoleFilter("all")}
            >
              كل الأدوار
            </button>
            {MANAGED_ROLES.map((r) => (
              <button
                key={r.id}
                className={`um-filter-pill ${roleFilter === r.id ? "active" : ""}`}
                onClick={() => setRoleFilter(r.id)}
              >
                {r.label}
              </button>
            ))}
          </div>
          {canEdit && (
            <button
              className="um-add-btn"
              onClick={() => setShowAddForm((v) => !v)}
            >
              {showAddForm ? "إلغاء" : "+ إضافة مستخدم"}
            </button>
          )}
        </div>

        {/* Add user form */}
        {showAddForm && canEdit && (
          <form className="um-add-form" onSubmit={handleAddUser}>
            <h3 className="um-add-form-title">مستخدم جديد</h3>
            <div className="um-add-form-grid">
              <label>
                <span>اسم المستخدم</span>
                <input
                  value={form.username}
                  onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                  disabled={isSaving}
                  autoComplete="off"
                  dir="ltr"
                />
              </label>
              <label>
                <span>الاسم الظاهر</span>
                <input
                  value={form.displayName}
                  onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
                  disabled={isSaving}
                  autoComplete="off"
                />
              </label>
              <label>
                <span>الدور</span>
                <select
                  value={form.role}
                  onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as AuthRole }))}
                  disabled={isSaving}
                >
                  {MANAGED_ROLES.map((r) => (
                    <option key={r.id} value={r.id}>{r.label}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>كلمة المرور</span>
                <input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  disabled={isSaving}
                  autoComplete="new-password"
                />
              </label>
            </div>
            <label className="um-certcheck">
              <input
                type="checkbox"
                checked={form.hasCertScanLicense}
                onChange={(e) => setForm((f) => ({ ...f, hasCertScanLicense: e.target.checked }))}
                disabled={isSaving}
              />
              <span>رخصة CertScan</span>
            </label>
            <button type="submit" className="um-submit-btn" disabled={isSaving}>
              {isSaving ? "جارٍ الإضافة…" : "إضافة المستخدم"}
            </button>
          </form>
        )}

        {/* User table */}
        {filteredUsers.length === 0 ? (
          <div className="um-empty">لا يوجد مستخدمون مطابقون.</div>
        ) : (
          <div className="um-user-table">
            <div className="um-user-table-head">
              <span>المستخدم</span>
              <span>الدور</span>
              <span>الحالة / CertScan</span>
              <span>كلمة المرور</span>
              <span></span>
            </div>
            {filteredUsers.map((user) => {
              const isConfirmingDelete = confirmDelete === user.id;
              return (
                <div key={user.id} className={`um-user-row ${!user.isActive ? "um-user-inactive" : ""}`}>
                  {/* Name + username */}
                  <div className="um-user-name">
                    <div className="um-user-status-dot" data-active={user.isActive} />
                    <div>
                      <strong>{user.displayName}</strong>
                      <span dir="ltr">{user.username}</span>
                    </div>
                  </div>

                  {/* Role select */}
                  <select
                    value={user.role}
                    disabled={!canEdit || isSaving}
                    onChange={(e) =>
                      updateUser(user.id, (u) => ({ ...u, role: e.target.value as AuthRole }))
                    }
                    className="um-role-select"
                  >
                    {MANAGED_ROLES.map((r) => (
                      <option key={r.id} value={r.id}>{r.label}</option>
                    ))}
                  </select>

                  {/* Toggles */}
                  <div className="um-user-toggles">
                    <label className="um-toggle-label">
                      <input
                        type="checkbox"
                        checked={user.isActive}
                        disabled={!canEdit || isSaving}
                        onChange={(e) =>
                          updateUser(user.id, (u) => ({ ...u, isActive: e.target.checked }))
                        }
                      />
                      <span>{user.isActive ? "نشط" : "موقوف"}</span>
                    </label>
                    <label className="um-toggle-label">
                      <input
                        type="checkbox"
                        checked={user.hasCertScanLicense ?? false}
                        disabled={!canEdit || isSaving}
                        onChange={(e) =>
                          updateUser(user.id, (u) => ({ ...u, hasCertScanLicense: e.target.checked }))
                        }
                      />
                      <span>CertScan</span>
                    </label>
                  </div>

                  {/* Password reset */}
                  <div className="um-password-reset">
                    <input
                      type="password"
                      value={resetPasswords[user.id] ?? ""}
                      disabled={!canResetPasswords || isSaving}
                      onChange={(e) =>
                        setResetPasswords((r) => ({ ...r, [user.id]: e.target.value }))
                      }
                      placeholder="كلمة مرور جديدة"
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={() => void handleResetPassword(user.id)}
                      disabled={!canResetPasswords || isSaving}
                    >
                      تحديث
                    </button>
                  </div>

                  {/* Delete */}
                  <div className="um-user-actions">
                    {isConfirmingDelete ? (
                      <>
                        <button
                          className="um-delete-confirm"
                          onClick={() => handleDeleteUser(user.id)}
                        >
                          تأكيد الحذف
                        </button>
                        <button
                          className="um-delete-cancel"
                          onClick={() => setConfirmDelete(null)}
                        >
                          إلغاء
                        </button>
                      </>
                    ) : (
                      canEdit && (
                        <button
                          className="um-delete-btn"
                          onClick={() => setConfirmDelete(user.id)}
                          title="حذف المستخدم"
                        >
                          ✕
                        </button>
                      )
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ── Section: Page permissions (Matrix A) ─────────────────────────────────────

  function renderPermCell(role: { id: AuthRole; label: string }, tabId: string, locked: boolean, inheritedFrom?: string) {
    const isAdminRole = role.id === "admin";
    const current = getTabAccess(role.id, tabId);
    // Admin always has edit everywhere — no "inherited" badge, always locked
    const hasExplicit = isAdminRole || state.permissions.some((p) => p.role === role.id && p.tabId === tabId);
    const isInherited = !hasExplicit && Boolean(inheritedFrom);
    const isLocked = locked || isAdminRole || !canEditPermissions;
    return (
      <div className="um-matrix-cell">
        {isInherited && (
          <div className="um-inherit-badge" title={`موروث من ${inheritedFrom}`}>موروث</div>
        )}
        <div className="um-seg-group">
          {(["none", "view", "edit"] as PermissionLevel[]).map((lvl) => (
            <button
              key={lvl}
              className={`um-seg-btn um-seg-${lvl} ${current === lvl ? "active" : ""}`}
              disabled={isLocked}
              onClick={() => updateTabPermission(role.id, tabId, lvl)}
              title={
                isAdminRole ? "مسؤول النظام يملك صلاحيات كاملة دائماً"
                : locked ? "إدارة المستخدمين مقصورة على مسؤول النظام"
                : PERMISSION_HELP[lvl]
              }
              aria-label={`${role.label}: ${tabId} - ${PERMISSION_LABELS[lvl]}`}
            >
              {PERMISSION_LABELS[lvl]}
            </button>
          ))}
        </div>
      </div>
    );
  }

  function renderPagePermissions() {
    const topLevelTabs = MANAGED_TABS.filter((t) => !t.parentId);

    return (
      <div className="um-section">
        <div className="um-matrix-desc">
          حدد ما إذا كان كل دور يستطيع <strong>رؤية</strong> التبويب،
          أو <strong>تعديله</strong> بشكل كامل، أو لا يملك وصولاً إليه.
          تعطيل الوصول لصفحة يعطّل تلقائياً جميع ميزاتها.
          التبويبات الفرعية ترث صلاحية أبيها ما لم تُحدَّد بشكل صريح.
        </div>

        <div className="um-permission-legend" aria-label="شرح مستويات صلاحيات الصفحات">
          {(["edit", "view", "none"] as PermissionLevel[]).map((lvl) => (
            <div key={lvl} className={`um-permission-legend-item um-legend-${lvl}`}>
              <span className="um-permission-dot" aria-hidden="true" />
              <strong>{PERMISSION_LABELS[lvl]}</strong>
              <span>{PERMISSION_HELP[lvl]}</span>
            </div>
          ))}
        </div>

        <div className="um-perm-table-wrap">
          <table className="um-perm-table">
            <thead>
              <tr>
                <th className="um-perm-tab-col">الصفحة / التبويب</th>
                {MANAGED_ROLES.map((r) => (
                  <th key={r.id} className="um-perm-role-col">
                    <RoleBadge role={r.id} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {topLevelTabs.map((tab) => {
                const subTabs = MANAGED_TABS.filter((t) => t.parentId === tab.id);
                const locked = false;
                const hasSubTabs = subTabs.length > 0;
                const isCollapsed = collapsedParents.has(tab.id);
                return (
                  <Fragment key={tab.id}>
                    {/* Top-level tab row — clickable when it has sub-tabs */}
                    <tr
                      className={`um-perm-row-parent${hasSubTabs ? " um-perm-row-expandable" : ""}`}
                      onClick={hasSubTabs ? () => toggleParent(tab.id) : undefined}
                    >
                      <td className="um-perm-tab-name">
                        {hasSubTabs && (
                          <span
                            className="um-parent-chevron"
                            style={{ transform: isCollapsed ? "rotate(0deg)" : "rotate(90deg)" }}
                            aria-hidden="true"
                          >›</span>
                        )}
                        <strong>{tab.label}</strong>
                        {hasSubTabs && (
                          <span className="um-subtabs-count">{subTabs.length}</span>
                        )}
                      </td>
                      {MANAGED_ROLES.map((role) => (
                        <td key={role.id} className="um-perm-cell">
                          {renderPermCell(role, tab.id, locked)}
                        </td>
                      ))}
                    </tr>
                    {/* Sub-tab rows — hidden when parent is collapsed */}
                    {!isCollapsed && subTabs.map((sub) => (
                      <tr key={sub.id} className="um-perm-row-child">
                        <td className="um-perm-tab-name um-perm-subtab">
                          <span className="um-subtab-indicator">↳</span> {sub.label}
                        </td>
                        {MANAGED_ROLES.map((role) => (
                          <td key={role.id} className="um-perm-cell">
                            {renderPermCell(role, sub.id, false, tab.label)}
                          </td>
                        ))}
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

  // ── Section: Feature permissions (Matrix B) ───────────────────────────────────

  function renderFeaturePermissions() {
    const currentGroup = MANAGED_FEATURE_GROUPS.find((g) => g.groupId === featureGroup);

    return (
      <div className="um-section">
        <div className="um-matrix-desc">
          فعّل أو عطّل صلاحيات محددة لكل دور. الميزات المرتبطة بصفحة معطَّلة الوصول
          تظهر بلون رمادي ولا تنتج أثراً — تعطيل الصفحة يلغيها تلقائياً.
        </div>

        <div className="um-feat-nav">
          {MANAGED_FEATURE_GROUPS.map((g) => (
            <button
              key={g.groupId}
              className={`um-feat-tab ${featureGroup === g.groupId ? "active" : ""}`}
              onClick={() => setFeatureGroup(g.groupId as FeatureSubGroup)}
            >
              {g.label}
            </button>
          ))}
        </div>

        {currentGroup && (
          <div className="um-feat-matrix-wrap">
            <table className="um-feat-table">
              <thead>
                <tr>
                  <th className="um-feat-label-col">الميزة</th>
                  {MANAGED_ROLES.map((r) => (
                    <th key={r.id} className="um-feat-role-col">
                      <RoleBadge role={r.id} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {currentGroup.features.map((feat) => {
                  // Find which tab this feature belongs to (for cascade display)
                  const parentTabId = Object.entries(TAB_FEATURE_MAP).find(([, feats]) =>
                    feats.includes(feat.id)
                  )?.[0];

                  return (
                    <tr key={feat.id}>
                      <td className="um-feat-name">
                        <strong>{feat.label}</strong>
                        <span>{feat.description}</span>
                      </td>
                      {MANAGED_ROLES.map((role) => {
                        const pageBlocked =
                          parentTabId != null &&
                          getTabAccess(role.id, parentTabId) === "none";
                        const enabled = getFeatureEnabled(role.id, feat.id);
                        return (
                          <td key={role.id} className="um-feat-cell">
                            <label
                              className={`um-toggle ${pageBlocked ? "um-toggle-cascade-off" : ""}`}
                              title={
                                pageBlocked
                                  ? "يتطلب تفعيل صلاحية الصفحة أولاً"
                                  : undefined
                              }
                            >
                              <input
                                type="checkbox"
                                checked={enabled}
                                disabled={pageBlocked || !canEditPermissions}
                                onChange={(e) =>
                                  updateFeaturePermission(role.id, feat.id, e.target.checked)
                                }
                              />
                              <span className="um-toggle-slider" />
                            </label>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <section className="um-page" aria-label="إدارة المستخدمين">
      <PageHeader
        eyebrow="Administration"
        title="إدارة المستخدمين والصلاحيات"
        subtitle="أضف المستخدمين، حدد أدوارهم، واضبط صلاحيات كل دور على مصفوفتين مستقلتين."
      >
        <div className="um-stats">
          <div className="um-stat">
            <span>المستخدمون</span>
            <strong>{state.users.length}</strong>
          </div>
          <div className="um-stat">
            <span>النشطون</span>
            <strong>{activeCount}</strong>
          </div>
          <div className="um-stat">
            <span>الموقوفون</span>
            <strong>{state.users.length - activeCount}</strong>
          </div>
        </div>
      </PageHeader>

      {/* Status message */}
      {message && (
        <div className={`um-message ${messageType}`} role="status">
          {message}
        </div>
      )}

      {!canEdit && section === "users" && (
        <div className="um-message view-only">
          لديك صلاحية عرض فقط — لا يمكن إضافة مستخدمين أو تعديلهم.
        </div>
      )}

      {!canEditPermissions && section !== "users" && (
        <div className="um-message view-only">
          لديك صلاحية عرض المصفوفة فقط — لا يمكن تعديل الصلاحيات.
        </div>
      )}

      {/* Section navigation */}
      <nav className="um-nav" aria-label="أقسام إدارة المستخدمين">
        {(
          [
            { id: "users",               label: "المستخدمون" },
            { id: "page-permissions",    label: "صلاحيات الصفحات" },
            { id: "feature-permissions", label: "صلاحيات الميزات" },
          ] as { id: PageSection; label: string }[]
        ).map((s) => (
          <button
            key={s.id}
            className={`um-nav-btn ${section === s.id ? "active" : ""}`}
            onClick={() => setSection(s.id)}
          >
            {s.label}
          </button>
        ))}
      </nav>

      {/* Section content */}
      {section === "users" && renderUsers()}
      {section === "page-permissions" && renderPagePermissions()}
      {section === "feature-permissions" && renderFeaturePermissions()}
    </section>
  );
}
