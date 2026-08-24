import { useCallback, useLayoutEffect, useRef, useState } from "react";
import {
  DEFAULT_QUEUE_SPLIT, MAX_QUEUE_SPLIT, MIN_QUEUE_SPLIT, QUEUE_SPLIT_CSS_VAR,
  getQueueSplit, resetQueueSplit, setQueueSplit,
} from "../../../../../../data/preferences/queueSplitStore";
import { useLabels } from "../../../../../../data/labels/useLabels";

/**
 * The draggable divider between the queue and the inspection panel.
 *
 * ## Why it writes the DOM instead of React state
 *
 * `XrayReferrals` is a ~1,420-line component owning a full DataTable, and it
 * sits close to the repo's `max-lines-per-function` budget. Routing a 60 Hz
 * pointer stream through its state would re-render the whole queue on every
 * frame for a change CSS can absorb on its own. So the live drag calls
 * `setProperty` on the grid element directly and the store is written exactly
 * once, on release. The parent's entire involvement is rendering this element.
 *
 * ## Why it finds its own container
 *
 * `XrayReferrals.css` places every child of `.ew-xr-grid` by explicit grid
 * line number, precisely so a conditional child cannot re-flow the panel
 * underneath the pagination (see that file's own comments). Rather than
 * become another placed child, this handle is absolutely positioned inside
 * `.ew-xr-panel-col` — which already spans the full height of the gutter —
 * and reaches its grid through `closest()`. No grid placement rule changes.
 *
 * ## Why the geometry is absolute, not a delta
 *
 * The queue's width is read straight off the pointer position relative to the
 * container edge (which edge depends on the container's computed `direction`,
 * so RTL and LTR are both correct without a hard-coded sign). Accumulating
 * deltas would let the divider drift away from the cursor over a long drag.
 *
 * The two pixel minimums stay in the CSS (`minmax(340px, …)` /
 * `minmax(430px, …)`); the clamp here mirrors them so the handle STOPS where
 * the layout stops, instead of continuing to move while nothing changes.
 */

// Matches `column-gap` on `.ew-ref-queue.ew-xr-grid` in XrayReferrals.css.
const GUTTER_PX = 14;
// Matches the queue track's own floor: `minmax(340px, …)`.
const QUEUE_FLOOR_PX = 340;
// Matches the panel track's own floor: `minmax(430px, …)`.
const PANEL_FLOOR_PX = 430;
const KEYBOARD_STEP = 0.02;

/** Clamp a candidate ratio against the container's REAL pixel floors, not just
 *  the store's own [MIN_QUEUE_SPLIT, MAX_QUEUE_SPLIT] range — a container
 *  narrower than both floors combined (the stacked/near-threshold case) has no
 *  valid ratio at all, so it falls back to the default rather than picking an
 *  arbitrary one. */
function clampToLayout(grid: HTMLElement, value: number): number {
  const width = grid.getBoundingClientRect().width;
  if (!Number.isFinite(width) || width <= 0) return DEFAULT_QUEUE_SPLIT;
  const min = Math.max(MIN_QUEUE_SPLIT, QUEUE_FLOOR_PX / width);
  const max = Math.min(MAX_QUEUE_SPLIT, (width - GUTTER_PX - PANEL_FLOOR_PX) / width);
  if (min > max) return DEFAULT_QUEUE_SPLIT;
  return value < min ? min : value > max ? max : value;
}

/** Trim to a plain percentage string (`"62%"`, not `"62.00%"`). */
function apply(grid: HTMLElement, value: number): void {
  const pct = Number((value * 100).toFixed(2));
  grid.style.setProperty(QUEUE_SPLIT_CSS_VAR, `${pct}%`);
}

export default function QueueSplitResizer() {
  const L = useLabels();
  const handleRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const lastRatioRef = useRef(getQueueSplit());
  // Used ONLY for aria-valuenow and as the keyboard step's base — never the
  // drag's source of truth, which lives in the DOM (see the module docblock).
  const [ratio, setRatio] = useState(getQueueSplit);

  const gridOf = useCallback((): HTMLElement | null => {
    return handleRef.current?.closest<HTMLElement>(".ew-xr-grid") ?? null;
  }, []);

  // Applied from a layout effect, so the first painted frame is already at the
  // stored width — an ordinary effect would paint one frame at the CSS
  // fallback and then jump, which reads as a layout bug on every visit.
  useLayoutEffect(() => {
    const grid = gridOf();
    if (grid) apply(grid, getQueueSplit());
  }, [gridOf]);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const handle = handleRef.current;
    if (!handle) return;
    // The stacked (`@media max-width: 1100px`) layout hides this handle with
    // `display: none`. `offsetParent` cannot be used to detect that here — it
    // is permanently `null` under jsdom regardless of visibility, which would
    // make every test below fail to start a drag — so this reads the computed
    // style directly, which is correct in a real browser AND in a test
    // fixture that never applies the stacking media query.
    if (typeof window !== "undefined" && window.getComputedStyle(handle).display === "none") return;
    event.preventDefault();
    if (typeof handle.setPointerCapture === "function") {
      handle.setPointerCapture(event.pointerId);
    }
    draggingRef.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const grid = gridOf();
    if (!grid) return;
    const rect = grid.getBoundingClientRect();
    const rtl = window.getComputedStyle(grid).direction === "rtl";
    // Absolute position -> width, not an accumulated delta: the divider
    // cannot drift away from the pointer over a long drag.
    const queueWidth = rtl ? rect.right - event.clientX : event.clientX - rect.left;
    const raw = rect.width > 0 ? queueWidth / rect.width : DEFAULT_QUEUE_SPLIT;
    const next = clampToLayout(grid, raw);
    lastRatioRef.current = next;
    apply(grid, next);
  }, [gridOf]);

  const endDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    const handle = handleRef.current;
    if (handle && typeof handle.releasePointerCapture === "function") {
      try {
        handle.releasePointerCapture(event.pointerId);
      } catch {
        // Capture was already released (e.g. pointercancel) -- nothing to do.
      }
    }
    setRatio(setQueueSplit(lastRatioRef.current));
  }, []);

  const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Home") {
      event.preventDefault();
      const grid = gridOf();
      const stored = resetQueueSplit();
      if (grid) apply(grid, stored);
      setRatio(stored);
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const grid = gridOf();
    if (!grid) return;
    const rtl = window.getComputedStyle(grid).direction === "rtl";
    // Geometric, not semantic: ArrowLeft moves the divider LEFT, which widens
    // the RIGHT-hand queue in RTL and narrows the LEFT-hand queue in LTR.
    const widensQueue = (event.key === "ArrowLeft") === rtl;
    const delta = widensQueue ? KEYBOARD_STEP : -KEYBOARD_STEP;
    const next = clampToLayout(grid, getQueueSplit() + delta);
    const stored = setQueueSplit(next);
    apply(grid, stored);
    setRatio(stored);
  }, [gridOf]);

  const onDoubleClick = useCallback(() => {
    const grid = gridOf();
    const stored = resetQueueSplit();
    if (grid) apply(grid, stored);
    setRatio(stored);
  }, [gridOf]);

  return (
    <div
      ref={handleRef}
      className="ew-xr-split-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label={L.ew_queue_split_handle_aria}
      title={L.ew_queue_split_handle_title}
      aria-valuenow={Math.round(ratio * 100)}
      aria-valuemin={Math.round(MIN_QUEUE_SPLIT * 100)}
      aria-valuemax={Math.round(MAX_QUEUE_SPLIT * 100)}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      onDoubleClick={onDoubleClick}
    />
  );
}
