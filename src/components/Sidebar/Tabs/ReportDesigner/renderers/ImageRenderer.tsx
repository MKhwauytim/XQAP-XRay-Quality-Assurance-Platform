import type { Element, ImageConfig } from "../../../../../data/reportDesigner/reportTypes";

interface ImageRendererProps {
  element: Element;
}

export default function ImageRenderer({ element }: ImageRendererProps) {
  const config = element.config as ImageConfig;

  return (
    <img
      src={config.dataUrl}
      alt={config.alt ?? ""}
      style={{
        width: "100%",
        height: "100%",
        objectFit: "contain",
        display: "block",
      }}
    />
  );
}
