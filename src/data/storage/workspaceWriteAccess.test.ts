/* @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import type { DirectoryHandleLike } from "./fileSystemAccess";
import { createMemoryDirectory } from "./memoryDirectory";
import { safeWriteJson } from "./safeWrite";
import {
  WORKSPACE_PERMISSION_LOST_EVENT,
  WorkspacePermissionError,
  withWorkspaceWriteAccess,
} from "./workspaceWriteAccess";

function withPermission(
  state: "granted" | "denied" | "prompt",
  requestedState: "granted" | "denied" = "granted",
): DirectoryHandleLike {
  return {
    ...createMemoryDirectory("permission-test"),
    queryPermission: vi.fn(async () => state),
    requestPermission: vi.fn(async () => requestedState),
  };
}

describe("withWorkspaceWriteAccess", () => {
  it("runs a command only while read/write permission is currently granted", async () => {
    const operation = vi.fn(async () => "saved");

    await expect(
      withWorkspaceWriteAccess(withPermission("granted"), operation),
    ).resolves.toBe("saved");
    expect(operation).toHaveBeenCalledOnce();
  });

  it("requests permission and runs the command when write access is needed", async () => {
    const directory = withPermission("prompt");
    const operation = vi.fn(async () => "saved");

    await expect(
      withWorkspaceWriteAccess(directory, operation),
    ).resolves.toBe("saved");
    expect(directory.requestPermission).toHaveBeenCalledWith({ mode: "readwrite" });
    expect(operation).toHaveBeenCalledOnce();
  });

  it.each(["denied", "prompt"] as const)(
    "fails before writing without disconnecting readable workspace when state is %s",
    async (state) => {
      const operation = vi.fn(async () => "must-not-run");
      const listener = vi.fn();
      window.addEventListener(WORKSPACE_PERMISSION_LOST_EVENT, listener);

      await expect(
        withWorkspaceWriteAccess(withPermission(state, "denied"), operation),
      ).rejects.toBeInstanceOf(WorkspacePermissionError);

      expect(operation).not.toHaveBeenCalled();
      expect(listener).not.toHaveBeenCalled();
      window.removeEventListener(WORKSPACE_PERMISSION_LOST_EVENT, listener);
    },
  );

  it("keeps the readable workspace connected when a write prompt cannot open", async () => {
    const directory = withPermission("prompt");
    directory.requestPermission = vi.fn(async () => {
      const error = new Error("User activation is required");
      error.name = "SecurityError";
      throw error;
    });
    const listener = vi.fn();
    window.addEventListener(WORKSPACE_PERMISSION_LOST_EVENT, listener);

    await expect(
      withWorkspaceWriteAccess(directory, async () => "must-not-run"),
    ).rejects.toBeInstanceOf(WorkspacePermissionError);

    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener(WORKSPACE_PERMISSION_LOST_EVENT, listener);
  });

  it("broadcasts permission errors raised after a granted preflight", async () => {
    const listener = vi.fn();
    window.addEventListener(WORKSPACE_PERMISSION_LOST_EVENT, listener);
    const permissionError = new Error("revoked during write");
    permissionError.name = "NotAllowedError";

    await expect(
      withWorkspaceWriteAccess(withPermission("granted"), async () => {
        throw permissionError;
      }),
    ).rejects.toBe(permissionError);

    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener(WORKSPACE_PERMISSION_LOST_EVENT, listener);
  });

  it("guards the shared safe-write boundary before any file is created", async () => {
    const directory = withPermission("denied");
    const getFileHandle = vi.spyOn(directory, "getFileHandle");

    await expect(safeWriteJson(directory, "blocked.json", { value: 1 }))
      .rejects.toBeInstanceOf(WorkspacePermissionError);

    expect(getFileHandle).not.toHaveBeenCalled();
  });
});
