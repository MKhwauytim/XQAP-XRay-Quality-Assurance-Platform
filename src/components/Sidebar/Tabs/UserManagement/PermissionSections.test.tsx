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

  it("renders إدارة المستخدمين as a real, settable control for every role but guest", () => {
    // Ceiling widened from ADMIN_ONLY (2026-08-25): an admin-only cap made this
    // entire section -- parent and all 5 sub-tabs -- a dead SYSTEM_RESTRICTED block,
    // since admin is never a column in this matrix (MANAGED_ROLES excludes it). It
    // is now every operational role, matching the population/adhoc-import precedent;
    // `guest` alone keeps the notice, as the read-only observer role.
    const onUpdate = vi.fn();
    // Grant the parent page to every non-admin role so the 5 sub-tab rows aren't
    // ALSO showing the separate, recoverable parentBlocked cascade -- this test is
    // only about the ceiling (ADMIN_ONLY -> OPERATIONAL_ROLES), not the cascade.
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
      "user-management/actions",
    ]) {
      for (const [roleLabel, role] of [
        ["موظف", "employee"],
        ["مشرف", "supervisor"],
        ["مدير", "manager"],
      ] as const) {
        const button = screen.getByRole("button", { name: `${roleLabel}: ${tabId} - لا وصول` });
        expect(button, `${role}:${tabId}`).toBeEnabled();
      }
      expect(screen.queryByRole("button", { name: new RegExp(`^ضيف: ${tabId} `) })).toBeNull();
    }
    fireEvent.click(screen.getByRole("button", { name: "مدير: user-management - تعديل كامل" }));
    expect(onUpdate).toHaveBeenLastCalledWith("manager", "user-management", "edit");
  });

  it("renders ارفاق حالات استثنائية as a real, settable control for every role but guest", () => {
    // The ceiling on `population/adhoc-import` used to be ADMIN_ONLY, which made the
    // whole row a dead SYSTEM_RESTRICTED notice: an admin had no way to grant the page
    // to anyone. It is now every operational role, so the cells must be actual
    // segmented controls -- `guest` alone keeps the notice, deliberately.
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
    // guest is the read-only observer role: the page only ingests rows and assigns
    // work, so its ceiling still excludes it and the cell stays a notice.
    expect(
      screen.queryByRole("button", { name: /^ضيف: population\/adhoc-import/ })
    ).toBeNull();
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

  it("marks user-management-backed features as system-restricted for guest only, now that settings is wide open too", () => {
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
    // settings.adminAccount (audit finding 13) all live on `settings`, whose
    // ceiling was widened from ["guest", "admin"] to every role on 2026-08-27
    // (the owner reported it as ungrantable, same bug pattern as #109) -- none
    // of the four settings features are system-restricted for anyone any more.
    // manage-users, reset-passwords and edit-permissions live on
    // `user-management`, whose ceiling was widened from ADMIN_ONLY to every
    // operational role on 2026-08-25 -- only guest is still permanently
    // excluded there.
    const notices = screen.getAllByText(SYSTEM_RESTRICTED_LABEL);
    // 3 user-management features x 1 role (guest). Settings contributes zero now.
    expect(notices).toHaveLength(3);
    // Every role keeps a real toggle for the settings features -- the ceiling
    // allows all of them now.
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
