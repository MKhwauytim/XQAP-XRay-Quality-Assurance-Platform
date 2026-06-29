import { useRef } from "react";
import {
  BarChart2,
  Image,
  LayoutTemplate,
  Minus,
  Square,
  Table2,
  TrendingUp,
  Type,
} from "lucide-react";
import type { Element } from "../../../../../data/reportDesigner/reportTypes";
import Inspector from "./Inspector";

interface VizPanelProps {
  selectedElement: Element | null;
  onAddElement: (type: "text" | "shape") => void;
  onImageSelected: (dataUrl: string) => void;
  onUpdate: (id: string, patch: Partial<Element>) => void;
}

const SW = 1.8;

const VIZ_TYPES: Array<{
  label: string;
  icon: React.ReactNode;
  disabled: boolean;
  draggable: boolean;
  key: "text" | "shape" | "image" | "table" | "chart" | "kpi" | "line" | "section";
}> = [
  { label: "نص",   icon: <Type           size={22} strokeWidth={SW} />, disabled: false, draggable: true,  key: "text" },
  { label: "شكل",  icon: <Square         size={22} strokeWidth={SW} />, disabled: false, draggable: true,  key: "shape" },
  { label: "صورة", icon: <Image          size={22} strokeWidth={SW} />, disabled: false, draggable: false, key: "image" },
  { label: "جدول", icon: <Table2         size={22} strokeWidth={SW} />, disabled: true,  draggable: false, key: "table" },
  { label: "مخطط", icon: <BarChart2      size={22} strokeWidth={SW} />, disabled: true,  draggable: false, key: "chart" },
  { label: "KPI",  icon: <TrendingUp     size={22} strokeWidth={SW} />, disabled: true,  draggable: false, key: "kpi" },
  { label: "خط",   icon: <Minus          size={22} strokeWidth={SW} />, disabled: false, draggable: true,  key: "line" },
  { label: "قسم",  icon: <LayoutTemplate size={22} strokeWidth={SW} />, disabled: true,  draggable: false, key: "section" },
];

export default function VizPanel({ selectedElement, onAddElement, onImageSelected, onUpdate }: VizPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleImageFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { if (typeof reader.result === "string") onImageSelected(reader.result); };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  function handleTypeClick(key: string) {
    if (key === "image") { fileInputRef.current?.click(); return; }
    if (key === "text" || key === "shape" || key === "line") onAddElement(key === "line" ? "shape" : key);
  }

  function handleInspectorUpdate(updated: Element) {
    onUpdate(updated.elementId, updated);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div className="rd-panel-header">
        <span>التصورات</span>
      </div>
      <div className="rd-viz-grid">
        {VIZ_TYPES.map((t) => (
          <button
            key={t.key}
            className="rd-viz-icon-btn"
            title={t.label}
            disabled={t.disabled}
            onClick={() => handleTypeClick(t.key)}
            type="button"
            aria-label={t.label}
            draggable={t.draggable}
            onDragStart={t.draggable ? (e) => {
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
          <span>التنسيق</span>
        </div>
        <Inspector element={selectedElement} onUpdate={handleInspectorUpdate} />
      </div>
    </div>
  );
}
