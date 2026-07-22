import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, X, LayoutGrid, Menu } from "lucide-react";

import { EmptyState } from "./components/StateViews/StateViews";
import { ErrorBoundary } from "./components/ErrorBoundary";

import AuthGate from "./auth/AuthGate";
import type { AuthSession } from "./auth/authTypes";
import {
  hasRolePermission,
  readUserManagementState,
  roleCeilingFor,
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
import { GlobalMonthProvider } from "./data/month/GlobalMonthProvider";
import { getLabels } from "./data/labels/labelsStore";
import { useLabels } from "./data/labels/useLabels";
import { useWorkspace } from "./data/workspace/useWorkspace";
import {
  WorkspaceGate,
  WorkspacePicker
} from "./data/workspace/WorkspaceGate";
import { touchTabMountLru } from "./app/tabMountLru";

import "./App.css";

type AppContentProps = {
  session: AuthSession;
};

function AppContent({ session }: AppContentProps) {
  const { directoryHandle, status: workspaceStatus } = useWorkspace();
  const labels = useLabels();
  const [selectedTabId, setSelectedTabId] = useState("");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
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
          // Filter to only sub-tabs the current role can view per the permission matrix
          // AND the sub-tab's own code role ceiling -- a sub-tab's ceiling is independent
          // of its parent's and may be narrower (e.g. reports/kpi vs. reports), so it must
          // be checked with the full sub-tab id, not inherited from the parent tab.
          const prefix = tab.id === "employee-workspace" ? "ew/" : `${tab.id}/`;
          const allowedSubTabs = tab.subTabs.filter((sub) => {
            const subTabId = `${prefix}${sub.id}`;
            const ceiling = roleCeilingFor(subTabId);
            if (ceiling && !ceiling.includes(session.role)) return false;
            return hasRolePermission(permissions, session.role, subTabId, "view");
          });
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
    // Auto-backup runs for admin AND manager sessions now -- day-to-day deployments are
    // often manager-led, and requiring an admin login just to get a daily backup meant
    // most real deployments never actually got one. (The backup itself is unchanged --
    // see backupStorage.ts for the due-check/dedupe logic.)
    if (
      (session.role !== "admin" && session.role !== "manager") ||
      session.mode === "demo" ||
      !directoryHandle ||
      workspaceStatus !== "ready"
    ) return;
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

  // A2: when no explicit tab is selected (or the previous selection is no longer
  // allowed), employees land on their workspace rather than whatever tab happens to
  // sort first in allowedTabs. Landing-order preference only -- employee-workspace
  // must still pass the role + permission-matrix filter above to be present at all.
  const defaultTab =
    session.role === "employee"
      ? allowedTabs.find((tab) => tab.id === "employee-workspace") ?? allowedTabs[0]
      : allowedTabs[0];
  const activeTab =
    allowedTabs.find((tab) => tab.id === selectedTabId) ?? defaultTab;

  const activeTabId = activeTab?.id ?? "";
  const tabScrollPositions = useRef(new Map<string, number>());

  useEffect(() => {
    if (!activeTabId) return;
    const scrollPositions = tabScrollPositions.current;
    const animationFrame = window.requestAnimationFrame(() => {
      window.scrollTo({ top: scrollPositions.get(activeTabId) ?? 0 });
    });
    return () => {
      window.cancelAnimationFrame(animationFrame);
      scrollPositions.set(activeTabId, window.scrollY);
    };
  }, [activeTabId]);

  // Keep only the three most recently used tabs mounted. This preserves the
  // common back-and-forth workflow without retaining every large dataset and
  // hidden DOM tree for the lifetime of the application.
  const [mountedTabIds, setMountedTabIds] = useState<string[]>(
    () => activeTabId ? [activeTabId] : []
  );

  useEffect(() => {
    const allowedIds = new Set(allowedTabs.map((tab) => tab.id));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the LRU changes in response to navigation and access changes
    setMountedTabIds((current) =>
      touchTabMountLru(current, activeTabId, allowedIds)
    );
  }, [activeTabId, allowedTabs]);

  useEffect(() => {
    if (!isMobileSidebarOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isMobileSidebarOpen]);

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
      {isMobileSidebarOpen && (
        <button
          type="button"
          className="app-mobile-nav-backdrop"
          onClick={() => setIsMobileSidebarOpen(false)}
          aria-hidden="true"
          tabIndex={-1}
        />
      )}
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
        isMobileOpen={isMobileSidebarOpen}
        onTabSelect={(tabId) => {
          setSelectedTabId(tabId);
          setIsMobileSidebarOpen(false);
        }}
        onToggleCollapse={toggleSidebar}
        onMobileClose={() => setIsMobileSidebarOpen(false)}
      />

      <section
        className="app-workspace"
        aria-label={labels.app_workspace_aria}
        aria-hidden={isMobileSidebarOpen || undefined}
        inert={isMobileSidebarOpen || undefined}
      >
        <button
          type="button"
          className="app-mobile-nav-button"
          onClick={() => setIsMobileSidebarOpen(true)}
          aria-label="فتح قائمة التنقل"
          aria-expanded={isMobileSidebarOpen}
          aria-controls="app-sidebar"
        >
          <Menu size={20} aria-hidden />
          <span>القائمة</span>
        </button>
        {allowedTabs.length === 0 && <NoAvailableTabs role={session.role} />}
        {allowedTabs.map((tab) =>
          mountedTabIds.includes(tab.id) ? (
            <div
              key={tab.id}
              hidden={tab.id !== activeTabId}
              aria-hidden={tab.id !== activeTabId}
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
      <GlobalMonthProvider>
        <AuthGate>
          {(session) => (
            <WorkspaceGate session={session}>
              {/* key on role so switching the admin role-preview remounts the app,
                  forcing components that read the session once at mount to re-read it. */}
              <AppContent key={session.role} session={session} />
            </WorkspaceGate>
          )}
        </AuthGate>
      </GlobalMonthProvider>
    </WorkspacePicker>
  );
}

export default App;
