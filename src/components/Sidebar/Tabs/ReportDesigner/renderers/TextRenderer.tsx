import type { Element, TextConfig } from "../../../../../data/reportDesigner/reportTypes";

interface TextRendererProps {
  element: Element;
}

export default function TextRenderer({ element }: TextRendererProps) {
  const config = element.config as TextConfig;
  const s = element.style;

  const style: React.CSSProperties = {
    width: "100%",
    height: "100%",
    boxSizing: "border-box",
    padding: s.padding != null ? s.padding : undefined,
    fontFamily: s.fontFamily ?? undefined,
    fontSize: s.fontSize != null ? s.fontSize : undefined,
    fontWeight: s.fontWeight != null ? s.fontWeight : undefined,
    color: s.color ?? undefined,
    textAlign: s.textAlign ?? undefined,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    overflow: "hidden",
  };

  return <div style={style}>{config.text}</div>;
}
