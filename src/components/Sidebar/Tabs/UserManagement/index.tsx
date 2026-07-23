/* eslint-disable react-refresh/only-export-components */

import { UserCog } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";

import type { AuthRole } from "../../../../auth/authTypes";
import { readSession } from "../../../../auth/authSession";
import { tabAllowedRoles } from "../../../../auth/tabCatalog";
import { usePermissions } from "../../../../auth/usePermissions";
import { logRejection } from "../../../../data/storage/errorLogger";
import {
  readAuthActivityLog,
  type AuthActivityLogEntry,
} from "../../../../auth/authActivityLog";
import { createPasswordHash } from "../../../../auth/passwordCrypto";
import {
  createManagedUser,
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
import {
  appendWorkspaceAction,
  readWorkspaceActions,
  type WorkspaceActionEntry,
} from "../../../../data/audit/actionLog";
import { getLabels } from "../../../../data/labels/labelsStore";
import { syncUserManagementToDisk } from "../../../../data/workspace/userSync";
import type { SidebarTabModule } from "../tabTypes";

import "./UserManagement.css";
import { PageHeader } from "../../../../components/PageHeader/PageHeader";
import {
  FeaturePermissionsSection,
  PagePermissionsSection,
  type FeatureSubGroup,
} from "./PermissionSections";
import { ActionsSection, ActivitySection } from "./AuditSections";
import {
  UsersSection,
} from "./UsersSection";
import { INITIAL_USER_FORM, type UserFormState } from "./userForm";

// ── Tab config ────────────────────────────────────────────────────────────────

export const tabConfig: SidebarTabModule["tabConfig"] = {
  id: "user-management",
  label: "إدارة المستخدمين",
  order: 40,
  allowedRoles: tabAllowedRoles("user-management"),
  icon: <UserCog size={20} strokeWidth={1.8} aria-hidden />,
  subTabs: [
    { id: "users", label: "المستخدمون" },
    { id: "page-permissions", label: "صلاحيات الصفحات" },
    { id: "feature-permissions", label: "صلاحيات الميزات" },
    { id: "activity", label: "متابعة الأنشطة" },
    { id: "actions", label: "سجل الإجراءات" },
  ],
};

// ── Types ─────────────────────────────────────────────────────────────────────

type PageSection = "users" | "page-permissions" | "feature-permissions" | "activity" | "actions";

const KNOWN_USER_MANAGEMENT_SECTIONS = new Set<PageSection>([
  "users",
  "page-permissions",
  "feature-permissions",
  "activity",
  "actions",
]);

// ── Coalesced disk writer ─────────────────────────────────────────────────────

type MutableRef<T> = { current: T };

/**
 * Runs `run(value)` with "coalesce to latest" semantics: if a call arrives
 * while a previous call is still in flight, `value` simply replaces whatever
 * is queued in `pendingRef` and the in-flight call drains it (and anything
 * even newer that arrives meanwhile) once it settles -- instead of the call
 * being silently skipped, which is what a bare `runningRef.current` skip-guard
 * would do. Exported for direct unit testing; not part of this tab's public
 * surface.
 */
export async function coalesceToLatest<T>(
  runningRef: MutableRef<boolean>,
  pendingRef: MutableRef<T | null>,
  run: (value: T) => Promise<void>,
  value: T
): Promise<void> {
  if (runningRef.current) {
    pendingRef.current = value;
    return;
  }
  runningRef.current = true;
  let current: T | null = value;
  try {
    while (current !== null) {
      try {
        await run(current);
      } catch {
        // `run` owns its own error handling/logging (see saveUsersToDisk) --
        // a failed write must not stop a newer queued value from draining.
      }
      current = pendingRef.current;
      pendingRef.current = null;
    }
  } finally {
    runningRef.current = false;
  }
}

// ── Main component ────────────────────────────────────────────────────────────

export default function UserManagementTab() {
  const [state, setState] = useState<UserManagementState>(() =>
    readUserManagementState()
  );
  const [section, setSection] = useState<PageSection>("users");
  const [featureGroup, setFeatureGroup] = useState<FeatureSubGroup>("workspace");
  const [form, setForm] = useState<UserFormState>(INITIAL_USER_FORM);
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
  const [actionEntries, setActionEntries] = useState<WorkspaceActionEntry[]>([]);
  const [isActionsLoading, setIsActionsLoading] = useState(false);

  const session = readSession();
  const { canMutate } = usePermissions();
  const { directoryHandle } = useWorkspace();
  const savingToDiskRef = useRef(false);
  const pendingStateRef = useRef<UserManagementState | null>(null);

  const canEdit = canMutate("manage-users");
  const canEditPermissions = canMutate("edit-permissions");
  const canResetPasswords = canMutate("reset-passwords");

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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync loading indicator before async activity-log read; necessary to show spinner while data fetches
    setIsActivityLoading(true);
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

  useEffect(() => {
    if (section !== "actions") return;
    if (!directoryHandle) {
      // Nothing to read without a connected workspace -- resolve the flag so
      // it can't stay stuck "loading" from a previous in-flight read whose
      // cleanup just cancelled it (e.g. the workspace was disconnected).
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync empty-state reset when no workspace is connected
      setIsActionsLoading(false);
      return;
    }
    let cancelled = false;
    setIsActionsLoading(true);
    void readWorkspaceActions(directoryHandle)
      .then((entries) => {
        if (!cancelled) setActionEntries(entries);
      })
      .catch(logRejection("userManagement:readWorkspaceActions"))
      .finally(() => {
        if (!cancelled) setIsActionsLoading(false);
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
  //
  // Disk is the sole roster persistence (SEC-01 users.permissions.json), so a
  // write that never happens is a silently lost admin edit, not just a stale
  // cache. coalesceToLatest replaces the old bare skip-guard (which dropped
  // whatever state a call carried whenever a previous write was still in
  // flight): a call that arrives mid-write only replaces the pending value,
  // and the in-flight write drains it afterward instead of losing it.

  const saveUsersToDisk = useCallback((next: UserManagementState): Promise<void> => {
    if (!directoryHandle) return Promise.resolve();
    return coalesceToLatest(savingToDiskRef, pendingStateRef, async (state) => {
      const actor = readSession()?.username ?? "admin";
      await syncUserManagementToDisk(directoryHandle, state, actor);
    }, next);
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
      setForm(INITIAL_USER_FORM);
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

  function toggleParent(tabId: string) {
    setCollapsedParents((prev) => {
      const next = new Set(prev);
      if (next.has(tabId)) next.delete(tabId); else next.add(tabId);
      return next;
    });
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <section className="um-page" aria-label="إدارة المستخدمين">
      <PageHeader
        eyebrow="إدارة النظام"
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
      {section === "users" && (
        <UsersSection
          filteredUsers={filteredUsers}
          search={search}
          onSearchChange={setSearch}
          roleFilter={roleFilter}
          onRoleFilterChange={setRoleFilter}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          canEdit={canEdit}
          canResetPasswords={canResetPasswords}
          isSaving={isSaving}
          isCheckingDeletion={isCheckingDeletion}
          showAddForm={showAddForm}
          onToggleAddForm={() => setShowAddForm((visible) => !visible)}
          form={form}
          setForm={setForm}
          onAddUser={handleAddUser}
          getIdentityDraft={getIdentityDraft}
          onIdentityDraftChange={updateIdentityDraft}
          onSaveIdentity={handleSaveIdentity}
          onResetIdentity={resetIdentityDraft}
          onUpdateUser={updateUser}
          resetPasswords={resetPasswords}
          setResetPasswords={setResetPasswords}
          onResetPassword={handleResetPassword}
          confirmDelete={confirmDelete}
          onRequestDelete={setConfirmDelete}
          onCancelDelete={() => {
            setConfirmDelete(null);
            setDeleteBlockedInfo(null);
          }}
          onConfirmDelete={handleDeleteUser}
          deleteBlockedInfo={deleteBlockedInfo}
        />
      )}
      {section === "page-permissions" && (
        <PagePermissionsSection
          permissions={state.permissions}
          collapsedParents={collapsedParents}
          canEdit={canEditPermissions}
          onToggleParent={toggleParent}
          onUpdate={updateTabPermission}
        />
      )}
      {section === "feature-permissions" && (
        <FeaturePermissionsSection
          permissions={state.permissions}
          featurePermissions={state.featurePermissions}
          featureGroup={featureGroup}
          canEdit={canEditPermissions}
          onGroupChange={setFeatureGroup}
          onUpdate={updateFeaturePermission}
        />
      )}
      {section === "activity" && (
        <ActivitySection
          users={state.users}
          entries={activityEntries}
          isLoading={isActivityLoading}
          hasWorkspace={!!directoryHandle}
          onRefresh={() => {
            setIsActivityLoading(true);
            void readAuthActivityLog()
              .then(setActivityEntries)
              .catch(logRejection("userManagement:refreshActivityLog"))
              .finally(() => setIsActivityLoading(false));
          }}
        />
      )}
      {section === "actions" && (
        <ActionsSection
          entries={actionEntries}
          isLoading={isActionsLoading}
          hasWorkspace={!!directoryHandle}
          onRefresh={() => {
            if (!directoryHandle) return;
            setIsActionsLoading(true);
            void readWorkspaceActions(directoryHandle)
              .then(setActionEntries)
              .catch(logRejection("userManagement:refreshWorkspaceActions"))
              .finally(() => setIsActionsLoading(false));
          }}
        />
      )}
    </section>
  );
}
