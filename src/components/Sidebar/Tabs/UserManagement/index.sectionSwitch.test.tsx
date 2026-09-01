/* @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, waitFor, cleanup, act, screen, fireEvent } from "@testing-library/react";
import UserManagementTab from "./index";
import * as authSession from "../../../../auth/authSession";
import * as usePermissionsModule from "../../../../auth/usePermissions";
import * as authActivityLog from "../../../../auth/authActivityLog";
import * as actionLog from "../../../../data/audit/actionLog";
import * as useWorkspaceModule from "../../../../data/workspace/useWorkspace";
import {
  __resetSubTabSelectionsForTests,
  setSubTabSelection,
} from "../../../../app/subTabSelection";
import { createMemoryDirectory } from "../../../../data/storage/memoryDirectory";
import type { DirectoryHandleLike } from "../../../../data/storage/fileSystemAccess";

vi.mock("../../../../auth/authSession", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../auth/authSession")>()),
  readSession: vi.fn(),
}));

function mockSession() {
  vi.spyOn(authSession, "readSession").mockReturnValue({
    role: "admin",
    username: "admin",
    loginAt: new Date().toISOString(),
  });
  vi.spyOn(usePermissionsModule, "usePermissions").mockReturnValue({
    canMutate: () => true,
    can: () => true,
    canAccessTab: () => true,
    username: "admin",
    role: "admin",
  } as unknown as ReturnType<typeof usePermissionsModule.usePermissions>);
}

function mockWorkspace(handle: DirectoryHandleLike | null) {
  vi.spyOn(useWorkspaceModule, "useWorkspace").mockReturnValue({
    directoryHandle: handle,
  } as unknown as ReturnType<typeof useWorkspaceModule.useWorkspace>);
}

function switchSection(subTabId: string) {
  act(() => {
    window.dispatchEvent(
      new CustomEvent("pop-set-subtab", { detail: { subTabId } })
    );
  });
}

/**
 * "activity" and "actions" used to be two separate rail-routed sub-tabs; they
 * are now one merged "activity" sub-tab with an inner view toggle (see
 * TabView.tsx). This drives that toggle the way a user would -- clicking the
 * button -- rather than the rail's `pop-set-subtab` event, which no longer
 * carries an "actions" id at all.
 */
function clickAuditToggle(label: string) {
  fireEvent.click(screen.getByRole("button", { name: label }));
}

