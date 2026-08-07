/* @vitest-environment jsdom */
// App-level boot-progress wiring: AppContent clears the post-login data-source
// checklist (bootProgress.ts) once per boot session -- a fresh login or a
// workspace switch -- and BootSplashOverlay renders whatever the landing tab
// then registers from its own mount effect.
//
// The ordering here is the whole point and is easy to break silently: the
// landing tab registers its sources from a CHILD's useEffect, so AppContent's
// reset must run in an EARLIER phase (useLayoutEffect) or it would wipe the
// registration a moment after the child made it. These tests pin that ordering
// down from the outside -- via what the user actually sees (the checklist) --
// rather than by reaching into the store's internals.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { AuthRole, AuthSession } from "./auth/authTypes";
import {
  markBootSourceLoading,
  registerBootSources,
  resetBootProgress,
} from "./data/workspace/bootProgress";

// Mutable indirection so the mocked tab component (defined inside a hoisted
// vi.mock factory, which cannot close over test-file locals) can call back into
// whatever this file wants it to do on mount.
const landingTab = vi.hoisted(() => ({ onMount: () => {} }));

vi.mock("./components/Sidebar/Tabs/tabRegistry", async () => {
  const { useEffect: useMountEffect } = await import("react");
  function LandingTab() {
    useMountEffect(() => {
      landingTab.onMount();
    }, []);
    return null;
  }
  return {
    SIDEBAR_TABS: [
      {
        id: "population",
        label: "إدارة بيانات الأشعة",
        order: 10,
        allowedRoles: ["employee", "supervisor", "manager", "admin", "guest"],
        TabComponent: LandingTab,
        subTabs: [],
      },
    ],
  };
});

vi.mock("./components/Sidebar/Sidebar", () => ({ default: () => <nav /> }));
vi.mock("./components/FeedbackWidget/FeedbackWidget", () => ({ FeedbackWidget: () => null }));
vi.mock("./components/NotificationBanner/NotificationBanner", () => ({ NotificationBanner: () => null }));

vi.mock("./auth/userManagement", () => ({
  hasRolePermission: () => true,
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

const SOURCE = { key: "population_summary", labelEn: "processing.summary.json", labelAr: "ملخص المعالجة" };

function makeSession(role: AuthRole, loginAt: string): AuthSession {
  return { username: "test-user", role, loginAt };
}

// AppContent now reads useQueryClient() (rework W5's app-wide TanStack Query
// cache + refresh bridge), which needs a QueryClientProvider ancestor. Tests
// that `rerender` must reuse the SAME QueryClient/wrapper across renders --
// rerendering `<AppContent .../>` bare would swap out the provider itself,
// unmounting it rather than just updating the session prop.
function wrapAppContent(session: AuthSession, client: QueryClient) {
  return (
    <QueryClientProvider client={client}>
      <AppContent session={session} />
    </QueryClientProvider>
  );
}

// Render-purity guard for EVERY test below. resetBootProgress() -> notify()
// synchronously setStates BootSplashOverlay -- a different, already-mounted
// component -- so performing it during AppContent's own render trips React's
// "Cannot update a component while rendering a different component" warning.
// React dedupes that warning per rendering component for the lifetime of the
// module, so it has to be watched across the whole file rather than asserted
// inside one test: whichever test triggers it first is the one that fails.
let consoleErrors: string[] = [];

beforeEach(() => {
  consoleErrors = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    consoleErrors.push(String(args[0] ?? ""));
  });
});

afterEach(() => {
  const renderPurityWarnings = consoleErrors.filter((message) =>
    message.includes("while rendering a different component"),
  );
  cleanup();
  resetBootProgress();
  landingTab.onMount = () => {};
  vi.restoreAllMocks();
  expect(renderPurityWarnings).toEqual([]);
});

describe("AppContent boot-progress reset ordering", () => {
  test("a landing tab's mount-effect registration survives the per-boot-session reset", () => {
    landingTab.onMount = () => {
      registerBootSources([SOURCE]);
      markBootSourceLoading(SOURCE.key);
    };

    render(wrapAppContent(makeSession("manager", "2026-08-04T10:00:00.000Z"), new QueryClient()));

    // If the reset ran in a plain useEffect it would fire AFTER this child's
    // own mount effect (React runs child effects before parent effects) and
    // wipe the registration -- leaving an empty store, a vacuously-true
    // allLoaded, and no checklist at all.
    expect(screen.getByTestId("boot-splash-overlay")).toBeInTheDocument();
    expect(screen.getByText(SOURCE.labelEn)).toBeInTheDocument();
  });

  test("a fresh boot session (new login identity) clears the previous session's checklist", () => {
    landingTab.onMount = () => {
      registerBootSources([SOURCE]);
      markBootSourceLoading(SOURCE.key);
    };

    const client = new QueryClient();
    const { rerender } = render(
      wrapAppContent(makeSession("manager", "2026-08-04T10:00:00.000Z"), client),
    );
    expect(screen.getByTestId("boot-splash-overlay")).toBeInTheDocument();

    // Same tab stays mounted (so it never re-registers); only the session
    // identity changes. The previous session's still-"loading" source must not
    // survive into the new one.
    rerender(wrapAppContent(makeSession("manager", "2026-08-04T11:30:00.000Z"), client));

    expect(screen.queryByTestId("boot-splash-overlay")).not.toBeInTheDocument();
  });

  test("re-registering after the reset re-shows the checklist for the new session", () => {
    // The same tab remounting (or any later tab registering its own sources)
    // after a session change must still be able to populate the fresh
    // checklist -- i.e. the reset clears the store, it does not disable it.
    landingTab.onMount = () => {
      registerBootSources([SOURCE]);
      markBootSourceLoading(SOURCE.key);
    };

    const client = new QueryClient();
    const { rerender } = render(
      wrapAppContent(makeSession("manager", "2026-08-04T10:00:00.000Z"), client),
    );
    rerender(wrapAppContent(makeSession("manager", "2026-08-04T11:30:00.000Z"), client));
    expect(screen.queryByTestId("boot-splash-overlay")).not.toBeInTheDocument();

    act(() => {
      registerBootSources([SOURCE]);
      markBootSourceLoading(SOURCE.key);
    });

    expect(screen.getByTestId("boot-splash-overlay")).toBeInTheDocument();
  });
});
