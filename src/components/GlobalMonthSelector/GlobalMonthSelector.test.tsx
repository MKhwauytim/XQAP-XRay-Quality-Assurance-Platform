/* @vitest-environment jsdom */
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { GlobalMonthSelector } from "./GlobalMonthSelector";

const startNewMonthMock = vi.hoisted(() => vi.fn(() => true));

vi.mock("../../data/month/useGlobalMonth", () => ({
  useGlobalMonth: () => ({
    months: [{ month: 5, year: 2026, folderName: "5-may-2026" }],
    selection: { kind: "existing", month: 5, year: 2026, folderName: "5-may-2026" },
    isSelectedMonthClosed: false,
    setSelectedMonth: () => true,
    startNewMonth: startNewMonthMock,
    refreshMonths: async () => {},
    registerMonthChangeGuard: () => () => {},
  }),
}));

// Cluster A / GlobalMonthSelector: `can("process-population")` (render-time, `canCreate`)
// only requires view-level tab access, so a role with view-but-not-edit access on the
// population tab could previously reach the confirm button with zero handler-time
// mutation check — startNewMonth ran unconditionally. canMutate is mutable per-test so
// the regression test below can prove the handler now re-checks it defensively, matching
// the pattern already established for the Reports export handlers (B5).
const permissionsMock = vi.hoisted(() => ({ state: { canMutate: true } }));

vi.mock("../../auth/usePermissions", () => ({
  usePermissions: () => ({ can: () => true, canMutate: () => permissionsMock.state.canMutate }),
}));

afterEach(() => {
  cleanup();
  startNewMonthMock.mockClear();
  permissionsMock.state.canMutate = true;
});

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

describe("GlobalMonthSelector — new-month popover placement", () => {
  it("renders through AnchoredPopover into document.body", () => {
    // The rail becomes `position: fixed; transform: translateX(...)` at <=640px,
    // and a transform is a containing block for `position: fixed` descendants —
    // so the popover has to leave the rail's subtree entirely, not just switch
    // positioning scheme. It states its own `direction: rtl` in CSS because it
    // no longer inherits it from `.gms-root`.
    render(<GlobalMonthSelector allowCreate variant="sidebar" />);
    fireEvent.click(screen.getByText(/شهر جديد/));

    const dialog = screen.getByRole("dialog");
    expect(dialog.parentElement).toBe(document.body);
    expect(dialog.closest(".gms-root")).toBeNull();
    expect(dialog.classList.contains("ui-anchored-popover")).toBe(true);
    expect(dialog.classList.contains("gms-popover")).toBe(true);
  });

  it("a click INSIDE the portalled popover does not dismiss it", () => {
    // Regression guard for the portal move: the outside-click check tested only
    // `.gms-new-wrap`, which no longer contains the popover — every click on the
    // month grid would have read as an outside click and closed it immediately.
    render(<GlobalMonthSelector allowCreate variant="sidebar" />);
    fireEvent.click(screen.getByText(/شهر جديد/));

    const dialog = screen.getByRole("dialog");
    fireEvent.mouseDown(within(dialog).getByRole("button", { name: "مايو" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("a click outside both the trigger and the popover still dismisses it", () => {
    render(<GlobalMonthSelector allowCreate variant="sidebar" />);
    fireEvent.click(screen.getByText(/شهر جديد/));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("GlobalMonthSelector — new-month confirm handler-time permission gate (cluster A)", () => {
  it("blocks startNewMonth when canMutate is false, even though can()=true left the button reachable", () => {
    permissionsMock.state.canMutate = false;
    render(<GlobalMonthSelector allowCreate />);
    fireEvent.click(screen.getByText(/شهر جديد/));

    const dialog = screen.getByRole("dialog");
    const confirmButton = within(dialog).getByText("اختيار");
    expect(confirmButton).not.toBeDisabled();

    fireEvent.click(confirmButton);

    expect(startNewMonthMock).not.toHaveBeenCalled();
  });

  it("calls startNewMonth when canMutate is true", () => {
    permissionsMock.state.canMutate = true;
    render(<GlobalMonthSelector allowCreate />);
    fireEvent.click(screen.getByText(/شهر جديد/));

    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByText("اختيار"));

    expect(startNewMonthMock).toHaveBeenCalledTimes(1);
  });
});
