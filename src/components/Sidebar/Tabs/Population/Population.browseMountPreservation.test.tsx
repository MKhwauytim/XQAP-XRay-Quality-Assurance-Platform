/* @vitest-environment jsdom */
// Final-review finding 1 (Plan4 Task 5 follow-up) — regression test for the
// Browse sub-tab's mount-preservation behavior, mirroring
// EmployeeWorkspace/index.test.tsx's pattern (§T). BrowseDataView owns its
// own uncontained data-load effect (no "already loaded" guard), so it must
// mount exactly once and stay mounted (hidden, not remounted) across a
// switch-away-and-back cycle -- a fresh element reference on every
// PopulationTab re-render would otherwise re-invoke BrowseDataView's render
// function (and re-trigger its load effect) despite being hidden, since
// React only bails out of re-rendering a child when it receives the
// IDENTICAL element reference.

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

// No workspace selected -- BrowseDataView is mocked below so its own
// directoryHandle handling is moot for this test.
vi.mock("../../../../data/workspace/useWorkspace", () => ({
  useWorkspace: () => ({ directoryHandle: null }),
}));

// Grant every feature so no permission gate hides the Browse sub-tab. Excludes
// draw-sample/process-population specifically: A1 (perf/sync enhancement
// 2026-08-12) now lands on "browse" by default when both view-browse AND
// (draw-sample OR process-population) hold, which would make this suite's
// "never mounts Browse until the user visits it" assertion false from the
// very first render — unrelated to what this suite actually tests (mount
// preservation across a switch-away-and-back), so the landing rule is kept
// off here and exercised separately in Population.landingSubTab.test.tsx.
vi.mock("../../../../auth/usePermissions", () => ({
  usePermissions: () => ({
    can: () => true,
    canMutate: (featureId: string) => featureId !== "draw-sample" && featureId !== "process-population",
  }),
}));

// Global month context: no workspace in this test -- selection none, no months.
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

const mountCounts = vi.hoisted(() => ({ browse: 0 }));

vi.mock("./BrowseDataView", () => ({
  default: () => {
    mountCounts.browse += 1;
    return <div data-testid="view-browse" />;
  },
}));

import PopulationTab from "./index";

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function switchTo(subTabId: string) {
  act(() => {
    window.dispatchEvent(new CustomEvent("pop-set-subtab", { detail: { subTabId } }));
  });
}

describe("PopulationTab Browse sub-tab mount preservation (§M/§T)", () => {
  afterEach(() => {
    cleanup();
    mountCounts.browse = 0;
    vi.unstubAllGlobals();
  });

  it("never mounts Browse until the user visits it", () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    render(<PopulationTab />);

    expect(mountCounts.browse).toBe(0);
    expect(screen.queryByTestId("view-browse")).not.toBeInTheDocument();
  });

  it("keeps BrowseDataView mounted exactly once across a switch-away-and-back", () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    render(<PopulationTab />);

    switchTo("browse");
    expect(mountCounts.browse).toBe(1);

    switchTo("process");
    expect(mountCounts.browse).toBe(1); // still mounted (hidden), not remounted

    switchTo("browse");
    expect(mountCounts.browse).toBe(1); // switching back does NOT remount it
  });

  it("hides an inactive but visited Browse sub-tab instead of unmounting it", () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    render(<PopulationTab />);

    switchTo("browse");
    switchTo("process");

    const browse = screen.getByTestId("view-browse").parentElement;
    expect(browse).toHaveAttribute("hidden");
  });
});
