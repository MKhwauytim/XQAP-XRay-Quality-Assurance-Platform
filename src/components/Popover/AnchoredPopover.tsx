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

/**
 * The cumulative CSS zoom in effect on an element, or 1.
 *
 * Guarded rather than assumed: `currentCSSZoom` is a recent addition, and a
 * missing or nonsensical value must degrade to "no correction" rather than to a
 * division by zero, which would write `Infinity` into a style property and put
 * the popover nowhere at all.
 */
function zoomFactorOf(node: Element): number {
  const zoom = (node as Element & { currentCSSZoom?: number }).currentCSSZoom;
  return typeof zoom === "number" && Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
}

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
    //
    // Clearing it also un-overflows the box for the duration of the
    // measurement, and an element with nothing to scroll has its `scrollTop`
    // reset to 0 by the browser — silently, and not restored when the clamp
    // comes back. Every re-measure therefore threw the user back to the top of
    // a long popover. Save it across the measurement and put it back.
    const previousScrollTop = node.scrollTop;
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

    // Everything measured above is in DEVICE pixels — `getBoundingClientRect`
    // and `window.innerWidth/Height` both are. Everything written below is
    // interpreted as CSS pixels and then multiplied by the element's effective
    // zoom. The two agree only while that zoom is 1.
    //
    // The app-wide UI scale (`src/data/preferences/uiScaleStore.ts`) puts
    // `zoom` on the root element, so they stop agreeing the moment an operator
    // scales the interface. Measured in Chromium at `zoom: 0.7`: a fixed
    // element written `top: 100px` renders at 70px, and a column picker whose
    // anchor ended at y=231 was drawn at y=166 — floating above and across the
    // button it belongs to. Every filter menu and column picker in the app,
    // at every scale but 100 %.
    //
    // `currentCSSZoom` is the cumulative effective zoom for THIS element, so it
    // stays correct if a zoom is ever introduced somewhere between the root and
    // the portal target. Falls back to 1 where the property does not exist
    // (jsdom, which is where the component tests run).
    const zoom = zoomFactorOf(node);

    node.style.top = `${next.top / zoom}px`;
    node.style.left = `${next.left / zoom}px`;
    node.style.maxHeight = `${next.maxHeight / zoom}px`;
    node.style.maxWidth = `${next.maxWidth / zoom}px`;
    // Exposed for styling (e.g. flipping a caret) and for tests, which cannot
    // observe geometry in jsdom but can observe the decision.
    node.dataset.placement = next.placement;

    // Restore the scroll position the clamp-clearing above discarded. Assigned
    // unconditionally: the browser clamps it to whatever range the restored
    // max-height allows, which is exactly the wanted behaviour when the popover
    // grew or shrank.
    if (previousScrollTop !== 0) node.scrollTop = previousScrollTop;
  }, [anchor, align, gap]);

  // No dependency array on purpose: content changes (a checkbox toggled in a
  // multiselect, a date range expanding to two inputs) change the popover's
  // height, and re-running with every render is both cheaper and more
  // reliable than a ResizeObserver that would observe the box this effect
  // itself resizes.
  useLayoutEffect(position);

  /**
   * Reposition on ANY ancestor's scroll — but never on the popover's own.
   *
   * The capture-phase listener below sees every scroll event in the document,
   * including the one the popover fires when the user scrolls its own content.
   * Repositioning in response to that was self-defeating: `position()` clears
   * the max-height clamp to measure, which un-overflows the box and makes the
   * browser drop `scrollTop` to 0. A long column picker therefore snapped back
   * to the top on every wheel notch and could not be scrolled at all — which
   * is how the feature reads as broken rather than as merely jumpy.
   *
   * The scrollTop is preserved in `position()` too, so this guard is belt and
   * braces rather than the only defence; skipping the work outright is still
   * right, since a popover scrolling inside itself has not moved relative to
   * its anchor and has nothing to recompute.
   */
  const handleAncestorScroll = useCallback(
    (event: Event) => {
      const node = nodeRef.current;
      const target = event.target;
      if (node && target instanceof Node && node.contains(target)) return;
      position();
    },
    [position]
  );

  useEffect(() => {
    if (!anchor) return;
    // Capture phase: a `scroll` event does not bubble, and the anchor usually
    // lives inside a scrolling table wrapper rather than the document.
    window.addEventListener("scroll", handleAncestorScroll, true);
    window.addEventListener("resize", position);
    return () => {
      window.removeEventListener("scroll", handleAncestorScroll, true);
      window.removeEventListener("resize", position);
    };
  }, [anchor, position, handleAncestorScroll]);

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
