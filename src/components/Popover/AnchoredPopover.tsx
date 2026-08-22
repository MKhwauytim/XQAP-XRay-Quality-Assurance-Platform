import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type ComponentPropsWithoutRef,
  type Ref
} from "react";
import { createPortal } from "react-dom";

import {
  computeAnchoredPosition,
  resolveIsRtl,
  type PopoverAlign
} from "./anchoredPosition";
import "./AnchoredPopover.css";

/**
 * A popover pinned to an anchor element, rendered into `document.body`.
 *
 * The three failure modes this replaces are catalogued in
 * `anchoredPosition.ts`; in short, an anchored menu must (a) escape the
 * scroll container it was declared inside, (b) stay inside the viewport, and
 * (c) pick its side by the anchor's *resolved* direction rather than a
 * hard-coded `left`/`right`.
 *
 * Ownership boundary — mirrors `ModalPortal`:
 *  - This component relocates and positions. It does not own focus, Escape,
 *    or outside-click. Callers keep passing their `useFocusTrap` ref through
 *    `ref` (it lands on the popover element itself, so an existing
 *    `ref.current.contains(event.target)` outside-click check is unaffected
 *    by the portal).
 *  - Unlike `ModalPortal` it does NOT lock body scroll: a popover repositions
 *    while the page scrolls instead of freezing it.
 *
 * Re-measurement runs in a layout effect on every render (so a popover that
 * grows as its content changes re-flips if it no longer fits) and on scroll
 * — captured, so scrolling any ancestor container counts — and resize.
 */
type AnchoredPopoverProps = Omit<ComponentPropsWithoutRef<"div">, "style"> & {
  /**
   * The element to pin to. `null` renders nothing: an anchor is not optional,
   * and guessing a position without one is how menus end up at 0,0.
   */
  anchor: HTMLElement | null;
  /** Which inline edge is flush with the anchor's. Defaults to `start`. */
  align?: PopoverAlign;
  /** Distance from the anchor, in px. */
  gap?: number;
  ref?: Ref<HTMLDivElement | null>;
};

export function AnchoredPopover({
  anchor,
  align = "start",
  gap,
  className,
  children,
  ref,
  ...rest
}: AnchoredPopoverProps) {
  const nodeRef = useRef<HTMLDivElement | null>(null);

  const attachNode = useCallback(
    (node: HTMLDivElement | null) => {
      nodeRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref]
  );

  const position = useCallback(() => {
    const node = nodeRef.current;
    if (!node || !anchor || !anchor.isConnected) return;

    // Clear the previous pass's clamp BEFORE measuring. Reading a
    // max-height-constrained box would feed the clamped height back into the
    // flip decision, so a popover that once shrank could never grow again.
    node.style.maxHeight = "";
    node.style.maxWidth = "";

    const next = computeAnchoredPosition({
      anchor: anchor.getBoundingClientRect(),
      popover: node.getBoundingClientRect(),
      viewport: { width: window.innerWidth, height: window.innerHeight },
      isRtl: resolveIsRtl(anchor),
      align,
      ...(gap === undefined ? {} : { gap })
    });

    node.style.top = `${next.top}px`;
    node.style.left = `${next.left}px`;
    node.style.maxHeight = `${next.maxHeight}px`;
    node.style.maxWidth = `${next.maxWidth}px`;
    // Exposed for styling (e.g. flipping a caret) and for tests, which cannot
    // observe geometry in jsdom but can observe the decision.
    node.dataset.placement = next.placement;
  }, [anchor, align, gap]);

  // No dependency array on purpose: content changes (a checkbox toggled in a
  // multiselect, a date range expanding to two inputs) change the popover's
  // height, and re-running with every render is both cheaper and more
  // reliable than a ResizeObserver that would observe the box this effect
  // itself resizes.
  useLayoutEffect(position);

  useEffect(() => {
    if (!anchor) return;
    // Capture phase: a `scroll` event does not bubble, and the anchor usually
    // lives inside a scrolling table wrapper rather than the document.
    window.addEventListener("scroll", position, true);
    window.addEventListener("resize", position);
    return () => {
      window.removeEventListener("scroll", position, true);
      window.removeEventListener("resize", position);
    };
  }, [anchor, position]);

  if (!anchor) return null;

  return createPortal(
    <div
      {...rest}
      ref={attachNode}
      className={className ? `ui-anchored-popover ${className}` : "ui-anchored-popover"}
    >
      {children}
    </div>,
    document.body
  );
}
