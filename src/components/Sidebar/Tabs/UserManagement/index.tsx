/* eslint-disable react-refresh/only-export-components */

import { ChevronRight, Trash2, UserCog } from "lucide-react";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";

import type { AuthRole } from "../../../../auth/authTypes";
import { readSession } from "../../../../auth/authSession";
import { logRejection } from "../../../../data/storage/errorLogger";
import {
  readAuthActivityLog,
  type AuthActivityLogEntry,
  type AuthActivityCloseReason,
} from "../../../../auth/authActivityLog";
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
import { getUserWorkspaceFootprint } from "../../../../data/samples/sampleMirrorStorage";
import { appendWorkspaceAction } from "../../../../data/audit/actionLog";
import { getLabels } from "../../../../data/labels/labelsStore";
import { syncUserManagementToDisk } from "../../../../data/workspace/userSync";
import type { SidebarTabModule } from "../tabTypes";

import "./UserManagement.css";
import { PageHeader } from "../../../../components/PageHeader/PageHeader";

// ── Tab config ────────────────────────────────────────────────────────────────

export const tabConfig: SidebarTabModule["tabConfig"] = {
  id: "user-management",
  label: "إدارة المستخدمين",
  order: 40,
  allowedRoles: ["admin"],
  icon: <UserCog size={20} strokeWidth={1.8} aria-hidden />,
  subTabs: [
    { id: "users", label: "المستخدمون" },
    { id: "page-permissions", label: "صلاحيات الصفحات" },
    { id: "feature-permissions", label: "صلاحيات الميزات" },
    { id: "activity", label: "متابعة الأنشطة" },
  ],
};

// ── Types ─────────────────────────────────────────────────────────────────────

type PageSection = "users" | "page-permissions" | "feature-permissions" | "activity";
type FeatureSubGroup = "workspace" | "population" | "admin";