// UserManagementTab's default export is now `lazy(() => import("./TabView"))`
// (N2 tab-level code splitting) -- the first render always suspends (no
// Suspense ancestor here, mirroring ReportDesigner/TemplateBuilder's own
// isolated component tests), so its "pop-set-subtab" listener isn't attached
// yet on the tick right after render(). Without this wait, switchSection()
// below dispatches to no listener and the section-switch never happens.
async function waitForMount() {
  await screen.findByRole("heading", { level: 1, name: "إدارة المستخدمين والصلاحيات" });
  // The heading being in the DOM only proves the lazy chunk rendered — effects
  // run afterwards. `switchSection` dispatches `pop-set-subtab` on `window`, so
  // if it fires before the tab's subscribing effect has been flushed, the event
  // lands with no listener attached: the section never switches and the
  // subsequent load never happens. That lost only under parallel-worker
  // contention, surfacing as an intermittent "expected readAuthActivityLog to
  // be called 1 times, but got 0". Flush pending effects before any dispatch.
  await act(async () => {
    await Promise.resolve();
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  __resetSubTabSelectionsForTests();
});

describe("UserManagementTab — a sub-tab clicked before the tab mounted", () => {
  // This tab is a `lazy()` boundary, so its very first visit spends a Suspense
  // fallback: the rail's `pop-set-subtab` event is dispatched (synchronously,
  // in the click handler that also schedules this mount) while nothing is
  // listening anywhere. The rail moves, the event is lost, and the tab used to
  // open on its own default section — `users` — with no way back into sync.
  // The rail's selection is recorded durably for exactly this case.
  it("opens on the recorded selection instead of the default section", async () => {
    mockSession();
    const handle = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    mockWorkspace(handle);
    const readSpy = vi
      .spyOn(authActivityLog, "readAuthActivityLog")
      .mockResolvedValue([]);

    // The click: recorded by the rail, announced to a listener that does not
    // exist yet. No event is dispatched here at all — that is the point.
    setSubTabSelection("user-management", "activity");

    render(<UserManagementTab />);
    await waitForMount();

    // "activity" (the merged activity/actions page) is the only non-default
    // section reachable from the rail, and its default inner view reads the
    // login/session activity log.
    await waitFor(() => expect(readSpy).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("5-system/audit/activity/", { exact: false })).toBeTruthy();
  });

  it("leaves a tab that owns no such sub-tab on its own default", async () => {
    mockSession();
    const handle = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    mockWorkspace(handle);
    const readSpy = vi
      .spyOn(actionLog, "readWorkspaceActions")
      .mockResolvedValue([]);

    // "browse" belongs to the population tab; this one must ignore it.
    setSubTabSelection("user-management", "browse");

    render(<UserManagementTab />);
    await waitForMount();
    await act(async () => {
      await Promise.resolve();
    });
    expect(readSpy).not.toHaveBeenCalled();
  });
});

describe("UserManagementTab — activity/actions section-switch skip-guard", () => {
  it("does not re-fetch the activity log when switching back to 'activity' for the same workspace", async () => {
    mockSession();
    const handle = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    mockWorkspace(handle);
    const readSpy = vi
      .spyOn(authActivityLog, "readAuthActivityLog")
      .mockResolvedValue([]);

    render(<UserManagementTab />);
    await waitForMount();
    switchSection("activity");
    await waitFor(() => expect(readSpy).toHaveBeenCalledTimes(1));

    switchSection("users");
    switchSection("activity");

    // Give any (incorrect) re-fetch a chance to fire before asserting it didn't.
    await act(async () => {
      await Promise.resolve();
    });
    expect(readSpy).toHaveBeenCalledTimes(1);
  });

  it("does not re-fetch workspace actions when switching back to the actions view for the same workspace", async () => {
    mockSession();
    const handle = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    mockWorkspace(handle);
    const readSpy = vi
      .spyOn(actionLog, "readWorkspaceActions")
      .mockResolvedValue([]);

    render(<UserManagementTab />);
    await waitForMount();
    switchSection("activity");
    clickAuditToggle("سجل الإجراءات");
    await waitFor(() => expect(readSpy).toHaveBeenCalledTimes(1));

    switchSection("users");
    switchSection("activity");
    clickAuditToggle("سجل الإجراءات");

    await act(async () => {
      await Promise.resolve();
    });
    expect(readSpy).toHaveBeenCalledTimes(1);
  });

  it("re-fetches activity/actions when the workspace handle actually changes", async () => {
    mockSession();
    const handleA = createMemoryDirectory("a") as unknown as DirectoryHandleLike;
    const handleB = createMemoryDirectory("b") as unknown as DirectoryHandleLike;
    mockWorkspace(handleA);
    const readSpy = vi
      .spyOn(actionLog, "readWorkspaceActions")
      .mockResolvedValue([]);

    const { rerender } = render(<UserManagementTab />);
    await waitForMount();
    switchSection("activity");
    clickAuditToggle("سجل الإجراءات");
    await waitFor(() => expect(readSpy).toHaveBeenCalledTimes(1));

    mockWorkspace(handleB);
    rerender(<UserManagementTab />);
    await waitFor(() => expect(readSpy).toHaveBeenCalledTimes(2));
  });
});

describe("UserManagementTab — performance section reuses the activity/actions loaders", () => {
  it("loads both the activity log and the action log when switching to 'performance'", async () => {
    mockSession();
    const handle = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    mockWorkspace(handle);
    const activitySpy = vi
      .spyOn(authActivityLog, "readAuthActivityLog")
      .mockResolvedValue([]);
    const actionsSpy = vi
      .spyOn(actionLog, "readWorkspaceActions")
      .mockResolvedValue([]);

    render(<UserManagementTab />);
    await waitForMount();
    switchSection("performance");

    await waitFor(() => expect(activitySpy).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(actionsSpy).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("تقييم الأداء")).toBeTruthy();
  });

  it("does not re-fetch the activity log when switching from 'activity' to 'performance' for the same workspace", async () => {
    mockSession();
    const handle = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    mockWorkspace(handle);
    const activitySpy = vi
      .spyOn(authActivityLog, "readAuthActivityLog")
      .mockResolvedValue([]);

    render(<UserManagementTab />);
    await waitForMount();
    switchSection("activity");
    await waitFor(() => expect(activitySpy).toHaveBeenCalledTimes(1));

    switchSection("performance");
    await act(async () => {
      await Promise.resolve();
    });
    expect(activitySpy).toHaveBeenCalledTimes(1);
  });
});
