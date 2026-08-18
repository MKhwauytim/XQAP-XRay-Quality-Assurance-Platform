/* @vitest-environment jsdom */
// D1 (Batch 3) — characterization test for the Population wizard's four-phase progression
// (import → process → sample → distribute), rendered under Testing Library.
//
// WORKER BOUNDARY: driving a real import advances phases only after the Excel Web Worker
// (src/workers/workbookWorker.ts) posts results back — Vitest's node/jsdom env cannot run that
// DedicatedWorker. So the RENDERED test pins the initial happy state (phase 1 active, the full
// stepper) and the failure/gating behavior (locked downstream phases are not navigable — a bad or
// absent import cannot skip ahead), while the pure `getPhaseStatus` matrix pins the ordered
// unlock progression through all four phases. The worker + workspace hooks are mocked; the test
// file sits in the same directory as index.tsx, so these relative specifiers match Population's own.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

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

// No workspace selected → the wizard renders its initial (phase 1) state.
vi.mock("../../../../data/workspace/useWorkspace", () => ({
  useWorkspace: () => ({ directoryHandle: null }),
}));

// Grant every feature so no permission gate hides wizard controls. Excludes
// draw-sample/process-population so A1's landing rule (perf/sync enhancement
// 2026-08-12) keeps this suite on the "process" sub-tab, where the phase
// stepper this suite asserts on actually renders — see
// Population.browseMountPreservation.test.tsx's identical note.
vi.mock("../../../../auth/usePermissions", () => ({
  usePermissions: () => ({
    can: () => true,
    canMutate: (featureId: string) => featureId !== "draw-sample" && featureId !== "process-population",
  }),
}));

// Global month context: no workspace in this test → selection none, no months.
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

import PopulationTab from "./index";
import { getPhaseStatus } from "./components/helpers";

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// 2026-08 handoff §2: the standalone `.phase-stepper` became the step row of
// the readiness rail (`.pop-readiness-steps` / `.pop-readiness-step`). The
// gating rule is unchanged — what changed is that a locked step is now a real
// `<button disabled>` rather than a div with no `role`, so it stays announced
// to assistive tech while remaining unreachable by keyboard or pointer.
describe("Population wizard — rendered phase steps", () => {
  it("happy: renders the four phase steps with phase 1 (import) active", () => {
    const { container } = render(<PopulationTab />);
    const steps = container.querySelector(".pop-readiness-steps");
    expect(steps).not.toBeNull();

    const items = steps!.querySelectorAll(".pop-readiness-step");
    expect(items).toHaveLength(4);

    // Phase 1 (رفع البيانات = import) is the active step.
    expect(items[0].className).toContain("is-active");
    expect(items[0].getAttribute("aria-current")).toBe("step");

    // All four phase titles are present in order.
    expect(screen.getAllByText("رفع البيانات").length).toBeGreaterThan(0);
    expect(screen.getAllByText("تقرير البيانات والمعالجة").length).toBeGreaterThan(0);
    expect(screen.getAllByText("اختيار العينة").length).toBeGreaterThan(0);
    expect(screen.getAllByText("توزيع العينة").length).toBeGreaterThan(0);
  });

  it("failure/gating: downstream phases are locked and cannot be skipped to", () => {
    const { container } = render(<PopulationTab />);
    const steps = container.querySelector(".pop-readiness-steps")!;
    const items = steps.querySelectorAll(".pop-readiness-step");

    // Phases 2–4 are locked → really disabled, so neither click nor keyboard reaches them.
    for (const idx of [1, 2, 3]) {
      expect(items[idx].className).toContain("is-locked");
      expect(items[idx]).toBeDisabled();
    }

    // Clicking the locked "اختيار العينة" (sampling) step must NOT advance the wizard.
    fireEvent.click(items[2]);
    const activeAfter = container.querySelectorAll(".pop-readiness-step.is-active");
    expect(activeAfter).toHaveLength(1);
    // Still phase 1 (the first item), i.e. import remains the active phase.
    expect(container.querySelectorAll(".pop-readiness-step")[0]).toBe(activeAfter[0]);
  });
});

describe("Population wizard — phase progression logic (getPhaseStatus)", () => {
  it("start: only import is active, everything downstream is locked", () => {
    expect(getPhaseStatus(1, 1, [])).toBe("active");
    expect(getPhaseStatus(2, 1, [])).toBe("locked");
    expect(getPhaseStatus(3, 1, [])).toBe("locked");
    expect(getPhaseStatus(4, 1, [])).toBe("locked");
  });

  it("mid-run at sampling: import+process completed, sampling active, distribution locked", () => {
    expect(getPhaseStatus(1, 3, [1, 2])).toBe("completed");
    expect(getPhaseStatus(2, 3, [1, 2])).toBe("completed");
    expect(getPhaseStatus(3, 3, [1, 2])).toBe("active");
    expect(getPhaseStatus(4, 3, [1, 2])).toBe("locked");
  });

  it("full run at distribution: all prior completed, distribution active", () => {
    expect(getPhaseStatus(1, 4, [1, 2, 3])).toBe("completed");
    expect(getPhaseStatus(2, 4, [1, 2, 3])).toBe("completed");
    expect(getPhaseStatus(3, 4, [1, 2, 3])).toBe("completed");
    expect(getPhaseStatus(4, 4, [1, 2, 3])).toBe("active");
  });
});
