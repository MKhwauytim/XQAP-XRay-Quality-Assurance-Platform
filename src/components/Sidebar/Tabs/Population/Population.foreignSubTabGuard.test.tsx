/* @vitest-environment jsdom */
// Regression test for the "pop-set-subtab" origin guard.
//
// Sidebar.tsx dispatches the generic `pop-set-subtab` event on `window` for
// EVERY tab's sub-tab clicks, not just Population's, and App.tsx's tab-mount
// LRU keeps up to 3 tabs mounted (hidden, not unmounted) at a time -- so this
// tab's listener stays live while another tab is active and receives foreign
// sub-tab ids. Without a membership guard, `activeSubTab` took values outside
// its own `SubTab = "process" | "browse"` union (e.g. "kpi" from Reports),
// after which the render hides Browse AND returns null for Process at the same
// time, leaving the tab blank with no way back except re-clicking a sub-tab.
//
// The three sibling tabs (EmployeeWorkspace, Reports, UserManagement) all
// guard against their own known set; this pins the same behavior for
// Population.

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

// Mock the Vite worker import (unresolvable + unrunnable under Vitest).
vi.mock("../../../../workers/workbookWorker?worker&inline", () => ({
  default: class WorkerStub {
    onmessage: ((ev: MessageEvent) => void) | null = null;
    postMessage(): void {}
    terminate(): void {}
    addEventListener(): void {}
    removeEventListener(): void {}
  },
}));

vi.mock("../../../../data/workspace/useWorkspace", () => ({
  useWorkspace: () => ({ directoryHandle: null }),
}));

// Mirrors Population.browseMountPreservation.test.tsx: draw-sample and
// process-population are withheld so the tab lands on "process" rather than
// the A1 "browse" landing rule, giving a stable starting sub-tab to assert on.
vi.mock("../../../../auth/usePermissions", () => ({
  usePermissions: () => ({
    can: () => true,
    canMutate: (featureId: string) => featureId !== "draw-sample" && featureId !== "process-population",
  }),
}));

vi.mock("../../../../data/month/useGlobalMonth", () => ({
  useGlobalMonth: () => ({
    months: [],
    selection: { kind: "none" },
    isSelectedMonthClosed: false,
    setSelectedMonth: () => {},
    startNewMonth: () => {},
    refreshMonths: async () => {},
    registerMonthChangeGuard: () => () => {},
  }),
}));

vi.mock("./BrowseDataView", () => ({
  default: () => <div data-testid="view-browse" />,
}));

import PopulationTab from "./index";

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function dispatchSubTab(subTabId: string) {
  act(() => {
    window.dispatchEvent(new CustomEvent("pop-set-subtab", { detail: { subTabId } }));
  });
}

describe("PopulationTab pop-set-subtab origin guard", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it.each(["kpi", "report-designer", "users", "ew/xray-referrals", ""])(
    "ignores the foreign sub-tab id %j and keeps the current view rendered",
    (foreignId) => {
      vi.stubGlobal("ResizeObserver", ResizeObserverStub);
      const { container } = render(<PopulationTab />);

      // Baseline: the process view is what is on screen.
      const before = container.innerHTML;
      expect(before.length).toBeGreaterThan(0);

      dispatchSubTab(foreignId);

      // The tab must not go blank: content is unchanged, and Browse -- which
      // was never visited -- must still not be mounted.
      expect(container.innerHTML).toBe(before);
      expect(screen.queryByTestId("view-browse")).not.toBeInTheDocument();
    }
  );

  it("still honours its own known sub-tab ids", () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    render(<PopulationTab />);

    dispatchSubTab("browse");
    expect(screen.getByTestId("view-browse")).toBeInTheDocument();

    // A foreign id arriving while Browse is active must not blank it either.
    dispatchSubTab("kpi");
    expect(screen.getByTestId("view-browse")).toBeInTheDocument();
    expect(screen.getByTestId("view-browse").parentElement).not.toHaveAttribute("hidden");
  });
});
