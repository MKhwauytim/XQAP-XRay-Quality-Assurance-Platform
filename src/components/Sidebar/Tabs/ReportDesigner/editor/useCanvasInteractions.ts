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
}

export function useCanvasInteractions({
  grid,
  onElementChange,
}: UseCanvasInteractionsOptions): UseCanvasInteractionsResult {
  const dragRef = useRef<DragState | null>(null);

  const handlePointerMove = useCallback(
    (e: PointerEvent) => {
      const state = dragRef.current;
      if (!state) return;

      const dx = e.clientX - state.startX;
      const dy = e.clientY - state.startY;

      // We don't call onElementChange during move — only on up.
      // (For live preview during drag, a future pass could call a separate
      //  onElementPreview callback without writing to the doc.)
      void dx;
      void dy;
    },
    []
  );

  const handlePointerUp = useCallback(
    (e: PointerEvent) => {
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
      onElementChange(state.elementId, snapped);

      dragRef.current = null;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    },
    [grid, onElementChange, handlePointerMove]
  );

  const startDrag = useCallback(
    (
      e: React.PointerEvent,
      elementId: string,
      currentRect: Rect,
      handle: ResizeHandle | null
    ) => {
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);

      dragRef.current = {
        elementId,
        startX: e.clientX,
        startY: e.clientY,
        originalRect: { ...currentRect },
        handle,
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
    },
    [handlePointerMove, handlePointerUp]
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

  return { onElementPointerDown, onHandlePointerDown };
}
