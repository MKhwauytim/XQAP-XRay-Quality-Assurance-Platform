/* @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import AuthGate from "./AuthGate";
import * as userManagement from "./userManagement";
import * as authSession from "./authSession";
import * as passwordCrypto from "./passwordCrypto";
import { writeLastLoginUsername } from "./loginPersistence";
import { VIEWER_USERNAME } from "./authConfig";
import { WorkspaceProvider } from "../data/workspace/WorkspaceProvider";
import { createMemoryDirectory } from "../data/storage/memoryDirectory";
import type { AuthSession } from "./authTypes";
import {
  WORKSPACE_SCHEMA_VERSION,
  type UsersPermissionsFile
} from "../data/workspace/workspaceTypes";

// AdminToolbar (rendered whenever AuthGate has a session) pulls in
// GlobalMonthSelector -> useGlobalMonth(), which requires a GlobalMonthProvider
// ancestor that isn't relevant to anything this file asserts on. Stub it out so
// the "session survived" tests below only need a WorkspaceProvider, matching
// what AuthGate itself actually depends on for the session-hydration logic.
vi.mock("./AdminToolbar", () => ({
  AdminToolbar: () => <div data-testid="admin-toolbar-stub" />
}));

const mocks = vi.hoisted(() => ({
  checkWorkspaceStructure: vi.fn(),
  ensureDirectoryPermission: vi.fn(),
  isFileSystemAccessSupported: vi.fn(),
  loadLastWorkspace: vi.fn(),
  loadWorkspaceFiles: vi.fn(),
  queryDirectoryPermission: vi.fn(),
}));

vi.mock("../data/storage/fileSystemAccess", async (importOriginal) => ({
  ...await importOriginal<typeof import("../data/storage/fileSystemAccess")>(),
  checkWorkspaceStructure: mocks.checkWorkspaceStructure,
  ensureDirectoryPermission: mocks.ensureDirectoryPermission,
  isFileSystemAccessSupported: mocks.isFileSystemAccessSupported,
  loadWorkspaceFiles: mocks.loadWorkspaceFiles,
  queryDirectoryPermission: mocks.queryDirectoryPermission,
}));

vi.mock("../data/workspace/workspacePersistence", async (importOriginal) => ({
  ...await importOriginal<typeof import("../data/workspace/workspacePersistence")>(),
  loadLastWorkspace: mocks.loadLastWorkspace,
}));

// Real WorkspaceProvider (with fileSystemAccess/workspacePersistence mocked at
// the boundary above) instead of a hand-rolled useWorkspace() stub, so these
// tests exercise the actual wiring between WorkspaceProvider's usersHydrated
// flag and AuthGate's deferred session-existence check — not just AuthGate in
// isolation.
function renderAuthGate() {
  return render(
    <WorkspaceProvider>
      <AuthGate>{() => <div>authenticated</div>}</AuthGate>
    </WorkspaceProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.spyOn(authSession, "readRealSession").mockReturnValue(null);

  mocks.isFileSystemAccessSupported.mockReturnValue(true);
  mocks.ensureDirectoryPermission.mockResolvedValue(true);
  mocks.loadLastWorkspace.mockResolvedValue(null);
  mocks.queryDirectoryPermission.mockResolvedValue("granted");
  mocks.checkWorkspaceStructure.mockResolvedValue({
    status: "missing_structure",
    missingItems: ["1-population"],
    invalidItems: [],
    message: "missing",
  });
  mocks.loadWorkspaceFiles.mockResolvedValue({
    manifest: null,
    usersPermissions: null,
    sampleMaster: null,
    sampleDistribution: null,
  });
});

afterEach(() => {
  cleanup();
});

describe("AuthGate — login form", () => {
  it("leaves the username blank when the bootstrap admin was the last login", () => {
    writeLastLoginUsername("admin");
    vi.spyOn(userManagement, "getManagedLoginUsers").mockReturnValue([
      {
        id: "u1", username: "testuser", displayName: "Test", role: "employee",
        passwordHash: { algorithm: "argon2id", encoded: "x" },
        isActive: true, hasCertScanLicense: false,
        createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
      },
    ]);

    renderAuthGate();

    expect(screen.getByLabelText("اسم المستخدم")).toHaveValue("");
  });

  it("renders login form when no active session and users exist", () => {
    vi.spyOn(userManagement, "getManagedLoginUsers").mockReturnValue([
      {
        id: "u1", username: "testuser", displayName: "Test", role: "employee",
        passwordHash: { algorithm: "argon2id", encoded: "x" },
        isActive: true, hasCertScanLicense: false,
        createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
      },
    ]);

    renderAuthGate();
    expect(screen.getByLabelText("اسم المستخدم")).toBeInTheDocument();
    expect(screen.getByLabelText("كلمة المرور")).toBeInTheDocument();
  });

  it("shows error message on wrong password", async () => {
    vi.spyOn(userManagement, "getManagedLoginUsers").mockReturnValue([
      {
        id: "u1", username: "testuser", displayName: "Test", role: "employee",
        passwordHash: { algorithm: "argon2id", encoded: "x" },
        isActive: true, hasCertScanLicense: false,
        createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
      },
    ]);
    vi.spyOn(passwordCrypto, "verifyPasswordHash").mockResolvedValue(false);

    renderAuthGate();
    fireEvent.change(screen.getByLabelText("اسم المستخدم"), { target: { value: "testuser" } });
    fireEvent.change(screen.getByLabelText("كلمة المرور"), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "دخول" }));

    await waitFor(() => {
      expect(screen.getByText(/اسم المستخدم غير موجود/)).toBeInTheDocument();
    });
  });
});

describe("AuthGate — startup session-hydration race (B2)", () => {
  const NON_SEED_USERNAME = "ahmed.salem";

  function buildUsersPermissionsFile(usernames: string[]): UsersPermissionsFile {
    const now = "2026-07-01T00:00:00.000Z";
    return {
      metadata: {
        schemaVersion: WORKSPACE_SCHEMA_VERSION,
        fileType: "users.permissions",
        revision: 1,
        createdAt: now,
        createdBy: "admin",
        updatedAt: now,
        updatedBy: "admin",
        contentHash: "test-hash",
      },
      data: {
        users: usernames.map((username, index) => ({
          id: `user-${index}-${username}`,
          username,
          displayName: username,
          passwordHash: { algorithm: "argon2id" as const, encoded: "x" },
          role: "employee" as const,
          isActive: true,
          hasCertScanLicense: false,
          createdAt: now,
          createdBy: "admin",
          updatedAt: now,
          updatedBy: "admin",
        })),
        roles: [],
        permissions: [],
        featurePermissions: [],
      },
    };
  }

  function mockReadyWorkspace(name: string, diskUsernames: string[]) {
    const handle = createMemoryDirectory(name);
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
    mocks.loadWorkspaceFiles.mockResolvedValue({
      manifest: null,
      usersPermissions: buildUsersPermissionsFile(diskUsernames),
      sampleMaster: null,
      sampleDistribution: null,
    });
    return handle;
  }

  beforeEach(() => {
    // Simulate a fresh module load: the in-memory user-management runtime
    // state has not been synced from any workspace yet, so getManagedLoginUsers()
    // reflects only the default seed users until applyDiskUsers hydrates it —
    // exactly the "before" condition the startup race depends on.
    userManagement.writeUserManagementState(
      userManagement.createEmptyUserManagementState(),
      false,
    );
  });

  afterEach(() => {
    userManagement.writeUserManagementState(
      userManagement.createEmptyUserManagementState(),
      false,
    );
  });

  it("keeps a persisted session for a non-seed managed user alive across workspace hydration", async () => {
    const persistedSession: AuthSession = {
      role: "employee",
      username: NON_SEED_USERNAME,
      loginAt: new Date().toISOString(),
    };
    vi.spyOn(authSession, "readRealSession").mockReturnValue(persistedSession);
    mockReadyWorkspace("hydration-race-survives", [NON_SEED_USERNAME]);

    renderAuthGate();

    // Fix: the session must be visible immediately — before hydration even
    // starts — instead of getInitialSession() wrongly clearing it against the
    // not-yet-hydrated (seed-only) user list.
    expect(screen.getByText("authenticated")).toBeInTheDocument();

    await waitFor(() => {
      expect(mocks.loadWorkspaceFiles).toHaveBeenCalled();
    });

    // And it must still be there once hydration — and the deferred
    // usersHydrated-gated re-validation in AuthGate — has actually run.
    await waitFor(() => {
      expect(screen.getByText("authenticated")).toBeInTheDocument();
    });
    expect(screen.queryByLabelText("اسم المستخدم")).not.toBeInTheDocument();
  });

  it("does not clear a demo/viewer session once hydration completes, even though 'viewer' is never a managed user", async () => {
    // Regression: the demo session carries role "admin" (for full tab
    // visibility) but username VIEWER_USERNAME, so it fails
    // isBootstrapAdminSession(). Before the isExemptFromManagedUserValidation
    // fix, the usersHydrated-gated re-validation added for this same bucket
    // would run stillHasManagedUser() against it, always find no match (the
    // demo/viewer identity is never a disk/managed user), and clear the
    // session on every single demo login.
    const demoSession: AuthSession = {
      role: "admin",
      username: VIEWER_USERNAME,
      loginAt: new Date().toISOString(),
      mode: "demo",
    };
    vi.spyOn(authSession, "readRealSession").mockReturnValue(demoSession);
    mockReadyWorkspace("hydration-race-demo-session-survives", [NON_SEED_USERNAME]);

    renderAuthGate();

    expect(screen.getByText("authenticated")).toBeInTheDocument();

    await waitFor(() => {
      expect(mocks.loadWorkspaceFiles).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(screen.getByText("authenticated")).toBeInTheDocument();
    });
    expect(screen.queryByLabelText("اسم المستخدم")).not.toBeInTheDocument();
  });

  it("still clears a persisted session once hydration confirms the user is really gone", async () => {
    vi.spyOn(authSession, "readRealSession").mockReturnValue({
      role: "employee",
      username: "someone.removed",
      loginAt: new Date().toISOString(),
    });
    // Disk users never include "someone.removed" — the deferred check must
    // still catch a genuinely stale session once hydration completes.
    mockReadyWorkspace("hydration-race-still-clears", [NON_SEED_USERNAME]);

    renderAuthGate();

    await waitFor(() => {
      expect(screen.getByLabelText("اسم المستخدم")).toBeInTheDocument();
    });
  });
});
