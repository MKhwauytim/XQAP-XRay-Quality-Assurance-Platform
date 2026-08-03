/* @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, waitFor, cleanup, act } from "@testing-library/react";
import UserManagementTab from "./index";
import * as authSession from "../../../../auth/authSession";
import * as usePermissionsModule from "../../../../auth/usePermissions";
import * as authActivityLog from "../../../../auth/authActivityLog";
import * as actionLog from "../../../../data/audit/actionLog";
import * as useWorkspaceModule from "../../../../data/workspace/useWorkspace";
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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
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
    switchSection("actions");
    await waitFor(() => expect(readSpy).toHaveBeenCalledTimes(1));

    mockWorkspace(handleB);
    rerender(<UserManagementTab />);
    await waitFor(() => expect(readSpy).toHaveBeenCalledTimes(2));
  });
});
