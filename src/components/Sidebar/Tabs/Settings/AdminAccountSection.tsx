import { useState } from "react";
import { ChevronRight, ShieldCheck } from "lucide-react";

import { readRealSession } from "../../../../auth/authSession";
import { BOOTSTRAP_ADMIN_USERNAME } from "../../../../auth/authConfig";
import { createPasswordHash } from "../../../../auth/passwordCrypto";
import {
  buildAdminAccountUpdate,
  readAdminAccount,
  writeUserManagementState,
  type UserManagementState,
} from "../../../../auth/userManagement";
import { usePermissions } from "../../../../auth/usePermissions";
import { useWorkspace } from "../../../../data/workspace/useWorkspace";
import { syncUserManagementToDisk } from "../../../../data/workspace/userSync";
import { logError } from "../../../../data/storage/errorLogger";
import "./AdminAccountSection.css";

const MIN_ADMIN_PASSWORD_LENGTH = 3;
const ADMIN_ACCOUNT_FEATURE = "settings.adminAccount";

type Feedback = { type: "ok" | "error"; text: string } | null;

/**
 * Admin-account controls: the sign-in method for the bootstrap admin, and its
 * passcode.
 *
 * Gated on the REAL session (`readRealSession`) for VISIBILITY, not the
 * effective one — no non-admin role may ever see this section. That alone is
 * not enough to keep it inert during a role preview, though: an admin
 * previewing another role keeps the same real session (still "admin"), so a
 * visibility-only gate would leave every control here fully live while
 * impersonating e.g. "employee" (audit finding 13 — this contradicted the
 * comment above until this fix). `canMutate(ADMIN_ACCOUNT_FEATURE)` is the
 * second gate, exactly like `SyncIntervalSection`: it reads through
 * `usePermissions`, which resolves the EFFECTIVE (previewed) role, so it goes
 * false the moment the admin previews anything else. Checked at both the
 * render boundary (disables the controls) and the handler boundary (rejects
 * the write even if a stale render left a control enabled) — the same
 * two-tier pattern used everywhere else in this codebase.
 */
