/* @vitest-environment jsdom */
// B10 — ErrorLogSection (synthesis medium, ErrorLogSection.tsx:17/23 + .css:94).
//
// Two behavioral regressions fixed together, both covered here:
//  1. The whole section (including its collapsed header) used to vanish
//     whenever the in-memory ring buffer was empty at mount, hiding the
//     feature entirely and freezing the badge count for the rest of the
//     session once mounted with zero errors.
//  2. "مسح السجل" (Clear) had no mutation gate at all -- any role that could
//     view the log could also wipe it, even in read-only/demo mode.
// (The third fix in this bucket -- the four undefined CSS custom properties
// in ErrorLogSection.css -- is a pure token rename with no runtime behavior
// to assert here.)
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearErrors, logError } from "../../../../data/storage/errorLogger";
import { ErrorLogSection } from "./ErrorLogSection";

const permissionsMock = vi.hoisted(() => ({ can: true, canMutate: true }));

vi.mock("../../../../auth/usePermissions", () => ({
  usePermissions: () => ({
    can: (featureId: string) => (featureId === "view-error-log" ? permissionsMock.can : false),
    canMutate: (featureId: string) =>
      featureId === "view-error-log" ? permissionsMock.canMutate : false,
  }),
}));

beforeEach(() => {
  clearErrors();
  permissionsMock.can = true;
  permissionsMock.canMutate = true;
});

afterEach(() => {
  cleanup();
  clearErrors();
  vi.useRealTimers();
});

describe("ErrorLogSection — visibility, clear gating, refresh", () => {
  it("renders nothing when the user cannot view the error log", () => {
    permissionsMock.can = false;
    const { container } = render(<ErrorLogSection />);
    expect(container).toBeEmptyDOMElement();
  });

  it("always renders the collapsed header when the user can view, even with zero errors logged", () => {
    // Regression: this used to `return null` whenever errors.length === 0 &&
    // !isOpen, hiding the whole section -- not just the badge -- for the
    // common empty-log case.
    render(<ErrorLogSection />);
    expect(screen.getByRole("button", { name: /سجل الأخطاء الأخيرة/ })).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("shows the current error count in the collapsed header badge", () => {
    logError("test-context", new Error("boom"));
    render(<ErrorLogSection />);
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("disables Clear and blocks clearErrors() when canMutate denies it, even though the panel can still be viewed", () => {
    logError("test-context", new Error("boom"));
    permissionsMock.canMutate = false;
    render(<ErrorLogSection />);

    fireEvent.click(screen.getByRole("button", { name: /سجل الأخطاء الأخيرة/ }));
    const clearBtn = screen.getByRole("button", { name: "مسح السجل" });
    expect(clearBtn).toBeDisabled();

    fireEvent.click(clearBtn);
    // Assert the *effect*, not just the disabled attribute: handleClear itself
    // also rejects the call, so the log survives even if a click somehow reaches it.
    expect(screen.getByText(/boom/)).toBeInTheDocument();
  });

  it("clears the log when canMutate allows it", () => {
    logError("test-context", new Error("boom"));
    render(<ErrorLogSection />);

    fireEvent.click(screen.getByRole("button", { name: /سجل الأخطاء الأخيرة/ }));
    fireEvent.click(screen.getByRole("button", { name: "مسح السجل" }));

    expect(screen.getByText("لا توجد أخطاء مسجّلة.")).toBeInTheDocument();
  });

  it("refreshes the badge count on an interval instead of only at mount", () => {
    vi.useFakeTimers();
    render(<ErrorLogSection />);
    expect(screen.queryByText("1")).not.toBeInTheDocument();

    logError("late-error", new Error("arrived after mount"));
    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(screen.getByText("1")).toBeInTheDocument();
  });
});
