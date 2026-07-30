import { useRef } from "react";
import {
  Image,
  Minus,
  Square,
  Type,
} from "lucide-react";
import type { Element } from "../../../../../data/reportDesigner/reportTypes";
import { useLabels } from "../../../../../data/labels/useLabels";
import type { Labels } from "../../../../../data/labels/labelsStore";
import Inspector from "./Inspector";

interface VizPanelProps {
  selectedElement: Element | null;
  onAddElement: (type: "text" | "shape") => void;
  onImageSelected: (dataUrl: string) => void;
  onUpdate: (id: string, patch: Partial<Element>) => void;
  /** False for a view-only user — disables adding elements and editing the selected one's properties. */
  canEdit: boolean;
}

const SW = 1.8;

function vizTypes(labels: Labels): Array<{
  label: string;
  icon: React.ReactNode;
  draggable: boolean;
  key: "text" | "shape" | "image" | "line";
}> {
  return [
    { label: labels.rd_viz_label_text, icon: <Type size={22} strokeWidth={SW} />, draggable: true, key: "text" },
    { label: labels.rd_viz_label_shape, icon: <Square size={22} strokeWidth={SW} />, draggable: true, key: "shape" },
    { label: labels.rd_viz_label_image, icon: <Image size={22} strokeWidth={SW} />, draggable: false, key: "image" },
    { label: labels.rd_shape_line, icon: <Minus size={22} strokeWidth={SW} />, draggable: true, key: "line" },
  ];
}

export default function VizPanel({ selectedElement, onAddElement, onImageSelected, onUpdate, canEdit }: VizPanelProps) {
  const labels = useLabels();
  const VIZ_TYPES = vizTypes(labels);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleImageFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (!canEdit) { e.target.value = ""; return; }
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { if (typeof reader.result === "string") onImageSelected(reader.result); };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  function handleTypeClick(key: string) {
    if (!canEdit) return;
    if (key === "image") { fileInputRef.current?.click(); return; }
    if (key === "text" || key === "shape" || key === "line") onAddElement(key === "line" ? "shape" : key);
  }

  function handleInspectorUpdate(updated: Element) {
    onUpdate(updated.elementId, updated);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div className="rd-panel-header">
        <span>{labels.rd_viz_panel_title}</span>
      </div>
      <div className="rd-viz-grid">
        {VIZ_TYPES.map((t) => (
          <button
            key={t.key}
            className="rd-viz-icon-btn"
            title={t.label}
            onClick={() => handleTypeClick(t.key)}
            type="button"
            aria-label={t.label}
            disabled={!canEdit}
            draggable={t.draggable && canEdit}
            onDragStart={t.draggable && canEdit ? (e) => {
              e.dataTransfer.effectAllowed = "copy";
              e.dataTransfer.setData("application/x-rd-viz-type", t.key);
            } : undefined}
          >
            <span className="rd-viz-icon">{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={handleImageFileChange}
        aria-hidden="true"
      />
      <div className="rd-format-section">
        <div className="rd-panel-header">
          <span>{labels.rd_format_label}</span>
        </div>
        <Inspector element={selectedElement} onUpdate={handleInspectorUpdate} canEdit={canEdit} />
      </div>
    </div>
  );
}