const KNOWN_USER_MANAGEMENT_SECTIONS = new Set<PageSection>([
  "users",
  "page-permissions",
  "feature-permissions",
  "activity",
]);

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
  const [identityEdits, setIdentityEdits] = useState<Record<string, { username: string; displayName: string }>>({});
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isCheckingDeletion, setIsCheckingDeletion] = useState(false);
  const [deleteBlockedInfo, setDeleteBlockedInfo] = useState<{ userId: string; lines: string[] } | null>(null);
  const [collapsedParents, setCollapsedParents] = useState<Set<string>>(new Set());
  const [activityEntries, setActivityEntries] = useState<AuthActivityLogEntry[]>([]);
  const [isActivityLoading, setIsActivityLoading] = useState(false);

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

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("pop-subtab-changed", { detail: section }));
  }, [section]);

  useEffect(() => {
    function handler(e: CustomEvent<{ subTabId: string }>) {
      const { subTabId } = e.detail;
      if (KNOWN_USER_MANAGEMENT_SECTIONS.has(subTabId as PageSection)) {
        setSection(subTabId as PageSection);
      }
    }
    window.addEventListener("pop-set-subtab", handler as EventListener);
    return () => window.removeEventListener("pop-set-subtab", handler as EventListener);
  }, []);

  useEffect(() => {
    if (section !== "activity") return;
    let cancelled = false;
    void readAuthActivityLog()
      .then((entries) => {
        if (!cancelled) setActivityEntries(entries);
      })
      .catch(logRejection("userManagement:readAuthActivityLog"))
      .finally(() => {
        if (!cancelled) setIsActivityLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [section, directoryHandle]);

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
      await syncUserManagementToDisk(directoryHandle, next, actor);
    } catch {
      // non-fatal — runtime state remains updated; disk save can be retried.
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

  function getIdentityDraft(user: ManagedLoginUser): { username: string; displayName: string } {
    return identityEdits[user.id] ?? {
      username: user.username,
      displayName: user.displayName,
    };
  }

  function updateIdentityDraft(
    user: ManagedLoginUser,
    field: "username" | "displayName",
    value: string
  ): void {
    setIdentityEdits((current) => {
      const draft = current[user.id] ?? {
        username: user.username,
        displayName: user.displayName,
      };
      return {
        ...current,
        [user.id]: { ...draft, [field]: value },
      };
    });
  }

  function resetIdentityDraft(userId: string): void {
    setIdentityEdits((current) => {
      const next = { ...current };
      delete next[userId];
      return next;
    });
  }

  function handleSaveIdentity(user: ManagedLoginUser): void {
    if (!canEdit) { showMsg("صلاحيتك للعرض فقط.", "bad"); return; }
    const draft = getIdentityDraft(user);
    const username = normalizeUsername(draft.username);
    const displayName = draft.displayName.trim();

    if (!username || !displayName) {
      showMsg("أدخل اسم المستخدم والاسم الظاهر.", "bad");
      return;
    }
    if (username === "admin") {
      showMsg("اسم المستخدم «admin» محجوز للمسؤول الأساسي.", "bad");
      return;
    }
    if (!isUsernameAvailable(state.users, username, user.id)) {
      showMsg("اسم المستخدم موجود مسبقاً.", "bad");
      return;
    }

    updateUser(user.id, (current) => ({ ...current, username, displayName }));
    resetIdentityDraft(user.id);
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

  async function handleDeleteUser(userId: string): Promise<void> {
    if (!canEdit) { showMsg("صلاحيتك للعرض فقط.", "bad"); return; }
    const targetUser = state.users.find((u) => u.id === userId);
    if (session?.username && targetUser?.username === session.username) {
      showMsg("لا يمكنك حذف حسابك الخاص.", "bad");
      return;
    }
    if (!targetUser) return;

    const L = getLabels();
    setDeleteBlockedInfo(null);
    setIsCheckingDeletion(true);
    try {
      let answerFileMonths: string[] = [];
      if (!directoryHandle) {
        // No workspace connected — cannot check assignments; warn and proceed.
        showMsg(L.um_delete_no_workspace_warn, "bad");
      } else {
        const footprint = await getUserWorkspaceFootprint(directoryHandle, targetUser.username);
        if (footprint.activeAssignments.length > 0) {
          const lines = footprint.activeAssignments.map((a) =>
            L.um_delete_blocked_month_line
              .replace("{month}", a.monthFolderName)
              .replace("{count}", String(a.pendingCount))
          );
          setDeleteBlockedInfo({ userId, lines });
          showMsg(L.um_delete_blocked_assignments, "bad");
          return; // Block — no deletion, no force-reassign (v1 decision).
        }
        answerFileMonths = footprint.answerFileMonths;
      }

      persistState({ ...state, users: state.users.filter((u) => u.id !== userId) });
      setConfirmDelete(null);
      void appendWorkspaceAction(directoryHandle, {
        actor: session?.username ?? "unknown",
        actorRole: session?.role ?? "unknown",
        action: "user-deleted",
        target: targetUser.username,
        details: { answerFileMonths: answerFileMonths.join(",") },
      });
      if (answerFileMonths.length > 0) {
        showMsg(L.um_delete_orphan_answers_warn, "ok");
      } else {
        showMsg("تم حذف المستخدم.", "ok");
      }
    } finally {
      setIsCheckingDeletion(false);
    }
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

  function formatDuration(ms: number): string {
    const totalMinutes = Math.max(0, Math.round(ms / 60_000));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours.toLocaleString("ar-SA-u-nu-latn")}س ${minutes.toLocaleString("ar-SA-u-nu-latn")}د`;
  }

  function formatDateTime(value: string | null): string {
    if (!value) return "لم يسجل خروج";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString("ar-SA-u-nu-latn", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function getDateKey(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toISOString().slice(0, 10);
  }

  function getWeekStartKey(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const day = date.getDay();
    date.setDate(date.getDate() - day);
    date.setHours(0, 0, 0, 0);
    return date.toISOString().slice(0, 10);
  }

  function getCloseReasonLabel(reason: AuthActivityCloseReason | null): string {
    if (reason === "logout") return "تسجيل خروج";
    if (reason === "expired") return "انتهت الجلسة";
    if (reason === "session-replaced") return "دخول جديد";
    if (reason === "page-closed") return "إغلاق التطبيق/المتصفح";
    return "نشط";
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
              const identityDraft = getIdentityDraft(user);
              const hasIdentityChanges =
                normalizeUsername(identityDraft.username) !== user.username ||
                identityDraft.displayName.trim() !== user.displayName;
              return (
                <div key={user.id} className={`um-user-row ${!user.isActive ? "um-user-inactive" : ""}`}>
                  {/* Name + username */}
                  <div className="um-user-name">
                    <div className="um-user-status-dot" data-active={user.isActive} />
                    <div className="um-user-identity-edit">
                      <input
                        value={identityDraft.displayName}
                        disabled={!canEdit || isSaving}
                        onChange={(event) =>
                          updateIdentityDraft(user, "displayName", event.target.value)
                        }
                        aria-label="الاسم الظاهر"
                        placeholder="الاسم الظاهر"
                      />
                      <input
                        value={identityDraft.username}
                        disabled={!canEdit || isSaving}
                        onChange={(event) =>
                          updateIdentityDraft(user, "username", event.target.value)
                        }
                        aria-label="اسم المستخدم"
                        placeholder="اسم المستخدم"
                        autoComplete="off"
                        dir="ltr"
                      />
                      {canEdit && (
                        <div className="um-identity-actions">
                          <button
                            type="button"
                            className="um-identity-save"
                            disabled={!hasIdentityChanges || isSaving}
                            onClick={() => handleSaveIdentity(user)}
                          >
                            حفظ
                          </button>
                          {hasIdentityChanges && (
                            <button
                              type="button"
                              className="um-identity-reset"
                              disabled={isSaving}
                              onClick={() => resetIdentityDraft(user.id)}
                            >
                              تراجع
                            </button>
                          )}
                        </div>
                      )}
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
                          disabled={isCheckingDeletion}
                          onClick={() => { void handleDeleteUser(user.id); }}
                        >
                          {isCheckingDeletion ? getLabels().um_delete_checking : "تأكيد الحذف"}
                        </button>
                        <button
                          className="um-delete-cancel"
                          disabled={isCheckingDeletion}
                          onClick={() => { setConfirmDelete(null); setDeleteBlockedInfo(null); }}
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
                          <Trash2 size={14} />
                        </button>
                      )
                    )}
                  </div>
                  {deleteBlockedInfo?.userId === user.id && (
                    <div className="um-user-actions" style={{ gridColumn: "1 / -1" }}>
                      <ul>
                        {deleteBlockedInfo.lines.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    </div>
                  )}
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
                          ><ChevronRight size={14} /></span>
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

  function renderActivity() {
    const todayKey = getDateKey(new Date().toISOString());
    const weekKey = getWeekStartKey(new Date().toISOString());
    const userMap = new Map(state.users.map((user) => [user.username, user]));

    const summaries = state.users
      .filter((user) => user.role === "employee" || user.role === "supervisor")
      .map((user) => {
        const entries = activityEntries.filter((entry) => entry.username === user.username);
        const todayMs = entries
          .filter((entry) => getDateKey(entry.signedInAt) === todayKey)
          .reduce((sum, entry) => sum + entry.durationMs, 0);
        const weekMs = entries
          .filter((entry) => getWeekStartKey(entry.signedInAt) === weekKey)
          .reduce((sum, entry) => sum + entry.durationMs, 0);
        const latest = entries
          .slice()
          .sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt))[0] ?? null;
        return { user, todayMs, weekMs, signIns: entries.length, latest };
      })
      .sort((a, b) => b.weekMs - a.weekMs || a.user.displayName.localeCompare(b.user.displayName, "ar"));

    const latestEntries = activityEntries
      .slice()
      .sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt))
      .slice(0, 100);

    return (
      <div className="um-section">
        <div className="um-matrix-desc">
          تعرض هذه الصفحة سجلات الدخول وساعات العمل المحفوظة داخل مساحة العمل في
          <strong> 5-system/audit/activity.log.json</strong>.
        </div>

        <div className="um-activity-toolbar">
          <button
            type="button"
            className="um-add-btn"
            onClick={() => {
              setIsActivityLoading(true);
              void readAuthActivityLog()
                .then(setActivityEntries)
                .catch(logRejection("userManagement:refreshActivityLog"))
                .finally(() => setIsActivityLoading(false));
            }}
          >
            تحديث السجل
          </button>
          <span>{isActivityLoading ? "جاري تحميل الأنشطة..." : `${activityEntries.length.toLocaleString("ar-SA-u-nu-latn")} سجل`}</span>
        </div>

        <div className="um-activity-summary-grid">
          {summaries.map(({ user, todayMs, weekMs, signIns, latest }) => (
            <article key={user.id} className="um-activity-card">
              <div>
                <strong>{user.displayName}</strong>
                <span>{user.username}</span>
              </div>
              <dl>
                <div>
                  <dt>اليوم</dt>
                  <dd>{formatDuration(todayMs)}</dd>
                </div>
                <div>
                  <dt>هذا الأسبوع</dt>
                  <dd>{formatDuration(weekMs)}</dd>
                </div>
                <div>
                  <dt>مرات الدخول</dt>
                  <dd>{signIns.toLocaleString("ar-SA-u-nu-latn")}</dd>
                </div>
                <div>
                  <dt>آخر حالة</dt>
                  <dd>{getCloseReasonLabel(latest?.closeReason ?? null)}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>

        {latestEntries.length === 0 ? (
          <div className="um-empty">لا توجد سجلات نشاط محفوظة بعد.</div>
        ) : (
          <div className="um-activity-table-wrap">
            <table className="um-activity-table">
              <thead>
                <tr>
                  <th>المستخدم</th>
                  <th>الدور</th>
                  <th>دخول</th>
                  <th>آخر ظهور</th>
                  <th>خروج / إغلاق</th>
                  <th>المدة</th>
                  <th>السبب</th>
                </tr>
              </thead>
              <tbody>
                {latestEntries.map((entry) => {
                  const user = userMap.get(entry.username);
                  return (
                    <tr key={entry.id}>
                      <td>
                        <strong>{user?.displayName ?? entry.username}</strong>
                        <span>{entry.username}</span>
                      </td>
                      <td>{user ? <RoleBadge role={user.role} /> : entry.role}</td>
                      <td>{formatDateTime(entry.signedInAt)}</td>
                      <td>{formatDateTime(entry.lastSeenAt)}</td>
                      <td>{formatDateTime(entry.signedOutAt)}</td>
                      <td>{formatDuration(entry.durationMs)}</td>
                      <td>{getCloseReasonLabel(entry.closeReason)}</td>
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

      {/* Section content */}
      {section === "users" && renderUsers()}
      {section === "page-permissions" && renderPagePermissions()}
      {section === "feature-permissions" && renderFeaturePermissions()}
      {section === "activity" && renderActivity()}
    </section>
  );
}
