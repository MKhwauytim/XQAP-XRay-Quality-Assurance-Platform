/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SidebarTabDefinition } from "./Tabs/tabTypes";
import Sidebar from "./Sidebar";

const tabs: SidebarTabDefinition[] = [
  {
    id: "population",
    label: "معالجة البيانات",
    order: 10,
    allowedRoles: ["admin"],
    icon: <span aria-hidden="true">P</span>,
    TabComponent: () => null,
  },
];

afterEach(cleanup);

function renderSidebar(isMobileOpen: boolean) {
  const onTabSelect = vi.fn();
  const onMobileClose = vi.fn();
  render(
    <Sidebar
      tabs={tabs}
      activeTabId="population"
      isCollapsed={false}
      isMobileOpen={isMobileOpen}
      onTabSelect={onTabSelect}
      onToggleCollapse={vi.fn()}
      onMobileClose={onMobileClose}
    />,
  );
  return { onTabSelect, onMobileClose };
}

describe("Sidebar accessibility", () => {
  it("is a named navigation landmark on desktop without adding a competing heading", () => {
    renderSidebar(false);
    expect(
      screen.getByRole("complementary", { name: "القائمة الجانبية" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "تبويبات النظام" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });

  it("becomes a modal dialog and closes with Escape on mobile", () => {
    const { onMobileClose } = renderSidebar(true);
    const dialog = screen.getByRole("dialog", { name: "القائمة الجانبية" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "إغلاق قائمة التنقل" }),
    );

    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onMobileClose).toHaveBeenCalledTimes(1);
  });

  it("selects a tab using its accessible name", () => {
    const { onTabSelect } = renderSidebar(false);
    const activeTab = screen.getByRole("button", { name: "معالجة البيانات" });
    expect(activeTab).toHaveAttribute("aria-current", "page");
    fireEvent.click(activeTab);
    expect(onTabSelect).toHaveBeenCalledWith("population");
  });
});
