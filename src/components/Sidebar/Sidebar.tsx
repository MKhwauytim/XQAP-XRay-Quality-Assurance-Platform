import { useEffect, useMemo, useState, type SyntheticEvent } from "react";
import { ChevronDown, FolderOpen, LogOut, PanelRightClose, X } from "lucide-react";
import type { SidebarTabDefinition } from "./Tabs/tabTypes";
import type { AuthRole, AuthSession } from "../../auth/authTypes";
import { getManagedLoginUsers } from "../../auth/userManagement";
import { navGroupFor, TAB_NAV_GROUP_ORDER, type TabNavGroup } from "../../auth/tabCatalog";
import { setSubTabSelection } from "../../app/subTabSelection";
import { GlobalMonthSelector } from "../GlobalMonthSelector/GlobalMonthSelector";
import { useWorkspace } from "../../data/workspace/useWorkspace";
import { useLabels, type Labels } from "../../data/labels/useLabels";
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
  /**
   * Nav 1b moved the month/workspace context and the user identity out of the
   * crowded top toolbar and into the rail, so the sidebar now needs the session
   * and the logout action the toolbar used to own.
   */
  session: AuthSession;
  onLogout: () => void;
  /**
   * Count for the notification tab's badge — notifications this user has not yet
   * acknowledged. Undefined (or 0) renders no badge at all; the rail never shows
   * a placeholder number. Threaded from App.tsx, which already owns the single
   * notification poll, so the badge costs no extra workspace read.
   */
  notificationCount?: number;
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

function groupHeading(labels: Labels, group: TabNavGroup): string {
  switch (group) {
    case "workflow":
      return labels.sidebar_group_workflow;
    case "analysis":
      return labels.sidebar_group_analysis;
    default:
      return labels.sidebar_group_system;
  }
}

function roleLabel(labels: Labels, role: AuthRole): string {
  const map: Record<AuthRole, string> = {
    admin: labels.toolbar_role_admin,
    manager: labels.toolbar_role_manager,
    supervisor: labels.toolbar_role_supervisor,
    employee: labels.toolbar_role_employee,
    guest: labels.toolbar_role_guest,
  };
  return map[role] ?? labels.toolbar_role_employee;
}

/**
 * Two-character monogram for the footer avatar. Arabic has no casing, so this is
 * a plain first-two-characters-of-the-first-word slice rather than an initials
 * algorithm — anything cleverer misreads Arabic names more often than it helps.
 */
function avatarMonogram(name: string): string {
  return name.trim().slice(0, 2) || "—";
}

/**
 * Month + workspace context card (nav 1b). The month control itself is the
 * shared `GlobalMonthSelector` in its `sidebar` variant — the same component the
 * toolbar used to render, not a second implementation — so month selection,
 * creation and the closed-month state stay in one place.
 */
function SidebarContextCard({ isDemo }: { isDemo: boolean }) {
  const labels = useLabels();
  const { directoryHandle } = useWorkspace();
  const workspaceName = directoryHandle?.name ?? null;

  return (
    <div className="sidebar-context-card">
      <GlobalMonthSelector allowCreate={!isDemo} variant="sidebar" />
      <div className="sidebar-context-workspace">
        <FolderOpen size={13} strokeWidth={1.8} aria-hidden />
        <span
          className="sidebar-context-workspace-name"
          title={
            workspaceName
              ? labels.toolbar_workspace_title.replace("{name}", workspaceName)
              : labels.sidebar_no_workspace
          }
        >
          {workspaceName ?? labels.sidebar_no_workspace}
        </span>
      </div>
    </div>
  );
}

