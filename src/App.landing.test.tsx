/* @vitest-environment jsdom */
// App landing-tab characterization (Large-Population Performance Proposal, Phase A).
// A2 in App.tsx already made `employee` land on `employee-workspace` instead of
// whichever tab sorts first (avoiding the reported startup freeze from an employee
// unintentionally opening Population) -- but per the 2026-08-01 architect review,
// that behavior had ZERO test coverage anywhere in the repo. This pins it down before
// any further demand-gating work touches Population's own loading, so a future
// regression here fails loudly instead of silently reopening the freeze for employees.
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { AuthRole } from "./auth/authTypes";
import type { AuthSession } from "./auth/authTypes";

// Pre-sorted by `order`, mirroring the real tabRegistry.ts contract (it sorts
// SIDEBAR_TABS by `order` at import time -- App.tsx's `allowedTabs[0]` relies on
// that sort already having happened, not on doing its own sorting).
vi.mock("./components/Sidebar/Tabs/tabRegistry", () => ({
  SIDEBAR_TABS: [
    {
      id: "population",
      label: "إدارة بيانات الأشعة",
      order: 10,
      allowedRoles: ["employee", "supervisor", "manager", "admin", "guest"] as AuthRole[],
      TabComponent: () => <div>POP-TAB-CONTENT</div>,
      subTabs: [],
    },
    {
      id: "employee-workspace",
      label: "مساحة عمل الموظف",
      order: 15,
      allowedRoles: ["employee", "supervisor", "manager", "admin", "guest"] as AuthRole[],
      TabComponent: () => <div>EW-TAB-CONTENT</div>,
      subTabs: [],
    },
    {
      id: "reports",
      label: "التقارير",
      order: 25,
      allowedRoles: ["supervisor", "manager", "admin", "guest"] as AuthRole[],
      TabComponent: () => <div>REPORTS-TAB-CONTENT</div>,
      subTabs: [],
    },
  ],
}));

vi.mock("./components/Sidebar/Sidebar", () => ({
  default: ({ tabs, activeTabId }: { tabs: { id: string }[]; activeTabId: string }) => (
    <nav>
      {tabs.map((tab) => (
        <span key={tab.id} data-testid={`nav-${tab.id}`} data-active={tab.id === activeTabId} />
      ))}
    </nav>
  ),
}));

vi.mock("./components/FeedbackWidget/FeedbackWidget", () => ({ FeedbackWidget: () => null }));
vi.mock("./components/NotificationBanner/NotificationBanner", () => ({ NotificationBanner: () => null }));

vi.mock("./auth/userManagement", () => ({
  hasRolePermission: vi.fn(() => true),
  readUserManagementState: () => ({ permissions: [] }),
  roleCeilingFor: () => undefined,
  subscribeToUserManagementChanges: () => () => {},
}));

vi.mock("./data/workspace/useWorkspace", () => ({
  useWorkspace: () => ({ directoryHandle: null, status: "not_selected" }),
}));

vi.mock("./data/population/populationStorage", () => ({
  listMonthFolders: async () => [],
}));

vi.mock("./data/backup/backupStorage", () => ({
  createDailyAdminBackupIfDue: async () => ({ ok: true, skipped: true }),
}));

import { AppContent } from "./App";
import { hasRolePermission } from "./auth/userManagement";

function makeSession(role: AuthRole): AuthSession {
  return {
    username: "test-user",
    role,
    loginAt: new Date().toISOString(),
  };
}

// AppContent reads useQueryClient() (rework W5) -- needs a QueryClientProvider
// ancestor, which the real app root normally supplies via main.tsx.
function renderAppContent(session: AuthSession) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <AppContent session={session} />
    </QueryClientProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.mocked(hasRolePermission).mockReturnValue(true);
});

describe("App landing tab (A2) + initial tab-mount LRU", () => {
  test("employee lands on employee-workspace, never mounting Population on first render", () => {
    renderAppContent(makeSession("employee"));

    expect(screen.getByText("EW-TAB-CONTENT")).toBeInTheDocument();
    expect(screen.queryByText("POP-TAB-CONTENT")).not.toBeInTheDocument();
    expect(screen.getByTestId("nav-employee-workspace").dataset.active).toBe("true");
  });

  test.each<AuthRole>(["guest", "supervisor", "manager", "admin"])(
    "%s lands on the first allowed tab (population, order 10) unaffected by A2",
    (role) => {
      renderAppContent(makeSession(role));

      expect(screen.getByText("POP-TAB-CONTENT")).toBeInTheDocument();
      expect(screen.queryByText("EW-TAB-CONTENT")).not.toBeInTheDocument();
      expect(screen.getByTestId("nav-population").dataset.active).toBe("true");
    },
  );

  test("employee falls back to the first allowed tab when employee-workspace is permission-denied (A2's ?? allowedTabs[0] branch)", () => {
    vi.mocked(hasRolePermission).mockImplementation((_permissions, _role, tabId) => tabId !== "employee-workspace");

    renderAppContent(makeSession("employee"));

    expect(screen.getByText("POP-TAB-CONTENT")).toBeInTheDocument();
    expect(screen.queryByText("EW-TAB-CONTENT")).not.toBeInTheDocument();
    expect(screen.getByTestId("nav-population").dataset.active).toBe("true");
  });
});
