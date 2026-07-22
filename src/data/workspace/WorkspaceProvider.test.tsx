/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import { DEFAULT_LABELS } from "../labels/labelsStore";
import { WorkspacePicker } from "./WorkspaceGate";
import { WorkspaceProvider } from "./WorkspaceProvider";
import { useWorkspace } from "./useWorkspace";

const mocks = vi.hoisted(() => ({
  checkWorkspaceStructure: vi.fn(),
  ensureDirectoryPermission: vi.fn(),
  isFileSystemAccessSupported: vi.fn(),
  loadLastWorkspace: vi.fn(),
  queryDirectoryPermission: vi.fn(),
}));

vi.mock("../storage/fileSystemAccess", async (importOriginal) => ({
  ...await importOriginal<typeof import("../storage/fileSystemAccess")>(),
  checkWorkspaceStructure: mocks.checkWorkspaceStructure,
  ensureDirectoryPermission: mocks.ensureDirectoryPermission,
  isFileSystemAccessSupported: mocks.isFileSystemAccessSupported,
  queryDirectoryPermission: mocks.queryDirectoryPermission,
}));

vi.mock("./workspacePersistence", async (importOriginal) => ({
  ...await importOriginal<typeof import("./workspacePersistence")>(),
  loadLastWorkspace: mocks.loadLastWorkspace,
}));

function WorkspaceState() {
  const { pendingReconnect, status } = useWorkspace();
  return <output>{`${status}:${pendingReconnect}`}</output>;
}

describe("remembered workspace fallback", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isFileSystemAccessSupported.mockReturnValue(true);
    mocks.ensureDirectoryPermission.mockResolvedValue(true);
    mocks.checkWorkspaceStructure.mockResolvedValue({
      status: "missing_structure",
      missingItems: ["1-population"],
      invalidItems: [],
      message: "missing",
    });
    mocks.loadLastWorkspace.mockResolvedValue(null);
    mocks.queryDirectoryPermission.mockResolvedValue("granted");
  });

  it("degrades to manual selection when IndexedDB cannot be opened", async () => {
    mocks.loadLastWorkspace.mockRejectedValue(new Error("IndexedDB unavailable"));

    render(<WorkspaceProvider><WorkspaceState /></WorkspaceProvider>);

    await waitFor(() => expect(mocks.loadLastWorkspace).toHaveBeenCalledOnce());
    expect(screen.getByText("not_selected:false")).toBeInTheDocument();
  });

  it("degrades to manual selection when the remembered handle is revoked or moved", async () => {
    const handle = createMemoryDirectory("revoked-workspace");
    mocks.loadLastWorkspace.mockResolvedValue({
      directoryHandle: handle,
      directoryName: handle.name,
      savedAt: new Date().toISOString(),
    });
    mocks.queryDirectoryPermission.mockRejectedValue(
      new DOMException("Handle is no longer valid", "NotAllowedError"),
    );

    render(<WorkspaceProvider><WorkspaceState /></WorkspaceProvider>);

    await waitFor(() => expect(mocks.queryDirectoryPermission).toHaveBeenCalledOnce());
    expect(screen.getByText("not_selected:false")).toBeInTheDocument();
  });

  it("renders the unsupported-browser state without opening IndexedDB", () => {
    mocks.isFileSystemAccessSupported.mockReturnValue(false);

    render(<WorkspaceProvider><WorkspaceState /></WorkspaceProvider>);

    expect(screen.getByText("unsupported_browser:false")).toBeInTheDocument();
    expect(mocks.loadLastWorkspace).not.toHaveBeenCalled();
  });

  it("shows a reconnect button and requests read access from its click", async () => {
    const handle = createMemoryDirectory("remembered-workspace");
    mocks.loadLastWorkspace.mockResolvedValue({
      directoryHandle: handle,
      directoryName: handle.name,
      savedAt: new Date().toISOString(),
    });
    mocks.queryDirectoryPermission.mockResolvedValue("prompt");

    render(
      <WorkspaceProvider>
        <WorkspacePicker><div>connected</div></WorkspacePicker>
      </WorkspaceProvider>,
    );

    const reconnect = await screen.findByRole("button", {
      name: DEFAULT_LABELS.wsgate_reconnect_btn,
    });
    fireEvent.click(reconnect);

    await waitFor(() => {
      expect(mocks.ensureDirectoryPermission).toHaveBeenCalledWith(handle, "read");
    });
  });
});
