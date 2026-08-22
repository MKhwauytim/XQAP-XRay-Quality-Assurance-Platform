/* @vitest-environment jsdom */
// jsdom performs no layout, so nothing here asserts a measured geometry — that
// would be a test that passes no matter what the code does. What IS observable
// is the contract: where the popover lands in the DOM, which class names and
// inline properties it writes, which side it chose given a mocked anchor rect,
// and that the caller's ref still points at the popover element (the focus
// trap depends on it).
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRef, useRef, useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import { AnchoredPopover } from "./AnchoredPopover";

type Rect = { left: number; top: number; width: number; height: number };

function stubRect(element: HTMLElement, { left, top, width, height }: Rect): void {
  element.getBoundingClientRect = () =>
    ({
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
      x: left,
      y: top,
      toJSON: () => ({})
    }) as DOMRect;
}

function setViewport(width: number, height: number): void {
  vi.stubGlobal("innerWidth", width);
  vi.stubGlobal("innerHeight", height);
}

/**
 * Renders a button + popover pair. The anchor's rect is stubbed BEFORE the
 * popover opens, so AnchoredPopover's layout effect reads the mocked geometry.
 */
function Harness({
  anchorRect,
  popoverRect,
  align
}: {
  anchorRect: Rect;
  popoverRect: Rect;
  align?: "start" | "end";
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={containerRef} className="scrolling-container">
      <button
        type="button"
        onClick={(event) => {
          stubRect(event.currentTarget, anchorRect);
          setAnchor((current) => (current ? null : event.currentTarget));
        }}
      >
        فتح
      </button>
      {anchor && (
        <AnchoredPopover
          anchor={anchor}
          {...(align ? { align } : {})}
          className="test-menu"
          role="dialog"
          aria-label="قائمة"
          ref={(node) => {
            if (node) stubRect(node, popoverRect);
          }}
        >
          <button type="button">إغلاق</button>
        </AnchoredPopover>
      )}
    </div>
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute("dir");
});

