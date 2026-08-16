/* @vitest-environment jsdom */
// Regression tests for two audit findings scoped to FeedbackWidget:
//
//  Finding 16 — CATEGORY_LABELS used to be a module-scope constant, resolved
//  once via `getLabels()` at import time and frozen for the tab's lifetime.
//  Every other string in this file is read fresh via `getLabels()` inside
//  render, so an admin's Settings-tab label override reached them immediately
//  but never reached the category buttons/badges. Fixed by recomputing the
//  label from `useLabels()` (which subscribes to override changes) inside the
//  component instead of at module scope.
//
//  Finding 11 — the floating feedback panel was the only overlay surface (of
//  ~20 in the app) with no focus trap and no Escape-to-close. Fixed by
//  swapping the panel's plain `useRef` for `useFocusTrap({ onEscape })`,
//  mirroring GlobalMonthSelector's own popoverFocusTrapRef call site.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FeedbackWidget } from "./FeedbackWidget";
import { clearSession, writeSession } from "../../auth/authSession";
import { resetAllLabels, setLabel } from "../../data/labels/labelsStore";

vi.mock("../../data/workspace/useWorkspace", () => ({
  useWorkspace: () => ({
    directoryHandle: null,
    refreshPermissions: () => {},
  }),
}));

beforeEach(() => {
  clearSession();
  resetAllLabels();
  writeSession({ role: "employee", username: "emp-1", loginAt: new Date().toISOString() });
});

afterEach(() => {
  cleanup();
  clearSession();
  resetAllLabels();
});

function openPanel(): void {
  fireEvent.click(screen.getByRole("button", { name: "التواصل والاقتراحات" }));
}

describe("FeedbackWidget — category labels stay reactive to admin overrides (finding 16)", () => {
  it("shows the DEFAULT category label out of the box", () => {
    render(<FeedbackWidget />);
    openPanel();
    expect(screen.getByRole("button", { name: "اقتراح" })).toBeInTheDocument();
  });

  it("shows an admin's overridden category label instead of the frozen default", () => {
    // The override is applied AFTER the module has already been imported —
    // exactly the scenario a module-scope `CATEGORY_LABELS` constant computed
    // once via getLabels() at import time can never observe.
    setLabel("fb_category_suggestion", "طلب مخصص");

    render(<FeedbackWidget />);
    openPanel();

    expect(screen.getByRole("button", { name: "طلب مخصص" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "اقتراح" })).not.toBeInTheDocument();
  });
});

describe("FeedbackWidget — floating panel focus trap (finding 11)", () => {
  it("exposes the panel as a dialog and moves focus into it when it opens", () => {
    render(<FeedbackWidget />);
    openPanel();

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("closes the panel on Escape", () => {
    render(<FeedbackWidget />);
    openPanel();
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // Closing re-shows the floating trigger (it's hidden while the panel is open).
    expect(screen.getByRole("button", { name: "التواصل والاقتراحات" })).toBeInTheDocument();
  });
});
