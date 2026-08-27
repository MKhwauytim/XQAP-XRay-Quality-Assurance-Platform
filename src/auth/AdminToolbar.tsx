import "./AdminToolbar.css";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Briefcase,
  Bug,
  Download,
  Eye,
  HelpCircle,
  RefreshCw,
  ShieldCheck,
  UserRound,
  UserCog,
} from "lucide-react";
import type { AuthRole, AuthSession } from "./authTypes";
import { runSync } from "../data/workspace/workspaceSync";
import { useWorkspace } from "../data/workspace/useWorkspace";
import { useGlobalMonth } from "../data/month/useGlobalMonth";
import { useLabels, type Labels } from "../data/labels/useLabels";
import { useFeedbackUnread } from "../data/feedback/useFeedbackUnread";
import { useDemoDebugEnabled, setDemoDebugEnabled } from "../data/debug/demoDebugStore";
import { recordSyncSample } from "../data/debug/syncMetrics";
import { exportDemoDebugReport } from "../data/debug/demoDebugReport";
import { DemoDebugPanel } from "../components/DebugPanel/DemoDebugPanel";

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
  onFeedback: () => void;
};

/**
 * Nav 1b demoted this bar to what it is actually for: the current mode, the
 * admin's role-preview switch, and the two global icon actions. The month
 * selector, the workspace chip, the user chip and logout all moved into the
 * sidebar rail (`Sidebar.tsx`'s context card and footer) — they are NOT
 * duplicated here.
 */
