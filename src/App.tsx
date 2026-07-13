import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, X, LayoutGrid } from "lucide-react";

import { EmptyState } from "./components/StateViews/StateViews";
import { ErrorBoundary } from "./components/ErrorBoundary";

import AuthGate from "./auth/AuthGate";
import type { AuthSession } from "./auth/authTypes";
import {
  hasRolePermission,
  readUserManagementState,
  subscribeToUserManagementChanges,
  type RolePermission
} from "./auth/userManagement";
import Sidebar from "./components/Sidebar/Sidebar";
import { SIDEBAR_TABS } from "./components/Sidebar/Tabs/tabRegistry";
import { FeedbackWidget } from "./components/FeedbackWidget/FeedbackWidget";
import { NotificationBanner } from "./components/NotificationBanner/NotificationBanner";
import {
  createDailyAdminBackupIfDue,
} from "./data/backup/backupStorage";
import { listMonthFolders } from "./data/population/populationStorage";
import { getLabels } from "./data/labels/labelsStore";
import { useLabels } from "./data/labels/useLabels";
import { useWorkspace } from "./data/workspace/useWorkspace";
import {
  WorkspaceGate,
  WorkspacePicker
} from "./data/workspace/WorkspaceGate";

import "./App.css";

type AppContentProps = {
  session: AuthSession;
};

