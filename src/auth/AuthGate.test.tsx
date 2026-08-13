/* @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";
import AuthGate from "./AuthGate";
import * as userManagement from "./userManagement";
import * as authSession from "./authSession";
import * as authActivityLog from "./authActivityLog";
import * as passwordCrypto from "./passwordCrypto";
import { writeLastLoginUsername } from "./loginPersistence";
import { VIEWER_USERNAME } from "./authConfig";
import { WorkspaceProvider } from "../data/workspace/WorkspaceProvider";
import { createMemoryDirectory } from "../data/storage/memoryDirectory";
import * as populationStorage from "../data/population/populationStorage";
import { useGlobalMonth } from "../data/month/useGlobalMonth";
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

describe("AuthGate — bootstrap admin through the normal sign-in form", () => {
  const SEED_USER: userManagement.ManagedLoginUser = {
    id: "u1", username: "testuser", displayName: "Test", role: "employee",
    passwordHash: { algorithm: "argon2id", encoded: "x" },
    isActive: true, hasCertScanLicense: false,
    createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
  };

  function submitLogin(username: string, password: string) {
    fireEvent.change(screen.getByLabelText("اسم المستخدم"), { target: { value: username } });
    fireEvent.change(screen.getByLabelText("كلمة المرور"), { target: { value: password } });
    fireEvent.click(screen.getByRole("button", { name: "دخول" }));
  }

  beforeEach(() => {
    vi.spyOn(userManagement, "getManagedLoginUsers").mockReturnValue([SEED_USER]);
  });

  it("signs in as the bootstrap admin when username sign-in is allowed", async () => {
    vi.spyOn(userManagement, "readAdminAccount").mockReturnValue({
      passwordHash: null, allowUsernameLogin: true, updatedAt: null, updatedBy: null,
    });
    const verify = vi.spyOn(passwordCrypto, "verifyPasswordHash").mockResolvedValue(true);

    renderAuthGate();
    submitLogin("admin", "admin");

    await waitFor(() => {
      expect(screen.getByText("authenticated")).toBeInTheDocument();
    });
    // The passcode was checked against the admin hash, not a managed user's —
    // "admin" is never in the managed-users list.
    expect(verify).toHaveBeenCalledWith("admin", userManagement.resolveAdminPasswordHash());
  });

  it("rejects a wrong admin passcode instead of falling through to the user lookup", async () => {
    vi.spyOn(userManagement, "readAdminAccount").mockReturnValue({
      passwordHash: null, allowUsernameLogin: true, updatedAt: null, updatedBy: null,
    });
    vi.spyOn(passwordCrypto, "verifyPasswordHash").mockResolvedValue(false);

    renderAuthGate();
    submitLogin("admin", "wrong");

    await waitFor(() => {
      expect(screen.getByText(/اسم المستخدم غير موجود/)).toBeInTheDocument();
    });
    expect(screen.queryByText("authenticated")).not.toBeInTheDocument();
  });

  it("refuses the admin username entirely once the setting is switched off", async () => {
    vi.spyOn(userManagement, "readAdminAccount").mockReturnValue({
      passwordHash: null, allowUsernameLogin: false, updatedAt: null, updatedBy: null,
    });
    // Would succeed if the bootstrap branch ran at all — the setting, not the
    // passcode, is what must block it here.
    const verify = vi.spyOn(passwordCrypto, "verifyPasswordHash").mockResolvedValue(true);

    renderAuthGate();
    submitLogin("admin", "admin");

    await waitFor(() => {
      expect(screen.getByText(/اسم المستخدم غير موجود/)).toBeInTheDocument();
    });
    expect(screen.queryByText("authenticated")).not.toBeInTheDocument();
    expect(verify).not.toHaveBeenCalled();
  });
});

describe("AuthGate — startup session-hydration race (B2)", () => {
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

describe("AuthGate — usersHydrated render gate (P1 item 4)", () => {
  beforeEach(() => {
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

  it("shows a loading gate (not the authenticated UI) while status is ready but usersHydrated hasn't caught up, then renders once it has", async () => {
    const persistedSession: AuthSession = {
      role: "employee",
      username: NON_SEED_USERNAME,
      loginAt: new Date().toISOString(),
    };
    vi.spyOn(authSession, "readRealSession").mockReturnValue(persistedSession);

    const handle = createMemoryDirectory("hydration-gate");
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

    let resolveLoadWorkspaceFiles!: (value: Awaited<ReturnType<typeof mocks.loadWorkspaceFiles>>) => void;
    mocks.loadWorkspaceFiles.mockReturnValue(
      new Promise((resolve) => {
        resolveLoadWorkspaceFiles = resolve;
      }),
    );

    renderAuthGate();

    // status has not reached "ready" yet at first paint -- unchanged, pre-existing behavior.
    expect(screen.getByText("authenticated")).toBeInTheDocument();

    await waitFor(() => {
      expect(mocks.loadWorkspaceFiles).toHaveBeenCalled();
    });

    // status IS "ready" now, but usersHydrated hasn't caught up (loadWorkspaceFiles
    // is still pending) -- the gate must be active: authenticated content and the
    // admin toolbar are both hidden.
    await waitFor(() => {
      expect(screen.queryByText("authenticated")).not.toBeInTheDocument();
    });
    expect(screen.queryByTestId("admin-toolbar-stub")).not.toBeInTheDocument();
    expect(screen.getByText("جارٍ التحميل…")).toBeInTheDocument();

    resolveLoadWorkspaceFiles({
      manifest: null,
      usersPermissions: buildUsersPermissionsFile([NON_SEED_USERNAME]),
      sampleMaster: null,
      sampleDistribution: null,
    });

    await waitFor(() => {
      expect(screen.getByText("authenticated")).toBeInTheDocument();
    });
    expect(screen.getByTestId("admin-toolbar-stub")).toBeInTheDocument();
  });

  it("never gates an exempt (demo) session", async () => {
    const demoSession: AuthSession = {
      role: "admin",
      username: VIEWER_USERNAME,
      loginAt: new Date().toISOString(),
      mode: "demo",
    };
    vi.spyOn(authSession, "readRealSession").mockReturnValue(demoSession);

    const handle = createMemoryDirectory("hydration-gate-demo-exempt");
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
    mocks.loadWorkspaceFiles.mockReturnValue(new Promise(() => {})); // never resolves

    renderAuthGate();

    await waitFor(() => {
      expect(mocks.loadWorkspaceFiles).toHaveBeenCalled();
    });

    // Even with hydration never completing, an exempt session must stay visible.
    expect(screen.getByText("authenticated")).toBeInTheDocument();
  });
});

describe("AuthGate — GlobalMonthProvider moved inside (P2 item 5)", () => {
  it("does not list month folders while a workspace is connected but no one has logged in yet, then lists them once login actually succeeds", async () => {
    const listMonthFoldersSpy = vi.spyOn(populationStorage, "listMonthFolders");
    listMonthFoldersSpy.mockResolvedValue([]);

    // No persisted session -- this file's default beforeEach already sets
    // this, but it's restated here because it's load-bearing for the
    // scenario: the workspace below connects (auto-reconnect, independent of
    // authentication) while `session` stays null, exactly like a real user
    // sitting on the login screen with a previously-used workspace folder.
    vi.spyOn(authSession, "readRealSession").mockReturnValue(null);

    const password = "correct horse battery staple";
    vi.spyOn(userManagement, "getManagedLoginUsers").mockReturnValue([
      {
        id: "u1",
        username: NON_SEED_USERNAME,
        displayName: "Ahmed Salem",
        role: "employee",
        passwordHash: { algorithm: "argon2id", encoded: "x" },
        isActive: true,
        hasCertScanLicense: false,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    ]);
    vi.spyOn(passwordCrypto, "verifyPasswordHash").mockResolvedValue(true);

    // The workspace reaches "ready" + hydrated on its own, with no session
    // involved at all -- the exact pre-login condition the fix targets.
    mockReadyWorkspace("global-month-pre-login-workspace", [NON_SEED_USERNAME]);

    function MonthConsumer() {
      const { months } = useGlobalMonth();
      return <div data-testid="month-count">{months.length}</div>;
    }

    // AdminToolbar is stubbed file-wide (see the vi.mock at the top of this
    // file), so this only proves the render-prop `children` path receives
    // GlobalMonthContext -- the AdminToolbar -> GlobalMonthSelector path is
    // presumed covered by GlobalMonthSelector's own dedicated tests.
    render(
      <WorkspaceProvider>
        <AuthGate>{() => <MonthConsumer />}</AuthGate>
      </WorkspaceProvider>,
    );

    // Login form showing confirms session is genuinely null at this point.
    await waitFor(() => {
      expect(screen.getByLabelText("اسم المستخدم")).toBeInTheDocument();
    });

    // Let the already-connected workspace fully settle to ready/hydrated
    // while still logged out.
    await waitFor(() => {
      expect(mocks.loadWorkspaceFiles).toHaveBeenCalled();
    });

    // Still pre-login: GlobalMonthProvider isn't mounted anywhere in the
    // tree yet (it now lives inside AuthGate's authenticated branch), so
    // listMonthFolders must not have fired despite the workspace being
    // fully connected.
    expect(listMonthFoldersSpy).not.toHaveBeenCalled();
    expect(screen.queryByTestId("month-count")).not.toBeInTheDocument();

    // Now actually log in through the real UI, the same way
    // "AuthGate — login form" does.
    fireEvent.change(screen.getByLabelText("اسم المستخدم"), {
      target: { value: NON_SEED_USERNAME },
    });
    fireEvent.change(screen.getByLabelText("كلمة المرور"), {
      target: { value: password },
    });
    fireEvent.click(screen.getByRole("button", { name: "دخول" }));

    // Once login succeeds, AuthGate mounts GlobalMonthProvider around the
    // authenticated children, and it lists months for the workspace that
    // was already sitting connected in the background.
    await waitFor(() => {
      expect(screen.getByTestId("month-count")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(listMonthFoldersSpy).toHaveBeenCalled();
    });
  });
});

describe("AuthGate — activity log wiring (Task 1 double-permission-prompt fix)", () => {
  beforeEach(() => {
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

  it("wires the activity log workspace for a session that survived a page reload, even though neither applySession() nor the demo-login effect ever runs", async () => {
    // Regression coverage for the reload-continuation gap: getInitialSession()
    // (via readRealSession()) can already return a real session on first
    // render -- before any explicit login happened -- so applySession() is
    // never called, and the demo-login effect's `!session` guard is false.
    // Only the session-gated effect (`if (!session) return;`) can wire the
    // activity log workspace in for this path.
    const persistedSession: AuthSession = {
      role: "employee",
      username: NON_SEED_USERNAME,
      loginAt: new Date().toISOString(),
    };
    vi.spyOn(authSession, "readRealSession").mockReturnValue(persistedSession);
    const handle = mockReadyWorkspace("reload-continuation-wires-activity-log", [NON_SEED_USERNAME]);
    const configureSpy = vi.spyOn(authActivityLog, "configureAuthActivityLogWorkspace");

    renderAuthGate();

    expect(screen.getByText("authenticated")).toBeInTheDocument();

    await waitFor(() => {
      expect(configureSpy).toHaveBeenCalledWith(handle);
    });
  });
});

describe("AuthGate — permission auto-refresh", () => {
  // 45s per §2 of the perf/sync spec (A7 commit 2), down from the old 3
  // minutes. As of that same change, this interval's callback ONLY calls
  // refreshPermissions() -- it no longer broadcasts dataRefreshSignal itself
  // (see SyncTick.tsx, rendered inside GlobalMonthProvider, for the granular
  // change-set-driven broadcast that replaced it; F17 explains why that
  // couldn't stay inside this same interval).
  const AUTO_REFRESH_INTERVAL_MS = 45_000;

  beforeEach(() => {
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

  it("schedules a 3-minute interval that re-syncs users/permissions from disk for a real session", async () => {
    vi.spyOn(authSession, "readRealSession").mockReturnValue({
      role: "employee",
      username: NON_SEED_USERNAME,
      loginAt: new Date().toISOString(),
    });
    mockReadyWorkspace("auto-refresh-real-session", [NON_SEED_USERNAME]);
    const setIntervalSpy = vi.spyOn(window, "setInterval");

    renderAuthGate();

    await waitFor(() => expect(mocks.loadWorkspaceFiles).toHaveBeenCalled());
    const callsAfterHydration = mocks.loadWorkspaceFiles.mock.calls.length;

    // The interval-registering effect depends on `workspaceStatus` flipping to
    // "ready", which lands in a render/effect pass after loadWorkspaceFiles is
    // merely invoked -- poll rather than asserting immediately, so this isn't
    // racy under load.
    let refreshCall: ReturnType<typeof setIntervalSpy.mock.calls.find>;
    await waitFor(() => {
      refreshCall = setIntervalSpy.mock.calls.find(
        (call) => call[1] === AUTO_REFRESH_INTERVAL_MS,
      );
      expect(refreshCall).toBeDefined();
    });

    // Fire the scheduled callback directly rather than racing real 45s
    // timers -- what matters here is that the interval this effect registers
    // actually triggers another disk read, not exactly when it fires.
    (refreshCall![0] as () => void)();

    await waitFor(() =>
      expect(mocks.loadWorkspaceFiles.mock.calls.length).toBeGreaterThan(callsAfterHydration),
    );
  });

  it("skips the periodic tick's work entirely while the tab is hidden", async () => {
    vi.spyOn(authSession, "readRealSession").mockReturnValue({
      role: "employee",
      username: NON_SEED_USERNAME,
      loginAt: new Date().toISOString(),
    });
    mockReadyWorkspace("auto-refresh-hidden-tab", [NON_SEED_USERNAME]);
    const setIntervalSpy = vi.spyOn(window, "setInterval");

    renderAuthGate();

    await waitFor(() => expect(mocks.loadWorkspaceFiles).toHaveBeenCalled());
    const callsAfterHydration = mocks.loadWorkspaceFiles.mock.calls.length;

    let refreshCall: ReturnType<typeof setIntervalSpy.mock.calls.find>;
    await waitFor(() => {
      refreshCall = setIntervalSpy.mock.calls.find(
        (call) => call[1] === AUTO_REFRESH_INTERVAL_MS,
      );
      expect(refreshCall).toBeDefined();
    });

    vi.spyOn(document, "hidden", "get").mockReturnValue(true);

    // Fire the scheduled callback directly while the tab is "hidden".
    (refreshCall![0] as () => void)();

    // Give any (incorrect) refresh a chance to fire before asserting it didn't.
    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.loadWorkspaceFiles.mock.calls.length).toBe(callsAfterHydration);
  });

  it("does not schedule an auto-refresh for a demo/viewer session", async () => {
    vi.spyOn(authSession, "readRealSession").mockReturnValue({
      role: "admin",
      username: VIEWER_USERNAME,
      loginAt: new Date().toISOString(),
      mode: "demo",
    });
    mockReadyWorkspace("auto-refresh-demo-skipped", [NON_SEED_USERNAME]);
    const setIntervalSpy = vi.spyOn(window, "setInterval");

    renderAuthGate();

    await waitFor(() => expect(screen.getByText("authenticated")).toBeInTheDocument());

    const refreshCall = setIntervalSpy.mock.calls.find(
      (call) => call[1] === AUTO_REFRESH_INTERVAL_MS,
    );
    expect(refreshCall).toBeUndefined();
  });
});
