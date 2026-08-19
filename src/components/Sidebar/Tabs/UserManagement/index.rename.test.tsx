/* @vitest-environment jsdom */
// T-11 (2026-08-19): a username rename orphans every on-disk record keyed on
// the old username string (answers, mirrors, distribution events, quotas,
// referral/replacement requests, approvals, acknowledgements) — nothing
// migrates them. The tab therefore blocks the rename for a user with a
// workspace footprint, and fails closed when the footprint cannot be verified.
//
// Reviewer correction covered here: the display-name edit submitted through
// the SAME form is independent of the username (nothing on disk keys on it),
// so a rejected rename must still SAVE it rather than discard the admin's work.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import type { DirectoryHandleLike } from "../../../../data/storage/fileSystemAccess";
import { clearSession, writeSession } from "../../../../auth/authSession";
import {
  createEmptyUserManagementState,
  readUserManagementState,
  writeUserManagementState,
  type ManagedLoginUser,
  type UserManagementState,
} from "../../../../auth/userManagement";
import { getLabels } from "../../../../data/labels/labelsStore";
import type { UserWorkspaceFootprint } from "../../../../data/samples/sampleMirrorStorage";
import UserManagementTab from "./index";

const mocks = vi.hoisted(() => ({
  directoryHandle: null as unknown,
  footprint: {
    activeAssignments: [] as Array<{ monthFolderName: string; pendingCount: number }>,
    answerFileMonths: [] as string[],
  },
}));

vi.mock("../../../../data/workspace/userSync", () => ({
  syncUserManagementToDisk: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../../data/workspace/useWorkspace", () => ({
  useWorkspace: () => ({ directoryHandle: mocks.directoryHandle, status: "ready" }),
}));

vi.mock("../../../../data/samples/sampleMirrorStorage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../data/samples/sampleMirrorStorage")>()),
  getUserWorkspaceFootprint: async (): Promise<UserWorkspaceFootprint> =>
    mocks.footprint as UserWorkspaceFootprint,
}));

const TARGET: ManagedLoginUser = {
  id: "user-rename-target",
  username: "oldname",
  displayName: "الاسم القديم",
  role: "employee",
  passwordHash: { algorithm: "argon2id", encoded: "$argon2id$test" },
  isActive: true,
  hasCertScanLicense: false,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

function seedTab(): void {
  const base = createEmptyUserManagementState();
  const seed: UserManagementState = { ...base, users: [TARGET] };
  writeUserManagementState(seed, false);
}

beforeEach(() => {
  mocks.directoryHandle = {} as DirectoryHandleLike;
  mocks.footprint = { activeAssignments: [], answerFileMonths: [] };
  writeSession({ role: "admin", username: "admin", loginAt: new Date().toISOString() });
  seedTab();
});

afterEach(() => {
  cleanup();
  clearSession();
});

/** Renders the tab (lazy chunk) and returns the target user's row. */
async function renderRow(): Promise<HTMLElement> {
  render(<UserManagementTab />);
  const displayInput = await screen.findByDisplayValue(TARGET.displayName);
  await act(async () => {
    await Promise.resolve();
  });
  const row = displayInput.closest(".um-user-row");
  expect(row).not.toBeNull();
  return row as HTMLElement;
}

function editIdentity(row: HTMLElement, username: string, displayName: string): void {
  fireEvent.change(within(row).getByLabelText("اسم المستخدم"), { target: { value: username } });
  fireEvent.change(within(row).getByLabelText("الاسم الظاهر"), { target: { value: displayName } });
  fireEvent.click(within(row).getByRole("button", { name: "حفظ" }));
}

function savedUser(): ManagedLoginUser {
  const user = readUserManagementState().users.find((u) => u.id === TARGET.id);
  expect(user).toBeDefined();
  return user as ManagedLoginUser;
}

describe("UserManagementTab — username rename guard", () => {
  it("blocks the rename when the user has work on disk, but still saves the display-name edit submitted with it", async () => {
    mocks.footprint = {
      activeAssignments: [{ monthFolderName: "5-may-2026", pendingCount: 3 }],
      answerFileMonths: [],
    };
    const row = await renderRow();

    editIdentity(row, "newname", "الاسم الجديد");

    await waitFor(() =>
      expect(screen.getByText(getLabels().um_rename_blocked_footprint)).toBeInTheDocument()
    );
    expect(savedUser().username).toBe("oldname");
    expect(savedUser().displayName).toBe("الاسم الجديد");
  });

  it("blocks the rename when the user only has saved answers on disk", async () => {
    mocks.footprint = { activeAssignments: [], answerFileMonths: ["5-may-2026"] };
    const row = await renderRow();

    editIdentity(row, "newname", TARGET.displayName);

    await waitFor(() =>
      expect(screen.getByText(getLabels().um_rename_blocked_footprint)).toBeInTheDocument()
    );
    expect(savedUser().username).toBe("oldname");
  });

  it("allows the rename when the user has no footprint at all", async () => {
    const row = await renderRow();

    editIdentity(row, "newname", "الاسم الجديد");

    await waitFor(() => expect(savedUser().username).toBe("newname"));
    expect(savedUser().displayName).toBe("الاسم الجديد");
  });

  it("fails closed with no workspace mounted — the rename is refused, the display name is kept", async () => {
    mocks.directoryHandle = null;
    const row = await renderRow();

    editIdentity(row, "newname", "الاسم الجديد");

    await waitFor(() =>
      expect(screen.getByText(getLabels().um_rename_blocked_no_workspace)).toBeInTheDocument()
    );
    expect(savedUser().username).toBe("oldname");
    expect(savedUser().displayName).toBe("الاسم الجديد");
  });
});
