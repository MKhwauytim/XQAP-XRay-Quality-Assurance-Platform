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
import { WorkspaceGate } from "./data/workspace/WorkspaceGate";

import "./App.css";
import "./data/workspace/WorkspaceGate.css";

type AppContentProps = {
  session: AuthSession;
};

function AppContent({ session }: AppContentProps) {
  const [selectedTabId, setSelectedTabId] = useState("");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [permissions, setPermissions] = useState<RolePermission[]>(
    () => readUserManagementState().permissions
  );

  useEffect(() => {
    return subscribeToUserManagementChanges(() => {
      setPermissions(readUserManagementState().permissions);
    });
  }, []);

  const allowedTabs = useMemo(
    () => {
      return SIDEBAR_TABS.filter(
        (tab) =>
          tab.allowedRoles.includes(session.role) &&
          hasRolePermission(permissions, session.role, tab.id, "view")
      );
    },
    [permissions, session.role]
  );

  const activeTab =
    allowedTabs.find((tab) => tab.id === selectedTabId) ?? allowedTabs[0];

  const activeTabId = activeTab?.id ?? "";
  const ActiveTabComponent = activeTab?.TabComponent;

  function toggleSidebar(): void {
    setIsSidebarCollapsed((current) => !current);
  }

  return (
    <main
      className={`app-shell ${isSidebarCollapsed ? "sidebar-collapsed" : ""}`}
      dir="rtl"
    >
      <Sidebar
        tabs={allowedTabs}
        activeTabId={activeTabId}
        isCollapsed={isSidebarCollapsed}
        onTabSelect={setSelectedTabId}
        onToggleCollapse={toggleSidebar}
      />

      <section className="app-workspace" aria-label="مساحة العمل">
        {ActiveTabComponent ? (
          <ActiveTabComponent />
        ) : (
          <NoAvailableTabs role={session.role} />
        )}
      </section>
    </main>
  );
}

function NoAvailableTabs({ role }: { role: AuthSession["role"] }) {
  return (
    <div className="tab-blank" dir="rtl">
      <div
        style={{
          minHeight: "calc(100vh - 44px)",
          display: "grid",
          placeItems: "center",
          padding: "24px",
          color: "#475467",
          textAlign: "center"
        }}
      >
        <div>
          <h1
            style={{
              margin: "0 0 10px",
              color: "#17365d",
              fontSize: "24px"
            }}
          >
            لا توجد تبويبات متاحة
          </h1>

          <p style={{ margin: 0, lineHeight: 1.8 }}>
            لا توجد صفحات مفعلة لهذا الدور حالياً: <strong>{role}</strong>
          </p>
        </div>
      </div>
    </div>
  );
}

function App() {
  return (
    <AuthGate>
      {(session) => (
        <WorkspaceGate session={session}>
          <AppContent session={session} />
        </WorkspaceGate>
      )}
    </AuthGate>
  );
}

export default App;
