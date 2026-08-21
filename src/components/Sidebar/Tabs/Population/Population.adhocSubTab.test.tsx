/* @vitest-environment jsdom */
// The ad-hoc importer moved from a stand-alone top-level tab to Population's
// third sub-tab on 2026-08-21 (ADHOC_IMPORT_REWORK_PLAN_2026-08-21.md §4.9).
//
// Two things have to hold, and neither is obvious from reading the render:
//
//  1. Mount preservation is MANDATORY here, not an optimisation. The wizard
//     holds a parsed source table, a half-finished column mapping and a
//     partly-ticked review grid, none of which touches disk until the operator
//     saves. Unmounting it on a sub-tab switch would silently discard an
//     in-progress mapping -- the same class of bug DEFECT 7 fixed for Process.
//  2. The sub-tab's content is capability-gated exactly the way Browse is, so a
//     user who reaches it without either ad-hoc feature gets the established
//     "غير مصرح" placeholder rather than a blank panel.

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
  useWorkspace: () => ({ directoryHandle: null, status: "not_selected" }),
}));

const permissionsMock = vi.hoisted(() => ({ adhoc: true }));

// draw-sample/process-population are withheld so the tab lands on "process"
// (see Population.landingSubTab.test.tsx for the landing rule itself), giving a
// stable starting sub-tab to switch away from.
vi.mock("../../../../auth/usePermissions", () => ({
  usePermissions: () => ({
    can: (featureId: string) =>
      featureId.startsWith("adhoc-import.") ? permissionsMock.adhoc : true,
    canMutate: (featureId: string) =>
      featureId !== "draw-sample" && featureId !== "process-population",
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

const mountCounts = vi.hoisted(() => ({ adhoc: 0 }));

// The real wizard is exercised by AdhocImport/index.test.tsx; here only WHETHER
// and HOW OFTEN it mounts matters.
vi.mock("../AdhocImport", () => ({
  default: () => {
    mountCounts.adhoc += 1;
    return <div data-testid="view-adhoc" />;
  },
}));

import PopulationTab, { tabConfig } from "./index";

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

describe("PopulationTab ad-hoc import sub-tab", () => {
  afterEach(() => {
    cleanup();
    mountCounts.adhoc = 0;
    permissionsMock.adhoc = true;
    vi.unstubAllGlobals();
  });

  it("registers the sub-tab on the Population tab, after process and browse", () => {
    const subTabs = tabConfig?.subTabs ?? [];
    expect(subTabs.map((sub) => sub.id)).toEqual(["process", "browse", "adhoc-import"]);
    expect(subTabs.find((sub) => sub.id === "adhoc-import")?.label).toBe(
      "استيراد بيانات مخصص",
    );
  });

  it("never mounts the wizard until the user visits the sub-tab", () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    render(<PopulationTab />);

    expect(mountCounts.adhoc).toBe(0);
    expect(screen.queryByTestId("view-adhoc")).not.toBeInTheDocument();
  });

  it("keeps the wizard mounted exactly once across a switch-away-and-back", () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    render(<PopulationTab />);

    switchTo("adhoc-import");
    expect(mountCounts.adhoc).toBe(1);
    expect(screen.getByTestId("view-adhoc")).toBeInTheDocument();

    // Leaving must HIDE it, not unmount it: an in-progress mapping lives only in
    // this component's state until the operator saves.
    switchTo("browse");
    expect(mountCounts.adhoc).toBe(1);
    expect(screen.getByTestId("view-adhoc").parentElement).toHaveAttribute("hidden");

    switchTo("adhoc-import");
    expect(mountCounts.adhoc).toBe(1);
    expect(screen.getByTestId("view-adhoc").parentElement).not.toHaveAttribute("hidden");
  });

  it("renders the not-authorised placeholder, and never the wizard, without either ad-hoc feature", () => {
    permissionsMock.adhoc = false;
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    render(<PopulationTab />);

    switchTo("adhoc-import");

    expect(screen.queryByTestId("view-adhoc")).not.toBeInTheDocument();
    expect(mountCounts.adhoc).toBe(0);
    expect(screen.getByRole("heading", { name: "غير مصرح" })).toBeInTheDocument();
  });
});
