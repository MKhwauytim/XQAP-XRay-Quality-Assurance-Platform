import { useRef, useCallback } from "react";
import type React from "react";
import { snapRect, resize } from "../../../../../data/reportDesigner/geometry";
import type { Rect, ResizeHandle } from "../../../../../data/reportDesigner/geometry";

interface UseCanvasInteractionsOptions {
  grid: number;
  onElementChange: (elementId: string, rect: Rect) => void;
}

interface DragState {
  elementId: string;
  startX: number;
  startY: number;
  originalRect: Rect;
  handle: ResizeHandle | null;
}

interface UseCanvasInteractionsResult {
  onElementPointerDown: (
    e: React.PointerEvent,
    elementId: string,
    currentRect: Rect
  ) => void;
  onHandlePointerDown: (
    e: React.PointerEvent,
    elementId: string,
    handle: ResizeHandle,
    currentRect: Rect
  ) => void;
  /** Attach to the canvas root div (receives captured pointer events). */
  onPointerMove: (e: React.PointerEvent) => void;
  /** Attach to the canvas root div (receives captured pointer events). */
  onPointerUp: (e: React.PointerEvent) => void;
}

export function useCanvasInteractions({
  grid,
  onElementChange,
}: UseCanvasInteractionsOptions): UseCanvasInteractionsResult {
  const dragRef = useRef<DragState | null>(null);
  // Store onElementChange in a ref so handlers always read the latest value
  // without needing to be re-created on every render (eliminates stale closure).
  const onElementChangeRef = useRef(onElementChange);
  onElementChangeRef.current = onElementChange;

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const state = dragRef.current;
    if (!state) return;

    const dx = e.clientX - state.startX;
    const dy = e.clientY - state.startY;

    // We don't call onElementChange during move — only on up.
    // (For live preview during drag, a future pass could call a separate
    //  onElementPreview callback without writing to the doc.)
    void dx;
    void dy;
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const state = dragRef.current;
    if (!state) return;

    const dx = e.clientX - state.startX;
    const dy = e.clientY - state.startY;

    let finalRect: Rect;
    if (state.handle === null) {
      // Drag: translate x/y
      finalRect = {
        x: state.originalRect.x + dx,
        y: state.originalRect.y + dy,
        w: state.originalRect.w,
        h: state.originalRect.h,
      };
    } else {
      // Resize via handle
      finalRect = resize(state.originalRect, state.handle, dx, dy, 8, 8);
    }

    const snapped = snapRect(finalRect, grid);
    // Read from ref at call time — no stale closure.
    onElementChangeRef.current(state.elementId, snapped);

    dragRef.current = null;
  }, [grid]);

  const startDrag = useCallback(
    (
      e: React.PointerEvent,
      elementId: string,
      currentRect: Rect,
      handle: ResizeHandle | null
    ) => {
      e.stopPropagation();
      // Capture the pointer on the element so all subsequent pointermove/pointerup
      // events are delivered to the capturing element. The canvas root div has
      // onPointerMove/onPointerUp attached, which receives these captured events —
      // no window.addEventListener needed.
      e.currentTarget.setPointerCapture(e.pointerId);

      dragRef.current = {
        elementId,
        startX: e.clientX,
        startY: e.clientY,
        originalRect: { ...currentRect },
        handle,
      };
    },
    []
  );

  const onElementPointerDown = useCallback(
    (e: React.PointerEvent, elementId: string, currentRect: Rect) => {
      startDrag(e, elementId, currentRect, null);
    },
    [startDrag]
  );

  const onHandlePointerDown = useCallback(
    (
      e: React.PointerEvent,
      elementId: string,
      handle: ResizeHandle,
      currentRect: Rect
    ) => {
      startDrag(e, elementId, currentRect, handle);
    },
    [startDrag]
  );

  return { onElementPointerDown, onHandlePointerDown, onPointerMove, onPointerUp };
}
