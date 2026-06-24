import "./AdminToolbar.css";
import type { AuthRole, AuthSession } from "./authTypes";

const PREVIEW_ROLE_IDS: AuthRole[] = ["admin", "manager", "supervisor", "employee", "guest"];

function getRoleLabel(role: AuthRole): string {
  const map: Record<AuthRole, string> = {
    admin: "الإدارة",
    manager: "المدير",
    supervisor: "المشرف",
    employee: "الموظف",
    guest: "ضيف",
  };
  return map[role] ?? "الموظف";
}

type AdminToolbarProps = {
  session: AuthSession;
  previewRole: AuthRole | null;
  onPreviewRoleChange: (role: AuthRole) => void;
  onLogout: () => void;
  onFeedback: () => void;
};

export function AdminToolbar({
  session,
  previewRole,
  onPreviewRoleChange,
  onLogout,
  onFeedback,
}: AdminToolbarProps) {
  const isRealAdmin = session.role === "admin";
  const effectiveRole: AuthRole = isRealAdmin && previewRole ? previewRole : session.role;
  const isImpersonating = effectiveRole !== session.role;

  return (
    <div
      className={`auth-admin-toolbar${isImpersonating ? " auth-toolbar-preview" : ""}`}
      dir="rtl"
    >
      <div className="auth-toolbar-status">
        <span className="auth-toolbar-kicker">الوضع الحالي</span>
        <strong>
          وضع {getRoleLabel(effectiveRole)}
          {isImpersonating && <span className="auth-preview-flag">معاينة</span>}
        </strong>
      </div>

      <div className="auth-toolbar-preview-panel">
        {isRealAdmin && (
          <>
            <span className="auth-role-switcher-label">معاينة الدور</span>
            <div className="auth-role-switcher" role="group" aria-label="معاينة الأدوار">
              {PREVIEW_ROLE_IDS.map((roleId) => (
                <button
                  key={roleId}
                  type="button"
                  className={`auth-role-seg${effectiveRole === roleId ? " active" : ""}`}
                  onClick={() => onPreviewRoleChange(roleId)}
                  aria-pressed={effectiveRole === roleId}
                >
                  {getRoleLabel(roleId)}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="auth-toolbar-actions">
        {isRealAdmin && (
          <button
            type="button"
            className="auth-toolbar-help"
            onClick={onFeedback}
            aria-label="التواصل والاقتراحات"
            title="التواصل والاقتراحات"
          >
            ?
          </button>
        )}
        <button type="button" className="auth-toolbar-logout" onClick={onLogout}>
          تسجيل الخروج
        </button>
      </div>
    </div>
  );
}
