import type { CSSProperties } from "react";
import type { ReportDocument, Element } from "../../../../../data/reportDesigner/reportTypes";
import TextRenderer from "../renderers/TextRenderer";
import ShapeRenderer from "../renderers/ShapeRenderer";
import ImageRenderer from "../renderers/ImageRenderer";

interface CanvasProps {
  doc: ReportDocument;
  pageIndex: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  mode: "edit" | "view";
  zoom?: number;
}

function ElementBody({ element }: { element: Element }) {
  const kind = element.config.kind;
  if (kind === "text") return <TextRenderer element={element} />;
  if (kind === "shape") return <ShapeRenderer element={element} />;
  if (kind === "image") return <ImageRenderer element={element} />;
  // Placeholder for table / chart / kpi (not yet implemented)
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
  zoom = 1,
}: CanvasProps) {
  const page = doc.pages[pageIndex];
  const { width, height } = doc.pageSetup;

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
      style={canvasStyle}
      dir="rtl"
      onClick={
        mode === "edit"
          ? (e) => {
              // Clicked the canvas background (not a child element)
              if (e.target === e.currentTarget) {
                onSelect(null);
              }
            }
          : undefined
      }
    >
      <div style={innerStyle}>
        {sortedElements.map((el) => {
          const isSelected = mode === "edit" && el.elementId === selectedId;
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
            cursor: mode === "edit" ? (el.locked ? "not-allowed" : "pointer") : undefined,
          };

          return (
            <div
              key={el.elementId}
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
            >
              <ElementBody element={el} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