function AppContent({ session }: AppContentProps) {
  const { directoryHandle, status: workspaceStatus } = useWorkspace();
  const labels = useLabels();
  const [selectedTabId, setSelectedTabId] = useState("");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [permissions, setPermissions] = useState<RolePermission[]>(
    () => readUserManagementState().permissions
  );
  const [bakWarning, setBakWarning] = useState<string | null>(null);
  const [autoBackupNotice, setAutoBackupNotice] = useState<string | null>(null);
  const [autoBackupRunning, setAutoBackupRunning] = useState(false);
  const autoBackupAttemptKey = `${session.username}:${session.loginAt}:${directoryHandle?.name ?? ""}`;

  useEffect(() => {
    return subscribeToUserManagementChanges(() => {
      setPermissions(readUserManagementState().permissions);
    });
  }, []);

  const allowedTabs = useMemo(
    () => {
      return SIDEBAR_TABS
        .filter(
          (tab) =>
            tab.allowedRoles.includes(session.role) &&
            hasRolePermission(permissions, session.role, tab.id, "view")
        )
        .map((tab) => {
          if (!tab.subTabs || tab.subTabs.length === 0) return tab;
          // employee-workspace sub-tabs are registered in MANAGED_TABS as "ew/<subId>".
          // Filter to only sub-tabs the current role can view per the permission matrix.
          const prefix = tab.id === "employee-workspace" ? "ew/" : `${tab.id}/`;
          const allowedSubTabs = tab.subTabs.filter((sub) =>
            hasRolePermission(permissions, session.role, `${prefix}${sub.id}`, "view")
          );
          return { ...tab, subTabs: allowedSubTabs };
        });
    },
    [permissions, session.role]
  );

  useEffect(() => {
    const handler = (e: CustomEvent<{ tabId: string }>) => {
      setSelectedTabId(e.detail.tabId);
    };
    window.addEventListener("app-navigate", handler as EventListener);
    return () => window.removeEventListener("app-navigate", handler as EventListener);
  }, []);

  useEffect(() => {
    const handler = (e: CustomEvent<{ fileName: string }>) => {
      setBakWarning(
        getLabels().app_bak_recovered_warning.replace("{fileName}", e.detail.fileName)
      );
    };
    window.addEventListener("data:recovered-from-bak", handler as EventListener);
    return () => window.removeEventListener("data:recovered-from-bak", handler as EventListener);
  }, []);

  useEffect(() => {
    if (session.role !== "admin" || session.mode === "demo" || !directoryHandle || workspaceStatus !== "ready") return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (!cancelled) setAutoBackupRunning(true);
    }, 0);
    void (async () => {
      try {
        const months = await listMonthFolders(directoryHandle);
        const result = await createDailyAdminBackupIfDue(directoryHandle, months, session.username);
        if (cancelled) return;
        if (result.ok && "skipped" in result) {
          setAutoBackupNotice(null);
        } else if (result.ok) {
          setAutoBackupNotice(getLabels().app_auto_backup_done.replace("{folderName}", result.folderName));
        } else {
          setAutoBackupNotice(getLabels().app_auto_backup_failed.replace("{error}", result.error));
        }
      } catch (error) {
        if (!cancelled) {
          setAutoBackupNotice(
            getLabels().app_auto_backup_failed.replace(
              "{error}",
              error instanceof Error ? error.message : getLabels().app_unknown_error
            )
          );
        }
      } finally {
        if (!cancelled) setAutoBackupRunning(false);
      }
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [autoBackupAttemptKey, directoryHandle, session.mode, session.role, session.username, workspaceStatus]);

  const activeTab =
    allowedTabs.find((tab) => tab.id === selectedTabId) ?? allowedTabs[0];

  const activeTabId = activeTab?.id ?? "";

  // Lazy-mount: track which tabs have been visited so their state survives tab switches
  const [mountedTabIds, setMountedTabIds] = useState<Set<string>>(
    () => new Set(activeTabId ? [activeTabId] : [])
  );

  useEffect(() => {
    if (activeTabId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- accumulates visited tabs; useMemo cannot grow a Set across renders, making this effect the correct pattern
      setMountedTabIds((prev) =>
        prev.has(activeTabId) ? prev : new Set([...prev, activeTabId])
      );
    }
  }, [activeTabId]);

  // Drop tabs that are no longer allowed (role change)
  useEffect(() => {
    const allowedIds = new Set(allowedTabs.map((t) => t.id));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- prunes stale tab refs on role change; set updater ensures a single re-render
    setMountedTabIds((prev) => {
      const next = new Set([...prev].filter((id) => allowedIds.has(id)));
      return next.size !== prev.size ? next : prev;
    });
  }, [allowedTabs]);

  function toggleSidebar(): void {
    setIsSidebarCollapsed((current) => !current);
  }

  return (
    <>
      {/* VIS-01: rendered in flow after the sticky AdminToolbar (never fixed
          over it) so the toolbar — including logout — stays clickable. */}
      {session.mode === "demo" && (
        <div role="status" dir="rtl" className="app-demo-banner">
          {labels.app_demo_banner}
        </div>
      )}
      <NotificationBanner session={session} directoryHandle={directoryHandle} />
      <main
        className={`app-shell ${isSidebarCollapsed ? "sidebar-collapsed" : ""}`}
        dir="rtl"
      >
      {bakWarning && (
        <div className="app-bak-warning">
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><AlertTriangle size={16} /> {bakWarning}</span>
          <button
            onClick={() => setBakWarning(null)}
            className="app-bak-warning-close"
            aria-label={labels.app_close_aria}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {(autoBackupNotice || autoBackupRunning) && (
        <div className="app-backup-toast" role="status" dir="rtl">
          <span>{autoBackupRunning ? labels.app_auto_backup_running : autoBackupNotice}</span>
          {!autoBackupRunning && (
            <button type="button" onClick={() => setAutoBackupNotice(null)} aria-label={labels.app_close_aria}>
              <X size={16} />
            </button>
          )}
        </div>
      )}
      <Sidebar
        tabs={allowedTabs}
        activeTabId={activeTabId}
        isCollapsed={isSidebarCollapsed}
        onTabSelect={setSelectedTabId}
        onToggleCollapse={toggleSidebar}
      />

      <section className="app-workspace" aria-label={labels.app_workspace_aria}>
        {allowedTabs.length === 0 && <NoAvailableTabs role={session.role} />}
        {allowedTabs.map((tab) =>
          mountedTabIds.has(tab.id) ? (
            <div
              key={tab.id}
              style={tab.id !== activeTabId ? { display: "none" } : undefined}
            >
              {/* Per-tab boundary: a crash in one tab shows its own recovery UI
                  without unmounting the shell or the other mounted tabs. The root
                  boundary in main.tsx remains as the last-resort catch-all. */}
              <ErrorBoundary>
                <tab.TabComponent />
              </ErrorBoundary>
            </div>
          ) : null
        )}
      </section>

      <FeedbackWidget />
      </main>
    </>
  );
}

function NoAvailableTabs({ role }: { role: AuthSession["role"] }) {
  const labels = useLabels();
  return (
    <div className="tab-blank" dir="rtl">
      <EmptyState
        icon={<LayoutGrid />}
        title={labels.app_no_tabs_title}
        description={
          <>
            {labels.app_no_tabs_desc_prefix} <strong>{role}</strong>
          </>
        }
      />
    </div>
  );
}

function App() {
  return (
    <WorkspacePicker>
      <AuthGate>
        {(session) => (
          <WorkspaceGate session={session}>
            {/* key on role so switching the admin role-preview remounts the app,
                forcing components that read the session once at mount to re-read it. */}
            <AppContent key={session.role} session={session} />
          </WorkspaceGate>
        )}
      </AuthGate>
    </WorkspacePicker>
  );
}

export default App;
