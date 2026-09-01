/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDefaultFeaturePermissions, createDefaultPermissions } from "../../../../auth/userManagement";
import {
  FeaturePermissionsSection,
  PagePermissionsSection,
  PARENT_PAGE_REQUIRED_LABEL,
  SYSTEM_RESTRICTED_LABEL,
} from "./PermissionSections";

afterEach(cleanup);

describe("user-management permission sections", () => {
  it("keeps every page permission control read-only when matrix editing is denied", () => {
    render(
      <PagePermissionsSection
        permissions={createDefaultPermissions()}
        collapsedParents={new Set()}
        canEdit={false}
        onToggleParent={vi.fn()}
        onUpdate={vi.fn()}
      />
    );

    expect(screen.getByText("الصفحة / التبويب")).toBeInTheDocument();
    for (const button of screen.getAllByRole("button", { name: /population/ })) {
      expect(button).toBeDisabled();
    }
  });

  it("preserves explicit parent-page cascade blocking for feature toggles", () => {
    const permissions = createDefaultPermissions().map((permission) =>
      permission.role === "employee" && permission.tabId === "population"
        ? { ...permission, access: "none" as const }
        : permission
    );
    render(
      <FeaturePermissionsSection
        permissions={permissions}
        featurePermissions={createDefaultFeaturePermissions()}
        featureGroup="population"
        canEdit
        onGroupChange={vi.fn()}
        onUpdate={vi.fn()}
      />
    );

    const cascadeToggles = screen.getAllByTitle("يتطلب تفعيل صلاحية الصفحة أولاً");
    expect(cascadeToggles.length).toBeGreaterThan(0);
    const checkbox = cascadeToggles[0].querySelector("input");
    expect(checkbox).toBeDisabled();
  });

  it("renders إدارة المستخدمين as a real, settable control for every role, guest included", () => {
    // Ceiling widened ADMIN_ONLY -> OPERATIONAL_ROLES (2026-08-25, parent + all
    // sub-tabs) -> ALL_ROLES (2026-08-30, guest included): no code ceiling should
    // be the reason a "مقيّد بالنظام" cell shows up in this matrix any more.
    const onUpdate = vi.fn();
    // Grant the parent page to every non-admin role so the sub-tab rows aren't
    // ALSO showing the separate, recoverable parentBlocked cascade -- this test is
    // only about the ceiling, not the cascade.
    const permissions = createDefaultPermissions().map((permission) =>
      permission.tabId === "user-management" && permission.role !== "admin"
        ? { ...permission, access: "edit" as const }
        : permission
    );
    render(
      <PagePermissionsSection
        permissions={permissions}
        collapsedParents={new Set()}
        canEdit
        onToggleParent={vi.fn()}
        onUpdate={onUpdate}
      />
    );

    for (const tabId of [
      "user-management",
      "user-management/users",
      "user-management/page-permissions",
      "user-management/feature-permissions",
      "user-management/activity",
      "user-management/performance",
    ]) {
      for (const [roleLabel, role] of [
        ["ضيف", "guest"],
        ["موظف", "employee"],
        ["مشرف", "supervisor"],
        ["مدير", "manager"],
      ] as const) {
        const button = screen.getByRole("button", { name: `${roleLabel}: ${tabId} - لا وصول` });
        expect(button, `${role}:${tabId}`).toBeEnabled();
      }
    }
    fireEvent.click(screen.getByRole("button", { name: "مدير: user-management - تعديل كامل" }));
    expect(onUpdate).toHaveBeenLastCalledWith("manager", "user-management", "edit");
  });

  it("renders ارفاق حالات استثنائية as a real, settable control for every role, guest included", () => {
    // The ceiling on `population/adhoc-import` used to be ADMIN_ONLY, which made the
    // whole row a dead SYSTEM_RESTRICTED notice: an admin had no way to grant the
    // page to anyone. It was widened to OPERATIONAL_ROLES (2026-08-21) and then to
    // ALL_ROLES (2026-08-30), so every cell -- guest included -- is now a real
    // segmented control.
    const onUpdate = vi.fn();
    render(
      <PagePermissionsSection
        permissions={createDefaultPermissions().map((permission) =>
          permission.tabId === "population" && permission.role !== "admin"
            ? { ...permission, access: "edit" as const }
            : permission
        )}
        collapsedParents={new Set()}
        canEdit
        onToggleParent={vi.fn()}
        onUpdate={onUpdate}
      />
    );

    expect(screen.getByText("ارفاق حالات استثنائية")).toBeInTheDocument();
    for (const [roleLabel, role] of [
      ["ضيف", "guest"],
      ["موظف", "employee"],
      ["مشرف", "supervisor"],
      ["مدير", "manager"],
    ] as const) {
      const button = screen.getByRole("button", {
        name: `${roleLabel}: population/adhoc-import - تعديل كامل`,
      });
      expect(button, role).toBeEnabled();
      fireEvent.click(button);
      expect(onUpdate).toHaveBeenLastCalledWith(role, "population/adhoc-import", "edit");
    }
  });

  it("renders reports and archive as live, settable controls for employees", () => {
    const onUpdate = vi.fn();
    render(
      <PagePermissionsSection
        permissions={createDefaultPermissions()}
        collapsedParents={new Set()}
        canEdit
        onToggleParent={vi.fn()}
        onUpdate={onUpdate}
      />
    );

    for (const tabId of ["reports", "archive"]) {
      const button = screen.getByRole("button", { name: `موظف: ${tabId} - تعديل كامل` });
      expect(button).toBeEnabled();
      fireEvent.click(button);
    }
    expect(onUpdate).toHaveBeenNthCalledWith(1, "employee", "reports", "edit");
    expect(onUpdate).toHaveBeenNthCalledWith(2, "employee", "archive", "edit");
  });

  it("disables a sub-tab cell whose parent page is not granted, and enables it once the parent is", () => {
    // guest has employee-workspace = "none" by default, so every ew/* grant for guest
    // would be inert (App.tsx filters the parent tab before its sub-tabs).
    const { unmount } = render(
      <PagePermissionsSection
        permissions={createDefaultPermissions()}
        collapsedParents={new Set()}
        canEdit
        onToggleParent={vi.fn()}
        onUpdate={vi.fn()}
      />
    );
    const guestSubTab = screen.getByRole("button", { name: "ضيف: ew/xray-referrals - عرض فقط" });
    expect(guestSubTab).toBeDisabled();
    expect(guestSubTab).toHaveAttribute("title", PARENT_PAGE_REQUIRED_LABEL);
    unmount();

    const withParent = createDefaultPermissions().map((permission) =>
      permission.role === "guest" && permission.tabId === "employee-workspace"
        ? { ...permission, access: "view" as const }
        : permission
    );
    render(
      <PagePermissionsSection
        permissions={withParent}
        collapsedParents={new Set()}
        canEdit
        onToggleParent={vi.fn()}
        onUpdate={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: "ضيف: ew/xray-referrals - عرض فقط" })).toBeEnabled();
  });

  it("cascade-blocks a feature toggle when the parent page is granted only 'view', not just 'none'", () => {
    // getMutationCapability requires the parent page's access to be exactly "edit"
    // (view-only pages can never authorize a mutation), so a feature toggle left
    // enabled for a "view" page is just as inert as one left enabled for "none".
    // Grant every non-admin role "edit" on population except employee, who gets
    // "view" -- the one case the old `=== "none"` comparison missed.
    const permissions = createDefaultPermissions().map((permission) => {
      if (permission.tabId !== "population") return permission;
      if (permission.role === "employee") return { ...permission, access: "view" as const };
      if (permission.role === "admin") return permission;
      return { ...permission, access: "edit" as const };
    });
    render(
      <FeaturePermissionsSection
        permissions={permissions}
        featurePermissions={createDefaultFeaturePermissions()}
        featureGroup="population"
        canEdit
        onGroupChange={vi.fn()}
        onUpdate={vi.fn()}
      />
    );

    const cascadeToggles = screen.getAllByTitle("يتطلب تفعيل صلاحية الصفحة أولاً");
    expect(cascadeToggles.length).toBeGreaterThan(0);
    const checkbox = cascadeToggles[0].querySelector("input");
    expect(checkbox).toBeDisabled();
  });

  it("leaves no feature system-restricted for any role, now that every ceiling is wide open", () => {
    render(
      <FeaturePermissionsSection
        permissions={createDefaultPermissions()}
        featurePermissions={createDefaultFeaturePermissions()}
        featureGroup="admin"
        canEdit
        onGroupChange={vi.fn()}
        onUpdate={vi.fn()}
      />
    );

    // view-error-log, edit-interface-labels, settings.syncInterval, and
    // settings.adminAccount live on `settings` (widened to every role on
    // 2026-08-27); manage-users, reset-passwords and edit-permissions live on
    // `user-management` (widened ADMIN_ONLY -> OPERATIONAL_ROLES on 2026-08-25,
    // then to include guest on 2026-08-30, the last role any tab still excluded).
    // No code ceiling excludes any role from any tab any more, so this group has
    // zero SYSTEM_RESTRICTED_LABEL notices.
    expect(screen.queryByText(SYSTEM_RESTRICTED_LABEL)).toBeNull();
    // Every role keeps a real toggle for every feature in this group.
    expect(screen.getAllByRole("checkbox").length).toBeGreaterThan(0);
  });

  it("cascades the adhoc-import features off the population page after the 2026-08-21 move", () => {
    // Before the move these two features hung off their own admin-only
    // "adhoc-import" tab, so every managed-role cell was a permanent
    // SYSTEM_RESTRICTED notice. The importer is now the `population/adhoc-import`
    // SUB-TAB, and the features cascade off POPULATION -- a page no role is
    // ceiling-locked out of. So the cells become ordinary toggles: recoverable
    // "grant the page first" for roles without population edit, live for the ones
    // that have it. (The sub-tab's own ceiling now admits every role but guest, so
    // page grant + feature toggle is a grant an admin can actually complete.)
    render(
      <FeaturePermissionsSection
        permissions={createDefaultPermissions()}
        featurePermissions={createDefaultFeaturePermissions()}
        featureGroup="adhoc-import"
        canEdit
        onGroupChange={vi.fn()}
        onUpdate={vi.fn()}
      />
    );

    expect(screen.queryByText(SYSTEM_RESTRICTED_LABEL)).toBeNull();
    // 2 features x 4 managed roles.
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(8);
    // Shipped defaults: only manager holds population "edit", so only its two
    // cells are live -- and both start off, exactly as before the move.
    expect(checkboxes.filter((box) => !(box as HTMLInputElement).disabled)).toHaveLength(2);
    expect(checkboxes.some((box) => (box as HTMLInputElement).checked)).toBe(false);
    expect(screen.getAllByTitle("يتطلب تفعيل صلاحية الصفحة أولاً")).toHaveLength(6);
  });
});
