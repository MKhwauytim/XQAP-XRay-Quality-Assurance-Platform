import { useEffect, useMemo, useState } from "react";

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
import {
  createDailyAdminBackupIfDue,
} from "./data/backup/backupStorage";
import { listMonthFolders } from "./data/population/populationStorage";
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
        `تم استرداد الملف "${e.detail.fileName}" من النسخة الاحتياطية — قد تكون البيانات غير مكتملة، يُرجى المراجعة.`
      );
    };
    window.addEventListener("data:recovered-from-bak", handler as EventListener);
    return () => window.removeEventListener("data:recovered-from-bak", handler as EventListener);
  }, []);

  useEffect(() => {
    if (session.role !== "admin" || !directoryHandle || workspaceStatus !== "ready") return;
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
          setAutoBackupNotice(`تم إنشاء النسخة الاحتياطية التلقائية: ${result.folderName}`);
        } else {
          setAutoBackupNotice(`تعذر إنشاء النسخة الاحتياطية التلقائية: ${result.error}`);
        }
      } catch (error) {
        if (!cancelled) {
          setAutoBackupNotice(
            `تعذر إنشاء النسخة الاحتياطية التلقائية: ${error instanceof Error ? error.message : "خطأ غير معروف"}`
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
  }, [autoBackupAttemptKey, directoryHandle, session.role, session.username, workspaceStatus]);

  const activeTab =
    allowedTabs.find((tab) => tab.id === selectedTabId) ?? allowedTabs[0];

  const activeTabId = activeTab?.id ?? "";

  // Lazy-mount: track which tabs have been visited so their state survives tab switches
  const [mountedTabIds, setMountedTabIds] = useState<Set<string>>(
    () => new Set(activeTabId ? [activeTabId] : [])
  );

  useEffect(() => {
    if (activeTabId) {
      setMountedTabIds((prev) =>
        prev.has(activeTabId) ? prev : new Set([...prev, activeTabId])
      );
    }
  }, [activeTabId]);

  // Drop tabs that are no longer allowed (role change)
  useEffect(() => {
    const allowedIds = new Set(allowedTabs.map((t) => t.id));
    setMountedTabIds((prev) => {
      const next = new Set([...prev].filter((id) => allowedIds.has(id)));
      return next.size !== prev.size ? next : prev;
    });
  }, [allowedTabs]);

  function toggleSidebar(): void {
    setIsSidebarCollapsed((current) => !current);
  }

  return (
    <main
      className={`app-shell ${isSidebarCollapsed ? "sidebar-collapsed" : ""}`}
      dir="rtl"
    >
      {bakWarning && (
        <div className="app-bak-warning">
          <span>⚠️ {bakWarning}</span>
          <button
            onClick={() => setBakWarning(null)}
            className="app-bak-warning-close"
            aria-label="إغلاق"
          >
            ×
          </button>
        </div>
      )}
      {(autoBackupNotice || autoBackupRunning) && (
        <div className="app-backup-toast" role="status" dir="rtl">
          <span>{autoBackupRunning ? "جاري إنشاء النسخة الاحتياطية التلقائية..." : autoBackupNotice}</span>
          {!autoBackupRunning && (
            <button type="button" onClick={() => setAutoBackupNotice(null)} aria-label="إغلاق">
              ×
            </button>
          )}
        </div>
      )}
      <Sidebar
        tabs={allowedTabs}
        activeTabId={activeTabId}
        role={session.role}
        isCollapsed={isSidebarCollapsed}
        onTabSelect={setSelectedTabId}
        onToggleCollapse={toggleSidebar}
      />

      <section className="app-workspace" aria-label="مساحة العمل">
        {allowedTabs.length === 0 && <NoAvailableTabs role={session.role} />}
        {allowedTabs.map((tab) =>
          mountedTabIds.has(tab.id) ? (
            <div
              key={tab.id}
              style={tab.id !== activeTabId ? { display: "none" } : undefined}
            >
              <tab.TabComponent />
            </div>
          ) : null
        )}
      </section>

      <FeedbackWidget />
    </main>
  );
}

function NoAvailableTabs({ role }: { role: AuthSession["role"] }) {
  return (
    <div className="tab-blank" dir="rtl">
      <div className="app-no-tabs">
        <div>
          <h1>لا توجد تبويبات متاحة</h1>

          <p>
            لا توجد صفحات مفعلة لهذا الدور حالياً: <strong>{role}</strong>
          </p>
        </div>
      </div>
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