describe("AnchoredPopover — portal target", () => {
  it("renders into document.body, not inside the anchor's (scroll-clipping) container", () => {
    setViewport(1000, 800);
    render(<Harness anchorRect={{ left: 400, top: 300, width: 24, height: 24 }} popoverRect={{ left: 0, top: 0, width: 220, height: 180 }} />);

    fireEvent.click(screen.getByRole("button", { name: "فتح" }));

    const dialog = screen.getByRole("dialog", { name: "قائمة" });
    // The whole point: an `overflow: auto` ancestor can no longer clip it.
    expect(dialog.closest(".scrolling-container")).toBeNull();
    expect(dialog.parentElement).toBe(document.body);
  });

  it("renders nothing at all when it has no anchor", () => {
    setViewport(1000, 800);
    render(
      <AnchoredPopover anchor={null} className="test-menu" role="dialog" aria-label="قائمة">
        <span>محتوى</span>
      </AnchoredPopover>
    );

    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("AnchoredPopover — applied styling contract", () => {
  it("keeps the caller's skin class alongside the shared positioning class", () => {
    setViewport(1000, 800);
    render(<Harness anchorRect={{ left: 400, top: 300, width: 24, height: 24 }} popoverRect={{ left: 0, top: 0, width: 220, height: 180 }} />);
    fireEvent.click(screen.getByRole("button", { name: "فتح" }));

    const dialog = screen.getByRole("dialog", { name: "قائمة" });
    expect(dialog.classList.contains("ui-anchored-popover")).toBe(true);
    expect(dialog.classList.contains("test-menu")).toBe(true);
  });

  it("writes PHYSICAL top/left (never inset-inline-*), plus both clamps", () => {
    setViewport(1000, 800);
    render(<Harness anchorRect={{ left: 400, top: 300, width: 24, height: 24 }} popoverRect={{ left: 0, top: 0, width: 220, height: 180 }} />);
    fireEvent.click(screen.getByRole("button", { name: "فتح" }));

    const dialog = screen.getByRole("dialog", { name: "قائمة" });
    // Logical inset properties would double-apply the RTL flip: the offsets
    // handed to the element already have direction folded into them.
    expect(dialog.style.getPropertyValue("inset-inline-start")).toBe("");
    expect(dialog.style.getPropertyValue("inset-inline-end")).toBe("");
    expect(dialog.style.top).not.toBe("");
    expect(dialog.style.left).not.toBe("");
    expect(dialog.style.maxHeight).not.toBe("");
    expect(dialog.style.maxWidth).not.toBe("");
  });

  it("forwards the ref to the popover element itself, so an outside-click/focus-trap ref still works", () => {
    setViewport(1000, 800);
    const ref = createRef<HTMLDivElement>();
    const anchor = document.createElement("button");
    document.body.appendChild(anchor);
    stubRect(anchor, { left: 400, top: 300, width: 24, height: 24 });

    render(
      <AnchoredPopover anchor={anchor} ref={ref} className="test-menu" role="dialog" aria-label="قائمة">
        <button type="button">داخل</button>
      </AnchoredPopover>
    );

    expect(ref.current).toBe(screen.getByRole("dialog", { name: "قائمة" }));
    expect(ref.current?.contains(screen.getByRole("button", { name: "داخل" }))).toBe(true);
    anchor.remove();
  });
});

describe("AnchoredPopover — collision handling", () => {
  it("reports placement=below when the anchor leaves room underneath", () => {
    setViewport(1000, 800);
    render(<Harness anchorRect={{ left: 400, top: 100, width: 24, height: 24 }} popoverRect={{ left: 0, top: 0, width: 220, height: 180 }} />);
    fireEvent.click(screen.getByRole("button", { name: "فتح" }));

    expect(screen.getByRole("dialog", { name: "قائمة" }).dataset.placement).toBe("below");
  });

  it("flips to placement=above for an anchor near the bottom of the viewport", () => {
    setViewport(1000, 800);
    render(<Harness anchorRect={{ left: 400, top: 700, width: 24, height: 24 }} popoverRect={{ left: 0, top: 0, width: 220, height: 300 }} />);
    fireEvent.click(screen.getByRole("button", { name: "فتح" }));

    expect(screen.getByRole("dialog", { name: "قائمة" }).dataset.placement).toBe("above");
  });

  it("re-positions when an ancestor scrolls — the anchor rect is read live, not snapshotted at open time", () => {
    setViewport(1000, 800);
    render(<Harness anchorRect={{ left: 400, top: 100, width: 24, height: 24 }} popoverRect={{ left: 0, top: 0, width: 220, height: 300 }} />);
    fireEvent.click(screen.getByRole("button", { name: "فتح" }));

    const dialog = screen.getByRole("dialog", { name: "قائمة" });
    expect(dialog.dataset.placement).toBe("below");
    const topBeforeScroll = dialog.style.top;

    // The button scrolls down toward the viewport edge; nothing re-renders.
    stubRect(screen.getByRole("button", { name: "فتح" }), {
      left: 400,
      top: 700,
      width: 24,
      height: 24
    });
    act(() => {
      // Capture-phase listener: a scroll inside a table wrapper does not bubble.
      window.dispatchEvent(new Event("scroll"));
    });

    expect(dialog.dataset.placement).toBe("above");
    expect(dialog.style.top).not.toBe(topBeforeScroll);
  });

  it("re-positions on window resize", () => {
    setViewport(1000, 800);
    render(<Harness anchorRect={{ left: 400, top: 600, width: 24, height: 24 }} popoverRect={{ left: 0, top: 0, width: 220, height: 150 }} />);
    fireEvent.click(screen.getByRole("button", { name: "فتح" }));

    const dialog = screen.getByRole("dialog", { name: "قائمة" });
    expect(dialog.dataset.placement).toBe("below");

    setViewport(1000, 700);
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });

    expect(dialog.dataset.placement).toBe("above");
  });
});

describe("AnchoredPopover — direction resolution", () => {
  it("treats <html dir=\"rtl\"> as RTL when jsdom reports no computed direction", () => {
    // The app always ships `<html lang="ar" dir="rtl">`; component tests load
    // no CSS, so the `dir` attribute is the only signal available here.
    document.documentElement.setAttribute("dir", "rtl");
    setViewport(1000, 800);
    render(<Harness anchorRect={{ left: 400, top: 100, width: 24, height: 24 }} popoverRect={{ left: 0, top: 0, width: 220, height: 150 }} />);
    fireEvent.click(screen.getByRole("button", { name: "فتح" }));

    // RTL + align "start" ⇒ right edges flush ⇒ left = 424 - 220.
    expect(screen.getByRole("dialog", { name: "قائمة" }).style.left).toBe("204px");
  });

  it("falls back to LTR alignment with no rtl signal anywhere", () => {
    setViewport(1000, 800);
    render(<Harness anchorRect={{ left: 400, top: 100, width: 24, height: 24 }} popoverRect={{ left: 0, top: 0, width: 220, height: 150 }} />);
    fireEvent.click(screen.getByRole("button", { name: "فتح" }));

    expect(screen.getByRole("dialog", { name: "قائمة" }).style.left).toBe("400px");
  });
});
