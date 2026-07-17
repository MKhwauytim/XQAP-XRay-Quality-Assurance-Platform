/* @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDefaultFeaturePermissions, createDefaultPermissions } from "../../../../auth/userManagement";
import { FeaturePermissionsSection, PagePermissionsSection } from "./PermissionSections";

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
});
