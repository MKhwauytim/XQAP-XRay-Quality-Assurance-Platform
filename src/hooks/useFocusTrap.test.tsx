/* @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

import { useFocusTrap } from "./useFocusTrap";

/**
 * A minimal harness dialog that adopts the hook exactly as the real dialogs do:
 * three focusable controls (first / middle / last) plus a close button, an
 * `onEscape` wired to unmount, and an external trigger button so we can verify
 * focus restoration on close.
 */
function TrapHarness({ onEscape }: { onEscape: () => void }) {
  const ref = useFocusTrap<HTMLDivElement>({ onEscape });
  return (
    <div ref={ref} role="dialog" aria-modal="true">
      <button type="button">first</button>
      <button type="button">middle</button>
      <button type="button">last</button>
    </div>
  );
}

function App() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        trigger
      </button>
      {open ? <TrapHarness onEscape={() => setOpen(false)} /> : null}
    </div>
  );
}

afterEach(() => {
  cleanup();
});

describe("useFocusTrap", () => {
  it("focuses the first focusable element when the dialog opens", () => {
    render(<App />);
    fireEvent.click(screen.getByText("trigger"));
    expect(document.activeElement).toBe(screen.getByText("first"));
  });

  it("wraps forward: Tab from the last focusable returns to the first", () => {
    render(<App />);
    fireEvent.click(screen.getByText("trigger"));

    const last = screen.getByText("last");
    last.focus();
    expect(document.activeElement).toBe(last);

    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByText("first"));
  });

  it("wraps backward: Shift+Tab from the first focusable returns to the last", () => {
    render(<App />);
    fireEvent.click(screen.getByText("trigger"));

    const first = screen.getByText("first");
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByText("last"));
  });

  it("pulls focus back when it has escaped the container", () => {
    render(<App />);
    fireEvent.click(screen.getByText("trigger"));

    // Move focus outside the trap (as a stray click might), then press Tab.
    const trigger = screen.getByText("trigger");
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    fireEvent.keyDown(document.body, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByText("first"));
  });

  it("calls onEscape when Escape is pressed inside the dialog", () => {
    const onEscape = vi.fn();
    render(<TrapHarness onEscape={onEscape} />);

    fireEvent.keyDown(screen.getByText("first"), { key: "Escape" });
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it("restores focus to the trigger element when the dialog closes", () => {
    render(<App />);
    const trigger = screen.getByText("trigger");
    trigger.focus();
    fireEvent.click(trigger);
    // Trap moved focus into the dialog.
    expect(document.activeElement).toBe(screen.getByText("first"));

    // Escape closes the dialog (unmounts it) → focus returns to the trigger.
    fireEvent.keyDown(screen.getByText("first"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("does not trap or move focus while disabled (enabled=false)", () => {
    function Disabled() {
      const ref = useFocusTrap<HTMLDivElement>({ enabled: false });
      return (
        <div ref={ref} role="dialog">
          <button type="button">inside</button>
        </div>
      );
    }
    render(
      <div>
        <button type="button">outside</button>
        <Disabled />
      </div>
    );
    const outside = screen.getByText("outside");
    outside.focus();
    // Inert trap must not steal focus.
    expect(document.activeElement).toBe(outside);
  });
});
