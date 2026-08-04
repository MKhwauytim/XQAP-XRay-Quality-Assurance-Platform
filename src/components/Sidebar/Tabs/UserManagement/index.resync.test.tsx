/* @vitest-environment jsdom */
// Regression test for the "UserManagementTab never re-syncs after
// refreshPermissions()" finding (2026-08-01 audit-follow-up fix).
//
// UserManagementTab used to seed its local `state` once via
// `useState(() => readUserManagementState())` and never subscribed to
// `subscribeToUserManagementChanges` -- unlike App.tsx, usePermissions.ts,
// NotificationManager.tsx, and WorkspaceGate.tsx, which all do. So when
// refreshPermissions() (manual toolbar button or the 5-minute AuthGate
// auto-refresh) picked up a concurrent admin's disk change and pushed it into
// the shared runtime user-management state, this tab's own `state` stayed
// frozen at its mount-time snapshot. The next edit made here (`persistState`)
// spread that stale snapshot and wrote it wholesale via
// `syncUserManagementToDisk`, silently reverting the other admin's concurrent
// change with no conflict indication.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import type { DirectoryHandleLike } from "../../../../data/storage/fileSystemAccess";
import { clearSession, writeSession } from "../../../../auth/authSession";
import {
  createEmptyUserManagementState,
  writeUserManagementState,
  type UserManagementState,
} from "../../../../auth/userManagement";
import { syncUserManagementToDisk } from "../../../../data/workspace/userSync";
import UserManagementTab from "./index";

vi.mock("../../../../data/workspace/userSync", () => ({
  syncUserManagementToDisk: vi.fn().mockResolvedValue(undefined),
}));

// usePermissions()/saveUsersToDisk only need a truthy directoryHandle here --
// "manage-users" is a browser-persisted feature (FEATURE_MUTATION_STORAGE_LOOKUP),
// so canMutate does not gate on workspace `status`.
vi.mock("../../../../data/workspace/useWorkspace", () => ({
  useWorkspace: () => ({ directoryHandle: {} as DirectoryHandleLike, status: "ready" }),
}));

const syncMock = vi.mocked(syncUserManagementToDisk);

afterEach(() => {
  cleanup();
  clearSession();
  syncMock.mockClear();
});

describe("UserManagementTab re-syncs with the shared runtime user-management state", () => {
  it("incorporates a concurrent disk-refreshed user before writing its own edit, instead of silently dropping it", async () => {
    writeSession({ role: "admin", username: "admin", loginAt: new Date().toISOString() });

    const baseState = createEmptyUserManagementState();
    const [firstUser] = baseState.users;
    const seedState: UserManagementState = { ...baseState, users: [firstUser] };
    writeUserManagementState(seedState, false);

    render(<UserManagementTab />);

    // UserManagementTab's default export is now `lazy(() => import("./TabView"))`
    // (N2 tab-level code splitting) -- the first render always suspends (no
    // Suspense ancestor here, mirroring ReportDesigner/TemplateBuilder's own
    // isolated component tests), so wait for the lazy chunk to resolve before
    // the first assertion.
    expect(await screen.findByDisplayValue(firstUser.displayName)).toBeInTheDocument();

    // Simulate refreshPermissions() (manual refresh button / AuthGate's
    // 5-minute auto-refresh) picking up another admin's concurrent disk
    // change: a second managed user now exists, pushed into the shared
    // runtime state with notify=true (exactly what syncUsersFromDisk does).
    const concurrentUser = {
      ...firstUser,
      id: "concurrent-user",
      username: "concurrentadmin",
      displayName: "مستخدم مضاف من مشرف آخر",
    };
    act(() => {
      writeUserManagementState({ ...seedState, users: [firstUser, concurrentUser] }, true);
    });

    await waitFor(() =>
      expect(screen.getByDisplayValue(concurrentUser.displayName)).toBeInTheDocument()
    );

    // Now make a local edit on the originally-seeded user (toggle active
    // status) -- this must write BOTH users, not just the stale one-user
    // snapshot captured at mount.
    const row = screen.getByDisplayValue(firstUser.displayName).closest(".um-user-row");
    expect(row).not.toBeNull();
    const activeToggle = within(row as HTMLElement).getByRole("checkbox", { name: "نشط" });
    fireEvent.click(activeToggle);

    await waitFor(() => expect(syncMock).toHaveBeenCalled());
    const [, writtenState] = syncMock.mock.calls.at(-1)!;
    expect(writtenState.users.map((u) => u.id)).toEqual(
      expect.arrayContaining([firstUser.id, "concurrent-user"])
    );
  });
});
