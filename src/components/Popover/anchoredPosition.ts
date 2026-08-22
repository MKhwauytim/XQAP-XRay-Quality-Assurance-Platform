/**
 * anchoredPosition.ts — viewport geometry for anchored popovers (filter menus,
 * column pickers, dropdowns).
 *
 * WHY THIS EXISTS
 * ---------------
 * Every anchored menu in the app used to position itself ad hoc, and each
 * re-invented the same three bugs:
 *
 *  1. **Clipping.** A `position: absolute` menu inside a scroll container
 *     (`.bv-table-scroll`, `.dt-table-wrap`) is clipped by that container's
 *     `overflow`, so a filter menu opened from a table header is cut off.
 *  2. **No collision handling.** A menu pinned at `anchor.bottom + gap` with
 *     no bottom clamp runs off the viewport when the button sits low on the
 *     screen — the footer buttons ("تم", "تطبيق") become unreachable.
 *  3. **RTL sign errors.** "Align the menu with the button" means the physical
 *     RIGHT edges in RTL and the physical LEFT edges in LTR. Hard-coding one
 *     of them puts the menu on the wrong side, and an unclamped `right:
 *     innerWidth - anchor.right` pushes a 220px menu off the physical left
 *     edge for the last columns of a wide RTL table.
 *
 * This module is the single, pure answer to "where does the box go". It takes
 * measured rectangles and returns physical CSS pixel offsets; it touches no
 * DOM, so it is fully unit-testable without layout.
 *
 * PHYSICAL, NOT LOGICAL, ON PURPOSE
 * ---------------------------------
 * The returned `left`/`top` are physical. Direction is an *input* here
 * (`isRtl`) and is resolved into the number, so re-expressing the result
 * through `inset-inline-start` would apply the RTL flip a second time and put
 * the popover back on the wrong side. Logical properties remain the rule for
 * static CSS inside the popover; they are the wrong tool for a JS-computed
 * viewport offset.
 */

/** The subset of `DOMRect` this module reads. */
export type RectLike = {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
};

export type SizeLike = { width: number; height: number };

/** Which side of the anchor the popover ended up on. */
export type PopoverPlacement = "below" | "above";

/**
 * Which of the popover's inline edges is pinned to the matching edge of the
 * anchor. `start` is the usual dropdown behaviour (RTL: right edges flush,
 * menu grows toward the physical left).
 */
export type PopoverAlign = "start" | "end";

/** Distance between the anchor and the popover. */
export const POPOVER_GAP = 6;
/** Minimum distance the popover keeps from every viewport edge. */
export const POPOVER_VIEWPORT_MARGIN = 8;
/**
 * The popover never gets clamped below this height even when the anchor is
 * pinned against a viewport edge — it scrolls internally instead of collapsing
 * into an unusable sliver. Only the viewport itself can force it lower.
 */
export const POPOVER_MIN_HEIGHT = 120;

export type AnchoredPositionInput = {
  /** Anchor rect in viewport coordinates (i.e. `getBoundingClientRect()`). */
  anchor: RectLike;
  /** The popover's *natural* size, measured with no clamp applied. */
  popover: SizeLike;
  viewport: SizeLike;
  /** Resolved writing direction of the anchor. */
  isRtl: boolean;
  align?: PopoverAlign;
  gap?: number;
  margin?: number;
  minHeight?: number;
};

export type AnchoredPosition = {
  /** Physical viewport offsets, for `position: fixed`. */
  left: number;
  top: number;
  maxWidth: number;
  maxHeight: number;
  placement: PopoverPlacement;
};

function clamp(value: number, min: number, max: number): number {
  // `max` can legitimately fall below `min` on a viewport smaller than the
  // popover; the low edge wins so the popover stays reachable.
  return Math.max(min, Math.min(value, Math.max(min, max)));
}

export function computeAnchoredPosition(input: AnchoredPositionInput): AnchoredPosition {
  const {
    anchor,
    popover,
    viewport,
    isRtl,
    align = "start",
    gap = POPOVER_GAP,
    margin = POPOVER_VIEWPORT_MARGIN,
    minHeight = POPOVER_MIN_HEIGHT
  } = input;

  // ── Vertical: flip above the anchor when below does not fit ──────────────
  const spaceBelow = Math.max(0, viewport.height - anchor.bottom - gap - margin);
  const spaceAbove = Math.max(0, anchor.top - gap - margin);

  const placement: PopoverPlacement =
    popover.height > spaceBelow && spaceAbove > spaceBelow ? "above" : "below";

  const spaceOnChosenSide = placement === "below" ? spaceBelow : spaceAbove;
  const viewportHeightBudget = Math.max(0, viewport.height - margin * 2);
  const maxHeight = Math.max(
    Math.min(minHeight, viewportHeightBudget),
    spaceOnChosenSide
  );
  const height = Math.min(popover.height, maxHeight);

  const rawTop = placement === "below" ? anchor.bottom + gap : anchor.top - gap - height;
  const top = clamp(rawTop, margin, viewport.height - margin - height);

  // ── Horizontal: align one inline edge, then clamp into the viewport ──────
  const maxWidth = Math.max(0, viewport.width - margin * 2);
  const width = Math.min(popover.width, maxWidth);

  // In RTL the inline-start edge IS the physical right edge, so `align:
  // "start"` pins the popover's right edge to the anchor's right edge and the
  // box grows leftwards. In LTR the same intent pins the left edges.
  const pinsRightEdges = align === "start" ? isRtl : !isRtl;
  const rawLeft = pinsRightEdges ? anchor.right - width : anchor.left;
  const left = clamp(rawLeft, margin, viewport.width - margin - width);

  return { left, top, maxWidth, maxHeight, placement };
}

/**
 * Resolve whether an element sits in an RTL context.
 *
 * Computed style is the truth in a browser, but jsdom reports the initial
 * `ltr` for everything (component tests load no CSS at all), so a `dir`
 * attribute anywhere up the tree — including `<html dir="rtl">`, which this
 * app always ships — is consulted as the fallback. The one case this gets
 * wrong is an element whose CSS forces `direction: ltr` beneath a
 * `dir="rtl"` ancestor (`.app-shell`'s deliberate grid-order hack); nothing
 * anchors a popover to that element.
 */
export function resolveIsRtl(element: Element | null | undefined): boolean {
  if (!element) return false;

  const view = element.ownerDocument?.defaultView;
  if (view?.getComputedStyle) {
    try {
      if (view.getComputedStyle(element).direction === "rtl") return true;
    } catch {
      // getComputedStyle throws on a detached element in some engines.
    }
  }

  const withDir = element.closest("[dir]");
  const attr = withDir?.getAttribute("dir")?.toLowerCase();
  if (attr === "rtl") return true;
  if (attr === "ltr") return false;

  return element.ownerDocument?.dir?.toLowerCase() === "rtl";
}
