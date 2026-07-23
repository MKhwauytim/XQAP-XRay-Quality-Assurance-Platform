import type { CSSProperties } from "react";
import type { ReportDocument, Element } from "../../../../../data/reportDesigner/reportTypes";
import type { Rect, ResizeHandle } from "../../../../../data/reportDesigner/geometry";
import { useCanvasInteractions } from "./useCanvasInteractions";
import TextRenderer from "../renderers/TextRenderer";
import ShapeRenderer from "../renderers/ShapeRenderer";
import ImageRenderer from "../renderers/ImageRenderer";
import KpiRenderer from "../renderers/KpiRenderer";

const RESIZE_HANDLES: ResizeHandle[] = ["nw", "n", "ne", "w", "e", "sw", "s", "se"];

interface CanvasProps {
  doc: ReportDocument;
  pageIndex: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  mode: "edit" | "view";
  /**
   * When `mode === "edit"`, further restricts the surface to selection/inspection
   * only — no drag, no resize handles, no onElementChange calls. Ignored when
   * `mode === "view"` (already fully inert there, e.g. the design-list thumbnail).
   * Lets a view-only user (B6 supervisor fix) still click an element to inspect
   * its properties in Inspector without being able to move/resize it — the
   * mutation surface is render-gated here instead of only being rejected
   * ~800ms later by the editor's debounced autosave. Defaults to true so
   * existing callers that never pass it keep today's full-edit behavior.
   */
  canEdit?: boolean;
  zoom?: number;
  onElementChange?: (elementId: string, rect: Rect) => void;
}

function ElementBody({ element }: { element: Element }) {
  const kind = element.config.kind;
  if (kind === "text") return <TextRenderer element={element} />;
  if (kind === "shape") return <ShapeRenderer element={element} />;
  if (kind === "image") return <ImageRenderer element={element} />;
  if (kind === "kpi") return <KpiRenderer element={element} />;
  // Compatibility fallback for table/chart elements from experimental design files.
  return (
    <div className="rd-element-placeholder">
      {element.name}
    </div>
  );
}

export default function Canvas({
  doc,
  pageIndex,
  selectedId,
  onSelect,
  mode,
  canEdit = true,
  zoom = 1,
  onElementChange,
}: CanvasProps) {
  const page = doc.pages[pageIndex];
  const { width, height } = doc.pageSetup;
  // Selection (click-to-inspect) only requires edit *mode*; actually moving or
  // resizing an element additionally requires edit *permission*.
  const editable = mode === "edit" && canEdit;

  const interactionGrid = 8;
  const { canvasRef, onElementPointerDown, onHandlePointerDown, onPointerMove, onPointerUp } = useCanvasInteractions({
    grid: interactionGrid,
    onElementChange: onElementChange ?? (() => undefined),
  });

  if (!page) return null;

  const sortedElements = [...page.elements].sort((a, b) => a.z - b.z);

  const canvasStyle: CSSProperties = {
    position: "relative",
    width: width * zoom,
    height: height * zoom,
    overflow: "hidden",
    backgroundColor: page.background?.color ?? "#ffffff",
    flexShrink: 0,
  };

  // When zoom != 1 we scale the inner content rather than each element individually
  // so that element coordinates always match the doc's coordinate space.
  const innerStyle: CSSProperties =
    zoom !== 1
      ? {
          position: "absolute",
          top: 0,
          right: 0,
          width: width,
          height: height,
          transformOrigin: "top right",
          transform: `scale(${zoom})`,
        }
      : { position: "absolute", top: 0, right: 0, width, height };

  return (
    <div
      className="rd-canvas"
      ref={canvasRef}
      style={canvasStyle}
      dir="rtl"
      onClick={
        mode === "edit"
          ? () => { onSelect(null); }
          : undefined
      }
      onPointerMove={mode === "edit" ? onPointerMove : undefined}
      onPointerUp={mode === "edit" ? onPointerUp : undefined}
    >
      <div style={innerStyle}>
        {sortedElements.map((el) => {
          const isSelected = mode === "edit" && el.elementId === selectedId;
          const isInteractive = editable && !el.locked && onElementChange != null;
          const currentRect: Rect = { x: el.x, y: el.y, w: el.w, h: el.h };

          const wrapperStyle: CSSProperties = {
            position: "absolute",
            left: el.x,
            top: el.y,
            width: el.w,
            height: el.h,
            opacity: el.style.opacity != null ? el.style.opacity : undefined,
            transform:
              el.rotation != null && el.rotation !== 0
                ? `rotate(${el.rotation}deg)`
                : undefined,
            cursor: mode === "edit" ? (el.locked ? "not-allowed" : isInteractive ? "move" : "pointer") : undefined,
          };

          return (
            <div
              key={el.elementId}
              data-rd-id={el.elementId}
              className={`rd-element${isSelected ? " rd-element--selected" : ""}`}
              style={wrapperStyle}
              onClick={
                mode === "edit" && !el.locked
                  ? (e) => {
                      e.stopPropagation();
                      onSelect(el.elementId);
                    }
                  : undefined
              }
              onPointerDown={
                isInteractive
                  ? (e) => {
                      onSelect(el.elementId);
                      onElementPointerDown(e, el.elementId, currentRect);
                    }
                  : undefined
              }
            >
              <ElementBody element={el} />

              {isSelected && !el.locked && onElementChange != null && editable &&
                RESIZE_HANDLES.map((handle) => (
                  <div
                    key={handle}
                    className={`rd-resize-handle rd-resize-handle--${handle}`}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      onHandlePointerDown(e, el.elementId, handle, currentRect);
                    }}
                  />
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
