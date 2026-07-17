import { Trash2 } from "lucide-react";
import type { Dispatch, FormEventHandler, SetStateAction } from "react";

import type { AuthRole } from "../../../../auth/authTypes";
import {
  MANAGED_ROLES,
  normalizeUsername,
  type ManagedLoginUser,
} from "../../../../auth/userManagement";
import { getLabels } from "../../../../data/labels/labelsStore";
import type { UserFormState } from "./userForm";

type IdentityDraft = { username: string; displayName: string };

type UsersSectionProps = {
  filteredUsers: ManagedLoginUser[];
  search: string;
  onSearchChange: (value: string) => void;
  roleFilter: AuthRole | "all";
  onRoleFilterChange: (value: AuthRole | "all") => void;
  statusFilter: "all" | "active" | "inactive";
  onStatusFilterChange: (value: "all" | "active" | "inactive") => void;
  canEdit: boolean;
  canResetPasswords: boolean;
  isSaving: boolean;
  isCheckingDeletion: boolean;
  showAddForm: boolean;
  onToggleAddForm: () => void;
  form: UserFormState;
  setForm: Dispatch<SetStateAction<UserFormState>>;
  onAddUser: FormEventHandler<HTMLFormElement>;
  getIdentityDraft: (user: ManagedLoginUser) => IdentityDraft;
  onIdentityDraftChange: (user: ManagedLoginUser, field: keyof IdentityDraft, value: string) => void;
  onSaveIdentity: (user: ManagedLoginUser) => void;
  onResetIdentity: (userId: string) => void;
  onUpdateUser: (userId: string, updater: (user: ManagedLoginUser) => ManagedLoginUser) => void;
  resetPasswords: Record<string, string>;
  setResetPasswords: Dispatch<SetStateAction<Record<string, string>>>;
  onResetPassword: (userId: string) => Promise<void>;
  confirmDelete: string | null;
  onRequestDelete: (userId: string) => void;
  onCancelDelete: () => void;
  onConfirmDelete: (userId: string) => Promise<void>;
  deleteBlockedInfo: { userId: string; lines: string[] } | null;
};

function UserRow({ user, props }: { user: ManagedLoginUser; props: UsersSectionProps }) {
  const identityDraft = props.getIdentityDraft(user);
  const hasIdentityChanges = normalizeUsername(identityDraft.username) !== user.username
    || identityDraft.displayName.trim() !== user.displayName;
  const isConfirmingDelete = props.confirmDelete === user.id;
  return <div className={`um-user-row ${!user.isActive ? "um-user-inactive" : ""}`}>
    <div className="um-user-name">
      <div className="um-user-status-dot" data-active={user.isActive} />
      <div className="um-user-identity-edit">
        <input value={identityDraft.displayName} disabled={!props.canEdit || props.isSaving} onChange={(event) => props.onIdentityDraftChange(user, "displayName", event.target.value)} aria-label="الاسم الظاهر" placeholder="الاسم الظاهر" />
        <input value={identityDraft.username} disabled={!props.canEdit || props.isSaving} onChange={(event) => props.onIdentityDraftChange(user, "username", event.target.value)} aria-label="اسم المستخدم" placeholder="اسم المستخدم" autoComplete="off" dir="ltr" />
        {props.canEdit && <div className="um-identity-actions">
          <button type="button" className="um-identity-save" disabled={!hasIdentityChanges || props.isSaving} onClick={() => props.onSaveIdentity(user)}>حفظ</button>
          {hasIdentityChanges && <button type="button" className="um-identity-reset" disabled={props.isSaving} onClick={() => props.onResetIdentity(user.id)}>تراجع</button>}
        </div>}
      </div>
    </div>
    <select value={user.role} disabled={!props.canEdit || props.isSaving} aria-label={`دور المستخدم ${user.displayName}`} onChange={(event) => props.onUpdateUser(user.id, (current) => ({ ...current, role: event.target.value as AuthRole }))} className="um-role-select">
      {MANAGED_ROLES.map((role) => <option key={role.id} value={role.id}>{role.label}</option>)}
    </select>
    <div className="um-user-toggles">
      <label className="um-toggle-label"><input type="checkbox" checked={user.isActive} disabled={!props.canEdit || props.isSaving} onChange={(event) => props.onUpdateUser(user.id, (current) => ({ ...current, isActive: event.target.checked }))} /><span>{user.isActive ? "نشط" : "موقوف"}</span></label>
      <label className="um-toggle-label"><input type="checkbox" checked={user.hasCertScanLicense ?? false} disabled={!props.canEdit || props.isSaving} onChange={(event) => props.onUpdateUser(user.id, (current) => ({ ...current, hasCertScanLicense: event.target.checked }))} /><span>CertScan</span></label>
    </div>
    <div className="um-password-reset">
      <input type="password" value={props.resetPasswords[user.id] ?? ""} disabled={!props.canResetPasswords || props.isSaving} onChange={(event) => props.setResetPasswords((current) => ({ ...current, [user.id]: event.target.value }))} placeholder="كلمة مرور جديدة" autoComplete="new-password" />
      <button type="button" onClick={() => void props.onResetPassword(user.id)} disabled={!props.canResetPasswords || props.isSaving}>تحديث</button>
    </div>
    <div className="um-user-actions">
      {isConfirmingDelete ? <>
        <button className="um-delete-confirm" disabled={props.isCheckingDeletion} onClick={() => void props.onConfirmDelete(user.id)}>{props.isCheckingDeletion ? getLabels().um_delete_checking : "تأكيد الحذف"}</button>
        <button className="um-delete-cancel" disabled={props.isCheckingDeletion} onClick={props.onCancelDelete}>إلغاء</button>
      </> : props.canEdit && <button className="um-delete-btn" onClick={() => props.onRequestDelete(user.id)} title="حذف المستخدم"><Trash2 size={14} /></button>}
    </div>
    {props.deleteBlockedInfo?.userId === user.id && <div className="um-user-actions" style={{ gridColumn: "1 / -1" }}><ul>{props.deleteBlockedInfo.lines.map((line) => <li key={line}>{line}</li>)}</ul></div>}
  </div>;
}

