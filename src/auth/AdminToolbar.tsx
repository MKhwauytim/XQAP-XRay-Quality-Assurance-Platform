import "./AdminToolbar.css";
import { useMemo } from "react";
import {
  Briefcase,
  Eye,
  FolderOpen,
  HelpCircle,
  LogOut,
  ShieldCheck,
  UserRound,
  UserCog,
} from "lucide-react";
import type { AuthRole, AuthSession } from "./authTypes";
import { getManagedLoginUsers } from "./userManagement";
import { useWorkspace } from "../data/workspace/useWorkspace";
import { GlobalMonthSelector } from "../components/GlobalMonthSelector/GlobalMonthSelector";

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

function RoleIcon({ role, size = 15 }: { role: AuthRole; size?: number }) {
  switch (role) {
    case "admin":
      return <ShieldCheck size={size} aria-hidden />;
    case "manager":
      return <Briefcase size={size} aria-hidden />;
    case "supervisor":
      return <UserCog size={size} aria-hidden />;
    case "employee":
      return <UserRound size={size} aria-hidden />;
    default:
      return <Eye size={size} aria-hidden />;
  }
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
  // Demo/view sessions carry the admin role only to unlock full tab visibility —
  // they are NOT the admin. Present them as read-only "view mode": no role
  // switcher, no admin tools, just a clear badge and logout.
  const isDemo = session.mode === "demo";
  const isRealAdmin = session.role === "admin" && !isDemo;
  const effectiveRole: AuthRole = isRealAdmin && previewRole ? previewRole : session.role;
  const isImpersonating = effectiveRole !== session.role;

  const { directoryHandle } = useWorkspace();
  const workspaceName = directoryHandle?.name ?? null;

  const displayName = useMemo(() => {
    const match = getManagedLoginUsers().find((u) => u.username === session.username);
    return match?.displayName || session.username;
  }, [session.username]);

  return (
    <div
      className={`auth-admin-toolbar${isImpersonating ? " auth-toolbar-preview" : ""}`}
      dir="rtl"
    >
      <div className="auth-toolbar-status">
        <div className="auth-toolbar-mode">
          <span className="auth-toolbar-kicker">الوضع الحالي</span>
          <strong className="auth-toolbar-mode-value">
            <span className="auth-toolbar-mode-icon">
              <RoleIcon role={isDemo ? "guest" : effectiveRole} />
            </span>
            {isDemo ? "وضع العرض (قراءة فقط)" : `وضع ${getRoleLabel(effectiveRole)}`}
            {isImpersonating && <span className="auth-preview-flag">معاينة</span>}
          </strong>
        </div>

        {workspaceName && (
          <span
            className="auth-toolbar-chip"
            title={`مساحة العمل: ${workspaceName}`}
          >
            <FolderOpen size={14} className="auth-toolbar-chip-icon" aria-hidden />
            <span className="auth-toolbar-chip-text">{workspaceName}</span>
          </span>
        )}
      </div>

      <GlobalMonthSelector allowCreate={!isDemo} />

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
        {!isDemo && (
          <span className="auth-toolbar-user" title={`المستخدم: ${displayName}`}>
            <UserRound size={15} className="auth-toolbar-user-icon" aria-hidden />
            <span className="auth-toolbar-user-name">{displayName}</span>
          </span>
        )}
        {isRealAdmin && (
          <button
            type="button"
            className="auth-toolbar-help"
            onClick={onFeedback}
            aria-label="التواصل والاقتراحات"
            title="التواصل والاقتراحات"
          >
            <HelpCircle size={18} aria-hidden />
          </button>
        )}
        <button type="button" className="auth-toolbar-logout" onClick={onLogout}>
          <LogOut size={15} aria-hidden />
          تسجيل الخروج
        </button>
      </div>
    </div>
  );
}
