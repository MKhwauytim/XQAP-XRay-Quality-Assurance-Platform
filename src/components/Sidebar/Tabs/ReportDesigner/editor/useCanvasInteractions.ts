import { useRef, useCallback, useEffect } from "react";
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
  /** Attach to the canvas root div so querySelector can find element nodes. */
  canvasRef: React.RefObject<HTMLDivElement | null>;
  onElementPointerDown: (e: React.PointerEvent, elementId: string, currentRect: Rect) => void;
  onHandlePointerDown: (e: React.PointerEvent, elementId: string, handle: ResizeHandle, currentRect: Rect) => void;
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
  const canvasRef = useRef<HTMLDivElement | null>(null);

  // Keep onElementChange in a ref to avoid stale closures without recreating callbacks.
  const onElementChangeRef = useRef(onElementChange);
  useEffect(() => {
    onElementChangeRef.current = onElementChange;
  }, [onElementChange]);

  // Locate the live DOM wrapper div for a given elementId.
  const getLiveEl = useCallback((id: string): HTMLElement | null => {
    return (canvasRef.current?.querySelector(`[data-rd-id="${id}"]`) as HTMLElement | null) ?? null;
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const state = dragRef.current;
    if (!state) return;

    const dx = e.clientX - state.startX;
    const dy = e.clientY - state.startY;
    const el = getLiveEl(state.elementId);
    if (!el) return;

    if (state.handle === null) {
      // Move: translate without touching left/top so the element snaps cleanly on release.
      el.style.transform = `translate(${dx}px, ${dy}px)`;
    } else {
      // Resize: directly update the element's bounds for live preview.
      const r = resize(state.originalRect, state.handle, dx, dy, 8, 8);
      el.style.left = `${r.x}px`;
      el.style.top = `${r.y}px`;
      el.style.width = `${r.w}px`;
      el.style.height = `${r.h}px`;
    }
  }, [getLiveEl]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const state = dragRef.current;
    if (!state) return;

    const dx = e.clientX - state.startX;
    const dy = e.clientY - state.startY;

    // Clear the live DOM override — React re-render will apply the snapped rect.
    const el = getLiveEl(state.elementId);
    if (el) {
      el.style.transform = "";
      // For resize, left/top/width/height will be reset by the React re-render.
    }

    let finalRect: Rect;
    if (state.handle === null) {
      finalRect = {
        x: state.originalRect.x + dx,
        y: state.originalRect.y + dy,
        w: state.originalRect.w,
        h: state.originalRect.h,
      };
    } else {
      finalRect = resize(state.originalRect, state.handle, dx, dy, 8, 8);
    }

    const snapped = snapRect(finalRect, grid);
    onElementChangeRef.current(state.elementId, snapped);
    dragRef.current = null;
  }, [grid, getLiveEl]);

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

  return { canvasRef, onElementPointerDown, onHandlePointerDown, onPointerMove, onPointerUp };
}