export function UsersSection(props: UsersSectionProps) {
  return <div className="um-section">
    <div className="um-users-toolbar">
      <input className="um-search" type="search" placeholder="ابحث باسم المستخدم أو الاسم الظاهر…" value={props.search} onChange={(event) => props.onSearchChange(event.target.value)} dir="rtl" />
      <div className="um-filter-pills">{(["all", "active", "inactive"] as const).map((status) => <button key={status} className={`um-filter-pill ${props.statusFilter === status ? "active" : ""}`} onClick={() => props.onStatusFilterChange(status)}>{status === "all" ? "الكل" : status === "active" ? "نشط" : "موقوف"}</button>)}</div>
      <div className="um-filter-pills">
        <button className={`um-filter-pill ${props.roleFilter === "all" ? "active" : ""}`} onClick={() => props.onRoleFilterChange("all")}>كل الأدوار</button>
        {MANAGED_ROLES.map((role) => <button key={role.id} className={`um-filter-pill ${props.roleFilter === role.id ? "active" : ""}`} onClick={() => props.onRoleFilterChange(role.id)}>{role.label}</button>)}
      </div>
      {props.canEdit && <button className="um-add-btn" onClick={props.onToggleAddForm}>{props.showAddForm ? "إلغاء" : "+ إضافة مستخدم"}</button>}
    </div>
    {props.showAddForm && props.canEdit && <form className="um-add-form" onSubmit={props.onAddUser}>
      <h3 className="um-add-form-title">مستخدم جديد</h3>
      <div className="um-add-form-grid">
        <label><span>اسم المستخدم</span><input value={props.form.username} onChange={(event) => props.setForm((form) => ({ ...form, username: event.target.value }))} disabled={props.isSaving} autoComplete="off" dir="ltr" /></label>
        <label><span>الاسم الظاهر</span><input value={props.form.displayName} onChange={(event) => props.setForm((form) => ({ ...form, displayName: event.target.value }))} disabled={props.isSaving} autoComplete="off" /></label>
        <label><span>الدور</span><select value={props.form.role} onChange={(event) => props.setForm((form) => ({ ...form, role: event.target.value as AuthRole }))} disabled={props.isSaving}>{MANAGED_ROLES.map((role) => <option key={role.id} value={role.id}>{role.label}</option>)}</select></label>
        <label><span>كلمة المرور</span><input type="password" value={props.form.password} onChange={(event) => props.setForm((form) => ({ ...form, password: event.target.value }))} disabled={props.isSaving} autoComplete="new-password" /></label>
      </div>
      <label className="um-certcheck"><input type="checkbox" checked={props.form.hasCertScanLicense} onChange={(event) => props.setForm((form) => ({ ...form, hasCertScanLicense: event.target.checked }))} disabled={props.isSaving} /><span>رخصة CertScan</span></label>
      <button type="submit" className="um-submit-btn" disabled={props.isSaving}>{props.isSaving ? "جارٍ الإضافة…" : "إضافة المستخدم"}</button>
    </form>}
    {props.filteredUsers.length === 0 ? <div className="um-empty">لا يوجد مستخدمون مطابقون.</div> : <div className="um-user-table">
      <div className="um-user-table-head"><span>المستخدم</span><span>الدور</span><span>الحالة / CertScan</span><span>كلمة المرور</span><span></span></div>
      {props.filteredUsers.map((user) => <UserRow key={user.id} user={user} props={props} />)}
    </div>}
  </div>;
}
