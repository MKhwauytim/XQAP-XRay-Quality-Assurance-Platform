import { useEffect, useState } from "react";
import { ChevronDown, PanelRightClose } from "lucide-react";
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
    <PanelRightClose
      aria-hidden
      className={`sidebar-collapse-icon ${isCollapsed ? "collapsed" : ""}`}
      strokeWidth={1.8}
    />
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
    // Legacy Population-specific event (keep for backward compat)
    window.dispatchEvent(new CustomEvent("pop-set-subtab", { detail: { subTabId } }));
    // Generic event — all tab components can listen for their own parent
    window.dispatchEvent(new CustomEvent("sidebar-subtab-changed", { detail: { parentTabId, subTabId } }));
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
                  <ChevronDown
                    className={`sidebar-chevron${isActive ? " open" : ""}`}
                    size={14}
                    strokeWidth={1.9}
                    aria-hidden
                  />
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
