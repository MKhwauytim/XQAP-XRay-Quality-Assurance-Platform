/* @vitest-environment jsdom */
// Audit finding 14: a sub-tab granted page-level "view" access, but with none of
// its required feature grants enabled, used to still get a clickable sidebar
// link -- one whose content always rendered AccessDenied (EmployeeWorkspaceTab's
// canViewXrayReferrals/canViewReferralApproval combine canAccessTab with a
// feature check the sidebar filter never applied). App.tsx's `allowedTabs` filter
// now also runs `hasRequiredSubTabFeature` (SUB_TAB_FEATURE_MAP, shared with
// EmployeeWorkspaceTab), so the two structurally cannot drift apart again.
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { AuthRole, AuthSession } from "./auth/authTypes";
import type { FeaturePermission } from "./auth/userManagement";

vi.mock("./components/Sidebar/Tabs/tabRegistry", () => ({
  SIDEBAR_TABS: [
    {
      id: "employee-workspace",
      label: "مساحة عمل الموظف",
      order: 15,
      allowedRoles: ["employee", "supervisor", "manager", "admin", "guest"] as AuthRole[],
      TabComponent: () => <div>EW-TAB-CONTENT</div>,
      subTabs: [
        { id: "xray-referrals", label: "صور الأشعة المحالة" },
        { id: "xray-results", label: "نتائج فحص الأشعة" },
      ],
    },
    {
      id: "population",
      label: "إدارة بيانات الأشعة",
      order: 10,
      allowedRoles: ["employee", "supervisor", "manager", "admin", "guest"] as AuthRole[],
      TabComponent: () => <div>POP-TAB-CONTENT</div>,
      subTabs: [
        { id: "browse", label: "استعراض البيانات" },
        // Moved under Population 2026-08-21; the filter builds "population/adhoc-import"
        // from the parent id, which is the id SUB_TAB_FEATURE_MAP is keyed on.
        { id: "adhoc-import", label: "استيراد بيانات مخصص" },
      ],
    },
  ],
}));

vi.mock("./components/Sidebar/Sidebar", () => ({
  default: ({ tabs }: { tabs: { id: string; subTabs?: { id: string }[] }[] }) => (
    <nav>
      {tabs.flatMap((tab) => [
        <span key={tab.id} data-testid={`nav-${tab.id}`} />,
        ...(tab.subTabs ?? []).map((sub) => (
          <span key={`${tab.id}/${sub.id}`} data-testid={`nav-${tab.id}/${sub.id}`} />
        )),
      ])}
    </nav>
  ),
}));

vi.mock("./components/FeedbackWidget/FeedbackWidget", () => ({ FeedbackWidget: () => null }));
vi.mock("./components/NotificationBanner/NotificationBanner", () => ({ NotificationBanner: () => null }));

const userManagementMock = vi.hoisted(() => ({
  featurePermissions: [] as FeaturePermission[],
}));

vi.mock("./auth/userManagement", () => ({
  hasRolePermission: () => true, // page-level "view" is granted for every sub-tab in this test.
  readUserManagementState: () => ({ permissions: [], featurePermissions: userManagementMock.featurePermissions }),
  roleCeilingFor: () => undefined,
  subscribeToUserManagementChanges: () => () => {},
  hasFeature: (featurePermissions: FeaturePermission[], role: AuthRole, featureId: string) =>
    role === "admin" ||
    (featurePermissions.find((f) => f.role === role && f.featureId === featureId)?.enabled ?? false),
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

function makeSession(role: AuthRole): AuthSession {
  return { username: "test-user", role, loginAt: new Date().toISOString() };
}

function renderAppContent(session: AuthSession) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <AppContent session={session} />
    </QueryClientProvider>
  );
}

afterEach(() => {
  cleanup();
  userManagementMock.featurePermissions = [];
});

describe("App sidebar sub-tab filter (audit finding 14)", () => {
  test("hides ew/xray-referrals when page view is granted but none of its required features are", () => {
    userManagementMock.featurePermissions = []; // no feature grants at all
    renderAppContent(makeSession("employee"));

    // The sub-tab with no extra feature requirement (ew/xray-results) still shows.
    expect(screen.getByTestId("nav-employee-workspace/xray-results")).toBeInTheDocument();
    // The sub-tab whose content needs one of several features stays hidden --
    // before this fix it would render as a dead link here.
    expect(screen.queryByTestId("nav-employee-workspace/xray-referrals")).not.toBeInTheDocument();
  });

  test("hides population/adhoc-import from a role holding the page but neither ad-hoc feature", () => {
    userManagementMock.featurePermissions = [];
    renderAppContent(makeSession("manager"));

    // The sibling sub-tab with no feature requirement is unaffected.
    expect(screen.getByTestId("nav-population/browse")).toBeInTheDocument();
    expect(screen.queryByTestId("nav-population/adhoc-import")).not.toBeInTheDocument();
  });

  test("shows population/adhoc-import for admin with no stored feature grants at all", () => {
    userManagementMock.featurePermissions = [];
    renderAppContent(makeSession("admin"));

    expect(screen.getByTestId("nav-population/adhoc-import")).toBeInTheDocument();
  });

  test("shows ew/xray-referrals once at least one of its required features is granted", () => {
    userManagementMock.featurePermissions = [
      { role: "employee", featureId: "submit-answers", enabled: true },
    ];
    renderAppContent(makeSession("employee"));

    expect(screen.getByTestId("nav-employee-workspace/xray-referrals")).toBeInTheDocument();
  });
});
