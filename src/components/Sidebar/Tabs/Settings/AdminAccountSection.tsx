import { useState } from "react";
import { ChevronRight, ShieldCheck } from "lucide-react";

import { readRealSession } from "../../../../auth/authSession";
import { BOOTSTRAP_ADMIN_USERNAME } from "../../../../auth/authConfig";
import { createPasswordHash } from "../../../../auth/passwordCrypto";
import {
  readAdminAccount,
  updateAdminAccount,
} from "../../../../auth/userManagement";
import { useWorkspace } from "../../../../data/workspace/useWorkspace";
import { syncUserManagementToDisk } from "../../../../data/workspace/userSync";
import { logError } from "../../../../data/storage/errorLogger";
import "./AdminAccountSection.css";

const MIN_ADMIN_PASSWORD_LENGTH = 3;

type Feedback = { type: "ok" | "error"; text: string } | null;

/**
 * Admin-account controls: the sign-in method for the bootstrap admin, and its
 * passcode.
 *
 * Gated on the REAL session (`readRealSession`), not the effective one — an
 * admin previewing another role must not be able to change the admin passcode
 * from inside that preview, and no non-admin role may ever see this section.
 * The client-only trust model still applies (see docs/architecture/SECURITY_MODEL.md):
 * this is a role-routing guard, not a trust boundary.
 */
export function AdminAccountSection() {
  const realSession = readRealSession();
  const isRealAdmin =
    realSession?.role === "admin" && realSession.mode !== "demo";

  const { directoryHandle } = useWorkspace();
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

  async function persist(state: ReturnType<typeof updateAdminAccount>): Promise<void> {
    if (!directoryHandle) {
      // Runtime state is already updated; without a workspace there is nowhere
      // to persist it, so say so rather than implying the change was saved.
      setFeedback({
        type: "error",
        text: "طُبِّق التغيير في هذه الجلسة فقط — لا توجد مساحة عمل متصلة لحفظه.",
      });
      return;
    }
    await syncUserManagementToDisk(directoryHandle, state, actor);
  }

  async function handleToggleUsernameLogin(enabled: boolean): Promise<void> {
    if (isSaving) return;
    setIsSaving(true);
    setFeedback(null);
    try {
      const next = updateAdminAccount({ allowUsernameLogin: enabled }, actor);
      setAccount(next.adminAccount);
      await persist(next);
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
      const next = updateAdminAccount({ passwordHash }, actor);
      setAccount(next.adminAccount);
      await persist(next);
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

          <label className="admin-account-toggle">
            <input
              type="checkbox"
              checked={account.allowUsernameLogin}
              disabled={isSaving}
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
                  disabled={isSaving}
                  onChange={(event) => setNewPassword(event.target.value)}
                />
              </label>
              <label>
                <span>تأكيد كلمة المرور</span>
                <input
                  type="password"
                  value={confirmPassword}
                  autoComplete="new-password"
                  disabled={isSaving}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                />
              </label>
            </div>
            <button
              type="button"
              className="admin-account-save-btn"
              onClick={() => void handleChangePassword()}
              disabled={isSaving}
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