export default function Sidebar({
  tabs,
  activeTabId,
  isCollapsed,
  isMobileOpen,
  session,
  onLogout,
  notificationCount,
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
    // Record the selection BEFORE announcing it. `onTabSelect` above only
    // schedules the parent tab's mount (a setState, applied on the next
    // commit), so the two events below are dispatched while the owning tab may
    // still be unmounted — a lazy tab's first visit is exactly that — and a
    // listener that does not exist yet cannot hear them. The store is what the
    // tab reads as it mounts, so the click is honoured either way; see
    // src/app/subTabSelection.ts.
    setSubTabSelection(parentTabId, subTabId);
    // Legacy Population-specific event (keep for backward compat)
    window.dispatchEvent(new CustomEvent("pop-set-subtab", { detail: { subTabId } }));
    // Generic event — all tab components can listen for their own parent
    window.dispatchEvent(new CustomEvent("sidebar-subtab-changed", { detail: { parentTabId, subTabId } }));
  }

  function renderTab(tab: SidebarTabDefinition) {
    const isActive = activeTabId === tab.id;
    // Sub-tab visibility is decided solely by the permission matrix, applied
    // upstream in App.tsx (`allowedSubTabs`). No second hardcoded role filter
    // here — that produced dead matrix cells (P1).
    const visibleSubTabs = tab.subTabs ?? [];
    const hasChildren = visibleSubTabs.length > 0;
    // A badge only ever renders from a real, non-zero count. There is
    // deliberately no placeholder: a number nobody computed is worse than no
    // number at all.
    const badgeCount = tab.id === "ew/notifications" ? notificationCount ?? 0 : 0;

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
          {badgeCount > 0 && !isCollapsed && (
            <span
              className="sidebar-nav-badge is-alert"
              aria-label={L.sidebar_notifications_badge_aria.replace("{count}", String(badgeCount))}
            >
              {badgeCount.toLocaleString("ar-SA-u-nu-latn")}
            </span>
          )}
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
  }

  // Nav 1b groups the same tab set by workflow stage. Order WITHIN a group stays
  // each tab's own `tabConfig.order` (SIDEBAR_TABS is already sorted), so a tab's
  // position is still owned by the tab, not by this file.
  const groupedTabs = TAB_NAV_GROUP_ORDER.map((group) => ({
    group,
    groupTabs: tabs.filter((tab) => navGroupFor(tab.id) === group),
  })).filter(({ groupTabs }) => groupTabs.length > 0);

  // Same lookup AdminToolbar used when it owned the user chip: the session
  // carries only the username, the human-readable name lives in the managed
  // user list.
  const displayName = useMemo(() => {
    const match = getManagedLoginUsers().find((user) => user.username === session.username);
    return match?.displayName || session.username;
  }, [session.username]);

  return (
    <aside
      id="app-sidebar"
      ref={mobileFocusTrapRef}
      className={`sidebar ${isCollapsed ? "collapsed" : ""}${isMobileOpen ? " mobile-open" : ""}`}
      aria-label={L.sidebar_aria_label}
      role={isMobileOpen ? "dialog" : undefined}
      aria-modal={isMobileOpen ? true : undefined}
    >
      <div className="sidebar-header">
        <div className="sidebar-header-top">
          <img
            className="sidebar-logo"
            src={ZATCA_LOGO_URL}
            alt={L.sidebar_logo_alt}
            onError={hideBrokenLogo}
          />
          <button
            type="button"
            className="sidebar-mobile-close"
            onClick={onMobileClose}
            aria-label={L.sidebar_mobile_close_aria}
          >
            <X size={20} aria-hidden />
          </button>
          <button
            type="button"
            className="sidebar-collapse-button"
            onClick={onToggleCollapse}
            aria-label={isCollapsed ? L.sidebar_expand_label : L.sidebar_collapse_label}
            title={isCollapsed ? L.sidebar_expand_label : L.sidebar_collapse_label}
          >
            <CollapseIcon isCollapsed={isCollapsed} />
          </button>
        </div>
        <div className="sidebar-title-wrap">
          <span className="sidebar-kicker">{L.sidebar_kicker}</span>
          <p className="sidebar-title">{L.sidebar_title}</p>
        </div>
      </div>

      {!isCollapsed && <SidebarContextCard isDemo={session.mode === "demo"} />}

      <nav className="sidebar-nav" aria-label={L.sidebar_nav_aria}>
        {groupedTabs.map(({ group, groupTabs }) => (
          <div key={group} className="sidebar-nav-section">
            {!isCollapsed && (
              <div className="sidebar-nav-heading">
                <span>{groupHeading(L, group)}</span>
                <span className="sidebar-nav-heading-rule" aria-hidden />
              </div>
            )}
            {groupTabs.map(renderTab)}
          </div>
        ))}
      </nav>

      {!isCollapsed && (
        <div className="sidebar-footer">
          <span className="sidebar-footer-avatar" aria-hidden>
            {avatarMonogram(displayName)}
          </span>
          <span className="sidebar-footer-identity">
            <strong className="sidebar-footer-name" title={displayName}>{displayName}</strong>
            <span className="sidebar-footer-role">{roleLabel(L, session.role)}</span>
          </span>
          <button
            type="button"
            className="sidebar-footer-logout"
            onClick={onLogout}
            aria-label={L.sidebar_logout_aria}
            title={L.sidebar_logout_aria}
          >
            <LogOut size={15} strokeWidth={2} aria-hidden />
          </button>
        </div>
      )}
    </aside>
  );
}
