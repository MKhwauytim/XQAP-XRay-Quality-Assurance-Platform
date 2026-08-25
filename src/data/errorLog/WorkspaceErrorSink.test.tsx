/* @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";

const workspaceMock = vi.hoisted(() => ({
  handle: null as DirectoryHandleLike | null,
  status: "checking" as string,
}));

vi.mock("../workspace/useWorkspace", () => ({
  useWorkspace: () => ({ directoryHandle: workspaceMock.handle, status: workspaceMock.status }),
}));

const sinkMock = vi.hoisted(() => ({
  install: vi.fn(() => vi.fn()),
}));

vi.mock("./errorLogSink", () => ({
  installWorkspaceErrorSink: sinkMock.install,
}));

// Imported AFTER the mocks above so the module under test picks them up.
import { WorkspaceErrorSink } from "./WorkspaceErrorSink";

describe("WorkspaceErrorSink", () => {
  beforeEach(() => {
    sinkMock.install.mockClear();
    workspaceMock.handle = null;
    workspaceMock.status = "checking";
  });

  it("installs the sink once the workspace is ready and a handle exists", () => {
    workspaceMock.handle = {} as DirectoryHandleLike;
    workspaceMock.status = "ready";

    render(<WorkspaceErrorSink username="alice" />);

    expect(sinkMock.install).toHaveBeenCalledWith({
      directoryHandle: workspaceMock.handle,
      username: "alice",
    });
    cleanup();
  });

  it("does not install for a demo-mode (enabled=false) session", () => {
    workspaceMock.handle = {} as DirectoryHandleLike;
    workspaceMock.status = "ready";

    render(<WorkspaceErrorSink username="demo" enabled={false} />);

    expect(sinkMock.install).not.toHaveBeenCalled();
    cleanup();
  });

  it("does not install while the workspace is not yet ready", () => {
    workspaceMock.handle = null;
    workspaceMock.status = "checking";

    render(<WorkspaceErrorSink username="alice" />);

    expect(sinkMock.install).not.toHaveBeenCalled();
    cleanup();
  });

  it("uninstalls on unmount", () => {
    const uninstall = vi.fn();
    sinkMock.install.mockReturnValue(uninstall);
    workspaceMock.handle = {} as DirectoryHandleLike;
    workspaceMock.status = "ready";

    const { unmount } = render(<WorkspaceErrorSink username="alice" />);
    expect(sinkMock.install).toHaveBeenCalledTimes(1);
    unmount();
    expect(uninstall).toHaveBeenCalledTimes(1);
  });
});
