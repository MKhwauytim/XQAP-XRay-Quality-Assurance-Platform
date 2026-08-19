import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, X, LayoutGrid, Menu } from "lucide-react";

import { EmptyState, LoadingState } from "./components/StateViews/StateViews";
import { ErrorBoundary } from "./components/ErrorBoundary";

import AuthGate from "./auth/AuthGate";
import type { AuthSession } from "./auth/authTypes";
import {
  hasRolePermission,
  readUserManagementState,
  roleCeilingFor,
  subscribeToUserManagementChanges,
  type FeaturePermission,
  type RolePermission
} from "./auth/userManagement";
import { hasRequiredSubTabFeature } from "./auth/subTabFeatureGate";
import Sidebar from "./components/Sidebar/Sidebar";
import { BootSplashOverlay } from "./components/Sidebar/BootSplashOverlay";
import { SIDEBAR_TABS } from "./components/Sidebar/Tabs/tabRegistry";
import { FeedbackWidget } from "./components/FeedbackWidget/FeedbackWidget";
import { NotificationBanner } from "./components/NotificationBanner/NotificationBanner";
import { RestoreWarningBanner } from "./components/RestoreWarningBanner/RestoreWarningBanner";
import {
  createDailyAdminBackupIfDue,
} from "./data/backup/backupStorage";
import { useQueryClient } from "@tanstack/react-query";
import { monthFoldersQueryOptions } from "./data/query/monthFoldersQuery";
import { useQueryRefreshBridge } from "./data/query/queryRefreshBridge";
import { getLabels } from "./data/labels/labelsStore";
import { useLabels } from "./data/labels/useLabels";
import { useWorkspace } from "./data/workspace/useWorkspace";
import { resetBootProgress } from "./data/workspace/bootProgress";
import {
  WorkspaceGate,
  WorkspacePicker
} from "./data/workspace/WorkspaceGate";
import { touchTabMountLru } from "./app/tabMountLru";
import { useWorkspaceNotifications } from "./data/notifications/useWorkspaceNotifications";
import { useSessionActions } from "./auth/SessionActionsContext";

import "./App.css";

type AppContentProps = {
  session: AuthSession;
};

