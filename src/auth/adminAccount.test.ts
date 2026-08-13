/* @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from "vitest";

import { BOOTSTRAP_ADMIN_PASSWORD_HASH } from "./authConfig";
import { verifyPasswordHash } from "./passwordCrypto";
import {
  createDefaultManagedUsers,
  createEmptyUserManagementState,
  normalizeUserManagementState,
  readAdminAccount,
  resolveAdminPasswordHash,
  syncUsersFromDisk,
  updateAdminAccount,
  writeUserManagementState,
} from "./userManagement";

beforeEach(() => {
  writeUserManagementState(createEmptyUserManagementState(), false);
});

describe("shipped default passwords", () => {
  it("every seeded user's password is 123", async () => {
    const users = createDefaultManagedUsers();
    expect(users.length).toBeGreaterThan(0);
    for (const user of users) {
      expect(await verifyPasswordHash("123", user.passwordHash)).toBe(true);
    }
  });

  it("the bootstrap admin's default passcode is admin", async () => {
    expect(await verifyPasswordHash("admin", BOOTSTRAP_ADMIN_PASSWORD_HASH)).toBe(true);
    expect(await verifyPasswordHash("not-admin", BOOTSTRAP_ADMIN_PASSWORD_HASH)).toBe(false);
  });
});

describe("admin account settings", () => {
  it("defaults to the shipped hash and to admin-username sign-in enabled", () => {
    expect(readAdminAccount().passwordHash).toBeNull();
    expect(readAdminAccount().allowUsernameLogin).toBe(true);
    expect(resolveAdminPasswordHash()).toEqual(BOOTSTRAP_ADMIN_PASSWORD_HASH);
  });

  it("a stored passcode overrides the shipped default", async () => {
    const passwordHash = { algorithm: "argon2id" as const, encoded: "replaced" };
    const next = updateAdminAccount({ passwordHash }, "admin");

    expect(next.adminAccount.passwordHash).toEqual(passwordHash);
    expect(next.adminAccount.updatedBy).toBe("admin");
    expect(resolveAdminPasswordHash()).toEqual(passwordHash);
  });

  it("username sign-in can be turned off without touching the passcode", () => {
    updateAdminAccount({ allowUsernameLogin: false }, "admin");

    expect(readAdminAccount().allowUsernameLogin).toBe(false);
    expect(resolveAdminPasswordHash()).toEqual(BOOTSTRAP_ADMIN_PASSWORD_HASH);
  });

  it("falls back to defaults for a state object with no adminAccount block", () => {
    const legacy = createEmptyUserManagementState();
    const withoutAdminAccount = {
      users: legacy.users,
      permissions: legacy.permissions,
      featurePermissions: legacy.featurePermissions,
    };

    const normalized = normalizeUserManagementState(withoutAdminAccount);

    expect(normalized.adminAccount).toEqual({
      passwordHash: null,
      allowUsernameLogin: true,
      updatedAt: null,
      updatedBy: null,
    });
  });

  it("keeps the disk copy when a workspace carries one", () => {
    const stored = {
      passwordHash: { algorithm: "argon2id" as const, encoded: "from-disk" },
      allowUsernameLogin: false,
      updatedAt: "2026-08-13T00:00:00.000Z",
      updatedBy: "admin",
    };

    syncUsersFromDisk(createDefaultManagedUsers(), undefined, undefined, stored);

    expect(readAdminAccount()).toEqual(stored);
    expect(resolveAdminPasswordHash()).toEqual(stored.passwordHash);
  });

  it("restores defaults for a workspace written before the block existed", () => {
    updateAdminAccount({ allowUsernameLogin: false }, "admin");

    syncUsersFromDisk(createDefaultManagedUsers());

    expect(readAdminAccount().allowUsernameLogin).toBe(true);
    expect(readAdminAccount().passwordHash).toBeNull();
  });
});