export function AdminAccountSection() {
  const realSession = readRealSession();
  const isRealAdmin =
    realSession?.role === "admin" && realSession.mode !== "demo";

  const { directoryHandle } = useWorkspace();
  const { canMutate } = usePermissions();
  // Expanded on arrival (owner request): the admin-username switch and the
  // passcode editor are the point of this section, so an admin opening Settings
  // sees their current state without hunting for a collapsed header.
  const [isOpen, setIsOpen] = useState(true);
  const [account, setAccount] = useState(() => readAdminAccount());
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  if (!isRealAdmin) return null;

  const actor = realSession.username;
  const canEdit = canMutate(ADMIN_ACCOUNT_FEATURE);
  const noPermissionText = "لا يمكن تعديل حساب المدير أثناء معاينة دور آخر.";

  /**
   * Write first, apply second.
   *
   * `syncUserManagementToDisk` rethrows on CAS exhaustion or a lost folder
   * grant, and the runtime state has no rollback: committing the change before
   * the write meant a failed save still swapped the live passcode (or the
   * sign-in method) for the rest of the session — the admin was told the save
   * failed while `resolveAdminPasswordHash()` had already moved on, and the
   * next unrelated persist pushed the "rejected" value to every machine on the
   * shared folder. With no workspace connected there is nothing to write, so
   * the change applies session-only with its own explicit message.
   */
  async function persistThenApply(next: UserManagementState): Promise<void> {
    if (directoryHandle) {
      await syncUserManagementToDisk(directoryHandle, next, actor);
    } else {
      setFeedback({
        type: "error",
        text: "طُبِّق التغيير في هذه الجلسة فقط — لا توجد مساحة عمل متصلة لحفظه.",
      });
    }
    writeUserManagementState(next, true);
    setAccount(readAdminAccount());
  }

  async function handleToggleUsernameLogin(enabled: boolean): Promise<void> {
    if (isSaving) return;
    // Handler-boundary capability check (the render-boundary one only disables
    // the controls) — see the module doc comment above.
    if (!canMutate(ADMIN_ACCOUNT_FEATURE)) {
      setFeedback({ type: "error", text: noPermissionText });
      return;
    }
    setIsSaving(true);
    setFeedback(null);
    try {
      await persistThenApply(buildAdminAccountUpdate({ allowUsernameLogin: enabled }, actor));
      setFeedback((current) =>
        current ?? {
          type: "ok",
          text: enabled
            ? "تم تفعيل تسجيل الدخول باسم المستخدم admin."
            : "تم التعطيل — الدخول الآن عبر الاختصار المخفي فقط (Alt+A ثم Alt+T).",
        }
      );
    } catch (error) {
      logError("settings.adminAccount.toggle", error);
      setFeedback({ type: "error", text: "تعذّر حفظ الإعداد في مساحة العمل." });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleChangePassword(): Promise<void> {
    if (isSaving) return;
    // Handler-boundary capability check (the render-boundary one only disables
    // the controls) — see the module doc comment above.
    if (!canMutate(ADMIN_ACCOUNT_FEATURE)) {
      setFeedback({ type: "error", text: noPermissionText });
      return;
    }
    setFeedback(null);

    if (newPassword.trim().length < MIN_ADMIN_PASSWORD_LENGTH) {
      setFeedback({
        type: "error",
        text: `كلمة المرور قصيرة جداً — ${MIN_ADMIN_PASSWORD_LENGTH} أحرف على الأقل.`,
      });
      return;
    }
    if (newPassword !== confirmPassword) {
      setFeedback({ type: "error", text: "كلمتا المرور غير متطابقتين." });
      return;
    }

    setIsSaving(true);
    try {
      const passwordHash = await createPasswordHash(newPassword);
      await persistThenApply(buildAdminAccountUpdate({ passwordHash }, actor));
      setNewPassword("");
      setConfirmPassword("");
      setFeedback((current) =>
        current ?? { type: "ok", text: "تم تحديث كلمة مرور المدير." }
      );
    } catch (error) {
      logError("settings.adminAccount.password", error);
      setFeedback({ type: "error", text: "تعذّر حفظ كلمة المرور في مساحة العمل." });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="admin-account-section" dir="rtl">
      <button
        type="button"
        className={`admin-account-header${isOpen ? " is-open" : ""}`}
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
      >
        <span className="admin-account-icon"><ShieldCheck size={16} /></span>
        <span className="admin-account-title">حساب المدير</span>
        {account.passwordHash === null && (
          <span className="admin-account-badge">كلمة المرور الافتراضية</span>
        )}
        <span className={`admin-account-chevron${isOpen ? " open" : ""}`}>
          <ChevronRight size={14} />
        </span>
      </button>

      {isOpen && (
        <div className="admin-account-body">
          <p className="admin-account-note">
            هذه الإعدادات خاصة بحساب المدير الأساسي ({BOOTSTRAP_ADMIN_USERNAME})، ولا
            تظهر إلا لمن سجّل دخوله بهذا الدور فعلياً. تُحفظ في مساحة العمل، فتنطبق
            على كل الأجهزة التي تفتح المجلد نفسه.
          </p>

          <label className="admin-account-toggle" title={!canEdit ? noPermissionText : undefined}>
            <input
              type="checkbox"
              checked={account.allowUsernameLogin}
              disabled={isSaving || !canEdit}
              onChange={(event) => void handleToggleUsernameLogin(event.target.checked)}
            />
            <span>
              السماح بتسجيل الدخول باسم المستخدم <code>admin</code> من شاشة الدخول
              العادية
            </span>
          </label>
          <p className="admin-account-hint">
            عند التعطيل يبقى الدخول متاحاً عبر الاختصار المخفي فقط: Alt+A ثم Alt+T
            (أو Alt+ش ثم Alt+ف).
          </p>

          <div className="admin-account-password">
            <h4>تغيير كلمة مرور المدير</h4>
            <div className="admin-account-password-fields">
              <label>
                <span>كلمة المرور الجديدة</span>
                <input
                  type="password"
                  value={newPassword}
                  autoComplete="new-password"
                  disabled={isSaving || !canEdit}
                  onChange={(event) => setNewPassword(event.target.value)}
                />
              </label>
              <label>
                <span>تأكيد كلمة المرور</span>
                <input
                  type="password"
                  value={confirmPassword}
                  autoComplete="new-password"
                  disabled={isSaving || !canEdit}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                />
              </label>
            </div>
            <button
              type="button"
              className="admin-account-save-btn"
              onClick={() => void handleChangePassword()}
              disabled={isSaving || !canEdit}
              title={!canEdit ? noPermissionText : undefined}
            >
              {isSaving ? "جارٍ الحفظ…" : "تحديث كلمة المرور"}
            </button>
          </div>

          {feedback && (
            <p
              className={`admin-account-feedback ${feedback.type}`}
              role={feedback.type === "error" ? "alert" : "status"}
            >
              {feedback.text}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
