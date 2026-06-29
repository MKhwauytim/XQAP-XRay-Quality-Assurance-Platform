import type { CSSProperties } from "react";
import type { Element, ShapeConfig } from "../../../../../data/reportDesigner/reportTypes";

interface ShapeRendererProps {
  element: Element;
}

export default function ShapeRenderer({ element }: ShapeRendererProps) {
  const config = element.config as ShapeConfig;
  const s = element.style;

  if (config.shape === "line" || config.shape === "divider") {
    const hrStyle: CSSProperties = {
      width: "100%",
      margin: 0,
      border: "none",
      borderTop: `${s.borderWidth ?? 1}px solid ${s.borderColor ?? "#d0d7de"}`,
      position: "absolute",
      top: "50%",
      transform: "translateY(-50%)",
    };
    return (
      <div style={{ width: "100%", height: "100%", position: "relative" }}>
        <hr style={hrStyle} />
      </div>
    );
  }

  // rect or ellipse
  const divStyle: CSSProperties = {
    width: "100%",
    height: "100%",
    boxSizing: "border-box",
    background: s.fill ?? "transparent",
    border:
      s.borderWidth != null && s.borderWidth > 0
        ? `${s.borderWidth}px solid ${s.borderColor ?? "#d0d7de"}`
        : undefined,
    borderRadius:
      config.shape === "ellipse" ? "50%" : s.borderRadius != null ? s.borderRadius : undefined,
  };

  return <div style={divStyle} />;
}
