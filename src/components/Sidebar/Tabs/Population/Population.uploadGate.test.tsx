/* @vitest-environment jsdom */
// Audit finding 12: Phase 1's upload "disable" used to be CSS-only (a wrapper
// div's aria-disabled + pointer-events:none around FileUploadCard's buttons) and
// the handlers behind it (pickExcelFile / handleFallbackFileChange) only checked
// canUploadData, never the closed-month / month-loading flags folded into
// canUploadNow. The hidden fallback <input type="file"> that
// handleFallbackFileChange listens on is rendered OUTSIDE the wrapper's
// pointer-events:none scope entirely, so it was never blocked by the CSS trick to
// begin with -- this test exercises that exact second entry point directly.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";

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

// canUploadData (canMutate("upload-data")) is granted -- the ONLY reason
// canUploadNow can be false here is the closed-month flag below. This isolates
// the regression: the old code checked canUploadData alone and would have let
// this file through. Excludes draw-sample/process-population so the A1 landing
// rule keeps this on the "process" sub-tab (where Phase 1 renders) rather than
// "browse" (which would mount the population-browse Web Worker -- unrunnable
// under Vitest's jsdom env), matching Population.wizard.test.tsx's identical note.
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
    isSelectedMonthClosed: true,
    setSelectedMonth: () => {},
    startNewMonth: () => {},
    refreshMonths: async () => {},
    registerMonthChangeGuard: () => () => {},
  }),
}));

import PopulationTab from "./index";

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

describe("Population Phase 1 upload — handler-side canUploadNow re-check (audit finding 12)", () => {
  it("rejects a file dropped into the hidden fallback input while the selected month is closed, even though upload-data permission is granted", () => {
    const { container } = render(<PopulationTab />);

    const hiddenInputs = container.querySelectorAll<HTMLInputElement>(".hidden-file-input");
    expect(hiddenInputs.length).toBe(2);
    const riskInput = hiddenInputs[0];

    const file = new File(["x"], "risk.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    Object.defineProperty(riskInput, "files", { value: [file], writable: false, configurable: true });
    fireEvent.change(riskInput);

    // The file must never have been accepted into wizard state -- no filename
    // rendered anywhere in the upload cards.
    expect(container.textContent).not.toContain("risk.xlsx");
    // The denial message (canUploadNow's, not the old canUploadData-only one)
    // must be shown.
    expect(container.textContent).toContain("أن الشهر مغلق حالياً");
  });
});