export function AppContent({ session }: AppContentProps) {
  // Nav 1b: logout moved from the AdminToolbar into the sidebar footer, which
  // renders here rather than in AuthGate.
  const { logout } = useSessionActions();
  const { directoryHandle, status: workspaceStatus } = useWorkspace();
  const labels = useLabels();
  // The app's single broadcast-notification poll. Feeds both the banner below
  // and the sidebar rail's unacknowledged-count badge, so the badge costs no
  // extra workspace read.
  const {
    notifications,
    unacceptedCount: unacceptedNotificationCount,
    reload: reloadNotifications,
  } = useWorkspaceNotifications(session, directoryHandle);
  const queryClient = useQueryClient();
  useQueryRefreshBridge(queryClient);
  const [selectedTabId, setSelectedTabId] = useState("");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [permissions, setPermissions] = useState<RolePermission[]>(
    () => readUserManagementState().permissions
  );
  // Audit finding 14: needed so the sidebar filter can also check
  // SUB_TAB_FEATURE_MAP (shared with EmployeeWorkspaceTab's own gate) --
  // page-level "view" access on `permissions` alone is not sufficient to
  // predict whether a sub-tab's content will actually render anything.
  const [featurePermissions, setFeaturePermissions] = useState<FeaturePermission[]>(
    () => readUserManagementState().featurePermissions
  );
  const [bakWarning, setBakWarning] = useState<string | null>(null);
  const [autoBackupNotice, setAutoBackupNotice] = useState<string | null>(null);
  const [autoBackupRunning, setAutoBackupRunning] = useState(false);
  const autoBackupAttemptKey = `${session.username}:${session.loginAt}:${directoryHandle?.name ?? ""}`;

  // Post-login "data source checklist" (bootProgress.ts) is cleared once per
  // boot session -- a fresh login or a workspace switch -- reusing the same
  // session+workspace identity key as the auto-backup attempt above.
  //
  // useLayoutEffect, NOT useEffect: the landing tab (Population's useMonthLoad,
  // Employee's XrayReferrals) registers its own boot sources from ITS OWN
  // mount effect, and React fires child effects before parent effects within
  // the same commit -- a plain useEffect here would run AFTER that
  // registration and wipe the sources right after they're set. Layout effects
  // are a separate, earlier phase: ALL of them across the whole tree (still
  // child-before-parent among themselves) run before ANY passive effect
  // anywhere in the tree, so this reset still finishes before a descendant's
  // useEffect-based registerBootSources call even though this component is the
  // outermost parent.
  //
  // Doing it during render instead (the "adjusting state when a prop changes"
  // pattern this used to use) was a genuine render-purity violation:
  // resetBootProgress() -> notify() synchronously setStates a DIFFERENT,
  // already-mounted component (BootSplashOverlay), which React rightly warns
  // about and StrictMode's double-render reproduces on sight. An effect is
  // also allowed to run twice, which render is not.
  useLayoutEffect(() => {
    resetBootProgress();
  }, [autoBackupAttemptKey]);

  useEffect(() => {
    return subscribeToUserManagementChanges(() => {
      setPermissions(readUserManagementState().permissions);
      setFeaturePermissions(readUserManagementState().featurePermissions);
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
            if (!hasRolePermission(permissions, session.role, subTabId, "view")) return false;
            // Audit finding 14: page-level "view" access is not the whole
            // story for some sub-tabs (e.g. ew/xray-referrals) -- their
            // content additionally requires one of several specific
            // features. Without this check the link would render but its
            // content would be AccessDenied for a role granted "view" here
            // without any of the required features.
            return hasRequiredSubTabFeature(subTabId, session.role, featurePermissions);
          });
          return { ...tab, subTabs: allowedSubTabs };
        });
    },
    [permissions, featurePermissions, session.role]
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
        const months = await queryClient.fetchQuery(monthFoldersQueryOptions(directoryHandle));
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
  }, [autoBackupAttemptKey, directoryHandle, session.mode, session.role, session.username, workspaceStatus, queryClient]);

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
      {/* An interrupted restore leaves 5-system/restore.inprogress.json behind.
          Nothing used to read it, so a half-restored workspace was
          indistinguishable from a healthy one — this banner is that read side. */}
      <RestoreWarningBanner directoryHandle={directoryHandle} />
      <NotificationBanner
        session={session}
        directoryHandle={directoryHandle}
        notifications={notifications}
        onReload={reloadNotifications}
      />
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
        session={session}
        onLogout={logout}
        notificationCount={unacceptedNotificationCount}
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
          aria-label={labels.app_mobile_nav_aria}
          aria-expanded={isMobileSidebarOpen}
          aria-controls="app-sidebar"
        >
          <Menu size={20} aria-hidden />
          <span>{labels.app_mobile_nav_label}</span>
        </button>
        {allowedTabs.length === 0 && <NoAvailableTabs role={session.role} />}
        {/* Post-login checklist overlay: covers only the tab-content area (not
            the sidebar/toolbar chrome above/around it) while the landing tab's
            own registered boot sources are still loading. Children are ALWAYS
            mounted underneath -- this is a purely visual overlay, not a gate --
            so every tab's own effects (including the boot-source registration
            they self-report) run on schedule whether or not the checklist is
            still showing. `bootSessionKey` is the same session+workspace
            identity used for the reset above -- it is what tells the overlay a
            genuinely new boot session has begun, so the checklist shows exactly
            once per session and a later tab registering its own sources
            mid-session can never bring it back. It is deliberately NOT a React
            `key`: that would remount every child on a session change. */}
        <BootSplashOverlay bootSessionKey={autoBackupAttemptKey}>
          {allowedTabs.map((tab) =>
            mountedTabIds.includes(tab.id) ? (
              <div
                key={tab.id}
                hidden={tab.id !== activeTabId}
                aria-hidden={tab.id !== activeTabId}
              >
                {/* Per-tab boundary: a crash in one tab shows its own recovery UI
                    without unmounting the shell or the other mounted tabs. The root
                    boundary in main.tsx remains as the last-resort catch-all.
                    Suspense is created fresh per tab.id inside this .map(), so each
                    mounted tab (mountedTabIds can hold up to 3 at once) gets its own
                    independent boundary -- one tab's pending lazy chunk can never
                    blank an already-loaded sibling tab that's also mounted-hidden. */}
                <ErrorBoundary>
                  <Suspense fallback={<LoadingState label={labels.app_tab_loading} />}>
                    <tab.TabComponent />
                  </Suspense>
                </ErrorBoundary>
              </div>
            ) : null
          )}
        </BootSplashOverlay>
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
