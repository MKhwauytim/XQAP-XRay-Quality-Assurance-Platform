/* @vitest-environment jsdom */
// DEFECT 7 regression: the "process" sub-tab used to be rendered as
// `{activeSubTab !== "process" ? null : (<>…</>)}`, so every switch to Browse
// UNMOUNTED the whole wizard subtree — Phase 4's manual-assignment filters,
// and every draft field inside MappingSettingsModal, were destroyed. The
// modal's OPEN state lives in PopulationTab itself (`settingsModalMode`) and
// therefore survived, so the modal reopened blank on return.
//
// Browse already got the `hidden`-swap treatment (see
// Population.browseMountPreservation.test.tsx); this suite is its counterpart
// for the process side, plus the constraint that swap introduces: both dialogs
// in the process subtree render through ModalPortal, so `hidden` on their
// wrapper cannot hide them — their own open props must be scope-gated instead.

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

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

// Same shape as the Browse mount-preservation suite: every feature granted
// except draw-sample/process-population, so the landing sub-tab is "process"
// (see the A1 landing rule in index.tsx) — which is what this suite needs.
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

function switchTo(subTabId: string) {
  act(() => {
    window.dispatchEvent(new CustomEvent("pop-set-subtab", { detail: { subTabId } }));
  });
}

/** The custom-field code-name input inside MappingSettingsModal — pure local
 *  draft state (`newFieldName` in useMappingSettingsController), never
 *  persisted, so it is exactly the state a remount destroys. */
function draftInput(): HTMLInputElement | null {
  return screen.queryByPlaceholderText("inspectionLocation") as HTMLInputElement | null;
}

describe("PopulationTab process sub-tab mount preservation (DEFECT 7)", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("preserves an open settings modal's unsaved draft across a switch to Browse and back", () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    render(<PopulationTab />);

    fireEvent.click(screen.getByLabelText("فتح إعدادات الربط والتصدير"));
    const input = draftInput();
    expect(input).not.toBeNull();
    fireEvent.change(input!, { target: { value: "inspectionSite" } });
    expect(draftInput()!.value).toBe("inspectionSite");

    switchTo("browse");
    switchTo("process");

    // Previously: the whole process subtree unmounted on the way to Browse, so
    // the modal came back open (settingsModalMode survives in PopulationTab)
    // but blank.
    expect(draftInput()).not.toBeNull();
    expect(draftInput()!.value).toBe("inspectionSite");
  });

  it("hides the portalled settings modal while Browse is the active sub-tab", () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    render(<PopulationTab />);

    fireEvent.click(screen.getByLabelText("فتح إعدادات الربط والتصدير"));
    expect(draftInput()).not.toBeNull();

    switchTo("browse");

    // ModalPortal renders to document.body, so a `hidden` attribute on the
    // process wrapper cannot hide this dialog — it must be closed by scope.
    expect(draftInput()).toBeNull();
    expect(screen.getByTestId("view-browse")).toBeInTheDocument();
  });

  it("hides the inactive process subtree instead of unmounting it", () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    render(<PopulationTab />);

    const header = screen.getByLabelText("فتح إعدادات الربط والتصدير");
    switchTo("browse");

    expect(header).toBeInTheDocument();
    expect(header.closest("[hidden]")).not.toBeNull();
  });
});