export function AdminToolbar({
  session,
  previewRole,
  onPreviewRoleChange,
  onFeedback,
}: AdminToolbarProps) {
  const labels = useLabels();
  // Demo sessions (demo/demo) carry the admin role and are fully interactive:
  // the same role-preview switch a real admin gets is how the demo walks
  // through every role's view (owner request, 2026-08-26 — "keep it as it
  // is": the ordinary switch, no separate demo-accounts control). Only the
  // admin-feedback button stays real-admin-only, and the mode badge keeps
  // demo sessions clearly labeled.
  const isDemo = session.mode === "demo";
  const isRealAdmin = session.role === "admin" && !isDemo;
  const canPreviewRoles = session.role === "admin";
  const effectiveRole: AuthRole = canPreviewRoles && previewRole ? previewRole : session.role;
  const isImpersonating = effectiveRole !== session.role;

  // Unread feedback, shared with the floating trigger in FeedbackWidget (see
  // FeedbackUnreadProvider) — one poll feeds both dots.
  const { unreadCount: unreadFeedbackCount } = useFeedbackUnread();
  const { directoryHandle, refreshPermissions } = useWorkspace();
  const { selection } = useGlobalMonth();
  // Still read here (not rendered): runSync needs the selected month to probe it.
  const monthFolderName = selection.kind === "existing" ? selection.folderName : null;

  // Manual "refresh now" control — the MANUAL trigger of the app's one sync
  // path (`workspaceSync.ts`): it calls exactly the same runSync() the 45s
  // automatic tick in SyncTick.tsx calls, with `manual: true`. That flag
  // re-syncs users/roles/permissions from disk (see
  // WorkspaceProvider.refreshPermissions), probes the selected month, and
  // then broadcasts the app-wide dataRefreshSignal UNCONDITIONALLY — even
  // when the probe found nothing — so every mounted view re-reads its own
  // workspace data (assigned samples, referrals/approvals, notifications,
  // ...) and every cache is purged. Pressing refresh because something looks
  // stale has to reliably fix it, which is why the manual path does not stop
  // at an empty change set the way the automatic one does.
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
    const startedAt = performance.now();
    const result = await runSync({
      manual: true,
      directoryHandle,
      monthFolderName,
      refreshPermissions,
    });
    // Demo debug tools observe this SAME call's result — never a second
    // runSync trigger — so a manual refresh's timing shows up in the debug
    // panel/report without touching workspaceSync.ts or SyncTick.tsx.
    if (isDemo) {
      recordSyncSample({
        at: Date.now(),
        ok: result.ok,
        ran: result.ran,
        broadcast: result.broadcast,
        changedCount: result.changed.size,
        durationMs: performance.now() - startedAt,
      });
    }
    setRefreshState(result.ok ? "success" : "failed");
    if (refreshResetTimer.current !== null) window.clearTimeout(refreshResetTimer.current);
    refreshResetTimer.current = window.setTimeout(() => setRefreshState("idle"), 2000);
  }, [directoryHandle, isDemo, monthFolderName, refreshPermissions, refreshState]);

  // Demo-only debug tools (owner request, 2026-08-27): a toggle that shows a
  // live diagnostics panel (connection, sync timing, main-thread
  // responsiveness, recent errors) plus an export-to-JSON report button, so a
  // demo session can be debugged from an artifact instead of a screen-share.
  // Gated on `isDemo` alone — never rendered for a real session.
  const debugEnabled = useDemoDebugEnabled();
  const [isExportingDebug, setIsExportingDebug] = useState(false);

  const handleToggleDebug = useCallback(() => {
    setDemoDebugEnabled(!debugEnabled);
  }, [debugEnabled]);

  const handleExportDebug = useCallback(async () => {
    if (isExportingDebug) return;
    setIsExportingDebug(true);
    try {
      await exportDemoDebugReport();
    } finally {
      setIsExportingDebug(false);
    }
  }, [isExportingDebug]);

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
              <RoleIcon role={effectiveRole} />
            </span>
            {isDemo
              ? labels.toolbar_mode_demo
              : labels.toolbar_mode_value.replace("{role}", getRoleLabel(labels, effectiveRole))}
            {isImpersonating && <span className="auth-preview-flag">{labels.toolbar_preview_flag}</span>}
          </strong>
        </div>

      </div>

      <div className="auth-toolbar-preview-panel">
        {canPreviewRoles && (
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
        {isRealAdmin && (
          <button
            type="button"
            className="auth-toolbar-help"
            onClick={onFeedback}
            aria-label={
              unreadFeedbackCount > 0
                ? `${labels.toolbar_feedback_label} — ${labels.fb_unread_dot_aria.replace("{count}", unreadFeedbackCount.toLocaleString("ar-SA-u-nu-latn"))}`
                : labels.toolbar_feedback_label
            }
            title={labels.toolbar_feedback_label}
          >
            <HelpCircle size={18} aria-hidden />
            {/* Unread dot: a message an employee sent (or a reply from anyone
                else) that this admin has not opened the panel on yet. Decorative
                only — the count is spelled out in the aria-label above. */}
            {unreadFeedbackCount > 0 && <span className="auth-toolbar-dot" aria-hidden="true" />}
          </button>
        )}
        {isDemo && (
          <>
            <button
              type="button"
              className={`auth-toolbar-debug${debugEnabled ? " is-active" : ""}`}
              onClick={handleToggleDebug}
              aria-pressed={debugEnabled}
              aria-label={debugEnabled ? labels.toolbar_debug_toggle_hide : labels.toolbar_debug_toggle_show}
              title={debugEnabled ? labels.toolbar_debug_toggle_hide : labels.toolbar_debug_toggle_show}
            >
              <Bug size={16} aria-hidden />
            </button>
            {debugEnabled && (
              <button
                type="button"
                className="auth-toolbar-debug-export"
                onClick={() => { void handleExportDebug(); }}
                disabled={isExportingDebug}
                title={labels.toolbar_debug_export_btn}
              >
                <Download size={14} aria-hidden />
                {isExportingDebug ? labels.toolbar_debug_exporting : labels.toolbar_debug_export_btn}
              </button>
            )}
          </>
        )}
      </div>

      {isDemo && debugEnabled && <DemoDebugPanel onClose={() => setDemoDebugEnabled(false)} />}
    </div>
  );
}
