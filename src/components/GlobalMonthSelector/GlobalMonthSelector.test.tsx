/* @vitest-environment jsdom */
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { GlobalMonthSelector } from "./GlobalMonthSelector";

vi.mock("../../data/month/useGlobalMonth", () => ({
  useGlobalMonth: () => ({
    months: [{ month: 5, year: 2026, folderName: "5-may-2026" }],
    selection: { kind: "existing", month: 5, year: 2026, folderName: "5-may-2026" },
    isSelectedMonthClosed: false,
    setSelectedMonth: () => true,
    startNewMonth: () => true,
    refreshMonths: async () => {},
    registerMonthChangeGuard: () => () => {},
  }),
}));

vi.mock("../../auth/usePermissions", () => ({
  usePermissions: () => ({ can: () => true }),
}));

afterEach(() => cleanup());

describe("GlobalMonthSelector — new-month popover focus trap", () => {
  it("moves focus into the popover when it opens, and Tab does not escape it", () => {
    render(<GlobalMonthSelector allowCreate />);
    fireEvent.click(screen.getByText(/شهر جديد/));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();

    // Focus should have moved to the first focusable element inside the dialog
    // (one of the month buttons), not stayed on the trigger button.
    expect(dialog.contains(document.activeElement)).toBe(true);

    // Tab from the LAST focusable element inside the dialog must wrap back to
    // the FIRST, not escape to whatever follows the dialog in the DOM.
    const focusables = dialog.querySelectorAll("button, input");
    const last = focusables[focusables.length - 1] as HTMLElement;
    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    // useFocusTrap's handler runs on the document listener and calls
    // preventDefault + focuses the first element — assert that happened.
    expect(document.activeElement).not.toBe(last);
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("Escape closes the popover", () => {
    render(<GlobalMonthSelector allowCreate />);
    fireEvent.click(screen.getByText(/شهر جديد/));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
