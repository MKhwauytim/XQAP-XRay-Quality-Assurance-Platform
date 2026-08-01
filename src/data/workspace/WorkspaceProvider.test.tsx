/* @vitest-environment jsdom */
import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import { DEFAULT_LABELS } from "../labels/labelsStore";
import {
  createEmptyUserManagementState,
  getManagedLoginUsers,
  writeUserManagementState,
} from "../../auth/userManagement";
import { emptyLoadedFiles } from "./WorkspaceContext";
import { WorkspacePicker } from "./WorkspaceGate";
import { WorkspaceProvider } from "./WorkspaceProvider";
import { useWorkspace } from "./useWorkspace";

const mocks = vi.hoisted(() => ({
  checkWorkspaceStructure: vi.fn(),
  clearLastWorkspace: vi.fn(),
  ensureDirectoryPermission: vi.fn(),
  isFileSystemAccessSupported: vi.fn(),
  loadLastWorkspace: vi.fn(),
  loadWorkspaceFiles: vi.fn(),
  queryDirectoryPermission: vi.fn(),
}));

vi.mock("../storage/fileSystemAccess", async (importOriginal) => ({
  ...await importOriginal<typeof import("../storage/fileSystemAccess")>(),
  checkWorkspaceStructure: mocks.checkWorkspaceStructure,
  ensureDirectoryPermission: mocks.ensureDirectoryPermission,
  isFileSystemAccessSupported: mocks.isFileSystemAccessSupported,
  loadWorkspaceFiles: mocks.loadWorkspaceFiles,
  queryDirectoryPermission: mocks.queryDirectoryPermission,
}));

vi.mock("./workspacePersistence", async (importOriginal) => ({
  ...await importOriginal<typeof import("./workspacePersistence")>(),
  clearLastWorkspace: mocks.clearLastWorkspace,
  loadLastWorkspace: mocks.loadLastWorkspace,
}));

function WorkspaceState() {
  const { pendingReconnect, status } = useWorkspace();
  return <output>{`${status}:${pendingReconnect}`}</output>;
}

function WorkspaceHydrationState() {
  const { status, usersHydrated } = useWorkspace();
  return <output>{`${status}:${usersHydrated ?? false}`}</output>;
}

function ClearWorkspaceButton() {
  const { clearWorkspace } = useWorkspace();
  return (
    <button type="button" onClick={clearWorkspace}>
      clear
    </button>
  );
}

function RefreshPermissionsProbe() {
  const { status, refreshPermissions } = useWorkspace();
  const [usernames, setUsernames] = useState(() =>
    getManagedLoginUsers().map((u) => u.username).join(","),
  );
  return (
    <div>
      <output data-testid="status">{status}</output>
      <output data-testid="usernames">{usernames}</output>
      <button
        type="button"
        onClick={() => {
          void refreshPermissions().then(() => {
            setUsernames(getManagedLoginUsers().map((u) => u.username).join(","));
          });
        }}
      >
        refresh
      </button>
    </div>
  );
}

