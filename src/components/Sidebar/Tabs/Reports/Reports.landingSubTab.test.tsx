/* @vitest-environment jsdom */
// T-15a regression: the Reports tab landed on a hard-coded sub-view regardless
// of the permission matrix.
//
// `reports/reports`, `reports/kpi` and `reports/report-designer` are three
// independent matrix rows under one parent page, so "this role gets the KPI
// dashboard but not the report centre" is an ordinary configuration an admin can
// set from User Management. The tab nonetheless opened on the report centre every
// time, leaving such a role staring at the one sub-view its own matrix row denies
// until it noticed the sidebar link for the sub-tab it was actually granted.
//
// The shipped default matrix grants every one of these rows to every role that
// can open the page at all (manager + admin), so the "full permission" case below
// pins that nothing changed for a stock workspace.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { createMemoryDirectory } from "../../../../data/storage/memoryDirectory";
import { getLabels } from "../../../../data/labels/labelsStore";

const permissionsMock = vi.hoisted(() => ({
  // Sub-tab ids the role may view. Everything else is denied.
  allowed: new Set<string>(),
}));

vi.mock("../../../../auth/usePermissions", () => ({
  usePermissions: () => ({
    can: () => true,
    canMutate: () => true,
    getMutationCapability: () => ({ allowed: true, reason: null }),
    canAccessTab: (tabId: string) => permissionsMock.allowed.has(tabId),
  }),
}));

// The designer is a heavy lazy tab with its own storage reads; this suite only
// needs to know WHICH sub-view the tab landed on.
vi.mock("../ReportDesigner", () => ({
  default: () => <div data-testid="report-designer" />,
}));

const workspaceMock = vi.hoisted(() => ({ state: { directoryHandle: null as unknown } }));

vi.mock("../../../../data/workspace/useWorkspace", () => ({
  useWorkspace: () => ({ directoryHandle: workspaceMock.state.directoryHandle, status: "ready" }),
}));

vi.mock("../../../../data/month/useGlobalMonth", () => ({
  useGlobalMonth: () => ({
    months: [{ month: 4, year: 2026, folderName: "4-april-2026" }],
    selection: { kind: "existing", month: 4, year: 2026, folderName: "4-april-2026" },
    isSelectedMonthClosed: false,
    setSelectedMonth: () => true,
    startNewMonth: () => true,
    refreshMonths: async () => {},
    registerMonthChangeGuard: () => () => {},
  }),
}));

import ReportsTab from "./TabView";

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function renderWith(allowed: string[]) {
  permissionsMock.allowed = new Set(allowed);
  workspaceMock.state.directoryHandle = createMemoryDirectory("root");
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  return render(<ReportsTab />);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Reports — landing sub-tab follows the permission matrix", () => {
  it("lands on the report centre when the role may view it (shipped default, unchanged)", async () => {
    renderWith(["reports/reports", "reports/kpi", "reports/report-designer"]);
    const reportsNav = await screen.findByRole("tab", { name: "التقارير" });
    expect(reportsNav).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "مؤشرات" })).toHaveAttribute("aria-selected", "false");
  });

  it("lands on the KPI dashboard when the report centre is denied", async () => {
    renderWith(["reports/kpi", "reports/report-designer"]);
    // Before the fix this was the "التقارير" tab: the landing ignored the matrix.
    const kpiNav = await screen.findByRole("tab", { name: "مؤشرات" });
    expect(kpiNav).toHaveAttribute("aria-selected", "true");
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(getLabels().kpi_page_title)
    );
  });

  it("lands on the report designer when it is the only permitted sub-tab", async () => {
    renderWith(["reports/report-designer"]);
    expect(await screen.findByTestId("report-designer")).toBeInTheDocument();
    // ReportsContent stays mounted (hidden, not unmounted) — role queries skip
    // it exactly the way the user's eyes do.
    expect(screen.queryByRole("tab", { name: "التقارير" })).toBeNull();
  });

  it("still lands on the report centre when no sub-tab row grants anything", async () => {
    renderWith([]);
    const reportsNav = await screen.findByRole("tab", { name: "التقارير" });
    expect(reportsNav).toHaveAttribute("aria-selected", "true");
  });
});
