/* @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, waitFor, cleanup, act, screen } from "@testing-library/react";
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
      .spyOn(actionLog, "readWorkspaceActions")
      .mockResolvedValue([]);

    // The click: recorded by the rail, announced to a listener that does not
    // exist yet. No event is dispatched here at all — that is the point.
    setSubTabSelection("user-management", "actions");

    render(<UserManagementTab />);
    await waitForMount();

    // The actions section is the only one that reads the workspace action log.
    await waitFor(() => expect(readSpy).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("5-system/audit/actions/", { exact: false })).toBeTruthy();
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

  it("does not re-fetch workspace actions when switching back to 'actions' for the same workspace", async () => {
    mockSession();
    const handle = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    mockWorkspace(handle);
    const readSpy = vi
      .spyOn(actionLog, "readWorkspaceActions")
      .mockResolvedValue([]);

    render(<UserManagementTab />);
    await waitForMount();
    switchSection("actions");
    await waitFor(() => expect(readSpy).toHaveBeenCalledTimes(1));

    switchSection("users");
    switchSection("actions");

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
    switchSection("actions");
    await waitFor(() => expect(readSpy).toHaveBeenCalledTimes(1));

    mockWorkspace(handleB);
    rerender(<UserManagementTab />);
    await waitFor(() => expect(readSpy).toHaveBeenCalledTimes(2));
  });
});
