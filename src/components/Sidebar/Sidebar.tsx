import { useEffect, useState, type SyntheticEvent } from "react";
import { ChevronDown, PanelRightClose, X } from "lucide-react";
import type { SidebarTabDefinition } from "./Tabs/tabTypes";
import { useLabels } from "../../data/labels/useLabels";
import { ZATCA_LOGO_URL } from "../../branding/organization";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import "./Sidebar.css";

// If the external ZATCA SVG can't load (offline), hide the mark and let the
// text wordmark stand on its own — never a broken-image icon.
function hideBrokenLogo(event: SyntheticEvent<HTMLImageElement>): void {
  event.currentTarget.style.display = "none";
}

type SidebarProps = {
  tabs: SidebarTabDefinition[];
  activeTabId: string;
  isCollapsed: boolean;
  isMobileOpen: boolean;
  onTabSelect: (tabId: string) => void;
  onToggleCollapse: () => void;
  onMobileClose: () => void;
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
  isCollapsed,
  isMobileOpen,
  onTabSelect,
  onToggleCollapse,
  onMobileClose
}: SidebarProps) {
  const L = useLabels();
  const [activeSubTabId, setActiveSubTabId] = useState<string>("process");
  const mobileFocusTrapRef = useFocusTrap<HTMLElement>({
    enabled: isMobileOpen,
    onEscape: onMobileClose,
  });

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
      id="app-sidebar"
      ref={mobileFocusTrapRef}
      className={`sidebar ${isCollapsed ? "collapsed" : ""}${isMobileOpen ? " mobile-open" : ""}`}
      aria-label="القائمة الجانبية"
      role={isMobileOpen ? "dialog" : undefined}
      aria-modal={isMobileOpen ? true : undefined}
    >
      <div className="sidebar-header">
        <img
          className="sidebar-logo"
          src={ZATCA_LOGO_URL}
          alt="هيئة الزكاة والضريبة والجمارك"
          onError={hideBrokenLogo}
        />
        <div className="sidebar-title-wrap">
          <span className="sidebar-kicker">نظام جودة الأشعة</span>
          <p className="sidebar-title">{L.sidebar_title}</p>
          <p className="sidebar-subtitle">{L.sidebar_subtitle}</p>
        </div>

        <button
          type="button"
          className="sidebar-mobile-close"
          onClick={onMobileClose}
          aria-label="إغلاق قائمة التنقل"
        >
          <X size={20} aria-hidden />
        </button>
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
          // Sub-tab visibility is decided solely by the permission matrix, applied
          // upstream in App.tsx (`allowedSubTabs`). No second hardcoded role filter
          // here — that produced dead matrix cells (P1).
          const visibleSubTabs = tab.subTabs ?? [];
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
                aria-current={isActive ? "page" : undefined}
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
