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

  it("re-arms on a new container when only `resetKey` changes", () => {
    // Regression (defect 3): a panel that moves between DOM nodes while
    // `enabled` stays true — BrowseDataView's per-column filter menu switching
    // from column A straight to column B — left the trap holding the detached
    // node, so Tab and focus handling operated on a node no longer in the page.
    function Switcher() {
      const [col, setCol] = useState<"a" | "b">("a");
      const ref = useFocusTrap<HTMLDivElement>({ enabled: true, resetKey: col });
      return (
        <div>
          <button type="button" onClick={() => setCol("b")}>
            switch
          </button>
          {/* Two distinct host nodes, exactly one mounted at a time — the
              shape of a filter menu that lives inside its own column's `th`.
              Switching column tears the old node down and builds a new one. */}
          {col === "a" ? (
            <section>
              <div ref={ref} role="dialog" aria-label="menu-a">
                <button type="button">inside-a</button>
              </div>
            </section>
          ) : (
            <article>
              <div ref={ref} role="dialog" aria-label="menu-b">
                <button type="button">inside-b</button>
              </div>
            </article>
          )}
        </div>
      );
    }
    render(<Switcher />);
    expect(document.activeElement).toBe(screen.getByText("inside-a"));

    fireEvent.click(screen.getByText("switch"));
    // The trap must follow the rebuilt panel, not the node it first captured.
    expect(document.activeElement).toBe(screen.getByText("inside-b"));
  });

  it("nested dialog: one Escape closes only the innermost trap", () => {
    // Regression (defect 1): both traps listen on `document` in the capture
    // phase, so `stopPropagation()` in the inner one cannot stop the outer
    // sibling listener — one Escape closed both dialogs.
    const outerEscape = vi.fn();
    const innerEscape = vi.fn();

    function Nested() {
      const outerRef = useFocusTrap<HTMLDivElement>({ onEscape: outerEscape });
      const [innerOpen, setInnerOpen] = useState(false);
      const innerRef = useFocusTrap<HTMLDivElement>({
        onEscape: innerEscape,
        enabled: innerOpen,
      });
      return (
        <div ref={outerRef} role="dialog" aria-label="outer">
          <button type="button" onClick={() => setInnerOpen(true)}>
            open inner
          </button>
          {innerOpen ? (
            <div ref={innerRef} role="dialog" aria-label="inner">
              <button type="button">inner control</button>
            </div>
          ) : null}
        </div>
      );
    }

    render(<Nested />);
    fireEvent.click(screen.getByText("open inner"));

    fireEvent.keyDown(screen.getByText("inner control"), { key: "Escape" });
    expect(innerEscape).toHaveBeenCalledTimes(1);
    expect(outerEscape).not.toHaveBeenCalled();
  });

  it("portalled dialogs: Escape reaches only the one opened last", () => {
    // The ModalShell + ConfirmDialog pairing: both containers are portalled to
    // <body>, so neither contains the other and only activation order can tell
    // them apart.
    const firstEscape = vi.fn();
    const secondEscape = vi.fn();

    function Sibling({
      onEscape,
      name,
    }: {
      onEscape: () => void;
      name: string;
    }) {
      const ref = useFocusTrap<HTMLDivElement>({ onEscape });
      return (
        <div ref={ref} role="dialog" aria-label={name}>
          <button type="button">{`${name} control`}</button>
        </div>
      );
    }

    function Pair() {
      const [secondOpen, setSecondOpen] = useState(false);
      return (
        <div>
          <Sibling name="first" onEscape={firstEscape} />
          <button type="button" onClick={() => setSecondOpen(true)}>
            open second
          </button>
          {secondOpen ? <Sibling name="second" onEscape={secondEscape} /> : null}
        </div>
      );
    }

    render(<Pair />);
    fireEvent.click(screen.getByText("open second"));

    fireEvent.keyDown(screen.getByText("second control"), { key: "Escape" });
    expect(secondEscape).toHaveBeenCalledTimes(1);
    expect(firstEscape).not.toHaveBeenCalled();
  });

  it("hands control back to the outer trap once the inner one closes", () => {
    const outerEscape = vi.fn();

    function Nested() {
      const outerRef = useFocusTrap<HTMLDivElement>({ onEscape: outerEscape });
      const [innerOpen, setInnerOpen] = useState(false);
      const innerRef = useFocusTrap<HTMLDivElement>({
        onEscape: () => setInnerOpen(false),
        enabled: innerOpen,
      });
      return (
        <div ref={outerRef} role="dialog" aria-label="outer">
          <button type="button" onClick={() => setInnerOpen(true)}>
            open inner
          </button>
          {innerOpen ? (
            <div ref={innerRef} role="dialog" aria-label="inner">
              <button type="button">inner control</button>
            </div>
          ) : null}
        </div>
      );
    }

    render(<Nested />);
    fireEvent.click(screen.getByText("open inner"));
    fireEvent.keyDown(screen.getByText("inner control"), { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "inner" })).toBeNull();
    expect(outerEscape).not.toHaveBeenCalled();

    fireEvent.keyDown(screen.getByText("open inner"), { key: "Escape" });
    expect(outerEscape).toHaveBeenCalledTimes(1);
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
