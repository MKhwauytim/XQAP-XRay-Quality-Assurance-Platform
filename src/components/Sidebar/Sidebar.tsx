import { useEffect, useState } from "react";
import type { AuthRole } from "../../auth/authTypes";
import type { SidebarTabDefinition } from "./Tabs/tabTypes";
import { useLabels } from "../../data/labels/useLabels";
import "./Sidebar.css";

type SidebarProps = {
  tabs: SidebarTabDefinition[];
  activeTabId: string;
  role: AuthRole;
  isCollapsed: boolean;
  onTabSelect: (tabId: string) => void;
  onToggleCollapse: () => void;
};

function CollapseIcon({ isCollapsed }: { isCollapsed: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={`sidebar-collapse-icon ${isCollapsed ? "collapsed" : ""}`}
    >
      <path d="M15.7 5.3a1 1 0 0 1 0 1.4L10.4 12l5.3 5.3a1 1 0 1 1-1.4 1.4l-6-6a1 1 0 0 1 0-1.4l6-6a1 1 0 0 1 1.4 0Z" />
    </svg>
  );
}

export default function Sidebar({
  tabs,
  activeTabId,
  role,
  isCollapsed,
  onTabSelect,
  onToggleCollapse
}: SidebarProps) {
  const L = useLabels();
  const [activeSubTabId, setActiveSubTabId] = useState<string>("process");

  // Keep in sync with what the Population component reports
  useEffect(() => {
    const handler = (e: CustomEvent<string>) => {
      setActiveSubTabId(e.detail);
    };
    window.addEventListener("pop-subtab-changed", handler as EventListener);
    return () => window.removeEventListener("pop-subtab-changed", handler as EventListener);
  }, []);

  function handleSubTabClick(parentTabId: string, subTabId: string) {
    onTabSelect(parentTabId);
    setActiveSubTabId(subTabId);
    window.dispatchEvent(
      new CustomEvent("pop-set-subtab", { detail: { subTabId } })
    );
  }

  return (
    <aside
      className={`sidebar ${isCollapsed ? "collapsed" : ""}`}
      aria-label="القائمة الجانبية"
    >
      <div className="sidebar-header">
        <div className="sidebar-title-wrap">
          <span className="sidebar-kicker">نظام جودة الأشعة</span>
          <h2 className="sidebar-title">{L.sidebar_title}</h2>
          <p className="sidebar-subtitle">{L.sidebar_subtitle}</p>
        </div>

        <button
          type="button"
          className="sidebar-collapse-button"
          onClick={onToggleCollapse}
          aria-label={isCollapsed ? "توسيع القائمة" : "طي القائمة"}
          title={isCollapsed ? "توسيع القائمة" : "طي القائمة"}
        >
          <CollapseIcon isCollapsed={isCollapsed} />
        </button>
      </div>

      <nav className="sidebar-nav" aria-label="تبويبات النظام">
        {!isCollapsed && <div className="sidebar-nav-heading">إدارة النظام</div>}
        {tabs.map((tab) => {
          const isActive = activeTabId === tab.id;
          const visibleSubTabs = (tab.subTabs ?? []).filter(
            (sub) => !sub.allowedRoles || sub.allowedRoles.includes(role)
          );
          const hasChildren = visibleSubTabs.length > 0;

          return (
            <div key={tab.id} className="sidebar-nav-group">
              {/* Parent tab button */}
              <button
                type="button"
                className={`sidebar-nav-item${isActive ? " active" : ""}${hasChildren ? " has-children" : ""}`}
                onClick={() => {
                  if (hasChildren && !isActive) {
                    // Switching to a new tab with subtabs → auto-select first subtab
                    handleSubTabClick(tab.id, visibleSubTabs[0]!.id);
                  } else {
                    onTabSelect(tab.id);
                  }
                }}
                title={isCollapsed ? tab.label : undefined}
                aria-label={tab.label}
                aria-expanded={hasChildren ? isActive : undefined}
              >
                <span className="sidebar-nav-icon">{tab.icon}</span>
                <span className="sidebar-nav-label">{tab.label}</span>
                {hasChildren && !isCollapsed && (
                  <svg
                    className={`sidebar-chevron${isActive ? " open" : ""}`}
                    width="12" height="12" viewBox="0 0 24 24"
                    fill="none" stroke="currentColor" strokeWidth="2.5"
                    strokeLinecap="round" strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                )}
              </button>

              {/* Sub-tabs — shown when parent is active and not collapsed */}
              {hasChildren && isActive && !isCollapsed && (
                <div className="sidebar-subtab-list" role="group">
                  {visibleSubTabs.map((sub) => (
                    <button
                      key={sub.id}
                      type="button"
                      className={`sidebar-subtab-item${activeSubTabId === sub.id ? " active" : ""}`}
                      onClick={() => handleSubTabClick(tab.id, sub.id)}
                      aria-current={activeSubTabId === sub.id ? "page" : undefined}
                    >
                      <span className="sidebar-subtab-dot" aria-hidden="true" />
                      {sub.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
