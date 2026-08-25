import { useCallback, useLayoutEffect, useRef, useState } from "react";
import {
  DEFAULT_QUEUE_SPLIT, MAX_QUEUE_SPLIT, MIN_QUEUE_SPLIT, QUEUE_SPLIT_CSS_VAR,
  resetQueueSplit, resolveQueueSplit, setQueueSplit,
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
 *
 * ## Permission + shared default (owner follow-up, 2026-08-25)
 *
 * `enabled` is `resize-referral-layout` (on for every role by default — see
 * `userManagement.ts`): when off, nothing renders and the grid keeps
 * whichever ratio `resolveQueueSplit` last applied — the divider itself is
 * what's gated, not the ratio. `sharedRatio` is a privileged user's ratio
 * pushed to the workspace-shared preset; `resolveQueueSplit` (queueSplitStore)
 * prefers this browser's own stored drag over it, and the hardcoded default
 * over both. `onCommit` fires after every persisted change (drag release,
 * keyboard nudge, reset) so the caller can push it to the shared preset when
 * the dragging user holds `configure-referral-columns` — mirroring the exact
 * personal-over-admin precedence this page already uses for column layout.
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

export default function QueueSplitResizer({ enabled, sharedRatio, onCommit }: {
  /** `resize-referral-layout` — off hides the handle; the ratio still applies. */
  enabled: boolean;
  /** A privileged user's ratio pushed to the workspace-shared preset, or `undefined` before that load resolves. */
  sharedRatio?: number;
  /** Fires with the newly-stored ratio after every persisted change. */
  onCommit?: (ratio: number) => void;
}) {
  const L = useLabels();
  const handleRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const lastRatioRef = useRef(resolveQueueSplit(sharedRatio));
  // Used ONLY for aria-valuenow and as the keyboard step's base — never the
  // drag's source of truth, which lives in the DOM (see the module docblock).
  const [ratio, setRatio] = useState(() => resolveQueueSplit(sharedRatio));

  const gridOf = useCallback((): HTMLElement | null => {
    return handleRef.current?.closest<HTMLElement>(".ew-xr-grid") ?? null;
  }, []);

  // Applied from a layout effect, so the first painted frame is already at the
  // stored width — an ordinary effect would paint one frame at the CSS
  // fallback and then jump, which reads as a layout bug on every visit.
  // Re-runs when `sharedRatio` resolves (it loads async) so a browser with no
  // stored drag of its own picks up the admin default the moment it arrives.
  useLayoutEffect(() => {
    const grid = gridOf();
    const next = resolveQueueSplit(sharedRatio);
    if (grid) apply(grid, next);
    lastRatioRef.current = next;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing state IN from an external system (the workspace-shared preset, loaded async by the caller), matching the effect's own comment above
    setRatio(next);
  }, [gridOf, sharedRatio]);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const handle = handleRef.current;
    if (!handle) return;
    // The stacked (`@media max-width: 1160px`) layout hides this handle with
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
    const stored = setQueueSplit(lastRatioRef.current);
    setRatio(stored);
    onCommit?.(stored);
  }, [onCommit]);

  const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Home") {
      event.preventDefault();
      const grid = gridOf();
      const stored = resetQueueSplit();
      if (grid) apply(grid, stored);
      setRatio(stored);
      onCommit?.(stored);
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
    const next = clampToLayout(grid, resolveQueueSplit(sharedRatio) + delta);
    const stored = setQueueSplit(next);
    apply(grid, stored);
    setRatio(stored);
    onCommit?.(stored);
  }, [gridOf, sharedRatio, onCommit]);

  const onDoubleClick = useCallback(() => {
    const grid = gridOf();
    const stored = resetQueueSplit();
    if (grid) apply(grid, stored);
    setRatio(stored);
    onCommit?.(stored);
  }, [gridOf, onCommit]);

  // The element stays mounted either way — the layout effect above finds the
  // grid through `handleRef` (`closest(".ew-xr-grid")`), so an unmounted
  // handle would stop the resolved ratio (personal, shared, or default) from
  // ever reaching the grid for a role that can't drag it. Only the
  // interactive affordance is gated: no separator semantics, no tab stop, and
  // `.ew-xr-split-handle--disabled` (CSS) removes the pointer cursor/hit area.
  return (
    <div
      ref={handleRef}
      className={`ew-xr-split-handle${enabled ? "" : " ew-xr-split-handle--disabled"}`}
      role={enabled ? "separator" : undefined}
      aria-orientation={enabled ? "vertical" : undefined}
      aria-label={enabled ? L.ew_queue_split_handle_aria : undefined}
      title={enabled ? L.ew_queue_split_handle_title : undefined}
      aria-valuenow={enabled ? Math.round(ratio * 100) : undefined}
      aria-valuemin={enabled ? Math.round(MIN_QUEUE_SPLIT * 100) : undefined}
      aria-valuemax={enabled ? Math.round(MAX_QUEUE_SPLIT * 100) : undefined}
      tabIndex={enabled ? 0 : undefined}
      onPointerDown={enabled ? onPointerDown : undefined}
      onPointerMove={enabled ? onPointerMove : undefined}
      onPointerUp={enabled ? endDrag : undefined}
      onPointerCancel={enabled ? endDrag : undefined}
      onKeyDown={enabled ? onKeyDown : undefined}
      onDoubleClick={enabled ? onDoubleClick : undefined}
    />
  );
}
