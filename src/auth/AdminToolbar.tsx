import "./AdminToolbar.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Briefcase,
  Eye,
  FolderOpen,
  HelpCircle,
  LogOut,
  RefreshCw,
  ShieldCheck,
  UserRound,
  UserCog,
} from "lucide-react";
import type { AuthRole, AuthSession } from "./authTypes";
import { getManagedLoginUsers } from "./userManagement";
import { broadcastDataRefresh } from "../data/workspace/dataRefreshSignal";
import { useWorkspace } from "../data/workspace/useWorkspace";
import { GlobalMonthSelector } from "../components/GlobalMonthSelector/GlobalMonthSelector";
import { useLabels, type Labels } from "../data/labels/useLabels";

const PREVIEW_ROLE_IDS: AuthRole[] = ["admin", "manager", "supervisor", "employee", "guest"];

function getRoleLabel(labels: Labels, role: AuthRole): string {
  const map: Record<AuthRole, string> = {
    admin: labels.toolbar_role_admin,
    manager: labels.toolbar_role_manager,
    supervisor: labels.toolbar_role_supervisor,
    employee: labels.toolbar_role_employee,
    guest: labels.toolbar_role_guest,
  };
  return map[role] ?? labels.toolbar_role_employee;
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
  const labels = useLabels();
  // Demo/view sessions carry the admin role only to unlock full tab visibility —
  // they are NOT the admin. Present them as read-only "view mode": no role
  // switcher, no admin tools, just a clear badge and logout.
  const isDemo = session.mode === "demo";
  const isRealAdmin = session.role === "admin" && !isDemo;
  const effectiveRole: AuthRole = isRealAdmin && previewRole ? previewRole : session.role;
  const isImpersonating = effectiveRole !== session.role;

  const { directoryHandle, refreshPermissions } = useWorkspace();
  const workspaceName = directoryHandle?.name ?? null;

  const displayName = useMemo(() => {
    const match = getManagedLoginUsers().find((u) => u.username === session.username);
    return match?.displayName || session.username;
  }, [session.username]);

  // Manual "refresh now" control: re-syncs users/roles/permissions from disk
  // (see WorkspaceProvider.refreshPermissions) AND broadcasts the app-wide
  // dataRefreshSignal so every mounted view re-reads its own workspace data
  // (assigned samples, referrals/approvals, notifications, ...) — so an
  // admin's edit or another employee's action reaches this session without
  // waiting for the 5-minute auto-refresh in AuthGate or a full page reload.
  const [refreshState, setRefreshState] = useState<"idle" | "running" | "success" | "failed">("idle");
  const refreshResetTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (refreshResetTimer.current !== null) window.clearTimeout(refreshResetTimer.current);
    };
  }, []);

  const handleRefresh = useCallback(async () => {
    if (refreshState === "running") return;
    setRefreshState("running");
    const ok = await refreshPermissions();
    broadcastDataRefresh("manual");
    setRefreshState(ok ? "success" : "failed");
    if (refreshResetTimer.current !== null) window.clearTimeout(refreshResetTimer.current);
    refreshResetTimer.current = window.setTimeout(() => setRefreshState("idle"), 2000);
  }, [refreshPermissions, refreshState]);

  const refreshTitle =
    refreshState === "running" ? labels.toolbar_refresh_running
    : refreshState === "success" ? labels.toolbar_refresh_success
    : refreshState === "failed" ? labels.toolbar_refresh_failed
    : labels.toolbar_refresh_label;

  return (
    <div
      className={`auth-admin-toolbar${isImpersonating ? " auth-toolbar-preview" : ""}`}
      dir="rtl"
    >
      <div className="auth-toolbar-status">
        <div className="auth-toolbar-mode">
          <span className="auth-toolbar-kicker">{labels.toolbar_mode_kicker}</span>
          <strong className="auth-toolbar-mode-value">
            <span className="auth-toolbar-mode-icon">
              <RoleIcon role={isDemo ? "guest" : effectiveRole} />
            </span>
            {isDemo
              ? labels.toolbar_mode_demo
              : labels.toolbar_mode_value.replace("{role}", getRoleLabel(labels, effectiveRole))}
            {isImpersonating && <span className="auth-preview-flag">{labels.toolbar_preview_flag}</span>}
          </strong>
        </div>

        {workspaceName && (
          <span
            className="auth-toolbar-chip"
            title={labels.toolbar_workspace_title.replace("{name}", workspaceName)}
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
            <span className="auth-role-switcher-label">{labels.toolbar_preview_role_label}</span>
            <div className="auth-role-switcher" role="group" aria-label={labels.toolbar_preview_role_aria}>
              {PREVIEW_ROLE_IDS.map((roleId) => (
                <button
                  key={roleId}
                  type="button"
                  className={`auth-role-seg${effectiveRole === roleId ? " active" : ""}`}
                  onClick={() => onPreviewRoleChange(roleId)}
                  aria-pressed={effectiveRole === roleId}
                >
                  {getRoleLabel(labels, roleId)}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="auth-toolbar-actions">
        {!isDemo && (
          <span className="auth-toolbar-user" title={labels.toolbar_user_title.replace("{name}", displayName)}>
            <UserRound size={15} className="auth-toolbar-user-icon" aria-hidden />
            <span className="auth-toolbar-user-name">{displayName}</span>
          </span>
        )}
        {!isDemo && (
          <button
            type="button"
            className={`auth-toolbar-refresh${refreshState !== "idle" ? ` is-${refreshState}` : ""}`}
            onClick={() => void handleRefresh()}
            disabled={refreshState === "running"}
            aria-label={refreshTitle}
            title={refreshTitle}
          >
            <RefreshCw
              size={16}
              aria-hidden
              className={refreshState === "running" ? "auth-toolbar-refresh-icon is-spinning" : "auth-toolbar-refresh-icon"}
            />
          </button>
        )}
        {isRealAdmin && (
          <button
            type="button"
            className="auth-toolbar-help"
            onClick={onFeedback}
            aria-label={labels.toolbar_feedback_label}
            title={labels.toolbar_feedback_label}
          >
            <HelpCircle size={18} aria-hidden />
          </button>
        )}
        <button type="button" className="auth-toolbar-logout" onClick={onLogout}>
          <LogOut size={15} aria-hidden />
          {labels.toolbar_logout_btn}
        </button>
      </div>
    </div>
  );
}