function diskFileWithUser(username: string) {
  return {
    manifest: null,
    sampleMaster: null,
    sampleDistribution: null,
    usersPermissions: {
      metadata: {
        schemaVersion: 1,
        revision: 1,
        contentHash: "x",
        writtenAt: "2026-01-01T00:00:00.000Z",
      },
      data: {
        users: [
          {
            id: "u-refreshed",
            username,
            displayName: "Refreshed User",
            passwordHash: { algorithm: "argon2id" as const, encoded: "x" },
            role: "employee" as const,
            isActive: true,
            hasCertScanLicense: false,
            createdAt: "2026-01-01T00:00:00.000Z",
            createdBy: "admin",
            updatedAt: "2026-01-01T00:00:00.000Z",
            updatedBy: "admin",
          },
        ],
        roles: [],
        permissions: [],
        featurePermissions: [],
      },
    },
  };
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
    mocks.clearLastWorkspace.mockResolvedValue(undefined);
    mocks.loadLastWorkspace.mockResolvedValue(null);
    mocks.loadWorkspaceFiles.mockResolvedValue(emptyLoadedFiles);
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

describe("usersHydrated", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isFileSystemAccessSupported.mockReturnValue(true);
    mocks.clearLastWorkspace.mockResolvedValue(undefined);
    mocks.ensureDirectoryPermission.mockResolvedValue(true);
    mocks.loadWorkspaceFiles.mockResolvedValue(emptyLoadedFiles);
    mocks.queryDirectoryPermission.mockResolvedValue("granted");
  });

  it("stays false until applyDiskUsers has synced a workspace that becomes ready", async () => {
    const handle = createMemoryDirectory("hydrating-workspace");
    mocks.loadLastWorkspace.mockResolvedValue({
      directoryHandle: handle,
      directoryName: handle.name,
      savedAt: new Date().toISOString(),
    });
    mocks.checkWorkspaceStructure.mockResolvedValue({
      status: "ready",
      missingItems: [],
      invalidItems: [],
      message: "ready",
    });

    render(
      <WorkspaceProvider>
        <WorkspaceHydrationState />
      </WorkspaceProvider>,
    );

    // Before the restore effect settles, usersHydrated must not have jumped
    // to true — this is the flag AuthGate gates its session-existence check
    // on, so it must lag behind (never lead) the actual applyDiskUsers sync.
    expect(screen.getByText("not_selected:false")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("ready:true")).toBeInTheDocument();
    });
    expect(mocks.loadWorkspaceFiles).toHaveBeenCalledWith(handle);
  });

  it("never becomes true for a workspace that does not reach ready", async () => {
    const handle = createMemoryDirectory("never-ready-workspace");
    mocks.loadLastWorkspace.mockResolvedValue({
      directoryHandle: handle,
      directoryName: handle.name,
      savedAt: new Date().toISOString(),
    });
    mocks.checkWorkspaceStructure.mockResolvedValue({
      status: "missing_structure",
      missingItems: ["1-population"],
      invalidItems: [],
      message: "missing",
    });

    render(
      <WorkspaceProvider>
        <WorkspaceHydrationState />
      </WorkspaceProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("missing_structure:false")).toBeInTheDocument();
    });
    expect(mocks.loadWorkspaceFiles).not.toHaveBeenCalled();
  });

  it("resets to false when the workspace is cleared", async () => {
    const handle = createMemoryDirectory("clear-after-hydration");
    mocks.loadLastWorkspace.mockResolvedValue({
      directoryHandle: handle,
      directoryName: handle.name,
      savedAt: new Date().toISOString(),
    });
    mocks.checkWorkspaceStructure.mockResolvedValue({
      status: "ready",
      missingItems: [],
      invalidItems: [],
      message: "ready",
    });

    render(
      <WorkspaceProvider>
        <WorkspaceHydrationState />
        <ClearWorkspaceButton />
      </WorkspaceProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("ready:true")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "clear" }));

    expect(screen.getByText("not_selected:false")).toBeInTheDocument();
  });
});

describe("refreshPermissions", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    writeUserManagementState(createEmptyUserManagementState(), false);
    mocks.isFileSystemAccessSupported.mockReturnValue(true);
    mocks.clearLastWorkspace.mockResolvedValue(undefined);
    mocks.ensureDirectoryPermission.mockResolvedValue(true);
    mocks.queryDirectoryPermission.mockResolvedValue("granted");
  });

  it("re-syncs users from disk on demand without flipping status away from ready", async () => {
    const handle = createMemoryDirectory("refresh-permissions-workspace");
    mocks.loadLastWorkspace.mockResolvedValue({
      directoryHandle: handle,
      directoryName: handle.name,
      savedAt: new Date().toISOString(),
    });
    mocks.checkWorkspaceStructure.mockResolvedValue({
      status: "ready",
      missingItems: [],
      invalidItems: [],
      message: "ready",
    });
    mocks.loadWorkspaceFiles.mockResolvedValueOnce(emptyLoadedFiles);

    render(
      <WorkspaceProvider>
        <RefreshPermissionsProbe />
      </WorkspaceProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("ready"));

    // Simulate an admin editing users.permissions.json elsewhere: the next
    // disk read returns a different roster than what's already in memory.
    mocks.loadWorkspaceFiles.mockResolvedValueOnce(diskFileWithUser("refreshed-user"));

    fireEvent.click(screen.getByRole("button", { name: "refresh" }));

    await waitFor(() =>
      expect(screen.getByTestId("usernames")).toHaveTextContent("refreshed-user"),
    );
    // Must never have flipped through a non-"ready" status -- that would mean
    // WorkspaceGate briefly unmounted the whole app for its full-screen
    // spinner, which is exactly what refreshPermissions (unlike
    // reloadWorkspace) is meant to avoid for a silent background/manual sync.
    expect(screen.getByTestId("status")).toHaveTextContent("ready");
  });

  it("is a no-op when no workspace is connected", async () => {
    mocks.loadLastWorkspace.mockResolvedValue(null);

    render(
      <WorkspaceProvider>
        <RefreshPermissionsProbe />
      </WorkspaceProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("not_selected"));

    const callsBefore = mocks.loadWorkspaceFiles.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "refresh" }));
    await Promise.resolve();

    expect(mocks.loadWorkspaceFiles.mock.calls.length).toBe(callsBefore);
  });
});
