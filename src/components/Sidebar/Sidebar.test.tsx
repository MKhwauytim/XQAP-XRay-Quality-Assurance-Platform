/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SidebarTabDefinition } from "./Tabs/tabTypes";
import type { AuthSession } from "../../auth/authTypes";
import { WorkspaceContext, emptyLoadedFiles } from "../../data/workspace/WorkspaceContext";
import { GlobalMonthContext } from "../../data/month/GlobalMonthContext";
import Sidebar from "./Sidebar";

// Nav 1b: the rail now carries the month/workspace context and the user footer,
// so it needs a session and a logout action.
const session: AuthSession = {
  role: "admin",
  username: "admin",
  loginAt: "2026-08-18T00:00:00.000Z",
};

const tabs: SidebarTabDefinition[] = [
  {
    id: "population",
    label: "معالجة البيانات",
    order: 10,
    allowedRoles: ["admin"],
    icon: <span aria-hidden="true">P</span>,
    TabComponent: () => null,
  },
  // `archive` sits in the "analysis" group, `population` in "workflow" — so the
  // grouped rail has something to actually group.
  {
    id: "archive",
    label: "إدارة الأرشيف",
    order: 30,
    allowedRoles: ["admin"],
    icon: <span aria-hidden="true">A</span>,
    TabComponent: () => null,
  },
];

afterEach(cleanup);

/**
 * Nav 1b's context card reads the workspace handle and the global month, so the
 * rail now needs both contexts. Provided as plain stub values rather than the
 * real providers: these are accessibility tests for the rail's structure, and
 * the real providers would drag in the File System Access API and a Query
 * client for no gain here.
 */
function withNavContexts(node: React.ReactNode) {
  return (
    <WorkspaceContext.Provider
      value={{
        directoryHandle: null,
        status: "idle",
        error: null,
        errorCode: null,
        loadedFiles: emptyLoadedFiles,
        isSupported: true,
        selectDirectory: vi.fn(),
        createStructure: vi.fn(),
        reloadFiles: vi.fn(),
        refreshPermissions: vi.fn(),
        disconnect: vi.fn(),
        startDemoWorkspace: vi.fn(),
      } as never}
    >
      <GlobalMonthContext.Provider
        value={{
          months: [],
          selection: { kind: "none" },
          isSelectedMonthClosed: false,
          setSelectedMonth: vi.fn(),
          startNewMonth: vi.fn(),
        } as never}
      >
        {node}
      </GlobalMonthContext.Provider>
    </WorkspaceContext.Provider>
  );
}

function renderSidebar(isMobileOpen: boolean) {
  const onTabSelect = vi.fn();
  const onMobileClose = vi.fn();
  render(
    withNavContexts(
    <Sidebar
      tabs={tabs}
      activeTabId="population"
      isCollapsed={false}
      isMobileOpen={isMobileOpen}
      session={session}
      onLogout={vi.fn()}
      onTabSelect={onTabSelect}
      onToggleCollapse={vi.fn()}
      onMobileClose={onMobileClose}
    />,
    ),
  );
  return { onTabSelect, onMobileClose };
}

describe("Sidebar accessibility", () => {
  it("is a named navigation landmark on desktop without adding a competing heading", () => {
    renderSidebar(false);
    expect(
      screen.getByRole("complementary", { name: "القائمة الجانبية" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "تبويبات النظام" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });

  it("becomes a modal dialog and closes with Escape on mobile", () => {
    const { onMobileClose } = renderSidebar(true);
    const dialog = screen.getByRole("dialog", { name: "القائمة الجانبية" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "إغلاق قائمة التنقل" }),
    );

    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onMobileClose).toHaveBeenCalledTimes(1);
  });

  it("selects a tab using its accessible name", () => {
    const { onTabSelect } = renderSidebar(false);
    const activeTab = screen.getByRole("button", { name: "معالجة البيانات" });
    expect(activeTab).toHaveAttribute("aria-current", "page");
    fireEvent.click(activeTab);
    expect(onTabSelect).toHaveBeenCalledWith("population");
  });
});

describe("Sidebar grouped rail (nav 1b)", () => {
  it("renders each tab under its catalog nav group, in group order", () => {
    renderSidebar(false);
    const headings = screen.getAllByText(/مسار العمل|التقارير والتحليل|إدارة النظام/);
    // Only the two groups that actually have a visible tab render a heading —
    // an empty group is omitted rather than left as a dangling label.
    expect(headings.map((node) => node.textContent)).toEqual([
      "مسار العمل",
      "التقارير والتحليل",
    ]);
  });

  it("carries the user identity and a logout action in its footer", () => {
    const onLogout = vi.fn();
    render(
      withNavContexts(
        <Sidebar
          tabs={tabs}
          activeTabId="population"
          isCollapsed={false}
          isMobileOpen={false}
          session={session}
          onLogout={onLogout}
          onTabSelect={vi.fn()}
          onToggleCollapse={vi.fn()}
          onMobileClose={vi.fn()}
        />,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "تسجيل الخروج" }));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it("shows a notification badge only when there is a real unacknowledged count", () => {
    const notificationTab: SidebarTabDefinition = {
      id: "ew/notifications",
      label: "مركز الإشعارات",
      order: 20,
      allowedRoles: ["admin"],
      icon: <span aria-hidden="true">N</span>,
      TabComponent: () => null,
    };
    const renderWith = (notificationCount?: number) =>
      render(
        withNavContexts(
          <Sidebar
            tabs={[notificationTab]}
            activeTabId="ew/notifications"
            isCollapsed={false}
            isMobileOpen={false}
            session={session}
            onLogout={vi.fn()}
            notificationCount={notificationCount}
            onTabSelect={vi.fn()}
            onToggleCollapse={vi.fn()}
            onMobileClose={vi.fn()}
          />,
        ),
      );

    renderWith(undefined);
    expect(screen.queryByText("3")).not.toBeInTheDocument();
    cleanup();

    renderWith(0);
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    cleanup();

    renderWith(3);
    expect(screen.getByText("3")).toBeInTheDocument();
  });
});
