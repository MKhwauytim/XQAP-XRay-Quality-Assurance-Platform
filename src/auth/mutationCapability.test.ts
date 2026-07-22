import { describe, expect, it } from "vitest";
import {
  createDefaultFeaturePermissions,
  createDefaultPermissions,
} from "./userManagement";
import { getMutationCapability } from "./mutationCapability";

const permissions = createDefaultPermissions();
const featurePermissions = createDefaultFeaturePermissions();

describe("getMutationCapability", () => {
  it("denies an enabled feature when the parent page is view-only", () => {
    expect(
      getMutationCapability({
        role: "supervisor",
        featureId: "bulk-assign",
        permissions,
        featurePermissions,
        isReadOnly: false,
        workspaceReady: true,
      })
    ).toEqual({ allowed: false, reason: "page-not-editable" });
  });

  it("allows an enabled feature on an editable page", () => {
    expect(
      getMutationCapability({
        role: "manager",
        featureId: "bulk-assign",
        permissions,
        featurePermissions,
        isReadOnly: false,
        workspaceReady: true,
      })
    ).toEqual({ allowed: true, reason: null });
  });

  it("denies mutation in demo/read-only mode even for an admin", () => {
    expect(
      getMutationCapability({
        role: "admin",
        featureId: "edit-interface-labels",
        permissions,
        featurePermissions,
        isReadOnly: true,
        workspaceReady: true,
      })
    ).toEqual({ allowed: false, reason: "read-only-mode" });
  });

  it("denies a disabled feature on an editable page", () => {
    const disabled = featurePermissions.map((permission) =>
      permission.role === "manager" && permission.featureId === "bulk-assign"
        ? { ...permission, enabled: false }
        : permission
    );

    expect(
      getMutationCapability({
        role: "manager",
        featureId: "bulk-assign",
        permissions,
        featurePermissions: disabled,
        isReadOnly: false,
        workspaceReady: true,
      })
    ).toEqual({ allowed: false, reason: "feature-disabled" });
  });

  it("fails closed for an unregistered feature", () => {
    expect(
      getMutationCapability({
        role: "admin",
        featureId: "missing-feature",
        permissions,
        featurePermissions,
        isReadOnly: false,
        workspaceReady: true,
      })
    ).toEqual({ allowed: false, reason: "unknown-feature" });
  });

  it("allows archive maintenance only for an editable, writable manager", () => {
    expect(
      getMutationCapability({
        role: "manager",
        featureId: "archive.createBackup",
        permissions,
        featurePermissions,
        isReadOnly: false,
        workspaceReady: true,
      })
    ).toEqual({ allowed: true, reason: null });

    expect(
      getMutationCapability({
        role: "supervisor",
        featureId: "archive.createBackup",
        permissions,
        featurePermissions,
        isReadOnly: false,
        workspaceReady: true,
      })
    ).toEqual({ allowed: false, reason: "page-not-editable" });
  });

  it("blocks report design in read-only mode", () => {
    expect(
      getMutationCapability({
        role: "manager",
        featureId: "report-designer.edit",
        permissions,
        featurePermissions,
        isReadOnly: true,
        workspaceReady: true,
      })
    ).toEqual({ allowed: false, reason: "read-only-mode" });
  });

  it("denies workspace-backed commands when no ready directory is mounted", () => {
    expect(
      getMutationCapability({
        role: "manager",
        featureId: "bulk-assign",
        permissions,
        featurePermissions,
        isReadOnly: false,
        workspaceReady: false,
      }),
    ).toEqual({ allowed: false, reason: "workspace-unavailable" });
  });

  it("keeps browser-backed administration available without a disk workspace", () => {
    expect(
      getMutationCapability({
        role: "admin",
        featureId: "manage-users",
        permissions,
        featurePermissions,
        isReadOnly: false,
        workspaceReady: false,
      }),
    ).toEqual({ allowed: true, reason: null });
  });

  // B1 (task 2): post-notification must cascade against ew/notifications, not
  // employee-workspace -- otherwise a role with employee-workspace edit access
  // but no access to ew/notifications could be authorized to post.
  it("allows post-notification for a manager with default permissions", () => {
    expect(
      getMutationCapability({
        role: "manager",
        featureId: "post-notification",
        permissions,
        featurePermissions,
        isReadOnly: false,
        workspaceReady: true,
      })
    ).toEqual({ allowed: true, reason: null });
  });

  it("denies post-notification when ew/notifications is blocked, even though employee-workspace stays editable (C2 regression)", () => {
    const scopedPermissions = permissions.map((p) =>
      p.role === "manager" && p.tabId === "ew/notifications"
        ? { ...p, access: "none" as const }
        : p
    );
    // Sanity: employee-workspace is untouched -- if the cascade were still wired
    // to the old (wrong) tab, this scenario would incorrectly allow the mutation.
    expect(
      scopedPermissions.find((p) => p.role === "manager" && p.tabId === "employee-workspace")?.access
    ).toBe("edit");

    expect(
      getMutationCapability({
        role: "manager",
        featureId: "post-notification",
        permissions: scopedPermissions,
        featurePermissions,
        isReadOnly: false,
        workspaceReady: true,
      })
    ).toEqual({ allowed: false, reason: "page-not-editable" });
  });
});
